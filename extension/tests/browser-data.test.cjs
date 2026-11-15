const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../browser-data.js');

test('resolves a schematic hierarchy within the repository', async () => {
  const files = new Map([
    ['boards/root.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "sub/power.kicad_sch")))'],
    ['boards/sub/power.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "../root.kicad_sch")))']
  ]);
  const seen = [];
  const result = await data.loadProject('wayri/demo', 'abc123', 'boards/root.kicad_sch',
    async (_repo, _ref, path) => { seen.push(path); return files.get(path) ?? null; });
  assert.deepEqual(seen, ['boards/root.kicad_sch', 'boards/sub/power.kicad_sch']);
  assert.equal(result.length, 2);
});

test('rejects paths that escape the repository and invalid input', async () => {
  assert.equal(data.childPath('root.kicad_sch', '../secret.kicad_sch'), null);
  assert.equal(data.childPath('boards/root.kicad_sch', 'C:\\secret.kicad_sch'), null);
  await assert.rejects(data.loadProject('wayri/demo', 'main', '../bad.kicad_pcb', async () => ''),
    /Invalid GitHub project location/);
});

test('reports a missing root revision', async () => {
  await assert.rejects(data.loadProject('wayri/demo', 'abc123', 'board.kicad_pcb', async () => null),
    /HTTP 404.*wayri\/demo.*abc123.*board\.kicad_pcb.*access.*same browser profile/);
});

test('opening a leaf discovers its ancestor root and descendants, excluding unrelated siblings', async () => {
  const files = new Map([
    ['boards/root.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "sub/power.kicad_sch")) (sheet (property "Sheetfile" "display.kicad_sch")))'],
    ['boards/sub/power.kicad_sch', '(kicad_sch)'],
    ['boards/display.kicad_sch', '(kicad_sch)'],
    ['boards/unrelated.kicad_sch', '(kicad_sch)']
  ]);
  const directories = { 'boards/sub': ['boards/sub/power.kicad_sch'],
    boards: ['boards/root.kicad_sch', 'boards/display.kicad_sch', 'boards/unrelated.kicad_sch'],
    '': [] };
  const read = [], listed = [];
  const result = await data.loadProject('owner/board', 'main', 'boards/sub/power.kicad_sch',
    async (_repo, _ref, path) => { read.push(path); return files.get(path) ?? null; },
    async (_repo, _ref, directory) => { listed.push(directory); return directories[directory]; });
  assert.deepEqual(listed, ['boards/sub', 'boards', '']);
  assert.deepEqual(result.map((entry) => entry.path),
    ['boards/root.kicad_sch', 'boards/sub/power.kicad_sch', 'boards/display.kicad_sch']);
  assert.ok(read.includes('boards/unrelated.kicad_sch'), 'candidate must be inspected to exclude it');
  assert.equal(result.some((entry) => entry.path === 'boards/unrelated.kicad_sch'), false);
});

test('leaf discovery follows transitive parents and retains selected sheet without a parent', async () => {
  const files = new Map([
    ['root.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "boards/middle.kicad_sch")))'],
    ['boards/middle.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "sub/leaf.kicad_sch")))'],
    ['boards/sub/leaf.kicad_sch', '(kicad_sch)'],
    ['boards/unrelated.kicad_sch', '(kicad_sch)']
  ]);
  const listing = { 'boards/sub': ['boards/sub/leaf.kicad_sch'],
    boards: ['boards/middle.kicad_sch', 'boards/unrelated.kicad_sch'], '': ['root.kicad_sch'] };
  const read = async (_repo, _ref, path) => files.get(path) ?? null;
  const list = async (_repo, _ref, dir) => listing[dir];
  const result = await data.loadProject('owner/board', 'main', 'boards/sub/leaf.kicad_sch', read, list);
  assert.deepEqual(result.map((entry) => entry.path),
    ['root.kicad_sch', 'boards/middle.kicad_sch', 'boards/sub/leaf.kicad_sch']);
  files.set('root.kicad_sch', '(kicad_sch)');
  files.set('boards/middle.kicad_sch', '(kicad_sch)');
  const orphan = await data.loadProject('owner/board', 'main', 'boards/sub/leaf.kicad_sch', read, list);
  assert.deepEqual(orphan.map((entry) => entry.path), ['boards/sub/leaf.kicad_sch']);
});

