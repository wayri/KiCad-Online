"use strict";
(function(root) {
  const SHA=/^[a-f0-9]{40}$/i, REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  function safePath(path, empty=false) {
    return typeof path==='string' && path.length<=500 && (empty&&path==='' || path!==''&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\\:\x00-\x1f\x7f]/.test(p)));
  }
  function scope(repository,ref) {
    if(!REPO.test(repository||'')||repository.split('/').some(p=>p==='.'||p==='..')||typeof ref!=='string'||!ref||ref.length>200||ref.split('/').some(p=>!p||p==='.'||p==='..')||/[\\:\x00-\x1f\x7f?#]/.test(ref))throw Error('Invalid GitHub session location.');
  }
  function treeData(objects, ref, directory) {
    if(!Array.isArray(objects))throw Error('Invalid GitHub website payload.');
    const routes=[...new Set(objects.flatMap(v=>[v?.payload?.codeViewTreeRoute,v?.payload?.codeViewRepoRoute,
      v?.payload?.tree&&v?.payload?.refInfo?v.payload:null]))].filter(v=>v && v.tree!==undefined && (v.path??'/')===(directory||'/'));
    if(!routes.length)throw Error('The GitHub website did not expose a readable repository tree. Check repository website access, then retry.');
    const items=new Map();let sha=null;
    for(const route of routes){
      const oid=route.refInfo?.currentOid,tree=route.tree;
      if(!SHA.test(oid||'')||(SHA.test(ref)?oid.toLowerCase()!==ref.toLowerCase():ref!=='HEAD'&&route.refInfo?.name!==ref))throw Error('GitHub session returned a different revision.');
      if(sha&&sha!==oid.toLowerCase())throw Error('GitHub website returned conflicting directory revisions.');sha=oid.toLowerCase();
      if(!Array.isArray(tree?.items)||tree.items.length>2000||tree.truncated)throw Error('GitHub website directory is incomplete. Open a smaller project folder; additional saved files may exist.');
      const own=new Map();for(const item of tree.items){
        if(!safePath(item?.path)||!['file','directory','symlink','submodule'].includes(item.contentType))throw Error('GitHub session directory contains an unsafe entry.');
        const direct=item.path.split('/').slice(0,-1).join('/')===directory;
        // GitHub compresses single-child folder chains into one directory row.
        // Accept only its explicit marker and exact safe relative display path;
        // files, traversal and entries outside this pinned directory still fail.
        const simplified=!direct&&item.contentType==='directory'&&item.hasSimplifiedPath===true&&safePath(item.name)&&item.name.includes('/')&&item.path===(directory?directory+'/':'')+item.name;
        if(!direct&&!simplified)throw Error('GitHub session directory contains an unsafe entry.');
        for(const previous of [own.get(item.path),items.get(item.path)])if(previous&&previous.type!==item.contentType)throw Error('Conflicting GitHub website entry types: '+item.path);
        const value={path:item.path,type:item.contentType,...(simplified?{hasSimplifiedPath:true}:{})};own.set(item.path,value);items.set(item.path,value);
      }
      if(own.size>1000||tree.totalCount!==own.size)throw Error('GitHub website directory is incomplete. Open a smaller project folder; additional saved files may exist.');
    }
    return {sha,items:[...items.values()]};
  }
  function contextData(objects,repository,path=''){
    if(!safePath(path,true)||path&&(!path.startsWith('tree/')||path.split('/').length<2)||/[?#%]/.test(path))throw Error('Invalid GitHub session context path.');
    const parser=root.KiCadGitHub||(typeof require==='function'?require('./parsing.js'):null),source='https://github.com/'+repository+(path?'/'+path.split('/').map(encodeURIComponent).join('/'):''),route=parser?.repositoryRoute(source),ref=route&&parser.repositoryRef(route,objects.map(value=>JSON.stringify(value)));
    if(!route||route.repository!==repository||!ref)throw Error('GitHub website context is unavailable. Open this repository on GitHub and complete website sign-in or organization access.');scope(repository,ref);
    const tail=route.tail?.join('/');if(tail&&tail!==ref&&!tail.startsWith(ref+'/'))throw Error('GitHub session context returned a different branch.');const directory=tail?tail.slice(ref.length).replace(/^\//,''):'';if(!safePath(directory,true))throw Error('Invalid GitHub session context directory.');
    return {repository,ref,directory,...treeData(objects,ref,directory)};
  }
  // Service workers have no DOMParser. Read inert JSON script payloads only.
  function htmlObjects(html){
    if(typeof html!=='string'||new TextEncoder().encode(html).length>8*1024*1024)throw Error('GitHub website page exceeds its size limit.');
    const objects=[];for(const match of html.matchAll(/<script\b([^>]*?)>([\s\S]*?)<\/script\s*>/gi)){
      if(!/\btype\s*=\s*(?:"application\/json"|'application\/json'|application\/json)(?=\s|$)/i.test(match[1]))continue;
      if(objects.length>=100)throw Error('GitHub website contains too many JSON payloads.');
      try{objects.push(JSON.parse(match[2]));}catch{}
    }
    return objects;
  }
  // Some signed-in GitHub pages expose a server-rendered file table without
  // hydration JSON. Read only that named table and its exact repository links.
  function documentObjects(doc,href){
    const objects=[...(doc?.querySelectorAll('script[type="application/json"]')||[])].map(n=>{try{return JSON.parse(n.textContent);}catch{return null;}});
    // A route shell without a tree is not directory data. GitHub can retain
    // these shells beside a fully server-rendered file table.
    if(objects.some(v=>v?.payload?.codeViewTreeRoute?.tree!==undefined||v?.payload?.codeViewRepoRoute?.tree!==undefined||v?.payload?.tree&&v?.payload?.refInfo))return objects;
    const page=new URL(href),parts=page.pathname.split('/').filter(Boolean).map(decodeURIComponent),repository=parts.slice(0,2).join('/');
    if(page.origin!=='https://github.com'||parts.length<2||parts.length>2&&parts[2]!=='tree')return objects;
    const table=doc?.querySelector('table[aria-labelledby="folders-and-files"]'),selector=doc?.querySelector('[id="ref-picker-repos-header-ref-selector"]');
    if(!table||!selector)return objects;
    const ref=SHA.test(parts[3]||'')?parts[3]:selector.textContent.trim();scope(repository,ref);
    const tail=parts.slice(3).join('/');if(tail&&tail!==ref&&!tail.startsWith(ref+'/'))throw Error('GitHub file table returned a different branch.');
    const directory=tail?tail.slice(ref.length).replace(/^\//,''):'';if(!safePath(directory,true))throw Error('Invalid GitHub file table directory.');
    let sha=SHA.test(ref)?ref.toLowerCase():null;
    if(!sha){
      // A nested folder's last change is not necessarily the branch HEAD.
      // Only the repository root's latest commit is authoritative here.
      if(directory){objects.push({githubFileTableContext:{repository,ref,directory}});return objects;}
      const commit=[...(doc.querySelectorAll('main a[href]')||[])].map(a=>new URL(a.getAttribute('href'),page)).find(u=>u.origin===page.origin&&u.pathname.startsWith('/'+repository+'/commit/')&&SHA.test(u.pathname.slice(('/'+repository+'/commit/').length)));
      if(!commit)return objects;sha=commit.pathname.split('/').at(-1).toLowerCase();
    }
    const items=new Map(),rows=[...table.querySelectorAll('tr')];if(rows.length>1001||/truncat|too many files|unable to (?:load|display)/i.test(table.textContent||''))throw Error('GitHub website directory is incomplete.');
    for(const row of rows){const candidates=[...row.querySelectorAll('a[href]')].map(a=>new URL(a.getAttribute('href'),page)).filter(u=>u.origin===page.origin&&!u.search&&!u.hash);
      for(const u of candidates){const segments=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);if(segments.slice(0,2).join('/')!==repository||!['tree','blob'].includes(segments[2]))continue;
        const suffix=segments.slice(3).join('/');if(!suffix.startsWith(ref+'/'))continue;const path=suffix.slice(ref.length+1);if(!safePath(path))throw Error('Unsafe GitHub file table entry.');
        if(path.split('/').slice(0,-1).join('/')!==directory)continue;
        const contentType=segments[2]==='tree'?'directory':'file',prior=items.get(path);if(prior&&prior.contentType!==contentType)throw Error('Conflicting GitHub file table entry types.');items.set(path,{path,contentType});
      }
    }
    if(!items.size)return objects;
    objects.push({payload:{codeViewTreeRoute:{path:directory||'/',refInfo:{name:ref,currentOid:sha},tree:{items:[...items.values()],totalCount:items.size,truncated:false}}}});return objects;
  }
  function websiteError(status,html=''){
    const text=String(html).slice(0,1024*1024),failure=message=>Object.assign(Error(message),{code:status===429?'GITHUB_WEBSITE_RATE_LIMIT':status===404?'GITHUB_WEBSITE_NOT_FOUND':status===401||status===403?'GITHUB_WEBSITE_DENIED':'GITHUB_WEBSITE_UNREADABLE',source:'github-website',status,accessIssue:{kind:status===429?'website-rate-limit':'website-access',confirmed:status===429,title:status===429?'GitHub website temporarily limited':'GitHub website access unavailable',message,action:'Check this repository directly on GitHub and retry. Project discovery reads the website, not the GitHub API.'}});
    if(status===429||/too many requests|secondary rate limit/i.test(text))return failure('GitHub website requests are temporarily limited. Retry shortly. This project read does not use the GitHub API.');
    if(/ERR_BLOCKED_BY_ADMINISTRATOR|blocked by (?:your )?(?:organization|administrator)|organization policy|administrator policy/i.test(text))return failure('Browser or organization policy blocked the GitHub website request. Allow this repository website in the browser policy, then retry.');
    if(status===401||status===403||/SAML|single sign.on|access denied/i.test(text))return failure('GitHub website access was denied'+(status?' (HTTP '+status+')':'')+'. Open this repository on GitHub and complete its sign-in or organization access requirement, then retry.');
    if(status===404)return failure('The GitHub repository, branch or folder was not found (website HTTP 404). Check the saved repository URL and revision.');
    return failure('GitHub did not provide a readable repository page'+(status?' (website HTTP '+status+')':'')+'. Open the repository on GitHub to check access, then retry.');
  }
  function rawText(content,path){
    if(/\.(?:kicad_(?:sch|pcb|pro|mod|sym|dru)|sch|pro|brd|lib)$/i.test(path)&&/^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b|<title\b|<form\b)/i.test(content))throw Error('GitHub returned an HTML website page instead of saved KiCad source. Check repository website access; no source was cached.');
    return content;
  }
  async function bounded(response,limit,signal,binary=false) {
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('GitHub session response exceeds its size limit.');}
    const reader=response.body.getReader(), chunks=[];let size=0;
    const cancel=()=>reader.cancel().catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('GitHub session response exceeds its size limit.');}chunks.push(value);}}finally{signal?.removeEventListener('abort',cancel);}
    if(signal?.aborted)throw Error('Project loading cancelled.');
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return binary?bytes:new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  function create({fetch:fetcher=root.fetch,location=root.location,signal,parseDocument=()=>documentObjects(root.document,location.href),parseHTML=(html,url)=>documentObjects(new DOMParser().parseFromString(html,'text/html'),url),parsePullHTML=(html)=>new DOMParser().parseFromString(html,'text/html')}={}) {
    async function read(message) {
      const {repository,ref,action,path='',limit=8*1024*1024}=message;scope(repository,ref);
      const here=new URL(location.href);
      if(here.origin!=='https://github.com'||here.pathname.split('/').slice(1,3).join('/').toLowerCase()!==repository.toLowerCase())throw Error('A signed-in tab for this repository must remain open.');
      if(!['resolve','directory','file','asset','history','branches','commit','context','pull','pulls'].includes(action)||!safePath(path,true))throw Error('Unsupported GitHub session read.');
      if(!['resolve','history','branches','context','commit','pull','pulls'].includes(action)&&!SHA.test(ref))throw Error('GitHub session reads require a pinned commit.');
      if(action==='commit'&&!/^[a-f0-9]{7,40}$/i.test(ref))throw Error('Invalid GitHub commit ID.');
      if(action==='pulls'&&(ref!=='HEAD'||path!==''))throw Error('Invalid GitHub PR list request.');
      if(action==='pull'&&(ref!=='HEAD'||! /^[1-9][0-9]{0,9}$/.test(path)||!Number.isSafeInteger(Number(path))))throw Error('Invalid GitHub PR number.');
      if(['history','branches','commit'].includes(action)&&path!=='')throw Error('Invalid GitHub history path.');
      if(signal?.aborted)throw Error('Project loading cancelled.');
      const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(),30000);
      signal?.addEventListener('abort',abort,{once:true});
      try {
        if(action==='context'){
          if(ref!=='HEAD'||!safePath(path,true)||path&&(!path.startsWith('tree/')||path.split('/').length<2)||/[?#%]/.test(path))throw Error('Invalid GitHub session context.');
          const url='https://github.com/'+repository+(path?'/'+path.split('/').map(encodeURIComponent).join('/'):''),current=here.origin+here.pathname.replace(/\/$/,'');
          const pageObjects=async target=>{if(controller.signal.aborted)throw Error('Project loading cancelled.');const response=await fetcher(target,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
            if(!response.ok)throw websiteError(response.status,await bounded(response,1024*1024,controller.signal));if(response.url&&response.url!==target)throw Error('GitHub session context returned a different repository location.');
            return parseHTML(await bounded(response,8*1024*1024,controller.signal),target);};
          const resolveContext=async objects=>{try{return contextData(objects,repository,path);}catch(error){if(/unsafe|different|incomplete|conflicting|Invalid/.test(error.message))throw error;}
            // A classic nested table identifies a branch and folder, but its
            // last-change commit does not identify branch HEAD. Resolve the
            // branch root first, then re-read this directory at that exact SHA.
            const hints=objects.filter(value=>value?.githubFileTableContext).map(value=>value.githubFileTableContext);if(!hints.length)return null;
            if(hints.length!==1)throw Error('Conflicting GitHub file table contexts.');const hint=hints[0];scope(repository,hint.ref);
            if(hint.repository!==repository||!safePath(hint.directory)||SHA.test(hint.ref)||path!=='tree/'+hint.ref+'/'+hint.directory)throw Error('Invalid GitHub file table context.');
            const branchURL='https://github.com/'+repository+'/tree/'+encodeURIComponent(hint.ref),snapshot=treeData(await pageObjects(branchURL),hint.ref,'');
            const pinnedURL='https://github.com/'+repository+'/tree/'+snapshot.sha+'/'+hint.directory.split('/').map(encodeURIComponent).join('/'),result=treeData(await pageObjects(pinnedURL),snapshot.sha,hint.directory);
            if(controller.signal.aborted)throw Error('Project loading cancelled.');return {repository,ref:hint.ref,directory:hint.directory,...result};};
          if(current===url&&!here.search){const result=await resolveContext(parseDocument());if(result)return result;}
          const objects=await pageObjects(url),result=await resolveContext(objects);return result||contextData(objects,repository,path);
        }
        if(action==='pull'||action==='pulls'){
          const parser=root.KiCadGitHubWebsitePulls||(typeof require==='function'?require('./github-website-pulls.js'):null),url='https://github.com/'+repository+(action==='pull'?'/pull/'+path:'/pulls');
          if(!parser)throw Error('Reload the repository session to enable PR discovery.');
          const response=await fetcher(url,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
          if(!response.ok)throw websiteError(response.status,await bounded(response,1024*1024,controller.signal));
          if(response.url&&response.url!==url||!/text\/html/i.test(response.headers.get('content-type')||''))throw Error('GitHub returned a different PR location or format.');
          const doc=parsePullHTML(await bounded(response,8*1024*1024,controller.signal));return action==='pull'?parser.fromDocument(doc,{repository,number:Number(path),url}):parser.listFromDocument(doc,{repository});
        }
        if(action==='branches'||action==='commit'){
          const parser=root.KiCadGitHubWebsiteHistory||(typeof require==='function'?require('./github-website-history.js'):null);if(!parser)throw Error('Reload the repository session to enable branch history.');
          const url=`https://github.com/${repository}/${action==='branches'?'branches/all':'commit/'+ref}`,response=await fetcher(url,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
          if(!response.ok)throw websiteError(response.status,await bounded(response,1024*1024,controller.signal));
          if(response.url&&response.url!==url||!/text\/html/i.test(response.headers.get('content-type')||''))throw Error('GitHub website returned a different metadata location or format.');
          const objects=htmlObjects(await bounded(response,8*1024*1024,controller.signal));
          return action==='branches'?parser.parseBranches(objects,{repository}):parser.parseCommit(objects,{repository,ref});
        }
        if(action==='history'){
          const url=`https://github.com/${repository}/commits/${encodeURIComponent(ref)}.atom`,response=await fetcher(url,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
          if(!response.ok||response.url&&response.url!==url||!/atom|xml/i.test(response.headers.get('content-type')||''))throw Error('GitHub website commit history is unavailable for this repository.');
          return {ref,content:await bounded(response,4*1024*1024,controller.signal)};
        }
        if(action==='file'||action==='asset') {
          if(!safePath(path)||!Number.isInteger(limit)||limit<1||limit>(action==='asset'?32:64)*1024*1024)throw Error('Invalid GitHub session file.');
          const suffix=`/${repository}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`;
          const response=await fetcher(`https://github.com/${repository}/raw/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`,{credentials:'same-origin',redirect:'follow',cache:'no-store',signal:controller.signal});
          if(response.status===404)return null;
          const final=new URL(response.url);
          // GitHub serves repository LFS assets through its media host. Bind the
          // redirect to this exact repository, immutable revision and encoded
          // filename; signed query strings remain in the page's fetch only.
          const lfsAsset=action==='asset'&&final.origin==='https://media.githubusercontent.com'&&final.pathname==='/media'+suffix;
          if(!response.ok||final.username||final.password||final.hash||!(final.origin==='https://raw.githubusercontent.com'&&final.pathname===suffix||final.origin==='https://github.com'&&final.pathname===`/${repository}/raw/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`||lfsAsset)||/html/i.test(response.headers.get('content-type')||''))throw Error('GitHub session could not download this file. Open this repository on GitHub and complete website sign-in or organization access.');
          if(action==='asset') {
            const bytes=await bounded(response,limit,controller.signal,true),pieces=[];
            for(let i=0;i<bytes.length;i+=8192)pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
            return {base64:btoa(pieces.join('')),sha:ref.toLowerCase()};
          }
          return {content:rawText(await bounded(response,limit,controller.signal),path),sha:ref.toLowerCase()};
        }
        const directory=action==='resolve'?'':path;
        // Reuse the repository page already downloaded by Chrome before fetching
        // another HTML directory. treeData still verifies exact pinned identity.
        const rootPage=here.pathname.replace(/\/$/,'').toLowerCase()===`/${repository}`.toLowerCase()&&!here.search;
        if(ref!=='HEAD'||rootPage){try{return treeData(parseDocument(),ref,directory);}catch{}}
        const url=ref==='HEAD'?`https://github.com/${repository}`:`https://github.com/${repository}/tree/${encodeURIComponent(ref)}${directory?'/'+directory.split('/').map(encodeURIComponent).join('/'):''}`;
        const response=await fetcher(url,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
        if(!response.ok)throw websiteError(response.status,await bounded(response,1024*1024,controller.signal));
        return treeData(parseHTML(await bounded(response,8*1024*1024,controller.signal),url),ref,directory);
      } catch(error) {
        // Only fixed diagnostic codes cross the session bridge. Raw HTML,
        // private paths, signed URLs and arbitrary provider text stay here.
        if(typeof error?.code!=='string'){
          let code;
          if(controller.signal.aborted)code=signal?.aborted?'GITHUB_READ_CANCELLED':'GITHUB_READ_TIMEOUT';
          else if(error instanceof TypeError)code=/fetch|network|load failed/i.test(error.message)?'GITHUB_WEBSITE_NETWORK':'GITHUB_READ_FORMAT';
          else if(/context is unavailable|readable repository tree/.test(error?.message))code='GITHUB_TREE_UNAVAILABLE';
          else if(/different revision|different branch|different repository location|conflicting directory revisions/.test(error?.message))code='GITHUB_REVISION_MISMATCH';
          else if(/incomplete/.test(error?.message))code='GITHUB_TREE_INCOMPLETE';
          else if(/size limit|too many JSON/.test(error?.message))code='GITHUB_READ_TOO_LARGE';
          if(code)error=Object.assign(Error(error?.message||'GitHub website read failed.'),{code});
        }
        throw error;
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    return {read};
  }
  root.KiCadGitHubSessionReader={create,treeData,contextData,documentObjects,safePath,htmlObjects,websiteError,rawText};
  if(typeof module==='object'&&module.exports)module.exports=root.KiCadGitHubSessionReader;
})(typeof globalThis==='object'?globalThis:this);
