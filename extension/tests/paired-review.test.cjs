const test=require('node:test'),assert=require('node:assert/strict');
const {validSelection,relatedPart,symbolUuid,qualifiedNetName,netSelection,groupSelection,relatedNet,relatedGroup}=require('../paired-review.js');
const part=(kind,ref,uuid,path='root.kicad_sch',linked)=>({kind,reference:ref,uuid,path,saved:{tree:[kind,...(linked?[["path",{quoted:'/root/'+linked}]]:[])]}});
test('individual geometry identities require a safe source path and exact UUID only',()=>{
 assert.equal(validSelection({kind:'object',path:'board.kicad_pcb',uuid:'via-1'}),true);
 for(const value of [{kind:'object',path:'../board.kicad_pcb',uuid:'via-1'},{kind:'object',path:'board.kicad_pcb'},{kind:'object',path:'board.kicad_pcb',uuid:'via-1',netName:'VCC'}])assert.equal(validSelection(value),false);
});
test('cross-probing prefers saved PCB schematic identity over renamed reference',()=>{
 const fp=part('footprint','R9','fp','board.kicad_pcb','sym');
 assert.equal(symbolUuid(fp),'sym');
 assert.equal(relatedPart([fp],{kind:'part',path:'root.kicad_sch',reference:'R1',uuid:'sym'}).object,fp);
 const sym=part('symbol','R1','sym');
 assert.equal(relatedPart([sym],{kind:'part',path:'board.kicad_pcb',reference:'R9',symbolUuid:'sym'}).object,sym);
});
test('saved sheet names cross-highlight qualified PCB nets in both directions',()=>{
 const objects=[{kind:'sheet',path:'design/root.kicad_sch',properties:{Sheetname:'Power supply',Sheetfile:'sub/power.kicad_sch'}}];
 const schematic={kind:'schematic',path:'design/sub/power.kicad_sch',name:'ENABLE',names:['ENABLE']};
 const pcb={kind:'pcb',path:'design/main.kicad_pcb',name:'/Power supply/ENABLE'};
 assert.equal(qualifiedNetName(schematic,objects),'/Power supply/ENABLE');
 assert.equal(relatedNet([pcb],[],{kind:'net',path:schematic.path,netName:'ENABLE',qualifiedNetName:qualifiedNetName(schematic,objects)},pcb.path).net,pcb);
 assert.equal(relatedNet([schematic],objects,{kind:'net',path:pcb.path,netName:pcb.name},'design/root.kicad_sch').net,schematic);
});
test('net cross-highlight refuses reused sheets and same-named ambiguous targets',()=>{
 const objects=['A','B'].map(Sheetname=>({kind:'sheet',path:'root.kicad_sch',properties:{Sheetname,Sheetfile:'child.kicad_sch'}}));
 const a={kind:'schematic',path:'child.kicad_sch',name:'BUS'},b={...a,path:'other.kicad_sch'};
 assert.equal(qualifiedNetName(a,objects),null);
 assert.match(relatedNet([a,b],objects,{kind:'net',path:'board.kicad_pcb',netName:'BUS'},'root.kicad_sch').error,/ambiguous/);
 assert.match(relatedNet([{kind:'pcb',name:'BUS'},{kind:'pcb',name:'/A/BUS'}],[],{kind:'net',path:'child.kicad_sch',netName:'BUS',qualifiedNetName:'/A/BUS'}).error,/ambiguous/);
 assert.match(relatedNet([a],objects,{kind:'net',path:'board.kicad_pcb',netName:'/A/BUS'}).error,/No matching/);
 assert.equal(validSelection({kind:'net',path:'child.kicad_sch',netName:'BUS',qualifiedNetName:'bad\n'}),false);
});
test('qualified net lookup resolves relative nested sheets and saved label aliases without guessing basenames',()=>{
 const objects=[{kind:'sheet',path:'design/root.kicad_sch',properties:{Sheetname:'Controller',Sheetfile:'sub/controller.kicad_sch'}},
  {kind:'sheet',path:'design/sub/controller.kicad_sch',properties:{'Sheet name':'IO','Sheet file':'../io.kicad_sch'}}];
 const net={kind:'schematic',path:'design/io.kicad_sch',name:'ENABLE',names:['ENABLE','EN']};
 assert.equal(qualifiedNetName(net,objects),'/Controller/IO/ENABLE');
 assert.equal(relatedNet([net],objects,{kind:'net',path:'board.kicad_pcb',netName:'/Controller/IO/EN'}).net,net);
 assert.match(relatedNet([net],objects,{kind:'net',path:'board.kicad_pcb',netName:'/Different/ENABLE'}).error,/No matching/);
 objects.push({kind:'sheet',path:'design/io.kicad_sch',properties:{Sheetname:'Loop',Sheetfile:'root.kicad_sch'}});
 assert.equal(qualifiedNetName(net,objects),null);
});
test('reference-only fallback rejects repeated sheet identities and conflicting saved links',()=>{
 const selection={kind:'part',path:'board.kicad_pcb',reference:'R1'};
 const a=part('symbol','R1','a'),b=part('symbol','R1','b','other.kicad_sch');
 assert.equal(relatedPart([a],selection).object,a);
 assert.match(relatedPart([a,b],selection).error,/ambiguous/);
 assert.match(relatedPart([a],{...selection,symbolUuid:'wrong'}).error,/does not match/);
 assert.match(relatedPart([],{...selection}).error,/No matching/);
});
test('cross selection is bounded and rejects malformed or control-bearing messages',()=>{
 assert.equal(validSelection({kind:'net',netName:'VCC',path:'root.kicad_sch'}),true);
 for(const value of [null,{kind:'net',netName:'VCC'},{kind:'net',netName:'a'.repeat(501),path:'root.kicad_sch'},{kind:'part',reference:'R1\n',path:'root.kicad_sch'},{kind:'unknown',path:'root.kicad_sch'}])assert.equal(validSelection(value),false);
});
test('group selection accepts clear and bounded valid items, rejects nested or malformed messages',()=>{
 const item={kind:'part',reference:'R1',path:'root.kicad_sch',uuid:'sym'};
 assert.equal(validSelection({kind:'group',items:[]}),true);
 assert.equal(validSelection({kind:'group',items:Array(200).fill(item)}),true);
 for(const value of [{kind:'group',items:Array(201).fill(item)},{kind:'group',items:[{kind:'group',items:[]}]},
  {kind:'group',items:[{...item,path:'../root.kicad_sch'}]},{kind:'group',items:[{...item,extra:'unsafe'}]},
  {kind:'group',items:new Array(1)},{kind:'group',items:[null]},{kind:'group',items:'bad'},
  {kind:'group',items:[],extra:true}])assert.equal(validSelection(value),false);
 assert.deepEqual(relatedGroup([],[],{kind:'group',items:[]}),{objects:[],nets:[],errors:[]});
 assert.deepEqual(relatedGroup([],[],item),{objects:[],nets:[],errors:['Invalid cross-highlight group.']});
});
test('group cross-highlight maps saved parts and qualified nets across multiple sheets and deduplicates',()=>{
 const a=part('symbol','R1','a','design/one.kicad_sch'),b=part('symbol','R2','b','design/two.kicad_sch');
 const objects=[a,b,...['one','two'].map(name=>({kind:'sheet',path:'design/root.kicad_sch',properties:{Sheetname:name,Sheetfile:name+'.kicad_sch'}}))];
 const nets=['one','two'].map(name=>({kind:'schematic',path:'design/'+name+'.kicad_sch',name:'ENABLE'}));
 const items=[{kind:'part',reference:'Renamed1',path:'design/board.kicad_pcb',symbolUuid:'a'},
  {kind:'part',reference:'Renamed2',path:'design/board.kicad_pcb',symbolUuid:'b'},
  ...['one','two'].map(name=>({kind:'net',path:'design/board.kicad_pcb',netName:'/'+name+'/ENABLE'}))];
 assert.deepEqual(relatedGroup(objects,nets,{kind:'group',items:[...items,...items]},'design/one.kicad_sch'),{objects:[a,b],nets,errors:[]});
 const footprints=[part('footprint','R1','fp1','design/board.kicad_pcb','a'),part('footprint','R2','fp2','design/board.kicad_pcb','b')];
 const boardNets=['one','two'].map(name=>({kind:'pcb',path:'design/board.kicad_pcb',name:'/'+name+'/ENABLE'}));
 assert.deepEqual(relatedGroup(footprints,boardNets,{kind:'group',items:[
  {kind:'part',reference:'R1',path:a.path,uuid:'a'},{kind:'part',reference:'R2',path:b.path,uuid:'b'},
  ...nets.map(net=>({kind:'net',path:net.path,netName:net.name,qualifiedNetName:qualifiedNetName(net,objects)}))
 ]}),{objects:footprints,nets:boardNets,errors:[]});
});
test('group mapping keeps safe matches but never guesses repeated parts or local nets using the active sheet',()=>{
 const a=part('symbol','R1','a','one.kicad_sch'),b=part('symbol','R1','b','two.kicad_sch'),safe=part('symbol','R2','c');
 const nets=['one','two'].map(name=>({kind:'schematic',path:name+'.kicad_sch',name:'ENABLE'}));
 const result=relatedGroup([a,b,safe],nets,{kind:'group',items:[
  {kind:'part',reference:'R1',path:'board.kicad_pcb'},
  {kind:'net',netName:'ENABLE',path:'board.kicad_pcb'},
  {kind:'part',reference:'R2',path:'board.kicad_pcb',symbolUuid:'c'}
 ]},'one.kicad_sch');
 assert.deepEqual(result.objects,[safe]);assert.deepEqual(result.nets,[]);assert.equal(result.errors.length,2);
 assert.ok(result.errors.every(error=>/ambiguous/.test(error)));
});


