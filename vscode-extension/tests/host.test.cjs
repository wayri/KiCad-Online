const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../extension.js"),"utf8");
class Uri {
  constructor(value){const u=new URL(value);Object.assign(this,{scheme:u.protocol.slice(0,-1),authority:u.host,path:decodeURIComponent(u.pathname),query:u.search.slice(1),fragment:u.hash.slice(1)});}
  static parse(value){return new Uri(value);}
  static joinPath(base,...parts){return base.with({path:path.posix.join(base.path,...parts)});}
  with(changes){const result=Object.create(Uri.prototype);return Object.assign(result,this,changes);}
  toString(){return `${this.scheme}://${this.authority}${this.path}${this.query?"?"+this.query:""}${this.fragment?"#"+this.fragment:""}`;}
}
function harness(folder=Uri.parse("vscode-vfs://github/owner/repo?ref=main")) {
  const entries=new Map(),reads=[],stats=[],state=new Map(),commands=[],registrations=[];
  const vscode={Uri,ViewColumn:{Beside:-2},FileType:{File:1,Directory:2,SymbolicLink:64},workspace:{
    getConfiguration:()=>({inspect:()=>({defaultValue:true})}),
    getWorkspaceFolder:()=>folder?{uri:folder}:undefined,
    fs:{async stat(uri){stats.push(uri.toString());const item=entries.get(uri.toString());if(!item){const error=new Error("absent");error.code="FileNotFound";throw error;}return {size:item.size ?? item.bytes?.byteLength ?? 0,type:item.type || 1};},
      async readFile(uri){reads.push(uri.toString());const item=entries.get(uri.toString());if(!item){const error=new Error("absent");error.code="FileNotFound";throw error;}return item.bytes;},
      async writeFile(uri,bytes){entries.set(uri.toString(),{bytes:bytes.slice(),type:1});},
      async rename(from,to,options){const item=entries.get(from.toString());if(!item)throw new Error("missing stage");if(!options.overwrite&&entries.has(to.toString()))throw new Error("File exists");entries.set(to.toString(),item);entries.delete(from.toString());},
      async delete(uri){entries.delete(uri.toString());}}
    ,workspaceFolders:folder?[{uri:folder,name:"repo"}]:[],findFiles:async()=>[...entries.keys()].filter((u)=>/\.kicad_(sch|pcb)(?:\?|$)/.test(u)).map(Uri.parse),asRelativePath:(uri)=>uri.path.split("/").at(-1)
  },EventEmitter:class{constructor(){this.event=()=>{};}fire(){}dispose(){}},window:{registerTreeDataProvider:(view,provider)=>{registrations.push({view,provider});return {dispose(){}};},registerCustomEditorProvider:(view,provider,options)=>{registrations.push({view,provider,options});return {dispose(){}};},showQuickPick:async(items)=>items[0],showWarningMessage(){},showErrorMessage(){},showInformationMessage(){}},
    commands:{registerCommand:(name,handler)=>{commands.push({name,handler});return {dispose(){}};},executeCommand:async(...args)=>{commands.push(args);}}};
  const sandbox={module:{exports:{}},require(name){if(name==="./remote-collaboration.js")return require("../remote-collaboration.js");if(name==="./media/review-comments.js")return require("../../extension/review-comments.js");if(name==="./media/parsing.js")return require("../../extension/parsing.js");if(name==="./conflict-host.js")return require("../conflict-host.js");if(name==="./media/merge-conflicts.js")return require("../../extension/merge-conflicts.js");assert.equal(name,"vscode");return vscode;},crypto:require("node:crypto").webcrypto,URLSearchParams,TextDecoder,TextEncoder,Uint8Array,console};
  vm.runInNewContext(source,sandbox,{filename:"extension.js"});
  const context={extensionUri:Uri.parse("file:///extension"),subscriptions:[],_reviewQueue:Promise.resolve(),workspaceState:{get:(key,fallback)=>state.has(key)?state.get(key):fallback,update:async(key,value)=>{state.set(key,value);}}};
  const write=(relative,content="(kicad_sch)",options={})=>{const base=folder || Uri.parse("file:///outside"),uri=Uri.joinPath(base,relative),parts=relative.split("/");
    for(let i=1;i<parts.length;i++){const directory=Uri.joinPath(base,...parts.slice(0,i)).toString();if(!entries.has(directory))entries.set(directory,{type:2,size:0});}
    entries.set(uri.toString(),{bytes:new TextEncoder().encode(content),...options});return uri;};
  return {api:sandbox.module.exports,vscode,context,entries,reads,stats,state,write,folder,commands,registrations};
}
const plain=(value)=>JSON.parse(JSON.stringify(value));
async function session(h,relative="root.kicad_sch") {const uri=h.write(relative),project=await h.api._test.loadProject(uri);return h.api._test.createSession(uri,project,h.context,"a".repeat(48));}
async function send(h,s,id,request,extra={}) {const replies=[];await h.api._test.handleMessage({channel:h.api._test.CHANNEL,token:s.token,id,request,...extra},s,(reply)=>{replies.push(reply);});return replies[0]?.reply;}

test('closing a viewer cancels its queued storage mutations',async()=>{
 const h=harness(),s=await session(h);
 const pending=send(h,s,1,{type:'storage-set',values:{[s.variantKey]:'queued-value'}});
 s.disposed=true;await pending;
 assert.equal(h.state.size,0,'no mutation may begin after viewer disposal');
});

test('network revocation closes documents with remote attachment CSP while local-only views remain available',async()=>{
 const h=harness(Uri.parse('file:///repo')),remote=await session(h),local=await session(h,'local.kicad_sch');let listener,closed=0;
 h.vscode.workspace.onDidChangeConfiguration=fn=>{listener=fn;return{dispose(){}};};
 remote.remoteBinding={provider:'github'};remote.closeForPolicy=()=>{closed++;};local.closeForPolicy=()=>{throw Error('Local-only viewer was closed');};
 h.api.activate(h.context);h.vscode.workspace.getConfiguration=()=>({inspect:key=>({defaultValue:true,globalValue:key==='networkAccess'?false:true})});
 listener({affectsConfiguration:()=>true});assert.equal(closed,1);assert.equal(remote.disposed,true);assert.equal(local.disposed,false);
});

test('offline deployment denies virtual source reads but preserves cached project data and local viewing',async()=>{
 const h=harness(),s=await session(h);h.write('extra.kicad_pcb','(kicad_pcb)');
 h.vscode.workspace.getConfiguration=()=>({inspect:key=>({defaultValue:true,globalValue:key==='networkAccess'?false:true})});
 const before=h.reads.length;await assert.rejects(h.api._test.loadProject(Uri.joinPath(h.folder,'root.kicad_sch')),/local file/);
 assert.equal((await send(h,s,1,{type:'project',...s.scope,file:s.scope.rootFile})).ok,true);
 assert.equal((await send(h,s,2,{type:'project-file',...s.scope,file:'extra.kicad_pcb'})).ok,false);assert.equal(h.reads.length,before);
 assert.equal((await send(h,s,3,{type:'open-project-drawing',...s.scope,file:s.scope.rootFile})).ok,false);assert.equal(h.commands.length,0);
 const local=harness(Uri.parse('file:///repo'));local.vscode.workspace.getConfiguration=h.vscode.workspace.getConfiguration;
 assert.equal((await session(local)).files.length,1);
});

test('policy revoked during virtual file stat prevents the following source byte read',async()=>{
 const h=harness(),uri=h.write('root.kicad_sch'),stat=h.vscode.workspace.fs.stat;
 h.vscode.workspace.fs.stat=async target=>{const result=await stat(target);h.vscode.workspace.getConfiguration=()=>({inspect:key=>({defaultValue:true,globalValue:key==='networkAccess'?false:true})});return result;};
 await assert.rejects(h.api._test.loadProject(uri),/local file/);assert.equal(h.reads.length,0);
});

test('host admission bounds authenticated request floods and releases capacity',async()=>{
 const h=harness(),s=await session(h),pending=[];
 for(let id=1;id<=129;id++)pending.push(send(h,s,id,{type:'storage-get',key:s.variantKey}));
 const replies=await Promise.all(pending);
 assert.equal(replies.filter(reply=>reply?.ok===false).length,1);
 assert.match(replies.at(-1).error,/pending|budget|limit/i);
 assert.equal((await send(h,s,130,{type:'storage-get',key:s.variantKey})).ok,true);
});

test('host admission bounds retained payload bytes independently of request count',async()=>{
 const h=harness(),s=await session(h),pending=[];
 for(let id=1;id<=10;id++)pending.push(send(h,s,id,{type:'storage-get',key:s.variantKey,padding:'x'.repeat(900000)}));
 const replies=await Promise.all(pending);
 assert.ok(replies.some(reply=>reply?.ok===false),'oversized aggregate queues must reject before retention');
 assert.equal((await send(h,s,11,{type:'storage-get',key:s.variantKey})).ok,true);
});

test('global workspace search discovers both kinds without crossing providers and opens only discovered drawings',async()=>{
 const h=harness(),s=await session(h);h.write('board.kicad_pcb','(kicad_pcb)');h.write('power/child.kicad_sch');h.write('linked.kicad_pcb','(kicad_pcb)',{type:65});
 const result=await send(h,s,1,{type:'project-search-files',...s.scope,file:s.scope.rootFile});assert.equal(result.ok,true);assert.deepEqual(plain(result.result.files.map(f=>f.path)),['root.kicad_sch','board.kicad_pcb','power/child.kicad_sch']);assert.match(result.result.warnings.join(' '),/Symbolic-link/);
 const denied=await send(h,s,2,{type:'open-project-drawing',...s.scope,file:'unknown.kicad_pcb'});assert.equal(denied.ok,false);
 assert.equal((await send(h,s,3,{type:'open-project-drawing',...s.scope,file:'board.kicad_pcb'})).ok,true);assert.equal(h.commands.at(-1)[0],'vscode.openWith');assert.equal(h.commands.at(-1)[3],-2);
});

test('cross-file search target reaches new editor bootstrap once and keeps object/3D identity',async()=>{
 const h=harness(),s=await session(h),uri=h.write('board.kicad_pcb','(kicad_pcb)');s.paths.add('board.kicad_pcb');
 const result={kind:'object',path:'board.kicad_pcb',id:'uuid:part',uuid:'part',reference:'U1',netName:'SUPPLY',position:{x:12,y:-34},view:'3d'};
 assert.equal((await send(h,s,1,{type:'open-project-drawing',repository:s.scope.repository,ref:s.scope.ref,file:result.path,searchResult:result})).ok,true);
 const target=h.api._test.createSession(uri,await h.api._test.loadProject(uri),h.context,'b'.repeat(48));
 h.entries.set('file:///extension/media/revision-viewer.html',{bytes:new TextEncoder().encode('<html><head></head><body></body></html>')});
 const webview={cspSource:'vscode-resource:',asWebviewUri:uri=>({toString:()=>uri.toString()})};
 const bootstrap=html=>JSON.parse(html.match(/globalThis\.KiCadVSCodeContext=([^<]+);<\/script>/)[1]);
 assert.deepEqual(plain(bootstrap(await h.api._test.htmlFor(webview,h.context,target)).searchResult),result);
 assert.equal(bootstrap(await h.api._test.htmlFor(webview,h.context,target)).searchResult,undefined,'target is delivered only once');
});

