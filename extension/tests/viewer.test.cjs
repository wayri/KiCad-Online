const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const data = require('../browser-data.js');
const diff = require('../design-diff.js');
const viewState = require('../view-state.js');
const pairedReview = require('../paired-review.js');
const source = fs.readFileSync(path.join(__dirname, '../browser-viewer.js'), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function viewer(parameters, read, extras={}) {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = {};
      this.dataset = {}; this.hidden = false; this.value = ''; this.textContent = '';
      this.classList = { toggle: () => {} }; this.messages = [];
      this.contentWindow = { postMessage: (message, origin) => this.messages.push({message, origin}) };
    }
    set id(value) { this._id=value; elements.set(value,this); }
    get id() { return this._id; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    querySelectorAll() { return this.children.filter((node) => node.dataset.mode); }
    click() { this.listeners.click?.({}); }
  }
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get('changesPanel').hidden = true; get('changeFilter').value = 'all';
  const timers=new Set();const calls = [], listeners = new Map(), parentMessages=[],parent={postMessage:(message,origin)=>parentMessages.push({message,origin})};
  vm.runInNewContext(source, { URL, URLSearchParams, Number, Map, Set, Promise, parent,crypto:require('node:crypto').webcrypto,
    setTimeout:(fn,ms)=>{const timer={fn,ms};timers.add(timer);return timer;},clearTimeout:timer=>timers.delete(timer),
    KiCadGitHub: require('../parsing.js'), KiCadBrowserData: data, KiCadDesignDiff: diff, KiCadViewState: viewState, KiCadPairedReview:pairedReview,
    location: { search: '?'+new URLSearchParams(parameters) },
    matchMedia: () => ({ matches: true }), addEventListener: (name, callback) => {const all=listeners.get(name)||[];all.push(callback);listeners.set(name,all);},
    chrome: { runtime: { getURL: (name) => 'chrome-extension://test-id/'+name,
      sendMessage: async (message) => { calls.push(message); return read(message); } } },
    document: { getElementById: get, createElement: (tag) => new Element(tag) },...extras });
  return { get, calls, parent, parentMessages,expire:()=>{for(const timer of [...timers])timer.fn();},dispatch:(type,event)=>listeners.get(type)?.forEach(fn=>fn(event)),pagehide:()=>listeners.get('pagehide')?.forEach(fn=>fn()), message: (event) => listeners.get('message').forEach(callback=>callback(event)), click: (text) => get('toolbar').children.find((node) => node.textContent === text).click() };
}
const parameters = {repository:'wayri/board', headRepository:'fork/board', file:'new.kicad_sch',
  oldFile:'old.kicad_sch', base:'a'.repeat(40), head:'b'.repeat(40)};
const sch = (value) => `(kicad_sch (symbol (lib_id "Device:R") (uuid "one") (at 10 20 0) (property "Reference" "R1") (property "Value" "${value}")))`;

test('sheet-browser search from Layout waits for the schematic frame and never sends the action to the PCB',async()=>{
 let search;const view=viewer({...parameters,base:'',file:'board.kicad_pcb'},message=>({ok:true,result:{files:[{path:'root.kicad_sch'}]}}),{KiCadWorkspaceSearch:{mount:options=>{search=options;return{destroy(){}};}}}),pcb=view.get('headDrawing').children[0];
 view.message({origin:'chrome-extension://test-id',source:pcb.contentWindow,data:{type:'kicad-review:view',phase:'ready',file:'board.kicad_pcb',view:{x:0,y:0,zoom:1}}});await search.open({kind:'command',action:'sheet-tree'});
 assert.equal(pcb.messages.some(item=>item.message.command==='search-result'),false);const schematic=view.get('pairDrawing').children[0];assert.ok(schematic);assert.equal(schematic.messages.length,0);
 view.message({origin:'chrome-extension://test-id',source:schematic.contentWindow,data:{type:'kicad-review:view',phase:'ready',file:'root.kicad_sch',view:{x:0,y:0,zoom:1}}});assert.equal(schematic.messages.at(-1).message.command,'search-result');assert.equal(schematic.messages.at(-1).message.result.action,'sheet-tree');
});

test('renamed designs compare properties and focus inside extension frames', async () => {
  const view = viewer(parameters, ({ref,file}) => ({ok:true, result:[{path:file,content:sch(ref[0] === 'a' ? '1k' : '2k')}]}));
  view.click('Changes'); await tick();
  assert.equal(view.get('changesPanel').hidden, false);
  assert.equal(view.get('changeCount').textContent, '0 added · 0 removed · 1 modified');
  assert.equal(view.calls[0].file, 'old.kicad_sch');
  assert.equal(view.calls[1].repository, 'fork/board');
  const row = view.get('changeList').children[0]; row.click();
  const table = view.get('changeProperties').children.find((node) => node.tagName === 'TABLE');
  const value = table.children.find((row) => row.children[0]?.textContent === 'Value');
  assert.deepEqual(value.children.map((node) => node.textContent), ['Value','1k','2k']);
  const frame = view.get('headDrawing').children[0];
  assert.equal(frame.messages[0].origin, 'chrome-extension://test-id');
  assert.equal(frame.messages[0].message.command, 'focus');
  view.get('changeSearch').value = 'no-match'; view.get('changeSearch').listeners.input();
  assert.equal(view.get('changeList').children[0].textContent, 'No changes match this filter.');
});

test('added and removed designs never request the absent revision', async () => {
  for (const status of ['added','removed']) {
    const view = viewer({...parameters, status}, ({file}) => ({ok:true,result:[{path:file,content:sch('1k')}]}));
    const absent = view.get(status === 'added' ? 'baseDrawing' : 'headDrawing');
    assert.equal(absent.children.length, 0);
    assert.match(absent.textContent, /absent/);
    view.click('Changes'); await tick();
    assert.equal(view.calls.length, 1);
    assert.equal(view.calls[0].ref, status === 'added' ? parameters.head : parameters.base);
    assert.match(view.get('changeCount').textContent, status === 'added' ? /1 added/ : /1 removed/);
  }
});

