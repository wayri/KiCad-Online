const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(fetchFile,inventoryFiles=null,inventoryError=null,options={}){
 class Element extends EventTarget{get ownerDocument(){return context.document;}get firstChild(){return this.children[0];}constructor(){super();this.children=[];this.value='';this.hidden=false;this.style={};this.dataset={};this.attributes={};this.text='';}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;this.text='';}setAttribute(k,v){this.attributes[k]=String(v);}set textContent(v){this.text=String(v);this.children=[];}get textContent(){return this.text+this.children.map(n=>n.textContent).join(' ');}getBoundingClientRect(){return{left:0,top:0,width:800,height:600};}getContext(){return new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});}}
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},requests=[],handlers={};let mounted=null;
 const bodyClasses=new Set();const classList={add:(...names)=>names.forEach(n=>bodyClasses.add(n)),remove:(...names)=>names.forEach(n=>bodyClasses.delete(n)),toggle:(n,force)=>{const enabled=typeof force==='boolean'?force:!bodyClasses.has(n);if(enabled)bodyClasses.add(n);else bodyClasses.delete(n);return enabled;},contains:n=>bodyClasses.has(n)};
 const parentMessages=[];const context={setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,parent:{postMessage:(message,origin)=>parentMessages.push({message,origin})},AbortController,KiCadLoading:options.loading,URLSearchParams,TextEncoder,TextDecoder,Map,Set,console,location:{origin:'https://viewer.test',search:'?repository=wayri/review&ref='+encodeURIComponent(options.ref||'main')+'&file='+encodeURIComponent(options.file||'board.kicad_pro')+(options.projectOnly?'&projectOnly=1':'')},document:{querySelector:()=>null,getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),body:{dataset:{},classList},documentElement:{style:{}}},addEventListener:(type,fn)=>handlers[type]=fn,
 KiCadReviewWorkspace:require('../review-workspace.js'),KiCadGitHub:require('../parsing.js'),KiCadProjectSettings:require('../project-settings.js'),KiCadProjectSettingsUI:require('../project-settings-ui.js'),KiCadBoardSetupUI:require('../board-setup-ui.js'),KiCadGerberRenderer:require('../gerber-renderer.js'),KiCadUIIcons:{decorate(){}},
 KiCadOwnedCanvas:{mount(host,options){mounted=new EventTarget();Object.assign(mounted,{...options,canvas:new Element(),viewport:{camera:new(require('../owned-canvas.js').Camera)(800,600)},resize(){},zoom_to_board(){},draw(){this.renderPrimitives?.(this.canvas.getContext(),this.viewport.camera,this);},dispose(){}});mounted.canvas.width=800;mounted.canvas.height=600;return mounted;}},
 chrome:{runtime:{getURL:name=>name,sendMessage:async request=>{requests.push(request);if(request.type==='project-inventory'&&inventoryError)return{ok:false,error:inventoryError};if(request.type==='project-inventory')return{ok:true,result:{snapshotRef:'a'.repeat(40),warnings:[],files:inventoryFiles||[{path:'board.kicad_pro'},{path:'top.gbr'},{path:'bottom.gbr'}]}};try{return{ok:true,result:{path:request.file,content:await fetchFile(request.file)}};}catch(e){return{ok:false,error:e.message};}}}}};
 if(options.vscode)context.KiCadVSCodeContext={search:context.location.search};
 if(options.engineeringLauncher)context.KiCadEngineeringLauncher=options.engineeringLauncher;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../project-viewer.js'),'utf8'),context);return{get,requests,canvas:()=>mounted,handlers,bodyClasses,parentMessages,context};
}
const gerber='%FSLAX24Y24*%%MOMM*%%ADD10C,1*%D10*X010000Y020000D03*M02*';
test('Board Setup is an independent page and Back restores settings without reloading source',async()=>{
 const view=runtime(async()=>JSON.stringify({board:{design_settings:{rules:{min_clearance:0.2}}}}));await tick();view.get('settingsTab').onclick();const requests=view.requests.length;
 view.get('constraintsTab').onclick();assert.equal(view.bodyClasses.has('board-setup-active'),true);assert.equal(view.get('constraintsPanel').hidden,false);
 view.get('boardSetupSearch').value='clearance';view.get('boardSetupSearch').oninput();assert.match(view.get('constraintSections').textContent,/Minimum clearance/);
 view.get('boardSetupBack').onclick();assert.equal(view.bodyClasses.has('board-setup-active'),false);assert.equal(view.get('settingsPanel').hidden,false);assert.equal(view.requests.length,requests);
});
test('project GUI exposes saved settings and mounts the public canvas API for multiple Gerber layers',async()=>{
 const view=runtime(async file=>file.endsWith('.gbr')?gerber:'{"board":{"design_settings":{"rules":{"min_clearance":0.2}}}}');await tick();view.get('settingsTab').onclick();assert.match(view.get('settingSections').textContent,/Board constraints/);
 // File tree buttons use the original requested identities after SHA pinning.
 const buttons=view.get('fileTree').children;await buttons.find(n=>n.textContent==='top.gbr').onclick();await buttons.find(n=>n.textContent==='bottom.gbr').onclick();assert.equal(view.get('gerberLayers').children.length,2);assert.equal(view.canvas().primitives.length,2);assert.ok(view.requests.filter(r=>r.type==='project-file').every(r=>r.ref==='a'.repeat(40)));
 view.get('gerberClear').onclick();assert.equal(view.canvas().primitives.length,0);assert.equal(view.get('gerberLayers').children.length,0);
});
test('late failed source reads cannot overwrite the latest project selection',async()=>{
 let rejectOld;const view=runtime(file=>file==='top.gbr'?new Promise((_,reject)=>rejectOld=reject):Promise.resolve(file.endsWith('.gbr')?gerber:'{}'));await tick();const buttons=view.get('fileTree').children;
 const pending=buttons.find(n=>n.textContent==='top.gbr').onclick();await buttons.find(n=>n.textContent==='bottom.gbr').onclick();rejectOld(new Error('Old failure'));await pending;assert.equal(view.get('projectFile').textContent,'bottom.gbr');assert.match(view.get('projectStatus').textContent,/Viewing saved source/);
});
test('setup controls are copyable read-only fields with source inspection and boolean state',async()=>{
 const view=runtime(async()=>JSON.stringify({board:{design_settings:{rules:{min_clearance:.2,allow_blind_buried_vias:true}}},net_settings:{classes:[null,{name:'Power',clearance:.4,track_width:.6,future_setting:'kept'}]}}));await tick();
 view.get('settingsTab').onclick();const flatten=element=>[element,...element.children.flatMap(flatten)],all=flatten(view.get('constraintSections'));
 assert.ok(all.some(e=>e.readOnly&&e.value==='0.2'));assert.ok(all.some(e=>e.type==='checkbox'&&e.checked&&e.disabled&&e.attributes['aria-label']));
 const info=all.find(e=>e.attributes['aria-label']==='Inspect saved source for Minimum clearance');assert.ok(info);info.onclick();assert.equal(view.get('settingSourceDetail').open,true);assert.match(view.get('settingValue').textContent,/\/board\/design_settings\/rules\/min_clearance/);
 const category=flatten(view.get('settingSections')).find(e=>e.textContent==='Net classes and assignments'&&e.onclick);category.onclick();
 const rows=flatten(view.get('settingSections'));assert.ok(rows.some(e=>e.className==='netclass-value'&&e.textContent==='Power'&&e.title==='/net_settings/classes/1/name'));assert.ok(rows.some(e=>e.readOnly&&e.value==='kept'));
 assert.equal(view.get('boardSetup').value,'');assert.equal(view.get('loadBoardSetup').disabled,true);
});

