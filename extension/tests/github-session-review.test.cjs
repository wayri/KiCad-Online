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
test('duplicated embedded issue snapshots and repository letter case preserve one conversation',()=>{
 const url='https://github.com/Owner/Repo/issues/7',time='2026-11-04T06:00:00Z';
 const issue={number:7,title:'Review',url,state:'OPEN',author:{login:'reviewer'},body:'Root',createdAt:time,updatedAt:time,totalCommentsCount:1,timelineItems:{nodes:[{url:url+'#issuecomment-99',author:{login:'colleague'},body:'Existing reply',createdAt:time}]}};
 let copy=JSON.parse(JSON.stringify(issue));const doc={querySelectorAll:()=>[{textContent:JSON.stringify({first:issue,second:copy})}]};
 const result=api.threadData(doc,'owner/repo',7);assert.equal(result.comments.length,1);assert.equal(result.comments[0].id,'99');
 copy.body='Conflicting root';assert.throws(()=>api.threadData(doc,'owner/repo',7),/conflicting/);
});
test('GitHub bot-authored issue comments do not prevent an entire conversation from loading',()=>{
 const url='https://github.com/owner/repo/issues/7',time='2026-11-04T06:00:00Z';
 const issue={number:7,title:'AI review',url,state:'OPEN',author:{login:'reviewer'},body:'Root',createdAt:time,updatedAt:time,timelineItems:{nodes:[{url:url+'#issuecomment-99',author:{login:'github-actions[bot]'},body:'CI review',createdAt:time}]}};
 const doc={querySelectorAll:()=>[{textContent:JSON.stringify({issue})}]};assert.equal(api.threadData(doc,'owner/repo',7).comments[0].author,'github-actions[bot]');
 issue.timelineItems.nodes[0].author.login='attacker[bot] extra';assert.throws(()=>api.threadData(doc,'owner/repo',7),/provenance/);
});
test('website catalogue can read same-repository DOM rows when no complete embedded Issue exists',async()=>{
 const link={textContent:'Existing issue',getAttribute:()=>'/Owner/Repo/issues/7',closest:query=>query.startsWith('[data-testid=')?({querySelector:selector=>selector.startsWith('.octicon-issue-opened')?{}:null}):null};
 const doc={querySelector:()=>null,querySelectorAll:query=>query==='a[href]'?[link]:[]};
 const reader=api.create({location:{href:'https://github.com/owner/repo'},document:doc,parseHTML:()=>doc,fetch:async()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}})});
 const result=await reader.dispatch({repository:'owner/repo',action:'list'});assert.equal(result.threads[0].number,7);assert.equal(result.threads[0].state,'open');
});
test('current React comment composer accepts its observed placeholder without a form or input name',()=>{
 const button={textContent:'Comment',isConnected:true,hidden:false,getClientRects:()=>[{}],closest:()=>null};
 const parent={tagName:'DIV',querySelectorAll:query=>query==='button'?[button]:[box]};
 const box={parentElement:parent,isConnected:true,hidden:false,getClientRects:()=>[{}],closest:()=>null,getAttribute:key=>key==='placeholder'?'Use Markdown to format your comment':null};
 const doc={getElementById:()=>null,querySelectorAll:()=>[box]};assert.equal(api.composer(doc).box,box);assert.equal(api.composer(doc).button,button);
});
test('new-Issue React controls require matching title/body and explicit verified commit',async t=>{
 const oldInput=global.HTMLInputElement,oldText=global.HTMLTextAreaElement;t.after(()=>{global.HTMLInputElement=oldInput;global.HTMLTextAreaElement=oldText;});
 class Input{constructor(){this._value='';this.isConnected=true;}set value(value){this._value=value;}get value(){return this._value;}getClientRects(){return [{}];}closest(){return null;}dispatchEvent(){}}
 class Textarea extends Input{}Object.defineProperty(Textarea.prototype,'value',Object.getOwnPropertyDescriptor(Input.prototype,'value'));
 global.HTMLInputElement=Input;global.HTMLTextAreaElement=Textarea;
 const title=new Input(),box=new Textarea();let clicks=0,account='reviewer',freshAccount='reviewer';const button={...new Input(),textContent:'Create (CtrlEnter)',getClientRects:()=>[{}],closest:()=>null,click:()=>{clicks++;}};
 const doc={querySelector:()=>({getAttribute:()=>account}),querySelectorAll:query=>query.includes('input[')?[title]:query.includes('textarea[')?[box]:query==='main button'?[button]:[]};
 const reader=api.create({location:{href:'https://github.com/owner/repo/issues/new'},document:doc,delay:async()=>{},parseHTML:()=>({querySelector:()=>({getAttribute:()=>freshAccount})}),fetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}})}),message={repository:'owner/repo',title:'Review title',body:'Review body'};
 const draft=await reader.dispatch({...message,action:'prepare-create'});assert.equal(title.value,message.title);assert.equal(box.value,message.body);
 await assert.rejects(reader.dispatch({repository:message.repository,action:'commit-create',ticket:draft.ticket}),/verification expired/);assert.equal(clicks,0);
 title.value='';box.value='';const next=await reader.dispatch({...message,action:'prepare-create'});
 freshAccount='another-account';await assert.rejects(reader.dispatch({repository:message.repository,action:'verify-create',ticket:next.ticket}),/account/);assert.equal(clicks,0);freshAccount='reviewer';
 await reader.dispatch({repository:message.repository,action:'verify-create',ticket:next.ticket});assert.equal((await reader.dispatch({repository:message.repository,action:'commit-create',ticket:next.ticket})).attempted,true);assert.equal(clicks,1);
});
test('native screenshot paste accepts bounded PNG dimensions and rejects mismatched or non-PNG data',()=>{
 const dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=';
 assert.ok(api.screenshotBytes({mime:'image/png',dataUrl,width:1,height:1}).length>24);
 assert.throws(()=>api.screenshotBytes({mime:'image/png',dataUrl,width:2,height:1}),/dimensions/);
 assert.throws(()=>api.screenshotBytes({mime:'image/svg+xml',dataUrl,width:1,height:1}),/Invalid/);
});
test('lease inspection refuses visible drafts, rich editors and exact new/settings routes without returning their text',()=>{
 const field={value:'unsent private draft',getClientRects:()=>[{}],closest:()=>null};const doc={querySelectorAll:()=>[field]},location={href:'https://github.com/owner/repo/issues/1'};
 assert.equal(api.leaseSafe(doc,location),false);field.value='';assert.equal(api.leaseSafe(doc,location),true);
 for(const path of ['/owner/repo/issues/new','/owner/repo/settings','/owner/repo/edit/main/board.kicad_sch'])assert.equal(api.leaseSafe(doc,{href:'https://github.com'+path}),false);
 field.isContentEditable=true;field.textContent='rich draft';assert.equal(api.leaseSafe(doc,location),false);
});
function discussionDocument({number=8,author='reviewer',state='open',writable=true}={}){
 const wrappers=[],raws=[],time='2026-11-10T06:00:00Z';
 for(const [id,body] of [['discussion-11273992','Root <!-- kicad-review:v1 keep -->'],['discussioncomment-19523839','Website reply']]){
  const wrapper={id},link={getAttribute:key=>key==='href'?'/'+author:null,closest:selector=>selector==='.js-comment-body'?null:wrapper},stamp={getAttribute:()=>time,closest:()=>wrapper};
  wrapper.querySelectorAll=selector=>selector.startsWith('a[')?[link]:[stamp];wrappers.push(wrapper);raws.push({getAttribute:key=>key==='data-target-body'?body:null,closest:()=>wrapper});
 }
 return {querySelector:selector=>selector.includes('.js-issue-title')?{textContent:'QA discussion'}:selector.includes('.gh-header-number')?{textContent:'#'+number}:selector==='meta[name="user-login"]'?{getAttribute:()=> 'reviewer'}:null,
  querySelectorAll:selector=>selector.startsWith('.js-edit-comment')?raws:selector==='button'?state==='unknown'?[]:[{textContent:state==='closed'?'Reopen discussion':'Close discussion'},{textContent:'Lock conversation'}]:selector==='form[action]'&&writable?[{getAttribute:()=>'/owner/repo/discussions/'+number+'/comments',querySelector:()=>({disabled:false,readOnly:false})}]:selector.startsWith('[id^=')?[wrappers[1]]:[]};
}
test('native Discussion snapshots preserve raw Markdown, exact author and comment URLs',()=>{
 const doc=discussionDocument(),thread=api.discussionData(doc,'owner/repo',8);
 assert.equal(thread.kind,'discussion');assert.equal(thread.title,'QA discussion');assert.equal(thread.comments[0].id,'19523839');assert.equal(thread.comments[0].url,'https://github.com/owner/repo/discussions/8#discussioncomment-19523839');assert.match(thread.body,/kicad-review:v1/);assert.equal(thread.capabilities.replyMode,'quoted');assert.equal(thread.state,'open');assert.match(thread.warnings.join(' '),/Incomplete Discussion coverage.*off-page/);
 assert.throws(()=>api.discussionData(doc,'owner/repo',9),/matching Discussion header/);
 const readonly=api.discussionData(discussionDocument({state:'unknown',writable:false}),'owner/repo',8);assert.equal(readonly.state,'unknown');assert.equal(readonly.locked,null);assert.equal(readonly.capabilities.create,false);
});
test('website Discussion categories and listing use only exact native repository links and exclude polls',async()=>{
 const link=(href,text)=>({textContent:text,getAttribute:key=>key==='href'?href:null,querySelector:()=>null});
 let view='categories';const doc={querySelector:()=>null,querySelectorAll:selector=>view==='categories'&&selector==='a[href]'?[
  link('/owner/repo/discussions/new?category=general','Get started with General category'),link('/owner/repo/discussions/new?category=polls','Get started with Polls category'),link('/other/repo/discussions/new?category=ideas','Foreign')]:view==='listing'&&selector==='h3 a[href]'?[link('/owner/repo/discussions/8','QA discussion'),link('/owner/repo/discussions/8','QA discussion'),link('https://evil.test/owner/repo/discussions/9','Foreign')]:[]};
 const requests=[],reader=api.create({location:{href:'https://github.com/owner/repo'},document:doc,parseHTML:()=>doc,fetch:async url=>{requests.push(url);return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});}});
 assert.deepEqual((await reader.dispatch({repository:'owner/repo',kind:'discussion',action:'categories'})).categories,[{id:'general',name:'General'}]);
 view='listing';const result=await reader.dispatch({repository:'owner/repo',kind:'discussion',action:'list'});assert.equal(result.threads.length,1);assert.equal(result.threads[0].kind,'discussion');assert.equal(result.threads[0].state,'unknown');assert.deepEqual(requests,['https://github.com/owner/repo/discussions/new/choose','https://github.com/owner/repo/discussions']);
});
test('native Discussion composers reject a changed form target and never choose Comment-and-close',()=>{
 let action='/owner/repo/discussions/8/comments',method='post';const form={getAttribute:key=>key==='action'?action:method};
 const button={form,textContent:'Comment',getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null},close={...button,getAttribute:()=> 'comment_and_close'},box={form,labels:[{textContent:'Comment'}],getAttribute:key=>key==='name'?'comment[body]':null,getClientRects:()=>[{}],closest:()=>null};
 box.parentElement={tagName:'FORM',querySelectorAll:query=>query==='button'?[button,close]:[box]};
 const doc={getElementById:()=>null,querySelectorAll:()=>[box]};assert.equal(api.composer(doc,{repository:'owner/repo',number:8,kind:'discussion'}).button,button);
 action='/other/repo/discussions/8/comments';assert.throws(()=>api.composer(doc,{repository:'owner/repo',number:8,kind:'discussion'}),/form target/);
 action='/owner/repo/discussions/8/comments';method='get';assert.throws(()=>api.composer(doc,{repository:'owner/repo',number:8,kind:'discussion'}),/form target/);
 action='/owner/repo/discussions';method='post';const title={...box},body={...box},start={...button,textContent:'Start discussion'},createDoc={querySelectorAll:query=>query.startsWith('main input')?[title]:query.startsWith('main textarea')?[body]:[start]};
 assert.equal(api.newDiscussionComposer(createDoc,'owner/repo').button,start);start.form={...form};assert.throws(()=>api.newDiscussionComposer(createDoc,'owner/repo'),/form target/);
});


