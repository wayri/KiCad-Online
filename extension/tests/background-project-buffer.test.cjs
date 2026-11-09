global.KiCadGitHubWebsitePulls=require('../github-website-pulls.js');
global.KiCadGitHubWebsiteHistory=require('../github-website-history.js');
/* Actual worker dispatch + website snapshot transport, independent of legacy API helpers. */
const test=require('node:test'),assert=require('node:assert/strict');
const SHA='a'.repeat(40),origin='chrome-extension://buffer-test/';let listener,fixture;let actionListener;
global.KiCadGitHub=require('../parsing.js');global.KiCadBrowserData=require('../browser-data.js');global.KiCadGitHubSessionReader=require('../github-session-reader.js');global.KiCadGitHubProjectBuffer=require('../github-project-buffer.js');global.KiCadGitHubProjectView=require('../github-project-view.js');global.KiCadReviewComments=require('../review-comments.js');global.KiCadGitHubReviewApi=require('../github-review-api.js');global.KiCadProjectLaunch=require('../project-launch.js');
global.importScripts=()=>{};const storage=()=>{const entries=new Map();return {get:async key=>({[key]:entries.get(key)}),set:async values=>{for(const [k,v]of Object.entries(values))entries.set(k,v);},remove:async key=>entries.delete(key)};};
global.chrome={runtime:{id:'buffer-test',getURL:path=>origin+path,onMessage:{addListener:fn=>listener=fn}},storage:{local:storage(),session:storage()},action:{onClicked:{addListener(fn){actionListener=fn;}},setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},tabs:{query:async()=>[{id:51,url:'https://github.com/'+fixture.repository+'/tree/main'}],sendMessage:async(id,message)=>{fixture.session.push(message);if(message.type!=='github-session-read')return {ok:true};if(fixture.sessionError)throw fixture.sessionError;if(message.action==='resolve')return {ok:true,result:{sha:SHA,items:fixture.tree('')}};if(message.action==='directory')return {ok:true,result:{sha:SHA,items:fixture.tree(message.path)}};if(message.action==='branches')return {ok:true,result:{repository:fixture.repository,branches:[{name:'main',isDefault:true}],partial:false,warnings:[]}};if(message.action==='commit')return {ok:true,result:{repository:fixture.repository,sha:fixture.commitSha||message.ref,parents:[],parentsKnown:true}};if(message.action==='pull')return {ok:true,result:fixture.pull};if(message.action==='pulls')return {ok:true,result:{repository:fixture.repository,pulls:[],hasMore:true,warnings:[]}};if(message.action==='history')return {ok:true,result:{ref:message.ref,content:`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:github.com,2008:Grit::Commit/${SHA}</id><link href="https://github.com/${fixture.repository}/commit/${SHA}"/><title>Saved board</title><updated>2026-10-30T00:00:00Z</updated><author><name>Designer</name></author></entry></feed>`}};if(message.action==='file')return {ok:true,result:fixture.sources.has(message.path)?{sha:SHA,content:fixture.sources.get(message.path)}:null};return {ok:true,result:null};}},windows:{create:async()=>({id:1})}};
global.fetch=async(url,options)=>{fixture.fetches.push({url:String(url),options});assert.equal(options.credentials,'omit');assert.equal(options.headers?.Authorization,undefined);if(new URL(url).hostname==='github.com'){assert.equal(String(url),`https://github.com/${fixture.repository}/commits/${SHA}.atom`);return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:github.com,2008:Grit::Commit/${SHA}</id><link href="https://github.com/${fixture.repository}/commit/${SHA}"/><title>Saved board</title><updated>2026-10-30T00:00:00Z</updated><author><name>Designer</name></author></entry></feed>`,{headers:{'content-type':'application/atom+xml'}});}assert.equal(new URL(url).hostname,'raw.githubusercontent.com','default project route must not call GitHub API');const prefix='https://raw.githubusercontent.com/'+fixture.repository+'/'+SHA+'/';assert.ok(String(url).startsWith(prefix));const path=decodeURIComponent(String(url).slice(prefix.length));if(fixture.private)return new Response('',{status:404});const source=fixture.sources.get(path);return source===undefined?new Response('',{status:404}):new Response(source);};
require('../background.js');
const viewer=(name='revision-viewer.html')=>({id:'buffer-test',url:origin+name,tab:{id:80},frameId:0,documentId:name});
function message(request,sender=viewer()){return new Promise(resolve=>{if(!listener(request,sender,resolve))resolve({ignored:true});});}
function setup(repository,sources){fixture={repository,sources:new Map(Object.entries(sources)),session:[],fetches:[],tree(directory){const result=new Map();for(const path of this.sources.keys()){const segments=path.split('/'),prefix=directory?directory+'/':'';if(!path.startsWith(prefix))continue;const tail=path.slice(prefix.length),first=tail.split('/')[0],entry=prefix+first;result.set(entry,{path:entry,type:tail.includes('/')?'directory':'file'});}return [...result.values()];}};return {repository,ref:SHA,file:[...fixture.sources.keys()].find(p=>p.endsWith('.kicad_pcb'))||[...fixture.sources.keys()][0]};}
test('owned viewers share pinned project source bytes across layout, 3D and detached requests with no GitHub API',async t=>{
 await KiCadGitHubReviewApi.setToken('github_pat_'+'z'.repeat(40));t.after(()=>KiCadGitHubReviewApi.clearToken());
 const scope=setup('buffer/shared',{'design/board.kicad_pcb':'(kicad_pcb)','design/board.kicad_sch':'(kicad_sch)','design/board.kicad_pro':'{}','models/body.step':'ISO-10303-21;'});
 const project=await message({...scope,type:'project'});assert.equal(project.ok,true,project.error);assert.equal(project.result[0].content,'(kicad_pcb)');
 const reads=fixture.fetches.length;
 const second=await message({...scope,type:'project'},viewer('pcb-viewer.html'));assert.equal(second.ok,true,second.error);assert.equal(fixture.fetches.length,reads,'second independent viewer reuses immutable bytes');
 const inventory=await message({...scope,type:'project-inventory'});assert.equal(inventory.ok,true,inventory.error);assert.ok(inventory.result.files.some(f=>f.path==='design/board.kicad_sch'));
 const models=await message({...scope,type:'repo-model-index'});assert.equal(models.ok,true,models.error);assert.deepEqual(models.result.paths,['models/body.step']);
 const raw=await message({...scope,type:'project-file',file:'design/board.kicad_pcb'});assert.equal(raw.ok,true,raw.error);assert.equal(fixture.fetches.length,reads);
 assert.ok(fixture.session.every(m=>!m.token&&!m.cookie&&!m.url));assert.ok(fixture.fetches.every(c=>!c.url.includes('api.github.com')));
});
test('session-only private snapshots do not request API tokens and reject foreign senders before reads',async()=>{
 const scope=setup('buffer/private',{'board.kicad_pcb':'(kicad_pcb)'});fixture.private=true;
 const bad=await message({...scope,type:'project'},{id:'other',url:origin+'revision-viewer.html'});assert.notEqual(bad.ok,true);assert.equal(fixture.session.length+fixture.fetches.length,0);
 const opened=await message({...scope,type:'project'});assert.equal(opened.ok,true,opened.error);assert.ok(fixture.session.some(m=>m.action==='file'));assert.equal(fixture.fetches.length,0);
 const count=fixture.session.length+fixture.fetches.length;assert.equal((await message({...scope,type:'project-file',file:'../secret'})).ok,false);assert.equal(fixture.session.length+fixture.fetches.length,count);
});
test('API-free commit history uses a shared website feed and verified branch names',async()=>{
 const scope=setup('buffer/history',{'board.kicad_pcb':'(kicad_pcb)'});
 for(const type of ['repository-branches','revision-branches','repository-history','revision-commits']){const reply=await message({...scope,type});assert.equal(reply.ok,true,reply.error);if(type.includes('branches'))assert.deepEqual(reply.result.branches,[{name:'main',isDefault:true}]);else assert.deepEqual(reply.result.commits.map(c=>c.sha),[SHA]);}
 assert.equal(fixture.fetches.length,0);assert.equal(fixture.session.filter(m=>m.action==='history').length,1);
});
test('dedicated schematic detached load and cancellable inventory share pinned source bytes with no API',async()=>{
 const scope=setup('buffer/detached',{'design/root.kicad_sch':'(kicad_sch (uuid root))','design/root.kicad_pcb':'(kicad_pcb)'});
 const sender=viewer('schematic-viewer.html?detached=1&viewSession=12345678-1234-1234-1234-123456789012');
 const input={...scope,file:'design/root.kicad_sch',type:'project',loadId:'detached-project-load'};
 const result=await message(input,sender);assert.equal(result.ok,true,result.error);assert.equal(result.result[0].path,input.file);
 const count=fixture.fetches.length;assert.equal((await message({...input,loadId:'second-project-load'},viewer())).ok,true);assert.equal(fixture.fetches.length,count);
 const inventory=await message({...scope,type:'project-inventory',loadId:'detached-inventory'},sender);assert.equal(inventory.ok,true,inventory.error);assert.equal(inventory.result.snapshotRef,SHA);
});


test('pinned actual VNA legacy root follows saved child links and shares its cache library across detached loads',async()=>{
 const fs=require('node:fs'),path=require('node:path'),base=path.join(__dirname,'fixtures/legacy-vna2'),root=fs.readFileSync(path.join(base,'vna2.sch'),'utf8'),library=fs.readFileSync(path.join(base,'vna2-cache.lib'),'utf8');
 const children=KiCadBrowserData.sheetFiles(root);assert.deepEqual(children,['transmitter.sch','receiver.sch','filter_bank.sch','power.sch','tx_amp.sch','port_switch.sch','fpga.sch']);
 // The root is byte-for-byte public evidence. Leaf fixtures intentionally contain no further placements.
 const sources={'hw/vna2.sch':root,'hw/vna2-cache.lib':library};for(const child of children)sources['hw/'+child]='EESchema Schematic File Version 2\n$EndSCHEMATC\n';
 const scope=setup('buffer/legacy-vna',sources),opened=await message({...scope,file:'hw/vna2.sch',type:'project'});assert.equal(opened.ok,true,opened.error);assert.equal(opened.result.length,8);assert.equal(KiCadBrowserData.rootSheetPath(opened.result,'hw/transmitter.sch'),'hw/vna2.sch');
 for(const file of opened.result){assert.equal(file.legacyLibraries.length,1);assert.equal(file.legacyLibraries[0].path,'hw/vna2-cache.lib');assert.equal(file.legacyLibraries[0].content,library);assert.equal(file.discoveryWarning,undefined);}
 const count=fixture.fetches.length,child=await message({...scope,file:'hw/transmitter.sch',type:'project'},viewer('schematic-viewer.html?detached=1'));assert.equal(child.ok,true,child.error);assert.deepEqual(child.result.map(f=>f.path),opened.result.map(f=>f.path));assert.equal(fixture.fetches.length,count);assert.equal(fixture.fetches.some(r=>r.url.includes('api.github.com')),false);
});

test('saved hierarchy loads children across folders without crawling unrelated repository directories',async()=>{
 const scope=setup('buffer/reference-first',{
  'design/root.kicad_sch':'(kicad_sch (sheet (property "Sheetfile" "../shared/power.kicad_sch")))',
  'shared/power.kicad_sch':'(kicad_sch)',
  'archive/old/unused.kicad_sch':'(kicad_sch)'
 });
 const tree=fixture.tree;fixture.tree=function(path){if(path.startsWith('archive'))throw Error('Unrelated archive is unavailable');return tree.call(this,path);};
 const opened=await message({...scope,type:'project',file:'design/root.kicad_sch'});
 assert.equal(opened.ok,true,opened.error);assert.deepEqual(opened.result.map(f=>f.path),['design/root.kicad_sch','shared/power.kicad_sch']);
 assert.equal(fixture.session.some(m=>m.action==='directory'&&m.path.startsWith('archive')),false);
 assert.equal(fixture.fetches.length,0);
});

test('direct commit discovery pins the selected full or short commit without default branch fallback',async()=>{
 const scope=setup('launch/commit',{'board.kicad_pcb':'(kicad_pcb)'});fixture.commitSha=SHA;
 for(const ref of [SHA,SHA.slice(0,8)]){const result=await message({type:'repository-detect',repository:scope.repository,ref,source:'https://github.com/'+scope.repository+'/commit/'+ref},viewer('project-launcher.html'));assert.equal(result.ok,true,result.error);assert.equal(result.result.sha,SHA);assert.deepEqual(result.result.projects,['board.kicad_pcb']);}
 assert.equal(fixture.session.some(m=>m.action==='resolve'&&m.ref==='HEAD'),false);
 const wrong=await message({type:'repository-detect',repository:scope.repository,ref:'b'.repeat(8),source:'https://github.com/'+scope.repository+'/commit/'+SHA.slice(0,8)},viewer('project-launcher.html'));assert.equal(wrong.ok,false);
});
test('PR discovery resolves its explicit website head and keeps comparison unavailable rather than inventing base',async()=>{
 const scope=setup('launch/pull',{'board.kicad_pro':'{}'});fixture.pull={repository:scope.repository,pullNumber:4,url:'https://github.com/'+scope.repository+'/pull/4',headRepository:scope.repository,headRef:'feature/power',mergeBase:SHA};
 const request={type:'repository-detect',repository:scope.repository,ref:null,source:'https://github.com/'+scope.repository+'/pull/4'};
 const result=await message(request,viewer('project-launcher.html'));assert.equal(result.ok,true,result.error);assert.equal(result.result.pullNumber,4);assert.equal(result.result.sha,SHA);assert.equal(result.result.base,undefined);assert.match(result.result.warnings.join(' '),/merge-base/);assert.ok(fixture.session.some(m=>m.action==='resolve'&&m.ref==='feature/power'));
 fixture.pull.headRepository='foreign/fork';const fork=await message(request,viewer('project-launcher.html'));assert.equal(fork.ok,false);assert.match(fork.error,/head repository|session|tab/i);
});
test('PR discovery list is restricted to the owned viewer repository',async()=>{
 const scope=setup('launch/list',{'board.kicad_pcb':'(kicad_pcb)'}),sender=viewer('browser-viewer.html?repository='+scope.repository+'&head='+SHA+'&file=board.kicad_pcb');
 const result=await message({type:'revision-pulls',repository:scope.repository},sender);assert.equal(result.ok,true,result.error);assert.equal(result.result.repository,scope.repository);assert.equal(result.result.hasMore,true);
 const reads=fixture.session.length,wrong=await message({type:'revision-pulls',repository:'other/private'},sender);assert.equal(wrong.ok,false);assert.equal(fixture.session.length,reads);
});

test('worker retries a disconnected explicitly invoked repository once after reader recovery, without API fallback',async t=>{
 const scope=setup('recovery/private',{'board.kicad_pcb':'(kicad_pcb)'}),original={get:chrome.tabs.get,create:chrome.tabs.create,scripting:chrome.scripting},url='https://github.com/'+scope.repository;
 let injections=0;
 chrome.tabs.get=async id=>({id,url});chrome.tabs.create=async()=>({id:80});
 chrome.scripting={executeScript:async()=>{injections++;if(injections>1)fixture.sessionError=null;}};
 t.after(()=>{chrome.tabs.get=original.get;chrome.tabs.create=original.create;chrome.scripting=original.scripting;});
 await actionListener({id:51,url});assert.equal(injections,1);
 fixture.sessionError=Error('Receiving end does not exist.');
 const result=await message({...scope,type:'project-file'});
 assert.equal(result.ok,true,result.error);assert.equal(result.result.content,'(kicad_pcb)');
 assert.equal(injections,2);assert.equal(fixture.fetches.length,0);
});
