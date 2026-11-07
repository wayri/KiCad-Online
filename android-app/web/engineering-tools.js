/* Trusted packaged tools, available without an account or open drawing. */
((root)=>{'use strict';if(!root.document)return;
 const pages=new Set(['comparison-viewer.html','bom-viewer.html','calculator-viewer.html','gerber-viewer.html','pdf-viewer.html']);
 function init(){
  const d=root.document;
  const el=(tag,text)=>{const node=d.createElement(tag);if(text)node.textContent=text;return node;};
  const button=(text,action)=>{const node=el('button',text);node.type='button';node.onclick=action;return node;};
  if(root.KiCadAndroid&&d.getElementById('viewer')){
   const drawing=d.getElementById('viewer'),welcome=d.getElementById('welcome'),picker=d.getElementById('projectPicker');
   const tools=d.createElement('iframe');tools.id='engineeringToolViewer';tools.title='Engineering tools';tools.hidden=true;
   // A sibling keeps the drawing document, camera and selection alive across tool visits.
   drawing.after(tools);
   let previous=null;
   function hideTools(){tools.hidden=true;tools.removeAttribute('src');}
   root.KiCadAndroid.openTools=(page,file='',ref)=>{
    if(!pages.has(page))return;
    if(!previous)previous={drawingHidden:drawing.hidden,welcomeHidden:welcome.hidden,pickerHidden:picker.hidden,pickerOpen:picker.open};
    welcome.hidden=true;picker.hidden=true;drawing.hidden=true;
    const project=root.KiCadAndroidProject,remote=project?.remote||project?.github;
    const query=project?new URLSearchParams({repository:remote?.repository||'android/'+project.id,
     ref:ref||remote?.sha||'a'.repeat(40),...(project.remote?{provider:remote.provider,host:remote.host}:{}),...(file?{file}:{})}):new URLSearchParams();
    for(const dialog of d.querySelectorAll('dialog[open]'))dialog.close();
    tools.src=page+'?'+query;tools.hidden=false;
   };
   root.KiCadAndroid.closeTools=()=>{
    if(!previous)return;
    hideTools();drawing.hidden=previous.drawingHidden;welcome.hidden=previous.welcomeHidden;
    picker.hidden=previous.pickerHidden;picker.open=previous.pickerOpen;previous=null;
   };
   const showHome=root.KiCadAndroid.showHome;
   root.KiCadAndroid.showHome=(...args)=>{if(previous){hideTools();previous=null;}return showHome.apply(root.KiCadAndroid,args);};
   root.addEventListener?.('kicad-project-opened',()=>{if(previous){hideTools();previous=null;}});
   for(const name of ['openDrawing','openProject']){
    const navigate=root.KiCadAndroid[name];
    if(navigate)root.KiCadAndroid[name]=(...args)=>{if(previous)root.KiCadAndroid.closeTools();return navigate(...args);};
   }
   const back=root.KiCadAndroidUI?.handleBack;
   if(back)root.KiCadAndroidUI.handleBack=()=>{
    if(tools.hidden)return back();
    try{
     if(tools.contentWindow?.KiCadSectionPages?.back?.())return true;
     if(tools.contentWindow?.KiCadAndroidUI?.handleBack?.())return true;
     const dialog=[...(tools.contentDocument?.querySelectorAll('dialog[open]')||[])].at(-1);
     if(dialog){dialog.close();return true;}
    }catch{}
    root.KiCadAndroid.closeTools();return true;
   };
   const original=root.KiCadAndroid.openAnalysis;
   root.KiCadAndroid.openAnalysis=(path,ref,options)=>{
    if(root.KiCadBomImport?.candidate(path))return root.KiCadAndroid.openTools('bom-viewer.html',path,ref);
    if(previous)root.KiCadAndroid.closeTools();
    return options===undefined?original(path,ref):original(path,ref,options);
   };
   const menu=d.querySelector('#appMenuDialog .android-sheet-content');
   for(const host of [welcome,menu])if(host){
    const actions=el('div');actions.className='android-welcome-actions';
    actions.append(button('Compare designs / BoMs',()=>root.KiCadAndroid.openTools('comparison-viewer.html')),button('PDF viewer',()=>root.KiCadAndroid.openTools('pdf-viewer.html')),
     button('Gerber viewer & analyzer',()=>root.KiCadAndroid.openTools('gerber-viewer.html')),
     button('BoM & assembly',()=>root.KiCadAndroid.openTools('bom-viewer.html')),
     button('Engineering calculators',()=>root.KiCadAndroid.openTools('calculator-viewer.html')));
    host.append(actions);
   }
  }else if(!root.KiCadEngineeringLauncher){
   const host=d.querySelector('#androidToolsSheet .android-sheet-content')||d.getElementById('drawingTools');
   if(host)host.append(button('PDF viewer',()=>root.top.KiCadAndroid?.openTools('pdf-viewer.html')),
    button('Gerber viewer & analyzer',()=>root.top.KiCadAndroid?.openTools('gerber-viewer.html')),
    button('Engineering calculators',()=>root.top.KiCadAndroid?.openTools('calculator-viewer.html',new URLSearchParams(location.search).get('file')||'')),
    button('Import BoM / iBOM',()=>root.top.KiCadAndroid?.openTools('bom-viewer.html')));
  }
 }
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(globalThis);
