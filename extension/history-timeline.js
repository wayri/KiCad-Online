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
    function iconButton(label, icon, fallback, action) {
      const control = button(fallback, action, 'history-icon-button');
      control.title = label; control.setAttribute('aria-label', label);
      if (root.KiCadUIIcons) control.replaceChildren(root.KiCadUIIcons.icon(icon));
      return control;
    }
    const page = make('section', undefined, 'history-timeline'); page.setAttribute('aria-label', 'Commit timeline');
    const search = make('input', undefined, 'history-timeline-search');
    search.type = 'search'; search.placeholder = options.onSearchSubmit ? 'Search commits or open a revision' : 'Search commits';
    search.maxLength = 2048;
    search.setAttribute('aria-label', 'Search by repository, message, author, branch or SHA');
    if(options.onSearchSubmit)search.title = 'Press Enter to open a repository URL, commit SHA, or #PR';
    search.setAttribute('aria-keyshortcuts', 'Shift+F10');
    (options.searchHolder || page).append(search);
    const status = make('p', '', 'history-timeline-status'); status.setAttribute('role', 'status'); page.append(status);
    const scroll = make('div', undefined, 'history-timeline-scroll'), list = make('div', undefined, 'history-timeline-list'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Loaded commit history');
    const drawing = svg('svg', {'aria-hidden': 'true', focusable: 'false'}); drawing.setAttribute('class', 'history-timeline-graph'); list.append(drawing); scroll.append(list); page.append(scroll);
    const menu = make('div', undefined, 'history-timeline-menu');
    menu.hidden = true; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'History actions'); page.append(menu); holder.append(page);
    const compareSelected = iconButton('Compare base and head', 'compare', '⇄', () => { if (base && head && base !== head) invoke(options.onCompare, base, head); });
    (options.controlsHolder || page).append(compareSelected);
    const panelMenu = menuButton('History options');
    (options.controlsHolder || page).append(panelMenu);
    let menuTrigger = null;
    panelMenu.onclick = event => openMenu(event);
    function menuButton(label) {
      const control = button('⋯', () => {}, 'history-icon-button');
      control.title = label; control.setAttribute('aria-label', label); control.setAttribute('aria-expanded', 'false');
      return control;
    }
    function closeMenu(restoreFocus = false) {
      if (menu.hidden) return;
      menu.hidden = true;
      menu.replaceChildren();
      if (menuTrigger?.hasAttribute('aria-expanded')) menuTrigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) menuTrigger?.focus();
      menuTrigger = null;
    }
    function refreshSelection() {
      compareSelected.hidden = !base || !head || base === head;
      for (const row of rows) {
        for (const [control, sha] of [[row.setBase, base], [row.setHead, head]]) control?.setAttribute('aria-pressed', String(row.commit.sha === sha));
        row.selection.replaceChildren();
        if (row.commit.sha === base) row.selection.append(make('span', 'Base', 'history-timeline-badge'));
        if (row.commit.sha === head) row.selection.append(make('span', 'Head', 'history-timeline-badge'));
      }
    }
    function openMenu(event, row) {
      if (event.type === 'keydown' && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); event.stopPropagation();
      const trigger = event.type === 'click' ? event.currentTarget : row?.card || search;
      if (event.type === 'click' && menuTrigger === trigger) { closeMenu(true); return; }
      closeMenu();
      menuTrigger = trigger;
      menu.replaceChildren();
      const action = (label, callback) => menu.append(button(label, () => {closeMenu(true); callback();}));
      if (row) {
        const sha = row.commit.sha;
        if (options.onOpen) action('Open drawing at commit', () => invoke(options.onOpen, sha));
        if (options.onCompareCurrent) action('Compare with displayed drawing', () => invoke(options.onCompareCurrent, sha));
        if (options.onCompare) {
          action(base === sha ? 'Clear base' : 'Set as base', () => {base = base === sha ? '' : sha; refreshSelection();});
          action(head === sha ? 'Clear head' : 'Set as head', () => {head = head === sha ? '' : sha; refreshSelection();});
        }
      }
      if (base && head && base !== head) {
        action('Compare base and head', () => invoke(options.onCompare, base, head));
        action('Swap base and head', () => { [base, head] = [head, base]; refreshSelection(); });
      }
      if (options.actions?.length && menu.children.length) menu.append(make('hr'));
      for (const [label, callback] of options.actions || []) action(label, () => invoke(callback));
      if (!menu.children.length) {menuTrigger = null; return;}
      menu.hidden = false;
      if (menuTrigger.hasAttribute('aria-expanded')) menuTrigger.setAttribute('aria-expanded', 'true');
      const frame = page.getBoundingClientRect(), anchor = menuTrigger.getBoundingClientRect();
      const pointer = event.type === 'contextmenu' && (event.clientX || event.clientY);
      const x = (pointer ? event.clientX : anchor.left) - frame.left;
      const y = (pointer ? event.clientY : anchor.bottom) - frame.top;
      menu.style.left = Math.max(0, Math.min(x, frame.width - menu.offsetWidth)) + 'px';
      menu.style.top = Math.max(0, Math.min(y, frame.height - menu.offsetHeight)) + 'px';
      menu.firstElementChild?.focus();
    }
    const outside = event => { if (!menu.contains(event.target) && event.target !== menuTrigger) closeMenu(); };
    const escapeMenu = event => {
      if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    };
    d.addEventListener('pointerdown', outside);
    page.onkeydown = escapeMenu;
    page.oncontextmenu = search.oncontextmenu = event => openMenu(event);
    search.onkeydown = event => {
      if (event.key !== 'Enter' || event.isComposing || !options.onSearchSubmit) return openMenu(event);
      event.preventDefault();
      const value = search.value.trim(); if (value) invoke(options.onSearchSubmit, value);
    };
    scroll.onscroll = () => closeMenu();
    function filter() {
      const query = search.value.trim().toLowerCase(); let count = 0;
      for (const row of rows) { const match = !query || row.search.includes(query); row.item.dataset.match = String(match); if (match) count++; }
      status.textContent = query && !count ? 'No matching commits.' : !commits.length && !options.loading ? 'No commits found.' : '';
    }
    function drawGraph() {
      if (disposed || !graph) return;
      drawing.replaceChildren();
      const width = Math.max(1, ...graph.rows.map(row => row.lanes)) * 16 + 17;
      list.style.setProperty('--history-graph-width', width + 'px');
      const listTop = list.getBoundingClientRect?.().top || 0;
      const positions = rows.map(row => {
        const rect = row.item.getBoundingClientRect();
        const subject = row.subject.getBoundingClientRect();
        return {top: rect.top - listTop, bottom: rect.bottom - listTop, node: subject.top - listTop + subject.height / 2};
      });
      const height = positions.at(-1)?.bottom || 1; drawing.setAttribute('width', width); drawing.setAttribute('height', height); drawing.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const x = lane => 10 + lane * 16;
      const path = (value, color, extra = {}) => drawing.append(svg('path', {d: value, stroke: color, 'stroke-width': 2, fill: 'none', ...extra}));
      graph.rows.forEach((row, index) => {
        const p = positions[index], forward = row.commit.parents.filter(parent => !row.earlier.includes(parent)); let parentIndex = 0;
        for (const edge of row.segments) {
          const start = edge.through ? p.top : p.node, middle = (start + p.bottom) / 2;
          path(`M ${x(edge.from)} ${start} C ${x(edge.from)} ${middle}, ${x(edge.to)} ${middle}, ${x(edge.to)} ${p.bottom}`, edge.color, {'data-from': row.commit.sha, 'data-parent': edge.through ? '' : forward[parentIndex++]});
        }
        if (index && graph.rows[index - 1].segments.some(edge => edge.to === row.lane)) path(`M ${x(row.lane)} ${p.top} L ${x(row.lane)} ${p.node}`, row.color);
        for (const parent of row.earlier) { const parentIndex = commits.findIndex(c => c.sha === parent), target = positions[parentIndex], rail = width - 8; if (target) path(`M ${x(row.lane)} ${p.node} C ${rail} ${p.node}, ${rail} ${target.node}, ${x(graph.rows[parentIndex].lane)} ${target.node}`, row.color, {'stroke-dasharray': '4 3', 'data-parent': parent}); }
      });
      graph.rows.forEach((row, index) => {
        const p = positions[index];
        path(`M ${x(row.lane)} ${p.node} H ${width}`, row.color, {'data-commit-link': row.commit.sha, 'stroke-width': 1.5});
        drawing.append(svg('circle', {cx:x(row.lane), cy:p.node, r:4, fill:row.commit.parentsKnown && !row.commit.parents.length ? 'var(--ht-bg)' : row.color, stroke:row.color, 'stroke-width':2, 'data-sha':row.commit.sha}));
      });
    }
    function render() {
      closeMenu(); rows = []; list.replaceChildren(drawing); graph = explorer.graphRows(commits);
      const current = validSHA(currentRef) ? currentRef.toLowerCase() : branches.find(b => b.name === currentRef)?.sha;
      for (const commit of commits) {
        const item = make('article', undefined, 'history-timeline-row'); item.dataset.sha = commit.sha; item.setAttribute('role', 'listitem');
        const card = make('div', undefined, 'history-timeline-card');
        card.tabIndex = 0; card.setAttribute('aria-keyshortcuts', 'Shift+F10');
        if (!commit.parentsKnown) card.setAttribute('aria-description', 'Commit ancestry unavailable or incomplete');
        else if (!commit.parents.length) card.setAttribute('aria-description', 'Root commit');
        const content = make('div', undefined, 'history-timeline-message');
        const [title, ...lines] = commit.message.trim().split('\n');
        const body = lines.join('\n').trim();
        let subject;
        if (body) {
          const details = make('details'); subject = make('summary', title || 'Untitled commit', 'history-timeline-subject');
          details.append(subject, make('pre', body)); details.ontoggle = drawGraph; content.append(details);
        } else {
          subject = make('div', title || 'Untitled commit', 'history-timeline-subject'); content.append(subject);
        }
        const badges = make('div', undefined, 'history-timeline-badges');
        for (const branch of branches.filter(b => b.sha === commit.sha)) badges.append(make('span', branch.name, 'history-timeline-branch'));
        if (current === commit.sha) badges.append(make('span', 'Displayed', 'history-timeline-badge'));
        const selected = make('span', undefined, 'history-timeline-selected-badges'); badges.append(selected);
        card.append(content);
        const meta = make('div', undefined, 'history-timeline-meta'), sha = make('code', commit.sha.slice(0, 8)); sha.title = commit.sha;
        meta.append(make('span', commit.author || 'Unknown author'), sha);
        const date = make('time', Number.isFinite(Date.parse(commit.date)) ? new Date(commit.date).toLocaleString() : 'Date unavailable'); if (Number.isFinite(Date.parse(commit.date))) date.setAttribute('datetime', new Date(commit.date).toISOString()); meta.append(date); card.append(meta);
        meta.append(badges);
        if (commit.parents.length > 1) badges.append(make('span', 'Merge', 'history-timeline-branch'));
        const actions = make('div', undefined, 'history-timeline-actions');
        const setBase = options.onCompare && iconButton('Set or clear base revision', 'back', '←', () => {base = base === commit.sha ? '' : commit.sha; refreshSelection();});
        const setHead = options.onCompare && iconButton('Set or clear head revision', 'forward', '→', () => {head = head === commit.sha ? '' : commit.sha; refreshSelection();});
        if (setBase) actions.append(setBase, setHead);
        if (options.onOpen) actions.append(iconButton('Open drawing at commit', 'page', '↗', () => invoke(options.onOpen, commit.sha)));
        if (options.onCompareCurrent) actions.append(iconButton('Compare with displayed drawing', 'compare', '⇄', () => invoke(options.onCompareCurrent, commit.sha)));
        const more = menuButton('Commit options'); actions.append(more); card.append(actions);
        item.append(card); list.append(item);
        const row = {item, card, subject, commit, setBase, setHead, selection:selected, search:[options.repository, commit.message, commit.author, commit.sha, ...branches.filter(b => b.sha === commit.sha).map(b => b.name)].join(' ').toLowerCase()};
        more.onclick = event => openMenu(event, row);
        card.oncontextmenu = event => openMenu(event, row);
        card.onkeydown = event => openMenu(event, row);
        rows.push(row);
      }
      refreshSelection(); filter(); drawGraph();
    }
    search.oninput = () => {closeMenu(); filter();};
    const Resize = d.defaultView?.ResizeObserver || root.ResizeObserver;
    const observer = Resize ? new Resize(drawGraph) : null; observer?.observe(list);
    const view = d.defaultView || root; view.addEventListener?.('resize', drawGraph);
    function update(next = {}) {
      if (disposed) return;
      if ('commits' in next) commits = normalize(next.commits);
      if ('loading' in next) options.loading = next.loading;
      if ('branches' in next) branches = (Array.isArray(next.branches) ? next.branches : []).slice(0, LIMIT).filter(b => b && validSHA(b.sha) && typeof b.name === 'string').map(b => ({name: text(b.name, 200), sha: b.sha.toLowerCase()}));
      if ('currentRef' in next) currentRef = text(next.currentRef, 200);
      const loaded = new Set(commits.map(c => c.sha)); if (!loaded.has(base)) base = ''; if (!loaded.has(head)) head = ''; render();
    }
    update(options);
    return {update, closeMenu, dispose() {
      if (disposed) return;
      disposed = true; closeMenu(); observer?.disconnect();
      view.removeEventListener?.('resize', drawGraph); d.removeEventListener('pointerdown', outside);
      search.remove(); compareSelected.remove(); panelMenu.remove(); page.remove(); rows = [];
    }};
  }
  const API = {mount}; root.KiCadHistoryTimeline = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(globalThis);
