const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ORIGIN='chrome-extension://test/',HOST='https://gitlab.example.org',SHA='a'.repeat(40),TOKEN='glpat_private_fixture_1234567890';
function harness(responder){
 const local=new Map(),session=new Map(),granted=new Set(),scripts=new Map(),calls=[],websiteCalls=[],websiteTabs=[{id:71,url:HOST+'/group/private'},{id:72,url:'https://gitlab.com/group/private'}];let listener;
 const area=map=>({get:async key=>({[key]:map.get(key)}),set:async data=>{for(const [k,v]of Object.entries(data))map.set(k,v);},remove:async keys=>{for(const k of [].concat(keys))map.delete(k);},setAccessLevel:async()=>{}});
 const chrome={runtime:{id:'test',getURL:p=>ORIGIN+p,onMessage:{addListener:fn=>listener=fn},openOptionsPage:async()=>{}},action:{onClicked:{addListener(){}}},storage:{local:area(local),session:area(session)},
 permissions:{contains:async({origins})=>origins.every(o=>granted.has(o)),remove:async({origins})=>{origins.forEach(o=>granted.delete(o));}},
 scripting:{getRegisteredContentScripts:async({ids})=>ids.flatMap(id=>scripts.has(id)?[scripts.get(id)]:[]),registerContentScripts:async rows=>rows.forEach(r=>scripts.set(r.id,r)),unregisterContentScripts:async({ids})=>ids.forEach(id=>scripts.delete(id))}};
 const respond=async(url,init={})=>{const path=new URL(url).pathname;
  const custom=responder?.(url,init);if(custom)return custom;
  if(path.includes('/commits/'))return new Response(JSON.stringify({id:SHA}));
  if(path.endsWith('/raw'))return new Response('(kicad_pcb (version 20240108))');
  if(path.endsWith('/tree'))return new Response('[]');
  if(path.endsWith('/api/v4/user'))return new Response(JSON.stringify({id:42,username:'reviewer'}));
  if(path.includes('/repository/files/.kicad-review-policy.json'))return new Response(null,{status:404});
  if(path.endsWith('/issues')&&init.method==='POST')return new Response(JSON.stringify({iid:9}));
  return new Response(JSON.stringify({id:1,path_with_namespace:'group/private',default_branch:'main'}));
 };
 chrome.tabs={query:async()=>websiteTabs,sendMessage:async(id,message,options)=>{assert.equal(options.frameId,0);const tab=websiteTabs.find(t=>t.id===id);assert.ok(tab,'Selected website tab must exist');assert.equal(message.type,'gitlab-session-read');const reader=require('../gitlab-session-reader.js').create({location:{href:tab.url},fetch:async(url,init)=>{websiteCalls.push({url,init});assert.equal(init.credentials,'same-origin');assert.equal(init.headers,undefined,'Website reads must not receive review-account headers');return respond(url,init);}});return {ok:true,result:await reader.read(message)};}};
 const ctx=vm.createContext({chrome,URL,URLSearchParams,TextEncoder,TextDecoder,crypto:require('node:crypto').webcrypto,AbortController,setTimeout,clearTimeout,btoa,atob,fetch:async(url,init)=>{const path=new URL(url).pathname;if(/\/repository\/(?:tree|commits|compare|files)\b|\/merge_requests\//.test(path)&&!init?.headers?.Authorization)throw Error('Project content attempted forbidden background fetch: '+url);calls.push({url,init});return respond(url,init);}});
 ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),ctx));
 vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),ctx);
 const options={id:'test',url:ORIGIN+'options.html'},viewer={id:'test',url:ORIGIN+'pcb-viewer.html'};
 const send=(message,sender=viewer)=>new Promise(resolve=>{if(!listener(message,sender,resolve))resolve({ignored:true});});
 const add=async()=>{assert.equal((await send({type:'gitlab-host-add',provider:'gitlab',host:HOST},options)).ok,true);};
 return{send,add,options,viewer,ctx,calls,websiteCalls,websiteTabs,local,session,granted,scripts};
}
test('self-hosted previews require explicit host configuration, without persistent site permission',async()=>{
 const h=harness(),request={type:'project',provider:'gitlab',host:HOST,repository:'group/private',ref:'main',file:'board.kicad_pcb'};
 assert.equal((await h.send(request)).ok,false);assert.equal(h.calls.length,0);
 await h.add();assert.equal(h.granted.size,0);assert.equal(h.scripts.size,0);assert.equal((await h.send(request)).ok,true);
 const before=h.calls.length;
 assert.equal((await h.send(request,{id:'test',url:'https://evil.example.org/group/private/-/blob/main/board.kicad_pcb'})).ok,false);
 assert.equal(h.calls.length,before);
 assert.equal((await h.send(request,{id:'test',url:HOST+'/group/private/-/blob/main/board.kicad_pcb'})).ok,true);
});

