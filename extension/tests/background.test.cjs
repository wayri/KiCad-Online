global.KiCadGitHubWebsiteHistory=require('../github-website-history.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const extensionOrigin = 'chrome-extension://test-id/';
const calls = { created: [], updated: [], messages: [], removed: [], windows: [] };
let messageListener, actionListener;
const localStore = new Map(), sessionStore = new Map();
const storageArea = (store) => ({
  get: async (key) => ({ [key]: store.get(key) }),
  set: async (items) => { for (const [key, value] of Object.entries(items)) store.set(key, value); },
  remove: async (key) => { for (const item of Array.isArray(key) ? key : [key]) store.delete(item); }
});
global.KiCadGitHub=require('../parsing.js');
global.KiCadProjectLaunch=require('../project-launch.js');
global.KiCadGitHubSessionReader=require('../github-session-reader.js');
global.KiCadGitHubProjectBuffer=require('../github-project-buffer.js');
global.KiCadGitHubProjectView=require('../github-project-view.js');
global.KiCadBrowserData = require('../browser-data.js');
global.KiCadReviewComments = require('../review-comments.js');
global.KiCadGitHubReviewApi = require('../github-review-api.js');
global.KiCadReviewFileStore = { status: async () => ({ connected: false }) };
global.KiCadEnvironmentDiagnostics = require('../environment-diagnostics.js');
global.importScripts = () => {};
global.chrome = {
  runtime: {
    id: 'test-id',
    getURL: (path) => extensionOrigin + path,
    openOptionsPage: async () => { calls.optionsOpened = (calls.optionsOpened || 0) + 1; },
    onMessage: { addListener: (listener) => { messageListener = listener; } }
  },
  action: { onClicked: { addListener: (listener) => { actionListener = listener; } },
    setBadgeText: async value => { calls.badge = value.text; },
    setBadgeBackgroundColor: async value => { calls.badgeColor = value.color; },
    setTitle: async value => { calls.actionTitle = value.title; } },
  storage: { local: storageArea(localStore), session: storageArea(sessionStore) },
  tabs: {
    create: async (options) => { calls.created.push(options); return { id: 100 + calls.created.length }; },
    update: async (id, options) => { calls.updated.push({ id, ...options }); },
    sendMessage: async (id, message) => { calls.messages.push({ id, message }); return calls.response; },
    remove: async (id) => { calls.removed.push(id); }
  },
  windows: { create: async (options) => { calls.windows.push(options); return { id: 41 }; } }
};
const background = require('../background.js');
test('remote fork requests are viewer-only and preserve their selected-commit scope',async t=>{
 const original=KiCadGitHubReviewApi.forkRevision;let received;
 KiCadGitHubReviewApi.forkRevision=async value=>{received=value;return {created:true,partial:false};};t.after(()=>KiCadGitHubReviewApi.forkRevision=original);
 const request={type:'repository-fork-revision',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',sha:'a'.repeat(40),confirmed:true};
 for(const sender of [options,githubTab(1,'/owner/repo/blob/main/board.kicad_pcb')])assert.equal((await message(request,sender)).ok,false);
 assert.equal(received,undefined);assert.equal((await message(request)).ok,true);assert.deepEqual(received,request);
});
test('website review transport rejects host, embedded, foreign and cross-repository page senders',async()=>{
 const request={type:'github-session-review',action:'send',repository:'owner/repo',number:1,body:'Test',clientMutationId:'12345678-1234-1234-1234-123456789abc',confirmedSend:true};
 for(const sender of [githubTab(1,'/owner/repo/issues/1'),options,{id:'test-id',url:extensionOrigin+'session-reviews.html?repository=other/repo'}, {id:'test-id',url:extensionOrigin+'session-reviews.html?repository=owner/repo',frameId:2,tab:{url:'https://github.com/owner/repo'}},{id:'other',url:extensionOrigin+'session-reviews.html?repository=owner/repo'}])assert.notEqual((await message(request,sender)).ok,true);
});

test('dashboard history is owned-page-only and imported local entries contain no source content',async()=>{
 const R=require('../project-recents.js'),dashboard={id:'test-id',url:extensionOrigin+'dashboard.html'},local={id:'test-id',url:extensionOrigin+'local-viewer.html'};await message({type:'project-recents-clear',confirmed:true},dashboard);
 for(const sender of [viewer,options,githubTab(1,'/owner/repo'),{id:'wrong',url:dashboard.url},{...dashboard,frameId:2}])assert.notEqual((await message({type:'project-recents-list'},sender)).ok,true);
 assert.equal((await message({type:'project-recents-record-local',name:'Bench board',localId:'c'.repeat(64)},local)).ok,true);assert.equal((await message({type:'project-recents-record-local',name:'Bad',localId:'d'.repeat(64),content:'private source'},local)).ok,false);
 const listed=await message({type:'project-recents-list'},dashboard);assert.equal(listed.ok,true);assert.equal(listed.result.entries.length,1);assert.equal(listed.result.entries[0].name,'Bench board');assert.equal(JSON.stringify(localStore.get(R.KEY)).includes('private source'),false);
 assert.equal((await message({type:'github-auth-status'},dashboard)).ok,false);assert.equal((await message({type:'project-recents-clear'},dashboard)).ok,false);await message({type:'project-recents-clear',confirmed:true},dashboard);
});

test('only successful owned drawing loads record remote project metadata and recent opens use the stored pinned viewer scope',async()=>{
 const dashboard={id:'test-id',url:extensionOrigin+'dashboard.html'},request={type:'project',repository:'owner/repo',ref:sha('a'),file:'hardware/board.kicad_pcb'},files=[{path:request.file,content:'(kicad_pcb)'}];await message({type:'project-recents-clear',confirmed:true},dashboard);
 await background.recordLoadedProject(request,githubTab(1,'/owner/repo'),files);await background.recordLoadedProject({...request,type:'project-file',file:'analysis/report.json'},viewer,{content:'{}'});await background.recordLoadedProject(request,viewer,[]);assert.equal((await message({type:'project-recents-list'},dashboard)).result.entries.length,0);
 await background.recordLoadedProject(request,viewer,files);const entry=(await message({type:'project-recents-list'},dashboard)).result.entries[0];assert.equal(entry.ref,sha('a'));assert.equal(entry.name,'board');calls.created.length=0;assert.equal((await message({type:'dashboard-open-recent',id:entry.id},dashboard)).ok,true);const url=new URL(calls.created[0].url);assert.equal(url.pathname,'/browser-viewer.html');assert.equal(url.searchParams.get('head'),sha('a'));assert.equal(url.searchParams.get('file'),request.file);
 await message({type:'project-recents-remove',id:entry.id},dashboard);assert.equal((await message({type:'project-recents-list'},dashboard)).result.entries.length,0);
});

test('dashboard policy allows local history and local reopening offline but blocks remote opens and unapproved servers',async t=>{
 const dashboard={id:'test-id',url:extensionOrigin+'dashboard.html'},local={id:'test-id',url:extensionOrigin+'local-viewer.html'},priorPolicy=global.KiCadManagedPolicy,priorHosts=global.KiCadGitLabHosts;t.after(()=>{global.KiCadManagedPolicy=priorPolicy;global.KiCadGitLabHosts=priorHosts;});
 global.KiCadManagedPolicy={read:async()=>({valid:true,networkEnabled:false}),assertNetwork:async()=>{throw Error('Network access is disabled');}};await message({type:'project-recents-clear',confirmed:true},dashboard);await message({type:'project-recents-record-local',name:'Local board',localId:'c'.repeat(64)},local);const listed=await message({type:'project-recents-list'},dashboard);assert.equal(listed.result.networkEnabled,false);assert.equal((await message({type:'dashboard-open-recent',id:listed.result.entries[0].id},dashboard)).ok,true);
 assert.equal((await message({type:'dashboard-open-project',url:'https://github.com/owner/repo'},dashboard)).ok,false);global.KiCadManagedPolicy={assertNetwork:async()=>{},read:async()=>({valid:true,networkEnabled:true})};global.KiCadGitLabHosts={allowed:async host=>host==='https://gitlab.com'};
 for(const url of ['javascript:alert(1)','https://user:token@github.com/owner/repo','https://unapproved.example/group/repo'])assert.equal((await message({type:'dashboard-open-project',url},dashboard)).ok,false);
 assert.equal((await message({type:'dashboard-open-project',url:'https://gitlab.com/group/repo'},dashboard)).ok,true);await message({type:'project-recents-clear',confirmed:true},dashboard);
});
const sha = (char) => char.repeat(40);
const json = (value) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' }
});
const viewer = { id: 'test-id', url: `${extensionOrigin}browser-viewer.html?file=x` };
const options = { id: 'test-id', url: `${extensionOrigin}options.html` };
const githubTab = (id, pathname) => ({ id: 'test-id', tab: { id }, url: `https://github.com${pathname}` });
function message(request, sender = viewer) {
  return new Promise((resolve) => {
    const handled = messageListener(request, sender, resolve);
    if (!handled) resolve({ ignored: true });
  });
}

function withFetch(t, handler) {
  background.projectBuffer().clear();
  const before = global.fetch;
  global.fetch = handler;
  t.after(() => { global.fetch = before; });
}

test('host-page project and pull reads cannot cross repository, pull, or frame boundaries',async t=>{
 let reads=0;withFetch(t,async()=>{reads++;return json({});});
 for(const type of ['project','githubPull','githubFiles']){
  const input={type,repository:'private/other',ref:'main',file:'board.kicad_pcb',number:7};
  const result=await message(input,githubTab(2,'/owner/repo/pull/7/files'));
  assert.equal(result.ok,false);assert.match(result.error,/host page|In-page viewer/);
 }
 for(const type of ['githubPull','githubFiles'])assert.match((await message({type,repository:'owner/repo',number:8},githubTab(2,'/owner/repo/pull/7/files'))).error,/host page/);
 assert.match((await message({type:'project',repository:'owner/repo',ref:'main',file:'board.kicad_pcb'},{...githubTab(2,'/owner/repo/blob/main/board.kicad_pcb'),frameId:3})).error,/host page|In-page viewer/);
 assert.equal(reads,0);
});

test('worker failures carry sanitized access warnings without treating missing files as organization blocks',async t=>{
 const before=KiCadGitHubReviewApi.readThread;t.after(()=>{KiCadGitHubReviewApi.readThread=before;});const request={type:'github-thread-read',repository:'owner/repo',ref:sha('a'),file:'board.kicad_pcb',kind:'issue',number:42};KiCadGitHubReviewApi.readThread=async()=>{throw Error('net::ERR_BLOCKED_BY_ADMINISTRATOR SECRET');};const blocked=await message(request);assert.equal(blocked.ok,false);assert.equal(blocked.accessIssue?.kind,'organization-block',blocked.error);assert.equal(blocked.accessIssue.confirmed,true);assert.doesNotMatch(JSON.stringify(blocked.accessIssue),/SECRET/);KiCadGitHubReviewApi.readThread=async()=>{throw TypeError('Failed to fetch');};const network=await message(request);assert.equal(network.accessIssue.kind,'connection');assert.equal(network.accessIssue.confirmed,false);KiCadGitHubReviewApi.readThread=async()=>{throw Error('HTTP 404');};const missing=await message(request);assert.equal(missing.ok,false);assert.equal(missing.accessIssue,undefined);
});

test('schematic website snapshot pins scattered hierarchy reads without GitHub API',async t=>{
 const fixture=withWebsite(t,'owner/board',{'design/main.kicad_sch':'(kicad_sch (sheet (property "Sheetfile" "../shared/leaf.kicad_sch")) (sheet (property "Sheetfile" "../modules/io.kicad_sch")))','shared/leaf.kicad_sch':'(kicad_sch)','modules/io.kicad_sch':'(kicad_sch)','unrelated/project.kicad_sch':'(kicad_sch)'});
 const result=await message({type:'project',repository:'owner/board',ref:'feature/sheets',file:'shared/leaf.kicad_sch'});assert.equal(result.ok,true,result.error);assert.deepEqual(result.result.map(f=>f.path),['design/main.kicad_sch','shared/leaf.kicad_sch','modules/io.kicad_sch']);assert.ok(fixture.raw.every(r=>r.url.includes('/'+sha('a')+'/')));assert.equal(fixture.session.filter(r=>r.action==='resolve'&&r.ref==='feature/sheets').length,1);assert.equal(result.result[0].discoveryWarning,undefined);
});

test('bounded website inventory preserves requested files and discloses incomplete discovery',async t=>{
 const fixture=withWebsite(t,'owner/board',{'leaf.kicad_sch':'(kicad_sch)'},{entries:directory=>directory===''?[{path:'leaf.kicad_sch',type:'file'},...Array.from({length:80},(_,i)=>({path:'d'+i,type:'directory'}))]:[]});
 const result=await message({type:'project-inventory',repository:'owner/board',ref:'main',file:'leaf.kicad_sch'});assert.equal(result.ok,true,result.error);assert.ok(result.result.files.some(f=>f.path==='leaf.kicad_sch'));assert.match(result.result.warnings.join(' '),/incomplete/);assert.ok(fixture.session.length<=66);
});

test('schematic inventory rejects oversized transport bodies and unsafe repository paths before source reads', async t => {
  withFetch(t,async()=>new Response('{}',{headers:{'content-length':String(16*1024*1024+1)}}));
  await assert.rejects(background.githubSchematicInventory('owner/board',sha('a'),sha('b')),/size limit/);
  global.fetch=async()=>new Response(' '.repeat(16*1024*1024+1));
  await assert.rejects(background.githubSchematicInventory('owner/board',sha('a'),sha('b')),/size limit/);
  global.fetch=async()=>json({truncated:false,tree:[{path:'../escape.kicad_sch',type:'blob',mode:'100644'}]});
  await assert.rejects(background.githubSchematicInventory('owner/board',sha('a'),sha('b')),/unsafe schematic repository listing/);
});

test('revision resolution and pinned schematic reads never download commit patches',async t=>{
 const fixture=withWebsite(t,'owner/board',{'root.kicad_sch':'(kicad_sch)'});const result=await message({type:'revision-resolve',repository:'owner/board',ref:'large-change',file:'root.kicad_sch'});assert.equal(result.ok,true,result.error);assert.equal(result.result.sha,sha('a'));const project=await message({type:'project',repository:'owner/board',ref:result.result.sha,file:'root.kicad_sch'});assert.equal(project.ok,true,project.error);assert.ok(fixture.raw.every(r=>!r.url.includes('/commits/')));assert.ok(fixture.session.every(r=>['resolve','directory','file'].includes(r.action)));
});

