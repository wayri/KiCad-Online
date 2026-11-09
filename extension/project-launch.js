/* Toolbar launch context and standalone viewer URLs; no provider I/O here. */
((root)=>{
 'use strict';
 function fabrication(path){const api=root.KiCadGerberRenderer||(typeof require==='function'?require('./gerber-renderer.js'):null);return Boolean(api?.isFabricationPath(path));}
 function context(value,hint){
  const parse=root.KiCadGitHub||(typeof require==='function'?require('./parsing.js'):null);
  let url;try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password)return null;
  const revision=parse.revisionRoute(url.href);
  if(revision){
   const source=url.origin+url.pathname.replace(/\/$/,'');
   return{kind:'repository',source,repository:revision.repository,ref:revision.kind==='commit'?revision.ref:null,revisionKind:revision.kind,...(revision.kind==='pull'?{pullNumber:revision.number}:revision.number?{revisionPullNumber:revision.number}:{})};
  }
  if(url.origin==='https://github.com'&&/^\/[^/]+\/[^/]+\/(?:commit|pull)(?:\/|$)/.test(url.pathname))throw Error('This commit or pull request URL cannot be resolved safely. Open its commit or pull request overview, then click the extension again.');
  const options={gitlabHosts:[url.origin]},repo=parse.repositoryRoute(url.href,options),blob=parse.route(url.href,options);
  if(blob?.kind==='blob'){
   const info=parse.blobRequest(blob,hint);
   if(info&&(/(?:\.kicad_(?:pro|sch|pcb)|\.(?:sch|brd|pro))$/i.test(info.file)||fabrication(info.file)))return{kind:'drawing',...info};
  }
  if(repo){
   const ref=repo.tail?hint?.ref||parse.repositoryRef(repo):'HEAD';
   if((!ref||repo.tail&&!(repo.tail.join('/')===ref||repo.tail.join('/').startsWith(ref+'/')))&&!(hint?.allowUnresolved===true&&!repo.provider&&!ref))throw Error('The branch is ambiguous. Open the repository root or a KiCad file, then click the extension again.');
   if(repo.tail?.some(part=>!part||part==='.'||part==='..'||/[\\:\x00-\x1f\x7f]/.test(part)))throw Error('Invalid repository directory.');
   return{kind:'repository',source:url.origin+url.pathname,repository:repo.repository,ref,...(repo.tail&&ref?{directory:repo.tail.join('/').slice(ref.length).replace(/^\//,'')}:{}),...(repo.provider?{provider:repo.provider,host:repo.host}:{})};
  }
  // Issue, pull-request and unsupported file pages still belong to a repository.
  const parts=url.pathname.split('/').filter(Boolean),split=url.origin==='https://github.com'?2:parts.indexOf('-');
  const names=split>=2?parts.slice(0,split):url.origin==='https://gitlab.com'?parts:[];
  if(names.length<2||!names.every(p=>/^[A-Za-z0-9_.-]+$/.test(p)))return null;
  const repository=names.join('/');return{kind:'repository',source:url.origin+'/'+repository,repository,ref:'HEAD',...(url.origin!=='https://github.com'?{provider:'gitlab',host:url.origin}:{})};
 }
 function viewerURL(info,file,getURL){
  if(typeof file!=='string'||!root.KiCadGitHub?.filePath(file)||!(/(?:\.kicad_(?:pro|sch|pcb)|\.(?:sch|brd|pro))$/i.test(file)||fabrication(file)))throw Error('Invalid KiCad project path.');
  const project=/(?:\.kicad_pro|\.pro)$/i.test(file),head=info.sha||info.head,params=new URLSearchParams({repository:project?info.headRepository||info.repository:info.repository,ref:head,head,file});
  if(info.pullNumber!==undefined){
   const parse=root.KiCadGitHub||(typeof require==='function'?require('./parsing.js'):null),review=parse.viewerParams({repository:info.repository,headRepository:info.headRepository,file,head,base:info.base,pullNumber:info.pullNumber,pullRepository:info.pullRepository||info.repository});
   for(const key of ['headRepository','base','pullNumber','pullRepository'])if(review.has(key))params.set(key,review.get(key));
  }
  if(info.provider==='gitlab'){params.set('provider','gitlab');params.set('host',info.host||'https://gitlab.com');}
  return getURL(fabrication(file)?'gerber-viewer.html':/(?:\.kicad_pro|\.pro)$/i.test(file)?'project-viewer.html':'browser-viewer.html')+'?'+params;
 }
 const api={context,viewerURL};root.KiCadProjectLaunch=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
