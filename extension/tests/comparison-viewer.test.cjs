const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(domain = 'schematic', remote = false) {
  const sent = [], requests = [], posted = [], listeners = new Map(), elements = new Map();let exportedBlob = null;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.dataset = {}; this.style = {};
      this.hidden = false; this.checked = true; this.value = '';
      if (tag === 'iframe') this.contentWindow = { postMessage: message => sent.push(message) };
    }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    click() { this.clicked = true; this.onclick?.(); }
    setAttribute(name, value) { this[name] = value; }
    get rows() { return this.children; }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const tabs = ['properties', 'text', 'schematic', 'layout', '3d'].map(view => {
    const element = new Element('button'); element.dataset.view = view; return element;
  });
  const fileName = domain === 'schematic' ? 'child.kicad_sch' : 'notes.txt';
  const oldContent = domain === 'schematic' ? '(kicad_sch)' : 'old';
  const newContent = domain === 'schematic' ? '(kicad_sch)' : 'new';
  const source = fs.readFileSync(path.join(__dirname, '..', 'comparison-viewer.js'), 'utf8');
  class Worker {
    postMessage(message) {
      posted.push(message);
      const entry = { id: 'one', path: fileName, domain, status: 'modified', label: 'R1', kind: 'symbol',
        fields: [{ name: 'Value', before: '1k', after: '2k' }],
        before: { uuid: 'u1' }, after: { uuid: 'u1' } };
      this.onmessage({ data: { ok: true, result: { entries: [entry], counts: { added: 0, removed: 0, modified: 1 },
        warnings: [], files: [{ path: fileName, basePath: fileName, headPath: fileName, domain }] } } });
      assert.equal(message.type, 'compare');
    }
    terminate() {}
  }
  class TestURL extends URL {
    static createObjectURL(blob) { exportedBlob = blob; return 'blob:comparison-test'; }
    static revokeObjectURL() {}
  }
  const query = remote ? new URLSearchParams({ repository: 'owner/repo', file: 'board.kicad_pcb',
    oldFile: 'old.kicad_pcb', base: 'old', head: 'new', headRepository: 'owner/repo' }) : '';
  const remoteSend = async message => {
    requests.push(message);
    if (message.type === 'revision-resolve') return { ok: true, result: { sha: (message.ref === 'old' ? 'a' : 'b').repeat(40) } };
    if (message.type === 'drawing-files') return { ok: true, result: { files: [message.file,
      message.file.replace(/\.kicad_pcb$/, '.kicad_sch')], warnings: [] } };
    if (message.type === 'project') return { ok: true, result: [{ path: message.file,
      content: message.file.endsWith('.kicad_sch') ? '(kicad_sch)' : '(kicad_pcb)' }] };
    return { ok: false, error: 'Unexpected read' };
  };
  const context = { document: { getElementById: get, createElement: tag => new Element(tag),
      querySelectorAll: selector => selector === '[data-view]' ? tabs : [] },
    window: { addEventListener: (name, callback) => listeners.set(name, callback), open() {} },
    location: { search: String(query), origin: 'chrome-extension://test', href: 'chrome-extension://test/comparison-viewer.html' },
    chrome: { runtime: { getURL: name => 'chrome-extension://test/' + name,
      ...(remote ? { sendMessage: remoteSend } : {}) } },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    KiCadLocalProject: { pathOK: () => true, textFile: () => true,
      drawing: file => /\.kicad_(?:sch|pcb)$/.test(file), validate: value => value,
      transport: (project, storage, options) => ({ scope: 'local/' + project.id, ref: options.ref, send: async () => ({}) }) },
    KiCadUnifiedComparison: { diffText: () => ({ rows: [], warnings: [] }) },
    URLSearchParams, URL: TestURL, Blob, TextEncoder, Worker, setTimeout, clearTimeout, console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'comparison-viewer.js' });
  const change = async side => {
    const target = { files: [{ name: fileName, size: 20, text: async () => side === 'base' ? oldContent : newContent }], value: fileName };
    await get(side + 'Files').onchange({ target });
  };
  return { get, tabs, sent, requests, posted, listeners, change, fileName, context, exported: () => exportedBlob };
}

