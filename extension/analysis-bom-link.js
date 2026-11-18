/* Offer the BoM viewer for saved input accepted by the BoM importer. */
(()=>{'use strict';
 if(globalThis.KiCadVSCodeContext&&!globalThis.KiCadAndroidRuntime)return;
 const header=document.querySelector('header'),button=document.createElement('button');
 button.type='button';button.textContent='Open as BoM';button.hidden=true;header.append(button);
 let active=null;
 button.onclick=()=>{
  if(!active)return;
  const {path,ref}=active,query=new URLSearchParams(location.search);
  if(ref)query.set('ref',ref);
  let android;try{android=top.KiCadAndroid;}catch{}
  if(android?.openTools)android.openTools('bom-viewer.html',path,query.get('ref'));
  else{query.set('file',path);location.href='bom-viewer.html?'+query;}
 };
 globalThis.KiCadAnalysisBomLink={update(path,source,ref){
  active=null;button.hidden=true;
  const importer=globalThis.KiCadBomImport;
  if(!importer||!/\.(csv|tsv|json|html?)$/i.test(path||'')||typeof source!=='string'||source.length>importer.limits.bytes)return;
  try{importer.parse(source,path);}catch{return;}
  active={path,ref};button.hidden=false;
 }};
})();
