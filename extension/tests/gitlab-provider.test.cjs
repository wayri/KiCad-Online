'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
global.KiCadBrowserData=require('../browser-data.js');global.KiCadGitHub=require('../parsing.js');
const api=require('../gitlab-provider.js'),sha='a'.repeat(40);
function transport(t,handler){const previous=global.fetch;global.fetch=handler;t.after(()=>global.fetch=previous);}
const json=(value,headers={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json',...headers}});

test('foreground-only GitLab viewing uses the website session and never retries through background fetch',async t=>{
 let fetches=0,reads=0;transport(t,async()=>{fetches++;throw Error('Background access is forbidden');});
 const source=Buffer.from('(kicad_pcb)');
 const foreground=api.forHost('https://gitlab.com',{foregroundOnly:true,sessionRead:async url=>{reads++;assert.ok(url.startsWith('https://gitlab.com/api/v4/projects/org%2Fboard/'));return {bytes:new Uint8Array(source),next:'',link:''};}});
 assert.equal(await foreground.file('org/board','a'.repeat(40),'board.kicad_pcb'),'(kicad_pcb)');
 const missing=api.forHost('https://gitlab.com',{foregroundOnly:true,sessionRead:async()=>null});
 await assert.rejects(missing.file('org/board','main','board.kicad_pcb'),/same signed-in browser profile/);
 const denied=api.forHost('https://gitlab.com',{foregroundOnly:true,sessionRead:async()=>{throw Object.assign(Error('Organization SSO'),{code:'GITLAB_SAML_REQUIRED'});}});
 await assert.rejects(denied.file('org/board','main','board.kicad_pcb'),/SSO|SAML/);
 assert.equal(reads,1);assert.equal(fetches,0);
});
test('GitLab subgroup and slash refs stay encoded on an unauthenticated fixed host',async t=>{
 transport(t,async(url,options)=>{assert.equal(url,'https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Fboard/repository/files/design%2Fboard.kicad_pcb/raw?ref=feature%2Fpcb');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);return new Response('(kicad_pcb)');});
 assert.equal(await api.file('group/subgroup/board','feature/pcb','design/board.kicad_pcb'),'(kicad_pcb)');
 await assert.rejects(api.file('../board','main','board.kicad_pcb'),/Invalid/);await assert.rejects(api.file('group/board','main','../secret'),/Invalid/);await assert.rejects(api.response('https://evil.test/api/v4/projects/x'),/Invalid/);
});
test('GitLab raw source enforces streamed byte limits and reports missing public files',async t=>{
 transport(t,async()=>new Response(null,{status:404}));assert.equal(await api.file('group/board','main','board.kicad_pcb'),null);
 global.fetch=async()=>new Response('123456');await assert.rejects(api.response('https://gitlab.com/api/v4/projects/group%2Fboard',5),/size limit/);
});
test('GitLab inventory pins trees to a SHA, handles pagination and excludes symlinks',async t=>{
 const calls=[];transport(t,async url=>{calls.push(url);if(url.includes('/commits/'))return json({id:sha});const query=new URL(url).searchParams;assert.equal(query.get('ref'),sha);if(query.get('page')==='1')return json([{path:'main.kicad_pro',type:'blob',mode:'100644'},{path:'link.kicad_pcb',type:'blob',mode:'120000'},{path:'../secret.kicad_pcb',type:'blob',mode:'100644'}],{'x-next-page':'2'});return json([{path:'main.kicad_pcb',type:'blob',mode:'100644'}]);});
 const result=await api.inventory('group/sub/board','main','main.kicad_pcb');assert.equal(result.snapshotRef,sha);assert.deepEqual(result.files.map(f=>f.path),['main.kicad_pcb','main.kicad_pro']);assert.equal(calls.length,3);
});
test('GitLab bounded discovery discloses omitted tree pages',async t=>{
 let count=0;transport(t,async url=>{if(url.includes('/commits/'))return json({id:sha});count++;return json([] ,{'x-next-page':String(count+1)});});const result=await api.inventory('group/board','main','main.kicad_pcb');assert.equal(count,10);assert.match(result.warnings.join(' '),/incomplete/);
});
test('GitLab commits and compare use immutable refs with direct comparison',async t=>{
 transport(t,async url=>{if(/\/commits\/main$/.test(url))return json({id:sha});if(/\/commits\/feature%2Fpcb$/.test(url))return json({id:'b'.repeat(40)});if(url.includes('/compare?')){const query=new URL(url).searchParams;assert.equal(query.get('straight'),'true');assert.equal(query.get('from'),sha);assert.equal(query.get('to'),'b'.repeat(40));return json({compare_timeout:false,diffs:[{old_path:'old.kicad_pcb',new_path:'new.kicad_pcb',renamed_file:true},{old_path:'notes.txt',new_path:'notes.txt'}]});}assert.equal(new URL(url).searchParams.get('ref_name'),sha);return json([{id:sha,title:'Change',author_name:'A',authored_date:'2026-01-01'}]);});
 const history=await api.commits('group/board','main','new.kicad_pcb');assert.equal(history.commits[0].sha,sha);
 const comparison=await api.compare('group/board','main','feature/pcb','new.kicad_pcb');assert.equal(comparison.files.length,1);assert.equal(comparison.files[0].status,'renamed');assert.deepEqual(comparison.warnings,[]);
});


test('GitLab modern PCB and schematic sources share the large-source cap; legacy remains bounded', async t => {
  const previous = global.fetch; t.after(() => {global.fetch = previous;});
  global.fetch = async () => new Response('x'.repeat(9 * 1024 * 1024));
  assert.equal((await api.file('group/board', 'main', 'large.kicad_pcb')).length, 9 * 1024 * 1024);
  assert.equal((await api.file('group/board', 'main', 'large.kicad_sch')).length,9*1024*1024);
  await assert.rejects(api.file('group/board', 'main', 'large.sch'), /size limit/);
});

test('GitLab schematic inventory requires a pinned commit and rejects incomplete or excessive discoveries',async t=>{
 await assert.rejects(api.schematics('group/board','main'),/pinned GitLab commit/);
 let pages=0;transport(t,async()=>{pages++;return json([] ,{'x-next-page':String(pages+1)});});
 await assert.rejects(api.schematics('group/board',sha),/incomplete/);assert.equal(pages,10);
 global.fetch=async url=>{const page=Number(new URL(url).searchParams.get('page'));return json(Array.from({length:page===1?100:29},(_,index)=>({path:`sheet${(page-1)*100+index}.kicad_sch`,type:'blob',mode:'100644'})));};
 await assert.rejects(api.schematics('group/board',sha),/More than 128/);
});

test('GitLab limited comparison recovers omitted drawings from immutable complete trees',async t=>{
 const head='b'.repeat(40),blob=id=>id.repeat(40),entry=(path,id,mode='100644')=>({path,id:blob(id),type:'blob',mode});
 const before=[entry('unchanged.kicad_pcb','1'),entry('modified.kicad_pcb','2'),entry('old.kicad_sch','3'),entry('deleted.kicad_sch','4'),entry('edited-old.kicad_sch','5'),entry('becomes-link.kicad_pcb','6')];
 const after=[entry('unchanged.kicad_pcb','1'),entry('modified.kicad_pcb','7'),entry('sub/new.kicad_sch','3'),entry('added.kicad_pcb','8'),entry('edited-new.kicad_sch','9'),entry('becomes-link.kicad_pcb','a','120000')];
 const refs=[];transport(t,async url=>{
  if(url.includes('/commits/'))return json({id:url.endsWith('/main')?sha:head});
  if(url.includes('/compare?'))return json({compare_timeout:true,diffs:[]});
  const query=new URL(url).searchParams;refs.push(query.get('ref'));assert.equal(query.get('recursive'),'true');return json(query.get('ref')===sha?before:after);
 });
 const result=await api.compare('group/sub/board','main','feature','modified.kicad_pcb');
 assert.deepEqual(new Set(refs),new Set([sha,head]));assert.equal(result.base,sha);assert.equal(result.head,head);
 assert.deepEqual(result.files,[
  {file:'added.kicad_pcb',oldFile:'added.kicad_pcb',status:'added'},
  {file:'becomes-link.kicad_pcb',oldFile:'becomes-link.kicad_pcb',status:'removed'},
  {file:'deleted.kicad_sch',oldFile:'deleted.kicad_sch',status:'removed'},
  {file:'edited-new.kicad_sch',oldFile:'edited-new.kicad_sch',status:'added'},
  {file:'edited-old.kicad_sch',oldFile:'edited-old.kicad_sch',status:'removed'},
  {file:'modified.kicad_pcb',oldFile:'modified.kicad_pcb',status:'modified'},
  {file:'sub/new.kicad_sch',oldFile:'old.kicad_sch',status:'renamed'}
 ]);assert.match(result.warnings[0],/complete commit trees/);assert.match(result.warnings[0],/ambiguous moves/);
});

test('GitLab tree fallback does not invent deletions or rename ambiguous duplicates',async t=>{
 const head='b'.repeat(40),entry=path=>({path,id:'1'.repeat(40),type:'blob',mode:'100644'});
 let incomplete=false,invalid=false;transport(t,async url=>{
  if(url.includes('/commits/'))return json({id:url.endsWith('/main')?sha:head});
  if(url.includes('/compare?'))return json({compare_timeout:true,diffs:[]});
  const before=new URL(url).searchParams.get('ref')===sha;
  if(incomplete)return json([] ,{'x-next-page':'2'});
  if(invalid)return json([{...entry('bad.kicad_pcb'),id:'not-a-blob-id'}]);
  return json((before?['a.kicad_sch','b.kicad_sch']:['c.kicad_sch']).map(entry));
 });
 const result=await api.compare('group/board','main','feature','a.kicad_sch');assert.deepEqual(result.files.map(item=>item.status),['removed','removed','added']);
 incomplete=true;await assert.rejects(api.compare('group/board','main','feature','a.kicad_sch'),/repository discovery is incomplete/);
 incomplete=false;invalid=true;await assert.rejects(api.compare('group/board','main','feature','a.kicad_sch'),/Invalid GitLab drawing identity/);
});

test('GitLab normal diff excludes unsafe paths and retains regular-to-symlink removal',async t=>{
 transport(t,async url=>url.includes('/commits/')?json({id:url.endsWith('/main')?sha:'b'.repeat(40)}):json({diffs:[
  {old_path:'regular.kicad_pcb',new_path:'regular.kicad_pcb',a_mode:'100644',b_mode:'120000'},
  {old_path:'C:/secret.kicad_pcb',new_path:'../secret.kicad_pcb'},
  {old_path:'large.kicad_pcb',new_path:'large.kicad_pcb',too_large:true,collapsed:true}
 ]}));
 const result=await api.compare('group/board','main','feature','regular.kicad_pcb');
 assert.deepEqual(result.files,[{file:'regular.kicad_pcb',oldFile:'regular.kicad_pcb',status:'removed'},{file:'large.kicad_pcb',oldFile:'large.kicad_pcb',status:'modified'}]);
});

test('GitLab same immutable revision avoids comparison and tree requests',async t=>{
 let count=0;transport(t,async url=>{assert.match(url,/\/commits\//);count++;return json({id:sha});});
 assert.deepEqual(await api.compare('group/board','main','alias','board.kicad_pcb'),{files:[],base:sha,head:sha,warnings:[]});assert.equal(count,2);
});

test('GitLab merge requests pin merge base and fork head, and reject moving revisions',async t=>{
 const host='https://gitlab.example.org',provider=api.forHost(host),head='b'.repeat(40),start='c'.repeat(40),calls=[];let reads=0,moving=false;
 transport(t,async(url,options)=>{calls.push(url);assert.equal(new URL(url).origin,host);assert.equal(options.redirect,'error');
  if(url.endsWith('/merge_requests/7')){reads++;return json({iid:7,source_project_id:42,target_project_id:21,diff_refs:{base_sha:sha,head_sha:moving&&reads%2===0?'d'.repeat(40):head,start_sha:start}});}
  if(url.endsWith('/projects/42'))return json({id:42,path_with_namespace:'fork/sub/board'});
  const query=new URL(url).searchParams;
  if(url.includes('target%2Fsub%2Fboard')){assert.equal(query.get('ref'),sha);return json([{type:'blob',mode:'100644',path:'old.kicad_sch',id:'1'.repeat(40)}]);}
  assert.ok(url.includes('fork%2Fsub%2Fboard'));assert.equal(query.get('ref'),head);return json([{type:'blob',mode:'100644',path:'sub/new.kicad_sch',id:'1'.repeat(40)}]);
 });
 const result=await provider.mergeRequest('target/sub/board',7);assert.equal(result.base,sha);assert.equal(result.head,head);assert.equal(result.headRepository,'fork/sub/board');assert.equal(result.files[0].status,'renamed');assert.equal(reads,2);
 moving=true;await assert.rejects(provider.mergeRequest('target/sub/board',7),/changed during discovery/);
 const count=calls.length;await assert.rejects(provider.mergeRequest('target/sub/board',0),/Invalid/);assert.equal(calls.length,count);
});

test('GitLab merge requests fail visibly before diff preparation and on truncated trees',async t=>{
 let prepared=false;transport(t,async url=>{
  if(url.includes('/merge_requests/'))return json({iid:1,source_project_id:2,target_project_id:1,diff_refs:prepared?{base_sha:sha,head_sha:'b'.repeat(40),start_sha:sha}:{}});
  if(url.endsWith('/projects/2'))return json({id:2,path_with_namespace:'fork/board'});
  return json([] ,{'x-next-page':'2'});
 });
 await assert.rejects(api.mergeRequest('group/board',1),/wait for diff preparation/);prepared=true;
 await assert.rejects(api.mergeRequest('group/board',1),/discovery is incomplete/);
});

test('GitLab repository tree keeps every safe Git object type, pins scope and exposes directory pagination',async t=>{
 const calls=[];transport(t,async url=>{calls.push(url);if(url.includes('/commits/'))return json({id:sha});const query=new URL(url).searchParams;assert.equal(query.get('ref'),sha);assert.equal(query.get('recursive'),'false');assert.equal(query.get('path'),'design');assert.equal(query.get('page'),'2');return json([{path:'design/sub',type:'tree',mode:'040000',id:'b'.repeat(40)},{path:'design/board.kicad_pcb',type:'blob',mode:'100644',id:'c'.repeat(40)},{path:'design/link',type:'blob',mode:'120000',id:'d'.repeat(40)},{path:'design/module',type:'commit',mode:'160000',id:'e'.repeat(40)},{path:'other/escape',type:'blob',mode:'100644',id:'f'.repeat(40)}],{'x-next-page':'3'});});
 const result=await api.repositoryTree('group/sub/board','feature/pcb',{directory:'design',page:2});assert.equal(result.sha,sha);assert.equal(result.directory,'design');assert.equal(result.entries.length,4);assert.deepEqual(result.entries.map(n=>n.type),['tree','blob','blob','commit']);assert.equal(result.hasMore,true);assert.equal(result.nextPage,3);assert.equal(result.truncated,true);assert.match(result.warnings.join(' '),/omitted/);assert.match(calls[0],/commits\/feature%2Fpcb$/);
});
test('GitLab repository history has actual merge parents and bounded full messages without a file filter',async t=>{
 const urls=[];transport(t,async url=>{urls.push(url);if(url.includes('/commits/'))return json({id:sha});const query=new URL(url).searchParams;assert.equal(query.get('ref_name'),sha);assert.equal(query.has('path'),false);assert.equal(query.get('per_page'),'30');assert.equal(query.get('page'),'3');return json([{id:'b'.repeat(40),parent_ids:['c'.repeat(40),'d'.repeat(40)],message:'Merge branch\n\nDetails\n'+('界'.repeat(4000)),author_name:'Name',authored_date:'2026-10-25T00:00:00Z'}],{'x-next-page':'4'});});
 const history=await api.repositoryHistory('group/board','main',3);assert.equal(history.snapshotRef,sha);assert.equal(history.nextPage,4);assert.deepEqual(history.commits[0].parents,['c'.repeat(40),'d'.repeat(40)]);assert.match(history.commits[0].message,/Merge branch\n\nDetails/);assert.ok(new TextEncoder().encode(history.commits[0].message).length<=8192);assert.match(history.warnings.join(' '),/8 KiB/);assert.equal(history.commits[0].url,'https://gitlab.com/group/board/-/commit/'+'b'.repeat(40));
});
test('GitLab repository metadata never consults account credentials',async t=>{
 const old=global.KiCadGitLabReviewApi;global.KiCadGitLabReviewApi=new Proxy({}, {get(){throw Error('Account credentials must not be read');}});t.after(()=>global.KiCadGitLabReviewApi=old);transport(t,async(url,init)=>{assert.equal(new URL(url).origin,'https://gitlab.example.org');assert.equal(init.headers,undefined);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return json([{id:sha,parent_ids:[],message:'Root',author_name:'A',authored_date:'2026-01-01'}]);});
 const result=await api.forHost('https://gitlab.example.org').repositoryHistory('group/board',sha);assert.equal(JSON.stringify(result).includes('private-fixture'),false);assert.equal(result.commits[0].url,'https://gitlab.example.org/group/board/-/commit/'+sha);
});
test('GitLab repository metadata validates scope and pages before sending any request',async t=>{
 let reads=0;transport(t,async()=>{reads++;return json([]);});for(const fn of [()=>api.repositoryTree('../bad',sha),()=>api.repositoryHistory('group/board','bad\n'),()=>api.repositoryTree('group/board',sha,{directory:'../escape'}),()=>api.repositoryTree('group/board',sha,{page:101}),()=>api.repositoryHistory('group/board',sha,'2')])await assert.rejects(fn,/Invalid|page/);assert.equal(reads,0);
});
test('GitLab rejects malformed parent IDs and discloses final-page caps',async t=>{
 transport(t,async url=>new URL(url).pathname.endsWith('/tree')?json([] ,{'x-next-page':'101'}):json([{id:sha,parent_ids:['not-a-sha'],message:'Invalid'}]));await assert.rejects(api.repositoryHistory('group/board',sha),/parents/);const tree=await api.repositoryTree('group/board',sha,{page:100});assert.equal(tree.hasMore,false);assert.equal(tree.truncated,true);assert.match(tree.warnings.join(' '),/10,000/);
});

test('GitLab repository branch discovery has no drawing requirement and preserves encoded branch names',async t=>{
 transport(t,async url=>{assert.match(url,/\/branches\?per_page=100&page=1$/);return json([{name:'feature/board',commit:{id:sha}}]);});const result=await api.repositoryBranches('group/sub/board',sha);assert.equal(result.branches[0].name,'feature/board');await assert.rejects(api.repositoryBranches('group/sub/board','bad\n'),/Invalid/);
});
test('GitLab operation cancellation aborts streamed bodies and prevents hierarchy reads after Stop',async t=>{
 let cancelled=0,reads=0;const controller=new AbortController();transport(t,async()=>{reads++;return new Response(new ReadableStream({start(){},cancel(){cancelled++;}}));});
 const scoped=api.forHost('https://gitlab.com',{signal:controller.signal});const pending=scoped.resolve('group/board','main','board.kicad_sch');await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(cancelled,1);
 await assert.rejects(scoped.file('group/board',sha,'child.kicad_sch'),/cancelled/);assert.equal(reads,1);
});


test('private GitLab content uses the matching website session before anonymous requests, without account lookup',async t=>{
 const readerModule=require('../gitlab-session-reader.js'),host='https://gitlab.example.org',repository='org/sub/private';
 const old=global.KiCadGitLabReviewApi;global.KiCadGitLabReviewApi=new Proxy({},{get(){throw Error('Vault must never be consulted');}});t.after(()=>global.KiCadGitLabReviewApi=old);
 let publicReads=0,sessionReads=0;transport(t,async()=>{publicReads++;return new Response(null,{status:401});});
 const reader=readerModule.create({location:{href:host+'/'+repository+'/-/tree/main'},fetch:async(url,init)=>{
  sessionReads++;assert.equal(init.credentials,'same-origin');assert.equal(init.headers,undefined);
  if(url.includes('/files/'))return new Response('(kicad_pcb)');
  if(url.includes('/commits/'))return json({id:sha});
  if(url.includes('/branches?'))return json([{name:'main',commit:{id:sha}}]);
  if(url.includes('/commits?'))return json([{id:sha,parent_ids:[],message:'Saved',author_name:'A'}]);
  return json([{path:'main.kicad_pcb',type:'blob',mode:'100644',id:'b'.repeat(40)}]);
 }});
 const scoped=api.forHost(host,{sessionRead:async(url,limit)=>{const result=await reader.read({host,repository,url,limit});return {...result,bytes:Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0))};}});
 assert.equal(await scoped.file(repository,sha,'main.kicad_pcb'),'(kicad_pcb)');
 assert.equal((await scoped.inventory(repository,'main','main.kicad_pcb')).files.length,1);
 assert.equal((await scoped.repositoryHistory(repository,sha)).commits.length,1);
 assert.equal((await scoped.repositoryBranches(repository,sha)).branches.length,1);
 assert.equal((await scoped.modelIndex(repository,sha)).paths.length,0);
 assert.ok(sessionReads>=6);assert.equal(publicReads,0);
});

test('GitLab public reads work without a matching website tab and never send authorization headers',async t=>{
 let calls=0;transport(t,async(url,init)=>{calls++;assert.equal(init.credentials,'omit');assert.equal(init.headers,undefined);return new Response('(kicad_pcb)');});
 assert.equal(await api.forHost('https://gitlab.com',{sessionRead:async()=>null}).file('group/board',sha,'main.kicad_pcb'),'(kicad_pcb)');assert.equal(calls,1);
});

test('GitLab content endpoints reject credentials, foreign projects paths and revision/size abuse before transport',async t=>{
 let calls=0;transport(t,async()=>{calls++;return json([]);});const scoped=api.forHost('https://gitlab.com',{sessionRead:async()=>{calls++;return null;}}),base='https://gitlab.com/api/v4/projects/group%2Fboard';
 for(const [url,limit]of [[base+'/issues',1024],[base+'/repository/tree?private_token=secret',1024],[base+'/repository/tree?ref=a&ref=b',1024],[base+'/repository/tree?ref='+('a'.repeat(201)),1024],[base+'/repository/files/..%2Fsecret/raw?ref=main',1024],[base,257*1024*1024],[base,1.5],['https://evil.test/api/v4/projects/group%2Fboard',1024]])await assert.rejects(scoped.response(url,limit));
 assert.equal(calls,0);
});

test('GitLab policy is enforced before and after session reads without anonymous policy bypass',async t=>{
 const old=global.KiCadManagedPolicy;t.after(()=>global.KiCadManagedPolicy=old);let reads=0,allow=false;
 global.KiCadManagedPolicy={assertNetwork:async()=>{if(!allow)throw Object.assign(Error('Network disabled by policy'),{code:'MANAGED_POLICY'});}};
 transport(t,async()=>{reads++;return json([]);});const scoped=api.forHost('https://gitlab.com',{sessionRead:async()=>{reads++;allow=false;return {bytes:new TextEncoder().encode('[]'),next:'',link:''};}});
 await assert.rejects(scoped.response('https://gitlab.com/api/v4/projects/group%2Fboard'),{code:'MANAGED_POLICY'});assert.equal(reads,0);
 allow=true;await assert.rejects(scoped.response('https://gitlab.com/api/v4/projects/group%2Fboard'),{code:'MANAGED_POLICY'});assert.equal(reads,1);
});

test('GitLab session SAML denial stays explicit without an anonymous retry',async t=>{
 let fetches=0;transport(t,async()=>{fetches++;return json({});});const scoped=api.forHost('https://gitlab.com',{sessionRead:async()=>{throw Object.assign(Error('sensitive website payload'),{code:'GITLAB_SAML_REQUIRED'});}});
 await assert.rejects(scoped.file('group/board',sha,'main.kicad_pcb'),error=>error.code==='GITLAB_SAML_REQUIRED'&&/SSO\/SAML/.test(error.message)&&!error.message.includes('sensitive'));assert.equal(fetches,0);
});

test('GitLab rejects disguised HTML drawings and models, while allowing inert saved HTML reports',async t=>{
 transport(t,async()=>new Response('<!doctype html><html><body>Report</body></html>',{headers:{'content-type':'application/octet-stream'}}));
 for(const path of ['main.kicad_pcb','part.wrl'])await assert.rejects(api.file('group/board',sha,path),{code:'GITLAB_UNEXPECTED_HTML'});
 assert.match(await api.file('group/board',sha,'report.html'),/Report/);
});

test('GitLab rejects oversized session responses and mismatched immutable commits',async t=>{
 let calls=0;transport(t,async()=>{calls++;return json({id:'b'.repeat(40)});});
 const scoped=api.forHost('https://gitlab.com',{sessionRead:async()=>({bytes:new Uint8Array(6),next:'',link:''})});
 await assert.rejects(scoped.response('https://gitlab.com/api/v4/projects/group%2Fboard',5),/oversized/);assert.equal(calls,0);
 await assert.rejects(api.resolve('group/board',sha,'main.kicad_pcb'),/requested immutable/);
});

test('GitLab Stop releases a stalled session callback without making a public request',async t=>{
 let calls=0;transport(t,async()=>{calls++;return json([]);});const controller=new AbortController(),scoped=api.forHost('https://gitlab.com',{signal:controller.signal,sessionRead:()=>new Promise(()=>{})});
 const pending=scoped.file('group/board',sha,'main.kicad_pcb');await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(calls,0);
});