test('terminal cross-probe resolves saved parent identity and pin number, never a same-number neighbor',()=>{
 const {relatedPin}=require('../paired-review.js');
 const footprint=part('footprint','U9','fp','board.kicad_pcb','sym');
 const pads=[{kind:'pad',uuid:'one',ownerUuid:'fp',pinNumber:'1'}, {kind:'pad',uuid:'two',ownerUuid:'fp',pinNumber:'2'}, {kind:'pad',uuid:'other',ownerUuid:'other-fp',pinNumber:'1'}];
 const selection={kind:'pin',path:'root.kicad_sch',reference:'U1',uuid:'sym',ownerUuid:'sym',pinNumber:'1'};
 assert.equal(validSelection(selection),true);
 assert.deepEqual(relatedPin([footprint],[{path:footprint.path,primitives:pads}],selection),{object:footprint,primitives:[pads[0]],pinNumber:'1'});
 assert.match(relatedPin([footprint],[{path:footprint.path,primitives:pads}],{...selection,pinNumber:'3'}).error,/unavailable/);
 const symbol=part('symbol','U1','sym');
 const pin={kind:'pin',uuid:'sym',ownerUuid:'sym',pinNumber:'2'};
 assert.deepEqual(relatedPin([symbol],new Map([[symbol.path,{primitives:[pin]}]]),{kind:'pin',path:'board.kicad_pcb',reference:'U9',symbolUuid:'sym',ownerUuid:'fp',uuid:'two',pinNumber:'2'}).primitives,[pin]);
 assert.match(relatedPin([symbol,{...symbol,path:'repeated.kicad_sch'}],[],{kind:'pin',path:'board.kicad_pcb',reference:'U9',symbolUuid:'sym',pinNumber:'2'}).error,/Multiple saved/);
 for(const bad of [{...selection,pinNumber:''},{...selection,pinNumber:'1\n'},{...selection,ownerUuid:'a'.repeat(201)},{...selection,extra:'unsafe'}])assert.equal(validSelection(bad),false);
});

