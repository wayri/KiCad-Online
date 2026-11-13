const test=require('node:test'),assert=require('node:assert/strict');const {bounds,fitBounds,anchoredBounds}=require('../responsive-controls.js');
test('fixed controls fit a non-origin drawing region, including a short split pane',()=>{
 assert.deepEqual(fitBounds({left:400,top:10,width:300,height:400},{left:80,top:60,width:320,height:240}),{left:92,top:68,width:300,height:224});
 assert.deepEqual(fitBounds({left:-20,top:-20,width:300,height:300},{left:40,top:100,width:180,height:130}),{left:48,top:108,width:164,height:114});
});
test('selection picker anchors beside the tap and flips above/left at viewport edges',()=>{
 assert.deepEqual(anchoredBounds({width:260,height:300},{x:20,y:100},393,852),{left:32,top:112,width:260,height:300});
 assert.deepEqual(anchoredBounds({width:260,height:300},{x:380,y:800},393,852),{left:108,top:488,width:260,height:300});
 const clipped=anchoredBounds({width:260,height:400},{x:300,y:240},393,260);assert.equal(clipped.top,8);assert.equal(clipped.height,244);assert.ok(clipped.left+clipped.width<=385);
});
test('placement reads DOMRect prototype properties instead of relying on enumerable fields',()=>{
 const rect=Object.create({get width(){return 260;},get height(){return 193;}});
 assert.deepEqual(anchoredBounds(rect,{x:262,y:598},524,1136),{left:8,top:610,width:260,height:193});
});
test('phone pickers are constrained to every viewport edge',()=>{
 for(const rect of [{left:380,top:780,width:250,height:300},{left:-50,top:-20,width:250,height:300},{left:0,top:0,width:800,height:1200}]){
  const b=bounds(rect,393,852);assert.ok(b.left>=8&&b.top>=8);assert.ok(b.left+b.width<=385&&b.top+b.height<=844);
 }
});
test('keyboard-reduced and nested viewports bound menu height without losing scroll area',()=>{
 const b=bounds({left:300,top:450,width:280,height:400},393,260);assert.equal(b.height,244);assert.equal(b.top,8);assert.equal(b.left,105);
});

test('wide Android and desktop both constrain the existing transient menus',()=>{
 const {install}=require('../responsive-controls.js');
 for(const android of [true,false]){
  const menu={hidden:false,style:{},getClientRects:()=>[{}],getBoundingClientRect:()=>({left:880,top:300,width:280,height:400})};
  const host={innerWidth:915,innerHeight:412,KiCadAndroidRuntime:android,MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),addEventListener(){}};
  install({body:{},querySelectorAll:()=>[menu]},host);
  assert.equal(menu.style.left,'627px');assert.equal(menu.style.top,'8px');assert.equal(menu.style.maxHeight,'396px');assert.equal(menu.style.overflowY,'auto');assert.equal(menu.style.right,'auto');assert.equal(menu.style.bottom,'auto');
 }
});
test('desktop scan preserves an already visible menu anchor',()=>{
 const {install}=require('../responsive-controls.js'),menu={hidden:false,style:{right:'12px',bottom:'12px'},getClientRects:()=>[{}],getBoundingClientRect:()=>({left:120,top:64,width:280,height:140})},host={innerWidth:1280,innerHeight:800,MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),addEventListener(){}};
 install({body:{},querySelectorAll:()=>[menu]},host);assert.equal(menu.style.left,'120px');assert.equal(menu.style.top,'64px');assert.equal(menu.style.right,'auto');assert.equal(menu.style.bottom,'auto');assert.equal(menu.style.overflowY,'auto');
});

test('part/net disambiguation remains compact and scrollable after placement reconciliation',()=>{
 const {install}=require('../responsive-controls.js');
 for(const height of [852,260]){
  const menu={hidden:false,style:{},classList:{contains:name=>name==='touch-net-picker'},getClientRects:()=>[{}],getBoundingClientRect:()=>({left:20,top:20,width:260,height:400})};
  const host={innerWidth:393,innerHeight:height,MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),addEventListener(){}};
  const controls=install({body:{},querySelectorAll:()=>[menu]},host);
  controls.place(menu,{x:380,y:height-10});controls.scan();
  assert.equal(menu.style.maxHeight,Math.min(340,height*.6)+'px');assert.equal(menu.style.overflowY,'auto');
 }
});
