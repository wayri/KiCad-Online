const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require.resolve('../product-info.js'),'utf8');
function load(extra={}){const context={...extra};vm.runInNewContext(code,context);return context.KiCadProductInfo;}
test('About prefers actual installed extension version over stale packaged metadata',()=>{
 const api=load({chrome:{runtime:{getManifest:()=>({version:'0.12.79',manifest_version:3,version_name:'Development acceptance'})}},KiCadProductVersion:{release:'0.12.78',appVersion:'0.12.78',platform:'Chromium'}});
 assert.equal(api.info().release,'0.12.79');assert.equal(api.caption(),'Version 0.12.79 · Development acceptance');assert.equal(api.info().label,'Development acceptance');
});

test('unpackaged extension source clearly identifies its base version and installation',()=>{
 const api=load({chrome:{runtime:{id:'kfdhaokpneahlieenlhjnpbomjncgbnj',getManifest:()=>({version:'0.12.95',manifest_version:3})}},KiCadProductVersion:{release:'__RELEASE_VERSION__',appVersion:'__APP_VERSION__',platform:'__PLATFORM__'}});
 assert.equal(api.caption(),'Development build · base 0.12.95');assert.equal(api.info().development,true);assert.equal(api.info().extensionId,'kfdhaokpneahlieenlhjnpbomjncgbnj');
});
test('About distinguishes native app version from shared viewer release without network access',()=>{
 const api=load({KiCadProductVersion:{release:'0.12.78',appVersion:'1.78',platform:'Android'},fetch(){throw Error('About must stay local');}});
 assert.equal(api.caption(),'Version 1.78 · viewer release 0.12.78');assert.equal(api.info().platform,'Android');
});
test('unpackaged source and unavailable extension API never invent a release number',()=>{
 const api=load({KiCadProductVersion:{release:'__RELEASE_VERSION__',appVersion:'__APP_VERSION__',platform:'__PLATFORM__'},chrome:{runtime:{getManifest(){throw Error('unavailable');}}}});
 assert.equal(api.info().release,null);assert.equal(api.caption(),'Development checkout · not a packaged release');
 assert.equal(load({KiCadVSCodeContext:{version:'0.12.78'}}).caption(),'Version 0.12.78');
});
test('local source never requests a store update or reloads the extension',async()=>{
 let calls=0;
 const api=load({chrome:{runtime:{getManifest:()=>({version:'0.12.95',manifest_version:3}),requestUpdateCheck(){calls++;},reload(){throw Error('must not reload');}}},KiCadProductVersion:{release:'__RELEASE_VERSION__'}});
 assert.equal((await api.checkUpdates()).status,'development');assert.equal(calls,0);
});
test('Chromium update checks coalesce and accept only a valid browser result',async()=>{
 let callback,calls=0;
 const runtime={getManifest:()=>({version:'0.12.95'}),requestUpdateCheck(cb){calls++;callback=cb;}};
 const api=load({chrome:{runtime}});
 const first=api.checkUpdates(),second=api.checkUpdates();
 callback('update_available',{version:'0.12.96'});
 assert.equal((await first).version,'0.12.96');assert.equal((await second).status,'update_available');assert.equal(calls,1);
 const next=api.checkUpdates();callback('no_update');assert.equal((await next).status,'no_update');assert.equal(calls,2);
});
test('Firefox promise updates, throttling, API errors and unavailable hosts are handled',async()=>{
 assert.equal((await load().checkUpdates()).status,'unsupported');
 for(const status of ['no_update','throttled'])assert.equal((await load({browser:{runtime:{requestUpdateCheck:async()=>({status})}}}).checkUpdates()).status,status);
 const broken=load({browser:{runtime:{requestUpdateCheck:async()=>{throw Error('offline');}}}});
 assert.equal((await broken.checkUpdates()).status,'error');
 for(const result of [{status:'unexpected'},{status:'update_available',version:'<script>'}])assert.equal((await load({browser:{runtime:{requestUpdateCheck:async()=>result}}}).checkUpdates()).status,'error');
 const runtime={lastError:{message:'blocked'},requestUpdateCheck(cb){cb('no_update');}};
 assert.equal((await load({chrome:{runtime}}).checkUpdates()).status,'error');
});
test('update guidance preserves active work and distinguishes availability from publication',()=>{
 const api=load();
 assert.match(api.updateMessage({status:'update_available',version:'0.12.96'}),/Save drafts.*close/);
 assert.match(api.updateMessage({status:'no_update'}),/organization policies/);
 assert.match(api.updateMessage({status:'development'}),/do not replace/);
});
test('an unresponsive browser check times out for every waiting caller and can be retried',async()=>{
 let timeout,calls=0;
 const api=load({setTimeout(fn){timeout=fn;return 1;},clearTimeout(){},chrome:{runtime:{requestUpdateCheck(){calls++;}}}});
 const a=api.checkUpdates(),b=api.checkUpdates();timeout();
 assert.equal((await a).status,'error');assert.equal((await b).status,'error');assert.equal(calls,1);
 const retry=api.checkUpdates();timeout();await retry;assert.equal(calls,2);
});
test('Settings update controls render once and show a checked result without navigation',async()=>{
 function node(tag){return {tag,textContent:'',children:[],attributes:new Map(),style:{},setAttribute(k,v){this.attributes.set(k,v);},hasAttribute(k){return this.attributes.has(k);},append(...items){this.children.push(...items);}};}
 const host=node('div');
 const api=load({document:{createElement:node,querySelectorAll:s=>s==='[data-product-updates]'?[host]:[]},browser:{runtime:{requestUpdateCheck:async()=>({status:'no_update'})}}});
 api.decorate();assert.equal(host.children.length,3);
 const [button,status,links]=host.children;
 assert.equal(links.children.length,2);assert.match(links.children[0].href,/^https:\/\/chromewebstore.google.com\//);
 const pending=button.onclick();assert.equal(button.disabled,true);await pending;
 assert.equal(button.disabled,false);assert.match(status.textContent,/No update is available/);
});

test('browser update events surface one alert and keep pending guidance through a manual check',async()=>{
 function node(tag){
  return {tag,textContent:'',children:[],attributes:new Map(),style:{},
   setAttribute(key,value){this.attributes.set(key,value);},
   hasAttribute(key){return this.attributes.has(key);},
   addEventListener(){},append(...items){this.children.push(...items);}};
 }
 const host=node('div'),about=node('button');
 let notify,subscriptions=0;
 const document={
  createElement:node,
  querySelector:()=>about,
  querySelectorAll(selector){
   if(selector==='[data-product-about]')return [about];
   if(selector==='[data-product-updates]')return [host];
   if(selector==='[data-product-update-status]')return host.children.filter(n=>n.hasAttribute('data-product-update-status'));
   return [];
  }
 };
 const api=load({document,browser:{runtime:{
  requestUpdateCheck:async()=>({status:'throttled'}),
  onUpdateAvailable:{addListener(listener){notify=listener;subscriptions++;}},
  reload(){assert.fail('automatic alert must not reload the extension');}
 }}});
 api.decorate();
 assert.equal(subscriptions,1);
 notify({version:'invalid'});
 assert.equal(about.children.length,0);
 notify({version:'0.12.104'});
 notify({version:'0.12.104'});
 assert.equal(about.children.length,1);
 assert.match(about.children[0].textContent,/Update available/);
 const [button,status]=host.children;
 assert.match(status.textContent,/Version 0\.12\.104 is ready/);
 await button.onclick();
 assert.match(status.textContent,/Version 0\.12\.104 is ready/);
});
