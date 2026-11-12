const test = require('node:test');
const assert = require('node:assert/strict');
const comments = require('../review-comments.js');

const sample = () => ({
  id: 'note-1', text: 'Check pin 3', createdAt: '2026-10-03T09:20:00.000Z',
  anchor: { repository: 'owner/board', ref: 'a'.repeat(40), file: 'design/root.kicad_sch',
    uuid: 'component-uuid', objectId: 'symbol-17', reference: 'U3', kind: 'symbol',
    position: { x: 23.5, y: -4.25 }, variant: 'default' }
});

test('comment round trip preserves the validated anchor and text', () => {
  const note = sample();
  const normalized = comments.validateComment({ ...note, ignored: 'not persisted' });
  assert.equal(normalized.ignored, undefined);
  assert.equal(normalized.severity, 'info', 'older notes default to informational severity');
  assert.deepEqual(comments.parseComments(comments.exportComments([note])), [normalized]);
  assert.match(comments.toMarkdown(note), /\| Position \(mm\) \| 23.5, -4.25 \|/);
});

test('rejects oversized text, invalid paths, positions, timestamps and imports', () => {
  assert.throws(() => comments.validateComment({ ...sample(), text: 'x'.repeat(4001) }), /4,000/);
  assert.throws(() => comments.validateComment({ ...sample(), anchor: { ...sample().anchor, file: '../root.kicad_sch' } }), /file/);
  assert.throws(() => comments.validateComment({ ...sample(), anchor: { ...sample().anchor, position: { x: Infinity, y: 1 } } }), /position/);
  assert.throws(() => comments.validateComment({ ...sample(), createdAt: '2026-02-31T09:20:00Z' }), /creation time/);
  assert.throws(() => comments.validateComment({ ...sample(), severity: 'blocker' }), /severity/);
  assert.throws(() => comments.parseComments('x'.repeat(1024 * 1024 + 1)), /1 MiB/);
  assert.throws(() => comments.parseComments('{'), /JSON/);
  assert.throws(() => comments.parseComments(comments.exportComments([sample(), sample()])), /Duplicate/);
  assert.throws(() => comments.exportComments(Array.from({ length: 101 }, (_, index) => ({ ...sample(), id: `note-${index}` }))), /Too many/);
});