test('leaf discovery falls back with a visible warning for unsafe or excessive listings', async () => {
  const read = async () => '(kicad_sch)';
  const unsafe = await data.loadProject('owner/board', 'main', 'boards/sub/leaf.kicad_sch', read,
    async () => ['../escape.kicad_sch']);
  assert.deepEqual(unsafe.map((entry) => entry.path), ['boards/sub/leaf.kicad_sch']);
  assert.match(unsafe[0].discoveryWarning, /unsafe schematic directory listing/);
  const crowded = await data.loadProject('owner/board', 'main', 'boards/sub/leaf.kicad_sch', read,
    async (_repo, _ref, directory) => directory === 'boards/sub' ?
      Array.from({ length: 129 }, (_, index) => `boards/sub/file${index}.kicad_sch`) : []);
  assert.match(crowded[0].discoveryWarning, /More than 128 parent-sheet candidates/);
  const deep = await data.loadProject('owner/board', 'main', 'a/b/c/d/e/f/g/h/i/leaf.kicad_sch', read,
    async () => []);
  assert.match(deep[0].discoveryWarning, /too deep/);
});

test('discovery API failure preserves the requested sheet and its child tree', async () => {
  const files = new Map([
    ['root.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "child.kicad_sch")))'],
    ['child.kicad_sch', '(kicad_sch)']
  ]);
  const result = await data.loadProject('owner/board', 'main', 'root.kicad_sch',
    async (_repo, _ref, path) => files.get(path) ?? null,
    async () => { throw new Error('GitHub directory unavailable'); });
  assert.deepEqual(result.map((entry) => entry.path), ['root.kicad_sch', 'child.kicad_sch']);
  assert.match(result[0].discoveryWarning, /directory unavailable/);
});

test('legacy schematic bytes still enforce the preview size limit', async () => {
  await assert.rejects(data.loadProject('owner/board', 'main', 'root.sch',
    async () => 'x'.repeat(8 * 1024 * 1024 + 1), async () => []), /size limit/);
});


test('sheet discovery ignores library properties, comments and text lookalikes',()=>{
 const source='(kicad_sch (lib_symbols (symbol "X" (property "Sheetfile" "fake.kicad_sch"))) ; (sheet (property "Sheetfile" "comment.kicad_sch"))\n (text "not a sheet") (sheet (property "Sheetfile" "real.kicad_sch")))';
 assert.deepEqual(data.sheetFiles(source),['real.kicad_sch']);
 assert.throws(()=>data.sheetFiles('(kicad_sch (sheet'),/Incomplete/);
});


test('nested GitLab namespaces remain provider scoped in project discovery', async () => {
  assert.equal(data.validRepository('group/subgroup/board'), false);
  assert.equal(data.validRepository('group/subgroup/board', 'gitlab'), true);
  for (const value of ['group/../board','group//board','group/board?token=secret','group/board\\file']) {
    assert.equal(data.validRepository(value, 'gitlab'), false);
  }
  assert.equal(data.validRepository('group/board', 'untrusted'), false);
  const result = await data.loadProject('group/subgroup/board','main','root.kicad_sch',
    async () => '(kicad_sch)', null, 'gitlab');
  assert.equal(result.length, 1);
});


test('PCB discovery permits large bounded boards without scanning them as schematic hierarchy', async () => {
  const board = '(kicad_pcb ' + ' '.repeat(9 * 1024 * 1024) + ')';
  const files = await data.loadProject('owner/board', 'main', 'large.kicad_pcb', async () => board);
  assert.equal(files.length, 1); assert.equal(files[0].content, board);
});


