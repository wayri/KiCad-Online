const test = require("node:test");
const assert = require("node:assert/strict");
const { compareProjects } = require("../design-diff.js");

const file = (path, content) => ({ path, content });
const symbol = (value, x = 10, uuid = "symbol-1") =>
  `(symbol (lib_id "Device:R") (at ${x} 20 90) (property "Reference" "R1") (property "Value" "${value}") (uuid "${uuid}"))`;
const schematic = (...forms) => `(kicad_sch ${forms.join(" ")})`;

test("formatting and numeric spelling do not create changes", () => {
  const base = file("main.kicad_sch", schematic(symbol("1k", 10)));
  const head = file("main.kicad_sch", `(kicad_sch\n  (symbol\n    (lib_id "Device:R")\n    (at 10.0 20.00 90)\n    (property "Reference" "R1")\n    (property "Value" "1k")\n    (uuid "symbol-1")))`);
  assert.deepEqual(compareProjects([base], [head]), { changes: [], counts: { added: 0, removed: 0, modified: 0 } });
});

test("saved property edit and move are one modified object with metadata", () => {
  const result = compareProjects(
    [file("main.kicad_sch", schematic(symbol("1k", 10)))],
    [file("main.kicad_sch", schematic(symbol("2k", 15)))]);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 1 });
  assert.equal(result.changes[0].id, "main.kicad_sch/symbol:uuid:symbol-1");
  assert.equal(result.changes[0].before.properties.Value, "1k");
  assert.equal(result.changes[0].after.properties.Value, "2k");
  assert.equal(result.changes[0].after.properties.Angle, "90");
  assert.notEqual(result.changes[0].before.properties["Source fingerprint"],
    result.changes[0].after.properties["Source fingerprint"]);
  assert.deepEqual(result.changes[0].before.position, { x: 10, y: 20 });
  assert.deepEqual(result.changes[0].after.position, { x: 15, y: 20 });
});

test("added and removed placed objects are reported; library definitions are ignored", () => {
  const base = file("main.kicad_sch", schematic(
    `(lib_symbols ${symbol("unplaced", 1, "library")})`,
    `(wire (pts (xy 1 2) (xy 3 4)) (uuid "old-wire"))`));
  const head = file("main.kicad_sch", schematic(
    `(lib_symbols ${symbol("changed library", 4, "library")})`,
    `(junction (at 5 6) (uuid "new-junction"))`));
  const result = compareProjects([base], [head]);
  assert.deepEqual(result.counts, { added: 1, removed: 1, modified: 0 });
  assert.deepEqual(result.changes.map((change) => change.kind).sort(), ["junction", "wire"]);
});

test("used embedded symbol geometry changes its placed instance, unused geometry does not", () => {
  const source = (usedEnd, unusedEnd) => file("main.kicad_sch", schematic(
    `(lib_symbols
      (symbol "Device:R" (polyline (pts (xy 0 0) (xy ${usedEnd} 0))))
      (symbol "Unused:Shape" (polyline (pts (xy 0 0) (xy ${unusedEnd} 0)))))`,
    symbol("1k", 10, "placed-r")));
  const used = compareProjects([source(1, 1)], [source(2, 1)]);
  assert.deepEqual(used.counts, { added: 0, removed: 0, modified: 1 });
  assert.equal(used.changes[0].kind, "symbol");
  assert.notEqual(used.changes[0].before.properties["Source fingerprint"],
    used.changes[0].after.properties["Source fingerprint"]);
  assert.deepEqual(compareProjects([source(1, 1)], [source(1, 2)]).counts,
    { added: 0, removed: 0, modified: 0 });
});

test("file path scopes duplicate reference and UUID values in child sheets", () => {
  const base = [file("root.kicad_sch", schematic(symbol("1k", 10, "reused"))),
    file("child.kicad_sch", schematic(symbol("1k", 10, "reused")))];
  const head = [file("root.kicad_sch", schematic(symbol("1k", 10, "reused"))),
    file("child.kicad_sch", schematic(symbol("2k", 10, "reused")))];
  const result = compareProjects(base, head);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 1 });
  assert.equal(result.changes[0].path, "child.kicad_sch");
});

test("PCB footprint move updates parent and pad world position", () => {
  const board = (x) => file("board.kicad_pcb", `(kicad_pcb
    (setup (pcbplotparams (layerselection 0x0)))
    (footprint "Package_QFP:QFP" (at ${x} 100 90) (layer "F.Cu")
      (property "Reference" "U1") (uuid "fp-1")
      (pad "1" smd rect (at 2 3) (size 1 2) (layers "F.Cu" "F.Mask") (uuid "pad-1"))))`);
  const result = compareProjects([board(100)], [board(110)]);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 2 });
  const pad = result.changes.find((change) => change.kind === "pad");
  assert.equal(pad.label, "U1 pad 1");
  assert.deepEqual(pad.before.position, { x: 103, y: 98 });
  assert.deepEqual(pad.after.position, { x: 113, y: 98 });
  assert.match(pad.id, /footprint:uuid:fp-1\/pad:uuid:pad-1/);
});

