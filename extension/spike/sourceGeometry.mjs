// Read only saved source polygon geometry; an unfilled zone boundary is never
// evidence that copper exists inside it.
const value=item=>item&&typeof item==='object'&&!Array.isArray(item)?item.quoted:item;
const kind=node=>Array.isArray(node)?String(value(node[0])):'';
const children=(node,name)=>node.filter(item=>kind(item)===name);
const child=(node,name)=>children(node,name)[0];
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-8&&p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8;
function intersects(a,b,c,d){const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);return x*y<0&&z*w<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
function contains(point,loop){let result=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if(on(a,b,point))return false;if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
export function drillLoopInsideBoard(loop,outer,holes=[]){
 if(!Array.isArray(loop)||loop.length<3||!Array.isArray(outer)||outer.length<3)return false;
 if(loop.some(point=>!point.every(Number.isFinite)||!contains(point,outer)||holes.some(hole=>contains(point,hole))))return false;
 for(const boundary of [outer,...holes])for(let i=0;i<loop.length;i++)for(let j=0;j<boundary.length;j++)if(intersects(loop[i],loop[(i+1)%loop.length],boundary[j],boundary[(j+1)%boundary.length]))return false;
 return true;
}
export function sourceZoneGeometry(ast,maxPolygons=1000,maxPoints=500000){
 const nets=new Map(children(ast,'net').map(node=>[value(node[1]),String(value(node[2])||'')]));
 const zones=children(ast,'zone'), smallest=new Map(), counts=new Map();
 let unfilled=0;
 function* candidates(firstPass){
  let ordinal=0;
  for(const zone of zones){
   const fills=children(zone,'filled_polygon'),filled=fills.length>0;
   if(firstPass&&!filled)unfilled++;
   const declared=child(zone,'layers')?.slice(1).map(value)??[value(child(zone,'layer')?.[1])];
   const id=value(child(zone,'uuid')?.[1])||value(child(zone,'tstamp')?.[1]);
   const netCode=value(child(zone,'net')?.[1]);
   const net=String(value(child(zone,'net_name')?.[1])||nets.get(netCode)||(typeof netCode==='string'?netCode:''));
   for(const polygon of filled?fills:children(zone,'polygon')){
    const pts=child(polygon,'pts')||[];
    let size=0;
    for(const item of pts)if(kind(item)==='xy'&&Number.isFinite(Number(value(item[1])))&&Number.isFinite(Number(value(item[2]))))size++;
    if(size<3)continue;
    const ownLayer=value(child(polygon,'layer')?.[1]);
    for(const layer of ownLayer?[ownLayer]:declared){
     if(typeof layer==='string'&&/^(?:F|B|In[1-9]\d*)\.Cu$/.test(layer))yield {layer,ordinal:ordinal++,size,pts,filled,id,net};
    }
   }
  }
 }
 // Reserve one complete contour per represented layer before spending the
 // remaining budget in source order. Prefer actual saved fill over a boundary.
 for(const candidate of candidates(true)){
  const {layer,size,filled}=candidate;
  counts.set(layer,(counts.get(layer)||0)+1);
  if(size>maxPoints)continue;
  const best=smallest.get(layer);
  if(!best||(filled&&!best.filled)||(filled===best.filled&&size<best.size))smallest.set(layer,candidate);
 }
 let remainingPoints=maxPoints,remainingPolygons=maxPolygons;
 const reserved=new Set(),records=[];
 for(const {size,ordinal} of [...smallest.values()].sort((a,b)=>a.size-b.size||a.ordinal-b.ordinal)){
  if(remainingPolygons<=0||size>remainingPoints)break;
  reserved.add(ordinal);remainingPolygons--;remainingPoints-=size;
 }
 for(const {layer,ordinal,size,pts,filled,id,net} of candidates(false)){
  if(!reserved.has(ordinal)){
   if(remainingPolygons<=0||size>remainingPoints)continue;
   remainingPolygons--;remainingPoints-=size;
  }
  const points=children(pts,'xy').map(node=>[Number(value(node[1])),Number(value(node[2]))]).filter(point=>point.every(Number.isFinite));
  records.push({points,layer,filled,id:String(id||'saved-zone-'+ordinal),net});
  counts.set(layer,counts.get(layer)-1);
 }
 const omittedByLayer=Object.fromEntries([...counts].filter(([,count])=>count>0));
 return {records,unfilled,truncated:Object.keys(omittedByLayer).length>0,omittedByLayer};
}

/** Index saved contours by layer without copying their coordinate arrays.
 * Rendering admits final typed geometry bytes, instead of dropping later layers
 * when an unrelated contour consumes a project-wide temporary point allowance.
 * The legacy bounded materializing API above remains available to its callers.
 */
/** Index saved contours by copper layer without copying point arrays. */
export function createSourceZoneIndex(ast,{maxContours=100000}={}){
 if(!Number.isSafeInteger(maxContours)||maxContours<1)throw TypeError('Invalid zone contour index limit.');
 const nets=new Map();for(const node of ast)if(kind(node)==='net')nets.set(value(node[1]),String(value(node[2])||''));
 const byLayer=new Map();let unfilled=0,contours=0,points=0,invalid=0,omitted=0;
 for(const zone of ast){
  if(kind(zone)!=='zone')continue;
  const fills=children(zone,'filled_polygon'),filled=fills.length>0;if(!filled)unfilled++;
  const declared=child(zone,'layers')?.slice(1).map(value)??[value(child(zone,'layer')?.[1])];
  const id=value(child(zone,'uuid')?.[1])||value(child(zone,'tstamp')?.[1]);
  const netCode=value(child(zone,'net')?.[1]),net=String(value(child(zone,'net_name')?.[1])||nets.get(netCode)||(typeof netCode==='string'?netCode:''));
  for(const polygon of filled?fills:children(zone,'polygon')){
   const pts=child(polygon,'pts')||[];let size=0,bad=false;
   for(const node of pts)if(kind(node)==='xy'){if(!Number.isFinite(Number(value(node[1])))||!Number.isFinite(Number(value(node[2]))))bad=true;size++;}
   if(bad||size<3){invalid++;continue;}
   const ownLayer=value(child(polygon,'layer')?.[1]);
   for(const layer of ownLayer?[ownLayer]:declared){
    if(typeof layer!=='string')continue;if(contours>=maxContours){omitted++;continue;}
    const descriptor={id:String(id||'saved-zone-'+contours),net,layer,filled,size,contour:contours,sourcePoints:pts};
    if(!byLayer.has(layer))byLayer.set(layer,[]);byLayer.get(layer).push(descriptor);contours++;points+=size;
   }
  }
 }
 return {forLayer:layer=>byLayer.get(layer)||[],stats:()=>({contours,points,unfilled,invalid,omitted,layers:byLayer.size,retainsCoordinateCopies:false})};
}
