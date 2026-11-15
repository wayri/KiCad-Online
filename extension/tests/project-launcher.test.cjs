const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
global.KiCadGitHub=require('../parsing.js');const launch=require('../project-launch.js');
async function ui(response,search='?source=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&ref=HEAD'){
 const nodes=new Map(),requests=[],replaced=[],events=new Map(),stages=[];let hidden=0;
 const node=()=>({textContent:'',hidden:false,className:'',children:[],replaceChildren(){this.children=[];},append(n){this.children.push(n);},addEventListener(type,fn){this[type]=fn;}});
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
 vm.runInNewContext(fs.readFileSync(require.resolve('../project-launcher.js'),'utf8'),{document,addEventListener:(name,fn)=>events.set(name,fn),KiCadLoading:{indicator:(host,options)=>{assert.equal(options.fullscreen,true);return{show:stage=>stages.push(stage),hide:()=>hidden++,dispose(){}};}},location:{search,replace:url=>replaced.push(url)},URLSearchParams,KiCadProjectLaunch:launch,chrome:{runtime:{getURL:p=>'moz-extension://test/'+p,sendMessage:async m=>{requests.push(m);return response;}}}});
 await new Promise(setImmediate);return{nodes,requests,replaced,stages,hidden,events};
}
test('single detected project replaces launcher with pinned standalone viewer',async()=>{
 const view=await ui({ok:true,result:{sha:'a'.repeat(40),projects:['design/board.kicad_pro']}});
 assert.equal(view.replaced.length,1);const url=new URL(view.replaced[0]);assert.equal(url.pathname,'/project-viewer.html');assert.equal(url.searchParams.get('head'),'a'.repeat(40));assert.equal(url.searchParams.get('file'),'design/board.kicad_pro');
 assert.equal(view.requests[0].type,'repository-detect');assert.equal(view.requests[0].source,'https://github.com/owner/repo');
 assert.match(view.stages[0],/Finding KiCad projects/);assert.equal(view.hidden,1);assert.equal(typeof view.events.get('pagehide'),'function');
});
test('multiple projects and partial listings remain selectable without hiding omissions',async()=>{
 for(const result of [{sha:'b'.repeat(40),projects:['a.kicad_pro','b.kicad_pro']},{sha:'b'.repeat(40),projects:['a.kicad_pro'],truncated:true}]){
  const view=await ui({ok:true,result});assert.equal(view.replaced.length,0);assert.equal(view.nodes.get('launchProjects').children.length,result.projects.length);assert.match(view.nodes.get('launchTitle').textContent,/Choose/);
  assert.ok(view.nodes.get('launchProjects').children.every(n=>n.href.startsWith('moz-extension://test/project-viewer.html?')));
 }
});
test('empty, denied and malformed discovery have distinct visible feedback',async()=>{
 const empty=await ui({ok:true,result:{sha:'a'.repeat(40),projects:[]}});assert.equal(empty.nodes.get('launchTitle').textContent,'No KiCad project detected');
 const denied=await ui({ok:false,error:'Network disabled by administrator policy'});assert.match(denied.nodes.get('launchStatus').textContent,/administrator/);assert.equal(denied.nodes.get('launchStatus').className,'error');assert.equal(denied.nodes.get('launchRetry').hidden,false);
 const unsafe=await ui({ok:true,result:{sha:'a'.repeat(40),projects:['../bad.kicad_pro']}});assert.equal(unsafe.replaced.length,0);assert.equal(unsafe.nodes.get('launchProjects').children.length,0);assert.equal(unsafe.nodes.get('launchStatus').className,'error');
 const elsewhere=await ui(null,'');assert.equal(elsewhere.requests.length,0);assert.equal(elsewhere.nodes.get('launchTitle').textContent,'No KiCad project detected');
});


test('nested folder without an injected content-script hint asks the worker to resolve metadata',async()=>{
 const search='?source='+encodeURIComponent('https://github.com/BerkeleyLab/Marble/tree/main/design'),view=await ui({ok:true,result:{sha:'a'.repeat(40),projects:['design/Marble.kicad_pro']}},search);
 assert.equal(view.requests[0].repository,'BerkeleyLab/Marble');assert.equal(view.requests[0].ref,null);assert.equal(view.replaced.length,1);assert.equal(new URL(view.replaced[0]).searchParams.get('file'),'design/Marble.kicad_pro');
});


test('partial empty inventory is distinct from no project and offers a cache-refresh retry',async()=>{
 const view=await ui({ok:true,result:{sha:'a'.repeat(40),projects:[],truncated:true,warnings:['Organization policy blocked an ancillary directory.']}});assert.equal(view.nodes.get('launchTitle').textContent,'Project discovery incomplete');assert.equal(view.nodes.get('launchRetry').hidden,false);assert.match(view.nodes.get('launchDetails').textContent,/Organization policy/);assert.equal(view.requests[0].refresh,false);await view.nodes.get('launchRetry').click();assert.equal(view.requests[1].refresh,true);
});

test('denied website reads offer local rendering without requesting account authorization',async()=>{
 const view=await ui({ok:false,error:'Website access unavailable'});
 const children=view.nodes.get('launchDetails').children;
 assert.match(children.find(n=>n.className==='launch-access-help').textContent,/does not require GitHub\/GitLab app authorization/);
 assert.match(children.find(n=>n.className==='launch-access-help').textContent,/organization permits downloads/);
 assert.equal(children.find(n=>n.className==='launch-local-alternative').href,'moz-extension://test/local-viewer.html');
 assert.deepEqual(view.requests.map(r=>r.type),['repository-detect']);
});

test('project chooser excludes standalone drawings when listing project cards',async()=>{const view=await ui({ok:true,result:{sha:'c'.repeat(40),projects:['root.kicad_pro','sub/child.kicad_pro','elsewhere/sheet.kicad_sch','other/board.kicad_pcb']}});const cards=view.nodes.get('launchProjects').children;assert.equal(cards.length,2);assert.deepEqual(cards.map(c=>new URL(c.href).searchParams.get('file')),['root.kicad_pro','sub/child.kicad_pro']);assert.equal(cards[1].children[1].textContent,'child');assert.equal(cards[1].children[2].textContent,'sub');assert.equal(cards[1].className,'project-choice');});
test('drawing-only repositories do not mislabel individual drawings as projects',async()=>{const view=await ui({ok:true,result:{sha:'d'.repeat(40),projects:['sheet.kicad_sch','board.kicad_pcb']}});assert.equal(view.nodes.get('launchProjects').children.length,0);assert.equal(view.replaced.length,0);});
