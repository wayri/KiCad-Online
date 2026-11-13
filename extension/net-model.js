/* Read-only saved PCB nets and per-file schematic source connectivity, in mm. */
((root) => {
  "use strict";
  const diff = root.KiCadDesignDiff || (typeof require === "function" ? require("./design-diff.js") : null);
  const value = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kind = (node) => Array.isArray(node) ? String(value(node[0])) : "";
  const children = (node, name) => Array.isArray(node) ? node.filter((part) => kind(part) === name) : [];
  const child = (node, name) => children(node, name)[0];
  const field = (node, name) => value(child(node, name)?.[1]);
  const point = (node, name) => {
    const entry = child(node, name);
    return entry && Number.isFinite(value(entry[1])) && Number.isFinite(value(entry[2]))
      ? { x:value(entry[1]), y:value(entry[2]) } : null;
  };
  const validPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const distance = (a, b) => Math.hypot(b.x-a.x, b.y-a.y);
  const EPS = 1e-7; // Sub-nanometre serialization tolerance, not a proximity connection.
  const LABELS = new Set(["label", "global_label", "hierarchical_label"]);
  const fresh = (path, code, name, type) => ({ id:`${path}/net:${code}`, path, code, name, displayName:name, kind:type,
    objectIds:[], uuids:[], primitives:[], stats:{ pads:0, tracks:0, vias:0, zones:0, lengthMm:0 }, members:[] });
  function displayName(net) {
    if(typeof net?.displayName==='string' && net.displayName)return net.displayName;
    // Older prepared models may contain a source UUID in their unnamed fallback.
    if(net?.kind==='schematic' && /^Unnamed network \(/.test(net.name||''))return 'Unnamed network';
    return typeof net?.name==='string' && net.name ? net.name : 'Unnamed network';
  }
  function arcLength(node) {
    const a = point(node,"start"), b = point(node,"mid"), c = point(node,"end");
    if (!a || !b || !c) return null;
    // Translate to start to avoid precision loss for far-from-origin designs.
    const bx=b.x-a.x, by=b.y-a.y, cx=c.x-a.x, cy=c.y-a.y;
    const determinant=2*(bx*cy-by*cx);
    if (Math.abs(determinant) <= 1e-12 * Math.max(1,bx*bx+by*by,cx*cx+cy*cy)) return null;
    const bb=bx*bx+by*by, cc=cx*cx+cy*cy;
    const ox=(cy*bb-by*cc)/determinant, oy=(bx*cc-cx*bb)/determinant;
    const angle=(x,y)=>Math.atan2(y-oy,x-ox), turn=2*Math.PI;
    const positive=(r)=>(r%turn+turn)%turn;
    const start=angle(0,0), through=positive(angle(bx,by)-start), end=positive(angle(cx,cy)-start);
    const sweep=through <= end+1e-12 ? end : turn-end;
    return Math.hypot(ox,oy)*sweep;
  }
  function pcb(path, ast, records, primitives, warn) {
    const nets=new Map(), names=new Map();
    const modernNamedNets=Number(field(ast,'version'))>=20260206;
    const codeOf=(form)=> {
      const raw=value(form?.[1]);
      if(modernNamedNets&&typeof raw==='string'&&raw&&form.length===2)return `name:${raw}`;
      return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null;
    };
    const declare=(form)=> {
      const code=codeOf(form), name=code?.startsWith('name:')?value(form?.[1]):value(form?.[2]);
      if (!code || code === "0" || typeof name !== "string" || !name) return;
      if (names.has(code) && names.get(code) !== name) warn(`${path}: net code ${code} has conflicting saved names; using ${names.get(code)}.`);
      else names.set(code,name);
    };
    children(ast,"net").forEach(declare);
    for (const record of records) declare(child(record.form,"net"));
    const ensure=(code)=> {
      if (!nets.has(code)) nets.set(code,fresh(path,code,names.get(code) || `Net ${code} (name unavailable)`,"pcb"));
      return nets.get(code);
    };
    names.forEach((_,code)=>ensure(code));
    const byUuid=new Map(), padPrimitives=new Map(), footprints=new Map(records.filter((r)=>r.kind === "footprint").map((r)=>[r.key,r]));
    for (const p of primitives) if (p.uuid) {
      if (!byUuid.has(p.uuid)) byUuid.set(p.uuid,[]);
      byUuid.get(p.uuid).push(p);
      if (p.kind === "pad" && p.ownerUuid && p.name != null) {
        const key=JSON.stringify([p.ownerUuid,String(p.name)]);
        if (!padPrimitives.has(key)) padPrimitives.set(key,[]);
        padPrimitives.get(key).push(p);
      }
    }
    for (const record of records) {
      if (!["pad","segment","arc","via","zone"].includes(record.kind)) continue;
      const declaration=child(record.form,"net");
      if (!declaration) continue;
      const code=codeOf(declaration);
      if (code === "0") continue;
      if (code === null) { warn(`${path}: ${record.label} has an unsupported net code and was excluded.`); continue; }
      if (!names.has(code)) warn(`${path}: net code ${code} has no saved name declaration.`);
      const net=ensure(code), uuid=record.metadata.uuid;
      net.objectIds.push(record.id || record.key);
      if (uuid) net.uuids.push(uuid);
      // Pad primitives may have the footprint UUID only in older files. Never
      // highlight the entire footprint or a different pad sharing that owner.
      const parent=record.kind === "pad" ? footprints.get(record.key.slice(0,record.key.lastIndexOf("/pad:"))) : null;
      const candidates=uuid ? byUuid.get(uuid) || [] : parent ? padPrimitives.get(JSON.stringify([
        parent.metadata.uuid,String(value(record.form[1]))])) || [] : [];
      net.primitives.push(...candidates.filter((p)=> record.kind === "pad" ? p.kind === "pad" || p.kind === "drill" :
        record.kind === "zone" ? ["zone","zone-outline"].includes(p.kind) :
          record.kind === "segment" ? p.kind === "track" : record.kind === "arc" ? p.kind === "arc" || p.kind === "track" :
            p.kind === "via" || p.kind === "drill"));
      net.members.push({uuid, reference:parent?.metadata.properties.Reference || "", pad:record.kind === "pad" ? String(value(record.form[1])) : "",
        kind:record.kind, position:record.metadata.position});
      const stat=({pad:"pads",segment:"tracks",arc:"tracks",via:"vias",zone:"zones"})[record.kind];
      net.stats[stat]++;
      if (record.kind === "segment") {
        const a=point(record.form,"start"), b=point(record.form,"end");
        if (a && b) net.stats.lengthMm+=distance(a,b);
        else warn(`${path}: track ${uuid || record.label} has incomplete geometry; length omitted.`);
      } else if (record.kind === "arc") {
        const length=arcLength(record.form);
        if (length !== null) net.stats.lengthMm+=length;
        else warn(`${path}: arc ${uuid || record.label} has unsupported or degenerate geometry; length omitted.`);
      }
    }
    return [...nets.values()];
  }
  function onSegment(p, edge) {
    const {a,b}=edge, dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
    if (!length) return distance(a,p)<=EPS;
    return Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)<=EPS*length &&
      p.x>=Math.min(a.x,b.x)-EPS && p.x<=Math.max(a.x,b.x)+EPS &&
      p.y>=Math.min(a.y,b.y)-EPS && p.y<=Math.max(a.y,b.y)+EPS;
  }
  // Balanced bounding-box index: attachment queries avoid scanning every wire.
  function spatialIndex(edges, depth=0) {
    if (!edges.length) return null;
    const minX=Math.min(...edges.map((e)=>Math.min(e.a.x,e.b.x))), maxX=Math.max(...edges.map((e)=>Math.max(e.a.x,e.b.x)));
    const minY=Math.min(...edges.map((e)=>Math.min(e.a.y,e.b.y))), maxY=Math.max(...edges.map((e)=>Math.max(e.a.y,e.b.y)));
    if (edges.length<=16) return {minX,maxX,minY,maxY,edges};
    const axis=depth%2 ? "y" : "x";
    edges.sort((a,b)=>(a.a[axis]+a.b[axis])-(b.a[axis]+b.b[axis]));
    const middle=Math.floor(edges.length/2);
    return {minX,maxX,minY,maxY,left:spatialIndex(edges.slice(0,middle),depth+1),right:spatialIndex(edges.slice(middle),depth+1)};
  }
  function schematic(path, ast, records, primitives, warn) {
    warn(`${path}: schematic nets show per-file source connectivity only; cross-sheet hierarchy, implicit hidden power pins and bus expansion are not resolved. This is not a KiCad netlist.`);
    const entries=[], edges=[], anchors=[];
    const add=(entry)=> {entry.index=entries.length; entries.push(entry); return entry;};
    for (const record of records) {
      if (record.kind === "wire") {
        const pts=children(child(record.form,"pts"),"xy").map((xy)=>({x:value(xy[1]),y:value(xy[2])}));
        if (pts.length<2 || !pts.every(validPoint)) {warn(`${path}: wire with invalid geometry was excluded.`); continue;}
        const entry=add({record,kind:"wire",position:pts[0],length:0});
        for (let i=1;i<pts.length;i++) {edges.push({a:pts[i-1],b:pts[i],index:entry.index}); entry.length+=distance(pts[i-1],pts[i]);}
        for (const p of pts) anchors.push({p,index:entry.index,endpoint:true});
      } else if (record.kind === "sheet") {
        for (const pin of children(record.form,"pin")) {
          const p=point(pin,"at"), name=value(pin[1]);
          if (!p || typeof name!=="string" || !name) continue;
          const pinUuid=field(pin,"uuid"), sheetId=record.metadata.uuid || record.id || record.key;
          const pinRecord={...record,id:`${record.id || record.key}/pin:${pinUuid || name}`,metadata:{...record.metadata,uuid:pinUuid}};
          const entry=add({record:pinRecord,kind:"sheet_pin",position:p,sheetPin:{sheetId,name}});
          anchors.push({p,index:entry.index});
        }
      } else if (LABELS.has(record.kind) || record.kind === "junction") {
        const p=point(record.form,"at");
        if (!p) continue;
        const entry=add({record,kind:record.kind,position:p,name:LABELS.has(record.kind) ? String(value(record.form[1])) : null,
          namePriority:({global_label:0,label:2,hierarchical_label:3})[record.kind]});
        anchors.push({p,index:entry.index,junction:record.kind === "junction"});
      }
    }
    const symbols=new Map(records.filter((r)=>r.kind === "symbol" && r.metadata.uuid).map((r)=>[r.metadata.uuid,r]));
    const definitions=new Map(children(child(ast,"lib_symbols"),"symbol").map((s)=>[String(value(s[1])),s]));
    const powerSymbols=new Map(), powerFlags=new Set(), version=Number(field(ast,"version"));
    for (const [uuid, record] of symbols) {
      const definition=definitions.get(String(field(record.form,"lib_id"))), power=child(definition,"power");
      if (!power) continue; // Names and #PWR reference conventions are not electrical evidence.
      const scope=value(power[1]);
      if (scope !== undefined && !["global","local"].includes(scope)) {
        warn(`${path}: unsupported explicit power-symbol scope ${scope}; naming omitted.`); continue;
      }
      const libraryPins=children(definition,"symbol").flatMap((body)=>children(body,"pin"));
      if (libraryPins.length===1 && value(libraryPins[0][1])==="power_out") {powerFlags.add(uuid);continue;} // ERC power flag, not a net-name source.
      if (libraryPins.length!==1 || value(libraryPins[0][1])!=="power_in") {
        warn(`${path}: explicit power symbol ${record.label} is not a supported single power-input pin; naming omitted.`);continue;
      }
      const pin=libraryPins[0], pinNumber=String(field(pin,"number") ?? "");
      let name;
      // KiCad 8 (20231120 schematic schema) changed explicit power-symbol net
      // naming to the placed Value. KiCad 7 and earlier used the hidden pin name.
      // https://docs.kicad.org/9.0/en/eeschema/eeschema.html#power-symbols
      if (Number.isSafeInteger(version) && version>=20231120) name=record.metadata.properties.Value;
      else if (Number.isSafeInteger(version) && version>0 && version<=20230121 &&
        (child(pin,"hide") || pin.some((part)=>value(part)==="hide"))) name=field(pin,"name");
      else {warn(`${path}: power symbol ${record.label} has an unproven schematic version; naming omitted.`);continue;}
      if (typeof name!=="string" || !name || name==="~") {
        warn(`${path}: power symbol ${record.label} has no usable saved net name; naming omitted.`);continue;
      }
      powerSymbols.set(uuid,{name,pinNumber,global:scope !== "local"});
    }
    const pins=new Map();
    for (const p of primitives) if (p.kind === "pin" && validPoint(p.connectPoint) && p.pinNumber != null) {
      const owner=p.ownerUuid || p.uuid, record=symbols.get(owner);
      if (!record) continue;
      const key=JSON.stringify([owner,String(p.pinNumber),p.connectPoint.x,p.connectPoint.y]);
      if (pins.has(key)) {pins.get(key).primitives.push(p); continue;}
      const power=powerSymbols.get(owner), isPower=power && power.pinNumber===String(p.pinNumber);
      const entry=add({record,kind:"pin",position:p.connectPoint,pin:String(p.pinNumber),primitives:[p],
        name:isPower ? power.name : null,namePriority:isPower ? 1 : undefined,power:!!isPower,flag:powerFlags.has(owner),global:!!(isPower && power.global)});
      pins.set(key,entry); anchors.push({p:p.connectPoint,index:entry.index});
    }
    if (symbols.size && !pins.size) warn(`${path}: no conductive pin metadata is available; symbol pin membership was omitted.`);
    if (entries.length>30000 || edges.length>30000) {warn(`${path}: schematic connectivity exceeds the 30000-object limit and was omitted.`); return [];}
    const parent=entries.map((_,i)=>i), rank=entries.map(()=>0);
    const find=(i)=> {let n=i; while(parent[n]!==n) n=parent[n]; while(parent[i]!==i) {const next=parent[i];parent[i]=n;i=next;} return n;};
    const join=(a,b)=> {a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++;};
    const index=spatialIndex(edges.slice()), exact=new Map();
    const coordinate=(p)=>JSON.stringify([p.x,p.y]);
    // Exact common points join pins, labels, junctions and wire endpoints.
    for (const anchor of anchors) {
      const key=coordinate(anchor.p);
      if (exact.has(key)) join(anchor.index,exact.get(key)); else exact.set(key,anchor.index);
    }
    let checks=0;
    const query=(tree,p,hits)=> {
      if (!tree || p.x<tree.minX-EPS || p.x>tree.maxX+EPS || p.y<tree.minY-EPS || p.y>tree.maxY+EPS) return;
      if (tree.edges) for (const edge of tree.edges) {
        if (++checks>2000000) throw new Error("attachment limit");
        if (onSegment(p,edge)) hits.add(edge.index);
      } else {query(tree.left,p,hits);query(tree.right,p,hits);}
    };
    try {
      // Endpoints and explicit junctions make T connections and real crossings.
      for (const anchor of anchors.filter((a)=>a.endpoint || a.junction)) {
        const hits=new Set();query(index,anchor.p,hits);for(const hit of hits)join(anchor.index,hit);
      }
      for (const anchor of anchors.filter((a)=>!a.endpoint && !a.junction)) {
        const hits=new Set();query(index,anchor.p,hits);
        if (new Set([...hits].map(find)).size>1) {warn(`${path}: ambiguous label/pin at a wire crossing without a junction was not attached.`);continue;}
        for(const hit of hits)join(anchor.index,hit);
      }
    } catch {warn(`${path}: schematic connectivity exceeds the attachment-work limit and was omitted.`);return [];}
    const labels=new Map();
    for (const entry of entries) if (entry.name) {
      if (labels.has(entry.name)) join(entry.index,labels.get(entry.name));else labels.set(entry.name,entry.index);
    }
    const groups=new Map();
    for (const entry of entries) {const key=find(entry.index);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
    const byUuid=new Map();
    for (const p of primitives) for(const id of new Set([p.uuid,p.pinUuid].filter(Boolean))) {if(!byUuid.has(id))byUuid.set(id,[]);byUuid.get(id).push(p);}
    const nets=[];
    for (const group of groups.values()) {
      if (!group.some((e)=>e.kind === "wire" || e.name || e.sheetPin)) continue; // Isolated pins/junctions are not inferred nets.
      const names=[...new Set(group.map((e)=>e.name).filter(Boolean))].sort();
      const preferred=group.filter((e)=>e.name).sort((a,b)=>(a.namePriority ?? 4)-(b.namePriority ?? 4)||a.name.localeCompare(b.name))[0]?.name;
      const first=group.filter((e)=>e.kind === "wire" || e.sheetPin).map((e)=>e.record.id || e.record.key).sort()[0], code=names.length ? `label:${names[0]}` : `source:${first}`;
      const net=fresh(path,code,preferred || `Unnamed network (${group.find((e)=>e.kind === "wire")?.record.metadata.uuid || "wire"})`,"schematic");
      // Sheet-pin text is useful for display but is not a global/local label:
      // never merge different child-sheet ports solely because their names match.
      const sheetNames=[...new Set(group.map(e=>e.sheetPin?.name).filter(Boolean))].sort();
      const connections=[...new Set(group.filter(e=>e.kind==='pin' && e.record.metadata.properties.Reference)
        .map(e=>`${e.record.metadata.properties.Reference} pin ${e.pin}`))].sort();
      net.displayName=preferred || (sheetNames.length?sheetNames.join(' / '):
        'Unnamed network'+(connections.length?' · '+connections.slice(0,2).join(', ')+(connections.length>2?' …':''):''));
      net.scope="file";net.names=names;
      net.globalNames=[...new Set(group.filter((e)=>e.kind === "global_label" || e.global).map((e)=>e.name).filter(Boolean))].sort();
      net.hierarchicalNames=[...new Set(group.filter((e)=>e.kind === "hierarchical_label").map((e)=>e.name))].sort();
      net.sheetPins=group.filter((e)=>e.sheetPin).map((e)=>({...e.sheetPin}));
      if (names.length>1) warn(`${path}: connected schematic source network has multiple labels: ${names.join(", ")}.`);
      for (const entry of group) {
        const r=entry.record, uuid=r.metadata.uuid;
        net.objectIds.push(r.id || r.key);if(uuid)net.uuids.push(uuid);
        net.primitives.push(...((entry.power||entry.flag) ? (byUuid.get(uuid) || []).filter((p)=>!p.frame) : entry.kind === "pin" ? entry.primitives :
          (byUuid.get(uuid) || []).filter((p)=>p.kind === entry.kind || entry.kind==="sheet_pin"&&p.kind==="sheet-pin")));
        net.members.push({uuid,reference:entry.kind === "pin" ? r.metadata.properties.Reference || "" : "",
          pad:"",pin:entry.pin || "",kind:entry.kind,position:entry.position,...((entry.name||entry.sheetPin?.name)?{name:entry.name||entry.sheetPin.name}:{}),...(entry.sheetPin?{sheetId:entry.sheetPin.sheetId}:{})});
        net.stats.lengthMm+=entry.length || 0;
      }
      nets.push(net);
    }
    return nets;
  }
  function build(files, designs=new Map(), snapshot=null) {
    if (!diff?.projectObjects || !diff?.parse) throw new Error("KiCadDesignDiff is required for net extraction.");
    const parsedFiles=new Map(),rawRecords=diff.projectObjects(files,(file,ast)=>parsedFiles.set(file.path,ast),snapshot), counts=new Map(), recordsByPath=new Map();
    // Keep duplicate saved object IDs aligned with the design-model convention.
    for (const record of rawRecords) {
      if(!recordsByPath.has(record.path))recordsByPath.set(record.path,[]);
      recordsByPath.get(record.path).push(record);
      const count=(counts.get(record.key)||0)+1;counts.set(record.key,count);record.id=count===1 ? record.key : `${record.key}#${count}`;}
    const nets=[], warnings=[], seenWarnings=new Set();
    const warn=(message)=> {if(warnings.length<1000 && !seenWarnings.has(message)){seenWarnings.add(message);warnings.push(message);}};
    for (const file of files) {
      const ast=parsedFiles.get(file.path), records=recordsByPath.get(file.path) || [];
      const design=designs instanceof Map ? designs.get(file.path) : designs?.[file.path];
      const primitives=Array.isArray(design?.primitives) ? design.primitives : [];
      if (primitives.length>250000) throw new Error("Too many render primitives for net selection.");
      nets.push(...(kind(ast)==="kicad_pcb" ? pcb(file.path,ast,records,primitives,warn) : schematic(file.path,ast,records,primitives,warn)));
    }
    for (const net of nets) {net.objectIds=[...new Set(net.objectIds)];net.uuids=[...new Set(net.uuids)];net.primitives=[...new Set(net.primitives)];}
    nets.sort((a,b)=>a.path.localeCompare(b.path)||a.name.localeCompare(b.name)||a.code.localeCompare(b.code));
    return {nets,warnings};
  }
  // Only loaded files from one schematic project should be supplied. Local
  // names are never cross-sheet evidence, even when a global name matches them.
  function relatedSchematicNets(nets, selectedId, hierarchy=[]) {
    const limits=["Only loaded schematic files are searched.",
      "Only unambiguous resolved sheet links are searched; cyclic hierarchy, repeated sheet instances, implicit hidden power pins and buses are not resolved; this is not a KiCad netlist."];
    const selected=nets.find((net)=>net.id===selectedId && net.kind==="schematic");
    if (!selected) return {matches:[],paths:[],limits};
    if(!hierarchy.length && !selected.globalNames?.length)return {matches:[selected],paths:[selected.path],limits};
    const byName=new Map(), parentPins=new Map(), childNames=new Map();
    const append=(map,key,item)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(item);};
    const key=(...parts)=>JSON.stringify(parts);
    for (const net of nets) if(net.kind==="schematic") {
      for(const name of net.globalNames || [])append(byName,name,net);
      for(const pin of hierarchy.length ? net.sheetPins || [] : [])append(parentPins,key(net.path,pin.sheetId),{net,name:pin.name});
      for(const name of hierarchy.length ? net.hierarchicalNames || [] : [])append(childNames,key(net.path,name),net);
    }
    const links=[...new Map(hierarchy.map((link)=>[key(link.path,link.target,link.sheetId),link])).values()];
    const targetCounts=new Map(), outgoing=new Map();
    for(const link of links) {
      targetCounts.set(link.target,(targetCounts.get(link.target)||0)+1);
      append(outgoing,link.path,link.target);
    }
    const adjacent=new Map(),connect=(a,b)=> {
      append(adjacent,a.id,b);append(adjacent,b.id,a);
    };
    // Index edges once; memoize descendant queries instead of repeatedly
    // scanning every hierarchy link for every visited sheet.
    const descendants=new Map();
    const reachable=(start)=> {
      if(descendants.has(start))return descendants.get(start);
      const pending=[start],seen=new Set();
      for(let i=0;i<pending.length;i++) {
        const path=pending[i];if(seen.has(path))continue;seen.add(path);
        for(const target of outgoing.get(path)||[])pending.push(target);
      }
      descendants.set(start,seen);return seen;
    };
    const ambiguous=new Set();
    for(const [path,count] of targetCounts)if(count>1)
      for(const descendant of reachable(path))ambiguous.add(descendant);
    for(const link of links) if(targetCounts.get(link.target)===1 && !ambiguous.has(link.path) && !reachable(link.target).has(link.path)) {
      for(const parent of parentPins.get(key(link.path,link.sheetId)) || [])
        for(const childNet of childNames.get(key(link.target,parent.name)) || [])connect(parent.net,childNet);
    }
    const found=new Map([[selected.id,selected]]),queue=[selected],expandedNames=new Set();
    for(let i=0;i<queue.length;i++) {
      const candidates=[...(adjacent.get(queue[i].id)||[])];
      for(const name of queue[i].globalNames || [])if(!expandedNames.has(name)) {
        expandedNames.add(name);candidates.push(...(byName.get(name)||[]));
      }
      for(const net of candidates)if(!found.has(net.id)){found.set(net.id,net);queue.push(net);}
    }
    const matches=[...found.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.id.localeCompare(b.id));
    return {matches,paths:[...new Set(matches.map((net)=>net.path))],limits};
  }
  function createBuilder() {
    // Workspace-owned connectivity snapshots. No global AST retention: changing
    // one rendered sheet rebuilds that sheet rather than reparsing the project.
    const cache=new Map(), encoder=new TextEncoder();
    let primitiveIds=new WeakMap(), nextPrimitiveId=0;
    const CACHE_LIMIT=96*1024*1024;
    function primitiveSignature(primitives) {
      if(primitives.length>250000)throw new Error("Too many render primitives for net selection.");
      const chunks=[];let chars=0;
      for(const p of primitives) {
        let entry;
        if(!p||typeof p!=="object")entry=[typeof p,String(p)];
        else {
        if(!primitiveIds.has(p))primitiveIds.set(p,++nextPrimitiveId);
          entry=[primitiveIds.get(p),p.kind,p.uuid,p.ownerUuid,p.name,p.pinNumber,p.connectPoint?.x,p.connectPoint?.y,Boolean(p.frame)];
        }
        const chunk=JSON.stringify(entry);chars+=chunk.length+1;
        if(chars>4*1024*1024)return null; // Large render metadata is processed without caching.
        chunks.push(chunk);
      }
      return '['+chunks.join(',')+']';
    }
    function cloneNet(net) {
      return {...net,objectIds:[...net.objectIds],uuids:[...net.uuids],primitives:[...net.primitives],stats:{...net.stats},
        members:net.members.map(member=>({...member,...(member.position?{position:{...member.position}}:{})})),...(net.names?{names:[...net.names]}:{}),...(net.globalNames?{globalNames:[...net.globalNames]}:{}),...(net.hierarchicalNames?{hierarchicalNames:[...net.hierarchicalNames]}:{}),...(net.sheetPins?{sheetPins:net.sheetPins.map(pin=>({...pin}))}:{})};
    }
    function cachedBuild(files,designs=new Map()) {
      // Use the source parser's current file-count contract without parsing its
      // sources just to validate the cache. Each changed file uses build below.
      if(!Array.isArray(files)||files.length>(diff.MAX_FILES||128))throw new Error("Too many KiCad files to compare.");
      const paths=new Set(), inputs=[];let sourceBytes=0;
      for(const file of files) {
        if(!file||typeof file.path!=="string"||typeof file.content!=="string"||!/(?:\.kicad_(?:sch|pcb)|\.(?:sch|brd))$/i.test(file.path)||paths.has(file.path))throw new Error("Invalid or duplicate KiCad file entry.");
        paths.add(file.path);
        const previous=cache.get(file.path),size=previous?.content===file.content?previous.sourceBytes:encoder.encode(file.content).length;
        sourceBytes+=size;
        if(size>(/\.kicad_pcb$/i.test(file.path)?64:8)*1024*1024||sourceBytes>CACHE_LIMIT)throw new Error("KiCad project exceeds browser comparison size limits.");
        const design=designs instanceof Map?designs.get(file.path):designs?.[file.path],primitives=Array.isArray(design?.primitives)?design.primitives:[];
        if(primitives.length>250000)throw new Error("Too many render primitives for net selection.");
        inputs.push({file,sourceBytes:size,primitives,design});
      }
      for(const path of cache.keys())if(!paths.has(path))cache.delete(path);
      const nets=[],warnings=[],seenWarnings=new Set();let retainedBytes=0;
      for(const input of inputs) {
        const {file,primitives,design}=input,signature=primitiveSignature(primitives),previous=cache.get(file.path);
        let snapshot;
        if(signature!==null&&previous?.content===file.content&&previous.signature===signature)snapshot=previous.snapshot;
        else snapshot=build([file],new Map([[file.path,design]]));
        const bytes=input.sourceBytes+(signature===null?Infinity:signature.length*2);
        if(retainedBytes+bytes<=CACHE_LIMIT) {
          cache.set(file.path,{content:file.content,sourceBytes:input.sourceBytes,signature,snapshot});retainedBytes+=bytes;
        }else cache.delete(file.path);
        nets.push(...snapshot.nets.map(cloneNet));
        for(const warning of snapshot.warnings)if(warnings.length<1000&&!seenWarnings.has(warning)){seenWarnings.add(warning);warnings.push(warning);}
      }
      nets.sort((a,b)=>a.path.localeCompare(b.path)||a.name.localeCompare(b.name)||a.code.localeCompare(b.code));
      return {nets,warnings};
    }
    function clear(){cache.clear();primitiveIds=new WeakMap();nextPrimitiveId=0;}
    return {build:cachedBuild,clear};
  }
  root.KiCadNetModel={build,createBuilder,relatedSchematicNets,displayName};
  if(typeof module === "object" && module.exports)module.exports=root.KiCadNetModel;
})(typeof globalThis === "object" ? globalThis : this);
