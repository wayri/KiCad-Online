const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const viewState=require('../view-state.js'),core=require('../owned-canvas.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve)),plain=value=>JSON.parse(JSON.stringify(value));
async function revision(query='',extraFiles=[],options={}){
 const listeners=new Map(),canvasListeners=new Map(),controls=new Map(),reports=[],calls={board:0,page:0,draw:0,disposed:0,attach:0};
 class Element{constructor(){this.attributes={};this.children=[];this.listeners=new Map();this.hidden=false;this.dataset={viewer:'auto'};this.isConnected=true;const classes=new Set();this.classList={add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle(n,on){const next=on??!classes.has(n);if(next)classes.add(n);else classes.delete(n);return next;}};this.style={};}setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}append(...children){this.children.push(...children);}addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}remove(){}replaceChildren(){this.children=[];}click(){const result=this.onclick?.();for(const listener of this.listeners.get('click')||[])listener();return result;}}
 Element.prototype.insertBefore=function(child,before){const index=this.children.indexOf(before);if(index<0)this.children.push(child);else this.children.splice(index,0,child);};
 const get=id=>{if(!controls.has(id)){const element=new Element();if(id==='viewerSettings')element.hidden=true;controls.set(id,element);}return controls.get(id);};
 const camera=new core.Camera(800,600),parent={postMessage:(data,origin)=>reports.push({data,origin})};
 const canvas={setNetHighlights(){},canvas:new Element(),viewport:{camera},document:null,visibleLayers:new Set(),addEventListener:(type,callback)=>canvasListeners.set(type,callback),resize(){},draw(){calls.draw++;},dispose(){calls.disposed++;},
  setDocument(design,file){this.design=design;this.document={filename:file};this.zoom_to_board();this.draw();},
  setWorksheetVisible(on){this.paperVisible=on;},zoom_to_board(){calls.board++;camera.bbox={x:92,y:192,w:16,h:16};},zoom_to_page(){calls.page++;camera.bbox={x:0,y:0,w:297,h:210};}};
 for(const name of ['focusLayer','restoreLayers','layerPreset'])canvas[name]=function(...args){if(name==='focusLayer'){if(!this.layerSnapshot)this.layerSnapshot=new Set(this.visibleLayers);this.focusedLayer=args[0];this.layerFocusMode=args[1];this.visibleLayers.add(args[0]);}else if(name==='layerPreset'){if(!this.layerSnapshot)this.layerSnapshot=new Set(this.visibleLayers);this.focusedLayer=null;this.visibleLayers=new Set(this.design.layers);}else{if(this.layerSnapshot)this.visibleLayers=new Set(this.layerSnapshot);this.layerSnapshot=null;this.focusedLayer=null;}};
 const initialFile=options.file||(options.pcb?'board.kicad_pcb':'root.kicad_sch');
 const context={Map,AbortController,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);if(ms>100)timer.unref();return timer;},clearTimeout,URL,URLSearchParams,console,location:{search:'?repository=wayri/board&ref=main&file='+initialFile+query},parent,
  document:{getElementById:get,body:new Element(),createElement:()=>new Element(),createElementNS:()=>new Element(),head:new Element()},
  chrome:{runtime:{getURL:name=>'chrome-extension://ours/'+name,sendMessage:async message=>{(calls.requests||=[]).push(message);if(message.type==='project'&&options.projectReply)return options.projectReply(message);if(message.type==='revision-resolve')return{ok:true,result:{sha:'a'.repeat(40)}};if(message.type==='repo-model-index')return{ok:true,result:options.modelIndex||{paths:[]}};if(message.type==='repo-asset'){(calls.assetRequests||=[]).push(message);return{ok:true,result:{base64:'AAAA'}};}return{ok:true,result:[{path:initialFile,content:options.pcb?'(kicad_pcb)':'(kicad_sch)'},...extraFiles]};}}},
  KiCadPairedReview:require('../paired-review.js'),KiCadOverviewConnectivity:require('../overview-connectivity.js'),KiCadReviewTools:require('../review-tools.js'),KiCadWorksheet:require('../worksheet.js'),KiCadBrowserData:require('../browser-data.js'),KiCadDesignModel:require('../design-model.js'),KiCadDesignDiff:require('../design-diff.js'),KiCadViewState:viewState,
  KiCadSchematicRenderer:{build:(_ast,file,metadata)=>{(calls.schematicBuilds||=[]).push({file,metadata});return {primitives:[],layers:[],page:{width:297,height:210},warnings:[]};}},
  KiCadPCBRenderer:{build:()=>({primitives:[],layers:options.layers||[],page:{width:297,height:210},warnings:[]})},
  SpikeBoard3D:{mountBoard3D(_pane,_source,config){calls.modelOptions=config;return{createProbeViewport(holder,config){calls.probeOptions=config;return{setSelection(){},dispose(){}};},getProbeCount(){return calls.activeProbes||0;},dispose(){calls.sceneDisposed=(calls.sceneDisposed||0)+1;},setTheme(){},setTerminalLabels(visible){calls.terminalLabels=visible;}};}},
  KiCadOwnedCanvas:{mount:()=>canvas},KiCadReviewWorkspace:{sheetOverviewEntries:require('../review-workspace.js').sheetOverviewEntries,composeSheetOverview:require('../review-workspace.js').composeSheetOverview,sheetPageHighlights:require('../review-workspace.js').sheetPageHighlights,mount:options=>{calls.workspaceOptions=options;return {draw(){},setScene(){},attachCanvas(){calls.attach++;},dispose(){calls.disposed++;},highlightRelated(selection){calls.related=selection;options.onSelection?.(selection);},refreshComments(){calls.refreshed=(calls.refreshed||0)+1;},options};}},
  addEventListener:(type,callback)=>listeners.set(type,callback)};
 if(options.realRender){context.KiCadNetModel=require('../net-model.js');context.KiCadPCBRenderer=require('../pcb-renderer.js');context.KiCadSchematicRenderer=require('../schematic-renderer.js');}
 if(options.android){context.KiCadNetModel=require('../net-model.js');context.KiCadAndroidUI={};context.setTimeout=(fn,ms)=>{const timer=setTimeout(fn,ms);if(ms>100)timer.unref();return timer;};context.requestAnimationFrame=fn=>setTimeout(fn,0);context.cancelAnimationFrame=clearTimeout;context.IntersectionObserver=class{constructor(callback){this.callback=callback;calls.overviewObserver=this;this.observed=[];}observe(node){this.observed.push(node);}disconnect(){this.observed=[];}};const mount=context.KiCadReviewWorkspace.mount;context.KiCadReviewWorkspace.mount=opts=>({...mount(opts),overviewSheets:()=>[{sheet:{path:initialFile,label:'Root'},depth:0},...extraFiles.map(file=>({sheet:{path:file.path,label:'Power supply'},depth:1}))],overviewSelection:path=>options.overviewSelection?.(path)||({netIds:[],uuids:[],mode:'dim'})});}
 if(options.worker)context.KiCadLoading={indicator:(_host,config)=>{calls.stopLoading=config.onStop;return{show(){},hide(){},dispose(){}};},paint:async()=>{},run:async(_job,payload,prepare)=>{calls.workerPayload=payload;return {...prepare(),design:context.KiCadSchematicRenderer.build()};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../revision-viewer.js'),'utf8'),context);await tick();
 return{canvas,camera,calls,get,reports,parent,context,viewframe(){canvasListeners.get('kicad:viewframe')();},message(data,source=parent,origin='chrome-extension://ours'){listeners.get('message')({source,origin,data});},key(key,nodes=[],modifiers={}){let prevented=false;listeners.get('keydown')({key,composedPath:()=>nodes,preventDefault(){prevented=true;},...modifiers});return prevented;},hide(){listeners.get('pagehide')();}};
}

test('GPU gesture frames update viewport status and camera reports; Canvas2D-only mode is selectable',async()=>{
 const v=await revision();v.canvas.motionActive=true;v.camera.center.x+=10;v.viewframe();assert.equal(v.get('drawingHost').dataset.renderBackend,'webgl-motion');assert.equal(v.get('renderMode').textContent,'2D \u00b7 WebGL');assert.equal(v.reports.at(-1).data.view.x,v.camera.center.x);
 v.get('acceleration').value='off';v.get('acceleration').onchange();assert.equal(v.canvas.acceleration,'off');
 v.canvas.motionActive=false;v.canvas.draw();assert.equal(v.get('drawingHost').dataset.renderBackend,'canvas2d');assert.equal(v.get('renderMode').textContent,'2D');
});
test('owned dedicated viewer mounts fetched designs and accepts only trusted parent commands',async()=>{
 const v=await revision();assert.equal(v.canvas.document.filename,'root.kicad_sch');assert.equal(v.calls.attach,2);
 v.message({type:'kicad-review:command',command:'fit-page'});assert.equal(v.calls.page,1);
 v.message({type:'kicad-review:command',command:'focus',position:{x:50,y:70}});assert.equal(v.camera.center.x,50);assert.equal(v.camera.center.y,70);
 const before=v.calls.draw;v.message({type:'kicad-review:command',command:'fit-page'},{},'chrome-extension://ours');v.message({type:'kicad-review:command',command:'fit-page'},v.parent,'https://github.com');assert.equal(v.calls.draw,before);
});
test('opening a child sheet initially prepares and displays its unambiguous scattered-folder root', async () => {
 const root={path:'design/main.kicad_sch',content:'(kicad_sch (sheet (property "Sheetfile" "../shared/child.kicad_sch")))'};
 const v=await revision('',[root],{file:'shared/child.kicad_sch',worker:true});
 assert.equal(v.canvas.document.filename,root.path);assert.equal(v.calls.workspaceOptions.rootFile,root.path);
 assert.equal(v.calls.workerPayload.rootFile,root.path);
 assert.equal(v.reports[0].data.file,root.path);
 v.calls.workspaceOptions.openSheet('shared/child.kicad_sch');assert.equal(v.canvas.document.filename,'shared/child.kicad_sch');
});
test('ambiguous schematic roots preserve the requested sheet with a visible diagnostic', async () => {
 const parents=['first/root.kicad_sch','second/root.kicad_sch'].map(path=>({path,content:'(kicad_sch (sheet (property "Sheetfile" "../shared/child.kicad_sch")))'}));
 const v=await revision('',parents,{file:'shared/child.kicad_sch'});
 assert.equal(v.canvas.document.filename,'shared/child.kicad_sch');
 assert.match(v.calls.workspaceOptions.files[0].discoveryWarning,/no unambiguous root/);
});
test('saved change focus opens the requested child while hierarchy home retains its actual root', async () => {
 const root={path:'design/main.kicad_sch',content:'(kicad_sch (sheet (property "Sheetfile" "../shared/child.kicad_sch")))'};
 const v=await revision('&focusX=250&focusY=300',[root],{file:'shared/child.kicad_sch',worker:true});
 assert.equal(v.canvas.document.filename,'shared/child.kicad_sch');assert.equal(v.calls.workspaceOptions.rootFile,root.path);
 assert.equal(v.calls.workerPayload.rootFile,'shared/child.kicad_sch');
 assert.equal(v.camera.center.x,250);assert.equal(v.camera.center.y,300);
 const invalid=await revision('&focusX=Infinity&focusY=300',[root],{file:'shared/child.kicad_sch'});
 assert.equal(invalid.canvas.document.filename,root.path);
});
test('focus rejects nonfinite, excessive and nonnumeric positions',async()=>{const v=await revision();const before=plain(v.camera.bbox);for(const position of [{x:NaN,y:2},{x:1000001,y:1},{x:'50',y:70},{x:1}])v.message({type:'kicad-review:command',command:'focus',position});assert.deepEqual(plain(v.camera.bbox),before);});
test('keyboard shortcuts ignore editable paths and modifiers',async()=>{const v=await revision();for(const key of ['f','Home','t','+']){assert.equal(v.key(key,[{tagName:'INPUT'}]),false);assert.equal(v.key(key,[{isContentEditable:true}]),false);assert.equal(v.key(key,[],{ctrlKey:true}),false);}assert.equal(v.key('Home'),true);assert.equal(v.calls.page,1);assert.equal(v.key('t'),true);assert.equal(v.canvas.dark,true);});
test('initial focus uses owned camera once project is available',async()=>{const v=await revision('&focusX=250&focusY=300');assert.equal(v.camera.center.x,250);assert.equal(v.camera.center.y,300);});
test('linked camera messages do not echo and cannot cross sheets',async()=>{
 const v=await revision();assert.equal(v.reports[0].data.phase,'ready');v.camera.center.set(150,180);v.camera.zoom=3.5;v.canvas.draw();assert.deepEqual(plain(v.reports.at(-1).data.view),{x:150,y:180,zoom:3.5,flipped:false,quarterTurns:0});
 const count=v.reports.length;v.canvas.draw();assert.equal(v.reports.length,count);
 v.message({type:'kicad-review:command',command:'set-view',file:'root.kicad_sch',view:{x:400,y:500,zoom:2}});assert.equal(v.camera.center.x,400);assert.equal(v.reports.length,count);
 v.message({type:'kicad-review:command',command:'set-view',file:'other.kicad_sch',view:{x:1,y:2,zoom:4}});assert.equal(v.camera.center.x,400);
 v.message({type:'kicad-review:command',command:'set-view',file:'root.kicad_sch',view:{x:1,y:2,zoom:Infinity}});assert.equal(v.camera.zoom,2);
});
test('active sheet identity is used in reports and received view filtering',async()=>{const v=await revision();v.canvas.document.filename='child.kicad_sch';v.key('f');assert.equal(v.reports.at(-1).data.file,'child.kicad_sch');assert.equal(v.reports.at(-1).data.phase,'ready');});
test('trusted workspace theme command sets both preferences and rejects malformed or foreign messages',async()=>{
 const v=await revision();v.message({type:'kicad-review:command',command:'set-theme',theme:'dark'});assert.equal(v.canvas.dark,true);assert.equal(v.context.document.body.dataset.uiTheme,'dark');
 for(const [theme,source,origin]of [['light',{},'chrome-extension://ours'],['light',v.parent,'https://github.com'],['system',v.parent,'chrome-extension://ours']])v.message({type:'kicad-review:command',command:'set-theme',theme},source,origin);
 assert.equal(v.canvas.dark,true);assert.equal(v.context.document.body.dataset.uiTheme,'dark');v.message({type:'kicad-review:command',command:'set-theme',theme:'light'});assert.equal(v.canvas.dark,false);assert.equal(v.context.document.body.dataset.uiTheme,'light');
});
test('zoom limits keep the camera finite and pagehide disposes owned UI resources',async()=>{const v=await revision();const center=plain(v.camera.center);v.get('zoomIn').click();assert.equal(v.camera.center.x,center.x);v.camera.zoom=9999;v.key('+');assert.equal(v.camera.zoom,10000);v.camera.zoom=.0011;v.key('-');assert.equal(v.camera.zoom,.001);v.hide();assert.equal(v.calls.disposed,2);});

 test('independent UI and drawing themes and ruler units persist through controls',async()=>{const v=await revision();v.get('uiTheme').value='dark';v.get('uiTheme').onchange();assert.equal(v.context.document.body.dataset.uiTheme,'dark');assert.equal(v.canvas.dark,false);v.get('drawingTheme').value='dark';v.get('drawingTheme').onchange();assert.equal(v.canvas.dark,true);v.get('rulerUnits').value='mil';v.get('rulerUnits').onchange();assert.equal(v.get('rulerUnits').value,'mil');});
 test('canvas theme shortcut preserves interface theme and explicit presets choose native canvas by drawing type',async()=>{const v=await revision();v.get('uiTheme').value='dark';v.get('uiTheme').onchange();v.key('t');assert.equal(v.context.document.body.dataset.uiTheme,'dark');assert.equal(v.canvas.dark,true);v.get('displayPreset').value='kicad';v.get('displayPreset').onchange();assert.equal(v.context.document.body.dataset.uiTheme,'light');assert.equal(v.canvas.dark,false);const board=await revision('',[],{pcb:true});board.get('displayPreset').value='kicad';board.get('displayPreset').onchange();assert.equal(board.context.document.body.dataset.uiTheme,'light');assert.equal(board.canvas.dark,true);});
 test('review page setup builds portrait worksheet and restores source page',async()=>{const v=await revision();v.get('settingsButton').click();v.get('pageFormat').value='A3';v.get('pagePortrait').checked=true;v.get('pageTitle').value='Review';v.get('applyPage').click();assert.equal(v.canvas.design.page.width,297);assert.equal(v.canvas.design.page.height,420);assert.equal(v.canvas.design.page.titleBlock.title,'Review');assert.ok(v.canvas.design.primitives.some(p=>p.frame));v.get('resetPage').click();assert.equal(v.canvas.design.page.height,210);});

test('paired selection relay validates parent and suppresses cross-highlight echoes',async()=>{
 const v=await revision(),selection={kind:'part',path:'board.kicad_pcb',reference:'R1'};
 v.calls.workspaceOptions.onSelection(selection);
 assert.equal(v.reports.at(-1).data.type,'kicad-review:selection');
 const count=v.reports.length;
 v.message({type:'kicad-review:command',command:'highlight-related',selection});
 assert.deepEqual(plain(v.calls.related),selection);assert.equal(v.reports.length,count);
 v.calls.related=null;
 v.message({type:'kicad-review:command',command:'highlight-related',selection},{},'chrome-extension://ours');
 v.message({type:'kicad-review:command',command:'highlight-related',selection:{...selection,reference:'R1\n'}});
 assert.equal(v.calls.related,null);
 v.message({type:'kicad-review:command',command:'refresh-comments'});assert.equal(v.calls.refreshed,1);
});
test('3D inventory retains model paths, rejects unsafe paths, and passes diagnostics to the scene',async()=>{
 const v=await revision('',[],{pcb:true,modelIndex:{paths:['models/part.wrl','models/part.step','models/part.glb','board.kicad_pcb','../escape.wrl','/outside.wrl','models/../escape.wrl','https://elsewhere/part.wrl'],warnings:['Inventory truncated']}});
 await v.get('mode3d').click();
 assert.deepEqual(plain(v.calls.modelOptions.assetPaths),['models/part.wrl','models/part.step','models/part.glb']);
 assert.deepEqual(plain(v.calls.modelOptions.assetWarnings),['Inventory truncated']);
 assert.equal(v.calls.requests.find(m=>m.type==='repo-model-index').file,'board.kicad_pcb');
});

test('3D mode reuses successful model assets across toggles and clears them on pagehide',async()=>{
 const v=await revision('',[],{pcb:true});await v.get('mode3d').click();
 await v.calls.modelOptions.loadAsset('models/part.wrl');
 await v.get('mode3d').click();await v.get('mode3d').click();
 await v.calls.modelOptions.loadAsset('models/part.wrl');assert.equal(v.calls.assetRequests.length,1);
 assert.equal(v.calls.assetRequests[0].repository,'wayri/board');assert.equal(v.calls.assetRequests[0].ref,'a'.repeat(40));assert.equal(v.calls.assetRequests[0].file,'models/part.wrl');
 v.hide();await v.calls.modelOptions.loadAsset('models/part.wrl');assert.equal(v.calls.assetRequests.length,2);
});

test('view settings exposes expanded state and Escape closes it without changing the drawing',async()=>{const v=await revision();v.get('settingsButton').click();assert.equal(v.get('viewerSettings').hidden,false);assert.equal(v.get('settingsButton').attributes['aria-expanded'],'true');assert.equal(v.key('Escape'),true);assert.equal(v.get('viewerSettings').hidden,true);assert.equal(v.get('settingsButton').attributes['aria-expanded'],'false');assert.equal(v.canvas.design.page.width,297);});

test('remote viewer pins branch before loading drawings and passes the same commit to review tools',async()=>{
 const v=await revision();assert.equal(v.calls.requests[0].type,'revision-resolve');assert.equal(v.calls.requests.find(m=>m.type==='project').ref,'a'.repeat(40));assert.equal(v.calls.workspaceOptions.ref,'a'.repeat(40));
});

test('floating layer selector highlights with visible context, optionally isolates and restores the previous view',async()=>{
 const v=await revision('',[],{pcb:true,layers:['F.Cu','In1.Cu','In2.Cu','B.Cu','Edge.Cuts']});
 const bar=v.get('drawingHost').children.find(child=>child.id==='floatingLayerSelector');
 assert.ok(bar);assert.equal(bar.hidden,false);const toggle=bar.children[0],mode=bar.children[1].children[0],buttons=bar.children[1].children.slice(1);assert.equal(toggle.attributes['aria-expanded'],'false');toggle.click();assert.equal(toggle.attributes['aria-expanded'],'true');assert.deepEqual(buttons.map(button=>button.dataset.layer),['F.Cu','In1.Cu','In2.Cu','B.Cu','All','Overview','Filled copper','Zone outlines','Worksheet','Numbers','Net names']);
 v.canvas.visibleLayers=new Set(['F.Cu','Edge.Cuts']);
 buttons[1].click();assert.equal(toggle.attributes['aria-expanded'],'false');assert.equal(toggle.textContent,'In1.Cu');assert.equal(v.canvas.focusedLayer,'In1.Cu');assert.equal(v.canvas.layerFocusMode,'dim');assert.equal(buttons[1].attributes['aria-pressed'],'true');assert.ok(v.canvas.visibleLayers.has('F.Cu'));assert.equal(mode.value,'dim');mode.value='isolate';mode.onchange();assert.equal(v.canvas.layerFocusMode,'isolate');mode.value='dim';mode.onchange();assert.equal(v.canvas.layerFocusMode,'dim');
 buttons[4].click();assert.deepEqual([...v.canvas.visibleLayers],v.canvas.design.layers);assert.equal(v.canvas.focusedLayer,null);
 buttons[5].click();assert.deepEqual([...v.canvas.visibleLayers],['F.Cu','Edge.Cuts']);assert.equal(v.canvas.layerSnapshot,null);
 buttons[8].click();assert.equal(v.canvas.paperVisible,true);buttons[8].click();assert.equal(v.canvas.paperVisible,false);buttons.find(button=>button.dataset.layer==='Net names').click();assert.equal(v.canvas.showNetNames,true);assert.equal(v.get('showNetNames').checked,true);assert.equal(buttons.find(button=>button.dataset.layer==='Net names').attributes['aria-pressed'],'true');buttons.find(button=>button.dataset.layer==='Net names').click();assert.equal(v.canvas.showNetNames,false);
 await v.get('mode3d').click();assert.equal(bar.hidden,true);await v.get('mode3d').click();assert.equal(bar.hidden,false);
 const schematic=await revision();assert.equal(schematic.get('drawingHost').children.some(child=>child.id==='floatingLayerSelector'),false);
});


test('sheet tree floats below the drawing, minimizes, closes, reopens from settings and focuses a page',async()=>{
 const v=await revision('',[{path:'sub/power.kicad_sch',content:'(kicad_sch)'}],{android:true});
 const miniature=v.get('drawingHost').children.find(node=>node.className==='sheet-tree-miniature'),heading=miniature.children[0],body=miniature.children[1];
 assert.equal(miniature.hidden,false);assert.equal(heading.children[1].attributes['aria-expanded'],'true');
 heading.children[1].click();assert.equal(body.hidden,true);heading.children[1].click();assert.equal(body.hidden,false);
 heading.children.find(n=>n.attributes['aria-label']==='Close sheet tree').click();assert.equal(miniature.hidden,true);
 v.get('viewerSettings').children.find(node=>node.id==='showSheetTree').click();assert.equal(miniature.hidden,false);assert.equal(body.hidden,false);assert.equal(v.get('viewerSettings').hidden,true);
 await v.context.KiCadSheetOverview.open();
 const svg=body.children[0],node=svg.children.find(node=>node.attributes.role==='button'&&node.attributes['aria-label']==='Go to Power supply');
 assert.equal(svg.attributes.width,'100%');assert.ok(Number(svg.attributes.height)<=160);assert.ok(svg.children.some(child=>child.tagName==='defs'||child.children?.some(item=>item.attributes.id==='sheetTreeArrow')),'directional miniature arrow definition');
 assert.ok(node);const before={...v.camera.bbox};node.click();assert.notDeepEqual(v.camera.bbox,before);assert.equal(v.context.KiCadSheetOverview.isOpen(),true);
 v.context.KiCadSheetOverview.close();
});
test('Android all-sheet overview composes every loaded page on a single canvas',async()=>{
 const v=await revision('',[{path:'sub/power.kicad_sch',content:'(kicad_sch)'}],{android:true});
 await v.context.KiCadSheetOverview.open();
 assert.equal(v.context.KiCadSheetOverview.isOpen(),true);
 assert.deepEqual(v.canvas.design.primitives.filter(p=>p.type==='text').map(p=>p.text),['Root','Power supply']);
 assert.equal(v.canvas.document.filename,'all-sheets');
 v.context.KiCadSheetOverview.close();assert.equal(v.context.KiCadSheetOverview.isOpen(),false);
 const desktop=await revision();assert.equal(typeof desktop.context.KiCadSheetOverview.open,'function');
});

test('Android shared overview filters matching sheets then restores all pages',async()=>{
 let active=true;
 const v=await revision('',[{path:'sub/power.kicad_sch',content:'(kicad_sch)'},{path:'other.kicad_sch',content:'(kicad_sch)'}],{android:true,overviewSelection:path=>({netActive:active,netIds:active&&path!=='other.kicad_sch'?['VCC']:[],uuids:[],mode:'dim'})});
 await v.context.KiCadSheetOverview.open();
 assert.equal(v.canvas.design.primitives.filter(p=>p.type==='text').length,2);
 active=false;await v.context.KiCadSheetOverview.refresh();
 assert.equal(v.canvas.design.primitives.filter(p=>p.type==='text').length,3);
 v.context.KiCadSheetOverview.close();
});

test('all-sheets Unselect and Clear highlights clear local picks and delegate to shared actions',async()=>{
 const v=await revision('',[],{android:true});await v.context.KiCadSheetOverview.open();
 const heading=v.get('drawingHost').children.find(node=>node.id==='sheetOverview').children[0];
 for(const [label,id]of [['Unselect','unselect'],['Clear highlights','clearHighlights']]){
  let invoked=0;v.get(id).onclick=()=>invoked++;v.canvas.selected={uuid:'wire'};
  const action=heading.children.find(node=>node.textContent===label);assert.ok(action);assert.equal(action.hidden,false);action.click();
  assert.equal(invoked,1);assert.equal(v.canvas.selected,null);
 }
 v.context.KiCadSheetOverview.dispose();
 assert.equal(v.get('unselect').listeners.get('click').size,0);assert.equal(v.get('clearHighlights').listeners.get('click').size,0);
});


test('unchanged drawing frames do not rewrite status labels or copper controls',async()=>{
 const v=await revision('',[],{pcb:true,layers:['F.Cu','B.Cu']});v.viewframe();
 let writes=0;for(const id of ['renderMode','accelerationStatus','viewScale','drawingViewLabel']){const node=v.get(id);let value=node.textContent;Object.defineProperty(node,'textContent',{get:()=>value,set:next=>{writes++;value=next;}});}
 for(let i=0;i<100;i++)v.viewframe();assert.equal(writes,0);
 v.camera.zoom*=2;v.viewframe();assert.equal(writes,1);assert.equal(v.get('viewScale').textContent,Math.round(v.camera.zoom/4*100)+'%');
});
test('Stop during drawing fetch sends scoped cancellation and blocks late viewer activation',async()=>{
 let complete;const view=await revision('',[],{worker:true,projectReply:()=>new Promise(resolve=>complete=resolve)});const initial=view.calls.requests.find(r=>r.type==='project');assert.ok(initial.loadId);view.calls.stopLoading();await tick();assert.match(view.get('status').textContent,/Loading stopped/);assert.equal(view.calls.attach,0);assert.equal(view.calls.requests.find(r=>r.type==='load-cancel').loadId,initial.loadId);
 complete({ok:true,result:[{path:'root.kicad_sch',content:'(kicad_sch)'}]});await tick();assert.equal(view.calls.attach,0);assert.equal(view.get('status').children.at(-1).textContent,'Retry loading');
});


test('handled PCB flip does not also fit and repeated or composing keys leave the camera alone',async()=>{
 const v=await revision('',[],{pcb:true}),before=v.calls.board;
 for(const extra of [{defaultPrevented:true},{repeat:true},{isComposing:true}])assert.equal(v.key('f',[],extra),false);
 assert.equal(v.calls.board,before);assert.equal(v.key('F',[],{shiftKey:true}),true);assert.equal(v.calls.board,before+1);
});


test('pad and net-name preference is shared across 2D and the mounted 3D scene',async()=>{
 const v=await revision('',[],{pcb:true});v.get('showNetNames').checked=true;v.get('showNetNames').onchange();await v.get('mode3d').click();
 assert.equal(v.calls.modelOptions.showNetNames,true);
 v.calls.modelOptions.onTerminalLabelsChange(false);assert.equal(v.canvas.showNetNames,false);assert.equal(v.get('showNetNames').checked,false);assert.equal(v.calls.terminalLabels,false);
 v.get('showNetNames').checked=true;v.get('showNetNames').onchange();assert.equal(v.calls.terminalLabels,true);
});

// Exercise actual saved geometry through the workspace callbacks, not a fake resolver.
test('probe switching resolves saved component and terminal identity with cached geometry',async()=>{
 const pcb='(kicad_pcb (version 20241229) (layers (0 "F.Cu" signal)) (footprint "R" (layer "F.Cu") (at 10 20) (uuid fp) (path "/root/sym") (property "Reference" "R9") (pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu") (uuid pad1))))';
 const v=await revision('',[{path:'board.kicad_pcb',content:pcb}],{realRender:true});
 const resolve=v.calls.workspaceOptions.resolveProbeViews;
 const first=await resolve(null,{canonical:{kind:'part',path:'root.kicad_sch',reference:'R1',uuid:'sym'}},'layout');
 assert.equal(first.entry.path,'board.kicad_pcb');assert.equal(first.group.name,'R9');assert.ok(first.group.primitives.length);
 const pin=await resolve(null,{canonical:{kind:'pin',path:'root.kicad_sch',reference:'R1',ownerUuid:'sym',pinNumber:'1'}},'3d');
 assert.equal(pin.entry.design,first.entry.design);assert.ok(pin.group.primitives.every(p=>String(p.pinNumber??p.name)==='1'));
 assert.equal(v.calls.requests.filter(r=>r.type==='project').length,1);
 await assert.rejects(resolve(null,{canonical:{kind:'pin',path:'root.kicad_sch',reference:'R1',ownerUuid:'sym',pinNumber:'999'}},'layout'),/no rendered geometry/);
 await assert.rejects(resolve(null,null,'layout'),/Select a saved/);
 v.hide();await assert.rejects(resolve(null,{canonical:{kind:'part',path:'root.kicad_sch',reference:'R1',uuid:'sym'}},'layout'),/closed/);
});

test('switching the main view to2D retains its active3Dprobe parent until workspace close',async()=>{
 const v=await revision('',[],{pcb:true});await v.get('mode3d').click();const config=v.calls.modelOptions;v.calls.activeProbes=1;
 await v.get('mode3d').click();assert.equal(v.calls.sceneDisposed||0,0);assert.equal(v.get('threePane').hidden,true);
 await v.get('mode3d').click();assert.equal(v.calls.modelOptions,config);assert.equal(v.get('threePane').hidden,false);
 v.hide();assert.equal(v.calls.sceneDisposed,1);
});


test('pin and pad numbers toggle independently of net names and persist through the 3D API',async()=>{
 const v=await revision('',[],{pcb:true});assert.equal(v.canvas.showTerminalNumbers,true);assert.equal(v.canvas.showNetNames,false);
 v.get('showTerminalNumbers').checked=false;v.get('showTerminalNumbers').onchange();assert.equal(v.canvas.showTerminalNumbers,false);assert.equal(v.canvas.showNetNames,false);
 v.get('showNetNames').checked=true;v.get('showNetNames').onchange();await v.get('mode3d').click();assert.equal(v.calls.modelOptions.showTerminalNumbers,false);assert.equal(v.calls.modelOptions.showNetNames,true);
 v.calls.modelOptions.onTerminalNumbersChange(true);assert.equal(v.canvas.showTerminalNumbers,true);assert.equal(v.canvas.showNetNames,true);assert.equal(v.get('showTerminalNumbers').checked,true);
 v.get('frameControls').children.find(button=>button.id==='terminalNumbersButton').click();assert.equal(v.canvas.showTerminalNumbers,false);assert.equal(v.canvas.showNetNames,true);
 const schematic=await revision();assert.equal(schematic.canvas.showTerminalNumbers,true);schematic.get('frameControls').children.find(button=>button.id==='terminalNumbersButton').click();assert.equal(schematic.canvas.showTerminalNumbers,false);
});


test('all dedicated viewer templates expose independent number and net controls',()=>{
 for(const name of ['schematic-viewer.html','pcb-viewer.html','revision-viewer.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',name),'utf8');assert.equal((html.match(/id="showTerminalNumbers"/g)||[]).length,1,name);assert.equal((html.match(/id="showNetNames"/g)||[]).length,1,name);
 }
});


