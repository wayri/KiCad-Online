const test=require('node:test'),assert=require('node:assert/strict');
const {color,prepare,maskGeometry,texture}=require('../fast-pi-field.js');
const result=()=>({cellSizeMm:1,sourceIndex:0,nodes:[{x:.5,y:.5,gx:0,gy:0,layer:'F.Cu',voltageV:5},{x:1.5,y:.5,gx:1,gy:0,layer:'F.Cu',voltageV:4},{x:.5,y:1.5,gx:0,gy:1,layer:'F.Cu',voltageV:5},{x:1.5,y:1.5,gx:1,gy:1,layer:'F.Cu',voltageV:4}],edges:[[0,1],[0,2],[1,3],[2,3]].map(([a,b])=>({a,b,kind:'sheet',currentA:.1,currentDensityAm2:1e6,lossW:.01}))});

test('perceptual field palette keeps explicit blue/cyan/yellow/red stops and bounded smooth transitions',()=>{
 for(const [ratio,expected]of [[0,[30,74,196]],[1/3,[25,190,198]],[2/3,[250,216,74]],[1,[218,54,58]]])assert.deepEqual(color(ratio),expected);
 for(let i=0;i<100;i++){const a=color(i/100),b=color((i+1)/100);assert.ok(a.every(v=>Number.isInteger(v)&&v>=0&&v<=255));assert.ok(a.every((v,k)=>Math.abs(v-b[k])<20));}
 assert.deepEqual(color(-10),color(0));assert.deepEqual(color(10),color(1));
});

test('continuous field display interpolates solved values within connected grid neighborhoods',()=>{
 const field=prepare(result(),'F.Cu','voltage');assert.equal(field.maximum,1);assert.equal(field.sample(1,1),.5);assert.equal(field.sample(.5,.5),0);assert.equal(field.sample(1.5,1.5),1);assert.equal(field.width,8);assert.equal(field.height,8,'a four-cell result needs64pixels, not147456');assert.equal(field.rgba.length,field.width*field.height*4);assert.ok(field.rgba.some((v,i)=>i%4===3&&v===225));assert.match(field.description,/Interpolated solved voltage/);
 const density=prepare(result(),'F.Cu','density');assert.equal(density.sample(1,1),1);assert.match(density.description,/mean incident.*edge.*density/);
});

test('missing connections and unconnected cells cannot be interpolated into fabricated paths',()=>{
 const gap=result();gap.edges=gap.edges.filter(e=>!(e.a===0&&e.b===1));const field=prepare(gap,'F.Cu','voltage');assert.equal(field.sample(.99,.5),0,'no averaging across a missing sheet edge');
 const island=result();island.nodes[1].voltageV=null;island.nodes[3].voltageV=null;const disconnected=prepare(island,'F.Cu','voltage');assert.equal(disconnected.sample(1.5,.5),null);assert.equal(disconnected.sample(1.5,1.5),null);
 const separate=result();separate.nodes[1].gx=3;separate.nodes[1].x=3.5;separate.nodes[3].gx=3;separate.nodes[3].x=3.5;separate.edges=separate.edges.filter(e=>e.a===0&&e.b===2||e.a===1&&e.b===3);assert.equal(prepare(separate,'F.Cu','voltage').sample(1.5,.5),null,'empty cells between islands remain transparent');
});

test('solved-cell support clips resampling away from a nearby unsolved same-net island',()=>{
 const source=result(),nodes=[];for(let gy=0;gy<2;gy++)for(let gx=0;gx<3;gx++)nodes.push({x:gx+.5,y:gy+.5,gx,gy,layer:'F.Cu',voltageV:gy===0&&gx===1?null:5-gx});
 const field=prepare({...source,nodes,edges:[]},'F.Cu','voltage');assert.deepEqual(field.support,[{x:0,y:0,width:1,height:1},{x:2,y:0,width:1,height:1},{x:0,y:1,width:3,height:1}]);
 const supported=(x,y)=>field.support.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);assert.equal(supported(.99,.5),true);assert.equal(supported(1.01,.5),false);assert.equal(supported(1.99,.5),false);assert.equal(supported(2.01,.5),true);assert.equal(field.sample(1.5,.5),null);assert.equal(field.width,12);assert.equal(field.height,8);
 const fragmented=Array.from({length:4001},(_,i)=>({x:i*2+.5,y:.5,gx:i*2,gy:0,layer:'F.Cu',voltageV:5}));assert.throws(()=>prepare({...source,nodes:fragmented,edges:[]},'F.Cu','voltage'),/support exceeds.*budget/);
});

