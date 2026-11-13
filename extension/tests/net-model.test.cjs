const test = require("node:test");
const assert = require("node:assert/strict");
const { build, relatedSchematicNets } = require("../net-model.js");
const diff = require("../design-diff.js");
const pcb = require("../pcb-renderer.js");
test('PCB net version detection is constant work as track count grows',()=>{
 const files=[{path:'large.kicad_pcb',content:'(kicad_pcb (version 20240108) (net 1 "SIGNAL") '+Array.from({length:1000},(_,i)=>`(segment (start ${i} 0) (end ${i+1} 0) (width 0.2) (layer "F.Cu") (net 1) (uuid "track-${i}"))`).join('')+')'}];
 const snapshot=diff.prepareProject(files),ast=diff.preparedFile(snapshot,files[0].path),version=ast.find(form=>Array.isArray(form)&&form[0]==='version');let reads=0;Object.defineProperty(version,1,{get(){reads++;return 20240108;}});
 const result=build(files,new Map(),snapshot);assert.equal(result.nets[0].stats.tracks,1000);assert.equal(result.nets[0].stats.lengthMm,1000);assert.equal(reads,1,'the board version must not be scanned again for each net-bearing object');
});
const sch = require("../schematic-renderer.js");
const file = (path,content) => ({path,content});
const board = (content,path="board.kicad_pcb") => file(path,`(kicad_pcb (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) ${content})`);
const schematic = (content,path="root.kicad_sch") => file(path,`(kicad_sch ${content})`);
const wire = (id,a,b) => `(wire (pts (xy ${a[0]} ${a[1]}) (xy ${b[0]} ${b[1]})) (uuid "${id}"))`;
const label = (id,name,x,y,type="label") => `(${type} "${name}" (at ${x} ${y}) (uuid "${id}"))`;
const rendered = (files) => new Map(files.map((f)=>[f.path,pcb.build(diff.parse(f.content),f.path)]));
test('KiCad 10 saved named nets keep per-file identities and rendered track membership',()=>{
 const fs=require('node:fs'),path=require('node:path'),content=fs.readFileSync(path.join(__dirname,'fixtures/board-analytics/tracks.kicad_pcb'),'utf8'),files=[file('a.kicad_pcb',content),file('b.kicad_pcb',content)];
 const result=build(files,rendered(files));assert.equal(result.nets.length,2);assert.equal(new Set(result.nets.map(n=>n.id)).size,2);assert.equal(result.nets[0].name,'GND');assert.equal(result.nets[0].code,'name:GND');assert.equal(result.nets[0].primitives.length,3);assert.equal(result.nets[0].stats.tracks,3);assert.deepEqual(result.warnings,[]);
});

test("PCB saved net codes define membership; same names and files remain distinct",()=> {
  const a=board(`(net 0 "") (net 1 "GND") (net 2 "GND") (net 3 "Unused")
    (segment (start 0 0) (end 3 4) (width .2) (layer "F.Cu") (net 1) (uuid "track"))
    (via (at 3 4) (size .8) (drill .4) (layers "F.Cu" "B.Cu") (net 2) (uuid "via"))
    (segment (start 0 0) (end 9 9) (net 0) (uuid "no-net"))`);
  const b=board(`(net 1 "GND")`,"other.kicad_pcb"), files=[a,b];
  const result=build(files,rendered(files));
  assert.equal(result.nets.length,4);
  assert.equal(new Set(result.nets.map((n)=>n.id)).size,4);
  const track=result.nets.find((n)=>n.path===a.path && n.code==="1");
  assert.deepEqual(track.uuids,["track"]);
  assert.equal(track.stats.lengthMm,5);
  assert.equal(track.stats.tracks,1);
  assert.ok(track.objectIds[0].endsWith("segment:uuid:track"));
  assert.equal(track.primitives.length,1);
  assert.equal(track.primitives[0].kind,"track");
  assert.equal(result.nets.find((n)=>n.code==="3").members.length,0);
  assert.ok(!result.nets.some((n)=>n.uuids.includes("no-net")));
  assert.deepEqual(result.warnings,[]);
});