test('nested project hierarchy retains exact case and ignores asset folders for board retrieval', async () => {
  const files = new Map([
    ['Hardware/HPBM-SMALL.kicad_sch','(kicad_sch (sheet (property "Sheetfile" "SubSheets/Power.kicad_sch")))'],
    ['Hardware/SubSheets/Power.kicad_sch','(kicad_sch)'],
    ['Hardware/HPBM-SMALL.kicad_pcb','(kicad_pcb ' + ' '.repeat(2*1024*1024) + ')']
  ]);
  const reads = [];
  const reader = async (repo,ref,path) => {assert.equal(ref,'private-review');reads.push(path);return files.get(path) ?? null;};
  const board = await data.loadProject('owner/private','private-review','Hardware/HPBM-SMALL.kicad_pcb',reader);
  assert.deepEqual(board.map(file=>file.path),['Hardware/HPBM-SMALL.kicad_pcb']);
  const schematic = await data.loadProject('owner/private','private-review','Hardware/HPBM-SMALL.kicad_sch',reader);
  assert.deepEqual(schematic.map(file=>file.path),['Hardware/HPBM-SMALL.kicad_sch','Hardware/SubSheets/Power.kicad_sch']);
  assert.ok(reads.every(path=>!path.includes('packages3D')&&!path.includes('assets')));
});
test('KiCad 6 Sheet file properties load the hierarchy and exclude library lookalikes', async () => {
  const root = '(kicad_sch (version 20211123) (lib_symbols (symbol "Ignore" (property "Sheet file" "fake.kicad_sch"))) (sheet (property "Sheet name" "Power") (property "Sheet file" "SubSheets/Power.kicad_sch")) (sheet (property "Sheetfile" "USB.kicad_sch")))';
  assert.deepEqual(data.sheetFiles(root), ['SubSheets/Power.kicad_sch', 'USB.kicad_sch']);
  const files = new Map([['design/Marble.kicad_sch', root], ['design/SubSheets/Power.kicad_sch', '(kicad_sch)'], ['design/USB.kicad_sch', '(kicad_sch)']]);
  const loaded = await data.loadProject('wayri/Marble', 'main', 'design/Marble.kicad_sch', async (_repo, _ref, file) => files.get(file) ?? null);
  assert.deepEqual(loaded.map(file => file.path), [...files.keys()]);
});
test('hierarchy over 32 files uses bounded parallel reads and deduplicates reused sheets', async () => {
  const children = Array.from({ length: 40 }, (_, i) => `sheet${i}.kicad_sch`);
  const root = '(kicad_sch ' + [...children, children[0]].map(file => `(sheet (property "Sheet file" "${file}"))`).join(' ') + ')';
  let active = 0, peak = 0; const reads = [];
  const loaded = await data.loadProject('wayri/board', 'main', 'root.kicad_sch', async (_repo, _ref, file) => {
    reads.push(file); active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--;
    return file === 'root.kicad_sch' ? root : '(kicad_sch)';
  });
  assert.equal(peak, data.READ_CONCURRENCY); assert.equal(loaded.length, 41); assert.equal(reads.length, 41);
  assert.deepEqual(loaded.map(file => file.path), ['root.kicad_sch', ...children]);
});
test('hierarchy enforces its file cap independently of parent discovery', async () => {
  const root = '(kicad_sch ' + Array.from({ length: data.PROJECT_MAX_FILES }, (_, i) => `(sheet (property "Sheetfile" "sheet${i}.kicad_sch"))`).join(' ') + ')';
  await assert.rejects(data.loadProject('wayri/board', 'main', 'root.kicad_sch', async (_repo, _ref, file) => file === 'root.kicad_sch' ? root : '(kicad_sch)'), /128 files/);
});
test('repository model transport cache deduplicates loads, retries failures and bounds memory', async () => {
  let requests = 0;
  const cache = data.createModelAssetCache(async path => { requests++; await new Promise(resolve => setImmediate(resolve)); if (path === 'missing.wrl') throw new Error('missing'); return { base64: 'AAAA' }; }, 8);
  await Promise.all([cache.load('part.wrl'), cache.load('part.wrl')]); await cache.load('part.wrl'); assert.equal(requests, 1);
  await cache.load('other.wrl'); await cache.load('other.wrl'); assert.equal(requests, 3, 'assets beyond the cache budget are loaded without retaining them');
  await assert.rejects(cache.load('missing.wrl')); await assert.rejects(cache.load('missing.wrl')); assert.equal(requests, 5);
  cache.clear(); await cache.load('part.wrl'); assert.equal(requests, 6);
});
test('clearing the model cache prevents in-flight responses from repopulating it', async () => {
  let requests = 0, release;
  const cache = data.createModelAssetCache(async () => { requests++; if (requests === 1) await new Promise(resolve => { release = resolve; }); return { base64: 'AAAA' }; });
  const pending = cache.load('part.wrl'); cache.clear(); release(); await pending; await cache.load('part.wrl'); assert.equal(requests, 2);
});
test('unrelated discovery candidates cannot consume the requested hierarchy byte budget', async () => {
  const large = '(kicad_sch' + ' '.repeat(8 * 1024 * 1024 - 11) + ')';
  const root = '(kicad_sch (sheet (property "Sheet file" "sub/child.kicad_sch")))';
  const unrelated = Array.from({ length: 13 }, (_, i) => `unrelated${i}.kicad_sch`);
  const loaded = await data.loadProject('wayri/board', 'main', 'root.kicad_sch', async (_repo, _ref, file) => file === 'root.kicad_sch' ? root : large,
    async () => ['root.kicad_sch', ...unrelated]);
  assert.deepEqual(loaded.map(file => file.path), ['root.kicad_sch', 'sub/child.kicad_sch']);
  assert.match(loaded[0].discoveryWarning, /size limit/);
});


