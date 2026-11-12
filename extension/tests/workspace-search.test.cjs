const test=require('node:test'),assert=require('node:assert/strict');
const {buildRecords,searchRecords,createController,mount,scopedDrafts,LIMITS}=require('../workspace-search.js');
const scope={provider:'github',host:'https://github.com',repository:'owner/project',ref:'a'.repeat(40),file:'board.kicad_pcb'};
const board={path:'board.kicad_pcb',content:'(kicad_pcb (footprint "Part:QFN" (at 11 22) (property "Reference" "U1") (property "Value" "CONTROLLER") (uuid "part-1")))'};
const sheet={path:'root.kicad_sch',content:'(kicad_sch (symbol (lib_id "Part:QFN") (at 33 44) (property "Reference" "U1") (property "Value" "CONTROLLER") (uuid "symbol-1")))'};
const search=(input,query)=>searchRecords(buildRecords(input),query);
const pause=()=>new Promise(resolve=>setImmediate(resolve));

test('sheet-browser aliases expose a local reopen command without reading repository files',async()=>{
 const controller=createController({scope,request:()=>assert.fail('A local tool needs no repository read')});
 for(const query of ['sheet browser','Sheet Tree','show sheet tree','sheet navigator','mini-map','> open sheet tree']){const result=await controller.search(query);assert.equal(result.results.length,1);assert.equal(result.results[0].action,'sheet-tree');assert.equal(result.results[0].kind,'command');assert.equal(result.results[0].label,'Show sheet browser');}
 controller.destroy();assert.equal(await controller.search('sheet tree'),null);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('saved schematic/layout objects preserve file identity, location and explicit PCB 3D action',()=>{
 const result=search({files:[board,sheet],inventory:[{path:'mechanical/model.step'},{path:'analysis/run.wbk'}]},'ref:U1');
 assert.equal(result.results.length,2);
 const pcb=result.results.find(r=>r.path===board.path);assert.equal(pcb.uuid,'part-1');assert.equal(pcb.canShow3D,true);assert.deepEqual(pcb.position,{x:11,y:22});
 assert.equal(result.results.find(r=>r.path===sheet.path).canShow3D,undefined);
 assert.equal(search({inventory:[{path:'mechanical/model.step'}]},'model.step').results[0].kind,'file');
});

test('saved project settings, workbook/report text and Draftsman properties are searchable',()=>{
 const input={scope,settings:[{path:'board.kicad_pro',content:'{"net_settings":{"classes":[{"name":"Sensitive"}]}}'}],reports:[
  {path:'simulation/run.wbk',content:'{"traces":["V(SENSE)"]}'},
  {path:'simulation/run.csv',content:'time,measurement\n0,distinctive-measurement'},
  {path:'docs/board.draftsman.json',content:'{"schema":"draftsman","title":"Assembly instructions"}'}]};
 for(const query of ['Sensitive','"V(SENSE)"','distinctive-measurement','"Assembly instructions"'])assert.equal(search(input,query).results[0].kind,'report',query);
 assert.equal(search(input,'"Assembly instructions"').results[0].view,'draftsman');
 const drafts=[{source:scope,document:{title:'Local assembly'},label:'Assembly draft'},{source:{...scope,repository:'unrelated/project'},document:{title:'UNRELATED'}}];
 const local=search({scope,drafts},'"Local assembly"');assert.equal(local.results[0].kind,'draft');assert.deepEqual(local.results[0].document,{title:'Local assembly'});
 assert.equal(search({scope,drafts},'UNRELATED').results.length,0);assert.equal(search({scope,drafts},'owner/project').results.length,0,'Envelope source is not searchable content');
 for(const changed of [{ref:'b'.repeat(40)},{host:'https://enterprise.example'},{provider:'gitlab'}])assert.equal(search({scope:{...scope,...changed},drafts},'"Local assembly"').results.length,0);
});

test('valid repository Draftsman JSON promotes to a document result with its source drawing',()=>{
 const model=require('../draftsman-model.js'),source={provider:'github',repository:scope.repository,ref:scope.ref,hashes:{'board.kicad_pcb':'0'.repeat(64)}};
 const document=model.create(source,'Assembly document');
 const input={scope,reports:[{path:'docs/assembly.draftsman.json',content:JSON.stringify(document)}]};
 const result=search(input,'"Assembly document"').results[0];assert.equal(result.kind,'draft');assert.equal(result.view,'draftsman');assert.equal(result.path,'docs/assembly.draftsman.json');assert.equal(result.sourceFile,'board.kicad_pcb');assert.equal(result.document.title,'Assembly document');
 assert.equal(search(input,scope.repository).results.length,0);
 const foreign=search({...input,scope:{...scope,ref:'b'.repeat(40)}},'"Assembly document"');assert.equal(foreign.results[0].kind,'report');assert.match(foreign.warnings.join(' '),/another source revision/);
 const invalid=search({scope,reports:[{path:'docs/invalid.draftsman.json',content:JSON.stringify({...document,pages:'bad'})}]},'"Assembly document"');assert.equal(invalid.results[0].kind,'report');
});

test('saved PCB numeric net codes resolve to names and schematic labels support net queries',()=>{
 const pcb={path:'nets.kicad_pcb',content:'(kicad_pcb (net 1 "SUPPLY") (segment (start 1 2) (end 3 4) (net 1) (uuid "segment-net")))'};
 const schematic={path:'nets.kicad_sch',content:'(kicad_sch (label "SENSE" (at 4 5) (uuid "sense-label")))'};
 const index=buildRecords({files:[pcb,schematic]});const result=searchRecords(index,'net:SUPPLY').results[0];assert.equal(result.uuid,'segment-net');assert.equal(result.netName,'SUPPLY');assert.equal(searchRecords(index,'net:SENSE').results[0].uuid,'sense-label');
});

test('bounds reject oversized drawing/report content, retain file names and disclose omissions',()=>{
 let parsed=0;const model={buildProject(files){parsed++;assert.equal(files.length,128);return{objects:[],warnings:[]};}};
 const many=Array.from({length:129},(_,i)=>({path:i+'.kicad_sch',content:'(kicad_sch)'}));
 const index=buildRecords({files:many,totalDrawings:129},{model});assert.equal(parsed,1);assert.match(index.warnings.join(' '),/128 of 129/);
 const large=buildRecords({files:[{path:'huge.kicad_pcb',content:'x'.repeat(LIMITS.drawingBytes+1)}],inventory:[{path:'huge.kicad_pcb'}],reports:[{path:'run.csv',content:'x'.repeat(LIMITS.reportBytes+1)}]});
 assert.equal(large.drawings,0);assert.equal(searchRecords(large,'huge.kicad_pcb').results[0].kind,'file');assert.match(large.warnings.join(' '),/8 MiB/);assert.match(large.warnings.join(' '),/1 MiB/);
 const binary=buildRecords({reports:[{path:'run.raw',content:'binary\0sensitive'}]});assert.equal(searchRecords(binary,'sensitive').results.length,0);assert.match(binary.warnings.join(' '),/binary output/);
});

test('search language stays bounded, returns malformed-query errors and never executes user patterns',()=>{
 const index=buildRecords({files:[board]});assert.equal(searchRecords(index,'ref:glob:U?').results[0].reference,'U1');
 assert.ok(searchRecords(index,'regex:"(a+)+$"').error);assert.ok(searchRecords(index,'x'.repeat(2049)).error);
});

test('a malformed drawing and duplicate entry do not hide valid design objects',()=>{
 const index=buildRecords({files:[board,board,{path:'broken.kicad_sch',content:'(kicad_sch (symbol'}]});
 assert.equal(searchRecords(index,'ref:U1').results[0].uuid,'part-1');assert.match(index.warnings.join(' '),/duplicate/);assert.match(index.warnings.join(' '),/broken.kicad_sch/);
});

test('local draft storage reads only exact scoped keys, validates documents and caps enumeration',()=>{
 const model=require('../draftsman-model.js'),doc=model.create({provider:'github',repository:scope.repository,ref:scope.ref},'Fixture assembly');
 const key=(overrides={})=>'kivi:draftsman:'+JSON.stringify(['github','',scope.repository,scope.ref,scope.file,'1'.repeat(64)].map((v,i)=>overrides[i]??v));
 const values=new Map([[key({2:'other/repo'}),JSON.stringify(doc)],[key(),JSON.stringify(doc)],[key({5:'2'.repeat(64)}),JSON.stringify({...doc,source:{...doc.source,ref:'b'.repeat(40)}})],['unrelated-storage','private']]);
 const read=[];const storage={length:values.size,key:i=>[...values.keys()][i],getItem:k=>{read.push(k);return values.get(k);}};
 const drafts=scopedDrafts(storage,scope);assert.equal(drafts.length,1);assert.equal(drafts[0].label,'Fixture assembly');assert.equal(read.length,2);assert.ok(!read.includes(key({2:'other/repo'})));
 const result=search({scope,drafts},'"Fixture assembly"');assert.equal(result.results[0].kind,'draft');assert.equal(search({scope,drafts},scope.repository).results.length,0,'Document provenance stays out of content index');
 let enumerated=0;assert.deepEqual(scopedDrafts({length:100000,key(){enumerated++;return'unrelated';}},scope),[]);assert.equal(enumerated,256);
});

test('Draftsman validation resolves dynamically when its browser script loads after search',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),draftsman=require('../draftsman-model.js');
 const context={TextEncoder,KiCadProjectSearch:require('../project-search.js'),KiCadDesignModel:require('../design-model.js'),KiCadDesignDiff:require('../design-diff.js')};
 vm.runInNewContext(fs.readFileSync(require.resolve('../workspace-search.js'),'utf8'),context);
 const document=draftsman.create({provider:'github',repository:scope.repository,ref:scope.ref},'Late module draft');
 const key='kivi:draftsman:'+JSON.stringify(['github','',scope.repository,scope.ref,scope.file,'1'.repeat(64)]);
 const storage={length:1,key:()=>key,getItem:()=>JSON.stringify(document)};
 assert.equal(context.KiCadWorkspaceSearch.scopedDrafts(storage,scope).length,0);context.KiCadDraftsmanModel=draftsman;
 assert.equal(context.KiCadWorkspaceSearch.scopedDrafts(storage,scope)[0].document.title,'Late module draft');
 const index=context.KiCadWorkspaceSearch.buildRecords({scope,reports:[{path:'docs/late.draftsman.json',content:JSON.stringify(document)}]});assert.equal(context.KiCadWorkspaceSearch.searchRecords(index,'"Late module draft"').results[0].kind,'draft');
});

