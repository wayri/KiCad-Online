import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createNetInspection} from '../extension/spike/netInspection.mjs';
import {sourceCopperPlan} from '../extension/spike/copperStack.mjs';
const require=createRequire(import.meta.url);
const THREE=require('../.vizdiff/build-deps/node_modules/three/build/three.cjs');
const {parse}=require('../extension/design-diff.js');
for(const mode of ['layer','accent'])test(`selected vias retain gold in ${mode} highlight mode`,()=>{
 const board={nets:{1:'SIGNAL'},layers:['F.Cu','B.Cu'],stackup:[],tracks:[],pads:[],vias:[{id:'via-1',layers:['F.Cu','B.Cu'],at:[0,0],size:.9,drill:.4,net:'SIGNAL'}]};
 const ast=parse('(kicad_pcb (via (at 0 0) (layers "F.Cu" "B.Cu") (uuid "via-1")))');
 const plan=sourceCopperPlan(board,ast,1.6),view=createNetInspection(THREE,{board,plan,zones:[],pads:[],world:([x,y])=>[x,-y],colorForLayer:layer=>layer==='F.Cu'?0xff0000:0x0000ff});
 try{
  view.setColorMode(mode);const state=view.update({netNames:['SIGNAL']});assert.equal(state.vias,1);
  const meshes=view.group.children.filter(object=>object.userData.records?.some(record=>record.id==='via-1'));
  assert.ok(meshes.length>=3,'saved through via has annuli and barrel');
  for(const next of ['layer','accent','layer']){view.setColorMode(next);for(const mesh of meshes)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])assert.equal(material.color.getHex(),0xc5aa6c,'via plating keeps gold independently of the copper highlight palette');}
 }finally{view.dispose();}
});
