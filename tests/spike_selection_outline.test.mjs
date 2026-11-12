import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createExplodeView} from '../extension/spike/explodeView.mjs';
import {selectionMatcher} from '../extension/spike/selectionState.mjs';
import {createSelectionGeometry} from '../extension/spike/selectionGeometry.mjs';
const require=createRequire(import.meta.url);
const location=['../extension/node_modules/three/build/three.cjs','../.vizdiff/build-deps/node_modules/three/build/three.cjs'].map(p=>new URL(p,import.meta.url)).find(existsSync);
assert.ok(location,'Main3D selection integration requires the pinned Three.js build dependency.');
const THREE=require(fileURLToPath(location));
function setup(pickables,netState={active:false,warnings:[]}){
 const source=readFileSync(new URL('../extension/spike/board3d.js',import.meta.url),'utf8'),start=source.indexOf('  const selectionGeometry=createSelectionGeometry('),end=source.indexOf('  function clearSelection()',start);
 assert.ok(start>=0&&end>start,'Exercise the production main-scene selection integration.');const code=source.slice(start,end),scene=new THREE.Scene(),appearance=[];for(const object of pickables)if(!object.parent)scene.add(object);let redraws=0;
 const ui=Function('explode','THREE','initialDark','scene','document','stage','selectionMatcher','board','pickables','invalidate','selectionAppearance','selectionDim','netInspection','fullNet3D','netInspectionHelp','hint','createSelectionGeometry','const mechanical=false;'+code+';return {setSelection,selectionGeometry,selectionNotice};')(createExplodeView(THREE,{layers:[]}),THREE,true,scene,{createElement:()=>({style:{}})},{append(){}},selectionMatcher,{nets:{},pads:[]},pickables,()=>redraws++,{update(matches,enabled,options){appearance.push({matches,enabled,options});}},true,{group:new THREE.Group(),update(){return netState;}},true,{},{},createSelectionGeometry);
 return {...ui,scene,appearance,redraws:()=>redraws};
}

test('main component cross-selection highlights body and pads with exact source meshes, clears and redraws',()=>{
 const body=new THREE.Mesh(new THREE.TorusGeometry(1,.2,8,16));body.position.set(3,4,1);body.userData.record={ref:'U1',type:'Component'};
 const pad=new THREE.Mesh(new THREE.CircleGeometry(.5,24));pad.position.set(5,4,0);pad.userData.record={ref:'U1',type:'Pad'};
 const other=new THREE.Mesh(new THREE.BoxGeometry());other.userData.record={ref:'U2',type:'Component'};
 const ui=setup([body,pad,other]),result=ui.setSelection({references:['U1']});assert.deepEqual(result,{highlighted:2,matched:2,limited:false});assert.equal(ui.redraws(),1,'selection schedules an on-demand redraw');
 const overlays=ui.selectionGeometry.group.children;assert.equal(overlays.length,2);assert.ok(overlays.every(object=>object.isMesh&&!object.isLineSegments));assert.equal(overlays[0].geometry,body.geometry);assert.equal(overlays[1].geometry,pad.geometry);assert.equal(overlays[0].geometry.attributes.position,body.geometry.attributes.position);assert.deepEqual(overlays[0].matrix.elements,body.matrixWorld.elements);assert.deepEqual(overlays[1].matrix.elements,pad.matrixWorld.elements);assert.equal(overlays[0].material.depthTest,true);assert.equal(overlays[0].material.depthWrite,false);assert.equal(ui.appearance.at(-1).enabled,true);
 ui.setSelection({});assert.equal(ui.selectionGeometry.group.children.length,0);assert.equal(ui.selectionGeometry.group.visible,false);assert.equal(ui.redraws(),2);assert.equal(ui.appearance.at(-1).enabled,false);ui.selectionGeometry.dispose();body.geometry.dispose();pad.geometry.dispose();other.geometry.dispose();
});

test('main pin cross-selection uses the selected instance exact geometry and saved world transform',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.RingGeometry(.2,.5,24),new THREE.MeshBasicMaterial(),2);mesh.userData.records=[{type:'Pad',uuid:'selected-pad',ref:'U1'},{type:'Pad',uuid:'other-pad',ref:'U1'}];mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(8,0,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(20,0,0));mesh.position.y=3;
 const ui=setup([mesh]),result=ui.setSelection({uuids:['selected-pad']});assert.deepEqual(result,{highlighted:1,matched:1,limited:false});assert.equal(ui.redraws(),1);const selected=ui.selectionGeometry.group.children[0];assert.equal(selected.isMesh,true);assert.equal(selected.geometry,mesh.geometry);assert.deepEqual(selected.matrix.elements,new THREE.Matrix4().makeTranslation(8,3,0).elements);assert.equal(ui.selectionGeometry.group.children.length,1);assert.equal(mesh.instanceMatrix.count,2);
 ui.setSelection({});assert.equal(ui.selectionGeometry.group.children.length,0);ui.selectionGeometry.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('main selection budget is visibly disclosed and clearing removes the warning',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2001);mesh.userData.records=Array.from({length:2001},()=>({type:'Pad',ref:'U1'}));for(let i=0;i<2001;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i,0,0));
 const ui=setup([mesh]),result=ui.setSelection({references:['U1']});assert.deepEqual(result,{highlighted:2000,matched:2001,limited:true});assert.equal(ui.selectionNotice.hidden,false);assert.equal(ui.selectionNotice.style.display,'block');assert.match(ui.selectionNotice.textContent,/Showing 2000 of 2001 selected source meshes/);
 ui.setSelection({});assert.equal(ui.selectionNotice.hidden,true);assert.equal(ui.selectionNotice.style.display,'none');ui.selectionGeometry.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('main full-net inspection retains its own internal copper overlay and translucent context',()=>{
 const state={active:true,nets:['VCC'],tracks:2,pads:1,vias:1,platedPads:0,fills:1,boundaries:0,omitted:0,sourceLimited:false,warnings:[]},ui=setup([],state),result=ui.setSelection({netNames:['VCC']});assert.equal(result.fullNet3D,true);assert.equal(result.highlighted,5);assert.equal(ui.selectionGeometry.group.children.length,0);assert.deepEqual(ui.appearance.at(-1).options,{translucent:true});assert.equal(ui.appearance.at(-1).enabled,true);ui.selectionGeometry.dispose();
});

test('source-only net selection tints exact instances by layer and restores ordinary part highlighting',()=>{
 const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(1,1,.03),mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),2);mesh.userData.records=[{net:'SIGNAL',layer:'F.Cu'},{net:'SIGNAL',layer:'B.Cu'}];mesh.setMatrixAt(0,new THREE.Matrix4());mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(2,0,0));scene.add(mesh);const sourceMaterial=mesh.material,display=createSelectionGeometry(THREE,{scene,objects:()=>[mesh]});
 display.update(r=>r.net==='SIGNAL',{colorForRecord:r=>r.layer==='F.Cu'?0xfa6f68:0x63a5ff});const overlays=display.group.children;assert.equal(overlays[0].material.color.getHex(),0xfa6f68);assert.equal(overlays[1].material.color.getHex(),0x63a5ff);assert.ok(overlays.every(o=>o.geometry===geometry));assert.equal(mesh.material,sourceMaterial);
 display.update(()=>true);assert.ok(display.group.children.every(o=>o.material.color.getHex()===0x4de3ee));display.dispose();geometry.dispose();sourceMaterial.dispose();
});
