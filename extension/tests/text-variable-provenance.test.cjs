const test=require('node:test'),assert=require('node:assert/strict');
const compat=require('../file-compatibility.js'),diff=require('../design-diff.js');

test('text links accept saved pages and web URLs while rejecting executable and local-file targets',()=>{
 for(const target of ['javascript:alert(1)','data:text/html,x','file:///C:/secret','../secret','https://user:pass@example.com','https://example.com\nother'])assert.deepEqual(compat.textLinks('',target),[]);
 assert.equal(compat.textLinks('https://example.com/a https://example.org/b.').length,2);assert.equal(compat.textLinks('https://example.com/','#5')[0].page,'5');
 assert.equal(compat.textLinks('https://example.com/','javascript:bad').length,0);
});

test('saved page targets distinguish repeated instances instead of assigning a file ordinal',()=>{
 const files=[{path:'root.kicad_sch',content:'(kicad_sch (uuid root) (sheet_instances (path "/" (page "1"))) (sheet (uuid a) (property "Sheetname" "A") (property "Sheetfile" "child.kicad_sch") (instances (project "Demo" (path "/root" (page "8"))))) (sheet (uuid b) (property "Sheetname" "B") (property "Sheetfile" "child.kicad_sch") (instances (project "Demo" (path "/root" (page "9"))))))'},{path:'child.kicad_sch',content:'(kicad_sch (uuid child))'}];
 const context=compat.textContext(files,'child.kicad_sch',{rootFile:files[0].path,parse:diff.parse});assert.deepEqual(context.instances.map(item=>[item.instancePath,item.sheetNumber]),[['/root/a','8'],['/root/b','9']]);
 assert.equal(compat.textContext(files,'root.kicad_sch',{parse:diff.parse}).sheetNumber,'1');
});

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

test('sheet fields override project globals and inherit ancestors without leaking object fields',()=>{
 const resolver=compat.textResolver(['kicad_sch'],{textVariables:{CONFIG:'project',VALUE_B:'global',PART:'${CONFIG}'},sheetContexts:[{fields:{CONFIG:'child',VALUE_B:'${CONFIG}'},source:'Sheet /A/child/'},{fields:{INHERITED:'parent',CONFIG:'parent'},source:'Sheet /A/'}]});
 assert.equal(resolver.resolve('${VALUE_B} ${CONFIG} ${INHERITED}'),'child child parent');
 assert.equal(resolver.resolve('${VALUE_B} ${CONFIG} ${PART}',{CONFIG:'object'}),'child object project');
 assert.equal(resolver.inspect('${VALUE_B}').variables[0].source,'Sheet /A/child/');
});

test('reference field expressions resolve in their owning symbol rather than the caller',()=>{
 const ast=diff.parse('(kicad_sch (symbol (property "Reference" "U2") (property "Value" "${CONFIG}") (property "CONFIG" "target")))');
 assert.equal(compat.textResolver(ast).resolve('${U2:VALUE}',{CONFIG:'caller'}),'target');
});

function repeatedSheets(){return [{path:'root.kicad_sch',content:'(kicad_sch (uuid root) (sheet (uuid a) (property "Sheetname" "A") (property "Sheetfile" "child.kicad_sch") (property "CONFIG" "A config") (property "VALUE_B" "${CONFIG}")) (sheet (uuid b) (property "Sheetname" "B") (property "Sheetfile" "child.kicad_sch") (property "CONFIG" "B config") (property "VALUE_B" "${CONFIG}")))'},{path:'child.kicad_sch',content:'(kicad_sch (uuid child) (text "${VALUE_B} ${CONFIG}"))'}];}

test('repeated saved sheets resolve independently by UUID instance path',()=>{
 const files=repeatedSheets(),before=JSON.stringify(files),options={rootFile:'root.kicad_sch',parse:diff.parse};
 const a=compat.textContext(files,'child.kicad_sch',{...options,instancePath:'/root/a'}),b=compat.textContext(files,'child.kicad_sch',{...options,instancePath:'/root/b/'});
 assert.equal(a.contextStatus,'resolved');assert.equal(a.sheetName,'A');assert.equal(b.sheetName,'B');assert.equal(a.instances.length,2);
 const resolver=context=>compat.textResolver(diff.parse(files[1].content),{textVariables:{CONFIG:'global'},...context});
 assert.equal(resolver(a).resolve('${VALUE_B} ${CONFIG}'),'A config A config');assert.equal(resolver(b).resolve('${VALUE_B} ${CONFIG}'),'B config B config');assert.equal(JSON.stringify(files),before);
});

test('ambiguous sheets preserve variables instead of using a sibling or global value',()=>{
 const context=compat.textContext(repeatedSheets(),'child.kicad_sch',{rootFile:'root.kicad_sch',parse:diff.parse}),resolver=compat.textResolver(['kicad_sch'],{textVariables:{CONFIG:'global',OTHER:'available'},...context});
 assert.equal(context.contextStatus,'ambiguous');const result=resolver.inspect('${CONFIG} ${VALUE_B} ${OTHER}');assert.equal(result.value,'${CONFIG} ${VALUE_B} available');assert.equal(result.status,'unresolved');assert.equal(result.variables[0].source,'Ambiguous sheet instance');
 assert.equal(resolver.resolve('${CONFIG}',{CONFIG:'object'}),'object');assert.equal(resolver.list().find(item=>item.name==='CONFIG').status,'unresolved');
});

