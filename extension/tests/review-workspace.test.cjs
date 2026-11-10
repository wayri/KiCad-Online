const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveObject, measurement } = require('../review-workspace.js');
const objects = [
  { id: 'root-r1', path: 'root.kicad_sch', uuid: 'root-symbol', reference: 'R1' },
  { id: 'child-r1', path: 'power.kicad_sch', uuid: 'child-symbol', reference: 'R1' },
  { id: 'footprint', path: 'board.kicad_pcb', uuid: 'footprint-uuid', reference: 'R1' },
  { id: 'pad', path: 'board.kicad_pcb', uuid: 'pad-uuid', reference: 'R1', parentId: 'footprint' }
];
test('selection UUID and reference are scoped to the active drawing', () => {
  assert.equal(resolveObject(objects, 'power.kicad_sch', { uuid: 'root-symbol' }), null);
  assert.equal(resolveObject(objects, 'power.kicad_sch', { reference: 'R1' }).id, 'child-r1');
  assert.equal(resolveObject(objects, 'board.kicad_pcb', { ref: 'R1' }).id, 'footprint');
});
test('native pick resolves pad identity before its footprint ancestor', () => {
  assert.equal(resolveObject(objects, 'board.kicad_pcb', { uuid: 'pad-uuid', parent: { uuid: 'footprint-uuid' } }).id, 'pad');
  assert.equal(resolveObject(objects, 'board.kicad_pcb', { parent: { tstamp: 'footprint-uuid' } }).id, 'footprint');
});
test('ambiguous identity is never attached to an arbitrary part', () => {
  const duplicates = [...objects, { ...objects[2], id: 'duplicate' }];
  assert.equal(resolveObject(duplicates, 'board.kicad_pcb', { uuid: 'footprint-uuid', reference: 'R1' }), null);
  const cycle = {}; cycle.parent = cycle;
  assert.equal(resolveObject(objects, 'board.kicad_pcb', cycle), null);
});
test('measurement retains signed millimetre offsets and rejects invalid coordinates', () => {
  assert.deepEqual(measurement({x: 10, y: 20}, {x: 7, y: 24}), {dx: -3, dy: 4, distance: 5});
  assert.deepEqual(measurement({x: 0, y: 0}, {x: 0, y: 0}), {dx: 0, dy: 0, distance: 0});
  assert.equal(measurement({x: Infinity, y: 0}, {x: 0, y: 0}), null);
  assert.equal(measurement({x: '1', y: 0}, {x: 0, y: 0}), null);
});
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function workspaceRuntime(respond=async()=>[], hooks={}){
  const elements=new Map();
  class Element extends EventTarget{
    showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
    constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.hidden=false;this.value='';this.checked=false;this.style={setProperty(k,v){this[k]=v;}};this.text='';this.parentElement=null;this.classes=new Set();this.classList={toggle:(name,on)=>{const enabled=on??!this.classes.has(name);if(enabled)this.classes.add(name);else this.classes.delete(name);return enabled;},contains:name=>this.classes.has(name),remove:name=>this.classes.delete(name)};}
    set id(value){this.attributes.id=value;elements.set(value,this);}get id(){return this.attributes.id;}get className(){return this.attributes.class||'';}set className(value){this.attributes.class=value;this.classes=new Set(value.split(/\s+/));}
    set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(c=>c.textContent).join(' ');}
    append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.text='';this.children=[];this.append(...children);}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null;}
    insertBefore(child,reference){if(reference!=null&&!this.children.includes(reference))throw new Error('NotFoundError: reference is not a direct child');child.remove();child.parentElement=this;const index=this.children.indexOf(reference);if(reference==null)this.children.push(child);else this.children.splice(index,0,child);}
    insertAdjacentElement(position,child){if(position!=='afterend'||!this.parentElement)throw Error('Unsupported adjacent position');const parent=this.parentElement,index=parent.children.indexOf(this);child.remove();child.parentElement=parent;parent.children.splice(index+1,0,child);return child;}
    getAttribute(k){return this.attributes[k]??null;}
    setAttribute(k,v){this.attributes[k]=String(v);if(k==='id')this.id=v;if(k==='class')this.className=v;}matches(selector){return selector.startsWith('.')?this.classes.has(selector.slice(1)):selector.startsWith('#')?this.id===selector.slice(1):this.tagName.toLowerCase()===selector.split('.')[0]&&(!selector.includes('.')||this.classes.has(selector.split('.')[1]));}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}focus(){this.focused=true;}click(){return this.onclick?.();}getBoundingClientRect(){return{left:0,top:0,width:hooks.width||800,height:this.id==='reviewWorkspace'?(hooks.workspaceHeight||600):(hooks.frameHeight||600)};}
  }
  const get=id=>{if(!elements.has(id)){const element=new Element();element.id=id;}return elements.get(id);};
  // Retain the shared HTML's ownership hierarchy so moving panes is exercised.
  const body=new Element('body'),stack=[body],html=fs.readFileSync(path.join(__dirname,'../revision-viewer.html'),'utf8');
  for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){
    if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
    if(token.startsWith('<!'))continue;
    if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const node=new Element(tag);for(const match of token.matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(match[1],match[2]);node.hidden=/\shidden(?:\s|>)/.test(token);if(node.attributes.value)node.value=node.attributes.value;stack.at(-1).append(node);if(!['input','img','meta','link','br','hr'].includes(tag))stack.push(node);}
    else if(token.trim())stack.at(-1).text+=token.trim();
  }
  get('objectFilter').value='parts';get('severityFilter').value='all';get('stateFilter').value='all';get('readFilter').value='all';get('commentSort').value='severity';
  const file=hooks.files?.[0]||{path:'board.kicad_pcb',content:'(kicad_pcb (net 1 "SIGNAL") (footprint "Resistor" (layer "F.Cu") (at 30 40) (uuid "fp") (property "Reference" "R1") (property "Value" "10k") (pad "1" smd rect (at 1 0) (size 2 2) (layers "F.Cu") (net 1 "SIGNAL") (uuid "pad"))))'};
  if(hooks.source)file.content=hooks.source;
  const diff=require('../design-diff.js'),design=require(hooks.pcb===false?'../schematic-renderer.js':'../pcb-renderer.js').build(diff.parse(file.content),file.path),designs=new Map();
  const canvas=new EventTarget();canvas.canvas=new Element();canvas.visibleLayers=new Set(['F.Cu']);canvas.viewport={camera:new(require('../owned-canvas.js').Camera)(hooks.width||800,hooks.frameHeight||600)};canvas.setNetHighlight=net=>canvas.netHighlight=net;canvas.resize=()=>{};canvas.draw=()=>workspace.draw();
  const receipts=new Map(hooks.unacceptedRules?[]:[['kivi:content-rules','2026-10-10-terms-1']]),localStorage={getItem:key=>receipts.get(key)||null,setItem:(key,value)=>receipts.set(key,value),removeItem:key=>receipts.delete(key)};
  const keyHandlers=new Set();
  let resizeCallback;
  const context={URL,innerWidth:hooks.width||800,innerHeight:hooks.frameHeight||600,EventTarget,CustomEvent,TextEncoder,Map,Set,console,crypto:require('node:crypto').webcrypto,localStorage,document:{hidden:hooks.hidden===true,body,addEventListener(){},removeEventListener(){},querySelectorAll:selector=>{const found=[];const visit=n=>{if(selector==='dialog[open]'&&n.tagName==='DIALOG'&&n.open)found.push(n);for(const c of n.children)visit(c);};visit(body);return found;},getElementById:id=>{const node=elements.get(id);return node&&body.contains(node)?node:null;},createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},addEventListener:(type,fn)=>{if(type==='keydown')keyHandlers.add(fn);if(type==='resize')resizeCallback=fn;},removeEventListener:(type,fn)=>{if(type==='keydown')keyHandlers.delete(fn);},matchMedia:()=>({matches:true}),
    KiCadFileCompatibility:require('../file-compatibility.js'),KiCadDesignDiff:diff,KiCadCommentFocus:require('../comment-focus.js'),KiCadAnalysisData:require('../analysis-data.js'),KiCadViewState:require('../view-state.js'),KiCadBomManager:require('../bom-manager.js'),KiCadReviewHandoff:hooks.handoff,KiCadEngineeringLauncher:hooks.engineeringLauncher,KiCadCommentCompose:{...require('../comment-compose.js'),...(hooks.compose||{})},KiCadReviewTools:require('../review-tools.js'),KiCadDesignModel:require('../design-model.js'),KiCadNetModel:hooks.netModelAPI||require('../net-model.js'),KiCadReviewComments:require('../review-comments.js'),KiCadBrowserData:require('../browser-data.js'),KiCadOwnedCanvas:require('../owned-canvas.js'),
    top:hooks.top||{},KiCadRevisionActions:require('../revision-actions.js'),KiCadRepositoryExplorer:hooks.repositoryExplorer,KiCadRatsnest:require('../ratsnest.js'),KiCadTestpointTools:hooks.testpointTools,KiCadPhotoReview:hooks.photoReview,KiCadComponentLinks:require('../component-links.js'),KiCadPairedReview:require('../paired-review.js'),KiCadBomAnalytics:require('../bom-analytics.js'),
    chrome:{storage:{local:hooks.chromeStorage||{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:async message=>({ok:true,result:await respond(message)})}},setTimeout,clearTimeout,URL,Blob};
  if(hooks.android){context.KiCadAndroidRuntime=true;context.KiCadAndroidOnline=hooks.androidOnline!==false;}
  if(hooks.localRuntime)context.KiCadLocalRuntime=true;
  if(hooks.chatPanel)context.KiCadChatPanel=hooks.chatPanel;
  if(hooks.quickView)context.KiCadNetQuickView=hooks.quickView;
  if(hooks.workBoardPanel)context.KiCadWorkBoardPanel=hooks.workBoardPanel;
  if(hooks.reviewSync)context.KiCadReviewSync=hooks.reviewSync;
  if(hooks.vscode)context.KiCadVSCodeContext=typeof hooks.vscode==='object'?hooks.vscode:{};
  if(hooks.navigation){Object.assign(context,{KiCadProjectSearch:require('../project-search.js'),KiCadRuleReports:require('../rule-reports.js'),KiCadDesignDiff:diff,KiCadPCBRenderer:require('../pcb-renderer.js'),KiCadSchematicRenderer:require('../schematic-renderer.js')});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../review-navigation.js'),'utf8'),context);get('ruleSeverity').value='all';get('showRuleMarkers').checked=true;}
  canvas.setNetHighlights=(nets,options)=>{canvas.highlightNets=nets;canvas.netHighlight=nets[0]||null;canvas.netPrimitives=new Set(nets.flatMap(n=>n.primitives||[]));canvas.highlightMode=options.mode;};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../review-workspace.js'),'utf8'),context);
  const workspace=context.KiCadReviewWorkspace.mount({files:[file],repository:'wayri/fixture',ref:'main',rootFile:file.path,pcb:true,getCanvas:()=>canvas,currentFile:()=>file.path,focus(){},openSheet(){},getDesigns:()=>designs,...hooks});
  canvas.layers={query_point:at=>hooks.query?.(at)||[]};
  workspace.attachCanvas(canvas);
  function load(){designs.set(file.path,design);canvas.design=design;canvas.primitives=design.primitives;workspace.draw();}
  function key(value,extra={}){const event={key:value,target:canvas.canvas,composedPath:()=>[],preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of keyHandlers)fn(event);return event;}
  return{get,workspace,canvas,design,designs,load,receipts,key,document:context.document,chatDraft:()=>context.KiCadChatDraft,resize(width){hooks.width=width;resizeCallback?.();}};
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
const action=(node,text)=>descendants(node).find(item=>item.tagName==='BUTTON'&&item.textContent===text);
async function sendComment(view){await view.get('postComment').click();if(view.get('commentPostReview').open)await view.get('confirmCommentPost').click();await new Promise(setImmediate);}
function chooseDestination(view){const button=descendants(view.get('commentEditor')).find(node=>node.attributes['aria-label']==='Choose comment destination');assert.ok(button);return button.click();}
test('workspace initializes net geometry after the drawing loads without a file-path change',()=>{
  const view=workspaceRuntime();assert.equal(view.get('netList').children.length,0);view.load();assert.equal(view.get('netCount').textContent,'1 net');
  view.get('netList').children[0].click();assert.equal(view.canvas.netHighlight.name,'SIGNAL');assert.ok(view.canvas.netHighlight.primitives.some(p=>p.uuid==='pad'));
  assert.match(view.get('propertyList').textContent,/Saved code 1/);assert.match(view.get('netMemberList').textContent,/R1 · pad 1/);
  view.get('clearNet').click();assert.equal(view.canvas.netHighlight,null);assert.equal(view.get('clearNet').disabled,true);
});
test('part inspector groups saved properties and offers only connected net selection',()=>{
  const view=workspaceRuntime();view.load();view.get('objectList').children[0].click();assert.equal(view.get('selectedName').textContent,'R1');assert.match(view.get('propertyList').textContent,/Electrical Net SIGNAL/);assert.match(view.get('propertyList').textContent,/Geometry/);assert.equal(view.get('selectObjectNet').hidden,false);
  view.get('selectObjectNet').click();assert.equal(view.canvas.netHighlight.name,'SIGNAL');assert.equal(view.get('selectedName').textContent,'SIGNAL');
});

test('part properties cross-probe each connected net directly without opening explorer',()=>{
  const selections=[],source='(kicad_pcb (net 1 "SUPPLY") (net 2 "RETURN") (net 3 "UNCONNECTED") (footprint "Resistor" (layer "F.Cu") (at 30 40) (uuid "fp") (property "Reference" "R1") (property "Value" "10k") (pad "1" smd rect (at 1 0) (size 2 2) (layers "F.Cu") (net 1 "SUPPLY") (uuid "pad1")) (pad "2" smd rect (at 3 0) (size 2 2) (layers "F.Cu") (net 2 "RETURN") (uuid "pad2"))))';
  const view=workspaceRuntime(undefined,{source,onSelection:value=>selections.push(value)});view.load();view.get('objectList').children[0].click();
  const section=view.get('propertyList').children.find(node=>node.children[0]?.textContent==='Connected nets');
  assert.ok(section);assert.equal(section.open,true);assert.equal(section.children.length,3);
  assert.match(section.textContent,/SUPPLY.*1 pad/);assert.match(section.textContent,/RETURN.*1 pad/);assert.doesNotMatch(section.textContent,/UNCONNECTED/);
  assert.match(view.get('propertyList').textContent,/2 connected nets/);
  section.children.find(node=>node.attributes['aria-label']==='Highlight net RETURN').click();assert.equal(view.canvas.netHighlight.name,'RETURN');assert.equal(view.get('selectedName').textContent,'RETURN');assert.equal(view.get('designNavigator').hidden,true);
  assert.equal(selections.at(-1).kind,'net');assert.equal(selections.at(-1).netName,'RETURN');assert.equal(selections.at(-1).path,'board.kicad_pcb');view.workspace.dispose();
});

function uiEvent(type,values){const event=new Event(type,{cancelable:true});Object.assign(event,values);return event;}
test('pinned properties and comments share the side dock and collapse independently',()=>{
 const view=workspaceRuntime(undefined,{width:1600});view.load();
 assert.equal(view.get('designInspector').hidden,true);assert.equal(view.get('commentsSidebar').hidden,true);
 view.get('propertiesButton').click();view.get('pinProperties').click();view.get('commentsButton').click();view.get('pinComments').click();
 assert.equal(view.get('designInspector').hidden,false);assert.equal(view.get('commentsSidebar').hidden,false);
 assert.equal(view.get('commentsPane').parentElement.id,'commentsSidebar');assert.equal(view.get('propertiesPane').parentElement.id,'designInspector');
 assert.equal(view.get('designInspector').style.height,'300px');assert.equal(view.get('commentsSidebar').style.top,'300px');assert.equal(view.get('reviewWorkspace').style['--pinned-right-width'],'340px');
 view.get('closeInspector').click();assert.equal(view.get('designInspector').hidden,true);assert.equal(view.get('commentsSidebar').style.height,'600px');
 assert.equal(view.get('dockProperties').attributes['aria-expanded'],'false');view.get('dockProperties').click();assert.equal(view.get('designInspector').hidden,false);assert.equal(view.get('pinProperties').attributes['aria-pressed'],'true');
 view.workspace.dispose();
});
test('narrow views retain usable full-height transient panes and drafts across resizing',()=>{
 const view=workspaceRuntime(undefined,{width:600,frameHeight:500,workspaceHeight:440});view.get('newComment').click();view.get('commentText').value='Keep draft';
 assert.equal(view.get('commentsSidebar').style.height,'440px');view.get('propertiesButton').click();assert.equal(view.get('commentsSidebar').hidden,true);
 view.resize(350);view.get('dockComments').click();assert.equal(view.get('commentsSidebar').hidden,false);assert.equal(view.get('commentText').value,'Keep draft');assert.equal(view.get('reviewWorkspace').style['--pinned-right-width'],'0px');
 view.workspace.dispose();
});
test('unpinned panes collapse on drawing interaction while pinned panes remain open',()=>{
 const view=workspaceRuntime();view.get('partsButton').click();view.get('pinNavigator').click();view.get('commentsButton').click();
 view.get('drawingHost').dispatchEvent(new Event('pointerdown'));assert.equal(view.get('designNavigator').hidden,false);assert.equal(view.get('commentsSidebar').hidden,true);
 view.get('dockComments').click();assert.equal(view.get('commentsSidebar').hidden,false);assert.equal(view.get('designNavigator').hidden,false);view.workspace.dispose();
});
test('switching comment subtabs and collapsing a sidebar preserve an unsaved draft and never publish',async()=>{
 const calls=[];const view=workspaceRuntime(async message=>{calls.push(message);return[];},{width:1600});view.load();view.get('newComment').click();view.get('commentText').value='Unsaved review';
 assert.equal(view.get('addCommentPane').hidden,false);assert.equal(view.get('addCommentTab').attributes['aria-selected'],'true');
 view.get('viewCommentsTab').click();assert.equal(view.get('viewCommentsPane').hidden,false);view.get('closeComments').click();view.get('commentsButton').click();view.get('addCommentTab').click();
 assert.equal(view.get('commentText').value,'Unsaved review');assert.equal(view.get('commentEditor').hidden,false);
 const tabs=view.get('addCommentTab').parentElement;tabs.dispatchEvent(uiEvent('keydown',{key:'End'}));assert.equal(view.get('viewCommentsTab').attributes['aria-selected'],'true');assert.equal(view.get('viewCommentsTab').focused,true);
 assert.equal(calls.some(message=>message.type==='comment-save'||message.type==='github-publish-comment'),false);
 view.get('cancelComment').click();assert.equal(view.get('viewCommentsPane').hidden,false);
});
test('sidebar handles resize with pointer and keyboard while sections retain collapse state',()=>{
 const view=workspaceRuntime(undefined,{width:1600});view.load();view.get('objectList').children[0].click();
 const handle=view.get('designInspector').children.find(child=>child.classList.contains('sidebar-resizer'));
 handle.dispatchEvent(uiEvent('pointerdown',{button:0,clientX:500,pointerId:1}));handle.dispatchEvent(uiEvent('pointermove',{clientX:450,pointerId:1}));handle.dispatchEvent(uiEvent('pointerup',{pointerId:1}));
 assert.equal(view.get('designInspector').style.width,'350px');handle.dispatchEvent(uiEvent('keydown',{key:'ArrowLeft'}));assert.equal(view.get('designInspector').style.width,'360px');
 handle.dispatchEvent(uiEvent('keydown',{key:'Home'}));assert.equal(view.get('designInspector').style.width,'220px');assert.equal(handle.attributes['aria-valuenow'],'220');
 const section=view.get('propertyList').children.find(child=>child.children[0].textContent==='Identity');section.open=false;section.dispatchEvent(new Event('toggle'));view.get('objectList').children[0].click();
 assert.equal(view.get('propertyList').children.find(child=>child.children[0].textContent==='Identity').open,false);
});
test('top sheet navigation and optional review tools preserve their existing controls',()=>{
 const view=workspaceRuntime(undefined,{pcb:false,files:[{path:'root.kicad_sch',content:'(kicad_sch (uuid root))'}]});
 assert.equal(view.get('sheetLabel').parentElement.id,'topSheetNavigation');assert.equal(view.get('sheetBack').parentElement.id,'topSheetNavigation');
 assert.equal(view.get('variantBar').parentElement.id,'extraReviewControls');assert.equal(view.get('highlightControls').parentElement.id,'extraReviewControls');assert.equal(view.get('extraReviewControls').hidden,true);
 assert.equal(view.get('shortcutHelp').parentElement.id,'navigationHelpDialog');assert.equal(view.get('diagnostics').parentElement.id,'extraReviewControls');
 view.get('reviewToolsButton').click();assert.equal(view.get('extraReviewControls').hidden,false);view.key('Escape');assert.equal(view.get('extraReviewControls').hidden,true);
 view.key('?');assert.equal(view.get('navigationHelpDialog').open,true);assert.equal(view.get('extraReviewControls').hidden,true);view.key('Escape');assert.equal(view.get('navigationHelpDialog').open,false);
});
test('opposite drawing uses explicit or discovered saved paths and asks when several are available',async()=>{
 const calls=[];const view=workspaceRuntime(async message=>{calls.push(message);if(message.type==='drawing-files')return{files:['board.kicad_pcb','one.kicad_sch','two.kicad_sch']};return[];});
 await view.get('viewOppositeDrawing').click();assert.equal(view.get('companionChooser').hidden,false);assert.equal(calls.some(message=>message.type==='open-viewer-window'),false);
 view.get('oppositeDrawingSelect').value='two.kicad_sch';await view.get('oppositeDrawingSelect').onchange();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.find(message=>message.type==='open-viewer-window').file,'two.kicad_sch');
 const pairedCalls=[];const paired=workspaceRuntime(async message=>{pairedCalls.push(message);return[];},{pairedFile:'confirmed.kicad_sch'});await paired.get('viewOppositeDrawing').click();assert.equal(pairedCalls.find(message=>message.type==='open-viewer-window').file,'confirmed.kicad_sch');assert.equal(pairedCalls.some(message=>message.type==='drawing-files'),false);
 const nativeCalls=[];const native=workspaceRuntime(async message=>{nativeCalls.push(message);if(message.type==='project-inventory')return{files:[{path:'saved.kicad_sch'},{path:'board.kicad_pcb'}]};return[];},{vscode:true});await native.get('viewOppositeDrawing').click();assert.equal(nativeCalls.find(message=>message.type==='open-project-drawing').file,'saved.kicad_sch');assert.equal(nativeCalls.some(message=>message.type==='drawing-files'),false);
});

test('3D keeps parts interaction while clearly disabling unavailable 2D net and layer tools',()=>{
 const view=workspaceRuntime();view.load();view.get('navNets').click();view.workspace.setScene({setPopulation(){}});
 assert.equal(view.get('navNets').disabled,true);assert.equal(view.get('navLayers').disabled,true);assert.equal(view.get('measureButton').disabled,true);assert.equal(view.get('navParts').attributes['aria-selected'],'true');
 view.workspace.setScene(null);assert.equal(view.get('navNets').disabled,false);assert.equal(view.get('navLayers').disabled,false);assert.equal(view.get('measureButton').disabled,false);
});

test('saving metadata stays local until explicit publish and records its thread link',async()=>{
 const validator=require('../review-comments.js'),messages=[];let notes=[];
 const remoteRef={kind:'issue',repository:'wayri/fixture',number:7,url:'https://github.com/wayri/fixture/issues/7',publishedAt:'2026-10-04T00:00:00.000Z'};
 const view=workspaceRuntime(async m=>{messages.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')return{remoteRef};return[];});view.load();await new Promise(resolve=>setImmediate(resolve));
 view.get('newComment').click();view.get('commentText').value='Review R1';view.get('commentSeverity').value='major';view.get('commentState').value='resolved';view.get('commentTags').value='assembly, review';view.get('commentMentions').value='@alice, bob';await view.get('saveComment').click();
 assert.equal(messages.some(m=>m.type==='github-publish-comment'),false);assert.equal(notes[0].anchor.sheetName,'board.kicad_pcb');assert.equal(notes[0].state,'resolved');assert.deepEqual(Array.from(notes[0].tags),['assembly','review']);assert.deepEqual(Array.from(notes[0].mentions),['alice','bob']);
 const card=view.get('commentList').children[0],actions=card.children.at(-1);await action(actions,'Publish to GitHub').click();if(view.get('commentPostReview').open)await view.get('confirmCommentPost').click();await new Promise(setImmediate);
 const publish=messages.find(m=>m.type==='github-publish-comment');assert.equal(publish.destination,'new-issue');assert.equal(publish.comment.anchor.repository,'wayri/fixture');assert.equal(notes[0].remoteRefs[0].url,remoteRef.url);assert.match(view.get('commentStatus').textContent,/Posted to GitHub issue #7/);
 assert.deepEqual(validator.parseSidecar(validator.serializeSidecar(notes))[0].tags,['assembly','review']);
});
test('known repository policy restriction disables direct publish while preserving local comments',async()=>{
 const validate=require('../review-comments.js').validateComment;const note=validate({id:'policy-note',text:'Review placement',createdAt:'2025-01-01T00:00:00.000Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'}});
 const view=workspaceRuntime(async request=>request.type==='comment-list'?[note]:request.type==='comment-policy-status'?{mode:'allowlist',allowed:false,reason:'Only approved reviewers may publish',login:'alice'}:[]);
 view.load();await view.workspace.refreshComments();await view.get('refreshCommentPolicy').click();await new Promise(resolve=>setImmediate(resolve));
 const actions=view.get('commentList').children[0].children.at(-1),publish=action(actions,'Publish to GitHub');
 assert.equal(publish.disabled,true);assert.match(view.get('commentPolicyStatus').textContent,/publishing restricted/);
 assert.ok(action(actions,'Edit'));assert.equal(view.get('refreshCommentPolicy').disabled,false);
});
test('read receipts, lifecycle actions and creation order remain independent',async()=>{
 const validate=require('../review-comments.js').validateComment;const changed=[];
 let notes=[validate({id:'older',text:'Old question',createdAt:'2025-01-01T00:00:00.000Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'}}),
  validate({id:'newer',text:'New question',createdAt:'2025-02-01T00:00:00.000Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'}})];
 const view=workspaceRuntime(async request=>{if(request.type==='comment-list')return notes;if(request.type==='comment-save'){notes=notes.map(n=>n.id===request.comment.id?request.comment:n);return request.comment;}return[];},{onCommentsChanged:()=>changed.push(true)});
 view.load();await view.workspace.refreshComments();view.get('commentSort').value='newest';view.get('commentSort').onchange();
 assert.match(view.get('commentList').children[0].textContent,/New question/);
 const actions=view.get('commentList').children[0].children.at(-1);action(actions,'Mark read').click();
 view.get('readFilter').value='unread';view.get('readFilter').onchange();assert.equal(view.get('commentList').children.length,1);assert.match(view.get('commentList').textContent,/Old question/);
 view.get('readFilter').value='all';view.get('readFilter').onchange();
 await action(view.get('commentList').children[0],'Skip').click();
 assert.equal(notes.find(n=>n.id==='newer').state,'skipped');assert.equal(changed.length,1);
 view.get('stateFilter').value='skipped';view.get('stateFilter').onchange();assert.equal(view.get('commentList').children.length,1);
 assert.match(view.get('commentList').textContent,/Unread/);
});
test('paired selection emits a bounded saved part and net; incoming highlight resolves a unique part',()=>{
 const selections=[];const view=workspaceRuntime(async()=>[],{onSelection:value=>selections.push(value)});view.load();
 view.get('objectList').children[0].click();assert.equal(selections[0].kind,'part');assert.equal(selections[0].reference,'R1');assert.equal(selections[0].uuid,'fp');assert.equal(selections[0].path,'board.kicad_pcb');
 assert.equal(view.workspace.highlightRelated({kind:'part',reference:'R1',uuid:'symbol-uuid',path:'root.kicad_sch'}),true);assert.ok(view.canvas.netPrimitives.size>0,'paired part visibly highlights its geometry');
 view.get('netList').children[0].click();assert.equal(selections.at(-1).kind,'net');assert.equal(selections.at(-1).netName,'SIGNAL');
 assert.equal(view.workspace.highlightRelated({kind:'net',netName:'NO_SUCH_NET',path:'root.kicad_sch'}),false);
});
test('independent layout and 3D windows apply exact same-board part, terminal, net and group selections',()=>{
 const view=workspaceRuntime();view.load();
 assert.equal(view.workspace.applyWindowSelection({kind:'part',path:'board.kicad_pcb',uuid:'fp',reference:'R1'}),true);
 assert.ok(view.canvas.netPrimitives.size>0);
 assert.equal(view.workspace.applyWindowSelection({kind:'part',path:'board.kicad_pcb',uuid:'missing',reference:'R1'}),false,'does not fall back from conflicting saved UUID');
 assert.equal(view.workspace.applyWindowSelection({kind:'pin',path:'board.kicad_pcb',ownerUuid:'fp',uuid:'pad',reference:'R1',pinNumber:'1'}),true);
 assert.equal(view.workspace.applyWindowSelection({kind:'net',path:'board.kicad_pcb',netName:'SIGNAL'}),true);
 assert.equal(view.canvas.netHighlight.name,'SIGNAL');
 assert.equal(view.workspace.applyWindowSelection({kind:'group',items:[{kind:'part',path:'board.kicad_pcb',uuid:'fp',reference:'R1'},{kind:'net',path:'board.kicad_pcb',netName:'SIGNAL'}]}),true);
 assert.equal(view.workspace.applyWindowSelection(null),true);assert.equal(view.canvas.netHighlight,null);
 assert.equal(view.workspace.applyWindowSelection({kind:'part',path:'root.kicad_sch',uuid:'symbol-uuid',reference:'R1'}),true,'opposite schematic mapping still works');
});

test('point and dragged-area review tools persist millimetre anchors and disable ruler interception',async()=>{
 let notes=[];const view=workspaceRuntime(async request=>{if(request.type==='comment-list')return notes;if(request.type==='comment-save'){notes.push(request.comment);return request.comment;}return[];});view.load();await new Promise(resolve=>setImmediate(resolve));
 const fire=(type,props)=>{const event=new Event(type,{cancelable:true});Object.assign(event,props);view.canvas.canvas.dispatchEvent(event);};
 view.get('pointComment').click();fire('click',{clientX:400,clientY:300});view.get('commentText').value='Point note';await view.get('saveComment').click();assert.equal(notes[0].anchor.position.x,0);assert.equal(notes[0].anchor.position.y,0);
 view.get('areaComment').click();fire('pointerdown',{button:0,pointerId:1,clientX:100,clientY:100});fire('pointermove',{buttons:1,pointerId:1,clientX:180,clientY:160});fire('pointerup',{button:0,pointerId:1,clientX:180,clientY:160});view.get('commentText').value='Area note';await view.get('saveComment').click();assert.equal(notes[1].anchor.area.width,20);assert.equal(notes[1].anchor.area.height,15);assert.equal(view.get('areaComment').attributes['aria-pressed'],'false');
 view.get('commentSearch').value='Area';view.get('commentSearch').oninput();assert.equal(view.get('commentList').children.length,1);assert.match(view.get('commentList').textContent,/Area note/);
});

 test('ruler updates live before second click, pins results and resumes after panning',()=>{
 const view=workspaceRuntime();view.load();const fire=(type,props)=>{const e=new Event(type,{cancelable:true});Object.assign(e,props);view.canvas.canvas.dispatchEvent(e);};view.get('rulerSnap').value='grid';view.get('rulerPitch').value='1';view.get('measureButton').click();assert.equal(view.get('rulerControls').hidden,false);
 fire('click',{clientX:400,clientY:300});fire('pointermove',{buttons:0,clientX:440,clientY:330});assert.match(view.get('measurementStatus').textContent,/Live.*12.806/);assert.match(view.get('reviewOverlay').textContent,/X: 10.000 mm/);assert.match(view.get('reviewOverlay').textContent,/Y: 8.000 mm/);
 fire('click',{clientX:440,clientY:330,altKey:true});assert.match(view.get('measurementStatus').textContent,/Pinned.*12.500/);fire('pointermove',{buttons:0,clientX:600,clientY:500});assert.match(view.get('measurementStatus').textContent,/Pinned.*12.500/);
 view.get('clearRuler').click();fire('click',{clientX:400,clientY:300});fire('pointerdown',{button:2,clientX:400,clientY:300});fire('pointerup',{button:2,clientX:400,clientY:300});fire('pointermove',{buttons:0,clientX:440,clientY:300});assert.match(view.get('measurementStatus').textContent,/Live.*10.000/);view.get('measureButton').click();assert.equal(view.get('rulerControls').hidden,true);
 });
 test('board extents measurement uses saved outline and reports missing outline',()=>{const view=workspaceRuntime();view.load();view.get('measureButton').click();view.get('measureBoard').click();assert.match(view.get('measurementStatus').textContent,/No saved Edge.Cuts/);view.design.primitives.push({type:'line',layer:'Edge.Cuts',points:[{x:0,y:0},{x:40,y:25}],width:1});view.get('measureBoard').click();assert.match(view.get('reviewOverlay').textContent,/X: 40.000 mm/);assert.match(view.get('reviewOverlay').textContent,/Y: 25.000 mm/);assert.match(view.get('measurementStatus').textContent,/Board extents/);});
test('a completed ruler result can be replayed after starting another measurement',async()=>{
 const view=workspaceRuntime();view.load();const click=(x,y)=>{const event=new Event('click',{cancelable:true});Object.assign(event,{clientX:x,clientY:y,altKey:true});view.canvas.canvas.dispatchEvent(event);};
 view.get('measureButton').click();click(400,300);click(440,330);const history=view.get('measurementHistory');assert.match(history.textContent,/12.500 mm/);
 view.get('clearRuler').click();assert.doesNotMatch(view.get('measurementStatus').textContent,/Pinned/);
 await history.children[1].children[0].click();assert.match(view.get('measurementStatus').textContent,/Pinned.*12.500/);
 history.children[1].children.at(-1).click();assert.match(history.textContent,/Recent measurements · 0/);
});
test('shared Measure control delegates to supported 3D scenes and resets after leaving 3D',()=>{
 const view=workspaceRuntime();let mode=false;const scene={setPopulation(){},setSelection(){},setMeasurementMode(value){mode=value;},measurementState(){return{mode};}};view.load();view.workspace.setScene(scene);
 assert.equal(view.get('measureButton').disabled,false);view.get('measureButton').click();assert.equal(mode,true);assert.equal(view.get('measureButton').attributes['aria-pressed'],'true');view.get('measureButton').click();assert.equal(mode,false);
 view.get('measureButton').click();view.workspace.setScene(null);assert.equal(view.get('measureButton').attributes['aria-pressed'],'false');
});
test('Android selected-commit export and copy stop when import leaves the previous project active',async()=>{
 let actions,downloads=0,copies=0;const sha='a'.repeat(40),top={KiCadAndroidProject:{github:{repository:'wayri/fixture',sha:'b'.repeat(40)}},KiCadAndroidGitHub:{openProject:async()=>{}},KiCadAndroidUI:{downloadProject:()=>downloads++},KiCadAndroidLibrary:{saveCurrent:async()=>copies++}};
 const view=workspaceRuntime(async()=>[],{android:true,top,repositoryExplorer:{open:options=>{actions=options;}}});view.load();view.get('openRepositoryExplorer').click();
 await assert.rejects(actions.onDownloadRevision(sha),/did not finish opening/);await assert.rejects(actions.onCopyRevision(sha),/did not finish opening/);assert.equal(downloads,0);assert.equal(copies,0);
 top.KiCadAndroidGitHub.openProject=async()=>{top.KiCadAndroidProject={github:{repository:'wayri/fixture',sha}};};await actions.onDownloadRevision(sha);await actions.onCopyRevision(sha);assert.equal(downloads,1);assert.equal(copies,1);
});
test('Objects view filter persists choices, applies both renderers and resets independently of layer controls',async()=>{
 const saved=[],view=workspaceRuntime(async()=>[],{chromeStorage:{get:async()=>({}),set:async value=>saved.push(value)}});view.load();const canvasCalls=[],sceneCalls=[];view.canvas.setObjectVisibility=value=>canvasCalls.push(JSON.parse(JSON.stringify(value)));
 const pads=view.get('objectVisibility-pads');pads.checked=false;pads.onchange();assert.deepEqual(canvasCalls.at(-1),{hiddenTypes:['pads'],side:'all'});assert.equal(view.get('objectVisibilityAll').indeterminate,true);assert.equal(view.get('objectVisibility-rooms').disabled,true);assert.equal(view.get('objectVisibility-bodies').disabled,true);
 view.get('objectSide-bottom').click();assert.equal(canvasCalls.at(-1).side,'bottom');
 view.workspace.setScene({setPopulation(){},setSelection(){},setObjectVisibility(value){sceneCalls.push(JSON.parse(JSON.stringify(value)));return{supportedTypes:['pads','bodies']};}});assert.deepEqual(sceneCalls.at(-1),{hiddenTypes:['pads'],side:'bottom'});assert.equal(view.get('objectVisibility-bodies').disabled,false);assert.equal(view.get('objectVisibility-texts').disabled,true);
 view.workspace.setScene(null);assert.equal(view.get('objectVisibility-texts').disabled,false);view.get('objectVisibilityAll').checked=true;view.get('objectVisibilityAll').onchange();assert.deepEqual(canvasCalls.at(-1).hiddenTypes,[]);assert.equal(canvasCalls.at(-1).side,'bottom');assert.ok(saved.length>=3);
});
test('fork UI separates the destination review branch and sends no write before explicit creation',async()=>{
 let actions;const messages=[],sha='c'.repeat(40),view=workspaceRuntime(async message=>{messages.push(message);return{url:'https://github.com/account/fork',created:true};},{vscode:{canOpenHistorical:true,collaboration:{provider:'github',repository:'account/source'}},repositoryExplorer:{open:options=>{actions=options;}}});view.load();view.get('openRepositoryExplorer').click();actions.onForkRevision(sha);
 assert.equal(messages.filter(m=>m.type==='repository-fork-revision').length,0);const dialog=view.document.body.querySelector('.revision-action-dialog');assert.match(dialog.textContent,/account\/source/);const buttons=dialog.children.filter(n=>n.tagName==='BUTTON'),create=buttons.find(n=>n.textContent==='Create remote fork');await create.click();
 const request=messages.find(m=>m.type==='repository-fork-revision');assert.equal(request.sha,sha);assert.equal(request.ref,'main');assert.equal(request.name,'source-review');assert.equal(request.branch,'review/'+sha.slice(0,12));assert.equal(request.confirmed,true);
});
test('saved report picker uses project inventory and opens an explicit report without publishing',async()=>{
 const opened=[],view=workspaceRuntime(async message=>message.type==='project-inventory'?{files:[{path:'reports/design.json'},{path:'results/ac.raw'},{path:'board.kicad_pcb'}]}:[],{engineeringLauncher:{open:(page,source)=>{opened.push({page,source});}}});view.load();view.get('openSavedReports').click();await new Promise(setImmediate);
 const dialog=view.document.body.querySelector('.saved-reports-dialog'),list=dialog.querySelector('.saved-report-list');assert.equal(list.children.length,2);await list.children[0].querySelector('button').click();assert.equal(opened[0].page,'analysis-viewer.html');assert.equal(opened[0].source.file,'reports/design.json');assert.equal(dialog.open,false);
});

test('saved report sources separate KiCad setup from wayriCAD plugin fields and unclassified exports',async()=>{
 const opened=[],view=workspaceRuntime(async message=>message.type==='project-inventory'?{files:[{path:'sim.wbk'},{path:'quickpi/field.json'},{path:'unknown.csv'}]}:[],{engineeringLauncher:{open:(page,source)=>{opened.push({page,source});}}});view.load();view.get('openSavedReports').click();await new Promise(setImmediate);
 const dialog=view.document.body.querySelector('.saved-reports-dialog'),list=dialog.querySelector('.saved-report-list'),source=dialog.querySelector('select');assert.equal(list.children.length,3);
 source.value='kicad';source.onchange();assert.equal(list.children.length,1);assert.equal(list.children[0].querySelector('button').textContent,'sim.wbk');
 source.value='other';source.onchange();assert.equal(list.children.length,1);assert.equal(list.children[0].querySelector('button').textContent,'unknown.csv');
 source.value='wayricad';source.onchange();assert.equal(list.children.length,1);const buttons=list.children[0].children.filter(node=>node.tagName==='BUTTON');assert.deepEqual(buttons.map(node=>node.textContent),['quickpi/field.json','2D + probe','3D + probe']);await buttons[2].click();assert.equal(opened[0].source.resultView,'3d');assert.equal(opened[0].source.file,'quickpi/field.json');assert.equal(dialog.open,false);
});


const {matchesSearch,sheetTarget}=require('../review-workspace.js');
test('advanced search combines fields, quoted values, custom properties and exclusions literally',()=>{
 const item={label:'R1',reference:'R1',kind:'symbol',path:'power.kicad_sch',properties:{Value:'10 k Ohm',Manufacturer:'Acme','DNP':'No'}};
 assert.equal(matchesSearch(item,'ref:R1 value:"10 k" manufacturer:acme -type:pad',['VCC']),true);
 assert.equal(matchesSearch(item,'net:VCC sheet:power',['VCC']),true);
 assert.equal(matchesSearch(item,'net:GND',['VCC']),false);
 assert.equal(matchesSearch(item,'-manufacturer:acme'),false);
 assert.equal(matchesSearch(item,'value:.*'),false);
});
test('sheet links resolve safe relative paths without escaping repository',()=>{
 assert.equal(sheetTarget({path:'root/main.kicad_sch',properties:{Sheetfile:'../power.kicad_sch'}}),'power.kicad_sch');
 for(const name of ['../../escape.kicad_sch','/abs.kicad_sch','C:\\bad.kicad_sch'])assert.equal(sheetTarget({path:'root/main.kicad_sch',properties:{Sheetfile:name}}),null);
});
test('saved settings inspector includes nested KiCad settings with empty fields',()=>{
 const {workspace,get,load}=workspaceRuntime();load();workspace.select3D({uuid:'fp'});
 assert.match(get('propertyList').textContent,/Saved KiCad settings/);
 assert.match(get('propertyList').textContent,/pad/);
});


test('multi highlight toggles separate networks and single mode replaces the set',()=>{
 const source='(kicad_pcb (net 1 "A") (net 2 "B") (segment (start 1 1) (end 10 1) (width 1) (layer "F.Cu") (net 1) (uuid "a")) (segment (start 1 3) (end 10 3) (width 1) (layer "F.Cu") (net 2) (uuid "b")))';
 const view=workspaceRuntime(async()=>[],{source});view.load();view.get('multiHighlight').checked=true;view.get('netList').children[0].click();view.get('netList').children[1].click();assert.equal(view.canvas.highlightNets.length,2);view.get('netList').children[0].click();assert.equal(view.canvas.highlightNets.length,1);assert.equal(view.canvas.netHighlight.name,'B');
 view.get('multiHighlight').checked=false;view.get('netList').children[0].click();assert.equal(view.canvas.highlightNets.length,1);assert.equal(view.canvas.netHighlight.name,'A');view.get('highlightStyle').value='isolate';view.get('highlightStyle').onchange();assert.equal(view.canvas.highlightMode,'isolate');view.get('clearHighlights').click();assert.equal(view.canvas.highlightNets.length,0);
});

test('global search navigation highlights a saved component and rejects malformed query feedback',()=>{
 const view=workspaceRuntime(async()=>[],{navigation:true});view.load();view.get('navSearch').click();view.get('projectSearch').value='ref:R1 type:footprint';view.get('projectSearch').oninput();assert.equal(view.get('projectResults').children.length,1);view.get('projectResults').children[0].click();assert.match(view.get('highlightSummary').textContent,/1 components/);assert.ok(view.canvas.netPrimitives.size>0);
 view.get('projectSearch').value='ref:R1 OR';view.get('projectSearch').oninput();assert.equal(view.get('projectResults').children.length,0);assert.match(view.get('projectSearchCount').textContent,/OR|term|query/i);
});

test('saved rule report navigation uses millimetre coordinates and clickable arrows; clearing removes markers',async()=>{
 const focused=[],view=workspaceRuntime(async()=>[],{navigation:true,focus:position=>focused.push(position)});view.load();view.get('navRules').click();
 const report={source:'board.kicad_pcb',date:'2026-10-04T00:00:00Z',kicad_version:'9.0.0',coordinate_units:'mils',violations:[{type:'clearance',description:'Copper clearance',severity:'error',items:[{description:'Track',pos:{x:1000,y:2000}}]}]};
 view.get('ruleReportFile').files=[{size:200,name:'board-drc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();assert.match(view.get('ruleCount').textContent,/1 saved/);view.get('nextRule').click();assert.equal(focused[0].x,25.4);assert.equal(focused[0].y,50.8);assert.match(view.get('ruleProvenance').textContent,/unverified/);assert.ok(view.get('commentPins').children.some(n=>n.className.includes('rule-marker')));assert.ok(view.get('reviewOverlay').children.some(n=>n.attributes.d?.includes('L')));
 view.get('clearRuleReports').click();assert.equal(view.get('commentPins').children.filter(n=>n.className?.includes('rule-marker')).length,0);
});

test('overlapping selected net classes retain shared nets when one class is removed',async()=>{
 const view=workspaceRuntime(async()=>[],{navigation:true});view.load();view.get('multiHighlight').checked=true;
 const settings={net_settings:{classes:[{name:'Default',priority:100},{name:'Power',priority:0},{name:'Shared',priority:1}],netclass_assignments:{SIGNAL:['Power','Shared']},netclass_patterns:[]}};
 view.get('netClassFile').files=[{size:200,name:'board.kicad_pro',text:async()=>JSON.stringify(settings)}];await view.get('netClassFile').onchange();
 for(const name of ['Power','Shared']){view.get('netClassSelect').value=name;view.get('highlightNetClass').click();}
 assert.equal(view.canvas.highlightNets.length,1);assert.match(view.get('netClassStatus').textContent,/Power, Shared/);
 view.get('netClassSelect').value='Power';view.get('highlightNetClass').click();assert.equal(view.canvas.highlightNets.length,1);assert.match(view.get('netClassStatus').textContent,/Highlighted classes: Shared/);
 view.get('netClassSelect').value='Shared';view.get('highlightNetClass').click();assert.equal(view.canvas.highlightNets.length,0);
});


test('search selects multiple net classes and single mode replaces component highlights',async()=>{
 const view=workspaceRuntime(async()=>[],{navigation:true});view.load();view.get('multiHighlight').checked=true;
 const settings={net_settings:{classes:[{name:'Default',priority:100},{name:'Power',priority:0},{name:'Shared',priority:1}],netclass_assignments:{SIGNAL:['Power','Shared']},netclass_patterns:[]}};
 view.get('netClassFile').files=[{size:200,name:'board.kicad_pro',text:async()=>JSON.stringify(settings)}];await view.get('netClassFile').onchange();
 view.get('projectSearch').value='type:netclass';view.get('projectSearch').oninput();assert.equal(view.get('projectResults').children.length,2);
 view.get('projectResults').children[0].click();view.get('projectResults').children[1].click();assert.equal(view.canvas.highlightNets.length,1);assert.match(view.get('netClassStatus').textContent,/Power, Shared/);
 view.get('projectResults').children[0].click();assert.equal(view.canvas.highlightNets.length,1);assert.match(view.get('netClassStatus').textContent,/Highlighted classes: Shared/);
 view.get('multiHighlight').checked=false;view.get('projectSearch').value='ref:R1 type:footprint';view.get('projectSearch').oninput();view.get('projectResults').children[0].click();assert.match(view.get('highlightSummary').textContent,/0 nets.*1 components/);
 view.get('projectSearch').value='type:net';view.get('projectSearch').oninput();view.get('projectResults').children[0].click();assert.equal(view.canvas.highlightNets.length,1);assert.match(view.get('highlightSummary').textContent,/0 components/);
});


test('disabling multihighlight immediately reduces combined net and component selection to one',()=>{
 const source='(kicad_pcb (net 1 "A") (net 2 "B") (segment (start 1 1) (end 10 1) (width 1) (layer "F.Cu") (net 1) (uuid "a")) (segment (start 1 3) (end 10 3) (width 1) (layer "F.Cu") (net 2) (uuid "b")))';
 const view=workspaceRuntime(async()=>[],{navigation:true,source});view.load();view.get('multiHighlight').checked=true;view.get('netList').children[0].click();view.get('netList').children[1].click();assert.equal(view.canvas.highlightNets.length,2);
 view.get('multiHighlight').checked=false;view.get('multiHighlight').onchange();assert.equal(view.canvas.highlightNets.length,1);assert.equal(view.canvas.netHighlight.name,'B');assert.match(view.get('highlightSummary').textContent,/1 nets.*0 components/);
});


test('double click enters only a resolved loaded subsheet, never schematic editing',()=>{
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (sheet (at 0 0) (size 10 10) (uuid "sheet-1") (property "Sheetname" "Power") (property "Sheetfile" "power.kicad_sch")))'},{path:'power.kicad_sch',content:'(kicad_sch)'}],opened=[];
 const view=workspaceRuntime(async()=>[],{pcb:false,files,query:()=>[{bbox:{context:{uuid:'sheet-1'}}}],openSheet:path=>opened.push(path)});view.load();const before=JSON.stringify(files);
 const double=()=>{const event=new Event('dblclick',{cancelable:true});Object.assign(event,{button:0,clientX:400,clientY:300});view.canvas.canvas.dispatchEvent(event);};double();assert.deepEqual(opened,['power.kicad_sch']);
 view.get('measureButton').click();double();assert.equal(opened.length,1);view.get('measureButton').click();view.get('areaComment').click();double();assert.equal(opened.length,1);assert.equal(JSON.stringify(files),before);
 view.workspace.dispose();double();assert.equal(opened.length,1);
});

test('missing sheet double click reports absence; parent navigation rejects ambiguous parents',()=>{
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (sheet (at 0 0) (size 10 10) (uuid "sheet-1") (property "Sheetname" "Power") (property "Sheetfile" "missing.kicad_sch")))'}],opened=[];
 const view=workspaceRuntime(async()=>[],{pcb:false,files,query:()=>[{bbox:{context:{uuid:'sheet-1'}}}],openSheet:path=>opened.push(path)});view.load();const event=new Event('dblclick');Object.assign(event,{clientX:400,clientY:300});view.canvas.canvas.dispatchEvent(event);assert.deepEqual(opened,[]);assert.match(view.get('reviewNotice').textContent,/missing/);
 const parentFiles=[files[0],{path:'other.kicad_sch',content:files[0].content},{path:'missing.kicad_sch',content:'(kicad_sch)'}];const child=workspaceRuntime(async()=>[],{pcb:false,files:parentFiles,currentFile:()=> 'missing.kicad_sch',openSheet:path=>opened.push(path)});child.load();child.key('ArrowUp',{altKey:true});assert.deepEqual(opened,[]);assert.match(child.get('reviewNotice').textContent,/multiple parents/);
 const unique=workspaceRuntime(async()=>[],{pcb:false,files:[files[0],parentFiles[2]],currentFile:()=> 'missing.kicad_sch',openSheet:path=>opened.push(path)});unique.load();unique.key('ArrowUp',{altKey:true});assert.deepEqual(opened,['root.kicad_sch']);
});

test('review shortcuts inspect pointer, highlight net, focus search, respect typing and never mutate sources',()=>{
 const focused=[],messages=[],view=workspaceRuntime(async request=>{messages.push(request.type);return[];},{navigation:true,query:()=>[{bbox:{context:{uuid:'pad'}}}],focus:p=>focused.push(p)});view.load();
 view.get('designInspector').hidden=true;view.key('e',{ctrlKey:true});assert.equal(view.get('designInspector').hidden,true);view.key('e',{composedPath:()=>[{tagName:'TEXTAREA'}]});assert.equal(view.get('designInspector').hidden,true);
 const move=new Event('pointermove');Object.assign(move,{clientX:400,clientY:300,buttons:0});view.canvas.canvas.dispatchEvent(move);view.key('e');assert.equal(view.get('selectedName').textContent,'R1 pad 1');assert.equal(view.get('designInspector').hidden,false);
 view.key('h');assert.equal(view.canvas.netHighlight.name,'SIGNAL');view.key(' ');assert.equal(focused[0].x,0);assert.equal(focused[0].y,0);view.key('/');assert.equal(view.get('universalSearch').focused,true);view.key('?');assert.equal(view.get('shortcutHelp').open,true);
 for(const key of ['`','~']){view.get('clearHighlights').click();view.key(key);assert.equal(view.canvas.netHighlight.name,'SIGNAL');view.get('clearHighlights').click();view.key(key,{composedPath:()=>[{tagName:'INPUT'}]});assert.equal(view.canvas.netHighlight,null);}
 for(const key of ['Delete','Backspace','x','g'])assert.equal(view.key(key).defaultPrevented,undefined);
 const count=messages.length;view.workspace.dispose();view.key('c');assert.equal(messages.length,count);
});


test('BOM reflects saved DNP and exposes counts, safe component navigation and copper stats',()=>{
 const source='(kicad_pcb (general (thickness 1.6)) (footprint "Resistor" (at 30 40) (uuid "fp") (attr smd dnp) (property "Reference" "R1") (property "Value" "10k") (pad "1" smd rect (at 1 0) (size 2 2) (layers "F.Cu") (uuid "pad"))))';
 const view=workspaceRuntime(undefined,{source});view.load();view.get('navBom').click();
 assert.match(view.get('bomSummary').textContent,/1 components.*0 fitted.*1 DNP/);
 assert.match(view.get('boardStats').textContent,/Saved board thickness 1.6 mm/);
 const bomPart=view.get('bomRows').children[0].children.find(e=>e.textContent==='R1');bomPart.click();assert.equal(view.get('selectedName').textContent,'R1');assert.equal(bomPart.attributes['aria-pressed'],'true');view.workspace.select3D(null);assert.equal(bomPart.attributes['aria-pressed'],'false');view.workspace.select3D({uuid:'fp',ref:'R1'});assert.equal(bomPart.attributes['aria-pressed'],'true');
 view.get('highlightDnp').checked=true;view.get('highlightDnp').onchange();assert.ok(view.canvas.netPrimitives.has(view.design.primitives.find(p=>p.ownerUuid==='fp')));
 view.get('clearHighlights').click();assert.equal(view.get('highlightDnp').checked,false);assert.equal(view.canvas.netPrimitives.size,0);
});
test('zone analytics navigation selects saved zone UUID and displays square-millimetre sums',()=>{
 const source='(kicad_pcb (zone (uuid "zone") (net_name "GND") (layer "F.Cu") (polygon (pts (xy 0 0)(xy 10 0)(xy 10 10)(xy 0 10))) (filled_polygon (layer "F.Cu") (pts (xy 1 1)(xy 9 1)(xy 9 9)(xy 1 9)))))';
 const view=workspaceRuntime(undefined,{source});view.load();view.get('navBom').click();view.get('zoneStats').children.find(e=>e.onclick&&e.textContent.includes('64.000 mm² fill sum')).click();
 assert.match(view.get('propertyList').textContent,/Outline polygon area sum 100.000 mm²/);assert.match(view.get('propertyList').textContent,/Saved fill polygon area sum 64.000 mm²/);assert.match(view.get('propertyList').textContent,/overlaps are counted repeatedly/);assert.ok(view.canvas.netPrimitives.size>0);
});
test('board analytics selects source-bound nets and placement candidates and exports routing provenance',()=>{
 const exports=[],source='(kicad_pcb(net 1 "GND")(footprint "x"(uuid "a")(at 0 0)(property "Reference" "R1")(pad "1" smd circle(at 0 0)(size 1 1)(layers "F.Cu")(net 1 "GND")))(footprint "x"(uuid "b")(at 20 20)(property "Reference" "R2")(pad "1" smd circle(at 0 0)(size 1 1)(layers "F.Cu")(net 1 "GND")))(segment(start 10 10)(end 13 14)(width .2)(layer "F.Cu")(net 1)))';
 const view=workspaceRuntime(undefined,{source,top:{AndroidKiCad:{exportText:(...args)=>exports.push(args)}}});view.load();view.get('openBoardAnalytics').click();
 assert.match(view.get('boardStats').textContent,/Total track length 5.000 mm/);assert.match(view.get('boardStats').textContent,/Candidate airwires 1/);
 view.get('zoneStats').children.find(e=>e.textContent==='GND: 5.000 mm').click();assert.equal(view.canvas.netHighlight.name,'GND');
 view.get('zoneStats').children.find(e=>e.textContent.startsWith('R1 · Footprint origin')).click();assert.equal(view.get('selectedName').textContent,'R1');
 view.get('zoneStats').children.find(e=>e.textContent==='Export board analytics JSON').click();const [name,text,mime]=exports[0],data=JSON.parse(text);
 assert.equal(name,'board-analytics.json');assert.equal(mime,'application/json');assert.equal(data.source.path,'board.kicad_pcb');assert.equal(data.source.ref,'main');assert.equal(data.board.totalTrackLengthMm,5);assert.equal(data.routing.lines.length,1);assert.equal(data.routing.status,'candidate-connections');assert.match(data.routing.warnings.join(' '),/not KiCad unrouted/);view.workspace.dispose();
});
test('board analytics keeps imported DRC unconnected evidence distinct and clears it with reports',async()=>{
 const exports=[],view=workspaceRuntime(undefined,{navigation:true,top:{AndroidKiCad:{exportText:(...args)=>exports.push(args)}}});view.load();
 const finding={type:'unconnected_items',description:'Unconnected pads',severity:'error',items:[]},report={source:'board.kicad_pcb',date:'2026-10-04T00:00:00Z',kicad_version:'9.0.0',coordinate_units:'mm',violations:[],unconnected_items:[finding,{...finding,excluded:true}]};
 view.get('ruleReportFile').files=[{size:500,name:'board-drc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();view.get('openBoardAnalytics').click();
 assert.match(view.get('zoneStats').textContent,/board-drc.json: 1 saved unconnected findings · 1 excluded/);assert.match(view.get('zoneStats').textContent,/Report revision is unverified/);
 view.get('zoneStats').children.find(e=>e.textContent==='Export board analytics JSON').click();const data=JSON.parse(exports[0][1]);assert.equal(data.savedRoutingReports[0].unconnectedFindings,1);assert.equal(data.savedRoutingReports[0].metadata.associationVerified,false);
 view.get('clearRuleReports').click();view.get('navBom').click();assert.doesNotMatch(view.get('zoneStats').textContent,/board-drc.json/);view.workspace.dispose();
});

const {sheetEntries}=require('../review-workspace.js');
const hierarchySheets=[
  {path:'design/root.kicad_sch',label:'Controller'},
  {path:'design/power.kicad_sch',label:'Power'},
  {path:'design/regulator.kicad_sch',label:'Regulator'},
  {path:'design/io.kicad_sch',label:'I/O'}
];
const hierarchyLinks=[
  {path:'design/root.kicad_sch',label:'Power',properties:{Sheetfile:'power.kicad_sch'}},
  {path:'design/power.kicad_sch',label:'Regulator',properties:{Sheetfile:'regulator.kicad_sch'}},
  {path:'design/root.kicad_sch',label:'I/O',properties:{Sheetfile:'io.kicad_sch'}},
  {path:'design/root.kicad_sch',label:'Missing sensor',properties:{Sheetfile:'sensor.kicad_sch'}}
];
test('sheet hierarchy collapses descendants without reintroducing them as orphan files',()=>{
  assert.deepEqual(sheetEntries(hierarchySheets,hierarchyLinks).map(e=>[e.sheet?.label||e.link.label,e.depth]),[['Controller',0],['Power',1],['Regulator',2],['I/O',1],['Missing sensor',1]]);
  assert.deepEqual(sheetEntries(hierarchySheets,hierarchyLinks,'',new Set(['design/root.kicad_sch'])).map(e=>e.sheet.label),['Controller']);
  assert.deepEqual(sheetEntries(hierarchySheets,hierarchyLinks,'',new Set(['design/power.kicad_sch'])).filter(e=>e.sheet).map(e=>e.sheet.label),['Controller','Power','I/O']);
});
test('sheet filtering reveals matching descendants and their ancestors while preserving collapsed state',()=>{
  const collapsed=new Set(['design/root.kicad_sch']);
  assert.deepEqual(sheetEntries(hierarchySheets,hierarchyLinks,'regulator',collapsed).map(e=>e.sheet.label),['Controller','Power','Regulator']);
  assert.deepEqual(sheetEntries(hierarchySheets,hierarchyLinks,'sensor',collapsed).map(e=>e.sheet?.label||e.link.label),['Controller','Missing sensor']);
  assert.deepEqual([...collapsed],['design/root.kicad_sch']);
  assert.equal(sheetEntries(hierarchySheets,hierarchyLinks,'not present').length,0);
  const renamed=[{...hierarchyLinks[0],label:'Supply block'}];
  assert.deepEqual(sheetEntries(hierarchySheets,renamed,'Supply block').map(e=>e.sheet.label),['Controller','Power']);
});
test('reused files and cyclic sheet links stay bounded and preserve all parent symbol targets',()=>{
  const links=[...hierarchyLinks,{path:'design/io.kicad_sch',label:'Shared power',properties:{Sheetfile:'power.kicad_sch'}},{path:'design/regulator.kicad_sch',label:'Cycle',properties:{Sheetfile:'root.kicad_sch'}}];
  const entries=sheetEntries(hierarchySheets,links);
  assert.equal(entries.filter(e=>e.sheet).length,4);
  assert.equal(entries.find(e=>e.sheet?.label==='Power').parents.length,2);
  assert.equal(new Set(entries.filter(e=>e.sheet).map(e=>e.sheet.path)).size,4);
});
test('sheet browser renders compact names with source paths in tooltips and opens the selected file',()=>{
  const files=[{path:'design/root.kicad_sch',content:'(kicad_sch (uuid "root") (sheet (at 10 10) (size 10 10) (uuid "sheet") (property "Sheetname" "Power") (property "Sheetfile" "power.kicad_sch")))'}, {path:'design/power.kicad_sch',content:'(kicad_sch (uuid "power"))'}];
  let opened;
  const view=workspaceRuntime(async()=>[],{files,pcb:false,openSheet:path=>opened=path});
  view.get('navSheets').click();
  const rows=view.get('sheetList').children[1].children;
  assert.equal(rows.length,2);
  const root=rows[0].children[1],child=rows[1].children[1];
  assert.equal(root.title,'design/root.kicad_sch');
  assert.ok(!root.textContent.includes('design/'));
  assert.equal(root.attributes['aria-current'],'page');
  child.click();assert.equal(opened,'design/power.kicad_sch');
  assert.match(rows[1].children[2].attributes['aria-label'],/Locate.*design\/root/);
  rows[0].children[0].click();assert.equal(view.get('sheetList').children[1].children.length,1);
});

test('sheet history bounds visits, replaces forward history after a new branch, and ignores repeat selections',()=>{
 const history=require('../review-workspace.js').sheetHistory(3);history.visit('a');history.visit('b');history.visit('b');history.visit('c');assert.equal(history.move(-1),'b');assert.equal(history.target(1),'c');history.visit('d');assert.equal(history.target(1),null);assert.equal(history.move(-1),'b');history.move(1);history.visit('e');assert.equal(history.move(-1),'d');assert.equal(history.move(-1),'b');assert.equal(history.move(-1),null);
});
test('sheet navigation follows visits, up and root; keyboard history respects text entry',()=>{
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (sheet (at 0 0) (size 10 10) (uuid "s") (property "Sheetfile" "child.kicad_sch")))'},{path:'child.kicad_sch',content:'(kicad_sch (sheet (at 0 0) (size 10 10) (uuid "t") (property "Sheetfile" "leaf.kicad_sch")))'},{path:'leaf.kicad_sch',content:'(kicad_sch)'}];
 let active=files[0].path,view;const open=path=>{active=path;view.workspace.draw();};view=workspaceRuntime(async()=>[],{pcb:false,files,currentFile:()=>active,openSheet:open});view.load();
 assert.equal(view.get('sheetBack').disabled,true);assert.equal(view.get('sheetHome').disabled,true);
 open('child.kicad_sch');open('leaf.kicad_sch');view.get('sheetBack').click();assert.equal(active,'child.kicad_sch');assert.equal(view.get('sheetForward').disabled,false);view.get('sheetForward').click();assert.equal(active,'leaf.kicad_sch');view.get('sheetUp').click();assert.equal(active,'child.kicad_sch');assert.equal(view.get('sheetForward').disabled,true);
 view.get('sheetHome').click();assert.equal(active,'root.kicad_sch');assert.equal(view.get('sheetUp').disabled,true);view.key('ArrowLeft',{altKey:true});assert.equal(active,'child.kicad_sch');view.key('ArrowRight',{altKey:true});assert.equal(active,'root.kicad_sch');view.key('ArrowLeft',{altKey:true,composedPath:()=>[{tagName:'INPUT'}]});assert.equal(active,'root.kicad_sch');
});
test('root navigation resolves an initially opened child and rejects reused-parent ambiguity and cycles',()=>{
 const rootPath=require('../review-workspace.js').rootSheetPath,files=['root','child','other'].map(name=>({path:name+'.kicad_sch'})),link=(path,target)=>({kind:'sheet',path:path+'.kicad_sch',properties:{Sheetfile:target+'.kicad_sch'}});
 assert.equal(rootPath('child.kicad_sch',[link('root','child')],files),'root.kicad_sch');assert.equal(rootPath('child.kicad_sch',[link('root','child'),link('other','child')],files),null);assert.equal(rootPath('child.kicad_sch',[link('root','child'),link('child','root')],files),null);
});

test('GitLab viewer isolates host context and exposes provider account and publication controls',async()=>{
 let notes=[];const calls=[];const view=workspaceRuntime(async message=>{calls.push(message);if(message.type==='comment-save'){notes=[message.comment];return message.comment;}if(message.type==='comment-list')return notes;if(message.type==='comment-policy-status')return{allowed:true,mode:'everyone'};return [];},{provider:'gitlab',host:'https://gitlab.example.com',repository:'group/sub/design'});view.load();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.get('reviewSettings').hidden,false);assert.equal(view.get('showGitHub').textContent,'GitLab');assert.equal(view.get('postComment').attributes['aria-label'],'Review and send');assert.equal(view.get('editorAccount').textContent,'GitLab account');assert.equal(view.get('repositoryIssues').href,'https://gitlab.example.com/group/sub/design/-/issues');
 view.get('newComment').click();view.get('commentText').value='Check layout';await view.get('saveComment').click();
 assert.match(view.get('commentList').textContent,/Publish to GitLab/);assert.doesNotMatch(view.get('commentList').textContent,/Publish to GitHub/);
 const saved=calls.find(message=>message.type==='comment-save');assert.equal(saved.provider,'gitlab');assert.equal(saved.host,'https://gitlab.example.com');assert.equal(saved.comment.anchor.provider,'gitlab');assert.equal(saved.comment.anchor.host,'https://gitlab.example.com');assert.equal(saved.comment.anchor.repository,'group/sub/design');
 assert.equal(calls.some(message=>message.type.startsWith('github-')),false);assert.equal(calls.find(m=>m.type==='comment-policy-status').host,'https://gitlab.example.com');
});

test('conversation catalog combines issues and discussions, filters by category and never posts on browse',async()=>{
 const calls=[],view=workspaceRuntime(async message=>{calls.push(message);if(message.type==='chat-thread-list')return{threads:[{kind:message.kind,number:message.kind==='issue'?7:8,title:message.kind==='issue'?'Connector clearance':'Assembly review',state:'open',author:'reviewer',updatedAt:'2026-10-27T09:00:00Z'}],hasMore:false};return[];});
 view.load();view.get('showComments').click();await new Promise(setImmediate);
 assert.deepEqual(calls.filter(message=>message.type==='chat-thread-list').map(message=>message.kind).sort(),['discussion','issue']);
 assert.match(view.get('commentThreadReader').textContent,/Connector clearance/);assert.match(view.get('commentThreadReader').textContent,/Assembly review/);
 const category=view.get('commentConversationKind');assert.equal(category.value,'all');category.value='discussion';await category.onchange();
 assert.doesNotMatch(view.get('commentThreadReader').textContent,/Connector clearance/);assert.match(view.get('commentThreadReader').textContent,/Assembly review/);
 view.get('newConversation').click();assert.equal(view.get('editorThreadType').value,'discussion');assert.equal(view.get('editorDestination').value,'discussion');
 assert.equal(view.get('commentComposeTop').parentElement.id,'commentEditor');assert.equal(view.get('commentComposeTop').closest('#commentComposerMenu'),null);assert.equal(view.get('saveComment').closest('#commentComposerMenu').id,'commentComposerMenu');assert.equal(view.get('commentFormatting').hidden,true);
 assert.equal(calls.some(message=>['github-publish-comment','comment-publish','chat-message-write'].includes(message.type)),false);view.workspace.dispose();
});

test('catalog keeps readable results when only one conversation type fails',async()=>{
 const view=workspaceRuntime(async message=>{if(message.type==='chat-thread-list'){if(message.kind==='discussion')throw Error('Discussions require access.');return{threads:[{kind:'issue',number:7,title:'Retained issue'}],hasMore:false};}return[];});
 view.load();view.get('showComments').click();await new Promise(setImmediate);assert.match(view.get('commentThreadReader').textContent,/Retained issue/);assert.match(view.get('commentThreadStatus').textContent,/Discussions require access/);assert.equal(view.get('commentThreadStatus').classList.contains('error'),true);view.workspace.dispose();
});

test('catalog refresh, settings and committed search dismiss More before the next primary action',async()=>{
 const view=workspaceRuntime(async message=>message.type==='chat-thread-list'?{threads:[],hasMore:false}:[]);view.load();
 const menu=view.get('commentThreadReader').querySelector('.chat-catalog-more'),body=menu.querySelector('.chat-catalog-menu');
 menu.open=true;await body.children.find(node=>node.textContent==='Refresh conversations').click();assert.equal(menu.open,false);
 menu.open=true;body.children.find(node=>node.textContent==='Comment settings').click();assert.equal(menu.open,false);assert.equal(view.get('commentSettings').hidden,false);
 menu.open=true;const search=body.querySelector('input');let prevented=false;search.onkeydown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(menu.open,false);assert.equal(prevented,true);
 menu.open=true;view.get('newConversation').click();assert.equal(menu.open,false);assert.equal(view.get('commentEditor').hidden,false);view.workspace.dispose();
});

test('GitHub collaboration lives in View comments and preserves supported destinations without posting',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-policy-status')return{allowed:true,mode:'everyone'};return[];},{pullNumber:42,pullRepository:'wayri/reviews'});view.load();await new Promise(resolve=>setImmediate(resolve));
 view.get('showGitHub').click();assert.equal(view.get('githubPane').hidden,false);assert.equal(view.get('commentsPane').hidden,false);assert.equal(view.get('designInspector').hidden,true);assert.equal(view.get('commentCollaboration').open,true);assert.equal(view.get('viewCommentsTab').attributes['aria-selected'],'true');
 assert.equal(view.get('repositoryIssues').href,'https://github.com/wayri/reviews/issues');assert.equal(view.get('commentDestination').value,'pull-request');assert.equal(view.get('githubCommentType').value,'issue');
 view.get('githubCommentType').value='discussion';view.get('githubCommentType').onchange();assert.deepEqual(Array.from(view.get('commentDestination').children,e=>e.value),['discussion','existing-discussion']);assert.equal(view.get('commentDestination').value,'discussion');assert.equal(view.get('discussionCategoryLabel').hidden,false);
 view.get('commentDestination').value='existing-discussion';view.get('commentDestination').onchange();assert.equal(view.get('threadNumberLabel').hidden,false);assert.equal(view.get('discussionCategoryLabel').hidden,true);assert.equal(view.get('threadNumber').placeholder,'Discussion number');
 view.get('githubCommentType').value='issue';view.get('githubCommentType').onchange();assert.deepEqual(Array.from(view.get('commentDestination').children,e=>e.value),['issue','existing-issue','pull-request']);
 view.get('showComments').click();assert.equal(view.get('githubPane').closest('#commentSettings').id,'commentSettings');assert.equal(view.get('commentsPane').hidden,false);assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);
});
test('standalone viewer never offers current PR and VS Code remote collaboration remains unavailable',async()=>{
 const github=workspaceRuntime();assert.deepEqual(Array.from(github.get('commentDestination').children,e=>e.value),['issue','existing-issue']);
 for(const hooks of [{vscode:true},{provider:'gitlab',repository:'group/sub/project',vscode:true}]){
  const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);return[];},hooks);view.load();await new Promise(resolve=>setImmediate(resolve));view.get('showGitHub').click();
  assert.equal(view.get('githubPane').hidden,false);assert.equal(view.get('githubAvailableControls').hidden,true);assert.match(view.get('githubAvailability').textContent,/VS Code viewer/);
  assert.equal(calls.some(m=>m.type.startsWith('github-')||m.type==='comment-policy-status'),false);
 }
});

