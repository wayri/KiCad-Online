const test=require('node:test'),assert=require('node:assert/strict');

test('first-use 3D quality is crisp and bounded across graphics tiers',async()=>{
 const {graphicsProfile,qualityViewport}=await import('../spike/renderQuality.mjs');
 for(const capabilities of [
  {maxTextureSize:4096,deviceMemory:2,android:true},
  {maxTextureSize:8192,deviceMemory:4},
  {maxTextureSize:16384,deviceMemory:8,floatTargets:true,android:true}
 ]){
  const profile=graphicsProfile(capabilities),viewport=qualityViewport(1440,900,2,profile.maxDimension,profile.defaultQuality,profile);
  assert.equal(profile.defaultQuality,'sharp');
  assert.equal(viewport.quality,'sharp');
  assert.ok(viewport.pixels<=viewport.maxPixels);
  assert.ok(viewport.width<=profile.maxDimension&&viewport.height<=profile.maxDimension);
 }
});
