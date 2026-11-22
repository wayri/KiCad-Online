const test = require('node:test');
const assert = require('node:assert/strict');
const {mount} = require('../extension/history-timeline.js');

class Element {
  constructor(tag, document) {
    this.tagName = tag; this.ownerDocument = document; this.children = []; this.attributes = {};
    this.dataset = {}; this.style = {setProperty() {}}; this.value = ''; this._text = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  hasAttribute(key) { return key in this.attributes; }
  get firstElementChild() { return this.children[0]; }
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  getBoundingClientRect() {
    let row = this;
    while (row && row.tagName !== 'article') row = row.parentNode;
    const position = row ? row.parentNode.children.filter(child => child.tagName === 'article').indexOf(row) * 150 : 0;
    const height = this.tagName === 'article' ? 150 : 20;
    const top = position + (this.className === 'history-timeline-subject' ? 8 : 0);
    return {top, bottom:top + height, left:0, width:640, height};
  }
  click() { if (!this.disabled && !this.hidden) this.onclick?.(event('click', this)); }
}
function event(type, target, extra={}) {
  return {type, currentTarget:target, target, preventDefault() {}, stopPropagation() {}, ...extra};
}
const sha = value => value.repeat(40);
const commit = (id, parents, extra = {}) => ({sha: sha(id), parents: parents?.map(sha), message: 'fix: Board ' + id, author: 'Ada Lovelace', date: '2026-01-01T12:00:00Z', ...extra});
function fixture(commits, extra = {}) {
  const listeners = new Set(), observers = [];
  const document = {defaultView: {addEventListener(_event, callback) { listeners.add(callback); }, removeEventListener(_event, callback) { listeners.delete(callback); }, ResizeObserver: class {constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }}};
  document.addEventListener = () => {}; document.removeEventListener = () => {};
  document.createElement = tag => new Element(tag, document); document.createElementNS = (_ns, tag) => new Element(tag, document);
  const holder = document.createElement('div'), calls = [];
  const api = mount({holder, commits, onCompare: (...args) => calls.push(args), ...extra});
  const all = tag => holder.querySelectorAll(tag), articles = () => all('article');
  const named = (name, node = holder) => node.querySelectorAll('button').find(button => (button.getAttribute('aria-label') || button.textContent) === name);
  return {holder, api, calls, document, all, articles, named, observers, listeners};
}

test('renders verified branching and merge parents with continuous curved graph lanes', () => {
  const ui = fixture([commit('a', ['b', 'c']), commit('b', ['d']), commit('c', ['d']), commit('d', [])]);
  const outgoing = ui.all('path').filter(p => p.getAttribute('data-parent'));
  assert.deepEqual(outgoing.map(p => [p.getAttribute('data-from'), p.getAttribute('data-parent')]), [[sha('a'), sha('b')], [sha('a'), sha('c')], [sha('b'), sha('d')], [sha('c'), sha('d')]]);
  assert.ok(outgoing.every(path => path.getAttribute('d').includes(' C ')));
  assert.match(ui.articles()[0].textContent, /Merge/);
  assert.equal(ui.articles()[3].children[0].getAttribute('aria-description'), 'Root commit');
  const links = ui.all('path').filter(path => path.getAttribute('data-commit-link'));
  assert.equal(links.length, ui.articles().length);
  for (const [index, link] of links.entries()) {
    const node = ui.all('circle')[index];
    assert.equal(link.getAttribute('data-commit-link'), node.getAttribute('data-sha'));
    assert.match(link.getAttribute('d'), new RegExp(`^M ${node.getAttribute('cx')} ${index * 150 + 18} H [0-9]+$`));
  }
  // The b->d lane crosses the c row rather than inventing b->c ancestry.
  assert.ok(ui.all('path').some(path => path.getAttribute('data-from') === sha('c') && path.getAttribute('data-parent') === ''));
  assert.equal(outgoing.some(path => path.getAttribute('data-from') === sha('b') && path.getAttribute('data-parent') === sha('c')), false);
  const bToD = outgoing.find(path => path.getAttribute('data-from') === sha('b'));
  assert.match(bToD.getAttribute('d'), /300$/);
  ui.api.dispose();
});

test('unknown or invalid parents never become invented roots or edges; exact branch tips only', () => {
  const ui = fixture([commit('a', undefined), commit('b', [], {parentsKnown: false}), commit('c', [], {parents: ['hostile<parent>']}), commit('d', ['e'])], {branches: [{name: 'main', sha: sha('a')}, {name: 'unverified'}, {name: 'bad', sha: '<x>'}], currentRef: 'main'});
  for (const article of ui.articles().slice(0, 3)) assert.equal(article.children[0].getAttribute('aria-description'), 'Commit ancestry unavailable or incomplete');
  assert.equal(ui.all('path').filter(p => p.getAttribute('data-parent')).length, 1);
  assert.equal(ui.all('path').find(p => p.getAttribute('data-parent')).getAttribute('data-parent'), sha('e'));
  assert.match(ui.articles()[0].textContent, /mainDisplayed/); assert.doesNotMatch(ui.holder.textContent, /unverified|hostile<parent>/);
  ui.api.dispose();
});

test('base and head selection persist, swap direction and send full exact SHAs', () => {
  const opened = [], current = [], ui = fixture([commit('a', ['b']), commit('b', [])], {onOpen: sha => opened.push(sha), onCompareCurrent: sha => current.push(sha)});
  assert.equal(ui.named('Compare base and head').hidden, true);
  ui.named('Set or clear base revision', ui.articles()[1]).click(); ui.named('Set or clear head revision', ui.articles()[0]).click(); ui.named('Compare base and head').click();
  assert.deepEqual(ui.calls, [[sha('b'), sha('a')]]);
  const options = ui.named('History options');
  options.click(); assert.equal(options.getAttribute('aria-expanded'), 'true');
  ui.named('Swap base and head').click(); assert.equal(options.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.document.activeElement, options); ui.named('Compare base and head').click(); assert.deepEqual(ui.calls[1], [sha('a'), sha('b')]);
  ui.named('Open drawing at commit', ui.articles()[0]).click(); ui.named('Compare with displayed drawing', ui.articles()[1]).click();
  assert.deepEqual(opened, [sha('a')]); assert.deepEqual(current, [sha('b')]);
  assert.equal(ui.named('Set or clear base revision', ui.articles()[0]).getAttribute('aria-pressed'), 'true');
  ui.named('Set or clear head revision', ui.articles()[0]).click(); assert.equal(ui.named('Compare base and head').hidden, true);
  ui.api.dispose();
});

test('hostile text stays text, details retain full message, and search preserves graph and rows', () => {
  const hostile = '<img src=x onerror=alert(1)>', ui = fixture([commit('a', ['b'], {message: 'feat: '+hostile+'\n\nFull body', author: '<script>Bad</script>'}), commit('b', [])], {branches: [{name: hostile, sha: sha('a')}]});
  assert.ok(ui.holder.textContent.includes(hostile)); assert.equal(ui.all('img').length, 0); assert.equal(ui.all('script').length, 0);
  assert.equal(ui.all('pre')[0].textContent, 'Full body');
  const paths = ui.all('path'), input = ui.all('input')[0]; input.value = 'Full body'; input.oninput();
  assert.equal(ui.articles().length, 2); assert.equal(ui.articles()[0].dataset.match, 'true'); assert.equal(ui.articles()[1].dataset.match, 'false'); assert.deepEqual(ui.all('path'), paths);
  input.value = 'missing'; input.oninput(); assert.match(ui.holder.textContent, /No matching commits/); ui.api.dispose();
});

test('updates clear missing selections but preserve loaded selections and bounded metadata', () => {
  const ui = fixture([commit('a', ['b']), commit('b', [])]); ui.named('Set or clear base revision', ui.articles()[1]).click(); ui.named('Set or clear head revision', ui.articles()[0]).click();
  ui.api.update({commits: [commit('a', ['b'])]}); assert.equal(ui.named('Compare base and head').hidden, true); assert.doesNotMatch(ui.holder.textContent, /Base/); assert.match(ui.holder.textContent, /Head/);
  ui.api.update({commits: [commit('c', []), {sha: 'ab'.repeat(21), parents: []}]}); assert.equal(ui.articles().length, 1); assert.doesNotMatch(ui.holder.textContent, /Head/);
  const entries = Array.from({length: 201}, (_v, index) => ({sha: index.toString(16).padStart(40, '0'), parents: [], message: 'Board'})); ui.api.update({commits: entries});
  assert.equal(ui.articles().length, 200); ui.api.dispose();
});

test('dispose removes observers/listeners and prevents detached actions or stale updates', () => {
  const ui = fixture([commit('a', [])]), setBase = ui.named('Set or clear base revision');
  ui.api.dispose(); ui.api.dispose(); assert.equal(ui.holder.children.length, 0); assert.equal(ui.listeners.size, 0); assert.equal(ui.observers[0].disconnected, true);
  setBase.click(); ui.api.update({commits: [commit('b', [])]}); ui.observers[0].callback(); assert.equal(ui.holder.children.length, 0); assert.deepEqual(ui.calls, []);
});

test('callback failures are reported and resolved failures after disposal stay silent', async () => {
  const errors = [], ui = fixture([commit('a', [])], {onOpen() { throw Error('Could not open'); }, onError: error => errors.push(error.message)});
  ui.named('Open drawing at commit').click(); assert.deepEqual(errors, ['Could not open']); assert.match(ui.holder.textContent, /Could not open/); ui.api.dispose();
  let reject; const late = fixture([commit('a', [])], {onOpen: () => new Promise((_resolve, no) => { reject = no; }), onError: error => errors.push(error.message)});
  late.named('Open drawing at commit').click(); late.api.dispose(); reject(Error('Late')); await new Promise(setImmediate); assert.deepEqual(errors, ['Could not open']);
});

test('commit options are shared by right-click and Shift+F10', () => {
  const opened = [], ui = fixture([commit('a', [])], {onOpen: value => opened.push(value)});
  const card = ui.articles()[0].children[0];
  const menu = ui.holder.querySelectorAll('div').find(node => node.className === 'history-timeline-menu');
  for (const type of ['contextmenu', 'keydown']) {
    const open = type === 'contextmenu' ? card.oncontextmenu : card.onkeydown;
    open(event(type, card, {key:'F10', shiftKey:true, clientX:25, clientY:30}));
    assert.equal(menu.hidden, false);
    assert.equal(ui.document.activeElement, ui.named('Open drawing at commit', menu));
    ui.named('Open drawing at commit', menu).click();
    assert.equal(menu.hidden, true);
    assert.equal(ui.document.activeElement, card);
  }
  assert.deepEqual(opened, [sha('a'), sha('a')]);
  ui.api.dispose();
});


test('the same search input filters commits and submits a direct revision with Enter',()=>{
  const submitted=[],ui=fixture([commit('a', []),commit('b', [])],{repository:'wayri/KERO',onSearchSubmit:value=>submitted.push(value)});
  const search=ui.all('input')[0];
  search.value='wayri/KERO';search.oninput();
  assert.ok(ui.articles().every(row=>row.dataset.match==='true'));
  search.value=' #42 ';search.oninput();
  search.onkeydown(event('keydown',search,{key:'Enter'}));
  assert.deepEqual(submitted,['#42']);
  ui.api.dispose();
});
