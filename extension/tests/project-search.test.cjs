const test=require('node:test'),assert=require('node:assert/strict');
const {compile,createIndex,search,LIMITS,parseNetClasses,netClasses}=require('../project-search.js');
const object=(id,path,ref,value,properties={})=>({id,path,uuid:id,reference:ref,kind:path.endsWith('pcb')?'footprint':'symbol',label:ref,properties:{Reference:ref,Value:value,...properties}});
const records=[object('a','root.kicad_sch','R1','4.7k',{'Manufacturer Part':'ACME 123',Footprint:'Resistor_SMD:R_0603'}),object('b','power.kicad_sch','R1','10k'),object('c','board.kicad_pcb','U1','MCU'),object('d','root.kicad_sch','C1','100n')];
const indexed=()=>createIndex(records,{sheets:[{path:'power.kicad_sch',label:'Power supply'}],nets:[{path:'root.kicad_sch',name:'SENSE',objectIds:['a']},{path:'board.kicad_pcb',name:'SENSE',members:[{uuid:'c'}]}]});
test('explicit glob patterns compose with fields, negation and OR while ordinary stars stay literal',()=>{
 assert.equal(search(indexed(),'ref:glob:R?').total,2);
 assert.equal(search(indexed(),'ref:glob:R* NOT value:glob:10*').results[0].id,'a');
 assert.equal(search(indexed(),'ref:glob:R* OR ref:glob:U?').total,3);
 assert.equal(search(indexed(),'value:glob:*7*').total,1);
 assert.equal(search(indexed(),'glob:*SENSE*').total,2);
 assert.equal(search(indexed(),'ref:glob:R').total,0,'Glob matches the whole field');
 assert.equal(search(indexed(),'ref:R*').total,0,'No implicit patterns');
});
test('finite-state regex supports anchors classes categories atom repetitions and quoted punctuation',()=>{
 assert.equal(search(indexed(),'ref:regex:^R[0-9]+$').total,2);
 assert.equal(search(indexed(),'regex:^U[0-9]$').results[0].id,'c');
 assert.equal(search(indexed(),'ref:regex:^R\\d+$').total,2);
 assert.equal(search(indexed(),'ref:regex:^R\\D+$').total,0);
 assert.equal(search(indexed(),'ref:regex:^[^U].$').total,3);
 assert.equal(search(indexed(),'value:regex:"^4\\\\.7k$"').total,1);
 assert.equal(search(indexed(),'ref:regex:^R1?0*$').total,2);
 assert.equal(search(indexed(),'ref:regex:1$').total,4);
 assert.equal(search(indexed(),'value:regex:^.*k$').total,2);
 assert.equal(search(indexed(),'ref:regex:^r[0-9]+$').total,2,'Case insensitive');
});
test('dangerous and unsupported patterns return errors instead of invoking backtracking',()=>{
 for(const query of ['ref:regex:"(a+)+$"','regex:"(?=a)"','regex:"a|b"','regex:a{4}','regex:a**','regex:a+?','regex:[]','regex:[z-a]','regex:[abc','regex:','glob:','regex:^$','regex:abc\\','regex:\\1','regex:'+('a'.repeat(129))]) {
  const result=search(indexed(),query);assert.ok(result.error,query);assert.equal(result.total,0,query);
 }
});
test('pattern work budget refuses expensive broad scans without misleading partial matches',()=>{
 const index=createIndex(Array.from({length:500},(_,i)=>object(String(i),'a.kicad_pcb','R'+i,'a'.repeat(4096))));
 const result=search(index,'value:regex:a*a*a*a*a*a*b$');
 assert.match(result.error,/work budget/);assert.deepEqual(result.results,[]);
 const narrowed=search(index,'ref:NOT_PRESENT value:regex:a*a*a*a*a*a*b$');
 assert.equal(narrowed.error,null);assert.equal(narrowed.total,0);
});
test('literal phrases, arbitrary quoted property names, field aliases and AND',()=>{
 assert.deepEqual(search(indexed(),'"Manufacturer Part":"ACME 123" AND type:symbol').results.map(r=>r.id),['a']);
 assert.deepEqual(search(indexed(),'ref:R1 value:10k sheet:"Power supply"').results.map(r=>r.id),['b']);
 assert.equal(search(indexed(),'footprint:0603 uuid:a').results[0].id,'a');
 assert.equal(search(indexed(),'value:"4.7k"').total,1);
 assert.equal(search(indexed(),'value:"4.*"').total,0,'Regex syntax is literal');
});
test('OR groups and exclusions use AND precedence, quoted OR is literal',()=>{
 assert.deepEqual(search(indexed(),'ref:R1 -value:10k OR ref:U1').results.map(r=>r.id).sort(),['a','c']);
 assert.deepEqual(search(indexed(),'type:symbol NOT ref:R1 | ref:U1').results.map(r=>r.id).sort(),['c','d']);
 assert.equal(search(indexed(),'value:"OR"').total,0);
 assert.equal(compile('"OR"').groups[0][0].term,'or');
 assert.equal(search(createIndex([object('x','a.kicad_sch','X1','-12')]),'"-12"').total,1);
});
test('file scoped net membership cannot leak between repeated references or UUIDs',()=>{
 const duplicate={...records[1],uuid:'a'};
 const index=createIndex([records[0],duplicate],{nets:[{path:'root.kicad_sch',name:'SENSE',members:[{uuid:'a'}]}]});
 const result=search(index,'net:SENSE');assert.equal(result.total,1);assert.equal(result.results[0].path,'root.kicad_sch');
 assert.equal(search(indexed(),'ref:R1').total,2);
 assert.equal(search(indexed(),'net:SENSE').total,2);
});
test('footprints inherit their saved pad net names, never another file parent',()=>{
 const fp=object('f','board.kicad_pcb','R1','1k'),pad={...object('p','board.kicad_pcb','R1',''),kind:'pad',parentId:'f'};
 const index=createIndex([fp,pad],{nets:[{path:'board.kicad_pcb',name:'VCC',objectIds:['p']}]});
 assert.equal(search(index,'type:footprint net:VCC').results[0].id,'f');
});
test('malformed query reports an actionable error without returning arbitrary matches',()=>{
 for(const query of ['"unclosed','ref:','-','OR ref:R1','ref:R1 OR','AND R1','R1 AND OR U1','NOT','NOT NOT R1','(R1)','R1\nU1']) {
  const result=search(indexed(),query);assert.ok(result.error,query);assert.equal(result.total,0);
 }
 assert.ok(compile('x'.repeat(LIMITS.query+1)).error);
 assert.ok(compile(Array(65).fill('R1').join(' ')).error);
 assert.ok(compile(Array(17).fill('R1').join(' OR ')).error);
});
test('stable relevance ordering, scoped identities, snippets and result limit',()=>{
 const index=createIndex([object('b','z.kicad_sch','R10','1k'),object('a','a.kicad_sch','R1','1k'),object('c','b.kicad_sch','R1','1k')]);
 const result=search(index,'ref:R1',{limit:1});assert.equal(result.total,3);assert.equal(result.truncated,true);assert.equal(result.results[0].id,'a');
 assert.equal(result.results[0].object,index.entries[1].object);assert.deepEqual(result.results[0].matchedFields,['ref']);assert.equal(result.results[0].snippets[0].text,'R1');
 assert.deepEqual(search(index,'').results.map(r=>r.id),['a','c','b']);
});
test('index bounds disclose incomplete search and bound long snippet output',()=>{
 const index=createIndex([object('a','root.kicad_sch','R1','a'.repeat(5000))]);
 assert.ok(index.warnings.length);assert.ok(search(index,'value:aaaa').results[0].snippets[0].text.length<=146);
 const many=createIndex(Array.from({length:LIMITS.objects+1},(_,i)=>object(String(i),'a.kicad_sch','R'+i,'1k')));
 assert.equal(many.count,LIMITS.objects);assert.ok(many.warnings.some(w=>w.includes('first')));
});
test('text and property budgets disclose omitted values instead of silently claiming complete coverage',()=>{
 const properties=Object.fromEntries(Array.from({length:140},(_,i)=>['Field '+i,'contents '+i]));
 const index=createIndex([object('x','a.kicad_sch','X1','1',properties)]);
 assert.ok(index.warnings.some(w=>w.includes('properties')));
 const large=createIndex(Array.from({length:2200},(_,i)=>object(String(i),'a.kicad_sch','X'+i,'v'.repeat(4096))));
 assert.ok(large.count<2200);assert.ok(large.warnings.some(w=>w.includes('text budget')));
 assert.ok(search(large,'').warnings.length);
});
const classConfig=(overrides={})=>parseNetClasses(JSON.stringify({net_settings:{classes:[{name:'Default'},{name:'Power',priority:1},{name:'Fast',priority:0}],netclass_assignments:{VCC:['Power'],USB_D:'Power'},netclass_patterns:[{pattern:'USB_*',netclass:'Fast'}],...overrides}}));
test('saved net class assignments and matching patterns compose in KiCad priority order',()=>{
 const config=classConfig();assert.deepEqual(netClasses('VCC',config),['Power']);
 assert.deepEqual(netClasses('USB_D',config),['Fast','Power']);
 assert.deepEqual(netClasses('USB_DM',config),['Fast']);
 assert.deepEqual(netClasses('OTHER',config),['Default']);
 assert.deepEqual(netClasses('usb_d',config),['Default'],'Saved net names are case-sensitive');
 assert.deepEqual(netClasses('',config),['Default']);
});
test('class and netclass aliases index net-linked components across files without assigning unconnected objects',()=>{
 const config=classConfig({netclass_assignments:{SENSE:['Fast']}});
 const index=createIndex(records,{netClasses:config,nets:[{path:'root.kicad_sch',name:'SENSE',objectIds:['a']}]});
 assert.deepEqual(search(index,'class:Fast').results.map(r=>r.id),['a']);
 assert.deepEqual(search(index,'netclass:Fast ref:R1').results.map(r=>r.path),['root.kicad_sch']);
 assert.equal(search(index,'class:Default').total,0);
});
test('wildcards are bounded whole-name matches and unknown regex/bus patterns disclose incomplete defaults',()=>{
 const config=classConfig({netclass_patterns:[{pattern:'D?',netclass:'Fast'},{pattern:'A*B*',netclass:'Power'}]});
 assert.deepEqual(netClasses('D1',config),['Fast']);assert.deepEqual(netClasses('D12',config),['Default']);
 assert.deepEqual(netClasses('AxyzBq',config),['Power']);
 const unknown=classConfig({netclass_patterns:[{pattern:'^USB_(D|C)$',netclass:'Fast'},{pattern:'D[0..7]',netclass:'Fast'}]});
 assert.equal(unknown.incomplete,true);assert.ok(unknown.warnings.some(w=>w.includes('Regex or bus')));
 assert.deepEqual(netClasses('OTHER',unknown),[],'Do not invent Default when omitted patterns might match');
 assert.deepEqual(netClasses('VCC',unknown),['Power'],'Known explicit membership remains usable');
});
test('implicit class names survive saved assignments while malformed settings and oversized inputs fail clearly',()=>{
 const config=classConfig({netclass_assignments:{X:['Undeclared']}});assert.deepEqual(netClasses('X',config),['Undeclared']);
 assert.ok(config.warnings.some(w=>w.includes('implicit')));
 for(const value of ['{','{}',JSON.stringify({net_settings:{classes:{}}}),'x'.repeat(1024*1024+1)])assert.throws(()=>parseNetClasses(value));
 const broken=classConfig({netclass_assignments:{VCC:4}});assert.equal(broken.incomplete,true);assert.ok(broken.warnings.some(w=>w.includes('invalid explicit')));
});

