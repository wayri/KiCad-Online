/* Bounded display interpolation of accepted DC samples. No solving or blur. */
((root)=>{'use strict';
 const MAX_PIXELS=384*384,MAX_MASK_POINTS=200000,MAX_MASK_SHAPES=4000,MAX_SUPPORT_RUNS=4000;
 const clamp=x=>Math.max(0,Math.min(1,x));
 const anchors=[[30,74,196],[25,190,198],[250,216,74],[218,54,58]];
 const linear=x=>(x/=255)<=.04045?x/12.92:((x+.055)/1.055)**2.4;
 const gamma=x=>Math.round(255*clamp(x<=.0031308?12.92*x:1.055*Math.max(0,x)**(1/2.4)-.055));
 const labs=anchors.map(rgb=>{const [r,g,b]=rgb.map(linear),l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);return[.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];});
 function color(ratio){const q=clamp(ratio)*3,i=Math.min(2,Math.floor(q)),t=q-i,[L,a,b]=labs[i].map((v,k)=>v+(labs[i+1][k]-v)*t),l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;return[gamma(4.0767416621*l-3.3077115913*m+.2309699292*s),gamma(-1.2684380046*l+2.6097574011*m-.3413193965*s),gamma(-.0041960863*l-.7034186147*m+1.707614701*s)];}
 const palette=Array.from({length:256},(_,i)=>color(i/255));
 function prepare(result,layer,metric){
  if(!['voltage','current','density','loss'].includes(metric))throw Error('Unknown field display metric.');
  const step=result.cellSizeMm;if(!Number.isFinite(step)||step<=0||!Array.isArray(result.nodes)||result.nodes.length>150000||result.edges.length>400000)throw Error('Field display exceeds its bounded sample budget.');
  const nodes=new Map(),grid=new Map(),links=new Set(),values=new Map(),sums=new Map(),key=(x,y)=>x+':'+y,pair=(a,b)=>Math.min(a,b)+':'+Math.max(a,b),sourceV=result.nodes[result.sourceIndex]?.voltageV;if(!Number.isFinite(sourceV))throw Error('The solved source voltage is unavailable.');
  for(let i=0;i<result.nodes.length;i++){const n=result.nodes[i];if(n.layer===layer&&Number.isFinite(n.voltageV)&&[n.x,n.y,n.gx,n.gy].every(Number.isFinite)){nodes.set(i,n);grid.set(key(n.gx,n.gy),i);if(metric==='voltage')values.set(i,Math.abs(sourceV-n.voltageV));}}
  for(const edge of result.edges){if(edge.kind!=='sheet'||!nodes.has(edge.a)||!nodes.has(edge.b))continue;links.add(pair(edge.a,edge.b));if(metric==='voltage')continue;const v=metric==='density'?Math.abs(edge.currentDensityAm2)/1e6:metric==='loss'?edge.lossW:Math.abs(edge.currentA);if(!Number.isFinite(v)||v<0)throw Error('Field display contains an invalid edge sample.');for(const i of [edge.a,edge.b]){const row=sums.get(i)||[0,0];row[0]+=v;row[1]++;sums.set(i,row);}}
  if(!nodes.size)throw Error('No solved copper samples on this layer.');if(metric!=='voltage')for(const [i,row]of sums)values.set(i,row[0]/row[1]);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,maximum=0;for(const [i,n]of nodes){minX=Math.min(minX,n.x-step/2);minY=Math.min(minY,n.y-step/2);maxX=Math.max(maxX,n.x+step/2);maxY=Math.max(maxY,n.y+step/2);maximum=Math.max(maximum,values.get(i)||0);}
  const first=nodes.values().next().value,originX=first.x-(first.gx+.5)*step,originY=first.y-(first.gy+.5)*step;
  // The texture filter is also clipped to exact solved-cell support. A copper
  // mask alone includes unsolved islands of the same net and is insufficient.
  const rows=new Map();for(const [i,n]of nodes){if(!values.has(i))continue;if(!Number.isSafeInteger(n.gx)||!Number.isSafeInteger(n.gy))throw Error('Invalid field grid coordinates.');if(!rows.has(n.gy))rows.set(n.gy,[]);rows.get(n.gy).push(n.gx);}
  const support=[];for(const [gy,xs]of [...rows].sort((a,b)=>a[0]-b[0])){xs.sort((a,b)=>a-b);let start=xs[0],end=start;const add=()=>{if(support.length>=MAX_SUPPORT_RUNS)throw Error('Solved-cell support exceeds its display budget.');support.push({x:originX+start*step,y:originY+gy*step,width:(end-start+1)*step,height:step});};for(let i=1;i<xs.length;i++){if(xs[i]<=end+1)end=Math.max(end,xs[i]);else{add();start=end=xs[i];}}add();}
  if(!support.length)throw Error('No solved sheet samples for this field metric.');
  function sample(x,y){const ux=(x-originX)/step-.5,uy=(y-originY)/step-.5,gx=Math.floor(ux),gy=Math.floor(uy),fx=ux-gx,fy=uy-gy,ids=[grid.get(key(gx,gy)),grid.get(key(gx+1,gy)),grid.get(key(gx,gy+1)),grid.get(key(gx+1,gy+1))];
   if(ids.every(i=>values.has(i))&&[[0,1],[0,2],[1,3],[2,3]].every(([a,b])=>links.has(pair(ids[a],ids[b]))))return(1-fy)*((1-fx)*values.get(ids[0])+fx*values.get(ids[1]))+fy*((1-fx)*values.get(ids[2])+fx*values.get(ids[3]));
   // Boundary strips interpolate only along existing sheet edges. No diagonal
   // or spatial-nearness connection is introduced across missing copper.
   const nearest=grid.get(key(Math.floor(ux+.5),Math.floor(uy+.5)));if(!values.has(nearest))return null;const n=nodes.get(nearest),dx=(x-n.x)/step,dy=(y-n.y)/step;let weighted=values.get(nearest),weight=1;
   for(const [ox,oy,fraction]of [[Math.sign(dx),0,Math.abs(dx)],[0,Math.sign(dy),Math.abs(dy)]]){if(!fraction)continue;const other=grid.get(key(n.gx+ox,n.gy+oy));if(values.has(other)&&links.has(pair(nearest,other))){weighted+=fraction*(values.get(other)-values.get(nearest));weight=1;}}
   return weighted/weight;
  }
  const wantedX=4*(maxX-minX)/step,wantedY=4*(maxY-minY)/step,scale=Math.min(1,384/Math.max(wantedX,wantedY)),width=Math.max(8,Math.min(384,Math.ceil(wantedX*scale))),height=Math.max(8,Math.min(384,Math.ceil(wantedY*scale)));if(width*height>MAX_PIXELS)throw Error('Field texture pixel budget exceeded.');
  const rgba=new Uint8ClampedArray(width*height*4);for(let py=0;py<height;py++)for(let px=0;px<width;px++){const v=sample(minX+(px+.5)/width*(maxX-minX),minY+(py+.5)/height*(maxY-minY));if(v===null)continue;const at=(py*width+px)*4,rgb=palette[Math.round(clamp(maximum?v/maximum:0)*255)];rgba[at]=rgb[0];rgba[at+1]=rgb[1];rgba[at+2]=rgb[2];rgba[at+3]=225;}
  return{bounds:{minX,minY,maxX,maxY},support,width,height,rgba,maximum,sample,description:metric==='voltage'?'Interpolated solved voltage drop':'Interpolated mean incident |edge| '+({current:'current',density:'current density',loss:'loss'}[metric]||'value')};
 }
 function maskGeometry(primitives,net,layer,bounds){
  if(!Array.isArray(primitives)||primitives.length>250000)throw Error('Saved copper mask exceeds its primitive budget.');
  const copper=[],holes=[];let pointCount=0;
  const touches=box=>box[2]>=bounds.minX&&box[3]>=bounds.minY&&box[0]<=bounds.maxX&&box[1]<=bounds.maxY;
  for(const p of primitives||[]){if(p.layer!==layer)continue;const hole=p.hole===true,selected=p.netId!==undefined?p.netId===net.id:p.netName===net.name;if(!hole&&(!selected||!['track','pad','via','zone'].includes(p.kind)))continue;
   let d,box,stroke=false,width=Number(p.width)||0;if(p.r>0&&Number.isFinite(p.x)&&Number.isFinite(p.y)){box=[p.x-p.r,p.y-p.r,p.x+p.r,p.y+p.r];d=`M ${p.x-p.r} ${p.y} a ${p.r} ${p.r} 0 1 0 ${2*p.r} 0 a ${p.r} ${p.r} 0 1 0 ${-2*p.r} 0`;}else if(Array.isArray(p.points)&&p.points.length>=2){if(p.points.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)))throw Error('Invalid saved copper mask geometry.');let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const q of p.points){minX=Math.min(minX,q.x);minY=Math.min(minY,q.y);maxX=Math.max(maxX,q.x);maxY=Math.max(maxY,q.y);}stroke=p.type==='line';const radius=stroke?width/2:0;box=[minX-radius,minY-radius,maxX+radius,maxY+radius];if(!touches(box))continue;pointCount+=p.points.length;if(pointCount>MAX_MASK_POINTS)throw Error('Saved copper mask exceeds its geometry budget.');d=p.points.map((q,i)=>(i?'L ':'M ')+q.x+' '+q.y).join(' ')+(stroke?'':' Z');}else throw Error('Saved copper geometry cannot be masked faithfully.');
   if(!touches(box))continue;if(stroke&&!(width>0))throw Error('Saved track width is unavailable for field masking.');const shape={d,stroke,width};(hole?holes:copper).push(shape);if(copper.length+holes.length>MAX_MASK_SHAPES)throw Error('Saved copper mask exceeds its shape budget.');
  }
  if(!copper.length)throw Error('Saved copper mask is unavailable for this net and layer.');return{copper,holes};
 }
 function texture(field,document){const canvas=document.createElement('canvas');canvas.width=field.width;canvas.height=field.height;const context=canvas.getContext?.('2d');if(!context||!canvas.toDataURL)throw Error('Field texture rendering is unavailable.');const pixels=context.createImageData(field.width,field.height);pixels.data.set(field.rgba);context.putImageData(pixels,0,0);return canvas.toDataURL('image/png');}
 // A visible 3D cell must fit wholly within one saved copper primitive. Reject
 // every cell touching a polygon boundary or a drill/void bounding box.
 function surfaceGuard(primitives,net,layer,bounds){
  if(!Array.isArray(primitives)||primitives.length>250000||!net||!Number.isFinite(bounds?.minX)||!Number.isFinite(bounds?.maxX))throw Error('Saved copper surface mask is unavailable or exceeds its primitive budget.');
  const items=[];let points=0;
  const intersects=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
  const circle=p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.r)&&p.r>0;
  for(const p of primitives){
   if(p.layer!==layer)continue;
   const selected=p.netId!==undefined?p.netId===net.id:p.netName===net.name;
   if(!p.hole&&!selected)continue;
   if(!p.hole&&p.kind==='arc')throw Error('Saved copper surface includes unsupported selected geometry.');
   if(!p.hole&&!['pad','via','track','zone'].includes(p.kind))continue;
   let box,shape;
   if(circle(p)){box=[p.x-p.r,p.y-p.r,p.x+p.r,p.y+p.r];shape='circle';}
   else if(Array.isArray(p.points)&&p.points.length>=2&&p.points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y))){
    points+=p.points.length;if(points>200000)throw Error('Saved copper surface exceeds its point budget.');
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const q of p.points){minX=Math.min(minX,q.x);minY=Math.min(minY,q.y);maxX=Math.max(maxX,q.x);maxY=Math.max(maxY,q.y);}const radius=p.type==='line'?Number(p.width)/2:0;
    if(!Number.isFinite(radius)||radius<0||p.type==='line'&&!(radius>0))throw Error('Saved copper surface has an invalid track width.');
    box=[minX-radius,minY-radius,maxX+radius,maxY+radius];
    shape=p.type==='line'?(p.points.length===2?'line':null):p.points.length>=3?'polygon':null;
   }
   if(!shape||!box.every(Number.isFinite))throw Error('Saved copper surface includes unsupported or invalid geometry.');
   if(intersects(box,[bounds.minX,bounds.minY,bounds.maxX,bounds.maxY]))items.push({p,box,shape,hole:Boolean(p.hole)});
  }
  if(!items.some(item=>!item.hole))throw Error('Saved copper surface mask is unavailable for this net and layer.');
  const bins=Array.from({length:256},()=>[]),width=Math.max((bounds.maxX-bounds.minX)/256,1e-9);let references=0;
  const bucket=x=>Math.max(0,Math.min(255,Math.floor((x-bounds.minX)/width)));
  for(let i=0;i<items.length;i++){const [min,,max]=items[i].box;for(let b=bucket(min);b<=bucket(max);b++){if(++references>1000000)throw Error('Saved copper surface spatial index exceeds its budget.');bins[b].push(i);}}
  const seen=new Int32Array(items.length);let stamp=0,checks=0;
  const spend=()=>{if(++checks>4000000)throw Error('Saved copper surface cell checks exceed their work budget.');};
  const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
  const contains=(item,q)=>{const p=item.p;if(item.shape==='circle')return Math.hypot(q.x-p.x,q.y-p.y)<=p.r;
   if(item.shape==='line')return p.points.some((a,i)=>{if(!i)return false;spend();return distance(q,p.points[i-1],a)<=p.width/2;});
   let inside=false;for(let i=0,j=p.points.length-1;i<p.points.length;j=i++){spend();const a=p.points[i],b=p.points[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;};
  const edgeTouches=(a,b,box)=>{let lo=0,hi=1,dx=b.x-a.x,dy=b.y-a.y;for(const [p,q]of [[-dx,a.x-box[0]],[dx,box[2]-a.x],[-dy,a.y-box[1]],[dy,box[3]-a.y]]){if(!p){if(q<0)return false;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;}return true;};
  return corners=>{
   const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y),cell=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
   let covering=false;stamp++;
   for(let b=bucket(cell[0]);b<=bucket(cell[2]);b++)for(const index of bins[b]){if(seen[index]===stamp)continue;seen[index]=stamp;
    spend();
    const item=items[index];if(!intersects(item.box,cell))continue;
    if(item.hole)return false;
    if(item.shape==='polygon'){const pts=item.p.points;for(let i=0;i<pts.length;i++){spend();if(edgeTouches(pts[i],pts[(i+1)%pts.length],cell))return false;}}
    if(!covering&&corners.every(q=>contains(item,q)))covering=true;
   }
   return covering;
  };
 }
 // Conservative display cells: all corners and edge midpoints must remain on
 // validated copper. Partial boundary cells are omitted, never painted over holes.
 function surface(result,layer,metric,contains,primitives,net){
  const field=prepare(result,layer,metric),points=[],triangles=[],values=[],half=result.cellSizeMm*.499;
  const wholeCell=surfaceGuard(primitives,net,layer,field.bounds);
  for(const n of result.nodes){if(n.layer!==layer||!Number.isFinite(n.voltageV))continue;
   const corners=[[-half,-half],[half,-half],[half,half],[-half,half]].map(([x,y])=>({x:n.x+x,y:n.y+y,layer}));
   if(!corners.every(contains)||!corners.every((p,i)=>contains({x:(p.x+corners[(i+1)%4].x)/2,y:(p.y+corners[(i+1)%4].y)/2,layer}))||!wholeCell(corners))continue;
   const samples=corners.map(p=>field.sample(p.x,p.y));if(samples.some(v=>v===null||!Number.isFinite(v)))continue;
   const start=points.length;for(let i=0;i<4;i++){points.push([corners[i].x,corners[i].y,0]);values.push(samples[i]);}triangles.push([start,start+1,start+2],[start,start+2,start+3]);
   if(triangles.length>=200000)throw Error('3D field exceeds its display budget.');
  }
  if(!triangles.length)throw Error('No complete solved copper cells on this layer. Use Layout for boundary-clipped results.');
  return{points,triangles,values,nodal:true,layer,zKnown:false,description:field.description,maximum:field.maximum};
 }
 const API={color,prepare,maskGeometry,texture,surface,surfaceGuard};root.KiCadFastPIField=API;if(typeof module==='object'&&module.exports)module.exports=API;
})(globalThis);
