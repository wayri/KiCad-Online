const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const project=path.resolve(__dirname,'../..'),roots=[project];
const gitFile=path.join(project,'.git');if(fs.existsSync(gitFile)&&fs.statSync(gitFile).isFile()){const value=/^gitdir:\s*(.+)/.exec(fs.readFileSync(gitFile,'utf8'))?.[1];if(value)roots.push(path.resolve(project,value,'../../..'));}
const threePath=roots.flatMap(root=>[path.join(root,'extension/node_modules/three/build/three.module.js'),path.join(root,'.vizdiff/build-deps/node_modules/three/build/three.module.js')]).find(fs.existsSync);
const helper=()=>import('../spike/probeViewport.mjs');

test('3D probe layer matching preserves unlayered context and handles through-hole copper wildcards',async()=>{
 const {probeLayerVisible}=await helper(),layers=new Set(['F.Cu','In1.Cu','F.SilkS','Edge.Cuts']);
 assert.equal(probeLayerVisible({layer:'F.Cu'},layers),true);assert.equal(probeLayerVisible({layer:'F.Fab'},layers),false);
 assert.equal(probeLayerVisible({layers:['*.Cu','*.Mask']},layers),true);assert.equal(probeLayerVisible({type:'Board'},layers),true);
 assert.equal(probeLayerVisible({layer:'B.Cu'},layers),false);assert.equal(probeLayerVisible({layer:'F.Cu'},new Set()),false);
});

