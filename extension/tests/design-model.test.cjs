const test = require("node:test");
const assert = require("node:assert/strict");
const { buildProject, applyVariant, parseVariantConfig } = require("../design-model.js");

const file = (path, content) => ({ path, content });
test("saved component classes and rule area selection retain their native source", () => {
  const board = file("classes.kicad_pcb", '(kicad_pcb (footprint "Fixture:J" (uuid "fp") (at 10 10) (component_classes (class "Drive") (class "Control") (class "Drive"))))');
  const path = "schematic-rule-areas.kicad_sch";
  const fixture = require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", path), "utf8");
  const design = buildProject([board,file(path,fixture)]);
  assert.deepEqual(design.objects.find(item => item.kind === "footprint").savedComponentClasses, ["Control","Drive"]);
  assert.deepEqual(design.objects.find(item => item.kind === "symbol").savedComponentClasses, ["Explicit"]);
  const area = design.objects.find(item => item.kind === "rule_area");
  assert.equal(area.uuid, "7785290c-7d47-47b9-ac4b-d408c6ad807a");
  assert.deepEqual(area.position, {x:50,y:50});
  assert.equal(area.saved.tree[1][0], "polyline");
});
const part = (ref, uuid, unit, extra = "") => `(symbol (lib_id "74xx:7400") (at ${unit * 10} 20)
  (unit ${unit}) (in_bom yes) (on_board yes) (dnp no)
  (property "Reference" "${ref}") (property "Value" "7400")
  (property "Tolerance" "5%") ${extra} (uuid "${uuid}"))`;
const root = file("hardware/root.kicad_sch", `(kicad_sch
  ${part("U1", "unit-a", 1)} ${part("U1", "unit-b", 2)} ${part("R1", "root-r", 1)}
  (sheet (at 40 50) (size 20 10) (property "Sheetname" "Power")
    (property "Sheetfile" "power.kicad_sch") (uuid "sheet-1")))`);
const child = file("hardware/power.kicad_sch", `(kicad_sch ${part("R1", "child-r", 1)})`);
const board = file("hardware/board.kicad_pcb", `(kicad_pcb
  (footprint "Package_QFP:QFP" (at 100 100 90) (attr smd dnp exclude_from_bom)
    (property "Reference" "U1") (property "Value" "7400") (uuid "fp-1")
    (pad "1" smd rect (at 2 3) (size 1 2) (uuid "pad-1")))
  (segment (start 1 2) (end 3 4) (layer "F.Cu") (uuid "track-1"))
  (via (at 5 6) (uuid "via-1"))
  (zone (polygon (pts (xy 7 8) (xy 8 9))) (uuid "zone-1")))`);

test("builds schematic hierarchy and placed PCB object records with native flags", () => {
  const model = buildProject([root, child, board]);
  assert.deepEqual(model.variants, [{ id: "default", name: "Saved design" }]);
  assert.deepEqual(model.sheets.map((sheet) => [sheet.path, sheet.label, sheet.kind]), [
    ["hardware/root.kicad_sch", "root.kicad_sch", "schematic"],
    ["hardware/power.kicad_sch", "Power", "schematic"],
    ["hardware/board.kicad_pcb", "board.kicad_pcb", "board"],
  ]);
  assert.equal(model.objects.filter((item) => item.kind === "symbol" && item.reference === "U1").length, 2);
  const unit = model.objects.find((item) => item.uuid === "unit-b");
  assert.equal(unit.properties.Unit, "2");
  assert.equal(unit.properties.Tolerance, "5%");
  assert.equal(unit.properties.DNP, "No");
  const footprint = model.objects.find((item) => item.kind === "footprint");
  const pad = model.objects.find((item) => item.kind === "pad");
  assert.equal(footprint.populated, false);
  assert.equal(footprint.excludeFromBom, true);
  assert.equal(footprint.properties["Exclude from BOM"], "Yes");
  assert.equal(pad.parentId, footprint.id);
  assert.equal(pad.reference, "U1");
  assert.equal(pad.populated, false);
  assert.deepEqual(pad.position, { x: 103, y: 98 });
  assert.deepEqual(model.objects.filter((item) => ["segment", "via", "zone"].includes(item.kind))
    .map((item) => item.kind), ["segment", "via", "zone"]);
});

