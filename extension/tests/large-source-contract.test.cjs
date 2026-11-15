const test=require('node:test'),assert=require('node:assert/strict');
const data=require('../browser-data.js'),diff=require('../design-diff.js');
test('modern source requests have a 256 MiB ceiling and retain distinct legacy/report budgets',()=>{
 assert.equal(data.fileByteLimit('board.kicad_pcb'),256*1024*1024);assert.equal(data.fileByteLimit('root.kicad_sch'),256*1024*1024);
 assert.equal(data.fileByteLimit('legacy.sch'),8*1024*1024);assert.equal(data.fileByteLimit('report.json'),64*1024*1024);assert.equal(data.PROJECT_MAX_BYTES,512*1024*1024);
});
test('a valid schematic above the former 8 MiB ceiling passes retrieval, parsing and comparison',async()=>{
 const content='(kicad_sch ;'+ 'x'.repeat(9*1024*1024)+'\n (uuid large-root))';
 const files=await data.loadProject('owner/project','main','root.kicad_sch',async()=>content);
 assert.equal(files.length,1);assert.equal(diff.parse(content)[0],'kicad_sch');assert.deepEqual(diff.compareProjects(files,files).counts,{added:0,removed:0,modified:0});
 const builder=require('../net-model.js').createBuilder();assert.deepEqual(builder.build(files).nets,[]);assert.deepEqual(builder.build(files).nets,[]);builder.clear();
});