test('PCB selection opens one drawing preview; explicit setup retains saved layers without fabricating a stackup',async()=>{
 const board='(kicad_pcb (version 20240108) (general (thickness 1.6)) (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user)))';
 const view=runtime(async file=>file.endsWith('.kicad_pcb')?board:'{}',[{path:'board.kicad_pro'},{path:'board.kicad_pcb'}]);await tick();
 await view.get('fileTree').children.find(n=>n.textContent==='board.kicad_pcb').onclick();
 assert.equal(view.get('overviewPanel').hidden,false);assert.equal(view.get('drawingPreview').children.filter(n=>n.src).length,1);assert.match(view.get('drawingPreview').children.find(n=>n.src).src,/file=board.kicad_pcb/);
 view.get('openDesign').onclick();await tick();assert.equal(view.get('drawingPreview').children.filter(n=>n.src).length,1);
 assert.equal(view.bodyClasses.has('focus-drawing'),true,'drawing owns the viewport without the outer project chrome');
 const previewFrame=view.get('drawingPreview').children.find(n=>n.src);
 assert.equal(new URL(previewFrame.src,'https://viewer.test/').searchParams.get('projectShell'),'1');
 previewFrame.contentWindow={};
 const showProject={type:'kicad-review:show-project-settings'};
 view.handlers.message({source:{},origin:'https://viewer.test',data:showProject});assert.equal(view.bodyClasses.has('focus-drawing'),true,'unrelated windows cannot open project controls');
 view.handlers.message({source:previewFrame.contentWindow,origin:'https://evil.test',data:showProject});assert.equal(view.bodyClasses.has('focus-drawing'),true,'wrong origins cannot open project controls');
 view.handlers.message({source:previewFrame.contentWindow,origin:'https://viewer.test',data:showProject});
 assert.equal(view.bodyClasses.has('focus-drawing'),false);assert.equal(view.get('overviewPanel').hidden,false);assert.equal(view.get('drawingPreview').hidden,true);
 const launch=view.get('overviewContent').children.flatMap(n=>n.children).find(n=>n.textContent==='Open Layout');assert.ok(launch);launch.onclick();assert.equal(view.bodyClasses.has('focus-drawing'),true);assert.equal(view.get('drawingPreview').hidden,false);
 assert.equal(view.get('drawingPreview').children.find(n=>n.src),previewFrame,'returning to drawing preserves the iframe and drafts');
 const focusControl=view.get('drawingPreview').children[0].children[0];
 focusControl.onclick();assert.equal(view.bodyClasses.has('focus-drawing'),false);
 focusControl.onclick();assert.equal(view.bodyClasses.has('focus-drawing'),true);

 view.get('projectTreeToggle').onclick();assert.equal(view.get('projectTreeToggle').attributes['aria-expanded'],'false');view.get('projectTreeToggle').onclick();assert.equal(view.get('projectTreeToggle').attributes['aria-expanded'],'true');
 view.get('drawingPreview').children[0].children.find(n=>n.textContent==='Close preview').onclick();assert.equal(view.get('drawingPreview').children.length,0);
 await view.get('loadBoardSetup').onclick();assert.equal(view.get('stackupPanel').hidden,false);assert.match(view.get('stackupContent').textContent,/1.6 mm/);assert.match(view.get('stackupContent').textContent,/F.Cu/);assert.match(view.get('stackupContent').textContent,/no saved physical stackup/);assert.doesNotMatch(view.get('stackupContent').textContent,/FR4/);
});
test('project folders start collapsed outside the active path and expand for search',async()=>{
 const view=runtime(async()=> '{}',[{path:'board.kicad_pro'},{path:'Other/x.kicad_pro'}]);await tick();
 assert.equal(view.get('fileTree').children[0].open,false);
 view.get('fileSearch').value='Other';view.get('fileSearch').oninput();assert.equal(view.get('fileTree').children[0].open,true);
 view.get('collapseProjectTree').onclick();assert.equal(view.get('fileSearch').value,'');assert.equal(view.get('fileTree').children[0].open,false);
 view.get('expandProjectTree').onclick();assert.equal(view.get('fileTree').children[0].open,true);
});


