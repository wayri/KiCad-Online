const test=require('node:test');const assert=require('node:assert/strict');const {parse}=require('../design-diff.js');const {solveBoard}=require('../fast-pi.js');
const copper=(layer,y=0)=>`(zone (net 1) (layer "${layer}") (filled_polygon (layer "${layer}") (pts (xy 0 ${y}) (xy 10 ${y}) (xy 10 ${y+1}) (xy 0 ${y+1}))))`;
const board=(body)=>parse(`(kicad_pcb ${body})`);
const options=()=>({net:1,layers:[{name:'F.Cu',zMm:0,thicknessMm:.035}],conductivitySm:58000000,cellSizeMm:1,currentA:2,sourceVoltageV:5,source:{x:.5,y:.5,layer:'F.Cu'},sink:{x:9.5,y:.5,layer:'F.Cu'}});
const near=(a,b,rtol=1e-7)=>assert.ok(Math.abs(a-b)<=rtol*Math.max(Math.abs(b),1e-12),`${a} != ${b}`);
test('uniform strip agrees with rho L/A and conserves current and power',()=>{const o=options(),result=solveBoard(board(copper('F.Cu')),o),R=.009/(o.conductivitySm*.001*.000035);near(result.resistanceOhm,R);near(result.dropV,2*R);near(result.lossW,4*R);near(result.voltageV,5-2*R);for(const edge of result.edges){near(edge.currentA,2);near(edge.currentDensityAm2,2/(.001*.000035));}assert.ok(result.residualA<1e-8);});
test('trace strip matches zone strip independent reference',()=>{const o=options(),result=solveBoard(board('(segment (net 1) (start .5 .5) (end 9.5 .5) (width 1) (layer "F.Cu"))'),o);near(result.resistanceOhm,.009/(58000000*.001*.000035));});
test('unrelated copper net is not included',()=>{const o=options(),result=solveBoard(board(copper('F.Cu')+' (segment (net 2) (start .5 .5) (end 9.5 .5) (width 20) (layer "F.Cu"))'),o);near(result.resistanceOhm,.009/(58000000*.001*.000035));});
test('source voltage offset changes absolute voltage but not drop or loss',()=>{const o=options(),a=solveBoard(board(copper('F.Cu')),o),b=solveBoard(board(copper('F.Cu')),{...o,sourceVoltageV:-12});near(a.dropV,b.dropV);near(a.lossW,b.lossW);near(b.voltageV,a.voltageV-17);});
test('disconnected islands do not acquire made-up voltages',()=>{const o=options(),a=solveBoard(board(copper('F.Cu')+copper('F.Cu',5)),o);assert.equal(a.unconnectedCells,10);assert.equal(a.nodes.filter(n=>n.voltageV===null).length,10);assert.throws(()=>solveBoard(board(copper('F.Cu')+copper('F.Cu',5)),{...o,sink:{x:.5,y:5.5,layer:'F.Cu'}}),/disconnected/);});
test('missing material, stackup and unsupported selected geometry are rejected',()=>{const ast=board(copper('F.Cu')),o=options();assert.throws(()=>solveBoard(ast,{...o,conductivitySm:undefined}),/conductivity/);assert.throws(()=>solveBoard(ast,{...o,layers:[]}),/stackup/);assert.throws(()=>solveBoard(board('(arc (net 1) (start 0 0) (mid 1 1) (end 2 0) (layer "F.Cu"))'),o),/arc tracks/);assert.throws(()=>solveBoard(board('(zone (net 1) (layer "F.Cu"))'),o),/unfilled zone/);assert.throws(()=>solveBoard(ast,{...o,cellSizeMm:.00001}),/budget/);});
test('two layers connected by explicit barrel obey Ohm law and positive loss',()=>{const o={...options(),layers:[{name:'F.Cu',zMm:0,thicknessMm:.035},{name:'B.Cu',zMm:1.6,thicknessMm:.035}],viaPlatingMm:.025,source:{x:.5,y:.5,layer:'F.Cu'},sink:{x:.5,y:.5,layer:'B.Cu'}},ast=board(copper('F.Cu')+copper('B.Cu')+' (via (net 1) (at .5 .5) (size 2) (drill .2) (layers "F.Cu" "B.Cu"))'),r=solveBoard(ast,o),edge=r.edges.find(e=>e.kind==='via');near(edge.currentA,2,1e-6);const expected=.0016/(58000000*Math.PI*(.125**2-.1**2)*1e-6);near(1/edge.g,expected);near(r.lossW,r.dropV*2,1e-6);assert.throws(()=>solveBoard(ast,{...o,viaPlatingMm:undefined}),/plating/);});

