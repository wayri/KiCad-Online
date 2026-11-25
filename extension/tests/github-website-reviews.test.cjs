const test=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const api=require('../github-website-reviews.js');
test('website annotations scan bounded Issues, coalesce refreshes, filter exact source and retain partial warnings',async()=>{
 const comments=require('../review-comments.js'),scope={repository:'owner/repo',ref:'main',file:'board.kicad_pcb'},at='2026-11-04T00:00:00Z',calls=[];let time=0;
 const adapter=api.create({comments,now:()=>time,call:async m=>{
  calls.push(m);if(m.action==='list')return {threads:Array.from({length:10},(_,i)=>({kind:'issue',number:i+1})),warnings:['Website listing is limited to the current result page.']};
  if(m.number===2)throw Error('session unavailable');
  const anchor={...scope,position:{x:10,y:20},area:{x:8,y:18,width:4,height:4}};
  if(m.number===3)anchor.file='other.kicad_sch';if(m.number===4)anchor.ref='other';
  return {kind:'issue',state:'open',number:m.number,url:`https://github.com/owner/repo/issues/${m.number}`,body:comments.toMarkdown({id:'note-'+m.number,text:'Review '+m.number,createdAt:at,anchor}),comments:[],warnings:[]};
 }});
 const [a,b]=await Promise.all([adapter.annotations(scope,{repository:scope.repository}),adapter.annotations(scope,{repository:scope.repository})]);
 assert.equal(calls.filter(m=>m.action==='list').length,2);assert.equal(calls.filter(m=>m.action==='read').length,8);
 assert.deepEqual(a,b);assert.equal(a.notes.length,5);assert.ok(a.notes.every(n=>n.anchor.file===scope.file&&n.anchor.ref===scope.ref));assert.match(a.warnings.join(' '),/Incomplete/);
 await adapter.annotations(scope,{repository:scope.repository});assert.equal(calls.length,10);
 time=6100;await adapter.annotations(scope,{repository:scope.repository});assert.equal(calls.filter(m=>m.action==='list').length,4);assert.equal(calls.filter(m=>m.action==='read').length,16);
 const targeted=await adapter.annotations(scope,{repository:scope.repository,number:1});assert.deepEqual(targeted.coverage,{kind:'thread',url:'https://github.com/owner/repo/issues/1'});assert.equal(targeted.notes.length,1);
 await assert.rejects(adapter.annotations(scope,{repository:'other/repo'}),/does not match/);
});
function harness({commitFails=false,storageFails=false,pendingFails=false,revokeAfterPending=false}={}){
 const data={},calls=[],thread={account:'reviewer',capabilities:{create:true},comments:[]};let reserved=0,allowed=true;
 const transport=api.create({crypto:webcrypto,assertWrites:async()=>{if(!allowed)throw Error('Provider writes disabled');},reserve:async()=>{reserved++;},storage:{get:async k=>({[k]:data[k]}),set:async value=>{const status=Object.values(value)[0].status;if(storageFails&&status==='done'||pendingFails&&status==='pending')throw Error('full');Object.assign(data,value);if(revokeAfterPending&&status==='pending')allowed=false;}},call:async message=>{
  calls.push(message);if(message.action==='read')return thread;
  if(message.action==='prepare')return {ticket:'private-ticket',account:'reviewer',repository:message.repository,number:message.number};
  if(message.action==='verify')return {verified:true,account:'reviewer'};
  if(commitFails)throw Error('unconfirmed');
  return {provider:'github',kind:'issue',number:message.number,author:'reviewer',messageId:'123',url:'https://github.com/owner/repo/issues/1#issuecomment-123',createdAt:'2026-11-04T06:00:00Z'};
 }});
 return {transport,calls,data,thread,get reserved(){return reserved;}};
}
const message={repository:'owner/repo',number:1,body:'QA message',clientMutationId:'12345678-1234-1234-1234-123456789abc',confirmedSend:true};
test('website Send reserves, persists pending, and confirms exactly one mutation without connector credentials',async()=>{
 const h=harness();const result=await h.transport.send(message);assert.equal(result.messageId,'123');assert.equal(h.reserved,1);
 assert.deepEqual(h.calls.map(n=>n.action),['read','prepare','verify','commit']);assert.match(h.calls[1].body,/pocket-kiview-session:12345678/);
 assert.equal(Object.values(h.data)[0].status,'done');const duplicate=await h.transport.send(message);assert.equal(duplicate.duplicate,true);assert.equal(h.calls.filter(n=>n.action==='commit').length,1);
 await assert.rejects(h.transport.send({...message,body:'changed'}),/different message/);
});
test('uncertain website completion cannot auto-resend, including after worker recreation',async()=>{
 const h=harness({commitFails:true});await assert.rejects(h.transport.send(message),/not confirmed/);assert.equal(Object.values(h.data)[0].status,'pending');
 await assert.rejects(h.transport.send(message),/unconfirmed outcome/);assert.equal(h.calls.filter(n=>n.action==='commit').length,1);
});
test('receipt persistence failure still returns success and retains duplicate protection',async()=>{
 const h=harness({storageFails:true}),result=await h.transport.send(message);assert.match(result.receiptWarning,/Posted/);
 assert.equal((await h.transport.send(message)).duplicate,true);assert.equal(h.calls.filter(n=>n.action==='commit').length,1);
});
test('Send requires explicit intent, unchanged website account and writable issue',async()=>{
 const h=harness();await assert.rejects(h.transport.send({...message,confirmedSend:false}),/Explicit/);assert.equal(h.calls.length,0);
 h.thread.capabilities.create=false;await assert.rejects(h.transport.send(message),/does not allow/);assert.equal(h.calls.filter(n=>n.action==='prepare').length,0);
});
test('website reverse reads coalesce briefly and force refresh does not hide failures',async()=>{
 const h=harness();await Promise.all([h.transport.read('owner/repo',1),h.transport.read('owner/repo',1)]);assert.equal(h.calls.length,1);
 await h.transport.read('owner/repo',1,true);assert.equal(h.calls.length,2);
});
test('missing Issue composer pins a verified API fallback across retries and worker restarts',async()=>{
 const data={},calls=[];
 let missing=true,failReceipt=false,attempts=0;
 const dependencies={crypto:webcrypto,assertWrites:async()=>{},assertPolicy:async(repository,account)=>{
   assert.equal(repository,'owner/repo');assert.equal(account,'reviewer');
  },reserve:async()=>{},storage:{get:async key=>({[key]:data[key]}),set:async entries=>{
   if(failReceipt)throw Error('storage is full');Object.assign(data,entries);
  }},call:async request=>{
   calls.push(request.action);
   if(request.action==='read')return {account:'reviewer',capabilities:{create:true},comments:[]};
   if(request.action==='prepare'&&missing)throw Object.assign(Error('No composer'),{code:'WEBSITE_ISSUE_COMPOSER_MISSING'});
   throw Error('Unexpected website '+request.action);
  }};
 const apiReply=async account=>{assert.equal(account,'reviewer');attempts++;throw Error('Unconfirmed API reply');};
 const adapter=api.create(dependencies);
 failReceipt=true;await assert.rejects(adapter.send(message,apiReply),/storage is full/);assert.equal(attempts,0);
 failReceipt=false;await assert.rejects(adapter.send(message,apiReply),/Unconfirmed API/);
 assert.equal(attempts,1);assert.equal(Object.values(data)[0].status,'api-reply');
 calls.length=0;missing=false;
 const restarted=api.create(dependencies);
 await assert.rejects(restarted.send(message,apiReply),/Unconfirmed API/);
 assert.deepEqual(calls,['read']);
 await assert.rejects(restarted.send({...message,body:'Other draft'},apiReply),/different message/);
 assert.equal(attempts,2);
 const recovered=await restarted.recoverPublication({...message,kind:'issue'},async()=>({messageId:'123'}));
 assert.equal(recovered.messageId,'123');
});
test('API fallback does not run when website preparation rejects for another reason or commit is uncertain',async()=>{
 const denied=harness();
 denied.thread.capabilities.create=false;
 const unexpected=()=>assert.fail('API fallback must not run');
 await assert.rejects(denied.transport.send(message,unexpected),/does not allow/);
 const uncertain=harness({commitFails:true});
 await assert.rejects(uncertain.transport.send(message,unexpected),/not confirmed/);
 await assert.rejects(uncertain.transport.send(message,unexpected),/unconfirmed outcome/);
});
function tabHarness(){
 const tabs=new Map([[1,{id:1,url:'https://github.com/owner/repo/tree/main',status:'complete'}]]),calls=[],removed=[];let next=2,bound=true,failCommit=false;
 const session={candidates:async()=>bound?[{id:1,bound:true}]:[],remember:async()=>{},recover:async(id)=>{calls.push(['recover',id]);return true;}};
 const chrome={permissions:{contains:async()=>true},tabs:{get:async id=>{if(!tabs.has(id))throw Error('closed');return {...tabs.get(id)};},create:async args=>{calls.push(['create',args]);const tab={...args,id:next++,status:'complete'};tabs.set(tab.id,tab);return {...tab};},update:async(id,args)=>{calls.push(['update',id,args]);Object.assign(tabs.get(id),args);return {...tabs.get(id)};},remove:async id=>{removed.push(id);tabs.delete(id);},sendMessage:async(id,message)=>{calls.push(['message',id,message.action]);if(message.action==='lease-inspect')return {ok:true,result:{safeToNavigate:true}};if(message.action==='commit'&&failCommit)throw Error('port closed');return {ok:true,result:message.action==='prepare'?{ticket:'ticket-'+id,repository:message.repository,number:message.number,account:'reviewer'}:message.action==='verify'?{verified:true,account:'reviewer'}:{messageId:'123',account:'reviewer'}};}},scripting:{executeScript:async value=>calls.push(['install',value.target.tabId])}};
 return {tabs,calls,removed,api:chrome,sessions:session,transport:api.createTabTransport({api:chrome,sessions:session,assertWrites:async()=>{},delay:async()=>{}}),set bound(value){bound=value;},set failCommit(value){failCommit=value;}};
}
test('website tab reads and manual preflight share one FIFO send slot without overlap',async()=>{
 const h=tabHarness(),calls=[];let active=0,maximum=0,release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 h.api.tabs.sendMessage=async(id,message)=>{calls.push(message.action+':'+(message.kind||'issue'));maximum=Math.max(maximum,++active);if(calls.length===1){started();await gate;}active--;return {ok:true,result:{account:'reviewer'}};};
 const first=h.transport.invoke({repository:'owner/repo',action:'read',number:7});await entered;
 const discussion=h.transport.invoke({repository:'owner/repo',action:'list',kind:'discussion'}),preflight=h.transport.invoke({repository:'owner/repo',action:'list'});await new Promise(setImmediate);
 assert.equal(calls.length,1);release();await Promise.all([first,discussion,preflight]);assert.equal(maximum,1);assert.deepEqual(calls,['read:issue','list:discussion','list:issue']);
});

