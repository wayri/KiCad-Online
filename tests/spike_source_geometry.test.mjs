import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';
import{sourceZoneGeometry,drillLoopInsideBoard}from'../extension/spike/sourceGeometry.mjs';
const{parse}=createRequire(import.meta.url)('../extension/design-diff.js');
const triangle='(pts (xy 0 0) (xy 2 0) (xy 0 2))';
test('drill holes must be strictly inside the saved outline without crossing cutouts',()=>{
 const outer=[[0,0],[10,0],[10,10],[0,10]],hole=[[4,4],[6,4],[6,6],[4,6]];
 assert.equal(drillLoopInsideBoard([[1,1],[2,1],[2,2],[1,2]],outer,[hole]),true);
 assert.equal(drillLoopInsideBoard([[0,1],[2,1],[2,2],[0,2]],outer),false);
 assert.equal(drillLoopInsideBoard([[-1,1],[2,1],[2,2],[-1,2]],outer),false);
 assert.equal(drillLoopInsideBoard([[3,5],[7,5],[7,5.5],[3,5.5]],outer,[hole]),false);
 assert.equal(drillLoopInsideBoard([[4.5,4.5],[5,4.5],[5,5],[4.5,5]],outer,[hole]),false);
});
test('a saved zone boundary never becomes invented copper fill',()=>{
 const ast=parse(`(kicad_pcb (net 1 "GND") (zone (uuid "zone-a") (net 1) (layer "F.Cu") (polygon ${triangle})))`),result=sourceZoneGeometry(ast);
 assert.equal(result.unfilled,1);assert.equal(result.records.length,1);assert.equal(result.records[0].filled,false);assert.equal(result.records[0].net,'GND');assert.equal(result.records[0].id,'zone-a');
});
test('saved fill regions retain their exact source layer and coordinates',()=>{
 const result=sourceZoneGeometry(parse(`(kicad_pcb (zone (layers "F.Cu" "B.Cu") (polygon ${triangle}) (filled_polygon (layer "B.Cu") ${triangle})))`));
 assert.equal(result.unfilled,0);assert.equal(result.records.length,1);assert.equal(result.records[0].layer,'B.Cu');assert.equal(result.records[0].filled,true);assert.deepEqual(result.records[0].points,[[0,0],[2,0],[0,2]]);
});
test('source polygon and point budgets disclose omitted geometry',()=>{
 const ast=parse(`(kicad_pcb (zone (layers "F.Cu" "B.Cu") (polygon ${triangle})))`);
 const result=sourceZoneGeometry(ast,1,3);assert.equal(result.records.length,1);assert.equal(result.truncated,true);
 assert.equal(sourceZoneGeometry(ast,100,2).records.length,0);
});


test('internal saved fills and boundaries retain their source layer and exact net identity',()=>{
 const ast=parse(`(kicad_pcb (net 1 "GND") (zone (uuid "inner") (net 1) (layers "In1.Cu" "In2.Cu") (filled_polygon (layer "In1.Cu") ${triangle})) (zone (uuid "outline") (net 1) (layer "In2.Cu") (polygon ${triangle})))`);
 const result=sourceZoneGeometry(ast);assert.deepEqual(result.records.map(r=>[r.layer,r.net,r.filled]),[['In1.Cu','GND',true],['In2.Cu','GND',false]]);
});

test('a busy front plane leaves room for saved fills on all 32 copper layers',()=>{
 const names=['F.Cu',...Array.from({length:30},(_,i)=>'In'+(i+1)+'.Cu'),'B.Cu'];
 const declarations=names.map((name,i)=>'('+(i===31?2:i===0?0:2*i+2)+' "'+name+'" signal)').join(' ');
 const fill=name=>'(filled_polygon (layer "'+name+'") '+triangle+')';
 const front=Array.from({length:40},()=>fill('F.Cu')).join(' ');
 const ast=parse('(kicad_pcb (version 20241229) (layers '+declarations+') (zone (uuid "plane") (layers '+names.map(name=>'"'+name+'"').join(' ')+') '+front+' '+names.slice(1).map(fill).join(' ')+'))');
 for(const [polygonLimit,pointLimit] of [[32,500000],[1000,96]]){
  const result=sourceZoneGeometry(ast,polygonLimit,pointLimit);
  assert.deepEqual(result.records.map(record=>record.layer),names);
  assert.deepEqual(result.omittedByLayer,{'F.Cu':39});
  assert.equal(result.truncated,true);
  for(const record of result.records){
   assert.equal(record.filled,true);assert.equal(record.id,'plane');
   assert.deepEqual(record.points,[[0,0],[2,0],[0,2]]);
  }
 }
});