test('legacy SHA media validation and website snapshots reject mismatched pinned commits',async t=>{
 let body=sha('b');withFetch(t,async()=>new Response(body));await assert.rejects(background.revisionResolve('owner/board',sha('a'),'root.kicad_sch'),/stable revision/);for(body of ['not-a-sha',JSON.stringify(sha('a')),sha('a')+' extra'])await assert.rejects(background.revisionResolve('owner/board','main','root.kicad_sch'),/stable revision/);body=' '.repeat(129);await assert.rejects(background.revisionResolve('owner/board','main','root.kicad_sch'),/size limit/);
 withWebsite(t,'owner/board',{'root.kicad_sch':'(kicad_sch)'},{sha:sha('b')});const mismatch=await message({type:'project',repository:'owner/board',ref:sha('a'),file:'root.kicad_sch'});assert.equal(mismatch.ok,false);assert.match(mismatch.error,/snapshot|session/i);
});
function websiteFeed(repository,commit){return `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:github.com,2008:Grit::Commit/${commit}</id><link href="https://github.com/${repository}/commit/${commit}"/><title>Saved revision</title><updated>2026-10-30T01:00:00Z</updated><author><name>Designer</name></author></entry></feed>`;}
function withWebsite(t,repository,sources={},options={}) {
 const previousQuery=chrome.tabs.query,previousSend=chrome.tabs.sendMessage,session=[],raw=[],files=new Map(Object.entries(sources)),controllers=new Map();
 const entries=directory=>{if(options.entries)return options.entries(directory);const rows=new Map();for(const path of files.keys()){const prefix=directory?directory+'/':'';if(!path.startsWith(prefix))continue;const tail=path.slice(prefix.length),name=prefix+tail.split('/')[0];rows.set(name,{path:name,type:tail.includes('/')?'directory':'file'});}return [...rows.values()];};
 const websiteFetch=async(url,init)=>{raw.push({url,init});assert.equal(init.credentials,'same-origin');assert.equal(init.headers?.Authorization,undefined);assert.equal(new URL(url).hostname,'github.com');let response;
  if(url.includes('/commits/'))response=new Response(websiteFeed(repository,options.sha||sha('a')),{headers:{'content-type':'application/atom+xml'}});
  else if(url.endsWith('/branches/all'))response=new Response('<script type="application/json">'+JSON.stringify({payload:{branches:[{name:'main',isDefault:true,path:'/'+repository}],current_page:1,has_more:true,per_page:20}})+'</script>',{headers:{'content-type':'text/html'}});
  else if(url.includes('/commit/'))response=new Response('<script type="application/json">'+JSON.stringify({payload:{commitRoute:{commit:{oid:options.sha||sha('a'),url:'/'+repository+'/commit/'+(options.sha||sha('a')),parents:[]}}}})+'</script>',{headers:{'content-type':'text/html'}});
  else if(options.raw)response=await options.raw(url,init);
  else{const prefix='https://github.com/'+repository+'/raw/'+(options.sha||sha('a'))+'/';assert.ok(url.startsWith(prefix),url);const content=files.get(decodeURIComponent(url.slice(prefix.length)));response=content===undefined?new Response('',{status:404}):new Response(content);}
  Object.defineProperty(response,'url',{value:url});return response;
 };
 chrome.tabs.query=async()=>[{id:51,url:'https://github.com/'+repository+'/tree/main'}];
 chrome.tabs.sendMessage=async(id,request)=>{session.push(request);if(request.type==='repository-session-cancel'){controllers.get(request.requestId)?.abort();return {ok:true};}if(options.readSession)return options.readSession(request);if(request.action==='resolve'||request.action==='directory')return {ok:true,result:{sha:options.sha||sha('a'),items:entries(request.action==='resolve'?'':request.path)}};
  const controller=new AbortController();if(request.requestId)controllers.set(request.requestId,controller);
  try{return {ok:true,result:await KiCadGitHubSessionReader.create({fetch:websiteFetch,location:{href:'https://github.com/'+repository},signal:controller.signal}).read(request)};}catch(error){return {ok:false,error:error.message};}finally{controllers.delete(request.requestId);}
 };
 withFetch(t,async()=>{throw Error('Project viewing attempted a forbidden background fetch.');});
 t.after(()=>{chrome.tabs.query=previousQuery;chrome.tabs.sendMessage=previousSend;background.projectBuffer().clear();});return {session,raw,files};
}

function withPublishingFetch(t, handler) {
  withFetch(t, (url, init) => {
    const match = /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url);
    if (match) return json({ private: false, full_name: `${match[1]}/${match[2]}`, default_branch: 'main' });
    if (url.includes('/contents/.kicad-review-policy.json?')) return new Response(null, { status: 404 });
    if (url === 'https://api.github.com/user') return json({ login: 'reviewer' });
    return handler(url, init);
  });
}

test('account badge reflects connection, sign-out and reset without exposing credentials', async () => {
  const token = 'github_pat_' + 'b'.repeat(40);
  assert.equal((await message({type:'github-auth-set',token},options)).ok, true);
  assert.equal(calls.badge, '●');
  assert.match(calls.actionTitle, /GitHub connected/);
  assert.equal(calls.actionTitle.includes(token), false);
  await message({type:'github-auth-clear'},options);
  assert.equal(calls.badge, '');
  assert.match(calls.actionTitle, /signed out/);
  await message({type:'github-auth-set',token},options);
  await message({type:'github-auth-reset'},options);
  assert.equal(calls.badge, '');
});

test('settings verify authenticated identity and private repository access without posting', async t => {
  const token='github_pat_'+'v'.repeat(40);
  await message({type:'github-auth-set',token},options);
  const requests=[];
  withFetch(t,async(url,init)=>{
    requests.push(url);
    assert.equal(init.headers.Authorization,'Bearer '+token);
    assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
    if(url==='https://api.github.com/user')return json({login:'reviewer'});
    if(url==='https://api.github.com/repos/owner/private')return json({full_name:'owner/private',private:true,default_branch:'main',permissions:{pull:true}});
    throw new Error('Unexpected URL');
  });
  const result=await message({type:'github-access-test',repository:'owner/private'},options);
  assert.equal(result.ok,true);assert.equal(result.result.private,true);assert.equal(result.result.login,'reviewer');
  assert.equal(JSON.stringify(result).includes(token),false);
  const count=requests.length;
  assert.equal((await message({type:'github-access-test',repository:'owner/private'},githubTab(1,'/owner/private'))).ok,false);
  assert.equal(requests.length,count);
  await message({type:'github-auth-clear'},options);
  assert.match((await message({type:'github-access-test',repository:'owner/private'},options)).error,/signed out or expired/);
});

test('background finishes device authorization without an options-page poll', async t => {
  await message({type:'github-auth-clear'},options);
  const savedTimer=global.setTimeout, savedClear=global.clearTimeout;
  let tick;
  global.setTimeout=(fn,delay)=>{if(delay<30000)tick=fn;return {unref(){}};};
  global.clearTimeout=()=>{};
  t.after(()=>{global.setTimeout=savedTimer;global.clearTimeout=savedClear;});
  withFetch(t,async url=>url.endsWith('/login/device/code') ?
    json({device_code:'d'.repeat(40),user_code:'TEST-CODE',verification_uri:'https://github.com/login/device',expires_in:900,interval:5}) :
    json({access_token:'gho_'+'s'.repeat(40),token_type:'bearer',scope:'repo'}));
  const start=await message({type:'github-device-start',scope:'repo'},options);
  assert.equal(start.result.state,'pending');assert.equal(typeof tick,'function');
  sessionStore.get('github-device-pending').nextPollAt=Date.now()-1;
  await tick();
  assert.equal((await message({type:'github-auth-status'},options)).result.configured,true);
  assert.equal(sessionStore.has('github-device-pending'),false);
  assert.equal(calls.badge,'●');
  await message({type:'github-auth-clear'},options);
});

test('global project search resolves one immutable revision and excludes symlinks and unsafe paths',async t=>{
 const fixture=withWebsite(t,'wayri/board',{'power/child.kicad_sch':'(kicad_sch)','main.kicad_pcb':'(kicad_pcb)','main.kicad_pro':'{}'},{entries:directory=>directory===''?[{path:'power',type:'directory'},{path:'main.kicad_pcb',type:'file'},{path:'main.kicad_pro',type:'file'},{path:'linked.kicad_sch',type:'symlink'}]:[{path:'power/child.kicad_sch',type:'file'}]});const reply=await message({type:'project-search-files',repository:'wayri/board',ref:'main',file:'main.kicad_pcb'});assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.files.map(f=>f.path),['main.kicad_pcb','power/child.kicad_sch']);assert.equal(reply.result.settings[0].path,'main.kicad_pro');assert.equal(reply.result.snapshotRef,sha('a'));assert.ok(fixture.raw.every(r=>r.url.includes('/'+sha('a')+'/')));const count=fixture.raw.length;assert.equal((await message({type:'project-search-files',repository:'wayri/board',ref:'main',file:'main.kicad_pcb'},githubTab(1,'/wayri/board'))).ok,false);assert.equal(fixture.raw.length,count);
});

test('global website search discloses bounded drawing count',async t=>{
 const sources=Object.fromEntries(Array.from({length:40},(_,i)=>['p'+String(i).padStart(2,'0')+'.kicad_pcb','(kicad_pcb)']));const fixture=withWebsite(t,'wayri/search',sources);const reply=await message({type:'project-search-files',repository:'wayri/search',ref:'main',file:'p00.kicad_pcb'});assert.equal(reply.ok,true,reply.error);assert.equal(reply.result.files.length,32);assert.equal(fixture.raw.length,32);assert.match(reply.result.warnings.join(' '),/at most 32/);
});
test('website search skips an oversized drawing with a visible warning and never allocates its advertised body',async t=>{
 const fixture=withWebsite(t,'owner/oversized-search',{'large.kicad_pcb':'unused','small.kicad_sch':'(kicad_sch)'},{raw:async url=>url.endsWith('/large.kicad_pcb')?new Response('unused',{headers:{'content-length':String(64*1024*1024+1)}}):new Response('(kicad_sch)')});
 const reply=await message({type:'project-search-files',repository:'owner/oversized-search',ref:'main',file:'large.kicad_pcb'});assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.files.map(f=>f.path),['small.kicad_sch']);assert.match(reply.result.warnings.join(' '),/large\.kicad_pcb.*(?:byte limit|size limit)/);assert.equal(fixture.raw.length,2);
});

test('saved report reads stay on repository revision and reject traversal and non-viewer callers',async t=>{
 const fixture=withWebsite(t,'wayri/board',{'reports/board-drc.json':'{"coordinate_units":"mm"}'});const request={type:'rule-report',repository:'wayri/board',ref:sha('a'),file:'board.kicad_pcb',reportPath:'reports/board-drc.json'};const reply=await message(request);assert.equal(reply.ok,true,reply.error);assert.match(reply.result.content,/coordinate_units/);assert.equal((await message({...request,reportPath:'../token.json'})).ok,false);assert.equal((await message(request,githubTab(1,'/wayri/board'))).ok,false);assert.equal(fixture.raw.length,1);assert.equal(fixture.raw[0].url,'https://github.com/wayri/board/raw/'+sha('a')+'/reports/board-drc.json');
});

test('pull metadata uses GitHub merge base and permits a public fork', async (t) => {
  const urls = [];
  withFetch(t, async (url) => {
    urls.push(url);
    if (url.endsWith('/pulls/7')) return json({
      base: { sha: sha('a'), repo: { full_name: 'owner/board', private: false } },
      head: { sha: sha('b'), repo: { full_name: 'fork/board', private: false } }, changed_files: 2
    });
    if (url.includes('/compare/')) return json({ merge_base_commit: { sha: sha('c') },base_commit:{sha:sha('a')},head_commit:{sha:sha('b')} });
    throw new Error('Unexpected API request');
  });
  const result = await background.githubPull('owner/board', 7);
  assert.deepEqual(result, { base: sha('c'), baseTip:sha('a'), head: sha('b'), headRepository: 'fork/board',
    changedFiles: 2, private: false });
  assert.match(urls[1], /\/compare\/a{40}\.\.\.b{40}\?per_page=1$/);
});

test('private PR comparison uses one authenticated account and pinned fork revisions',async t=>{
 const urls=[];let signed=false;
 withFetch(t,async(url,init)=>{urls.push({url,init});if(url.includes('/compare/'))return json({merge_base_commit:{sha:sha('c')},base_commit:{sha:sha('a')},head_commit:{sha:sha('b')}});return json({base:{sha:sha('a'),repo:{full_name:'owner/board',private:true}},head:{sha:sha('b'),repo:{full_name:'private/board',private:true}},changed_files:1});});
 await assert.rejects(background.githubPull('owner/board',7),/Sign in with private/);assert.equal(urls.length,1);
 const token='github_pat_private_comparison_123456';await KiCadGitHubReviewApi.setToken(token);t.after(()=>KiCadGitHubReviewApi.clearToken());urls.length=0;
 const pull=await background.githubPull('owner/board',7);assert.equal(pull.private,true);assert.equal(pull.headRepository,'private/board');assert.equal(pull.base,sha('c'));assert.equal(pull.baseTip,sha('a'));
 assert.equal(urls.length,2);for(const call of urls){assert.equal(call.init.headers.Authorization,'Bearer '+token);assert.equal(new URL(call.url).origin,'https://api.github.com');assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'error');}
 assert.ok(urls[1].url.includes(sha('a')+'...'+sha('b')));
});
test('account changes cancel PR metadata before comparison and mismatched comparison SHAs fail',async t=>{
 await KiCadGitHubReviewApi.setToken('github_pat_compare_race_123456');t.after(()=>KiCadGitHubReviewApi.clearToken());let requests=0;
 withFetch(t,async()=>{requests++;await KiCadGitHubReviewApi.clearToken();return json({base:{sha:sha('a'),repo:{full_name:'owner/board',private:true}},head:{sha:sha('b'),repo:{full_name:'owner/board',private:true}},changed_files:1});});
 await assert.rejects(background.githubPull('owner/board',7),/changed or signed out/);assert.equal(requests,1);
 global.fetch=async url=>url.includes('/compare/')?json({merge_base_commit:{sha:sha('c')},base_commit:{sha:sha('a')},head_commit:{sha:sha('d')}}):json({base:{sha:sha('a'),repo:{full_name:'owner/board',private:false}},head:{sha:sha('b'),repo:{full_name:'owner/board',private:false}},changed_files:1});
 await assert.rejects(background.githubPull('owner/board',7),/pinned pull request revisions/);
});

test('file listing paginates and reports incomplete or over-limit results', async (t) => {
  const urls = [];
  withFetch(t, async (url) => {
    urls.push(url);
    if(url.endsWith('/pulls/7'))return json({base:{sha:sha('a'),repo:{full_name:'owner/board'}},head:{sha:sha('b')},changed_files:101});
    const page = Number(new URL(url).searchParams.get('page'));
    return json(Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({
      filename: `folder/file${page}-${index}.kicad_pcb`, status: 'modified'
    })));
  });
  const files = await background.githubFiles('owner/board', 7, 101, sha('b'), sha('a'));
  assert.equal(files.length, 101);
  assert.match(urls[2], /page=2$/);
  await assert.rejects(background.githubFiles('owner/board', 7, 101, sha('b'), sha('d')), /changed the pull request/);
  const before = urls.length;
  await assert.rejects(background.githubFiles('owner/board', 7, 3001), /3,000 files/);
  assert.equal(urls.length, before);
});

test('incomplete PR pagination is rejected even when its metadata remains stable',async t=>{
 withFetch(t,async url=>url.endsWith('/pulls/7')?json({base:{sha:sha('a'),repo:{full_name:'owner/board'}},head:{sha:sha('b')},changed_files:101}):json(new URL(url).searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>({filename:`board${i}.kicad_pcb`,status:'modified'})):[]));
 await assert.rejects(background.githubFiles('owner/board',7,101,sha('b'),sha('a')),/changed or truncated/);
});

test('private PR file pagination discards changed snapshots and sign-out results',async t=>{
 await KiCadGitHubReviewApi.setToken('github_pat_paginated_private_123456');t.after(()=>KiCadGitHubReviewApi.clearToken());
 let metadataReads=0;const calls=[];
 withFetch(t,async(url,init)=>{calls.push({url,init});if(url.endsWith('/pulls/7')){metadataReads++;return json({base:{sha:sha('a'),repo:{full_name:'owner/board'}},head:{sha:sha(metadataReads===1?'b':'d')},changed_files:1});}return json([{filename:'design/old.kicad_pcb',previous_filename:'nested/board.kicad_pcb',status:'renamed'}]);});
 await assert.rejects(background.githubFiles('owner/board',7,1,sha('b'),sha('a')),/changed the pull request/);
 assert.equal(calls.length,3);for(const call of calls)assert.ok(call.init.headers.Authorization);
 metadataReads=0;global.fetch=async url=>{if(url.endsWith('/pulls/7'))return json({base:{sha:sha('a'),repo:{full_name:'owner/board'}},head:{sha:sha('b')},changed_files:1});await KiCadGitHubReviewApi.clearToken();return json([{filename:'board.kicad_pcb',status:'modified'}]);};
 await assert.rejects(background.githubFiles('owner/board',7,1,sha('b'),sha('a')),/changed or signed out/);
});