test("pad UUID is scoped by its footprint and generated zone fill is ignored", () => {
  const board = (secondSize, fillX) => file("board.kicad_pcb", `(kicad_pcb
    (footprint "Pkg" (at 10 10) (property "Reference" "U1") (uuid "fp-1")
      (pad "1" smd rect (at 1 1) (size 1 1) (uuid "shared-pad")))
    (footprint "Pkg" (at 20 20) (property "Reference" "U2") (uuid "fp-2")
      (pad "1" smd rect (at 1 1) (size ${secondSize} 1) (uuid "shared-pad")))
    (zone (polygon (pts (xy 1 2) (xy 3 4)))
      (filled_polygon (pts (xy ${fillX} 2) (xy 3 4))) (uuid "zone-1")))`);
  const result = compareProjects([board(1, 1)], [board(2, 50)]);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 2 });
  assert.equal(result.changes.some((change) => change.kind === "zone"), false);
  assert.equal(result.changes.filter((change) => change.kind === "pad").length, 1);
  assert.match(result.changes.find((change) => change.kind === "pad").id, /fp-2/);
});

test("pad with a footprint lacking placement has no world position and does not throw", () => {
  const board = (width) => file("board.kicad_pcb", `(kicad_pcb
    (footprint "Pkg" (uuid "fp") (pad "1" smd rect (at 1 2) (size ${width} 1) (uuid "pad"))))`);
  const result = compareProjects([board(1)], [board(2)]);
  assert.equal(result.changes.find((change) => change.kind === "pad").after.position, null);
  assert.deepEqual(result.counts, { added: 0, removed: 0, modified: 2 });
});

test("quoted escapes are decoded and hostile property names stay ordinary data", () => {
  const source = file("main.kicad_sch", schematic(
    `(label "Say \\\"Hi\\\"" (at 1 2) (property "__proto__" "stored") (uuid "label-1"))`));
  const result = compareProjects([], [source]);
  assert.equal(result.changes[0].label, 'Say "Hi"');
  assert.equal(Object.hasOwn(result.changes[0].after.properties, "__proto__"), true);
  assert.equal({}.stored, undefined);
});

test("fallback identity does not guess a move when an object has no UUID", () => {
  const before = file("main.kicad_sch", schematic(`(wire (pts (xy 1 2) (xy 3 4)))`));
  const after = file("main.kicad_sch", schematic(`(wire (pts (xy 2 2) (xy 3 4)))`));
  assert.deepEqual(compareProjects([before], [after]).counts, { added: 1, removed: 1, modified: 0 });
});

test("malformed, oversized and overly deep source is rejected", () => {
  assert.throws(() => compareProjects([file("a.kicad_sch", `(kicad_sch (label "unterminated))`)], []), /Unterminated/);
  assert.throws(() => compareProjects([file("a.kicad_sch", `(${"(".repeat(100)}${")".repeat(101)}`)], []), /too deep/);
  assert.throws(() => compareProjects([file("a.sch", "x".repeat(8 * 1024 * 1024 + 1))], []), /size limits/);
  assert.throws(() => compareProjects([file("a.kicad_sch", "(kicad_sch)") , file("a.kicad_sch", "(kicad_sch)")], []), /duplicate/);
});


test('modern drawing node budgets support dense designs while retaining non-drawing protection', () => {
  const {parse} = require('../design-diff.js');
  const many = 'x '.repeat(1000001);
  assert.equal(parse('(kicad_pcb ' + many + ')').length, 1000002);
  assert.equal(parse('(kicad_sch ' + many + ')').length,1000002);
  assert.throws(() => parse('(unknown ' + many + ')'), /too many/);
});


test('parser fast whitespace path preserves Unicode, escapes, comments and delimiter grammar',()=>{
 const {parse}=require('../design-diff.js');
 const expected=parse('(kicad_sch (value "line\\nquote\\\\") ; comment\n (at -1.25 2e3))');
 for(const whitespace of [' ', '\t', '\r\n', '\v', '\f', '\u00a0', '\u2028', '\u2029', '\ufeff']){
  assert.deepEqual(parse('(kicad_sch'+whitespace+'(value "line\\nquote\\\\") ; comment\n'+whitespace+'(at -1.25 2e3))'),expected);
 }
 assert.throws(()=>parse('(kicad_sch (value "unterminated))'),/Unterminated/);
 assert.throws(()=>parse('(kicad_sch ))'),/parenthesis/);
});
