const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../loading-ui.js'),'utf8');
function runtime(withWorker=true,android=false){
 class Element{constructor(){this.children=[];this.attributes={};this.classList={add:()=>{}};}append(...n){this.children.push(...n);}setAttribute(k,v){this.attributes[k]=v;}remove(){this.removed=true;}}
 const workers=[],timers=new Map();let id=0;
 class Worker{constructor(url){this.url=url;workers.push(this);}postMessage(v){this.message=v;}terminate(){this.terminated=true;}}
 const context={URL,Promise,Date,KiCadAndroidRuntime:android,document:{currentScript:{src:'https://local.test/extension/loading-ui.js'},createElement:()=>new Element()},location:{href:'https://local.test/extension/pcb-viewer.html'},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:n=>timers.delete(n),setInterval:fn=>{timers.set(++id,fn);return id;},clearInterval:n=>timers.delete(n),...(withWorker?{Worker}:{})};vm.runInNewContext(source,context);return{api:context.KiCadLoading,workers,timers,context,host:new Element()};
}
test('loading indicator announces stages, clears timers and releases busy state',()=>{const r=runtime(),ui=r.api.indicator(r.host),pane=r.host.children[0];ui.show('Fetching board');assert.equal(pane.hidden,true);const reveal=[...r.timers.values()][0];r.timers.clear();reveal();assert.equal(pane.hidden,false);assert.equal(r.host.attributes['aria-busy'],'true');assert.equal(pane.children[1].children[1].textContent,'Fetching board');ui.show('Preparing geometry');assert.equal(r.timers.size,1);ui.hide();assert.equal(pane.hidden,true);assert.equal(r.host.attributes['aria-busy'],'false');assert.equal(r.timers.size,0);ui.dispose();assert.equal(pane.removed,true);});

