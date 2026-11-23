/* Saved-source project exports. No desktop helper or launch action. */
(function(root){
  'use strict';
  const MAX_FILE=8*1024*1024,MAX_TOTAL=32*1024*1024;
  const nativePath=path=>/\.kicad_(sch|pcb|pro)$/i.test(path);
  const drawingPath=path=>/\.kicad_(sch|pcb)$/i.test(path);
  function inventory(result){
    if(!result||!Array.isArray(result.files))throw Error('Project file inventory is unavailable.');
    if(result.warnings?.length)throw Error('A complete project inventory is required: '+result.warnings.join(' '));
    const paths=[...new Set(result.files.map(f=>typeof f==='string'?f:f.path))];
    if(paths.some(p=>typeof p!=='string'||!p||p.startsWith('/')||p.includes('\\')||p.split('/').some(s=>!s||s==='.'||s==='..')||/[\x00-\x1f:]/.test(p)))throw Error('Invalid project file path.');
    if(!result.snapshotRef)throw Error('The project revision could not be pinned.');
    return {paths:paths.sort(),ref:result.snapshotRef};
  }
  async function sources(paths,read,alive=()=>true){
    if(!paths.length)throw Error('Select at least one file.');
    if(paths.length>256)throw Error('Select at most 256 files.');
    const out=[];let total=0;
    for(const path of paths){
      if(!alive())throw Error('Download cancelled.');
      const result=await read(path),content=result?.content;
      if(typeof content!=='string')throw Error('Saved source unavailable: '+path);
      const size=new TextEncoder().encode(content).length;
      if(size>MAX_FILE||(total+=size)>MAX_TOTAL)throw Error('Export exceeds 8 MiB per file or 32 MiB total.');
      out.push({path,content});
    }
    return out;
  }
  function open(options){
    const {request,scope,getCanvas,onBom,focus}=options,doc=root.document;
    const existing=doc.querySelector('dialog.project-download');if(existing?.open)return existing;
    const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
    const dialog=el('dialog'),header=el('header'),body=el('section'),footer=el('footer'),status=el('p'),format=el('select'),extent=el('select'),pngExtent=el('select'),list=el('div'),details=el('details'),notes=el('p');
    dialog.className='project-download';dialog.setAttribute('aria-label','Download project');
    const button=(text,action)=>{const b=el('button',text);b.type='button';b.onclick=action;return b;};
    const close=button('×',()=>dialog.close());close.setAttribute('aria-label','Close download');header.append(el('h2','Download'),close);
    for(const [value,label]of [['project','Whole project · ZIP'],['files','Selected KiCad files · ZIP'],['pdf','Interactive PDF'],['png','Current drawing · PNG']]){const o=el('option',label);o.value=value;format.append(o);}
    for(const [value,label]of [['project','All schematic sheets and PCB layouts'],['schematic','All schematic sheets'],['selected','Selected drawings'],['current','Current drawing']]){const o=el('option',label);o.value=value;extent.append(o);}
    for(const [value,label]of [['full','Full current drawing'],['viewport','Current 2D viewport']]){const option=el('option',label);option.value=value;pngExtent.append(option);}
    pngExtent.setAttribute('aria-label','PNG drawing extent');
    format.setAttribute('aria-label','Download format');extent.setAttribute('aria-label','PDF drawings');list.className='project-download-files';status.setAttribute('role','status');
    const formatLabel=el('label'),formatCaption=el('span','Format'),formatIcon=el('span'),extentLabel=el('label','Include');formatCaption.append(formatIcon);formatLabel.append(formatCaption,format);extentLabel.append(extent);
    const pngLabel=el('label','Include');pngLabel.append(pngExtent);
    const summary=el('summary','Export details');details.append(summary,notes);body.append(formatLabel,extentLabel,pngLabel,list,details,status);
    let pinned=null,pending=null,busy=false;
    const alive=()=>dialog.isConnected;
    async function load(){
      if(!pending)pending=request('project-inventory',scope).then(inventory).then(value=>{pinned=value;return value;}).catch(e=>{pending=null;throw e;});
      return pending;
    }
    function save(blob,name){
      if(!alive())return;const a=el('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    const selected=()=>Array.from(list.querySelectorAll('input:checked'),i=>i.value);
    async function update(){
      if(root.KiCadUIIcons){formatIcon.replaceChildren(root.KiCadUIIcons.icon(format.value==='project'?'folder':'sheet'));}
      pngLabel.hidden=format.value!=='png';extentLabel.hidden=format.value!=='pdf';list.hidden=!(format.value==='files'||format.value==='pdf'&&extent.value==='selected');
      notes.textContent=format.value==='pdf'?'Searchable vector drawings with part properties and net links. Right-click properties are supported in the app PDF viewer; other PDF readers vary. Browser rendering may differ from native KiCad.':format.value==='project'?'Downloads the complete saved repository revision, including project assets. Nothing opens automatically.':'Selected files contain saved KiCad sources. External libraries and other assets are included only in the whole-project archive.';
      if(!list.hidden){
        status.textContent='Loading files…';try{const value=await load();if(!alive())return;list.replaceChildren();const paths=value.paths.filter(format.value==='files'?nativePath:drawingPath);if(paths.length>256)throw Error('This selection has more than 256 files; choose a smaller project.');for(const path of paths){const label=el('label'),input=el('input');input.type='checkbox';input.value=path;input.checked=true;label.append(input);if(root.KiCadUIIcons)label.append(root.KiCadUIIcons.icon(/\.kicad_pcb$/i.test(path)?'board':'sheet'));label.append(doc.createTextNode(path));list.append(label);}status.textContent=paths.length+' files';}catch(e){status.textContent=e.message;}
      }
    }
    format.onchange=update;extent.onchange=update;
    const generate=button('Download',async()=>{
      if(busy)return;busy=true;generate.disabled=true;format.disabled=true;extent.disabled=true;status.textContent='Preparing download…';
      try{
        if(format.value==='png'){
          const image=root.KiCadReviewTools.drawingImage(getCanvas(),{scope:pngExtent.value}),blob=await new Promise((resolve,reject)=>image.canvas.toBlob(b=>b?resolve(b):reject(Error('PNG encoding failed.')),'image/png'));save(blob,'drawing.png');
        }else{
          const value=await load();if(!alive())return;
          if(format.value==='project'&&options.remote){
            const a=el('a');a.href=root.KiCadRevisionActions.archiveURL(scope,value.ref);a.rel='noopener noreferrer';a.download='';doc.body.append(a);a.click();a.remove();
          }else if(format.value==='project'){
            throw Error('Whole-project archives are available for remote repositories. Use selected KiCad files for this local project.');
          }else{
            let paths=format.value==='files'||extent.value==='selected'?selected():value.paths.filter(p=>extent.value==='current'?p===scope.file:extent.value==='schematic'?/\.kicad_sch$/i.test(p):drawingPath(p));
            const drawings=paths.filter(drawingPath);if(format.value==='pdf'&&(!drawings.length||drawings.length>64))throw Error('Choose between 1 and 64 drawings.');
            // All schematic sources establish saved net/property context.
            const projectPath=(options.rootFile||scope.file).replace(/\.kicad_(sch|pcb)$/i,'.kicad_pro');
            const wanted=format.value==='pdf'?[...new Set([...drawings,...value.paths.filter(p=>/\.kicad_sch$/i.test(p)||p===projectPath)])]:paths;
            const saved=await sources(wanted,path=>request('project-file',{...scope,ref:value.ref,file:path}),alive);if(!alive())return;
            if(format.value==='files')save(new Blob([root.KiCadReviewTools.zipFiles(saved)],{type:'application/zip'}),'kicad-files.zip');
            else{
              status.textContent='Building searchable PDF…';
              const url=path=>root.chrome?.runtime?.getURL?root.chrome.runtime.getURL(path):new URL(path,doc.baseURI).href;
              if(!root.KiCadInteractivePDF)await import(url('interactive-pdf.js'));
              const response=await fetch(url('vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf'));if(!response.ok)throw Error('PDF font unavailable.');const fontBytes=new Uint8Array(await response.arrayBuffer());
              const designs=new Map(),warnings=[];
              for(let i=0;i<drawings.length;i++){
                const path=drawings[i],file=saved.find(f=>f.path===path),renderer=/\.kicad_pcb$/i.test(path)?root.KiCadPCBRenderer:root.KiCadSchematicRenderer;
                if(!renderer?.build)throw Error('Drawing renderer unavailable for '+path);
                const design=renderer.build(root.KiCadDesignDiff.parse(file.content),path,{sheetNumber:i+1,sheetCount:drawings.length,sheetName:path});designs.set(path,design);warnings.push(...(design.warnings||[]).map(w=>path+': '+(typeof w==='string'?w:JSON.stringify(w))));
              }
              const modelSources=saved.filter(f=>drawingPath(f.path)),model=root.KiCadDesignModel.buildProject(modelSources),netModel=root.KiCadNetModel.build(modelSources,designs);
              const settings=saved.find(f=>f.path===projectPath);
              if(settings&&root.KiCadProjectSearch){try{const classes=root.KiCadProjectSearch.parseNetClasses(settings.content);warnings.push(...classes.warnings);for(const net of netModel.nets)net.netclass=root.KiCadProjectSearch.netClasses(net.name,classes);}catch(error){warnings.push('Net classes unavailable: '+error.message);}}
              warnings.push(...(model.warnings||[]),...(netModel.warnings||[]));
              const pages=drawings.map(path=>({path,design:designs.get(path),...(/\.kicad_pcb$/i.test(path)?{visibleLayers:['F.Cu','B.Cu','F.SilkS','B.SilkS','Edge.Cuts']}:{}),objects:model.objects.filter(o=>o.path===path),nets:netModel.nets.filter(n=>n.path===path)}));
              const bytes=root.KiCadInteractivePDF.create(pages,{fontBytes,onWarning:warning=>warnings.push(warning)});if(!alive())return;save(new Blob([bytes],{type:'application/pdf'}),'kicad-project.pdf');
              if(warnings.length){notes.textContent+='\n'+warnings.slice(0,100).join('\n');details.open=true;status.textContent='PDF downloaded with '+warnings.length+' rendering/model warnings. Review export details.';return;}
            }
          }
        }
        if(alive())status.textContent='Download prepared. Your browser handles saving.';
      }catch(e){if(alive())status.textContent=e.message;}finally{busy=false;generate.disabled=false;format.disabled=false;extent.disabled=false;}
    });
    generate.setAttribute('data-icon','download');
    footer.append(button('BoM CSV…',()=>{dialog.close();onBom();}),generate);dialog.append(header,body,footer);
    dialog.addEventListener('close',()=>{dialog.remove();focus?.();},{once:true});doc.body.append(dialog);root.KiCadUIIcons?.decorate(dialog);dialog.showModal();format.focus?.();update();return dialog;
  }
  const api={open,inventory,sources};root.KiCadProjectDownload=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
