const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../github-session-review.js');
test('website reviews require exact repository session and reject unsafe scopes',()=>{
 for(const repository of ['owner/repo.evil','other/repo','owner/../repo','../repo','owner/repo?x'])assert.throws(()=>api.scope(repository,{href:'https://github.com/owner/repo/issues/1'}));
 for(const href of ['http://github.com/owner/repo','https://evil.test/owner/repo','https://github.com/owner/repository','https://name@github.com/owner/repo'])assert.throws(()=>api.scope('owner/repo',{href}));
 api.scope('owner/repo',{href:'https://github.com/owner/repo/issues/1'});
});
test('reverse sync extracts only issue-owned raw bodies and preserves annotation markers',()=>{
 const url='https://github.com/owner/repo/issues/1',time='2026-11-04T06:00:00Z';
 const issue={number:1,url,title:'Review',state:'OPEN',locked:false,viewerCanComment:true,author:{login:'reviewer'},createdAt:time,updatedAt:time,body:'Review <!-- kicad-review:v1 ABC -->',totalCommentsCount:1,timelineItems:{edges:[{node:{url:url+'#issuecomment-123',author:{login:'colleague'},createdAt:time,updatedAt:time,body:'Reply with **markdown**'}}],pageInfo:{hasNextPage:false}}};
 const doc={querySelectorAll:()=>[{textContent:JSON.stringify({payload:{repository:{issue}}})}]};
 const result=api.threadData(doc,'owner/repo',1);assert.equal(result.body,issue.body);assert.equal(result.comments[0].body,'Reply with **markdown**');assert.equal(result.capabilities.create,true);assert.equal(result.transport,'website-session');
 issue.timelineItems.edges.push({node:{...issue.timelineItems.edges[0].node,url:'https://github.com/other/repo/issues/1#issuecomment-999'}});
 assert.equal(api.threadData(doc,'owner/repo',1).comments.length,1);
 issue.url='https://github.com/other/repo/issues/1';doc.querySelectorAll=()=>[{textContent:JSON.stringify({issue})}];assert.throws(()=>api.threadData(doc,'owner/repo',1));
});
test('website compatibility diagnostics contain no form values or CSRF credentials',()=>{
 const input=name=>({getAttribute:key=>key==='name'?name:'SECRET-CSRF'});
 const form={getAttribute:key=>key==='action'?'/owner/repo/issue_comments':'post',querySelectorAll:()=>[input('authenticity_token'),input('comment[body]')]};
 const doc={querySelectorAll:query=>query==='form'?[form]:query==='textarea'?[]:[{textContent:'{"__typename":"Issue","secret":"SECRET-CSRF"}'}]};
 const result=api.diagnostics(doc,'owner/repo');assert.deepEqual(result.types,['Issue']);assert.doesNotMatch(JSON.stringify(result),/SECRET-CSRF/);assert.equal(result.forms[0].method,'post');
});