test('selecting an object removed from a schematic reveals its base drawing', async () => {
  const view = viewer(parameters, ({ref,file}) => ({ok:true,result:[{path:file,
    content:ref[0] === 'a' ? sch('1k') : '(kicad_sch)'}]}));
  assert.equal(view.get('basePanel').hidden, true, 'schematic starts in head mode');
  view.click('Changes'); await tick();
  view.get('changeList').children[0].click();
  assert.equal(view.get('basePanel').hidden, false);
  assert.equal(view.get('headPanel').hidden, true);
  assert.equal(view.get('baseDrawing').children[0].messages[0].message.command, 'focus');
});

test('invalid locations create no frames or data requests; empty action page explains inline use', () => {
  const invalid = viewer({...parameters, file:'../unsafe.kicad_sch'}, () => assert.fail('unexpected request'));
  assert.match(invalid.get('status').textContent, /invalid/);
  assert.equal(invalid.get('headDrawing').children.length, 0);
  const empty = viewer({}, () => assert.fail('unexpected request'));
  assert.match(empty.get('status').textContent, /view it inline/);
  assert.equal(empty.get('comparison').hidden, true);
});

test('lookup failure can be retried and fit controls send only to extension frames', async () => {
  let failures = true;
  const view = viewer(parameters, ({file}) => failures ? {ok:false,error:'GitHub rate limit'} : {ok:true,result:[{path:file,content:sch('1k')}]} );
  view.click('Changes'); await tick();
  assert.equal(view.get('changeCount').textContent, 'GitHub rate limit');
  failures = false; view.click('Changes'); view.click('Changes'); await tick();
  assert.equal(view.get('changeCount').textContent, '0 added · 0 removed · 0 modified');
  view.click('Fit drawings');
  for (const side of ['base','head']) {
    const message = view.get(side+'Drawing').children[0].messages[0];
    assert.equal(message.origin, 'chrome-extension://test-id');
    assert.equal(message.message.command, 'fit-drawing');
  }
});


test('linked views relay only trusted matching sheets and preserve world zoom', () => {
  const view = viewer(parameters, () => assert.fail('unexpected data request'));
  const base = view.get('baseDrawing').children[0], head = view.get('headDrawing').children[0];
  const publish = (frame, file, camera, phase = 'change', origin = 'chrome-extension://test-id') =>
    view.message({source: frame.contentWindow, origin, data: {type: 'kicad-review:view', file, phase, view: camera}});
  const camera = {x: 100, y: 80, zoom: 2.5};
  publish(base, 'old.kicad_sch', {x: 10, y: 20, zoom: 1}, 'ready');
  assert.equal(head.messages.length, 0, 'wait for both initial views');
  publish(head, 'new.kicad_sch', camera, 'ready');
  assert.deepEqual(JSON.parse(JSON.stringify(base.messages[0].message)), {
    type: 'kicad-review:command', command: 'set-view', file: 'old.kicad_sch', view: camera
  });
  const count = base.messages.length;
  publish(head, 'new.kicad_sch', {...camera, x: 500}, 'change', 'https://github.com');
  publish({contentWindow: {}}, 'new.kicad_sch', camera);
  publish(head, 'new.kicad_sch', {...camera, zoom: NaN});
  assert.equal(base.messages.length, count, 'untrusted or invalid reports cannot relay');
  publish(head, 'sheets/child.kicad_sch', camera, 'ready');
  publish(head, 'sheets/child.kicad_sch', {...camera, x: 300});
  assert.equal(base.messages.length, count, 'different active sheets stay independent');
  publish(base, 'sheets/child.kicad_sch', camera, 'ready');
  assert.equal(base.messages.at(-1).message.file, 'sheets/child.kicad_sch');
  view.click('Link views');
  const stopped = base.messages.length;
  publish(head, 'sheets/child.kicad_sch', {...camera, x: 400});
  assert.equal(base.messages.length, stopped, 'user can unlink cameras');
});

test('linked change focus uses one shared location so a moved object remains visible', async () => {
  const view = viewer(parameters, ({ref,file}) => ({ok:true,result:[{path:file,
    content:sch('1k').replace('(at 10 20 0)', ref[0] === 'a' ? '(at 10 20 0)' : '(at 40 50 0)')}]}));
  view.click('Changes'); await tick();
  view.get('changeList').children[0].click();
  for (const side of ['base','head']) {
    assert.deepEqual(JSON.parse(JSON.stringify(view.get(side+'Drawing').children[0].messages[0].message.position)), {x:40,y:50});
  }
  view.click('Link views');
  view.get('changeList').children[0].click();
  assert.deepEqual(JSON.parse(JSON.stringify(view.get('baseDrawing').children[0].messages.at(-1).message.position)), {x:10,y:20});
});


test('selecting a root change after subsheet navigation returns each drawing to the root', async () => {
  const view = viewer(parameters, ({ref,file}) => ({ok:true,result:[{path:file,content:sch(ref[0] === 'a' ? '1k' : '2k')}]}));
  view.click('Changes'); await tick();
  const original = {};
  for (const side of ['base','head']) {
    original[side] = view.get(side+'Drawing').children[0];
    view.message({source: original[side].contentWindow, origin: 'chrome-extension://test-id',
      data: {type:'kicad-review:view',phase:'ready',file:'sheets/child.kicad_sch',view:{x:200,y:300,zoom:2}}});
  }
  view.get('changeList').children[0].click();
  for (const side of ['base','head']) {
    const frame = view.get(side+'Drawing').children[0];
    assert.notEqual(frame, original[side]);
    assert.equal(new URL(frame.src).searchParams.get('file'), side === 'base' ? 'old.kicad_sch' : 'new.kicad_sch');
  }
});


