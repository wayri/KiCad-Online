/* Touch camera adapter for the shared read-only canvas; desktop behavior is unchanged. */
((root)=>{
 'use strict';
 function magnifier(view){
  let panel=null,lens=null,label=null;
  function hide(){if(panel)panel.hidden=true;}
  function show(event,point,text='Release to place measurement point'){
   const node=view.canvas,d=node.ownerDocument||root.document;if(!panel){panel=d.createElement('div');panel.className='measurement-magnifier';panel.setAttribute('role','img');Object.assign(panel.style,{position:'fixed',zIndex:'3000',pointerEvents:'none',width:'160px',padding:'4px',border:'2px solid #29abd0',borderRadius:'12px',background:'#14232f',color:'#fff',boxShadow:'0 4px 20px #0007'});lens=d.createElement('canvas');lens.width=lens.height=152;Object.assign(lens.style,{display:'block',width:'152px',height:'152px',borderRadius:'7px'});label=d.createElement('small');Object.assign(label.style,{display:'block',font:'11px system-ui',overflowWrap:'anywhere'});panel.append(lens,label);d.body.append(panel);}
   const rect=node.getBoundingClientRect();if(!rect.width||!rect.height)return hide();const ctx=lens.getContext('2d');if(!ctx)return hide();
   const x=event.clientX-rect.left,y=event.clientY-rect.top,span=60,ratioX=node.width/rect.width,ratioY=node.height/rect.height;
   ctx.fillStyle='#14232f';ctx.fillRect(0,0,152,152);ctx.drawImage(node,(x-span/2)*ratioX,(y-span/2)*ratioY,span*ratioX,span*ratioY,0,0,152,152);
   const target=point?view.viewport.camera.world_to_screen(point):{x,y},tx=76+(target.x-x)*152/span,ty=76+(target.y-y)*152/span;
   ctx.strokeStyle='#ffde75';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(tx-9,ty);ctx.lineTo(tx+9,ty);ctx.moveTo(tx,ty-9);ctx.lineTo(tx,ty+9);ctx.stroke();ctx.beginPath();ctx.arc(tx,ty,5,0,Math.PI*2);ctx.stroke();
   label.textContent=text;panel.setAttribute('aria-label','Measurement magnifier: '+text);panel.hidden=false;
   const width=root.innerWidth||d.documentElement.clientWidth,height=root.innerHeight||d.documentElement.clientHeight,panelHeight=panel.getBoundingClientRect().height||190;
   panel.style.left=Math.max(8,Math.min(event.clientX-80,width-168))+'px';const above=event.clientY-panelHeight-32;panel.style.top=Math.max(8,Math.min(above>=8?above:event.clientY+32,height-panelHeight-8))+'px';
  }
  return{show,hide,dispose(){panel?.remove();panel=lens=label=null;}};
 }
 function attach(view){
  const node=view.canvas,camera=view.viewport.camera,points=new Map();let previous=null,moved=false,travel=0,lastTap=null,hold=null,held=false;
  const state=()=>{const p=[...points.values()];return{x:p.reduce((n,v)=>n+v.x,0)/p.length,y:p.reduce((n,v)=>n+v.y,0)/p.length,d:p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0};};
  const cancelHold=()=>{if(hold!==null){root.clearTimeout(hold);hold=null;}};
  const tool=()=>node.classList.contains('ruler-mode')||node.classList.contains('area-mode');
  const down=e=>{if(e.pointerType!=='touch'||tool())return;e.preventDefault();e.stopImmediatePropagation();view.dismissTouchPicker?.();points.set(e.pointerId,{x:e.clientX,y:e.clientY});node.setPointerCapture?.(e.pointerId);previous=state();cancelHold();if(points.size===1){moved=false;travel=0;held=false;const x=e.clientX,y=e.clientY;hold=root.setTimeout(()=>{hold=null;if(!moved&&points.size===1){held=true;lastTap=null;node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:x,clientY:y,button:2}));}},550);}else moved=true;};
  const move=e=>{if(!points.has(e.pointerId))return;e.preventDefault();e.stopImmediatePropagation();points.set(e.pointerId,{x:e.clientX,y:e.clientY});const next=state(),dx=next.x-previous.x,dy=next.y-previous.y;
   if(!dx&&!dy&&next.d===previous.d)return;
   travel+=Math.abs(dx)+Math.abs(dy);if(travel>6){moved=true;cancelHold();}
   const rect=node.getBoundingClientRect(),screen={x:next.x-rect.left,y:next.y-rect.top};const origin=camera.screen_to_world({x:0,y:0}),shift=camera.screen_to_world({x:dx,y:dy});camera.center.x-=shift.x-origin.x;camera.center.y-=shift.y-origin.y;
   if(next.d&&previous.d){const before=camera.screen_to_world(screen);camera.zoom=Math.max(.001,Math.min(10000,camera.zoom*next.d/previous.d));const after=camera.screen_to_world(screen);camera.center.x+=before.x-after.x;camera.center.y+=before.y-after.y;}
   previous=next;view.touchMotion=true;view.requestDraw();
  };
  const up=e=>{if(!points.has(e.pointerId))return;e.preventDefault();e.stopImmediatePropagation();cancelHold();points.delete(e.pointerId);if(node.hasPointerCapture?.(e.pointerId))node.releasePointerCapture?.(e.pointerId);if(points.size){previous=state();moved=true;return;}if(view.touchMotion){view.touchMotion=false;view.requestDraw();}previous=null;if(!moved&&!held&&e.type==='pointerup'){const init={bubbles:true,clientX:e.clientX,clientY:e.clientY,button:0},now=e.timeStamp||Date.now();if(view.touchNetPick?.(init)){lastTap=null;return;}node.dispatchEvent(new MouseEvent('click',init));if(lastTap&&now-lastTap.time<350&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<20){node.dispatchEvent(new MouseEvent('dblclick',init));lastTap=null;}else lastTap={time:now,x:e.clientX,y:e.clientY};}else lastTap=null;};
  const rotated=()=>{cancelHold();for(const id of points.keys())if(node.hasPointerCapture?.(id))node.releasePointerCapture?.(id);points.clear();view.touchMotion=false;previous=null;moved=true;travel=0;lastTap=null;held=false;};
  view.addEventListener?.('kicad:viewrotation',rotated);
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up]];
  for(const [name,fn]of listeners)node.addEventListener(name,fn,true);
  return()=>{for(const [name,fn]of listeners)node.removeEventListener(name,fn,true);view.removeEventListener?.('kicad:viewrotation',rotated);rotated();};
 }
 root.KiCadTouchCanvas={attach,magnifier};root.KiCadAndroidTouch=root.KiCadTouchCanvas;if(typeof module==='object'&&module.exports)module.exports=root.KiCadAndroidTouch;
 if(root.KiCadOwnedCanvas){const mount=root.KiCadOwnedCanvas.mount;root.KiCadOwnedCanvas.mount=(...args)=>{const view=mount(...args),detach=attach(view),dispose=view.dispose.bind(view);view.dispose=()=>{detach();dispose();};return view;};}
})(globalThis);
