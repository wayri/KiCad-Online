/* Bounded JSON replies for hosts whose message channel cannot carry a whole source. */
((root)=>{
 'use strict';
 const MiB=1024*1024,MAX_CHARS=512*MiB,MAX_CHUNK=MiB,MAX_PARTS=1024,MAX_TTL=60000;
 const MARKER='__kicadChunkedReply',TOKEN=/^[a-f0-9]{32}$/;
 const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
 const aborted=()=>Object.assign(Error('Chunked reply cancelled.'),{name:'AbortError'});
 function checkSignal(signal){if(signal?.aborted)throw aborted();}
 function limits({maxChars=MAX_CHARS,chunkChars=MAX_CHUNK,inlineChars=MAX_CHUNK}={}){
  if(!integer(maxChars,1,MAX_CHARS)||!integer(chunkChars,1,MAX_CHUNK)||!integer(inlineChars,0,MAX_CHUNK))throw Error('Invalid chunked reply limits.');
  return{maxChars,chunkChars,inlineChars};
 }
 function randomToken(){
  if(!root.crypto?.getRandomValues)throw Error('Secure random tokens are unavailable.');
  return Array.from(root.crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
 }
 function ownerKey(owner){if(typeof owner!=='string'||!owner||owner.length>4096)throw Error('Invalid chunked reply owner.');return owner;}
 function createStore(options={}){
  const {maxChars,chunkChars,inlineChars}=limits(options),{ttl=MAX_TTL,now=Date.now,random=randomToken,setTimer=root.setTimeout?.bind(root),clearTimer=root.clearTimeout?.bind(root)}=options;
  if(!integer(ttl,1,MAX_TTL)||typeof now!=='function'||typeof random!=='function'||typeof setTimer!=='function'||typeof clearTimer!=='function')throw Error('Invalid chunked reply lifetime, timer, or token source.');
  const entries=new Map();let retainedChars=0;
  function clock(){const time=now();if(!Number.isFinite(time))throw Error('Invalid chunked reply clock.');return time;}
  function remove(token){const entry=entries.get(token);if(entry){clearTimer(entry.timer);retainedChars-=entry.text.length;entries.delete(token);}}
  function purge(){const time=clock();for(const [token,entry]of entries)if(time>=entry.expires)remove(token);}
  function lookup(token,owner){
   ownerKey(owner);purge();
   const entry=entries.get(token);
   if(typeof token!=='string'||!TOKEN.test(token)||!entry||entry.token!==token||entry.owner!==owner)throw Error('Chunked reply is unavailable, expired, or belongs to another caller.');
   return entry;
  }
  return{
   encode(value,owner){
    ownerKey(owner);purge();
    const text=JSON.stringify(value);
    if(typeof text!=='string')throw Error('Reply must be JSON serializable.');
    if(text.length>maxChars)throw Error('Serialized reply exceeds the chunked reply character limit.');
    if(text.length<=inlineChars)return value;
    if(entries.size>=4||retainedChars+text.length>maxChars)throw Error('Large reply delivery budget is full. Retry after active replies complete.');
    const parts=Math.ceil(text.length/chunkChars);
    if(parts>MAX_PARTS)throw Error('Reply exceeds the maximum chunk count.');
    const token=random();if(typeof token!=='string'||!TOKEN.test(token))throw Error('Invalid secure reply token.');
    if(entries.has(token))throw Error('Secure reply token collision. Retry the request.');
    const entry={token,owner,text,parts,expires:clock()+ttl,timer:null};
    entries.set(token,entry);retainedChars+=text.length;
    try{entry.timer=setTimer(()=>remove(token),ttl);entry.timer?.unref?.();}catch(error){remove(token);throw error;}
    return{[MARKER]:1,token,parts,totalChars:text.length,chunkChars};
   },
   read(token,index,owner){
    const current=lookup(token,owner);
    if(!integer(index,0,current.parts-1))throw Error('Invalid chunked reply index.');
    return{token,index,text:current.text.slice(index*chunkChars,(index+1)*chunkChars)};
   },
   drop(token,owner){
    ownerKey(owner);purge();
    if(typeof token!=='string'||!TOKEN.test(token))throw Error('Invalid chunked reply token.');
    const entry=entries.get(token);if(!entry)return{dropped:false};
    if(entry.token!==token||entry.owner!==owner)throw Error('Chunked reply belongs to another caller.');
    remove(token);return{dropped:true};
   },
  };
 }
 function isEnvelope(value){return Boolean(value&&typeof value==='object'&&Object.hasOwn(value,MARKER));}
 function requestWithSignal(request,message,signal,onLate){
  checkSignal(signal);
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(callback,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);callback(value);};
   const cancel=()=>finish(reject,aborted());
   signal?.addEventListener('abort',cancel,{once:true});
   Promise.resolve().then(()=>{checkSignal(signal);return request(message,{signal});}).then(value=>{
    if(settled){try{Promise.resolve(onLate?.(value)).catch(()=>{});}catch{}return;}
    finish(resolve,value);
   },error=>finish(reject,error));
  });
 }
 async function decode(value,request,options={}){
  const {signal}=options;
  if(!isEnvelope(value)){checkSignal(signal);return value;}
  const {maxChars,chunkChars}=limits(options);
  if(value[MARKER]!==1||typeof value.token!=='string'||!TOKEN.test(value.token)||!integer(value.parts,1,MAX_PARTS)||!integer(value.totalChars,1,maxChars)||!integer(value.chunkChars,1,chunkChars)||value.parts!==Math.ceil(value.totalChars/value.chunkChars)||typeof request!=='function')throw Error('Invalid chunked reply descriptor.');
  const {token,parts,totalChars,chunkChars:width}=value,chunks=[];
  try{
   for(let index=0;index<parts;index++){
    checkSignal(signal);
    const chunk=await requestWithSignal(request,{type:'chunk-read',token,index},signal);
    const expected=Math.min(width,totalChars-index*width);
    if(!chunk||chunk.token!==token||chunk.index!==index||typeof chunk.text!=='string'||chunk.text.length!==expected)throw Error('Invalid or incomplete chunked reply.');
    chunks.push(chunk.text);
   }
   checkSignal(signal);
   return JSON.parse(chunks.join(''));
  }finally{
   // Best-effort release must not make cancellation wait on an unresponsive host.
   // The server TTL also reclaims abandoned replies without another request.
   try{Promise.resolve(request({type:'chunk-drop',token},{})).catch(()=>{});}catch{}
  }
 }
 async function send(runtime,message,{signal}={}){
  if(typeof runtime?.sendMessage!=='function')throw Error('Reply messaging is unavailable.');
  const request=async message=>{
   const reply=await runtime.sendMessage({...message,type:'reply-chunk',action:message.type});
   if(reply?.ok!==true)throw Error(typeof reply?.error==='string'?reply.error.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500):'Chunked reply request failed.');
   return reply.result;
  };
  const value=await requestWithSignal(message=>runtime.sendMessage(message),{...message,acceptChunkedReply:true},signal,late=>isEnvelope(late)?decode(late,request,{signal}):undefined);
  return decode(value,request,{signal});
 }
 root.KiCadChunkedReplies={createStore,decode,isEnvelope,send};
 if(typeof module==='object'&&module.exports)module.exports=root.KiCadChunkedReplies;
})(globalThis);
