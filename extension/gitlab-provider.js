/* Token-free GitLab content reads on one approved origin. Matching website tabs
 * may use session cookies for GitLab read API endpoints; this is not API-free.
 * Public fallback omits credentials. Review/account APIs remain separate. */
((root) => {
  'use strict';
  function forHost(host='https://gitlab.com',{sessionRead,signal,foregroundOnly=false}={}){
    const parsed=new URL(host);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw new Error('Invalid GitLab host.');host=parsed.origin;
  const MIB=1024*1024, SHA=/^[a-f0-9]{40}$/i;
  const validRepository=value=>typeof value==='string'&&value.length<=300&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value)&&value.split('/').every(p=>p!=='.'&&p!=='..');
  const validPath=value=>typeof value==='string'&&value.length<=500&&value.length>0&&!value.startsWith('/')&&!/[\\:\x00-\x1f\x7f]/.test(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');
  function scope(repository,ref,file){if(!validRepository(repository)||!root.KiCadBrowserData.validRef(ref)||!validPath(file))throw new Error('Invalid GitLab project location.');}
  function endpoint(repository){if(!validRepository(repository))throw new Error('Invalid GitLab repository.');return host+'/api/v4/projects/'+encodeURIComponent(repository)+'/repository';}
  const validRef=value=>root.KiCadBrowserData.validRef(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[\\:]/.test(part));
  function readURL(url,limit){
    const target=new URL(url),match=target.pathname.match(/^\/api\/v4\/projects\/([^/]+)(.*)$/);
    if(target.origin!==host||target.username||target.password||target.hash||!match||!Number.isSafeInteger(limit)||limit<1||limit>256*MIB)throw Error('Invalid GitLab content endpoint or byte limit.');
    const project=decodeURIComponent(match[1]),tail=match[2];if(!validRepository(project)&&!(/^[1-9][0-9]{0,11}$/.test(project)&&tail===''))throw Error('Invalid GitLab content project.');
    let keys;
    if(tail==='')keys=[];
    else if(tail==='/repository/tree')keys=['ref','recursive','per_page','page','path'];
    else if(tail==='/repository/branches')keys=['per_page','page'];
    else if(tail==='/repository/commits')keys=['ref_name','path','per_page','page'];
    else if(tail==='/repository/compare')keys=['from','to','straight'];
    else if(/^\/repository\/commits\/[^/]+$/.test(tail)){if(!validRef(decodeURIComponent(tail.split('/').at(-1))))throw Error('Invalid GitLab content revision.');keys=[];}
    else if(/^\/repository\/files\/[^/]+\/raw$/.test(tail)){if(!validPath(decodeURIComponent(tail.split('/')[3])))throw Error('Invalid GitLab content file.');keys=['ref'];}
    else if(/^\/merge_requests\/[1-9][0-9]{0,8}$/.test(tail))keys=[];
    else throw Error('GitLab content transport supports bounded read endpoints only.');
    const seen=new Set();for(const [key,value]of target.searchParams){
      if(!keys.includes(key)||seen.has(key)||value.length>500||/[\x00-\x1f\x7f]/.test(value))throw Error('Invalid GitLab content query.');seen.add(key);
      if(['ref','ref_name','from','to'].includes(key)&&!validRef(value))throw Error('Invalid GitLab content revision.');
      if(key==='path'&&value!==''&&!validPath(value))throw Error('Invalid GitLab content directory.');
      if(['recursive','straight'].includes(key)&&!['true','false'].includes(value))throw Error('Invalid GitLab content flag.');
      if(['page','per_page'].includes(key)&&(!/^[1-9][0-9]{0,3}$/.test(value)||Number(value)>(key==='per_page'?100:1000)))throw Error('Invalid GitLab content pagination.');
    }
    return target;
  }
  function contentError(code,status){
    const messages={GITLAB_SAML_REQUIRED:'GitLab website requires SSO/SAML verification. Complete it in the matching project tab, then retry.',GITLAB_LOGIN_REQUIRED:'GitLab website sign-in is required. Open this exact project in a signed-in tab on its approved server, then retry.',GITLAB_UNEXPECTED_HTML:'GitLab returned HTML instead of the requested project data. Check the matching website tab for sign-in, SSO/SAML or an access-denied page.'};
    return Object.assign(Error(messages[code]||`GitLab content returned HTTP ${status}. Open this exact project in a signed-in tab on its approved server and complete any required SSO/SAML. File loading does not use review-account tokens.`),{code:code||'GITLAB_CONTENT_ACCESS'});
  }
  function checkBytes(bytes,target,type=''){
    const sample=new TextDecoder().decode(bytes.subarray(0,16384)),looksHTML=/text\/html/i.test(type)||/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<form\b)/i.test(sample);
    if(!looksHTML)return;
    if(/<input\b[^>]*\bname\s*=\s*["']SAML(?:Request|Response)["']|<form\b[^>]*\baction\s*=\s*["'][^"']*(?:\/saml|\/sso)/i.test(sample))throw contentError('GITLAB_SAML_REQUIRED');
    if(/<input\b[^>]*\btype\s*=\s*["']password["']|<form\b[^>]*\baction\s*=\s*["'][^"']*\/users\/sign_in/i.test(sample))throw contentError('GITLAB_LOGIN_REQUIRED');
    const raw=target.pathname.match(/\/repository\/files\/([^/]+)\/raw$/),htmlReport=raw&&/\.html?$/i.test(decodeURIComponent(raw[1]));
    if(!htmlReport)throw contentError('GITLAB_UNEXPECTED_HTML');
  }
  async function readSession(url,limit){
    let timer,abort;
    try{return await Promise.race([Promise.resolve().then(()=>sessionRead(url,limit)),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('GitLab website session timed out.')),30000);
      abort=()=>reject(Error('Project loading cancelled.'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function response(url,limit=4*MIB){
    const target=readURL(url,limit),permit=async()=>{if(signal?.aborted)throw Error('Project loading cancelled.');await root.KiCadManagedPolicy?.assertNetwork?.();};
    await permit();let sessionFailure=null;
    if(sessionRead){
      try{const session=await readSession(target.href,limit);await permit();if(session){if(!(session.bytes instanceof Uint8Array)||session.bytes.byteLength>limit||typeof session.next!=='string'||session.next&&!/^[1-9][0-9]{0,3}$/.test(session.next)||!['','<next>; rel="next"'].includes(session.link))throw Object.assign(Error('Invalid or oversized GitLab website session response.'),{definitive:true});checkBytes(session.bytes,target);return session;}}
      catch(error){if(['GITLAB_SAML_REQUIRED','GITLAB_LOGIN_REQUIRED','GITLAB_UNEXPECTED_HTML'].includes(error?.code))throw contentError(error.code);if(signal?.aborted||error?.code==='MANAGED_POLICY'||error?.definitive)throw error;sessionFailure=error;}
    }
    if(foregroundOnly)throw sessionFailure||Object.assign(Error('Open this GitLab repository in the same signed-in browser profile and click the extension icon again. Project files are read only through that website tab.'),{code:'GITLAB_LOGIN_REQUIRED',definitive:true});
    await permit();const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(),60000);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      const result=await fetch(target.href,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      if(!result.ok){await result.body?.cancel?.();if(result.status===404&&!sessionFailure)return null;if(['GITLAB_SAML_REQUIRED','GITLAB_LOGIN_REQUIRED','GITLAB_UNEXPECTED_HTML'].includes(sessionFailure?.code))throw contentError(sessionFailure.code);throw contentError(null,result.status);}
      if(Number(result.headers.get('content-length'))>limit){await result.body?.cancel?.();throw Error('GitLab response exceeds its size limit.');}
      const reader=result.body.getReader(),chunks=[];let length=0;
      const cancelBody=()=>reader.cancel().catch(()=>{});controller.signal.addEventListener('abort',cancelBody,{once:true});if(controller.signal.aborted)cancelBody();
      try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('GitLab response exceeds its size limit.');}chunks.push(value);}}finally{controller.signal.removeEventListener('abort',cancelBody);}
      if(controller.signal.aborted)throw Error(signal?.aborted?'Project loading cancelled.':'GitLab retrieval timed out.');
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      await permit();checkBytes(bytes,target,result.headers.get('content-type')||'');const next=result.headers.get('x-next-page')||'';if(next&&!/^[1-9][0-9]{0,3}$/.test(next))throw Error('Invalid GitLab pagination metadata.');
      return {bytes,next,link:/rel="next"/.test(result.headers.get('link')||'')?'<next>; rel="next"':''};
    }catch(error){if(error.name==='AbortError')throw Error(signal?.aborted?'Project loading cancelled.':'GitLab retrieval timed out.');throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function json(url){const result=await response(url);if(!result)throw new Error('GitLab resource was not found or access is unavailable.');return {...result,value:JSON.parse(new TextDecoder().decode(result.bytes))};}
  async function file(repository,ref,path){scope(repository,ref,path);const result=await response(`${endpoint(repository)}/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`,root.KiCadBrowserData.fileByteLimit(path));return result?new TextDecoder().decode(result.bytes):null;}
  async function resolve(repository,ref,path){scope(repository,ref,path);const {value}=await json(`${endpoint(repository)}/commits/${encodeURIComponent(ref)}`);if(!SHA.test(value?.id)||SHA.test(ref)&&value.id.toLowerCase()!==ref.toLowerCase())throw new Error('GitLab did not resolve the requested immutable revision.');return {repository,ref,sha:value.id.toLowerCase()};}
  async function tree(repository,ref,directory='',recursive=true){
    if(directory&&!validPath(directory))throw new Error('Invalid GitLab directory.');
    const entries=[],warnings=[];let more=false;
    for(let page=1;page<=10;page++){
      const query=new URLSearchParams({ref,recursive:String(recursive),per_page:'100',page:String(page),...(directory?{path:directory}:{})});
      const {value,next,link}=await json(`${endpoint(repository)}/tree?${query}`);if(!Array.isArray(value)||value.length>100)throw new Error('Invalid GitLab tree listing.');entries.push(...value);
      more=!!next||/rel="next"/.test(link)||value.length===100;if(!more)break;
    }
    if(more)warnings.push('GitLab tree discovery stopped at 1000 entries; the project listing may be incomplete.');
    return {entries:entries.filter(item=>item?.type==='blob'&&item.mode!=='120000'&&validPath(item.path)),warnings};
  }
  async function directory(repository,ref,path,includeBoards=false){const result=await tree(repository,ref,path,false);if(result.warnings.length)throw new Error(result.warnings[0]);return result.entries.filter(item=>(includeBoards?/\.(?:kicad_(?:sch|pcb)|sch)$/i:/\.(?:kicad_sch|sch)$/i).test(item.path)&&item.path.split('/').slice(0,-1).join('/')===path).map(item=>item.path);}
  async function schematics(repository,ref){
    if(!validRepository(repository)||!SHA.test(ref||''))throw new Error('A pinned GitLab commit is required for schematic discovery.');
    const listing=await tree(repository,ref);if(listing.warnings.length)throw new Error(listing.warnings[0]);
    const files=listing.entries.filter(item=>/\.(?:kicad_sch|sch)$/i.test(item.path)).map(item=>item.path);
    if(files.length>root.KiCadBrowserData.PROJECT_MAX_FILES)throw new Error('More than 128 parent-sheet candidates; open the project root directly.');
    return files.sort();
  }
  async function inventory(repository,ref,path){scope(repository,ref,path);const snapshot=await resolve(repository,ref,path),listing=await tree(repository,snapshot.sha);return {files:listing.entries.filter(item=>root.KiCadGitHub.filePath(item.path)).sort((a,b)=>a.path.localeCompare(b.path)).map(item=>({path:item.path,size:0})),snapshotRef:snapshot.sha,warnings:listing.warnings};}
  async function modelIndex(repository,ref){
    if(!validRepository(repository)||!SHA.test(ref||''))throw Error('Model discovery requires a repository and immutable revision.');
    const listing=await tree(repository,ref);
    const paths=[...new Set(listing.entries.filter(item=>/\.(wrl|vrml|glb|step|stp)$/i.test(item.path)&&!/[?#%]/.test(item.path)).map(item=>item.path))].sort();
    return {paths,snapshotRef:ref,warnings:listing.warnings};
  }
  async function projectFile(repository,ref,path){scope(repository,ref,path);if(!root.KiCadGitHub.filePath(path))throw new Error('Unsupported project file.');const content=await file(repository,ref,path);if(content===null)throw new Error('Project file unavailable at this revision.');return {path,content};}
  async function search(repository,ref,path){const listing=await inventory(repository,ref,path),warnings=[...listing.warnings];const drawings=listing.files.filter(item=>root.KiCadBrowserData.validPath(item.path)).sort((a,b)=>(b.path===path?1:0)-(a.path===path?1:0)),settings=listing.files.filter(item=>/\.kicad_pro$/i.test(item.path));const files=[],saved=[];let total=0;
    for(const item of drawings.slice(0,32)){try{const content=await file(repository,listing.snapshotRef,item.path);if(content===null){warnings.push(`${item.path}: unavailable.`);continue;}const bytes=new TextEncoder().encode(content).length;if(total+bytes>root.KiCadBrowserData.PROJECT_MAX_BYTES){warnings.push('Project search reached its 96 MiB source limit.');break;}total+=bytes;files.push({path:item.path,content});}catch(error){warnings.push(`${item.path}: ${error.message}`);}}
    for(const item of settings.slice(0,8)){try{const content=await file(repository,listing.snapshotRef,item.path);if(content!==null&&new TextEncoder().encode(content).length<=MIB)saved.push({path:item.path,content});else warnings.push(`${item.path}: settings unavailable or exceed 1 MiB.`);}catch(error){warnings.push(`${item.path}: ${error.message}`);}}
    if(drawings.length>32)warnings.push('Project search loads at most 32 drawings.');if(settings.length>8)warnings.push('Only the first eight project settings files were retrieved.');return {files,settings:saved,warnings,snapshotRef:listing.snapshotRef,totalDrawings:drawings.length};
  }
  async function branches(repository,ref,path){scope(repository,ref,path);return repositoryBranches(repository,ref);}
  async function repositoryBranches(repository,ref){if(!validRepository(repository)||!root.KiCadBrowserData.validRef(ref))throw Error('Invalid GitLab repository location.');const {value,next,link}=await json(`${endpoint(repository)}/branches?per_page=100&page=1`);if(!Array.isArray(value)||value.length>100)throw new Error('Invalid GitLab branch listing.');return {repository,branches:value.filter(item=>root.KiCadBrowserData.validRef(item?.name)&&SHA.test(item?.commit?.id)).map(item=>({name:item.name,sha:item.commit.id})),warnings:next||/rel="next"/.test(link)||value.length===100?['At most 100 branches shown; enter another branch manually.']:[]};}
  async function commits(repository,ref,path){const snapshot=await resolve(repository,ref,path),query=new URLSearchParams({ref_name:snapshot.sha,path,per_page:'50',page:'1'});const {value,next,link}=await json(`${endpoint(repository)}/commits?${query}`);if(!Array.isArray(value)||value.length>50)throw new Error('Invalid GitLab commit listing.');const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300):'';return {repository,file:path,snapshotRef:snapshot.sha,commits:value.filter(item=>SHA.test(item?.id)).map(item=>({sha:item.id,message:clean(item.title),author:clean(item.author_name),date:clean(item.authored_date)})),warnings:next||/rel="next"/.test(link)||value.length===50?['At most 50 commits shown; enter an older SHA manually.']:[]};}
  function repositoryPage(page=1){if(!Number.isSafeInteger(page)||page<1||page>100)throw Error('Repository page must be between 1 and 100.');return page;}
  async function repositorySnapshot(repository,ref){
    if(!validRepository(repository)||!root.KiCadBrowserData.validRef(ref))throw Error('Invalid GitLab repository location.');
    if(SHA.test(ref))return ref.toLowerCase();
    const {value}=await json(`${endpoint(repository)}/commits/${encodeURIComponent(ref)}`);if(!SHA.test(value?.id||''))throw Error('GitLab did not resolve an immutable repository revision.');return value.id.toLowerCase();
  }
  function repositoryMessage(value,warnings){
    if(typeof value!=='string')return '';value=value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
    const encoder=new TextEncoder();if(encoder.encode(value).length<=8192)return value;
    let low=0,high=Math.min(value.length,8192);while(low<high){const middle=Math.ceil((low+high)/2);if(encoder.encode(value.slice(0,middle)).length<=8192)low=middle;else high=middle-1;}
    warnings.push('A commit message was shortened to 8 KiB.');return value.slice(0,low);
  }
  async function repositoryTree(repository,ref,{page=1,directory}={}){
    page=repositoryPage(page);if(directory!==undefined&&directory!==''&&!validPath(directory))throw Error('Invalid GitLab repository directory.');
    const sha=await repositorySnapshot(repository,ref),recursive=directory===undefined,query=new URLSearchParams({ref:sha,recursive:String(recursive),per_page:'100',page:String(page),...(directory?{path:directory}:{})});
    const {value,next,link}=await json(`${endpoint(repository)}/tree?${query}`);if(!Array.isArray(value)||value.length>100)throw Error('Invalid GitLab repository tree.');
    const entries=[],warnings=[],seenPaths=new Set(),modes={tree:['040000'],blob:['100644','100755','120000'],commit:['160000']};
    for(const item of value){
      if(!item||seenPaths.has(item.path)||!validPath(item.path)||!SHA.test(item.id||'')||!modes[item.type]?.includes(item.mode)||directory!==undefined&&item.path.split('/').slice(0,-1).join('/')!==directory){warnings.push('Invalid repository entry omitted.');continue;}
      seenPaths.add(item.path);entries.push({path:item.path,type:item.type,sha:item.id.toLowerCase(),mode:item.mode});
    }
    const more=Boolean(next)||/rel="next"/.test(link)||value.length===100,hasMore=more&&page<100;
    if(more&&!hasMore)warnings.push('Repository tree browsing stopped at 10,000 entries; expand folders to inspect their pinned contents.');
    return {repository,ref,sha,snapshotRef:sha,directory:directory||'',entries,truncated:more||entries.length!==value.length,hasMore,nextPage:hasMore?page+1:null,warnings:[...new Set(warnings)]};
  }
  async function repositoryHistory(repository,ref,page=1){
    page=repositoryPage(page);const sha=await repositorySnapshot(repository,ref),query=new URLSearchParams({ref_name:sha,per_page:'30',page:String(page)});
    const {value,next,link}=await json(`${endpoint(repository)}/commits?${query}`);if(!Array.isArray(value)||value.length>30)throw Error('Invalid GitLab repository history.');
    const warnings=[],commits=[],seen=new Set(),text=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,200):'';
    for(const item of value){
      if(!SHA.test(item?.id||'')||seen.has(item.id.toLowerCase())){warnings.push('Invalid or duplicate commit omitted.');continue;}
      if(!Array.isArray(item.parent_ids)||item.parent_ids.length>32||item.parent_ids.some(parent=>!SHA.test(parent||'')))throw Error('Invalid GitLab commit parents; graph cannot be represented faithfully.');
      seen.add(item.id.toLowerCase());const id=item.id.toLowerCase();commits.push({sha:id,parents:item.parent_ids.map(parent=>parent.toLowerCase()),message:repositoryMessage(item.message,warnings),author:text(item.author_name),date:text(item.authored_date),url:`${host}/${repository}/-/commit/${id}`});
    }
    const more=Boolean(next)||/rel="next"/.test(link)||value.length===30,hasMore=more&&page<100;if(more&&!hasMore)warnings.push('History browsing stopped at 3,000 commits.');
    return {repository,ref,sha,snapshotRef:sha,commits,hasMore,nextPage:hasMore?page+1:null,warnings:[...new Set(warnings)]};
  }
  async function compareTrees(repository,base,head,headRepository=repository){
    // A truncated tree cannot establish absence: never infer deletions from it.
    const listings=await Promise.all([tree(repository,base),tree(headRepository,head)]);
    if(listings.some(listing=>listing.warnings.length))throw new Error('GitLab repository discovery is incomplete; a complete drawing comparison cannot be established. Compare a smaller project or individual drawing revisions.');
    const indexes=listings.map(listing=>{
      const index=new Map();
      for(const item of listing.entries){
        if(!root.KiCadBrowserData.validPath(item.path))continue;
        if(!SHA.test(item.id)||index.has(item.path))throw new Error('Invalid GitLab drawing identity in comparison tree.');
        index.set(item.path,item.id);
      }
      return index;
    });
    const [before,after]=indexes,files=[],removed=[],added=[];
    for(const [path,id] of before){
      if(!after.has(path))removed.push({path,id});
      else if(after.get(path)!==id)files.push({file:path,oldFile:path,status:'modified'});
    }
    for(const [path,id] of after)if(!before.has(path))added.push({path,id});
    const group=items=>{const result=new Map();for(const item of items){if(!result.has(item.id))result.set(item.id,[]);result.get(item.id).push(item);}return result;};
    const oldIds=group(removed),newIds=group(added),paired=new Set();
    // Only unambiguous, byte-identical moves are established by blob identity.
    for(const [id,old] of oldIds){const next=newIds.get(id);if(old.length===1&&next?.length===1){files.push({file:next[0].path,oldFile:old[0].path,status:'renamed'});paired.add(id);}}
    for(const item of removed)if(!paired.has(item.id))files.push({file:item.path,oldFile:item.path,status:'removed'});
    for(const item of added)if(!paired.has(item.id))files.push({file:item.path,oldFile:item.path,status:'added'});
    files.sort((a,b)=>a.file.localeCompare(b.file)||a.status.localeCompare(b.status));
    return files;
  }
  async function compare(repository,base,head,path){
    scope(repository,base,path);scope(repository,head,path);
    const from=await resolve(repository,base,path),to=await resolve(repository,head,path);
    if(from.sha===to.sha)return {files:[],base:from.sha,head:to.sha,warnings:[]};
    const {value}=await json(`${endpoint(repository)}/compare?${new URLSearchParams({from:from.sha,to:to.sha,straight:'true'})}`);
    if(!Array.isArray(value.diffs)||value.diffs.length>3000)throw new Error('Invalid or oversized GitLab comparison.');
    if(value.compare_timeout){
      const files=await compareTrees(repository,from.sha,to.sha);
      return {files,base:from.sha,head:to.sha,warnings:['GitLab exceeded comparison limits; changed drawings were recovered from complete commit trees. Only unique byte-identical moves are recognized as renames; edited or ambiguous moves appear as added/removed.']};
    }
    const files=value.diffs.flatMap(item=>{
      if(!item||typeof item!=='object')throw new Error('Invalid GitLab comparison entry.');
      const old=item.old_path,newPath=item.new_path;
      const a=item.a_mode!=='120000'&&validPath(old)&&root.KiCadBrowserData.validPath(old),b=item.b_mode!=='120000'&&validPath(newPath)&&root.KiCadBrowserData.validPath(newPath);
      if(a&&b)return [{file:newPath,oldFile:old,status:item.deleted_file?'removed':item.new_file?'added':item.renamed_file?'renamed':'modified'}];
      return [...(a?[{file:old,oldFile:old,status:'removed'}]:[]),...(b?[{file:newPath,oldFile:newPath,status:'added'}]:[])];
    });
    return {files,base:from.sha,head:to.sha,warnings:[]};
  }
  async function mergeRequest(repository,number){
    if(!validRepository(repository)||!Number.isSafeInteger(number)||number<1)throw new Error('Invalid GitLab merge request.');
    const project=endpoint(repository).replace(/\/repository$/,''),url=`${project}/merge_requests/${number}`;
    const read=async()=>{const {value}=await json(url);const refs=value?.diff_refs;
      if(value?.iid!==number||![value.source_project_id,value.target_project_id].every(id=>Number.isSafeInteger(id)&&id>0)||
        !refs||![refs.base_sha,refs.head_sha,refs.start_sha].every(id=>SHA.test(id)))throw new Error('GitLab merge request revisions are unavailable; wait for diff preparation and refresh.');
      return value;
    };
    const value=await read(),refs=value.diff_refs;
    const {value:source}=await json(`${host}/api/v4/projects/${value.source_project_id}`);
    if(source?.id!==value.source_project_id||!validRepository(source.path_with_namespace))throw new Error('GitLab did not identify the source project.');
    const headRepository=source.path_with_namespace;
    // File identities avoid server text-diff size limits and pin both fork sides.
    const files=await compareTrees(repository,refs.base_sha,refs.head_sha,headRepository);
    const current=await read();
    if(current.source_project_id!==value.source_project_id||current.target_project_id!==value.target_project_id||
      ['base_sha','head_sha','start_sha'].some(key=>current.diff_refs[key]!==refs[key]))throw new Error('The GitLab merge request changed during discovery; refresh to compare its latest revision.');
    return {base:refs.base_sha,head:refs.head_sha,baseTip:refs.start_sha,headRepository,files,
      warnings:['Changed drawings are identified from complete commit trees. Only unique byte-identical moves are recognized as renames; edited or ambiguous moves appear as added/removed.']};
  }
  return {validRepository,validPath,file,resolve,directory,schematics,inventory,modelIndex,projectFile,search,branches,commits,repositoryTree,repositoryHistory,repositoryBranches,compare,mergeRequest,response,endpoint};
  }
  root.KiCadGitLabProvider={...forHost(),forHost};
  if(typeof module==='object'&&module.exports)module.exports=root.KiCadGitLabProvider;
})(typeof globalThis==='object'?globalThis:this);