test('opening a leaf in a directory with more than 24 sheets retains its root and siblings',async()=>{
 const names=Array.from({length:30},(_,i)=>`design/child${i}.kicad_sch`),root='design/main.kicad_sch';const sources=new Map(names.map(p=>[p,'(kicad_sch)']));sources.set(root,'(kicad_sch '+names.map(p=>`(sheet (property "Sheetfile" "${p.split('/').at(-1)}"))`).join(' ')+')');
 const result=await data.loadProject('owner/board','main',names[0],async(_r,_ref,p)=>sources.get(p)??null,async(_r,_ref,d)=>d==='design'?[root,...names]:[]);assert.equal(result.length,31);assert.equal(result[0].path,root);assert.equal(result[0].discoveryWarning,undefined);
});

test('repository inventory discovers transitive parents in scattered folders using safe relative links', async () => {
  const files = new Map([
    ['design/main/root.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "../../electronics/power/middle.kicad_sch")) (sheet (property "Sheetfile" "../../shared/io.kicad_sch")))'],
    ['electronics/power/middle.kicad_sch', '(kicad_sch (sheet (property "Sheetfile" "../../shared/deep/leaf.kicad_sch")))'],
    ['shared/deep/leaf.kicad_sch', '(kicad_sch)'],
    ['shared/io.kicad_sch', '(kicad_sch)'],
    ['other/root.kicad_sch', '(kicad_sch)']
  ]);
  const read = async (_repository, ref, path) => { assert.equal(ref, 'snapshot'); return files.get(path) ?? null; };
  const loaded = await data.loadProject('owner/board', 'snapshot', 'shared/deep/leaf.kicad_sch', read,
    async () => { throw new Error('Full inventory should replace directory scanning'); }, 'github', async () => [...files.keys()]);
  assert.deepEqual(loaded.map(file => file.path), [...files.keys()].slice(0, 2).concat('shared/io.kicad_sch', 'shared/deep/leaf.kicad_sch'));
  assert.equal(data.rootSheetPath(loaded, 'shared/deep/leaf.kicad_sch'), 'design/main/root.kicad_sch');
  assert.equal(loaded[0].discoveryWarning, undefined);
});

