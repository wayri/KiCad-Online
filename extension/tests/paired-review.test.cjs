const test=require('node:test'),assert=require('node:assert/strict');
const {validSelection,relatedPart,symbolUuid,qualifiedNetName,relatedNet,relatedGroup}=require('../paired-review.js');
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
