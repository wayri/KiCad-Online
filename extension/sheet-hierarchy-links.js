/* Saved sheet-instance ancestry for the all-sheets overview. No net inference. */
((root) => {
  'use strict';

  const MAX_PLACEMENTS = 4096;
  const MAX_LINKS = 512;

  function build(pages, options = {}) {
    const headingGap = Number.isFinite(options.headingGap) ? Math.min(32,Math.max(0,options.headingGap)) : 16;
    const result = {links: [], omitted: 0, unresolved: 0};
    if (!Array.isArray(pages)) return result;
    const instances = new Map(), duplicates = new Set();
    for (const page of pages) for (const placement of page?.placements || []) {
      if (typeof placement?.id !== 'string' || typeof placement.path !== 'string' || placement.path !== page.path) {
        result.unresolved++; continue;
      }
      if (instances.has(placement.id)) duplicates.add(placement.id);
      else instances.set(placement.id, {placement, page});
    }
    if (instances.size > MAX_PLACEMENTS) {result.omitted = instances.size; return result;}
    const validity = new Map();
    function valid(id, visiting = new Set()) {
      if (validity.has(id)) return validity.get(id);
      if (duplicates.has(id) || visiting.has(id) || !instances.has(id)) return false;
      const placement = instances.get(id).placement;
      if (placement.unresolved) {validity.set(id, false); return false;}
      visiting.add(id);
      const ok = placement.parentId == null || valid(placement.parentId, visiting);
      visiting.delete(id);
      validity.set(id, ok);
      return ok;
    }
    const grouped = new Map();
    for (const [id, child] of instances) {
      const p = child.placement;
      if (!valid(id)) {result.unresolved++; continue;}
      if (p.parentId == null) continue;
      const parent = instances.get(p.parentId);
      if (!parent || parent.page === child.page || !valid(p.parentId)) {result.unresolved++; continue;}
      const key = JSON.stringify([parent.page.path, child.page.path]);
      if (!grouped.has(key)) grouped.set(key, {parent: parent.page, child: child.page, placements: [], parentPath: parent.page.path, childPath: child.page.path});
      grouped.get(key).placements.push(p);
    }
    const groups = [...grouped.values()];
    result.omitted = Math.max(0, groups.length - MAX_LINKS);
    const pairCount = new Map();
    for (const group of groups.slice(0, MAX_LINKS)) {
      const parent = group.parent, child = group.child;
      if (![parent.x, parent.y, parent.w, parent.h, child.x, child.y, child.w, child.h].every(Number.isFinite)) {result.unresolved++; continue;}
      const dx = child.x + child.w / 2 - parent.x - parent.w / 2;
      const dy = child.y + child.h / 2 - parent.y - parent.h / 2;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const pair = JSON.stringify([parent.path, child.path]);
      const ordinal = pairCount.get(pair) || 0;
      pairCount.set(pair, ordinal + 1);
      const shift = Math.min(ordinal, 5) * 3;
      const from = horizontal
        ? {x: parent.x + (dx >= 0 ? parent.w : 0), y: parent.y + parent.h / 2 + shift}
        : {x: parent.x + parent.w / 2 + shift, y: parent.y + (dy >= 0 ? parent.h : 0)};
      const to = horizontal
        ? {x: child.x + (dx >= 0 ? 0 : child.w), y: child.y + child.h / 2 + shift}
        : {x: child.x + child.w / 2 + shift, y: child.y + (dy >= 0 ? 0 : child.h)};
      const names = [...new Set(group.placements.map(p => String(p.label || p.sheetId || p.path).split(' / ').at(-1)))];
      const label = names.length <= 2 ? names.join(', ') : `${group.placements.length} placements`;
      result.links.push({from, to, label, showLabel: group.placements.length > 1, count: group.placements.length, parentPath: group.parentPath, childPath: group.childPath,
        parentIds: [...new Set(group.placements.map(p => p.parentId))], childIds: group.placements.map(p => p.id)});
    }
    // A shared parent stem and one child drop form a tree, rather than a bundle
    // of competing shortest paths. Keep the rail in the empty rank gutter.
    const families = new Map(), fallback = [];
    for (const link of result.links) {
      if (!families.has(link.parentPath)) families.set(link.parentPath, []);
      families.get(link.parentPath).push(link);
    }
    const lanes=new Map();
    for(const [family,children] of families){const parent=instances.get(children[0].parentIds[0])?.page,top=Math.min(...children.map(link=>pages.find(page=>page.path===link.childPath).y));const key=JSON.stringify([parent.y+parent.h,top]);if(!lanes.has(key))lanes.set(key,[]);lanes.get(key).push(family);}
    for(const group of lanes.values())group.sort();
    const routedLinks = [];
    for (const children of families.values()) {
      const parent = instances.get(children[0].parentIds[0])?.page;
      const childPages = children.map(link => pages.find(page => page.path === link.childPath));
      const firstTop = Math.min(...childPages.map(page => page.y));
      const bottom = parent.y + parent.h;
      if (firstTop - bottom < Math.max(24,headingGap+8)) {fallback.push(...children); continue;}
      const peers=lanes.get(JSON.stringify([bottom,firstTop])),lane=peers.indexOf(children[0].parentPath);
      const rail = bottom + (firstTop - headingGap - bottom) * (lane+1)/(peers.length+1);
      const start = {x: parent.x + parent.w / 2, y: bottom};
      const routes = children.map((link, index) => {
        const child = childPages[index], end = {x: child.x + child.w / 2, y: child.y - headingGap};
        const points = [start, {x:start.x,y:rail}, {x:end.x,y:rail}, end]
          .filter((point, i, all) => !i || point.x !== all[i-1].x || point.y !== all[i-1].y);
        return {...link, from:start, to:end, points, tree:true};
      });
      const intersects = routes.some(link => link.points.slice(1).some((to, index) => {
        const from = link.points[index];
        return pages.some(page => page !== parent && page.path !== link.childPath &&
          (from.x === to.x ? from.x > page.x-4 && from.x < page.x+page.w+4 && Math.max(from.y,to.y)>page.y-headingGap && Math.min(from.y,to.y)<page.y+page.h+4 : from.y>page.y-headingGap && from.y<page.y+page.h+4 && Math.max(from.x,to.x)>page.x-4 && Math.min(from.x,to.x)<page.x+page.w+4));
      }));
      if (intersects) fallback.push(...children); else routedLinks.push(...routes);
    }
    const router = root.KiCadOverviewRouting;
    if (fallback.length && router) {const routed=router.route(pages,fallback);routedLinks.push(...routed.links);result.omitted+=routed.omitted;result.routing=routed;}
    else routedLinks.push(...fallback);
    result.links=routedLinks;return result;
  }

  // Shared rounded path for the miniature and canvas guides. Curves stay in
  // the already routed corner gutter rather than cutting across sheet boxes.
  function pathData(points, radius = 12) {
    if(!Array.isArray(points)||points.length<2||points.length>1024||points.some(p=>!p||![p.x,p.y].every(Number.isFinite)))return '';
    const path=points.filter((p,i)=>!i||p.x!==points[i-1].x||p.y!==points[i-1].y);if(path.length<2)return '';
    const commands=[`M ${path[0].x} ${path[0].y}`];
    for(let i=1;i<path.length-1;i++){const prev=path[i-1],p=path[i],next=path[i+1],before=Math.hypot(p.x-prev.x,p.y-prev.y),after=Math.hypot(next.x-p.x,next.y-p.y),r=Math.min(Math.max(0,radius),before/3,after/3);commands.push(`L ${p.x-(p.x-prev.x)/before*r} ${p.y-(p.y-prev.y)/before*r}`,`Q ${p.x} ${p.y} ${p.x+(next.x-p.x)/after*r} ${p.y+(next.y-p.y)/after*r}`);}
    commands.push(`L ${path.at(-1).x} ${path.at(-1).y}`);return commands.join(' ');
  }

  // A hop denotes a crossing, never an electrical or hierarchy junction.
  function crossingPath(points,previous,radius=7,cornerRadius=12){
    if(!Array.isArray(points)||points.length>1024||points.some(p=>!p||![p.x,p.y].every(Number.isFinite))||!Array.isArray(previous))return '';
    const routed=[];let budget=65536;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],vertical=a.x===b.x,horizontal=a.y===b.y,length=Math.hypot(b.x-a.x,b.y-a.y),hits=[];
      if(!length)continue;if(!routed.length)routed.push(`M ${a.x} ${a.y}`);
      for(const path of previous.slice(0,512))for(let j=1;j<Math.min(path.length,1024)&&budget>0;j++,budget--){
        const c=path[j-1],d=path[j];let at;
        if(vertical&&c.y===d.y&&a.x>Math.min(c.x,d.x)&&a.x<Math.max(c.x,d.x)&&c.y>Math.min(a.y,b.y)&&c.y<Math.max(a.y,b.y))at={x:a.x,y:c.y};
        if(horizontal&&c.x===d.x&&a.y>Math.min(c.y,d.y)&&a.y<Math.max(c.y,d.y)&&c.x>Math.min(a.x,b.x)&&c.x<Math.max(a.x,b.x))at={x:c.x,y:a.y};
        if(at){const t=Math.hypot(at.x-a.x,at.y-a.y);if(t>radius*2&&length-t>radius*2)hits.push({at,t});}
      }
      let last=-Infinity;for(const {at,t}of hits.sort((x,y)=>x.t-y.t)){if(t-last<radius*3)continue;last=t;const ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
        routed.push(`L ${at.x-ux*radius} ${at.y-uy*radius} Q ${at.x+(vertical?radius*2:0)} ${at.y+(horizontal?-radius*2:0)} ${at.x+ux*radius} ${at.y+uy*radius}`);
      }
      routed.push(`L ${b.x} ${b.y}`);
    }
    return routed.some(command=>command.includes(' Q '))?routed.join(' '):pathData(points,cornerRadius);
  }
  function netCurve(from,to){
    const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);if(!distance)return {a:from,b:{...from},c:{...to},d:to};
    let nx=-dy/distance,ny=dx/distance;if(ny>0||ny===0&&nx<0){nx=-nx;ny=-ny;}
    const lift=Math.min(64,Math.max(12,distance*.2));
    return {a:from,b:{x:from.x+dx/3+nx*lift,y:from.y+dy/3+ny*lift},c:{x:from.x+2*dx/3+nx*lift,y:from.y+2*dy/3+ny*lift},d:to};
  }
  function netColor(name,dark=true){const palette=dark?['#65d9ff','#ffbf69','#c4a3ff','#6fe0ad','#ff91b8','#a6d875']:['#006aa6','#945400','#7444b3','#08794b','#ae3060','#517719'];let hash=0;for(const char of String(name||''))hash=(Math.imul(hash,31)+char.codePointAt(0))>>>0;return palette[hash%palette.length];}
  function drawGuides(view, graph, dark, hasNetLinks) {
    const ctx=view?.ctx,camera=view?.viewport?.camera;
    if(!ctx||!camera||!graph?.links?.length)return;
    ctx.save();
    ctx.globalAlpha*=hasNetLinks ? .2 : .42;
    ctx.strokeStyle=dark?'#92a9b7':'#536f81';
    ctx.lineWidth=1.25;
    ctx.lineJoin=ctx.lineCap='round';
    ctx.setLineDash([]);
    ctx.beginPath();
    for(const link of graph.links){
      const points=(link.exteriorPoints||link.points||[link.from,link.to]).map(point=>camera.world_to_screen(point));
      if(points.length<2||points.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)))continue;
      ctx.moveTo(points[0].x,points[0].y);
      for(const point of points.slice(1))ctx.lineTo(point.x,point.y);
      const tip=points.at(-1),tail=points.at(-2),dx=tip.x-tail.x,dy=tip.y-tail.y,length=Math.hypot(dx,dy);
      if(length<6)continue;
      const ux=dx/length,uy=dy/length,head=Math.min(5,length*.6),wing=head*.5;
      ctx.moveTo(tip.x-ux*head-uy*wing,tip.y-uy*head+ux*wing);
      ctx.lineTo(tip.x,tip.y);
      ctx.lineTo(tip.x-ux*head+uy*wing,tip.y-uy*head-ux*wing);
    }
    // Paint the shared rails once, including overlaps in the same path.
    ctx.stroke();
    ctx.restore();
  }
  function draw(view, graph, dark = false, style = {}) {
    const ctx = view?.ctx, camera = view?.viewport?.camera;
    if (!ctx || !camera || !graph?.links?.length) return;
    ctx.save();ctx.globalAlpha*=Number.isFinite(style.opacity)?style.opacity:1;const labels=new Set(),labelBoxes=[];
    const pageBoxes=(view.design?.overviewPages||[]).map(page=>{const points=[{x:page.x,y:page.y-32},{x:page.x+page.w,y:page.y-32},{x:page.x,y:page.y+page.h},{x:page.x+page.w,y:page.y+page.h}].map(p=>camera.world_to_screen(p));return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};});
    for (const link of graph.links) {
      const net=style.kind==='net',path=(net?(link.points||[link.from,link.to]):(link.exteriorPoints||link.points||[link.from,link.to])).map(p=>camera.world_to_screen(p)),a=path[0],b=path.at(-1),tail=path.at(-2)||a;
      if(!net&&style.dashed&&link.anchorStubs?.length){ctx.save();ctx.globalAlpha=.32;ctx.strokeStyle=style.color||(dark?'#d4b565':'#9e7b29');ctx.lineWidth=1;ctx.setLineDash([2,5]);for(const stub of link.anchorStubs){const local=stub.map(p=>camera.world_to_screen(p));ctx.beginPath();ctx.moveTo(local[0].x,local[0].y);for(const p of local.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();}ctx.restore();}
      const length = Math.hypot(b.x - tail.x, b.y - tail.y);
      if (length < .1) continue;
      const ux = (b.x - tail.x) / length, uy = (b.y - tail.y) / length;
      const inset=Math.min(2,length/4),head=Math.min(6,Math.max(3,length*.65)),wing=head*.45;
      const tip = net?b:{x: b.x - ux * inset, y: b.y - uy * inset},curve=net?netCurve(a,b):null,color=net?netColor(link.name||link.label,dark):style.color||(style.familyColors?netColor(link.parentPath,dark):(dark ? '#69c4ba' : '#398d84'));
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      if(net&&ctx.bezierCurveTo)ctx.bezierCurveTo(curve.b.x,curve.b.y,curve.c.x,curve.c.y,b.x,b.y);
      else {for(let i=1;i<path.length-1;i++){const prev=path[i-1],p=path[i],next=path[i+1],before=Math.hypot(p.x-prev.x,p.y-prev.y),after=Math.hypot(next.x-p.x,next.y-p.y),radius=Math.min(12,before/3,after/3);if(!before||!after)continue;ctx.lineTo(p.x-(p.x-prev.x)/before*radius,p.y-(p.y-prev.y)/before*radius);if(ctx.quadraticCurveTo)ctx.quadraticCurveTo(p.x,p.y,p.x+(next.x-p.x)/after*radius,p.y+(next.y-p.y)/after*radius);else ctx.lineTo(p.x,p.y);}ctx.lineTo(tip.x, tip.y);}
      // A narrow paper-colored casing makes crossings unambiguous: a hierarchy
      // branch passes over a net guide instead of looking electrically joined.
      if(!style.dashed){ctx.setLineDash([]);ctx.strokeStyle=dark?'#192a34':'#ffffff';ctx.lineWidth=4;ctx.lineJoin='round';ctx.stroke();}
      ctx.setLineDash(style.dashed?[4,4]:[]); ctx.strokeStyle = color; ctx.lineWidth = net?1.8:1.5; ctx.lineJoin='round'; ctx.stroke();
      if(net){for(const endpoint of [a,b]){ctx.beginPath();ctx.arc(endpoint.x,endpoint.y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=dark?'#17191f':'#fff';ctx.lineWidth=1;ctx.stroke();}}
      else {ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - ux * head - uy * wing, tip.y - uy * head + ux * wing);
      ctx.lineTo(tip.x - ux * head + uy * wing, tip.y - uy * head - ux * wing);
      ctx.closePath(); ctx.fillStyle = style.color||(style.familyColors?netColor(link.parentPath,dark):(dark ? '#69c4ba' : '#398d84')); ctx.fill();}
      const label=String(link.label||link.name||'').trim();
      if(style.labels===false || link.showLabel === false || !label || net&&labels.has(label)||!net&&(camera.zoom??1)<.8) continue;
      const labelPath=(net&&link.exteriorPoints?link.exteriorPoints.map(p=>camera.world_to_screen(p)):path);const segment=labelPath.slice(1).map((p,i)=>({a:labelPath[i],b:p,length:Math.hypot(p.x-labelPath[i].x,p.y-labelPath[i].y)})).sort((a,b)=>b.length-a.length)[0];const text=label.length>40?label.slice(0,39)+'…':label,x=net?(curve.a.x+3*curve.b.x+3*curve.c.x+curve.d.x)/8:(segment.a.x+segment.b.x)/2,y=(net?(curve.a.y+3*curve.b.y+3*curve.c.y+curve.d.y)/8:(segment.a.y+segment.b.y)/2)-12;
      ctx.font = '500 10px sans-serif';
      const width = Math.min(220, ctx.measureText(text).width + 12);
      if(Number.isFinite(camera.width)&&(x-width/2<4||x+width/2>camera.width-4||y<12||y>camera.height-12))continue;
      const box={left:x-width/2-3,right:x+width/2+3,top:y-12,bottom:y+12},overlaps=other=>box.left<other.right&&box.right>other.left&&box.top<other.bottom&&box.bottom>other.top;
      if(pageBoxes.some(overlaps)||labelBoxes.some(overlaps))continue;labelBoxes.push(box);labels.add(label);
      ctx.fillStyle = dark ? '#10212b' : '#ffffff'; ctx.fillRect(x - width / 2, y - 10, width, 20);
      ctx.fillStyle = net?color:dark ? '#d9fff7' : '#07584f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y, width - 8);
    }
    ctx.restore();
  }

  root.KiCadSheetHierarchyLinks = {build, draw, drawGuides, pathData,crossingPath,netCurve,netColor};
  if (typeof module === 'object' && module.exports) module.exports = root.KiCadSheetHierarchyLinks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
