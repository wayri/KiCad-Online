/* Saved-source connectivity, scoped to hierarchy instances rather than files. */
((root) => {
  "use strict";
  const MAX_PLACEMENTS=4096, MAX_NODES=100000, MAX_EDGES=200000, MAX_LABELS=300000;
  const key=(...parts)=>JSON.stringify(parts);
  function resolve(nets, selectedIds, placements) {
    const limits=[], empty=()=>({matches:[],links:[],limits});
    if (!Array.isArray(nets) || !Array.isArray(placements)) return empty();
    if (placements.length>MAX_PLACEMENTS) { limits.push("Too many sheet instances for connectivity (4096 maximum)."); return empty(); }
    const instances=new Map(), byPath=new Map();
    for(const p of placements) {
      if(!p || typeof p.id!=="string" || typeof p.path!=="string" || instances.has(p.id)) {
        limits.push("Invalid or duplicate sheet instance; connectivity cannot be resolved safely."); return empty();
      }
      instances.set(p.id,p);
      if(!byPath.has(p.path))byPath.set(p.path,[]);
      byPath.get(p.path).push(p);
    }
    // Broken ancestry cannot create a hierarchical connection. Global labels remain global.
    const valid=new Map();
    for(const p of placements) {
      if(valid.has(p.id))continue;
      const chain=[], seen=new Set(); let cursor=p, ok=true;
      while(cursor) {
        if(valid.has(cursor.id)) {ok=valid.get(cursor.id);break;}
        if(seen.has(cursor.id)) {ok=false;break;}
        seen.add(cursor.id);chain.push(cursor.id);
        if(cursor.unresolved){ok=false;break;}
        if(cursor.parentId==null)break;
        cursor=instances.get(cursor.parentId);
        if(!cursor){ok=false;break;}
      }
      for(const id of chain)valid.set(id,ok);
    }
    if([...valid.values()].includes(false))limits.push("Missing or cyclic sheet ancestry excluded from hierarchical connections.");
    const nodes=[], lookup=new Map(), globals=new Map(), pins=new Map(), childNames=new Map(), nodesByInstance=new Map(), nodesById=new Map();
    let labelCount=0;
    const append=(map,k,item)=> { if(!map.has(k))map.set(k,[]);map.get(k).push(item);labelCount++; };
    for(const net of nets) {
      if(net?.kind!=="schematic" || typeof net.id!=="string")continue;
      for(const instance of byPath.get(net.path)||[]) {
        const id=key(instance.id,net.id);
        if(lookup.has(id)) {limits.push("Duplicate net identity; connectivity cannot be resolved safely.");return empty();}
        const node={net,instanceId:instance.id,index:nodes.length};nodes.push(node);lookup.set(id,node);
        if(!nodesByInstance.has(instance.id))nodesByInstance.set(instance.id,[]);
        nodesByInstance.get(instance.id).push(node);
        if(!nodesById.has(net.id))nodesById.set(net.id,[]);
        nodesById.get(net.id).push(node);
        if(nodes.length>MAX_NODES) {limits.push("Too many instance nets for connectivity (100000 maximum).");return empty();}
        for(const name of new Set(net.globalNames||[]))if(typeof name==="string" && name)append(globals,name,node);
        if(valid.get(instance.id)) {
          for(const pin of net.sheetPins||[])if(pin.sheetId && typeof pin.name==="string" && pin.name)
            append(pins,key(instance.id,pin.sheetId,pin.name),node);
          for(const name of new Set(net.hierarchicalNames||[]))if(typeof name==="string" && name)
            append(childNames,key(instance.id,name),node);
        }
        if(labelCount>MAX_LABELS) {limits.push("Too many connectivity labels (300000 maximum).");return empty();}
      }
    }
    const adjacency=nodes.map(()=>[]), edges=[], edgeKeys=new Set();
    const connect=(a,b,name,anchors=null)=> {
      if(a===b || edges.length>MAX_EDGES)return;
      const pair=key(Math.min(a.index,b.index),Math.max(a.index,b.index),name);
      if(edgeKeys.has(pair))return;
      edgeKeys.add(pair);edges.push({name,a,b,anchors});adjacency[a.index].push(b.index);adjacency[b.index].push(a.index);
    };
    // Stars retain complete reachability without quadratic global-label edges.
    for(const [name,list] of globals)for(let i=1;i<list.length;i++)connect(list[0],list[i],name,{aKind:'global_label',bKind:'global_label'});
    for(const p of placements) {
      if(p.parentId==null || !valid.get(p.id))continue;
      const expanded=new Set();
      for(const net of nodesByInstance.get(p.id)||[])for(const name of new Set(net.net.hierarchicalNames||[])) {
        if(expanded.has(name))continue;expanded.add(name);
        const parents=pins.get(key(p.parentId,p.sheetId,name))||[];
        const children=childNames.get(key(p.id,name))||[];
        if(!parents.length || !children.length)continue;
        for(const a of parents)connect(a,children[0],name,{aKind:'sheet_pin',aSheetId:p.sheetId,bKind:'hierarchical_label'});
        for(let i=1;i<children.length;i++)connect(parents[0],children[i],name,{aKind:'sheet_pin',aSheetId:p.sheetId,bKind:'hierarchical_label'});
      }
      if(edges.length>MAX_EDGES)break;
    }
    if(edges.length>MAX_EDGES) {limits.push("Too many connectivity links (200000 maximum).");return empty();}
    const reached=new Set(), queue=[];
    const seed=n=> {if(n && !reached.has(n.index)){reached.add(n.index);queue.push(n.index);}};
    for(const selected of selectedIds||[]) {
      if(typeof selected==="string") {for(const n of nodesById.get(selected)||[])seed(n);}
      else if(selected && typeof selected.netId==="string")seed(lookup.get(key(selected.instanceId,selected.netId)));
    }
    for(let i=0;i<queue.length;i++)for(const next of adjacency[queue[i]])if(!reached.has(next)){reached.add(next);queue.push(next);}
    const endpoint=(n,name,kind,sheetId)=> {
      const members=(n.net.members||[]).filter(m=>Number.isFinite(m.position?.x)&&Number.isFinite(m.position?.y));
      const member=members.find(m=>m.name===name&&m.kind===kind&&(!sheetId||m.sheetId===sheetId)) || members.find(m=>m.name===name&&(!sheetId||m.sheetId===sheetId)) || members.find(m=>!['global_label','hierarchical_label','sheet_pin','label'].includes(m.kind)) || members.find(m=>!m.name);
      const p=member?.position;
      return {path:n.net.path,netId:n.net.id,instanceId:n.instanceId,position:p && Number.isFinite(p.x) && Number.isFinite(p.y)?{x:p.x,y:p.y}:null};
    };
    return {matches:nodes.filter(n=>reached.has(n.index)).map(({net,instanceId})=>({net,instanceId})),
      links:edges.filter(e=>reached.has(e.a.index)&&reached.has(e.b.index)).map(e=>({name:e.name,from:endpoint(e.a,e.name,e.anchors?.aKind,e.anchors?.aSheetId),to:endpoint(e.b,e.name,e.anchors?.bKind,e.anchors?.bSheetId)})),limits};
  }
  root.KiCadOverviewConnectivity={resolve};
  if(typeof module!=="undefined" && module.exports)module.exports=root.KiCadOverviewConnectivity;
})(typeof globalThis!=="undefined"?globalThis:this);