test('controller is lazy, shares one source load per scope and pins eligible report reads to the saved snapshot',async()=>{
 const calls=[],gate=deferred(),cache=new Map();
 const request=async(type,extra)=>{calls.push([type,extra]);if(type==='project-search-files'){await gate.promise;return{files:[board],snapshotRef:'b'.repeat(40)};}if(type==='project-inventory')return{files:[{path:'simulation/out.csv',size:20},{path:'unrelated.json'},{path:'unsafe.html'},{path:'../bad.csv'},{path:'large.csv',size:LIMITS.reportBytes+1}]};return{path:extra.file,content:'voltage,123'};};
 const first=createController({scope:{...scope,ref:'main'},request,cache}),second=createController({scope:{...scope,ref:'main',file:'root.kicad_sch'},request,cache});assert.equal(calls.length,0);
 const one=first.search('U1'),two=second.search('voltage');assert.equal(calls.length,1);gate.resolve();
 assert.equal((await one).results[0].uuid,'part-1');assert.equal((await two).results[0].path,'simulation/out.csv');
 assert.deepEqual(calls.map(c=>c[0]),['project-search-files','project-inventory','project-file']);assert.ok(calls.slice(1).every(c=>c[1].ref==='b'.repeat(40)));
 await first.search('CONTROLLER');assert.equal(calls.length,3);first.destroy();second.destroy();
});

