const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const project=path.resolve(__dirname,'../..'),roots=[project],git=path.join(project,'.git');if(fs.existsSync(git)&&fs.statSync(git).isFile()){const value=/^gitdir:\s*(.+)/.exec(fs.readFileSync(git,'utf8'))?.[1];if(value)roots.push(path.resolve(project,value,'../../..'));}
const threePath=roots.flatMap(root=>[path.join(root,'extension/node_modules/three/build/three.module.js'),path.join(root,'.vizdiff/build-deps/node_modules/three/build/three.module.js')]).find(fs.existsSync),helper=()=>import('../spike/copperGeometry.mjs'),close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const area=points=>points.slice(1).reduce((sum,b,i)=>sum+points[i][0]*b[1]-b[0]*points[i][1],0)/2;

test('real pad extrusion routes horizontal lids and vertical bore/outer walls to separate depth materials',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{copperCapMaterials}=await import('../spike/renderQuality.mjs'),shape=new THREE.Shape();shape.moveTo(-2,-1);shape.lineTo(2,-1);shape.lineTo(2,1);shape.lineTo(-2,1);shape.closePath();const hole=new THREE.Path();hole.absarc(0,0,.4,0,Math.PI*2,true);shape.holes.push(hole);
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:false,curveSegments:16}),positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal;
 for(const role of ['pad','via']){const materials=copperCapMaterials(THREE,role,{color:0xc9ad67,metalness:.5,roughness:.4});assert.equal(materials.length,2);assert.ok(materials[0].polygonOffsetFactor<0);assert.equal(materials[1].polygonOffset,false);assert.equal(materials[0].color.getHex(),materials[1].color.getHex());
  for(const group of geometry.groups)for(let i=group.start;i<group.start+group.count;i++){const z=Math.abs(normals.getZ(i));assert.equal(group.materialIndex,z>.99?0:1);}
  for(const side of [1,-1]){const mesh=new THREE.Mesh(geometry,materials);mesh.position.z=side*.8;mesh.updateMatrixWorld();const hit=new THREE.Raycaster(new THREE.Vector3(1,0,side*4),new THREE.Vector3(0,0,-side)).intersectObject(mesh)[0];assert.ok(hit);assert.equal(hit.face.materialIndex,0);assert.equal(mesh.material[hit.face.materialIndex],materials[0]);}
  materials.forEach(m=>m.dispose());
 }assert.deepEqual(geometry.attributes.position.array,positions);geometry.dispose();
});