test('ready live editor receives authenticated search target and other boundary/revision does not',async()=>{
 const h=harness(),s=await session(h),uri=h.write('board.kicad_pcb','(kicad_pcb)');s.paths.add('board.kicad_pcb');
 const project=await h.api._test.loadProject(uri),wrong=h.api._test.createSession(uri,{...project,scope:{...project.scope,ref:'other'}},h.context,'c'.repeat(48));
 const target=h.api._test.createSession(uri,project,h.context,'b'.repeat(48)),events=[],wrongEvents=[];target.post=async value=>{events.push(value);return true;};wrong.post=async value=>{wrongEvents.push(value);return true;};
 assert.equal((await send(h,wrong,1,{type:'workspace-search-ready',repository:wrong.scope.repository,ref:wrong.scope.ref,file:'board.kicad_pcb'})).ok,true);
 assert.equal((await send(h,target,1,{type:'workspace-search-ready',repository:target.scope.repository,ref:target.scope.ref,file:'board.kicad_pcb'})).ok,true);
 const result={kind:'object',path:'board.kicad_pcb',uuid:'part',position:{x:1,y:2},view:'3d'};
 assert.equal((await send(h,s,1,{type:'open-project-drawing',repository:s.scope.repository,ref:s.scope.ref,file:result.path,searchResult:result})).ok,true);
 assert.equal(events.length,1);assert.equal(events[0].token,target.token);assert.equal(events[0].event.type,'workspace-search-result');assert.deepEqual(plain(events[0].event.result),result);assert.equal(wrongEvents.length,0);
 assert.equal((await send(h,target,2,{type:'workspace-search-ready',repository:target.scope.repository,ref:target.scope.ref,file:'board.kicad_pcb'})).result.delivered,false,'ready replay cannot replay a consumed target');
});

test('search targets reject unsafe fields and mismatching source before opening an editor',async()=>{
 const h=harness(),s=await session(h);h.write('board.kicad_pcb','(kicad_pcb)');s.paths.add('board.kicad_pcb');let id=0;
 const request={type:'open-project-drawing',repository:s.scope.repository,ref:s.scope.ref,file:'board.kicad_pcb'},result={kind:'object',path:'board.kicad_pcb',uuid:'part'};
 for(const bad of [{...result,path:'other.kicad_pcb'},{...result,kind:'draft'},{...result,document:{}},{...result,uuid:'bad\n'},{...result,position:{x:1e9,y:0}},{...result,position:{x:0,y:0,z:4}},{...result,netName:'x'.repeat(501)},{...result,view:'simulation'}])assert.equal((await send(h,s,++id,{...request,searchResult:bad})).ok,false);
 for(const overrides of [{repository:'other/project'},{ref:'other'},{file:'unknown.kicad_pcb'}])assert.equal((await send(h,s,++id,{...request,...overrides,searchResult:result})).ok,false);
 assert.equal((await send(h,s,++id,{type:'open-project-drawing',repository:s.scope.repository,ref:s.scope.ref,file:s.scope.rootFile,searchResult:{kind:'object',path:s.scope.rootFile,view:'3d'}})).ok,false);
 assert.equal(h.commands.length,0);assert.equal(h.api._test.pendingSearchTargets.size,0);
});

test('GitLab collaboration context must match the native session binding for search delivery',async()=>{
 const h=harness(),s=await session(h);s.paths.add('board.kicad_pcb');s.remoteBinding={provider:'gitlab',host:'https://gitlab.example.com'};
 const request={type:'open-project-drawing',repository:s.scope.repository,ref:s.scope.ref,file:'board.kicad_pcb',provider:'gitlab',host:s.remoteBinding.host,searchResult:{kind:'file',path:'board.kicad_pcb'}};
 assert.equal((await send(h,s,1,request)).ok,true);assert.equal((await send(h,s,2,{...request,host:'https://other.example.com'})).ok,false);assert.equal((await send(h,s,3,{...request,provider:'github'})).ok,false);
});

test('pending search delivery is capped at 32 targets, expires after 30 seconds and clears failed opens',async()=>{
 const h=harness(),s=await session(h);let id=0;
 for(let i=0;i<33;i++){const file='board'+i+'.kicad_pcb';s.paths.add(file);const result={kind:'file',path:file};assert.equal((await send(h,s,++id,{type:'open-project-drawing',repository:s.scope.repository,ref:s.scope.ref,file,searchResult:result})).ok,true);}
 assert.equal(h.api._test.pendingSearchTargets.size,32);assert.ok(![...h.api._test.pendingSearchTargets.values()].some(entry=>entry.result.path==='board0.kicad_pcb'));
 h.api._test.pruneSearchTargets(Date.now()+30001);assert.equal(h.api._test.pendingSearchTargets.size,0);
 h.vscode.commands.executeCommand=async()=>{throw Error('editor failed');};const file='board32.kicad_pcb';
 assert.equal((await send(h,s,++id,{type:'open-project-drawing',repository:s.scope.repository,ref:s.scope.ref,file,searchResult:{kind:'file',path:file}})).ok,false);assert.equal(h.api._test.pendingSearchTargets.size,0);
});

test('global workspace discovery excludes another authority and linked ancestor before source reads',async()=>{
 const h=harness(),s=await session(h);h.write('linked/board.kicad_pcb','(kicad_pcb)');h.entries.set(Uri.joinPath(h.folder,'linked').toString(),{type:66,size:0});
 h.vscode.workspace.findFiles=async()=>[Uri.parse('vscode-vfs://evil/owner/repo/board.kicad_pcb?ref=main'),Uri.joinPath(h.folder,'linked/board.kicad_pcb')];
 const before=h.reads.length,result=await send(h,s,1,{type:'project-search-files',...s.scope,file:s.scope.rootFile});assert.equal(result.ok,true);assert.equal(result.result.files.length,0);assert.equal(h.reads.length,before);assert.match(result.result.warnings.join(' '),/Symbolic-link/);
});

test('repository report route reads bounded provider-relative JSON and excludes symbolic links before reads',async()=>{
 const h=harness(),s=await session(h);h.write('reports/board-drc.json','{"coordinate_units":"mm"}');h.write('linked.json','{}',{type:65});
 const request={type:'rule-report',repository:s.scope.repository,ref:s.scope.ref,file:s.scope.rootFile,reportPath:'reports/board-drc.json'};
 const result=await send(h,s,1,request);assert.equal(result.ok,true);assert.equal(result.result.content,'{"coordinate_units":"mm"}');
 const before=h.reads.length;assert.equal((await send(h,s,2,{...request,reportPath:'../outside.json'})).ok,false);assert.equal((await send(h,s,3,{...request,reportPath:'linked.json'})).ok,false);assert.equal(h.reads.length,before);
});

