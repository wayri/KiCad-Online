const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../design-diff.js');
const { build } = require('../pcb-renderer.js');

test('saved PCB graphics preserve solid/none fills and individual stroke styles',()=>{
 const result=build(parse(`(kicad_pcb (layers (37 "F.SilkS" user)) (gr_rect (start 0 0) (end 5 5) (stroke (width .2) (type dash_dot_dot)) (fill solid) (layer "F.SilkS") (uuid "filled")) (gr_circle (center 10 10) (end 12 10) (stroke (width .1) (type dot)) (fill none) (layer "F.SilkS") (uuid "open")))`),'styles.kicad_pcb');
 const filled=result.primitives.find(p=>p.uuid==='filled'),open=result.primitives.find(p=>p.uuid==='open');assert.equal(filled.fill,true);assert.equal(filled.lineStyle,'dash_dot_dot');assert.equal(open.fill,false);assert.equal(open.lineStyle,'dot');assert.equal(open.layer,'F.SilkS');
});

const board = `(kicad_pcb (version 20241229) (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user) (44 "Edge.Cuts" user))
  (gr_rect (start 80 60) (end 170 110) (stroke (width 0.1)) (fill none) (layer "Edge.Cuts") (uuid "edge"))
  (gr_text "Sensor" (at 120 65) (layer "F.SilkS") (uuid "label") (effects (font (size 1.5 1.5))))
  (gr_arc (start 80 60) (mid 85 55) (end 90 60) (stroke (width 0.1)) (layer "Edge.Cuts") (uuid "arc"))
  (footprint "Demo:Part" (layer "F.Cu") (at 100 80 90) (uuid "front")
    (property "Reference" "R1" (at 0 -3) (layer "F.SilkS") (effects (font (size 1 1))))
    (pad "1" thru_hole rect (at 10 0) (size 4 2) (drill 1) (layers "*.Cu") (uuid "p1")))
  (footprint "Demo:Back" (layer "B.Cu") (at 150 80 90) (uuid "back")
    (property "Reference" "U2" (at 0 -3) (layer "B.SilkS") (effects (font (size 1 1))))
    (pad "A" smd oval (at 10 0) (size 4 2) (layers "B.Cu") (uuid "p2")))
  (segment (start 100 70) (end 120 70) (width .5) (layer "F.Cu") (net 1) (uuid "track"))
  (via (at 120 70) (size 1.5) (drill .7) (layers "F.Cu" "B.Cu") (uuid "via"))
  (zone (net 1) (layer "F.Cu") (uuid "zone")
    (filled_polygon (layer "F.Cu") (pts (xy 100 80) (xy 110 80) (xy 110 90) (xy 100 90)))))`;

test('extracts transformed front/back pads, native UUIDs, copper, drill and filled zone', () => {
  const result = build(parse(board), 'boards/sensor.kicad_pcb');
  assert.equal(result.page.width, 297);
  assert.equal(result.page.height, 210);
  assert.equal(result.page.name, 'A4');
  assert.deepEqual(result.layers, ['F.Cu','B.Cu','F.SilkS','Edge.Cuts']);
  const front = result.primitives.find((p) => p.uuid === 'p1' && p.type === 'pad' && p.layer === 'F.Cu');
  assert.equal(front.reference, 'R1');
  assert.equal(front.ownerUuid, 'front');
  assert.deepEqual([Math.min(...front.points.map((p) => p.x)), Math.max(...front.points.map((p) => p.x)),
    Math.min(...front.points.map((p) => p.y)), Math.max(...front.points.map((p) => p.y))], [98,102,69,71]);
  const back = result.primitives.find((p) => p.uuid === 'p2' && p.type === 'pad');
  assert.equal(back.ownerUuid, 'back');
  assert.ok(Math.abs((Math.min(...back.points.map((p) => p.y)) + Math.max(...back.points.map((p) => p.y))) / 2 - 70) < 1e-8);
  assert.ok(result.primitives.some((p) => p.uuid === 'track' && p.width === .5 && p.type === 'line'));
  assert.equal(result.primitives.filter((p) => p.uuid === 'via' && p.hole).length, 2);
  assert.ok(result.primitives.some((p) => p.uuid === 'zone' && p.fill === true && p.points.length === 4));
  assert.deepEqual(result.warnings, [
    'Custom .kicad_wks templates are not resolved; the standard KiCad drawing sheet is shown.'
  ]);
  assert.ok(result.primitives.findIndex((p) => p.uuid === 'zone') < result.primitives.findIndex((p) => p.uuid === 'track'));
  assert.ok(result.primitives.findIndex((p) => p.uuid === 'track') < result.primitives.findIndex((p) => p.uuid === 'p1'));
  assert.ok(result.primitives.some((p) => p.kind === 'footprint-hit' && p.uuid === 'front' && p.pick));
});