test('suffix-changing renames become added and removed design entries', () => {
  assert.deepEqual(background.designChanges([
    { filename: 'board.kicad_pcb', previous_filename: 'notes.txt', status: 'renamed' },
    { filename: 'notes.txt', previous_filename: 'old.kicad_sch', status: 'renamed' },
    { filename: 'new.kicad_sch', previous_filename: 'old.kicad_pcb', status: 'renamed' },
    { filename: 'new/name.kicad_pcb', previous_filename: 'old/name.kicad_pcb', status: 'renamed' }
  ]), [
    { file: 'board.kicad_pcb', oldFile: 'board.kicad_pcb', status: 'added' },
    { file: 'old.kicad_sch', oldFile: 'old.kicad_sch', status: 'removed' },
    { file: 'old.kicad_pcb', oldFile: 'old.kicad_pcb', status: 'removed' },
    { file: 'new.kicad_sch', oldFile: 'new.kicad_sch', status: 'added' },
    { file: 'new/name.kicad_pcb', oldFile: 'old/name.kicad_pcb', status: 'renamed' }
  ]);
});

test('only exact extension viewers and GitHub can message the worker', () => {
  assert.equal(background.senderAllowed({ url: `${extensionOrigin}browser-viewer.html?file=x`, id: 'test-id' }), true);
  assert.equal(background.senderAllowed({ url: `${extensionOrigin}revision-viewer.html?file=x`, id: 'test-id' }), true);
  assert.equal(background.senderAllowed({ url: `${extensionOrigin}schematic-viewer.html?file=x`, id: 'test-id' }), true);
  assert.equal(background.senderAllowed({ url: `${extensionOrigin}pcb-viewer.html?file=x`, id: 'test-id' }), true);
  assert.equal(background.senderAllowed({ url: `${extensionOrigin}browser-viewer.html.evil`, id: 'test-id' }), false);
  assert.equal(background.senderAllowed({ url: `${extensionOrigin}browser-viewer.html`, id: 'other' }), false);
  assert.equal(background.senderAllowed({ url: 'https://github.com.evil.test/x', id: 'other' }), false);
  assert.equal(background.senderAllowed({ url: 'https://github.com/owner/repo', id: 'test-id' }), true);
  assert.equal(background.senderAllowed({ url: 'https://github.com/owner/repo', id: 'other' }), false);
  assert.equal(messageListener({ type: 'project' }, { url: 'https://evil.test/' }, () => {}), false);
});

const sampleComment = () => ({ id: 'note-1', text: 'Check this symbol',
  createdAt: '2026-10-03T09:20:00.000Z',
  anchor: { repository: 'owner/board', ref: 'a'.repeat(40), file: 'design/root.kicad_sch',
    objectId: 'symbol-1', position: { x: 15, y: 20 } } });

test('comments persist per repository/revision/file and reject unauthorized writers', async () => {
  localStore.clear();
  const note = sampleComment();
  assert.equal((await message({ type: 'comment-save', comment: note })).ok, true);
  const scope = note.anchor;
  assert.equal((await message({ type: 'comment-list', ...scope })).result.length, 1);
  assert.equal((await message({ type: 'comment-list', ...scope, ref: 'b'.repeat(40) })).result.length, 0);
  assert.equal((await message({ type: 'comment-list', ...scope, file: 'design/other.kicad_sch' })).result.length, 0);
  assert.match((await message({ type: 'comment-save', comment: note }, githubTab(3, '/owner/board/pull/7'))).error, /Only extension viewers/);
  assert.match((await message({ type: 'comment-save', comment: { ...note, text: 'x'.repeat(4001) } })).error, /4,000/);
  assert.equal((await message({ type: 'comment-delete', ...scope, id: note.id })).result.deleted, true);
  assert.equal((await message({ type: 'comment-list', ...scope })).result.length, 0);
});

test('provider annotation reads refresh only confirmed thread snapshots in the optional cache',async t=>{
 const original=global.KiCadReviewFileStore,reader=KiCadGitHubReviewApi.createAnnotationReader,cached=[];
 t.after(()=>{global.KiCadReviewFileStore=original;KiCadGitHubReviewApi.createAnnotationReader=reader;});
 global.KiCadReviewFileStore={status:async()=>({connected:true}),sync:async(...args)=>cached.push(args)};
 const note=sampleComment();let body=KiCadReviewComments.toMarkdown(note);
 KiCadGitHubReviewApi.createAnnotationReader=async()=>async path=>path.includes('/comments?')?[]:{number:3,state:'open',body,user:{login:'reviewer'}};
 const result=await background.githubAnnotations({...note.anchor,issueNumber:3});assert.equal(result.notes.length,1);assert.equal(cached.length,1);assert.equal(cached[0][1][0].remoteRefs[0].url,`https://github.com/${note.anchor.repository}/issues/3`);assert.deepEqual(cached[0][2],{sourceUrl:`https://github.com/${note.anchor.repository}/issues/3`,complete:true});
 body='';await background.githubAnnotations({...note.anchor,issueNumber:3});assert.deepEqual(cached[1][1],[]);assert.equal(cached[1][2].complete,true,'confirmed empty thread clears only its published cache');
 body=KiCadReviewComments.toMarkdown(note);KiCadGitHubReviewApi.createAnnotationReader=async()=>async path=>path.includes('/comments?')?[]:{number:3,state:'open',body,pull_request:{},user:{login:'reviewer'}};
 await background.githubAnnotations({...note.anchor,pullRepository:'upstream/board',pullNumber:3});assert.equal(cached[2][1][0].remoteRefs[0].kind,'pull-request');assert.equal(cached[2][1][0].remoteRefs[0].repository,'upstream/board');assert.equal(cached[2][2].sourceUrl,'https://github.com/upstream/board/pull/3');assert.equal(cached[2][2].complete,true);
 global.KiCadReviewFileStore={};assert.equal((await background.githubAnnotations({...note.anchor,issueNumber:3})).notes.length,1,'absent optional cache cannot break provider readback');
 global.KiCadReviewFileStore={status:async()=>{throw Error('Unavailable');},sync:async()=>{}};assert.equal((await background.githubAnnotations({...note.anchor,issueNumber:3})).notes.length,1,'broken optional cache cannot break provider readback');
});

test('connected sync cache preserves legacy drafts but new drafts use browser storage', async (t) => {
  const store = global.KiCadReviewFileStore;
  const original = { ...store };
  t.after(() => Object.assign(store, original));
  const saved = [{...sampleComment(),id:'legacy'}];
  Object.assign(store, {
    status: async () => ({ connected: true, name: 'board.kicad-review.json' }),
    read: async () => saved.slice(),
    save: async (note) => { saved.push(note); return note; },
    remove: async (scope, id) => {
      const index = saved.findIndex((item) => item.id === id && item.anchor.file === scope.file);
      if (index < 0) return { deleted: false };
      saved.splice(index, 1); return { deleted: true };
    }
  });
  localStore.clear();
  const note = sampleComment();
  assert.equal((await message({ type: 'comment-store-status' })).result.connected, true);
  assert.equal((await message({ type: 'comment-save', comment: note })).ok, true);
  assert.equal(localStore.size, 1, 'pending drafts use browser storage');
  assert.equal(saved.length,1,'saving a new draft never changes the provider cache');
  assert.equal((await message({ type: 'comment-list', ...note.anchor })).result.length, 2);
  assert.equal((await message({ type: 'comment-delete', ...note.anchor, id: note.id })).result.deleted, true);
  assert.equal((await message({ type: 'comment-list', ...note.anchor })).result.length, 1);
  assert.equal(saved[0].id,'legacy','legacy pending draft survives');
});

test('publication receipt retires drafts without making local published content authoritative',async t=>{
 const prior=global.KiCadReviewFileStore;global.KiCadReviewFileStore={status:async()=>({connected:false})};t.after(()=>global.KiCadReviewFileStore=prior);localStore.clear();
 const note=sampleComment();assert.equal((await message({type:'comment-save',comment:note})).ok,true);
 const published={...note,remoteRefs:[{kind:'issue',repository:note.anchor.repository,number:3,url:`https://github.com/${note.anchor.repository}/issues/3`,publishedAt:note.createdAt}]};
 assert.equal((await message({type:'comment-save',comment:published,expectedUpdatedAt:note.updatedAt})).ok,true);assert.deepEqual((await message({type:'comment-list',...note.anchor})).result,[]);
 assert.equal((await message({type:'comment-save',comment:{...published,text:'Local metadata edit'}})).ok,true);assert.deepEqual((await message({type:'comment-list',...note.anchor})).result,[],'published edits must be read from the provider');
});

test('saving a 101st note to one file is rejected while editing an existing note works', async () => {
  localStore.clear();
  const note = sampleComment();
  for (let index = 0; index < 100; index++) {
    assert.equal((await message({ type: 'comment-save', comment: { ...note, id: `note-${index}` } })).ok, true);
  }
  assert.match((await message({ type: 'comment-save', comment: { ...note, id: 'note-100' } })).error, /at most 100/);
  assert.equal((await message({ type: 'comment-save', comment: { ...note, id: 'note-0', text: 'Edited' } })).ok, true);
  const notes = (await message({ type: 'comment-list', ...note.anchor })).result;
  assert.equal(notes.length, 100);
  assert.equal(notes[0].text, 'Edited');
});

test('draft action opens issue composer or stages a PR textarea draft without posting', async () => {
  calls.created.length = calls.updated.length = calls.removed.length = 0;
  sessionStore.clear();
  const note = sampleComment();
  const issue = await message({ type: 'open-comment-draft', comment: note });
  assert.equal(issue.result.destination, 'issue');
  assert.match(calls.created[0].url, /^https:\/\/github.com\/owner\/board\/issues\/new\?/);
  assert.match(new URL(calls.created[0].url).searchParams.get('title'), /^\[Info\]/);
  assert.match(new URL(calls.created[0].url).searchParams.get('body'), /Check this symbol/);
  const forkNote = sampleComment();
  forkNote.anchor.repository = 'fork/board';
  const pull = await message({ type: 'open-comment-draft', comment: forkNote,
    pullNumber: 7, pullRepository: 'owner/board' });
  assert.equal(pull.result.destination, 'pull-request');
  assert.equal(calls.created[1].url, 'about:blank');
  assert.equal(calls.updated[0].url, 'https://github.com/owner/board/pull/7#issuecomment-new');
  const tabId = pull.result.tabId;
  assert.equal((await message({ type: 'claim-comment-draft' }, githubTab(tabId, '/owner/board/pull/8'))).result, null);
  assert.equal((await message({ type: 'claim-comment-draft' }, githubTab(tabId, '/owner/board/pull/7/files'))).result, null);
  const claim = await message({ type: 'claim-comment-draft' }, githubTab(tabId, '/owner/board/pull/7'));
  assert.match(claim.result.body, /Check this symbol/);
  assert.match(claim.result.body, /fork\/board/, 'draft retains the fork file anchor');
  assert.equal((await message({ type: 'ack-comment-draft' }, githubTab(tabId, '/owner/board/pull/7'))).result.acknowledged, true);
  assert.equal((await message({ type: 'claim-comment-draft' }, githubTab(tabId, '/owner/board/pull/7'))).result, null);
  assert.match((await message({ type: 'open-comment-draft', comment: note, pullNumber: 0 })).error, /Invalid pull/);
  assert.match((await message({ type: 'open-comment-draft', comment: forkNote, pullNumber: 7 })).error, /repository/);
  assert.match((await message({ type: 'open-comment-draft', comment: forkNote,
    pullNumber: 7, pullRepository: '../evil' })).error, /repository/);
  assert.match((await message({ type: 'open-comment-draft', comment: note }, githubTab(1, '/owner/board/pull/7'))).error, /Only extension viewers/);
});

test('discussion and existing issue drafts stay in their GitHub composers until user submits', async () => {
  calls.created.length = calls.updated.length = 0;
  sessionStore.clear();
  const note = { ...sampleComment(), severity: 'major' };
  const discussion = await message({ type: 'open-comment-draft', comment: note,
    destination: 'discussion', targetRepository: 'base/board' });
  assert.equal(discussion.result.destination, 'discussion');
  assert.equal(calls.updated[0].url, 'https://github.com/base/board/discussions/new');
  const claim = await message({ type: 'claim-comment-draft' },
    githubTab(discussion.result.tabId, '/base/board/discussions/new'));
  assert.match(claim.result.title, /^\[Major\]/);
  assert.match(claim.result.body, /\| Severity \| Major \|/);
  assert.equal((await message({ type: 'ack-comment-draft' },
    githubTab(discussion.result.tabId, '/base/board/discussions/new'))).result.acknowledged, true);
  const issue = await message({ type: 'open-comment-draft', comment: note,
    targetType: 'issue', targetNumber: 31, targetRepository: 'base/board' });
  assert.equal(calls.updated[1].url, 'https://github.com/base/board/issues/31#issuecomment-new');
  assert.equal((await message({ type: 'claim-comment-draft' },
    githubTab(issue.result.tabId, '/base/board/issues/31'))).result.title, undefined);
  assert.equal((await message({ type: 'claim-comment-draft' },
    githubTab(issue.result.tabId, '/other/board/issues/31'))).result, null);
  assert.match((await message({ type: 'open-comment-draft', comment: note,
    targetType: 'discussion', targetNumber: 0 })).error, /thread number/);
});

test('public issue reader matches fork-anchored notes and constructs only GitHub URLs', async (t) => {
  const note = { ...sampleComment(), severity: 'critical' };
  note.anchor.repository = 'fork/board';
  const markdown = global.KiCadReviewComments.toMarkdown(note);
  const before = global.fetch, urls = [];
  t.after(() => { global.fetch = before; });
  global.fetch = async (url) => {
    urls.push(url);
    if (url.includes('/issues?')) return json([
      { number: 11, state: 'open', body: markdown, user: { login: 'alice' },
        html_url: 'https://evil.example/forged' },
      { number: 7, state: 'closed', pull_request: {}, body: 'unrelated', user: { login: 'bob' } }
    ]);
    if (url.includes('/issues/7/comments')) return json([
      { id: 55, body: markdown, user: { login: 'reviewer' }, html_url: 'https://evil.example/forged' }
    ]);
    if(url.endsWith('/issues/7'))return json({number:7,state:'closed',pull_request:{},body:markdown,user:{login:'bob'},created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T01:00:00Z'});
    throw new Error(`Unexpected GitHub read ${url}`);
  };
  const reply = await message({ type: 'github-annotations', repository: 'fork/board',
    ref: note.anchor.ref, file: note.anchor.file, pullRepository: 'base/board',
    pullNumber: 7, includeDiscussions: true });
  assert.equal(reply.ok, true);
  assert.equal(reply.result.notes.length, 2);
  assert.equal(reply.result.notes[0].severity, 'critical');
  assert.equal(reply.result.notes[0].github.url, 'https://github.com/base/board/pull/7');
  assert.equal(reply.result.notes[0].github.createdAt,'2026-10-04T00:00:00Z');
  assert.equal(reply.result.notes[1].github.url, 'https://github.com/base/board/pull/7#issuecomment-55');
  assert.equal(reply.result.notes[1].github.source, 'pull-request');
  assert.ok(reply.result.warnings.some((warning) => /Discussion readback/.test(warning)));
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.startsWith('https://api.github.com/repos/base/board/issues')));
  assert.match((await message({ type: 'github-annotations', repository: 'fork/board',
    ref: note.anchor.ref, file: note.anchor.file }, githubTab(9, '/base/board/issues/11'))).error,
    /Only extension viewers/);
});