test("desktop and browser use VS Code APIs with read-only editors; native Git is isolated behind lazy trust gating",async()=> {
  const h=harness();h.api.activate(Object.freeze(h.context));
  const viewer=h.registrations.find((r)=>r.view==="kicadVisualReview.viewer");
  assert.equal(viewer.options.supportsMultipleEditorsPerDocument,true);
  const doc=await viewer.provider.openCustomDocument(h.write("root.kicad_sch"));
  assert.equal(typeof doc.dispose,"function");assert.equal(doc.save,undefined);
  await h.commands.find((r)=>r.name==="kicadVisualReview.open").handler(doc.uri);
  assert.equal(h.commands.find((r)=>Array.isArray(r))[0],"vscode.openWith");
  assert.ok(!/require\(['"](?:fs|path|crypto|child_process|node:)|process\./.test(source),'the shared desktop/web host never imports raw Node I/O');
  assert.equal((source.match(/require\('\.\/git-history-tree\.js'\)/g)||[]).length,1,'native Git object I/O has one lazy entry point');
  const history=source.slice(source.indexOf('async function historyContext'),source.indexOf('async function historicalBytes'));
  assert.ok(history.indexOf('await browseGit')<history.indexOf("require('./git-history-tree.js')"),'official Git provider, local URI and trust verification precede loading native helper');
});

test("virtual URI hierarchy preserves provider/ref and resolves sibling parents without escaping",async()=> {
  const h=harness(),root=h.write("hardware/root.kicad_sch",`(kicad_sch
    (sheet (property "Sheetfile" "child.kicad_sch"))
    (sheet (property "Sheetfile" "../../escape.kicad_sch")))`);
  h.write("hardware/child.kicad_sch",`(kicad_sch (sheet (property "Sheetfile" "../shared.kicad_sch")))`);
  h.write("shared.kicad_sch",`(kicad_sch (sheet (property "Sheetfile" "hardware/root.kicad_sch")))`);
  const project=await h.api._test.loadProject(root);
  assert.deepEqual(plain(project.files.map((f)=>f.path)),["hardware/root.kicad_sch","hardware/child.kicad_sch","shared.kicad_sch"]);
  assert.equal(h.reads.length,3);assert.ok(h.reads.every((u)=>u.startsWith("vscode-vfs://github/owner/repo/") && u.endsWith("?ref=main")));
  assert.match(project.warnings[0],/out-of-workspace/);
  assert.equal(h.api._test.sameScope(Uri.parse("vscode-vfs://evil/owner/repo/a.kicad_sch?ref=main"),h.folder),false);
  assert.equal(h.api._test.sameScope(Uri.parse("vscode-vfs://github/owner/repo/a.kicad_sch?ref=other"),h.folder),false);
});

test("top-level sheet context ignores comments, quoted text and library field lookalikes",async()=> {
  const h=harness(),root=h.write("root.kicad_sch",`(kicad_sch
    ; (property "Sheetfile" "comment.kicad_sch")
    (text "(property \\"Sheetfile\\" \\"text.kicad_sch\\")")
    (lib_symbols (symbol "Test:X" (property "Sheetfile" "library.kicad_sch")))
    (sheet (property "Sheetfile" "child.kicad_sch")))`.replaceAll('\\\\"','\\"'));
  h.write("child.kicad_sch");
  const project=await h.api._test.loadProject(root);
  assert.equal(project.files.length,2);assert.ok(h.reads.every((u)=>!/(comment|text|library)\.kicad_sch/.test(u)));
});

test("missing child is visible, root errors fail, symlink directories and files are rejected",async()=> {
  const h=harness(),root=h.write("root.kicad_sch",`(kicad_sch (sheet (property "Sheetfile" "absent.kicad_sch")))`);
  const missing=await h.api._test.loadProject(root);assert.match(missing.warnings[0],/Missing referenced sheet/);
  h.write("root.kicad_sch",`(kicad_sch (sheet (property "Sheetfile" "linked/child.kicad_sch")))`);
  h.write("linked","",{type:66});h.write("linked/child.kicad_sch");
  await assert.rejects(h.api._test.loadProject(root),/Symbolic-link directories/);
  assert.ok(!h.reads.some((u)=>u.includes("linked/child")));
  const s=harness(),linked=s.write("root.kicad_sch","(kicad_sch)",{type:65});
  await assert.rejects(s.api._test.loadProject(linked),/Symbolic-link drawings/);
});

test("file size is rejected before reading and sheet/cancellation/parser limits fail",async()=> {
  const h=harness(),large=h.write("large.kicad_pcb","(kicad_pcb)",{size:256*1024*1024+1});
  await assert.rejects(h.api._test.loadProject(large),/256 MiB/);assert.equal(h.reads.length,0);
  const modern=h.write('modern.kicad_sch',`(kicad_sch ${' '.repeat(9*1024*1024)})`);
  assert.equal((await h.api._test.loadProject(modern)).files.length,1);
  const root=h.write("root.kicad_sch",`(kicad_sch ${Array.from({length:32},(_,i)=>`(sheet (property "Sheetfile" "s${i}.kicad_sch"))`).join(" ")})`);
  for(let i=0;i<32;i++)h.write(`s${i}.kicad_sch`);
  assert.equal((await h.api._test.loadProject(root)).files.length,33);
  h.write('root.kicad_sch',`(kicad_sch ${Array.from({length:128},(_,i)=>`(sheet (property "Sheetfile" "s${i}.kicad_sch"))`).join(' ')})`);
  for(let i=32;i<128;i++)h.write(`s${i}.kicad_sch`);
  await assert.rejects(h.api._test.loadProject(root),/128-sheet/);
  await assert.rejects(h.api._test.loadProject(root,h.api._test.projectScope(root),{isCancellationRequested:true}),/cancelled/);
  h.write("root.kicad_sch","(kicad_sch");await assert.rejects(h.api._test.loadProject(root),/Incomplete/);
});

test("project sources above the old 24 MiB limit load, and the 512 MiB search budget blocks before reading",async()=> {
  const h=harness(),padding=" ".repeat(7*1024*1024),root=h.write("root.kicad_sch",`(kicad_sch
    (sheet (property "Sheetfile" "a.kicad_sch")) (sheet (property "Sheetfile" "b.kicad_sch"))
    (sheet (property "Sheetfile" "c.kicad_sch")) ${padding})`);
  for(const name of ["a","b","c"])h.write(`${name}.kicad_sch`,`(kicad_sch ${padding})`);
  assert.equal((await h.api._test.loadProject(root)).files.length,4);
  assert.equal(h.reads.length,4);
  const before=h.reads.length;
  await assert.rejects(h.api._test.loadProject(root,h.api._test.projectScope(root),{isCancellationRequested:false},{files:0,bytes:512*1024*1024-1}),/512 MiB/);
  assert.equal(h.reads.length,before);
});

test("without a workspace the opened file directory remains the authorized boundary",async()=> {
  const h=harness(null),root=h.write("root.kicad_sch",`(kicad_sch (sheet (property "Sheetfile" "../outside.kicad_sch")))`);
  const project=await h.api._test.loadProject(root);
  assert.equal(project.scope.boundary.path,"/outside");assert.equal(project.files.length,1);
  assert.match(project.warnings[0],/out-of-workspace/);
});

test("private bridge rejects another session, replay, oversized requests and arbitrary URI reads",async()=> {
  const h=harness(),s=await session(h),scope={repository:s.scope.repository,ref:s.scope.ref,file:s.scope.rootFile};
  assert.equal(await send(h,s,1,{type:"project",...scope},{token:"wrong"}),undefined);
  const valid=await send(h,s,1,{type:"project",...scope});assert.equal(valid.ok,true);
  assert.equal(await send(h,s,1,{type:"project",...scope}),undefined);
  assert.equal((await send(h,s,2,{type:"readFile",uri:"file:///secret"})).ok,false);
  assert.equal((await send(h,s,3,{type:"project",...scope,file:"other.kicad_sch"})).ok,false);
  assert.equal((await send(h,s,4,{type:"comment-list",...scope,padding:"x".repeat(1024*1024)})).ok,false);
  s.disposed=true;assert.equal(await send(h,s,5,{type:"project",...scope}),undefined);
});

test("annotations and variants persist locally and refuse cross-project scopes; GitHub stays unavailable",async()=> {
  const h=harness(),s=await session(h),scope={repository:s.scope.repository,ref:s.scope.ref,file:s.scope.rootFile};
  const note={id:"note-1",text:"Review this",severity:"major",createdAt:"2026-10-04T00:00:00.000Z",anchor:{...scope,position:{x:1,y:2}}};
  assert.equal((await send(h,s,1,{type:"comment-save",comment:note})).ok,true);
  const loaded=await send(h,s,2,{type:"comment-list",...scope});assert.deepEqual(plain(loaded.result),[{...note,updatedAt:note.createdAt,state:"open",tags:[],mentions:[],remoteRefs:[]}]);
  const other=await session(h,"other.kicad_sch");assert.deepEqual(plain((await send(h,other,1,{type:"comment-list",repository:other.scope.repository,ref:other.scope.ref,file:other.scope.rootFile})).result),[]);
  assert.equal((await send(h,s,3,{type:"comment-save",comment:{...note,anchor:{...scope,repository:"wrong/repo"}}})).ok,false);
  const variant={schemaVersion:1,variants:[]};
  assert.equal((await send(h,s,4,{type:"storage-set",values:{[s.variantKey]:variant}})).ok,true);
  assert.deepEqual(plain((await send(h,s,5,{type:"storage-get",key:s.variantKey})).result),{[s.variantKey]:variant});
  assert.equal((await send(h,s,6,{type:"storage-get",key:"arbitrary"})).ok,false);
  assert.match((await send(h,s,7,{type:"open-comment-draft",url:"https://evil.example"})).error,/unavailable in VS Code/);
  assert.equal((await send(h,s,8,{type:"comment-delete",...scope,id:note.id})).ok,true);
  assert.deepEqual(plain((await send(h,s,9,{type:"comment-list",...scope})).result),[]);
});

test("simultaneous editors serialize annotation updates without losing saved notes",async()=> {
  const h=harness(),a=await session(h),b=await session(h);
  h.context.workspaceState.update=async(key,value)=>{await Promise.resolve();h.state.set(key,value);};
  const note=(id)=>({id,text:id,severity:"info",createdAt:"2026-10-04T00:00:00.000Z",anchor:{repository:a.scope.repository,ref:a.scope.ref,file:a.scope.rootFile}});
  const saved=await Promise.all([send(h,a,1,{type:"comment-save",comment:note("a")}),send(h,b,1,{type:"comment-save",comment:note("b")})]);
  assert.ok(saved.every((r)=>r.ok));
  assert.deepEqual(plain((await send(h,a,2,{type:"comment-list",repository:a.scope.repository,ref:a.scope.ref,file:a.scope.rootFile})).result.map((n)=>n.id)),["a","b"]);
});

test("webview HTML confines resources and points relative SPIKE loads at packaged media",async()=> {
  const h=harness(),s=await session(h);
  const template=fs.readFileSync(path.join(__dirname,"../../extension/revision-viewer.html"),"utf8");
  h.entries.set("file:///extension/media/revision-viewer.html",{bytes:new TextEncoder().encode(template)});
  const webview={cspSource:"https://resources.example",asWebviewUri:(uri)=>({toString:()=>`https://resources.example${uri.path}`})};
  const html=await h.api._test.htmlFor(webview,h.context,s);
  assert.match(html,/default-src &#39;none&#39;/);assert.match(html,/connect-src https:\/\/resources.example\/extension\/media\/load-worker-vscode.js https:\/\/resources.example\/extension\/media\/fast-pi-worker-vscode.js https:\/\/resources.example\/extension\/media\/step-worker-vscode.js https:\/\/resources.example\/extension\/media\/vendor\/occt\/occt-import-js.wasm;/);assert.match(html,/worker-src blob:/);assert.match(html,/wasm-unsafe-eval/);assert.doesNotMatch(html,/connect-src [^;]*\*/);assert.doesNotMatch(html,/&#39;unsafe-eval&#39;/);
  assert.match(html,/"stepWorkerUrl":"https:\/\/resources.example\/extension\/media\/step-worker-vscode.js"/);assert.match(html,/"stepWasmUrl":"https:\/\/resources.example\/extension\/media\/vendor\/occt\/occt-import-js.wasm"/);
  assert.match(html,/base href="https:\/\/resources.example\/extension\/media\/"/);
  assert.match(html,/frame-src https:\/\/resources.example\/extension\/media\/terms.html;/);assert.doesNotMatch(html,/frame-src [^;]*\*/);
  assert.match(html,/src="https:\/\/resources.example\/extension\/media\/revision-viewer.js"/);
  assert.match(html,/nonce="[a-f0-9]{48}"/);
  assert.match(html,/GitHub publishing and remote annotations are unavailable/);
  assert.ok(!html.includes("Publishing uses GitHubâ€™s signed-in composer"));
  const relative=new URL("vendor/spike-board3d.bundle.js","https://resources.example/extension/media/");
  assert.equal(relative.href,"https://resources.example/extension/media/vendor/spike-board3d.bundle.js");
});

const scopeOf=(s)=>({repository:s.scope.repository,ref:s.scope.ref,file:s.scope.rootFile});
test('saved analysis opens in a scoped trusted Results view and rejects traversal, links and foreign close requests',async()=>{
 const h=harness(),s=await session(h);h.write('reports/design.json','{"schema":"kicad_monkey.design.a0"}');h.write('unsafe/data.json','{}');h.entries.set(Uri.joinPath(h.folder,'unsafe').toString(),{type:65,size:0});
 h.entries.set('file:///extension/media/analysis-viewer.html',{bytes:new TextEncoder().encode(fs.readFileSync(path.join(__dirname,'../../extension/analysis-viewer.html'),'utf8'))});
 const panels=[],replies=[];let receive;
 h.vscode.window.createWebviewPanel=(kind,title,column,options)=>{let onDispose;const panel={kind,title,options,webview:{cspSource:'https://resources.example',asWebviewUri:uri=>({toString:()=>`https://resources.example${uri.path}`}),onDidReceiveMessage:fn=>{receive=fn;return{dispose(){}};},postMessage:reply=>replies.push(reply)},onDidDispose:fn=>{onDispose=fn;},dispose(){this.disposed=true;onDispose?.();}};panels.push(panel);return panel;};
 let id=0;const open=path=>send(h,s,++id,{type:'open-analysis-viewer',...scopeOf(s),path});
 for(const path of ['../private.json','reports/script.js','unsafe/data.json'])assert.equal((await open(path)).ok,false);
 assert.equal(panels.length,0);assert.equal((await send(h,s,++id,{type:'open-analysis-viewer',...scopeOf(s),repository:'other/repo',path:'reports/design.json'})).ok,false);
 assert.equal((await open('reports/design.json')).ok,true);const panel=panels[0];assert.equal(panel.kind,'kicadVisualReview.analysis');
 assert.match(panel.webview.html,/analysis-viewer.js/);assert.match(panel.webview.html,/default-src &#39;none&#39;/);assert.doesNotMatch(panel.webview.html,/connect-src [^;]*\*/);
 const data=JSON.parse(panel.webview.html.match(/globalThis.KiCadVSCodeContext=(\{.*?\});<\/script>/)[1]);assert.equal(data.drawingFile,s.scope.rootFile);assert.equal(new URLSearchParams(data.search).get('file'),'reports/design.json');
 await receive({channel:h.api._test.CHANNEL,token:data.token,id:1,request:{type:'close-analysis-viewer',repository:s.scope.repository,ref:s.scope.ref,file:'other.json'}});assert.equal(panel.disposed,undefined);assert.equal(replies.at(-1).reply.ok,false);
 await receive({channel:h.api._test.CHANNEL,token:data.token,id:2,request:{type:'close-analysis-viewer',repository:s.scope.repository,ref:s.scope.ref,file:'reports/design.json'}});assert.equal(panel.disposed,true);
});
const annotation=(s,id="note")=>({id,text:"Check this connection",createdAt:"2026-10-04T00:00:00.000Z",updatedAt:"2026-10-04T00:00:00.000Z",
  severity:"major",state:"open",tags:["routing","power"],mentions:[],remoteRefs:[],anchor:{...scopeOf(s),uuid:"native-object",position:{x:1.25,y:2.5}}});
const sidecarUri=(h)=>Uri.joinPath(h.folder,".kicad-review.json").toString();
const storedSidecar=(h)=>JSON.parse(new TextDecoder().decode(h.entries.get(sidecarUri(h)).bytes));
const putSidecar=(h,data)=>h.entries.set(sidecarUri(h),{bytes:new TextEncoder().encode(JSON.stringify(data)),type:1});

test("Git-trackable sidecar round trips portable anchors and metadata across reopened projects",async()=> {
  const h=harness(),s=await session(h),note=annotation(s),sourceBytes=h.entries.get(s.uri.toString()).bytes.slice(),renames=[];
  const rename=h.vscode.workspace.fs.rename;h.vscode.workspace.fs.rename=async(a,b,o)=>{renames.push([a.toString(),b.toString(),o]);return rename(a,b,o);};
  assert.equal((await send(h,s,1,{type:"comment-save",comment:note})).ok,true);
  const stored=storedSidecar(h);assert.equal(stored.schemaVersion,1);assert.deepEqual(stored.annotations,[note]);
  assert.equal(stored.annotations[0].anchor.repository,"local/workspace");assert.ok(!JSON.stringify(stored).includes(s.token));
  assert.equal(renames.length,1);assert.equal(renames[0][2].overwrite,false);
  assert.ok(renames[0][0].startsWith("vscode-vfs://github/owner/repo/.kicad-review."));
  assert.equal(renames[0][1],sidecarUri(h));assert.ok(![...h.entries.keys()].some((uri)=>uri.includes(".tmp")));
  const reopened=await session(h);assert.deepEqual(plain((await send(h,reopened,1,{type:"comment-list",...scopeOf(reopened)})).result),[note]);
  assert.deepEqual(h.entries.get(s.uri.toString()).bytes,sourceBytes);
});

test("future/malformed/oversized sidecars fail safely before any writes",async()=> {
  const h=harness(),s=await session(h);let writes=0;h.vscode.workspace.fs.writeFile=async()=>{writes++;};
  putSidecar(h,{schemaVersion:2,annotations:[]});const original=h.entries.get(sidecarUri(h)).bytes.slice();
  assert.match((await send(h,s,1,{type:"comment-save",comment:annotation(s)})).error,/Unsupported/);assert.equal(writes,0);
  assert.deepEqual(h.entries.get(sidecarUri(h)).bytes,original);
  putSidecar(h,{schemaVersion:1,annotations:[{...annotation(s),secretToken:"must not be discarded or overwritten"}]});
  assert.match((await send(h,s,2,{type:"comment-list",...scopeOf(s)})).error,/unsupported fields/);
  h.entries.set(sidecarUri(h),{type:1,size:4*1024*1024+1,bytes:new Uint8Array()});
  assert.match((await send(h,s,3,{type:"comment-list",...scopeOf(s)})).error,/4 MiB/);assert.equal(writes,0);
});

test("staging and provider rename failures preserve the original sidecar and clean temporary files",async()=> {
  for(const operation of ["writeFile","rename"]) {
    const h=harness(),s=await session(h);putSidecar(h,{schemaVersion:1,annotations:[]});const original=h.entries.get(sidecarUri(h)).bytes.slice();
    h.vscode.workspace.fs[operation]=async()=>{throw new Error(`Provider ${operation} unavailable`);};
    const result=await send(h,s,1,{type:"comment-save",comment:annotation(s)});
    assert.equal(result.ok,false);assert.match(result.error,/Could not save/);
    assert.deepEqual(h.entries.get(sidecarUri(h)).bytes,original);assert.ok(![...h.entries.keys()].some((uri)=>uri.includes(".tmp")));
  }
});

test("provider rename acknowledgement failure recovers only a byte-verified committed candidate",async()=> {
  const h=harness(),s=await session(h),rename=h.vscode.workspace.fs.rename;
  h.vscode.workspace.fs.rename=async(...args)=>{await rename(...args);throw new Error("Remote acknowledgement lost");};
  const result=await send(h,s,1,{type:"comment-save",comment:annotation(s)});
  assert.equal(result.ok,true);assert.equal(storedSidecar(h).annotations.length,1);
  assert.ok(![...h.entries.keys()].some((uri)=>uri.includes(".tmp")));
});

test("external changes after loading and during staging are preserved without overwriting",async()=> {
  const h=harness(),s=await session(h);putSidecar(h,{schemaVersion:1,annotations:[]});
  await send(h,s,1,{type:"comment-list",...scopeOf(s)});
  const external=annotation(s,"external");putSidecar(h,{schemaVersion:1,annotations:[external]});
  assert.match((await send(h,s,2,{type:"comment-save",comment:annotation(s)})).error,/changed externally/);
  assert.deepEqual(storedSidecar(h).annotations,[external]);
  await send(h,s,3,{type:"comment-list",...scopeOf(s)});
  const write=h.vscode.workspace.fs.writeFile,second=annotation(s,"second");
  h.vscode.workspace.fs.writeFile=async(uri,bytes)=>{await write(uri,bytes);putSidecar(h,{schemaVersion:1,annotations:[external,second]});};
  assert.match((await send(h,s,4,{type:"comment-save",comment:annotation(s)})).error,/changed externally/);
  assert.deepEqual(storedSidecar(h).annotations,[external,second]);assert.ok(![...h.entries.keys()].some((uri)=>uri.includes(".tmp")));
});

test("saved GitHub provenance and remote references survive local edits; stale note versions fail",async()=> {
  const h=harness(),s=await session(h),note=annotation(s);note.anchor.repository="owner/repo";note.anchor.ref="main";
  note.remoteRefs=[{kind:"issue",repository:"owner/repo",number:7,url:"https://github.com/owner/repo/issues/7#issuecomment-100",publishedAt:note.createdAt,nodeId:"I_node"}];
  putSidecar(h,{schemaVersion:1,annotations:[note]});
  const loaded=(await send(h,s,1,{type:"comment-list",...scopeOf(s)})).result[0];
  assert.equal((await send(h,s,2,{type:"comment-save",comment:{...loaded,text:"Resolved review",state:"resolved"},expectedUpdatedAt:loaded.updatedAt})).ok,true);
  const edited=storedSidecar(h).annotations[0];assert.equal(edited.anchor.repository,"owner/repo");assert.equal(edited.state,"resolved");assert.deepEqual(edited.remoteRefs,note.remoteRefs);
  assert.match((await send(h,s,3,{type:"comment-save",comment:loaded,expectedUpdatedAt:loaded.updatedAt})).error,/edited elsewhere/);
  assert.match((await send(h,s,4,{type:"comment-save",comment:{...edited,anchor:{...edited.anchor,repository:"local/workspace"}}})).error,/cannot be rebound/);
});

test("native Explorer navigator opens saved drawings and exposes their review sidecar",async()=> {
  const h=harness(),s=await session(h);putSidecar(h,{schemaVersion:1,annotations:[]});h.api.activate(h.context);
  const navigator=h.registrations.find((r)=>r.view==="kicadVisualReview.navigator"),items=await navigator.provider.getChildren();
  assert.ok(items.some((item)=>item.command.command==="kicadVisualReview.open"&&item.resourceUri.toString()===s.uri.toString()));
  assert.ok(items.some((item)=>item.command.command==="vscode.open"&&item.resourceUri.toString()===sidecarUri(h)));
  await h.commands.find((c)=>c.name==="kicadVisualReview.openSidecar").handler(s.uri);
  assert.ok(h.commands.some((c)=>Array.isArray(c)&&c[0]==="vscode.open"&&c[1].toString()===sidecarUri(h)));
});

test("previous workspace notes migrate only through the explicit command and retain original drafts",async()=> {
  const h=harness(),s=await session(h);let hash=2166136261;
  for(const c of h.folder.toString())hash=Math.imul(hash^c.charCodeAt(0),16777619);
  const legacy={...annotation(s),anchor:{...annotation(s).anchor,repository:`vscode/workspace-${(hash>>>0).toString(16)}`}};
  h.state.set(`${s.storageKey}:comments`,[legacy]);
  assert.deepEqual(plain((await send(h,s,1,{type:"comment-list",...scopeOf(s)})).result),[]);
  assert.ok(!h.entries.has(sidecarUri(h)));h.api.activate(h.context);
  await h.commands.find((c)=>c.name==="kicadVisualReview.importLegacyNotes").handler(s.uri);
  assert.equal(storedSidecar(h).annotations[0].anchor.repository,"local/workspace");
  assert.deepEqual(h.state.get(`${s.storageKey}:comments`),[legacy]);
});

test("invalid remote reference URLs and duplicate full provenance are rejected without writes",async()=> {
  const h=harness(),s=await session(h),note=annotation(s);
  note.remoteRefs=[{kind:"issue",repository:"owner/repo",number:1,url:"https://evil.example/owner/repo/issues/1",publishedAt:note.createdAt}];
  assert.equal((await send(h,s,1,{type:"comment-save",comment:note})).ok,false);assert.ok(!h.entries.has(sidecarUri(h)));
  note.remoteRefs=[];putSidecar(h,{schemaVersion:1,annotations:[note,note]});
  assert.match((await send(h,s,2,{type:"comment-list",...scopeOf(s)})).error,/Duplicate annotation/);
});


const PNG_ONE_PIXEL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
test("area and PNG capture metadata survive save, edit and reopen without modifying drawings",async()=> {
  const h=harness(),s=await session(h),note=annotation(s),sourceBytes=h.entries.get(s.uri.toString()).bytes.slice();
  note.anchor.area={x:-1.5,y:2.25,width:12,height:8};note.capture={mime:"image/png",dataUrl:PNG_ONE_PIXEL,width:1,height:1};
  assert.equal((await send(h,s,1,{type:"comment-save",comment:note})).ok,true);
  assert.deepEqual(storedSidecar(h).annotations,[note]);
  const shared=require("../../extension/review-comments.js");
  assert.deepEqual(shared.parseSidecar(new TextDecoder().decode(h.entries.get(sidecarUri(h)).bytes)),[note]);
  assert.deepEqual(plain(h.api._test.validateSidecar(JSON.parse(shared.serializeSidecar([note])))).annotations,[note]);
  const reopened=await session(h),loaded=(await send(h,reopened,1,{type:"comment-list",...scopeOf(reopened)})).result[0];
  assert.deepEqual(plain(loaded),note);
  assert.equal((await send(h,reopened,2,{type:"comment-save",comment:{...loaded,text:"Area verified"},expectedUpdatedAt:loaded.updatedAt})).ok,true);
  const edited=storedSidecar(h).annotations[0];assert.deepEqual(edited.anchor.area,note.anchor.area);assert.deepEqual(edited.capture,note.capture);
  assert.deepEqual(h.entries.get(s.uri.toString()).bytes,sourceBytes);
});

test("invalid area/capture bounds, encodings, signatures and unknown fields preserve sidecar bytes",async()=> {
  const h=harness(),s=await session(h),note=annotation(s);putSidecar(h,{schemaVersion:1,annotations:[note]});
  const bytes=h.entries.get(sidecarUri(h)).bytes.slice(),capture={mime:"image/png",dataUrl:PNG_ONE_PIXEL,width:1,height:1};
  const variants=[
    {capture:null},
    {anchor:{...note.anchor,area:null}},
    {anchor:{...note.anchor,area:{x:0,y:0,width:0,height:2}}},
    {anchor:{...note.anchor,area:{x:999999,y:0,width:2,height:2}}},
    {anchor:{...note.anchor,area:{x:0,y:0,width:Infinity,height:2}}},
    {anchor:{...note.anchor,area:{x:0,y:0,width:2,height:2,units:"inch"}}},
    {capture:{...capture,mime:"image/svg+xml"}},
    {capture:{...capture,width:1025}},
    {capture:{...capture,height:1.5}},
    {capture:{...capture,dataUrl:"data:image/png;base64,AAAA"}},
    {capture:{...capture,dataUrl:PNG_ONE_PIXEL+"!"}},
    {capture:{...capture,dataUrl:PNG_ONE_PIXEL+"A".repeat(256*1024)}},
    {capture:{...capture,token:"unexpected"}}
  ];
  let id=0;for(const changes of variants){assert.equal((await send(h,s,++id,{type:"comment-save",comment:{...note,...changes}})).ok,false);assert.deepEqual(h.entries.get(sidecarUri(h)).bytes,bytes);}
  assert.ok(![...h.entries.keys()].some((uri)=>uri.includes(".tmp")));
});

test("cumulative PNG captures cannot exceed the sidecar limit during a valid individual save",async()=> {
  const h=harness(),s=await session(h),payload=Buffer.alloc(180000);Buffer.from([137,80,78,71,13,10,26,10]).copy(payload);
  const capture={mime:"image/png",dataUrl:"data:image/png;base64,"+payload.toString("base64"),width:1024,height:1024};
  const notes=Array.from({length:17},(_,i)=>({...annotation(s,`capture-${i}`),capture}));putSidecar(h,{schemaVersion:1,annotations:notes});
  const bytes=h.entries.get(sidecarUri(h)).bytes.slice();
  const saved=await send(h,s,1,{type:"comment-save",comment:{...annotation(s,"capture-new"),capture}});
  assert.equal(saved.ok,false);assert.match(saved.error,/4 MiB/);assert.deepEqual(h.entries.get(sidecarUri(h)).bytes,bytes);
  assert.ok(![...h.entries.keys()].some((uri)=>uri.includes(".tmp")));
});

test("drawing preferences persist across reopening while keys and values stay drawing-scoped",async()=> {
  const h=harness(),s=await session(h),value={uiTheme:"light",drawingTheme:"dark",rulerUnits:"mil",showNetNames:true,acceleration:"auto"};
  assert.equal(s.preferencesKey,JSON.stringify(["kicad-review-preferences",s.scope.repository,s.scope.rootFile]));
  assert.equal((await send(h,s,1,{type:"storage-set",values:{[s.preferencesKey]:value}})).ok,true);
  const reopened=await session(h);assert.deepEqual(plain((await send(h,reopened,1,{type:"storage-get",key:reopened.preferencesKey})).result),{[s.preferencesKey]:value});
  const other=await session(h,"other.kicad_pcb");assert.deepEqual(plain((await send(h,other,1,{type:"storage-get",key:other.preferencesKey})).result),{});
  assert.equal((await send(h,other,2,{type:"storage-get",key:s.preferencesKey})).ok,false);
  assert.equal((await send(h,s,2,{type:"storage-set",values:{[s.preferencesKey]:{...value,page:"A4"}}})).ok,false);
  assert.equal((await send(h,s,3,{type:"storage-set",values:{[s.preferencesKey]:{...value,rulerUnits:"inch"}}})).ok,false);
  assert.equal((await send(h,s,4,{type:"storage-set",values:{[s.preferencesKey]:{...value,drawingTheme:"custom"}}})).ok,false);
  assert.equal((await send(h,s,5,{type:"storage-set",values:{[s.preferencesKey]:{...value,showNetNames:"yes"}}})).ok,false);
  assert.equal((await send(h,s,6,{type:"storage-set",values:{[s.preferencesKey]:{...value,acceleration:"fast"}}})).ok,false);
  assert.deepEqual(plain(h.state.get(`${s.storageKey}:preferences`)),value);assert.ok(!h.entries.has(sidecarUri(h)));
});


const assetRequest=(s,file)=>({type:"repo-asset",repository:s.scope.repository,ref:s.scope.ref,file});
test("repository model assets use virtual workspace URIs and browser-compatible lossless base64",async()=> {
  const h=harness(),s=await session(h,"hardware/root.kicad_pcb");let id=0;
  for(const [name,length] of [["one.wrl",1],["two.vrml",2],["three.glb",3],["binary.GLB",256],["chunked.wrl",16385]]) {
    const uri=h.write(`models/${name}`,""),bytes=Uint8Array.from({length},(_,i)=>i%256);h.entries.set(uri.toString(),{bytes,type:1});
    const loaded=await send(h,s,++id,assetRequest(s,`models/${name}`));assert.equal(loaded.ok,true);
    assert.deepEqual(plain(loaded.result),{base64:Buffer.from(bytes).toString("base64"),mediaType:/glb$/i.test(name)?"model/gltf-binary":"model/vrml"});
    assert.ok(h.reads.at(-1).startsWith("vscode-vfs://github/owner/repo/models/")&&h.reads.at(-1).endsWith("?ref=main"));
  }
  assert.equal(s.assetRequests,5);assert.equal(s.assetBytes,1+2+3+256+16385);
});

test("model assets reject traversal, absolute/provider URLs, unexpected formats and another session scope before reads",async()=> {
  const h=harness(),s=await session(h);h.write("models/model.wrl","#VRML V2.0 utf8");const reads=h.reads.length,stats=h.stats.length;
  for(const [i,file] of ["../model.wrl","/model.wrl","models/../model.wrl","models/./model.wrl","models//model.wrl","file:///model.wrl","models/model.obj","models/model.wrl?secret","models/%2e%2e/model.wrl","models/model.wrl#x","models\\model.wrl"].entries()) {
    assert.equal((await send(h,s,i+1,assetRequest(s,file))).ok,false);
  }
  assert.equal((await send(h,s,12,{...assetRequest(s,"models/model.wrl"),repository:"wrong/repo"})).ok,false);
  assert.equal((await send(h,s,13,{...assetRequest(s,"models/model.wrl"),ref:"other"})).ok,false);
  assert.equal(h.reads.length,reads);assert.equal(h.stats.length,stats);
});

test("model file and ancestor symlinks are rechecked and no linked content is read",async()=> {
  const h=harness(),s=await session(h),uri=h.write("models/model.wrl","model");
  assert.equal((await send(h,s,1,assetRequest(s,"models/model.wrl"))).ok,true);const count=h.reads.length;
  h.write("models","",{type:66});assert.match((await send(h,s,2,assetRequest(s,"models/model.wrl"))).error,/Symbolic-link model directories/);
  assert.equal(h.reads.length,count);h.write("models","",{type:2});h.entries.get(uri.toString()).type=65;
  assert.match((await send(h,s,3,assetRequest(s,"models/model.wrl"))).error,/Symbolic-link model assets/);assert.equal(h.reads.length,count);
  h.entries.get(uri.toString()).type=2;assert.match((await send(h,s,4,assetRequest(s,"models/model.wrl"))).error,/not a file/);
});

test("model per-file and cumulative byte limits reject before reading and verify provider growth",async()=> {
  const h=harness(),s=await session(h),uri=h.write("model.glb","model",{size:8*1024*1024+1}),count=h.reads.length;
  assert.match((await send(h,s,1,assetRequest(s,"model.glb"))).error,/8 MiB/);assert.equal(h.reads.length,count);
  h.entries.set(uri.toString(),{bytes:Uint8Array.from([1,2,3,4,5,6,7]),type:1});s.assetBytes=32*1024*1024-10;
  assert.equal((await send(h,s,2,assetRequest(s,"model.glb"))).ok,true);assert.equal(s.assetBytes,32*1024*1024-3);
  assert.match((await send(h,s,3,assetRequest(s,"model.glb"))).error,/32 MiB/);assert.equal(h.reads.length,count+1);
  s.assetBytes=0;h.entries.set(uri.toString(),{bytes:new Uint8Array(8*1024*1024+1),size:1,type:1});
  assert.match((await send(h,s,4,assetRequest(s,"model.glb"))).error,/8 MiB/);assert.equal(h.reads.length,count+2);assert.equal(s.assetBytes,8*1024*1024+1);
});

test("model route bounds each session to 32 requests including valid-path failed reads",async()=> {
  const h=harness(),s=await session(h);h.write("model.wrl","x");
  for(let id=1;id<=32;id++){const result=await send(h,s,id,assetRequest(s,id===1?"absent.wrl":"model.wrl"));assert.equal(result.ok,id!==1);}
  const count=h.reads.length;assert.match((await send(h,s,33,assetRequest(s,"model.wrl"))).error,/32-request/);assert.equal(h.reads.length,count);
  const other=await session(h);assert.equal((await send(h,other,1,assetRequest(other,"model.wrl"))).ok,true);
});


const existingSession=async(h,uri,token="b".repeat(48))=>h.api._test.createSession(uri,await h.api._test.loadProject(uri),h.context,token);
test("paired command selects opposite kind in the same provider folder and opens native split editors",async()=> {
  const h=harness(),root=h.write("hardware/design.kicad_sch"),pcb=h.write("hardware/design.kicad_pcb","(kicad_pcb)");
  h.write("hardware/other.kicad_sch");h.write("elsewhere/design.kicad_pcb");
  h.entries.set("vscode-vfs://evil/owner/repo/hardware/escape.kicad_pcb?ref=main",{bytes:new TextEncoder().encode("(kicad_pcb)")});
  let offered;h.vscode.window.showQuickPick=async(items)=>{offered=items;return items[0];};h.api.activate(h.context);
  await h.commands.find((c)=>c.name==="kicadVisualReview.openPair").handler(root);
  assert.equal(offered.length,1);assert.equal(offered[0].uri.toString(),pcb.toString());
  const opened=h.commands.filter(Array.isArray);assert.equal(opened.length,2);
  assert.deepEqual(opened.map((c)=>[c[0],c[1].toString(),c[2],c[3]]),[["vscode.openWith",root.toString(),"kicadVisualReview.viewer",undefined],["vscode.openWith",pcb.toString(),"kicadVisualReview.viewer",-2]]);
});

test("pair cancellation, no counterpart and unsafe linked drawings create no editor opens",async()=> {
  const h=harness(),root=h.write("design.kicad_sch");h.api.activate(h.context);const command=h.commands.find((c)=>c.name==="kicadVisualReview.openPair").handler;
  await command(root);assert.equal(h.commands.filter(Array.isArray).length,0);
  h.write("design.kicad_pcb","(kicad_pcb)");h.vscode.window.showQuickPick=async()=>undefined;await command(root);assert.equal(h.commands.filter(Array.isArray).length,0);
  h.vscode.window.showQuickPick=async(items)=>items[0];h.write("design.kicad_pcb","(kicad_pcb)",{type:65});await command(root);assert.equal(h.commands.filter(Array.isArray).length,0);
});

test("paired relay accepts loaded hierarchy selections and targets only explicitly paired opposite editors",async()=> {
  const h=harness(),root=h.write("design.kicad_sch",'(kicad_sch (sheet (property "Sheetfile" "child.kicad_sch")))'),pcb=h.write("design.kicad_pcb","(kicad_pcb)");h.write("child.kicad_sch");
  const a=await existingSession(h,root),b=await existingSession(h,pcb,"c".repeat(48)),other=await session(h,"unpaired.kicad_pcb"),same=await session(h,"unpaired.kicad_sch");
  const delivered=[],unrelated=[];b.post=(event)=>{delivered.push(event);return true;};other.post=same.post=(event)=>{unrelated.push(event);return true;};
  h.api.activate(h.context);await h.commands.find((c)=>c.name==="kicadVisualReview.openPair").handler(root);
  const selection={kind:"part",reference:"U1",path:"child.kicad_sch",uuid:"saved-symbol"};
  assert.equal(require("../../extension/paired-review.js").validSelection(selection),true);
  assert.equal((await send(h,a,1,{type:"pair-selection",selection})).result.delivered,1);
  assert.deepEqual(plain(delivered[0]),{channel:h.api._test.CHANNEL,token:b.token,eventId:1,event:{type:"related",selection}});assert.equal(unrelated.length,0);
  assert.equal(await send(h,a,1,{type:"pair-selection",selection}),undefined);assert.equal(delivered.length,1);
  assert.equal((await send(h,a,2,{type:"pair-selection",selection:{...selection,path:"outside.kicad_sch"}})).ok,false);
  assert.equal((await send(h,a,3,{type:"pair-selection",selection:{...selection,reference:"bad\nreference"}})).ok,false);
  assert.equal((await send(h,a,4,{type:"pair-selection",selection:{...selection,uri:"file:///secret"}})).ok,false);
  const reverse=[];a.post=(event)=>{reverse.push(event);return true;};
  const net={kind:"net",netName:"/POWER/VCC",path:"design.kicad_pcb"};assert.equal((await send(h,b,1,{type:"pair-selection",selection:net})).result.delivered,1);
  assert.deepEqual(plain(reverse[0].event.selection),net);b.disposed=true;
  assert.equal((await send(h,a,5,{type:"pair-selection",selection})).result.delivered,0);
});
test("analysis net focus reaches only original drawing sessions in the same context, repository and revision",async()=> {
 const h=harness(),drawing=await session(h),analysis=h.api._test.createSession(drawing.uri,{scope:drawing.scope,files:drawing.files},h.context,"d".repeat(48));analysis.analysisPath="report.json";
 const delivered=[];drawing.post=event=>{delivered.push(event);return true;};
 const outsiders=[];
 for(const change of [{scope:{...drawing.scope,repository:"elsewhere/repo"}},{scope:{...drawing.scope,ref:"other"}},{context:{...h.context}},{analysisPath:"other.json"},{uri:drawing.uri.with({path:drawing.uri.path.replace(/[^/]+$/,"other.kicad_sch")})}]){const view=h.api._test.createSession(drawing.uri,{scope:drawing.scope,files:drawing.files},h.context,"e".repeat(48));Object.assign(view,change);view.post=event=>{outsiders.push(event);return true;};}
 const request={type:"analysis-focus-net",repository:drawing.scope.repository,ref:drawing.scope.ref,file:drawing.scope.rootFile,netName:"/POWER/VCC"};let id=0;
 assert.equal((await send(h,analysis,++id,request)).result.delivered,1);assert.deepEqual(plain(delivered[0].event),{type:"analysis-net-focus",netName:"/POWER/VCC"});assert.equal(outsiders.length,0);
 assert.equal((await send(h,drawing,1,request)).ok,false);
 for(const change of [{file:"other.kicad_sch"},{ref:"other"},{netName:""},{netName:"bad\n"},{netName:"x".repeat(501)},{path:"invented.kicad_sch"}])assert.equal((await send(h,analysis,++id,{...request,...change})).ok,false);
 assert.equal(delivered.length,1);
});

test("paired pin relay preserves terminal identity and rejects foreign paths or unbounded fields",async()=> {
 const h=harness(),root=h.write("design.kicad_sch"),pcb=h.write("design.kicad_pcb","(kicad_pcb)"),a=await existingSession(h,root),b=await existingSession(h,pcb,"c".repeat(48)),delivered=[];
 b.post=event=>{delivered.push(event);return true;};h.api.activate(h.context);await h.commands.find(c=>c.name==="kicadVisualReview.openPair").handler(root);
 const selection={kind:"pin",path:"design.kicad_sch",reference:"J1",pinNumber:"A1",uuid:"terminal",ownerUuid:"owner",symbolUuid:"symbol"};let id=0;
 assert.equal(require("../../extension/paired-review.js").validSelection(selection),true);assert.equal((await send(h,a,++id,{type:"pair-selection",selection})).result.delivered,1);assert.deepEqual(plain(delivered[0].event.selection),selection);
 for(const changed of [{path:"outside.kicad_sch"},{pinNumber:""},{pinNumber:"A".repeat(201)},{ownerUuid:"bad\n"},{symbolUuid:32},{uri:"file:///outside"},{pinNumber:undefined}])assert.equal((await send(h,a,++id,{type:"pair-selection",selection:{...selection,...changed}})).ok,false);
 assert.equal(delivered.length,1);
});

test("paired group relay checks every hierarchy path and preserves qualified net names and empty clears",async()=> {
 const h=harness(),root=h.write("design.kicad_sch",'(kicad_sch (sheet (property "Sheetfile" "child.kicad_sch")))'),pcb=h.write("design.kicad_pcb","(kicad_pcb)");h.write("child.kicad_sch");
 const a=await existingSession(h,root),b=await existingSession(h,pcb,"c".repeat(48)),delivered=[];
 b.post=(event)=>{delivered.push(event);return true;};
 h.api.activate(h.context);await h.commands.find((c)=>c.name==="kicadVisualReview.openPair").handler(root);
 const item={kind:"net",path:"child.kicad_sch",netName:"ENABLE",qualifiedNetName:"/Power/ENABLE"};let id=0;
 for(const selection of [item,{kind:"group",items:[]},{kind:"group",items:[item,{kind:"part",path:"design.kicad_sch",reference:"U1"}]},{kind:"group",items:Array(200).fill(item)}]) {
  assert.equal((await send(h,a,++id,{type:"pair-selection",selection})).result.delivered,1);
  assert.deepEqual(plain(delivered.at(-1).event.selection),selection);
 }
 const invalid=[{kind:"group",items:Array(201).fill(item)},{kind:"group",items:[{kind:"group",items:[]}]},
  {kind:"group",items:new Array(1)},{kind:"group",items:[item,{...item,path:"outside.kicad_sch"}]},
  {kind:"group",items:[{...item,qualifiedNetName:"bad\n"}]},{kind:"group",items:[{...item,path:"../child.kicad_sch"}]},
  {kind:"group",items:[],extra:true},{kind:"group",items:[null]}];
 for(const selection of invalid)assert.equal((await send(h,a,++id,{type:"pair-selection",selection})).ok,false);
 assert.equal(delivered.length,4);
});

test("re-pairing changes selection recipient and comment refresh stays within sidecar workspace",async()=> {
  const h=harness(),root=h.write("design.kicad_sch"),first=h.write("a.kicad_pcb","(kicad_pcb)"),second=h.write("b.kicad_pcb","(kicad_pcb)");
  const a=await existingSession(h,root),b=await existingSession(h,first),c=await existingSession(h,second),outside=await existingSession(h,second);
  outside.scope={...outside.scope,boundary:Uri.parse("vscode-vfs://github/elsewhere/repo?ref=main")};const bEvents=[],cEvents=[],outsideEvents=[];
  b.post=(e)=>{bEvents.push(e);return true;};c.post=(e)=>{cEvents.push(e);return true;};outside.post=(e)=>{outsideEvents.push(e);return true;};h.api.activate(h.context);
  const command=h.commands.find((entry)=>entry.name==="kicadVisualReview.openPair").handler;await command(root);
  h.vscode.window.showQuickPick=async(items)=>items.find((item)=>item.uri.toString()===second.toString());await command(root);
  assert.equal((await send(h,a,1,{type:"pair-selection",selection:{kind:"net",path:"design.kicad_sch",netName:"GND"}})).result.delivered,1);
  assert.equal(bEvents.length,0);assert.equal(cEvents.length,1);assert.equal(outsideEvents.length,0);
  assert.equal((await send(h,a,2,{type:"comments-changed"})).result.delivered,2);
  assert.equal(bEvents[0].event.type,"comments-refresh");assert.equal(cEvents[1].event.type,"comments-refresh");assert.equal(cEvents[1].eventId,2);assert.equal(outsideEvents.length,0);
});


test("mentions and skipped state round trip with shared schema; invalid mentions and timestamp regression preserve notes",async()=> {
  const h=harness(),s=await session(h),note={...annotation(s),state:"skipped",mentions:["@Engineer","engineer","qa-user"]};
  assert.equal((await send(h,s,1,{type:"comment-save",comment:note})).ok,true);
  const stored=storedSidecar(h).annotations[0];assert.deepEqual(stored.mentions,["Engineer","qa-user"]);assert.equal(stored.state,"skipped");
  const shared=require("../../extension/review-comments.js");assert.deepEqual(shared.parseSidecar(JSON.stringify(storedSidecar(h))),[stored]);
  const bytes=h.entries.get(sidecarUri(h)).bytes.slice();
  for(const [i,mentions] of [["-bad"],["bad-"],["bad_name"],["@@bad"],["x".repeat(40)],Array(21).fill("login")].entries()) {
    assert.equal((await send(h,s,i+2,{type:"comment-save",comment:{...stored,mentions}})).ok,false);assert.deepEqual(h.entries.get(sidecarUri(h)).bytes,bytes);
  }
  assert.match((await send(h,s,8,{type:"comment-save",comment:{...stored,updatedAt:"2026-10-03T23:59:59.000Z"}})).error,/precedes creation/);
  assert.deepEqual(h.entries.get(sidecarUri(h)).bytes,bytes);
});


test('project settings and Gerbers use provider-scoped bounded reads and open read-only editors',async()=>{
 const h=harness(),s=await session(h);h.write('board.kicad_pro','{"board":{"design_settings":{"rules":{"min_clearance":0.2}}}}');h.write('fab/top.gbr','%FSLAX24Y24*%%MOMM*%M02*');h.write('linked.kicad_pro','{}',{type:65});
 h.vscode.workspace.findFiles=async()=>[...h.entries.keys()].filter(u=>/\.(kicad_(?:pro|sch)|gbr)(?:\?|$)/.test(u)).map(Uri.parse);
 const inventory=await send(h,s,1,{type:'project-inventory',...s.scope,file:s.scope.rootFile});assert.equal(inventory.ok,true);assert.ok(inventory.result.files.some(f=>f.path==='board.kicad_pro'));assert.ok(!inventory.result.files.some(f=>f.path==='linked.kicad_pro'));
 const result=await send(h,s,2,{type:'project-file',...s.scope,file:'board.kicad_pro'});assert.equal(result.ok,true);assert.equal(JSON.parse(result.result.content).board.design_settings.rules.min_clearance,0.2);
 const before=h.reads.length;assert.equal((await send(h,s,3,{type:'project-file',...s.scope,file:'../secret.kicad_pro'})).ok,false);assert.equal((await send(h,s,4,{type:'project-file',...s.scope,file:'linked.kicad_pro'})).ok,false);assert.equal(h.reads.length,before);
 assert.equal((await send(h,s,5,{type:'open-project-file',...s.scope,file:'fab/top.gbr'})).ok,true);assert.equal(h.commands.at(-1)[0],'vscode.openWith');
 const uri=h.write('new.kicad_pro','{}'),project=await h.api._test.loadProject(uri);assert.equal(project.files[0].path,'new.kicad_pro');
});


test("native STEP asset reads retain workspace scope and return the STEP media type",async()=>{
 const h=harness(),s=await session(h);h.write("models/part.step","ISO-10303-21; fixture");h.write("models/part.stp","ISO-10303-21; other");
 for(const [i,file]of ["models/part.step","models/part.stp"].entries()){
  const reply=await send(h,s,i+1,assetRequest(s,file));assert.equal(reply.ok,true);assert.equal(reply.result.mediaType,"model/step");assert.match(Buffer.from(reply.result.base64,'base64').toString(),/ISO-10303-21/);
 }
});


test("Windows local file scope tolerates drive-letter normalization without widening provider or folder scope",async()=>{
 const h=harness(Uri.parse("file:///D:/Project")),root=h.write("root.kicad_sch");
 const lowerDrive=root.with({path:"/d:/Project/root.kicad_sch"});
 assert.equal(h.api._test.sameScope(lowerDrive,h.folder),true);assert.equal(h.api._test.projectScope(lowerDrive).rootFile,"root.kicad_sch");assert.equal((await h.api._test.loadProject(lowerDrive)).files.length,1);
 for(const uri of [lowerDrive.with({path:"/d:/ProjectElse/root.kicad_sch"}),lowerDrive.with({path:"/d:/project/root.kicad_sch"}),lowerDrive.with({authority:"other"}),lowerDrive.with({query:"ref=other"}),lowerDrive.with({fragment:"other"})])assert.equal(h.api._test.sameScope(uri,h.folder),false);
 assert.equal(h.api._test.sameScope(Uri.parse("vscode-vfs://github/d:/Project/root.kicad_sch"),Uri.parse("vscode-vfs://github/D:/Project")),false);
});


test("Windows Open and Split commands validate the local file after its drive prefix",async()=>{
 const h=harness(Uri.parse("file:///D:/Project")),root=h.write("design.kicad_sch");h.write("design.kicad_pcb","(kicad_pcb)");h.api.activate(h.context);
 await h.commands.find(c=>c.name==="kicadVisualReview.open").handler(root);assert.ok(h.commands.some(c=>Array.isArray(c)&&c[0]==="vscode.openWith"&&c[1].path===root.path));
 await h.commands.find(c=>c.name==="kicadVisualReview.openPair").handler(root);assert.equal(h.commands.filter(c=>Array.isArray(c)&&c[0]==="vscode.openWith").length,3);
 const count=h.commands.filter(Array.isArray).length;
 await h.commands.find(c=>c.name==="kicadVisualReview.open").handler(root.with({path:"/D:/Project/../bad.kicad_sch"}));assert.equal(h.commands.filter(Array.isArray).length,count);
});

test('incomplete saved schematic reports its exact path and source recovery guidance',async()=>{
 const h=harness(),uri=h.write('subdir/broken.kicad_sch','(kicad_sch (version 20250114)');
 await assert.rejects(h.api._test.loadProject(uri),error=>/subdir\/broken.kicad_sch: Incomplete KiCad S-expression/.test(error.message)&&/Text Editor/.test(error.message));
});
test('KiCad Sheet file spelling discovers referenced children in VS Code',async()=>{
 const h=harness(),uri=h.write('root.kicad_sch','(kicad_sch (sheet (property "Sheet file" "nested/child.kicad_sch")))');h.write('nested/child.kicad_sch');
 const project=await h.api._test.loadProject(uri);assert.deepEqual(plain(project.files.map(f=>f.path)),['root.kicad_sch','nested/child.kicad_sch']);
});

test('unresolved Git conflict is identified without writing source',async()=>{
 const h=harness(),content='(kicad_sch\n<<<<<<< HEAD\n(symbol)\n=======\n(sheet)\n>>>>>>> branch\n)',uri=h.write('conflict.kicad_sch',content);
 await assert.rejects(h.api._test.loadProject(uri),/conflict.kicad_sch: Unresolved Git merge conflict at line 2/);
 assert.equal(new TextDecoder().decode(h.entries.get(uri.toString()).bytes),content);
});


test('workspace model inventory is session-scoped, excludes linked ancestors and never reads asset bytes',async()=>{
 const h=harness(),s=await session(h);const model=h.write('models/Package.3dshapes/body.step','model');
 const linked=h.write('linked/body.wrl','model'),direct=h.write('direct.wrl','model',{type:65});
 h.write('linked','',{type:66});const nonmodel=h.write('notes.txt','notes');
 h.vscode.workspace.findFiles=async()=>[model,linked,direct,nonmodel,Uri.parse('vscode-vfs://evil/owner/repo/body.wrl?ref=main')];
 const reads=h.reads.length,input={type:'repo-model-index',repository:s.scope.repository,ref:s.scope.ref};
 const result=await send(h,s,1,input);assert.equal(result.ok,true,result.error);
 assert.deepEqual(plain(result.result.paths),['models/Package.3dshapes/body.step']);assert.equal(result.result.snapshotRef,s.scope.ref);
 assert.match(result.result.warnings.join(' '),/linked model excluded/);assert.equal(h.reads.length,reads);
 const count=h.stats.length;assert.equal((await send(h,s,2,{...input,ref:'other'})).ok,false);assert.equal(h.stats.length,count);
 h.vscode.workspace.findFiles=async()=>Array(5001).fill(nonmodel);
 const bounded=await send(h,s,3,input);assert.match(bounded.result.warnings.join(' '),/5000 files/);
});


function browsing(h,{trusted=true,repo=null}={}){
 h.vscode.workspace.isTrusted=trusted;const directoryReads=[];
 h.entries.set(h.folder.toString(),{type:2,size:0});
 h.vscode.workspace.fs.readDirectory=async uri=>{
  directoryReads.push(uri.toString());const prefix=uri.path.replace(/\/$/,'')+'/';
  return [...h.entries].map(([key,item])=>[Uri.parse(key),item]).filter(([entry])=>entry.scheme===uri.scheme&&entry.authority===uri.authority&&entry.query===uri.query&&entry.path.startsWith(prefix)&&!entry.path.slice(prefix.length).includes('/')).map(([entry,item])=>[entry.path.slice(prefix.length),item.type||1]);
 };
 h.vscode.extensions={getExtension:()=>repo?{isActive:true,exports:{getAPI:()=>({repositories:[repo]})}}:undefined};
 return directoryReads;
}
const hash=n=>n.toString(16).padStart(40,'0');
test('repository inventory lists provider files without reading bytes, excludes symlinks and warns that virtual history is unavailable',async()=>{
 const h=harness(),s=await session(h);h.write('docs/readme.txt','text');h.write('linked/secret.txt','secret');h.entries.set(Uri.joinPath(h.folder,'linked').toString(),{type:66});h.write('.git/config','private');browsing(h);
 const before=h.reads.length,result=await send(h,s,1,{type:'repository-tree',repository:s.scope.repository,ref:s.scope.ref});assert.equal(result.ok,true);const tree=plain(result.result);
 assert.deepEqual(tree.entries.map(e=>e.path),['docs','docs/readme.txt','root.kicad_sch']);assert.equal(h.reads.length,before);assert.equal(tree.workingTree,true);assert.equal(tree.sha,null);assert.ok(tree.entries.every(e=>e.sha===null&&e.mode===null));assert.match(tree.warnings.join(' '),/virtual workspace/);assert.match(tree.warnings.join(' '),/Symbolic-link/);
 const history=await send(h,s,2,{type:'repository-history',repository:s.scope.repository,ref:s.scope.ref});assert.equal(history.ok,true);assert.deepEqual(plain(history.result.commits),[]);assert.equal(history.result.hasMore,false);assert.match(history.result.warnings.join(' '),/virtual workspace/);
});
test('local working tree uses real HEAD and Git state badges, never fabricates blob hashes or claims a historical tree',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h);h.write('board.kicad_pcb','(kicad_pcb)');h.write('docs/notes.txt','text');let commits=0;
 const repo={rootUri:h.folder,state:{HEAD:{commit:hash(8)},indexChanges:[{uri:Uri.joinPath(h.folder,'docs/notes.txt'),status:1}],workingTreeChanges:[{uri:Uri.joinPath(h.folder,'board.kicad_pcb'),status:5},{uri:Uri.joinPath(h.folder,'deleted.txt'),status:6}],mergeChanges:[]},getCommit:async sha=>{commits++;return{hash:sha};}};browsing(h,{repo});
 const reads=h.reads.length,result=await send(h,s,1,{type:'repository-tree',repository:s.scope.repository,ref:s.scope.ref});assert.equal(result.ok,true);const tree=plain(result.result),entries=new Map(tree.entries.map(e=>[e.path,e]));
 assert.equal(tree.sha,hash(8));assert.equal(tree.treeRef,'HEAD');assert.equal(tree.workingTree,true);assert.equal(entries.get('docs').status,'modified');assert.equal(entries.get('docs/notes.txt').status,'added');assert.equal(entries.get('docs/notes.txt').staged,true);assert.equal(entries.get('board.kicad_pcb').status,'modified');assert.equal(entries.get('deleted.txt').status,'deleted');assert.equal(h.reads.length,reads);assert.equal(commits,0);
 const historical=await send(h,s,2,{type:'repository-tree',repository:s.scope.repository,ref:s.scope.ref,sha:hash(4)});assert.equal(historical.ok,false);assert.match(historical.error,/No working files were substituted/);assert.equal(h.reads.length,reads);assert.equal(commits,1,'historical requests verify the commit and fail closed when this provider lacks a configured Git executable');
});
test('lazy repository directories paginate full paths and reject unsafe names and linked ancestors before listing',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h);for(let i=0;i<250;i++)h.write('parts/'+String(i).padStart(3,'0')+'.txt','x');h.write('linked/nested/secret.txt','x');h.entries.set(Uri.joinPath(h.folder,'linked').toString(),{type:66});const reads=browsing(h);
 const request={type:'repository-tree',repository:s.scope.repository,ref:s.scope.ref,directory:'parts'};
 const first=await send(h,s,1,request);assert.equal(first.ok,true);assert.equal(first.result.entries.length,200);assert.equal(first.result.entries[0].path,'parts/000.txt');assert.equal(first.result.hasMore,true);assert.equal(first.result.nextPage,2);
 const second=await send(h,s,2,{...request,page:2});assert.equal(second.result.entries.length,50);assert.equal(second.result.hasMore,false);assert.equal(second.result.entries[0].path,'parts/200.txt');const before=reads.length;
 for(const [id,directory]of [[3,'../outside'],[4,'.git'],[5,'linked/nested'],[6,'parts/../../outside']])assert.equal((await send(h,s,id,{...request,directory})).ok,false);
 assert.equal(reads.length,before);
});
test('repository history is repo-wide, keeps real merge parents and pins pages while HEAD changes',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h),calls=[];
 const records=Array.from({length:31},(_,i)=>({hash:hash(i+1),parents:i===0?[hash(101),hash(102)]:[hash(i+2)],message:'Commit '+i,authorName:'Author',authorEmail:'not-returned@example.test',commitDate:new Date('2026-10-25T12:00:00Z')}));
 const repo={rootUri:h.folder,state:{HEAD:{commit:hash(1)}},log:async options=>{calls.push(options);return options.skip?records.slice(30):records;}};browsing(h,{repo});const request={type:'repository-history',repository:s.scope.repository,ref:s.scope.ref};
 const first=await send(h,s,1,request);assert.equal(first.ok,true);assert.equal(first.result.commits.length,30);assert.deepEqual(plain(first.result.commits[0].parents),[hash(101),hash(102)]);assert.equal(first.result.commits[0].date,'2026-10-25T12:00:00.000Z');assert.equal(first.result.commits[0].author,'Author');assert.equal(first.result.commits[0].authorEmail,undefined);assert.equal(first.result.hasMore,true);assert.equal(first.result.nextPage,2);
 repo.state.HEAD.commit=hash(99);const second=await send(h,s,2,{...request,page:2});assert.equal(second.result.sha,hash(1));assert.equal(second.result.commits.length,1);assert.equal(second.result.hasMore,false);assert.deepEqual(plain(calls),[{maxEntries:31,skip:0,refNames:[hash(1)]},{maxEntries:31,skip:30,refNames:[hash(1)]}]);
 await send(h,s,3,request);assert.deepEqual(plain(calls.at(-1).refNames),[hash(99)],'first-page Refresh must not reuse an old HEAD pin');
});
test('Restricted Mode and missing Git return honest empty history and do not activate Git or run programs',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h);browsing(h,{trusted:false});let calls=0;h.vscode.extensions.getExtension=()=>{calls++;throw Error('must not activate');};
 const request={type:'repository-history',repository:s.scope.repository,ref:s.scope.ref};const restricted=await send(h,s,1,request);assert.equal(restricted.ok,true);assert.equal(restricted.result.commits.length,0);assert.match(restricted.result.warnings.join(' '),/Restricted Mode/);assert.equal(calls,0);
 h.vscode.workspace.isTrusted=true;h.vscode.extensions.getExtension=()=>undefined;const absent=await send(h,s,2,request);assert.equal(absent.ok,true);assert.equal(absent.result.commits.length,0);assert.match(absent.result.warnings.join(' '),/No local Git/);
 const denied=await send(h,s,3,{...request,repository:'other/repo'});assert.equal(denied.ok,false);assert.equal((await send(h,s,4,{...request,page:101})).ok,false);assert.equal((await send(h,s,5,{...request,sha:'HEAD; injected'})).ok,false);
});