test('failed project metadata still opens the requested file and discloses unpinned incomplete structure',async()=>{
 const view=runtime(async()=>'{"board":{"design_settings":{"rules":{"min_clearance":0.2}}}}',null,'GitHub API rate limit reached.');await tick();
 view.get('settingsTab').onclick();assert.equal(view.get('projectFile').textContent,'board.kicad_pro');assert.match(view.get('settingSections').textContent,/Board constraints/);assert.match(view.get('inventoryNote').textContent,/rate limit.*not been pinned/);assert.equal(view.requests.find(r=>r.type==='project-file').ref,'main');assert.equal(view.get('loadBoardSetup').disabled,true);
});
test('failed metadata and source reads end loading with an actionable error and filename',async()=>{
 const view=runtime(async()=>{throw Error('GitHub authentication failed (HTTP 401). Reconnect your account.');},null,'GitHub denied this request.');await tick();assert.equal(view.get('projectFile').textContent,'board.kicad_pro');assert.match(view.get('projectStatus').textContent,/Unable to load board.kicad_pro.*Reconnect/);assert.doesNotMatch(view.get('projectFile').textContent,/Loading/);
});


test('main tree accepts only current isolated viewer hierarchy, reuses sheet order and marks net sheets',async()=>{
 const files=[{path:'board.kicad_pro'},{path:'root.kicad_sch'},{path:'child.kicad_sch'}],view=runtime(async path=>path.endsWith('.kicad_pro')?'{}':'(kicad_sch)',files);await tick();await view.get('fileTree').children.find(n=>n.textContent==='child.kicad_sch').onclick();const frame=view.get('drawingPreview').children.find(n=>n.src),posts=[];frame.contentWindow={postMessage:m=>posts.push(m)};
 const hierarchy={sheets:[{path:'root.kicad_sch',label:'Root'},{path:'child.kicad_sch',label:'Power'}],links:[{path:'root.kicad_sch',label:'Power',properties:{Sheetfile:'child.kicad_sch'}}],active:'child.kicad_sch',highlighted:['root.kicad_sch','child.kicad_sch']},data={type:'kicad-review:hierarchy',repository:'wayri/review',ref:'a'.repeat(40),hierarchy};
 view.handlers.message({source:{},origin:'https://viewer.test',data});assert.doesNotMatch(view.get('fileTree').textContent,/Schematic hierarchy/);view.handlers.message({source:frame.contentWindow,origin:'https://evil.test',data});assert.doesNotMatch(view.get('fileTree').textContent,/Schematic hierarchy/);view.handlers.message({source:frame.contentWindow,origin:'https://viewer.test',data:{...data,ref:'other'}});assert.doesNotMatch(view.get('fileTree').textContent,/Schematic hierarchy/);
 view.handlers.message({source:frame.contentWindow,origin:'https://viewer.test',data});const tree=view.get('fileTree').children[1];assert.equal(tree.children.length,2);assert.equal(tree.children[1].children[1].textContent,'Power●');assert.match(tree.children[1].children[1].className,/net-sheet-match/);tree.children[1].children[1].onclick();assert.equal(posts[0].file,'child.kicad_sch');assert.equal(posts[0].type,'kicad-review:open-sheet');view.get('collapseProjectTree').onclick();assert.equal(view.get('fileTree').children[1].children.length,1);
 view.handlers.message({source:frame.contentWindow,origin:'https://viewer.test',data:{...data,hierarchy:{...hierarchy,highlighted:['secret.kicad_sch']}}});assert.equal(view.get('fileTree').children[1].children.length,1);
});