test('escapes file and object metadata in a GitHub Markdown draft', () => {
  const note = sample();
  note.anchor.file = 'design/part](bad.example).kicad_sch';
  note.anchor.reference = 'U3*`[link]';
  const markdown = comments.toMarkdown(note);
  assert.match(markdown, /part\\\]\\\(bad\\\.example\\\)/);
  assert.match(markdown, /U3\\\*\\`\\\[link\\\]/);
  assert.match(markdown, /Check pin 3/);
  assert.match(markdown, /\| Severity \| Info \|/);
});

test('GitHub Markdown marker round-trips severity and ignores malformed or unrelated comments', () => {
  const note = { ...sample(), severity: 'critical', text: 'Fix this before release' };
  const markdown = comments.toMarkdown(note);
  assert.match(markdown, /\| Severity \| Critical \|/);
  assert.match(markdown, /<!-- kicad-review:v1 [A-Za-z0-9_-]+ -->/);
  assert.deepEqual(comments.fromMarkdown(`Unrelated discussion\n${markdown}\n<!-- kicad-review:v1 bad -->`),
    [comments.validateComment(note)]);
  assert.deepEqual(comments.fromMarkdown('<!-- kicad-review:v1 bad -->'), []);
  assert.throws(() => comments.fromMarkdown('😀'.repeat(300000)), /1 MiB/);
});

test('new skip state and mentions round-trip while older lifecycle states remain valid', () => {
  const note = { ...sample(), state:'skipped', mentions:['@alice','Bob','ALICE'],
    updatedAt:'2026-10-04T10:20:00.000Z' };
  const normalized = comments.validateComment(note);
  assert.deepEqual(normalized.mentions, ['alice','Bob']);
  assert.equal(normalized.state, 'skipped');
  assert.deepEqual(comments.parseSidecar(comments.serializeSidecar([note])), [normalized]);
  assert.match(comments.toMarkdown(note), /\| Mentions \| @alice, @Bob \|/);
  assert.match(comments.toMarkdown(note), /\| Updated \(UTC\) \| 2026-10-04T10:20:00\.000Z \|/);
  assert.deepEqual(comments.fromMarkdown(comments.toMarkdown(note)), [normalized]);
  for (const state of ['open','resolved','wont-fix']) assert.equal(comments.validateComment({...sample(),state}).state,state);
});

test('mention validation rejects injection and oversize input without changing shared state', () => {
  for (const mention of ['@', '@bad user', '@-bad', '@bad-', '@<script>', '@bad\nline', '@a'.repeat(50)]) {
    assert.throws(() => comments.validateComment({...sample(),mentions:[mention]}), /mention/);
  }
  assert.throws(() => comments.validateComment({...sample(),mentions:Array.from({length:21},(_,i)=>`user${i}`)}), /mentions/);
  assert.throws(() => comments.validateComment({...sample(),state:'done'}), /state/);
  assert.throws(() => comments.validateComment({...sample(),updatedAt:'2026-10-02T00:00:00Z'}), /precedes/);
  const markdown = comments.toMarkdown({...sample(),mentions:['@alice'],text:'@alice check <script>'});
  assert.match(markdown, /\| Mentions \| @alice \|/);
  assert.equal(markdown.includes('<script>'), false, 'note text is emitted as escaped plain Markdown');
});

test('GitHub body formats user text and drawing context safely while retaining the revision permalink and marker',()=>{
 const note={...sample(),threadType:'discussion',severity:'major',state:'resolved',text:'Check **spacing** | fast\n@alice <script>alert(1)</script>',tags:['placement|clearance'],mentions:['alice'],
  anchor:{...sample().anchor,repository:'owner/repo',ref:'feature/review',file:'design/a (rev)#1.kicad_pcb',kind:'footprint',reference:'J1|A',variant:'prototype'}};
 const markdown=comments.toMarkdown(note);
 assert.ok(markdown.startsWith('Check '));assert.match(markdown,/<details><summary>Design context · Major · Resolved<\/summary>/);assert.doesNotMatch(markdown,/^## /m);
 assert.match(markdown, /Check.*\n@alice/s);
 assert.equal(markdown.includes('<script>'),false);
 assert.ok(markdown.includes('| Destination type | Discussion |'));
 assert.ok(markdown.includes('| Component / object | J1\\|A (footprint) |'));
 assert.ok(markdown.includes('| Review state | resolved |'));
 assert.ok(markdown.includes('| Tags | placement\\|clearance |'));
 assert.ok(markdown.includes('| Position (mm) | 23.5, -4.25 |'));
 assert.ok(markdown.includes('| Revision | feature/review |'));
 assert.ok(markdown.includes('<https://github.com/owner/repo/blob/feature/review/design/a%20(rev)%231.kicad_pcb>'));
 assert.ok(markdown.includes('| Mentions | @alice |'));
 assert.match(markdown,/<!-- kicad-review:v1 [A-Za-z0-9_-]+ -->/);
 const netNote={...note,id:'net-note',anchor:{...note.anchor,kind:'net',reference:'SENSE | DATA',position:undefined,area:{x:1,y:2,width:3,height:4}}};
 const netBody=comments.toMarkdown(netNote);
 assert.ok(netBody.includes('| Net | SENSE \\| DATA |'));
 assert.ok(netBody.includes('| Area (mm) | 1, 2; 3 × 4 |')); assert.deepEqual(comments.fromMarkdown(markdown),[comments.validateComment(note)]);
});

const attachment=()=>({provider:'github',repository:'owner/board',mime:'image/png',url:'https://github.com/user-attachments/assets/01234567-89ab-cdef-0123-456789abcdef',width:200,height:100});
const gitlabAttachment=()=>({provider:'gitlab',host:'https://gitlab.example.org',repository:'group/sub/project',projectId:19,mime:'image/png',url:'https://gitlab.example.org/-/project/19/uploads/'+'a'.repeat(32)+'/kicad-review-'+'b'.repeat(20)+'.png',width:200,height:100});
test('GitLab screenshot metadata round trips and rejects other project identities and unsafe URLs',()=>{
 const a=gitlabAttachment(),note={...sample(),anchor:{...sample().anchor,provider:'gitlab',host:a.host,repository:a.repository},attachments:[a]};
 assert.deepEqual(comments.fromMarkdown(comments.toMarkdown(note))[0].attachments,[a]);
 for(const change of [{host:'https://another.example.org'},{repository:'group/other'},{projectId:20},{url:a.url+'?token=x'},{url:a.url+'#fragment'},{url:'https://evil.example/a.png'},{url:a.url.replace('/project/19/','/project/20/')},{url:a.url.replace('.png','.svg')}])assert.throws(()=>comments.validateComment({...note,attachments:[{...a,...change}]}),/attachment/i);
 assert.throws(()=>comments.validateComment({...sample(),attachments:[a]}),/attachment/i);
});
test('published screenshots render in Markdown and round trip without embedded image bytes',()=>{
  const note={...sample(),attachments:[attachment()],capture:{mime:'image/png',width:200,height:100,dataUrl:'data:image/png;base64,iVBORw0KGgo='}};
  const body=comments.toMarkdown(note);
  assert.match(body,/!\[Captured drawing area/);
  assert.ok(body.includes(attachment().url));
  assert.ok(!body.includes('attach it manually'));
  assert.ok(!body.includes(note.capture.dataUrl));
  const [read]=comments.fromMarkdown(body);
  assert.deepEqual(read.attachments,[attachment()]);
  assert.equal(read.capture,undefined);
});
test('attachment metadata rejects external hosts, URL injection and cross-provider records',()=>{
  for(const url of ['https://evil.example/image.png',attachment().url+'?token=secret',attachment().url+'#x','https://github.com@evil.example/user-attachments/assets/01234567-89ab-cdef-0123-456789abcdef',attachment().url+'/x']){
    assert.throws(()=>comments.validateComment({...sample(),attachments:[{...attachment(),url}]}),/attachment/);
  }
  assert.throws(()=>comments.validateComment({...sample(),attachments:Array(5).fill(attachment())}),/attachment/);
  assert.throws(()=>comments.validateAttachment({...attachment(),width:1025}),/attachment/);
  assert.throws(()=>comments.validateComment({...sample(),anchor:{...sample().anchor,provider:'gitlab',host:'https://gitlab.com'},attachments:[attachment()]}),/attachment/);
});
test('read receipts are per reader and revision; sorting age and read filters are independent', () => {
  const older = {...sample(),id:'old',createdAt:'2026-10-01T09:20:00.000Z',updatedAt:'2026-10-01T09:20:00.000Z'};
  const newer = {...sample(),id:'new',createdAt:'2026-10-03T09:20:00.000Z',updatedAt:'2026-10-04T09:20:00.000Z',state:'skipped'};
  const keyA = comments.receiptKey(newer,'Alice'), keyB = comments.receiptKey(newer,'bob');
  assert.notEqual(keyA,keyB);
  assert.equal(comments.isUnread(newer,'2026-10-03T10:00:00.000Z'),true);
  assert.equal(comments.isUnread(newer,'2026-10-04T09:20:00.000Z'),false);
  assert.deepEqual(comments.sortAndFilter([newer,older],{order:'oldest'}).map(n=>n.id),['old','new']);
  assert.deepEqual(comments.sortAndFilter([older,newer],{order:'newest'}).map(n=>n.id),['new','old']);
  assert.deepEqual(comments.sortAndFilter([older,newer],{read:'unread'},n=>n.id==='old'?n.updatedAt:undefined).map(n=>n.id),['new']);
  assert.deepEqual(comments.sortAndFilter([older,newer],{state:'skipped',query:'@alice'},()=>undefined),[]);
  assert.throws(() => comments.receiptKey(newer,'<bad>'), /reader/);
});

test('GitLab scopes preserve provider and subgroups while separating review receipts and import identities',()=>{
 const github=sample(),gitlab={...sample(),anchor:{...sample().anchor,provider:'gitlab'}};
 assert.equal(comments.normalizeScope({...gitlab.anchor,repository:'group/sub/project'}).repository,'group/sub/project');
 assert.throws(()=>comments.normalizeScope({...github.anchor,repository:'group/sub/project'}));
 assert.notEqual(comments.receiptKey(github,'alice'),comments.receiptKey(gitlab,'alice'));
 assert.equal(comments.parseComments(comments.exportComments([github,gitlab])).length,2);
 assert.equal(comments.parseSidecar(comments.serializeSidecar([github,gitlab])).length,2);
 assert.throws(()=>comments.normalizeScope({...gitlab.anchor,provider:'unknown'}));
});


test('Issue and Discussion types survive sidecar, export and GitHub marker round trips; legacy notes remain valid',()=>{
 const note={id:'typed',text:'Review connection',createdAt:'2026-10-04T00:00:00Z',anchor:{repository:'wayri/board',ref:'main',file:'board.kicad_pcb'}};
 for(const threadType of ['issue','discussion']){const value={...note,threadType};assert.equal(comments.parseSidecar(comments.serializeSidecar([value]))[0].threadType,threadType);assert.equal(comments.parseComments(comments.exportComments([value]))[0].threadType,threadType);assert.equal(comments.fromMarkdown(comments.toMarkdown(value))[0].threadType,threadType);}
 assert.equal(comments.validateComment(note).threadType,undefined);assert.throws(()=>comments.validateComment({...note,threadType:'pull-request'}),/thread type/);
});

 test('review filters group closed states and sort severity and dates without mutating notes',()=>{
 const states=['open','resolved','skipped','wont-fix'],severities=['minor','critical','major','info'];const notes=states.map((state,i)=>({...sample(),id:state,state,severity:severities[i],createdAt:`2026-10-0${i+1}T00:00:00Z`,updatedAt:`2026-10-0${4-i}T00:00:00Z`})),before=JSON.stringify(notes);
 const ids=f=>comments.sortAndFilter(notes,f).map(n=>n.id);
 assert.deepEqual(ids({state:'closed'}),['resolved','wont-fix']);assert.deepEqual(ids({state:'open'}),['open']);assert.deepEqual(ids({state:'skipped'}),['skipped']);assert.deepEqual(ids({state:'closed',severity:'info'}),['wont-fix']);
 assert.deepEqual(ids({order:'severity'}),['resolved','skipped','open','wont-fix']);assert.deepEqual(ids({order:'severity-lowest'}),['wont-fix','open','skipped','resolved']);assert.deepEqual(ids({order:'newest'}),['wont-fix','skipped','resolved','open']);assert.deepEqual(ids({order:'oldest'}),['open','resolved','skipped','wont-fix']);assert.deepEqual(ids({order:'updated'}),['open','resolved','skipped','wont-fix']);assert.deepEqual(ids({order:'updated-oldest'}),['wont-fix','skipped','resolved','open']);assert.equal(JSON.stringify(notes),before);
 assert.deepEqual(ids({state:'closed',read:'read'},()=>undefined),[]);assert.throws(()=>ids({state:'unknown'}),/filter/);
 });

 test('issue and discussion categories map remote conversations and retain unassigned legacy notes only in all',()=>{
 const notes=[{...sample(),id:'issue',threadType:'issue',state:'resolved'},{...sample(),id:'discussion',threadType:'discussion',state:'open'},{...sample(),id:'legacy'},{...sample(),id:'old-discussion',github:{source:'discussion-comment'}},{...sample(),id:'old-issue',remoteRefs:[{kind:'issue'}]}];
 assert.equal(comments.commentType(notes[2]),null);assert.equal(comments.commentType(notes[3]),'discussion');assert.equal(comments.commentType({...notes[0],github:{source:'discussion-comment'}}),'discussion');assert.equal(comments.commentType({remoteRefs:[{kind:'issue'},{kind:'discussion'}]}),null);
 assert.deepEqual(comments.sortAndFilter(notes,{threadType:'issue'}).map(n=>n.id),['issue','old-issue']);assert.deepEqual(comments.sortAndFilter(notes,{threadType:'discussion'}).map(n=>n.id),['discussion','old-discussion']);assert.deepEqual(comments.sortAndFilter(notes,{threadType:'issue',state:'closed'}).map(n=>n.id),['issue']);assert.equal(comments.sortAndFilter(notes,{threadType:'all'}).length,5);assert.throws(()=>comments.sortAndFilter(notes,{threadType:'chat'}),/filter/);
 });

test('created date filters include complete UTC days and normalize timestamp offsets without modifying notes',()=>{
 const times=['2026-10-02T23:59:59.999Z','2026-10-03T00:00:00.000Z','2026-10-03T23:59:59.999Z','2026-10-04T00:00:00Z','2026-10-03T01:00:00+02:00','2026-10-02T23:30:00-01:00'];
 const notes=times.map((createdAt,i)=>({...sample(),id:String(i),createdAt})),before=JSON.stringify(notes);
 const ids=filters=>comments.sortAndFilter(notes,{order:'oldest',...filters}).map(n=>n.id);
 assert.deepEqual(ids({createdFrom:'2026-10-03',createdTo:'2026-10-03'}),['1','5','2']);
 assert.deepEqual(ids({createdFrom:'2026-10-04'}),['3']);
 assert.deepEqual(ids({createdTo:'2026-10-02'}),['4','0']);
 assert.equal(ids({createdFrom:'',createdTo:''}).length,notes.length);
 assert.equal(JSON.stringify(notes),before);
});

test('created date restrictions validate real days and reject reversed ranges even for empty results',()=>{
 assert.deepEqual(comments.createdDateRange('2024-02-29','2024-02-29'),{from:Date.parse('2024-02-29T00:00:00Z'),until:Date.parse('2024-03-01T00:00:00Z')});
 assert.deepEqual(comments.createdDateRange(undefined,''),{from:undefined,until:undefined});
 for(const invalid of ['2026-02-29','2026-02-31','2026-04-31','2026-13-01','2026-00-01','2026-10-00','2026-1-01',' 2026-10-01','2026-10-01T00:00:00Z',null,123]){
  assert.throws(()=>comments.sortAndFilter([],{createdFrom:invalid}),/date filter/);
  assert.throws(()=>comments.sortAndFilter([],{createdTo:invalid}),/date filter/);
 }
 assert.throws(()=>comments.sortAndFilter([],{createdFrom:'2026-10-04',createdTo:'2026-10-03'}),/start.*end/);
});

test('created date restrictions combine with type, state, severity, read, search and sorting using creation time only',()=>{
 const base={...sample(),threadType:'issue',state:'resolved',severity:'major',text:'connector clearance',mentions:['alice']};
 const notes=[{...base,id:'old',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-04T00:00:00Z'}, {...base,id:'matching',createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',github:{createdAt:'2026-10-01T00:00:00Z'}}, {...base,id:'other-type',threadType:'discussion'}, {...base,id:'read'}, {...base,id:'open',state:'open'}];
 const filters={createdFrom:'2026-10-03',createdTo:'2026-10-03',threadType:'issue',state:'closed',severity:'major',read:'unread',query:'@alice'.slice(1),order:'updated'};
 assert.deepEqual(comments.sortAndFilter(notes,filters,n=>n.id==='read'?'2026-10-05T00:00:00Z':undefined).map(n=>n.id),['matching']);
});


test('five review levels preserve old notes, sort consistently and publish self-contained coloured severity banners',()=>{
 assert.deepEqual(comments.severityOptions.map(x=>x.value),['info','level-1','minor','major','critical']);
 const notes=comments.severityOptions.map(level=>({...sample(),id:'note-'+level.value,severity:level.value}));
 for(const [i,note]of notes.entries()){const level=comments.severityOptions[i],body=comments.toMarkdown(note);assert.ok(body.includes('<summary>Design context · '+level.label+' · '));assert.ok(body.includes('| Severity | '+level.label+' |'));assert.deepEqual(comments.fromMarkdown(body),[comments.validateComment(note)]);assert.ok(!body.includes('shields.io'));assert.equal(comments.severityInfo(note.severity),level);}
 assert.deepEqual(comments.sortAndFilter(notes).map(x=>x.severity),['critical','major','minor','level-1','info']);assert.equal(comments.sortAndFilter(notes,{severity:'level-1'})[0].id,'note-level-1');
 assert.deepEqual(comments.parseComments(comments.exportComments(notes)),notes.map(comments.validateComment));for(const value of ['level1','Level 1','__proto__',0])assert.equal(comments.isSeverity(value),false);
 assert.equal(comments.validateComment(sample()).severity,'info');
});


test('review states round-trip closed and skipped, infer provider state and retain legacy resolution filters',()=>{
 const states=['open','closed','skipped','resolved','wont-fix'];for(const state of states){const note={...sample(),state},body=comments.toMarkdown(note);assert.equal(comments.fromMarkdown(body)[0].state,state);assert.ok(body.includes(' · '+comments.stateInfo(state).label+'</summary>'));}
 const note={...sample(),state:'open',github:{state:'closed'}};assert.equal(comments.effectiveState(note),'closed');assert.equal(comments.sortAndFilter([note],{state:'closed'}).length,1);assert.equal(comments.sortAndFilter([note],{state:'open'}).length,0);assert.equal(note.state,'open');assert.equal(comments.effectiveState({...note,state:'skipped'}),'skipped');assert.equal(comments.effectiveState({...note,state:'resolved',github:{state:'open'}}),'open');
 assert.equal(comments.effectiveState(note,['closed',null]),'open');assert.equal(comments.effectiveState(note,['closed','open']),'open');assert.equal(comments.effectiveState(note,['closed','closed']),'closed');assert.equal(comments.effectiveState({...sample(),state:'open',github:{state:'opened'}}),'open');
 assert.equal(comments.sortAndFilter(states.map(state=>({...sample(),id:state,state})),{state:'closed'}).length,3);assert.equal(comments.sortAndFilter([{...sample(),state:'resolved'}],{state:'resolved'}).length,1);assert.throws(()=>comments.validateComment({...sample(),state:'done'}),/state/);
});

test('linked-state cache scopes repositories, hosts and conversation kinds and rejects stale snapshots',()=>{
 const cache=comments.createThreadStateCache(),scope={provider:'github',host:'https://github.com',repository:'owner/board'},note={...sample(),remoteRefs:[{kind:'issue',number:7,repository:'owner/board',url:'https://github.com/owner/board/issues/7',publishedAt:sample().createdAt}]};
 assert.equal(cache.remember(scope,{kind:'issue',number:7,state:'closed',updatedAt:'2026-10-29T02:00:00Z'}),true);assert.deepEqual(cache.states(note),['closed']);assert.equal(cache.remember(scope,{kind:'issue',number:7,state:'open',updatedAt:'2026-10-29T01:00:00Z'}),false);assert.deepEqual(cache.states(note),['closed']);
 const other={...note,remoteRefs:[{...note.remoteRefs[0],repository:'other/board',url:'https://github.com/other/board/issues/7'}]};assert.deepEqual(cache.states(other),[null]);assert.deepEqual(cache.states({...note,remoteRefs:[{...note.remoteRefs[0],kind:'discussion',url:'https://github.com/owner/board/discussions/7'}]}),[null]);
 const gl={...sample(),anchor:{...sample().anchor,provider:'gitlab',host:'https://gitlab.example'},remoteRefs:[{provider:'gitlab',host:'https://gitlab.example',kind:'discussion',repository:'team/board',number:7,url:'https://gitlab.example/team/board/-/issues/7'}]};assert.equal(cache.remember({provider:'gitlab',host:'https://gitlab.example',repository:'team/board'},{kind:'issue',number:7,state:'closed',updatedAt:'2026-10-29T02:00:00Z'}),true);assert.deepEqual(cache.states(gl),['closed']);assert.deepEqual(cache.states({...gl,remoteRefs:[{...gl.remoteRefs[0],host:'https://another.example',url:'https://another.example/team/board/-/issues/7'}]}),[null]);
 assert.deepEqual(comments.threadLinks({...note,remoteRefs:[{...note.remoteRefs[0],url:'https://evil.example/owner/board/issues/7'}]}),[]);assert.deepEqual(comments.threadLinks({...note,remoteRefs:[{...note.remoteRefs[0],number:8}]}),[]);cache.clear();assert.deepEqual(cache.states(note),[null]);
});

test('local and remote copies merge by exact source identity without rewriting either annotation',()=>{
 const local={...sample(),text:'New local text',updatedAt:'2026-10-29T02:00:00Z',remoteRefs:[{kind:'issue',number:7}]},remote={...sample(),text:'Older posted text',github:{state:'closed',source:'issue',number:7}},before=JSON.stringify([local,remote]),merged=comments.mergeAnnotations([local],[remote]);assert.equal(merged.length,1);assert.equal(merged[0].text,local.text);assert.equal(merged[0].github.state,'closed');assert.equal(merged[0].remoteRefs.length,1);assert.equal(JSON.stringify([local,remote]),before);assert.equal(comments.mergeAnnotations([local],[{...remote,anchor:{...remote.anchor,ref:'b'.repeat(40)}}]).length,2);
});

test('thread readback imports only exact-source active anchors with provider provenance and full area/sheet metadata',()=>{
 for(const provider of ['github','gitlab']){
  const scope={repository:'owner/board',ref:'main',file:'design/root.kicad_sch',...(provider==='gitlab'?{provider,host:'https://gitlab.example.com'}:{})},base=provider==='gitlab'?'https://gitlab.example.com/owner/board/-/issues/7':'https://github.com/owner/board/discussions/7';
  const note={...sample(),anchor:{...scope,sheetUuid:'11111111-2222-3333-4444-555555555555',sheetName:'Power',position:{x:3,y:4},area:{x:1,y:2,width:3,height:4}}},body=comments.toMarkdown(note),thread={kind:provider==='github'?'discussion':'issue',number:7,state:'open',url:base,body:'Description',author:'owner',comments:[{id:'8',body,url:base+'#comment-8',author:'alice',createdAt:note.createdAt,updatedAt:note.createdAt},{id:'9',body:'```markdown\n'+body+'\n```',url:base+'#comment-9',author:'bob'},{id:'10',body:comments.toMarkdown({...note,anchor:{...note.anchor,ref:'other'}}),url:base+'#comment-10',author:'bob'}]};
  const imported=comments.threadAnnotations(thread,scope);assert.equal(imported.length,1);assert.deepEqual(imported[0].anchor,note.anchor);assert.equal(imported[0].github.author,'alice');assert.equal(imported[0].github.number,7);assert.equal(imported[0].github.url,base+'#comment-8');assert.equal(comments.threadAnnotations({...thread,url:'https://evil.example/thread'},scope).length,0);
 }
});
test('source sheet identity uses the saved root UUID rather than a symbol UUID or fabricated board identity',()=>{
 const root='11111111-2222-3333-4444-555555555555',symbol='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';assert.equal(comments.sourceSheetUuid(`(kicad_sch (uuid "${root}") (symbol (uuid "${symbol}")))`),root);assert.equal(comments.sourceSheetUuid(`(kicad_sch (symbol (uuid "${symbol}")))`),null);assert.equal(comments.sourceSheetUuid(`(kicad_pcb (footprint (uuid "${symbol}")))`),null);assert.equal(comments.sourceSheetUuid('(kicad_sch (uuid "invalid"))'),null);
});

test('property and BoM review targets survive provider Markdown and local export',()=>{
 for(const provider of ['github','gitlab'])for(const surface of ['property','bom']){
  const note=sample();if(provider==='gitlab')Object.assign(note.anchor,{provider,host:'https://gitlab.com'});
  note.anchor.reviewTarget={surface,field:'Value',value:'10k | <script> & Ω',references:['U3','U4']};
  const valid=comments.validateComment(note),markdown=comments.toMarkdown(valid);
  assert.deepEqual(comments.fromMarkdown(markdown)[0].anchor,valid.anchor);
  assert.deepEqual(comments.parseComments(comments.exportComments([valid]))[0].anchor,valid.anchor);
  assert.match(markdown,/Reviewed value/);assert.match(markdown,/BoM references/);
  assert.equal(valid.anchor.uuid,'component-uuid');assert.deepEqual(valid.anchor.position,{x:23.5,y:-4.25});
 }
});
test('review field context is bounded and cannot introduce arbitrary target kinds',()=>{
 for(const target of [{surface:'url',field:'Value',value:'x'},{surface:'bom',field:'',value:'x'},{surface:'property',field:'Value',value:'x'.repeat(4001)},{surface:'bom',field:'Value',value:'x',references:Array(101).fill('R1')}]){
  assert.throws(()=>comments.normalizeAnchor({...sample().anchor,reviewTarget:target}),/comment/);
 }
});