test('repository branch list uses real local/remote Git refs, excludes tags and does not filter by the opened file',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h),repo={rootUri:h.folder,state:{HEAD:{name:'main',commit:hash(1)},refs:[{name:'main',commit:hash(1),type:0},{name:'feature/board',commit:hash(2),type:0},{name:'origin/main',commit:hash(3),type:1},{name:'v1',commit:hash(4),type:2},{name:'bad',commit:'HEAD',type:0}]}};browsing(h,{repo});
 const result=await send(h,s,1,{type:'repository-branches',repository:s.scope.repository,ref:s.scope.ref});assert.equal(result.ok,true);assert.deepEqual(plain(result.result.branches),[{name:'feature/board',sha:hash(2),type:'branch',current:false},{name:'main',sha:hash(1),type:'branch',current:true},{name:'origin/main',sha:hash(3),type:'remote',current:false}]);assert.equal(result.result.truncated,false);
 h.vscode.workspace.isTrusted=false;const unavailable=await send(h,s,2,{type:'repository-branches',repository:s.scope.repository,ref:s.scope.ref});assert.equal(unavailable.ok,true);assert.deepEqual(plain(unavailable.result.branches),[]);assert.match(unavailable.result.warnings.join(' '),/Restricted Mode/);
});


test('repository listing is bounded and no-Git provider fallback does not read source bytes',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h);for(let i=0;i<10010;i++)h.entries.set(Uri.joinPath(h.folder,'item-'+i+'.txt').toString(),{type:1,size:1});browsing(h);const before=h.reads.length;
 const result=await send(h,s,1,{type:'repository-tree',repository:s.scope.repository,ref:s.scope.ref});assert.equal(result.ok,true);assert.equal(result.result.entries.length,10000);assert.equal(result.result.truncated,true);assert.match(result.result.warnings.join(' '),/10,000/);assert.equal(h.reads.length,before);
 const virtual=harness(),v=await session(virtual);const fallback=await send(virtual,v,1,{type:'repository-tree',repository:v.scope.repository,ref:v.scope.ref});assert.equal(fallback.ok,true);assert.deepEqual(plain(fallback.result.entries.map(e=>e.path)),['root.kicad_sch']);assert.match(fallback.result.warnings.join(' '),/cannot enumerate directories/);
});
test('history filters invalid provider identities and bounds metadata without fabricating parent edges',async()=>{
 const h=harness(Uri.parse('file:///repo/sub')),s=await session(h),repo={rootUri:Uri.parse('file:///repo'),state:{HEAD:{commit:hash(1)}},log:async()=>[{hash:hash(1),parents:[hash(2),hash(3)],message:'x'.repeat(5000),authorName:'safe\nname'},{hash:'bad',parents:[]},{hash:hash(4),parents:['bad']}]};browsing(h,{repo});
 const result=await send(h,s,1,{type:'repository-history',repository:s.scope.repository,ref:s.scope.ref});assert.equal(result.ok,true);assert.equal(result.result.commits.length,1);assert.deepEqual(plain(result.result.commits[0].parents),[hash(2),hash(3)]);assert.equal(result.result.commits[0].message.length,4096);assert.equal(result.result.commits[0].date,null);assert.match(result.result.warnings.join(' '),/invalid Git commit/);
 const tree=await send(h,s,2,{type:'repository-tree',repository:s.scope.repository,ref:s.scope.ref});assert.match(tree.result.warnings.join(' '),/history covers the whole Git repository/);
});