test('failed website read releases its slot and a queued preflight proceeds once',async()=>{
 const h=tabHarness();let sent=0,release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 h.api.tabs.sendMessage=async()=>{sent++;if(sent===1){started();await gate;return {ok:false,error:'Catalogue unavailable'};}return {ok:true,result:{account:'reviewer'}};};
 const first=h.transport.invoke({repository:'owner/repo',action:'list'}),rejected=assert.rejects(first,/Catalogue unavailable/);await entered;
 const next=h.transport.invoke({repository:'owner/repo',action:'list'});release();await rejected;assert.equal((await next).account,'reviewer');assert.equal(sent,2);
});

test('website send queue bounds waiting calls at eight and accepts fresh work after draining',async()=>{
 const h=tabHarness();let sent=0,release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 h.api.tabs.sendMessage=async()=>{sent++;if(sent===1){started();await gate;}return {ok:true,result:{account:'reviewer'}};};
 const request={repository:'owner/repo',action:'list'},first=h.transport.invoke(request);await entered;
 const waiting=Array.from({length:8},()=>h.transport.invoke(request));await new Promise(setImmediate);
 await assert.rejects(h.transport.invoke(request),error=>error.code==='WEBSITE_REVIEW_UNAVAILABLE'&&/queue is full/.test(error.message));assert.equal(sent,1);
 release();await Promise.all([first,...waiting]);assert.equal(sent,9);await h.transport.invoke(request);assert.equal(sent,10);
});

