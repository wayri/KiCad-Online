/** Saved-coordinate copper contours; numerical error is bounded and disclosed. */
import {nativePadOutline,nativeDrillOutline} from './padGeometry.mjs';
import {savedObjectId} from './sourceIdentity.mjs';
const TAU=Math.PI*2,EPS=1e-9;
export const COPPER_TOLERANCE_MM=.0025;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function circularTessellation(radius,{tolerance=COPPER_TOLERANCE_MM,min=24,max=128}={}){
 if(!finite(radius)||radius<=0||!finite(tolerance)||tolerance<=0||!Number.isInteger(min)||!Number.isInteger(max)||min<4||max<min||max>4096)throw Error('Invalid circular tessellation parameters.');
 const angle=2*Math.acos(Math.max(-1,Math.min(1,1-tolerance/radius))),needed=angle>0?Math.ceil(TAU/angle):max,segments=Math.min(max,Math.max(min,Math.ceil(needed/4)*4)),error=radius*(1-Math.cos(Math.PI/segments));
 return {segments,error,limited:error>tolerance*(1+1e-10),tolerance};
}
/** Bounded shared instanced batches implement a round stroke without shader-only
 * deformation, preserving both CPU picking and the original source records. */
export function copperStrokeBatches(THREE,input,{world,z,thickness}){
 if(!Array.isArray(input)||typeof world!=='function'||!finite(z)||!finite(thickness)||thickness<=0)throw Error('Invalid copper stroke batch parameters.');
 const tracks=input.filter(track=>finite(track.width)&&track.width>0&&Array.isArray(track.start)&&Array.isArray(track.end)&&track.start.length===2&&track.end.length===2&&[...track.start,...track.end].every(finite)),invalid=input.length-tracks.length;
 if(!tracks.length)return {batches:[],tracks,invalid,plan:null,triangles:0};
 const tiers=[12,16,24,32,48,64,96,128],buckets=new Map(),widths=new Map(),batches=[];let maxError=0,limited=false;
 for(const track of tracks){let tier=widths.get(track.width);if(!tier){const requested=circularTessellation(track.width/2,{min:12});tier=tiers.find(value=>value>=requested.segments)||128;widths.set(track.width,tier);}const error=track.width/2*(1-Math.cos(Math.PI/tier));maxError=Math.max(maxError,error);limited||=error>COPPER_TOLERANCE_MM*(1+1e-10);if(!buckets.has(tier))buckets.set(tier,[]);buckets.get(tier).push(track);}
 const nonzero=tracks.filter(track=>Math.hypot(track.end[0]-track.start[0],track.end[1]-track.start[1])>1e-12);
 if(nonzero.length)batches.push({part:'core',records:nonzero,geometry:new THREE.BoxGeometry(1,1,1),place(object,track){const a=world(track.start),b=world(track.end);object.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,z);object.rotation.set(0,0,Math.atan2(b[1]-a[1],b[0]-a[0]));object.scale.set(Math.hypot(b[0]-a[0],b[1]-a[1]),track.width,thickness);}});
 // Each cap is only the half outside its rectangular core. Thin tracks keep
 // their own error tier; one wide power trace cannot densify the whole layer.
 for(const [tier,records]of [...buckets].sort((a,b)=>a[0]-b[0])){const cap=new THREE.CylinderGeometry(1,1,1,tier/2,1,false,0,Math.PI);cap.rotateX(Math.PI/2);
  for(const endpoint of ['start','end'])batches.push({part:endpoint+'-'+tier,records,geometry:cap,place(object,track){const[x,y]=world(track[endpoint]),a=world(track.start),b=world(track.end);object.position.set(x,y,z);object.rotation.set(0,0,Math.atan2(b[1]-a[1],b[0]-a[0])+(endpoint==='start'?Math.PI:0));object.scale.set(track.width/2,track.width/2,thickness);}});
 }
 const plan={segments:Math.max(...buckets.keys()),error:maxError,limited,tolerance:COPPER_TOLERANCE_MM};
 return {batches,tracks,invalid,plan,triangles:batches.reduce((total,batch)=>total+(batch.geometry.index?.count||batch.geometry.getAttribute('position').count)/3*batch.records.length,0)};
}
function roundedOutline(width,height,radius){
 if(!radius)return [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2],[-width/2,-height/2]];
 const plan=circularTessellation(radius,{min:64}),steps=plan.segments/4,points=[],x=width/2,y=height/2,centers=[[x-radius,-y+radius],[x-radius,y-radius],[-x+radius,y-radius],[-x+radius,-y+radius]];
 for(let corner=0;corner<4;corner++)for(let i=0;i<=steps;i++){const angle=(-.5+corner*.5+i*.5/steps)*Math.PI,point=[centers[corner][0]+radius*Math.cos(angle),centers[corner][1]+radius*Math.sin(angle)],previous=points.at(-1);if(!previous||Math.hypot(point[0]-previous[0],point[1]-previous[1])>EPS)points.push(point);}
 if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<EPS)points.pop();points.push([...points[0]]);return points;
}
function contour(shape,width,height,ratio){return roundedOutline(width,height,shape==='rect'?0:shape==='roundrect'?Math.min(width,height)*ratio:Math.min(width,height)/2);}
export function smoothDrillOutline(pad){
 if(!nativeDrillOutline(pad))return null;
 const width=pad.drillWidth??pad.drill,height=pad.drillHeight??(pad.drillShape==='circle'?width:undefined),offset=pad.drillOffset||[0,0];
 return contour(pad.drillShape,width,height,0).map(([x,y])=>[x+offset[0],y+offset[1]]).reverse();
}
function insideConvex(loop,point){let sign=0;for(let i=0;i<loop.length-1;i++){const a=loop[i],b=loop[i+1],cross=(b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0]);if(Math.abs(cross)<1e-12)return false;const direction=Math.sign(cross);if(sign&&direction!==sign)return false;sign=direction;}return true;}
export function smoothPadOutline(pad){
 const original=nativePadOutline(pad);if(!original)return null;
 if(pad.shape==='custom'){
  const radius=original.drill?Math.min(pad.drillWidth??pad.drill,pad.drillHeight??pad.drill)/2:0,error=Math.max(original.tessellation.error,radius*(1-Math.cos(Math.PI/64)));
  return {...original,tessellation:{...original.tessellation,error,limited:error>COPPER_TOLERANCE_MM*(1+1e-10)}};
 }
 const ratio=pad.roundrectRatio??pad.roundrect_rratio,outline=contour(pad.shape,pad.width,pad.height,ratio),drill=pad.drill||pad.drillWidth||pad.drillHeight?smoothDrillOutline(pad):null;
 const radii=[pad.shape==='rect'?0:pad.shape==='roundrect'?Math.min(pad.width,pad.height)*ratio:Math.min(pad.width,pad.height)/2,drill?Math.min(pad.drillWidth??pad.drill,pad.drillHeight??pad.drill)/2:0].filter(r=>r>0),plans=radii.map(radius=>circularTessellation(radius,{min:64}));
 if(drill&&drill.some(point=>!insideConvex(outline,point)))return {...original,tessellation:{error:Math.max(0,...radii.map(r=>r*(1-Math.cos(Math.PI/64)))),limited:true,reason:'Refined hole containment requires retaining the validated contour resolution.'}};
 return {shape:pad.shape,outline,drill,tessellation:{error:Math.max(0,...plans.map(p=>p.error)),limited:plans.some(p=>p.limited)}};
}
/** Open bore surface at the saved drill contour: no guessed plating volume. */
export function drillWallGeometry(THREE,loop,depth){
 if(!Array.isArray(loop)||loop.length<4||!loop.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite))||!finite(depth)||depth<=0||Math.hypot(loop[0][0]-loop.at(-1)[0],loop[0][1]-loop.at(-1)[1])>EPS)throw Error('Invalid saved drill wall.');
 const count=loop.length-1,positions=[],indices=[];
 for(let i=0;i<count;i++){const[x,y]=loop[i];positions.push(x,-y,0,x,-y,depth);const next=(i+1)%count;indices.push(i*2,next*2,i*2+1,next*2,next*2+1,i*2+1);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
/** Plan centers include copper in total board depth. The small display gap is
 * applied to copper only; native component interfaces stay at ±boardDepth/2. */
export function outerCopperPlacement(layer,boardDepth,copperThickness=.035,layerZ){
 if(!['F.Cu','B.Cu'].includes(layer)||!finite(boardDepth)||boardDepth<=0||!finite(copperThickness)||copperThickness<=0||layerZ!==undefined&&!finite(layerZ))throw Error('Invalid outer copper placement.');
 const sign=layer==='F.Cu'?1:-1,displayOffset=.001,sourceCenter=layerZ??sign*(boardDepth/2-copperThickness/2),center=sourceCenter+sign*displayOffset;
 return {center,sourceCenter,base:center-copperThickness/2,thickness:copperThickness,displayOffset};
}
/** Display-only zone surface; pad and component interfaces stay unchanged. */
export function zoneSurfaceZ(layer,placement){
 if(!['F.Cu','B.Cu'].includes(layer)||!finite(placement?.base)||!finite(placement?.thickness)||placement.thickness<=0)throw Error('Invalid zone display placement.');
 // Separate overlapping zone films from exposed pad caps, within the foil.
 const inset=Math.min(.005,placement.thickness/4);
 return layer==='F.Cu'?placement.base+placement.thickness-inset:placement.base+inset;
}
/** Substrate envelope between the outer copper inner faces. Internal copper
 * remains embedded; this is not a separately meshed dielectric stack model. */
export function substrateEnvelope(boardDepth,byLayer){
 if(!finite(boardDepth)||boardDepth<=0||!byLayer?.get)throw Error('Invalid substrate depth plan.');
 const front=byLayer.get('F.Cu'),back=byLayer.get('B.Cu'),valid=layer=>layer&&finite(layer.z)&&finite(layer.thickness)&&layer.thickness>0;
 const top=valid(front)?front.z-front.thickness/2:boardDepth/2,bottom=valid(back)?back.z+back.thickness/2:-boardDepth/2;
 if(!finite(top-bottom)||top<=bottom)throw Error('Outer copper inner faces do not enclose a valid substrate.');
 return {top,bottom,depth:top-bottom,missingOuterDepths:!valid(front)||!valid(back)};
}
const value=x=>x&&typeof x==='object'&&!Array.isArray(x)?x.quoted:x;
const child=(node,tag)=>node.find(x=>Array.isArray(x)&&value(x[0])===tag);
const point=(node,tag)=>{const p=child(node,tag),xy=p?.slice(1,3).map(value);return xy?.length===2&&xy.every(finite)?xy:null;};
function circleFor(a,b,c){
 const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],d=2*(ux*vy-uy*vx);if(Math.abs(d)<1e-12)return null;
 const uu=ux*ux+uy*uy,vv=vx*vx+vy*vy,center=[a[0]+(uu*vy-vv*uy)/d,a[1]+(vv*ux-uu*vx)/d],start=Math.atan2(a[1]-center[1],a[0]-center[0]),turn=x=>(x%TAU+TAU)%TAU,end=turn(Math.atan2(c[1]-center[1],c[0]-center[0])-start),mid=turn(Math.atan2(b[1]-center[1],b[0]-center[0])-start),radius=Math.hypot(a[0]-center[0],a[1]-center[1]);
 return center.every(finite)&&finite(radius)?{center,radius,start,sweep:mid<=end?end:end-TAU}:null;
}
/** Refine only unambiguous native saved arcs. Other source segments stay exact. */
export function refineCopperTracks(tracks,ast,{maxSegments=200000}={}){
 if(!Array.isArray(tracks)||!Array.isArray(ast)||!Number.isInteger(maxSegments)||maxSegments<1||maxSegments>1000000)throw Error('Invalid saved track refinement input.');
 const warnings=[],groups=new Map(),replacements=new Map(),seen=new Set();let remaining=Math.max(0,maxSegments-tracks.length);
 for(const track of tracks){const base=String(track.id||'').replace(/:\d+$/,'');if(!groups.has(base))groups.set(base,[]);groups.get(base).push(track);}
 const close=(a,b)=>a&&b&&Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6;
 for(const node of ast){
  if(!Array.isArray(node)||value(node[0])!=='arc')continue;
  const a=point(node,'start'),b=point(node,'mid'),c=point(node,'end'),uuid=savedObjectId(node),layer=value(child(node,'layer')?.[1]),width=value(child(node,'width')?.[1]);if(!a||!b||!c)continue;
  let candidates=typeof uuid==='string'&&groups.has(uuid)?[[uuid,groups.get(uuid)]]:[...groups].filter(([,records])=>records[0].layer===layer&&records[0].width===width&&close(records[0].start,a)&&close(records.at(-1).end,c));
  if(candidates.length!==1){warnings.push('A saved copper arc could not be matched unambiguously; existing parsed segments are retained.');continue;}
  const [key,records]=candidates[0];if(seen.has(key)){replacements.delete(key);warnings.push('Duplicate saved copper arc identity retained without refinement.');continue;}seen.add(key);
  const circle=circleFor(a,b,c);if(!circle){warnings.push('Degenerate saved copper arc retained without refinement.');continue;}
  const plan=circularTessellation(circle.radius,{min:24,max:4096}),steps=Math.max(records.length,2,Math.ceil(plan.segments*Math.abs(circle.sweep)/TAU)),extra=Math.max(0,steps-records.length);
  if(plan.limited||extra>remaining){warnings.push('Saved copper arc refinement reached its geometric error or segment budget; parsed segments are retained.');continue;}
  remaining-=extra;const points=Array.from({length:steps+1},(_,i)=>{const angle=circle.start+circle.sweep*i/steps;return [circle.center[0]+circle.radius*Math.cos(angle),circle.center[1]+circle.radius*Math.sin(angle)];});points[0]=a;points[steps]=c;
  replacements.set(key,Array.from({length:steps},(_,i)=>({...records[Math.min(records.length-1,Math.floor(i*records.length/steps))],...(typeof uuid==='string'?{uuid}:{}),start:points[i],end:points[i+1]})));
 }
 const output=[],emitted=new Set();for(const track of tracks){const key=String(track.id||'').replace(/:\d+$/,'');if(!replacements.has(key))output.push(track);else if(!emitted.has(key)){output.push(...replacements.get(key));emitted.add(key);}}
 return {tracks:output,warnings:[...new Set(warnings)],tolerance:COPPER_TOLERANCE_MM};
}
