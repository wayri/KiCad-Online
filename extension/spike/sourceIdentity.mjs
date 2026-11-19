/* Native identities take precedence over drawing-local occurrence keys. */
export function savedObjectId(node) {
  for (const kind of ['uuid', 'tstamp']) {
    const raw = node.find(item => Array.isArray(item) && item[0] === kind)?.[1];
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.quoted : raw;
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
}

export function padOccurrenceId(footprintIndex, padIndex) {
  return `display-pad:${footprintIndex}:${padIndex}`;
}
