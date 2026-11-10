const test=require('node:test'),assert=require('node:assert/strict');
const {mount}=require('../chat-panel.js'),comments=require('../review-comments.js');
const walk=node=>[node,...node.children.flatMap(walk)];
function harness(overrides={}){
 const events=new Map();let doc;
 class Node{
  constructor(tag,text=''){this.tagName=tag?.toUpperCase();this.children=[];this.attributes={};this.style={};this._text=text;this.hidden=false;this.value='';this.disabled=false;this.scrollTop=0;this.scrollHeight=1000;this.clientHeight=200;}
  append(...items){for(const item of items){item.remove();item.parentElement=this;this.children.push(item);}}
  replaceChildren(...items){for(const item of this.children)item.parentElement=null;this.children=[];this._text='';this.append(...items);}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}}
  set textContent(text){this._text=String(text);this.replaceChildren();this._text=String(text);}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name];}
  removeAttribute(name){delete this.attributes[name];if(name==='src')delete this.src;}
  contains(other){return this===other||this.children.some(child=>child.contains(other));}
  focus(){doc.activeElement=this;}setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  click(){this.clicked=(this.clicked||0)+1;return this.onclick?.();}
  set innerHTML(value){throw Error('Unsafe HTML assignment: '+value);}
 }
 doc={body:new Node('body'),createElement:tag=>new Node(tag),createTextNode:text=>new Node(undefined,text),addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const container=new Node('main');doc.body.append(container);const requests=[],confirmations=[],reads=[],saved=[],savedText=[],timers=[];let sequence=0;
 let scope={repository:'owner/board',ref:'a'.repeat(40),file:'board.kicad_pcb'};
 const host={addEventListener:(name,fn)=>events.set('host:'+name,fn),removeEventListener:name=>events.delete('host:'+name),crypto:{randomUUID:()=> 'mutation_'+String(++sequence).padStart(16,'0')},setTimeout:(fn,delay)=>{fn.delay=delay;timers.push(fn);return timers.length;},clearTimeout:id=>{timers[id-1]=null;},confirm:()=>true};
 const options={document:doc,host,container,provider:'github',repository:'owner/board',comments,getScope:()=>scope,
  request:async(type,payload)=>{requests.push({type,payload});return type==='comment-mention-users'?{users:[]}:{};},
  confirmSend:async value=>{confirmations.push(value);return true;},onRead:async(kind,number)=>reads.push({kind,number}),
  createAnnotation:(text,extra)=>comments.validateComment({id:extra.id,text,createdAt:'2026-10-27T05:00:00.000Z',severity:extra.severity,state:extra.state,anchor:{...scope,reference:'U3',uuid:'component-3',kind:'footprint'}}),
  onSaveDraft:async note=>saved.push(note),onSaveTextDraft:async draft=>savedText.push(draft),...overrides};
 const api=mount(options),find=className=>walk(container).find(node=>node.className?.split(' ').includes(className)),byId=id=>walk(container).find(node=>node.id===id);
 const type=text=>{const input=byId('chatMessageText');input.value=text;input.selectionStart=text.length;input.selectionEnd=text.length;input.oninput();return input;};
 return{api,doc,container,host,requests,confirmations,reads,saved,savedText,timers,events,find,byId,type,options,setScope:value=>{scope=value;},setRequest:fn=>{options.request=fn;}};
}
const thread=(number=1,extra={})=>({kind:'issue',number,title:'Review power stage',state:'open',id:String(number),author:'owner',body:'Root description',createdAt:'2026-10-27T04:00:00.000Z',updatedAt:'2026-10-27T04:00:00.000Z',comments:[{id:'12',author:'reviewer',body:'Check **U3**',createdAt:'2026-10-27T04:10:00.000Z',updatedAt:'2026-10-27T04:10:00.000Z',canReply:true,canEdit:false}],capabilities:{create:true,reply:true,edit:true,reactions:false},...extra});
const event=(key,extra={})=>({key,preventDefault(){this.prevented=true;},...extra});

test('unchanged polling preserves expanded message controls and focus; new messages preserve existing controls',()=>{
 const h=harness();h.api.render(thread());const menu=h.find('chat-message-more');menu.children[0].onclick(event('click'));menu.children[0].focus();
 h.api.render(thread());assert.equal(h.find('chat-message-more'),menu);assert.equal(menu.open,true);assert.equal(h.doc.activeElement,menu.children[0]);
 const value=thread();value.comments.push({id:'99',author:'owner',body:'New message',createdAt:'2026-10-27T05:00:00Z',updatedAt:'2026-10-27T05:00:00Z'});h.api.render(value);
 const retained=walk(h.container).find(n=>n.className==='chat-message-more'&&n.messageKey===menu.messageKey);assert.ok(retained);assert.equal(retained.open,true);assert.equal(h.doc.activeElement,retained.children[0]);h.api.dispose();
});

test('manual refresh keeps thread options open and asks for a refresh-only read',async()=>{
 const reads=[],h=harness({onRead:async(...args)=>reads.push(args)});h.api.render(thread());h.find('chat-options-toggle').onclick();await h.find('chat-refresh').onclick();
 assert.equal(h.find('chat-options-menu').hidden,false);assert.deepEqual(reads,[['issue',1,{refresh:true}]]);h.api.dispose();
});

