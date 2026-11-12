/** Reversible display offsets. Source geometry and saved selection identities stay intact. */
export function createExplodeView(THREE,plan,{maxGap=4}={}){
 const layers=[...(plan.layers||[])].filter(l=>typeof l.name==='string'&&Number.isFinite(l.z)).sort((a,b)=>b.z-a.z).slice(0,64),ranks=new Map(layers.map((l,i)=>[l.name,(layers.length-1)/2-i]));
 const positions=new WeakMap(),matrices=new WeakMap();let amount=0;
 const offset=layer=>(ranks.get(layer)||0)*maxGap*amount/100;
 const nearest=z=>layers.reduce((best,l)=>!best||Math.abs(l.z-z)<Math.abs(best.z-z)?l:best,null)?.name;
 function layer(object,name){if(!positions.has(object))positions.set(object,object.position.z);object.position.z=positions.get(object)+offset(name);object.updateMatrix?.();}
 function barrels(mesh,span){
  if(!mesh?.isInstancedMesh||!span||!(span.zMax>span.zMin))return;
  if(!matrices.has(mesh))matrices.set(mesh,mesh.instanceMatrix.array.slice());const original=matrices.get(mesh),low=offset(nearest(span.zMin)),high=offset(nearest(span.zMax)),scale=(span.zMax-span.zMin+high-low)/(span.zMax-span.zMin),matrix=new THREE.Matrix4(),stretch=new THREE.Vector3(1,1,scale);
  for(let i=0;i<mesh.count;i++){matrix.fromArray(original,i*16);matrix.elements[14]+=low;matrix.scale(stretch);mesh.setMatrixAt(i,matrix);}
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere?.();mesh.computeBoundingBox?.();
 }
 function overlay(group){group.traverse(object=>{if(!object.geometry)return;if(object.userData.explodeSpan)barrels(object,object.userData.explodeSpan);else layer(object,object.userData.layer||object.userData.record?.layer);});}
 return{offset,layer,barrels,overlay,set(value){if(!Number.isFinite(value))throw Error('Explode amount must be finite.');amount=Math.max(0,Math.min(100,value));return amount;},get:()=>amount,span:()=>maxGap*amount/100*Math.max(0,layers.length-1),layers:layers.map(l=>l.name)};
}
