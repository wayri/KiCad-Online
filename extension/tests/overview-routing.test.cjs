const test=require('node:test'),assert=require('node:assert/strict'),{route}=require('../overview-routing.js');
test('orthogonal relationship routes stay outside drawing pages, including intervening sheets',()=>{
 const pages=[{path:'a',x:0,y:14,w:297,h:210},{path:'middle',x:332,y:14,w:297,h:210},{path:'b',x:664,y:14,w:297,h:210},{path:'lower',x:332,y:264,w:297,h:210}],before=JSON.stringify(pages),links=[{fromPath:'a',toPath:'b',name:'VCC'},{fromPath:'lower',toPath:'a',name:'GND'}],result=route(pages,links);
 assert.equal(result.omitted,0);assert.equal(result.links.length,2);assert.deepEqual(result.links.map(l=>l.name),['VCC','GND']);for(const link of result.links){assert.ok(link.points.length>=2);for(let i=1;i<link.points.length;i++){const a=link.points[i-1],b=link.points[i];assert.ok(a.x===b.x||a.y===b.y);for(const p of pages){const crosses=a.x===b.x?a.x>p.x&&a.x<p.x+p.w&&Math.max(a.y,b.y)>p.y&&Math.min(a.y,b.y)<p.y+p.h:a.y>p.y&&a.y<p.y+p.h&&Math.max(a.x,b.x)>p.x&&Math.min(a.x,b.x)<p.x+p.w;assert.equal(crosses,false);}}}assert.equal(JSON.stringify(pages),before);
});
test('missing or excessive overview relationships are omitted explicitly, never joined arbitrarily',()=>{
 const p=[{path:'a',x:0,y:0,w:10,h:10},{path:'b',x:50,y:0,w:10,h:10}];assert.equal(route(p,[{fromPath:'a',toPath:'missing'}]).omitted,1);assert.equal(route(Array.from({length:129},(_,i)=>({...p[0],path:String(i)})),[{fromPath:'0',toPath:'1'}]).omitted,1);
 const result=route(p,Array.from({length:260},()=>({fromPath:'a',toPath:'b'})));assert.equal(result.links.length,256);assert.equal(result.omitted,4);assert.ok(result.shared>0);
});

test('net routes preserve exact saved connection endpoints',()=>{
 const pages=[{path:'a',x:0,y:0,w:100,h:100},{path:'b',x:160,y:0,w:100,h:100}],fromAnchor={x:90,y:35},toAnchor={x:170,y:60};
 const result=route(pages,[{fromPath:'a',toPath:'b',fromAnchor,toAnchor,name:'POWER'}]);assert.equal(result.links.length,1);assert.deepEqual(result.links[0].points[0],fromAnchor);assert.deepEqual(result.links[0].points.at(-1),toAnchor);assert.notEqual(result.links[0].points[0],fromAnchor);
 const edge=result.links[0];assert.equal(edge.anchorStubs.length,2);assert.notDeepEqual(edge.exteriorPoints[0],fromAnchor);for(const stub of edge.anchorStubs)for(let i=1;i<stub.length;i++)assert.ok(stub[i-1].x===stub[i].x||stub[i-1].y===stub[i].y,'local endpoint stubs never cut diagonally through a sheet');
});


test('dense hierarchy fallback docks at card edges with straight arrow approaches and obstacle clearance',()=>{
 const pages=[{path:'a',x:0,y:0,w:100,h:80},{path:'blocker',x:130,y:0,w:120,h:140},{path:'b',x:280,y:30,w:100,h:80}],result=route(pages,[{parentPath:'a',childPath:'b'}]);assert.equal(result.omitted,0);const link=result.links[0],first=link.points[0],last=link.points.at(-1),before=link.points.at(-2),onEdge=(p,box)=>(p.x===box.x||p.x===box.x+box.w)&&p.y>=box.y&&p.y<=box.y+box.h||(p.y===box.y||p.y===box.y+box.h)&&p.x>=box.x&&p.x<=box.x+box.w;
 assert.ok(onEdge(first,pages[0]));assert.ok(onEdge(last,pages[2]));assert.deepEqual(link.to,last);assert.ok(before.x===last.x||before.y===last.y);assert.ok(Math.hypot(last.x-before.x,last.y-before.y)>=14);
 for(const p of link.exteriorPoints)assert.ok(!(p.x>122&&p.x<258&&p.y>-18&&p.y<148),'the routed portion stays outside the blocker clearance');
 if(last.x===pages[2].x)assert.ok(before.x<last.x);else if(last.x===pages[2].x+pages[2].w)assert.ok(before.x>last.x);else if(last.y===pages[2].y)assert.ok(before.y<last.y);else assert.ok(before.y>last.y);
});
