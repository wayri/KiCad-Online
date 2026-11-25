/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
/* Native-style saved simulation plots. Stored simulator commands remain inert. */
((root)=>{'use strict';const owners=new WeakMap();
 const CSS=`
.kivi-sim{--sim-bg:#fff;--sim-ink:#263548;--sim-line:#d6dee8;--sim-panel:#f3f6fa;--sim-accent:#1769ba;--sim-active:#e0edf9;--sim-muted:#596c80;color:var(--sim-ink);background:var(--sim-bg);font:13px system-ui,sans-serif;display:flex;flex-direction:column;min-width:0;border:1px solid var(--sim-line);border-radius:10px;overflow:hidden}
.kivi-sim[data-theme=dark]{--sim-bg:#151c25;--sim-ink:#e3eaf4;--sim-line:#344254;--sim-panel:#1c2633;--sim-accent:#8ecaff;--sim-active:#233b53;--sim-muted:#a5b6c8}
.kivi-sim *{box-sizing:border-box}
.kivi-sim button,.kivi-sim select,.kivi-sim input{font:inherit;color:inherit;background:var(--sim-bg);border:1px solid var(--sim-line);border-radius:5px;min-width:0;min-height:30px;padding:3px 8px}
.kivi-sim button{cursor:pointer;white-space:nowrap}
.kivi-sim button:focus-visible,.kivi-sim canvas:focus-visible{outline:2px solid var(--sim-accent);outline-offset:-2px}
.kivi-sim button[aria-pressed=true],.kivi-sim [role=tab][aria-selected=true]{background:var(--sim-active);color:var(--sim-accent);border-color:var(--sim-accent)}
.kivi-sim button:disabled{opacity:.46;cursor:default}
.kivi-sim [hidden]{display:none!important}
.sim-toolbar,.sim-tabs{display:flex;gap:6px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--sim-line);min-width:0}
.sim-toolbar{flex-wrap:wrap;background:var(--sim-panel)}
.sim-group{display:flex;gap:3px;align-items:center;flex-wrap:wrap}
.sim-group+.sim-group{border-inline-start:1px solid var(--sim-line);padding-inline-start:6px}
.sim-group button{min-width:30px}
.sim-save{margin-inline-start:auto}
.sim-tabs{overflow:auto;padding-block:5px}
.sim-tabs button{border-color:transparent;background:transparent;flex:none}
.sim-body{display:grid;grid-template-columns:minmax(175px,218px) minmax(0,1fr);min-width:0}
.sim-sidebar{padding:10px;background:var(--sim-panel);border-inline-end:1px solid var(--sim-line);min-width:0}
.sim-sidebar label{display:grid;gap:4px;margin:0 0 8px;min-width:0}
.sim-sidebar select,.sim-sidebar input[type=search]{width:100%}
.sim-sidebar h3{margin:12px 0 6px;font-size:12px;font-weight:650}
.sim-search{margin-bottom:6px}
.sim-signals{display:grid;gap:3px;max-height:clamp(125px,35vh,420px);overflow:auto}
.sim-signal{display:flex;align-items:center;gap:5px;border-inline-start:3px solid var(--trace-color);min-width:0;padding-inline-start:5px}
.sim-signal input{min-height:18px;margin:0;flex:none}
.sim-signal button{flex:1;min-height:26px;border-color:transparent;background:transparent;overflow-wrap:anywhere;white-space:normal;text-align:left;padding:2px 5px}
.sim-settings,.sim-help{font-size:12px;margin:0;padding:8px 10px;background:var(--sim-panel)}
.sim-settings{padding-inline:0}
.sim-settings[open]>summary{margin-bottom:8px}
.sim-help{border-top:1px solid var(--sim-line);max-height:190px;overflow:auto}
.sim-help pre,.sim-help p{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}
.sim-plot-pane{min-width:0}.sim-stage{min-width:0;position:relative;min-height:0}
.sim-stage canvas{width:100%;height:clamp(310px,61vh,900px);display:block;touch-action:none}
.sim-stage .sim-inspection{position:absolute;inset:0;pointer-events:none}
.sim-plot-row+.sim-plot-row{border-top:1px solid var(--sim-line)}
.sim-plot-row[data-drop=true]{outline:2px solid var(--sim-accent);outline-offset:-2px}
.sim-plot-row:focus-within .sim-row-title{color:var(--sim-accent)}
.sim-row-bar{display:flex;align-items:center;gap:5px 9px;flex-wrap:wrap;padding:5px 9px;min-height:40px;background:var(--sim-panel);border-bottom:1px solid var(--sim-line)}
.sim-row-title{font-size:12px;font-weight:650}
.sim-row-actions{display:flex;gap:4px;margin-inline-start:auto}
.sim-row-actions button{min-width:30px}
.sim-legend{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0}
.sim-legend button{cursor:grab;display:inline-flex;gap:6px;align-items:center;min-height:26px;font-size:12px;overflow-wrap:anywhere;white-space:normal;text-align:left}
.sim-legend-swatch{width:11px;height:3px;flex:none;background:var(--trace-color)}
.sim-legend-swatch[data-phase=true]{background:repeating-linear-gradient(90deg,var(--trace-color) 0 4px,transparent 4px 6px)}
.sim-signal button[draggable=true]{cursor:grab}
.sim-plot-pane[data-stacked=true] .sim-stage canvas{height:clamp(220px,38vh,520px)}
.sim-readouts{display:flex;gap:5px 12px;align-items:baseline;flex-wrap:wrap;min-height:37px;border-top:1px solid var(--sim-line);padding:7px 10px;font:12px ui-monospace,monospace;overflow-wrap:anywhere}
.sim-measurements{display:flex;gap:6px 10px;flex-wrap:wrap}
.sim-readout{border-inline-start:3px solid var(--sim-line);padding-inline:7px}
.sim-readout[data-cursor=A]{border-color:#19a5ac}
.sim-readout[data-cursor=B]{border-color:#d98618}
.sim-hover{color:var(--sim-muted)}
.sim-status{font-size:12px;padding:6px 10px;overflow-wrap:anywhere}
.sim-status:empty{display:none}
.sim-hint{position:absolute;inset:0;display:grid;place-content:center;padding:20px;text-align:center;pointer-events:none;color:var(--sim-muted)}
.sim-file-label{position:relative;overflow:hidden}
.sim-file-label input{position:absolute;inset:0;width:100%;opacity:0;cursor:pointer}
.sim-measure{color:var(--sim-accent)}
@media(max-width:760px){.sim-body{grid-template-columns:1fr}.sim-plot-pane{grid-row:1}.sim-stage canvas{height:clamp(280px,48vh,500px)}.sim-sidebar{border-inline-end:0;border-top:1px solid var(--sim-line)}.sim-signals{max-height:120px}.sim-toolbar,.sim-tabs{padding-inline:6px}.sim-readouts{font-size:11px}}
`;
 const format=n=>n===null||!Number.isFinite(n)?'—':Math.abs(n)>=1e5||Math.abs(n)>0&&Math.abs(n)<.001?n.toExponential(6):Number(n.toPrecision(9)).toString();
 const axisFormat=n=>{if(!Number.isFinite(n))return '—';const units=[[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n'],[1e-12,'p']];if(n===0)return '0';for(const [scale,suffix]of units)if(Math.abs(n)>=scale)return Number((n/scale).toPrecision(4))+suffix;return n.toExponential(2);};
 function mount(container,options={}){
  if(!container?.ownerDocument||owners.has(container))throw Error('Choose an unowned simulation host.');const core=root.KiCadSimulationWorkbook;if(!core)throw Error('Simulation workbook engine is not loaded.');
  let plotCache=new WeakMap(),baseDirty=false,measurementKey='',probeId='';
  const layouts=new Map(),plotRows=[];
  const maxRows=6,dragType='application/x-kicad-simulation-trace';
  let activeRow=0,draggedTrace=null;
  let session=core.createSession(options.files||[],{bindings:options.bindings}),disposed=false,generation=0,theme=options.theme==='dark'?'dark':'light',mode='pan',drag=null,frame=0,map=null,hover=null;
  const doc=container.ownerDocument,win=doc.defaultView||root,make=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;},element=make('section'),style=make('style',CSS);element.className='kivi-sim';element.dataset.theme=theme;element.setAttribute('aria-label','KiCad simulation workspace');element.append(style);
  let storage=null,storageKey='',restorePending=new Set(),explicitBindings={};
  try{if(options.persistenceKey!==false)storage=win.localStorage;}catch{}
  function configurePersistence(settings={}){
   const book=session.workbook;storageKey='';restorePending=new Set();explicitBindings=settings.bindings||{};
   if(!storage||!book)return;
   let fingerprint=2166136261;
   for(let i=0;i<book.content.length;i++)fingerprint=Math.imul(fingerprint^book.content.charCodeAt(i),16777619);
   storageKey='kicad:simulation:v1:'+JSON.stringify([options.persistenceKey||'',book.path,book.content.length,fingerprint>>>0]);
   restorePending=new Set(session.tabs.map(tab=>tab.id));
   const last=readSaved('active');
   if(session.tabs.some(tab=>tab.id===last))session.selectTab(last);
  }
  function readSaved(suffix){
   if(!storageKey)return null;
   try{const value=storage.getItem(storageKey+':'+suffix);return value&&value.length<100000?JSON.parse(value):null;}catch{return null;}
  }
  function writeSaved(suffix,value){
   if(!storageKey)return;
   try{storage.setItem(storageKey+':'+suffix,JSON.stringify(value));}catch{}
  }
  function remember(tab){
   if(!storageKey||!tab?.binding||restorePending.has(tab.id))return;
   const layout=layoutFor(tab);
   writeSaved(tab.id,{binding:tab.binding,rows:layout.rows.length,selected:tab.selected,
    assignments:tab.selected.map(id=>[id,layout.rows.indexOf(rowFor(layout,id))]),
    cursors:tab.cursors,view:tab.view,sweepIndex:tab.sweepIndex,xScale:tab.xScale,yScale:tab.yScale});
  }
  function restorePresentation(tab,saved){
   if(['auto','db','magnitude','real'].includes(saved.view))tab.view=saved.view;
   for(const key of ['xScale','yScale'])if(['linear','log'].includes(saved[key]))tab[key]=saved[key];
   const {traces}=session.active(),byId=new Map(traces.map(trace=>[trace.id,trace]));
   if(Array.isArray(saved.selected)){
    const selected=[...new Set(saved.selected.filter(id=>byId.has(id)))].slice(0,32);
    tab.selectionEdited=JSON.stringify(selected)!==JSON.stringify(tab.selected);tab.selected=selected;
   }
   const sweeps=traces[0]?core.segments(traces[0]).length:0;
   if(Number.isInteger(saved.sweepIndex)&&saved.sweepIndex>=-1&&saved.sweepIndex<sweeps)tab.sweepIndex=saved.sweepIndex;
   const layout=layoutFor(tab),count=Number.isInteger(saved.rows)?Math.max(1,Math.min(maxRows,saved.rows)):1;
   layout.rows=Array.from({length:count},()=>({range:null}));layout.assignments.clear();
   for(const item of Array.isArray(saved.assignments)?saved.assignments.slice(0,32):[]){
    if(Array.isArray(item)&&byId.has(item[0])&&Number.isInteger(item[1])&&layout.rows[item[1]])layout.assignments.set(item[0],layout.rows[item[1]]);
   }
   for(const name of ['A','B']){
    const value=saved.cursors?.[name];
    if(value===null){tab.cursors[name]=null;continue;}
    const trace=byId.get(value?.traceId);
    if(!trace||!Number.isFinite(value.x))continue;
    const bounds=tab.sweepIndex>=0?core.segments(trace)[tab.sweepIndex]:{start:0,end:trace.length};
    if(bounds&&Number.isInteger(value.index)&&value.index>=bounds.start&&value.index<bounds.end&&trace.real[value.index]?.x===value.x){
     const y=core.traceValue(trace,value.index);
     tab.cursors[name]={traceId:trace.id,x:value.x,y:Number.isFinite(y)?y:null,index:value.index,unit:trace.unit};
    }else{
     const sample=core.sample(trace,value.x,tab.sweepIndex);
     tab.cursors[name]=sample?.x===value.x?sample:{traceId:trace.id,x:value.x,y:null,index:null,unit:trace.unit};
    }
   }
   tab.cursorsEdited=JSON.stringify(tab.cursors)!==JSON.stringify(tab.cursorBaseline);
  }
  async function restoreActive(){
   const {tab}=session.active();
   if(!tab||!restorePending.has(tab.id))return;
   const saved=readSaved(tab.id),binding=saved?.binding;
   if(typeof binding?.path!=='string'||!Number.isInteger(binding.plotIndex)||binding.plotIndex<0){restorePending.delete(tab.id);return;}
   const supplied=explicitBindings[tab.id];
   if(supplied&&(supplied.path!==binding.path||(supplied.plotIndex??0)!==binding.plotIndex)){restorePending.delete(tab.id);return;}
   const token=generation;
   try{
    if(!session.files.some(file=>file.path===binding.path)){
     if(typeof options.readResult!=='function'||!options.resultSources?.some(file=>file.path===binding.path))throw Error('Saved waveform unavailable. Open its result file to restore this tab.');
     status.textContent='Restoring saved waveform…';
     const content=await options.readResult(binding.path);
     if(disposed||token!==generation)return;
     session.addResult({path:binding.path,content});
    }
    if(!tab.binding||tab.binding.path!==binding.path||tab.binding.plotIndex!==binding.plotIndex)session.bindResult(tab.id,binding.path,binding.plotIndex);
    restorePresentation(tab,saved);restorePending.delete(tab.id);refresh();
   }catch(error){if(!disposed&&token===generation)status.textContent=error.message;}
  }
  const toolbar=make('div'),tabs=make('div'),body=make('div'),side=make('aside'),plotPane=make('div'),rowsHost=make('div'),readouts=make('div'),status=make('div'),help=make('details'),helpSummary=make('summary','Plot help'),helpText=make('p','Drag to pan. Shift-drag or Z zooms to a box. Wheel zooms around the pointer. Press A or B to choose a cursor, then click the plot. Arrow keys step the active cursor through saved samples. Home fits the plot.'),commands=make('pre');
  toolbar.className='sim-toolbar';tabs.className='sim-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Workbook plots');body.className='sim-body';side.className='sim-sidebar';plotPane.className='sim-plot-pane';readouts.className='sim-readouts';status.className='sim-status';status.setAttribute('role','status');help.className='sim-help';help.append(helpSummary,helpText,commands);plotPane.append(rowsHost,readouts);body.append(side,plotPane);element.append(toolbar,tabs,body,status,help);
  const group=label=>{const box=make('div');box.className='sim-group';box.setAttribute('role','group');box.setAttribute('aria-label',label);toolbar.append(box);return box;};
 let controls=group('Plot navigation');
 const button=(text,label,action)=>{const b=make('button',text);b.type='button';b.setAttribute('aria-label',label||text);b.title=label||text;b.onclick=action;controls.append(b);return b;};
  const fit=button('Fit','Fit plot',()=>{fitRows();});button('−','Zoom out',()=>zoom(1.5));button('+','Zoom in',()=>zoom(1/1.5));
  const modeButtons={};
  for(const [value,label,text]of [['pan','Pan','Pan'],['zoom','Zoom area','Zoom box'],['A','Cursor A','A'],['B','Cursor B','B']]){
   if(value==='A')controls=group('Plot cursors');
   modeButtons[value]=button(text,label,()=>setMode(mode===value?'pan':value));
  }
  const clear=button('Clear','Clear cursors',()=>{const {tab}=session.active();if(tab){tab.cursors={A:null,B:null};tab.cursorsEdited=true;remember(tab);}hover=null;drawInspection();});controls=group('Plot display');const addRowButton=button('+ Plot row','Add plot row',()=>addRow());const grid=button('Grid','Toggle plot grid',()=>{const {tab}=session.active();if(tab)tab.showGrid=!tab.showGrid;draw();});
  controls=toolbar;
  const save=button('Save','Save workbook',()=>{try{const exported=session.exportWorkbook();status.textContent=exported.warnings.join(' ');if(options.onSave)options.onSave(exported);else{const url=URL.createObjectURL(new Blob([exported.content],{type:'application/json'})),a=make('a');a.href=url;a.download=exported.path.split(/[\\/]/).at(-1);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(error){status.textContent=error.message;}});
  save.className='sim-save';
  const fileLabel=make('label','Open files'),fileInput=make('input');fileLabel.className='sim-file-label';fileInput.type='file';fileInput.accept='.wbk,.raw,.csv,.tsv';fileInput.multiple=true;fileInput.setAttribute('aria-label','Open workbook and simulation results');fileLabel.append(fileInput);toolbar.append(fileLabel);fileLabel.hidden=options.allowLocalFiles===false;
  let fieldHost=side;
  const control=(name,values)=>{const label=make('label',name),select=make('select');select.setAttribute('aria-label',name);for(const [value,text]of values){const o=make('option',text);o.value=value;select.append(o);}label.append(select);fieldHost.append(label);return select;};
  const result=control('Saved result',[['','Choose result…']]);
  const settings=make('details');settings.className='sim-settings';settings.append(make('summary','Axes and display'));
  fieldHost=settings;
  const view=control('Complex view',[['auto','Workbook / automatic'],['db','Gain (dB) + phase'],['magnitude','Magnitude + phase'],['real','Real + imaginary']]),xScale=control('X axis',[['linear','Linear'],['log','Logarithmic']]),yScale=control('Y axis',[['linear','Linear'],['log','Logarithmic']]),sweep=control('Sweep',[['-1','All saved sweeps']]);
  side.append(settings);
  const traceSection=make('section');traceSection.className='sim-trace-tools';side.append(traceSection);fieldHost=traceSection;
  traceSection.append(make('h3','Traces'));
  const find=make('input'),signalList=make('div');find.type='search';find.placeholder='Find signal';find.setAttribute('aria-label','Find signal');find.className='sim-search';traceSection.append(find);signalList.className='sim-signals';traceSection.append(signalList);
  controls=group('Schematic probe');
  const locate=button(options.selectionLabel||'Select signal',options.selectionLabel||'Select signal',()=>{const {traces}=session.active(),trace=traces.find(t=>t.id===probeId);if(trace&&options.onSelect)options.onSelect({...trace.signal,expression:trace.expression,unit:trace.unit,component:trace.mode});});controls.hidden=typeof options.onSelect!=='function';
  if(options.probeTarget)traceSection.append(options.probeTarget);
  function canProbe(traces){const signal=traces.find(trace=>trace.id===probeId)?.signal;return signal?.quantity==='voltage'&&Boolean(signal.net);}
 function setMode(value){mode=value;for(const [key,b]of Object.entries(modeButtons))b.setAttribute('aria-pressed',String(key===value));for(const row of plotRows)row.canvas.style.cursor=value==='pan'?'grab':'crosshair';}
  function assertLive(){if(disposed)throw Error('Simulation workspace is disposed.');}
  function load(files,settings={}){assertLive();const next=core.createSession(files,settings),previous=session;session=next;layouts.clear();plotCache=new WeakMap();generation++;previous.dispose();activeRow=0;hover=null;configurePersistence(settings);refresh();void restoreActive();return session.getState();}
  fileInput.onchange=async()=>{const token=++generation;try{const files=Array.from(fileInput.files||[]);if(files.length>core.limits.maxFiles||files.reduce((n,f)=>n+f.size,0)>core.limits.maxTotalBytes||files.some(f=>f.size>core.limits.maxFileBytes))throw Error('Simulation files exceed the workspace input budget.');const loaded=await Promise.all(files.map(async f=>({path:f.webkitRelativePath||f.name,content:await f.text()})));if(disposed||token!==generation)return;load(loaded);}catch(error){if(!disposed&&token===generation)status.textContent=error.message;}finally{fileInput.value='';}};
  function changeTab(id){assertLive();generation++;session.selectTab(id);activeRow=0;hover=null;drag=null;writeSaved('active',id);refresh();void restoreActive();return session.getState();}
  function bindResult(id,path,plotIndex=0){assertLive();generation++;session.bindResult(id,path,plotIndex);const tab=session.tabs.find(item=>item.id===id);restorePending.delete(id);for(const row of layoutFor(tab).rows)row.range=null;remember(tab);hover=null;refresh();return session.getState();}
  result.onchange=async()=>{
   const choice=result.value;if(!choice)return;
   const token=++generation,{tab}=session.active();
   try{
    if(choice.startsWith('remote:')){
     const path=choice.slice(7);status.textContent='Loading saved result…';result.disabled=true;
     const content=await options.readResult(path);
     if(disposed||token!==generation)return;
     session.addResult({path,content});bindResult(tab.id,path);
    }else{
     const binding=session.availableResults[Number(choice)];bindResult(tab.id,binding.path,binding.plotIndex);
    }
   }catch(error){if(!disposed&&session.active().tab===tab){status.textContent=error.message;refresh(false);}}
  };
  view.onchange=()=>{const {tab,traces}=session.active();if(!tab)return;const expressions=new Set(traces.filter(t=>tab.selected.includes(t.id)).map(t=>core.key(t.expression)));tab.view=view.value;tab.selected=session.active().traces.filter(t=>expressions.has(core.key(t.expression))).slice(0,32).map(t=>t.id);tab.selectionEdited=true;tab.cursors={A:null,B:null};tab.cursorsEdited=true;fitRows(false);remember(tab);refresh();};
  for(const [node,key]of [[xScale,'xScale'],[yScale,'yScale']])node.onchange=()=>{const {tab}=session.active();if(tab){tab[key]=node.value;remember(tab);fitRows();}};
  sweep.onchange=()=>{const {tab}=session.active();if(tab){tab.sweepIndex=Number(sweep.value);tab.cursors={A:null,B:null};tab.cursorsEdited=true;remember(tab);fitRows();}};find.oninput=()=>renderSignals();
  function renderSignals(){const {tab,traces}=session.active(),query=find.value.toLowerCase();signalList.replaceChildren();for(const trace of traces.filter(t=>t.name.toLowerCase().includes(query))){const label=make('div'),check=make('input'),name=make('button',trace.name);label.className='sim-signal';label.style.setProperty('--trace-color',trace.color);check.type='checkbox';check.checked=tab.selected.includes(trace.id);check.setAttribute('aria-label','Show '+trace.name);name.type='button';name.title='Inspect '+trace.name;name.setAttribute('aria-pressed',String(probeId===trace.id));name.onclick=()=>{
    const show=!check.checked&&tab.selected.length<32;
    selectProbe(trace.id);
    if(show){check.checked=true;check.onchange();}
   };makeDraggable(name,trace);check.onchange=()=>{if(check.checked&&tab.selected.length>=32){check.checked=false;status.textContent='Show up to 32 traces at once.';return;}tab.selected=check.checked?[...tab.selected,trace.id]:tab.selected.filter(id=>id!==trace.id);tab.selectionEdited=true;remember(tab);syncLegends(tab,traces);draw();};label.append(check,name);signalList.append(label);}}
  function refresh(clearStatus=true){const {tab,plot,traces}=session.active();save.disabled=!session.workbook;tabs.replaceChildren();for(const t of session.tabs){const b=make('button',t.title);b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-selected',String(t===tab));b.tabIndex=t===tab?0:-1;b.onclick=()=>changeTab(t.id);b.onkeydown=event=>{const index=session.tabs.indexOf(t),next=event.key==='ArrowRight'?index+1:event.key==='ArrowLeft'?index-1:event.key==='Home'?0:event.key==='End'?session.tabs.length-1:null;if(next!==null){event.preventDefault();changeTab(session.tabs[(next+session.tabs.length)%session.tabs.length].id);tabs.children[(next+session.tabs.length)%session.tabs.length]?.focus();}};tabs.append(b);}
   result.replaceChildren();const prompt=make('option','Choose result…');prompt.value='';result.append(prompt);for(const [index,r]of session.availableResults.entries()){const o=make('option',r.path.split(/[\\/]/).at(-1)+(r.plotIndex?' · '+r.title:''));o.value=String(index);o.disabled=Boolean(tab&&tab.analysis!=='UNKNOWN'&&r.analysis!=='UNKNOWN'&&tab.analysis!==r.analysis);result.append(o);}const bindingIndex=session.availableResults.findIndex(r=>tab?.binding?.path===r.path&&tab.binding.plotIndex===r.plotIndex);if(typeof options.readResult==='function')for(const item of options.resultSources||[]){if(session.files.some(f=>f.path===item.path))continue;const o=make('option',item.title||item.path);o.value='remote:'+item.path;result.append(o);}result.value=bindingIndex<0?'':String(bindingIndex);result.disabled=!tab;
   if(tab){view.value=tab.view;xScale.value=tab.xScale;yScale.value=tab.yScale;}probeId=(traces.find(t=>tab.selected.includes(t.id))||traces[0])?.id||'';
   settings.hidden=!plot;traceSection.hidden=!plot;view.parentNode.hidden=!traces.some(t=>t.imaginary?.length);locate.disabled=!canProbe(traces);
   sweep.replaceChildren();const all=make('option','All saved sweeps');all.value='-1';sweep.append(all);const count=traces.length?core.segments(traces[0]).length:0;for(let i=0;i<count;i++){const o=make('option','Sweep '+(i+1));o.value=String(i);sweep.append(o);}sweep.value=String(tab?.sweepIndex??-1);sweep.parentNode.hidden=count<2;commands.textContent=tab?.commands.join('\n')||'No stored simulator commands.';if(clearStatus)status.textContent=session.warnings.join(' ');renderSignals();renderRows(tab,plot,traces);draw();}
  function plotPoints(trace,maxPoints,sweepIndex){let cached=plotCache.get(trace.real);if(!cached){cached=new Map();plotCache.set(trace.real,cached);}const key=trace.mode+':'+maxPoints+':'+sweepIndex;if(cached.has(key))return cached.get(key);const points=core.reduced(trace,{maxPoints,sweepIndex});cached.set(key,points);if(cached.size>8)cached.delete(cached.keys().next().value);return points;}
  function layoutFor(tab){
   if(!layouts.has(tab?.id))layouts.set(tab?.id,{rows:[{range:null}],assignments:new Map()});
   return layouts.get(tab?.id);
  }
  function rowFor(layout,id){return layout.assignments.get(id)||layout.rows[0];}
  function fitRows(redraw=true){
   const {tab}=session.active();
   if(tab){tab.range=null;for(const row of layoutFor(tab).rows)row.range=null;}
   if(redraw)draw();
  }
  function selectProbe(id){
   probeId=id;hover=null;
   const {tab}=session.active(),layout=layoutFor(tab);
   activeRow=layout.rows.indexOf(rowFor(layout,id));
   map=plotRows[activeRow]?.map||null;
   syncRowControls(tab);
   drawInspection();
  }
  function makeDraggable(button,trace){
   button.draggable=true;button.dataset.traceId=trace.id;
   button.addEventListener('dragstart',event=>{
    if(!event.dataTransfer)return;
    draggedTrace=trace.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(dragType,trace.id);
   });
   button.addEventListener('dragend',()=>{
    draggedTrace=null;for(const row of plotRows)delete row.node.dataset.drop;
   });
  }
  function addRow(){
   const {tab,plot,traces}=session.active(),layout=layoutFor(tab);
   if(!plot||layout.rows.length>=maxRows)return;
   layout.rows.push({range:null});activeRow=layout.rows.length-1;remember(tab);
   renderRows(tab,plot,traces);draw();plotRows[activeRow]?.canvas.focus();
  }
  function moveTrace(id,target){
   const {tab,plot,traces}=session.active(),layout=layoutFor(tab);
   if(!plot||!layout.rows.includes(target)||!traces.some(trace=>trace.id===id))return;
   if(!tab.selected.includes(id)){
    if(tab.selected.length>=32){status.textContent='Show up to 32 traces at once.';return;}
    tab.selected.push(id);tab.selectionEdited=true;
   }
   const origin=rowFor(layout,id);
   if(origin!==target){layout.assignments.set(id,target);origin.range=null;target.range=null;}
   probeId=id;hover=null;activeRow=layout.rows.indexOf(target);remember(tab);
   renderSignals();syncLegends(tab,traces);draw();
  }
  function removeRow(row){
   const {tab,plot,traces}=session.active(),layout=layoutFor(tab),index=layout.rows.indexOf(row);
   if(index===0||index<0)return;
   const previous=layout.rows[index-1];
   for(const [id,assigned]of layout.assignments)if(assigned===row)layout.assignments.set(id,previous);
   layout.rows.splice(index,1);previous.range=null;activeRow=index-1;remember(tab);
   renderRows(tab,plot,traces);draw();plotRows[activeRow]?.canvas.focus();
  }
  function rowButton(text,label,action){
   const button=make('button',text);button.type='button';button.title=label;button.setAttribute('aria-label',label);button.onclick=action;return button;
  }
  function renderRows(tab,plot,traces){
   for(const row of plotRows)observer?.unobserve(row.canvas);
   plotRows.length=0;rowsHost.replaceChildren();map=null;drag=null;draggedTrace=null;
   const layout=layoutFor(tab),models=plot?layout.rows:[layout.rows[0]];
   activeRow=Math.min(activeRow,models.length-1);
   for(const [index,model]of models.entries()){
    const node=make('section'),bar=make('div'),title=make('span','Plot '+(index+1)),legend=make('div'),actions=make('div');
    const stage=make('div'),canvas=make('canvas'),inspection=make('canvas'),hint=make('div');
    node.className='sim-plot-row';node.setAttribute('aria-label','Plot '+(index+1));
    bar.className='sim-row-bar';bar.hidden=!plot;title.className='sim-row-title';legend.className='sim-legend';legend.setAttribute('aria-label','Plot '+(index+1)+' legend');legend.setAttribute('role','group');
    actions.className='sim-row-actions';const move=rowButton('Move here','Move selected trace to plot '+(index+1),()=>moveTrace(probeId,model));actions.append(move);
    if(index>0)actions.append(rowButton('×','Remove plot '+(index+1),()=>removeRow(model)));
    bar.append(title,legend,actions);
    stage.className='sim-stage';canvas.setAttribute('role','img');canvas.tabIndex=0;canvas.style.cursor=mode==='pan'?'grab':'crosshair';
    inspection.className='sim-inspection';inspection.setAttribute('aria-hidden','true');hint.className='sim-hint';
    stage.append(canvas,inspection,hint);node.append(bar,stage);rowsHost.append(node);
    const row={model,node,canvas,inspection,hint,legend,move,map:null};plotRows.push(row);
    node.addEventListener('dragover',event=>{
     if(!plot||!draggedTrace||!event.dataTransfer?.types.includes(dragType))return;
     event.preventDefault();event.dataTransfer.dropEffect='move';node.dataset.drop='true';
    });
    node.addEventListener('dragleave',event=>{if(!node.contains(event.relatedTarget))delete node.dataset.drop;});
    node.addEventListener('drop',event=>{
     if(!draggedTrace||event.dataTransfer?.getData(dragType)!==draggedTrace)return;
     event.preventDefault();delete node.dataset.drop;const id=draggedTrace;draggedTrace=null;moveTrace(id,model);
    });
    bindCanvas(row,index);observer?.observe(canvas);
   }
   plotPane.dataset.stacked=String(models.length>1);addRowButton.disabled=!plot||models.length>=maxRows;
   syncLegends(tab,traces);
  }
  function syncRowControls(tab){
   const layout=layoutFor(tab);
   for(const button of element.querySelectorAll('button[data-trace-id]'))button.setAttribute('aria-pressed',String(button.dataset.traceId===probeId));
   for(const row of plotRows){
    row.move.hidden=layout.rows.length<2;
    row.move.disabled=!probeId||rowFor(layout,probeId)===row.model&&tab?.selected.includes(probeId);
   }
  }
  function syncLegends(tab,traces){
   const layout=layoutFor(tab);
   for(const row of plotRows)row.legend.replaceChildren();
   const byModel=new Map(plotRows.map(row=>[row.model,row]));
   for(const trace of traces){
    if(!tab?.selected.includes(trace.id))continue;
    const button=rowButton('',trace.name+(trace.unit?' · '+trace.unit:''),()=>selectProbe(trace.id));
    const swatch=make('span');swatch.className='sim-legend-swatch';swatch.style.setProperty('--trace-color',trace.color);
    swatch.dataset.phase=String(trace.axis==='right');swatch.setAttribute('aria-hidden','true');
    button.append(swatch,make('span',trace.name+(trace.unit?' · '+trace.unit:'')));
    makeDraggable(button,trace);byModel.get(rowFor(layout,trace.id))?.legend.append(button);
   }
   syncRowControls(tab);
  }
  function draw(){
   if(disposed)return;
   const {tab,plot,traces}=session.active(),layout=layoutFor(tab);
   const selected=traces.filter(trace=>tab?.selected.includes(trace.id));
   const width=plotRows[0]?.canvas.getBoundingClientRect().width||600;
   const maxPoints=Math.max(1000,Math.min(8000,Math.round((width-128)*3)));
   const tx=x=>tab?.xScale==='log'?x>0?Math.log10(x):NaN:x;
   const perRow=new Map(plotRows.map(row=>[row.model,[]]));
   let xmin=Infinity,xmax=-Infinity;
   for(const trace of selected){
    const points=plotPoints(trace,maxPoints,tab.sweepIndex);
    perRow.get(rowFor(layout,trace.id))?.push({trace,points});
    if(!tab.range)for(const point of points){
     const x=point?tx(point.x):NaN;
     if(Number.isFinite(x)){xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);}
    }
   }
   if(tab?.range)({xmin,xmax}=tab.range);
   else if(!Number.isFinite(xmin)){xmin=0;xmax=1;}
   else if(xmin===xmax)xmax=xmin+1;
   fit.disabled=!plot;clear.disabled=!plot;for(const node of Object.values(modeButtons))node.disabled=!plot;
   grid.setAttribute('aria-pressed',String(tab?.showGrid!==false));
   for(const [index,row]of plotRows.entries())drawRow(row,index,tab,plot,traces,perRow.get(row.model),tx,xmin,xmax);
   map=plotRows[activeRow]?.map||null;
   drawInspection();
  }
  function drawRow(row,index,tab,plot,traces,sets,tx,xmin,xmax){
   const {canvas,hint}=row,box=canvas.getBoundingClientRect(),width=Math.max(180,box.width||600),height=Math.max(210,box.height||360),dpr=Math.min(2,win.devicePixelRatio||1);
   if(canvas.width!==Math.round(width*dpr))canvas.width=Math.round(width*dpr);
   if(canvas.height!==Math.round(height*dpr))canvas.height=Math.round(height*dpr);
   const ctx=canvas.getContext('2d');if(!ctx)return;
   ctx.setTransform(dpr,0,0,dpr,0,0);
   const dark=theme==='dark',ink=dark?'#dce7f5':'#263b50',line=dark?'#344456':'#dce3eb';
   ctx.fillStyle=dark?'#151c25':'#fff';ctx.fillRect(0,0,width,height);
   hint.hidden=Boolean(plot&&sets.length);
   hint.textContent=plot?'Drop a trace here':tab?.binding?'No waveform data.':tab?'Choose the saved result for this workbook tab.':'Open a KiCad workbook and saved result files.';
   if(!plot){canvas.setAttribute('aria-label','Interactive simulation plot: no saved results paired');row.map=null;return;}
   const selected=sets.map(set=>set.trace),area={x:64,y:24,w:Math.max(52,width-128),h:Math.max(80,height-70)};
   const ty=y=>tab.yScale==='log'?y>0?Math.log10(y):NaN:y;
   let ymin=Infinity,ymax=-Infinity,rmin=Infinity,rmax=-Infinity;
   for(const {trace,points}of sets)for(const point of points){
    if(!point||!Number.isFinite(tx(point.x)))continue;
    const y=trace.axis==='right'?point.y:ty(point.y);
    if(!Number.isFinite(y))continue;
    if(trace.axis==='right'){rmin=Math.min(rmin,y);rmax=Math.max(rmax,y);}
    else{ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
   }
   const pad=(min,max)=>!Number.isFinite(min)?[0,1]:min===max?[min-Math.max(1,Math.abs(min)*.05),max+Math.max(1,Math.abs(max)*.05)]:[min-(max-min)*.05,max+(max-min)*.05];
   [ymin,ymax]=pad(ymin,ymax);[rmin,rmax]=pad(rmin,rmax);
   const range={xmin,xmax,...(row.model.range||{ymin,ymax,rmin,rmax})};
   const sx=x=>area.x+(tx(x)-range.xmin)/(range.xmax-range.xmin)*area.w,sy=(y,right=false)=>area.y+area.h-((right?y:ty(y))-(right?range.rmin:range.ymin))/((right?range.rmax:range.ymax)-(right?range.rmin:range.ymin))*area.h;
   ctx.font='11px system-ui';ctx.fillStyle=ink;ctx.lineWidth=1;for(let i=0;i<=5;i++){const x=area.x+i*area.w/5,y=area.y+i*area.h/5;if(tab.showGrid){ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(x,area.y);ctx.lineTo(x,area.y+area.h);ctx.moveTo(area.x,y);ctx.lineTo(area.x+area.w,y);ctx.stroke();}ctx.textAlign='center';const xt=range.xmin+i*(range.xmax-range.xmin)/5;ctx.fillText(axisFormat(tab.xScale==='log'?10**xt:xt),x,area.y+area.h+18);ctx.textAlign='right';const yt=range.ymax-i*(range.ymax-range.ymin)/5;ctx.fillText(axisFormat(tab.yScale==='log'?10**yt:yt),area.x-7,y+4);if(sets.some(s=>s.trace.axis==='right')){ctx.textAlign='left';ctx.fillText(axisFormat(range.rmax-i*(range.rmax-range.rmin)/5)+'°',area.x+area.w+7,y+4);}}
   ctx.textAlign='center';ctx.fillText(tab.analysis==='TRAN'?'Time (s)':tab.analysis==='AC'?'Frequency (Hz)':plot.xLabel,area.x+area.w/2,height-6);ctx.textAlign='left';ctx.fillText([...new Set(selected.filter(t=>t.axis==='left').map(t=>t.unit))].join(' / '),area.x,14);
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();for(const {trace,points}of sets){ctx.strokeStyle=trace.color;ctx.lineWidth=1.65;ctx.setLineDash(trace.axis==='right'?[5,3]:[]);ctx.beginPath();let connected=false;for(const p of points){if(!p){connected=false;continue;}const x=sx(p.x),y=sy(p.y,trace.axis==='right');if(!Number.isFinite(x)||!Number.isFinite(y)){connected=false;continue;}if(connected)ctx.lineTo(x,y);else ctx.moveTo(x,y);connected=true;}ctx.stroke();}ctx.setLineDash([]);

   ctx.restore();
   row.map={area,range,sx,sy,tab,traces,selected,row,width,height,dpr,at:x=>tab.xScale==='log'?10**(range.xmin+(x-area.x)/area.w*(range.xmax-range.xmin)):range.xmin+(x-area.x)/area.w*(range.xmax-range.xmin)};
   canvas.setAttribute('aria-label','Interactive simulation plot '+(index+1)+': '+plot.title+'; '+selected.length+' selected traces');
  }
  const measurements=make('div'),inspected=make('output');
  measurements.className='sim-measurements';measurements.setAttribute('aria-live','polite');inspected.className='sim-hover';
  readouts.append(measurements,inspected);
  function drawInspection(){
   for(const row of plotRows)paintInspection(row);
   if(!map){measurements.replaceChildren();measurementKey='';inspected.textContent='';readouts.hidden=true;return;}
   const {tab,traces}=map;
   readouts.hidden=false;locate.disabled=!canProbe(traces);
   updateMeasurements(tab,traces);
  }
  function paintInspection(row){
   const {canvas,inspection,map:plot}=row,ctx=inspection.getContext('2d');if(!ctx)return;
   if(!plot){ctx.clearRect(0,0,inspection.width,inspection.height);return;}
   const {tab,selected,area,sx,sy,width,height,dpr}=plot;
   if(inspection.width!==canvas.width)inspection.width=canvas.width;
   if(inspection.height!==canvas.height)inspection.height=canvas.height;
   ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   ctx.font='600 11px system-ui';
   function mark(sample,color,name){
    if(!sample)return;
    const trace=selected.find(t=>t.id===sample.traceId);
    const x=sx(sample.x),y=!trace||sample.y===null?NaN:sy(sample.y,trace.axis==='right');
    if(!Number.isFinite(x))return;
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=name&&trace?1.5:1;ctx.globalAlpha=trace?1:.45;
    ctx.setLineDash(name?[]:[4,4]);ctx.beginPath();ctx.moveTo(x,area.y);ctx.lineTo(x,area.y+area.h);ctx.stroke();ctx.setLineDash([]);
    if(Number.isFinite(y)){ctx.beginPath();ctx.arc(x,y,name?4.5:3.5,0,Math.PI*2);ctx.fill();ctx.strokeStyle=theme==='dark'?'#151c25':'#fff';ctx.stroke();}
    if(name&&trace){ctx.textAlign=x>area.x+area.w-18?'right':'left';ctx.fillText(name,x+(ctx.textAlign==='right'?-5:5),area.y+13);}
   }
   mark(hover,theme==='dark'?'#8d9eb2':'#617d97');
   for(const [name,cursor]of Object.entries(tab.cursors))mark(cursor,name==='A'?'#19a5ac':'#d98618',name);
   ctx.globalAlpha=1;
   if(drag?.type==='zoom'&&drag.row===row){ctx.fillStyle='rgba(60,135,220,.15)';ctx.strokeStyle='#3c87dc';ctx.fillRect(drag.start.x,drag.start.y,drag.end.x-drag.start.x,drag.end.y-drag.start.y);ctx.strokeRect(drag.start.x,drag.start.y,drag.end.x-drag.start.x,drag.end.y-drag.start.y);}
   ctx.restore();
  }
  function updateMeasurements(tab,traces){
   const unit=tab.analysis==='TRAN'?' s':tab.analysis==='AC'?' Hz':'';
   const traceName=id=>traces.find(trace=>trace.id===id)?.name||'';
   const nameValue=c=>traceName(c.traceId)+' \u00b7 '+format(c.x)+unit+' \u00b7 '+format(c.y)+(c.unit?' '+c.unit:'')+(c.index===null?' (outside saved range)':'');
   const {A,B}=tab.cursors;
   const items=Object.entries(tab.cursors).filter(([,cursor])=>cursor).map(([name,cursor])=>[name,name+'  '+nameValue(cursor)]);
   if(A&&B){const sameTrace=A.traceId===B.traceId;items.push(['delta','\u0394X '+format(B.x-A.x)+unit+(sameTrace?' \u00b7 \u0394Y '+format(A.y===null||B.y===null?null:B.y-A.y)+' '+A.unit:'')]);}
   const key=JSON.stringify(items);
   if(key!==measurementKey){
    measurementKey=key;
    measurements.replaceChildren(...items.map(([name,value])=>{const entry=make('span',value);entry.className=name==='delta'?'sim-measure':'sim-readout';entry.dataset.cursor=name;return entry;}));
   }
   const hoverText=hover?nameValue(hover):items.length?'':'Hover or tap to inspect a sample';
   if(inspected.textContent!==hoverText)inspected.textContent=hoverText;
  }
  function queueDraw(){if(frame||disposed)return;frame=(win.requestAnimationFrame||((f)=>setTimeout(f,0))).call(win,()=>{frame=0;const redraw=baseDirty;baseDirty=false;if(redraw)draw();else drawInspection();});}
  function schedule(){baseDirty=true;queueDraw();}
  function setRange(plot,xmin,xmax,ymin,ymax,rmin,rmax){
   plot.tab.range={xmin,xmax,ymin,ymax,rmin,rmax};
   plot.row.model.range={ymin,ymax,rmin,rmax};
   schedule();
  }
  function zoom(factor,point){
   if(!map)return;
   const {area,tab,row}=map,range={...map.range,...tab.range,...row.model.range};
   const fx=point?Math.max(0,Math.min(1,(point.x-area.x)/area.w)):.5,fy=point?Math.max(0,Math.min(1,(point.y-area.y)/area.h)):.5;
   const around=(min,max,f)=>{const centre=min+(max-min)*f;return [centre+(min-centre)*factor,centre+(max-centre)*factor];};
   const [xmin,xmax]=around(range.xmin,range.xmax,fx),[ymin,ymax]=around(range.ymin,range.ymax,1-fy),[rmin,rmax]=around(range.rmin,range.rmax,1-fy);
   if(xmax-xmin<1e-15||xmax-xmin>1e20)return;
   setRange(map,xmin,xmax,ymin,ymax,rmin,rmax);
  }
  function activeTrace(plot,id){return plot.selected.find(trace=>trace.id===id)||plot.selected[0];}
  function setCursor(name,p){
   const trace=activeTrace(map,drag?.traceId||probeId);if(!trace)return;
   const sample=core.sample(trace,map.at(p.x),map.tab.sweepIndex);if(!sample)return;
   map.tab.cursorsEdited=true;map.tab.cursors[name]=sample;queueDraw();
  }
  function bindCanvas(row,index){
   const {canvas}=row;
   const activate=()=>{activeRow=index;map=row.map;};
   const point=event=>{const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
   const inside=p=>row.map&&p.x>=row.map.area.x&&p.x<=row.map.area.x+row.map.area.w&&p.y>=row.map.area.y&&p.y<=row.map.area.y+row.map.area.h;
   const inspect=p=>{const trace=activeTrace(row.map,probeId);hover=trace?core.sample(trace,row.map.at(p.x),row.map.tab.sweepIndex):null;queueDraw();};
   canvas.addEventListener('focus',activate);
   canvas.addEventListener('pointerdown',event=>{
    const p=point(event);if(event.button!==0||!inside(p))return;
    activate();canvas.focus();canvas.setPointerCapture?.(event.pointerId);
    let type=event.shiftKey?'zoom':mode,traceId=null;
    if(type==='pan')for(const [name,cursor]of Object.entries(map.tab.cursors)){
     if(cursor&&map.selected.some(trace=>trace.id===cursor.traceId)&&Math.abs(map.sx(cursor.x)-p.x)<8){type=name;traceId=cursor.traceId;break;}
    }
    hover=null;drag={row,type,traceId,start:p,end:p,range:{...map.range}};
    if(type==='A'||type==='B')setCursor(type,p);
   });
   canvas.addEventListener('pointermove',event=>{
    if(!row.map)return;
    const p=point(event);
    if(!drag){if(inside(p))inspect(p);else{hover=null;queueDraw();}return;}
    if(drag.row!==row)return;
    drag.end=p;
    if(drag.type==='A'||drag.type==='B')setCursor(drag.type,p);
    else if(drag.type==='pan'){
     const r=drag.range,{w,h}=map.area,dx=(p.x-drag.start.x)/w,dy=(p.y-drag.start.y)/h;
     setRange(map,r.xmin-dx*(r.xmax-r.xmin),r.xmax-dx*(r.xmax-r.xmin),r.ymin+dy*(r.ymax-r.ymin),r.ymax+dy*(r.ymax-r.ymin),r.rmin+dy*(r.rmax-r.rmin),r.rmax+dy*(r.rmax-r.rmin));
    }else queueDraw();
   });
   canvas.addEventListener('pointerleave',()=>{hover=null;queueDraw();});
   canvas.addEventListener('pointerup',event=>{
    if(drag?.row!==row)return;
    const {type,start,end,range}=drag;drag=null;
    canvas.releasePointerCapture?.(event.pointerId);
    if(type==='A'||type==='B')remember(row.map?.tab);
    if(type==='pan'&&Math.hypot(end.x-start.x,end.y-start.y)<4)inspect(start);
    if(type==='zoom'&&Math.abs(end.x-start.x)>4&&Math.abs(end.y-start.y)>4){
     const a=map.area,xf=x=>range.xmin+(x-a.x)/a.w*(range.xmax-range.xmin),yf=y=>range.ymax-(y-a.y)/a.h*(range.ymax-range.ymin),rf=y=>range.rmax-(y-a.y)/a.h*(range.rmax-range.rmin);
     setRange(map,Math.min(xf(start.x),xf(end.x)),Math.max(xf(start.x),xf(end.x)),Math.min(yf(start.y),yf(end.y)),Math.max(yf(start.y),yf(end.y)),Math.min(rf(start.y),rf(end.y)),Math.max(rf(start.y),rf(end.y)));
    }else queueDraw();
   });
   canvas.addEventListener('pointercancel',()=>{if(drag?.row===row){if(drag.type==='A'||drag.type==='B')remember(row.map?.tab);drag=null;queueDraw();}});
   canvas.addEventListener('wheel',event=>{if(!row.map)return;event.preventDefault();activate();zoom(Math.exp(Math.max(-1,Math.min(1,event.deltaY*.002))),point(event));},{passive:false});
   canvas.addEventListener('keydown',event=>{
    const shortcuts={a:'A',b:'B',z:'zoom',escape:'pan'},next=shortcuts[event.key.toLowerCase()];
    if(next&&map&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setMode(next);return;}
    if(event.key==='Home'){event.preventDefault();fitRows();return;}
    if(!['ArrowLeft','ArrowRight'].includes(event.key)||!['A','B'].includes(mode)||!map)return;
    const cursor=map.tab.cursors[mode],trace=activeTrace(map,cursor?.traceId||probeId);if(!trace)return;
    event.preventDefault();
    const bounds=map.tab.sweepIndex>=0?core.segments(trace)[map.tab.sweepIndex]:{start:0,end:trace.length};if(!bounds)return;
    const base=cursor?.traceId===trace.id&&cursor.index>=bounds.start&&cursor.index<bounds.end?cursor.index:bounds.start;
    const sample=Math.max(bounds.start,Math.min(bounds.end-1,base+(event.key==='ArrowLeft'?-1:1))),y=core.traceValue(trace,sample);
    map.tab.cursorsEdited=true;map.tab.cursors[mode]={traceId:trace.id,x:trace.real[sample].x,y:Number.isFinite(y)?y:null,index:sample,unit:trace.unit};remember(map.tab);queueDraw();
   });
  }
  const observer=typeof root.ResizeObserver==='function'?new root.ResizeObserver(schedule):null;
  if(!observer)win.addEventListener?.('resize',schedule);container.append(element);owners.set(container,element);setMode('pan');configurePersistence(options);refresh();void restoreActive();
  return {element,load,selectTab:changeTab,bindResult,setTheme(value){assertLive();if(!['light','dark'].includes(value))throw Error('Choose light or dark theme.');theme=value;element.dataset.theme=value;draw();},getState(){assertLive();return session.getState();},exportWorkbook(){assertLive();return session.exportWorkbook();},dispose(){if(disposed)return;disposed=true;generation++;observer?.disconnect();if(!observer)win.removeEventListener?.('resize',schedule);if(frame)(win.cancelAnimationFrame||clearTimeout).call(win,frame);session.dispose();element.remove();owners.delete(container);}};
 }
 const API={mount};root.KiCadSimulationWorkspace=API;if(typeof module==='object'&&module.exports)module.exports=API;
})(typeof globalThis==='object'?globalThis:this);
