const test = require('node:test');
const assert = require('node:assert/strict');
const comparison = require('../unified-comparison.js');

const file = (path, content) => ({ path, content });
const board = (x, y, angle, value = '1k', model = 'old.step') =>
  `(kicad_pcb (version 20240108) (generator "test")
    (footprint "R" (layer "F.Cu") (at ${x} ${y} ${angle}) (uuid "one")
      (property "Reference" "R1") (property "Value" "${value}")
      (model "${model}" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))))`;
const schematic = value => `(kicad_sch (version 20231120) (generator "test")
  (symbol (lib_id "Device:R") (at 10 20 0) (uuid "one")
    (property "Reference" "R1") (property "Value" "${value}")))`;

test('BoM comparison expands references, ignores row order and import UUIDs', () => {
  const a = 'References,Value,Footprint,MPN,Qty\n"R1, R2",1k,0603,A,2\nC1,10u,0805,B,1\n';
  const b = 'References,Value,Footprint,MPN,Qty\nC1,10u,0805,B,1\nR2,1k,0603,A,1\nR1,1k,0603,A,1\n';
  const result = comparison.compare([file('before.csv', a)], [file('after.csv', b)]);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 0 });
  assert.equal(result.files[0].basePath, 'before.csv');
  assert.equal(result.files[0].headPath, 'after.csv');
});

test('BoM reports custom, MPN, population and add/remove changes per reference', () => {
  const a = 'Reference,Value,Footprint,MPN,Custom,DNP,Qty\nR1,1k,0603,A,old,no,1\nC1,10u,0805,B,,no,1\n';
  const b = 'Reference,Value,Footprint,MPN,Custom,DNP,Qty\nR1,2k,0402,C,new,yes,1\nU1,IC,QFN,D,,no,1\n';
  const result = comparison.compare([file('bom.csv', a)], [file('bom.csv', b)]);
  assert.deepEqual(result.counts, { added: 1, removed: 1, modified: 1 });
  const r1 = result.entries.find(entry => entry.label === 'R1');
  assert.equal(r1.before.properties.MPN, 'A');
  assert.equal(r1.after.properties.MPN, 'C');
  assert.equal(r1.after.populated, false);
  assert.ok(r1.fields.some(field => field.name === 'Populated'));
  assert.ok(r1.fields.some(field => field.name === 'Custom'));
});

test('BoM rejects ambiguous, duplicate and hostile input', () => {
  assert.throws(() => comparison.compare([file('a.csv', 'Reference,Qty\nR1,2\n')], []), /Quantity/);
  assert.throws(() => comparison.compare([file('a.csv', 'Reference\nR1\nR1\n')], []), /more than one BoM row/);
  assert.throws(() => comparison.compare([file('a.csv', 'Reference,Value\nR1,"x"y\n')], []), /CSV/);
  assert.throws(() => comparison.compare([file('../bad.csv', 'Reference\nR1')], []), /Invalid or duplicate/);
  assert.throws(() => comparison.compare([file('a.exe', 'x')], []), /Unsupported/);
});

test('BoM identities stay file scoped and missing fields are visible', () => {
  const base = [file('a.csv', 'Reference,Value,MPN\nR1,1k,A\n'),
    file('b.csv', 'Reference,Value\nR1,2k\n')];
  const head = [file('a.csv', 'Reference,Value\nR1,1k\n'),
    file('b.csv', 'Reference,Value\nR1,2k\n')];
  const result = comparison.compare(base, head);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 1 });
  assert.equal(result.entries[0].path, 'a.csv');
  assert.deepEqual(result.entries[0].fields.find(field => field.name === 'MPN'),
    { name: 'MPN', before: 'A', after: null });
});

