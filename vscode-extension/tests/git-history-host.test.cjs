'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../extension.js'),'utf8'),SHA='a'.repeat(40),OLD='b'.repeat(40);
class Uri{
 constructor(value){const u=new URL(value);Object.assign(this,{scheme:u.protocol.slice(0,-1),authority:u.host,path:u.pathname,query:u.search.slice(1),fragment:''});}
 static joinPath(base,...parts){return base.with({path:path.posix.join(base.path,...parts)});}
 get fsPath(){return this.path;}
 with(changes){return Object.assign(Object.create(Uri.prototype),this,changes);}
 toString(){return `${this.scheme}://${this.authority}${this.path}${this.query?'?'+this.query:''}`;}
}
function harness(){
 const root=new Uri('file:///repo'),boundary=new Uri('file:///repo/hardware'),uri=Uri.joinPath(boundary,'root.kicad_sch');
 const data=new Map([['hardware/root.kicad_sch','(kicad_sch (sheet (property "Sheetfile" "sub/child.kicad_sch")))'],['hardware/sub/child.kicad_sch','(kicad_sch)'],['hardware/models/part.step','SAVED MODEL'],['hardware/drc.json','{"saved":true}'],['hardware/board.kicad_pcb','(kicad_pcb)'],['hardware/board.kicad_pro','{}']]);
 const reads=[],panels=[],states=new Map();let created;
 const reader={async read(request){reads.push(request);assert.ok([SHA,OLD].includes(request.sha));if(!data.has(request.path))throw Error('Missing historical source');return{bytes:new TextEncoder().encode(data.get(request.path))};},async inventory({sha,directory}){return{sha,source:'git-object',workingTree:false,warnings:[],entries:[...data.keys()].filter(p=>p.startsWith(directory+'/')).map(p=>({path:p,name:p.split('/').at(-1),kind:'file',type:'blob',size:data.get(p).length}))};},async tree(request){return{...await this.inventory(request),treeRef:request.sha,hasMore:false,nextPage:null};}};
 const repo={rootUri:root,state:{HEAD:{commit:SHA},refs:[]},getCommit:async sha=>({hash:sha}),log:async options=>[{hash:options.refNames[0],parents:[],message:'Saved commit message',authorName:'Fixture'}]};
 const vscode={Uri,FileType:{File:1,Directory:2,SymbolicLink:64},ViewColumn:{Beside:2},workspace:{isTrusted:true,getWorkspaceFolder:()=>({uri:boundary}),fs:{async readFile(target){assert.ok(target.path.startsWith('/extension/'),'working source must never be read');return new TextEncoder().encode('<html><head></head><section id="commentsPane"><h2>Comments</h2><p class="hint">Notes</p></section></html>');},async stat(){throw Error('Working-tree stat forbidden');},async writeFile(){throw Error('Writes forbidden');}}},extensions:{getExtension:()=>({isActive:true,exports:{getAPI:()=>({git:{path:'/official/git'},repositories:[repo]})}})},window:{createWebviewPanel(type,title,column,options){const panel={title,options,webview:{cspSource:'test:',asWebviewUri:x=>x,onDidReceiveMessage:fn=>(panel.receive=fn,{dispose(){}}),postMessage:async message=>{panel.messages.push(message);}},messages:[],onDidDispose:fn=>panel.onDispose=fn,dispose(){this.onDispose?.();}};panels.push(panel);return panel;}},commands:{executeCommand(){throw Error('Working file open forbidden');}}};
 const sandbox={module:{exports:{}},require(name){if(name==='vscode')return vscode;if(name==='./media/parsing.js')return require('../../extension/parsing.js');if(name==='./media/review-comments.js')return require('../../extension/review-comments.js');if(name==='./remote-collaboration.js')return{createHost:()=>({operations:new Set(['comment-publish']),publicContext:async()=>null,dispatch:async()=>{throw Error('Historical remote publication reached provider');}})};if(name==='./git-history-tree.js')return{createGitHistoryReader(options){created=options;return reader;}};throw Error('Unexpected module '+name);},TextDecoder,TextEncoder,Uint8Array,URLSearchParams,crypto:require('node:crypto').webcrypto};
 vm.runInNewContext(source,sandbox);const api=sandbox.module.exports._test,context={extensionUri:new Uri('file:///extension'),workspaceState:{get:k=>states.get(k),update:async(k,v)=>states.set(k,v)}};
 const session=api.createSession(uri,{scope:{boundary,rootFile:'root.kicad_sch',repository:'local/workspace',ref:'workspace'},files:[{path:'root.kicad_sch',content:'WORKING'}]},context,'c'.repeat(48));
 let id=0;async function send(request){let reply;await api.handleMessage({channel:api.CHANNEL,token:session.token,id:++id,request:{repository:session.scope.repository,ref:session.scope.ref,...request}},session,message=>{reply=message.reply;});return reply;}
 return{api,vscode,session,send,panels,data,reads,reader,get created(){return created;}};
}
test('selected commit trees use official Git root and immutable entries with workspace prefix removed',async()=>{
 const h=harness(),reply=await h.send({type:'repository-tree',sha:OLD,directory:''});
 assert.equal(reply.ok,true);assert.equal(reply.result.workingTree,false);assert.equal(reply.result.canOpenHistorical,true);assert.equal(reply.result.treeRef,OLD);assert.ok(reply.result.entries.some(e=>e.path==='root.kicad_sch'));
 assert.equal(h.created.gitPath,'/official/git');assert.equal(h.created.rootPath,'/repo');assert.equal(h.created.isTrusted(),true);
 h.vscode.workspace.isTrusted=false;const denied=await h.send({type:'repository-tree',sha:OLD,directory:''});assert.equal(denied.ok,false);assert.match(denied.error,/trusted desktop/);
});
test('opening saved source creates an independent SHA-pinned session with saved hierarchy and assets',async()=>{
 const h=harness(),reply=await h.send({type:'repository-open-file',path:'root.kicad_sch',sha:OLD});assert.equal(reply.ok,true);assert.equal(reply.result.workingTree,false);
 const panel=h.panels[0],bootstrap=JSON.parse(panel.webview.html.match(/globalThis.KiCadVSCodeContext=(.*?);<\/script>/)[1]);assert.equal(bootstrap.historical,true);assert.match(bootstrap.search,new RegExp(OLD));assert.match(panel.title,/bbbbbbbb/);
 let id=0;async function saved(request){await panel.receive({channel:h.api.CHANNEL,token:bootstrap.token,id:++id,request:{repository:'local/workspace',ref:OLD,file:'root.kicad_sch',...request}});return panel.messages.at(-1).reply;}
 const project=await saved({type:'project'});assert.equal(project.ok,true);assert.deepEqual(Array.from(project.result,f=>f.path),['root.kicad_sch','sub/child.kicad_sch']);assert.ok(!project.result.some(f=>f.content==='WORKING'));
 const history=await saved({type:'repository-history'});assert.equal(history.ok,true);assert.equal(history.result.commits[0].sha,OLD);assert.equal(history.result.commits[0].message,'Saved commit message');
 assert.equal((await saved({type:'project-file',file:'board.kicad_pcb'})).result.content,'(kicad_pcb)');
 assert.equal((await saved({type:'repo-asset',file:'models/part.step'})).result.base64,Buffer.from('SAVED MODEL').toString('base64'));
 assert.equal((await saved({type:'repo-model-index'})).result.paths[0],'models/part.step');
 assert.equal((await saved({type:'rule-report',reportPath:'drc.json'})).result.content,'{"saved":true}');
 assert.equal((await saved({type:'project-inventory'})).result.snapshotRef,OLD);
 assert.ok(h.reads.some(read=>read.path==='hardware/root.kicad_sch'&&read.maxBytes===256*1024*1024));
 assert.ok(h.reads.some(read=>read.path==='hardware/models/part.step'&&read.maxBytes===8*1024*1024));
 const search=await saved({type:'project-search-files'});assert.equal(search.ok,true);assert.equal(search.result.settings[0].path,'board.kicad_pro');assert.ok(h.reads.every(read=>read.sha===OLD));
 for(const type of ['comment-save','comment-delete','comment-publish']){const denied=await saved({type});assert.equal(denied.ok,false);assert.match(denied.error,/read-only/);}
 assert.equal((await saved({type:'comment-list'})).result.length,0);
 const missing=await saved({type:'project-file',file:'missing.kicad_pcb'});assert.equal(missing.ok,false);assert.match(missing.error,/Missing historical source/);
 panel.dispose();
});
test('saved hierarchy loads beyond the former 32-sheet limit at one immutable commit',async()=>{
 const h=harness();
 h.data.set('hardware/root.kicad_sch',`(kicad_sch ${Array.from({length:32},(_,i)=>`(sheet (property "Sheetfile" "s${i}.kicad_sch"))`).join(' ')})`);
 for(let i=0;i<32;i++)h.data.set(`hardware/s${i}.kicad_sch`,'(kicad_sch)');
 const reply=await h.send({type:'repository-open-file',path:'root.kicad_sch',sha:OLD});
 assert.equal(reply.ok,true);assert.equal(h.panels.length,1);
 assert.equal(h.reads.filter(read=>read.path.endsWith('.kicad_sch')).length,33);
 assert.ok(h.reads.every(read=>read.sha===OLD));
 h.panels[0].dispose();
});
test('historical open rejects traversal, missing sources and unavailable Git without working fallback',async()=>{
 const h=harness();for(const file of ['../outside.kicad_pcb','missing.kicad_pcb'])assert.equal((await h.send({type:'repository-open-file',sha:OLD,path:file})).ok,false);
 assert.equal(h.panels.length,0);h.vscode.extensions.getExtension=()=>undefined;
 const missing=await h.send({type:'repository-tree',sha:OLD,directory:''});assert.equal(missing.ok,false);assert.match(missing.error,/No working files were substituted/);
});

