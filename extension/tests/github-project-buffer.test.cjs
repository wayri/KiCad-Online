const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../github-project-buffer.js'),repo='owner/project',sha='a'.repeat(40),sha2='b'.repeat(40),tick=()=>new Promise(r=>setImmediate(r));

test('foreground folder discovery fills three transport slots, preserves order and reuses the warm inventory',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),calls=[];let active=0,peak=0;const api=create({foregroundOnly:true,fetch:()=>assert.fail('No background fetch'),readSession:async(_repo,_ref,_action,path)=>{calls.push(path);if(path==='')return{sha,items:['a','b','c','d'].map(path=>({path,type:'directory'}))};active++;peak=Math.max(peak,active);await gate;active--;return{sha,items:[{path:path+'/board.kicad_sch',type:'file'}]};}});
 const flight=api.inventory(repo,sha);for(let i=0;i<8;i++)await tick();assert.deepEqual(calls,['','a','b','c']);assert.equal(peak,3);release();const result=await flight;assert.deepEqual(result.files.map(item=>item.path),['a/board.kicad_sch','b/board.kicad_sch','c/board.kicad_sch','d/board.kicad_sch']);assert.equal(peak,3);const count=calls.length;assert.deepEqual(await api.inventory(repo,sha),result);assert.equal(calls.length,count);api.dispose();
});

