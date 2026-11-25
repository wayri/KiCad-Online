/* Saved waveform links. Never infer connectivity or run simulation commands. */
((root)=>{'use strict';
 function catalogue(report){
  const entries=[];
  for(const [plotIndex,plot]of (report?.plots||[]).entries())for(const [seriesIndex,series]of (plot.series||[]).entries()){
   const signal=series.signal;if(signal?.quantity!=='voltage'||typeof signal.net!=='string'||!signal.net||!series.points?.length)continue;
   entries.push({plot,series,plotIndex,seriesIndex,net:signal.net,sourcePath:signal.sourcePath||null,resultPath:report.path,family:report.family||'other',familyLabel:report.familyLabel||'Saved waveform export'});
  }
  return entries;
 }
 function match(report,selection){
  if(!selection)return [];
  return catalogue(report).filter(entry=>{
   // A qualified name is supplied by the connectivity model, never derived by
   // stripping a filename, adding '/' or searching for a same-named local net.
   if(entry.sourcePath)return entry.sourcePath===selection.sourcePath&&entry.net===selection.netName;
   return typeof selection.qualifiedNetName==='string'&&entry.net===selection.qualifiedNetName;
  });
 }
 const format=value=>Number.isFinite(value)?Number(value.toPrecision(5)).toString():'missing';
 function mount({container=root.document.body,onSelect,onOpen}={}){
  const document=container.ownerDocument,make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const panel=make('section'),heading=make('div'),title=make('strong','Saved simulation'),close=make('button','×'),select=make('select'),canvas=make('canvas'),cursor=make('input'),value=make('output'),source=make('small'),open=make('button','Open full graph');
  panel.className='simulation-result-popover';panel.hidden=true;panel.setAttribute('aria-label','Saved simulation at selected net');panel.setAttribute('role','region');heading.className='simulation-result-heading';close.type=open.type='button';close.setAttribute('aria-label','Close saved simulation');select.setAttribute('aria-label','Saved signal');canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Saved signal plot');cursor.type='range';cursor.min='0';cursor.step='1';cursor.setAttribute('aria-label','Saved sample');value.setAttribute('aria-live','polite');heading.append(title,close);panel.append(heading,select,canvas,cursor,value,source);if(onOpen)panel.append(open);container.append(panel);
  let entries=[],active=null,index=0,anchor={x:0,y:0},disposed=false;
  function position(){const box=panel.getBoundingClientRect(),width=root.innerWidth||document.documentElement.clientWidth,height=root.innerHeight||document.documentElement.clientHeight;panel.style.left=Math.max(8,Math.min(anchor.x+12,width-box.width-8))+'px';panel.style.top=Math.max(8,Math.min(anchor.y+12,height-box.height-8))+'px';}
  function draw(){
   if(!active||disposed||panel.hidden)return;
   const points=active.series.points,rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=130,dpr=Math.min(root.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
   let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
   for(const p of points)if(Number.isFinite(p.x)&&Number.isFinite(p.y)){xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);}
   if(!Number.isFinite(xmin)){value.textContent='No finite saved samples.';return;}
   if(xmin===xmax){xmin-=.5;xmax+=.5;}if(ymin===ymax){ymin-=.5;ymax+=.5;}
   const sx=x=>8+(x-xmin)/(xmax-xmin)*(w-16),sy=y=>8+(ymax-y)/(ymax-ymin)*(h-28);
   ctx.strokeStyle='#229dc8';ctx.lineWidth=1.5;ctx.beginPath();let started=false;for(const p of points){if(!Number.isFinite(p.x)||!Number.isFinite(p.y)){started=false;continue;}if(started)ctx.lineTo(sx(p.x),sy(p.y));else{ctx.moveTo(sx(p.x),sy(p.y));started=true;}}ctx.stroke();
   const p=points[index];if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)){ctx.fillStyle='#e17c38';ctx.beginPath();ctx.arc(sx(p.x),sy(p.y),3.5,0,Math.PI*2);ctx.fill();}
   ctx.fillStyle='#657b89';ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillText(format(xmin),8,h-3);ctx.textAlign='right';ctx.fillText(format(xmax),w-8,h-3);
   value.textContent=p?active.plot.xLabel+': '+format(p.x)+' · '+format(p.y)+(active.series.signal.unit?' '+active.series.signal.unit:'')+' · sample '+(index+1)+'/'+points.length:'';
  }
  function choose(){active=entries[Number(select.value)]||null;if(!active)return;index=0;cursor.max=String(active.series.points.length-1);cursor.value='0';title.textContent=active.familyLabel;source.textContent=active.resultPath+' · '+active.plot.title+' · saved data';draw();onSelect?.(active);position();}
  function hide(){panel.hidden=true;entries=[];active=null;}
  close.onclick=hide;select.onchange=choose;cursor.oninput=()=>{index=Number(cursor.value);draw();};open.onclick=()=>{if(active)onOpen(active);};
  canvas.addEventListener('pointerdown',event=>{if(!active)return;const points=active.series.points,rect=canvas.getBoundingClientRect();let min=Infinity,max=-Infinity;for(const p of points)if(Number.isFinite(p.x)){min=Math.min(min,p.x);max=Math.max(max,p.x);}const x=min+Math.max(0,Math.min(1,(event.clientX-rect.left-8)/(rect.width-16)))*(max-min);let distance=Infinity;for(let i=0;i<points.length;i++){const next=Math.abs(points[i].x-x);if(next<distance){distance=next;index=i;}}cursor.value=String(index);draw();});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();hide();}});
  const resize=()=>{if(!panel.hidden){position();draw();}};root.addEventListener('resize',resize);
  return {move(point){if(disposed||panel.hidden||!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return;anchor=point;position();},show({report,selection,anchor:point}){if(disposed)return [];entries=match(report,selection);if(!entries.length){hide();return [];}anchor=point&&Number.isFinite(point.x)&&Number.isFinite(point.y)?point:{x:8,y:8};title.textContent=selection.qualifiedNetName||selection.netName;select.replaceChildren();entries.forEach((entry,i)=>{const option=make('option',entry.series.name+' · '+entry.plot.title);option.value=String(i);select.append(option);});panel.hidden=false;choose();return entries;},hide,dispose(){disposed=true;root.removeEventListener('resize',resize);panel.remove();entries=[];active=null;}};
 }

 const librarySources=[['kicad','KiCad internal'],['wayricad','WayriCAD'],['other','Other exports']];
 function openLibrary({document,storage,loadInventory,classify,openReport,linkReport,locateSignal,openFastDrop}){
  const make=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
  const button=(text,action)=>{const node=make('button',text);node.type='button';node.onclick=action;return node;};
  const dialog=make('dialog');dialog.className='bom-manager saved-reports-dialog';
  dialog.setAttribute('aria-label','Simulation results');
  const heading=make('header');heading.className='bom-manager-heading';
  heading.append(make('h2','Simulation results'),button('Close',()=>dialog.close()));
  const body=make('section'),tools=make('div'),sources=make('nav'),layout=make('div');
  body.className='saved-reports-content';tools.className='saved-reports-tools';
  sources.className='saved-report-segments';sources.setAttribute('aria-label','Result source');
  layout.className='saved-report-segments';layout.setAttribute('role','group');layout.setAttribute('aria-label','Results layout');
  const search=make('input');search.type='search';search.placeholder='Find a workbook or result';search.setAttribute('aria-label','Find saved result');
  const status=make('p');status.className='saved-report-status';status.setAttribute('role','status');
  const list=make('div');list.className='saved-report-list';
  let source='all',view='list',inventory=null,entries=[],disposed=false,opening=false,linkTicket=0,loadError='',linkedResult=null;
  const storageKey='kicad:simulation-results-layout';
  try{if(storage?.getItem(storageKey)==='cards')view='cards';}catch{}
  const sourceControls=new Map(),layoutControls=new Map();
  const visibleEntries=()=>{const query=search.value.trim().toLowerCase();return entries.filter(entry=>entry.path.toLowerCase().includes(query));};
  async function open(entry,control,resultView){
   if(opening||disposed)return;
   opening=true;control.disabled=true;
   try{await openReport(entry.path,inventory.snapshotRef,resultView);if(!disposed)dialog.close();}
   catch(error){if(!disposed)status.textContent=error.message;}
   finally{opening=false;control.disabled=false;}
  }
  function openOnlyWorkbook(){
   if(source!=='kicad'||!inventory)return;
   const books=visibleEntries().filter(entry=>entry.workbook);
   if(books.length===1)void open(books[0],sourceControls.get('kicad'));
  }
  for(const [id,label]of [['all','All'],...librarySources]){
   const control=button(label,()=>{
    source=id;render();
    openOnlyWorkbook();
   });
   sourceControls.set(id,control);sources.append(control);
  }
  for(const [id,label]of [['list','List'],['cards','Cards']]){
   const control=button(label,()=>{view=id;try{storage?.setItem(storageKey,id);}catch{}render();});
   layoutControls.set(id,control);layout.append(control);
  }
  tools.append(search,layout);
  if(openFastDrop)tools.append(button('Fast DC drop',()=>{dialog.close();openFastDrop();}));
  body.append(sources,tools,status,list);dialog.append(heading,body);
  function row(entry,focusSignal){
   const result=make('article');result.className='saved-report-entry';
   const slash=entry.path.lastIndexOf('/'),name=entry.path.slice(slash+1),folder=entry.path.slice(0,Math.max(0,slash));
   const title=button('',()=>open(entry,title));title.className='saved-report-open';title.title=entry.path;
   title.append(make('strong',name));if(folder)title.append(make('small',folder));
   result.append(title);
   const actions=make('div');actions.className='saved-report-actions';
   if(entry.family==='wayricad'&&/\.json$/i.test(entry.path)){
    for(const mode of ['2d','3d']){
     const control=button(mode.toUpperCase()+' + probe',()=>open(entry,control,mode));
     control.className='quiet-button';actions.append(control);
    }
   }
   if(linkReport&&/\.(csv|tsv|raw|json)$/i.test(entry.path)){
    const linked=make('div');linked.className='saved-report-link';
    const control=button('Link net plots',async()=>{
     const ticket=++linkTicket;control.disabled=true;status.textContent='Loading saved samples…';
     try{
      const signals=await linkReport(entry.path,inventory.snapshotRef);
      if(disposed||ticket!==linkTicket||!signals)return;
      linkedResult={path:entry.path,signals};render(entry.path);
      status.textContent='Select a signal or close this view and select its net.';
     }catch(error){if(!disposed&&ticket===linkTicket)status.textContent=error.message;}
     finally{control.disabled=false;}
    });
    control.className='quiet-button';
    if(/\.json$/i.test(entry.path)){
     const more=make('details');more.append(make('summary','Net plots'),control);actions.append(more);
    }else actions.append(control);
    result.append(actions,linked);
    if(linkedResult?.path===entry.path){
     const {signals}=linkedResult;
     const select=make('select');select.setAttribute('aria-label','Saved waveform signal');
     const prompt=make('option','Select a saved voltage signal…');prompt.value='';select.append(prompt);
     signals.slice(0,2000).forEach((signal,index)=>{const option=make('option',signal.series.name+' · '+signal.plot.title);option.value=String(index);select.append(option);});
     select.onchange=()=>{if(select.value!==''){locateSignal(signals[Number(select.value)]);dialog.close();}};
     linked.append(select);
     if(focusSignal===entry.path)queueMicrotask(()=>select.focus());
    }
   }else if(actions.children.length)result.append(actions);
   return result;
  }
  function render(focusSignal){
   for(const [id,control]of sourceControls)control.setAttribute('aria-pressed',String(id===source));
   for(const [id,control]of layoutControls)control.setAttribute('aria-pressed',String(id===view));
   list.setAttribute('data-layout',view);list.replaceChildren();
   if(!inventory){status.textContent=loadError||'Finding saved results…';return;}
   const matching=visibleEntries();
   let count=0;
   for(const [id,label]of librarySources){
    if(source!=='all'&&source!==id)continue;
    const items=matching.filter(entry=>entry.family===id);
    if(!items.length)continue;
    const section=make('section'),cards=make('div');cards.className='saved-report-items';
    section.append(make('h3',label),cards);list.append(section);
    for(const entry of items.slice(0,100))cards.append(row(entry,focusSignal));
    if(items.length>100)section.append(make('p','Showing 100 results. Search to narrow the list.'));
    count+=items.length;
   }
   status.textContent=count?count+' saved result'+(count===1?'':'s'):search.value.trim()?'No matching results.':'No saved results in this section.';
   if(inventory.truncated)status.textContent+=' · Partial project listing';
  }
  search.oninput=render;
  dialog.addEventListener('click',event=>{
   if(event.target!==dialog)return;
   const box=dialog.getBoundingClientRect();
   if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
  });
  dialog.addEventListener('close',()=>{disposed=true;dialog.remove();},{once:true});
  document.body.append(dialog);dialog.showModal();render();
  Promise.resolve().then(loadInventory).then(result=>{
   if(disposed)return;
   inventory=result;
   const paths=[...new Set((result.files||[]).map(file=>file.path).filter(path=>typeof path==='string'&&(/\.(json|csv|tsv|wbk|raw|html?)$/i.test(path)||/\.txt$/i.test(path)&&/(report|analysis|sim|thermal|mechanic)/i.test(path))))];
   entries=paths.map(path=>({path,family:classify(path),workbook:/\.wbk$/i.test(path)}))
    .sort((a,b)=>Number(b.workbook)-Number(a.workbook)||a.path.localeCompare(b.path));
   render();openOnlyWorkbook();
  }).catch(error=>{if(!disposed){loadError=error.message;render();}});
  return dialog;
 }
 const API={catalogue,match,mount,openLibrary};root.KiCadSimulationResults=API;if(typeof module==='object'&&module.exports)module.exports=API;
})(globalThis);
