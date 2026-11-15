const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../design-diff.js');
const { build } = require('../schematic-renderer.js');

// Independent KiCad 10 native SVG reference, exported with:
// kicad-cli sch export svg -e -n -o <output> fixtures/schematic-orientation.kicad_sch
// Rows: 0/90/180/270 degrees; no mirror, mirror x, mirror y.
// Circle centers and pin endpoints are numeric SVG landmarks. Field angle and
// justification are determined from native stroked text relative to saved anchors.
const landmarks = [
  [[41,38],[[40,45],[40,42]],['left','top'],['left','top']],
  [[88,39],[[95,40],[92,40]],['left','top'],['right','bottom']],
  [[139,42],[[140,35],[140,38]],['right','bottom'],['right','bottom']],
  [[192,41],[[185,40],[188,40]],['right','bottom'],['left','top']],
  [[41,92],[[40,85],[40,88]],['left','bottom'],['right','top']],
  [[88,91],[[95,90],[92,90]],['right','top'],['right','top']],
  [[139,88],[[140,95],[140,92]],['right','top'],['left','bottom']],
  [[192,89],[[185,90],[188,90]],['left','bottom'],['left','bottom']],
  [[39,138],[[40,145],[40,142]],['right','top'],['left','bottom']],
  [[92,139],[[85,140],[88,140]],['left','bottom'],['left','bottom']],
  [[141,142],[[140,135],[140,138]],['left','bottom'],['right','top']],
  [[188,141],[[195,140],[192,140]],['right','top'],['right','top']]
];

test('rotated and mirrored symbols retain native circles, pin joins and field layout', () => {
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/schematic-orientation.kicad_sch'), 'utf8');
  const ast = parse(source), original = JSON.stringify(ast), primitives = build(ast).primitives;
  for (let i=0; i<landmarks.length; i++) {
    const [circle, pin, referenceStyle, valueStyle] = landmarks[i];
    const owned = primitives.filter(p => p.reference === 'U'+(i+1));
    const body = owned.find(p => p.type === 'circle');
    assert.deepEqual([body.x,body.y], circle, body.reference+' circle');
    const stem = owned.find(p => p.kind === 'pin');
    assert.deepEqual(stem.points.map(p => [p.x,p.y]), pin, body.reference+' pin');
    assert.deepEqual(stem.connectPoint, {x:pin[0][0],y:pin[0][1]});
    for (const [field, style, offset, vertical] of [
      ['Reference',referenceStyle,-4,i%2 === 1], ['Value',valueStyle,4,i%2 === 0]
    ]) {
      const text = owned.find(p => p.kind === 'property' && p.property === field);
      assert.deepEqual([text.x,text.y], [48+(i%4)*50,40+Math.floor(i/4)*50+offset], text.text+' saved anchor');
      assert.equal(Math.abs(text.angle), vertical ? 90 : 0, text.text+' orientation');
      assert.deepEqual([text.align,text.baseline], style, text.text+' justification');
    }
  }
  assert.equal(JSON.stringify(ast), original, 'rendering does not rewrite source');
});

test('legacy matrices and world field angles survive conversion to parent-relative modern fields', () => {
  const library = 'EESchema-LIBRARY Version 2.3\nDEF Probe U 0 40 N N 1 F N\nDRAW\nC 100 200 50 0 1 8 N\nX ~ 1 0 -500 300 U 50 50 1 1 P\nENDDRAW\nENDDEF\n#End Library\n';
  const matrices = [[1,0,0,-1],[0,-1,-1,0],[-1,0,0,1],[0,1,1,0],[1,0,0,1],[0,-1,1,0],[-1,0,0,-1],[0,1,-1,0]];
  for (const matrix of matrices) {
    const source = 'EESchema Schematic File Version 4\n$Comp\nL Probe U1\nU 1 1 00000001\nP 2000 2000\nF 0 "U1" H 2500 1800 50 0000 C CNN\nF 1 "Probe" V 2500 2200 50 0000 C CNN\n1 2000 2000\n'+matrix.join(' ')+'\n$EndComp\n$EndSCHEMATC\n';
    const p = build(parse(source,{libraries:[library]})).primitives;
    const circle = p.find(p => p.type === 'circle');
    const expected = [50.8+matrix[0]*2.54+matrix[1]*5.08,50.8+matrix[2]*2.54+matrix[3]*5.08];
    assert.ok(Math.abs(circle.x-expected[0])<1e-6 && Math.abs(circle.y-expected[1])<1e-6, matrix.join(','));
    const horizontal = p.find(p => p.property === 'Reference'), vertical = p.find(p => p.property === 'Value');
    assert.equal(Math.abs(horizontal.angle),0); assert.equal(Math.abs(vertical.angle),90);
    assert.deepEqual([horizontal.x,horizontal.y],[63.5,45.72]);
    assert.deepEqual([vertical.x,vertical.y],[63.5,55.88]);
  }
});

// Connector:TestPoint is embedded from the installed KiCad 10.0.6 Connector
// library. These independent landmarks come from native SVG export of the
// saved testpoint-orientation.kicad_sch fixture with the same command above.
test('actual Connector:TestPoint circles and pin tangencies match native KiCad in twelve placements', () => {
  const expected = [
    [[40,36.698],[40,40],[40,37.46]],
    [[86.698,40],[90,40],[87.46,40]],
    [[140,43.302],[140,40],[140,42.54]],
    [[193.302,40],[190,40],[192.54,40]],
    [[40,93.302],[40,90],[40,92.54]],
    [[86.698,90],[90,90],[87.46,90]],
    [[140,86.698],[140,90],[140,87.46]],
    [[193.302,90],[190,90],[192.54,90]],
    [[40,136.698],[40,140],[40,137.46]],
    [[93.302,140],[90,140],[92.54,140]],
    [[140,143.302],[140,140],[140,142.54]],
    [[186.698,140],[190,140],[187.46,140]]
  ];
  const source = fs.readFileSync(path.join(__dirname,'fixtures/testpoint-orientation.kicad_sch'),'utf8');
  const primitives = build(parse(source)).primitives;
  for (let i=0; i<expected.length; i++) {
    const [center,connection,bodyEnd] = expected[i];
    const owned = primitives.filter(p => p.reference === 'TP'+(i+1));
    const circle = owned.find(p => p.type === 'circle'), pin = owned.find(p => p.kind === 'pin');
    assert.deepEqual([circle.x,circle.y,circle.r],[...center,0.762],circle.reference);
    assert.deepEqual(pin.points.map(p => [p.x,p.y]),[connection,bodyEnd]);
    assert.deepEqual(pin.connectPoint,{x:connection[0],y:connection[1]});
    assert.ok(Math.abs(Math.hypot(bodyEnd[0]-circle.x,bodyEnd[1]-circle.y)-circle.r)<1e-6,'pin touches circle');
    for (const [name,offset] of [['Reference',-8],['Value',8]]) {
      const text = owned.find(p => p.property === name);
      assert.equal(Math.abs(text.angle),0);
      assert.deepEqual([text.x,text.y,text.align,text.baseline],[connection[0],connection[1]+offset,'center','middle']);
    }
  }
});
