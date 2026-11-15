const test=require('node:test'),assert=require('node:assert/strict');
const {createStore,decode,isEnvelope,send}=require('../chunked-replies.js');
const owner='viewer:7',other='viewer:8',tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 let id=0;const store=createStore({maxChars:256,chunkChars:8,inlineChars:8,random:()=> (++id).toString(16).padStart(32,'0'),...options}),calls=[];
 const request=async message=>{calls.push(message);return message.type==='chunk-read'?store.read(message.token,message.index,owner):store.drop(message.token,owner);};
 return{store,calls,request};
}
test('inline boundary passes through and larger replies round trip exactly',async()=>{
 const {store,request,calls}=fixture();
 const small='123456';assert.equal(JSON.stringify(small).length,8);assert.equal(store.encode(small,owner),small);
 const value={source:'quotes " slash \\ newline\n emoji 😀 and lone \ud800',parts:[1,null,true]},envelope=store.encode(value,owner);
 assert.equal(isEnvelope(envelope),true);assert.deepEqual(await decode(envelope,request),value);
 assert.deepEqual(calls.filter(c=>c.type==='chunk-read').map(c=>c.index),Array.from({length:envelope.parts},(_,i)=>i));
 assert.equal(calls.at(-1).type,'chunk-drop');assert.throws(()=>store.read(envelope.token,0,owner),/unavailable/);
});
test('four large responses can coexist without eviction and owner isolation remains exact',()=>{
 const {store}=fixture(),value=store.encode({text:'source'},owner);
 for(let i=0;i<3;i++)store.encode('another large response',other);
 assert.throws(()=>store.encode('fifth large response',owner),/budget is full/);
 assert.equal(store.encode(1,owner),1);
 assert.throws(()=>store.read(value.token,0,other),/another caller/);assert.throws(()=>store.drop(value.token,other),/another caller/);
 assert.deepEqual(store.read(value.token,value.parts-1,owner),store.read(value.token,value.parts-1,owner));
 assert.throws(()=>store.read(value.token,-1,owner),/index/);assert.throws(()=>store.read(value.token,value.parts,owner),/index/);
 assert.deepEqual(store.drop(value.token,owner),{dropped:true});assert.deepEqual(store.drop(value.token,owner),{dropped:false});
 assert.ok(isEnvelope(store.encode('replacement reply',owner)));
});
test('aggregate character budget is refunded by drops and lazy expiry',()=>{
 let time=0;const {store}=fixture({maxChars:40,ttl:20,now:()=>time});
 const first=store.encode('x'.repeat(16),owner),second=store.encode('y'.repeat(16),other);
 assert.throws(()=>store.encode('z'.repeat(10),owner),/budget is full/);
 store.drop(first.token,owner);assert.ok(isEnvelope(store.encode('z'.repeat(10),owner)));
 time=20;assert.ok(isEnvelope(store.encode('fresh reply',owner)));assert.throws(()=>store.read(second.token,0,other),/expired/);
});
test('expiry lazily releases storage and invalid budgets or tokens are rejected',()=>{
 let time=0;const {store}=fixture({ttl:20,now:()=>time}),first=store.encode('first large reply',owner);
 time=19;assert.ok(store.read(first.token,0,owner));time=20;assert.throws(()=>store.read(first.token,0,owner),/expired/);
 assert.ok(isEnvelope(store.encode('second large reply',owner)));
 const bounded=fixture({maxChars:20}).store;assert.throws(()=>bounded.encode('x'.repeat(21),owner),/character limit/);
 for(const options of [{maxChars:0},{maxChars:513*1024*1024},{chunkChars:1024*1024+1},{inlineChars:-1},{ttl:60001}])assert.throws(()=>createStore(options),/Invalid/);
 assert.throws(()=>fixture({random:()=> 'bad'}).store.encode('long response',owner),/token/);
 assert.throws(()=>bounded.encode(undefined,owner),/serializable/);assert.throws(()=>bounded.encode('large response',''),/owner/);
});
test('malformed descriptors and reordered or truncated chunks fail closed and release storage',async()=>{
 for(const mutate of [e=>({...e,parts:0}),e=>({...e,totalChars:e.totalChars+8}),e=>({...e,token:'bad'}),e=>({...e,chunkChars:0}),e=>({...e,__kicadChunkedReply:2})]){
  const {store}=fixture(),envelope=store.encode('large response',owner);let calls=0;
  await assert.rejects(decode(mutate(envelope),()=>{calls++;}),/descriptor/);assert.equal(calls,0);
 }
 for(const mutate of [c=>({...c,index:c.index+1}),c=>({...c,token:'f'.repeat(32)}),c=>({...c,text:c.text.slice(1)})]){
  const {store,request,calls}=fixture(),envelope=store.encode({text:'large response'},owner);
  await assert.rejects(decode(envelope,async m=>m.type==='chunk-read'?mutate(await request(m)):request(m)),/incomplete/);
  assert.equal(calls.at(-1).type,'chunk-drop');assert.throws(()=>store.read(envelope.token,0,owner),/unavailable/);
 }
});
test('abort releases an envelope even when the read or cleanup ignores cancellation',async()=>{
 for(const preAborted of [false,true]){
  const {store}=fixture(),envelope=store.encode('large response',owner),controller=new AbortController(),calls=[];
  if(preAborted)controller.abort();
  const pending=decode(envelope,message=>{calls.push(message);return new Promise(()=>{});},{signal:controller.signal});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  if(!preAborted){await tick();controller.abort();}
  await rejected;assert.equal(calls.at(-1).type,'chunk-drop');
 }
});
test('malformed JSON and failed reads still request cleanup',async()=>{
 const {store,request,calls}=fixture(),envelope=store.encode('large response',owner);
 await assert.rejects(decode(envelope,async m=>m.type==='chunk-read'?{token:m.token,index:m.index,text:'!'.repeat(Math.min(envelope.chunkChars,envelope.totalChars-m.index*envelope.chunkChars))}:request(m)),SyntaxError);
 assert.equal(calls.at(-1).type,'chunk-drop');
 const next=store.encode('next large response',owner);
 await assert.rejects(decode(next,m=>{if(m.type==='chunk-read')throw Error('network failed');return request(m);}),/network failed/);
 assert.equal(calls.at(-1).type,'chunk-drop');
});
test('default chunks stay below Chrome message budget even with worst JSON escaping',()=>{
 const store=createStore(),value='\u0000'.repeat(180000),envelope=store.encode(value,owner);
 assert.ok(isEnvelope(envelope));assert.ok(envelope.totalChars>1024*1024);
 for(let index=0;index<envelope.parts;index++){
  const chunk=store.read(envelope.token,index,owner);assert.ok(chunk.text.length<=1024*1024);
  assert.ok(Buffer.byteLength(JSON.stringify(chunk))<7*1024*1024);
 }
 store.drop(envelope.token,owner);
});
test('send explicitly wraps followup messages without modifying runtime',async()=>{
 const {store}=fixture(),value={ok:true,result:{source:'large saved source'}},envelope=store.encode(value,owner),messages=[];
 const runtime={sendMessage:async message=>{messages.push(message);if(message.type==='load')return envelope;assert.equal(message.type,'reply-chunk');return{ok:true,result:message.action==='chunk-read'?store.read(message.token,message.index,owner):store.drop(message.token,owner)};}};
 const original=runtime.sendMessage;assert.deepEqual(await send(runtime,{type:'load'}),value);assert.equal(runtime.sendMessage,original);
 assert.equal(messages.at(-1).action,'chunk-drop');
});
test('send handles failed chunk wrappers with bounded plain error messages',async()=>{
 const {store}=fixture(),envelope=store.encode('large response',owner),messages=[];
 const runtime={sendMessage:async message=>{messages.push(message);return message.type==='load'?envelope:{ok:false,error:'denied\n'+'x'.repeat(600)};}};
 await assert.rejects(send(runtime,{type:'load'}),error=>error.message.length===500&&!error.message.includes('\n'));
 assert.equal(messages.at(-1).action,'chunk-drop');
});
test('scheduled expiry releases idle entries and drops cancel their timers',()=>{
 let id=0,unrefs=0;const timers=new Map();
 const {store}=fixture({maxChars:40,now:()=>0,setTimer:(callback,delay)=>{const timer={id:++id,unref(){unrefs++;}};timers.set(timer,{callback,delay});return timer;},clearTimer:timer=>timers.delete(timer)});
 const expired=store.encode('x'.repeat(16),owner),kept=store.encode('y'.repeat(16),other);
 assert.equal(timers.size,2);assert.equal(unrefs,2);assert.equal([...timers.values()][0].delay,60000);
 [...timers.values()][0].callback();assert.equal(timers.size,1);
 // Clock remains frozen: this verifies the scheduled release, not lazy purge.
 assert.throws(()=>store.read(expired.token,0,owner),/unavailable/);
 const replacement=store.encode('z'.repeat(16),owner);assert.equal(timers.size,2);
 store.drop(kept.token,other);store.drop(replacement.token,owner);assert.equal(timers.size,0);
});
test('initial send cancellation drops a valid descriptor arriving later without reading chunks',async()=>{
 const {store}=fixture(),controller=new AbortController(),messages=[];let finish;
 const runtime={sendMessage:message=>{messages.push(message);if(message.type==='load')return new Promise(resolve=>finish=resolve);assert.equal(message.action,'chunk-drop');return Promise.resolve({ok:true,result:store.drop(message.token,owner)});}};
 const pending=send(runtime,{type:'load'},{signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});
 await tick();assert.equal(messages[0].acceptChunkedReply,true);controller.abort();await rejected;
 const envelope=store.encode({ok:true,result:'late large saved source'},owner);finish(envelope);await tick();
 assert.equal(messages.length,2);assert.equal(messages[1].action,'chunk-drop');assert.equal(messages[1].token,envelope.token);
 assert.throws(()=>store.read(envelope.token,0,owner),/unavailable/);
});