test('paired review keeps same repository revision and relays only trusted selections',async()=>{
 const view=viewer({repository:'wayri/board',file:'board.kicad_pcb',head:'a'.repeat(40),pairedFile:'root.kicad_sch'},()=>({ok:true,result:[]}));
 const main=view.get('headDrawing').children[0],pair=view.get('pairDrawing').children[0];
 assert.equal(new URL(pair.src).searchParams.get('repository'),'wayri/board');
 assert.equal(new URL(pair.src).searchParams.get('ref'),'a'.repeat(40));
 assert.equal(view.get('pairPanel').hidden,false);
 view.message({origin:'chrome-extension://test-id',source:pair.contentWindow,data:{type:'kicad-review:view',phase:'ready',file:'root.kicad_sch',view:{x:0,y:0,zoom:1}}});
 const selection={kind:'part',reference:'R1',path:'board.kicad_pcb',uuid:'fp'};
 view.message({origin:'chrome-extension://test-id',source:main.contentWindow,data:{type:'kicad-review:selection',selection}});
 assert.equal(pair.messages.at(-1).message.command,'highlight-related');
 const count=pair.messages.length;
 for(const [source,origin] of [[{},'chrome-extension://test-id'],[main.contentWindow,'https://github.com']])view.message({source,origin,data:{type:'kicad-review:selection',selection}});
 assert.equal(pair.messages.length,count);
 view.message({origin:'chrome-extension://test-id',source:main.contentWindow,data:{type:'kicad-review:comments-changed'}});
 assert.equal(pair.messages.at(-1).message.command,'refresh-comments');
});
test('paired cross-highlight waits for the companion to finish loading and retains the latest selection',()=>{
 const view=viewer({repository:'wayri/board',file:'board.kicad_pcb',head:'a'.repeat(40),pairedFile:'root.kicad_sch'},()=>({ok:true,result:[]}));
 const main=view.get('headDrawing').children[0],pair=view.get('pairDrawing').children[0];
 for(const reference of ['R1','R2'])view.message({origin:'chrome-extension://test-id',source:main.contentWindow,data:{type:'kicad-review:selection',selection:{kind:'part',reference,path:'board.kicad_pcb'}}});
 assert.equal(pair.messages.length,0);
 view.message({origin:'chrome-extension://test-id',source:pair.contentWindow,data:{type:'kicad-review:view',phase:'ready',file:'root.kicad_sch',view:{x:0,y:0,zoom:1}}});
 assert.equal(pair.messages.length,1);assert.equal(pair.messages[0].message.selection.reference,'R2');
});
test('invalid same-kind companion is rejected without making a frame',()=>{
 const view=viewer({repository:'wayri/board',file:'board.kicad_pcb',head:'a'.repeat(40),pairedFile:'other.kicad_pcb'},()=>({ok:true,result:[]}));
 assert.equal(view.get('pairDrawing').children.length,0);
 assert.match(view.get('status').textContent,/Invalid companion/);
});


test('GitLab inline shell resolves branch commits before creating provider-bound drawing frames',async()=>{
 const sha='c'.repeat(40),view=viewer({provider:'gitlab',repository:'group/sub/board',head:'feature/pcb',file:'board.kicad_pcb'},message=>({ok:true,result:{repository:message.repository,sha}}));
 assert.equal(view.get('headDrawing').children.length,0);await tick();
 assert.equal(view.calls[0].provider,'gitlab');assert.equal(view.calls[0].type,'revision-resolve');assert.equal(view.calls[0].ref,'feature/pcb');
 const frame=view.get('headDrawing').children[0],query=new URL(frame.src).searchParams;
 assert.equal(query.get('provider'),'gitlab');assert.equal(query.get('ref'),sha);assert.equal(query.get('repository'),'group/sub/board');
 assert.equal(view.get('sourceLink').textContent,'GitLab source');assert.match(view.get('sourceLink').href,/gitlab.com\/group\/sub\/board\/-\/blob/);
});


test('shared hierarchy relays from the current head and sheet commands only from the trusted parent',async()=>{
 const view=viewer(parameters,({file})=>({ok:true,result:[{path:file,content:sch('1k')}]}));await tick();const head=view.get('headDrawing').children[0],base=view.get('baseDrawing').children[0],origin='chrome-extension://test-id',hierarchy={active:'new.kicad_sch',sheets:[]};
 const event={source:head.contentWindow,origin,data:{type:'kicad-review:hierarchy',repository:'wrong',ref:'wrong',hierarchy}};
 view.message({...event,source:base.contentWindow});view.message({...event,origin:'https://evil.test'});assert.equal(view.parentMessages.length,0);view.message(event);assert.equal(view.parentMessages[0].message.repository,'fork/board');assert.equal(view.parentMessages[0].message.ref,parameters.head);
 const command={source:view.parent,origin,data:{type:'kicad-review:open-sheet',file:'child.kicad_sch'}};view.message({...command,source:{}});view.message({...command,origin:'https://evil.test'});view.message({...command,data:{...command.data,file:'../private.kicad_sch'}});assert.equal(head.messages.length,0);view.message(command);assert.equal(head.messages[0].message.command,'open-sheet');assert.equal(head.messages[0].message.file,'child.kicad_sch');assert.equal(base.messages.length,0);
});


test('primary workspace tabs retain drawings while project settings are open', async () => {
 const view=viewer({...parameters,base:''},()=>({ok:false,error:'unexpected read'}));
 const frame=view.get('headDrawing').children[0];
 const tab=name=>[...view.get('workspaceTabs').children,...view.get('workspaceHelpers').children[1].children].find(button=>button.getAttribute('aria-label')===name+' view');
 assert.deepEqual(view.get('workspaceTabs').children.map(button=>button.getAttribute('aria-label')),['Schematic view','Layout view','3D view','BoM view','Simulation view','History view']);
 view.get('workspaceHelpers').open=true;tab('Project').click();assert.equal(view.get('workspaceHelpers').open,false);assert.equal(view.get('comparison').hidden,true);
 const project=view.get('projectWorkspace').children[0];assert.equal(new URL(project.src).searchParams.get('projectOnly'),'1');
 tab('Schematic').click();assert.equal(view.get('comparison').hidden,false);assert.equal(view.get('headDrawing').children[0],frame);
 tab('Project').click();assert.equal(view.get('projectWorkspace').children[0],project);assert.equal(view.calls.length,0);
});