test('root selection accepts converging parent branches and never guesses between multiple roots or cycles', async () => {
  const root = {path: 'roots/main.kicad_sch', content: '(kicad_sch (sheet (property "Sheetfile" "../a/middle.kicad_sch")) (sheet (property "Sheetfile" "../b/middle.kicad_sch")))'};
  const left = {path: 'a/middle.kicad_sch', content: '(kicad_sch (sheet (property "Sheetfile" "../shared/leaf.kicad_sch")))'};
  const right = {path: 'b/middle.kicad_sch', content: '(kicad_sch (sheet (property "Sheetfile" "../shared/leaf.kicad_sch")))'};
  const leaf = {path: 'shared/leaf.kicad_sch', content: '(kicad_sch)'};
  assert.equal(data.rootSheetPath([root, left, right, leaf], leaf.path), root.path);
  const ambiguous = [left, right, leaf];
  assert.equal(data.rootSheetPath(ambiguous, leaf.path), null);
  const read = async (_repository, _ref, path) => ambiguous.find(file => file.path === path)?.content ?? null;
  const loaded = await data.loadProject('owner/board', 'snapshot', leaf.path, read, null, 'github', async () => ambiguous.map(file => file.path));
  assert.equal(loaded.length, 3); assert.match(loaded[0].discoveryWarning, /multiple roots or a parent cycle/);
  const cycle = [left, {...leaf, content: '(kicad_sch (sheet (property "Sheetfile" "../a/middle.kicad_sch")))'}];
  assert.equal(data.rootSheetPath(cycle, leaf.path), null);
  const cyclic = await data.loadProject('owner/board', 'snapshot', leaf.path,
    async (_repository, _ref, path) => cycle.find(file => file.path === path)?.content ?? null,
    null, 'github', async () => cycle.map(file => file.path));
  assert.equal(cyclic.length, 2); assert.match(cyclic[0].discoveryWarning, /parent cycle/);
  const rootedCycle = [...cycle, {path: 'root.kicad_sch', content: '(kicad_sch (sheet (property "Sheetfile" "shared/leaf.kicad_sch")))'}];
  const retained = await data.loadProject('owner/board', 'snapshot', leaf.path,
    async (_repository, _ref, path) => rootedCycle.find(file => file.path === path)?.content ?? null,
    null, 'github', async () => rootedCycle.map(file => file.path));
  assert.equal(retained.length, 3); assert.equal(data.rootSheetPath(retained, leaf.path), null);
  assert.equal(retained[0].path, leaf.path); assert.match(retained[0].discoveryWarning, /parent cycle/);
});

test('repository parent inventory is bounded and unsafe links never authorize reads outside the repository', async () => {
  const reads = [];
  const read = async (_repository, _ref, path) => { reads.push(path); return '(kicad_sch (sheet (property "Sheetfile" "../../escape.kicad_sch")))'; };
  const loaded = await data.loadProject('owner/board', 'snapshot', 'folder/root.kicad_sch', read,
    null, 'github', async () => ['folder/root.kicad_sch']);
  assert.deepEqual(reads, ['folder/root.kicad_sch']); assert.equal(loaded.length, 1);
  const excessive = await data.loadProject('owner/board', 'snapshot', 'root.kicad_sch', async () => '(kicad_sch)',
    null, 'github', async () => Array.from({length: 129}, (_, index) => `folder/sheet${index}.kicad_sch`));
  assert.match(excessive[0].discoveryWarning, /More than 128/);
  const unsafe = await data.loadProject('owner/board', 'snapshot', 'root.kicad_sch', async () => '(kicad_sch)',
    null, 'github', async () => ['../outside.kicad_sch']);
  assert.match(unsafe[0].discoveryWarning, /unsafe schematic repository listing/);
  const unavailable = await data.loadProject('owner/board', 'snapshot', 'root.kicad_sch', async (_repo, _ref, path) => path === 'root.kicad_sch' ? '(kicad_sch)' : null,
    null, 'github', async () => ['root.kicad_sch', 'unavailable.kicad_sch']);
  assert.match(unavailable[0].discoveryWarning, /Parent-sheet source unavailable/);
});


