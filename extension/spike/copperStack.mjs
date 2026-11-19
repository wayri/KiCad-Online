/** Saved copper depths and explicit via spans; no geometry or connectivity is inferred. */
import {savedObjectId} from "./sourceIdentity.mjs";

const value = item => item && typeof item === 'object' && !Array.isArray(item) ? item.quoted : item;
const kind = node => Array.isArray(node) ? value(node[0]) : undefined;
const children = (node, name) => (Array.isArray(node) ? node : []).filter(item => kind(item) === name);
const child = (node, name) => children(node, name)[0];
const positive = number => Number.isFinite(number) && number > 0;

export function sourceCopperPlan(board = {}, ast = [], thickness = 1.6) {
  const warnings = [], viaSpans = new Map();let droppedWarnings=0;
  const warn=message=>{if(warnings.length<64)warnings.push(message);else droppedWarnings++;};
  const allNames = [...new Set((board.layers || []).filter(name => typeof name === 'string' && /^(?:F|B|In[1-9]\d*)\.Cu$/.test(name)))],names=allNames.slice(0,64);
  if(allNames.length>64)warn('Copper layer display is limited to 64 layers; additional source layers are omitted.');
  const copper = new Set(names), stack = Array.isArray(board.stackup) ? board.stackup : [];
  const depth = positive(thickness) ? thickness : 1.6;
  if (!positive(thickness)) warn('Board thickness is unavailable; copper elevation uses an estimated 1.6 mm board depth.');
  const stackCopper = stack.filter(layer => copper.has(layer.name));
  const savedThickness = new Map(stackCopper.filter(layer => positive(layer.thickness)).map(layer => [layer.name, layer.thickness]));
  const missingThickness = names.filter(name => !savedThickness.has(name));
  if (missingThickness.length) warn(`Saved copper thickness is unavailable for ${missingThickness.join(', ')}; 0.035 mm is used for display only.`);
  const isDielectric = layer => /^dielectric\b/i.test(layer.name || '') || /^(core|prepreg|dielectric)$/i.test(layer.type || '');
  const complete = names.length > 0 && stackCopper.length === names.length &&
    stackCopper.every((layer, index) => layer.name === names[index] && positive(layer.thickness)) &&
    stack.every(layer => !(copper.has(layer.name) || isDielectric(layer)) || positive(layer.thickness));
  let layers;
  if (complete) {
    let offset = 0;
    const centers = new Map();
    for (const layer of stack) {
      const size = positive(layer.thickness) ? layer.thickness : 0;
      if (copper.has(layer.name)) centers.set(layer.name, depth / 2 - offset - size / 2);
      offset += size;
    }
    // The caller's substrate depth and saved physical stack must use the same basis.
    if (Math.abs(offset - depth) > Math.max(1e-6, depth * 1e-6)) {
      warn('Saved stackup thickness differs from board depth; copper elevations are estimated uniformly.');
    } else layers = names.map(name => ({name, z: centers.get(name), thickness: savedThickness.get(name)}));
  }
  if (!layers) {
    if (!complete) warn('Complete saved stackup depths are unavailable; copper elevations are estimated uniformly across the board.');
    const first = savedThickness.get(names[0]) || .035, last = savedThickness.get(names.at(-1)) || .035;
    layers = names.map((name, index) => ({name, thickness: savedThickness.get(name) || .035,
      z: names.length < 2 ? 0 : depth / 2 - first / 2 - index / (names.length - 1) * (depth - (first + last) / 2)}));
  }
  const byLayer = new Map(layers.map(layer => [layer.name, layer]));
  const declarations = new Map(), ambiguous = new Set();
  let viaIndex = 0;
  for (const node of children(ast, 'via')) {
    // The parser counts only vias with a saved position when assigning fallback IDs.
    if ((child(node, 'at')?.length || 0) < 3) continue;
    viaIndex++;
    const id = savedObjectId(node) || `via-${viaIndex}`;
    if (declarations.has(id)) ambiguous.add(id);
    declarations.set(id, node);
  }
  for (const via of board.vias || []) {
    const node = declarations.get(via.id), layerNodes = children(node, 'layers');
    const endpoints = layerNodes.length === 1 ? layerNodes[0].slice(1).map(value) : [];
    const fail = reason => warn(`Via ${via.id}: ${reason}; span omitted.`);
    if (!node || ambiguous.has(via.id) || endpoints.length !== 2 || endpoints.some(name => typeof name !== 'string' || !byLayer.has(name)) || endpoints[0] === endpoints[1]) {
      fail('saved copper endpoint pair is absent, ambiguous or unknown'); continue;
    }
    const atoms = node.slice(1).filter(item => !Array.isArray(item)).map(value);
    const tokens = atoms.filter(atom => ['through', 'blind', 'buried', 'micro'].includes(atom));
    if (tokens.length > 1 || atoms.some(atom => !['through', 'blind', 'buried', 'micro', 'locked'].includes(atom))) {
      fail('saved via type is ambiguous or unsupported'); continue;
    }
    const indexes = endpoints.map(name => names.indexOf(name)).sort((a, b) => a - b);
    const from = names[indexes[0]], to = names[indexes[1]];
    const through = from === 'F.Cu' && to === 'B.Cu';
    const savedType = tokens[0] || 'through';
    const surfaceEnds = [from, to].filter(name => name === 'F.Cu' || name === 'B.Cu').length;
    if (savedType === 'through' && !through || savedType !== 'through' && through ||
      savedType === 'micro' && indexes[1] - indexes[0] !== 1 || savedType === 'buried' && surfaceEnds !== 0) {
      fail('saved via type does not agree with its layer endpoints'); continue;
    }
    const a = byLayer.get(from), b = byLayer.get(to);
    viaSpans.set(via.id, {zMin: Math.min(a.z, b.z), zMax: Math.max(a.z, b.z), from, to, through,
      type: savedType === 'blind' && surfaceEnds === 0 ? 'buried' : savedType});
  }
  if(droppedWarnings)warnings.push(`${droppedWarnings} additional saved-geometry diagnostics omitted.`);
  return {layers, byLayer, viaSpans, warnings};
}