test("JSON overlay applies to every multiunit instance in one file and never mutates saved state", () => {
  const config = { schemaVersion: 1, variants: [{ id: "no-logic", name: "No logic", parts: [
    { path: "hardware/root.kicad_sch", reference: "U1", populated: false,
      properties: { Value: "Not installed", Tolerance: "1%" } },
    { path: "hardware/board.kicad_pcb", uuid: "fp-1", populated: true },
  ] }] };
  const model = buildProject([root, child, board], config);
  const selected = applyVariant(model, "no-logic");
  const units = selected.filter((item) => item.kind === "symbol" && item.reference === "U1");
  assert.equal(units.length, 2);
  assert.ok(units.every((item) => item.populated === false && item.properties.DNP === "Yes" &&
    item.properties.Value === "Not installed" && item.properties.Tolerance === "1%"));
  const fp = selected.find((item) => item.uuid === "fp-1");
  const pad = selected.find((item) => item.uuid === "pad-1");
  assert.equal(fp.populated, true);
  assert.equal(pad.populated, true);
  assert.equal(model.objects.find((item) => item.uuid === "unit-a").properties.Value, "7400");
  assert.equal(model.objects.find((item) => item.uuid === "fp-1").populated, false);
  assert.deepEqual(applyVariant(model, "default"), model.objects);
});

test("CSV accepts quoted commas and newlines, scoped references, DNP and custom BOM columns", () => {
  const csv = `Variant,Reference,File/Path,DNP,Value,Comment\r\n"Low, power","U1 R1",hardware/root.kicad_sch,yes,"Alt, 74HC","first line\nsecond line"\r\n`;
  const config = parseVariantConfig(csv, "assembly.csv");
  assert.equal(config.variants[0].name, "Low, power");
  assert.equal(config.variants[0].parts.length, 2);
  const model = buildProject([root, child], config);
  assert.deepEqual(model.warnings, []);
  const units = applyVariant(model, config.variants[0].id).filter((item) => item.kind === "symbol" && item.reference === "U1");
  assert.equal(units.length, 2);
  assert.ok(units.every((item) => item.populated === false && item.properties.Value === "Alt, 74HC" &&
    item.properties.Comment === "first line\nsecond line"));
});

test("unscoped duplicate refs and reference ranges are reported and skipped", () => {
  const config = parseVariantConfig(`Variant,Reference,Populated\nPrototype,R1,no\nPrototype,R1-R4,no\n`, "variants.csv");
  const model = buildProject([root, child], config);
  assert.equal(model.warnings.length, 2);
  assert.match(model.warnings[0], /multiple files/);
  assert.match(model.warnings[1], /not found/);
  assert.equal(applyVariant(model, "prototype").filter((item) => item.kind === "symbol" && item.reference === "R1")
    .every((item) => item.populated), true);
});

test("CSV reference without a path resolves to one file and all its units", () => {
  const config = parseVariantConfig("Variant,Reference,Populated\nPrototype,U1,no\n", "assembly.csv");
  const model = buildProject([root, child], config);
  assert.deepEqual(model.warnings, []);
  const units = applyVariant(model, "prototype").filter((item) => item.kind === "symbol" && item.reference === "U1");
  assert.equal(units.length, 2);
  assert.ok(units.every((item) => item.populated === false));
});

test("saved schematic DNP and output-exclusion flags remain the base state", () => {
  const source = file("root.kicad_sch", `(kicad_sch
    (symbol (lib_id "Device:R") (at 1 2) (unit 1) (dnp yes) (in_bom no) (on_board no)
      (property "Reference" "R2") (uuid "r2")))`);
  const item = buildProject([source]).objects.find((record) => record.uuid === "r2");
  assert.equal(item.populated, false);
  assert.equal(item.excludeFromBom, true);
  assert.equal(item.properties.DNP, "Yes");
  assert.equal(item.properties["Exclude from BOM"], "Yes");
  assert.equal(item.properties["Exclude from board"], "Yes");
});