test('cancelling a parallel directory wave never caches late source results',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),controller=new AbortController();let children=0;const api=create({foregroundOnly:true,fetch:()=>assert.fail('No background fetch'),readSession:async(_repo,_ref,_action,path)=>{if(path==='')return{sha,items:['a','b','c'].map(path=>({path,type:'directory'}))};children++;await gate;return{sha,items:[{path:path+'/late.kicad_sch',type:'file'}]};}});
 const pending=api.inventory(repo,sha,controller.signal);for(let i=0;i<8;i++)await tick();assert.equal(children,3);controller.abort();await assert.rejects(pending,/cancelled/);api.clear();release();for(let i=0;i<8;i++)await tick();assert.equal(api.stats().bytes,0);assert.equal(api.stats().inFlight,0);api.dispose();
});
test('literal hash in a model filename does not abort foreground project discovery or asset reads',async()=>{
 const path='local/part/IC#PBF.STEP',reads=[],api=create({foregroundOnly:true,fetch:()=>{throw Error('No background reads');},readSession:async(repository,ref,action,directory)=>{
  reads.push({action,path:directory});if(action==='asset')return {sha,base64:'AAEC'};
  return {sha,items:directory===''?[{path:'board.kicad_pro',type:'file'},{path:'local',type:'directory'}]:directory==='local'?[{path:'local/part',type:'directory'}]:[{path,type:'file'}]};
 }});
 const inventory=await api.inventory(repo,sha);assert.ok(inventory.files.some(file=>file.path==='board.kicad_pro'));assert.ok(inventory.files.some(file=>file.path===path));
 assert.deepEqual(await api.asset(repo,sha,path,100),{base64:'AAEC'});assert.equal(reads.at(-1).path,path);api.dispose();
});
test('public hash filenames are encoded as path data and URL fragment redirects are rejected',async()=>{
 const path='models/IC#PBF.STEP',url='https://raw.githubusercontent.com/'+repo+'/'+sha+'/models/IC%23PBF.STEP';
 const api=create({readSession:async()=>null,fetch:async actual=>{assert.equal(actual,url);assert.equal(new URL(actual).hash,'');const response=new Response('model');Object.defineProperty(response,'url',{value:url});return response;}});
 assert.deepEqual(await api.asset(repo,sha,path,100),{base64:Buffer.from('model').toString('base64')});api.dispose();
 const wrong=create({readSession:async()=>null,fetch:async()=>{const response=new Response('wrong');Object.defineProperty(response,'url',{value:url+'#other'});return response;}});
 await assert.rejects(wrong.asset(repo,sha,path,100),/different source/);assert.equal(wrong.stats().bytes,0);wrong.dispose();
});
function setup({session,fetcher}={}){const calls=[],reads=[];let time=0,checks=0;const api=create({now:()=>time,assertNetwork:()=>{checks++;},readSession:async(...args)=>{reads.push(args.slice(0,5));return session?session(...args):{sha,items:[]};},fetch:async(...args)=>{calls.push(args);assert.equal(new URL(args[0]).hostname,'raw.githubusercontent.com');return fetcher?fetcher(...args):new Response('board');}});return {api,calls,reads,get checks(){return checks;},advance:ms=>time+=ms};}
test('pinned public files reuse successful bytes across file and asset with no API requests or credentials',async()=>{const h=setup();assert.equal(await h.api.file(repo,sha,'pcb/board.kicad_pcb',100),'board');assert.deepEqual(await h.api.asset(repo,sha,'pcb/board.kicad_pcb',100),{base64:'Ym9hcmQ='});assert.equal(h.calls.length,1);const [url,init]=h.calls[0];assert.equal(url,`https://raw.githubusercontent.com/${repo}/${sha}/pcb/board.kicad_pcb`);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);assert.equal(h.reads.length,0);assert.equal(h.checks,3);});
test('concurrent callers share raw reader and cancellation affects only one consumer',async()=>{let release;const response=new Promise(r=>release=r),h=setup({fetcher:()=>response}),controller=new AbortController();const first=h.api.file(repo,sha,'board',100,controller.signal),second=h.api.file(repo,sha,'board',100),asset=h.api.asset(repo,sha,'board',100);await tick();assert.equal(h.calls.length,1);controller.abort();await assert.rejects(first,/cancelled/);assert.equal(h.calls[0][1].signal.aborted,false);release(new Response('abc'));assert.equal(await second,'abc');assert.deepEqual(await asset,{base64:'YWJj'});});
test('mutable revisions refresh after30s, immutable metadata after30min, and returned trees cannot mutate cache',async()=>{let current=sha;const h=setup({session:async()=>({sha:current,items:[{path:'board',type:'file'}],token:'must strip'})});const first=await h.api.resolve(repo,'HEAD');assert.equal(first.sha,sha);assert.equal(first.token,undefined);first.items[0].path='changed';assert.equal((await h.api.resolve(repo,'HEAD')).items[0].path,'board');assert.equal(h.reads.length,1);current=sha2;h.advance(30000);assert.equal((await h.api.resolve(repo,'HEAD')).sha,sha2);assert.equal(h.reads.length,2);await h.api.resolve(repo,sha2);h.advance(1799999);await h.api.resolve(repo,sha2);assert.equal(h.reads.length,2);h.advance(1);await h.api.resolve(repo,sha2);assert.equal(h.reads.length,3);});
test('inventory fixes immutable snapshot, excludes symlinks/submodules and never follows foreign paths',async()=>{const h=setup({session:async(r,ref,action,path)=>({sha,items:path===''?[{path:'pcb',type:'directory'},{path:'link',type:'symlink'},{path:'vendor',type:'submodule'},{path:'readme.md',type:'file'}]:[{path:'pcb/board.kicad_pcb',type:'file'}]})});const a=await h.api.inventory(repo,'main');assert.equal(a.snapshotRef,sha);assert.deepEqual(a.files.map(f=>f.path),['pcb/board.kicad_pcb','readme.md']);assert.equal(h.reads[1][1],sha);a.files.length=0;assert.equal((await h.api.inventory(repo,'main')).files.length,2);const bad=setup({session:async()=>({sha,items:[{path:'../escape',type:'file'}]})});await assert.rejects(bad.api.inventory(repo,'main'),/Unsafe/);});
test('inventory traversal stops at64 directories and1000entries with explicit warnings',async()=>{const h=setup({session:async(r,ref,action,path)=>({sha,items:path===''?Array.from({length:70},(_,i)=>({path:'d'+i,type:'directory'})):[]})});const result=await h.api.inventory(repo,'main');assert.equal(h.reads.length,64);assert.match(result.warnings.join(' '),/incomplete/);const wide=setup({session:async(r,ref,action,path)=>({sha,items:path===''?[{path:'d',type:'directory'},...Array.from({length:999},(_,i)=>({path:'f'+i,type:'file'}))]:[{path:'d/unread',type:'file'}]})});assert.equal((await wide.api.inventory(repo,sha)).files.length,999);assert.equal(wide.reads.length,1);});
test('private text and binary fallback stay session-bound and never persist in cache',async()=>{const h=setup({fetcher:async()=>new Response('',{status:404}),session:async(r,ref,action)=>action==='asset'?{sha,base64:'AAEC'}:{sha,content:'private'}});assert.equal(await h.api.file(repo,sha,'private',100),'private');assert.equal(await h.api.file(repo,sha,'private',100),'private');assert.deepEqual(await h.api.asset(repo,sha,'asset',100),{base64:'AAEC'});assert.equal(h.api.stats().entries,0);assert.equal(h.reads.length,3);assert.ok(h.reads.every(r=>r[1]===sha));});
test('failures, invalidUTF8, byte overruns and mismatched sources never become cache successes',async()=>{let count=0;const h=setup({fetcher:async()=>{count++;return count===1?new Response(new Uint8Array([255])):new Response('okay');}});await assert.rejects(h.api.file(repo,sha,'board',100),/encoded|encoding/i);assert.equal(h.api.stats().entries,0);assert.equal(await h.api.file(repo,sha,'board',100),'okay');await assert.rejects(h.api.file(repo,sha,'board',2),/byte limit/);const large=setup({fetcher:async()=>new Response('ab',{headers:{'content-length':'9999'}})});await assert.rejects(large.api.file(repo,sha,'large',1),/byte limit/);assert.equal(large.api.stats().entries,0);const mismatch=setup({fetcher:async()=>{const r=new Response('x');Object.defineProperty(r,'url',{value:'https://evil.example/file'});return r;}});await assert.rejects(mismatch.api.file(repo,sha,'x',10),/different source/);});
test('strict scope and immutable download requirements reject before reading',async()=>{const h=setup();for(const args of [['../repo',sha,'a',10],[repo,'main','a',10],[repo,sha,'../secret',10],[repo,sha,'a%2fb',10],[repo,sha,'a',0],[repo,sha,'a',129*1024*1024]])await assert.rejects(h.api.file(...args));assert.equal(h.calls.length,0);assert.equal(h.reads.length,0);});
test('combined memory LRU enforces256entries and128MiB and refreshes used entries',async()=>{const h=setup();for(let i=0;i<256;i++)await h.api.file(repo,sha,'f'+i,100);await h.api.file(repo,sha,'f0',100);await h.api.file(repo,sha,'f256',100);assert.equal(h.api.stats().entries,256);const count=h.calls.length;await h.api.file(repo,sha,'f0',100);assert.equal(h.calls.length,count);await h.api.file(repo,sha,'f1',100);assert.equal(h.calls.length,count+1);assert.ok(h.api.stats().bytes<=128*1024*1024);h.api.clear();assert.equal(h.api.stats().bytes,0);});

