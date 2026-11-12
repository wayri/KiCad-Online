/** Geometry-faithful selection tint; no bounds wireframes or source-buffer copies. */
export function createSelectionGeometry(THREE,{scene,objects,limit=2000,dark=true}){
 const group=new THREE.Group();group.name='Selected source geometry';scene.add(group);
 const material=new THREE.MeshBasicMaterial({color:dark?0x4de3ee:0x007b91,transparent:true,opacity:.42,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-16}),matrix=new THREE.Matrix4(),local=new THREE.Matrix4();let disposed=false;
 const layerMaterials=new Map();
 function clear(){group.clear();group.visible=false;}
 function update(matches,{colorForRecord}={}){
  clear();if(disposed)return{highlighted:0,matched:0,limited:false};let matched=0,highlighted=0;
  const append=(object,index,record)=>{if(index!==undefined){object.getMatrixAt(index,local);if(local.determinant()===0)return;}matched++;if(highlighted>=limit)return;object.updateWorldMatrix(true,false);if(index!==undefined)matrix.multiplyMatrices(object.matrixWorld,local);else matrix.copy(object.matrixWorld);const color=colorForRecord?.(record);let tint=material;if(color!=null){if(!layerMaterials.has(color)){const owned=material.clone();owned.color.set(color);layerMaterials.set(color,owned);}tint=layerMaterials.get(color);}const mesh=new THREE.Mesh(object.geometry,tint);mesh.matrix.copy(matrix);mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;mesh.renderOrder=101;group.add(mesh);highlighted++;};
  for(const object of objects()){
   if(!object.isMesh||!object.geometry)continue;let visible=true;for(let parent=object;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}if(!visible)continue;
   const records=object.userData.records;if(object.isInstancedMesh&&records){for(let index=0;index<Math.min(records.length,object.count);index++)if(matches(records[index]))append(object,index,records[index]);}else if(matches(object.userData.record))append(object,undefined,object.userData.record);
  }
  group.visible=highlighted>0;return{highlighted,matched,limited:matched>highlighted};
 }
 return{group,update,clear,setTheme(value){material.color.setHex(value?0x4de3ee:0x007b91);},dispose(){if(disposed)return;disposed=true;clear();scene.remove(group);material.dispose();for(const owned of layerMaterials.values())owned.dispose();layerMaterials.clear();}};
}