test('approved self-hosted private projects read a pinned hierarchy through the existing website session',async()=>{
 const h=harness(()=>new Response(null,{status:404}));await h.add();
 assert.equal(h.scripts.size,0);assert.equal(h.granted.size,0);
 const requests=[],repo='group/sub/private',sources={'design/main.kicad_sch':'(kicad_sch (sheet (property "Sheetfile" "../shared/leaf.kicad_sch")))','shared/leaf.kicad_sch':'(kicad_sch)'};
 const reader=require('../gitlab-session-reader.js').create({location:{href:HOST+'/'+repo+'/-/blob/main/design/main.kicad_sch'},fetch:async(url,init)=>{
  requests.push({url,init});const parsed=new URL(url);assert.equal(init.credentials,'same-origin');assert.equal(init.headers,undefined);
  if(parsed.pathname.includes('/commits/'))return new Response(JSON.stringify({id:SHA}));
  assert.equal(parsed.searchParams.get('ref'),SHA);
  if(parsed.pathname.endsWith('/tree'))return new Response(JSON.stringify(Object.keys(sources).map(path=>({path,type:'blob',mode:'100644'}))));
  const path=decodeURIComponent(parsed.pathname.split('/files/')[1].replace(/\/raw$/,''));return new Response(sources[path]);
 }});
 h.ctx.chrome.tabs={query:async()=>[{id:19,url:HOST+'/'+repo+'/-/blob/main/design/main.kicad_sch'}],sendMessage:async(id,message,options)=>{assert.equal(options.frameId,0);return {ok:true,result:await reader.read(message)};}};
 const result=await h.send({type:'project',provider:'gitlab',host:HOST,repository:repo,ref:'feature/board',file:'shared/leaf.kicad_sch'});
 assert.equal(result.ok,true,result.error);assert.deepEqual(Array.from(result.result,row=>row.path),['design/main.kicad_sch','shared/leaf.kicad_sch']);
 assert.ok(requests.length>=4);assert.equal(h.calls.length,0,'Private project content must use the matching website session before public fallback');
});

test('GitLab session reads cannot use another project or a removed configured host',async()=>{
 const h=harness(()=>new Response(null,{status:404}));await h.add();let bridgeCalls=0;
 h.ctx.chrome.tabs={query:async()=>[{id:1,url:HOST+'/group/private-evil/-/blob/main/board.kicad_pcb'}],sendMessage:async()=>{bridgeCalls++;return null;}};
 const input={type:'project',provider:'gitlab',host:HOST,repository:'group/private',ref:'main',file:'board.kicad_pcb'};
 assert.equal((await h.send(input)).ok,false);assert.equal(bridgeCalls,0);
 h.ctx.chrome.tabs.query=async()=>[{id:1,url:HOST+'/group/private/-/blob/main/board.kicad_pcb'}];
 h.ctx.chrome.tabs.sendMessage=async()=>{h.local.set('gitlab-approved-hosts-v1',[]);return {ok:true,result:{base64:btoa(JSON.stringify({id:SHA})),next:'',link:''}};};
 h.calls.length=0;const result=await h.send(input);assert.equal(result.ok,false);assert.match(result.error,/permission.*removed|host.*removed/);assert.equal(h.calls.length,0,'Removed host must not trigger anonymous fallback');assert.equal((await h.send(input)).ok,false);assert.equal(h.calls.length,0);
});

