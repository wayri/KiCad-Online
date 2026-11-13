const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../owned-canvas.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≈ ${b}`);
test('camera round-trips mm and preserves coordinates with back-side flip',()=>{
  const c=new core.Camera(800,600);c.bbox={x:10,y:20,w:100,h:80};
  for(const flip of [false,true]){c.flipped=flip;const p={x:42,y:71};const result=c.screen_to_world(c.world_to_screen(p));near(result.x,p.x);near(result.y,p.y);}
});
test('three-point arc chooses the sweep that contains its middle point',()=>{
  const a=core.arcThrough({x:1,y:0},{x:0,y:1},{x:-1,y:0});near(a.x,0);near(a.y,0);near(a.r,1);assert.equal(a.ccw,false);
  assert.equal(core.arcThrough({x:0,y:0},{x:1,y:1},{x:2,y:2}),null);
  const p={type:'arc',start:{x:1,y:0},mid:{x:0,y:1},end:{x:-1,y:0},width:.2};
  assert.equal(core.hitPrimitive(p,{x:0,y:1},.01),true);assert.equal(core.hitPrimitive(p,{x:0,y:-1},.01),false);
});
test('picking uses shape geometry, tolerances and excludes frame and drill holes',()=>{
  const pad={type:'pad',points:[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}],fill:true};
  assert.equal(core.hitPrimitive(pad,{x:1,y:1},0),true);assert.equal(core.hitPrimitive(pad,{x:3,y:1},.1),false);
  assert.equal(core.hitPrimitive({...pad,frame:true},{x:1,y:1},0),false);assert.equal(core.hitPrimitive({...pad,hole:true},{x:1,y:1},0),false);
  assert.equal(core.hitPrimitive({type:'line',points:[{x:0,y:0},{x:10,y:0}],width:1},{x:5,y:.6},.2),true);
});
test('fit bounds exclude worksheet and include physical track width',()=>{
 const b=core.bounds([{type:'line',points:[{x:10,y:20},{x:30,y:20}],width:2},{type:'line',points:[{x:0,y:0},{x:297,y:210}],frame:true}]);assert.deepEqual(b,{x:9,y:19,w:22,h:2});
});
test('cubic graphics use their actual curve for drawing and picking, including outside the worksheet',()=>{
 const curve={type:'bezier',kind:'bezier',uuid:'curve',points:[{x:400,y:0},{x:400,y:10},{x:410,y:10},{x:410,y:0}],width:.15};
 assert.equal(core.hitPrimitive(curve,{x:405,y:7.5},.02),true);assert.equal(core.hitPrimitive(curve,{x:405,y:10},.02),false);assert.equal(core.hitPrimitive({...curve,fill:true},{x:405,y:3},.02),true);
 const {canvas,operations}=runtime();canvas.setDocument({primitives:[curve],layers:[]},'drawing');canvas.viewport.camera.bbox={x:398,y:-2,w:14,h:14};operations.length=0;canvas.draw();assert.ok(operations.some(row=>row[0]==='bezierCurveTo'));canvas.dispose();
});
test('embedded PNGs decode once, use saved world geometry and release pending loads on source replacement',()=>{
 const decoded=[];class Image{constructor(){decoded.push(this);}set src(value){this.source=value;}get src(){return this.source;}}
 const {canvas,operations}=runtime(1,{Image}),png={type:'image',uuid:'png',pixelWidth:2,pixelHeight:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAA==',points:[{x:400,y:10},{x:420,y:10},{x:420,y:20},{x:400,y:20}]};
 canvas.primitives=[png];canvas.viewport.camera.bbox={x:395,y:5,w:30,h:20};canvas.draw();assert.equal(decoded.length,1);assert.equal(decoded[0].decoding,'async');decoded[0].naturalWidth=2;decoded[0].naturalHeight=1;decoded[0].onload();operations.length=0;canvas.draw();assert.ok(operations.some(row=>row[0]==='drawImage'));assert.equal(decoded.length,1);assert.equal(canvas.query({x:410,y:15})[0],png);
 const unsafe={...png,dataUrl:'https://example.com/private.png'};canvas.imageResource(unsafe);assert.equal(decoded.length,1);canvas.primitives=[];assert.equal(decoded[0].onload,null);assert.equal(decoded[0].src,'');canvas.dispose();
});
test('outline rectangles do not capture their interior while filled pads and component bodies remain selectable',()=>{
 const outline={type:'polygon',kind:'rectangle',uuid:'outline',points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],width:.15};
 assert.equal(core.hitPrimitive(outline,{x:10,y:10},.1),false);assert.equal(core.hitPrimitive(outline,{x:0,y:10},.1),true);
 assert.equal(core.hitPrimitive({...outline,kind:'symbol'},{x:10,y:10},.1),true);
 const {canvas}=runtime();canvas.primitives=[outline,{type:'circle',kind:'via',uuid:'via',x:10,y:10,r:.4,fill:true}];canvas.viewport.camera.zoom=20;
 assert.deepEqual(Array.from(canvas.query({x:10,y:10}),p=>p.uuid),['via']);canvas.dispose();
});
test('filled background drawings remain behind enclosed wires when picking',()=>{
 const {canvas}=runtime(),background={type:'polygon',kind:'rectangle',fill:true,uuid:'background',points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]},wire={type:'line',kind:'wire',uuid:'wire',points:[{x:5,y:10},{x:15,y:10}],width:.15};canvas.primitives=[background,wire];canvas.viewport.camera.zoom=20;assert.equal(canvas.query({x:10,y:10})[0],wire);canvas.dispose();
});
test('smart picking ranks actual screen-space proximity before nearby pad priority or source order',()=>{
 const {canvas}=runtime(),wire={type:'line',kind:'wire',uuid:'wire',points:[{x:-2,y:0},{x:2,y:0}],width:.1},pad={type:'circle',kind:'pad',uuid:'pad',x:0,y:.4,r:.1,fill:true};canvas.viewport.camera.zoom=10;canvas.primitives=[pad,wire];
 assert.equal(canvas.query({x:0,y:0})[0],wire);assert.equal(canvas.query({x:0,y:.4})[0],pad);
 const near={...pad,uuid:'near',x:.1,y:0},far={...pad,uuid:'far',x:.4,y:0};canvas.primitives=[far,near];assert.equal(canvas.query({x:0,y:0})[0],near);assert.ok(canvas.pickDistance(far,{x:0,y:0})>canvas.pickDistance(near,{x:0,y:0}));canvas.dispose();
});
test('all saved layers start visible and layer focus cannot dim selected net members on other layers',()=>{
 const {canvas}=runtime(),layers=['F.Cu','In1.Cu','B.Cu','F.SilkS','F.Fab','Edge.Cuts'];
 const members=layers.slice(0,3).map((layer,i)=>({type:'circle',kind:'track',uuid:layer,x:i*3,y:0,r:.5,layer,opacity:.2}));
 canvas.setDocument({primitives:members,layers},'board.kicad_pcb');assert.deepEqual([...canvas.visibleLayers],layers);canvas.focusLayer('F.Cu');canvas.setNetHighlights([{primitives:members}],{selectionColor:'layer',mode:'dim'});
 const painted=[];canvas.paint=(p,style)=>painted.push({p,style});canvas.draw();assert.equal(painted.length,3);for(const row of painted)assert.equal(row.style.opacity,1);canvas.dispose();
});
test('text culling uses rendered metrics, keeps crossing and rotated labels, and caches measurements by zoom and flip',()=>{
 const {canvas}=runtime();let measurements=0;
 canvas.ctx.measureText=()=>{measurements++;return {actualBoundingBoxLeft:80,actualBoundingBoxRight:80,actualBoundingBoxAscent:10,actualBoundingBoxDescent:10};};
 canvas.viewport.camera.zoom=10;
 const view={x:0,y:0,w:10,h:10},outside={type:'text',x:100,y:100,text:'outside'},crossing={type:'text',x:15,y:5,text:'crossing'},rotated={type:'text',x:5,y:15,text:'rotated',angle:90};
 assert.equal(canvas.inView(outside,view),false);assert.equal(canvas.inView(crossing,view),true);assert.equal(canvas.inView(rotated,view),true);
 canvas.inView(outside,view);assert.equal(measurements,3);
 canvas.viewport.camera.zoom=20;assert.equal(canvas.inView(crossing,view),false);assert.equal(measurements,4);
 canvas.viewport.camera.flipped=true;canvas.inView(crossing,view);assert.equal(measurements,5);
 assert.equal(crossing.text,'crossing');canvas.dispose();
});
test('multiline text and minimum pixel font remain visible, with safe fallback for missing metrics',()=>{
 const {canvas}=runtime();canvas.viewport.camera.zoom=1;
 canvas.ctx.measureText=()=>({actualBoundingBoxLeft:100,actualBoundingBoxRight:0,actualBoundingBoxAscent:8,actualBoundingBoxDescent:8});
 const p={type:'text',x:80,y:20,text:'A\nB',size:20,minPixelSize:40,fontWidth:40};
 assert.equal(canvas.inView(p,{x:0,y:0,w:10,h:10}),true);
 canvas.primitives=[p];canvas.ctx.measureText=()=>({width:10});assert.equal(canvas.inView(p,{x:1000,y:1000,w:1,h:1}),true);
 canvas.dispose();
});
test('measured label culling reduces paint work without changing layer, net, source or picking state',()=>{
 const {canvas}=runtime();canvas.ctx.measureText=()=>({actualBoundingBoxLeft:20,actualBoundingBoxRight:20,actualBoundingBoxAscent:10,actualBoundingBoxDescent:10});
 const visible={type:'text',x:5,y:5,text:'R1',size:1.27,layer:'F.Cu',uuid:'r1'},outside={...visible,x:1000,uuid:'outside'},hiddenLayer={...visible,layer:'B.Cu',uuid:'back'};
 const before=JSON.stringify([visible,outside,hiddenLayer]);canvas.primitives=[visible,outside,hiddenLayer];canvas.visibleLayers=new Set(['F.Cu']);canvas.viewport.camera.bbox={x:0,y:0,w:10,h:10};
 const painted=[];canvas.paint=(p,style)=>painted.push({p,style});canvas.setNetHighlight({primitives:[visible]});canvas.drawGeometry();
 assert.deepEqual(painted.map(x=>x.p),[visible]);assert.equal(painted[0].style.opacity,1);assert.ok(painted[0].style.color);
 assert.equal(canvas.query({x:5,y:5})[0],visible);assert.equal(JSON.stringify([visible,outside,hiddenLayer]),before);
 canvas.viewport.camera.flipped=true;painted.length=0;canvas.drawGeometry();assert.deepEqual(painted.map(x=>x.p),[visible]);canvas.dispose();
});
function runtime(dpr=1,extra={}){
  const operations=[],listeners=new Map(),ctx=new Proxy({},{get:(obj,key)=>obj[key]||((...args)=>operations.push([key,...args])),set:(obj,key,value)=>{obj[key]=value;return true;}});
  const element={style:{},setAttribute(){},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener(){},getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),remove(){},setPointerCapture(){},hasPointerCapture:()=>false};
  const host={append(){},getBoundingClientRect:element.getBoundingClientRect};
  let created=false;const env={EventTarget,CustomEvent,document:{createElement:()=>{if(!created){created=true;return element;}return {...element,style:{}};}},devicePixelRatio:dpr,ResizeObserver:class{observe(){}disconnect(){}},module:{exports:{}},...extra};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pad-labels.js'),'utf8'),env);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../owned-canvas.js'),'utf8'),env);
  const canvas=env.KiCadOwnedCanvas.mount(host,{pcb:true,dark:true});return{canvas,ctx,element,host,operations,listeners};
}

test('saved RGBA bypasses theme remapping, background fills use the body color and dash state resets',()=>{
 const {canvas,ctx,operations}=runtime();canvas.pcb=false;const p={type:'polygon',points:[{x:0,y:0},{x:5,y:0},{x:5,y:5}],width:.2,color:'rgba(132,0,0,0.5)',sourceColor:'rgba(132,0,0,0.5)',fill:'color',fillColor:'rgba(20,80,240,0.25)',lineStyle:'dash_dot'};
 for(const dark of [false,true]){canvas.dark=dark;canvas.paint(p);assert.equal(ctx.strokeStyle,p.sourceColor);assert.equal(ctx.fillStyle,p.fillColor);assert.ok(operations.some(row=>row[0]==='setLineDash'&&row[1].length===4));}
 canvas.dark=false;canvas.paint({...p,sourceColor:undefined,color:'#840000',fill:'background',lineStyle:undefined});assert.equal(ctx.strokeStyle,'#840000');assert.equal(ctx.fillStyle,'#ffffc2');assert.equal(operations.findLast(row=>row[0]==='setLineDash')[1].length,0);canvas.paint(p,{color:'#00ffff'});assert.equal(ctx.fillStyle,'#00ffff');canvas.dispose();
});

test('hatch fills reuse bounded patterns and release them with the viewer',()=>{
 const {canvas,ctx}=runtime();ctx.createPattern=()=>({setTransform(value){assert.ok(value.a>0&&value.d>0);}});const p={type:'polygon',points:[{x:0,y:0},{x:5,y:0},{x:5,y:5}],fill:'hatch',color:'#ab1234'};
 canvas.paint(p);const first=[...canvas.hatchPatterns.values()][0];canvas.paint(p);assert.equal([...canvas.hatchPatterns.values()][0],first);for(let i=0;i<50;i++)canvas.paint({...p,color:`rgb(${i},0,0)`});assert.ok(canvas.hatchPatterns.size<=32);canvas.dispose();assert.equal(canvas.hatchPatterns.size,0);
});

test('a hidden drawing defers its initial fit and retains user zoom after hide/reveal and resize',()=>{
 const {canvas,host}=runtime();let size={width:0,height:0};host.getBoundingClientRect=()=>size;
 const design={layers:['Edge.Cuts'],primitives:[{type:'line',points:[{x:0,y:0},{x:100,y:60}],layer:'Edge.Cuts'}]};canvas.setDocument(design,'board.kicad_pcb');assert.equal(canvas.pendingFit,'board');
 size={width:900,height:600};canvas.resize();assert.equal(canvas.pendingFit,null);assert.ok(canvas.viewport.camera.zoom>1);const camera=canvas.viewport.camera;camera.zoom=18;camera.center.set(35,22);
 for(const next of [{width:0,height:0},{width:900,height:600},{width:500,height:450}]){size=next;canvas.resize();assert.equal(camera.zoom,18);assert.equal(camera.center.x,35);assert.equal(camera.center.y,22);}
 size={width:0,height:0};canvas.resize();canvas.zoom_to_page();assert.equal(canvas.pendingFit,'page');size={width:700,height:500};canvas.resize();assert.equal(canvas.pendingFit,null);assert.ok(camera.zoom>1);canvas.dispose();
});

test('object categories distinguish copper, graphics, text and drill ownership',()=>{
 for(const [primitive,category]of [
  [{kind:'pad',type:'polygon',fill:true},'pads'],[{kind:'drill',objectCategory:'pads'},'pads'],
  [{kind:'via',type:'circle',fill:true},'vias'],[{kind:'drill',objectCategory:'vias'},'vias'],
  [{kind:'track',type:'line'},'tracks'],[{kind:'arc',type:'arc'},'arcs'],
  [{kind:'fp_text',type:'text'},'texts'],[{kind:'zone',type:'polygon',fill:true},'fills'],
  [{kind:'zone-outline',type:'polygon'},'polygons'],[{kind:'gr_poly',fill:true},'regions'],
  [{kind:'gr_poly',fill:false},'polygons'],[{kind:'gr_rect',fill:true},'fills'],
  [{kind:'fp_line',type:'line'},'graphics'],[{kind:'worksheet',frame:true},null]
 ])assert.equal(core.objectCategory(primitive),category);
});
test('object filters compose with source hiding, layer flags, picking and neutral geometry without changing the camera',()=>{
 const {canvas}=runtime(),pad={type:'pad',kind:'pad',ownerUuid:'fp',uuid:'pad',layer:'F.Cu',fill:true,points:[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]},hole={...pad,kind:'drill',hole:true,objectCategory:'pads'},hit={...pad,kind:'footprint-hit',uuid:'fp',fill:false,opacity:0};
 const back={type:'text',kind:'fp_text',layer:'B.SilkS',uuid:'back',x:5,y:5,text:'back'},edge={type:'line',kind:'gr_line',layer:'Edge.Cuts',uuid:'edge',points:[{x:10,y:10},{x:20,y:10}]},sourceHidden={...pad,uuid:'hidden',hidden:true};
 const primitives=[pad,hole,hit,back,edge,sourceHidden],source=JSON.stringify(primitives);canvas.setDocument({primitives,layers:['F.Cu','B.SilkS','Edge.Cuts']},'board');
 const camera=canvas.cameraState(),painted=[];canvas.paint=p=>painted.push(p);canvas.setObjectVisibility({hiddenTypes:['pads'],side:'top'});
 assert.ok(!painted.includes(pad));assert.ok(!painted.includes(hole));assert.ok(!painted.includes(back));assert.ok(painted.includes(edge));assert.equal(canvas.query({x:1,y:1}).length,0);assert.equal(canvas.geometryVisible(sourceHidden),false);assert.equal(canvas.geometryVisible(hit),false);assert.deepEqual(canvas.cameraState(),camera);
 canvas.setObjectVisibility({side:'bottom'});assert.equal(canvas.geometryVisible(pad),false);assert.equal(canvas.geometryVisible(back),true);assert.equal(canvas.geometryVisible(edge),true);
 canvas.setObjectVisibility();assert.equal(canvas.query({x:1,y:1})[0],pad);canvas.visibleLayers.delete('F.Cu');assert.equal(canvas.query({x:1,y:1}).length,0);assert.equal(JSON.stringify(primitives),source);canvas.dispose();
});

test('zone fill and outline toggles independently control drawing and picking without changing source',()=>{
 const {canvas}=runtime();
 const polygon={type:'polygon',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],layer:'F.Cu',uuid:'z'};
 const fill={...polygon,kind:'zone',fill:true},outline={...polygon,kind:'zone-outline',fill:false,width:.15};
 const edge={type:'line',points:[{x:20,y:20},{x:30,y:20}],layer:'Edge.Cuts',uuid:'edge'};
 canvas.setDocument({primitives:[fill,outline,edge],layers:['F.Cu','Edge.Cuts']},'board');
 canvas.viewport.camera.bbox={x:-2,y:-2,w:40,h:40};
 const painted=[];canvas.paint=p=>painted.push(p);canvas.setZoneVisibility({filled:false});
 assert.ok(!painted.includes(fill));assert.ok(painted.includes(outline));assert.ok(painted.includes(edge));
 assert.ok(!canvas.query({x:5,y:5}).includes(fill));assert.ok(canvas.query({x:0,y:5}).includes(outline));
 painted.length=0;canvas.setZoneVisibility({filled:true,outlines:false});
 assert.ok(painted.includes(fill));assert.ok(!painted.includes(outline));assert.ok(canvas.query({x:5,y:5}).includes(fill));
 assert.ok(!canvas.query({x:0,y:5}).includes(outline));assert.equal(fill.fill,true);assert.equal(outline.fill,false);
 painted.length=0;canvas.setZoneVisibility({filled:false,outlines:false});assert.ok(painted.includes(edge));assert.ok(!painted.includes(fill)&&!painted.includes(outline));
 canvas.dispose();
});
test('large-board gesture previews skip repeated painting and settle back to the source camera',()=>{
 let frame,timer,painted=0,disposed=false;const {transform}=require('../motion-webgl.js');
 class Motion{constructor(){this.gl={MAX_TEXTURE_SIZE:1,getParameter:()=>4096};}upload(snapshot,saved){this.saved=saved;}show(current){return Boolean(transform(this.saved,current));}hide(){}dispose(){disposed=true;}}
 const {canvas,listeners,element}=runtime(1,{KiCadMotionWebGL:{Motion,MAX_PIXELS:16000000},requestAnimationFrame:fn=>(frame=fn,1),cancelAnimationFrame:()=>{frame=null;},setTimeout:fn=>(timer=fn,1),clearTimeout:()=>{timer=null;}});
 const primitives=Array.from({length:5000},(_,i)=>({type:'circle',x:i%100,y:Math.floor(i/100),r:.2,layer:'F.Cu'}));
 canvas.setDocument({primitives,layers:['F.Cu']},'large.kicad_pcb');canvas.paint=()=>painted++;
 listeners.get('pointerdown')({button:2,clientX:400,clientY:300,pointerId:1,preventDefault(){}});assert.ok(painted>0);painted=0;
 let frames=0;canvas.addEventListener('kicad:viewframe',()=>frames++);
 listeners.get('pointermove')({clientX:420,clientY:310});frame();assert.equal(canvas.motionActive,true);assert.equal(painted,0);assert.equal(element.style.opacity,'0');assert.equal(frames,1);
 const camera=canvas.cameraState();listeners.get('pointerup')({pointerId:1});assert.equal(canvas.motionActive,false);assert.equal(element.style.opacity,'');assert.ok(painted>0);assert.deepEqual(canvas.cameraState(),camera);
 listeners.get('wheel')({clientX:400,clientY:300,deltaY:-10,preventDefault(){}});frame();assert.equal(canvas.motionActive,true);timer();assert.equal(canvas.motionActive,false);
 listeners.get('pointerdown')({button:2,clientX:400,clientY:300,pointerId:1,preventDefault(){}});listeners.get('pointermove')({clientX:420,clientY:300});frame();assert.equal(canvas.motionActive,true);canvas.motion.onLost();assert.equal(canvas.motionActive,false);assert.equal(canvas.motionFailed,true);assert.equal(element.style.opacity,'');
 canvas.acceleration='off';assert.equal(canvas.prepareMotion(),false);canvas.dispose();assert.equal(disposed,true);assert.equal(timer,null);
});

test('WebGL initialization failure restores a visible CPU drawing',()=>{
 let frame;class Motion{constructor(){throw Error('GPU disabled');}}
 const {canvas,listeners,element}=runtime(1,{KiCadMotionWebGL:{Motion,MAX_PIXELS:16000000},requestAnimationFrame:fn=>(frame=fn,1),cancelAnimationFrame(){}});
 canvas.setDocument({primitives:Array.from({length:4096},()=>({type:'circle',x:0,y:0,r:1,layer:'F.Cu'})),layers:['F.Cu']},'board.kicad_pcb');
 listeners.get('pointerdown')({button:2,clientX:400,clientY:300,pointerId:1,preventDefault(){}});listeners.get('pointermove')({clientX:410,clientY:300});frame();
 assert.equal(canvas.motionFailed,true);assert.equal(canvas.motionActive,false);assert.equal(element.style.opacity,'');canvas.dispose();
});

test('large-board indexing preserves paint and pick results while narrowing local searches',()=>{
 const {canvas}=runtime(),primitives=[];
 for(let y=0;y<100;y++)for(let x=0;x<100;x++)primitives.push({type:'circle',x:x*10,y:y*10,r:1,width:.2,fill:true,uuid:`pad-${x}-${y}`,kind:'pad',layer:x%2?'B.Cu':'F.Cu'});
 primitives.splice(300,0,{type:'line',points:[{x:-100,y:25},{x:1100,y:25}],width:1,uuid:'crossing',layer:'F.Cu'});
 primitives.push({type:'text',text:'Unbounded label',x:2000,y:2000,uuid:'label'}, {type:'arc',start:{x:30,y:20},mid:{x:20,y:30},end:{x:10,y:20},width:.2,uuid:'arc',layer:'F.Cu'});
 canvas.setDocument({layers:['F.Cu','B.Cu'],primitives},'large.kicad_pcb');
 const view={x:10,y:10,w:40,h:40};canvas.viewport.camera.bbox=view;
 const candidates=canvas.candidates(view);assert.ok(candidates.length<100,`local search returned ${candidates.length} of ${primitives.length}`);
 assert.ok(canvas.spatialIndex.references<=1000000);
 const painted=[];canvas.paint=p=>painted.push(p);
 for(const focused of [null,'F.Cu']){
  canvas.focusedLayer=focused;canvas.layerFocusMode='isolate';painted.length=0;canvas.draw();
  const expected=primitives.filter(p=>!p.hidden&&canvas.inView(p,canvas.viewport.camera.bbox)&&(!p.layer||canvas.visibleLayers.has(p.layer))&&(!focused||p.layer===focused||p.hole||p.layer==='Edge.Cuts'));
  assert.deepEqual(painted,expected);
  for(const at of [{x:20,y:20},{x:25,y:25},{x:20,y:30},{x:2000,y:2000}]){
   const indexed=canvas.query(at);const search=canvas.candidates;canvas.candidates=()=>primitives;
   const linear=canvas.query(at);canvas.candidates=search;assert.deepEqual(Array.from(indexed),Array.from(linear));
  }
 }
});

test('primitive replacement and append rebuild the index; visibility toggles do not lose geometry',()=>{
 const {canvas}=runtime(),primitives=Array.from({length:600},(_,i)=>({type:'circle',x:i*10,y:0,r:1,fill:true,uuid:`p${i}`,hidden:i===0,layer:'F.Cu'}));
 canvas.setDocument({layers:['F.Cu'],primitives},'board.kicad_pcb');canvas.candidates({x:0,y:0,w:5,h:5});primitives[0].hidden=false;
 assert.equal(canvas.query({x:0,y:0})[0],primitives[0]);
 const added={type:'circle',x:-100,y:0,r:1,fill:true,uuid:'added',layer:'F.Cu'};primitives.push(added);assert.equal(canvas.query({x:-100,y:0})[0],added);
 canvas.primitives=primitives.map(p=>({...p,x:p.x+100}));assert.equal(canvas.query({x:0,y:0})[0].uuid,'added');
});
test('owned redraw clears the full physical buffer at fractional browser scaling',()=>{
  for(const dpr of [.5,.75,1,1.25,2]){const view=runtime(dpr);view.canvas.draw();assert.deepEqual(view.operations[0],['setTransform',1,0,0,1,0,0]);assert.deepEqual(view.operations[1],['fillRect',0,0,Math.round(800*dpr),Math.round(600*dpr)]);assert.deepEqual(view.operations[2],['setTransform',dpr,0,0,dpr,0,0]);}
});

test('multiple highlights form a union; isolate retains board outline and bright mode preserves context opacity',()=>{
 const {canvas}=runtime(),a={type:'circle',x:1,y:1,r:1,layer:'F.Cu'},b={type:'circle',x:5,y:5,r:1,layer:'F.Cu'},other={type:'circle',x:9,y:9,r:1,layer:'F.Cu'},edge={type:'line',points:[{x:0,y:0},{x:10,y:0}],layer:'Edge.Cuts'};
 canvas.setDocument({layers:['F.Cu','Edge.Cuts'],primitives:[a,b,other,edge]},'board.kicad_pcb');const painted=[];canvas.paint=(p,style)=>painted.push({p,style});
 canvas.viewport.camera.bbox={x:-3,y:-3,w:16,h:16};
 canvas.viewport.camera.bbox={x:-3,y:-3,w:16,h:16};
 canvas.setNetHighlights([{primitives:[a]},{primitives:[b]}],{mode:'isolate'});canvas.draw();assert.deepEqual(painted.map(x=>x.p),[a,b,edge]);assert.equal(canvas.netPrimitives.size,2);
 painted.length=0;canvas.setNetHighlights([{primitives:[a,b]}],{mode:'bright'});canvas.draw();assert.equal(painted.find(x=>x.p===other).style.opacity,1);assert.ok(painted.find(x=>x.p===a).style.color);
 canvas.setNetHighlights([]);assert.equal(canvas.netHighlight,null);assert.equal(canvas.netPrimitives.size,0);
});
test('viewport culling skips offscreen copper but keeps crossing geometry and text',()=>{
 const {canvas}=runtime(),inside={type:'circle',x:10,y:10,r:1,layer:'F.Cu'},outside={...inside,x:1000},crossing={type:'line',points:[{x:-100,y:10},{x:100,y:10}],layer:'F.Cu'},text={type:'text',text:'Wide label',x:1000,y:10};
 canvas.setDocument({layers:['F.Cu'],primitives:[inside,outside,crossing,text]},'board.kicad_pcb');canvas.viewport.camera.bbox={x:0,y:0,w:20,h:20};const painted=[];canvas.paint=p=>painted.push(p);canvas.draw();assert.deepEqual(painted,[inside,crossing,text]);assert.equal(canvas.inView(inside,canvas.viewport.camera.bbox),true);
});
test('viewport culling skips offscreen copper but keeps crossing geometry and text',()=>{
 const {canvas}=runtime(),inside={type:'circle',x:10,y:10,r:1,layer:'F.Cu'},outside={...inside,x:1000},crossing={type:'line',points:[{x:-100,y:10},{x:100,y:10}],layer:'F.Cu'},text={type:'text',text:'Wide label',x:1000,y:10};
 canvas.setDocument({layers:['F.Cu'],primitives:[inside,outside,crossing,text]},'board.kicad_pcb');canvas.viewport.camera.bbox={x:0,y:0,w:20,h:20};const painted=[];canvas.paint=p=>painted.push(p);canvas.draw();assert.deepEqual(painted,[inside,crossing,text]);assert.equal(canvas.inView(inside,canvas.viewport.camera.bbox),true);
});
test('pointer zoom preserves the mm point under the cursor and hidden layers cannot be picked',()=>{
  const {canvas,listeners}=runtime();canvas.setDocument({page:{width:297,height:210},layers:['F.Cu'],primitives:[{type:'circle',x:25,y:30,r:2,fill:true,uuid:'part',layer:'F.Cu'}]},'board.kicad_pcb');
  const c=canvas.viewport.camera,p={x:170,y:220},before=c.screen_to_world(p);listeners.get('wheel')({clientX:p.x,clientY:p.y,deltaY:-80,preventDefault(){}});const after=c.screen_to_world(p);near(after.x,before.x);near(after.y,before.y);
  assert.equal(canvas.query({x:25,y:30}).length,1);canvas.visibleLayers.delete('F.Cu');assert.equal(canvas.query({x:25,y:30}).length,0);
});
test('selection emits owned object identity and disposal releases observer/canvas listeners',()=>{
  const {canvas}=runtime();let item;canvas.addEventListener('kicad:select',e=>item=e.detail.item);
  canvas.select({primitive:{type:'circle',x:1,y:2,r:1},context:{uuid:'pad-1',parent:{uuid:'footprint-1'}}});assert.equal(item.uuid,'pad-1');assert.equal(item.parent.uuid,'footprint-1');canvas.dispose();
});

test('board fitting and full-sheet fitting switch the paper without fitting hidden geometry',()=>{
 const {canvas}=runtime(),edge={type:'line',points:[{x:10,y:20},{x:40,y:20}],layer:'Edge.Cuts'},frame={type:'line',points:[{x:0,y:0},{x:297,y:210}],frame:true},hidden={type:'circle',x:900,y:900,r:5,hidden:true,uuid:'hidden'};
 canvas.setDocument({page:{width:297,height:210},layers:['Edge.Cuts'],primitives:[edge,frame,hidden]},'board.kicad_pcb');
 assert.equal(canvas.paperVisible,true);assert.equal(canvas.query({x:900,y:900}).length,0);assert.ok(canvas.viewport.camera.center.x<100);
 canvas.zoom_to_page();assert.equal(canvas.paperVisible,true);near(canvas.viewport.camera.center.x,148.5);near(canvas.viewport.camera.center.y,105);
 canvas.zoom_to_board();assert.equal(canvas.paperVisible,true);near(canvas.viewport.camera.center.x,25);
});
test('net highlight respects layer visibility, dims unrelated copper and preserves drill holes',()=>{
 const {canvas}=runtime(),pad={type:'circle',x:20,y:30,r:1,uuid:'pad',layer:'F.Cu'},other={...pad,uuid:'other',x:30},back={...pad,uuid:'back',layer:'B.Cu'},hole={...pad,uuid:'hole',hole:true},hidden={...pad,uuid:'hidden',hidden:true};
 canvas.setDocument({layers:['F.Cu','B.Cu'],primitives:[pad,other,back,hole,hidden]},'board.kicad_pcb');canvas.visibleLayers.delete('B.Cu');
 const painted=[];canvas.paint=(p,style)=>painted.push({p,style});canvas.setNetHighlight({primitives:[pad,back]});canvas.draw();
 assert.deepEqual(painted.map(item=>item.p.uuid),['pad','other','hole']);assert.equal(painted[0].style.color,'#ffe18b');assert.equal(painted[1].style.opacity,.42);assert.equal(painted[1].style.color,'#87919b');assert.equal(painted[2].style.opacity,1);
 painted.length=0;canvas.setNetHighlight({primitives:[pad]},{isolate:true});canvas.draw();assert.deepEqual(painted.map(item=>item.p.uuid),['pad','hole']);
 canvas.setNetHighlight(null);painted.length=0;canvas.draw();assert.equal(painted.find(item=>item.p===other).style.opacity,1);
});

test('schematic net highlight contrasts with white paper and retains readable surrounding geometry',()=>{
 const {canvas}=runtime();canvas.pcb=false;canvas.dark=false;const pin={type:'line',points:[{x:1,y:1},{x:4,y:1}],uuid:'pin'},wire={...pin,uuid:'wire'};canvas.primitives=[pin,wire];
 const painted=[];canvas.paint=(p,style)=>painted.push(style);canvas.setNetHighlight({primitives:[pin]});canvas.draw();assert.equal(painted[0].color,'#006ca8');assert.equal(painted[1].opacity,.38);assert.equal(painted[1].color,'#737b83');
});

 test('layer focus dims context, prioritizes focused picking and isolate excludes other copper',()=>{
 const {canvas}=runtime();const f={type:'circle',x:10,y:10,r:2,fill:true,uuid:'front',layer:'F.Cu'},b={...f,uuid:'back',layer:'B.Cu'},edge={type:'line',points:[{x:0,y:0},{x:30,y:0}],layer:'Edge.Cuts'},hole={...f,uuid:'hole',hole:true};
 canvas.setDocument({layers:['F.Cu','B.Cu','Edge.Cuts'],primitives:[f,b,edge,hole]},'board.kicad_pcb');const before=[...canvas.visibleLayers];
 assert.equal(canvas.focusLayer('B.Cu'),true);assert.equal(canvas.query({x:10,y:10})[0].uuid,'back');const painted=[];canvas.paint=(p,style)=>painted.push({p,style});canvas.draw();assert.equal(painted.find(x=>x.p===f).style.opacity,.18);assert.equal(painted.find(x=>x.p===b).style.opacity,1);
 canvas.focusLayer('B.Cu','isolate');painted.length=0;canvas.draw();assert.deepEqual(painted.map(x=>x.p.uuid).filter(Boolean),['back','hole']);assert.deepEqual(canvas.query({x:10,y:10}).map(x=>x.uuid),['back']);canvas.restoreLayers();assert.deepEqual([...canvas.visibleLayers],before);assert.equal(canvas.focusedLayer,null);
 });
 test('layer presets restore the original view across consecutive focus and preset changes',()=>{const {canvas}=runtime();canvas.setDocument({layers:['F.Cu','In1.Cu','B.Cu','F.SilkS','B.SilkS','Edge.Cuts'],primitives:[]},'board.kicad_pcb');const initial=[...canvas.visibleLayers];canvas.layerPreset('copper');assert.deepEqual([...canvas.visibleLayers],['F.Cu','In1.Cu','B.Cu','Edge.Cuts']);canvas.focusLayer('F.SilkS');canvas.layerPreset('back');assert.deepEqual([...canvas.visibleLayers],['B.Cu','B.SilkS','Edge.Cuts']);canvas.restoreLayers();assert.deepEqual([...canvas.visibleLayers],initial);assert.equal(canvas.layerPreset('unknown'),false);assert.equal(canvas.focusLayer('unknown'),false);canvas.layerPreset('none');assert.equal(canvas.visibleLayers.size,0);canvas.restoreLayers();assert.deepEqual([...canvas.visibleLayers],initial);});
 test('fit layer uses only its drawable geometry and ignores worksheet, hidden and other layers',()=>{const {canvas}=runtime();canvas.setDocument({layers:['F.Cu','B.Cu'],primitives:[{type:'circle',x:20,y:30,r:1,layer:'F.Cu'},{type:'circle',x:900,y:900,r:2,layer:'B.Cu'},{type:'circle',x:800,y:800,r:2,layer:'F.Cu',hidden:true}]},'board.kicad_pcb');canvas.focusLayer('F.Cu');assert.equal(canvas.fitLayer(),true);near(canvas.viewport.camera.center.x,20);near(canvas.viewport.camera.center.y,30);assert.equal(canvas.paperVisible,true);canvas.focusLayer('B.Cu');canvas.primitives=[];assert.equal(canvas.fitLayer(),false);canvas.setDocument({layers:['F.Cu'],primitives:[]},'next.kicad_pcb');assert.equal(canvas.focusedLayer,null);assert.equal(canvas.layerSnapshot,null);});

 test('ruler grid spacing coarsens at low zoom and rejects unsafe pitch values',()=>{const {canvas,operations}=runtime();canvas.grid=true;canvas.gridPitch=.25;canvas.viewport.camera.zoom=40;canvas.draw();const dots=operations.filter(op=>op[0]==='fillRect'&&op[3]===1&&op[4]===1);assert.ok(dots.length>0);assert.ok(dots.length<=20000);for(const pitch of [-1,0,Infinity,NaN]){canvas.gridPitch=pitch;assert.doesNotThrow(()=>canvas.draw());}});

test('canvas click forwards Ctrl, Shift and Command additive-selection intent',()=>{
 const {canvas,listeners}=runtime();canvas.setDocument({primitives:[],layers:['F.Cu']},'board.kicad_pcb');let detail;canvas.addEventListener('kicad:select',event=>detail=event.detail);
 for(const modifier of ['ctrlKey','shiftKey','metaKey']){listeners.get('click')({clientX:10,clientY:20,[modifier]:true});assert.equal(detail.multi,true);}
 listeners.get('click')({clientX:10,clientY:20});assert.equal(detail.multi,false);
});

test('net-class draw colors leave source primitives unchanged and yield to selection highlighting',()=>{
 const {canvas}=runtime(),p={type:'circle',x:10,y:10,r:1,layer:'F.Cu',kind:'pad',color:'#ff0000'},painted=[];canvas.setDocument({layers:['F.Cu'],primitives:[p]},'board.kicad_pcb');canvas.paint=(primitive,style)=>painted.push(style.color);canvas.netClassColors=new Map([[p,'rgba(0,150,220,1)']]);canvas.draw();assert.equal(painted.at(-1),'rgba(0,150,220,1)');assert.equal(p.color,'#ff0000');
 canvas.setNetHighlight({primitives:[p]});canvas.draw();assert.equal(painted.at(-1),'#ffe18b');canvas.setNetHighlight(null);canvas.netClassColors=new Map();canvas.draw();assert.equal(painted.at(-1),null);
});


test('touch picking radius expands in screen pixels and respects hidden and isolated layers',()=>{
 const {canvas}=runtime();const front={type:'line',kind:'track',uuid:'front',layer:'F.Cu',points:[{x:0,y:0},{x:20,y:0}],width:.1},back={...front,uuid:'back',layer:'B.Cu',points:[{x:0,y:1},{x:20,y:1}]};
 canvas.setDocument({layers:['F.Cu','B.Cu'],primitives:[front,back]},'board.kicad_pcb');canvas.viewport.camera.zoom=10;
 assert.equal(canvas.query({x:10,y:1.3}).length,1);assert.equal(canvas.query({x:10,y:1.3},14).length,2);
 canvas.visibleLayers.delete('B.Cu');assert.deepEqual(canvas.query({x:10,y:1.3},14).map(p=>p.uuid),['front']);canvas.visibleLayers.add('B.Cu');canvas.focusedLayer='B.Cu';canvas.layerFocusMode='isolate';assert.deepEqual(canvas.query({x:10,y:1.3},14).map(p=>p.uuid),['back']);canvas.dispose();
});

test('net label overlay follows hidden layers, zone visibility and isolated net selection',()=>{
 const {canvas,operations}=runtime();
 const front={kind:'track',type:'line',layer:'F.Cu',width:1,points:[{x:-10,y:0},{x:10,y:0}]};
 const back={...front,layer:'B.Cu',points:[{x:-10,y:4},{x:10,y:4}]};
 canvas.setDocument({primitives:[front,back],layers:['F.Cu','B.Cu']},'board');canvas.viewport.camera.center.set(0,0);canvas.viewport.camera.zoom=30;
 canvas.setNetNames([{name:'FRONT',primitives:[front]},{name:'BACK',primitives:[back]}]);canvas.showNetNames=true;
 const drawn=()=>operations.filter(o=>o[0]==='fillText').map(o=>o[1]);
 operations.length=0;canvas.drawNetNames();assert.deepEqual(drawn(),['FRONT','BACK']);
 operations.length=0;canvas.visibleLayers.delete('B.Cu');canvas.drawNetNames();assert.deepEqual(drawn(),['FRONT']);
 operations.length=0;canvas.visibleLayers.add('B.Cu');canvas.setNetHighlights([{primitives:[back]}],{mode:'isolate'});canvas.drawNetNames();assert.deepEqual(drawn(),['BACK']);
 operations.length=0;canvas.showNetNames=false;canvas.drawNetNames();assert.deepEqual(drawn(),[]);canvas.dispose();
});

test('close-zoom pad labels retain terminal identity and bounded readable scaling',()=>{
 const camera=new core.Camera(1200,800);camera.center={x:0,y:0};camera.zoom=50;
 const pad={kind:'pad',type:'pad',uuid:'p1',ownerUuid:'u1',layer:'F.Cu',name:'1',pinNumber:'1',pinName:'OUT',padCenter:{x:0,y:0},padWidth:2,padHeight:1,r:.5,x:0,y:0};
 const before=JSON.stringify(pad),labels=core.netLabels([[pad,'VCC'],[{...pad,layer:'B.Cu'},'VCC']],camera);
 assert.equal(labels.length,1);assert.equal(labels[0].text,'1 OUT\nVCC');assert.ok(labels[0].size>=9&&labels[0].size<=18);assert.equal(JSON.stringify(pad),before);
 camera.zoom=5;assert.equal(core.netLabels([[pad,'VCC']],camera).length,0);
 camera.zoom=1000;assert.equal(core.netLabels([[pad,'VCC']],camera)[0].size,18);
});

test('terminal-only canvas picking excludes bodies, traces and text without terminal identity',()=>{
 const {canvas}=runtime();canvas.viewport.camera.zoom=20;canvas.visibleLayers=new Set(['F.Cu']);
 const body={type:'polygon',kind:'footprint',uuid:'u1',fill:true,layer:'F.Cu',points:[{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:0,y:3}]};
 const pad={type:'pad',kind:'pad',uuid:'p1',ownerUuid:'u1',name:'1',pinNumber:'1',layer:'F.Cu',x:1,y:1,r:.3,fill:true};canvas.primitives=[body,pad];
 canvas.setSelectionMode('pin');assert.deepEqual(canvas.query({x:1,y:1}),[pad]);assert.deepEqual(canvas.query({x:2,y:2}),[]);
 canvas.setSelectionMode('all');assert.equal(canvas.query({x:2,y:2})[0],body);canvas.dispose();
});

test('label traversal stops at the cap and leaves saved pad geometry untouched',()=>{
 const camera=new core.Camera(20000,20000);camera.center={x:0,y:0};camera.zoom=20;
 let visited=0;const pads=Array.from({length:500},(_,i)=>({kind:'pad',type:'pad',uuid:String(i),ownerUuid:'owner',layer:'F.Cu',pinNumber:'1',padCenter:{x:(i%25)*5-60,y:Math.floor(i/25)*5-40},padWidth:2,padHeight:2,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}));
 const source=JSON.stringify(pads);function* entries(){for(const p of pads){visited++;yield [p,''];}}
 const labels=core.netLabels(entries(),camera,300);assert.equal(labels.length,300);assert.ok(visited<=301);assert.equal(JSON.stringify(pads),source);
 const fallback={...pads[0],uuid:'fallback',padCenter:undefined,padWidth:undefined,padHeight:undefined,points:[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}]};
 assert.equal(core.netLabels([[fallback,'']],camera).length,1);
});
test('highlight union honors live mutable members and the 200-net cap',()=>{
 const {canvas}=runtime(),a={},b={},c={};const members=[a],nets=[{primitives:members},...Array.from({length:199},()=>({primitives:[]})),{primitives:[c]}];
 canvas.setNetHighlights(nets);assert.equal(canvas.highlightCount,200);assert.equal(canvas.netPrimitives.has(a),true);assert.equal(canvas.netPrimitives.has(c),false);
 members.push(b);canvas.setNetHighlights(nets);assert.equal(canvas.netPrimitives.has(b),true);members.shift();canvas.setNetHighlights(nets);assert.equal(canvas.netPrimitives.has(a),false);canvas.dispose();
});

test('selection encloses measured rotated glyphs and visible footprint children',()=>{
 const {canvas}=runtime();canvas.viewport.camera.zoom=10;
 canvas.ctx.measureText=()=>({actualBoundingBoxLeft:0,actualBoundingBoxRight:80,actualBoundingBoxAscent:10,actualBoundingBoxDescent:5});
 const label={type:'text',x:20,y:30,text:'EN',angle:90,align:'left',layer:'F.Cu',ownerUuid:'u1'};
 const proxy={type:'polygon',kind:'footprint-hit',uuid:'u1',ownerUuid:'u1',points:[{x:0,y:0},{x:1,y:1}]};
 const pad={type:'circle',x:15,y:20,r:1,layer:'F.Cu',ownerUuid:'u1'};
 canvas.primitives=[proxy,label,pad];canvas.visibleLayers=new Set(['F.Cu']);
 const box=canvas.selectionBounds(label),measured=canvas.textBounds(label);
 assert.deepEqual(box,measured);const all=canvas.selectionBounds(proxy);
 assert.ok(all.x<=14&&all.y<=19&&all.y+all.h>=measured.y+measured.h);
 canvas.visibleLayers.clear();assert.equal(canvas.selectionBounds(proxy),null);canvas.dispose();
});

test('selected saved geometry stays highlighted without an enclosing rectangle in either orientation',()=>{
 const {canvas,operations}=runtime();const pad={type:'circle',x:5,y:5,r:2,layer:'F.Cu'};
 canvas.primitives=[pad];canvas.visibleLayers=new Set(['F.Cu']);canvas.selected=pad;canvas.viewport.camera.zoom=10;
 const painted=[];canvas.paint=(primitive,style)=>painted.push({primitive,style});
 for(const flip of [false,true]){canvas.viewport.camera.flipped=flip;operations.length=0;painted.length=0;canvas.draw();assert.equal(operations.filter(o=>o[0]==='strokeRect').length,0);assert.equal(painted[0].primitive,pad);assert.ok(painted[0].style.color,'selection remains visible on the saved primitive');}canvas.dispose();
});

test('retained native paths reuse complex source vectors across camera/theme changes and reset on document replacement',()=>{
 const paths=[];class Path{constructor(){this.commands=[];paths.push(this);}moveTo(...p){this.commands.push(['M',...p]);}lineTo(...p){this.commands.push(['L',...p]);}closePath(){this.commands.push(['Z']);}}
 const {canvas,operations}=runtime(2,{Path2D:Path});const p={type:'polygon',points:Array.from({length:12},(_,i)=>({x:i,y:i%2})),fill:true,width:.2};canvas.primitives=[p];canvas.viewport.camera.zoom=10;canvas.viewport.camera.center={x:5,y:6};canvas.paint(p);const native=paths[0];assert.equal(paths.length,1);assert.deepEqual(native.commands[0],['M',0,0]);assert.deepEqual(native.commands.at(-1),['Z']);assert.ok(operations.some(op=>op[0]==='fill'&&op[1]===native));assert.ok(operations.some(op=>op[0]==='stroke'&&op[1]===native));canvas.dark=false;canvas.viewport.camera.flipped=true;canvas.viewport.camera.zoom=20;canvas.paint(p);assert.equal(paths.length,1);assert.ok(operations.some(op=>op[0]==='scale'&&op[1]===-20&&op[2]===20));canvas.primitives=[p];canvas.paint(p);assert.equal(paths.length,2);canvas.dispose();
});
test('worksheet visibility survives board/layer fits and remains explicitly switchable',()=>{
 const {canvas}=runtime();canvas.setDocument({page:{width:297,height:210},layers:['F.Cu'],primitives:[{type:'circle',x:20,y:30,r:1,layer:'F.Cu'}]},'board.kicad_pcb');assert.equal(canvas.paperVisible,true);canvas.zoom_to_board();assert.equal(canvas.paperVisible,true);canvas.setWorksheetVisible(false);canvas.zoom_to_board();assert.equal(canvas.paperVisible,false);canvas.focusLayer('F.Cu');canvas.fitLayer();assert.equal(canvas.paperVisible,false);canvas.zoom_to_page();assert.equal(canvas.paperVisible,true);canvas.zoom_to_board();assert.equal(canvas.paperVisible,true);canvas.dispose();
});

test('warm vector painting validates saved points once and canvas resize avoids unchanged bitmap resets',()=>{
 const {canvas,element}=runtime();let reads=0;const points=Array.from({length:6},(_,i)=>({get x(){reads++;return i;},y:i%2})),p={type:'polygon',points,fill:true};canvas.primitives=[p];canvas.paint(p);const first=reads;canvas.paint(p);assert.equal(reads-first,6,'warm paint should project x once per point, not validate it again');let widthWrites=0,heightWrites=0,w=element.width,h=element.height;Object.defineProperty(element,'width',{get:()=>w,set:v=>{w=v;widthWrites++;}});Object.defineProperty(element,'height',{get:()=>h,set:v=>{h=v;heightWrites++;}});canvas.resize();canvas.resize();assert.equal(widthWrites,0);assert.equal(heightWrites,0);canvas.dispose();
});

test('opaque consecutive line batches reduce native strokes while preserving ordering and translucent operations',()=>{
 const {canvas,operations}=runtime();const lines=Array.from({length:600},(_,i)=>({type:'line',kind:'track',layer:'F.Cu',color:'#ff0000',width:.2,points:[{x:i/100,y:0},{x:i/100,y:1}]}));canvas.setDocument({layers:['F.Cu'],primitives:lines},'board.kicad_pcb');canvas.viewport.camera.bbox={x:-1,y:-1,w:10,h:5};operations.length=0;canvas.draw();assert.equal(operations.filter(op=>op[0]==='stroke').length,2);assert.equal(operations.filter(op=>op[0]==='moveTo').length,600);assert.equal(operations.filter(op=>op[0]==='lineTo').length,600);
 canvas.primitives=[lines[0],{...lines[1],opacity:.5},lines[2]];operations.length=0;canvas.draw();assert.equal(operations.filter(op=>op[0]==='stroke').length,3,'translucent geometry must remain separately composited');canvas.dispose();
});


test('quarter-turn camera projection round-trips all orientations and fits rotated rectangular bounds',()=>{
 const c=new core.Camera(900,500);assert.equal(c.quarterTurns,0);
 for(const flipped of [false,true])for(let turn=0;turn<4;turn++){
  c.flipped=flipped;c.quarterTurns=turn;c.bbox={x:10,y:20,w:80,h:25};
  near(c.zoom,Math.min(900/(turn%2?25:80),500/(turn%2?80:25)));
  for(const p of [{x:10,y:20},{x:90,y:20},{x:90,y:45},{x:10,y:45},{x:-300,y:180}]){const screen=c.world_to_screen(p),back=c.screen_to_world(screen);near(back.x,p.x);near(back.y,p.y);if(p.x>=10&&p.x<=90){assert.ok(screen.x>=-1e-8&&screen.x<=900+1e-8);assert.ok(screen.y>=-1e-8&&screen.y<=500+1e-8);}}
  for(const screen of [{x:0,y:0},{x:900,y:500}]){const p=c.screen_to_world(screen),b=c.bbox;assert.ok(p.x>=b.x-1e-8&&p.x<=b.x+b.w+1e-8&&p.y>=b.y-1e-8&&p.y<=b.y+b.h+1e-8);}
 }
 c.center.set(0,0);c.zoom=1;c.flipped=false;c.quarterTurns=1;assert.deepEqual(c.world_to_screen({x:10,y:0}),{x:450,y:260});c.quarterTurns=-1;assert.equal(c.quarterTurns,3);c.quarterTurns=9;assert.equal(c.quarterTurns,1);
});

test('rotated and flipped mouse drag, wheel anchoring and picking preserve saved identity',()=>{
 for(const flipped of [false,true])for(let turn=0;turn<4;turn++){
  const {canvas,listeners}=runtime(),pad={type:'pad',kind:'pad',x:2,y:3,r:1,fill:true,layer:'F.Cu',uuid:'saved-pad'};canvas.setDocument({primitives:[pad],layers:['F.Cu']},'board');const c=canvas.viewport.camera;c.flipped=flipped;c.quarterTurns=turn;c.center.set(0,0);c.zoom=10;
  const start={x:320,y:250},before=c.screen_to_world(start);listeners.get('pointerdown')({button:2,clientX:start.x,clientY:start.y,pointerId:1,preventDefault(){}});listeners.get('pointermove')({clientX:350,clientY:270});const after=c.screen_to_world({x:350,y:270});near(after.x,before.x);near(after.y,before.y);listeners.get('pointerup')({pointerId:1});
  const cursor={x:230,y:180},anchor=c.screen_to_world(cursor);listeners.get('wheel')({clientX:cursor.x,clientY:cursor.y,deltaY:-20,preventDefault(){}});const zoomed=c.screen_to_world(cursor);near(zoomed.x,anchor.x);near(zoomed.y,anchor.y);
  const screen=c.world_to_screen(pad);listeners.get('click')({clientX:screen.x,clientY:screen.y});assert.equal(canvas.selected,pad);canvas.dispose();
 }
});

test('quarter-turn action clears stale GPU gesture state and redraws without changing world geometry',()=>{
 const {canvas,element}=runtime();let hidden=0;canvas.motion={saved:{quarterTurns:0},hide(){hidden++;},dispose(){}};canvas.motionActive=true;canvas.wheelMotion=true;canvas.drag={x:3,y:4};element.style.opacity='0';const point={x:4,y:7},before=JSON.stringify(point),c=canvas.viewport.camera;const center={x:c.center.x,y:c.center.y},zoom=c.zoom;
 assert.equal(canvas.rotateQuarterTurn(),1);assert.equal(canvas.drag,null);assert.equal(canvas.motion.saved,null);assert.equal(canvas.motionActive,false);assert.equal(canvas.wheelMotion,false);assert.equal(element.style.opacity,'');assert.ok(hidden>0);assert.equal(canvas.cameraState().quarterTurns,1);near(c.center.x,center.x);near(c.center.y,center.y);near(c.zoom,zoom);assert.equal(JSON.stringify(point),before);assert.equal(canvas.rotateQuarterTurn(-1),0);assert.equal(canvas.rotateQuarterTurn(Infinity),0);canvas.dispose();
});

test('rotated native paths, arcs, text bounds and worksheet agree with the camera transform',()=>{
 const paths=[];class Path{constructor(){this.points=[];paths.push(this);}moveTo(x,y){this.points.push({x,y});}lineTo(x,y){this.points.push({x,y});}closePath(){}}
 const {canvas,operations}=runtime(1,{Path2D:Path}),c=canvas.viewport.camera,poly={type:'polygon',fill:true,points:Array.from({length:8},(_,i)=>({x:i,y:i%3}))},arc={type:'arc',start:{x:1,y:0},mid:{x:0,y:1},end:{x:-1,y:0}},text={type:'text',x:3,y:4,text:'R1',angle:25,size:1};canvas.primitives=[poly];c.center.set(2,3);c.zoom=10;canvas.ctx.measureText=()=>({actualBoundingBoxLeft:8,actualBoundingBoxRight:10,actualBoundingBoxAscent:7,actualBoundingBoxDescent:3});
 // Interpret actual retained-path Canvas transforms independently and compare vertices.
 for(const flipped of [false,true])for(let turn=0;turn<4;turn++){
  c.flipped=flipped;c.quarterTurns=turn;operations.length=0;canvas.paint(poly);let matrix=[1,0,0,1,0,0];const apply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  for(const op of operations){if(op[0]==='translate')matrix=apply(matrix,[1,0,0,1,op[1],op[2]]);if(op[0]==='scale')matrix=apply(matrix,[op[1],0,0,op[2],0,0]);if(op[0]==='rotate'){const a=op[1];matrix=apply(matrix,[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]);}}
  for(const p of paths[0].points){const q=c.world_to_screen(p);near(matrix[0]*p.x+matrix[2]*p.y+matrix[4],q.x);near(matrix[1]*p.x+matrix[3]*p.y+matrix[5],q.y);}
  operations.length=0;canvas.paint(arc);const op=operations.find(o=>o[0]==='arc'),start=c.world_to_screen(arc.start),end=c.world_to_screen(arc.end);near(op[1]+op[3]*Math.cos(op[4]),start.x);near(op[2]+op[3]*Math.sin(op[4]),start.y);near(op[1]+op[3]*Math.cos(op[5]),end.x);near(op[2]+op[3]*Math.sin(op[5]),end.y);assert.equal(op[6],flipped);
  operations.length=0;canvas.paint(text);near(operations.find(o=>o[0]==='rotate')[1],(25*(flipped?-1:1)+turn*90)*Math.PI/180);const b=canvas.textBounds(text);assert.ok(b&&b.w>0&&b.h>0);const anchor=c.world_to_screen(text),angle=(25*(flipped?-1:1)+turn*90)*Math.PI/180;for(const [x,y] of [[-8,-7],[10,-7],[10,3],[-8,3]]){const w=c.screen_to_world({x:anchor.x+x*Math.cos(angle)-y*Math.sin(angle),y:anchor.y+x*Math.sin(angle)+y*Math.cos(angle)});assert.ok(w.x>=b.x-1e-8&&w.x<=b.x+b.w+1e-8&&w.y>=b.y-1e-8&&w.y<=b.y+b.h+1e-8);}const projected=core.bounds([{type:'polygon',points:[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y+b.h}]}]);assert.ok(projected);
  canvas.design={page:{width:20,height:10}};canvas.paperVisible=true;operations.length=0;canvas.drawGeometry();const paper=operations.filter(o=>o[0]==='fillRect')[1],a=c.world_to_screen({x:0,y:0}),z=c.world_to_screen({x:20,y:10});near(paper[1],Math.min(a.x,z.x));near(paper[2],Math.min(a.y,z.y));assert.ok(paper[3]>0&&paper[4]>0);
 }
 assert.equal(paths.length,1);canvas.dispose();
});

test('15-degree views preserve fit, inverse picking, mirroring and full-turn stability',()=>{
 const {canvas}=runtime(),c=canvas.viewport.camera;
 for(const flipped of [false,true])for(let step=0;step<24;step++){
  c.flipped=flipped;c.quarterTurns=step/6;c.bbox={x:10,y:20,w:80,h:25};
  for(const p of [{x:10,y:20},{x:90,y:20},{x:90,y:45},{x:10,y:45},{x:31,y:27}]){const q=c.world_to_screen(p),back=c.screen_to_world(q);near(back.x,p.x);near(back.y,p.y);assert.ok(q.x>=-1e-8&&q.x<=c.width+1e-8&&q.y>=-1e-8&&q.y<=c.height+1e-8);}
 }
 c.quarterTurns=0;for(let i=0;i<24;i++)canvas.rotateDegrees(15);near(c.quarterTurns,0);canvas.rotateDegrees(-15);near(c.quarterTurns,23/6);canvas.rotateDegrees(15);near(c.quarterTurns,0);canvas.dispose();
});

test('layer-color net highlight retains front/back/internal identity, holes and filters in both themes',()=>{
 const palette=require('../layer-colors.js'),{canvas}=runtime(1,{KiCadLayerColors:palette}),layers=['F.Cu','In1.Cu','B.Cu'];
 const members=layers.map((layer,i)=>({type:'circle',kind:i?'track':'pad',x:i*3,y:0,r:1,layer,color:'#123456'})),hole={...members[0],hole:true},other={...members[0],x:12};
 const source=JSON.stringify(members);canvas.setDocument({primitives:[...members,hole,other],layers},'board');canvas.visibleLayers=new Set(layers);canvas.viewport.camera.center.set(5,0);canvas.viewport.camera.zoom=20;canvas.netClassColors=new Map(members.map(p=>[p,'#abcdef']));
 const painted=[];canvas.paint=(p,style)=>painted.push({p,style});
 for(const dark of [true,false]){canvas.dark=dark;canvas.setNetHighlights([{primitives:members}],{selectionColor:'layer',mode:'dim'});painted.length=0;canvas.draw();for(const p of members)assert.equal(painted.find(x=>x.p===p).style.color,palette.reviewColorFor(p.layer,dark));assert.equal(painted.find(x=>x.p===other).style.opacity,.42);assert.equal(painted.find(x=>x.p===hole).style.opacity,1);}
 canvas.visibleLayers.delete('B.Cu');painted.length=0;canvas.draw();assert.equal(painted.some(x=>x.p===members[2]),false);canvas.setNetHighlights([{primitives:members}],{selectionColor:'accent',mode:'bright'});painted.length=0;canvas.draw();assert.equal(painted.find(x=>x.p===members[0]).style.color,'#ffe18b');assert.equal(JSON.stringify(members),source);canvas.dispose();
});

test('dim context is neutral gray in PCB and schematic while selected layers stay vivid and clearing restores source fills',()=>{
 const palette=require('../layer-colors.js');
 for(const pcb of [true,false]){
  const {canvas,ctx}=runtime(1,{KiCadLayerColors:palette}),layer=pcb?'F.Cu':undefined;
  canvas.pcb=pcb;canvas.paperVisible=false;canvas.visibleLayers=new Set(layer?[layer]:[]);
  canvas.viewport.camera.bbox={x:-2,y:-2,w:16,h:8};
  const shape=(uuid,x)=>({type:'polygon',uuid,kind:'zone',layer,points:[{x,y:0},{x:x+3,y:0},{x:x+3,y:3},{x,y:3}],color:'#840000',fill:'color',fillColor:'#117744',opacity:.8});
  const selected=shape('selected',0),context=shape('context',7),source=JSON.stringify([selected,context]);
  canvas.primitives=[selected,context];
  const painted=[],original=canvas.paint;
  canvas.paint=function(p,style){original.call(this,p,style);painted.push({p,style,stroke:ctx.strokeStyle,fill:ctx.fillStyle,alpha:ctx.globalAlpha});};
  canvas.setNetHighlights([{primitives:[selected]}],{mode:'dim',selectionColor:'layer'});canvas.drawGeometry();
  const chosen=painted.find(row=>row.p===selected),dimmed=painted.find(row=>row.p===context);
  assert.equal(chosen.alpha,1);assert.equal(chosen.stroke,pcb?palette.reviewColorFor(layer,true):core.schematicColor('#840000',true));
  assert.equal(dimmed.stroke,pcb?palette.contextColorFor(layer,true):'#87919b');
  assert.equal(dimmed.fill,pcb?palette.contextColorFor(layer,true):'#87919b');near(dimmed.alpha,.8*(pcb?.42:.38));
  painted.length=0;canvas.setNetHighlights([{primitives:[selected]}],{mode:'bright',selectionColor:'source'});canvas.drawGeometry();
  assert.equal(painted.find(row=>row.p===context).alpha,.8);
  painted.length=0;canvas.setNetHighlights([]);canvas.drawGeometry();
  assert.equal(painted.find(row=>row.p===selected).fill,'#117744');assert.equal(painted.find(row=>row.p===selected).alpha,.8);
  assert.equal(JSON.stringify([selected,context]),source);assert.equal(canvas.netPrimitives.size,0);canvas.dispose();
 }
});

 test('unselected layer hues retain only a weak tint around neutral gray in both themes',()=>{
  const palette=require('../layer-colors.js');
  for(const dark of [true,false])for(const layer of ['F.Cu','B.Cu','In1.Cu','In2.Cu','F.Mask']){
   const color=palette.contextColorFor(layer,dark),rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),base=dark?[135,145,155]:[115,123,131];
   assert.ok(rgb.every((channel,i)=>Math.abs(channel-base[i])<=13));
   assert.notEqual(color,palette.reviewColorFor(layer,dark));
  }
 });