test('modern semantic Issues list rows load open and completed KERO-style conversations without hydration data',async()=>{
 const list={getAttribute:key=>key==='aria-labelledby'?'issue-list-title':null,closest:selector=>selector==='main,[role="main"]'?{}:null};
 const link=(number,title,state,validList=true)=>{const row={closest:()=>validList?list:null,querySelector:selector=>selector.includes(state==='open'?'octicon-issue-opened':'octicon-issue-closed')?{}:null};return{textContent:title,getAttribute:()=>'/owner/repo/issues/'+number,closest:selector=>selector==='li,[role="listitem"]'?row:null};};
 const links=[link(17,'Review R19','open'),link(15,'Saved analysis','closed'),link(99,'Unrelated user-content list','open',false),{textContent:'Foreign',getAttribute:()=>'/other/repo/issues/18'}];
 const doc={querySelector:()=>({getAttribute:()=> 'reviewer'}),getElementById:id=>id==='issue-list-title'?{textContent:'Issues'}:null,querySelectorAll:selector=>selector==='a[href]'?links:[]};
 const reader=api.create({location:{href:'https://github.com/owner/repo'},parseHTML:()=>doc,fetch:async()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}})});
 const result=await reader.dispatch({repository:'owner/repo',action:'list'});assert.deepEqual(result.threads.map(n=>[n.number,n.state]),[[17,'open'],[15,'closed']]);
});


