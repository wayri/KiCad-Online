const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const code=fs.readFileSync(require.resolve('../github-session-review.js'),'utf8');
function harness(){
 const state={account:'reviewer',serverAccount:'reviewer',clicks:0,events:[],comments:[],post:true,clock:Date.now(),gets:0},location={href:'https://github.com/owner/repo/issues/1'};
 const button={disabled:false,textContent:'Comment',closest:()=>null,getClientRects:()=>[{}],click(){state.clicks++;if(state.post)state.comments.push({url:location.href+'#issuecomment-456',body:box.value,author:{login:state.account},createdAt:'2026-11-04T06:00:01Z',lastEditedAt:null});}};
 class Textarea{get value(){return this._value||'';}set value(value){this._value=value;}getClientRects(){return this.hidden?[]:[{}];}getAttribute(name){return name==='aria-label'?'Add a comment':null;}closest(){return null;}dispatchEvent(event){state.events.push(event.type);} }
 const box=new Textarea(),parent={tagName:'SECTION',parentElement:{tagName:'MAIN'},querySelectorAll:selector=>selector==='button'?[button]:[box]};box.parentElement=parent;
 const doc={querySelector:()=>({getAttribute:()=>state.account}),querySelectorAll:selector=>selector==='main textarea'?[box]:[]};
 const parsed=()=>({querySelector:()=>({getAttribute:()=>state.serverAccount}),querySelectorAll:selector=>selector==='script[type="application/json"]'?[{textContent:JSON.stringify({issue:{number:1,url:'https://github.com/owner/repo/issues/1',title:'QA',body:'root',state:'OPEN',author:{login:'reviewer'},createdAt:'2026-11-04T06:00:00Z',updatedAt:'2026-11-04T06:00:00Z',viewerCanComment:true,timelineItems:{nodes:state.comments}}})}]:[]});
 class Clock extends Date{static now(){return state.clock;}}
 const context={URL,Event,TextEncoder,TextDecoder,AbortController,Response,Date:Clock,crypto:webcrypto,HTMLTextAreaElement:Textarea,setTimeout,clearTimeout};vm.runInNewContext(code,context);
 const reader=context.KiCadGitHubSessionReview.create({document:doc,location,parseHTML:parsed,delay:async()=>{},fetch:async()=>{state.gets++;return new Response('<html>',{headers:{'content-type':'text/html'}});}});
 return {state,location,box,button,reader,api:context.KiCadGitHubSessionReview,doc};
}
const request={repository:'owner/repo',number:1,body:'QA body',action:'prepare'};
test('content composer prepares without posting, dispatches native input events, and commit clicks once with fresh actor check',async()=>{
 const h=harness(),preview=await h.reader.dispatch(request);assert.equal(h.state.clicks,0);assert.equal(h.box.value,'QA body');assert.deepEqual(h.state.events,['input','change']);
 await h.reader.dispatch({...request,action:'verify',ticket:preview.ticket});const result=await h.reader.dispatch({...request,action:'commit',ticket:preview.ticket});assert.equal(result.messageId,'456');assert.equal(h.state.clicks,1);assert.ok(h.state.gets>=3);
 await assert.rejects(h.reader.dispatch({...request,action:'commit',ticket:preview.ticket}),/expired/);assert.equal(h.state.clicks,1);
});
test('content composer preserves other drafts and rejects hidden, duplicate or disabled controls',async()=>{
 const h=harness();h.box.value='Existing personal draft';await assert.rejects(h.reader.dispatch(request),/another draft/);assert.equal(h.box.value,'Existing personal draft');assert.equal(h.state.clicks,0);
 h.box.value='';h.box.hidden=true;await assert.rejects(h.reader.dispatch(request),/composer/);h.box.hidden=false;h.button.disabled=true;await assert.rejects(h.reader.dispatch(request),/enabled/);assert.equal(h.state.clicks,0);
 const missing=harness();missing.doc.querySelectorAll=()=>[];
 await assert.rejects(missing.reader.dispatch(request),{code:'WEBSITE_ISSUE_COMPOSER_MISSING'});
 assert.equal(missing.state.clicks,0);
 const duplicate=harness();duplicate.doc.querySelectorAll=()=>[duplicate.box,duplicate.box];assert.throws(()=>duplicate.api.composer(duplicate.doc),/composer/);
});
test('navigation, draft edits, expiry, and website account changes after prepare prevent publication',async()=>{
 for(const change of [h=>h.location.href='https://github.com/owner/repo/issues/2',h=>h.box.value='Different draft',h=>h.state.clock+=31000,h=>h.state.account='other',h=>h.state.serverAccount='other']){
  const h=harness(),preview=await h.reader.dispatch(request);await h.reader.dispatch({...request,action:'verify',ticket:preview.ticket});change(h);await assert.rejects(h.reader.dispatch({...request,action:change.toString().includes('serverAccount')?'verify':'commit',ticket:preview.ticket}));assert.equal(h.state.clicks,0);
 }
});
test('existing identical comments are not falsely confirmed or sent twice, and unconfirmed sends never click again',async()=>{
 const h=harness();h.state.comments.push({url:'https://github.com/owner/repo/issues/1#issuecomment-100',body:'QA body',author:{login:'reviewer'},createdAt:'2026-11-04T06:00:00Z',updatedAt:'2026-11-04T06:00:00Z'});
 await assert.rejects(h.reader.dispatch(request),/already on GitHub/);assert.equal(h.state.clicks,0);
 const failed=harness(),preview=await failed.reader.dispatch(request);await failed.reader.dispatch({...request,action:'verify',ticket:preview.ticket});failed.state.post=false;await assert.rejects(failed.reader.dispatch({...request,action:'commit',ticket:preview.ticket}),/not confirmed/);assert.equal(failed.state.clicks,1);
 await assert.rejects(failed.reader.dispatch({...request,action:'commit',ticket:preview.ticket}),/expired/);assert.equal(failed.state.clicks,1);
});