test('PCB annotation corners may project outside the screen for SVG clipping but never behind the camera',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createAnchorProjector}=await import('../spike/projectAnchor.mjs');
 const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 let side;const project=createAnchorProjector(THREE,{objects:()=>[],camera,rect:()=>({left:20,top:30,width:200,height:200}),positionToWorld:(p,s)=>{side=s;return new THREE.Vector3(p.x,p.y,s==='back'?-1:0);}});
 assert.equal(project({position:{x:100,y:0}}),null);const offscreen=project({position:{x:100,y:0},side:'back',clip:false});assert.ok(offscreen.x>220);assert.equal(side,'back');
 assert.equal(project({position:{x:0,y:0},side:'invalid',clip:false}),null);
 camera.position.set(0,0,-10);camera.lookAt(0,0,-20);camera.updateMatrixWorld();assert.equal(project({position:{x:0,y:0},clip:false}),null);
});
test('probe registry budgets one extra context and releases before parent resources',async()=>{
 const {createProbeRegistry}=await helper(),registry=createProbeRegistry(1),events=[];
 const first=registry.create(()=>({dispose(){events.push('probe');},sourceAdded(node){events.push(node);}}));
 assert.equal(registry.size(),1);assert.throws(()=>registry.create(()=>{throw Error('Factory must not run');}),/3D probe limit/);registry.sourceAdded('model');first.dispose();first.dispose();assert.equal(registry.size(),0);
 assert.throws(()=>registry.create(()=>{throw Error('GPU unavailable');}),/GPU unavailable/);assert.equal(registry.size(),0);
 registry.create(()=>({dispose(){events.push('second');}}));registry.dispose();events.push('parent');assert.deepEqual(events,['model','probe','second','parent']);assert.throws(()=>registry.create(()=>({})),/closed/);
});
test('probe hierarchy shares source buffers and records without mutating main selection materials', {skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{cloneProbeTree}=await helper(),source=new THREE.Group(),geometry=new THREE.BoxGeometry(),base=new THREE.MeshBasicMaterial({color:'red'}),dimmed=new THREE.MeshBasicMaterial({color:'grey'}),mesh=new THREE.InstancedMesh(geometry,dimmed,2),originalColors=new THREE.InstancedBufferAttribute(new Float32Array([1,0,0,0,1,0]),3),records=[{uuid:'p1',net:'GND'},{uuid:'p2',net:'VCC'}];
 mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(3,4,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(5,6,0));mesh.userData.records=records;mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(6),3);source.add(mesh);
 let disposed=0;geometry.addEventListener('dispose',()=>disposed++);base.addEventListener('dispose',()=>disposed++);
 const tree=cloneProbeTree(THREE,source,{materialFor:()=>base,instanceColorFor:()=>originalColors}),copy=tree.copyOf(mesh);
 assert.equal(copy.geometry,geometry);assert.equal(copy.material,base);assert.equal(copy.instanceMatrix,mesh.instanceMatrix);assert.equal(copy.instanceColor,originalColors);assert.equal(copy.userData.records,records);assert.equal(mesh.material,dimmed);
 copy.position.x=99;assert.equal(mesh.position.x,0);const modelParent=new THREE.Group(),model=new THREE.Mesh(geometry,base);model.userData.record={type:'Component',ref:'U1'};modelParent.add(model);source.add(modelParent);assert.equal(tree.sourceAdded(model),true);assert.equal(tree.copyOf(model).geometry,geometry);assert.equal(tree.sourceAdded(model),false);
 tree.release();assert.equal(disposed,0);assert.equal(source.children.length,2);geometry.dispose();base.dispose();dimmed.dispose();
});
function viewportHarness(THREE){
 const rendered=[],queue=new Map();let seq=0,disposed=0,loss=0;
 class Canvas{constructor(){this.style={};this.events=new Map();this.parentNode=null;}setAttribute(){}addEventListener(name,fn){this.events.set(name,fn);}removeEventListener(name){this.events.delete(name);}getBoundingClientRect(){return {left:0,top:0,width:320,height:240};}remove(){this.parentNode=null;}}
 class Renderer{constructor(){this.domElement=new Canvas();this.shadowMap={};this.renderLists={dispose(){}};}setPixelRatio(value){this.ratio=value;}setSize(w,h){this.w=w;this.h=h;}render(scene,camera){rendered.push({scene,camera});}dispose(){disposed++;}forceContextLoss(){loss++;}}
 class Controls{constructor(camera){this.object=camera;this.target=new THREE.Vector3();}addEventListener(){}removeEventListener(){}update(){this.object.lookAt(this.target);this.object.updateMatrixWorld();}dispose(){}}
 const host={clientWidth:320,clientHeight:240,children:[],append(canvas){this.children.push(canvas);canvas.parentNode=this;}},source=new THREE.Group(),sourceScene=new THREE.Scene(),geometry=new THREE.BoxGeometry(8,6,1),material=new THREE.MeshBasicMaterial({color:'green'}),mesh=new THREE.Mesh(geometry,material);mesh.userData.record={type:'Component',ref:'U1',uuid:'u1'};source.add(mesh);sourceScene.add(source,new THREE.AmbientLight(0xffffff,1));
 return {args:{THREE:{...THREE,WebGLRenderer:Renderer},OrbitControls:Controls,host,source,sourceScene,sourceRenderer:{outputColorSpace:THREE.SRGBColorSpace,toneMapping:THREE.NoToneMapping,toneMappingExposure:1},board:{},raf:fn=>{queue.set(++seq,fn);return seq;},caf:id=>queue.delete(id),Observer:class{observe(){}disconnect(){}}},source,mesh,geometry,material,host,rendered,disposed:()=>disposed,loss:()=>loss,flush(){const pending=[...queue.values()];queue.clear();for(const fn of pending)fn();}};
}
test('probe camera, selection and lifecycle stay independent while using real source geometry', {skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE);let sharedDisposals=0;h.geometry.addEventListener('dispose',()=>sharedDisposals++);h.material.addEventListener('dispose',()=>sharedDisposals++);
 const probe=createSharedProbeViewport({...h.args,selection:{references:['U1']}});h.flush();assert.equal(probe.getStats().selection.matched,1);assert.equal(h.rendered.length,1);const first=h.rendered[0],position=first.camera.position.clone();assert.ok(first.camera.position.toArray().every(Number.isFinite));assert.ok(first.camera.far<1000,'probe clipping follows the millimetre scene, not a 10m far plane');const firstNear=first.camera.near;
 probe.rotate(45);probe.zoom(2);h.flush();assert.notDeepEqual(first.camera.position.toArray(),position.toArray());assert.notEqual(first.camera.near,firstNear,'zoom recomputes depth precision');assert.equal(h.mesh.position.x,0);assert.equal(h.source.children.length,1);
 probe.setSelection({uuids:['missing']});h.flush();assert.equal(probe.getStats().selection.matched,0);probe.setTheme(false);h.flush();assert.equal(first.scene.background.getHex(),0xe7ebf1);assert.equal(h.args.sourceScene.background,null);
 const addition=new THREE.Mesh(h.geometry,h.material);addition.position.z=500;addition.userData.record={type:'Component',ref:'U2',uuid:'u2'};h.source.add(addition);probe.sourceAdded(addition);probe.setSelection({references:['U2']});assert.equal(probe.getStats().selection.matched,1);assert.equal(probe.getStats().sourceParses,0);assert.equal(probe.getStats().modelRequests,0);h.flush();assert.ok(first.camera.far>500,'late model bounds expand the clip range without changing the camera');
 probe.dispose();probe.dispose();h.flush();assert.equal(sharedDisposals,0);assert.equal(h.disposed(),1);assert.equal(h.loss(),1);assert.equal(probe.getStats().active,false);assert.equal(h.source.children.length,2);
 h.geometry.dispose();h.material.dispose();
});
test('3D popup layer controls hide mixed-layer instances without changing shared main matrices',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),mesh=new THREE.InstancedMesh(h.geometry,h.material,2);
 mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,0,2));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(5,0,2));mesh.userData.records=[{type:'Track',uuid:'top',layer:'F.Cu'},{type:'Track',uuid:'fab',layer:'F.Fab'}];h.source.add(mesh);
 const original=mesh.instanceMatrix,values=[...original.array],probe=createSharedProbeViewport({...h.args,selection:{uuids:['fab']}});h.flush();assert.equal(probe.getStats().selection.matched,1);
 probe.setVisibleLayers(['F.Cu','F.SilkS','Edge.Cuts']);h.flush();assert.equal(probe.getStats().selection.matched,0);assert.equal(mesh.instanceMatrix,original);assert.deepEqual([...original.array],values);
 probe.setVisibleLayers(['F.Cu','F.Fab']);h.flush();assert.equal(probe.getStats().selection.matched,1);assert.deepEqual(probe.getVisibleLayers(),['F.Cu','F.Fab']);probe.dispose();h.geometry.dispose();h.material.dispose();
});