test('saved variable metadata is read only when a retained drawing contains a variable token', async () => {
  const reads=[],root='(kicad_sch (sheet (property "Sheetfile" "child.kicad_sch")))',child='(kicad_sch (text "${PROJECT}"))';
  const sources={'hw/root.kicad_sch':root,'hw/child.kicad_sch':child,'hw/root.kicad_pro':JSON.stringify({text_variables:{PROJECT:'VNA'}})};
  const files=await data.loadProject('owner/repo','main','hw/root.kicad_sch',async(_repo,_ref,path)=>{reads.push(path);return sources[path]??null;});
  assert.deepEqual(reads,['hw/root.kicad_sch','hw/child.kicad_sch','hw/root.kicad_pro']);
  assert.equal(files[0].textVariables.PROJECT,'VNA');assert.equal(files[1].textVariables.PROJECT,'VNA');assert.equal(files[1].content,child);
  const plainReads=[],plain=await data.loadProject('owner/repo','main','root.kicad_pcb',async(_repo,_ref,path)=>{plainReads.push(path);if(path.endsWith('.kicad_pro'))throw Error('Unexpected metadata request');return '(kicad_pcb)';});
  assert.deepEqual(plainReads,['root.kicad_pcb']);assert.equal(plain[0].discoveryWarning,undefined);
});

test('variable-bearing drawings preserve metadata bounds, failures and cancellation',async()=>{
  const drawing='(kicad_pcb (gr_text "${PROJECT}"))';
  const bounded=await data.loadProject('owner/repo','main','root.kicad_pcb',async(_repo,_ref,path)=>path.endsWith('.kicad_pro')?JSON.stringify({text_variables:{PROJECT:'x'.repeat(16385)}}):drawing);
  assert.equal(bounded[0].textVariables,undefined);assert.match(bounded[0].discoveryWarning,/text variables unavailable/);
  const failed=await data.loadProject('owner/repo','main','root.kicad_pcb',async(_repo,_ref,path)=>{if(path.endsWith('.kicad_pro'))throw Error('Not accessible');return drawing;});
  assert.equal(failed[0].content,drawing);assert.match(failed[0].discoveryWarning,/Not accessible/);
  await assert.rejects(data.loadProject('owner/repo','main','root.kicad_pcb',async(_repo,_ref,path)=>{if(path.endsWith('.kicad_pro'))throw Error('Project loading cancelled.');return drawing;}),/cancelled/);
});


test('legacy child entry resolves its saved root before looking up the root cache library',async()=>{
 const root='EESchema Schematic File Version 2\n$Sheet\nS 100 100 200 200\nU 1234ABCD\nF0 "Power" 60\nF1 "sub/power.sch" 60\n$EndSheet\n$EndSCHEMATC\n',child='EESchema Schematic File Version 2\n$EndSCHEMATC\n',reads=[],sources={'hw/main.sch':root,'hw/sub/power.sch':child,'hw/main-cache.lib':'EESchema-LIBRARY Version 2.4\n#End Library\n'};
 const files=await data.loadProject('Ttl/vna2','2cf0efb22da56a168a7f07bf5e2c30631343997b','hw/sub/power.sch',async(_r,_s,path)=>{reads.push(path);return sources[path]??null;},null,'github',async()=>['hw/main.sch','hw/sub/power.sch']);
 assert.deepEqual(files.map(f=>f.path),['hw/main.sch','hw/sub/power.sch']);assert.equal(data.rootSheetPath(files,'hw/sub/power.sch'),'hw/main.sch');assert.equal(reads.filter(p=>p==='hw/main-cache.lib').length,1);assert.ok(!reads.includes('hw/sub/power-cache.lib'));assert.equal(files[0].legacyLibraries,files[1].legacyLibraries);
});
