import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createSelectionAppearance} from '../extension/spike/selectionAppearance.mjs';
import {selectionMatcher} from '../extension/spike/selectionState.mjs';
const require=createRequire(import.meta.url),location=['../extension/node_modules/three/build/three.cjs','../.vizdiff/build-deps/node_modules/three/build/three.cjs'].map(p=>new URL(p,import.meta.url)).find(existsSync),THREE=location?require(fileURLToPath(location)):null;

test('exact net selection keeps original selected instance color and greys neighbors, then restores material and colors',{skip:!THREE},()=>{
 const material=new THREE.MeshStandardMaterial({color:0xffffff}),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,2);
 mesh.userData.records=[{uuid:'a',ref:'U1',net:'GND'},{uuid:'b',ref:'U1',net:'VCC'}];mesh.setColorAt(0,new THREE.Color('#d5a027'));mesh.setColorAt(1,new THREE.Color('#ec6262'));
 const sourceColors=mesh.instanceColor,sourceBytes=[...sourceColors.array],geometry=mesh.geometry,matrix=mesh.instanceMatrix;
 const display=createSelectionAppearance(THREE,()=>[mesh]),color=new THREE.Color();
 display.update(selectionMatcher({netNames:['GND']}),true);mesh.getColorAt(0,color);assert.ok(Math.hypot(...color.toArray().map((v,i)=>v-new THREE.Color('#d5a027').toArray()[i]))<1e-6);mesh.getColorAt(1,color);assert.equal(color.r,color.g);assert.equal(color.g,color.b);assert.equal(mesh.geometry,geometry);assert.equal(mesh.instanceMatrix,matrix);
 display.update(selectionMatcher({uuids:['b']}),true);mesh.getColorAt(0,color);assert.equal(color.r,color.g);mesh.getColorAt(1,color);assert.ok(Math.hypot(...color.toArray().map((v,i)=>v-new THREE.Color('#ec6262').toArray()[i]))<1e-6);
 display.restore();assert.equal(mesh.material,material);assert.equal(mesh.instanceColor,sourceColors);assert.deepEqual([...sourceColors.array],sourceBytes);
});

test('selection appearance leaves selected textured materials intact and desaturates other shared materials reversibly',{skip:!THREE},()=>{
 const material=new THREE.MeshStandardMaterial({color:0xdf7434}),a=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),b=a.clone();a.userData.record={uuid:'a'};b.userData.record={uuid:'b'};b.visible=false;
 const display=createSelectionAppearance(THREE,()=>[a,b]);display.update(selectionMatcher({uuids:['a']}),true);assert.equal(a.material,material);assert.notEqual(b.material,material);assert.equal(b.visible,false);
 const shader={fragmentShader:'void main(){vec3 outgoingLight;#include <opaque_fragment>}'};b.material.onBeforeCompile(shader);assert.match(shader.fragmentShader,/dot\(outgoingLight/);assert.equal(material.color.getHex(),0xdf7434);
 display.update(()=>false,false);assert.equal(b.material,material);assert.equal(b.visible,false);
});

test('explicit numeric-looking net names never resolve as different net codes',()=>{
 const match=selectionMatcher({netNames:['1']},{nets:{1:'VCC'},pads:[]});assert.equal(match({net:'1'}),true);assert.equal(match({net:'VCC'}),false);
});


test('net inspection makes substrate cap and edge materials translucent grey, then restores them exactly',{skip:!THREE},()=>{
 const cap=new THREE.MeshPhysicalMaterial({color:0x126933}),edge=new THREE.MeshStandardMaterial({color:0x92734b}),board=new THREE.Mesh(new THREE.BoxGeometry(2,2,1),[cap,edge]);
 const materialArray=board.material,mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xffaa00}),1);mesh.userData.records=[{net:'GND'}];mesh.setColorAt(0,new THREE.Color(0x20ff30));const colors=mesh.instanceColor;
 const appearance=createSelectionAppearance(THREE,()=>[board,mesh]);
 appearance.update(()=>false,true,{translucent:true});assert.notEqual(board.material,materialArray);
 for(const material of board.material){assert.equal(material.transparent,true);assert.equal(material.depthWrite,false);assert.equal(material.opacity,.14);const shader={fragmentShader:'#include <opaque_fragment>'};material.onBeforeCompile(shader);assert.match(shader.fragmentShader,/dot\(outgoingLight/);}
 assert.equal(mesh.material.transparent,true);assert.equal(mesh.instanceColor,colors);
 appearance.restore();assert.equal(board.material,materialArray);assert.equal(cap.opacity,1);assert.equal(cap.depthWrite,true);assert.equal(cap.transparent,false);assert.equal(mesh.instanceColor,colors);
});


