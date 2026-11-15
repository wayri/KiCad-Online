const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const local=require('../../android-app/web/local-project.js');
const store=()=>({getItem:()=>null,setItem(){throw Error('Source transport must not write.');}});

test('standalone saved analysis files are read as inert source and stay pinned to the import',async()=>{
 for(const extension of ['wbk','raw','csv','tsv','html','htm','json','txt']){
  const path='reports/analysis.'+extension,content='<script>globalThis.executed=true</script><table><tr><td>1</td></tr></table>';
  const project=local.validate({id:'report',files:[{path,content}]}),api=local.transport(project,store());
  assert.equal((await api.send({type:'project-file',repository:api.scope,ref:api.ref,file:path})).result.content,content);
  assert.equal((await api.send({type:'project-file',ref:'b'.repeat(40),file:path})).ok,false);
  assert.equal((await api.send({type:'source-save',file:path,content:'changed'})).ok,false);
  assert.equal(globalThis.executed,undefined);
 }
 assert.equal(local.analysisFile('config.json'),true);
 assert.equal(local.analysisFile('reports/thermal.json'),true);
 assert.throws(()=>local.validate({files:[{path:'report.js',content:'alert(1)'}]}));
});

function shell(){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:true,children:[],getAttribute(name){return this[name]??null;},addEventListener(name,fn){this[name]=fn;},removeAttribute(name){delete this[name];},replaceChildren(){this.children=[];this.value='';},append(node){this.children.push(node);if(!this.value)this.value=node.value;}});return nodes.get(id);};
 const loading=[],context={URLSearchParams,Event,KiCadAndroidLocal:local,document:{getElementById:get,createElement:()=>({})},dispatchEvent(){},KiCadAndroidUI:{loading:text=>loading.push(text)}};context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../../android-app/web/index.js'),'utf8'),context);return{context,get,loading};
}

test('saved spatial view is an optional bounded hint in Android report navigation',async()=>{
 const {context,get}=shell(),path='reports/quickpi.json';context.KiCadAndroidProject={id:'local',files:[{path,content:'{}'}]};
 await context.KiCadAndroid.openAnalysis(path,undefined,{resultView:'3d'});
 assert.equal(new URLSearchParams(get('viewer').src.split('?')[1]).get('resultView'),'3d');
 await context.KiCadAndroid.openAnalysis(path,undefined,{resultView:'https://foreign.invalid'});
 assert.equal(new URLSearchParams(get('viewer').src.split('?')[1]).has('resultView'),false);
});
test('native project Stop requires an explicit cancellable read and stale controls cannot stop a later load',()=>{
 const {context,get}=shell(),loading=[];let cancelled=0;
 context.AndroidKiCad={cancelProjectLoad(){cancelled++;}};context.KiCadAndroidUI.loading=(text,options)=>loading.push({text,options});
 const existing={id:'existing',files:[]};context.KiCadAndroidProject=existing;
 context.KiCadAndroid.setLoading('Saving export');assert.equal(loading.at(-1).options.onStop,undefined);
 context.KiCadAndroid.setLoading('Opening first',{canStop:true});const first=loading.at(-1).options.onStop;
 context.KiCadAndroid.setLoading('Opening second',{canStop:true});first();assert.equal(cancelled,0);
 const stop=loading.at(-1).options.onStop;stop();stop();assert.equal(cancelled,1);assert.equal(context.KiCadAndroidProject,existing);assert.equal(get('importStatus').textContent,'Project loading cancelled.');assert.equal(loading.at(-1).text,null);
 context.KiCadAndroid.setLoading('Opening third',{canStop:true});const done=loading.at(-1).options.onStop;context.KiCadAndroid.receiveError('Read failed');done();assert.equal(cancelled,1);
 delete context.AndroidKiCad.cancelProjectLoad;context.KiCadAndroid.setLoading('Older app',{canStop:true});assert.equal(loading.at(-1).options.onStop,undefined);
});
test('local native delivery requires the current uncancelled load ID before acknowledgment',()=>{
 const {context}=shell(),accepted=[],loading=[];context.AndroidKiCad={cancelProjectLoad(){},acceptProjectLoad:id=>accepted.push(id)};context.KiCadAndroidUI.loading=(text,options)=>loading.push({text,options});
 const existing={id:'retained'};context.KiCadAndroidProject=existing;
 context.KiCadAndroid.setLoading('Opening old',{canStop:true,loadId:5});loading.at(-1).options.onStop();context.KiCadAndroid.receiveProject({id:'stale',files:[]},{loadId:5});assert.equal(context.KiCadAndroidProject,existing);assert.deepEqual(accepted,[]);
 context.KiCadAndroid.setLoading('Opening current',{canStop:true,loadId:6});context.KiCadAndroid.receiveProject({id:'stale',files:[]},{loadId:5});assert.deepEqual(accepted,[]);
 context.KiCadAndroid.receiveProject({id:'current',files:[{path:'board.kicad_pcb',content:'(kicad_pcb)'}]},{loadId:6});assert.deepEqual(accepted,[6]);assert.equal(context.KiCadAndroidProject.id,'current');
});
test('Android opens standalone reports in the packaged viewer and keeps immutable project scope',async()=>{
 const {context,get,loading}=shell(),path='reports/simulation.csv';
 context.KiCadAndroid.receiveProject({id:'report',files:[{path,content:'time,V\n0,1'}]});
 assert.equal(get('viewer').hidden,false);assert.equal(get('viewer').src.split('?')[0],'analysis-viewer.html');
 let query=new URLSearchParams(get('viewer').src.split('?')[1]);assert.equal(query.get('file'),path);assert.equal(query.get('repository'),'android/report');assert.equal(query.get('ref'),'a'.repeat(40));
 assert.equal(loading.at(-1),'Opening analysis report...');get('viewer').load();assert.equal(loading.at(-1),null);
 const before=get('viewer').src;await context.KiCadAndroid.openAnalysis('../outside.html');assert.equal(get('viewer').src,before);
 context.KiCadAndroidProject={...local.validate({files:[{path,content:''}]}),remote:{provider:'gitlab',host:'https://gitlab.example.com',repository:'team/repo',sha:'b'.repeat(40)}};
 const revision={...context.KiCadAndroidProject,remote:{...context.KiCadAndroidProject.remote,sha:'c'.repeat(40)}};context.KiCadAndroidRevisionCache={get:async sha=>{assert.equal(sha,'c'.repeat(40));return revision;}};
 await context.KiCadAndroid.openAnalysis(path,'c'.repeat(40));query=new URLSearchParams(get('viewer').src.split('?')[1]);assert.equal(query.get('provider'),'gitlab');assert.equal(query.get('host'),'https://gitlab.example.com');assert.equal(query.get('ref'),'c'.repeat(40));
});
