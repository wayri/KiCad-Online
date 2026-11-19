/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
/** Keep shared decode promises only until the final saved occurrence consumes them.
 * This releases template object graphs, not shared scene-owned GPU resources. */
export function createModelTemplateCache(entries,keyFor=entry=>entry.assetKey||entry.path){
 const uses=new Map(),templates=new Map();
 for(const entry of entries){const key=keyFor(entry);uses.set(key,(uses.get(key)||0)+1);}
 return{get(entry,create){const key=keyFor(entry);if(!templates.has(key))templates.set(key,Promise.resolve().then(create));return templates.get(key);},
  isLastUse(entry){return uses.get(keyFor(entry))===1;},
  release(entry){const key=keyFor(entry),remaining=(uses.get(key)||0)-1;if(remaining>0)uses.set(key,remaining);else{uses.delete(key);templates.delete(key);}},
  clear(){uses.clear();templates.clear();},stats:()=>({templates:templates.size,remainingAssets:uses.size})};
}