test('public issue reader surfaces rate limits and bounded scan warnings', async (t) => {
  const before = global.fetch;
  t.after(() => { global.fetch = before; });
  global.fetch = async () => new Response('rate limit', { status: 403,
    headers: { 'x-ratelimit-remaining': '0' } });
  const scope = sampleComment().anchor;
  assert.match((await message({ type: 'github-annotations', ...scope })).error, /rate limit/);
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    if (url.includes('/comments?')) return json(Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: '' })));
    return json(Array.from({ length: 100 }, (_, index) => ({ number: index + 1, body: '' })));
  };
  const result = await message({ type: 'github-annotations', ...scope });
  assert.equal(result.ok, true);
  assert.equal(urls.length, 2, 'repository scan reads at most two issue pages');
  assert.ok(result.result.warnings.some((warning) => /200 recent/.test(warning)));
  urls.length=0;
  global.fetch=async url=>{urls.push(url);if(url.includes('/comments?'))return json(Array.from({length:100},(_,index)=>({id:index+1,body:''})));return json({number:1,state:'open',body:''});};
  const selected=await message({type:'github-annotations',...scope,issueNumber:1});
  assert.equal(selected.ok,true);assert.equal(urls.length,6,'selected thread reads its body and five comment pages');
  assert.ok(selected.result.warnings.some(warning=>/500 comments/.test(warning)));
});

test('toolbar opens a standalone drawing or repository launcher without navigating the host page', async()=>{
 calls.created.length=calls.updated.length=calls.messages.length=0;calls.response=null;
 await background.openFromAction({id:3,url:'https://github.com/owner/repo/blob/main/design/root.kicad_sch'});
 let url=new URL(calls.created[0].url);assert.equal(url.pathname,'/browser-viewer.html');assert.equal(url.searchParams.get('file'),'design/root.kicad_sch');assert.equal(url.searchParams.get('head'),'main');
 await background.openFromAction({id:3,url:'https://github.com/owner/repo'});
 url=new URL(calls.created[1].url);assert.equal(url.pathname,'/project-launcher.html');assert.equal(url.searchParams.get('source'),'https://github.com/owner/repo');assert.equal(url.searchParams.get('ref'),'HEAD');
 await background.openFromAction({id:3,url:'https://github.com/owner/repo/pull/12'});
 assert.equal(new URL(calls.created[2].url).pathname,'/project-launcher.html');assert.equal(calls.updated.length,0);assert.ok(calls.messages.every(c=>c.message.type==='projectLaunchContext'));assert.equal(typeof actionListener,'function');
});

test('toolbar always opens visible feedback even when content scripts or URLs are unavailable',async t=>{
 const before=chrome.tabs.sendMessage;t.after(()=>{chrome.tabs.sendMessage=before;});chrome.tabs.sendMessage=async()=>{throw Error('No receiving content script');};calls.created.length=0;
 for(const tab of [undefined,{id:3},{id:3,url:'not a URL'},{id:3,url:'chrome://newtab/'},{id:3,url:'https://example.com/'}])await background.openFromAction(tab);
 assert.equal(calls.created.length,5);assert.ok(calls.created.every(c=>new URL(c.url).pathname==='/project-launcher.html'));
 await background.openFromAction({id:3,url:'https://github.com/owner/repo'});assert.equal(new URL(calls.created[5].url).searchParams.get('ref'),'HEAD');
});

test('GitLab toolbar keeps namespace and host while requiring approved host access',async t=>{
 const previous=global.KiCadGitLabHosts;t.after(()=>{global.KiCadGitLabHosts=previous;});global.KiCadGitLabHosts={allowed:async host=>host==='https://gitlab.com'};
 calls.created.length=0;calls.response={repository:'group/sub/project',file:'design/board.kicad_pcb',head:'main'};
 await background.openFromAction({id:3,url:'https://gitlab.com/group/sub/project/-/blob/main/design/board.kicad_pcb'});
 let url=new URL(calls.created[0].url);assert.equal(url.pathname,'/browser-viewer.html');assert.equal(url.searchParams.get('provider'),'gitlab');assert.equal(url.searchParams.get('repository'),'group/sub/project');
 await background.openFromAction({id:3,url:'https://gitlab.com/group/sub/project'});url=new URL(calls.created[1].url);assert.equal(url.searchParams.get('source'),'https://gitlab.com/group/sub/project');
 await background.openFromAction({id:3,url:'https://not-approved.example/group/project'});assert.equal(new URL(calls.created[2].url).searchParams.has('source'),false);
});

test('private annotation readback uses the connected account and loads comments beyond the first page',async t=>{
 const token='github_pat_'+ 'p'.repeat(60),before=global.fetch;
 t.after(async()=>{global.fetch=before;await global.KiCadGitHubReviewApi.clearToken();});
 await global.KiCadGitHubReviewApi.setToken(token);
 const note=sampleComment(),body=global.KiCadReviewComments.toMarkdown(note),calls=[];
 global.fetch=async(url,init)=>{calls.push(url);assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  if(url.endsWith('/issues/23'))return json({number:23,state:'open',body:'',user:{login:'owner'}});
  if(url.endsWith('page=1'))return json(Array.from({length:100},(_,i)=>({id:i+1,body:''})));
  if(url.endsWith('page=2'))return json([{id:101,body,user:{login:'reviewer'},created_at:'2026-10-04T08:00:00Z',updated_at:'2026-10-04T09:00:00Z',html_url:'https://evil.example'}]);
  throw new Error('Unexpected annotation path');};
 const reply=await message({type:'github-annotations',...note.anchor,issueNumber:23});
 assert.equal(reply.ok,true);assert.equal(reply.result.notes.length,1);assert.equal(calls.length,3);
 assert.equal(reply.result.notes[0].github.url,'https://github.com/owner/board/issues/23#issuecomment-101');assert.equal(reply.result.notes[0].github.author,'reviewer');assert.equal(reply.result.notes[0].github.updatedAt,'2026-10-04T09:00:00Z');
});

test('token settings are options-only and never disclose the credential', async () => {
  sessionStore.clear();
  const token = 'github_pat_' + 'a'.repeat(60);
  assert.match((await message({ type: 'github-auth-set', token })).error, /Only extension options/);
  assert.match((await message({ type: 'github-auth-reset' })).error, /Only extension options/);
  assert.match((await message({ type: 'github-auth-set', token }, githubTab(5, '/owner/board'))).error,
    /Only extension options/);
  assert.equal((await message({ type: 'github-auth-set', token }, options)).result.configured, true);
  assert.equal((await message({ type: 'github-auth-status' })).result.configured, true);
  assert.equal(JSON.stringify((await message({ type: 'github-auth-status' })).result).includes(token), false);
  assert.equal((await message({ type: 'github-auth-status' }, githubTab(5, '/owner/board'))).ok, false);
  assert.equal((await message({ type: 'open-options' })).result.opened, true);
  assert.equal((await message({ type: 'github-auth-clear' }, options)).result.configured, false);
});

test('device sign-in requests public_repo and respects pending and slow_down intervals', async (t) => {
  localStore.clear(); sessionStore.clear();
  const urls = [], token = 'gho_' + 'z'.repeat(40);
  let pollResponse = { error: 'authorization_pending' };
  withFetch(t, async (url, init) => {
    urls.push({ url, init });
    if (url.endsWith('/login/device/code')) return json({ device_code: 'd'.repeat(40),
      user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device',
      expires_in: 900, interval: 5 });
    if (url.endsWith('/login/oauth/access_token')) return json(pollResponse);
    throw new Error('Unexpected OAuth URL');
  });
  assert.match((await message({ type: 'github-device-start', clientId: 'Ov23liExampleClient' })).error,
    /Only extension options/);
  const started = await message({ type: 'github-device-start', clientId: 'Ov23liExampleClient' }, options);
  assert.equal(started.result.state, 'pending');
  assert.equal(started.result.userCode, 'ABCD-EFGH');
  assert.equal(JSON.stringify(started.result).includes('d'.repeat(40)), false, 'device code is not disclosed');
  assert.equal(JSON.stringify([...sessionStore]).includes('d'.repeat(40)), false, 'device secret stays only in background memory');
  assert.equal(urls[0].url, 'https://github.com/login/device/code');
  assert.equal(new URLSearchParams(urls[0].init.body).get('scope'), 'public_repo');
  assert.equal((await message({ type: 'github-device-poll' }, options)).result.state, 'pending');
  assert.equal(urls.length, 1, 'worker enforces initial minimum interval');
  const pending = sessionStore.get('github-device-pending');
  pending.nextPollAt = Date.now() - 1;
  assert.equal((await message({ type: 'github-device-poll' }, options)).result.state, 'pending');
  assert.equal(urls.length, 2);
  assert.equal(new URLSearchParams(urls[1].init.body).get('grant_type'),
    'urn:ietf:params:oauth:grant-type:device_code');
  pollResponse = { error: 'slow_down', interval: 10 };
  pending.nextPollAt = Date.now() - 1;
  const slowed = await message({ type: 'github-device-poll' }, options);
  assert.equal(slowed.result.intervalSeconds, 10);
  assert.ok(slowed.result.retryAfterMs >= 9000);
  pollResponse = { access_token: token, token_type: 'bearer', scope: 'public_repo', expires_in: 28800 };
  pending.nextPollAt = Date.now() - 1;
  const connected = await message({ type: 'github-device-poll' }, options);
  assert.deepEqual(connected.result, { state: 'connected' });
  assert.equal(typeof sessionStore.get('github-review-token'), 'object');
  assert.equal(JSON.stringify(sessionStore.get('github-review-token')).includes(token), false);
  assert.equal(sessionStore.has('github-device-pending'), false);
  assert.equal(JSON.stringify(connected).includes(token), false, 'token never returns to options');
  assert.equal((await message({ type: 'github-device-status' }, options)).result.clientId,
    'Ov23liExampleClient');
  sessionStore.get('github-review-token').expiresAt = Date.now() - 1;
  assert.equal((await message({ type: 'github-auth-status' }, options)).result.configured, false);
  assert.equal(sessionStore.has('github-review-token'), false);
});

test('device sign-in cancellation and expiry cannot deposit a late token', async (t) => {
  localStore.clear(); sessionStore.clear();
  let release;
  withFetch(t, async (url) => {
    if (url.endsWith('/login/device/code')) return json({ device_code: 'e'.repeat(40),
      user_code: 'TEST-CODE', verification_uri: 'https://github.com/login/device',
      expires_in: 900, interval: 5 });
    return new Promise((resolve) => { release = resolve; });
  });
  await message({ type: 'github-device-start', clientId: 'Ov23liExampleClient' }, options);
  sessionStore.get('github-device-pending').nextPollAt = Date.now() - 1;
  const inFlight = message({ type: 'github-device-poll' }, options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await message({ type: 'github-device-cancel' }, options)).result.state, 'cancelled');
  release(json({ access_token: 'gho_' + 'x'.repeat(40), token_type: 'bearer', scope: 'public_repo' }));
  assert.equal((await inFlight).result.state, 'cancelled');
  assert.equal(sessionStore.has('github-review-token'), false);
  await message({ type: 'github-device-start', clientId: 'Ov23liExampleClient' }, options);
  sessionStore.get('github-device-pending').expiresAt = Date.now() - 1;
  assert.equal((await message({ type: 'github-device-status' }, options)).result.expired, true);
  assert.equal(sessionStore.has('github-device-pending'), false);
});

test('device sign-in handles denial and rejects missing scope without exposing OAuth payload', async (t) => {
  localStore.clear(); sessionStore.clear();
  let poll = { error: 'access_denied' };
  withFetch(t, async (url) => url.endsWith('/login/device/code') ?
    json({ device_code: 'f'.repeat(40), user_code: 'TEST-CODE',
      verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }) : json(poll));
  await message({ type: 'github-device-start', clientId: 'Ov23liExampleClient' }, options);
  sessionStore.get('github-device-pending').nextPollAt = Date.now() - 1;
  assert.equal((await message({ type: 'github-device-poll' }, options)).result.state, 'denied');
  assert.equal(sessionStore.has('github-device-pending'), false);
  await message({ type: 'github-device-start', clientId: 'Ov23liExampleClient' }, options);
  sessionStore.get('github-device-pending').nextPollAt = Date.now() - 1;
  poll = { access_token: 'gho_' + 'y'.repeat(40), token_type: 'bearer', scope: '' };
  assert.match((await message({ type: 'github-device-poll' }, options)).error, /public repository access/);
  assert.equal(sessionStore.has('github-review-token'), false);
});

test('explicit issue publication uses a fixed API origin and returns a Git sidecar reference', async (t) => {
  localStore.clear(); sessionStore.clear();
  await message({ type: 'github-auth-set', token: 'github_pat_' + 'a'.repeat(60) }, options);
  const seen = [];
  withPublishingFetch(t, async (url, init) => {
    seen.push({ url, init });
    return json({ number: 17, node_id: 'I_kw123' });
  });
  const note = sampleComment();
  const request = { type: 'github-publish-comment', comment: note, destination: 'new-issue',
    repository: 'base/board' };
  assert.match((await message(request, githubTab(6, '/owner/board/issues/1'))).error, /Only extension viewers/);
  assert.match((await message(request, options)).error, /Only extension viewers/);
  const result = await message(request);
  assert.equal(result.ok, true);
  assert.deepEqual({ kind: result.result.remoteRef.kind, repository: result.result.remoteRef.repository,
    number: result.result.remoteRef.number, url: result.result.remoteRef.url },
    { kind: 'issue', repository: 'base/board', number: 17, url: 'https://github.com/base/board/issues/17' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.github.com/repos/base/board/issues');
  assert.equal(seen[0].init.method, 'POST');
  assert.match(JSON.parse(seen[0].init.body).body, /<!-- kicad-review:v1 /);
  assert.equal((await message(request)).result.duplicate, true);
  assert.equal(seen.length, 1, 'same note does not publish twice');
  assert.match((await message({ ...request, repository: '../evil' })).error, /Invalid target/);
  assert.equal(seen.length, 1);
});

test('GitHub auth failures are sanitized and definitive failures can be corrected', async (t) => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  localStore.clear(); sessionStore.clear();
  const token = 'github_pat_' + 'd'.repeat(60);
  await message({ type: 'github-auth-set', token }, options);
  let count = 0;
  withPublishingFetch(t, async () => { count++; return new Response(`bad token: ${token}`, { status: 403 }); });
  const request = { type: 'github-publish-comment', comment: sampleComment(), destination: 'new-issue' };
  const first = await message(request); clock += 3000; const second = await message(request);
  assert.match(first.error, /denied access/);
  assert.equal(JSON.stringify(first).includes(token), false);
  assert.match(second.error, /denied access/);
  assert.equal(count, 2, 'definitive rejection clears pending state for corrected credentials');
});

test('uncertain issue response stays pending and prevents a retry', async (t) => {
  localStore.clear(); sessionStore.clear();
  await message({ type: 'github-auth-set', token: 'github_pat_' + 'b'.repeat(60) }, options);
  let count = 0;
  withPublishingFetch(t, async () => { count++; throw new Error('socket closed'); });
  const request = { type: 'github-publish-comment', comment: sampleComment(), destination: 'issue',
    repository: 'owner/board', number: 9 };
  assert.match((await message(request)).error, /may have succeeded/);
  assert.match((await message(request)).error, /unconfirmed outcome/);
  assert.equal(count, 1);
});

test('existing issue publication stores the exact comment link', async (t) => {
  localStore.clear(); sessionStore.clear();
  await message({ type: 'github-auth-set', token: 'github_pat_' + 'e'.repeat(60) }, options);
  withPublishingFetch(t, async (url) => {
    assert.equal(url, 'https://api.github.com/repos/owner/board/issues/9/comments');
    return json({ id: 456, node_id: 'IC_456' });
  });
  const result = await message({ type: 'github-publish-comment', destination: 'issue',
    repository: 'owner/board', number: 9, comment: sampleComment() });
  assert.equal(result.result.remoteRef.url, 'https://github.com/owner/board/issues/9#issuecomment-456');
  assert.deepEqual(global.KiCadReviewComments.validateComment({ ...sampleComment(),
    remoteRefs: [result.result.remoteRef] }).remoteRefs, [result.result.remoteRef]);
});

test('discussion categories and both discussion publication operations use GraphQL', async (t) => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  localStore.clear(); sessionStore.clear();
  await message({ type: 'github-auth-set', token: 'github_pat_' + 'c'.repeat(60) }, options);
  const queries = [];
  withPublishingFetch(t, async (url, init) => {
    assert.equal(url, 'https://api.github.com/graphql');
    const payload = JSON.parse(init.body); queries.push(payload);
    if (payload.query.includes('discussionCategories')) return json({ data: { repository: {
      id: 'R_123', discussionCategories: { nodes: [{ id: 'DC_123', name: 'Ideas', slug: 'ideas' }] }
    } } });
    if (payload.query.includes('createDiscussion')) return json({ data: { createDiscussion: {
      discussion: { id: 'D_123', number: 7 }
    } } });
    if (payload.query.includes('discussion(number:')) return json({ data: { repository: {
      discussion: { id: 'D_123', number: 7 }
    } } });
    if (payload.query.includes('addDiscussionComment')) return json({ data: { addDiscussionComment: {
      comment: { id: 'DCOM_123' }
    } } });
    throw new Error('Unexpected query');
  });
  const categories = await message({ type: 'github-discussion-categories', repository: 'owner/board' });
  assert.equal(categories.result[0].id, 'DC_123');
  assert.match((await message({ type: 'github-discussion-categories', repository: 'owner/board' },
    githubTab(8, '/owner/board'))).error, /Only extension viewers/);
  const note = sampleComment();
  const created = await message({ type: 'github-publish-comment', destination: 'new-discussion',
    repository: 'owner/board', categoryId: 'DC_123', comment: note });
  assert.equal(created.result.remoteRef.url, 'https://github.com/owner/board/discussions/7');
  clock += 3000;
  const replied = await message({ type: 'github-publish-comment', destination: 'discussion',
    repository: 'owner/board', number: 7, comment: note });
  assert.equal(replied.result.remoteRef.nodeId, 'DCOM_123');
  assert.equal(queries.filter((item) => item.query.includes('createDiscussion')).length, 1);
  assert.equal(queries.filter((item) => item.query.includes('addDiscussionComment')).length, 1);
});

