const test=require('node:test'),assert=require('node:assert/strict');
const {comparisonQuery,mount,panelBounds}=require('../revision-picker.js');
const sha=c=>c.repeat(40),request={repository:'owner/design',headRepository:'fork/design',file:'board.kicad_pcb',oldFile:'old board.kicad_pcb',head:'feature/board'};
test('comparison keeps fork/base identities, encoded paths and immutable revisions',()=>{
 const params=comparisonQuery(request,sha('a'),sha('b'));assert.equal(params.get('repository'),'owner/design');assert.equal(params.get('headRepository'),'fork/design');assert.equal(params.get('oldFile'),'old board.kicad_pcb');assert.equal(params.get('base'),sha('a'));assert.equal(params.get('head'),sha('b'));assert.equal(params.get('status'),'renamed');
 const single=comparisonQuery(request,null,sha('b'));assert.equal(single.get('repository'),'fork/design');assert.equal(single.get('oldFile'),'board.kicad_pcb');assert.equal(single.has('base'),false);
 for(const [r,b,h] of [[request,'main',sha('b')],[request,sha('a'),'moving-branch'],[{...request,file:'../bad.kicad_pcb'},sha('a'),sha('b')],[{...request,repository:'../owner'},sha('a'),sha('b')],[{...request,pullNumber:9},sha('a'),sha('b')]])assert.throws(()=>comparisonQuery(r,b,h));
});
function harness(send,extra={}){
 const nodes=[],events={};const doc={defaultView:{innerWidth:1000,innerHeight:700},addEventListener(type,fn){events[type]=fn;},removeEventListener(type){delete events[type];},createElement(tag){const node={tag,ownerDocument:doc,style:{},dataset:{},children:[],listeners:{},value:'',textContent:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(key,value){this[key]=value;},addEventListener(key,fn){this.listeners[key]=fn;},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},get firstChild(){return this.children[0];}};nodes.push(node);return node;}};
 doc.body=doc.createElement('body');const holder=doc.createElement('div'),navigated=[];const picker=mount({holder,request,send,...extra,navigate:p=>navigated.push(p)});return {nodes,holder,navigated,picker,events};
}
test('picker resolves each immutable source in its own repository before navigation',async()=>{
 const calls=[],h=harness(async message=>{calls.push(message);return {ok:true,result:{repository:message.repository,sha:message.repository==='owner/design'?sha('a'):sha('b')}};});
 h.nodes.find(n=>n['aria-label']==='base branch, tag or commit').value='stable';await h.picker.openComparison(true);
 assert.deepEqual(calls.map(c=>[c.repository,c.file,c.ref]),[['owner/design','old board.kicad_pcb','stable'],['fork/design','board.kicad_pcb','feature/board']]);assert.equal(h.navigated[0].get('base'),sha('a'));assert.equal(h.navigated[0].get('head'),sha('b'));
});
test('picker refuses response repository substitution and disposed late navigation',async()=>{
 const wrong=harness(async()=>({ok:true,result:{repository:'attacker/design',sha:sha('a')}}));await wrong.picker.openComparison(false);assert.equal(wrong.navigated.length,0);assert.ok(wrong.nodes.some(n=>n.textContent.includes('does not match')));
 let release;const late=harness(()=>new Promise(resolve=>{release=resolve;}));const work=late.picker.openComparison(false);late.picker.dispose();release({ok:true,result:{repository:'fork/design',sha:sha('b')}});await work;assert.equal(late.navigated.length,0);
});
test('bounded listings expose commit and branch options without trusting markup',async()=>{
 const h=harness(async m=>({ok:true,result:m.type==='revision-branches'?{repository:m.repository,branches:[{name:'<main>',sha:sha('a')}],warnings:['More branches omitted']}:{repository:m.repository,file:m.file,snapshotRef:sha('b'),commits:[{sha:sha('b'),message:'<script>alert(1)</script>',date:'2026-10-04'},{sha:sha('a'),message:'Previous'}],warnings:[]}}));
 await h.picker.populate();assert.ok(h.nodes.some(n=>n.tag==='option'&&n.textContent.includes('<script>')));assert.ok(h.nodes.some(n=>n.textContent.includes('More branches omitted')));assert.equal(h.nodes.find(n=>n['aria-label']==='base branch, tag or commit').value,sha('a'));
});

test('GitLab comparison preserves provider and nested namespaces',()=>{
 const query=comparisonQuery({...request,provider:'gitlab',repository:'group/sub/design',headRepository:'group/sub/design'},sha('a'),sha('b'));
 assert.equal(query.get('provider'),'gitlab');assert.equal(query.get('repository'),'group/sub/design');
 assert.throws(()=>comparisonQuery({...request,repository:'group/sub/design'},sha('a'),sha('b')));
});