test('image attachment has an immediate removable preview while normalization is pending',async()=>{
 let finish;const released=[],h=harness();h.host.URL={createObjectURL:()=> 'blob:bounded-preview',revokeObjectURL:url=>released.push(url)};h.host.KiCadCommentCompose={...require('../comment-compose.js'),normalizeCapture:()=>new Promise(resolve=>{finish=resolve;})};h.api.render(thread());
 const blob={type:'image/png',size:80,arrayBuffer:async()=>new ArrayBuffer(80)},pending=h.byId('chatMessageText').onpaste({clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>blob}]},preventDefault(){}});await new Promise(setImmediate);
 assert.equal(h.byId('chatCapturePreview').hidden,false);assert.equal(h.byId('chatCapturePreview').src,'blob:bounded-preview');assert.equal(h.find('chat-send').disabled,true);h.find('chat-remove-capture').onclick();assert.equal(h.byId('chatCapturePreview').hidden,true);assert.deepEqual(released,['blob:bounded-preview']);
 finish({mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',width:1,height:1});await pending;assert.equal(h.api.draft().capture,null);assert.equal(h.requests.length,0);h.api.dispose();
});
function messageAction(h,className){const action=h.find(className);assert.ok(action);const menu=action.parentElement.parentElement;assert.equal(menu.className,'chat-message-more');assert.equal(menu.parentElement.className,'chat-byline');menu.children[0].onclick(event('click'));assert.equal(menu.open,true);action.onclick();assert.equal(menu.open,false);return action;}
test('only explicit Send/Ctrl+Enter and approved confirmation post; ordinary Enter keeps multiline input',async()=>{
 const h=harness();h.api.render(thread());const input=h.type('Hello <script>bad()</script>');
 const enter=event('Enter');input.onkeydown(enter);assert.equal(enter.prevented,undefined);assert.equal(h.requests.length,0);
 h.options.confirmSend=async()=>false;await h.find('chat-send').onclick();assert.equal(h.requests.length,0);assert.equal(input.value,'Hello <script>bad()</script>');
 h.options.confirmSend=async value=>{h.confirmations.push(value);return true;};await h.find('chat-send').onclick();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].type,'chat-message-write');assert.equal(h.requests[0].payload.action,'create');assert.equal(h.confirmations.length,1);assert.equal(input.value,'');assert.deepEqual(h.reads,[{kind:'issue',number:1}]);
 h.type('Second');const ctrl=event('Enter',{ctrlKey:true});input.onkeydown(ctrl);await new Promise(setImmediate);assert.equal(ctrl.prevented,true);assert.equal(h.requests.length,2);
});
test('uncertain retries reuse one mutation ID, while changed text receives a fresh one',async()=>{
 const h=harness();h.api.render(thread());h.type('A message');h.setRequest(async(type,payload)=>{h.requests.push({type,payload});throw Error('Unconfirmed network result.');});
 await h.find('chat-send').onclick();await h.find('chat-send').onclick();assert.equal(h.requests[0].payload.clientMutationId,h.requests[1].payload.clientMutationId);assert.equal(h.api.hasDraft(),true);
 h.type('Changed message');await h.find('chat-send').onclick();assert.notEqual(h.requests[1].payload.clientMutationId,h.requests[2].payload.clientMutationId);
});
test('thread switching preserves drafts and confirmation cannot send into a different conversation',async()=>{
 let decide;const h=harness({confirmSend:()=>new Promise(resolve=>{decide=resolve;})});h.api.render(thread(1));h.type('Draft one');const sending=h.find('chat-send').onclick();
 h.api.render(thread(2));h.type('Draft two');decide(true);await sending;assert.equal(h.requests.length,0);assert.equal(h.byId('chatMessageText').disabled,false);
 h.api.render(thread(1));assert.equal(h.byId('chatMessageText').value,'Draft one');h.api.render(thread(2));assert.equal(h.byId('chatMessageText').value,'Draft two');
});
test('ten dirty thread drafts are never silently evicted; Save all uses original source snapshots',async()=>{
 const h=harness();for(let n=1;n<=10;n++){assert.equal(h.api.render(thread(n)),true);h.type('Draft '+n);}
 assert.equal(h.api.render(thread(11)),false);assert.match(h.find('chat-status').textContent,/Ten conversations/);assert.equal(h.api.draft().thread.number,10);
 h.setScope({repository:'owner/board',ref:'a'.repeat(40),file:'other.kicad_sch'});assert.equal(await h.api.saveDraft(true),true);assert.equal(h.savedText.length,10);assert.ok(h.savedText.every(saved=>saved.scope.file==='board.kicad_pcb'));assert.equal(h.api.hasDraft(),false);
 assert.equal(h.api.render(thread(11)),true);h.type('Discard this');h.api.discard(true);assert.equal(h.api.hasDraft(),false);assert.equal(h.requests.length,0);
});
test('message markup is inert, reply targets are explicit and edit actions honor verified permissions',async()=>{
 const own={id:'13',author:'me',body:'My original',createdAt:'2026-10-27T04:20:00.000Z',updatedAt:'2026-10-27T04:20:00.000Z',canReply:true,canEdit:true};
 const h=harness();h.api.render(thread(1,{body:'<img src=x onerror=bad()>',comments:[thread().comments[0],own]}));assert.ok(walk(h.container).filter(n=>n.tagName==='IMG').every(n=>n.hidden&&!n.src));assert.match(h.container.textContent,/<img src=x/);
 assert.equal(walk(h.container).filter(n=>n.className==='chat-edit-action').length,1);messageAction(h,'chat-reply-action');h.type('A reply');await h.find('chat-send').onclick();assert.equal(h.requests[0].payload.replyTo,'12');assert.equal(h.requests[0].payload.action,'reply');
 messageAction(h,'chat-edit-action');assert.equal(h.byId('chatMessageText').value,'My original');h.type('Edited');await h.find('chat-send').onclick();assert.equal(h.requests[1].payload.messageId,'13');assert.equal(h.requests[1].payload.expectedUpdatedAt,own.updatedAt);
 h.api.render(thread(2,{capabilities:{create:false,reply:false,edit:false}}));h.type('No permission');await h.find('chat-send').onclick();assert.equal(h.requests.length,2);assert.equal(h.byId('chatMessageText').disabled,true);
});
test('stale edits are retained without a write; source-bound context is not silently reanchored',async()=>{
 const own={...thread().comments[0],canEdit:true};const h=harness();h.api.render(thread(1,{comments:[own]}));messageAction(h,'chat-edit-action');h.type('My update');h.api.render(thread(1,{comments:[{...own,updatedAt:'2026-10-27T04:11:00.000Z'}]}));await h.find('chat-send').onclick();assert.equal(h.requests.length,0);assert.match(h.find('chat-status').textContent,/message changed/);assert.equal(h.byId('chatMessageText').value,'My update');
 h.api.discard();h.type('Drawing note');await h.find('chat-attach-context').onclick();const anchor=h.api.draft().annotation.anchor;
 h.setScope({repository:'owner/board',ref:'a'.repeat(40),file:'other.kicad_sch'});await h.find('chat-send').onclick();assert.equal(h.requests.length,0);assert.deepEqual(h.api.draft().annotation.anchor,anchor);assert.match(h.find('chat-status').textContent,/Source changed/);
});
test('attached note ID and text exactly match the confirmed write and local Save does not post',async()=>{
 const h=harness();h.api.render(thread());h.type('Review U3');await h.find('chat-attach-context').onclick();h.type('Review U3 decoupling @alice');await h.find('chat-send').onclick();const payload=h.requests[0].payload;
 assert.equal(payload.annotation.id,payload.clientMutationId);assert.equal(payload.annotation.text,payload.body);assert.equal(payload.annotation.threadType,'issue');assert.deepEqual(payload.annotation.mentions,['alice']);
 h.type('Save offline');await h.find('chat-attach-context').onclick();assert.equal(await h.api.saveDraft(),true);assert.equal(h.saved.length,1);assert.equal(h.requests.length,1);assert.equal(h.api.hasDraft(),false);
});
test('mention lookups ignore stale responses and insert only the chosen username',async()=>{
 let release;const h=harness();h.api.render(thread());h.setRequest((type,payload)=>{h.requests.push({type,payload});return new Promise(resolve=>{release=resolve;});});
 h.type('Hi @al');const pending=h.timers.at(-1)();h.type('Hi @bo');release({users:[{login:'alice'}]});await pending;assert.equal(h.find('chat-mention-suggestions').hidden,true);
 const next=h.timers.at(-1)();release({users:[{login:'bob'}]});await next;const suggestions=h.find('chat-mention-suggestions');assert.equal(suggestions.hidden,false);suggestions.children[0].onclick();assert.equal(h.byId('chatMessageText').value,'Hi @bob ');assert.equal(h.requests.every(r=>r.type==='comment-mention-users'),true);
});
test('paste normalizes a screenshot once and retains its original drawing context',async()=>{
 let finish;const h=harness();h.host.KiCadCommentCompose={normalizeCapture:()=>new Promise(resolve=>{finish=resolve;})};h.api.render(thread());h.type('Screenshot');
 const paste={clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>({type:'image/png'})}]},preventDefault(){this.prevented=true;}};
 const pending=h.byId('chatMessageText').onpaste(paste);await new Promise(setImmediate);h.setScope({repository:'owner/board',ref:'a'.repeat(40),file:'other.kicad_sch'});finish({mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAAA',width:10,height:10});await pending;
 assert.equal(paste.prevented,true);assert.equal(h.api.draft().capture.width,10);assert.equal(h.api.draft().annotation.anchor.file,'board.kicad_pcb');assert.equal(h.requests.length,0);
 assert.equal(h.byId('chatCapturePreview').hidden,false);assert.match(h.byId('chatCapturePreview').src,/^data:image\/png;base64,/);h.find('chat-remove-capture').onclick();assert.equal(h.api.draft().capture,null);assert.equal(h.byId('chatCapturePreview').src,undefined);assert.equal(h.api.draft().annotation.anchor.file,'board.kicad_pcb');
});
test('pending or discarded screenshot work cannot post early or reappear in a new draft',async()=>{
 let finish;const h=harness();h.host.KiCadCommentCompose={normalizeCapture:()=>new Promise(resolve=>{finish=resolve;})};h.api.render(thread());h.type('Wait for image');
 const pending=h.byId('chatMessageText').onpaste({clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>({type:'image/png'})}]},preventDefault(){}});await new Promise(setImmediate);
 assert.equal(h.find('chat-send').disabled,true);await h.find('chat-send').onclick();assert.equal(h.requests.length,0);assert.match(h.find('chat-status').textContent,/screenshot to finish/);
 h.api.discard();finish({mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAAA',width:10,height:10});await pending;assert.equal(h.api.draft().capture,null);assert.equal(h.api.hasDraft(),false);
});