test('queued website requests recheck repository binding before sending',async()=>{
 for(const change of ['binding','navigation']){
  const h=tabHarness();let sent=0,release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
  h.api.tabs.sendMessage=async()=>{sent++;started();await gate;return {ok:true,result:{account:'reviewer'}};};
  const request={repository:'owner/repo',action:'list'},first=h.transport.invoke(request);await entered;const next=h.transport.invoke(request),rejected=assert.rejects(next,/session changed/);await new Promise(setImmediate);
  if(change==='binding')h.bound=false;else h.tabs.get(1).url='https://github.com/foreign/repo';release();await first;await rejected;assert.equal(sent,1);
 }
});

test('queued commits are dispatched once and recheck the exact helper destination',async()=>{
 for(const redirect of [false,true]){
  const h=tabHarness(),request={repository:'owner/repo',number:7},prepared=await h.transport.invoke({...request,action:'prepare',body:'review'}),native=h.api.tabs.sendMessage;let release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
  h.api.tabs.sendMessage=async(id,message)=>{if(message.action==='verify'){started();await gate;}return native(id,message);};
  const verify=h.transport.invoke({...request,action:'verify',ticket:prepared.ticket});await entered;
  const commit=h.transport.invoke({...request,action:'commit',ticket:prepared.ticket});let duplicate,result;
  if(redirect)result=assert.rejects(commit,/changed repository or conversation/);else{duplicate=h.transport.invoke({...request,action:'commit',ticket:prepared.ticket});result=assert.rejects(duplicate,error=>error.code!=='WEBSITE_REVIEW_UNAVAILABLE');}
  await new Promise(setImmediate);assert.equal(h.calls.filter(call=>call[0]==='message'&&call[2]==='commit').length,0);
  if(redirect)h.tabs.get(2).url='https://github.com/owner/repo/issues/8';release();await verify;if(!redirect)await commit;await result;
  assert.equal(h.calls.filter(call=>call[0]==='message'&&call[2]==='commit').length,redirect?0:1);
 }
});

