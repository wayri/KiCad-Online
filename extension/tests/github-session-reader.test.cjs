const test=require('node:test'),assert=require('node:assert/strict');
const {create,treeData}=require('../github-session-reader.js');
const sha='a'.repeat(40),repo='owner/private';
const tree=(path='',items=[])=>[{payload:{codeViewTreeRoute:{path:path||'/',refInfo:{name:'feature/board',currentOid:sha},tree:{items,totalCount:items.length}}}}];
const response=(text,url,type='text/plain')=>{const r=new Response(text,{headers:{'content-type':type}});Object.defineProperty(r,'url',{value:url});return r;};
test('history feed stays on exact repository website with no API and supports explicit branch',async()=>{
 let called=0;const api=create({location:{href:'https://github.com/'+repo},fetch:async(url,options)=>{called++;assert.equal(url,'https://github.com/'+repo+'/commits/feature%2Fboard.atom');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');return response('<feed/>',url,'application/atom+xml');}});
 assert.deepEqual(await api.read({repository:repo,ref:'feature/board',action:'history'}),{ref:'feature/board',content:'<feed/>'});assert.equal(called,1);
 await assert.rejects(api.read({repository:'foreign/repo',ref:sha,action:'history'}),/tab/);assert.equal(called,1);
});
test('branch and commit metadata use exact website URLs, strip session fields and forbid redirects',async()=>{
 const repository='wayri/KiCad-Online',branches=require('./fixtures/github-history/github-all-branches-observed.json'),commit=require('./fixtures/github-history/github-commit-observed.json'),ref=commit.payload.commitRoute.commit.oid,calls=[];
 const api=create({location:{href:'https://github.com/'+repository},fetch:async(url,init)=>{calls.push(url);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);const value=url.endsWith('/branches/all')?branches:commit;return response('<script type="application/json">'+JSON.stringify({...value,csrf_tokens:{secret:'must-not-leave-tab'},currentUser:{login:'private'}})+'</script>',url,'text/html');}});
 const listing=await api.read({repository,ref:'main',action:'branches'}),detail=await api.read({repository,ref,action:'commit'});assert.equal(listing.branches.length,20);assert.deepEqual(detail.parents,commit.payload.commitRoute.commit.parents);assert.equal(JSON.stringify([listing,detail]).includes('must-not-leave-tab'),false);assert.deepEqual(calls,['https://github.com/'+repository+'/branches/all','https://github.com/'+repository+'/commit/'+ref]);
 for(const message of [{repository:'foreign/repo',ref,action:'commit'},{repository,ref:'main',action:'commit'},{repository,ref,action:'commit',path:'other'}])await assert.rejects(api.read(message));assert.equal(calls.length,2);
 for(const target of ['https://github.com/login','https://github.com/foreign/repo/commit/'+ref]){const wrong=create({location:{href:'https://github.com/'+repository},fetch:async()=>response('html',target,'text/html')});await assert.rejects(wrong.read({repository,ref,action:'commit'}),/different/);}
});
test('commit metadata rejects oversized responses and Stop cancels a stalled body',async()=>{
 const make=fetch=>create({location:{href:'https://github.com/'+repo},fetch});
 const huge=make(async url=>{const value=response('',url,'text/html');value.headers.set('content-length',String(8*1024*1024+1));return value;});await assert.rejects(huge.read({repository:repo,ref:sha,action:'commit'}),/size limit/);
 const controller=new AbortController();let cancelled=0;const stalled=create({location:{href:'https://github.com/'+repo},signal:controller.signal,fetch:async url=>response(new ReadableStream({cancel(){cancelled++;}}),url,'text/html')});const pending=stalled.read({repository:repo,ref:sha,action:'commit'});await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(cancelled,1);
});
test('session reads stay in the repository tab, pin branch revisions and strip page metadata',async()=>{
 const calls=[],api=create({location:{href:'https://github.com/owner/private/blob/feature/board/main.kicad_pcb'},parseHTML:()=>tree(),fetch:async(url,init)=>{calls.push({url,init});return response('html',url);}});
 const result=await api.read({repository:repo,ref:'feature/board',action:'resolve'});
 assert.deepEqual(result,{sha,items:[]});assert.match(calls[0].url,/tree\/feature%2Fboard$/);assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers,undefined);
 await assert.rejects(api.read({repository:'someone/else',ref:sha,action:'resolve'}),/tab/);
 await assert.rejects(api.read({repository:repo,ref:'main',action:'file',path:'main.kicad_pcb'}),/pinned/);
});
test('directory parsing rejects stale commits, incomplete listings and traversal, preserving symlink identity for exclusion',()=>{
 assert.throws(()=>treeData(tree(),'b'.repeat(40),''),/different revision/);
 const incomplete=tree();incomplete[0].payload.codeViewTreeRoute.tree.totalCount=1;assert.throws(()=>treeData(incomplete,sha,''),/incomplete/);
 assert.throws(()=>treeData(tree('',[{path:'../secret',contentType:'file'}]),sha,''),/unsafe/);
 const result=treeData(tree('',[{path:'link',contentType:'symlink'}]),sha,'');assert.equal(result.items[0].type,'symlink');
});

test('HEAD discovery reuses embedded repository page data without any network request',async()=>{
 let calls=0;
 const api=create({location:{href:'https://github.com/owner/private'},parseDocument:()=>tree('',[{path:'design',contentType:'directory'}]),fetch:async()=>{calls++;throw Error('No fetch expected');}});
 assert.deepEqual(await api.read({repository:repo,ref:'HEAD',action:'resolve'}),{sha,items:[{path:'design',type:'directory'}]});
 assert.equal(calls,0);
 const stale=create({location:{href:'https://github.com/owner/private'},parseDocument:()=>tree(),parseHTML:()=>tree(),fetch:async(url)=>{calls++;return response('html',url);}});
 await assert.rejects(stale.read({repository:repo,ref:'b'.repeat(40),action:'resolve'}),/different revision/);
 assert.equal(calls,1);
});

test('signed-in hash model filenames remain encoded path data, not URL fragments',async()=>{
 const path='models/IC#PBF.STEP',suffix='/'+repo+'/'+sha+'/models/IC%23PBF.STEP',calls=[];
 const api=create({location:{href:'https://github.com/'+repo},fetch:async(url,init)=>{calls.push(url);assert.equal(init.credentials,'same-origin');return response(new Uint8Array([0,1,2]),'https://raw.githubusercontent.com'+suffix);}});
 assert.deepEqual(await api.read({repository:repo,ref:sha,action:'asset',path,limit:16}),{base64:'AAEC',sha});assert.deepEqual(calls,['https://github.com/'+repo+'/raw/'+sha+'/models/IC%23PBF.STEP']);
});
test('session binary assets preserve exact bytes and reject unrelated redirect destinations',async()=>{
 const bytes=new Uint8Array([0,255,128,10]);
 const api=create({location:{href:'https://github.com/owner/private'},fetch:async()=>response(bytes,'https://raw.githubusercontent.com/owner/private/'+sha+'/model.step')});
 assert.deepEqual(await api.read({repository:repo,ref:sha,action:'asset',path:'model.step',limit:16}),{base64:'AP+ACg==',sha});
 const wrong=create({location:{href:'https://github.com/owner/private'},fetch:async()=>response(bytes,'https://evil.example/model.step')});
 await assert.rejects(wrong.read({repository:repo,ref:sha,action:'asset',path:'model.step',limit:16}),/download/);
});

test('LFS media redirects are asset-only and bound to the exact immutable repository path',async()=>{
 const path='models/IC#PBF.STEP',suffix='/media/'+repo+'/'+sha+'/models/IC%23PBF.STEP',url='https://media.githubusercontent.com'+suffix+'?token=test-only';
 const bytes=new Uint8Array([0,1,2]),make=final=>create({location:{href:'https://github.com/'+repo},fetch:async()=>response(bytes,final)});
 assert.deepEqual(await make(url).read({repository:repo,ref:sha,action:'asset',path,limit:16}),{base64:'AAEC',sha});
 for(const final of [url.replace('/'+repo+'/', '/other/repo/'),url.replace(sha,'b'.repeat(40)),url.replace('IC%23PBF','different'),url.replace('media.githubusercontent.com','evil.example'),url.replace('media.githubusercontent.com','media.githubusercontent.com:444'),url.replace('https:','http:'),url.replace('/media/','/mediaevil/'),url.replace('/media/','/other/'),url+'#fragment',url.replace('https://','https://user:password@')])await assert.rejects(make(final).read({repository:repo,ref:sha,action:'asset',path,limit:16}),/download/);
 await assert.rejects(make(url).read({repository:repo,ref:sha,action:'file',path,limit:16}),/download/);
 await assert.rejects(make(url).read({repository:repo,ref:sha,action:'asset',path,limit:2}),/limit/);
});

test('HEAD never reuses a feature-branch tab as the default branch',async()=>{
 let calls=0;const feature=tree();feature[0].payload.codeViewTreeRoute.refInfo={name:'feature/board',currentOid:'b'.repeat(40)};
 const main=tree();main[0].payload.codeViewTreeRoute.refInfo={name:'main',currentOid:sha};
 const api=create({location:{href:'https://github.com/owner/private/tree/feature/board'},parseDocument:()=>feature,parseHTML:()=>main,fetch:async url=>{calls++;assert.equal(url,'https://github.com/owner/private');return response('html',url);}});
 assert.equal((await api.read({repository:repo,ref:'HEAD',action:'resolve'})).sha,sha);assert.equal(calls,1);
});

test('repository-root payload variants are read without treating root data as a subfolder',()=>{
 const route=tree()[0].payload.codeViewTreeRoute;
 for(const payload of [{codeViewRepoRoute:route},{refInfo:route.refInfo,tree:route.tree}]){
  assert.equal(treeData([{payload}],'HEAD','').sha,sha);
  assert.throws(()=>treeData([{payload}],sha,'design'),/readable/);
 }
});
test('raw download accepts only the exact pinned source and never returns signed URLs',async()=>{
 let init;
 const api=create({location:{href:'https://github.com/owner/private'},fetch:async(url,options)=>{init=options;return response('(kicad_pcb)','https://raw.githubusercontent.com/owner/private/'+sha+'/board.kicad_pcb?token=temporary');}});
 assert.deepEqual(await api.read({repository:repo,ref:sha,action:'file',path:'board.kicad_pcb',limit:1024}),{content:'(kicad_pcb)',sha});assert.equal(init.credentials,'same-origin');assert.equal(init.headers,undefined);
 for(const path of ['../secret','/secret','a\\secret'])await assert.rejects(api.read({repository:repo,ref:sha,action:'file',path}),/read|file/);
});
test('login pages, unrelated redirects, invalid UTF8 and oversized bodies fail visibly',async()=>{
 for(const [body,url,type] of [['login','https://github.com/login','text/html'],['wrong','https://evil.test/file','text/plain'],['large data','https://raw.githubusercontent.com/owner/private/'+sha+'/board.kicad_pcb','text/plain']]){
  const api=create({location:{href:'https://github.com/owner/private'},fetch:async()=>response(body,url,type)});
  await assert.rejects(api.read({repository:repo,ref:sha,action:'file',path:'board.kicad_pcb',limit:2}),/download|size/);
 }
 const api=create({location:{href:'https://github.com/owner/private'},fetch:async()=>response(new Uint8Array([255]),'https://raw.githubusercontent.com/owner/private/'+sha+'/board.kicad_pcb')});
 await assert.rejects(api.read({repository:repo,ref:sha,action:'file',path:'board.kicad_pcb',limit:1024}),/encoded data/);
});
test('session Stop aborts its raw fetch and cancels a stalled response body',async()=>{
 const controller=new AbortController();let cancelled=0,transportSignal;
 const api=create({location:{href:'https://github.com/owner/private'},signal:controller.signal,fetch:async(url,init)=>{transportSignal=init.signal;const r=new Response(new ReadableStream({start(){},cancel(){cancelled++;}}));Object.defineProperty(r,'url',{value:'https://raw.githubusercontent.com/owner/private/'+sha+'/board.kicad_pcb'});return r;}});
 const pending=api.read({repository:repo,ref:sha,action:'file',path:'board.kicad_pcb',limit:1024});await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(cancelled,1);assert.equal(transportSignal.aborted,true);
});


test('live Ttl/vna2 compact directory metadata retains explicit safe navigation identity',()=>{
 // Anonymous GitHub HTML metadata observed2026-11-01; noAPI or repository files.
 // https://github.com/Ttl/vna2/tree/2cf0efb22da56a168a7f07bf5e2c30631343997b/fpga/vna/vna.srcs
 const directory='fpga/vna/vna.srcs',items=[{name:'constrs_1/new',path:directory+'/constrs_1/new',contentType:'directory',hasSimplifiedPath:true},{name:'sim_1/new',path:directory+'/sim_1/new',contentType:'directory',hasSimplifiedPath:true},{name:'sources_1',path:directory+'/sources_1',contentType:'directory'}],result=treeData(tree(directory,items),sha,directory);
 assert.deepEqual(result.items,[{path:directory+'/constrs_1/new',type:'directory',hasSimplifiedPath:true},{path:directory+'/sim_1/new',type:'directory',hasSimplifiedPath:true},{path:directory+'/sources_1',type:'directory'}]);
 for(const patch of [{hasSimplifiedPath:false},{hasSimplifiedPath:1},{contentType:'file'},{name:'other/new'},{name:'../new'},{path:'elsewhere/constrs_1/new'},{path:directory+'/constrs_1/../new'},{name:'constrs_1\\new'}])assert.throws(()=>treeData(tree(directory,[{...items[0],...patch}]),sha,directory),/unsafe/);
 assert.deepEqual(treeData(tree('',[{name:'design/board',path:'design/board',contentType:'directory',hasSimplifiedPath:true}]),sha,'').items,[{path:'design/board',type:'directory',hasSimplifiedPath:true}]);
});


test('private folder context resolves slash branch and pinned identity from its signed-in page without fetch or tokens',async()=>{
 let fetched=0;const api=create({location:{href:'https://github.com/'+repo+'/tree/feature/board/hw'},parseDocument:()=>tree('hw',[{path:'hw/private.kicad_pcb',contentType:'file'}]),fetch:async()=>{fetched++;throw Error('Anonymous fetch must not run');}}),result=await api.read({repository:repo,ref:'HEAD',action:'context',path:'tree/feature/board/hw'});
 assert.deepEqual(result,{repository:repo,ref:'feature/board',directory:'hw',sha,items:[{path:'hw/private.kicad_pcb',type:'file'}]});assert.equal(fetched,0);await assert.rejects(api.read({repository:'foreign/repo',ref:'HEAD',action:'context',path:'tree/main/hw'}),/tab/);assert.equal(fetched,0);
});

test('private context may fetch only the exact same repository website with browser session and rejects opaque denials',async()=>{
 let requested;const api=create({location:{href:'https://github.com/'+repo},parseDocument:()=>[],parseHTML:()=>tree('hw'),fetch:async(url,init)=>{requested={url,init};return response('private metadata',url,'text/html');}});assert.equal((await api.read({repository:repo,ref:'HEAD',action:'context',path:'tree/feature/board/hw'})).sha,sha);assert.equal(requested.url,'https://github.com/'+repo+'/tree/feature/board/hw');assert.equal(requested.init.credentials,'same-origin');assert.equal(requested.init.redirect,'error');assert.equal(requested.init.headers,undefined);
 const denied=create({location:{href:'https://github.com/'+repo},parseDocument:()=>[],fetch:async url=>{const r=response('Access denied',url,'text/html');Object.defineProperty(r,'status',{value:403});Object.defineProperty(r,'ok',{value:false});return r;}});await assert.rejects(denied.read({repository:repo,ref:'HEAD',action:'context',path:'tree/main/hw'}),/website access was denied/);
 for(const path of ['blob/main/file','tree/../secret','tree/main/../../other','https://evil.test/tree/main'])await assert.rejects(api.read({repository:repo,ref:'HEAD',action:'context',path}),/Invalid|Unsupported/);
});

test('private source files permit64MiB reviewed limits while binary assets remain capped at32MiB',async()=>{
 let fetched=0;const api=create({location:{href:'https://github.com/'+repo},fetch:async url=>{fetched++;return response('(kicad_pcb)','https://raw.githubusercontent.com/'+repo+'/'+sha+'/board.kicad_pcb');}});assert.equal((await api.read({repository:repo,ref:sha,action:'file',path:'board.kicad_pcb',limit:64*1024*1024})).content,'(kicad_pcb)');assert.equal(fetched,1);await assert.rejects(api.read({repository:repo,ref:sha,action:'file',path:'board.kicad_pcb',limit:64*1024*1024+1}),/Invalid/);await assert.rejects(api.read({repository:repo,ref:sha,action:'asset',path:'model.wrl',limit:32*1024*1024+1}),/Invalid/);assert.equal(fetched,1);
});

test('private context cancellation aborts a signed-in website read before returning metadata',async()=>{
 const controller=new AbortController();let aborted=false;const api=create({location:{href:'https://github.com/'+repo},signal:controller.signal,parseDocument:()=>[],fetch:async(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));}))}),pending=api.read({repository:repo,ref:'HEAD',action:'context',path:'tree/main/hw'});controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(aborted,true);
});

