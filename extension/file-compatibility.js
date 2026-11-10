/* Saved-format capability disclosure; never upgrades or rewrites a design. */
((root)=>{'use strict';
 const value=x=>x&&typeof x==='object'&&!Array.isArray(x)?x.quoted:x;
 const common='version generator generator_version uuid paper title_block embedded_fonts embedded_files legacy_source legacy_diagnostic'.split(' ');
 const known={kicad_pcb:new Set([...common,...'general layers setup net footprint module host page net_class segment arc via zone gr_line gr_arc gr_rect gr_circle gr_poly gr_text gr_curve gr_text_box gr_bitmap dimension target property group image'.split(' ')]),kicad_sch:new Set([...common,...'lib_symbols symbol sheet wire bus bus_entry junction no_connect label global_label hierarchical_label netclass_flag text text_box image rule_area polyline rectangle circle arc sheet_instances symbol_instances group'.split(' ')])};
 // Resolve saved text only: no environment, filesystem access or expression evaluation.
 function textResolver(ast,options={},warn=()=>{}){
  const fields=node=>{const result=Object.fromEntries((node||[]).filter(x=>Array.isArray(x)&&value(x[0])==='property').map(x=>[String(value(x[1])),String(value(x[2])??'')]));for(const key of ['Reference','Value','Footprint','Datasheet'])if(Object.prototype.hasOwnProperty.call(result,key))result[key.toUpperCase()]=result[key];return result;};
  const saved=Object.create(null),sources=Object.create(null),title=(ast||[]).find(x=>Array.isArray(x)&&value(x[0])==='title_block');
  const save=(key,text,source)=>{saved[key]=text;sources[key]=source;};
  for(const entry of title||[]){if(!Array.isArray(entry))continue;const key=String(value(entry[0]));if(['title','date','rev','company'].includes(key))save({title:'TITLE',date:'ISSUE_DATE',rev:'REVISION',company:'COMPANY'}[key],String(value(entry[1])??''),'Title block');if(key==='comment')save('COMMENT'+value(entry[1]),String(value(entry[2])??''),'Title block');}
  const project=options.textVariables||options.project?.text_variables||options.projectSettings?.text_variables||{};
  for(const [key,text] of Object.entries(project))if(typeof text==='string'&&key.length<=200&&text.length<=65536)save(key,text,'Project');
  for(const [key,text] of Object.entries(fields(ast)))save(key,text,'Drawing field');
  if(typeof options.path==='string'){save('FILENAME',options.path.split('/').pop(),'Drawing context');save('FILEPATH',options.path,'Drawing context');}
  for(const [key,text] of [['#',options.sheetNumber],['##',options.sheetCount],['SHEETNAME',options.sheetName],['PROJECTNAME',options.projectName]])if(text!==undefined)save(key,String(text),'Sheet context');
  const references=new Map();
  for(const node of ast||[]){if(!Array.isArray(node)||!['symbol','footprint','module'].includes(value(node[0])))continue;const local=fields(node),ref=local.Reference;if(ref)references.set(ref,references.has(ref)?null:local);}
  const reported=new Set();
  function inspectText(input,local={}){
   const raw=String(input??''),variables=new Map(),unresolved=new Set();
   if(!raw.includes('${'))return {raw,value:raw,fromVariable:false,variables:[],unresolved:[],status:'literal'};
   local=Object.assign(Object.create(null),local);for(const key of ['Reference','Value','Footprint','Datasheet'])if(Object.prototype.hasOwnProperty.call(local,key))local[key.toUpperCase()]=local[key];
   let count=0;
   const expand=(text,chain=[])=>text.replace(/\$\{([^{}]{1,200})\}/g,(token,key)=>{
    if(++count>256||chain.length>=8||chain.includes(key)){unresolved.add(key);if(!reported.has(key)){reported.add(key);warn('Text variable '+token+' is recursive or exceeds the substitution limit; preserved literally.');}return token;}
    const separator=key.lastIndexOf(':'),target=separator>0?references.get(key.slice(0,separator)):null,field=separator>0?key.slice(separator+1):key;
    const own=target&&Object.prototype.hasOwnProperty.call(target,field)?target:Object.prototype.hasOwnProperty.call(local,key)?local:saved,lookup=own===target?field:key;
    if(!Object.prototype.hasOwnProperty.call(own,lookup)||typeof own[lookup]!=='string'){unresolved.add(key);variables.set(key,{name:key,source:separator>0&&references.has(key.slice(0,separator))?'Ambiguous or missing reference field':'Unavailable',raw:token});if(!reported.has(key)){reported.add(key);warn('Unresolved saved text variable '+token+'; preserved literally.');}return token;}
    variables.set(key,{name:key,source:own===target?'Reference '+key.slice(0,separator):own===local?'Selected object field':sources[key]||'Saved field',raw:own[lookup]});
    return expand(own[lookup],chain.concat(key));
   });
   let resolved=expand(raw);if(resolved.length>65536){warn('Expanded text exceeds the saved-text limit; preserved literally.');resolved=raw;unresolved.add('Expansion limit');}
   return {raw,value:resolved,fromVariable:true,variables:[...variables.values()],unresolved:[...unresolved],status:unresolved.size?'unresolved':'resolved'};
  }
  const resolve=(input,local={})=>inspectText(input,local).value;
  function list(local={}){
   const names=new Set([...Object.keys(saved),...Object.keys(local)]);
   for(const text of [...Object.values(saved),...Object.values(local)])if(typeof text==='string')for(const match of text.matchAll(/\$\{([^{}]{1,200})\}/g))names.add(match[1]);
   return [...names].sort().slice(0,512).map(name=>{const detail=inspectText('${'+name+'}',local),binding=detail.variables.find(item=>item.name===name);return {name,source:binding?.source||'Unavailable',raw:binding?.raw??'${'+name+'}',value:detail.value,status:detail.status,unresolved:detail.unresolved};});
  }
  function properties(entries){const values=Object.create(null),provenance=Object.create(null);for(const [key,text] of Object.entries(entries||{})){const detail=inspectText(text,entries);values[key]=detail.value;if(detail.fromVariable)provenance[key]=detail;}return {values,provenance};}
  return {resolve,fields,inspect:inspectText,list,properties};
 }
 function inspect(ast){
  const kind=String(value(ast?.[0])),field=name=>value(ast.find(x=>Array.isArray(x)&&value(x[0])===name)?.[1]);
  if(!Array.isArray(ast)||!known[kind])throw Error('Unsupported KiCad drawing root.');
  const generatorVersion=String(field('generator_version')??''),formatVersion=field('version')??null,major=/^(\d+)(?:\.|$)/.exec(generatorVersion),warnings=[];
  if(major&&Number(major[1])>10)warnings.push(`KiCad ${generatorVersion} is a forward-compatibility preview: only recognized saved constructs are rendered; new version features are not verified.`);
  for(const node of ast.filter(x=>Array.isArray(x)&&value(x[0])==='legacy_diagnostic'))warnings.push(String(value(node[1])));
  if(kind==='kicad_pcb'&&formatVersion!==null&&Number(formatVersion)<20200000)warnings.push('Restricted legacy PCB preview: saved modules, pads, tracks and supported graphics are rendered; unsupported constructs are disclosed.');
  const restrictedPreview=Boolean(field('legacy_source')||major&&Number(major[1])<8||kind==='kicad_pcb'&&formatVersion!==null&&Number(formatVersion)<20200000);
  if(restrictedPreview&&!field('legacy_source')&&!(kind==='kicad_pcb'&&Number(formatVersion)<20200000))warnings.push('Restricted KiCad 4–7 preview: only recognized saved constructs are rendered.');
  const unknown=[...new Set(ast.filter(Array.isArray).map(x=>String(value(x[0]))).filter(x=>!known[kind].has(x)))];
  if(unknown.length)warnings.push('Unrecognized saved drawing constructs omitted: '+unknown.slice(0,40).join(', ')+(unknown.length>40?' …':''));
  return {legacy:Boolean(field('legacy_source')||kind==='kicad_pcb'&&formatVersion!==null&&Number(formatVersion)<20200000),restrictedPreview,majorVersion:major?Number(major[1]):null,kind,generatorVersion:generatorVersion||null,formatVersion,forwardPreview:Boolean(major&&Number(major[1])>10),unknown,warnings};
 }
 const features=Object.freeze([
  {id:'drawing',label:'Saved schematic / PCB geometry',since:4,implemented:true},
  {id:'review',label:'Selection, properties, comments and comparison',since:4,implemented:true},
  {id:'hierarchy',label:'Sheet navigation and cross-sheet highlighting',since:4,implemented:true},
  {id:'copper',label:'Saved copper fills and zone outlines',since:4,implemented:true},
  {id:'models',label:'Repository-linked 3D models',since:4,implemented:true},
  {id:'embeddedAssets',label:'Embedded fonts and 3D assets',since:9,implemented:false},
  {id:'componentClasses',label:'Component-class rules',since:9,implemented:false},
  {id:'netclassRuleAreas',label:'Schematic net-class rule areas',since:9,implemented:false},
  {id:'schematicTables',label:'Native schematic tables',since:9,implemented:false}
 ]);
 function capability(info,id){
  const feature=features.find(f=>f.id===id);
  if(!feature)return {available:false,reason:'This feature is not recognized by the viewer.',upgrade:false};
  const major=info?.majorVersion;
  if(Number.isInteger(major)&&major<feature.since)return {available:false,upgrade:true,reason:`${feature.label} requires KiCad ${feature.since} or later. This drawing identifies itself as KiCad ${info.generatorVersion||major}. Upgrade to the latest stable KiCad and save a separate project copy. `+(feature.implemented?'':'This viewer also needs support for this feature; upgrading the project alone will not enable it.')};
  if(!feature.implemented)return {available:false,upgrade:false,reason:`${feature.label} is not implemented in this viewer. Upgrading KiCad alone will not enable it.`};
  return {available:true,upgrade:false,reason:'Available for recognized saved data; existing geometry and connectivity limits still apply.'};
 }
 function mountStatus(host,read){
  const doc=host.ownerDocument||root.document;
  const button=doc.createElement('button');button.type='button';button.className='compatibility-button';button.title='Saved-file compatibility and feature availability';host.append(button);
  const dialog=doc.createElement('dialog');dialog.className='compatibility-dialog';dialog.setAttribute('aria-label','Saved-file compatibility');doc.body.append(dialog);
  const make=(tag,text)=>{const node=doc.createElement(tag);node.textContent=text;return node;};
  function explain(feature){
   const result=capability(read(),feature.id);if(result.available)return true;
   dialog.replaceChildren(make('h2',feature.label),make('p',result.reason));
   if(result.upgrade){const link=make('a','Get the latest stable KiCad');link.href='https://www.kicad.org/download/';link.target='_blank';link.rel='noopener noreferrer';dialog.append(link);}
   const close=make('button','Close');close.type='button';close.onclick=()=>dialog.close();dialog.append(close);if(!dialog.open)dialog.showModal();return false;
  }
  function show(){
   const info=read();dialog.replaceChildren(make('h2','Saved-file compatibility'),make('p',info?.generatorVersion?`KiCad ${info.generatorVersion} · saved format ${info.formatVersion??'unknown'}`:'Generator version unknown; no major version inferred from the format date.'));
   if(info?.restrictedPreview)dialog.append(make('p','Restricted legacy preview. Missing libraries, unsupported saved graphics and connectivity limits are reported by the drawing; feature availability does not imply complete format coverage.'));
   for(const feature of features){const result=capability(info,feature.id),row=make('button',`${result.available?'Available':'Blocked'} · ${feature.label}${result.available?'':' · Why?'}`);row.type='button';row.className='compatibility-feature';row.setAttribute('data-blocked',String(!result.available));row.title=result.reason;row.onclick=()=>result.available?undefined:explain(feature);dialog.append(row);}
   if(info?.unknown?.length)dialog.append(make('p','Omitted saved constructs: '+info.unknown.join(', ')+'. These are renderer limitations; upgrading alone is not a remedy.'));
   const close=make('button','Close');close.type='button';close.onclick=()=>dialog.close();dialog.append(close);if(!dialog.open)dialog.showModal();
  }
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
  button.onclick=show;
  const refresh=()=>{const info=read();button.textContent=info?.restrictedPreview?'Legacy · Restricted':info?.majorVersion?`KiCad ${info.majorVersion} · Features`:'File features';if(dialog.open)dialog.close();};refresh();
  return {refresh,check(id){const feature=features.find(f=>f.id===id);return feature?explain(feature):false;},dispose(){dialog.remove();button.remove();}};
 }
 root.KiCadFileCompatibility={textResolver,inspect,features,capability,mountStatus};if(typeof module==='object'&&module.exports)module.exports=root.KiCadFileCompatibility;
})(typeof globalThis==='object'?globalThis:this);
