import assert from 'node:assert/strict';
import test from 'node:test';
import { viewportPixelRatio,probeViewportPlan,qualityName,qualityViewport,graphicsProfile,boardOcclusion,padHasMaskOpening, boardClipRange, studioLights, studioMaterials } from '../extension/spike/renderQuality.mjs';

test('mobile graphics tiers use actual limits instead of treating touch screens as low GPUs',()=>{
 const premium=graphicsProfile({maxTextureSize:16384,maxRenderbufferSize:16384,deviceMemory:8,hardwareConcurrency:8,floatTargets:true,android:true});
 assert.equal(premium.tier,'premium');assert.equal(premium.defaultQuality,'sharp');
 const phone=qualityViewport(390,740,3,premium.maxDimension,'high',premium);assert.equal(phone.ratio,3);assert.ok(phone.estimatedBytes<300_000_000);
 const standard=graphicsProfile({maxTextureSize:8192,deviceMemory:4,floatTargets:true,android:true});assert.equal(standard.tier,'standard');assert.equal(standard.defaultQuality,'sharp');
 const low=graphicsProfile({maxTextureSize:16384,deviceMemory:2,floatTargets:true,android:true});assert.equal(low.tier,'constrained');assert.equal(low.defaultQuality,'sharp');
 assert.equal(graphicsProfile({maxTextureSize:16384,deviceMemory:8,floatTargets:false,android:true}).defaultQuality,'sharp');
 assert.equal(graphicsProfile({maxTextureSize:16384,maxRenderbufferSize:4096,deviceMemory:8,floatTargets:true,android:true}).tier,'constrained');
 assert.equal(graphicsProfile({maxTextureSize:16384,deviceMemory:8,floatTargets:true,android:false}).defaultQuality,'sharp');
});

test('tablet high detail remains within reported renderbuffer dimensions and bounded memory',()=>{
 for(const memory of [2,4,8,undefined])for(const size of [4096,8192,16384])for(const [width,height]of [[390,740],[1536,1100],[1100,1536],[3840,2160]]){
  const profile=graphicsProfile({maxTextureSize:size,maxRenderbufferSize:size,deviceMemory:memory,floatTargets:true,hardwareConcurrency:8,android:true});
  const plan=qualityViewport(width,height,3,profile.maxDimension,'high',profile);
  assert.ok(plan.width<=size&&plan.height<=size);assert.ok(plan.pixels<=profile.highMaxPixels);assert.ok(plan.estimatedBytes<300_000_000);
 }
 assert.equal(graphicsProfile({maxTextureSize:16384,floatTargets:true,hardwareConcurrency:8,android:true}).tier,'premium');
 assert.equal(graphicsProfile({maxTextureSize:8192,floatTargets:true,hardwareConcurrency:8,android:true}).tier,'standard');
});

test('exposed-pad material follows saved mask layer membership for each side',()=>{
 assert.equal(padHasMaskOpening({layers:['F.Cu','F.Mask']},'F.Cu'),true);
 assert.equal(padHasMaskOpening({layers:['F.Cu','F.Mask']},'B.Cu'),false);
 assert.equal(padHasMaskOpening({layers:['*.Cu','*.Mask']},'B.Cu'),true);
 assert.equal(padHasMaskOpening({layers:['F.Cu']},'F.Cu'),false);
 assert.equal(padHasMaskOpening({},'F.Cu'),false);
});

test('quality preferences reject unknown values and constrain post-processing memory on phones',()=>{
 assert.equal(qualityName('high'),'high');for(const value of ['HIGH','off',null,{},'__proto__'])assert.equal(qualityName(value),'balanced');
 for(const constrained of [true,false])for(const [width,height]of [[390,844],[844,390],[1536,1100],[3840,2160],[9000,500]])for(const quality of ['low','balanced','high']){
  const plan=qualityViewport(width,height,3,4096,quality,constrained);
  assert.ok(plan.pixels<=plan.maxPixels+1);assert.ok(plan.width<=4096&&plan.height<=4096);assert.ok(plan.width>0&&plan.height>0);
  assert.ok(plan.estimatedBytes<=(constrained?105_000_000:201_000_000),'framebuffer estimate exceeds budget');
 }
 assert.ok(qualityViewport(1500,1000,3,4096,'high',true).maxPixels<qualityViewport(1500,1000,3,4096,'high',false).maxPixels);
});
test('ambient occlusion uses bounded PCB millimetres rather than a scene-sized radius',()=>{
 for(const thickness of [.1,1.6,10,NaN,-1]){const ao=boardOcclusion(thickness);assert.ok(ao.radius>=.35&&ao.radius<=3);assert.ok(ao.thickness>=.12&&ao.thickness<=1);assert.equal(ao.screenSpaceRadius,false);assert.equal(ao.samples,12);}
 assert.equal(boardOcclusion(1.6).radius,1.36);
});

