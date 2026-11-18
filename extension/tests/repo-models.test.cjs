const test = require('node:test');
const assert = require('node:assert/strict');
require('../design-diff.js');
const { collect, resolveModelPath, modelPose } = require('../repo-models.js');

const board = `(kicad_pcb
  (footprint "Demo:Part" (layer "F.Cu") (at 100 80 90) (uuid "part-a")
    (property "Reference" "R1")
    (model "models/body.wrl" (offset (xyz 1 2 3)) (scale (xyz 1.5 2 1)) (rotate (xyz 10 20 30)))
    (model "${'${KIPRJMOD}'}/models/cap.glb" (offset (xyz 0 0 0)))
    (model "models/case.step"))
  (footprint "Demo:Back" (layer "B.Cu") (at 150 85 180) (uuid "part-b")
    (property "Reference" "U2")
    (model "../shared/back.vrml" (scale (xyz 1 1 1))))
)`;

test('3D inventory retains model placement and shared embedded data without drawing geometry', () => {
  const { modelSource, collectParsed } = require('../repo-models.js');
  const source = `(kicad_pcb (zone (filled_polygon (pts (xy 1 2))))
    (footprint "A" (pad "1")) (footprint "B" (at 3 4) (pad "2")
    (embedded_files (file (name "a.wrl") (data "|AAAA|")))
    (model "kicad-embed://a.wrl") (model "kicad-embed://a.wrl")))`;
  const projected = modelSource(globalThis.KiCadDesignDiff.parse(source));
  assert.doesNotMatch(JSON.stringify(projected), /"zone"|"pad"|"filled_polygon"/);
  const inventory = collectParsed(projected, 'board.kicad_pcb');
  assert.deepEqual(inventory, collect(source, 'board.kicad_pcb'));
  assert.equal(inventory.models[0].reference, 'REF2');
  assert.strictEqual(inventory.models[0].embeddedAsset, inventory.models[1].embeddedAsset);
});

test('resolves only same-repository model references', () => {
  assert.equal(resolveModelPath('hardware/board.kicad_pcb', 'models/a.wrl'), 'hardware/models/a.wrl');
  assert.equal(resolveModelPath('hardware/board.kicad_pcb', '../shared/a.wrl'), 'shared/a.wrl');
  assert.equal(resolveModelPath('hardware/board.kicad_pcb', '${KIPRJMOD}/models/a.wrl'), 'hardware/models/a.wrl');
  assert.equal(resolveModelPath('hardware/board.kicad_pcb', 'models\\body.wrl'), 'hardware/models/body.wrl');
  assert.equal(resolveModelPath('hardware/board.kicad_pcb', '${KIPRJMOD}\\packages3D\\body.wrl'), 'hardware/packages3D/body.wrl');
  for (const path of ['../../escape.wrl', '/absolute.wrl', 'C:/absolute.wrl', 'https://host/model.wrl',
    '${KICAD8_3DMODEL_DIR}/body.wrl', 'model.wrl?other', 'models/%00.wrl', 'C:\\absolute.wrl', '\\\\server\\share\\body.wrl', '..\\..\\escape.wrl']) {
    assert.equal(resolveModelPath('hardware/board.kicad_pcb', path), null, path);
  }
});

test('literal hash model names resolve from saved paths and repository inventory', () => {
  const path='local/part/IC#PBF.STEP';
  assert.equal(resolveModelPath('board.kicad_pcb', '${KIPRJMOD}/'+path),path);
  const source='(kicad_pcb (footprint "Demo" (layer "F.Cu") (at 0 0) (property "Reference" "U1") (model "${KIPRJMOD}/'+path+'")))';
  const result=collect(source,'board.kicad_pcb',undefined,[path]);
  assert.equal(result.models.length,1);assert.equal(result.models[0].path,path);assert.deepEqual(result.diagnostics,[]);
  assert.equal(resolveModelPath('board.kicad_pcb','local/part/IC%23PBF.STEP'),null);
});

test('legacy project prefix resolves within the repository and rejects nested variables', () => {
  assert.equal(resolveModelPath('pcb/board.kicad_pcb', '$(KIPRJMOD)/models/a.step'), 'pcb/models/a.step');
  assert.equal(resolveModelPath('pcb/board.kicad_pcb', '$(KIPRJMOD)/../../a.step'), null);
  assert.equal(resolveModelPath('pcb/board.kicad_pcb', '$(KIPRJMOD)/$(OTHER)/a.step'), null);
});

