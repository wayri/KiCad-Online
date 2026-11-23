/* Bounded, binary PDF intake; no PDF actions or remote URLs are executed. */
((root)=>{'use strict';
 const LIMITS=Object.freeze({bytes:32*1024*1024,pages:5000,searchPages:500,textCharacters:4000000,canvasPixels:16000000,annotations:20000,annotationCharacters:32768,properties:128,members:256});
 function bytes(input){let data;if(input instanceof Uint8Array)data=input;else if(input instanceof ArrayBuffer)data=new Uint8Array(input);else if(input&&typeof input.base64==='string'){const raw=input.base64.replace(/[\r\n]/g,'');if(raw.length>Math.ceil(LIMITS.bytes/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))throw Error('Invalid or oversized PDF binary payload.');const decoded=root.atob(raw);data=Uint8Array.from(decoded,c=>c.charCodeAt(0));}else throw Error('PDF requires binary data.');
  if(!data.length||data.length>LIMITS.bytes)throw Error('PDF must be between 1 byte and 32 MiB.');
  const header=String.fromCharCode(...data.subarray(0,1024));if(!/%PDF-\d\.\d/.test(header))throw Error('This file does not have a PDF header.');return data;
 }
 function canvasScale(width,height,requested,dpr=1){if(![width,height,requested,dpr].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid PDF page dimensions.');return Math.min(requested*dpr,Math.sqrt(LIMITS.canvasPixels/(width*height)),8192/Math.max(width,height));}
 function pageNumber(value,total){if(!Number.isInteger(total)||total<1||total>LIMITS.pages)throw Error('PDF exceeds the 5,000-page limit.');const n=Number(value);if(!Number.isInteger(n)||n<1||n>total)throw Error('Choose a page from 1 to '+total+'.');return n;}
 const dangerous=new Set(['__proto__','constructor','prototype']);
 const short=(value,limit=512)=>typeof value==='string'&&value.length<=limit&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
 function metadata(contents){
  if(typeof contents!=='string'||!contents.startsWith('PocketKiVi/1\n')||contents.length>LIMITS.annotationCharacters)return null;
  try{
   const value=JSON.parse(contents.slice('PocketKiVi/1\n'.length));
   if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>dangerous.has(key))||!['component','net'].includes(value.kind)||!short(value.id)||!value.id)return null;
   const record={kind:value.kind,id:value.id,properties:{},members:[]};
   if(value.memberCount!==undefined){if(!Number.isSafeInteger(value.memberCount)||value.memberCount<0||value.memberCount>100000)return null;record.memberCount=value.memberCount;}
   for(const key of ['reference','name','path','netclass','value','footprint']){if(value[key]!==undefined){if(!short(value[key]))return null;record[key]=value[key];}}
   if(value.properties!==undefined){
    if(!value.properties||Array.isArray(value.properties)||typeof value.properties!=='object'||Object.keys(value.properties).length>LIMITS.properties)return null;
    for(const [key,item]of Object.entries(value.properties)){
     if(dangerous.has(key)||!short(key,128)||!key||!['string','number','boolean'].includes(typeof item)||typeof item==='number'&&!Number.isFinite(item))return null;
     const text=String(item);if(!short(text,2000))return null;record.properties[key]=text;
    }
   }
   if(value.members!==undefined){
    if(!Array.isArray(value.members)||value.members.length>LIMITS.members)return null;
    for(const member of value.members){
     if(!member||Array.isArray(member)||typeof member!=='object'||Object.keys(member).some(key=>dangerous.has(key)))return null;
     const accepted={};for(const key of ['reference','pin','pad','kind','uuid']){if(member[key]!==undefined){const text=(key==='pin'||key==='pad')&&typeof member[key]==='number'&&Number.isFinite(member[key])?String(member[key]):member[key];if(!short(text))return null;accepted[key]=text;}}
     if(Object.keys(accepted).length)record.members.push(accepted);
    }
   }
   if(record.memberCount!==undefined&&record.memberCount<record.members.length)return null;return record;
  }catch{return null;}
 }
 function annotationRect(rect,viewport){
  if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isFinite)||!viewport||![viewport.width,viewport.height].every(v=>Number.isFinite(v)&&v>0)||typeof viewport.convertToViewportRectangle!=='function')return null;
  const points=viewport.convertToViewportRectangle(rect);if(!Array.isArray(points)||points.length!==4||!points.every(Number.isFinite))return null;
  const left=Math.max(0,Math.min(points[0],points[2])),top=Math.max(0,Math.min(points[1],points[3])),right=Math.min(viewport.width,Math.max(points[0],points[2])),bottom=Math.min(viewport.height,Math.max(points[1],points[3]));
  if(right<=left||bottom<=top)return null;return{left,top,width:right-left,height:bottom-top};
 }
 function safeLink(value){try{if(!short(value,2048)||/[\x00-\x1f\x7f]/.test(value))return null;const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
 function interactions(annotations,viewport){
  if(!Array.isArray(annotations)||annotations.length>LIMITS.annotations)throw Error('PDF interactive annotations exceed the 20,000-item page limit.');
  const items=[];let invalid=0;
  for(const annotation of annotations){
   if(!annotation||annotation.subtype!=='Link')continue;
   const rect=annotationRect(annotation.rect,viewport);if(!rect)continue;
   const contents=annotation.contentsObj?.str??annotation.contents,record=metadata(contents);
   if(typeof contents==='string'&&contents.startsWith('PocketKiVi/1\n')&&!record)invalid++;
   const dest=typeof annotation.dest==='string'||Array.isArray(annotation.dest)?annotation.dest:null,url=safeLink(annotation.url);
   if(record||dest||url)items.push({rect,metadata:record,dest,url});
  }
  return{items,invalid};
 }
 const api={LIMITS,bytes,canvasScale,pageNumber,metadata,annotationRect,safeLink,interactions};root.KiCadPDFTools=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