test('controller suppresses stale queries, cancellation and disposed results; failed load can retry',async()=>{
 const gate=deferred(),cache=new Map();let calls=0;
 const request=async type=>{if(type==='project-search-files'){calls++;await gate.promise;return{files:[board]};}return{files:[]};};
 const controller=createController({scope,request,cache});const stale=controller.search('old'),fresh=controller.search('U1');gate.resolve();assert.equal(await stale,null);assert.equal((await fresh).results[0].reference,'U1');
 const cancelled=controller.search('U1');controller.cancel();assert.equal(await cancelled,null);
 const disposed=controller.search('U1');controller.destroy();assert.equal(await disposed,null);assert.equal(await controller.search('U1'),null);assert.equal(calls,1);
 let broken=true;const retry=createController({scope,cache:new Map(),request:async type=>{if(broken)throw Error('offline');return type==='project-search-files'?{files:[board]}:{files:[]};}});
 await assert.rejects(retry.search('U1'),/offline/);broken=false;assert.equal((await retry.search('U1')).results[0].reference,'U1');
});

test('immutable scope rejects mismatching drawing and inventory snapshots without fetching their reports',async()=>{
 let reports=0;
 const controller=createController({scope,cache:new Map(),request:async type=>{
  if(type==='project-search-files')return{files:[board],snapshotRef:'b'.repeat(40)};
  if(type==='project-inventory')return{files:[{path:'analysis/foreign.csv'}],snapshotRef:'b'.repeat(40)};
  reports++;return{content:'foreign-source'};
 }});
 await assert.rejects(controller.search('U1'),/immutable snapshot/);assert.equal(reports,0);
 const partial=createController({scope,cache:new Map(),request:async type=>type==='project-search-files'?{files:[board],snapshotRef:scope.ref}:{files:[{path:'foreign.csv'}],snapshotRef:'b'.repeat(40)}});
 const result=await partial.search('U1');assert.equal(result.results[0].uuid,'part-1');assert.match(result.warnings.join(' '),/immutable snapshot/);assert.equal((await partial.search('foreign.csv')).results.length,0);
});

