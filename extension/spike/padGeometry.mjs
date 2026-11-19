/* Saved pad contours in pad-local millimetres; no placement, rotation or Three dependency. */
import {customPadContour} from "./customPadGeometry.mjs";
import {padOccurrenceId,savedObjectId} from "./sourceIdentity.mjs";
const MAX_SIZE=10000, ARC_STEPS=16, EPSILON=1e-10;
const dimension=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=MAX_SIZE;
const finiteOffset=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=MAX_SIZE;
function closed(points){
  const result=[];
  for(const point of points){const previous=result.at(-1);if(!previous||Math.hypot(point[0]-previous[0],point[1]-previous[1])>EPSILON)result.push(point);}
  if(result.length>1&&Math.hypot(result[0][0]-result.at(-1)[0],result[0][1]-result.at(-1)[1])<=EPSILON)result.pop();
  result.push([...result[0]]);return result;
}
function roundRectangle(width,height,radius){
 const x=width/2,y=height/2;
 if(radius===0)return[[-x,-y],[x,-y],[x,y],[-x,y],[-x,-y]];
 const points=[],centers=[[x-radius,-y+radius],[x-radius,y-radius],[-x+radius,y-radius],[-x+radius,-y+radius]];
 for(let corner=0;corner<4;corner++)for(let step=0;step<=ARC_STEPS;step++){
  const angle=(-.5+corner*.5+step*.5/ARC_STEPS)*Math.PI;
  points.push([centers[corner][0]+radius*Math.cos(angle),centers[corner][1]+radius*Math.sin(angle)]);
 }
 return closed(points);
}
function outlineFor(shape,width,height,ratio){
 if(!dimension(width)||!dimension(height))return null;
 if(shape==='rect')return roundRectangle(width,height,0);
 if(shape==='oval')return roundRectangle(width,height,Math.min(width,height)/2);
 if(shape==='circle')return Math.abs(width-height)<=EPSILON*Math.max(1,width,height)?roundRectangle(width,height,width/2):null;
 if(shape==='roundrect')return typeof ratio==='number'&&Number.isFinite(ratio)&&ratio>=0&&ratio<=.5?roundRectangle(width,height,Math.min(width,height)*ratio):null;
 return null;
}
/** Saved CW drill loop in pad-local mm, independent of any copper annulus.
 * This also represents NPTH holes whose drill touches or exceeds the pad size.
 */
export function nativeDrillOutline(pad){
 if(!pad||typeof pad!=='object'||!['circle','oval'].includes(pad.drillShape))return null;
 const width=pad.drillWidth??pad.drill,height=pad.drillHeight??(pad.drillShape==='circle'?width:undefined);
 const hole=outlineFor(pad.drillShape,width,height);
 if(!hole)return null;
 const offset=pad.drillOffset??[0,0];
 if(!Array.isArray(offset)||offset.length!==2||!offset.every(finiteOffset))return null;
 const result=hole.map(([x,y])=>[x+offset[0],y+offset[1]]).reverse();
 return result.every(point=>point.every(finiteOffset))?result:null;
}
/**
 * Return closed CCW outline and CW drill loop. The caller applies saved at/rotation.
 * Positive normalized drill alone does not establish round vs oval: source metadata
 * must supply drillShape. Unsupported or ambiguous hole geometry returns null;
 * it must be omitted/reported rather than filled in as a solid copper pad.
 */