test('layout tab uses lazy repository inventory and preserves both drawing frames', async () => {
 const view=viewer({...parameters,base:''},()=>({ok:true,result:{files:[{path:'boards/board.kicad_pcb'}]}}));
 const frame=view.get('headDrawing').children[0],tabs=view.get('workspaceTabs').children;
 tabs.find(button=>button.getAttribute('aria-label')==='Layout'+' view').click();await tick();
 assert.equal(view.calls[0].type,'project-inventory');assert.equal(view.calls[0].repository,'fork/board');
 const pair=view.get('pairDrawing').children[0];assert.equal(new URL(pair.src).searchParams.get('file'),'boards/board.kicad_pcb');
 assert.equal(view.get('headPanel').hidden,true);assert.equal(view.get('pairPanel').hidden,false);
 tabs.find(button=>button.getAttribute('aria-label')==='Schematic'+' view').click();tabs.find(button=>button.getAttribute('aria-label')==='Layout'+' view').click();await tick();
 assert.equal(view.get('headDrawing').children[0],frame);assert.equal(view.get('pairDrawing').children[0],pair);assert.equal(view.calls.length,1);
});

test('project entry opens settings without a nested drawing and accepts only its own drawing commands', async () => {
 const view=viewer({...parameters,base:'',file:'design/board.kicad_pro',oldFile:'design/board.kicad_pro'},()=>({ok:true,result:{files:[{path:'design/board.kicad_sch'},{path:'other.kicad_sch'}]}}));
 assert.equal(view.get('headDrawing').children.length,0);const project=view.get('projectWorkspace').children[0];
 view.message({origin:'chrome-extension://test-id',source:{},data:{type:'kicad-review:project-drawing',file:'other.kicad_sch'}});assert.equal(view.get('headDrawing').children.length,0);
 view.get('workspaceTabs').children.find(button=>button.getAttribute('aria-label')==='Schematic'+' view').click();await tick();
 assert.equal(new URL(view.get('headDrawing').children[0].src).searchParams.get('file'),'design/board.kicad_sch');
 view.message({origin:'https://evil.test',source:project.contentWindow,data:{type:'kicad-review:project-drawing',file:'other.kicad_sch'}});assert.equal(new URL(view.get('headDrawing').children[0].src).searchParams.get('file'),'design/board.kicad_sch');
});

test('ambiguous drawings need a choice and late discovery cannot reopen a hidden workspace', async () => {
 let resolve;const view=viewer({...parameters,base:''},()=>new Promise(done=>resolve=done));
 const tabs=[...view.get('workspaceTabs').children,...view.get('workspaceHelpers').children[1].children];tabs.find(button=>button.getAttribute('aria-label')==='Layout'+' view').click();
 tabs.find(button=>button.getAttribute('aria-label')==='Project'+' view').click();resolve({ok:true,result:{files:[{path:'a.kicad_pcb'},{path:'b.kicad_pcb'}]}});await tick();assert.equal(view.get('pairDrawing').children.length,0);assert.equal(view.get('comparison').hidden,true);
 tabs.find(button=>button.getAttribute('aria-label')==='Layout'+' view').click();await tick();assert.equal(view.get('pairDrawing').children.length,0);assert.equal(view.get('companionSelect').children.length,3);
 view.get('companionSelect').value='b.kicad_pcb';view.get('companionSelect').listeners.change();assert.equal(new URL(view.get('pairDrawing').children[0].src).searchParams.get('file'),'b.kicad_pcb');
});

test('project tab receives cached schematic hierarchy only after its trusted ready message',()=>{
 const view=viewer({...parameters,base:''},()=>({ok:false})),frame=view.get('headDrawing').children[0];
 view.message({origin:'chrome-extension://test-id',source:frame.contentWindow,data:{type:'kicad-review:hierarchy',hierarchy:{active:'new.kicad_sch'}}});
 view.get('workspaceHelpers').children[1].children.find(button=>button.getAttribute('aria-label')==='Project'+' view').click();const project=view.get('projectWorkspace').children[0];
 view.message({origin:'chrome-extension://test-id',source:{},data:{type:'kicad-review:project-ready'}});assert.equal(project.messages.length,0);
 view.message({origin:'chrome-extension://test-id',source:project.contentWindow,data:{type:'kicad-review:project-ready'}});assert.equal(project.messages[0].message.type,'kicad-review:hierarchy');assert.equal(project.messages[0].message.repository,'fork/board');
 view.message({origin:'chrome-extension://test-id',source:project.contentWindow,data:{type:'kicad-review:project-sheet',file:'child.kicad_sch'}});assert.equal(frame.messages.at(-1).message.command,'open-sheet');assert.equal(view.get('comparison').hidden,false);
});

