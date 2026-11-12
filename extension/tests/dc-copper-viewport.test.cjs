const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const dependency = [path.join(root, 'extension/node_modules'), path.join(root, '.vizdiff/build-deps/node_modules')].find(p => fs.existsSync(path.join(p, 'three')));
async function modules() {
  assert.ok(dependency, 'Three.js build dependencies are installed');
  return Promise.all([
    import(pathToFileURL(path.join(root, 'extension/spike/dcCopperViewport.mjs')).href),
    import(pathToFileURL(path.join(dependency, 'three/build/three.module.js')).href)
  ]);
}

test('3D copper bridge maps an instanced saved hit through board origin and exploded layer', async () => {
  const [{ createDCCopperViewport }, THREE] = await modules();
  const scene = new THREE.Scene();
  const layer = new THREE.Group(); layer.position.z = 1; scene.add(layer);
  const record = { id: 'track-1', net: 'PWR', layer: 'F.Cu' };
  const copper = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 1);
  const instance = new THREE.Object3D(); instance.position.set(2, -3, 0); instance.updateMatrix(); copper.setMatrixAt(0, instance.matrix);
  copper.userData.records = [record]; layer.add(copper);
  const model = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial()); model.position.set(2, -3, 2); scene.add(model);
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, right: 110, bottom: 120, width: 100, height: 100 }) };
  let active = true;
  const bridge = createDCCopperViewport(THREE, { canvas, getCamera: () => camera, getCopperMeshes: () => [{ mesh: copper, layer: 'F.Cu' }], getLayerZ: name => name === 'F.Cu' ? 1 : NaN, centerX: 100, centerY: 200, isActive: () => active });
  assert.equal(bridge.canvas, canvas);
  assert.deepEqual(bridge.project({ x: 102, y: 203, layer: 'F.Cu' }), { x: 70, y: 80 });
  const hits = bridge.pick(80, 100);
  assert.ok(hits.length > 0);
  assert.deepEqual({ x: hits[0].x, y: hits[0].y, layer: hits[0].layer, netName: hits[0].netName, record: hits[0].record }, { x: 102, y: 203, layer: 'F.Cu', netName: 'PWR', record });
  assert.deepEqual(bridge.pick(15, 25), []);
  assert.deepEqual(bridge.pick(120, 100), []);
  assert.equal(bridge.project({ x: 102, y: 203, layer: 'unknown' }), null);
  layer.visible = false; assert.deepEqual(bridge.pick(80, 100), []);
  layer.visible = true; active = false; assert.deepEqual(bridge.pick(80, 100), []);
  assert.equal(bridge.project({ x: 102, y: 203, layer: 'F.Cu' }), null);
});

test('3D copper bridge uses the current perspective camera and rejects points behind it', async () => {
  const [{ createDCCopperViewport }, THREE] = await modules();
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 }) };
  const bridge = createDCCopperViewport(THREE, { canvas, getCamera: () => camera, getCopperMeshes: () => [], getLayerZ: () => 0, centerX: 0, centerY: 0, isActive: () => true });
  assert.deepEqual(bridge.project({ x: 0, y: 0, layer: 'F.Cu' }), { x: 100, y: 100 });
  camera.position.set(0, 0, -10); camera.lookAt(0, 0, -20);
  assert.equal(bridge.project({ x: 0, y: 0, layer: 'F.Cu' }), null);
});

test('opt-in inner-layer result follows saved elevation and live explode offset', async () => {
  const [{ dcBoardLayerZ, dcBoardLayerOverlay }, THREE] = await modules();
  const layers = new Map([['F.Cu', { z: 1 }], ['In1.Cu', { z: .25 }], ['B.Cu', { z: -1 }]]);
  let gap = 0;
  const explode = { offset: layer => layer === 'In1.Cu' ? gap : 0 };
  const surface = { boardLayer: true, layer: 'In1.Cu', points: [[102, 203, 0]] };
  const placement = dcBoardLayerOverlay(surface, layers, explode, 100, 200);
  assert.ok(placement);
  assert.deepEqual(placement.transform(surface.points[0]), [2, -3, .25]);
  const group = new THREE.Group(); placement.update(group);
  assert.equal(group.position.z, 0);
  assert.equal(placement.transform(surface.points[0])[2] + group.position.z, dcBoardLayerZ(layers, explode, 'In1.Cu'));
  gap = 2.5; placement.update(group);
  assert.equal(group.position.z, 2.5);
  assert.equal(placement.transform(surface.points[0])[2] + group.position.z, dcBoardLayerZ(layers, explode, 'In1.Cu'));
  assert.equal(dcBoardLayerOverlay({ ...surface, layer: 'unknown' }, layers, explode, 100, 200), null);
  assert.equal(dcBoardLayerOverlay({ ...surface, points: [[102, 203, 1]] }, layers, explode, 100, 200), null);
});

test('saved KiCad named-net zone retains its identity for direct 3D contact picking',async()=>{const {sourceZoneGeometry}=await import('../spike/sourceGeometry.mjs');const {parse}=require('../design-diff.js');const ast=parse(require('node:fs').readFileSync(require.resolve('./fixtures/fast-pi/dc-strip.kicad_pcb'),'utf8'));assert.equal(sourceZoneGeometry(ast).records[0].net,'VCC');});
