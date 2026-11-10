const test=require('node:test'),assert=require('node:assert/strict');
const compat=require('../file-compatibility.js'),diff=require('../design-diff.js');

test('KERO-style component property resolves project MPN and retains its saved expression',()=>{
 const source='(kicad_sch (title_block (title "Encoder")) (symbol (property "Reference" "U2") (property "Value" "${ENCODER_OPAMP_MPN}")))',ast=diff.parse(source),raw={Reference:'U2',Value:'${ENCODER_OPAMP_MPN}',Footprint:'Encoder:TSSOP-14_4.4x5mm_P0.65mm'};
 const resolver=compat.textResolver(ast,{textVariables:{ENCODER_OPAMP_MPN:'OPA4192IPWR'}}),result=resolver.properties(raw);
 assert.equal(result.values.Value,'OPA4192IPWR');assert.equal(result.values.Footprint,raw.Footprint);assert.equal(raw.Value,'${ENCODER_OPAMP_MPN}');
 assert.equal(result.provenance.Value.raw,'${ENCODER_OPAMP_MPN}');assert.equal(result.provenance.Value.status,'resolved');
 assert.deepEqual(result.provenance.Value.variables,[{name:'ENCODER_OPAMP_MPN',source:'Project',raw:'OPA4192IPWR'}]);
});

test('nested project aliases expose each variable source and respect selected field aliases',()=>{
 const resolver=compat.textResolver(diff.parse('(kicad_sch (title_block (title "Encoder")))'),{textVariables:{PART:'${VENDOR}-${SERIES}',VENDOR:'TI',SERIES:'OPA4192'}});
 const detail=resolver.inspect('${REFERENCE}: ${PART} · ${TITLE}',{Reference:'U2'});
 assert.equal(detail.value,'U2: TI-OPA4192 · Encoder');assert.equal(detail.status,'resolved');
 assert.deepEqual(detail.variables.map(item=>[item.name,item.source]),[['REFERENCE','Selected object field'],['PART','Project'],['VENDOR','Project'],['SERIES','Project'],['TITLE','Title block']]);
});

test('missing and recursive values remain literal and visibly unresolved',()=>{
 const warnings=[],resolver=compat.textResolver(['kicad_sch'],{textVariables:{A:'${B}',B:'${A}'}},message=>warnings.push(message));
 const cycle=resolver.inspect('${A}'),missing=resolver.inspect('${UNKNOWN}');
 assert.equal(cycle.value,'${A}');assert.equal(cycle.status,'unresolved');assert.deepEqual(cycle.unresolved,['A']);
 assert.equal(missing.value,'${UNKNOWN}');assert.equal(missing.status,'unresolved');assert.deepEqual(missing.unresolved,['UNKNOWN']);assert.ok(warnings.length>=2);
 const listed=resolver.list({Value:'${UNKNOWN}'});assert.ok(listed.some(row=>row.name==='UNKNOWN'&&row.status==='unresolved'));
});

test('qualified reference fields and sheet contexts have distinct provenance without mutating source',()=>{
 const ast=diff.parse('(kicad_sch (symbol (property "Reference" "R1") (property "Value" "10k")))'),before=JSON.stringify(ast);
 const resolver=compat.textResolver(ast,{path:'hw/encoder.kicad_sch',sheetNumber:2,sheetCount:5,sheetName:'/Encoder/'}),detail=resolver.inspect('${R1:VALUE} · ${#}/${##} · ${SHEETNAME}');
 assert.equal(detail.value,'10k · 2/5 · /Encoder/');assert.equal(detail.variables[0].source,'Reference R1');assert.equal(detail.variables[1].source,'Sheet context');assert.equal(JSON.stringify(ast),before);
 assert.ok(resolver.list().some(row=>row.name==='FILENAME'&&row.value==='encoder.kicad_sch'&&row.source==='Drawing context'));
});

test('duplicate reference identity does not resolve a qualified field to an arbitrary symbol',()=>{
 const ast=diff.parse('(kicad_sch (symbol (property "Reference" "U2") (property "Value" "First")) (symbol (property "Reference" "U2") (property "Value" "Second")))');
 const result=compat.textResolver(ast).inspect('${U2:VALUE}');assert.equal(result.status,'unresolved');assert.equal(result.value,'${U2:VALUE}');assert.match(result.variables[0].source,/Ambiguous/);
});

test('saved prototype-like variable names are ordinary data; unknown prototype properties stay unresolved',()=>{
 const vars=JSON.parse('{"__proto__":"saved","constructor":"declared"}'),resolver=compat.textResolver(['kicad_sch'],{textVariables:vars});
 assert.equal(resolver.resolve('${__proto__} ${constructor}'),'saved declared');assert.equal(resolver.inspect('${toString}').status,'unresolved');
});