test('historical cross-file search preserves immutable revision and target identity in the new saved viewer',async()=>{
 const h=harness();assert.equal((await h.send({type:'repository-open-file',path:'root.kicad_sch',sha:OLD})).ok,true);
 const panel=h.panels[0],initial=JSON.parse(panel.webview.html.match(/globalThis.KiCadVSCodeContext=(.*?);<\/script>/)[1]);let id=0;
 const saved=async request=>{await panel.receive({channel:h.api.CHANNEL,token:initial.token,id:++id,request:{repository:'local/workspace',ref:OLD,file:'root.kicad_sch',...request}});return panel.messages.at(-1).reply;};
 assert.equal((await saved({type:'project-search-files'})).ok,true);
 const result={kind:'object',path:'board.kicad_pcb',uuid:'saved-part',position:{x:1,y:2},view:'3d'};
 assert.equal((await saved({type:'open-project-drawing',file:result.path,searchResult:result})).ok,true);
 const target=JSON.parse(h.panels[1].webview.html.match(/globalThis.KiCadVSCodeContext=(.*?);<\/script>/)[1]);
 assert.equal(target.historical,true);assert.equal(target.drawingFile,result.path);assert.match(target.search,new RegExp(OLD));assert.deepEqual(target.searchResult,result);assert.ok(h.reads.every(read=>read.sha===OLD));
});

