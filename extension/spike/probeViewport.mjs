import {createExplodeView} from './explodeView.mjs';
import {projectionCamera,resizeProjection,fitProjection} from './cameraProjection.mjs';
import {selectionMatcher,selectionNetNames,selectableRecord,tapGesture} from './selectionState.mjs';
import {boardViewPresets,boardViewPreset} from './viewPresets.mjs';
import {boxFitDistance} from './fitPolicy.mjs';
import {probeViewportPlan,boardClipRange} from './renderQuality.mjs';
import {createTerminalAnnotations} from './terminalLabels.mjs';
import {createNetInspection} from './netInspection.mjs';

export function probeLayerVisible(record,layers){
 if(!layers||!record)return true;
 const source=Array.isArray(record.layers)&&record.layers.length?record.layers:record.layer?[record.layer]:[];
 if(!source.length)return true; // Board substrate and unlayered model context.
 return source.some(layer=>layers.has(layer)||layer==='*.Cu'&&[...layers].some(name=>name.endsWith('.Cu'))||layer==='*.Mask'&&[...layers].some(name=>name.endsWith('.Mask')));
}

/** Main scene plus two probes is the bounded three-context budget. */
export function createProbeRegistry(limit=2){
 const entries=new Set();let closed=false,reserved=0;
 return {
  create(factory){
   if(closed)throw Error('The parent 3D scene is closed.');
   if(entries.size+reserved>=limit)throw Error('The interactive 3D probe limit ('+limit+') is reached. Close a 3D probe or switch it to a 2D view.');
   reserved++;let api;try{api=factory();}finally{reserved--;}
   const original=api.dispose;let disposed=false;
   api.dispose=()=>{if(disposed)return;disposed=true;try{original.call(api);}finally{entries.delete(api);}};
   entries.add(api);return api;
  },
  sourceAdded(node){for(const api of entries)api.sourceAdded(node);},
  forEach(callback){for(const api of entries)callback(api);},
  dispose(){if(closed)return;closed=true;for(const api of [...entries])api.dispose();},
  size(){return entries.size;}
 };
}

/** Clone transforms and visibility, retaining shared source buffers and records.
 * Avoid Object3D.clone's JSON copy of large userData.records and InstancedMesh's
 * duplicate instance arrays. Shared resources are read-only and never disposed. */
export function cloneProbeTree(THREE,source,{materialFor=node=>node.material,instanceColorFor=node=>node.instanceColor}={}){
 let mapping=new WeakMap();const pickables=[];
 function clone(node){
  let copy;
  if(node.isInstancedMesh){copy=new THREE.InstancedMesh(node.geometry,materialFor(node),0);copy.count=node.count;copy.instanceMatrix=node.instanceMatrix;copy.instanceColor=instanceColorFor(node);copy.boundingBox=node.boundingBox;copy.boundingSphere=node.boundingSphere;copy.morphTexture=node.morphTexture;}
  else if(node.isMesh)copy=new THREE.Mesh(node.geometry,materialFor(node));
  else if(node.isLineSegments)copy=new THREE.LineSegments(node.geometry,materialFor(node));
  else if(node.isLineLoop)copy=new THREE.LineLoop(node.geometry,materialFor(node));
  else if(node.isLine)copy=new THREE.Line(node.geometry,materialFor(node));
  else if(node.isPoints)copy=new THREE.Points(node.geometry,materialFor(node));
  else if(node.isSprite)copy=new THREE.Sprite(materialFor(node));
  else copy=new THREE.Group();
  copy.name=node.name;copy.position.copy(node.position);copy.quaternion.copy(node.quaternion);copy.scale.copy(node.scale);copy.matrix.copy(node.matrix);copy.matrixAutoUpdate=node.matrixAutoUpdate;copy.visible=node.visible;copy.renderOrder=node.renderOrder;copy.frustumCulled=node.frustumCulled;copy.layers.mask=node.layers.mask;copy.userData=node.userData;
  mapping.set(node,copy);if(node.geometry&&(node.userData.records||node.userData.record))pickables.push(copy);
  for(const child of node.children)copy.add(clone(child));return copy;
 }
 const root=clone(source);
 return {root,pickables,copyOf:node=>mapping.get(node),syncTransforms(){source.traverse(node=>{const copy=mapping.get(node);if(!copy)return;copy.position.copy(node.position);copy.quaternion.copy(node.quaternion);copy.scale.copy(node.scale);copy.matrix.copy(node.matrix);if(node.isInstancedMesh){copy.boundingBox=node.boundingBox;copy.boundingSphere=node.boundingSphere;}});},sourceAdded(node){
  const pending=[];for(let current=node;current&&!mapping.has(current);current=current.parent)pending.unshift(current);
  if(!pending.length)return false;
  const first=pending[0],parent=mapping.get(first.parent);if(!parent)return false;parent.add(clone(first));return true;
 },release(){root.clear();pickables.length=0;mapping=new WeakMap();}};
}