test('filled zones retain separate saved outlines on each declared copper layer',()=>{
 const source=`(kicad_pcb (version 20241229) (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
 (zone (net 1) (layers "F.Cu" "B.Cu") (uuid "z")
 (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10)))
 (filled_polygon (layer "F.Cu") (pts (xy 1 1) (xy 9 1) (xy 9 9) (xy 1 9)))))`;
 const result=build(parse(source),'board.kicad_pcb');
 const fills=result.primitives.filter(p=>p.kind==='zone'),outlines=result.primitives.filter(p=>p.kind==='zone-outline');
 assert.equal(fills.length,1);assert.equal(fills[0].fill,true);
 assert.deepEqual(outlines.map(p=>p.layer),['F.Cu','B.Cu']);assert.ok(outlines.every(p=>!p.fill&&p.uuid==='z'));
 assert.equal(outlines[0].points[0].x,0);assert.equal(fills[0].points[0].x,1);
});
test('preserves outline, arc and reference text in world millimetres', () => {
  const primitives = build(parse(board)).primitives;
  const outline = primitives.find((p) => p.uuid === 'edge');
  assert.equal(outline.layer, 'Edge.Cuts');
  assert.deepEqual(outline.points, [{x:80,y:60},{x:170,y:60},{x:170,y:110},{x:80,y:110}]);
  const arc = primitives.find((p) => p.uuid === 'arc');
  assert.deepEqual([arc.start,arc.mid,arc.end], [{x:80,y:60},{x:85,y:55},{x:90,y:60}]);
  const reference = primitives.find((p) => p.text === 'R1');
  assert.deepEqual([reference.x,reference.y], [97,80]);
  assert.equal(reference.ownerUuid, 'front');
  assert.ok(primitives.some((p) => p.frame && p.layer === 'Worksheet' && p.type === 'line'));
});

test('does not fabricate unsupported custom pad or unfilled copper', () => {
  const source = board.replace('thru_hole rect', 'thru_hole custom')
    .replace('(filled_polygon (layer "F.Cu") (pts (xy 100 80) (xy 110 80) (xy 110 90) (xy 100 90)))',
      '(polygon (pts (xy 100 80) (xy 110 80) (xy 110 90) (xy 100 90)))');
  const result = build(parse(source));
  assert.equal(result.primitives.some((p) => p.uuid === 'p1' && p.type === 'pad'), false);
  assert.equal(result.primitives.some((p) => p.uuid === 'zone' && p.fill), false);
  assert.ok(result.warnings.some((line) => line.includes('custom pad')));
  assert.ok(result.warnings.some((line) => line.includes('Unfilled zone')));
});

test('oval drills use filled hole polygons rather than circular approximations', () => {
  const source = board.replace('(drill 1)', '(drill oval .8 1.4)');
  const result = build(parse(source));
  const hole = result.primitives.find((p) => p.uuid === 'p1' && p.layer === 'F.Cu' && p.hole);
  assert.equal(hole.type, 'polygon');
  assert.equal(hole.points.length, 26);
  assert.equal(hole.ownerUuid, 'front');
});

test('wildcard pad layers and through vias cover internal copper layers', () => {
  const source = board.replace('(31 "B.Cu" signal)', '(1 "In1.Cu" signal) (31 "B.Cu" signal)');
  const primitives = build(parse(source)).primitives;
  assert.ok(primitives.some((p) => p.uuid === 'p1' && p.layer === 'In1.Cu' && p.type === 'pad'));
  assert.ok(primitives.some((p) => p.uuid === 'via' && p.layer === 'In1.Cu' && p.kind === 'via'));
});

test('custom pad anchor and saved circles/polygon use pad angle and native owner IDs', () => {
  const source = board.replace('(pad "1" thru_hole rect (at 10 0) (size 4 2) (drill 1) (layers "*.Cu") (uuid "p1"))',
    `(pad "1" smd custom (at 10 0 90) (size 1 .5) (layers "F.Cu" "F.Mask")
      (options (anchor rect))
      (primitives
        (gr_circle (center 0 .25) (end .5 .25) (width 0) (fill yes))
        (gr_circle (center 0 -.25) (end .5 -.25) (width 0) (fill yes))
        (gr_poly (pts (xy .5 .75) (xy 0 .75) (xy 0 -.75) (xy .5 -.75)) (width 0) (fill yes)))
      (uuid "p1"))`);
  const result = build(parse(source));
  const shapes = result.primitives.filter((p) => p.uuid === 'p1' && p.layer === 'F.Cu' && !p.hole);
  assert.equal(shapes.length, 4);
  assert.equal(shapes.filter((p) => p.type === 'circle').length, 2);
  assert.equal(shapes.filter((p) => p.type === 'polygon').length, 1);
  assert.ok(shapes.every((p) => p.ownerUuid === 'front' && p.reference === 'R1' && p.fill));
  assert.deepEqual([shapes[0].points[0].x,shapes[0].points[0].y], [99.75,70.5]);
  assert.ok(result.primitives.some((p) => p.uuid === 'p1' && p.layer === 'F.Mask'));
  assert.equal(result.warnings.some((line) => line.includes('custom pad')), false);
});

