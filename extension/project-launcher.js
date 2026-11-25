/* Discovery is restricted to this owned page; project files open without host chrome. */
(()=>{
 'use strict';
 const query=new URLSearchParams(location.search),status=document.getElementById('launchStatus'),title=document.getElementById('launchTitle'),details=document.getElementById('launchDetails'),projects=document.getElementById('launchProjects'),retry=document.getElementById('launchRetry');
 const repositoryProjects=query.get('projects')==='1',folderOnly=query.get('folder')==='1',current=query.get('current'),other=document.getElementById('launchOther');
 const browse=document.getElementById('launchBrowse'),filter=document.getElementById('launchFilter'),drawings=document.getElementById('launchDrawings'),
  folderRoot=document.getElementById('launchFolderRoot'),folderUp=document.getElementById('launchFolderUp'),folders=document.getElementById('launchFolders'),
  folderLinks=document.getElementById('launchFolderLinks'),moreFolders=document.getElementById('launchMoreFolders'),
  pages=document.getElementById('launchResultsPages'),previous=document.getElementById('launchPrevious'),next=document.getElementById('launchNext'),pageStatus=document.getElementById('launchPage');
 const pageSize=36;
 const getURL=path=>chrome.runtime.getURL(path);
 let busy=false,attempts=0;
 const loading=globalThis.KiCadLoading?.indicator(document.body,{fullscreen:true});
 function localAlternative(){
  const help=document.createElement('span');help.className='launch-access-help';help.textContent='Viewing does not require GitHub/GitLab app authorization. If your organization permits downloads but blocks extension page access, download ZIP from the repository website, extract it, then open that folder here. Files are rendered on this device.';
  const local=document.createElement('a');local.href=chrome.runtime.getURL('local-viewer.html');local.textContent='Open downloaded project folder';local.className='launch-local-alternative';details.append(help);details.append(local);
 }
 function fabricationCard(info,count){
  const link=document.createElement('a');link.className='project-choice fabrication-choice';
  link.href=KiCadProjectLaunch.fabricationURL(info,p=>chrome.runtime.getURL(p));
  const badge=document.createElement('span');badge.className='project-type-badge fabrication-badge';badge.textContent='Fabrication';
  const name=document.createElement('h2');name.textContent='Gerbers';
  const description=document.createElement('p');description.textContent=count+' fabrication file'+(count===1?'':'s')+' · Gerber layers, drills and jobs';
  link.append(badge);link.append(name);link.append(description);
  return link;
 }
 function projectCard(info,file){
  const link=document.createElement('a');link.className='project-choice';
  const selected=repositoryProjects&&current&&(file===current||file.replace(/\.[^.]+$/,'')===current.replace(/\.[^.]+$/,''));
  if(selected){link.className+=' current-project';link.setAttribute('aria-current','true');}
  link.href=KiCadProjectLaunch.viewerURL(info,file,getURL);
  const badge=document.createElement('span');badge.className='project-type-badge';
  badge.textContent=selected?'Current project':/\.kicad_pro$/i.test(file)?'KiCad project':/\.pro$/i.test(file)?'Legacy project':'Drawing';
  const name=document.createElement('h2');name.textContent=file.split('/').at(-1).replace(/\.(?:kicad_pro|pro)$/i,'');
  const folder=document.createElement('p');folder.className='project-folder';folder.textContent=file.includes('/')?file.slice(0,file.lastIndexOf('/')):'Repository root';
  link.append(badge);link.append(name);link.append(folder);
  return link;
 }
 function populate(info,files,standalone,directories,gerbers,partial){
  let page=0,folderLimit=pageSize,showDrawings=false;
  filter.value='';drawings.hidden=!standalone.length;drawings.setAttribute('aria-pressed','false');
  folders.open=folderOnly;
  browse.hidden=files.length<=1&&!standalone.length&&!directories.length&&!folderOnly&&!partial&&!repositoryProjects;
  folderRoot.hidden=folderOnly||!directories.length;folderRoot.href=KiCadProjectLaunch.folderURL(info,info.directory||'',getURL);
  folderUp.hidden=!folderOnly||!info.directory;
  if(!folderUp.hidden)folderUp.href=KiCadProjectLaunch.folderURL(info,info.directory.split('/').slice(0,-1).join('/'),getURL);
  function render(){
   const term=filter.value.trim().toLowerCase(),words=term.split(/\s+/).filter(Boolean),match=path=>{const normalized=path.toLowerCase();return words.every(word=>normalized.includes(word));};
   const matching=(showDrawings?standalone:term?[...files,...standalone]:files.length?files:standalone).filter(match);
   const matchedFolders=directories.filter(match),linkedFolders=term&&partial&&!matchedFolders.length?directories:matchedFolders;
   const pageCount=Math.ceil(matching.length/pageSize);
   projects.replaceChildren();
   if(!term&&!page&&!showDrawings&&gerbers)projects.append(gerbers);
   for(const file of matching.slice(page*pageSize,(page+1)*pageSize))projects.append(projectCard(info,file));
   if(term&&!matching.length&&!matchedFolders.length){const empty=document.createElement('p');empty.textContent=partial?'No matches in the scanned folders. Browse a folder to search its contents.':'No matching projects or drawings.';projects.append(empty);}
   pages.hidden=pageCount<=1;previous.disabled=page===0;next.disabled=page+1>=pageCount;
   pageStatus.textContent=pageCount?'Page '+(page+1)+' of '+pageCount:'';
   folders.hidden=!linkedFolders.length;if(term)folders.open=true;
   folderLinks.replaceChildren();moreFolders.hidden=linkedFolders.length<=folderLimit;
   for(const directory of linkedFolders.slice(0,folderLimit)){
    const link=document.createElement('a');link.href=KiCadProjectLaunch.folderURL(info,directory,getURL);
    link.textContent=directory;folderLinks.append(link);
   }
  }
  filter.oninput=()=>{page=0;folderLimit=pageSize;render();};
  drawings.onclick=()=>{showDrawings=!showDrawings;drawings.setAttribute('aria-pressed',String(showDrawings));page=0;render();};
  previous.onclick=()=>{if(page>0){page--;render();}};
  next.onclick=()=>{if(!next.disabled){page++;render();}};
  moreFolders.onclick=()=>{folderLimit+=pageSize;render();};
  render();
 }
 async function load(){
  if(busy)return;busy=true;retry.hidden=true;browse.hidden=pages.hidden=folders.hidden=true;projects.replaceChildren();other.replaceChildren();other.hidden=true;details.textContent='';status.className='';
  try{
   const source=query.get('source');
   if(!source){title.textContent='No KiCad project detected';status.textContent=query.get('error')||'Open a GitHub or approved GitLab repository, then click the extension icon. You can also open local files or recent projects above.';return;}
   loading?.show('Finding KiCad projects and Gerbers…');
   const context=KiCadProjectLaunch.context(source,{ref:query.get('ref'),allowUnresolved:true});
   if(context?.kind!=='repository')throw Error('Open a repository page, then click the extension icon again.');
   status.textContent='Checking '+context.repository+'…';details.textContent=context.source+' · '+(context.ref||'Resolving saved branch metadata');
   const message={type:'repository-detect',source:context.source,repository:context.repository,ref:context.ref,refresh:attempts++>0,...(folderOnly?{folderOnly:true}:{}),...(context.provider?{provider:context.provider,host:context.host}:{})};
   const reply=await (globalThis.KiCadChunkedReplies?KiCadChunkedReplies.send(chrome.runtime,message):chrome.runtime.sendMessage(message));
   if(!reply?.ok)throw Error(reply?.accessIssue?[reply.accessIssue.title,reply.accessIssue.message,reply.accessIssue.action].join(' '):reply?.error||'Repository discovery failed. Reload the extension and try again.');
   const result=reply.result;
   if(!/^[a-f0-9]{40}$/i.test(result?.sha||'')||!Array.isArray(result.projects)||result.projects.length>24000||result.folders!==undefined&&(!Array.isArray(result.folders)||result.folders.length>24000))throw Error('Invalid repository discovery response.');
   if(result.headRepository!==undefined&&!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(result.headRepository)||result.base!==undefined&&!/^[a-f0-9]{40}$/i.test(result.base))throw Error('Invalid pull request discovery response.');
   if(context.revisionKind==='commit'&&!result.sha.toLowerCase().startsWith(context.ref.toLowerCase()))throw Error('The discovered commit does not match the requested commit.');
   if(repositoryProjects&&/^[a-f0-9]{40}$/i.test(context.ref||'')&&result.sha.toLowerCase()!==context.ref.toLowerCase())throw Error('The repository listing does not match the open project revision.');
   if(context.revisionKind==='pull'&&(result.pullNumber!==context.pullNumber||result.pullRepository!==context.repository))throw Error('The discovered pull request does not match the requested pull request.');
   const info={...context,sha:result.sha,directory:result.directory||'',...(result.headRepository?{headRepository:result.headRepository}:{}),...(result.base?{base:result.base}:{}),...(result.pullNumber?{pullNumber:result.pullNumber,pullRepository:result.pullRepository}:{})};
   const warnings=Array.isArray(result.warnings)?result.warnings.slice(0,8).map(value=>String(value).slice(0,400)).join(' '):'';
   details.textContent=context.repository;
   // Successful fallback details belong in DevTools, outside Chrome's extension Errors list.
   if(warnings)console.debug('KiCad Online project discovery:',warnings);
   for(const file of result.projects)KiCadProjectLaunch.viewerURL(info,file,p=>chrome.runtime.getURL(p));
   const files=result.projects.filter(file=>/\.(?:kicad_pro|pro)$/i.test(file));
   const standalone=result.projects.filter(file=>!/\.(?:kicad_pro|pro)$/i.test(file)),directories=result.folders||[];
   for(const directory of directories)KiCadProjectLaunch.folderURL(info,directory,getURL);
   const count=result.fabricationCount??0;
   if(!Number.isInteger(count)||count<0||count>1000)throw Error('Invalid fabrication discovery response.');
   const gerbers=count?fabricationCard({...info,directory:result.directory||''},count):null;
   if(!repositoryProjects&&files.length===1&&!gerbers&&!result.truncated){location.replace(KiCadProjectLaunch.viewerURL(info,files[0],p=>chrome.runtime.getURL(p)));return;}
   title.textContent=repositoryProjects?'Repository projects':gerbers?'Open repository files':files.length?'Choose a KiCad project':result.truncated?'Project discovery incomplete':standalone.length?'Choose a KiCad drawing':'No KiCad project detected';
   status.textContent=gerbers&&(!repositoryProjects||!files.length)?(files.length?'Choose a KiCad project or view fabrication files.':'Fabrication files are ready to open.') :files.length?files.length+' KiCad project'+(files.length===1?'':'s')+' found.':standalone.length?standalone.length+' standalone drawing'+(standalone.length===1?'':'s')+' found.':result.truncated?'No KiCad project detected in the partial listing. Additional folders may contain projects.':'No KiCad project detected in this repository revision.';
   if(gerbers){
    if(repositoryProjects&&files.length){
     const link=document.createElement('a');link.href=gerbers.href;link.textContent='View Gerbers and drill files';other.append(link);other.hidden=false;
    }
   }
   if(result.truncated){retry.hidden=false;details.textContent+=' · Partial listing; additional projects may exist.';}
   if(info.directory)details.textContent+=' / '+info.directory;
   populate(info,files,standalone,directories,repositoryProjects&&files.length?null:gerbers,Boolean(result.truncated));
  }catch(error){title.textContent='Project discovery unavailable';status.className='error';status.textContent='! '+error.message;localAlternative();retry.hidden=false;}
  finally{busy=false;loading?.hide();}
 }
 addEventListener('pagehide',()=>loading?.dispose());
 retry.addEventListener('click',load);load();
})();
