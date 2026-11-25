const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../design-diff.js'),{inspect}=require('../file-compatibility.js');
test('KiCad 8, 9 and 10 saved headers retain recognized geometry without version rejection',()=>{
 for(const version of ['8.0','9.0','10.0']){
  const ast=parse(`(kicad_pcb (version 20241229) (generator_version "${version}") (segment (start 1 2) (end 3 4) (width .2) (layer "F.Cu")))`);
  const result=require('../pcb-renderer.js').build(ast);
  assert.equal(result.compatibility.generatorVersion,version);assert.equal(result.compatibility.forwardPreview,false);
  assert.deepEqual(result.primitives.find(p=>p.kind==='track').points,[{x:1,y:2},{x:3,y:4}]);
 }
});
test('synthetic future headers and unknown constructs are visibly disclosed, not claimed as verified',()=>{
 const ast=parse('(kicad_sch (generator_version "11.0-dev") (version 20270101) (future_geometry (x 3)))');
 const result=require('../schematic-renderer.js').build(ast);
 assert.equal(result.compatibility.forwardPreview,true);assert.deepEqual(result.compatibility.unknown,['future_geometry']);
 assert.ok(result.warnings.some(w=>w.includes('forward-compatibility')));assert.ok(result.warnings.some(w=>w.includes('future_geometry')));
});
test('missing generator does not invent a KiCad major version',()=>{
 assert.equal(inspect(parse('(kicad_pcb (version 20241229))')).generatorVersion,null);
 assert.throws(()=>inspect([]),/root/);
});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const compatibility=require('../file-compatibility.js');
test('KiCad 8 schematic retains embedded symbol geometry and hidden-field state',()=>{
 const source=`(kicad_sch (version 20231120) (generator eeschema) (generator_version "8.0.9")
 (lib_symbols (symbol "Device:R" (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2) (stroke (width .2)) (fill (type none))))))
 (symbol (lib_id "Device:R") (at 20 30 90) (unit 1) (uuid "placed-eight")
 (property "Reference" "R8" (at 20 27) (effects (font (size 1 1))))
 (property "Value" "10k" (at 20 33) (effects (font (size 1 1)) hide))))`;
 const result=require('../schematic-renderer.js').build(parse(source));
 assert.equal(result.compatibility.majorVersion,8);assert.equal(result.compatibility.forwardPreview,false);
 assert.ok(result.primitives.some(p=>p.uuid==='placed-eight'&&p.type==='polygon'));
 assert.ok(result.primitives.some(p=>p.text==='R8'));assert.ok(!result.primitives.some(p=>p.text==='10k'));
});
test('official KiCad 8 release corpus remains byte-identical and preserves tstamp ownership/custom fields',()=>{
 const root=path.join(__dirname,'fixtures/kicad8'),provenance=JSON.parse(fs.readFileSync(path.join(root,'provenance.json')));
 for(const fixture of provenance.fixtures){const bytes=fs.readFileSync(path.join(root,fixture.file));assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),fixture.sha256);
 const ast=parse(bytes.toString()),renderer=fixture.file.endsWith('.kicad_pcb')?require('../pcb-renderer.js'):require('../schematic-renderer.js');
 const before=JSON.stringify(ast),result=renderer.build(ast);assert.ok(result.primitives.length>10);assert.equal(JSON.stringify(ast),before);
 assert.equal(result.compatibility.majorVersion,null,'older upstream files do not identify the generator major');
 if(fixture.file.endsWith('.kicad_pcb'))assert.ok(result.primitives.some(p=>p.ownerUuid&&p.kind==='pad'));
 }
});
test('only unavailable features produce an upgrade recommendation for KiCad 8',()=>{
 const eight=inspect(parse('(kicad_pcb (generator_version "8.0.9"))'));
 for(const id of ['drawing','review','hierarchy','copper','models'])assert.equal(compatibility.capability(eight,id).available,true);
 for(const id of ['embeddedAssets','componentClasses','netclassRuleAreas']){const result=compatibility.capability(eight,id);assert.equal(result.available,false);assert.equal(result.upgrade,true);assert.match(result.reason,/latest stable KiCad/);assert.doesNotMatch(result.reason,/upgrading the project alone will not enable/);
  assert.equal(compatibility.capability({majorVersion:10},id).available,true);}
 const tables=compatibility.capability(eight,'schematicTables');assert.equal(tables.available,false);assert.equal(tables.upgrade,true);assert.doesNotMatch(tables.reason,/upgrading the project alone will not enable/);
 const nativeTables=compatibility.capability({majorVersion:10},'schematicTables');assert.equal(nativeTables.available,true);assert.match(nativeTables.reason,/Horizontal tables/);assert.match(nativeTables.reason,/Rotated tables are omitted/);
 assert.deepEqual(inspect(parse('(kicad_sch (table))')).unknown,[]);
 assert.equal(compatibility.capability(inspect(parse('(kicad_pcb (generator_version "9.0"))')),'embeddedAssets').upgrade,false);
 assert.equal(compatibility.capability(inspect(parse('(kicad_pcb (version 20231120))')),'embeddedAssets').upgrade,false);
});
test('compatibility popup refreshes across sheets and unavailable access opens a truthful upgrade dialog',()=>{
 class Element{constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.open=false;}append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes[k]=v;}replaceChildren(...nodes){this.children=nodes;}addEventListener(){}showModal(){this.open=true;}close(){this.open=false;}remove(){this.removed=true;}}
 const document={body:new Element('body'),createElement:tag=>new Element(tag)};
 const context={document};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../file-compatibility.js'),'utf8'),context);
 let current={majorVersion:8,generatorVersion:'8.0.9',formatVersion:20231120,unknown:[]};
 const host=new Element('header'),control=context.KiCadFileCompatibility.mountStatus(host,()=>current),dialog=document.body.children[0];
 assert.equal(host.children[0].textContent,'KiCad 8 · Features');assert.equal(control.check('drawing'),true);assert.equal(dialog.open,false);
 assert.equal(control.check('embeddedAssets'),false);assert.equal(dialog.open,true);assert.ok(dialog.children.some(p=>p.textContent?.includes('latest stable KiCad')));
 assert.equal(dialog.children.find(p=>p.tag==='a').href,'https://www.kicad.org/download/');
 current={majorVersion:10,generatorVersion:'10.0',unknown:[]};control.refresh();assert.equal(dialog.open,false);assert.equal(host.children[0].textContent,'KiCad 10 · Features');
 assert.equal(control.check('embeddedAssets'),true);assert.equal(dialog.open,false);
 control.dispose();assert.equal(dialog.removed,true);
});