test('GitLab session fallback retains binary model bytes and denies malformed bridge payloads',async()=>{
 const h=harness(()=>new Response(null,{status:404}));await h.add();
 const bytes=Uint8Array.from([103,108,84,70,0,255,128]);
 h.ctx.chrome.tabs={query:async()=>[{id:1,url:HOST+'/group/private/-/blob/main/board.kicad_pcb'}],sendMessage:async()=>({ok:true,result:{base64:Buffer.from(bytes).toString('base64'),next:'',link:''}})};
 const input={type:'repo-asset',provider:'gitlab',host:HOST,repository:'group/private',ref:SHA,file:'models/part.glb'};
 const result=await h.send(input);assert.equal(result.ok,true,result.error);assert.equal(result.result.base64,Buffer.from(bytes).toString('base64'));
 h.ctx.chrome.tabs.sendMessage=async()=>({ok:true,result:{base64:'not base64!',next:'',link:''}});
 const malformed=await h.send(input);assert.equal(malformed.ok,false);assert.equal(malformed.result,undefined);assert.match(malformed.error,/Invalid GitLab session response/);assert.equal(h.calls.length,0,'Malformed bridge data must not trigger anonymous fallback');
});

test('private GitLab MR comparisons use matching target and fork session tabs at immutable revisions',async()=>{
 const h=harness(()=>new Response(null,{status:404}));await h.add();
 const base='b'.repeat(40),head='a'.repeat(40),start='c'.repeat(40),seen=[];
 h.ctx.chrome.tabs={query:async()=>[{id:1,url:HOST+'/group/private/-/merge_requests/7/diffs'},{id:2,url:HOST+'/group/fork/-/blob/main/board.kicad_pcb'}],sendMessage:async(id,message)=>{
  seen.push({id,message});
  const reader=require('../gitlab-session-reader.js').create({location:{href:HOST+'/'+message.repository+'/-/blob/main/board.kicad_pcb'},fetch:async(url)=>{
   const parsed=new URL(url);
   if(parsed.pathname.endsWith('/merge_requests/7'))return new Response(JSON.stringify({iid:7,source_project_id:2,target_project_id:1,diff_refs:{base_sha:base,head_sha:head,start_sha:start}}));
   if(parsed.pathname.endsWith('/projects/2'))return new Response(JSON.stringify({id:2,path_with_namespace:'group/fork'}));
   assert.ok(parsed.pathname.endsWith('/tree'));const ref=parsed.searchParams.get('ref');assert.ok([base,head].includes(ref));
   return new Response(JSON.stringify([{path:'board.kicad_pcb',type:'blob',mode:'100644',id:ref}]));
  }});return {ok:true,result:await reader.read(message)};
 }};
 const result=await h.send({type:'gitlab-merge-request',provider:'gitlab',host:HOST,repository:'group/private',number:7});
 assert.equal(result.ok,true,result.error);assert.equal(result.result.base,base);assert.equal(result.result.head,head);assert.equal(result.result.headRepository,'group/fork');assert.equal(result.result.files[0].status,'modified');
 assert.ok(seen.some(row=>row.id===2&&row.message.repository==='group/fork'));assert.ok(seen.filter(row=>row.message.url.includes('/projects/2')).every(row=>row.id===1));
});

test('GitLab session API retains pagination and pinned history for the shared revision controls',async()=>{
 const h=harness(()=>new Response(null,{status:404}));await h.add();const pages=[];
 const reader=require('../gitlab-session-reader.js').create({location:{href:HOST+'/group/private/-/blob/main/board.kicad_pcb'},fetch:async(url)=>{
  const parsed=new URL(url);
  if(parsed.pathname.includes('/commits/'))return new Response(JSON.stringify({id:SHA}));
  if(parsed.pathname.endsWith('/commits')){assert.equal(parsed.searchParams.get('ref_name'),SHA);return new Response(JSON.stringify([{id:SHA,title:'Board update',author_name:'reviewer',authored_date:'2026-10-12T00:00:00Z'}]));}
  assert.equal(parsed.searchParams.get('ref'),SHA);const page=parsed.searchParams.get('page');pages.push(page);
  const rows=page==='1'?Array.from({length:100},(_,i)=>({path:'board'+i+'.kicad_pcb',type:'blob',mode:'100644'})):[{path:'final.kicad_pcb',type:'blob',mode:'100644'}];
  return new Response(JSON.stringify(rows),{headers:page==='1'?{'x-next-page':'2'}:{}});
 }});
 h.ctx.chrome.tabs={query:async()=>[{id:1,url:HOST+'/group/private/-/blob/main/board.kicad_pcb'}],sendMessage:async(id,message)=>({ok:true,result:await reader.read(message)})};
 const input={provider:'gitlab',host:HOST,repository:'group/private',ref:'main',file:'board.kicad_pcb'};
 const inventory=await h.send({...input,type:'project-inventory'});assert.equal(inventory.ok,true,inventory.error);assert.equal(inventory.result.snapshotRef,SHA);assert.equal(inventory.result.files.length,101);assert.deepEqual(pages,['1','2']);
 const history=await h.send({...input,type:'revision-commits'});assert.equal(history.ok,true,history.error);assert.equal(history.result.snapshotRef,SHA);assert.equal(history.result.commits[0].sha,SHA);
});

