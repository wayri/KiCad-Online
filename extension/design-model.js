/* Read-only saved KiCad design and assembly-variant review model. */
((root) => {
  "use strict";
  const diff = root.KiCadDesignDiff || (typeof require === "function" ? require("./design-diff.js") : null);
  const MAX_CONFIG = 1024 * 1024;
  const MAX_VARIANTS = 64;
  const MAX_RULES = 10000;
  const MAX_SAVED_OBJECT_NODES = 20000;
  const MAX_SAVED_OBJECT_CHARS = 512 * 1024;
  const MAX_SAVED_PROJECT_NODES = 300000;
  const MAX_SAVED_PROJECT_CHARS = 16 * 1024 * 1024;
  const MAX_SAVED_PROPERTIES = 512;
  const MAX_SAVED_PROPERTY_NAME_CHARS = 256;
  const MAX_SAVED_PROPERTY_VALUE_CHARS = 4096;
  const PARTS = new Set(["symbol", "footprint"]);
  const RESERVED = new Set(["reference", "uuid", "path", "dnp", "exclude from bom",
    "exclude from board", "unit", "source fingerprint"]);
  const validPath = (path) => typeof path === "string" && path.length <= 500 &&
    /(?:\.kicad_(?:sch|pcb)|\.(?:sch|brd))$/i.test(path) && !path.startsWith("/") &&
    path.split("/").every((part) => part && part !== "." && part !== ".." && !/[\\\x00-\x1f]/.test(part));
  // Variant rules also identify parts in inert imported BoM sources. Drawing
  // traversal continues to use validPath and accepts native KiCad files only.
  const validVariantPath = path => typeof path==='string' && path.length<=500 && /\.(?:kicad_sch|kicad_pcb|csv|tsv|json|html?)$/i.test(path) && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\\\x00-\x1f]/.test(p));
  const textValue = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kindOf = (form) => Array.isArray(form) ? String(textValue(form[0])) : "";
  const child = (form, name) => form.find((item) => Array.isArray(item) && kindOf(item) === name);
  const children = (form, name) => Array.isArray(form) ? form.filter((item) => Array.isArray(item) && kindOf(item) === name) : [];
  const field = (form, name) => textValue(child(form, name)?.[1]);
  const yesNo = (flag) => flag ? "Yes" : "No";
  const safeText = (value, limit = 200) => typeof value === "string" && !!value &&
    value.length <= limit && !/[\x00-\x1f]/.test(value);

  function nativeFlag(form, name) {
    const flag = child(form, name);
    if (!flag) return null;
    if (flag.length === 1) return true;
    const raw = String(textValue(flag[1])).toLowerCase();
    if (["yes", "true", "1"].includes(raw)) return true;
    if (["no", "false", "0"].includes(raw)) return false;
    return null;
  }
  function partFlags(form) {
    const attributes = child(form, "attr")?.slice(1).map((item) => String(textValue(item))) || [];
    const nativeDnp = nativeFlag(form, "dnp") === true || attributes.includes("dnp");
    const affirmative = value => ["yes", "true", "1", "dnp", "dni", "do not populate", "do not install"].includes(String(value ?? "").trim().toLowerCase());
    const marked = names => children(form,"property").some(p => names.includes(String(textValue(p[1])).trim().toLowerCase()) && affirmative(textValue(p[2])));
    const dni = marked(["dni", "do not install"]), dnp = nativeDnp || marked(["dnp", "do not populate"]) || dni;
    const populationReason = nativeDnp ? "DNP" : dni ? "DNI" : dnp ? "DNP" : null;
    const excludeFromBom = nativeFlag(form, "in_bom") === false || attributes.includes("exclude_from_bom");
    const excludeFromBoard = nativeFlag(form, "on_board") === false || attributes.includes("exclude_from_board");
    return { populated: !dnp, populationReason, excludeFromBom, excludeFromBoard };
  }
  function childPath(parent, name) {
    if (typeof name !== "string" || !/(?:\.kicad_sch|\.sch)$/i.test(name) || name.startsWith("/") || name.includes("\\")) return null;
    const parts = parent.split("/").slice(0, -1);
    for (const part of name.split("/")) {
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
    const resolved = parts.join("/");
    return validPath(resolved) ? resolved : null;
  }
  function hasNativeVariant(form) {
    const queue = [form];
    while (queue.length) {
      const item = queue.pop();
      if (!Array.isArray(item)) continue;
      if (kindOf(item) === "variant") return true;
      for (const entry of item) if (Array.isArray(entry)) queue.push(entry);
    }
    return false;
  }
  function ownProps(source) { return Object.fromEntries(Object.entries(source || {})); }
  function frozenTree(node) {
    if (node && typeof node === "object" && Object.isFrozen(node)) return node;
    if (Array.isArray(node)) node.forEach(frozenTree);
    else if (node && typeof node === "object") Object.values(node).forEach(frozenTree);
    return node && typeof node === "object" ? Object.freeze(node) : node;
  }
  function snapshotTree(form, total) {
    let nodes = 0, chars = 0, truncated = false;
    const omitted = (count = 1) => { truncated = true; return { omitted: count }; };
    function clone(item) {
      const scalar = Array.isArray(item) ? 0 : String(textValue(item) ?? "").length;
      if (nodes + 1 > MAX_SAVED_OBJECT_NODES || chars + scalar > MAX_SAVED_OBJECT_CHARS ||
        total.nodes + 1 > MAX_SAVED_PROJECT_NODES || total.chars + scalar > MAX_SAVED_PROJECT_CHARS) return omitted();
      nodes++; total.nodes++; chars += scalar; total.chars += scalar;
      if (Array.isArray(item)) {
        const result = [];
        for (let index = 0; index < item.length; index++) {
          if (nodes >= MAX_SAVED_OBJECT_NODES || total.nodes >= MAX_SAVED_PROJECT_NODES ||
            chars >= MAX_SAVED_OBJECT_CHARS || total.chars >= MAX_SAVED_PROJECT_CHARS) {
            result.push(omitted(item.length - index)); break;
          }
          result.push(clone(item[index]));
        }
        return result;
      }
      if (item && typeof item === "object") return { quoted: item.quoted };
      return item;
    }
    const tree = frozenTree(clone(form));
    return { tree, truncated };
  }
  function sourceProperties(form, tree) {
    const originals = children(form, "property");
    const captured = Array.isArray(tree) ? children(tree, "property") : [];
    return originals.slice(0, MAX_SAVED_PROPERTIES).map((property, index) => {
      const name = String(textValue(property[1] ?? "")), value = String(textValue(property[2] ?? ""));
      return Object.freeze({
        name: name.length <= MAX_SAVED_PROPERTY_NAME_CHARS ? name : null,
        value: value.length <= MAX_SAVED_PROPERTY_VALUE_CHARS ? value : null,
        nameLength: name.length, valueLength: value.length,
        truncated: name.length > MAX_SAVED_PROPERTY_NAME_CHARS || value.length > MAX_SAVED_PROPERTY_VALUE_CHARS,
        tree: captured.length === originals.length ? captured[index] : null
      });
    });
  }
  function relevantLibrary(definition, unit) {
    if (!definition) return null;
    const selected = Number(unit);
    return definition.filter((item) => {
      if (kindOf(item) !== "symbol") return true;
      const match = String(textValue(item[1] ?? "")).match(/_(\d+)_\d+$/);
      return !match || Number(match[1]) === 0 || Number(match[1]) === selected;
    });
  }
  // Keep bounded electrical identity independent of the display snapshot budget.
  function sourceAssociation(form, rootUuid) {
    const instances = [], paths = children(form, "path");
    let complete = paths.length <= 1;
    const path = paths.length === 1 ? textValue(paths[0][1]) : null;
    if (path !== null && !safeText(path, 2000)) complete = false;
    for (const project of children(child(form, "instances"), "project")) {
      for (const placement of children(project, "path")) {
        if (instances.length >= 64) { complete = false; break; }
        const prefix = textValue(placement[1]), reference = field(placement, "reference");
        if (!safeText(prefix, 1800) || !safeText(reference)) { complete = false; continue; }
        instances.push({ prefix, reference });
      }
    }
    return frozenTree({ rootUuid: safeText(rootUuid) ? rootUuid : null,
      path: safeText(path, 2000) ? path : null, instances, complete });
  }
  function savedSettings(item, definitions, total, libraryCache) {
    const source = snapshotTree(item.form, total);
    const properties = sourceProperties(item.form, source.tree);
    const propertyCount = children(item.form, "property").length;
    const saved = { format: "kicad-sexpr", tree: source.tree,
      properties, propertyCount,
      truncated: source.truncated || propertyCount > MAX_SAVED_PROPERTIES || properties.some((field) => field.truncated) };
    if (item.kind === "symbol") {
      const id = String(field(item.form, "lib_name") || field(item.form, "lib_id") || ""), unit = Number(field(item.form, "unit") || 1);
      const definition = definitions?.get(id);
      if (definition) {
        const key = `${item.path}\0${id}\0${unit}`;
        if (!libraryCache.has(key)) {
          const library = snapshotTree(relevantLibrary(definition, unit), total);
          libraryCache.set(key, frozenTree({ id, unit, tree: library.tree, truncated: library.truncated }));
        }
        saved.library = libraryCache.get(key);
      }
    }
    return frozenTree(saved);
  }
  function validPropertyName(name) {
    return safeText(name, 100) && !["__proto__", "constructor", "prototype"].includes(name.toLowerCase()) &&
      !RESERVED.has(name.toLowerCase());
  }
  function normalizeConfig(config) {
    if (config == null) return { variants: [], warnings: [] };
    if (!config || typeof config !== "object" || Array.isArray(config) || config.schemaVersion !== 1 ||
      !Array.isArray(config.variants) || config.variants.length > MAX_VARIANTS) {
      throw new Error("Variant metadata requires schemaVersion 1 and a variants array (max 64).");
    }
    if (Object.keys(config).some((key) => !["schemaVersion", "variants", "warnings", "format"].includes(key)) ||
      (config.format !== undefined && config.format !== "csv")) {
      throw new Error("Variant metadata has unsupported fields.");
    }
    const csv = config.format === "csv";
    const ids = new Set(), variants = [];
    let ruleCount = 0;
    for (const variant of config.variants) {
      if (!variant || !safeText(variant.id, 64) || variant.id === "default" ||
        !/^[A-Za-z0-9_-]+$/.test(variant.id) ||
        !safeText(variant.name, 100) || !Array.isArray(variant.parts) || ids.has(variant.id) ||
        Object.keys(variant).some((key) => !["id", "name", "parts"].includes(key))) {
        throw new Error("Variant IDs/names must be unique and parts must be an array.");
      }
      ids.add(variant.id);
      const rules = [];
      for (const rule of variant.parts) {
        if (++ruleCount > MAX_RULES) throw new Error("Variant metadata has too many part rules.");
        if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
          Object.keys(rule).some((key) => !["path", "reference", "uuid", "populated", "properties"].includes(key))) {
          throw new Error("Variant part rule has unsupported fields.");
        }
        if ((rule.path === undefined ? !csv : !validVariantPath(rule.path)) ||
          (rule.reference === undefined) === (rule.uuid === undefined) ||
          (rule.reference !== undefined && !safeText(rule.reference)) ||
          (rule.uuid !== undefined && !safeText(rule.uuid)) ||
          (rule.populated !== undefined && typeof rule.populated !== "boolean")) {
          throw new Error("Each variant part needs a safe file path, exactly one reference or UUID, and optional boolean populated.");
        }
        if (rule.properties !== undefined && (!rule.properties || typeof rule.properties !== "object" ||
          Array.isArray(rule.properties) || Object.keys(rule.properties).length > 128)) {
          throw new Error("Variant properties must be a small object.");
        }
        const properties = {};
        for (const [name, value] of Object.entries(rule.properties || {})) {
          if (!validPropertyName(name) || !["string", "number", "boolean"].includes(typeof value) ||
            (typeof value === "string" && value.length > 4096) ||
            (typeof value === "number" && !Number.isFinite(value))) {
            throw new Error(`Invalid variant property: ${name}.`);
          }
          Object.defineProperty(properties, name, { value: String(value), enumerable: true, writable: true });
        }
        if (rule.populated === undefined && !Object.keys(properties).length) {
          throw new Error("Variant part rule has no population or property override.");
        }
        rules.push({ path: rule.path ?? null, reference: rule.reference ?? null,
          uuid: rule.uuid ?? null, populated: rule.populated, properties });
      }
      variants.push({ id: variant.id, name: variant.name, parts: rules });
    }
    return { variants, warnings: Array.isArray(config.warnings) ? config.warnings.filter((item) => typeof item === "string").slice(0, 1000) : [] };
  }
  function parseCsv(text) {
    const rows = [], row = [];
    let cell = "", quoted = false, closed = false;
    function finishCell() { row.push(cell); cell = ""; closed = false; }
    function finishRow() { finishCell(); rows.push(row.splice(0)); if (rows.length > MAX_RULES + 1) throw new Error("CSV has too many rows."); }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else cell += ch;
      } else if (ch === '"') {
        if (cell || closed) throw new Error(`Malformed quoted CSV field near row ${rows.length + 1}.`);
        quoted = true;
      } else if (ch === ",") finishCell();
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        finishRow();
      } else if (closed && !/\s/.test(ch)) throw new Error(`Characters after quoted CSV field near row ${rows.length + 1}.`);
      else if (!closed) cell += ch;
    }
    if (quoted) throw new Error("Unterminated quoted CSV field.");
    if (cell || row.length || closed) finishRow();
    return rows.filter((fields) => fields.some((item) => item.trim()));
  }
  function csvBoolean(value) {
    if (!value) return null;
    const lower = value.trim().toLowerCase();
    if (["yes", "true", "1", "y"].includes(lower)) return true;
    if (["no", "false", "0", "n"].includes(lower)) return false;
    return undefined;
  }
  function csvConfig(text) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ""));
    if (!rows.length) throw new Error("Variant CSV is empty.");
    const headers = rows.shift().map((item) => item.trim());
    const lower = headers.map((item) => item.toLowerCase());
    if (!lower.includes("variant") || !lower.includes("reference")) {
      throw new Error("Variant CSV requires Variant and Reference columns.");
    }
    if (new Set(lower).size !== lower.length) throw new Error("Variant CSV has duplicate headers.");
    const reserved = new Set(["variant", "reference", "file", "path", "file/path", "populated", "dnp"]);
    const variants = new Map(), warnings = [];
    for (let index = 0; index < rows.length; index++) {
      const cells = rows[index], line = index + 2;
      if (cells.length > headers.length) { warnings.push(`CSV row ${line}: too many fields; row skipped.`); continue; }
      const column = (name) => cells[lower.indexOf(name)]?.trim() || "";
      const name = column("variant"), references = column("reference").split(/[,\s]+/).filter(Boolean);
      if (!safeText(name, 100) || !references.length) { warnings.push(`CSV row ${line}: missing variant or reference; row skipped.`); continue; }
      const file = column("file/path") || column("file") || column("path");
      if (file && !validVariantPath(file)) { warnings.push(`CSV row ${line}: unsafe or unsupported file path; row skipped.`); continue; }
      const populated = csvBoolean(column("populated")), dnp = csvBoolean(column("dnp"));
      if (populated === undefined || dnp === undefined ||
        (populated !== null && dnp !== null && populated === dnp)) {
        warnings.push(`CSV row ${line}: invalid or conflicting Populated/DNP value; row skipped.`); continue;
      }
      const effective = populated !== null ? populated : dnp !== null ? !dnp : undefined;
      const properties = {};
      let invalid = false;
      for (let c = 0; c < headers.length; c++) {
        if (reserved.has(lower[c]) || !cells[c]?.trim()) continue;
        if (!validPropertyName(headers[c]) || cells[c].length > 4096) { invalid = true; break; }
        Object.defineProperty(properties, headers[c], { value: cells[c].trim(), enumerable: true, writable: true });
      }
      if (invalid || (effective === undefined && !Object.keys(properties).length)) {
        warnings.push(`CSV row ${line}: invalid or empty override; row skipped.`); continue;
      }
      if (!variants.has(name)) variants.set(name, { id: "", name, parts: [] });
      for (const reference of references) {
        if (!safeText(reference)) { warnings.push(`CSV row ${line}: invalid reference ${reference}; skipped.`); continue; }
        variants.get(name).parts.push({ ...(file ? { path: file } : {}), reference,
          ...(effective === undefined ? {} : { populated: effective }), properties });
      }
    }
    const used = new Set();
    for (const variant of variants.values()) {
      const base = variant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "variant";
      let id = base.slice(0, 64), suffix = 2;
      while (id === "default" || used.has(id)) {
        const tail = `-${suffix++}`;
        id = `${base.slice(0, 64 - tail.length)}${tail}`;
      }
      variant.id = id; used.add(id);
    }
    return { schemaVersion: 1, format: "csv", variants: [...variants.values()], warnings };
  }
  function parseVariantConfig(text, filename) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_CONFIG) {
      throw new Error("Variant metadata must be text under 1 MiB.");
    }
    if (/\.csv$/i.test(filename || "")) return csvConfig(text);
    if (!/\.json$/i.test(filename || "")) throw new Error("Use a .json or .csv variant metadata file.");
    let config;
    try { config = JSON.parse(text); } catch { throw new Error("Variant JSON is malformed."); }
    normalizeConfig(config);
    return config;
  }
  function buildProject(files, variantConfig = null, snapshot = null) {
    if (!diff?.projectObjects || !diff.parse) throw new Error("Load design-diff.js before design-model.js.");
    if (!Array.isArray(files) || files.some((file) => !validPath(file?.path))) {
      throw new Error("Project contains an unsafe or unsupported KiCad path.");
    }
    const config = normalizeConfig(variantConfig);
    const warnings = [...config.warnings];
    const sheets = [], labels = new Map(), paths = new Set(files.map((file) => file.path));
    const definitionsByPath = new Map(), rootUuids = new Map();
    const raw = diff.projectObjects(files, (file, parsed) => {
      const kind = kindOf(parsed) === "kicad_sch" ? "schematic" : "board";
      sheets.push({ path: file.path, label: file.path.split("/").at(-1), kind, ...(kind === "schematic" && safeText(field(parsed, "uuid")) ? { rootUuid: field(parsed, "uuid") } : {}) });
      if (kind === "schematic") {
        rootUuids.set(file.path, field(parsed, "uuid"));
        const definitions = new Map();
        for (const definition of children(child(parsed, "lib_symbols"), "symbol")) {
          const id = textValue(definition[1]);
          if (typeof id === "string") definitions.set(id, definition);
        }
        definitionsByPath.set(file.path, definitions);
      }
      if (hasNativeVariant(parsed)) warnings.push(`${file.path}: saved native KiCad variant data is present but is not interpreted by this review overlay.`);
    },snapshot);
    for (const item of raw) if (item.kind === "sheet") {
      const target = childPath(item.path, item.metadata.properties.Sheetfile ?? item.metadata.properties['Sheet file']);
      if (target && paths.has(target)) labels.set(target, item.metadata.properties.Sheetname || item.metadata.properties['Sheet name'] || target.split("/").at(-1));
    }
    for (const sheet of sheets) if (labels.has(sheet.path)) sheet.label = labels.get(sheet.path);
    const ids = new Map(), byRawKey = new Map(), objects = [];
    const savedBudget = { nodes: 0, chars: 0 }, libraryCache = new Map();
    for (const item of raw) {
      const number = (ids.get(item.key) || 0) + 1;
      ids.set(item.key, number);
      const id = number === 1 ? item.key : `${item.key}#${number}`;
      if (number > 1) warnings.push(`${item.path}: duplicate saved identity ${item.key}; object IDs were disambiguated.`);
      const props = ownProps(item.metadata.properties);
      const part = PARTS.has(item.kind);
      const flags = part ? partFlags(item.form) : null;
      const parentKey = item.kind === "pad" ? item.key.slice(0, item.key.lastIndexOf("/pad:")) : null;
      const parent = parentKey ? byRawKey.get(parentKey) : null;
      if (part) {
        props.DNP = yesNo(!flags.populated);
        props["Exclude from BOM"] = yesNo(flags.excludeFromBom);
        props["Exclude from board"] = yesNo(flags.excludeFromBoard);
        const unit = field(item.form, "unit");
        if (unit !== undefined) props.Unit = String(unit);
        const library = item.kind === "symbol" ? field(item.form, "lib_id") : textValue(item.form[1]);
        if (library !== undefined) props["Library ID"] = String(library);
      }
      const record = { id, path: item.path, kind: item.kind, label: item.label,
        uuid: item.metadata.uuid, position: item.metadata.position, properties: props,
        saved: savedSettings(item, definitionsByPath.get(item.path), savedBudget, libraryCache),
        reference: part ? props.Reference || null : parent?.reference || null,
        parentId: parent?.id || null,
        populated: part ? flags.populated : parent ? parent.populated : null,
        populationReason: part ? flags.populationReason : parent?.populationReason || null,
        excludeFromBom: part ? flags.excludeFromBom : parent ? parent.excludeFromBom : null };
      if (part) record.association = sourceAssociation(item.form, rootUuids.get(item.path));
      objects.push(record);
      if (!byRawKey.has(item.key)) byRawKey.set(item.key, record);
    }
    const rules = new Map([["default", []]]);
    for (const variant of config.variants) {
      const selected = [];
      for (const rule of variant.parts) {
        const candidates = objects.filter((item) => PARTS.has(item.kind) &&
          (!rule.path || item.path === rule.path) &&
          (rule.uuid ? item.uuid === rule.uuid : item.reference === rule.reference));
        const label = rule.reference || rule.uuid;
        if (!candidates.length) { warnings.push(`${variant.name}: ${label} was not found${rule.path ? ` in ${rule.path}` : ""}; override skipped.`); continue; }
        const candidatePaths = new Set(candidates.map((item) => item.path));
        if (candidatePaths.size > 1) { warnings.push(`${variant.name}: ${label} exists in multiple files; specify File/Path; override skipped.`); continue; }
        if (rule.uuid && candidates.length !== 1) { warnings.push(`${variant.name}: UUID ${label} is ambiguous; override skipped.`); continue; }
        if (rule.reference) {
          const units = candidates.map((item) => item.properties.Unit || "");
          if (new Set(units).size !== units.length) {
            warnings.push(`${variant.name}: ${label} repeats within a file without distinct units; use UUID; override skipped.`);
            continue;
          }
        }
        selected.push({ ids: candidates.map((item) => item.id), populated: rule.populated, properties: rule.properties });
      }
      rules.set(variant.id, selected);
    }
    const model = { sheets, objects, variants: [{ id: "default", name: "Saved design" },
      ...config.variants.map(({ id, name }) => ({ id, name }))], warnings };
    Object.defineProperty(model, "_rules", { value: rules });
    return model;
  }
  function applyVariant(model, variantId) {
    if (!model || !Array.isArray(model.objects)) throw new Error("Invalid design model.");
    const overlays = variantId == null ? [] : model._rules?.get(variantId);
    if (!overlays) throw new Error(`Unknown variant: ${variantId}.`);
    const records = model.objects.map((item) => ({ ...item, properties: ownProps(item.properties) }));
    const byId = new Map(records.map((item) => [item.id, item]));
    for (const overlay of overlays) for (const id of overlay.ids) {
      const record = byId.get(id);
      if (!record) continue;
      Object.assign(record.properties, overlay.properties);
      if (overlay.populated !== undefined) {
        record.populationReason = overlay.populated ? null : record.populationReason || "DNP";
        record.populated = overlay.populated;
        record.properties.DNP = yesNo(!overlay.populated);
      }
    }
    for (const record of records) if (record.kind === "pad" && record.parentId) {
      const parent = byId.get(record.parentId);
      if (parent) { record.populated = parent.populated; record.populationReason = parent.populationReason; record.excludeFromBom = parent.excludeFromBom; }
    }
    return records;
  }
  root.KiCadDesignModel = { buildProject, applyVariant, parseVariantConfig };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadDesignModel;
})(typeof globalThis === "object" ? globalThis : this);