test('settings preparation is reused only for identical revision and source',async()=>{
 let parses=0,content='{"future":1}';const loading={indicator:()=>({show(){},hide(){},dispose(){}}),paint:async()=>{},run:async(job,payload,fallback)=>{parses++;return fallback();}};
 const view=runtime(async()=>content,null,null,{loading});await tick();assert.equal(parses,1);await view.get('refreshProject').onclick();assert.equal(parses,1);view.get('settingsTab').onclick();assert.ok(view.get('settingSections').children.length,'cached settings must render after the previous DOM was cleared');content='{"future":42}';await view.get('refreshProject').onclick();assert.equal(parses,2);assert.match(view.get('projectSource').textContent,/42/);
});
test('superseded preparation is cancelled and its result cannot replace the new selection',async()=>{
 let finishOld,oldSignal,hideCount=0;const stages=[];
 const loading={indicator:()=>({show:s=>stages.push(s),hide:()=>hideCount++,dispose(){}}),paint:async()=>{},run:async(job,payload,fallback,options)=>{if(payload.file==='slow.kicad_pro'){oldSignal=options.signal;return new Promise(resolve=>finishOld=()=>resolve(fallback()));}return fallback();}};
 const view=runtime(async()=>'{"board":{}}',[{path:'board.kicad_pro'},{path:'slow.kicad_pro'},{path:'fast.kicad_pro'}],null,{loading});await tick();const buttons=view.get('fileTree').children,pending=buttons.find(n=>n.textContent==='slow.kicad_pro').onclick();await tick();await buttons.find(n=>n.textContent==='fast.kicad_pro').onclick();assert.equal(oldSignal.aborted,true);const hides=hideCount;finishOld();await pending;assert.equal(hideCount,hides);assert.equal(view.get('projectFile').textContent,'fast.kicad_pro');assert.ok(stages.some(s=>s.includes('Fetching slow')));assert.ok(stages.includes('Displaying saved settings…'));
});

