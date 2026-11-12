const test = require("node:test");
const assert = require("node:assert/strict");
const { parse } = require("../design-diff.js");
const { build } = require("../schematic-renderer.js");

const render = (source, path = "hardware/root.kicad_sch") => build(parse(source), path);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('native graphic RGBA, independent fills, dash styles and font colors survive symbol transforms',()=>{
 const source=`(kicad_sch (lib_symbols (symbol "X" (symbol "X_0_1" (rectangle (start -2 -1) (end 2 1) (stroke (width .2) (type dash_dot) (color 132 0 0 .5)) (fill (type color) (color 10 80 240 .25)))))) (symbol (lib_id "X") (at 50 60 90) (unit 1) (uuid "u1")) (circle (center 10 10) (radius 3) (stroke (width .3) (type dot) (color 0 0 0 0)) (fill (type cross_hatch) (color 20 30 40 1)) (uuid "hatch")) (text "Saved color" (at 20 30) (effects (font (size 1 1) (color 1 2 3 .7))) (uuid "text")))`;
 const before=parse(source),snapshot=JSON.stringify(before),result=build(before,'native.kicad_sch'),body=result.primitives.find(p=>p.uuid==='u1'&&p.type==='polygon'&&p.stroke!==false),hatch=result.primitives.find(p=>p.uuid==='hatch'),text=result.primitives.find(p=>p.uuid==='text');
 assert.equal(body.sourceColor,'rgba(132,0,0,0.5)');assert.equal(body.fillColor,'rgba(10,80,240,0.25)');assert.equal(body.fill,'color');assert.equal(body.lineStyle,'dash_dot');assert.equal(body.width,.2);assert.equal(hatch.fill,'cross_hatch');assert.equal(hatch.sourceColor,undefined);assert.equal(hatch.fillColor,'rgba(20,30,40,1)');assert.equal(text.sourceColor,'rgba(1,2,3,0.7)');assert.equal(JSON.stringify(before),snapshot);
});

test('native sheet fills, text-box font colors and invalid color fallback remain independent',()=>{
 const result=render(`(kicad_sch (sheet (at 10 10) (size 20 15) (stroke (width .4) (color 8 9 10 1)) (fill (color 40 50 60 .3)) (uuid "sheet")) (text_box "Hello" (at 40 10) (size 20 10) (stroke (width .2) (color 200 10 20 1)) (fill (type background)) (effects (font (size 1 1) (color 10 200 20 1))) (uuid "box")) (rectangle (start 0 0) (end 5 5) (stroke (color 999 1 2 1)) (fill (type none)) (uuid "bad")))`);
 const sheet=result.primitives.find(p=>p.uuid==='sheet'&&p.type==='polygon'),border=result.primitives.find(p=>p.uuid==='box'&&p.type==='polygon'),text=result.primitives.find(p=>p.uuid==='box'&&p.type==='text'),bad=result.primitives.find(p=>p.uuid==='bad');assert.equal(sheet.fill,'color');assert.equal(sheet.fillColor,'rgba(40,50,60,0.3)');assert.equal(sheet.width,.4);assert.equal(border.fill,'background');assert.equal(border.sourceColor,'rgba(200,10,20,1)');assert.equal(text.sourceColor,'rgba(10,200,20,1)');assert.equal(bad.sourceColor,undefined);assert.equal(bad.fill,undefined);
});