test('previously registered self-hosted preview scripts are retired instead of retaining persistent access',async()=>{
 const h=harness(),id='kicad-gitlab-'+Array.from(HOST,c=>c.charCodeAt(0).toString(16)).join('');
 h.scripts.set(id,{id,js:['parsing.js','content.js'],matches:[HOST+'/*']});
 await h.add();assert.equal(h.scripts.size,0);assert.equal(h.granted.size,0);
 assert.equal((await h.send({type:'gitlab-host-list',provider:'gitlab'},h.options)).ok,true);
});

test('content reads never use connected review credentials and pages cannot set credentials',async()=>{
 const h=harness();await h.add();
 const settings={provider:'gitlab',host:HOST,type:'gitlab-auth-set',token:TOKEN};
 assert.equal((await h.send(settings,{id:'test',url:HOST+'/group/private'})).ok,false);
 assert.equal((await h.send(settings,h.options)).ok,true);
 h.calls.length=0;h.ctx.KiCadGitLabReviewApi.authorizationHeaders=()=>{throw Error('Content must not consult account credentials');};
 const project=await h.send({type:'project',provider:'gitlab',host:HOST,repository:'group/private',ref:'main',file:'board.kicad_pcb'});
 assert.equal(project.ok,true,project.error);assert.equal(h.calls.length,0);assert.ok(h.websiteCalls.length>0);assert.ok(h.websiteCalls.every(c=>new URL(c.url).origin===HOST&&!c.init.headers?.Authorization&&!c.init.headers?.['PRIVATE-TOKEN']));
 assert.equal(JSON.stringify([...h.session]).includes(TOKEN),false);assert.equal(JSON.stringify(project).includes(TOKEN),false);
 h.calls.length=0;h.websiteCalls.length=0;
 await h.send({type:'project',provider:'gitlab',repository:'group/private',ref:'main',file:'board.kicad_pcb'});
 assert.equal(h.calls.length,0);assert.ok(h.websiteCalls.length>0);assert.ok(h.websiteCalls.every(c=>new URL(c.url).origin==='https://gitlab.com'&&!c.init.headers?.Authorization));
});

test('self-hosted limited comparison recovers drawings without account headers',async()=>{
 const head='b'.repeat(40);
 const h=harness((url,init)=>{
  const parsed=new URL(url);
  if(parsed.pathname.includes('/commits/'))return new Response(JSON.stringify({id:parsed.pathname.endsWith('/main')?SHA:head}));
  if(parsed.pathname.endsWith('/compare'))return new Response(JSON.stringify({compare_timeout:true,diffs:[]}));
  if(parsed.pathname.endsWith('/tree'))return new Response(JSON.stringify([{path:'sub/board.kicad_pcb',mode:'100644',type:'blob',id:parsed.searchParams.get('ref')===SHA?'1'.repeat(40):'2'.repeat(40)}]));
 });
 await h.add();await h.send({provider:'gitlab',host:HOST,type:'gitlab-auth-set',token:TOKEN},h.options);h.calls.length=0;
 const result=await h.send({type:'design-changes',provider:'gitlab',host:HOST,repository:'group/private',base:'main',head:'feature',file:'sub/board.kicad_pcb'});
 assert.equal(result.ok,true,result.error);assert.deepEqual(JSON.parse(JSON.stringify(result.result.files)),[{file:'sub/board.kicad_pcb',oldFile:'sub/board.kicad_pcb',status:'modified'}]);
 assert.match(result.result.warnings[0],/complete commit trees/);
 assert.equal(h.calls.length,0);assert.equal(h.websiteCalls.filter(c=>new URL(c.url).pathname.endsWith('/tree')).length,2);
 assert.ok(h.websiteCalls.every(c=>new URL(c.url).origin===HOST&&!c.init.headers?.Authorization&&!c.init.headers?.['PRIVATE-TOKEN']&&c.init.redirect==='error'&&c.init.method==='GET'));
 assert.equal(JSON.stringify(result).includes(TOKEN),false);
});