test('extension Send uses its scoped helper and leaves the original repository tab unchanged',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7};
 const prepared=await h.transport.invoke({...message,action:'prepare',body:'review'});
 assert.equal(h.tabs.get(1).url,'https://github.com/owner/repo/tree/main');
 assert.deepEqual(h.calls.find(n=>n[0]==='create')[1],{url:'https://github.com/owner/repo/issues/7',active:false});
 await h.transport.invoke({...message,action:'verify',ticket:prepared.ticket});await h.transport.invoke({...message,action:'commit',ticket:prepared.ticket});
 assert.deepEqual(h.calls.filter(n=>n[0]==='message').map(n=>n.slice(1)),[[2,'prepare'],[2,'verify'],[2,'commit']]);assert.deepEqual(h.removed,[2]);
});
test('missing repository binding and redirected helper both fail before a comment mutation',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7};h.bound=false;
 await assert.rejects(h.transport.invoke({...message,action:'prepare'}),/no API account/);assert.equal(h.calls.length,0);
 h.bound=true;const draft=await h.transport.invoke({...message,action:'prepare'});h.tabs.get(2).url='https://github.com/other/repo/issues/7';
 await assert.rejects(h.transport.invoke({...message,action:'verify',ticket:draft.ticket}),/changed repository/);assert.equal(h.calls.filter(n=>n[0]==='message'&&n[2]==='verify').length,0);
});
test('uncertain helper commit is attempted once and retained for manual inspection',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7};const draft=await h.transport.invoke({...message,action:'prepare'});h.failCommit=true;
 await assert.rejects(h.transport.invoke({...message,action:'commit',ticket:draft.ticket}),/Inspect/);
 await assert.rejects(h.transport.invoke({...message,action:'commit',ticket:draft.ticket}),/expired/);
 assert.equal(h.calls.filter(n=>n[0]==='message'&&n[2]==='commit').length,1);assert.deepEqual(h.removed,[]);
});
test('activeTab-only Send leases the authorized tab and restores its exact original folder without broad permissions',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7};h.api.permissions.contains=async()=>false;
 const original=h.tabs.get(1).url,draft=await h.transport.invoke({...message,action:'prepare'});
 assert.equal(h.calls.some(n=>n[0]==='create'),false);assert.equal(h.tabs.get(1).url,'https://github.com/owner/repo/issues/7');
 await assert.rejects(h.transport.invoke({repository:'owner/repo',action:'list'}),/comment send/);
 await h.transport.invoke({...message,action:'verify',ticket:draft.ticket});await h.transport.invoke({...message,action:'commit',ticket:draft.ticket});
 assert.equal(h.tabs.get(1).url,original);assert.deepEqual(h.removed,[]);
});
test('a newly navigated review helper retains fresh policy reads through the installed bridge and history parser',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),h=tabHarness(),contexts=new Map(),requests=[],branch=structuredClone(require('./fixtures/github-history/github-branch-head-observed.json')),sha=branch.payload.commitsRefRoute.refInfo.currentOid;
 branch.payload.commitsRefRoute.repo={ownerLogin:'owner',name:'repo'};h.api.permissions.contains=async()=>false;
 const update=h.api.tabs.update,nativeSend=h.api.tabs.sendMessage;h.api.tabs.update=async(id,args)=>{const result=await update(id,args);contexts.delete(id);return result;};
 h.api.tabs.sendMessage=async(id,message)=>message.action==='prepare-create'?{ok:true,result:{ticket:'new-ticket',account:'reviewer'}}:nativeSend(id,message);
 h.api.scripting.executeScript=async({target,files})=>{
  let context=contexts.get(target.tabId);if(!context){
   const documentFor=pinned=>({querySelectorAll:selector=>selector.startsWith('script')&&pinned?[{textContent:JSON.stringify({payload:{codeViewTreeRoute:{path:'/',refInfo:{name:'main',currentOid:sha},tree:{items:[],totalCount:0}}}})}]:[],querySelector:selector=>selector==='meta[name="user-login"]'?{getAttribute:()=> 'reviewer'}:selector.startsWith('table[')?{}:selector.includes('ref-picker')?{textContent:'main'}:null});
   context={URL,AbortController,TextEncoder,TextDecoder,setTimeout,clearTimeout,location:new URL(h.tabs.get(target.tabId).url),document:documentFor(false),DOMParser:class{parseFromString(html){return documentFor(html==='pinned');}},chrome:{runtime:{id:'ours',onMessage:{addListener(fn){context.listener=fn;}}}},fetch:async(url,init)=>{
    requests.push(url);assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    const atom=url.endsWith('.atom'),html=url.endsWith('/commits/main/'),pinned=url.endsWith('/tree/'+sha),response=new Response(atom?'Not Found':html?'<script type="application/json">'+JSON.stringify(branch)+'</script>':pinned?'pinned':'root',{status:atom?404:200,headers:{'content-type':'text/html'}});Object.defineProperty(response,'url',{value:url});return response;
   }};vm.createContext(context);contexts.set(target.tabId,context);
  }
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
 };
 await h.transport.invoke({repository:'owner/repo',action:'prepare-create',title:'Review',body:'Draft'});assert.equal(h.tabs.get(1).url,'https://github.com/owner/repo/issues/new');
 const context=contexts.get(1),reply=await new Promise(resolve=>{if(!context.listener({type:'github-session-read',repository:'owner/repo',ref:'HEAD',action:'policy'},{id:'ours'},resolve))resolve(null);});
 assert.equal(reply?.ok,true);assert.equal(reply.result.source,'default');assert.equal(reply.result.sha,sha);assert.equal(reply.result.account,'reviewer');
 assert.deepEqual(requests,['https://github.com/owner/repo','https://github.com/owner/repo/commits/main.atom','https://github.com/owner/repo/commits/main/','https://github.com/owner/repo/tree/'+sha]);
 assert.equal(h.calls.filter(call=>call[0]==='message'&&['commit','commit-create'].includes(call[2])).length,0);
});