test('signed-in server-rendered table supplies pinned metadata without hydration JSON',()=>{
 const {documentObjects,treeData,contextData}=require('../github-session-reader.js');
 const link=href=>({getAttribute:()=>href}),row=(...urls)=>({querySelectorAll:()=>urls.map(link)});
 const doc={querySelectorAll:selector=>selector.startsWith('script')?[]:[link('/'+repo+'/commit/'+sha)],querySelector:selector=>selector.startsWith('table')?{textContent:'Name Last commit',querySelectorAll:()=>[row('/'+repo+'/tree/main/models'),row('/'+repo+'/blob/main/board.kicad_pcb','/'+repo+'/blob/main/board.kicad_pcb'),row('/foreign/repo/blob/main/leak.step')]}:{textContent:'main'}};
 const values=documentObjects(doc,'https://github.com/'+repo);
 assert.equal(contextData(values,repo).sha,sha);assert.deepEqual(treeData(values,sha,'').items,[{path:'models',type:'directory'},{path:'board.kicad_pcb',type:'file'}]);
 // The current directory commit may predate HEAD; never infer a branch SHA there.
 assert.deepEqual(documentObjects(doc,'https://github.com/'+repo+'/tree/main/hw'),[{githubFileTableContext:{repository:repo,ref:'main',directory:'hw'}}]);
 const pinned={...doc,querySelector:selector=>selector.startsWith('table')?{textContent:'Name',querySelectorAll:()=>[row('/'+repo+'/blob/'+sha+'/models/body.step')]}:{textContent:sha.slice(0,7)}};
 assert.deepEqual(treeData(documentObjects(pinned,'https://github.com/'+repo+'/tree/'+sha+'/models'),sha,'models').items,[{path:'models/body.step',type:'file'}]);
 assert.deepEqual(documentObjects(doc,'https://elsewhere.test/'+repo),[]);
});


