const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../repository-sessions.js');
function fixture(saved){const state={...(saved||{})};return {state,api:{runtime:{getURL:p=>'chrome-extension://test/'+p},storage:{session:{get:async key=>({[key]:state[key]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>{throw Error('No broad host permission');}}}};}
const scope={repository:'org/board'},tab={id:42,url:'https://github.com/org/board/tree/main/design'};
test('explicit website tab survives worker restart without querying broad host access or storing credentials',async()=>{
 const f=fixture(),store=create(f.api);await store.remember(tab,scope);
 assert.deepEqual(await store.candidates('github','https://github.com','org/board'),[{id:42,bound:true}]);
 const recovered=create(f.api);await recovered.ready;assert.deepEqual(await recovered.candidates('github','https://github.com','org/board'),[{id:42,bound:true}]);
 assert.deepEqual(await recovered.candidates('github','https://github.com','org/other'),[]);
 assert.equal(/token|cookie|content|password/i.test(JSON.stringify(f.state)),false);
 await assert.rejects(store.remember(tab,{repository:'org/other'}),/does not match/);
});
test('in-page frames are repository/host/provider/tab-bound while owned nested panes remain available',async()=>{
 const f=fixture(),store=create(f.api);await store.remember(tab,scope,true);
 const sender={tab:{id:42,url:tab.url},frameId:2,url:'chrome-extension://test/browser-viewer.html?repository=org%2Fboard&head='+'a'.repeat(40)};
 assert.equal(store.frameAllowed(sender),true);
 for(const page of ['options.html','dashboard.html','analysis-viewer.html','browser-viewer.html/extra'])assert.equal(store.frameAllowed({...sender,url:'chrome-extension://test/'+page+'?repository=org/board'}),false);
 assert.equal(store.messageAllowed(sender,{repository:'org/board'}),true);
 assert.equal(store.messageAllowed(sender,{repository:'org/other'}),false);
 assert.equal(store.messageAllowed(sender,{comment:{anchor:{repository:'org/other'}}}),false);
 assert.equal(store.frameAllowed({...sender,tab:{id:42,url:'https://github.com/org/other'}}),false);
 for(const change of [{tab:{id:43,url:tab.url}},{url:'chrome-extension://test/browser-viewer.html?repository=org/other'},{url:'https://github.com/org/board'},{url:sender.url+'&provider=gitlab&host=https://gitlab.com'}])assert.equal(store.frameAllowed({...sender,...change}),false);
 assert.equal(store.frameAllowed({...sender,tab:{id:99,url:'chrome-extension://test/project-viewer.html?repository=org/board'}}),true);
 assert.equal(store.frameAllowed({...sender,url:'https://evil.example/',tab:{id:99,url:'chrome-extension://test/project-viewer.html'}}),false);
 const launch='chrome-extension://test/project-launcher.html?source='+encodeURIComponent(tab.url);
 assert.equal(store.frameAllowed({...sender,url:launch}),true);
 assert.equal(store.inlineSource({tab:{id:42},frameId:0,url:tab.url},launch),true);
 assert.equal(store.inlineSource({tab:{id:42},frameId:0,url:'https://github.com/org/other'},launch),false);
});
test('default standalone launch does not authorize website-embedded viewers; GitLab uses the clicked server',async()=>{
 const f=fixture(),store=create(f.api);await store.remember(tab,scope,false);
 assert.equal(store.frameAllowed({tab:{id:42,url:tab.url},frameId:1,url:'chrome-extension://test/project-viewer.html?repository=org/board'}),false);
 await store.remember({id:55,url:'https://gitlab.com/team/sub/board/-/tree/main'},{provider:'gitlab',repository:'team/sub/board'},true);
 assert.deepEqual(await store.candidates('gitlab','https://gitlab.com','team/sub/board'),[{id:55,bound:true}]);
 assert.equal(store.frameAllowed({tab:{id:55,url:'https://gitlab.com/team/sub/board'},frameId:1,url:'chrome-extension://test/gerber-viewer.html?repository=team/sub/board&provider=gitlab&host=https://gitlab.com'}),true);
});

test('nested BoM reader stays bound to its explicit website repository',async()=>{const f=fixture(),store=create(f.api);await store.remember(tab,scope,true);const sender={tab,frameId:3,url:'chrome-extension://test/bom-viewer.html?repository=org/board&ref=main&file=bom.csv'};assert.equal(store.frameAllowed(sender),true);assert.equal(store.messageAllowed(sender,{repository:'org/board',ref:'main'}),true);assert.equal(store.frameAllowed({...sender,url:sender.url.replace('org/board','org/other')}),false);assert.equal(store.messageAllowed(sender,{repository:'org/other'}),false);});

test('stale reader recovery stays in the explicitly invoked live repository tab',async()=>{
 const f=fixture(),calls=[];let current=tab;
 f.api.tabs.get=async id=>{assert.equal(id,42);return current;};
 f.api.scripting={executeScript:async value=>calls.push(value)};
 const store=create(f.api);await store.remember(tab,scope);
 assert.equal(await store.recover(42,'github','https://github.com','org/board'),true);
 assert.deepEqual(calls[0].target,{tabId:42,frameIds:[0]});
 assert.ok(calls[0].files.includes('github-session-reader.js'));
 assert.equal(calls[0].files.at(-1),'repository-session-bridge.js');
 for(const url of ['https://github.com/org/board-other','https://github.com/org/other','https://evil.test/org/board','https://github.com/login']){
  current={...tab,url};assert.equal(await store.recover(42,'github','https://github.com','org/board'),false);
 }
 for(const args of [[43,'github','https://github.com','org/board'],[42,'github','https://github.com','org/other'],[42,'gitlab','https://gitlab.com','org/board']])assert.equal(await store.recover(...args),false);
 assert.equal(calls.length,1);
 current=tab;f.api.scripting.executeScript=async()=>{throw Error('Policy blocked');};
 assert.equal(await store.recover(42,'github','https://github.com','org/board'),false);
});