// Own only generated overlay buffers. Saved records/stackup remain read-only and shared.
export function createProbeNetInspection(THREE,source,{maxRecords=8192,maxZonePoints=32768}={}){
 if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>8192||!Number.isInteger(maxZonePoints)||maxZonePoints<3||maxZonePoints>32768)throw Error('Invalid probe copper budget.');
 const group=new THREE.Group();group.name='Probe selected net — all copper layers';let current=null,signature='',omitted=0,pointsOmitted=0,colorMode='layer';
 const state=()=>{const result=current?.state()||{active:false,nets:[],tracks:0,pads:0,vias:0,platedPads:0,fills:0,boundaries:0,omitted:0,sourceLimited:false,warnings:[],layers:source.plan.layers.map(({name,z})=>({name,z})),meshes:0};return {...result,omitted:result.omitted+omitted,sourceLimited:result.sourceLimited||omitted>0,warnings:[...result.warnings,...(omitted?[`${omitted} selected source records omitted by the probe copper budget (${maxRecords} records / ${maxZonePoints} zone points); ${pointsOmitted} exceeded the zone-point budget.`]:[])],maxRecords,maxZonePoints};};
 function clear(){current?.dispose();current=null;group.clear();signature='';omitted=0;pointsOmitted=0;}
 function update(selection={},enabled=true){
  const nets=[...selectionNetNames(selection,source.board)].sort(),key=JSON.stringify(nets);if(!enabled||!nets.length){clear();return state();}if(key===signature)return state();clear();signature=key;
  const wanted=new Set(nets);let used=0,points=0;const take=(records,zones=false)=>{const result=[];for(const record of records||[]){if(!wanted.has(record.net))continue;if(used>=maxRecords){omitted++;continue;}if(zones){const count=record.points?.length||0;if(points+count>maxZonePoints){omitted++;pointsOmitted++;continue;}points+=count;}used++;result.push(record);}return result;};
  const tracks=take(source.board.tracks),pads=take(source.pads),vias=take(source.board.vias),zones=take(source.zones,true);
  current=createNetInspection(THREE,{...source,board:{...source.board,tracks,pads,vias},pads,zones,sourceLimited:source.sourceLimited||omitted>0});current.setColorMode(colorMode);group.add(current.group);current.update(selection,true);return state();
 }
 return {group,update,state,setColorMode(value){colorMode=value==='accent'?'accent':'layer';current?.setColorMode(colorMode);},dispose:clear};
}

