"use strict";

const KiCadCommentFocus = (() => {
  const coordinate = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;
  const point = value => value && coordinate(value.x) && coordinate(value.y);

  function areaCorners(area){
    if(!area||![area.x,area.y,area.width,area.height].every(coordinate)||area.width<=0||area.height<=0||!coordinate(area.x+area.width)||!coordinate(area.y+area.height))return null;
    return [{x:area.x,y:area.y},{x:area.x+area.width,y:area.y},{x:area.x+area.width,y:area.y+area.height},{x:area.x,y:area.y+area.height}];
  }
  function anchorPosition(anchor){
    if(point(anchor?.position))return {x:anchor.position.x,y:anchor.position.y};
    const corners=areaCorners(anchor?.area);return corners?{x:(corners[0].x+corners[2].x)/2,y:(corners[0].y+corners[2].y)/2}:null;
  }
  function projectArea(area,project){
    const corners=areaCorners(area);if(!corners||typeof project!=='function')return null;
    const pixels=corners.map(project);return pixels.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.visible!==false)?pixels:null;
  }

  function hitArea(area, project, pixel) {
    const corners=projectArea(area,project);if(!corners||!point(pixel))return false;
    let inside=false;
    for(let i=0,j=corners.length-1;i<corners.length;j=i++){
      const a=corners[i],b=corners[j],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
      const t=length?Math.max(0,Math.min(1,((pixel.x-a.x)*dx+(pixel.y-a.y)*dy)/length)):0;
      if(Math.hypot(pixel.x-a.x-t*dx,pixel.y-a.y-t*dy)<=3)return true;
      if((a.y>pixel.y)!==(b.y>pixel.y)&&pixel.x<(b.x-a.x)*(pixel.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside;
  }

  function viewBox(position, bounds, options = {}) {
    const {width, height, pcb = false} = options || {};
    if (!point(position) || !coordinate(width) || !coordinate(height) || width <= 0 || height <= 0) return null;
    const minimum = pcb ? 8 : 20;
    let spanX = minimum, spanY = minimum;
    if (bounds != null) {
      if (!point(bounds) || !coordinate(bounds.w) || !coordinate(bounds.h) || bounds.w < 0 || bounds.h < 0 ||
          !coordinate(bounds.x + bounds.w) || !coordinate(bounds.y + bounds.h)) return null;
      const contentX = 2 * Math.max(Math.abs(position.x - bounds.x), Math.abs(position.x - bounds.x - bounds.w));
      const contentY = 2 * Math.max(Math.abs(position.y - bounds.y), Math.abs(position.y - bounds.y - bounds.h));
      const margin = Math.max(pcb ? 1 : 2, Math.max(contentX, contentY) * .15);
      spanX = Math.max(minimum, contentX + margin * 2);
      spanY = Math.max(minimum, contentY + margin * 2);
    }
    const aspect = width / height;
    if (spanX / spanY < aspect) spanX = spanY * aspect;
    else spanY = spanX / aspect;
    const box = {x: position.x - spanX / 2, y: position.y - spanY / 2, w: spanX, h: spanY};
    if (![box.x, box.y, box.w, box.h, box.x + box.w, box.y + box.h].every(value => Number.isFinite(value) && Math.abs(value) <= 4e6)) return null;
    return box;
  }

  function create({host, document: doc = globalThis.document, project, onReturn} = {}) {
    if (!host?.append || !doc?.createElement || typeof project !== 'function') throw new TypeError('Comment focus needs a host, document and projector.');
    const win = doc.defaultView, listeners = [];
    let anchor = null, disposed = false;
    const previousPosition = host.style.position;
    const position = win?.getComputedStyle?.(host)?.position || previousPosition || 'static';
    const positioned = position === 'static';
    if (positioned) host.style.position = 'relative';
    const make = (tag, className, style) => {
      const node = doc.createElement(tag); node.className = className;
      Object.assign(node.style, style); return node;
    };
    const overlay = make('div', 'comment-focus-overlay', {position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '40'});
    overlay.hidden = true;
    const ring = make('div', 'comment-focus-ring', {position: 'absolute', width: '44px', height: '44px', boxSizing: 'border-box',
      border: '3px solid #ffcc47', borderRadius: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none',
      boxShadow: '0 0 0 2px #161b24, 0 0 0 7px #ffcc4740'});
    ring.setAttribute('role', 'img');
    const center = make('span', 'comment-focus-center', {position: 'absolute', left: '50%', top: '50%', width: '6px', height: '6px',
      borderRadius: '50%', background: '#ffcc47', boxShadow: '0 0 0 1px #161b24', transform: 'translate(-50%, -50%)'});
    ring.append(center);
    const chip = make('div', 'comment-focus-chip', {position: 'absolute', left: '10px', bottom: '10px', width: 'max-content',
      maxWidth: 'min(320px, calc(100% - 20px))', boxSizing: 'border-box', display: 'grid', gap: '5px', padding: '7px 9px',
      border: '1px solid #67758a', borderRadius: '7px', background: '#202735f5', color: '#f2f5fb',
      boxShadow: '0 2px 12px #0005', font: '12px/1.35 system-ui, sans-serif', pointerEvents: 'none'});
    const label = make('div', 'comment-focus-label', {minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'});
    label.setAttribute('role', 'status'); label.setAttribute('aria-live', 'polite');
    const controls = make('div', 'comment-focus-controls', {display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px'});
    const buttonStyle = {pointerEvents: 'auto', minHeight: '36px', boxSizing: 'border-box', border: '1px solid #77869b',
      borderRadius: '5px', padding: '5px 9px', background: '#303d51', color: '#fff', font: 'inherit', cursor: 'pointer'};
    const back = make('button', 'comment-focus-return', buttonStyle); back.type = 'button'; back.textContent = 'Back to comments';
    const close = make('button', 'comment-focus-close', {...buttonStyle, minWidth: '36px'}); close.type = 'button'; close.textContent = '×';
    close.title = 'Hide comment location'; close.setAttribute('aria-label', close.title);
    controls.append(back, close); chip.append(label, controls); overlay.append(ring, chip); host.append(overlay);

    function hide() {anchor = null; overlay.hidden = true; ring.hidden = true; label.textContent = '';}
    function refresh() {
      if (disposed || !anchor) return false;
      let pixel;
      try {pixel = project(anchor);} catch {pixel = null;}
      if (!point(pixel)) {ring.hidden = true; return false;}
      ring.style.left = pixel.x + 'px'; ring.style.top = pixel.y + 'px';
      const width = host.clientWidth, height = host.clientHeight;
      ring.hidden = width > 0 && (pixel.x < 0 || pixel.x > width) || height > 0 && (pixel.y < 0 || pixel.y > height);
      return !ring.hidden;
    }
    function show(value, caption = 'Comment location') {
      if (disposed || !value || typeof value !== 'object') {hide(); return false;}
      anchor = value;
      label.textContent = typeof caption === 'string' && caption.trim() ? caption.trim().slice(0, 200) : 'Comment location';
      ring.setAttribute('aria-label', label.textContent); overlay.hidden = false;
      return refresh();
    }
    const listen = (target, event, handler) => {
      if (!target?.addEventListener) return;
      target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler));
    };
    listen(back, 'click', event => {event.stopPropagation?.(); hide(); onReturn?.();});
    listen(close, 'click', event => {event.stopPropagation?.(); hide();});
    listen(win, 'resize', refresh); listen(host, 'scroll', refresh);
    const observer = typeof win?.ResizeObserver === 'function' ? new win.ResizeObserver(refresh) : null;
    observer?.observe(host);
    function dispose() {
      if (disposed) return;
      hide(); disposed = true;
      for (const remove of listeners) remove();
      observer?.disconnect(); overlay.remove();
      if (positioned && host.style.position === 'relative') host.style.position = previousPosition || '';
    }
    return {show, refresh, hide, dispose};
  }
  return {viewBox, create,areaCorners,anchorPosition,projectArea,hitArea};
})();
if (typeof globalThis === 'object') globalThis.KiCadCommentFocus = KiCadCommentFocus;
if (typeof module === 'object' && module.exports) module.exports = KiCadCommentFocus;