test('commit comparison uses unsaved current text and immutable saved source, with no writable receiver',async()=>{
 const h=harness(),uri=Uri.joinPath(h.session.scope.boundary,'root.kicad_sch');
 h.vscode.workspace.fs.stat=async target=>({type:target.path.endsWith('.kicad_sch')?1:2,size:12});
 h.vscode.workspace.textDocuments=[{uri,isDirty:true,getText:()=>'(kicad_sch (version 999))'}];
 const result=await h.send({type:'repository-compare-current',sha:OLD,path:'root.kicad_sch'});assert.equal(result.ok,true);assert.equal(result.result.unsaved,true);assert.equal(result.result.readOnly,true);
 const panel=h.panels[0],token=JSON.parse(panel.webview.html.match(/globalThis.KiCadVSCodeContext=(.*?);<\/script>/)[1]).token;
 await panel.receive({channel:h.api.CHANNEL,token,id:1,request:{type:'conflict-load'}});
 const loaded=panel.messages.at(-1).reply.result;assert.equal(loaded.current,'(kicad_sch (version 999))');assert.equal(loaded.incoming,h.data.get('hardware/root.kicad_sch'));assert.equal(loaded.readOnly,true);assert.equal(loaded.sha,OLD);
 for(const type of ['conflict-save','conflict-stage']){await panel.receive({channel:h.api.CHANNEL,token,id:panel.messages.length+1,request:{type}});assert.equal(panel.messages.at(-1).reply.ok,false);assert.match(panel.messages.at(-1).reply.error,/read-only/);}
 h.vscode.workspace.isTrusted=false;await panel.receive({channel:h.api.CHANNEL,token,id:9,request:{type:'conflict-load'}});assert.equal(panel.messages.at(-1).reply.ok,false);panel.dispose();
});