test('Android local projects explain phone repository collaboration without extension-only messaging',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);return[];},{android:true,androidOnline:false,vscode:true});view.load();await new Promise(resolve=>setImmediate(resolve));view.get('showGitHub').click();
 const message=view.get('githubAvailability').textContent;
 assert.match(message,/Library and accounts/);assert.match(message,/open the repository/);assert.doesNotMatch(message,/extension|VS Code/);
 assert.equal(view.get('githubAvailableControls').hidden,true);assert.equal(calls.some(m=>m.type==='comment-policy-status'),false);
});
test('new discussion publication requires the selected category and saved notes expose linked conversations',async()=>{
 const calls=[];let notes=[];const remoteRef={kind:'discussion',repository:'wayri/fixture',number:8,url:'https://github.com/wayri/fixture/discussions/8',publishedAt:'2026-10-04T00:00:00.000Z'};
 const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-discussion-categories')return[{id:'category-1',name:'Design review'}];if(m.type==='github-publish-comment')return{remoteRef};return[];});view.load();await new Promise(resolve=>setImmediate(resolve));
 view.get('githubCommentType').value='discussion';view.get('githubCommentType').onchange();view.get('newComment').click();view.get('commentText').value='Question about the board';await view.get('saveComment').click();view.get('commentDestination').value='discussion';view.get('commentDestination').onchange();await view.get('loadCategories').click();assert.equal(view.get('discussionCategory').children[0].textContent,'Design review');view.get('discussionCategory').value='category-1';
 const actions=view.get('commentList').children[0].children.at(-1);await action(actions,'Publish to GitHub').click();if(view.get('commentPostReview').open)await view.get('confirmCommentPost').click();await new Promise(setImmediate);const publish=calls.find(m=>m.type==='github-publish-comment');assert.equal(publish.destination,'new-discussion');assert.equal(publish.categoryId,'category-1');assert.match(view.get('githubThreadList').textContent,/discussion #8/);assert.equal(view.get('githubThreadList').children[0].children[0].href,remoteRef.url);
});

test('saved annotation type survives editing and rejects accidental publication to the other thread type',async()=>{
 let notes=[];const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}return[];});view.load();await new Promise(resolve=>setImmediate(resolve));
 view.get('newComment').click();view.get('commentText').value='Fix this issue';await view.get('saveComment').click();assert.equal(notes[0].threadType,'issue');assert.match(view.get('commentList').textContent,/Issue/);
 view.get('githubCommentType').value='discussion';view.get('githubCommentType').onchange();view.get('commentCategoryAll').click();let actions=view.get('commentList').children[0].children.at(-1);await action(actions,'Publish to GitHub').click();await view.get('confirmCommentPost').click();assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);assert.match(view.get('commentStatus').textContent,/Choose a matching destination/);
 action(actions,'Edit').click();assert.equal(view.get('githubCommentType').value,'issue');
 view.get('githubCommentType').value='discussion';view.get('githubCommentType').onchange();await view.get('saveComment').click();assert.equal(notes[0].threadType,'discussion');
});