test('partial source/read failures retain filename results and show limitations; report request budget is finite',async()=>{
 let reports=0;const controller=createController({scope,cache:new Map(),request:async(type,extra)=>{
  if(type==='project-search-files')throw Error('drawing unreadable');
  if(type==='project-inventory')return{files:Array.from({length:20},(_,i)=>({path:'simulation/'+i+'.csv'}))};
  reports++;if(reports===1)throw Error('missing report');return{path:extra.file,content:'measurement-'+reports};
 }});
 const result=await controller.search('measurement');assert.equal(reports,12);assert.match(result.warnings.join(' '),/drawing unreadable/);assert.match(result.warnings.join(' '),/missing report/);assert.match(result.warnings.join(' '),/12 eligible/);
 assert.equal((await controller.search('19.csv')).results[0].kind,'file');
});

class Node{
 constructor(tag='document'){this.tagName=tag;this.children=[];this.attributes={};this.events=new Map();this.textContent='';this.hidden=false;this.value='';}
 set innerHTML(value){throw Error('HTML must remain inert');}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}
 addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);}
 removeEventListener(name,fn){this.events.get(name)?.delete(fn);}
 fire(name,extra={}){const event={target:this,preventDefault(){this.prevented=true;},...extra};for(const fn of this.events.get(name)||[])fn(event);return event;}
 contains(target){return target===this||this.children.some(c=>c.contains(target));}
 focus(){this.focused=true;}select(){this.selected=true;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
}
class Document extends Node{createElement(tag){return new Node(tag);}}
function all(node,tag){return node.children.flatMap(c=>[...(c.tagName===tag?[c]:[]),...all(c,tag)]);}