test("placed unit graphics and pins use world-mm rotation while hidden fields stay hidden", () => {
  const source = `(kicad_sch
    (lib_symbols (symbol "Device:Test" (pin_numbers (hide yes)) (pin_names (offset 0.5))
      (symbol "Test_0_1" (rectangle (start -2 -1) (end 2 1) (stroke (width 0.2)) (fill (type background))))
      (symbol "Test_1_1" (polyline (pts (xy 0 0) (xy 1 0)))
        (pin passive line (at -3 0 0) (length 1)
          (name "A" (effects (font (size 1 1))))
          (number "1" (effects (font (size 1 1))))))
      (symbol "Test_2_1" (circle (center 0 0) (radius 1)))))
    (symbol (lib_id "Device:Test") (at 100 80 90) (unit 1) (uuid "placed-1")
      (property "Reference" "U1" (at 102 75) (effects (font (size 1.5 1.5) (bold yes) (italic yes)) (justify left top)))
      (property "Value" "Secret" (at 104 76) (effects (font (size 1 1)) (hide yes)))))`;
  const result = render(source);
  const owned = result.primitives.filter((item) => item.uuid === "placed-1");
  const body = owned.find((item) => item.type === "polygon");
  assert.deepEqual(body.points[0], { x: 101, y: 82 });
  assert.equal(body.fill, "background");
  assert.equal(body.width, 0.2);
  const pin = owned.find((item) => item.kind === "pin" && item.type === "line");
  assert.deepEqual(pin.points, [{ x: 100, y: 83 }, { x: 100, y: 82 }]);
  assert.equal(owned.some((item) => item.kind === "pin-number"), false);
  assert.equal(owned.some((item) => item.type === "circle"), false, "unit 2 is not placed");
  assert.equal(owned.some((item) => item.text === "Secret"), false);
  const pick = owned.find((item) => item.pick === true && item.type === "polygon");
  assert.equal(pick.stroke, false);
  assert.equal(pick.fill, false);
  assert.ok(pick.points[0].x < 100 && pick.points[2].x > 100);
  const reference = owned.find((item) => item.text === "U1" && item.kind === "property");
  assert.deepEqual({ x: reference.x, y: reference.y, size: reference.size, color: reference.color, align: reference.align,
    baseline: reference.baseline, bold: reference.bold, italic: reference.italic },
  { x: 102, y: 75, size: 1.5, color: "#840000", align: "left", baseline: "top", bold: true, italic: true });
});

test("library coordinate mirrors X and Y independently before placement", () => {
  const source = `(kicad_sch (lib_symbols (symbol "Lib:Mirror"
    (symbol "Mirror_1_1" (polyline (pts (xy 1 2) (xy 3 2))))))
    (symbol (lib_id "Lib:Mirror") (at 100 100 0) (unit 1) (uuid "normal"))
    (symbol (lib_id "Lib:Mirror") (at 100 100 0) (mirror x) (unit 1) (uuid "mirror-x"))
    (symbol (lib_id "Lib:Mirror") (at 100 100 0) (mirror y) (unit 1) (uuid "mirror-y")))`;
  const result = render(source);
  const start = (id) => result.primitives.find((item) => item.uuid === id && item.type === "polyline").points[0];
  assert.deepEqual(start("normal"), { x: 101, y: 98 });
  assert.deepEqual(start("mirror-x"), { x: 101, y: 102 });
  assert.deepEqual(start("mirror-y"), { x: 99, y: 98 });
});

test("page outline, title block fields, sheet box, pins and network primitives retain owners", () => {
  const source = `(kicad_sch (paper "A4" portrait)
    (title_block (title "Controller") (date "2026-10-03") (rev "B") (company "Wayri") (comment 1 "Prototype"))
    (wire (pts (xy 20 30) (xy 40 30)) (stroke (width 0.25)) (uuid "wire-1"))
    (bus (pts (xy 20 35) (xy 40 35)) (uuid "bus-1"))
    (junction (at 40 30) (diameter 1) (uuid "junction-1"))
    (no_connect (at 50 50) (uuid "nc-1"))
    (label "SDA" (at 20 30) (effects (font (size 1.27 1.27))) (uuid "label-1"))
    (sheet (at 60 50) (size 30 20) (uuid "sheet-1")
      (property "Sheetname" "Power" (at 60 48) (effects (font (size 1.27 1.27))))
      (property "Sheetfile" "power.kicad_sch" (at 60 73) (effects (font (size 1.27 1.27))))
      (pin "VCC" input (at 60 55) (effects (font (size 1 1))) (uuid "sheet-pin"))))`;
  const result = render(source);
  assert.deepEqual([result.page.width, result.page.height], [210, 297]);
  assert.ok(result.primitives.some((item) => item.kind === "page" && item.type === "polygon"));
  assert.ok(result.primitives.filter((item) => ["page", "page-frame", "title-block"].includes(item.kind))
    .every((item) => item.frame === true));
  assert.ok(result.primitives.some((item) => item.kind === "title-block" && item.text === "Title: Controller"));
  assert.ok(result.primitives.some((item) => item.kind === "title-block" && item.text === "File: root.kicad_sch"));
  assert.deepEqual(result.primitives.find((item) => item.uuid === "wire-1").points,
    [{ x: 20, y: 30 }, { x: 40, y: 30 }]);
  assert.equal(result.primitives.find((item) => item.uuid === "wire-1").width, 0.25);
  assert.equal(result.primitives.find((item) => item.uuid === "junction-1").r, 0.5);
  assert.equal(result.primitives.filter((item) => item.uuid === "nc-1").length, 2);
  assert.ok(result.primitives.some((item) => item.uuid === "sheet-1" && item.kind === "sheet-pin" && item.text === "VCC"));
  assert.ok(result.warnings.some((warning) => /Custom .kicad_wks/.test(warning)));
});