test('3D model retrieval stays on the same GitHub revision and rejects unsafe paths', async (t) => {
  const fixture=withWebsite(t,'owner/board',{'models/part.glb':new Uint8Array([0x67,0x6c,0x54,0x46])});const urls=fixture.raw;
  const request = { type: 'repo-asset', repository: 'owner/board', ref: 'a'.repeat(40),
    file: 'models/part.glb' };
  assert.match((await message(request, githubTab(2, '/owner/board'))).error, /Only extension viewers/);
  const result = await message(request);
  assert.equal(result.result.base64, 'Z2xURg==');
  assert.equal(result.result.mediaType, 'model/gltf-binary');
  assert.equal(urls[0].url, `https://github.com/owner/board/raw/${'a'.repeat(40)}/models/part.glb`);
  assert.equal(urls[0].init.headers?.Authorization, undefined);
  for (const file of ['../escape.glb', '/absolute.wrl', 'models/evil.obj', 'models/../part.wrl',
    'models\\part.glb', 'https://evil.test/model.glb']) {
    assert.match((await message({ ...request, file })).error, /Invalid repository.*path/i);
  }
  assert.equal(urls.length, 1);
});

test('3D model retrieval accepts bounded private session assets and rejects oversized raw payloads',async t=>{
 const fixture=withWebsite(t,'owner/models',{'models/part.wrl':'VRML'},{private:true,sha:sha('b')});const request={type:'repo-asset',repository:'owner/models',ref:sha('b'),file:'models/part.wrl'};const result=await message(request);assert.equal(result.ok,true,result.error);assert.equal(result.result.base64,btoa('VRML'));assert.ok(fixture.session.some(r=>r.action==='asset'));fixture.files.set('models/too-big.glb',new Uint8Array(8*1024*1024+1));assert.match((await message({...request,file:'models/too-big.glb'})).error,/byte limit|size limit/);
});

test('drawing pairing lists only same-directory KiCad files and opens a validated extension popup', async (t) => {
  const fixture=withWebsite(t,'owner/board',{'boards/main.kicad_sch':'(kicad_sch)','boards/main.kicad_pcb':'(kicad_pcb)','boards/notes.txt':'note','other/forged.kicad_pcb':'(kicad_pcb)'});
  const request = { type: 'drawing-files', repository: 'owner/board', ref: 'a'.repeat(40),
    file: 'boards/main.kicad_sch' };
  assert.match((await message(request, githubTab(2, '/owner/board'))).error, /Only extension viewers/);
  const listed = await message(request);
  assert.deepEqual(listed.result.files, ['boards/main.kicad_pcb', 'boards/main.kicad_sch']);
  assert.equal(fixture.raw.length,0);assert.ok(fixture.session.every(r=>r.ref===sha('a')));
  calls.windows.length = 0;
  const opened = await message({ type: 'open-viewer-window', repository: 'owner/board',
    ref: 'a'.repeat(40), file: 'boards/main.kicad_sch', pairedFile: 'boards/main.kicad_pcb' });
  assert.equal(opened.result.windowId, 41);
  const popup = new URL(calls.windows[0].url);
  assert.equal(popup.protocol, 'chrome-extension:');
  assert.equal(popup.host, 'test-id');
  assert.equal(popup.pathname, '/browser-viewer.html');
  assert.equal(popup.searchParams.get('head'), 'a'.repeat(40));
  assert.equal(popup.searchParams.get('pairedFile'), 'boards/main.kicad_pcb');
  assert.equal(calls.windows[0].type, 'popup');
  assert.equal(calls.windows[0].state, 'maximized');
  assert.equal(calls.windows[0].width, undefined);
  assert.match((await message({ type: 'open-viewer-window', repository: 'owner/board',
    ref: 'main', file: 'boards/main.kicad_sch', pairedFile: '../bad.kicad_pcb' })).error, /Paired drawing/);
  assert.match((await message({ type: 'open-viewer-window', repository: 'owner/board',
    ref: 'main', file: 'boards/main.kicad_sch', pairedFile: 'boards/other.kicad_sch' })).error, /opposite/);
  assert.equal(calls.windows.length, 1);
});

test('repository policy defaults to all but publishing still needs a token', async (t) => {
  sessionStore.clear(); localStore.clear();
  const urls = [];
  withFetch(t, async (url) => {
    urls.push(url);
    if (url === 'https://api.github.com/repos/owner/board') return json({
      private: false, full_name: 'owner/board', default_branch: 'main' });
    if (url.includes('/contents/.kicad-review-policy.json?')) return new Response(null, { status: 404 });
    throw new Error('Unexpected policy URL');
  });
  const reply = await message({ type: 'comment-policy-status', repository: 'owner/board' });
  assert.deepEqual({ mode: reply.result.mode, source: reply.result.source, allowed: reply.result.allowed,
    ref: reply.result.ref }, { mode: 'all', source: 'default', allowed: false, ref: 'main' });
  assert.match(reply.result.reason, /Connect GitHub/);
  assert.equal(urls.length, 2);
  assert.match((await message({ type: 'comment-policy-status', repository: 'owner/board' },
    githubTab(3, '/owner/board'))).error, /Only extension viewers/);
});

test('allowlist policy is read from target default branch and blocks a fork note before POST', async (t) => {
  sessionStore.clear(); localStore.clear();
  await message({ type: 'github-auth-set', token: 'github_pat_' + 'p'.repeat(60) }, options);
  const urls = [];
  let login = 'outsider';
  withFetch(t, async (url, init) => {
    urls.push({ url, method: init?.method || 'GET', authorization: init?.headers?.Authorization });
    if (url === 'https://api.github.com/repos/base/board') return json({
      private: false, full_name: 'base/board', default_branch: 'main' });
    if (url.includes('/contents/.kicad-review-policy.json?')) return json({
      schemaVersion: 1, commenting: { mode: 'allowlist', allowlist: ['Reviewer'] }
    });
    if (url === 'https://api.github.com/user') return json({ login });
    if (url === 'https://api.github.com/repos/base/board/issues') return json({ number: 19 });
    throw new Error('Unexpected policy URL');
  });
  const note = sampleComment(); note.anchor.repository = 'fork/board';
  const status = await message({ type: 'comment-policy-status', repository: 'base/board',
    ref: note.anchor.ref });
  assert.equal(status.result.allowed, false);
  const denied = await message({ type: 'github-publish-comment', destination: 'new-issue',
    repository: 'base/board', comment: note });
  assert.match(denied.error, /policy blocked publication/);
  assert.equal(urls.some((entry) => entry.method === 'POST'), false);
  assert.ok(urls.some((entry) => entry.url.endsWith('/contents/.kicad-review-policy.json?ref=main')),
    'fork note SHA cannot select a weaker policy revision');
  assert.equal(urls.find((entry) => entry.url.includes('/contents/.kicad-review-policy.json?')).authorization,
    undefined, 'public policy read does not depend on token Contents permission');
  login = 'Reviewer';
  const allowed = await message({ type: 'github-publish-comment', destination: 'new-issue',
    repository: 'base/board', comment: note });
  assert.equal(allowed.result.remoteRef.url, 'https://github.com/base/board/issues/19');
  assert.equal(urls.filter((entry) => entry.method === 'POST').length, 1);
});

test('owner always passes restricted policy and contributor scan paginates with a hard cap', async (t) => {
  sessionStore.clear();
  await message({ type: 'github-auth-set', token: 'github_pat_' + 'q'.repeat(60) }, options);
  let login = 'owner', pages = 0, include = true;
  withFetch(t, async (url) => {
    if (url === 'https://api.github.com/repos/owner/board') return json({
      private: false, full_name: 'owner/board', default_branch: 'main' });
    if (url.includes('/contents/.kicad-review-policy.json?')) return json({
      schemaVersion: 1, commenting: { mode: 'contributors' } });
    if (url === 'https://api.github.com/user') return json({ login });
    if (url.includes('/contributors?')) {
      pages++;
      const page = Number(new URL(url).searchParams.get('page'));
      return json(Array.from({ length: 100 }, (_, index) => ({
        login: include && page === 2 && index === 10 ? 'reviewer' : `user${page}-${index}`
      })));
    }
    throw new Error('Unexpected policy URL');
  });
  assert.equal((await message({ type: 'comment-policy-status', repository: 'owner/board' })).result.allowed, true);
  assert.equal(pages, 0, 'personal repository owner bypasses contributor enumeration');
  login = 'reviewer';
  assert.equal((await message({ type: 'comment-policy-status', repository: 'owner/board' })).result.allowed, true);
  assert.equal(pages, 2);
  pages = 0; include = false;
  const capped = await message({ type: 'comment-policy-status', repository: 'owner/board' });
  assert.equal(capped.result.allowed, false);
  assert.match(capped.result.reason, /1,000-account scan limit/);
  assert.equal(pages, 10);
});

test('collaborator and malformed-policy verification fail closed', async (t) => {
  sessionStore.clear(); localStore.clear();
  await message({ type: 'github-auth-set', token: 'github_pat_' + 'r'.repeat(60) }, options);
  let mode = 'collaborators', permission = 'write', failed = false;
  withFetch(t, async (url) => {
    if (url === 'https://api.github.com/repos/owner/board') return failed ?
      new Response(null, { status: 403 }) : json({ private: false, full_name: 'owner/board', default_branch: 'main' });
    if (url.includes('/contents/.kicad-review-policy.json?')) return json({
      schemaVersion: 1, commenting: { mode } });
    if (url === 'https://api.github.com/user') return json({ login: 'reviewer' });
    if (url.includes('/collaborators/reviewer/permission')) return permission === 'missing' ?
      new Response(null, { status: 404 }) : json({ permission });
    throw new Error('Unexpected policy URL');
  });
  assert.equal((await message({ type: 'comment-policy-status', repository: 'owner/board' })).result.allowed, true);
  permission = 'missing';
  assert.equal((await message({ type: 'comment-policy-status', repository: 'owner/board' })).result.allowed, false);
  mode = 'invalid';
  assert.match((await message({ type: 'comment-policy-status', repository: 'owner/board' })).error, /malformed/);
  mode = 'collaborators'; failed = true;
  assert.match((await message({ type: 'comment-policy-status', repository: 'owner/board' })).error, /could not verify/);
});

test('restricted contributor policy can explicitly invite an outside reviewer',async(t)=>{
 sessionStore.clear();localStore.clear();
 await message({type:'github-auth-set',token:'github_pat_'+'s'.repeat(60)},options);
 withFetch(t,async(url)=>{
  if(url==='https://api.github.com/repos/owner/board')return json({private:false,full_name:'owner/board',default_branch:'main'});
  if(url.includes('/contents/.kicad-review-policy.json?'))return json({schemaVersion:1,commenting:{mode:'contributors',allowlist:['guest-reviewer']}});
  if(url==='https://api.github.com/user')return json({login:'Guest-Reviewer'});
  throw new Error('Invited reviewer should not require contributor enumeration');
 });
 const reply=await message({type:'comment-policy-status',repository:'owner/board'});
 assert.equal(reply.result.allowed,true);assert.match(reply.result.reason,/allowlist/);
});


test('revision listings validate exact viewer senders, paths and repository before network',async(t)=>{
 const urls=[];withFetch(t,async url=>{urls.push(url);return json([]);});
 for(const type of ['revision-branches','revision-commits','revision-resolve']){
  const args={type,repository:'owner/board',ref:'main',file:'board.kicad_pcb'};
  for(const sender of [githubTab(9,'/owner/board'),options,{id:'test-id',url:extensionOrigin+'browser-viewer.html/evil'}])assert.notEqual((await message(args,sender)).ok,true);
  for(const changes of [{repository:'../board'},{file:'../board.kicad_pcb'},{file:'x:board.kicad_pcb'},{ref:'main\n'}])assert.equal((await message({...args,...changes})).ok,false);
 }
 assert.equal(urls.length,0);
});
test('file commit browsing reads actual website feed metadata without GitHub API',async t=>{
 const fixture=withWebsite(t,'fork/board',{'board.kicad_pcb':'(kicad_pcb)'});const reply=await message({type:'revision-commits',repository:'fork/board',ref:'feature/pcb',file:'board.kicad_pcb'});assert.equal(reply.ok,true,reply.error);assert.equal(reply.result.ref,'feature/pcb');assert.deepEqual(reply.result.commits.map(c=>c.sha),[sha('a')]);assert.match(reply.result.warnings.join(' '),/website feed/);assert.equal(fixture.raw.length,2);
 assert.equal(reply.result.commits[0].parentsKnown,true);assert.deepEqual(reply.result.commits[0].parents,[]);
});
test('branch browsing reads website names without token or API requests',async t=>{
 const fixture=withWebsite(t,'owner/board',{'board.kicad_pcb':'(kicad_pcb)'});const reply=await message({type:'revision-branches',repository:'owner/board',ref:'main',file:'board.kicad_pcb'});assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.branches,[{name:'main',isDefault:true}]);assert.match(reply.result.warnings.join(' '),/branch window/);assert.equal(fixture.raw.length,1);assert.ok(fixture.session.every(r=>!r.token&&!r.Authorization));
});
test('revision endpoints reject malformed website snapshot identities',async t=>{
 withWebsite(t,'owner/board',{}, {readSession:async()=>({ok:true,result:{sha:'invalid',items:[]}}),sha:'invalid'});for(const type of ['revision-resolve','revision-commits']){const reply=await message({type,repository:'owner/board',ref:'main',file:'board.kicad_pcb'});assert.equal(reply.ok,false);assert.match(reply.error,/session|snapshot|valid commits|website history/i);}
});
test('project inventory and raw JSON settings use safe immutable repository paths and exact viewers',async t=>{
 const fixture=withWebsite(t,'owner/board',{'design/board.kicad_pcb':'(kicad_pcb)','design/board.kicad_pro':'{"net_settings":{}}'});const request={repository:'owner/board',ref:'main',file:'design/board.kicad_pcb'};const inventory=await message({...request,type:'project-inventory'});assert.equal(inventory.ok,true,inventory.error);assert.equal(inventory.result.snapshotRef,sha('a'));const settings=await message({...request,type:'project-file',ref:sha('a'),file:'design/board.kicad_pro'});assert.equal(settings.ok,true,settings.error);assert.match(settings.result.content,/net_settings/);for(const sender of [options,githubTab(1,'/owner/board')])assert.equal((await message({...request,type:'project-inventory'},sender)).ok,false);assert.equal((await message({...request,type:'project-file',file:'../escape.kicad_pro'})).ok,false);assert.equal(fixture.raw.length,1);
});


