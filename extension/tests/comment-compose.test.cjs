'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const compose=require('../comment-compose.js');

test('autocomplete distinguishes tags from issue references, code, email and URLs',()=>{
 assert.deepEqual(compose.autocompleteAt('Ask @al',7),{kind:'mention',start:4,end:7,query:'al'});
 assert.deepEqual(compose.autocompleteAt('Check #pow',10),{kind:'tag',start:6,end:10,query:'pow'});
 for(const text of ['#123','https://example.com/#power','mail#power@example.com','`#power`','```\n#power\n```'])assert.equal(compose.autocompleteAt(text,text.length),null,text);
 assert.deepEqual(compose.insertTag('Check #powxx next',10,'power'),{text:'Check #power next',cursor:13});
 assert.throws(()=>compose.insertTag('#pow',4,'../secret'),/Invalid tag/);
 assert.equal(compose.tagAt('#'+'x'.repeat(41),42),null);
});

test('suggestions rank exact and username prefix before matching display names, deduplicate and bound results',()=>{
 const rows=[{login:'other',name:'Alice Reviewer'},{login:'alice-two',name:'Bob'},{login:'alice',name:'Someone'},{login:'ALICE',name:'Duplicate'},{login:'bad user',name:'Alice'}];
 assert.deepEqual(compose.rankSuggestions(rows,'alice').map(row=>row.login),['alice','alice-two','other']);
 assert.deepEqual(compose.rankSuggestions(['power-rail',{name:'power'},{name:'unsafe tag'}],'power','tag').map(row=>row.name),['power','power-rail']);
 assert.equal(compose.rankSuggestions(Array.from({length:600},(_,i)=>({login:'user'+i})),'').length,12);
});

