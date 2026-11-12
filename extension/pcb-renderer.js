/* Independent, read-only KiCad PCB geometry extraction. All coordinates are mm. */
((root) => {
  "use strict";
  const Compatibility=root.KiCadFileCompatibility||(typeof module==="object"&&module.exports?require("./file-compatibility.js"):null);
  const Worksheet=root.KiCadWorksheet||(typeof module==="object"&&module.exports?require("./worksheet.js"):null);
  const value = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kind = (node) => Array.isArray(node) ? String(value(node[0])) : "";
  const children = (node, name) => Array.isArray(node) ? node.filter((part) => Array.isArray(part) && kind(part) === name) : [];
  const child = (node, name) => children(node, name)[0];
  const field = (node, name) => value(child(node, name)?.[1]);
  const num = (item, fallback = 0) => { const result = Number(value(item)); return Number.isFinite(result) ? result : fallback; };
  const point = (node, name) => {
    const entry = child(node, name);
    if (!entry || !Number.isFinite(Number(value(entry[1]))) || !Number.isFinite(Number(value(entry[2])))) return null;
    return { x: num(entry[1]), y: num(entry[2]) };
  };
  const points = (node) => children(child(node, "pts"), "xy").map((xy) => ({ x: num(xy[1]), y: num(xy[2]) }));
  const uuid = (node) => String(field(node, "uuid") || field(node, "tstamp") || "");
  const hasAtom = (node, atom) => Array.isArray(node) && node.some((part) => !Array.isArray(part) && value(part) === atom);
  const hasFlag = (node, name) => Array.isArray(node) && node.some((part) => {
    if (Array.isArray(part) && kind(part) === name) {
      const state = value(part[1]);
      return state === undefined || state === true || state === "yes" || state === "true" || state === 1;
    }
    return !Array.isArray(part) && !(part && typeof part === "object") && part === name;
  });
  const hidden = (node) => hasFlag(node, "hide") || hasFlag(child(node, "effects"), "hide") ||
    hasFlag(child(child(node, "effects"), "font"), "hide");
  const rotation = (node) => num(child(node, "at")?.[3]);
  const PI = Math.PI;
  const toRadians = (degrees) => degrees * PI / 180;
  const round = (n) => Math.round(n * 1e8) / 1e8;
  const Palette=root.KiCadLayerColors||(typeof module==='object'&&module.exports?require('./layer-colors.js'):null);
  const colorFor = layer => Palette.colorFor(layer);
  const paperSizes = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210], A5: [210, 148],
    A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6],
    USLetter: [279.4, 215.9], USLegal: [355.6, 215.9], USLedger: [431.8, 279.4] };
  function pageOf(ast, warnings) {
    const paper = child(ast, "paper") || child(ast, "page");
    const name = String(value(paper?.[1]) || "A4");
    let size = paperSizes[name];
    if (name === "User") size = [num(paper?.[2]), num(paper?.[3])];
    if (!size || size.some((dimension) => dimension <= 0)) {
      warnings.push(`Unsupported PCB paper ${name}; using A4 page dimensions.`); size = paperSizes.A4;
    }
    const portrait = paper?.some((part) => value(part) === "portrait");
    const block = child(ast,"title_block");
    const comments = Array(9).fill("");
    for (const item of children(block,"comment")) { const index = num(item[1]); if (index >= 1 && index <= 9) comments[index-1] = String(value(item[2]) || ""); }
    return { width: portrait ? size[1] : size[0], height: portrait ? size[0] : size[1], name,
      title:String(field(block,"title") || ""), date:String(field(block,"date") || ""),
      revision:String(field(block,"rev") || ""), company:String(field(block,"company") || ""), comments,format:name,titleBlock:{title:String(field(block,"title")||""),date:String(field(block,"date")||""),rev:String(field(block,"rev")||""),company:String(field(block,"company")||""),comments} };
  }
  function transformed(origin, angle) {
    const c = Math.cos(toRadians(angle)), s = Math.sin(toRadians(angle));
    return (p) => ({ x: round(origin.x + p.x * c + p.y * s), y: round(origin.y - p.x * s + p.y * c) });
  }
  const identity = (p) => p;
  function roundedRect(width, height, radius) {
    const w = width / 2, h = height / 2, r = Math.max(0, Math.min(radius, w, h));
    if (r < 1e-6) return [{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}];
    const result = [];
    for (const [cx, cy, start] of [[w-r,-h+r,-90],[w-r,h-r,0],[-w+r,h-r,90],[-w+r,-h+r,180]]) {
      for (let step = 0; step <= 6; step++) {
        const a = toRadians(start + step * 15);
        result.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    }
    return result;
  }
  function oval(width, height) {
    const radius = Math.min(width, height) / 2;
    if (Math.abs(width - height) < 1e-9) return null;
    if (width > height) {
      const half = width / 2 - radius, result = [];
      for (let i = 0; i <= 12; i++) { const a = toRadians(-90 + i * 15); result.push({x:half + radius*Math.cos(a),y:radius*Math.sin(a)}); }
      for (let i = 0; i <= 12; i++) { const a = toRadians(90 + i * 15); result.push({x:-half + radius*Math.cos(a),y:radius*Math.sin(a)}); }
      return result;
    }
    return oval(height, width).map((p) => ({x:p.y,y:p.x}));
  }
  function build(ast, path = "", options = {}) {
    const warnings = [], primitives = [];
    if (kind(ast) !== "kicad_pcb") throw new Error("Expected a KiCad PCB AST.");
    const compatibility=Compatibility?.inspect(ast);
    warnings.push(...(compatibility?.warnings||[]));
    const variableText=Compatibility?.textResolver(ast,{...options,path},message=>{if(!warnings.includes(message))warnings.push(message);}),variableFields=new Map();
    const page = pageOf(ast, warnings);
    const layerNames = (child(ast, "layers") || []).slice(1).filter(Array.isArray).map((part) => String(value(part[1])));
    const netNames=new Map(children(ast,'net').filter(n=>typeof value(n[1])==='number'&&typeof value(n[2])==='string').map(n=>[value(n[1]),value(n[2])])),modernNamedNets=Number(field(ast,'version'))>=20260206;
    // Format metadata belongs to the board, not each generated primitive. In
    // large boards most graphics have no net declaration at all.
    function netMeta(node){const declaration=child(node,'net');if(!declaration)return{};const id=value(declaration[1]);if(typeof id==='number'&&Number.isSafeInteger(id)&&id>=0)return{netId:id,netCode:String(id),netName:String(value(declaration[2])??netNames.get(id)??'')};if(modernNamedNets&&declaration.length===2&&typeof id==='string'&&id)return{netId:id,netCode:'name:'+id,netName:id};return{};}
    const push = (primitive) => {
      if (primitives.length >= 250000) throw new Error("PCB has too many render primitives.");
      primitives.push(primitive);
    };
    const warned = new Set();
    const warn = (label, node) => {
      if (warned.has(label) || warnings.length >= 1000) return;
      warned.add(label);
      warnings.push(`${label}${uuid(node) ? ` (example ${uuid(node)})` : ""} is not drawn exactly.`);
    };
    if(Worksheet){for(const primitive of Worksheet.build(page,path))push({...primitive,layer:"Worksheet"});}
    else warnings.push("Default worksheet module is unavailable.");
    warnings.push("Custom .kicad_wks templates are not resolved; the standard KiCad drawing sheet is shown.");
    function base(node, layer, owner = {}) {
      const lineStyle=field(child(node,"stroke"),"type");
      return { layer, color: colorFor(layer), ...(["dash","dot","dash_dot","dash_dot_dot"].includes(lineStyle)?{lineStyle}:{}), uuid: uuid(node) || owner.uuid || undefined,
        ownerUuid: owner.ownerUuid || owner.uuid || undefined,
        reference: owner.reference || undefined, kind: owner.kind || kind(node),...netMeta(node),
        ...(owner.kind==='pad'?{name:owner.name,pinNumber:owner.pinNumber,pinName:owner.pinName,netName:owner.netName,netId:owner.netId,netCode:owner.netCode,
          padCenter:owner.padCenter,padWidth:owner.padWidth,padHeight:owner.padHeight,padAngle:owner.padAngle,padShape:owner.padShape}:{}) };
    }
    function isFilled(node) {
      const fill = child(node,"fill");
      return ["yes","solid"].includes(value(fill?.[1])) || field(fill,"type") === "solid";
    }
    function strokeWidth(node) {
      const stroke = child(node, "stroke");
      return Math.max(0.01, num(child(stroke, "width")?.[1], num(field(node, "width"), .15)));
    }
    function drawShape(node, layer, transform = identity, owner = {}) {
      const type = kind(node), meta = base(node, layer, owner), width = strokeWidth(node);
      const withPoints = (typeName, pts, fill = false) => {
        if (pts.some((p) => !p)) return;
        push({ type: typeName, points: pts.map(transform), width, fill, ...meta });
      };
      if (["gr_line", "fp_line"].includes(type)) withPoints("line", [point(node,"start"),point(node,"end")]);
      else if (["gr_arc", "fp_arc", "arc"].includes(type)) {
        let start = point(node,"start"), mid = point(node,"mid"), end = point(node,"end");
        if(start && end && !mid && child(node,"angle")){
          // KiCad 4/5 arcs store a centre and start point, with a signed sweep.
          const center=start,sweep=num(field(node,"angle"))*Math.PI/180,dx=end.x-center.x,dy=end.y-center.y;
          const at=theta=>({x:center.x+dx*Math.cos(theta)-dy*Math.sin(theta),y:center.y+dx*Math.sin(theta)+dy*Math.cos(theta)});
          start=end;mid=at(sweep/2);end=at(sweep);
        }
        if (start && mid && end) push({ type:"arc", start:transform(start), mid:transform(mid), end:transform(end), width, ...meta });
        else warn(type, node);
      } else if (["gr_rect", "fp_rect"].includes(type)) {
        const a = point(node,"start"), b = point(node,"end");
        if (a && b) withPoints("polygon", [{x:a.x,y:a.y},{x:b.x,y:a.y},{x:b.x,y:b.y},{x:a.x,y:b.y}], isFilled(node));
      } else if (["gr_circle", "fp_circle"].includes(type)) {
        const center = point(node,"center"), end = point(node,"end");
        if (center && end) {
          const c = transform(center), edge = transform(end);
          push({ type:"circle", x:c.x, y:c.y, r:Math.hypot(edge.x-c.x,edge.y-c.y), width,
            fill:isFilled(node), ...meta });
        }
      } else if (["gr_poly", "fp_poly"].includes(type)) {
        const pts = points(node);
        if (pts.length >= 3) withPoints("polygon", pts, isFilled(node));
      } else if (["gr_text", "fp_text", "property"].includes(type)) {
        if (hidden(node)) return;
        const at = point(node,"at");
        const content = type === "property" ? value(node[2]) : value(node[type === "fp_text" ? 2 : 1]);
        const effects = child(node,"effects"), font = child(effects,"font");
        const fontSize = child(font,"size"), justify = child(effects,"justify");
        const justification = justify?.slice(1).map((part) => String(value(part))) || [];
        if (at && content != null) push({ type:"text", text:variableText?.resolve(content,variableFields.get(owner.uuid)||{})??String(content), ...transform(at),
          size:num(fontSize?.[2],1), angle:-rotation(node), width:.15,
          property:type==="property"?String(value(node[1])):type==="fp_text"&&value(node[1])==="reference"?"Reference":type==="fp_text"&&value(node[1])==="value"?"Value":undefined,
          bold:hasAtom(font,"bold") || !!child(font,"bold"),
          italic:hasAtom(font,"italic") || !!child(font,"italic"),
          align:justification.includes("left") ? "left" : justification.includes("right") ? "right" : "center",
          baseline:justification.includes("top") ? "top" : justification.includes("bottom") ? "bottom" : "middle",
          ...meta });
      } else warn(type, node);
    }
    function pad(node, footprint, transform) {
      const at = point(node,"at") || {x:0,y:0}, center = transform(at), shape = String(value(node[3]) || "rect");
      const size = child(node,"size"), width = num(size?.[1]), height = num(size?.[2]);
      if (width <= 0 || height <= 0) { warn("Pad with invalid size",node); return; }
      const rawLayers = (child(node,"layers") || []).slice(1).map((part) => String(value(part)));
      const selected = [...new Set(rawLayers.flatMap((item) => item.startsWith("*.")
        ? layerNames.filter((layer) => layer.endsWith(item.slice(1))) : [item]))];
      if (!selected.length) { warn("Pad without renderable layers",node); return; }
      // KiCad serializes the pad angle in board coordinates, even though its
      // position is footprint-local. An omitted angle is therefore zero.
      const localAngle = rotation(node);
      const orient = transformed(center, localAngle);
      const padUUID = uuid(node) || footprint.uuid;
      const drillNode = child(node,"drill");
      const ovalDrill = value(drillNode?.[1]) === "oval";
      const drill = num(drillNode?.[ovalDrill ? 2 : 1]);
      const drillHeight = ovalDrill ? num(drillNode?.[3]) : drill;
      const offsetNode = child(drillNode,"offset");
      const drillOffset = offsetNode ? {x:num(offsetNode[1]),y:num(offsetNode[2])} : {x:0,y:0};
      const holeCenter = orient(drillOffset);
      for (const layer of selected) {
        const meta = { layer, color:colorFor(layer), uuid:padUUID, ownerUuid:footprint.uuid,
          reference:footprint.reference,
          kind:"pad", name:String(value(node[1]) || ""), pinNumber:String(value(node[1]) || ""),
          padCenter:{...center}, padWidth:width, padHeight:height, padAngle:-localAngle,padShape:shape,
          pinName:String(field(node,"pinfunction") || ""), ...netMeta(node), padType:String(value(node[2])||""), fill:true };
        if (shape === "circle") push({ type:"pad", x:center.x, y:center.y, r:width/2, ...meta });
        else if (shape === "custom") {
          const options = child(node,"options"), anchor = String(field(options,"anchor") || "");
          if (anchor === "rect") push({ type:"pad", points:roundedRect(width,height,0).map(orient), ...meta });
          else if (anchor === "circle") {
            if (Math.abs(width-height) > 1e-8) warn("Noncircular custom pad anchor",node);
            push({ type:"pad", x:center.x, y:center.y, r:Math.min(width,height)/2, ...meta });
          } else { warn(`Unsupported custom pad anchor ${anchor || "(missing)"}`,node); continue; }
          const shapes = child(node,"primitives");
          if (shapes) for (const primitive of shapes.slice(1)) {
            if (!Array.isArray(primitive)) continue;
            const primitiveKind = kind(primitive);
            if (!["gr_poly","gr_line","gr_arc","gr_circle","gr_rect"].includes(primitiveKind)) {
              warn(`Unsupported custom pad primitive ${primitiveKind}`,node); continue;
            }
            const explicitWidth = field(primitive,"width");
            if (["gr_line","gr_arc"].includes(primitiveKind) && explicitWidth !== undefined && num(explicitWidth) <= 0) {
              warn(`Zero-width custom pad ${primitiveKind}`,node); continue;
            }
            drawShape(primitive,layer,orient,meta);
          }
        }
        else {
          let outline;
          if (shape === "rect") outline = roundedRect(width,height,0);
          else if (shape === "roundrect") outline = roundedRect(width,height,Math.min(width,height)*num(field(node,"roundrect_rratio"),.25));
          else if (shape === "oval") outline = oval(width,height) || roundedRect(width,height,Math.min(width,height)/2);
          else { warn(`Unsupported ${shape} pad`,node); continue; }
          push({ type:"pad", points:outline.map(orient), ...meta });
        }
        if (drill > 0 && drillHeight > 0) {
          const holeMeta = { layer, color:"#111b25", fill:true, hole:true,
            uuid:padUUID, ownerUuid:footprint.uuid, reference:footprint.reference, kind:"drill", objectCategory:"pads",...netMeta(node) };
          if (ovalDrill && Math.abs(drill-drillHeight) > 1e-9) {
            const holeTransform = transformed(holeCenter,localAngle);
            push({ type:"polygon", points:oval(drill,drillHeight).map(holeTransform), ...holeMeta });
          } else push({ type:"circle", x:holeCenter.x, y:holeCenter.y, r:drill/2, ...holeMeta });
        }
      }
    }
    for (const node of ast.slice(1)) {
      if (!Array.isArray(node)) continue;
      const type = kind(node), layer = String(field(node,"layer") || "F.Cu");
      if (type === "segment") {
        const a = point(node,"start"), b = point(node,"end");
        if (a && b) push({ type:"line", points:[a,b], layer, color:colorFor(layer),
          width:num(field(node,"width"),.2), fill:false, uuid:uuid(node) || undefined, kind:"track",...netMeta(node) });
      } else if (type === "arc") {
        drawShape(node,layer);
      } else if (type === "via") {
        const at = point(node,"at"), diameter = num(field(node,"size")), drill = num(field(node,"drill"));
        if (!at || diameter <= 0) { warn("Via with invalid dimensions",node); continue; }
        const viaLayers = (child(node,"layers") || []).slice(1).map((part) => String(value(part)));
        const copperOrder = layerNames.filter((item) => item.endsWith(".Cu"));
        let plated = viaLayers.filter((item) => item.endsWith(".Cu"));
        if (plated.length >= 2) {
          const first = copperOrder.indexOf(plated[0]), last = copperOrder.indexOf(plated.at(-1));
          if (first >= 0 && last >= 0) plated = copperOrder.slice(Math.min(first,last),Math.max(first,last)+1);
        }
        for (const copper of (plated.length ? plated : ["F.Cu","B.Cu"])) {
          push({ type:"circle", ...at, r:diameter/2, layer:copper, color:colorFor(copper), fill:true,
            uuid:uuid(node) || undefined, kind:"via",...netMeta(node) });
          if (drill > 0) push({ type:"circle", ...at, r:drill/2, layer:copper, color:"#111b25", fill:true,
            hole:true, uuid:uuid(node) || undefined, kind:"drill", objectCategory:"vias",...netMeta(node) });
        }
      } else if (["footprint","module"].includes(type)) {
        const origin = point(node,"at");
        if (!origin) { warn("Footprint without placement",node); continue; }
        const angle = rotation(node);
        // Saved KiCad footprint-local coordinates already encode a back-side
        // flip. Applying another mirror places pads on the wrong side.
        const transform = transformed(origin,angle);
        const properties = children(node,"property");
        const local=variableText?.fields(node)||{};
        for(const sub of children(node,"fp_text")){const name=String(value(sub[1]));if(name==='reference')local.Reference=String(value(sub[2])??'');if(name==='value')local.Value=String(value(sub[2])??'');}
        if(local.Reference!==undefined)local.REFERENCE=local.Reference;if(local.Value!==undefined)local.VALUE=local.Value;
        if(uuid(node))variableFields.set(uuid(node),local);
        const reference = local.Reference||"";
        const owner = { uuid:uuid(node), reference };
        const firstPrimitive = primitives.length;
        for (const sub of node.slice(1)) {
          if (!Array.isArray(sub)) continue;
          const subType = kind(sub), subLayer = String(field(sub,"layer") || layer);
          if (subType === "pad") pad(sub,owner,transform);
          else if (["fp_line","fp_arc","fp_rect","fp_circle","fp_poly","fp_text"].includes(subType)) drawShape(sub,subLayer,transform,owner);
          else if (subType === "property") drawShape(sub,subLayer,transform,owner);
        }
        const padPrimitives = primitives.slice(firstPrimitive).filter((part) => part.type === "pad");
        const coordinates = padPrimitives.flatMap((part) => part.points || (part.r ? [
          {x:part.x-part.r,y:part.y-part.r},{x:part.x+part.r,y:part.y+part.r}] : []));
        if (coordinates.length && owner.uuid) {
          const xs = coordinates.map((p) => p.x), ys = coordinates.map((p) => p.y),
            minX = Math.min(...xs)-.3, maxX = Math.max(...xs)+.3,
            minY = Math.min(...ys)-.3, maxY = Math.max(...ys)+.3;
          primitives.splice(firstPrimitive,0,{ type:"polygon", points:[{x:minX,y:minY},{x:maxX,y:minY},
            {x:maxX,y:maxY},{x:minX,y:maxY}], layer, color:"#000000", fill:false, stroke:false,
            pick:true, uuid:owner.uuid, ownerUuid:owner.uuid, reference, kind:"footprint-hit" });
        }
      } else if (type === "zone") {
        const filled = children(node,"filled_polygon");
        if (filled.length) {
          for (const region of filled) {
            const regionLayer = String(field(region,"layer") || layer), pts = points(region);
            if (pts.length >= 3) push({ type:"polygon", points:pts, layer:regionLayer, color:colorFor(regionLayer),
              fill:true, opacity:.22, uuid:uuid(node) || undefined, kind:"zone",...netMeta(node) });
          }
        } else {
          warn("Unfilled zone",node);
        }
        const outlineLayers=(child(node,'layers')||[]).slice(1).map(item=>String(value(item)));
        for(const polygon of children(node,'polygon')){const pts=points(polygon);if(pts.length<3)continue;
          for(const outlineLayer of outlineLayers.length?outlineLayers:[layer])push({type:'polygon',points:pts,layer:outlineLayer,color:colorFor(outlineLayer),fill:false,width:.15,uuid:uuid(node)||undefined,kind:'zone-outline',...netMeta(node)});
        }
      } else if (["gr_line","gr_arc","gr_rect","gr_circle","gr_poly","gr_text"].includes(type)) drawShape(node,layer);
      else if (["gr_curve","gr_text_box","gr_bitmap","dimension","target"].includes(type)) warn(type,node);
    }
    const priority = (item) => item.frame ? -100 : item.kind === "footprint-hit" ? -20 :
      item.kind === "zone" ? -10 : item.kind === "zone-outline" ? -9 :
      item.kind === "track" ? 0 : item.kind === "via" ? 1 : item.kind === "pad" ? 2 :
      item.kind === "drill" ? 3 : 0;
    primitives.sort((a,b) => priority(a)-priority(b));
    return { primitives, page, warnings, compatibility, layers:layerNames.length ? layerNames : [...new Set(primitives.map((item) => item.layer))], path };
  }
  root.KiCadPCBRenderer = { build, colorFor };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadPCBRenderer;
})(typeof globalThis === "object" ? globalThis : this);