test('activeTab lease never restores over a user navigation to another repository',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7};h.api.permissions.contains=async()=>false;
 const draft=await h.transport.invoke({...message,action:'prepare'});h.tabs.get(1).url='https://github.com/other/repo';
 await assert.rejects(h.transport.invoke({...message,action:'verify',ticket:draft.ticket}));assert.equal(h.tabs.get(1).url,'https://github.com/other/repo');
 assert.equal(h.calls.filter(n=>n[0]==='update').length,1);
});
test('confirmed sends do not close an owned helper after the user navigates it elsewhere',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7},original=h.api.tabs.sendMessage;
 h.api.tabs.sendMessage=async(id,value)=>{const result=await original(id,value);if(value.action==='commit')h.tabs.get(id).url='https://github.com/other/repo';return result;};
 const draft=await h.transport.invoke({...message,action:'prepare'});await h.transport.invoke({...message,action:'verify',ticket:draft.ticket});await h.transport.invoke({...message,action:'commit',ticket:draft.ticket});
 assert.deepEqual(h.removed,[]);assert.equal(h.tabs.get(2).url,'https://github.com/other/repo');
});
test('activeTab preflight protects existing drafts and concurrent sends cannot acquire the same tab',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7};h.api.permissions.contains=async()=>false;
 const native=h.api.tabs.sendMessage;h.api.tabs.sendMessage=async(id,value)=>value.action==='lease-inspect'?{ok:true,result:{safeToNavigate:false}}:native(id,value);
 await assert.rejects(h.transport.invoke({...message,action:'prepare'}),/drafts/);assert.equal(h.calls.filter(n=>n[0]==='update').length,0);
 h.api.tabs.sendMessage=native;
 let unlock,started;const gate=new Promise(resolve=>unlock=resolve),entered=new Promise(resolve=>started=resolve);let first=true;
 h.api.scripting.executeScript=async()=>{if(first){first=false;started();await gate;}};
 const one=h.transport.invoke({...message,action:'prepare'});await entered;
 await assert.rejects(h.transport.invoke({...message,number:8,action:'prepare'}),/Wait/);unlock();await one;
 assert.equal(h.calls.filter(n=>n[0]==='update').length,1);
});
test('failed lease setup releases its mutex and quarantines an uncertain issue instead of navigating it away',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',number:7};h.api.permissions.contains=async()=>false;h.sessions.remember=async()=>{throw Error('session write failed');};
 const original=h.tabs.get(1).url;await assert.rejects(h.transport.invoke({...message,action:'prepare'}),/session write failed/);
 h.sessions.remember=async()=>{};await assert.rejects(h.transport.invoke({...message,number:8,action:'prepare'}),/drafts/);assert.equal(h.calls.filter(n=>n[0]==='update').length,1);
 h.tabs.get(1).url=original;await h.transport.invoke({...message,action:'prepare'});assert.equal(h.calls.filter(n=>n[0]==='update').length,2);
});
test('new-Issue helper confirms redirected title, raw marked body and account before success',async()=>{
 const h=tabHarness(),message={repository:'owner/repo',title:'Review title',body:'Marked review'};
 h.api.tabs.sendMessage=async(id,value)=>{
  h.calls.push(['message',id,value.action]);
  if(value.action==='prepare-create')return {ok:true,result:{ticket:'new-ticket',repository:'owner/repo',account:'reviewer'}};
  if(value.action==='verify-create')return {ok:true,result:{verified:true,account:'reviewer'}};
  if(value.action==='commit-create'){h.tabs.get(id).url='https://github.com/owner/repo/issues/8';return {ok:true,result:{attempted:true}};}
  return {ok:true,result:{kind:'issue',number:8,title:message.title,body:message.body,author:'reviewer',account:'reviewer',url:'https://github.com/owner/repo/issues/8',createdAt:'2026-11-10T00:00:00Z'}};
 };
 const draft=await h.transport.invoke({...message,action:'prepare-create'});
 await h.transport.invoke({repository:message.repository,ticket:draft.ticket,action:'verify-create'});
 const result=await h.transport.invoke({repository:message.repository,ticket:draft.ticket,action:'commit-create'});
 assert.equal(result.number,8);assert.equal(result.title,message.title);assert.deepEqual(h.removed,[2]);assert.equal(h.calls.filter(n=>n[2]==='commit-create').length,1);
});
test('new-Issue publication persists pending before clicking and blocks uncertain duplicate creation',async()=>{
 const data={},calls=[];let uncertain=true;
 const transport=api.create({crypto:webcrypto,assertWrites:async()=>{},reserve:async()=>{},storage:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},call:async message=>{
  calls.push(message);
  if(message.action==='list')return {account:'reviewer'};
  if(message.action==='prepare-create')return {ticket:'new-ticket',repository:'owner/repo',account:'reviewer'};
  if(message.action==='verify-create')return {verified:true,account:'reviewer'};
  assert.equal(Object.values(data)[0].status,'pending');if(uncertain)throw Error('no readback');
  return {kind:'issue',number:8,title:'Review title',author:'reviewer',url:'https://github.com/owner/repo/issues/8',createdAt:'2026-11-10T00:00:00Z'};
 }});
 const value={repository:'owner/repo',title:'Review title',body:'Review body',clientMutationId:'12345678-1234-1234-1234-123456789abc',confirmedSend:true};
 await assert.rejects(transport.createIssue(value),/not confirmed/);uncertain=false;
 await assert.rejects(transport.createIssue(value),/unconfirmed outcome/);assert.equal(calls.filter(n=>n.action==='commit-create').length,1);
});
test('new conversation helper preserves explicit pre-click rejection without polling or closing its draft',async()=>{
 for(const kind of ['issue','discussion']){
  const h=tabHarness();let waits=0;
  const transport=api.createTabTransport({api:h.api,sessions:h.sessions,delay:async()=>{waits++;}});
  h.api.tabs.sendMessage=async(id,value)=>value.action==='prepare-create'?{ok:true,result:{ticket:'ticket',repository:'owner/repo',account:'reviewer'}}:{ok:false,code:'WEBSITE_REVIEW_UNAVAILABLE',error:'GitHub draft changed. Nothing sent.'};
  const request={repository:'owner/repo',kind,category:'general',title:'Review',body:'Text'};
  await transport.invoke({...request,action:'prepare-create'});
  await assert.rejects(transport.invoke({repository:request.repository,kind,ticket:'ticket',action:'commit-create'}),error=>error.code==='WEBSITE_REVIEW_UNAVAILABLE'&&/draft changed/.test(error.message));
  assert.equal(waits,0);assert.deepEqual(h.removed,[]);
 }
});

