const finitePoint=point=>point&&['x','y','z'].every(axis=>typeof point[axis]==='number'&&Number.isFinite(point[axis]));
const copy=point=>({x:point.x,y:point.y,z:point.z,approximate:Boolean(point.approximate)});
export function surfaceDistance(from,to){
 if(!finitePoint(from)||!finitePoint(to))return null;
 const delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},distance=Math.hypot(delta.x,delta.y,delta.z);
 if(!Number.isFinite(distance))return null;
 return{from:copy(from),to:copy(to),delta,distance,approximate:Boolean(from.approximate||to.approximate)};
}
export function distanceLabel(distance,unit='mm'){
 if(typeof distance!=='number'||!Number.isFinite(distance)||distance<0)return'—';
 return unit==='mil'?(distance/.0254).toFixed(2)+' mil':distance.toFixed(3)+' mm';
}
/** A bounded, in-memory measurement history; project source is never changed. */
export class MeasurementSession{
 constructor(){this.pending=null;this.records=[];this.selected=null;this.nextId=1;}
 add(point){if(!finitePoint(point))return null;if(!this.pending){this.pending=copy(point);this.selected=null;return{pending:this.pending};}
  const record=surfaceDistance(this.pending,point);if(!record)return null;record.id=this.nextId++;this.pending=null;this.records.unshift(record);if(this.records.length>5)this.records.length=5;this.selected=record;return record;
 }
 replay(id){const record=this.records.find(item=>item.id===Number(id));if(!record)return null;this.pending=null;this.selected=record;return record;}
 clear(){this.pending=null;this.records=[];this.selected=null;}
 snapshot(){return{pending:this.pending?copy(this.pending):null,records:this.records.map(record=>({...record,from:copy(record.from),to:copy(record.to),delta:{...record.delta}})),selected:this.selected?.id??null};}
}

/** Nearest visible projected mechanical feature; screen tolerance is in CSS pixels. */
export function snapProjectedEdges(pointer,edges,project,{mode='edges',tolerance=12}={}){
 if(!pointer||![pointer.x,pointer.y,tolerance].every(Number.isFinite)||tolerance<=0||!['edges','corners'].includes(mode)||!Array.isArray(edges))return null;
 let best=null;
 const offer=(point,screen,kind,edge)=>{const distance=Math.hypot(screen.x-pointer.x,screen.y-pointer.y);if(distance<=tolerance&&(!best||distance<best.distance)){best={point:{x:point.x,y:point.y,z:point.z},screen:{x:screen.x,y:screen.y},kind,distance,edge};}};
 for(const edge of edges.slice(0,10000)){
  if(!Array.isArray(edge)||edge.length!==2||!edge.every(finitePoint))continue;
  const [a,b]=edge,pa=project(a),pb=project(b);if(!pa||!pb||![pa.x,pa.y,pa.z,pb.x,pb.y,pb.z].every(Number.isFinite)||pa.z< -1||pa.z>1||pb.z< -1||pb.z>1)continue;
  if(mode==='corners'){offer(a,pa,'mesh vertex');offer(b,pb,'mesh vertex');continue;}
  const dx=pb.x-pa.x,dy=pb.y-pa.y,length=dx*dx+dy*dy;if(length<1e-10)continue;
  const t=Math.max(0,Math.min(1,((pointer.x-pa.x)*dx+(pointer.y-pa.y)*dy)/length));
  const wA=Number.isFinite(pa.w)&&pa.w>0?pa.w:1,wB=Number.isFinite(pb.w)&&pb.w>0?pb.w:1,u=t*wA/((1-t)*wB+t*wA);
  offer({x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u},{x:pa.x+dx*t,y:pa.y+dy*t},'mesh edge',edge);
 }
 return best;
}
