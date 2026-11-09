/* GitHub website review transport. Runs only in the user-invoked repository tab.
 * Website credentials and CSRF fields never leave this isolated script. */
((root)=>{'use strict';
 const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,LOGIN=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
 const integer=n=>Number.isSafeInteger(n)&&n>0,pending=new Map();
 const problem=message=>Object.assign(Error(message),{code:'WEBSITE_REVIEW_UNAVAILABLE'});
 function scope(repository,location){
  if(typeof repository!=='string'||!REPO.test(repository)||repository.split('/').some(x=>x==='.'||x==='..'))throw problem('Invalid review repository.');
  const here=new URL(location.href);
  if(here.origin!=='https://github.com'||here.username||here.password||here.pathname.split('/').slice(1,3).join('/').toLowerCase()!==repository.toLowerCase())throw problem('Keep the matching GitHub repository tab open.');
 }
 function login(doc){const value=doc.querySelector('meta[name="user-login"]')?.getAttribute('content');return LOGIN.test(value||'')?value:null;}
 function composer(doc){
  const labels=node=>String(node.getAttribute('aria-label')||[...(node.labels||[])].map(n=>n.textContent).join(' ')||(node.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>doc.getElementById(id)?.textContent||'').join(' ')).trim();
  const visible=n=>n.isConnected!==false&&!n.hidden&&!n.closest('[hidden],[aria-hidden="true"]')&&n.getClientRects().length>0;
  const boxes=[...doc.querySelectorAll('main textarea')].filter(n=>!n.disabled&&!n.readOnly&&visible(n)&&!n.closest('.markdown-body')&&labels(n)==='Add a comment');
  if(boxes.length!==1)throw problem('Open the issue on GitHub so its comment composer is available.');
  const box=boxes[0];
  for(let parent=box.parentElement;parent&&parent.tagName!=='MAIN';parent=parent.parentElement){
   const buttons=[...parent.querySelectorAll('button')].filter(n=>visible(n)&&!n.closest('.markdown-body')&&n.textContent.trim()==='Comment');
   if(buttons.length===1&&parent.querySelectorAll('textarea').length===1)return {box,button:buttons[0]};
  }
  throw problem('GitHub comment controls changed. Use its website composer; no comment was sent.');
 }
 function objects(doc){
  const found=[],queue=[];let bytes=0;
  for(const script of [...doc.querySelectorAll('script[type="application/json"]')].slice(0,100)){
   bytes+=new TextEncoder().encode(script.textContent).length;if(bytes>8*1024*1024)throw problem('GitHub review page exceeds its size budget.');
   try{queue.push(JSON.parse(script.textContent));}catch{}
  }
  for(let i=0;i<queue.length&&i<50000;i++){
   const item=queue[i];if(!item||typeof item!=='object')continue;found.push(item);
   for(const value of Object.values(item))if(value&&typeof value==='object')queue.push(value);
   if(queue.length>50000)throw problem('GitHub review data exceeds its object budget.');
  }
  return found;
 }
 function diagnostics(doc,repository){
  const forms=[...doc.querySelectorAll('form')].slice(0,100).map(form=>{
   let action;try{action=new URL(form.getAttribute('action')||'', 'https://github.com/'+repository);}catch{return null;}
   if(action.origin!=='https://github.com'||!action.pathname.startsWith('/'+repository+'/'))return null;
   return {path:action.pathname,method:String(form.getAttribute('method')||'get').toLowerCase(),fields:[...form.querySelectorAll('[name]')].map(n=>n.getAttribute('name')).filter(n=>typeof n==='string'&&n.length<100).slice(0,50)};
  }).filter(Boolean);
  const values=objects(doc),keys=n=>Object.keys(n).filter(k=>/^[A-Za-z0-9_]{1,80}$/.test(k)).slice(0,80);
  return {forms,types:[...new Set(values.map(n=>n.__typename).filter(n=>typeof n==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(n)))].slice(0,50),shapes:values.filter(n=>n.number&&n.title||n.issue||n.body&&n.author||n.bodyHTML||n.preloadedQueries).slice(0,15).map(keys),inputs:[...doc.querySelectorAll('textarea')].slice(0,12).map(n=>({id:n.id,name:n.getAttribute('name'),label:n.getAttribute('aria-label'),labelledby:n.getAttribute('aria-labelledby'),labels:[...(n.labels||[])].map(l=>l.textContent.slice(0,100)),testid:n.getAttribute('data-testid'),parentTestid:n.parentElement?.getAttribute('data-testid'),ancestorTests:[...(function*(node){for(let i=0;node&&i<7;i++,node=node.parentElement)yield node.getAttribute('data-testid');})(n)].filter(Boolean)}))};
 }
 function threadData(doc,repository,number){
  const url='https://github.com/'+repository+'/issues/'+number;
  const matches=objects(doc).filter(n=>n.number===number&&n.url===url&&typeof n.body==='string'&&typeof n.title==='string'&&['OPEN','CLOSED'].includes(n.state));
  if(matches.length!==1)throw problem('GitHub did not expose one complete, matching issue snapshot.');
  const issue=matches[0],comments=[],seen=new Set(),warnings=[];let textBytes=0;
  const record=(value,isRoot=false)=>{
   const match=String(value.url||'').match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)#issuecomment-(\d+)$/);
   if(!isRoot&&(!match||match[1]!==repository||Number(match[2])!==number||!integer(Number(match[3]))))return null;
    const updatedAt=isRoot?value.updatedAt:value.updatedAt??value.lastEditedAt??value.createdAt;
    if(typeof value.body!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!Number.isFinite(Date.parse(updatedAt))||value.author!==null&&!LOGIN.test(value.author?.login||''))throw problem('GitHub issue message provenance was incomplete.');
   const bytes=new TextEncoder().encode(value.body).length;
   if(bytes>65536||textBytes+bytes>1024*1024){if(isRoot)throw problem('GitHub issue body exceeds the viewer text budget.');warnings.push('Some issue messages were omitted at the text budget.');return null;}textBytes+=bytes;
    return {id:isRoot?String(number):match[3],author:value.author?.login||null,body:value.body,createdAt:value.createdAt,updatedAt,url:isRoot?url:value.url,replyTo:null,bodyTruncated:false,canEdit:false,canReply:!isRoot,nodeId:null};
  };
  const rootRecord=record(issue,true);
  for(const connection of [issue.timelineItems,issue.backTimelineItems]){
   const nodes=connection?.nodes||connection?.edges?.map(n=>n.node)||[];
   if(!Array.isArray(nodes)||nodes.length>500)throw problem('GitHub issue timeline exceeded its read budget.');
   for(const node of nodes){if(typeof node?.url!=='string'||!node.url.includes('#issuecomment-')||seen.has(node.url))continue;seen.add(node.url);if(comments.length>=200){warnings.push('Some issue messages were omitted at the comment-count limit.');break;}const value=record(node);if(value)comments.push(value);}
   if(connection?.pageInfo?.hasNextPage||connection?.pageInfo?.hasPreviousPage)warnings.push('Issue pagination is incomplete; open GitHub for older messages.');
  }
  if(Number.isInteger(issue.totalCommentsCount)&&comments.length<issue.totalCommentsCount)warnings.push('Some issue comments were not included in the website snapshot.');
  const writable=issue.viewerCanComment===true&&!issue.locked;
  return {...rootRecord,kind:'issue',number,title:issue.title.slice(0,1024),state:issue.state.toLowerCase(),locked:issue.locked===true,isPullRequest:false,comments:comments.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),warnings:[...new Set(warnings)],capabilities:{create:writable,reply:writable,edit:false,reactions:false,canClose:false,canReopen:false,replyMode:'quoted'},transport:'website-session'};
 }
 function create({fetch:fetcher=root.fetch,document=root.document,location=root.location,parseHTML=(html)=>new DOMParser().parseFromString(html,'text/html'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  async function page(repository,path){
   scope(repository,location);const url='https://github.com/'+repository+path;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
   try{
    const response=await fetcher(url,{credentials:'same-origin',redirect:'error',cache:'no-store',headers:{Accept:'text/html'},signal:controller.signal});
    if(!response.ok||response.url&&response.url!==url||!/text\/html/i.test(response.headers.get('content-type')||''))throw problem('GitHub website review access is unavailable. Open the repository tab and complete its sign-in or SSO.');
    if(Number(response.headers.get('content-length'))>8*1024*1024)throw problem('GitHub review page exceeds its size budget.');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw problem('GitHub review page exceeds its size budget.');}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    scope(repository,location);return parseHTML(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   }finally{clearTimeout(timer);}
  }
  async function dispatch(message){
   const {repository,action,number}=message;scope(repository,location);
   if(!['inspect','read','prepare','verify','commit','list'].includes(action)||action!=='list'&&!integer(number))throw problem('Unsupported website review operation.');
   if(action==='list'){
    const doc=await page(repository,'/issues?q=is%3Aissue'),account=login(doc);
    const threads=new Map();for(const item of objects(doc)){
     if(!integer(item.number)||typeof item.title!=='string'||item.url!=='https://github.com/'+repository+'/issues/'+item.number)continue;
     const state=String(item.state||'').toLowerCase();if(!['open','closed'].includes(state))continue;
     threads.set(item.number,{kind:'issue',number:item.number,title:item.title.slice(0,1024),url:item.url,state,updatedAt:item.updatedAt||item.createdAt||'',author:LOGIN.test(item.author?.login||'')?item.author.login:null});
    }
    // A website-owned, same-repository next link establishes partial coverage.
    // The extension does not follow arbitrary pagination URLs or infer completeness
    // from the number of issue records embedded in this page.
    const hasMore=[...doc.querySelectorAll('a[rel~="next"],a.next_page')].slice(0,100).some(link=>{try{const href=new URL(link.getAttribute('href')||'', 'https://github.com/'+repository+'/issues');return href.origin==='https://github.com'&&!href.username&&!href.password&&href.pathname==='/'+repository+'/issues'&&/^[2-9][0-9]*$/.test(href.searchParams.get('page')||'');}catch{return false;}});
    return {threads:[...threads.values()].slice(0,50),account,hasMore,pagination:'website-only',transport:'website-session',warnings:['Website issue listing is limited to the current result page'+(hasMore?'; more Issues are available on GitHub':'')+'; use Open by number for other conversations.']};
   }
   const exactPage=()=>{scope(repository,location);const url=new URL(location.href);if(url.pathname!=='/'+repository+'/issues/'+number||url.search)throw problem('Keep the selected issue open in the matching GitHub tab.');};
   if(action==='verify'){
    const ticket=pending.get(message.ticket);
    if(!ticket||ticket.repository!==repository||ticket.number!==number||ticket.expires<Date.now())throw problem('Review send expired. Reload the conversation before sending.');
    const freshDoc=await page(repository,'/issues/'+number),freshThread=threadData(freshDoc,repository,number);
    if(login(freshDoc)!==ticket.account||!freshThread.capabilities.create||ticket.expires<Date.now())throw problem('GitHub account or permissions changed. Nothing sent.');
    if(freshThread.comments.some(n=>n.body===ticket.body&&n.author===ticket.account))throw problem('This exact message is already on GitHub. Refresh instead of sending again.');
    for(const item of freshThread.comments)ticket.baseline.add(item.id);
    exactPage();if(login(document)!==ticket.account)throw problem('GitHub account changed. Nothing sent.');
    ticket.verifiedAt=Date.now();return {verified:true,account:ticket.account};
   }
   if(action==='commit'){
    const ticket=pending.get(message.ticket);pending.delete(message.ticket);
    if(!ticket||ticket.repository!==repository||ticket.number!==number||ticket.expires<Date.now()||!Number.isFinite(ticket.verifiedAt)||Date.now()-ticket.verifiedAt>2000)throw problem('Review send expired. Reload the conversation before sending.');
    exactPage();if(login(document)!==ticket.account)throw problem('GitHub account changed. Nothing sent.');
    const current=composer(document);
    if(current.box!==ticket.box||current.box.value!==ticket.body||current.button.disabled)throw problem('GitHub draft or permissions changed. Nothing sent.');
    current.button.click(); // GitHub owns CSRF/session submission; never extract its credentials.
    for(const wait of [600,1200,2400]){
     await delay(wait);
     try{exactPage();const doc=await page(repository,'/issues/'+number);if(login(doc)!==ticket.account)break;
      const thread=threadData(doc,repository,number),matches=thread.comments.filter(n=>!ticket.baseline.has(n.id)&&n.author===ticket.account&&n.body===ticket.body);
      if(matches.length===1)return {provider:'github',kind:'issue',number,messageId:matches[0].id,author:ticket.account,createdAt:matches[0].createdAt,updatedAt:matches[0].updatedAt,url:matches[0].url,replyTo:null,transport:'website-session'};
     }catch{}
    }
    throw Object.assign(Error('Send was attempted, but GitHub has not confirmed the result. Inspect the issue before retrying; no automatic resend will occur.'),{code:'WEBSITE_REVIEW_UNCERTAIN'});
   }
   const doc=await page(repository,'/issues/'+number),account=login(doc);
   // Reading public website snapshots does not require a connected account.
   // Mutations still require a website login and their exact composer checks.
   if(action==='read'){const thread=threadData(doc,repository,number);return {...thread,account,...(!account?{capabilities:{...thread.capabilities,create:false,reply:false}}:{})};}
   if(!account)throw problem('Sign in to GitHub in the matching repository tab.');
   if(action==='prepare'){
    const thread=threadData(doc,repository,number);if(!thread.capabilities.create)throw problem('GitHub does not allow comments on this issue.');
    if(typeof message.body!=='string'||!message.body.trim()||new TextEncoder().encode(message.body).length>60000)throw problem('Invalid website review message.');
    exactPage();if(login(document)!==account)throw problem('GitHub account changed. Nothing sent.');
    if(thread.comments.some(n=>n.body===message.body&&n.author===account))throw problem('This exact message is already on GitHub. Refresh the conversation instead of sending it again.');
    const {box}=composer(document);if(box.value.trim()&&box.value!==message.body)throw problem('The GitHub composer already contains another draft. Nothing was overwritten.');
    const setter=Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement.prototype,'value').set;
    setter.call(box,message.body);box.dispatchEvent(new Event('input',{bubbles:true}));box.dispatchEvent(new Event('change',{bubbles:true}));await delay(150);
    exactPage();const current=composer(document);if(current.box!==box||box.value!==message.body||current.button.disabled)throw problem('GitHub has not enabled Send for this draft. Nothing sent.');
    const ticket=root.crypto.randomUUID();while(pending.size>=8)pending.delete(pending.keys().next().value);
    pending.set(ticket,{repository,number,account,box,body:message.body,baseline:new Set(thread.comments.map(n=>n.id)),expires:Date.now()+30000});return {ticket,account,number,repository};
   }
   return {repository,number,account,transport:'website-session',diagnostics:{...diagnostics(doc,repository),live:diagnostics(document,repository)}};
  }
  return {dispatch};
 }
 root.KiCadGitHubSessionReview={create,scope,objects,diagnostics,login,threadData,composer};
 if(typeof module==='object'&&module.exports)module.exports=root.KiCadGitHubSessionReview;
})(globalThis);
