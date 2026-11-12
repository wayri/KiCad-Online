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
 const records=[],nets=new Map(children(ast,'net').map(node=>[value(node[1]),String(value(node[2])||'')]));let points=0,truncated=false,unfilled=0;
 for(const zone of children(ast,'zone')){
  const filled=children(zone,'filled_polygon'),polygons=filled.length?filled:children(zone,'polygon');if(!filled.length)unfilled++;
  const layerNode=child(zone,'layers'),layers=layerNode?layerNode.slice(1).map(value):[value(child(zone,'layer')?.[1])];
  for(const polygon of polygons){const pts=children(child(polygon,'pts')||[],'xy').map(node=>[Number(value(node[1])),Number(value(node[2]))]).filter(point=>point.every(Number.isFinite));
   if(pts.length<3)continue;
   const ownLayer=value(child(polygon,'layer')?.[1]);for(const layer of ownLayer?[ownLayer]:layers){if(typeof layer!=='string'||!/^(?:F|B|In[1-9]\d*)\.Cu$/.test(layer))continue;
    if(records.length>=maxPolygons||points+pts.length>maxPoints){truncated=true;continue;}points+=pts.length;
    records.push({points:pts,layer,filled:Boolean(filled.length),id:String(value(child(zone,'uuid')?.[1])||value(child(zone,'tstamp')?.[1])||'saved-zone-'+records.length),net:String(value(child(zone,'net_name')?.[1])||nets.get(value(child(zone,'net')?.[1]))||(typeof value(child(zone,'net')?.[1])==='string'?value(child(zone,'net')?.[1]):''))});
   }
  }
 }
 return{records,unfilled,truncated};
}
