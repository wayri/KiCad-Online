const test = require('node:test');
const assert = require('node:assert/strict');
const {existsSync} = require('node:fs');
const path = require('node:path');

const threePath = [
  '../node_modules/three/build/three.cjs',
  '../../.vizdiff/build-deps/node_modules/three/build/three.cjs'
].map(file => path.resolve(__dirname, file)).find(existsSync);
const THREE = threePath && require(threePath);
const copper = () => import('../spike/copperDepth.mjs');
const depthChunk = '#include <logdepthbuf_fragment>';

function compile(material, logarithmicDepthBuffer, fragmentShader = depthChunk) {
  const shader = {fragmentShader, uniforms:{}};
  material.onBeforeCompile(shader, {capabilities:{logarithmicDepthBuffer}});
  return shader.fragmentShader;
}

test('fragment-written depth preserves copper precedence with a depth unit margin', async () => {
  const {configureCopperDepth} = await copper();
  const materials = ['zone', 'track', 'pad', 'via', 'selection'].map(role =>
    configureCopperDepth({customProgramCacheKey:() => 'base'}, role, 'cap'));
  const offsets = materials.map(material => {
    const shader = compile(material, true);
    assert.equal(material.polygonOffset, false);
    assert.ok(shader.includes('#ifdef USE_LOGDEPTHBUF'));
    const match = shader.match(/gl_FragDepth = clamp\(gl_FragDepth \+ ([\deE+.-]+) \* kicadCopperDepthMargin, 0.0, 1.0\)/);
    assert.ok(match, 'the fragment depth is clamped after applying the role bias');
    return Number(match[1]) * 4 / (2 ** 24 - 1);
  });
  assert.ok(offsets[0] > 0 && offsets[1] < 0);
  assert.ok(Math.abs(offsets.at(-1) * (2 ** 24 - 1) - (-64)) < 1e-9);
  assert.equal(new Set(materials.map(material => material.customProgramCacheKey())).size, materials.length);
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(offsets[i - 1] - offsets[i] > 1 / (2 ** 24 - 1));
  }
});

test('direct copper bias follows the default framebuffer and composer targets preserve the 24-bit margin', async () => {
  const {configureCopperDepth, registerCopperDepthPrecision} = await copper();
  let bits = 16;
  const renderer = {getContext:() => ({DEPTH_BITS:1, getParameter:() => bits})};
  const scene = {};
  registerCopperDepthPrecision(renderer, scene);
  const material = configureCopperDepth({customProgramCacheKey:() => 'base'}, 'track');
  const shader = {fragmentShader:depthChunk, uniforms:{}};
  material.onBeforeCompile(shader, renderer);
  const margin = shader.uniforms.kicadCopperDepthMargin;
  assert.equal(margin.value, 1 / 65535);
  scene.onBeforeRender(renderer, scene, {}, {});
  assert.equal(margin.value, 4 / (2 ** 24 - 1));
  scene.onBeforeRender(renderer, scene, {}, null);
  assert.equal(margin.value, 1 / 65535);
  bits = 24;
  registerCopperDepthPrecision(renderer, scene);
  scene.onBeforeRender(renderer, scene, {}, null);
  assert.equal(margin.value, 4 / (2 ** 24 - 1));
});

test('ordinary-depth probes own reusable copper caps and share unbiased walls', {skip:!THREE}, async () => {
  const {copperCapMaterials, copperDepthPolicy, createLinearCopperMaterials} = await copper();
  const source = copperCapMaterials(THREE, 'via', {color:0xc5aa6c}, {logarithmicDepth:true});
  const alternatives = createLinearCopperMaterials();
  const independent = new THREE.MeshStandardMaterial();
  const probe = alternatives.forMaterial(source);
  const [mainCap, wall] = source;
  const [probeCap] = probe;
  assert.notEqual(mainCap, probeCap);
  assert.equal(probe[1], wall);
  assert.equal(alternatives.forMaterial(source), probe);
  assert.equal(alternatives.forMaterial(mainCap), probeCap);
  assert.equal(alternatives.forMaterial(independent), independent);
  assert.equal(wall.polygonOffset, false);
  assert.equal(compile(wall, true), depthChunk);
  const policy = copperDepthPolicy('via', 'cap');
  const fragment = THREE.ShaderLib.standard.fragmentShader;
  for (let render = 0; render < 2; render++) {
    assert.ok(compile(mainCap, true, fragment).includes('gl_FragDepth = clamp'));
    assert.equal(compile(probeCap, false, fragment), fragment);
    assert.equal(mainCap.polygonOffset, false);
    assert.equal(probeCap.polygonOffset, true);
    assert.equal(probeCap.polygonOffsetUnits, policy.polygonOffsetUnits);
    assert.equal(probeCap.polygonOffsetFactor, policy.polygonOffsetFactor);
  }
  mainCap.color.setHex(0x112233);
  mainCap.roughness = .42;
  alternatives.sync();
  assert.equal(probeCap.color.getHex(), mainCap.color.getHex());
  assert.equal(probeCap.roughness, mainCap.roughness);
  assert.equal(probeCap.polygonOffset, true);
  const disposed = [];
  for (const material of [mainCap, wall, probeCap, independent]) {
    material.addEventListener('dispose', () => disposed.push(material));
  }
  alternatives.dispose();
  alternatives.dispose();
  assert.deepEqual(disposed, [probeCap]);
  for (const material of [...source, independent]) material.dispose();
});

test('GTAO normal target uses projection depth while retaining existing shader hooks', async () => {
  const {configureOcclusionDepth} = await import('../spike/renderQuality.mjs');
  const material = {
    onBeforeCompile(shader) { shader.fragmentShader += '\n// inherited'; },
    customProgramCacheKey() { return 'normal-material'; }
  };
  configureOcclusionDepth(material);
  const source = THREE?.ShaderLib.normal.fragmentShader ?? depthChunk + '\nvec4 normalOutput;';
  const result = compile(material, true, source);
  assert.equal(result, source.replace(depthChunk, '') + '\n// inherited');
  assert.equal(material.customProgramCacheKey(), 'normal-material|perspective-occlusion-depth-v1');
  assert.throws(() => compile(material, true, 'missing include'), /Unsupported occlusion depth shader/);
});