test('saved net-class colors use separate views, priority, Default fallback and validated channels',()=>{
 const api=require('../project-search.js'),config=api.parseNetClasses(JSON.stringify({net_settings:{classes:[{name:'Default',pcb_color:'rgba(80, 90, 100, 1)',schematic_color:'rgba(0, 0, 0, 0)'},{name:'Power',priority:1,pcb_color:'rgba(220, 30, 40, 1)',schematic_color:'#00aa55'},{name:'Fast',priority:0,pcb_color:'rgba(0, 0, 0, 0)',schematic_color:'rgba(30, 90, 240, 0.8)'}],netclass_assignments:{VCC:['Power','Fast']}}}));
 assert.equal(api.netClassColor('VCC',config,true),'rgba(220,30,40,1)');assert.equal(api.netClassColor('VCC',config,false),'rgba(30,90,240,0.8)');assert.equal(api.netClassColor('OTHER',config,true),'rgba(80,90,100,1)');assert.equal(api.netClassColor('OTHER',config,false),null);
 for(const value of ['rgba(999,0,0,1)','rgba(0,0,0,-1)','url(https://example.com)','var(--color)','rgba(0,0,0,0)'])assert.equal(api.savedColor(value),null);
});


test('bounded ranking preserves ties, preferred paths and counts for broad queries',()=>{
 const entries=Array.from({length:240},(_,i)=>({
  id:'part-'+String(i).padStart(3,'0'),
  path:i%2?'root.kicad_sch':'board.kicad_pcb',
  reference:'R'+i,
  kind:'symbol',
  properties:{Value:i%4?'precision resistor':'resistor'}
 })).reverse();
 const index=createIndex(entries);
 const preferredPath='root.kicad_sch';
 const full=search(index,'resistor',{limit:240,preferredPath});
 const preview=search(index,'resistor',{limit:20,preferredPath});
 assert.equal(preview.total,240);
 assert.equal(preview.truncated,true);
 assert.deepEqual(preview.results,full.results.slice(0,20));
});