test('split cap/wall materials survive translucent selection and restore the exact source materials',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{copperCapMaterials}=await import('../spike/renderQuality.mjs'),{createSelectionAppearance}=await import('../spike/selectionAppearance.mjs'),geometry=new THREE.BoxGeometry(),materials=copperCapMaterials(THREE,'pad',{color:0xc9ad67}),mesh=new THREE.InstancedMesh(geometry,materials,1);mesh.userData.records=[{uuid:'pad',net:'GND'}];mesh.setMatrixAt(0,new THREE.Matrix4());const appearance=createSelectionAppearance(THREE,()=>[mesh]),sourcePolicies=materials.map(m=>[m.polygonOffset,m.polygonOffsetFactor,m.polygonOffsetUnits]);
 appearance.update(()=>false,true);assert.ok(Array.isArray(mesh.material));assert.notEqual(mesh.material,materials);assert.ok(mesh.material[0].polygonOffsetFactor<0);assert.equal(mesh.material[1].polygonOffset,false);appearance.restore();assert.equal(mesh.material,materials);assert.deepEqual(materials.map(m=>[m.polygonOffset,m.polygonOffsetFactor,m.polygonOffsetUnits]),sourcePolicies);appearance.dispose();geometry.dispose();materials.forEach(m=>m.dispose());
});
test('3D dimming desaturates context, preserves vivid selected instances, and restores exactly',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createSelectionAppearance}=await import('../spike/selectionAppearance.mjs');
 const geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial({color:0x33aa66}),single=new THREE.Mesh(geometry,material),instances=new THREE.InstancedMesh(geometry,material,2);
 single.userData.record={id:'other'};instances.userData.records=[{id:'chosen'},{id:'other'}];
 instances.setColorAt(0,new THREE.Color(0x7733aa));instances.setColorAt(1,new THREE.Color(0x2288cc));
 const sourceColors=instances.instanceColor,sourceValues=Array.from(sourceColors.array),appearance=createSelectionAppearance(THREE,()=>[single,instances]);
 appearance.update(record=>record?.id==='chosen',true);
 assert.notEqual(single.material,material);assert.equal(single.material.color.getHex(),material.color.getHex());assert.equal(single.material.opacity,.24);assert.equal(single.material.transparent,true);
 assert.equal(instances.material.color.getHex(),0xffffff);
 const baseChannels=material.color.toArray(),other=baseChannels.map((value,channel)=>value*sourceValues[3+channel]);
 const contextLuminance=(other[0]*.2126+other[1]*.7152+other[2]*.0722)*.24;
 for(const channel of [0,1,2]){
  close(instances.instanceColor.array[channel],sourceValues[channel]*baseChannels[channel]);
  close(instances.instanceColor.array[3+channel],contextLuminance);
 }
 const shader={fragmentShader:'#include <opaque_fragment>'};single.material.onBeforeCompile(shader);assert.match(shader.fragmentShader,/dot\(outgoingLight/);
 appearance.update(()=>false,true,{translucent:true});
 assert.equal(single.material.color.getHex(),material.color.getHex());assert.equal(single.material.opacity,.14);
 assert.equal(instances.material.color.getHex(),material.color.getHex());assert.equal(instances.material.opacity,.14);
 appearance.update(()=>false,false);
 assert.equal(single.material,material);assert.equal(instances.material,material);assert.equal(instances.instanceColor,sourceColors);assert.deepEqual(Array.from(sourceColors.array),sourceValues);
 appearance.dispose();geometry.dispose();material.dispose();
});
test('circular tessellation scales to radius and reports its bounded error or explicit limit',async()=>{
 const {circularTessellation}=await helper();let prior=0;
 for(const radius of [.05,.2,1,3,100]){const plan=circularTessellation(radius);assert.ok(plan.segments>=24&&plan.segments<=128);assert.ok(plan.segments>=prior);prior=plan.segments;close(plan.error,radius*(1-Math.cos(Math.PI/plan.segments)));assert.equal(plan.limited,plan.error>.0025);}
 for(const radius of [0,-1,NaN,Infinity])assert.throws(()=>circularTessellation(radius),/Invalid/);
});
test('adaptive pad/drill contours retain exact sizes, local holes and winding',async()=>{
 const {smoothPadOutline,smoothDrillOutline}=await helper(),pad={shape:'circle',width:10,height:10,drill:2,drillShape:'circle',drillOffset:[.2,-.3]},outline=smoothPadOutline(pad);
 assert.ok(outline.outline.length>65);assert.ok(outline.tessellation.error<=.0025);assert.ok(area(outline.outline)>0);assert.ok(area(outline.drill)<0);assert.deepEqual(outline.outline[0],outline.outline.at(-1));
 for(const [x,y]of outline.outline)close(Math.hypot(x,y),5);for(const[x,y]of outline.drill)close(Math.hypot(x-.2,y+.3),1);
 const drill=smoothDrillOutline({drill:2,drillWidth:4,drillHeight:2,drillShape:'oval'});close(Math.max(...drill.map(p=>p[0])),2);close(Math.min(...drill.map(p=>p[1])),-1);
 assert.equal(smoothPadOutline({shape:'custom',width:2,height:2}),null);assert.equal(smoothPadOutline({shape:'circle',width:2,height:2,drill:2,drillShape:'circle'}),null);
});
test('outer copper placements are symmetric and separate the substrate by the disclosed display offset',async()=>{
 const {outerCopperPlacement}=await helper(),front=outerCopperPlacement('F.Cu',1.6,.018),back=outerCopperPlacement('B.Cu',1.6,.018);
 close(front.center,-back.center);close(front.base,.783);close(back.base+back.thickness,-.783);close(front.thickness,.018);assert.equal(front.displayOffset,.001);assert.throws(()=>outerCopperPlacement('In1.Cu',1.6,.035),/Invalid/);
});
test('native arc refinement meets sagitta tolerance without changing saved identity or source arrays',async()=>{
 const {refineCopperTracks}=await helper(),parse=require('../design-diff.js').parse,ast=parse('(kicad_pcb (arc (start 100 0) (mid 0 100) (end -100 0) (width .2) (layer "F.Cu") (uuid "arc-one")))'),original=Array.from({length:24},(_,i)=>({id:'arc-one:'+i,start:[100*Math.cos(i*Math.PI/24),100*Math.sin(i*Math.PI/24)],end:[100*Math.cos((i+1)*Math.PI/24),100*Math.sin((i+1)*Math.PI/24)],width:.2,layer:'F.Cu',net:'GND'})),before=JSON.stringify(original),straight={id:'straight',start:[1,2],end:[3,4],width:.01,layer:'F.Cu'};
 const result=refineCopperTracks([...original,straight],ast),arcs=result.tracks.filter(t=>t.uuid==='arc-one');assert.ok(arcs.length>original.length);assert.deepEqual(result.warnings,[]);assert.equal(JSON.stringify(original),before);assert.equal(result.tracks.at(-1),straight);assert.ok(arcs.every(t=>original.some(o=>o.id===t.id)&&t.net==='GND'));
 assert.deepEqual(arcs[0].start,[100,0]);assert.deepEqual(arcs.at(-1).end,[-100,0]);for(const segment of arcs){const mid=[(segment.start[0]+segment.end[0])/2,(segment.start[1]+segment.end[1])/2];assert.ok(100-Math.hypot(...mid)<=.0025+1e-10);}
 const limited=refineCopperTracks(original,ast,{maxSegments:original.length});assert.ok(limited.warnings.some(w=>/budget/.test(w)));assert.equal(limited.tracks[0],original[0]);
});
test('round stroke batches preserve physical extents and CPU ray picking without a minimum-width floor',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{copperStrokeBatches}=await helper(),track={id:'trace',uuid:'trace',start:[0,0],end:[10,0],width:.01},result=copperStrokeBatches(THREE,[track],{world:p=>p,z:.8,thickness:.035}),material=new THREE.MeshBasicMaterial(),group=new THREE.Group(),meshes=[];
 assert.equal(result.batches.length,3);assert.equal(result.batches[1].geometry,result.batches[2].geometry);
 for(const batch of result.batches){const mesh=new THREE.InstancedMesh(batch.geometry,material,batch.records.length),object=new THREE.Object3D();batch.records.forEach((record,index)=>{assert.equal(record,track);batch.place(object,record);object.updateMatrix();mesh.setMatrixAt(index,object.matrix);});mesh.userData.records=batch.records;group.add(mesh);meshes.push(mesh);}
 group.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(group);close(bounds.min.x,-.005,1e-7);close(bounds.max.x,10.005,1e-7);close(bounds.min.y,-.005,1e-7);close(bounds.max.y,.005,1e-7);close(bounds.max.z-bounds.min.z,.035,1e-7);
 const ray=(x,y)=>new THREE.Raycaster(new THREE.Vector3(x,y,10),new THREE.Vector3(0,0,-1)).intersectObjects(meshes,false);
 assert.equal(ray(-.0045,.0045).length,0,'old rectangular cap corner must have no copper');assert.ok(ray(-.0045,0).length>0);assert.equal(ray(-.0045,0)[0].object.userData.records[0].id,'trace');
 const zero=copperStrokeBatches(THREE,[{...track,end:[0,0]}],{world:p=>p,z:0,thickness:.035});assert.equal(zero.batches.length,2,'zero-length segment uses complementary half disks, without a core or coincident full caps');
 const all=new Set([...result.batches,...zero.batches].map(b=>b.geometry));all.forEach(g=>g.dispose());material.dispose();
});
test('saved drill bore walls remain open surfaces and never invent plating volume',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{smoothDrillOutline,drillWallGeometry}=await helper(),loop=smoothDrillOutline({drill:1,drillShape:'circle'}),geometry=drillWallGeometry(THREE,loop,1.5);geometry.computeBoundingBox();
 close(geometry.boundingBox.min.x,-.5);close(geometry.boundingBox.max.x,.5);close(geometry.boundingBox.min.z,0);close(geometry.boundingBox.max.z,1.5);const normal=geometry.getAttribute('normal');for(let i=0;i<normal.count;i++)close(normal.getZ(i),0);
 assert.equal(geometry.index.count,(loop.length-1)*6);assert.throws(()=>drillWallGeometry(THREE,[[0,0],[1,0],[1,1]],1),/Invalid/);geometry.dispose();
});

