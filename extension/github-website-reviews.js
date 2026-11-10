/* Worker-side website reviews: bounded reads, explicit writes, durable receipts.
 * Transport only returns normalized data; no website credentials are received. */
((root)=>{'use strict';
 function createTabTransport({api,sessions,assertWrites=async()=>{},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now()}={}){
  const tickets=new Map(),helpers=new Set(),leased=new Set(),quarantined=new Map(),host='https://github.com';
  function matching(tab,repository,number,newIssue=false,kind='issue',category){try{const url=new URL(tab.url);return url.origin===host&&!url.username&&!url.password&&url.pathname.toLowerCase()==='/'+repository.toLowerCase()+'/'+(kind==='discussion'?'discussions':'issues')+'/'+(newIssue?'new':number)&&(newIssue&&kind==='discussion'?url.searchParams.size===1&&url.searchParams.get('category')===category:!url.search);}catch{return false;}}
  async function liveBindings(repository){const result=[];for(const candidate of (await sessions.candidates('github',host,repository)).filter(n=>n.bound)){
   try{const tab=await api.tabs.get(candidate.id),url=new URL(tab.url);if(quarantined.has(tab.id)&&quarantined.get(tab.id)!==tab.url)quarantined.delete(tab.id);if(url.origin===host&&!url.username&&!url.password&&(url.pathname.toLowerCase()==='/'+repository.toLowerCase()||url.pathname.toLowerCase().startsWith('/'+repository.toLowerCase()+'/')))result.push(tab);}catch{}
  }return result;}
  async function install(tabId){await api.scripting.executeScript({target:{tabId,frameIds:[0]},files:['github-session-review.js','repository-session-bridge.js']});}
  async function send(tabId,message){return api.tabs.sendMessage(tabId,{...message,type:'github-session-review'},{frameId:0}).catch(()=>null);}
  async function finish(ticket,confirmed){
   if(ticket.owned){if(confirmed){try{const tab=await api.tabs.get(ticket.tabId);if(matching(tab,ticket.repository,ticket.number,ticket.newIssue,ticket.kind,ticket.category))await api.tabs.remove(ticket.tabId);}catch{}helpers.delete(ticket.tabId);}}
   else {
    // Restore only our unchanged helper destination. A user navigation wins.
    try{const tab=await api.tabs.get(ticket.tabId);if(confirmed&&ticket.originalUrl){if(matching(tab,ticket.repository,ticket.number,ticket.newIssue,ticket.kind,ticket.category)&&tab.url!==ticket.originalUrl)await api.tabs.update(ticket.tabId,{url:ticket.originalUrl,active:false});quarantined.delete(ticket.tabId);}else if(tab.url!==ticket.originalUrl&&new URL(tab.url).origin===host&&new URL(tab.url).pathname.toLowerCase().startsWith('/'+ticket.repository.toLowerCase()+'/'+(ticket.kind==='discussion'?'discussions':'issues')+'/'))quarantined.set(ticket.tabId,tab.url);}catch{}finally{leased.delete(ticket.tabId);}
   }
  }
  async function invoke(message){
   const mutation=['prepare','verify','commit','prepare-create','verify-create','commit-create','update-prepared'].includes(message.action),newIssue=message.action.endsWith('-create'),kind=message.kind||'issue';if(!['issue','discussion'].includes(kind))throw Error('Unsupported website conversation type.');
   if(mutation)await assertWrites();
   for(const [key,value] of tickets)if(value.expires<now()){tickets.delete(key);await finish(value,false);}
   let bound=await liveBindings(message.repository);
   if(!bound.length){const ticket=tickets.get(message.ticket);if(ticket){tickets.delete(message.ticket);await finish(ticket,false);}throw Error('The repository website session is no longer available. Reopen this repository and invoke the extension; no API account was used.');}
   if(!mutation){bound=bound.filter(tab=>!leased.has(tab.id)&&!helpers.has(tab.id));if(!bound.length)throw Error('A comment send is using the repository session. Its readback will refresh when the send finishes.');}
   if(['verify','commit','verify-create','commit-create','update-prepared'].includes(message.action)){
    const ticket=tickets.get(message.ticket);if(!ticket||ticket.repository!==message.repository||ticket.number!==message.number||ticket.kind!==kind)throw Error('Website review send expired. Reload the conversation before sending.');
    try{
    const tab=await api.tabs.get(ticket.tabId);if(!matching(tab,message.repository,message.number,ticket.newIssue,kind,ticket.category)){tickets.delete(message.ticket);await finish(ticket,false);throw Error('The review helper changed repository or conversation. Nothing sent.');}
    const reply=await send(tab.id,message);if(['commit','commit-create'].includes(message.action))tickets.delete(message.ticket);
    if(message.action==='commit-create'){
     // Clicking Create navigates GitHub's own page. A lost response is not a
     // reason to click again: confirm only the exact marked issue after navigation.
     for(let i=0;i<100;i++){
      await delay(200);const current=await api.tabs.get(tab.id);let number;try{number=Number(new URL(current.url).pathname.split('/')[4]);}catch{}
      if(!Number.isSafeInteger(number)||number<1||!matching(current,message.repository,number,false,kind)||current.status!=='complete')continue;
      await install(tab.id);const read=await send(tab.id,{repository:message.repository,number,kind,action:'read'}),thread=read?.result;
      if(read?.ok&&thread.title===ticket.title&&thread.body===ticket.body&&thread.account===ticket.account&&thread.author===ticket.account){await finish({...ticket,number,newIssue:false},true);return {provider:'github',kind,number,author:thread.author,title:thread.title,messageId:String(number),url:thread.url,createdAt:thread.createdAt,updatedAt:thread.updatedAt,transport:'website-session'};}
      break;
     }
     await finish(ticket,false);throw Error('Issue creation was attempted but not confirmed. Inspect the GitHub helper before retrying; no automatic second Create was sent.');
    }
    if(!reply?.ok){if(message.action==='commit')await finish(ticket,false);throw Error(reply?.error||'GitHub website did not confirm the review operation. Inspect its issue before retrying.');}
    if(message.action==='update-prepared'){ticket.body=message.body;ticket.expires=now()+30000;}
    if(message.action==='commit')await finish(ticket,true);
    return reply.result;
    }catch(error){tickets.delete(message.ticket);await finish(ticket,false);throw error;}
   }
   if(['prepare','prepare-create'].includes(message.action)){
    // Explicit Send uses a scoped helper, or briefly leases a clean authorized
    // repository tab when activeTab is the only available permission.
    if(tickets.size>=8)throw Error('Wait for the existing review sends before opening another.');
    // Never overwrite another draft in the user's already-open Issue tab, and
    // never replace another send's in-page ticket by reinjecting its module.
    for(const id of helpers)try{await api.tabs.get(id);}catch{helpers.delete(id);}
    if(helpers.size>=8)throw Error('Inspect or close the existing GitHub review helper tabs before sending again.');
    let tab,owned=false,originalUrl,context;
    try{
    if(kind==='discussion'&&newIssue&&(typeof message.category!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(message.category)||message.category==='polls'))throw Error('Choose a supported existing Discussion category.');
    const destination=host+'/'+message.repository+'/'+(kind==='discussion'?'discussions':'issues')+'/'+(newIssue?'new':message.number)+(kind==='discussion'&&newIssue?'?category='+message.category:''),hostGranted=await api.permissions?.contains?.({origins:[host+'/*']}).catch(()=>false);
    if(hostGranted){owned=true;tab=await api.tabs.create({url:destination,active:false});helpers.add(tab.id);context={tabId:tab.id,owned,repository:message.repository,number:message.number,kind,category:message.category,newIssue,title:message.title,body:message.body};}
    else {
     for(const candidate of bound){
      if(leased.has(candidate.id)||helpers.has(candidate.id)||quarantined.has(candidate.id))continue;leased.add(candidate.id);
      try{await install(candidate.id);const inspected=await send(candidate.id,{repository:message.repository,action:'lease-inspect'}),current=await api.tabs.get(candidate.id);
       if(inspected?.ok&&inspected.result?.safeToNavigate===true&&current.url===candidate.url){tab=current;break;}
      }catch{}leased.delete(candidate.id);
     }
     if(!tab)throw Error(bound.some(item=>leased.has(item.id))?'Wait for the existing comment send in this repository tab.':'Keep existing GitHub drafts and editors open. Open a clean tab for this repository and invoke the extension before sending. Nothing was overwritten.');
     originalUrl=tab.url;context={tabId:tab.id,owned,originalUrl,repository:message.repository,number:message.number,kind,category:message.category,newIssue,title:message.title,body:message.body};tab=await api.tabs.update(tab.id,{url:destination,active:false});
    }
    {
     for(let i=0;i<100;i++){const current=await api.tabs.get(tab.id);if(current.status==='complete'){tab=current;break;}await delay(100);}
     if(tab.status!=='complete'||!matching(tab,message.repository,message.number,newIssue,kind,message.category)){leased.delete(tab.id);throw Error('GitHub requires sign-in, SSO or another action in the review helper. No comment was sent.');}
     await sessions.remember(tab,{provider:'github',host,repository:message.repository});
    }
    await install(tab.id);await assertWrites();const reply=await send(tab.id,message);if(!reply?.ok)throw Error(reply?.error||'GitHub did not prepare the review draft. Nothing sent.');if(typeof reply.result?.ticket!=='string')throw Error('GitHub did not confirm the review draft. Nothing sent.');tickets.set(reply.result.ticket,{...context,body:reply.result.body||message.body,account:reply.result.account,expires:now()+30000});return reply.result;
    }catch(error){if(context)await finish(context,false);throw error;}
   }
   let failure;
   for(const tab of bound){
    let reply=await send(tab.id,message);
    // Updating an extension invalidates already-open content-script channels.
    // Repair only the exact user-bound repository, and never retry a mutation.
    if(!reply&&await sessions.recover(tab.id,'github',host,message.repository))reply=await send(tab.id,message);
    if(reply?.ok)return reply.result;if(typeof reply?.error==='string')failure=reply.error.slice(0,500);
   }
   throw Error(failure||'Open this repository on GitHub and invoke the extension to reconnect its website session.');
  }
  return {invoke};
 }
 function create({call,storage,assertWrites,reserve,comments,crypto=root.crypto,now=()=>Date.now()}={}){
  const locks=new Map(),cache=new Map(),confirmed=new Map(),catalogs=new Map(),scans=new Map();
  const key=(repository,number,kind='issue')=>JSON.stringify(kind==='issue'?[repository.toLowerCase(),number]:[repository.toLowerCase(),kind,number]),catalogKey=(repository,kind='issue')=>repository.toLowerCase()+(kind==='discussion'?':discussion':'');
  async function snapshot(store,id,ttl,load){
   const old=store.get(id);if(old&&(old.pending||now()-old.at<ttl))return old.promise;
   const entry={at:now(),pending:true,promise:Promise.resolve().then(load)};store.set(id,entry);
   if(store.size>16)store.delete(store.keys().next().value);
   try{return await entry.promise;}catch(error){if(store.get(id)===entry)store.delete(id);throw error;}finally{entry.pending=false;entry.at=now();}
  }
  function list(repository,kind='issue'){return snapshot(catalogs,catalogKey(repository,kind),5000,()=>call({repository,kind,action:'list'}));}
  async function categories(repository){return (await call({repository,action:'categories',kind:'discussion'})).categories;}
  async function annotations(value,{repository,number,kind='issue'}={}){
   const scope=comments.normalizeScope(value);if(scope.repository!==repository)throw Error('Review annotation repository does not match.');
   let threads,warnings=[],coverage;
   if(Number.isSafeInteger(number)&&number>0){threads=[await read(repository,number,false,kind)];coverage={kind:'thread',url:threads[0].url};}
   else {
    const scan=await snapshot(scans,repository.toLowerCase(),5000,async()=>{
     const outcomes=await Promise.allSettled(['issue','discussion'].map(kind=>list(repository,kind))),accepted=outcomes.filter(n=>n.status==='fulfilled').map(n=>n.value),result=[],messages=accepted.flatMap(n=>n.warnings||[]);
     if(!accepted.length)throw outcomes[0].reason;
     if(outcomes.some(n=>n.status==='rejected'))messages.push('Incomplete annotation coverage: a conversation catalogue is unavailable. Existing drawing markers are retained.');
     const issues=(accepted[0]?.threads||[]).filter(n=>n.kind==='issue'),discussions=accepted.flatMap(n=>n.threads||[]).filter(n=>n.kind==='discussion'),rows=[];
     for(let i=0;i<Math.max(issues.length,discussions.length);i++){if(issues[i])rows.push(issues[i]);if(discussions[i])rows.push(discussions[i]);}
     const selected=[...new Map(rows.filter(n=>Number.isSafeInteger(n.number)&&n.number>0).map(n=>[n.kind+':'+n.number,n])).values()].slice(0,8);
     if(messages.length)messages.push('Incomplete annotation coverage: website listings may omit other conversations. Existing drawing markers are retained.');
     if(rows.length>8||accepted.some(n=>n.hasMore))messages.push('Incomplete annotation scan: first 8 listed conversations only. Open a conversation to read its remaining drawing comments.');
     for(const row of selected){try{const thread=await read(repository,row.number,false,row.kind);result.push(thread);messages.push(...(thread.warnings||[]));}catch{messages.push('Incomplete annotation scan: a conversation could not be read through the website session.');}}
     return {threads:result,warnings:messages};
    });threads=scan.threads;warnings=scan.warnings;
   }
   const notes=comments.mergeAnnotations([],threads.flatMap(thread=>comments.threadAnnotations(thread,scope,{repository})));
   if(notes.length>500)warnings.push('Incomplete annotation coverage: first 500 drawing markers shown. Open the relevant Issue for its annotations.');
   return {notes:notes.slice(0,500),warnings:[...new Set([...warnings,...threads.flatMap(thread=>thread.warnings||[])])],...(coverage?{coverage}:{})};
  }
  async function read(repository,number,force=false,kind='issue'){
   const id=key(repository,number,kind),saved=cache.get(id);
   if(!force&&saved&&now()-saved.at<2000)return saved.promise;
   const promise=call({repository,number,kind,action:'read'});cache.set(id,{at:now(),promise});
   if(cache.size>32)cache.delete(cache.keys().next().value);
   try{return await promise;}catch(error){if(cache.get(id)?.promise===promise)cache.delete(id);throw error;}
  }
  async function finalizeCapture(prepared,{repository,number,kind='issue',annotation,clientMutationId,baseBody}){
   if(!annotation?.capture)return null;
   const note=comments.validateComment(annotation),attachment=comments.validateAttachment(prepared.attachment);
   if(note.id!==clientMutationId||note.anchor.repository!==repository||attachment.repository!==repository||attachment.width!==note.capture.width||attachment.height!==note.capture.height)throw Error('GitHub screenshot does not match this review draft. Nothing posted.');
   const {capture,...metadata}=note,attachments=[...(note.attachments||[]),attachment],original=comments.toMarkdown(metadata);
   if(typeof baseBody!=='string'||!baseBody.endsWith(original))throw Error('Screenshot review context changed. Nothing posted.');
   const body=baseBody.slice(0,baseBody.length-original.length)+comments.toMarkdown({...metadata,attachments})+'\n\n<!-- pocket-kiview-session:'+clientMutationId+' -->';
   if(new TextEncoder().encode(body).length>59000)throw Error('The image review message exceeds its text budget. Nothing posted.');
   const updated=await call({repository,number,kind,action:'update-prepared',ticket:prepared.ticket,body});
   if(updated?.updated!==true||updated.account!==prepared.account)throw Error('GitHub did not accept the final screenshot message. Nothing posted.');return {body,attachments};
  }
  async function send({repository,number,body,clientMutationId,confirmedSend,annotation,kind='issue'}){
   if(!['issue','discussion'].includes(kind))throw Error('Unsupported website conversation type.');
   if(confirmedSend!==true||typeof clientMutationId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(clientMutationId)||typeof body!=='string'||!body.trim()||new TextEncoder().encode(body).length>59000)throw Error('Explicit Send and a valid review message are required.');
   const operation='website-review:'+JSON.stringify(kind==='issue'?[repository.toLowerCase(),number,clientMutationId]:[repository.toLowerCase(),kind,number,clientMutationId]);
   if(locks.has(operation))throw Error('This message is already being sent.');
   const work=(async()=>{
    await assertWrites();
    const thread=await read(repository,number,true,kind);
    if(!thread.capabilities?.create||typeof thread.account!=='string')throw Error('GitHub website does not allow this comment.');
    const fingerprint=JSON.stringify([repository.toLowerCase(),number,body,thread.account,annotation?.capture||null,kind]);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint))),n=>n.toString(16).padStart(2,'0')).join('');
    let marked=body.replace(/\r\n?/g,'\n')+'\n\n<!-- pocket-kiview-session:'+clientMutationId+' -->';let attachments;
    const record=confirmed.get(operation)||(await storage.get(operation))[operation];
    if(record){
     if(record.digest!==digest)throw Error('This send ID belongs to a different message or website account.');
     if(record.status==='done')return {...record.result,duplicate:true};
     const matches=thread.comments.filter(n=>n.author===thread.account&&n.body===(record.body||marked));
     if(matches.length===1){const item=matches[0],result={provider:'github',kind,number,messageId:item.id,author:item.author,url:item.url,createdAt:item.createdAt,updatedAt:item.updatedAt,replyTo:null,transport:'website-session',recovered:true,...(record.attachments?{attachments:record.attachments}:{})};const receipt={status:'done',digest,result};confirmed.set(operation,receipt);try{await storage.set({[operation]:receipt});}catch{}return result;}
     throw Error('A previous Send has an unconfirmed outcome. Inspect GitHub before retrying; automatic resends are blocked.');
    }
    await reserve();
    const prepared=await call({repository,number,kind,action:'prepare',body:marked,...(annotation?.capture?{capture:annotation.capture}:{})});
    if(prepared.account!==thread.account||prepared.repository!==repository||prepared.number!==number||typeof prepared.ticket!=='string')throw Error('GitHub website account or draft changed. Nothing sent.');
    const captured=await finalizeCapture(prepared,{repository,number,kind,annotation,clientMutationId,baseBody:body});if(captured){marked=captured.body;attachments=captured.attachments;}
    const checked=await call({repository,number,kind,action:'verify',ticket:prepared.ticket});
    if(checked?.verified!==true||checked.account!==thread.account)throw Error('GitHub website account changed. Nothing sent.');
    await assertWrites();
    await storage.set({[operation]:{status:'pending',digest,...(attachments?{body:marked,attachments}:{}),startedAt:new Date(now()).toISOString()}});
    await assertWrites();
    let result;
    try{result=await call({repository,number,kind,action:'commit',ticket:prepared.ticket});}
    catch{throw Error('Send was attempted but not confirmed. Inspect GitHub before retrying; this message will not be resent automatically.');}
    const target=new URL(result?.url||'about:blank');
    if(result?.author!==thread.account||result.number!==number||result.kind!==kind||target.origin!=='https://github.com'||target.pathname!=='/'+repository+'/'+(kind==='discussion'?'discussions':'issues')+'/'+number||!(kind==='discussion'?/^#discussioncomment-[0-9]+$/:/^#issuecomment-[0-9]+$/).test(target.hash))throw Error('GitHub did not confirm the matching comment. Inspect its conversation before retrying.');
    if(attachments)result={...result,attachments};
    cache.delete(key(repository,number,kind));scans.delete(repository.toLowerCase());catalogs.delete(catalogKey(repository,kind));
    const receipt={status:'done',digest,result};confirmed.set(operation,receipt);if(confirmed.size>64)confirmed.delete(confirmed.keys().next().value);
    try{await storage.set({[operation]:receipt});}catch{result={...result,receiptWarning:'Posted on GitHub; the local receipt could not be saved.'};}
    return result;
   })();locks.set(operation,work);try{return await work;}finally{locks.delete(operation);}
  }
  async function createIssue({repository,title,body,clientMutationId,confirmedSend,annotation,kind='issue',categoryId}){
   if(!['issue','discussion'].includes(kind))throw Error('Unsupported website conversation type.');
   if(confirmedSend!==true||typeof title!=='string'||!title.trim()||title.length>256||typeof body!=='string'||!body.trim()||new TextEncoder().encode(body).length>59000||typeof clientMutationId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(clientMutationId))throw Error('Explicit Send, a title and a valid issue message are required.');
   const operation='website-new-'+kind+':'+JSON.stringify([repository.toLowerCase(),clientMutationId]);if(locks.has(operation))throw Error('This conversation is already being created.');
   const work=(async()=>{
    await assertWrites();if(kind==='discussion'&&!(await categories(repository)).some(item=>item.id===categoryId))throw Error('Choose an existing supported Discussion category.');const catalog=await call({repository,kind,action:'list'}),account=catalog.account;if(typeof account!=='string'||!account)throw Error('Sign in to GitHub in the matching repository before creating a conversation.');
    const fingerprint=JSON.stringify([repository.toLowerCase(),title,body,account,annotation?.capture||null,kind,categoryId||null]),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint)),digest=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
    const record=confirmed.get(operation)||(await storage.get(operation))[operation];
    if(record){if(record.digest!==digest)throw Error('This issue send ID belongs to another draft or account.');if(record.status==='done')return {...record.result,duplicate:true};throw Error('A previous Create has an unconfirmed outcome. Inspect GitHub before trying again; no automatic duplicate issue will be created.');}
    let marked=body.replace(/\r\n?/g,'\n')+'\n\n<!-- pocket-kiview-session:'+clientMutationId+' -->';let attachments;await reserve();
    const prepared=await call({repository,kind,...(kind==='discussion'?{category:categoryId}:{}),title,body:marked,action:'prepare-create',...(annotation?.capture?{capture:annotation.capture}:{})});if(prepared.repository!==repository||prepared.account!==account||typeof prepared.ticket!=='string')throw Error('GitHub new-conversation account or draft changed. Nothing sent.');
    const captured=await finalizeCapture(prepared,{repository,kind,annotation,clientMutationId,baseBody:body});if(captured){marked=captured.body;attachments=captured.attachments;}
    const checked=await call({repository,kind,ticket:prepared.ticket,action:'verify-create'});if(checked?.verified!==true||checked.account!==account)throw Error('GitHub new-conversation account changed. Nothing sent.');
    await assertWrites();await storage.set({[operation]:{status:'pending',digest,...(attachments?{body:marked,attachments}:{}),startedAt:new Date(now()).toISOString()}});await assertWrites();
    let result;try{result=await call({repository,kind,ticket:prepared.ticket,action:'commit-create'});}catch{throw Error('Conversation creation was attempted but not confirmed. Inspect GitHub before retrying; no automatic second Create will occur.');}
    const url=new URL(result?.url||'about:blank');if(result?.kind!==kind||result.author!==account||!Number.isSafeInteger(result.number)||result.number<1||url.origin!=='https://github.com'||url.pathname!=='/'+repository+'/'+(kind==='discussion'?'discussions':'issues')+'/'+result.number||url.hash||result.title!==title)throw Error('GitHub did not confirm the matching new conversation. Inspect GitHub before retrying.');
    if(attachments)result={...result,attachments};
    catalogs.delete(catalogKey(repository,kind));scans.delete(repository.toLowerCase());const receipt={status:'done',digest,result};confirmed.set(operation,receipt);if(confirmed.size>64)confirmed.delete(confirmed.keys().next().value);try{await storage.set({[operation]:receipt});}catch{result={...result,receiptWarning:'Created on GitHub; the local receipt could not be saved.'};}return result;
   })();locks.set(operation,work);try{return await work;}finally{locks.delete(operation);}
  }
  async function chat(message){
   const scope=comments.normalizeScope(message),{kind,number}=message.thread||{};
   if(!['issue','discussion'].includes(kind)||!Number.isSafeInteger(number)||number<1||!['create','reply'].includes(message.action))throw Error('Choose a valid Issue or Discussion conversation.');
   let body=message.body;
   if(typeof body!=='string'||body.includes('<!-- kicad-review:')&&!message.annotation)throw Error('Use validated drawing context for review metadata.');
   if(message.annotation){
    const note=comments.validateComment(message.annotation);
    if(note.id!==message.clientMutationId||note.text!==body||note.anchor.repository!==scope.repository||note.anchor.ref!==scope.ref||note.anchor.file!==scope.file||note.threadType!==kind)throw Error('Review context does not match this message.');
    const {capture,...metadata}=note;body=comments.toMarkdown(metadata);
   }
   if(message.action==='reply'){
    const thread=await read(scope.repository,number,false,kind),target=thread.comments.find(n=>n.id===message.replyTo);
    if(!target)throw Error('Reload the conversation before replying to this message.');
    body='> Reply to ['+(target.author||'message')+']('+target.url+')\n\n'+body;
   }
   return send({...message,repository:scope.repository,number,kind,body,annotation:message.annotation});
  }
  return {read,list,categories,annotations,send,chat,createIssue};
 }
 root.KiCadGitHubWebsiteReviews={create,createTabTransport};if(typeof module==='object'&&module.exports)module.exports=root.KiCadGitHubWebsiteReviews;
})(globalThis);