export function nativePadOutline(pad){
 if(!pad||typeof pad!=='object')return null;
 const shape=pad.shape,custom=shape==='custom'?customPadContour(pad):null,outline=custom?.outline||outlineFor(shape,pad.width,pad.height,pad.roundrectRatio??pad.roundrect_rratio);
 if(!outline)return null;
 let drill=null;
 const hasDrill=pad.drill!==undefined&&pad.drill!==0||pad.drillWidth!==undefined||pad.drillHeight!==undefined;
 if(hasDrill){
  drill=nativeDrillOutline(pad);
  if(!drill)return null;
  // Holes touching/exceeding the copper contour cannot be represented by Shape holes.
  // Reject rather than silently drawing clipped or solid copper.
  if(!drill.every(point=>strictlyInside(outline,point)))return null;
 }
 return{shape,outline,drill,...(custom?{tessellation:custom.tessellation}:{})};
}
function strictlyInside(loop,[x,y]){
 let inside=false;
 for(let i=0,j=loop.length-2;i<loop.length-1;j=i++){
  const [ax,ay]=loop[j],[bx,by]=loop[i],dx=bx-ax,dy=by-ay;
  const projection=((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy),t=Math.max(0,Math.min(1,projection));
  if(Math.hypot(x-(ax+t*dx),y-(ay+t*dy))<=EPSILON)return false;
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside;
}
const value=node=>node&&typeof node==='object'&&!Array.isArray(node)?node.quoted:node;
const child=(node,name)=>node.find(item=>Array.isArray(item)&&value(item[0])===name);
function customPrimitives(pad){
 const source=child(pad,'primitives');if(!source||source.length>17)return null;
 const result=[],point=(node,tag)=>{const values=child(node,tag)?.slice(1).map(value);return values?.length===2&&values.every(finiteOffset)?values:null;};
 for(const primitive of source.slice(1)){
  if(!Array.isArray(primitive)||value(child(primitive,'fill')?.[1])!=='yes'||value(child(primitive,'width')?.[1])!==0)return null;
  if(value(primitive[0])==='gr_circle'){
   const center=point(primitive,'center'),end=point(primitive,'end');if(!center||!end)return null;
   result.push({shape:'circle',center,radius:Math.hypot(end[0]-center[0],end[1]-center[1])});
  }else if(value(primitive[0])==='gr_poly'){
   const pts=child(primitive,'pts');if(!pts||pts.length<4||pts.length>17)return null;
   const points=[];for(const xy of pts.slice(1)){if(!Array.isArray(xy)||value(xy[0])!=='xy')return null;const p=xy.slice(1).map(value);if(p.length!==2||!p.every(finiteOffset))return null;points.push(p);}
   result.push({shape:'polygon',points});
  }else return null;
 }
 return result;
}
/** Extract only direct footprint pad metadata from an ALREADY parsed native PCB.
 * Does not parse, walk filled polygons or choose fallback identities. Duplicate IDs
 * are excluded. drillOffset stays in the saved pad frame; callers own placement.
 */
export function padSourceDetails(ast){
 const result=new Map(),seen=new Set();let inspected=0,footprintIndex=-1;
 if(!Array.isArray(ast)||value(ast[0])!=='kicad_pcb'||ast.length>1000000)return result;
 for(const footprint of ast){
  if(!Array.isArray(footprint)||(value(footprint[0])!=='footprint'&&value(footprint[0])!=='module'))continue;
  footprintIndex++;
  if(footprint.length>1000000)continue;
  let padIndex=-1;
  const ownerUuid=savedObjectId(footprint);
  for(const pad of footprint){
   if(!Array.isArray(pad)||value(pad[0])!=='pad')continue;
   padIndex++;
   if(pad.length>10000)continue;
   if(++inspected>200000)return result;
   const uuid=savedObjectId(pad),id=uuid||padOccurrenceId(footprintIndex,padIndex);
   if(id.length>128)continue;
   if(seen.has(id)){result.delete(id);continue;}seen.add(id);
   const ratio=child(pad,'roundrect_rratio')?.[1],drill=child(pad,'drill');
   const record={type:'Pad',nativeType:String(value(pad[2])||''),uuid,ownerUuid,pinNumber:String(value(pad[1])??''),pinName:String(value(child(pad,'pinfunction')?.[1])??'')};if(typeof ratio==='number')record.roundrectRatio=ratio;
   if(drill){const oval=value(drill[1])==='oval';record.drillShape=oval?'oval':'circle';record.drillWidth=drill[oval?2:1];record.drillHeight=oval?drill[3]:record.drillWidth;const offset=child(drill,'offset');if(offset)record.drillOffset=[offset[1],offset[2]];}
   if(value(pad[3])==='custom'){record.customAnchor=value(child(child(pad,'options')||[],'anchor')?.[1]);record.customPrimitives=customPrimitives(pad);}
   result.set(id,record);if(result.size>=200000)return result;
  }
 }
 return result;
}