test('refinement never pushes a near-edge saved drill through its copper contour',async()=>{
 const {smoothPadOutline}=await helper(),coordinate=4.999999/Math.SQRT2,pad={shape:'circle',width:10,height:10,drill:.000001,drillShape:'circle',drillOffset:[coordinate,coordinate]},result=smoothPadOutline(pad);
 assert.ok(result);assert.equal(result.tessellation.limited,true);assert.match(result.tessellation.reason,/containment/);assert.ok(result.drill.length>3);
});

test('80k tracks keep thin-cap triangles independent of a single wide power trace',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{copperStrokeBatches}=await helper(),tracks=Array.from({length:80000},(_,i)=>({id:'t'+i,start:[i*.01,0],end:[i*.01+1,0],width:i===79999?10:.15})),result=copperStrokeBatches(THREE,tracks,{world:p=>p,z:0,thickness:.035});
 assert.equal(result.batches.length,5);assert.equal(result.batches.find(b=>b.part==='start-16').records.length,79999);assert.equal(result.batches.find(b=>b.part==='start-128').records.length,1);assert.equal(result.triangles,6080448);
 assert.ok(result.batches.every(b=>b.records.every(r=>tracks[Number(r.id.slice(1))]===r)));
 new Set(result.batches.map(b=>b.geometry)).forEach(g=>g.dispose());
});