test('Kirchhoff current balance holds at every solved nonterminal node',()=>{const o=options(),ast=board('(zone (net 1) (layer "F.Cu") (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy 10 0) (xy 10 4) (xy 0 4))))'),r=solveBoard(ast,o),balance=r.nodes.map(()=>0);for(const e of r.edges){balance[e.a]+=e.currentA;balance[e.b]-=e.currentA;}for(let i=0;i<balance.length;i++){const expected=i===r.sourceIndex?2:i===r.sinkIndex?-2:0;assert.ok(Math.abs(balance[i]-expected)<1e-7);}near(r.lossW,r.dropV*2);});

test('global pad rotation is independent of native clockwise footprint rotation and PTH connects layers',()=>{const o={...options(),source:{x:5,y:-5.5,layer:'F.Cu'},sink:{x:5,y:3.5,layer:'F.Cu'}},ast=board('(footprint "x" (at 5 0 90) (pad "1" smd rect (at 1 0 90) (size 10 1) (layers "F.Cu") (net 1 "VCC")))'),r=solveBoard(ast,o);near(r.resistanceOhm,.009/(58000000*.001*.000035));
const pth=board('(footprint "x" (at .5 .5) (pad "1" thru_hole circle (at 0 0) (size 2 2) (drill .2) (layers "*.Cu") (net 1 "VCC")))'),p=solveBoard(pth,{...options(),layers:[{name:'F.Cu',zMm:0,thicknessMm:.035},{name:'B.Cu',zMm:1.6,thicknessMm:.035}],viaPlatingMm:.025,sink:{x:.5,y:.5,layer:'B.Cu'}});assert.equal(p.edges.filter(e=>e.kind==='via').length,1);near(p.lossW,2*p.dropV);});
test('strip analytical solution is preserved across three grid resolutions',()=>{for(const step of [1,.5,.25]){const o={...options(),cellSizeMm:step,source:{x:step/2,y:step/2,layer:'F.Cu'},sink:{x:9+step/2,y:step/2,layer:'F.Cu'}},ast=board(`(zone (net 1) (layer "F.Cu") (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy ${9+step} 0) (xy ${9+step} ${step}) (xy 0 ${step}))))`),r=solveBoard(ast,o);near(r.resistanceOhm,.009/(58000000*step*.001*.000035));}});
test('gap between occupied cell centers is not electrically bridged',()=>{const ast=board('(zone (net 1) (layer "F.Cu") (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy .9 0) (xy .9 1) (xy 0 1)))) (zone (net 1) (layer "F.Cu") (filled_polygon (layer "F.Cu") (pts (xy 1.1 0) (xy 2 0) (xy 2 1) (xy 1.1 1))))');assert.throws(()=>solveBoard(ast,{...options(),sink:{x:1.5,y:.5,layer:'F.Cu'}}),/disconnected/);});
test('a nearby point off the selected copper cannot silently become a contact',()=>{const ast=board(copper('F.Cu'));assert.throws(()=>solveBoard(ast,{...options(),source:{x:.5,y:-.1,layer:'F.Cu'}}),/selected net copper/);});
test('KiCad 10 saved named-net strip solves against rho L/A within an interactive work budget',()=>{
 const fs=require('node:fs'),{performance}=require('node:perf_hooks'),{savedStackup}=require('../fast-pi-workspace.js'),ast=parse(fs.readFileSync(require.resolve('./fixtures/fast-pi/dc-strip.kicad_pcb'),'utf8'));
 const start=performance.now(),r=solveBoard(ast,{...options(),net:'VCC',layers:savedStackup(ast)}),elapsed=performance.now()-start;
 near(r.resistanceOhm,.009/(58000000*.001*.000035));near(r.lossW,r.currentA*r.dropV);assert.ok(r.residualA<2e-8);assert.ok(elapsed<5000,'small saved fixture must finish within 5s');
});