test('unnamed probe nets map in both directions through saved component terminals, including renamed references',()=>{
 const api=require('../paired-review.js'),sym=part('symbol','R1','sym'),fp=part('footprint','R9','fp','board.kicad_pcb','sym'),objects=[sym,fp];
 const sch={kind:'schematic',path:'root.kicad_sch',name:'Unnamed network (wire-id)',members:[{kind:'pin',reference:'R1',uuid:'sym',pin:'1'}]},pcb={kind:'pcb',path:'board.kicad_pcb',name:'Net-(R9-Pad1)',members:[{kind:'pad',reference:'R9',uuid:'pad-id',pad:'1'}]};
 assert.equal(api.relatedNetByTerminals([pcb],objects,{kind:'net',path:sch.path,netName:sch.name},sch).net,pcb);
 assert.equal(api.relatedNetByTerminals([sch],objects,{kind:'net',path:pcb.path,netName:pcb.name},pcb).net,sch);
 assert.match(api.relatedNetByTerminals([pcb],objects,{kind:'net',path:'foreign.kicad_sch',netName:sch.name},sch).error,/source-bound/);
 assert.match(api.relatedNetByTerminals([pcb],objects,{kind:'net',path:sch.path,netName:sch.name},{...sch,members:[{kind:'pin',reference:'R1',uuid:'foreign',pin:'1'}]}).error,/No matching/);
 assert.match(api.relatedNetByTerminals([pcb],objects,{kind:'net',path:sch.path,netName:sch.name},{...sch,members:[{kind:'pin',reference:'R1',uuid:'sym',pin:'2'}]}).error,/No matching/);
});