test('all shared viewers contain exactly one collaboration control and a distinct GitHub pane',()=>{
 for(const file of ['pcb-viewer.html','schematic-viewer.html','revision-viewer.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  for(const id of ['showGitHub','githubPane','githubCommentType','commentDestination','reviewSettings','refreshCommentPolicy','refreshGitHub','severityFilter'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${file}: ${id}`);
  assert.match(html,/<section id="githubPane" hidden>/);assert.match(html,/Comment type <select id="githubCommentType">/);assert.match(html,/Post to GitHub uploads a captured screenshot/);assert.match(html,/Use Reply to start a new anchored draft/);assert.match(html,/Use View comments → Load thread to read ordinary messages and replies here/);
 }
});

test('editor posts formatted Issue and Discussion directly and saves confirmed thread links',async()=>{
 for(const type of ['issue','discussion']){
  let notes=[];const calls=[];const remoteRef={kind:type,repository:'wayri/fixture',number:12,url:`https://github.com/wayri/fixture/${type==='issue'?'issues':'discussions'}/12`,publishedAt:'2026-10-04T00:00:00.000Z'};
  const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-discussion-categories')return[{id:'category-1',name:'Design review'}];if(m.type==='github-publish-comment')return{remoteRef};return[];});view.load();await new Promise(resolve=>setImmediate(resolve));
  view.get('newComment').click();view.get('commentText').value='Check connector clearance';view.get('commentSeverity').value='major';view.get('editorThreadType').value=type;view.get('editorThreadType').onchange();view.get('editorTitle').value='Connector clearance review';
  if(type==='discussion'){view.get('editorDestination').value='discussion';view.get('editorDestination').onchange();await view.get('editorLoadCategories').click();}
  view.get('editorPreview').click();assert.match(view.get('editorMarkdown').textContent,/## KiCad visual review/);assert.doesNotMatch(view.get('editorMarkdown').textContent,/kicad-review:v1/);assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);
  await sendComment(view);const publication=calls.find(m=>m.type==='github-publish-comment');assert.equal(publication.destination,`new-${type}`);assert.equal(publication.title,'Check connector clearance');assert.equal(publication.comment.threadType,type);if(type==='discussion')assert.equal(publication.categoryId,'category-1');assert.equal(notes[0].remoteRefs[0].url,remoteRef.url);assert.equal(view.get('commentEditor').hidden,true);assert.match(view.get('commentStatus').textContent,/Posted to GitHub/);
 }
});

test('editor validates existing thread destinations before saving or posting',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);return[];});view.load();await new Promise(resolve=>setImmediate(resolve));view.get('newComment').click();view.get('commentText').value='Review';view.get('editorDestination').value='existing-issue';view.get('editorDestination').onchange();view.get('editorThreadNumber').value='0';await sendComment(view);assert.equal(calls.some(m=>m.type==='comment-save'||m.type==='github-publish-comment'),false);assert.match(view.get('commentStatus').textContent,/positive GitHub thread number/);assert.equal(view.get('commentEditor').hidden,false);
});

test('confirmed GitHub screenshot URLs persist with the remote thread and display without local PNG bytes',async()=>{
 let notes=[];
 const attachment={provider:'github',repository:'wayri/fixture',mime:'image/png',width:200,height:100,url:'https://github.com/user-attachments/assets/01234567-89ab-cdef-0123-456789abcdef'};
 const remoteRef={kind:'issue',repository:'wayri/fixture',number:12,url:'https://github.com/wayri/fixture/issues/12',publishedAt:'2026-10-04T00:00:00.000Z'};
 const view=workspaceRuntime(async m=>{if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')return{remoteRef,attachments:[attachment]};return[];});
 view.load();await new Promise(resolve=>setImmediate(resolve));view.get('newComment').click();view.get('commentText').value='Screenshot context';await sendComment(view);
 assert.deepEqual(JSON.parse(JSON.stringify(notes[0].attachments)),[attachment]);
 const findImages=node=>[...(node.tagName==='IMG'?[node]:[]),...node.children.flatMap(findImages)];
 assert.equal(findImages(view.get('commentList'))[0].src,attachment.url);
 assert.equal(findImages(view.get('commentList'))[0].referrerPolicy,'no-referrer');
 const elements=node=>[node,...node.children.flatMap(elements)];
 assert.equal(elements(view.get('commentList')).some(node=>node.tagName==='BUTTON'&&['Edit','Delete','Resolve','Skip'].includes(node.textContent)),false,'published content is changed only through its provider conversation');
 assert.equal(notes[0].attachments.length,1,'rendering published content never rewrites its cache');
 assert.ok(elements(view.get('commentList')).some(node=>node.tagName==='BUTTON'&&node.textContent==='View thread'));
});

test('editor routes replies to the selected existing Issue or Discussion number',async()=>{
 for(const type of ['issue','discussion']){
  let notes=[];const calls=[];const remoteRef={kind:type,repository:'wayri/fixture',number:42,url:`https://github.com/wayri/fixture/${type==='issue'?'issues':'discussions'}/42`,publishedAt:'2026-10-04T00:00:00.000Z'};
  const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')return{remoteRef};return[];});view.load();await new Promise(resolve=>setImmediate(resolve));view.get('newComment').click();view.get('commentText').value='Additional clearance evidence';view.get('editorThreadType').value=type;view.get('editorThreadType').onchange();view.get('editorDestination').value=`existing-${type}`;view.get('editorDestination').onchange();view.get('editorThreadNumber').value='42';await sendComment(view);const publication=calls.find(m=>m.type==='github-publish-comment');assert.equal(publication.destination,type);assert.equal(publication.number,42);assert.equal(publication.categoryId,undefined);assert.equal(notes[0].remoteRefs[0].number,42);
 }
});

test('failed direct publication preserves a saved editable draft and does not repeat the request',async()=>{
 let notes=[];const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')throw new Error('Connect GitHub to publish');return[];});view.load();await new Promise(resolve=>setImmediate(resolve));view.get('newComment').click();view.get('commentText').value='Review';await sendComment(view);assert.equal(notes.length,1);assert.equal(notes[0].remoteRefs.length,0);assert.equal(view.get('commentEditor').hidden,false);assert.match(view.get('commentStatus').textContent,/draft remains saved/);assert.equal(calls.filter(m=>m.type==='github-publish-comment').length,1);
});

test('GitLab direct publication saves confirmed issue links and discussions target existing issues',async()=>{
 for(const type of ['issue','discussion']){
  const calls=[];let notes=[];const remoteRef={provider:'gitlab',host:'https://gitlab.example.com',kind:'issue',repository:'group/project',number:42,url:'https://gitlab.example.com/group/project/-/issues/42',publishedAt:'2026-10-04T00:00:00.000Z'};
  const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='comment-publish')return{remoteRef};if(m.type==='comment-policy-status')return{allowed:true};return[];},{provider:'gitlab',host:'https://gitlab.example.com',repository:'group/project'});view.load();await new Promise(resolve=>setImmediate(resolve));
  view.get('newComment').click();view.get('commentText').value='Review connectivity';view.get('editorThreadType').value=type;view.get('editorThreadType').onchange();view.get('editorTitle').value='Connectivity review';
  if(type==='discussion'){assert.deepEqual(Array.from(view.get('editorDestination').children,e=>e.value),['existing-issue']);view.get('editorThreadNumber').value='42';}
  assert.equal(view.get('editorCategoryLabel').hidden,true);await sendComment(view);
  const publication=calls.find(m=>m.type==='comment-publish');assert.equal(publication.provider,'gitlab');assert.equal(publication.host,'https://gitlab.example.com');assert.equal(publication.destination,type==='discussion'?'issue':'new-issue');assert.equal(publication.discussion,type==='discussion'?true:undefined);assert.equal(publication.categoryId,undefined);assert.equal(publication.comment.threadType,type);
  assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);assert.equal(notes[0].remoteRefs[0].url,remoteRef.url);assert.match(view.get('commentStatus').textContent,/Posted to GitLab issue #42/);
 }
});
test('GitLab annotations readback and settings retain exact provider host and no GitHub category lookup',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-remote-list')return{notes:[],warnings:['Only marked review notes are included.']};return[];},{provider:'gitlab',host:'https://gitlab.example.com',repository:'group/project'});await view.get('refreshGitHub').click();await view.get('reviewSettings').click();assert.equal(calls.find(m=>m.type==='comment-remote-list').host,'https://gitlab.example.com');assert.equal(calls.find(m=>m.type==='open-options').provider,'gitlab');assert.match(view.get('commentStatus').textContent,/Loaded 0 GitLab annotations/);view.get('githubCommentType').value='discussion';view.get('githubCommentType').onchange();assert.equal(view.get('loadCategories').hidden,true);assert.deepEqual(Array.from(view.get('commentDestination').children,e=>e.value),['existing-issue']);
});

test('existing Discussion readback forwards the selected thread number without an Issue lookup',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='github-annotations')return{notes:[],warnings:[]};return[];});
 view.get('githubCommentType').value='discussion';view.get('githubCommentType').onchange();view.get('commentDestination').value='existing-discussion';view.get('threadNumber').value='17';await view.get('refreshGitHub').click();
 const request=calls.find(m=>m.type==='github-annotations');assert.equal(request.discussionNumber,17);assert.equal(request.issueNumber,undefined);assert.equal(request.includeDiscussions,true);
});

test('Reply to a remote annotation retains its drawing anchor and selects the existing thread without posting',async()=>{
 const calls=[],note={id:'remote-note',text:'Review this part',createdAt:'2026-10-04T00:00:00Z',severity:'major',threadType:'discussion',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb',position:{x:3,y:4}},github:{source:'discussion-comment',number:17,state:'open',author:'alice',url:'https://github.com/wayri/fixture/discussions/17#discussioncomment-1',createdAt:'2026-10-04T01:00:00Z',updatedAt:'2026-10-04T02:00:00Z'}};
 const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='github-annotations')return{notes:[note],warnings:[]};return[];});await view.get('refreshGitHub').click();
 const elements=node=>[node,...node.children.flatMap(elements)];elements(view.get('commentList')).find(node=>node.tagName==='BUTTON'&&node.textContent==='Reply').click();
 assert.equal(view.get('editorDestination').value,'existing-discussion');assert.equal(view.get('editorThreadNumber').value,'17');assert.equal(view.get('commentText').value,'');assert.match(view.get('commentAnchor').textContent,/3.00, 4.00/);assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);
});

test('net review drafts preserve the selected saved net name in formatted GitHub context',async()=>{
 let notes=[];const view=workspaceRuntime(async m=>{if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}return[];});view.load();view.get('netList').children[0].click();view.get('newComment').click();view.get('commentText').value='Review this net';view.get('editorPreview').click();assert.match(view.get('editorMarkdown').textContent,/\| Net \| SIGNAL \|/);await view.get('saveComment').click();assert.equal(notes[0].anchor.kind,'net');assert.equal(notes[0].anchor.netName,'SIGNAL');
});

test('uncertain posting exposes a read-only recovery control and saves its confirmed link without another publication',async()=>{
 let notes=[];const calls=[],ref={kind:'issue',repository:'wayri/fixture',number:19,url:'https://github.com/wayri/fixture/issues/19',publishedAt:'2026-10-05T01:00:00.000Z'};
 const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')throw Error('Unconfirmed outcome');if(m.type==='github-recover-publication')return{remoteRef:ref,recovered:true};return[];});
 view.load();await new Promise(setImmediate);view.get('newComment').click();view.get('commentText').value='Check connection';await sendComment(view);
 const row=view.get('postComment').parentElement.querySelector('.publication-recovery');assert.ok(row);assert.match(row.textContent,/never creates another post/);row.querySelector('input').value='19';await row.querySelector('button').click();
 const recovery=calls.find(m=>m.type==='github-recover-publication');assert.equal(recovery.recoveryNumber,19);assert.equal(recovery.destination,'new-issue');assert.equal(calls.filter(m=>m.type==='github-publish-comment').length,1);assert.equal(notes[0].remoteRefs[0].url,ref.url);assert.match(view.get('commentStatus').textContent,/Recovered link to/);assert.equal(view.get('postComment').parentElement.querySelector('.publication-recovery'),null);
});

test('auto-hide preserves focused comment input, hides after leaving, and restores its draft',async()=>{
 const view=workspaceRuntime();view.get('newComment').click();view.get('commentText').value='Unsaved draft';view.document.activeElement=view.get('commentText');
 view.get('commentsSidebar').dispatchEvent(new Event('pointerleave'));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(view.get('commentsSidebar').hidden,false);
 view.document.activeElement=null;view.get('commentsSidebar').dispatchEvent(new Event('focusout'));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(view.get('commentsSidebar').hidden,true);
 view.get('dockComments').dispatchEvent(new Event('pointerenter'));view.get('dockComments').click();assert.equal(view.get('commentsSidebar').hidden,false);assert.equal(view.get('commentText').value,'Unsaved draft');
 view.get('dockComments').dispatchEvent(new Event('pointerleave'));view.get('commentsSidebar').dispatchEvent(new Event('pointerenter'));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(view.get('commentsSidebar').hidden,false);view.workspace.dispose();
});
test('touch scrolling and taps within properties do not schedule hover dismissal',async()=>{
 const view=workspaceRuntime();view.get('propertiesButton').click();const panel=view.get('designInspector');
 panel.dispatchEvent(uiEvent('pointerenter',{pointerType:'touch'}));
 panel.dispatchEvent(uiEvent('pointerdown',{pointerType:'touch'}));
 panel.dispatchEvent(uiEvent('pointerleave',{pointerType:'touch'}));
 await new Promise(resolve=>setTimeout(resolve,380));assert.equal(panel.hidden,false);
 panel.dispatchEvent(uiEvent('pointerleave',{pointerType:'pen'}));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(panel.hidden,false);
 view.get('drawingHost').dispatchEvent(new Event('pointerdown'));assert.equal(panel.hidden,true);view.workspace.dispose();
});
test('context menu on an object does not open Properties until Inspect is chosen',()=>{
 const selections=[];const view=workspaceRuntime(undefined,{query:()=>[{bbox:{context:{uuid:'fp',reference:'R1'}}}],onSelection:value=>selections.push(value)});view.load();
 view.canvas.canvas.dispatchEvent(uiEvent('contextmenu',{clientX:30,clientY:30,button:2}));
 assert.equal(view.get('designInspector').hidden,true);assert.equal(view.get('objectMenu').hidden,false);assert.equal(selections.length,0);
 view.get('objectMenu').children.find(b=>b.textContent==='Inspect properties').click();
 assert.equal(view.get('designInspector').hidden,false);assert.equal(view.get('selectedName').textContent,'R1');assert.equal(view.get('objectMenu').hidden,true);assert.equal(selections.length,1);view.workspace.dispose();
});
test('context comment uses the pressed object without opening Properties',()=>{
 const view=workspaceRuntime(undefined,{query:()=>[{bbox:{context:{uuid:'fp',reference:'R1'}}}]});view.load();
 view.canvas.canvas.dispatchEvent(uiEvent('contextmenu',{clientX:30,clientY:30,button:2}));
 view.get('objectMenu').children.find(b=>b.textContent==='Comment on object').click();
 assert.equal(view.get('designInspector').hidden,true);assert.equal(view.get('commentsSidebar').hidden,false);assert.match(view.get('commentAnchor').textContent,/R1/);view.workspace.dispose();
});
test('interaction within a panel cancels pending mouse dismissal without blocking outside dismissal',async()=>{
 for(const action of ['pointerdown','wheel','scroll']){
  const view=workspaceRuntime();view.get('propertiesButton').click();const panel=view.get('designInspector');
  panel.dispatchEvent(uiEvent('pointerleave',{pointerType:'mouse'}));panel.dispatchEvent(new Event(action));
  await new Promise(resolve=>setTimeout(resolve,380));assert.equal(panel.hidden,false,action);
  panel.dispatchEvent(uiEvent('pointerleave',{pointerType:'mouse'}));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(panel.hidden,true);view.workspace.dispose();
 }
});
test('pinning prevents pending auto-hide; unpinning resumes it and disposal cancels timers',async()=>{
 const view=workspaceRuntime();view.get('dockNavigator').click();view.get('designNavigator').dispatchEvent(new Event('pointerleave'));view.get('pinNavigator').click();await new Promise(resolve=>setTimeout(resolve,380));assert.equal(view.get('designNavigator').hidden,false);
 view.get('pinNavigator').click();view.get('designNavigator').dispatchEvent(new Event('pointerleave'));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(view.get('designNavigator').hidden,true);
 view.get('dockNavigator').click();view.get('designNavigator').dispatchEvent(new Event('pointerleave'));view.workspace.dispose();await new Promise(resolve=>setTimeout(resolve,380));assert.equal(view.get('designNavigator').hidden,false);
});
test('three pinned panes retain drawing width and reuse width resizing',()=>{
 const view=workspaceRuntime(undefined,{width:600});for(const name of ['Navigator','Properties','Comments']){view.get('dock'+name).click();view.get('pin'+name).click();}
 const panel=view.get('commentsSidebar'),handle=panel.querySelector('.sidebar-resizer');handle.dispatchEvent(uiEvent('keydown',{key:'ArrowLeft',shiftKey:false}));
 const reserved=parseFloat(view.get('reviewWorkspace').style['--pinned-left-width'])+parseFloat(view.get('reviewWorkspace').style['--pinned-right-width']);assert.ok(reserved<=(600-64)*.65+1);assert.equal(panel.style.height,'300px');assert.equal(view.get('pinComments').attributes['aria-pressed'],'true');view.workspace.dispose();
});
 test('comment actions restore focus view and reveal the editor in short panes',()=>{
 const view=workspaceRuntime(undefined,{width:600,frameHeight:500,workspaceHeight:434});view.load();
 view.get('focusView').click();view.get('commentsButton').click();assert.equal(view.get('commentsSidebar').hidden,false);assert.equal(view.get('commentsSidebar').classList.contains('compact-sidebar'),false);
 view.get('focusView').click();view.key('c');assert.equal(view.get('commentsSidebar').hidden,false);assert.equal(view.get('addCommentPane').hidden,false);assert.equal(view.get('commentEditor').hidden,false);assert.equal(view.get('commentsSidebar').style.height,'434px');assert.equal(view.get('focusView').textContent,'Focus view');
 const event=uiEvent('contextmenu',{clientX:30,clientY:30,button:2});view.canvas.canvas.dispatchEvent(event);view.get('objectMenu').children.find(b=>/Comment/.test(b.textContent)).click();assert.equal(view.get('commentEditor').hidden,false);assert.equal(view.get('commentsSidebar').classList.contains('compact-sidebar'),false);
 });

 test('mention picker inserts contributors without posting and rejects stale lookup results',async()=>{
 let finish,calls=[];const view=workspaceRuntime(async message=>{calls.push(message);if(message.type==='comment-mention-users')return await new Promise(resolve=>finish=resolve);return[];});view.load();view.get('newComment').click();view.get('mentionSource').value='repository';const lookup=view.get('mentionSource').onchange();finish({users:[{login:'wayri',name:'Reviewer',roles:['Contributor']}],warnings:[]});await lookup;
 const suggestions=view.get('mentionSuggestions');assert.equal(suggestions.children.length,1);suggestions.children[0].click();suggestions.children[0].click();assert.equal(view.get('commentMentions').value,'@wayri');assert.match(view.get('mentionLookupStatus').textContent,/only when posted/);assert.equal(calls.some(m=>/publish/.test(m.type)),false);
 const pending=view.get('mentionSource').onchange();view.workspace.dispose();finish({users:[{login:'other',roles:['User']}],warnings:[]});await pending;assert.equal(suggestions.children.length,0);
 });

 test('PCB hierarchical net cross-highlight opens its saved schematic sheet and highlights refreshed geometry',()=>{
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (sheet (at 0 0) (size 10 10) (uuid "sheet-1") (property "Sheetname" "Power") (property "Sheetfile" "power.kicad_sch")))'},{path:'power.kicad_sch',content:'(kicad_sch (label "ENABLE" (at 1 1 0) (uuid "label-1")) (wire (pts (xy 1 1) (xy 10 1)) (uuid "wire-1")))'}];
 let active=files[0].path,view;const designs=new Map();view=workspaceRuntime(async()=>[],{pcb:false,files,currentFile:()=>active,getDesigns:()=>designs,openSheet:path=>{active=path;const file=files.find(f=>f.path===path),design=require('../schematic-renderer.js').build(require('../design-diff.js').parse(file.content),path);designs.set(path,design);view.canvas.design=design;view.canvas.primitives=design.primitives;view.workspace.draw();}});view.load();
 assert.equal(view.workspace.highlightRelated({kind:'net',path:'board.kicad_pcb',netName:'/Power/ENABLE'}),true);assert.equal(active,'power.kicad_sch');assert.equal(view.canvas.netHighlight.name,'ENABLE');assert.ok(view.canvas.netPrimitives.size>0);
 });

 test('comment view exposes state and sorting filters, updates cards and resets without publishing',async()=>{
 const notes=['open','resolved','skipped','wont-fix'].map((state,i)=>({id:state,text:'Note '+state,state,severity:['minor','critical','major','info'][i],createdAt:`2026-10-0${i+1}T00:00:00Z`,updatedAt:`2026-10-0${i+1}T00:00:00Z`,anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'}}));const calls=[];const view=workspaceRuntime(async message=>{calls.push(message.type);return message.type==='comment-list'?notes:[];});view.load();await view.workspace.refreshComments();view.get('commentsButton').click();assert.equal(view.get('commentFilters').open,true);assert.equal(view.get('commentFilters').contains(view.get('stateFilter')),true);
 view.get('stateFilter').value='closed';view.get('stateFilter').onchange();let cards=view.get('commentList').children;assert.equal(cards.length,2);assert.match(cards[0].textContent,/Note resolved/);assert.match(cards[1].textContent,/Note wont-fix/);
 view.get('commentSort').value='severity-lowest';view.get('commentSort').onchange();assert.match(view.get('commentList').children[0].textContent,/Note wont-fix/);
 view.get('stateFilter').value='skipped';view.get('stateFilter').onchange();assert.equal(view.get('commentList').children.length,1);assert.match(view.get('commentList').textContent,/Note skipped/);
 view.get('resetCommentFilters').click();assert.equal(view.get('stateFilter').value,'all');assert.equal(view.get('commentSort').value,'severity');assert.equal(view.get('commentList').children.length,4);assert.equal(calls.some(t=>/publish|comment-save/.test(t)),false);
 });

 test('Issue and Discussion category tabs separate notes, preserve drafts, and choose matching GitHub destinations',async()=>{
 const notes=['issue','discussion',null].map((threadType,i)=>({id:'category-'+i,text:'Category '+(threadType||'legacy'),...(threadType?{threadType}:{}),state:'open',severity:'info',createdAt:'2026-10-01T00:00:00Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'}})),calls=[];const view=workspaceRuntime(async message=>{calls.push(message.type);return message.type==='comment-list'?notes:[];});view.load();await view.workspace.refreshComments();
 assert.match(view.get('commentCategoryIssue').textContent,/Issues \(1\)/);assert.match(view.get('commentCategoryDiscussion').textContent,/Discussions \(1\)/);view.get('commentCategoryIssue').click();assert.equal(view.get('commentList').children.length,1);assert.match(view.get('commentList').textContent,/Category issue/);assert.equal(view.get('commentCategoryContent').attributes['aria-labelledby'],'commentCategoryIssue');
 view.get('newComment').click();view.get('commentText').value='Keep issue draft';assert.equal(view.get('editorThreadType').value,'issue');assert.equal(view.get('editorDestination').value,'issue');view.get('commentCategoryDiscussion').click();assert.equal(view.get('editorThreadType').value,'issue');assert.equal(view.get('commentText').value,'Keep issue draft');assert.match(view.get('commentList').textContent,/Category discussion/);
 view.get('cancelComment').click();view.get('newComment').click();assert.equal(view.get('editorThreadType').value,'discussion');assert.equal(view.get('editorDestination').value,'discussion');assert.equal(view.get('editorCategoryLabel').hidden,false);view.get('cancelComment').click();view.get('commentCategoryAll').click();assert.equal(view.get('commentList').children.length,3);
 view.get('commentCategoryTabs').dispatchEvent(uiEvent('keydown',{key:'Home'}));assert.equal(view.get('commentCategoryIssue').attributes['aria-selected'],'true');view.get('commentCategoryTabs').dispatchEvent(uiEvent('keydown',{key:'ArrowRight'}));assert.equal(view.get('commentCategoryDiscussion').attributes['aria-selected'],'true');assert.equal(calls.some(t=>/publish|comment-save/.test(t)),false);
 });
 test('category-created issue and discussion drafts publish only to their selected GitHub thread type',async()=>{
 for(const type of ['issue','discussion']){let notes=[];const calls=[];const view=workspaceRuntime(async message=>{calls.push(message);if(message.type==='comment-save'){notes=[message.comment];return message.comment;}if(message.type==='comment-list')return notes;if(message.type==='github-discussion-categories')return[{id:'DIC_review',name:'Design review'}];if(message.type==='comment-policy-status')return{allowed:true,mode:'all'};if(message.type==='github-publish-comment')return{remoteRef:{kind:type,repository:'wayri/fixture',number:42,url:`https://github.com/wayri/fixture/${type==='issue'?'issues':'discussions'}/42`,publishedAt:'2026-10-05T00:00:00Z'}};return[];});view.load();await new Promise(resolve=>setImmediate(resolve));view.get(type==='issue'?'commentCategoryIssue':'commentCategoryDiscussion').click();view.get('newComment').click();view.get('commentText').value='Category review';view.get('editorTitle').value='Category review';if(type==='discussion'){await new Promise(setImmediate);view.get('editorDestination').value='discussion';view.get('editorDestination').onchange();view.get('editorCategory').value='DIC_review';}await sendComment(view);const publication=calls.find(m=>m.type==='github-publish-comment');assert.ok(publication,view.get('commentStatus').textContent);assert.equal(publication.comment.threadType,type);assert.equal(publication.destination,type==='issue'?'new-issue':'new-discussion');assert.equal(view.get('commentEditor').hidden,true);assert.match(view.get('commentList').textContent,/Category review/);}
 });

const groupBoard='(kicad_pcb '+['R1','R2','R3'].map((ref,i)=>`(footprint "Resistor" (layer "F.Cu") (at ${10+i*10} 20) (uuid "fp${i}") (property "Reference" "${ref}") (property "Value" "10k") (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (uuid "pad${i}")))`).join(' ')+')';
test('canvas additive selection highlights the whole group, toggles members and clears its companion',()=>{
 const selections=[],view=workspaceRuntime(undefined,{source:groupBoard,onSelection:s=>selections.push(s)});view.load();
 const pick=(uuid,multi)=>view.canvas.dispatchEvent(new CustomEvent('kicad:select',{detail:{item:{uuid},multi}}));
 pick('fp0',false);pick('fp1',true);assert.match(view.get('highlightSummary').textContent,/2 components/);
 assert.deepEqual(Array.from(selections.at(-1).items,i=>i.reference),['R1','R2']);assert.ok(view.canvas.netPrimitives.has(view.design.primitives.find(p=>p.ownerUuid==='fp0')));
 pick('fp2',true);pick('fp1',true);assert.deepEqual(Array.from(selections.at(-1).items,i=>i.reference),['R1','R3']);assert.match(view.get('highlightSummary').textContent,/2 components/);
 view.get('clearHighlights').click();assert.equal(selections.at(-1).kind,'group');assert.equal(selections.at(-1).items.length,0);assert.equal(view.canvas.netPrimitives.size,0);
});
test('multihighlight checkbox and modifier clicks on Parts retain group membership',()=>{
 const selections=[],view=workspaceRuntime(undefined,{source:groupBoard,onSelection:s=>selections.push(s)});view.load();
 view.get('objectList').children[0].click();view.get('objectList').children[1].onclick({ctrlKey:true});assert.equal(selections.at(-1).items.length,2);
 view.get('multiHighlight').checked=true;view.get('objectList').children[2].click();assert.equal(selections.at(-1).items.length,3);
 assert.ok(view.get('objectList').children.every(row=>row.attributes['aria-pressed']==='true'));
});
test('received group highlights all matched footprints without enabling the multihighlight checkbox',()=>{
 const view=workspaceRuntime(undefined,{source:groupBoard});view.load();const items=['R1','R2'].map(reference=>({kind:'part',reference,path:'root.kicad_sch'}));
 assert.equal(view.workspace.highlightRelated({kind:'group',items}),true);assert.match(view.get('highlightSummary').textContent,/2 components/);assert.equal(view.get('multiHighlight').checked,false);
 const uuids=new Set([...view.canvas.netPrimitives].map(p=>p.ownerUuid||p.uuid));assert.ok(uuids.has('fp0'));assert.ok(uuids.has('fp1'));
 view.workspace.highlightRelated({kind:'group',items:[]});assert.equal(view.canvas.netPrimitives.size,0);
});
test('selecting a loaded sheet includes its descendant parts in one cross-highlight group',()=>{
 const symbol=(ref,uuid)=>`(symbol (lib_id "Device:R") (at 20 20 0) (uuid "${uuid}") (property "Reference" "${ref}") (property "Value" "10k"))`;
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (sheet (at 0 0) (size 10 10) (uuid "s") (property "Sheetname" "Power") (property "Sheetfile" "child.kicad_sch")))'},
 {path:'child.kicad_sch',content:'(kicad_sch '+symbol('R1','r1')+' (sheet (at 0 0) (size 10 10) (uuid "t") (property "Sheetfile" "leaf.kicad_sch")))'},
 {path:'leaf.kicad_sch',content:'(kicad_sch '+symbol('R2','r2')+')'}];
 const selections=[],view=workspaceRuntime(undefined,{pcb:false,files,onSelection:s=>selections.push(s)});view.load();view.get('navSheets').click();
 const tree=view.get('sheetList').children.find(node=>node.classList.contains('sheet-tree'));tree.children[1].children.find(node=>node.classList.contains('sheet-open')).click();
 assert.deepEqual(Array.from(selections.at(-1).items,i=>i.reference),['R1','R2']);assert.match(view.get('reviewNotice').textContent,/2 loaded sheets/);
});