test('revision actions bind the current drawing, immutable scope and trust; export cancellation has no writes',async()=>{
 const h=harness();for(const request of [{type:'repository-compare-current',path:'board.kicad_pcb'},{type:'repository-compare-current',path:'../root.kicad_sch'},{type:'repository-export-revision',path:'root.kicad_sch',copy:'yes'},{type:'repository-export-revision',path:'root.kicad_sch',copy:true,ref:OLD}])assert.equal((await h.send({sha:OLD,...request})).ok,false);
 h.vscode.window.showSaveDialog=async()=>undefined;const cancelled=await h.send({type:'repository-export-revision',path:'root.kicad_sch',sha:OLD,copy:false});assert.equal(cancelled.ok,true);assert.equal(cancelled.result.cancelled,true);
 h.vscode.workspace.isTrusted=false;assert.equal((await h.send({type:'repository-export-revision',path:'root.kicad_sch',sha:OLD,copy:true})).ok,false);assert.equal(h.panels.length,0);
});

test('revision actions permit loaded child sheets while keeping unrelated workspace drawings outside the session',async()=>{
 const h=harness(),child='sub/child.kicad_sch',uri=Uri.joinPath(h.session.scope.boundary,...child.split('/'));h.session.paths.add(child);h.session.files.push({path:child,content:'(kicad_sch)'});
 h.vscode.workspace.fs.stat=async target=>({type:target.path.endsWith('.kicad_sch')?1:2,size:12});h.vscode.workspace.textDocuments=[{uri,isDirty:true,getText:()=>'(kicad_sch (version 999))'}];
 const compared=await h.send({type:'repository-compare-current',file:child,path:child,sha:OLD});assert.equal(compared.ok,true);assert.equal(compared.result.unsaved,true);
 const panel=h.panels[0],token=JSON.parse(panel.webview.html.match(/globalThis.KiCadVSCodeContext=(.*?);<\/script>/)[1]).token;await panel.receive({channel:h.api.CHANNEL,token,id:1,request:{type:'conflict-load'}});assert.equal(panel.messages.at(-1).reply.result.path,child);assert.equal(panel.messages.at(-1).reply.result.incoming,'(kicad_sch)');panel.dispose();
 h.vscode.window.showSaveDialog=async()=>undefined;assert.equal((await h.send({type:'repository-export-revision',file:child,path:child,sha:OLD,copy:true})).result.cancelled,true);
 for(const path of ['board.kicad_pcb','../outside.kicad_sch','sub/missing.kicad_sch'])assert.equal((await h.send({type:'repository-compare-current',file:child,path,sha:OLD})).ok,false);
});
