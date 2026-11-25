/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
/* Saved workbook and waveform state. No stored command is ever executed. */
((root)=>{'use strict';
 const limits=Object.freeze({maxFiles:64,maxFileBytes:67108864,maxTotalBytes:134217728,maxWorkbookBytes:8388608,maxTabs:64,maxTraces:512,maxPlotPoints:200000});
 const palette=['#e41a1c','#377eb8','#4daf4a','#984ea3','#e69f00','#00a6a6'];
 const copy=value=>JSON.parse(JSON.stringify(value));
 const data=()=>{if(!root.KiCadAnalysisData)throw Error('Load the saved-analysis parser before the simulation workbook engine.');return root.KiCadAnalysisData;};
 const key=name=>String(name).replace(/^([VI])\(/,(_,f)=>f.toLowerCase()+'(');
 const kind=value=>/\bAC\b|frequency/i.test(value)?'AC':/\bTRAN\b|transient|\btime\b/i.test(value)?'TRAN':/\bDC\b|dc transfer|sweep/i.test(value)?'DC':'UNKNOWN';
 const safeColor=(value,fallback)=>typeof value==='string'&&/^(?:#[0-9a-f]{3,8}|rgba?\([\d., %]+\))$/i.test(value)?value:fallback;
 function readWorkbook(path,content){
  if(new TextEncoder().encode(content).length>limits.maxWorkbookBytes)throw Error('Workbook exceeds 8 MiB.');
  const document=data().parse(path,content).savedSource;
  if(!document||!Array.isArray(document.tabs)||document.tabs.length>limits.maxTabs)throw Error('Expected a KiCad workbook with at most 64 tabs.');
  const tabs=document.tabs.map((saved,index)=>{
   if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Invalid workbook tab.');
   const commands=Array.isArray(saved.commands)?saved.commands:typeof saved.command==='string'?[saved.command]:[];
   if(commands.length>256||commands.some(s=>typeof s!=='string'||s.length>32768))throw Error('Invalid workbook commands.');
   const analysis=kind(saved.analysis||commands.join(' ')),traces=saved.traces||[];
   if(!Array.isArray(traces)||traces.length>limits.maxTraces||traces.some(t=>!t||typeof t.signal!=='string'||t.signal.length>2048))throw Error('Invalid workbook signals.');
   return {id:'tab-'+index,title:typeof saved.title==='string'?saved.title.slice(0,160):analysis==='UNKNOWN'?'Plot '+(index+1):analysis+' '+(index+1),analysis,commands:[...commands],saved,sourceIndex:index,binding:null,selected:null,selectionEdited:false,cursorsEdited:false,cursorsRestored:false,xScale:analysis==='AC'?'log':'linear',yScale:'linear',view:'auto',showGrid:saved.showGrid!==false,sweepIndex:-1,range:null,cursors:{A:null,B:null}};
  });
  return {path,content,document,tabs,legacy:!content.trimStart().replace(/^\uFEFF/,'').startsWith('{'),warnings:Number(document.version)>8?['Newer workbook version; unknown settings are retained.']:[]};
 }
 function normalizeFiles(files){
  if(!Array.isArray(files)||files.length>limits.maxFiles)throw Error('Supply at most 64 simulation files.');
  let total=0;const seen=new Set();return files.map(file=>{
   if(!file||typeof file.path!=='string'||!file.path||file.path.length>2048||/[\x00-\x1f\x7f]/.test(file.path)||! /\.(wbk|raw|csv|tsv)$/i.test(file.path)||typeof file.content!=='string')throw Error('Supply named .wbk, ASCII .raw or CSV/TSV text files.');
   if(seen.has(file.path))throw Error('Duplicate simulation file path: '+file.path);seen.add(file.path);
   const size=new TextEncoder().encode(file.content).length;if(size>limits.maxFileBytes||(total+=size)>limits.maxTotalBytes)throw Error('Simulation input exceeds the 64 MiB file / 128 MiB total budget.');
   return {path:file.path,content:file.content};
  });
 }
 function vectors(plot){
  const found=new Map();for(const series of plot.series||[]){
   const expression=series.signal?.expression||series.name,identity=key(expression);let v=found.get(identity);
   if(!v){v={expression,signal:{...series.signal,expression},real:null,imaginary:null};found.set(identity,v);}
   const component=series.signal?.component==='imaginary'?'imaginary':'real';
   if(v[component])throw Error('Ambiguous repeated waveform signal: '+expression);v[component]=series.points;
  }
  return [...found.values()].filter(v=>v.real||v.imaginary);
 }
 function traceValue(trace,index){
  const real=trace.real?.[index]?.y,imag=trace.imaginary?.[index]?.y;
  if(!Number.isFinite(real)||trace.imaginary&&!Number.isFinite(imag))return NaN;
  if(trace.mode==='imaginary')return imag??0;
  if(trace.mode==='real')return real;
  const magnitude=Math.hypot(real,imag||0);
  return trace.mode==='phase'?Math.atan2(imag||0,real)*180/Math.PI:trace.mode==='db'?magnitude>0?20*Math.log10(magnitude):NaN:magnitude;
 }
 function makeTraces(plot,tab){
  const all=vectors(plot),saved=tab.saved?.traces||[],traces=[];
  for(const [i,v]of all.entries()){
   const configs=saved.filter(t=>key(t.signal)===key(v.expression)),nativePhase=configs.some(t=>(t.trace_type&8)!==0),complex=Boolean(v.imaginary);
   const modes=tab.view==='real'?complex?['real','imaginary']:['real']:tab.view==='magnitude'?complex?['magnitude','phase']:['real']:tab.view==='db'?complex?['db','phase']:['db']:complex?(tab.analysis==='AC'||nativePhase?['db','phase']:['real','imaginary']):['real'];
   for(const mode of modes){
    const phase=mode==='phase',config=configs.find(t=>phase?(t.trace_type&8)!==0:(t.trace_type&8)===0)||configs[0],unit=phase?'°':mode==='db'?'dB re 1 '+(v.signal.unit||'unit'):v.signal.unit||'';
    traces.push({...v,id:key(v.expression)+'::'+mode,name:v.expression+(mode==='real'&&!complex?'':' · '+({db:'gain',phase:'phase',magnitude:'magnitude',real:'real',imaginary:'imaginary'})[mode]),mode,unit,axis:phase?'right':'left',color:safeColor(config?.color,palette[i%palette.length]),length:v.real?.length||0,saved:Boolean(configs.length&&(complex?phase?configs.some(t=>(t.trace_type&8)!==0):configs.some(t=>(t.trace_type&8)===0):true))});
   }
  }
  return traces;
 }
 function createSession(input,options={}){
  const files=normalizeFiles(input),workbooks=files.filter(f=>/\.wbk$/i.test(f.path));if(workbooks.length>1)throw Error('Open one workbook at a time.');
  const workbook=workbooks.length?readWorkbook(workbooks[0].path,workbooks[0].content):null,results=files.filter(f=>! /\.wbk$/i.test(f.path)),byPath=new Map(results.map(f=>[f.path,f])),cache=new Map();
  const warnings=[...(workbook?.warnings||[])],availableResults=[];let tabs=workbook?.tabs||[],activeTabId=tabs[0]?.id||null;
  let inputBytes;
  function addResult(file){
   if(!workbook||files.length>=limits.maxFiles)throw Error('Simulation file limit reached.');
   const [entry]=normalizeFiles([file]);if(/\.wbk$/i.test(entry.path)||byPath.has(entry.path))throw Error('Choose a new waveform result.');
   const encoder=new TextEncoder();inputBytes??=files.reduce((total,item)=>total+encoder.encode(item.content).length,0);
   const size=encoder.encode(entry.content).length;if(inputBytes+size>limits.maxTotalBytes)throw Error('Simulation input exceeds the total byte budget.');
   const parsed=data().parse(entry.path,entry.content);
   if(!parsed.plots.length||parsed.plots.some(plot=>plot.type))throw Error('This file has no supported circuit waveforms.');
   for(const [plotIndex,plot]of parsed.plots.entries())availableResults.push({path:entry.path,plotIndex,title:plot.title,analysis:kind(plot.xLabel+' '+plot.title)});
   files.push(entry);results.push(entry);byPath.set(entry.path,entry);inputBytes+=size;
   cache.set(entry.path,parsed);if(cache.size>2)cache.delete(cache.keys().next().value);
  }
  function report(path){if(cache.has(path)){const r=cache.get(path);cache.delete(path);cache.set(path,r);return r;}const f=byPath.get(path);if(!f)throw Error('Saved result is not loaded: '+path);const r=data().parse(path,f.content);if(!r.plots.length||r.plots.some(p=>p.type))throw Error('This file has no supported circuit waveforms.');cache.set(path,r);if(cache.size>2)cache.delete(cache.keys().next().value);return r;}
  // Preflight every result. Retain at most two parsed datasets, not all plot copies.
  for(const f of results){const r=report(f.path);for(const [plotIndex,p]of r.plots.entries())availableResults.push({path:f.path,plotIndex,title:p.title,analysis:kind(p.xLabel+' '+p.title)});if(!workbook)for(const [index,p]of r.plots.entries()){if(tabs.length>=limits.maxTabs)throw Error('Too many simulation plots.');tabs.push({id:'tab-'+tabs.length,title:p.title||f.path,analysis:kind(p.xLabel+' '+p.title),commands:[],saved:{traces:[]},binding:{path:f.path,plotIndex:index},selected:null,selectionEdited:false,cursorsEdited:false,cursorsRestored:false,xScale:kind(p.xLabel)==='AC'?'log':'linear',yScale:'linear',view:'auto',showGrid:true,sweepIndex:-1,range:null,cursors:{A:null,B:null}});}}
  activeTabId??=tabs[0]?.id||null;
  const getTab=id=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw Error('Unknown workbook tab.');return tab;};
  function plotFor(tab){return tab.binding?report(tab.binding.path).plots[tab.binding.plotIndex]:null;}
  function tracesFor(tab){const plot=plotFor(tab);return plot?makeTraces(plot,tab):[];}
  function initialize(tab){const traces=tracesFor(tab);if(tab.selected===null)tab.selected=traces.filter(t=>workbook?t.saved:true).slice(0,32).map(t=>t.id);
   if(tab.binding&&!tab.cursorsRestored){tab.cursorsRestored=true;tab.cursorOrigins={};for(const [name,field]of [['A','cursor1'],['B','cursor2']]){let restored=0;for(const saved of tab.saved.traces||[]){const position=saved[field]?.position;if(!Number.isFinite(position))continue;const trace=traces.find(t=>key(t.expression)===key(saved.signal)&&((saved.trace_type&8)!==0)===(t.mode==='phase'));if(!trace)continue;if(restored++)continue;tab.cursorOrigins[name]={index:tab.saved.traces.indexOf(saved),record:copy(saved[field])};const bounds=segments(trace).flatMap(r=>[trace.real[r.start]?.x,trace.real[r.end-1]?.x]).filter(Number.isFinite);const outside=position<Math.min(...bounds)||position>Math.max(...bounds);tab.cursors[name]=outside?{traceId:trace.id,x:position,y:null,index:null,unit:trace.unit}:sample(trace,position);if(outside)warnings.push(tab.title+': saved cursor '+name+' is outside this result; no sampled value is shown.');}if(restored>1)warnings.push(tab.title+': displaying the first saved cursor '+name+'; other trace cursor records are retained.');}tab.cursorBaseline=copy(tab.cursors);}
   return traces;}
  function bindResult(id,path,plotIndex=0){const tab=getTab(id),r=report(path),plot=r.plots[plotIndex];if(!Number.isInteger(plotIndex)||!plot)throw Error('Unknown result plot.');const actual=kind(plot.xLabel+' '+plot.title);if(tab.analysis!=='UNKNOWN'&&actual!=='UNKNOWN'&&tab.analysis!==actual)throw Error('Result analysis does not match this workbook tab.');const proposed={...tab,binding:{path,plotIndex},selected:null};const traces=tracesFor(proposed);tab.binding=proposed.binding;tab.selected=traces.filter(t=>workbook?t.saved:true).slice(0,32).map(t=>t.id);tab.range=null;tab.cursors={A:null,B:null};tab.cursorsRestored=false;tab.cursorsEdited=false;initialize(tab);return getState();}
  if(options.bindings!==undefined){if(!options.bindings||typeof options.bindings!=='object'||Array.isArray(options.bindings))throw Error('Invalid workbook result bindings.');for(const [id,binding]of Object.entries(options.bindings)){if(!binding||typeof binding.path!=='string')throw Error('Invalid result binding.');bindResult(id,binding.path,binding.plotIndex??0);}}
  function active(){const tab=tabs.find(t=>t.id===activeTabId)||null;if(!tab)return {tab:null,plot:null,traces:[]};return {tab,plot:plotFor(tab),traces:initialize(tab)};}
  function selectTab(id){getTab(id);activeTabId=id;active();return getState();}
  function getState(){return {activeTabId,tabs:tabs.map(t=>({id:t.id,title:t.title,analysis:t.analysis,binding:t.binding?{...t.binding}:null,selected:[...(t.selected||[])],xScale:t.xScale,yScale:t.yScale,view:t.view,showGrid:t.showGrid,sweepIndex:t.sweepIndex,range:t.range?{...t.range}:null})),cursors:copy(tabs.find(t=>t.id===activeTabId)?.cursors||{A:null,B:null}),warnings:[...warnings]};}
  function exportWorkbook(){if(!workbook)throw Error('No workbook is loaded.');if(workbook.legacy)return {path:workbook.path,content:workbook.content,warnings:['Legacy workbook exported unchanged; plot presentation edits are not written to this format.']};
   if(!tabs.some(t=>t.selectionEdited||t.cursorsEdited||t.showGrid!==t.saved.showGrid&&!(t.saved.showGrid===undefined&&t.showGrid)))return {path:workbook.path,content:workbook.content,warnings:[]};
   const exportWarnings=[];const document=copy(workbook.document);for(const tab of tabs){const saved=document.tabs[tab.sourceIndex];saved.showGrid=tab.showGrid;if(!tab.binding)continue;
    if(tab.analysis==='AC'&&tab.view!=='auto'&&tab.view!=='db'){exportWarnings.push(tab.title+': non-native complex presentation is view-only; original native trace settings retained.');continue;}
    const traces=tracesFor(tab),selected=new Set(tab.selected||[]),retained=new Set();
    if(tab.selectionEdited){saved.traces=(saved.traces||[]).filter(original=>{const trace=traces.find(t=>key(t.expression)===key(original.signal)&&((original.trace_type&8)!==0)===(t.mode==='phase'));if(!trace)return true;retained.add(trace.id);return selected.has(trace.id);});
     for(const t of traces)if(selected.has(t.id)&&!retained.has(t.id))saved.traces.push({signal:t.expression,color:t.color,trace_type:(tab.analysis==='AC'?512:tab.analysis==='DC'?1024:256)|(t.signal.quantity==='current'?2:1)|(t.mode==='phase'?8:tab.analysis==='AC'?4:0)});
    }
    if(tab.cursorsEdited)for(const [name,field]of [['A','cursor1'],['B','cursor2']]){const cursor=tab.cursors[name],baseline=tab.cursorBaseline?.[name]||null;if(JSON.stringify(cursor)===JSON.stringify(baseline))continue;
     const origin=tab.cursorOrigins?.[name],source=origin?tab.saved.traces[origin.index]:null;
     if(source){const original=saved.traces.find(t=>key(t.signal)===key(source.signal)&&t.trace_type===source.trace_type);if(original)delete original[field];}
     const trace=traces.find(t=>t.id===cursor?.traceId);if(!trace)continue;
     const target=saved.traces.find(t=>key(t.signal)===key(trace.expression)&&((t.trace_type&8)!==0)===(trace.mode==='phase'));
     if(target){const record=copy(origin?.record||{});if(baseline&&baseline.unit!==cursor.unit)delete record.y_format;target[field]={...record,position:cursor.x};}
     else exportWarnings.push(tab.title+': cursor '+name+' belongs to an unselected trace and was not written.');
    }
   }
   return {path:workbook.path,content:JSON.stringify(document,null,2)+'\n',warnings:exportWarnings};
  }

  active();return {files,workbook,results,availableResults,warnings,tabs,active,selectTab,bindResult,addResult,getState,exportWorkbook,dispose(){cache.clear();files.length=0;results.length=0;byPath.clear();tabs.length=0;activeTabId=null;}};
 }
 const segmentCache=new WeakMap();
 function segments(trace){
  const points=trace.real||[];if(segmentCache.has(points))return segmentCache.get(points);let direction=0;for(let i=1;i<points.length&&!direction;i++)if(Number.isFinite(points[i].x)&&Number.isFinite(points[i-1].x))direction=Math.sign(points[i].x-points[i-1].x);
  const output=[];let start=0;for(let i=1;i<=points.length;i++)if(i===points.length||direction&&Math.sign(points[i].x-points[i-1].x)===-direction){output.push({start,end:i,direction:direction||1});start=i;}segmentCache.set(points,output);return output;
 }
 function sample(trace,x,sweepIndex=-1){
  if(!Number.isFinite(x))return null;let best=-1,distance=Infinity;
  for(const [sweep,range]of segments(trace).entries()){if(sweepIndex>=0&&sweep!==sweepIndex)continue;let lo=range.start,hi=range.end;while(lo<hi){const mid=(lo+hi)>>1;if(trace.real[mid].x*range.direction<x*range.direction)lo=mid+1;else hi=mid;}
   for(let i of [lo-1,lo])if(i>=range.start&&i<range.end){while(i>range.start&&trace.real[i-1].x===trace.real[i].x)i--;const d=Math.abs(trace.real[i].x-x);if(d<distance||d===distance&&i<best){distance=d;best=i;}}
  }
  if(best<0)return null;const y=traceValue(trace,best);return {traceId:trace.id,x:trace.real[best].x,y:Number.isFinite(y)?y:null,index:best,unit:trace.unit};
 }
 function reduced(trace,{maxPoints=4000,xMin=-Infinity,xMax=Infinity,sweepIndex=-1}={}){
  maxPoints=Math.max(8,Math.min(16000,Math.floor(maxPoints)));const runs=[];let current=null;
  const finish=()=>{if(current){current.indices=[...new Set([current.start,current.min,current.max,current.end-1])].sort((a,b)=>a-b);current.cost=current.indices.length;runs.push(current);current=null;}};
  for(const [sweep,range]of segments(trace).entries()){if(sweepIndex>=0&&sweep!==sweepIndex)continue;for(let i=range.start;i<range.end;i++){const p=trace.real[i],y=traceValue(trace,i);if(!Number.isFinite(p.x)||!Number.isFinite(y)||p.x<xMin||p.x>xMax){finish();continue;}if(!current)current={start:i,end:i+1,min:i,max:i,low:y,high:y};current.end=i+1;if(y<current.low){current.low=y;current.min=i;}if(y>current.high){current.high=y;current.max=i;}}finish();}
  if(!runs.length)return [];if(runs.reduce((n,r)=>n+r.end-r.start,0)+runs.length-1<=maxPoints){const exact=[];for(const [runIndex,r]of runs.entries()){if(runIndex)exact.push(null);for(let i=r.start;i<r.end;i++)exact.push({x:trace.real[i].x,y:traceValue(trace,i),index:i});}return exact;}const low=runs.reduce((a,r,i)=>r.low<runs[a].low?i:a,0),high=runs.reduce((a,r,i)=>r.high>runs[a].high?i:a,0),priority=[...new Set([0,runs.length-1,high,low])];
  const chosen=[];let used=0;const add=i=>{if(chosen.includes(i))return;const cost=runs[i].cost+(chosen.length?1:0);if(used+cost<=maxPoints){chosen.push(i);used+=cost;}};
  for(const i of priority)add(i);const desired=Math.max(1,Math.floor((maxPoints+1)/3));for(let n=1;n<desired;n++)add(Math.round(n*(runs.length-1)/desired));chosen.sort((a,b)=>a-b);
  const extra=maxPoints-used,output=[];for(const [index,r]of chosen.map(i=>runs[i]).entries()){
   if(index)output.push(null);const budget=Math.min(r.end-r.start,r.cost+Math.floor(extra/chosen.length)+(index<extra%chosen.length?1:0));let indices;
   if(r.end-r.start<=budget)indices=Array.from({length:r.end-r.start},(_,i)=>r.start+i);
   else{const selected=new Set(r.indices),buckets=Math.max(1,Math.floor((budget-selected.size)/2));for(let b=0;b<buckets;b++){let min=-1,max=-1,low=Infinity,high=-Infinity;const from=r.start+Math.floor(b*(r.end-r.start)/buckets),to=r.start+Math.floor((b+1)*(r.end-r.start)/buckets);for(let i=from;i<to;i++){const y=traceValue(trace,i);if(y<low){low=y;min=i;}if(y>high){high=y;max=i;}}for(const i of [min,max])if(i>=0&&selected.size<budget)selected.add(i);}indices=[...selected].sort((a,b)=>a-b);}
   for(const i of indices)output.push({x:trace.real[i].x,y:traceValue(trace,i),index:i});
  }
  return output;
 }

 const API={limits,palette,readWorkbook,createSession,traceValue,sample,reduced,segments,key,kind,safeColor};root.KiCadSimulationWorkbook=API;if(typeof module==='object'&&module.exports)module.exports=API;
})(typeof globalThis==='object'?globalThis:this);
