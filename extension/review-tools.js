/* Owned review geometry, page overrides and bounded canvas evidence capture. */
((root)=>{
 'use strict';
 const papers={A0:[1189,841],A1:[841,594],A2:[594,420],A3:[420,297],A4:[297,210],A5:[210,148],A:[279.4,215.9],B:[431.8,279.4],C:[558.8,431.8],D:[863.6,558.8],E:[1117.6,863.6],Letter:[279.4,215.9],Legal:[355.6,215.9],Ledger:[431.8,279.4]};
 function area(a,b){if(![a?.x,a?.y,b?.x,b?.y].every(Number.isFinite))throw new Error('Invalid review area.');const value={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};if(value.width<.001||value.height<.001||[value.x,value.y,value.x+value.width,value.y+value.height].some(n=>Math.abs(n)>1e6))throw new Error('Draw a nonzero review area.');return value;}
 function page(value){
  if(!value||typeof value!=='object')throw new Error('Invalid page setup.');
  let size=papers[value.format],width=size?size[0]:Number(value.width),height=size?size[1]:Number(value.height);
  if(!size&&value.format!=='User')throw new Error('Choose a supported paper format.');
  if(value.portrait)[width,height]=[Math.min(width,height),Math.max(width,height)];
  if(![width,height].every(n=>Number.isFinite(n)&&n>=100&&n<=2000))throw new Error('Page dimensions must be 100–2,000 mm.');
  const titleBlock={};for(const key of ['title','company','date','rev']){if(typeof value[key]!=='string'||value[key].length>300||/[\x00-\x1f]/.test(value[key]))throw new Error('Invalid title-block field.');titleBlock[key]=value[key];}
  if(!Array.isArray(value.comments)||value.comments.length!==9||value.comments.some(s=>typeof s!=='string'||s.length>300||/[\x00-\x1f]/.test(s)))throw new Error('Invalid title-block comments.');titleBlock.comments=value.comments;
  return{format:value.format,width,height,titleBlock};
 }
 function crop(canvas,camera,region){
  const corners=[{x:region.x,y:region.y},{x:region.x+region.width,y:region.y},{x:region.x+region.width,y:region.y+region.height},{x:region.x,y:region.y+region.height}].map(point=>camera.world_to_screen(point));
  const rect=canvas.getBoundingClientRect(),sx=canvas.width/(camera.width||rect.width),sy=canvas.height/(camera.height||rect.height);
  const x=Math.max(0,Math.min(...corners.map(p=>p.x))*sx),y=Math.max(0,Math.min(...corners.map(p=>p.y))*sy),right=Math.min(canvas.width,Math.max(...corners.map(p=>p.x))*sx),bottom=Math.min(canvas.height,Math.max(...corners.map(p=>p.y))*sy);
  if(right-x<2||bottom-y<2)throw new Error('The review area is outside the visible drawing. Fit or zoom it into view before capturing.');
  return{x,y,width:right-x,height:bottom-y};
 }
 function capture(canvas,camera,region,create=()=>document.createElement('canvas')){
  const c=crop(canvas,camera,region),out=create();let factor=Math.min(1,1024/c.width,1024/c.height);
  for(let attempt=0;attempt<6;attempt++){
   out.width=Math.max(1,Math.round(c.width*factor));out.height=Math.max(1,Math.round(c.height*factor));
   const ctx=out.getContext('2d');if(!ctx)throw new Error('Screenshot capture is unavailable.');ctx.drawImage(canvas,c.x,c.y,c.width,c.height,0,0,out.width,out.height);
   const dataUrl=out.toDataURL('image/png');if(dataUrl.length<=262144)return{mime:'image/png',dataUrl,width:out.width,height:out.height};factor*=.65;
  }
  throw new Error('Screenshot is too large; draw a smaller area.');
 }
 const valid=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
 const turn=a=>(a%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
 function onArc(a,angle){return a.ccw?turn(a.start-angle)<=turn(a.start-a.end)+1e-9:turn(angle-a.start)<=turn(a.end-a.start)+1e-9;}
 function snapCategory(p){
  if(p.layer==='Edge.Cuts')return 'outline';
  if(p.hole&&['pads','vias'].includes(p.objectCategory))return p.objectCategory;
  if(p.kind==='pad'||p.kind==='pin'||p.kind==='pin-marker')return 'pads';
  if(p.kind==='via')return 'vias';
  if(['track','segment','wire','bus'].includes(p.kind))return 'tracks';
  if(['symbol','sheet','junction'].includes(p.kind))return 'symbols';
  return 'graphics';
 }
 function snap(at,primitives,options={}){
  if(!valid(at))throw new Error('Invalid ruler point.');
  const mode=options.mode||'geometry-grid',pitch=Number(options.pitch)||1,pixels=Math.max(4,Math.min(32,Number(options.tolerancePixels)||8)),tolerance=pixels/Math.max(.001,Number(options.zoom)||1),origin=options.origin;
  const geometry=mode.includes('geometry'),corners=geometry||mode.startsWith('corners'),edges=geometry||mode.startsWith('edges');
  const filters=options.filters instanceof Set?options.filters:Array.isArray(options.filters)?new Set(options.filters):new Set([options.filter||'all']);
  let point={...at},axis=null;
  if(options.constrain&&valid(origin)){axis=Math.abs(at.x-origin.x)>=Math.abs(at.y-origin.y)?'y':'x';point[axis]=origin[axis];}
  const allowed=q=>valid(q)&&(!axis||Math.abs(q[axis]-origin[axis])<1e-7);
  let best=null,bestDist=Infinity,bestPriority=Infinity;
  const candidate=(q,kind,priority)=>{if(!allowed(q))return;const d=Math.hypot(q.x-point.x,q.y-point.y);if(d<=tolerance&&(priority<bestPriority||priority===bestPriority&&(d<bestDist||Math.abs(d-bestDist)<1e-10&&kind==='hole center'&&['circle center','pad center','via center'].includes(best?.kind)))){best={point:{x:q.x,y:q.y},kind};bestDist=d;bestPriority=priority;}};
  const segment=(a,b)=>{if(!valid(a)||!valid(b))return;const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;let t=l?((point.x-a.x)*dx+(point.y-a.y)*dy)/l:0;
   if(axis&&Math.abs(b[axis]-a[axis])>1e-12){t=(origin[axis]-a[axis])/(b[axis]-a[axis]);if(t<0||t>1)return;}
   else t=Math.max(0,Math.min(1,t));candidate({x:a.x+t*dx,y:a.y+t*dy},'edge',1);
  };
  const circle=(a,kind,sweep)=>{if(!valid(a)||!Number.isFinite(a.r)||a.r<=0)return;const add=q=>{const angle=Math.atan2(q.y-a.y,q.x-a.x);if(!sweep||onArc(a,angle))candidate(q,kind,1);};
   if(axis){const delta=origin[axis]-a[axis],remaining=a.r*a.r-delta*delta;if(remaining<0)return;const other=axis==='x'?'y':'x',distance=Math.sqrt(Math.max(0,remaining));add({[axis]:origin[axis],[other]:a[other]+distance});add({[axis]:origin[axis],[other]:a[other]-distance});}
   else{const angle=Math.atan2(point.y-a.y,point.x-a.x);add({x:a.x+a.r*Math.cos(angle),y:a.y+a.r*Math.sin(angle)});}
  };
  if(!options.bypass&&(corners||edges))for(const p of primitives||[]){
   if(!p||p.hidden||p.frame||(p.hole&&!options.includeHoles)||p.type==='text'||!filters.has('all')&&!filters.has(snapCategory(p)))continue;
   if(geometry&&options.circleCenters&&(p.type==='circle'||p.type==='pad')&&valid(p)&&Number.isFinite(p.r)&&p.r>0)candidate(p,p.hole?'hole center':'circle center',0);
   if(geometry&&['pad','via','pin','junction'].includes(p.kind)){
    if(valid(p.connectPoint))candidate(p.connectPoint,'pin',0);
    else if(valid(p.padCenter))candidate(p.padCenter,'pad center',0);
    else if(valid(p))candidate(p,p.kind+' center',0);
    else if(p.kind==='pad'&&p.points?.length&&p.points.every(valid))candidate({x:p.points.reduce((n,q)=>n+q.x,0)/p.points.length,y:p.points.reduce((n,q)=>n+q.y,0)/p.points.length},'pad center',0);
   }
   if(p.type==='arc'){
    if(corners){candidate(p.start,'endpoint',0);candidate(p.end,'endpoint',0);}
    if(edges&&options.arcThrough){const arc=options.arcThrough(p.start,p.mid,p.end);if(arc)circle(arc,'arc edge',true);}continue;
   }
   if((p.type==='circle'||p.type==='pad')&&valid(p)&&Number.isFinite(p.r)){if(edges)circle(p,'circle edge');continue;}
   const pts=(p.points||[p.start,p.end]).filter(valid),closed=p.type==='polygon'||p.type==='pad';
   // Curved pad outlines are tessellated by the renderer. Their sample vertices
   // are not physical sharp corners; retain edge snapping without inventing them.
   if(corners&&!(p.kind==='pad'&&pts.length>4))for(const q of pts)candidate(q,closed?'corner':'endpoint',0);
   if(edges)for(let i=1;i<pts.length+(closed?1:0);i++)segment(pts[i-1],pts[i%pts.length]);
  }
  if(best)return{...best,constrained:Boolean(axis)};
  if(!options.bypass&&mode.includes('grid')&&pitch>=.001&&pitch<=100){const q={x:Math.round(point.x/pitch)*pitch,y:Math.round(point.y/pitch)*pitch};if(axis)q[axis]=origin[axis];if(mode==='grid'||Math.hypot(q.x-point.x,q.y-point.y)<=tolerance)return{point:q,kind:'grid',constrained:Boolean(axis)};}
  return{point,kind:'free',constrained:Boolean(axis)};
 }
 function boardExtents(primitives,arcThrough){
  const pts=[];for(const p of primitives||[]){if(p.hidden||p.frame||p.layer!=='Edge.Cuts'||p.type==='text')continue;
   if(p.type==='circle'&&valid(p)&&Number.isFinite(p.r))pts.push({x:p.x-p.r,y:p.y-p.r},{x:p.x+p.r,y:p.y+p.r});
   else if(p.type==='arc'){pts.push(...[p.start,p.mid,p.end].filter(valid));const a=arcThrough?.(p.start,p.mid,p.end);if(a)for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])if(onArc(a,angle))pts.push({x:a.x+a.r*Math.cos(angle),y:a.y+a.r*Math.sin(angle)});}
   else pts.push(...(p.points||[]).filter(valid));
  }
  if(!pts.length)return null;let x=Infinity,y=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of pts){x=Math.min(x,p.x);y=Math.min(y,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}const width=maxX-x,height=maxY-y;
  return{x,y,width,height};
 }
 function ruler(a,b,units='mm'){const dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),angle=Math.atan2(dy,dx)*180/Math.PI,factor=units==='mil'?1000/25.4:1;return{dx,dy,distance,angle,text:`${(distance*factor).toFixed(3)} ${units} · ΔX ${(dx*factor).toFixed(3)} · ΔY ${(dy*factor).toFixed(3)} · ${angle.toFixed(1)}°`};}
 function angle(a,v,b){if(![a,v,b].every(valid))return null;const ax=a.x-v.x,ay=a.y-v.y,bx=b.x-v.x,by=b.y-v.y;if(Math.hypot(ax,ay)<1e-9||Math.hypot(bx,by)<1e-9)return null;const degrees=Math.atan2(Math.abs(ax*by-ay*bx),ax*bx+ay*by)*180/Math.PI;return{degrees,text:`${degrees.toFixed(1)}°`};}
 function measurementHistory(limit=5){
  limit=Math.max(1,Math.min(20,Number.isSafeInteger(limit)?limit:5));let rows=[],next=0;
  const clone=row=>({...row,points:row.points.map(p=>({...p}))});
  return {add({kind='distance',points,file}){
   if(!['distance','angle','board'].includes(kind)||typeof file!=='string'||!file||file.length>1024||!Array.isArray(points)||points.length!==(kind==='angle'?3:2)||!points.every(p=>valid(p)&&Math.abs(p.x)<=1e6&&Math.abs(p.y)<=1e6))return null;
   const value=kind==='angle'?angle(...points):ruler(...points,'mm');if(!value)return null;
   const key=JSON.stringify([kind,file,points.map(p=>[p.x,p.y])]);if(rows[0]?.key===key)return clone(rows[0]);
   const row={id:++next,kind,file,points:points.map(p=>({x:p.x,y:p.y})),key};rows.unshift(row);rows.length=Math.min(rows.length,limit);return clone(row);
  },list(){return rows.map(clone);},clear(){rows=[];}};
 }

 // Raster drawing export: bounded local pixels, no external assets or solver calls.
 function rasterPDF(jpeg,width,height,widthMM=297,heightMM=210){
  if(!(jpeg instanceof Uint8Array)||jpeg.length<4||jpeg.length>16*1024*1024||jpeg[0]!==255||jpeg[1]!==216||![width,height].every(v=>Number.isSafeInteger(v)&&v>0&&v<=4096)||width*height>12000000||![widthMM,heightMM].every(v=>Number.isFinite(v)&&v>0&&v<=2000))throw Error('Invalid or oversized PDF image.');
  const encode=s=>new TextEncoder().encode(s),chunks=[],offsets=[0];let length=0;const append=bytes=>{chunks.push(bytes);length+=bytes.length;},text=s=>append(encode(s)),object=(id,body)=>{offsets[id]=length;text(id+' 0 obj\n'+body+'\nendobj\n');};
  const w=(widthMM*72/25.4).toFixed(3),h=(heightMM*72/25.4).toFixed(3);text('%PDF-1.4\n');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+w+' '+h+'] /Resources << /XObject << /Drawing 5 0 R >> >> /Contents 4 0 R >>');
  const commands='q\n'+w+' 0 0 '+h+' 0 0 cm\n/Drawing Do\nQ\n';object(4,'<< /Length '+encode(commands).length+' >>\nstream\n'+commands+'endstream');
  offsets[5]=length;text('5 0 obj\n<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n');append(jpeg);text('\nendstream\nendobj\n');
  const xref=length;text('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)text(String(offsets[i]).padStart(10,'0')+' 00000 n \n');text('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
  const result=new Uint8Array(length);let at=0;for(const bytes of chunks){result.set(bytes,at);at+=bytes.length;}return result;
 }
 function drawingImage(view,{scope='full',create=()=>document.createElement('canvas')}={}){
  const owned=root.KiCadOwnedCanvas;if(!view?.viewport?.camera||!owned?.Camera||!owned.bounds||!['full','viewport'].includes(scope))throw Error('Open a 2D drawing to export.');
  let primitives=(view.primitives||[]).filter(p=>view.geometryVisible(p)&&(!p.layer||p.frame||view.visibleLayers.has(p.layer))&&(!view.focusedLayer||view.layerFocusMode!=='isolate'||!p.layer||p.layer===view.focusedLayer||p.hole||p.layer==='Edge.Cuts'));
  if(primitives.length>1000000)throw Error('Drawing exceeds the export primitive budget.');
  const paper=!view.pcb&&view.design?.page;let box=scope==='viewport'?view.viewport.camera.bbox:paper?{x:0,y:0,w:paper.width,h:paper.height}:owned.bounds(primitives.filter(p=>!p.frame));
  if(!box||![box.x,box.y,box.w,box.h].every(Number.isFinite)||box.w<=0||box.h<=0)throw Error('No finite drawing geometry to export.');
  box={...box};if(scope==='full'&&!paper){const margin=Math.max(1,Math.max(box.w,box.h)*.025);box={x:box.x-margin,y:box.y-margin,w:box.w+2*margin,h:box.h+2*margin};}
  const scale=Math.min(4096/box.w,4096/box.h,Math.sqrt(12000000/(box.w*box.h))),canvas=create();canvas.width=Math.max(1,Math.floor(box.w*scale));canvas.height=Math.max(1,Math.floor(box.h*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas export is unavailable.');
  const camera=new owned.Camera(canvas.width,canvas.height);camera.flipped=view.viewport.camera.flipped;camera.bbox=box;camera.zoom=Math.min(canvas.width/box.w,canvas.height/box.h);
  const painter=Object.create(view);painter.ctx=ctx;painter.canvas=canvas;painter.viewport={camera};painter.paperVisible=Boolean(paper);ctx.fillStyle=paper?view.paperColor():view.background();ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const primitive of primitives){if(primitive.frame&&!paper)continue;view.paint.call(painter,primitive,{color:view.netClassColors?.get(primitive)||null});}
  return{canvas,widthMM:box.w,heightMM:box.h};
 }
 root.KiCadReviewTools={papers,area,page,crop,capture,ruler,angle,snap,boardExtents,measurementHistory,rasterPDF,drawingImage};if(typeof module==='object'&&module.exports)module.exports=root.KiCadReviewTools;
})(globalThis);