test('GitLab merge-request host routes bind the page and isolate fork reads without account headers',async()=>{
 const head='b'.repeat(40),h=harness(url=>{
  const p=new URL(url);
  if(p.pathname.endsWith('/merge_requests/7'))return new Response(JSON.stringify({iid:7,source_project_id:42,target_project_id:21,diff_refs:{base_sha:SHA,head_sha:head,start_sha:SHA}}));
  if(p.pathname.endsWith('/projects/42'))return new Response(JSON.stringify({id:42,path_with_namespace:'fork/private'}));
  if(p.pathname.endsWith('/tree'))return new Response(JSON.stringify([{path:'board.kicad_pcb',mode:'100644',type:'blob',id:p.searchParams.get('ref')===SHA?'1'.repeat(40):'2'.repeat(40)}]));
 });
 await h.add();await h.send({provider:'gitlab',host:HOST,type:'gitlab-auth-set',token:TOKEN},h.options);h.calls.length=0;
 const request={type:'gitlab-merge-request',provider:'gitlab',host:HOST,repository:'group/private',number:7};
 h.websiteTabs.push({id:73,url:HOST+'/fork/private/-/blob/main/board.kicad_pcb'});
 const page={id:'test',url:HOST+'/group/private/-/merge_requests/7/diffs'};
 const result=await h.send(request,page);assert.equal(result.ok,true,result.error);assert.equal(result.result.headRepository,'fork/private');
 assert.equal(h.calls.length,0);assert.ok(h.websiteCalls.length>0);assert.ok(h.websiteCalls.every(c=>new URL(c.url).origin===HOST&&!c.init.headers?.Authorization&&!c.init.headers?.['PRIVATE-TOKEN']&&c.init.redirect==='error'));
 const count=h.websiteCalls.length;assert.equal((await h.send({...request,number:8},page)).ok,false);assert.equal((await h.send({...request,repository:'other/private'},page)).ok,false);assert.equal(h.websiteCalls.length,count);assert.equal(h.calls.length,0);
 assert.equal(JSON.stringify(result).includes(TOKEN),false);
});
test('issue publishing routes through GitLab policy and removing a host purges registration and credentials',async()=>{
 const h=harness();await h.add();await h.send({provider:'gitlab',host:HOST,type:'gitlab-auth-set',token:TOKEN},h.options);
 const comment={id:'private-note',text:'Review U1 clearance',createdAt:'2026-10-04T01:00:00Z',threadType:'issue',anchor:{provider:'gitlab',host:HOST,repository:'group/private',ref:SHA,file:'board.kicad_pcb'}};
 const result=await h.send({type:'comment-publish',provider:'gitlab',host:HOST,comment,destination:'new-issue',title:'Clearance review'});
 assert.equal(result.ok,true,result.error);assert.equal(result.result.remoteRef.url,HOST+'/group/private/-/issues/9');
 const post=h.calls.find(c=>c.init.method==='POST');assert.ok(JSON.parse(post.init.body).description.startsWith(comment.text));assert.ok(JSON.parse(post.init.body).description.includes('<details><summary>Design context'));
 assert.equal((await h.send({type:'gitlab-host-remove',provider:'gitlab',host:HOST},h.options)).ok,true);
 assert.equal(h.scripts.size,0);assert.equal(h.granted.size,0);
 const vault=h.session.get('gitlab-review-vault-v1')||{};assert.equal(vault[HOST],undefined);
 assert.equal((await h.send({type:'project',provider:'gitlab',host:HOST,repository:'group/private',ref:SHA,file:'board.kicad_pcb'})).ok,false);
});
test('self-hosted URL parsing is opt-in and preserves host across viewer revisions',()=>{
 const parser=require('../parsing.js'),url=HOST+'/group/sub/project/-/blob/feature/pcb/design/board.kicad_pcb';
 assert.equal(parser.route(url),null);
 const route=parser.route(url,{gitlabHosts:[HOST]});assert.equal(route.host,HOST);
 const request=parser.blobRequest(route,{repository:'group/sub/project',file:'design/board.kicad_pcb',head:'feature/pcb'});
 assert.equal(request.host,HOST);assert.equal(parser.viewerParams(request).get('host'),HOST);
 assert.equal(parser.route('http://gitlab.example.org/group/sub/project/-/blob/main/board.kicad_pcb',{gitlabHosts:[HOST]}),null);
});
test('GitLab readback attaches trusted remote provenance and filters other hosts',async()=>{
 const comments=require('../review-comments.js');
 const note={id:'readback-note',text:'Check clearance',createdAt:'2026-10-04T01:00:00Z',anchor:{provider:'gitlab',host:HOST,repository:'group/private',ref:SHA,file:'board.kicad_pcb'}};
 const marker=comments.toMarkdown(note),other=comments.toMarkdown({...note,id:'other-host',anchor:{...note.anchor,host:'https://gitlab.com'}});
 const h=harness(()=>{throw Error('Readback must use the separate review-account readThread boundary');});
 h.ctx.KiCadGitLabReviewApi.readThread=async scope=>{assert.equal(scope.host,HOST);assert.equal(scope.repository,'group/private');assert.equal(scope.number,9);assert.equal(scope.includeCapabilities,false);return {host:HOST,repository:'group/private',number:9,projectId:19,body:'',state:'open',comments:[{id:71,body:marker+'\n'+other,author:'reviewer'}],warnings:[]};};
 await h.add();const result=await h.send({type:'comment-remote-list',provider:'gitlab',host:HOST,repository:'group/private',ref:SHA,file:'board.kicad_pcb',issueNumber:9});
 assert.equal(result.ok,true);assert.equal(result.result.notes.length,1);
 assert.equal(result.result.notes[0].github.url,HOST+'/group/private/-/issues/9#note_71');
 assert.equal(result.result.notes[0].github.provider,'gitlab');assert.equal(h.calls.length,0);
});