test('saved copper vector mask keeps separate polygons, trace width and drill voids without a hull or blur',()=>{
 const polygon=(a,b)=>({kind:'zone',type:'polygon',netId:1,layer:'F.Cu',points:[{x:a,y:0},{x:b,y:0},{x:b,y:1},{x:a,y:1}]}),mask=maskGeometry([polygon(0,.9),polygon(1.1,2),{kind:'track',type:'line',netId:1,layer:'F.Cu',width:.2,points:[{x:0,y:2},{x:2,y:2}]},{kind:'drill',type:'circle',hole:true,netId:2,layer:'F.Cu',x:.5,y:.5,r:.1},{...polygon(0,2),netId:2},{...polygon(0,2),layer:'B.Cu'}],{id:1,name:'VCC'},'F.Cu',{minX:0,minY:0,maxX:2,maxY:2});
 assert.equal(mask.copper.length,3);assert.equal(mask.holes.length,1,'other-net physical drills still subtract from the displayed copper');assert.equal(mask.copper[0].d,'M 0 0 L 0.9 0 L 0.9 1 L 0 1 Z');assert.equal(mask.copper[1].d,'M 1.1 0 L 2 0 L 2 1 L 1.1 1 Z');assert.equal(mask.copper[2].width,.2);assert.equal(mask.copper[2].stroke,true);assert.match(mask.holes[0].d,/a 0.1 0.1/);
 assert.throws(()=>maskGeometry([{kind:'arc',netId:1,layer:'F.Cu'}],{id:1},'F.Cu',{minX:0,minY:0,maxX:2,maxY:2}),/mask is unavailable/);assert.throws(()=>maskGeometry([{kind:'zone',netId:1,layer:'F.Cu',points:[{x:NaN,y:0},{x:1,y:0},{x:1,y:1}]}],{id:1},'F.Cu',{minX:0,minY:0,maxX:2,maxY:2}),/Invalid/);
});

test('field rasterization is bounded and uses an owned PNG texture without external images',()=>{
 const field=prepare(result(),'F.Cu','voltage');let captured;
 const canvas={getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:data=>captured=data}),toDataURL:type=>{assert.equal(type,'image/png');return'data:image/png;base64,AA==';}};
 assert.equal(texture(field,{createElement:tag=>{assert.equal(tag,'canvas');return canvas;}}),'data:image/png;base64,AA==');assert.equal(canvas.width,field.width);assert.deepEqual(captured.data,field.rgba);
 assert.throws(()=>prepare({...result(),cellSizeMm:0},'F.Cu','voltage'),/budget/);assert.throws(()=>prepare(result(),'B.Cu','voltage'),/No solved/);
});

 test('3D field surface contains accepted solved cells and omits rejected copper boundaries',()=>{
 const {surface}=require('../fast-pi-field.js');const full=surface(result(),'F.Cu','voltage',()=>true);assert.equal(full.triangles.length,8);assert.equal(full.points.length,16);assert.equal(full.values.length,16);assert.ok(full.points.every(p=>p[2]===0));const clipped=surface(result(),'F.Cu','voltage',p=>p.x<1);assert.equal(clipped.triangles.length,4);assert.ok(clipped.points.every(p=>p[0]<1));assert.throws(()=>surface(result(),'F.Cu','voltage',()=>false),/No complete solved copper cells/);
 });