test('probe picking keeps authoritative part, net and pin records separate', {skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),pad=new THREE.Mesh(h.geometry,h.material),record={type:'Pad',ref:'U1',name:'1',uuid:'pad-one',net:'GND',at:[0,0],width:1,height:1};
 pad.scale.set(.1,.1,.1);pad.position.z=1;pad.userData.record=record;h.source.add(pad);const selected=[],gestures=[],probe=createSharedProbeViewport({...h.args,onSelect:(value,gesture)=>{selected.push(value);gestures.push(gesture);}});h.flush();
 const pick=(mode,extra={})=>{probe.setSelectionMode(mode);const camera=h.rendered.at(-1).camera;camera.updateMatrixWorld();const point=new THREE.Vector3(0,0,1).project(camera),event={pointerId:1,button:0,clientX:(point.x+1)*160,clientY:(1-point.y)*120,...extra},canvas=h.host.children[0];canvas.events.get('pointerdown')(event);canvas.events.get('pointerup')(event);h.flush();};
 pick('pin');assert.equal(selected.at(-1),record);assert.equal(probe.getStats().selection.matched,1);
 pick('net');assert.equal(selected.at(-1).net,'GND');pick('part');assert.equal(selected.at(-1),h.mesh.userData.record);
 pick('part',{shiftKey:true});assert.equal(selected.at(-1),record);assert.equal(gestures.at(-1).individual,true);assert.equal(h.mesh.material,h.material);assert.equal(pad.userData.record,record);probe.dispose();h.geometry.dispose();h.material.dispose();
});

test('default GPU budget permits popupfrompopup in3D and rejects a third extra context',async()=>{const {createProbeRegistry}=await helper(),registry=createProbeRegistry();let released=0;const factory=()=>({dispose(){released++;},sourceAdded(){}});registry.create(factory);registry.create(factory);assert.equal(registry.size(),2);assert.throws(()=>registry.create(factory),/limit \(2\)/);registry.dispose();assert.equal(released,2);});

test('3D probes render saved BGA terminal annotations with independent local flags and smaller budgets',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),drawn=[],pad={pinNumber:'A1',name:'A1',at:[0,0],width:4,height:4,shape:'circle',layers:['F.Cu'],net:'GND'},source={records:[pad],world:p=>p,top:.8,bottom:-.8,layout:require('../pad-labels.js').layout,createCanvas:()=>({width:0,height:0,getContext:()=>({scale(){},strokeText(){},fillText(text){drawn.push(text);}})})},preferences={showTerminalNumbers:true,showNetNames:false},probe=createSharedProbeViewport({...h.args,terminalSource:source,...preferences});
 h.flush();assert.ok(drawn.includes('A1'));assert.equal(probe.getTerminalLabelState().shown,1);assert.equal(probe.getTerminalLabelState().maxLabels,512);assert.equal(probe.getTerminalLabelState().maxTexturePixels,524288);
 probe.setOrthographic(true);probe.setView('top');h.flush();assert.equal(probe.getTerminalLabelState().shown,1);assert.ok(drawn.includes('A1'));probe.setOrthographic(false);
 probe.setTerminalNumbers(false);h.flush();assert.equal(probe.getTerminalLabelState().shown,0);probe.setTerminalLabels(true);h.flush();assert.ok(drawn.includes('GND'));assert.equal(probe.getTerminalLabelState().numbers,false);assert.deepEqual(preferences,{showTerminalNumbers:true,showNetNames:false});assert.equal(source.records[0],pad);
 probe.dispose();h.geometry.dispose();h.material.dispose();
});