test('byte budget evicts large immutable files even below entry cap',async()=>{const chunk=new Uint8Array(1024*1024).fill(97);const h=setup({fetcher:async()=>{let n=0;return new Response(new ReadableStream({pull(controller){if(n++<65)controller.enqueue(chunk);else controller.close();}}));}});await h.api.file(repo,sha,'large-a',70*1024*1024);assert.equal(h.api.stats().entries,1);assert.equal(h.api.stats().bytes,65*1024*1024);await h.api.file(repo,sha,'large-b',70*1024*1024);assert.equal(h.api.stats().entries,1);assert.equal(h.api.stats().bytes,65*1024*1024);h.api.clear();});

test('resolved HEAD root is reused by immutable inventory without another website read',async()=>{const h=setup({session:async()=>({sha,items:[{path:'board',type:'file'}]})});await h.api.resolve(repo,'HEAD');assert.equal((await h.api.inventory(repo,sha)).files[0].path,'board');assert.equal(h.reads.length,1);h.api.dispose();});
test('clear aborts active flights and late results cannot repopulate cache',async()=>{let finish;const h=setup({session:()=>new Promise(r=>finish=r)}),pending=h.api.resolve(repo,'main');await tick();h.api.clear();await assert.rejects(pending,/cancelled/);finish({sha,items:[]});await tick();assert.equal(h.api.stats().entries,0);assert.equal(h.api.stats().inFlight,0);assert.equal(h.api.stats().activeDownloads,0);});
test('final consumer cancellation aborts the shared underlying reader and caches nothing',async()=>{let observed;const h=setup({fetcher:async(url,init)=>{observed=init.signal;return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))));}}),controller=new AbortController(),pending=h.api.file(repo,sha,'cancel',100,controller.signal);await tick();controller.abort();await assert.rejects(pending,/cancelled/);await tick();assert.equal(observed.aborted,true);assert.equal(h.api.stats().entries,0);assert.equal(h.api.stats().activeDownloads,0);});
test('expiry actively purges immutable bytes and dispose cancels timers',async()=>{let time=0,id=0;const timers=new Map(),api=create({readSession:async()=>({sha,items:[]}),fetch:async()=>new Response('bytes'),now:()=>time,setTimer:(callback,delay)=>{const n=++id;timers.set(n,{callback:()=>{timers.delete(n);callback();},delay});return n;},clearTimer:n=>timers.delete(n)});await api.file(repo,sha,'board',100);assert.equal(api.stats().bytes,5);time=1800000;const expiry=[...timers.values()].find(t=>t.delay===1800000);assert.ok(expiry);expiry.callback();assert.equal(api.stats().bytes,0);await api.file(repo,sha,'board2',100);api.dispose();assert.equal(timers.size,0);await assert.rejects(api.file(repo,sha,'new',100),/disposed/);});
test('three download slots, reserved-byte budget, queue and flight limits bound high concurrency',async()=>{const gates=[];const h=setup({session:(r,ref,action,path,limit,signal)=>new Promise((resolve,reject)=>{gates.push({resolve,signal});signal.addEventListener('abort',()=>reject(Error('aborted')));})});const pending=Array.from({length:45},(_,i)=>h.api.resolve(repo,'branch'+i).then(()=>null,error=>error.message));await tick();assert.equal(gates.length,3);assert.equal(h.api.stats().activeDownloads,3);assert.equal(h.api.stats().queued,32);assert.ok(h.api.stats().inFlight<=64);assert.ok(h.api.stats().reservedBytes<=128*1024*1024);h.api.clear();const messages=await Promise.all(pending);assert.ok(messages.some(m=>/queue is full/.test(m)));await tick();assert.equal(h.api.stats().reservedBytes,0);
const bytes=setup({fetcher:(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))))});const reads=Array.from({length:40},(_,i)=>bytes.api.file(repo,sha,'f'+i,80*1024*1024).catch(e=>e.message));await tick();assert.equal(bytes.api.stats().activeDownloads,1);assert.equal(bytes.api.stats().reservedBytes,80*1024*1024);assert.ok(bytes.api.stats().inFlight<=64);bytes.api.clear();const failures=await Promise.all(reads);assert.ok(failures.some(m=>/read limit/.test(m)));});


