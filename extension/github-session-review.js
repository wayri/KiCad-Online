/* GitHub website review transport. Runs only in the user-invoked repository tab.
 * Website credentials and CSRF fields never leave this isolated script. */
((root)=>{'use strict';
 const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,LOGIN=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
 const authorLogin=value=>typeof value==='string'&&(LOGIN.test(value)||value.endsWith('[bot]')&&LOGIN.test(value.slice(0,-5)));
 const section=kind=>kind==='discussion'?'discussions':'issues',categorySlug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value)&&value!=='polls';
 function editorPage(location,repository,number,newThread,kind='issue',category){try{const url=new URL(location.href);return url.pathname==='/'+repository+'/'+section(kind)+'/'+(newThread?'new':number)&&(newThread&&kind==='discussion'?categorySlug(category)&&url.searchParams.size===1&&url.searchParams.get('category')===category:!url.search);}catch{return false;}}
 const integer=n=>Number.isSafeInteger(n)&&n>0,pending=new Map();
 const problem=message=>Object.assign(Error(message),{code:'WEBSITE_REVIEW_UNAVAILABLE'});
 function issueLocation(value,repository,number,comment=false,kind='issue'){
  try{const url=new URL(value,'https://github.com'),parts=url.pathname.split('/');return url.origin==='https://github.com'&&!url.username&&!url.password&&!url.search&&parts.length===5&&parts.slice(1,3).join('/').toLowerCase()===repository.toLowerCase()&&parts[3]===(kind==='discussion'?'discussions':'issues')&&Number(parts[4])===number&&String(number)===parts[4]&&(comment?(kind==='discussion'?/^#discussioncomment-[1-9][0-9]*$/:/^#issuecomment-[1-9][0-9]*$/).test(url.hash):!url.hash);}catch{return false;}
 }
 function scope(repository,location){
  if(typeof repository!=='string'||!REPO.test(repository)||repository.split('/').some(x=>x==='.'||x==='..'))throw problem('Invalid review repository.');
  const here=new URL(location.href);
  if(here.origin!=='https://github.com'||here.username||here.password||here.pathname.split('/').slice(1,3).join('/').toLowerCase()!==repository.toLowerCase())throw problem('Keep the matching GitHub repository tab open.');
 }
 function login(doc){const value=doc.querySelector('meta[name="user-login"]')?.getAttribute('content');return LOGIN.test(value||'')?value:null;}
 function discussionForm(form,nodes,repository,path){
  let url;try{url=new URL(form?.getAttribute('action')||'','https://github.com');}catch{}
  if(!form||nodes.some(node=>node.form!==form)||String(form.getAttribute('method')||'get').toLowerCase()!=='post'||!url||url.origin!=='https://github.com'||url.username||url.password||url.search||url.hash||url.pathname.toLowerCase()!==('/'+repository+path).toLowerCase())throw problem('GitHub Discussion form target changed. Nothing was sent.');
 }
 function composer(doc,context={}){
  const labels=node=>String(node.getAttribute('aria-label')||[...(node.labels||[])].map(n=>n.textContent).join(' ')||(node.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>doc.getElementById(id)?.textContent||'').join(' ')).trim();
  const visible=n=>n.isConnected!==false&&!n.hidden&&!n.closest('[hidden],[aria-hidden="true"]')&&n.getClientRects().length>0;
  const boxes=[...doc.querySelectorAll('main textarea')].filter(n=>!n.disabled&&!n.readOnly&&visible(n)&&!n.closest('.markdown-body')&&(labels(n)==='Add a comment'||n.getAttribute('placeholder')==='Use Markdown to format your comment'||n.getAttribute('name')==='comment[body]'&&labels(n)==='Comment'));
  if(boxes.length!==1)throw problem('Open the issue on GitHub so its comment composer is available.');
  const box=boxes[0];
  for(let parent=box.parentElement;parent&&parent.tagName!=='MAIN';parent=parent.parentElement){
   const buttons=[...parent.querySelectorAll('button')].filter(n=>visible(n)&&!n.closest('.markdown-body')&&n.textContent.trim()==='Comment'&&n.getAttribute?.('name')!=='comment_and_close');
   if(buttons.length===1&&parent.querySelectorAll('textarea').length===1){if(context.kind==='discussion')discussionForm(box.form,[box,buttons[0]],context.repository,'/discussions/'+context.number+'/comments');return {box,button:buttons[0]};}
  }
  throw problem('GitHub comment controls changed. Use its website composer; no comment was sent.');
 }
 function newIssueComposer(doc){
  const visible=n=>n.isConnected!==false&&!n.hidden&&!n.closest('[hidden],[aria-hidden="true"]')&&n.getClientRects().length>0;
  const titles=[...doc.querySelectorAll('main input[aria-label="Add a title"]')].filter(n=>visible(n)&&!n.disabled&&!n.readOnly);
  const bodies=[...doc.querySelectorAll('main textarea[aria-label="Markdown value"]')].filter(n=>visible(n)&&!n.disabled&&!n.readOnly);
  const buttons=[...doc.querySelectorAll('main button')].filter(n=>visible(n)&&/^Create(?:\s*\([^)]*\))?$/.test(n.textContent.replace(/[\u200b-\u200d]/g,'').trim()));
  if(titles.length!==1||bodies.length!==1||buttons.length!==1)throw problem('GitHub new-Issue controls changed. No issue was created.');
  return {title:titles[0],box:bodies[0],button:buttons[0]};
 }
 function newDiscussionComposer(doc,repository){
  const visible=n=>n.isConnected!==false&&!n.hidden&&!n.closest('[hidden],[aria-hidden="true"]')&&n.getClientRects().length>0;
  const titles=[...doc.querySelectorAll('main input[name="discussion[title]"]')].filter(n=>visible(n)&&!n.disabled&&!n.readOnly),bodies=[...doc.querySelectorAll('main textarea[name="discussion[body]"]')].filter(n=>visible(n)&&!n.disabled&&!n.readOnly),buttons=[...doc.querySelectorAll('main button')].filter(n=>visible(n)&&n.textContent.trim()==='Start discussion');
  if(titles.length!==1||bodies.length!==1||buttons.length!==1)throw problem('GitHub new-Discussion controls changed. No discussion was created.');discussionForm(titles[0].form,[titles[0],bodies[0],buttons[0]],repository,'/discussions');return {title:titles[0],box:bodies[0],button:buttons[0]};
 }
 function screenshotBytes(capture){
  if(!capture||capture.mime!=='image/png'||typeof capture.dataUrl!=='string'||capture.dataUrl.length>262144||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(capture.dataUrl)||![capture.width,capture.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1024))throw problem('Invalid review screenshot. Nothing posted.');
  let bytes;try{bytes=Uint8Array.from(root.atob(capture.dataUrl.split(',')[1]),n=>n.charCodeAt(0));}catch{throw problem('Invalid review screenshot encoding.');}
  if(bytes.length<24||String.fromCharCode(...bytes.slice(12,16))!=='IHDR'||new DataView(bytes.buffer).getUint32(16)!==capture.width||new DataView(bytes.buffer).getUint32(20)!==capture.height)throw problem('Review screenshot dimensions do not match its PNG.');return bytes;
 }
 function leaseSafe(doc,location){
  const path=new URL(location.href).pathname;if(/\/(?:edit|new|upload|settings)(?:\/|$)/.test(path))return false;
  const visible=n=>n.isConnected!==false&&!n.hidden&&!n.closest('[hidden],[aria-hidden="true"]')&&n.getClientRects().length>0;
  return ![...doc.querySelectorAll('main textarea,main input,main [contenteditable="true"]')].some(n=>{
   if(!visible(n)||n.disabled||n.readOnly||['hidden','search','checkbox','radio','submit','button','file'].includes(String(n.type||'').toLowerCase()))return false;
   return String(n.isContentEditable?n.textContent:n.value||'').trim().length>0;
  });
 }
 function discussionData(doc,repository,number){
  const title=doc.querySelector('h1.gh-header-title .js-issue-title')?.textContent?.trim(),headerNumber=doc.querySelector('h1.gh-header-title .gh-header-number')?.textContent?.trim();
  if(!title||headerNumber!=='#'+number)throw problem('GitHub did not expose the matching Discussion header.');
  const url='https://github.com/'+repository+'/discussions/'+number,warnings=[],records=new Map();let total=0;
  const nodes=[...doc.querySelectorAll('.js-edit-comment-form-container[data-target-body]')];if(nodes.length>500)throw problem('GitHub Discussion exceeds its message budget.');
  for(const node of nodes){
   const wrapper=node.closest('[id^="discussioncomment-"],[id^="discussion-"]'),match=wrapper?.id?.match(/^(discussion|discussioncomment)-([1-9][0-9]*)$/);if(!match)continue;
   const isRoot=match[1]==='discussion',id=isRoot?String(number):match[2];if(records.has((isRoot?'root:':'comment:')+id))continue;
   const authorNodes=[...wrapper.querySelectorAll('a[data-hovercard-type="user"],a[data-hovercard-type="bot"]')].filter(link=>link.closest('[id^="discussioncomment-"],[id^="discussion-"]')===wrapper&&!link.closest('.js-comment-body'));
   const authors=[...new Set(authorNodes.map(link=>{const href=link.getAttribute('href');return /^\/[A-Za-z0-9-]+(?:\[bot\])?$/.test(href||'')?href.slice(1):null;}).filter(authorLogin))];
   const time=[...wrapper.querySelectorAll('relative-time[datetime]')].find(item=>item.closest('[id^="discussioncomment-"],[id^="discussion-"]')===wrapper)?.getAttribute('datetime'),body=node.getAttribute('data-target-body');
   if(authors.length!==1||!Number.isFinite(Date.parse(time))||typeof body!=='string'){if(isRoot)throw problem('Discussion author or raw Markdown provenance is incomplete.');warnings.push('A Discussion message with incomplete author/Markdown provenance was omitted.');continue;}
   const size=new TextEncoder().encode(body).length;if(size>65536||total+size>1024*1024){if(isRoot)throw problem('Discussion body exceeds its text budget.');warnings.push('Some Discussion messages exceeded the text budget.');continue;}total+=size;
   records.set((isRoot?'root:':'comment:')+id,{id,author:authors[0],body,createdAt:time,updatedAt:time,url:isRoot?url:url+'#discussioncomment-'+id,replyTo:null,bodyTruncated:false,canEdit:false,canReply:!isRoot,nodeId:null,isRoot});
  }
  const roots=[...records.values()].filter(n=>n.isRoot);if(roots.length!==1)throw problem('GitHub did not expose one complete Discussion root.');
  const buttons=[...doc.querySelectorAll('button')].map(node=>node.textContent.trim()),state=buttons.includes('Reopen discussion')?'closed':buttons.includes('Close discussion')?'open':'unknown';
  if(state==='unknown')warnings.push('Discussion state was not exposed by this website snapshot.');
  const action='/'+repository+'/discussions/'+number+'/comments',form=[...doc.querySelectorAll('form[action]')].find(node=>{try{const target=new URL(node.getAttribute('action'),'https://github.com');return target.origin==='https://github.com'&&target.pathname.toLowerCase()===action.toLowerCase()&&!target.search;}catch{return false;}}),box=form?.querySelector('textarea[name="comment[body]"]'),writable=!!box&&!box.disabled&&!box.readOnly;
  const comments=[...records.values()].filter(n=>!n.isRoot).map(({isRoot,...message})=>message),{isRoot,...rootRecord}=roots[0];
  const visibleCount=[...doc.querySelectorAll('[id^="discussioncomment-"]')].filter(node=>/^discussioncomment-[1-9][0-9]*$/.test(node.id||'')).length;
  if(visibleCount>comments.length)warnings.push('Some Discussion messages did not expose raw Markdown and were omitted.');
  warnings.push('Incomplete Discussion coverage: only messages exposed by this website snapshot were read; off-page comments or replies may be missing.');
  warnings.push('Discussion edit timestamps are unavailable in this website snapshot; displayed creation times are retained.');
  return {...rootRecord,kind:'discussion',number,title:title.slice(0,1024),state,locked:buttons.includes('Unlock conversation')?true:buttons.includes('Lock conversation')?false:null,isPullRequest:false,comments:comments.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),warnings:[...new Set(warnings)],capabilities:{create:writable,reply:writable,edit:false,reactions:false,canClose:false,canReopen:false,replyMode:'quoted'},transport:'website-session'};
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
  const matches=objects(doc).filter(n=>n.number===number&&issueLocation(n.url,repository,number)&&typeof n.body==='string'&&typeof n.title==='string'&&['OPEN','CLOSED'].includes(n.state));
  if(!matches.length)throw problem('GitHub did not expose a complete, matching issue snapshot.');
  // GitHub may serialize the same Relay node in more than one embedded payload.
  // Accept matching copies, but never choose between conflicting issue bodies.
  const identity=n=>JSON.stringify([n.number,n.title,n.body,n.state,n.createdAt,n.updatedAt,n.author?.login]);
  if(matches.some(n=>identity(n)!==identity(matches[0])))throw problem('GitHub exposed conflicting issue snapshots. Refresh the issue before reviewing it.');
  const issue=matches[0],comments=[],seen=new Set(),warnings=[];let textBytes=0;
  const record=(value,isRoot=false)=>{
   const match=String(value.url||'').match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)#issuecomment-(\d+)$/);
   if(!isRoot&&(!match||!issueLocation(value.url,repository,number,true)||!integer(Number(match[3]))))return null;
    const updatedAt=isRoot?value.updatedAt:value.updatedAt??value.lastEditedAt??value.createdAt;
    if(typeof value.body!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!Number.isFinite(Date.parse(updatedAt))||value.author!==null&&!authorLogin(value.author?.login))throw problem('GitHub issue message provenance was incomplete.');
   const bytes=new TextEncoder().encode(value.body).length;
   if(bytes>65536||textBytes+bytes>1024*1024){if(isRoot)throw problem('GitHub issue body exceeds the viewer text budget.');warnings.push('Some issue messages were omitted at the text budget.');return null;}textBytes+=bytes;
    return {id:isRoot?String(number):match[3],author:value.author?.login||null,body:value.body,createdAt:value.createdAt,updatedAt,url:isRoot?url:value.url,replyTo:null,bodyTruncated:false,canEdit:false,canReply:!isRoot,nodeId:null};
  };
  const rootRecord=record(issue,true);
  for(const connection of matches.flatMap(item=>[item.timelineItems,item.backTimelineItems])){
   const nodes=connection?.nodes||connection?.edges?.map(n=>n.node)||[];
   if(!Array.isArray(nodes)||nodes.length>500)throw problem('GitHub issue timeline exceeded its read budget.');
   for(const node of nodes){if(typeof node?.url!=='string'||!node.url.includes('#issuecomment-')||seen.has(node.url))continue;seen.add(node.url);if(comments.length>=200){warnings.push('Some issue messages were omitted at the comment-count limit.');break;}const value=record(node);if(value)comments.push(value);}
   if(connection?.pageInfo?.hasNextPage||connection?.pageInfo?.hasPreviousPage)warnings.push('Issue pagination is incomplete; open GitHub for older messages.');
  }
  if(Number.isInteger(issue.totalCommentsCount)&&comments.length<issue.totalCommentsCount)warnings.push('Some issue comments were not included in the website snapshot.');
  const writable=issue.viewerCanComment===true&&!issue.locked;
  return {...rootRecord,kind:'issue',number,title:issue.title.slice(0,1024),state:issue.state.toLowerCase(),locked:issue.locked===true,isPullRequest:false,comments:comments.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),warnings:[...new Set(warnings)],capabilities:{create:writable,reply:writable,edit:false,reactions:false,canClose:false,canReopen:false,replyMode:'quoted'},transport:'website-session'};
 }
 function uploadedScreenshot(value,original,capture,url){
  if(typeof value!=='string'||!value.startsWith(original)||!/^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(url))return false;
  const suffix=value.slice(original.length),markdown=suffix.match(/^\s*!\[[^\]\r\n]{0,200}\]\((https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]{36})\)\s*$/i);
  if(markdown)return markdown[1]===url;
  // Native GitHub paste now emits a dimensioned HTML image. Parse only its
  // inert attribute grammar; never evaluate HTML or accept arbitrary attributes.
  const html=suffix.match(/^\s*<img((?:\s+[a-z]+="[^"<>]*")*)\s*\/?>\s*$/i);if(!html)return false;
  const attrs=Object.create(null);for(const match of html[1].matchAll(/\s+([a-z]+)="([^"<>]*)"/gi)){const name=match[1].toLowerCase();if(!['width','height','alt','src'].includes(name)||Object.hasOwn(attrs,name))return false;attrs[name]=match[2];}
  return Object.keys(attrs).length===4&&attrs.src===url&&attrs.width===String(capture.width)&&attrs.height===String(capture.height)&&attrs.alt.length<=200&&!/[\r\n\x00-\x1f\x7f]/.test(attrs.alt);
 }
 function create({fetch:fetcher=root.fetch,document=root.document,location=root.location,parseHTML=(html)=>new DOMParser().parseFromString(html,'text/html'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  async function pasteScreenshot(box,capture,repository){
   const bytes=screenshotBytes(capture),original=box.value,before=new Set((box.value.match(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}/gi)||[]));
   if(typeof root.DataTransfer!=='function'||typeof root.ClipboardEvent!=='function'||typeof root.File!=='function')throw problem('Native GitHub image paste is unavailable here. The comment was not posted.');
   const data=new root.DataTransfer();try{data.items.add(new root.File([bytes],'kicad-review-'+root.crypto.randomUUID()+'.png',{type:'image/png'}));}finally{bytes.fill(0);}
   box.focus?.();box.setSelectionRange?.(box.value.length,box.value.length);box.dispatchEvent(new root.ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   for(let i=0;i<36;i++){
    await delay(500);scope(repository,location);
    const urls=(box.value.match(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)||[]).filter(url=>!before.has(url));
    if(urls.length===1){if(!uploadedScreenshot(box.value,original,capture,urls[0]))throw problem('The image draft changed during upload. Inspect it; no comment was posted.');return {provider:'github',repository,mime:'image/png',url:urls[0],width:capture.width,height:capture.height};}
    if(urls.length>1)throw problem('GitHub returned ambiguous attachment links. Inspect the draft; no comment was posted.');
   }
   throw problem('GitHub has not confirmed image upload. The draft is kept in its repository tab; no comment was posted.');
  }
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
   const {repository,action,number}=message,kind=message.kind||'issue';scope(repository,location);if(!['issue','discussion'].includes(kind))throw problem('Unsupported website conversation type.');const currentComposer=()=>composer(document,{repository,number,kind});
   const creating=['prepare-create','verify-create','commit-create'].includes(action);
   const snapshot=(doc)=>kind==='discussion'?discussionData(doc,repository,number):threadData(doc,repository,number);
   if(!['inspect','read','prepare','verify','commit','list','categories','prepare-create','verify-create','commit-create','update-prepared','lease-inspect'].includes(action)||!['list','categories','lease-inspect'].includes(action)&&!creating&&action!=='update-prepared'&&!integer(number))throw problem('Unsupported website review operation.');
   if(action==='lease-inspect')return {safeToNavigate:leaseSafe(document,location)};
   if(action==='categories'){
    const doc=await page(repository,'/discussions/new/choose'),categories=new Map();
    for(const link of [...doc.querySelectorAll('a[href]')].slice(0,500)){let url;try{url=new URL(link.getAttribute('href'),'https://github.com');}catch{continue;}
     const slug=url.searchParams.get('category');if(url.origin!=='https://github.com'||url.pathname.toLowerCase()!==('/'+repository+'/discussions/new').toLowerCase()||url.searchParams.size!==1||!categorySlug(slug))continue;
     const label=String(link.getAttribute('aria-label')||link.textContent||'').trim(),name=label.match(/Get started with (.+?) category/i)?.[1]||link.querySelector?.('h2')?.textContent?.trim()||slug;categories.set(slug,{id:slug,name:name.slice(0,200)});
    }
    return {categories:[...categories.values()].slice(0,100),account:login(doc),transport:'website-session',warnings:['Poll categories are not supported by this website composer.']};
   }
   if(action==='update-prepared'){
    const ticket=pending.get(message.ticket);if(!ticket||ticket.repository!==repository||(ticket.kind||'issue')!==kind||ticket.account!==login(document)||ticket.expires<Date.now())throw problem('Review draft expired. Nothing posted.');
    if(!editorPage(location,repository,ticket.number,ticket.newIssue,kind,ticket.category))throw problem('Review helper changed. Nothing posted.');
    if(typeof message.body!=='string'||!message.body.trim()||new TextEncoder().encode(message.body).length>60000)throw problem('Invalid prepared review body.');
    const fields=ticket.newIssue?(kind==='discussion'?newDiscussionComposer(document,repository):newIssueComposer(document)):currentComposer();if(fields.box.value!==ticket.body)throw problem('GitHub draft changed. Nothing overwritten.');
    Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement.prototype,'value').set.call(fields.box,message.body);fields.box.dispatchEvent(new Event('input',{bubbles:true}));fields.box.dispatchEvent(new Event('change',{bubbles:true}));await delay(150);
    if(fields.box.value!==message.body||fields.button.disabled)throw problem('GitHub did not accept the prepared image message. Nothing posted.');ticket.body=message.body;ticket.verifiedAt=null;ticket.expires=Date.now()+30000;return {updated:true,account:ticket.account};
   }
   if(creating){
    const category=message.category||pending.get(message.ticket)?.category,fieldsFor=()=>kind==='discussion'?newDiscussionComposer(document,repository):newIssueComposer(document),newPath='/'+section(kind)+'/new'+(kind==='discussion'?'?category='+category:'');
    const currentPage=()=>{scope(repository,location);if(!editorPage(location,repository,null,true,kind,category))throw problem('Keep the scoped new-conversation helper open. Nothing sent.');};
    currentPage();const account=login(document);if(!account)throw problem('Sign in to GitHub in this repository before creating an issue.');
    if(action==='prepare-create'){
     if(typeof message.title!=='string'||!message.title.trim()||message.title.length>256||typeof message.body!=='string'||!message.body.trim()||new TextEncoder().encode(message.body).length>60000)throw problem('Enter a valid issue title and message.');
     const fields=fieldsFor();if(fields.title.value.trim()&&fields.title.value!==message.title||fields.box.value.trim()&&fields.box.value!==message.body)throw problem('The new-conversation helper already contains another draft. Nothing was overwritten.');
     Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype,'value').set.call(fields.title,message.title);
     Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement.prototype,'value').set.call(fields.box,message.body);
     for(const item of [fields.title,fields.box]){item.dispatchEvent(new Event('input',{bubbles:true}));item.dispatchEvent(new Event('change',{bubbles:true}));}await delay(150);
     const next=fieldsFor();if(next.title!==fields.title||next.box!==fields.box||next.title.value!==message.title||next.box.value!==message.body||next.button.disabled)throw problem('GitHub has not enabled Create for this draft. Nothing sent.');
     if(message.capture){const fresh=await page(repository,newPath);if(login(fresh)!==account)throw problem('GitHub account changed before image upload. Nothing posted.');currentPage();}
     const attachment=message.capture?await pasteScreenshot(next.box,message.capture,repository):null;currentPage();const after=fieldsFor();if(after.title!==fields.title||after.box!==fields.box||after.title.value!==message.title||login(document)!==account)throw problem('GitHub new-conversation draft changed during preparation. Nothing posted.');
     const ticket=root.crypto.randomUUID();while(pending.size>=8)pending.delete(pending.keys().next().value);pending.set(ticket,{repository,account,kind,category,newIssue:true,title:message.title,body:next.box.value,fields,expires:Date.now()+30000});return {ticket,account,repository,body:next.box.value,...(attachment?{attachment}:{})};
    }
    const ticket=pending.get(message.ticket);if(!ticket?.newIssue||ticket.repository!==repository||(ticket.kind||'issue')!==kind||ticket.account!==account||ticket.expires<Date.now())throw problem('New-conversation send expired. Nothing sent.');
    const fields=fieldsFor();if(fields.title!==ticket.fields.title||fields.box!==ticket.fields.box||fields.title.value!==ticket.title||fields.box.value!==ticket.body||fields.button.disabled)throw problem('GitHub new-conversation draft changed. Nothing sent.');
    if(action==='verify-create'){const fresh=await page(repository,newPath);currentPage();const current=fieldsFor();if(login(fresh)!==ticket.account||login(document)!==ticket.account||current.title!==ticket.fields.title||current.box!==ticket.fields.box||current.title.value!==ticket.title||current.box.value!==ticket.body||current.button.disabled)throw problem('GitHub account, permissions or new-conversation draft changed. Nothing sent.');ticket.verifiedAt=Date.now();return {verified:true,account};}
    pending.delete(message.ticket);if(!Number.isFinite(ticket.verifiedAt)||Date.now()-ticket.verifiedAt>10000)throw problem('New-Issue verification expired. Nothing sent.');
    fields.button.click();return {attempted:true,account};
   }
   if(action==='list'){
    if(kind==='discussion'){
     const doc=await page(repository,'/discussions'),threads=new Map();
     for(const link of [...doc.querySelectorAll('h3 a[href]')].slice(0,500)){let url;try{url=new URL(link.getAttribute('href'),'https://github.com');}catch{continue;}
      const number=Number(url.pathname.split('/')[4]),title=String(link.textContent||'').trim();if(!integer(number)||!title||!issueLocation(url.href,repository,number,false,'discussion'))continue;
      threads.set(number,{kind:'discussion',number,title:title.slice(0,1024),url:url.href,state:'unknown',updatedAt:'',author:null});
     }
     return {threads:[...threads.values()].slice(0,50),account:login(doc),hasMore:false,pagination:'website-only',transport:'website-session',warnings:['Website Discussion listing covers only the displayed result page (normally open conversations); open a known number for other Discussions.']};
    }
    const doc=await page(repository,'/issues?q=is%3Aissue'),account=login(doc);
    const threads=new Map();for(const item of objects(doc)){
     if(!integer(item.number)||typeof item.title!=='string'||!issueLocation(item.url,repository,item.number))continue;
     const state=String(item.state||'').toLowerCase();if(!['open','closed'].includes(state))continue;
     threads.set(item.number,{kind:'issue',number:item.number,title:item.title.slice(0,1024),url:item.url,state,updatedAt:item.updatedAt||item.createdAt||'',author:authorLogin(item.author?.login)?item.author.login:null});
    }
    // The current Issues UI can render results without embedding complete Issue
    // records. Read only same-repository issue links with an explicit state icon.
    for(const link of [...doc.querySelectorAll('a[href]')].slice(0,1000)){
     const href=link.getAttribute('href');let url;try{url=new URL(href,'https://github.com');}catch{continue;}
     const number=Number(url.pathname.split('/')[4]);if(!integer(number)||!issueLocation(url.href,repository,number)||threads.has(number))continue;
     const title=String(link.textContent||'').trim();let row=link.closest?.('[data-testid="list-row"],.js-issue-row,[id^="issue_"]');
     if(!row){
      const semantic=link.closest?.('li,[role="listitem"]'),list=semantic?.closest?.('ul[role="list"][aria-labelledby],[role="list"][aria-label="Issues"]');
      const label=list?.getAttribute('aria-label')||(list?.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>doc.getElementById?.(id)?.textContent||'').join(' ').trim();
      if(label==='Issues'&&list?.closest?.('main,[role="main"]'))row=semantic;
     }
     if(!title||/^#?\d+$/.test(title)||!row||link.closest?.('.markdown-body'))continue;
     const state=row.querySelector('.octicon-issue-opened,[aria-label="Open issue"]')?'open':row.querySelector('.octicon-issue-closed,[aria-label="Closed issue"]')?'closed':null;
     if(state)threads.set(number,{kind:'issue',number,title:title.slice(0,1024),url:url.href,state,updatedAt:'',author:null});
    }
    // A website-owned, same-repository next link establishes partial coverage.
    // The extension does not follow arbitrary pagination URLs or infer completeness
    // from the number of issue records embedded in this page.
    const hasMore=[...doc.querySelectorAll('a[rel~="next"],a.next_page')].slice(0,100).some(link=>{try{const href=new URL(link.getAttribute('href')||'', 'https://github.com/'+repository+'/issues');return href.origin==='https://github.com'&&!href.username&&!href.password&&href.pathname==='/'+repository+'/issues'&&/^[2-9][0-9]*$/.test(href.searchParams.get('page')||'');}catch{return false;}});
    return {threads:[...threads.values()].slice(0,50),account,hasMore,pagination:'website-only',transport:'website-session',warnings:['Website issue listing is limited to the current result page'+(hasMore?'; more Issues are available on GitHub':'')+'; use Open by number for other conversations.']};
   }
   const exactPage=()=>{scope(repository,location);if(!editorPage(location,repository,number,false,kind))throw problem('Keep the selected conversation open in the matching GitHub tab.');};
   if(action==='verify'){
    const ticket=pending.get(message.ticket);
    if(!ticket||ticket.repository!==repository||ticket.number!==number||(ticket.kind||'issue')!==kind||ticket.expires<Date.now())throw problem('Review send expired. Reload the conversation before sending.');
    const freshDoc=await page(repository,'/'+section(kind)+'/'+number),freshThread=snapshot(freshDoc);
    if(login(freshDoc)!==ticket.account||!freshThread.capabilities.create||ticket.expires<Date.now())throw problem('GitHub account or permissions changed. Nothing sent.');
    if(freshThread.comments.some(n=>n.body===ticket.body&&n.author===ticket.account))throw problem('This exact message is already on GitHub. Refresh instead of sending again.');
    for(const item of freshThread.comments)ticket.baseline.add(item.id);
    exactPage();if(login(document)!==ticket.account)throw problem('GitHub account changed. Nothing sent.');
    ticket.verifiedAt=Date.now();return {verified:true,account:ticket.account};
   }
   if(action==='commit'){
    const ticket=pending.get(message.ticket);pending.delete(message.ticket);
    if(!ticket||ticket.repository!==repository||ticket.number!==number||(ticket.kind||'issue')!==kind||ticket.expires<Date.now()||!Number.isFinite(ticket.verifiedAt)||Date.now()-ticket.verifiedAt>10000)throw problem('Review send expired. Reload the conversation before sending.');
    exactPage();if(login(document)!==ticket.account)throw problem('GitHub account changed. Nothing sent.');
    const current=currentComposer();
    if(current.box!==ticket.box||current.box.value!==ticket.body||current.button.disabled)throw problem('GitHub draft or permissions changed. Nothing sent.');
    current.button.click(); // GitHub owns CSRF/session submission; never extract its credentials.
    for(const wait of [600,1200,2400]){
     await delay(wait);
     try{exactPage();const doc=await page(repository,'/'+section(kind)+'/'+number);if(login(doc)!==ticket.account)break;
      const thread=snapshot(doc),matches=thread.comments.filter(n=>!ticket.baseline.has(n.id)&&n.author===ticket.account&&n.body===ticket.body);
      if(matches.length===1)return {provider:'github',kind,number,messageId:matches[0].id,author:ticket.account,createdAt:matches[0].createdAt,updatedAt:matches[0].updatedAt,url:matches[0].url,replyTo:null,transport:'website-session'};
     }catch{}
    }
    throw Object.assign(Error('Send was attempted, but GitHub has not confirmed the result. Inspect the issue before retrying; no automatic resend will occur.'),{code:'WEBSITE_REVIEW_UNCERTAIN'});
   }
   const doc=await page(repository,'/'+section(kind)+'/'+number),account=login(doc);
   // Reading public website snapshots does not require a connected account.
   // Mutations still require a website login and their exact composer checks.
   if(action==='read'){const thread=snapshot(doc);return {...thread,account,...(!account?{capabilities:{...thread.capabilities,create:false,reply:false}}:{})};}
   if(!account)throw problem('Sign in to GitHub in the matching repository tab.');
   if(action==='prepare'){
    const thread=snapshot(doc);if(!thread.capabilities.create)throw problem('GitHub does not allow comments on this conversation.');
    if(typeof message.body!=='string'||!message.body.trim()||new TextEncoder().encode(message.body).length>60000)throw problem('Invalid website review message.');
    exactPage();if(login(document)!==account)throw problem('GitHub account changed. Nothing sent.');
    if(thread.comments.some(n=>n.body===message.body&&n.author===account))throw problem('This exact message is already on GitHub. Refresh the conversation instead of sending it again.');
    const {box}=currentComposer();if(box.value.trim()&&box.value!==message.body)throw problem('The GitHub composer already contains another draft. Nothing was overwritten.');
    const setter=Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement.prototype,'value').set;
    setter.call(box,message.body);box.dispatchEvent(new Event('input',{bubbles:true}));box.dispatchEvent(new Event('change',{bubbles:true}));await delay(150);
    exactPage();const current=currentComposer();if(current.box!==box||box.value!==message.body||current.button.disabled)throw problem('GitHub has not enabled Send for this draft. Nothing sent.');
    const attachment=message.capture?await pasteScreenshot(box,message.capture,repository):null;exactPage();const after=currentComposer();if(after.box!==box||login(document)!==account)throw problem('GitHub comment draft changed during preparation. Nothing posted.');
    const ticket=root.crypto.randomUUID();while(pending.size>=8)pending.delete(pending.keys().next().value);
    pending.set(ticket,{repository,number,kind,account,box,body:box.value,baseline:new Set(thread.comments.map(n=>n.id)),expires:Date.now()+30000});return {ticket,account,number,repository,body:box.value,...(attachment?{attachment}:{})};
   }
   return {repository,number,account,transport:'website-session',diagnostics:{...diagnostics(doc,repository),live:diagnostics(document,repository)}};
  }
  return {dispatch};
 }
 root.KiCadGitHubSessionReview={create,scope,objects,diagnostics,login,threadData,discussionData,composer,newIssueComposer,newDiscussionComposer,issueLocation,screenshotBytes,uploadedScreenshot,leaseSafe};
 if(typeof module==='object'&&module.exports)module.exports=root.KiCadGitHubSessionReview;
})(globalThis);
