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

test('large repeated-sheet assemblies collate 1024 saved occurrences without duplicating navigator cards',()=>{
 const placements=Array.from({length:1024},(_,i)=>link('root.kicad_sch','channel.kicad_sch','channel-'+i,'Channel '+i));
 const entries=sheetOverviewEntries(['root.kicad_sch','channel.kicad_sch'].map(path=>({path,label:path,kind:'schematic'})),placements);
 const mini=composeSheetOverview(entries.filter(e=>e.sheet).map(e=>({path:e.sheet.path,label:e.sheet.label,placements:e.placements,instanceCount:e.instanceCount,design:{page:{width:192,height:64},primitives:[],layers:[]},groups:[]})),[],false,{wrapWide:false});
 assert.equal(mini.pages.length,2);assert.equal(mini.pages.find(p=>p.path==='channel.kicad_sch').instanceCount,1024);
 const graph=build(mini.pages,{headingGap:0});assert.equal(graph.links.length,1);assert.equal(graph.links[0].count,1024);assert.equal(graph.links[0].childIds.length,1024);assert.equal(new Set(graph.links[0].childIds).size,1024);assert.equal(graph.omitted,0);assert.equal(graph.unresolved,0);assert.ok(graph.links[0].tree);
});

test('net curves retain exact endpoints with bounded arches and stable readable colours',()=>{
 const {netCurve,netColor}=require('../sheet-hierarchy-links.js');
 for(const to of [{x:300,y:80},{x:-300,y:80},{x:40,y:300},{x:40,y:-300}]){const from={x:0,y:0},curve=netCurve(from,to);assert.equal(curve.a,from);assert.equal(curve.d,to);assert.ok([curve.b.x,curve.b.y,curve.c.x,curve.c.y].every(Number.isFinite));const mid={x:(curve.a.x+3*curve.b.x+3*curve.c.x+curve.d.x)/8,y:(curve.a.y+3*curve.b.y+3*curve.c.y+curve.d.y)/8},length=Math.hypot(to.x,to.y),arch=Math.abs(to.x*mid.y-to.y*mid.x)/length;assert.ok(arch>=9&&arch<=48.000001,'curve forms a bounded arch away from its chord');}
 assert.equal(netColor('ST09_OUT'),netColor('ST09_OUT'));assert.notEqual(netColor('ST09_OUT'),netColor('ST01_OUT'));assert.match(netColor('VCC',false),/^#[0-9a-f]{6}$/i);
});

test('net guides reach exact endpoints continuously with dots and one label per net',()=>{
 const moves=[],ends=[],curves=[],dots=[],labels=[],dashes=[],ctx={globalAlpha:1,save(){},restore(){},beginPath(){},moveTo(x,y){moves.push([x,y]);},lineTo(x,y){ends.push([x,y]);},quadraticCurveTo(){},bezierCurveTo(...points){curves.push(points);},setLineDash(value){dashes.push(value);},stroke(){},arc(x,y){dots.push([x,y]);},fill(){},measureText(){return{width:30};},fillRect(){},fillText(text){labels.push(text);}};
 const edge={name:'VCC',points:[{x:3,y:4},{x:-10,y:4},{x:-10,y:80},{x:100,y:80},{x:105,y:100}],exteriorPoints:[{x:-10,y:4},{x:-10,y:80},{x:100,y:80}]};
 require('../sheet-hierarchy-links.js').draw({ctx,viewport:{camera:{world_to_screen:p=>p}}},{links:[edge,edge]},true,{kind:'net'});
 assert.deepEqual(moves[0],[3,4]);assert.deepEqual(curves[0].slice(-2),[105,100]);assert.ok(ends.length>=2,'net paths include a directional arrowhead');assert.deepEqual(dots.slice(0,2),[[3,4],[105,100]]);assert.deepEqual(labels,['VCC']);assert.ok(dashes.every(value=>value.length===0));
});

test('miniature hierarchy paths use bounded quadratic curves and reject invalid coordinates',()=>{
 const {pathData}=require('../sheet-hierarchy-links.js'),points=[{x:0,y:0},{x:0,y:40},{x:100,y:40},{x:100,y:80}];
 const path=pathData(points);assert.match(path,/^M 0 0 L 0 28 Q 0 40 12 40/);assert.match(path,/Q 100 40 100 52 L 100 80$/);assert.equal(pathData([{x:0,y:0},{x:NaN,y:1}]),'');assert.equal(pathData([points[0],points[0]]),'');
});

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

test('all-sheet guides stroke shared rails once and draw open heads only when the approach fits',()=>{
 const commands=[],strokes=[],ctx={globalAlpha:1,save(){},restore(){},beginPath(){},setLineDash(){},moveTo(x,y){commands.push(['M',x,y]);},lineTo(x,y){commands.push(['L',x,y]);},stroke(){strokes.push(this.globalAlpha);}};
 const view={ctx,viewport:{camera:{world_to_screen:p=>p}}},from={x:8,y:0},joint={x:8,y:10},links=[{points:[from,joint,{x:8,y:19}]},{points:[from,joint,{x:20,y:10},{x:20,y:12}]}];
 require('../sheet-hierarchy-links.js').drawGuides(view,{links},true,false);
 assert.deepEqual(strokes,[.8]);assert.equal(commands.filter(([op])=>op==='M').length,3);
 assert.deepEqual(commands.slice(3,6),[['M',5.24,13],['L',8,19],['L',10.76,13]]);
});

test('overview placement labels hide at far zoom and never cover pages or one another',()=>{
 const labels=[],ctx={globalAlpha:1,save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},setLineDash(){},stroke(){},closePath(){},fill(){},measureText(){return {width:60};},fillRect(){},fillText(text){labels.push(text);}};
 const camera={zoom:.1,width:800,height:600,world_to_screen:p=>p},view={ctx,viewport:{camera}},edge={from:{x:0,y:0},to:{x:200,y:200},points:[{x:0,y:0},{x:0,y:100},{x:200,y:100},{x:200,y:200}],label:'16 placements',showLabel:true};
 const draw=()=>require('../sheet-hierarchy-links.js').draw(view,{links:[edge,{...edge,label:'64 placements'}]});
 draw();assert.equal(labels.length,0,'placement metadata stays hidden at overview scale');camera.zoom=1;draw();assert.deepEqual(labels,['16 placements'],'colliding labels do not stack');
 labels.length=0;view.design={overviewPages:[{x:80,y:80,w:40,h:40}]};draw();assert.equal(labels.length,0,'labels cannot cover the page or its heading');
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


test('hierarchy crossings bridge unrelated routes without marking endpoint junctions',()=>{
 const {crossingPath}=require('../sheet-hierarchy-links.js'),vertical=[{x:50,y:0},{x:50,y:100}],horizontal=[{x:0,y:50},{x:100,y:50}];
 const path=crossingPath(vertical,[horizontal]);assert.match(path,/Q 64 50 50 57/);assert.match(path,/M 50 0/);assert.match(path,/L 50 100$/);
 assert.doesNotMatch(crossingPath(vertical,[[{x:50,y:50},{x:100,y:50}]]),/ Q /,'a real shared endpoint is not a crossing');
 assert.doesNotMatch(crossingPath(vertical,[vertical]),/ Q /,'collinear stems are not bridges');assert.equal(crossingPath([{x:NaN,y:1}],[]),'');
});

test('parent families between the same ranks receive separate routing rails',()=>{
 const roots=['a','b'].map((path,i)=>({path,x:i*200,y:0,w:100,h:80,placements:[{id:path,path,parentId:null}]}));
 const children=['c','d'].map((path,i)=>({path,x:i*200,y:200,w:100,h:80,placements:[{id:path,path,parentId:roots[i].path,label:path}]}));
 const graph=build([...roots,...children]);assert.equal(graph.links.length,2);assert.notEqual(graph.links[0].points[1].y,graph.links[1].points[1].y);assert.ok(graph.links.every(l=>l.to.y<200&&l.to.y>80));
});
