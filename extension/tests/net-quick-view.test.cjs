const test=require('node:test'),assert=require('node:assert/strict');
const {mount,occurrences,rotateVector,viewportPoint,MAX_WINDOWS}=require('../net-quick-view.js'),owned=require('../owned-canvas.js');
const {defaultProbeLayers,probeFileCandidates}=require('../net-quick-view.js');
class Element{
 constructor(tag,document){this.tag=tag;this.ownerDocument=document;this.children=[];this.listeners={};this.style={};this.attributes={};this.parent=null;this.textContent='';}
 append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.removed=true;}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,handler){(this.listeners[name]||=[]).push(handler);}
 setPointerCapture(){}
 getBoundingClientRect(){return{left:0,top:0,width:280,height:280};}
 emit(name,values={}){for(const handler of this.listeners[name]||[])handler({button:0,pointerId:1,clientX:10,clientY:10,preventDefault(){},stopPropagation(){},target:this,...values});}
}
function descendants(element){return[element,...element.children.flatMap(descendants)];}
function fixture(count=5,options={}){const document={createElement:tag=>new Element(tag,document)},holder=new Element('div',document),viewports=[],located=[];
 const designs=Array.from({length:count},(_,i)=>({primitives:[{type:'line',uuid:'line'+i,points:[{x:i,y:0},{x:i+3,y:4}],layer:'F.Cu'}],layers:['F.Cu']}));
 const entries=designs.map((design,i)=>({path:'sheet'+i+'.kicad_sch',label:'Sheet '+i,instanceId:'instance'+i,design,groups:[{id:'net'+i,name:'Power '+i,primitives:design.primitives}]}));
 const canvasAPI={bounds:owned.bounds,mount(host){const viewport={canvas:new Element('canvas',document),viewport:{camera:new owned.Camera(280,280)},setDocument(design,path){this.design=design;this.path=path;},setNetHighlights(groups,options){this.groups=groups;this.highlightOptions=options;},draw(){},requestDraw(){this.drawRequests=(this.drawRequests||0)+1;},dispose(){this.disposed=true;}};host.append(viewport.canvas);viewports.push(viewport);return viewport;}};
 const quick=mount({holder,getEntries:()=>entries,onLocate:(...args)=>located.push(args),canvasAPI,document,...options});const button=label=>descendants(holder).find(element=>element.tag==='button'&&element.attributes['aria-label']===label);return{document,holder,quick,entries,viewports,located,button,canvasAPI};}
