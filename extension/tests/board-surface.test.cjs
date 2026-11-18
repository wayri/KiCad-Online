const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {parse}=require('../design-diff.js'),{build}=require('../pcb-renderer.js');
require('../owned-canvas.js');
const project=path.resolve(__dirname,'../..'),roots=[project],git=path.join(project,'.git');
if(fs.statSync(git).isFile())roots.push(path.resolve(project,/^gitdir:\s*(.+)/.exec(fs.readFileSync(git,'utf8'))[1],'../../..'));
const threePath=roots.flatMap(root=>['extension/node_modules','.vizdiff/build-deps/node_modules'].map(dir=>path.join(root,dir,'three/build/three.module.js'))).find(fs.existsSync);
test('saved front and back artwork uses the PCB painter, board coordinates and face culling',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{makeSilkscreen,silkRaster}=await import('../spike/boardSurface.mjs');
 const ast=parse('(kicad_pcb (gr_line (start 0 0)(end 1 1)(layer "F.SilkS"))(footprint "A" (at 10 8 90)(layer "B.Cu")(property "Reference" "TP1" (at 2 0 90)(layer "B.SilkS")(effects (font (size 1 1))(justify mirror)))(fp_text user "hide" (at 1 2)(layer "B.SilkS") hide))(segment (start 1 1)(end 4 4)(layer "F.Cu")(width .2)))');
 const {primitives}=build(ast,'board.kicad_pcb',{silkscreenOnly:true});
 assert.deepEqual(primitives.map(p=>p.layer).sort(),['B.SilkS','F.SilkS']);
 const label=primitives.find(p=>p.type==='text');assert.deepEqual([label.x,label.y,label.angle,label.mirror],[10,6,-90,true]);
 const calls=[],ctx=new Proxy({},{get(o,k){return o[k]??((...args)=>calls.push([k,...args]));}});
 const old=global.document;global.document={createElement:()=>({getContext:()=>ctx})};
 try{
  const faces=makeSilkscreen(THREE,primitives,{minX:0,minY:0,maxX:20,maxY:20},new Map(),1.6);
  assert.deepEqual(faces.map(r=>[r.layer,r.mesh.material.side]),[['F.SilkS',THREE.FrontSide],['B.SilkS',THREE.BackSide]]);
  assert.ok(faces[0].mesh.position.z>.8&&faces[1].mesh.position.z<-.8);
  for(const expected of [['translate',320,192],['scale',-1,1],['fillText','TP1',0,0],['moveTo',0,0],['lineTo',32,32]])assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(expected)),expected.join());
  for(const r of faces){r.mesh.geometry.dispose();r.mesh.material.dispose();r.texture.dispose();}
 }finally{global.document=old;}
 assert.deepEqual(silkRaster({minX:0,minY:0,maxX:1000,maxY:250}),{zoom:2.048,width:2048,height:512});
});
test('selection restore retains collapsed substrate opacity and depth writes',{skip:!threePath},async()=>{
 const THREE=await import(pathToFileURL(threePath).href),{updateSubstrateMaterials}=await import('../spike/boardSurface.mjs'),{createSelectionAppearance}=await import('../spike/selectionAppearance.mjs');
 const originals=[new THREE.MeshPhysicalMaterial(),new THREE.MeshStandardMaterial()],mesh=new THREE.Mesh(undefined,originals);
 const appearance=createSelectionAppearance(THREE,()=>[mesh]);
 for(const translucent of [false,true]){
  appearance.update(()=>false,true,{translucent});updateSubstrateMaterials(originals,mesh.material,true,.12);
  assert.ok(mesh.material.every(m=>m.opacity===.12));appearance.restore();assert.ok(originals.every(m=>m.opacity===.12&&m.transparent&&!m.depthWrite));
  appearance.update(()=>false,true,{translucent});updateSubstrateMaterials(originals,mesh.material,false,1);
  assert.ok(mesh.material.every(m=>m.opacity===(translucent?.14:.24)));appearance.restore();
  assert.equal(mesh.material,originals);assert.ok(originals.every(m=>m.opacity===1&&!m.transparent&&m.depthWrite));
 }
 mesh.geometry.dispose();for(const m of originals)m.dispose();
});