test('history renders commit actions and loads exact immutable commit',async()=>{
 const calls=[],h=harness(async m=>{calls.push(m);return {ok:true,result:{repository:m.repository,file:m.file,snapshotRef:sha('d'),commits:[{sha:sha('c'),message:'Change regulator\nDetails',author:'Engineer',date:'2026-10-30'}],warnings:['Initial website window']}};});
 await h.picker.loadHistory();assert.equal(calls[0].type,'revision-commits');assert.ok(h.nodes.some(n=>n.tag==='strong'&&n.textContent==='Change regulator'));assert.ok(h.nodes.some(n=>n.textContent==='Load commit'));assert.ok(h.nodes.some(n=>n.textContent==='Compare with current'));
 await h.picker.openCommit(sha('c'));assert.equal(h.navigated[0].get('head'),sha('c'));assert.equal(h.navigated[0].has('base'),false);
});
test('compare from history preserves the displayed pinned revision despite a moving branch',async()=>{
 const calls=[],h=harness(async m=>{calls.push(m);return {ok:true,result:{repository:m.repository,sha:sha('e')}};},{getCurrentRef:()=>sha('d')});
 await h.picker.openCommit(sha('c'),true);assert.equal(calls.length,0);assert.equal(h.navigated[0].get('base'),sha('c'));assert.equal(h.navigated[0].get('head'),sha('d'));assert.equal(h.navigated[0].get('repository'),'fork/design');
});
test('history rejects invalid revisions and late response after disposal',async()=>{
 const bad=harness(async m=>({ok:true,result:{repository:m.repository,commits:[{sha:'moving-branch'}]}}));await bad.picker.loadHistory();assert.ok(bad.nodes.some(n=>n.textContent==='Invalid bounded commit history.'));await bad.picker.openCommit('bad');assert.equal(bad.navigated.length,0);
 let finish;const late=harness(()=>new Promise(resolve=>finish=resolve));const work=late.picker.loadHistory();late.picker.dispose();finish({ok:true,result:{repository:'fork/design',commits:[{sha:sha('c')}]}});await work;assert.equal(late.nodes.find(n=>n['aria-label']==='Commit history').children.length,0);
});

test('history popup stays inside short and narrow viewports and has explicit dismissal',()=>{
 for(const [width,height]of [[1000,700],[320,220]]){const box=panelBounds({right:width-2,bottom:height-10},width,height);assert.ok(box.left>=8);assert.ok(box.top>=8);assert.ok(box.left+box.width<=width-8);assert.ok(box.top+box.maxHeight<=height-8);}
 const h=harness(async()=>({ok:false})),detail=h.nodes.find(n=>n.tag==='details');detail.open=true;
 h.nodes.find(n=>n['aria-label']==='Close history').listeners.click();assert.equal(detail.open,false);
 detail.open=true;h.events.keydown({key:'Escape'});assert.equal(detail.open,false);
 detail.open=true;h.events.pointerdown({target:{},composedPath:()=>[]});assert.equal(detail.open,false);
 detail.open=true;h.events.pointerdown({target:detail,composedPath:()=>[detail]});assert.equal(detail.open,true);
 h.picker.dispose();assert.equal(Object.keys(h.events).length,0);
});

