const test=require('node:test'),assert=require('node:assert/strict');
const {sheetOverviewEntries,composeSheetOverview}=require('../review-workspace.js');
const {resolve}=require('../overview-connectivity.js');
const sheets=['root.kicad_sch','channel.kicad_sch'].map(path=>({path,label:path,kind:'schematic'}));
const links=['Left','Right'].map(label=>({path:'root.kicad_sch',uuid:label,label,properties:{Sheetfile:'channel.kicad_sch'}}));
const net=(id,path,extra={})=>({id,path,kind:'schematic',name:id,primitives:[],members:[{kind:'label',position:{x:10,y:20}}],...extra});
const nets=[net('left','root.kicad_sch',{sheetPins:[{sheetId:'Left',name:'IN'}]}),net('right','root.kicad_sch',{sheetPins:[{sheetId:'Right',name:'IN'}]}),net('input','channel.kicad_sch',{hierarchicalNames:['IN']})];

test('highlight refresh reuses page geometry and source identities while changing only overlays',()=>{
 const {refreshSheetOverview}=require('../review-workspace.js'),wire={type:'line',uuid:'w',points:[{x:1,y:2},{x:3,y:4}]},entry={path:'root',label:'Root',design:{page:{width:100,height:100},primitives:[wire]},groups:[]};
 const first=composeSheetOverview([entry]),geometry=first.design,primitive=geometry.primitives.find(p=>p.uuid==='w'),routes=first.airwires;
 const next=refreshSheetOverview(first,[{...entry,groups:[{primitives:[wire]}]}]);
 assert.equal(next,first);assert.equal(next.airwires,routes);assert.equal(next.design,geometry);assert.equal(next.highlighted[0],primitive);assert.equal(primitive.sourceIndex,0);
 refreshSheetOverview(next,[entry]);assert.deepEqual(next.highlighted,[]);assert.equal(next.design,geometry);
 const changed={...entry,design:{...entry.design,primitives:[{...wire,uuid:'new'}]}};assert.notEqual(refreshSheetOverview(next,[changed]),next);
});

test('missing saved endpoint positions never become fabricated page-center net guides',()=>{
 const entries=['a','b'].map(path=>({path,label:path,design:{page:{width:100,height:100},primitives:[]},groups:[]}));
 const result=composeSheetOverview(entries,[{name:'GND',from:{path:'a',position:null},to:{path:'b',position:{x:5,y:5}}}]);
 assert.deepEqual(result.airwires,[]);assert.equal(result.routing.unresolved,1);
});
test('hierarchy placements connect only the selected repeated channel and retain the full stack identity',()=>{
 const entries=sheetOverviewEntries(sheets,links),placements=entries.flatMap(e=>e.placements),channel=entries.find(e=>e.sheet.path==='channel.kicad_sch');
 assert.equal(channel.instanceCount,2);assert.equal(new Set(channel.placements.map(p=>p.id)).size,2);
 const result=resolve(nets,['left'],placements);
 assert.deepEqual(result.matches.map(m=>m.net.id).sort(),['input','left']);
 const connected=result.matches.filter(m=>m.net.path===channel.sheet.path).map(m=>m.instanceId);
 assert.equal(connected.length,1);assert.equal(channel.placements.find(p=>p.id===connected[0]).sheetId,'Left');
 assert.equal(result.links.length,1);
});
test('clicking the front copy of a stacked sheet cannot highlight another repeated channel',()=>{
 const entries=sheetOverviewEntries(sheets,links),channel=entries.find(e=>e.sheet.path==='channel.kicad_sch');
 const right=channel.placements.find(p=>p.sheetId==='Right');
 const result=resolve(nets,[{netId:'input',instanceId:right.id}],entries.flatMap(e=>e.placements));
 assert.deepEqual(result.matches.map(m=>m.net.id).sort(),['input','right']);
 assert.equal(result.matches.some(m=>m.instanceId===channel.placements.find(p=>p.sheetId==='Left').id),false);
});
test('stacked canvas preserves front-copy picking identity and routes airwires to backing copies',()=>{
 const source={type:'line',uuid:'wire',points:[{x:1,y:2},{x:3,y:4}]};
 const entries=[{path:'root',label:'Root',design:{page:{width:100,height:100},primitives:[]},groups:[]},{path:'channel',label:'Channel',instanceCount:2,instanceId:'left',instanceLabel:'Root / Left',placements:[{id:'left'},{id:'right'}],design:{page:{width:100,height:100},primitives:[source]},groups:[]}];
 const result=composeSheetOverview(entries,[{from:{path:'root',position:{x:10,y:20}},to:{path:'channel',instanceId:'right',position:{x:10,y:20}}}]);
 const channel=result.pages[1],wire=result.design.primitives.find(p=>p.uuid==='wire');
 assert.equal(wire.sourceInstanceId,'left');assert.deepEqual(source.points,[{x:1,y:2},{x:3,y:4}]);
 assert.deepEqual(result.airwires[0].toAnchor,{x:channel.x+13,y:channel.y+23});
 assert.ok(result.airwires[0].points.length>=2,'relationship is routed through page gutters while preserving its source-instance anchor');
 assert.ok(result.design.primitives.some(p=>p.text==='Root / Left'));
});
const page=(path,placements=[])=>({path,label:path,placements,design:{page:{width:297,height:210},primitives:[]},groups:[]});