test('binding lost after Create retains pending receipt across adapter restart and cannot create twice',async()=>{
 for(const kind of ['issue','discussion']){
  const h=tabHarness(),data={};let clicks=0;
  h.api.tabs.sendMessage=async(id,value)=>{
   if(value.action==='categories')return {ok:true,result:{categories:[{id:'general'}],account:'reviewer'}};
   if(value.action==='list')return {ok:true,result:{account:'reviewer',threads:[]}};
   if(value.action==='prepare-create')return {ok:true,result:{ticket:'ticket',repository:'owner/repo',account:'reviewer'}};
   if(value.action==='verify-create')return {ok:true,result:{verified:true,account:'reviewer'}};
   if(value.action==='commit-create'){clicks++;h.tabs.get(id).url='https://github.com/owner/repo/'+(kind==='issue'?'issues':'discussions')+'/8';h.bound=false;return {ok:true,result:{attempted:true,account:'reviewer'}};}
   throw Error('Unexpected action '+value.action);
  };
  const options={crypto:webcrypto,assertWrites:async()=>{},reserve:async()=>{},storage:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},call:value=>h.transport.invoke(value)};
  let adapter=api.create(options);const request={repository:'owner/repo',kind,categoryId:'general',title:'Review title',body:'Review body',clientMutationId:message.clientMutationId,confirmedSend:true};
  await assert.rejects(adapter.createIssue(request),/attempted.*not confirmed/);
  assert.equal(clicks,1);assert.equal(Object.values(data)[0].status,'pending');
  h.bound=true;adapter=api.create(options);
  await assert.rejects(adapter.createIssue(request),/unconfirmed outcome/);assert.equal(clicks,1);
 }
});
test('only confirmed pre-click failures allow a later explicit retry for comments and new conversations',async()=>{
 for(const newThread of [false,true])for(const kind of ['issue','discussion'])for(const receiptFails of [false,true]){
  const data={},calls=[];let reject=true;
  const options={crypto:webcrypto,assertWrites:async()=>{},reserve:async()=>{},storage:{get:async key=>({[key]:data[key]}),set:async value=>{if(receiptFails&&Object.values(value)[0].status==='not-sent')throw Error('Storage failed');Object.assign(data,value);}},call:async request=>{
   calls.push(request.action);
   if(request.action==='categories')return {categories:[{id:'general'}]};
   if(request.action==='list')return {account:'reviewer'};
   if(request.action==='read')return {account:'reviewer',capabilities:{create:true},comments:[]};
   if(request.action.startsWith('prepare'))return {ticket:'ticket',repository:'owner/repo',number:1,account:'reviewer'};
   if(request.action.startsWith('verify'))return {verified:true,account:'reviewer'};
   if(reject)throw Object.assign(Error('GitHub draft changed. Nothing sent.'),{code:'WEBSITE_REVIEW_UNAVAILABLE'});
   return {kind,number:1,title:'Title',author:'reviewer',url:'https://github.com/owner/repo/'+(kind==='issue'?'issues':'discussions')+'/1'+(newThread?'':kind==='issue'?'#issuecomment-123':'#discussioncomment-123')};
  }};
  let transport=api.create(options);const request={...message,kind,title:'Title',categoryId:'general'},publish=()=>newThread?transport.createIssue(request):transport.send(request);
  await assert.rejects(publish(),/draft changed/);assert.equal(Object.values(data)[0].status,receiptFails?'pending':'not-sent');assert.equal(calls.filter(n=>n.startsWith('commit')).length,1);
  // A worker restart must retain the known failure, without making a retry itself.
  reject=false;transport=api.create(options);
  if(receiptFails){await assert.rejects(publish(),/unconfirmed outcome/);assert.equal(calls.filter(n=>n.startsWith('commit')).length,1);}
  else {await publish();assert.equal(Object.values(data)[0].status,'done');assert.equal(calls.filter(n=>n.startsWith('commit')).length,2);}
 }
});
test('screenshot Send requires a native GitHub asset result and updates annotation metadata before commit',async()=>{
 const comments=require('../review-comments.js'),data={},calls=[],id='12345678-1234-1234-1234-123456789abc',repository='owner/repo',url='https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc';
 const annotation={id,text:'Image review',threadType:'issue',createdAt:'2026-11-10T00:00:00Z',anchor:{repository,ref:'main',file:'board.kicad_pcb'},capture:{mime:'image/png',width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII='}};
 const attachment={provider:'github',repository,mime:'image/png',url,width:1,height:1};
 const transport=api.create({comments,crypto:webcrypto,assertWrites:async()=>{},reserve:async()=>{},storage:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},call:async message=>{
  calls.push(message);
  if(message.action==='read')return {account:'reviewer',capabilities:{create:true},comments:[]};
  if(message.action==='prepare'){assert.deepEqual(message.capture,annotation.capture);return {account:'reviewer',repository,number:1,ticket:'image-ticket',attachment};}
  if(message.action==='update-prepared'){const parsed=comments.fromMarkdown(message.body);assert.equal(parsed[0].attachments[0].url,url);assert.doesNotMatch(message.body,/attach it manually/);return {updated:true,account:'reviewer'};}
  if(message.action==='verify')return {verified:true,account:'reviewer'};
  assert.equal(Object.values(data)[0].status,'pending');assert.equal(Object.values(data)[0].attachments[0].url,url);
  return {provider:'github',kind:'issue',number:1,author:'reviewer',messageId:'123',url:'https://github.com/owner/repo/issues/1#issuecomment-123',createdAt:'2026-11-10T00:00:00Z'};
 }});
 const {capture,...metadata}=annotation,result=await transport.send({repository,number:1,body:comments.toMarkdown(metadata),annotation,clientMutationId:id,confirmedSend:true});
 assert.equal(result.attachments[0].url,url);assert.deepEqual(calls.map(n=>n.action),['read','prepare','update-prepared','verify','commit']);
});
test('browser-session Discussion comments use their own cache, routes and quoted reply target',async()=>{
 const comments=require('../review-comments.js'),data={},calls=[],transport=api.create({comments,crypto:webcrypto,assertWrites:async()=>{},reserve:async()=>{},storage:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},call:async message=>{
  calls.push(message);assert.equal(message.kind,'discussion');
  if(message.action==='read')return {account:'reviewer',capabilities:{create:true},comments:[{id:'55',author:'colleague',url:'https://github.com/owner/repo/discussions/8#discussioncomment-55',body:'Earlier message'}]};
  if(message.action==='prepare')return {ticket:'discussion-ticket',account:'reviewer',repository:'owner/repo',number:8};
  if(message.action==='verify')return {verified:true,account:'reviewer'};
  return {kind:'discussion',number:8,messageId:'56',author:'reviewer',url:'https://github.com/owner/repo/discussions/8#discussioncomment-56',createdAt:'2026-11-10T06:00:00Z'};
 }});
 const result=await transport.chat({repository:'owner/repo',ref:'main',file:'board.kicad_pcb',thread:{kind:'discussion',number:8},action:'reply',replyTo:'55',body:'Reply',clientMutationId:'12345678-1234-1234-1234-123456789abc',confirmedSend:true});
 assert.equal(result.kind,'discussion');assert.match(calls.find(n=>n.action==='prepare').body,/Reply to \[colleague\].*discussioncomment-55/);
});
test('new Discussion requires a verified native category and confirms the correct conversation kind',async()=>{
 const data={},calls=[],transport=api.create({crypto:webcrypto,assertWrites:async()=>{},reserve:async()=>{},storage:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},call:async message=>{
  calls.push(message);assert.equal(message.kind,'discussion');
  if(message.action==='categories')return {categories:[{id:'general',name:'General'}]};
  if(message.action==='list')return {account:'reviewer'};
  if(message.action==='prepare-create'){assert.equal(message.category,'general');return {ticket:'new-discussion',repository:'owner/repo',account:'reviewer'};}
  if(message.action==='verify-create')return {verified:true,account:'reviewer'};
  return {kind:'discussion',number:8,title:'QA Discussion',author:'reviewer',url:'https://github.com/owner/repo/discussions/8',createdAt:'2026-11-10T06:00:00Z'};
 }});
 const request={repository:'owner/repo',kind:'discussion',categoryId:'general',title:'QA Discussion',body:'Review body',clientMutationId:'12345678-1234-1234-1234-123456789abc',confirmedSend:true};
 await assert.rejects(transport.createIssue({...request,categoryId:'polls'}),/supported Discussion category/);const result=await transport.createIssue(request);assert.equal(result.kind,'discussion');assert.equal(calls.filter(n=>n.action==='commit-create').length,1);
});
test('failed pending persistence and policy revocation after persistence cause zero commits',async()=>{
 for(const options of [{pendingFails:true},{revokeAfterPending:true}]){const h=harness(options);await assert.rejects(h.transport.send(message));assert.equal(h.calls.filter(n=>n.action==='commit').length,0);}
});
test('pending publication can recover a newly confirmed matching marker without a second click',async()=>{
 const h=harness({commitFails:true});await assert.rejects(h.transport.send(message));
 const body=h.calls.find(n=>n.action==='prepare').body;h.thread.comments.push({id:'123',author:'reviewer',body,url:'https://github.com/owner/repo/issues/1#issuecomment-123',createdAt:'2026-11-04T06:00:00Z',updatedAt:'2026-11-04T06:00:00Z'});
 const result=await h.transport.send(message);assert.equal(result.recovered,true);assert.equal(h.calls.filter(n=>n.action==='commit').length,1);
});