test('large PCB uses bounded raw Contents media and excludes credentials and redirects', async t => {
  sessionStore.clear();
  const board = '(kicad_pcb ' + ' '.repeat(9 * 1024 * 1024) + ')';
  withFetch(t, async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/owner/board/contents/design/large.kicad_pcb?ref=main');
    assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(board, {headers: {'content-type': 'application/vnd.github.raw+json'}});
  });
  assert.equal(await background.githubFile('owner/board', 'main', 'design/large.kicad_pcb'), board);
});

test('PCB raw byte cap rejects oversized headers; schematics retain their smaller stream cap', async t => {
  withFetch(t, async () => new Response('tiny', {headers: {'content-length': String(64 * 1024 * 1024 + 1)}}));
  await assert.rejects(background.githubFile('owner/board', 'main', 'large.kicad_pcb'), /size limit/);
  global.fetch = async () => new Response('x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(background.githubFile('owner/board', 'main', 'large.kicad_sch'), /size limit/);
  let calls = 0; global.fetch = async () => {calls++; return new Response('');};
  await assert.rejects(background.githubFile('owner/board', 'main', '../large.kicad_pcb'), /Invalid/);
  assert.equal(calls, 0);
});


test('drawing and project reads use the configured account only on the exact GitHub API host', async t => {
  sessionStore.clear(); const token='test-credential-'.repeat(3);await KiCadGitHubReviewApi.setToken(token);t.after(()=>sessionStore.clear());
  withFetch(t,async (url,init)=>{assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(init.headers.Authorization,`Bearer ${token}`);assert.equal(init.redirect,'error');if(url.includes('/contents/'))return new Response('(kicad_pcb)');assert.equal(init.headers.Accept,'application/vnd.github.sha');return new Response(sha('a'));});
  assert.equal(await background.githubFile('wayri/board','main','board.kicad_pcb'),'(kicad_pcb)');
  assert.equal((await background.revisionResolve('wayri/board','main','board.kicad_pcb')).sha,sha('a'));
});
test('rate-limited API file reads recover through anonymous bounded raw content without leaking a token',async t=>{
  sessionStore.clear();await KiCadGitHubReviewApi.setToken('test-credential-'.repeat(3));t.after(()=>sessionStore.clear());const calls=[];
  withFetch(t,async(url,init)=>{calls.push(url);if(url.startsWith('https://api.github.com/'))return new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0'}});assert.equal(url,'https://raw.githubusercontent.com/wayri/board/feature%2Ftest/folder/board.kicad_pcb');assert.equal(init.headers,undefined);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return new Response('(kicad_pcb)');});
  assert.equal(await background.githubFile('wayri/board','feature/test','folder/board.kicad_pcb'),'(kicad_pcb)');assert.equal(calls.length,2);
});
test('denied access is not treated as a rate limit and credential errors are sanitized',async t=>{
  sessionStore.clear();let calls=0;withFetch(t,async()=>{calls++;return new Response('SECRET',{status:403});});
  await assert.rejects(background.githubFile('wayri/board','main','board.kicad_pcb'),/denied.*permissions/);assert.equal(calls,1);
  global.fetch=async()=>new Response('SECRET',{status:401});await assert.rejects(background.githubFile('wayri/board','main','board.kicad_pcb'),/authentication failed/);
});
test('failed raw fallback retains the rate limit reset guidance without retrying API requests',async t=>{
  sessionStore.clear();let calls=0;withFetch(t,async()=>++calls===1?new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'2000000000'}}):new Response(null,{status:404}));
  await assert.rejects(background.githubFile('wayri/board','main','board.kicad_pcb'),/rate limit reached.*2033.*Connect your GitHub account/);assert.equal(calls,2);
});


test('private Contents and linked 3D assets use the configured token only on the fixed API origin', async t => {
  const token = 'private-test-token-1234567890';
  await KiCadGitHubReviewApi.setToken(token);
  sessionStore.delete('github-review-token-expiry');
  t.after(()=>sessionStore.delete('github-review-token'));
  const seen = [];
  withFetch(t,async (url,options)=>{
    seen.push(url);
    assert.ok(url.startsWith('https://api.github.com/repos/owner/private/contents/'));
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return new Response(url.includes('packages3D') ? 'solid test' : '(kicad_pcb)');
  });
  assert.equal(await background.githubFile('owner/private',sha('d'),'Hardware/HPBM-SMALL.kicad_pcb'),'(kicad_pcb)');
  const model = await background.githubAsset('owner/private',sha('d'),'Hardware/packages3D/test.wrl');
  assert.ok(model);assert.equal(seen.length,2);
});

test('missing private source stays on its pinned website session and fails without credential exposure',async t=>{
 const fixture=withWebsite(t,'owner/private',{}, {private:true});const reply=await message({type:'project-file',repository:'owner/private',ref:sha('a'),file:'Hardware/board.kicad_pcb'});assert.equal(reply.ok,false);assert.match(reply.error,/unavailable|sign|access/i);assert.equal(fixture.raw.length,1);assert.ok(fixture.session.every(m=>m.ref===sha('a')));
});

test('publication recovery is restricted to the isolated viewer surface',async()=>{
 const input={type:'github-recover-publication',comment:sampleComment(),destination:'new-issue',recoveryNumber:1};
 for(const sender of [options,githubTab(6,'/owner/board/issues/1')])assert.match((await message(input,sender)).error,/Only extension viewers/);
});


