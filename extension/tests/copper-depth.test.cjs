const test=require('node:test'),assert=require('node:assert/strict');
const quality=()=>import('../spike/renderQuality.mjs');

test('pad and via cap bias dominates coplanar tracks at face-on and grazing slopes while walls remain unbiased',async()=>{
 const {copperDepthPolicy}=await quality(),track=copperDepthPolicy('track'),pad=copperDepthPolicy('pad','cap'),via=copperDepthPolicy('via','cap');
 for(const slope of [0,1e-8,1e-5,.001,.1,1,100,10000])for(const bits of [16,24,32]){
  const unit=1/(2**bits-1),depth=p=>slope*p.polygonOffsetFactor+p.polygonOffsetUnits*unit;
  assert.ok(depth(pad)<depth(track)-unit,'pad wins with a depth-unit interpolation margin');assert.ok(depth(via)<depth(pad)-unit);
  assert.ok(-2*slope-16*unit<depth(via),'selection tint stays in front of the copper caps');
 }
 for(const role of ['pad','via']){const wall=copperDepthPolicy(role,'wall');assert.equal(wall.polygonOffset,false);assert.equal(wall.polygonOffsetFactor,0);assert.equal(wall.polygonOffsetUnits,0);}
 assert.throws(()=>copperDepthPolicy('pad','unknown'),/surface kind/);
});
test('overlapping copper has deterministic depth precedence on both board faces',async()=>{
 const {copperDepthPolicy}=await quality(),roles=['zone','track','pad','via'];
 const values=roles.map(role=>copperDepthPolicy(role));
 for(const value of values){assert.equal(value.polygonOffset,true);assert.ok(Number.isFinite(value.polygonOffsetFactor));assert.ok(Number.isFinite(value.polygonOffsetUnits));}
 // For either face, lower depth wins independently of world-Z sign. The
 // fixed-point term separates flat, coplanar caps even at zero depth slope.
 for(let i=1;i<values.length;i++)for(const slope of [0,.01,1,100]){
  const bias=value=>slope*value.polygonOffsetFactor+value.polygonOffsetUnits/2**24;
  assert.ok(bias(values[i])<bias(values[i-1]));
 }
 for(const bad of ['unknown','toString','constructor'])assert.throws(()=>copperDepthPolicy(bad),/Unknown/);
});
test('millimetre board clipping bounds relative depth error at board-scale distances',async()=>{
 const {boardClipRange}=await quality();
 for(const [distance,radius] of [[2,1],[20,10],[200,100],[2000,1000]]){
  const {near,far}=boardClipRange(distance,radius);assert.ok(near>0&&far>near);assert.ok(far>distance+radius);
  // Perspective depth derivative at the board center for a 24-bit buffer.
  const precision=distance**2*(far-near)/(far*near*(2**24-1));
  assert.ok(precision<distance*.00002,`${distance}: ${precision}`);
  assert.ok(far/near<2000);
 }
 for(const bad of [NaN,Infinity,-1,0]){const clip=boardClipRange(bad,bad);assert.ok(clip.near>0&&clip.far>clip.near);}
});
test('zone films stay inside both copper faces and separate exposed caps at board scale',async()=>{
 const {outerCopperPlacement,zoneSurfaceZ}=await import('../spike/copperGeometry.mjs');
 const {boardClipRange}=await quality();
 for(const thickness of [.001,.018,.035,.07])for(const layer of ['F.Cu','B.Cu']){
  const placement=outerCopperPlacement(layer,1.6,thickness),before={...placement};
  const z=zoneSurfaceZ(layer,placement),outer=layer==='F.Cu'?placement.base+thickness:placement.base;
  assert.ok(z>placement.base&&z<placement.base+thickness);
  assert.ok(Math.abs(z-outer)<=thickness/4+1e-12);
  assert.deepEqual(placement,before);
  if(thickness>=.018){
   const {near,far}=boardClipRange(200,150),depth=350;
   const step=depth**2*(far-near)/(far*near*(2**24-1));
   assert.ok(Math.abs(z-outer)>6*step,'film must exceed six depth units at far board edge');
   // A shallow ray increases view-depth separation between parallel planes.
   for(const normalDotRay of [1,.5,.1])assert.ok(Math.abs(z-outer)/normalDotRay>6*step);
  }
 }
 for(const layer of ['F.Cu','B.Cu'])for(const thickness of [0,-1,NaN,Infinity])assert.throws(()=>zoneSurfaceZ(layer,{base:0,thickness}),/Invalid/);
 assert.throws(()=>zoneSurfaceZ('In1.Cu',{base:0,thickness:.035}),/Invalid/);
});