test('split selection supersedes delayed workspace discovery and late split failures',async()=>{
 let resolveInventory,rejectSplit;const view=viewer({...parameters,base:''},message=>message.type==='project-inventory'?new Promise(done=>resolveInventory=done):new Promise((_,reject)=>rejectSplit=reject));
 view.get('workspaceTabs').children.find(b=>b.getAttribute('aria-label')==='Layout'+' view').click();view.get('projectTools').children.find(b=>b.textContent==='Split view').click();view.get('companionPath').value='manual.kicad_pcb';view.get('pairChooser').children.find(b=>b.textContent==='Open pair').click();
 resolveInventory({ok:true,result:{files:[{path:'other.kicad_pcb'}]}});rejectSplit(Error('Old lookup failed'));await tick();assert.equal(new URL(view.get('pairDrawing').children[0].src).searchParams.get('file'),'manual.kicad_pcb');assert.doesNotMatch(view.get('status').textContent,/Old lookup/);assert.equal(view.get('splitView').attributes['aria-pressed'],'true');
});
test('Project tab cancels a delayed split lookup',async()=>{
 let resolve;const view=viewer({...parameters,base:''},()=>new Promise(done=>resolve=done));view.get('projectTools').children.find(b=>b.textContent==='Split view').click();view.get('workspaceHelpers').children[1].children.find(b=>b.getAttribute('aria-label')==='Project'+' view').click();resolve({ok:true,result:{files:['board.kicad_pcb']}});await tick();assert.equal(view.get('pairDrawing').children.length,0);assert.equal(view.get('comparison').hidden,true);
});
test('GitHub branch is resolved once before main, companion and project reads',async()=>{
 const sha='d'.repeat(40),view=viewer({repository:'wayri/board',head:'main',file:'board.kicad_pcb',pairedFile:'root.kicad_sch'},message=>({ok:true,result:message.type==='revision-resolve'?{sha}:{files:[]}}));assert.equal(view.get('headDrawing').children.length,0);await tick();assert.equal(view.calls.filter(m=>m.type==='revision-resolve').length,1);
 for(const id of ['headDrawing','pairDrawing'])assert.equal(new URL(view.get(id).children[0].src).searchParams.get('ref'),sha);view.get('workspaceHelpers').children[1].children.find(b=>b.getAttribute('aria-label')==='Project'+' view').click();assert.equal(new URL(view.get('projectWorkspace').children[0].src).searchParams.get('ref'),sha);
});


test('outer viewer Stop cancels moving-ref resolution and ignores its late result; Retry uses a fresh scope',async()=>{
 const pending=[];let ready=false;
 const view=viewer({repository:'wayri/board',head:'main',file:'board.kicad_pcb'},message=>message.type==='load-cancel'?{ok:true,result:{cancelled:true}}:ready?{ok:true,result:{sha:'d'.repeat(40)}}:new Promise(resolve=>pending.push(resolve)));
 await tick();const first=view.calls[0];assert.equal(first.type,'revision-resolve');assert.match(first.loadId,/^[a-f0-9]{32}$/);
 view.get('outerLoadStop-start').click();await tick();assert.equal(view.calls.at(-1).type,'load-cancel');assert.equal(view.calls.at(-1).loadId,first.loadId);assert.match(view.get('status').textContent,/stopped/);
 pending[0]({ok:true,result:{sha:'e'.repeat(40)}});await tick();assert.equal(view.get('headDrawing').children.length,0);
 ready=true;view.get('outerLoadRetry-start').click();await tick();assert.equal(view.get('headDrawing').children.length,1);assert.ok(view.get('headDrawing').children[0].src.includes('ref='+'d'.repeat(40)));assert.notEqual(view.calls.at(-1).loadId,first.loadId);
});
test('outer viewer inventory Stop prevents late navigation and Retry repeats requested workspace',async()=>{
 const pending=[];let ready=false;const view=viewer({...parameters,base:''},message=>message.type==='load-cancel'?{ok:true}:ready?{ok:true,result:{files:[{path:'board.kicad_pcb'}]}}:new Promise(resolve=>pending.push(resolve)));
 view.get('workspaceTabs').children.find(n=>n.getAttribute('aria-label')==='Layout'+' view').click();await tick();assert.equal(view.calls[0].type,'project-inventory');
 view.get('outerLoadStop-inventory').click();await tick();pending[0]({ok:true,result:{files:[{path:'stale.kicad_pcb'}]}});await tick();assert.equal(view.get('pairDrawing').children.length,0);
 ready=true;view.get('outerLoadRetry-inventory').click();await tick();assert.equal(view.get('pairDrawing').children.length,1);assert.ok(view.get('pairDrawing').children[0].src.includes('file=board.kicad_pcb'));
});
test('outer comparison Stop cancels both scopes, ignores late results and can retry',async()=>{
 const pending=[];let ready=false;const view=viewer(parameters,message=>message.type==='load-cancel'?{ok:true}:ready?{ok:true,result:[{path:message.file,content:sch('1k')}]}:new Promise(resolve=>pending.push(resolve)));
 view.click('Changes');await tick();const reads=view.calls.filter(m=>m.type==='project');assert.equal(reads.length,2);assert.notEqual(reads[0].loadId,reads[1].loadId);
 view.get('outerLoadStop-changes').click();await tick();assert.equal(view.calls.filter(m=>m.type==='load-cancel').length,2);
 for(const resolve of pending)resolve({ok:true,result:[]});await tick();assert.match(view.get('changeCount').textContent,/stopped/);assert.equal(view.get('changeList').children.length,0);
 ready=true;view.get('outerLoadRetry-changes').click();await tick();assert.match(view.get('changeCount').textContent,/0 added/);
});
test('outer request deadline and page exit cancel pending work without requiring a backend reply',async()=>{
 for(const exit of [false,true]){
  const view=viewer({repository:'wayri/board',head:'main',file:'board.kicad_pcb'},()=>new Promise(()=>{}));await tick();if(exit)view.pagehide();else view.expire();await tick();
  assert.equal(view.calls.filter(m=>m.type==='load-cancel').length,1);assert.equal(view.get('headDrawing').children.length,0);assert.match(view.get('status').textContent,exit?/stopped/:/2 minutes/);
 }
});

 test('compact view tabs wait for trusted ready before switching 3D and expose saved analysis and Draftsman',async()=>{
 const view=viewer({...parameters,base:'',file:'board.kicad_pcb'},()=>({ok:true,result:{files:[]}}));
 const tab=name=>[...view.get('workspaceTabs').children,...view.get('workspaceHelpers').children[1].children].find(button=>button.getAttribute('aria-label')===name+' view');
 const frame=view.get('headDrawing').children[0];tab('3D').click();await tick();assert.equal(frame.messages.length,0);
 view.message({origin:'chrome-extension://test-id',source:frame.contentWindow,data:{type:'kicad-review:view',phase:'ready',file:'board.kicad_pcb',view:{x:0,y:0,zoom:1}}});
 assert.ok(frame.messages.some(({message})=>message.command==='workspace-view'&&message.mode==='3d'));
 tab('Layout').click();await tick();assert.equal(frame.messages.at(-1).message.mode,'layout');
 tab('Draftsman').click();await tick();assert.equal(frame.messages.at(-1).message.mode,'draftsman');
 tab('Simulation').click();await tick();assert.equal(frame.messages.at(-1).message.mode,'simulation');
 });