test('comparison highlight waits for explicit ready and follows a non-root schematic sheet', async () => {
  const f = fixture(); await f.change('base'); await f.change('head'); f.get('compare').onclick();
  f.tabs.find(tab => tab.dataset.view === 'schematic').onclick();
  const frame = f.get('baseDrawing').children[0];
  assert.equal(frame.tagName, 'iframe');
  const receive = (type, file) => f.listeners.get('message')({ origin: 'chrome-extension://test',
    source: frame.contentWindow, data: { type, file } });
  receive('kicad-review:view', f.fileName);
  assert.equal(f.sent.length, 0);
  receive('kicad-review:comparison-ready', 'root.kicad_sch');
  assert.equal(f.sent[0].command, 'open-sheet');
  assert.equal(f.sent[0].file, f.fileName);
  assert.equal(f.sent.some(message => message.command === 'comparison-highlight'), false);
  receive('kicad-review:view', f.fileName);
  assert.equal(f.sent.some(message => message.command === 'comparison-highlight' && message.uuids.includes('u1')), true);
});

test('text view renders at most 2,000 changed/context rows', async () => {
  const f = fixture('text'); await f.change('base'); await f.change('head'); f.get('compare').onclick();
  const rows = Array.from({ length: 6000 }, (_, i) => ({ status: i % 2 ? 'added' : 'equal',
    beforeLine: i + 1, afterLine: i + 1, text: 'line ' + i }));
  f.context.KiCadUnifiedComparison.diffText = () => ({ rows, warnings: [] });
  f.tabs.find(tab => tab.dataset.view === 'text').onclick();
  assert.equal(f.get('tableHost').children[0].rows.length, 2001);
  assert.match(f.get('warnings').textContent, /first 2,000/);
});

test('delta export contains structured changes without raw imported source', async () => {
  const f = fixture(); await f.change('base'); await f.change('head'); f.get('compare').onclick();
  f.get('export').onclick();
  const report = JSON.parse(await f.exported().text());
  assert.equal(report.format, 'kicad-online-comparison');
  assert.equal(report.entries[0].before.uuid, 'u1');
  assert.equal(report.counts.modified, 1);
  assert.equal(JSON.stringify(report).includes('(kicad_sch)'), false);
});

test('remote rename loads immutable base/head arrays and same-stem companions', async () => {
  const f = fixture('schematic', true);
  await f.get('loadRemote').onclick();
  assert.equal(f.requests.filter(request => request.type === 'revision-resolve').length, 2);
  assert.ok(f.requests.every(request => request.file));
  const job = f.posted[0];
  assert.ok(job, f.get('status').textContent);
  assert.deepEqual(JSON.parse(JSON.stringify(job.options.pairs)),
    [{ basePath: 'old.kicad_pcb', headPath: 'board.kicad_pcb' }]);
  assert.deepEqual(job.base.map(item => item.path), ['old.kicad_pcb', 'old.kicad_sch']);
  assert.deepEqual(job.head.map(item => item.path), ['board.kicad_pcb', 'board.kicad_sch']);
});

test('turning off difference highlights clears both group and focus selection',async()=>{const f=fixture();await f.change('base');await f.change('head');f.get('compare').onclick();f.tabs.find(t=>t.dataset.view==='schematic').onclick();const frame=f.get('baseDrawing').children[0];f.listeners.get('message')({origin:'chrome-extension://test',source:frame.contentWindow,data:{type:'kicad-review:comparison-ready',file:f.fileName}});f.get('highlight').checked=false;f.get('highlight').onchange();const m=f.sent.at(-1);assert.equal(m.command,'comparison-highlight');assert.equal(m.uuids.length,0);assert.equal(m.focusUuid,null);});
test('importing replacement files invalidates old comparison and export',async()=>{const f=fixture();await f.change('base');await f.change('head');f.get('compare').onclick();assert.equal(f.get('export').disabled,false);await f.change('base');assert.equal(f.get('export').disabled,true);assert.equal(f.get('file').children.length,0);});