test('comment title always comes from the trimmed first line with a bounded length',()=>{
 assert.equal(compose.titleFromText('  Check connector clearance \r\nMore detail'),'Check connector clearance');
 assert.equal(compose.titleFromText('\nBody'),'');
 assert.equal(compose.titleFromText('Title\rBody'),'Title');
 assert.equal(compose.titleFromText('x'.repeat(300)).length,160);
 assert.equal(compose.titleFromText(undefined),'');
});
test('inline mention suggestions identify cursor token boundaries without matching emails or code',()=>{
 assert.deepEqual(compose.mentionAt('Please @ali check',11),{start:7,end:11,query:'ali'});
 assert.deepEqual(compose.mentionAt('@alice',3),{start:0,end:6,query:'al'});
 assert.deepEqual(compose.mentionAt('Hello @',7),{start:6,end:7,query:''});
 for(const [text,cursor] of [['mail@example.com',16],['@mail@example.com',5],['`@alice`',7],['```\n@alice\n```',10],['~~~text\n@alice\n~~~',14],['@alice',99]]) assert.equal(compose.mentionAt(text,cursor),null);
});
test('mention insertion replaces the whole active fragment and preserves comment text',()=>{
 assert.deepEqual(compose.insertMention('Hi @alxyz check',6,'alice'),{text:'Hi @alice check',cursor:10});
 assert.deepEqual(compose.insertMention('Hi @al\nnext',6,'user.name'),{text:'Hi @user.name \nnext',cursor:14});
 assert.deepEqual(compose.insertMention('Hi @',4,'bob'),{text:'Hi @bob ',cursor:8});
 assert.deepEqual(compose.insertMention('mail@example.com',9,'alice'),{text:'mail@example.com',cursor:9});
 assert.throws(()=>compose.insertMention('@al',3,'../bad'),/username/);
});
test('mention extraction is provider-aware, deduplicated, bounded and ignores emails and fenced or inline code',()=>{
 const text='@Alice @alice @bob. mail@example.com @mail@example.com `@hidden`\n```js\n@fenced\n```\n~~~\n@other\n~~~\n@user.name @under_score @bad--name';
 assert.deepEqual(compose.extractMentions(text),['Alice','bob','bad--name']);
 assert.deepEqual(compose.extractMentions(text,'gitlab'),['Alice','bob','user.name','under_score','bad--name']);
 assert.equal(compose.extractMentions(Array.from({length:25},(_,i)=>'@user'+i).join(' ')).length,20);
 assert.deepEqual(compose.extractMentions('@'+'a'.repeat(40)),[]);
 assert.deepEqual(compose.extractMentions('@'+'a'.repeat(255),'gitlab'),['a'.repeat(255)]);
 assert.deepEqual(compose.extractMentions('@'+'a'.repeat(256),'gitlab'),[]);
 assert.deepEqual(compose.extractMentions('`@hidden\n@visible'),['visible']);
});
function captureHarness({width=1600,height=800,render=()=> 'data:image/png;base64,iVBORw0KGgoAAAA',context=true}={}){
 const calls=[],image={width,height,close:()=>calls.push('close')};
 const canvas={width:0,height:0,getContext:()=>context?{drawImage:(_image,x,y,w,h)=>calls.push([x,y,w,h])}:null,toDataURL:type=>{calls.push(type);return render(canvas);}};
 return {calls,image,canvas,options:{decode:async()=>image,createCanvas:(w,h)=>{calls.push(['canvas',w,h]);return canvas;}}};
}
test('clipboard images become bounded PNG captures with aspect ratio and resource release',async()=>{
 for(const type of ['image/png','image/jpeg','image/webp']){
  const h=captureHarness(),blob=new Blob(['image'],{type}),capture=await compose.normalizeCapture(blob,h.options);
  assert.deepEqual(capture,{mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAA',width:1024,height:512});
  assert.deepEqual(h.calls[1],[0,0,1024,512]); assert.equal(h.calls.at(-1),'close');
  assert.equal(h.canvas.width,0);assert.equal(h.canvas.height,0);
 }
});
test('clipboard normalization rejects non-image, SVG, URL and excessive input before decoding',async()=>{
 let decoded=0; const options={decode:async()=>{decoded++;}};
 for(const blob of [null,'https://example.com/a.png',new Blob(['x'],{type:'image/svg+xml'}),new Blob(['x'],{type:'text/plain'}),new Blob([],{type:'image/png'}),{type:'image/png',size:8*1024*1024+1,arrayBuffer(){}}]) await assert.rejects(compose.normalizeCapture(blob,options),/PNG, JPEG or WebP/);
 assert.equal(decoded,0);
});
test('clipboard normalization rejects excessive decoded pixels and closes decoded resources on failure',async()=>{
 const blob=new Blob(['x'],{type:'image/png'});
 for(const dimensions of [{width:10000,height:10000},{width:0,height:5},{width:1.5,height:10}]){
  const h=captureHarness(dimensions);await assert.rejects(compose.normalizeCapture(blob,h.options),/dimensions/);assert.deepEqual(h.calls,['close']);
 }
 for(const config of [{context:false},{render:()=> 'data:image/svg+xml;base64,AAAA'},{render:()=>{throw Error('tainted canvas');}}]){
  const h=captureHarness(config);await assert.rejects(compose.normalizeCapture(blob,h.options));assert.equal(h.calls.at(-1),'close');assert.equal(h.canvas.width,0);
 }
});
test('clipboard normalization downsizes expensive images and gives up after eight bounded attempts',async()=>{
 const blob=new Blob(['x'],{type:'image/png'}),huge='data:image/png;base64,iVBORw0KGgo'+'A'.repeat(262144);
 let attempts=0;const h=captureHarness({render:()=>++attempts===3?'data:image/png;base64,iVBORw0KGgoAAAA':huge});
 const capture=await compose.normalizeCapture(blob,h.options);
 assert.equal(attempts,3);assert.equal(capture.width,576);assert.equal(capture.height,288);assert.ok(capture.dataUrl.length<=262144);
 const never=captureHarness({render:()=>huge});await assert.rejects(compose.normalizeCapture(blob,never.options),/too large/);
 assert.equal(never.calls.filter(value=>value==='image/png').length,8);assert.equal(never.calls.at(-1),'close');
});
test('comment navigation retains bounded back/forward routes and truncates abandoned forward history',()=>{
 const nav=compose.createNavigation(3);nav.push({page:'thread',kind:'issue',number:1});nav.push({page:'thread',kind:'discussion',number:2});assert.equal(nav.back().number,1);assert.equal(nav.canForward(),true);nav.push({page:'compose',category:'issue'});assert.equal(nav.canForward(),false);assert.equal(nav.back().number,1);assert.equal(nav.back().page,'catalog');nav.push({page:'thread',kind:'issue',number:3});nav.push({page:'thread',kind:'issue',number:4});nav.push({page:'thread',kind:'issue',number:5});assert.equal(nav.back().number,4);assert.equal(nav.back().number,3);assert.equal(nav.canBack(),false);assert.throws(()=>nav.push({page:'thread',kind:'issue',number:0}),/Invalid/);
});
