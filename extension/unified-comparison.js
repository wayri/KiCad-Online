/* Inert, saved-source comparison for KiCad Online. Rendering belongs to the caller. */
((root) => {
  'use strict';
  const design = root.KiCadDesignDiff || (typeof module === 'object' && module.exports ? require('./design-diff.js') : null);
  const bom = root.KiCadBomImport || (typeof module === 'object' && module.exports ? require('./bom-import.js') : null);
  const MAX_FILES = 128, MAX_TOTAL = 96 * 1024 * 1024, MAX_TEXT = 1024 * 1024;
  const MAX_TEXT_LINES = 12000, MAX_DIFF_CELLS = 90000;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const value = item => item && typeof item === 'object' && !Array.isArray(item) ? item.quoted : item;
  const kind = form => Array.isArray(form) ? String(value(form[0])) : '';
  const children = (form, name) => Array.isArray(form) ? form.filter(item => Array.isArray(item) && kind(item) === name) : [];
  const child = (form, name) => children(form, name)[0];
  const atoms = form => Array.isArray(form) ? form.slice(1).map(value) : [];
  const scalar = value => value === undefined || value === null ? '' : String(value);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const validPath = path => typeof path === 'string' && path.length <= 500 &&
    !path.startsWith('/') && !/^[a-z]:/i.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f]/.test(part));
  function domain(path) {
    if (/\.(?:kicad_sch|sch)$/i.test(path)) return 'schematic';
    if (/\.(?:kicad_pcb|brd)$/i.test(path)) return 'layout';
    if (/\.(?:csv|tsv)$/i.test(path)) return 'bom';
    if (/\.(?:txt|md|json|yml|yaml|xml|cfg|ini|pro|kicad_pro|kicad_prl|kicad_dru|lib|csv|tsv|html?|js|css|py)$/i.test(path)) return 'text';
    throw Error('Unsupported comparison file: ' + path);
  }
  function inventory(files, side) {
    if (!Array.isArray(files) || files.length > MAX_FILES) throw Error('Invalid or excessive ' + side + ' files.');
    const map = new Map(); let total = 0;
    for (const file of files) {
      if (!file || !validPath(file.path) || typeof file.content !== 'string' || map.has(file.path))
        throw Error('Invalid or duplicate ' + side + ' file entry.');
      const type = domain(file.path);
      const bytes = new TextEncoder().encode(file.content).length;
      total += bytes;
      if (total > MAX_TOTAL || type === 'text' && bytes > MAX_TEXT) throw Error(side + ' comparison input exceeds size limits.');
      map.set(file.path, { ...file, domain: type });
    }
    return map;
  }
  function pairs(base, head, options) {
    const result = [], usedBase = new Set(), usedHead = new Set();
    if (options.pairs !== undefined) {
      if (!Array.isArray(options.pairs)) throw Error('Comparison pairs must be an array.');
      for (const pair of options.pairs) {
        const a = pair?.basePath, b = pair?.headPath;
        if (!base.has(a) || !head.has(b) || usedBase.has(a) || usedHead.has(b))
          throw Error('Comparison pair has a missing or duplicate path.');
        if (base.get(a).domain !== head.get(b).domain) throw Error('Comparison pair has incompatible file types.');
        result.push([a, b]); usedBase.add(a); usedHead.add(b);
      }
    }
    for (const path of base.keys()) if (head.has(path) && !usedBase.has(path) && !usedHead.has(path)) {
      result.push([path, path]); usedBase.add(path); usedHead.add(path);
    }
    const remainingBase = [...base.keys()].filter(path => !usedBase.has(path));
    const remainingHead = [...head.keys()].filter(path => !usedHead.has(path));
    // A single-file picker commonly supplies two different filenames for one comparison.
    if (base.size === 1 && head.size === 1 && remainingBase.length === 1 && remainingHead.length === 1 &&
      base.get(remainingBase[0]).domain === head.get(remainingHead[0]).domain) {
      result.push([remainingBase[0], remainingHead[0]]); usedBase.add(remainingBase[0]); usedHead.add(remainingHead[0]);
    }
    for (const path of base.keys()) if (!usedBase.has(path)) result.push([path, null]);
    for (const path of head.keys()) if (!usedHead.has(path)) result.push([null, path]);
    return result.sort((a, b) => cmp(a[1] || a[0], b[1] || b[0]) || cmp(a[0] || '', b[0] || ''));
  }
  function differences(before, after, omit = new Set()) {
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(k => !omit.has(k)).sort(cmp);
    return keys.filter(k => scalar(before?.[k]) !== scalar(after?.[k])).map(name => ({
      name, before: before && own(before, name) ? before[name] : null,
      after: after && own(after, name) ? after[name] : null
    }));
  }
  function placement(before, after) {
    const a = before?.position, b = after?.position;
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    const oldAngle = Number(before.properties?.Angle), newAngle = Number(after.properties?.Angle);
    const rotationDeg = Number.isFinite(oldAngle) && Number.isFinite(newAngle) ?
      ((newAngle - oldAngle + 540) % 360) - 180 : null;
    return { dxMm: dx, dyMm: dy, distanceMm: Math.hypot(dx, dy), rotationDeg };
  }
  function modelReferences(form) {
    return children(form, 'model').map(model => {
      const xyz = name => {
        const wrapper = child(model, name), node = child(wrapper, 'xyz');
        return node ? atoms(node).map(scalar) : null;
      };
      return { path: scalar(value(model[1])), offset: xyz('offset'), scale: xyz('scale'), rotate: xyz('rotate') };
    }).sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  }
  function designSnapshot(record) {
    if (!record) return null;
    const metadata = record.metadata || {};
    const snapshot = { uuid: metadata.uuid || null, position: metadata.position || null,
      properties: { ...metadata.properties } };
    if (record.kind === 'footprint' || record.kind === 'module') {
      snapshot.models = modelReferences(record.form);
      snapshot.side = scalar(value(child(record.form, 'layer')?.[1]));
    }
    return snapshot;
  }
  function designEntries(pair, beforeFile, afterFile) {
    if (!design) throw Error('KiCad design parser is unavailable.');
    const records = (file) => file ? design.projectObjects([file]) : [];
    const before = records(beforeFile), after = records(afterFile), groups = new Map();
    const canonical = record => record.key.replace(`${record.path}/`, 'paired-file/');
    for (const record of before) {
      const key = canonical(record); if (!groups.has(key)) groups.set(key, { before: [], after: [] });
      groups.get(key).before.push(record);
    }
    for (const record of after) {
      const key = canonical(record); if (!groups.has(key)) groups.set(key, { before: [], after: [] });
      groups.get(key).after.push(record);
    }
    const entries = [];
    for (const [key, group] of groups) {
      const old = [...group.before], current = [...group.after];
      // UUID-matched duplicates first cancel identical saved geometry and properties.
      for (let i = old.length - 1; i >= 0; i--) {
        const j = current.findIndex(record => record.signature === old[i].signature);
        if (j >= 0) { old.splice(i, 1); current.splice(j, 1); }
      }
      old.sort((a, b) => cmp(a.signature, b.signature)); current.sort((a, b) => cmp(a.signature, b.signature));
      for (let i = 0, count = Math.max(old.length, current.length); i < count; i++) {
        const a = old[i] || null, b = current[i] || null, before = designSnapshot(a), after = designSnapshot(b);
        const fields = differences(before?.properties, after?.properties, new Set(['Source fingerprint']));
        if (!same(before?.position, after?.position)) fields.push({ name: 'Position (mm)', before: before?.position || null, after: after?.position || null });
        if (!same(before?.models, after?.models)) fields.push({ name: '3D models', before: before?.models || [], after: after?.models || [] });
        if (before?.side !== after?.side && (before?.side || after?.side)) fields.push({ name: 'Side', before: before?.side || '', after: after?.side || '' });
        if (a && b && !fields.length) fields.push({ name: 'Saved geometry', before: before.properties['Source fingerprint'], after: after.properties['Source fingerprint'] });
        entries.push({ id: `design:${pair.basePath || pair.headPath}:${key}${count > 1 ? '#' + (i + 1) : ''}`, path: pair.path,
          basePath: pair.basePath, headPath: pair.headPath, domain: pair.domain,
          kind: (b || a).kind, status: a && b ? 'modified' : a ? 'removed' : 'added',
          label: (b || a).label, before, after, fields,
          beforePosition: before?.position || null, afterPosition: after?.position || null,
          delta: placement(before, after) });
      }
    }
    return entries;
  }
  function bomEntries(pair, beforeFile, afterFile, warnings) {
    if (!bom) throw Error('KiCad BoM parser is unavailable.');
    const parse = file => file ? bom.parse(file.content, file.path) : null;
    const a = parse(beforeFile), b = parse(afterFile);
    for (const warning of a?.warnings || []) warnings.push(`Base ${pair.basePath}: ${warning}`);
    for (const warning of b?.warnings || []) warnings.push(`Head ${pair.headPath}: ${warning}`);
    const old = new Map(), current = new Map();
    for (const item of a?.model.objects || []) {
      if (old.has(item.reference)) throw Error('Duplicate base BoM reference: ' + item.reference);
      old.set(item.reference, item);
    }
    for (const item of b?.model.objects || []) {
      if (current.has(item.reference)) throw Error('Duplicate head BoM reference: ' + item.reference);
      current.set(item.reference, item);
    }
    const entries = [];
    for (const reference of [...new Set([...old.keys(), ...current.keys()])].sort(cmp)) {
      const beforeItem = old.get(reference), afterItem = current.get(reference);
      const snapshot = item => item ? { reference, properties: { ...item.properties },
        populated: item.populated, excludeFromBom: item.excludeFromBom,
        position: item.position || null, side: item.side || '' } : null;
      const before = snapshot(beforeItem), after = snapshot(afterItem);
      const fields = differences(before?.properties, after?.properties, new Set(['Reference']));
      if (before?.populated !== after?.populated) fields.push({ name: 'Populated', before: before?.populated ?? null, after: after?.populated ?? null });
      if (before?.excludeFromBom !== after?.excludeFromBom) fields.push({ name: 'Excluded from BoM', before: before?.excludeFromBom ?? null, after: after?.excludeFromBom ?? null });
      if (before?.side !== after?.side) fields.push({ name: 'Side', before: before?.side ?? null, after: after?.side ?? null });
      if (!same(before?.position, after?.position)) fields.push({ name: 'Position (mm)', before: before?.position || null, after: after?.position || null });
      if (before && after && !fields.length) continue;
      entries.push({ id: `bom:${pair.basePath || pair.headPath}:${reference}`, path: pair.path,
        basePath: pair.basePath, headPath: pair.headPath, domain: 'bom', kind: 'component',
        status: before && after ? 'modified' : before ? 'removed' : 'added', label: reference,
        before, after, fields, beforePosition: before?.position || null,
        afterPosition: after?.position || null, delta: placement(before, after) });
    }
    return entries;
  }
  function lines(content) {
    if (content === null) return [];
    const list = content.split(/\r\n|\n|\r/);
    if (list.length > MAX_TEXT_LINES) throw Error('Text comparison exceeds line limit.');
    return list;
  }
  function diffText(beforeContent, afterContent) {
    if (beforeContent !== null && typeof beforeContent !== 'string' ||
      afterContent !== null && typeof afterContent !== 'string') throw Error('Text sources must be strings or null.');
    if (new TextEncoder().encode(beforeContent || '').length > MAX_TEXT ||
      new TextEncoder().encode(afterContent || '').length > MAX_TEXT) throw Error('Text comparison exceeds size limit.');
    const a = lines(beforeContent), b = lines(afterContent), warnings = [], rows = [];
    let prefix = 0, suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    for (let i = 0; i < prefix; i++) rows.push({ status: 'equal', beforeLine: i + 1, afterLine: i + 1, text: a[i] });
    const old = a.slice(prefix, a.length - suffix), current = b.slice(prefix, b.length - suffix);
    if (old.length * current.length <= MAX_DIFF_CELLS) {
      const width = current.length + 1, table = new Uint16Array((old.length + 1) * width);
      for (let i = old.length - 1; i >= 0; i--) for (let j = current.length - 1; j >= 0; j--)
        table[i * width + j] = old[i] === current[j] ? table[(i + 1) * width + j + 1] + 1 :
          Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      let i = 0, j = 0;
      while (i < old.length || j < current.length) {
        if (i < old.length && j < current.length && old[i] === current[j]) {
          rows.push({ status: 'equal', beforeLine: prefix + i + 1, afterLine: prefix + j + 1, text: old[i] });
          i++; j++; continue;
        }
        if (j < current.length && (i === old.length || table[i * width + j + 1] > table[(i + 1) * width + j]))
          rows.push({ status: 'added', afterLine: prefix + j + 1, text: current[j++] });
        else rows.push({ status: 'removed', beforeLine: prefix + i + 1, text: old[i++] });
      }
    } else {
      warnings.push('Text changes are shown by line position because the exact diff exceeds the bounded comparison budget.');
      const limit = Math.max(old.length, current.length);
      for (let i = 0; i < limit; i++) {
        if (i < old.length && i < current.length && old[i] === current[i])
          rows.push({ status: 'equal', beforeLine: prefix + i + 1, afterLine: prefix + i + 1, text: old[i] });
        else {
          if (i < old.length) rows.push({ status: 'removed', beforeLine: prefix + i + 1, text: old[i] });
          if (i < current.length) rows.push({ status: 'added', afterLine: prefix + i + 1, text: current[i] });
        }
      }
    }
    for (let i = a.length - suffix; i < a.length; i++) rows.push({
      status: 'equal', beforeLine: i + 1, afterLine: b.length - (a.length - i) + 1, text: a[i] });
    return { rows, warnings };
  }
  function textEntries(pair, beforeFile, afterFile, warnings) {
    const diff = diffText(beforeFile?.content ?? null, afterFile?.content ?? null);
    for (const warning of diff.warnings) warnings.push(`${pair.path}: ${warning}`);
    return diff.rows.filter(row => row.status !== 'equal').map((edit, index) => ({ id: `text:${pair.path}:${index + 1}`,
      path: pair.path, basePath: pair.basePath, headPath: pair.headPath, domain: 'text', kind: 'line',
      status: edit.status, label: `Line ${edit.afterLine || edit.beforeLine}`,
      before: edit.status === 'removed' ? { line: edit.beforeLine, text: edit.text } : null,
      after: edit.status === 'added' ? { line: edit.afterLine, text: edit.text } : null,
      fields: [{ name: 'Text', before: edit.status === 'removed' ? edit.text : null,
        after: edit.status === 'added' ? edit.text : null }],
      beforePosition: null, afterPosition: null, delta: null }));
  }
  function compare(baseFiles, headFiles, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('Invalid comparison options.');
    const base = inventory(baseFiles, 'base'), head = inventory(headFiles, 'head');
    if (base.size + head.size > MAX_FILES * 2) throw Error('Too many comparison files.');
    const entries = [], files = [], warnings = [];
    for (const [basePath, headPath] of pairs(base, head, options)) {
      const before = basePath === null ? null : base.get(basePath), after = headPath === null ? null : head.get(headPath);
      const type = (after || before).domain, path = headPath || basePath;
      const pair = { path, basePath, headPath, domain: type,
        status: before && after ? 'paired' : before ? 'removed' : 'added',
        beforeContent: before?.content ?? null, afterContent: after?.content ?? null };
      files.push(pair);
      if (!before || !after) warnings.push(`${path}: ${before ? 'head' : 'base'} file is missing; its saved contents are shown as ${before ? 'removed' : 'added'}.`);
      if (type === 'bom') entries.push(...bomEntries(pair, before, after, warnings));
      else if (type === 'text') entries.push(...textEntries(pair, before, after, warnings));
      else entries.push(...designEntries(pair, before, after));
    }
    entries.sort((a, b) => cmp(a.path, b.path) || cmp(a.domain, b.domain) || cmp(a.id, b.id) || cmp(a.status, b.status));
    const counts = { added: 0, removed: 0, modified: 0 };
    for (const entry of entries) counts[entry.status]++;
    return { entries, counts, warnings, files };
  }
  const api = { compare, diffText, limits: { files: MAX_FILES, totalBytesPerSide: MAX_TOTAL,
    textBytesPerFile: MAX_TEXT, textLinesPerFile: MAX_TEXT_LINES, exactDiffCells: MAX_DIFF_CELLS } };
  root.KiCadUnifiedComparison = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this);
