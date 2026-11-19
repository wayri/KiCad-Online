/* Discovery is restricted to this owned page; project files open without host chrome. */
(()=>{
 'use strict';
 const query=new URLSearchParams(location.search),status=document.getElementById('launchStatus'),title=document.getElementById('launchTitle'),details=document.getElementById('launchDetails'),projects=document.getElementById('launchProjects'),retry=document.getElementById('launchRetry');
 let busy=false,attempts=0;
 const loading=globalThis.KiCadLoading?.indicator(document.body,{fullscreen:true});
 function localAlternative(){
  const help=document.createElement('span');help.className='launch-access-help';help.textContent='Viewing does not require GitHub/GitLab app authorization. If your organization permits downloads but blocks extension page access, download ZIP from the repository website, extract it, then open that folder here. Files are rendered on this device.';
  const local=document.createElement('a');local.href=chrome.runtime.getURL('local-viewer.html');local.textContent='Open downloaded project folder';local.className='launch-local-alternative';details.append(help);details.append(local);
 }
 async function load(){
  if(busy)return;busy=true;retry.hidden=true;projects.replaceChildren();details.textContent='';status.className='';
  try{
   const source=query.get('source');
   if(!source){title.textContent='No KiCad project detected';status.textContent=query.get('error')||'Open a GitHub or approved GitLab repository, then click the extension icon. You can also open local files or recent projects above.';return;}
   loading?.show('Finding KiCad projects in this repository…');
   const context=KiCadProjectLaunch.context(source,{ref:query.get('ref'),allowUnresolved:true});
   if(context?.kind!=='repository')throw Error('Open a repository page, then click the extension icon again.');
   status.textContent='Checking '+context.repository+'…';details.textContent=context.source+' · '+(context.ref||'Resolving saved branch metadata');
   const reply=await chrome.runtime.sendMessage({type:'repository-detect',source:context.source,repository:context.repository,ref:context.ref,refresh:attempts++>0,...(context.provider?{provider:context.provider,host:context.host}:{})});
   if(!reply?.ok)throw Error(reply?.accessIssue?[reply.accessIssue.title,reply.accessIssue.message,reply.accessIssue.action].join(' '):reply?.error||'Repository discovery failed. Reload the extension and try again.');
   const result=reply.result;
   if(!/^[a-f0-9]{40}$/i.test(result?.sha||'')||!Array.isArray(result.projects)||result.projects.length>100)throw Error('Invalid repository discovery response.');
   if(result.headRepository!==undefined&&!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(result.headRepository)||result.base!==undefined&&!/^[a-f0-9]{40}$/i.test(result.base))throw Error('Invalid pull request discovery response.');
   if(context.revisionKind==='commit'&&!result.sha.toLowerCase().startsWith(context.ref.toLowerCase()))throw Error('The discovered commit does not match the requested commit.');
   if(context.revisionKind==='pull'&&(result.pullNumber!==context.pullNumber||result.pullRepository!==context.repository))throw Error('The discovered pull request does not match the requested pull request.');
   const info={...context,sha:result.sha,...(result.headRepository?{headRepository:result.headRepository}:{}),...(result.base?{base:result.base}:{}),...(result.pullNumber?{pullNumber:result.pullNumber,pullRepository:result.pullRepository}:{})};
   const warnings=Array.isArray(result.warnings)?result.warnings.slice(0,8).map(value=>String(value).slice(0,400)).join(' '):'';
   details.textContent=context.repository;
   // Successful fallback details belong in DevTools, outside Chrome's extension Errors list.
   if(warnings)console.debug('KiCad Online project discovery:',warnings);
   for(const file of result.projects)KiCadProjectLaunch.viewerURL(info,file,p=>chrome.runtime.getURL(p));
   const files=result.projects.filter(file=>/\.(?:kicad_pro|pro)$/i.test(file));
   if(files.length===1&&!result.truncated){location.replace(KiCadProjectLaunch.viewerURL(info,files[0],p=>chrome.runtime.getURL(p)));return;}
   title.textContent=files.length?'Choose a KiCad project':result.truncated?'Project discovery incomplete':'No KiCad project detected';
   status.textContent=files.length?files.length+' KiCad project'+(files.length===1?'':'s')+' found.':result.truncated?'No KiCad project detected in the partial listing. Additional folders may contain projects.':'No KiCad project detected in this repository revision.';
   if(result.truncated){retry.hidden=false;details.textContent+=' · Partial listing; additional projects may exist.';}
   for(const file of files){const link=document.createElement('a');link.className='project-choice';link.href=KiCadProjectLaunch.viewerURL(info,file,p=>chrome.runtime.getURL(p));const badge=document.createElement('span');badge.className='project-type-badge';badge.textContent=/\.kicad_pro$/i.test(file)?'KiCad project':'Legacy project';const name=document.createElement('h2');name.textContent=file.split('/').at(-1).replace(/\.(?:kicad_pro|pro)$/i,'');const folder=document.createElement('p');folder.className='project-folder';folder.textContent=file.includes('/')?file.slice(0,file.lastIndexOf('/')):'Repository root';const filename=document.createElement('small');filename.textContent=file;link.append(badge);link.append(name);link.append(folder);link.append(filename);projects.append(link);}
  }catch(error){title.textContent='Project discovery unavailable';status.className='error';status.textContent='! '+error.message;localAlternative();retry.hidden=false;}
  finally{busy=false;loading?.hide();}
 }
 addEventListener('pagehide',()=>loading?.dispose());
 retry.addEventListener('click',load);load();
})();