export function createSharedProbeViewport({THREE,OrbitControls,host,source,sourceScene,sourceRenderer,board,materialFor,instanceColorFor,selection={},selectionMode='all',orthographic=false,explodeAmount=0,netHighlightColor='layer',dark=true,onSelect,onViewChange,terminalSource,netInspectionSource,showNetNames=false,showTerminalNumbers,raf=requestAnimationFrame,caf=cancelAnimationFrame,Observer=ResizeObserver}){
 if(!host?.append)throw Error('A connected probe viewport host is required.');
 const explosion=createExplodeView(THREE,netInspectionSource?.plan||{layers:[]});explosion.set(explodeAmount);
 const tree=cloneProbeTree(THREE,source,{materialFor,instanceColorFor}),scene=new THREE.Scene();scene.background=new THREE.Color(dark?0x151820:0xe7ebf1);scene.add(tree.root);
 const netInspection=netInspectionSource?createProbeNetInspection(THREE,netInspectionSource):null;if(netInspection){netInspection.setColorMode(netHighlightColor);scene.add(netInspection.group);}let netStatus=null;
 // Reuse light settings, not shadow targets or GPU-generated PMREM targets,
 // which belong to the main context. No new shadow/AO/environment targets.
 for(const light of sourceScene.children.filter(node=>node.isLight)){const copy=light.clone();copy.castShadow=false;scene.add(copy);}
 let camera=new THREE.PerspectiveCamera(45,1,.01,10000);camera.up.set(0,0,1);camera.position.set(30,-40,60);
 const clipCenter=new THREE.Vector3();let clipRadius=1;let renderer,controls,observer,alive=true,frame=0,contextLost=false,currentSelection=selection,selectionDim=true,mode=selectionMode,selectionBounds=null,selectionPoint=null,selectionStats={matched:0,highlighted:0,limited:false},terminalAnnotations=null,terminalStatus=null;
 const overlayMaterial=new THREE.MeshBasicMaterial({color:dark?0x4de3ee:0x007b91,transparent:true,opacity:.65,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}),overlay=new THREE.Group();overlay.name='probe-selected-geometry';scene.add(overlay);
 const layerMaterials=new Map();
 function selectedMaterial(record){const layer=record?.layer;if(netHighlightColor!=='layer'||!layer||typeof netInspectionSource?.colorForLayer!=='function')return overlayMaterial;if(!layerMaterials.has(layer)){if(layerMaterials.size>=64)return overlayMaterial;const material=overlayMaterial.clone();material.color.set(netInspectionSource.colorForLayer(layer));layerMaterials.set(layer,material);}return layerMaterials.get(layer);}
 const dimMaterial=new THREE.MeshBasicMaterial({color:0x80858c,transparent:true,opacity:.2,depthWrite:false,side:THREE.DoubleSide}),dimLineMaterial=new THREE.LineBasicMaterial({color:0x80858c,transparent:true,opacity:.2,depthWrite:false}),normalMaterials=new WeakMap(),normalInstanceColors=new WeakMap();
 const matrix=new THREE.Matrix4(),local=new THREE.Matrix4(),box=new THREE.Box3(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),gesture=tapGesture();
 const visible=node=>{for(let n=node;n;n=n.parent)if(!n.visible)return false;return true;};
 let visibleLayers=null;const sourceVisibility=new WeakMap(),sourceMatrices=new WeakMap(),filteredMatrices=new WeakMap(),zeroMatrix=new THREE.Matrix4().makeScale(0,0,0);
 function applyLayers(){
  for(const group of [tree.root,netInspection?.group].filter(Boolean))group.traverse(object=>{
   if(!sourceVisibility.has(object))sourceVisibility.set(object,object.visible);
   const records=object.userData.records||[object.userData.record].filter(Boolean),allowed=records.map(record=>probeLayerVisible(record,visibleLayers));
   object.visible=sourceVisibility.get(object)&&(!records.length||allowed.some(Boolean));
   if(object.isInstancedMesh&&records.length===object.count){
    if(!sourceMatrices.has(object))sourceMatrices.set(object,object.instanceMatrix);
    const original=sourceMatrices.get(object);
    if(allowed.every(Boolean)){object.instanceMatrix=original;return;}
    let filtered=filteredMatrices.get(object);if(!filtered){filtered=original.clone();filteredMatrices.set(object,filtered);}filtered.array.set(original.array);object.instanceMatrix=filtered;
    allowed.forEach((show,index)=>{if(!show)object.setMatrixAt(index,zeroMatrix);});filtered.needsUpdate=true;
   }
  });
 }
 function invalidate(){if(alive&&!contextLost&&!frame)frame=raf(paint);}
 function updateSceneBounds(){tree.root.updateWorldMatrix(true,true);const sphere=new THREE.Box3().setFromObject(tree.root).getBoundingSphere(new THREE.Sphere());if(Number.isFinite(sphere.radius)&&sphere.radius>0){clipRadius=sphere.radius;clipCenter.copy(sphere.center);}}
 function paint(){frame=0;if(!alive||contextLost)return;controls.update();const clip=boardClipRange(camera.position.distanceTo(controls.target),clipRadius+clipCenter.distanceTo(controls.target));camera.near=clip.near;camera.far=clip.far;camera.updateProjectionMatrix();terminalAnnotations?.update();renderer.render(scene,camera);onViewChange?.();}
 function resize(){if(!alive)return;const w=Math.max(1,host.clientWidth||320),h=Math.max(1,host.clientHeight||240),ratio=probeViewportPlan(w,h,globalThis.devicePixelRatio).ratio;renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);resizeProjection(camera,w/h);invalidate();}
 function selectedBounds(){
  const netState=netInspection?.update(currentSelection),netActive=netState?.active;if(netInspection){netInspection.group.traverse(object=>{if(object.isInstancedMesh&&sourceMatrices.has(object))object.instanceMatrix=sourceMatrices.get(object);});explosion.overlay(netInspection.group);}
  if(netStatus){netStatus.hidden=!netState?.nets.length;netStatus.textContent=netState?.nets.length?`Full net 3D: ${netState.tracks} rendered segments · ${netState.pads} pad surfaces · ${netState.vias} vias · ${netState.fills} fills${netState.omitted?`; ${netState.omitted} omitted`:""}. ${selectionDim?"Translucent grey":"Original color"} context.`:"";netStatus.title=netState?.warnings.join("\n")||"";}
  applyLayers();const matches=selectionMatcher(currentSelection,board);let matched=0,count=0;const union=new THREE.Box3();tree.root.updateWorldMatrix(true,true);overlay.clear();
  for(const object of tree.pickables){if(!visible(object))continue;const records=object.userData.records||[object.userData.record];
   for(let index=0;index<records.length;index++){if(!matches(records[index]))continue;if(object.isInstancedMesh){object.getMatrixAt(index,local);if(local.determinant()===0)continue;}matched++;if(netActive||count>=256)continue;
    if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();box.copy(object.geometry.boundingBox);if(object.isInstancedMesh)matrix.multiplyMatrices(object.matrixWorld,local);else matrix.copy(object.matrixWorld);box.applyMatrix4(matrix);
    if(box.isEmpty())continue;union.union(box);
    // Exact source geometry and instance transform, not a projected bounding box.
    // Geometry is shared read-only; only this lightweight object/material is ours.
    if(object.isMesh){const highlight=new THREE.Mesh(object.geometry,selectedMaterial(records[index]));highlight.matrix.copy(matrix);highlight.matrixAutoUpdate=false;highlight.frustumCulled=false;highlight.renderOrder=100;overlay.add(highlight);count++;}
   }
  }
  if(netActive){netInspection.group.updateWorldMatrix(true,true);netInspection.group.traverse(object=>{if(!object.geometry||!visible(object))return;if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();if(object.geometry.boundingBox)union.union(box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));});}
  selectionBounds=union.isEmpty()?null:union;tree.root.traverse(object=>{if(!object.material)return;if(!normalMaterials.has(object))normalMaterials.set(object,object.material);if(object.isInstancedMesh){if(!normalInstanceColors.has(object))normalInstanceColors.set(object,object.instanceColor);object.instanceColor=selectionBounds&&selectionDim?null:normalInstanceColors.get(object);}object.material=selectionBounds&&selectionDim?(object.isMesh?dimMaterial:object.isLine?dimLineMaterial:normalMaterials.get(object)):normalMaterials.get(object);});
  selectionStats=netActive?{matched,highlighted:netState.tracks+netState.pads+netState.vias+netState.platedPads+netState.fills+netState.boundaries,limited:netState.omitted>0||netState.sourceLimited}:{matched,highlighted:count,limited:matched>count};return selectionStats;
 }
 function projectAnchor(){if(!alive||!selectionBounds)return null;camera.updateMatrixWorld();const point=(selectionPoint?.clone()||selectionBounds.getCenter(new THREE.Vector3())).project(camera),w=Math.max(1,host.clientWidth||320),h=Math.max(1,host.clientHeight||240),rect=host.getBoundingClientRect?.()||{left:0,top:0};return{x:rect.left+(point.x+1)*w/2,y:rect.top+(1-point.y)*h/2,visible:point.z>=-1&&point.z<=1&&Math.abs(point.x)<=1&&Math.abs(point.y)<=1};}
 function fit(view){if(!alive)return false;resize();tree.root.updateWorldMatrix(true,true);const bounds=selectionBounds||new THREE.Box3().setFromObject(tree.root);if(bounds.isEmpty())return false;const target=bounds.getCenter(new THREE.Vector3()),dimensions=bounds.getSize(new THREE.Vector3()),direction=view?new THREE.Vector3(...boardViewPreset(view).direction).normalize():camera.position.clone().sub(controls.target).normalize();if(view)camera.up.fromArray(boardViewPreset(view).up);if(!direction.lengthSq())direction.set(.45,-.6,1).normalize();
  const distance=boxFitDistance([Math.max(2,dimensions.x),Math.max(2,dimensions.y),Math.max(1,dimensions.z)],direction.toArray(),45,camera.aspect,.8,camera.up.toArray());if(!distance)return false;fitProjection(camera,distance);
  updateSceneBounds();controls.minDistance=.1;controls.maxDistance=Math.max(10000,distance*8);controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,distance);const clip=boardClipRange(distance,clipRadius);camera.near=clip.near;camera.far=clip.far;camera.updateProjectionMatrix();controls.update();invalidate();return true;
 }
 function setSelection(value={}){if(!alive)return {matched:0,highlighted:0,limited:false};currentSelection=value||{};selectionPoint=null;const result=selectedBounds();invalidate();return result;}
 function pick(event){const rect=renderer.domElement.getBoundingClientRect();if(!(rect.width>0&&rect.height>0))return;pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);camera.updateMatrixWorld();scene.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);
  const individual=Boolean(event.shiftKey&&!event.ctrlKey&&!event.metaKey),pickMode=individual?'object':mode;
  const hit=raycaster.intersectObjects([...tree.pickables,...(netInspection?.group.children.flatMap(group=>group.children)||[])].filter(visible),false).find(hit=>selectableRecord(hit.object.userData.records?.[hit.instanceId]||hit.object.userData.record,pickMode)),record=hit?(hit.object.userData.records?.[hit.instanceId]||hit.object.userData.record):null;
  setSelection(!record?{}:!individual&&mode==='net'&&record.net?{netNames:[record.net]}:record.type==='Component'||typeof record.library==='string'?{references:[record.ref]}:{uuids:[record.uuid||record.id]});onSelect?.(record,{individual});selectionPoint=hit?.point?.clone()||null;invalidate();
 }
 const down=event=>gesture.down(event),move=event=>gesture.move(event),up=event=>{if(gesture.up(event)&&event.button===0)pick(event);},cancel=event=>gesture.cancel(event),lost=event=>{event.preventDefault();contextLost=true;if(frame)caf(frame);frame=0;},restored=()=>{contextLost=false;invalidate();};
 function dispose(){if(!alive)return;alive=false;netInspection?.dispose();netStatus?.remove();terminalAnnotations?.dispose();terminalStatus?.remove();if(frame)caf(frame);observer?.disconnect();controls?.removeEventListener('change',invalidate);controls?.dispose();
  if(renderer){for(const [name,handler]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['webglcontextlost',lost],['webglcontextrestored',restored]])renderer.domElement.removeEventListener(name,handler);renderer.renderLists?.dispose();renderer.dispose();renderer.forceContextLoss?.();renderer.domElement.remove();}
  scene.remove(tree.root);tree.release();overlay.clear();overlayMaterial.dispose();for(const material of layerMaterials.values())material.dispose();layerMaterials.clear();dimMaterial.dispose();dimLineMaterial.dispose();scene.clear();
 }
 try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});renderer.shadowMap.enabled=false;renderer.outputColorSpace=sourceRenderer.outputColorSpace;renderer.toneMapping=sourceRenderer.toneMapping;renderer.toneMappingExposure=sourceRenderer.toneMappingExposure;
  const canvas=renderer.domElement;canvas.style.width='100%';canvas.style.height='100%';canvas.style.display='block';canvas.style.touchAction='none';canvas.tabIndex=0;canvas.setAttribute('aria-label','Interactive 3D probe. Drag to orbit, right-drag to pan, wheel or pinch to zoom, tap to select.');host.append(canvas);
  controls=new OrbitControls(camera,canvas);controls.screenSpacePanning=true;controls.enableDamping=false;controls.addEventListener('change',invalidate);
  for(const [name,handler]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['webglcontextlost',lost],['webglcontextrestored',restored]])canvas.addEventListener(name,handler);
  if(netInspection&&host.ownerDocument){netStatus=host.ownerDocument.createElement('small');netStatus.setAttribute('role','status');netStatus.style.cssText='position:absolute;left:6px;right:6px;top:4px;pointer-events:none;font:10px/1.3 system-ui;background:var(--surface);color:var(--muted);';host.append(netStatus);}
  if(terminalSource){
   if(host.ownerDocument){terminalStatus=host.ownerDocument.createElement('small');terminalStatus.setAttribute('role','status');terminalStatus.style.cssText='position:absolute;left:6px;right:6px;bottom:4px;pointer-events:none;font:10px/1.3 system-ui;background:var(--surface);color:var(--muted);';host.append(terminalStatus);}
   terminalAnnotations=createTerminalAnnotations(THREE,{scene,camera,host,...terminalSource,layerVisible:layer=>(!visibleLayers||visibleLayers.has(layer))&&terminalSource.layerVisible?.(layer)!==false,showNetNames,showTerminalNumbers,maxLabels:512,maxTexturePixels:524288,onStatus:state=>{if(terminalStatus){terminalStatus.hidden=!(state.numbers||state.nets)||!state.budget&&!state.sourceOmitted;terminalStatus.textContent=`${state.shown} pad annotations shown${state.budget?`; ${state.budget} omitted by the probe label/texture budget`:''}${state.sourceOmitted?`; ${state.sourceOmitted} beyond the source-record limit`:''}.`;}}});
  }
  if(orthographic)camera=projectionCamera(THREE,camera,controls,true);terminalAnnotations?.setCamera(camera);
  observer=new Observer(resize);observer.observe(host);resize();setSelection(selection);fit();
 }catch(error){dispose();throw error;}
 return {fit,setSelection,setExplode(value){explosion.set(value);tree.syncTransforms();updateSceneBounds();setSelection(currentSelection);return explosion.get();},getExplode:()=>explosion.get(),setVisibleLayers(value){if(!Array.isArray(value)||value.some(layer=>typeof layer!=='string'||layer.length>100))return false;visibleLayers=new Set(value);setSelection(currentSelection);return true;},getVisibleLayers:()=>visibleLayers?[...visibleLayers]:null,setOrthographic(enabled){camera=projectionCamera(THREE,camera,controls,Boolean(enabled));terminalAnnotations?.setCamera(camera);resize();controls.update();invalidate();return Boolean(camera.isOrthographicCamera);},isOrthographic:()=>Boolean(camera.isOrthographicCamera),setNetHighlightColor(value){netHighlightColor=value==='layer'?'layer':'accent';netInspection?.setColorMode(netHighlightColor);setSelection(currentSelection);},setSelectionDim(enabled){selectionDim=Boolean(enabled);setSelection(currentSelection);return selectionDim;},projectAnchor,setTerminalNumbers(value){const result=terminalAnnotations?.setNumbers(value);invalidate();return result;},setTerminalLabels(value){const result=terminalAnnotations?.setNets(value);invalidate();return result;},getTerminalLabelState(){return terminalAnnotations?.getState()||null;},setSelectionMode(value){mode=['all','part','net','pin'].includes(value)?value:'all';},setTheme(value){if(!alive)return;scene.background.setHex(value?0x151820:0xe7ebf1);overlayMaterial.color.setHex(value?0x4de3ee:0x007b91);for(const material of layerMaterials.values())material.dispose();layerMaterials.clear();setSelection(currentSelection);},
  setView(view){if(!alive||!boardViewPresets.some(preset=>preset.id===view))return false;return fit(view);},
  rotate(degrees=15){if(!alive||!Number.isFinite(degrees))return false;const offset=camera.position.clone().sub(controls.target).applyAxisAngle(camera.up,degrees*Math.PI/180);camera.position.copy(controls.target).add(offset);controls.update();invalidate();return true;},
  flip(){if(!alive)return false;const offset=camera.position.clone().sub(controls.target);camera.position.copy(controls.target).sub(offset);controls.update();invalidate();return true;},
  zoom(factor){if(!alive||!Number.isFinite(factor)||factor<=0)return false;const offset=camera.position.clone().sub(controls.target),distance=Math.max(controls.minDistance,Math.min(controls.maxDistance,offset.length()/factor));camera.position.copy(controls.target).add(offset.setLength(distance));controls.update();invalidate();return true;},
  sourceAdded(node){if(alive&&tree.sourceAdded(node)){updateSceneBounds();setSelection(currentSelection);invalidate();}},
  getStats(){return {active:alive,sharedGeometry:true,sharedCpuGeometry:true,independentGpuContext:true,sourceParses:0,modelRequests:0,maxPixelCount:500000,maxDevicePixelRatio:2,antialiasRequested:true,ambientOcclusion:false,shadows:false,fullNet3D:Boolean(netInspectionSource),netInspection:netInspection?.state()||null,selectionGeometry:netInspection?.state().active?'saved all-layer copper overlay with shared context':'exact shared source mesh',selection:{...selectionStats},contextLost};},dispose};
}
