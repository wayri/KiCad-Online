export function selectionNetNames(selection = {}, board = {}) {
  const nets = new Set(Array.isArray(selection.netNames) ? selection.netNames.filter(value => typeof value === 'string' && value) : []);
  for (const code of Array.isArray(selection.netCodes) ? selection.netCodes : []) {
    if (code === 0 || code === '0' || code == null || code === '') continue;
    const name = board.nets?.[String(code)];
    if (name) nets.add(name);
    else if (typeof code === 'string' && !/^\d+$/.test(code)) nets.add(code);
  }
  return nets;
}

/** Match saved geometry identities without treating net zero as a connected net. */
export function selectionMatcher(selection = {}, board = {}) {
  const strings = values => new Set(Array.isArray(values) ? values.filter(v => typeof v === 'string' && v) : []);
  const references = strings(selection.references), uuids = strings(selection.uuids);
  const nets = selectionNetNames(selection, board);
  // A selected net includes the bodies of parts whose saved pads belong to it.
  const connectedParts = new Set();
  for (const pad of board.pads || []) if (nets.has(pad.net) && pad.ref) connectedParts.add(pad.ref);
  return record => Boolean(record && (
    references.has(record.ref) || nets.has(record.net) || uuids.has(record.uuid) ||
    uuids.has(record.id) || (typeof record.id === 'string' && uuids.has(record.id.split(':')[0])) ||
    (connectedParts.has(record.ref) && (record.type === 'Component' || typeof record.library === 'string'))
  ));
}

/** Pinching or dragging must never become a tap when the final finger lifts. */
export function tapGesture(limit = 6) {
  const pointers = new Map(); let blocked = false;
  return {
    down(event) { if (!pointers.size) blocked = false; pointers.set(event.pointerId, [event.clientX, event.clientY]); if (pointers.size > 1) blocked = true; },
    move(event) { const start = pointers.get(event.pointerId); if (start && Math.hypot(event.clientX-start[0], event.clientY-start[1]) >= limit) blocked = true; },
    up(event) { const start = pointers.get(event.pointerId); const tap = Boolean(start && !blocked && pointers.size === 1 && Math.hypot(event.clientX-start[0], event.clientY-start[1]) < limit); pointers.delete(event.pointerId); return tap; },
    cancel(event) { pointers.delete(event.pointerId); blocked = true; }
  };
}

/** Native contextmenu can arrive before right-drag movement. Pick only on release. */
export function selectionGesture({onPick,onContextMenu,isHeld=()=>false},limit=6){
  const tap=tapGesture(limit);
  return {
    down:event=>tap.down(event),move:event=>tap.move(event),cancel:event=>tap.cancel(event),
    up(event,{select=true}={}){const tapped=tap.up(event);if(select&&tapped&&!isHeld()){if(event.button===0)onPick(event);else if(event.button===2)onContextMenu(event);}return tapped;},
    context(event){event.preventDefault?.();if(event.button!==2&&!isHeld())onContextMenu(event);}
  };
}

/** Long press is exclusive with orbit, pinch and tap, including cancelled touches. */
export function holdGesture(open, { later = setTimeout, clear = clearTimeout, delay = 550, limit = 8 } = {}) {
  const pointers = new Set(); let timer = null, start = null, held = false;
  const stop = () => { if (timer !== null) clear(timer); timer = null; };
  return {
    down(event) {
      if (!pointers.size) held = false;
      pointers.add(event.pointerId); stop();
      if (event.pointerType !== 'touch' || pointers.size !== 1) return;
      start = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      timer = later(() => { timer = null; held = true; open(start); }, delay);
    },
    move(event) { if (start?.pointerId === event.pointerId && Math.hypot(event.clientX-start.clientX,event.clientY-start.clientY) >= limit) stop(); },
    up(event) { stop(); pointers.delete(event.pointerId); return held; },
    isHeld() { return held; },
    dispose() { stop(); pointers.clear(); start = null; }
  };
}

/** Picking modes never replace a saved terminal with its component body. */
export function selectableRecord(record, mode = 'all') {
  if (!record) return false;
  const terminal = record.type === 'Pad' || (typeof record.ref === 'string' && typeof record.name === 'string' && Array.isArray(record.at) && Number.isFinite(record.width) && Number.isFinite(record.height));
  if (mode === 'pin') return terminal;
  if (mode === 'object') return terminal || !(record.type === 'Component' || typeof record.library === 'string');
  if (mode === 'part') return !terminal && (record.type === 'Component' || typeof record.library === 'string');
  if (mode === 'net') return typeof record.net === 'string' && Boolean(record.net);
  return true;
}