test('probe selection uses exact shared instance geometry, dims only cloned materials and projects client anchors',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),instances=new THREE.InstancedMesh(h.geometry,h.material,2),records=[{type:'Pad',uuid:'one',ref:'U3',net:'VCC'},{type:'Pad',uuid:'two',ref:'U3',net:'GND'}];
 instances.userData.records=records;instances.position.set(12,3,1);instances.setMatrixAt(0,new THREE.Matrix4().makeTranslation(1,2,0));instances.setMatrixAt(1,new THREE.Matrix4().makeTranslation(8,9,0));h.source.add(instances);h.host.getBoundingClientRect=()=>({left:50,top:70,width:320,height:240});let changed=0,sharedDisposed=0;h.geometry.addEventListener('dispose',()=>sharedDisposed++);h.material.addEventListener('dispose',()=>sharedDisposed++);
 const probe=createSharedProbeViewport({...h.args,selection:{uuids:['one']},onViewChange(){changed++;}});h.flush();const {scene}=h.rendered.at(-1),overlay=scene.getObjectByName('probe-selected-geometry');assert.equal(overlay.children.length,1);const highlight=overlay.children[0];assert.equal(highlight.isMesh,true);assert.equal(highlight.geometry,h.geometry);assert.deepEqual(highlight.matrix.elements,new THREE.Matrix4().makeTranslation(13,5,1).elements);assert.equal(h.mesh.material,h.material);assert.equal(instances.material,h.material);assert.equal(instances.userData.records,records);
 const clone=scene.children.find(child=>child!==overlay&&child.children.some(node=>node.geometry===h.geometry));assert.notEqual(clone.children[0].material,h.material);assert.equal(clone.children.find(node=>node.isInstancedMesh).instanceMatrix,instances.instanceMatrix);
 const anchor=probe.projectAnchor();assert.ok(Math.abs(anchor.x-210)<1e-8);assert.ok(Math.abs(anchor.y-190)<1e-8);assert.equal(anchor.visible,true);assert.ok(changed>0);probe.rotate(40);h.flush();assert.ok(changed>1);
 let ownedDisposed=0;highlight.material.addEventListener('dispose',()=>ownedDisposed++);clone.children[0].material.addEventListener('dispose',()=>ownedDisposed++);probe.setSelection({});h.flush();assert.equal(overlay.children.length,0);assert.equal(clone.children[0].material,h.material);assert.equal(probe.projectAnchor(),null);probe.dispose();assert.equal(sharedDisposed,0);assert.equal(ownedDisposed,2);h.geometry.dispose();h.material.dispose();
});


test('dense selected nets bound probe overlays and disclose partial geometry without allocating geometry buffers',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),instances=new THREE.InstancedMesh(h.geometry,h.material,300);instances.userData.records=Array.from({length:300},(_,i)=>({type:'Pad',uuid:'p'+i,net:'VCC'}));for(let i=0;i<300;i++)instances.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i,0,0));h.source.add(instances);
 const probe=createSharedProbeViewport({...h.args,selection:{netNames:['VCC']}});h.flush();const overlay=h.rendered.at(-1).scene.getObjectByName('probe-selected-geometry');assert.equal(overlay.children.length,256);assert.ok(overlay.children.every(node=>node.geometry===h.geometry));assert.deepEqual(probe.getStats().selection,{matched:300,highlighted:256,limited:true});probe.dispose();h.geometry.dispose();h.material.dispose();
});