test('a small rail remains solvable in a large board with unrelated records and remote drill holes',()=>{
 const ast=board(copper('F.Cu')),unrelated=board('(segment (net 2) (start 100 100) (end 101 100) (width .2) (layer "F.Cu"))')[1];
 ast.push(...Array(31000).fill(unrelated));
 const via=board('(via (net 2) (at 100 100) (size .6) (drill .3) (layers "F.Cu" "B.Cu"))')[1];ast.push(...Array(1100).fill(via));
 ast.push(board('(footprint "remote-slot" (at 100 100 90) (pad "1" thru_hole oval (at 0 0 90) (size 5 2) (drill oval 4 1) (layers "*.Cu") (net 2)))')[1]);
 const layers=Array.from({length:12},(_,i)=>({name:i===0?'F.Cu':i===11?'B.Cu':`In${i}.Cu`,zMm:i*.14,thicknessMm:.035}));
 const r=solveBoard(ast,{...options(),layers});near(r.resistanceOhm,.009/(58000000*.001*.000035));assert.equal(r.nodes.length,10);assert.ok(r.edges.every(edge=>edge.kind==='sheet'));
});

test('unselected rotated slots and offset round holes remain physical copper voids',()=>{
 const {createContactValidator}=require('../fast-pi.js');
 const slot=board(copper('F.Cu')+' (footprint "slot" (at 5 2 90) (pad "1" thru_hole oval (at 1 0 90) (size 5 2) (drill oval 4 .4) (layers "*.Cu") (net 2)))');
 const accepts=createContactValidator(slot,1,options().layers);
 assert.equal(accepts({x:5,y:.5,layer:'F.Cu'}),false,'rotated slot crosses the strip');assert.equal(accepts({x:4.5,y:.5,layer:'F.Cu'}),true);
 assert.throws(()=>solveBoard(slot,options()),/disconnected/,'edge checks cannot electrically bridge the slot');
 const offset=board(copper('F.Cu')+' (footprint "offset" (at 5 2 90) (pad "1" np_thru_hole circle (at 1 0 90) (size 1 1) (drill .4 (offset .5 0)) (layers "*.Cu")))');
 const offsetAccepts=createContactValidator(offset,1,options().layers);assert.equal(offsetAccepts({x:5,y:.5,layer:'F.Cu'}),false,'pad-local offset rotates to global drill center');assert.equal(offsetAccepts({x:5.5,y:.5,layer:'F.Cu'}),true);
 assert.throws(()=>createContactValidator(slot,2,options().layers),/selected slotted drilled pads.*barrel resistance is not modeled/);
});