test('validated compact directory chains retain their marker through cache and navigate the exact descendant',async()=>{
 const h=setup({session:async(r,ref,action,path)=>({sha,items:path===''?[{path:'design/board',type:'directory',hasSimplifiedPath:true}]:path==='design/board'?[{path:'design/board/project.kicad_pro',type:'file'}]:[]})});
 const resolved=await h.api.resolve(repo,sha);assert.deepEqual(resolved.items,[{path:'design/board',type:'directory',hasSimplifiedPath:true}]);assert.deepEqual(await h.api.resolve(repo,sha),resolved);const result=await h.api.inventory(repo,sha);assert.deepEqual(result.files.map(f=>f.path),['design/board/project.kicad_pro']);assert.deepEqual(h.reads.map(read=>read[3]),['','design/board']);assert.equal(h.calls.length,0);h.api.dispose();
});

test('compact folder marker cannot authorize files, traversal, false markers or foreign descendants',async()=>{
 for(const bad of [{path:'base/child/new',type:'file',hasSimplifiedPath:true},{path:'base/child/new',type:'directory',hasSimplifiedPath:false},{path:'base/child/new',type:'directory',hasSimplifiedPath:1},{path:'elsewhere/child/new',type:'directory',hasSimplifiedPath:true},{path:'base/../escape',type:'directory',hasSimplifiedPath:true}]){
  const h=setup({session:async(r,ref,action,path)=>({sha,items:path===''?[{path:'base',type:'directory'}]:[bad]})});await assert.rejects(h.api.inventory(repo,sha),/Unsafe/);assert.ok(h.reads.every(read=>!read[3]||read[3]==='base'));h.api.dispose();
 }
});