async function savedNetSource(){
 const ast=require('../design-diff.js').parse(fs.readFileSync(path.join(__dirname,'fixtures/net3d/inspection.kicad_pcb'),'utf8')),value=x=>x?.quoted??x,nodes=(a,k)=>a.filter(n=>Array.isArray(n)&&n[0]===k),child=(a,k)=>nodes(a,k)[0],xy=(a,k)=>child(a,k).slice(1,3),identity=a=>value(child(a,'uuid')[1]),nets=Object.fromEntries(nodes(ast,'net').map(n=>[String(n[1]),value(n[2])]));
 const tracks=nodes(ast,'segment').map(n=>({type:'Track',id:identity(n),uuid:identity(n),start:xy(n,'start'),end:xy(n,'end'),width:child(n,'width')[1],layer:value(child(n,'layer')[1]),net:nets[child(n,'net')[1]]})),vias=nodes(ast,'via').map(n=>({type:'Via',id:identity(n),uuid:identity(n),at:xy(n,'at'),size:child(n,'size')[1],drill:child(n,'drill')[1],net:nets[child(n,'net')[1]]})),fp=nodes(ast,'footprint')[0],pad=child(fp,'pad'),pads=[{type:'Pad',id:identity(pad),uuid:identity(pad),ref:'J1',name:value(pad[1]),at:xy(fp,'at'),width:child(pad,'size')[1],height:child(pad,'size')[2],shape:value(pad[3]),nativeType:value(pad[2]),drillShape:'circle',drill:child(pad,'drill')[1],layers:child(pad,'layers').slice(1).map(value),net:value(child(pad,'net')[2])}],layers=child(ast,'layers').slice(1).filter(Array.isArray).map(n=>value(n[1])).filter(n=>/.Cu$/.test(n)),stackup=nodes(child(child(ast,'setup'),'stackup'),'layer').map(n=>({name:value(n[1]),type:value(child(n,'type')?.[1]),thickness:child(n,'thickness')?.[1]})),board={nets,layers,stackup,tracks,vias,pads};
 const {sourceCopperPlan}=await import('../spike/copperStack.mjs'),{sourceZoneGeometry}=await import('../spike/sourceGeometry.mjs');return {board,plan:sourceCopperPlan(board,ast,1.74),zones:sourceZoneGeometry(ast).records,pads,world:([x,y])=>[x,-y],colorForLayer:()=>0x00ffff};
}

test('exploded probes retain selected nets, saved geometry and camera through separation and restoration',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),source=await savedNetSource(),before=JSON.stringify(source.board),probe=createSharedProbeViewport({...h.args,board:source.board,netInspectionSource:source,selection:{netNames:['SIGNAL']},explodeAmount:100});
 h.flush();const {scene,camera}=h.rendered.at(-1),start=camera.position.clone(),owned=scene.getObjectByName('Probe selected net — all copper layers'),objects=[];owned.traverse(o=>{if(o.geometry)objects.push(o);});const inner=objects.find(o=>o.userData.layer==='In1.Cu'),geometry=inner.geometry,initial=inner.position.z;assert.notEqual(initial,0);assert.equal(probe.getExplode(),100);
 for(const value of [50,0,100]){h.mesh.position.z=value/10;probe.setExplode(value);h.flush();assert.equal(inner.position.z,initial*value/100);assert.equal(inner.geometry,geometry);assert.ok(camera.position.distanceTo(start)<1e-8);assert.deepEqual(probe.getStats().netInspection.nets,['SIGNAL']);const copy=scene.getObjectByProperty('geometry',h.geometry);assert.equal(copy.position.z,value/10);}
 const barrel=objects.find(o=>o.userData.explodeSpan),span=barrel.userData.explodeSpan,matrix=new THREE.Matrix4();probe.setVisibleLayers(['F.Cu']);probe.setExplode(50);probe.setVisibleLayers(source.plan.layers.map(l=>l.name));h.flush();barrel.getMatrixAt(0,matrix);const names=source.plan.layers.slice().sort((a,b)=>b.z-a.z).map(l=>l.name),rank=(names.length-1)/2-names.indexOf(span.to);assert.ok(Math.abs(matrix.elements[14]-(span.zMin+rank*2))<1e-5,'restoring hidden via instances retains their current exploded depth');
 probe.setSelection({netNames:['OTHER']});h.flush();assert.deepEqual(probe.getStats().netInspection.nets,['OTHER']);probe.setSelection({netNames:['SIGNAL']});probe.setExplode(0);h.flush();const restored=[];owned.traverse(o=>{if(o.geometry&&o.userData.layer)restored.push(o.position.z);});assert.ok(restored.every(z=>z===0));assert.equal(JSON.stringify(source.board),before);assert.equal(probe.getStats().sourceParses,0);assert.equal(probe.getStats().modelRequests,0);probe.dispose();h.geometry.dispose();h.material.dispose();
});