test('toolbar opens an independent movable, minimizable check window and explorer navigation preserves it',()=>{
 const view=workspaceRuntime(undefined,{navigation:true});view.load();const win=view.get('ruleWindow'),header=view.get('ruleWindowHeader');
 assert.equal(win.hidden,true);assert.equal(view.get('viewRuleChecks').textContent,'DRC');view.get('viewRuleChecks').click();
 assert.equal(win.hidden,false);assert.equal(view.get('designNavigator').hidden,true);assert.equal(view.get('rulesPane').parentElement.id,'ruleWindow');assert.equal(win.attributes['aria-modal'],'false');
 const before=parseFloat(win.style.left);header.dispatchEvent(uiEvent('keydown',{key:'ArrowRight'}));assert.equal(parseFloat(win.style.left),before+10);
 header.dispatchEvent(uiEvent('pointerdown',{button:0,clientX:50,clientY:50,pointerId:5}));header.dispatchEvent(uiEvent('pointermove',{clientX:90,clientY:70,pointerId:5}));header.dispatchEvent(uiEvent('pointerup',{pointerId:5}));assert.equal(parseFloat(win.style.left),before+50);
 view.get('minimizeRuleWindow').click();assert.equal(view.get('rulesPane').hidden,true);view.get('minimizeRuleWindow').click();assert.equal(view.get('rulesPane').hidden,false);
 view.get('navParts').click();assert.equal(win.hidden,false);assert.equal(view.get('rulesPane').hidden,false);
 view.get('closeRuleWindow').click();assert.equal(win.hidden,true);assert.equal(view.get('viewRuleChecks').attributes['aria-expanded'],'false');assert.equal(view.get('viewRuleChecks').focused,true);
});
test('floating DRC result rows jump to the drawing, retain report after closing and leave markers visible',async()=>{
 const focused=[],view=workspaceRuntime(async()=>[],{navigation:true,focus:p=>focused.push(p)});view.load();view.get('viewRuleChecks').click();
 const report={source:'board.kicad_pcb',date:'2026-10-05T00:00:00Z',kicad_version:'10.0.0',coordinate_units:'mm',violations:[{type:'clearance',description:'Track clearance',severity:'error',items:[{description:'Track',pos:{x:30,y:40}},{description:'Pad',pos:{x:31,y:40}}]}]};
 view.get('ruleReportFile').files=[{size:300,name:'board-drc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();assert.equal(view.get('ruleReportSources').open,false);
 view.get('ruleResults').children[0].children[0].click();assert.deepEqual(focused[0],{x:30,y:40});assert.ok(view.get('reviewOverlay').children.some(n=>n.attributes.d?.includes('L')));
 view.get('nextRuleItem').click();assert.deepEqual(focused[1],{x:31,y:40});view.get('closeRuleWindow').click();assert.ok(view.get('commentPins').children.some(n=>n.className.includes('rule-marker')));
 view.get('viewRuleChecks').click();assert.match(view.get('ruleCount').textContent,/1 saved/);view.get('clearRuleReports').click();assert.match(view.get('ruleCount').textContent,/0 saved/);
});
test('DRC/ERC controls toggle findings independently from synchronized saved-report markers',async()=>{
 for(const pcb of [true,false]){
  const files=pcb?undefined:[{path:'board.kicad_sch',content:'(kicad_sch (uuid root))'}];const view=workspaceRuntime(undefined,{navigation:true,pcb,...(files?{files}: {})});view.load();const kind=pcb?'DRC':'ERC',toggle=view.get('toggleRuleMarkers'),check=view.get('showRuleMarkers');
  assert.equal(view.get('viewRuleChecks').attributes['data-icon'],kind.toLowerCase());assert.equal(toggle.attributes['aria-pressed'],'true');
  const violation={type:'clearance',description:'Saved finding',severity:'error',items:[{description:'Item',pos:{x:30,y:40}}]},report={source:pcb?'board.kicad_pcb':'board.kicad_sch',date:'2026-10-05T00:00:00Z',kicad_version:'10.0.0',coordinate_units:'mm',...(pcb?{violations:[violation]}:{sheets:[{uuid_path:'/',path:'/',violations:[violation]}]})};
  view.get('ruleReportFile').files=[{size:300,name:'checks.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();
  const markers=()=>view.get('commentPins').children.filter(n=>n.className.includes('rule-marker')).length;
  assert.ok(markers()>0);const count=view.get('ruleCount').textContent;
  toggle.click();assert.equal(check.checked,false);assert.equal(markers(),0);assert.equal(toggle.attributes['data-icon'],'eye-off');assert.equal(toggle.attributes['aria-label'],`Show ${kind} markers`);assert.equal(view.get('ruleCount').textContent,count);
  check.checked=true;check.onchange();check.dispatchEvent(new Event('change'));assert.ok(markers()>0);assert.equal(toggle.attributes['aria-pressed'],'true');
  view.get('closeRuleWindow').click();view.get('viewRuleChecks').click();assert.equal(view.get('ruleWindow').hidden,false);view.get('viewRuleChecks').click();assert.equal(view.get('ruleWindow').hidden,true);assert.ok(markers()>0);
 }
});
test('calculator shortcut retains repository context and closes the mobile tools sheet',()=>{
 const calls=[],view=workspaceRuntime(undefined,{engineeringLauncher:{open:(...args)=>calls.push(args)}});let closed=false;view.document.body.append(view.get('androidToolsSheet'));view.get('androidToolsSheet').close=()=>{closed=true;};view.get('openCalculators').click();assert.equal(closed,true);assert.equal(calls[0][0],'calculator-viewer.html');assert.equal(calls[0][1].repository,'wayri/fixture');assert.equal(calls[0][1].ref,'main');assert.equal(calls[0][1].file,undefined);
});
test('schematic ERC window jumps to an explicitly associated loaded subsheet and rejects unresolved locations',async()=>{
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (uuid root))'},{path:'child.kicad_sch',content:'(kicad_sch (uuid child))'}],opened=[];
 const view=workspaceRuntime(undefined,{navigation:true,pcb:false,files,openSheet:(file,position)=>opened.push({file,position})});view.load();view.get('viewRuleChecks').click();assert.equal(view.get('viewRuleChecks').textContent,'ERC');
 const report={source:'root.kicad_sch',date:'2026-10-05T00:00:00Z',kicad_version:'9.0.0',coordinate_units:'mm',sheets:[{uuid_path:'/',path:'/',violations:[{type:'pin_not_connected',description:'Unconnected pin',severity:'warning',items:[{description:'Pin',pos:{x:10,y:20}}]}]}]};
 view.get('ruleDrawing').value='child.kicad_sch';view.get('ruleReportFile').files=[{size:300,name:'erc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();view.get('ruleResults').children[0].children[0].click();assert.equal(opened[0].file,'child.kicad_sch');assert.deepEqual(opened[0].position,{x:10,y:20});
 view.get('clearRuleReports').click();delete report.sheets[0].violations[0].items[0].pos;view.get('ruleReportFile').files=[{size:300,name:'erc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();view.get('ruleResults').children[0].children[0].click();assert.equal(opened.length,1);assert.match(view.get('ruleStatus').textContent,/no resolved drawing location/);
});

test('check window reports blocked 3D navigation instead of claiming a successful drawing jump',async()=>{
 const focused=[],view=workspaceRuntime(undefined,{navigation:true,focus:p=>focused.push(p)});view.load();
 const report={source:'board.kicad_pcb',date:'2026-10-05T00:00:00Z',kicad_version:'10.0.0',coordinate_units:'mm',violations:[{type:'clearance',description:'Clearance',severity:'error',items:[{description:'Track',pos:{x:30,y:40}}]}]};
 view.get('ruleReportFile').files=[{size:250,name:'drc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();view.workspace.setScene({setPopulation(){}});view.get('nextRule').click();assert.equal(focused.length,0);assert.match(view.get('ruleStatus').textContent,/Cannot jump.*2D/);
});


test('compact composer inserts an inline mention and derives title and mentions on save',async()=>{
 let notes=[];const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-mention-users')return{users:[{login:'wayri',name:'Reviewer'}]};if(m.type==='comment-save'){notes=[m.comment];return m.comment;}return[];});view.load();await new Promise(r=>setImmediate(r));view.get('newComment').click();
 assert.equal(view.get('commentComposeTop').children.length,3);assert.equal(view.get('editorTitleLabel').parentElement.hidden,true);assert.equal(view.get('editorDestination').value,'issue');
 const box=view.get('commentText');box.value='Review title\nAsk @wa';box.selectionStart=box.value.length;box.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,240));assert.equal(view.get('inlineMentionSuggestions').hidden,false);view.get('inlineMentionSuggestions').children[0].click();assert.equal(box.value,'Review title\nAsk @wayri ');assert.equal(view.get('inlineMentionSuggestions').hidden,true);await view.get('saveComment').click();assert.deepEqual([...notes[0].mentions],['wayri']);assert.match(view.get('commentList').textContent,/Review title/);
});

test('pasted screenshot is saved with a draft and cancelled conversions cannot contaminate another draft',async()=>{
 let notes=[],finish;const view=workspaceRuntime(async m=>{if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}return[];},{compose:{normalizeCapture:()=>new Promise(r=>finish=r)}});view.load();await new Promise(r=>setImmediate(r));view.get('newComment').click();view.get('commentText').value='Evidence';
 const paste=()=>{const event=new Event('paste',{cancelable:true});Object.defineProperty(event,'clipboardData',{value:{items:[{kind:'file',type:'image/png',getAsFile:()=>new Blob(['image'],{type:'image/png'})}]}});view.get('commentText').dispatchEvent(event);assert.equal(event.defaultPrevented,true);};paste();assert.equal(view.get('capturePreview').hidden,false);assert.match(view.get('capturePreview').src,/^blob:/);assert.equal(view.get('removeCapture').hidden,false);assert.equal(view.get('capturePreview').closest('details'),null);await view.get('saveComment').click();assert.equal(notes.length,0);assert.match(view.get('commentStatus').textContent,/Wait for/);view.get('cancelComment').click();view.get('newComment').click();finish({dataUrl:'data:image/png;base64,aGVsbG8=',width:1,height:1});await new Promise(r=>setImmediate(r));assert.equal(view.get('capturePreview').hidden,true);
});

test('thread reader shows ordinary text safely, filters dates, and prepares a reply without posting',async()=>{
 const calls=[];const thread={kind:'discussion',number:7,title:'Design question',url:'https://github.com/wayri/fixture/discussions/7',state:'open',author:'wayri',createdAt:'2026-10-01T00:00:00Z',body:'Initial question',comments:[{id:'reply1',author:'reviewer',createdAt:'2026-10-03T12:00:00Z',body:'<script>not executable</script>',replyTo:'parent1'}],warnings:[]};const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='github-thread-read')return thread;return[];});view.load();await new Promise(r=>setImmediate(r));view.get('commentThreadKind').value='discussion';view.get('commentThreadNumber').value='7';await view.get('commentThreadLoad').click();assert.match(view.get('commentThreadMessages').textContent,/Initial question/);assert.match(view.get('commentThreadMessages').textContent,/<script>not executable/);assert.match(view.get('commentThreadMessages').textContent,/Reply to parent1/);
 view.get('commentSettingsButton').click();assert.equal(view.get('commentSettings').hidden,false);assert.equal(view.get('commentSettingsButton').attributes['data-icon'],'gear');view.get('commentCreatedFrom').value='2026-10-03';view.get('commentCreatedFrom').onchange();assert.doesNotMatch(view.get('commentThreadMessages').textContent,/Initial question/);assert.match(view.get('commentThreadMessages').textContent,/not executable/);view.get('commentThreadMessages').children[0].children.at(-1).click();assert.equal(view.get('editorDestination').value,'existing-discussion');assert.equal(view.get('editorThreadNumber').value,'7');assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);
});


test('net highlighting badges only related sheets and publishes the shared hierarchy',()=>{
 const content=(global)=>`(kicad_sch (version 20250114) (global_label "${global}" (at 0 0) (uuid "g")) (wire (pts (xy 0 0) (xy 10 0)) (uuid "w")))`,files=[{path:'root.kicad_sch',content:content('SUPPLY')},{path:'child.kicad_sch',content:content('SUPPLY')},{path:'unrelated.kicad_sch',content:content('OTHER')}];let snapshot;const view=workspaceRuntime(async()=>[],{pcb:false,files,onHierarchy:value=>snapshot=value});view.load();view.get('netList').children[0].click();const rows=view.get('sheetList').children[1].children,marked=rows.filter(r=>r.children.some(n=>n.className.includes('net-sheet-match')));assert.equal(marked.length,2);assert.equal(typeof view.workspace.followSheet,'function');assert.equal(view.workspace.followSheet('missing.kicad_sch'),false);assert.deepEqual([...snapshot.highlighted].sort(),['child.kicad_sch','root.kicad_sch']);assert.match(view.get('propertyList').textContent,/Matching sheets/);view.get('clearHighlights').click();assert.equal(snapshot.highlighted.length,0);
});

test('net properties show matching sheet count and links cross-probe the exact related sheet',()=>{
  const content=name=>`(kicad_sch (version 20250114) (global_label "${name}" (at 0 0) (uuid "g")) (wire (pts (xy 0 0) (xy 10 0)) (uuid "w")))`;
  const files=[{path:'root.kicad_sch',content:content('SUPPLY')},{path:'nested/child.kicad_sch',content:content('SUPPLY')},{path:'other.kicad_sch',content:content('OTHER')}],opened=[],selections=[];let active=files[0].path;
  const view=workspaceRuntime(undefined,{pcb:false,files,currentFile:()=>active,openSheet:path=>{opened.push(path);active=path;},onSelection:value=>selections.push(value)});view.load();view.get('netList').children[0].click();
  assert.match(view.get('selectionSummary').textContent,/2 matching sheets/);
  const section=view.get('propertyList').children.find(node=>node.children[0]?.textContent==='Matching sheets');
  assert.equal(section.children.length,3);const link=section.children.find(node=>node.title?.startsWith('nested/child.kicad_sch'));
  assert.ok(link);link.click();assert.deepEqual(opened,['nested/child.kicad_sch']);assert.equal(view.canvas.netHighlight.name,'SUPPLY');assert.equal(view.canvas.netHighlight.path,'nested/child.kicad_sch');assert.equal(selections.at(-1).path,'nested/child.kicad_sch');view.workspace.dispose();
});

test('net properties follow the inspected network when other nets are also highlighted',()=>{
  const content=names=>`(kicad_sch (version 20250114) ${names.map((name,i)=>`(global_label "${name}" (at 0 ${i*20}) (uuid "g${i}")) (wire (pts (xy 0 ${i*20}) (xy 10 ${i*20})) (uuid "w${i}"))`).join(' ')})`;
  const files=[{path:'root.kicad_sch',content:content(['AAA','ZZZ'])},{path:'child.kicad_sch',content:content(['AAA','ZZZ'])},{path:'aaa-only.kicad_sch',content:content(['AAA'])}];let active=files[0].path;
  const view=workspaceRuntime(undefined,{pcb:false,files,currentFile:()=>active,openSheet:path=>{active=path;}});view.load();view.get('multiHighlight').checked=true;
  view.get('netList').children.find(row=>row.title==='AAA').click();view.get('netList').children.find(row=>row.title==='ZZZ').click();
  assert.equal(view.get('selectedName').textContent,'ZZZ');assert.match(view.get('selectionSummary').textContent,/2 matching sheets/);
  const section=view.get('propertyList').children.find(node=>node.children[0]?.textContent==='Matching sheets');assert.equal(section.children.length,3);
  section.children.find(node=>node.title?.startsWith('child.kicad_sch')).click();assert.equal(active,'child.kicad_sch');assert.equal(view.get('selectedName').textContent,'ZZZ');view.workspace.dispose();
});

test('angle ruler previews, pins, resets and uses opaque label backgrounds',()=>{
 const view=workspaceRuntime();view.load();const fire=(type,props)=>{const e=new Event(type,{cancelable:true});Object.assign(e,props);view.canvas.canvas.dispatchEvent(e);};
 view.get('rulerSnap').value='off';view.get('rulerKind').value='angle';view.get('measureButton').click();
 fire('click',{clientX:440,clientY:300});assert.match(view.get('measurementStatus').textContent,/vertex/);
 fire('click',{clientX:400,clientY:300});fire('pointermove',{buttons:0,clientX:400,clientY:340});assert.match(view.get('measurementStatus').textContent,/Live angle.*90.0/);
 fire('click',{clientX:400,clientY:340});assert.match(view.get('measurementStatus').textContent,/Pinned angle.*90.0/);
 fire('pointermove',{buttons:0,clientX:480,clientY:350});assert.match(view.get('measurementStatus').textContent,/Pinned angle.*90.0/);
 assert.ok(view.get('reviewOverlay').children.some(n=>n.attributes.class==='ruler-label-background'));
 view.get('rulerKind').value='distance';view.get('rulerKind').onchange();assert.doesNotMatch(view.get('reviewOverlay').textContent,/90.0/);
 fire('click',{clientX:400,clientY:300});fire('click',{clientX:440,clientY:300});assert.match(view.get('measurementStatus').textContent,/Pinned.*10.000/);
 assert.equal(view.get('reviewOverlay').children.filter(n=>n.attributes.class==='ruler-label-background').length,3);
});

test('toolbar search jumps to parts and nets without opening explorer or fetching on input',async()=>{
 const requests=[],view=workspaceRuntime(async request=>{requests.push(request.type);return[];},{navigation:true});view.load();
 const input=view.get('universalSearch');view.document.activeElement=input;assert.equal(input.parentElement.parentElement.id,'frameControls');input.value='R1';input.onfocus();
 assert.equal(view.get('designNavigator').hidden,true);assert.match(view.get('universalSearchResults').textContent,/R1/);
 input.onkeydown({key:'ArrowDown',preventDefault(){}});assert.equal(input.attributes['aria-activedescendant'],'universalResult0');input.onkeydown({key:'Enter',preventDefault(){}});
 assert.equal(view.get('selectedName').textContent,'R1');assert.equal(view.get('universalSearchResults').hidden,true);
 input.value='SIGNAL';input.oninput();await new Promise(resolve=>setTimeout(resolve,150));input.onkeydown({key:'Enter',preventDefault(){}});assert.equal(view.canvas.netHighlight.name,'SIGNAL');
 assert.equal(requests.includes('project-search-files'),false);view.workspace.dispose();
});
test('schematic toolbar search offers loaded sheet links and Escape leaves highlights intact',()=>{
 const file={path:'root.kicad_sch',content:'(kicad_sch (version 20250114) (uuid "root"))'},opened=[],view=workspaceRuntime(async()=>[],{navigation:true,pcb:false,files:[file],openSheet:path=>opened.push(path)});view.load();
 const input=view.get('universalSearch');input.value='root';input.onfocus();assert.match(view.get('universalSearchResults').textContent,/root.kicad_sch/);input.onkeydown({key:'Enter',preventDefault(){}});assert.deepEqual(opened,['root.kicad_sch']);
 input.onfocus();let stopped=false;input.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){stopped=true;}});assert.equal(stopped,true);assert.equal(view.get('universalSearchResults').hidden,true);view.workspace.dispose();
});

test('net-class toggle loads only matching saved settings and restores standard drawing colors',async()=>{
 const requests=[],settings=JSON.stringify({net_settings:{classes:[{name:'Default'},{name:'Signal',pcb_color:'rgba(20,120,240,1)',schematic_color:'rgba(200,20,80,1)'}],netclass_assignments:{SIGNAL:'Signal'}}}),view=workspaceRuntime(async request=>{requests.push(request);if(request.type==='project-inventory')return{snapshotRef:'a'.repeat(40),files:[{path:'other.kicad_pro'},{path:'board.kicad_pro'}]};if(request.type==='project-file')return{content:settings};return[];},{navigation:true});view.load();assert.equal(view.canvas.netClassColors.size,0);
 await view.get('netClassColors').click();assert.equal(view.get('netClassColors').attributes['aria-pressed'],'true');const read=requests.find(r=>r.type==='project-file');assert.equal(read.file,'board.kicad_pro');assert.equal(read.ref,'a'.repeat(40));assert.ok([...view.canvas.netClassColors.values()].includes('rgba(20,120,240,1)'));assert.equal(requests.some(r=>r.type==='project-search-files'),false);
 await view.get('netClassColors').click();assert.equal(view.canvas.netClassColors.size,0);assert.equal(view.get('netClassColors').attributes['aria-pressed'],'false');view.workspace.dispose();
});
test('schematic net-class toggle colors connected wires and labels without recoloring unrelated artwork',async()=>{
 const file={path:'root.kicad_sch',content:'(kicad_sch (version 20250114) (uuid "root") (wire (pts (xy 10 10) (xy 20 10)) (uuid "wire")) (label "SIGNAL" (at 10 10 0) (effects (font (size 1 1))) (uuid "label")) (text "Keep normal" (at 30 30 0) (effects (font (size 1 1))) (uuid "text")))'},settings=JSON.stringify({net_settings:{classes:[{name:'Default',schematic_color:'rgba(200,20,80,1)',pcb_color:'rgba(20,120,240,1)'}]}}),view=workspaceRuntime(async request=>request.type==='project-inventory'?{files:[{path:'root.kicad_pro'}]}:request.type==='project-file'?{content:settings}:[],{navigation:true,pcb:false,files:[file]});view.load();await view.get('netClassColors').click();assert.ok([...view.canvas.netClassColors.keys()].some(p=>p.kind==='wire'));assert.ok([...view.canvas.netClassColors.values()].every(color=>color==='rgba(200,20,80,1)'));assert.ok([...view.canvas.netClassColors.keys()].every(p=>p.uuid!=='text'));view.workspace.dispose();
});
test('ambiguous settings need explicit selection and failed settings reads retain normal colors',async()=>{
 const reads=[],view=workspaceRuntime(async request=>{if(request.type==='project-inventory')return{files:[{path:'a.kicad_pro'},{path:'b.kicad_pro'}]};if(request.type==='project-file'){reads.push(request.file);throw Error('Unavailable');}return[];},{navigation:true});view.load();await view.get('netClassColors').click();assert.equal(reads.length,0);assert.equal(view.get('netColorProject').hidden,false);view.get('netColorProject').value='b.kicad_pro';await view.get('netColorProject').onchange();assert.deepEqual(reads,['b.kicad_pro']);assert.match(view.get('reviewNotice').textContent,/Unavailable/);assert.equal(view.canvas.netClassColors.size,0);view.workspace.dispose();
});

test('property search filters names and values, opens matching collapsed groups and restores on clear',()=>{
 const view=workspaceRuntime();view.load();view.get('objectList').children[0].click();const search=view.get('propertySearch');assert.equal(search.disabled,false);search.value='30.000';search.oninput();const groups=view.get('propertyList').children;assert.ok(groups.some(g=>!g.hidden&&g.textContent.includes('30.000')));assert.ok(groups.some(g=>g.hidden));search.value='no such property';search.oninput();assert.match(view.get('propertySearchStatus').textContent,/No matching/);search.value='';search.oninput();assert.ok(groups.every(g=>!g.hidden));assert.equal(view.get('propertySearchStatus').hidden,true);view.workspace.dispose();
});


test('touch net choices distinguish nearby nets, deduplicate geometry and scope the active sheet',()=>{
 const {touchNetIndex,touchNetCandidates}=require('../review-workspace.js');
 const wire={kind:'wire'},pad={kind:'pad',layer:'F.Cu'},via={kind:'via',layer:'B.Cu'},body={kind:'footprint'},arc={kind:'arc',layer:'F.Cu'};
 const a={id:'a',name:'DATA',path:'a',primitives:[wire,pad,body,arc]},b={id:'b',name:'DATA',path:'a',primitives:[via]},other={id:'other',path:'b',primitives:[wire]};
 const index=touchNetIndex([a,b,other],'a'),choices=touchNetCandidates([wire,pad,via,pad,body],index);
 assert.deepEqual(choices.map(c=>c.net.id),['a','b']);assert.deepEqual([...choices[0].layers],['F.Cu']);assert.deepEqual([...choices[1].layers],['B.Cu']);
 assert.equal(touchNetCandidates([body],index).length,0);assert.equal(touchNetCandidates([arc],index)[0].net,a);
 assert.equal(touchNetCandidates([],index).length,0);
});


