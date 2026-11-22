const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Camera}=require('../owned-canvas.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≈ ${b}`);
function harness(turn,flipped){
 const listeners=new Map(),viewListeners=new Map(),calls={draw:0,finish:0},camera=new Camera(800,600);camera.center.set(3,7);camera.zoom=4;camera.quarterTurns=turn;camera.flipped=flipped;
 const node={classList:{contains:()=>false},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),setPointerCapture(){},releasePointerCapture(){},getBoundingClientRect:()=>({left:10,top:20,width:800,height:600}),dispatchEvent(){calls.click=true;}},view={addEventListener:(name,fn)=>viewListeners.set(name,fn),removeEventListener:name=>viewListeners.delete(name),canvas:node,viewport:{camera},prepareMotion(){},requestDraw(){calls.draw++;},finishMotion(){calls.finish++;}},env={module:{exports:{}},setTimeout:()=>1,clearTimeout(){},MouseEvent:class{constructor(name,init){Object.assign(this,{type:name},init);}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../touch-canvas.js'),'utf8'),env);const dispose=env.KiCadTouchCanvas.attach(view);
 const send=(name,id,x,y)=>listeners.get(name)({type:name,pointerType:'touch',pointerId:id,clientX:x,clientY:y,preventDefault(){},stopImmediatePropagation(){}});
 return{camera,calls,send,dispose,listeners,viewListeners,rotate(){camera.quarterTurns++;viewListeners.get('kicad:viewrotation')();}};
}
test('touch drag uses the inverse rotated/flipped camera and preserves the finger world anchor',()=>{
 for(const flipped of [false,true])for(let turn=0;turn<4;turn++){
  const h=harness(turn,flipped),before=h.camera.screen_to_world({x:100,y:100});h.send('pointerdown',1,110,120);h.send('pointermove',1,140,140);const after=h.camera.screen_to_world({x:130,y:120});near(after.x,before.x);near(after.y,before.y);near(h.camera.zoom,4);h.send('pointerup',1,140,140);assert.equal(h.calls.draw,2);assert.equal(h.calls.finish,0);assert.equal(h.calls.click,undefined);h.dispose();assert.equal(h.listeners.size,0);
 }
});
test('two-finger pan and pinch preserve the moving centroid through every quarter-turn and flip',()=>{
 for(const flipped of [false,true])for(let turn=0;turn<4;turn++){
  const h=harness(turn,flipped);h.send('pointerdown',1,110,120);h.send('pointerdown',2,210,120);const before=h.camera.screen_to_world({x:150,y:100});h.send('pointermove',1,90,120);h.send('pointermove',2,230,120);const after=h.camera.screen_to_world({x:150,y:100});near(after.x,before.x);near(after.y,before.y);near(h.camera.zoom,5.6);assert.equal(h.calls.draw,2);h.send('pointerup',1,90,120);h.send('pointerup',2,230,120);assert.equal(h.calls.click,undefined);h.dispose();
 }
});


test('a camera rotation cancels pending touch drag/tap state and detaches its listener',()=>{
 const h=harness(0,false);h.send('pointerdown',1,110,120);h.rotate();const center={x:h.camera.center.x,y:h.camera.center.y};h.send('pointermove',1,170,180);h.send('pointerup',1,170,180);near(h.camera.center.x,center.x);near(h.camera.center.y,center.y);assert.equal(h.calls.draw,0);assert.equal(h.calls.click,undefined);h.dispose();assert.equal(h.viewListeners.size,0);
});