test('library references prefer a unique case-insensitive format match over alternate formats', () => {
  const source = '(kicad_pcb (footprint "Part" (at 1 2) (model "${KICAD9_3DMODEL_DIR}/Package.3dshapes/body.step")))';
  const step = 'models/Package.3dshapes/body.STEP';
  const wrl = 'models/Package.3dshapes/body.wrl';
  assert.equal(collect(source, 'board.kicad_pcb', undefined, [wrl, step]).models[0].path, step);
  assert.equal(collect(source, 'board.kicad_pcb', undefined, [step, 'other/' + step, wrl]).models.length, 0);
});

test('collects every supported model with per-model transforms and footprint side', () => {
  const { models, diagnostics } = collect(board, 'hardware/board.kicad_pcb');
  assert.equal(models.length, 4);
  assert.deepEqual(models.map(item => item.path), ['hardware/models/body.wrl', 'hardware/models/cap.glb', 'hardware/models/case.step', 'shared/back.vrml']);
  assert.deepEqual(models[0], { path: 'hardware/models/body.wrl', format: 'wrl', footprintId: 'part-a', reference: 'R1',
    footprint: { x: 100, y: 80, angle: 90, layer: 'F.Cu' }, offset: [1, 2, 3], scale: [1.5, 2, 1], rotate: [10, 20, 30] });
  assert.deepEqual(models[3].footprint, { x: 150, y: 85, angle: 180, layer: 'B.Cu' });
  assert.equal(diagnostics.length,0);assert.equal(modelPose(models[2],0,0,1.6).scale[0],1);
});

test('model pose follows KiCad millimetre offsets, footprint rotation, and bottom flip', () => {
  const { models } = collect(board, 'hardware/board.kicad_pcb');
  const front = modelPose(models[0], 100, 80, 1.6);
  assert.ok(Math.abs(front.position[0] + 2) < 1e-10);
  assert.ok(Math.abs(front.position[1] - 1) < 1e-10);
  assert.equal(front.position[2], 3.8);
  assert.equal(front.footprintAngle, Math.PI / 2);
  assert.deepEqual(front.scale, [3.81, 5.08, 2.54]);
  assert.ok(Math.abs(front.modelRotation[0] + 10 * Math.PI / 180) < 1e-10);
  const back = modelPose({ ...models[3], offset: [1, 2, 3], rotate: [10, 20, 30] }, 100, 80, 1.6);
  assert.ok(Math.abs(back.position[0] - 49) < 1e-10);
  assert.ok(Math.abs(back.position[1] - -3) < 1e-10);
  assert.equal(back.position[2], -3.8);
  assert.ok(Math.abs(back.modelRotation[0] - 170 * Math.PI / 180) < 1e-10);
  assert.ok(Math.abs(back.modelRotation[1] - 20 * Math.PI / 180) < 1e-10);
});

test('rejects invalid transforms and hidden models without loading them', () => {
  const source = board.replace('(offset (xyz 1 2 3))', '(offset (xyz 1 bad 3))')
    .replace('(model "${KIPRJMOD}/models/cap.glb" (offset (xyz 0 0 0)))',
      '(model "${KIPRJMOD}/models/cap.glb" (hide yes))');
  const { models, diagnostics } = collect(source, 'hardware/board.kicad_pcb');
  assert.equal(models.length, 2);
  assert.equal(models[1].reference, 'U2');
  assert.ok(diagnostics.some(message => message.includes('transform is invalid')));
});

test('model parsing rejects non-board source and caps model count', () => {
  assert.throws(() => collect('(kicad_sch)', 'board.kicad_pcb'), /saved KiCad PCB/);
  const many = `(kicad_pcb (footprint "Part" (layer "F.Cu") (at 1 2)
    (property "Reference" "U1") ${Array.from({ length: 2049 }, (_, index) => `(model "m/${index}.wrl")`).join(' ')}))`;
  const result = collect(many, 'board.kicad_pcb');
  assert.equal(result.models.length, 2048);
  assert.ok(result.diagnostics.some(message => message.includes('first 2048')));
});

test('legacy reference and missing UUID follow SPIKE parser identity fallback', () => {
  const result = collect('(kicad_pcb (footprint "Legacy" (layer "F.Cu") (at 1 2)'
    + ' (fp_text reference "J2") (model "body.wrl")))', 'board.kicad_pcb');
  assert.equal(result.models[0].reference, 'J2');
  assert.equal(result.models[0].footprintId, 'component-J2');
});