test('GitLab readback retains matching upload metadata and omits images from another project',async()=>{
 const comments=require('../review-comments.js'),attachment={provider:'gitlab',host:HOST,repository:'group/private',projectId:19,mime:'image/png',url:HOST+'/-/project/19/uploads/'+'a'.repeat(32)+'/kicad-review-'+'b'.repeat(20)+'.png',width:1,height:1};
 const note={id:'capture-readback',text:'Check clearance',createdAt:'2026-10-04T01:00:00Z',anchor:{provider:'gitlab',host:HOST,repository:'group/private',ref:SHA,file:'board.kicad_pcb'},attachments:[attachment]};
 const bad={...note,id:'foreign-image',attachments:[{...attachment,projectId:20,url:attachment.url.replace('/project/19/','/project/20/')}]};
 const h=harness(()=>{throw Error('Readback must use the separate review-account readThread boundary');});
 h.ctx.KiCadGitLabReviewApi.readThread=async scope=>{assert.equal(scope.host,HOST);assert.equal(scope.repository,'group/private');assert.equal(scope.number,9);return {host:HOST,repository:'group/private',number:9,projectId:19,body:'',state:'open',comments:[{id:71,body:comments.toMarkdown(note),author:'reviewer'},{id:72,body:comments.toMarkdown(bad)}],warnings:[]};};
 await h.add();const result=await h.send({type:'comment-remote-list',provider:'gitlab',host:HOST,repository:'group/private',ref:SHA,file:'board.kicad_pcb',issueNumber:9});assert.equal(result.ok,true);assert.equal(result.result.notes.length,2);assert.deepEqual(JSON.parse(JSON.stringify(result.result.notes[0].attachments)),[attachment]);assert.equal(result.result.notes[1].attachments,undefined);assert.match(result.result.warnings.join(' '),/omitted/);
});

 test('mention lookup is viewer-only, authenticated and restricted to the approved GitLab host',async()=>{
 const h=harness(url=>new URL(url).pathname.endsWith('/members/all')?new Response(JSON.stringify([{username:'team_user',name:'Team reviewer'}])):null);await h.add();
 const query={type:'comment-mention-users',provider:'gitlab',host:HOST,repository:'group/private',source:'repository',query:'team'};
 assert.equal((await h.send(query)).ok,false);assert.equal((await h.send(query,{id:'test',url:HOST+'/group/private/-/blob/main/board.kicad_pcb'})).ok,false);
 await h.send({type:'gitlab-auth-set',provider:'gitlab',host:HOST,token:TOKEN},h.options);const result=await h.send(query);assert.equal(result.ok,true,result.error);assert.equal(result.result.users[0].login,'team_user');assert.ok(h.calls.filter(c=>c.url.includes('/members/all')).every(c=>new URL(c.url).origin===HOST&&c.init.headers.Authorization==='Bearer '+TOKEN));
 });


