import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePadOutline,nativeDrillOutline,padSourceDetails} from '../extension/spike/padGeometry.mjs';
const bounds=loop=>[Math.min(...loop.map(p=>p[0])),Math.min(...loop.map(p=>p[1])),Math.max(...loop.map(p=>p[0])),Math.max(...loop.map(p=>p[1]))];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const area=loop=>loop.slice(1).reduce((sum,p,i)=>sum+loop[i][0]*p[1]-p[0]*loop[i][1],0)/2;
test('NPTH drilling is independent of copper outline, including saved slotted offset',()=>{
 const pad={shape:'circle',width:2,height:2,drillShape:'circle',drill:2};
 assert.equal(nativePadOutline(pad),null,'a drill touching the copper is not an annulus');
 const hole=nativeDrillOutline(pad);assert.ok(area(hole)<0);bounds(hole).forEach((v,i)=>close(v,[-1,-1,1,1][i]));
 const slot=nativeDrillOutline({drillShape:'oval',drillWidth:1,drillHeight:3,drillOffset:[.25,-.5]});
 bounds(slot).forEach((v,i)=>close(v,[-.25,-2, .75,1][i]));assert.ok(area(slot)<0);assert.deepEqual(slot[0],slot.at(-1));
 for(const bad of [{drill:1},{drillShape:'custom',drill:1},{drillShape:'circle',drill:NaN},{drillShape:'circle',drill:Infinity},{drillShape:'circle',drill:0},{drillShape:'oval',drillWidth:1},{drillShape:'circle',drill:1,drillOffset:[Infinity,0]},{drillShape:'circle',drill:2,drillOffset:[10000,0]}])assert.equal(nativeDrillOutline(bad),null);
});
test('saved rect and circle contours use native mm sizes with no invented minimum',()=>{
 const rect=nativePadOutline({shape:'rect',width:.04,height:.06,rotation:87,at:[50,90]});
 assert.deepEqual(bounds(rect.outline),[-.02,-.03,.02,.03]);assert.equal(rect.drill,null);
 const circle=nativePadOutline({shape:'circle',width:2,height:2});
 for(const [x,y]of circle.outline)close(Math.hypot(x,y),1);
 assert.ok(area(circle.outline)>0);assert.deepEqual(circle.outline[0],circle.outline.at(-1));
 assert.equal(nativePadOutline({shape:'circle',width:2,height:1}),null);
});
test('horizontal and vertical ovals have straight sides and semicircular ends',()=>{
 for(const [w,h]of [[4,2],[2,4],[2,2]]){
  const {outline}=nativePadOutline({shape:'oval',width:w,height:h});bounds(outline).forEach((v,i)=>close(v,[-w/2,-h/2,w/2,h/2][i]));
  for(const [x,y]of outline){const cap=w>=h?Math.max(0,Math.abs(x)-(w-h)/2):Math.max(0,Math.abs(y)-(h-w)/2);close(Math.hypot(cap,w>=h?y:x),Math.min(w,h)/2);}
 }
});
test('roundrect radius comes only from saved ratio and stays inside native bounds',()=>{
 for(const ratio of [0,.1,.25,.5]){const {outline}=nativePadOutline({shape:'roundrect',width:4,height:2,roundrectRatio:ratio});bounds(outline).forEach((v,i)=>close(v,[-2,-1,2,1][i]));assert.ok(outline.every(([x,y])=>Math.abs(x)<=2&&Math.abs(y)<=1));if(ratio>0){const point=outline[8],r=2*ratio;close(Math.hypot(point[0]-(2-r),point[1]-(-1+r)),r);}}
 for(const ratio of [undefined,-.1,.6,NaN,Infinity])assert.equal(nativePadOutline({shape:'roundrect',width:4,height:2,roundrectRatio:ratio}),null);
});
test('round and slotted drills are holes, with saved dimensions and offset',()=>{
 const round=nativePadOutline({shape:'circle',width:3,height:3,drill:.8,drillShape:'circle'});
 assert.ok(area(round.drill)<0);bounds(round.drill).forEach((v,i)=>close(v,[-.4,-.4,.4,.4][i]));
 const slot=nativePadOutline({shape:'oval',width:5,height:3,drillShape:'oval',drillWidth:2,drillHeight:1,drillOffset:[.25,-.1]});
 bounds(slot.drill).forEach((v,i)=>close(v,[-.75,-.6,1.25,.4][i]));assert.ok(area(slot.drill)<0);
 assert.equal(nativePadOutline({shape:'circle',width:3,height:3,drill:.8}),null,'normalized scalar cannot establish drill shape');
 assert.equal(nativePadOutline({shape:'rect',width:3,height:3,drillShape:'oval',drillWidth:1}),null);
 assert.equal(nativePadOutline({shape:'rect',width:3,height:3,drillShape:'circle',drill:4}),null);
 assert.equal(nativePadOutline({shape:'rect',width:3,height:3,drillShape:'circle',drill:1,drillOffset:[1.5,0]}),null);
});
test('unsupported custom/trapezoid pads and invalid or oversized data fail closed',()=>{
 for(const shape of ['custom','trapezoid','chamfered_rect','unknown'])assert.equal(nativePadOutline({shape,width:2,height:2,customPolygon:[[0,0],[1,1],[1,0]]}),null);
 for(const width of [0,-1,NaN,Infinity,'2',10001])assert.equal(nativePadOutline({shape:'rect',width,height:2}),null);
 const bounded=nativePadOutline({shape:'oval',width:10000,height:10000});assert.ok(bounded.outline.length<=69);
 assert.equal(nativePadOutline({shape:'rect',width:3,height:3,drillShape:'circle',drill:1,drillOffset:[Infinity,0]}),null);
});
test('source augmentation reads exact saved pad UUID metadata without traversing polygons',()=>{
 const q=quoted=>({quoted}),ast=['kicad_pcb',['footprint',q('J1'),['pad',q('1'),'thru_hole','roundrect',['uuid',q('one')],['roundrect_rratio',.2],['drill','oval',1,2,['offset',.1,.2]]],['pad',q('2'),'thru_hole','circle',['tstamp','two'],['drill',.7]],['pad',q('3'),'smd','rect']]];
 const result=padSourceDetails(ast);assert.equal(result.size,3);assert.equal(result.get("display-pad:0:2").uuid,undefined);assert.deepEqual(result.get('one'),{type:'Pad',nativeType:'thru_hole',uuid:'one',ownerUuid:undefined,pinNumber:'1',pinName:'',roundrectRatio:.2,drillShape:'oval',drillWidth:1,drillHeight:2,drillOffset:[.1,.2]});assert.deepEqual(result.get('two'),{type:'Pad',nativeType:'thru_hole',uuid:'two',ownerUuid:undefined,pinNumber:'2',pinName:'',drillShape:'circle',drillWidth:.7,drillHeight:.7});
 ast[1].push(['pad',q('4'),'smd','rect',['uuid',q('one')]]);assert.equal(padSourceDetails(ast).has('one'),false,'duplicate IDs are ambiguous');
 assert.equal(padSourceDetails(['not-a-board']).size,0);
});
