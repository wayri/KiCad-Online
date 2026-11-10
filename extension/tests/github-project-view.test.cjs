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
