/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
/* One owner for shared model buffers, materials and texture lifetime. */
export function createSceneResources() {
  let closed=false,revision=0,accountedRevision=-1,allocation=null;
  const retained=new Set(),disposed=new WeakSet(),dynamic=new Map();
  function estimateTextureBytes(resource){
    const source=resource.source?.data;let bytes=0;
    const imageBytes=image=>{if(Number.isFinite(image?.width)&&Number.isFinite(image?.height))bytes+=Math.ceil(image.width*image.height*4*(image.data?.BYTES_PER_ELEMENT||1)*(resource.generateMipmaps?4/3:1));};
    if(Array.isArray(source)){for(const image of source)imageBytes(image);}else imageBytes(source);
    return bytes;
  }
  function unchangedDynamic(){
    for(const [resource,state]of dynamic)if(resource.instanceMatrix?.array!==state.matrix||resource.instanceColor?.array!==state.color||resource.boneMatrices!==state.bones||resource.isTexture&&estimateTextureBytes(resource)!==state.textureBytes)return false;
    return true;
  }
  function track(resource){
    if(!resource||typeof resource!=='object'||typeof resource.dispose!=='function')return resource;
    if(closed)release(resource);else if(!retained.has(resource)){retained.add(resource);revision++;}
    return resource;
  }
  function release(resource){
    if(disposed.has(resource))return;
    disposed.add(resource);resource.dispose();
    if(resource.isTexture)resource.source?.data?.close?.();
  }
  function collect(root,sharedClone=false){
    const pending=new Set(),add=resource=>{if(resource&&typeof resource.dispose==='function'&&!retained.has(resource))pending.add(resource);};
    const materialResources=material=>{
      if(!material||sharedClone&&retained.has(material))return;
      for(const key in material)if(Object.hasOwn(material,key)&&material[key]?.isTexture)add(material[key]);
      add(material);
    };
    root?.traverse?.(object=>{
      if(object.isInstancedMesh)add(object);
      add(object.geometry);
      if(Array.isArray(object.material)){for(const material of object.material)materialResources(material);}else materialResources(object.material);
      if(object.skeleton)add(object.skeleton);
    });
    return pending;
  }
  function retain(root,maxGeometryBytes=Infinity,maxTextureBytes=Infinity,sharedClone=false){
    const pending=collect(root,sharedClone);
    // Three.js static clones share geometry/materials/textures. Only cloned
    // instancing buffers need registration; unchanged shared assets need no scan.
    const next=sharedClone&&!pending.size&&accountedRevision===revision&&unchangedDynamic()?allocation:snapshot(pending);
    if(!closed&&(next.retainedGeometryBytes>maxGeometryBytes||next.retainedTextureBytes>maxTextureBytes)){
      for(const resource of pending)release(resource);
      throw Error('Decoded model geometry or textures exceed this device’s memory budget.');
    }
    for(const resource of pending)track(resource);
    if(!closed){if(next!==allocation)rememberDynamic();allocation=next;accountedRevision=revision;}
    return root;
  }
  function rememberDynamic(){
    for(const resource of retained)if(resource.isInstancedMesh||resource.boneMatrices||resource.isTexture){
      let state=dynamic.get(resource);if(!state){state={};dynamic.set(resource,state);}
      state.matrix=resource.instanceMatrix?.array;state.color=resource.instanceColor?.array;state.bones=resource.boneMatrices;if(resource.isTexture)state.textureBytes=estimateTextureBytes(resource);
    }
  }
  function dispose(){if(closed)return;closed=true;for(const resource of retained)release(resource);retained.clear();dynamic.clear();allocation=null;accountedRevision=-1;}
  function snapshot(pending){
    const buffers=new Set();let geometryBytes=0,textures=0,textureBytes=0;
    const addArray=array=>{const buffer=array?.buffer;if(buffer&&!buffers.has(buffer)){buffers.add(buffer);geometryBytes+=buffer.byteLength;}};
    const inspect=resource=>{
      if(resource.isTexture){textures++;textureBytes+=estimateTextureBytes(resource);}
      if(resource.isInstancedMesh){addArray(resource.instanceMatrix?.array);addArray(resource.instanceColor?.array);}
      if(resource.boneMatrices)addArray(resource.boneMatrices);
      if(resource.isBufferGeometry){
        const inspectAttribute=attribute=>addArray(attribute?.array||attribute?.data?.array);
        for(const key in resource.attributes)if(Object.hasOwn(resource.attributes,key))inspectAttribute(resource.attributes[key]);
        for(const key in resource.morphAttributes)if(Object.hasOwn(resource.morphAttributes,key))for(const attribute of resource.morphAttributes[key])inspectAttribute(attribute);
        inspectAttribute(resource.index);
      }
    };
    for(const resource of retained)inspect(resource);
    if(pending)for(const resource of pending)inspect(resource);
    return{retainedResources:retained.size+(pending?.size||0),retainedGeometryBytes:geometryBytes,retainedTextures:textures,retainedTextureBytes:textureBytes};
  }
  return{track,retain,dispose,owns:resource=>retained.has(resource),stats:()=>snapshot(),discard(root){for(const resource of collect(root))release(resource);},
    // Only for clones of retained templates whose shared resources are unchanged.
    retainClone:(root,maxGeometryBytes,maxTextureBytes)=>retain(root,maxGeometryBytes,maxTextureBytes,true)};
}
