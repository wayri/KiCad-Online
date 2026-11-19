const test=require('node:test'),assert=require('node:assert/strict');
const diff=require('../design-diff.js'),paired=require('../paired-review.js');
const source=`(kicad_pcb (footprint "Device:R" (tstamp fp-old) (path "/root/sheet/symbol") (property "Reference" "R1") (pad "1" smd rect (tstamp pad-old))))`;
test('tstamp-era owner parser geometry regains exact native pad and schematic identities',async()=>{
 const {sourceSelectionRecords}=await import('../spike/sourceSelection.mjs');
 const board={components:[{id:'fp-old',ref:'R1'}],pads:[{id:'pad-old',ref:'R1',name:'1',at:[2,3],width:1,height:1}]};
 const result=sourceSelectionRecords(diff.parse(source),board);
 assert.deepEqual(result.components[0],{...board.components[0],uuid:'fp-old',tstampPath:'/root/sheet/symbol',symbolUuid:'symbol'});
 assert.equal(result.pads[0].uuid,'pad-old');assert.equal(result.pads[0].ownerUuid,'fp-old');assert.equal(result.pads[0].pinNumber,'1');assert.deepEqual(result.pads[0].at,[2,3]);
 const {selectableRecord,selectionMatcher}=await import('../spike/selectionState.mjs');
 assert.equal(selectableRecord(result.pads[0],'pin'),true);assert.equal(selectableRecord(result.components[0],'pin'),false);
 const match=selectionMatcher({uuids:['pad-old']},result);assert.equal(match(result.pads[0]),true);assert.equal(match(result.components[0]),false);
});
test('duplicate saved tstamp records never acquire another native identity',async()=>{
 const {sourceSelectionRecords}=await import('../spike/sourceSelection.mjs');
 const footprint=source.slice(source.indexOf('(footprint'),-1),ast=diff.parse('(kicad_pcb '+footprint+' '+footprint+')');
 const result=sourceSelectionRecords(ast,{components:[{id:'fp-old',ref:'R1'}],pads:[{id:'pad-old',name:'1'}]});
 assert.equal(result.components[0].uuid,undefined);assert.equal(result.pads[0].uuid,undefined);
});

test('UUID-less pad names come only from saved pinfunction, never pad technology',async()=>{
 const {sourceSelectionRecords}=await import('../spike/sourceSelection.mjs');
 const ast=diff.parse('(kicad_pcb (footprint "LED" (property "Reference" "D1") (pad "A12" smd rect) (pad "B12" smd rect (pinfunction "K"))))');
 const board={components:[],pads:[{id:'display-pad:0:0',name:'A12',pinName:'smd'},{id:'display-pad:0:1',name:'B12',pinName:'smd'},{id:'unmatched-unnumbered-pad',name:'np_thru_hole',pinName:'smd'}]};
 const result=sourceSelectionRecords(ast,board);
 assert.equal(result.pads[0].pinNumber,'A12');assert.equal(result.pads[0].pinName,'');
 assert.equal(result.pads[1].pinNumber,'B12');assert.equal(result.pads[1].pinName,'K');
 assert.equal(result.pads[2].pinNumber,'');assert.equal(result.pads[2].pinName,'');
 assert.equal(board.pads[0].pinName,'smd');
});
test('full schematic instance path separates identical symbol UUIDs in different files',()=>{
 const symbol=(path,context)=>({kind:'symbol',reference:'R1',uuid:'symbol',path,saved:{tree:['symbol',['instances',['project','project',['path',{quoted:context},['reference','R1']]]]]}});
 const a=symbol('a.kicad_sch','/root/a'),b=symbol('b.kicad_sch','/root/b');
 const selection={kind:'part',path:'board.kicad_pcb',reference:'R1',symbolUuid:'symbol',tstampPath:'/root/b/symbol'};
 assert.equal(paired.relatedPart([a,b],selection).object,b);
 assert.match(paired.relatedPart([a,b],{...selection,tstampPath:'/root/other/symbol'}).error,/does not match/);
 assert.equal(paired.validSelection({...selection,tstampPath:'/root/../symbol'}),false);
 assert.equal(paired.validSelection({...selection,tstampPath:'/root/b/different'}),false);
 assert.equal(paired.partSelection(b).tstampPath,'/root/b/symbol');
});
test('missing placement metadata cannot guess a reused sheet from UUID or reference',()=>{
 const symbol={kind:'symbol',reference:'R1',uuid:'symbol',path:'child.kicad_sch',saved:{tree:['symbol']}},parents=['A','B'].map(Sheetname=>({kind:'sheet',path:'root.kicad_sch',properties:{Sheetfile:'child.kicad_sch',Sheetname}}));
 const selection={kind:'part',path:'board.kicad_pcb',reference:'R1',symbolUuid:'symbol'};
 assert.match(paired.relatedPart([symbol,...parents],selection).error,/Multiple saved/);
 assert.match(paired.relatedPart([symbol,...parents],{...selection,tstampPath:'/root/A/symbol'}).error,/does not match/);
});