test('occurrences use only saved primitives from each exact source and preserve hierarchy instances',()=>{
 const live={uuid:'pad',type:'pad'},stale={...live},design={primitives:[live]};const entries=[{path:'a.kicad_sch',instanceId:'one',design,groups:[{id:'net',name:'VCC',primitives:[live,stale]}]},{path:'a.kicad_sch',instanceId:'two',design,groups:[{id:'net',name:'VCC',primitives:[live]}]}],before=JSON.stringify(entries),rows=occurrences(entries);
 assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.deepEqual(rows[0].group.primitives,[live]);assert.equal(rows[0].group.primitives[0],live);assert.equal(JSON.stringify(entries),before);assert.equal(occurrences([{...entries[0],groups:[{primitives:[stale]}]}]).length,0);
});
test('popup layer default retains every copper layer, silk and outline without fabrication clutter',()=>{
 assert.deepEqual(defaultProbeLayers(['F.Cu','In1.Cu','B.Cu','F.SilkS','B.SilkS','Edge.Cuts','F.Fab','B.CrtYd','F.Paste']),['F.Cu','In1.Cu','B.Cu','F.SilkS','B.SilkS','Edge.Cuts']);
});
test('subsheet-origin probes resolve the loaded root stem and explicit pair before bounded identity search',()=>{
 const paths=['board/Main.kicad_pcb','other/Main.kicad_pcb','board/alternate.kicad_pcb'];
 const config={kind:'layout',rootFile:'board/Power.kicad_sch',files:[{path:'board/Main.kicad_sch'},{path:'board/Power.kicad_sch'}]};
 assert.deepEqual(probeFileCandidates(paths,config),['board/Main.kicad_pcb']);
 assert.deepEqual(probeFileCandidates(paths,{...config,pairedFile:'board/alternate.kicad_pcb'}),['board/alternate.kicad_pcb']);
 assert.deepEqual(probeFileCandidates(paths,{...config,files:[]}),['board/Main.kicad_pcb','board/alternate.kicad_pcb']);
});
test('popup Layers button changes only its own layer set and can close independently',()=>{
 const f=fixture(1);f.entries[0].path='board.kicad_pcb';f.entries[0].design.layers=['F.Cu','In1.Cu','F.SilkS','Edge.Cuts','F.Fab'];f.quick.openProbe(occurrences(f.entries)[0]);
 const viewport=f.viewports[0];assert.deepEqual([...viewport.visibleLayers],['F.Cu','In1.Cu','F.SilkS','Edge.Cuts']);
 f.button('Probe layers').emit('click');const panel=descendants(f.holder).find(n=>n.attributes['aria-label']==='Probe layers'&&n.tag==='div');assert.equal(panel.hidden,false);
 const fab=descendants(panel).find(n=>n.attributes['aria-label']==='Show F.Fab');fab.checked=true;fab.emit('change');assert.equal(viewport.visibleLayers.has('F.Fab'),true);
 f.button('Copper and silk').emit('click');assert.equal(viewport.visibleLayers.has('F.Fab'),false);f.button('Close layers').emit('click');assert.equal(panel.hidden,true);f.quick.dispose();
});
test('quarter-turn viewport transforms rotate pads, text and arcs as one rigid view and invert cursor coordinates',()=>{
 const fixtures=[{type:'pad',points:[{x:100,y:120},{x:130,y:120},{x:130,y:135},{x:100,y:135}]},{type:'text',x:160,y:70,angle:30},{type:'arc',start:{x:30,y:50},mid:{x:50,y:30},end:{x:70,y:50}}],snapshot=JSON.stringify(fixtures);
 for(let turns=0;turns<4;turns++)for(const p of [{x:10,y:30},{x:200,y:230},{x:140,y:140}]){const offset=rotateVector({x:p.x-140,y:p.y-140},turns),screen={x:140+offset.x,y:140+offset.y};assert.deepEqual(viewportPoint(screen,280,280,turns),p);assert.equal(Math.hypot(offset.x,offset.y),Math.hypot(p.x-140,p.y-140));}
 assert.deepEqual(rotateVector({x:1,y:0},1),{x:-0,y:1});assert.deepEqual(rotateVector({x:1,y:0},-1),{x:0,y:-1});assert.equal(JSON.stringify(fixtures),snapshot);
});
test('occurrence list opens at most four independent read-only views and closing releases every viewport',()=>{
 const f=fixture(),before=JSON.stringify(f.entries);assert.equal(f.quick.open(),5);for(let i=0;i<5;i++)f.button('Power '+i+' · Sheet '+i).emit('click');assert.equal(f.viewports.length,MAX_WINDOWS);assert.ok(descendants(f.holder).some(node=>node.textContent.includes('Four quick views')));assert.equal(f.viewports[0].design,f.entries[0].design);
 f.button('Rotate clockwise').emit('click');assert.equal(f.viewports[0].canvas.style.transform,'rotate(15deg)');f.button('Rotate counterclockwise').emit('click');assert.equal(f.viewports[0].canvas.style.transform,'rotate(0deg)');f.button('Locate').emit('click');assert.equal(f.located[0][0],f.entries[0]);
 f.button('Close quick view').emit('click');assert.equal(f.viewports[0].disposed,true);f.button('Power 4 · Sheet 4').emit('click');assert.equal(f.viewports.length,5);f.quick.close();assert.ok(f.viewports.every(viewport=>viewport.disposed));assert.equal(JSON.stringify(f.entries),before);f.quick.dispose();f.quick.dispose();assert.throws(()=>f.quick.open(),/closed/);
});
test('rotated miniature pan and cursor-anchored wheel zoom preserve world-coordinate semantics',()=>{
 const f=fixture(1);f.quick.open();f.button('Power 0 · Sheet 0').emit('click');for(let step=0;step<6;step++)f.button('Rotate clockwise').emit('click');const host=descendants(f.holder).find(node=>node.className==='net-quick-view-canvas'),camera=f.viewports[0].viewport.camera;
 camera.center.set(0,0);camera.zoom=2;host.emit('pointerdown',{clientX:10,clientY:10});host.emit('pointermove',{clientX:30,clientY:10});assert.equal(camera.center.x,0);assert.equal(camera.center.y,10);host.emit('pointerup');
 const point=viewportPoint({x:80,y:90},280,280,1),before=camera.screen_to_world(point);host.emit('wheel',{clientX:80,clientY:90,deltaY:-50});const after=camera.screen_to_world(point);assert.ok(Math.abs(before.x-after.x)<1e-10);assert.ok(Math.abs(before.y-after.y)<1e-10);f.quick.dispose();
});
test('renderer failures clean up a partial miniature and show a bounded diagnostic',()=>{
 const f=fixture(1);f.canvasAPI.mount=()=>{throw Error('Canvas unavailable');};f.quick.open();f.button('Power 0 · Sheet 0').emit('click');assert.equal(descendants(f.holder).filter(node=>node.className==='net-quick-view-window').length,0);assert.ok(descendants(f.holder).some(node=>node.textContent==='Quick view unavailable: Canvas unavailable'));f.quick.dispose();
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('popup click selects live geometry through authoritative filter mapping but3px drags only pan',()=>{
 const selected=[],calls=[],f=fixture(1,{onSelect:(...args)=>selected.push(args),resolveSelection:(entry,p,filter)=>{calls.push({entry,p,filter});return{kind:'pin',primitive:p,primitives:[p],pinNumber:'1'};}});f.quick.open();f.button('Power 0 · Sheet 0').emit('click');const host=descendants(f.holder).find(n=>n.className==='net-quick-view-canvas'),filter=descendants(f.holder).find(n=>n.attributes['aria-label']==='Probe selection filter'),p=f.entries[0].design.primitives[0];f.viewports[0].query=()=>[p];filter.value='pin';filter.emit('change');
 host.emit('pointerdown');host.emit('pointerup');assert.equal(selected.length,1);assert.equal(calls.at(-1).filter,'pin');assert.equal(calls.at(-1).p,p);assert.equal(selected[0][0],f.entries[0]);assert.match(selected[0][2].windowId,/^probe-/);
 host.emit('pointerdown');host.emit('pointermove',{clientX:14});host.emit('pointerup',{clientX:14});assert.equal(selected.length,1);f.quick.dispose();
});
test('popupspawn permits duplicates with uniqueIDs and flat rootownership boundedatfour',async()=>{
 const requests=[],f=fixture(1,{resolveViews:async(row,selection,mode)=>{requests.push({row,selection,mode});return[row];}}),row=occurrences(f.entries)[0],first=f.quick.openProbe(row);f.button('Open probe').emit('click');await tick();const sections=descendants(f.holder).filter(n=>n.className==='net-quick-view-window');assert.equal(sections.length,2);assert.equal(sections[0].parent,sections[1].parent);assert.notEqual(sections[0].attributes['data-window-id'],sections[1].attributes['data-window-id']);assert.equal(requests[0].mode,'schematic');f.quick.closeProbe(first);assert.equal(descendants(f.holder).filter(n=>n.className==='net-quick-view-window').length,1);for(let i=0;i<5;i++)f.quick.openProbe(row);assert.equal(descendants(f.holder).filter(n=>n.className==='net-quick-view-window').length,4);f.quick.dispose();
});
test('async3D close disposes lateadapter and unresolvedspawn cannot resurrectclosedparent',async()=>{
 let release,disposed=0;const f=fixture(1,{mount3D:()=>new Promise(resolve=>release=resolve)}),id=f.quick.openProbe(occurrences(f.entries)[0],{mode:'3d'});await tick();f.quick.closeProbe(id);release({dispose(){disposed++;},fit(){}});await tick();assert.equal(disposed,1);assert.equal(descendants(f.holder).filter(n=>n.className==='net-quick-view-window').length,0);f.quick.dispose();
 let resolve;const g=fixture(1,{resolveViews:()=>new Promise(r=>resolve=r)}),row=occurrences(g.entries)[0],parent=g.quick.openProbe(row);g.button('Open probe').emit('click');g.quick.closeProbe(parent);resolve(row);await tick();assert.equal(descendants(g.holder).filter(n=>n.className==='net-quick-view-window').length,0);g.quick.dispose();
});
test('failed3D switch retains existing2Drenderer and exposesdiagnostic',async()=>{
 const f=fixture(1,{mount3D:async()=>{throw Error('graphics budget');},resolveViews:async row=>row}),id=f.quick.openProbe(occurrences(f.entries)[0]);f.button('3D').emit('click');await tick();assert.equal(f.viewports[0].disposed,undefined);assert.ok(descendants(f.holder).some(n=>n.textContent==='Quick view unavailable: graphics budget'));assert.equal(descendants(f.holder).filter(n=>n.className==='net-quick-view-window').length,1);f.quick.closeProbe(id);assert.equal(f.viewports[0].disposed,true);f.quick.dispose();
});
test('fallback selection never usesstalegeometry anddistinguishesliveparts/pins/nets',()=>{
 const {selectionFor}=require('../net-quick-view.js'),pin={kind:'pad',reference:'J1',uuid:'p1',pinNumber:'1'},body={kind:'footprint',reference:'J1',uuid:'part'},wire={kind:'wire',uuid:'wire'},entry={design:{primitives:[pin,body,wire]},groups:[{name:'VCC',primitives:[pin,wire]}]};
 assert.equal(selectionFor(entry,pin).kind,'pin');assert.equal(selectionFor(entry,body).kind,'part');assert.equal(selectionFor(entry,wire).kind,'net');assert.equal(selectionFor(entry,wire,'part'),null);assert.equal(selectionFor(entry,{...pin}),null);assert.deepEqual(selectionFor(entry,pin,'part').primitives,[pin,body]);
});

test('switching back to current2D while3D ispending prevents latereplacement',async()=>{
 let release,disposed=0;const f=fixture(1,{resolveViews:async row=>row,mount3D:()=>new Promise(resolve=>release=resolve)});f.quick.openProbe(occurrences(f.entries)[0]);f.button('3D').emit('click');await tick();f.button('Schematic').emit('click');release({dispose(){disposed++;},fit(){}});await tick();assert.equal(disposed,1);assert.equal(f.viewports[0].disposed,undefined);assert.equal(f.button('Schematic').attributes['aria-pressed'],'true');f.quick.dispose();
});
test('links use flat screengeometry, arepointertransparent, toggleandretirescheduledwork',async()=>{
 const f=fixture(1,{getAnchor:()=>({x:700,y:200})}),row=occurrences(f.entries)[0];f.quick.openProbe(row,{selection:{kind:'part'}});await new Promise(resolve=>setTimeout(resolve,22));const svg=descendants(f.holder).find(n=>n.attributes.class==='net-quick-view-links');assert.equal(svg.children.length,2);assert.equal(svg.children[1].tag,'circle');assert.match(svg.children[0].attributes.d,/^M 700 200 C/);assert.equal(svg.children[0].attributes.stroke,'#a5a0de');assert.match(descendants(f.holder).find(n=>n.tag==='style').textContent,/pointer-events:none/);f.button('Links').emit('click');await new Promise(resolve=>setTimeout(resolve,22));assert.equal(svg.children.length,0);f.quick.dispose();
});

test('initial part andpin groupselection reaches resolver without being guessed asnet',async()=>{
 for(const kind of ['part','pin']){const received=[],f=fixture(1,{resolveViews:async(row,selection)=>{received.push(selection);return row;}}),group=f.entries[0].groups[0],canonical={kind,reference:'J1',...(kind==='pin'?{pinNumber:'1'}:{})};group.selection={kind,canonical,primitives:group.primitives};f.quick.open();f.button('Power 0 · Sheet 0').emit('click');f.button('Layout').emit('click');await tick();assert.equal(received[0],group.selection);assert.equal(received[0].canonical,canonical);f.quick.dispose();}
});


test('probe controls keep the drawing primary, with secondary controls behind one options button',()=>{
 const f=fixture(1);f.quick.openProbe(occurrences(f.entries)[0]);const section=descendants(f.holder).find(n=>n.className==='net-quick-view-window'),tools=descendants(section).find(n=>n.className==='net-quick-view-tools');
 assert.equal(tools.hidden,true);f.button('Probe options').emit('click');assert.equal(tools.hidden,false);assert.equal(f.button('Probe options').attributes['aria-expanded'],'true');f.button('Probe options').emit('click');assert.equal(tools.hidden,true);f.quick.dispose();
});
test('guide curves terminate on the popup perimeter and stay curved in either direction',()=>{
 const {guideEndpoint,guideCurve}=require('../net-quick-view.js'),rect={left:100,top:80,width:300,height:200};
 assert.deepEqual(guideEndpoint(rect,{x:700,y:180}),{x:400,y:180});assert.deepEqual(guideEndpoint(rect,{x:250,y:0}),{x:250,y:80});
 for(const [a,b]of [[{x:0,y:20},{x:300,y:80}],[{x:300,y:80},{x:0,y:20}]]){const curve=guideCurve(a,b);assert.match(curve,/ C /);assert.ok(!/NaN|Infinity/.test(curve));assert.ok(curve.endsWith(`${b.x} ${b.y}`));}
});


test('net guides attach to a saved copper or pin point, not empty bounding-box space',()=>{
 const {geometryAnchor}=require('../net-quick-view.js'),fallback={x:5,y:5},pad={kind:'pad',padCenter:{x:2,y:3}},wire={type:'line',points:[{x:8,y:9},{x:10,y:9}]};
 assert.deepEqual(geometryAnchor([wire,pad],'net',fallback),{x:2,y:3});assert.deepEqual(geometryAnchor([wire],'net',fallback),{x:8,y:9});assert.deepEqual(geometryAnchor([pad],'part',fallback),{x:2,y:3});assert.equal(geometryAnchor([{...pad,hidden:true}],'net',fallback),fallback);
});


const control=(fixture,label)=>descendants(fixture.holder).find(element=>element.attributes['aria-label']===label);
const navigation=fixture=>descendants(fixture.holder).find(element=>element.className==='net-quick-view-nav');
test('schematic probes step connected occurrences and browse unhighlighted sheets without moving main selection',async()=>{
 const requests=[],selected=[],f=fixture(3,{onSelect:(...args)=>selected.push(args),getSchematicRows:async(row,selection)=>{requests.push({row,selection});const connected=occurrences([f.entries[0],f.entries[2]]);return{sheets:f.entries.map((entry,index)=>({id:'sheet-'+index,entry,name:'VCC',label:entry.label,selection,group:{primitives:index===1?[]:entry.design.primitives}})),occurrences:connected};}}),rows=occurrences(f.entries),original={kind:'net',canonical:{kind:'net',netName:'VCC',path:f.entries[0].path},primitives:f.entries[0].design.primitives},before=JSON.stringify(f.entries);
 f.quick.openProbe({...rows[0],selection:original});await tick();assert.equal(navigation(f).hidden,false);assert.equal(control(f,'Probe sheet').children.length,3);assert.equal(control(f,'Highlighted occurrence').children.length,2);assert.equal(navigation(f).children.at(-1).textContent,'1/2');const first=f.viewports.at(-1);first.viewport.camera.center.set(31,41);first.viewport.camera.zoom=7;f.button('Flip view').emit('click');f.button('Rotate clockwise').emit('click');
 f.button('Next occurrence').emit('click');await tick();assert.equal(f.viewports.at(-1).path,f.entries[2].path);assert.equal(navigation(f).children.at(-1).textContent,'2/2');const sheets=control(f,'Probe sheet');sheets.value='sheet-1';sheets.emit('change');await tick();assert.equal(f.viewports.at(-1).path,f.entries[1].path);assert.deepEqual(f.viewports.at(-1).groups[0].primitives,[]);assert.equal(navigation(f).children.at(-1).textContent,'0/2');assert.equal(requests.at(-1).selection,original,'blank sheet does not replace original navigation identity');assert.equal(requests.at(-1).row.id,rows[0].id);
 const occurrenceSelect=control(f,'Highlighted occurrence');occurrenceSelect.value=rows[0].id;occurrenceSelect.emit('change');await tick();assert.equal(f.viewports.at(-1).viewport.camera.center.x,31);assert.equal(f.viewports.at(-1).viewport.camera.center.y,41);assert.equal(f.viewports.at(-1).viewport.camera.zoom,7);assert.equal(f.viewports.at(-1).viewport.camera.flipped,true);assert.equal(f.viewports.at(-1).canvas.style.transform,'rotate(15deg)');assert.equal(f.located.length,0);assert.equal(selected.length,0);assert.equal(JSON.stringify(f.entries),before);f.quick.dispose();
});

test('repeated schematic instances keep distinct occurrence labels and IDs even when sharing one saved file',async()=>{
 let rows;const f=fixture(1,{getSchematicRows:async()=>({sheets:rows,occurrences:rows})}),base=occurrences(f.entries)[0];rows=['Channel A','Channel B'].map((label,index)=>({...base,id:'repeated-'+index,label,entry:{...base.entry,instanceId:undefined}}));f.quick.openProbe(rows[0]);await tick();assert.deepEqual(control(f,'Highlighted occurrence').children.map(node=>node.textContent),['Channel A · Power 0','Channel B · Power 0']);f.button('Next occurrence').emit('click');await tick();assert.equal(control(f,'Highlighted occurrence').value,'repeated-1');assert.equal(navigation(f).children.at(-1).textContent,'2/2');f.button('Previous occurrence').emit('click');await tick();assert.equal(control(f,'Highlighted occurrence').value,'repeated-0');f.quick.dispose();
});

test('schematic navigation falls back to loaded rows, handles one or no occurrence and hides in layout',async()=>{
 const fallback=fixture(2);fallback.quick.openProbe(occurrences(fallback.entries)[0]);await tick();assert.equal(control(fallback,'Probe sheet').children.length,2);assert.equal(control(fallback,'Highlighted occurrence').children.length,2);fallback.quick.dispose();
 for(const count of [0,1]){let rows;const f=fixture(1,{getSchematicRows:async()=>({sheets:rows,occurrences:count?rows:[]}),resolveViews:async row=>row});rows=occurrences(f.entries);f.quick.openProbe(rows[0]);await tick();assert.equal(f.button('Previous occurrence').disabled,true);assert.equal(f.button('Next occurrence').disabled,true);assert.equal(control(f,'Highlighted occurrence').disabled,!count);assert.equal(navigation(f).children.at(-1).textContent,count?'1/1':'0/0');f.button('Layout').emit('click');await tick();assert.equal(navigation(f).hidden,true);f.quick.dispose();}
});

test('explicit popup geometry selection resets navigation identity while async stale or closed results cannot replace it',async()=>{
 const pending=[],picked={kind:'pin',canonical:{kind:'pin',pinNumber:'2'},primitives:[]},f=fixture(2,{resolveSelection:()=>picked,getSchematicRows:(row,selection)=>new Promise(resolve=>pending.push({row,selection,resolve}))}),row=occurrences(f.entries)[0],id=f.quick.openProbe(row);await tick();assert.equal(pending.length,1);const host=descendants(f.holder).find(node=>node.className==='net-quick-view-canvas');f.viewports[0].query=()=>[row.group.primitives[0]];host.emit('pointerdown');host.emit('pointerup');await tick();assert.equal(pending.length,2);assert.equal(pending[1].selection,picked);
 const fresh={sheets:[{...row,id:'fresh',label:'Fresh'}],occurrences:[]};pending[1].resolve(fresh);await tick();assert.equal(control(f,'Probe sheet').children[0].textContent,'Fresh · Power 0');pending[0].resolve({sheets:[{...row,label:'Stale'}],occurrences:[row]});await tick();assert.equal(control(f,'Probe sheet').children[0].textContent,'Fresh · Power 0');
 f.button('Schematic').emit('click');await tick();assert.equal(pending.length,3);f.quick.closeProbe(id);pending[2].resolve(fresh);await tick();assert.equal(descendants(f.holder).filter(node=>node.className==='net-quick-view-window').length,0);assert.equal(f.viewports.length,1);f.quick.dispose();
});


test('disposing while sheet navigation resolves cannot create controls or revive its viewport',async()=>{
 let release;const f=fixture(1,{getSchematicRows:()=>new Promise(resolve=>release=resolve)}),row=occurrences(f.entries)[0];f.quick.openProbe(row);await tick();const viewport=f.viewports[0];f.quick.dispose();release({sheets:[row],occurrences:[row]});await tick();assert.equal(viewport.disposed,true);assert.equal(f.viewports.length,1);assert.equal(descendants(f.holder).some(node=>node.className==='net-quick-view-nav'),false);assert.equal(f.located.length,0);
});


test('2D popup flip preserves precise rotated picking, mirrored pan and cursor-anchored zoom',()=>{
 const points=[],f=fixture(1,{resolveSelection:(entry,p)=>({kind:'pin',primitive:p,primitives:[p]})});f.quick.openProbe(occurrences(f.entries)[0]);const host=descendants(f.holder).find(node=>node.className==='net-quick-view-canvas'),viewport=f.viewports[0],camera=viewport.viewport.camera,p=f.entries[0].design.primitives[0];camera.center.set(0,0);camera.zoom=2;viewport.query=at=>{points.push(at);return[p];};f.button('Flip view').emit('click');assert.equal(camera.flipped,true);for(let step=0;step<6;step++)f.button('Rotate clockwise').emit('click');
 const at=camera.world_to_screen({x:10,y:5}),rotated=rotateVector({x:at.x-140,y:at.y-140},1);host.emit('pointerdown',{clientX:140+rotated.x,clientY:140+rotated.y});host.emit('pointerup',{clientX:140+rotated.x,clientY:140+rotated.y});assert.deepEqual(points[0],{x:10,y:5});
 host.emit('pointerdown',{clientX:10,clientY:10});host.emit('pointermove',{clientX:10,clientY:30});host.emit('pointerup',{clientX:10,clientY:30});assert.equal(camera.center.x,10);assert.equal(camera.center.y,0);const point=viewportPoint({x:80,y:90},280,280,1),before=camera.screen_to_world(point);host.emit('wheel',{clientX:80,clientY:90,deltaY:-40});const after=camera.screen_to_world(point);assert.ok(Math.abs(before.x-after.x)<1e-10);assert.ok(Math.abs(before.y-after.y)<1e-10);f.quick.dispose();
});

test('flipped and rotated popup guides anchor to the reflected source geometry',async()=>{
 const f=fixture(1),row=occurrences(f.entries)[0],selection={kind:'part',primitives:row.group.primitives},parent=f.quick.openProbe(row,{selection});f.quick.openProbe(row,{parentId:parent,selection});const windows=descendants(f.holder).filter(node=>node.className==='net-quick-view-window');windows[1].getBoundingClientRect=()=>({left:500,top:0,width:280,height:280});const camera=f.viewports[0].viewport.camera;camera.center.set(0,0);camera.zoom=2;f.button('Flip view').emit('click');for(let step=0;step<6;step++)f.button('Rotate clockwise').emit('click');await new Promise(resolve=>setTimeout(resolve,22));const svg=descendants(f.holder).find(node=>node.attributes.class==='net-quick-view-links');assert.equal(svg.children.length,2);assert.match(svg.children[0].attributes.d,/^M 136 137 C/);f.quick.dispose();
});

test('popup keyboard F and bracket quarter-turns are local and never intercept editable controls or modified shortcuts',()=>{
 const f=fixture(1);f.quick.openProbe(occurrences(f.entries)[0]);const window=descendants(f.holder).find(node=>node.className==='net-quick-view-window'),camera=f.viewports[0].viewport.camera;let prevented=0,stopped=0;const key=(value,extra={})=>window.emit('keydown',{key:value,preventDefault(){prevented++;},stopPropagation(){stopped++;},...extra});key('f');assert.equal(camera.flipped,true);key(']');assert.equal(f.viewports[0].canvas.style.transform,'rotate(15deg)');key('[');assert.equal(f.viewports[0].canvas.style.transform,'rotate(0deg)');assert.equal(prevented,3);assert.equal(stopped,3);key('f',{target:control(f,'Probe selection filter')});key('f',{ctrlKey:true});key('f',{target:{isContentEditable:true}});key('q');assert.equal(camera.flipped,true);assert.equal(prevented,3);assert.equal(stopped,3);f.quick.dispose();
});

test('3D popup flip and quarter-turn controls delegate to the independent adapter',async()=>{
 const calls=[],f=fixture(1,{mount3D:async()=>({dispose(){},fit(){},flip(){calls.push('flip');return true;},rotate(degrees){calls.push(degrees);}})});f.quick.openProbe(occurrences(f.entries)[0],{mode:'3d'});await tick();f.button('Flip view').emit('click');f.button('Rotate clockwise').emit('click');const window=descendants(f.holder).find(node=>node.className==='net-quick-view-window');window.emit('keydown',{key:'[',preventDefault(){},stopPropagation(){}});assert.deepEqual(calls,['flip',15,-15]);assert.equal(f.viewports[0].viewport.camera.flipped,false);assert.equal(f.located.length,0);f.quick.dispose();
});


test('popup R and Shift+R rotate locally while editable inputs retain their keys',()=>{
 const f=fixture(1);f.quick.openProbe(occurrences(f.entries)[0]);const window=descendants(f.holder).find(node=>node.className==='net-quick-view-window');let handled=0;const key=(value,extra={})=>window.emit('keydown',{key:value,preventDefault(){handled++;},stopPropagation(){handled++;},...extra});key('r');assert.equal(f.viewports[0].canvas.style.transform,'rotate(15deg)');key('R',{shiftKey:true});assert.equal(f.viewports[0].canvas.style.transform,'rotate(0deg)');key('r',{target:control(f,'Probe sheet')});assert.equal(handled,4);assert.equal(f.viewports[0].canvas.style.transform,'rotate(0deg)');f.quick.dispose();
});

test('popup P spawns from the focused popup and cannot bubble to the main P action',async()=>{
 const calls=[],f=fixture(1,{resolveViews:async(row,selection,mode)=>{calls.push({row,selection,mode});return row;}}),row=occurrences(f.entries)[0];f.quick.openProbe(row);const window=descendants(f.holder).find(node=>node.className==='net-quick-view-window');let prevented=0,stopped=0;window.emit('keydown',{key:'p',preventDefault(){prevented++;},stopPropagation(){stopped++;}});await tick();assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(calls.length,1);assert.equal(calls[0].row,row);assert.equal(calls[0].mode,'schematic');assert.equal(descendants(f.holder).filter(node=>node.className==='net-quick-view-window').length,2);assert.equal(f.located.length,0);f.quick.dispose();
});


test('layout-to-schematic mapping reconciles a unique saved sheet despite new occurrence IDs and instance metadata',async()=>{
 let target,sheets;const f=fixture(1,{resolveViews:async()=>target,getSchematicRows:async()=>({sheets,occurrences:sheets})}),original=occurrences(f.entries)[0],selection={kind:'part',canonical:{kind:'part',path:'board.kicad_pcb',reference:'R1'},primitives:original.group.primitives},source={...original,id:'pcb-R1',entry:{...original.entry,path:'board.kicad_pcb'}},mapped={...original,id:'resolved-R1',entry:{...original.entry,instanceId:undefined}};target=mapped;sheets=[{...mapped,id:'sheet-root',entry:{...mapped.entry,instanceId:'saved-root'}}];f.quick.openProbe(source,{selection,mode:'layout'});f.button('Schematic').emit('click');await tick();assert.equal(navigation(f).children.at(-1).textContent,'1/1');assert.equal(control(f,'Probe sheet').value,'sheet-root');assert.equal(control(f,'Highlighted occurrence').value,'sheet-root');assert.equal(f.located.length,0);f.quick.dispose();
});

test('missing or conflicting instance metadata never guesses among repeated sheets',async()=>{
 for(const instanceId of [undefined,'explicit-other']){let rows;const f=fixture(1,{getSchematicRows:async()=>({sheets:rows,occurrences:rows})}),original=occurrences(f.entries)[0],source={...original,id:'unresolved',entry:{...original.entry,instanceId}};rows=['saved-A','saved-B'].map(id=>({...original,id,entry:{...original.entry,instanceId:id}}));f.quick.openProbe(source);await tick();assert.equal(control(f,'Probe sheet').value,'');assert.equal(control(f,'Highlighted occurrence').value,'');assert.equal(navigation(f).children.at(-1).textContent,'0/2');f.quick.dispose();}
});

test('3D popup hides the 2D rotation angle instead of claiming a false zero degrees',async()=>{
 const f=fixture(1,{mount3D:async()=>({dispose(){},fit(){},rotate(){}})});f.quick.openProbe(occurrences(f.entries)[0],{mode:'3d'});await tick();const angle=control(f,'View rotation');assert.equal(angle.hidden,true);f.button('Rotate clockwise').emit('click');assert.equal(angle.hidden,true);f.button('Schematic').emit('click');await tick();assert.equal(angle.hidden,false);f.quick.dispose();
});


test('part guides anchor to saved pads or body rather than distant field text',()=>{
 const {geometryAnchor}=require('../net-quick-view.js'),pads=[{type:'polygon',padCenter:{x:10,y:20}},{type:'polygon',padCenter:{x:12,y:20}},{type:'text',text:'long datasheet field',x:1000,y:1000}];
 assert.deepEqual(geometryAnchor(pads,'part',{x:500,y:500}),{x:11,y:20});
 assert.deepEqual(geometryAnchor([{type:'polyline',points:[{x:0,y:0},{x:2,y:4}],width:0},{type:'text',text:'far',x:999,y:999}],'part',null),{x:1,y:2});
});


test('fifteen-degree rigid transforms invert picking at arbitrary angles without changing distances',()=>{
 for(const turns of [1/6,-1/6,2/6,7/6,23/6])for(const p of [{x:14,y:39},{x:210,y:211}]){const offset=rotateVector({x:p.x-140,y:p.y-140},turns),screen={x:140+offset.x,y:140+offset.y},back=viewportPoint(screen,280,280,turns);assert.ok(Math.hypot(back.x-p.x,back.y-p.y)<1e-10);assert.ok(Math.abs(Math.hypot(offset.x,offset.y)-Math.hypot(p.x-140,p.y-140))<1e-10);}
});

test('popup axis shortcuts select independent3D presets while repeated and composing keys are untouched',async()=>{
 const views=[],f=fixture(1,{mount3D:async()=>({dispose(){},fit(){},setView(view){views.push(view);}})});f.quick.openProbe(occurrences(f.entries)[0],{mode:'3d'});await tick();const window=descendants(f.holder).find(n=>n.className==='net-quick-view-window');let handled=0;const key=(key,extra={})=>window.emit('keydown',{key,preventDefault(){handled++;},stopPropagation(){handled++;},...extra});for(const keyName of ['x','y','z']){key(keyName);key(keyName,{shiftKey:true});}assert.deepEqual(views,['right','left','back','front','top','bottom']);key('x',{repeat:true});key('x',{isComposing:true});key('x',{target:control(f,'Probe selection filter')});assert.equal(handled,12);assert.equal(views.length,6);assert.equal(f.located.length,0);f.quick.dispose();
});

test('guides continue over the popup drawing to its exact clicked point and follow rotation',async()=>{
 const f=fixture(1,{getAnchor:()=>({x:600,y:400}),resolveSelection:(entry,p)=>({kind:'pin',primitive:p,primitives:[p]})});f.quick.openProbe(occurrences(f.entries)[0]);const host=descendants(f.holder).find(n=>n.className==='net-quick-view-canvas'),viewport=f.viewports[0],camera=viewport.viewport.camera;camera.center.set(0,0);camera.zoom=2;viewport.query=()=>[f.entries[0].design.primitives[0]];host.emit('pointerdown',{clientX:160,clientY:150});host.emit('pointerup',{clientX:160,clientY:150});await new Promise(resolve=>setTimeout(resolve,22));const inner=descendants(f.holder).find(n=>n.attributes.class==='net-quick-view-inner-links');assert.equal(inner.children.length,2);assert.equal(Number(inner.children[1].attributes.cx),160);assert.equal(Number(inner.children[1].attributes.cy),150);f.button('Rotate clockwise').emit('click');await new Promise(resolve=>setTimeout(resolve,22));const offset=rotateVector({x:20,y:10},1/6);assert.ok(Math.abs(Number(inner.children[1].attributes.cx)-(140+offset.x))<1e-8);assert.ok(Math.abs(Number(inner.children[1].attributes.cy)-(140+offset.y))<1e-8);f.quick.dispose();
});


test('3D popup guide continues to projected geometry and follows independent orbit callbacks',async()=>{
 let viewChanged,point={x:120,y:90,visible:true};const f=fixture(1,{getAnchor:()=>({x:600,y:400}),mount3D:async(_host,config)=>{viewChanged=config.onViewChange;return{dispose(){},fit(){},projectAnchor:()=>point};}});f.quick.openProbe(occurrences(f.entries)[0],{mode:'3d'});await tick();await new Promise(resolve=>setTimeout(resolve,22));const inner=descendants(f.holder).find(n=>n.attributes.class==='net-quick-view-inner-links');assert.equal(inner.children.length,2);assert.equal(Number(inner.children[1].attributes.cx),120);assert.equal(Number(inner.children[1].attributes.cy),90);point={x:190,y:135,visible:true};viewChanged();await new Promise(resolve=>setTimeout(resolve,22));assert.equal(Number(inner.children[1].attributes.cx),190);assert.equal(Number(inner.children[1].attributes.cy),135);point={x:800,y:900,visible:false};viewChanged();await new Promise(resolve=>setTimeout(resolve,22));assert.equal(inner.children.length,0);f.quick.dispose();
});


test('selecting a net in a part popup rebinds title, highlight and same-view nested probes without mutating source rows',async()=>{
 const selected=[],f=fixture(1,{onSelect:(...args)=>selected.push(args)}),entry=f.entries[0],part=entry.design.primitives[0],wire={type:'line',uuid:'net-wire',points:[{x:10,y:3},{x:18,y:3}]},canonical={kind:'net',netNames:['VCC']};entry.groups[0].primitives=[part];entry.design.primitives.push(wire);entry.groups.push({id:'vcc',name:'VCC',kind:'net',canonical,primitives:[wire]});
 const initial={kind:'part',reference:'U1',primitives:[part],canonical:{kind:'part',reference:'U1'}},row={...occurrences([entry])[0],name:'U1',selection:initial,group:{kind:'part',primitives:[part],selection:initial}},snapshot=JSON.stringify(row);f.quick.openProbe(row);const parent=descendants(f.holder).find(n=>n.className==='net-quick-view-window'),host=descendants(parent).find(n=>n.className==='net-quick-view-canvas'),filter=descendants(parent).find(n=>n.attributes['aria-label']==='Probe selection filter');filter.value='net';filter.emit('change');f.viewports[0].query=()=>[wire];host.emit('pointerdown',{clientX:80,clientY:90});host.emit('pointerup',{clientX:80,clientY:90});assert.equal(parent.children[0].children[0].textContent,'VCC · Sheet 0');assert.deepEqual(f.viewports[0].groups[0].primitives,[wire]);assert.equal(selected[0][1].kind,'net');assert.ok(f.viewports[0].drawRequests>0,'selection schedules the changed highlight for painting');assert.deepEqual(selected[0][2].point,f.viewports[0].viewport.camera.screen_to_world({x:80,y:90}));
 f.button('Open probe').emit('click');await tick();let windows=descendants(f.holder).filter(n=>n.className==='net-quick-view-window');assert.equal(windows.length,2);assert.equal(windows[0].parent,windows[1].parent);assert.equal(windows[1].children[0].children[0].textContent,'VCC · Sheet 0');assert.deepEqual(f.viewports[1].groups[0].primitives,[wire]);assert.equal(JSON.stringify(row),snapshot);
 descendants(windows[1]).find(n=>n.attributes['aria-label']==='Open probe').emit('click');await tick();windows=descendants(f.holder).filter(n=>n.className==='net-quick-view-window');assert.equal(windows.length,3);assert.ok(windows.every(w=>w.parent===windows[0].parent));assert.deepEqual(f.viewports[2].groups[0].primitives,[wire]);assert.equal(f.located.length,0);f.quick.dispose();
});

test('reselected canonical net is passed to cross-view resolution and late part responses cannot replace it',async()=>{
 const requests=[],resolvers=[],f=fixture(1,{resolveSelection:(entry,p)=>({kind:'net',netName:'VCC',canonical:{kind:'net',netNames:['VCC']},primitives:[p],group:{id:'vcc',name:'VCC',primitives:[p]}}),resolveViews:(row,selection,mode)=>{requests.push({row,selection,mode});return new Promise(resolve=>resolvers.push(resolve));}}),entry=f.entries[0],part=entry.design.primitives[0],wire={type:'line',uuid:'wire',points:[{x:5,y:6},{x:9,y:6}]};entry.design.primitives.push(wire);const initial={kind:'part',reference:'U1',primitives:[part]},row={...occurrences([entry])[0],name:'U1',selection:initial};f.quick.openProbe(row);f.button('Open probe').emit('click');const parent=descendants(f.holder).find(n=>n.className==='net-quick-view-window'),host=descendants(parent).find(n=>n.className==='net-quick-view-canvas');f.viewports[0].query=()=>[wire];host.emit('pointerdown');host.emit('pointerup');resolvers.shift()(row);await tick();assert.equal(descendants(f.holder).filter(n=>n.className==='net-quick-view-window').length,1);
 f.button('Layout').emit('click');assert.equal(requests.at(-1).selection.kind,'net');assert.equal(requests.at(-1).row.name,'VCC');assert.equal(requests.at(-1).row.group.name,'VCC');assert.deepEqual(requests.at(-1).row.group.primitives,[wire]);assert.equal(requests.at(-1).row.selection,requests.at(-1).selection);
 const target={type:'line',points:[{x:3,y:4},{x:9,y:4}]},mapped={kind:'net',netName:'VCC',canonical:{kind:'net',netNames:['VCC']},primitives:[target]},targetEntry={path:'board.kicad_pcb',design:{primitives:[target],layers:['F.Cu']},groups:[]};resolvers.shift()({id:'layout-vcc',name:'VCC',label:'Layout',entry:targetEntry,group:{primitives:[target]},selection:mapped});await tick();assert.deepEqual(f.viewports.at(-1).groups[0].primitives,[target]);assert.equal(parent.children[0].children[0].textContent,'VCC · Layout');f.quick.dispose();
});

test('child popup guides remain live at the parent reselected clickpoint with independent target selection',async()=>{
 const f=fixture(1,{resolveSelection:(entry,p)=>({kind:'net',netName:'VCC',primitives:[p],group:{name:'VCC',primitives:[p]}})}),row=occurrences(f.entries)[0],id=f.quick.openProbe(row);f.quick.openProbe(row,{parentId:id});const windows=descendants(f.holder).filter(n=>n.className==='net-quick-view-window'),host=descendants(windows[0]).find(n=>n.className==='net-quick-view-canvas');windows[1].getBoundingClientRect=()=>({left:500,top:0,width:280,height:280});f.viewports[0].query=()=>row.group.primitives;host.emit('pointerdown',{clientX:80,clientY:90});host.emit('pointerup',{clientX:80,clientY:90});await new Promise(resolve=>setTimeout(resolve,22));const links=descendants(f.holder).find(n=>n.attributes.class==='net-quick-view-links');assert.match(links.children[0].attributes.d,/^M 80 90 C/);host.emit('pointerdown',{clientX:110,clientY:120});host.emit('pointerup',{clientX:110,clientY:120});await new Promise(resolve=>setTimeout(resolve,22));assert.match(links.children[0].attributes.d,/^M 110 120 C/);assert.equal(windows[1].children[0].children[0].textContent,'Power 0 · Sheet 0');f.quick.dispose();
});


test('main and popup guide copies share one exact cubic across translated viewport boundaries',async()=>{
 const origin={x:45,y:420},f=fixture(1,{getAnchor:()=>origin}),row=occurrences(f.entries)[0];f.quick.openProbe(row);
 const window=descendants(f.holder).find(n=>n.className==='net-quick-view-window'),host=descendants(window).find(n=>n.className==='net-quick-view-canvas');let rect={left:420,top:120,width:280,height:280};host.getBoundingClientRect=window.getBoundingClientRect=()=>rect;
 f.quick.refreshLinks();await new Promise(resolve=>setTimeout(resolve,22));const outer=descendants(f.holder).find(n=>n.attributes.class==='net-quick-view-links'),inner=descendants(window).find(n=>n.attributes.class==='net-quick-view-inner-links');
 assert.equal(inner.children[0].attributes.d,outer.children[0].attributes.d,'inner curve must reuse the global curve, not refit boundary handles');assert.equal(inner.children[0].attributes.transform,'translate(-420 -120)');
 const numbers=outer.children[0].attributes.d.match(/-?\d+(?:\.\d+)?/g).map(Number);assert.deepEqual(numbers.slice(0,2),[origin.x,origin.y]);assert.deepEqual(numbers.slice(-2),[Number(inner.children[1].attributes.cx)+rect.left,Number(inner.children[1].attributes.cy)+rect.top]);
 rect={...rect,left:650,top:180};f.quick.refreshLinks();await new Promise(resolve=>setTimeout(resolve,22));assert.equal(inner.children[0].attributes.d,outer.children[0].attributes.d);assert.equal(inner.children[0].attributes.transform,'translate(-650 -180)');assert.notDeepEqual(outer.children[0].attributes.d.match(/-?\d+(?:\.\d+)?/g).map(Number).slice(-2),numbers.slice(-2));f.quick.dispose();
});

test('popup to popup guides retain identical endpoints and tangents inside both source and destination',async()=>{
 const f=fixture(1,{resolveSelection:(entry,p)=>({kind:'net',primitives:[p],netName:'VCC'})}),row=occurrences(f.entries)[0],id=f.quick.openProbe(row);f.quick.openProbe(row,{parentId:id});const windows=descendants(f.holder).filter(n=>n.className==='net-quick-view-window'),hosts=windows.map(w=>descendants(w).find(n=>n.className==='net-quick-view-canvas')),rects=[{left:20,top:80,width:280,height:280},{left:620,top:180,width:280,height:280}];
 hosts.forEach((host,index)=>host.getBoundingClientRect=windows[index].getBoundingClientRect=()=>rects[index]);f.viewports[0].query=()=>row.group.primitives;hosts[0].emit('pointerdown',{clientX:100,clientY:170});hosts[0].emit('pointerup',{clientX:100,clientY:170});await new Promise(resolve=>setTimeout(resolve,22));
 const outer=descendants(f.holder).find(n=>n.attributes.class==='net-quick-view-links'),inside=windows.map(w=>descendants(w).find(n=>n.attributes.class==='net-quick-view-inner-links')),curve=outer.children[0].attributes.d;assert.match(curve,/^M 100 170 C/);
 inside.forEach((svg,index)=>{assert.equal(svg.children[0].attributes.d,curve,'all boundary pieces must use exactly the same cubic control points');assert.equal(svg.children[0].attributes.transform,'translate('+(-rects[index].left)+' '+(-rects[index].top)+')');});
 assert.deepEqual([Number(inside[0].children[1].attributes.cx)+20,Number(inside[0].children[1].attributes.cy)+80],[100,170]);const endpoint=curve.match(/-?\d+(?:\.\d+)?/g).map(Number).slice(-2);assert.deepEqual(endpoint,[Number(inside[1].children[1].attributes.cx)+620,Number(inside[1].children[1].attributes.cy)+180]);
 hosts[0].emit('pointerdown',{clientX:130,clientY:210});hosts[0].emit('pointerup',{clientX:130,clientY:210});await new Promise(resolve=>setTimeout(resolve,22));assert.match(outer.children[0].attributes.d,/^M 130 210 C/);inside.forEach(svg=>assert.equal(svg.children[0].attributes.d,outer.children[0].attributes.d));f.quick.dispose();
});

test('layout probes inherit and update layer colors while schematic probes keep their accent',()=>{
 let color='layer';const f=fixture(1,{getNetHighlightColor:()=>color});f.entries[0].path='board.kicad_pcb';f.quick.open();f.button('Power 0 · Sheet 0').emit('click');assert.equal(f.viewports[0].highlightOptions.selectionColor,'layer');
 color='accent';f.quick.setHighlightMode();assert.equal(f.viewports[0].highlightOptions.selectionColor,'accent');f.quick.dispose();
 const sch=fixture(1,{getNetHighlightColor:()=>'layer'});sch.quick.open();sch.button('Power 0 · Sheet 0').emit('click');assert.equal(sch.viewports[0].highlightOptions.selectionColor,'accent');sch.quick.dispose();
});