test('3D probe camera changes reach the floating guide refresh callback',async()=>{
 const v=await revision('',[],{pcb:true});await v.get('mode3d').click();let refreshed=0;const onViewChange=()=>refreshed++;
 await v.calls.workspaceOptions.mountProbe3D({}, {entry:{path:'board.kicad_pcb'},group:{kind:'part',name:'R1',primitives:[]},onSelect(){},onViewChange});
 assert.equal(v.calls.probeOptions.onViewChange,onViewChange);v.calls.probeOptions.onViewChange();assert.equal(refreshed,1);v.hide();
});


test('legacy subsheet rendering retains sheet count, saved root and suffix-free sheet name',async()=>{
 const source='EESchema Schematic File Version 2\n$Sheet\nS 100 100 200 200\nU 1234ABCD\nF0 "Power" 60\nF1 "power.sch" 60\n$EndSheet\n$EndSCHEMATC\n',child={path:'hw/power.sch',content:'EESchema Schematic File Version 2\n$EndSCHEMATC\n'};
 const v=await revision('',[],{file:'hw/vna2.sch',projectReply:()=>({ok:true,result:[{path:'hw/vna2.sch',content:source},child]})});assert.equal(v.calls.workspaceOptions.rootFile,'hw/vna2.sch');v.calls.workspaceOptions.openSheet('hw/power.sch');assert.equal(v.canvas.document.filename,'hw/power.sch');const built=v.calls.schematicBuilds.find(call=>call.file==='hw/power.sch');assert.equal(built.metadata.sheetCount,2);assert.equal(built.metadata.sheetNumber,2);assert.equal(built.metadata.sheetName,'/power/');v.hide();
});


