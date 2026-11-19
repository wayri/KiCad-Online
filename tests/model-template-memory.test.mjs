/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelTemplateCache} from '../extension/spike/modelTemplates.mjs';

test('concurrent repeated occurrences share decoding and release only their final template reference',async()=>{
 const a={path:'a.wrl'},b={path:'b.wrl'},cache=createModelTemplateCache([a,b,a]);let count=0,finish;
 const first=cache.get(a,()=>{count++;return new Promise(resolve=>finish=resolve);}),second=cache.get(a,()=>assert.fail('Repeat decoded again.'));
 assert.equal(first,second);await Promise.resolve();finish({name:'template'});assert.equal(await first,await second);assert.equal(count,1);
 assert.equal(cache.isLastUse(a),false);cache.release(a);assert.equal(cache.isLastUse(a),true);assert.equal(cache.stats().templates,1);
 await cache.get(b,()=>({name:'other'}));cache.release(b);assert.equal(cache.stats().templates,1,'completed unique asset template drops before other assets finish');
 cache.release(a);assert.deepEqual(cache.stats(),{templates:0,remainingAssets:0});
});

test('last-use handoff adopts one decoded object graph per asset without changing earlier occurrences',async()=>{
 const a={path:'a'},b={path:'b'},entries=[a,a,a,b],cache=createModelTemplateCache(entries),templates=new Map();let clones=0;
 const occurrences=[];
 for(const [index,entry]of entries.entries()){
  const template=await cache.get(entry,()=>{const root={record:null,clone(){clones++;return {record:null};}};templates.set(entry.path,root);return root;});
  const graph=cache.isLastUse(entry)?template:template.clone();graph.record='component-'+index;occurrences.push(graph);cache.release(entry);
 }
 assert.equal(clones,2);assert.equal(occurrences[2],templates.get('a'));assert.equal(occurrences[3],templates.get('b'));
 assert.deepEqual(occurrences.map(root=>root.record),['component-0','component-1','component-2','component-3']);assert.equal(cache.stats().templates,0);
});

test('failed decodes are shared and remaining canceled occurrences can be cleared without resource disposal',async()=>{
 const a={assetKey:'embedded:1:x',path:'x'},cache=createModelTemplateCache([a,a]);let calls=0;
 await assert.rejects(cache.get(a,()=>{calls++;throw Error('decode failed');}),/decode failed/);cache.release(a);
 await assert.rejects(cache.get(a,()=>assert.fail()),/decode failed/);assert.equal(calls,1);cache.release(a);assert.deepEqual(cache.stats(),{templates:0,remainingAssets:0});
 const source={dispose(){assert.fail('Template lifetime must not dispose shared scene resources.');}};await cache.get(a,()=>source);cache.clear();assert.equal(cache.stats().templates,0);
});