test("inline pad declarations supply names and scope copper to the canonical numeric code",()=> {
  const source=board(`(footprint "R" (at 100 100 90) (property "Reference" "R1") (uuid "fp")
    (pad "1" smd rect (at 2 3) (size 1 2) (layers "F.Cu") (net 7 "VCC") (uuid "pad1"))
    (pad "2" smd circle (at 4 3) (size 1 1) (layers "F.Cu") (net 0 "") (uuid "pad2")))
    (segment (start 103 98) (end 104 98) (width .2) (layer "F.Cu") (net 7) (uuid "s"))`);
  const result=build([source],Object.fromEntries(rendered([source])));
  assert.equal(result.nets.length,1);
  const net=result.nets[0];
  assert.equal(net.name,"VCC"); assert.equal(net.code,"7");
  assert.deepEqual(net.stats,{pads:1,tracks:1,vias:0,zones:0,lengthMm:1});
  assert.deepEqual(net.members[0],{uuid:"pad1",reference:"R1",pad:"1",kind:"pad",position:{x:103,y:98}});
  assert.ok(net.primitives.some((p)=>p.uuid==="pad1"));
  assert.ok(!net.primitives.some((p)=>p.uuid==="pad2" || p.kind==="footprint-hit"));
});

test("pads without saved UUID match only their own number and footprint",()=> {
  const source=board(`(net 1 "A") (net 2 "B") (footprint "R" (at 0 0) (uuid "fp")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1))
    (pad "2" smd rect (at 2 0) (size 1 1) (layers "F.Cu") (net 2)))`);
  const result=build([source],rendered([source]));
  assert.deepEqual(result.nets.find((n)=>n.code==="1").primitives.map((p)=>p.name),["1"]);
  assert.deepEqual(result.nets.find((n)=>n.code==="2").primitives.map((p)=>p.name),["2"]);
});

test("unknown codes remain selectable with a warning; conflicting names never merge codes",()=> {
  const source=board(`(net 1 "Root") (footprint "R" (at 0 0) (uuid "f")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "Conflict") (uuid "p")))
    (segment (start 0 0) (end 1 0) (net 99) (uuid "unknown"))`);
  const result=build([source]);
  assert.equal(result.nets.find((n)=>n.code==="1").name,"Root");
  assert.deepEqual(result.nets.find((n)=>n.code==="99").uuids,["unknown"]);
  assert.match(result.warnings.join(" "),/conflicting saved names/);
  assert.match(result.warnings.join(" "),/no saved name/);
});

test("native arcs contribute actual minor and major arc lengths, once per saved object",()=> {
  const source=board(`(net 1 "Signal")
    (arc (start 1 0) (mid 0 1) (end -1 0) (width .2) (layer "F.Cu") (net 1) (uuid "semi"))
    (arc (start 1 0) (mid -1 0) (end 0 1) (width .2) (layer "B.Cu") (net 1) (uuid "major"))
    (zone (net 1) (uuid "zone") (layer "F.Cu") (polygon (pts (xy 0 0) (xy 2 0) (xy 2 2))))`);
  const result=build([source],rendered([source])), net=result.nets[0];
  assert.equal(net.stats.tracks,2);assert.equal(net.stats.zones,1);
  assert.ok(Math.abs(net.stats.lengthMm-2.5*Math.PI)<1e-10);
  assert.ok(net.primitives.some((p)=>p.kind==="zone-outline"));
});

test("degenerate arc lengths are reported instead of estimated by a chord",()=> {
  const result=build([board(`(net 1 "A") (arc (start 0 0) (mid 1 0) (end 2 0) (net 1) (uuid "arc"))`)]);
  assert.equal(result.nets[0].stats.lengthMm,0);
  assert.match(result.warnings.join(" "),/degenerate geometry/);
});

test("crossing schematic wire interiors are separate; explicit junction joins them",()=> {
  const wires=wire("horizontal",[0,5],[10,5])+wire("vertical",[5,0],[5,10]);
  const separate=build([schematic(wires)]);
  assert.equal(separate.nets.length,2);
  assert.equal(new Set(separate.nets.map((n)=>n.id)).size,2);
  const joined=build([schematic(wires+`(junction (at 5 5) (uuid "j"))`)]);
  assert.equal(joined.nets.length,1);
  assert.deepEqual(new Set(joined.nets[0].uuids),new Set(["horizontal","vertical","j"]));
  assert.equal(joined.nets[0].stats.lengthMm,20);
  assert.match(joined.warnings[0],/not a KiCad netlist/);
});