test("unsafe paths, ambiguous same-unit refs, hostile properties and unsupported config fail safely", () => {
  assert.throws(() => buildProject([file("../root.kicad_sch", "(kicad_sch)")]), /unsafe/);
  assert.throws(() => buildProject([root], { schemaVersion: 1, variants: [{ id: "bad", name: "Bad", parts: [
    { path: "../root.kicad_sch", reference: "U1", populated: false }] }] }), /safe file path/);
  assert.throws(() => parseVariantConfig(`{"schemaVersion":1,"variants":[{"id":"bad","name":"Bad","parts":[{"path":"hardware/root.kicad_sch","reference":"U1","properties":{"__proto__":"x"}}]}]}`, "variants.json"), /Invalid variant property/);
  assert.throws(() => parseVariantConfig("Variant,Reference\nA,\"unclosed", "variants.csv"), /Unterminated/);
  assert.throws(() => parseVariantConfig("x", "variants.txt"), /\.json or \.csv/);
  assert.throws(() => parseVariantConfig("x".repeat(1024 * 1024 + 1), "variants.csv"), /under 1 MiB/);
  assert.throws(() => buildProject([root], { schemaVersion: 1, variants: [{ id: "bad", name: "Bad", parts: [
    { path: "hardware/root.kicad_sch", reference: "U1", properties: { Reference: "U2" } }] }] }),
  /Invalid variant property/);
  assert.throws(() => buildProject([root], { schemaVersion: 1, variants: [{ id: "bad", name: "Bad", parts: [
    { path: "hardware/root.kicad_sch", reference: "U1", population: false }] }] }),
  /unsupported fields/);
  const duplicate = file("root.kicad_sch", `(kicad_sch ${part("U1", "one", 1)} ${part("U1", "two", 1)})`);
  const model = buildProject([duplicate], { schemaVersion: 1, variants: [{ id: "v", name: "V", parts: [
    { path: "root.kicad_sch", reference: "U1", populated: false }] }] });
  assert.match(model.warnings[0], /without distinct units/);
  assert.ok(applyVariant(model, "v").filter((item) => item.reference === "U1").every((item) => item.populated));
});

test("saved native variant nodes are reported as unsupported overlay input", () => {
  const source = file("root.kicad_sch", `(kicad_sch ${part("U1", "one", 1,
    `(instances (project "A" (path "/root" (variant (name "Assembly B") (dnp yes)))))`)})`);
  const model = buildProject([source]);
  assert.match(model.warnings[0], /native KiCad variant data/);
  assert.equal(model.objects.find((item) => item.reference === "U1").populated, true);
});

test("saved settings preserve empty and hostile property names, part attributes and selected library pins", () => {
  const source = file("gate.kicad_sch", `(kicad_sch
    (lib_symbols (symbol "Demo:Gate" (property "Description" "")
      (symbol "Gate_0_1" (pin input line (at 0 0 0) (name "VCC") (number "14")))
      (symbol "Gate_1_1" (pin input line (at 1 0 0) (name "A") (number "1")))
      (symbol "Gate_2_1" (pin output line (at 2 0 0) (name "Y") (number "3")))))
    (symbol (lib_id "Demo:Gate") (at 10 20 90) (unit 2) (dnp no)
      (property "Reference" "U1") (property "Empty" "")
      (property "__proto__" "saved, not executable") (property "Empty" "second")
      (uuid "gate-2")))`);
  const record = buildProject([source]).objects.find((item) => item.uuid === "gate-2");
  assert.equal(record.saved.format, "kicad-sexpr");
  assert.equal(record.saved.truncated, false);
  assert.deepEqual(record.saved.properties.filter((field) => field.name === "Empty").map((field) => field.value), ["", "second"]);
  assert.equal(record.saved.properties.find((field) => field.name === "__proto__").value, "saved, not executable");
  assert.equal(Object.getPrototypeOf(record.saved), Object.prototype);
  assert.equal(record.saved.library.id, "Demo:Gate");
  assert.equal(record.saved.library.unit, 2);
  const library = JSON.stringify(record.saved.library.tree);
  assert.match(library, /Gate_0_1/);
  assert.match(library, /Gate_2_1/);
  assert.doesNotMatch(library, /Gate_1_1/);
  assert.match(library, /"VCC"/);
  assert.match(library, /"Y"/);
  assert.equal(record.properties.DNP, "No");
});

test("saved footprint tree includes pads, models, attributes and leaves overlay state separate", () => {
  const source = file("board.kicad_pcb", `(kicad_pcb
    (footprint "Demo:QFP" (at 10 20) (attr smd dnp)
      (property "Reference" "U1") (property "Value" "MCU") (property "Mfr" "")
      (pad "1" smd custom (at 1 2) (size 1 1) (layers "F.Cu")
        (options (anchor rect)) (primitives (gr_poly (pts (xy 0 0) (xy 1 0) (xy 0 1)) (fill yes))) (uuid "pad"))
      (model "board.step" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)))
      (uuid "footprint")))`);
  const config = { schemaVersion:1, variants:[{ id:"assembled", name:"Assembled", parts:[
    { path:"board.kicad_pcb", uuid:"footprint", populated:true, properties:{ Value:"Alt MCU" } }
  ] }] };
  const model = buildProject([source], config);
  const original = model.objects.find((item) => item.uuid === "footprint");
  const effective = applyVariant(model, "assembled").find((item) => item.uuid === "footprint");
  const tree = JSON.stringify(original.saved.tree);
  assert.match(tree, /"attr"/);
  assert.match(tree, /"primitives"/);
  assert.match(tree, /"board.step"/);
  assert.equal(original.saved.properties.find((field) => field.name === "Mfr").value, "");
  assert.equal(original.properties.Value, "MCU");
  assert.equal(effective.properties.Value, "Alt MCU");
  assert.equal(effective.saved, original.saved);
  assert.equal(Object.isFrozen(original.saved), true);
  assert.equal(Object.isFrozen(original.saved.tree), true);
});