test('ambiguous touch shows a chooser and selecting its net uses existing cross-highlight callbacks',()=>{
 const selections=[],view=workspaceRuntime(undefined,{onSelection:item=>selections.push(item),source:'(kicad_pcb (net 1 "DATA") (net 2 "CLOCK") (segment (start 0 0) (end 20 0) (width 0.2) (layer "F.Cu") (net 1) (uuid "data")) (segment (start 0 1) (end 20 1) (width 0.2) (layer "B.Cu") (net 2) (uuid "clock")))'});
 view.load();view.canvas.query=(at,radius)=>{assert.equal(radius,14);return view.design.primitives.filter(p=>p.kind==='track');};
 assert.equal(view.canvas.touchNetPick({clientX:50,clientY:50}),true);assert.equal(selections.length,0);
 const popup=view.document.body.querySelector('.touch-net-picker');assert.ok(popup);view.workspace.draw();assert.equal(view.document.body.querySelector('.touch-net-picker'),popup);assert.match(popup.textContent,/DATA.*F.Cu.*CLOCK.*B.Cu/);
 popup.children.find(n=>n.tagName==='BUTTON'&&n.textContent.includes('CLOCK')).click();assert.equal(view.document.body.querySelector('.touch-net-picker'),null);assert.equal(view.canvas.netHighlight.name,'CLOCK');assert.equal(view.get('designInspector').hidden,true);assert.equal(selections.at(-1).netName,'CLOCK');
 view.canvas.query=()=>view.design.primitives.filter(p=>p.uuid==='data');assert.equal(view.canvas.touchNetPick({clientX:50,clientY:50}),true);assert.equal(view.canvas.netHighlight.name,'DATA');assert.equal(view.document.body.querySelector('.touch-net-picker'),null);
 view.canvas.query=()=>[];assert.equal(view.canvas.touchNetPick({clientX:50,clientY:50}),false);view.workspace.dispose();assert.equal(view.canvas.touchNetPick,undefined);
});


test('schematic touch ambiguity offers separate labelled networks',()=>{
 const view=workspaceRuntime(undefined,{pcb:false,files:[{path:'root.kicad_sch',content:'(kicad_sch (wire (pts (xy 0 0) (xy 20 0)) (uuid "a")) (label "DATA" (at 0 0) (uuid "la")) (wire (pts (xy 0 1) (xy 20 1)) (uuid "b")) (label "CLOCK" (at 0 1) (uuid "lb")))'}]});
 view.load();view.canvas.query=()=>view.design.primitives.filter(p=>p.kind==='wire');
 assert.equal(view.canvas.touchNetPick({clientX:50,clientY:50}),true);const popup=view.document.body.querySelector('.touch-net-picker');assert.ok(popup);assert.match(popup.textContent,/DATA/);assert.match(popup.textContent,/CLOCK/);popup.children.find(n=>n.tagName==='BUTTON'&&n.textContent.includes('DATA')).click();assert.equal(view.canvas.netHighlight.name,'DATA');view.workspace.dispose();
});

test('Smart selection offers pad net and owning part; filters and deduplicates saved identities',()=>{
 const {selectionCandidates,touchNetIndex}=require('../review-workspace.js');
 const part={id:'u1',uuid:'component',path:'board',kind:'footprint',reference:'U1'},pad={id:'p1',uuid:'pad1',path:'board',kind:'pad',parentId:'u1'};
 const primitive={kind:'pad',uuid:'pad1',ownerUuid:'component',layer:'F.Cu'},body={kind:'footprint',uuid:'component'};
 const net={id:'vcc',name:'VCC',path:'board',primitives:[primitive]},index=touchNetIndex([net],'board');
 const all=selectionCandidates([primitive,body,primitive],index,[part,pad],'board');
 assert.deepEqual(all.map(c=>c.kind),['net','part']);assert.equal(all[1].object,part);
 assert.deepEqual(selectionCandidates([primitive],index,[part,pad],'board','part').map(c=>c.kind),['part']);
 assert.deepEqual(selectionCandidates([primitive],index,[part,pad],'board','net').map(c=>c.kind),['net']);
 assert.equal(selectionCandidates([primitive],index,[part,pad],'other','part').length,0);
});
test('Schematic smart selection resolves a pin owner and keeps nearby parts as separate choices',()=>{
 const {selectionCandidates,touchNetIndex}=require('../review-workspace.js');
 const a={id:'a',uuid:'a',kind:'symbol',path:'sheet',reference:'R1'},b={id:'b',uuid:'b',kind:'symbol',path:'sheet',reference:'R2'};
 const pin={kind:'pin',uuid:'pin',ownerUuid:'a'},body={kind:'symbol',uuid:'b'},net={id:'n',path:'sheet',name:'DATA',primitives:[pin]};
 const choices=selectionCandidates([pin,body],touchNetIndex([net],'sheet'),[a,b],'sheet');
 assert.deepEqual(choices.map(c=>c.net?.name||c.object.reference),['DATA','R1','R2']);
});

test('part/net mode filters actual picks; mixed groups retain the part and net',()=>{
 const selections=[],view=workspaceRuntime(undefined,{onSelection:item=>selections.push(item)});view.load();
 view.canvas.query=()=>view.design.primitives.filter(p=>p.kind==='pad');
 view.get('multiHighlight').checked=true;
 assert.equal(view.canvas.touchNetPick({clientX:30,clientY:40}),true);
 let popup=view.document.body.querySelector('.touch-net-picker');assert.match(popup.textContent,/Net: SIGNAL/);assert.match(popup.textContent,/Part: R1/);
 popup.children.find(n=>n.tagName==='BUTTON'&&n.textContent.includes('Part: R1')).click();
 view.get('selectionMode').value='net';assert.equal(view.canvas.touchNetPick({clientX:30,clientY:40}),true);
 assert.equal(view.document.body.querySelector('.touch-net-picker'),null);
 const group=selections.at(-1);assert.equal(group.kind,'group');assert.equal(group.items.length,2);assert.ok(group.items.some(i=>i.kind==='net'));assert.ok(group.items.some(i=>i.reference==='R1'));
 view.get('selectionMode').value='part';view.get('multiHighlight').checked=false;assert.equal(view.canvas.touchNetPick({clientX:30,clientY:40}),true);assert.equal(view.get('selectedName').textContent,'R1');
 view.workspace.dispose();
});


test('sheet overview highlights use sheet-scoped nets and rendered primitive identity', () => {
  const {sheetPageHighlights}=require('../review-workspace.js');
  const own={uuid:'shared'},child={uuid:'wire'},other={uuid:'other'};
  const nets=[{id:'root:GND',path:'root.kicad_sch',primitives:[other]}, {id:'child:GND',path:'child.kicad_sch',primitives:[child]}];
  const groups=sheetPageHighlights(nets,{netIds:['root:GND','child:GND'],uuids:['shared']},{primitives:[own,child,other]},'child.kicad_sch');
  assert.deepEqual(groups,[nets[1],{primitives:[own]}]);
  assert.deepEqual(sheetPageHighlights(nets,{netIds:[],uuids:[]},{primitives:[own]},'child.kicad_sch'),[]);
});

test('Android review cards place comment content ahead of compact location metadata',async()=>{
 const note={id:'android-note',text:'Check VCC\nConfirm the supply connection.',state:'open',severity:'major',createdAt:'2026-10-10T00:00:00Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'}};
 const view=workspaceRuntime(async m=>m.type==='comment-list'?[note]:[],{android:true});view.load();await view.workspace.refreshComments();
 const card=view.get('commentList').children[0];assert.equal(card.attributes['data-note-id'],note.id);
 assert.equal(card.children[0].className,'note-heading');assert.equal(card.children[0].textContent,'Check VCC');assert.equal(card.children[1].className,'note-body');assert.match(card.children[1].textContent,/Confirm the supply/);
 assert.equal(card.children[2].className,'note-meta');assert.match(card.children[2].textContent,/Major/);assert.equal(card.children[3].className,'note-meta note-location');view.workspace.dispose();
});

test('overview airwires join resolved global nets, not same-named local nets',()=>{
 const {overviewNetLinks}=require('../review-workspace.js');globalThis.KiCadNetModel=require('../net-model.js');
 const net=(id,path,globalNames,kind='global_label')=>({id,path,kind:'schematic',name:'VCC',globalNames,members:[{kind,position:{x:40,y:50}}]});
 const nets=[net('a','root.kicad_sch',['VCC']),net('b','power.kicad_sch',['VCC']),net('c','other.kicad_sch',[],'label')];
 const edges=overviewNetLinks(nets,['a','b'],[]);
 assert.equal(edges.length,1);assert.equal(edges[0].from.path,'root.kicad_sch');assert.equal(edges[0].to.path,'power.kicad_sch');
 assert.deepEqual(edges[0].from.position,{x:40,y:50});assert.deepEqual(overviewNetLinks(nets,['c']),[]);
});

test('shared overview translates geometry and airwires without changing saved primitives',()=>{
 const {composeSheetOverview}=require('../review-workspace.js');
 const source={type:'arc',start:{x:1,y:2},mid:{x:3,y:4},end:{x:5,y:6},hidden:true,uuid:'shared'};
 const design={page:{width:100,height:100},primitives:[source],layers:[]};
 const result=composeSheetOverview([{path:'a',label:'A',design,groups:[]},{path:'b',label:'B',design,groups:[{primitives:[source]}]}],[{from:{path:'a',position:{x:1,y:2}},to:{path:'b',position:{x:1,y:2}},name:'VCC'}]);
 assert.equal(result.pages.length,2);assert.equal(result.airwires.length,1);
 const shifted=result.highlighted[0];assert.equal(shifted.sourcePath,'b');assert.equal(shifted.hidden,true);
 assert.equal(shifted.start.x,result.pages[1].x+1);assert.equal(source.start.x,1);assert.notEqual(shifted.start,source.start);
 assert.deepEqual(result.airwires[0].toAnchor,{x:result.pages[1].x+1,y:result.pages[1].y+2});
});
test('all-sheet stacks count repeated placements through nested reused parents',()=>{
 const {sheetOverviewEntries,composeSheetOverview}=require('../review-workspace.js');
 const sheets=['root.kicad_sch','channel.kicad_sch','child.kicad_sch'].map(path=>({path,kind:'schematic',label:path}));
 const link=(path,file,label)=>({path,label,properties:{Sheetfile:file}});
 const entries=sheetOverviewEntries(sheets,[link('root.kicad_sch','channel.kicad_sch','Left'),link('root.kicad_sch','channel.kicad_sch','Right'),link('channel.kicad_sch','child.kicad_sch','Control')]);
 assert.equal(entries.find(e=>e.sheet.path==='channel.kicad_sch').instanceCount,2);
 const child=entries.find(e=>e.sheet.path==='child.kicad_sch');assert.equal(child.instanceCount,2);assert.ok(child.instances.some(name=>name.includes('Right / Control')));
 const source={type:'line',points:[{x:1,y:2},{x:3,y:4}],uuid:'part'};
 const result=composeSheetOverview([{path:child.sheet.path,label:'Control',instanceCount:child.instanceCount,instances:child.instances,design:{page:{width:100,height:100},primitives:[source]},groups:[]}]);
 assert.equal(result.pages[0].instanceCount,2);assert.equal(result.pages[0].instances.length,2);
 assert.equal(result.design.primitives.filter(p=>p.type==='polygon').length,2);
 assert.ok(result.design.primitives.some(p=>p.type==='text'&&p.text==='Control · 2 instances'));
 assert.equal(result.design.primitives.filter(p=>p.uuid==='part').length,1);assert.deepEqual(source.points,[{x:1,y:2},{x:3,y:4}]);
});
test('all-sheet stack counting retains cyclic sources without claiming resolved placements',()=>{
 const {sheetOverviewEntries}=require('../review-workspace.js');
 const sheets=[{path:'loop.kicad_sch',kind:'schematic',label:'Loop'}];
 const result=sheetOverviewEntries(sheets,[{path:'loop.kicad_sch',properties:{Sheetfile:'loop.kicad_sch'}}]);
 assert.equal(result[0].instanceCount,1);assert.equal(result[0].instanceUnresolved,true);
});
test('all-sheet instance expansion is bounded for exponentially reused hierarchies',()=>{
 const {sheetOverviewEntries}=require('../review-workspace.js');
 const sheets=Array.from({length:15},(_,i)=>({path:`s${i}.kicad_sch`,kind:'schematic',label:`Sheet ${i}`}));
 const links=sheets.slice(0,-1).flatMap((sheet,i)=>['A','B'].map(label=>({path:sheet.path,label,properties:{Sheetfile:`s${i+1}.kicad_sch`}})));
 const result=sheetOverviewEntries(sheets,links);
 assert.ok(result.every(e=>e.instanceTruncated));assert.ok(result.every(e=>e.instances.length<=256));
 assert.ok(result.reduce((total,e)=>total+e.instanceCount,0)<=4096+sheets.length);
});
test('2D and 3D share saved component selection across mode switches without callback loops',()=>{
 const view=workspaceRuntime();view.load();view.get('objectList').children[0].click();
 let state,calls=0;const scene={setPopulation(){},setSelection(value){state=value;calls++;},selectReference(){throw Error('callback-based selection must not be used');}};
 view.workspace.setScene(scene);assert.deepEqual(Array.from(state.references),['R1']);assert.ok(state.uuids.includes('fp'));
 view.workspace.select3D({uuid:'fp',ref:'R1'});assert.equal(view.get('selectedName').textContent,'R1');assert.ok(calls<10);
 view.workspace.setScene(null);assert.equal(view.get('selectedName').textContent,'R1');assert.equal(view.get('designInspector').hidden,false);
});
test('3D copper selection and paired net/group messages update both saved net and part highlights',()=>{
 const view=workspaceRuntime();view.load();let state;view.workspace.setScene({setPopulation(){},setSelection:value=>state=value});
 view.workspace.select3D({net:1});assert.equal(view.get('selectedName').textContent,'SIGNAL');assert.deepEqual(Array.from(state.netCodes),['1']);
 view.workspace.highlightRelated({kind:'group',items:[{kind:'part',reference:'R1',path:'sheet.kicad_sch'},{kind:'net',netName:'SIGNAL',path:'sheet.kicad_sch'}]});
 assert.ok(state.references.includes('R1'));assert.ok(state.netCodes.includes('1'));
 view.workspace.setScene(null);assert.equal(view.canvas.netHighlight.name,'SIGNAL');
});
test('3D selection obeys Part and Net filters instead of selecting hidden alternatives',()=>{
 const view=workspaceRuntime();view.load();view.workspace.setScene({setPopulation(){},setSelection(){}});view.get('objectList').children[0].click();
 view.get('selectionMode').value='part';view.workspace.select3D({net:1,uuid:'track'});assert.equal(view.get('selectedName').textContent,'R1');
 view.get('selectionMode').value='net';view.workspace.select3D({uuid:'fp',ref:'R1'});assert.equal(view.get('selectedName').textContent,'R1');
 view.workspace.select3D({uuid:'pad',ref:'R1',net:1});assert.equal(view.get('selectedName').textContent,'SIGNAL');
});
test('destination review never saves or posts until final confirmation and can return to the draft',async()=>{
 const calls=[];let notes=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')return{remoteRef:{kind:'issue',repository:'wayri/fixture',number:37,url:'https://github.com/wayri/fixture/issues/37',publishedAt:'2026-10-10T12:00:00Z'}};return[];});
 view.load();await new Promise(setImmediate);view.get('newComment').click();view.get('commentText').value='Check connector';
 await chooseDestination(view);assert.equal(view.get('commentPostReview').open,true);assert.equal(calls.some(m=>m.type==='comment-save'||m.type==='github-publish-comment'),false);
 assert.match(view.get('commentPostReview').textContent,/wayri\/fixture/);const back=view.get('commentPostReview').querySelector('.inspector-actions').children[0];back.click();
 assert.equal(view.get('commentPostReview').open,false);assert.equal(view.get('commentText').value,'Check connector');assert.equal(view.get('editorDestination').closest('label').parentElement.className,'comment-composer-menu-body');
 await chooseDestination(view);view.get('editorDestination').value='existing-issue';view.get('editorDestination').onchange();view.get('editorThreadNumber').value='37';
 await view.get('confirmCommentPost').click();const publication=calls.find(m=>m.type==='github-publish-comment');assert.equal(publication.destination,'issue');assert.equal(publication.number,37);assert.equal(view.get('commentPostReview').open,false);
});
test('one destination selector switches an issue draft to an existing GitHub discussion before confirmation',async()=>{
 const calls=[];let notes=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')return{remoteRef:{kind:'discussion',repository:'wayri/fixture',number:18,url:'https://github.com/wayri/fixture/discussions/18',publishedAt:'2026-10-10T12:00:00Z'}};return[];},{android:true,pullNumber:9});
 view.load();await new Promise(setImmediate);view.get('newComment').click();view.get('commentText').value='Review connector';await chooseDestination(view);
 const selector=view.get('commentPostDestination');assert.deepEqual(Array.from(selector.children,item=>item.value),['issue','existing-issue','discussion','existing-discussion','pull-request']);
 selector.value='existing-discussion';selector.onchange();view.get('editorThreadNumber').value='18';assert.equal(view.get('editorThreadType').value,'discussion');assert.equal(view.get('editorNumberLabel').hidden,false);assert.equal(view.get('editorCategoryLabel').hidden,true);assert.equal(calls.some(m=>m.type==='comment-save'||m.type==='github-publish-comment'),false);
 view.get('commentPostReview').querySelector('.inspector-actions').children[0].click();assert.equal(view.get('editorDestination').value,'existing-discussion');assert.equal(view.get('editorThreadNumber').value,'18');assert.deepEqual(Array.from(view.get('editorDestination').children,item=>item.value),['discussion','existing-discussion']);await chooseDestination(view);assert.equal(selector.value,'existing-discussion');
 await view.get('confirmCommentPost').click();const publication=calls.find(m=>m.type==='github-publish-comment');assert.equal(publication.destination,'discussion');assert.equal(publication.number,18);assert.equal(publication.comment.threadType,'discussion');view.workspace.dispose();
});

test('GitLab destination selector posts discussions on issues without GitHub categories',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-publish')return{remoteRef:{provider:'gitlab',host:'https://gitlab.com',kind:'discussion',repository:'group/project',number:12,url:'https://gitlab.com/group/project/-/issues/12#note_5',publishedAt:'2026-10-10T12:00:00Z'}};return[];},{provider:'gitlab',repository:'group/project',host:'https://gitlab.com',android:true});
 view.load();await new Promise(setImmediate);view.get('newComment').click();view.get('commentText').value='Discuss clearance';await chooseDestination(view);const selector=view.get('commentPostDestination');assert.deepEqual(Array.from(selector.children,item=>item.value),['issue','existing-issue','issue-discussion']);selector.value='issue-discussion';selector.onchange();view.get('editorThreadNumber').value='12';assert.equal(view.get('editorCategoryLabel').hidden,true);assert.equal(calls.some(m=>m.type==='comment-publish'),false);await view.get('confirmCommentPost').click();const publication=calls.find(m=>m.type==='comment-publish');assert.equal(publication.destination,'issue');assert.equal(publication.discussion,true);assert.equal(publication.number,12);view.workspace.dispose();
});

test('unselect retains net highlights, while clearing highlights resets 2D and 3D selection',()=>{
 const view=workspaceRuntime();view.load();view.get('navNets').click();view.get('netList').children[0].click();
 view.canvas.selected={uuid:'track'};view.get('unselect').click();assert.equal(view.canvas.selected,null);assert.equal(view.canvas.netHighlight.name,'SIGNAL');
 let state;view.workspace.setScene({setPopulation(){},setSelection:value=>state=value});view.get('clearHighlights').click();
 assert.equal(view.canvas.selected,null);assert.equal(view.canvas.netHighlight,null);assert.deepEqual(Array.from(state.references),[]);assert.deepEqual(Array.from(state.netCodes),[]);
});

test('content rules must be accepted before final publication',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);return[];},{unacceptedRules:true});view.load();await new Promise(r=>setImmediate(r));view.get('newComment').click();view.get('commentText').value='A safe review';await sendComment(view);assert.equal(calls.some(m=>m.type==='comment-save'||m.type==='github-publish-comment'),false);assert.match(view.get('commentPostReview').textContent,/Accept the content rules/);view.get('acceptContentRules').checked=true;await view.get('confirmCommentPost').click();assert.equal(view.receipts.get('kivi:content-rules'),'2026-10-10-terms-1');assert.equal(calls.filter(m=>m.type==='github-publish-comment').length,1);
});

test('older content-only acceptance requires renewed terms acceptance before publication',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);return[];});view.receipts.set('kivi:content-rules','2026-10-10');view.load();await new Promise(r=>setImmediate(r));view.get('newComment').click();view.get('commentText').value='Review with updated terms';await view.get('postComment').click();assert.equal(view.get('acceptContentRules').checked,false);await view.get('confirmCommentPost').click();assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);assert.match(view.get('commentPostReview').textContent,/Terms of Service/);
 const find=(node,predicate)=>predicate(node)?node:(node.children||[]).map(child=>find(child,predicate)).find(Boolean);find(view.get('commentPostReview'),b=>b.tagName==='BUTTON'&&b.textContent==='Read Terms & disclaimers').click();const frame=find(view.get('reviewTermsDialog'),b=>b.tagName==='IFRAME');assert.equal(frame.src,'terms.html');assert.equal(frame.attributes.sandbox,'');find(view.get('reviewTermsDialog'),b=>b.tagName==='BUTTON').click();assert.equal(view.get('reviewTermsDialog').open,false);
});

test('blocking a thread author hides their messages until unblocked',async()=>{
 const view=workspaceRuntime(async m=>m.type==='github-thread-read'?{kind:'issue',number:3,title:'Thread',url:'https://github.com/wayri/fixture/issues/3',author:'alex',body:'Starter body',createdAt:'2026-10-01T00:00:00Z',comments:[{id:'reply',author:'sam',body:'Other reply',createdAt:'2026-10-02T00:00:00Z'}]}:[]);view.load();await new Promise(r=>setImmediate(r));view.get('commentThreadNumber').value='3';await view.get('commentThreadLoad').click();view.get('commentThreadMessages').children[1].children.at(-1).children.find(e=>e.textContent==='Block @alex').click();assert.doesNotMatch(view.get('commentThreadMessages').textContent,/Starter body/);assert.match(view.get('commentThreadMessages').textContent,/Other reply/);assert.equal([...view.receipts.values()].some(v=>v==='["alex"]'),true);view.get('commentBlockedUsers').children[0].click();assert.match(view.get('commentThreadMessages').textContent,/Starter body/);
});

test('report requires a reason and never claims an unsent report was submitted',async()=>{
 const view=workspaceRuntime(async m=>m.type==='github-thread-read'?{kind:'issue',number:3,title:'Thread',url:'https://github.com/wayri/fixture/issues/3',author:'alex',body:'Body',createdAt:'2026-10-01T00:00:00Z',comments:[]}:[]);view.load();await new Promise(r=>setImmediate(r));view.get('commentThreadNumber').value='3';await view.get('commentThreadLoad').click();view.get('commentThreadMessages').children[1].children.at(-1).children.find(e=>e.textContent==='Report content').click();const body=view.document.body.children.at(-1).children[1];assert.match(body.textContent,/support.kivi@sigharmonic.com/);body.children.find(e=>e.textContent==='Review report in email').click();assert.match(body.textContent,/Describe the concern first/);body.children.find(e=>e.tagName==='TEXTAREA').value='Harassment';body.children.find(e=>e.textContent==='Review report in email').click();assert.match(body.textContent,/Send it in your email app/);assert.doesNotMatch(body.textContent,/Report submitted/);
});


test('shared testpoint table exports named CSV and locates the saved parent and pad position',()=>{
 let opened;const exports=[],focus=[],selections=[];
 const view=workspaceRuntime(undefined,{top:{AndroidKiCad:{exportText:(...args)=>exports.push(args)}},testpointTools:{open:options=>{opened=options;return{close(){}};}},focus:p=>focus.push(p),onSelection:o=>selections.push(o)});view.load();view.get('openTestpoints').click();
 assert.equal(opened.model.nets[0].name,'SIGNAL');opened.onExport('Testpoint,Net\r\nTP1,SIGNAL');
 assert.deepEqual(exports,[['testpoint-summary.csv','Testpoint,Net\r\nTP1,SIGNAL','text/csv']]);
 const object=opened.model.objects.find(o=>o.kind==='footprint');opened.onLocate({objectId:object.id,path:object.path,position:{x:31,y:40}});
 assert.equal(view.get('selectedName').textContent,'R1');assert.deepEqual(focus.at(-1),{x:31,y:40});view.workspace.dispose();
});
test('shared photo review receives saved testpoint evidence and locates its selected component',()=>{
 let opened;const view=workspaceRuntime(undefined,{testpointTools:{summarize:model=>({rows:[{reference:'TP1',objectId:model.objects[0].id}]})},photoReview:{open:options=>{opened=options;}}});view.load();view.get('openPhotoReview').click();
 assert.equal(opened.files[0].path,'board.kicad_pcb');assert.equal(opened.testpoints[0].reference,'TP1');opened.onLocate(opened.objects.find(o=>o.kind==='footprint'));
 assert.equal(view.get('selectedName').textContent,'R1');view.workspace.dispose();
});

test('photo schematic matching follows the saved symbol path and forwards exact focus to Android',async()=>{
 let photo;const opened=[],requested=[];
 const source='(kicad_pcb (footprint "Resistor" (layer "F.Cu") (at 30 40) (uuid "fp") (path "/sheet/child-symbol") (property "Reference" "R1") (property "Value" "10k")))';
 const schematics={'root.kicad_sch':'(kicad_sch (symbol (lib_id "Device:R") (at 10 20 0) (uuid "root-symbol") (property "Reference" "R1") (property "Value" "10k")))','child/power.kicad_sch':'(kicad_sch (symbol (lib_id "Device:R") (at 80 90 0) (uuid "child-symbol") (property "Reference" "R1") (property "Value" "10k")))'};
 const view=workspaceRuntime(async message=>{requested.push(message);if(message.type==='drawing-files')return{files:Object.keys(schematics)};if(message.type==='project-file')return{content:schematics[message.file]};return[];},{source,top:{KiCadAndroid:{openDrawing:(...args)=>opened.push(args)}},testpointTools:{summarize:()=>({rows:[]})},photoReview:{open:options=>photo=options}});view.load();view.get('openPhotoReview').click();
 const results=view.document.createElement('div');await photo.onSchematic(photo.objects.find(o=>o.kind==='footprint'),results);
 assert.match(results.textContent,/1 schematic matches \(saved-symbol-path/);const target=results.children.find(c=>c.tagName==='BUTTON');assert.match(target.textContent,/child\/power.kicad_sch/);target.click();
 assert.equal(opened.length,1);assert.equal(opened[0][0],'child/power.kicad_sch');assert.equal(opened[0][1].uuid,'child-symbol');assert.equal(opened[0][1].x,80);assert.equal(opened[0][1].y,90);
 assert.equal(requested.filter(m=>m.type==='project-file').length,2);assert.ok(requested.filter(m=>m.type==='project-file').every(m=>m.repository==='wayri/fixture'&&m.ref==='main'));view.workspace.dispose();
});

test('PCB population tool links checkbox, labeled DNI markers and selected-variant highlighting',()=>{
 const source='(kicad_pcb (footprint "R" (layer "B.Cu") (at 30 40) (uuid "fp") (property "Reference" "R1") (property "DNI" "yes") (pad "1" smd rect (at 0 0) (size 2 2) (layers "B.Cu") (uuid "pad"))))';
 const initialModel=require('../design-model.js').buildProject([{path:'board.kicad_pcb',content:source}],{schemaVersion:1,variants:[{id:'fitted',name:'Fitted',parts:[{path:'board.kicad_pcb',reference:'R1',populated:true}]}]});
 const view=workspaceRuntime(undefined,{source,initialModel});view.load();view.get('populationHighlight').click();assert.equal(view.get('highlightDnp').checked,true);assert.equal(view.get('populationHighlight').attributes['aria-pressed'],'true');assert.match(view.get('highlightSummary').textContent,/1 DNP \/ DNI/);assert.match(view.get('reviewOverlay').textContent,/R1 · DNI/);assert.ok(view.canvas.netPrimitives.size>0);
 view.get('variantSelect').value='fitted';view.get('variantSelect').onchange();assert.equal(view.canvas.netPrimitives.size,0);assert.doesNotMatch(view.get('reviewOverlay').textContent,/R1 · DNI/);assert.match(view.get('highlightSummary').textContent,/0 DNP \/ DNI/);assert.match(view.get('selectionStatus').textContent,/0 DNP \/ DNI components/);
 view.get('clearHighlights').click();assert.equal(view.get('populationHighlight').attributes['aria-pressed'],'false');assert.equal(view.get('highlightDnp').checked,false);
});


test('core assembly and testpoint actions are direct tools; photo inspection stays optional',()=>{
 let opened;const view=workspaceRuntime(undefined,{testpointTools:{open:options=>{opened=options;return{close(){}};}}});view.load();
 assert.equal(view.get('openBomManager').parentElement.id,'drawingTools');
 assert.equal(view.get('openTestpoints').parentElement.id,'drawingTools');
 assert.equal(view.get('openTestpoints').attributes['aria-label'],'Testpoints and connected nets');
 assert.equal(view.get('openPhotoReview').parentElement.id,'assemblyInspectionTools');
 assert.notEqual(view.get('assemblyInspectionTools').open,true);
 const drawer=view.document.createElement('dialog');drawer.id='androidToolsSheet';view.document.body.append(drawer);drawer.open=true;view.get('openTestpoints').click();assert.equal(drawer.open,false);assert.equal(opened.model.nets[0].name,'SIGNAL');view.workspace.dispose();
});

test('portable review transfers assembly and camera to Android, retains local work and never publishes',async()=>{
 const api=require('../review-handoff.js'),bom=require('../bom-manager.js');let transfer;const calls=[],exports=[],notes=[];
 const view=workspaceRuntime(async message=>{calls.push(message);if(message.type==='comment-list')return notes;if(message.type==='comment-save'){notes.push(message.comment);return message.comment;}return[];},{handoff:{...api,open:options=>transfer=options},top:{AndroidKiCad:{exportText:(...args)=>exports.push(args)}}});
 view.load();view.get('openReviewHandoff').click();await new Promise(r=>setImmediate(r));
 const sourceState=await transfer.getState(),files=transfer.getFiles(),part=bom.model(require('../design-model.js').buildProject(files).objects,'footprint')[0];
 const incoming={...sourceState,scope:{repository:'other/design',ref:'saved-copy',file:files[0].path},bom:{scope:api.bomScope({repository:'other/design',ref:'saved-copy',file:files[0].path}),parts:{[part.id]:{Assembly:'placed',Notes:'Incoming inspection'}}},comments:[{id:'portable-note',text:'Verify resistor',createdAt:'2026-10-10T00:00:00Z',anchor:{repository:'other/design',ref:'saved-copy',file:files[0].path}}],view:{...sourceState.view,camera:{x:12,y:34,zoom:5},ruler:{kind:'distance',points:[{x:0,y:0},{x:3,y:4}]}}};
 const text=await api.create(incoming,files),key='kicad-bom-manager:v1:'+sourceState.bom.scope;
 view.receipts.set(key,bom.metadataJSON(sourceState.bom.scope,{[part.id]:{Assembly:'verified',MPN:'Local-MPN'}}));
 const prepared=await api.prepare(text,transfer.getTarget('default'),files);assert.equal(prepared.translated,true);
 assert.match(await transfer.onApply(prepared),/Imported 1 notes/);assert.equal(notes[0].anchor.repository,'wayri/fixture');
 const merged=bom.validateMetadata(view.receipts.get(key),sourceState.bom.scope);assert.equal(merged[part.id].Assembly,'verified');assert.equal(merged[part.id].MPN,'Local-MPN');assert.equal(merged[part.id].Notes,'Incoming inspection');
 assert.equal(view.canvas.viewport.camera.center.x,12);assert.equal(view.canvas.viewport.camera.center.y,34);assert.equal(view.canvas.viewport.camera.zoom,5);assert.equal(view.get('rulerControls').hidden,false);
 assert.match(await transfer.onApply(prepared),/Imported 0 notes · 1 existing note IDs retained/);assert.equal(notes.length,1);
 transfer.onExport('pocket-kiview-review.json',text,'application/json');assert.equal(exports[0][0],'pocket-kiview-review.json');assert.equal(exports[0][1],text);
 assert.equal(calls.some(m=>/publish|post|discussion-create/.test(m.type)),false);view.workspace.dispose();
});

test('handoff persists variants through host storage and refuses overfull note imports before mutation',async()=>{
 const api=require('../review-handoff.js');let transfer;const saved={},notes=Array.from({length:100},(_,i)=>({id:'old-'+i}));
 const view=workspaceRuntime(async m=>m.type==='comment-list'?notes:[],{handoff:{...api,open:options=>transfer=options},chromeStorage:{get:async()=>saved,set:async values=>Object.assign(saved,values)}});view.load();view.get('openReviewHandoff').click();await new Promise(r=>setImmediate(r));
 const state=await transfer.getState();state.comments=[];state.variant='prototype';state.config={schemaVersion:1,variants:[{id:'prototype',name:'Prototype',parts:[{path:'board.kicad_pcb',reference:'R1',populated:false}]}]};state.bom.scope=api.bomScope(state.scope,state.variant);
 const text=await api.create(state,transfer.getFiles()),prepared=await api.prepare(text,transfer.getTarget(state.variant),transfer.getFiles());
 await transfer.onApply(prepared);assert.equal(view.get('variantSelect').value,'prototype');assert.equal(Object.values(saved)[0].variants[0].id,'prototype');
 const key='kicad-bom-manager:v1:'+prepared.data.bom.scope,before=view.receipts.get(key);prepared.comments=[{id:'new',anchor:{file:'board.kicad_pcb'}}];
 await assert.rejects(()=>transfer.onApply(prepared),/exceed 100 notes/);assert.equal(view.receipts.get(key),before);view.workspace.dispose();
});


test('local browser review remains offline after asynchronous mounting',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);return[];},{localRuntime:true});view.load();await new Promise(r=>setImmediate(r));
 assert.equal(view.get('githubPane').hidden,true);assert.equal(view.get('commentPublishSettings').hidden,true);assert.equal(view.get('postComment').hidden,true);assert.match(view.get('reviewStorageHint').textContent,/Notes stay in this browser/);assert.equal(calls.some(m=>m.type.startsWith('github-')||m.type==='comment-policy-status'),false);view.workspace.dispose();
});


