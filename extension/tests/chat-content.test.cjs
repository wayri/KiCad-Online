const test=require('node:test'),assert=require('node:assert/strict');
const chat=require('../chat-content.js'),comments=require('../review-comments.js');
function document(){
 class Node{
  constructor(tag,text){this.tagName=tag?.toUpperCase();this.children=[];this.attributes={};this._text=text||'';}
  append(...nodes){this.children.push(...nodes);}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=String(value);}
  set innerHTML(value){throw Error('Raw HTML is forbidden: '+value);}
 }
 return{createElement:tag=>new Node(tag),createTextNode:text=>new Node(undefined,text)};
}
const walk=node=>[node,...node.children.flatMap(walk)],tags=(node,tag)=>walk(node).filter(n=>n.tagName===tag.toUpperCase());
const sample=()=>({id:'chat-note',text:'Check U3\nConfirm **decoupling**.',createdAt:'2026-10-27T04:00:00.000Z',anchor:{repository:'owner/board',ref:'a'.repeat(40),file:'design/power.kicad_sch',uuid:'symbol-uuid',reference:'U3',kind:'symbol',position:{x:12.5,y:9}}});
const marker=value=>'<!-- kicad-review:v1 '+Buffer.from(JSON.stringify(value)).toString('base64url')+' -->';
test('Markdown renders as bounded semantic DOM while HTML and code stay inert',()=>{
 const result=chat.render(document(),'Hello **team** and *reviewer* @wayri.\n\n- first\n- [x] tested\n- [ ] pending\n\n> check `VCC`\n\n```html\n<img src=x onerror=alert(1)>\n<script>bad()</script>\n```\n\n<img src=x onerror=alert(1)>');
 assert.equal(tags(result,'strong')[0].textContent,'team');assert.equal(tags(result,'em')[0].textContent,'reviewer');assert.equal(tags(result,'li').length,3);
 assert.equal(tags(result,'blockquote').length,1);assert.equal(tags(result,'pre').length,1);assert.match(tags(result,'pre')[0].textContent,/<script>bad/);
 assert.equal(walk(result).find(n=>n.className==='chat-mention').textContent,'@wayri');
 assert.equal(tags(result,'img').length,0);assert.equal(tags(result,'script').length,0);assert.match(result.textContent,/<img src=x onerror=alert/);
 const statuses=walk(result).filter(n=>n.className==='chat-task-status');assert.deepEqual(statuses.map(n=>n.attributes['aria-label']),['Completed','Not completed']);
});
test('mentions respect provider usernames and do not turn email addresses into mentions',()=>{
 const github=chat.render(document(),'@alice. email@example.com @not_a_github_login @bob-smith');
 assert.deepEqual(walk(github).filter(n=>n.className==='chat-mention').map(n=>n.textContent),['@alice','@bob-smith']);
 const gitlab=chat.render(document(),'@alice.smith @team_member.',{provider:'gitlab'});
 assert.deepEqual(walk(gitlab).filter(n=>n.className==='chat-mention').map(n=>n.textContent),['@alice.smith','@team_member']);
});
test('links allow only explicit credential-free HTTP(S) and screenshots never load automatically',()=>{
 const result=chat.render(document(),'[design](https://example.com/board?q=1) ![capture](https://example.com/screenshot.png) [bad](javascript:alert(1)) [data](data:text/html,test) [local](file:///private) [custom](kicad://board) [relative](../board)');
 const links=tags(result,'a');assert.equal(links.length,2);assert.equal(links[0].href,'https://example.com/board?q=1');assert.match(links[1].textContent,/Open image: capture/);
 for(const link of links){assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');}
 assert.equal(tags(result,'img').length,0);
 for(const url of ['javascript:alert(1)','data:image/png;base64,abc','file:///x','https://user:password@example.com','https://example.com/\r\nfoo','../x','vscode://x'])assert.equal(chat.safeUrl(url),null);
});
test('canonical validated annotation becomes message text and small source-bound context metadata',()=>{
 const note=sample(),exported=comments.toMarkdown(note),body='Earlier conversation.\n\n'+exported+'\n\nA follow-up.';
 const result=chat.content(body);assert.equal(result.text,'Earlier conversation.\n\n'+note.text+'\n\nA follow-up.');
 assert.deepEqual(result.anchors,[comments.normalizeAnchor(note.anchor)]);assert.equal(result.invalidMetadata,false);assert.equal(result.truncated,false);
 assert.doesNotMatch(result.text,/Design context|kicad-review:v1|KiCad UUID|Repository \|/);
 const rendered=chat.render(document(),body);assert.match(rendered.textContent,/Earlier conversation/);assert.match(rendered.textContent,/decoupling/);assert.doesNotMatch(rendered.textContent,/symbol-uuid|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});

test('legacy and compact provider posts both reverse-sync to content and unchanged location metadata',()=>{
 for(const layout of ['legacy','compact'])for(const options of [{},{stateBadge:false},{severityBadge:false}]){
  const note=sample(),body=comments.toMarkdown(note,{layout,...options}),result=chat.content(body);
  assert.equal(result.text,note.text);assert.deepEqual(result.anchors,[comments.normalizeAnchor(note.anchor)]);
  const edited=chat.content(body.replace('Check U3','Review edited on provider'));
  assert.match(edited.text,/Review edited on provider/);assert.doesNotMatch(edited.text,/kicad-review:v1/);
 }
});
test('malicious or invalid annotation metadata is rejected and never becomes executable DOM or a context card',()=>{
 const bad={...sample(),anchor:{...sample().anchor,file:'../private.kicad_sch'}};
 const result=chat.content('Visible message\n'+marker(bad)+'\n<!-- kicad-review:v1 not-valid-json -->');
 assert.equal(result.anchors.length,0);assert.equal(result.invalidMetadata,true);assert.equal(result.text,'Visible message');assert.equal({}.polluted,undefined);
 const prototype=chat.content(marker({__proto__:{polluted:true},anchor:{repository:'x',ref:'javascript:bad',file:'bad'}}));assert.equal(prototype.anchors.length,0);
 const unclosed=chat.content('Safe\n<!-- kicad-review:v1 '+('x'.repeat(80000)));assert.equal(unclosed.text,'Safe');assert.equal(unclosed.truncated,true);
});
test('markers inside fenced or inline code stay literal and do not create annotation cards',()=>{
 const encoded=marker(comments.validateComment(sample()));
 for(const body of ['```markdown\n'+encoded+'\n```','`'+encoded+'`','```\n```not-a-close\n'+encoded+'\n```']){
  const result=chat.content(body);assert.equal(result.anchors.length,0);assert.match(result.text,/kicad-review:v1/);assert.equal(result.invalidMetadata,false);
 }
});
test('edited exported prose is retained rather than silently replaced with hidden metadata text',()=>{
 const exported=comments.toMarkdown(sample()).replace('Check U3','Important edited message');
 const result=chat.content(exported);assert.equal(result.anchors.length,1);assert.match(result.text,/Important edited message/);assert.doesNotMatch(result.text,/kicad-review:v1/);
});
test('validated attachment URLs are returned without creating images or issuing requests',()=>{
 const note=sample();note.attachments=[{provider:'github',repository:'owner/board',mime:'image/png',url:'https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc',width:640,height:480}];
 const result=chat.content(comments.toMarkdown(note));assert.deepEqual(result.attachments,note.attachments);assert.equal(result.anchors.length,1);
 const rendered=chat.render(document(),comments.toMarkdown(note));assert.equal(tags(rendered,'img').length,0);
});
test('large bodies, token storms and malformed Markdown have bounded DOM and explicit shortening notices',()=>{
 for(const source of ['😀'.repeat(50000),'['.repeat(65536),'`'.repeat(65536),Array.from({length:5000},(_,i)=>'- **item '+i+'**').join('\n')]){
  const parts=chat.content(source);assert.ok(Buffer.byteLength(parts.text)<=chat.MAX_BODY_BYTES+3);
  const rendered=chat.render(document(),source);assert.ok(walk(rendered).length<=chat.MAX_NODES+3);
 }
 const result=chat.render(document(),'line\n\n'.repeat(20000));assert.match(result.textContent,/Message shortened for display/);
 const malformed=chat.render(document(),'[unclosed **broken _text `literal');assert.match(malformed.textContent,/unclosed/);assert.equal(tags(malformed,'a').length,0);
});


test('old and coloured annotation bodies stay compact and retain severity without promoting code examples',()=>{
 for(const severityBadge of [false,true]){const note={...sample(),severity:'major'},result=chat.content(comments.toMarkdown(note,{severityBadge}));assert.equal(result.text,note.text);assert.deepEqual(result.severities,['major']);assert.equal(result.anchors.length,1);}
 const note={...sample(),severity:'level-1'},result=chat.content(comments.toMarkdown(note));assert.equal(result.text,note.text);assert.deepEqual(result.severities,['level-1']);assert.deepEqual(chat.content('```\n'+comments.toMarkdown(note)+'\n```').severities,[]);
});
