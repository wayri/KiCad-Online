/* Local product identity only; never reads project data or makes network requests. */
((root)=>{'use strict';
 const valid=value=>typeof value==='string'&&/^\d+(?:\.\d+){1,3}$/.test(value);
 function info(){
  const saved=root.KiCadProductVersion||{};let manifest={};try{manifest=root.chrome?.runtime?.getManifest?.()||{};}catch{}
  const release=valid(manifest.version)?manifest.version:valid(saved.release)?saved.release:valid(root.KiCadVSCodeContext?.version)?root.KiCadVSCodeContext.version:null;
  const appVersion=valid(manifest.version)?manifest.version:valid(saved.appVersion)?saved.appVersion:release;
  const label=typeof manifest.version_name==='string'?manifest.version_name.slice(0,160):'';
  const development=Boolean(manifest.manifest_version&&saved.release==='__RELEASE_VERSION__');
  return {release,appVersion,platform:saved.platform&&!saved.platform.startsWith('__')?saved.platform:manifest.manifest_version?'Browser extension':'Development checkout',label,development,extensionId:typeof root.chrome?.runtime?.id==='string'?root.chrome.runtime.id.slice(0,100):null};
 }
 function caption(value=info()){return value.release?(value.development?'Development build · base ':'Version ')+value.appVersion+(value.appVersion!==value.release?' · viewer release '+value.release:'')+(value.label?' · '+value.label:''):'Development checkout · not a packaged release';}
 const stores={chrome:'https://chromewebstore.google.com/detail/klfdjlbngpoopegjmbajaidgodpmjaoc',firefox:'https://addons.mozilla.org/firefox/addon/pocket-kiview-kicad-review/'};
 let updateCheck=null;
 async function checkUpdates(){
  if(info().development)return {status:'development'};
  const runtime=root.browser?.runtime||root.chrome?.runtime;
  if(!runtime?.requestUpdateCheck)return {status:'unsupported'};
  if(updateCheck)return updateCheck;
  updateCheck=(async()=>{let timer;try{
   const request=root.browser?.runtime===runtime?runtime.requestUpdateCheck():new Promise((resolve,reject)=>{
    runtime.requestUpdateCheck((status,details)=>{if(runtime.lastError)reject(new Error('Update check failed'));else resolve(typeof status==='object'?status:{status,version:details?.version});});
   });
   const result=root.setTimeout?await Promise.race([request,new Promise(resolve=>{timer=root.setTimeout(()=>resolve({status:'error'}),15000);})]):await request;
   if(!['no_update','throttled','update_available'].includes(result?.status))return {status:'error'};
   if(result.status==='update_available'&&!valid(result.version))return {status:'error'};
   return {status:result.status,version:result.version};
  }catch{return {status:'error'};}finally{if(timer)root.clearTimeout(timer);}})();
  try{return await updateCheck;}finally{updateCheck=null;}
 }
 function updateMessage(result){
  switch(result.status){
   case 'development':return 'Local development copy. Store updates do not replace this installation; update its source folder and reload it, or install the store edition.';
   case 'unsupported':return 'Use your browser’s extension manager to check for updates. Store-installed copies follow the browser’s update settings.';
   case 'no_update':return 'No update is available for this installation. Store review, rollout and organization policies can delay availability.';
   case 'throttled':return 'The browser checked recently. Try again later; automatic updates remain managed by your browser.';
   case 'update_available':return 'Version '+result.version+' is ready. Save drafts, then close KiCad Online tabs or restart the browser to let it update.';
   default:return 'Could not check for updates. Try again later or use your browser’s extension manager.';
  }
 }
 function updateControls(host){
  const d=root.document;if(!d||!host||host.hasAttribute('data-update-controls'))return;
  host.setAttribute('data-update-controls','');
  const button=d.createElement('button');button.type='button';button.textContent='Check for updates';
  const status=d.createElement('p');status.setAttribute('role','status');status.style.cssText='font-size:13px;overflow-wrap:anywhere';
  status.textContent=info().development?updateMessage({status:'development'}):'Store updates are managed automatically by your browser.';
  button.onclick=async()=>{button.disabled=true;status.textContent='Checking for updates…';try{status.textContent=updateMessage(await checkUpdates());}finally{button.disabled=false;}};
  const links=d.createElement('p');links.style.cssText='display:flex;gap:12px;flex-wrap:wrap;font-size:13px';
  for(const [key,label] of [['chrome','Chrome Web Store'],['firefox','Firefox Add-ons']]){const a=d.createElement('a');a.href=stores[key];a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
  host.append(button,status,links);
 }
 function showAbout(){
  const d=root.document;if(!d)return;const existing=d.getElementById('pocketKiViewAbout');if(existing){existing.focus();return existing;}
  const value=info(),dialog=d.createElement('dialog');dialog.id='pocketKiViewAbout';dialog.setAttribute('aria-label','About KiCad Online');
  dialog.style.cssText='max-width:min(30rem,calc(100vw - 32px));box-sizing:border-box;padding:20px;border:1px solid #8886;border-radius:12px;color:inherit;background:Canvas;overflow:auto;max-height:85dvh';
  const title=d.createElement('h2');title.textContent='KiCad Online';title.style.cssText='font-size:18px;margin:0 0 8px';
  const version=d.createElement('p');version.textContent=caption(value);version.setAttribute('data-product-version','');
  const platform=d.createElement('small');platform.textContent=value.platform+(value.extensionId?' · Installation '+value.extensionId:'');platform.style.cssText='display:block;overflow-wrap:anywhere';
  const description=d.createElement('p');description.textContent='Independent schematic, PCB and 3D project review. Not affiliated with the KiCad project.';
  const links=d.createElement('p');if(value.release){const release=d.createElement('a');release.textContent=(value.development?'Base release notes · v':'Release notes · v')+value.release;release.href='https://github.com/wayri/KiCad-Online/releases/tag/v'+value.release;release.target='_blank';release.rel='noopener noreferrer';links.append(release);}
  const close=d.createElement('button');close.type='button';close.textContent='Close';close.style.cssText='font:inherit;padding:5px 12px';close.onclick=()=>dialog.close();
  const updates=d.createElement('div');updateControls(updates);
  dialog.append(title,version,platform,description,links,updates,close);dialog.addEventListener('close',()=>dialog.remove());dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  d.body.append(dialog);dialog.showModal();close.focus();return dialog;
 }
 function decorate(){for(const node of root.document?.querySelectorAll('[data-product-version]')||[])node.textContent=caption();for(const node of root.document?.querySelectorAll('[data-product-about]')||[])node.addEventListener('click',showAbout);for(const node of root.document?.querySelectorAll('[data-product-updates]')||[])updateControls(node);}
 const api={info,caption,showAbout,decorate,checkUpdates,updateMessage};if(typeof module==='object'&&module.exports)module.exports=api;else{root.KiCadProductInfo=api;if(root.document?.readyState==='loading')root.document.addEventListener('DOMContentLoaded',decorate,{once:true});else decorate();}
})(globalThis);
