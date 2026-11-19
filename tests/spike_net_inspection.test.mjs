import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createNetInspection} from '../extension/spike/netInspection.mjs';
import {sourceCopperPlan} from '../extension/spike/copperStack.mjs';
const require=createRequire(import.meta.url),location=['../extension/node_modules/three/build/three.cjs','../.vizdiff/build-deps/node_modules/three/build/three.cjs'].map(p=>new URL(p,import.meta.url)).find(existsSync),THREE=location?require(fileURLToPath(location)):null;
const {parse}=require('../extension/design-diff.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const boreDepth=object=>{if(object.geometry.type!=='BufferGeometry')return 0;object.geometry.computeBoundingBox();return object.geometry.boundingBox.max.z-object.geometry.boundingBox.min.z;};
function fixture(){
 const board={nets:{1:'SIGNAL',2:'OTHER'},layers:['F.Cu','In1.Cu','In2.Cu','B.Cu'],stackup:[{name:'F.Cu',thickness:.04},{name:'dielectric 1',type:'core',thickness:.2},{name:'In1.Cu',thickness:.03},{name:'dielectric 2',type:'core',thickness:1},{name:'In2.Cu',thickness:.03},{name:'dielectric 3',type:'core',thickness:.4},{name:'B.Cu',thickness:.04}],tracks:[],vias:[],pads:[]};
 for(const [index,layer] of board.layers.entries())board.tracks.push({id:'track-'+index,layer,net:'SIGNAL',start:[1,2],end:[3,2],width:.3});board.tracks.push({id:'other',layer:'F.Cu',net:'OTHER',start:[4,4],end:[5,5],width:.2});
 const ends=[['F.Cu','B.Cu'],['F.Cu','In1.Cu'],['In1.Cu','In2.Cu'],['In2.Cu','B.Cu']];
 const ast=parse('(kicad_pcb '+ends.map(([a,b],i)=>`(via ${['','blind','blind','micro'][i]} (at ${i} 3) (layers "${a}" "${b}") (uuid "via-${i}"))`).join(' ')+')');
 board.vias=ends.map((layers,i)=>({id:'via-'+i,layers,at:[i,3],size:.9,drill:.4,net:'SIGNAL'}));
 const pads=[{id:'plated',ref:'J1',nativeType:'thru_hole',net:'SIGNAL',at:[4,5],rotation:90,shape:'rect',width:2,height:2,drill:.4,drillShape:'circle',drillOffset:[.1,.2],layers:['*.Cu']},{id:'npth',nativeType:'np_thru_hole',net:'SIGNAL',at:[5,5],shape:'circle',width:1,height:1,drill:1,drillShape:'circle',layers:['*.Cu']}];
 board.pads=pads;
 const zoneRecords=[{id:'fill',layer:'In2.Cu',net:'SIGNAL',filled:true,points:[[7,2],[9,2],[9,4],[7,4]]},{id:'boundary',layer:'In1.Cu',net:'SIGNAL',filled:false,points:[[10,2],[12,2],[12,4],[10,4]]}];
 const plan=sourceCopperPlan(board,ast,1.74);
 const zones=zoneRecords.map(({points,...record})=>{
  const vertices=points.map(([x,y])=>new THREE.Vector3(x,-y,0));
  const geometry=new THREE.BufferGeometry().setFromPoints(vertices);
  if(record.filled)geometry.setIndex([0,1,2,0,2,3]);
  return {record:{...record,type:record.filled?'Zone':'Zone boundary'},geometry,depth:plan.byLayer.get(record.layer).z};
 });
 const view=createNetInspection(THREE,{board,plan,zones,pads,world:([x,y])=>[x,-y],colorForLayer:()=>0x44ddff});return {board,plan,view,zones};
}

test('selected net retains all four source layers, real via spans, plated transitions and inert unfilled boundaries',{skip:!THREE},()=>{
 const {view,plan}=fixture(),state=view.update({netCodes:[1]});assert.equal(state.active,true);assert.equal(state.tracks,4);assert.equal(state.pads,4);assert.equal(state.vias,4);assert.equal(state.platedPads,1);assert.equal(state.fills,1);assert.equal(state.boundaries,1);assert.equal(state.omitted,0);assert.match(state.warnings.join(' '),/plating thickness is not inferred/);
 assert.deepEqual(new Set(view.group.children.filter(o=>o.userData.layer).map(o=>o.userData.layer)),new Set(['F.Cu','In1.Cu','In2.Cu','B.Cu']));
 assert.equal(view.group.children.some(o=>o.userData.records?.some(r=>r.id==='other'||r.id==='npth')),false);
 for(const [id,span] of plan.viaSpans){const barrel=view.group.children.find(o=>o.userData.records?.some(r=>r.id===id)&&Math.abs(boreDepth(o)-(span.zMax-span.zMin))<1e-7);assert.ok(barrel,id);const matrix=new THREE.Matrix4();barrel.getMatrixAt(0,matrix);near(matrix.elements[14],span.zMin);}
 const fill=view.group.children.find(o=>o.userData.record?.id==='fill');const box=new THREE.Box3().setFromObject(fill);near(box.min.x,7);near(box.max.x,9);near(box.min.y,-4);near(box.max.y,-2);assert.equal(fill.material.transparent,true);assert.equal(fill.material.depthWrite,false);
 const boundary=view.group.children.find(o=>o.userData.record?.id==='boundary');assert.equal(boundary.isLineLoop,true);
 const padBarrel=view.group.children.find(o=>o.userData.records?.some(r=>r.id==='plated')&&boreDepth(o)>1);assert.ok(padBarrel);const m=new THREE.Matrix4();padBarrel.getMatrixAt(padBarrel.userData.records.findIndex(r=>r.id==='plated'),m);near(m.elements[12],4.2);near(m.elements[13],-4.9);view.dispose();
});

test('net changes reuse unchanged geometry, dispose instance buffers and clear counters without changing source',{skip:!THREE},()=>{
 const {board,view}=fixture(),before=JSON.stringify(board);view.update({netNames:['SIGNAL']});const first=[...view.group.children];let disposed=0;for(const object of first)if(object.isInstancedMesh)object.addEventListener('dispose',()=>disposed++);
 view.update({netNames:['SIGNAL']});assert.deepEqual(view.group.children,first);
 const next=view.update({netNames:['OTHER']});assert.equal(next.tracks,1);assert.equal(next.vias,0);assert.equal(disposed,first.filter(o=>o.isInstancedMesh).length);
 const cleared=view.update({});assert.equal(cleared.active,false);assert.equal(cleared.tracks,0);assert.equal(cleared.vias,0);assert.equal(cleared.meshes,0);assert.deepEqual(cleared.warnings,[]);assert.equal(JSON.stringify(board),before);view.dispose();
});

test('full selected net is independent of the 2000 outline cap and bounds unique geometry batches',{skip:!THREE},()=>{
 const {board,view}=fixture();board.tracks=Array.from({length:2501},(_,i)=>({id:String(i),layer:'In1.Cu',net:'SIGNAL',start:[i/100,0],end:[i/100,1],width:.2}));let state=view.update({netNames:['SIGNAL']});assert.equal(state.tracks,2501);assert.equal(state.omitted,0);assert.ok(state.meshes<32);view.dispose();
 const other=fixture();other.board.tracks=[];other.board.vias=[];other.board.pads.splice(0,other.board.pads.length,...Array.from({length:600},(_,i)=>({id:String(i),nativeType:'smd',net:'SIGNAL',layer:'F.Cu',at:[0,0],shape:'rect',width:1+i/1000,height:1,drill:0})));
 state=other.view.update({netNames:['SIGNAL']});assert.ok(state.omitted>0);assert.equal(state.fills+state.boundaries,2);assert.ok(state.meshes-state.fills-state.boundaries<=512);assert.match(state.warnings.join(' '),/budget/);other.view.dispose();
});

test('layer/accent switching recolors copper while preserving gold via surfaces and source geometry',{skip:!THREE},()=>{
 const {view,board}=fixture(),before=JSON.stringify(board);view.update({netNames:['SIGNAL']});const objects=[...view.group.children],geometry=objects.map(o=>o.geometry);
 assert.ok(objects.every(o=>o.material.color.getHex()===(o.material.userData.netRole==='via'?0xc5aa6c:0x44ddff)));view.setColorMode('accent');assert.ok(objects.every(o=>o.material.color.getHex()===(o.material.userData.netRole==='via'?0xc5aa6c:0xffe18b)));assert.equal(view.state().colorMode,'accent');
 view.setColorMode('layer');assert.ok(objects.every(o=>o.material.color.getHex()===(o.material.userData.netRole==='via'?0xc5aa6c:0x44ddff)));assert.deepEqual(view.group.children,objects);assert.deepEqual(view.group.children.map(o=>o.geometry),geometry);assert.equal(JSON.stringify(board),before);
 view.setColorMode('accent');view.update({netNames:['OTHER']});assert.ok(view.group.children.every(o=>o.material.color.getHex()===(o.material.userData.netRole==='via'?0xc5aa6c:0xffe18b)));view.dispose();
});

test('real layer palette distinguishes four copper layers while via spans retain gold',{skip:!THREE},()=>{
 const {board,plan}=fixture(),palette={'F.Cu':0xfa6f68,'In1.Cu':0x7fc87f,'In2.Cu':0xce7d2c,'B.Cu':0x63a5ff};
 const view=createNetInspection(THREE,{board,plan,zones:[],pads:board.pads,world:([x,y])=>[x,-y],colorForLayer:layer=>palette[layer]});view.update({netNames:['SIGNAL']});
 for(const layer of board.layers){const objects=view.group.children.filter(o=>o.userData.layer===layer);assert.ok(objects.length);assert.ok(objects.every(o=>o.material.color.getHex()===(o.material.userData.netRole==='via'?0xc5aa6c:palette[layer])));}
 view.setColorMode('accent');view.setColorMode('layer');assert.equal(view.group.children.find(o=>o.userData.layer==='B.Cu').material.color.getHex(),palette['B.Cu']);view.dispose();
});

test('main and probe highlights borrow the same saved zone geometry and leave its disposal to the board',{skip:!THREE},async()=>{
 const {createProbeNetInspection}=await import('../extension/spike/probeViewport.mjs');
 const {board,plan,view,zones}=fixture();
 const probe=createProbeNetInspection(THREE,{board,plan,zones,pads:board.pads,world:([x,y])=>[x,-y],colorForLayer:()=>0x44ddff});
 let sharedDisposals=0;
 for(const {geometry} of zones)geometry.addEventListener('dispose',()=>sharedDisposals++);
 for(let cycle=0;cycle<2;cycle++){
  assert.equal(view.update({netNames:['SIGNAL']}).fills,1);
  assert.equal(probe.update({netNames:['SIGNAL']}).fills,1);
  for(const {record,geometry} of zones){
   assert.equal(view.group.children.find(node=>node.userData.record===record).geometry,geometry);
   assert.equal(probe.group.children[0].children.find(node=>node.userData.record===record).geometry,geometry);
  }
  view.update({});probe.update({});
 }
 view.dispose();probe.dispose();
 assert.equal(sharedDisposals,0);
 for(const {geometry} of zones)geometry.dispose();
 assert.equal(sharedDisposals,zones.length);
});