test('design changes report saved position, rotation, properties and 3D model references', () => {
  const result = comparison.compare([file('old.kicad_pcb', board(10, 20, 90))],
    [file('new.kicad_pcb', board(13, 24, 180, '2k', 'new.step'))]);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 1 });
  const entry = result.entries[0];
  assert.equal(entry.domain, 'layout');
  assert.equal(entry.before.uuid, 'one');
  assert.deepEqual(entry.beforePosition, { x: 10, y: 20 });
  assert.deepEqual(entry.afterPosition, { x: 13, y: 24 });
  assert.equal(entry.delta.distanceMm, 5);
  assert.equal(entry.delta.rotationDeg, 90);
  assert.equal(entry.before.models[0].path, 'old.step');
  assert.equal(entry.after.models[0].path, 'new.step');
  assert.ok(entry.fields.some(field => field.name === '3D models'));
});

test('rotation delta follows the short angular displacement', () => {
  const entry = comparison.compare([file('a.kicad_pcb', board(1, 2, 350))],
    [file('a.kicad_pcb', board(1, 2, 10))]).entries[0];
  assert.equal(entry.delta.rotationDeg, 20);
  assert.equal(entry.delta.distanceMm, 0);
});

test('schematic comparison uses scoped identity and ignores unchanged sources', () => {
  assert.equal(comparison.compare([file('a.kicad_sch', schematic('1k'))],
    [file('a.kicad_sch', schematic('1k'))]).entries.length, 0);
  const base = [file('one.kicad_sch', schematic('1k')), file('two.kicad_sch', schematic('1k'))];
  const head = [file('one.kicad_sch', schematic('2k')), file('two.kicad_sch', schematic('1k'))];
  const result = comparison.compare(base, head);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 1 });
  assert.equal(result.entries[0].path, 'one.kicad_sch');
  assert.equal(result.entries[0].before.properties.Value, '1k');
  const bothChanged = comparison.compare(base, [file('one.kicad_sch', schematic('2k')),
    file('two.kicad_sch', schematic('3k'))]);
  assert.equal(new Set(bothChanged.entries.map(entry => entry.id)).size, 2);
});

test('explicit renamed paths map one pair and reject missing or incompatible paths', () => {
  const a = file('dir/a.kicad_pcb', board(1, 2, 0));
  const b = file('dir/b.kicad_pcb', board(1, 2, 0));
  assert.equal(comparison.compare([a], [b], { pairs: [{ basePath: a.path, headPath: b.path }] }).entries.length, 0);
  assert.throws(() => comparison.compare([a], [b], { pairs: [{ basePath: 'missing', headPath: b.path }] }), /missing/);
  assert.throws(() => comparison.compare([a], [file('b.txt', 'x')], { pairs: [{ basePath: a.path, headPath: 'b.txt' }] }), /incompatible/);
});

test('text diff includes line numbers, avoids execution and bounds expensive diffs', () => {
  const before = 'a\n<script>alert(1)</script>\nz';
  const after = 'a\nchanged\nz';
  const diff = comparison.diffText(before, after);
  assert.deepEqual(diff.rows.map(row => row.status), ['equal', 'removed', 'added', 'equal']);
  assert.equal(diff.rows[1].text, '<script>alert(1)</script>');
  assert.equal(diff.rows[1].beforeLine, 2);
  const result = comparison.compare([file('readme.txt', before)], [file('readme.txt', after)]);
  assert.deepEqual(result.counts, { added: 1, removed: 1, modified: 0 });
  const big = Array.from({ length: 400 }, (_, i) => `left ${i}`).join('\n');
  const other = Array.from({ length: 400 }, (_, i) => `right ${i}`).join('\n');
  const bounded = comparison.diffText(big, other);
  assert.equal(bounded.warnings.length, 1);
  assert.ok(bounded.rows.length <= 800);
  assert.throws(() => comparison.diffText('x'.repeat(1024 * 1024 + 1), ''), /size limit/);
});

test('saved rule and legacy library text does not prevent folder comparison',()=>{for(const path of ['board.kicad_dru','board.lib']){const r=comparison.compare([file(path,'old')],[file(path,'new')]);assert.ok(r.entries.length);assert.equal(r.files[0].domain,'text');}});