test('selected-net inspection shares adaptive round strokes and saved bore walls',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createNetInspection}=await import('../spike/netInspection.mjs'),track={id:'trace',net:'GND',layer:'In1.Cu',start:[0,0],end:[4,0],width:.15},via={id:'via',net:'GND',at:[5,5],size:1,drill:.5},layers=[{name:'F.Cu',z:.8,thickness:.035},{name:'In1.Cu',z:0,thickness:.035},{name:'B.Cu',z:-.8,thickness:.035}],plan={layers,byLayer:new Map(layers.map(l=>[l.name,l])),viaSpans:new Map([['via',{from:'F.Cu',to:'B.Cu',zMin:-.8,zMax:.8}]]),warnings:[]},inspection=createNetInspection(THREE,{board:{tracks:[track],vias:[via]},plan,zones:[],pads:[],world:p=>p,colorForLayer:()=>0xcccccc});
 const state=inspection.update({netNames:['GND']});assert.equal(state.tracks,1);assert.equal(state.vias,1);assert.ok(state.warnings.some(w=>/plating thickness is not inferred/.test(w)));
 const caps=inspection.group.children.filter(m=>m.geometry.type==='CylinderGeometry');assert.equal(caps.length,2);assert.ok(caps.every(m=>m.geometry.parameters.thetaLength===Math.PI&&m.geometry.parameters.radialSegments===8));
 assert.ok(inspection.group.children.some(m=>m.geometry.type==='BufferGeometry'&&m.geometry.index?.count>0));inspection.dispose();assert.equal(inspection.group.children.length,0);
});

test('asymmetric saved stack keeps copper inside nominal board depth and substrate between its inner faces',async()=>{
 const {sourceCopperPlan}=await import('../spike/copperStack.mjs'),{outerCopperPlacement,substrateEnvelope}=await helper(),board={layers:['F.Cu','B.Cu'],stackup:[{name:'F.Cu',type:'copper',thickness:.07},{name:'dielectric 1',type:'core',thickness:1.495},{name:'B.Cu',type:'copper',thickness:.035}],vias:[]},plan=sourceCopperPlan(board,['kicad_pcb'],1.6),front=plan.byLayer.get('F.Cu'),back=plan.byLayer.get('B.Cu'),substrate=substrateEnvelope(1.6,plan.byLayer),F=outerCopperPlacement('F.Cu',1.6,front.thickness,front.z),B=outerCopperPlacement('B.Cu',1.6,back.thickness,back.z);
 close(front.z,.765);close(back.z,-.7825);close(substrate.top,.73);close(substrate.bottom,-.765);close(substrate.depth,1.495);assert.notEqual(substrate.top,-substrate.bottom,'asymmetric copper leaves an asymmetric substrate envelope');
 close(F.sourceCenter,front.z);close(B.sourceCenter,back.z);close(F.base+F.thickness,.801);close(B.base,-.801);close(F.base-substrate.top,.001);close(substrate.bottom-(B.base+B.thickness),.001);
 assert.equal(substrate.missingOuterDepths,false);assert.throws(()=>substrateEnvelope(1.6,new Map([['F.Cu',{z:-1,thickness:1}],['B.Cu',{z:1,thickness:1}]])),/valid substrate/);
});
