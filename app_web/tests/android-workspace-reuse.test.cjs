const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){let loads=0;const nodes=new Map();class Node{constructor(){this.attrs=new Map;this.hidden=false;this.value='';this.events={};}set src(value){this.attrs.set('src',value);loads++;}get src(){return this.attrs.get('src');}getAttribute(name){return this.attrs.get(name)||null;}addEventListener(name,fn){this.events[name]=fn;}removeAttribute(name){this.attrs.delete(name);}}
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Node);return nodes.get(id);}},context={document,URLSearchParams,KiCadAndroidLocal:{pdfFile:()=>false,fabricationFile:()=>false,analysisFile:path=>path.endsWith('.json')},KiCadAndroidProject:{id:'project',files:[{path:'board.kicad_pcb'},{path:'root.kicad_sch'},{path:'report.json'}],assets:[]},dispatchEvent(){},Event};context.window=context;
 vm.runInNewContext(fs.readFileSync('android-app/web/index.js','utf8'),context);return{context,nodes,get loads(){return loads;}};
}
test('opening the same drawing again or returning from Home preserves the existing workspace',()=>{
 const f=fixture();f.context.KiCadAndroid.openDrawing('board.kicad_pcb');for(let i=0;i<20;i++)f.context.KiCadAndroid.openDrawing('board.kicad_pcb');assert.equal(f.loads,1);
 f.context.KiCadAndroid.showHome();assert.equal(f.nodes.get('viewer').hidden,true);f.context.KiCadAndroid.openDrawing('board.kicad_pcb');assert.equal(f.loads,1);assert.equal(f.nodes.get('viewer').hidden,false);
 f.context.KiCadAndroid.openDrawing('root.kicad_sch');assert.equal(f.loads,2);
});
test('another project or pinned revision still creates a fresh workspace',()=>{
 const f=fixture();f.context.KiCadAndroid.openDrawing('board.kicad_pcb');f.context.KiCadAndroidProject={...f.context.KiCadAndroidProject,id:'other'};f.context.KiCadAndroid.openDrawing('board.kicad_pcb');assert.equal(f.loads,2);
 f.context.KiCadAndroidProject={...f.context.KiCadAndroidProject,github:{repository:'owner/board',sha:'a'.repeat(40)}};f.context.KiCadAndroid.openDrawing('board.kicad_pcb');f.context.KiCadAndroidProject.github.sha='b'.repeat(40);f.context.KiCadAndroid.openDrawing('board.kicad_pcb');assert.equal(f.loads,4);
});

test('reopening a loaded analysis report clears its progress without reloading; pending reports retain progress',async()=>{
 const f=fixture(),loading=[];f.context.KiCadAndroidUI={loading:value=>loading.push(value)};
 await f.context.KiCadAndroid.openAnalysis('report.json');assert.equal(f.loads,1);assert.equal(loading.at(-1),'Opening analysis report...');
 await f.context.KiCadAndroid.openAnalysis('report.json');assert.equal(loading.at(-1),'Opening analysis report...');
 f.nodes.get('viewer').events.load();await f.context.KiCadAndroid.openAnalysis('report.json');assert.equal(f.loads,1);assert.equal(loading.at(-1),null);
});