test('project opening shows immediately, updates one surface and dismisses completely',()=>{
 const r=runtime(),ui=r.api.indicator(r.host,{fullscreen:true}),pane=r.host.children[0];
 ui.show('Finding project files');assert.equal(pane.hidden,false);assert.equal(r.host.attributes['aria-busy'],'true');
 assert.equal(pane.children[1].children[0].textContent,'Opening your project');
 ui.show('Preparing schematic');assert.equal(r.host.children.length,1);assert.equal(r.timers.size,1);
 assert.equal(pane.children[1].children[1].textContent,'Preparing schematic');
 assert.equal(pane.children.at(-1).hidden,true,'no fake Stop on a noncancellable discovery');
 ui.hide();assert.equal(pane.hidden,true);assert.equal(r.timers.size,0);assert.equal(r.host.attributes['aria-busy'],'false');
 ui.show('Retrying');assert.equal(pane.hidden,false);ui.dispose();assert.equal(r.timers.size,0);
});
test('fullscreen Stop remains cancellable once and leaves no loader after cancellation',()=>{
 const r=runtime();let calls=0;let ui;
 ui=r.api.indicator(r.host,{fullscreen:true,onStop:()=>{calls++;ui.hide();}});
 ui.show('Reading schematic');const pane=r.host.children[0];pane.children.at(-1).onclick();
 assert.equal(calls,1);assert.equal(pane.hidden,true);assert.equal(r.timers.size,0);assert.equal(r.host.attributes['aria-busy'],'false');
});
test('loading stylesheet is included in browser and VS Code distribution asset lists',()=>{
 for(const script of ['package_extension.py','package_vscode.py'])assert.match(fs.readFileSync(path.join(__dirname,'../../scripts',script),'utf8'),/'loading-ui.css'/);
 assert.ok(fs.readFileSync(path.join(__dirname,'../loading-ui.css'),'utf8').includes('prefers-reduced-motion'));
});
test('worker reports stages, returns one result and terminates',async()=>{const r=runtime(),stages=[];const p=r.api.run('settings',{content:'{}'},()=>assert.fail('fallback'),{onStage:s=>stages.push(s)}),w=r.workers[0];assert.equal(w.url,'https://local.test/extension/load-worker.js');w.onmessage({data:{stage:'Reading settings'}});w.onmessage({data:{ok:true,result:{file:'board'}}});assert.equal((await p).file,'board');assert.deepEqual(stages,['Reading settings']);assert.equal(w.terminated,true);assert.equal(r.timers.size,0);});
test('cancelled or failed workers cannot return a stale result',async()=>{for(const fail of ['abort','error','timeout']){const r=runtime(),controller=new AbortController(),p=r.api.run('drawing',{},()=>assert.fail('fallback'),{signal:controller.signal}),w=r.workers[0];if(fail==='abort')controller.abort();else if(fail==='error')w.onmessage({data:{ok:false,error:'Invalid source'}});else [...r.timers.values()][0]();await assert.rejects(p,/cancelled|stopped|Invalid source|two minutes/);w.onmessage({data:{ok:true,result:{stale:true}}});assert.equal(w.terminated,true);assert.equal(r.timers.size,0);}});
test('without worker support the source-preserving fallback runs and pre-cancelled jobs do not',async()=>{const r=runtime(false);assert.equal(await r.api.run('settings',{},()=>42),42);const c=new AbortController();c.abort();await assert.rejects(r.api.run('settings',{},()=>assert.fail('fallback'),{signal:c.signal}),/cancelled/);});
test('bundled drawing worker returns cloneable model, geometry and matching net primitive identities',()=>{
 const output=[],context={TextEncoder,Map,Set,WeakMap,postMessage:x=>output.push(x)};context.importScripts=(...names)=>{for(const name of names){assert.match(name,/^[a-z-]+\.js$/);vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../load-worker.js'),'utf8'),context);
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (global_label "SIGNAL" (at 0 0) (uuid "l")) (wire (pts (xy 0 0) (xy 10 0)) (uuid "w")))'}];context.onmessage({data:{job:'drawing',payload:{files,rootFile:'root.kicad_sch',pcb:false}}});assert.equal(output.at(-1).ok,true);const result=structuredClone(output.at(-1).result);Object.defineProperty(result.model,'_rules',{value:new Map(result.rules)});assert.equal(require('../design-model.js').applyVariant(result.model,'default').length,2);assert.equal(result.nets.nets[0].name,'SIGNAL');assert.ok(result.nets.nets[0].primitives.every(p=>result.design.primitives.includes(p)));assert.equal(output.filter(x=>x.stage).length,3);
 context.onmessage({data:{job:'settings',payload:{content:'(kicad_pcb (setup (pad_to_mask_clearance 0.2)))',file:'board.kicad_pcb'}}});assert.equal(output.at(-1).ok,true);assert.equal(output.at(-1).result.kind,'board-settings');
 context.onmessage({data:{job:'drawing',payload:{files:[{path:'../bad.kicad_sch',content:'(kicad_sch)'}],rootFile:'../bad.kicad_sch'}}});assert.equal(output.at(-1).ok,false);
});

test('Android loader bundles a decorative app logo without delaying stage updates',()=>{const r=runtime(false,true),ui=r.api.indicator(r.host),pane=r.host.children[0];const logo=pane.children[2];assert.equal(logo.src,'https://local.test/extension/app-logo.png');assert.equal(logo.alt,'');assert.equal(logo.width,36);assert.equal(logo.attributes['aria-hidden'],'true');ui.show('Downloading');assert.equal(pane.hidden,true);ui.show('Preparing board',.5);assert.equal(pane.children[0].value,.5);assert.equal(pane.children[1].children[1].textContent,'Preparing board');ui.hide();assert.equal(r.timers.size,0);});

test('Stop cancels once and remains interactive while the overlay blocks no drawing input',()=>{
 const r=runtime();let stopped=0;const ui=r.api.indicator(r.host,{onStop:()=>{stopped++;}});ui.show('Downloading');const stop=r.host.children[0].children.at(-1);assert.equal(stop.hidden,false);assert.equal(stop.attributes['aria-label'],'Stop loading');stop.onclick();stop.onclick();assert.equal(stopped,1);assert.equal(stop.disabled,true);ui.hide();assert.equal(r.host.attributes['aria-busy'],'false');
 const readOnly=r.api.indicator(r.host);assert.equal(r.host.children.at(-1).children.at(-1).hidden,true,'noncancellable operations must not offer a fake Stop');readOnly.dispose();
});
test('elapsed loader time uses hours and minutes for long operations',()=>{const r=runtime();assert.equal(r.api.duration(5000),'5 s');assert.equal(r.api.duration(125000),'2 min 5 s');assert.equal(r.api.duration(7380000),'2 h 3 min');});
test('large preparations never fall back to an uninterruptible UI-thread parse',async()=>{const r=runtime(false);await assert.rejects(r.api.run('drawing',{files:[{content:'x'.repeat(600000)}]},()=>assert.fail('UI parser must not run')),/Background preparation is unavailable/);});
test('self-contained VS Code worker runs PCB preparation with layer palette without runtime imports',()=>{
 const output=[],context={TextEncoder,Map,Set,WeakMap,postMessage:value=>output.push(value)};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../load-worker-vscode.js'),'utf8'),context);
 const files=[{path:'board.kicad_pcb',content:'(kicad_pcb (version 20241229) (layers (0 "F.Cu" signal)) (segment (start 0 0) (end 10 0) (width 0.2) (layer "F.Cu")))'}];context.onmessage({data:{job:'drawing',payload:{files,rootFile:files[0].path,pcb:true}}});assert.equal(output.at(-1).ok,true);assert.equal(output.at(-1).result.design.primitives.find(p=>p.kind==='track').color,'#c83434');
});
test('VS Code preparation uses a fetched blob worker and revokes it on Stop',async()=>{
 const r=runtime(),revoked=[];r.context.KiCadVSCodeContext={loadWorkerUrl:'https://local.test/load-worker-vscode.js'};r.context.Blob=Blob;
 r.context.URL=class extends URL{static createObjectURL(){return'blob:worker-test';}static revokeObjectURL(url){revoked.push(url);}};
 r.context.fetch=async(url,options)=>{assert.equal(url,r.context.KiCadVSCodeContext.loadWorkerUrl);assert.equal(options.redirect,'error');return{ok:true,text:async()=>"onmessage=()=>{}"};};
 const c=new AbortController(),p=r.api.run('drawing',{},()=>assert.fail('main-thread fallback'),{signal:c.signal});await new Promise(resolve=>setImmediate(resolve));const worker=r.workers[0];assert.equal(worker.url,'blob:worker-test');c.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(worker.terminated,true);assert.deepEqual(revoked,['blob:worker-test']);assert.equal(r.timers.size,0);
});
test('Android local-source context does not accidentally disable its normal worker',async()=>{
 const r=runtime(true,true);r.context.KiCadVSCodeContext={search:'?repository=android/local'};
 const p=r.api.run('drawing',{},()=>assert.fail('Android UI thread fallback'));assert.equal(r.workers[0].url,'https://local.test/extension/load-worker.js');r.workers[0].onmessage({data:{ok:true,result:{ready:true}}});assert.equal((await p).ready,true);
});
test('late worker progress after Stop never changes the loader stage',async()=>{
 const r=runtime(),stages=[],c=new AbortController(),p=r.api.run('drawing',{},()=>{}, {signal:c.signal,onStage:stage=>stages.push(stage)});const worker=r.workers[0];c.abort();await assert.rejects(p,{name:'AbortError'});worker.onmessage({data:{stage:'late'}});assert.deepEqual(stages,[]);
});
