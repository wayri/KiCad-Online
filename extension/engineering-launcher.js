/* Shared, bounded entry points for local engineering viewers. */
((root)=>{
 'use strict';
 const PAGES=new Set(['comparison-viewer.html','pdf-viewer.html','gerber-viewer.html','bom-viewer.html','calculator-viewer.html','analysis-viewer.html']);
 const path=value=>typeof value==='string'&&value.length<=1024&&!/[\\\x00-\x1f\x7f?#]/.test(value)&&!value.startsWith('/')&&!value.split('/').some(p=>!p||p==='.'||p==='..');
 function context(value={}){
  const result={};
  if(value.provider!==undefined&&!['github','gitlab'].includes(value.provider))throw Error('Unsupported repository provider.');
  const provider=value.provider||'github';
  if(value.repository!==undefined&&value.repository!==''){
   if(typeof value.repository!=='string'||value.repository.length>500||!value.repository.split('/').every(p=>/^[A-Za-z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..')||value.repository.split('/').length<2)throw Error('Invalid repository.');
   result.repository=value.repository;
  }
  if(value.ref!==undefined&&value.ref!==''){
   if(typeof value.ref!=='string'||value.ref.length>256||/[\x00-\x1f\x7f]/.test(value.ref))throw Error('Invalid source revision.');
   result.ref=value.ref;
  }
  if(value.file!==undefined&&value.file!==''){
   if(!path(value.file))throw Error('Invalid project file path.');
   result.file=value.file;
  }
  if(provider==='gitlab'){
   let host;try{host=new URL(value.host||'https://gitlab.com');}catch{throw Error('Invalid GitLab host.');}
   if(host.protocol!=='https:'||host.username||host.password||host.pathname!=='/'||host.search||host.hash)throw Error('Use an HTTPS GitLab origin without credentials.');
   result.provider=provider;result.host=host.origin;
  }else if(value.host&&value.host!=='https://github.com')throw Error('Invalid GitHub host.');
  return result;
 }
 function open(page,value={}){
  if(!PAGES.has(page))throw Error('Unsupported engineering viewer.');
  const source=context(value);
  if(value.sourceFile!==undefined){if(page!=='bom-viewer.html'||!path(value.sourceFile))throw Error('Invalid BoM discovery source.');source.sourceFile=value.sourceFile;}
  if(value.resultView!==undefined){if(page!=='analysis-viewer.html'||!['map','2d','3d'].includes(value.resultView))throw Error('Invalid saved result view.');source.resultView=value.resultView;}
  if(page==='analysis-viewer.html'&&(!source.repository||!source.ref||!source.file||!/\.(json|csv|tsv|wbk|raw|txt|html?)$/i.test(source.file)))throw Error('Choose a saved simulation or results report from the project tree.');
  let android;try{android=root.top?.KiCadAndroid;}catch{}
  if(android){
   if(page==='analysis-viewer.html'&&android.openAnalysis)return source.resultView?android.openAnalysis(source.file,source.ref,{resultView:source.resultView}):android.openAnalysis(source.file,source.ref);
   if(android.openTools)return android.openTools(page,source.file||'',source.ref);
  }
  if(root.KiCadVSCodeContext){
   if(page!=='analysis-viewer.html')throw Error('Open these standalone engineering tools in the browser extension or Android app.');
   const drawing=root.KiCadVSCodeContext.drawingFile||new URLSearchParams(root.KiCadVSCodeContext.search||'').get('file');
   return root.chrome.runtime.sendMessage({type:'open-analysis-viewer',repository:source.repository,ref:source.ref,file:drawing,path:source.file,...(source.resultView?{resultView:source.resultView}:{})}).then(reply=>{if(!reply?.ok)throw Error(reply?.error||'Could not open the saved report.');return reply.result;});
  }
  if(!root.chrome?.runtime?.getURL||typeof root.open!=='function')throw Error('Engineering tools require the installed extension or app.');
  const url=root.chrome.runtime.getURL(page)+(Object.keys(source).length?'?'+new URLSearchParams(source):'');
  root.open(url,'_blank','noopener,noreferrer');
  return url;
 }
 function openMenu(value={}){
  const source=context(value),d=root.document;if(!d)throw Error('Engineering tool menu needs a document.');
  const dialog=d.createElement('dialog');dialog.className='bom-manager';dialog.setAttribute('aria-label','Engineering tools');
  const make=(tag,text)=>{const n=d.createElement(tag);n.textContent=text;return n;},heading=make('header',''),title=make('h2','Engineering tools'),close=make('button','Close');
  close.type='button';close.onclick=()=>dialog.close();heading.className='bom-manager-heading';heading.append(title,close);
  const body=make('section','');body.className='bom-manager-controls';const status=make('p','');status.setAttribute('role','status');
  for(const [label,page]of [['Compare designs / CSV BoMs','comparison-viewer.html'],['PDF viewer','pdf-viewer.html'],['Gerber viewer & analyzer','gerber-viewer.html'],['Import BoM / iBOM','bom-viewer.html'],['Engineering calculators','calculator-viewer.html']]){
   const button=make('button',label);button.type='button';button.onclick=()=>{try{const target={...source};if(page==='bom-viewer.html'&&source.file)target.sourceFile=source.file;if(page==='pdf-viewer.html'&&!/\.pdf$/i.test(target.file||'')||page==='gerber-viewer.html'&&!/\.(gbr|ger|gerber|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gko|gm\d+|g\d+|drl|xln)$/i.test(target.file||'')||page==='bom-viewer.html'&&!/\.(json|csv|tsv|html?)$/i.test(target.file||''))delete target.file;open(page,target);dialog.close();}catch(e){status.textContent=e.message;}};body.append(button);
  }
  body.append(make('p','For simulation plots and overlays, select a saved results report in the project tree. Supported reports retain their source revision.'));
  if(source.file&&/\.(json|csv|tsv|wbk|raw|txt|html?)$/i.test(source.file)){
   const button=make('button','Open selected results report');button.type='button';button.onclick=()=>{try{open('analysis-viewer.html',source);dialog.close();}catch(e){status.textContent=e.message;}};body.append(button);
  }
  dialog.append(heading,body,status);dialog.addEventListener('close',()=>dialog.remove(),{once:true});d.body.append(dialog);dialog.showModal();return dialog;
 }
 const api={open,openMenu,context};root.KiCadEngineeringLauncher=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
