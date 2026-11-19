const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');

const threePath = [
  '../node_modules/three/build/three.cjs',
  '../../.vizdiff/build-deps/node_modules/three/build/three.cjs'
].map(file => path.resolve(__dirname, file)).find(existsSync);
const THREE = threePath && require(threePath);
const helpers = import('../spike/selectionAppearance.mjs');

function compile(material) {
  const {vertexShader, fragmentShader} = THREE.ShaderLib.standard;
  const shader = {vertexShader, fragmentShader};
  material.onBeforeCompile(shader, {});
  return shader;
}

test('net context preserves matching via gold and fades only the other instances in a shared draw', {skip: !THREE}, async () => {
  const {createSelectionAppearance} = await helpers;
  const material = new THREE.MeshStandardMaterial({color: 0xc5aa6c});
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 2);
  mesh.userData.records = [{id:'a',net:'GND'}, {id:'b',net:'VCC'}];
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.setColorAt(1, new THREE.Color(0, .25, 1));
  const colors = mesh.instanceColor, original = [...colors.array], matrices = mesh.instanceMatrix;
  const depth = new THREE.MeshDepthMaterial();
  mesh.customDepthMaterial = depth;
  const hook = function(shader) {
    assert.notEqual(this, material);
    shader.fragmentShader += '\n// saved copper depth hook';
  };
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => 'copper-depth';
  const appearance = createSelectionAppearance(THREE, () => [mesh]);
  appearance.update(record => record?.net === 'GND', true, {netContext:true});
  const displayed = mesh.material, indices = mesh.instanceColor;
  assert.equal(displayed.color.getHex(), 0xc5aa6c);
  assert.equal(displayed.transparent, true);
  assert.equal(displayed.depthWrite, false);
  assert.deepEqual([...indices.array], [1,1,1, -1,.25,1]);
  assert.notEqual(indices, colors);
  assert.match(displayed.customProgramCacheKey(), /copper-depth/);
  const shader = compile(displayed);
  assert.match(shader.fragmentShader, /saved copper depth hook/);
  assert.match(shader.vertexShader, /vNetContext = instanceColor\.r < 0\.0/);
  assert.match(shader.fragmentShader, /if \(vNetContext > 0\.5\) \{\s*outgoingLight = vec3\(dot\(outgoingLight,[^;]+;\s*diffuseColor\.a \*= 0\.24;/);
  appearance.update(record => record?.net === 'VCC', true, {netContext:true});
  assert.equal(mesh.instanceColor, indices);
  assert.deepEqual([...indices.array], [-2,1,1, 0,.25,1]);
  let disposed = 0;
  displayed.addEventListener('dispose', () => disposed++);
  appearance.update(() => false, true, {translucent:true});
  assert.equal(disposed, 1);
  assert.equal(mesh.instanceColor, colors);
  assert.equal(mesh.material.opacity, .14);
  appearance.restore();
  assert.equal(mesh.material, material);
  assert.equal(mesh.customDepthMaterial, depth);
  assert.equal(mesh.instanceMatrix, matrices);
  assert.equal(material.onBeforeCompile, hook);
  assert.deepEqual([...colors.array], original);
});

test('a connected textured model and board structures remain gray context while the selected pad retains its material', {skip: !THREE}, async () => {
  const {createSelectionAppearance} = await helpers;
  const texture = new THREE.Texture(), source = new THREE.MeshStandardMaterial({color:0x55aa22,map:texture});
  const geometry = new THREE.BoxGeometry();
  const model = new THREE.Mesh(geometry,[source,source]);
  model.userData.record = {type:'Component',ref:'U1'};
  const pad = new THREE.Mesh(geometry,source);
  pad.userData.record = {type:'Pad',ref:'U1',net:'GND'};
  const substrate = new THREE.Mesh(geometry,source);
  substrate.userData.record = {type:'Board'};
  substrate.visible = false;
  const original = model.material;
  const appearance = createSelectionAppearance(THREE, () => [model,pad,substrate]);
  appearance.update(record => record?.ref === 'U1', true, {netContext:true});
  assert.equal(pad.material, source);
  for (const material of [...model.material, substrate.material]) {
    assert.notEqual(material, source);
    assert.equal(material.map, texture);
    assert.equal(material.transparent, true);
    assert.equal(material.opacity, .24);
    assert.equal(material.depthWrite, false);
    const {fragmentShader} = compile(material);
    assert.ok(fragmentShader.indexOf('#include <map_fragment>') < fragmentShader.indexOf('dot(outgoingLight'));
    assert.match(fragmentShader, /dot\(outgoingLight/);
  }
  assert.equal(substrate.visible, false);
  appearance.update(record => record?.ref === 'U1', true);
  assert.equal(model.material, original);
  appearance.dispose();
  assert.equal(substrate.material, source);
  assert.equal(source.opacity, 1);
  assert.equal(source.depthWrite, true);
});

test('ordinary dimmed meshes share one clone and restore without disposing the source', {skip: !THREE}, async () => {
  const {createSelectionAppearance} = await helpers;
  const material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.BoxGeometry();
  const objects = Array.from({length: 128}, () => new THREE.Mesh(geometry, material));
  const appearance = createSelectionAppearance(THREE, () => objects);
  try {
    appearance.update(() => false, true, {netContext:true});
    assert.notEqual(objects[0].material, material);
    assert.equal(new Set(objects.map(object => object.material)).size, 1);
    assert.equal(appearance.stats().sharedDimMaterials, 1);
    let disposed = 0;
    objects[0].material.addEventListener('dispose', () => disposed++);
    appearance.restore();
    appearance.restore();
    assert.equal(disposed, 1);
    assert.ok(objects.every(object => object.material === material));
  } finally {
    appearance.dispose();
    geometry.dispose();
    material.dispose();
  }
});
