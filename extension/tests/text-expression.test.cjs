const test=require('node:test'),assert=require('node:assert/strict');
const compat=require('../file-compatibility.js');
// Acceptance cases from the KiCad 10 schematic editor's Text expressions section:
// https://docs.kicad.org/10.0/en/eeschema/eeschema.html#text-expressions
const resolver=options=>compat.textResolver(['kicad_sch'],options);
test('documented native arithmetic, precedence and scientific numbers resolve',()=>{
 const cases=[['1 + 1','2'],['1 - 1','0'],['2 * 2','4'],['3 / 2','1.5'],['3 % 2','1'],['3 % -2','1'],['2 ^ 3','8'],['2 ^ 3 ^ 2','512'],['3 + 4 * 3','15'],['(3 + 4) * 3','21'],['2e3 + 1','2001']];
 for(const [source,expected]of cases)assert.equal(resolver().resolve('@{'+source+'}'),expected,source);
});
test('documented numeric function subset and nested evaluations resolve',()=>{
 const cases=[['abs(-1)','1'],['sqrt(4)','2'],['pow(2, 3)','8'],['floor(3.7)','3'],['ceil(3.2)','4'],['min(5, 3, 8, 1)','1'],['max(5, 3, 8, 1)','8'],['sum(1, 2, 3, 4)','10'],['avg(2, 4, 6)','4']];
 for(const [source,expected]of cases)assert.equal(resolver().resolve('@{'+source+'}'),expected,source);
 assert.equal(resolver().resolve('@{max(1, 2, 3)}, @{max(4, 5, 6)}'),'3, 6');
 assert.equal(resolver().resolve('@{1 + @{2 * 3}}'),'7');
});
test('numeric variables expand in their saved scope before expression evaluation',()=>{
 const detail=resolver({textVariables:{var:'-10'}}).inspect('@{max(abs(${var}), 5)}');assert.equal(detail.value,'10');assert.equal(detail.status,'resolved');assert.equal(detail.raw,'@{max(abs(${var}), 5)}');assert.equal(detail.variables[0].source,'Project');assert.equal(detail.fromExpression,true);
 const scoped=resolver({textVariables:{CONFIG:'99'},sheetContexts:[{fields:{CONFIG:'3'}}]});assert.equal(scoped.resolve('@{${CONFIG} * 2}'),'6');
 const props=scoped.properties({Value:'@{2 * 3}'});assert.equal(props.values.Value,'6');assert.equal(props.provenance.Value.expressions[0].raw,'@{2 * 3}');
});
test('invalid domains, zero divisors, unknown functions and units preserve the full expression',()=>{
 const inputs=['@{1 / 0}','@{1 % 0}','@{sqrt(-1)}','@{pow(2)}','@{min()}','@{1mm + 1in}','@{shunt(10k, 10k)}','@{random()}','@{round(1.5)}','@{1 < 2}','@{upper("hello")}','@{1e999}','@{1 + }','@{1 + @{sqrt(-1)}}','@{upper("}")}','@{1 + 2'];
 for(const input of inputs){const warnings=[],detail=compat.textResolver(['kicad_sch'],{},message=>warnings.push(message)).inspect(input);assert.equal(detail.value,input,input);assert.equal(detail.status,'unresolved',input);assert.ok(detail.expressions[0].reason,input);assert.ok(warnings.length,input);}
 assert.equal(resolver().resolve('@{sqrt(-1)} and @{2 + 3}'),'@{sqrt(-1)} and 5');
});
test('expressions cannot execute JavaScript, inspect objects, or access the environment',()=>{
 for(const source of ['globalThis.process.env.PATH','constructor.constructor("return 1")()','Math.abs(-1)','require("fs")','1;globalThis.x=2','[1][0]','(()=>1)()','__proto__','new Date()']){const input='@{'+source+'}';assert.equal(resolver().resolve(input),input);}
});
test('expression length, token count, depth and total expression counts are bounded',()=>{
 for(const input of ['@{'+'1+'.repeat(150)+'1}','@{'+'('.repeat(40)+'1'+')'.repeat(40)+'}','@{'+'1'.repeat(4100)+'}', '@{'.repeat(20)+'1'+'}'.repeat(20)]){const detail=resolver().inspect(input);assert.equal(detail.value,input);assert.equal(detail.status,'unresolved');assert.match(detail.expressions[0].reason,/limit/);}
 const many='@{1}'.repeat(130),result=compat.textExpressions(many);assert.equal(result.expressions.length,129);assert.equal(result.expressions[128].status,'unresolved');assert.match(result.expressions[128].reason,/count limit/);
 const long='x'.repeat(65536)+'@{1}';assert.equal(compat.textExpressions(long).value,long);
});
test('supported floating point operations have bounded numeric error',()=>{
 assert.ok(Math.abs(Number(resolver().resolve('@{0.1 + 0.2}'))-0.3)<1e-15);
 assert.ok(Math.abs(Number(resolver().resolve('@{sqrt(2)}'))-Math.SQRT2)<1e-15);
});

test('schematic table cells use the same saved variable and numeric expression resolver',()=>{
 const {parse}=require('../design-diff.js'),{build}=require('../schematic-renderer.js');
 const source='(kicad_sch (table (column_count 1) (column_widths 40) (row_heights 10) (uuid table) (cells (table_cell "@{${COUNT} * 2}" (at 10 10 0) (size 40 10) (span 1 1) (margins 1 1 1 1) (effects (font (size 1 1)))))))';
 const result=build(parse(source),'table.kicad_sch',{textVariables:{COUNT:'3'}});assert.equal(result.primitives.find(item=>item.kind==='table-cell'&&item.type==='text').text,'6');assert.ok(!result.warnings.some(w=>w.includes('expression')));
});