test('popup sheet navigation uses saved connectivity and repeated placements without changing the main drawing',async()=>{
 const root='(kicad_sch (uuid root) (global_label "VCC" (uuid supply-label) (at 10 10 0) (shape input) (effects (font (size 1 1)))) (sheet (at 30 30) (size 10 10) (uuid a) (property "Sheetname" "Channel A") (property "Sheetfile" "child.kicad_sch")) (sheet (at 50 30) (size 10 10) (uuid b) (property "Sheetname" "Channel B") (property "Sheetfile" "child.kicad_sch")) (sheet (at 70 30) (size 10 10) (uuid c) (property "Sheetname" "Unconnected") (property "Sheetfile" "other.kicad_sch")))';
 const files=[{path:'root.kicad_sch',content:root},{path:'child.kicad_sch',content:'(kicad_sch (uuid child) (global_label "VCC" (uuid supply-label) (at 10 10 0) (shape input) (effects (font (size 1 1)))))'},{path:'other.kicad_sch',content:'(kicad_sch (uuid other) (label "VCC" (uuid isolated-label) (at 10 10 0) (effects (font (size 1 1)))))'}];
 const v=await revision('',[],{realRender:true,projectReply:()=>({ok:true,result:files})}),before={camera:plain(v.camera.center),draw:v.calls.draw,requests:v.calls.requests.length},get=v.calls.workspaceOptions.getSchematicProbeRows;
 const result=await get({entry:{path:'root.kicad_sch'}},{canonical:{kind:'net',path:'root.kicad_sch',netName:'VCC'}});
 assert.equal(result.sheets.length,4);assert.equal(result.occurrences.length,3);assert.equal(new Set(result.occurrences.map(r=>r.id)).size,3);assert.ok(result.occurrences.some(r=>r.label.includes('Channel A')));assert.ok(result.occurrences.some(r=>r.label.includes('Channel B')));assert.equal(result.sheets.find(r=>r.entry.path==='other.kicad_sch').group.primitives.length,0);
 assert.deepEqual(plain(v.camera.center),before.camera);assert.equal(v.calls.draw,before.draw);assert.equal(v.calls.requests.length,before.requests);
 const repeat=await get(result.occurrences[0],result.occurrences[0].selection);assert.equal(repeat.sheets[0].entry.design,result.sheets[0].entry.design);assert.equal(v.calls.requests.length,before.requests);
 v.hide();await assert.rejects(get(null,{canonical:{kind:'net',path:'root.kicad_sch',netName:'VCC'}}),/closed/);
});