test("derived symbols inherit embedded graphics and selected body style", () => {
  const source = `(kicad_sch (lib_symbols
    (symbol "Lib:Base" (symbol "Base_1_1" (circle (center 0 0) (radius 1)))
      (symbol "Base_1_2" (rectangle (start -1 -1) (end 1 1))))
    (symbol "Lib:Child" (extends "Base")))
    (symbol (lib_id "Lib:Child") (at 10 20) (unit 1) (convert 2) (uuid "child")))`;
  const result = render(source);
  const owned = result.primitives.filter((item) => item.uuid === "child");
  assert.equal(owned.some((item) => item.type === "circle"), false);
  assert.equal(owned.some((item) => item.type === "polygon"), true);
  assert.equal(result.warnings.some((warning) => /unavailable/.test(warning)), false);
});

test("unsupported constructs and incomplete arcs produce warnings, not invented geometry", () => {
  const source = `(kicad_sch (paper "Unknown") (image (at 1 2))
    (text_box "Box" (at 1 2) (size 5 5))
    (arc (start 1 1) (end 2 2) (uuid "old-arc"))
    (global_label "CLK" (shape input) (at 20 20) (uuid "g1")))`;
  const result = render(source);
  assert.deepEqual([result.page.width, result.page.height], [297, 210]);
  assert.equal(result.primitives.some((item) => item.uuid === "old-arc"), false);
  assert.ok(result.primitives.some((item) => item.uuid === "g1" && item.text === "CLK"));
  assert.ok(result.warnings.some((warning) => /Unsupported paper size/.test(warning)));
  assert.ok(result.warnings.some((warning) => /image was not rendered/.test(warning)));
  assert.ok(result.warnings.some((warning) => /Legacy or incomplete arc/.test(warning)));
  assert.ok(result.primitives.some((item) => item.uuid === "g1" && item.type === "polygon"));
});

test("malformed root is rejected before drawing", () => {
  assert.throws(() => build(parse("(kicad_pcb)"), "board.kicad_pcb"), /kicad_sch root/);
  const result = render("(kicad_sch (paper \"User\" 300 200))");
  near(result.page.width, 300);
  near(result.page.height, 200);
});

test("saved cubic graphics retain four transformed control points and off-page coordinates",()=>{
 const result=render(`(kicad_sch (paper "A4")
  (bezier (pts (xy -20 220) (xy -10 240) (xy 310 250) (xy 320 230)) (stroke (width 0.3)) (uuid "outside-curve"))
  (lib_symbols (symbol "Graphic:Curve" (symbol "Curve_0_1" (bezier (pts (xy 0 0) (xy 1 2) (xy 3 4) (xy 5 6)) (stroke (width 0.2))))))
  (symbol (lib_id "Graphic:Curve") (at 40 50 90) (unit 1) (uuid "placed-curve")))`);
 assert.deepEqual(result.primitives.find(p=>p.uuid==='outside-curve').points,[{x:-20,y:220},{x:-10,y:240},{x:310,y:250},{x:320,y:230}]);
 const placed=result.primitives.find(p=>p.uuid==='placed-curve'&&p.type==='bezier');assert.deepEqual(placed.points,[{x:40,y:50},{x:38,y:49},{x:36,y:47},{x:34,y:45}]);
 assert.equal(result.warnings.some(w=>/bezier.*not rendered|unrecognized.*bezier|unknown.*bezier/i.test(w)),false);
 const bad=render('(kicad_sch (bezier (pts (xy 0 0) (xy 1 1) (xy 2 2)) (uuid "invalid-curve")))');assert.equal(bad.primitives.some(p=>p.uuid==='invalid-curve'),false);assert.match(bad.warnings.join(' '),/four valid control points/);
});

