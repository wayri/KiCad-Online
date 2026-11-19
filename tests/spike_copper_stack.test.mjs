import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {sourceCopperPlan} from '../extension/spike/copperStack.mjs';
const {parse} = createRequire(import.meta.url)('../extension/design-diff.js');
const names = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
const board = () => ({layers: [...names], vias: [], stackup: [
  {name: 'F.SilkS', type: 'Top Silk Screen'},
  {name: 'F.Cu', thickness: .04}, {name: 'dielectric 1', type: 'prepreg', thickness: .2},
  {name: 'In1.Cu', thickness: .03}, {name: 'dielectric 2', type: 'core', thickness: 1},
  {name: 'In2.Cu', thickness: .03}, {name: 'dielectric 3', type: 'prepreg', thickness: .4},
  {name: 'B.Cu', thickness: .04}
]});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
function viaPlan(declarations, records) {
  const fixture = board(); fixture.vias = records;
  return sourceCopperPlan(fixture, parse(`(kicad_pcb ${declarations})`), 1.74);
}

test('asymmetric complete saved stackup supplies cumulative copper centers in board order', () => {
  const fixture = board(), original = JSON.stringify(fixture);
  const plan = sourceCopperPlan(fixture, parse('(kicad_pcb)'), 1.74);
  assert.deepEqual(plan.layers.map(layer => layer.name), names);
  [.85, .615, -.415, -.85].forEach((z, index) => close(plan.layers[index].z, z));
  assert.deepEqual(plan.layers.map(layer => layer.thickness), [.04, .03, .03, .04]);
  assert.equal(plan.byLayer.get('In1.Cu'), plan.layers[1]);
  assert.deepEqual(plan.warnings, []);
  assert.equal(JSON.stringify(fixture), original);
});

test('missing or incompatible stackup explicitly estimates elevation and missing copper thickness', () => {
  const fixture = board(); fixture.stackup[2].thickness = undefined;
  let plan = sourceCopperPlan(fixture, [], 1.74);
  assert.match(plan.warnings.join(' '), /estimated uniformly/);
  close(plan.layers[1].z, .85 / 3);
  fixture.stackup = [];
  plan = sourceCopperPlan(fixture, [], 1.6);
  assert.equal(plan.layers.every(layer => layer.thickness === .035), true);
  assert.match(plan.warnings.join(' '), /0\.035 mm/);
  assert.match(plan.warnings.join(' '), /estimated uniformly/);
  assert.match(sourceCopperPlan(board(), [], 1.6).warnings.join(' '), /differs from board depth/);
});

test('saved through, blind and buried endpoints retain only their own depth spans', () => {
  const declarations = `
    (via (uuid "through") (at 11 12) (layers "F.Cu" "B.Cu"))
    (via blind (uuid "blind") (at 13 14) (layers "F.Cu" "In1.Cu"))
    (via blind (uuid "buried") (at 15 16) (layers "In1.Cu" "In2.Cu"))
    (via micro (uuid "micro") (at 17 18) (layers "In2.Cu" "B.Cu"))`;
  const records = ['through', 'blind', 'buried', 'micro'].map((id, index) => ({id, at: [11 + index * 2, 12 + index * 2]}));
  const original = JSON.stringify(records), plan = viaPlan(declarations, records);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual([...plan.viaSpans.values()].map(span => span.type), ['through', 'blind', 'buried', 'micro']);
  assert.equal(plan.viaSpans.get('through').through, true);
  assert.equal(plan.viaSpans.get('blind').through, false);
  close(plan.viaSpans.get('blind').zMin, .615);
  close(plan.viaSpans.get('blind').zMax, .85);
  close(plan.viaSpans.get('buried').zMin, -.415);
  close(plan.viaSpans.get('buried').zMax, .615);
  assert.equal(JSON.stringify(records), original);
});

test('reversed valid endpoints normalize and timestamp IDs take precedence over fallback', () => {
  const plan = viaPlan(`
    (via (uuid "first") (at 1 1) (layers "F.Cu" "B.Cu"))
    (via (at 2) (layers "F.Cu" "B.Cu"))
    (via blind (tstamp "legacy") (at 2 2) (layers "In2.Cu" "In1.Cu"))
    (via (at 3 3) (layers "F.Cu" "B.Cu"))
    (via (uuid "reverse") (at 4 4) (layers "B.Cu" "F.Cu"))`, [{id: 'first'}, {id: 'legacy'}, {id: 'via-3'}, {id: 'reverse'}]);
  assert.deepEqual(plan.viaSpans.get('reverse'), plan.viaSpans.get('first'));
  assert.deepEqual(plan.viaSpans.get('via-3'), plan.viaSpans.get('first'));
  assert.equal(plan.viaSpans.get('legacy').from, 'In1.Cu');
  assert.equal(plan.viaSpans.get('legacy').to, 'In2.Cu');
});

test('missing, unknown, duplicate and type-incompatible source spans cannot invent through geometry', () => {
  const declarations = [
    '(via (uuid "missing") (at 1 1))',
    '(via blind (uuid "unknown") (at 2 2) (layers "F.Cu" "In9.Cu"))',
    '(via (uuid "wrong-type") (at 3 3) (layers "In1.Cu" "In2.Cu"))',
    '(via micro (uuid "wide-micro") (at 4 4) (layers "F.Cu" "In2.Cu"))',
    '(via blind (uuid "blind-through") (at 5 5) (layers "F.Cu" "B.Cu"))',
    '(via (uuid "duplicate") (at 6 6) (layers "F.Cu" "B.Cu"))',
    '(via (uuid "duplicate") (at 7 7) (layers "F.Cu" "B.Cu"))',
    '(via (uuid "same") (at 8 8) (layers "In1.Cu" "In1.Cu"))'
  ].join(' ');
  const ids = ['missing', 'unknown', 'wrong-type', 'wide-micro', 'blind-through', 'duplicate', 'same', 'no-source'];
  const plan = viaPlan(declarations, ids.map(id => ({id, layers: ['F.Cu', 'B.Cu']})));
  assert.equal(plan.viaSpans.size, 0);
  assert.equal(plan.warnings.length, ids.length);
  for (const id of ids) assert.ok(plan.warnings.some(warning => warning.includes(`Via ${id}:`)));
});