test('hidden text stays hidden; visible text carries native style and screen angle', () => {
  const source = board.replace('(gr_text "Sensor" (at 120 65) (layer "F.SilkS") (uuid "label") (effects (font (size 1.5 1.5))))',
    `(gr_text "Sensor" (at 120 65 90) (layer "F.SilkS") (uuid "label")
      (effects (font (size 1.5 1.5) bold italic) (justify left bottom)))
     (gr_text "SECRET" (at 120 70) (layer "F.SilkS") (effects (font (size 1 1)) hide))`);
  const primitives = build(parse(source)).primitives;
  const label = primitives.find((p) => p.uuid === 'label');
  assert.deepEqual([label.angle,label.bold,label.italic,label.align,label.baseline], [-90,true,true,'left','bottom']);
  assert.equal(primitives.some((p) => p.text === 'SECRET'), false);
});

test('footprint properties respect direct and effect hide states', () => {
  const source = `(kicad_pcb (version 20241229) (paper "A4")
    (layers (0 "F.Cu" signal) (37 "F.SilkS" user))
    (footprint "Demo:Visibility" (layer "F.Cu") (at 20 30) (uuid "part")
      (property "Reference" "direct-atom" (at 0 0) hide (layer "F.SilkS") (effects (font (size 1 1))))
      (property "Value" "effect-no" (at 0 2) (layer "F.SilkS") (effects (font (size 1 1)) (hide no))))
    (footprint "Demo:Visible" (layer "F.Cu") (at 40 30) (uuid "visible")
      (property "Reference" "direct-no" (at 0 0) (hide no) (layer "F.SilkS") (effects (font (size 1 1))))
      (property "Value" "direct-yes" (at 0 2) (hide yes) (layer "F.SilkS") (effects (font (size 1 1)))))
    (footprint "Demo:More" (layer "F.Cu") (at 60 30) (uuid "more")
      (property "Reference" "direct-list" (at 0 0) (hide) (layer "F.SilkS") (effects (font (size 1 1))))
      (property "Value" "effect-yes" (at 0 2) (layer "F.SilkS") (effects (font (size 1 1)) (hide yes))))
    (footprint "Demo:Text" (layer "F.Cu") (at 80 30) (uuid "text")
      (property "Reference" "hide" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1))))))`;
  const text = build(parse(source)).primitives.filter((item) => item.type === 'text').map((item) => item.text);
  for (const hidden of ['direct-atom', 'direct-yes', 'direct-list', 'effect-yes']) {
    assert.equal(text.includes(hidden), false, hidden);
  }
  for (const visible of ['direct-no', 'effect-no', 'hide']) {
    assert.equal(text.includes(visible), true, visible);
  }
});

test('custom circle anchor and saved line, arc, rectangle primitives retain pad identity', () => {
  const source = board.replace('(pad "1" thru_hole rect (at 10 0) (size 4 2) (drill 1) (layers "*.Cu") (uuid "p1"))',
    `(pad "1" smd custom (at 10 0) (size 1 1) (layers "F.Cu")
      (options (anchor circle))
      (primitives
        (gr_line (start 0 0) (end 1 0) (width .2))
        (gr_arc (start 1 0) (mid 1.5 -.5) (end 2 0) (width .1))
        (gr_rect (start 0 0) (end 1 1) (width 0) (fill yes)))
      (uuid "p1"))`);
  const result = build(parse(source));
  const shapes = result.primitives.filter((p) => p.uuid === 'p1' && p.layer === 'F.Cu');
  assert.deepEqual(shapes.map((p) => p.type), ['pad','line','arc','polygon']);
  assert.ok(shapes.every((p) => p.ownerUuid === 'front' && p.reference === 'R1'));
  assert.deepEqual(shapes.find((p) => p.type === 'line').points, [{x:100,y:70},{x:101,y:70}]);
  assert.equal(result.warnings.some((line) => line.includes('custom pad')), false);
});

test('unsupported pad warnings are deduplicated without silently drawing fake pads', () => {
  const source = board.replace('thru_hole rect', 'thru_hole custom').replace('smd oval', 'smd custom');
  const result = build(parse(source));
  assert.equal(result.primitives.some((p) => (p.uuid === 'p1' || p.uuid === 'p2') && p.type === 'pad'), false);
  assert.equal(result.warnings.filter((line) => line.includes('Unsupported custom pad anchor')).length, 1);
});