test('iOS review export uses native Share with the same bounded payload as Android',async()=>{
 const api=require('../review-handoff.js');let handoff;const exported=[];const view=workspaceRuntime(async()=>[],{localRuntime:true,handoff:{...api,open:o=>handoff=o},top:{KiViewIOS:{exportText:(...args)=>exported.push(args)}}});view.load();view.get('openReviewHandoff').click();
 const text=await api.create(await handoff.getState(),handoff.getFiles());handoff.onExport('pocket-kiview-review.json',text,'application/json;charset=utf-8');assert.equal(exported.length,1);assert.equal(exported[0][0],'pocket-kiview-review.json');assert.equal(exported[0][1],text);assert.equal(exported[0][2],'application/json');assert.throws(()=>handoff.onExport('too-large.json','x'.repeat(4*1024*1024+1),'application/json'),/exceeds 4 MiB/);view.workspace.dispose();
});


test('Android selection and cross-probing update highlights without opening Properties',()=>{
 const view=workspaceRuntime(undefined,{android:true});view.load();
 view.get('objectList').children[0].click();assert.equal(view.get('selectedName').textContent,'R1');assert.equal(view.get('designInspector').hidden,true);
 view.get('netList').children[0].click();assert.equal(view.canvas.netHighlight.name,'SIGNAL');assert.equal(view.get('designInspector').hidden,true);
 view.workspace.highlightRelated({kind:'part',reference:'R1',path:'root.kicad_sch'});assert.equal(view.get('designInspector').hidden,true);
 view.workspace.highlightRelated({kind:'net',netName:'SIGNAL',path:'root.kicad_sch'});assert.equal(view.get('designInspector').hidden,true);
 view.workspace.select3D({uuid:'fp',ref:'R1'});assert.equal(view.get('designInspector').hidden,true);
 view.workspace.inspect3D({uuid:'fp',ref:'R1'});assert.equal(view.get('designInspector').hidden,false);assert.equal(view.get('selectedName').textContent,'R1');view.workspace.dispose();
});
test('Android long-press menu opens Properties only after its explicit Inspect action',()=>{
 const view=workspaceRuntime(undefined,{android:true,query:()=>[{bbox:{context:{uuid:'fp',reference:'R1'}}}]});view.load();
 view.canvas.canvas.dispatchEvent(uiEvent('contextmenu',{clientX:790,clientY:590,button:2}));assert.equal(view.get('designInspector').hidden,true);assert.equal(view.get('objectMenu').hidden,false);
 view.get('objectMenu').children.find(b=>b.textContent==='Inspect properties').click();assert.equal(view.get('designInspector').hidden,false);assert.equal(view.get('selectedName').textContent,'R1');view.workspace.dispose();
});


test('schematic net display uses attached sheet-pin text while callbacks keep source identity',()=>{
 const selections=[],uuid='95e84e92-806d-4809-ad70-48202504e491',view=workspaceRuntime(undefined,{pcb:false,android:true,onSelection:item=>selections.push(item),files:[{path:'root.kicad_sch',content:`(kicad_sch (wire (pts (xy 0 0) (xy 20 0)) (uuid "${uuid}")) (sheet (at 20 0) (size 10 10) (uuid "sheet") (property "Sheetname" "Child") (property "Sheetfile" "child.kicad_sch") (pin "ENABLE" input (at 20 0 180) (uuid "sheet-pin"))))`}]});
 let labels=[];view.canvas.setNetNames=nets=>{labels=nets;};view.load();
 assert.match(view.get('netList').textContent,/ENABLE/);assert.doesNotMatch(view.get('netList').textContent,new RegExp(uuid));
 view.get('netList').children[0].click();assert.match(view.get('selectionStatus').textContent,/ENABLE/);assert.equal(view.get('selectedName').textContent,'ENABLE');assert.match(view.get('propertyList').textContent,/Net name ENABLE/);
 assert.equal(labels[0].name,'ENABLE','canvas overlay gets display text');assert.ok(view.canvas.netHighlight.name.includes(uuid),'highlight identity remains unchanged');assert.ok(selections.at(-1).netName.includes(uuid),'cross-view matching still uses source identity');
 view.canvas.query=()=>view.design.primitives.filter(p=>p.kind==='wire');view.get('selectionMode').value='net';view.canvas.touchNetPick({clientX:50,clientY:50});assert.equal(view.get('selectedName').textContent,'ENABLE');view.workspace.dispose();
});

test('unlabelled network UI does not expose raw UUID as its primary name',()=>{
 const uuid='95e84e92-806d-4809-ad70-48202504e491',view=workspaceRuntime(undefined,{pcb:false,files:[{path:'root.kicad_sch',content:`(kicad_sch (wire (pts (xy 0 0) (xy 20 0)) (uuid "${uuid}")))`}]});view.load();view.get('netList').children[0].click();
 assert.equal(view.get('selectedName').textContent,'Unnamed network');assert.equal(view.get('selectionStatus').textContent,'Unnamed network · sheet network');assert.doesNotMatch(view.get('netList').textContent,new RegExp(uuid));assert.ok(view.canvas.netHighlight.uuids.includes(uuid));view.workspace.dispose();
});


test('touch disambiguation uses net display names rather than schematic source UUIDs',()=>{
 const uuid='95e84e92-806d-4809-ad70-48202504e491',view=workspaceRuntime(undefined,{pcb:false,files:[{path:'root.kicad_sch',content:`(kicad_sch (wire (pts (xy 0 0) (xy 20 0)) (uuid "${uuid}")) (sheet (at 20 0) (size 10 10) (uuid "sheet") (property "Sheetfile" "child.kicad_sch") (pin "ENABLE" input (at 20 0 180) (uuid "sheet-pin"))) (wire (pts (xy 0 1) (xy 20 1)) (uuid "other-wire")) (label "OTHER" (at 0 1) (uuid "label")))`}]});
 view.load();view.canvas.query=()=>view.design.primitives.filter(p=>p.kind==='wire');assert.equal(view.canvas.touchNetPick({clientX:50,clientY:50}),true);
 const popup=view.document.body.querySelector('.touch-net-picker');assert.ok(popup);assert.match(popup.textContent,/ENABLE/);assert.match(popup.textContent,/OTHER/);assert.doesNotMatch(popup.textContent,new RegExp(uuid));
 popup.children.find(n=>n.tagName==='BUTTON'&&n.textContent.includes('ENABLE')).click();assert.equal(view.get('selectedName').textContent,'ENABLE');assert.ok(view.canvas.netHighlight.uuids.includes(uuid));view.workspace.dispose();
});


const testpointBoard=(prefix='')=>`(kicad_pcb (net 1 "SENSE") (net 2 "GND")
 (footprint "Resistor" (layer "F.Cu") (at 0 0) (uuid "${prefix}r") (property "Reference" "R1") (property "Value" "10k") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 2 "GND") (uuid "${prefix}rp")))
 (footprint "TestPoint:TestPoint_Pad" (layer "F.Cu") (at 10 0) (uuid "${prefix}tp") (property "Reference" "TP1") (property "Value" "TestPoint") (pad "1" smd circle (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "SENSE") (uuid "${prefix}tpp")))
 (segment (start 10 0) (end 20 0) (width .2) (layer "F.Cu") (net 1) (uuid "${prefix}track")))`;

test('quick testpoint highlight toggles independently of selected parts and nets',()=>{
 const source=testpointBoard(),view=workspaceRuntime(undefined,{source,testpointTools:require('../testpoint-tools.js')});view.load();
 const resistor=view.get('objectList').children.find(row=>/\bR1\b/.test(row.textContent));resistor.click();assert.equal(view.get('selectedName').textContent,'R1');
 view.get('highlightTestpoints').click();assert.equal(view.get('highlightTestpoints').attributes['aria-pressed'],'true');assert.equal(view.get('selectedName').textContent,'R1');assert.ok([...view.canvas.netPrimitives].some(p=>p.uuid==='tpp'));assert.ok(![...view.canvas.netPrimitives].some(p=>p.uuid==='track'),'testpoint highlight does not silently select its full net');assert.match(view.get('highlightSummary').textContent,/1 testpoints/);assert.match(view.get('reviewNotice').textContent,/linked to 1 saved net/);
 view.get('highlightTestpoints').click();assert.equal(view.get('highlightTestpoints').attributes['aria-pressed'],'false');assert.equal(view.get('selectedName').textContent,'R1');assert.ok([...view.canvas.netPrimitives].some(p=>p.uuid==='rp'));assert.ok(![...view.canvas.netPrimitives].some(p=>p.uuid==='tpp'));
 view.get('netList').children.find(row=>row.textContent.includes('GND')).click();const net=view.canvas.netHighlight;
 view.get('highlightTestpoints').click();view.get('highlightTestpoints').click();assert.equal(view.get('selectedName').textContent,'GND');assert.equal(view.canvas.netHighlight,net);assert.ok([...view.canvas.netPrimitives].some(p=>p.uuid==='rp'));assert.ok(![...view.canvas.netPrimitives].some(p=>p.uuid==='tpp'));view.workspace.dispose();
});

test('quick testpoint filtering opens searchable navigator with resolved net association',()=>{
 const view=workspaceRuntime(undefined,{source:testpointBoard(),testpointTools:require('../testpoint-tools.js')});view.load();view.get('partSearch').value='stale';view.get('allSheets').checked=true;
 view.get('filterTestpoints').click();assert.equal(view.get('objectFilter').value,'testpoints');assert.equal(view.get('partSearch').value,'');assert.equal(view.get('allSheets').checked,false);assert.equal(view.get('designNavigator').hidden,false);assert.equal(view.get('partSearch').focused,true);
 assert.equal(view.get('objectList').children.length,1);assert.match(view.get('objectList').textContent,/TP1.*SENSE/);assert.doesNotMatch(view.get('objectList').textContent,/R1/);
 view.get('partSearch').value='net:SENSE';view.get('partSearch').oninput();assert.match(view.get('objectList').textContent,/TP1/);view.get('objectList').children[0].click();assert.equal(view.get('selectedName').textContent,'TP1');assert.match(view.get('propertyList').textContent,/Net SENSE/);view.get('selectObjectNet').click();assert.equal(view.canvas.netHighlight.name,'SENSE');
 view.get('partSearch').value='net:GND';view.get('partSearch').oninput();assert.match(view.get('objectList').textContent,/No testpoints match/);view.workspace.dispose();
});

test('quick testpoint overlay and filter stay scoped to the active loaded drawing',()=>{
 const files=[{path:'a.kicad_pcb',content:testpointBoard('a-')},{path:'b.kicad_pcb',content:testpointBoard('b-')}];let active='a.kicad_pcb';
 const view=workspaceRuntime(undefined,{files,currentFile:()=>active,testpointTools:require('../testpoint-tools.js')});view.load();view.get('highlightTestpoints').click();view.get('filterTestpoints').click();assert.equal(view.get('objectList').children.length,1);assert.ok([...view.canvas.netPrimitives].every(p=>p.uuid!=='b-tpp'));
 active='b.kicad_pcb';const design=require('../pcb-renderer.js').build(require('../design-diff.js').parse(files[1].content),active);view.canvas.design=design;view.canvas.primitives=design.primitives;view.workspace.draw();
 assert.ok([...view.canvas.netPrimitives].some(p=>p.uuid==='b-tpp'));assert.ok([...view.canvas.netPrimitives].every(p=>p.uuid!=='a-tpp'));assert.equal(view.get('objectList').children.length,1);view.get('highlightTestpoints').click();assert.equal(view.canvas.netPrimitives.size,0);view.workspace.dispose();
});

test('quick testpoint actions report no matches and Escape clears the overlay state',()=>{
 const empty=workspaceRuntime(undefined,{testpointTools:require('../testpoint-tools.js')});empty.load();empty.get('highlightTestpoints').click();assert.equal(empty.get('highlightTestpoints').attributes['aria-pressed'],'false');assert.match(empty.get('reviewNotice').textContent,/No saved testpoints found on this drawing/);empty.get('filterTestpoints').click();assert.match(empty.get('objectList').textContent,/No saved testpoints found on this drawing/);empty.workspace.dispose();
 const view=workspaceRuntime(undefined,{source:testpointBoard(),testpointTools:require('../testpoint-tools.js')});view.load();view.get('highlightTestpoints').click();view.key('Escape');assert.equal(view.get('highlightTestpoints').attributes['aria-pressed'],'false');assert.equal(view.canvas.netPrimitives.size,0);view.workspace.dispose();
});

test('testpoint classification is cached while panning or drawing repeatedly',()=>{
 const tools=require('../testpoint-tools.js');let classified=0;const view=workspaceRuntime(undefined,{source:testpointBoard(),testpointTools:{...tools,classify:object=>{classified++;return tools.classify(object);}}});view.load();view.get('highlightTestpoints').click();const count=classified;
 for(let i=0;i<5;i++)view.workspace.draw();view.get('highlightTestpoints').click();view.get('filterTestpoints').click();assert.equal(classified,count);assert.equal(count,2,'only saved components are classified, not pads/tracks');view.workspace.dispose();
});

test('linked issue state is inferred while skipped review status and saved annotation data remain intact',async()=>{
 for(const android of [true,false])for(const state of ['open','skipped']){
  const note={id:'state-'+state,text:'Review this connection',state,severity:'info',createdAt:'2026-10-10T00:00:00Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},github:{source:'issue',number:7,state:'closed',author:'reviewer',url:'https://github.com/wayri/fixture/issues/7'}};
  const view=workspaceRuntime(async request=>request.type==='comment-list'?[note]:[],{android});view.load();await view.workspace.refreshComments();const card=view.get('commentList').children[0];assert.match(card.textContent,new RegExp('Review: '+(state==='skipped'?'skipped':'closed')));assert.match(card.textContent,/Issue: closed/);assert.equal(note.state,state);assert.equal(note.github.state,'closed');view.workspace.dispose();
 }
});


test('schematic quick testpoints highlight symbol geometry and retain named source-pin nets',()=>{
 const source=`(kicad_sch (version 20250114) (lib_symbols (symbol "Connector:TestPoint" (symbol "TestPoint_0_1" (circle (center 0 0) (radius 1) (stroke (width 0) (type default)) (fill (type none)))) (symbol "TestPoint_1_1" (pin passive line (at 0 0 0) (length 0) (name "TP") (number "1"))))) (symbol (lib_id "Connector:TestPoint") (at 10 10 0) (unit 1) (uuid "probe-symbol") (property "Reference" "TP1") (property "Value" "TestPoint")) (wire (pts (xy 10 10) (xy 20 10)) (uuid "signal-wire")) (label "SENSE" (at 20 10) (uuid "label")))`;
 const view=workspaceRuntime(undefined,{pcb:false,files:[{path:'root.kicad_sch',content:source}],testpointTools:require('../testpoint-tools.js')});view.load();view.get('highlightTestpoints').click();assert.ok([...view.canvas.netPrimitives].some(p=>p.uuid==='probe-symbol'||p.ownerUuid==='probe-symbol'));assert.match(view.get('reviewNotice').textContent,/linked to 1 saved net/);view.get('filterTestpoints').click();assert.match(view.get('objectList').textContent,/TP1.*SENSE/);view.workspace.dispose();
});

test('quick testpoint highlighting caps the overlay without hiding searchable testpoints',()=>{
 const source='(kicad_pcb '+Array.from({length:201},(_,i)=>`(footprint "TestPoint" (layer "F.Cu") (at ${i} 0) (uuid "probe-${i}") (property "Reference" "TP${i+1}") (pad "1" smd circle (at 0 0) (size 1 1) (layers "F.Cu") (uuid "pad-${i}")))`).join(' ')+')';
 const view=workspaceRuntime(undefined,{source,testpointTools:require('../testpoint-tools.js')});view.load();view.get('highlightTestpoints').click();assert.match(view.get('highlightSummary').textContent,/200 testpoints/);assert.match(view.get('reviewNotice').textContent,/first 200 of 201/);const owners=new Set([...view.canvas.netPrimitives].map(p=>p.ownerUuid||p.uuid));assert.equal(owners.size,200);view.get('filterTestpoints').click();assert.equal(view.get('objectCount').textContent,'201 objects');view.workspace.dispose();
});

for(const provider of ['github','gitlab'])test(provider+' thread reader stays enabled on online Android with the shared source bridge',async()=>{
 const calls=[],host=provider==='gitlab'?'https://gitlab.com':undefined,view=workspaceRuntime(async m=>{calls.push(m);return m.type==='github-thread-read'?{kind:'issue',number:4,title:'Review',state:'closed',url:provider==='gitlab'?'https://gitlab.com/wayri/fixture/-/issues/4':'https://github.com/wayri/fixture/issues/4',author:'reviewer',createdAt:'2026-10-01T00:00:00Z',body:'Ordinary issue body',comments:[{id:'n1',body:'A normal reply',author:'other',createdAt:'2026-10-02T00:00:00Z'}],warnings:[]}:[];},{provider,host,android:true,androidOnline:true,vscode:{search:'?local-source'}});
 view.load();assert.equal(view.get('commentThreadReader').hidden,false);view.get('commentThreadNumber').value='4';await view.get('commentThreadLoad').click();assert.match(view.get('commentThreadMessages').textContent,/Ordinary issue body/);assert.match(view.get('commentThreadMessages').textContent,/A normal reply/);assert.match(view.get('commentThreadMessages').textContent,/closed/);assert.equal(calls.find(m=>m.type==='github-thread-read').kind,'issue');assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);
});
test('offline Android hides remote thread controls',()=>{const view=workspaceRuntime(undefined,{android:true,androidOnline:false,vscode:{search:'?local'}});assert.equal(view.get('commentThreadReader').hidden,true);});
for(const provider of ['github','gitlab'])test(provider+' thread reading in bound VS Code retains local transport scope',async()=>{
 const calls=[],collaboration={provider,host:provider==='gitlab'?'https://gitlab.com':'https://github.com',repository:'real/project',ref:'a'.repeat(40),prefix:''},view=workspaceRuntime(async m=>{calls.push(m);return m.type==='github-thread-read'?{kind:'issue',number:2,title:'Remote',state:'open',url:collaboration.host+'/real/project/'+(provider==='gitlab'?'-/issues/':'issues/')+'2',author:'reviewer',createdAt:'2026-10-01T00:00:00Z',body:'Remote conversation',comments:[],warnings:[]}:[];},{vscode:{collaboration},repository:'local/workspace',ref:'workspace'});
 view.load();assert.equal(view.get('commentThreadReader').hidden,false);view.get('commentThreadNumber').value='2';await view.get('commentThreadLoad').click();assert.match(view.get('commentThreadMessages').textContent,/Remote conversation/);const request=calls.find(m=>m.type==='github-thread-read');assert.equal(request.repository,'local/workspace');assert.equal(request.ref,'workspace');if(provider==='gitlab')assert.equal(request.host,'https://gitlab.com');
});
function captureChat(){let options;const calls=[];return{calls,get options(){return options;},panel:{mount(value){options=value;return{render(thread){calls.push(thread);return true;},hasDraft:()=>true,saveDraft:async all=>all,discard(){},focus(){},dispose(){calls.push('disposed');}};}}};}

test('comment Back Forward and Home navigate locally while refresh never creates a route or reopens a closed panel',async()=>{
 const chat=captureChat(),view=workspaceRuntime(async m=>m.type==='github-thread-read'?{kind:m.kind,number:m.number,title:'Review '+m.number,state:'open',body:'Body',comments:[],warnings:[],url:`https://github.com/wayri/fixture/issues/${m.number}`} : [],{chatPanel:chat.panel});view.load();
 await chat.options.onRead('issue',1);await chat.options.onRead('issue',2);await view.get('commentBack').click();assert.equal(chat.calls.at(-1).number,1);assert.equal(view.get('commentForward').disabled,false);await view.get('commentForward').click();assert.equal(chat.calls.at(-1).number,2);
 await view.get('closeComments').click();assert.equal(view.get('commentsSidebar').hidden,true);await chat.options.onRead('issue',2,{refresh:true});assert.equal(view.get('commentsSidebar').hidden,true);await view.get('commentHome').click();assert.equal(view.get('commentThreadMessages').hidden,true);assert.equal(await chat.options.onRead('issue',2,{refresh:true}),false);view.workspace.dispose();
});

test('Home during a delayed comment read rejects its stale response and floating reuses the panel owner',async()=>{
 let finish;const chat=captureChat(),view=workspaceRuntime(async m=>m.type==='github-thread-read'?new Promise(resolve=>{finish=resolve;}):[],{chatPanel:chat.panel});view.load();const pending=chat.options.onRead('issue',3);view.get('commentHome').click();finish({kind:'issue',number:3,title:'Old response',state:'open',body:'',comments:[],warnings:[]});await pending;assert.equal(view.get('commentThreadMessages').hidden,true);assert.equal(chat.calls.some(value=>value?.title==='Old response'),false);
 const panel=view.get('commentsSidebar'),options=chat.options;view.get('floatComments').click();assert.equal(panel.classList.contains('floating-comments'),true);assert.equal(view.get('floatComments').textContent,'Dock');view.get('floatComments').click();assert.equal(panel.classList.contains('floating-comments'),false);assert.equal(chat.options,options);view.workspace.dispose();
});

test('refresh of the old thread cannot cancel a pending deliberate thread navigation',async()=>{
 let finish;const chat=captureChat(),make=number=>({kind:'issue',number,title:'Thread '+number,state:'open',body:'',comments:[],warnings:[]});const view=workspaceRuntime(async m=>m.type==='github-thread-read'?(m.number===2?new Promise(resolve=>{finish=resolve;}):make(m.number)):[],{chatPanel:chat.panel});view.load();await chat.options.onRead('issue',1);const pending=chat.options.onRead('issue',2);assert.equal(await chat.options.onRead('issue',1,{refresh:true}),false);finish(make(2));await pending;assert.equal(chat.calls.at(-1).number,2);view.workspace.dispose();
});

test('thread state changes require current policy and Terms, and send only exact thread identity',async()=>{
 const chat=captureChat(),calls=[],view=workspaceRuntime(async message=>{calls.push(message);return message.type==='comment-policy-status'?{allowed:true}:{state:'closed'};},{chatPanel:chat.panel});view.load();
 const details={thread:{kind:'issue',number:5,title:'Visible title'},state:'closed',expectedUpdatedAt:'2026-10-28T10:00:00Z',confirmed:true};await chat.options.onThreadState(details);const sent=calls.find(m=>m.type==='chat-thread-state');assert.deepEqual(JSON.parse(JSON.stringify(sent.thread)),{kind:'issue',number:5});assert.equal(sent.file,'board.kicad_pcb');assert.equal(sent.repository,'wayri/fixture');assert.equal(sent.confirmed,true);await assert.rejects(chat.options.onThreadState({...details,confirmed:false}),/Confirm/);view.workspace.dispose();
 const blocked=captureChat(),other=workspaceRuntime(async()=>({allowed:false,reason:'Administrator blocked writes'}),{chatPanel:blocked.panel});other.load();await assert.rejects(blocked.options.onThreadState(details),/Administrator/);other.workspace.dispose();
});
test('chat uses exact source-bound net location and refuses another revision or provider',()=>{const chat=captureChat(),view=workspaceRuntime(undefined,{chatPanel:chat.panel});view.load();const anchor={...chat.options.getScope(),kind:'net',netName:'SIGNAL',objectId:'net:1'};assert.equal(chat.options.onLocate(anchor),true);assert.equal(view.canvas.netHighlight.name,'SIGNAL');assert.equal(chat.options.onLocate({...anchor,ref:'another'}),false);assert.equal(chat.options.onLocate({...anchor,provider:'gitlab',host:'https://gitlab.com'}),false);assert.equal(view.chatDraft().hasDraft(),true);view.workspace.dispose();assert.equal(view.chatDraft(),undefined);assert.equal(chat.calls.at(-1),'disposed');});
test('chat confirmation names the verified VS Code remote while keeping local annotation scope',async()=>{const chat=captureChat(),collaboration={provider:'github',host:'https://github.com',repository:'real/project',ref:'a'.repeat(40),prefix:''},calls=[],view=workspaceRuntime(async m=>{calls.push(m);return[];},{chatPanel:chat.panel,vscode:{collaboration},repository:'local/workspace',ref:'workspace',unacceptedRules:true});view.load();assert.equal(chat.options.getScope().repository,'local/workspace');const pending=chat.options.confirmSend({thread:{kind:'issue',number:4,title:'Review'},action:'create'}),dialog=view.document.body.children.find(n=>n.tagName==='DIALOG'&&n.className.includes('chat-send-review'));assert.match(dialog.textContent,/real\/project/);assert.equal(calls.some(m=>m.type==='chat-message-write'),false);dialog.querySelector('button').click();assert.equal(await pending,false);view.workspace.dispose();});
test('chat local draft saving rejects foreign provider context and preserves fork source identity',async()=>{const chat=captureChat(),calls=[],view=workspaceRuntime(async m=>{calls.push(m);return[];},{chatPanel:chat.panel,pullRepository:'base/project'});view.load();assert.throws(()=>chat.options.createAnnotation('Check',{id:'context',severity:'info',state:'open'}),/fork/);await chat.options.onSaveTextDraft({text:'Draft',thread:{kind:'issue',number:4},id:'draft-chat',scope:chat.options.getScope()});const saved=calls.find(m=>m.type==='comment-save').comment;assert.equal(saved.anchor.repository,'wayri/fixture');await assert.rejects(chat.options.onSaveDraft({...saved,anchor:{...saved.anchor,provider:'gitlab',host:'https://gitlab.com'}}),/no longer loaded/);view.workspace.dispose();});

test('work board opens from Comments and carries GitLab provider, host and current drawing scope',async()=>{
 let panel,disposed=false;const calls=[];
 const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='github-thread-read')return{kind:'issue',number:m.number,title:'Task',state:'open',comments:[],body:'',warnings:[]};return[];},{provider:'gitlab',host:'https://gitlab.example.org',workBoardPanel:{mount:options=>{panel=options;return{dispose(){disposed=true;}};}}});
 view.load();await new Promise(setImmediate);view.get('openWorkBoard').click();assert.equal(panel.getScope().provider,'gitlab');assert.equal(panel.getScope().host,'https://gitlab.example.org');assert.equal(panel.getScope().file,'board.kicad_pcb');
 await panel.onOpenThread({kind:'issue',number:42,repository:'wayri/fixture'});assert.ok(calls.some(m=>m.type==='github-thread-read'&&m.number===42&&m.provider==='gitlab'));
 view.workspace.dispose();assert.equal(disposed,true);
});

test('GitLab annotation polling mounts with foreground lifecycle and source-scoped updates',async()=>{
 let sync,started,visibility=0,disposed=false;const calls=[];
 const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-remote-list')return{notes:[],warnings:[]};return[];},{provider:'gitlab',host:'https://gitlab.com',reviewSync:{create:options=>{sync=options;return{start:scope=>{started=scope;},visibilityChanged:()=>visibility++,dispose:()=>{disposed=true;}};}}});
 view.load();await new Promise(setImmediate);assert.equal(started.file,'board.kicad_pcb');view.get('commentsButton').click();assert.ok(visibility>0);assert.equal(sync.isVisible(),true);
 const result=await sync.load(started);assert.equal(result.syncFile,'board.kicad_pcb');sync.onUpdate(result);assert.ok(calls.some(m=>m.type==='comment-remote-list'));
 sync.onUpdate({notes:[{text:'Foreign result'}],syncFile:'other.kicad_pcb'});assert.equal(view.get('commentList').textContent.includes('Foreign result'),false);
 view.workspace.dispose();assert.equal(disposed,true);
});

test('foreground project startup loads conversations and annotation metadata once, then polls only visible Comments',async()=>{
 const calls=[];let sync,started,visibility=0;
 const note={id:'initial-review',text:'Saved drawing review',createdAt:'2026-10-04T00:00:00Z',severity:'info',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb',position:{x:3,y:4}}};
 const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='chat-thread-list')return{threads:m.kind==='issue'?[{kind:'issue',number:7,title:'Existing design discussion',state:'open'}]:[],hasMore:true};if(m.type==='github-annotations')return{notes:[note],warnings:[]};return[];},{reviewSync:{create:options=>{sync=options;const service=require('../review-sync.js').create({...options,setTimer:()=>1,clearTimer(){}});return{...service,start(scope){started=scope;service.start(scope);},visibilityChanged(){visibility++;service.visibilityChanged();}};}}});
 view.load();await new Promise(setImmediate);assert.ok(sync);assert.equal(started.file,'board.kicad_pcb');assert.equal(view.get('commentsSidebar').hidden,true);assert.equal(sync.isVisible(),false,'initial read finishes without leaving background polling active');
 assert.match(view.get('commentThreadReader').textContent,/Existing design discussion/);assert.match(view.get('commentList').textContent,/Saved drawing review/);assert.equal(view.get('commentList').textContent.includes('Existing design discussion'),false,'ordinary issues have no fabricated drawing location');
 assert.equal(calls.filter(m=>m.type==='chat-thread-list').length,2);assert.equal(calls.filter(m=>m.type==='github-annotations').length,1);assert.equal(calls.some(m=>['comment-policy-status','chat-message-write','github-publish-comment'].includes(m.type)),false);
 view.get('commentsButton').click();assert.equal(sync.isVisible(),true);assert.ok(visibility>0);await new Promise(setImmediate);assert.equal(calls.filter(m=>m.type==='chat-thread-list').length,2,'opening Comments reuses the loaded conversation page');view.workspace.dispose();
});


test('phone comment Locate centers the saved point, clears obstructing panes and returns to the same draft',()=>{
 const chat=captureChat(),view=workspaceRuntime(undefined,{chatPanel:chat.panel,android:true,width:390});view.load();
 view.get('commentsButton').click();assert.equal(view.get('commentsSidebar').hidden,false);
 const anchor={...chat.options.getScope(),kind:'net',netName:'SIGNAL',position:{x:30,y:40}};
 assert.equal(chat.options.onLocate(anchor),true);assert.equal(view.get('commentsSidebar').hidden,true);assert.equal(view.get('designInspector').hidden,true);
 const box=view.canvas.viewport.camera.bbox;assert.ok(Math.abs(box.x+box.w/2-30)<1e-8);assert.ok(Math.abs(box.y+box.h/2-40)<1e-8);assert.equal(box.w,8);assert.ok(box.h<20);
 const overlay=view.get('drawingHost').querySelector('.comment-focus-overlay');assert.equal(overlay.hidden,false);assert.equal(overlay.querySelector('.comment-focus-ring').hidden,false);
 overlay.querySelector('.comment-focus-return').dispatchEvent(new Event('click'));assert.equal(view.get('commentsSidebar').hidden,false);assert.equal(overlay.hidden,true);assert.equal(view.chatDraft().hasDraft(),true);assert.deepEqual(chat.calls,[]);view.workspace.dispose();
});