test('component popup occurrences retain the explicitly selected reused-sheet instance',async()=>{
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (uuid root) (sheet (uuid a) (at 10 10) (size 5 5) (property "Sheetname" "A") (property "Sheetfile" "child.kicad_sch")) (sheet (uuid b) (at 20 10) (size 5 5) (property "Sheetname" "B") (property "Sheetfile" "child.kicad_sch")))'},
 {path:'child.kicad_sch',content:'(kicad_sch (uuid child) (lib_symbols (symbol "Device:R" (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2) (stroke (width .2)) (fill (type none)))))) (symbol (lib_id "Device:R") (at 10 10) (uuid sym) (property "Reference" "R1") (instances (project "Demo" (path "/root/a" (reference "R1") (unit 1)) (path "/root/b" (reference "R1") (unit 1))))))'}];
 const v=await revision('',[],{realRender:true,projectReply:()=>({ok:true,result:files})}),selection={canonical:{kind:'part',path:'board.kicad_pcb',reference:'R1',symbolUuid:'sym',tstampPath:'/root/a/sym'}};
 const rows=await v.calls.workspaceOptions.getSchematicProbeRows(null,selection);assert.equal(rows.sheets.length,3);assert.equal(rows.occurrences.length,1);assert.ok(rows.occurrences[0].label.endsWith('A'));const resolved=await v.calls.workspaceOptions.resolveProbeViews(null,selection,'schematic');assert.equal(resolved.selection.canonical.tstampPath,'/root/a/sym');v.hide();
});