test('probe full-net overlay uses saved internal layers and blind/buried via spans, fits and picks source identities',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),source=await savedNetSource(),before=JSON.stringify(source.board),selected=[];
 let sharedDisposed=0;h.geometry.addEventListener('dispose',()=>sharedDisposed++);h.material.addEventListener('dispose',()=>sharedDisposed++);
 const probe=createSharedProbeViewport({...h.args,board:source.board,netInspectionSource:source,selection:{netNames:['SIGNAL']},onSelect:value=>selected.push(value)});h.flush();const stats=probe.getStats();assert.equal(stats.fullNet3D,true);assert.equal(stats.netInspection.active,true);assert.equal(stats.netInspection.tracks,6);assert.equal(stats.netInspection.vias,4);assert.equal(stats.netInspection.platedPads,1);assert.equal(stats.netInspection.fills,1);assert.equal(stats.netInspection.boundaries,1);assert.equal(stats.netInspection.omitted,0);
 const {scene,camera}=h.rendered.at(-1),owned=scene.getObjectByName('Probe selected net — all copper layers'),objects=[];owned.traverse(o=>{if(o.geometry)objects.push(o);});assert.ok(objects.some(o=>o.userData.layer==='In1.Cu'));assert.ok(objects.some(o=>o.userData.layer==='In2.Cu'));
 const via=source.board.vias.find(v=>v.id.endsWith('0022')),span=source.plan.viaSpans.get(via.id),barrel=objects.find(o=>o.userData.records?.includes(via)&&o.geometry.boundingBox&&Math.abs(o.geometry.boundingBox.min.z)<1e-6&&Math.abs(o.geometry.boundingBox.max.z-(span.zMax-span.zMin))<1e-6);assert.ok(barrel);const index=barrel.userData.records.indexOf(via),matrix=new THREE.Matrix4();barrel.getMatrixAt(index,matrix);assert.ok(Math.abs(matrix.elements[14]-span.zMin)<1e-6);assert.ok(Math.abs(barrel.geometry.boundingBox.max.z-(span.zMax-span.zMin))<1e-6);
 const box=new THREE.Box3().setFromObject(owned);for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1&&p.z>-1);}
 // The source scene has no copper at all: this click must hit owned all-layer geometry.
 probe.setSelectionMode('net');const point=new THREE.Vector3(8,-6,source.plan.byLayer.get('In1.Cu').z).project(camera),event={pointerId:1,button:0,clientX:(point.x+1)*160,clientY:(1-point.y)*120},canvas=h.host.children[0];canvas.events.get('pointerdown')(event);canvas.events.get('pointerup')(event);assert.ok(source.board.tracks.includes(selected.at(-1))||source.board.vias.includes(selected.at(-1))||selected.at(-1)?.net==='SIGNAL');
 probe.setSelectionMode('pin');const pad=source.pads[0],p=new THREE.Vector3(pad.at[0],-pad.at[1],source.plan.byLayer.get('F.Cu').z).project(camera),tap={pointerId:2,button:0,clientX:(p.x+1)*160,clientY:(1-p.y)*120};canvas.events.get('pointerdown')(tap);canvas.events.get('pointerup')(tap);assert.equal(selected.at(-1),pad);
 probe.setSelection({netNames:['SIGNAL']});h.flush();let disposed=0;owned.children[0].children[0].geometry.addEventListener('dispose',()=>disposed++);const same=owned.children[0];probe.setSelection({netCodes:[1]});h.flush();assert.equal(owned.children[0],same);assert.equal(disposed,0);probe.setSelection({});assert.equal(disposed,1);assert.equal(h.mesh.material,h.material);assert.equal(h.args.sourceScene.children.length,2);assert.equal(JSON.stringify(source.board),before);assert.equal(probe.getStats().netInspection.active,false);probe.dispose();assert.equal(sharedDisposed,0);h.geometry.dispose();h.material.dispose();
});

