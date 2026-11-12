/** Selected-net copper is independent of display filters and outline budgets.
 * Context stays in its original scene; this owned overlay is rebuilt only when
 * the exact selected net set changes. Saved XY coordinates are never altered.
 */
import {selectionNetNames} from './selectionState.mjs';
import {smoothPadOutline as nativePadOutline,copperStrokeBatches,smoothDrillOutline,drillWallGeometry} from './copperGeometry.mjs';

export function createNetInspection(THREE,{board,plan,zones,pads,world,colorForLayer,sourceLimited=false}) {
 const group=new THREE.Group();group.name='Selected net — all copper layers';group.visible=false;
 const emptyState=()=>({active:false,nets:[],tracks:0,pads:0,vias:0,platedPads:0,fills:0,boundaries:0,omitted:0,sourceLimited:false,warnings:[]});let signature='',state=emptyState();
 const resources=new Set(),materials=new Map(),budget=200000;let colorMode='layer';
 const color=layer=>colorMode==='layer'?colorForLayer(layer):0xffe18b;
 const tagMaterial=(m,layer)=>{m.userData.netLayer=layer;return m;};
 function setColorMode(value){const next=value==='accent'?'accent':'layer';if(next===colorMode)return; colorMode=next;for(const m of resources)if(m.isMaterial&&m.userData.netLayer)m.color.set(color(m.userData.netLayer));}
 const material=layer=>{if(materials.has(layer))return materials.get(layer);const m=tagMaterial(new THREE.MeshBasicMaterial({color:color(layer),side:THREE.DoubleSide,toneMapped:false}),layer);resources.add(m);materials.set(layer,m);return m;};
 const shapeFor=outline=>{const shape=new THREE.Shape(outline.outline.map(([x,y])=>new THREE.Vector2(x,-y)));if(outline.drill)shape.holes.push(new THREE.Path(outline.drill.map(([x,y])=>new THREE.Vector2(x,-y))));return shape;};
 function clear(){for(const resource of resources)resource.dispose();resources.clear();materials.clear();group.clear();group.visible=false;signature='';state=emptyState();}
 function instances(geometry,records,layer,place){
  if(!records.length){geometry.dispose();return;}resources.add(geometry);const mesh=new THREE.InstancedMesh(geometry,material(layer),records.length),object=new THREE.Object3D();
  records.forEach((record,index)=>{object.position.set(0,0,0);object.rotation.set(0,0,0);object.scale.set(1,1,1);place(object,record,index);object.updateMatrix();mesh.setMatrixAt(index,object.matrix);});
  resources.add(mesh);mesh.userData.layer=layer;mesh.userData.records=records.map(record=>record.track||record);mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);return mesh;
 }
 function update(selection={},enabled=true){
  const nets=[...selectionNetNames(selection,board)].sort(),key=JSON.stringify(nets);
  if(!enabled||!nets.length){if(signature)clear();state=emptyState();return snapshot();}
  if(key===signature){group.visible=state.active;return snapshot();}
  clear();signature=key;state={active:false,nets,tracks:0,pads:0,vias:0,platedPads:0,fills:0,boundaries:0,omitted:0,sourceLimited,warnings:[...plan.warnings]};
  if(sourceLimited)state.warnings.push('Saved zone geometry reached its polygon/point budget; additional copper is omitted.');
  const wanted=new Set(nets);let used=0,geometryBatches=0;const shapeBudget=()=>{if(geometryBatches>=512){state.omitted++;return false;}geometryBatches++;return true;};const take=record=>{if(!wanted.has(record.net))return false;if(used++>=budget){state.omitted++;return false;}return true;};
  for(const layer of plan.layers){
   const thickness=Math.max(.001,layer.thickness),z=layer.z;
   const tracks=board.tracks.filter(track=>track.layer===layer.name&&take(track)),stroke=copperStrokeBatches(THREE,tracks,{world,z,thickness});state.tracks+=stroke.tracks.length;state.omitted+=stroke.invalid;
   if(stroke.plan?.limited)state.warnings.push(`${layer.name}: track cap tessellation reached its 128-segment display limit.`);
   for(const batch of stroke.batches)instances(batch.geometry,batch.records,layer.name,batch.place);
   const batches=new Map();
   for(const pad of pads){
    if(!wanted.has(pad.net)||pad.nativeType==='np_thru_hole'||!(pad.layer===layer.name||pad.layers?.includes(layer.name)||pad.layers?.includes('*.Cu')||pad.layers?.includes('F&B.Cu')&&['F.Cu','B.Cu'].includes(layer.name)))continue;
    if(!take(pad))continue;const outline=nativePadOutline(pad);if(!outline){state.omitted++;continue;}
    const key=JSON.stringify(outline);if(!batches.has(key)){if(!shapeBudget())continue;batches.set(key,{outline,pads:[]});}batches.get(key).pads.push(pad);state.pads++;
   }
   for(const batch of batches.values())instances(new THREE.ExtrudeGeometry(shapeFor(batch.outline),{depth:thickness,bevelEnabled:false,curveSegments:8}),batch.pads,layer.name,(object,pad)=>{const[x,y]=world(pad.at);object.position.set(x,y,z-thickness/2);object.rotation.z=(pad.rotation||0)*Math.PI/180;});
   for(const zone of zones){
    if(zone.layer!==layer.name||!take(zone)||!shapeBudget())continue;
    const points=zone.points.map(point=>{const[x,y]=world(point);return new THREE.Vector2(x,y);});
    if(!zone.filled){const geo=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,p.y,z))),mat=tagMaterial(new THREE.LineBasicMaterial({color:color(layer.name),toneMapped:false}),layer.name);resources.add(geo);resources.add(mat);const line=new THREE.LineLoop(geo,mat);line.userData.record={...zone,type:'Zone boundary'};group.add(line);state.boundaries++;continue;}
    const geometry=new THREE.ExtrudeGeometry(new THREE.Shape(points),{depth:thickness,bevelEnabled:false,curveSegments:8});resources.add(geometry);const fillMaterial=material(layer.name).clone();fillMaterial.transparent=true;fillMaterial.opacity=.28;fillMaterial.depthWrite=false;resources.add(fillMaterial);const mesh=new THREE.Mesh(geometry,fillMaterial);mesh.userData.record={...zone,type:'Zone'};mesh.position.z=z-thickness/2;group.add(mesh);state.fills++;
   }
  }
  state.omitted+=board.tracks.filter(record=>wanted.has(record.net)&&!plan.byLayer.has(record.layer)).length+zones.filter(record=>wanted.has(record.net)&&!plan.byLayer.has(record.layer)).length;
  const barrels=new Map(),annuli=new Map();
  function barrel(record,span,pad=false){
   const width=pad?(record.drillWidth||record.drill):record.drill,height=pad?(record.drillHeight||record.drill):record.drill;
   if(!(width>0&&height>0)||!span||span.zMax<=span.zMin){state.omitted++;return;}
   // A zero-thickness wall follows the saved bore; plating thickness is unknown.
   const outline=smoothDrillOutline({drill:record.drill,drillWidth:width,drillHeight:height,drillShape:width===height?'circle':'oval'});
   if(!outline){state.omitted++;return;}const key=JSON.stringify([outline,span.zMin,span.zMax,span.from]);
   if(!barrels.has(key)){if(!shapeBudget())return;barrels.set(key,{outline,span,records:[]});}barrels.get(key).records.push(record);
  }
  for(const via of board.vias){if(!take(via))continue;const span=plan.viaSpans.get(via.id);if(!span){state.omitted++;continue;}barrel(via,span);state.vias++;
   // Annuli exist only at the saved span endpoints, never outside blind/buried spans.
   for(const name of new Set([span.from,span.to])){const layer=plan.byLayer.get(name),outline=nativePadOutline({shape:'circle',width:via.size,height:via.size,drill:via.drill,drillShape:'circle'});if(!layer||!outline)continue;
    const key=JSON.stringify([name,outline]);if(!annuli.has(key)){if(!shapeBudget())continue;annuli.set(key,{outline,layer,records:[]});}annuli.get(key).records.push(via);
   }
  }
  for(const pad of pads){if(pad.nativeType!=='thru_hole'||!(pad.drill>0)||!take(pad))continue;const front=plan.byLayer.get('F.Cu'),back=plan.byLayer.get('B.Cu');if(!front||!back)continue;barrel(pad,{zMin:back.z,zMax:front.z,from:'F.Cu',to:'B.Cu'},true);state.platedPads++;}
  for(const batch of annuli.values())instances(new THREE.ExtrudeGeometry(shapeFor(batch.outline),{depth:batch.layer.thickness,bevelEnabled:false,curveSegments:8}),batch.records,batch.layer.name,(object,record)=>{const[x,y]=world(record.at);object.position.set(x,y,batch.layer.z-batch.layer.thickness/2);});
  for(const batch of barrels.values()){const mesh=instances(drillWallGeometry(THREE,batch.outline,batch.span.zMax-batch.span.zMin),batch.records,batch.span.from,(object,record)=>{const[x,y]=world(record.at);object.rotation.z=(record.rotation||0)*Math.PI/180;const[dx,dy]=record.drillOffset||[0,0],c=Math.cos(object.rotation.z),s=Math.sin(object.rotation.z);object.position.set(x+dx*c+dy*s,y+dx*s-dy*c,batch.span.zMin);});if(mesh)mesh.userData.explodeSpan=batch.span;}
  state.active=state.tracks+state.pads+state.vias+state.platedPads+state.fills+state.boundaries>0;group.visible=state.active;
  if(state.boundaries)state.warnings.push('Unfilled saved zones are boundary-only; no copper fill is inferred.');
  if(state.vias||state.platedPads)state.warnings.push('Saved drill wall surfaces and layer spans are shown; plating thickness is not inferred.');
  if(state.omitted)state.warnings.push(`${state.omitted} selected primitives were omitted because saved geometry was unsupported or the display budget was reached.`);
  return snapshot();
 }
 function snapshot(){return {...state,colorMode,nets:[...state.nets],warnings:[...state.warnings],layers:plan.layers.map(({name,z})=>({name,z})),meshes:group.children.length};}
 return {group,update,setColorMode,clear,dispose:clear,state:snapshot};
}