test('primary project tab shows settings without embedding a second drawing shell',async()=>{
 const view=runtime(async file=>file.endsWith('.kicad_pcb')?'(kicad_pcb (version 20240108))':'{}',[{path:'board.kicad_pro'},{path:'board.kicad_pcb'}],null,{projectOnly:true});await tick();
 await view.get('fileTree').children.find(n=>n.textContent==='board.kicad_pcb').onclick();assert.equal(view.get('drawingPreview').children.length,0);assert.equal(view.bodyClasses.has('focus-drawing'),false);
 await view.get('openDesign').onclick();assert.equal(view.parentMessages.at(-1).message.type,'kicad-review:project-drawing');assert.equal(view.parentMessages.at(-1).message.file,'board.kicad_pcb');assert.equal(view.parentMessages.at(-1).origin,'https://viewer.test');
});

test('header project search filters saved settings and constraints as well as project paths',async()=>{
 const view=runtime(async()=>JSON.stringify({board:{design_settings:{rules:{min_clearance:0.2,min_track_width:0.25}}}}));await tick();view.get('projectSearch').value='clearance';view.get('projectSearch').oninput();assert.match(view.get('settingSections').textContent,/clearance/i);assert.doesNotMatch(view.get('settingSections').textContent,/Min track width/);assert.match(view.get('constraintSections').textContent,/clearance/i);view.get('projectSearch').value='never-matches';view.get('projectSearch').oninput();assert.match(view.get('constraintSections').textContent,/No matching/);view.get('projectSearch').value='';view.get('projectSearch').oninput();assert.match(view.get('constraintSections').textContent,/Track width/i);
});


test('saved reports default to inert Analysis with immutable iframe scope and separate HTML opt-in',async()=>{
 const files=[{path:'board.kicad_pro'},...['json','csv','tsv','wbk','raw','html'].map(ext=>({path:'analysis.'+ext}))];
 const view=runtime(async()=>'<script>throw Error("do not execute")</script><table><tr><td>1</td></tr></table>',files);await tick();
 for(const file of files.slice(1)){
  await view.get('fileTree').children.find(n=>n.textContent===file.path).onclick();assert.equal(view.get('analysisPanel').hidden,false);
  const frame=view.get('analysisPreviewHost').children[0];assert.equal(frame.src.split('?')[0],'analysis-viewer.html');const query=new URLSearchParams(frame.src.split('?')[1]);assert.equal(query.get('repository'),'wayri/review');assert.equal(query.get('ref'),'a'.repeat(40));assert.equal(query.get('file'),file.path);assert.equal(view.get('htmlPreviewHost').children.length,0);
 }
 view.get('htmlTab').onclick();assert.equal(view.get('htmlPanel').hidden,false);assert.equal(view.get('htmlPreviewHost').children.length,0,'HTML scripts remain opt-in');
 view.get('analysisTab').onclick();assert.equal(view.get('analysisReportList').children.length,6);
});

