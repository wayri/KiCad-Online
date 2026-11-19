/* Source-bound cross-probing; no coordinate mapping between PCB and schematic. */
((root)=>{
 'use strict';
 const text=v=>v&&typeof v==='object'?v.quoted:v;
 const MAX_TERMINALS=64,MAX_TERMINAL_TEXT=16384,MAX_NET_MEMBERS=2048;
 const MAX_UNIT_PATHS=31,MAX_UNIT_PATH_TEXT=8192;
 const MAX_GROUP_ITEMS=200,MAX_GROUP_TERMINALS=192,MAX_GROUP_EVIDENCE_TEXT=65536,MAX_GROUP_BYTES=232*1024;
 const bounded=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
 const nativePath=value=>typeof value==='string'&&value.length<=2000&&value.startsWith('/')&&value.split('/').slice(1).every(p=>p&&p!=='.'&&p!=='..'&&!/[\\:\x00-\x1f\x7f]/.test(p))&&value.split('/').length<=65;
 function tstampPath(object){
  if(object?.association){const value=object.association.path;return nativePath(value)?value:null;}
  const value=text(object?.saved?.tree?.find?.(v=>Array.isArray(v)&&v[0]==='path')?.[1]);return nativePath(value)?value:null;
 }
 function symbolPaths(object){
  if(object?.association){const a=object.association;if(!a.complete)return [];return a.instances.filter(p=>nativePath(p.prefix)&&object.uuid&&typeof p.reference==='string').map(p=>({path:p.prefix+'/'+object.uuid,reference:p.reference}));}
  const instances=object?.saved?.tree?.find?.(v=>Array.isArray(v)&&v[0]==='instances'),result=[];
  for(const project of instances||[])if(Array.isArray(project)&&project[0]==='project')for(const path of project)if(Array.isArray(path)&&path[0]==='path'){
   const prefix=text(path[1]),reference=text(path.find(v=>Array.isArray(v)&&v[0]==='reference')?.[1]);
   if(nativePath(prefix)&&object.uuid)result.push({path:prefix+'/'+object.uuid,reference});
  }
  return result;
 }
 function rootId(object){const id=object?.association?.rootUuid;return typeof id==='string'&&id.length>0&&id.length<=200&&!/[\\/:\x00-\x1f\x7f]/.test(id)?id:null;}
 // Only the known root UUID may be absent in an older converted PCB path.
 function sameInstancePath(a,b,rootUuid){
  if(a===b)return true;
  if(!nativePath(a)||!nativePath(b)||!rootUuid)return false;
  const short=a.split('/').length<b.split('/').length?a:b,long=short===a?b:a;
  return short.split('/').length===2&&long==='/'+rootUuid+short;
 }
 function unitContext(symbol){
  const unit=Number(symbol.saved?.library?.unit??symbol.properties?.Unit);
  const library=symbol.saved?.library?.id??symbol.properties?.['Library ID'];
  const savedFootprint=symbol.saved?.properties?.find(p=>p.name==='Footprint');
  const footprint=savedFootprint?(savedFootprint.truncated?null:savedFootprint.value):symbol.properties?.Footprint;
  return Number.isSafeInteger(unit)&&unit>0&&bounded(library,1000)&&bounded(footprint,1000)?{unit,library,footprint}:null;
 }
 const packageIndexes=new WeakMap();
 function packageIndex(objects){
  const cached=packageIndexes.get(objects);
  if(cached)return cached;
  const groups=new Map(),incomplete=new Set();
  for(const object of objects){
   if(object.kind!=='symbol')continue;
   if(object.association?.complete===false)incomplete.add(object.reference);
   for(const {path,reference} of symbolPaths(object)){
    if(!nativePath(path)||!bounded(reference,200))continue;
    const key=path.split('/')[1]+'\0'+reference;
    const group=groups.get(key);
    if(group){if(group.length<=MAX_UNIT_PATHS+1)group.push({object,path});}
    else groups.set(key,[{object,path}]);
   }
  }
  const index={groups,incomplete};
  packageIndexes.set(objects,index);
  return index;
 }
 // A physical package can span sheets. Its saved annotations must agree in a
 // single project root, and each placed unit and saved identity must be unique.
 function packageSiblings(object,objects,savedPath){
  if(!objects?.length||!savedPath)return [];
  const placements=symbolPaths(object).filter(p=>sameInstancePath(p.path,savedPath,rootId(object)));
  const context=unitContext(object);
  if(!context||placements.length!==1)return [];
  const [{path,reference}]=placements;
  if(!bounded(reference,200)||!/[0-9]$/.test(reference)||reference.includes('?'))return [];
  const {groups,incomplete}=packageIndex(objects);
  const group=groups.get(path.split('/')[1]+'\0'+reference);
  if(incomplete.has(reference)||!group||group.length>MAX_UNIT_PATHS+1)return [];
  const units=new Set(),ids=new Set(),siblings=[];
  let anchor=false;
  for(const unit of group){
   const candidate=unit.object,c=unitContext(candidate);
   if(!c||c.library!==context.library||c.footprint!==context.footprint||units.has(c.unit)||ids.has(candidate.uuid))return [];
   units.add(c.unit);
   ids.add(candidate.uuid);
   if(candidate.path===object.path&&candidate.uuid===object.uuid){
    if(unit.path!==path||c.unit!==context.unit)return [];
    anchor=true;
   }else siblings.push(unit);
  }
  return anchor?siblings:[];
 }
 function partSelection(object,{instancePath,objects}={}){
  if(!object||!['symbol','footprint'].includes(object.kind)||!object.reference)return null;
  let path=tstampPath(object);
  const placements=object.kind==='symbol'?symbolPaths(object):[];
  const paths=placements.filter(p=>instancePath?p.path===instancePath+'/'+object.uuid:p.reference===object.reference);
  if(paths.length===1)path=paths[0].path;
  const linked=symbolUuid(object),selection={kind:'part',reference:object.reference,path:object.path,...(object.uuid?{uuid:object.uuid}:{}),...(linked?{symbolUuid:linked}:{}),...(path?{tstampPath:path}:{}),...(object.kind==='symbol'&&rootId(object)?{rootUuid:rootId(object)}:{})};
  if(!validSelection(selection))return null;
  if(paths.length===1){
   const unitPaths=packageSiblings(object,objects,path).map(unit=>unit.path);
   if(unitPaths.length&&(instancePath||placements.length===1&&!reusedSheet(object.path,objects))&&
    validUnitPaths(unitPaths,selection))selection.unitPaths=unitPaths;
  }
  return selection;
 }
 function symbolUuid(object){
  if(object?.association)return tstampPath(object)?.split('/').at(-1)||null;
  const form=object?.saved?.tree;if(!Array.isArray(form))return null;
  const path=form.find(v=>Array.isArray(v)&&v[0]==='path');
  const value=text(path?.[1]);return typeof value==='string'&&value.length<=2000?value.split('/').filter(Boolean).at(-1)||null:null;
 }
 function validSelection(value){
  if(value?.kind==='group'){
   if(Object.keys(value).some(k=>!['kind','items'].includes(k))||!Array.isArray(value.items)||value.items.length>MAX_GROUP_ITEMS)return false;
   const budget=groupBudget();
   for(const item of value.items)if(!item||item.kind==='group'||!validSelection(item)||!reserveGroupCost(budget,groupCost(item)))return false;
   return true;
  }
  if(!value||typeof value!=='object'||!['part','net','pin','object'].includes(value.kind))return false;
  if(!bounded(value.path,1000)||!/^.+\.kicad_(?:sch|pcb)$/i.test(value.path)||value.path.startsWith('/')||value.path.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))return false;
  if(value.kind==='object')return Object.keys(value).every(k=>['kind','path','uuid'].includes(k))&&bounded(value.uuid,200);
  const keys=value.kind==='pin'?['kind','reference','path','uuid','ownerUuid','symbolUuid','pinNumber','tstampPath','rootUuid','unitPaths']:value.kind==='part'?['kind','reference','path','uuid','symbolUuid','tstampPath','rootUuid','unitPaths']:['kind','netName','qualifiedNetName','path','terminals'];if(Object.keys(value).some(k=>!keys.includes(k)))return false;
  if(value.rootUuid!==undefined&&(typeof value.rootUuid!=='string'||value.rootUuid.length<1||value.rootUuid.length>200||/[\\/:\x00-\x1f\x7f]/.test(value.rootUuid)))return false;
  if(value.tstampPath!==undefined&&(!nativePath(value.tstampPath)||value.symbolUuid&&value.tstampPath.split('/').at(-1)!==value.symbolUuid||/\.kicad_sch$/i.test(value.path)&&value.kind==='part'&&value.uuid&&value.tstampPath.split('/').at(-1)!==value.uuid))return false;
  if(value.kind==='net')return bounded(value.netName,500)&&(value.qualifiedNetName===undefined||bounded(value.qualifiedNetName,500))&&
   (value.terminals===undefined||validTerminals(value.terminals,value.path));
  if(value.kind==='pin'&&(!bounded(value.pinNumber,200)||(value.ownerUuid!==undefined&&!bounded(value.ownerUuid,200))))return false;
  if(value.unitPaths!==undefined&&!validUnitPaths(value.unitPaths,value))return false;
  return bounded(value.reference,200)&&(value.uuid===undefined||bounded(value.uuid,200))&&(value.symbolUuid===undefined||bounded(value.symbolUuid,200));
 }
 function unitPathText(paths){return paths?.reduce((size,path)=>size+path.length,0)||0;}
 function validUnitPaths(paths,selection){
  if(!/\.kicad_sch$/i.test(selection.path)||!nativePath(selection.tstampPath)||
   !Array.isArray(paths)||!paths.length||paths.length>MAX_UNIT_PATHS)return false;
  const segments=selection.tstampPath.split('/'),uuid=selection.kind==='pin'?selection.ownerUuid:(selection.uuid);
  if(segments.length<3||!uuid||segments.at(-1)!==uuid)return false;
  const projectRoot=segments[1],ids=new Set([uuid]);
  let size=0;
  for(const path of paths){
   if(!nativePath(path))return false;
   const sibling=path.split('/'),id=sibling.at(-1);
   size+=path.length;
   if(sibling.length<3||sibling[1]!==projectRoot||!bounded(id,200)||ids.has(id)||size>MAX_UNIT_PATH_TEXT)return false;
   ids.add(id);
  }
  return true;
 }
 function terminalText(terminals){
  return terminals?.reduce((sum,terminal)=>sum+Object.values(terminal).reduce((size,value)=>
   size+(Array.isArray(value)?unitPathText(value):value?.length||0),0),0)||0;
 }
 const groupBudget=()=>({terminals:0,text:0,bytes:'{"kind":"group","items":[]}'.length});
 function groupCost(item){
  return {terminals:item.terminals?.length||0,text:item.kind==='net'?terminalText(item.terminals):unitPathText(item.unitPaths),
   bytes:new TextEncoder().encode(JSON.stringify(item)).byteLength+1};
 }
 function reserveGroupCost(budget,cost){
  if(budget.terminals+cost.terminals>MAX_GROUP_TERMINALS||budget.text+cost.text>MAX_GROUP_EVIDENCE_TEXT||
   budget.bytes+cost.bytes>MAX_GROUP_BYTES)return false;
  budget.terminals+=cost.terminals;
  budget.text+=cost.text;
  budget.bytes+=cost.bytes;
  return true;
 }
 function groupSelection(items){
  const budget=groupBudget(),accepted=[];
  let omittedEvidence=0;
  for(const item of items){
   if(accepted.length===MAX_GROUP_ITEMS)break;
   if(!item||item.kind==='group'||!validSelection(item))continue;
   const {terminals,unitPaths,...identity}=item,base=groupCost(identity);
   if(reserveGroupCost(budget,base))accepted.push({item,identity,base});
  }
  const selection={kind:'group',items:accepted.map(({item,identity,base})=>{
   if(!item.terminals&&!item.unitPaths)return item;
   const evidence=groupCost(item);
   if(reserveGroupCost(budget,{...evidence,bytes:evidence.bytes-base.bytes}))return item;
   omittedEvidence++;
   return identity;
  })};
  return {selection,omittedItems:items.length-accepted.length,omittedEvidence};
 }
 function terminalPart({pinNumber,...identity},path){
  return {...identity,kind:'part',path};
 }
 function validTerminals(terminals,path){
  if(!Array.isArray(terminals)||!terminals.length||terminals.length>MAX_TERMINALS)return false;
  for(const terminal of terminals){
   if(!terminal||typeof terminal!=='object'||Array.isArray(terminal)||'kind' in terminal||'path' in terminal||
    !bounded(terminal.pinNumber,200)||!(terminal.uuid||terminal.tstampPath)||!validSelection(terminalPart(terminal,path)))return false;
  }
  return terminalText(terminals)<=MAX_TERMINAL_TEXT;
 }
 const identityConflict=error=>({error,identityConflict:true});
 function relatedPart(objects,selection){
  if(!validSelection(selection)||selection.kind!=='part')return {error:'Invalid cross-highlight selection.'};
  const board=/\.kicad_sch$/i.test(selection.path),kind=board?'footprint':'symbol';
  const parts=objects.filter(o=>o.kind===kind);
  if(parts.some(o=>o.association?.complete===false&&(o.uuid===selection.symbolUuid||o.reference===selection.reference)))return identityConflict('Saved component association exceeds its identity budget; select the target explicitly.');
  const sourceId=board?selection.uuid:selection.symbolUuid;
  let linked=sourceId?parts.filter(o=>(board?symbolUuid(o):o.uuid)===sourceId):[];
  if(selection.tstampPath){
   const unitPaths=selection.unitPaths||[],unitIds=new Set(unitPaths.map(path=>path.split('/').at(-1)));
   const hasRelatedPart=linked.length||parts.some(o=>o.reference===selection.reference||board&&unitIds.has(symbolUuid(o)));
   linked=parts.filter(o=>board?matchesBoardPath(tstampPath(o),selection,unitPaths):o.uuid===selection.tstampPath.split('/').at(-1)&&(symbolPaths(o).some(p=>sameInstancePath(p.path,selection.tstampPath,rootId(o)))||!symbolPaths(o).length&&!reusedSheet(o.path,objects)&&(!rootId(o)||selection.tstampPath==='/'+o.uuid||selection.tstampPath==='/'+rootId(o)+'/'+o.uuid)));
   if(!board&&linked.some(o=>symbolPaths(o).length>1&&selection.tstampPath.split('/').length===2))return identityConflict('Multiple saved instances match this source identity. Select the target sheet explicitly.');
   if(!board&&linked.length===1){const placements=symbolPaths(linked[0]).filter(p=>sameInstancePath(p.path,selection.tstampPath,rootId(linked[0])));if(placements.length>1||placements[0]?.reference&&placements[0].reference!==linked[0].reference)return identityConflict('This saved sheet instance has a different reference. Select the target sheet explicitly.');}
   if(!linked.length){
    const error='Saved schematic instance does not match this drawing; select the target sheet explicitly.';
    return hasRelatedPart?identityConflict(error):{error};
   }
  }else if(!board&&linked.length===1&&(symbolPaths(linked[0]).length>1||reusedSheet(linked[0].path,objects)))return identityConflict('Multiple saved instances match this source identity. Select the target sheet explicitly.');
  if(linked.length===1)return {object:linked[0]};
  if(linked.length>1)return identityConflict('Multiple saved instances match this source identity. Select the target sheet explicitly.');
  const refs=parts.filter(o=>o.reference===selection.reference);
  if(refs.length>1)return identityConflict('Reference is ambiguous across units or sheets. Select the target explicitly.');
  if(!refs.length)return {error:'No matching part in this drawing.'};
  if(!board&&(symbolPaths(refs[0]).length>1||reusedSheet(refs[0].path,objects)))return identityConflict('Reference is ambiguous across saved sheet instances. Select the target explicitly.');
  // A saved link that disagrees is evidence against reference-only matching.
  if(sourceId&&(board?symbolUuid(refs[0]):selection.symbolUuid))return identityConflict('Saved schematic identity does not match this part; update the design association.');
  return {object:refs[0]};
 }
 function matchesBoardPath(path,selection,unitPaths){
  return sameInstancePath(path,selection.tstampPath,selection.rootUuid)||
   unitPaths.some(unitPath=>sameInstancePath(path,unitPath,unitPath.split('/')[1]));
 }
 // Pin numbers establish electrical terminals only after resolving a unique saved parent.
 function relatedPin(objects,designs,selection){
  if(!validSelection(selection)||selection.kind!=='pin')return {error:'Invalid cross-highlight pin.'};
  const fromSchematic=/\.kicad_sch$/i.test(selection.path);
  const match=relatedPart(objects,{kind:'part',reference:selection.reference,path:selection.path,
   ...(fromSchematic&&(selection.ownerUuid||selection.uuid)?{uuid:selection.ownerUuid||selection.uuid}:{}),
   ...(!fromSchematic&&selection.symbolUuid?{symbolUuid:selection.symbolUuid}:{}),...(selection.tstampPath?{tstampPath:selection.tstampPath}:{}),...(selection.rootUuid?{rootUuid:selection.rootUuid}:{}),
   ...(selection.unitPaths?{unitPaths:selection.unitPaths}:{})});
  if(!match.object)return match;
  const findPrimitives=object=>{
   const design=designs instanceof Map?designs.get(object.path):Array.isArray(designs)?designs.find(d=>d.path===object.path):designs?.[object.path];
   return (design?.primitives||[]).filter(p=>!p.hidden&&!p.hole&&
    (fromSchematic?p.kind==='pad':p.kind==='pin')&&
    (fromSchematic?p.ownerUuid===object.uuid:(p.ownerUuid||p.uuid)===object.uuid)&&
    String(p.pinNumber??p.name??'')===selection.pinNumber);
  };
  const direct=findPrimitives(match.object);
  if(direct.length)return {object:match.object,primitives:direct,pinNumber:selection.pinNumber};
  if(!fromSchematic){
   const candidates=packageSiblings(match.object,objects,selection.tstampPath).map(({object})=>({object,primitives:findPrimitives(object),pinNumber:selection.pinNumber})).filter(item=>item.primitives.length);
   if(candidates.length===1)return candidates[0];
   if(candidates.length>1)return {error:'Multiple saved units contain this pin. Select the target explicitly.'};
  }
  return {error:'The corresponding saved pin/pad number is unavailable in the paired drawing.'};
 }
 function sheetTarget(object){
  const name=object.properties?.Sheetfile??object.properties?.['Sheet file'];
  if(typeof name!=='string'||!name||name.startsWith('/')||/[\\:\x00-\x1f]/.test(name))return null;
  const parts=object.path.split('/');parts.pop();
  for(const part of name.split('/')){if(part==='..'){if(!parts.length)return null;parts.pop();}else if(part&&part!=='.')parts.push(part);}
  return parts.join('/');
 }
 function reusedSheet(path,objects){
  const seen=new Set();let current=path;
  while(!seen.has(current)&&seen.size<32){seen.add(current);const parents=objects.filter(o=>o.kind==='sheet'&&sheetTarget(o)===current);if(parents.length>1)return true;if(!parents.length)return false;current=parents[0].path;}
  return true;
 }
 // Only a single saved hierarchy instance can provide a safe local-net prefix.
 function sheetPrefix(path,objects){
  const seen=new Set();let current=path,prefix=[];
  while(!seen.has(current)&&seen.size<32){
   seen.add(current);const parents=objects.filter(o=>o.kind==='sheet'&&sheetTarget(o)===current);
   if(!parents.length)return '/'+(prefix.length?prefix.join('/')+'/':'');
   if(parents.length!==1)return null;
   const parent=parents[0],name=parent.properties?.Sheetname??parent.properties?.['Sheet name'];
   if(typeof name!=='string'||!name||/[\/\x00-\x1f]/.test(name))return null;
   prefix.unshift(name);current=parent.path;
  }
  return null;
 }
 function qualifiedNetName(net,objects){
  if(net?.kind==='pcb')return net.name;
  const prefix=sheetPrefix(net?.path||'',objects);
  return prefix&&typeof net?.name==='string'&&!net.name.startsWith('Unnamed network (')?prefix+net.name:null;
 }
 function sourceTerminals(net,objects,{instancePath}={},limit=MAX_TERMINALS){
  if(!Array.isArray(net.members)||net.members.length>MAX_NET_MEMBERS)return [];
  const schematic=/\.kicad_sch$/i.test(net.path),kind=schematic?'symbol':'footprint';
  const parents=new Map(),terminals=new Map();
  const key=(ref,uuid)=>JSON.stringify([ref,schematic?uuid:null]);
  for(const object of objects){
   if(object.path!==net.path||object.kind!==kind)continue;
   const id=key(object.reference,object.uuid);
   parents.set(id,parents.has(id)?null:object);
  }
  const repeated=schematic&&reusedSheet(net.path,objects);
  for(const member of net.members){
   if(member?.kind!==(schematic?'pin':'pad')||!member.reference)continue;
   const pinNumber=String((schematic?member.pin:member.pad)??'');
   if(!bounded(pinNumber,200))continue;
   const parent=parents.get(key(member.reference,member.uuid));
   if(!parent||parent.association?.complete===false)continue;
   const selection=partSelection(parent,{instancePath,objects});
   if(!selection||!(selection.uuid||selection.tstampPath))continue;
   if(schematic&&(repeated||symbolPaths(parent).length>1)&&
    (!instancePath||selection.tstampPath!==instancePath+'/'+parent.uuid))continue;
   const {kind,path,...identity}=selection,terminal={...identity,pinNumber};
   terminals.set(JSON.stringify(terminal),terminal);
   // An incomplete sample could hide a contradictory terminal.
   if(terminals.size>limit)return [];
  }
  return [...terminals.values()];
 }
 function netSelection(net,objects,context={}){
  if(!net)return null;
  const qualified=qualifiedNetName(net,objects);
  const selection={kind:'net',path:net.path,netName:net.name,...(qualified?{qualifiedNetName:qualified}:{})};
  if(!validSelection(selection))return null;
  const terminals=sourceTerminals(net,objects,context);
  return validTerminals(terminals,net.path)?{...selection,terminals}:selection;
 }
 function relatedNet(nets,objects,selection,currentPath){
  if(!validSelection(selection)||selection.kind!=='net')return {error:'Invalid cross-highlight network.'};
  const board=/\.kicad_sch$/i.test(selection.path),targets=nets.filter(n=>board?n.kind==='pcb':n.kind==='schematic');
  const names=n=>[n.name,...(Array.isArray(n.names)?n.names:[])];
  const exact=targets.filter(n=>names(n).includes(selection.netName));
  const qualified=targets.filter(n=>board?names(n).includes(selection.qualifiedNetName):names(n).some(name=>{const prefix=sheetPrefix(n.path,objects);return prefix&&prefix+name===selection.netName;}));
  // Qualified saved hierarchy wins over same-named local labels elsewhere.
  let matches=board?[...new Set([...qualified,...exact])]:qualified.length?qualified:exact;
  if(!qualified.length&&currentPath){const local=matches.filter(n=>n.path===currentPath);if(local.length===1)matches=local;}
  if(matches.length>1)return {error:'The related net is ambiguous across sheets or saved instances. Choose its sheet explicitly.'};
  const named=matches[0];
  if(selection.terminals){
   // A board net may span several sheets. Check named matches against terminals
   // on the same sheet before treating another occurrence as a disagreement.
   const mapped=matchTerminalNet(targets,objects,selection.path,selection.terminals,named?.path);
   if(!named)return mapped;
   if(mapped.identityConflict||mapped.net&&mapped.net!==named)return {error:'Saved network name and terminals disagree in the paired drawing.'};
  }
  return named?{net:named}:{error:'No matching saved net in the paired drawing.'};
 }
 // Match terminal numbers only after resolving the corresponding saved part.
 function matchTerminalNet(targets,objects,path,terminals,namedPath){
  const board=/\.kicad_sch$/i.test(path),kind=board?'footprint':'symbol';
  const parts=objects.filter(o=>o.kind==='sheet'||o.kind===kind&&(!board||!namedPath||o.path===namedPath));
  const partRefs=new Map();
  if(board)for(const part of parts)if(part.kind===kind){
   const ref=JSON.stringify([part.path,part.reference]);
   partRefs.set(ref,(partRefs.get(ref)||0)+1);
  }
  let candidates=null,conflict=false;
  for(const terminal of terminals){
   const match=relatedPart(parts,terminalPart(terminal,path)),target=match.object;
   if(!target){
    if(match.identityConflict&&(!namedPath||board||parts.some(o=>o.path===namedPath&&(o.uuid===terminal.symbolUuid||o.reference===terminal.reference))))conflict=true;
    continue;
   }
   if(board&&partRefs.get(JSON.stringify([target.path,target.reference]))!==1){conflict=true;continue;}
   const units=board?[]:packageSiblings(target,objects,terminal.tstampPath);
   const matches=targets.filter(n=>(!namedPath||n.path===namedPath)&&n.members?.some(m=>board?
    n.path===target.path&&m.kind==='pad'&&m.reference===target.reference&&String(m.pad)===terminal.pinNumber:
    m.kind==='pin'&&String(m.pin)===terminal.pinNumber&&
     (n.path===target.path&&m.uuid===target.uuid||units.some(u=>u.object.path===n.path&&u.object.uuid===m.uuid))));
   if(!matches.length)continue;
   candidates=candidates===null?matches:candidates.filter(n=>matches.includes(n));
   if(!candidates.length)return identityConflict('Saved terminals disagree about the related net.');
  }
  if(conflict)return identityConflict(candidates?.length?
   'Saved terminal identity is ambiguous or disagrees with the paired drawing.':
   'No matching saved terminals: component identity is ambiguous or disagrees with the paired drawing.');
  if(candidates?.length===1)return {net:candidates[0]};
  return candidates?.length?identityConflict('The related terminal net is ambiguous. Choose its sheet explicitly.'):
   {error:'No matching saved terminals in the paired drawing.'};
 }
 function relatedNetByTerminals(nets,objects,selection,sourceNet,context={}){
  if(!validSelection(selection)||selection.kind!=='net'||sourceNet?.path!==selection.path||
   sourceNet.name!==undefined&&sourceNet.name!==selection.netName||
   !Array.isArray(sourceNet.members)||sourceNet.members.length>MAX_NET_MEMBERS)return {error:'No source-bound terminal evidence for this net.'};
  const board=/\.kicad_sch$/i.test(selection.path),targets=nets.filter(n=>board?n.kind==='pcb':n.kind==='schematic');
  return matchTerminalNet(targets,objects,selection.path,sourceTerminals(sourceNet,objects,context,MAX_NET_MEMBERS));
 }
 function relatedGroup(objects,nets,selection,currentFile){
  const result={objects:[],nets:[],errors:[]};
  if(!validSelection(selection)||selection.kind!=='group'){result.errors.push('Invalid cross-highlight group.');return result;}
  const matchedObjects=new Set(),matchedNets=new Set(),errors=new Set();
  for(const item of selection.items){
   // A group spans sheets: the currently displayed sheet must not resolve an
   // otherwise ambiguous local name on behalf of the whole selection.
   const match=item.kind==='part'?relatedPart(objects,item):item.kind==='pin'?{error:'Pin groups require drawing geometry; select one terminal explicitly.'}:relatedNet(nets,objects,item);
   if(match.object)matchedObjects.add(match.object);
   if(match.net)matchedNets.add(match.net);
   if(match.error)errors.add(match.error);
  }
  result.objects=[...matchedObjects];result.nets=[...matchedNets];result.errors=[...errors];
  return result;
 }
 root.KiCadPairedReview={validSelection,relatedPart,relatedPin,symbolUuid,tstampPath,partSelection,sheetPrefix,qualifiedNetName,netSelection,groupSelection,relatedNet,relatedNetByTerminals,relatedGroup};
 if(typeof module==='object'&&module.exports)module.exports=root.KiCadPairedReview;
})(globalThis);
