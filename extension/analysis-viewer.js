/* Saved result presentation: local text only, no HTML execution or solver calls. */
(()=>{'use strict';
 const runtimeSend=message=>globalThis.KiCadChunkedReplies?globalThis.KiCadChunkedReplies.send(chrome.runtime,message):chrome.runtime.sendMessage(message);
 const nativeEditor=Boolean(globalThis.KiCadVSCodeContext&&!globalThis.KiCadAndroidRuntime);
 const $=id=>document.getElementById(id),make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
 const query=new URLSearchParams((globalThis.KiCadVSCodeContext&&!globalThis.KiCadAndroidRuntime?globalThis.KiCadVSCodeContext.search:location.search)),context=Object.fromEntries(['repository','ref','provider','host'].map(k=>[k,query.get(k)]).filter(([,v])=>v));
 let report=null,ticket=0,rowLimit=100,fieldLimit=200,selected=new Set(),chartMap=null,disposed=false,rotation=.65,tilt=.7,drag=null,simulation=null,plotTheme=null;
 function applyTheme(theme){document.body.classList.toggle('dark',theme==='dark');if(!nativeEditor&&!globalThis.KiCadAndroidRuntime)document.body.dataset.uiTheme=theme;}
 if(!nativeEditor&&!globalThis.KiCadAndroidRuntime){
  let inherited=query.get('uiTheme')||document.body.dataset.uiTheme;
  if(!['light','dark'].includes(inherited))try{inherited=JSON.parse(localStorage.getItem('kicad:workspace-theme:v1')||'null')?.uiTheme;}catch{}
  applyTheme(['light','dark'].includes(inherited)?inherited:document.body.classList.contains('dark')||matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
 }
 const locate=make('button','Locate net'),drawing=make('select');drawing.setAttribute('aria-label','Drawing for saved signal');locate.title='Highlight the exact saved voltage net in a drawing';$('probeTools').append(drawing,locate);let resultRevision=context.ref;
 function drawingURL(file,net){
  const params=new URLSearchParams({...context,ref:resultRevision,file,uiTheme:currentTheme(),...(net?{focusNet:net}:{})});
  return chrome.runtime.getURL('browser-viewer.html')+'?'+params;
 }
 async function locateSignal(signal,announce){try{
   if(signal?.quantity!=='voltage'||typeof signal.net!=='string'||!signal.net||signal.net.length>500||/[\x00-\x1f\x7f]/.test(signal.net))throw Error('Select a saved voltage trace with an exact net name.');
   if(nativeEditor){const result=await request('analysis-focus-net',{file:globalThis.KiCadVSCodeContext.drawingFile,netName:signal.net});if(!result.delivered)throw Error('Open the original drawing to locate this net.');}
   else{const file=[...drawing.options].some(option=>option.value===signal.sourcePath)?signal.sourcePath:drawing.value;if(!file)throw Error('Choose a drawing to locate this signal.');if(rootAndroid())window.top.KiCadAndroid.openDrawing(file,{netName:signal.net,ref:resultRevision});else window.open(drawingURL(file,signal.net),'_blank','noopener');}
   announce('Locating '+signal.net+'…');
 }catch(error){announce(error.message);}}
 locate.onclick=()=>{const plot=report?.plots[Number($('plot').value)],series=plot?.series?.find(s=>s.name===$('probeTrace').value);return locateSignal(series?.signal,text=>{$('cursor').textContent=text;});};
 drawing.hidden=nativeEditor;
 const familyLabels={kicad:'KiCad simulation',wayricad:'wayriCAD analysis',emerge:'EMerge results',other:'Other / unclassified exports'};
 const familyFilter=make('select'),familyRow=make('label','Source');familyFilter.id='resultFamily';familyFilter.setAttribute('aria-label','Result source family');familyRow.className='file-picker';
 for(const [value,label]of [['all','All saved results'],...Object.entries(familyLabels)])option(familyFilter,label,value);familyFilter.value='all';familyRow.append(familyFilter);$('file').parentNode.before(familyRow);
 const browse=make('details'),browseLabel=make('summary','Browse results'),viewBar=make('div');
 const fileRow=$('file').parentNode,views=document.querySelector('nav[aria-label="Analysis views"]');
 browse.className='analysis-file-browser';browse.append(browseLabel,familyRow,fileRow);
 viewBar.className='analysis-toolbar';views.before(viewBar);viewBar.append(views,browse);
 const standalone=!context.repository&&!nativeEditor&&!rootAndroid();
 const localInput=make('input'),localButton=make('button','Open EMerge file');
 localInput.type='file';localInput.hidden=true;
 localInput.accept=['.egres','.json',...Array.from({length:32},(_,i)=>'.s'+(i+1)+'p')].join(',');
 localButton.type='button';localButton.onclick=()=>localInput.click();
 localInput.onchange=()=>{const file=localInput.files[0];localInput.value='';if(file)void load(file.name,file);};
 viewBar.insertBefore(localButton,browse);viewBar.append(localInput);browse.hidden=standalone;
 if(standalone){$('probeTools').hidden=true;$('chart').hidden=true;$('graphControls').hidden=true;$('plot').disabled=true;$('status').textContent='Open a saved EMerge GUI, Touchstone, or Quick EMerge result.';}
 let resultFiles=[],knownFamilies=new Map();
 function sourceFamily(path){return knownFamilies.get(path)||KiCadAnalysisData.family(path);}
 function familyDescription(value){return value==='all'?'Choose KiCad simulation, wayriCAD analysis, EMerge results, or unclassified exports.':value==='kicad'?'KiCad workbooks and saved circuit waveforms. Workbooks contain setup, not simulated samples.':value==='wayricad'?'wayriCAD saved plugin results. Spatial fields support 2D/3D overlays and saved-value probing; source PCB placement requires a matching hash.':value==='emerge'?'Saved EMerge GUI, Touchstone, and Quick EMerge results.':'Unclassified exports stay separate until their producer is identified. CSV/TSV filenames alone do not prove their origin.';}
 function filterFiles(preferred){$('file').replaceChildren();for(const path of resultFiles)if(familyFilter.value==='all'||sourceFamily(path)===familyFilter.value)option($('file'),path,path);if(preferred&&[...$('file').options].some(o=>o.value===preferred))$('file').value=preferred;familyFilter.title=familyDescription(familyFilter.value);familyFilter.setAttribute('aria-description',familyFilter.title);}
 familyFilter.onchange=()=>{const preferred=$('file').value;filterFiles(preferred);if($('file').value)void load($('file').value);else{ticket++;closeSimulation();globalThis.KiCadAnalysisBomLink?.update();report=null;chartMap=null;resetProbes();overlay.update(null,[]);$('sourceLabel').textContent=familyLabels[familyFilter.value]||'Saved results';$('status').textContent='No files in this source group. Choose another source group.';$('chart').hidden=true;$('graphEmpty').textContent='No saved results in this group.';$('plotLimits').textContent='';$('cursor').textContent='';$('plot').replaceChildren();$('table').replaceChildren();$('fieldList').replaceChildren();$('tableHost').replaceChildren();$('warnings').replaceChildren();$('sourceText').textContent='';$('probeTools').hidden=true;$('frameControl').hidden=true;$('graphControls').hidden=true;}};
 const colors=['#0085bf','#d56142','#40a575','#a46ac9','#c89812','#bd5686'];
 const initialResultView=query.get('resultView');if(['map','2d','3d'].includes(initialResultView))$('resultView').value=initialResultView;
 let probeMode=null,probeA=null,probeB=null;
 function acceptProbe(point){$('cursor').textContent=point?describeProbe(point):'No saved value at this location.';if(point&&probeMode){if(probeMode==='A')probeA=point;else probeB=point;probeMode=null;renderProbes();draw();}}
 const overlay=KiCadAnalysisOverlay.mount({request,context,onProbe:acceptProbe,onHover:point=>{$('cursor').textContent=point?describeProbe(point):'';},onFrame:index=>{$('savedFrame').value=String(index);$('savedFrame').oninput();}});
 function resetProbes(){probeMode=null;probeA=probeB=null;renderProbes();}
 function describeProbe(p){const coordinates=p?.xLabel&&p.yLabel?p.xLabel+' '+format(p.x)+' · '+p.yLabel+' '+format(p.y):p?'X '+format(p.x)+(p.y===undefined?' · '+p.axis:' mm · Y '+format(p.y)+' mm'+(Number.isFinite(p.z)?' · Z '+format(p.z)+' mm':'')):'';return p?coordinates+' · '+(p.value===null?'No saved value':format(p.value)+(p.unit?' '+p.unit:' · '+p.name))+' · '+p.method:'Not set';}
 function renderProbes(){
  $('probeA').setAttribute('aria-pressed',String(probeMode==='A'));$('probeB').setAttribute('aria-pressed',String(probeMode==='B'));
  const delta=KiCadAnalysisData.probeDifference(probeA,probeB);
  $('probeResult').textContent=[probeMode?'Tap the graph to set '+probeMode+'.':'',probeA?'A: '+describeProbe(probeA):'',probeB?'B: '+describeProbe(probeB):'',delta?'B − A: ΔX '+format(delta.dx)+(delta.dy===undefined?' · '+probeA.axis:probeA.xLabel?' · '+probeA.xLabel+' · ΔY '+format(delta.dy)+' · '+probeA.yLabel:' mm · ΔY '+format(delta.dy)+' mm · Distance '+format(delta.distance)+' mm')+' · Δvalue '+(delta.delta===null?'Unavailable (missing saved value)':format(delta.delta)+(probeA.unit?' '+probeA.unit:' · '+probeA.name)):''].filter(Boolean).join('\n')||'Tap the graph to inspect a saved value. Mark A and B to compare two points.';
 }
 for(const name of ['A','B'])$('probe'+name).onclick=()=>{probeMode=probeMode===name?null:name;renderProbes();};
 $('probeClear').onclick=()=>{resetProbes();draw();};$('probeTrace').onchange=()=>{resetProbes();draw();};
 $('savedFrame').oninput=()=>{const plot=report?.plots[Number($('plot').value)],index=Number($('savedFrame').value);if(!plot?.frames)return;const values=KiCadAnalysisData.frameValues(plot,index);if(!values)return;plot.values=values;plot.frameIndex=index;const refresh=p=>{if(!p)return null;const next=KiCadAnalysisData.probe(plot,p.x,p.y);return next?{...next,z:p.z}:null;};probeA=refresh(probeA);probeB=refresh(probeB);renderProbes();draw();};
 function probeAt(event){if(!chartMap?.probe)return null;const rect=$('chart').getBoundingClientRect();return chartMap.probe(event.clientX-rect.left,event.clientY-rect.top);}
 $('chart').addEventListener('click',event=>acceptProbe(probeAt(event)));
 function drawProbes(ctx,sx,sy){for(const [name,p]of [['A',probeA],['B',probeB]]){if(!p||p.value===null)continue;const x=sx(p.x),y=sy(p.y===undefined?p.value:p.y);if(!Number.isFinite(x)||!Number.isFinite(y))continue;ctx.fillStyle='#d56142';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font='bold 12px system-ui';ctx.textAlign='left';ctx.fillText(name,x+8,y-7);}}
 async function request(type,extra={}){const response=await runtimeSend({type,...context,...extra});if(!response?.ok)throw Error(response?.error||'Unable to read saved results.');return response.result;}
 function option(select,label,value){const n=make('option',label);n.value=value;select.append(n);}
 function currentTheme(){
  return plotTheme||(document.body.classList.contains('dark')||document.body.classList.contains('vscode-dark')||document.body.classList.contains('vscode-high-contrast')||document.body.dataset.uiTheme==='dark'?'dark':'light');
 }
 async function readProjectFile(path){
  const result=await request('project-file',{file:path,...(resultRevision?{ref:resultRevision}:{})});
  const content=typeof result==='string'?result:result?.content;
  if(typeof content!=='string')throw Error('No saved text was returned for '+path+'.');
  return content;
 }
 function closeSimulation(){
  if(!simulation)return;
  const target=$('simulationDrawing');$('simulationGraph').prepend(target);
  simulation.dispose();simulation=null;
  $('simulationGraph').hidden=true;$('legacyGraph').hidden=false;
  $('probeTools').insertBefore(drawing,locate);
 }
 function openSimulation(path,content,generation){
  const workbook=/\.wbk$/i.test(path);
  const waveform=report.plots.length>0&&report.plots.every(plot=>!plot.type)&&report.plots.some(plot=>plot.series.some(trace=>trace.signal?.quantity==='voltage'&&trace.signal.net));
  const eligible=workbook?report.kind==='KiCad simulation workbook':report.kind==='ASCII SPICE simulation'&&report.plots.length>0||/\.(csv|tsv)$/i.test(path)&&waveform;
  if(!eligible)return;
  const sources=workbook?new Set(resultFiles.filter(file=>/\.(raw|csv|tsv)$/i.test(file))):new Set();
  const canLocate=nativeEditor||drawing.options.length>0;
  simulation=KiCadSimulationWorkspace.mount($('simulationMount'),{
   files:[{path,content}],theme:currentTheme(),allowLocalFiles:false,
   persistenceKey:JSON.stringify([context.provider||'github',context.host||'',context.repository||'',resultRevision||'']),
   selectionLabel:'Probe drawing',probeTarget:nativeEditor||!canLocate?null:$('simulationDrawing'),
   onSelect:canLocate?signal=>locateSignal(signal,text=>{
    if(disposed||generation!==ticket)return;
    $('simulationStatus').textContent=text;$('simulationStatus').hidden=false;
   }):undefined,
   resultSources:[...sources].map(path=>({path})),
   async readResult(path){
    if(disposed||generation!==ticket||!sources.has(path))throw Error('Choose a saved waveform from this project.');
    return readProjectFile(path);
   }
  });
  $('simulationStatus').hidden=true;$('simulationStatus').textContent='';
  $('simulationDrawing').hidden=nativeEditor||!canLocate;
  if(!nativeEditor&&canLocate)$('simulationDrawing').firstElementChild.append(drawing);
  $('simulationGraph').hidden=false;$('legacyGraph').hidden=true;
  chartMap=null;overlay.update(null,[]);
 }
 async function load(path,localFile){const generation=++ticket;closeSimulation();globalThis.KiCadAnalysisBomLink?.update();$('status').textContent='Loading '+path+'…';try{
  if(localFile&&(!KiCadAnalysisEMerge.candidate(path)&&!/\.json$/i.test(path)))throw Error('Choose an EMerge result, Touchstone file, or Quick EMerge JSON.');
  if(localFile&&localFile.size>KiCadAnalysisData.MAX_BYTES)throw Error('EMerge export exceeds 64 MiB.');
  const source=await (localFile?localFile.text():readProjectFile(path));if(disposed||generation!==ticket)return;
  report=localFile?KiCadAnalysisEMerge.parse(path,source):KiCadAnalysisData.parse(path,source);
  if(!localFile){knownFamilies.set(path,report.family);familyFilter.value=report.family;filterFiles(path);}
  if(!localFile&&report.family!=='emerge')globalThis.KiCadAnalysisBomLink?.update(path,source,resultRevision);
  $('sourceLabel').textContent=(report.familyLabel||familyLabels[report.family])+' · '+report.kind+' · '+path;
  $('analysisTitle').textContent=path.split('/').at(-1);$('analysisTitle').title=path;
  const warnings=[...report.warnings];
  $('sourceText').textContent=source.slice(0,512000);if(source.length>512000)$('sourceText').append(make('p','Source preview limited to 512,000 characters.'));
  try{if(report.family!=='emerge')openSimulation(path,source,generation);}catch(error){closeSimulation();warnings.push(error.message);}
  $('warnings').replaceChildren(...warnings.filter(w=>!simulation||!w.startsWith('This workbook stores simulation commands, signals and display settings, not waveform samples.')&&!w.startsWith('Complex traces are displayed as real and imaginary components')).map(w=>make('p',w)));
  $('plot').replaceChildren();if(!simulation){report.plots.forEach((p,i)=>option($('plot'),p.title,i));void overlay.setReport(report.savedSource);selectPlot();}
  $('table').replaceChildren();report.tables.forEach((t,i)=>option($('table'),t.title,i));rowLimit=100;fieldLimit=200;activateTab(simulation||report.plots.length?'graphs':report.tables.length?'tables':'fields');
  if($('tables').hidden)$('tableHost').replaceChildren();if($('fields').hidden)$('fieldList').replaceChildren();
 }catch(error){if(generation!==ticket)return;closeSimulation();report=null;chartMap=null;overlay.update(null,[]);$('status').textContent=error.message;$('chart').hidden=true;$('graphEmpty').textContent=error.message;$('fieldList').replaceChildren();$('tableHost').replaceChildren();$('warnings').replaceChildren();}}
 function renderFields(){if(!report)return;const q=$('search').value.toLowerCase();$('fieldList').replaceChildren();const matches=report.fields.filter(f=>(f.path+' '+String(f.value)).toLowerCase().includes(q));for(const field of matches.slice(0,fieldLimit)){const card=make('article');card.append(make('strong',field.path||'Value'),make('span',field.value===null?'null':field.value));$('fieldList').append(card);}if(matches.length>fieldLimit){const more=make('button','Show more properties · '+(matches.length-fieldLimit)+' remaining');more.onclick=()=>{fieldLimit+=200;renderFields();};$('fieldList').append(more);}}
 function renderTable(){const data=report?.tables[Number($('table').value)];$('tableHost').replaceChildren();if(!data){$('tableStatus').textContent='No tabular results in this file.';$('moreRows').hidden=true;return;}const table=make('table'),head=make('thead'),tr=make('tr');for(const name of data.columns)tr.append(make('th',name));head.append(tr);const body=make('tbody');for(const row of data.rows.slice(0,rowLimit)){const r=make('tr');for(const value of row)r.append(make('td',value));body.append(r);}table.append(head,body);$('tableHost').append(table);$('moreRows').hidden=data.rows.length<=rowLimit;$('tableStatus').textContent=Math.min(rowLimit,data.rows.length)+' of '+data.rows.length+' saved rows';}
 function selectPlot(){resetProbes();$('cursor').textContent='';const plot=report?.plots[Number($('plot').value)];$('probeTrace').replaceChildren();for(const series of plot?.series||[])option($('probeTrace'),series.name,series.name);$('probeTraceLabel').hidden=!plot?.series;selected=new Set((plot?.series||[]).slice(0,plot?.title==='Illustrative eye diagram'?512:4).map(s=>s.name));$('signals').replaceChildren();for(const [i,series]of (plot?.series||[]).entries()){const label=make('label'),check=make('input');check.type='checkbox';check.checked=selected.has(series.name);check.onchange=()=>{check.checked?selected.add(series.name):selected.delete(series.name);draw();};label.style.borderColor=colors[i%colors.length];label.append(check,make('span',series.name));$('signals').append(label);}draw();}
 const format=value=>Math.abs(value)>=100000||Math.abs(value)>0&&Math.abs(value)<.001?value.toExponential(2):Number(value.toPrecision(4)).toString();
 function draw(){if(simulation)return;const plot=report?.plots[Number($('plot').value)],node=$('chart');node.hidden=!plot;$('graphControls').hidden=!plot;$('probeTools').hidden=!plot||plot.type==='mechanical';$('frameControl').hidden=!plot?.frames;if(plot?.frames){$('savedFrame').max=String(plot.frames.length-1);$('savedFrame').value=String(plot.frameIndex);$('frameTime').textContent=format(Number(plot.frames[plot.frameIndex].time_s))+' s · '+(plot.frameIndex+1)+'/'+plot.frames.length;}$('plot').disabled=!plot;$('graphEmpty').textContent=plot?'':'No saved waveform samples in this file. See Report for settings and analytical results.';chartMap=null;$('plotLimits').textContent='';if(!plot){overlay.update(null,[]);return;}
  const ctx=node.getContext('2d'),box=node.getBoundingClientRect(),dpr=devicePixelRatio||1;node.width=Math.max(1,Math.round(box.width*dpr));node.height=Math.max(1,Math.round(box.height*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);const dark=document.body.classList.contains('dark');ctx.fillStyle=dark?'#1b2b36':'#fff';ctx.fillRect(0,0,box.width,box.height);
  node.style.touchAction=plot.type==='mechanical'?'none':'pan-y';if(plot.type){$('graphControls').hidden=true;drawSpatial(plot,ctx,box);overlay.update(plot,[probeA,probeB]);return;}
  const tx=x=>$('xScale').value==='log'?x>0?Math.log10(x):NaN:x,ty=y=>y===null?NaN:$('yScale').value==='log'?y>0?Math.log10(y):NaN:y;
  const traces=plot.series.filter(s=>selected.has(s.name));let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const s of traces)for(const p of s.points){const x=tx(p.x),y=ty(p.y);if(!Number.isFinite(x)||!Number.isFinite(y))continue;xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
  if(!Number.isFinite(xmin)){$('plotLimits').textContent='No finite values on these axes. Logarithmic axes require positive values.';overlay.update(plot,[probeA,probeB]);return;}
  if(xmin===xmax){xmin-=.5;xmax+=.5;}if(ymin===ymax){ymin-=.5;ymax+=.5;}
  const area={x:58,y:15,w:Math.max(1,box.width-75),h:Math.max(1,box.height-58)},sx=x=>area.x+(tx(x)-xmin)/(xmax-xmin)*area.w,sy=y=>area.y+area.h-(ty(y)-ymin)/(ymax-ymin)*area.h;
  ctx.font='10px system-ui';for(let i=0;i<=4;i++){const x=area.x+area.w*i/4,y=area.y+area.h*i/4;ctx.strokeStyle=dark?'#405361':'#dce4e9';ctx.beginPath();ctx.moveTo(x,area.y);ctx.lineTo(x,area.y+area.h);ctx.moveTo(area.x,y);ctx.lineTo(area.x+area.w,y);ctx.stroke();ctx.fillStyle=dark?'#dce8ef':'#203544';ctx.textAlign='right';const value=ymax-(ymax-ymin)*i/4;ctx.fillText(format($('yScale').value==='log'?10**value:value),area.x-6,y+3);ctx.textAlign='center';const xv=xmin+(xmax-xmin)*i/4;ctx.fillText(format($('xScale').value==='log'?10**xv:xv),x,area.y+area.h+17);}ctx.fillText(plot.xLabel,area.x+area.w/2,box.height-7);
  for(const series of traces){ctx.strokeStyle=colors[plot.series.indexOf(series)%colors.length];ctx.lineWidth=1.5;ctx.beginPath();let started=false;for(const p of series.points){const x=sx(p.x),y=sy(p.y);if(!Number.isFinite(x)||!Number.isFinite(y)){started=false;continue;}if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);}ctx.stroke();}
  chartMap={sx,sy,area,traces,probe:(px,py)=>{if(px<area.x||px>area.x+area.w||py<area.y||py>area.y+area.h||!selected.has($('probeTrace').value))return null;const axis=xmin+(px-area.x)/area.w*(xmax-xmin);return KiCadAnalysisData.probe(plot,$('xScale').value==='log'?10**axis:axis,undefined,$('probeTrace').value);}};drawProbes(ctx,sx,sy);$('plotLimits').textContent='Saved samples · '+traces.map(s=>s.name+': '+s.points.length).join(' · ');overlay.update(plot,[probeA,probeB]);}
 function drawEMergeGrid(plot,ctx,box){
  const xs=plot.x.map((_,i)=>KiCadAnalysisData.cellBounds(plot.x,i));
  const ys=plot.y.map((_,i)=>KiCadAnalysisData.cellBounds(plot.y,i));
  const xmin=xs[0][0],xmax=xs.at(-1)[1],ymin=ys[0][0],ymax=ys.at(-1)[1];
  const scale=Math.min(Math.max(1,box.width-32)/(xmax-xmin),Math.max(1,box.height-58)/(ymax-ymin));
  if(!Number.isFinite(scale)||scale<=0)return;
  const left=(box.width-(xmax-xmin)*scale)/2,top=(box.height-34-(ymax-ymin)*scale)/2;
  const sx=x=>left+(x-xmin)*scale,sy=y=>top+(ymax-y)*scale;
  let min=Infinity,max=-Infinity;
  for(const row of plot.values)for(const value of row)if(value!==null){min=Math.min(min,value);max=Math.max(max,value);}
  const rectangles=xs.map(([a,b])=>[sx(a),(b-a)*scale]);
  const palette=Array.from({length:241},(_,i)=>'hsl('+(240-i)+',75%,53%)');
  for(let yi=0;yi<ys.length;yi++){
   const [a,b]=ys[yi],y=sy(b),h=(b-a)*scale;
   for(let xi=0;xi<xs.length;xi++){
    const value=plot.values[yi][xi];if(value===null)continue;
    const [x,w]=rectangles[xi];
    ctx.fillStyle=palette[min===max?120:Math.round(240*(value-min)/(max-min))];ctx.fillRect(x,y,w,h);
   }
  }
  ctx.fillStyle=document.body.classList.contains('dark')?'#dce8ef':'#203544';ctx.font='11px system-ui';ctx.textAlign='center';
  ctx.fillText(plot.xLabel+' · '+plot.yLabel,box.width/2,box.height-26);
  ctx.fillText(Number.isFinite(min)?format(min)+' — '+format(max)+' '+plot.unit:'No finite values',box.width/2,box.height-9);
  chartMap={spatial:true,probe:(x,y)=>KiCadAnalysisData.probe(plot,xmin+(x-left)/scale,ymax-(y-top)/scale)};
  drawProbes(ctx,sx,sy);
 }
 function drawSpatial(plot,ctx,box){
  if(plot.type==='heatmap'&&plot.xLabel&&plot.yLabel){drawEMergeGrid(plot,ctx,box);return;}
  let polygons=[],values=[];
  if(plot.type==='heatmap'){
   for(let yi=0;yi<plot.y.length;yi++)for(let xi=0;xi<plot.x.length;xi++){
    const [left,right]=KiCadAnalysisData.cellBounds(plot.x,xi),[top,bottom]=KiCadAnalysisData.cellBounds(plot.y,yi);
    polygons.push([{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}]);values.push(KiCadAnalysisData.numeric(plot.values[yi][xi]));
   }
  }else if(plot.type==='mesh-field'){
   for(let i=0;i<plot.triangles.length;i++){const triangle=plot.triangles[i];polygons.push(triangle.map(n=>({x:plot.points[n][0],y:plot.points[n][1]})));const samples=plot.nodal?triangle.map(n=>KiCadAnalysisData.numeric(plot.values[n])):[KiCadAnalysisData.numeric(plot.values[i])];values.push(samples.every(v=>v!==null)?samples.reduce((a,b)=>a+b,0)/samples.length:null);}
  }else{
   const project=p=>{const x=p[0]*Math.cos(rotation)-p[1]*Math.sin(rotation),y=p[0]*Math.sin(rotation)+p[1]*Math.cos(rotation);return{x,y:y*Math.cos(tilt)-p[2]*Math.sin(tilt)};};
   for(const [index,body]of plot.bodies.entries())for(const face of body.mesh.faces){polygons.push(face.map(i=>project(body.mesh.vertices[i])));values.push(index);}
  }
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity,min=Infinity,max=-Infinity;for(const polygon of polygons)for(const p of polygon){xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);}for(const value of values)if(value!==null){min=Math.min(min,value);max=Math.max(max,value);}if(!polygons.length||!Number.isFinite(xmin))return;
  const scale=Math.min((box.width-40)/Math.max(.001,xmax-xmin),(box.height-55)/Math.max(.001,ymax-ymin)),sx=x=>box.width/2+(x-(xmin+xmax)/2)*scale,sy=y=>box.height/2-10+(y-(ymin+ymax)/2)*scale;
  for(let i=0;i<polygons.length;i++){const polygon=polygons[i],value=values[i];if(value===null)continue;ctx.beginPath();polygon.forEach((p,j)=>j?ctx.lineTo(sx(p.x),sy(p.y)):ctx.moveTo(sx(p.x),sy(p.y)));ctx.closePath();ctx.fillStyle=plot.type==='mechanical'?colors[value%colors.length]:'hsl('+(240-240*(value-min)/Math.max(.000001,max-min))+',75%,53%)';ctx.globalAlpha=plot.type==='mechanical'?.25:1;ctx.fill();if(plot.type==='mechanical'){ctx.globalAlpha=.5;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.5;ctx.stroke();}}ctx.globalAlpha=1;ctx.fillStyle=document.body.classList.contains('dark')?'#dce8ef':'#203544';ctx.font='11px system-ui';ctx.textAlign='center';
  ctx.fillText(plot.type==='mechanical'?'Saved scene · drag to rotate · mm':(Number.isFinite(min)?format(min)+' — '+format(max)+' '+plot.unit:'No finite values'),box.width/2,box.height-12);
  if(plot.type!=='mechanical'){chartMap={spatial:true,probe:(px,py)=>KiCadAnalysisData.probe(plot,(px-box.width/2)/scale+(xmin+xmax)/2,(py-box.height/2+10)/scale+(ymin+ymax)/2)};drawProbes(ctx,sx,sy);}
  $('plotLimits').textContent=plot.type==='mechanical'?'Saved mechanical scene coordinates; findings and coverage are in Report. This preview does not rerun collision checks.':plot.type==='mesh-field'&&plot.nodal?'Triangle color is the mean of saved nodal values; unknown nodes remain gaps.':plot.title.includes('Illustrative')?'Illustrative interpolation from saved junction data; not the physical board field.':'Saved numerical field; missing values remain gaps. Coordinates in mm.';
  if(plot.frames)$('plotLimits').textContent+=' Color range follows the selected frame; compare saved numeric values.';
 }
 $('chart').addEventListener('pointerdown',event=>{const plot=report?.plots[Number($('plot').value)];if(plot?.type!=='mechanical')return;drag={x:event.clientX,y:event.clientY};$('chart').setPointerCapture(event.pointerId);});
 const endDrag=()=>{drag=null;};$('chart').addEventListener('pointerup',endDrag);$('chart').addEventListener('pointercancel',endDrag);
 $('chart').addEventListener('pointermove',event=>{if(drag){rotation+=(event.clientX-drag.x)*.01;tilt=Math.max(-1.5,Math.min(1.5,tilt+(event.clientY-drag.y)*.01));drag={x:event.clientX,y:event.clientY};draw();return;}const point=probeAt(event);$('cursor').textContent=point?describeProbe(point):'';});
 function activateTab(tab){
  for(const node of document.querySelectorAll('nav button'))node.setAttribute('aria-pressed',String(node.dataset.tab===tab));
  for(const name of ['graphs','tables','fields','source'])$(name).hidden=name!==tab;
  if(tab==='fields')renderFields();if(tab==='tables')renderTable();
  if(report){
   $('status').textContent='';
  }
  draw();
 }
 for(const button of document.querySelectorAll('nav button'))button.onclick=()=>activateTab(button.dataset.tab);
 $('file').onchange=()=>{browse.open=false;return load($('file').value);};$('plot').onchange=selectPlot;$('table').onchange=()=>{rowLimit=100;renderTable();};$('moreRows').onclick=()=>{rowLimit+=100;renderTable();};$('search').oninput=()=>{fieldLimit=200;renderFields();};$('xScale').onchange=$('yScale').onchange=draw;
 $('theme').onclick=()=>{plotTheme=currentTheme()==='dark'?'light':'dark';applyTheme(plotTheme);simulation?.setTheme(plotTheme);draw();};
 $('back').onclick=()=>{
  if(nativeEditor)void request('close-analysis-viewer',{file:query.get('file')}).catch(error=>{$('status').textContent=error.message;});
  else if(rootAndroid())window.top.KiCadAndroid.openProject(query.get('file')||'');
  else if(history.length>1)history.back();
  else if(drawing.value)location.assign(drawingURL(drawing.value));
  else window.close();
 };
 function rootAndroid(){try{return Boolean(window.KiCadAndroidRuntime||window.top.KiCadAndroid);}catch{return false;}}
 if(globalThis.KiCadVSCodeContext&&!globalThis.KiCadAndroidRuntime){$('theme').title='Toggle plot theme';$('back').title='Close report';$('back').setAttribute('aria-label','Close report');}
 let chartFrame=null;
 const observer=new ResizeObserver(()=>{
  if(disposed||chartFrame!==null)return;
  chartFrame=requestAnimationFrame(()=>{chartFrame=null;if(!disposed)draw();});
 });
 observer.observe($('chart'));
 const themeObserver=typeof MutationObserver==='function'?new MutationObserver(()=>{if(simulation&&!plotTheme)simulation.setTheme(currentTheme());}):null;
 themeObserver?.observe(document.body,{attributes:true,attributeFilter:['class','data-ui-theme']});
 addEventListener('pagehide',()=>{disposed=true;ticket++;observer.disconnect();if(chartFrame!==null)cancelAnimationFrame(chartFrame);themeObserver?.disconnect();closeSimulation();overlay.dispose();});
 if(!standalone)(async()=>{try{const inventory=await request('project-inventory',{file:query.get('file')});if(disposed)return;resultRevision=inventory.snapshotRef||context.ref;for(const f of inventory.files.filter(f=>/\.kicad_(sch|pcb)$/i.test(f.path)))option(drawing,f.path,f.path);
  const originalDrawing=query.get('drawingFile');
  if([...drawing.options].some(option=>option.value===originalDrawing))drawing.value=originalDrawing;
  else if(drawing.options.length>1){const prompt=make('option','Choose drawing…');prompt.value='';drawing.prepend(prompt);drawing.value='';}
  resultFiles=[...new Set(inventory.files.filter(f=>KiCadAnalysisData.candidate(f.path)).map(f=>f.path))];const path=query.get('file');if(path&&KiCadAnalysisData.candidate(path)&&!resultFiles.includes(path))resultFiles.push(path);filterFiles(path);if(!$('file').value){$('status').textContent='No saved analysis results found.';return;}await load($('file').value);}catch(error){if(!disposed)$('status').textContent=error.message;}})();
})();