test('schematic-origin 3D probe requests the target board model inventory',async()=>{
 const v=await revision('',[{path:'hw/board.kicad_pcb',content:'(kicad_pcb)'}]);
 await v.calls.workspaceOptions.mountProbe3D({}, {entry:{path:'hw/board.kicad_pcb'},group:{kind:'part',name:'R1',primitives:[]},onSelect(){},onViewChange(){}});
 assert.equal(v.calls.requests.find(m=>m.type==='repo-model-index').file,'hw/board.kicad_pcb');v.hide();
});

test('a newly selected unnamed schematic net opens the correct layout/3D probe and maps back by saved terminals',async()=>{
 const schematic={path:'root.kicad_sch',content:fs.readFileSync(path.join(__dirname,'fixtures/kicad8/custom_fields.kicad_sch'),'utf8')},model=require('../design-model.js').buildProject([schematic]),resistor=model.objects.find(o=>o.reference==='R1'),connector=model.objects.find(o=>o.reference==='J1');
 const footprint=(o,x)=>`(footprint "test" (layer "F.Cu") (at ${x} 10) (uuid fp-${o.reference}) (path "/${o.uuid}") (property "Reference" "${o.reference}") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid pad-${o.reference}-1) (net 1 "NET_ONE")) (pad "2" smd rect (at 0 2) (size 1 1) (layers "F.Cu") (uuid pad-${o.reference}-2) (net 2 "NET_TWO")))`;
 const board={path:'board.kicad_pcb',content:`(kicad_pcb (version 20241229) (layers (0 "F.Cu" signal)) (net 1 "NET_ONE") (net 2 "NET_TWO") ${footprint(resistor,10)} ${footprint(connector,20)})`};
 const v=await revision('',[],{realRender:true,projectReply:()=>({ok:true,result:[schematic,board]})}),design=require('../schematic-renderer.js').build(require('../design-diff.js').parse(schematic.content),schematic.path),nets=require('../net-model.js').build([schematic],new Map([[schematic.path,design]])).nets,net=nets.find(n=>n.members.some(m=>m.reference==='R1'&&m.pin==='2'));
 const selection={kind:'net',net,group:net,primitives:net.primitives,canonical:{kind:'net',path:schematic.path,netName:net.name}},row={entry:{path:schematic.path,objects:model.objects},group:net};
 const layout=await v.calls.workspaceOptions.resolveProbeViews(row,selection,'layout');assert.equal(layout.group.name,'NET_TWO');
 const three=await v.calls.workspaceOptions.resolveProbeViews(row,selection,'3d');assert.equal(three.group.name,'NET_TWO');
 const occurrences=await v.calls.workspaceOptions.getSchematicProbeRows(layout,layout.selection);assert.equal(occurrences.occurrences.length,1);
 const back=await v.calls.workspaceOptions.resolveProbeViews(layout,layout.selection,'schematic');assert.ok(back.group.members.some(m=>m.reference==='R1'&&m.pin==='2'));assert.ok(!back.group.members.some(m=>m.reference==='R1'&&m.pin==='1'));
 const again=await v.calls.workspaceOptions.resolveProbeViews(back,back.selection,'schematic');assert.equal(again.group.id,back.group.id);v.hide();
});