test('comment Locate uses explicit saved area fallback and rejects missing identity without saved geometry',()=>{
 const chat=captureChat(),view=workspaceRuntime(undefined,{chatPanel:chat.panel});view.load();
 const anchor={...chat.options.getScope(),kind:'drawing',area:{x:100,y:200,width:30,height:10}};
 assert.equal(chat.options.onLocate(anchor),true);const box=view.canvas.viewport.camera.bbox;
 assert.ok(box.x<=100&&box.x+box.w>=130&&box.y<=200&&box.y+box.h>=210);assert.equal(box.x+box.w/2,115);assert.equal(box.y+box.h/2,205);
 const snapshot=JSON.stringify(box);assert.equal(chat.options.onLocate({...anchor,kind:'footprint',uuid:'missing'}),true);assert.equal(chat.options.onLocate({...anchor,area:undefined,kind:'footprint',uuid:'missing'}),false);assert.equal(JSON.stringify(view.canvas.viewport.camera.bbox),snapshot);view.workspace.dispose();
});

test('3D comment Locate focuses the saved source point and refreshes its marker when the view changes',()=>{
 const chat=captureChat(),view=workspaceRuntime(undefined,{chatPanel:chat.panel,android:true,width:390});view.load();const calls=[];let projected={x:195,y:300};
 view.workspace.setScene({setPopulation(){},setSelection(){},focusPosition(position,options){calls.push({position,options});return true;},projectAnchor(){return projected;}});
 const anchor={...chat.options.getScope(),kind:'net',netName:'SIGNAL',position:{x:30,y:40}};assert.equal(chat.options.onLocate(anchor),true);assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{position:{x:30,y:40},options:{bounds:null,side:'front'}});
 const ring=view.get('drawingHost').querySelector('.comment-focus-ring');assert.equal(ring.style.left,'195px');projected={x:210,y:280};view.workspace.sceneViewChanged();assert.equal(ring.style.left,'210px');assert.equal(ring.style.top,'280px');view.workspace.dispose();
});


test('DRC notes show saved descriptions and exclusion comments as literal text, with independent hide controls',async()=>{
 const view=workspaceRuntime(undefined,{navigation:true,width:390,android:true});view.load();view.get('viewRuleChecks').click();
 const finding={type:'clearance',description:'Clearance <img src=x onerror=alert(1)>',severity:'warning',excluded:true,comment:'Reviewed spacing exception',items:[{description:'Track on F.Cu',pos:{x:30,y:40}}]};
 const report={source:'board.kicad_pcb',date:'2026-10-29T00:00:00Z',kicad_version:'10.0',coordinate_units:'mm',violations:[finding]};
 view.get('ruleReportFile').files=[{size:600,name:'check.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();view.get('showExcludedRules').checked=true;view.get('showExcludedRules').oninput();view.get('nextRule').click();
 const notes=()=>view.get('commentPins').children.filter(n=>n.className==='rule-location-note');assert.equal(notes().length,1);assert.match(notes()[0].textContent,/Reviewed spacing exception/);assert.match(notes()[0].textContent,/<img src=x/);assert.equal(notes()[0].querySelector('img'),null);assert.match(notes()[0].textContent,/revision unverified/);assert.equal(view.get('ruleWindow').hidden,true);
 view.get('showRuleNotes').checked=false;view.get('showRuleNotes').onchange();assert.equal(notes().length,0);assert.ok(view.get('commentPins').children.some(n=>n.className.includes('rule-marker')));
 view.get('showRuleNotes').checked=true;view.get('showRuleNotes').onchange();assert.equal(notes().length,1);notes()[0].querySelector('button').click();assert.equal(notes().length,0);view.get('nextRule').click();assert.equal(notes().length,1);view.get('clearRuleReports').click();assert.equal(notes().length,0);view.workspace.dispose();
});

test('ERC on-canvas notes require a resolved sheet association and retain explicit report coordinates',async()=>{
 const focused=[],view=workspaceRuntime(undefined,{navigation:true,pcb:false,files:[{path:'root.kicad_sch',content:'(kicad_sch (version 20250114))'}],focus:p=>focused.push(p)});view.load();
 const report={source:'root.kicad_sch',date:'2026-10-29T00:00:00Z',kicad_version:'10.0',coordinate_units:'mils',sheets:[{path:'/Power/',uuid_path:'/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',violations:[{type:'pin_not_connected',description:'Input pin is unconnected',severity:'error',items:[{description:'Pin 1',pos:{x:1000,y:2000}}]}]}]};
 view.get('ruleReportFile').files=[{size:600,name:'erc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();view.get('nextRule').click();assert.equal(focused.length,0);assert.equal(view.get('commentPins').children.filter(n=>n.className==='rule-location-note').length,0);
 const mapping=view.get('reportSheetMappings').children[0].querySelector('select');mapping.value='root.kicad_sch';mapping.onchange();view.get('nextRule').click();assert.deepEqual(focused[0],{x:25.4,y:50.8});assert.match(view.get('commentPins').children.find(n=>n.className==='rule-location-note').textContent,/ERC.*Input pin is unconnected/);view.workspace.dispose();
});

test('next affected item keeps a selected marker and note beyond the first twenty report items',async()=>{
 const view=workspaceRuntime(undefined,{navigation:true});view.load();const items=Array.from({length:25},(_,i)=>({description:'Affected '+i,pos:{x:i,y:40}})),report={source:'board.kicad_pcb',date:'2026-10-29T00:00:00Z',kicad_version:'10.0',coordinate_units:'mm',violations:[{type:'clearance',description:'Review connected geometry',severity:'error',items}]};
 view.get('ruleReportFile').files=[{size:2000,name:'drc.json',text:async()=>JSON.stringify(report)}];await view.get('ruleReportFile').onchange();view.get('nextRule').click();for(let i=0;i<24;i++)view.get('nextRuleItem').click();
 const active=view.get('commentPins').children.filter(n=>n.className==='pin rule-marker active');assert.equal(active.length,1);assert.match(active[0].attributes['aria-label'],/Affected 24/);assert.match(view.get('commentPins').children.find(n=>n.className==='rule-location-note').textContent,/Affected 24/);assert.ok(view.get('commentPins').children.filter(n=>n.className.includes('rule-marker')).length<=20);view.workspace.dispose();
});


test('KiCad local composer shares visible review levels and primary save with the extension without remote publication',async()=>{
 const calls=[],view=workspaceRuntime(async m=>{calls.push(m);return[];},{localRuntime:true});view.load();view.get('addCommentTab').click();const top=view.get('commentComposeTop');assert.equal(top.parentElement.id,'commentEditor');assert.equal(top.closest('#commentComposerMenu'),null);assert.equal(view.get('saveComment').parentElement.id,'commentPostRow');assert.equal(view.get('commentPublishSettings').hidden,true);
 assert.ok(view.get('commentSeverity').children.some(n=>n.value==='level-1'));view.get('commentSeverity').value='level-1';view.get('commentSeverity').onchange();assert.ok(view.get('commentSeverity').className.includes('severity-level-1'));view.get('commentText').value='Inspect resistor\nCheck its rating';await view.get('saveComment').click();assert.equal(calls.find(m=>m.type==='comment-save').comment.severity,'level-1');assert.equal(calls.some(m=>m.type==='github-publish-comment'||m.type==='comment-publish'),false);view.workspace.dispose();
});


test('linked note state follows fetched issue state, filters closed and skips locally without any provider write',async()=>{
 const calls=[],note={id:'linked-review',text:'Review connector',severity:'minor',state:'open',createdAt:'2026-10-28T00:00:00Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},github:{source:'issue',number:7,state:'closed',author:'reviewer',url:'https://github.com/wayri/fixture/issues/7'}},view=workspaceRuntime(async m=>{calls.push(m);return m.type==='comment-list'?[note]:[];});view.load();await view.workspace.refreshComments();const card=()=>view.get('commentList').children[0];assert.equal(card().attributes['data-state'],'closed');view.get('stateFilter').value='open';view.get('stateFilter').onchange();assert.equal(view.get('commentList').children.filter(n=>n.attributes['data-note-id']).length,0);view.get('stateFilter').value='closed';view.get('stateFilter').onchange();assert.equal(card().attributes['data-state'],'closed');
 await action(card(),'Skip review').click();view.get('stateFilter').value='skipped';view.get('stateFilter').onchange();assert.equal(card().attributes['data-state'],'skipped');assert.ok(card().children.some(n=>n.className==='review-state-badge'&&n.textContent==='Skipped'));
 await action(card(),'Follow issue state').click();view.get('stateFilter').value='closed';view.get('stateFilter').onchange();assert.equal(card().attributes['data-state'],'closed');assert.equal(note.state,'open');assert.equal(calls.some(m=>m.type==='chat-thread-state'||m.type==='comment-save'),false);view.workspace.dispose();
});

test('conversation state filters apply to provider rows and confirmed mutations update linked annotations',async()=>{
 const chat=captureChat(),calls=[],note={id:'receipt-note',text:'Linked check',severity:'info',state:'open',createdAt:'2026-10-28T00:00:00Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},remoteRefs:[{kind:'issue',repository:'wayri/fixture',number:7,url:'https://github.com/wayri/fixture/issues/7',publishedAt:'2026-10-28T00:00:00Z'}]},view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return[note];if(m.type==='comment-policy-status')return{allowed:true};if(m.type==='chat-thread-state')return{kind:'issue',number:7,state:m.state,updatedAt:'2026-10-29T02:00:00Z'};if(m.type==='chat-thread-list')return{threads:m.kind==='issue'?[{kind:'issue',number:7,title:'Open task',state:'open',updatedAt:'2026-10-29T00:00:00Z'},{kind:'issue',number:8,title:'Closed task',state:'closed',updatedAt:'2026-10-29T01:00:00Z'}]:[],hasMore:false};return[];},{chatPanel:chat.panel});view.load();await view.workspace.refreshComments();view.get('showComments').click();await new Promise(setImmediate);
 view.get('commentConversationState').value='closed';view.get('commentConversationState').onchange();assert.doesNotMatch(view.get('commentThreadReader').querySelector('.chat-conversation-list').textContent,/Open task/);assert.match(view.get('commentThreadReader').querySelector('.chat-conversation-list').textContent,/Closed task/);
 await chat.options.onThreadState({thread:{kind:'issue',number:7,title:'Open task'},state:'closed',expectedUpdatedAt:'2026-10-29T00:00:00Z',confirmed:true});assert.equal(view.get('commentList').children[0].attributes['data-state'],'closed');assert.match(view.get('commentThreadReader').querySelector('.chat-conversation-list').textContent,/Open task/);assert.equal(note.state,'open');assert.equal(calls.filter(m=>m.type==='chat-thread-state').length,1);assert.equal(calls.some(m=>m.type==='comment-save'),false);view.workspace.dispose();
});


test('PCB shortcuts flip the view and select all six 3D axis sides without firing while typing',()=>{
 const view=workspaceRuntime();view.load();let flips=0;view.get('flipButton').onclick=()=>flips++;
 assert.equal(view.key('f').defaultPrevented,true);assert.equal(flips,1);
 const sides=[],scene={setPopulation(){},setSelection(){},setView:value=>sides.push(value),flip:()=>flips++,netAtPointer:()=>({net:1})};view.workspace.setScene(scene);
 for(const key of ['x','y','z']){view.key(key);view.key(key.toUpperCase(),{shiftKey:true});}
 assert.deepEqual(sides,['right','left','back','front','top','bottom']);
 view.key('f');assert.equal(flips,2);
 const count=sides.length;
 for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true},{composedPath:()=>[{tagName:'INPUT'}]},{composedPath:()=>[{tagName:'TEXTAREA'}]},{composedPath:()=>[{tagName:'SELECT'}]},{composedPath:()=>[{isContentEditable:true}]}]){view.key('z',extra);view.key('f',extra);view.key('~',extra);}
 assert.equal(sides.length,count);assert.equal(flips,2);assert.equal(view.canvas.netHighlight,null);
 view.key('~');assert.equal(view.canvas.netHighlight.name,'SIGNAL');view.key('Escape');assert.equal(view.canvas.netHighlight,null);
 view.workspace.setScene(null);assert.equal(view.key('z').defaultPrevented,undefined);
});

test('destination dialog restores nested composer controls safely on repeated close events',async()=>{
 const calls=[],view=workspaceRuntime(async m=>{calls.push(m);return[];});view.load();view.get('newComment').click();view.get('commentText').value='Keep this draft';
 assert.notEqual(view.get('postComment').parentElement,view.get('commentPostRow'),'Send is nested inside its settings row');
 for(let i=0;i<2;i++){
  await chooseDestination(view);const dialog=view.get('commentPostReview');assert.equal(dialog.open,true);
  const back=action(dialog,'Back to comment');assert.doesNotThrow(()=>back.click());assert.equal(dialog.open,false);assert.doesNotThrow(()=>dialog.close());
  assert.equal(view.get('editorDestination').closest('label').parentElement.className,'comment-composer-menu-body');assert.equal(view.get('commentText').value,'Keep this draft');
 }
 assert.equal(calls.some(m=>m.type==='comment-save'||m.type==='github-publish-comment'),false);view.workspace.dispose();
});
test('Terms gate applies once while later sends and edits keep their explicit chosen destination',async()=>{
 let notes=[];const calls=[],chat=captureChat();const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment')return{remoteRef:{kind:'issue',repository:'wayri/fixture',number:41,url:'https://github.com/wayri/fixture/issues/41',publishedAt:'2026-11-01T00:00:00Z'}};return[];},{unacceptedRules:true,chatPanel:chat.panel});
 view.load();view.get('newComment').click();view.get('commentText').value='First send';await view.get('postComment').click();assert.equal(view.get('commentPostReview').open,true);assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);
 view.get('acceptContentRules').checked=true;await view.get('confirmCommentPost').click();assert.equal(calls.filter(m=>m.type==='github-publish-comment').length,1);assert.equal(view.get('commentPostReview').open,false);
 view.get('newComment').click();view.get('commentText').value='Second send';await view.get('postComment').onclick(new Event('click'));await new Promise(setImmediate);assert.equal(calls.filter(m=>m.type==='github-publish-comment').length,2);assert.equal(view.get('commentPostReview').open,false);
 for(const action of ['create','reply','edit'])assert.equal(await chat.options.confirmSend({thread:{kind:'issue',number:41,title:'Existing issue'},action}),true);
 assert.equal(view.document.body.children.some(n=>n.tagName==='DIALOG'&&n.className.includes('chat-send-review')&&n.open),false);view.workspace.dispose();
});

test('selecting Discussion prepares a new draft without creating a remote conversation or requiring a manual number',async()=>{
 const calls=[],view=workspaceRuntime(async m=>{calls.push(m);return m.type==='github-discussion-categories'?[{id:'DIC_design',name:'Design review'},{id:'DIC_general',name:'General'}]:[];});view.load();view.get('commentCategoryDiscussion').click();view.get('newComment').click();view.get('commentText').value='Discuss saved design';await new Promise(setImmediate);
 assert.equal(view.get('editorDestination').value,'discussion');assert.equal(view.get('editorNumberLabel').hidden,true);assert.equal(view.get('editorCategory').value,'');assert.equal(calls.some(m=>m.type==='comment-save'||m.type==='github-publish-comment'),false);
 await view.get('postComment').click();assert.equal(view.get('commentPostReview').open,true);await view.get('confirmCommentPost').click();assert.equal(calls.some(m=>m.type==='comment-save'||m.type==='github-publish-comment'),false);assert.match(view.get('commentStatus').textContent,/Load and select a discussion category/);view.workspace.dispose();
});

test('comments dock toggles closed without losing its draft, including after hover reveal',()=>{
 const view=workspaceRuntime();view.load();view.get('commentText').value='Retain me';const dock=view.get('dockComments');dock.click();assert.equal(view.get('commentsSidebar').hidden,false);dock.click();assert.equal(view.get('commentsSidebar').hidden,true);assert.equal(view.get('commentText').value,'Retain me');dock.dispatchEvent(new Event('pointerenter'));dock.click();assert.equal(view.get('commentsSidebar').hidden,false);dock.click();assert.equal(view.get('commentsSidebar').hidden,true);view.workspace.dispose();
});
test('native KiCad field/value table precedes advanced object information',()=>{
 const view=workspaceRuntime();view.load();view.get('objectList').children[0].click();const first=view.get('propertyList').children[0];assert.equal(first.className,'kicad-field-table');assert.equal(first.attributes['aria-label'],'KiCad fields and values');assert.match(first.textContent,/Field.*Value.*Reference.*R1/);view.workspace.dispose();
});

test('native field table puts Reference and Value ahead of custom fields saved first',()=>{
 const source='(kicad_pcb (footprint "Device:R" (layer "F.Cu") (at 1 2) (uuid "fp") (property "Vendor" "Acme") (property "Reference" "R1") (property "Value" "10k")))';
 const view=workspaceRuntime(async()=>[],{source});view.load();view.get('objectList').children[0].click();
 const rows=view.get('propertyList').children[0].children[1].children;
 assert.deepEqual(rows.slice(0,2).map(row=>row.children[0].textContent),['Reference','Value']);
 assert.ok(rows.some(row=>row.children[0].textContent==='Vendor'&&row.children[1].children[0].textContent==='Acme'));view.workspace.dispose();
});

test('discussion catalog new-comment action prepares a new Discussion without posting',()=>{
 const view=workspaceRuntime();view.load();view.get('commentConversationKind').value='discussion';view.get('newConversation').click();assert.equal(view.get('editorThreadType').value,'discussion');assert.equal(view.get('editorDestination').value,'discussion');view.workspace.dispose();
});

test('foreground annotation and catalog read failures propagate to sync backoff',async()=>{
 for(const failing of ['github-annotations','chat-thread-list']){
  let sync,mode='ok';const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(mode==='fail'&&m.type===failing)throw Error('Provider unavailable');if(m.type==='github-annotations')return{notes:[],warnings:[]};if(m.type==='chat-thread-list')return{threads:[],hasMore:false};return[];},{reviewSync:{create:options=>{sync=options;return{start(){},visibilityChanged(){},dispose(){}};}}});
  view.load();view.get('commentsButton').click();await new Promise(setImmediate);mode='fail';await assert.rejects(async()=>sync.onUpdate(await sync.load()),/Provider unavailable/);assert.ok(calls.some(m=>m.type===failing));
  if(failing==='chat-thread-list'){const before=calls.filter(m=>m.type===failing).length;await assert.rejects(async()=>sync.onUpdate(await sync.load()),/Provider unavailable/);assert.ok(calls.filter(m=>m.type===failing).length>before,'failed catalog refresh never advances success timestamp');}
  view.workspace.dispose();
 }
});

test('probe entries include saved part and pin identities and cache net models by design identity',()=>{
 let probe,builds=0;const nets=require('../net-model.js'),netModelAPI={...nets,build(...args){builds++;return nets.build(...args);}};
 const view=workspaceRuntime(undefined,{quickView:{mount:config=>{probe=config;return{open(){return probe.getEntries().length;},dispose(){}};}},netModelAPI});view.load();view.get('objectList').children[0].click();const before=builds;
 const entries=probe.getEntries();assert.equal(entries.length,1);const part=entries[0].groups.find(g=>g.kind==='part');assert.ok(part);assert.equal(part.canonical.reference,'R1');assert.equal(part.selection.canonical.kind,'part');probe.getEntries();assert.equal(builds,before+1,'reopening uses the same design-bound net model');view.designs.set('board.kicad_pcb',{...view.canvas.design});probe.getEntries();assert.equal(builds,before+2,'a new design identity invalidates its net model');
 view.get('selectionMode').value='pin';view.workspace.select3D({uuid:'fp',reference:'R1',pinNumber:'1'});const pin=probe.getEntries()[0].groups.find(g=>g.kind==='pin');assert.equal(pin.canonical.pinNumber,'1');assert.equal(pin.canonical.ownerUuid,'fp');view.workspace.dispose();
});
test('probe picking uses live authoritative geometry, updates local selection and emits canonical cross-selection',()=>{
 let probe;const emitted=[],view=workspaceRuntime(undefined,{onSelection:s=>emitted.push(s),quickView:{mount:config=>{probe=config;return{open(){},dispose(){}};}}});view.load();view.get('objectList').children[0].click();const entry=probe.getEntries()[0],pad=entry.design.primitives.find(p=>p.kind==='pad');
 assert.equal(probe.resolveSelection(entry,{...pad},'part'),null);const part=probe.resolveSelection(entry,pad,'part');assert.equal(part.canonical.kind,'part');probe.onSelect(entry,part);assert.equal(emitted.at(-1).reference,'R1');assert.equal(view.get('selectedName').textContent,'R1');
 const pin=probe.resolveSelection(entry,pad,'pin');assert.equal(pin.canonical.pinNumber,'1');probe.onSelect(entry,pin);assert.equal(emitted.at(-1).kind,'pin');assert.equal(emitted.at(-1).ownerUuid,'fp');
 const net=probe.resolveSelection(entry,pad,'net');probe.onSelect(entry,net);assert.equal(emitted.at(-1).kind,'net');assert.equal(view.canvas.netHighlight.name,'SIGNAL');const anchor=probe.getAnchor({entry,group:entry.groups[0]},part);assert.ok(Number.isFinite(anchor.x)&&Number.isFinite(anchor.y));view.workspace.dispose();
});
test('cross-view popup selections first back-highlight the main drawing rather than only notifying siblings',()=>{
 let probe;const emitted=[],view=workspaceRuntime(undefined,{onSelection:s=>emitted.push(s),quickView:{mount:config=>{probe=config;return{open(){},dispose(){}};}}});view.load();
 const foreign={path:'root.kicad_sch',objects:[],nets:[],design:{primitives:[]}};
 probe.onSelect(foreign,{kind:'part',primitives:[],canonical:{kind:'part',path:foreign.path,reference:'R1',uuid:'source-r1'}});
 assert.equal(view.get('selectedName').textContent,'R1');assert.equal(emitted.at(-1).path,foreign.path);
 probe.onSelect(foreign,{kind:'net',primitives:[],group:{path:foreign.path,name:'SIGNAL'},canonical:{kind:'net',path:foreign.path,netName:'SIGNAL'}});
 assert.equal(view.canvas.netHighlight.name,'SIGNAL');view.workspace.dispose();
});
test('probe view switches use host callbacks and 3D native records normalize before cross-selection',async()=>{
 let probe,config3D;const calls=[],emitted=[];const view=workspaceRuntime(undefined,{onSelection:s=>emitted.push(s),quickView:{mount:config=>{probe=config;return{open(){},dispose(){}};}},resolveProbeViews:async(...args)=>{calls.push(args);return {hostResolved:true};},mountProbe3D:async(holder,config)=>{config3D=config;return {dispose(){}};}});view.load();view.get('objectList').children[0].click();const entry=probe.getEntries()[0],group=entry.groups[0],row={entry,group};assert.equal((await probe.resolveViews(row,null,'layout')).hostResolved,true);assert.equal(calls[0][1].canonical.kind,'part');
 const selected=[],viewport=await probe.mount3D({}, {entry,group,onSelect:value=>selected.push(value)});config3D.onSelect({uuid:'fp',reference:'R1',pinNumber:'1',probeRecord:true});assert.equal(selected[0].canonical.kind,'pin');assert.equal(selected[0].canonical.ownerUuid,'fp');config3D.onSelect({kind:'net',net:1,probeRecord:true});assert.equal(selected[1].canonical.netName,'SIGNAL');viewport.setSelectionFilter('net');config3D.onSelect({uuid:'fp',reference:'R1',pinNumber:'1',net:1,probeRecord:true});assert.equal(selected[2].canonical.kind,'net');config3D.onSelect({type:'Pad',ref:'R1',name:'1',net:'SIGNAL',probeRecord:true});assert.equal(selected[3].canonical.kind,'net');viewport.setSelectionFilter('all');config3D.onSelect({type:'Pad',ref:'R1',name:'1',probeRecord:true});assert.equal(selected[4].canonical.kind,'pin');assert.equal(selected[4].canonical.pinNumber,'1');config3D.onSelect({type:'Component',ref:'R1',probeRecord:true});assert.equal(selected[5].canonical.kind,'part');assert.equal(selected[5].canonical.reference,'R1');assert.equal(emitted.length,1,'3D normalization alone does not publish until manager accepts the selection');view.workspace.dispose();
});

test('foreign probe selections emit saved identity without moving the current drawing or trusting foreign coordinates',()=>{
 let probe;const emitted=[],view=workspaceRuntime(undefined,{onSelection:s=>emitted.push(s),quickView:{mount:config=>{probe=config;return{open(){},dispose(){}};}}});view.load();view.get('objectList').children[0].click();const local=probe.getEntries()[0],primitive=local.design.primitives.find(p=>p.kind==='pad'),object={...local.objects.find(o=>o.kind==='footprint'),path:'other.kicad_pcb',uuid:'foreign-fp',reference:'R9',position:{x:900,y:900}},pad={...primitive,ownerUuid:'foreign-fp',uuid:'foreign-pad',reference:'R9'},entry={path:'other.kicad_pcb',objects:[object],nets:[],design:{primitives:[pad]}};
 const selection=probe.resolveSelection(entry,pad,'part');assert.equal(selection.canonical.reference,'R9');probe.onSelect(entry,selection);assert.equal(emitted.at(-1).path,'other.kicad_pcb');assert.equal(view.get('selectedName').textContent,'R1');assert.equal(probe.getAnchor({entry,group:{primitives:[pad]}},selection),null);
 const bounds=require('../owned-canvas.js').bounds(local.groups[0].primitives),expected=view.canvas.viewport.camera.world_to_screen({x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2}),point=probe.getAnchor({entry:local,group:local.groups[0]},selection);assert.equal(point.x,expected.x);assert.equal(point.y,expected.y);view.workspace.dispose();
});