test("saved text boxes render outside paper with wrapping, margins, styles and exact border coordinates",()=>{
 const result=render(`(kicad_sch (paper "A4") (text_box "Alpha beta gamma delta" (at -30 220 0) (size 20 15) (margins 1 2 3 4) (stroke (width 0.2)) (fill (type background)) (effects (font (size 1 1) bold) (justify left top)) (uuid "outside-box")))`);
 const owned=result.primitives.filter(p=>p.uuid==='outside-box'),border=owned.find(p=>p.type==='polygon'),lines=owned.filter(p=>p.type==='text');
 assert.deepEqual(border.points,[{x:-30,y:220},{x:-10,y:220},{x:-10,y:235},{x:-30,y:235}]);assert.equal(border.fill,'background');assert.equal(border.stroke,true);assert.ok(lines.length>1);assert.equal(lines.map(p=>p.text).join(' '),'Alpha beta gamma delta');assert.equal(lines[0].x,-29);assert.equal(lines[0].y,222.5);assert.equal(lines[0].bold,true);assert.equal(lines[0].align,'left');assert.equal(lines[1].y-lines[0].y,1.5);
 assert.ok(result.warnings.some(w=>/preview font metrics/.test(w)));assert.equal(result.warnings.some(w=>/construct text_box/.test(w)),false);
});

test("vertical and borderless legacy text boxes honor saved bounds without accepting malformed geometry",()=>{
 const result=render(`(kicad_sch
  (text_box "Vertical" (at 10 20 90) (size 12 30) (margins 1 2 3 4) (stroke (width -1)) (effects (font (size 1 1)) (justify left top)) (uuid "vertical"))
  (text_box "Legacy" (start 50 60) (end 70 80) (margins 0 0 0 0) (effects (font (size 1 1)) (justify right bottom)) (uuid "legacy-box"))
  (text_box "No" (at 0 0 0) (size 2 2) (margins 3 0 0 0) (uuid "no-room"))
  (text_box "Skip" (at 0 0 0) (size 0 1) (uuid "bad-box")))`);
 const vertical=result.primitives.filter(p=>p.uuid==='vertical');assert.equal(vertical.find(p=>p.type==='polygon').stroke,false);assert.equal(vertical.find(p=>p.type==='text').angle,-90);assert.deepEqual([vertical.find(p=>p.type==='text').x,vertical.find(p=>p.type==='text').y],[11.5,46]);
 const legacy=result.primitives.find(p=>p.uuid==='legacy-box'&&p.type==='text');assert.equal(legacy.x,70);assert.equal(legacy.y,79.5);assert.equal(legacy.align,'right');assert.equal(result.primitives.some(p=>p.uuid==='no-room'&&p.type==='text'),false);assert.equal(result.primitives.some(p=>p.uuid==='bad-box'),false);
});

function pngFixture(width=3,height=2,ppm=null,extra=[]){
 const {crc32,deflateSync}=require('node:zlib'),chunk=(type,data)=>{const name=Buffer.from(type),header=Buffer.alloc(4),checksum=Buffer.alloc(4);header.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([header,name,data,checksum]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr)];
 if(ppm!==null){const physical=Buffer.alloc(9);physical.writeUInt32BE(ppm);physical.writeUInt32BE(ppm,4);physical[8]=1;parts.push(chunk('pHYs',physical));}
 for(const [type,data]of extra)parts.push(chunk(type,data));
 // Oversize header test cases need no large pixel buffer: they must be rejected
 // by IHDR validation before browser decoding is permitted.
 const pixels=width*height<=100000?Buffer.alloc((width*4+1)*height):Buffer.alloc(5);parts.push(chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0)));return Buffer.concat(parts);
}
const imageSource=(png,version=20260623,attributes='')=>`(kicad_sch (version ${version}) (image (at -5 230) (scale 2) ${attributes} (uuid "saved-image") (data "${png.toString('base64')}")))`;