test('probe terminal mapping rejects ambiguous nets, disagreeing terminals and conflicting saved associations',()=>{
 const api=require('../paired-review.js'),sym=part('symbol','R1','sym'),fp=part('footprint','R1','fp','board.kicad_pcb','sym'),objects=[sym,fp],selection={kind:'net',path:sym.path,netName:'Unnamed network (wire)'};
 const source={path:sym.path,members:[{kind:'pin',reference:'R1',uuid:'sym',pin:'1'},{kind:'pin',reference:'R1',uuid:'sym',pin:'2'}]},a={kind:'pcb',path:fp.path,name:'A',members:[{kind:'pad',reference:'R1',pad:'1'}]},b={kind:'pcb',path:fp.path,name:'B',members:[{kind:'pad',reference:'R1',pad:'2'}]};
 assert.match(api.relatedNetByTerminals([a,b],objects,selection,source).error,/disagree/);
 assert.match(api.relatedNetByTerminals([a,{...a,name:'duplicate'}],objects,selection,{...source,members:source.members.slice(0,1)}).error,/ambiguous/);
 assert.match(api.relatedNetByTerminals([a],[sym,part('footprint','R1','fp',fp.path,'foreign')],selection,source).error,/No matching/);
});

test('canonical unnamed net selections transfer saved terminal identity across separate panes',()=>{
 const sym=part('symbol','ACT1','sym'),fp=part('footprint','ACT9','fp','board.kicad_pcb','sym');
 const resistor=part('symbol','R15','res'),resistorFp=part('footprint','R25','res-fp',fp.path,'res');
 const sch={kind:'schematic',path:sym.path,name:'Unnamed network (wire)',members:[
  {kind:'wire',uuid:'wire'},{kind:'pin',reference:sym.reference,uuid:sym.uuid,pin:'1'},
  {kind:'pin',reference:resistor.reference,uuid:resistor.uuid,pin:'1'}
 ]};
 const pcb={kind:'pcb',path:fp.path,name:'Net-(ACT9-Pad1)',members:[
  {kind:'pad',reference:fp.reference,uuid:'pad-one',pad:'1'},{kind:'pad',reference:resistorFp.reference,uuid:'pad-two',pad:'1'}
 ]};
 const schematicSelection=structuredClone(netSelection(sch,[sym,resistor]));
 const boardSelection=structuredClone(netSelection(pcb,[fp,resistorFp]));
 assert.equal(schematicSelection.terminals.length,2);
 assert.equal(boardSelection.terminals.length,2);
 assert.equal(relatedNet([pcb],[fp,resistorFp],schematicSelection).net,pcb);
 assert.equal(relatedNet([sch],[sym,resistor],boardSelection).net,sch);
 assert.deepEqual(relatedGroup([fp,resistorFp],[pcb],{kind:'group',items:[schematicSelection]}).nets,[pcb]);
});

