/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePadOutline,padSourceDetails} from '../extension/spike/padGeometry.mjs';
import {smoothPadOutline} from '../extension/spike/copperGeometry.mjs';
const q=quoted=>({quoted}),area=loop=>loop.slice(1).reduce((sum,p,i)=>sum+loop[i][0]*p[1]-p[0]*loop[i][1],0)/2;
const near=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
function jumper(side=1,id='saved-custom'){
 return ['pad',q('1'),'smd','custom',['uuid',q(id)],['size',1,.5],['options',['anchor','rect']],['primitives',
  ['gr_circle',['center',0,.25],['end',.5,.25],['width',0],['fill','yes']],
  ['gr_circle',['center',0,-.25],['end',.5,-.25],['width',0],['fill','yes']],
  ['gr_poly',['pts',['xy',side*.5,.75],['xy',0,.75],['xy',0,-.75],['xy',side*.5,-.75]],['width',0],['fill','yes']]]];
}
function prepared(side){const raw=jumper(side),details=padSourceDetails(['kicad_pcb',['footprint',q('Jumper'),raw]]).get('saved-custom');return {shape:'custom',width:1,height:.5,...details};}
function contains(loop,x,y){let inside=false;for(let i=0,j=loop.length-2;i<loop.length-1;j=i++)if((loop[i][1]>y)!==(loop[j][1]>y)&&x<(loop[j][0]-loop[i][0])*(y-loop[i][1])/(loop[j][1]-loop[i][1])+loop[i][0])inside=!inside;return inside;}

test('IRCA saved circle/side-polygon/anchor union keeps rounded asymmetric copper and mirrored pads distinct',()=>{
 const right=prepared(1),left=prepared(-1),a=smoothPadOutline(right),b=smoothPadOutline(left);
 assert.ok(a&&b);assert.notDeepEqual(right.customPrimitives,left.customPrimitives);
 for(const geometry of [a,b]){assert.ok(area(geometry.outline)>0);assert.deepEqual(geometry.outline[0],geometry.outline.at(-1));assert.ok(geometry.outline.length<=69);assert.ok(geometry.tessellation.error<=.0025);near(area(geometry.outline),1+Math.PI/8,.001);}
 for(const point of a.outline)assert.ok(b.outline.some(other=>Math.hypot(other[0]+point[0],other[1]-point[1])<1e-9));
 assert.equal(contains(a.outline,.49,.74),true);assert.equal(contains(a.outline,-.49,.74),false);assert.equal(contains(b.outline,-.49,.74),true);
 const rotated=point=>[-point[1]+17,point[0]+23];near(area(a.outline.map(rotated)),area(a.outline));
 assert.equal(a.shape,'custom');assert.equal(a.drill,null);
});

test('custom union rejects changed topology, unsupported primitives and stroked substitutes',()=>{
 const valid=prepared(1);assert.ok(nativePadOutline(valid));
 for(const change of [{customAnchor:'circle'},{width:2},{customPrimitives:valid.customPrimitives.slice(0,2)},{customPrimitives:[...valid.customPrimitives,{shape:'line'}]}])assert.equal(nativePadOutline({...valid,...change}),null);
 const bowtie=structuredClone(valid);[bowtie.customPrimitives[2].points[1],bowtie.customPrimitives[2].points[2]]=[bowtie.customPrimitives[2].points[2],bowtie.customPrimitives[2].points[1]];assert.equal(nativePadOutline(bowtie),null);
 const raw=jumper();raw.at(-1)[1].find(item=>Array.isArray(item)&&item[0]==='width')[1]=.1;
 const metadata=padSourceDetails(['kicad_pcb',['footprint','Jumper',raw]]).get('saved-custom');assert.equal(nativePadOutline({shape:'custom',width:1,height:.5,...metadata}),null);
});

test('saved annular drill containment remains strict, including custom pad tangency',()=>{
 const valid=prepared(1);assert.ok(nativePadOutline({...valid,drill:.2,drillShape:'circle'}));
 assert.equal(nativePadOutline({...valid,drill:1,drillShape:'circle'}),null);
 assert.equal(nativePadOutline({shape:'circle',width:1,height:1,drill:1,drillShape:'circle'}),null);
 assert.equal(nativePadOutline({shape:'rect',width:1,height:1,drill:.2,drillShape:'circle',drillOffset:[.5,0]}),null);
});