test('classic nested tables resolve branch root before reading a pinned folder, including slash branches',async()=>{
 const {documentObjects}=require('../github-session-reader.js');
 for(const ref of ['main','feature/board']){
  const calls=[],lastChange='b'.repeat(40),location={href:'https://github.com/'+repo+'/tree/'+ref+'/hw/sub'};
  const doc={querySelectorAll:selector=>selector.startsWith('script')?[]:[{getAttribute:()=>'/'+repo+'/commit/'+lastChange}],querySelector:selector=>selector.startsWith('table')?{querySelectorAll:()=>[],textContent:'Files'}:{textContent:ref}};
  const rootTree=tree();rootTree[0].payload.codeViewTreeRoute.refInfo.name=ref;
  const api=create({location,parseDocument:()=>documentObjects(doc,location.href),fetch:async(url,init)=>{calls.push(url);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);return response('metadata',url);},parseHTML:(_html,url)=>url.endsWith('/tree/'+encodeURIComponent(ref))?rootTree:tree('hw/sub',[{path:'hw/sub/board.kicad_pcb',contentType:'file'}])});
  assert.deepEqual(await api.read({repository:repo,ref:'HEAD',action:'context',path:'tree/'+ref+'/hw/sub'}),{repository:repo,ref,directory:'hw/sub',sha,items:[{path:'hw/sub/board.kicad_pcb',type:'file'}]});
  assert.deepEqual(calls,['https://github.com/'+repo+'/tree/'+encodeURIComponent(ref),'https://github.com/'+repo+'/tree/'+sha+'/hw/sub']);assert.ok(calls.every(url=>!url.includes(lastChange)));
 }
});