test('saved sheet field hierarchy retains ancestor scope and safe relative paths',()=>{
 const files=[{path:'hw/root.kicad_sch',content:'(kicad_sch (uuid root) (sheet (uuid a) (property "Sheetname" "A") (property "Sheetfile" "nested/a.kicad_sch") (property "PARENT" "${CONFIG}") (property "CONFIG" "parent")))'},{path:'hw/nested/a.kicad_sch',content:'(kicad_sch (sheet (uuid b) (property "Sheetname" "B") (property "Sheetfile" "../b.kicad_sch") (property "CONFIG" "child")))'},{path:'hw/b.kicad_sch',content:'(kicad_sch)'}];
 const context=compat.textContext(files,'hw/b.kicad_sch',{rootFile:files[0].path,parse:diff.parse});assert.equal(context.instancePath,'/root/a/b');assert.equal(context.sheetPath,'/A/B/');assert.equal(compat.textResolver(['kicad_sch'],context).resolve('${CONFIG} ${PARENT}'),'child parent');
});

test('title block context wins over a same-named project variable',()=>{
 const ast=diff.parse('(kicad_sch (title_block (title "${CONFIG}")))');assert.equal(compat.textResolver(ast,{textVariables:{TITLE:'wrong',CONFIG:'saved'},sheetContexts:[{fields:{CONFIG:'local'}}]}).resolve('${TITLE}'),'saved');
});

test('variable inventory exposes shadowed project and ancestor definitions in their own scopes',()=>{
 const resolver=compat.textResolver(['kicad_sch'],{textVariables:{CONFIG:'global',PART:'${CONFIG}'},sheetContexts:[{fields:{CONFIG:'child'},source:'Sheet /A/B/'},{fields:{CONFIG:'ancestor',PART:'${CONFIG}'},source:'Sheet /A/'}]});
 const rows=resolver.list({CONFIG:'object'},{includeShadowed:true}).filter(row=>row.name==='CONFIG');assert.deepEqual(rows.map(row=>[row.source,row.value,!!row.shadowed]),[['Selected object field','object',false],['Project','global',true],['Sheet /A/B/','child',true],['Sheet /A/','ancestor',true]]);
 assert.equal(resolver.list({},{includeShadowed:true}).find(row=>row.name==='PART'&&row.source==='Project').value,'global');
});

test('direct child views retain loaded ancestor fields and repeated instance ambiguity',()=>{
 const files=repeatedSheets(),context=compat.textContext(files,'child.kicad_sch',{rootFile:'child.kicad_sch',parse:diff.parse});assert.equal(context.contextStatus,'ambiguous');assert.equal(context.instances.length,2);
 const selected=compat.textContext(files,'child.kicad_sch',{rootFile:'child.kicad_sch',instancePath:'/root/a',parse:diff.parse});assert.equal(compat.textResolver(['kicad_sch'],selected).resolve('${VALUE_B}'),'A config');
});

test('custom symbol field names ignore case while sheet and project variable names retain saved case',()=>{
 const ast=diff.parse('(kicad_sch (symbol (property "Reference" "R2") (property "Value_T" "${CONFIG}") (property "CONFIG" "symbol")))');
 const resolver=compat.textResolver(ast,{textVariables:{VALUE_T:'global',CONFIG:'project'},sheetContexts:[{fields:{VALUE_T:'sheet',CONFIG:'sheet'}}]});
 assert.equal(resolver.resolve('${VALUE_T}',{Value_T:'${CONFIG}',CONFIG:'local'}),'local');
 assert.equal(resolver.resolve('${R2:VALUE_T}'),'symbol');
 assert.equal(resolver.resolve('${VALUE_T}'),'sheet');
 assert.equal(resolver.resolve('${value_t}'),'${value_t}');
});


test('metadata-only parsing preserves scoped variables and saved sheet instances without retaining artwork',()=>{
 const root='(kicad_sch (uuid root) (title_block (title "Controller")) (property "GLOBAL" "saved") (lib_symbols (symbol "Unused" (symbol "Unused_1_1" (circle (center 1 2) (radius 1))))) (sheet (uuid child) (property "Sheetname" "Channel") (property "Sheetfile" "child.kicad_sch") (property "LOCAL" "scoped")) (image (data "AAAA")) (text "Artwork" (at 1 2)))',files=[{path:'root.kicad_sch',content:root},{path:'child.kicad_sch',content:'(kicad_sch (uuid child-root))'}];
 const options={rootFile:files[0].path};assert.deepEqual(compat.textContext(files,files[1].path,{...options,parse:diff.parseMetadata}),compat.textContext(files,files[1].path,{...options,parse:diff.parse}));
 assert.equal(compat.textResolver(diff.parseMetadata(root)).resolve('${GLOBAL} ${TITLE}'),'saved Controller');assert.equal(diff.parseMetadata(root).some(item=>Array.isArray(item)&&['lib_symbols','image','text'].includes(item[0])),false);
 for(const invalid of ['(kicad_pcb (zone (pts (xy 1 2)))','(kicad_sch (image (data "unterminated)))','(kicad_sch (symbol 1)))'])assert.throws(()=>diff.parseMetadata(invalid));
});


test('metadata cache retains qualified component fields while omitting footprint copper and symbol geometry',()=>{
 for(const [root,kind]of [['kicad_sch','symbol'],['kicad_pcb','footprint']]){
 const source=`(${root} (${kind} (uuid part) (property "Reference" "R1") (property "VALUE_T" "10k" (effects (font (size 1 1)))) (pad "1" thru_hole circle (at 1 2) (size 2 2)) (polyline (pts (xy 1 2) (xy 3 4)))))`,ast=diff.parseMetadata(source),resolver=compat.textResolver(ast);
 assert.equal(resolver.resolve('${R1:VALUE_T}'),'10k');const object=ast.find(n=>Array.isArray(n)&&n[0]===kind);assert.equal(object.some(n=>Array.isArray(n)&&['pad','polyline'].includes(n[0])),false);
 }
});
