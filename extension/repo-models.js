/* Safe, source-bound KiCad footprint 3D model references for the browser viewer. */
((root) => {
  "use strict";
  const MAX_MODELS = 2048;
  const MAX_PATH = 500;
  const value = item => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kind = node => Array.isArray(node) ? String(value(node[0])) : "";
  const children = (node, type) => Array.isArray(node) ? node.filter(item => Array.isArray(item) && kind(item) === type) : [];
  const child = (node, type) => children(node, type)[0];
  const scalar = (node, type) => value(child(node, type)?.[1]);
  const number = (item, fallback) => typeof value(item) === "number" && Number.isFinite(value(item)) ? value(item) : fallback;
  const xyz = (node, name, fallback) => {
    const item = child(child(node, name), "xyz");
    return item ? [number(item[1], NaN), number(item[2], NaN), number(item[3], NaN)] : [...fallback];
  };
  const isPath = path => typeof path === "string" && path.length > 0 && path.length <= MAX_PATH &&
    !/[\\\u0000-\u001f\u007f?%]/.test(path) && !/^[a-z][a-z\d+.-]*:/i.test(path) && !path.startsWith("/");

  function resolveModelPath(boardPath, modelPath) {
    // KiCad projects authored on Windows can save relative model separators as
    // backslashes. Normalize only the reference; drive, UNC and URL paths remain
    // forbidden, and traversal is still constrained to the repository root.
    if (typeof modelPath === "string") modelPath = modelPath.replace(/\\/g, "/");
    if (!isPath(boardPath) || !/\.kicad_pcb$/i.test(boardPath) || !isPath(modelPath)) return null;
    const boardParts = boardPath.split("/");
    if (boardParts.some(part => !part || part === "." || part === "..")) return null;
    const relative = modelPath.replace(/^(?:\$\{KIPRJMOD\}|\$\(KIPRJMOD\))\//, "");
    if (relative.includes("$(") || relative.includes("${") || relative.includes("}")) return null;
    const parts = boardParts.slice(0, -1);
    for (const part of relative.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else parts.push(part);
    }
    const resolved = parts.join("/");
    return resolved.length <= MAX_PATH && isPath(resolved) ? resolved : null;
  }

  // Discovery can finish after the viewer opens. Keep only the forms needed
  // to resolve model paths so the complete PCB tree can be reclaimed.
  function modelSource(ast) {
    if (kind(ast) !== "kicad_pcb") throw new Error("Expected a saved KiCad PCB.");
    const fields = new Set(["at", "layer", "uuid", "model", "embedded_files"]);
    const projected = ["kicad_pcb"];
    for (const node of ast) {
      if (kind(node) === "embedded_files") projected.push(node);
      if (kind(node) !== "footprint") continue;
      const footprint = ["footprint"];
      projected.push(footprint); // Preserve fallback reference numbering.
      if (!node.some(field => kind(field) === "model")) continue;
      for (const field of node) {
        const type = kind(field);
        if (fields.has(type)) footprint.push(field);
        else if ((type === "property" && value(field[1]) === "Reference") ||
                 (type === "fp_text" && value(field[1]) === "reference")) footprint.push(field.slice(0, 3));
      }
    }
    return projected;
  }

  function collect(source, boardPath, parser = root.KiCadDesignDiff?.parse, assetPaths = []) {
    if (typeof parser !== "function") throw new Error("KiCad S-expression parser is unavailable.");
    return collectParsed(parser(source), boardPath, assetPaths);
  }

  function collectParsed(ast, boardPath, assetPaths = []) {
    if (kind(ast) !== "kicad_pcb") throw new Error("Expected a saved KiCad PCB.");
    const models = [], diagnostics = [];
    const warn = message => { if (diagnostics.length < 48) diagnostics.push(message); };
    const available = Array.isArray(assetPaths) ? assetPaths.slice(0, 2000).filter(path => isPath(path) &&
      path.split('/').every(part => part && part !== '.' && part !== '..')) : [];
    function repositoryPath(raw, ref) {
      const relative = resolveModelPath(boardPath, raw);
      // Library environment variables are local KiCad settings. Resolve them only
      // against actual imported repository files; never fetch a global library URL.
      const libraryPrefix = /^(?:\$\{(?:KICAD\d+_3DMODEL_DIR|KISYS3DMOD)\}|\$\((?:KICAD\d+_3DMODEL_DIR|KISYS3DMOD)\))[\\/]/;
      const suffix = typeof raw === 'string' && libraryPrefix.test(raw)
        ? raw.replace(libraryPrefix, '').replace(/\\/g, '/') : null;
      const target = relative || suffix;
      if (relative && (!available.length || available.includes(relative))) return relative;
      // Transports cap discovery at 2000 entries. At the cap, uniqueness cannot
      // be established across the project; keep only explicit relative requests.
      if (Array.isArray(assetPaths) && assetPaths.length >= 2000) {
        if (!relative) warn(`${ref}: model discovery is incomplete; library recovery is unavailable: ${String(raw).slice(0, 100)}`);
        return relative;
      }
      if (relative) {
        const matches = available.filter(path => path.toLowerCase() === relative.toLowerCase());
        if (matches.length === 1) { warn(`${ref}: model path casing corrected to ${matches[0]}`); return matches[0]; }
        if (matches.length > 1) { warn(`${ref}: model path casing is ambiguous: ${relative}`); return null; }
      }
      if (target && isPath(target) && target.split('/').every(part => part && part !== '.' && part !== '..')) {
        const matches = suffix ? available.filter(path => path === suffix || path.endsWith('/' + suffix)) : [];
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) { warn(`${ref}: model library path matches multiple repository files: ${suffix}`); return null; }
        if (suffix) {
          const lower = suffix.toLowerCase();
          const sameFormat = available.filter(path => path.toLowerCase() === lower || path.toLowerCase().endsWith('/' + lower));
          if (sameFormat.length === 1) { warn(`${ref}: model path casing corrected to ${sameFormat[0]}`); return sameFormat[0]; }
          if (sameFormat.length > 1) { warn(`${ref}: model path casing is ambiguous: ${suffix}`); return null; }
        }
        // KiCad repositories often ship only one of the STEP/VRML representations.
        // Accept a unique same-stem asset, never an unrelated basename or a URL.
        const stem = target.replace(/\.(?:step|stp|wrl|vrml)$/i, '');
        if (stem !== target) {
          const alternatives = available.filter(path => {
            const candidate = path.replace(/\.(?:step|stp|wrl|vrml)$/i, '');
            return candidate !== path && (candidate.toLowerCase() === stem.toLowerCase() ||
              (suffix && candidate.toLowerCase().endsWith('/' + stem.toLowerCase())));
          });
          if (alternatives.length === 1) { warn(`${ref}: using repository model alternative ${alternatives[0]} for ${raw}`); return alternatives[0]; }
          if (alternatives.length > 1) { warn(`${ref}: model alternatives are ambiguous: ${target}`); return null; }
        }
      }
      if (relative) return relative; // Inventory may be truncated; allow the explicit safe path.
      if (!suffix || !isPath(suffix) || suffix.split('/').some(part => !part || part === '.' || part === '..')) return null;
      warn(`${ref}: library model is not included in this project: ${suffix}. Include the model files with the project to load them offline or in the browser.`);
      return null;
    }
    function embeddedFiles(node) {
      const files = new Map();
      for (const form of children(child(node, 'embedded_files'), 'file')) {
        const name = scalar(form, 'name');
        if (!isPath(name) || name.split('/').some(part => !part || part === '.' || part === '..')) continue;
        if (files.has(name)) { files.set(name, null); warn(`Duplicate embedded model name: ${name}`); continue; }
        files.set(name, form);
      }
      return files;
    }
    const boardEmbedded = embeddedFiles(ast), embeddedPayloads = new WeakMap();
    function embeddedPayload(form) {
      if (!form) return null;
      if (embeddedPayloads.has(form)) return embeddedPayloads.get(form);
      const data = child(form, 'data');
      let length = 0;
      for (let i = 1; i < (data?.length || 0) && length <= 11200002; i++) length += String(value(data[i])).length;
      const encoded = length && length <= 11200002 ? data.slice(1).map(value).join('') : '';
      const payload = encoded.startsWith('|') && encoded.endsWith('|')
        ? {base64:encoded.slice(1,-1),checksum:String(scalar(form,'checksum')||'')}
        : null;
      embeddedPayloads.set(form,payload);
      return payload;
    }
    for (const [footprintIndex, footprint] of children(ast, "footprint").entries()) {
      const modelForms = children(footprint, "model");
      if (!modelForms.length) continue;
      const reference = children(footprint, "property").find(item => value(item[1]) === "Reference");
      const legacyReference = children(footprint, "fp_text").find(item => value(item[1]) === "reference");
      const ref = String(value(reference?.[2]) || value(legacyReference?.[2]) || `REF${footprintIndex + 1}`);
      const id = scalar(footprint, "uuid") || `component-${ref}`;
      const at = child(footprint, "at"), x = number(at?.[1], NaN), y = number(at?.[2], NaN);
      const angle = number(at?.[3], 0), layer = String(scalar(footprint, "layer") || "F.Cu");
      if (![x, y, angle].every(Number.isFinite) || !["F.Cu", "B.Cu"].includes(layer)) {
        warn(`${ref}: footprint placement or side is unsupported.`); continue;
      }
      let footprintEmbedded;
      for (const entry of modelForms) {
        if (models.length >= MAX_MODELS) { warn(`Only the first ${MAX_MODELS} footprint model references are loaded.`); return { models, diagnostics }; }
        const rawPath = value(entry[1]);
        const embeddedName = typeof rawPath === 'string' && rawPath.startsWith('kicad-embed://') ? rawPath.slice(14) : null;
        if (embeddedName !== null) footprintEmbedded ??= embeddedFiles(footprint);
        const embeddedAsset = embeddedName !== null ? embeddedPayload(footprintEmbedded.has(embeddedName) ? footprintEmbedded.get(embeddedName) : boardEmbedded.get(embeddedName)) : null;
        if (embeddedName !== null && !embeddedAsset) { warn(`${ref}: embedded model is missing or ambiguous: ${embeddedName}`); continue; }
        const path = embeddedName !== null ? rawPath : repositoryPath(rawPath, ref);
        if (!path) { warn(`${ref}: model path is not a repository-relative file: ${String(rawPath).slice(0, 100)}`); continue; }
        const extension = /\.([a-z\d]+)$/i.exec(path)?.[1]?.toLowerCase();
        if (!["wrl", "vrml", "glb", "step", "stp"].includes(extension)) {
          warn(`${ref}: ${extension === "step" || extension === "stp" ? "STEP" : "model format"} is not supported in the browser: ${path}`);
          continue;
        }
        const hidden = child(entry, "hide");
        if (hidden && value(hidden[1]) !== "no" && value(hidden[1]) !== false) continue;
        const offset = xyz(entry, "offset", [0, 0, 0]);
        const scale = xyz(entry, "scale", [1, 1, 1]);
        const rotate = xyz(entry, "rotate", [0, 0, 0]);
        if (offset.some(v => !Number.isFinite(v) || Math.abs(v) > 10000) ||
            scale.some(v => !Number.isFinite(v) || v <= 0 || v > 1000) ||
            rotate.some(v => !Number.isFinite(v) || Math.abs(v) > 3600)) {
          warn(`${ref}: model transform is invalid: ${path}`); continue;
        }
        models.push({ path, format: extension, footprintId: String(id), reference: ref,
          footprint: { x, y, angle, layer }, offset, scale, rotate,
          ...(embeddedAsset ? {embeddedAsset, assetKey: `embedded:${footprintEmbedded.has(embeddedName) ? footprintIndex : 'board'}:${embeddedName}`} : {}) });
      }
    }
    return { models, diagnostics };
  }
  function modelPose(entry, centerX, centerY, thickness) {
    const back = entry.footprint.layer === "B.Cu";
    const angle = entry.footprint.angle * Math.PI / 180;
    const [offsetX, offsetY, offsetZ] = entry.offset;
    const localY = back ? -offsetY : offsetY;
    const unitScale = ["glb","step","stp"].includes(entry.format) ? 1 : 2.54;
    return {
      position: [entry.footprint.x - centerX + offsetX * Math.cos(angle) - localY * Math.sin(angle),
        centerY - entry.footprint.y + offsetX * Math.sin(angle) + localY * Math.cos(angle),
        (back ? -1 : 1) * (thickness / 2 + offsetZ)],
      footprintAngle: angle,
      modelRotation: [(back ? 180 : 0) - entry.rotate[0], (back ? 1 : -1) * entry.rotate[1],
        (back ? 1 : -1) * entry.rotate[2]].map(degrees => degrees * Math.PI / 180),
      scale: entry.scale.map(axis => axis * unitScale)
    };
  }
  root.KiCadRepoModels = { collect, collectParsed, modelSource, resolveModelPath, modelPose };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadRepoModels;
})(typeof globalThis === "object" ? globalThis : this);
