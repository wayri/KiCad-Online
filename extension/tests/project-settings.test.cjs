const test=require('node:test'),assert=require('node:assert/strict');
const {parse,LIMITS}=require('../project-settings.js');
const pcb=`(kicad_pcb (version 20260101) (generator "fixture")
 (general (thickness 1.6)) (layers (0 "F.Cu" signal "Front") (31 "B.Cu" signal))
 (setup (pad_to_mask_clearance 0.05) (grid_origin 10 20)
  (stackup (layer "F.Cu" (type "copper") (thickness 0.035))
   (layer "dielectric 1" (type "core") (thickness 1.53 locked) (material "FR4") (epsilon_r 4.5) (loss_tangent 0.02))
   (layer "B.Cu" (type "copper") (thickness 0.035)) (copper_finish "ENIG") (edge_plating yes))
  (pcbplotparams (outputdirectory "fab/"))) (footprint "ignored drawing"))`;
test('saved JSON exposes all unknown fields and source pointers without guessed defaults',()=>{
 const source={meta:{version:1},board:{design_settings:{rules:{min_clearance:0.2},defaults:{track_width:0.25}}},net_settings:{classes:[{name:'Power',clearance:0.4}]},erc:{rule_severities:{pin_not_connected:'warning'}},'custom/key':{'a~b':[false,null,0]},empty:{}};
 const result=parse(JSON.stringify(source),{file:'hardware/design.kicad_pro'});
 assert.equal(result.kind,'project');assert.equal(result.sections.find(s=>s.id==='board/design_settings').entries.find(e=>e.path==='/board/design_settings/rules/min_clearance').value,0.2);
 const entries=result.sections.flatMap(s=>s.entries);
 assert.equal(entries.find(e=>e.path==='/custom~1key/a~0b/0').value,false);
 assert.equal(entries.find(e=>e.path==='/custom~1key/a~0b/1').value,null);
 assert.equal(entries.some(e=>/min_track_width/.test(e.path)),false);
 assert.equal(result.tree.net_settings.classes[0].name,'Power');assert.equal(Object.getPrototypeOf(result.tree),null);
});
test('malicious JSON property names remain own data without prototype pollution',()=>{
 const result=parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"admin":true}}}');
 assert.equal(result.tree.__proto__.polluted,true);assert.equal({}.polluted,undefined);assert.equal({}.admin,undefined);
 assert.equal(Object.getPrototypeOf(result.tree.constructor),null);
});
test('local preferences are inspectable and explicitly user-specific',()=>{
 const result=parse('{"board":{"visible_layers":[0,31]},"future_setting":"value"}',{file:'a.kicad_prl'});
 assert.equal(result.kind,'local-settings');assert.match(result.warnings.join(' '),/user-specific/);
 assert.equal(result.sections.find(s=>s.id==='future_setting').entries[0].value,'value');
});
test('board stackup preserves order, explicit millimetres, materials and source paths',()=>{
 const result=parse(pcb,{file:'board.kicad_pcb'});
 assert.equal(result.boardThicknessMm,1.6);assert.equal(result.layers[0].userName,'Front');
 assert.deepEqual(result.stackup.layers.map(l=>l.name),['F.Cu','dielectric 1','B.Cu']);
 const core=result.stackup.layers[1];assert.equal(core.thicknessMm,1.53);assert.equal(core.thicknessLocked,true);assert.equal(core.material,'FR4');assert.equal(core.epsilonR,4.5);assert.equal(core.lossTangent,0.02);
 const source=core.sourcePath.split('/').slice(1).reduce((v,key)=>v[key],result.tree);assert.equal(source[0],'layer');
 assert.equal(result.stackup.copperFinish,'ENIG');assert.equal(result.stackup.edgePlating,'yes');
 assert.equal(result.stackup.castellatedPads,null);
 assert.ok(result.sections.flatMap(s=>s.entries).some(e=>e.value==='fab/'));
 assert.equal(result.sections.flatMap(s=>s.entries).some(e=>e.value==='ignored drawing'),false);
});
test('missing stackup and thickness remain absent rather than defaulted',()=>{
 const result=parse('(kicad_pcb (version 20260101) (setup))',{file:'x.kicad_pcb'});
 assert.equal(result.stackup,null);assert.equal(result.boardThicknessMm,null);assert.match(result.warnings.join(' '),/no saved physical stackup/);
});
test('multiple dielectric thickness values are retained without an inferred total',()=>{
 const result=parse('(kicad_pcb (setup (stackup (layer "dielectric 1" (thickness 0.2) (add_sublayer) (thickness 0.3)))))',{file:'sub.kicad_pcb'});
 assert.equal(result.stackup.layers[0].thicknessMm,null);assert.deepEqual(result.stackup.layers[0].thicknessValuesMm,[0.2,0.3]);assert.match(result.warnings.join(' '),/multiple saved thickness/);
});
test('large geometry is omitted while source indexes and unknown setup fields survive',()=>{
 const geometry='(segment (start 0 0) (end 1 1) (width 0.2) (layer "F.Cu"))'.repeat(12000);
 const result=parse('(kicad_pcb '+geometry+' (setup (future_setting 12)) (future_board_option yes))',{file:'large.kicad_pcb'});
 assert.equal(result.tree[1],null);assert.equal(result.tree[12001][0],'setup');
 assert.ok(result.sections.flatMap(s=>s.entries).some(e=>e.path==='/12001/1/1'&&e.value===12));
 assert.ok(result.sections.flatMap(s=>s.entries).some(e=>e.value==='yes'));assert.match(result.warnings.join(' '),/geometry.*omitted/);
});
test('custom rules keep conditions inert, units and unknown constraints visible',()=>{
 const source=`# unmatched quote " in comment must not alter tokenizer
 (version 1)
 (rule "Power #1" (condition "A.NetClass == 'Power'") (layer outer) (severity warning)
  (constraint clearance (min 0.2mm) (opt 0.3mm)) (constraint future_rule (max 25)))`;
 const result=parse(source,{file:'power.kicad_dru'});
 assert.equal(result.rules[0].name,'Power #1');assert.equal(result.rules[0].condition,"A.NetClass == 'Power'");assert.equal(result.rules[0].constraints[0].type,'clearance');
 assert.ok(result.sections.flatMap(s=>s.entries).some(e=>e.value==='0.2mm'));assert.equal(result.rules[0].constraints[1].type,'future_rule');
 assert.match(result.warnings[0],/not evaluated/);
});
test('selective board parsing matches full AST filtering including escaped strings and unknown forms',()=>{
 const full=require('../design-diff.js').parse;
 const source='(kicad_pcb ; comment (setup bogus)\n (segment (note "escaped \\" (setup fake) ; \\\\")) (setup (future "a\\nb\\q")) (gr_future (x 1)) (future (segment 7)) ("via" (x 2)) (general (thickness 1.2)))';
 const expected=full(source).map((v,i)=>i&&Array.isArray(v)&&(['segment','via'].includes(typeof v[0]==='object'?v[0].quoted:v[0])||String(v[0]).startsWith('gr_'))?null:v);
 assert.deepEqual(JSON.parse(JSON.stringify(parse(source,{file:'x.kicad_pcb'}).tree)),expected);
});
test('omitted board forms still reject malformed strings, structure, numbers and excessive depth',()=>{
 for(const source of ['(kicad_pcb (segment "unterminated))','(kicad_pcb (segment "escape\\','(kicad_pcb (segment 1e999))','(kicad_pcb (segment)) )','(kicad_pcb (segment)']){
  assert.throws(()=>parse(source,{file:'x.kicad_pcb'}));
 }
 assert.throws(()=>parse('(kicad_pcb (segment '+'('.repeat(96)+'x'+')'.repeat(96)+'))',{file:'x.kicad_pcb'}),/too deep/);
 assert.throws(()=>parse('(kicad_pcb (setup '+'('.repeat(65)+'x'+')'.repeat(65)+'))',{file:'x.kicad_pcb'}),/nesting/);
 assert.throws(()=>parse('(kicad_pcb (setup '+'x '.repeat(100001)+'))',{file:'x.kicad_pcb'}),/too many values/);
 const dense=parse('(kicad_pcb (zone (filled_polygon (pts '+'(xy 0 0)'.repeat(1500001)+'))) (setup (future 1)))',{file:'x.kicad_pcb'});
 assert.deepEqual(dense.tree,['kicad_pcb',null,['setup',['future',1]]]);
});
test('board input accepts the PCB parser size cap while other settings retain 8 MiB',()=>{
 const source='(kicad_pcb (segment "'+'x'.repeat(LIMITS.bytes)+'") (setup (future 1)))';
 assert.equal(parse(source,{file:'x.kicad_pcb'}).tree[1],null);
 assert.throws(()=>parse(source,{file:'x.kicad_wks'}),/8 MiB/);
 assert.throws(()=>parse(' '.repeat(64*1024*1024+1),{file:'x.kicad_pcb'}),/64 MiB/);
});
test('worksheet saved elements and library URIs are inert auxiliary data',()=>{
 const worksheet=parse('(kicad_wks (version 20231120) (setup (textsize 1.5 1.5)) (tbtext "${TITLE}" (pos 10 5)))',{file:'draw.kicad_wks'});
 assert.equal(worksheet.kind,'worksheet');assert.ok(worksheet.sections.flatMap(s=>s.entries).some(e=>e.value==='${TITLE}'));
 for(const name of ['fp-lib-table','sym-lib-table']){
  const result=parse(`(${name.replace(/-/g,'_')} (version 7) (lib (name "Local") (type "KiCad") (uri "\${KIPRJMOD}/parts") (options "") (descr "Project libraries")))`,{file:'hw/'+name});
  assert.equal(result.libraries[0].uri,'${KIPRJMOD}/parts');assert.equal(result.libraries[0].name,'Local');assert.match(result.warnings.join(' '),/no external library/);
 }
});
test('type, malformed sources, non-finite numbers and resource bounds reject safely',()=>{
 assert.throws(()=>parse('[]'),/must be an object/);assert.throws(()=>parse('{bad'),SyntaxError);
 assert.throws(()=>parse('{"x":1e999}'),/Non-finite/);
 assert.throws(()=>parse(' '.repeat(LIMITS.bytes+1)),/8 MiB/);
 let deep=0;for(let i=0;i<66;i++)deep={x:deep};assert.throws(()=>parse(JSON.stringify(deep)),/nesting/);
 assert.throws(()=>parse('(kicad_sch)',{file:'x.kicad_pcb'}),/Expected/);
 assert.throws(()=>parse('(page_layout',{file:'x.kicad_wks'}),/Incomplete/);
 assert.throws(()=>parse('{}',{file:'x.txt'}),/Unsupported/);
 assert.throws(()=>parse(JSON.stringify({a:Array(50001).fill(1)})),/leaf values/);
});
