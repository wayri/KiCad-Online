/* Bundled parser worker: no repository requests, credentials or dynamic code. */
'use strict';
importScripts('legacy-kicad.js','design-diff.js','design-model.js','file-compatibility.js','worksheet.js','schematic-renderer.js','layer-colors.js','pcb-renderer.js','net-model.js','project-settings.js','project-search.js','draftsman-model.js','workspace-search.js');
onmessage=event=>{
  try{
    const {job,payload}=event.data||{};let result;let transfers=[];
    if(job==='settings'){
      postMessage({stage:'Reading saved board settings…'});
      result=KiCadProjectSettings.parse(payload.content,{file:payload.file});
    }else if(job==='workspace-search'){
      result=KiCadWorkspaceSearch.buildRecords(payload);
    }else if(job==='drawing'){
      postMessage({stage:'Indexing saved project objects…'});
      const {files,rootFile,pcb}=payload,snapshot=KiCadDesignDiff.prepareProject(files,{forConnectivity:true,compactCopper:pcb}),model=KiCadDesignModel.buildProject(files,null,snapshot,{forConnectivity:true}),file=files.find(f=>f.path===rootFile);
      if(!file)throw Error('The requested drawing is absent.');
      postMessage({stage:'Building drawing geometry…'});
      const sheets=files.filter(f=>/\.(kicad_sch|sch)$/i.test(f.path));
      const design=(pcb?KiCadPCBRenderer:KiCadSchematicRenderer).build(KiCadDesignDiff.preparedFile(snapshot,rootFile),rootFile,{packedZones:pcb,textVariables:file.textVariables,sheetNumber:sheets.findIndex(f=>f.path===rootFile)+1,sheetCount:sheets.length,sheetName:'/',...(globalThis.KiCadFileCompatibility?.textContext?.(files,rootFile,{rootFile,parse:(content,file)=>KiCadDesignDiff.preparedFile(snapshot,file.path)})||{})});
      postMessage({stage:'Resolving saved connectivity…'});
      const nets=KiCadNetModel.build(files,new Map([[rootFile,design]]),snapshot);
      if(design.packedZones)transfers=[...new Set(design.primitives.flatMap(primitive=>primitive.zoneCoordinates?[primitive.zoneCoordinates.buffer]:[]))];
      result={model,rules:[...model._rules],design,nets};
    }else throw Error('Unknown preparation job.');
    postMessage({ok:true,result},transfers);
  }catch(error){postMessage({ok:false,error:error.message||'KiCad preparation failed.'});}
};