test('embedded PNGs retain off-page world quads and KiCad saved physical-resolution eras',()=>{
 const png=pngFixture(300,150,3780);
 for(const [version,ppi]of [[20230121,300],[20231120,94],[20260623,96]]){
  const result=render(imageSource(png,version)),image=result.primitives.find(p=>p.type==='image');assert.ok(image,result.warnings.join(' '));assert.equal(image.pixelWidth,300);assert.equal(image.pixelHeight,150);assert.equal(image.dataUrl,'data:image/png;base64,'+png.toString('base64'));assert.equal(image.opacity,1);
  const width=300*25.4/ppi*2,height=150*25.4/ppi*2;near(image.points[0].x,Math.round((-5-width/2)*1e6)/1e6);near(image.points[0].y,Math.round((230-height/2)*1e6)/1e6);near(image.points[2].x,Math.round((-5+width/2)*1e6)/1e6);near(image.points[2].y,Math.round((230+height/2)*1e6)/1e6);
 }
 const noResolution=render(imageSource(pngFixture(300,150))).primitives.find(p=>p.type==='image');near(noResolution.points[1].x-noResolution.points[0].x,50.8);
 const rotated=render(imageSource(pngFixture(3,2),20260623,'(rotate 90) (opacity 0.4)')).primitives.find(p=>p.type==='image');assert.equal(rotated.opacity,.4);assert.equal(rotated.points[0].y>rotated.points[1].y,true);
});

test('PNG validation blocks external data, corrupt chunks, oversized decoded images and animation before image emission',()=>{
 const corrupted=Buffer.from(pngFixture());corrupted[29]^=1;
 for(const png of [corrupted,pngFixture(4001,4000),pngFixture(3,2,null,[['acTL',Buffer.alloc(8)]]),Buffer.from('not PNG')]){
  const result=render(imageSource(png));assert.equal(result.primitives.some(p=>p.type==='image'),false);assert.ok(result.warnings.some(w=>/image was not rendered/.test(w)));
 }
 const external=render('(kicad_sch (image (at 0 0) (data "https://example.com/image.png")))');assert.equal(external.primitives.some(p=>p.type==='image'),false);
 const png=pngFixture();for(const attrs of ['(scale -1)','(opacity 2)']){const result=render(`(kicad_sch (image (at 0 0) ${attrs} (data "${png.toString('base64')}")))`);assert.equal(result.primitives.some(p=>p.type==='image'),false);}
 const count=render('(kicad_sch '+Array.from({length:17},(_,i)=>`(image (at ${i} 0) (data "${png.toString('base64')}"))`).join(' ')+')');assert.equal(count.primitives.filter(p=>p.type==='image').length,16);assert.match(count.warnings.join(' '),/16-image/);
 const large=pngFixture(4000,4000),budget=render('(kicad_sch '+Array.from({length:3},(_,i)=>`(image (at ${i} 0) (data "${large.toString('base64')}"))`).join(' ')+')');assert.equal(budget.primitives.filter(p=>p.type==='image').length,1);assert.match(budget.warnings.join(' '),/16 megapixel/);
});

test("bare and list effect flags hide fields and style text without treating no as yes", () => {
  const source = `(kicad_sch (lib_symbols (symbol "Demo:Flags"
    (pin_numbers (hide))
    (symbol "Flags_1_1" (pin passive line (at 0 2 270) (length 1)
      (name "VISIBLE" (effects (font (size 1 1))))
      (number "1" (effects (font (size 1 1))))))))
    (symbol (lib_id "Demo:Flags") (at 30 40) (unit 1) (uuid "flags")
      (property "Reference" "U1" (at 30 35) (effects (font (size 1 1) bold italic)))
      (property "Value" "hidden-atom" (at 30 45) (effects (font (size 1 1)) hide))
      (property "Footprint" "hidden-list" (at 30 47) (effects (font (size 1 1)) (hide)))
      (property "Datasheet" "visible-no" (at 30 49) (effects (font (size 1 1) (bold no) (italic no)) (hide no)))))`;
  const owned = render(source).primitives.filter((item) => item.uuid === "flags");
  assert.equal(owned.some((item) => item.text === "hidden-atom" || item.text === "hidden-list"), false);
  assert.equal(owned.some((item) => item.kind === "pin-number"), false);
  assert.equal(owned.some((item) => item.kind === "pin-name" && item.text === "VISIBLE"), true);
  const reference = owned.find((item) => item.text === "U1");
  assert.deepEqual([reference.bold, reference.italic], [true, true]);
  const visible = owned.find((item) => item.text === "visible-no");
  assert.deepEqual([visible.bold, visible.italic], [false, false]);
});