function recoveryHarness({newThread=false,kind='issue',assertPolicy=async()=>{}}={}){
 const data={},calls=[],number=8,repository='owner/repo',title='Original title',body='Original review',clientMutationId=message.clientMutationId;
 const thread={kind,number,account:'reviewer',author:'reviewer',title,body:'',url:`https://github.com/${repository}/${kind==='issue'?'issues':'discussions'}/${number}`,createdAt:'2026-11-10T00:00:00Z',updatedAt:'2026-11-10T00:00:00Z',capabilities:{create:true},comments:[]};
 const storage={get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)};
 const call=async value=>{calls.push(value);if(value.action==='read')return thread;if(value.action==='list')return {account:'reviewer'};if(value.action==='categories')return {categories:[{id:'general'}]};if(value.action.startsWith('prepare'))return {repository,number:newThread?undefined:number,account:'reviewer',ticket:'ticket'};if(value.action.startsWith('verify'))return {verified:true,account:'reviewer'};throw Error('Lost acceptance response');};
 const transport=api.create({crypto:webcrypto,assertWrites:async()=>{},assertPolicy,reserve:async()=>{},storage,call});
 const request={repository,number,kind,title,body,categoryId:'general',clientMutationId,confirmedSend:true};
 return {data,calls,thread,request,transport,publish:()=>newThread?transport.createIssue(request):transport.send(request),recover:{repository,kind,clientMutationId,number:newThread?undefined:number,recoveryNumber:number,newThread},restart:()=>api.create({crypto:webcrypto,storage,call,assertPolicy:async()=>{throw Error('Recovery must not check current write policy');}}),accept(){const saved=Object.values(data)[0];if(newThread)thread.body=saved.body;else thread.comments=[{id:'123',author:'reviewer',body:saved.body,url:thread.url+(kind==='issue'?'#issuecomment-123':'#discussioncomment-123'),createdAt:thread.createdAt,updatedAt:thread.updatedAt}];}};
}

