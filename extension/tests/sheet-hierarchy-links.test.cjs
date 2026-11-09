const test = require('node:test');
const assert = require('node:assert/strict');
const {build} = require('../sheet-hierarchy-links.js');
const {sheetOverviewEntries, composeSheetOverview} = require('../review-workspace.js');

const design = {page: {width: 100, height: 80}, primitives: [], layers: []};
function pages(sheets, links) {
  const entries = sheetOverviewEntries(sheets.map(path => ({path, label: path, kind: 'schematic'})), links);
  return composeSheetOverview(entries.filter(e => e.sheet).map(e => ({path: e.sheet.path, label: e.sheet.label,
    placements: e.placements, instanceCount: e.instanceCount, design, groups: []}))).pages;
}
const link = (path, target, uuid, label = uuid) => ({path, uuid, label, properties: {Sheetfile: target}});

test('saved ancestry draws directional page-edge links with exact parent and child instance identities', () => {
  const graph = build(pages(['root.kicad_sch', 'child.kicad_sch', 'leaf.kicad_sch'], [
    link('root.kicad_sch', 'child.kicad_sch', 'child', 'Controller'),
    link('child.kicad_sch', 'leaf.kicad_sch', 'leaf', 'Power')]));
  assert.equal(graph.links.length, 2);
  assert.deepEqual(graph.links.map(e => [e.parentPath, e.childPath, e.label]), [
    ['root.kicad_sch', 'child.kicad_sch', 'Controller'],
    ['child.kicad_sch', 'leaf.kicad_sch', 'Power']]);
  const first = graph.links[0];
  assert.equal(first.from.x, first.to.x);
  assert.ok(first.from.y < first.to.y, 'tree connectors point from a parent down to its child');
  assert.equal(first.count, 1);
  assert.deepEqual(first.parentIds, [JSON.stringify(['root.kicad_sch'])]);
  assert.equal(first.childIds.length, 1);
  assert.equal(graph.unresolved, 0);
});

test('repeated source placements group by saved parent source and keep placement labels', () => {
  const graph = build(pages(['root.kicad_sch', 'channel.kicad_sch'], [
    link('root.kicad_sch', 'channel.kicad_sch', 'left', 'Left'),
    link('root.kicad_sch', 'channel.kicad_sch', 'right', 'Right')]));
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0].count, 2);
  assert.equal(graph.links[0].label, 'Left, Right');
  assert.equal(new Set(graph.links[0].childIds).size, 2);
});

test('unloaded, cyclic, and absent parent placements cannot become visual hierarchy links', () => {
  const onlyRoot = pages(['root.kicad_sch'], [link('root.kicad_sch', 'missing.kicad_sch', 'missing')]);
  assert.deepEqual(build(onlyRoot).links, []);
  const a = {path: 'a', x: 0, y: 0, w: 100, h: 80, placements: [{id: 'a', path: 'a', parentId: 'b', label: 'A'}]};
  const b = {path: 'b', x: 140, y: 0, w: 100, h: 80, placements: [{id: 'b', path: 'b', parentId: 'a', label: 'B'}]};
  const cyclic = build([a, b]);
  assert.deepEqual(cyclic.links, []);
  assert.equal(cyclic.unresolved, 2);
  b.placements[0].parentId = 'not-loaded';
  const absent = build([a, b]);
  assert.deepEqual(absent.links, []);
  assert.equal(absent.unresolved, 2);
});

test('visible net-filter subset cannot route a child arrow to an unrelated front copy', () => {
  const all = pages(['root.kicad_sch', 'channel.kicad_sch'], [
    link('root.kicad_sch', 'channel.kicad_sch', 'left', 'Left'),
    link('root.kicad_sch', 'channel.kicad_sch', 'right', 'Right')]);
  const filtered = structuredClone(all);
  filtered[1].placements = filtered[1].placements.filter(p => p.sheetId === 'right');
  const graph = build(filtered);
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0].label, 'Right');
  assert.equal(graph.links[0].count, 1);
  assert.equal(graph.links[0].childIds.length, 1);
});

