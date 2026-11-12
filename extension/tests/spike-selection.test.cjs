const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../spike/selectionState.mjs');
test('individual picking can reach pads, vias and tracks behind a component body',async()=>{
 const {selectableRecord}=await helpers;assert.equal(selectableRecord({type:'Component',ref:'U1'},'object'),false);assert.equal(selectableRecord({type:'Pad',ref:'U1',name:'1'},'object'),true);assert.equal(selectableRecord({type:'Via',uuid:'v1'},'object'),true);assert.equal(selectableRecord({type:'Track',uuid:'t1'},'object'),true);
});
test('perspective fit contains the board sphere on portrait phones and tablets', async () => {
  const {sphereFitDistance} = await import('../spike/fitPolicy.mjs');
  for (const aspect of [400/700, 900/650, 1600/800]) {
    const radius = 80, distance = sphereFitDistance(radius,45,aspect);
    const angularRadius = Math.asin(radius/distance);
    assert.ok(angularRadius < 45*Math.PI/360);
    assert.ok(angularRadius < Math.atan(Math.tan(45*Math.PI/360)*aspect));
  }
  assert.ok(sphereFitDistance(80,45,400/700) > sphereFitDistance(80,45,900/650));
  assert.equal(sphereFitDistance(80,45,0),null);
});
test('3D selection resolves net codes, connected bodies, groups and UUID primitives', async () => {
  const {selectionMatcher} = await helpers;
  const board = {nets:{0:'', 1:'GND', 2:'VCC'}, pads:[{ref:'U1',net:'GND'}]};
  const match = selectionMatcher({references:['R1','R2'],uuids:['zone-id'],netCodes:[1]},board);
  assert.equal(match({ref:'R2'}),true);
  assert.equal(match({net:'GND'}),true);
  assert.equal(match({ref:'U1',library:'Device:IC'}),true);
  assert.equal(match({ref:'U1',net:'VCC',name:'2'}),false);
  assert.equal(match({id:'zone-id:3'}),true);
  assert.equal(match({net:'VCC'}),false);
  assert.equal(selectionMatcher({netCodes:[0]},board)({net:''}),false);
  assert.equal(selectionMatcher({netCodes:['VCC']},board)({net:'VCC'}),true);
  assert.equal(selectionMatcher({},board)({ref:'R1'}),false);
});
test('3D tap selection ignores pinch, drag and cancelled gestures', async () => {
  const {tapGesture} = await helpers;
  const gesture = tapGesture();
  const point = (id,x,y)=>({pointerId:id,clientX:x,clientY:y});
  gesture.down(point(1,10,10)); assert.equal(gesture.up(point(1,11,11)),true);
  gesture.down(point(1,10,10)); gesture.down(point(2,20,20));
  assert.equal(gesture.up(point(2,20,20)),false); assert.equal(gesture.up(point(1,10,10)),false);
  gesture.down(point(1,10,10)); gesture.move(point(1,30,30));
  assert.equal(gesture.up(point(1,10,10)),false);
  gesture.down(point(1,10,10)); gesture.cancel(point(1,10,10)); assert.equal(gesture.up(point(1,10,10)),false);
});

test('pin-only picking excludes component bodies and unrelated copper',async()=>{
 const {selectableRecord,selectionMatcher}=await helpers;
 const pad={type:'Pad',id:'pad',uuid:'pad',name:'1',ref:'U1',net:'GND',at:[1,2],width:1,height:2};
 assert.equal(selectableRecord(pad,'pin'),true);
 for(const record of [{type:'Board'},{type:'Component',ref:'U1',library:'IC'},{type:'Track',net:'GND'},null])assert.equal(selectableRecord(record,'pin'),false);
 assert.equal(selectableRecord(pad,'part'),false);
 const precise=selectionMatcher({uuids:['pad']},{pads:[pad]});assert.equal(precise(pad),true);assert.equal(precise({...pad,id:'other',uuid:'other',name:'2'}),false);assert.equal(precise({type:'Component',ref:'U1'}),false);
});


test('right-drag panning never picks or clears the selected 3D net, regardless of native menu timing',async()=>{
 const {selectionGesture}=await helpers;
 for(const early of [true,false]){let selected='GND',menus=0,prevented=0;const gesture=selectionGesture({onPick:()=>{selected=null;},onContextMenu:()=>{menus++;}}),point=(x,y,type)=>({pointerId:1,button:2,clientX:x,clientY:y,type,preventDefault(){prevented++;}});
 gesture.down(point(10,10,'pointerdown'));if(early)gesture.context(point(10,10,'contextmenu'));gesture.move(point(40,30,'pointermove'));gesture.up(point(40,30,'pointerup'));if(!early)gesture.context(point(40,30,'contextmenu'));
 assert.equal(selected,'GND');assert.equal(menus,0);assert.equal(prevented,1);
 }
});

test('stationary right-click opens one context menu while left clicks, cancelled drags and long-press remain distinct',async()=>{
 const {selectionGesture}=await helpers;let picks=0,menus=0,held=false;const gesture=selectionGesture({onPick:()=>picks++,onContextMenu:()=>menus++,isHeld:()=>held}),point=button=>({pointerId:1,button,clientX:10,clientY:20,preventDefault(){}});
 gesture.down(point(2));gesture.context(point(2));assert.equal(menus,0);gesture.up(point(2));gesture.context(point(2));assert.equal(menus,1);assert.equal(picks,0);
 gesture.down(point(0));gesture.up(point(0));assert.equal(picks,1);
 gesture.down(point(0));gesture.cancel(point(0));gesture.up(point(0));assert.equal(picks,1);
 held=true;gesture.down(point(0));gesture.up(point(0));assert.equal(picks,1);gesture.context(point(0));assert.equal(menus,1);
 held=false;gesture.context(point(0));assert.equal(menus,2,'keyboard context menus remain supported');
 gesture.down(point(0));gesture.up(point(0),{select:false});assert.equal(picks,1,'measurement touch release does not perform ordinary selection');
});


test('orbit drags and two-finger camera gestures retain selection through the final release',async()=>{
 const {selectionGesture}=await helpers;let selected='GND';const gesture=selectionGesture({onPick:()=>{selected=null;},onContextMenu:()=>{selected=null;}}),point=(id,x)=>({pointerId:id,button:0,clientX:x,clientY:10});
 gesture.down(point(1,10));gesture.move(point(1,30));gesture.up(point(1,30));assert.equal(selected,'GND');
 gesture.down(point(1,10));gesture.down(point(2,30));gesture.up(point(2,30));gesture.up(point(1,10));assert.equal(selected,'GND');
});
