const test = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../analysis-data.js');

test('Touchstone 1.x keeps the historical two-port ordering and preserves phase', () => {
  const source = '# MHz S RI R 75\n100 1 0 0 .5 .01 0 0 0\n200 1 0 0 .5 .01 0 0 0\n';
  const report = analysis.parse('fixture.s2p', source);
  const [magnitude, phase] = report.plots;
  assert.equal(report.family, 'emerge');
  assert.deepEqual(magnitude.series.map(trace => trace.name), ['S11', 'S21', 'S12', 'S22']);
  assert.equal(magnitude.series[2].points[0].y, -40);
  assert.equal(magnitude.series[3].points[0].y, null);
  assert.equal(phase.series[1].points[0].y, 90);
  assert.deepEqual(analysis.probe(phase, 1e8, undefined, 'S21'), {
    x: 1e8, value: 90, name: 'S21', axis: 'Frequency (Hz)', unit: '°', method: 'Nearest saved sample',
  });
  assert.throws(() => analysis.parse('fixture.s2p', source + '300 1 2 3 4\n'), /noise blocks/);
});

test('Touchstone matrices with three ports accept continuation lines in row-major order', () => {
  const source = '# GHz S DB R 50\n3 -11 11 -12 12 -13 13\n-21 21 -22 22 -23 23\n-31 31 -32 32 -33 33\n';
  const [magnitude, phase] = analysis.parse('fixture.s3p', source).plots;
  assert.equal(magnitude.series[1].name, 'S12');
  assert.ok(Math.abs(magnitude.series[1].points[0].y + 12) < 1e-10);
  assert.equal(phase.series[3].name, 'S21');
  assert.equal(phase.series[3].points[0].x, 3e9);
});

test('native EMerge sweeps and radiation cuts keep their saved samples', () => {
  const sweep = {kind: 'quasi_sweep', series: [{label: 'Impedance (Ω)', x: [1, 2], y: [75, 50]}]};
  assert.deepEqual(analysis.parse('sweep.egres', JSON.stringify(sweep)).plots[0].series[0].points,
    [{x: 1, y: 75}, {x: 2, y: 50}]);
  const cut = {kind: 'farfield_cut', ang_deg: [-90, 0, 90], normE: [0, 1, 0]};
  assert.equal(analysis.parse('cut.egres', JSON.stringify(cut)).plots[0].series[0].points[1].y, 1);
  assert.throws(() => analysis.parse('setup.egres', '{"kind":"setup"}'), /saved EMerge result/);
});

test('Quick EMerge fields, radiation and array factor use saved coordinates and units', () => {
  const saved = {schema: 1, backend: {}, field: {
    x_mm: [1, 3], y_mm: [2, 4], norm_e_v_m: [[10, 20], [30, null]],
  }, radiation: {
    theta_rad: [0, Math.PI / 2], phi_rad: [0, Math.PI], norm_e: [[1, 2], [3, 4]],
  }, array_factor: {theta_deg: [-45, 0, 45], normalized_magnitude: [.1, 1, .1]}};
  const report = analysis.parse('results.json', JSON.stringify(saved));
  assert.equal(report.family, 'emerge');
  assert.equal(report.savedSource, undefined);
  assert.equal(analysis.probe(report.plots[0], 3, 2).value, 20);
  assert.equal(analysis.probe(report.plots[0], 3, 4).value, null);
  assert.deepEqual(analysis.probe(report.plots[1], 180, 90), {
    x: 180, y: 90, value: 4, name: 'Far-field magnitude', unit: 'Saved |E|',
    xLabel: 'Phi (degrees)', yLabel: 'Theta (degrees)', method: 'Saved cell center',
  });
  assert.equal(report.plots[2].series[0].points[1].y, 1);
});
