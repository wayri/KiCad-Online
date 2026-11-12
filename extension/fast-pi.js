/* Experimental fixed-temperature 2.5D DC screening. Coordinates: mm; SI electrical outputs. */
((root)=>{'use strict';
const val=x=>x&&typeof x==='object'&&!Array.isArray(x)?x.quoted:x;
const tag=n=>Array.isArray(n)?String(val(n[0])):'';
const kids=(n,t)=>Array.isArray(n)?n.filter(x=>tag(x)===t):[];
const one=(n,t)=>kids(n,t)[0];
const num=(n,i=1)=>Number(val(n?.[i]));
const str=(n,i=1)=>String(val(n?.[i])??'');
const fail=message=>{throw new Error('Fast DC drop: '+message);};
function positive(x,name){if(!Number.isFinite(x)||x<=0)fail(name+' must be explicitly supplied and positive');return x;}
function polygonContains(p,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
function distance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
const holeContains=(hole,p)=>hole.test?hole.test(p):Math.hypot(p.x-hole.p.x,p.y-hole.p.y)<hole.r;
function geometry(ast,net,layers){
 // Match the bounded design parser's one-million-node input ceiling. Mesh and
 // selected copper budgets below remain independent of unrelated board objects.
 if(ast.length>1000000)fail('Board object budget exceeded');let polygonPoints=0;
 const shapes=[],vias=[],unsupported=[];let holes=[];const names=layers.map(l=>l.name);const selected=n=>val(one(n,'net')?.[1])===net;const xy=n=>({x:num(n),y:num(n,2)});
 const add=(layer,test,box)=>{if(!names.includes(layer))fail('Missing explicit copper-layer context for '+layer);if(!box.every(Number.isFinite))fail('Non-finite copper geometry');shapes.push({layer,test,box});};
 const circle=(layer,p,r)=>add(layer,q=>Math.hypot(p.x-q.x,p.y-q.y)<=r,[p.x-r,p.y-r,p.x+r,p.y+r]);
 for(const n of ast){const kind=tag(n);if(kind==='segment'&&selected(n)){const a=xy(one(n,'start')),b=xy(one(n,'end')),r=positive(num(one(n,'width')),'trace width')/2;add(str(one(n,'layer')),p=>distance(p,a,b)<=r,[Math.min(a.x,b.x)-r,Math.min(a.y,b.y)-r,Math.max(a.x,b.x)+r,Math.max(a.y,b.y)+r]);}
 else if(kind==='arc'&&selected(n))unsupported.push('arc tracks');
 else if(kind==='zone'&&selected(n)){const fills=kids(n,'filled_polygon');if(!fills.length)fail('Selected net has an unfilled zone; refill and save in KiCad first');for(const fill of fills){const points=kids(one(fill,'pts'),'xy').map(xy);polygonPoints+=points.length;if(points.length<3||points.length>10000||polygonPoints>100000)fail('Invalid or excessive filled zone geometry');add(str(one(fill,'layer'))||str(one(n,'layer')),p=>polygonContains(p,points),[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))]);}}
 else if(kind==='via'){const p=xy(one(n,'at')),r=num(one(n,'size'))/2,drill=positive(num(one(n,'drill')),'via drill'),ends=(one(n,'layers')||[]).slice(1).map(val),a=names.indexOf(ends[0]),b=names.indexOf(ends.at(-1));if(a<0||b<0)fail('Via layer span is unavailable in the supplied stackup');if(a===b)fail('Via needs a positive layer span');const span=names.slice(Math.min(a,b),Math.max(a,b)+1);if(!Number.isFinite(r)||r<=drill/2||!Number.isFinite(p.x)||!Number.isFinite(p.y))fail('Invalid via geometry');for(const layer of span)holes.push({layer,p,r:drill/2});if(selected(n)){positive(drill,'via drill');positive(r,'via radius');for(const layer of span)circle(layer,p,r);vias.push({p,drill,span,r});}}
 else if(kind==='footprint'){const at=one(n,'at'),origin=xy(at),angle=-(Number.isFinite(num(at,3))?num(at,3):0)*Math.PI/180;for(const pad of kids(n,'pad')){const position=xy(one(pad,'at')),p={x:origin.x+position.x*Math.cos(angle)-position.y*Math.sin(angle),y:origin.y+position.x*Math.sin(angle)+position.y*Math.cos(angle)},raw=(one(pad,'layers')||[]).slice(1).map(val),span=raw.includes('*.Cu')?names:raw.filter(l=>l.endsWith('.Cu')),drillNode=one(pad,'drill'),slotted=drillNode&&str(drillNode)==='oval',offset=one(drillNode,'offset'),pa=one(pad,'at'),theta=-(Number.isFinite(num(pa,3))?num(pa,3):0)*Math.PI/180,drill=drillNode?positive(num(drillNode,slotted?2:1),'pad drill'):0;
  if(drillNode){const width=drill,height=slotted?positive(num(drillNode,3),'pad slot height'):drill,ox=offset?num(offset):0,oy=offset?num(offset,2):0;if(![p.x,p.y,ox,oy].every(Number.isFinite))fail('Non-finite pad drill geometry');const center={x:p.x+ox*Math.cos(theta)-oy*Math.sin(theta),y:p.y+ox*Math.sin(theta)+oy*Math.cos(theta)},extent=Math.max(width,height)/2;const test=q=>{const dx=q.x-center.x,dy=q.y-center.y,x=dx*Math.cos(theta)+dy*Math.sin(theta),y=-dx*Math.sin(theta)+dy*Math.cos(theta);return width>=height?distance({x,y},{x:-(width-height)/2,y:0},{x:(width-height)/2,y:0})<height/2:distance({x,y},{x:0,y:-(height-width)/2},{x:0,y:(height-width)/2})<width/2;};for(const layer of span)holes.push({layer,p:center,r:extent,test});}
  if(!selected(pad))continue;if(slotted){unsupported.push('selected slotted drilled pads (plated slot barrel resistance is not modeled)');continue;}if(offset){unsupported.push('selected offset drilled pads');continue;}
  const size=one(pad,'size'),w=positive(num(size),'pad width'),h=positive(num(size,2),'pad height'),shape=str(pad,3);if(!['rect','circle','oval','roundrect'].includes(shape)){unsupported.push(shape+' pads');continue;}for(const layer of span){const extent=Math.hypot(w,h)/2;add(layer,q=>{const dx=q.x-p.x,dy=q.y-p.y,x=dx*Math.cos(theta)+dy*Math.sin(theta),y=-dx*Math.sin(theta)+dy*Math.cos(theta);if(shape==='circle')return x*x+y*y<=(w/2)**2;if(shape==='rect')return Math.abs(x)<=w/2&&Math.abs(y)<=h/2;if(shape==='roundrect'){const ratio=num(one(pad,'roundrect_rratio'));if(!Number.isFinite(ratio)||ratio<0||ratio>.5)fail('Invalid rounded pad corner ratio');const radius=Math.min(w,h)*ratio;return Math.hypot(Math.max(0,Math.abs(x)-(w/2-radius)),Math.max(0,Math.abs(y)-(h/2-radius)))<=radius;}return w>=h?distance({x,y},{x:-(w-h)/2,y:0},{x:(w-h)/2,y:0})<=h/2:distance({x,y},{x:0,y:-(h-w)/2},{x:0,y:(h-w)/2})<=w/2;},[p.x-extent,p.y-extent,p.x+extent,p.y+extent]);}if(drill>0&&str(pad,2)==='thru_hole')vias.push({p,drill,span,r:Math.min(w,h)/2});}}
 }
 // Drill voids from every net matter physically, but only on a selected copper
 // layer and inside its bounds. A remote mounting hole must not exhaust a tiny
 // rail's geometry/mesh budget or be tested at every sampled point.
 const bounds=new Map();for(const shape of shapes){const box=bounds.get(shape.layer);if(box){box[0]=Math.min(box[0],shape.box[0]);box[1]=Math.min(box[1],shape.box[1]);box[2]=Math.max(box[2],shape.box[2]);box[3]=Math.max(box[3],shape.box[3]);}else bounds.set(shape.layer,shape.box.slice());}
 holes=holes.filter(h=>{const b=bounds.get(h.layer);return b&&h.p.x+h.r>=b[0]&&h.p.y+h.r>=b[1]&&h.p.x-h.r<=b[2]&&h.p.y-h.r<=b[3];});
 if(shapes.length+holes.length>10000||vias.length>1000)fail('Copper geometry budget exceeded');if(unsupported.length)fail('Unsupported selected-net geometry: '+[...new Set(unsupported)].join(', '));if(!shapes.length)fail('No supported copper on the selected net');return {shapes,vias,holes,polygonPoints};
}
function solveBoard(ast,options){
 if(options?.loadPowerW!==undefined)fail('Use solveAdaptive with loadPowerW and omit currentA for a constant-power load');
 const {layers,source,sink}=options||{};if(!Array.isArray(ast)||tag(ast)!=='kicad_pcb')fail('A parsed KiCad PCB is required');if(!Array.isArray(layers)||!layers.length||layers.length>64)fail('Explicit ordered copper stackup required');
 const sigma=positive(options.conductivitySm,'conductivity (S/m)'),step=positive(options.cellSizeMm,'cell size (mm)'),current=positive(options.currentA,'sink current (A)'),voltage=options.sourceVoltageV;if(!Number.isFinite(voltage))fail('Explicit source voltage required');const net=options.net;if(net===undefined||net===null||net==='')fail('Explicit net ID required');
 const seen=new Set();for(let i=0;i<layers.length;i++){const l=layers[i];if(typeof l.name!=='string'||seen.has(l.name)||!Number.isFinite(l.zMm))fail('Unique copper layer names and finite elevations required');positive(l.thicknessMm,'copper thickness');if(i&&l.zMm<=layers[i-1].zMm)fail('Copper elevations must strictly increase');seen.add(l.name);}
 const g=geometry(ast,net,layers),minX=Math.floor(Math.min(...g.shapes.map(s=>s.box[0]))/step)*step,minY=Math.floor(Math.min(...g.shapes.map(s=>s.box[1]))/step)*step,maxX=Math.max(...g.shapes.map(s=>s.box[2])),maxY=Math.max(...g.shapes.map(s=>s.box[3])),nx=Math.ceil((maxX-minX)/step),ny=Math.ceil((maxY-minY)/step);
 const budgetRatio=Math.max(nx*ny*layers.length/150000,nx*ny*(g.shapes.length+g.holes.length+g.polygonPoints)/10000000);if(!Number.isFinite(budgetRatio)||budgetRatio>1){const suggested=step*Math.sqrt(budgetRatio)*1.1;fail('Mesh budget exceeded; choose a coarser cell size'+(Number.isFinite(suggested)?' (try at least '+suggested.toPrecision(3)+' mm)':'')+' or smaller net');}
 const copperAt=(p,layer)=>g.shapes.some(s=>s.layer===layer&&p.x>=s.box[0]&&p.x<=s.box[2]&&p.y>=s.box[1]&&p.y<=s.box[3]&&s.test(p))&&!g.holes.some(h=>h.layer===layer&&holeContains(h,p));
 const nodes=[],index=new Map(),key=(l,x,y)=>l+':'+x+':'+y;
 for(let l=0;l<layers.length;l++){const shape=g.shapes.filter(s=>s.layer===layers[l].name),holes=g.holes.filter(h=>h.layer===layers[l].name);for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const p={x:minX+(x+.5)*step,y:minY+(y+.5)*step};if(shape.some(s=>p.x>=s.box[0]&&p.x<=s.box[2]&&p.y>=s.box[1]&&p.y<=s.box[3]&&s.test(p))&&!holes.some(h=>holeContains(h,p))){index.set(key(l,x,y),nodes.length);nodes.push({...p,layer:layers[l].name,l,gx:x,gy:y});}}}
 if(nodes.length<2)fail('Copper is unresolved at this cell size');const edges=[];for(let i=0;i<nodes.length;i++){const n=nodes[i],conductance=sigma*layers[n.l].thicknessMm*.001;for(const [dx,dy]of [[1,0],[0,1]]){const j=index.get(key(n.l,n.gx+dx,n.gy+dy));if(j!==undefined&&[.25,.5,.75].every(t=>copperAt({x:n.x+dx*step*t,y:n.y+dy*step*t},n.layer)))edges.push({a:i,b:j,g:conductance,areaM2:step*layers[n.l].thicknessMm*1e-6,kind:'sheet'});}}
 const nearest=(p,layer,maxDistance,label='Contact')=>{let id=-1,d=Infinity;for(let i=0;i<nodes.length;i++)if(nodes[i].layer===layer){const dd=Math.hypot(nodes[i].x-p.x,nodes[i].y-p.y);if(dd<d){d=dd;id=i;}}if(d>maxDistance)fail(label+' is unresolved at '+p.x.toFixed(4)+', '+p.y.toFixed(4)+' mm on '+layer+' at this mesh size');return id;};
 if(g.vias.reduce((sum,v)=>sum+v.span.length,0)*nodes.length>10000000)fail('Via connection search budget exceeded; choose a coarser mesh');
 if(g.vias.length){const plating=positive(options.viaPlatingMm,'via plating thickness (mm)');for(const via of g.vias){if(via.drill/2+plating>=via.r)fail('Via plating must fit inside the saved annulus');const ids=via.span.map(l=>nearest(via.p,l,via.drill/2+step*1.5,'Via'));for(let k=1;k<ids.length;k++){const a=ids[k-1],b=ids[k],length=Math.abs(layers[nodes[b].l].zMm-layers[nodes[a].l].zMm)*.001,area=Math.PI*((via.drill/2+plating)**2-(via.drill/2)**2)*1e-6;edges.push({a,b,g:sigma*area/length,areaM2:area,kind:'via'});}}}
 for(const p of [source,sink]){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!seen.has(p.layer))fail('Source and sink need board coordinates and an explicit layer');if(!copperAt(p,p.layer)&&!g.vias.some(v=>v.span.includes(p.layer)&&Math.hypot(v.p.x-p.x,v.p.y-p.y)<=v.r))fail('Pick source and load on the selected net copper, pad or plated via.');}const terminal=(p,label)=>{const via=g.vias.find(v=>v.span.includes(p.layer)&&Math.hypot(v.p.x-p.x,v.p.y-p.y)<=v.r);return nearest(p,p.layer,via?Math.max(step,via.drill/2+step*1.5):step,label);};const s=terminal(source,'Source contact'),t=terminal(sink,'Load contact');if(s===t)fail('Terminals resolve to the same cell; refine mesh');
 const adjacency=nodes.map(()=>[]);for(const e of edges){adjacency[e.a].push(e.b);adjacency[e.b].push(e.a);}const connected=new Set([s]),queue=[s];for(let k=0;k<queue.length;k++)for(const j of adjacency[queue[k]])if(!connected.has(j)){connected.add(j);queue.push(j);}if(!connected.has(t))fail('Source and sink are disconnected at this mesh resolution');
 for(const e of edges)if(!Number.isFinite(e.g)||e.g<=0||!Number.isFinite(e.areaM2)||e.areaM2<=0)fail('Conductance is outside finite numerical range');if(!Number.isFinite(current*current)||current*current===0)fail('Current is outside numerical range');
 const active=queue.filter(i=>i!==s),remap=new Map(active.map((n,i)=>[n,i])),n=active.length,diagonal=new Float64Array(n),rhs=new Float64Array(n),links=[];rhs[remap.get(t)]=-current;
 for(const e of edges)if(connected.has(e.a)&&connected.has(e.b)){const a=remap.get(e.a),b=remap.get(e.b);if(a!==undefined)diagonal[a]+=e.g;if(b!==undefined)diagonal[b]+=e.g;if(a!==undefined&&b!==undefined)links.push({a,b,g:e.g});}
 const multiply=v=>{const out=Float64Array.from(v,(x,i)=>x*diagonal[i]);for(const e of links){out[e.a]-=e.g*v[e.b];out[e.b]-=e.g*v[e.a];}return out;},dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),x=new Float64Array(n),r=rhs.slice(),z=Float64Array.from(r,(v,i)=>v/diagonal[i]);let p=z.slice(),rz=dot(r,z),iterations=0,residual=Math.sqrt(dot(r,r));
 const iterationLimit=Math.min(4000,Math.floor(50000000/Math.max(1,n+links.length)));
 for(;iterations<iterationLimit&&residual>current*1e-8;iterations++){const ap=multiply(p),den=dot(p,ap);if(!(den>0))fail('Solver matrix breakdown');const alpha=rz/den;for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];z[i]=r[i]/diagonal[i];}const next=dot(r,z),beta=next/rz;for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];rz=next;residual=Math.sqrt(dot(r,r));}
 // Recompute the physical residual instead of trusting the recursive CG norm.
 const actual=multiply(x);residual=Math.sqrt(actual.reduce((sum,v,i)=>sum+(v-rhs[i])**2,0));
 if(!Number.isFinite(residual)||residual>current*1e-8)fail('DC solver did not converge within its work budget; no result accepted');const offsets=nodes.map((node,i)=>connected.has(i)?(i===s?0:x[remap.get(i)]):null);const solved=nodes.map((node,i)=>({...node,voltageV:connected.has(i)?voltage+offsets[i]:null}));let loss=0;const flows=edges.filter(e=>connected.has(e.a)&&connected.has(e.b)).map(e=>{const drop=offsets[e.a]-offsets[e.b],I=drop*e.g,P=drop*I;loss+=P;return {...e,currentA:I,currentDensityAm2:I/e.areaM2,lossW:P};});const drop=-offsets[t];if(!Number.isFinite(drop)||!Number.isFinite(loss)||solved.some(n=>n.voltageV!==null&&!Number.isFinite(n.voltageV))||flows.some(e=>![e.currentA,e.currentDensityAm2,e.lossW].every(Number.isFinite))||Math.abs(loss-drop*current)>Math.max(loss,Math.abs(drop*current))*1e-6)fail('Result failed finite-value or power-conservation checks; no result accepted');
 return {experimental:true,method:'fixed-temperature 2.5D finite-volume DC',nodes:solved,edges:flows,sourceIndex:s,sinkIndex:t,voltageV:solved[t].voltageV,dropV:drop,resistanceOhm:drop/current,currentA:current,lossW:loss,residualA:residual,iterations,cellSizeMm:step,unconnectedCells:nodes.length-connected.size,warnings:['Screening approximation: perform mesh refinement before relying on extrema. Cell-center sampling can miss narrow gaps, thin traces and thermal-relief spokes; inspect connectivity at multiple resolutions.','Single-net voltage is relative to the supplied ideal source; return-network impedance is not included.','Via barrels use lumped resistance attached to one nearby mesh cell; pad spreading is mesh dependent.','No AC, temperature feedback, dielectric, or physical qualification is provided.']};
}
// A passive fixed-temperature network is linear. One unit-current solve supplies
// its Thevenin resistance and the complete field; no nonlinear mesh solves are
// needed. Select Vload = (Vs + sqrt(Vs^2 - 4RP))/2, using ratios to avoid Vs^2
// overflow and cancellation at small drops. The fold itself is not a stable
// high-voltage operating point, and is rejected with a small rounding margin.
function constantPowerResult(reference,sourceVoltageV,loadPowerW){
 const resistance=reference.resistanceOhm;
 if(!Number.isFinite(resistance)||resistance<=0)fail('Constant-power resistance is outside positive finite numerical range; no result accepted');
 const ratio=Math.sqrt(resistance)*Math.sqrt(loadPowerW)/sourceVoltageV,utilization=4*ratio*ratio;
 if(!Number.isFinite(utilization)||utilization>=1-1e-12)fail('Constant-power load reaches or exceeds the voltage-collapse limit (or is numerically too close); no high-voltage operating point accepted');
 const loadVoltage=sourceVoltageV*(.5+.5*Math.sqrt(1-utilization)),current=loadPowerW/loadVoltage;
 if(!Number.isFinite(current)||current<=0||!Number.isFinite(current*current)||current*current===0)fail('Constant-power current is outside numerical range; no result accepted');
 const nodes=reference.nodes.map(node=>({...node,voltageV:node.voltageV===null?null:sourceVoltageV+node.voltageV*current}));
 const edges=reference.edges.map(edge=>({...edge,currentA:edge.currentA*current,currentDensityAm2:edge.currentDensityAm2*current,lossW:edge.lossW*current*current}));
 const loss=edges.reduce((sum,edge)=>sum+edge.lossW,0),drop=reference.dropV*current,voltage=nodes[reference.sinkIndex].voltageV;
 const balance=new Float64Array(nodes.length);for(const edge of edges){balance[edge.a]+=edge.currentA;balance[edge.b]-=edge.currentA;}
 const residual=current*Math.sqrt(balance.reduce((sum,value,i)=>sum+(i===reference.sourceIndex||nodes[i].voltageV===null?0:(value/current+(i===reference.sinkIndex?1:0))**2),0));
 if(!Number.isFinite(loss)||!Number.isFinite(drop)||!Number.isFinite(residual)||residual>current*1e-8||voltage<=0||nodes.some(node=>node.voltageV!==null&&!Number.isFinite(node.voltageV))||edges.some(edge=>![edge.currentA,edge.currentDensityAm2,edge.lossW].every(Number.isFinite))||!Number.isFinite(sourceVoltageV*current)||Math.abs(voltage*current-loadPowerW)>loadPowerW*1e-6||Math.abs(loss-drop*current)>Math.max(loss,Math.abs(drop*current))*1e-6)fail('Constant-power result failed finite-value, residual or power-conservation checks; no result accepted');
 return {...reference,nodes,edges,currentA:current,voltageV:voltage,dropV:drop,lossW:loss,residualA:residual,loadMode:'power',loadPowerW,requestedLoadPowerW:loadPowerW,operatingPoint:'high-voltage',warnings:[...reference.warnings,'Constant-power load uses the high-voltage DC operating point; transient stability and regulator dynamics are not modeled.']};
}
// Recover under-resolved contacts with at most two finer meshes. Every attempt
// retains the same geometry, explicit inputs, work limits and acceptance checks.
function solveAdaptive(ast,options){
 const powerMode=options?.loadPowerW!==undefined;
 if(powerMode&&options.currentA!==undefined)fail('Supply either currentA or loadPowerW, not both');
 if(powerMode){positive(options.loadPowerW,'load power (W)');positive(options.sourceVoltageV,'constant-power source voltage (V)');}
 const {loadPowerW,...linearOptions}=options||{},requested=options?.cellSizeMm;let last;
 for(let attempt=0;attempt<3;attempt++){
  try{const linear=solveBoard(ast,{...linearOptions,...(powerMode?{currentA:1,sourceVoltageV:0}:{}),cellSizeMm:requested/2**attempt}),result=powerMode?constantPowerResult(linear,options.sourceVoltageV,loadPowerW):{...linear,loadMode:'current'};
   return {...result,meshAttempts:attempt+1,requestedCellSizeMm:requested,warnings:[...(attempt?['Contacts required automatic mesh refinement from '+requested+' to '+result.cellSizeMm+' mm.']:[]),...result.warnings]};
  }catch(error){
   const recoverable=/unresolved|disconnected at this mesh|same cell; refine mesh/.test(error.message);
   if(!recoverable){if(last&&/budget exceeded/.test(error.message))fail('The contacts need a finer mesh than this net can fit within the solve budget. Choose pads on a smaller connected net, or use the full PI workflow.');throw error;}
   last=error;
  }
 }
 throw Error(last.message+'. Tried three mesh resolutions. Choose another saved pad/layer pair or inspect the saved copper connectivity. No result accepted.');
}
function createContactValidator(ast,net,layers){
 const g=geometry(ast,net,layers);
 return p=>Boolean(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(g.vias.some(v=>v.span.includes(p.layer)&&Math.hypot(v.p.x-p.x,v.p.y-p.y)<=v.r)||(g.shapes.some(s=>s.layer===p.layer&&p.x>=s.box[0]&&p.x<=s.box[2]&&p.y>=s.box[1]&&p.y<=s.box[3]&&s.test(p))&&!g.holes.some(h=>h.layer===p.layer&&holeContains(h,p)))));
}
const api={solveBoard,solveAdaptive,createContactValidator};root.KiCadFastPI=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