test('unnamed net evidence preserves legacy timestamp links and refuses unresolved repeated instances',()=>{
 const legacy={...part('symbol','R1','5A770001'),association:{rootUuid:'root',instances:[{prefix:'/root',reference:'R1'}],complete:true}};
 const fp={...part('footprint','R7','5A770002','board.kicad_pcb'),association:{path:'/5A770001',complete:true}};
 const sch={kind:'schematic',path:legacy.path,name:'Unnamed network (legacy)',members:[{kind:'pin',reference:'R1',uuid:legacy.uuid,pin:'1'}]};
 const pcb={kind:'pcb',path:fp.path,name:'Net-(R7-Pad1)',members:[{kind:'pad',reference:'R7',pad:'1'}]};
 assert.equal(relatedNet([pcb],[fp],netSelection(sch,[legacy])).net,pcb);
 assert.equal(relatedNet([sch],[legacy],netSelection(pcb,[fp])).net,sch);

 const symbol={...legacy,path:'reused.kicad_sch',association:{...legacy.association,instances:[
  {prefix:'/root/A',reference:'R1'},{prefix:'/root/B',reference:'R2'}
 ]}},child={...sch,path:symbol.path};
 const footprints=['A','B'].map((id,index)=>({...fp,uuid:'footprint-'+id,reference:'R'+(index+1),association:{path:'/root/'+id+'/'+legacy.uuid,complete:true}}));
 const net={...pcb,members:[{kind:'pad',reference:'R1',pad:'1'}]};
 assert.equal(netSelection(child,[symbol]).terminals,undefined);
 assert.match(relatedNet([net],footprints,netSelection(child,[symbol])).error,/No matching/);
 assert.equal(relatedNet([net],footprints,netSelection(child,[symbol],{instancePath:'/root/A'})).net,net);
 assert.match(relatedNet([child],[symbol],netSelection(pcb,[fp])).error,/No matching/);
});

test('canonical net lookup refuses disagreements between terminals, names, and saved parent associations',()=>{
 const a=part('symbol','R1','sym1'),b=part('symbol','R2','sym2');
 const fpA=part('footprint','R1','fp1','board.kicad_pcb','sym1'),fpB=part('footprint','R2','fp2',fpA.path,'sym2');
 const n={kind:'schematic',path:a.path,name:'SIG',members:[a,b].map(p=>({kind:'pin',reference:p.reference,uuid:p.uuid,pin:'1'}))};
 const netA={kind:'pcb',path:fpA.path,name:'Other',members:[{kind:'pad',reference:'R1',pad:'1'}]};
 const netB={...netA,name:'Another',members:[{kind:'pad',reference:'R2',pad:'1'}]};
 const selection=netSelection(n,[a,b]);
 assert.match(relatedNet([netA,netB],[fpA,fpB],selection).error,/disagree/);
 assert.match(relatedNet([netA,{...netB,name:'/SIG'}],[fpA,fpB],netSelection({...n,members:[n.members[0]]},[a,b])).error,/name and terminals disagree/);
 assert.match(relatedNet([netA],[fpA,part('footprint','R2','fp2',fpA.path,'other')],selection).error,/disagree/);
 assert.match(relatedNet([netA],[fpA,{...fpA,uuid:'duplicate'}],selection).error,/No matching/);
 assert.equal(relatedNet([netA],[fpA],selection).net,netA);
});

test('canonical net evidence is bounded and rejects malformed terminal messages',()=>{
 const sym=part('symbol','R1','sym'),n={kind:'schematic',path:sym.path,name:'SIG',members:[{kind:'pin',reference:'R1',uuid:'sym',pin:'0'}]};
 const selection=netSelection(n,[sym]),terminal=selection.terminals[0];
 assert.equal(terminal.pinNumber,'0');
 assert.equal(validSelection(selection),true);
 for(const terminals of [
  [],new Array(1),'bad',[null],[{...terminal,pinNumber:'1\n'}],[{...terminal,pinNumber:''}],
  [{...terminal,kind:'part'}],[{...terminal,path:'unexpected.kicad_sch'}],[{...terminal,extra:{}}],[{...terminal,uuid:undefined}],
  [{...terminal,tstampPath:'/root/other'}],Array(65).fill(terminal),
  Array.from({length:64},(_,i)=>({...terminal,pinNumber:String(i).padEnd(200,'0'),reference:'R'.repeat(200)}))
 ])assert.equal(validSelection({...selection,terminals}),false);
 const many={...n,members:Array.from({length:65},(_,i)=>({...n.members[0],pin:String(i)}))};
 assert.equal(netSelection({...many,members:many.members.slice(0,64)},[sym]).terminals.length,64);
 assert.equal(netSelection(many,[sym]).terminals,undefined);
 assert.equal(netSelection({...n,members:Array(65).fill(n.members[0])},[sym]).terminals.length,1);
});