test('private context is resolved through the client session before anonymous HTML and is never globally cached',async()=>{
 const calls=[],api=create({readSession:async(...args)=>{calls.push(args);return{repository:repo,ref:'feature/board',directory:'hw',sha,items:[{path:'hw/private.kicad_pcb',type:'file'}]};},fetch:async()=>{throw Error('Anonymous access must not run');}});for(let i=0;i<2;i++)assert.deepEqual(await api.context('https://github.com/'+repo+'/tree/feature/board/hw'),{repository:repo,ref:'feature/board',directory:'hw',sha});assert.equal(calls.length,2);assert.ok(calls.every(call=>call[0]===repo&&call[1]==='HEAD'&&call[2]==='context'&&call[3]==='tree/feature/board/hw'));assert.equal(api.stats().entries,0);api.dispose();
});

test('explicit private session denial never falls back to anonymous website or API access',async()=>{
 let fetched=0;const api=create({readSession:async()=>{throw Error('GitHub website access was denied (HTTP403).');},fetch:async()=>{fetched++;throw Error('No fallback');}});await assert.rejects(api.context('https://github.com/'+repo+'/tree/main/hw'),/access was denied/);assert.equal(fetched,0);assert.equal(api.stats().entries,0);api.dispose();
});

test('session context cannot change repository, requested branch directory or pinned tree identity',async()=>{
 const good={repository:repo,ref:'feature/board',directory:'hw',sha,items:[{path:'hw/private.kicad_pcb',type:'file'}]};for(const patch of [{repository:'foreign/repo'},{ref:'main'},{directory:'elsewhere'},{sha:'not-a-sha'},{items:[{path:'other/private.kicad_pcb',type:'file'}]}]){let fetched=0;const api=create({readSession:async()=>({...good,...patch}),fetch:async()=>{fetched++;}});await assert.rejects(api.context('https://github.com/'+repo+'/tree/feature/board/hw'),/Invalid|mismatched|Unsafe/);assert.equal(fetched,0);assert.equal(api.stats().entries,0);api.dispose();}
});

test('private text64MiB and asset32MiB ceilings are forwarded without token or private byte caching',async()=>{
 const limits=[],h=setup({fetcher:async()=>new Response('',{status:404}),session:async(r,ref,action,path,limit)=>{limits.push({action,limit});return action==='asset'?{sha,base64:'AAEC'}:{sha,content:'(kicad_pcb)'};}});await h.api.file(repo,sha,'board.kicad_pcb',64*1024*1024);await h.api.asset(repo,sha,'model.wrl',64*1024*1024);assert.deepEqual(limits,[{action:'file',limit:64*1024*1024},{action:'asset',limit:32*1024*1024}]);assert.equal(h.api.stats().entries,0);h.api.dispose();
});

test('cancelled private context cannot cache or return a late client-session result',async()=>{
 let finish;const api=create({readSession:()=>new Promise(resolve=>finish=resolve),fetch:async()=>{throw Error('No anonymous request');}}),controller=new AbortController(),pending=api.context('https://github.com/'+repo+'/tree/main/hw',controller.signal);await tick();controller.abort();await assert.rejects(pending,/cancelled/);finish({repository:repo,ref:'main',directory:'hw',sha,items:[]});await tick();assert.equal(api.stats().entries,0);api.dispose();
});


test('explicit website session denial survives pinned tree reads without anonymous retry',async()=>{
 for(const message of ['GitHub website access was denied (HTTP403).','Administrator policy prevents this project read.']){
  let fetched=0;const denied=Error(message),api=create({readSession:async()=>{throw denied;},fetch:async()=>{fetched++;return new Response('',{status:404});}});
  await assert.rejects(api.resolve(repo,sha),error=>error===denied);assert.equal(fetched,0);assert.equal(api.stats().entries,0);api.dispose();
 }
});

test('missing private website session explains same-profile recovery without changing revision',async()=>{
 const calls=[],reads=[],api=create({readSession:async(...args)=>{reads.push(args);return null;},fetch:async(url,init)=>{calls.push({url,init});return new Response('Not Found',{status:404});}});
 await assert.rejects(api.resolve(repo,sha),error=>error.status===404&&error.source==='github-website'&&/same browser profile/.test(error.message)&&/click the extension icon again/.test(error.message)&&/also uses HTTP 404/.test(error.message)&&error.accessIssue.message===error.message);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://github.com/'+repo+'/tree/'+sha);assert.equal(calls[0].init.credentials,'omit');assert.equal(reads.length,1);assert.equal(reads[0][1],sha);assert.equal(api.stats().entries,0);api.dispose();
});