test("placed symbol and sheet properties respect saved direct hide flags", () => {
  const source = `(kicad_sch (lib_symbols (symbol "Demo:Visibility"))
    (symbol (lib_id "Demo:Visibility") (at 30 40) (unit 1) (uuid "part")
      (property "Reference" "U1" (at 30 35) (effects (font (size 1 1))))
      (property "Value" "direct-atom" (at 30 45) hide (effects (font (size 1 1))))
      (property "Footprint" "direct-list" (at 30 47) (hide) (effects (font (size 1 1))))
      (property "Datasheet" "direct-yes" (at 30 49) (hide yes) (effects (font (size 1 1))))
      (property "Description" "direct-no" (at 30 51) (hide no) (effects (font (size 1 1))))
      (property "Note" "hide" (at 30 53) (effects (font (size 1 1)))))
    (sheet (at 70 70) (size 20 10) (uuid "sheet")
      (property "Sheetname" "sheet-hidden" (at 70 65) (hide yes) (effects (font (size 1 1))))
      (property "Sheetfile" "sheet-visible" (at 70 67) (hide no) (effects (font (size 1 1))))))`;
  const text = render(source).primitives.filter((item) => item.type === "text").map((item) => item.text);
  for (const hidden of ["direct-atom", "direct-list", "direct-yes", "sheet-hidden"]) {
    assert.equal(text.includes(hidden), false, hidden);
  }
  for (const visible of ["U1", "direct-no", "hide", "sheet-visible"]) {
    assert.equal(text.includes(visible), true, visible);
  }
});

test("resistor body and pin/wire joins agree with KiCad 10 native SVG coordinates", () => {
  // Reference: kicad-cli sch export svg of the saved sensor.kicad_sch fixture.
  const source = `(kicad_sch (paper "A4")
    (lib_symbols (symbol "Demo:R"
      (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54)))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27))))))))
    (wire (pts (xy 100 70) (xy 100 86.19)) (uuid "upper-wire"))
    (wire (pts (xy 100 93.81) (xy 100 110)) (uuid "lower-wire"))
    (symbol (lib_id "Demo:R") (at 100 90 0) (unit 1) (uuid "r1")))`;
  const drawn = render(source).primitives;
  const body = drawn.find((item) => item.uuid === "r1" && item.type === "polygon" && !item.pick);
  const xs = body.points.map((point) => point.x), ys = body.points.map((point) => point.y);
  near(Math.min(...xs), 98.984); near(Math.max(...xs), 101.016);
  near(Math.min(...ys), 87.46); near(Math.max(...ys), 92.54);
  const pins = drawn.filter((item) => item.uuid === "r1" && item.kind === "pin" && item.type === "line");
  assert.deepEqual(pins.map((pin) => pin.points), [
    [{ x: 100, y: 86.19 }, { x: 100, y: 87.46 }],
    [{ x: 100, y: 93.81 }, { x: 100, y: 92.54 }]
  ]);
  assert.deepEqual(drawn.find((item) => item.uuid === "upper-wire").points,
    [{ x: 100, y: 70 }, { x: 100, y: 86.19 }]);
  assert.deepEqual(drawn.find((item) => item.uuid === "lower-wire").points,
    [{ x: 100, y: 93.81 }, { x: 100, y: 110 }]);
});

