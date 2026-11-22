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
    const distances=new Map(),origins=new Map(),queue=[];
    function seed(node,position){
      if(!node)return;
      if(!distances.has(node.index)){distances.set(node.index,0);queue.push(node.index);}
      if(Number.isFinite(position?.x)&&Number.isFinite(position?.y))origins.set(node.index,position);
    }
    for(const selected of selectedIds||[]) {
      if(typeof selected==="string"){for(const node of nodesById.get(selected)||[])seed(node);}
      else if(selected?.instanceId)seed(lookup.get(key(selected.instanceId,selected.netId)),selected.position);
      else if(selected){for(const node of nodesById.get(selected.netId)||[])seed(node,selected.position);}
    }
    for(let i=0;i<queue.length;i++){
      const index=queue[i];
      for(const next of adjacency[index])if(!distances.has(next)){distances.set(next,distances.get(index)+1);queue.push(next);}
    }

    const labelKinds=new Set(['global_label','hierarchical_label','sheet_pin','label']);
    const finiteMember=member=>Number.isFinite(member.position?.x)&&Number.isFinite(member.position?.y);
    const port=(node,name,kind,sheetId)=>(node.net.members||[]).find(member=>
      member.name===name&&member.kind===kind&&(!sheetId||member.sheetId===sheetId));
    function direction(member){
      const type=member?.direction;
      if(type==='input'||type==='power_in')return 'input';
      if(type==='output'||type==='power_out'||type==='open_collector'||type==='open_emitter')return 'output';
      return null;
    }
    const pinDirections=new Map();
    function pinDirection(node){
      if(!pinDirections.has(node.index)){
        const evidence=new Set((node.net.members||[]).filter(member=>member.kind==='pin').map(direction).filter(Boolean));
        // Receivers can share a net with its driver on the same sheet.
        pinDirections.set(node.index,evidence.has('output')?'output':evidence.has('input')?'input':null);
      }
      return pinDirections.get(node.index);
    }
    function endpoint(node,name,kind,sheetId,selection){
      const members=node.net.members||[], saved=port(node,name,kind,sheetId);
      const representative=(saved&&finiteMember(saved)?saved:null)
        ||members.find(member=>finiteMember(member)&&member.name===name&&(!sheetId||member.sheetId===sheetId))
        ||members.find(member=>finiteMember(member)&&!labelKinds.has(member.kind));
      const position=selection||representative?.position;
      return {path:node.net.path,netId:node.net.id,instanceId:node.instanceId,position:position?{x:position.x,y:position.y}:null};
    }
    const reached=node=>distances.has(node.index);
    const distance=node=>distances.get(node.index);
    const links=[];
    for(const {a,b,name,anchors} of edges){
      if(!reached(a)||!reached(b)||anchors?.aKind==='global_label')continue;
      // Both sides of a sheet port describe direction relative to the child.
      const parentPort=direction(port(a,name,anchors?.aKind,anchors?.aSheetId));
      const childPort=direction(port(b,name,anchors?.bKind));
      const conflict=parentPort&&childPort&&parentPort!==childPort,portDirection=parentPort||childPort;
      const aPin=pinDirection(a),bPin=pinDirection(b);
      const signal=conflict?null:portDirection?(portDirection==='input'?'forward':'reverse')
        :aPin==='output'&&bPin==='input'?'forward':bPin==='output'&&aPin==='input'?'reverse':null;
      const reversed=signal?signal==='reverse':distance(b)<distance(a);
      const from=endpoint(a,name,anchors?.aKind,anchors?.aSheetId,!signal&&!reversed?origins.get(a.index):null);
      const to=endpoint(b,name,anchors?.bKind,null,!signal&&reversed?origins.get(b.index):null);
      links.push({name,from:reversed?to:from,to:reversed?from:to});
    }
    for(const [name,group] of globals){
      const candidates=group.filter(reached);
      if(candidates.length<2)continue;
      const labels=candidates.map(node=>direction(port(node,name,'global_label')));
      const labelDrivers=candidates.filter((_,i)=>labels[i]==='output');
      const pinDrivers=candidates.filter((node,i)=>!labels[i]&&pinDirection(node)==='output');
      const drivers=[...labelDrivers,...pinDrivers];
      const known=drivers.length===1?drivers[0]:null;
      const start=known||candidates.reduce((closest,node)=>distance(node)<distance(closest)?node:closest);
      const from=endpoint(start,name,'global_label',null,known?null:origins.get(start.index));
      for(const target of candidates)if(target!==start){
        links.push({name,from,to:endpoint(target,name,'global_label')});
        if(links.length>=MAX_EDGES){limits.push('Connectivity links reached the display limit.');break;}
      }
      if(links.length>=MAX_EDGES)break;
    }

    return {matches:nodes.filter(reached).map(({net,instanceId})=>({net,instanceId})),links,limits};

  }
  root.KiCadOverviewConnectivity={resolve};
  if(typeof module!=="undefined" && module.exports)module.exports=root.KiCadOverviewConnectivity;
})(typeof globalThis!=="undefined"?globalThis:this);