test('broad all-sheet hierarchies wrap into readable ranks with bounded titles and intact identities',()=>{
 const root=page('root',[{id:'root'}]),entries=[root,...Array.from({length:30},(_,i)=>({...page('sheets/child-'+String(i).padStart(2,'0'),[{id:'child-'+i,parentId:'root'}]),label:'SubSheets/Shared_very_long_hierarchical_sheet_name_'+i+'.kicad_sch',instanceCount:64,instanceLabel:'Root / repeated channel '+i}))];
 const result=composeSheetOverview(entries),pages=result.pages,byPath=new Map(pages.map(p=>[p.path,p]));
 assert.equal(pages.length,31);assert.ok(result.design.page.width<=7*(297+35),'wide branches use at most seven columns');
 assert.ok(new Set(pages.slice(1).map(p=>p.y)).size>1,'children wrap into several rows');
 for(const a of pages)for(const b of pages)if(a!==b)assert.ok(a.x+a.w+3<=b.x||b.x+b.w+3<=a.x||a.y+a.h+32<=b.y||b.y+b.h+32<=a.y,'paper and header gutters do not overlap');
 for(const child of pages.slice(1))assert.ok(child.y>pages[0].y,'all descendants stay below their parent');
 const titles=result.design.primitives.filter(p=>p.kind==='overview-title');assert.equal(titles.length,31);assert.ok(titles.every(p=>p.maxTextWidth===297&&p.minDisplayWidthPx>=60));assert.ok(titles[1].text.endsWith(' ×64'));assert.ok(!titles[1].text.includes('SubSheets/'));
 const reordered=composeSheetOverview([...entries].reverse());for(const p of reordered.pages)assert.deepEqual([p.x,p.y],[byPath.get(p.path).x,byPath.get(p.path).y]);
 assert.equal(pages[1].instanceCount,64);assert.equal(pages[1].path,entries[1].path);assert.equal(entries[1].label.includes('.kicad_sch'),true,'saved/source labels are not rewritten');
});
test('overview lays parents above descendants and centers branches without overlapping pages',()=>{
 const entries=[page('z-root',[{id:'root'}]),page('a-left',[{id:'left',parentId:'root'}]),page('b-right',[{id:'right',parentId:'root'}]),page('c-grandchild',[{id:'grandchild',parentId:'left'}])];
 const pages=composeSheetOverview(entries).pages,byPath=new Map(pages.map(p=>[p.path,p]));
 assert.ok(byPath.get('z-root').y<byPath.get('a-left').y);assert.ok(byPath.get('a-left').y<byPath.get('c-grandchild').y);
 assert.equal(byPath.get('a-left').y,byPath.get('b-right').y);
 assert.equal(byPath.get('z-root').x,(byPath.get('a-left').x+byPath.get('b-right').x)/2);
 for(const a of pages)for(const b of pages)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
 const reordered=composeSheetOverview([...entries].reverse()).pages;
 for(const p of reordered)assert.deepEqual([p.x,p.y],[byPath.get(p.path).x,byPath.get(p.path).y]);
});
test('shared sheets stay below every resolved parent, and malformed ancestry remains visible',()=>{
 const entries=[page('root',[{id:'root'}]),page('branch',[{id:'branch',parentId:'root'}]),page('shared',[{id:'one',parentId:'root'},{id:'two',parentId:'branch'}]),page('missing',[{id:'missing',parentId:'absent'}]),page('cycle-a',[{id:'a',parentId:'b'}]),page('cycle-b',[{id:'b',parentId:'a'}]),page('duplicate',[{id:'root'}])];
 // The duplicate invalidates only relationships involving its ambiguous identity.
 let pages=composeSheetOverview(entries.slice(0,-1)).pages;
 assert.ok(pages[2].y>pages[1].y);assert.ok(pages[1].y>pages[0].y);
 pages=composeSheetOverview(entries).pages;assert.equal(pages.length,entries.length);
 assert.ok(pages.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 assert.deepEqual(entries[2].placements,[{id:'one',parentId:'root'},{id:'two',parentId:'branch'}]);
});


test('KiCad 6 spaced sheet properties survive discovery, model preparation and instance net mapping',async()=>{
 const data=require('../browser-data.js'),diff=require('../design-diff.js'),model=require('../design-model.js');
 const child='design/FPGA_PWR&MISC.kicad_sch',root='design/Marble.kicad_sch';
 const sources=new Map([[root,'(kicad_sch (uuid root) (sheet (uuid power) (property "Sheet name" "FPGA_PWR&MISC") (property "Sheet file" "FPGA_PWR&MISC.kicad_sch")))'],[child,'(kicad_sch (uuid power-root))']]);
 const loaded=await data.loadProject('BerkeleyLab/Marble','main',root,async(_repo,_ref,path)=>sources.get(path)??null);
 assert.equal(loaded.length,2);
 const prepared=model.buildProject(loaded,null,diff.prepareProject(loaded));
 const entries=sheetOverviewEntries(prepared.sheets,prepared.objects.filter(o=>o.kind==='sheet'));
 assert.equal(entries.length,2);const placements=entries.flatMap(e=>e.placements);
 assert.equal(placements.find(p=>p.path===child).parentId,placements.find(p=>p.path===root).id);
 const parent=net('power-in',root,{sheetPins:[{sheetId:'power',name:'VCC'}]}),target=net('power-out',child,{hierarchicalNames:['VCC']});
 const result=resolve([parent,target],[parent.id],placements);
 assert.deepEqual(result.matches.map(m=>m.net.id).sort(),['power-in','power-out']);assert.equal(result.links.length,1);
});


test('mixed paper sizes pack with a fixed small gap rather than maximum-width cells',()=>{
 const entries=[80,100,300].map((width,i)=>({path:String(i),label:String(i),design:{page:{width,height:100},primitives:[]},groups:[]}));
 const result=composeSheetOverview(entries),pages=[...result.pages].sort((a,b)=>a.x-b.x);
 for(let i=1;i<pages.length;i++)assert.equal(pages[i].x-(pages[i-1].x+pages[i-1].w),24);
 assert.equal(result.design.page.width,528);assert.ok(result.design.page.height<210);
});
test('saved sheet-symbol positions order mixed-size branches and center their descendants',()=>{
 const diff=require('../design-diff.js'),model=require('../design-model.js');
 const symbol=(name,x)=>`(sheet (at ${x} 20) (uuid id-${name}) (property "Sheetname" "${name}") (property "Sheetfile" "${name}.kicad_sch"))`;
 const files=[['root',symbol('alpha',150)+symbol('zeta',20)],['alpha',''],['zeta',symbol('leaf',40)],['leaf','']].map(([name,body])=>({path:name+'.kicad_sch',content:`(kicad_sch (uuid root-${name}) ${body})`}));
 const prepared=model.buildProject(files,null,diff.prepareProject(files));
 const overview=(sheets,objects)=>composeSheetOverview(sheetOverviewEntries(sheets,objects).map(e=>({...page(e.sheet.path,e.placements),design:{page:{width:e.sheet.path==='leaf.kicad_sch'?225:100,height:120},primitives:[]}}))).pages;
 const symbols=prepared.objects.filter(o=>o.kind==='sheet'),pages=overview(prepared.sheets,symbols),byPath=new Map(pages.map(p=>[p.path,p]));
 const [root,alpha,zeta,leaf]=files.map(f=>byPath.get(f.path)),center=p=>p.x+p.w/2;
 assert.ok(zeta.x+zeta.w<alpha.x);assert.equal(center(zeta),center(leaf));
 assert.equal(center(root),(leaf.x+alpha.x+alpha.w)/2);
 for(const p of overview([...prepared.sheets].reverse(),[...symbols].reverse()))assert.deepEqual([p.x,p.y],[byPath.get(p.path).x,byPath.get(p.path).y]);
});