test("native specialty pin markers retain true conductive endpoints", () => {
  // Numeric references independently exported by KiCad 10.0.6. Marker sizes
  // are 25/50 mil; bubbles shorten the drawn stem, never its connection point.
  const styles=["line","inverted","clock","inverted_clock","input_low","clock_low","output_low","edge_clock_high","non_logic"];
  const pins=styles.map((style,i)=>`(pin input ${style} (at -5 ${-i*6} 0) (length 5)
    (name "P${i}" (effects (font (size 1.27 1.27))))
    (number "${i+1}" (effects (font (size 1.27 1.27)))))`).join("\n");
  const p=render(`(kicad_sch (lib_symbols (symbol "Demo:P" (pin_names (offset 0.508)) (symbol "P_1_1" ${pins})))
    (symbol (lib_id "Demo:P") (at 40 30 0) (unit 1) (uuid "pins")
      (property "Reference" "U1" (at 40 20) (effects (font (size 1.27 1.27))))))`).primitives;
  const conductive=p.filter(p=>p.kind === "pin");
  assert.equal(conductive.length,9);
  assert.deepEqual(conductive.map(p=>p.connectPoint),styles.map((_,i)=>({x:35,y:30+i*6})));
  assert.ok(conductive.every(p=>p.uuid === "pins" && p.ownerUuid === "pins" && p.reference === "U1" && p.pinType === "input"));
  assert.deepEqual(conductive.map(p=>p.pinNumber),["1","2","3","4","5","6","7","8","9"]);
  const bubble=p.find(p=>p.type === "circle" && p.kind === "pin-marker" && p.pinNumber === "2");
  near(bubble.x,39.365);near(bubble.y,36);near(bubble.r,0.635);
  assert.deepEqual(conductive[1].points,[{x:35,y:36},{x:38.73,y:36}]);
  const clock=p.find(p=>p.type === "polyline" && p.kind === "pin-marker" && p.pinNumber === "3");
  assert.deepEqual(clock.points,[{x:40,y:42.635},{x:41.27,y:42},{x:40,y:41.365}]);
  const low=p.find(p=>p.type === "polyline" && p.kind === "pin-marker" && p.pinNumber === "5");
  assert.deepEqual(low.points,[{x:38.73,y:54},{x:38.73,y:52.73},{x:40,y:54}]);
  const number=p.find(p=>p.kind === "pin-number" && p.text === "1");
  near(number.x,37.5);near(number.y,29.0094);
  const name=p.find(p=>p.kind === "pin-name" && p.text === "P0");
  near(name.x,40.508);assert.equal(name.align,"left");
});

test("rotated, mirrored and hidden pins keep world connection metadata", () => {
  const source=`(kicad_sch (lib_symbols (symbol "Demo:H" (symbol "H_1_1"
    (pin power_in line (at -5 2 0) (length 3) hide (name "VCC") (number "7")))))
    (symbol (lib_id "Demo:H") (at 100 80 90) (unit 1) (uuid "rotated"))
    (symbol (lib_id "Demo:H") (at 100 80 180) (mirror y) (unit 1) (uuid "mirror")))`;
  const p=render(source).primitives.filter(p=>p.kind === "pin");
  assert.deepEqual(p[0].connectPoint,{x:98,y:85});
  assert.deepEqual(p[1].connectPoint,{x:95,y:82});
  assert.ok(p.every(p=>p.hidden === true && p.stroke === false && p.pick === false && p.pinNumber === "7"));
});

test("label connector and global outlines agree with native marker measurements", () => {
  const p=render(`(kicad_sch
    (hierarchical_label "input" (shape input) (at 150 30 0) (effects (font (size 1.27 1.27))) (uuid "hier"))
    (global_label "input" (shape input) (at 100 30 0) (effects (font (size 1.27 1.27))) (uuid "global"))
    (hierarchical_label "OUT" (shape output) (at 20 20 90) (effects (font (size 1.27 1.27))) (uuid "up")))`).primitives;
  const icon=p.find(p=>p.uuid === "hier" && p.type === "polygon");
  assert.deepEqual(icon.points,[{x:150,y:30},{x:150.635,y:30.635},{x:151.27,y:30.635},{x:151.27,y:29.365},{x:150.635,y:29.365}]);
  const label=p.find(p=>p.uuid === "hier" && p.type === "text");
  near(label.x,151.4605);near(label.y,30);assert.equal(label.color,"#725600");
  const global=p.find(p=>p.uuid === "global" && p.type === "polygon");
  assert.ok(Math.abs(global.points[2].x-107.2229)<0.002,"native global label outline width");
  const globalText=p.find(p=>p.uuid === "global" && p.type === "text");
  assert.ok(Math.abs(globalText.x-101.4288)<0.0001);
  assert.ok(Math.abs(globalText.textWidth-4.9807)<0.001);
  assert.deepEqual(globalText.connectPoint,{x:100,y:30});
  assert.equal(p.find(p=>p.uuid === "up" && p.type === "text").angle,-90);
});