test('ordinary GitHub thread readback is restricted to extension viewers',async(t)=>{
 let called=0;const before=KiCadGitHubReviewApi.readThread;KiCadGitHubReviewApi.readThread=async request=>{called++;return{kind:request.kind,number:request.number,comments:[]};};t.after(()=>{KiCadGitHubReviewApi.readThread=before;});
 const request={type:'github-thread-read',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',kind:'issue',number:42};
 for(const sender of [options,githubTab(1,'/owner/repo/blob/main/board.kicad_pcb'),{id:'other',url:viewer.url}]){const result=await message(request,sender);assert.notEqual(result.ok,true);}
 assert.equal(called,0);const result=await message(request);assert.equal(result.ok,true);assert.equal(result.result.number,42);assert.equal(called,1);
});

test('chat publication is restricted to exact extension viewers and reactions fail explicitly',async(t)=>{
 let called=0;const before=KiCadGitHubReviewApi.chatMessageWrite;KiCadGitHubReviewApi.chatMessageWrite=async()=>{called++;return{messageId:'12'};};t.after(()=>{KiCadGitHubReviewApi.chatMessageWrite=before;});
 const request={type:'chat-message-write',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',thread:{kind:'issue',number:42},action:'create',body:'Hello',clientMutationId:'mutation_0123456789'};
 for(const sender of [options,githubTab(1,'/owner/repo/blob/main/board.kicad_pcb'),{id:'other',url:viewer.url}])assert.notEqual((await message(request,sender)).ok,true);
 assert.equal(called,0);assert.equal((await message(request)).ok,true);assert.equal(called,1);assert.match((await message({...request,type:'chat-reaction'})).error,/not supported/);
});

test('chat discovery is restricted to exact extension viewers',async(t)=>{
 let called=0;const before=KiCadGitHubReviewApi.chatThreadList;KiCadGitHubReviewApi.chatThreadList=async()=>{called++;return{threads:[],hasMore:false};};t.after(()=>{KiCadGitHubReviewApi.chatThreadList=before;});
 const request={type:'chat-thread-list',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',kind:'issue'};
 for(const sender of [options,githubTab(1,'/owner/repo/blob/main/board.kicad_pcb'),{id:'other',url:viewer.url}])assert.notEqual((await message(request,sender)).ok,true);
 assert.equal(called,0);assert.equal((await message(request)).ok,true);assert.equal(called,1);
});

test('trusted project viewer resolves project settings branches while rejecting unsafe paths',async t=>{
 const fixture=withWebsite(t,'owner/board',{'design/board.kicad_pro':'{}'});const args={type:'revision-resolve',repository:'owner/board',ref:'main',file:'design/board.kicad_pro'};const reply=await message(args);assert.equal(reply.ok,true,reply.error);assert.equal(reply.result.sha,sha('a'));assert.equal((await message({...args,file:'../board.kicad_pro'})).ok,false);assert.equal(fixture.raw.length,0);assert.equal(fixture.session.length,1);
});


test('trusted analysis page is read-only and only accepts exact extension sender identity',async t=>{
 const sender={id:'test-id',url:extensionOrigin+'analysis-viewer.html?repository=owner/board&ref='+sha('a')+'&file=analysis.csv'};
 assert.equal(background.analysisSender(sender),true);assert.equal(background.viewerSender(sender),false);
 assert.equal(background.analysisSender({...sender,url:extensionOrigin+'analysis-viewer.html.evil'}),false);assert.equal(background.analysisSender({...sender,id:'other'}),false);
 const fixture=withWebsite(t,'owner/board',{'analysis.csv':'time,V\n0,1'});const reads=fixture.raw;
 const read=await message({type:'project-file',repository:'owner/board',ref:sha('a'),file:'analysis.csv'},sender);assert.equal(read.ok,true,read.error);assert.equal(read.result.content,'time,V\n0,1');assert.ok(reads.every(({url})=>url.startsWith('https://github.com/owner/board/raw/'+sha('a')+'/')));
 for(const type of ['comment-save','comment-delete','github-publish-comment','github-auth-set','open-viewer-window','project']){const response=await message({type,repository:'owner/board',ref:sha('a'),file:'analysis.csv'},sender);assert.equal(response.ok,false);assert.match(response.error,/only read/);}
 assert.equal((await message({type:'project-file',repository:'owner/board',ref:sha('a'),file:'../analysis.csv'},sender)).ok,false);
});

test('PDF page reads bounded binary on the pinned repository revision and cannot write reviews',async t=>{
 const fixture=withWebsite(t,'owner/pdfboard',{'reports/board.pdf':new Uint8Array([37,80,68,70,45,49,46,55,10,0,255])},{sha:'c'.repeat(40)});const calls=fixture.raw;
 const sender={id:'test-id',url:extensionOrigin+'pdf-viewer.html?file=reports/board.pdf'},request={type:'pdf-file',repository:'owner/pdfboard',ref:'c'.repeat(40),file:'reports/board.pdf'};
 const reply=await message(request,sender);assert.equal(reply.ok,true);assert.equal(reply.result.mediaType,'application/pdf');assert.deepEqual(Array.from(Buffer.from(reply.result.base64,'base64')),[37,80,68,70,45,49,46,55,10,0,255]);assert.equal(calls[0].url,'https://github.com/owner/pdfboard/raw/'+'c'.repeat(40)+'/reports/board.pdf');
 assert.equal((await message({...request,type:'comment-save'},sender)).ok,false);assert.equal((await message({...request,file:'../board.pdf'},sender)).ok,false);assert.equal((await message({...request,type:'repo-asset'},sender)).ok,false);assert.equal(calls.length,1);
});

test('private schematic projects open through the existing repository tab without an API token',async t=>{
 const previousQuery=chrome.tabs.query,previousSend=chrome.tabs.sendMessage,seen=[];
 chrome.tabs.query=async()=>[{id:51,url:'https://github.com/owner/private/blob/main/design/root.kicad_sch'}];
 chrome.tabs.sendMessage=async(id,request,options)=>{
  assert.equal(id,51);assert.equal(options.frameId,0);seen.push(request);assert.equal(request.type,'github-session-read');
  if(request.action==='resolve')return {ok:true,result:{sha:sha('a'),items:[]}};
  assert.equal(request.ref,sha('a'));
  if(request.action==='directory')return {ok:true,result:{sha:sha('a'),items:request.path==='design'?[{path:'design/root.kicad_sch',type:'file'}]:[]}};
  return {ok:true,result:{sha:sha('a'),content:request.path==='design/root.kicad_sch'?'(kicad_sch (sheet (property "Sheetfile" "../shared/leaf.kicad_sch")))':'(kicad_sch)'}};
 };
 t.after(()=>{chrome.tabs.query=previousQuery;chrome.tabs.sendMessage=previousSend;});
 withFetch(t,async()=>new Response(null,{status:404}));
 const result=await message({type:'project',repository:'owner/private',ref:'main',file:'design/root.kicad_sch'});
 assert.equal(result.ok,true,result.error);assert.deepEqual(result.result.map(f=>f.path),['design/root.kicad_sch','shared/leaf.kicad_sch']);
 assert.ok(seen.some(r=>r.action==='file'&&r.path==='shared/leaf.kicad_sch'));assert.ok(seen.every(r=>!r.token&&!r.cookie&&!r.url));
});

test('website session fallback rejects tabs belonging to a different repository',async t=>{
 const previous=chrome.tabs.query;chrome.tabs.query=async()=>[{id:9,url:'https://github.com/owner/private-evil/blob/main/file.kicad_pcb'}];t.after(()=>{chrome.tabs.query=previous;});
 withFetch(t,async()=>new Response(null,{status:404}));
 const before=calls.messages.length,result=await message({type:'project',repository:'owner/private',ref:sha('a'),file:'file.kicad_pcb'});
 assert.equal(result.ok,false);assert.equal(calls.messages.length,before);
});


test('model discovery is viewer-only, immutable, bounded and excludes links and non-models',async t=>{
 const fixture=withWebsite(t,'owner/board',{'models/Package.3dshapes/body.step':'STEP','board.kicad_pcb':'(kicad_pcb)'},{entries:d=>d===''?[{path:'models',type:'directory'},{path:'linked.wrl',type:'symlink'},{path:'board.kicad_pcb',type:'file'}]:d==='models'?[{path:'models/Package.3dshapes',type:'directory'}]:[{path:'models/Package.3dshapes/body.step',type:'file'}]});const request={type:'repo-model-index',repository:'owner/board',ref:sha('a')};assert.equal((await message(request,githubTab(2,'/owner/board'))).ok,false);assert.equal((await message({...request,ref:'main'})).ok,false);const reply=await message(request);assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.paths,['models/Package.3dshapes/body.step']);assert.equal(reply.result.snapshotRef,sha('a'));assert.equal(fixture.raw.length,0);
});


test('private model inventory reuses the bounded website-session tree at the exact opened commit',async t=>{
 const fixture=withWebsite(t,'owner/private',{'models/body.step':'STEP','board.kicad_pcb':'(kicad_pcb)'},{private:true});const request={type:'repo-model-index',repository:'owner/private',ref:sha('a')};const first=await message(request),second=await message(request);assert.equal(first.ok,true,first.error);assert.deepEqual(first.result.paths,['models/body.step']);assert.deepEqual(second.result,first.result);assert.equal(fixture.raw.length,0);assert.ok(fixture.session.every(m=>m.ref===sha('a')));
});

test('repository website tree retains folders and non-followed links without inventing blob SHAs',async t=>{
 const fixture=withWebsite(t,'fork/board',{'design/board.kicad_pcb':'(kicad_pcb)','models/part.step':'STEP'},{entries:d=>d===''?[{path:'design',type:'directory'},{path:'models',type:'directory'},{path:'link',type:'symlink'},{path:'submodule',type:'submodule'}]:d==='design'?[{path:'design/board.kicad_pcb',type:'file'}]:[{path:'models/part.step',type:'file'}]});const reply=await message({type:'repository-tree',repository:'fork/board',ref:'feature/pcb'});assert.equal(reply.ok,true,reply.error);assert.equal(reply.result.snapshotRef,sha('a'));assert.ok(reply.result.entries.some(x=>x.path==='design'&&x.type==='tree'));assert.ok(reply.result.entries.some(x=>x.path==='link'&&x.type==='blob'&&x.mode==='120000'));assert.ok(reply.result.entries.some(x=>x.path==='submodule'&&x.type==='commit'));assert.equal(fixture.raw.length,0);assert.ok(fixture.session.every(x=>x.repository==='fork/board'));
});
test('repository directory browsing walks immutable trees and pages full-path children',async t=>{
 const sources=Object.fromEntries(Array.from({length:150},(_,i)=>['models/part'+String(i).padStart(3,'0')+'.step','STEP']));const fixture=withWebsite(t,'owner/board',sources);const reply=await message({type:'repository-tree',repository:'owner/board',ref:sha('a'),directory:'models',page:2});assert.equal(reply.ok,true,reply.error);assert.equal(reply.result.entries.length,50);assert.equal(reply.result.entries[0].path,'models/part100.step');assert.equal(reply.result.hasMore,false);assert.equal(reply.result.directory,'models');assert.equal(fixture.raw.length,0);assert.ok(fixture.session.every(x=>x.ref===sha('a')));
});
test('website repository history returns real commit fields and rejects unverified pagination',async t=>{
 const fixture=withWebsite(t,'fork/board',{'board.kicad_pcb':'(kicad_pcb)'});const request={type:'repository-history',repository:'fork/board',ref:'main'},reply=await message(request);assert.equal(reply.ok,true,reply.error);assert.equal(reply.result.commits[0].message,'Saved revision');assert.equal(reply.result.nextPage,null);assert.equal(fixture.raw.length,2);const next=await message({...request,page:2});assert.equal(next.ok,false);assert.match(next.error,/pagination/);assert.equal(fixture.raw.length,2);
});
test('repository browser validates viewer, scope, directory and paging before requests',async(t)=>{
 let reads=0;withFetch(t,async()=>{reads++;return json({});});for(const type of ['repository-tree','repository-history']){for(const sender of [options,githubTab(9,'/owner/board'),{id:'test-id',url:extensionOrigin+'pcb-viewer.html/evil'}])assert.notEqual((await message({type,repository:'owner/board',ref:sha('a')},sender)).ok,true);for(const change of [{repository:'../repo'},{ref:'bad\n'},{page:0},{page:101},{page:'2'},{directory:'../outside'}]){if(type==='repository-history'&&change.directory)continue;assert.equal((await message({type,repository:'owner/board',ref:sha('a'),...change})).ok,false);}}assert.equal(reads,0);
});
test('repository browser rejects mismatched website trees and never invents API graph data',async t=>{
 withWebsite(t,'owner/board',{}, {sha:sha('b')});const tree=await message({type:'repository-tree',repository:'owner/board',ref:sha('a')});assert.equal(tree.ok,false);assert.match(tree.error,/snapshot|session/i);const history=await message({type:'repository-history',repository:'owner/board',ref:sha('a')});assert.equal(history.ok,false);assert.match(history.error,/different pinned revision/);
});

test('repository branch metadata works without a drawing file and retains sender validation',async t=>{
 const fixture=withWebsite(t,'owner/board',{});const request={type:'repository-branches',repository:'owner/board',ref:sha('a')};const reply=await message(request);assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.branches,[{name:'main',isDefault:true}]);assert.match(reply.result.warnings.join(' '),/branch window/);assert.equal((await message({...request,repository:'../bad'})).ok,false);assert.equal((await message(request,options)).ok,false);assert.equal(fixture.session.length+fixture.raw.length,2);
});
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
test('Stop cancels only the exact viewer subscriber while a shared website read still serves another window',async t=>{
 let release;const fixture=withWebsite(t,'owner/cancel',{}, {readSession:async()=>new Promise(resolve=>release=resolve)});const request={type:'revision-resolve',repository:'owner/cancel',ref:'main',file:'board.kicad_pcb',loadId:'cancel-test'},senderA={...viewer,tab:{id:81},frameId:0,documentId:'a'},senderB={...senderA,documentId:'b'};const a=message(request,senderA),b=message(request,senderB);await nextTurn();assert.equal((await message({type:'load-cancel',loadId:'cancel-test'},{...senderA,frameId:1})).ok,false);assert.equal((await message({type:'load-cancel',loadId:'cancel-test'},options)).ok,false);assert.equal((await message({type:'load-cancel',loadId:'cancel-test'},senderA)).result.cancelled,true);assert.match((await a).error,/cancelled/);release({ok:true,result:{sha:sha('a'),items:[]}});const completed=await b;assert.equal(completed.ok,true,completed.error);assert.equal(completed.result.sha,sha('a'));assert.equal(fixture.session.filter(m=>m.type==='github-session-read').length,1,'shared transport does not duplicate work');assert.equal((await message({type:'load-cancel',loadId:'cancel-test'},senderA)).result.cancelled,false);
});
test('cancellable reads reject malformed identifiers, duplicates and auth/write tagging',async t=>{
 let release;const fixture=withWebsite(t,'owner/duplicate',{}, {readSession:async()=>new Promise(resolve=>release=resolve)});const request={type:'revision-resolve',repository:'owner/duplicate',ref:'main',file:'board.kicad_pcb',loadId:'one'};const first=message(request);await nextTurn();assert.equal((await message(request)).ok,false);for(const change of [{loadId:'bad space'},{loadId:''},{type:'github-auth-clear'},{type:'github-publish-comment'}])assert.equal((await message({...request,...change})).ok,false);assert.equal(fixture.session.length,1);await message({type:'load-cancel',loadId:'one'});assert.match((await first).error,/cancelled/);release({ok:true,result:{sha:sha('a'),items:[]}});await nextTurn();
});
test('Stop returns immediately from website-session loads and ignores their late completion',async t=>{
 let release;const fixture=withWebsite(t,'owner/stop-session',{}, {readSession:async()=>new Promise(resolve=>release=resolve)});const pending=message({type:'revision-resolve',repository:'owner/stop-session',ref:'main',file:'board.kicad_pcb',loadId:'session-test'});await nextTurn();assert.ok(fixture.session[0].requestId);await message({type:'load-cancel',loadId:'session-test'});assert.match((await pending).error,/cancelled/);release({ok:true,result:{sha:sha('a'),items:[]}});await nextTurn();assert.ok(fixture.session.filter(m=>m.type==='github-session-read').every(m=>m.repository==='owner/stop-session'));const cancelled=fixture.session.find(m=>m.type==='repository-session-cancel');assert.equal(cancelled.requestId,fixture.session[0].requestId);
});
test('Stop rejects a drawing load and cancels the underlying body when its final subscriber leaves',async t=>{
 let controller,cancelled=0;const fixture=withWebsite(t,'owner/body',{'board.kicad_pcb':'(kicad_pcb)'},{raw:async()=>new Response(new ReadableStream({start(c){controller=c;},cancel(){cancelled++;}}))});const pending=message({type:'project',repository:'owner/body',ref:sha('a'),file:'board.kicad_pcb',loadId:'pcb-body'});await nextTurn();assert.ok(controller);await message({type:'load-cancel',loadId:'pcb-body'});assert.match((await pending).error,/cancelled/);await nextTurn();assert.equal(cancelled,1);assert.equal(fixture.raw.length,1);
});
test('completed project reads release their load identity for sequential reuse',async t=>{
 const fixture=withWebsite(t,'owner/sequential',{'board.kicad_pcb':'(kicad_pcb)','board.kicad_pro':'{}'});const base={repository:'owner/sequential',ref:'main',file:'board.kicad_pcb',loadId:'sequential'};const first=await message({...base,type:'revision-resolve'});assert.equal(first.ok,true,first.error);const listing=await message({...base,type:'project-inventory'});assert.equal(listing.ok,true,listing.error);const setting=await message({...base,type:'project-file',ref:sha('a'),file:'board.kicad_pro'});assert.equal(setting.ok,true,setting.error);assert.equal(setting.result.content,'{}');assert.equal((await message({type:'load-cancel',loadId:base.loadId})).result.cancelled,false);assert.equal(fixture.raw.length,1);
});

test('repository detection pins website default snapshot and returns only bounded KiCad metadata',async t=>{
 const fixture=withWebsite(t,'owner/board',{'design/board.kicad_pro':'{}','design/board.kicad_sch':'(kicad_sch)','notes.txt':'text'},{entries:d=>d===''?[{path:'design',type:'directory'},{path:'notes.txt',type:'file'},{path:'linked.kicad_pro',type:'symlink'}]:[{path:'design/board.kicad_pro',type:'file'},{path:'design/board.kicad_sch',type:'file'}]});const sender=githubTab(5,'/owner/board'),request={type:'repository-detect',repository:'owner/board',ref:'HEAD'};const reply=await message(request,sender);assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.projects,['design/board.kicad_pro']);assert.equal(reply.result.sha,sha('a'));assert.equal(fixture.raw.length,0);for(const bad of [{...sender,frameId:1},{...sender,url:'https://github.com/owner/other'},{...sender,url:'https://github.com/owner/board/issues'},viewer])assert.equal((await message(request,bad)).ok,false);assert.equal((await message({...request,ref:'other'},githubTab(5,'/owner/board/tree/main'))).ok,false);
});

test('repo-main detection uses the existing private website session without first trying API',async t=>{
 const fixture=withWebsite(t,'owner/private',{'board.kicad_pro':'{}'},{private:true});const reply=await message({type:'repository-detect',repository:'owner/private',ref:'HEAD'},githubTab(7,'/owner/private'));assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.projects,['board.kicad_pro']);assert.equal(fixture.raw.length,0);assert.ok(fixture.session.length>0);
});

test('environment diagnostics endpoint is options-only and forwards no repository credentials',async t=>{
 const previous=global.KiCadEnvironmentDiagnostics,manifest=chrome.runtime.getManifest;let checked=0;
 global.KiCadEnvironmentDiagnostics={check:async options=>{checked++;assert.equal(options.fetch,fetch);assert.equal(options.version,'test-version');assert.equal(Object.keys(options).sort().join(','),'fetch,permissions,version');return {ok:true};}};
 chrome.runtime.getManifest=()=>({version:'test-version'});t.after(()=>{global.KiCadEnvironmentDiagnostics=previous;chrome.runtime.getManifest=manifest;});
 for(const sender of [viewer,githubTab(2,'/owner/repo'),{...options,url:options.url+'/other'}])assert.notEqual((await message({type:'viewer-diagnostics'},sender)).ok,true);
 assert.equal(checked,0);assert.deepEqual((await message({type:'viewer-diagnostics'},options)).result,{ok:true});assert.equal(checked,1);
});

test('conversation state writes require exact extension viewer identity',async t=>{
 let called=0;const before=KiCadGitHubReviewApi.chatThreadState;KiCadGitHubReviewApi.chatThreadState=async()=>{called++;return{state:'closed'};};t.after(()=>KiCadGitHubReviewApi.chatThreadState=before);
 const request={type:'chat-thread-state',repository:'owner/repo',ref:'main',file:'board.kicad_pcb',thread:{kind:'issue',number:42},state:'closed',expectedUpdatedAt:'2026-10-27T00:00:00Z',confirmed:true};
 for(const sender of [options,githubTab(1,'/owner/repo/blob/main/board.kicad_pcb'),{id:'other',url:viewer.url}])assert.notEqual((await message(request,sender)).ok,true);
 assert.equal(called,0);assert.equal((await message(request)).ok,true);assert.equal(called,1);
});

test('Open in KiCad background route accepts only bound owned viewers and uses completed download paths',async t=>{
 const previousDownloads=chrome.downloads,previousPermissions=chrome.permissions,previousNative=chrome.runtime.sendNativeMessage;const nativeCalls=[],downloadCalls=[],listeners=new Set();
 t.after(()=>{chrome.downloads=previousDownloads;chrome.permissions=previousPermissions;chrome.runtime.sendNativeMessage=previousNative;});
 chrome.permissions={contains:async()=>true};chrome.downloads={download:async value=>{downloadCalls.push(value);return 987;},search:async()=>[{id:987,state:'complete',filename:'C:\\Downloads\\review.zip'}],onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}};chrome.runtime.sendNativeMessage=async(host,value)=>{nativeCalls.push({host,value});return value.operation==='status'?{ok:true}:{ok:true,opened:true};};
 const scope={type:'native-kicad-open',repository:'owner/repo',ref:'e'.repeat(40),file:'board.kicad_pcb',confirmed:true},owned={id:'test-id',frameId:0,documentId:'native-open',url:extensionOrigin+'pcb-viewer.html?'+new URLSearchParams({repository:scope.repository,ref:scope.ref,file:scope.file})};
 for(const other of [options,githubTab(1,'/owner/repo'),viewer])assert.equal((await message(scope,other)).ok,false);
 assert.equal(downloadCalls.length,0);const result=await message(scope,owned);assert.equal(result.ok,true);assert.equal(result.result.opened,true);assert.equal(downloadCalls[0].saveAs,true);assert.equal(nativeCalls[1].value.archivePath,'C:\\Downloads\\review.zip');assert.equal(listeners.size,0);
 const foreign=await message({...scope,archivePath:'C:\\private.zip'},owned);assert.equal(foreign.ok,false);assert.equal(downloadCalls.length,1);
});


test('Draftsman repository writes require owned viewers and explicitly allowed GitLab hosts',async t=>{
 const old=global.KiCadDraftsmanRepository,oldService=global.draftsmanRepository,hosts=global.KiCadGitLabHosts,captured=[];
 t.after(()=>{global.KiCadDraftsmanRepository=old;global.draftsmanRepository=oldService;global.KiCadGitLabHosts=hosts;});
 delete global.draftsmanRepository;global.KiCadDraftsmanRepository={create:()=>({save:async value=>{captured.push(value);return{saved:true};}})};global.KiCadGitLabHosts={allowed:async host=>host==='https://gitlab.com'};
 const request={type:'draftsman-save',provider:'github',repository:'owner/repo',ref:'a'.repeat(40),confirmed:true};
 assert.deepEqual(await message(request,{id:'other',url:viewer.url}),{ignored:true});
 for(const sender of [githubTab(1,'/owner/repo'),options,{id:'test-id',url:extensionOrigin+'analysis-viewer.html'},{id:'test-id',url:extensionOrigin+'pdf-viewer.html'}])assert.equal((await message(request,sender)).ok,false);
 assert.equal(captured.length,0);assert.equal((await message(request,viewer)).ok,true);assert.equal(captured[0].host,'https://github.com');
 assert.equal((await message({...request,provider:'gitlab',host:'https://blocked.example'},viewer)).ok,false);assert.equal(captured.length,1);
 assert.equal((await message({...request,provider:'gitlab',host:'https://gitlab.com'},viewer)).ok,true);assert.equal(captured[1].provider,'gitlab');
});