test("oversized saved property is marked omitted instead of exposing an unbounded copy", () => {
  const oversized = "x".repeat(600000);
  const source = file("large.kicad_sch", `(kicad_sch
    (symbol (lib_id "Device:R") (at 1 2) (property "Reference" "R1")
      (property "Blob" "${oversized}") (uuid "large")))`);
  const record = buildProject([source]).objects.find((item) => item.uuid === "large");
  assert.equal(record.saved.truncated, true);
  const field = record.saved.properties.find((item) => item.name === "Blob");
  assert.equal(field.value, null);
  assert.equal(field.valueLength, oversized.length);
  assert.equal(field.truncated, true);
  assert.ok(JSON.stringify(record.saved).length < 10000);
});

test("repeated placed units share one immutable embedded library snapshot", () => {
  const source = file("repeat.kicad_sch", `(kicad_sch
    (lib_symbols (symbol "Demo:R" (property "Value" "R")
      (symbol "R_1_1" (pin passive line (name "A") (number "1")))))
    (symbol (lib_id "Demo:R") (unit 1) (at 1 2) (property "Reference" "R1") (uuid "r1"))
    (symbol (lib_id "Demo:R") (unit 1) (at 3 4) (property "Reference" "R2") (uuid "r2")))`);
  const parts = buildProject([source]).objects.filter((item) => item.kind === "symbol");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].saved.library, parts[1].saved.library);
  assert.equal(Object.isFrozen(parts[0].saved.library.tree), true);
});


test('KiCad 6 footprint reference/value fields drive parts, BOM and search despite sheet metadata',()=>{
 const source='(kicad_pcb (footprint "CERN:CAPC" (layer "F.Cu") (at 10 20) (tstamp "legacy") (property "Sheetname" "Power") (fp_text reference "C43") (fp_text value "100nF")))';
 const model=buildProject([file('board.kicad_pcb',source)]),part=model.objects.find(x=>x.kind==='footprint');
 assert.equal(part.reference,'C43');assert.equal(part.label,'C43');assert.equal(part.properties.Value,'100nF');assert.equal(part.properties.Sheetname,'Power');
 const modern=buildProject([file('board.kicad_pcb',source.replace('(property "Sheetname" "Power")','(property "Reference" "C99") (property "Value" "1uF")'))]).objects.find(x=>x.kind==='footprint');assert.equal(modern.reference,'C99');assert.equal(modern.properties.Value,'1uF');
});

test("explicit DNI and DNP fields classify omitted parts without inferring from values or BoM exclusion",()=>{
 const footprint=(ref,props,attr='')=>`(footprint "R" (at 10 20) (uuid "${ref}") (property "Reference" "${ref}") ${props} (attr smd ${attr}) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid "pad-${ref}")))`;
 const model=buildProject([file('board.kicad_pcb',`(kicad_pcb ${footprint('R1','(property "DNI" "Yes")')}${footprint('R2','(property "DNP" "true")')}${footprint('R3','(property "DNI" "No") (property "Value" "DNP")','exclude_from_bom')}${footprint('R4','(property "dni" "TBD")')})`)],{schemaVersion:1,variants:[{id:'fitted',name:'Fitted',parts:[{path:'board.kicad_pcb',reference:'R1',populated:true}]}]});
 const parts=model.objects.filter(o=>o.kind==='footprint');assert.deepEqual(parts.map(o=>[o.populated,o.populationReason]),[[false,'DNI'],[false,'DNP'],[true,null],[true,null]]);
 assert.equal(model.objects.find(o=>o.uuid==='pad-R1').populationReason,'DNI');
 const fitted=applyVariant(model,'fitted');assert.equal(fitted.find(o=>o.uuid==='R1').populated,true);assert.equal(fitted.find(o=>o.uuid==='pad-R1').populationReason,null);assert.equal(model.objects.find(o=>o.uuid==='R1').populated,false);
});