function multiUnitPackage(){
 const {buildProject}=require('../design-model.js');
 const placed=(uuid,unit,prefix)=>`(symbol (lib_id "Demo:Amplifier") (at 0 0 0) (unit ${unit})
  (uuid "${uuid}") (property "Reference" "U1") (property "Footprint" "Demo:Package")
  (instances (project "Demo" (path "${prefix}" (reference "U1") (unit ${unit})))))`;
 const files=[
  {path:'root.kicad_sch',content:`(kicad_sch (uuid "root")
   (sheet (at 0 0) (size 10 10) (uuid "bank") (property "Sheetname" "bank") (property "Sheetfile" "bank.kicad_sch"))
   (sheet (at 0 10) (size 10 10) (uuid "power") (property "Sheetname" "power") (property "Sheetfile" "power.kicad_sch")))`},
  {path:'bank.kicad_sch',content:`(kicad_sch (uuid "bank") ${placed('unit-a',1,'/root/bank')} ${placed('unit-b',2,'/root/bank')})`},
  {path:'power.kicad_sch',content:`(kicad_sch (uuid "power") ${placed('unit-p',5,'/root/power')})`},
  {path:'board.kicad_pcb',content:`(kicad_pcb (footprint "Demo:Package" (layer "F.Cu") (at 0 0)
   (uuid "p") (property "Reference" "U7") (path "/root/bank/unit-a")))`}
 ];
 const records=buildProject(files).objects,schematic=records.filter(o=>o.kind==='symbol'||o.kind==='sheet');
 const [a,b,power,footprint]=['unit-a','unit-b','unit-p','p'].map(id=>records.find(o=>o.uuid===id));
 return {a,b,power,footprint,schematic};
}

test('saved multi-unit part and net selections identify the package within and across sheets',()=>{
 const api=require('../paired-review.js'),{a,b,power,footprint,schematic}=multiUnitPackage();
 const part=api.partSelection(b,{objects:schematic});
 assert.equal(part.uuid,b.uuid);
 assert.equal(part.tstampPath,'/root/bank/unit-b');
 assert.deepEqual(part.unitPaths,['/root/bank/unit-a','/root/power/unit-p']);
 assert.equal(relatedPart([footprint],structuredClone(part)).object,footprint);
 assert.equal(relatedPart(schematic,api.partSelection(footprint)).object,a);

 const pair=(symbol,number,names)=>[
  {kind:'schematic',path:symbol.path,name:names[0],members:[{kind:'pin',reference:'U1',uuid:symbol.uuid,pin:number}]},
  {kind:'pcb',path:footprint.path,name:names[1],members:[{kind:'pad',reference:'U7',pad:number}]}
 ];
 for(const [sch,pcb] of [pair(b,'5',['THRESHOLD','/bank/THRESHOLD']),pair(power,'4',['Unnamed network (power-wire)','Net-(U7-Pad4)'])]){
  assert.equal(relatedNet([pcb],[footprint],netSelection(sch,schematic)).net,pcb);
  assert.equal(relatedNet([sch],schematic,netSelection(pcb,[footprint])).net,sch);
 }
 const pad={kind:'pad',ownerUuid:'p',pinNumber:'4'},pin={kind:'pin',ownerUuid:'unit-p',pinNumber:'4'};
 const {kind,uuid,...terminal}=api.partSelection(power,{objects:schematic});
 assert.equal(api.relatedPin([footprint],new Map([[footprint.path,{primitives:[pad]}]]),
  {...terminal,kind:'pin',uuid:'pin-marker',ownerUuid:uuid,pinNumber:'4'}).object,footprint);
 const {kind:boardKind,...boardPart}=api.partSelection(footprint);
 assert.equal(api.relatedPin(schematic,new Map([[power.path,{primitives:[pin]}]]),{...boardPart,kind:'pin',pinNumber:'4'}).object,power);
});

