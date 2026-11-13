"use strict";
(() => {
  const params = new URLSearchParams(location.search);
  const viewSession=/^[a-zA-Z0-9_-]{32,128}$/.test(params.get('viewSession')||'')?params.get('viewSession'):globalThis.crypto?.randomUUID?.()||null;
  if(/\.pdf$/i.test(params.get('file')||'')){const removed=params.get('status')==='removed';params.set('ref',params.get('ref')||(removed?params.get('base'):params.get('head'))||'');if(!removed&&params.get('headRepository'))params.set('repository',params.get('headRepository'));location.replace(chrome.runtime.getURL('pdf-viewer.html')+'?'+params);return;}
  const request = {
    repository: params.get("repository"), headRepository: params.get("headRepository") || params.get("repository"),
    file: params.get("file"), oldFile: params.get("oldFile") || params.get("file"),
    head: params.get("head") || params.get("ref"), base: params.get("base"), status: params.get("status") || "modified", pullNumber: Number(params.get("pullNumber")) || null, pullRepository: params.get("pullRepository") || params.get("repository")
  };
  const provider=params.get('provider')||'github',providerContext=provider==='gitlab'?{provider,host:params.get('host')||'https://gitlab.com'}:{};if(!['github','gitlab'].includes(provider))throw new Error('Unsupported Git host.');request.provider=provider;request.host=providerContext.host;
  const send=message=>chrome.runtime.sendMessage({...message,...providerContext}).then(reply=>{if(reply?.accessIssue)globalThis.KiCadStartupHealth?.showAccessIssue(reply.accessIssue);return reply;});
  const data = globalThis.KiCadBrowserData;
  const $ = (id) => document.getElementById(id);
  const toolbar = $("toolbar"), comparison = $("comparison");
  const frames = new Map(), views = new Map();
  let workspaceTheme=null,themeControl=null;
  function applyWorkspaceTheme(value,broadcast=true){
    if(!value||!['light','dark'].includes(value.uiTheme)||!['light','dark'].includes(value.drawingTheme))return;
    workspaceTheme={uiTheme:value.uiTheme,drawingTheme:value.drawingTheme};if(document.body?.dataset){document.body.dataset.uiTheme=value.uiTheme;document.body.dataset.drawingTheme=value.drawingTheme;}
    $('historyWorkspace')?.querySelector?.('.history-workspace-dialog')?.setAttribute('data-theme',value.uiTheme);themeControl?.setAttribute('aria-pressed',String(value.drawingTheme==='dark'));
    try{globalThis.localStorage?.setItem('kicad:workspace-theme:v1',JSON.stringify(workspaceTheme));}catch{}
    if(broadcast)for(const [side,frame]of frames)frame.contentWindow?.postMessage({type:'kicad-review:command',command:'set-theme',theme:value.drawingTheme,...workspaceTheme,syncDetached:side==='head'},origin());
  }
  try{const saved=JSON.parse(globalThis.localStorage?.getItem('kicad:workspace-theme:v1')||'null');if(saved)applyWorkspaceTheme(saved,false);}catch{}
  const pendingSelections=new Map();
  const outerLoads=new Map(),loadRows=new Map();
  function loadOperation(key,label,work,retry){
    const previous=outerLoads.get(key);if(previous)previous.stop('Loading replaced.');
    let row=loadRows.get(key);if(!row){row=element('span');row.className='outer-load-controls';row.setAttribute('role','status');row.setAttribute('aria-live','polite');row.setAttribute('style','order:-1;flex:0 0 auto');loadRows.set(key,row);$('projectTools').append(row);}row.replaceChildren();row.hidden=false;
    const text=element('span',label+'… '),stop=element('button','Stop loading'),again=element('button','Retry');
    stop.type=again.type='button';stop.id='outerLoadStop-'+key;again.id='outerLoadRetry-'+key;again.hidden=true;again.addEventListener('click',()=>{row.hidden=true;retry();});row.append(text,stop,again);
    let cancelled=false,rejectStop;const ids=new Set(),stopped=new Promise((resolve,reject)=>{rejectStop=reject;});
    const state={stop(message='Loading stopped.'){
      if(cancelled)return;cancelled=true;clearTimeout(timer);
      for(const loadId of ids)send({type:'load-cancel',loadId}).catch(()=>{});
      text.textContent=message+' ';stop.hidden=true;again.hidden=false;rejectStop(Error(message));
    }};
    const timer=setTimeout(()=>state.stop('Loading timed out after 2 minutes.'),120000);timer?.unref?.();
    outerLoads.set(key,state);stop.addEventListener('click',()=>state.stop());
    const check=()=>{if(cancelled)throw Error('Loading stopped.');};
    async function read(message){
      check();const loadId=crypto.randomUUID().replaceAll('-','');ids.add(loadId);
      try{const reply=await Promise.race([send({...message,loadId}),stopped]);check();return reply;}
      finally{ids.delete(loadId);}
    }
    let operation;try{operation=work(read,check);}catch(error){operation=Promise.reject(error);}
    return Promise.race([operation,stopped]).then(result=>{check();row.hidden=true;return result;},error=>{if(!cancelled)state.stop(error.message||String(error));throw error;}).finally(()=>{clearTimeout(timer);if(outerLoads.get(key)===state)outerLoads.delete(key);});
  }
  addEventListener('pagehide',()=>{for(const state of outerLoads.values())state.stop('Loading stopped.');});

  let linked = Boolean(request.base && !["added", "removed"].includes(request.status));
  let manualMode = false, changes = null, loading = null;
  let pairedFile=null,crossLinked=true,pairEpoch=0;
  function crossSelectionState(enabled){crossLinked=enabled;$('crossSelectToggle')?.setAttribute('aria-pressed',String(enabled));if(!enabled)pendingSelections.clear();}
  const entryFile=request.file;
  const isDrawing=path=>data.validPath(path),isBoard=path=>/\.kicad_pcb$/i.test(path||'');
  const validEntry=path=>isDrawing(path)||Boolean(globalThis.KiCadGitHub?.filePath(path));
  let activeWorkspace=isDrawing(entryFile)?(isBoard(entryFile)?'layout':'schematic'):'project',inventoryPromise=null,tabEpoch=0,pickerMounted=false,revisionPicker=null,historyReturnWorkspace=null,chooserMode='split',latestHierarchy=null;
  let workspaceHelpers=null;const tabs=new Map();let bomBrowser=null,bomReturnWorkspace=null,bomModelPromise=null,bomMode='schematic',bomSelection=null,bomAssembly=null,bomAssemblyEpoch=0;
  async function loadBomDrawing(){if(!bomModelPromise)bomModelPromise=(async()=>{let file=isDrawing(request.file)?request.file:null;if(!file){const result=await inventory(),drawings=result.files.map(f=>f.path).filter(isDrawing),stem=entryFile.replace(/\.[^.]+$/,''),matching=drawings.filter(path=>path.replace(/\.kicad_[^.]+$/i,'')===stem);file=matching.find(path=>!isBoard(path))||matching[0]||(drawings.length===1?drawings[0]:null);}if(!file)throw Error('Open the schematic or PCB for this project before choosing BoM.');return send({type:'project',repository:request.headRepository,ref:request.head,file});})().then(reply=>{if(!reply?.ok)throw Error(reply?.error||'Could not read drawing parts.');const files=reply.result;if(!Array.isArray(files)||files.length>128)throw Error('Invalid drawing project.');const snapshot=KiCadDesignDiff.prepareProject(files),model=KiCadDesignModel.buildProject(files,null,snapshot);return{files,snapshot,model,warnings:files.map(f=>f.discoveryWarning).filter(Boolean)};}).catch(error=>{bomModelPromise=null;throw error;});const saved=await bomModelPromise,model=bomAssembly?KiCadDesignModel.buildProject(saved.files,bomAssembly.config,saved.snapshot):saved.model,variant=bomAssembly?.variant||'default';const applied=KiCadDesignModel.applyVariant(model,variant),resolved=globalThis.KiCadBomBrowser?.resolveDrawing?.(applied,saved.files,{rootFile:request.file,sheets:model.sheets.filter(sheet=>sheet.kind==='schematic'),snapshot:saved.snapshot})||{objects:applied,warnings:[]};return{objects:resolved.objects,variant,variantName:model.variants.find(v=>v.id===variant)?.name||'Saved design',warnings:[...saved.warnings,...model.warnings,...resolved.warnings]};}
  async function bomCompanion(mode,chosen){const board=mode!=='schematic',result=await inventory(),choices=result.files.map(f=>f.path).filter(file=>isDrawing(file)&&isBoard(file)===board),stem=entryFile.replace(/\.kicad_[^.]+$/i,''),matching=choices.filter(file=>file.replace(/\.kicad_[^.]+$/i,'')===stem),file=chosen&&choices.includes(chosen)?chosen:isBoard(entryFile)===board&&isDrawing(entryFile)?entryFile:matching.length===1?matching[0]:choices.length===1?choices[0]:null;if(!file)return{choices,message:choices.length?'Choose the companion drawing for this project.':'No matching saved drawing was found.'};bomMode=mode;return{file,url:chrome.runtime.getURL(board?'pcb-viewer.html':'schematic-viewer.html')+'?'+new URLSearchParams({repository:request.headRepository,ref:request.head,file,workspace:'1',headerViews:'1',headerSearch:'1',bomCompanion:'1',viewSession,...providerContext})};}
  function selectBomPart(part){const selection=globalThis.KiCadPairedReview?.partSelection(part);if(!selection)return;bomSelection=selection;for(const [side,frame]of frames)if(side!=='base')frame.contentWindow?.postMessage({type:'kicad-review:command',command:'highlight-related',selection},origin());}
  let pendingViewAction=params.get('view')==='3d'?'3d':null,workspaceSearch=null,pendingSearchResult=null;
  function dispatchWorkspaceView(){
    if(!pendingViewAction)return;
    const board=(pendingViewAction==='bom'&&isBoard(request.file))||['layout','3d','draftsman'].includes(pendingViewAction)||(pendingViewAction==='simulation'&&activeWorkspace==='layout');
    const side=[...frames.keys()].find(side=>side!=='base'&&views.has(side)&&isBoard(views.get(side).file)===board);
    if(!side)return;const mode=pendingViewAction;pendingViewAction=null;
    frames.get(side).contentWindow?.postMessage({type:'kicad-review:command',command:'workspace-view',mode},origin());
    for(const [key,button]of tabs){button.classList.toggle('active',key===mode);button.setAttribute('aria-pressed',String(key===mode));}
  }
  async function openWorkspaceView(name){if(name==='bom'){tabEpoch++;pairEpoch++;pendingViewAction=null;if(activeWorkspace!=='bom')bomReturnWorkspace=activeWorkspace;markWorkspace('bom');$('changesPanel').hidden=true;if(!bomBrowser&&globalThis.KiCadBomBrowser)bomBrowser=KiCadBomBrowser.mount({document,holder:$('bomWorkspace'),scope:{repository:request.headRepository,ref:request.head,file:entryFile,...providerContext},inventory:()=>inventory(()=>bomBrowser.show()),url:page=>chrome.runtime.getURL(page),loadDrawing:loadBomDrawing,companion:bomCompanion,onSelect:selectBomPart,onFrame:frame=>{frames.delete('bom');views.delete('bom');if(frame)frames.set('bom',frame);},onDrawing:async()=>{const mode=isBoard(request.file)?'layout':'schematic';await openWorkspaceView(mode);pendingViewAction='bom';dispatchWorkspaceView();}});await bomBrowser?.show();return;}if(name==='history'){mountPicker();if(revisionPicker?.openGraph)return revisionPicker.openGraph();status('Open a repository drawing to browse history.');return;}if(name==='project'&&params.get('projectShell')==='1'&&parent!==globalThis){parent.postMessage({type:'kicad-review:show-project-settings'},location.origin);return;}pendingViewAction=name==='project'?null:name;await chooseWorkspace(['3d','draftsman'].includes(name)?'layout':name==='simulation'?(isBoard(request.file)?'layout':'schematic'):name);dispatchWorkspaceView();}
  function dispatchSearchResult(){
    if(!pendingSearchResult)return;
    const side=[...frames.keys()].find(side=>side!=='base'&&views.has(side)&&(pendingSearchResult.action==='sheet-tree'?!isBoard(views.get(side).file):!pendingSearchResult.path||views.get(side).file===pendingSearchResult.path));
    if(!side)return;const result=pendingSearchResult;pendingSearchResult=null;
    frames.get(side).contentWindow?.postMessage({type:'kicad-review:command',command:'search-result',result},origin());
  }
  async function openSearchResult(result){if(result?.kind==='command'&&result.action==='sheet-tree'){pendingSearchResult=result;await openWorkspaceView('schematic');dispatchSearchResult();return;}
    if(!globalThis.KiCadGitHub.filePath(result.path))throw Error('Invalid search result path.');
    if(result.kind==='draft'){
      const file=result.sourceFile||(isDrawing(result.path)?result.path:null);if(!file||!data.validPath(file))throw Error('Open the exact source PCB for this Draftsman document first.');
      markWorkspace('draftsman');comparison.hidden=true;$('projectWorkspace').hidden=true;
      const frame=element('iframe');frame.title='Draftsman source '+file;frame.src=chrome.runtime.getURL(isBoard(file)?'pcb-viewer.html':'schematic-viewer.html')+'?'+new URLSearchParams({repository:request.headRepository,ref:request.head,file,workspace:'1',headerViews:'1',headerSearch:'1',...providerContext});
      $('searchWorkspace').replaceChildren(frame);$('searchWorkspace').hidden=false;frames.set('search',frame);pendingSearchResult={...result,path:file};return;
    }
    if(isDrawing(result.path)){
      if(result.path===request.file||result.path===pairedFile){displayDrawing(result.path);pendingSearchResult=result;dispatchSearchResult();if(result.view==='3d')await openWorkspaceView('3d');return;}
      const query=new URLSearchParams({repository:request.headRepository,head:request.head,file:result.path,viewSession,...providerContext,...(params.get('projectShell')==='1'?{projectShell:'1'}:{})});
      if(result.uuid)query.set('focusUuid',result.uuid);
      if(result.netName)query.set('focusNet',result.netName);
      if(Number.isFinite(result.position?.x)&&Number.isFinite(result.position?.y)){query.set('focusX',result.position.x);query.set('focusY',result.position.y);}
      if(result.view==='3d')query.set('view','3d');location.assign(chrome.runtime.getURL('browser-viewer.html')+'?'+query);return;
    }
    const page=/\.pdf$/i.test(result.path)?'pdf-viewer.html':result.kind==='report'&&!/\.kicad_pro$/i.test(result.path)?'analysis-viewer.html':'project-viewer.html';
    markWorkspace(result.kind==='report'&&!/\.kicad_pro$/i.test(result.path)?'simulation':'project');comparison.hidden=true;$('projectWorkspace').hidden=true;
    const frame=element('iframe');frame.title=result.label||result.path;frame.src=chrome.runtime.getURL(page)+'?'+new URLSearchParams({repository:request.headRepository,ref:request.head,file:result.path,projectOnly:'1',...providerContext});
    $('searchWorkspace').replaceChildren(frame);$('searchWorkspace').hidden=false;
  }
  function mountWorkspaceSearch(){
    if(workspaceSearch||!globalThis.KiCadWorkspaceSearch)return;
    const scope={repository:request.headRepository,ref:request.head,file:entryFile,provider,host:providerContext.host||'https://github.com'};
    workspaceSearch=KiCadWorkspaceSearch.mount({document,host:globalThis,holder:$('workspaceSearchHost'),scope,request:async(type,extra)=>{const reply=await send({type,...scope,...extra});if(!reply?.ok)throw Error(reply?.error||'Project search unavailable.');return reply.result;},getDrafts:()=>KiCadWorkspaceSearch.scopedDrafts(localStorage,scope),open:openSearchResult});
    addEventListener('pagehide',()=>workspaceSearch?.destroy(),{once:true});
  }
  function sourceFor(file){if(!validEntry(file))return;const removed=request.status==='removed'&&file===request.file;const repo=removed?request.repository:request.headRepository,ref=removed?request.base:request.head;$('sourceLink').href=`${provider==='gitlab'?providerContext.host:'https://github.com'}/${repo}/${provider==='gitlab'?'-/blob':'blob'}/${encodeURIComponent(ref)}/${file.split('/').map(encodeURIComponent).join('/')}`;}
  function markWorkspace(name){activeWorkspace=name;const split=$('splitView');if(split){split.setAttribute('aria-pressed',String(name==='split'));split.textContent=name==='split'?'Unsplit':'Split view';split.title=name==='split'?'Return to one drawing':'Split schematic and layout';} for(const [key,button]of tabs){button.classList.toggle('active',key===name);button.setAttribute('aria-pressed',String(key===name));}if($('searchWorkspace'))$('searchWorkspace').hidden=true;frames.delete('search');views.delete('search');comparison.hidden=['project','history','bom'].includes(name);if($('historyWorkspace'))$('historyWorkspace').hidden=name!=='history';if($('bomWorkspace'))$('bomWorkspace').hidden=name!=='bom';if(name==='history')$('changesPanel').hidden=true;$('projectWorkspace').hidden=name!=='project';toolbar.hidden=true;revealWorkspaceTab();sourceFor(name==='project'?entryFile:name==='schematic'&&data.validPath(latestHierarchy?.hierarchy?.active)?latestHierarchy.hierarchy.active:name==='layout'?(isBoard(request.file)?request.file:pairedFile):request.file);}
  function mountPicker(){if(pickerMounted||!isDrawing(request.file)||!globalThis.KiCadRevisionPicker)return;pickerMounted=true;revisionPicker=globalThis.KiCadRevisionPicker.mount({holder:$('projectTools'),workspaceHolder:$('historyWorkspace'),onOpenGraph:()=>{if(activeWorkspace!=='history')historyReturnWorkspace=activeWorkspace;markWorkspace('history');},onCloseGraph:()=>markWorkspace(historyReturnWorkspace||'schematic'),request:{...request,pullNumber:undefined},openRevision:source=>location.assign(chrome.runtime.getURL('project-launcher.html')+'?'+new URLSearchParams({source})),getCurrentRef:()=>views.get('head')?.ref||request.head,send:message=>send(message),navigateComparison:query=>location.assign(`${chrome.runtime.getURL(globalThis.KiCadVSCodeContext||globalThis.KiCadAndroidRuntime?'browser-viewer.html':'comparison-viewer.html')}?${query}`),navigate:query=>location.assign(`${chrome.runtime.getURL('browser-viewer.html')}?${query}`)});}
  function projectWorkspace(){
    if(!$('projectWorkspace').children.length){const frame=element('iframe');frame.title='Project settings and constraints';frame.src=chrome.runtime.getURL('project-viewer.html')+'?'+new URLSearchParams({repository:request.headRepository,ref:request.head,file:entryFile,projectOnly:'1',...providerContext});$('projectWorkspace').append(frame);frames.set('project',frame);frame.addEventListener('load',()=>{if(workspaceTheme)frame.contentWindow.postMessage({type:'kicad-review:command',command:'set-theme',...workspaceTheme},origin());});}
    markWorkspace('project');$('changesPanel').hidden=true;
  }
  async function inventory(retry){if(!inventoryPromise)inventoryPromise=loadOperation('inventory','Finding project drawings',read=>read({type:'project-inventory',repository:request.headRepository,ref:request.head,file:entryFile}),retry).then(reply=>{if(!reply?.ok)throw Error(reply?.error||'Could not discover project drawings.');if(!Array.isArray(reply.result?.files)||reply.result.files.length>20000)throw Error('Invalid project inventory.');return reply.result;}).catch(error=>{inventoryPromise=null;throw error;});return inventoryPromise;}
  function displayDrawing(path){
    if(isDrawing(request.file)&&path!==request.file&&isBoard(path)===isBoard(request.file)){
      location.assign(chrome.runtime.getURL('browser-viewer.html')+'?'+new URLSearchParams({repository:request.headRepository,head:request.head,file:path,viewSession,...providerContext}));return;
    }
    if(!isDrawing(request.file)){request.file=path;request.oldFile=path;showProject('head',request.headRepository,request.head,path);mountPicker();}
    if(path===request.file){markWorkspace(isBoard(path)?'layout':'schematic');if(pairedFile)pairView('main');else setMode('head');}
    else{if(path!==pairedFile)openPair(path);markWorkspace(isBoard(path)?'layout':'schematic');pairView('companion');}
    toolbar.hidden=true;status('');dispatchWorkspaceView();
  }
  async function chooseWorkspace(name){
    const epoch=++tabEpoch;pairEpoch++;if(name==='project'){projectWorkspace();return;}
    const wantsBoard=name==='layout';
    if(isDrawing(request.file)&&isBoard(request.file)===wantsBoard){displayDrawing(request.file);return;}
    if(pairedFile&&isBoard(pairedFile)===wantsBoard){displayDrawing(pairedFile);return;}
    status('Finding '+(wantsBoard?'PCB layouts':'schematic root sheets')+'…');
    try{const result=await inventory(()=>chooseWorkspace(name));if(epoch!==tabEpoch)return;
      const choices=result.files.map(file=>file.path).filter(path=>isDrawing(path)&&isBoard(path)===wantsBoard);
      const stem=entryFile.replace(/\.kicad_[^.]+$/i,'');const matching=choices.filter(path=>path.replace(/\.kicad_[^.]+$/i,'')===stem);
      const path=matching.length===1?matching[0]:choices.length===1?choices[0]:null;
      if(path){displayDrawing(path);return;}
      chooserMode='single';const select=$('companionSelect');select.replaceChildren(element('option','Choose '+(wantsBoard?'PCB layout':'schematic')));select.children[0].value='';for(const path of choices){const option=element('option',path);option.value=path;select.append(option);}$('pairChooser').hidden=false;
      status(choices.length?'Choose a drawing; multiple project files are available.':'No matching drawing found. Enter its repository-relative path.',!choices.length);
    }catch(error){if(epoch===tabEpoch)status(error.message,true);}
  }
  function revealWorkspaceTab(){tabs.get(activeWorkspace)?.scrollIntoView?.({block:'nearest',inline:'nearest'});}
  addEventListener('resize',revealWorkspaceTab);
  function workspaceTabs(){const menu=element('details'),summary=element('summary','More'),panel=element('div');menu.id='workspaceHelpers';summary.setAttribute('aria-label','More workspace tools');menu.append(summary,panel);workspaceHelpers=panel;$('projectTools').append(menu);addEventListener('pointerdown',event=>{if(menu.open&&!menu.contains?.(event.target))menu.open=false;});addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){menu.open=false;summary.focus?.();}});if(globalThis.KiCadReviewWorkspace?.mountNavigationHelp){const content=element('details');content.id='shortcutHelp';globalThis.KiCadReviewWorkspace.mountNavigationHelp(document,$('projectTools'),content);}if(!globalThis.KiCadVSCodeContext&&!globalThis.KiCadAndroidRuntime&&['chrome-extension:','moz-extension:'].includes(location.protocol)){const home=element('button');home.type='button';home.id='openProjectDashboard';home.title='Project dashboard and recently accessed projects';home.setAttribute('aria-label','Project dashboard');if(globalThis.KiCadUIIcons)home.append(KiCadUIIcons.icon('dashboard'));home.append(element('span','Projects'));home.addEventListener('click',()=>globalThis.open(chrome.runtime.getURL('dashboard.html'),'_blank','noopener'));$('workspaceTabs').append(home);}for(const [name,label,icon]of [['project','Project','folder'],['schematic','Schematic','sheet'],['layout','Layout','board'],['3d','3D','cube'],['bom','BoM','assembly'],['draftsman','Draftsman','draftsman'],['simulation','Simulation','analytics'],['history','History','repository']]){const button=element('button');button.type='button';button.title=label;button.setAttribute('aria-label',label+' view');if(globalThis.KiCadUIIcons)button.append(KiCadUIIcons.icon(icon));button.append(element('span',label));button.addEventListener('click',()=>{menu.open=false;openWorkspaceView(name);});tabs.set(name,button);if(['project','draftsman'].includes(name)){panel.append(button);}else $('workspaceTabs').append(button);}markWorkspace(activeWorkspace);}
  function projectControl(text,handler){const button=element('button',text);button.type='button';button.addEventListener('click',event=>{if($('workspaceHelpers'))$('workspaceHelpers').open=false;handler(event);});if(workspaceHelpers&&!['Split view','Theme'].includes(text)){workspaceHelpers.append(button);}else $('projectTools').append(button);return button;}
  function companionValid(path){return data.validPath(path)&&/\.kicad_pcb$/i.test(path)!==/\.kicad_pcb$/i.test(request.file);}
  function pairView(mode='both'){
    toolbar.hidden=Boolean(pairedFile);comparison.classList.toggle('single',!pairedFile);comparison.classList.toggle('paired',Boolean(pairedFile));comparison.classList.toggle('focus-pane',Boolean(pairedFile)&&mode!=='both');
    $('headKind').textContent=/\.kicad_pcb$/i.test(request.file)?'PCB LAYOUT':'SCHEMATIC';$('basePanel').hidden=true;$('headPanel').hidden=mode==='companion';$('pairPanel').hidden=!pairedFile||mode==='main';$('changesPanel').hidden=true;
  }
  function openPair(path){
    if(!companionValid(path)){status('Choose a schematic and a PCB from the same repository revision.',true);return;}
    pairEpoch++;pairedFile=path;linked=false;manualMode=true;showProject('pair',request.headRepository,request.head,path);$('pairRef').textContent=request.head.slice(0,12);$('pairKind').textContent=/\.kicad_pcb$/i.test(path)?'PCB LAYOUT':'SCHEMATIC';markWorkspace('split');pairView();$('pairControls').hidden=false;$('splitOptions').hidden=false;$('pairChooser').hidden=true;status('Cross-highlight uses saved symbol identities, unique references and unambiguous saved sheet-qualified net names. Cameras remain independent.');
  }
  function pairTools(){
    const split=projectControl('Split view',async()=>{tabEpoch++;if(activeWorkspace==='split'){closeSplit();return;}
      if(pairedFile){markWorkspace('split');pairView();return;}
      chooserMode='split';const epoch=++pairEpoch;$('pairChooser').hidden=false;split.disabled=true;
      try{const reply=await send({type:'drawing-files',repository:request.headRepository,ref:request.head,file:request.file});if(epoch!==pairEpoch)return;if(!reply?.ok)throw new Error(reply?.error||'Could not discover companion drawings.');
        const files=reply.result?.files;if(!Array.isArray(files)||files.length>1000)throw new Error('Invalid companion file listing.');const choices=files.filter(companionValid);$('companionSelect').replaceChildren(element('option','Choose companion drawing'));for(const path of choices){const option=element('option',path);option.value=path;$('companionSelect').append(option);}
        $('companionSelect').children[0].value='';if(choices.length===1){$('companionSelect').value=choices[0];openPair(choices[0]);}else status(choices.length?'Choose the paired schematic or PCB.':'No companion in this directory. Enter a repository-relative drawing path.');
      }catch(error){if(epoch===pairEpoch)status(error.message+' Enter a repository-relative companion path.',true);}finally{split.disabled=false;}
    });
    split.id='splitView';split.setAttribute('aria-pressed','false');
    const chooser=element('span');chooser.id='pairChooser';chooser.hidden=true;const select=element('select');select.id='companionSelect';select.setAttribute('aria-label','Companion drawing');select.addEventListener('change',()=>{if(select.value){tabEpoch++;pairEpoch++;if(chooserMode==='single')displayDrawing(select.value);else openPair(select.value);$('pairChooser').hidden=true;}});const path=element('input');path.id='companionPath';path.placeholder='Repository-relative companion path';path.setAttribute('aria-label','Companion path');const open=element('button','Open pair');open.addEventListener('click',()=>{tabEpoch++;pairEpoch++;const file=path.value.trim()||select.value;if(chooserMode==='single'){if(isDrawing(file)){displayDrawing(file);$('pairChooser').hidden=true;}else status('Enter a valid repository-relative drawing path.',true);}else openPair(file);});const close=element('button','×');close.type='button';close.id='closePairChooser';close.title='Close drawing chooser';close.setAttribute('aria-label','Close drawing chooser');const dismissChooser=()=>{tabEpoch++;pairEpoch++;chooser.hidden=true;split.disabled=false;split.focus?.();};close.addEventListener('click',dismissChooser);chooser.append(select,path,open,close);$('projectTools').append(chooser);
    addEventListener('pointerdown',event=>{if(!chooser.hidden&&!chooser.contains?.(event.target)&&!event.composedPath?.().includes(chooser)&&event.target!==split){tabEpoch++;pairEpoch++;chooser.hidden=true;split.disabled=false;}});
    addEventListener('keydown',event=>{if(event.key==='Escape'&&!chooser.hidden){event.preventDefault?.();dismissChooser();}});
    const detail=element('details');detail.className='split-options';detail.id='splitOptions';detail.hidden=true;detail.append(element('summary','Split options'));const controls=element('span');controls.id='pairControls';controls.hidden=true;detail.append(controls);
    const add=(text,handler)=>{const node=element('button',text);node.type='button';node.addEventListener('click',handler);controls.append(node);return node;};
    const sync=projectControl('Cross-select',()=>{crossSelectionState(!crossLinked);sendCommand('detach-sync',{enabled:crossLinked});});sync.id='crossSelectToggle';sync.setAttribute('aria-pressed','true');sync.title='Toggle cross-selection across schematic, layout and detached views';sync.setAttribute('data-icon','link');
    add('Both panes',()=>pairView());add(/\.kicad_pcb$/i.test(request.file)?'PCB only':'Schematic only',()=>pairView('main'));add(/\.kicad_pcb$/i.test(request.file)?'Schematic only':'PCB only',()=>pairView('companion'));const stack=add('Stack panes',()=>{comparison.classList.toggle('vertical');});
    function closeSplit(){tabEpoch++;pairEpoch++;pairedFile=null;frames.delete('pair');views.delete('pair');pendingSelections.delete('pair');$('pairDrawing').replaceChildren();$('pairPanel').hidden=true;controls.hidden=true;$('splitOptions').hidden=true;markWorkspace(isBoard(request.file)?'layout':'schematic');comparison.classList.toggle('paired',false);comparison.classList.toggle('focus-pane',false);comparison.classList.toggle('vertical',false);toolbar.hidden=true;$('headKind').textContent='HEAD';setMode('head');status('');}(workspaceHelpers||$('projectTools')).append(detail);
    const theme=projectControl('Theme',()=>{const next=(workspaceTheme?.drawingTheme||document.body?.dataset?.drawingTheme||'dark')==='dark'?'light':'dark';applyWorkspaceTheme({uiTheme:next,drawingTheme:next});});themeControl=theme;theme.id='workspaceTheme';theme.setAttribute('data-icon','theme');theme.title='Toggle light / dark in all open panes';theme.setAttribute('aria-pressed',String((workspaceTheme?.drawingTheme||'dark')==='dark'));
    projectControl('Pop out',async()=>{try{const reply=await send({type:'open-viewer-window',repository:request.headRepository,ref:request.head,file:request.file,...(pairedFile?{pairedFile}:{})});if(!reply?.ok)throw new Error(reply?.error||'Could not open viewer window.');}catch(error){status(error.message,true);}});
    projectControl('Fit panes',()=>sendCommand('fit-drawing'));
    const initial=params.get('pairedFile');if(initial){if(companionValid(initial))openPair(initial);else status('Invalid companion drawing path.',true);}
  }
  addEventListener('message',event=>{if(event.origin===origin()&&event.source===$('bomWorkspace')?.querySelector?.('iframe')?.contentWindow&&event.data?.type==='kicad-bom:back'){openWorkspaceView(bomReturnWorkspace&&bomReturnWorkspace!=='bom'?bomReturnWorkspace:(isBoard(request.file)?'layout':'schematic'));return;}if(event.origin===origin()&&[...frames.values()].some(frame=>frame.contentWindow===event.source)&&event.data?.type==='kicad-review:detach-state'&&typeof event.data.enabled==='boolean'){crossSelectionState(event.data.enabled);dispatchEvent(new CustomEvent('kicad-review:detach-state',{detail:{enabled:event.data.enabled}}));}});
  addEventListener('kicad-review:detach-sync',event=>{if(typeof event.detail?.enabled==='boolean'){crossSelectionState(event.detail.enabled);for(const frame of frames.values())frame.contentWindow?.postMessage({type:'kicad-review:command',command:'detach-sync',enabled:event.detail.enabled},origin());}});
  addEventListener('kicad-review:detach-view',event=>{const mode=event.detail?.mode;if(!['schematic','layout','3d'].includes(mode))return;globalThis.KiCadDetachedView?.chooser({mode,current:request.file,unavailable:Boolean(globalThis.KiCadVSCodeContext||globalThis.KiCadLocalRuntime&&!globalThis.KiCadLocalWorkspace?.openDetached||globalThis.KiCadAndroidRuntime),getEntries:async()=>(await inventory()).files,buildURL:file=>KiCadDetachedView.url({base:location.href,mode,file,repository:request.headRepository,ref:request.head,provider,host:providerContext.host,session:viewSession,allowLocal:Boolean(globalThis.KiCadLocalRuntime&&globalThis.KiCadLocalWorkspace?.openDetached)}),onError:message=>status(message,true)});});
  function status(message, error = false) {
    if(request.pullNumber&&!request.base)message="PR head loaded; merge-base comparison unavailable. "+message;
    $("status").textContent = message; $("status").classList.toggle("error", error);
    $("status").hidden=Boolean(pairedFile)&&!error;
    $("projectTools").title=pairedFile&&!error?message:"";
  }
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function control(label, mode, handler) {
    const button = element("button", label);
    button.type = "button";
    if (mode) button.dataset.mode = mode;
    button.addEventListener("click", handler); toolbar.append(button); return button;
  }
  function setMode(mode) {
    if(pairedFile){pairView(mode==='base'?'companion':mode==='head'?'main':'both');return;}
    comparison.classList.toggle("single", mode !== "compare");
    $("basePanel").hidden = !request.base || mode === "head";
    $("headPanel").hidden = mode === "base";
    toolbar.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });
  }
  function origin() {
    const own = new URL(chrome.runtime.getURL("browser-viewer.html"));
    return `${own.protocol}//${own.host}`;
  }
  function sendCommand(command, extra = {}) {
    for (const frame of frames.values()) frame.contentWindow?.postMessage({ type: "kicad-review:command", command, ...extra }, origin());
  }
  function showProject(side, repository, ref, file, position = null) {
    const holder = $(side + "Drawing");
    holder.replaceChildren(); frames.delete(side); views.delete(side);pendingSelections.delete(side);
    if (!repository || !ref || !file) {
      holder.className = "placeholder";
      holder.textContent = "This design is absent in this revision.";
      return;
    }
    holder.className = "drawing";
    const viewer = element("iframe");viewer.allow="camera";
    viewer.title = `${file} at ${ref.slice(0, 12)}`;
    const query = new URLSearchParams({ repository, ref, file, workspace: '1', headerViews:'1',...(globalThis.KiCadWorkspaceSearch?{headerSearch:'1'}:{}),viewSession, ...providerContext });
    if(file===entryFile&&params.get('focusNet')&&params.get('focusNet').length<=500)query.set('focusNet',params.get('focusNet'));
    if (request.pullNumber) { query.set("pullNumber", request.pullNumber); query.set("pullRepository", request.pullRepository); }
    if(!position&&file===entryFile&&params.has('focusX')&&params.has('focusY')&&[params.get('focusX'),params.get('focusY')].every(n=>Number.isFinite(Number(n))&&Math.abs(Number(n))<=1e6))position={x:Number(params.get('focusX')),y:Number(params.get('focusY')),uuid:params.get('focusUuid')};
    if(position?.uuid&&typeof position.uuid==='string'&&position.uuid.length<=200)query.set('focusUuid',position.uuid);
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      query.set("focusX", position.x); query.set("focusY", position.y);
    }
    viewer.src = `${chrome.runtime.getURL(/\.kicad_pcb$/i.test(file) ? "pcb-viewer.html" : "schematic-viewer.html")}?${query}`;
    holder.append(viewer); frames.set(side, viewer);
  }
  addEventListener('message',event=>{if(event.source===parent&&event.origin===origin()&&event.data?.type==='kicad-review:open-sheet'&&data.validPath(event.data.file)&&/\.kicad_sch$/i.test(event.data.file))frames.get('head')?.contentWindow?.postMessage({type:'kicad-review:command',command:'open-sheet',file:event.data.file},origin());});
  addEventListener('message',event=>{
    if(event.origin!==origin()||event.source!==$('projectWorkspace').children[0]?.contentWindow)return;
    if(event.data?.type==='kicad-review:project-ready'){if(latestHierarchy)event.source.postMessage(latestHierarchy,origin());return;}
    if(!isDrawing(event.data?.file))return;
    if(event.data.type==='kicad-review:project-sheet'&&!isBoard(event.data.file)){
      const side=!isBoard(request.file)?'head':'pair';if(!frames.has(side))return;
      frames.get(side).contentWindow?.postMessage({type:'kicad-review:command',command:'open-sheet',file:event.data.file},origin());markWorkspace('schematic');if(pairedFile)pairView(side==='head'?'main':'companion');else setMode('head');toolbar.hidden=true;return;
    }
    if(event.data.type==='kicad-review:project-drawing'){tabEpoch++;displayDrawing(event.data.file);}
  });
  function normalizedFile(side, file) {
    return side === "base" && file === request.oldFile ? request.file : file;
  }
  function relayView(from, to) {
    const source = views.get(from), target = views.get(to);
    if (!linked || !source || !target || normalizedFile(from, source.file) !== normalizedFile(to, target.file)) return;
    frames.get(to)?.contentWindow?.postMessage({ type: "kicad-review:command", command: "set-view",
      file: target.file, view: source.view }, origin());
  }
  addEventListener("message", (event) => {
    if (event.origin !== origin() || event.data?.type !== "kicad-review:view" ||
        !["ready", "change"].includes(event.data.phase) || !data.validPath(event.data.file) ||
        !globalThis.KiCadViewState.valid(event.data.view)) return;
    const side = [...frames].find(([, frame]) => frame.contentWindow === event.source)?.[0];
    if (!side) return;
    views.set(side, { file: event.data.file, view: event.data.view,ref:/^[a-f0-9]{40}$/i.test(event.data.ref||'')?event.data.ref:views.get(side)?.ref });
    if(event.data.phase==='ready'&&!workspaceTheme&&side==='head'&&['light','dark'].includes(event.data.uiTheme)&&['light','dark'].includes(event.data.drawingTheme))applyWorkspaceTheme(event.data,false);
    if(event.data.phase==='ready'&&workspaceTheme)event.source.postMessage({type:'kicad-review:command',command:'set-theme',theme:workspaceTheme.drawingTheme,...workspaceTheme},origin());
    if(event.data.phase==='ready'){dispatchWorkspaceView();dispatchSearchResult();if(side!=='base'&&bomAssembly)event.source.postMessage({type:'kicad-review:command',command:'assembly-variant',repository:request.headRepository,ref:request.head,file:new URL(frames.get(side).src).searchParams.get('file'),...bomAssembly},origin());if(side==='bom'){if(bomMode==='3d')event.source.postMessage({type:'kicad-review:command',command:'workspace-view',mode:'3d'},origin());if(bomSelection)event.source.postMessage({type:'kicad-review:command',command:'highlight-related',selection:bomSelection},origin());}}
    if(event.data.phase==='ready'&&pendingSelections.has(side)){
      const selection=pendingSelections.get(side);pendingSelections.delete(side);
      if(pairedFile&&crossLinked)frames.get(side)?.contentWindow?.postMessage({type:'kicad-review:command',command:'highlight-related',selection},origin());
    }
    if (event.data.phase === "ready") relayView("head", "base");
    else relayView(side, side === "base" ? "head" : "base");
  });
  addEventListener('message',(event)=>{
    if(event.origin!==origin())return;const side=[...frames].find(([,frame])=>frame.contentWindow===event.source)?.[0];if(!side)return;
    if(event.data?.type==='kicad-review:theme'){
      const message=event.data,source=new URL(frames.get(side).src);if(message.repository!==source.searchParams.get('repository')||message.ref!==source.searchParams.get('ref')&&message.ref!==views.get(side)?.ref||message.file!==source.searchParams.get('file')||!['light','dark'].includes(message.uiTheme)||!['light','dark'].includes(message.drawingTheme))return;
      if(workspaceTheme&&!views.has(side)&&side!=='project'||!workspaceTheme&&side!=='head'&&side!=='project')return;
      if(workspaceTheme?.uiTheme===message.uiTheme&&workspaceTheme?.drawingTheme===message.drawingTheme)return;applyWorkspaceTheme(message);return;
    }
    if(event.data?.type==='kicad-review:selection'&&globalThis.KiCadPairedReview?.validSelection(event.data.selection)&&activeWorkspace==='bom'){bomSelection=event.data.selection;bomBrowser?.select(event.data.selection);if(crossLinked)for(const [target,frame]of frames)if(target!==side&&target!=='base')frame.contentWindow?.postMessage({type:'kicad-review:command',command:'highlight-related',selection:event.data.selection},origin());return;}
    if(event.data?.type==='kicad-review:assembly-variant'){
      const message=event.data,frameSource=new URL(frames.get(side).src);if(!['head','pair','bom'].includes(side)||message.repository!==request.headRepository||message.ref!==request.head||message.file!==frameSource.searchParams.get('file')||!isDrawing(message.rootFile)||typeof message.variant!=='string'||message.variant.length>64)return;
      try{const raw=JSON.stringify(message.config??{schemaVersion:1,variants:[]});if(raw.length>1024*1024)return;const config=KiCadDesignModel.parseVariantConfig(raw,'variants.json');if(message.variant!=='default'&&!config.variants.some(v=>v.id===message.variant))return;if(!views.has(side)&&bomAssembly)return;const next={variant:message.variant,config};if(JSON.stringify(next)===JSON.stringify(bomAssembly))return;bomAssembly=next;for(const [target,frame]of frames)if(target!==side&&target!=='base'&&views.has(target))frame.contentWindow?.postMessage({type:'kicad-review:command',command:'assembly-variant',repository:request.headRepository,ref:request.head,file:new URL(frame.src).searchParams.get('file'),...next},origin());const epoch=++bomAssemblyEpoch;if(bomBrowser)loadBomDrawing().then(result=>{if(epoch===bomAssemblyEpoch)bomBrowser?.refreshDrawing?.(result);}).catch(error=>status('BoM variant could not be applied: '+error.message,true));}catch{}return;
    }
    if(event.data?.type==='kicad-review:focus-project-search'){workspaceSearch?.input.focus();workspaceSearch?.input.select?.();return;}
    if(event.data?.type==='kicad-review:hierarchy'&&['head','pair'].includes(side)&&!isBoard(new URL(frames.get(side).src).searchParams.get('file'))){latestHierarchy={...event.data,repository:request.headRepository,ref:request.head};if(activeWorkspace==='schematic')sourceFor(latestHierarchy.hierarchy?.active);parent.postMessage(latestHierarchy,origin());$('projectWorkspace').children[0]?.contentWindow?.postMessage(latestHierarchy,origin());return;}
    if(event.data?.type==='kicad-review:comments-changed'){
      for(const [name,frame] of frames)if(name!==side)frame.contentWindow?.postMessage({type:'kicad-review:command',command:'refresh-comments'},origin());return;
    }
    if(!pairedFile||!crossLinked||!['head','pair'].includes(side)||event.data?.type!=='kicad-review:selection'||!globalThis.KiCadPairedReview?.validSelection(event.data.selection))return;
    const target=side==='head'?'pair':'head';
    if(!views.has(target)){pendingSelections.set(target,event.data.selection);return;}
    frames.get(target)?.contentWindow?.postMessage({type:'kicad-review:command',command:'highlight-related',selection:event.data.selection},origin());
  });
  function focusChange(change) {
    if (change.before && !change.after) { manualMode = true; setMode("base"); }
    else if (change.after && !change.before) { manualMode = true; setMode("head"); }
    for (const side of ["base", "head"]) {
      const object = side === "base" ? change.before : change.after;
      const frame = frames.get(side);
      if (!object || !frame) continue;
      const file = side === "base" && change.path === request.file ? request.oldFile : change.path;
      const position = linked && change.before && change.after ? change.after.position || object.position : object.position;
      const current = new URL(frame.src);
      if ((views.get(side)?.file || current.searchParams.get("file")) !== file) {
        showProject(side, side === "base" ? request.repository : request.headRepository,
          side === "base" ? request.base : request.head, file, position);
      } else if (position) frame.contentWindow?.postMessage({ type: "kicad-review:command", command: "focus", position }, origin());
    }
    showProperties(change);
  }
  function showProperties(change) {
    const panel = $("changeProperties"); panel.replaceChildren();
    panel.append(element("h3", change.label), element("p", `${change.kind} · ${change.path} · ${change.status}`));
    const saved = (object) => {
      const properties = { ...object?.properties };
      delete properties["Source fingerprint"];
      return { ...properties,
        ...(object?.position ? { "X (mm)": object.position.x, "Y (mm)": object.position.y } : {}) };
    };
    const before = saved(change.before), after = saved(change.after);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const table = element("table"); table.append(element("caption", "Saved properties: base → head"));
    const header = element("tr");
    for (const text of ["Property", "Base", "Head"]) header.append(element("th", text));
    table.append(header);
    for (const key of keys) {
      const row = element("tr");
      const left = before[key] === undefined ? "—" : String(before[key]);
      const right = after[key] === undefined ? "—" : String(after[key]);
      if (left !== right) row.className = "changed-property";
      row.append(element("th", key), element("td", left), element("td", right)); table.append(row);
    }
    panel.append(table);
    if (change.status === "modified" && keys.every((key) => before[key] === after[key])) {
      panel.append(element("p", "Other saved drawing data changed. Compare the drawings or open GitHub source for details."));
    }
  }
  function renderChanges() {
    const list = $("changeList"); list.replaceChildren();
    if (!changes) return;
    const query = $("changeSearch").value.trim().toLowerCase(), filter = $("changeFilter").value;
    const visible = changes.changes.filter((item) => (filter === "all" || item.status === filter) &&
      `${item.label} ${item.kind} ${item.path}`.toLowerCase().includes(query));
    $("changeCount").textContent = `${changes.counts.added} added · ${changes.counts.removed} removed · ${changes.counts.modified} modified`;
    for (const change of visible) {
      const button = element("button"); button.type = "button"; button.className = "change-row " + change.status;
      button.append(element("strong", `${change.status === "added" ? "+" : change.status === "removed" ? "−" : "~"} ${change.label}`),
        element("small", `${change.kind} · ${change.path}`));
      button.addEventListener("click", () => focusChange(change)); list.append(button);
    }
    if (!visible.length) list.append(element("p", changes.changes.length ? "No changes match this filter." : "No saved drawing objects changed."));
  }
  async function project(repository, ref, file, absent,read=send) {
    if (absent) return [];
    const reply = await read({ type: "project", repository, ref, file });
    if (!reply?.ok) throw new Error(reply?.error || "Could not load saved KiCad objects.");
    return reply.result;
  }
  function loadChanges() {
    if (loading) return loading;
    $("changeCount").textContent = "Comparing saved KiCad objects…";
    loading = loadOperation('changes','Comparing saved objects',async(read,check) => {
      const [base, head] = await Promise.all([
        project(request.repository, request.base, request.oldFile, request.status === "added",read),
        project(request.headRepository, request.head, request.file, request.status === "removed",read)
      ]);
      check();const normalized = base.map((file) => ({ ...file, path: file.path === request.oldFile ? request.file : file.path }));
      changes = globalThis.KiCadDesignDiff.compareProjects(normalized, head);
      renderChanges();
    },()=>loadChanges()).catch((error) => {
      $("changeCount").textContent = error.message || String(error);
      loading = null;
    });
    return loading;
  }
  async function start() {
    if (!request.repository && !request.file) {
      status("Open a public GitHub .kicad_sch or .kicad_pcb file to view it inline, or open a pull request's Files changed tab to compare designs.");
      $("comparison").hidden = true; $("sourceLink").hidden = true;
      return;
    }
    if (!data.validRepository(request.repository,provider) || !data.validRepository(request.headRepository,provider) ||
        !validEntry(request.file) || !validEntry(request.oldFile) || (request.base && (!isDrawing(request.file)||!isDrawing(request.oldFile))) || !data.validRef(request.head) ||
        (request.base && !data.validRef(request.base)) || !["added", "removed", "modified", "renamed", "changed", "copied", "unchanged"].includes(request.status)) {
      status("The Git host file location is invalid or incomplete."); return;
    }
    // Establish the correct surface before a session/ref read can fail.
    $("filename").textContent=request.file;
    $("reviewHeader").dataset.compact=String(!request.base);
    comparison.dataset.blob=String(!request.base);
    $("reviewFooter").hidden=!request.base;
    if(!request.base){$("basePanel").hidden=true;$("headPanel").hidden=false;}
    if(provider==='gitlab'||(!globalThis.KiCadVSCodeContext&&[request.head,request.base].some(ref=>ref&&!/^[a-f0-9]{40}$/i.test(ref)))){
      await loadOperation('start','Resolving Git revision',async(read,check)=>{
      for(const side of ['head',...(request.base?['base']:[])]){
        if(provider!=='gitlab'&&/^[a-f0-9]{40}$/i.test(request[side]))continue;
        const reply=await read({type:'revision-resolve',repository:side==='base'?request.repository:request.headRepository,ref:request[side],file:side==='base'?request.oldFile:request.file});
        if(!reply?.ok||!/^[a-f0-9]{40}$/i.test(reply.result?.sha||''))throw new Error(reply?.error||'Git revision could not be resolved.');check();request[side]=reply.result.sha;
      }
      },()=>start().catch(error=>status(error.message,true)));
    }
    $("filename").textContent = request.file;
    $("reviewHeader").dataset.compact=String(!request.base);comparison.dataset.blob=String(!request.base);$("reviewFooter").hidden=!request.base;
    $("baseRef").textContent = request.base?.slice(0, 12) || "—";
    $("headRef").textContent = request.head.slice(0, 12);
    $("sourceLink").textContent = provider==='gitlab'?'GitLab source':'GitHub source';
    $("sourceLink").href = `${provider==='gitlab'?providerContext.host:'https://github.com'}/${request.status === "removed" ? request.repository : request.headRepository}/${provider==='gitlab'?'-/blob':'blob'}/${encodeURIComponent(request.status === "removed" ? request.base : request.head)}/${(request.status === "removed" ? request.oldFile : request.file).split("/").map(encodeURIComponent).join("/")}`;
    if (request.base) {
      for (const [label, mode] of [["Side by side", "compare"], ["Base", "base"], ["Head", "head"]]) {
        control(label, mode, () => { manualMode = true; setMode(mode); });
      }
      if (!["added", "removed"].includes(request.status)) {
        const link = control("Link views", null, () => {
          linked = !linked;
          link.setAttribute("aria-pressed", String(linked));
          link.classList.toggle("active", linked);
          if (linked) { relayView("head", "base"); sendCommand("report-view"); }
        });
        link.setAttribute("aria-pressed", String(linked));
        link.classList.toggle("active", linked);
        link.title = "Keep matching sheets at the same world position and zoom; 2D views only";
      }
      const button = control("Changes", null, () => {
        const open = $("changesPanel").hidden;
        $("changesPanel").hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        if (open) loadChanges();
      });
      button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-controls", "changesPanel");
      const responsiveMode = () => {
        if (manualMode) return;
        setMode(request.status === "removed" ? "base" : request.status === "added" ? "head" :
          /\.kicad_sch$/i.test(request.file) || !matchMedia("(min-width: 1100px)").matches ? "head" : "compare");
      };
      responsiveMode(); addEventListener("resize", responsiveMode);
    } else setMode("head");
    if(!globalThis.KiCadVSCodeContext&&!globalThis.KiCadAndroidRuntime)control("Unified compare",null,()=>{const p=new URLSearchParams({repository:request.repository,headRepository:request.headRepository,provider,host:providerContext.host||'https://github.com',head:request.head,file:request.file,...(request.base?{base:request.base}:{}),...(request.oldFile?{oldFile:request.oldFile}:{})});globalThis.open(chrome.runtime.getURL('comparison-viewer.html')+'?'+p,'_blank','noopener,noreferrer');});
    control("Fit drawings", null, () => sendCommand("fit-drawing"));
    control("Full sheets", null, () => sendCommand("fit-page"));
    $("changeSearch").addEventListener("input", renderChanges);
    $("changeFilter").addEventListener("change", renderChanges);
    if (request.base) showProject("base", request.status === "added" ? "" : request.repository, request.base, request.oldFile);
    if(isDrawing(request.file))showProject("head", request.status === "removed" ? "" : request.headRepository, request.head, request.file);
    status("");workspaceTabs();pairTools();if(!isDrawing(entryFile))projectWorkspace();
    mountPicker();mountWorkspaceSearch();
    if(request.base){const compare=projectControl(request.pullNumber?'Compare commits':'Comparison controls',()=>{comparison.hidden=false;$('projectWorkspace').hidden=true;toolbar.hidden=!toolbar.hidden;});compare.setAttribute('aria-controls','toolbar');}
  }
  start().catch(error=>{
    status(error.message,true);
    for(const side of request.base?['base','head']:['head']){
      const drawing=$(side+'Drawing');
      if(drawing&&!frames.has(side))drawing.textContent='Drawing could not be loaded. Retry after restoring repository website access.';
    }
  });
})();