test('read-only recovery survives worker restart and preserves original text receipt without another send',async()=>{
 const h=recoveryHarness();await assert.rejects(h.publish(),/not confirmed/);const pending=Object.values(h.data)[0];assert.equal(pending.account,'reviewer');assert.match(pending.body,/Original review/);h.accept();
 const before=h.calls.length,recovered=await h.restart().recoverPublication(h.recover);assert.equal(recovered.recovered,true);assert.equal(recovered.messageId,'123');assert.deepEqual(h.calls.slice(before).map(value=>value.action),['read']);assert.equal(Object.values(h.data)[0].status,'done');
 const again=await h.restart().recoverPublication(h.recover);assert.equal(again.duplicate,true);assert.equal(h.calls.filter(value=>value.action==='commit').length,1);
 h.thread.account='someone-else';await assert.rejects(h.restart().recoverPublication(h.recover),/account that attempted/);
});

test('pending recovery rejects account, body, duplicate matches and mismatched conversation without posting',async()=>{
 const h=recoveryHarness({kind:'discussion'});await assert.rejects(h.publish());h.accept();const transport=h.restart(),original={...h.thread.comments[0]};
 h.thread.account='other';await assert.rejects(transport.recoverPublication(h.recover),/account that attempted/);h.thread.account='reviewer';
 h.thread.comments[0].body='Changed remotely';await assert.rejects(transport.recoverPublication(h.recover),/No exact matching/);
 h.thread.comments=[original,{...original,id:'124',url:h.thread.url+'#discussioncomment-124'}];await assert.rejects(transport.recoverPublication(h.recover),/Multiple matching/);
 h.thread.comments=[{...original,url:'https://github.com/other/repo/discussions/8#discussioncomment-123'}];await assert.rejects(transport.recoverPublication(h.recover),/matching website conversation/);
 await assert.rejects(transport.recoverPublication({...h.recover,recoveryNumber:9}),/original website conversation/);
 await assert.rejects(transport.recoverPublication({...h.recover,repository:'other/repo'}),/No recoverable/);
 assert.equal(Object.values(h.data)[0].status,'pending');assert.equal(h.calls.filter(value=>value.action==='commit').length,1);
});

test('known-number recovery confirms uncertain new Issues and Discussions by exact original title, body and author',async()=>{
 for(const kind of ['issue','discussion']){
  const h=recoveryHarness({newThread:true,kind});await assert.rejects(h.publish(),/not confirmed/);assert.equal(Object.values(h.data)[0].title,'Original title');h.accept();const transport=h.restart();
  h.thread.title='Different title';await assert.rejects(transport.recoverPublication(h.recover),/No exact matching/);h.thread.title='Original title';
  h.thread.author='other';await assert.rejects(transport.recoverPublication(h.recover),/No exact matching/);h.thread.author='reviewer';
  h.thread.body+=' Changed';await assert.rejects(transport.recoverPublication(h.recover),/No exact matching/);h.accept();
  await assert.rejects(transport.recoverPublication({...h.recover,recoveryNumber:9}),/matching website conversation/);
  const result=await transport.recoverPublication(h.recover);assert.equal(result.kind,kind);assert.equal(result.number,8);assert.equal(result.title,'Original title');assert.equal(result.recovered,true);assert.equal(h.calls.filter(value=>value.action==='commit-create').length,1);
 }
});

test('policy revocation during preparation blocks both comment and new-conversation commits',async()=>{
 for(const newThread of [false,true]){
  let checks=0;const h=recoveryHarness({newThread,assertPolicy:async(repository,account)=>{assert.equal(repository,'owner/repo');assert.equal(account,'reviewer');if(++checks===2)throw Error('Repository policy revoked');}});
  await assert.rejects(h.publish(),/policy revoked/);assert.equal(checks,2);assert.equal(h.calls.some(value=>value.action.startsWith('commit')),false);assert.deepEqual(h.data,{});
 }
});
