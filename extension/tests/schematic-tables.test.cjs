const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../design-diff.js'),{build}=require('../schematic-renderer.js');
// Native KiCad 10 saveTable/saveTextBox grammar:
// https://docs.kicad.org/doxygen/sch__writer__v10_8cpp_source.html
// Exported with installed KiCad 10.0.6 on 2026-11-13: eight border
// endpoints match these world-mm coordinates; F at saved 180 is horizontal,
// F at 270 has SVG rotate(-90). Native plotting clamps border pen width,
// so assertions retain saved widths rather than claiming pixel equivalence.
const cell=(text,x,y,w,h,span='1 1')=>`(table_cell "${text}" (at ${x} ${y} 0) (size ${w} ${h}) (margins 1 1 1 1) (span ${span}) (effects (font (size 1 1) bold) (justify left top)))`;
const table=(cells)=>`(table (column_count 2) (border (external yes) (header yes) (stroke (width .4) (type dash) (color 200 20 30 1))) (separators (rows yes) (cols yes) (stroke (width .2) (type dot))) (column_widths 20 20) (row_heights 10 10) (uuid "11111111-1111-4111-8111-111111111111") (cells ${cells}))`;
const fixture=`(kicad_sch (version 20250114) (generator "eeschema") (uuid "22222222-2222-4222-8222-222222222222") (paper "A4") (lib_symbols) ${table(cell('A',10,10,20,10)+cell('B',30,10,20,10)+cell('C',10,20,20,10)+cell('D',30,20,20,10))}
${[0,90,180,270].map((a,i)=>`(label "F" (at ${70+i*10} 30 ${a}) (effects (font (size 1 1)) (justify left bottom)) (uuid "33333333-3333-4333-8333-33333333333${i}"))`).join('\n')})`;
test('saved tables preserve cell text, header/external borders and independent separator style',()=>{
 const result=build(parse(fixture),'table.kicad_sch'),edges=result.primitives.filter(p=>p.kind==='table-border'),texts=result.primitives.filter(p=>p.kind==='table-cell'&&p.type==='text');
 assert.deepEqual(texts.map(t=>t.text),['A','B','C','D']);assert.ok(texts.every(t=>t.bold&&t.align==='left'));
 assert.equal(edges.length,8);assert.equal(edges.filter(e=>e.width===.4&&e.lineStyle==='dash'&&e.color==='rgba(200,20,30,1)').length,7);
 assert.deepEqual(edges.find(e=>e.width===.2).points,[{x:30,y:20},{x:30,y:30}]);
 assert.ok(result.primitives.filter(p=>p.kind==='table-cell'&&p.type==='polygon').every(p=>p.stroke===false));
});
test('merged cells omit internal dividers and malformed/oversized tables never partially render',()=>{
 const merged=table(cell('Merged',10,10,40,10,'2 1')+cell('',30,10,20,10,'0 0')+cell('C',10,20,20,10)+cell('D',30,20,20,10));
 const render=source=>build(parse(`(kicad_sch ${source})`),'table.kicad_sch');
 const result=render(merged);assert.equal(result.primitives.filter(p=>p.kind==='table-cell'&&p.type==='text').length,3);
 assert.equal(result.primitives.filter(p=>p.kind==='table-border').length,6);
 for(const source of [merged.replace('(column_count 2)','(column_count 1001)'),merged.replace('(span 2 1)','(span 3 1)'),merged.replace('(at 10 10 0)','(at 10 10 90)'),merged.replace('(span 0 0)','(span 1 1)')]){
  const bad=render(source);assert.equal(bad.primitives.some(p=>/^table-/.test(p.kind)),false);assert.ok(bad.warnings.some(w=>/table/i.test(w)));
 }
});
test('local label spin keeps readable text and sheet field angles use saved world orientation',()=>{
 const result=build(parse(fixture),'table.kicad_sch');assert.deepEqual(result.primitives.filter(p=>p.kind==='label'&&p.type==='text').map(p=>p.angle),[-0,-90,-0,-90]);
 const field=build(parse('(kicad_sch (sheet (at 10 10) (size 10 10) (property "Sheetname" "Vertical" (at 8 15 90) (effects (font (size 1 1))))))'),'sheet.kicad_sch').primitives.find(p=>p.kind==='sheet-property');
 assert.equal(field.angle,-90);
});
module.exports={fixture};