test('foreground-only context, tree, source, model and history reads never fetch from the background',async()=>{
 let fetched=0;const reads=[],api=create({foregroundOnly:true,fetch:async()=>{fetched++;throw Error('Background fetch forbidden');},readSession:async(repository,ref,action,path,limit)=>{
  reads.push({repository,ref,action,path,limit});
  if(action==='context')return{repository,ref:'main',directory:'',sha,items:[{path:'hw',type:'directory'}]};
  if(action==='resolve')return{sha,items:[{path:'hw',type:'directory'}]};
  if(action==='directory')return{sha,items:path==='hw'?[{path:'hw/board.kicad_pcb',type:'file'},{path:'hw/model.step',type:'file'}]:[{path:'hw',type:'directory'}]};
  if(action==='file')return{sha,content:'(kicad_pcb)'};
  if(action==='asset')return{sha,base64:'AAEC'};
  if(action==='history')return{ref,content:'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:github.com,2008:Grit::Commit/'+sha+'</id><link href="https://github.com/'+repository+'/commit/'+sha+'"/><title>Saved board</title><updated>2026-11-03T00:00:00Z</updated><author><name>Tester</name></author></entry></feed>'};
  throw Error('Unexpected action');
 }});
 assert.equal((await api.context('https://github.com/'+repo)).sha,sha);
 assert.equal((await api.resolve(repo,'main')).sha,sha);
 assert.deepEqual((await api.inventory(repo,sha)).files.map(item=>item.path),['hw/board.kicad_pcb','hw/model.step']);
 assert.ok((await api.modelInventory(repo,sha,'hw/board.kicad_pcb')).files.some(item=>item.path==='hw/model.step'));
 assert.equal(await api.file(repo,sha,'hw/board.kicad_pcb',100),'(kicad_pcb)');assert.deepEqual(await api.asset(repo,sha,'hw/model.step',100),{base64:'AAEC'});
 assert.equal((await api.history(repo,sha)).commits.length,1);assert.equal(fetched,0);assert.ok(reads.every(item=>item.repository===repo));assert.ok(reads.filter(item=>!['context','history'].includes(item.action)).every(item=>item.ref===sha||item.action==='resolve'));api.dispose();
});

test('foreground-only private bytes share bounded temporary cache across source and asset reads',async()=>{
 let time=0,reads=0;const api=create({foregroundOnly:true,now:()=>time,readSession:async(repository,ref,action,path)=>{reads++;return action==='file'?{sha,content:'private'}:{sha,base64:'AAEC'};}});
 assert.equal(await api.file(repo,sha,'private.kicad_pcb',100),'private');assert.deepEqual(await api.asset(repo,sha,'private.kicad_pcb',100),{base64:Buffer.from('private').toString('base64')});
 assert.deepEqual(await api.asset(repo,sha,'model.step',100),{base64:'AAEC'});assert.deepEqual(await api.asset(repo,sha,'model.step',100),{base64:'AAEC'});assert.equal(reads,2);assert.equal(api.stats().bytes,10);
 await assert.rejects(api.file(repo,sha,'private.kicad_pcb',3),/byte limit/);assert.equal(reads,2);
 time=1800000;assert.equal(await api.file(repo,sha,'private.kicad_pcb',100),'private');assert.equal(reads,3);api.clear();assert.equal(api.stats().bytes,0);api.dispose();
});

test('foreground-only missing context and history need a website session and missing source is never cached',async()=>{
 let fetched=0,reads=0;const api=create({foregroundOnly:true,fetch:async()=>{fetched++;throw Error('Forbidden background fallback');},readSession:async()=>{reads++;return null;}});
 for(const work of [()=>api.context('https://github.com/'+repo),()=>api.resolve(repo,sha),()=>api.history(repo,sha)])await assert.rejects(work(),error=>error.code==='GITHUB_WEBSITE_SESSION_REQUIRED'&&error.status===0&&error.accessIssue.kind==='website-session-missing'&&/same signed-in browser profile/.test(error.message));
 for(let i=0;i<2;i++){assert.equal(await api.file(repo,sha,'missing.kicad_pcb',100),null);assert.equal(await api.asset(repo,sha,'missing.step',100),null);}
 assert.equal(reads,7);assert.equal(fetched,0);assert.equal(api.stats().entries,0);api.dispose();
});