test('multi-unit evidence rejects inconsistent saved annotations, units, package context, and reused identities',()=>{
 const api=require('../paired-review.js'),{a,b,power,footprint,schematic}=multiUnitPackage();
 const alias=api.partSelection(b,{objects:schematic});
 for(const paths of [
  [],new Array(1),['/foreign/bank/unit-a'],['/root/../unit-a'],['/root/bank/unit-b'],
  ['/root/bank/unit-a','/root/power/unit-a'],Array.from({length:32},(_,i)=>'/root/unit-'+i)
 ])assert.equal(validSelection({...alias,unitPaths:paths}),false);
 assert.equal(validSelection({...alias,path:footprint.path}),false);
 assert.match(relatedPart([footprint,{...footprint,uuid:'other',association:{...footprint.association,path:'/root/power/unit-p'}}],alias).error,/Multiple/);

 const withA=replacement=>schematic.map(object=>object===a?replacement:object);
 for(const objects of [
  withA({...a,properties:{...a.properties,Unit:'2'}}),
  withA({...a,properties:{...a.properties,'Library ID':'Demo:Other'}}),
  withA({...a,saved:{...a.saved,properties:a.saved.properties.map(p=>p.name==='Footprint'?{...p,value:'Demo:Wrong'}:p)}}),
  withA({...a,association:{...a.association,instances:[{prefix:'/root/bank',reference:'U2'}]}}),
  withA({...a,association:{...a.association,instances:[{prefix:'/foreign/bank',reference:'U1'}]}}),
  withA({...a,association:{...a.association,instances:[...a.association.instances,{prefix:'/root/other',reference:'U1'}]}})
 ]){
  const selection=api.partSelection(b,{objects});
  assert.ok(!selection.unitPaths?.includes('/root/bank/unit-a'));
  assert.match(relatedPart([footprint],selection).error,/does not match/);
 }
 const repeated={...power,association:{...power.association,instances:[...power.association.instances,{prefix:'/root/other',reference:'U2'}]}};
 const repeatedObjects=schematic.map(item=>item===power?repeated:item);
 assert.equal(api.partSelection(repeated,{objects:repeatedObjects}).unitPaths,undefined);
 assert.equal(api.partSelection(repeated,{objects:repeatedObjects,instancePath:'/root/other'}).unitPaths,undefined);
 assert.equal(api.partSelection(repeated,{objects:repeatedObjects,instancePath:'/root/power'}).unitPaths.length,2);
});

test('aggregate group payloads retain identities before allocating terminal evidence',()=>{
 const sym=part('symbol','R1','sym'),net={kind:'schematic',path:sym.path,name:'N',members:Array.from({length:64},(_,i)=>
  ({kind:'pin',reference:'R1',uuid:'sym',pin:String(i)}))};
 const items=Array.from({length:4},(_,i)=>netSelection({...net,name:'N'+i},[sym]));
 assert.equal(validSelection({kind:'group',items}),false);
 const result=groupSelection(items);
 assert.equal(validSelection(result.selection),true);
 assert.equal(result.omittedItems,0);
 assert.equal(result.omittedEvidence,1);
 assert.equal(result.selection.items[3].netName,'N3');
 assert.equal(result.selection.items[3].terminals,undefined);

 const large={kind:'net',path:'大'.repeat(980)+'.kicad_pcb',netName:'名'.repeat(500)};
 const excess=groupSelection(Array(200).fill(large));
 assert.ok(excess.selection.items.length>0&&excess.selection.items.length<200);
 assert.equal(excess.omittedItems,200-excess.selection.items.length);
 assert.equal(excess.omittedEvidence,0);
 assert.equal(validSelection(excess.selection),true);
});