test('library variables resolve only unique files in the imported repository inventory', () => {
  const source = '(kicad_pcb (footprint "Part" (at 1 2) (model "${KICAD9_3DMODEL_DIR}/Package.3dshapes/body.step")))';
  const path = 'models/Package.3dshapes/body.step';
  const result = collect(source, 'pcb/board.kicad_pcb', undefined, [path]);
  assert.equal(result.models[0].path, path);
  assert.equal(collect(source, 'pcb/board.kicad_pcb').models.length, 0);
  const ambiguous = collect(source, 'pcb/board.kicad_pcb', undefined, [path, 'other/Package.3dshapes/body.step']);
  assert.equal(ambiguous.models.length, 0);
  assert.ok(ambiguous.diagnostics.some(message => /multiple repository files/.test(message)));
});

test('legacy library variables and Windows paths resolve only supplied project assets', () => {
  for (const prefix of ['${KISYS3DMOD}', '$(KISYS3DMOD)', '$(KICAD9_3DMODEL_DIR)']) {
    const source = `(kicad_pcb (footprint "Part" (at 1 2) (model "${prefix}/Package.3dshapes/body.step")))`;
    const result = collect(source, 'pcb/board.kicad_pcb', undefined, ['models/Package.3dshapes/body.step']);
    assert.equal(result.models[0].path, 'models/Package.3dshapes/body.step');
    assert.deepEqual(result.diagnostics, []);
    const missing = collect(source, 'pcb/board.kicad_pcb');
    assert.equal(missing.models.length, 0);
    assert.ok(missing.diagnostics.some(message => message.includes('not included in this project')));
  }
});

test('corrects model path casing and resolves a unique same-stem STEP/VRML alternative', () => {
  const source = path => `(kicad_pcb (footprint "Part" (at 1 2) (model "${path}")))`;
  const corrected = collect(source('models/body.step'), 'pcb/board.kicad_pcb', undefined, ['pcb/Models/Body.STEP']);
  assert.equal(corrected.models[0].path, 'pcb/Models/Body.STEP');
  assert.ok(corrected.diagnostics.some(message => message.includes('casing corrected')));
  const alternate = collect(source('models/body.step'), 'pcb/board.kicad_pcb', undefined, ['pcb/models/body.wrl']);
  assert.equal(alternate.models[0].path, 'pcb/models/body.wrl');
  assert.equal(alternate.models[0].format, 'wrl');
  assert.equal(modelPose(alternate.models[0], 0, 0, 1.6).scale[0], 2.54);
  assert.ok(alternate.diagnostics.some(message => message.includes('repository model alternative')));
  const library = collect(source('${KICAD9_3DMODEL_DIR}/Package.3dshapes/body.step'), 'pcb/board.kicad_pcb', undefined, ['models/Package.3dshapes/body.wrl']);
  assert.equal(library.models[0].path, 'models/Package.3dshapes/body.wrl');
});

test('model recovery rejects ambiguous matches, arbitrary variables and unsafe library traversal', () => {
  const source = path => `(kicad_pcb (footprint "Part" (at 1 2) (model "${path}")))`;
  for (const paths of [['pcb/Models/body.step', 'pcb/MODELS/body.step'], ['pcb/models/body.wrl', 'pcb/models/body.stp']]) {
    const result = collect(source('models/body.step'), 'pcb/board.kicad_pcb', undefined, paths);
    assert.equal(result.models.length, 0);
    assert.ok(result.diagnostics.some(message => message.includes('ambiguous')));
  }
  for (const path of ['${KISYS3DMOD}/../body.step', '$(HOME)/body.step', '${KISYS3DMOD}/https://host/body.step']) {
    assert.equal(collect(source(path), 'pcb/board.kicad_pcb', undefined, ['body.step']).models.length, 0);
  }
  // A missing explicit path is retained when inventory is incomplete; no basename guessing.
  const result = collect(source('models/body.step'), 'pcb/board.kicad_pcb', undefined, ['unrelated/body.wrl']);
  assert.equal(result.models[0].path, 'pcb/models/body.step');
});

test('a capped inventory cannot establish unique model recovery', () => {
  const paths = ['models/Package.3dshapes/body.wrl', ...Array.from({length:1999}, (_, i) => `models/other-${i}.wrl`)];
  const source = '(kicad_pcb (footprint "Part" (at 1 2) (model "${KISYS3DMOD}/Package.3dshapes/body.step")))';
  const result = collect(source, 'board.kicad_pcb', undefined, paths);
  assert.equal(result.models.length, 0);
  assert.ok(result.diagnostics.some(message => message.includes('discovery is incomplete')));
});