test('embedded drawing Project tab returns to the owning shell without nesting a second project viewer',async()=>{
 const view=viewer({...parameters,base:'',projectShell:'1'},()=>({ok:false,error:'unexpected read'}));
 const drawing=view.get('headDrawing').children[0];
 view.get('workspaceHelpers').children[1].children.find(button=>button.getAttribute('aria-label')==='Project view').click();await tick();
 assert.equal(view.parentMessages.at(-1).message.type,'kicad-review:show-project-settings');
 assert.equal(view.get('projectWorkspace').children.length,0);
 assert.equal(view.get('headDrawing').children[0],drawing);
 assert.equal(view.calls.length,0);
});


test('global search keeps saved results inside the workspace and focuses only owned drawing frames',async()=>{
 let search;const view=viewer({...parameters,base:''},()=>({ok:false,error:'unexpected read'}),{KiCadWorkspaceSearch:{mount:options=>{search=options;return{input:{focus(){},select(){}},destroy(){}};}}});
 assert.equal(search.scope.ref,parameters.head);const frame=view.get('headDrawing').children[0];
 await search.open({kind:'object',path:parameters.file,uuid:'saved-symbol',position:{x:10,y:20}});
 assert.equal(frame.messages.length,0,'wait for the source frame to be ready');
 view.message({origin:'chrome-extension://test-id',source:frame.contentWindow,data:{type:'kicad-review:view',phase:'ready',file:parameters.file,view:{x:0,y:0,zoom:1}}});
 assert.equal(frame.messages.at(-1).message.command,'search-result');assert.equal(frame.messages.at(-1).message.result.uuid,'saved-symbol');
 await search.open({kind:'report',path:'results/transient.csv',label:'Transient'});
 assert.equal(view.get('comparison').hidden,true);const report=view.get('searchWorkspace').children[0];assert.equal(new URL(report.src).pathname,'/analysis-viewer.html');assert.equal(new URL(report.src).searchParams.get('ref'),parameters.head);
 await assert.rejects(search.open({kind:'report',path:'../private.csv'}),/Invalid search/);
});


test('detached cross-select state also controls paired relay and clears pending selection',()=>{
 const view=viewer({repository:'wayri/board',file:'board.kicad_pcb',head:'a'.repeat(40),pairedFile:'root.kicad_sch'},()=>({ok:true,result:[]}),{CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent(){}});
 const main=view.get('headDrawing').children[0],pair=view.get('pairDrawing').children[0],origin='chrome-extension://test-id';
 const selection={kind:'part',reference:'R1',path:'board.kicad_pcb'};
 view.message({origin,source:main.contentWindow,data:{type:'kicad-review:selection',selection}});
 view.message({origin,source:main.contentWindow,data:{type:'kicad-review:detach-state',enabled:false}});
 assert.equal(view.get('crossSelectToggle').getAttribute('aria-pressed'),'false');
 view.message({origin,source:pair.contentWindow,data:{type:'kicad-review:view',phase:'ready',file:'root.kicad_sch',view:{x:0,y:0,zoom:1}}});
 assert.equal(pair.messages.length,0);
 view.message({origin,source:main.contentWindow,data:{type:'kicad-review:selection',selection}});assert.equal(pair.messages.length,0);
 view.get('crossSelectToggle').click();assert.equal(view.get('crossSelectToggle').getAttribute('aria-pressed'),'true');assert.equal(pair.messages.at(-1).message.command,'detach-sync');
 view.message({origin,source:main.contentWindow,data:{type:'kicad-review:selection',selection}});assert.equal(pair.messages.at(-1).message.command,'highlight-related');
});

test('empty or failed companion chooser always closes and ignores late lookup',async()=>{
 let finish;const view=viewer({...parameters,base:''},()=>new Promise(done=>finish=done));
 view.get('splitView').click();assert.equal(view.get('pairChooser').hidden,false);
 view.get('closePairChooser').click();assert.equal(view.get('pairChooser').hidden,true);
 finish({ok:true,result:{files:['board.kicad_pcb']}});await tick();assert.equal(view.get('pairDrawing').children.length,0);assert.equal(view.get('pairChooser').hidden,true);
 view.get('pairChooser').hidden=false;view.dispatch('keydown',{key:'Escape'});assert.equal(view.get('pairChooser').hidden,true);
 view.get('pairChooser').hidden=false;view.dispatch('pointerdown',{target:{},composedPath:()=>[]});assert.equal(view.get('pairChooser').hidden,true);
 view.get('pairChooser').hidden=false;view.dispatch('pointerdown',{target:view.get('companionPath'),composedPath:()=>[view.get('companionPath'),view.get('pairChooser')]});assert.equal(view.get('pairChooser').hidden,false);
});
test('failed mutable revision opens a single error pane rather than stale Base and Head loaders',async()=>{
 const view=viewer({repository:'wayri/board',head:'main',file:'board.kicad_pcb'},()=>({ok:false,error:'Website session unavailable.'}));
 assert.equal(view.get('basePanel').hidden,true);assert.equal(view.get('comparison').dataset.blob,'true');
 await tick();assert.equal(view.get('basePanel').hidden,true);assert.match(view.get('headDrawing').textContent,/could not be loaded/);assert.match(view.get('status').textContent,/Website session unavailable/);assert.doesNotMatch(view.get('headDrawing').textContent,/Loading/);
});