test('header combobox uses inert nodes, keyboard navigation, 3D action, dismissal and lazy Ctrl+K',async()=>{
 const document=new Document(),holder=new Node('header'),opened=[];let reads=0;
 const ui=mount({document,holder,scope,cache:new Map(),open:async item=>opened.push(item),request:async type=>{reads++;return type==='project-search-files'?{files:[board]}:{files:[{path:'<img onerror=alert(1)>.csv'}]};}});
 assert.equal(ui.input.attributes['aria-label'],'Search entire project');assert.equal(ui.input.attributes.role,'combobox');assert.equal(reads,0);
 document.fire('keydown',{ctrlKey:true,key:'k'});assert.equal(ui.input.focused,true);assert.equal(reads,0);
 ui.input.value='U1';ui.input.fire('keydown',{key:'Enter'});await pause();
 const option=all(holder,'div').find(n=>n.attributes.role==='option');assert.ok(option);
 ui.input.fire('keydown',{key:'ArrowDown'});assert.equal(ui.input.attributes['aria-activedescendant'],option.id);
 ui.input.fire('keydown',{key:'Enter'});await pause();assert.equal(opened[0].uuid,'part-1');assert.equal(ui.popover.hidden,true);
 ui.input.fire('keydown',{key:'Enter'});await pause();all(holder,'button').find(n=>n.textContent==='Show in 3D').fire('click');await pause();assert.equal(opened[1].view,'3d');assert.equal(opened[1].uuid,opened[0].uuid);
 ui.input.value='<img';ui.input.fire('keydown',{key:'Enter'});await pause();assert.ok(all(holder,'strong').some(n=>n.textContent==='<img onerror=alert(1)>.csv'));assert.equal(all(holder,'img').length,0);
 document.fire('pointerdown',{target:new Node()});assert.equal(ui.popover.hidden,true);
 document.fire('keydown',{ctrlKey:true,key:'k'});ui.input.fire('keydown',{key:'Escape'});assert.equal(ui.popover.hidden,true);
 ui.destroy();assert.equal(holder.children.length,0);assert.equal(document.events.get('keydown').size,0);
});

test('dismissal prevents late search rendering and rejected async opening is visible',async()=>{
 const gate=deferred(),document=new Document(),holder=new Node('header');
 const ui=mount({document,holder,scope,cache:new Map(),open:async()=>{throw Error('viewer closed');},request:async type=>{if(type==='project-search-files'){await gate.promise;return{files:[board]};}return{files:[]};}});
 ui.input.value='U1';ui.input.fire('keydown',{key:'Enter'});ui.input.fire('keydown',{key:'Escape'});gate.resolve();await pause();assert.equal(ui.popover.hidden,true);assert.equal(all(holder,'button').length,0);
 ui.input.fire('keydown',{key:'Enter'});await pause();all(holder,'button')[0].fire('click');await pause();assert.equal(ui.popover.hidden,false);assert.ok(all(holder,'p').some(n=>n.textContent.includes('viewer closed')));ui.destroy();
});

test('input debounce keeps new queries from opening stale results and cleared input stays idle',async()=>{
 const document=new Document(),holder=new Node('header'),opened=[];let reads=0;
 const ui=mount({document,holder,scope,cache:new Map(),open:item=>opened.push(item),request:async type=>{reads++;return type==='project-search-files'?{files:[board]}:{files:[]};}});
 ui.input.value='U1';ui.input.fire('input');ui.input.value='';ui.input.fire('input');await new Promise(resolve=>setTimeout(resolve,LIMITS.debounce+20));assert.equal(reads,0);
 ui.input.value='U1';ui.input.fire('keydown',{key:'Enter'});await pause();ui.input.fire('keydown',{key:'ArrowDown'});
 ui.input.value='missing';ui.input.fire('input');ui.input.fire('keydown',{key:'Enter'});await pause();assert.equal(opened.length,0);assert.equal(all(holder,'button').length,0);ui.destroy();
});
