/* Read-only commit timeline. All connections come from validated parent IDs. */
((root) => {
  'use strict';
  const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
  const LIMIT = 200;
  const text = (value, length = 16000) => String(value ?? '').slice(0, length);
  const validSHA = value => typeof value === 'string' && SHA.test(value);
  function normalize(commits) {
    const seen = new Set(), result = [];
    for (const source of (Array.isArray(commits) ? commits : []).slice(0, LIMIT)) {
      if (!source || !validSHA(source.sha) || seen.has(source.sha.toLowerCase())) continue;
      const sha = source.sha.toLowerCase(); seen.add(sha);
      const supplied = Array.isArray(source.parents), parents = supplied ? source.parents : [];
      const incomplete = !supplied || source.parentsKnown === false || source.parentsTruncated === true || parents.length > 16 || parents.some(p => !validSHA(p));
      result.push({sha, message: text(source.message), author: text(source.author, 200), date: text(source.date, 100),
        parents: [...new Set(parents.slice(0, 16).filter(validSHA).map(p => p.toLowerCase()))], parentsKnown: !incomplete});
    }
    return result;
  }
  function mount(options) {
    const holder = options.holder, d = holder?.ownerDocument || root.document;
    if (!holder || !d) throw Error('A timeline holder is required.');
    const explorer = root.KiCadRepositoryExplorer || (typeof require === 'function' ? require('./repository-explorer.js') : null);
    if (!explorer?.graphRows) throw Error('Repository graph helper is unavailable.');
    let disposed = false, commits = [], branches = [], currentRef = '', base = '', head = '', rows = [], graph;
    const make = (tag, value, cls) => { const n = d.createElement(tag); if (value !== undefined) n.textContent = value; if (cls) n.className = cls; return n; };
    const svg = (tag, attrs) => { const n = d.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value)); return n; };
    const invoke = (callback, ...args) => { if (disposed || typeof callback !== 'function') return; try { Promise.resolve(callback(...args)).catch(report); } catch (error) { report(error); } };
    function report(error) { if (!disposed) { status.textContent = error?.message || String(error); if (typeof options.onError === 'function') options.onError(error); } }
    const button = (value, action, cls) => { const n = make('button', value, cls); n.type = 'button'; n.onclick = () => { if (!disposed) action(); }; return n; };
    const page = make('section', undefined, 'history-timeline'); page.setAttribute('aria-label', 'Commit timeline');
    const toolbar = make('div', undefined, 'history-timeline-toolbar'), heading = make('div', undefined, 'history-timeline-heading');
    heading.append(make('strong', 'Commit timeline'), make('span', 'Explore history and compare saved revisions'));
    const search = make('input'); search.type = 'search'; search.placeholder = 'Find message, author, branch or SHA'; search.setAttribute('aria-label', 'Search loaded commits'); toolbar.append(heading, search); page.append(toolbar);
    const legend = make('p', 'Lines follow verified parent IDs · Filled node: commit · Ring: verified root · Unknown parents are labelled; no ancestry is inferred.', 'history-timeline-legend'); page.append(legend);
    const status = make('p', '', 'history-timeline-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); page.append(status);
    const scroll = make('div', undefined, 'history-timeline-scroll'), list = make('div', undefined, 'history-timeline-list'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Loaded commit history');
    const drawing = svg('svg', {'aria-hidden': 'true', focusable: 'false'}); drawing.setAttribute('class', 'history-timeline-graph'); list.append(drawing); scroll.append(list); page.append(scroll);
    const selection = make('div', undefined, 'history-timeline-selection'); selection.setAttribute('aria-label', 'Selected revisions');
    const baseLabel = make('span', '', 'history-timeline-base'), headLabel = make('span', '', 'history-timeline-head');
    const swap = button('Swap', () => { [base, head] = [head, base]; refreshSelection(); }); swap.setAttribute('aria-label', 'Swap base and head');
    const compare = button('Compare selected', () => { if (base && head && base !== head) invoke(options.onCompare, base, head); }, 'history-timeline-primary');
    selection.append(baseLabel, swap, headLabel, compare); page.append(selection); holder.append(page);
    function refreshSelection() {
      baseLabel.textContent = 'Base · ' + (base ? base.slice(0, 8) : 'Choose a commit'); headLabel.textContent = 'Head · ' + (head ? head.slice(0, 8) : 'Choose a commit');
      baseLabel.title = base; headLabel.title = head; swap.disabled = !base || !head; compare.disabled = !base || !head || base === head || typeof options.onCompare !== 'function';
      for (const row of rows) {
        row.base.setAttribute('aria-pressed', String(row.commit.sha === base)); row.head.setAttribute('aria-pressed', String(row.commit.sha === head));
        row.selection.replaceChildren(); if (row.commit.sha === base) row.selection.append(make('span', 'BASE', 'history-timeline-badge')); if (row.commit.sha === head) row.selection.append(make('span', 'HEAD', 'history-timeline-badge'));
      }
    }
    function filter() {
      const query = search.value.trim().toLowerCase(); let count = 0;
      for (const row of rows) { const match = !query || row.search.includes(query); row.item.dataset.match = String(match); if (match) count++; }
      status.textContent = query ? `${count} matching commits. Other commits stay visible to preserve graph connections.` : commits.length ? `${commits.length} loaded commits${options.commits?.length > LIMIT ? ' · showing the first 200' : ''}.` : 'No commit history is available.';
    }
    function drawGraph() {
      if (disposed || !graph) return;
      drawing.replaceChildren();
      const width = Math.max(1, ...graph.rows.map(row => row.lanes)) * 22 + 24;
      list.style.setProperty('--history-graph-width', width + 'px');
      const listTop = list.getBoundingClientRect?.().top || 0;
      const positions = rows.map((row, index) => { const rect = row.item.getBoundingClientRect?.(); const top = rect?.height ? rect.top - listTop : index * 150; return {top, bottom: top + (rect?.height || 150), node: top + 36}; });
      const height = positions.at(-1)?.bottom || 1; drawing.setAttribute('width', width); drawing.setAttribute('height', height); drawing.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const x = lane => 12 + lane * 22;
      const path = (value, color, extra = {}) => drawing.append(svg('path', {d: value, stroke: color, 'stroke-width': 2, fill: 'none', ...extra}));
      graph.rows.forEach((row, index) => {
        const p = positions[index], forward = row.commit.parents.filter(parent => !row.earlier.includes(parent)); let parentIndex = 0;
        for (const edge of row.segments) {
          const start = edge.through ? p.top : p.node, middle = (start + p.bottom) / 2;
          path(`M ${x(edge.from)} ${start} C ${x(edge.from)} ${middle}, ${x(edge.to)} ${middle}, ${x(edge.to)} ${p.bottom}`, edge.color, {'data-from': row.commit.sha, 'data-parent': edge.through ? '' : forward[parentIndex++]});
        }
        if (index && graph.rows[index - 1].segments.some(edge => edge.to === row.lane)) path(`M ${x(row.lane)} ${p.top} L ${x(row.lane)} ${p.node}`, row.color);
        for (const parent of row.earlier) { const parentIndex = commits.findIndex(c => c.sha === parent), target = positions[parentIndex], rail = width - 8; if (target) path(`M ${x(row.lane)} ${p.node} C ${rail} ${p.node}, ${rail} ${target.node}, ${x(graph.rows[parentIndex].lane)} ${target.node}`, row.color, {'stroke-dasharray': '4 3', 'data-parent': parent}); }
        drawing.append(svg('circle', {cx: x(row.lane), cy: p.node, r: 5, fill: row.color, stroke: row.color, 'stroke-width': 2, 'data-sha': row.commit.sha}));
        if (row.commit.parentsKnown && !row.commit.parents.length) drawing.append(svg('circle', {cx: x(row.lane), cy: p.node, r: 9, fill: 'none', stroke: row.color, 'stroke-width': 1.5}));
      });
    }
    function render() {
      rows = []; list.replaceChildren(drawing); graph = explorer.graphRows(commits);
      const current = validSHA(currentRef) ? currentRef.toLowerCase() : branches.find(b => b.name === currentRef)?.sha;
      for (const commit of commits) {
        const item = make('article', undefined, 'history-timeline-row'); item.dataset.sha = commit.sha; item.setAttribute('role', 'listitem');
        const card = make('div', undefined, 'history-timeline-card'), top = make('div', undefined, 'history-timeline-card-top');
        const initials = (commit.author.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('') || '?').toUpperCase();
        const avatar = make('span', initials, 'history-timeline-avatar'); avatar.setAttribute('aria-hidden', 'true'); top.append(avatar);
        const content = make('div', undefined, 'history-timeline-message'), details = make('details'), summary = make('summary', commit.message.split('\n')[0] || '(No commit message)');
        details.append(summary, make('pre', commit.message || '(No commit message)')); details.ontoggle = drawGraph; content.append(details);
        const badges = make('div', undefined, 'history-timeline-badges'), type = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^\n)]*\))?!?:/i.exec(commit.message);
        if (type) badges.append(make('span', type[1].toLowerCase(), 'history-timeline-type'));
        for (const branch of branches.filter(b => b.sha === commit.sha)) badges.append(make('span', branch.name, 'history-timeline-branch'));
        if (current === commit.sha) badges.append(make('span', 'CURRENT', 'history-timeline-badge'));
        const selected = make('span', undefined, 'history-timeline-selected-badges'); badges.append(selected); content.append(badges); top.append(content); card.append(top);
        const meta = make('div', undefined, 'history-timeline-meta'), sha = make('code', commit.sha.slice(0, 8)); sha.title = commit.sha;
        meta.append(make('span', commit.author || 'Unknown author'), sha);
        const date = make('time', Number.isFinite(Date.parse(commit.date)) ? new Date(commit.date).toLocaleString() : 'Date unavailable'); if (Number.isFinite(Date.parse(commit.date))) date.setAttribute('datetime', new Date(commit.date).toISOString()); meta.append(date); card.append(meta);
        const parentInfo = !commit.parentsKnown ? 'Unknown or incomplete parents' : !commit.parents.length ? 'Verified root commit' : commit.parents.length > 1 ? `Merge · ${commit.parents.length} verified parents` : '1 verified parent';
        const ancestry = make('small', parentInfo, 'history-timeline-ancestry'); ancestry.title = commit.parents.length ? 'Verified parents: ' + commit.parents.join(', ') : parentInfo; card.append(ancestry);
        const actions = make('div', undefined, 'history-timeline-actions');
        const setBase = button('Set base', () => { base = commit.sha; refreshSelection(); }); const setHead = button('Set head', () => { head = commit.sha; refreshSelection(); }); actions.append(setBase, setHead);
        if (typeof options.onOpen === 'function') actions.append(button('View commit', () => invoke(options.onOpen, commit.sha)));
        if (typeof options.onCompareCurrent === 'function') actions.append(button('Compare with current', () => invoke(options.onCompareCurrent, commit.sha)));
        card.append(actions); item.append(card); list.append(item);
        rows.push({item, commit, base: setBase, head: setHead, selection: selected, search: [commit.message, commit.author, commit.sha, ...branches.filter(b => b.sha === commit.sha).map(b => b.name)].join(' ').toLowerCase()});
      }
      if (graph.continuations.length) list.append(make('p', 'Verified parent lines continue beyond the loaded history.', 'history-timeline-continuation'));
      refreshSelection(); filter(); drawGraph();
    }
    search.oninput = filter;
    const Resize = d.defaultView?.ResizeObserver || root.ResizeObserver;
    const observer = Resize ? new Resize(drawGraph) : null; observer?.observe(list);
    const view = d.defaultView || root; view.addEventListener?.('resize', drawGraph);
    function update(next = {}) {
      if (disposed) return;
      if ('commits' in next) { options.commits = next.commits; commits = normalize(next.commits); }
      if ('branches' in next) branches = (Array.isArray(next.branches) ? next.branches : []).slice(0, LIMIT).filter(b => b && validSHA(b.sha) && typeof b.name === 'string').map(b => ({name: text(b.name, 200), sha: b.sha.toLowerCase()}));
      if ('currentRef' in next) currentRef = text(next.currentRef, 200);
      const loaded = new Set(commits.map(c => c.sha)); if (!loaded.has(base)) base = ''; if (!loaded.has(head)) head = ''; render();
    }
    update(options);
    return {update, dispose() { if (disposed) return; disposed = true; observer?.disconnect(); view.removeEventListener?.('resize', drawGraph); search.oninput = null; for (const row of rows) for (const child of row.item.querySelectorAll?.('button') || []) child.onclick = null; page.remove(); rows = []; }};
  }
  const API = {mount}; root.KiCadHistoryTimeline = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(globalThis);