test('History is a top-level workspace tab and returning preserves the existing drawing frame',async()=>{
 let picker;
 const view=viewer({...parameters,base:''},()=>({ok:false,error:'No drawing lookup expected'}),{KiCadRevisionPicker:{mount(options){picker=options;return{openGraph(){options.onOpenGraph();return Promise.resolve();}};}}});
 const tab=name=>[...view.get('workspaceTabs').children,...view.get('workspaceHelpers').children[1].children].find(b=>b.getAttribute('aria-label')===name+' view');
 const frame=view.get('headDrawing').children[0];
 tab('History').click();await tick();
 assert.equal(picker.workspaceHolder,view.get('historyWorkspace'));
 assert.equal(view.get('historyWorkspace').hidden,false);
 assert.equal(view.get('comparison').hidden,true);
 assert.equal(tab('History').getAttribute('aria-pressed'),'true');
 assert.equal(view.calls.length,0);
 tab('Schematic').click();await tick();
 assert.equal(view.get('historyWorkspace').hidden,true);
 assert.equal(view.get('headDrawing').children[0],frame);
 tab('History').click();await tick();picker.onCloseGraph();
 assert.equal(view.get('historyWorkspace').hidden,true);
 assert.equal(tab('Schematic').getAttribute('aria-pressed'),'true');
});

test('BoM top tab uses head inventory and preserves the loaded drawing',async()=>{let options,shows=0;const view=viewer({...parameters,base:''},message=>message.type==='project-inventory'?{ok:true,result:{files:[{path:'BoM.csv'}]}}:{ok:true,result:[]},{KiCadBomBrowser:{mount(value){options=value;return {show:async()=>{shows++;await value.inventory();}};}}});const drawing=view.get('headDrawing').children[0];const tab=view.get('workspaceTabs').children.find(n=>n.attributes['aria-label']==='BoM view');assert(tab);tab.click();await tick();assert.equal(view.get('comparison').hidden,true);assert.equal(view.get('bomWorkspace').hidden,false);assert.equal(options.scope.repository,'fork/board');assert.equal(options.scope.ref,parameters.head);assert.equal(view.calls.find(x=>x.type==='project-inventory').repository,'fork/board');assert.equal(view.get('headDrawing').children[0],drawing);view.get('workspaceTabs').children.find(n=>n.attributes['aria-label']==='Schematic view').click();await tick();assert.equal(view.get('bomWorkspace').hidden,true);assert.equal(view.get('headDrawing').children[0],drawing);});

test('one split button opens and closes a paired drawing without a second Unsplit control',async()=>{
 const view=viewer({...parameters,base:''},message=>message.type==='drawing-files'?{ok:true,result:{files:['board.kicad_pcb']}}:{ok:true,result:[]});
 const split=view.get('splitView');split.click();await tick();assert.equal(split.textContent,'Unsplit');assert.equal(split.getAttribute('aria-pressed'),'true');assert.equal(view.get('pairPanel').hidden,false);
 assert.equal(view.get('projectTools').children.filter(n=>n.textContent==='Unsplit').length,1);split.click();await tick();assert.equal(split.textContent,'Split view');assert.equal(split.getAttribute('aria-pressed'),'false');assert.equal(view.get('pairPanel').hidden,true);assert.equal(view.get('pairDrawing').children.length,0);
});
test('BoM loads exact saved project parts and keeps companion frame selection synchronized',async()=>{
 let options,lastSelection;const view=viewer({...parameters,base:''},message=>message.type==='project-inventory'?{ok:true,result:{files:[{path:'new.kicad_sch'},{path:'new.kicad_pcb'}]}}:message.type==='project'?{ok:true,result:[{path:'new.kicad_sch',content:sch('4k7')}]}:{ok:true,result:[]},{KiCadDesignModel:require('../design-model.js'),KiCadBomBrowser:{mount(value){options=value;return {show:async()=>{},select(value){lastSelection=value;}};}}});
 view.get('workspaceTabs').children.find(n=>n.attributes['aria-label']==='BoM view').click();await tick();const model=await options.loadDrawing();assert.equal(model.objects.find(o=>o.reference==='R1').properties.Value,'4k7');assert.equal(view.calls.find(m=>m.type==='project').repository,'fork/board');assert.equal(view.calls.find(m=>m.type==='project').ref,parameters.head);
 const companion=await options.companion('3d'),query=new URL(companion.url).searchParams;assert.equal(query.get('file'),'new.kicad_pcb');assert.equal(query.get('ref'),parameters.head);assert.equal(query.get('bomCompanion'),'1');assert.equal(query.get('headerViews'),'1');assert.equal(query.get('headerSearch'),'1');const frame=view.get('bomDrawing');options.onFrame(frame);
 const selection={kind:'part',reference:'R1',uuid:'one',path:'new.kicad_pcb'};view.message({source:frame.contentWindow,origin:'chrome-extension://test-id',data:{type:'kicad-review:selection',selection}});assert.equal(lastSelection,selection);assert.equal(view.get('headDrawing').children[0].messages.at(-1).message.selection,selection);
});
test('only scoped native drawing variant events update BoM and new companions receive the selected variant',async()=>{
 let options,updated;const view=viewer({...parameters,base:''},message=>message.type==='project'?{ok:true,result:[{path:'new.kicad_sch',content:sch('4k7')}]}:{ok:true,result:{files:[{path:'new.kicad_sch'},{path:'new.kicad_pcb'}]}},{KiCadDesignModel:require('../design-model.js'),KiCadBomBrowser:{mount(value){options=value;return{show:async()=>{},refreshDrawing(value){updated=value;}};}}});
 view.get('workspaceTabs').children.find(n=>n.attributes['aria-label']==='BoM view').click();await tick();const frame=view.get('headDrawing').children[0],config={schemaVersion:1,variants:[{id:'prototype',name:'Prototype',parts:[{path:'new.kicad_sch',reference:'R1',populated:false,properties:{Value:'2k2'}}]}]},message={type:'kicad-review:assembly-variant',repository:'fork/board',ref:parameters.head,file:'new.kicad_sch',rootFile:'new.kicad_sch',variant:'prototype',config};
 for(const event of [{source:{}},{origin:'https://github.com'},{data:{...message,ref:parameters.base}},{data:{...message,file:'unrelated.kicad_sch'}},{data:{...message,variant:'missing'}}]){view.message({source:frame.contentWindow,origin:'chrome-extension://test-id',data:message,...event});await tick();assert.equal(updated,undefined);}
 view.message({source:frame.contentWindow,origin:'chrome-extension://test-id',data:message});await tick();await tick();assert.equal(updated.variant,'prototype');assert.equal(updated.objects.find(o=>o.reference==='R1').populated,false);assert.equal(updated.objects.find(o=>o.reference==='R1').properties.Value,'2k2');
 const companion=await options.companion('3d'),paired=view.get('bomDrawing');paired.src=companion.url;options.onFrame(paired);view.message({source:paired.contentWindow,origin:'chrome-extension://test-id',data:{type:'kicad-review:view',phase:'ready',file:'new.kicad_pcb',view:{x:0,y:0,zoom:1},ref:parameters.head}});assert.equal(paired.messages.find(m=>m.message.command==='assembly-variant').message.variant,'prototype');
});
test('native BoM resolves variables after the active variant overlay using the saved file context',async()=>{
 let options,updated;const source={path:'new.kicad_sch',content:sch('${MPN}'),textVariables:{MPN:'OPA197',ALT_MPN:'TLV9004'}},view=viewer({...parameters,base:''},message=>message.type==='project'?{ok:true,result:[source]}:{ok:true,result:{files:[{path:source.path}]}},{KiCadDesignModel:require('../design-model.js'),KiCadBomBrowser:{resolveDrawing:require('../bom-browser.js').resolveDrawing,mount(value){options=value;return{show:async()=>{},refreshDrawing(value){updated=value;}};}}});view.get('workspaceTabs').children.find(n=>n.attributes['aria-label']==='BoM view').click();await tick();const initial=await options.loadDrawing();assert.equal(initial.objects.find(o=>o.reference==='R1').properties.Value,'OPA197');
 const frame=view.get('headDrawing').children[0],config={schemaVersion:1,variants:[{id:'alternate',name:'Alternate',parts:[{path:source.path,reference:'R1',properties:{Value:'${ALT_MPN}'}}]}]};view.message({source:frame.contentWindow,origin:'chrome-extension://test-id',data:{type:'kicad-review:assembly-variant',repository:'fork/board',ref:parameters.head,file:source.path,rootFile:source.path,variant:'alternate',config}});await tick();await tick();const part=updated.objects.find(o=>o.reference==='R1');assert.equal(part.properties.Value,'TLV9004');assert.equal(part.variableProvenance.Value.raw,'${ALT_MPN}');assert.equal(part.variableProvenance.Value.variables[0].source,'Project');
});


