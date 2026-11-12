/* Saved KiCad object comparison. Browser-only; no geometry renderer required. */
((root) => {
  "use strict";
  const MAX_FILE = 8 * 1024 * 1024;
  const MAX_PROJECT = 96 * 1024 * 1024;
  const MAX_FILES = 128;
  const MAX_DEPTH = 96;
  const MAX_NODES = 1000000;
  const SCHEMATIC = new Set(["symbol", "sheet", "wire", "bus", "bus_entry", "label",
    "global_label", "hierarchical_label", "junction", "no_connect", "text", "text_box",
    "polyline", "rectangle", "circle", "arc", "bezier", "image"]);
  const BOARD = new Set(["module", "footprint", "segment", "arc", "via", "zone", "gr_line",
    "gr_rect", "gr_circle", "gr_arc", "gr_poly", "gr_curve", "gr_text", "gr_text_box",
    "gr_bitmap", "dimension", "target"]);
  const OMIT = new Set(["uuid", "tstamp", "filled_polygon", "fill_segments"]);
  const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

  // KiCad files are overwhelmingly ASCII. Keep the same ECMAScript whitespace
  // grammar without constructing/testing a regular expression for every byte.
  const spaceCode=code=>code===32||(code>=9&&code<=13)||(code>127&&/\s/.test(String.fromCharCode(code)));
  function parse(source, options = {}) {
    if (typeof source !== "string") throw new TypeError("KiCad source must be a string.");
    if (/^\s*PCBNEW-BOARD/.test(source))throw Error('Legacy .brd boards are detected but this drawing format is not yet rendered. Open and save a separate .kicad_pcb copy in KiCad.');
    if (/^\s*EESchema Schematic File Version [24]\b/.test(source)) {
      const legacy=root.KiCadLegacy||(typeof module==='object'&&module.exports?require('./legacy-kicad.js'):null);
      if(!legacy)throw Error('Legacy schematic adapter is unavailable; reload the extension.');
      return legacy.parse(source,options);
    }
    const board = /^\s*\(kicad_pcb(?:\s|\))/.test(source);
    if (new TextEncoder().encode(source).length > (board ? 64 * 1024 * 1024 : MAX_FILE)) throw new Error("KiCad file exceeds browser parser size limits.");
    const nodeLimit = board ? 6000000 : MAX_NODES;
    const stack = [], roots = [];
    let i = 0, nodes = 0;
    const append = (item) => {
      if (++nodes > nodeLimit) throw new Error("KiCad file has too many S-expression nodes.");
      (stack.at(-1) || roots).push(item);
    };
    while (i < source.length) {
      const ch = source[i];
      if (spaceCode(source.charCodeAt(i))) { i++; continue; }
      if((ch==="<"||ch===">")&&/^(?:<{7,}|>{7,})(?:\s|$)/.test(source.slice(i,i+120)))throw new Error("Unresolved Git merge conflict at line "+(source.slice(0,i).split("\n").length)+". Resolve the conflict in a separate copy before viewing.");
      if (ch === ";") { while (i < source.length && source[i] !== "\n") i++; continue; }
      if (ch === "(") {
        if (stack.length >= MAX_DEPTH) throw new Error("KiCad S-expression is too deep.");
        const node = [];
        append(node); stack.push(node); i++; continue;
      }
      if (ch === ")") {
        if (!stack.length) throw new Error("Unexpected closing parenthesis in KiCad file.");
        stack.pop(); i++; continue;
      }
      if (!stack.length) throw new Error("Expected a KiCad S-expression.");
      if (ch === '"') {
        let value = "", closed = false;
        i++;
        while (i < source.length) {
          const next = source[i++];
          if (next === '"') { closed = true; break; }
          if (next === "\\") {
            if (i >= source.length) throw new Error("Unterminated KiCad escape sequence.");
            const escaped = source[i++];
            const decoded = ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" })[escaped];
            value += decoded === undefined ? `\\${escaped}` : decoded;
          } else value += next;
        }
        if (!closed) throw new Error("Unterminated quoted KiCad string.");
        append({ quoted: value }); continue;
      }
      const start = i;
      while (i < source.length) { const code=source.charCodeAt(i);if(code===40||code===41||code===59||code===34||spaceCode(code))break;i++; }
      if (start === i) throw new Error("Unexpected KiCad source character.");
      const token = source.slice(start, i);
      // Legacy hexadecimal timestamps and unquoted names may look like
      // decimal exponents (e.g. 59E99999). Keep identity fields lexical.
      const parent = stack[stack.length - 1], tag = parent?.[0];
      const lexical = ["uuid", "tstamp", "tedit", "path", "lib_id", "host", "generator", "generator_version"].includes(tag) ||
        (["module", "footprint", "symbol"].includes(tag) && parent.length === 1) ||
        (tag === "net" && parent.length === 2) || (tag === "fp_text" && parent.length === 2) ||
        (tag === "gr_text" && parent.length === 1) || (tag === "pad" && parent.length === 1);
      if (NUMBER.test(token) && !lexical) {
        const number = Number(token);
        if (!Number.isFinite(number)) throw new Error("Invalid numeric KiCad value.");
        append(number);
      } else append(token);
    }
    if (stack.length || roots.length !== 1 || !Array.isArray(roots[0])) {
      throw new Error("Incomplete KiCad S-expression.");
    }
    return roots[0];
  }
  const value = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kindOf = (form) => Array.isArray(form) ? (value(form[0]) === "module" ? "footprint" : String(value(form[0]))) : "";
  const children = (form, kind) => form.filter((item) => Array.isArray(item) && kindOf(item) === kind);
  const child = (form, kind) => children(form, kind)[0];
  const second = (form, kind) => value(child(form, kind)?.[1]);
  function point(form) {
    for (const name of ["at", "start", "center", "end", "xy"]) {
      const item = child(form, name);
      if (item && Number.isFinite(value(item[1])) && Number.isFinite(value(item[2]))) {
        return { x: value(item[1]), y: value(item[2]) };
      }
    }
    for (const name of ["pts", "polygon"]) {
      const wrapper = child(form, name);
      const xy = wrapper && child(name === "polygon" ? child(wrapper, "pts") || wrapper : wrapper, "xy");
      if (xy && Number.isFinite(value(xy[1])) && Number.isFinite(value(xy[2]))) {
        return { x: value(xy[1]), y: value(xy[2]) };
      }
    }
    return null;
  }
  function properties(form, kind) {
    const entries = [];
    for (const field of children(form, "property")) {
      if (field.length >= 3) entries.push([String(value(field[1])), String(value(field[2]))]);
    }
    if(kind==="footprint")for(const [role,name]of [["reference","Reference"],["value","Value"]]){
      const legacy=children(form,"fp_text").find(field=>value(field[1])===role);
      if(legacy&&legacy.length>=3&&!entries.some(([key])=>key===name))entries.push([name,String(value(legacy[2]))]);
    }
    for (const key of ["lib_id", "layer", "width", "drill", "size", "unit"]) {
      const found = child(form, key);
      if (found) entries.push([key, found.slice(1).map(value).join(", ")]);
    }
    const layers = child(form, "layers");
    if (layers) entries.push(["Layers", layers.slice(1).map(value).join(", ")]);
    const net = child(form, "net");
    if (net) entries.push(["Net", String(value(net[2] ?? net[1]))]);
    const at = child(form, "at");
    if (at && Number.isFinite(value(at[3]))) entries.push(["Angle", String(value(at[3]))]);
    if (["label", "global_label", "hierarchical_label", "text", "gr_text", "gr_text_box"].includes(kind)) {
      entries.push(["Text", String(value(form[1] ?? ""))]);
    }
    if (kind === "pad") {
      entries.push(["Number", String(value(form[1] ?? ""))]);
      entries.push(["Type", String(value(form[2] ?? ""))]);
      entries.push(["Shape", String(value(form[3] ?? ""))]);
    }
    return Object.fromEntries(entries);
  }
  function structural(form) {
    if (!Array.isArray(form)) return form && typeof form === "object" ? ["quoted", form.quoted] : form;
    return form.filter((item) => !Array.isArray(item) || !OMIT.has(kindOf(item))).map(structural);
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function identity(form, kind, props, signature) {
    const uuid = second(form, "uuid") ?? second(form, "tstamp");
    if (uuid !== undefined && uuid !== null && String(uuid)) return { key: `uuid:${uuid}`, uuid: String(uuid) };
    const anchor = kind === "pad" ? props.Number :
      kind === "sheet" ? props.Sheetfile :
      kind === "symbol" || kind === "footprint" ? props.Reference : undefined;
    return { key: anchor ? `fallback:${String(anchor)}` : `fallback:${hash(signature)}`, uuid: null };
  }
  function labelFor(form, kind, props, parentLabel) {
    if (kind === "pad") return `${parentLabel || "Footprint"} pad ${props.Number || ""}`.trim();
    return props.Reference || props.Sheetname || props['Sheet name'] || props.Text ||
      (kind === "footprint" ? String(value(form[1] ?? "Footprint")) :
        kind === "symbol" ? props.lib_id || "symbol" : kind.replace(/_/g, " "));
  }
  function padPosition(local, placement) {
    if (!local || !placement?.position) return null;
    const angle = Number(value(child(placement.form, "at")?.[3] ?? 0));
    const radians = (Number.isFinite(angle) ? angle : 0) * Math.PI / 180;
    const c = Math.cos(radians), s = Math.sin(radians);
    const x = placement.position.x + local.x * c + local.y * s;
    const y = placement.position.y - local.x * s + local.y * c;
    const rounded = (number) => Math.round(number * 1e6) / 1e6;
    return { x: rounded(x), y: rounded(y) };
  }
  function objectRecord(path, form, parent = null, librarySignature = null) {
    const kind = kindOf(form);
    const props = properties(form, kind);
    const local = point(form);
    const position = kind === "pad" ? padPosition(local, parent) : local;
    const signature = JSON.stringify([structural(form), position, librarySignature]);
    props["Source fingerprint"] = hash(signature);
    const identityValue = identity(form, kind, props, signature);
    const scope = parent ? `${parent.scope}/` : `${path}/`;
    const key = `${scope}${kind}:${identityValue.key}`;
    const label = labelFor(form, kind, props, parent?.label);
    return { key, scope: key, signature, metadata: {
      uuid: identityValue.uuid, position, properties: props }, path, kind, label, form };
  }
  function collect(path, content, onParsed = null, options = {}) {
    const rootForm = parse(content, options);
    onParsed?.(rootForm);
    const rootKind = kindOf(rootForm);
    if (rootKind !== "kicad_sch" && rootKind !== "kicad_pcb") throw new Error("Expected a KiCad schematic or board.");
    const types = rootKind === "kicad_sch" ? SCHEMATIC : BOARD;
    const definitions = new Map();
    if (rootKind === "kicad_sch") {
      const library = child(rootForm, "lib_symbols");
      if (library) for (const definition of children(library, "symbol")) {
        const name = value(definition[1]);
        if (typeof name === "string") definitions.set(name, JSON.stringify(structural(definition)));
      }
    }
    const objects = [];
    for (const form of rootForm) {
      if (!Array.isArray(form) || !types.has(kindOf(form))) continue;
      const definition = kindOf(form) === "symbol" ? definitions.get(String(second(form, "lib_id"))) : null;
      const record = objectRecord(path, form, null, definition);
      objects.push(record);
      if (rootKind === "kicad_pcb" && ["footprint","module"].includes(record.kind)) {
        for (const pad of children(form, "pad")) objects.push(objectRecord(path, pad,
          { form, position: record.metadata.position, scope: record.scope, label: record.label }));
      }
    }
    return objects;
  }
  // Job-scoped snapshots reuse validated source without retaining projects globally.
  const preparedProjects = new WeakMap();
  function prepareProject(files) {
    const parsed = new Map(), records = projectObjects(files, (file, ast) => parsed.set(file.path, ast));
    const snapshot = Object.freeze({});
    preparedProjects.set(snapshot, {files: files.map(file => ({path: file.path, content: file.content, libraries:JSON.stringify(file.legacyLibraries||[])})), parsed, records});
    return snapshot;
  }
  function preparedFile(snapshot, path) {
    const state = preparedProjects.get(snapshot);
    if (!state || !state.parsed.has(path)) throw new Error('Prepared KiCad file is unavailable.');
    return state.parsed.get(path);
  }
  function projectObjects(files, onParsed = null, snapshot = null) {
    if (snapshot) {
      const state = preparedProjects.get(snapshot);
      if (!state || !Array.isArray(files) || files.length !== state.files.length ||
          files.some((file, index) => file?.path !== state.files[index].path || file?.content !== state.files[index].content || JSON.stringify(file.legacyLibraries||[]) !== state.files[index].libraries)) {
        throw new Error('Prepared KiCad project differs from source.');
      }
      for (const file of files) onParsed?.(file, state.parsed.get(file.path));
      // Consumers assign IDs to records; keep those assignments isolated.
      return state.records.map(record => ({...record}));
    }
    if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error("Too many KiCad files to compare.");
    const paths = new Set(), objects = [];
    let total = 0;
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string" ||
        !/(?:\.kicad_(?:sch|pcb)|\.(?:sch|brd))$/i.test(file.path) || paths.has(file.path)) {
        throw new Error("Invalid or duplicate KiCad file entry.");
      }
      paths.add(file.path);
      const size = new TextEncoder().encode(file.content).length;
      total += size;
      if (size > (/\.kicad_pcb$/i.test(file.path) ? 64 * 1024 * 1024 : MAX_FILE) || total > MAX_PROJECT) throw new Error("KiCad project exceeds browser comparison size limits.");
      for (const object of collect(file.path, file.content, ast => onParsed?.(file, ast), {libraries:file.legacyLibraries})) objects.push(object);
    }
    return objects;
  }
  function compareProjects(baseFiles, headFiles) {
    const base = projectObjects(baseFiles), head = projectObjects(headFiles);
    const grouped = new Map();
    for (const record of base) {
      if (!grouped.has(record.key)) grouped.set(record.key, { before: [], after: [] });
      grouped.get(record.key).before.push(record);
    }
    for (const record of head) {
      if (!grouped.has(record.key)) grouped.set(record.key, { before: [], after: [] });
      grouped.get(record.key).after.push(record);
    }
    const changes = [], counts = { added: 0, removed: 0, modified: 0 };
    const emit = (record, status, before, after, id) => {
      changes.push({ id, path: record.path, kind: record.kind, label: record.label,
        status, before: before?.metadata ?? null, after: after?.metadata ?? null });
      counts[status]++;
    };
    for (const [key, group] of grouped) {
      // Match exact duplicates first, then pair remaining objects deterministically.
      const before = [...group.before], after = [...group.after];
      for (let i = before.length - 1; i >= 0; i--) {
        const j = after.findIndex((record) => record.signature === before[i].signature);
        if (j >= 0) { before.splice(i, 1); after.splice(j, 1); }
      }
      before.sort((a, b) => a.signature.localeCompare(b.signature));
      after.sort((a, b) => a.signature.localeCompare(b.signature));
      const count = Math.max(before.length, after.length);
      for (let i = 0; i < count; i++) {
        const old = before[i] || null, current = after[i] || null;
        const status = old && current ? "modified" : old ? "removed" : "added";
        emit(current || old, status, old, current, count > 1 ? `${key}#${i + 1}` : key);
      }
    }
    changes.sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id) || a.status.localeCompare(b.status));
    return { changes, counts };
  }
  root.KiCadDesignDiff = { compareProjects, projectObjects, parse, prepareProject, preparedFile, MAX_FILES };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadDesignDiff;
})(typeof globalThis === "object" ? globalThis : this);