test('main history action opens graph workspace with bound repository data and exact comparison refs',async()=>{
 const previous=globalThis.KiCadHistoryTimeline,updates=[];let graph,closed=false;
 globalThis.KiCadHistoryTimeline={mount(options){graph=options;return{update:value=>updates.push(value),dispose(){closed=true;}};}};
 try{
  const calls=[],pairs=[];
  const h=harness(async m=>{calls.push(m);return{ok:true,result:m.type==='revision-branches'?{repository:m.repository,branches:[{name:'release/board',isDefault:true}],warnings:['Partial website branch window']}:{repository:m.repository,file:m.file,snapshotRef:sha('d'),commits:[{sha:sha('d'),parents:[sha('c')],parentsKnown:true,message:'feat: update regulator'}],warnings:[]}};},{getCurrentRef:()=>sha('d'),navigateComparison:p=>pairs.push(p)});
  await h.picker.openGraph();
  assert.equal(h.nodes.find(n=>n.tag==='dialog').open,true);
  assert.deepEqual(calls.map(c=>c.type).sort(),['revision-branches','revision-commits']);
  assert.ok(calls.every(c=>c.repository==='fork/design'&&c.file==='board.kicad_pcb'));
  assert.equal(updates.at(-1).commits[0].parents[0],sha('c'));
  assert.ok(h.nodes.some(n=>n.tag==='option'&&n.value==='release/board'));
  graph.onCompare(sha('c'),sha('d'));
  assert.equal(pairs[0].get('repository'),'fork/design');
  assert.equal(pairs[0].get('base'),sha('c'));
  assert.equal(pairs[0].get('head'),sha('d'));
  h.picker.dispose();assert.equal(closed,true);graph.onCompare(sha('c'),sha('d'));assert.equal(pairs.length,1);
 }finally{if(previous)globalThis.KiCadHistoryTimeline=previous;else delete globalThis.KiCadHistoryTimeline;}
});
test('graph branch selection resolves its exact name before reading parent history',async()=>{
 const previous=globalThis.KiCadHistoryTimeline;globalThis.KiCadHistoryTimeline={mount(){return{update(){},dispose(){}};}};
 try{
  const calls=[],h=harness(async m=>{calls.push(m);return{ok:true,result:m.type==='revision-branches'?{repository:m.repository,branches:[{name:'hardware/rev-2'}]}:m.type==='revision-resolve'?{repository:m.repository,sha:sha('e')}:{repository:m.repository,file:m.file,snapshotRef:sha('e'),commits:[{sha:sha('e'),parentsKnown:false,message:'Update'}]}};});
  await h.picker.openGraph();calls.length=0;const select=h.nodes.find(n=>n['aria-label']==='History branch');select.value='hardware/rev-2';await select.listeners.change();
  assert.deepEqual(calls.map(c=>[c.type,c.ref]),[['revision-resolve','hardware/rev-2'],['revision-commits',sha('e')]]);
  h.picker.dispose();
 }finally{if(previous)globalThis.KiCadHistoryTimeline=previous;else delete globalThis.KiCadHistoryTimeline;}
});
test('unresolved branch names remain usable in manual comparison lists without invented SHAs',async()=>{
 const h=harness(async m=>({ok:true,result:m.type==='revision-branches'?{repository:m.repository,branches:[{name:'topic/board'}]}:{repository:m.repository,file:m.file,snapshotRef:sha('a'),commits:[{sha:sha('a'),message:'Saved'}]}}));
 await h.picker.populate();assert.ok(h.nodes.some(n=>n.tag==='option'&&n.value==='topic/board'&&n.textContent==='topic/board'));
 h.picker.dispose();
});

test('dedicated History workspace stays inline, hides its old launcher and disposes cleanly',async()=>{
 const previous=globalThis.KiCadHistoryTimeline;globalThis.KiCadHistoryTimeline={mount(){return{update(){},dispose(){}};}};
 try{
  const workspace={children:[],append(node){this.children.push(node);}};let opened=0,closed=0;
  const h=harness(async m=>({ok:true,result:m.type==='revision-branches'?{repository:m.repository,branches:[]}:{repository:m.repository,file:m.file,snapshotRef:sha('d'),commits:[]}}),{workspaceHolder:workspace,getCurrentRef:()=>sha('d'),onOpenGraph:()=>opened++,onCloseGraph:()=>closed++});
  await h.picker.openGraph();
  assert.equal(h.nodes.some(n=>n.tag==='dialog'),false);
  assert.equal(workspace.children[0].tag,'section');assert.equal(workspace.children[0].hidden,false);
  assert.equal(h.nodes.find(n=>n.tag==='details').hidden,true);assert.equal(opened,1);
  h.picker.closeGraph();assert.equal(workspace.children[0].hidden,true);assert.equal(closed,1);
  h.picker.dispose();await h.picker.openGraph();h.picker.closeGraph();assert.equal(opened,1);assert.equal(closed,1);
 }finally{if(previous)globalThis.KiCadHistoryTimeline=previous;else delete globalThis.KiCadHistoryTimeline;}
});
test('manual history branch entry appears only on request and labels the successfully resolved branch',async()=>{
 const previous=globalThis.KiCadHistoryTimeline;globalThis.KiCadHistoryTimeline={mount(){return{update(){},dispose(){}};}};
 try{
  const h=harness(async m=>({ok:true,result:m.type==='revision-branches'?{repository:m.repository,branches:[]}:m.type==='revision-resolve'?{repository:m.repository,sha:sha('e')}:{repository:m.repository,file:m.file,snapshotRef:m.ref,commits:[{sha:m.ref,parentsKnown:false,message:'Saved'}]}}),{getCurrentRef:()=>sha('d')});
  await h.picker.openGraph();const select=h.nodes.find(n=>n['aria-label']==='History branch'),input=h.nodes.find(n=>n['aria-label']==='History branch name or commit');
  assert.equal(input.hidden,true);select.value=':manual';await select.listeners.change();assert.equal(input.hidden,false);
  input.value='hardware/custom';await h.nodes.find(n=>n.textContent==='Browse branch').listeners.click();
  assert.equal(input.hidden,true);assert.equal(select.value,'hardware/custom');assert.ok(select.children.some(n=>n.value==='hardware/custom'));
  h.picker.dispose();
 }finally{if(previous)globalThis.KiCadHistoryTimeline=previous;else delete globalThis.KiCadHistoryTimeline;}
});