test('actual GitHub IssueComment timestamps use lastEditedAt or createdAt without rejecting the whole thread',()=>{
 const url='https://github.com/owner/repo/issues/1',time='2026-11-04T06:00:00Z',edited='2026-11-04T07:00:00Z';
 const node={__typename:'IssueComment',url:url+'#issuecomment-123',author:{login:'reviewer'},createdAt:time,lastEditedAt:null,body:'QA reply'};
 const issue={number:1,url,title:'QA',state:'OPEN',author:{login:'reviewer'},createdAt:time,updatedAt:time,body:'Description',totalCommentsCount:1,timelineItems:{edges:[{node}]}};
 const doc={querySelectorAll:()=>[{textContent:JSON.stringify({issue})}]};
 assert.equal(api.threadData(doc,'owner/repo',1).comments[0].updatedAt,time);
 node.lastEditedAt=edited;assert.equal(api.threadData(doc,'owner/repo',1).comments[0].updatedAt,edited);
 node.lastEditedAt='invalid';assert.throws(()=>api.threadData(doc,'owner/repo',1),/provenance/);
 node.lastEditedAt=null;delete issue.updatedAt;assert.throws(()=>api.threadData(doc,'owner/repo',1),/provenance/);
});
test('website session probe never uses API credentials and fails on redirects or missing login',async()=>{
 let calls=0;const doc={querySelector:()=>({getAttribute:()=> 'reviewer'}),querySelectorAll:()=>[]};
 const reader=api.create({location:{href:'https://github.com/owner/repo'},document:doc,parseHTML:()=>doc,fetch:async(url,init)=>{calls++;assert.equal(url,'https://github.com/owner/repo/issues/1');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,undefined);return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});}});
 assert.equal((await reader.dispatch({repository:'owner/repo',number:1,action:'inspect'})).account,'reviewer');assert.equal(calls,1);
 for(const number of [0,-1,1.5,'1'])await assert.rejects(reader.dispatch({repository:'owner/repo',number,action:'inspect'}));
 await assert.rejects(reader.dispatch({repository:'owner/repo',number:1,action:'post'}));assert.equal(calls,1);
});

test('website issue catalogue reports verified next-page coverage without following foreign or arbitrary URLs',async()=>{
 const record={number:7,title:'Existing review',url:'https://github.com/owner/repo/issues/7',state:'OPEN',author:{login:'reviewer'}};let href='/owner/repo/issues?page=2&q=is%3Aissue';
 const doc={querySelector:()=>({getAttribute:()=> 'reviewer'}),querySelectorAll:query=>query.startsWith('script')?[{textContent:JSON.stringify({items:[record]})}]:[{getAttribute:()=>href}]};
 const calls=[],reader=api.create({location:{href:'https://github.com/owner/repo'},document:doc,parseHTML:()=>doc,fetch:async(url,init)=>{calls.push(url);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});}});
 let result=await reader.dispatch({repository:'owner/repo',action:'list'});assert.equal(result.threads[0].number,7);assert.equal(result.hasMore,true);assert.equal(result.pagination,'website-only');assert.match(result.warnings.join(' '),/more Issues/);assert.equal(calls.length,1);
 for(href of ['https://evil.test/owner/repo/issues?page=2','/other/repo/issues?page=2','/owner/repo/pulls?page=2','https://name@github.com/owner/repo/issues?page=2','/owner/repo/issues?page=1','/owner/repo/issues?page=not-a-number']){result=await reader.dispatch({repository:'owner/repo',action:'list'});assert.equal(result.hasMore,false,href);assert.match(result.warnings.join(' '),/limited to the current result page/);}
});

test('public website conversations load without login while writing stays denied',async()=>{
 const time='2026-11-04T06:00:00Z',url='https://github.com/owner/repo/issues/7';
 const issue={number:7,title:'Public design review',url,state:'OPEN',author:{login:'reviewer'},body:'Public discussion',createdAt:time,updatedAt:time,viewerCanComment:true,totalCommentsCount:1,timelineItems:{nodes:[{url:url+'#issuecomment-99',author:{login:'colleague'},body:'Existing reply',createdAt:time}]}};
 const doc={querySelector:()=>null,querySelectorAll:query=>query.startsWith('script')?[{textContent:JSON.stringify({issue})}]:[]};
 const reader=api.create({location:{href:'https://github.com/owner/repo'},document:doc,parseHTML:()=>doc,fetch:async()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}})});
 const listed=await reader.dispatch({repository:'owner/repo',action:'list'});assert.equal(listed.account,null);assert.equal(listed.threads[0].title,issue.title);
 const result=await reader.dispatch({repository:'owner/repo',action:'read',number:7});assert.equal(result.comments[0].body,'Existing reply');assert.equal(result.account,null);assert.equal(result.capabilities.create,false);assert.equal(result.capabilities.reply,false);
 for(const action of ['prepare','inspect'])await assert.rejects(reader.dispatch({repository:'owner/repo',action,number:7,body:'Do not send'}),/Sign in/);
});
