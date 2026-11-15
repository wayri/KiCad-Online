'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const focus = require('../comment-focus.js');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);

test('area projection preserves four rotated corners and uses saved point before area center',()=>{
 const area={x:2,y:3,width:4,height:6};
 assert.deepEqual(focus.projectArea(area,p=>({x:-p.y,y:p.x})),[{x:-3,y:2},{x:-3,y:6},{x:-9,y:6},{x:-9,y:2}]);
 assert.deepEqual(focus.anchorPosition({area}),{x:4,y:6});
 assert.deepEqual(focus.anchorPosition({area,position:{x:9,y:8}}),{x:9,y:8});
 for(const bad of [{...area,width:0},{...area,x:999999},{...area,height:NaN}])assert.equal(focus.projectArea(bad,p=>p),null);
 assert.equal(focus.projectArea(area,()=>null),null);
 assert.equal(focus.projectArea(area,p=>({...p,visible:false})),null);
});

test('area hit testing follows projected polygons and accepts their visible boundary',()=>{
 const area={x:0,y:0,width:20,height:10},project=p=>({x:100+p.x-p.y,y:50+p.x+p.y});
 assert.equal(focus.hitArea(area,project,{x:105,y:65}),true);
 assert.equal(focus.hitArea(area,project,{x:100,y:50}),true);
 assert.equal(focus.hitArea(area,project,{x:80,y:90}),false);
 assert.equal(focus.hitArea(area,()=>null,{x:105,y:65}),false);
 assert.equal(focus.hitArea(area,project,{x:NaN,y:50}),false);
});

test('comment camera centers the saved point at phone and desktop aspect ratios', () => {
  for (const [width, height] of [[360, 720], [1600, 800], [720, 360], [1, 1]]) {
    for (const pcb of [true, false]) {
      const at = {x: -12.5, y: 38}, box = focus.viewBox(at, null, {width, height, pcb});
      close(box.x + box.w / 2, at.x); close(box.y + box.h / 2, at.y);
      close(box.w / box.h, width / height);
      close(Math.min(box.w, box.h), pcb ? 8 : 20);
    }
  }
});

test('off-center object bounds fit with margin while retaining the comment center', () => {
  const at = {x: 10, y: 20}, bounds = {x: 7, y: 16, w: 30, h: 11};
  const box = focus.viewBox(at, bounds, {width: 360, height: 800, pcb: true});
  close(box.x + box.w / 2, at.x); close(box.y + box.h / 2, at.y);
  close(box.w / box.h, 360 / 800);
  assert.ok(box.x < bounds.x && box.y < bounds.y);
  assert.ok(box.x + box.w > bounds.x + bounds.w && box.y + box.h > bounds.y + bounds.h);
  assert.ok(focus.viewBox(at, {x: 10, y: 20, w: 0, h: 0}, {width: 400, height: 400, pcb: true}).w < 40);
});

test('camera input rejects invalid coordinates, dimensions and unbounded output', () => {
  const good = {width: 400, height: 800, pcb: true}, at = {x: 1, y: 2};
  for (const position of [null, {}, {x: NaN, y: 2}, {x: Infinity, y: 2}, {x: '1', y: 2}, {x: 1e7, y: 2}]) assert.equal(focus.viewBox(position, null, good), null);
  for (const bounds of [{x: 1, y: 1, w: -1, h: 2}, {x: 1, y: 1, w: 2, h: NaN}, {x: 999999, y: 1, w: 2, h: 2}, {}]) assert.equal(focus.viewBox(at, bounds, good), null);
  for (const options of [{}, null, {...good, width: 0}, {...good, height: Infinity}, {...good, width: '400'}, {...good, width: 1e7}, {...good, width: 1, height: 1e6}]) assert.equal(focus.viewBox(at, null, options), null);
});

function fixture() {
  class Node {
    constructor(tag) {this.tagName = tag; this.style = {}; this.children = []; this.attributes = {}; this.listeners = new Map(); this.clientWidth = 360; this.clientHeight = 640;}
    append(...children) {for (const child of children) {child.parent = this; this.children.push(child);}}
    remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null;}
    setAttribute(key, value) {this.attributes[key] = value;}
    addEventListener(event, handler) {if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(handler);}
    removeEventListener(event, handler) {this.listeners.get(event)?.delete(handler);}
    fire(event) {for (const handler of this.listeners.get(event) || []) handler({stopPropagation() {}});}
  }
  const host = new Node('host'), win = new Node('window');
  const document = {defaultView: win, createElement: tag => new Node(tag)};
  let pixel = {x: 40, y: 70}, returned = 0, projected;
  const controller = focus.create({host, document, project: anchor => {projected = anchor; return pixel;}, onReturn: () => returned++});
  const overlay = host.children[0], ring = overlay.children[0], chip = overlay.children[1];
  return {host, win, controller, overlay, ring, chip, setPixel: value => {pixel = value;}, projected: () => projected, returned: () => returned};
}

test('focus marker projects host pixels, keeps source text literal and reprojects after resize', () => {
  const h = fixture(), anchor = {position: {x: 2, y: 3}};
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.controller.show(anchor, '<img onerror=alert(1)>'), true);
  assert.equal(h.projected(), anchor); assert.equal(h.overlay.hidden, false);
  assert.equal(h.ring.style.left, '40px'); assert.equal(h.ring.style.top, '70px');
  assert.equal(h.chip.children[0].textContent, '<img onerror=alert(1)>');
  assert.equal(h.ring.style.pointerEvents, 'none');
  const controls = h.chip.children[1]; assert.equal(controls.children[0].style.pointerEvents, 'auto');
  assert.match(h.chip.style.maxWidth, /320px/); assert.equal(h.chip.style.display, 'grid');
  h.setPixel({x: 100, y: 120}); h.win.fire('resize');
  assert.equal(h.ring.style.left, '100px'); assert.equal(h.ring.style.top, '120px');
  h.setPixel({x: NaN, y: 0}); assert.equal(h.controller.refresh(), false); assert.equal(h.ring.hidden, true);
  h.setPixel({x: 900, y: 10}); assert.equal(h.controller.refresh(), false);
  h.setPixel({x: 70, y: 80}); assert.equal(h.controller.refresh(), true);
});

test('return and close controls hide the marker; disposal removes DOM and owned listeners', () => {
  const h = fixture(), controls = h.chip.children[1], [back, close] = controls.children;
  h.controller.show({uuid: 'a'}); back.fire('click');
  assert.equal(h.returned(), 1); assert.equal(h.overlay.hidden, true); assert.equal(h.chip.children[0].textContent, '');
  h.controller.show({uuid: 'a'}); close.fire('click');
  assert.equal(h.returned(), 1); assert.equal(h.overlay.hidden, true);
  h.controller.show({uuid: 'a'}); h.controller.hide(); assert.equal(h.controller.refresh(), false);
  h.controller.dispose(); h.controller.dispose();
  assert.equal(h.host.children.length, 0); assert.equal(h.host.style.position, '');
  for (const node of [h.host, h.win, back, close]) for (const listeners of node.listeners.values()) assert.equal(listeners.size, 0);
  assert.equal(h.controller.show({uuid: 'a'}), false);
});