test('history preserves an explicitly selected commit while refreshing an unpinned first page',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h),calls=[],repo={rootUri:h.folder,state:{HEAD:{commit:hash(1)}},getCommit:async sha=>({hash:sha}),log:async options=>{calls.push(options);return[];}};browsing(h,{repo});const request={type:'repository-history',repository:s.scope.repository,ref:s.scope.ref};
 await send(h,s,1,{...request,sha:hash(8)});repo.state.HEAD.commit=hash(2);await send(h,s,2,{...request,sha:hash(8),page:2});assert.deepEqual(plain(calls.map(call=>call.refNames)),[[hash(8)],[hash(8)]]);
 await send(h,s,3,request);assert.deepEqual(plain(calls.at(-1).refNames),[hash(2)]);
});
test('Git browsing stops if workspace trust is revoked during activation or history reading',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h);browsing(h);let apiCalls=0;h.vscode.extensions.getExtension=()=>({isActive:false,activate:async()=>{h.vscode.workspace.isTrusted=false;return{getAPI(){apiCalls++;return{repositories:[]};}};}});
 const result=await send(h,s,1,{type:'repository-history',repository:s.scope.repository,ref:s.scope.ref});assert.equal(result.ok,true);assert.equal(apiCalls,0);assert.deepEqual(plain(result.result.commits),[]);assert.match(result.result.warnings.join(' '),/trust changed/);
 const j=harness(Uri.parse('file:///repo')),t=await session(j),repo={rootUri:j.folder,state:{HEAD:{commit:hash(1)}},log:async()=>{j.vscode.workspace.isTrusted=false;return[{hash:hash(1),parents:[],message:'Must not publish after revocation'}];}};browsing(j,{repo});
 const stopped=await send(j,t,1,{type:'repository-history',repository:t.scope.repository,ref:t.scope.ref});assert.equal(stopped.ok,true);assert.deepEqual(plain(stopped.result.commits),[]);assert.match(stopped.result.warnings.join(' '),/trust changed/);
});
test('bounded branch list retains current branch even after an alphabetically earlier 200 branches',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h),repo={rootUri:h.folder,state:{HEAD:{name:'zz-current',commit:hash(999)},refs:Array.from({length:220},(_,i)=>({name:'branch-'+String(i).padStart(3,'0'),commit:hash(i+1),type:0}))}};browsing(h,{repo});
 const result=await send(h,s,1,{type:'repository-branches',repository:s.scope.repository,ref:s.scope.ref});assert.equal(result.ok,true);assert.equal(result.result.branches.length,200);assert.equal(result.result.truncated,true);assert.ok(result.result.branches.some(branch=>branch.current&&branch.name==='zz-current'));
});
test('compact conflict webview keeps draw-first defaults, secondary controls and confined runtime resources',async()=>{
 const h=harness(),s=await session(h),template=fs.readFileSync(path.join(__dirname,'../../extension/conflict-viewer.html'),'utf8');h.entries.set('file:///extension/media/conflict-viewer.html',{bytes:new TextEncoder().encode(template)});
 const webview={cspSource:'https://resources.example',asWebviewUri:uri=>({toString:()=>`https://resources.example${uri.path}`})},html=await h.api._test.conflictHTML(webview,h.context,s);
 assert.match(html,/<body class="properties-hidden">/);assert.match(html,/id="toggleProperties" aria-pressed="false"/);assert.match(html,/id="viewOptions" aria-expanded="false"/);assert.match(html,/id="viewOptionsPanel"[^>]* hidden/);assert.match(html,/frame-src &#39;none&#39;/);assert.match(html,/src="https:\/\/resources.example\/extension\/media\/conflict-viewer.js"/);assert.match(html,/href="https:\/\/resources.example\/extension\/media\/conflict-viewer.css"/);
 for(const match of html.matchAll(/<script[^>]+src="([^"]+)"/g))assert.ok(match[1].startsWith('https://resources.example/extension/'));
 assert.match(html,/id="saveOriginal" disabled/);assert.match(html,/Original file stays unchanged until you save/);
});
test('trusted native Git workspace enables sanitized collaboration bootstrap and host-bound image sources',async()=>{
 const h=harness(Uri.parse('file:///repo')),s=await session(h);h.vscode.workspace.isTrusted=true;
 const repo={rootUri:h.folder,state:{HEAD:{commit:'a'.repeat(40)},remotes:[{name:'origin',fetchUrl:'git@github.com:owner/board.git'}]},show:async()=>'(kicad_sch)'};
 h.vscode.extensions={getExtension:()=>({isActive:true,exports:{getAPI:()=>({git:{path:'C:/safe/git.exe'},repositories:[repo]})}})};
 h.entries.set(Uri.joinPath(h.context.extensionUri,'media','revision-viewer.html').toString(),{bytes:new TextEncoder().encode('<html><head></head><body><section id="commentsPane"><h2>Review</h2><p class="hint">Help</p></section></body></html>')});
 const webview={cspSource:'vscode-resource:',asWebviewUri:uri=>({toString:()=>uri.toString()})};const html=await h.api._test.htmlFor(webview,h.context,s);
 assert.match(html,/"collaboration":\{"provider":"github","host":"https:\/\/github.com","repository":"owner\/board","ref":"a{40}"/);assert.doesNotMatch(html,/C:\/safe\/git.exe/);assert.match(html,/https:\/\/github.com\/user-attachments\//);assert.doesNotMatch(html,/\.github-publish-action\{display:none/);
});

test('bound GitLab publication receipts and attachments survive sidecar edits without rebinding local anchors',async()=>{
 const h=harness(),s=await session(h);s.remoteBinding={provider:'gitlab',host:'https://gitlab.example.com',repository:'team/project',ref:'a'.repeat(40),prefix:''};
 const note=annotation(s);note.mentions=['reviewer.user'];note.remoteRefs=[{provider:'gitlab',host:'https://gitlab.example.com',repository:'team/project',kind:'issue',number:4,url:'https://gitlab.example.com/team/project/-/issues/4#note_9',publishedAt:note.createdAt}];
 let reply=await send(h,s,1,{type:'comment-save',comment:note});assert.equal(reply.ok,true,reply.error);assert.equal(storedSidecar(h).annotations[0].anchor.repository,'local/workspace');
 reply=await send(h,s,2,{type:'comment-list',...scopeOf(s)});assert.equal(reply.ok,true,reply.error);assert.equal(reply.result[0].remoteRefs[0].provider,'gitlab');assert.equal(reply.result[0].mentions[0],'reviewer.user');
 const foreign={...reply.result[0],remoteRefs:[{...note.remoteRefs[0],host:'https://other.example.com',url:'https://other.example.com/team/project/-/issues/4#note_9'}]};
 const rejected=await send(h,s,3,{type:'comment-save',comment:foreign});assert.equal(rejected.ok,false);assert.match(rejected.error,/GitLab|reference/);assert.equal(storedSidecar(h).annotations[0].remoteRefs[0].host,'https://gitlab.example.com');
});

test('net-anchored review notes retain readable net identity through VS Code sidecars',async()=>{
 const h=harness(),s=await session(h),note=annotation(s);note.anchor.kind='net';note.anchor.netName='POWER_3V3';
 const reply=await send(h,s,1,{type:'comment-save',comment:note});assert.equal(reply.ok,true,reply.error);assert.equal(storedSidecar(h).annotations[0].anchor.netName,'POWER_3V3');
});


test('Level 1 review severity survives VS Code sidecar save and reopen',async()=>{
 const h=harness(),s=await session(h),note=annotation(s);note.severity='level-1';assert.equal((await send(h,s,1,{type:'comment-save',comment:note})).ok,true);const reopened=await session(h),loaded=(await send(h,reopened,1,{type:'comment-list',...scopeOf(reopened)})).result[0];assert.equal(loaded.severity,'level-1');assert.equal(storedSidecar(h).annotations[0].severity,'level-1');
});


test('Closed review state survives VS Code save and reopen without changing a provider issue',async()=>{
 const h=harness(),s=await session(h),note=annotation(s);note.state='closed';assert.equal((await send(h,s,1,{type:'comment-save',comment:note})).ok,true);const reopened=await session(h),loaded=(await send(h,reopened,1,{type:'comment-list',...scopeOf(reopened)})).result[0];assert.equal(loaded.state,'closed');
});
