/* Source-bound cross-probing; no coordinate mapping between PCB and schematic. */
((root)=>{
 'use strict';
 const text=v=>v&&typeof v==='object'?v.quoted:v;
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
 function partSelection(object,{instancePath}={}){
  if(!object||!['symbol','footprint'].includes(object.kind)||!object.reference)return null;
  let path=tstampPath(object);
  if(object.kind==='symbol'){const paths=symbolPaths(object).filter(p=>instancePath?p.path===instancePath+'/'+object.uuid:p.reference===object.reference);if(paths.length===1)path=paths[0].path;}
  const linked=symbolUuid(object),selection={kind:'part',reference:object.reference,path:object.path,...(object.uuid?{uuid:object.uuid}:{}),...(linked?{symbolUuid:linked}:{}),...(path?{tstampPath:path}:{}),...(object.kind==='symbol'&&rootId(object)?{rootUuid:rootId(object)}:{})};
  return validSelection(selection)?selection:null;
 }
 function symbolUuid(object){
  if(object?.association)return tstampPath(object)?.split('/').at(-1)||null;
  const form=object?.saved?.tree;if(!Array.isArray(form))return null;
  const path=form.find(v=>Array.isArray(v)&&v[0]==='path');
  const value=text(path?.[1]);return typeof value==='string'&&value.length<=2000?value.split('/').filter(Boolean).at(-1)||null:null;
 }
 function validSelection(value){
  if(value?.kind==='group'){
   if(Object.keys(value).some(k=>!['kind','items'].includes(k))||!Array.isArray(value.items)||value.items.length>200)return false;
   for(const item of value.items)if(!item||item.kind==='group'||!validSelection(item))return false;
   return true;
  }
  if(!value||typeof value!=='object'||!['part','net','pin','object'].includes(value.kind))return false;
  const bounded=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
  if(!bounded(value.path,1000)||!/^.+\.kicad_(?:sch|pcb)$/i.test(value.path)||value.path.startsWith('/')||value.path.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))return false;
  if(value.kind==='object')return Object.keys(value).every(k=>['kind','path','uuid'].includes(k))&&bounded(value.uuid,200);
  const keys=value.kind==='pin'?['kind','reference','path','uuid','ownerUuid','symbolUuid','pinNumber','tstampPath','rootUuid']:value.kind==='part'?['kind','reference','path','uuid','symbolUuid','tstampPath','rootUuid']:['kind','netName','qualifiedNetName','path'];if(Object.keys(value).some(k=>!keys.includes(k)))return false;
  if(value.rootUuid!==undefined&&(typeof value.rootUuid!=='string'||value.rootUuid.length<1||value.rootUuid.length>200||/[\\/:\x00-\x1f\x7f]/.test(value.rootUuid)))return false;
  if(value.tstampPath!==undefined&&(!nativePath(value.tstampPath)||value.symbolUuid&&value.tstampPath.split('/').at(-1)!==value.symbolUuid||/\.kicad_sch$/i.test(value.path)&&value.kind==='part'&&value.uuid&&value.tstampPath.split('/').at(-1)!==value.uuid))return false;
  if(value.kind==='net')return bounded(value.netName,500)&&(value.qualifiedNetName===undefined||bounded(value.qualifiedNetName,500));
  if(value.kind==='pin'&&(!bounded(value.pinNumber,200)||(value.ownerUuid!==undefined&&!bounded(value.ownerUuid,200))))return false;
  return bounded(value.reference,200)&&(value.uuid===undefined||bounded(value.uuid,200))&&(value.symbolUuid===undefined||bounded(value.symbolUuid,200));
 }
 function relatedPart(objects,selection){
  if(!validSelection(selection)||selection.kind!=='part')return {error:'Invalid cross-highlight selection.'};
  const board=/\.kicad_sch$/i.test(selection.path),kind=board?'footprint':'symbol';
  const parts=objects.filter(o=>o.kind===kind);
  if(parts.some(o=>o.association?.complete===false&&(o.uuid===selection.symbolUuid||o.reference===selection.reference)))return {error:'Saved component association exceeds its identity budget; select the target explicitly.'};
  const sourceId=board?selection.uuid:selection.symbolUuid;
  let linked=sourceId?parts.filter(o=>(board?symbolUuid(o):o.uuid)===sourceId):[];
  if(selection.tstampPath){
   linked=parts.filter(o=>board?sameInstancePath(tstampPath(o),selection.tstampPath,selection.rootUuid):o.uuid===selection.tstampPath.split('/').at(-1)&&(symbolPaths(o).some(p=>sameInstancePath(p.path,selection.tstampPath,rootId(o)))||!symbolPaths(o).length&&!reusedSheet(o.path,objects)&&(!rootId(o)||selection.tstampPath==='/'+o.uuid||selection.tstampPath==='/'+rootId(o)+'/'+o.uuid)));
   if(!board&&linked.some(o=>symbolPaths(o).length>1&&selection.tstampPath.split('/').length===2))return {error:'Multiple saved instances match this source identity. Select the target sheet explicitly.'};
   if(!board&&linked.length===1){const placements=symbolPaths(linked[0]).filter(p=>sameInstancePath(p.path,selection.tstampPath,rootId(linked[0])));if(placements.length>1||placements[0]?.reference&&placements[0].reference!==linked[0].reference)return {error:'This saved sheet instance has a different reference. Select the target sheet explicitly.'};}
   if(!linked.length)return {error:'Saved schematic instance does not match this drawing; select the target sheet explicitly.'};
  }else if(!board&&linked.length===1&&(symbolPaths(linked[0]).length>1||reusedSheet(linked[0].path,objects)))return {error:'Multiple saved instances match this source identity. Select the target sheet explicitly.'};
  if(linked.length===1)return {object:linked[0]};
  if(linked.length>1)return {error:'Multiple saved instances match this source identity. Select the target sheet explicitly.'};
  const refs=parts.filter(o=>o.reference===selection.reference);
  if(refs.length!==1)return {error:refs.length?'Reference is ambiguous across units or sheets. Select the target explicitly.':'No matching part in this drawing.'};
  if(!board&&(symbolPaths(refs[0]).length>1||reusedSheet(refs[0].path,objects)))return {error:'Reference is ambiguous across saved sheet instances. Select the target explicitly.'};
  // A saved link that disagrees is evidence against reference-only matching.
  if(sourceId&&(board?symbolUuid(refs[0]):selection.symbolUuid))return {error:'Saved schematic identity does not match this part; update the design association.'};
  return {object:refs[0]};
 }
 // Pin numbers establish electrical terminals only after resolving a unique saved parent.
 function relatedPin(objects,designs,selection){
  if(!validSelection(selection)||selection.kind!=='pin')return {error:'Invalid cross-highlight pin.'};
  const fromSchematic=/\.kicad_sch$/i.test(selection.path);
  const match=relatedPart(objects,{kind:'part',reference:selection.reference,path:selection.path,
   ...(fromSchematic&&(selection.ownerUuid||selection.uuid)?{uuid:selection.ownerUuid||selection.uuid}:{}),
   ...(!fromSchematic&&selection.symbolUuid?{symbolUuid:selection.symbolUuid}:{}),...(selection.tstampPath?{tstampPath:selection.tstampPath}:{}),...(selection.rootUuid?{rootUuid:selection.rootUuid}:{})});
  if(!match.object)return match;
  const object=match.object;
  const design=designs instanceof Map?designs.get(object.path):Array.isArray(designs)?designs.find(d=>d.path===object.path):designs?.[object.path];
  const primitives=(design?.primitives||[]).filter(p=>!p.hidden&&!p.hole&&
   (fromSchematic?p.kind==='pad':p.kind==='pin')&&
   (fromSchematic?p.ownerUuid===object.uuid:(p.ownerUuid||p.uuid)===object.uuid)&&
   String(p.pinNumber??p.name??'')===selection.pinNumber);
  if(!primitives.length)return {error:'The corresponding saved pin/pad number is unavailable in the paired drawing.'};
  return {object,primitives,pinNumber:selection.pinNumber};
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
 function relatedNet(nets,objects,selection,currentPath){
  if(!validSelection(selection)||selection.kind!=='net')return {error:'Invalid cross-highlight network.'};
  const board=/\.kicad_sch$/i.test(selection.path),targets=nets.filter(n=>board?n.kind==='pcb':n.kind==='schematic');
  const names=n=>[n.name,...(Array.isArray(n.names)?n.names:[])];
  const exact=targets.filter(n=>names(n).includes(selection.netName));
  const qualified=targets.filter(n=>board?names(n).includes(selection.qualifiedNetName):names(n).some(name=>{const prefix=sheetPrefix(n.path,objects);return prefix&&prefix+name===selection.netName;}));
  // Qualified saved hierarchy wins over same-named local labels elsewhere.
  let matches=board?[...new Set([...qualified,...exact])]:qualified.length?qualified:exact;
  if(!qualified.length&&currentPath){const local=matches.filter(n=>n.path===currentPath);if(local.length===1)matches=local;}
  return matches.length===1?{net:matches[0]}:{error:matches.length?'The related net is ambiguous across sheets or saved instances. Choose its sheet explicitly.':'No matching saved net in the paired drawing.'};
 }
 // Resolve unnamed/generated network labels through saved component terminals.
 // Every mapped terminal must agree; never guess by geometry or basename.
 function relatedNetByTerminals(nets,objects,selection,sourceNet,{instancePath}={}){
  if(!validSelection(selection)||selection.kind!=='net'||sourceNet?.path!==selection.path||!Array.isArray(sourceNet.members)||sourceNet.members.length>2048)return {error:'No source-bound terminal evidence for this net.'};
  const schematic=/\.kicad_sch$/i.test(selection.path),kind=schematic?'symbol':'footprint',targets=nets.filter(n=>schematic?n.kind==='pcb':n.kind==='schematic');let candidates=null,evidence=0;
  for(const member of sourceNet.members){const number=schematic?member.pin:member.pad;if(!number||!member.reference||member.kind!==(schematic?'pin':'pad'))continue;
   const sources=objects.filter(o=>o.path===selection.path&&o.kind===kind&&o.reference===member.reference&&(!schematic||o.uuid===member.uuid));if(sources.length!==1)continue;
   const canonical=partSelection(sources[0],{instancePath});if(!canonical)continue;const target=relatedPart(objects,canonical).object;if(!target)continue;
   const matches=targets.filter(n=>n.path===target.path&&n.members?.some(m=>schematic?m.kind==='pad'&&m.reference===target.reference&&String(m.pad)===String(number):m.kind==='pin'&&m.uuid===target.uuid&&String(m.pin)===String(number)));
   if(!matches.length)continue;evidence++;candidates=candidates===null?matches:candidates.filter(n=>matches.includes(n));
   if(!candidates.length)return {error:'Saved terminals disagree about the related net.'};
  }
  return evidence&&candidates?.length===1?{net:candidates[0]}:{error:candidates?.length?'The related terminal net is ambiguous. Choose its sheet explicitly.':'No matching saved terminals in the paired drawing.'};
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
 root.KiCadPairedReview={validSelection,relatedPart,relatedPin,symbolUuid,tstampPath,partSelection,sheetPrefix,qualifiedNetName,relatedNet,relatedNetByTerminals,relatedGroup};
 if(typeof module==='object'&&module.exports)module.exports=root.KiCadPairedReview;
})(globalThis);