test('Marble J10 retains each saved oval slot when shield pads share a number', async () => {
 const {savedObjectId}=await import('../spike/sourceIdentity.mjs');
 const {sourceSelectionRecords}=await import('../spike/sourceSelection.mjs');
 const {padSourceDetails}=await import('../spike/padGeometry.mjs');
 const {smoothPadOutline}=await import('../spike/copperGeometry.mjs');
 const slots=[
  ['0912984c-b7cb-473e-8bf6-832c3d93582a',1.7,1.35,1.2,.7],
  ['43de8a02-0091-4493-8d6c-b7694d4f771b',1.5,1.1,1.05,.65],
  ['ac00846f-3592-46d1-a0d3-583a2913fde1',1.7,1.35,1.2,.7],
  ['dc42f28a-ba75-4fd6-a78e-639554250312',1.5,1.1,1.05,.65],
 ];
 const footprint=diff.parse(`(footprint "USB" (tstamp j10) (layer "B.Cu")
   (property "Reference" "J10")
   ${slots.map(([id,w,h,dw,dh])=>`(pad "6" thru_hole oval (size ${w} ${h}) (drill oval ${dw} ${dh}) (layers "*.Cu" "*.Mask") (tstamp ${id}))`).join(' ')}
   (pad "6" smd rect (size 1.35 2) (layers "B.Cu") (uuid shield-smd) (tstamp stale-smd)))`);
 const ast=['kicad_pcb',footprint];
 const pads=footprint.filter(node=>Array.isArray(node)&&node[0]==='pad').map(node=>{
  const [width,height]=node.find(item=>Array.isArray(item)&&item[0]==='size').slice(1);
  return {id:savedObjectId(node),shape:node[3],width,height};
 });
 assert.deepEqual(pads.map(pad=>pad.id),[...slots.map(slot=>slot[0]),'shield-smd']);
 const details=padSourceDetails(ast);
 const records=sourceSelectionRecords(ast,{pads});
 for (const [id,,,drillWidth,drillHeight] of slots) {
  const pad={...records.pads.find(record=>record.id===id),...details.get(id)};
  assert.equal(pad.pinNumber,'6');
  assert.equal(pad.ownerUuid,'j10');
  assert.deepEqual([pad.drillShape,pad.drillWidth,pad.drillHeight],['oval',drillWidth,drillHeight]);
  assert.ok(smoothPadOutline(pad)?.drill);
 }
 assert.equal(details.get('shield-smd').drillShape,undefined);
});

test('missing pad IDs remain distinct across duplicate pin numbers and modules', async () => {
 const {padOccurrenceId}=await import('../spike/sourceIdentity.mjs');
 const {sourceSelectionRecords}=await import('../spike/sourceSelection.mjs');
 const {padSourceDetails}=await import('../spike/padGeometry.mjs');
 const ast=diff.parse(`(kicad_pcb
  (footprint "USB" (tstamp j1-old) (fp_text reference "J1") (pad "6" smd rect) (pad "6" thru_hole oval (drill oval 1.2 .7)))
  (module "USB" (fp_text reference "J2") (pad "6" thru_hole oval (drill oval 1.05 .65))))`);
 const ids=[padOccurrenceId(0,0),padOccurrenceId(0,1),padOccurrenceId(1,0)];
 assert.equal(new Set(ids).size,3);
 const records=sourceSelectionRecords(ast,{pads:ids.map(id=>({id}))}).pads;
 assert.deepEqual(records.map(pad=>pad.pinNumber),['6','6','6']);
 assert.ok(records.every(pad=>pad.uuid===undefined));
 assert.deepEqual(records.map(pad=>pad.ownerUuid),['j1-old','j1-old',undefined]);
 const details=padSourceDetails(ast);
 assert.deepEqual(ids.map(id=>details.get(id).drillWidth),[undefined,1.2,1.05]);
});
