import {createExplodeView} from '../extension/spike/explodeView.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../extension/spike/board3d.js',import.meta.url),'utf8');
const policyCode=source.slice(source.indexOf('export function objectVisibilityPolicy'),source.indexOf('function pathFor')).replace('export ','');
const policy=Function(policyCode+';return objectVisibilityPolicy;')();
const require=createRequire(import.meta.url);
const location=['../extension/node_modules/three/build/three.cjs','../.vizdiff/build-deps/node_modules/three/build/three.cjs'].map(p=>new URL(p,import.meta.url)).find(existsSync);
const THREE=location?require(fileURLToPath(location)):null;

test('3D category filtering composes side, supported categories and common through geometry',()=>{
 const state=policy({hiddenTypes:['pads','bodies','rooms','pads'],side:'top'});
 assert.equal(state.visible('pads','F.Cu'),false);
 assert.equal(state.visible('tracks','F.Cu'),true);
 assert.equal(state.visible('tracks','B.Cu'),false);
 assert.equal(state.visible('vias','through'),true);
 assert.deepEqual(state.unsupportedTypes,['rooms']);
 assert.equal(policy({side:'bottom'}).visible('fills','F.Cu'),false);
 assert.equal(policy({side:'bottom'}).visible('fills','B.Cu'),true);
 assert.equal(policy().visible('pads','B.Cu'),true);
 assert.equal(policy({hiddenTypes:['arcs']}).visible('tracks','F.Cu'),true);
 assert.equal(policy({hiddenTypes:['arcs']}).visible('arcs','F.Cu'),false);
 assert.equal(policy({hiddenTypes:['fills']}).visible('polygons','F.Cu'),true);
 assert.equal(policy({side:'invalid',hiddenTypes:[null,1,'x'.repeat(41)]}).side,'all');
});

test('component visibility restores source matrices and composes population, side and linked models',{skip:!THREE},()=>{
 const board={components:[{layer:'F.Cu'},{layer:'B.Cu'},{layer:'F.Cu'}]},mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial(),3);
 const matrices=[1,2,3].map(x=>new THREE.Matrix4().makeTranslation(x,0,0));
 const models=new Map([[2,new THREE.Group()]]),loaded=new Set([2]);
 const code=source.slice(source.indexOf('  function updateComponentVisibility()'),source.indexOf('  const modelDiagnostics ='));
 const run=state=>Function('THREE','explode','board','componentMesh','population','loadedModelIndexes','componentMatrices','hiddenMatrix','modelGroups','renderer','invalidate','objectVisibility',code+';updateComponentVisibility();')(THREE,createExplodeView(THREE,{layers:[{name:'F.Cu',z:.8},{name:'B.Cu',z:-.8}]}),board,mesh,[true,true,true],loaded,matrices,new THREE.Matrix4().makeScale(0,0,0),models,{shadowMap:{}},()=>{},state);
 const result=new THREE.Matrix4();run(policy({side:'top'}));mesh.getMatrixAt(0,result);assert.equal(result.elements[12],1);mesh.getMatrixAt(1,result);assert.equal(result.determinant(),0);assert.equal(models.get(2).visible,true);
 run(policy({hiddenTypes:['bodies']}));mesh.getMatrixAt(0,result);assert.equal(result.determinant(),0);assert.equal(models.get(2).visible,false);
 run(policy());mesh.getMatrixAt(1,result);assert.equal(result.elements[12],2);mesh.getMatrixAt(2,result);assert.equal(result.determinant(),0,'resolved model never restores its proxy');assert.equal(models.get(2).visible,true);
});

test('scene filter composes with existing Display groups without changing camera or saved layer toggles',()=>{
 const code=source.slice(source.indexOf('    setObjectVisibility(input={}'),source.indexOf('    setMeasurementMode,clearMeasurements'));
 const front={visible:false},back={visible:true},track={visible:true,parent:front},pad={visible:true,parent:back};
 const records=[{mesh:track,type:'tracks',layer:'F.Cu'},{mesh:pad,type:'pads',layer:'B.Cu'}];
 const camera={zoom:7,position:[1,2,30]},before=JSON.stringify(camera);let changes=0;
 const api=Function('objectVisibilityPolicy','visibilityRecords','updateComponentVisibility','setSelection','externalSelection',`const mechanical=false;let objectVisibility=objectVisibilityPolicy(),userAdjustedCamera=false;return {${code}adjusted:()=>userAdjustedCamera};`)(policy,records,()=>{},()=>changes++,{});
 const hidden=api.setObjectVisibility({hiddenTypes:['tracks','rooms'],side:'bottom'});
 assert.equal(track.visible,false);assert.equal(pad.visible,true);assert.equal(front.visible,false);assert.equal(back.visible,true);
 assert.deepEqual(hidden.unsupportedTypes,['rooms']);assert.equal(api.adjusted(),true);
 api.setObjectVisibility({hiddenTypes:[],side:'all'});assert.equal(track.visible,true);assert.equal(front.visible,false,'restoring objects must not reopen a Display-hidden copper layer');assert.equal(JSON.stringify(camera),before);assert.equal(changes,2);
});