test("wire endpoint T connections join, while near misses remain separate",()=> {
  const t=wire("h",[0,5],[10,5])+wire("v",[5,0],[5,5]);
  assert.equal(build([schematic(t)]).nets.length,1);
  const miss=wire("h",[0,5],[10,5])+wire("v",[5,0],[5,4.999]);
  assert.equal(build([schematic(miss)]).nets.length,2);
});

test("equal local labels join disconnected wires only inside their source file",()=> {
  const forms=wire("a",[0,0],[10,0])+wire("b",[20,0],[30,0])+
    label("l1","CLK",0,0)+label("l2","CLK",20,0);
  const result=build([schematic(forms),schematic(forms,"other.kicad_sch")]);
  assert.equal(result.nets.length,2);
  assert.ok(result.nets.every((n)=>n.name==="CLK" && n.scope==="file" && n.uuids.length===4));
  assert.notEqual(result.nets[0].id,result.nets[1].id);
});

test("label at an unjoined crossing does not invent a conductive junction",()=> {
  const result=build([schematic(wire("h",[0,5],[10,5])+wire("v",[5,0],[5,10])+label("l","A",5,5))]);
  assert.equal(result.nets.length,3);
  assert.equal(result.nets.find((n)=>n.name==="A").members.length,1);
  assert.match(result.warnings.join(" "),/ambiguous label\/pin/);
});

test("pin members use conductive metadata and highlight only that pin, including hidden pins",()=> {
  const source=schematic(`(symbol (lib_id "Test:X") (at 0 0) (unit 1) (uuid "s") (property "Reference" "U1"))
    ${wire("a",[0,0],[10,0])} ${wire("b",[0,10],[10,10])}`);
  const pin1={type:"line",kind:"pin",uuid:"s",ownerUuid:"s",pinNumber:"1",connectPoint:{x:0,y:0}};
  const pin2={type:"line",kind:"pin",uuid:"s",ownerUuid:"s",pinNumber:"2",connectPoint:{x:0,y:10},hidden:true,stroke:false,pick:false};
  const body={kind:"symbol",uuid:"s",type:"polygon"};
  const result=build([source],new Map([[source.path,{primitives:[pin1,pin2,body]}]]));
  assert.equal(result.nets.length,2);
  assert.equal(new Set(result.nets.map((n)=>n.id)).size,2);
  for(const net of result.nets) {
    assert.equal(net.primitives.length,1);assert.notEqual(net.primitives[0],body);
    const member=net.members.find((m)=>m.kind==="pin");
    assert.equal(member.reference,"U1");assert.ok(["1","2"].includes(member.pin));
    assert.ok(net.objectIds.includes(`${source.path}/symbol:uuid:s`));
  }
  assert.ok(!result.warnings.some((w)=>/no conductive pin/.test(w)));
});

test("invalid project input fails through the bounded source parser",()=> {
  assert.throws(()=>build([board(""),board("")]),/duplicate/);
  assert.throws(()=>build([file("bad.kicad_pcb","(kicad_pcb")]),/Incomplete/);
  assert.throws(()=>build(new Array(129).fill(board(""))),/Too many/);
});

// Minimal native source subset from installed KiCad 10 pic_programmer demo:
// (power global), hidden zero-length input, placed Value/UUID/positions retained.
const powerDefinition = (id="pic_programmer:GND",flag="(power global)",pinType="power_in",pinName="GND") =>
  `(symbol "${id}" ${flag} (property "Reference" "#PWR") (property "Value" "GND")
    (symbol "GND_0_1" (polyline (pts (xy -1.27 0) (xy 0 -1.27) (xy 1.27 0) (xy -1.27 0))))
    (symbol "GND_1_1" (pin ${pinType} line (at 0 0 90) (length 0) (hide yes) (name "${pinName}") (number "1"))))`;
const placedPower = (uuid,x,y,name="GND",id="pic_programmer:GND") =>
  `(symbol (lib_id "${id}") (at ${x} ${y} 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "#PWR${uuid}") (property "Value" "${name}"))`;
const powerSource = (forms,definitions=powerDefinition(),version=20260101,path="power.kicad_sch") =>
  file(path,`(kicad_sch (version ${version}) (lib_symbols ${definitions}) ${forms})`);
const schRendered = (files) => new Map(files.map((f)=>[f.path,sch.build(diff.parse(f.content),f.path)]));