test('VS Code analysis launches an explicit native Results view without embedding a frame',async()=>{
 const opened=[],view=runtime(async()=> 'time,V\n0,1',[{path:'board.kicad_pro'},{path:'analysis.csv'}],null,{vscode:true,engineeringLauncher:{open:(page,source)=>opened.push({page,source})}});await tick();
 await view.get('fileTree').children.find(n=>n.textContent==='analysis.csv').onclick();assert.equal(view.get('analysisPanel').hidden,false);assert.match(view.get('analysisPreviewHost').textContent,/Results tab/);assert.equal(view.get('analysisPreviewHost').children.some(n=>n.src),false);
 await view.get('analysisPreviewHost').children.find(n=>n.textContent==='Open saved report').onclick();assert.equal(opened[0].page,'analysis-viewer.html');assert.equal(opened[0].source.file,'analysis.csv');assert.equal(opened[0].source.ref,'a'.repeat(40));
});
test('project Stop cancels the scoped read and rejects late source activation',async()=>{
 let stop,resolveFile;const loading={indicator:(host,options)=>{stop=options.onStop;return{show(){},hide(){},dispose(){}};}};
 const view=runtime(path=>new Promise(resolve=>{resolveFile=resolve;}),null,null,{loading});await tick();const pending=view.requests.find(r=>r.type==='project-file');assert.ok(pending.loadId);stop();assert.match(view.get('projectStatus').textContent,/Loading stopped/);assert.equal(view.requests.find(r=>r.type==='load-cancel').loadId,pending.loadId);resolveFile('{}');await tick();assert.doesNotMatch(view.get('projectStatus').textContent,/Viewing saved source/);
});


test('embedded project settings retains the file launch page and builds settings controls only on request',async()=>{
 const view=runtime(async file=>file.endsWith('.kicad_pcb')?'(kicad_pcb)':'{}',[{path:'board.kicad_pro'},{path:'board.kicad_sch'},{path:'board.kicad_pcb'},{path:'alternate.kicad_pcb'}],null,{projectOnly:true});await tick();assert.equal(view.get('overviewPanel').hidden,false);assert.equal(view.get('settingSections').children.length,0);assert.match(view.get('overviewContent').textContent,/Open Schematic.*Open Layout.*Calculator.*Gerber viewer/);
 const all=n=>[n,...n.children.flatMap(all)],open=all(view.get('overviewContent')).find(n=>n.textContent==='Open Layout'&&n.onclick);await open.onclick();assert.equal(view.requests.filter(m=>m.type==='project-file').at(-1).file,'board.kicad_pcb');
});


test('failed inventory retains an explicit commit without claiming its branch is unpinned',async()=>{
 const sha='c'.repeat(40),view=runtime(async()=> '{}',null,'Website HTTP404',{ref:sha});await tick();
 assert.match(view.get('inventoryNote').textContent,/requested commit is retained/);assert.doesNotMatch(view.get('inventoryNote').textContent,/not been pinned/);assert.equal(view.requests.find(r=>r.type==='project-file').ref,sha);assert.equal(view.get('projectRevision').textContent,sha);
});

test('failed repository files offer local folder rendering without connecting a review account',async()=>{
 const view=runtime(async()=>{throw Error('Website access unavailable');});await tick();
 assert.match(view.get('projectStatus').textContent,/needs no GitHub\/GitLab app authorization/);
 assert.equal(view.get('projectStatus').children.find(n=>n.href).href,'local-viewer.html');
 assert.ok(view.requests.every(r=>['project-inventory','project-file'].includes(r.type)));
 const native=runtime(async()=>{throw Error('Unavailable');},null,null,{vscode:true});await tick();assert.equal(native.get('projectStatus').children.some(n=>n.href),false);
});