test('part → full-net → part mode transitions never mutate saved source instance colors',{skip:!THREE},()=>{
 const material=new THREE.MeshStandardMaterial({color:0xffffff}),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,2);mesh.userData.records=[{id:'a'},{id:'b'}];mesh.setColorAt(0,new THREE.Color('#ff2040'));mesh.setColorAt(1,new THREE.Color('#20ff40'));const colors=mesh.instanceColor,bytes=[...colors.array];
 const appearance=createSelectionAppearance(THREE,()=>[mesh]);appearance.update(r=>r?.id==='a',true);appearance.update(()=>false,true,{translucent:true});appearance.update(r=>r?.id==='b',true);appearance.restore();
 assert.equal(mesh.instanceColor,colors);assert.deepEqual([...colors.array],bytes);assert.equal(mesh.material,material);
});

test('dense net inspection shares ordinary translucent materials and disposes each variant once',{skip:!THREE},()=>{
 const source=new THREE.MeshStandardMaterial({color:0x126933});
 const geometry=new THREE.BoxGeometry(2,2,1);
 const objects=Array.from({length:1000},()=>new THREE.Mesh(geometry,source));
 const appearance=createSelectionAppearance(THREE,()=>objects);
 appearance.update(()=>false,true,{translucent:true});
 const ghost=objects[0].material;
 assert.equal(ghost.opacity,.14);
 assert.equal(objects.every(object=>object.material===ghost),true);
 let disposed=0;
 ghost.addEventListener('dispose',()=>disposed++);
 appearance.update(()=>false,true,{translucent:true});
 assert.equal(objects.every(object=>object.material===ghost),true);
 appearance.restore();
 assert.equal(objects.every(object=>object.material===source),true);
 assert.equal(disposed,1);
 geometry.dispose();source.dispose();
});

test('unselected footprint stand-ins fade like linked models while selected instances retain their color',{skip:!THREE},()=>{
 const material=new THREE.MeshStandardMaterial({color:0x556678});
 const geometry=new THREE.BoxGeometry();
 const standIns=new THREE.InstancedMesh(geometry,material,2);
 standIns.userData.footprintStandIns=true;
 standIns.userData.records=[{type:'Component',ref:'U1'},{type:'Component',ref:'U2'}];
 standIns.setColorAt(0,new THREE.Color(0xff8855));
 standIns.setColorAt(1,new THREE.Color(0x88aaff));
 const sourceColors=standIns.instanceColor,matrices=standIns.instanceMatrix;
 const linked=new THREE.Mesh(geometry,material);linked.userData.record={type:'Component',ref:'U3'};
 const appearance=createSelectionAppearance(THREE,()=>[standIns,linked]);
 appearance.update(selectionMatcher({references:['U1']}),true);
 assert.equal(linked.material.opacity,.24);
 assert.equal(standIns.material.transparent,true);
 assert.equal(standIns.material.depthWrite,false);
 assert.deepEqual(standIns.instanceColor.array.slice(0,3),sourceColors.array.slice(0,3));
 assert.ok(standIns.instanceColor.array[3]<0);
 const shader={vertexShader:'#include <common>\n#include <color_vertex>',fragmentShader:'#include <common>\n#include <opaque_fragment>'};
 standIns.material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/if \(vNetContext > 0\.5\)[\s\S]*diffuseColor\.a \*= 0\.24/);
 appearance.update(selectionMatcher({references:['U2']}),true);
 assert.ok(standIns.instanceColor.array[0]<0);
 assert.deepEqual(standIns.instanceColor.array.slice(3),sourceColors.array.slice(3));
 appearance.restore();
 assert.equal(standIns.instanceColor,sourceColors);
 assert.equal(standIns.instanceMatrix,matrices);
 assert.equal(standIns.material,material);
 assert.equal(linked.material,material);
 geometry.dispose();material.dispose();standIns.dispose();
});
