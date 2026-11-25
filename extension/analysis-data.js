/* Inert saved analysis readers. Never execute reports or run a simulation. */
((root)=>{
 'use strict';
 const MAX_BYTES=64*1024*1024,MAX_ROWS=200000,MAX_FIELDS=4000,MAX_CELLS=4000000;
 const candidate=path=>/\.(wbk|raw|csv|tsv|html?|json|txt)$/i.test(path);
 const familyLabels={kicad:'KiCad / SPICE simulation',wayricad:'wayriCAD analysis',other:'Other / unclassified exports'};
 // Classification is a presentation hint, never proof of producer or source identity.
 // Only source hashes and saved coordinate bindings authorize PCB overlay placement.
 function family(path,report){
  const source=report?.savedSource;
  if(source&&typeof source==='object'&&!Array.isArray(source)){
   const producer=['schema','generator','tool'].map(key=>typeof source[key]==='string'?source[key].slice(0,512):'').join(' ');
   if(/(?:wayricad|quick[_. -]?(?:pi|si|therm)|mechanical[_. -]?check)/i.test(producer)||source.quick_therm||source.thermal_network||source.mesh?.triangles&&Array.isArray(source.result?.potential_V))return 'wayricad';
  }
  if(/\.(wbk|raw)$/i.test(path))return 'kicad';
  if(/\.pocket-kivi\.json$/i.test(path))return 'wayricad';
  if(/(?:^|[/_. -])(?:wayricad|quick[_. -]?(?:pi|si|therm)|mechanical[_. -]?check)(?:[/_. -]|$)/i.test(path))return 'wayricad';
  // CSV alone cannot identify its producer; a user can open it explicitly.
  return 'other';
 }
 const numeric=value=>typeof value==='number'?Number.isFinite(value)?value:null:typeof value==='string'&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())?(Number.isFinite(Number(value))?Number(value):null):null;
 function delimited(text,separator){
  const rows=[];let row=[],value='',quoted=false,cells=0;
  // Bound allocation as fields arrive, before malformed or empty rows can grow.
  // Permit KiCad's one trailing empty field in addition to 256 data columns.
  const field=()=>{if(row.length>=257||row.length===256&&value!=='')throw Error('Too many data columns.');if(++cells>MAX_CELLS)throw Error('Too many CSV cells; split the exported data.');row.push(value);value='';};
  const finish=()=>{field();if(row.some(v=>v.trim())){if(rows.length>=MAX_ROWS)throw Error('Too many data rows; split this export into smaller files.');rows.push(row);}row=[];};
  for(let i=0;i<text.length;i++){
   const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
   else if(c===separator&&!quoted){field();}
   else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;finish();}
   else value+=c;
  }
  if(quoted)throw Error('Incomplete quoted CSV field.');if(value||row.length)finish();return rows;
 }
 function tablePlot(table,limit=64){
  const numericColumns=table.columns.map((_,i)=>i).filter(i=>table.rows.some(row=>numeric(row[i])!==null));
  if(numericColumns.length<2)return null;const xIndex=numericColumns[0];
  const series=numericColumns.slice(1,limit+1).map(i=>({name:table.columns[i],points:table.rows.map(row=>({x:numeric(row[xIndex]),y:numeric(row[i])})).filter(p=>p.x!==null).map(p=>({...p,y:p.y===null?NaN:p.y}))})).filter(s=>s.points.length);
  return series.length?{title:table.title,xLabel:table.columns[xIndex],series}:null;
 }
 function csv(text,path){
  const head=text.split(/\r?\n/,1)[0],separator=/\.tsv$/i.test(path)?'\t':head.includes(';')?';':head.includes('\t')?'\t':',';
  const rows=delimited(text,separator);if(!rows.length)throw Error('The data file is empty.');
  // KiCad writes a trailing semicolon; remove only that entirely empty column.
  while(rows[0].length>1&&rows.every(row=>row.at(-1)===''))for(const row of rows)row.pop();
  const header=rows.shift().map((s,i)=>s.trim()||'Column '+(i+1));if(header.length>256)throw Error('Too many data columns.');
  if(rows.some(row=>row.length!==header.length))throw Error('CSV rows have different column counts.');if(rows.length*header.length>4000000)throw Error('Too many CSV cells; split the exported data.');
  const table={title:path.split('/').at(-1),columns:header,rows},plot=tablePlot(table,256);
  if(plot)for(const series of plot.series)series.signal=signalMetadata(series.name);
  return {kind:'Simulation / tabular data',tables:[table],plots:plot?[plot]:[],fields:[],warnings:plot?[]:['No pair of numeric columns was found for a graph.']};
 }
 function savedPlots(value){
  const plots=[];let visited=0;
  const waveform=(title,axis,rows,xLabel)=>{if(plots.length>=64||!Array.isArray(axis)||axis.length>MAX_ROWS||!axis.length)return;const series=rows.slice(0,title==='Illustrative eye diagram'?512:64).filter(row=>Array.isArray(row.values)&&row.values.length===axis.length).map(row=>({name:row.name,points:axis.map((x,i)=>({x:numeric(x),y:numeric(row.values[i])})).filter(p=>p.x!==null).map(p=>({...p,y:p.y===null?NaN:p.y}))}));if(series.length)plots.push({title,xLabel,series});};
  const walk=(item,key,depth)=>{
   if(!item||typeof item!=='object'||depth>18||++visited>12000||plots.length>=64)return;
   if(Array.isArray(item)){for(const child of item.slice(0,100))if(child&&typeof child==='object'&&!Array.isArray(child))walk(child,key,depth+1);return;}
   if(Array.isArray(item.times_s)){
    waveform(key||'Transient',item.times_s,Object.entries(item).filter(([name,v])=>Array.isArray(v)&&/_V$|_A$/.test(name)).map(([name,values])=>({name,values})),'Time (s)');
    for(const child of [...(Array.isArray(item.loads)?item.loads:[]),...(Array.isArray(item.components)?item.components:[]),...(Array.isArray(item.thermal_nodes)?item.thermal_nodes:[])])if(child&&typeof child==='object')waveform((key||'Transient')+' · '+(child.reference||child.name||child.label||child.id||'component'),item.times_s,Object.entries(child).filter(([name,v])=>Array.isArray(v)&&/_V$|_A$|temperature_c|power_W/.test(name)).map(([name,values])=>({name,values})),'Time (s)');
   }
   if(Array.isArray(item.history)&&item.history.length&&item.history.length<=MAX_ROWS&&item.history.some(row=>numeric(row?.time_s)!==null)){
    const history=item.history,axis=history.map(row=>row?.time_s),boards=[...new Set(history.flatMap(row=>Array.isArray(row?.boards)?row.boards.map((b,i)=>b?.name??String(i)):[]))].slice(0,32);
    for(const name of boards){if(plots.length>=64)break;
     const rows=history.map(row=>(Array.isArray(row?.boards)?row.boards:[]).find((b,i)=>(b?.name??String(i))===name));
     const refs=[...new Set(rows.flatMap(row=>row?.temperatures_c&&typeof row.temperatures_c==='object'?Object.keys(row.temperatures_c):[]))].slice(0,60);
     waveform('Saved thermal transient · '+name,axis,[...refs.map(ref=>({name:ref+' (°C)',values:rows.map(row=>row?.temperatures_c?.[ref])})),...['inlet_air_c','outlet_air_c'].filter(field=>rows.some(row=>numeric(row?.[field])!==null)).map(field=>({name:field+' (°C)',values:rows.map(row=>row?.[field])}))],'Time (s)');
     const power=['power_w','air_heat_w','fixture_heat_w','stored_heat_w','energy_residual_w'].filter(field=>rows.some(row=>numeric(row?.[field])!==null));
     if(power.length&&plots.length<64)waveform('Saved thermal power · '+name,axis,power.map(field=>({name:field+' (W)',values:rows.map(row=>row?.[field])})),'Time (s)');
    }
   }
   const spatial=item.spatial_index,frames=item.frames;
   if(spatial&&Array.isArray(frames)&&frames.length&&frames.length<=MAX_ROWS&&Array.isArray(spatial.x_centers_mm)&&Array.isArray(spatial.y_centers_mm)&&Array.isArray(spatial.cells)&&Array.isArray(spatial.layers)){
    const x=spatial.x_centers_mm.map(numeric),y=spatial.y_centers_mm.map(numeric),cells=spatial.cells,layers=spatial.layers;
    const valid=x.length&&y.length&&x.length*y.length<=1000000&&x.every(v=>v!==null)&&y.every(v=>v!==null)&&cells.length&&cells.length<=1000000&&layers.length&&layers.length<=64&&spatial.active_cells_per_layer===cells.length&&cells.every(c=>Array.isArray(c)&&c.length===2&&c.every(Number.isSafeInteger)&&c[0]>=0&&c[0]<x.length&&c[1]>=0&&c[1]<y.length)&&new Set(cells.map(c=>c.join(','))).size===cells.length&&frames.every(f=>numeric(f?.time_s)!==null&&Array.isArray(f.temperatures_c)&&f.temperatures_c.length>=cells.length*layers.length);
    if(valid&&x.length*y.length*layers.length<=1000000)for(let layerIndex=0;layerIndex<layers.length&&plots.length<64;layerIndex++){
     const plot={type:'heatmap',title:'Saved thermal transient field · '+(layers[layerIndex]?.name||layers[layerIndex]?.id||layerIndex),x,y,cells,frames,layerIndex,frameIndex:frames.length-1,unit:'°C',layerName:layers[layerIndex]?.name,layerZmm:numeric(layers[layerIndex]?.z_mm),zBasis:'front-depth'};
     plot.values=frameValues(plot,plot.frameIndex);plots.push(plot);
    }
   }
   if(Array.isArray(item.time_ui)&&Array.isArray(item.traces_v))waveform('Illustrative eye diagram',item.time_ui,item.traces_v.slice(0,512).map((values,i)=>({name:'Trace '+(i+1)+' (V)',values})),'Time (UI)');
   if(Array.isArray(item.time_ns)&&Array.isArray(item.voltage_v))waveform('Saved step response',item.time_ns,[{name:'Voltage (V)',values:item.voltage_v}],'Time (ns)');
   if(Array.isArray(item.segments)&&key.endsWith('path')){
    let distance=0;const extracted=[],screening=[];for(const section of item.segments){const length=numeric(section?.length_mm);if(length===null||length<0){extracted.push({x:distance,y:NaN});screening.push({x:distance,y:NaN});continue;}const x=distance+length/2;extracted.push({x,y:numeric(section.impedance_ohm)??NaN});screening.push({x,y:numeric(section.screening_z0_ohm)??NaN});distance+=length;}
    if(extracted.length)plots.push({title:'Saved route impedance',xLabel:'Distance along path (mm)',series:[{name:'Reference-covered impedance (Ω)',points:extracted},{name:'Ideal continuous-plane screening (Ω)',points:screening}]});
   }
   if(Array.isArray(item.x_centers_mm)&&Array.isArray(item.y_centers_mm)&&Array.isArray(item.values_c)){
    const x=item.x_centers_mm.map(numeric),y=item.y_centers_mm.map(numeric),values=item.values_c.map(row=>Array.isArray(row)?row.map(numeric):row);
    if(x.length&&y.length&&x.length*y.length<=1000000&&x.every(v=>numeric(v)!==null)&&y.every(v=>numeric(v)!==null)&&values.length===y.length&&values.every(row=>Array.isArray(row)&&row.length===x.length))plots.push({type:'heatmap',title:key.includes('board_thermal_view')?'Illustrative junction interpolation'+(key.endsWith('.top')?' · top':key.endsWith('.bottom')?' · bottom':''):'Saved board temperature field',x,y,values,unit:'°C',label:key});
   }
   for(const name of ['rows','samples'])if(Array.isArray(item[name])&&item[name].length){const rows=item[name].filter(row=>row&&typeof row==='object'&&!Array.isArray(row)),axis=['frequency_mhz','frequency_Hz','time_s'].find(k=>rows.some(row=>numeric(row?.[k])!==null));if(axis){const names=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(k=>k!==axis&&rows.some(row=>numeric(row?.[k])!==null));waveform(key,rows.map(row=>row[axis]),names.slice(0,32).map(name=>({name,values:rows.map(row=>row[name])})),axis);}}
   for(const [name,child]of Object.entries(item))if(!['values_c','points_mm','triangles','vertices','faces','traces_v','frames','spatial_index','history'].includes(name))walk(child,key?key+'.'+name:name,depth+1);
  };walk(value,'',0);
  const mesh=value?.mesh,result=value?.result;
  if(Array.isArray(mesh?.points_mm)&&Array.isArray(mesh?.triangles)&&mesh.points_mm.length<=200000&&mesh.triangles.length<=200000&&mesh.points_mm.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(v=>numeric(v)!==null))&&mesh.triangles.every(t=>Array.isArray(t)&&t.length===3&&t.every(i=>Number.isSafeInteger(i)&&i>=0&&i<mesh.points_mm.length))){
   const add=(title,values,nodal,unit)=>{
     if(!Array.isArray(values)||values.length!==(nodal?mesh.points_mm.length:mesh.triangles.length))return;
     const layers=Array.isArray(mesh.triangle_layer)&&mesh.triangle_layer.length===mesh.triangles.length?[...new Set(mesh.triangle_layer.map(String))].slice(0,64):[null];
     for(const layer of layers){if(plots.length>=64)break;const indices=mesh.triangles.map((_,i)=>i).filter(i=>layer===null||String(mesh.triangle_layer[i])===layer);
      const label=(Array.isArray(value.geometry?.layers)?value.geometry.layers:[]).find(l=>String(l?.id)===layer)?.name||layer;
      plots.push({type:'mesh-field',title:title+(label?' · '+label:''),points:mesh.points_mm.map(p=>p.map(numeric)),triangles:indices.map(i=>mesh.triangles[i]),values:nodal?values:indices.map(i=>values[i]),nodal,unit,layerName:label,zBasis:typeof value.geometry?.z_convention==='string'&&value.geometry.z_convention.includes('positive Z down from the top copper surface')?'front-depth':undefined});}
    };
   add('Saved nodal potential',result?.potential_V,true,'V');add('Saved cell power',result?.cell_power_W,false,'W');
   if(Array.isArray(result?.cell_J_A_mm2))add('Saved current density magnitude',result.cell_J_A_mm2.map(v=>Array.isArray(v)&&v.every(n=>numeric(n)!==null)?Math.hypot(...v):null),false,'A/mm²');
  }
  const bodies=value?.bodies;if(Array.isArray(bodies)){const valid=bodies.filter(b=>Array.isArray(b?.mesh?.vertices)&&Array.isArray(b.mesh?.faces)&&b.mesh.vertices.length<=200000&&b.mesh.faces.length<=100000&&b.mesh.vertices.every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>numeric(n)!==null))&&b.mesh.faces.every(f=>Array.isArray(f)&&f.length===3&&f.every(i=>Number.isSafeInteger(i)&&i>=0&&i<b.mesh.vertices.length)));if(valid.length)plots.push({type:'mechanical',title:'Saved mechanical meshes',bodies:valid.slice(0,100).map(b=>({...b,mesh:{...b.mesh,vertices:b.mesh.vertices.map(v=>v.map(numeric))}})),unit:'mm'});}
  return plots;
 }
 // Explicit Monkey a0 export contracts, projected without traversing render graphs/indexes.
 function monkeyReport(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.schema!=='string'||!/^kicad_monkey\.(design|netlist)\./.test(value.schema))return null;
  if(!['kicad_monkey.design.a0','kicad_monkey.netlist.a0'].includes(value.schema))throw Error('Unsupported KiCad Monkey export schema: '+value.schema.slice(0,100));
  const fail=()=>{throw Error('Invalid KiCad Monkey a0 report. Expected saved components, nets and terminals.');};
  const record=item=>item&&typeof item==='object'&&!Array.isArray(item);
  const text=(item,key,required=false)=>{const v=item[key];if(v===undefined&&!required)return '';if(typeof v!=='string'||v.length>16384||required&&!v)fail();return v;};
  if(value.generator!=='kicad_monkey'||!Array.isArray(value.components)||!Array.isArray(value.nets))fail();
  if(value.components.length>20000||value.nets.length>20000)throw Error('KiCad Monkey report exceeds 20,000 components or nets. Split the export.');
  let rows=0;const reserve=()=>{if(++rows>MAX_ROWS)throw Error('KiCad Monkey report exceeds 200,000 table rows. Split the export.');};
  const components={title:'Components',columns:['Designator','Value','Footprint','Library reference','Description','Sheet'],rows:[]};
  const parameters={title:'Component properties',columns:['Designator','Property','Value'],rows:[]};
  for(const item of value.components){
   if(!record(item))fail();const ref=text(item,'designator',true);reserve();
   if(item.hierarchy!==undefined&&!record(item.hierarchy))fail();
   components.rows.push([ref,text(item,'value'),text(item,'footprint'),text(item,'library_ref'),text(item,'description'),item.hierarchy?text(item.hierarchy,'sheet_path'):'']);
   if(item.parameters!==undefined){if(!record(item.parameters))fail();for(const key of Object.keys(item.parameters)){reserve();if(key.length>16384)fail();parameters.rows.push([ref,key,text(item.parameters,key)]);}}
  }
  const nets={title:'Nets',columns:['Name','Net class','Source sheets','Terminal count'],rows:[]};
  const terminals={title:'Net terminals',columns:['Net','Designator','Pin','Pin name','Pin type'],rows:[]};
  for(const item of value.nets){
   if(!record(item)||!Array.isArray(item.terminals))fail();const name=text(item,'name');reserve();
   if(item.terminals.length>MAX_ROWS-rows)throw Error('KiCad Monkey report exceeds 200,000 table rows. Split the export.');
   let sheets='';if(item.source_sheets!==undefined){if(!Array.isArray(item.source_sheets)||item.source_sheets.length>1000||item.source_sheets.some(s=>typeof s!=='string'||s.length>16384))fail();sheets=item.source_sheets.join(' · ');if(sheets.length>16384)throw Error('KiCad Monkey net sheet list exceeds the display budget.');}
   nets.rows.push([name,text(item,'net_class'),sheets,item.terminals.length]);
   for(const terminal of item.terminals){reserve();if(!record(terminal))fail();terminals.rows.push([name,text(terminal,'designator',true),text(terminal,'pin',true),text(terminal,'pin_name'),text(terminal,'pin_type')]);}
  }
  return {kind:'KiCad Monkey saved '+(value.schema.includes('.design.')?'design':'netlist'),tables:[components,nets,terminals,parameters].filter(table=>table.rows.length),plots:[],fields:[{path:'Export schema',value:value.schema},{path:'Generator',value:value.generator},{path:'Components',value:value.components.length},{path:'Nets',value:value.nets.length}],warnings:['Saved KiCad Monkey a0 export; connectivity is reported as supplied, not recomputed or validated against this project. Render graphs, indexes and SVG are not executed or imported.'],savedSource:value};
 }
 function json(value,path){
  const monkey=monkeyReport(value);if(monkey)return monkey;
  const result={kind:/\.wbk$/i.test(path)?'KiCad simulation workbook':'Saved analysis report',tables:[],plots:[],fields:[],warnings:[]};let nodes=0,cells=0;
  const visit=(item,key,depth)=>{
   if(++nodes>MAX_FIELDS||depth>32)return;
   if(item===null||typeof item!=='object'){result.fields.push({path:key,value:item});return;}
   if(Array.isArray(item)){
    if(item.length>MAX_ROWS)throw Error('Too many analysis rows.');
    if(item.length&&item.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){
     const columns=[...new Set(item.slice(0,100).flatMap(row=>Object.keys(row).filter(k=>row[k]===null||typeof row[k]!=='object')))].slice(0,128);
     if(columns.length){if((cells+=columns.length*item.length)>MAX_CELLS)throw Error('Too many analysis table cells; split this export into smaller files.');const table={title:key,columns,rows:item.map(row=>columns.map(k=>row[k]??''))};result.tables.push(table);}
    }
    for(let i=0;i<Math.min(item.length,100);i++)visit(item[i],key+'['+i+']',depth+1);return;
   }
   // Plot only explicit axes or point coordinates; don't invent physical axes.
    const x=item.x||item.frequency_hz||item.time_s,y=item.y||item.values;
   if(Array.isArray(x)&&Array.isArray(y)&&x.length===y.length&&x.length&&x.every(v=>numeric(v)!==null)&&y.every(v=>numeric(v)!==null)){
    result.plots.push({title:key,xLabel:item.x_label||item.xLabel||(item.frequency_hz?'Frequency (Hz)':item.time_s?'Time (s)':'x'),series:[{name:item.name||item.y_label||item.yLabel||key,points:x.map((v,i)=>({x:numeric(v),y:numeric(y[i])}))}]});
   }
   for(const [name,child]of Object.entries(item).sort(([a],[b])=>(/schema|sha|source|status|coverage|findings|checks|assumptions|limit|warning/.test(a)?-1:/mesh|values|samples|points|traces|bodies|field/.test(a)?1:0)-(/schema|sha|source|status|coverage|findings|checks|assumptions|limit|warning/.test(b)?-1:/mesh|values|samples|points|traces|bodies|field/.test(b)?1:0)))visit(child,key?key+'.'+name:name,depth+1);
  };result.savedSource=value;result.plots=savedPlots(value);visit(value,'',0);
  if(nodes>MAX_FIELDS)result.warnings.push('Property preview limited to '+MAX_FIELDS+' fields; full source remains available.');
  if(/\.wbk$/i.test(path)){result.plots=[];result.warnings.push('This workbook stores simulation commands, signals and display settings, not waveform samples. Add a KiCad CSV export or saved SPICE raw data to view graphs.');}
  return result;
 }
 // Keep the source spelling: case folding or stripping sheet paths can bind
 // equal local names from unrelated sheets. Expressions are not single nets.
 function signalMetadata(name,type){
  const voltage=/^v\(([^(),]+)\)(\d+)?$/i.exec(name),current=/^i\(([^(),]+)\)$/i.exec(name);
  if(voltage&&(!type||type==='voltage'))return {expression:name,quantity:'voltage',unit:'V',net:voltage[1],...(voltage[2]?{run:voltage[2]}:{})};
  if(current&&(!type||type==='current'))return {expression:name,quantity:'current',unit:'A',device:current[1]};
  if(type==='voltage'&&!/[(),\s]/.test(name))return {expression:name,quantity:type,unit:'V',net:name};
  return {expression:name,quantity:type||null,unit:({time:'s',frequency:'Hz',current:'A',voltage:'V'})[type]||null};
 }
 function* nonemptyLines(text,start=0,end=text.length){
  while(start<end){let next=text.indexOf('\n',start);if(next<0||next>end)next=end;const line=text.slice(start,next).trim();start=next+1;if(line)yield line;}
 }
 function raw(text){
  if(/(?:^|\n)Binary:/i.test(text))throw Error('Binary SPICE raw data is not supported. Export ASCII raw data or KiCad CSV.');
  const variableStart=text.search(/^Variables:[ \t]*\r?$/im),valuesStart=text.search(/^Values:[ \t]*\r?$/im);
  if(variableStart<0||valuesStart<=variableStart)throw Error('Expected an ASCII SPICE raw file with Variables and Values sections.');
  if(variableStart>1024*1024||valuesStart-variableStart>1024*1024)throw Error('SPICE header exceeds the 1 MiB metadata budget.');
  const header=text.slice(0,variableStart),field=name=>{const matches=[...header.matchAll(new RegExp('^'+name+':[ \\t]*(.*)\\r?$','gim'))];if(matches.length!==1)throw Error('Missing or duplicate SPICE '+name+' header.');return matches[0][1].trim();};
  const dimensions=[field('No\\. Variables'),field('No\\. Points')];
  const count=Number(dimensions[0]),points=Number(dimensions[1]),flags=field('Flags').toLowerCase().split(/\s+/),complex=flags.includes('complex');
  if(flags.length!==1||!['real','complex'].includes(flags[0]))throw Error('Unsupported SPICE flags; export one padded real or complex plot.');
  if(!dimensions.every(v=>/^\d+$/.test(v))||!count||count>256||!Number.isSafeInteger(points)||points<1||points>MAX_ROWS||points*count*(complex?2:1)>MAX_CELLS)throw Error('Invalid or excessive SPICE dimensions.');
  const variables=[];for(const line of nonemptyLines(text,text.indexOf('\n',variableStart)+1,valuesStart)){const m=line.match(/^(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);if(variables.length>=count||!m||Number(m[1])!==variables.length)throw Error('Invalid SPICE variable declaration or index.');if(/\bdims=/.test(m[4]||''))throw Error('Variable-specific SPICE dimensions are not supported.');variables.push({name:m[2],unit:m[3],attributes:m[4]||'',signal:signalMetadata(m[2],m[3])});}
  if(count!==variables.length||new Set(variables.map(v=>v.name)).size!==count)throw Error('Invalid or duplicate SPICE variables.');
  const lines=nonemptyLines(text,text.indexOf('\n',valuesStart)+1);
  const rows=[];for(let p=0;p<points;p++){const row=[];for(let v=0;v<count;v++){
   const next=lines.next();if(next.done)throw Error('Incomplete SPICE raw samples.');let value=next.value;if(v===0){const m=value.match(/^(\d+)\s+(.*)$/);if(!m||Number(m[1])!==p)throw Error('Invalid SPICE sample index.');value=m[2];}
   const pair=value.split(',').map(numeric);if(pair.some(n=>n===null)||pair.length!==(complex?2:1))throw Error('Invalid SPICE sample value.');if(v===0&&complex&&pair[1]!==0)throw Error('Complex SPICE sweep axes are not supported; their imaginary values cannot be discarded.');if(v===0)row.push(pair[0]);else row.push(...pair);
  }rows.push(row);}
  if(!lines.next().done)throw Error('Incomplete SPICE raw samples or trailing concatenated plots.');
  const columns=[variables[0].name+' ('+variables[0].unit+')',...variables.slice(1).flatMap(v=>complex?[v.name+' real ('+v.unit+')',v.name+' imaginary ('+v.unit+')']:[v.name+' ('+v.unit+')'])];
  const table={title:'SPICE waveform samples',columns,rows},series=[];
  // All declared variables remain available; tablePlot's generic preview limit
  // is inappropriate for explicitly named simulator signals.
  for(let v=1;v<count;v++)for(let part=0;part<(complex?2:1);part++){const column=1+(v-1)*(complex?2:1)+part;series.push({name:columns[column],signal:{...variables[v].signal,component:complex?part?'imaginary':'real':'real'},points:rows.map(row=>({x:row[0],y:row[column]}))});}
  const fields=[];for(const line of nonemptyLines(header)){if(fields.length>=MAX_FIELDS)throw Error('Too many SPICE metadata fields.');const colon=line.indexOf(':');fields.push({path:colon<0?'Header':line.slice(0,colon),value:colon<0?line:line.slice(colon+1).trim()});}
  return{kind:'ASCII SPICE simulation',tables:[table],plots:series.length?[{title:fields.find(f=>f.path.toLowerCase()==='plotname')?.value||table.title,xLabel:columns[0],series}]:[],fields,warnings:complex?['Complex traces are displayed as real and imaginary components in their saved units.']:[]};
 }
 function uncomment(text){let output='',quoted=false,escaped=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){output+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;output+=c;}else if(c==='/'&&text[i+1]==='/'){while(i<text.length&&text[i]!=='\n')i++;output+='\n';}else if(c==='/'&&text[i+1]==='*'){const end=text.indexOf('*/',i+2);if(end<0)throw Error('Incomplete workbook comment.');i=end+1;output+=' ';}else output+=c;}return output;}
 function workbook(text){
  if(text.trimStart().startsWith('{'))return JSON.parse(uncomment(text));
  const lines=text.replace(/\r/g,'').split('\n');let cursor=0;const line=()=>{if(cursor>=lines.length)throw Error('Incomplete legacy KiCad workbook.');return lines[cursor++];},count=()=>{const n=Number(line());if(!Number.isInteger(n)||n<0||n>10000)throw Error('Invalid legacy workbook count.');return n;};
  let version=1;if(/^version\s+\d+$/i.test(lines[0]))version=Number(line().split(/\s+/)[1]);if(version<1||version>5)throw Error('Unsupported legacy workbook version.');
  const tabs=[];for(let i=0,n=count();i<n;i++){const tab={simulation_type:count(),command:line(),traces:[],measurements:[]};for(let t=0,n=count();t<n;t++)tab.traces.push({trace_type:count(),signal:line(),parameters:line()});if(version>4)for(let m=0,n=count();m<n;m++)tab.measurements.push({expression:line(),format:line()});tabs.push(tab);}
  const user_defined_signals=[];if(cursor<lines.length&&lines[cursor].trim())for(let i=0,n=count();i<n;i++)user_defined_signals.push(line());const last_sch_text_sim_command=version>=5&&cursor<lines.length?line():'';return{version,tabs,user_defined_signals,last_sch_text_sim_command};
 }
 // Read saved HTML as bounded data tokens. No DOM parser, resource fetch,
 // executable attributes, or HTML insertion is involved, including malformed input.
 function htmlReport(source){
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',deg:'°',micro:'µ',Omega:'Ω'};
  const decode=value=>value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/gi,(whole,key)=>{
   if(key[0]!=='#')return Object.hasOwn(entities,key)?entities[key]:whole;
   const code=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
   return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'\ufffd';
  });
  let cursor=0;
  function nextToken(){
   if(source[cursor]!=='<'){const end=source.indexOf('<',cursor),stop=end<0?source.length:end;const value=source.slice(cursor,stop);cursor=stop;return {text:value};}
   if(source.startsWith('<!--',cursor)){const end=source.indexOf('-->',cursor+4);cursor=end<0?source.length:end+3;return {};}
   const end=source.indexOf('>',cursor+1);
   if(end<0){const value=source.slice(cursor);cursor=source.length;return {text:value};}
   if(end-cursor>65536)throw Error('HTML tag is too long; export CSV or JSON.');
   const raw=source.slice(cursor+1,end),closing=raw[0]==='/';cursor=end+1;
   const name=/^([a-z][\w:-]{0,127})(?:[\s/]|$)/i.exec(closing?raw.slice(1):raw);
   return name?{tag:name[1].toLowerCase(),closing}:{};
  }
  const blocked=new Set(['script','style','iframe','object','embed','svg','form','template']);
  let text='',count=0,cells=0,table=null,row=null,cell=null,caption=false,depth=0,skip='';const tables=[];
  const clean=value=>decode(value).replace(/\s+/g,' ').trim();
  const endCell=()=>{if(cell===null)return;if(++cells>MAX_CELLS)throw Error('Too many HTML table cells.');if(row&&row.length<256)row.push(clean(cell));cell=null;};
  const endRow=()=>{endCell();if(row?.length&&table&&table.rows.length<10000)table.rows.push(row);row=null;};
  const endTable=()=>{endRow();if(table?.rows.length&&tables.length<30){const columns=table.rows.shift();tables.push({title:clean(table.title)||'Report table '+(tables.length+1),columns,rows:table.rows});}table=null;};
  while(cursor<source.length){
   const token=nextToken();
   if(++count>250000)throw Error('HTML report is too complex; export CSV or JSON.');
   if(token.tag){
    const {tag,closing}=token;
    if(skip){if(closing&&tag===skip)skip='';continue;}
    if(blocked.has(tag)){if(!closing&&!['embed'].includes(tag))skip=tag;continue;}
    if(tag==='table'){if(closing){if(depth===1)endTable();depth=Math.max(0,depth-1);}else{if(++depth>128)throw Error('HTML table nesting is too deep.');if(depth===1){table={title:'',rows:[]};caption=false;}}continue;}
    if(table&&depth===1){
     if(tag==='tr'){endRow();if(!closing)row=[];}
     else if(tag==='td'||tag==='th'){endCell();if(!closing){row??=[];cell='';}}
     else if(tag==='caption')caption=!closing;
    }
    if(['br','p','div','tr','td','th','li','h1','h2','h3'].includes(tag)){
     if(text.length<100000)text+=' ';if(cell!==null&&cell.length<8192)cell+=' ';
    }
   }else if(token.text&&!skip){
    const value=token.text;if(text.length<100000)text+=value.slice(0,100000-text.length);
    if(table&&caption&&table.title.length<8192)table.title+=value.slice(0,8192-table.title.length);
    if(cell!==null&&cell.length<8192)cell+=value.slice(0,8192-cell.length);
   }
  }
  if(table)endTable();return {text:clean(text),tables};
 }
 function parse(path,content){
  if(typeof content!=='string'||new TextEncoder().encode(content).length>MAX_BYTES)throw Error('Analysis file exceeds the 64 MiB viewer budget.');
  content=content.replace(/^\uFEFF/,'');let result;
  if(/\.(csv|tsv)$/i.test(path))result=csv(content,path);
  else if(/\.raw$/i.test(path))result=raw(content);
  else if(/\.(json|wbk)$/i.test(path)){try{result=json(/\.wbk$/i.test(path)?workbook(content):JSON.parse(content),path);}catch(e){if(e instanceof SyntaxError)throw Error('Unsupported or incomplete JSON workbook/report.');throw e;}}
  else if(/\.html?$/i.test(path)){const saved=htmlReport(content);result={kind:'Saved HTML report',fields:[{path:'Report text',value:saved.text}],tables:saved.tables,plots:[],warnings:['Report scripts and external resources are never executed. HTML is read as plain text and tables; styling and nested table layout are not preserved.'],html:content};}
  else if(/\.txt$/i.test(path))result={kind:'Saved text report',fields:[{path:'Report text',value:content.slice(0,512000)}],tables:[],plots:[],warnings:[]};
  else throw Error('Open a JSON report, KiCad .wbk, CSV/TSV export, HTML report or ASCII SPICE .raw file.');
  const sourceFamily=family(path,result);
  return {...result,path,title:path.split('/').at(-1),family:sourceFamily,familyLabel:familyLabels[sourceFamily]};
 }
 // Probe saved samples only. Waveforms use nearest samples; nodal mesh fields
 // interpolate within the saved triangle, never across missing nodes or holes.
 function frameValues(plot,index){const frame=plot.frames?.[index];if(!frame||!Number.isSafeInteger(index))return null;const values=plot.y.map(()=>plot.x.map(()=>null));plot.cells.forEach(([x,y],i)=>{values[y][x]=numeric(frame.temperatures_c[plot.layerIndex*plot.cells.length+i]);});return values;}
 function cellBounds(axis,i){const c=axis[i],a=axis[i-1],b=axis[i+1];if(axis.length===1)return[c-.5,c+.5];const left=a===undefined?c+(c-b)/2:(a+c)/2,right=b===undefined?c+(c-a)/2:(b+c)/2;return[Math.min(left,right),Math.max(left,right)];}
 function probe(plot,x,y,seriesName){
  if(!Number.isFinite(x)||!plot)return null;
  if(plot.series){
   const series=plot.series.find(s=>s.name===seriesName)||plot.series[0];if(!series)return null;
   let nearest=null,distance=Infinity,min=Infinity,max=-Infinity;
   for(const p of series.points){if(!Number.isFinite(p.x))continue;min=Math.min(min,p.x);max=Math.max(max,p.x);const d=Math.abs(p.x-x);if(d<distance){nearest=p;distance=d;}}
   if(!nearest||x<min||x>max)return null;
   return {x:nearest.x,value:numeric(nearest.y),name:series.name,axis:plot.xLabel,method:'Nearest saved sample'};
  }
  if(!Number.isFinite(y))return null;
  if(plot.type==='heatmap'){
   const cell=(axis,value)=>{let best=-1,distance=Infinity;for(let i=0;i<axis.length;i++){const [low,high]=cellBounds(axis,i);if(value>=low&&value<=high&&Math.abs(axis[i]-value)<distance){best=i;distance=Math.abs(axis[i]-value);}}return best;};
   const xi=cell(plot.x,x),yi=cell(plot.y,y);if(xi<0||yi<0)return null;
   return {x:plot.x[xi],y:plot.y[yi],value:numeric(plot.values[yi][xi]),name:plot.title,unit:plot.unit,method:'Saved cell center'};
  }
  if(plot.type==='mesh-field'){
   for(let i=0;i<plot.triangles.length;i++){
    const t=plot.triangles[i],[a,b,c]=t.map(n=>plot.points[n]),d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-14)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d,w=1-u-v;if(Math.min(u,v,w)<-1e-9)continue;
    const values=plot.nodal?t.map(n=>numeric(plot.values[n])):[numeric(plot.values[i])],value=values.some(n=>n===null)?null:plot.nodal?values[0]*u+values[1]*v+values[2]*w:values[0];
    const z=[a,b,c].every(p=>Number.isFinite(p[2]))?a[2]*u+b[2]*v+c[2]*w:undefined;
    return {x,y,...(z===undefined?{}:{z}),value,name:plot.title,unit:plot.unit,method:plot.nodal?'Interpolated saved nodes':'Saved cell value'};
   }

  }
  return null;
 }
 function probeDifference(a,b){
  if(!a||!b||a.name!==b.name||a.unit!==b.unit||a.axis!==b.axis)return null;
  return {dx:b.x-a.x,...(Number.isFinite(a.y)&&Number.isFinite(b.y)?{dy:b.y-a.y,distance:Math.hypot(b.x-a.x,b.y-a.y)}:{}),delta:a.value===null||b.value===null?null:b.value-a.value};
 }
 const API={htmlReport,parse,candidate,family,familyLabels,numeric,delimited,tablePlot,cellBounds,frameValues,probe,probeDifference,MAX_BYTES};root.KiCadAnalysisData=API;if(typeof module==='object'&&module.exports)module.exports=API;
})(globalThis);