test("multiline non-square fonts retain dimensions and library text rotation", () => {
  const p=render(`(kicad_sch (lib_symbols (symbol "Demo:Text" (symbol "Text_1_1"
    (text "body" (at 0 0 0) (effects (font (size 1 1)))))))
    (symbol (lib_id "Demo:Text") (at 30 40 90) (unit 1) (uuid "body"))
    (text "first\\nsecond" (at 20 25 90) (effects (font (face "Example Font") (size 2 1) (thickness 0.2) bold italic) (justify right top)) (uuid "multi")))`).primitives;
  const text=p.find(p=>p.uuid === "multi");
  assert.equal(text.text,"first\nsecond");
  assert.deepEqual([text.size,text.fontWidth,text.fontHeight,text.fontFace,text.textThickness,text.lineSpacing,text.angle],
    [1,2,1,"Example Font",0.2,1.5,-90]);
  assert.deepEqual([text.align,text.baseline,text.bold,text.italic],["right","top",true,true]);
  near(p.find(p=>p.uuid === "body" && p.type === "text").angle,-90);
});

test("unknown pin styles and label shapes remain explicit warnings", () => {
  const r=render(`(kicad_sch (lib_symbols (symbol "Demo:Unknown" (symbol "Unknown_1_1"
    (pin passive strange (at -3 0 0) (length 2) (number "1")))))
    (symbol (lib_id "Demo:Unknown") (at 20 20 0) (unit 1) (uuid "u"))
    (global_label "X" (shape strange) (at 30 30 0) (uuid "l")))`);
  assert.ok(r.warnings.some(w=>w.includes("Pin graphic style strange")));
  assert.ok(r.warnings.some(w=>w.includes("Unsupported global_label shape strange")));
});

test("KiCad overbars preserve plain prefixes/suffixes and native measured spans", () => {
  const r=render(`(kicad_sch
    (text "pre~{RESET}post" (at 120 130 0) (effects (font (size 1.27 1.27))) (uuid "bar"))
    (text "~{A} + ~{B}" (at 10 20 90) (effects (font (size 1.27 1.27)) (justify left)) (uuid "two"))
    (global_label "~{ENABLE}" (shape input) (at 30 30 0) (effects (font (size 1.27 1.27))) (uuid "label")))`);
  const text=r.primitives.find(p=>p.uuid === "bar" && p.type === "text");
  assert.equal(text.text,"preRESETpost");assert.equal(text.rawText,"pre~{RESET}post");
  const bar=r.primitives.find(p=>p.uuid === "bar" && p.kind === "text-overbar");
  // Independent KiCad 10 native stroke path: M116.7405 128.7070 L122.2316 128.7070.
  for(const [actual,expected] of [[bar.points[0].x,116.7405],[bar.points[1].x,122.2316],[bar.points[0].y,128.707]]) {
    assert.ok(Math.abs(actual-expected)<0.001,`${actual} != ${expected}`);
  }
  const two=r.primitives.filter(p=>p.uuid === "two" && p.kind === "text-overbar");
  assert.equal(two.length,2);assert.equal(two[0].points[0].x,two[0].points[1].x,"bar rotates with text");
  assert.ok(two[0].points[0].y > two[0].points[1].y);
  const label=r.primitives.find(p=>p.uuid === "label" && p.type === "text");
  assert.equal(label.text,"ENABLE");assert.equal(label.rawText,"~{ENABLE}");
  assert.equal(r.primitives.filter(p=>p.uuid === "label" && p.kind === "text-overbar").length,1);
});
