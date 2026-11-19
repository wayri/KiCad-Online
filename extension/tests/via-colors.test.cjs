const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(base,name),'utf8');
function environment(){
 const ctx=new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 const element={style:{},setAttribute(){},addEventListener(){},removeEventListener(){},getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),remove(){}};
 const env={EventTarget,CustomEvent,TextEncoder,document:{createElement:()=>({...element,style:{}})},devicePixelRatio:1,ResizeObserver:class{observe(){}disconnect(){}}};
 for(const name of ['design-diff.js','file-compatibility.js','worksheet.js','layer-colors.js','pcb-renderer.js','pad-labels.js','owned-canvas.js'])vm.runInNewContext(source(name),env);
 return{env,host:{append(){},getBoundingClientRect:element.getBoundingClientRect}};
}
test('saved via annuli are gold on both copper layers without changing span or identity',()=>{
 const{env}=environment();const ast=env.KiCadDesignDiff.parse('(kicad_pcb (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) (via (at 1 1) (size .9) (drill .4) (layers "F.Cu" "B.Cu") (uuid "via-1")))');
 const vias=env.KiCadPCBRenderer.build(ast,'board.kicad_pcb').primitives.filter(p=>p.kind==='via');assert.equal(vias.length,2);assert.deepEqual(Array.from(vias,p=>p.layer),['F.Cu','B.Cu']);for(const p of vias){assert.equal(p.uuid,'via-1');assert.equal(p.color,'#c5aa6c');}
});
for(const mode of ['source','layer','accent','context'])test('via paint keeps gold when selected and dims unrelated copper in '+mode,()=>{
 const{env,host}=environment(),canvas=env.KiCadOwnedCanvas.mount(host,{pcb:true,dark:true});
 const via={type:'circle',kind:'via',uuid:'via-1',x:1,y:1,r:.45,fill:true,color:'#c5aa6c',layer:'F.Cu'},track={type:'line',kind:'track',uuid:'track',points:[{x:0,y:0},{x:2,y:0}],width:.2,layer:'F.Cu'};
 try{canvas.setDocument({primitives:[via,track],layers:['F.Cu']},'board.kicad_pcb');const painted=[];canvas.paint=(p,style)=>painted.push({p,style});canvas.setNetHighlight({primitives:[mode==='context'?track:via]},{mode:'dim',selectionColor:mode==='context'?'layer':mode});canvas.drawGeometry();const item=painted.find(x=>x.p===via);assert.ok(item);if(mode==='context'){assert.notEqual(item.style.color,via.color);assert.ok(item.style.opacity<=.05);}else assert.equal(item.style.color||via.color,'#c5aa6c');}finally{canvas.dispose();}
});
