/* Attach saved native identities to owner-parser geometry without changing placement. */
import {padOccurrenceId,savedObjectId} from "./sourceIdentity.mjs";
const text=v=>v&&typeof v==='object'&&!Array.isArray(v)?v.quoted:v;
const child=(node,name)=>node.find(v=>Array.isArray(v)&&text(v[0])===name);
const children=(node,name)=>node.filter(v=>Array.isArray(v)&&text(v[0])===name);
export function sourceSelectionRecords(ast,board){
 const components=new Map(),pads=new Map(),duplicates=new Set();
 const add=(map,key,value)=>{if(typeof key!=='string'||!key||key.length>500)return;const token=(map===pads?'pad:':'part:')+key;if(duplicates.has(token))return;if(map.has(key)){map.delete(key);duplicates.add(token);}else map.set(key,value);};
 if(!Array.isArray(ast)||text(ast[0])!=='kicad_pcb')return {components:board.components||[],pads:board.pads||[]};
 const footprints=ast.filter(node=>Array.isArray(node)&&['footprint','module'].includes(text(node[0])));
 for(const [footprintIndex,fp] of footprints.entries()){
  const reference=text(children(fp,'property').find(p=>String(text(p[1])??'').toLowerCase()==='reference')?.[2])||text(children(fp,'fp_text').find(p=>text(p[1])==='reference')?.[2]);
  const uuid=savedObjectId(fp),tstampPath=text(child(fp,'path')?.[1]);
  const path=typeof tstampPath==='string'?{tstampPath,symbolUuid:tstampPath.split('/').filter(Boolean).at(-1)}:{};
  const parserId=uuid||'component-'+(reference||`REF${footprintIndex+1}`);
  add(components,parserId,{...path,...(uuid?{uuid}:{})});
  for(const [index,pad]of children(fp,'pad').entries()){
   const pinNumber=String(text(pad[1])??''),padUuid=savedObjectId(pad);
   const padId=padUuid||padOccurrenceId(footprintIndex,index);
   add(pads,padId,{...path,type:'Pad',...(typeof padUuid==='string'?{uuid:padUuid}:{}),...(typeof uuid==='string'?{ownerUuid:uuid}:{}),pinNumber,pinName:String(text(child(pad,'pinfunction')?.[1])??'')});
  }
 }
 return {components:(board.components||[]).map(record=>({...record,...components.get(record.id)})),pads:(board.pads||[]).map(record=>({...record,pinNumber:'',pinName:'',...pads.get(record.id)}))};
}
