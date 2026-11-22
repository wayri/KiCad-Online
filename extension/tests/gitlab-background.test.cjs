'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
global.KiCadBrowserData=require('../browser-data.js');global.KiCadGitHub=require('../parsing.js');global.KiCadReviewComments=require('../review-comments.js');global.KiCadGitLabProvider=require('../gitlab-provider.js');
let listener,sidecarChecks=0;const store=new Map();global.KiCadReviewFileStore={status:async()=>{sidecarChecks++;return {connected:true};},read:async()=>[]};global.KiCadGitHubReviewApi={tokenStatus:()=>{throw new Error('GitHub token accessed');}};
global.KiCadGerberRenderer=require('../gerber-renderer.js');
global.importScripts=()=>{};global.chrome={runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:callback=>listener=callback}},action:{onClicked:{addListener(){}}},storage:{local:{get:async key=>({[key]:store.get(key)}),set:async items=>{for(const [key,value]of Object.entries(items))store.set(key,value);}}}};
const worker=require('../background.js'),viewer={id:'test',url:'chrome-extension://test/browser-viewer.html'},tab={id:'test',url:'https://gitlab.com/group/board/-/blob/main/board.kicad_pcb'};
const message=(request,sender=viewer)=>new Promise(resolve=>{if(!listener(request,sender,resolve))resolve({ignored:true});});
function withWebsite(t,repository,handler){
 const previousTabs=chrome.tabs;let backgroundReads=0;const requests=[];
 const reader=require('../gitlab-session-reader.js').create({location:{href:'https://gitlab.com/'+repository+'/-/tree/main'},fetch:async(url,init)=>{requests.push({url,init});assert.equal(init.credentials,'same-origin');assert.equal(init.headers,undefined,'Website content reads must not carry review-account tokens');return handler(url,init);}});
 chrome.tabs={query:async()=>[{id:51,url:'https://gitlab.com/'+repository+'/-/tree/main'}],sendMessage:async(id,request,options)=>{assert.equal(id,51);assert.equal(options.frameId,0);assert.equal(request.type,'gitlab-session-read');assert.equal(request.repository,repository);return {ok:true,result:await reader.read(request)};}};
 global.fetch=async()=>{backgroundReads++;throw Error('Project content attempted a forbidden background fetch.');};
 t.after(()=>{chrome.tabs=previousTabs;assert.equal(backgroundReads,0);});return requests;
}

