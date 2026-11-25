const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../analysis-data.js');const M=require('../simulation-workbook.js');
const dir=path.join(__dirname,'fixtures/simulation/native'),read=n=>fs.readFileSync(path.join(dir,n),'utf8'),file=n=>({path:n,content:read(n)}),manifest=JSON.parse(read('project.json'));
const session=()=>M.createSession(manifest.files.map(file),{bindings:manifest.bindings});
test('loading a saved result for a second tab leaves the first tab and cursor intact',()=>{
 const transient='native-opamp-transient.raw',ac='native-opamp-ac.raw';
 const current=M.createSession([file('native-opamp.wbk'),file(transient)],{bindings:{'tab-0':{path:transient}}});
 const {tab,traces}=current.active();
 tab.cursors.A=M.sample(traces[0],0.000247);
 const before=current.getState();
 current.addResult(file(ac));
 current.bindResult('tab-1',ac);
 assert.deepEqual(current.getState().tabs[0],before.tabs[0]);
 assert.deepEqual(current.getState().cursors,before.cursors);
 const results=current.availableResults.length;
 assert.throws(()=>current.addResult({path:'invalid.raw',content:'invalid'}));
 assert.equal(current.availableResults.length,results);
 current.dispose();
});
test('native workbook explicit binding, byte-exact export and AC complex reference',()=>{const s=session();assert.equal(s.tabs.length,2);assert.equal(s.exportWorkbook().content,read('native-opamp.wbk'));s.selectTab('tab-1');const traces=s.active().traces,out=traces.find(t=>t.expression.toLowerCase()==='v(/out)'&&t.mode==='db'),phase=traces.find(t=>t.expression.toLowerCase()==='v(/out)'&&t.mode==='phase');const a=M.sample(out,1000),b=M.sample(phase,1000);assert.ok(Math.abs(a.y-19.998984153199164)<1e-8);assert.ok(Math.abs(b.y-179.7898120099)<1e-7);s.dispose();});
test('native transient A/B cursor reference and exact selection identity',()=>{const s=session(),t=s.active().traces.find(t=>t.expression.toLowerCase()==='v(/in)');const a=M.sample(t,.0002471143025685134),b=M.sample(t,.0007471143025685134);assert.equal(a.index,33);assert.equal(b.index,83);assert.ok(Math.abs(b.x-a.x-.0005)<1e-12);assert.ok(Math.abs(b.y-a.y+.19996712624)<1e-9);assert.notEqual(M.key('V(/In)'),M.key('V(/in)'));});
test('explicit workbook pairing rejects wrong analysis without changing prior binding',()=>{const s=session(),old={...s.tabs[0].binding};assert.throws(()=>s.bindResult('tab-0','native-opamp-ac.raw'),/does not match/);assert.deepEqual(s.tabs[0].binding,old);assert.equal(M.createSession([file('native-opamp.wbk')]).active().plot,null);});
test('native nested DC has separate sweeps and extrema survive reduction',()=>{const s=M.createSession([file('generic-dc.raw')]),t=s.active().traces[0];assert.equal(M.segments(t).length,2);assert.ok(M.reduced(t).includes(null));assert.ok(M.reduced(t,{maxPoints:8}).length<=8);});
test('gaps and late extrema survive bounded reduction without false joining',()=>{const t={id:'t',mode:'real',unit:'V',real:Array.from({length:10000},(_,i)=>({x:i,y:i===9998?1000:i===5000?null:0}))};const r=M.reduced(t,{maxPoints:16});assert.ok(r.length<=16);assert.ok(r.some(p=>p?.y===1000));assert.ok(r.includes(null));assert.equal(M.sample(t,5000).y,null);});
test('saved cursor restores without invented out-of-range sample and preserves native formats',()=>{const book=JSON.parse(read('native-opamp.wbk'));book.tabs[0].traces[0].cursor1={position:1,x_format:'3~s',y_format:'3~V'};book.tabs[0].traces[0].cursorD={x_format:'4~s'};const content=JSON.stringify(book),s=M.createSession([{path:'a.wbk',content},file('native-opamp-transient.raw')],{bindings:{'tab-0':{path:'native-opamp-transient.raw'}}});assert.equal(s.active().tab.cursors.A.x,1);assert.equal(s.active().tab.cursors.A.index,null);assert.equal(s.active().tab.cursors.A.y,null);assert.equal(s.exportWorkbook().content,content);s.active().tab.cursors.A=M.sample(s.active().traces[0],.001);s.active().tab.cursorsEdited=true;const exported=JSON.parse(s.exportWorkbook().content);assert.equal(exported.tabs[0].traces[0].cursor1.x_format,'3~s');assert.deepEqual(exported.tabs[0].traces[0].cursorD,{x_format:'4~s'});});
test('unknown workbook metadata retained and unsupported input fails explicitly',()=>{const book=JSON.parse(read('native-opamp.wbk'));book.vendor={future:true};const text=JSON.stringify(book);const s=M.createSession([{path:'a.wbk',content:text}]);assert.equal(s.exportWorkbook().content,text);assert.throws(()=>M.createSession([{path:'x.raw',content:'Binary: garbage'}]));assert.throws(()=>M.createSession([file('native-opamp.wbk'),{path:'other.wbk',content:text}]),/one workbook/);});

