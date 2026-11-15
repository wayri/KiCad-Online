const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../local-project.js'),'utf8');
const store={getItem:()=>null,setItem(){}};
function setup(fetch,files=[{path:'board.kicad_pcb',size:32,diskPath:'/assets/viewer/downloaded/'+'a'.repeat(32)+'/0'}],extra={}){
 const context=vm.createContext({fetch,TextEncoder,console,Date,...extra});vm.runInContext(code,context);
 const project={id:'project',diskBacked:true,files,assets:[]};return{api:context.KiCadAndroidLocal.transport(project,store),project,local:context.KiCadAndroidLocal};
}
test('concurrent and repeated disk reads are reused without sharing mutable result objects',async()=>{
 let count=0,release;const {api}=setup(async()=>{count++;await new Promise(resolve=>release=resolve);return{ok:true,text:async()=>'(kicad_pcb)'};});
 const one=api.send({type:'project-file',file:'board.kicad_pcb'}),two=api.send({type:'project-file',file:'board.kicad_pcb'});release();
 const [a,b]=await Promise.all([one,two]);assert.equal(count,1);assert.equal(a.ok,true);assert.equal(b.ok,true);
 a.result.content='tampered';assert.equal((await api.send({type:'project-file',file:'board.kicad_pcb'})).result.content,'(kicad_pcb)');assert.equal(count,1);
});
test('failed reads retry and other project snapshots have independent caches',async()=>{
 let count=0;const fetch=async()=>({ok:++count!==1,text:async()=>'(kicad_pcb)'}),first=setup(fetch);
 assert.equal((await first.api.send({type:'project-file',file:'board.kicad_pcb'})).ok,false);
 assert.equal((await first.api.send({type:'project-file',file:'board.kicad_pcb'})).ok,true);
 await setup(fetch).api.send({type:'project-file',file:'board.kicad_pcb'});assert.equal(count,3);
});
test('oversized or underestimated text is not retained',async()=>{
 for(const declared of [17*1024*1024,1]){
  let count=0;const {api}=setup(async()=>{count++;return{ok:true,text:async()=>'(kicad_pcb)'};},[{path:'board.kicad_pcb',size:declared,diskPath:'source'}]);
  await api.send({type:'project-file',file:'board.kicad_pcb'});await api.send({type:'project-file',file:'board.kicad_pcb'});assert.equal(count,2);
 }
});
test('cache evicts old successful entries at the count bound',async()=>{
 let count=0;const files=Array.from({length:65},(_,i)=>({path:i+'.kicad_sch',size:30,diskPath:'source/'+i})),{api}=setup(async()=>{count++;return{ok:true,text:async()=>'(kicad_sch)'};},files);
 for(const file of files)await api.send({type:'project-file',file:file.path});
 await api.send({type:'project-file',file:files[0].path});assert.equal(count,66);
});
test('scope and expiry checks remain active even for warm data',async()=>{
 let count=0;const {api,project}=setup(async()=>{count++;return{ok:true,text:async()=>'(kicad_pcb)'};});
 await api.send({type:'project-file',file:'board.kicad_pcb'});
 assert.equal((await api.send({type:'project-file',file:'board.kicad_pcb',repository:'other/project'})).ok,false);
 project.temporary=true;project.expiresAt=Date.now()-1;assert.equal((await api.send({type:'project-file',file:'board.kicad_pcb'})).ok,false);assert.equal(count,1);
});
test('Android runtime retains one local adapter per exact snapshot object',async()=>{
 const runtime=fs.readFileSync(path.join(__dirname,'../../android-app/web/runtime.js'),'utf8');let created=0;
 const project={id:'one',files:[],assets:[]},context=vm.createContext({URL,URLSearchParams,AbortController,localStorage:store,location:{search:'',href:'https://appassets.androidplatform.net/assets/viewer/runtime.js'},document:{addEventListener(){}},KiCadAndroidLocal:{transport(snapshot){created++;return{send:async()=>({ok:true,result:snapshot.id})};}}});
 context.window=context;context.top=context;context.KiCadAndroidProject=project;vm.runInContext(runtime,context);
 for(let i=0;i<20;i++)assert.equal((await context.chrome.runtime.sendMessage({type:'project-file',file:'one'})).result,'one');assert.equal(created,1);
});