test("related sheets require exact global evidence on both networks and follow connected aliases",()=> {
  const files=[schematic(label("a","BUS_A",0,0,"global_label"),"a.kicad_sch"),
    schematic(label("b","BUS_A",0,0,"global_label")+label("alias","BUS_B",0,0,"global_label"),"b.kicad_sch"),
    schematic(label("c","BUS_B",0,0,"global_label"),"c.kicad_sch"),
    schematic(label("local","BUS_A",0,0),"local.kicad_sch"),
    schematic(label("hier","BUS_A",0,0,"hierarchical_label"),"child.kicad_sch"),
    schematic(label("case","bus_a",0,0,"global_label"),"case.kicad_sch")];
  const {nets}=build(files),selected=nets.find((n)=>n.path==="a.kicad_sch");
  const result=relatedSchematicNets(nets,selected.id);
  assert.deepEqual(result.paths,["a.kicad_sch","b.kicad_sch","c.kicad_sch"]);
  assert.equal(result.matches.length,3);
  assert.match(result.limits.join(" "),/unambiguous resolved sheet links/);
  assert.deepEqual(relatedSchematicNets(nets,nets.find((n)=>n.path==="local.kicad_sch").id).paths,["local.kicad_sch"]);
  assert.deepEqual(relatedSchematicNets(nets,"missing").matches,[]);
});

test("related sheets join explicit global power and global labels but exclude local power",()=> {
  const files=[powerSource(placedPower("a",0,0),powerDefinition(),20260101,"a.kicad_sch"),
    schematic(label("g","GND",0,0,"global_label"),"b.kicad_sch"),
    powerSource(placedPower("c",0,0),powerDefinition("pic_programmer:GND","(power local)"),20260101,"c.kicad_sch"),
    board('(net 1 "GND")')];
  const {nets}=build(files,schRendered(files.filter((f)=>f.path.endsWith(".kicad_sch"))));
  assert.deepEqual(relatedSchematicNets(nets,nets.find((n)=>n.path==="a.kicad_sch").id).paths,["a.kicad_sch","b.kicad_sch"]);
  assert.deepEqual(nets.find((n)=>n.path==="c.kicad_sch").globalNames,[]);
  assert.deepEqual(relatedSchematicNets(nets,nets.find((n)=>n.kind==="pcb").id).matches,[]);
});

test("saved parent sheet pins join wires and exact child hierarchical labels only",()=> {
  const parent=schematic(wire("w",[0,0],[10,0])+label("local","PARENT",0,0)+
    '(sheet (at 10 0) (size 20 20) (uuid "sheet") (property "Sheetname" "Child") (property "Sheetfile" "child.kicad_sch") (pin "SIGNAL" input (at 10 0 180) (uuid "pin")))');
  const child=schematic(label("h","SIGNAL",0,0,"hierarchical_label"),"child.kicad_sch");
  const unrelated=schematic(label("l","SIGNAL",0,0),"other.kicad_sch");
  const {nets}=build([parent,child,unrelated]),selected=nets.find((n)=>n.path===parent.path);
  const hierarchy=[{path:parent.path,target:child.path,sheetId:"sheet"}];
  assert.deepEqual(selected.sheetPins,[{sheetId:"sheet",name:"SIGNAL"}]);
  const entry=selected.members.find(member=>member.kind==='sheet_pin');assert.equal(entry.name,'SIGNAL');assert.equal(entry.sheetId,'sheet');assert.deepEqual(entry.position,{x:10,y:0});
  assert.equal(nets.find(net=>net.path===child.path).members.find(member=>member.kind==='hierarchical_label').name,'SIGNAL');
  assert.ok(selected.uuids.includes("pin"));
  assert.deepEqual(relatedSchematicNets(nets,selected.id,hierarchy).paths,["child.kicad_sch","root.kicad_sch"]);
  assert.deepEqual(relatedSchematicNets(nets,nets.find((n)=>n.path===child.path).id,hierarchy).paths,["child.kicad_sch","root.kicad_sch"]);
  assert.deepEqual(relatedSchematicNets(nets,selected.id,[...hierarchy,{...hierarchy[0],sheetId:"second"}]).paths,["root.kicad_sch"]);
  assert.deepEqual(relatedSchematicNets(nets,selected.id,[...hierarchy,{path:child.path,target:parent.path,sheetId:"cycle"}]).paths,["root.kicad_sch"]);
  assert.deepEqual(relatedSchematicNets(nets,selected.id,[{...hierarchy[0],sheetId:"wrong"}]).paths,["root.kicad_sch"]);
});