// Deliberately sparse samples put both KiCad boost cursor positions between rows.
const cursorWaveform = {
  path: 'cursor-samples.csv',
  content: 'time;V(/out);V(/vcont);V(/extra)\n0;0;1;2\n0.013;3;4;5\n0.017;6;7;8\n0.018;9;10;11\n',
};

function cursorSession(t, name = 'smps-com.wbk', waveform = cursorWaveform) {
  const workbook = file(name);
  const s = M.createSession([workbook, waveform], {
    bindings: { 'tab-0': { path: waveform.path, plotIndex: 0 } },
  });
  t.after(() => s.dispose());
  assert.equal(s.exportWorkbook().content, workbook.content);
  return s;
}

function setCursor(s, name, signal, x) {
  const { tab, traces } = s.active();
  const trace = traces.find(candidate => candidate.id === signal + '::real');
  assert.ok(trace, signal);
  tab.cursors[name] = M.sample(trace, x);
  tab.cursorsEdited = true;
}

function savedTraces(s) {
  return JSON.parse(s.exportWorkbook().content).tabs[0].traces;
}

const boostTraces = JSON.parse(read('smps-com.wbk')).tabs[0].traces;

test('moving boost cursor A preserves the unsnapped native B position and formats', t => {
  const s = cursorSession(t);
  assert.equal(s.active().tab.cursors.B.x, 0.017);
  setCursor(s, 'A', 'v(/out)', 0.018);
  const [out] = savedTraces(s);
  assert.deepEqual(out.cursor1, { ...boostTraces[0].cursor1, position: 0.018 });
  assert.deepEqual(out.cursor2, boostTraces[0].cursor2);
  assert.deepEqual(out.cursorD, boostTraces[0].cursorD);
});

test('deleting boost cursor B preserves the unsnapped A position and delta format', t => {
  const s = cursorSession(t);
  const { tab } = s.active();
  tab.cursors.B = null;
  tab.cursorsEdited = true;
  const [out] = savedTraces(s);
  assert.equal(out.cursor2, undefined);
  assert.deepEqual(out.cursor1, boostTraces[0].cursor1);
  assert.deepEqual(out.cursorD, boostTraces[0].cursorD);
});

test('moving a cursor between saved voltage traces carries its original formats', t => {
  const s = cursorSession(t);
  setCursor(s, 'A', 'v(/vcont)', 0.013);
  const [out, control] = savedTraces(s);
  assert.equal(out.cursor1, undefined);
  assert.deepEqual(control.cursor1, { ...boostTraces[0].cursor1, position: 0.013 });
});

test('newly selected trace exports its assigned cursor', t => {
  const s = cursorSession(t);
  const { tab } = s.active();
  tab.selected.push('v(/extra)::real');
  tab.selectionEdited = true;
  setCursor(s, 'A', 'v(/extra)', 0.018);
  const traces = savedTraces(s);
  const extra = traces.find(trace => M.key(trace.signal) === 'v(/extra)');
  assert.deepEqual(extra.cursor1, { ...boostTraces[0].cursor1, position: 0.018 });
  assert.equal(traces[0].cursor1, undefined);
});

test('creating Class-D cursor B preserves cursor A on an unavailable power trace', t => {
  const withMissingPower = { path: 'partial.csv', content: 'time;V(/Ain);V(/out)\n0;1;2\n0.001;4;5\n0.003;7;8\n' };
  const s = cursorSession(t, 'Class-D.wbk', withMissingPower);
  assert.equal(s.active().tab.cursors.A, null);
  setCursor(s, 'B', 'v(/out)', 0.001);
  const traces = savedTraces(s);
  const originalPower = JSON.parse(read('Class-D.wbk')).tabs[0].traces[0];
  assert.deepEqual(traces[0], originalPower);
  assert.equal(traces.find(trace => M.key(trace.signal) === 'v(/out)').cursor2.position, 0.001);
});

test('rebinding returns to the saved boost cursor positions and byte-exact export', t => {
  const s = cursorSession(t);
  setCursor(s, 'A', 'v(/out)', 0.018);
  s.bindResult('tab-0', cursorWaveform.path);
  assert.equal(s.active().tab.cursors.A.x, 0.013);
  assert.equal(s.exportWorkbook().content, read('smps-com.wbk'));
});