test('provider-confirmed annotation stays successful after local linkage, render or host-notification failure without reposting',async()=>{
 for(const failure of ['storage','render','notification']){
  let notes=[],accepted=false,posts=0;const remoteRef={kind:'issue',repository:'wayri/fixture',number:51,url:'https://github.com/wayri/fixture/issues/51',publishedAt:'2026-11-01T00:00:00Z'};
  const view=workspaceRuntime(async m=>{if(m.type==='comment-list')return notes;if(m.type==='comment-save'){if(accepted&&failure==='storage')throw Error('Local linkage storage failed');notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment'){accepted=true;posts++;return{remoteRef};}return[];},{onCommentsChanged(){if(accepted&&failure==='notification')throw Error('Host notification failed');}});view.load();await new Promise(setImmediate);const list=view.get('commentList'),replace=list.replaceChildren.bind(list);list.replaceChildren=(...nodes)=>{if(accepted&&failure==='render')throw Error('Render failed');return replace(...nodes);};
  view.get('newComment').click();view.get('commentText').value='Confirmed remote annotation';await sendComment(view);assert.equal(posts,1);assert.match(view.get('commentStatus').textContent,/Posted to GitHub issue #51/);assert.equal(view.get('commentStatus').classList.contains('error'),false);assert.equal(view.get('commentEditor').hidden,true);assert.equal(view.get('postComment').parentElement.querySelector('.publication-recovery'),null);view.workspace.dispose();
 }
});
test('chat readback refreshes active drawing markers and removes deleted markers in the same thread',async()=>{
 const chat=captureChat(),comments=require('../review-comments.js'),scope={repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},note={id:'live-anchor',text:'Remote area',createdAt:'2026-11-01T00:00:00Z',anchor:{...scope,position:{x:30,y:40},area:{x:25,y:35,width:10,height:10}}};let body=comments.toMarkdown(note);
 const view=workspaceRuntime(async m=>m.type==='github-thread-read'?{kind:'issue',number:51,title:'Live review',state:'open',id:'51',url:'https://github.com/wayri/fixture/issues/51',author:'alice',body:'Thread',comments:[{id:'52',author:'alice',body,url:'https://github.com/wayri/fixture/issues/51#issuecomment-52',createdAt:note.createdAt,updatedAt:note.createdAt}],capabilities:{create:true}}:[],{chatPanel:chat.panel});view.load();await chat.options.onRead('issue',51);assert.match(view.get('commentList').textContent,/Remote area/);assert.ok(view.get('commentPins').children.some(n=>n.className==='pin'));body='Ordinary reply, marker removed';await chat.options.onRead('issue',51);assert.doesNotMatch(view.get('commentList').textContent,/Remote area/);view.workspace.dispose();
});
test('new schematic notes persist the native root sheet UUID with exact source metadata',async()=>{
 const uuid='11111111-2222-3333-4444-555555555555';let saved;const view=workspaceRuntime(async m=>{if(m.type==='comment-save'){saved=m.comment;return saved;}return[];},{pcb:false,files:[{path:'root.kicad_sch',content:`(kicad_sch (uuid "${uuid}") (paper "A4"))`}]});view.load();view.get('newComment').click();view.get('commentText').value='Root sheet note';await view.get('saveComment').click();assert.equal(saved.anchor.sheetUuid,uuid);assert.equal(saved.anchor.sheetName,'root.kicad_sch');assert.equal(saved.anchor.file,'root.kicad_sch');view.workspace.dispose();
});

test('targeted annotation refresh updates and deletes only that Issue while retaining other Issue markers',async()=>{
 const scope={repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},at='2026-11-01T00:00:00Z',makeNote=(id,number)=>({id,text:id,createdAt:at,anchor:{...scope,position:{x:30,y:40}},github:{source:'issue-comment',number,url:`https://github.com/wayri/fixture/issues/${number}#issuecomment-${number}`,state:'open',author:'alice'}}),a=makeNote('issue-a',51),b=makeNote('issue-b',52);
 let result={notes:[a,b],warnings:[]};const view=workspaceRuntime(async m=>m.type==='github-annotations'?result:[]);view.load();await view.get('refreshGitHub').click();
 const ids=()=>view.get('commentPins').children.map(n=>n.attributes['data-note-id']).sort();assert.deepEqual(ids(),['issue-a','issue-b']);
 result={notes:[{...a,text:'Updated issue A'}],warnings:[],coverage:{kind:'thread',url:'https://github.com/wayri/fixture/issues/51'}};await view.get('refreshGitHub').click();assert.deepEqual(ids(),['issue-a','issue-b']);assert.match(view.get('commentList').textContent,/Updated issue A/);
 result={...result,notes:[]};await view.get('refreshGitHub').click();assert.deepEqual(ids(),['issue-b']);
 result={notes:[],warnings:['Incomplete annotation scan']};await view.get('refreshGitHub').click();assert.deepEqual(ids(),['issue-b']);view.workspace.dispose();
});

test('3D Locate respects the saved back side even without a matching component',()=>{
 const chat=captureChat(),view=workspaceRuntime(undefined,{chatPanel:chat.panel});view.load();const calls=[];
 view.workspace.setScene({setPopulation(){},setSelection(){},focusPosition(position,options){calls.push({position,options});return true;},projectAnchor(){return{x:100,y:100};}});
 assert.equal(chat.options.onLocate({...chat.options.getScope(),position:{x:30,y:40},side:'back'}),true);
 assert.equal(calls[0].options.side,'back');view.workspace.dispose();
});

test('a website snapshot missing older comments retains their known drawing areas until a complete read',async()=>{
 const comments=require('../review-comments.js'),chat=captureChat(),scope={repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},note={id:'retained-area',text:'Known remote area',createdAt:'2026-11-01T00:00:00Z',anchor:{...scope,area:{x:25,y:35,width:10,height:10}}};
 let body=comments.toMarkdown(note),warnings=[];const view=workspaceRuntime(async m=>m.type==='github-thread-read'?{kind:'issue',number:51,state:'open',url:'https://github.com/wayri/fixture/issues/51',body,comments:[],warnings}:[],{chatPanel:chat.panel});view.load();await chat.options.onRead('issue',51);assert.equal(view.get('commentPins').children.length,1);
 body='Description without locations';warnings=['Some issue comments were not included in the website snapshot.'];await chat.options.onRead('issue',51);assert.equal(view.get('commentPins').children.length,1);
 warnings=[];await chat.options.onRead('issue',51);assert.equal(view.get('commentPins').children.length,0);view.workspace.dispose();
});

test('GitHub area readback projects all four PCB corners in 3D and follows camera changes without changing source anchors',async()=>{
 const chat=captureChat(),comments=require('../review-comments.js'),scope={repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},createdAt='2026-11-01T00:00:00Z';
 const note={id:'area-3d',text:'Back-side review area',createdAt,anchor:{...scope,uuid:'fp',side:'back',position:{x:26,y:36},area:{x:25,y:35,width:10,height:10}}};
 const thread={kind:'issue',number:51,title:'Area',state:'open',url:'https://github.com/wayri/fixture/issues/51',body:comments.toMarkdown(note),comments:[],capabilities:{create:true}};
 const view=workspaceRuntime(async m=>m.type==='github-thread-read'?thread:[],{chatPanel:chat.panel});view.load();await chat.options.onRead('issue',51);
 let offset=0;const calls=[];view.workspace.setScene({setPopulation(){},setSelection(){},projectAnchor(a){calls.push(JSON.parse(JSON.stringify(a)));return a.position?{x:a.position.x*2+offset,y:a.position.y*3}:null;}});view.workspace.draw();
 let area=view.get('reviewOverlay').children.find(n=>n.attributes['data-note-id']==='area-3d');assert.ok(area);assert.equal(area.tagName.toLowerCase(),'polygon');assert.equal(area.attributes.points.split(' ').length,4);
 assert.ok(calls.some(a=>a.clip===false&&a.side==='back'&&a.position.x===35&&a.position.y===45));
 const pin=view.get('commentPins').children.find(n=>n.attributes['data-note-id']==='area-3d');assert.ok(pin);assert.ok(calls.some(a=>a.position?.x===26&&a.position?.y===36&&!a.uuid));
 const before=area.attributes.points;offset=50;view.workspace.sceneViewChanged();area=view.get('reviewOverlay').children.find(n=>n.attributes['data-note-id']==='area-3d');assert.notEqual(area.attributes.points,before);
 assert.equal(note.anchor.position.x,26);view.get('commentList').querySelectorAll=()=>[];let reopened=0;chat.options.onRead=()=>{reopened++;};await pin.click();assert.equal(view.get('commentStatus').textContent,note.text);view.workspace.dispose();
});

test('area-only GitHub annotations create pins and never place another file or revision on the active drawing',async()=>{
 const comments=require('../review-comments.js'),scope={repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'},createdAt='2026-11-01T00:00:00Z',chat=captureChat();
 const notes=[{id:'area-only',text:'Native area',createdAt,anchor:{...scope,area:{x:25,y:35,width:10,height:10}}},{id:'foreign-file',text:'Other sheet',createdAt,anchor:{...scope,file:'other.kicad_sch',position:{x:30,y:40}}},{id:'foreign-ref',text:'Other revision',createdAt,anchor:{...scope,ref:'other',position:{x:30,y:40}}}];
 const view=workspaceRuntime(async m=>m.type==='github-thread-read'?{kind:'issue',state:'open',number:51,url:'https://github.com/wayri/fixture/issues/51',body:notes.map(n=>comments.toMarkdown(n)).join('\n'),comments:[]}:[],{chatPanel:chat.panel});view.load();await chat.options.onRead('issue',51);
 const ids=view.get('commentPins').children.map(n=>n.attributes['data-note-id']);assert.deepEqual(ids,['area-only']);assert.ok(view.get('reviewOverlay').children.some(n=>n.attributes['data-note-id']==='area-only'&&n.tagName.toLowerCase()==='polygon'));view.workspace.dispose();
});


test('3D part, net and terminal Locate focus saved source geometry only and ordinary picks never move camera',()=>{
 const view=workspaceRuntime();view.load();const calls=[],cameraBefore=JSON.stringify(view.canvas.viewport.camera.bbox);view.canvas.primitives.push(
  {type:'text',kind:'property',uuid:'fp',x:10000,y:10000,size:1000,text:'long hidden metadata'},
  {type:'polygon',kind:'footprint-hit',uuid:'fp',points:[{x:-999,y:-999},{x:999,y:999}]},
  {type:'circle',kind:'pad',ownerUuid:'fp',x:900,y:900,r:500,hidden:true},
  {type:'circle',kind:'pad',ownerUuid:'fp',path:'foreign.kicad_pcb',x:800,y:800,r:500},
  {type:'circle',uuid:'fp',x:0,y:0,r:1000,frame:true});
 view.workspace.setScene({setPopulation(){},setSelection(){},focusPosition(position,options){calls.push(JSON.parse(JSON.stringify({position,options})));return true;}});
 view.workspace.select3D({uuid:'fp',ref:'R1'});assert.equal(calls.length,0);view.get('focusSelected').click();assert.equal(calls.length,1);assert.deepEqual(calls[0],{position:{x:31,y:40},options:{bounds:{x:30,y:39,w:2,h:2},side:'front'}});
 view.workspace.select3D({net:1});assert.equal(calls.length,1);view.get('focusSelected').click();assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);
 view.get('selectionMode').value='pin';view.workspace.select3D({uuid:'pad',ref:'R1',pinNumber:'1',net:1});assert.equal(calls.length,2);assert.match(view.get('selectionStatus').textContent,/pad 1/);view.get('focusSelected').click();assert.equal(calls.length,3);assert.deepEqual(calls[2],calls[0]);assert.match(view.get('selectionStatus').textContent,/pad 1/);assert.equal(JSON.stringify(view.canvas.viewport.camera.bbox),cameraBefore,'3D Locate does not mutate the hidden2D camera');view.workspace.dispose();
});


test('legacy saved hierarchy supports child dropdown, Up/Home and Files without weakening ambiguity checks',async()=>{
 const files=[{path:'hw/vna2.sch',content:'EESchema Schematic File Version 2\n$Sheet\nS 100 100 200 200\nU 1234ABCD\nF0 "Power" 60\nF1 "power.sch" 60\n$EndSheet\n$EndSCHEMATC\n'},{path:'hw/power.sch',content:'EESchema Schematic File Version 2\n$EndSCHEMATC\n'}];let active=files[0].path;const opened=[],view=workspaceRuntime(async()=>({files:files.map(f=>({path:f.path}))}),{pcb:false,files,currentFile:()=>active,openSheet:path=>{active=path;opened.push(path);view.workspace.draw();}});view.load();
 assert.deepEqual(Array.from(view.get('sheetSelect').children,n=>n.value),files.map(f=>f.path));view.get('sheetSelect').value='hw/power.sch';view.get('sheetSelect').onchange();assert.equal(active,'hw/power.sch');assert.equal(view.get('sheetHome').disabled,false);assert.equal(view.get('sheetUp').disabled,false);view.get('sheetHome').click();assert.equal(active,'hw/vna2.sch');
 view.get('navFiles').click();await new Promise(setImmediate);const row=descendants(view.document.body).find(n=>n.classList.contains('project-file-tree-row')&&n.attributes['data-path']==='hw/power.sch');assert.ok(row);assert.equal(row.disabled,false);await row.click();assert.equal(active,'hw/power.sch');assert.ok(!row.title.includes('source asset'));
 const rootPath=require('../review-workspace.js').rootSheetPath,objects=[{kind:'sheet',path:'hw/vna2.sch',properties:{Sheetfile:'power.sch'}}];assert.equal(rootPath('hw/power.sch',objects,files),'hw/vna2.sch');assert.equal(rootPath('hw/power.sch',[...objects,{kind:'sheet',path:'hw/other.sch',properties:{Sheetfile:'power.sch'}}],[...files,{path:'hw/other.sch'}]),null);assert.equal(rootPath('hw/power.sch',[...objects,{kind:'sheet',path:'hw/power.sch',properties:{Sheetfile:'vna2.sch'}}],files),null);view.workspace.dispose();
});

test('discussion categories load automatically once per workspace and multiple categories require an explicit choice',async()=>{
 const calls=[];let notes=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='github-discussion-categories')return[{id:'DIC_design',name:'Design review'},{id:'DIC_general',name:'General'}];if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='comment-list')return notes;if(m.type==='github-publish-comment')return{remoteRef:{kind:'discussion',repository:'wayri/fixture',number:91,url:'https://github.com/wayri/fixture/discussions/91',publishedAt:'2026-11-02T00:00:00Z'}};return[];});view.load();view.get('commentConversationKind').value='discussion';view.get('newConversation').click();view.get('commentText').value='New discussion';await new Promise(setImmediate);assert.equal(calls.filter(m=>m.type==='github-discussion-categories').length,1);assert.equal(view.get('editorCategory').value,'');assert.equal(view.get('editorNumberLabel').hidden,true);assert.equal(calls.some(m=>m.type==='github-publish-comment'),false);
 view.get('editorCategory').value='DIC_design';await sendComment(view);const published=calls.find(m=>m.type==='github-publish-comment');assert.equal(published.destination,'new-discussion');assert.equal(published.categoryId,'DIC_design');assert.equal(published.number,undefined);view.get('newConversation').click();await new Promise(setImmediate);assert.equal(calls.filter(m=>m.type==='github-discussion-categories').length,1);view.workspace.dispose();
});
test('discussion category completion cannot overwrite a different editor, and failed lookup remains retryable',async()=>{
 let finish,calls=0;const view=workspaceRuntime(async m=>{if(m.type==='github-discussion-categories'){calls++;if(calls===1)return new Promise(resolve=>finish=resolve);return[{id:'DIC_retry',name:'Retry category'}];}return[];});view.load();view.get('newComment').click();view.get('editorThreadType').value='discussion';view.get('editorThreadType').onchange();assert.equal(calls,1);view.get('cancelComment').click();view.get('commentCategoryIssue').click();view.get('newComment').click();finish([{id:'DIC_old',name:'Old category'}]);await new Promise(setImmediate);assert.equal(view.get('editorDestination').value,'issue');assert.equal(view.get('editorCategoryLabel').hidden,true);view.get('editorThreadType').value='discussion';view.get('editorThreadType').onchange();assert.equal(view.get('editorCategory').value,'DIC_old');assert.equal(calls,1);view.workspace.dispose();
 let fail=true;const retry=workspaceRuntime(async m=>{if(m.type==='github-discussion-categories'){if(fail)throw Error('Category lookup unavailable');return[{id:'DIC_ok',name:'Available category'}];}return[];});retry.load();retry.get('newComment').click();retry.get('editorThreadType').value='discussion';retry.get('editorThreadType').onchange();await new Promise(setImmediate);assert.match(retry.get('editorCategoryStatus').textContent,/Use Load categories to retry/);assert.equal(retry.get('editorLoadCategories').disabled,false);fail=false;await retry.get('editorLoadCategories').click();assert.equal(retry.get('editorCategory').value,'DIC_ok');assert.doesNotMatch(retry.get('commentStatus').textContent,/Could not load/);retry.workspace.dispose();
});
test('new Discussion preserves a valid explicitly remembered existing thread and ignores invalid remembered numbers',()=>{
 for(const number of [37,0]){const view=workspaceRuntime();view.load();view.receipts.set(JSON.stringify(['kivi-post-destination','github','https://github.com','wayri/fixture']),JSON.stringify({type:'discussion',destination:'existing-discussion',number}));view.get('commentConversationKind').value='discussion';view.get('newConversation').click();assert.equal(view.get('editorDestination').value,number?'existing-discussion':'discussion');assert.equal(view.get('editorNumberLabel').hidden,!number);if(number)assert.equal(view.get('editorThreadNumber').value,'37');view.workspace.dispose();}
});

test('Discussion Send reviews first consent but skips repeated dialogs for a known chosen category',async()=>{
 const calls=[];let notes=[],posts=0;const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='github-discussion-categories')return[{id:'DIC_design',name:'Design review'},{id:'DIC_general',name:'General'}];if(m.type==='comment-save'){notes=[...notes.filter(note=>note.id!==m.comment.id),m.comment];return m.comment;}if(m.type==='comment-list')return notes;if(m.type==='github-annotations')return{notes:[],warnings:[]};if(m.type==='chat-thread-list')return{threads:[],hasMore:false};if(m.type==='github-publish-comment'){posts++;assert.equal(m.destination,'new-discussion');assert.equal(m.categoryId,'DIC_design');return{remoteRef:{kind:'discussion',repository:'wayri/fixture',number:90+posts,url:'https://github.com/wayri/fixture/discussions/'+(90+posts),publishedAt:'2026-11-02T00:00:00Z'}};}return[];},{unacceptedRules:true});
 view.load();view.get('commentConversationKind').value='discussion';view.get('newConversation').click();view.get('commentText').value='First Discussion';await new Promise(setImmediate);assert.equal(posts,0);assert.equal(view.get('editorCategory').value,'');view.get('editorCategory').value='DIC_design';await view.get('postComment').click();assert.equal(view.get('commentPostReview').open,true);assert.equal(posts,0);await view.get('confirmCommentPost').click();assert.equal(posts,0);view.get('acceptContentRules').checked=true;await view.get('confirmCommentPost').click();assert.equal(posts,1);assert.equal(view.get('commentPostReview').open,false);
 view.get('newConversation').click();view.get('commentText').value='Second Discussion';await new Promise(setImmediate);assert.equal(view.get('editorCategory').value,'DIC_design');assert.equal(posts,1);await view.get('postComment').click();await new Promise(setImmediate);assert.equal(posts,2);assert.equal(view.get('commentPostReview').open,false,'persisted consent and valid category do not reopen a review dialog');assert.equal(calls.filter(m=>m.type==='github-discussion-categories').length,1);
 view.get('newConversation').click();view.get('commentText').value='Explicit destination review';await chooseDestination(view);assert.equal(view.get('commentPostReview').open,true,'explicit Destination action still opens review');assert.equal(posts,2);view.workspace.dispose();
});


test('D opens only a selected component safe datasheet; C anchors selection; R rotates without intercepting typing',()=>{
 const source='(kicad_pcb (footprint "R" (at 30 40) (uuid "fp") (property "Reference" "R1") (property "Datasheet" "https://example.org/device.pdf") (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (uuid "pad"))))';
 const view=workspaceRuntime(undefined,{source});view.load();const links=[],create=view.document.createElement;view.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.onclick=()=>links.push({href:node.href,target:node.target,rel:node.rel});return node;};
 view.key('d');assert.equal(links.length,0);view.get('navBom').click();action(view.get('bomRows'),'R1').click();
 view.key('d');assert.deepEqual(links,[{href:'https://example.org/device.pdf',target:'_blank',rel:'noopener noreferrer'}]);
 view.key('d',{composedPath:()=>[{tagName:'INPUT'}]});assert.equal(links.length,1);
 view.key('c');assert.match(view.get('commentAnchor').textContent,/R1/);
 const turns=[];view.canvas.rotateDegrees=n=>turns.push(n);view.key('r');view.key('R',{shiftKey:true});view.get('rotateViewCW').click();view.get('rotateViewCCW').click();assert.deepEqual(turns,[15,-15,15,-15]);view.key('r',{composedPath:()=>[{isContentEditable:true}]});assert.equal(turns.length,4);
 const rotations=[];view.workspace.setScene({setPopulation(){},setSelection(){},rotate:d=>rotations.push(d)});view.key('r');view.key('R',{shiftKey:true});assert.deepEqual(rotations,[15,-15]);view.workspace.dispose();
});

test('website handoff saves signed-out draft and opens only an explicit manual website link',async()=>{
 const calls=[];let notes=[];const C=require('../review-comments.js');const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-list')return notes;if(m.type==='comment-policy-status')return{allowed:false,reason:'Signed out'};if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='open-comment-draft')return{url:'https://github.com/wayri/fixture/issues/new?title=Review',body:C.toMarkdown(m.comment),prefilled:true};return[];},{unacceptedRules:true});view.load();await new Promise(setImmediate);
 view.get('newComment').click();view.get('commentText').value='Manual website review @reviewer';const before=calls.length;await view.get('commentWebsiteHandoff').click();
 assert.deepEqual(calls.slice(before).map(m=>m.type),['comment-save','open-comment-draft']);assert.equal(notes.length,1);assert.equal(notes[0].text,'Manual website review @reviewer');assert.equal(notes[0].remoteRefs.length,0);assert.equal(view.get('commentWebsiteReview').open,true);assert.equal(view.get('commentPostReview').open,undefined);assert.equal(view.receipts.has('kivi:content-rules'),false);
 assert.equal(calls.filter(m=>m.type==='open-comment-draft').length,1);const prepared=calls.find(m=>m.type==='open-comment-draft');assert.equal(prepared.websiteHandoff,true);assert.equal(prepared.destination,'issue');assert.ok(calls.findIndex(m=>m.type==='comment-save')<calls.findIndex(m=>m.type==='open-comment-draft'));
 assert.match(view.get('websiteCommentMarkdown').value,/kicad-review:v1/);assert.match(view.get('websiteCommentStatus').textContent,/Nothing has been posted/);assert.match(view.get('websiteCommentStatus').textContent,/not uploaded/);assert.match(view.get('websiteCommentStatus').textContent,/sync still require provider API access/);assert.equal(view.get('openWebsiteComment').target,'_blank');assert.equal(view.get('openWebsiteComment').rel,'noopener noreferrer');
 await view.get('copyWebsiteComment').click();assert.match(view.get('websiteCommentStatus').textContent,/Select and copy/);assert.equal(calls.some(m=>/publish|chat-post|auth/.test(m.type)),false);
});
test('website handoff rejects unsaved drafts and unexpected destination links',async()=>{
 for(const failure of ['save','url']){const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-save'&&failure==='save')throw Error('Local storage unavailable');if(m.type==='open-comment-draft')return{url:'https://evil.example/wayri/fixture/issues/new',body:'text',prefilled:false};return[];});view.load();view.get('newComment').click();view.get('commentText').value='Keep draft';await view.get('commentWebsiteHandoff').click();assert.equal(view.get('commentWebsiteReview').open,undefined);assert.match(view.get('commentStatus').textContent,failure==='save'?/Local storage unavailable/:/Unexpected website/);assert.equal(calls.some(m=>m.type==='open-comment-draft'),failure!=='save');assert.equal(view.get('commentEditor').hidden,false);}
});
test('website handoff does not attach a delayed preparation to a different editor',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);const view=workspaceRuntime(async m=>{if(m.type==='open-comment-draft')return pending;return[];});view.load();view.get('newComment').click();view.get('commentText').value='Original';const handoff=view.get('commentWebsiteHandoff').click();await new Promise(setImmediate);view.get('cancelComment').click();view.get('newComment').click();view.get('commentText').value='Replacement';finish({url:'https://github.com/wayri/fixture/issues/new',body:'Original',prefilled:false});await handoff;assert.equal(view.get('commentWebsiteReview').open,undefined);assert.equal(view.get('commentText').value,'Replacement');assert.match(view.get('commentStatus').textContent,/draft changed/);
});

test('website handoff stays hidden in connected native viewers without changing direct publication',async()=>{
 for(const hooks of [{vscode:{collaboration:{provider:'github',repository:'wayri/fixture',ref:'main'}}},{android:true,androidOnline:true}]){
  const calls=[];let notes=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='comment-list')return notes;return[];},hooks);view.load();view.get('newComment').click();view.get('commentText').value='Native draft';assert.equal(view.get('commentWebsiteHandoff').hidden,true);assert.equal(view.get('commentPublishSettings').hidden,false);const before=calls.length;await view.get('commentWebsiteHandoff').click();assert.equal(calls.length,before);await view.get('saveComment').click();const cardAction=descendants(view.get('commentList')).find(n=>n.className==='github-draft-action');assert.ok(cardAction);assert.equal(cardAction.hidden,true);
 }
});

test('property field action opens a source-bound draft and saves field context only on explicit save',async()=>{
 const calls=[],view=workspaceRuntime(async m=>{calls.push(m);return [];});view.load();view.get('objectList').children[0].click();
 const rows=view.get('propertyList').children[0].children[1].children,row=rows.find(r=>r.children[0].textContent==='Value');
 row.children[1].children[1].click();assert.equal(view.get('commentEditor').hidden,false);assert.match(view.get('commentAnchor').textContent,/Property: Value/);
 assert.equal(calls.some(m=>m.type==='comment-save'),false);view.get('commentText').value='Check this value';await view.get('saveComment').click();
 const saved=calls.find(m=>m.type==='comment-save').comment;assert.equal(saved.anchor.reference,'R1');assert.equal(saved.anchor.file,'board.kicad_pcb');assert.equal(saved.anchor.reviewTarget.surface,'property');assert.equal(saved.anchor.reviewTarget.field,'Value');assert.ok(saved.anchor.position);view.workspace.dispose();
});

test('keep-context checkbox defaults on and consistently controls 2D and 3D selection appearance',()=>{
 const view=workspaceRuntime();view.load();assert.equal(view.get('keepContextColors').checked,true);
 view.get('objectList').children[0].click();assert.equal(view.canvas.highlightMode,'bright');
 let dim;view.workspace.setScene({setPopulation(){},setSelection(){},setSelectionDim(value){dim=value;}});assert.equal(dim,false);
 view.get('keepContextColors').checked=false;view.get('keepContextColors').onchange();assert.equal(dim,true);assert.equal(view.canvas.highlightMode,'dim');
 view.get('keepContextColors').checked=true;view.get('keepContextColors').onchange();assert.equal(dim,false);assert.equal(view.canvas.highlightMode,'bright');
 view.workspace.setScene(null);assert.equal(view.canvas.highlightMode,'bright');view.workspace.dispose();
});

test('net color choice persists independently of context dimming and reaches the 3D host',()=>{
 const view=workspaceRuntime();view.load();assert.equal(view.get('netHighlightColor').value,'accent');assert.equal(view.get('netHighlightColorControl').hidden,false);
 const colors=[];view.workspace.setScene({setPopulation(){},setSelection(){},setNetHighlightColor:value=>colors.push(value)});
 view.get('netHighlightColor').value='layer';view.get('netHighlightColor').onchange();assert.equal(colors.at(-1),'layer');assert.equal(view.receipts.get('kicad:net-highlight-color:v1'),'layer');assert.equal(view.get('keepContextColors').checked,true);
 view.get('keepContextColors').checked=false;view.get('keepContextColors').onchange();assert.equal(colors.at(-1),'layer');view.get('netHighlightColor').value='accent';view.get('netHighlightColor').onchange();assert.equal(colors.at(-1),'accent');view.workspace.dispose();
});

test('comment options always provide a visible return action even when category navigation is hidden',()=>{
 const view=workspaceRuntime();view.load();const menu=view.get('commentThreadReader').querySelector('.chat-catalog-more');action(menu,'Comment settings').click();assert.equal(view.get('commentSettings').hidden,false);assert.equal(view.get('backToComments').parentElement.parentElement.id,'commentSettings');view.get('backToComments').click();assert.equal(view.get('commentSettings').hidden,true);assert.equal(view.get('commentSettingsButton').attributes['aria-expanded'],'false');assert.equal(view.get('newConversation').focused,true);view.workspace.dispose();
});
test('failed initial conversation loading can retry by reopening Comments',async()=>{
 let fail=true;const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='chat-thread-list'){if(fail)throw Error('Session temporarily unavailable');return{threads:[{kind:'issue',number:9,title:'Recovered issue'}],hasMore:false};}return{notes:[],warnings:[]};},{reviewSync:{create:options=>({start(){void options.load().catch(error=>options.onState({status:'error',error}));},visibilityChanged(){},dispose(){}})}});view.load();await new Promise(setImmediate);assert.match(view.get('commentThreadStatus').textContent,/Session temporarily unavailable/);fail=false;view.get('commentsButton').click();await new Promise(setImmediate);assert.match(view.get('commentThreadReader').textContent,/Recovered issue/);assert.equal(calls.filter(m=>m.type==='chat-thread-list').length,4);view.workspace.dispose();
});

test('hidden project defers initial review reads until foreground and website-only pagination never loops page one',async()=>{
 const calls=[];let sync;const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='chat-thread-list')return{threads:[{kind:'issue',number:7,title:'Initial page'}],hasMore:true,pagination:'website-only',warnings:['More Issues are available on GitHub; use Open by number.']};return{notes:[],warnings:[]};},{hidden:true,reviewSync:{create:options=>{sync=require('../review-sync.js').create({...options,setTimer:()=>1,clearTimer(){}});return sync;}}});view.load();await new Promise(setImmediate);assert.equal(calls.some(m=>m.type==='chat-thread-list'||m.type==='github-annotations'),false);view.document.hidden=false;sync.visibilityChanged();await new Promise(setImmediate);assert.match(view.get('commentThreadReader').textContent,/Initial page/);assert.match(view.get('commentThreadStatus').textContent,/More Issues/);assert.equal(action(view.get('commentThreadReader'),'Load more').hidden,true);assert.equal(sync.snapshot().status,'synced');assert.equal(calls.filter(m=>m.type==='github-annotations').length,1);view.workspace.dispose();
});

test('conversation catalogue failure does not suppress drawing annotation refresh',async()=>{
 const calls=[];const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='chat-thread-list')throw Error('Issue catalogue unavailable');return{notes:[],warnings:[]};},{reviewSync:{create:options=>({start(){void options.load().then(options.onUpdate).catch(error=>options.onState({status:'error',error}));},visibilityChanged(){},dispose(){}})}});
 view.load();await new Promise(setImmediate);assert.equal(calls.filter(m=>m.type==='github-annotations').length,1);assert.match(view.get('commentThreadStatus').textContent,/Issue catalogue unavailable/);view.workspace.dispose();
});

test('startup discovers ordinary Issues without review markers and opens their body and replies',async()=>{
 const time='2026-11-04T06:00:00Z',url='https://github.com/wayri/fixture/issues/19',calls=[];
 const thread={kind:'issue',number:19,title:'Review the encoder bank',state:'open',author:'reviewer',body:'Ordinary issue description without location metadata',createdAt:time,updatedAt:time,url,comments:[{id:'42',body:'Existing reply from GitHub',author:'colleague',createdAt:time,updatedAt:time,url:url+'#issuecomment-42',replyTo:null}],warnings:[]};
 const view=workspaceRuntime(async m=>{calls.push(m);if(m.type==='chat-thread-list')return{threads:m.kind==='issue'?[thread]:[],hasMore:false};if(m.type==='github-annotations')return{notes:[],warnings:[]};if(m.type==='github-thread-read')return thread;return[];},{reviewSync:{create:options=>require('../review-sync.js').create({...options,setTimer:()=>1,clearTimer(){}})}});
 view.load();await new Promise(setImmediate);view.get('commentsButton').click();await new Promise(setImmediate);
 const row=descendants(view.get('commentThreadReader')).find(n=>n.className==='chat-conversation');assert.ok(row,'ordinary issues are listed even when there are zero drawing markers');assert.match(row.textContent,/Review the encoder bank/);await row.click();
 assert.match(view.get('commentThreadMessages').textContent,/Ordinary issue description without location metadata/);assert.match(view.get('commentThreadMessages').textContent,/Existing reply from GitHub/);assert.doesNotMatch(view.get('commentList').textContent,/Ordinary issue description|Existing reply/);assert.equal(calls.some(m=>/publish|message-write/.test(m.type)),false);view.workspace.dispose();
});

test('catalogue errors preserve successfully fetched drawing annotations and remain visible for retry',async()=>{
 const note={id:'partial-review',text:'Successfully fetched marker',createdAt:'2026-10-04T00:00:00Z',severity:'info',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb',position:{x:3,y:4}}};let sync;
 const view=workspaceRuntime(async m=>{if(m.type==='chat-thread-list')throw Error('Catalogue temporarily unavailable');if(m.type==='github-annotations')return{notes:[note],warnings:[]};return[];},{reviewSync:{create:options=>{sync=require('../review-sync.js').create({...options,setTimer:()=>1,clearTimer(){}});return sync;}}});
 view.load();await new Promise(setImmediate);assert.match(view.get('commentList').textContent,/Successfully fetched marker/);assert.match(view.get('commentStatus').textContent,/Catalogue temporarily unavailable/);assert.equal(sync.snapshot().status,'error');view.workspace.dispose();
});

test('schematic native properties show resolved project MPN with variable provenance',()=>{
 const file={path:'Encoder.kicad_sch',textVariables:{ENCODER_OPAMP_MPN:'OPA4192IPWR'},content:'(kicad_sch (uuid root) (symbol (lib_id "Amplifier_Operational:Quad") (at 20 20 0) (uuid "u2") (property "Reference" "U2") (property "Value" "${ENCODER_OPAMP_MPN}") (property "Footprint" "Encoder:TSSOP-14_4.4x5mm_P0.65mm")))'};
 const view=workspaceRuntime(undefined,{pcb:false,files:[file]});view.load();view.get('objectList').children[0].click();const table=view.get('propertyList').children[0],row=table.children[1].children.find(row=>row.children[0].textContent==='Value');
 assert.equal(row.children[1].children[0].textContent,'OPA4192IPWR');const badge=row.children[1].children.find(node=>node.className==='property-variable-source');assert.match(badge.textContent,/Variable.*ENCODER_OPAMP_MPN/);assert.match(badge.title,/Saved expression:.*ENCODER_OPAMP_MPN.*\nENCODER_OPAMP_MPN — Project/);assert.match(view.get('selectionSummary').textContent,/OPA4192IPWR/);assert.match(file.content,/\$\{ENCODER_OPAMP_MPN\}/);view.workspace.dispose();
});

test('schematic variable viewer switches saved sheet contexts, filters and closes independently',()=>{
 const files=[{path:'root.kicad_sch',textVariables:{SUPPLY:'5V'},content:'(kicad_sch (uuid root) (title_block (title "Controller")))'},{path:'child.kicad_sch',textVariables:{SUPPLY:'3V3',MISSING:'${NOT_SAVED}'},content:'(kicad_sch (uuid child) (title_block (title "Sensor")))'}];
 const view=workspaceRuntime(undefined,{pcb:false,files});view.load();view.get('schematicVariablesButton').click();const dialog=descendants(view.document.body).find(node=>node.className==='variable-viewer-dialog'),sheet=descendants(dialog).find(node=>node.attributes['aria-label']==='Variable context sheet'),search=descendants(dialog).find(node=>node.attributes['aria-label']==='Search schematic variables');
 assert.equal(dialog.open,true);assert.match(dialog.textContent,/Controller.*Title block/);sheet.value='child.kicad_sch';sheet.onchange();assert.match(dialog.textContent,/Sensor/);assert.match(dialog.textContent,/Unresolved.*NOT_SAVED/);search.value='SUPPLY';search.oninput();assert.match(dialog.textContent,/3V3/);assert.doesNotMatch(descendants(dialog).find(node=>node.className==='variable-viewer-table').textContent,/Sensor|NOT_SAVED/);descendants(dialog).find(node=>node.attributes['aria-label']==='Close variable viewer').click();assert.equal(dialog.open,false);view.workspace.dispose();assert.equal(view.document.body.contains(dialog),false);
});

test('annotation More actions remain expanded across refresh with the same note',async()=>{const note={id:'stable-note-menu',text:'Keep this menu open',severity:'info',state:'open',createdAt:'2026-10-28T00:00:00Z',anchor:{repository:'wayri/fixture',ref:'main',file:'board.kicad_pcb'}};const view=workspaceRuntime(async m=>m.type==='comment-list'?[note]:[]);view.load();await view.workspace.refreshComments();const menu=()=>view.get('commentList').children[0].querySelector('.note-more-actions');menu().open=true;view.get('commentList').scrollTop=32;await view.workspace.refreshComments();assert.equal(menu().open,true);assert.equal(view.get('commentList').scrollTop,32);view.workspace.dispose();});

test('unchanged annotation publication retries preserve the exact original body timestamp',async()=>{
 let notes=[];const sends=[];const view=workspaceRuntime(async m=>{if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];return m.comment;}if(m.type==='github-publish-comment'){sends.push(m);throw Error('Unconfirmed outcome');}return[];});
 view.load();await new Promise(setImmediate);view.get('newComment').click();view.get('commentText').value='Stable retry context';await sendComment(view);await new Promise(resolve=>setTimeout(resolve,5));await sendComment(view);assert.equal(sends.length,2);assert.deepEqual(sends[1].comment,sends[0].comment);view.workspace.dispose();
});

test('screenshot-only and type-only editor changes advance the optimistic-concurrency version',async()=>{
 for(const change of ['screenshot','type']){let notes=[];const saved=[],view=workspaceRuntime(async m=>{if(m.type==='comment-list')return notes;if(m.type==='comment-save'){notes=[m.comment];saved.push(m);return m.comment;}if(m.type==='github-publish-comment')throw Error('Unconfirmed outcome');return[];},{compose:{normalizeCapture:async()=>({mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=',width:1,height:1})}});
 view.load();await new Promise(setImmediate);view.get('newComment').click();view.get('commentText').value='Same text';await sendComment(view);const before=saved.at(-1).comment.updatedAt;
 if(change==='screenshot'){const event=new Event('paste',{cancelable:true});Object.defineProperty(event,'clipboardData',{value:{items:[{kind:'file',type:'image/png',getAsFile:()=>new Blob(['image'],{type:'image/png'})}]}});view.get('commentText').dispatchEvent(event);await new Promise(setImmediate);}
 else{view.get('editorThreadType').value='discussion';view.get('editorThreadType').onchange();view.get('editorDestination').value='existing-discussion';view.get('editorDestination').onchange();view.get('editorThreadNumber').value='19';}
 await sendComment(view);assert.notEqual(saved.at(-1).comment.updatedAt,before,change);assert.equal(saved.at(-1).expectedUpdatedAt,before,change);view.workspace.dispose();}
});