test('GitLab model discovery stays pinned to an authorized host and excludes non-models and links',async()=>{
 const h=harness(url=>new URL(url).pathname.endsWith('/tree')?new Response(JSON.stringify([
 {type:'blob',mode:'100644',path:'models/Package.3dshapes/body.step'},
 {type:'blob',mode:'120000',path:'linked.wrl'}, {type:'blob',path:'board.kicad_pcb'},
 {type:'blob',path:'../unsafe.wrl'}, {type:'blob',path:'model.wrl?query'}])):null);await h.add();
 const input={type:'repo-model-index',provider:'gitlab',host:HOST,repository:'group/private',ref:SHA};
 const result=await h.send(input);assert.equal(result.ok,true,result.error);
 assert.deepEqual(Array.from(result.result.paths),['models/Package.3dshapes/body.step']);assert.equal(result.result.snapshotRef,SHA);
 assert.equal(h.calls.length,0);assert.ok(h.websiteCalls.length>0);assert.ok(h.websiteCalls.every(call=>new URL(call.url).searchParams.get('ref')===SHA));
 const before=h.websiteCalls.length;assert.equal((await h.send({...input,ref:'main'})).ok,false);
 assert.equal((await h.send(input,{id:'test',url:HOST+'/group/private'})).ok,false);assert.equal(h.websiteCalls.length,before);assert.equal(h.calls.length,0);
});

test('repository graph and tree messages preserve GitLab viewer and configured-host isolation',async()=>{
 const h=harness((url)=>{const u=new URL(url);if(u.pathname.endsWith('/tree'))return new Response(JSON.stringify([{path:'board.kicad_pcb',type:'blob',mode:'100644',id:SHA}]));if(u.pathname.endsWith('/commits'))return new Response(JSON.stringify([{id:SHA,parent_ids:['b'.repeat(40)],message:'Subject\n\nBody',author_name:'A',authored_date:'2026-10-25T00:00:00Z'}]));});
 const base={provider:'gitlab',host:HOST,repository:'group/private',ref:SHA};
 assert.equal((await h.send({...base,type:'repository-history'})).ok,false);assert.equal(h.calls.length,0);await h.add();
 const tree=await h.send({...base,type:'repository-tree',directory:''});assert.equal(tree.ok,true);assert.equal(tree.result.entries[0].sha,SHA);
 const history=await h.send({...base,type:'repository-history'});assert.equal(history.ok,true);assert.equal(history.result.commits[0].message,'Subject\n\nBody');assert.equal(history.result.commits[0].parents[0],'b'.repeat(40));
 assert.equal(h.calls.length,0);assert.ok(h.websiteCalls.length>0);const before=h.websiteCalls.length;for(const sender of [h.options,{id:'test',url:'https://github.com/group/private'},{id:'test',url:'https://other.example.org/group/private'}])assert.notEqual((await h.send({...base,type:'repository-history'},sender)).ok,true);assert.equal(h.websiteCalls.length,before);assert.equal(h.calls.length,0);
});