test('foreground-only cancelled private source and invalid identity never enter the shared cache',async()=>{
 let done;const controller=new AbortController(),api=create({foregroundOnly:true,readSession:async()=>new Promise(resolve=>{done=resolve;})});
 const pending=api.file(repo,sha,'private.kicad_pcb',100,controller.signal);await tick();controller.abort();await assert.rejects(pending,/cancelled/);done({sha,content:'private'});await tick();assert.equal(api.stats().bytes,0);api.dispose();
 const invalid=create({foregroundOnly:true,readSession:async()=>({sha:'b'.repeat(40),content:'private'})});await assert.rejects(invalid.file(repo,sha,'private.kicad_pcb',100),/Invalid/);assert.equal(invalid.stats().entries,0);invalid.dispose();
});

test('scoped pinned inventory stays inside selected project and never requires repository root access',async()=>{
 const reads=[],api=create({foregroundOnly:true,readSession:async(repository,ref,action,path)=>{
  reads.push(path);if(path==='design')return {sha,items:[{path:'design/root.kicad_sch',type:'file'},{path:'design/sub',type:'directory'}]};
  if(path==='design/sub')return {sha,items:[{path:'design/sub/child.kicad_sch',type:'file'}]};
  throw Error('Unrelated root unavailable');
 }});
 const listing=await api.inventory(repo,sha,undefined,{directory:'design',scoped:true});
 assert.deepEqual(listing.files.map(f=>f.path),['design/root.kicad_sch','design/sub/child.kicad_sch']);
 assert.deepEqual(reads,['design','design/sub']);
 await api.inventory(repo,sha,undefined,{directory:'design',scoped:true});assert.equal(reads.length,2);
 await assert.rejects(api.inventory(repo,sha),/Unrelated root unavailable/);api.dispose();
});


test('pinned discovery reads an accessible project folder when the repository root is unavailable',async()=>{
 const reads=[],api=create({foregroundOnly:true,readSession:async(repository,ref,action,path)=>{reads.push({ref,action,path});assert.equal(ref,sha);assert.equal(action,'directory');if(path==='')throw Error('Website access unavailable');return{sha,items:[{path:'design/root.kicad_sch',type:'file'}]};}});
 const result=await api.inventory(repo,sha,undefined,{directory:'design'});assert.deepEqual(result.files.map(f=>f.path),['design/root.kicad_sch']);assert.match(result.warnings.join(' '),/incomplete/);assert.equal(reads.some(r=>r.action==='resolve'),false);api.dispose();
});

test('partial project discovery expires quickly and recovers missing sheets after website access returns',async()=>{
 let time=0,allowed=false,childReads=0;const api=create({foregroundOnly:true,now:()=>time,readSession:async(repository,ref,action,path)=>{if(path==='child'){childReads++;if(!allowed)throw Error('Complete website SSO');return{sha,items:[{path:'child/sub.kicad_sch',type:'file'}]};}return{sha,items:[{path:'root.kicad_sch',type:'file'},{path:'child',type:'directory'}]};}});
 const first=await api.inventory(repo,sha);assert.equal(first.files.length,1);allowed=true;time=29999;assert.equal((await api.inventory(repo,sha)).files.length,1);time=30000;const recovered=await api.inventory(repo,sha);assert.equal(recovered.files.length,2);assert.equal(childReads,2);time+=30001;assert.equal((await api.inventory(repo,sha)).files.length,2);assert.equal(childReads,2);api.dispose();
});

test('partial model discovery can recover after SSO without waiting for immutable cache expiry',async()=>{
 let time=0,allowed=false,reads=0;const api=create({foregroundOnly:true,now:()=>time,readSession:async(repository,ref,action,path)=>{if(path==='hw/models'){reads++;if(!allowed)throw Error('Complete website SSO');return{sha,items:[{path:'hw/models/part.step',type:'file'}]};}return{sha,items:path==='hw'?[{path:'hw/models',type:'directory'}]:[]};}});
 assert.equal((await api.modelInventory(repo,sha,'hw/board.kicad_pcb')).files.length,0);allowed=true;time=30000;assert.equal((await api.modelInventory(repo,sha,'hw/board.kicad_pcb')).files.length,1);assert.equal(reads,2);api.dispose();
});