test('native GitHub HTML upload markup preserves exact draft, asset identity and image dimensions',()=>{
 const original='QA review\n<!-- kicad-review:v1 KEEP -->\n<!-- pocket-kiview-session:keep -->',url='https://github.com/user-attachments/assets/481c2623-67fc-44e2-9ea0-058b7900997c',capture={width:768,height:370};
 const image='<img width="768" height="370" alt="Image" src="'+url+'" />';
 assert.equal(api.uploadedScreenshot(original+'\n\n'+image,original,capture,url),true);
 assert.equal(api.uploadedScreenshot(original+'\n<img src="'+url+'" alt="Image" height="370" width="768">',original,capture,url),true);
 assert.equal(api.uploadedScreenshot(original+'\n![Image]('+url+')',original,capture,url),true);
 for(const altered of [image.replace('768','767'),image.replace('370','371'),image.replace('alt="Image"','alt="Image" onload="alert(1)"'),image.replace('alt="Image"','alt="Image" src="'+url+'"'),image.replace(url,'https://evil.test/image.png'),image+'extra text',image+'<script>alert(1)</script>',image+image,image.replace('alt="Image"','alt="Image" style="color:red"')])assert.equal(api.uploadedScreenshot(original+'\n'+altered,original,capture,url),false,altered);
 assert.equal(api.uploadedScreenshot(original.replace('KEEP','CHANGED')+'\n'+image,original,capture,url),false);
});