test('probe copper budgets filter the selected net first, omit whole polygons and release only owned geometry',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createProbeNetInspection}=await helper(),source=await savedNetSource(),before=JSON.stringify(source.board),selected=source.board.tracks.find(t=>t.net==='SIGNAL');source.board.tracks=[...Array.from({length:10000},()=>({...selected,net:'OTHER'})),selected];source.board.vias=[];source.pads=[];
 const overlay=createProbeNetInspection(THREE,source,{maxRecords:2,maxZonePoints:3}),state=overlay.update({netNames:['SIGNAL']});assert.equal(state.tracks,1);assert.equal(state.fills,0);assert.equal(state.boundaries,0);assert.equal(state.omitted,2);assert.equal(state.sourceLimited,true);assert.match(state.warnings.join(' '),/probe copper budget/);assert.equal(overlay.group.children[0].children.some(o=>o.userData.record?.type==='Zone'),false);
 const limited=createProbeNetInspection(THREE,{...source,board:{...source.board,tracks:Array.from({length:4},()=>selected)},zones:[]},{maxRecords:2,maxZonePoints:3});assert.equal(limited.update({netNames:['SIGNAL']}).tracks,2);assert.equal(limited.state().omitted,2);overlay.dispose();limited.dispose();assert.equal(overlay.group.children.length,0);assert.throws(()=>createProbeNetInspection(THREE,source,{maxRecords:99999}),/Invalid/);
});


test('two probes keep independent net overlays, visible omission status and grey context without mutating source colors',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),source=await savedNetSource(),left=viewportHarness(THREE),right=viewportHarness(THREE),nodes=[];
 source.board.tracks.push({...source.board.tracks[0],layer:'In99.Cu',id:'unsupported-layer'});
 left.host.ownerDocument={createElement(){const node={style:{},setAttribute(){},remove(){this.removed=true;}};nodes.push(node);return node;}};
 const instanced=new THREE.InstancedMesh(left.geometry,left.material,1),colors=new THREE.InstancedBufferAttribute(new Float32Array([1,0,0]),3);instanced.instanceColor=colors;instanced.userData.records=[{type:'Component',ref:'U2'}];instanced.setMatrixAt(0,new THREE.Matrix4());left.source.add(instanced);
 const a=createSharedProbeViewport({...left.args,board:source.board,netInspectionSource:source,selection:{netNames:['SIGNAL']}}),b=createSharedProbeViewport({...right.args,board:source.board,netInspectionSource:source,selection:{netNames:['OTHER']}});left.flush();right.flush();assert.equal(a.getStats().netInspection.omitted,1);assert.equal(nodes[0].hidden,false);assert.match(nodes[0].textContent,/1 omitted/);assert.match(nodes[0].title,/omitted/);assert.deepEqual(b.getStats().netInspection.nets,['OTHER']);assert.equal(b.getStats().netInspection.tracks,1);
 const scene=left.rendered.at(-1).scene,clone=scene.children.find(g=>g.children.some(o=>o.isInstancedMesh&&o.userData.records===instanced.userData.records)),copy=clone.children.find(o=>o.userData.records===instanced.userData.records);assert.equal(copy.instanceColor,null);assert.equal(instanced.instanceColor,colors);assert.equal(instanced.material,left.material);
 a.setSelection({});left.flush();assert.equal(nodes[0].hidden,true);assert.equal(copy.instanceColor,colors);assert.equal(copy.material,left.material);assert.equal(b.getStats().netInspection.active,true);assert.equal(a.getStats().sourceParses,0);assert.equal(a.getStats().modelRequests,0);a.dispose();assert.equal(nodes[0].removed,true);assert.equal(b.getStats().active,true);b.dispose();left.geometry.dispose();left.material.dispose();right.geometry.dispose();right.material.dispose();
});


test('3D probe flip reverses the view and roundtrips without changing source or target',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE);let changed=0;
 const probe=createSharedProbeViewport({...h.args,onViewChange(){changed++;}});h.flush();const camera=h.rendered.at(-1).camera,start=camera.position.clone(),before=h.source.matrixWorld.clone();
 assert.equal(probe.flip(),true);h.flush();assert.ok(camera.position.distanceTo(start)>1);assert.ok(Math.abs(camera.position.length()-start.length())<1e-8);
 probe.flip();h.flush();assert.ok(camera.position.distanceTo(start)<1e-8);assert.deepEqual(h.source.matrixWorld.elements,before.elements);assert.ok(changed>1);
 for(let i=0;i<4;i++)probe.rotate(90);h.flush();assert.ok(camera.position.distanceTo(start)<1e-8);probe.dispose();assert.equal(probe.flip(),false);h.geometry.dispose();h.material.dispose();
});