test('workspace theme adopts the ready primary preference and rejects unscoped pane changes',async()=>{
 const view=viewer({...parameters,base:''},()=>({ok:true,result:[]})),frame=view.get('headDrawing').children[0];
 const send=data=>view.message({source:frame.contentWindow,origin:'chrome-extension://test-id',data});
 send({type:'kicad-review:view',phase:'ready',file:parameters.file,ref:parameters.head,view:{x:0,y:0,zoom:1},uiTheme:'light',drawingTheme:'light'});
 const button=view.get('workspaceTheme');assert.equal(button.getAttribute('aria-pressed'),'false');button.click();assert.equal(frame.messages.at(-1).message.drawingTheme,'dark');
 const theme={type:'kicad-review:theme',repository:parameters.headRepository,ref:parameters.head,file:parameters.file,uiTheme:'light',drawingTheme:'dark'},before=frame.messages.length;
 for(const data of [{...theme,repository:'other/repo'},{...theme,file:'wrong.kicad_sch'},{...theme,ref:parameters.base},{...theme,uiTheme:'bad'}])send(data);
 assert.equal(frame.messages.length,before);send(theme);assert.equal(frame.messages.at(-1).message.uiTheme,'light');const count=frame.messages.length;send(theme);assert.equal(frame.messages.length,count);
});


test('new project panes inherit the workspace theme and their toggle updates the drawing',async()=>{
 const view=viewer({...parameters,base:''},()=>({ok:true,result:[]})),head=view.get('headDrawing').children[0];view.get('workspaceTheme').click();
 view.get('workspaceHelpers').children[1].children.find(n=>n.getAttribute('aria-label')==='Project view').click();const project=view.get('projectWorkspace').children[0];project.listeners.load();assert.equal(project.messages.at(-1).message.uiTheme,'light');
 view.message({source:project.contentWindow,origin:'chrome-extension://test-id',data:{type:'kicad-review:theme',repository:parameters.headRepository,ref:parameters.head,file:parameters.file,uiTheme:'dark',drawingTheme:'dark'}});assert.equal(head.messages.at(-1).message.drawingTheme,'dark');assert.equal(view.get('workspaceTheme').getAttribute('aria-pressed'),'true');
});


test('only the primary drawing relays explicit workspace theme changes to detached views',async()=>{
 const view=viewer({...parameters,base:'',pairedFile:'new.kicad_pcb'},()=>({ok:true,result:[]}));
 const head=view.get('headDrawing').children[0],pair=view.get('pairDrawing').children[0];
 const ready=(frame,file,theme)=>view.message({source:frame.contentWindow,origin:'chrome-extension://test-id',data:{type:'kicad-review:view',phase:'ready',file,ref:parameters.head,view:{x:0,y:0,zoom:1},uiTheme:theme,drawingTheme:theme}});
 ready(head,parameters.file,'light');ready(pair,'new.kicad_pcb','dark');
 assert.equal(pair.messages.findLast(m=>m.message.command==='set-theme').message.drawingTheme,'light');
 for(const frame of [head,pair])assert.notEqual(frame.messages.findLast(m=>m.message.command==='set-theme').message.syncDetached,true,'readiness does not rebroadcast');
 view.get('workspaceTheme').click();
 assert.equal(head.messages.at(-1).message.syncDetached,true);assert.equal(pair.messages.at(-1).message.syncDetached,false);
 assert.equal(head.messages.at(-1).message.drawingTheme,'dark');assert.equal(pair.messages.at(-1).message.drawingTheme,'dark');
});