test('worksheet preserves sparse numbered comments in their native title-block slots',()=>{
 const result=build(parse('(kicad_pcb (paper "A4") (title_block (title "Review board") (comment 3 "Third line")))'),'board.kicad_pcb');
 assert.deepEqual(result.page.titleBlock.comments.slice(0,4),['','','Third line','']);
 const third=result.primitives.find(p=>p.frame&&p.text==='Third line');assert.ok(third);assert.ok(result.primitives.some(p=>p.frame&&p.text==='Title: Review board'));
});

test('pads retain saved terminal names, net labels and source-centered label dimensions',()=>{
 const source=`(kicad_pcb (version 20241229) (layers (0 "F.Cu" signal))
 (footprint "Test" (at 10 20 90) (uuid "fp") (property "Reference" "U1")
  (pad "2" smd rect (at 3 0 45) (size 1 2) (layers "F.Cu") (uuid "pad") (pinfunction "OUT") (net 1 "SIGNAL"))))`;
 const pad=build(parse(source),'board.kicad_pcb').primitives.find(p=>p.type==='pad');
 assert.deepEqual([pad.pinNumber,pad.pinName,pad.netName,pad.ownerUuid],['2','OUT','SIGNAL','fp']);
 assert.deepEqual(pad.padCenter,{x:10,y:17});assert.deepEqual([pad.padWidth,pad.padHeight,pad.padAngle],[1,2,-45]);
});


test('UUID-less KiCad 10 saved copper keeps typed net identity for isolation and selection',()=>{
 const fs=require('node:fs'),path=require('node:path'),ast=parse(fs.readFileSync(path.join(__dirname,'fixtures/fast-pi/dc-strip.kicad_pcb'),'utf8')),result=build(ast,'dc-strip.kicad_pcb'),copper=result.primitives.filter(p=>['zone','zone-outline'].includes(p.kind));
 assert.ok(copper.some(p=>p.kind==='zone'));assert.ok(copper.some(p=>p.kind==='zone-outline'));for(const p of copper){assert.equal(p.uuid,undefined);assert.equal(p.netId,'VCC');assert.equal(p.netCode,'name:VCC');assert.equal(p.netName,'VCC');}
 assert.ok(result.primitives.filter(p=>p.layer==='Edge.Cuts'||p.frame).every(p=>p.netId===undefined));
});

test('saved net metadata covers pads, drill, tracks, arcs, vias and filled zones with legacy and named identities',()=>{
 for(const [version,declaration,net,id,code,name]of [[20241229,'(net 12 "POWER")','(net 12)',12,'12','POWER'],[20260206,'(net 12 "LEGACY")','(net "12")','12','name:12','12']]){
  const ast=parse(`(kicad_pcb (version ${version}) (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) ${declaration}
   (footprint "test" (at 2 3) (uuid "part") (pad "A1" thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu") ${net}) (pad "A2" smd custom (at 3 0) (size 1 1) (layers "F.Cu") ${net} (options (anchor rect)) (primitives (gr_circle (center 0 0) (end 1 0) (width .1) (fill yes)))))
   (segment (start 0 0) (end 1 0) (width .2) (layer "F.Cu") ${net})
   (arc (start 0 0) (mid 1 1) (end 2 0) (width .2) (layer "F.Cu") ${net})
   (via (at 2 0) (size 1) (drill .4) (layers "F.Cu" "B.Cu") ${net})
   (zone (layer "F.Cu") ${net} (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1))) (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy 1 0) (xy 1 1)))))`),result=build(ast,'identity.kicad_pcb');
  const parts=result.primitives.filter(p=>['pad','track','arc','via','drill','zone','zone-outline'].includes(p.kind));for(const kind of ['pad','track','arc','via','drill','zone','zone-outline'])assert.ok(parts.some(p=>p.kind===kind),kind);for(const p of parts){assert.equal(p.netId,id,p.kind);assert.equal(p.netCode,code,p.kind);assert.equal(p.netName,name,p.kind);}
 }
});

test('net-free board graphics preparation has a linear root-record access budget',()=>{
 const count=2000,ast=parse('(kicad_pcb (version 20241229) (layers (0 "F.Cu" signal) (37 "F.SilkS" user)))');
 for(let i=0;i<count;i++)ast.push(['gr_line',['start',i,0],['end',i,1],['width',.1],['layer',{quoted:'F.SilkS'}]]);
 let rootReads=0;const observed=new Proxy(ast,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))rootReads++;return Reflect.get(target,key,receiver);}});
 const result=build(observed,'large-graphics.kicad_pcb');
 const graphics=result.primitives.filter(p=>!p.frame);assert.equal(graphics.length,count);assert.ok(graphics.every(p=>p.kind==='gr_line'&&p.netId===undefined));
 assert.ok(rootReads<ast.length*100,`whole-board scans must not multiply with each graphic (${rootReads} root reads for ${count} graphics)`);
});