test('many instances of the same saved source link produce one bounded visual edge', () => {
  const root = {path: 'root', x: 0, y: 0, w: 100, h: 80, placements: [{id: 'root', path: 'root', parentId: null}]};
  const child = {path: 'child', x: 140, y: 0, w: 100, h: 80, placements: Array.from({length: 4095}, (_, i) =>
    ({id: `child-${i}`, path: 'child', parentId: 'root', sheetId: `s-${i}`, label: `Branch ${i}`}))};
  const graph = build([root, child]);
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0].count, 4095);
  assert.equal(graph.links[0].label, '4095 placements');
  assert.equal(graph.omitted, 0);
});


test('sibling branches share an ordered gutter rail with separate child drops and no redundant labels',()=>{
 const graph=build(pages(['root.kicad_sch','left.kicad_sch','mid.kicad_sch','right.kicad_sch'],[link('root.kicad_sch','left.kicad_sch','l'),link('root.kicad_sch','mid.kicad_sch','m'),link('root.kicad_sch','right.kicad_sch','r')]));
 assert.equal(graph.links.length,3);
 assert.ok(graph.links.every(edge=>edge.tree&&edge.showLabel===false));
 assert.equal(new Set(graph.links.map(edge=>edge.from.x+':'+edge.from.y)).size,1,'one parent stem');
 assert.equal(new Set(graph.links.map(edge=>edge.to.x)).size,3,'distinct child drops');
 assert.equal(new Set(graph.links.map(edge=>edge.points[1].y)).size,1,'shared generation rail');
 for(const edge of graph.links){assert.ok(edge.from.y<edge.points[1].y);assert.ok(edge.points[1].y<edge.to.y);}
});

test('miniature drops reach the node boundary while overview arrows leave room for sheet headings',()=>{
 const sheetPages=pages(['root.kicad_sch','child.kicad_sch'],[link('root.kicad_sch','child.kicad_sch','c')]),overview=build(sheetPages),mini=build(sheetPages,{headingGap:0}),child=sheetPages.find(page=>page.path==='child.kicad_sch');
 assert.equal(overview.links[0].to.y,child.y-16);assert.equal(mini.links[0].to.y,child.y);
});

test('hierarchy strokes remain visible when fit-to-all makes the final arrow segment short',()=>{
 let strokes=0,labels=0;const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},setLineDash(){},stroke(){strokes++;},closePath(){},fill(){},measureText(){return {width:20};},fillRect(){},fillText(){labels++;}};
 require('../sheet-hierarchy-links.js').draw({ctx,viewport:{camera:{world_to_screen:p=>({x:p.x*.1,y:p.y*.1})}}},{links:[{from:{x:0,y:0},to:{x:100,y:20},points:[{x:0,y:0},{x:0,y:10},{x:100,y:10},{x:100,y:20}],label:'Child',showLabel:false}]});
 assert.equal(strokes,2,'paper casing separates hierarchy and net crossings');assert.equal(labels,0);
});


test('net guides display saved net names, skip blank badges and retain dashed identity',()=>{
 const labels=[],strokes=[],dashes=[];const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},setLineDash(v){dashes.push(v);},stroke(){strokes.push(this.strokeStyle);},closePath(){},fill(){},measureText(){return {width:20};},fillRect(){},fillText(text){labels.push(text);}};
 const edge={from:{x:0,y:0},to:{x:100,y:100},points:[{x:0,y:0},{x:0,y:50},{x:100,y:50},{x:100,y:100}]};
 require('../sheet-hierarchy-links.js').draw({ctx,viewport:{camera:{world_to_screen:p=>p}}},{links:[{...edge,name:'VCC'},edge]},false,{dashed:true,color:'#9e7b29a0'});
 assert.deepEqual(labels,['VCC']);assert.equal(strokes.length,2);assert.ok(dashes.every(dash=>dash.length===2));
});

test('repeated source parent instances remain a single source edge with all exact child placements',()=>{
 const graph=build(pages(['root.kicad_sch','channel.kicad_sch','leaf.kicad_sch'],[link('root.kicad_sch','channel.kicad_sch','left','Left'),link('root.kicad_sch','channel.kicad_sch','right','Right'),link('channel.kicad_sch','leaf.kicad_sch','power','Power')]));
 const edge=graph.links.find(edge=>edge.parentPath==='channel.kicad_sch');assert.ok(edge.tree);assert.equal(edge.count,2);assert.equal(edge.parentIds.length,2);assert.equal(new Set(edge.childIds).size,2);assert.equal(graph.unresolved,0);
});
