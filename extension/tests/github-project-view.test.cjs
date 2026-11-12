const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../github-project-view.js'),data=require('../browser-data.js'),paths=require('../parsing.js');
const fixture=require('./fixtures/github-model-discovery/olimex-m2-index.json');

test('a pinned OLIMEX PCB path opens from exact bytes even when its folder listing is unavailable',async()=>{
 const reads=[],api=create({data,paths,buffer:{directory:async()=>{throw Error('GitHub did not expose a directory tree');},file:async(repository,sha,file)=>{reads.push({repository,sha,file});return '(kicad_pcb (version 20240108))';}}});
 const files=await api.read({type:'project',repository:fixture.repository,ref:fixture.sha,file:fixture.boardPath});
 assert.equal(files.length,1);assert.equal(files[0].path,fixture.boardPath);assert.equal(files.recentSnapshotRef,fixture.sha);assert.equal(reads.length,1);assert.deepEqual(reads[0],{repository:fixture.repository,sha:fixture.sha,file:fixture.boardPath});
});

test('a direct schematic still loads its saved children when optional parent discovery cannot list folders',async()=>{
 const files=new Map([['design/root.kicad_sch','(kicad_sch (sheet (property "Sheetfile" "../shared/child.kicad_sch")))'],['shared/child.kicad_sch','(kicad_sch)']]),reads=[];
 const api=create({data,paths,buffer:{directory:async()=>{throw Error('Folder metadata unavailable');},inventory:async()=>{throw Error('Must not crawl unrelated repository folders');},file:async(repository,sha,file)=>{reads.push(file);return files.get(file)??null;}}});
 const result=await api.read({type:'project',repository:'public/hierarchy',ref:fixture.sha,file:'design/root.kicad_sch'});
 assert.deepEqual(result.map(file=>file.path),['design/root.kicad_sch','shared/child.kicad_sch']);assert.match(result[0].discoveryWarning,/Parent-sheet discovery was incomplete/);assert.equal(reads.includes('shared/child.kicad_sch'),true);
});

test('a direct leaf recovers its saved hierarchy through the website inventory when optional directory metadata is unavailable',async()=>{
 const files=new Map([['design/sheets/child.kicad_sch','(kicad_sch)'],['design/root.kicad_sch','(kicad_sch (sheet (property "Sheetfile" "sheets/child.kicad_sch")))']]),reads=[];
 const api=create({data,paths,buffer:{directory:async()=>{throw Error('Folder metadata unavailable');},inventory:async()=>({sha:fixture.sha,files:[...files.keys()].map(path=>({path,size:0})),warnings:[]}),file:async(repository,sha,file)=>{reads.push({sha,file});return files.get(file)??null;}}});
 const result=await api.read({type:'project',repository:'public/hierarchy',ref:fixture.sha,file:'design/sheets/child.kicad_sch'});
 assert.deepEqual(result.map(file=>file.path),['design/root.kicad_sch','design/sheets/child.kicad_sch']);assert.equal(result[0].discoveryWarning,undefined);assert.ok(reads.every(read=>read.sha===fixture.sha));
});

test('companion discovery retains nested drawings and widens to sibling folders only when needed',async()=>{
 const inventories=[],local=[{path:'design/sch/root.kicad_sch',size:0},{path:'design/sch/child/sub.kicad_sch',size:0}],wide=[...local,{path:'design/pcb/board.kicad_pcb',size:0}];
 const api=create({data,paths,buffer:{inventory:async(repository,sha,signal,options)=>{inventories.push({sha,options});return {snapshotRef:sha,files:options.scoped?local:wide,warnings:[]};}}});
 const result=await api.read({type:'drawing-files',repository:'public/hierarchy',ref:fixture.sha,file:'design/sch/root.kicad_sch'});
 assert.deepEqual(result.files,wide.map(file=>file.path).sort());assert.equal(result.snapshotRef,fixture.sha);assert.equal(inventories.length,2);assert.equal(inventories[0].options.scoped,true);assert.equal(inventories[1].options.scoped,undefined);assert.ok(inventories.every(read=>read.sha===fixture.sha));
 const onlyLocal=create({data,paths,buffer:{inventory:async(repository,sha,signal,options)=>{assert.equal(options.scoped,true,'do not widen a usable local project inventory');return {snapshotRef:sha,files:wide,warnings:[]};}}});
 assert.deepEqual((await onlyLocal.read({type:'drawing-files',repository:'public/hierarchy',ref:fixture.sha,file:'design/sch/root.kicad_sch'})).files,result.files);
});