function cachedHarness() {
  const fs=require('node:fs'),vm=require('node:vm'),counts={parse:0,objects:0};
  const context={TextEncoder,Map,Set,WeakMap,KiCadDesignDiff:{...diff,parse(source){counts.parse++;return diff.parse(source);},projectObjects(files,onParsed){counts.objects++;return diff.projectObjects(files,(file,ast)=>{counts.parse++;onParsed?.(file,ast);});}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../net-model.js'),'utf8'),context);
  return {builder:context.KiCadNetModel.createBuilder(),counts};
}
test('workspace net snapshots reuse unchanged files and rebuild only changed source',()=>{
  const h=cachedHarness(),files=Array.from({length:25},(_,i)=>schematic(wire('w',[0,0],[10,0])+label('l','NET'+i,0,0),`sheet${i}.kicad_sch`));
  h.builder.build(files);assert.deepEqual(h.counts,{parse:25,objects:25});
  h.builder.build(files);assert.deepEqual(h.counts,{parse:25,objects:25});
  files[4]={...files[4],content:files[4].content.replace('NET4','UPDATED')};
  const changed=h.builder.build(files);assert.deepEqual(h.counts,{parse:26,objects:26});assert.equal(changed.nets.find(net=>net.path===files[4].path).name,'UPDATED');
  h.builder.clear();h.builder.build(files);assert.deepEqual(h.counts,{parse:51,objects:51});
});
test('workspace net snapshots invalidate replaced primitives and mutated pin connection metadata',()=>{
  const source=schematic('(symbol (lib_id "Test:X") (at 0 0) (uuid "s") (property "Reference" "U1"))'+wire('w',[0,0],[10,0])+label('l','SIGNAL',0,0));
  let pin={kind:'pin',uuid:'s',ownerUuid:'s',pinNumber:'1',connectPoint:{x:0,y:0}};
  const design={primitives:[pin]},designs=new Map([[source.path,design]]),h=cachedHarness();
  const first=h.builder.build([source],designs);assert.equal(first.nets[0].members.filter(member=>member.kind==='pin').length,1);
  h.builder.build([source],designs);assert.equal(h.counts.parse,1);
  pin={...pin,connectPoint:{...pin.connectPoint}};design.primitives[0]=pin;
  const replaced=h.builder.build([source],designs);assert.equal(h.counts.parse,2);assert.equal(replaced.nets[0].primitives[0],pin);
  pin.connectPoint.y=10;const moved=h.builder.build([source],designs);assert.equal(h.counts.parse,3);assert.equal(moved.nets[0].members.filter(member=>member.kind==='pin').length,0);
});
test('workspace snapshots do not retain removed sources or leak caller net mutations',()=>{
  const h=cachedHarness(),a=schematic(wire('a',[0,0],[10,0]),'a.kicad_sch'),b=schematic(wire('b',[0,0],[10,0]),'b.kicad_sch');
  const first=h.builder.build([a,b]);first.nets[0].objectIds.length=0;first.nets[0].stats.lengthMm=999;first.nets[0].members[0].position.x=999;
  const clean=h.builder.build([a,b]);assert.ok(clean.nets[0].objectIds.length);assert.equal(clean.nets[0].stats.lengthMm,10);assert.equal(clean.nets[0].members[0].position.x,0);
  h.builder.build([a]);assert.equal(h.counts.parse,2);h.builder.build([a,b]);assert.equal(h.counts.parse,3);
  assert.throws(()=>h.builder.build([a,a]),/duplicate/);assert.throws(()=>h.builder.build(Array.from({length:129},()=>a)),/Too many/);
});

test("native explicit power flag names and joins separated GND symbols inside one file",()=> {
  const source=powerSource(placedPower("00000000-0000-0000-0000-0000442a4d38",102.87,48.26)+
    placedPower("00000000-0000-0000-0000-0000442a4d3b",87.63,55.88)+
    wire("ground-a",[102.87,48.26],[100,48.26])+wire("ground-b",[87.63,55.88],[85,55.88]));
  const other={...source,path:"other.kicad_sch"},result=build([source,other],schRendered([source,other]));
  assert.equal(result.nets.length,2);
  for (const net of result.nets) {
    assert.equal(net.name,"GND");assert.equal(net.code,"label:GND");assert.equal(net.scope,"file");
    assert.equal(net.members.filter((m)=>m.kind==="pin").length,2);
    assert.deepEqual(net.names,["GND"]);
    assert.ok(net.primitives.some((p)=>p.kind==="symbol" && p.stroke!==false));
  }
});

test("modern power net naming uses saved placed Value even when the library pin name differs",()=> {
  const source=powerSource(placedPower("a",0,0,"RETURN")+placedPower("b",20,0,"RETURN")+
    placedPower("c",40,0,"GND"));
  const result=build([source],schRendered([source]));
  assert.deepEqual(result.nets.map((n)=>[n.name,n.members.length]),[["GND",1],["RETURN",2]]);
});

test("ordinary GND-named symbols and power-output flags never create a named net",()=> {
  const ordinary=powerDefinition("Ordinary:GND",""),flag=powerDefinition("Any:Flag","(power global)","power_out","PWR_FLAG");
  const source=powerSource(placedPower("ordinary",0,0,"GND","Ordinary:GND")+
    placedPower("flag",20,0,"PWR_FLAG","Any:Flag")+wire("a",[0,0],[10,0])+wire("b",[20,0],[30,0]),ordinary+flag);
  const result=build([source],schRendered([source]));
  assert.equal(result.nets.length,2);
  assert.ok(result.nets.every((n)=>n.names.length===0 && n.name.startsWith("Unnamed network")));
});

test("legacy power symbols use hidden pin names and unknown versions decline naming",()=> {
  const legacy=powerSource(placedPower("a",0,0,"Different value"),powerDefinition("pic_programmer:GND","(power)"),20211123);
  assert.equal(build([legacy],schRendered([legacy])).nets[0].name,"GND");
  const uncertain=powerSource(placedPower("a",0,0,"GND")+wire("a",[0,0],[10,0]),powerDefinition(),0);
  const result=build([uncertain],schRendered([uncertain]));
  assert.ok(result.nets[0].name.startsWith("Unnamed network"));
  assert.match(result.warnings.join(" "),/unproven schematic version/);
});

test("connected aliases are retained and native name priority prefers global then power labels",()=> {
  const source=powerSource(placedPower("p",0,0,"Z_POWER")+wire("a",[0,0],[10,0])+
    label("local","A_LOCAL",10,0)+label("global","B_GLOBAL",5,0,"global_label"));
  const result=build([source],schRendered([source]));
  assert.equal(result.nets.length,1);
  assert.equal(result.nets[0].name,"B_GLOBAL");
  assert.equal(result.nets[0].code,"label:A_LOCAL"); // Canonical alias identity remains deterministic.
  assert.deepEqual(result.nets[0].names,["A_LOCAL","B_GLOBAL","Z_POWER"]);
  assert.match(result.warnings.join(" "),/multiple labels/);
  const powerOverLocal=powerSource(placedPower("p",0,0,"Z_POWER")+wire("a",[0,0],[10,0])+label("local","A_LOCAL",10,0));
  assert.equal(build([powerOverLocal],schRendered([powerOverLocal])).nets[0].name,"Z_POWER");
});

test('repeated sheet descendants and cycles stay excluded while duplicate identical links are allowed',()=>{
  const net=(path,id,pins=[],names=[])=>({path,id,kind:'schematic',sheetPins:pins,hierarchicalNames:names,globalNames:[]});
  const nets=[net('a','a',[{sheetId:'ab',name:'S'}]),net('b','b',[{sheetId:'bc',name:'S'}],['S']),net('c','c',[],['S']),net('x','x')];
  const links=[{path:'a',target:'b',sheetId:'ab'},{path:'b',target:'c',sheetId:'bc'}];
  assert.deepEqual(relatedSchematicNets(nets,'a',[...links,{...links[0]}]).paths,['a','b','c']);
  const repeated=[...links,{path:'x',target:'b',sheetId:'xb'}];
  assert.deepEqual(relatedSchematicNets(nets,'b',repeated).paths,['b']);
  assert.deepEqual(relatedSchematicNets(nets,'c',repeated).paths,['c']);
  assert.deepEqual(relatedSchematicNets(nets,'a',[...links,{path:'c',target:'a',sheetId:'ca'}]).paths,['a']);
  // Public inputs are mutable; each call must use current saved link evidence.
  links[0].sheetId='wrong';assert.deepEqual(relatedSchematicNets(nets,'a',links).paths,['a']);
  links[0].sheetId='ab';nets[1].hierarchicalNames[0]='different';
  assert.deepEqual(relatedSchematicNets(nets,'a',links).paths,['a']);
});

test('global name expansion retains transitive alias closure and exact case',()=>{
  const nets=Array.from({length:1000},(_,i)=>({id:String(i),path:'sheet'+i,kind:'schematic',globalNames:['COMMON']}));
  nets[50].globalNames.push('ALIAS');nets.push({id:'alias',path:'z',kind:'schematic',globalNames:['ALIAS']},{id:'case',path:'zz',kind:'schematic',globalNames:['common']});
  const result=relatedSchematicNets(nets,'0');assert.equal(result.matches.length,1001);
  assert.ok(result.matches.some(n=>n.id==='alias'));assert.ok(!result.matches.some(n=>n.id==='case'));
});


test('display names use saved labels and PCB names without replacing internal net identities',()=>{
 const fs=[schematic(wire('95e84e92-806d-4809-ad70-48202504e491',[0,0],[10,0])+label('label-id','SENSOR_ENABLE',10,0)),board('(net 12 "/Power/+3V3") (segment (start 0 0) (end 1 0) (net 12) (uuid "track"))')];
 const {nets}=build(fs);
 const schematicNet=nets.find(n=>n.kind==='schematic'),pcbNet=nets.find(n=>n.kind==='pcb');
 assert.equal(schematicNet.displayName,'SENSOR_ENABLE');assert.equal(schematicNet.name,'SENSOR_ENABLE');assert.equal(schematicNet.code,'label:SENSOR_ENABLE');
 assert.equal(pcbNet.displayName,'/Power/+3V3');assert.equal(pcbNet.code,'12');assert.match(pcbNet.id,/net:12$/);
});

test('attached sheet-pin labels name the display without joining unrelated child ports',()=>{
 const port=(id,x)=>`(sheet (at ${x} 0) (size 10 10) (uuid "${id}") (property "Sheetname" "Child") (property "Sheetfile" "child.kicad_sch") (pin "ENABLE" input (at ${x} 0 180) (uuid "${id}-pin")))`;
 const source=schematic(wire('parent-wire-a',[0,0],[10,0])+port('sheet-a',10)+wire('parent-wire-b',[30,0],[40,0])+port('sheet-b',40));
 const {nets}=build([source]);assert.equal(nets.length,2);assert.equal(new Set(nets.map(n=>n.id)).size,2);
 assert.deepEqual(nets.map(n=>n.displayName),['ENABLE','ENABLE']);assert.ok(nets.every(n=>n.names.length===0));
 assert.ok(nets.every(n=>n.name.startsWith('Unnamed network (parent-wire-')));
 const labelled=schematic(wire('wire',[0,0],[10,0])+port('sheet',10)+label('label','ACTUAL_LABEL',0,0));
 assert.equal(build([labelled]).nets[0].displayName,'ACTUAL_LABEL','an explicit wire label has display priority over sheet-pin text');
});

test('unlabelled UUID networks have honest readable display names and keep pin context where available',()=>{
 const uuid='95e84e92-806d-4809-ad70-48202504e491',source=schematic(wire(uuid,[0,0],[10,0])+'(symbol (lib_id "Device:R") (at 0 0) (uuid "resistor") (property "Reference" "R7"))'+wire('second-wire',[30,0],[40,0]));
 const design={primitives:[{kind:'pin',uuid:'resistor',ownerUuid:'resistor',pinNumber:'2',connectPoint:{x:0,y:0}}]};
 const {nets}=build([source],new Map([[source.path,design]])),net=nets.find(n=>n.uuids.includes(uuid)),other=nets.find(n=>n.uuids.includes('second-wire'));
 assert.equal(net.displayName,'Unnamed network · R7 pin 2');assert.equal(other.displayName,'Unnamed network');
 assert.match(net.name,new RegExp(uuid));assert.ok(net.id.includes(uuid));assert.notEqual(net.id,other.id);
 const {displayName}=require('../net-model.js');assert.equal(displayName(net),net.displayName);
 assert.equal(displayName({kind:'schematic',name:`Unnamed network (${uuid})`}), 'Unnamed network');
 assert.equal(displayName({kind:'pcb',name:uuid}),uuid,'a saved PCB name must not be guessed away simply because it resembles an ID');
});