test('native Marble USB regulator pad meets its saved track endpoint after clockwise footprint rotation',()=>{
 const ast=board('(version 20211014) (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) (net 312 "+1V8_USB") '+
  '(footprint "U23" (at 152.146 115.57) (pad "43" smd roundrect (at 3.25 3.95 270) (size .85 .3) (layers "B.Cu") (roundrect_rratio .5) (net 312))) '+
  '(footprint "C173" (at 156.21 122.174 -90) (pad "1" smd rect (at -.75 0 180) (size 1 .95) (layers "B.Cu") (uuid "cap-pad") (net 312))) '+
  '(segment (start 155.396 120.61) (end 156.21 121.424) (width .381) (layer "B.Cu") (net 312)) '+
  '(segment (start 155.396 119.52) (end 155.396 120.61) (width .381) (layer "B.Cu") (net 312))');
 const {createContactValidator}=require('../fast-pi.js'),renderer=require('../pcb-renderer.js'),layers=[{name:'F.Cu',zMm:0,thicknessMm:.035},{name:'B.Cu',zMm:1.544994,thicknessMm:.035}],accepts=createContactValidator(ast,312,layers);
 const pad=renderer.build(ast,'Marble-excerpt.kicad_pcb').primitives.find(p=>p.uuid==='cap-pad'&&p.type==='pad');assert.deepEqual(pad.padCenter,{x:156.21,y:121.424});
 assert.equal(accepts({...pad.padCenter,layer:'B.Cu'}),true);assert.equal(accepts({x:156.21,y:122.924,layer:'B.Cu'}),false,'counterclockwise location is not this net');
 const result=solveBoard(ast,{...options(),net:312,layers,sourceVoltageV:1.8,currentA:.1,cellSizeMm:.05,source:{x:155.396,y:119.52,layer:'B.Cu'},sink:{...pad.padCenter,layer:'B.Cu'}});assert.ok(result.dropV>0);assert.ok(result.residualA<=1e-9);near(result.lossW,result.dropV*.1);
});

test('adaptive solve refines unresolved terminals without changing electrical inputs or acceptance checks',()=>{
 const {solveAdaptive}=require('../fast-pi.js'),ast=board(copper('F.Cu')),o={...options(),source:{x:.4,y:.5,layer:'F.Cu'},sink:{x:.6,y:.5,layer:'F.Cu'}};
 assert.throws(()=>solveBoard(ast,o),/same cell/);const result=solveAdaptive(ast,o);
 assert.equal(result.meshAttempts,2);assert.equal(result.cellSizeMm,.5);assert.equal(result.requestedCellSizeMm,1);
 const reference=solveBoard(ast,{...o,cellSizeMm:.5});near(result.dropV,reference.dropV);near(result.lossW,result.dropV*o.currentA);assert.equal(o.cellSizeMm,1);assert.match(result.warnings[0],/automatic mesh refinement/);
});
test('adaptive solve still rejects disconnected islands, off-copper contacts and missing physical inputs',()=>{
 const {solveAdaptive}=require('../fast-pi.js'),ast=board(copper('F.Cu')+copper('F.Cu',5));
 assert.throws(()=>solveAdaptive(ast,{...options(),sink:{x:.5,y:5.5,layer:'F.Cu'}}),/three mesh resolutions.*No result accepted/);
 assert.throws(()=>solveAdaptive(ast,{...options(),conductivitySm:undefined}),/conductivity/);
 assert.throws(()=>solveAdaptive(ast,{...options(),source:{x:.5,y:-.1,layer:'F.Cu'}}),/selected net copper/);
});

