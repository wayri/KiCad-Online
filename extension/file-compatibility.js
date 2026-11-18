/* Saved-format capability disclosure; never upgrades or rewrites a design. */
((root)=>{'use strict';
 const value=x=>x&&typeof x==='object'&&!Array.isArray(x)?x.quoted:x;
 const common='version generator generator_version uuid paper title_block embedded_fonts embedded_files legacy_source legacy_diagnostic'.split(' ');
 const known={kicad_pcb:new Set([...common,...'general layers setup net footprint module host page net_class segment arc via zone gr_line gr_arc gr_rect gr_circle gr_poly gr_text gr_curve gr_text_box gr_bitmap dimension target property group image'.split(' ')]),kicad_sch:new Set([...common,...'lib_symbols symbol sheet wire bus bus_entry junction no_connect label global_label hierarchical_label netclass_flag text text_box table image rule_area polyline rectangle circle arc bezier sheet_instances symbol_instances group'.split(' ')])};
 // Deliberately bounded numeric subset of KiCad 10 text expressions. See
 // https://docs.kicad.org/10.0/en/eeschema/eeschema.html#text-expressions
 // Units, strings, logical/time/random functions and unknown syntax stay literal.
 function numericExpression(source){
  if(source.length>4096)throw Error('expression length limit');
  const tokens=[];let offset=0;
  while(offset<source.length){
   if(/\s/.test(source[offset])){offset++;continue;}
   const match=/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z_][a-zA-Z_0-9]*|[+*/%^(),-])/.exec(source.slice(offset));
   if(!match)throw Error('unsupported expression syntax, unit or function');
   tokens.push(match[0]);offset+=match[0].length;if(tokens.length>256)throw Error('expression token limit');
  }
  let cursor=0;
  const finite=value=>{if(!Number.isFinite(value))throw Error('non-finite expression result or invalid domain');return value;};
  const take=token=>tokens[cursor]===token?(cursor++,true):false;
  function primary(depth){
   if(depth>32)throw Error('expression nesting limit');
   if(take('(')){const result=expression(0,depth+1);if(!take(')'))throw Error('missing closing parenthesis');return result;}
   const token=tokens[cursor++];if(token===undefined)throw Error('missing expression operand');
   if(/^(?:\d|\.)/.test(token))return finite(Number(token));
   if(!/^[a-z]/.test(token)||!take('('))throw Error('unsupported expression syntax, unit or function');
   const args=[];if(!take(')')){do{args.push(expression(0,depth+1));}while(take(','));if(!take(')'))throw Error('missing closing parenthesis');}
   const one={abs:Math.abs,sqrt:Math.sqrt,floor:Math.floor,ceil:Math.ceil};
   if(Object.prototype.hasOwnProperty.call(one,token)){if(args.length!==1)throw Error('invalid function argument count');return finite(one[token](args[0]));}
   if(token==='pow'){if(args.length!==2)throw Error('invalid function argument count');return finite(Math.pow(args[0],args[1]));}
   if(['min','max','sum','avg'].includes(token)){if(!args.length)throw Error('invalid function argument count');return finite(token==='min'?Math.min(...args):token==='max'?Math.max(...args):args.reduce((sum,value)=>sum+value,0)/(token==='avg'?args.length:1));}
   throw Error('unsupported expression function '+token);
  }
  function expression(minimum,depth){
   if(depth>32)throw Error('expression nesting limit');
   // Exponentiation binds more tightly than a leading sign and associates right.
   let left=take('+')?expression(3,depth+1):take('-')?-expression(3,depth+1):primary(depth+1);
   const precedence={'+':1,'-':1,'*':2,'/':2,'%':2,'^':3};
   while(Object.prototype.hasOwnProperty.call(precedence,tokens[cursor])&&precedence[tokens[cursor]]>=minimum){
    const operator=tokens[cursor++],right=expression(precedence[operator]+(operator==='^'?0:1),depth+1);
    if((operator==='/'||operator==='%')&&right===0)throw Error('division or modulo by zero');
    left=finite(operator==='+'?left+right:operator==='-'?left-right:operator==='*'?left*right:operator==='/'?left/right:operator==='%'?left%right:Math.pow(left,right));
   }
   return finite(left);
  }
  const result=expression(0,0);if(cursor!==tokens.length)throw Error('unsupported expression syntax, unit or function');return String(Object.is(result,-0)?0:result);
 }
 function textExpressions(input,warn=()=>{}){
  const text=String(input??''),expressions=[];let count=0;
  if(!text.includes('@{'))return {value:text,expressions};
  if(text.length>65536){const reason='text expression input limit';warn(reason+'; preserved literally.');return {value:text,expressions:[{raw:text,value:text,status:'unresolved',reason}]};}
  const endOf=(source,start)=>{let depth=1,quote=null;for(let i=start+2;i<source.length;i++){const char=source[i];if(quote){if(char==='\\'){i++;continue;}if(char===quote)quote=null;continue;}if(char==='"'||char==="'"){quote=char;continue;}if(char==='{')depth++;else if(char==='}'&&!--depth)return i;}return -1;};
  function expand(source,depth,record){
   if(depth>16)throw Error('nested text expression limit');
   let result='',position=0,start;
   while((start=source.indexOf('@{',position))>=0){
    if(count>=128){const reason='text expression count limit';if(!record)throw Error(reason);const raw=source.slice(start);expressions.push({raw,value:raw,status:'unresolved',reason});warn(reason+'; remaining text preserved literally.');return result+source.slice(position);}
    result+=source.slice(position,start);const end=endOf(source,start),raw=source.slice(start,end<0?source.length:end+1);let value=raw,reason;
    try{if(++count>128)throw Error('text expression count limit');if(end<0)throw Error('unclosed text expression');if(raw.length>4099)throw Error('expression length limit');value=numericExpression(expand(raw.slice(2,-1),depth+1,false));}
    catch(error){reason=error.message;if(!record)throw error;warn('Unsupported or invalid text expression: '+reason+'; preserved literally.');}
    if(record)expressions.push({raw,value,status:reason?'unresolved':'resolved',...(reason?{reason}:{})});
    result+=value;position=end<0?source.length:end+1;
   }
   return result+source.slice(position);
  }
  return {value:expand(text,0,true),expressions};
 }
 // Resolve saved text only: no environment, filesystem access or dynamic code execution.
 function textLinks(text,href){
  const target=input=>{if(typeof input!=='string'||input.length>4096||/[\x00-\x20\x7f]/.test(input))return null;
   if(/^#[^#/?\\]{1,64}$/.test(input))return {kind:'sheet',page:input.slice(1),target:input};
   if(!/^https?:\/\//i.test(input))return null;
   try{const url=new URL(input);if(url.username||url.password||!url.hostname)return null;return {kind:'web',target:url.href};}catch{return null;}
  };
  if(href!==undefined&&href!=='')return [target(href)].filter(Boolean);
  const links=new Map();for(const match of String(text??'').slice(0,65536).matchAll(/https?:\/\/[^\s<>"\u0000-\u001f]+/gi)){const link=target(match[0].replace(/[.,;!]+$/,''));if(link)links.set(link.target,link);if(links.size>=32)break;}
  return [...links.values()];
 }
 function textResolver(ast,options={},warn=()=>{}){
  const fields=node=>{const result=Object.fromEntries((node||[]).filter(x=>Array.isArray(x)&&value(x[0])==='property').map(x=>[String(value(x[1])),String(value(x[2])??'')]));for(const key of ['Reference','Value','Footprint','Datasheet','Description'])if(Object.prototype.hasOwnProperty.call(result,key))result[key.toUpperCase()]=result[key];return result;};
  const sheetContexts=(options.sheetContexts||[]).map(context=>({...context,fields:Object.assign(Object.create(null),context.fields)})),blocked=new Set(options.unavailableVariables||[]);
  const saved=Object.create(null),sources=Object.create(null),title=(ast||[]).find(x=>Array.isArray(x)&&value(x[0])==='title_block');
  const save=(key,text,source)=>{saved[key]=text;sources[key]=source;};
  for(const entry of title||[]){if(!Array.isArray(entry))continue;const key=String(value(entry[0]));if(['title','date','rev','company'].includes(key))save({title:'TITLE',date:'ISSUE_DATE',rev:'REVISION',company:'COMPANY'}[key],String(value(entry[1])??''),'Title block');if(key==='comment')save('COMMENT'+value(entry[1]),String(value(entry[2])??''),'Title block');}
  const project=options.textVariables||options.project?.text_variables||options.projectSettings?.text_variables||{};
  const globals=Object.create(null);for(const [key,text] of Object.entries(project))if(typeof text==='string'&&key.length<=200&&text.length<=65536){globals[key]=text;if(!Object.prototype.hasOwnProperty.call(saved,key))save(key,text,'Project');}
  for(const [key,text] of Object.entries(fields(ast)))save(key,text,'Drawing field');
  if(typeof options.path==='string'){save('FILENAME',options.path.split('/').pop(),'Drawing context');save('FILEPATH',options.path,'Drawing context');}
  for(const [key,text] of [['#',options.sheetNumber],['##',options.sheetCount],['SHEETNAME',options.sheetName],['PROJECTNAME',options.projectName]])if(text!==undefined)save(key,String(text),'Sheet context');
  const references=new Map();
  for(const node of ast||[]){if(!Array.isArray(node)||!['symbol','footprint','module'].includes(value(node[0])))continue;const local=fields(node),ref=local.Reference;if(ref)references.set(ref,references.has(ref)?null:local);}
  // Symbol fields are case-insensitive in KiCad. Sheet and project bindings
  // retain their saved case; never fold the entire hierarchy into one map.
  const objectKey=(owner,key)=>{if(Object.prototype.hasOwnProperty.call(owner||{},key))return key;const matches=Object.keys(owner||{}).filter(name=>name.toUpperCase()===key.toUpperCase());return matches.length===1?matches[0]:null;};
  const reported=new Set();
  function inspectText(input,local={},scopeStart=0,projectOnly=false){
   const raw=String(input??''),variables=new Map(),unresolved=new Set();
   if(!raw.includes('${')&&!raw.includes('@{'))return {raw,value:raw,fromVariable:false,variables:[],unresolved:[],status:'literal'};
   local=Object.assign(Object.create(null),local);for(const key of ['Reference','Value','Footprint','Datasheet','Description'])if(Object.prototype.hasOwnProperty.call(local,key))local[key.toUpperCase()]=local[key];
   let count=0;
   const expand=(text,chain=[],owner=local,start=0,globalOnly=false)=>text.replace(/\$\{([^{}]{1,200})\}/g,(token,key)=>{
    const separator=key.lastIndexOf(':'),target=separator>0?references.get(key.slice(0,separator)):null,field=separator>0?key.slice(separator+1):key;
    let own,lookup=key,source,nextOwner=owner,nextStart=start,nextGlobal=globalOnly;
    if(!globalOnly&&separator>0&&references.has(key.slice(0,separator))){own=target;lookup=objectKey(target,field);source='Reference '+key.slice(0,separator);nextOwner=target||{};}
    else if(!globalOnly&&objectKey(owner,key)!==null){own=owner;lookup=objectKey(owner,key);source=owner===local?'Selected object field':'Referenced object field';}
    else if(!globalOnly&&blocked.has(key)){source='Ambiguous sheet instance';}
    else {
     let index=globalOnly?-1:sheetContexts.findIndex((context,i)=>i>=start&&Object.prototype.hasOwnProperty.call(context.fields,key));
     if(index>start&&Object.prototype.hasOwnProperty.call(saved,key)&&sources[key]!=='Project')index=-1;
     if(index>=0){own=sheetContexts[index].fields;source=sheetContexts[index].source||'Sheet field';nextOwner={};nextStart=index;}
     else {own=globalOnly?globals:saved;source=globalOnly?'Project':sources[key];if(source==='Project'||source==='Title block'){nextOwner={};nextGlobal=true;}}
    }
    if(!own||!Object.prototype.hasOwnProperty.call(own,lookup)||typeof own[lookup]!=='string'){unresolved.add(key);variables.set(key,{name:key,source:source==='Ambiguous sheet instance'?source:separator>0&&references.has(key.slice(0,separator))?'Ambiguous or missing reference field':'Unavailable',raw:token});if(!reported.has(key)){reported.add(key);warn('Unresolved saved text variable '+token+'; preserved literally.');}return token;}
    const identity=source+'\0'+key+'\0'+nextStart;
    if(++count>256||chain.length>=8||chain.includes(identity)){unresolved.add(key);if(!reported.has(key)){reported.add(key);warn('Text variable '+token+' is recursive or exceeds the substitution limit; preserved literally.');}return token;}
    variables.set(key,{name:key,source:source||'Saved field',raw:own[lookup]});
    return expand(own[lookup],chain.concat(identity),nextOwner,nextStart,nextGlobal);
   });
   let resolved=expand(raw,[],local,scopeStart,projectOnly);if(resolved.length>65536){warn('Expanded text exceeds the saved-text limit; preserved literally.');resolved=raw;unresolved.add('Expansion limit');}
   const evaluated=textExpressions(resolved,warn);resolved=evaluated.value;for(const item of evaluated.expressions)if(item.status==='unresolved')unresolved.add(item.raw);
   return {raw,value:resolved,fromVariable:raw.includes('${'),fromExpression:evaluated.expressions.length>0,expressions:evaluated.expressions,variables:[...variables.values()],unresolved:[...unresolved],status:unresolved.size?'unresolved':'resolved'};
  }
  const resolve=(input,local={})=>inspectText(input,local).value;
  function list(local={}, {includeShadowed=false}={}){
   const names=new Set([...Object.keys(saved),...sheetContexts.flatMap(context=>Object.keys(context.fields)),...blocked,...Object.keys(local)]);
   for(const text of [...Object.values(saved),...sheetContexts.flatMap(context=>Object.values(context.fields)),...Object.values(local)])if(typeof text==='string')for(const match of text.matchAll(/\$\{([^{}]{1,200})\}/g))names.add(match[1]);
   const rows=[...names].sort().slice(0,512).map(name=>{const detail=inspectText('${'+name+'}',local),binding=detail.variables.find(item=>item.name===name);return {name,source:binding?.source||'Unavailable',raw:binding?.raw??'${'+name+'}',value:detail.value,status:detail.status,unresolved:detail.unresolved};});
   if(includeShadowed){
    const append=(name,source,raw,detail,scope)=>{if(rows.some(row=>row.name===name&&row.source===source))return;rows.push({name,source,raw,value:detail.value,status:detail.status,unresolved:detail.unresolved,scope,shadowed:true});};
    for(const [name,raw]of Object.entries(globals))append(name,'Project',raw,inspectText('${'+name+'}',{},0,true),'project');
    for(const [index,context]of sheetContexts.entries())for(const [name,raw]of Object.entries(context.fields))append(name,context.source||'Sheet field',raw,inspectText('${'+name+'}',{},index),'sheet');
   }
   return rows.slice(0,1024);
  }
  function properties(entries){const values=Object.create(null),provenance=Object.create(null);for(const [key,text] of Object.entries(entries||{})){const detail=inspectText(text,entries);values[key]=detail.value;if(detail.fromVariable||detail.fromExpression)provenance[key]=detail;}return {values,provenance};}
  return {resolve,fields,inspect:inspectText,list,properties};
 }
 // Saved hierarchy instances, not filenames, own sheet fields. The caller supplies its
 // existing parser/cache; this helper performs no I/O and never reads the environment.
 function textContext(files,path,{rootFile=path,instancePath,parse}={}){
  const child=(node,name)=>(node||[]).find(item=>Array.isArray(item)&&value(item[0])===name),field=(node,name)=>value(child(node,name)?.[1]);
  const byPath=new Map((files||[]).map(file=>[file.path,file])),cache=new Map(),candidates=[];
  const read=name=>{if(cache.has(name))return cache.get(name);const file=byPath.get(name);let ast=file?.ast;try{if(!ast&&file&&parse)ast=parse(file.content,file);}catch{}cache.set(name,ast);return ast;};
  const props=node=>Object.fromEntries((node||[]).filter(item=>Array.isArray(item)&&value(item[0])==='property').map(item=>[String(value(item[1])),String(value(item[2])??'')]));
  const relative=(parent,name)=>{if(typeof name!=='string'||!name||/^(?:[a-z]+:|[\\/])/i.test(name)||name.includes('${'))return null;const parts=parent.split('/').slice(0,-1);for(const part of name.replace(/\\/g,'/').split('/')){if(part==='..'){if(!parts.length)return null;parts.pop();}else if(part&&part!=='.')parts.push(part);}return parts.join('/');};
  let visited=0,incomplete=false;
  function visit(file,contexts,ids,names,ancestors){
   if(++visited>512||ancestors.length>=32||ancestors.includes(file)){incomplete=true;return;}
   const ast=read(file);if(!ast)return;
   const id=ids.every(Boolean)?'/'+ids.join('/'):null,name=names.every(item=>typeof item==='string')?(names.length?'/'+names.join('/')+'/':'/'):undefined;
   if(file===path)candidates.push({instancePath:id,parentPath:ancestors.at(-1)||null,parentInstancePath:ids.length>1&&ids.every(Boolean)?'/'+ids.slice(0,-1).join('/'):null,sheetContexts:contexts,sheetName:names.length?names.at(-1):'/',sheetPath:name,...(pageNumbers.has(id)?{sheetNumber:pageNumbers.get(id)}:{})});
   for(const sheet of (ast||[]).filter(item=>Array.isArray(item)&&value(item[0])==='sheet')){
    const fields=props(sheet),target=relative(file,fields.Sheetfile??fields['Sheet file']),uuid=field(sheet,'uuid');if(!target||!byPath.has(target))continue;
    const sheetName=fields.Sheetname??fields['Sheet name'],nextIds=ids.concat(uuid),nextNames=names.concat(sheetName);
    const nextId=nextIds.every(Boolean)?'/'+nextIds.join('/'):null;
    for(const instances of (sheet||[]).filter(item=>Array.isArray(item)&&value(item[0])==='instances'))for(const project of instances.filter(item=>Array.isArray(item)&&value(item[0])==='project'))for(const entry of project.filter(item=>Array.isArray(item)&&value(item[0])==='path'))if(String(value(entry[1])).replace(/\/$/,'')===id){const page=field(entry,'page');if(nextId&&page!==undefined)pageNumbers.set(nextId,String(page));}
    const bindings={...fields,SHEETFILE:fields.Sheetfile??fields['Sheet file']};if(sheetName!==undefined)bindings.SHEETNAME=sheetName;
    if(nextNames.every(item=>typeof item==='string'))bindings.SHEETPATH='/'+nextNames.join('/')+'/';
    visit(target,[{fields:bindings,source:bindings.SHEETPATH?'Sheet '+bindings.SHEETPATH:'Sheet fields ('+target+')',instancePath:nextIds.every(Boolean)?'/'+nextIds.join('/'):null},...contexts],nextIds,nextNames,ancestors.concat(file));
   }
  }
  // A direct child-file view may still receive its loaded ancestors. Recover a
  // unique saved root instead of treating the child as a new hierarchy root.
  const parents=new Map();for(const file of (files||[]).slice(0,512))for(const sheet of (read(file.path)||[]).filter(item=>Array.isArray(item)&&value(item[0])==='sheet')){const fields=props(sheet),target=relative(file.path,fields.Sheetfile??fields['Sheet file']);if(target&&byPath.has(target)){if(!parents.has(target))parents.set(target,new Set());parents.get(target).add(file.path);}}
  const roots=new Set(),seen=new Set();function ascend(file){if(seen.has(file)){return;}seen.add(file);const incoming=parents.get(file);if(!incoming?.size)roots.add(file);else for(const parent of incoming)ascend(parent);}
  ascend(rootFile);if(roots.size===1)rootFile=[...roots][0];else if(roots.size!==1)incomplete=true;
  const rootAst=read(rootFile),rootId=field(rootAst,'uuid'),pageNumbers=new Map();
  for(const group of (rootAst||[]).filter(item=>Array.isArray(item)&&value(item[0])==='sheet_instances'))for(const entry of group.filter(item=>Array.isArray(item)&&value(item[0])==='path')){const parts=String(value(entry[1])).split('/').filter(Boolean);if(parts[0]!==rootId)parts.unshift(rootId);const page=field(entry,'page');if(parts.every(Boolean)&&page!==undefined)pageNumbers.set('/'+parts.join('/'),String(page));}
  visit(rootFile,[],[rootId],[],[]);
  const selected=instancePath?candidates.filter(item=>item.instancePath?.replace(/\/$/,'')===String(instancePath).replace(/\/$/,'')):candidates;
  if(selected.length===1&&!incomplete)return {...selected[0],contextStatus:'resolved',instances:candidates};
  const unavailableVariables=[...new Set([...candidates.flatMap(item=>item.sheetContexts.flatMap(context=>Object.keys(context.fields))),'SHEETNAME','SHEETPATH','#'])];
  return {sheetContexts:[],unavailableVariables,contextStatus:selected.length>1?'ambiguous':'unavailable',instances:candidates};
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
  {id:'schematicTables',label:'Native schematic tables (horizontal)',since:9,implemented:true,limitation:'Horizontal tables with saved cell geometry are rendered. Rotated tables are omitted with a drawing diagnostic; table-cell contextual variables are not implemented.'}
 ]);
 function capability(info,id){
  const feature=features.find(f=>f.id===id);
  if(!feature)return {available:false,reason:'This feature is not recognized by the viewer.',upgrade:false};
  const major=info?.majorVersion;
  if(Number.isInteger(major)&&major<feature.since)return {available:false,upgrade:true,reason:`${feature.label} requires KiCad ${feature.since} or later. This drawing identifies itself as KiCad ${info.generatorVersion||major}. Upgrade to the latest stable KiCad and save a separate project copy. `+(feature.implemented?'':'This viewer also needs support for this feature; upgrading the project alone will not enable it.')};
  if(!feature.implemented)return {available:false,upgrade:false,reason:`${feature.label} is not implemented in this viewer. Upgrading KiCad alone will not enable it.`};
  return {available:true,upgrade:false,reason:feature.limitation||'Available for recognized saved data; existing geometry and connectivity limits still apply.'};
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
 root.KiCadFileCompatibility={textResolver,textContext,textExpressions,textLinks,inspect,features,capability,mountStatus};if(typeof module==='object'&&module.exports)module.exports=root.KiCadFileCompatibility;
})(typeof globalThis==='object'?globalThis:this);