const imageCapture={mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAAA',width:10,height:10};
async function chooseImage(h,file={type:'image/png'}){h.find('chat-attach-image').onclick();const picker=h.byId('chatImageInput');picker.files=[file];return picker.onchange();}
test('Attach image opens an accessible native chooser and uses the shared normalization and send review',async()=>{
 const h=harness();let normalized;h.host.KiCadCommentCompose={normalizeCapture:async blob=>{normalized=blob;return imageCapture;}};h.api.render(thread());const button=h.find('chat-attach-image'),picker=h.byId('chatImageInput');
 assert.equal(button.parentElement,h.find('chat-composer-options'));assert.equal(picker.type,'file');assert.equal(picker.accept,'image/png,image/jpeg,image/webp');assert.equal(picker.hidden,true);assert.equal(picker.getAttribute('aria-label'),'Choose image to attach');const file={type:'image/jpeg'};
 await chooseImage(h,file);assert.equal(picker.clicked,1);assert.equal(normalized,file);assert.equal(h.api.draft().capture.width,10);assert.equal(h.api.draft().annotation.anchor.file,'board.kicad_pcb');assert.equal(h.requests.length,0);assert.equal(h.confirmations.length,0);assert.equal(h.byId('chatCapturePreview').hidden,false);
 h.options.confirmSend=async()=>false;await h.find('chat-send').onclick();assert.equal(h.requests.length,0);assert.equal(h.api.hasDraft(),true);
 h.options.confirmSend=async value=>{h.confirmations.push(value);return true;};await h.find('chat-send').onclick();assert.equal(h.requests.at(-1).payload.body,'Screenshot');assert.ok(h.requests.at(-1).payload.annotation.capture);assert.equal(h.confirmations.length,1);
});
test('image picker cancellation, navigation, changed source and discarded drafts ignore late file selections',async()=>{
 for(const action of [h=>h.api.discard(),h=>h.api.render(thread(2)),h=>h.setScope({repository:'owner/board',ref:'b'.repeat(40),file:'other.kicad_sch'}),h=>h.api.dispose()]){
  const h=harness();let calls=0;h.host.KiCadCommentCompose={normalizeCapture:async()=>{calls++;return imageCapture;}};h.api.render(thread());h.find('chat-attach-image').onclick();const picker=h.byId('chatImageInput');action(h);picker.files=[{type:'image/png'}];await picker.onchange();assert.equal(calls,0);assert.equal(h.requests.length,0);
 }
 const h=harness();h.api.render(thread());h.find('chat-attach-image').onclick();const picker=h.byId('chatImageInput');picker.files=[];await picker.onchange();assert.equal(h.api.hasDraft(),false);assert.equal(h.requests.length,0);
});
test('pending chosen images cannot publish early or reappear after discard',async()=>{
 let finish;const h=harness();h.host.KiCadCommentCompose={normalizeCapture:()=>new Promise(resolve=>{finish=resolve;})};h.api.render(thread());const pending=chooseImage(h);await new Promise(setImmediate);assert.equal(h.find('chat-attach-image').disabled,true);assert.equal(h.find('chat-send').disabled,true);await h.find('chat-send').onclick();assert.equal(h.requests.length,0);h.api.discard();finish(imageCapture);await pending;assert.equal(h.api.draft().capture,null);assert.equal(h.api.hasDraft(),false);
});
test('Attach image is disabled for message editing and read-only conversations',async()=>{
 const h=harness();h.api.render(thread(1,{comments:[{...thread().comments[0],canEdit:true}]}));messageAction(h,'chat-edit-action');const picker=h.byId('chatImageInput');assert.equal(h.find('chat-attach-image').disabled,true);h.find('chat-attach-image').onclick();assert.equal(picker.clicked,undefined);
 h.find('chat-cancel-target').onclick();h.api.render(thread(1,{capabilities:{create:false,reply:false,edit:false}}));assert.equal(h.find('chat-attach-image').disabled,true);assert.equal(picker.disabled,true);h.find('chat-attach-image').onclick();assert.equal(picker.clicked,undefined);assert.equal(h.requests.length,0);
});
test('malformed and oversized selected images report errors without publishing or losing message text',async()=>{
 const h=harness();h.api.render(thread());h.type('Keep this caption');await chooseImage(h,new Blob(['bad'],{type:'text/plain'}));assert.match(h.find('chat-status').textContent,/PNG, JPEG or WebP.*8 MiB/);assert.equal(h.api.draft().capture,null);
 await chooseImage(h,{type:'image/png',size:8*1024*1024+1,arrayBuffer:async()=>new ArrayBuffer(0)});assert.match(h.find('chat-status').textContent,/8 MiB/);
 h.host.KiCadCommentCompose={normalizeCapture:async()=>{throw Error('Malformed image');}};await chooseImage(h,{type:'image/webp'});assert.match(h.find('chat-status').textContent,/Malformed image/);assert.equal(h.api.draft().text,'Keep this caption');assert.equal(h.requests.length,0);assert.equal(h.find('chat-send').disabled,false);
});
test('source cards link to their validated saved revision even when Locate refuses it',()=>{
 const h=harness({onLocate:()=>false}),note=comments.validateComment({id:'source-note',text:'Source note',createdAt:'2026-10-27T04:00:00.000Z',anchor:{repository:'owner/board',ref:'b'.repeat(40),file:'design/power.kicad_sch',reference:'U3'}});
 h.api.render(thread(1,{body:comments.toMarkdown(note)}));const link=h.find('chat-source-link');assert.equal(link.href,'https://github.com/owner/board/blob/'+('b'.repeat(40))+'/design/power.kicad_sch');assert.equal(link.rel,'noopener noreferrer');h.find('chat-locate').onclick();assert.match(h.find('chat-status').textContent,/another drawing or revision/);
});
test('cancelling an edit restores its previous draft and UTF-8 size bounds are enforced before confirmation',async()=>{
 const h=harness();h.api.render(thread(1,{comments:[{...thread().comments[0],canEdit:true}]}));h.type('Existing unsent draft');messageAction(h,'chat-edit-action');h.type('Edit content');h.find('chat-cancel-target').onclick();assert.equal(h.byId('chatMessageText').value,'Existing unsent draft');
 h.type('😀'.repeat(16000));await h.find('chat-send').onclick();assert.equal(h.requests.length,0);assert.match(h.find('chat-status').textContent,/60,000 UTF-8 bytes/);
});
test('new messages preserve reading position and offer Jump latest rather than forcing scroll',()=>{
 const h=harness();h.api.render(thread());const list=h.find('chat-messages');list.scrollTop=0;h.api.render(thread(1,{comments:[...thread().comments,{...thread().comments[0],id:'99',body:'New message'}]}));
 assert.equal(list.scrollTop,0);assert.equal(h.find('chat-jump-latest').hidden,false);assert.match(h.find('chat-jump-latest').textContent,/1 new message/);h.find('chat-jump-latest').onclick();assert.equal(list.scrollTop,list.scrollHeight);assert.equal(h.find('chat-jump-latest').hidden,true);
});
const latestTimer=h=>h.timers.findLast(fn=>!!fn);
const tick=h=>{const at=h.timers.findLastIndex(fn=>!!fn),fn=h.timers[at];assert.ok(fn,'a timer is scheduled');h.timers[at]=null;return fn();};
test('automatic refresh is enabled by default, visible-only and preserves drafts and reading position',async()=>{
 const h=harness();h.api.render(thread());h.type('Unsent message');const list=h.find('chat-messages');list.scrollTop=0;
 assert.equal(h.byId('chatAutoRefresh').checked,true);assert.equal(latestTimer(h).delay,3000);
 h.byId('chatAutoRefresh').checked=true;h.byId('chatAutoRefresh').onchange();assert.equal(latestTimer(h).delay,3000);
 h.options.onRead=async()=>{h.reads.push({number:1});h.api.render(thread(1,{comments:[...thread().comments,{...thread().comments[0],id:'new',body:'New automatic read'}]}));};
 await tick(h);assert.equal(h.reads.length,1);assert.equal(h.byId('chatMessageText').value,'Unsent message');assert.equal(list.scrollTop,0);assert.equal(h.find('chat-jump-latest').hidden,false);assert.equal(latestTimer(h).delay,3000);
 h.container.hidden=true;await tick(h);assert.equal(h.reads.length,1,'hidden catalog does not poll');
 h.container.hidden=false;h.doc.body.hidden=true;await tick(h);assert.equal(h.reads.length,1,'hidden ancestors pause polling');h.doc.body.hidden=false;
 h.container.checkVisibility=()=>false;await tick(h);assert.equal(h.reads.length,1,'CSS-hidden conversation does not poll');h.container.checkVisibility=()=>true;
 h.doc.hidden=true;h.events.get('visibilitychange')();assert.equal(latestTimer(h),undefined);h.doc.hidden=false;h.events.get('visibilitychange')();assert.equal(latestTimer(h).delay,1000);
 await tick(h);assert.equal(h.reads.length,2);
 h.byId('chatAutoRefresh').checked=false;h.byId('chatAutoRefresh').onchange();assert.equal(latestTimer(h),undefined);
});
test('manual and automatic refresh do not overlap, and failures back off to five minutes',async()=>{
 let finish;const h=harness();h.api.render(thread());h.options.onRead=()=>{h.reads.push({number:1});return new Promise(resolve=>{finish=resolve;});};
 h.byId('chatAutoRefresh').checked=true;h.byId('chatAutoRefresh').onchange();const polling=tick(h);await new Promise(setImmediate);const manual=h.find('chat-refresh').onclick();assert.equal(h.reads.length,1);assert.equal(latestTimer(h),undefined);
 finish(false);await polling;await manual;assert.equal(latestTimer(h).delay,6000);assert.match(h.find('chat-status').textContent,/could not be refreshed/);
 h.options.onRead=async()=>false;await tick(h);assert.equal(latestTimer(h).delay,12000);await tick(h);assert.equal(latestTimer(h).delay,24000);await tick(h);assert.equal(latestTimer(h).delay,48000);for(let i=0;i<4;i++)await tick(h);assert.equal(latestTimer(h).delay,300000);
 h.options.onRead=async()=>true;await tick(h);assert.equal(latestTimer(h).delay,3000,'successful read resets backoff');
 h.api.dispose();assert.equal(latestTimer(h),undefined);assert.equal(h.events.has('visibilitychange'),false);
});
test('disabling automatic refresh during a pending read prevents further polling',async()=>{
 let finish;const h=harness();h.api.render(thread());h.options.onRead=()=>new Promise(resolve=>{finish=resolve;});h.byId('chatAutoRefresh').checked=true;h.byId('chatAutoRefresh').onchange();const pending=tick(h);await new Promise(setImmediate);
 h.byId('chatAutoRefresh').checked=false;h.byId('chatAutoRefresh').onchange();finish(true);await pending;assert.equal(latestTimer(h),undefined);
});
test('an old failed refresh cannot overwrite a newly enabled polling schedule',async()=>{
 let finish;const h=harness();h.api.render(thread());h.options.onRead=()=>new Promise(resolve=>{finish=resolve;});const checkbox=h.byId('chatAutoRefresh');checkbox.checked=true;checkbox.onchange();const pending=tick(h);await new Promise(setImmediate);
 checkbox.checked=false;checkbox.onchange();checkbox.checked=true;checkbox.onchange();const restarted=latestTimer(h);finish(false);await pending;assert.equal(latestTimer(h),restarted);assert.equal(latestTimer(h).delay,3000);
});
test('compact chat shows only its header icons and +/Send strip until tools are requested',()=>{
 let back=0,settings=0,close=0;const h=harness({onBack:()=>back++,onSettings:()=>settings++,onClose:()=>close++,onAccount:()=>{}});h.api.render(thread());
 assert.equal(h.byId('chatMessageText').rows,2);assert.equal(h.find('chat-search').hidden,true);assert.equal(h.find('chat-options-menu').hidden,true);assert.equal(h.find('chat-composer-options').hidden,true);
 assert.deepEqual(h.find('chat-compose-actions').children.map(node=>node.className),['chat-attachment-toggle','chat-format-toggle','chat-send']);
 assert.deepEqual(h.find('chat-header').children.map(node=>node.className),['chat-back','chat-heading','review-state-badge chat-thread-badge','chat-options-toggle','chat-provider-link']);
 assert.equal(h.find('chat-thread-meta').parentElement,h.find('chat-options-menu'));assert.equal(h.find('chat-search-toggle').parentElement,h.find('chat-options-menu'));assert.equal(h.find('chat-close').parentElement,h.find('chat-options-menu'));assert.equal(h.find('chat-format-tools').hidden,true);assert.equal(h.find('chat-send').getAttribute('aria-label'),'Review and send');
 assert.equal(h.find('chat-refresh').parentElement,h.find('chat-options-menu'));assert.equal(h.find('chat-account').parentElement,h.find('chat-options-menu'));assert.equal(h.byId('chatAutoRefresh').parentElement.parentElement,h.find('chat-options-menu'));
 assert.equal(h.find('chat-save-draft').parentElement,h.find('chat-composer-options'));assert.equal(h.find('chat-attach-context').parentElement.parentElement,h.find('chat-composer-options'));
 assert.equal(h.find('chat-back').textContent,'‹');assert.equal(h.find('chat-back').getAttribute('aria-label'),'Conversations');assert.equal(h.find('chat-close').getAttribute('aria-label'),'Close conversation pane');
 h.find('chat-back').onclick();h.find('chat-close').onclick();assert.equal(back,1);assert.equal(close,1);
 h.find('chat-options-toggle').onclick();assert.equal(h.find('chat-options-menu').hidden,false);h.find('chat-settings').onclick();assert.equal(settings,1);assert.equal(h.find('chat-options-menu').hidden,true);
});

test('formatting is optional, edits the selected text, preserves focus and never posts',()=>{
 const h=harness();h.api.render(thread());const input=h.type('Check U3 now');input.setSelectionRange(6,8);
 h.find('chat-format-toggle').onclick();assert.equal(h.find('chat-format-tools').hidden,false);assert.equal(h.find('chat-format-toggle').getAttribute('aria-expanded'),'true');
 h.find('chat-format-tools').children[0].onclick();assert.equal(input.value,'Check **U3** now');assert.equal(h.api.draft().text,input.value);assert.equal(h.doc.activeElement,input);assert.equal(h.requests.length,0);
 h.find('chat-format-toggle').onclick();assert.equal(h.find('chat-format-tools').hidden,true);assert.equal(input.value,'Check **U3** now');
});

test('optional pane pin action stays in More, follows host state and never sends requests',()=>{
 const standalone=harness();standalone.api.render(thread());assert.equal(standalone.find('chat-pin').hidden,true);
 let pinned=false,calls=0;const h=harness({onPin:()=>{pinned=!pinned;calls++;},isPinned:()=>pinned});h.api.render(thread());
 const pin=h.find('chat-pin');assert.equal(pin.parentElement,h.find('chat-options-menu'));h.find('chat-options-toggle').onclick();assert.equal(pin.textContent,'Pin pane');pin.onclick();assert.equal(pinned,true);assert.equal(pin.textContent,'Unpin pane');assert.equal(pin.getAttribute('aria-pressed'),'true');assert.equal(h.find('chat-options-menu').hidden,true);
 h.find('chat-options-toggle').onclick();pin.onclick();assert.equal(pinned,false);assert.equal(pin.textContent,'Pin pane');assert.equal(calls,2);assert.equal(h.requests.length,0);
 pinned=true;h.find('chat-options-toggle').onclick();assert.equal(pin.textContent,'Unpin pane');assert.equal(h.find('chat-header').children.length,5);
});
test('tool popovers dismiss outside or Escape, search resets on close, and closing options does not stop enabled polling',()=>{
 const h=harness();h.api.render(thread());h.find('chat-options-toggle').onclick();h.byId('chatAutoRefresh').checked=true;h.byId('chatAutoRefresh').onchange();const polling=latestTimer(h);
 h.events.get('pointerdown')({target:h.doc.body});assert.equal(h.find('chat-options-menu').hidden,true);assert.equal(latestTimer(h),polling);
 h.find('chat-attachment-toggle').onclick();assert.equal(h.find('chat-composer-options').hidden,false);assert.equal(h.find('chat-attachment-toggle').getAttribute('aria-expanded'),'true');h.find('chat-options-toggle').onclick();assert.equal(h.find('chat-composer-options').hidden,true);
 const escape=event('Escape');h.events.get('keydown')(escape);assert.equal(escape.prevented,true);assert.equal(h.find('chat-options-menu').hidden,true);
 h.find('chat-search-toggle').onclick();assert.equal(h.find('chat-search').hidden,false);h.find('chat-search').value='no match';h.find('chat-search').oninput();assert.ok(h.find('chat-empty'));
 h.find('chat-search-toggle').onclick();assert.equal(h.find('chat-search').hidden,true);assert.equal(h.find('chat-search').value,'');assert.equal(h.find('chat-empty'),undefined);
 h.find('chat-attachment-toggle').onclick();assert.equal(h.api.closeMenus(),true);assert.equal(h.api.closeMenus(),false);
});
test('message safety actions live in accessible collapsed disclosures and close outside or on Escape',()=>{
 const h=harness({safetyActions:()=>{const actions=h.doc.createElement('div'),report=h.doc.createElement('button');report.textContent='Report user';actions.append(report);return actions;}});h.api.render(thread());
 assert.equal(h.find('chat-messages').tabIndex,0);const menus=walk(h.container).filter(node=>node.className==='chat-message-more');assert.equal(menus.length,2);assert.ok(menus.every(menu=>menu.open===false));assert.equal(menus[0].children[0].getAttribute('aria-label'),'Message options');
 const first=menus[0],second=menus[1];first.children[0].onclick(event('click'));assert.equal(first.open,true);second.children[0].onclick(event('click'));assert.equal(first.open,false);assert.equal(second.open,true);
 h.events.get('pointerdown')({target:h.doc.body});assert.equal(second.open,false);second.children[0].onclick(event('click'));const escape=event('Escape');h.events.get('keydown')(escape);assert.equal(second.open,false);assert.equal(escape.prevented,true);
 first.children[0].onclick(event('click'));assert.equal(h.api.closeMenus(),true);assert.equal(first.open,false);assert.ok(second.contains(h.find('chat-reply-action')),'Reply shares the message options menu');assert.equal(h.find('chat-message-actions'),undefined,'No persistent message action row');assert.ok(menus.every(menu=>menu.parentElement.className==='chat-byline'));
});

test('message source shares the options disclosure; blocked or read-only messages cannot reply or edit',()=>{
 const url='https://github.com/owner/board/issues/1#issuecomment-12',h=harness();h.api.render(thread(1,{comments:[{...thread().comments[0],url,canEdit:true}],capabilities:{create:false,reply:false,edit:false}}));const source=h.find('chat-message-source');assert.equal(source.href,url);assert.equal(source.rel,'noopener noreferrer');assert.equal(source.parentElement.parentElement.open,false);assert.equal(h.find('chat-reply-action'),undefined);assert.equal(h.find('chat-edit-action'),undefined);
 h.options.isBlocked=()=>true;h.api.render(thread(2,{comments:[{...thread().comments[0],url,canEdit:true}]}));assert.equal(h.find('chat-reply-action'),undefined);assert.equal(h.find('chat-edit-action'),undefined);assert.ok(h.find('chat-message-source'));assert.equal(h.requests.length,0);
 h.options.isBlocked=()=>false;h.api.render(thread(3,{url:'javascript:bad()',comments:[],capabilities:{}}));assert.equal(h.find('chat-message-source'),undefined);assert.equal(h.find('chat-message-more'),undefined);
});

test('typing a new draft clears the previous send status without posting again',async()=>{
 const h=harness();h.api.render(thread());h.type('First message');await h.find('chat-send').onclick();
 assert.match(h.find('chat-status').textContent,/Message sent/);h.type('A new unsent draft');
 assert.equal(h.find('chat-status').textContent,'');assert.equal(h.requests.filter(row=>row.type==='chat-message-write').length,1);
});

test('Close/Reopen stays in More, requires verified capability and explicit confirmation, preserves drafts',async()=>{
 const calls=[],confirmations=[],h=harness({onThreadState:async value=>calls.push(value),confirmThreadState:async value=>{confirmations.push(value);return false;}}),action=h.find('chat-thread-state');
 h.api.render(thread());assert.equal(action.hidden,true);h.api.render(thread(1,{capabilities:{create:true,canClose:true}}));assert.equal(action.hidden,false);assert.equal(action.parentElement.hidden,true);assert.equal(action.textContent,'Close issue');h.type('Keep my draft');await action.onclick();assert.equal(calls.length,0);
 h.options.confirmThreadState=async()=>true;await action.onclick();assert.equal(calls.length,1);assert.equal(calls[0].confirmed,true);assert.equal(calls[0].state,'closed');assert.equal(calls[0].expectedUpdatedAt,thread().updatedAt);assert.equal(h.byId('chatMessageText').value,'Keep my draft');assert.equal(h.requests.length,0);assert.equal(h.reads.length,1);
 h.api.render(thread(1,{state:'closed',capabilities:{canReopen:true}}));assert.equal(action.textContent,'Reopen issue');await action.onclick();assert.equal(calls[1].state,'open');
});
test('thread and source changes during state confirmation cancel the write',async()=>{
 for(const change of ['thread','scope']){let resolve;const calls=[],h=harness({onThreadState:async value=>calls.push(value),confirmThreadState:()=>new Promise(r=>resolve=r)});h.api.render(thread(1,{capabilities:{canClose:true}}));const pending=h.find('chat-thread-state').onclick();if(change==='thread')h.api.render(thread(2,{capabilities:{canClose:true}}));else h.setScope({repository:'other/board',ref:'b'.repeat(40),file:'board.kicad_pcb'});resolve(true);await pending;assert.equal(calls.length,0);}
});

test('participant buttons highlight multiple authors without claiming online presence',()=>{
 const h=harness();h.api.render(thread());const people=walk(h.container).filter(n=>n.className==='chat-participant');assert.equal(people.length,2);
 people[0].onclick();const second=walk(h.container).filter(n=>n.className==='chat-participant')[1];second.onclick();
 assert.equal(walk(h.container).filter(n=>n.className?.includes('chat-author-highlight')).length,2);
 assert.match(h.find('chat-participants').getAttribute('aria-label'),/not online presence/);
 assert.equal(h.byId('chatMessageText').value,'');assert.equal(h.requests.length,0);
});
test('provider shortcut accepts only the selected HTTPS provider origin',()=>{
 const h=harness();h.api.render(thread(1,{url:'https://github.com/owner/board/issues/1'}));assert.equal(h.find('chat-provider-link').hidden,false);assert.equal(h.find('chat-provider-link').href,'https://github.com/owner/board/issues/1');
 h.api.render(thread(1,{url:'https://attacker.example/thread'}));assert.equal(h.find('chat-provider-link').hidden,true);
 h.api.render(thread(1,{url:'javascript:alert(1)'}));assert.equal(h.find('chat-provider-link').hidden,true);
});
test('mixed clipboard text and image are retained and an image alone can be sent',async()=>{
 const h=harness();h.host.KiCadCommentCompose={normalizeCapture:async()=>({mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAAA',width:10,height:10})};h.api.render(thread());h.type('Before after');h.byId('chatMessageText').setSelectionRange(7,7);
 const paste=text=>({clipboardData:{getData:()=>text,items:[{kind:'file',type:'image/png',getAsFile:()=>({type:'image/png'})}]},preventDefault(){}});
 await h.byId('chatMessageText').onpaste(paste('caption '));assert.equal(h.byId('chatMessageText').value,'Before caption after');assert.equal(h.api.draft().capture.width,10);
 h.api.discard();await h.byId('chatMessageText').onpaste(paste(''));await h.find('chat-send').onclick();assert.equal(h.requests.at(-1).payload.body,'Screenshot');assert.ok(h.requests.at(-1).payload.annotation.capture);
});


test('attached review severity is selectable above the message and survives publication and compact thread rendering',async()=>{
 const h=harness();h.api.render(thread());h.type('Review U3');await h.find('chat-attach-context').onclick();const row=h.find('chat-annotation-level');assert.equal(row.hidden,false);assert.equal(row.parentElement,h.byId('chatMessageText').parentElement);assert.ok(row.parentElement.children.indexOf(row)<row.parentElement.children.indexOf(h.byId('chatMessageText')));assert.equal(row.parentElement.contains(h.find('chat-compose-actions')),false);assert.equal(h.find('chat-compose-actions').parentElement,h.find('chat-composer'));const severity=row.children[0];assert.deepEqual(severity.children.map(n=>n.value),['info','level-1','minor','major','critical']);severity.value='level-1';severity.onchange();assert.equal(severity.style.borderLeftColor,comments.severityInfo('level-1').color);
 await h.find('chat-send').onclick();assert.equal(h.requests[0].payload.annotation.severity,'level-1');
 const note={id:'remote-level',text:'Inspect this part',createdAt:'2026-10-27T05:00:00Z',severity:'level-1',anchor:{repository:'owner/board',ref:'a'.repeat(40),file:'board.kicad_pcb'}};
 h.api.render(thread(2,{comments:[{id:'13',author:'reviewer',body:comments.toMarkdown(note),createdAt:'2026-10-27T05:00:00Z'}]}));const badge=h.find('chat-review-severity');assert.equal(badge.textContent,'🟢 Level 1');assert.equal(badge.style.borderColor,comments.severityInfo('level-1').color);assert.doesNotMatch(h.find('chat-messages').textContent,/Design context/);h.api.dispose();
});


test('thread state badges and message filters infer issue closure without rewriting saved review data',()=>{
 const note={id:'state-note',text:'Connector review',createdAt:'2026-10-28T00:00:00Z',severity:'minor',state:'open',anchor:{repository:'owner/board',ref:'a'.repeat(40),file:'board.kicad_pcb'}},h=harness(),value=thread(1,{state:'closed',comments:[{id:'state-message',body:comments.toMarkdown(note),author:'reviewer',createdAt:'2026-10-28T00:00:00Z'}]});h.api.render(value,{state:'closed'});assert.equal(h.find('chat-thread-badge').textContent,'Closed');assert.equal(h.find('chat-review-state').textContent,'Closed');assert.equal(h.find('chat-review-state').attributes['data-state'],'closed');h.api.render(value,{state:'open'});assert.equal(h.find('chat-review-state'),undefined);assert.equal(note.state,'open');assert.equal(h.requests.length,0);h.api.dispose();
});

test('posting during an old read waits for a fresh post-acceptance readback',async()=>{
 let finish;const h=harness();h.api.render(thread());let count=0;h.options.onRead=()=>{count++;return count===1?new Promise(resolve=>finish=resolve):Promise.resolve(true);};
 const old=h.find('chat-refresh').onclick();await new Promise(setImmediate);h.type('New accepted message');const sending=h.find('chat-send').onclick();await new Promise(setImmediate);assert.equal(count,1);finish(true);await old;await sending;assert.equal(count,2);assert.equal(h.byId('chatMessageText').value,'');assert.equal(h.find('chat-status').textContent,'Message sent.');
});
test('mention lookup carries the collaboration provider and repository',async()=>{
 const h=harness({provider:'gitlab',repository:'group/subgroup/repo'});h.api.render(thread());h.type('Hi @ali');await h.timers.at(-1)();assert.equal(h.requests[0].payload.provider,'gitlab');assert.equal(h.requests[0].payload.repository,'group/subgroup/repo');
});

test('provider-confirmed message stays visible and accepted when post readback fails or returns stale content',async()=>{
 const h=harness({onRead:async()=>false});h.api.render(thread());let posts=0;h.setRequest(async(type)=>{assert.equal(type,'chat-message-write');posts++;return {provider:'github',kind:'issue',number:1,messageId:String(90+posts),author:'me',updatedAt:'2026-11-01T00:00:00Z',url:'https://github.com/owner/board/issues/1#issuecomment-'+(90+posts)};});
 h.type('Accepted first message');await h.find('chat-send').onclick();assert.match(h.container.textContent,/Accepted first message/);assert.match(h.container.textContent,/Sent · awaiting readback/);assert.equal(h.find('chat-status').className,'chat-status');assert.equal(h.api.hasDraft(),false);await tick(h);assert.equal(h.find('chat-status').className,'chat-status','background failure must not repaint an accepted post as an error');assert.equal(posts,1);
 h.type('Accepted second message');await h.find('chat-send').onclick();h.api.render(thread());assert.match(h.container.textContent,/Accepted first message/);assert.match(h.container.textContent,/Accepted second message/);assert.equal(posts,2);
 h.api.render(thread(1,{comments:[{id:'91',author:'me',body:'Accepted first message',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}]}));assert.match(h.container.textContent,/Accepted second message/);assert.equal(walk(h.container).filter(n=>n.className==='chat-readback-pending').length,1);assert.equal(posts,2);
});
test('host changes during send confirmation reject writes and source changes discard pending read success',async()=>{
 const before={provider:'gitlab',host:'https://gitlab.example.com',repository:'owner/board',ref:'main',file:'board.kicad_pcb'};let approve;const h=harness({provider:'gitlab',confirmSend:()=>new Promise(resolve=>approve=resolve)});h.setScope(before);h.api.render(thread());h.type('Keep draft');const send=h.find('chat-send').onclick();h.setScope({...before,host:'https://other.example.com'});approve(true);await send;assert.equal(h.requests.length,0);assert.equal(h.api.hasDraft(),true);
 let finish;h.options.onRead=()=>new Promise(resolve=>finish=resolve);const reading=h.find('chat-refresh').onclick();await new Promise(setImmediate);h.setScope({...before,ref:'newer'});finish(true);assert.equal(await reading,false);
});
test('observed conversation participants suggest mentions immediately when provider lookup is unavailable',async()=>{
 const h=harness();h.api.render(thread());h.setRequest(async()=>{throw Error('Provider unavailable');});h.type('Ask @rev');const list=h.find('chat-mention-suggestions');assert.equal(list.hidden,false);assert.equal(list.children[0].textContent,'@reviewer');await h.timers.at(-1)();assert.equal(list.hidden,false);list.children[0].onclick();assert.equal(h.byId('chatMessageText').value,'Ask @reviewer ');
});

test('offline visible conversations do not issue reads and reconnect immediately resumes bounded polling',async()=>{
 const h=harness();h.api.render(thread());h.host.navigator={onLine:false};await tick(h);assert.equal(h.reads.length,0);assert.equal(latestTimer(h).delay,30000);h.host.navigator.onLine=true;h.events.get('host:online')();assert.equal(latestTimer(h).delay,0);await tick(h);assert.equal(h.reads.length,1);assert.equal(latestTimer(h).delay,3000);h.api.dispose();assert.equal(h.events.has('host:online'),false);
});

test('website-session quoted replies are labelled before composing',()=>{const h=harness();const value=thread();value.capabilities.replyMode='quoted';h.api.render(value);const action=h.find('chat-reply-action');assert.equal(action.textContent,'Quote reply');action.onclick();assert.match(h.find('chat-compose-target').textContent,/Quoting @/);h.api.dispose();});

test('unknown website Discussion state is neutral rather than shown open',()=>{const h=harness();h.api.render(thread(1,{kind:'discussion',state:'unknown'}));assert.equal(h.find('chat-thread-badge').textContent,'State unavailable');assert.equal(h.find('chat-thread-badge').attributes['data-state'],'unknown');h.api.dispose();});

test('saving all drafts keeps each cleared conversation source snapshot for the next local draft',async()=>{
 const h=harness();h.api.render(thread(1));h.type('First draft');h.api.render(thread(2));h.type('Second draft');await h.api.saveDraft(true);
 h.api.render(thread(1));h.type('New draft in one');await h.api.saveDraft();assert.equal(h.savedText.at(-1).thread.number,1);assert.equal(h.savedText.at(-1).scope.file,'board.kicad_pcb');
});
