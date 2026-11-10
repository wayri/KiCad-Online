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
function tabHarness(){
 const tabs=new Map([[1,{id:1,url:'https://github.com/owner/repo/tree/main',status:'complete'}]]),calls=[],removed=[];let next=2,bound=true,failCommit=false;
 const session={candidates:async()=>bound?[{id:1,bound:true}]:[],remember:async()=>{},recover:async(id)=>{calls.push(['recover',id]);return true;}};
 const chrome={permissions:{contains:async()=>true},tabs:{get:async id=>{if(!tabs.has(id))throw Error('closed');return {...tabs.get(id)};},create:async args=>{calls.push(['create',args]);const tab={...args,id:next++,status:'complete'};tabs.set(tab.id,tab);return {...tab};},update:async(id,args)=>{calls.push(['update',id,args]);Object.assign(tabs.get(id),args);return {...tabs.get(id)};},remove:async id=>{removed.push(id);tabs.delete(id);},sendMessage:async(id,message)=>{calls.push(['message',id,message.action]);if(message.action==='lease-inspect')return {ok:true,result:{safeToNavigate:true}};if(message.action==='commit'&&failCommit)throw Error('port closed');return {ok:true,result:message.action==='prepare'?{ticket:'ticket-'+id,repository:message.repository,number:message.number,account:'reviewer'}:message.action==='verify'?{verified:true,account:'reviewer'}:{messageId:'123',account:'reviewer'}};}},scripting:{executeScript:async value=>calls.push(['install',value.target.tabId])}};
 return {tabs,calls,removed,api:chrome,sessions:session,transport:api.createTabTransport({api:chrome,sessions:session,assertWrites:async()=>{},delay:async()=>{}}),set bound(value){bound=value;},set failCommit(value){failCommit=value;}};
}
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