test('constant power selects the high-voltage strip operating point and conserves terminal and copper power',()=>{
 const {solveAdaptive}=require('../fast-pi.js'),o=options(),{currentA,...powerOptions}=o,ast=board(copper('F.Cu')),P=100,R=.009/(o.conductivitySm*.001*.000035),expectedVoltage=(5+Math.sqrt(25-4*R*P))/2;
 const r=solveAdaptive(ast,{...powerOptions,loadPowerW:P});
 near(r.voltageV,expectedVoltage);near(r.currentA,P/expectedVoltage);near(r.voltageV*r.currentA,P);near(r.lossW,R*r.currentA**2);near(5*r.currentA,P+r.lossW);near(r.resistanceOhm,R);
 assert.equal(r.loadMode,'power');assert.equal(r.operatingPoint,'high-voltage');assert.equal(r.loadPowerW,P);assert.equal(r.requestedLoadPowerW,P);assert.equal(r.meshAttempts,1);assert.ok(r.voltageV>2.5);assert.ok(r.currentA>P/5,'uses load voltage, not nominal source voltage');assert.ok(r.residualA<=r.currentA*1e-8);
 for(const edge of r.edges)near(edge.currentA,r.currentA);assert.equal(r.nodes[r.sourceIndex].voltageV,5);
 const direct=solveBoard(ast,{...o,currentA:r.currentA});near(r.dropV,direct.dropV);near(r.lossW,direct.lossW);for(let i=0;i<r.nodes.length;i++)near(r.nodes[i].voltageV,direct.nodes[i].voltageV);
});
test('constant power rejects collapse and accepts a resolvable point just below the fold',()=>{
 const {solveAdaptive}=require('../fast-pi.js'),{currentA,...o}=options(),ast=board(copper('F.Cu')),R=.009/(o.conductivitySm*.001*.000035),limit=25/(4*R);
 for(const power of [limit,limit*(1-1e-13),limit*1.0001,Number.MAX_VALUE])assert.throws(()=>solveAdaptive(ast,{...o,loadPowerW:power}),/voltage-collapse limit/);
 const r=solveAdaptive(ast,{...o,loadPowerW:limit*(1-1e-6)});near(r.voltageV,2.5*(1+.001),1e-9);near(r.voltageV*r.currentA,r.loadPowerW);assert.ok(r.residualA<=r.currentA*1e-8);
});
test('power input is explicit and unambiguous while legacy current voltage semantics remain intact',()=>{
 const {solveAdaptive}=require('../fast-pi.js'),{currentA,...o}=options(),ast=board(copper('F.Cu'));
 assert.throws(()=>solveAdaptive(ast,{...o,currentA:2,loadPowerW:10}),/either currentA or loadPowerW/);
 for(const value of [0,-1,NaN,Infinity,null]){assert.throws(()=>solveAdaptive(ast,{...o,loadPowerW:value}),/load power/);assert.throws(()=>solveAdaptive(ast,{...o,loadPowerW:10,sourceVoltageV:value}),/source voltage/);}
 assert.throws(()=>solveAdaptive(ast,o),/sink current/);assert.throws(()=>solveBoard(ast,{...o,loadPowerW:10}),/Use solveAdaptive/);
 for(const voltage of [0,-12]){const r=solveAdaptive(ast,{...o,currentA:2,sourceVoltageV:voltage});assert.equal(r.loadMode,'current');near(r.voltageV,voltage-r.dropV);}
});
test('constant power retains mesh recovery, island isolation and contact rejection',()=>{
 const {solveAdaptive}=require('../fast-pi.js'),{currentA,...o}=options(),ast=board(copper('F.Cu')+copper('F.Cu',5));
 const r=solveAdaptive(ast,{...o,loadPowerW:10,source:{x:.4,y:.5,layer:'F.Cu'},sink:{x:.6,y:.5,layer:'F.Cu'}});
 assert.equal(r.meshAttempts,2);assert.equal(r.cellSizeMm,.5);near(r.voltageV*r.currentA,10);assert.ok(r.nodes.some(node=>node.voltageV===null));assert.match(r.warnings[0],/automatic mesh refinement/);
 assert.throws(()=>solveAdaptive(ast,{...o,loadPowerW:10,sink:{x:.5,y:5.5,layer:'F.Cu'}}),/three mesh resolutions/);
 assert.throws(()=>solveAdaptive(ast,{...o,loadPowerW:10,source:{x:.5,y:-.1,layer:'F.Cu'}}),/selected net copper/);
});
test('constant power handles negligible resistance and large finite voltages without squaring source voltage',()=>{
 const {solveAdaptive}=require('../fast-pi.js'),{currentA,...o}=options(),ast=board(copper('F.Cu'));
 const negligible=solveAdaptive(ast,{...o,conductivitySm:1e150,loadPowerW:10});near(negligible.currentA,2);assert.ok(negligible.resistanceOhm>0);assert.ok(negligible.dropV>0);near(negligible.voltageV*negligible.currentA,10);
 const large=solveAdaptive(ast,{...o,sourceVoltageV:1e155,loadPowerW:1e308});near(large.voltageV*large.currentA,1e308);assert.ok(Number.isFinite(large.lossW));assert.ok(large.voltageV>5e154);
 assert.throws(()=>solveAdaptive(ast,{...o,sourceVoltageV:1e308,loadPowerW:Number.MIN_VALUE}),/outside numerical range/);
});
