const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
global.KiCadGitHub=require('../parsing.js');const launch=require('../project-launch.js');
async function ui(response,search='?source=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&ref=HEAD'){
 const nodes=new Map(),requests=[],replaced=[],events=new Map(),stages=[],warnings=[],diagnostics=[];let hidden=0;
 const node=()=>({textContent:'',hidden:false,className:'',children:[],setAttribute(name,value){this[name]=value;},replaceChildren(){this.children=[];},append(n){this.children.push(n);},addEventListener(type,fn){this[type]=fn;}});
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
 vm.runInNewContext(fs.readFileSync(require.resolve('../project-launcher.js'),'utf8'),{document,console:{warn:(...args)=>warnings.push(args.join(' ')),debug:(...args)=>diagnostics.push(args.join(' '))},addEventListener:(name,fn)=>events.set(name,fn),KiCadLoading:{indicator:(host,options)=>{assert.equal(options.fullscreen,true);return{show:stage=>stages.push(stage),hide:()=>hidden++,dispose(){}};}},location:{search,replace:url=>replaced.push(url)},URLSearchParams,KiCadProjectLaunch:launch,chrome:{runtime:{getURL:p=>'moz-extension://test/'+p,sendMessage:async m=>{requests.push(m);return response;}}}});
 await new Promise(setImmediate);return{nodes,requests,replaced,stages,hidden,events,warnings,diagnostics};
}
test('single detected project replaces launcher with pinned standalone viewer',async()=>{
 const view=await ui({ok:true,result:{sha:'a'.repeat(40),projects:['design/board.kicad_pro']}});
 assert.equal(view.replaced.length,1);const url=new URL(view.replaced[0]);assert.equal(url.pathname,'/project-viewer.html');assert.equal(url.searchParams.get('head'),'a'.repeat(40));assert.equal(url.searchParams.get('file'),'design/board.kicad_pro');
 assert.equal(view.requests[0].type,'repository-detect');assert.equal(view.requests[0].source,'https://github.com/owner/repo');
 assert.match(view.stages[0],/Finding KiCad projects/);assert.equal(view.hidden,1);assert.equal(typeof view.events.get('pagehide'),'function');
});
test('KERO website discovery keeps fallback diagnostics out of extension warnings',async()=>{
 const fallback='Read through the GitHub website. Saved file sizes and API history are unavailable.';
 const view=await ui({ok:true,result:{sha:'a'.repeat(40),projects:['KERO.kicad_pro','encoder/Encoder.kicad_pro'],warnings:[fallback]}},'?source=https%3A%2F%2Fgithub.com%2Fwayri%2FKERO&ref=HEAD');
 assert.equal(view.nodes.get('launchProjects').children.length,2);
 assert.equal(view.nodes.get('launchDetails').textContent,'wayri/KERO');
 assert.deepEqual(view.warnings,[]);
 assert.deepEqual(view.diagnostics,['KiCad Online project discovery: '+fallback]);
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
 const view=await ui({ok:true,result:{sha:'a'.repeat(40),projects:[],truncated:true,warnings:['Organization policy blocked an ancillary directory.']}});assert.equal(view.nodes.get('launchTitle').textContent,'Project discovery incomplete');assert.equal(view.nodes.get('launchRetry').hidden,false);assert.match(view.nodes.get('launchDetails').textContent,/Partial listing/);assert.doesNotMatch(view.nodes.get('launchDetails').textContent,/Organization policy/);assert.deepEqual(view.warnings,[]);assert.match(view.diagnostics[0],/Organization policy/);assert.equal(view.requests[0].refresh,false);await view.nodes.get('launchRetry').click();assert.equal(view.requests[1].refresh,true);
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

test('hundreds of projects remain filterable with a bounded page of cards and pinned folder links',async()=>{
 const sha='e'.repeat(40),items=Array.from({length:600},(_,index)=>'design/Archive '+index+'/Board.'+(index%2?'pro':'kicad_pro'));
 const view=await ui({ok:true,result:{sha,projects:[...items,'loose/harness.sch'],folders:['design','loose'],truncated:true}});
 const n=id=>view.nodes.get(id),cards=n('launchProjects');
 assert.equal(cards.children.length,36);
 assert.equal(n('launchPage').textContent,'Page 1 of 17');
 await n('launchNext').onclick();
 assert.equal(n('launchPage').textContent,'Page 2 of 17');
 n('launchFilter').value='archive 599/';n('launchFilter').oninput();
 assert.equal(cards.children.length,1);
 assert.equal(new URL(cards.children[0].href).searchParams.get('file'),items.at(-1));
 n('launchFilter').value='';n('launchFilter').oninput();n('launchDrawings').onclick();
 assert.equal(new URL(cards.children[0].href).searchParams.get('file'),'loose/harness.sch');
 const folder=new URL(n('launchFolderLinks').children[0].href);
 assert.equal(folder.searchParams.get('source'),'https://github.com/owner/repo/tree/'+sha+'/design');
 assert.equal(folder.searchParams.get('folder'),'1');
 const nested=await ui({ok:true,result:{sha,projects:[items[0]],folders:[],directory:'design/Archive 0'}},
   new URLSearchParams({source:'https://github.com/owner/repo/tree/'+sha+'/design/Archive%200',ref:sha,folder:'1',projects:'1'}).toString());
 assert.equal(nested.requests[0].folderOnly,true);
 assert.equal(new URL(nested.nodes.get('launchFolderUp').href).searchParams.get('source'),'https://github.com/owner/repo/tree/'+sha+'/design');
});


test('Gerber-only and mixed repositories offer a dedicated fabrication card without redirecting',async()=>{
 for(const projects of [[],['main.kicad_pro']]){
  const sha='a'.repeat(40);
  const view=await ui({ok:true,result:{sha,projects,fabricationCount:3}});
  assert.equal(view.replaced.length,0);
  const cards=view.nodes.get('launchProjects').children;
  assert.equal(cards.length,projects.length+1);
  const card=cards[0],url=new URL(card.href);
  assert.match(card.className,/fabrication-choice/);
  assert.equal(card.children[1].textContent,'Gerbers');
  assert.equal(url.pathname,'/gerber-viewer.html');
  assert.equal(url.searchParams.get('repository'),'owner/repo');
  assert.equal(url.searchParams.get('ref'),sha);
  assert.equal(url.searchParams.get('scan'),'1');
  assert.equal(url.searchParams.has('file'),false);
 }
});

test('fabrication scan links preserve the selected folder and pinned source',async()=>{
 const sha='b'.repeat(40),source='https://github.com/owner/repo/tree/main/fab';
 const view=await ui({ok:true,result:{sha,projects:[],fabricationCount:1,directory:'fab'}},'?source='+encodeURIComponent(source));
 const url=new URL(view.nodes.get('launchProjects').children[0].href);
 assert.equal(url.searchParams.get('ref'),sha);
 assert.equal(url.searchParams.get('file'),'fab/board.gbrjob');
 const gitlab=new URL(launch.fabricationURL({sha,repository:'group/sub/repo',provider:'gitlab',host:'https://gitlab.example'},p=>'moz-extension://test/'+p));
 assert.equal(gitlab.searchParams.get('host'),'https://gitlab.example');
 assert.equal(gitlab.searchParams.get('provider'),'gitlab');
 const fork=new URL(launch.fabricationURL({sha,repository:'owner/repo',headRepository:'fork/repo'},p=>'moz-extension://test/'+p));
 assert.equal(fork.searchParams.get('repository'),'fork/repo');
});

test('Projects opens a pinned repository-root chooser with project cards before fabrication',async()=>{
 const sha='a'.repeat(40);
 const file='encoder/Encoder.kicad_sch';
 const url=new URL(launch.repositoryProjectsURL({repository:'wayri/KERO',ref:sha,file},p=>'chrome-extension://test/'+p));
 assert.equal(url.searchParams.get('source'),'https://github.com/wayri/KERO/tree/'+sha);
 const view=await ui({ok:true,result:{sha,projects:['KERO.kicad_pro','encoder/Encoder.kicad_pro','encoder/bank1.kicad_sch'],fabricationCount:4}},url.search);
 const cards=view.nodes.get('launchProjects').children;
 assert.equal(view.requests[0].repository,'wayri/KERO');
 assert.equal(view.requests[0].ref,sha);
 assert.equal(view.replaced.length,0);
 assert.deepEqual(cards.map(card=>card.children[1].textContent),['KERO','Encoder']);
 assert.equal(cards[1]['aria-current'],'true');
 assert.equal(cards[1].children[0].textContent,'Current project');
 assert.match(view.nodes.get('launchOther').children[0].href,/gerber-viewer/);
});

test('repository Projects retains a single card and supports nested GitLab namespaces',async()=>{
 const sha='b'.repeat(40);
 const url=new URL(launch.repositoryProjectsURL({repository:'group/subgroup/project',ref:sha,file:'board.kicad_pro',provider:'gitlab',host:'https://gitlab.example'},p=>'chrome-extension://test/'+p));
 const view=await ui({ok:true,result:{sha,projects:['board.kicad_pro']}},url.search);
 assert.equal(view.requests[0].source,'https://gitlab.example/group/subgroup/project/-/tree/'+sha);
 assert.equal(view.requests[0].provider,'gitlab');
 assert.equal(view.replaced.length,0);
 assert.equal(view.nodes.get('launchProjects').children.length,1);
 assert.equal(launch.repositoryProjectsURL({repository:'owner/../repo',ref:sha},String),null);
});