test('maximized sheet tree restores its size, survives minimize/reopen and retains the drawing camera',async()=>{
 const v=await revision('',[{path:'sub/power.kicad_sch',content:'(kicad_sch)'}],{android:true});
 const tree=v.get('drawingHost').children.find(n=>n.className==='sheet-tree-miniature'),[heading,body]=tree.children;
 const control=label=>heading.children.find(n=>n.attributes['aria-label']===label),svg=body.children[0],before={...v.camera.bbox},draws=v.calls.draw;
 control('Maximize sheet tree').click();assert.equal(tree.classList.contains('maximized'),true);assert.equal(body.hidden,false);assert.equal(control('Restore sheet tree size').attributes['aria-pressed'],'true');assert.equal(body.children[0],svg);assert.deepEqual(v.camera.bbox,before);assert.equal(v.calls.draw,draws);
 control('Minimize sheet tree').click();assert.equal(body.hidden,true);assert.equal(tree.classList.contains('maximized'),false);control('Maximize sheet tree').click();assert.equal(body.hidden,false);assert.equal(tree.classList.contains('maximized'),true);
 control('Restore sheet tree size').click();assert.equal(tree.classList.contains('maximized'),false);assert.equal(control('Maximize sheet tree').attributes['aria-pressed'],'false');
 control('Maximize sheet tree').click();control('Close sheet tree').click();assert.equal(tree.hidden,true);v.get('viewerSettings').children.find(n=>n.id==='showSheetTree').click();assert.equal(tree.hidden,false);assert.equal(tree.classList.contains('maximized'),true);
 const second=await revision();assert.equal(second.get('drawingHost').children.find(n=>n.className==='sheet-tree-miniature').classList.contains('maximized'),false);v.hide();second.hide();
});
