/* Saved EMerge / Quick EMerge display data. The browser never runs a solver. */
((root)=>{
 'use strict';
 const FAMILY='EMerge results',MAX_BYTES=64*1024*1024,MAX_SAMPLES=200000,MAX_PLOT_POINTS=400000;
 const touchstone=/\.s([1-9][0-9]?)p$/i;
 const candidate=path=>typeof path==='string'&&(/\.egres$/i.test(path)||touchstone.test(path));
 const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const plugin=raw=>record(raw)&&(raw.wayricad_saved_result?.schema==='wayricad.project-result/v1'&&raw.wayricad_saved_result.plugin==='quick-emerge'||raw.schema===1&&record(raw.backend)&&
   (record(raw.s_parameters)&&Array.isArray(raw.frequencies_hz)||record(raw.field)||record(raw.radiation)||record(raw.array_factor)));
 const recognizes=raw=>Boolean(record(raw)&&(['sparams','farfield_cut','quasi_sweep'].includes(raw.kind)||plugin(raw)));
 const key=(response,excitation)=>'S'+response+(response>=10||excitation>=10?'_':'')+excitation;
 function axis(values,label,{increasing=false,nonnegative=false,max=MAX_SAMPLES}={}){
  if(!Array.isArray(values)||!values.length||values.length>max||
     values.some((v,i)=>!finite(v)||nonnegative&&v<0||increasing&&i>0&&v<=values[i-1]))throw Error('Invalid or oversized '+label+' axis.');
  return values;
 }
 function wave(label,x,y,unit=''){
  if(!Array.isArray(y)||x.length!==y.length||y.some(value=>value!==null&&!finite(value)))throw Error('Invalid saved '+label+' samples.');
  return {name:label,signal:{name:label,quantity:'em',unit},points:x.map((value,i)=>({x:value,y:y[i]}))};
 }
 function network(result,frequencies,traces,reference){
  const x=axis(frequencies,'frequency',{increasing:true,nonnegative:true}),entries=Object.entries(traces);
  if(!entries.length||entries.length>1024)throw Error('Unsupported or empty S-parameter matrix.');
  const limit=Math.min(64,Math.floor(MAX_PLOT_POINTS/(2*x.length)));
  const magnitude=[],phase=[];
  for(const [label,pairs]of entries){
   if(!/^S(?:[1-9][1-9]|[1-9][0-9]?_[1-9][0-9]?)$/.test(label)||!Array.isArray(pairs)||pairs.length!==x.length)
    throw Error('Invalid '+label+' network trace.');
   for(const pair of pairs)if(!Array.isArray(pair)||pair.length!==2||!finite(pair[0])||!finite(pair[1])||!Number.isFinite(Math.hypot(...pair)))throw Error('Invalid complex sample in '+label+'.');
   if(magnitude.length>=limit)continue;
   magnitude.push(wave(label,x,pairs.map(([re,im])=>re||im?20*Math.log10(Math.hypot(re,im)):null),'dB'));
   phase.push(wave(label,x,pairs.map(([re,im])=>re||im?Math.atan2(im,re)*180/Math.PI:null),'°'));
  }
  if(magnitude.length<entries.length)result.warnings.push('Showing '+magnitude.length+' of '+entries.length+' traces within the browser plotting budget.');
  result.fields.push({path:'Samples',value:x.length},{path:'Saved network traces',value:entries.length});
  if(finite(reference)&&reference>0)result.fields.push({path:'Reference impedance (Ω)',value:reference});
  result.plots.push({title:'S-parameter magnitude (dB)',xLabel:'Frequency (Hz)',series:magnitude},
   {title:'S-parameter phase (degrees)',xLabel:'Frequency (Hz)',series:phase});
 }
 function touchstoneV1(path,text,result){
  const ports=Number(touchstone.exec(path)?.[1]),size=ports*ports*2+1;
  if(!ports||ports>32)throw Error('Touchstone viewer supports 1 to 32 ports.');
  const freq=[],traces=Object.create(null),names=[];
  for(let i=1;i<=ports;i++)for(let j=1;j<=ports;j++)names.push(key(ports===2?j:i,ports===2?i:j));
  for(const name of names)traces[name]=[];
  let options=null,row=[],tokens=0;
  const scales={HZ:1,KHZ:1e3,MHZ:1e6,GHZ:1e9};
  const numbers=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  for(const item of text.matchAll(/[^\r\n]+/g)){
   const line=item[0].split('!',1)[0].trim();
   if(!line)continue;
   if(line[0]==='[')throw Error('Use a Touchstone 1.x S-parameter export.');
   if(line[0]==='#'){
    if(options||tokens)throw Error('Unexpected Touchstone option line.');
    const m=line.toUpperCase().match(/^#\s*(HZ|KHZ|MHZ|GHZ)\s+S\s+(RI|MA|DB)\s+R\s+(\S+)$/);
    if(!m||!numbers.test(m[3])||!finite(Number(m[3]))||Number(m[3])<=0)throw Error('Expected frequency units, S RI/MA/DB and a positive common reference.');
    options={scale:scales[m[1]],format:m[2],reference:Number(m[3])};continue;
   }
   if(!options)throw Error('Missing Touchstone option line.');
   if(ports<=2&&line.split(/\s+/).length!==size)throw Error('Invalid Touchstone network row. Legacy noise blocks are unsupported.');
   for(const match of line.matchAll(/\S+/g)){
    const token=match[0],n=Number(token);
    if(++tokens>2000000||!numbers.test(token)||!finite(n))throw Error('Invalid or oversized Touchstone network data.');
    row.push(n);
    if(row.length!==size)continue;
    const frequency=row[0]*options.scale;
    if(!finite(frequency)||frequency<0||freq.length>=MAX_SAMPLES||freq.length&&frequency<=freq.at(-1))throw Error('Touchstone frequencies must increase. Legacy noise blocks are unsupported.');
    freq.push(frequency);
    for(let i=0;i<names.length;i++){
     const a=row[2*i+1],b=row[2*i+2];
     if(options.format==='RI')traces[names[i]].push([a,b]);
     else{
      const mag=options.format==='DB'?10**(a/20):a,angle=b*Math.PI/180;
      if(mag<0||!finite(mag)||!finite(angle))throw Error('Invalid Touchstone magnitude or phase.');
      traces[names[i]].push([mag*Math.cos(angle),mag*Math.sin(angle)]);
     }
    }
    row=[];
   }
  }
  if(row.length||!freq.length)throw Error('Incomplete or empty Touchstone network.');
  result.fields.push({path:'Ports',value:ports});
  network(result,freq,traces,options.reference);
 }
 function grid(result,title,xLabel,yLabel,x,y,values,unit){
  const xs=axis(x,xLabel,{increasing:true,max:2048}),ys=axis(y,yLabel,{increasing:true,max:2048});
  if(xs.length*ys.length>MAX_PLOT_POINTS||!Array.isArray(values)||values.length!==ys.length||
     values.some(row=>!Array.isArray(row)||row.length!==xs.length||row.some(v=>v!==null&&!finite(v))))throw Error('Invalid or oversized '+title+' grid.');
  result.plots.push({title,type:'heatmap',xLabel,yLabel,x:xs,y:ys,values,unit});
 }
 const degrees=value=>value*180/Math.PI;
 function parse(path,input){
  const report={kind:'Saved EMerge analysis',family:'emerge',familyLabel:FAMILY,path,title:String(path).split('/').at(-1),plots:[],tables:[],fields:[],warnings:[]};
  if(typeof input==='string'){
   if(input.length>MAX_BYTES||new TextEncoder().encode(input).length>MAX_BYTES)throw Error('EMerge export exceeds 64 MiB.');
   input=input.replace(/^\uFEFF/,'');
  }
  if(touchstone.test(path)){touchstoneV1(path,input,report);return report;}
  let raw=typeof input==='string'?JSON.parse(input):input;
  if(!recognizes(raw))throw Error('Choose a saved EMerge result rather than a simulation setup.');
  if(plugin(raw)){
   // Quick EMerge stores the result on the root. Some portable bundles wrap it.
   if(record(raw.result)&&!raw.frequencies_hz&&!raw.field&&!raw.radiation&&!raw.array_factor)raw=raw.result;
   report.kind='Quick EMerge saved analysis';
   if(typeof raw.model_scope==='string')report.fields.push({path:'Model scope',value:raw.model_scope.slice(0,240)});
   if(finite(raw.port_count))report.fields.push({path:'Ports',value:raw.port_count});
   if(record(raw.s_parameters)&&Object.keys(raw.s_parameters).length)network(report,raw.frequencies_hz,raw.s_parameters);
   if(raw.field){
    const f=raw.field;
    if(finite(f.frequency_hz))report.fields.push({path:'Field frequency (Hz)',value:f.frequency_hz});
    if(finite(f.z_mm))report.fields.push({path:'Field plane Z (mm)',value:f.z_mm});
    for(const [name,title,unit]of [['norm_e_v_m','Electric field magnitude','V/m'],['norm_h_a_m','Magnetic field magnitude','A/m']])
     if(f[name]!==undefined)grid(report,title,'X (mm)','Y (mm)',f.x_mm,f.y_mm,f[name],unit);
   }
   if(raw.radiation){
    const r=raw.radiation;
    if(finite(r.frequency_hz))report.fields.push({path:'Radiation frequency (Hz)',value:r.frequency_hz});
    const arrayFactor=r.model==='analytical-array-factor-not-full-wave';
    grid(report,arrayFactor?'Ideal array factor':'Far-field magnitude','Phi (degrees)','Theta (degrees)',
     axis(r.phi_rad,'phi',{max:2048}).map(degrees),axis(r.theta_rad,'theta',{max:2048}).map(degrees),r.norm_e,arrayFactor?'Normalized magnitude':'Saved |E|');
   }
   if(raw.array_factor){
    const factor=raw.array_factor,x=axis(factor.theta_deg,'scan angle');
    report.plots.push({title:'Ideal array-factor cut',xLabel:'Theta (degrees)',series:[wave('Normalized magnitude',x,factor.normalized_magnitude)]});
    if(finite(factor.target_theta_deg))report.fields.push({path:'Target theta (degrees)',value:factor.target_theta_deg});
    if(finite(factor.predicted_peak_theta_deg))report.fields.push({path:'Predicted peak theta (degrees)',value:factor.predicted_peak_theta_deg});
   }
  }else if(raw.kind==='sparams'){
   if(!record(raw.s))throw Error('Missing EMerge S-parameter traces.');
   network(report,raw.freq,raw.s);
  }else if(raw.kind==='farfield_cut'){
   const x=axis(raw.ang_deg,'angle');
   report.plots.push({title:'Far-field cut',xLabel:'Angle (degrees)',series:[wave('Saved |E|',x,raw.normE)]});
  }else if(raw.kind==='quasi_sweep'){
   if(!Array.isArray(raw.series)||!raw.series.length||raw.series.length>64)throw Error('Invalid EMerge sweep series.');
   let count=0;
   for(const series of raw.series){
    const name=typeof series?.label==='string'?series.label.slice(0,240):'Saved sweep';
    const x=axis(series?.x,'sweep');
    if((count+=x.length)>MAX_PLOT_POINTS)throw Error('EMerge sweep exceeds the plotting budget.');
    report.plots.push({title:name,xLabel:'Saved sweep coordinate',series:[wave(name,x,series.y)]});
   }
  }
  if(!report.plots.length)throw Error('No supported saved network, field plane, or radiation samples were found.');
  if(report.plots.some(p=>p.type==='heatmap'))report.warnings.push('Field grids use saved sample coordinates. PCB overlay placement requires separate source and coordinate binding.');
  return report;
 }
 const api={candidate,recognizes,parse};root.KiCadAnalysisEMerge=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
