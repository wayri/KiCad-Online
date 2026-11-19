/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createSceneResources} from '../extension/spike/sceneResources.mjs';
const require=createRequire(import.meta.url);
const location=['../extension/node_modules/three/build/three.cjs','../.vizdiff/build-deps/node_modules/three/build/three.cjs'].map(p=>new URL(p,import.meta.url)).find(existsSync);
assert.ok(location,'Scene resource checks require the pinned Three.js build dependency.');
const THREE=require(fileURLToPath(location));

test('2048 static model clones perform no repeated geometry-buffer accounting',()=>{
 const owner=createSceneResources(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),template=new THREE.Mesh(geometry,material);
 let reads=0,disposals=0;const attributes=geometry.attributes;
 Object.defineProperty(geometry,'attributes',{configurable:true,get(){reads++;return attributes;}});
 geometry.addEventListener('dispose',()=>disposals++);
 owner.retain(template,1024*1024);const initialReads=reads;
 for(let i=0;i<2048;i++)owner.retainClone(template.clone(),1024*1024);
 assert.equal(reads,initialReads,'retained shared geometry must not be rescanned for each occurrence');
 assert.equal(owner.stats().retainedResources,2);owner.dispose();owner.dispose();assert.equal(disposals,1);
});

test('resource accounting streams unique shared/interleaved/morph buffers and refreshes live resources',()=>{
 const owner=createSceneResources(),geometry=new THREE.BufferGeometry(),buffer=new Float32Array(24),interleaved=new THREE.InterleavedBuffer(buffer,6);
 geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(interleaved,3,3));geometry.morphAttributes.position=[new THREE.BufferAttribute(new Float32Array(buffer.buffer,0,12),3)];
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);owner.retain(mesh);assert.equal(owner.stats().retainedGeometryBytes,buffer.byteLength);
 geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(6),1));owner.retain(mesh);assert.equal(owner.stats().retainedGeometryBytes,buffer.byteLength+12);
 assert.throws(()=>owner.retain(mesh,buffer.byteLength),/memory budget/);owner.dispose();
});

test('clone-specific instancing buffers stay budgeted and newly added colors invalidate shared accounting',()=>{
 const owner=createSceneResources(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),template=new THREE.InstancedMesh(geometry,material,2);
 let templateDisposals=0,cloneDisposals=0;template.addEventListener('dispose',()=>templateDisposals++);owner.retain(template);
 const originalBytes=owner.stats().retainedGeometryBytes,clone=template.clone();clone.addEventListener('dispose',()=>cloneDisposals++);
 assert.throws(()=>owner.retainClone(clone,originalBytes),/memory budget/);assert.equal(templateDisposals,0);assert.equal(cloneDisposals,1);
 template.setColorAt(0,new THREE.Color(0xffffff));const ordinary=new THREE.Mesh(geometry,material);
 assert.throws(()=>owner.retainClone(ordinary,originalBytes),/memory budget/);
 assert.ok(owner.stats().retainedGeometryBytes>originalBytes);owner.dispose();assert.equal(templateDisposals,1);
});

test('shared accounting observes late texture dimensions and new tracked resources; closure releases late assets',()=>{
 const owner=createSceneResources(),geometry=new THREE.BoxGeometry(),texture=new THREE.Texture({width:1,height:1}),material=new THREE.MeshBasicMaterial({map:texture}),template=new THREE.Mesh(geometry,material);
 owner.retain(template);texture.source.data.width=100;
 assert.throws(()=>owner.retainClone(template.clone(),Infinity,16),/memory budget/);
 const extra=new THREE.BufferGeometry();extra.setAttribute('position',new THREE.BufferAttribute(new Float32Array(1000),1));owner.track(extra);
 assert.throws(()=>owner.retainClone(template.clone(),1000),/memory budget/);
 owner.dispose();let released=0;const late=new THREE.BoxGeometry();late.addEventListener('dispose',()=>released++);owner.retainClone(new THREE.Mesh(late,material));assert.equal(released,1);assert.equal(owner.stats().retainedResources,0);
});

test('budget rejection releases only new resources and never releases retained shared resources',()=>{
 const owner=createSceneResources(),shared=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),template=new THREE.Mesh(shared,material);owner.retain(template);
 const extra=new THREE.BoxGeometry(),group=new THREE.Group();group.add(template.clone(),new THREE.Mesh(extra,material));let oldDisposed=0,newDisposed=0;shared.addEventListener('dispose',()=>oldDisposed++);extra.addEventListener('dispose',()=>newDisposed++);
 assert.throws(()=>owner.retainClone(group,owner.stats().retainedGeometryBytes),/memory budget/);assert.equal(oldDisposed,0);assert.equal(newDisposed,1);owner.dispose();assert.equal(oldDisposed,1);
});

test('discarding a rejected decoded graph releases only resources not already owned by the scene',()=>{
 const owner=createSceneResources(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),shared=new THREE.Mesh(geometry,material);owner.retain(shared);
 const extra=new THREE.BoxGeometry(),texture=new THREE.Texture({width:1,height:1}),newMaterial=new THREE.MeshBasicMaterial({map:texture}),rejected=new THREE.Group();rejected.add(shared.clone(),new THREE.Mesh(extra,newMaterial));let freed=0,kept=0;
 for(const resource of [extra,texture,newMaterial])resource.addEventListener('dispose',()=>freed++);geometry.addEventListener('dispose',()=>kept++);
 owner.discard(rejected);owner.discard(rejected);assert.equal(freed,3);assert.equal(kept,0);assert.equal(owner.stats().retainedResources,2);owner.dispose();assert.equal(kept,1);
});
