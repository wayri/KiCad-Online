/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import {preflightGLBAllocations} from './glbAllocationBudget.mjs';
export const modelDecodeConcurrency=(constrained,components)=>constrained||components>512?1:3;
const exceeded=()=>Object.assign(Error('Linked model graph exceeds the bounded assembly node budget; saved footprint proxies and identities are retained.'),{code:'MODEL_GRAPH_BUDGET'});

/** Bound model Object3D growth before cloning. No saved component is removed. */
export function createModelGraphBudget(limit){
 if(!Number.isSafeInteger(limit)||limit<1)throw TypeError('Choose a positive model node budget.');
 const counts=new WeakMap();let admitted=0,rejectedTemplates=0,rejectedOccurrences=0;
 function count(root){
  if(counts.has(root))return counts.get(root);
  const stack=[root];let nodes=0;
  while(stack.length){const object=stack.pop();if(++nodes>limit)throw exceeded();for(const child of object.children||[]){if(nodes+stack.length>=limit)throw exceeded();stack.push(child);}}
  counts.set(root,nodes);return nodes;
 }
 return {limit,checkTemplate(root,wrappers=0){try{const nodes=count(root);if(admitted+nodes+wrappers>limit)throw exceeded();return nodes;}catch(error){if(error.code==='MODEL_GRAPH_BUDGET')rejectedTemplates++;throw error;}},
  rejectPreflight(){rejectedTemplates++;},
  admit(root,wrappers,attach){const nodes=count(root)+wrappers;if(admitted+nodes>limit){rejectedOccurrences++;throw exceeded();}const result=attach();admitted+=nodes;return result;},
  stats:()=>({limit,admittedNodes:admitted,rejectedTemplates,rejectedOccurrences})};
}

/** Count every scene graph GLTFLoader may construct, including primitive meshes,
 * before asking it to allocate Three.js objects. Dependencies remain embedded. */
export function preflightModelGLB(bytes,limit,allocationLimits){
 if(bytes.byteLength<20)throw Error('GLB has an external dependency or invalid header');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(12,true);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength||view.getUint32(16,true)!==0x4e4f534a||length>bytes.byteLength-20)throw Error('GLB has an external dependency or invalid header');
 const descriptor=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+length)));
 for(const list of [descriptor.buffers||[],descriptor.images||[]])for(const item of list)if(item.uri&&!/^data:/i.test(item.uri))throw Error('GLB has an external dependency or invalid header');
 preflightGLBAllocations(descriptor,bytes,20+length,allocationLimits);
 const nodes=descriptor.nodes||[],scenes=descriptor.scenes||[],meshes=descriptor.meshes||[];let total=scenes.length;
 if(nodes.length>limit||total>limit)throw exceeded();
 const stack=[];
 for(const scene of scenes){
  for(const id of scene.nodes||[]){if(total+stack.length>=limit)throw exceeded();stack.push(id);}
  while(stack.length){
   const id=stack.pop(),node=nodes[id];if(!Number.isInteger(id)||!node)throw Error('GLB references an invalid node.');
   let cost=1;
   if(node.mesh!==undefined){const mesh=meshes[node.mesh];if(!mesh||!Array.isArray(mesh.primitives))throw Error('GLB references an invalid mesh.');if(mesh.primitives.length>1)cost+=mesh.primitives.length;}
   // Mesh+camera/skin attachments can introduce an extra container. Counting
   // one camera attachment conservatively also covers extension-owned cameras.
   if(node.camera!==undefined)cost++;
   if(node.extensions?.KHR_lights_punctual)cost+=2;
   total+=cost;if(total>limit)throw exceeded();
   for(const child of node.children||[]){if(total+stack.length>=limit)throw exceeded();stack.push(child);}
  }
 }
 return total;
}
