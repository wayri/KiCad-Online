/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
const EPS=1e-9,TOLERANCE=.0025;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000;
const close=(a,b)=>Math.abs(a-b)<=EPS;
/** Exact union family used by saved rounded solder-jumper pads: rectangular
 * anchor, two equal symmetric filled circles and one filled half-side rectangle.
 * Other primitive arrangements remain unsupported, never convex-hulled or boxed. */
export function customPadContour(pad){
 const parts=pad.customPrimitives;
 if(pad.customAnchor!=='rect'||!Array.isArray(parts)||parts.length!==3||!finite(pad.width)||!finite(pad.height)||pad.width<=0||pad.height<=0)return null;
 const circles=parts.filter(part=>part?.shape==='circle'),polygons=parts.filter(part=>part?.shape==='polygon');
 if(circles.length!==2||polygons.length!==1)return null;
 const radius=pad.width/2,cy=pad.height/2;
 for(const circle of circles)if(!Array.isArray(circle.center)||circle.center.length!==2||!circle.center.every(finite)||!finite(circle.radius)||!close(circle.radius,radius)||!close(circle.center[0],0))return null;
 if(!((close(circles[0].center[1],cy)&&close(circles[1].center[1],-cy))||(close(circles[1].center[1],cy)&&close(circles[0].center[1],-cy))))return null;
 let points=polygons[0].points;
 if(!Array.isArray(points)||points.length<4||points.length>5||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite)))return null;
 if(points.length===5){if(!points[0].every((n,i)=>close(n,points[4][i])))return null;points=points.slice(0,4);}
 const side=points.some(p=>close(p[0],radius))?1:points.some(p=>close(p[0],-radius))?-1:0;
 if(!side)return null;
 const expected=[[0,-cy-radius],[side*radius,-cy-radius],[side*radius,cy+radius],[0,cy+radius]],seen=new Set();
 for(const point of points){const index=expected.findIndex(p=>p.every((n,i)=>close(n,point[i])));if(index<0||seen.has(index))return null;seen.add(index);}
 // Require a simple perimeter, not a bow-tie with the same vertex set.
 const indices=points.map(point=>expected.findIndex(p=>p.every((n,i)=>close(n,point[i]))));
 if(!indices.every((index,i)=>((indices[(i+1)%4]-index+4)%4)===(indices[1]-indices[0]+4)%4)||![1,3].includes((indices[1]-indices[0]+4)%4))return null;
 const requested=Math.ceil(Math.PI/Math.acos(Math.max(-1,1-TOLERANCE/radius))),segments=Math.min(128,Math.max(64,Math.ceil(requested/4)*4)),steps=segments/4;
 const outline=[];
 for(let step=0;step<=steps;step++){const angle=Math.PI/2+step*Math.PI/2/steps;outline.push([radius*Math.cos(angle),cy+radius*Math.sin(angle)]);}
 for(let step=0;step<=steps;step++){const angle=Math.PI+step*Math.PI/2/steps;outline.push([radius*Math.cos(angle),-cy+radius*Math.sin(angle)]);}
 outline.push([radius,-cy-radius],[radius,cy+radius]);
 if(side<0){for(const point of outline)point[0]=-point[0];outline.reverse();}
 outline.push([...outline[0]]);
 const error=radius*(1-Math.cos(Math.PI/segments));
 return {outline,tessellation:{error,limited:error>TOLERANCE*(1+1e-10),tolerance:TOLERANCE}};
}
