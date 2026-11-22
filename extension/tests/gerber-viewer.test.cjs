const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(options={}){
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.clientWidth=800;this.clientHeight=600;this.style={};}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(key,value){this[key]=value;}addEventListener(){}getContext(){return {};}focus(){}click(){return this.onclick?.();}getBoundingClientRect(){return {left:0,top:0};}
 }
 const exports=[],requests=[],nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};get('track').value='.15';get('drill').value='.3';
 const fits=[],realCamera=require('../gerber-camera.js');let calls=0;const analysis=require('../gerber-analysis.js'),document={body:new Element('body'),getElementById:get,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},context={document,location:{search:options.search||''},URLSearchParams,TextEncoder,crypto:require('node:crypto').webcrypto,matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}},addEventListener(){},KiCadGerberCamera:{...realCamera,fit(bounds,size){const camera=realCamera.fit(bounds,size);fits.push({bounds,size,camera});return camera;}},KiCadGerberRenderer:require('../gerber-renderer.js'),KiCadGerberAnalysis:{...analysis,analyze(...args){calls++;return analysis.analyze(...args);}},KiCadLayerColors:{fabricationLayer:()=>null},console};
 context.chrome={runtime:{async sendMessage(message){requests.push(message);return options.sendMessage?options.sendMessage(message):{ok:false,error:'Not connected'};}}};context.AndroidKiCad={exportText(...args){exports.push(args);}};context.top=context;context.window=context;context.globalThis=context;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../gerber-viewer.js'),'utf8'),context);
 return {get,calls:()=>calls,fits,exports,requests};
}
test('viewer reuses geometry analysis across fit, visibility, opacity and repeated criteria',async()=>{
 const app=harness(),initial=app.calls(),text='%FSLAX24Y24*%%MOMM*%%ADD10C,1*%D10*X000000Y000000D03*M02*';
 app.get('files').files=[{name:'top.gtl',size:text.length,text:async()=>text}];app.get('files').onchange();
 for(let i=0;i<50&&!/files loaded/.test(app.get('status').textContent||'');i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.match(app.get('status').textContent,/1 files loaded/);assert.equal(app.calls(),initial+1);
 const afterLoad=app.calls();app.get('fit').onclick();app.get('analyze').onclick();assert.equal(app.calls(),afterLoad);
 const row=app.get('layers').children[0],checkbox=row.children[0].children[0].children[0];checkbox.checked=false;checkbox.onchange();checkbox.checked=true;checkbox.onchange();app.get('fit').onclick();assert.equal(app.calls(),afterLoad);
 const opacity=row.children[2].children[1];opacity.value='.5';opacity.oninput();assert.equal(app.calls(),afterLoad);
 app.get('track').value='.2';app.get('analyze').onclick();assert.equal(app.calls(),afterLoad+1);app.get('analyze').onclick();assert.equal(app.calls(),afterLoad+1);
});

test('fit passes complete merged extents to the real camera and keeps visible geometry on screen',async()=>{
 const app=harness(),camera=require('../gerber-camera.js'),names=['sensor-F_Cu.gbr','sensor-B_Cu.gbr','sensor-Edge_Cuts.gbr'];
 app.get('files').files=names.map(name=>{const text=fs.readFileSync(path.join(__dirname,'fixtures/gerbers',name),'utf8');return {name,size:Buffer.byteLength(text),text:async()=>text};});app.get('files').onchange();
 for(let i=0;i<50&&!/3 files loaded/.test(app.get('status').textContent||'');i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.match(app.get('status').textContent,/3 files loaded/);
 const check=()=>{const fitted=app.fits.at(-1);assert.ok(fitted.bounds.width>0);assert.ok(fitted.bounds.height>0);assert.equal(fitted.bounds.width,fitted.bounds.maxX-fitted.bounds.minX);assert.equal(fitted.bounds.height,fitted.bounds.maxY-fitted.bounds.minY);
  assert.ok(Object.values(fitted.camera).every(Number.isFinite));
  for(const point of [{x:fitted.bounds.minX,y:fitted.bounds.minY},{x:fitted.bounds.maxX,y:fitted.bounds.maxY}]){const screen=camera.screen(fitted.camera,point,fitted.size);assert.ok(screen.x>=0&&screen.x<=fitted.size.width);assert.ok(screen.y>=0&&screen.y<=fitted.size.height);}
 };check();
 app.get('fit').onclick();check();const firstRow=app.get('layers').children[0],checkbox=firstRow.children[0].children[0].children[0];checkbox.checked=false;checkbox.onchange();app.get('fit').onclick();check();
});


const waitStatus=async(app,pattern)=>{for(let i=0;i<100&&!pattern.test(app.get('status').textContent||'');i++)await new Promise(resolve=>setTimeout(resolve,5));assert.match(app.get('status').textContent,pattern);};
const localSource=(name,text,relative='')=>({name,webkitRelativePath:relative,size:Buffer.byteLength(text),text:async()=>text});
const film='%FSLAX24Y24*%%MOMM*%%ADD10C,1*%D10*X000000Y000000D03*M02*';

test('local Gerber job expands only selected matching files and exports exact manifest provenance',async()=>{
 const app=harness(),job=JSON.stringify({FilesAttributes:[{Path:'top.gtl',FileFunction:'Copper,L1,Top'},{Path:'holes.xnc',FileFunction:'Plated,1,2,PTH'}],GeneralSpecs:{LayerNumber:2,BoardThickness:1.6}}),drill='M48\nMETRIC\nT1C0.8\n%\nT1\nX1Y2\nM30';
 app.get('files').files=[localSource('board.gbrjob',job),localSource('top.gtl',film),localSource('holes.xnc',drill),localSource('unrelated.gbl',film)];app.get('files').onchange();await waitStatus(app,/2 files loaded/);
 const rows=app.get('layers').children;assert.equal(rows.length,3);assert.equal(rows[2].className,'layer fabrication-job');assert.match(rows[0].children[1].textContent,/job metadata/);assert.equal(app.requests.length,0);
 app.get('export').onclick();assert.equal(app.exports.length,1);const data=JSON.parse(app.exports[0][1]);assert.equal(data.analysis.jobs.length,1);assert.equal(data.analysis.jobs[0].metadata.GeneralSpecs.BoardThickness,1.6);assert.deepEqual(data.sources.map(s=>s.path),['board.gbrjob','top.gtl','holes.xnc']);assert.ok(data.sources.every(s=>/^[a-f0-9]{64}$/.test(s.sha256)));assert.equal(data.analysis.totals.drillHits,1);
});

test('local folder imports preserve job-relative directories and missing layers remain explicit',async()=>{
 const app=harness(),job=JSON.stringify({FilesAttributes:[{Path:'layers/top.gtl'},{Path:'layers/missing.gbl'}]});
 app.get('folder').files=[localSource('board.gbrjob',job,'fab/board.gbrjob'),localSource('top.gtl',film,'fab/layers/top.gtl')];app.get('folder').onchange();await waitStatus(app,/missing.gbl.*not selected/);
 app.get('export').onclick();const data=JSON.parse(app.exports[0][1]);assert.equal(data.analysis.coverage,'partial');assert.deepEqual(data.sources.map(s=>s.path),['fab/board.gbrjob','fab/layers/top.gtl']);assert.equal(data.analysis.failedFiles.length,1);assert.equal(app.requests.length,0);
});

test('multiple local jobs require explicit set selection and do not mix variants',async()=>{
 const app=harness(),job=path=>JSON.stringify({FilesAttributes:[{Path:path}]});app.get('files').files=[localSource('one.gbrjob',job('one.gtl')),localSource('two.gbrjob',job('two.gtl')),localSource('one.gtl',film),localSource('two.gtl',film)];app.get('files').onchange();assert.match(app.get('status').textContent,/Select one saved job/);assert.equal(app.get('projectSet').hidden,false);app.get('projectSet').value='two.gbrjob';app.get('projectSet').onchange();await waitStatus(app,/1 files loaded/);app.get('export').onclick();assert.deepEqual(JSON.parse(app.exports[0][1]).sources.map(s=>s.path),['two.gbrjob','two.gtl']);
});

test('repository job reads declared files at the exact requested revision without wider discovery',async()=>{
 const sha='a'.repeat(40),job=JSON.stringify({FilesAttributes:[{Path:'top.gbr',FileFunction:'Copper,L1,Top'}]}),sources={'fab/board.gbrjob':job,'fab/top.gbr':film};
 const app=harness({search:'?repository=owner%2Frepo&ref='+sha+'&file=fab%2Fboard.gbrjob',sendMessage:async msg=>({ok:true,result:{content:sources[msg.file]}})});await waitStatus(app,/1 files loaded/);assert.deepEqual(app.requests.map(r=>r.type),['project-file','project-file']);assert.deepEqual(app.requests.map(r=>r.file),['fab/board.gbrjob','fab/top.gbr']);assert.ok(app.requests.every(r=>r.ref===sha&&r.repository==='owner/repo'));
});

test('unsafe or negative job data is reported without rendering a guessed positive layer',async()=>{
 const app=harness(),job=JSON.stringify({FilesAttributes:[{Path:'top.gtl',FilePolarity:'Negative'}]});app.get('files').files=[localSource('board.gbrjob',job),localSource('top.gtl',film)];app.get('files').onchange();await waitStatus(app,/Negative job-file image polarity/);app.get('export').onclick();const data=JSON.parse(app.exports[0][1]);assert.equal(data.analysis.totals.primitives,0);assert.equal(data.analysis.coverage,'partial');assert.equal(data.analysis.jobs[0].files[0].filePolarity,'Negative');
});


test('a negative job reference hides a previously imported positive layer instead of silently reusing it',async()=>{
 const app=harness();app.get('files').files=[localSource('top.gtl',film)];app.get('files').onchange();await waitStatus(app,/1 files loaded/);
 const job=JSON.stringify({FilesAttributes:[{Path:'top.gtl',FilePolarity:'Negative'}]});app.get('files').files=[localSource('board.gbrjob',job),localSource('top.gtl',film)];app.get('files').onchange();await waitStatus(app,/Negative job-file image polarity/);
 const row=app.get('layers').children[0],checkbox=row.children[0].children[0].children[0];assert.equal(checkbox.checked,false);assert.equal(checkbox.disabled,true);app.get('showAll').onclick();assert.equal(app.get('layers').children[0].children[0].children[0].children[0].checked,false);app.get('export').onclick();assert.equal(JSON.parse(app.exports[0][1]).analysis.coverage,'partial');
});


test('repository scan uses its folder scope and loads discovered Gerbers at the pinned revision',async()=>{
 const sha='a'.repeat(40),paths=['fab/top.gbr','fab/bottom.gbl'];
 const app=harness({search:'?repository=owner%2Frepo&ref='+sha+'&scan=1&file=fab%2Fboard.gbrjob',sendMessage:async msg=>{
  if(msg.type==='project-inventory')return {ok:true,result:{files:paths.map(path=>({path})),snapshotRef:sha}};
  assert.ok(paths.includes(msg.file));
  return {ok:true,result:{content:film}};
 }});
 await waitStatus(app,/2 files loaded/);
 assert.deepEqual(app.requests.map(r=>[r.type,r.file]),[
  ['project-inventory','fab/board.gbrjob'],['project-file',paths[0]],['project-file',paths[1]]
 ]);
 assert.ok(app.requests.every(r=>r.ref===sha));
});