test('studio illumination is symmetric across the PCB plane without an overexposed ambient fill',()=>{
 const illuminance=z=>studioLights.reduce((total,light)=>total+light.intensity*Math.max(0,z*light.z)/Math.hypot(light.x,light.y,light.z),0);
 assert.ok(illuminance(1)>1&&illuminance(1)<2);
 assert.equal(illuminance(1),illuminance(-1));
 assert.ok(studioLights.some(light=>light.x<0)&&studioLights.some(light=>light.x>0));
 for(const material of Object.values(studioMaterials)){assert.ok(material.roughness>=0&&material.roughness<=1);assert.ok(material.metalness>=0&&material.metalness<=1);}
 assert.ok(studioMaterials.copper.metalness>studioMaterials.solderMask.metalness);
 assert.ok(studioMaterials.copper.roughness<studioMaterials.solderMask.roughness);
});

test('high density phone retains native 3x detail within bounded framebuffer', () => {
  assert.equal(viewportPixelRatio(390, 740, 3), 3);
  assert.equal(viewportPixelRatio(390, 740, 4), 3);
  assert.equal(viewportPixelRatio(1440, 900, 1), 1);
});

test('tablet, foldable and desktop framebuffer budget holds in both orientations', () => {
  for (const [w, h] of [[1536, 1100], [1100, 1536], [3840, 2160], [7680, 4320], [9000, 400]]) {
    const ratio = viewportPixelRatio(w, h, 3);
    assert.ok(w * h * ratio * ratio <= 4_000_000 + 1e-6);
    assert.ok(w * ratio <= 4096 + 1e-6 && h * ratio <= 4096 + 1e-6);
    assert.ok(ratio > 0 && ratio <= 3);
  }
  assert.equal(viewportPixelRatio(9000, 400, 3), 4096 / 9000);
  assert.equal(viewportPixelRatio(1200, 600, 3, 1024), 1024 / 1200);
});

test('invalid viewport metrics never create an invalid WebGL pixel ratio', () => {
  for (const input of [[0, 0, 0], [NaN, undefined, Infinity], [-1, -1, -1]]) {
    const ratio = viewportPixelRatio(...input);
    assert.ok(Number.isFinite(ratio) && ratio > 0);
  }
});

test('board clip interval contains the fitted board at all normal orbit distances', () => {
  for (const radius of [.5, 20, 150, 3000]) for (const factor of [2.7, 5, 32]) {
    const distance = radius * factor, range = boardClipRange(distance, radius);
    assert.ok(range.near < distance - radius);
    assert.ok(range.far > distance + radius);
    assert.ok(range.near > 0 && range.far > range.near);
  }
});

test('large-board overview resolves thin copper depth at the far edge', () => {
  const distance = 2000, radius = 1000;
  const {near, far} = boardClipRange(distance, radius);
  const farEdge = distance + radius;
  const depthStep = farEdge ** 2 * (1 / near - 1 / far) / (2 ** 24 - 1);
  assert.ok(near < distance - radius && far > farEdge);
  assert.ok(depthStep < .001, '24-bit perspective depth resolves one micrometre at the far edge');
});

test('normal board view improves depth precision and close inspection lowers the near plane', () => {
  const normal = boardClipRange(150, 50);
  assert.ok(normal.far / normal.near < 3000 / .1);
  const range = boardClipRange(2, 50);
  // Distance-scaled near plane preserves depth precision; only extreme
  // close inspection reaches the minimum clip distance.
  assert.equal(range.near, .1);
  assert.equal(boardClipRange(.2, 50).near, .01);
  assert.equal(boardClipRange(.05, 50).near, .005);
  assert.equal(range.far, 202);
  for (const d of [NaN, Infinity, -1]) {
    const fallback = boardClipRange(d, d);
    assert.ok(Number.isFinite(fallback.near) && Number.isFinite(fallback.far));
  }
});

test('sharp edge mode preserves balanced resolution with bounded postprocessing memory',()=>{for(const size of [[1920,1080],[390,740],[3840,2160]])for(const limited of [false,true]){const sharp=qualityViewport(...size,2,4096,'sharp',limited);assert.equal(qualityName('sharp'),'sharp');assert.ok(sharp.pixels<=sharp.maxPixels);assert.ok(sharp.estimatedBytes<300000000);if(!limited)assert.equal(sharp.ratio,qualityViewport(...size,2,4096,'balanced',limited).ratio);}});
test('3D probe HiDPI sampling retains its original half-million-pixel ceiling',()=>{assert.equal(probeViewportPlan(300,300,2).ratio,2);for(const [w,h,dpr]of [[320,320,3],[2000,1000,3],[1,1,0],[NaN,-1,Infinity]]){const plan=probeViewportPlan(w,h,dpr);assert.ok(plan.width*plan.height<=500000);assert.ok(plan.width<=1024&&plan.height<=1024);assert.ok(plan.ratio>0&&plan.ratio<=2);}});