test('classic context hints cannot escape the requested repository, branch or folder',async()=>{
 for(const patch of [{repository:'foreign/repo'},{ref:'other'},{directory:'elsewhere'},{directory:'../secret'},{ref:'main/../other'},{ref:sha}]){
  let calls=0;const api=create({location:{href:'https://github.com/'+repo+'/tree/main/hw'},parseDocument:()=>[{githubFileTableContext:{repository:repo,ref:'main',directory:'hw',...patch}}],fetch:async()=>{calls++;throw Error('No fetch expected');}});
  await assert.rejects(api.read({repository:repo,ref:'HEAD',action:'context',path:'tree/main/hw'}),/Invalid/);assert.equal(calls,0);
 }
});

test('classic nested context rejects stale branch identity, stale pinned folders and redirected pages',async()=>{
 for(const failure of ['branch','folder','redirect']){
  let calls=0;const branch=tree(),folder=tree('hw');branch[0].payload.codeViewTreeRoute.refInfo.name=failure==='branch'?'other':'main';if(failure==='folder')folder[0].payload.codeViewTreeRoute.refInfo.currentOid='b'.repeat(40);
  const api=create({location:{href:'https://github.com/'+repo+'/tree/main/hw'},parseDocument:()=>[{githubFileTableContext:{repository:repo,ref:'main',directory:'hw'}}],fetch:async url=>{calls++;return response('metadata',failure==='redirect'?'https://github.com/foreign/repo':url);},parseHTML:()=>calls===1?branch:folder});
  await assert.rejects(api.read({repository:repo,ref:'HEAD',action:'context',path:'tree/main/hw'}),/different/);assert.equal(calls,failure==='folder'?2:1);
 }
});

test('classic nested context cancellation stops between branch resolution and folder fetch',async()=>{
 const controller=new AbortController();let calls=0;const branch=tree();branch[0].payload.codeViewTreeRoute.refInfo.name='main';
 const api=create({location:{href:'https://github.com/'+repo+'/tree/main/hw'},signal:controller.signal,parseDocument:()=>[{githubFileTableContext:{repository:repo,ref:'main',directory:'hw'}}],fetch:async url=>{calls++;return response('metadata',url);},parseHTML:()=>{controller.abort();return branch;}});
 await assert.rejects(api.read({repository:repo,ref:'HEAD',action:'context',path:'tree/main/hw'}),/cancelled/);assert.equal(calls,1);
});
