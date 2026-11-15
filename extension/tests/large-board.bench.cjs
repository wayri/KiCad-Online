/* Bounded synthetic CPU acceptance, not an installed-browser or physical-board claim. */
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const diff=require('../design-diff.js'),pcb=require('../pcb-renderer.js'),model=require('../design-model.js'),nets=require('../net-model.js');
const through=process.argv.includes('--through'),count=Number(process.argv[2]||20001);assert.ok(Number.isInteger(count)&&count>=1&&count<=25000);
const layers=['F.Cu',...Array.from({length:30},(_,i)=>`In${i+1}.Cu`),'B.Cu'];
const chunks=['(kicad_pcb (version 20241229) (layers '+layers.map((name,i)=>`(${i} "${name}" signal)`).join(' ')+' (44 "Edge.Cuts" user)) (net 1 "TEST") (gr_rect (start 0 0) (end 1200 1200) (stroke (width .1)) (fill none) (layer "Edge.Cuts") (uuid "outline"))'];
for(let i=0;i<count;i++){const x=5+(i%145)*8,y=5+Math.floor(i/145)*8;chunks.push(`(footprint "Test:R" (layer "F.Cu") (at ${x} ${y}) (uuid "part-${i}") (property "Reference" "R${i+1}" (at 0 -1) (layer "F.SilkS") (effects (font (size .5 .5)))) (pad "1" ${through?'thru_hole':'smd'} rect (at 0 0) (size 1 1) ${through?'(drill .4)':''} (layers "${through?'*.Cu':'F.Cu'}") (net 1 "TEST") (uuid "pad-${i}")))`);}
layers.forEach((name,i)=>chunks.push(`(segment (start 1 ${i+1}) (end 1199 ${i+1}) (width .2) (layer "${name}") (net 1) (uuid "track-${i}"))`));chunks.push(')');
const source=chunks.join('\n'),start=performance.now(),ast=diff.parse(source),parsed=performance.now(),drawing=pcb.build(ast,'synthetic.kicad_pcb'),built=performance.now();
assert.equal(ast.filter(n=>Array.isArray(n)&&n[0]==='footprint').length,count);
assert.equal(drawing.primitives.filter(p=>p.kind==='pad').length,count*(through?32:1));
assert.ok(drawing.primitives.some(p=>p.uuid===`pad-${count-1}`));
for(const name of layers)assert.ok(drawing.primitives.some(p=>p.layer===name&&p.kind==='track'),name);
assert.ok(drawing.primitives.some(p=>p.uuid==='outline'));
const files=[{path:'synthetic.kicad_pcb',content:source}],snapshot=diff.prepareProject(files),prepared=performance.now(),saved=model.buildProject(files,null,snapshot),modeled=performance.now(),network=nets.build(files,new Map([['synthetic.kicad_pcb',drawing]]),snapshot),connected=performance.now();
assert.equal(saved.objects.filter(o=>o.kind==='footprint').length,count);assert.ok(network.nets.some(n=>n.members.some(m=>m.uuid===`pad-${count-1}`)));
console.log(JSON.stringify({fixture:through?'synthetic single through-hole pad per component across 32 copper layers':'synthetic minimal single-pad components, not BGA assemblies',sourceBytes:Buffer.byteLength(source),parts:count,copperLayers:layers.length,boardMm:[1200,1200],primitives:drawing.primitives.length,parseMs:parsed-start,geometryMs:built-parsed,preparationMs:prepared-built,modelMs:modeled-prepared,connectivityMs:connected-modeled,peakRssMiB:process.resourceUsage().maxRSS/1024,warnings:drawing.warnings},null,2));