test('owned launcher discovery is read-only, source-bound and distinct from website injection',async t=>{
 const launcher={id:'test-id',frameId:0,tab:{id:7},url:extensionOrigin+'project-launcher.html'},request={type:'repository-detect',source:'https://github.com/owner/board',repository:'owner/board',ref:'HEAD'};const fixture=withWebsite(t,'owner/board',{'board.kicad_pro':'{}'});const reply=await message(request,launcher);assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.projects,['board.kicad_pro']);const before=fixture.session.length;for(const change of [{source:'https://evil.example/owner/board'},{repository:'owner/other'},{ref:'other'}])assert.equal((await message({...request,...change},launcher)).ok,false);assert.equal(fixture.session.length,before);assert.equal((await message({type:'github-thread-read'},launcher)).ok,false);assert.equal((await message(request,{...launcher,frameId:1})).ok,false);
});


test('dashboard and icon open owned project workspaces even before a repository content script is ready',async t=>{
 const previous=calls.response;calls.response=undefined;t.after(()=>{calls.response=previous;});const start=calls.created.length,dashboard={id:'test-id',url:extensionOrigin+'dashboard.html'};
 for(const source of ['https://github.com/BerkeleyLab/Marble','https://github.com/BerkeleyLab/Marble/tree/main/design','https://github.com/Ttl/vna2/tree/master/hw']){
  const reply=await message({type:'dashboard-open-project',url:source},dashboard);assert.equal(reply.ok,true,reply.error);const opened=new URL(calls.created.at(-1).url);assert.equal(opened.pathname,'/project-launcher.html');assert.equal(opened.searchParams.get('source'),source);
 }
 await background.openFromAction({id:42,url:'https://github.com/BerkeleyLab/Marble/tree/main/design'});const action=new URL(calls.created.at(-1).url);assert.equal(action.pathname,'/project-launcher.html');assert.equal(action.searchParams.get('source'),'https://github.com/BerkeleyLab/Marble/tree/main/design');assert.equal(action.searchParams.has('error'),false);assert.equal(calls.created.length,start+4);
});

test('owned launcher without a website tab fails explicitly and performs zero background requests',async t=>{
 const previousQuery=chrome.tabs.query;t.after(()=>chrome.tabs.query=previousQuery);chrome.tabs.query=async()=>[];let reads=0;withFetch(t,async()=>{reads++;throw Error('Forbidden background request');});
 const sender={id:'test-id',url:extensionOrigin+'project-launcher.html'};
 for(const repository of ['BerkeleyLab/Marble','Ttl/vna2']){const reply=await message({type:'repository-detect',source:'https://github.com/'+repository,repository,ref:'HEAD'},sender);assert.equal(reply.ok,false);assert.match(reply.error,/same signed-in browser profile|website session/);}
 assert.equal(reads,0);
});


test('administrator failures retain only the recognized safe policy code across the message boundary',async t=>{
 const original=global.KiCadManagedPolicy;t.after(()=>global.KiCadManagedPolicy=original);
 global.KiCadManagedPolicy={authorize:async()=>{throw Object.assign(Error('Network access is disabled by administrator policy.'),{code:'MANAGED_POLICY',token:'SECRET'});}};
 const blocked=await message({type:'repository-detect',source:'https://github.com/owner/repo',repository:'owner/repo'},viewer);
 assert.equal(blocked.ok,false);assert.equal(blocked.code,'MANAGED_POLICY');assert.doesNotMatch(JSON.stringify(blocked),/SECRET/);
 global.KiCadManagedPolicy={authorize:async()=>{throw Object.assign(Error('Request rejected.'),{code:'PRIVATE_DETAIL_SECRET'});}};
 const rejected=await message({type:'repository-detect',source:'https://github.com/owner/repo',repository:'owner/repo'},viewer);assert.equal(rejected.code,undefined);assert.doesNotMatch(JSON.stringify(rejected),/PRIVATE_DETAIL/);
});


test('icon invocation installs only isolated read bridge after explicit click and handles policy rejection',async t=>{
 const original=chrome.scripting;t.after(()=>chrome.scripting=original);const injected=[];chrome.scripting={executeScript:async value=>{injected.push(value);}};
 await background.openFromAction({id:79,url:'https://github.com/owner/private'});assert.equal(injected.length,1);assert.equal(injected[0].target.tabId,79);assert.equal(injected[0].files.at(-1),'repository-session-bridge.js');assert.equal(injected[0].files.includes('content.js'),false);
 const before=injected.length;await background.openFromAction({id:80,url:'https://unrelated.example/'});assert.equal(injected.length,before);
 chrome.scripting.executeScript=async()=>{throw Error('SECRET POLICY DETAIL');};await background.openFromAction({id:79,url:'https://github.com/owner/private'});const result=new URL(calls.created.at(-1).url);assert.match(result.searchParams.get('error'),/blocked by policy/);assert.doesNotMatch(result.href,/SECRET/);
});


test('inline launch is opt-in, bound to the clicked repository and cannot become an unscoped website frame',async t=>{
 const fixture=withWebsite(t,'org/inline',{'board.kicad_pro':'{}','board.kicad_sch':'(kicad_sch)'}),oldScripting=chrome.scripting,send=chrome.tabs.sendMessage,commands=[],injections=[];
 t.after(()=>{chrome.scripting=oldScripting;localStore.delete('project-viewer-mode');});
 chrome.scripting={executeScript:async request=>{injections.push(request);return [];}};
 chrome.tabs.sendMessage=async(id,request,opts)=>{if(request.type==='projectLaunchContext')return null;if(request.type==='inline-project-open'){commands.push(request);return {ok:true,result:{opened:true,mode:'inline'}};}return send(id,request,opts);};
 assert.equal((await message({type:'viewer-preferences-set',mode:'inline'},viewer)).ok,false);
 assert.equal((await message({type:'viewer-preferences-set',mode:'unsafe'},options)).ok,false);
 assert.equal((await message({type:'viewer-preferences-set',mode:'inline'},options)).ok,true);
 assert.equal((await message({type:'viewer-preferences-get'},options)).result.mode,'inline');
 const before=calls.created.length;await background.openFromAction({id:71,url:'https://github.com/org/inline'});assert.equal(calls.created.length,before);assert.equal(commands.length,1);assert.ok(injections.some(x=>x.files.includes('inline-project-view.js')));
 const frame={id:'test-id',frameId:2,tab:{id:71,url:'https://github.com/org/inline'},url:commands[0].url};
 const request={type:'repository-detect',source:'https://github.com/org/inline',repository:'org/inline',ref:'HEAD'};
 assert.equal((await message(request,frame)).ok,true);
 assert.equal((await message(request,{...frame,tab:{id:999,url:'https://github.com/org/inline'}})).ok,false);
 assert.equal((await message({...request,repository:'org/other'},frame)).ok,false);
 const viewerFrame={...frame,url:extensionOrigin+'browser-viewer.html?repository=org/inline&head='+sha('a')};
 assert.equal((await message({type:'project-file',repository:'org/inline',ref:sha('a'),file:'board.kicad_pro'},viewerFrame)).ok,true);
 assert.equal((await message({type:'project-file',repository:'org/other',ref:sha('a'),file:'board.kicad_pro'},viewerFrame)).ok,false);
 const popout={type:'inline-project-open-tab',url:commands[0].url};assert.equal((await message(popout,githubTab(71,'/org/inline'))).ok,true);assert.equal((await message({...popout,url:extensionOrigin+'project-viewer.html?repository=org/other'},githubTab(71,'/org/inline'))).ok,false);
 assert.ok(fixture.raw.every(x=>x.init.credentials==='same-origin'));
});

test('fabrication-only repositories choose Gerber jobs and keep declared source reads in the website session',async t=>{
 withWebsite(t,'org/fabrication',{'fab/board.gbrjob':'{}','fab/top.gbr':'M02*','fab/drills.xnc':'M48\n%\nM30'});
 const request={type:'repository-detect',source:'https://github.com/org/fabrication',repository:'org/fabrication',ref:'HEAD'},launcher={id:'test-id',url:extensionOrigin+'project-launcher.html'};
 const reply=await message(request,launcher);assert.equal(reply.ok,true,reply.error);assert.deepEqual(reply.result.projects,['fab/board.gbrjob']);
});


test('dedicated fabrication viewer reads pinned files and rejects review writes and unbound frames',async t=>{
 const fixture=withWebsite(t,'org/fab-view',{'fab/board.gbrjob':'{}','fab/top.gbr':'M02*','fab/drill.xnc':'M48\n%\nM30'});
 const sender={id:'test-id',url:extensionOrigin+'gerber-viewer.html?repository=org/fab-view',frameId:0};
 const scope={repository:'org/fab-view',ref:sha('a'),file:'fab/board.gbrjob'};
 const inventory=await message({type:'project-inventory',...scope},sender);assert.equal(inventory.ok,true,inventory.error);assert.ok(inventory.result.files.some(f=>f.path==='fab/drill.xnc'));
 const source=await message({type:'project-file',...scope,file:'fab/top.gbr'},sender);assert.equal(source.ok,true,source.error);assert.equal(source.result.content,'M02*');assert.ok(fixture.raw.every(x=>x.init.credentials==='same-origin'));
 for(const type of ['github-post','github-auth-status','chat-write','draftsman-save','repository-tree'])assert.equal((await message({type,...scope},sender)).ok,false);
 const embedded={...sender,frameId:4,tab:{id:901,url:'https://github.com/org/fab-view'}};assert.notEqual((await message({type:'project-file',...scope},embedded)).ok,true);
});

test('website handoff prepares metadata without auth, tabs, receipts or network writes',async t=>{
 const oldFetch=global.fetch;global.fetch=async()=>{throw Error('No network allowed');};t.after(()=>global.fetch=oldFetch);
 const before={created:calls.created.length,updated:calls.updated.length,session:sessionStore.size};
 const note=sampleComment();note.anchor.position={x:12,y:24};note.anchor.area={x:10,y:20,width:4,height:8};note.anchor.sheetUuid='11111111-2222-4333-8444-555555555555';note.anchor.sheetName='Power';note.anchor.instancePath='/root/power';
 const result=await message({type:'open-comment-draft',websiteHandoff:true,comment:note});assert.equal(result.ok,true);assert.equal(result.result.prefilled,true);
 const url=new URL(result.result.url);assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/owner/board/issues/new');assert.equal(url.searchParams.get('body'),result.result.body);
 const roundtrip=KiCadReviewComments.fromMarkdown(result.result.body)[0];assert.deepEqual(roundtrip.anchor,note.anchor);assert.match(result.result.body,/End \(mm\)/);
 assert.deepEqual({created:calls.created.length,updated:calls.updated.length,session:sessionStore.size},before);
 for(const [targetType,path]of [['issue','issues'],['discussion','discussions'],['pull-request','pull']]){
  const draft=await message({type:'open-comment-draft',websiteHandoff:true,comment:note,targetType,targetNumber:31,targetRepository:'base/board'});assert.equal(draft.result.url,'https://github.com/base/board/'+path+'/31');assert.equal(draft.result.prefilled,false);
 }
 const discussion=await message({type:'open-comment-draft',websiteHandoff:true,comment:note,destination:'discussion'});assert.equal(discussion.result.url,'https://github.com/owner/board/discussions/new');
 const long=await message({type:'open-comment-draft',websiteHandoff:true,comment:{...note,text:'Large draft '.repeat(300)}});assert.equal(long.result.prefilled,false);assert.equal(new URL(long.result.url).search,'');assert.ok(long.result.body.length>5000);
 assert.equal((await message({type:'open-comment-draft',websiteHandoff:true,comment:note,targetType:'issue',targetNumber:0})).ok,false);
 assert.equal((await message({type:'open-comment-draft',websiteHandoff:true,comment:note,targetRepository:'../other'})).ok,false);
 assert.equal((await message({type:'open-comment-draft',websiteHandoff:true,comment:note},githubTab(1,'/owner/board'))).ok,false);
});
test('GitLab website handoff uses documented prefill and keeps local attachments out of website metadata',async()=>{
 const note=sampleComment();note.anchor={...note.anchor,provider:'gitlab',host:'https://gitlab.example.com',repository:'group/sub/project'};
 note.attachments=[{provider:'gitlab',host:note.anchor.host,repository:note.anchor.repository,projectId:9,mime:'image/png',width:30,height:20,url:note.anchor.host+'/group/sub/project/uploads/'+'a'.repeat(32)+'/kicad-review-'+'b'.repeat(20)+'.png'}];
 const prepared=await message({type:'open-comment-draft',websiteHandoff:true,provider:'gitlab',host:note.anchor.host,comment:note});assert.equal(prepared.ok,true);const url=new URL(prepared.result.url);assert.equal(url.origin,note.anchor.host);assert.equal(url.pathname,'/group/sub/project/-/work_items/new');assert.equal(url.searchParams.get('issue[description]'),prepared.result.body);
 assert.equal(KiCadReviewComments.fromMarkdown(prepared.result.body)[0].attachments,undefined);assert.equal(prepared.result.body.includes(note.attachments[0].url),false);assert.match(prepared.result.body,/Attach them manually/);
 const reply=await message({type:'open-comment-draft',websiteHandoff:true,provider:'gitlab',host:note.anchor.host,comment:note,targetType:'issue',targetNumber:42});assert.equal(reply.result.url,note.anchor.host+'/group/sub/project/-/issues/42');
 assert.equal((await message({type:'open-comment-draft',websiteHandoff:true,provider:'gitlab',comment:note,destination:'discussion'})).ok,false);
});

test('BoM viewer reads only its selected CSV at its pinned website revision',async t=>{withWebsite(t,'owner/bom-view',{'board.kicad_pcb':'(kicad_pcb)','BoM.csv':'Reference,Value\nR1,10k'});const scope={repository:'owner/bom-view',ref:sha('a'),file:'BoM.csv'},sender={id:'test-id',url:extensionOrigin+'bom-viewer.html?'+new URLSearchParams(scope),frameId:0};const result=await message({type:'project-file',...scope},sender);assert.equal(result.ok,true,result.error);assert.match(result.result.content,/R1,10k/);for(const extra of [{repository:'owner/other'},{ref:sha('b')},{file:'other.csv'},{type:'chat-message-write'},{type:'github-auth-status'},{type:'project',file:'board.kicad_pcb'}])assert.equal((await message({type:'project-file',...scope,...extra},sender)).ok,false);});

test('standalone BoM discovery uses its drawing seed and file changes require a new page scope',async t=>{withWebsite(t,'owner/bom-seed',{'design/board.kicad_pcb':'(kicad_pcb)','design/BoM.csv':'Reference,Value\nR1,10k','design/parts.csv':'Reference,Value\nR2,1k'});const scope={repository:'owner/bom-seed',ref:sha('a')},sourceFile='design/board.kicad_pcb',sender={id:'test-id',url:extensionOrigin+'bom-viewer.html?'+new URLSearchParams({...scope,sourceFile}),frameId:0};const listing=await message({type:'project-inventory',...scope,file:sourceFile},sender);assert.equal(listing.ok,true,listing.error);assert(listing.result.files.some(x=>x.path==='design/BoM.csv'));assert.equal((await message({type:'project-file',...scope,file:'design/parts.csv'},sender)).ok,false);const selected={...sender,url:sender.url+'&file=design%2Fparts.csv'};assert.equal((await message({type:'project-file',...scope,file:'design/parts.csv'},selected)).ok,true);assert.equal((await message({type:'project-inventory',...scope,file:'unrelated.kicad_pcb'},selected)).ok,false);});