test('probe3D presets use main board directions and fifteen-degree steps retain target and distance',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),{boardViewPresets}=await import('../spike/viewPresets.mjs'),probe=createSharedProbeViewport(h.args);h.flush();
 for(const preset of boardViewPresets){assert.equal(probe.setView(preset.id),true);h.flush();const camera=h.rendered.at(-1).camera,direction=camera.position.clone().normalize(),expected=new THREE.Vector3(...preset.direction).normalize();assert.ok(direction.distanceTo(expected)<1e-8,preset.id);assert.deepEqual(camera.up.toArray(),preset.up);}
 assert.equal(probe.setView('unknown'),false);probe.setView('iso');h.flush();const camera=h.rendered.at(-1).camera,start=camera.position.clone();for(let i=0;i<24;i++)assert.equal(probe.rotate(15),true);h.flush();assert.ok(camera.position.distanceTo(start)<1e-8);probe.rotate(-15);probe.rotate(15);h.flush();assert.ok(camera.position.distanceTo(start)<1e-8);probe.dispose();assert.equal(probe.setView('top'),false);h.geometry.dispose();h.material.dispose();
});

test('3D probe layer/accent choice changes existing copper without reparse, requests or geometry rebuild',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),source=await savedNetSource();
 const probe=createSharedProbeViewport({...h.args,board:source.board,netInspectionSource:source,selection:{netNames:['SIGNAL']},netHighlightColor:'accent'});h.flush();assert.equal(probe.getStats().netInspection.colorMode,'accent');
 const scene=h.rendered.at(-1).scene,group=scene.children.find(o=>o.name==='Probe selected net — all copper layers'),meshes=[...group.children[0].children],geometry=meshes.map(m=>m.geometry);assert.ok(meshes.every(m=>m.material.color.getHex()===0xffe18b));probe.setNetHighlightColor('layer');h.flush();assert.equal(probe.getStats().netInspection.colorMode,'layer');assert.deepEqual(group.children[0].children.map(m=>m.geometry),geometry);assert.equal(probe.getStats().sourceParses,0);assert.equal(probe.getStats().modelRequests,0);probe.dispose();h.geometry.dispose();h.material.dispose();
});

 test('orthographic projection preserves target scale, remains depth-independent and restores perspective', {skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{projectionCamera,resizeProjection,fitProjection,projectionPixelsPerMm}=await import('../spike/cameraProjection.mjs');
 let camera=new THREE.PerspectiveCamera(45,2,.1,1000);camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();const controls={object:camera,target:new THREE.Vector3()};
 const before=new THREE.Vector3(10,0,0).project(camera).x;camera=projectionCamera(THREE,camera,controls,true);assert.equal(camera.isOrthographicCamera,true);assert.equal(controls.object,camera);assert.ok(Math.abs(new THREE.Vector3(10,0,0).project(camera).x-before)<1e-10);
 assert.ok(Math.abs(new THREE.Vector3(10,0,20).project(camera).x-before)<1e-10);assert.equal(projectionPixelsPerMm(camera,400,20),projectionPixelsPerMm(camera,400,100));
 const height=camera.top-camera.bottom;resizeProjection(camera,1);assert.equal(camera.top-camera.bottom,height);assert.equal(camera.right-camera.left,height);
 camera.zoom=2;const zoomed=new THREE.Vector3(10,0,0);camera.updateProjectionMatrix();const expected=zoomed.clone().project(camera).x;camera=projectionCamera(THREE,camera,controls,false);assert.equal(camera.isPerspectiveCamera,true);assert.ok(Math.abs(zoomed.project(camera).x-expected)<1e-10);
 camera=projectionCamera(THREE,camera,controls,true);fitProjection(camera,50,2);assert.equal(camera.zoom,1);assert.equal(camera.right-camera.left,2*(camera.top-camera.bottom));
 });

test('orthographic probe retains fit, anchors, resize and independent perspective state',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSharedProbeViewport}=await helper(),h=viewportHarness(THREE),probe=createSharedProbeViewport({...h.args,selection:{references:['R1']}});
 probe.setOrthographic(true);assert.equal(probe.isOrthographic(),true);assert.equal(probe.setView('top'),true);h.flush();const rendered=h.rendered.at(-1);assert.equal(rendered.camera.isOrthographicCamera,true);assert.ok(Number.isFinite(rendered.camera.left));const before=rendered.camera.top-rendered.camera.bottom;h.host.clientWidth=640;probe.fit('top');h.flush();assert.ok(h.rendered.at(-1).camera.right>0);assert.ok(before>0);probe.setOrthographic(false);h.flush();assert.equal(h.rendered.at(-1).camera.isPerspectiveCamera,true);probe.dispose();h.geometry.dispose();h.material.dispose();
});
