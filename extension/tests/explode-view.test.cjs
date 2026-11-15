const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const project=path.resolve(__dirname,'../..'),roots=[project],gitFile=path.join(project,'.git');
if(fs.existsSync(gitFile)&&fs.statSync(gitFile).isFile()){const value=/^gitdir:\s*(.+)/.exec(fs.readFileSync(gitFile,'utf8'))?.[1];if(value)roots.push(path.resolve(project,value,'../../..'));}
const threePath=roots.flatMap(root=>[path.join(root,'extension/node_modules/three/build/three.module.js'),path.join(root,'.vizdiff/build-deps/node_modules/three/build/three.module.js')]).find(fs.existsSync);
const plan={layers:['F.Cu','In1.Cu','In2.Cu','In3.Cu','In4.Cu','B.Cu'].map((name,i)=>({name,z:1-i*.4}))};
test('six saved copper layers separate symmetrically and restore exact positions without changing records',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createExplodeView}=await import('../spike/explodeView.mjs'),view=createExplodeView(THREE,plan),before=JSON.stringify(plan),objects=plan.layers.map(l=>{const o=new THREE.Group();o.position.set(3,4,l.z);return o;});
 for(const amount of [100,50,100,0]){view.set(amount);objects.forEach((o,i)=>view.layer(o,plan.layers[i].name));assert.deepEqual(objects.map(o=>o.position.x),Array(6).fill(3));assert.deepEqual(objects.map(o=>o.position.y),Array(6).fill(4));assert.deepEqual(objects.map(o=>o.position.z),plan.layers.map((l,i)=>l.z+(2.5-i)*4*amount/100));}
 assert.equal(JSON.stringify(plan),before);assert.equal(view.offset('unknown'),0);assert.equal(view.set(200),100);assert.equal(view.set(-1),0);assert.throws(()=>view.set(NaN),/finite/);assert.throws(()=>view.set(Infinity),/finite/);
});
test('blind via barrel follows its two saved layers and restores the original instance matrix',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createExplodeView}=await import('../spike/explodeView.mjs'),view=createExplodeView(THREE,plan),span={zMin:plan.layers[4].z,zMax:plan.layers[1].z},height=span.zMax-span.zMin,geometry=new THREE.BoxGeometry(1,1,height),material=new THREE.MeshBasicMaterial(),mesh=new THREE.InstancedMesh(geometry,material,1),record={uuid:'blind-via',net:'VCC'};
 mesh.userData.records=[record];mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(3,4,span.zMin));const original=[...mesh.instanceMatrix.array],matrix=new THREE.Matrix4();
 for(const amount of [100,25,100,0]){view.set(amount);view.barrels(mesh,span);mesh.getMatrixAt(0,matrix);const bottom=new THREE.Vector3(0,0,0).applyMatrix4(matrix),top=new THREE.Vector3(0,0,height).applyMatrix4(matrix);assert.ok(Math.abs(bottom.z-(span.zMin+view.offset('In4.Cu')))<1e-5);assert.ok(Math.abs(top.z-(span.zMax+view.offset('In1.Cu')))<1e-5);assert.equal(bottom.x,3);assert.equal(bottom.y,4);assert.equal(mesh.userData.records[0],record);assert.equal(mesh.geometry,geometry);}
 assert.deepEqual([...mesh.instanceMatrix.array],original);geometry.dispose();material.dispose();
});
test('expanded assembly lifts components beyond outer copper and reveals inner layers without changing identities',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{createExplodeView}=await import('../spike/explodeView.mjs'),view=createExplodeView(THREE,plan);
 const front=new THREE.Group(),back=new THREE.Group(),inner=new THREE.Mesh(new THREE.BoxGeometry(1,1,.035),new THREE.MeshBasicMaterial());
 const record={uuid:'inner-pad',net:'GND'};inner.userData.record=record;inner.userData.layer='In2.Cu';inner.position.z=plan.layers[2].z;
 const selected=new THREE.Group();selected.add(inner);front.position.z=.7;back.position.z=-.7;
 for(const amount of [60,100,25,0]){
  view.set(amount);view.component(front,'front');view.component(back,'back');view.overlay(selected);
  assert.ok(front.position.z>=.7+view.offset('F.Cu'));
  assert.ok(back.position.z<=-.7+view.offset('B.Cu'));
  assert.ok(Math.abs(inner.position.z-plan.layers[2].z-view.offset('In2.Cu'))<1e-9);
  assert.equal(inner.userData.record,record);assert.equal(view.substrateOpacity(),1-.88*amount/100);
 }
 assert.equal(front.position.z,.7);assert.equal(back.position.z,-.7);assert.equal(inner.position.z,plan.layers[2].z);
 inner.geometry.dispose();inner.material.dispose();
});
