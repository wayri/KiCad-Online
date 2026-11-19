/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelGraphBudget,preflightModelGLB,modelDecodeConcurrency} from '../extension/spike/modelGraphBudget.mjs';
function glb(descriptor){const text=JSON.stringify(descriptor),json=Buffer.from(text+' '.repeat((4-text.length%4)%4)),bytes=Buffer.alloc(20+json.length);bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);return bytes;}
const root=()=>({children:[{children:[]},{children:[]}]});

test('assembly admission accepts the exact node budget and rejects before cloning without losing saved proxies',()=>{
 const budget=createModelGraphBudget(12),template=root(),proxies=[{id:'a'},{id:'b'},{id:'c'}];let clones=0;
 for(let i=0;i<2;i++)budget.admit(template,3,()=>{clones++;});
 assert.equal(clones,2);assert.equal(budget.stats().admittedNodes,12);
 assert.throws(()=>budget.admit(template,3,()=>assert.fail('Rejected occurrence cloned its graph.')),/proxies and identities/);
 assert.deepEqual(proxies.map(p=>p.id),['a','b','c']);assert.equal(budget.stats().rejectedOccurrences,1);
 const fresh=createModelGraphBudget(6);assert.throws(()=>fresh.admit(template,3,()=>{throw Error('clone failed');}),/clone failed/);assert.equal(fresh.stats().admittedNodes,0);
});

test('oversized templates are rejected by bounded traversal and exact-size templates pass',()=>{
 const budget=createModelGraphBudget(3);assert.equal(budget.checkTemplate(root()),3);
 assert.throws(()=>budget.checkTemplate({children:[root()]}),/node budget/);assert.equal(budget.stats().rejectedTemplates,1);
 const occupied=createModelGraphBudget(6);occupied.admit(root(),0,()=>{});assert.throws(()=>occupied.checkTemplate(root(),1),/node budget/);assert.equal(occupied.stats().rejectedTemplates,1);
});

test('GLB preflight rejects declared and expanded scene graphs before the loader allocates them',()=>{
 const descriptor={nodes:[{children:[1,2]},{},{}],scenes:[{nodes:[0]}]},exact=glb(descriptor);
 assert.equal(preflightModelGLB(exact,4),4);
 let parsed=false;assert.throws(()=>{preflightModelGLB(exact,3);parsed=true;},/node budget/);assert.equal(parsed,false);
 const meshes=glb({nodes:[{mesh:0}],meshes:[{primitives:[{},{}]}],scenes:[{nodes:[0]}]});assert.equal(preflightModelGLB(meshes,4),4);assert.throws(()=>preflightModelGLB(meshes,3),/node budget/);
 const cyclic=glb({nodes:[{children:[0]}],scenes:[{nodes:[0]}]});assert.throws(()=>preflightModelGLB(cyclic,32),/node budget/);
 assert.throws(()=>preflightModelGLB(glb({...descriptor,buffers:[{uri:'external.bin'}]}),20),/external dependency/);
 assert.throws(()=>preflightModelGLB(glb({nodes:[{}],scenes:[{nodes:[5]}]}),20),/invalid node/);
});

test('decode concurrency drops for constrained devices and assemblies above 512 components',()=>{
 assert.equal(modelDecodeConcurrency(false,512),3);assert.equal(modelDecodeConcurrency(false,513),1);assert.equal(modelDecodeConcurrency(true,10),1);
});
