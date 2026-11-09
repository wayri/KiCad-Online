/* Synthetic semantic-DOM fixtures: these do not establish live GitHub acceptance. */
const test=require('node:test'),assert=require('node:assert/strict'),parser=require('../github-website-pulls.js'),{create}=require('../github-session-reader.js');
const repository='owner/board',url='https://github.com/'+repository+'/pull/42',anchor=(href,textContent='Board update')=>({getAttribute:()=>href,textContent});
const doc=(refs,canonical=url)=>({querySelector:()=>canonical?{getAttribute:()=>canonical}:null,querySelectorAll:selector=>selector.startsWith('.head-ref')?refs:[anchor('/'+repository+'/pull/42'),anchor('/foreign/board/pull/2')]});
test('semantic PR refs retain fork identity, never invent merge base or export page content',()=>{
 const value=parser.fromDocument(doc([anchor('/fork/board/tree/feature/power')]),{repository,number:42,url});assert.deepEqual(value,{repository,pullNumber:42,url,headRepository:'fork/board',headRef:'feature/power',mergeBase:null});
 assert.throws(()=>parser.fromDocument(doc([anchor('/fork/board/tree/main')],'https://github.com/other/repo/pull/42'),{repository,number:42,url}),/different/);
 assert.throws(()=>parser.fromDocument(doc([anchor('/fork/board/tree/main'),anchor('/owner/board/tree/main')]),{repository,number:42,url}),/readable/);
 assert.throws(()=>parser.validatePull({...value,headRef:'../secret'},repository,42));
});
test('PR list is bounded, exact repository scoped and explicitly partial',()=>{const value=parser.listFromDocument(doc([]),{repository});assert.equal(value.pulls.length,1);assert.equal(value.pulls[0].number,42);assert.equal(value.hasMore,true);assert.ok(value.warnings.length);});
test('PR transport stays in the bound repository website session',async()=>{
 let calls=0;const reader=create({location:{href:'https://github.com/'+repository},parsePullHTML:()=>doc([anchor('/'+repository+'/tree/feature')]),fetch:async(target,init)=>{calls++;assert.equal(target,url);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');const r=new Response('inert page',{headers:{'content-type':'text/html'}});Object.defineProperty(r,'url',{value:target});return r;}});
 const value=await reader.read({repository,ref:'HEAD',action:'pull',path:'42'});assert.equal(value.headRef,'feature');assert.equal(calls,1);
 for(const request of [{repository:'foreign/repo',ref:'HEAD',action:'pull',path:'42'},{repository,ref:'main',action:'pull',path:'42'},{repository,ref:'HEAD',action:'pull',path:'../42'}])await assert.rejects(reader.read(request));assert.equal(calls,1);
});
