const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../project-download.js');
test('inventory refuses partial or unpinned listings and unsafe paths',()=>{
 const result=api.inventory({files:[{path:'b.kicad_pcb'},'a.kicad_sch','a.kicad_sch'],snapshotRef:'abc',warnings:[]});
 assert.deepEqual(result,{paths:['a.kicad_sch','b.kicad_pcb'],ref:'abc'});
 for(const value of [null,{files:[]},{files:[],snapshotRef:'abc',warnings:['truncated']},...['../bad','/bad','x\\bad','C:/x','x//y'].map(path=>({files:[path],snapshotRef:'abc'}))])assert.throws(()=>api.inventory(value));
});
test('source fetching preserves exact text and fails closed on missing, oversized or cancelled data',async()=>{
 const calls=[],saved=await api.sources(['a','b'],async path=>{calls.push(path);return {content:path+' Ω\r\n'};});assert.deepEqual(calls,['a','b']);assert.equal(saved[1].content,'b Ω\r\n');
 await assert.rejects(api.sources([],()=>{}),/Select/);
 await assert.rejects(api.sources(['x'],async()=>({})),/unavailable/);
 await assert.rejects(api.sources(['x'],async()=>({content:'x'.repeat(8*1024*1024+1)})),/exceeds/);
 let read=false;await assert.rejects(api.sources(['x'],async()=>{read=true;},()=>false),/cancelled/);assert.equal(read,false);
});
function harness(read){
 const nodes=[],downloads=[],requests=[];
 class Node{
  constructor(tag,text){this.tag=tag;this.textContent=text||'';this.children=[];this.handlers={};this.isConnected=true;this.value='';}
  append(...nodes){for(const n of nodes){this.children.push(n);if(this.tag==='select'&&!this.value)this.value=n.value;}}
  setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.handlers[k]=fn;}
  showModal(){this.open=true;}close(){this.open=false;this.handlers.close?.();}remove(){this.isConnected=false;}
  replaceChildren(){this.children=[];}
  querySelectorAll(){return this.children.flatMap(n=>n.children).filter(n=>n.tag==='input'&&n.checked);}
  click(){if(this.tag==='a')downloads.push({href:this.href,download:this.download});else return this.onclick?.();}
 }
 const doc={createElement(tag){const n=new Node(tag);nodes.push(n);return n;},createTextNode:text=>new Node('#text',text),querySelector:()=>null,body:new Node('body')};
 global.document=doc;global.KiCadRevisionActions={archiveURL:(scope,sha)=>'https://example.test/'+sha+'.zip'};
 const dialog=api.open({scope:{repository:'a/b',ref:'main',file:'a.kicad_sch'},remote:true,request:async(type,args)=>{requests.push({type,args});if(type==='project-file')return {content:read?read(args.file):'(source)'};return {files:['a.kicad_sch','sub/b.kicad_sch','board.kicad_pcb'],snapshotRef:'f'.repeat(40),warnings:[]};},onBom(){},focus(){}});
 return {nodes,downloads,requests,dialog,format:nodes.find(n=>n['aria-label']==='Download format'),extent:nodes.find(n=>n['aria-label']==='PDF drawings'),go:nodes.find(n=>n.tag==='button'&&n.textContent==='Download')};
}
test('whole-project download pins the revision and never invokes a desktop launch',async()=>{
 const h=harness();assert.equal(h.dialog.className,'project-download');assert.equal(h.dialog.open,true);await h.go.click();assert.equal(h.downloads[0].href,'https://example.test/'+'f'.repeat(40)+'.zip');assert.deepEqual(h.requests.map(r=>r.type),['project-inventory']);assert.equal(h.extent.value,'project');
});
test('selected-file controls include nested sheets rather than only the current sheet',async()=>{
 const h=harness();h.format.value='files';await h.format.onchange();const inputs=h.nodes.filter(n=>n.tag==='input');assert.deepEqual(inputs.map(n=>n.value),['a.kicad_sch','board.kicad_pcb','sub/b.kicad_sch']);assert.ok(inputs.every(n=>n.checked));
});

test('full-project PDF includes nested schematic sheets and PCB from one pinned revision',async()=>{
 const names=['KiCadInteractivePDF','KiCadDesignDiff','KiCadSchematicRenderer','KiCadPCBRenderer','KiCadDesignModel','KiCadNetModel','fetch','setTimeout'],before=new Map(names.map(k=>[k,global[k]]));let pages;
 try{
  global.KiCadDesignDiff={parse:text=>text};const renderer={build:()=>({page:{width:297,height:210},primitives:[],warnings:[]})};global.KiCadSchematicRenderer=global.KiCadPCBRenderer=renderer;
  global.KiCadDesignModel={buildProject:saved=>{assert.ok(saved.every(f=>/\.kicad_(sch|pcb)$/.test(f.path)));return {objects:[],warnings:[]};}};
  global.KiCadNetModel={build:()=>({nets:[],warnings:[]})};global.KiCadInteractivePDF={create:value=>{pages=value;return new Uint8Array([37,80,68,70]);}};
  global.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});global.setTimeout=(fn,ms)=>{const timer=before.get('setTimeout')(fn,ms);timer.unref();return timer;};
  const h=harness();global.document.baseURI='https://example.test/';h.format.value='pdf';await h.format.onchange();await h.go.click();
  assert.deepEqual(pages.map(p=>p.path),['a.kicad_sch','board.kicad_pcb','sub/b.kicad_sch']);
  assert.ok(h.requests.filter(r=>r.type==='project-file').every(r=>r.args.ref==='f'.repeat(40)));
  assert.equal(h.downloads[0].download,'kicad-project.pdf');assert.equal(h.requests.some(r=>r.type==='native-kicad-open'),false);
 }finally{for(const [key,value]of before){if(value===undefined)delete global[key];else global[key]=value;}}
});