test('GitLab remote forks require owned viewers and an approved exact provider host',async t=>{
 const original=global.KiCadGitLabReviewApi;let count=0;global.KiCadGitLabReviewApi={forkRevision:async request=>{count++;assert.equal(request.host,'https://gitlab.com');return {created:true};}};t.after(()=>global.KiCadGitLabReviewApi=original);
 const request={type:'repository-fork-revision',provider:'gitlab',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',sha:'a'.repeat(40),confirmed:true};
 assert.equal((await message(request,tab)).ok,false);assert.equal((await message({...request,host:'https://unapproved.example'})).ok,false);assert.equal(count,0);assert.equal((await message(request)).ok,true);assert.equal(count,1);
});

test('GitLab chat publication requires the exact viewer and matching provider host',async(t)=>{
 const previous=global.KiCadGitLabReviewApi;let called=0;global.KiCadGitLabReviewApi={chatMessageWrite:async request=>{called++;assert.equal(request.host,'https://gitlab.com');return{messageId:'12'};}};t.after(()=>global.KiCadGitLabReviewApi=previous);
 const request={type:'chat-message-write',provider:'gitlab',host:'https://gitlab.com',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',thread:{kind:'issue',number:42},action:'create',body:'Hello',clientMutationId:'mutation_0123456789'};
 assert.equal((await message(request,tab)).ok,false);assert.equal((await message({...request,host:'https://evil.example'})).ok,false);assert.equal(called,0);assert.equal((await message(request)).ok,true);assert.equal(called,1);assert.match((await message({...request,type:'chat-reaction'})).error,/not supported/);
});

test('GitLab conversation discovery is viewer-only',async(t)=>{
 const previous=global.KiCadGitLabReviewApi;let called=0;global.KiCadGitLabReviewApi={chatThreadList:async()=>{called++;return{threads:[],hasMore:false};}};t.after(()=>global.KiCadGitLabReviewApi=previous);
 const request={type:'chat-thread-list',provider:'gitlab',host:'https://gitlab.com',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',kind:'issue'};
 assert.equal((await message(request,tab)).ok,false);assert.equal(called,0);assert.equal((await message(request)).ok,true);assert.equal(called,1);
});
test('GitLab worker permits only exact host and explicit provider, rejects token and remote publication routes',async()=>{
 assert.equal(worker.senderAllowed(tab),true);assert.equal(worker.senderAllowed({...tab,url:'https://gitlab.com.evil.test/group/board'}),false);
 assert.equal((await message({type:'github-auth-status',provider:'gitlab'})).ok,false);
 assert.equal((await message({type:'github-publish-comment',provider:'gitlab'})).ok,false);
 assert.match((await message({type:'project',provider:'other'})).error,/Unsupported/);
 assert.match((await message({type:'github-auth-status'},tab)).error,/must specify/);
 assert.match((await message({type:'github-auth-status',provider:'gitlab'},{id:'test',url:'https://github.com/group/board'})).error,/does not match/);
 assert.equal((await message({type:'comment-list',provider:'gitlab'},tab)).ok,false);
});
test('GitLab drafts remain local and provider-isolated with a connected sync cache',async()=>{
 const now=new Date().toISOString(),scope={provider:'gitlab',repository:'group/sub/board',ref:'main',file:'board.kicad_pcb'};
 const note={id:'note',text:'Check board',severity:'minor',state:'open',createdAt:now,updatedAt:now,anchor:scope};
 const saved=await message({type:'comment-save',provider:'gitlab',comment:note});assert.equal(saved.ok,true, saved.error);assert.equal(saved.result.anchor.provider,'gitlab');assert.ok(sidecarChecks>0);
 assert.equal((await message({type:'comment-list',...scope})).result.length,1);assert.equal(store.size,1);assert.match([...store.keys()][0],/^review-comments:gitlab:/);
 assert.match((await message({type:'comment-save',provider:'github',comment:note})).error,/must use/);
 assert.equal((await message({type:'comment-delete',...scope,id:'note'})).result.deleted,true);assert.equal((await message({type:'comment-list',...scope})).result.length,0);
});
test('GitLab project hierarchy retrieval uses immutable revision and subgroup namespace',async t=>{
 const previous=global.fetch,sha='a'.repeat(40),calls=[];global.fetch=async url=>{calls.push(url);if(url.includes('/commits/'))return new Response(JSON.stringify({id:sha}));if(url.includes('/tree?'))return new Response('[]');assert.equal(new URL(url).searchParams.get('ref'),sha);return new Response('(kicad_pcb)');};t.after(()=>global.fetch=previous);
 withWebsite(t,'group/sub/board',global.fetch);
 const result=await message({type:'project',provider:'gitlab',repository:'group/sub/board',ref:'feature/pcb',file:'board.kicad_pcb'},{...tab,url:'https://gitlab.com/group/sub/board/-/blob/feature/pcb/board.kicad_pcb'});assert.equal(result.ok,true,result.error);assert.equal(result.result[0].content,'(kicad_pcb)');assert.ok(calls.every(url=>url.startsWith('https://gitlab.com/api/v4/projects/group%2Fsub%2Fboard/')));
});

test('GitLab host-page project reads reject cross-project and subframe requests before fetch',async t=>{
 const previous=global.fetch;let reads=0;global.fetch=async()=>{reads++;return new Response('{}');};t.after(()=>global.fetch=previous);
 for(const [repository,sender]of [['private/other',tab],['group/board',{...tab,frameId:2}]]){
  const result=await message({type:'project',provider:'gitlab',repository,ref:'main',file:'board.kicad_pcb'},sender);
  assert.equal(result.ok,false);assert.match(result.error,/host page|not opened for this repository/);
 }
 assert.equal(reads,0);
});

test('GitLab leaf discovery finds roots across folders from one pinned recursive tree',async t=>{
 const previous=global.fetch,sha='a'.repeat(40),calls=[];
 const sources=new Map([
  ['design/main.kicad_sch','(kicad_sch (sheet (property "Sheetfile" "../shared/leaf.kicad_sch")))'],
  ['shared/leaf.kicad_sch','(kicad_sch)'],['another/root.kicad_sch','(kicad_sch)']
 ]);
 global.fetch=async url=>{calls.push(url);if(url.includes('/commits/'))return new Response(JSON.stringify({id:sha}));const parsed=new URL(url);assert.equal(parsed.searchParams.get('ref'),sha);
  if(url.includes('/tree?')){assert.equal(parsed.searchParams.get('recursive'),'true');return new Response(JSON.stringify([...sources.keys()].map(path=>({path,type:'blob',mode:'100644'}))));}
  const path=decodeURIComponent(parsed.pathname.split('/files/')[1].replace(/\/raw$/,''));assert.ok(sources.has(path));return new Response(sources.get(path));
 };t.after(()=>global.fetch=previous);
 withWebsite(t,'group/sub/board',global.fetch);
 const result=await message({type:'project',provider:'gitlab',repository:'group/sub/board',ref:'feature/sheets',file:'shared/leaf.kicad_sch'});
 assert.equal(result.ok,true,result.error);assert.deepEqual(result.result.map(file=>file.path),['design/main.kicad_sch','shared/leaf.kicad_sch']);
 assert.equal(calls.filter(url=>url.includes('/tree?')).length,1);assert.equal(calls.filter(url=>url.includes('/commits/')).length,1);
 assert.equal(result.result[0].discoveryWarning,undefined);
});


test('GitLab saved rule reports are pinned to the resolved drawing revision',async t=>{
 const previous=global.fetch,sha='c'.repeat(40),calls=[];global.fetch=async url=>{calls.push(url);if(url.includes('/commits/'))return new Response(JSON.stringify({id:sha}));assert.equal(new URL(url).searchParams.get('ref'),sha);return new Response('{"violations":[]}');};t.after(()=>global.fetch=previous);
 withWebsite(t,'group/sub/board',global.fetch);
 const result=await message({type:'rule-report',provider:'gitlab',repository:'group/sub/board',ref:'main',file:'board.kicad_pcb',reportPath:'reports/drc.json'});
 assert.equal(result.ok,true,result.error);assert.equal(result.result.path,'reports/drc.json');assert.equal(calls.length,2);
});


test('GitLab analysis page can read pinned report source but cannot use write tools',async t=>{
 const sender={id:'test',url:'chrome-extension://test/analysis-viewer.html?file=analysis.csv'},sha='c'.repeat(40),previous=global.fetch;
 global.fetch=async url=>{assert.equal(new URL(url).searchParams.get('ref'),sha);return new Response('time,V\n0,1');};t.after(()=>global.fetch=previous);
 withWebsite(t,'group/board',global.fetch);
 const scope={provider:'gitlab',host:'https://gitlab.com',repository:'group/board',ref:sha,file:'analysis.csv'};
 const result=await message({type:'project-file',...scope},sender);assert.equal(result.ok,true,result.error);assert.equal(result.result.content,'time,V\n0,1');
 for(const type of ['comment-save','comment-delete','comment-publish','project']){const reply=await message({type,...scope},sender);assert.equal(reply.ok,false);assert.match(reply.error,/only read/);}
});


test('full GitLab thread reads route only from viewers to the matching approved provider',async t=>{
 const previous=global.KiCadGitLabReviewApi,calls=[];global.KiCadGitLabReviewApi={readThread:async request=>{calls.push(request);return{kind:'issue',number:42,comments:[]};}};t.after(()=>global.KiCadGitLabReviewApi=previous);
 const scope={type:'github-thread-read',provider:'gitlab',host:'https://gitlab.com',repository:'group/board',ref:'main',file:'board.kicad_pcb',kind:'discussion',number:42};
 assert.equal((await message(scope)).result.kind,'issue');assert.equal(calls.length,1);assert.equal(calls[0].host,'https://gitlab.com');
 assert.equal((await message(scope,tab)).ok,false);assert.equal((await message({...scope,host:'https://evil.invalid'})).ok,false);assert.equal(calls.length,1);
});

test('GitLab repo-main discovery resolves default branch and pins all tree pagination',async t=>{
 const previous=global.fetch,sha='c'.repeat(40),calls=[];global.fetch=async url=>{calls.push(String(url));if(url==='https://gitlab.com/api/v4/projects/group%2Fsub%2Fboard')return new Response(JSON.stringify({default_branch:'review/new'}));if(url.includes('/commits/'))return new Response(JSON.stringify({id:sha}));if(url.includes('/tree?')){const query=new URL(url).searchParams;assert.equal(query.get('ref'),sha);return new Response(JSON.stringify([{path:'design/board.kicad_pro',type:'blob',mode:'100644',id:'d'.repeat(40)}]));}throw Error('Unexpected read '+url);};t.after(()=>global.fetch=previous);
 withWebsite(t,'group/sub/board',global.fetch);
 const result=await message({type:'repository-detect',provider:'gitlab',host:'https://gitlab.com',repository:'group/sub/board',ref:'HEAD'},{id:'test',tab:{id:7},url:'https://gitlab.com/group/sub/board'});
 assert.equal(result.ok,true,result.error);assert.equal(result.result.sha,sha);assert.deepEqual(result.result.projects,['design/board.kicad_pro']);assert.ok(calls.some(url=>url.endsWith('/commits/review%2Fnew')));
 assert.equal((await message({type:'repository-detect',provider:'gitlab',host:'https://gitlab.com',repository:'other/board',ref:'HEAD'},{id:'test',tab:{id:7},url:'https://gitlab.com/group/sub/board'})).ok,false);
});

test('GitLab repository detection finds projects on later pinned tree pages',async t=>{
 const previous=global.fetch,sha='e'.repeat(40);let pages=0;global.fetch=async url=>{if(url.includes('/commits/'))return new Response(JSON.stringify({id:sha}));if(url.includes('/tree?')){const query=new URL(url).searchParams;assert.equal(query.get('ref'),sha);pages++;return query.get('page')==='1'?new Response(JSON.stringify(Array.from({length:100},(_,i)=>({path:'notes'+i+'.txt',type:'blob',mode:'100644',id:'f'.repeat(40)}))),{headers:{'x-next-page':'2'}}):new Response(JSON.stringify([{path:'deep/nested/board.kicad_pro',type:'blob',mode:'100644',id:'d'.repeat(40)}]));}throw Error('Unexpected read '+url);};t.after(()=>global.fetch=previous);
 withWebsite(t,'group/board',global.fetch);
 const result=await message({type:'repository-detect',provider:'gitlab',host:'https://gitlab.com',repository:'group/board',ref:'main'},{id:'test',tab:{id:7},url:'https://gitlab.com/group/board/-/tree/main'});
 assert.equal(result.ok,true,result.error);assert.deepEqual(result.result.projects,['deep/nested/board.kicad_pro']);assert.equal(pages,2);assert.equal(result.result.truncated,false);
});

test('GitLab state changes require exact viewer and approved provider host',async t=>{
 const before=global.KiCadGitLabReviewApi;let called=0;global.KiCadGitLabReviewApi={chatThreadState:async args=>{called++;assert.equal(args.host,'https://gitlab.com');return{state:'closed'};}};t.after(()=>global.KiCadGitLabReviewApi=before);
 const request={type:'chat-thread-state',provider:'gitlab',host:'https://gitlab.com',repository:'owner/repo',thread:{kind:'issue',number:42},confirmed:true};
 assert.equal((await message(request,tab)).ok,false);assert.equal((await message({...request,host:'https://evil.example'})).ok,false);assert.equal(called,0);assert.equal((await message(request)).ok,true);assert.equal(called,1);
});


test('GitLab annotation readback uses the review connector, never content file transport',async t=>{
 const previous=global.KiCadGitLabReviewApi;t.after(()=>global.KiCadGitLabReviewApi=previous);const scope={provider:'gitlab',host:'https://gitlab.com',repository:'group/board',ref:'a'.repeat(40),file:'board.kicad_pcb'},time='2026-11-02T00:00:00Z',note={id:'annotation',text:'Review only',severity:'info',state:'open',createdAt:time,updatedAt:time,anchor:scope};let reads=0;
 global.KiCadGitLabReviewApi={readThread:async request=>{reads++;assert.equal(request.number,7);return{number:7,repository:scope.repository,host:scope.host,projectId:55,state:'open',author:'reviewer',body:KiCadReviewComments.toMarkdown(note),comments:[],warnings:[]};}};
 const reply=await message({...scope,type:'github-annotations',number:7});assert.equal(reply.ok,true,reply.error);assert.equal(reads,1);assert.equal(reply.result.notes[0].text,'Review only');assert.match(reply.result.notes[0].github.url,/issues\/7$/);
});