test('embedded project theme accepts only its parent and uses drawing theme for Gerbers',async()=>{
 const view=runtime(async file=>file.endsWith('.gbr')?gerber:'{}',null,null,{projectOnly:true});await tick();
 const theme={type:'kicad-review:command',command:'set-theme',uiTheme:'light',drawingTheme:'dark'},message=extra=>view.handlers.message({source:view.context.parent,origin:'https://viewer.test',data:theme,...extra});
 message({source:{}});assert.equal(view.context.document.body.dataset.uiTheme,undefined);message({origin:'https://github.com'});assert.equal(view.context.document.body.dataset.uiTheme,undefined);
 message();assert.equal(view.context.document.body.dataset.uiTheme,'light');await view.get('fileTree').children.find(n=>n.textContent==='top.gbr').onclick();assert.equal(view.canvas().dark,true);
 message({data:{...theme,drawingTheme:'light'}});assert.equal(view.canvas().dark,false);view.get('projectTheme').onclick();assert.equal(view.canvas().dark,true);assert.equal(view.parentMessages.at(-1).message.file,'board.kicad_pro');assert.equal(view.parentMessages.at(-1).message.ref,'main');
});


test('project launch opens its schematic immediately at the discovered immutable revision',async()=>{
 const files=[{path:'board.kicad_pro'},{path:'board.kicad_pcb'},{path:'board.kicad_sch'},{path:'child.kicad_sch'}];
 const view=runtime(async path=>path.endsWith('.kicad_sch')?'(kicad_sch)':'{}',files);await tick();const frame=view.get('drawingPreview').children.find(n=>n.src);
 assert.ok(frame);const url=new URL(frame.src,'https://viewer.test');assert.equal(url.pathname,'/browser-viewer.html');assert.equal(url.searchParams.get('file'),'board.kicad_sch');assert.equal(url.searchParams.get('head'),'a'.repeat(40));assert.equal(view.bodyClasses.has('focus-drawing'),true);assert.ok(!view.requests.some(r=>r.type==='project-file'&&r.file==='board.kicad_pro'));
});

test('project startup uses its sole schematic or layout fallback but never guesses among schematics',async()=>{
 const cases=[[['board.kicad_pro','root.kicad_sch','board.kicad_pcb'],'root.kicad_sch'],[['board.kicad_pro','board.kicad_pcb'],'board.kicad_pcb'],[['board.kicad_pro','a.kicad_sch','b.kicad_sch','board.kicad_pcb'],null]];
 for(const [paths,expected]of cases){const view=runtime(async path=>path.endsWith('.kicad_pcb')?'(kicad_pcb (version 20240108))':path.endsWith('.kicad_sch')?'(kicad_sch)':'{}',paths.map(path=>({path})));await tick();const frame=view.get('drawingPreview').children.find(n=>n.src);assert.equal(frame?new URL(frame.src,'https://viewer.test').searchParams.get('file'):null,expected);}
});

test('embedded Project settings stays a settings page rather than recursively opening another viewer',async()=>{
 const view=runtime(async()=> '{}',[{path:'board.kicad_pro'},{path:'board.kicad_sch'}],null,{projectOnly:true});await tick();assert.equal(view.get('drawingPreview').children.some(n=>n.src),false);assert.equal(view.get('projectFile').textContent,'board.kicad_pro');
});


test('explicit schematic, PCB and legacy board links remain on their requested drawing',async()=>{
 for(const file of ['child.kicad_sch','board.kicad_pcb','legacy.brd']){const view=runtime(async path=>path.endsWith('.kicad_pcb')?'(kicad_pcb)':path.endsWith('.brd')?'PCBNEW-BOARD Version 1':'(kicad_sch)',[{path:'board.kicad_pro'},{path:'board.kicad_sch'},{path:file}],null,{file});await tick();const frame=view.get('drawingPreview').children.find(n=>n.src);assert.ok(frame,file);assert.equal(new URL(frame.src,'https://viewer.test').searchParams.get('file'),file);}
});

test('legacy project launch prefers its matching schematic before its legacy board',async()=>{
 const view=runtime(async()=> 'EESchema Schematic File Version 4',[{path:'board.pro'},{path:'board.sch'},{path:'board.brd'}],null,{file:'board.pro'});await tick();const frame=view.get('drawingPreview').children.find(n=>n.src);assert.equal(new URL(frame.src,'https://viewer.test').searchParams.get('file'),'board.sch');
});
