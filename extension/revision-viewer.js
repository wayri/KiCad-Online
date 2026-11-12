"use strict";

/* Native extension entry point: no external 2D visualization engine. */

(() => {

  const params=new URLSearchParams(location.search),repository=params.get('repository'),requestedFile=params.get('file');let rootFile=requestedFile,ref=params.get('ref');

  const provider=params.get('provider')||'github',providerContext=provider==='gitlab'?{provider,host:params.get('host')||'https://gitlab.com'}:{};const send=message=>chrome.runtime.sendMessage({...message,...providerContext}).then(reply=>{if(reply?.accessIssue)globalThis.KiCadStartupHealth?.showAccessIssue(reply.accessIssue);return reply;});
  if(params.get('workspace')==='1')document.body.dataset.workspace='true';
  const status=document.getElementById('status'),pcb=/\.kicad_pcb$/i.test(rootFile||'');

  const loadController=typeof AbortController==='function'?new AbortController():null;
  const loadId=globalThis.crypto?.randomUUID?.()||('load-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const remoteLoad=!globalThis.KiCadLocalRuntime&&(!globalThis.KiCadVSCodeContext||globalThis.KiCadAndroidRuntime);
  let loadFinished=false;
  const stopLoading=(message='Loading stopped.')=>{if(loadFinished||loadController?.signal.aborted)return;loadController?.abort(Object.assign(new Error(message),{name:'AbortError'}));};
  const loading=globalThis.KiCadLoading?.indicator(document.body,{onStop:()=>stopLoading()});
  function loadWait(promise){return new Promise((resolve,reject)=>{const signal=loadController?.signal,abort=()=>reject(signal?.reason||Object.assign(Error('Loading stopped.'),{name:'AbortError'}));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>{signal?.removeEventListener('abort',abort);signal?.aborted?abort():resolve(value);},error=>{signal?.removeEventListener('abort',abort);reject(error);});});}
  const loadSend=message=>{const pending=send({...message,...(remoteLoad?{loadId}:{})});const signal=loadController?.signal,abort=()=>{if(remoteLoad)void send({type:'load-cancel',loadId}).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});return loadWait(pending).finally(()=>signal?.removeEventListener('abort',abort));};
  let sheetOverview=null,compatibilityUI=null,windowLink=null,probeMaster=null,probeMasterHost=null,probeAssets=null;
  const viewSession=/^[a-zA-Z0-9_-]{32,128}$/.test(params.get('viewSession')||'')?params.get('viewSession'):globalThis.crypto?.randomUUID?.()||null;
  let dark=pcb,workspace=null,canvas=null,scene=null,modelAssetCache=null,disposed=false,applying=false,crossApplying=false,lastView='',lastFile='';

  const own=new URL(chrome.runtime.getURL('browser-viewer.html')),ownOrigin=`${own.protocol}//${own.host}`;

  const $=id=>document.getElementById(id);

  const label=(id,text)=>rootLabel($(id),text);

  function rootLabel(node,text){if(globalThis.KiCadUIIcons)KiCadUIIcons.label(node,text);else node.textContent=text;}

  function updateDiagnostics(){const count=[$('engineNotice'),$('reviewNotice')].filter(node=>node&&!node.hidden&&node.textContent).length;if($('diagnostics'))$('diagnostics').hidden=!count;if($('diagnosticCount'))$('diagnosticCount').textContent=count?`${count} rendering / review notes`:'Rendering notes';}

  async function start(){

    if(!KiCadBrowserData.validRepository(repository,provider)||!KiCadBrowserData.validRef(ref)||!KiCadBrowserData.validPath(rootFile))throw new Error('Invalid GitHub design location.');

    const kind=document.body.dataset.viewer;if(kind&&kind!=='auto'&&kind!==(pcb?'pcb':'schematic'))throw new Error('This file belongs in the other dedicated viewer.');

    loading?.show('Resolving drawing revision…');
    if(!globalThis.KiCadVSCodeContext&&!/^[a-f0-9]{40}$/i.test(ref)){const resolved=await loadSend({type:'revision-resolve',repository,ref,file:rootFile});if(!resolved?.ok||!/^[a-f0-9]{40}$/i.test(resolved.result?.sha||''))throw new Error(resolved?.error||'Git revision could not be resolved.');ref=resolved.result.sha;}
    loading?.show('Fetching drawing files and discovering sheets…');
    const reply=await loadSend({type:'project',repository,ref,file:rootFile});

    if(!reply?.ok)throw new Error(reply?.error||'Could not retrieve the KiCad project.');

    const files=reply.result;if(!Array.isArray(files)||!files.some(file=>file.path===rootFile))throw new Error('No KiCad file at this revision.');

    if(!pcb){const resolvedRoot=KiCadBrowserData.rootSheetPath(files,requestedFile);if(resolvedRoot)rootFile=resolvedRoot;else if(files.length&&!files.some(file=>file.discoveryWarning))files[0].discoveryWarning='The saved schematic hierarchy has no unambiguous root. Choose a sheet in the navigator.';}
    const focusedEntry=params.has('focusX')&&params.has('focusY')&&['focusX','focusY'].every(key=>Number.isFinite(Number(params.get(key)))&&Math.abs(Number(params.get(key)))<=1e6);
    const initialFile=focusedEntry?requestedFile:rootFile;

    const preferenceKey=JSON.stringify(['kicad-review-preferences',...(provider==='gitlab'?['gitlab',providerContext.host]:[]),repository,rootFile]);

    let preferences={uiTheme:pcb?'dark':'light',drawingTheme:pcb?'dark':'light',rulerUnits:'mm',acceleration:'auto'};

    try{const stored=await loadWait(chrome.storage?.local?.get(preferenceKey)),value=stored?.[preferenceKey];if(value&&['dark','light'].includes(value.uiTheme)&&['dark','light'].includes(value.drawingTheme)&&['mm','mil'].includes(value.rulerUnits))preferences=value;}catch{}

    if(loadController?.signal.aborted)throw loadController.signal.reason;
    dark=preferences.drawingTheme==='dark';document.body.dataset.uiTheme=preferences.uiTheme;

    // buildProject enforces source/file/project limits before the geometry parser runs.

    loading?.show('Preparing saved objects and drawing geometry…');
    const prepare=()=>{
      const snapshot=KiCadDesignDiff.prepareProject(files),model=KiCadDesignModel.buildProject(files,null,snapshot);
      const sheets=files.filter(file=>/\.(kicad_sch|sch)$/i.test(file.path));
      const design=(pcb?KiCadPCBRenderer:KiCadSchematicRenderer).build(KiCadDesignDiff.preparedFile(snapshot,initialFile),initialFile,{textVariables:files.find(f=>f.path===initialFile)?.textVariables,sheetNumber:sheets.findIndex(file=>file.path===initialFile)+1,sheetCount:sheets.length,sheetName:'/'});
      const nets=globalThis.KiCadNetModel?.build(files,new Map([[initialFile,design]]),snapshot);
      return {model,design,nets};
    };
    const prepared=globalThis.KiCadLoading?await KiCadLoading.run('drawing',{files,rootFile:initialFile,pcb},prepare,{signal:loadController?.signal,onStage:stage=>loading.show(stage)}):prepare();
    if(disposed)return;if(loadController?.signal.aborted)throw loadController.signal.reason;
    if(prepared.rules)Object.defineProperty(prepared.model,'_rules',{value:new Map(prepared.rules)});

    if($('refBadge')){$('refBadge').textContent=ref.length>20?ref.slice(0,17)+'…':ref;$('refBadge').title=ref;}

    const designs=new Map(prepared.design?[[initialFile,prepared.design]]:[]),host=$('drawingHost');globalThis.KiCadUIIcons?.decorate();$('frameControls').hidden=false;

    canvas=KiCadOwnedCanvas.mount(host,{dark,pcb,acceleration:preferences.acceleration,worksheet:preferences.worksheet!==false});status.remove();
    compatibilityUI=globalThis.KiCadFileCompatibility?.mountStatus($('frameControls'),()=>canvas.design?.compatibility);

    const currentFile=()=>canvas.document?.filename||initialFile;

    const report=force=>{

      if(applying||scene||disposed)return;

      const view=KiCadViewState.read(canvas.viewport.camera),file=currentFile();if(!view)return;

      const signature=JSON.stringify([file,view.x,view.y,view.zoom]);if(!force&&signature===lastView)return;

      const phase=lastFile===file?'change':'ready';lastView=signature;lastFile=file;

      parent.postMessage({type:'kicad-review:view',phase,file,view,ref,uiTheme:preferences.uiTheme,drawingTheme:preferences.drawingTheme},ownOrigin);

    };

    const setStatusText=(id,value)=>{const node=$(id);if(node&&node.textContent!==value)node.textContent=value;};
    let syncFloatingLayers=()=>{};
    const afterFrame=()=>{syncFloatingLayers();workspace?.draw();if(!scene)setStatusText('renderMode',canvas.motionActive?'2D · WebGL':'2D');const backend=canvas.motionActive?'webgl-motion':'canvas2d';if(host.dataset.renderBackend!==backend)host.dataset.renderBackend=backend;setStatusText('accelerationStatus',canvas.motionFailed?'WebGL unavailable; using Canvas2D.':canvas.acceleration==='off'?'Canvas2D only.':'WebGL gesture previews on large drawings when available; source geometry is redrawn after each gesture.');setStatusText('viewScale',Math.round(canvas.viewport.camera.zoom/4*100)+'%');setStatusText('drawingViewLabel',canvas.netHighlight?(canvas.highlightCount>1?`${canvas.highlightCount} highlight groups`:canvas.netHighlight.name?'Highlighted net · '+canvas.netHighlight.name:'Highlighted components'):canvas.paperVisible?(pcb?'PCB worksheet':'Schematic sheet'):'Board view');report(false);};
    const originalDraw=canvas.draw.bind(canvas);canvas.draw=()=>{originalDraw();afterFrame();};canvas.addEventListener('kicad:viewframe',afterFrame);

    canvas.canvas.addEventListener?.('pointermove',event=>{const rect=canvas.canvas.getBoundingClientRect(),point=canvas.viewport.camera.screen_to_world({x:event.clientX-rect.left,y:event.clientY-rect.top});setStatusText('cursorCoords',`${point.x.toFixed(2)}, ${point.y.toFixed(2)} mm`);});

    const focus=position=>{

      if(!position||![position.x,position.y].every(Number.isFinite)||Math.abs(position.x)>1e6||Math.abs(position.y)>1e6||scene)return false;

      canvas.resize();const c=canvas.viewport.camera,b=c.bbox,w=Math.max(12,Math.min(40,b.w)),h=Math.max(12,Math.min(40,b.h));c.bbox={x:position.x-w/2,y:position.y-h/2,w,h};canvas.draw();return true;

    };

    const layerList=$('layerList');
    // An overlay keeps layer switching available without opening an explorer pane.
    const floatingLayers=document.createElement('div'),floatingButtons=new Map(),floatingEyes=new Map();
    floatingLayers.id='floatingLayerSelector';floatingLayers.className='floating-layer-selector';
    floatingLayers.setAttribute('role','group');floatingLayers.setAttribute('aria-label','PCB layer selector');
    floatingLayers.title='Highlight a layer or use its eye to show/hide it · scroll here to cycle copper layers';
    let layerWheel=0,lastLayerCycle=0;
    const stepCopper=step=>{if(scene)return;const copper=(canvas.design?.layers||[]).filter(layer=>layer.endsWith('.Cu'));if(!copper.length)return;const index=copper.indexOf(canvas.focusedLayer),next=index<0?(step>0?0:copper.length-1):(index+step+copper.length)%copper.length;canvas.focusLayer(copper[next],$('layerFocusMode').value==='isolate'?'isolate':'dim');layers();canvas.draw();};
    floatingLayers.addEventListener('wheel',event=>{if(scene||event.ctrlKey)return;event.preventDefault();event.stopPropagation();layerWheel+=(event.deltaY||event.deltaX||0)*(event.deltaMode===1?16:event.deltaMode===2?400:1);if(Math.abs(layerWheel)<30||Date.now()-lastLayerCycle<120)return;stepCopper(layerWheel>0?1:-1);layerWheel=0;lastLayerCycle=Date.now();},{passive:false});
    floatingLayers.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();stepCopper(['ArrowRight','ArrowDown'].includes(event.key)?1:-1);});
    floatingLayers.hidden=true;if(pcb)host.append(floatingLayers);
    let floatingSignature='',floatingToggle=null,floatingFocusMode=null,layerKeyboard=false;
    const compactLayerBar=!globalThis.KiCadAndroidUI;
    const closeFloatingLayers=()=>{floatingLayers.classList.remove('layers-expanded');floatingToggle?.setAttribute('aria-expanded','false');};
    floatingLayers.addEventListener('pointerdown',()=>{layerKeyboard=false;});
    floatingLayers.addEventListener('pointerleave',()=>{if(compactLayerBar&&!layerKeyboard)closeFloatingLayers();});
    floatingLayers.addEventListener('focusout',event=>{if(!floatingLayers.contains(event.relatedTarget))closeFloatingLayers();});
    floatingLayers.addEventListener('keydown',event=>{layerKeyboard=true;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeFloatingLayers();floatingToggle?.focus?.();}});
    syncFloatingLayers=()=>{
      const savedLayers=canvas.design?.layers||[];
      const hidden=!pcb||Boolean(scene)||!savedLayers.length;if(floatingLayers.hidden!==hidden)floatingLayers.hidden=hidden;if(hidden)return;
      const signature=JSON.stringify(savedLayers);
      if(signature!==floatingSignature){
        floatingSignature=signature;floatingLayers.replaceChildren();floatingButtons.clear();floatingEyes.clear();
        const layerOptions=document.createElement('div');
        if(compactLayerBar){
          layerOptions.className='compact-layer-options';floatingToggle=document.createElement('button');floatingToggle.type='button';floatingToggle.className='compact-layer-toggle';floatingToggle.setAttribute('aria-label','Choose PCB layers');floatingToggle.setAttribute('aria-expanded','false');floatingToggle.textContent='Layers';
          floatingToggle.onclick=()=>{const expanded=floatingToggle.getAttribute('aria-expanded')!=='true';floatingToggle.setAttribute('aria-expanded',String(expanded));floatingLayers.classList.toggle('layers-expanded',expanded);};
          floatingLayers.classList.remove('layers-expanded');floatingLayers.append(floatingToggle,layerOptions);
        }
        const add=(name,title,action,color,targetNode)=>{
          const button=document.createElement('button');button.type='button';button.title=title;
          button.setAttribute('aria-label',title);button.dataset.layer=name;
          if(color){const swatch=document.createElement('span');swatch.className='layer-swatch';swatch.style.background=color;button.append(swatch);}
          const label=document.createElement('span');label.textContent=name;button.append(label);
          button.onclick=()=>{if(scene)return;action();layers();canvas.draw();};
          floatingButtons.set(name,button);(targetNode||(compactLayerBar?layerOptions:floatingLayers)).append(button);return button;
        };
        floatingFocusMode=document.createElement('select');floatingFocusMode.setAttribute('aria-label','Layer selection style');floatingFocusMode.title='Highlight keeps other visible layers as context; Isolate hides them';for(const [value,label]of [['dim','Highlight layer'],['isolate','Isolate layer']]){const option=document.createElement('option');option.value=value;option.textContent=label;floatingFocusMode.append(option);}floatingFocusMode.value=$('layerFocusMode').value==='isolate'?'isolate':'dim';floatingFocusMode.onchange=()=>{$('layerFocusMode').value=floatingFocusMode.value;if(canvas.focusedLayer)canvas.focusLayer(canvas.focusedLayer,floatingFocusMode.value);layers();canvas.draw();};(compactLayerBar?layerOptions:floatingLayers).append(floatingFocusMode);
        for(const layer of savedLayers){
          const item=document.createElement('div'),eye=document.createElement('button');
          item.className='compact-layer-item';eye.type='button';eye.className='compact-layer-eye';eye.dataset.layerVisibility=layer;
          add(layer,'Focus layer '+layer,()=>{canvas.focusLayer(layer,$('layerFocusMode').value==='isolate'?'isolate':'dim');},KiCadPCBRenderer.colorFor?.(layer)||'#8c9cab',item);
          eye.onclick=()=>{if(scene)return;const visible=canvas.visibleLayers.has(layer);if(visible){canvas.visibleLayers.delete(layer);if(canvas.focusedLayer===layer)canvas.focusedLayer=null;}else canvas.visibleLayers.add(layer);layers();canvas.draw();};
          item.append(eye);(compactLayerBar?layerOptions:floatingLayers).append(item);floatingEyes.set(layer,eye);
        }
        add('All','Show all saved board layers',()=>canvas.layerPreset('all'));
        add('Overview','Restore layer view before focusing',()=>canvas.restoreLayers());
        add('Filled copper','Toggle saved filled copper zones',()=>canvas.setZoneVisibility({filled:canvas.showFilledCopper===false}));
        add('Zone outlines','Toggle saved zone boundary outlines',()=>canvas.setZoneVisibility({outlines:canvas.showZoneOutlines===false}));
        add('Worksheet','Show or hide the saved KiCad page and title block',()=>{preferences.worksheet=!canvas.paperVisible;canvas.setWorksheetVisible(preferences.worksheet);savePreferences();});
        add('Numbers','Show saved pin and pad numbers, including BGA ball identifiers',()=>{preferences.showTerminalNumbers=canvas.showTerminalNumbers===false;applyTheme();savePreferences();});
        add('Net names','Show copper net names in 2D and 3D',()=>{preferences.showNetNames=!canvas.showNetNames;applyTheme();savePreferences();});
      }
      for(const [name,button] of floatingButtons){
        const selected=name==='Worksheet'?canvas.paperVisible:name==='Numbers'?canvas.showTerminalNumbers!==false:name==='Net names'?canvas.showNetNames===true:name==='Filled copper'?canvas.showFilledCopper!==false:name==='Zone outlines'?canvas.showZoneOutlines!==false:name==='All'?!canvas.focusedLayer&&(canvas.design.layers||[]).every(layer=>canvas.visibleLayers.has(layer)):name==='Overview'?!canvas.focusedLayer&&!canvas.layerSnapshot:canvas.focusedLayer===name;
        if(button.getAttribute('aria-pressed')!==String(selected))button.setAttribute('aria-pressed',String(selected));
      }
      for(const [layer,eye]of floatingEyes){const visible=canvas.visibleLayers.has(layer),label=(visible?'Hide ':'Show ')+layer,icon=visible?'eye':'eye-off';if(eye.getAttribute('aria-label')===label)continue;eye.setAttribute('aria-pressed',String(visible));eye.setAttribute('aria-label',label);eye.title=label;eye.setAttribute('data-icon',icon);if(globalThis.KiCadUIIcons)KiCadUIIcons.decorate(eye);else eye.textContent=visible?'Visible':'Hidden';}
      if(floatingFocusMode)floatingFocusMode.value=$('layerFocusMode').value==='isolate'?'isolate':'dim';
      if(floatingToggle&&floatingToggle.textContent!==(canvas.focusedLayer||'Layers'))floatingToggle.textContent=canvas.focusedLayer||'Layers';
    };

    function layers(){

      syncFloatingLayers();if(!layerList)return;layerList.replaceChildren();$('layerPanel').hidden=!pcb;

      const query=($('layerSearch').value||'').trim().toLowerCase();

      for(const layer of canvas.design.layers||[]){

        if(!layer.toLowerCase().includes(query))continue;

        const row=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span'),button=document.createElement('button');

        row.className='layer-row';row.dataset.focused=String(canvas.focusedLayer===layer);input.type='checkbox';input.checked=canvas.visibleLayers.has(layer);text.textContent=layer;label.className='check';

        const swatch=document.createElement('span');swatch.className='layer-swatch';swatch.style.background=KiCadPCBRenderer.colorFor?.(layer)||canvas.design.primitives.find(p=>p.layer===layer)?.color||'#8c9cab';

        input.onchange=()=>{input.checked?canvas.visibleLayers.add(layer):canvas.visibleLayers.delete(layer);if(!input.checked&&canvas.focusedLayer===layer)canvas.focusedLayer=null;layers();canvas.draw();};

        label.append(input,swatch,text);button.textContent='Focus';button.setAttribute('aria-label','Focus layer '+layer);button.setAttribute('aria-pressed',String(canvas.focusedLayer===layer));button.disabled=Boolean(scene);

        button.onclick=()=>{canvas.focusLayer(layer,$('layerFocusMode').value||'dim');layers();canvas.draw();};row.append(label,button);layerList.append(row);

      }

      $('layerFocusStatus').textContent=canvas.focusedLayer?`${canvas.focusedLayer} · ${canvas.layerFocusMode==='isolate'?'isolated':'other visible layers dimmed'}`:'No layer focus';

      $('fitLayer').disabled=!canvas.focusedLayer||Boolean(scene);$('clearLayerFocus').disabled=!canvas.focusedLayer||Boolean(scene);$('layersRestore').disabled=!canvas.layerSnapshot||Boolean(scene);

    }

    $('layerSearch').oninput=layers;

    $('layerFocusMode').onchange=()=>{if(canvas.focusedLayer)canvas.focusLayer(canvas.focusedLayer,$('layerFocusMode').value);layers();canvas.draw();};

    for(const [id,preset] of [['layersAll','all'],['layersNone','none'],['layersFront','front'],['layersBack','back'],['layersCopper','copper']])$(id).onclick=()=>{if(scene)return;canvas.layerPreset(preset);layers();canvas.draw();};

    $('layersRestore').onclick=()=>{canvas.restoreLayers();layers();canvas.draw();};

    $('clearLayerFocus').onclick=()=>{canvas.focusedLayer=null;layers();canvas.draw();};

    $('fitLayer').onclick=()=>{if(!canvas.fitLayer())$('layerFocusStatus').textContent='No drawable geometry on the focused layer.';canvas.draw();};

    function buildSheet(path){
      if(!designs.has(path)){
        const file=files.find(source=>source.path===path);
        if(!file)throw new Error('The referenced sheet is absent.');
        const sheets=files.filter(source=>/\.(?:kicad_sch|sch)$/i.test(source.path));
        designs.set(path,(pcb?KiCadPCBRenderer:KiCadSchematicRenderer).build(KiCadDesignDiff.parse(file.content,{libraries:file.legacyLibraries}),path,{textVariables:file.textVariables,sheetNumber:sheets.findIndex(source=>source.path===path)+1,sheetCount:sheets.length,sheetName:path===rootFile?'/':'/'+path.split('/').at(-1).replace(/\.(?:kicad_sch|sch)$/i,'')+'/'}));
      }
      return designs.get(path);
    }
    function openSheet(path,position){
      sheetOverview?.close();

      if(scene)return;const file=files.find(source=>source.path===path);if(!file)throw new Error('The referenced sheet is absent.');

      if(/\.kicad_pcb$/i.test(path)!==pcb)throw new Error('Cannot mix board and schematic drawings.');

      buildSheet(path);

      canvas.setDocument(designs.get(path),path);compatibilityUI?.refresh();layers();workspace?.attachCanvas(canvas);workspace?.draw();

      $('engineNotice').textContent=canvas.design.warnings?.join(' ')||'';$('engineNotice').hidden=!$('engineNotice').textContent;updateDiagnostics();

      if(position)focus(position);
      sheetOverview?.refreshTree?.();

    }

    loading?.show('Displaying drawing…');
    await globalThis.KiCadLoading?.paint();
    if(disposed)return;if(loadController?.signal.aborted)throw loadController.signal.reason;
    // Probe sources are resolved once per immutable revision, never during pan/zoom.
    const probeProjects=new Map(),probeDesigns=new Map(),probeModels=new WeakMap(),probeNets=new WeakMap();let probeInventory=null,probeEngine=null,probeMasterPath=null,probeMasterLoading=false;
    async function probeFiles(kind){
      if(!probeProjects.has(kind))probeProjects.set(kind,(async()=>{
        const known=files.filter(f=>(/\.kicad_pcb$/i.test(f.path)?'layout':/\.(kicad_sch|sch)$/i.test(f.path)?'schematic':null)===kind);
        if(known.length)return known;
        const projectRoot=KiCadBrowserData.rootSheetPath(files,rootFile)||rootFile;
        const response=await (probeInventory||=send({type:'drawing-files',repository,ref,file:projectRoot}));
        if(!response?.ok)throw Error(response?.error||'Project drawing inventory unavailable.');
        const paths=(response.result?.files||[]).map(f=>typeof f==='string'?f:f.path).filter(p=>kind==='layout'?/\.kicad_pcb$/i.test(p):/\.(kicad_sch|sch)$/i.test(p));
        const candidates=KiCadNetQuickView.probeFileCandidates(paths,{kind,rootFile,files,pairedFile:params.get('pairedFile')});
        if(!candidates.length)throw Error('No saved '+kind+' drawing in this project.');
        if(candidates.length>8)throw Error('More than eight possible '+kind+' drawings. Select a project or paired drawing to scope the probe.');
        const sources=new Map();let characters=0;
        for(const path of candidates){const reply=await send({type:'project',repository,ref,file:path});if(!reply?.ok||!Array.isArray(reply.result))throw Error(reply?.error||'Probe drawing sources unavailable: '+path);for(const file of reply.result){if(!sources.has(file.path)){characters+=typeof file.content==='string'?file.content.length:0;if(characters>32*1024*1024)throw Error('Project is too large for a popup. Select the paired drawing explicitly.');}sources.set(file.path,file);}}
        return [...sources.values()];
      })().catch(error=>{probeProjects.delete(kind);probeInventory=null;throw error;}));
      return probeProjects.get(kind);
    }
    function probeDesign(source,path,targetBoard){
      if(designs.has(path))return designs.get(path);
      if(!probeDesigns.has(path)){
        const file=source.find(f=>f.path===path);if(!file)throw Error('Saved probe source unavailable.');
        probeDesigns.set(path,(targetBoard?KiCadPCBRenderer:KiCadSchematicRenderer).build(KiCadDesignDiff.parse(file.content,{libraries:file.legacyLibraries}),path,{textVariables:file.textVariables}));
      }
      return probeDesigns.get(path);
    }
    const schematicProbeContexts=new WeakMap();
    async function getSchematicProbeRows(row,selection){
      const source=await probeFiles('schematic');if(disposed)throw Error('Workspace closed.');
      if(!schematicProbeContexts.has(source)){
        if(!probeModels.has(source))probeModels.set(source,KiCadDesignModel.buildProject(source));
        const model=probeModels.get(source),rendered=new Map(source.filter(f=>/\.(kicad_sch|sch)$/i.test(f.path)).map(f=>[f.path,probeDesign(source,f.path,false)]));
        const nets=KiCadNetModel.build(source,rendered).nets,placements=KiCadReviewWorkspace.sheetOverviewEntries(model.sheets.filter(s=>s.kind==='schematic'),model.objects.filter(o=>o.kind==='sheet')).flatMap(e=>e.placements||[]);
        const byInstance=new Map(placements.map(p=>[p.id,p]));
        for(const p of placements){const ids=[],seen=new Set();let parent=p;while(parent?.parentId&&!seen.has(parent.id)){seen.add(parent.id);ids.unshift(parent.sheetId);parent=byInstance.get(parent.parentId);}const rootUuid=model.sheets.find(s=>s.path===parent?.path)?.rootUuid;if(rootUuid&&ids.every(Boolean))p.nativePath='/'+[rootUuid,...ids].join('/');}
        schematicProbeContexts.set(source,{model,rendered,nets,placements});
      }
      const {model,rendered,nets,placements}=schematicProbeContexts.get(source),canonical=selection?.canonical||row?.selection?.canonical||row?.group?.canonical;
      const valid=KiCadPairedReview.validSelection(canonical),matching=new Map();
      if(valid&&canonical.kind==='net'){
        const schematic=/\.kicad_sch$/i.test(canonical.path),bound=selection?.net||selection?.group||row?.group;let seeds=schematic?nets.filter(n=>n.path===canonical.path&&(n.name===canonical.netName||n.names?.includes(canonical.netName))):nets.filter(n=>n.globalNames?.includes(canonical.netName)||KiCadPairedReview.qualifiedNetName(n,model.objects)===canonical.netName);
        if(schematic&&bound?.path===canonical.path){const exact=nets.filter(n=>n.path===canonical.path&&n.id===bound.id);if(exact.length===1)seeds=exact;}
        if(!schematic&&!seeds.length){const combined=[...new Map([...model.objects,...(selection?.objects||row?.entry?.objects||[])].map(o=>[JSON.stringify([o.kind,o.path,o.uuid||o.id]),o])).values()],mapped=KiCadPairedReview.relatedNetByTerminals(nets,combined,canonical,bound,{instancePath:row?.entry?.instanceId});if(mapped.net)seeds=[mapped.net];}
        const selected=[];
        for(const net of seeds){const instances=placements.filter(p=>p.path===net.path),active=row?.entry?.path===net.path?row.entry.instanceId:null;if(active&&instances.some(p=>p.id===active))selected.push({netId:net.id,instanceId:active});else if(!schematic||instances.length===1)for(const p of instances)selected.push({netId:net.id,instanceId:p.id});}
        const graph=globalThis.KiCadOverviewConnectivity?.resolve(nets,selected,placements);
        for(const hit of graph?.matches||[]){if(!matching.has(hit.instanceId))matching.set(hit.instanceId,[]);matching.get(hit.instanceId).push(hit.net);}
      }else if(valid){
        try{const resolved=await resolveProbeViews(row,selection,'schematic'),targets=placements.filter(p=>p.path===resolved.entry.path),identity=resolved.selection?.canonical;for(const p of targets)if(targets.length===1||identity?.tstampPath===p.nativePath+'/'+(identity.ownerUuid||identity.uuid))matching.set(p.id,[resolved.group]);}catch{ /* Manual sheet browsing remains available when a part has no safe mapping. */ }
      }
      const sheets=placements.map(p=>{
        const design=rendered.get(p.path),local=nets.filter(n=>n.path===p.path),groups=matching.get(p.id)||[],primitives=[...new Set(groups.flatMap(g=>g.primitives||[]))],name=canonical?.netName||canonical?.reference||row?.name||'Sheet',label=p.label||p.path;
        const picked={...(selection||{}),primitives,...(valid?{canonical}:{})},group={id:'probe-sheet:'+p.id,kind:canonical?.kind||'net',name,primitives,...(valid?{canonical}:{})};
        return {id:JSON.stringify([p.path,p.id]),name,label,group,selection:picked,entry:{path:p.path,kind:'schematic',label,instanceId:p.id,instanceLabel:label,design,groups:local,nets:local,objects:model.objects,model,sourceFiles:source}};
      }).filter(r=>r.entry.design);
      return {sheets,occurrences:sheets.filter(r=>r.group.primitives.length)};
    }
    async function resolveProbeViews(row,selection,mode){
      if(disposed)throw Error('Workspace closed.');
      const kind=mode==='3d'?'layout':mode,source=await probeFiles(kind);
      if(disposed)throw Error('Workspace closed.');
      if(!probeModels.has(source))probeModels.set(source,KiCadDesignModel.buildProject(source));
      const model=probeModels.get(source),canonical=selection?.canonical;
      if(!KiCadPairedReview.validSelection(canonical))throw Error('Select a saved part, net or pin before switching probe views.');
      const targetBoard=kind==='layout',sameKind=/\.kicad_pcb$/i.test(canonical.path)===targetBoard;
      const getDesign=path=>probeDesign(source,path,targetBoard);
      const paths=source.filter(f=>targetBoard?/\.kicad_pcb$/i.test(f.path):/\.(kicad_sch|sch)$/i.test(f.path)).map(f=>f.path);
      let object,group,path;
      if(canonical.kind==='part'||canonical.kind==='pin'){
        if(sameKind){const matches=model.objects.filter(o=>o.path===canonical.path&&o.kind===(targetBoard?'footprint':'symbol')&&(canonical.ownerUuid||canonical.uuid?o.uuid===(canonical.ownerUuid||canonical.uuid):o.reference===canonical.reference));if(matches.length===1)object=matches[0];}
        else {const part={kind:'part',reference:canonical.reference,path:canonical.path};for(const key of ['symbolUuid','tstampPath','rootUuid'])if(canonical[key])part[key]=canonical[key];if(canonical.ownerUuid||canonical.uuid)part.uuid=canonical.ownerUuid||canonical.uuid;const result=KiCadPairedReview.relatedPart(model.objects,part);object=result.object;if(!object)throw Error(result.error);}
        if(!object)throw Error('No unambiguous saved component for this probe.');path=object.path;
        const design=getDesign(path),primitives=design.primitives.filter(p=>!p.frame&&(p.ownerUuid===object.uuid||p.uuid===object.uuid||!p.ownerUuid&&p.reference===object.reference)&&
          (canonical.kind!=='pin'||String(p.pinNumber??p.name??'')===canonical.pinNumber&&['pad','pin','pin-marker','pin-number','pin-name'].includes(p.kind)));
        if(!primitives.length)throw Error('The saved terminal/component has no rendered geometry.');group={id:object.id,kind:canonical.kind,name:object.reference,primitives};
      }else{
        const netDesigns=new Map(paths.map(path=>[path,getDesign(path)])),nets=KiCadNetModel.build(source,netDesigns).nets;
        const bound=selection?.net||selection?.group||row?.group,byIdentity=sameKind&&bound?.path===canonical.path?nets.filter(n=>n.path===canonical.path&&n.id===bound.id):[];
        const direct=byIdentity.length?byIdentity:sameKind?nets.filter(n=>n.path===canonical.path&&(n.name===canonical.netName||n.names?.includes(canonical.netName))):[];
        let result=direct.length===1?{net:direct[0]}:KiCadPairedReview.relatedNet(nets,model.objects,canonical);
        if(!result.net){const sourceObjects=selection?.objects||row?.entry?.objects||[],combined=[...new Map([...model.objects,...sourceObjects].map(o=>[JSON.stringify([o.kind,o.path,o.uuid||o.id]),o])).values()];result=KiCadPairedReview.relatedNetByTerminals(nets,combined,canonical,selection?.net||selection?.group||row?.group,{instancePath:row?.entry?.instanceId});}
        if(!result.net)throw Error(result.error||'No unambiguous saved net.');group=result.net;path=group.path;
      }
      const design=getDesign(path);if(!probeNets.has(design))probeNets.set(design,KiCadNetModel.build(source.filter(f=>f.path===path),new Map([[path,design]])).nets);const nets=probeNets.get(design);
      let targetSelection;if(object){const nativeInstance=!targetBoard&&canonical.tstampPath?.split('/').length>2?canonical.tstampPath.split('/').slice(0,-1).join('/'):undefined,part=KiCadPairedReview.partSelection(object,{instancePath:nativeInstance});targetSelection={kind:canonical.kind,reference:object.reference,object,primitives:group.primitives,primitive:group.primitives[0],...(canonical.kind==='pin'?{pinNumber:canonical.pinNumber}:{}),canonical:canonical.kind==='pin'?{...part,kind:'pin',ownerUuid:object.uuid,pinNumber:canonical.pinNumber}:part};}
      else {const qualified=KiCadPairedReview.qualifiedNetName(group,model.objects);targetSelection={kind:'net',netName:group.name,group,primitives:group.primitives,canonical:{kind:'net',path,netName:group.name,...(qualified?{qualifiedNetName:qualified}:{})}};}
      return {id:JSON.stringify([path,group.id,mode]),name:group.name,label:path,group,selection:targetSelection,entry:{path,kind,design,groups:nets,nets,objects:model.objects,model,sourceFiles:source}};
    }
    const loadProbeEngine=()=>probeEngine||=new Promise((resolve,reject)=>{
      if(globalThis.SpikeBoard3D?.mountBoard3D)return resolve(SpikeBoard3D);
      const script=document.createElement('script');script.src='vendor/spike-board3d.bundle.js';script.onload=()=>globalThis.SpikeBoard3D?resolve(SpikeBoard3D):reject(Error('3D engine unavailable.'));script.onerror=()=>{probeEngine=null;reject(Error('3D engine could not load.'));};document.head.append(script);
    });
    async function mountProbe3D(holder,{entry,group,onSelect,onViewChange}){
      if(disposed)throw Error('Workspace closed.');
      let parentScene=scene&&entry.path===rootFile?scene:probeMaster;
      if(parentScene&&probeMasterPath&&probeMasterPath!==entry.path)throw Error('Close the current 3D probe before probing another board.');
      if(!parentScene){
        if(probeMasterLoading)throw Error('A 3D probe is already loading. Wait for it to finish.');probeMasterLoading=true;
        try{const engine=await loadProbeEngine(),file=(entry.sourceFiles||files).find(f=>f.path===entry.path);
        if(disposed)throw Error('Workspace closed.');if(!file)throw Error('3D board source unavailable.');
        probeMasterHost=document.createElement('div');Object.assign(probeMasterHost.style,{position:'fixed',left:'-400px',top:'0',width:'320px',height:'320px',visibility:'hidden'});document.body.append(probeMasterHost);
        const assets=probeAssets=KiCadBrowserData.createModelAssetCache(async path=>{const reply=await send({type:'repo-asset',repository,ref,file:path});if(!reply?.ok)throw Error(reply?.error||'Saved model unavailable.');return reply.result;});
        const inventory=await send({type:'repo-model-index',repository,ref,file:entry.path});if(disposed){assets.clear();probeMasterHost.remove();throw Error('Workspace closed.');}
        parentScene=probeMaster=engine.mountBoard3D(probeMasterHost,file.content,{dark,boardPath:entry.path,assetPaths:inventory?.ok?inventory.result?.paths||[]:[],loadAsset:assets.load,externalInspector:true,onSelect:(record,gesture)=>workspace?.select3D(record,gesture),onInspect:record=>workspace?.inspect3D(record),onComment:record=>workspace?.comment3D(record),onViewChange:()=>workspace?.sceneViewChanged()});probeMasterPath=entry.path;
        }catch(error){if(!probeMaster){probeAssets?.clear();probeMasterHost?.remove();}throw error;}finally{probeMasterLoading=false;}
      }
      if(!parentScene.createProbeViewport)throw Error('Update the 3D renderer to enable interactive probes.');
      const appearance=value=>value?.kind==='net'?{netNames:[value.netName||value.group?.name]}:value?.kind==='part'?{references:[value.reference]}:{uuids:(value?.primitives||group.primitives||[]).map(p=>p.uuid).filter(Boolean)};
      const viewport=parentScene.createProbeViewport(holder,{selection:group.kind==='net'||group.code!==undefined?{netNames:[group.name]}:group.kind==='part'?{references:[group.name]}:{uuids:(group.primitives||[]).map(p=>p.uuid).filter(Boolean)},onSelect:(record,gesture)=>onSelect({...record,probeRecord:true},gesture),onViewChange,dark});
      const setSelection=viewport.setSelection?.bind(viewport);if(setSelection)viewport.setSelection=value=>setSelection(appearance(value));return viewport;
    }
    workspace=KiCadReviewWorkspace.mount({initialModel:prepared.model,initialDesign:prepared.design,initialNetModel:prepared.nets,files,repository,provider,host:providerContext.host,ref,rootFile,pcb,pairedFile:params.get('pairedFile')||undefined,getCanvas:()=>canvas,currentFile,focus,openSheet,getRulerUnits:()=>preferences.rulerUnits,

      getDesigns:()=>designs,resolveProbeViews,getSchematicProbeRows,mountProbe3D,updateDiagnostics,onOverviewHighlights:()=>sheetOverview?.refresh(),
      onHierarchy(hierarchy){if(!disposed)parent.postMessage({type:'kicad-review:hierarchy',repository,ref,hierarchy},ownOrigin);},
      onAssemblyVariant({variant,config}){if(!disposed)parent.postMessage({type:'kicad-review:assembly-variant',repository,ref,file:requestedFile,rootFile,variant,config},ownOrigin);},
      onSelection(selection){if(crossApplying||!globalThis.KiCadPairedReview?.validSelection(selection))return;windowLink?.publish(selection);if(globalThis.KiCadVSCodeBridge?.selection)globalThis.KiCadVSCodeBridge.selection(selection);else parent.postMessage({type:'kicad-review:selection',selection},ownOrigin);},
      onCommentsChanged(){if(globalThis.KiCadVSCodeBridge?.onCommentsChanged)globalThis.KiCadVSCodeBridge.onCommentsChanged();else parent.postMessage({type:'kicad-review:comments-changed'},ownOrigin);},pullNumber:Number(params.get('pullNumber'))||null,pullRepository:params.get('pullRepository')||repository});

    workspace.attachCanvas(canvas);openSheet(initialFile);loading?.hide();
    if(!pcb){
      const gallery=document.createElement('section');gallery.id='sheetOverview';gallery.hidden=true;gallery.setAttribute('aria-label','All schematic sheets');host.append(gallery);
      const heading=document.createElement('header'),title=document.createElement('strong'),back=document.createElement('button'),unselect=document.createElement('button'),clear=document.createElement('button'),fitAll=document.createElement('button'),hierarchyToggle=document.createElement('button'),netLinksToggle=document.createElement('button'),help=document.createElement('small');
      title.textContent='All sheets';back.type=unselect.type=clear.type=fitAll.type=hierarchyToggle.type='button';back.textContent='Single sheet';unselect.textContent='Unselect';unselect.setAttribute('aria-label','Unselect');clear.textContent='Clear highlights';clear.setAttribute('aria-label','Clear highlights');fitAll.textContent='Fit';hierarchyToggle.textContent='Hierarchy links';hierarchyToggle.title='Show saved parent → child sheet placements';netLinksToggle.type='button';netLinksToggle.textContent='Net links';netLinksToggle.title='Show highlighted net relationships between pages';netLinksToggle.setAttribute('aria-pressed','true');hierarchyToggle.setAttribute('aria-pressed','true');unselect.onclick=()=>$('unselect').click();clear.onclick=()=>$('clearHighlights').click();heading.append(title,back,unselect,clear,fitAll,hierarchyToggle,netLinksToggle,help);gallery.append(heading);
      const stacks=document.createElement('details'),stackTitle=document.createElement('summary'),stackList=document.createElement('div');stacks.className='sheet-instance-stacks';stackTitle.textContent='Repeated sheets';stacks.append(stackTitle,stackList);const guide=document.createElement('details'),guideTitle=document.createElement('summary');guide.className='sheet-overview-guide';guideTitle.textContent='Guide';guide.append(guideTitle,help);heading.append(guide);heading.insertBefore(stacks,guide);
      const surface=document.createElement('div');surface.className='sheet-shared-canvas';gallery.append(surface);
      let overviewView=null,opened=false,ticket=0,composition=null,hierarchyGraph=null,overviewFitted=true;const frontInstances=new Map();
      hierarchyToggle.onclick=()=>{hierarchyToggle.setAttribute('aria-pressed',String(hierarchyToggle.getAttribute('aria-pressed')!=='true'));overviewView?.draw();};
      netLinksToggle.onclick=()=>{netLinksToggle.setAttribute('aria-pressed',String(netLinksToggle.getAttribute('aria-pressed')!=='true'));overviewView?.draw();};
      const clearOverviewSelection=()=>{if(overviewView){overviewView.selected=null;overviewView.draw();}};
      $('unselect').addEventListener('click',clearOverviewSelection);$('clearHighlights').addEventListener('click',clearOverviewSelection);
      const fitOverview=()=>{if(!overviewView||!composition)return;overviewFitted=true;overviewView.resize();overviewView.viewport.camera.bbox={x:-12,y:-4,w:composition.design.page.width+12,h:composition.design.page.height+4};overviewView.draw();};
      const miniature=document.createElement('section'),miniHeading=document.createElement('header'),miniTitle=document.createElement('strong'),miniMinimize=document.createElement('button'),miniMaximize=document.createElement('button'),miniClose=document.createElement('button'),miniBody=document.createElement('div'),miniShow=document.createElement('button');
      miniature.className='sheet-tree-miniature';miniature.setAttribute('aria-label','Sheet tree navigator');miniTitle.textContent='Sheet tree';miniMinimize.type=miniMaximize.type=miniClose.type=miniShow.type='button';miniMinimize.textContent='−';miniMinimize.setAttribute('aria-label','Minimize sheet tree');miniMinimize.setAttribute('aria-expanded','true');miniClose.textContent='×';miniClose.setAttribute('aria-label','Close sheet tree');miniBody.className='sheet-tree-miniature-body';miniHeading.append(miniTitle,miniMinimize,miniMaximize,miniClose);miniature.append(miniHeading,miniBody);host.append(miniature);
      const miniTools=document.createElement('footer'),miniZoomOut=document.createElement('button'),miniZoomIn=document.createElement('button'),miniFit=document.createElement('button'),miniScale=document.createElement('output');miniTools.className='sheet-tree-miniature-tools';
      for(const [button,text,label]of [[miniZoomOut,'−','Zoom sheet tree out'],[miniZoomIn,'+','Zoom sheet tree in'],[miniFit,'Fit','Fit sheet tree']]){button.type='button';button.textContent=text;button.setAttribute('aria-label',label);button.title=label;miniTools.append(button);}miniScale.setAttribute('aria-label','Sheet tree zoom');miniTools.append(miniScale);miniature.append(miniTools);
      let miniMaximized=false,miniPosition=null,miniFitBox=null,miniView=null,miniSVG=null,miniGeometry='',miniPan=null,miniMove=null,miniSuppressClick=false;
      const miniClamp=(value,min,max)=>Math.max(min,Math.min(Math.max(min,max),value));
      function positionMiniature(){if(miniMaximized&&!miniBody.hidden){miniature.style.left=miniature.style.top=miniature.style.bottom='';return;}if(!miniPosition)return;const area=host.getBoundingClientRect?.(),box=miniature.getBoundingClientRect?.();if(!area||!box)return;miniPosition.x=miniClamp(miniPosition.x,4,area.width-box.width-4);miniPosition.y=miniClamp(miniPosition.y,4,area.height-box.height-4);miniature.style.left=miniPosition.x+'px';miniature.style.top=miniPosition.y+'px';miniature.style.bottom='auto';}
      function syncMiniatureSize(){const expanded=!miniBody.hidden,maximized=miniMaximized&&expanded;miniature.classList.toggle('maximized',maximized);miniTools.hidden=!expanded;miniMinimize.textContent=expanded?'−':'+';miniMinimize.setAttribute('aria-expanded',String(expanded));miniMinimize.setAttribute('aria-label',expanded?'Minimize sheet tree':'Expand sheet tree');miniMaximize.textContent=maximized?'Restore':'Maximize';miniMaximize.setAttribute('aria-label',maximized?'Restore sheet tree size':'Maximize sheet tree');miniMaximize.title=maximized?'Restore small sheet tree':'Enlarge sheet tree to the drawing pane';miniMaximize.setAttribute('aria-pressed',String(maximized));miniMaximize.setAttribute('data-icon',maximized?'restore':'maximize');globalThis.KiCadUIIcons?.decorate?.(miniMaximize);positionMiniature();}
      function paintMiniView(){if(!miniSVG||!miniView)return;miniSVG.setAttribute('viewBox',`${miniView.x} ${miniView.y} ${miniView.w} ${miniView.h}`);miniScale.textContent=Math.round(miniFitBox.w/miniView.w*100)+'%';}
      function zoomMini(factor,point){if(!miniView||!miniFitBox)return;const scale=miniClamp(miniFitBox.w/miniView.w*factor,.5,12),w=miniFitBox.w/scale,h=miniFitBox.h/scale,at=point||{x:miniView.x+miniView.w/2,y:miniView.y+miniView.h/2};miniView={x:at.x-(at.x-miniView.x)/miniView.w*w,y:at.y-(at.y-miniView.y)/miniView.h*h,w,h};paintMiniView();}
      function miniPoint(event){const box=miniSVG?.getBoundingClientRect?.();if(!box||!miniView||!box.width||!box.height)return null;const scale=Math.min(box.width/miniView.w,box.height/miniView.h),left=box.left+(box.width-miniView.w*scale)/2,top=box.top+(box.height-miniView.h*scale)/2;return{x:miniView.x+(event.clientX-left)/scale,y:miniView.y+(event.clientY-top)/scale,scale};}
      miniZoomOut.onclick=()=>zoomMini(1/1.25);miniZoomIn.onclick=()=>zoomMini(1.25);miniFit.onclick=()=>{if(miniFitBox){miniView={...miniFitBox};paintMiniView();}};
      miniHeading.tabIndex=0;miniHeading.setAttribute('aria-label','Sheet tree position; drag or use arrow keys to move');miniHeading.title='Drag to move · focus this header and use arrow keys';
      miniHeading.addEventListener('pointerdown',event=>{if(miniMaximized||event.button>0||event.target?.closest?.('button'))return;const area=host.getBoundingClientRect?.(),box=miniature.getBoundingClientRect?.();if(!area||!box)return;miniMove={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left-area.left,top:box.top-area.top};miniHeading.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopPropagation();});
      miniHeading.addEventListener('pointermove',event=>{if(!miniMove||event.pointerId!==miniMove.id)return;miniPosition={x:miniMove.left+event.clientX-miniMove.x,y:miniMove.top+event.clientY-miniMove.y};positionMiniature();event.preventDefault();event.stopPropagation();});
      const endMiniMove=()=>{miniMove=null;};miniHeading.addEventListener('pointerup',endMiniMove);miniHeading.addEventListener('pointercancel',endMiniMove);
      miniHeading.addEventListener('keydown',event=>{if(event.target!==miniHeading||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||miniMaximized)return;const area=host.getBoundingClientRect?.(),box=miniature.getBoundingClientRect?.();if(!area||!box)return;const step=event.shiftKey?32:12;miniPosition={x:box.left-area.left+({'ArrowLeft':-step,'ArrowRight':step}[event.key]||0),y:box.top-area.top+({'ArrowUp':-step,'ArrowDown':step}[event.key]||0)};positionMiniature();event.preventDefault();event.stopPropagation();});
      miniMaximize.className='icon-only';miniMaximize.id='maximizeSheetTree';miniMaximize.onclick=()=>{miniMaximized=miniBody.hidden||!miniMaximized;miniBody.hidden=false;syncMiniatureSize();};
      miniMinimize.onclick=()=>{miniBody.hidden=!miniBody.hidden;syncMiniatureSize();};
      miniClose.onclick=()=>{miniature.hidden=true;};miniShow.id='showSheetTree';miniShow.textContent='Show sheet tree';miniShow.onclick=()=>{miniature.hidden=false;miniBody.hidden=false;syncMiniatureSize();$('viewerSettings').hidden=true;};$('viewerSettings')?.append(miniShow);syncMiniatureSize();
      const renderMiniature=()=>{
        const entries=(workspace.overviewSheets?.()||[]).filter(entry=>entry.sheet).map(entry=>({path:entry.sheet.path,label:entry.sheet.label||entry.sheet.path,placements:entry.placements||[],design:{page:{width:297,height:210},primitives:[]},groups:[]}));
        const mini=KiCadReviewWorkspace.composeSheetOverview(entries),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),width=mini.design.page.width,height=mini.design.page.height;
        const geometry=JSON.stringify(mini.pages.map(page=>[page.path,page.x,page.y,page.w,page.h]));miniFitBox={x:-12,y:-4,w:width+24,h:height+8};if(!miniView||geometry!==miniGeometry)miniView={...miniFitBox};miniGeometry=geometry;miniSVG=svg;miniPan=null;paintMiniView();svg.setAttribute('width','100%');svg.setAttribute('height',String(Math.max(100,Math.min(160,(height+8)/(width+24)*264))));svg.setAttribute('aria-label','All sheets, parents above children; drag to pan, wheel or plus/minus to zoom, Home to fit');svg.setAttribute('tabindex','0');
        svg.addEventListener('wheel',event=>{const point=miniPoint(event);event.preventDefault();event.stopPropagation();zoomMini(Math.exp(-Math.max(-200,Math.min(200,event.deltaY||0))*.003),point);},{passive:false});
        svg.addEventListener('pointerdown',event=>{if(event.button>0)return;const at=miniPoint(event);miniSuppressClick=false;if(!at)return;miniPan={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...miniView},scale:at.scale,moved:false};});
        svg.addEventListener('pointermove',event=>{if(!miniPan||event.pointerId!==miniPan.id)return;const dx=event.clientX-miniPan.x,dy=event.clientY-miniPan.y;if(!miniPan.moved&&Math.hypot(dx,dy)<4)return;miniPan.moved=true;miniSuppressClick=true;svg.setPointerCapture?.(event.pointerId);miniView={...miniPan.view,x:miniPan.view.x-dx/miniPan.scale,y:miniPan.view.y-dy/miniPan.scale};paintMiniView();event.preventDefault();event.stopPropagation();});
        const endPan=()=>{miniPan=null;};svg.addEventListener('pointerup',endPan);svg.addEventListener('pointercancel',endPan);
        svg.addEventListener('keydown',event=>{if(!['+','=','-','0','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();if(event.key==='Home'||event.key==='0')miniFit.onclick();else if(event.key==='+'||event.key==='=')zoomMini(1.25);else if(event.key==='-')zoomMini(1/1.25);else{miniView={...miniView,x:miniView.x+({'ArrowLeft':-.1,'ArrowRight':.1}[event.key]||0)*miniView.w,y:miniView.y+({'ArrowUp':-.1,'ArrowDown':.1}[event.key]||0)*miniView.h};paintMiniView();}});
        const graph=globalThis.KiCadSheetHierarchyLinks?.build(mini.pages,{headingGap:0});
        const defs=document.createElementNS('http://www.w3.org/2000/svg','defs'),arrow=document.createElementNS('http://www.w3.org/2000/svg','marker'),tip=document.createElementNS('http://www.w3.org/2000/svg','path');arrow.setAttribute('id','sheetTreeArrow');arrow.setAttribute('viewBox','0 0 6 6');arrow.setAttribute('refX','5');arrow.setAttribute('refY','3');arrow.setAttribute('markerWidth','5');arrow.setAttribute('markerHeight','5');arrow.setAttribute('orient','auto');tip.setAttribute('d','M 0 0 L 6 3 L 0 6 Z');tip.setAttribute('fill','#58a89f');arrow.append(tip);defs.append(arrow);svg.append(defs);
        for(const link of graph?.links||[]){const line=document.createElementNS('http://www.w3.org/2000/svg','path'),points=link.points||[link.from,{x:link.from.x,y:(link.from.y+link.to.y)/2},{x:link.to.x,y:(link.from.y+link.to.y)/2},link.to];line.setAttribute('d',globalThis.KiCadSheetHierarchyLinks?.pathData?.(points)||points.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' '));line.setAttribute('class','sheet-tree-miniature-link');line.setAttribute('marker-end','url(#sheetTreeArrow)');svg.append(line);}
        for(const page of mini.pages){
          const node=document.createElementNS('http://www.w3.org/2000/svg','g'),rect=document.createElementNS('http://www.w3.org/2000/svg','rect'),label=document.createElementNS('http://www.w3.org/2000/svg','text'),tooltip=document.createElementNS('http://www.w3.org/2000/svg','title'),selection=workspace.overviewSelection?.(page.path);
          node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',`Go to ${page.label}`);node.setAttribute('class','sheet-tree-miniature-node'+(selection?.netIds?.length?' highlighted':'')+(page.path===currentFile()?' current':''));rect.setAttribute('x',page.x);rect.setAttribute('y',page.y);rect.setAttribute('width',page.w);rect.setAttribute('height',page.h);rect.setAttribute('rx','15');label.setAttribute('x',page.x+page.w/2);label.setAttribute('y',page.y+page.h/2);label.textContent=page.label.length>12?page.label.slice(0,9)+'…':page.label;tooltip.textContent=page.path;
          const navigate=()=>{const target=opened&&composition?.pages.find(p=>p.path===page.path);if(target&&overviewView){overviewFitted=false;overviewView.viewport.camera.bbox={x:target.x-12,y:target.y-14,w:target.w+24,h:target.h+28};overviewView.draw();}else{if(opened)close();workspace.followSheet?.(page.path);}};
          node.onclick=()=>{if(miniSuppressClick){miniSuppressClick=false;return;}navigate();};node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();navigate();}});node.append(rect,label,tooltip);svg.append(node);
        }
        miniBody.replaceChildren();miniBody.append(svg);
      };
      renderMiniature();
      const rebuild=async()=>{
        const generation=++ticket,allEntries=workspace.overviewSheets(),entries=allEntries.filter(entry=>entry.sheet);
        const active=entries.some(entry=>workspace.overviewSelection(entry.sheet.path).netActive);
        const limits=entries.flatMap(e=>workspace.overviewSelection(e.sheet.path).limits||[]);
        help.textContent=(active?'Connected sheets only · ':'')+'Pan and zoom · select a net · double-click/tap a sheet to enter'+(entries.some(e=>e.instanceCount>1)?' · Choose a placement in Repeated sheets.':'')+(entries.some(e=>e.instanceTruncated)?' · Instance counts capped at 4,096 placements.':'')+(limits.length?' · '+[...new Set(limits)].join(' '):'');
        const shown=active?entries.filter(entry=>workspace.overviewSelection(entry.sheet.path).netIds.length):entries,rendered=[];
        const repeated=shown.filter(entry=>entry.instanceCount>1);stacks.hidden=!repeated.length;stackList.replaceChildren();
        for(const entry of repeated){const group=document.createElement('section'),name=document.createElement('strong');name.textContent=`${entry.sheet.path} · ${entry.instanceCount} instances`;group.append(name);const selection=workspace.overviewSelection(entry.sheet.path),placements=(entry.placements||[]).filter(p=>!active||!selection.instanceIds?.length||selection.instanceIds.includes(p.id));for(const placement of placements.slice(0,256)){const choice=document.createElement('button');choice.type='button';choice.textContent=placement.label;choice.setAttribute('aria-pressed',String((frontInstances.get(entry.sheet.path)||placements[0]?.id)===placement.id));choice.onclick=()=>{frontInstances.set(entry.sheet.path,placement.id);rebuild();};group.append(choice);}if(placements.length>256){const note=document.createElement('p');note.textContent='First 256 placements shown.';group.append(note);}stackList.append(group);}
        for(const entry of shown){
          await new Promise(resolve=>setTimeout(resolve,0));if(!opened||generation!==ticket)return;
          const path=entry.sheet.path,design=buildSheet(path),nets=KiCadNetModel.build([files.find(file=>file.path===path)],new Map([[path,design]])).nets,selection=workspace.overviewSelection(path);
          const placements=(entry.placements||[]).filter(p=>!active||!selection.instanceIds?.length||selection.instanceIds.includes(p.id));
          const front=placements.find(p=>p.id===frontInstances.get(path))||placements[0];if(front)frontInstances.set(path,front.id);
          rendered.push({path,label:entry.instanceCount>1?path:(entry.sheet.label||path),instanceCount:placements.length||entry.instanceCount,totalInstanceCount:entry.instanceCount,instances:placements.map(p=>p.label),placements:front?[front,...placements.filter(p=>p!==front)]:placements,instanceId:front?.id,instanceLabel:entry.instanceCount>1?front?.label:null,design,groups:KiCadReviewWorkspace.sheetPageHighlights(nets,workspace.overviewSelection(path,front?.id),design,path)});
        }
        if(!opened||generation!==ticket)return;
        composition=KiCadReviewWorkspace.composeSheetOverview(rendered,workspace.overviewNetLinks?.()||[],dark);
        hierarchyGraph=globalThis.KiCadSheetHierarchyLinks?.build(composition.pages)||null;
        renderMiniature();
        const missingTargets=allEntries.filter(entry=>entry.unavailable).length;
        help.textContent+=(hierarchyGraph?' · Teal arrows: saved parent → child sheets.':' · Hierarchy links unavailable.')+' Gold dashed links: highlighted nets, routed outside pages.'+
          (hierarchyGraph&&!hierarchyGraph.links.length&&shown.length>1?' No resolved parent → child link among shown sheets.':'')+
          (missingTargets?` · ${missingTargets} unloaded child target${missingTargets===1?'':'s'} omitted.`:'')+
          (hierarchyGraph?.unresolved?` · ${hierarchyGraph.unresolved} unresolved placement${hierarchyGraph.unresolved===1?'':'s'} omitted.`:'')+
          (hierarchyGraph?.omitted?` · ${hierarchyGraph.omitted} hierarchy links omitted by routing/display limits.`:'')+(composition.routing?.omitted?` · ${composition.routing.omitted} net links omitted by routing limits.`:'');
        if(!overviewView){
          overviewView=KiCadOwnedCanvas.mount(surface,{dark,pcb:false,acceleration:'off',showTerminalNumbers:canvas.showTerminalNumbers});overviewView.canvas.addEventListener('wheel',()=>{overviewFitted=false;},{passive:true});overviewView.canvas.addEventListener('pointerdown',event=>{if(event.button===1||event.button===2)overviewFitted=false;});
          const baseDraw=overviewView.draw.bind(overviewView);overviewView.draw=()=>{
            baseDraw();if(!composition)return;const ctx=overviewView.ctx;if(!ctx)return;
            ctx.save();ctx.setLineDash([6,4]);if(netLinksToggle.getAttribute('aria-pressed')==='true'){if(globalThis.KiCadSheetHierarchyLinks)KiCadSheetHierarchyLinks.draw(overviewView,{links:composition.airwires},dark,{color:dark?'#d4b565a0':'#9e7b29a0',dashed:true});else for(const wire of composition.airwires)overviewView.paint(wire);}ctx.restore();
            if(hierarchyToggle.getAttribute('aria-pressed')==='true')globalThis.KiCadSheetHierarchyLinks?.draw(overviewView,hierarchyGraph,dark);
          };
          overviewView.addEventListener('kicad:select',()=>{const hit=overviewView.selected;if(hit?.sourcePath&&hit.uuid){if($('selectionMode').value==='net'||!workspace.selectOverviewObject?.(hit.sourcePath,hit.uuid))workspace.selectOverviewNet?.(hit.sourcePath,hit.uuid,hit.sourceInstanceId);}});
          overviewView.canvas.addEventListener('dblclick',event=>{
            const rect=overviewView.canvas.getBoundingClientRect(),at=overviewView.viewport.camera.screen_to_world({x:event.clientX-rect.left,y:event.clientY-rect.top});
            const page=composition.pages.find(p=>at.x>=p.x&&at.x<=p.x+p.w&&at.y>=p.y&&at.y<=p.y+p.h);if(page){close();workspace.followSheet(page.path);}
          });
        }
        overviewView.dark=dark;overviewView.showTerminalNumbers=canvas.showTerminalNumbers;overviewView.setDocument(composition.design,'all-sheets');overviewView.paperVisible=false;
        overviewView.setNetHighlights(composition.highlighted.length?[{primitives:composition.highlighted}]:[],{mode:'bright'});fitOverview();
      };
      const close=()=>{if(!opened)return;opened=false;ticket++;gallery.hidden=true;canvas.canvas.hidden=false;overviewView?.dispose();overviewView=null;composition=null;hierarchyGraph=null;toggle.setAttribute('aria-pressed','false');canvas.resize();canvas.draw();};
      const open=()=>{if(opened)return;opened=true;gallery.hidden=false;canvas.canvas.hidden=true;toggle.setAttribute('aria-pressed','true');return rebuild();};
      const toggle=document.createElement('button');toggle.id='allSheetPagesButton';toggle.type='button';toggle.textContent='All sheets';toggle.title='See every loaded schematic page on one canvas';toggle.setAttribute('aria-pressed','false');toggle.onclick=()=>opened?close():open();
      ($('sheetHome')?.parentElement||$('frameControls')).append(toggle);back.onclick=close;fitAll.onclick=fitOverview;
      const resizeOverview=()=>{positionMiniature();if(opened&&overviewFitted)requestAnimationFrame(()=>{if(opened&&overviewFitted)fitOverview();});};globalThis.addEventListener?.('resize',resizeOverview);
      const miniResize=typeof ResizeObserver==='function'?new ResizeObserver(()=>positionMiniature()):null;miniResize?.observe(host);
      sheetOverview={setTheme(value){if(overviewView){overviewView.dark=Boolean(value);overviewView.draw();}},setTerminalNumbers(visible){if(overviewView){overviewView.showTerminalNumbers=Boolean(visible);overviewView.draw();}},open,close,isOpen:()=>opened,toggle:()=>opened?close():open(),refreshTree:renderMiniature,refresh(){renderMiniature();if(opened)return rebuild();},dispose(){miniResize?.disconnect();globalThis.removeEventListener?.('resize',resizeOverview);close();$('unselect').removeEventListener('click',clearOverviewSelection);$('clearHighlights').removeEventListener('click',clearOverviewSelection);gallery.remove();toggle.remove();miniature.remove();miniShow.remove();}};globalThis.KiCadSheetOverview=sheetOverview;
    addEventListener('keydown',event=>{if(event.key==='Escape'&&opened){event.preventDefault();close();}});
    }

    $('frameControls').hidden=false;label('fitDrawing',pcb?'Fit board':'Fit drawing');

    const fit=kind=>{if(scene){scene.fit?.(kind==='page');return;}kind==='page'?canvas.zoom_to_page():canvas.zoom_to_board();canvas.draw();};

    const zoom=factor=>{if(scene){scene.zoom?.(factor);return;}const c=canvas.viewport.camera;c.zoom=Math.max(.001,Math.min(10000,c.zoom*factor));canvas.draw();};

    $('fitDrawing').onclick=()=>fit('drawing');$('fitPage').onclick=()=>fit('page');$('zoomIn').onclick=()=>zoom(1.25);$('zoomOut').onclick=()=>zoom(1/1.25);

    $('themeButton').title='Toggle interface and drawing theme; T toggles the drawing only';$('themeButton').setAttribute('aria-pressed',String(dark));

    const savePreferences=()=>chrome.storage?.local?.set({[preferenceKey]:preferences}).catch(error=>{$('pageSetupStatus').textContent=error.message;});

    const terminalNumberButton=document.createElement('button');terminalNumberButton.id='terminalNumbersButton';terminalNumberButton.type='button';terminalNumberButton.className='icon-only';terminalNumberButton.setAttribute('data-icon','pin');terminalNumberButton.setAttribute('aria-label','Pin / pad numbers');terminalNumberButton.textContent='Numbers';terminalNumberButton.title=pcb?'Toggle pad numbers / BGA ball identifiers; 3D labels are annotations visible through component bodies. Zoom in for readable labels.':'Toggle saved visible schematic pin numbers';$('frameControls').append(terminalNumberButton);globalThis.KiCadUIIcons?.decorate?.(terminalNumberButton);
    const toggleNumbers=()=>{preferences.showTerminalNumbers=canvas.showTerminalNumbers===false;applyTheme();savePreferences();};terminalNumberButton.onclick=toggleNumbers;
    $('showTerminalNumbers').onchange=()=>{preferences.showTerminalNumbers=$('showTerminalNumbers').checked;applyTheme();savePreferences();};
    $('netNamesSetting').hidden=!pcb;$('showNetNames').onchange=()=>{preferences.showNetNames=$('showNetNames').checked;applyTheme();savePreferences();};
    let lastThemeNotice=null;
    function publishThemeState(){const state={uiTheme:preferences.uiTheme,drawingTheme:preferences.drawingTheme},signature=JSON.stringify(state);if(signature===lastThemeNotice)return;lastThemeNotice=signature;if(parent!==globalThis)parent.postMessage({type:'kicad-review:theme',repository,ref,file:requestedFile,...state},ownOrigin);}
    const applyTheme=()=>{canvas.showTerminalNumbers=preferences.showTerminalNumbers!==false;$('showTerminalNumbers').checked=canvas.showTerminalNumbers;terminalNumberButton.setAttribute('aria-pressed',String(canvas.showTerminalNumbers));canvas.showNetNames=preferences.showNetNames===true;$('showNetNames').checked=canvas.showNetNames;dark=preferences.drawingTheme==='dark';canvas.dark=dark;canvas.acceleration=preferences.acceleration==='off'?'off':'auto';scene?.setTheme(dark);if(probeMaster&&probeMaster!==scene)probeMaster.setTheme?.(dark);sheetOverview?.setTheme?.(dark);scene?.setTerminalLabels?.(canvas.showNetNames);scene?.setTerminalNumbers?.(canvas.showTerminalNumbers);sheetOverview?.setTerminalNumbers?.(canvas.showTerminalNumbers);workspace?.syncTerminalVisibility?.();document.body.dataset.uiTheme=preferences.uiTheme;document.body.dataset.drawingTheme=preferences.drawingTheme;$('uiTheme').value=preferences.uiTheme;$('drawingTheme').value=preferences.drawingTheme;$('rulerUnits').value=preferences.rulerUnits;if($('acceleration'))$('acceleration').value=canvas.acceleration;$('themeButton').setAttribute('aria-pressed',String(dark));if($('displayPreset'))$('displayPreset').value=preferences.uiTheme==='light'&&preferences.drawingTheme===(pcb?'dark':'light')?'kicad':preferences.uiTheme===preferences.drawingTheme?preferences.uiTheme:'custom';if(!scene)canvas.draw();publishThemeState();};

    $('themeButton').onclick=()=>{preferences.uiTheme=preferences.drawingTheme=dark?'light':'dark';applyTheme();savePreferences();windowLink?.publishTheme?.(preferences.drawingTheme);};

    for(const [id,key] of [['uiTheme','uiTheme'],['drawingTheme','drawingTheme'],['rulerUnits','rulerUnits']])$(id).onchange=()=>{preferences[key]=$(id).value;applyTheme();savePreferences();};applyTheme();
    if($('acceleration'))$('acceleration').onchange=()=>{preferences.acceleration=$('acceleration').value;applyTheme();savePreferences();};

    if($('displayPreset'))$('displayPreset').onchange=()=>{const preset=$('displayPreset').value;if(preset==='custom')return;preferences.uiTheme=preset==='dark'?'dark':'light';preferences.drawingTheme=preset==='kicad'?(pcb?'dark':'light'):preset;applyTheme();savePreferences();};

    const savedPages=new Map();

    function populatePage(){const page=canvas.design.page,title=page.titleBlock||{};for(const id of ['pageWidth','pageHeight'])$(id).disabled=Boolean(KiCadReviewTools.papers[page.format]);$('pageFormat').value=KiCadReviewTools.papers[page.format]?page.format:'User';$('pageWidth').value=page.width;$('pageHeight').value=page.height;$('pagePortrait').checked=page.height>page.width;for(const key of ['Title','Company','Date','Rev'])$('page'+key).value=title[key.toLowerCase()]||'';for(let i=0;i<9;i++)$('pageComment'+i).value=title.comments?.[i]||'';$('pageSetupStatus').textContent='Display settings for '+currentFile();}

    const closeSettings=()=>{$('viewerSettings').hidden=true;$('settingsButton').setAttribute('aria-expanded','false');$('settingsButton').focus?.();};$('settingsButton').setAttribute('aria-controls','viewerSettings');$('settingsButton').setAttribute('aria-expanded','false');$('settingsButton').onclick=()=>{if(!$('viewerSettings').hidden){closeSettings();return;}populatePage();$('viewerSettings').hidden=false;$('settingsButton').setAttribute('aria-expanded','true');$('displayPreset')?.focus?.();};$('closeSettings').onclick=closeSettings;

    $('pageFormat').onchange=()=>{const size=KiCadReviewTools.papers[$('pageFormat').value];if(size){$('pageWidth').value=size[0];$('pageHeight').value=size[1];}for(const id of ['pageWidth','pageHeight'])$(id).disabled=Boolean(size);};

    const replacePage=page=>{const design=canvas.design;design.page=page;design.primitives=[...design.primitives.filter(p=>!p.frame),...KiCadWorksheet.build(page,currentFile(),{sheetNumber:files.findIndex(f=>f.path===currentFile())+1,sheetCount:files.length})];canvas.primitives=design.primitives;canvas.zoom_to_page();canvas.draw();};

    $('applyPage').onclick=()=>{try{const page=KiCadReviewTools.page({format:$('pageFormat').value,width:$('pageWidth').value,height:$('pageHeight').value,portrait:$('pagePortrait').checked,title:$('pageTitle').value,company:$('pageCompany').value,date:$('pageDate').value,rev:$('pageRev').value,comments:Array.from({length:9},(_,i)=>$('pageComment'+i).value)});if(!savedPages.has(currentFile()))savedPages.set(currentFile(),canvas.design.page);replacePage(page);$('pageSetupStatus').textContent='Review page applied; the source file is unchanged.';}catch(error){$('pageSetupStatus').textContent=error.message;}};

    $('resetPage').onclick=()=>{const saved=savedPages.get(currentFile());if(saved){replacePage(saved);savedPages.delete(currentFile());}populatePage();};

    $('gridButton').onclick=()=>{canvas.grid=!canvas.grid;$('gridButton').setAttribute('aria-pressed',String(canvas.grid));canvas.draw();};

    $('flipButton').hidden=false;$('flipButton').title=pcb?'Flip board (F)':'Flip view (F)';$('flipButton').setAttribute('aria-label',pcb?'Flip board':'Flip view');$('flipButton').onclick=()=>{canvas.viewport.camera.flipped=!canvas.viewport.camera.flipped;$('flipButton').setAttribute('aria-pressed',String(canvas.viewport.camera.flipped));canvas.draw();};

    if(pcb){

      modelAssetCache=KiCadBrowserData.createModelAssetCache(async path=>{const result=await send({type:'repo-asset',repository,ref,file:path});if(!result?.ok)throw new Error(result?.error||'Repository model unavailable.');return result.result;});

      const mode=$('mode3d'),pane=$('threePane');mode.hidden=false;let busy=false,loading=null;
      let modelIndex=null,assetWarnings=[];
      const safeModelPath=path=>typeof path==='string'&&path.length<=500&&/\.(?:wrl|vrml|glb|step|stp)$/i.test(path)&&!/[\\:\x00-\x1f\x7f?#%]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');
      const assetPaths=()=>modelIndex||=send({type:'repo-model-index',repository,ref,file:rootFile}).then(result=>{
        if(!result?.ok||!Array.isArray(result.result?.paths)){assetWarnings.splice(0,assetWarnings.length,'Project model inventory is unavailable; explicit relative model paths can still be loaded.');return [];}
        assetWarnings.splice(0,assetWarnings.length,...(Array.isArray(result.result.warnings)?result.result.warnings.filter(w=>typeof w==='string').slice(0,48).map(w=>w.slice(0,500)):[]));
        if(result.result.paths.length>2000)assetWarnings.push('Model inventory was limited to 2000 paths.');
        return result.result.paths.slice(0,2000).filter(safeModelPath);
      }).catch(()=>{assetWarnings.splice(0,assetWarnings.length,'Project model inventory could not be read; explicit relative model paths can still be loaded.');return [];});

      const load=()=>loading||=new Promise((resolve,reject)=>{if(globalThis.SpikeBoard3D?.mountBoard3D){resolve(SpikeBoard3D);return;}const script=document.createElement('script');script.src='vendor/spike-board3d.bundle.js';script.onload=()=>globalThis.SpikeBoard3D?.mountBoard3D?resolve(SpikeBoard3D):reject(new Error('SPIKE 3D did not initialize.'));script.onerror=()=>{loading=null;reject(new Error('SPIKE 3D could not be loaded.'));};document.head.append(script);});

      const lock=value=>{for(const id of ['gridButton','flipButton','applyPage','resetPage'])$(id).disabled=value;};

      mode.onclick=async()=>{

        if(busy)return;if(scene){probeMaster=scene;probeMasterPath=rootFile;scene=null;pane.hidden=true;canvas.canvas.hidden=false;workspace.setScene(null);$('drawingLegend').hidden=false;lock(false);mode.setAttribute('aria-pressed','false');if($('renderMode'))$('renderMode').textContent='2D';canvas.resize();canvas.draw();return;}

        busy=true;mode.disabled=true;

        try{const engine=await load(),modelPaths=assetPaths();if(disposed)return;pane.hidden=false;canvas.canvas.hidden=true;

          if(probeMasterLoading)throw Error('Wait for the 3D probe to finish loading.');
          if(probeMaster&&probeMasterPath===rootFile){scene=probeMaster;probeMaster=null;if(probeMasterHost){Object.assign(probeMasterHost.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%',visibility:'visible'});pane.append(probeMasterHost);}}
          else scene=engine.mountBoard3D(pane,files.find(file=>file.path===rootFile).content,{dark,showNetNames:canvas.showNetNames,showTerminalNumbers:canvas.showTerminalNumbers,onTerminalNumbersChange:visible=>{preferences.showTerminalNumbers=visible;applyTheme();savePreferences();},onTerminalLabelsChange:visible=>{preferences.showNetNames=visible;applyTheme();savePreferences();},boardPath:rootFile,assetPathsPromise:modelPaths,assetWarnings,loadAsset:modelAssetCache.load,externalInspector:true,onViewChange:()=>workspace?.sceneViewChanged(),onAnchor:({point})=>workspace?.positionSimulation(point),onMeasurementMode:active=>{$("measureButton").setAttribute("aria-pressed",String(active));$("measurementStatus").textContent=active?"3D measurement: select two model surface points.":"";},onSelect:(record,gesture)=>workspace?.select3D(record,gesture),onInspect:record=>workspace?.inspect3D(record),onComment:record=>workspace?.comment3D(record)});

          workspace.setScene(scene);syncFloatingLayers();$('drawingLegend').hidden=true;lock(true);mode.setAttribute('aria-pressed','true');if($('renderMode'))$('renderMode').textContent='3D';

        }catch(error){scene?.dispose();scene=null;pane.hidden=true;canvas.canvas.hidden=false;workspace.setScene(null);syncFloatingLayers();$('engineNotice').textContent=error.message;$('engineNotice').hidden=false;updateDiagnostics();}

        finally{busy=false;mode.disabled=false;}

      };

    }

    const related=selection=>{if(!globalThis.KiCadPairedReview?.validSelection(selection))return;crossApplying=true;try{workspace.highlightRelated?.(selection);}finally{crossApplying=false;}};
    if(globalThis.KiCadWindowLink&&viewSession&&(/^[a-f0-9]{40}$/i.test(ref)||globalThis.KiCadLocalRuntime&&globalThis.KiCadLocalWorkspace?.openDetached))try{windowLink=KiCadWindowLink.mount({session:viewSession,scope:JSON.stringify([provider,providerContext.host||'https://github.com',repository,ref]),onTheme:theme=>{preferences.uiTheme=preferences.drawingTheme=theme;applyTheme();savePreferences();},onSelection:selection=>{crossApplying=true;try{workspace.applyWindowSelection?.(selection);}finally{crossApplying=false;}},onEnabled:enabled=>{dispatchEvent(new CustomEvent('kicad-review:detach-state',{detail:{enabled}}));if(parent!==window)parent.postMessage({type:'kicad-review:detach-state',enabled},ownOrigin);}});}catch(error){$('engineNotice').textContent=error.message;$('engineNotice').hidden=false;updateDiagnostics();}
    addEventListener('kicad-review:detach-sync',event=>{if(typeof event.detail?.enabled==='boolean')windowLink?.setEnabled(event.detail.enabled);});
    addEventListener('kicad-review:detach-view',event=>{const mode=event.detail?.mode;if(!['schematic','layout','3d'].includes(mode))return;globalThis.KiCadDetachedView?.chooser({mode,current:currentFile(),unavailable:Boolean(globalThis.KiCadVSCodeContext||globalThis.KiCadLocalRuntime&&!globalThis.KiCadLocalWorkspace?.openDetached||globalThis.KiCadAndroidRuntime),getEntries:async()=>{const reply=await send({type:'project-inventory',repository,ref,file:rootFile});if(!reply?.ok)throw Error(reply?.error||'Project inventory unavailable.');return reply.result.files;},buildURL:file=>KiCadDetachedView.url({base:location.href,mode,file,repository,ref,provider,host:providerContext.host,session:viewSession,allowLocal:Boolean(globalThis.KiCadLocalRuntime&&globalThis.KiCadLocalWorkspace?.openDetached)}),onError:message=>{$('engineNotice').textContent=message;$('engineNotice').hidden=false;updateDiagnostics();}});});
    if(params.get('initialView')==='3d'&&pcb)$('mode3d').click();
    addEventListener('kicad-review:related',event=>{if(globalThis.KiCadVSCodeContext)related(event.detail);});
    addEventListener('kicad-review:comments-refresh',()=>{if(globalThis.KiCadVSCodeContext)workspace.refreshComments?.();});
    addEventListener('message',event=>{

      if(event.source!==parent||event.origin!==ownOrigin||event.data?.type!=='kicad-review:command')return;

      const msg=event.data;
      if(msg.command==='set-theme'){
        const uiTheme=msg.uiTheme??msg.theme,drawingTheme=msg.drawingTheme??msg.theme;if(!['light','dark'].includes(uiTheme)||!['light','dark'].includes(drawingTheme))return;
        preferences.uiTheme=uiTheme;preferences.drawingTheme=drawingTheme;applyTheme();savePreferences();if(uiTheme===drawingTheme)windowLink?.publishTheme?.(drawingTheme);return;
      }
      if(msg.command==='assembly-variant'){if(msg.repository!==repository||msg.ref!==ref||msg.file!==requestedFile)return;try{workspace.applyAssemblyVariant?.({variant:msg.variant,config:msg.config});}catch(error){label('reviewNotice',error.message);$('reviewNotice').hidden=false;}return;}
      if(msg.command==='search-result'){const value=msg.result;if(value&&(value.kind==='command'&&value.action==='sheet-tree'||globalThis.KiCadWorkspaceSearch?.safePath(value.path))&&(['object','file','report','draft'].includes(value.kind)||value.kind==='command'&&value.action==='sheet-tree'))workspace.openWorkspaceSearchResult?.(value).catch(error=>{label('reviewNotice',error.message);$('reviewNotice').hidden=false;});return;}
      if(msg.command==='detach-sync'&&typeof msg.enabled==='boolean'){windowLink?.setEnabled(msg.enabled);return;}
      if(msg.command==='workspace-view'){
        if(!['schematic','layout','3d','draftsman','simulation','bom'].includes(msg.mode))return;
        if(msg.mode==='3d'){if(pcb&&!scene)$('mode3d').click();return;}
        if(scene)$('mode3d').click();
        if(msg.mode==='draftsman')$('openDraftsman')?.click();
        if(msg.mode==='bom')$('openBomManager')?.click();
        if(msg.mode==='simulation'){if(globalThis.KiCadWorkspaceChrome)dispatchEvent(new Event('kicad-review:simulation-view'));else $('openSavedReports')?.click();}
        return;
      }
      if(msg.command==='restore-controls'){workspace.restoreFocusView?.();return;}
      if(msg.command==='open-sheet'){workspace.followSheet?.(msg.file);return;}
      if(msg.command==='refresh-comments'){workspace.refreshComments?.();return;}
      if(msg.command==='highlight-related'){related(msg.selection);return;}
      if(msg.command==='comparison-highlight'){if(msg.file===currentFile()&&Array.isArray(msg.uuids)&&msg.uuids.length<=200&&msg.uuids.every(v=>typeof v==='string'&&v.length<=128)&&(!msg.focusUuid||typeof msg.focusUuid==='string'&&msg.focusUuid.length<=128))workspace.highlightComparison?.(msg.file,msg.uuids,msg.focusUuid);return;}
      if(msg.command==='fit-drawing'&&scene){scene.fit?.();return;}
      if(scene)return;

      if(msg.command==='fit-drawing')fit('drawing');else if(msg.command==='fit-page')fit('page');else if(msg.command==='focus')focus(msg.position);else if(msg.command==='report-view')report(true);

      else if(msg.command==='set-view'&&msg.file===currentFile()){applying=true;try{if(KiCadViewState.apply(canvas.viewport.camera,msg.view))canvas.draw();}finally{applying=false;}}

    });

    addEventListener('keydown',event=>{

      if(event.defaultPrevented||event.repeat||event.isComposing||event.composedPath().some(node=>node?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName||''))||event.ctrlKey||event.altKey||event.metaKey)return;
      if(scene){if(event.key.toLowerCase()==='f'||event.key==='Home'){event.preventDefault();scene.fit?.(event.key==='Home');}else if(['+','='].includes(event.key)){event.preventDefault();scene.zoom?.(1.25);}else if(['-','_'].includes(event.key)){event.preventDefault();scene.zoom?.(.8);}return;}

      if(event.key==='Escape'&&!$('viewerSettings').hidden){event.preventDefault();closeSettings();return;}
      if(event.key==='Escape'&&canvas.focusedLayer){canvas.restoreLayers();layers();canvas.draw();}else if(['[',']'].includes(event.key)&&pcb){const choices=canvas.design.layers||[],index=choices.indexOf(canvas.focusedLayer||canvas.activeLayer);if(choices.length){event.preventDefault();canvas.focusLayer(choices[(index+(event.key===']'?1:-1)+choices.length)%choices.length],$('layerFocusMode').value||'dim');layers();canvas.draw();}}else if(event.shiftKey&&event.key.toLowerCase()==='f'&&canvas.focusedLayer){event.preventDefault();$('fitLayer').click();}else if(['+','='].includes(event.key)){event.preventDefault();zoom(1.25);}else if(['-','_'].includes(event.key)){event.preventDefault();zoom(1/1.25);}else if(event.key.toLowerCase()==='f'){event.preventDefault();fit('drawing');}else if(event.key==='Home'){event.preventDefault();fit('page');}else if(event.key.toLowerCase()==='t'){event.preventDefault();preferences.drawingTheme=dark?'light':'dark';applyTheme();savePreferences();}

    });

    if(params.get('focusNet'))workspace?.focusSignalNet(params.get('focusNet'));
    if(params.get('focusUuid'))workspace?.focusSaved(requestedFile,params.get('focusUuid'));
    if(params.get('view')==='3d'&&pcb&&!$('mode3d').disabled)$('mode3d').click();
    addEventListener('kicad-review:search-result',event=>{if(globalThis.KiCadVSCodeContext&&event.detail)workspace.openWorkspaceSearchResult?.(event.detail).catch(error=>{label('reviewNotice',error.message);$('reviewNotice').hidden=false;});});
    globalThis.KiCadVSCodeBridge?.workspaceReady?.();
    parent.postMessage({type:'kicad-review:comparison-ready',file:currentFile(),ref},ownOrigin);
    if(params.has('focusX')&&params.has('focusY'))focus({x:Number(params.get('focusX')),y:Number(params.get('focusY'))});

  }

  addEventListener('pagehide',()=>{windowLink?.dispose();disposed=true;loadController?.abort();loading?.dispose();modelAssetCache?.clear();sheetOverview?.dispose();compatibilityUI?.dispose();workspace?.dispose();probeMaster?.dispose();probeMasterHost?.remove();probeAssets?.clear();scene?.dispose();canvas?.dispose();});

  const deadline=setTimeout(()=>stopLoading('Loading stopped after 5 minutes. Retry or open a smaller project.'),300000);
  start().catch(error=>{loading?.hide();if(disposed)return;workspace?.dispose();canvas?.dispose();$('frameControls').hidden=true;status.textContent=loadController?.signal.aborted?(loadController.signal.reason?.message||'Loading stopped.'):error.message;if(error.name!=='AbortError')status.classList.add('error');const retry=document.createElement('button');retry.type='button';retry.textContent='Retry loading';retry.onclick=()=>location.reload();status.append(retry);if(!status.isConnected)$('drawingHost').append(status);}).finally(()=>{loadFinished=true;clearTimeout(deadline);});

})();
