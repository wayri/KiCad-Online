/* Shared read-only repository files, branches and parent-bound commit graph. */
((root)=>{'use strict';
 const SHA=/^[a-f0-9]{40,64}$/i,COLORS=['#69b9f8','#bc94ef','#58c7a2','#e8b55e','#ee8d9d','#69cad7'];
 const pathOK=path=>typeof path==='string'&&path.length<=2048&&!/^[\/]|[\\\x00-\x1f\x7f]/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');
 function fileKind(entry){if(String(entry.mode)==='120000')return'symlink';if(entry.type==='tree')return'folder';if(entry.type==='commit')return'submodule';const p=entry.path.toLowerCase();return /\.kicad_sch$/.test(p)?'schematic':/\.kicad_pcb$/.test(p)?'layout':/\.(step|stp|wrl|vrml|glb)$/.test(p)?'model':/\.(kicad_pro|kicad_dru|kicad_wks)$/.test(p)?'project':'source';}
 function treeRows(entries,expanded,query=''){
  const nodes=new Map();for(const entry of entries||[]){if(!pathOK(entry.path))continue;const parts=entry.path.split('/');for(let i=1;i<parts.length;i++){const path=parts.slice(0,i).join('/');if(!nodes.has(path))nodes.set(path,{path,type:'tree'});}nodes.set(entry.path,entry);}
  const byFolder=new Map();for(const entry of nodes.values()){const parent=entry.path.includes('/')?entry.path.slice(0,entry.path.lastIndexOf('/')):'';if(!byFolder.has(parent))byFolder.set(parent,[]);byFolder.get(parent).push(entry);}
  for(const list of byFolder.values())list.sort((a,b)=>(a.type==='tree'?0:1)-(b.type==='tree'?0:1)||a.path.localeCompare(b.path));
  const needle=query.trim().toLowerCase(),matches=new Set();if(needle)for(const entry of nodes.values())if(entry.path.toLowerCase().includes(needle)){matches.add(entry.path);const parts=entry.path.split('/');for(let i=1;i<parts.length;i++)matches.add(parts.slice(0,i).join('/'));}
  const result=[];function visit(folder,depth){for(const entry of byFolder.get(folder)||[]){if(needle&&!matches.has(entry.path))continue;result.push({...entry,depth,kind:fileKind(entry)});if(entry.type==='tree'&&(needle||expanded.has(entry.path)))visit(entry.path,depth+1);}}
  visit('',0);return result;
 }
 function graphRows(commits){
  const positions=new Map(commits.map((c,i)=>[c.sha,i]));let lanes=[],color=0;const rows=[];
  for(const [index,commit]of commits.entries()){
   let lane=lanes.findIndex(v=>v.sha===commit.sha);if(lane<0){lane=lanes.length;lanes.push({sha:commit.sha,color:COLORS[color++%COLORS.length]});}
   const before=lanes.slice(),own=before[lane],parents=[...new Set((commit.parents||[]).filter(p=>SHA.test(p)))],earlier=parents.filter(p=>positions.has(p)&&positions.get(p)<=index),forward=parents.filter(p=>!earlier.includes(p));
   const next=before.filter((_,i)=>i!==lane);
   for(const [i,sha]of forward.entries())if(!next.some(v=>v.sha===sha))next.splice(Math.min(lane+i,next.length),0,{sha,color:i===0?own.color:COLORS[color++%COLORS.length]});
   const segments=[];for(const [i,item]of before.entries())if(i!==lane){const to=next.findIndex(v=>v.sha===item.sha);if(to>=0)segments.push({from:i,to,color:item.color,through:true});}
   for(const sha of forward){const to=next.findIndex(v=>v.sha===sha);segments.push({from:lane,to,color:next[to].color,through:false});}
   rows.push({commit,lane,color:own.color,segments,earlier,lanes:Math.max(1,before.length,next.length)});lanes=next;
  }
  return{rows,continuations:lanes};
 }
 function sourceURL(options,ref,path){
  if(options.local||!SHA.test(ref)||!pathOK(path))return null;
  try{const host=new URL(options.provider==='gitlab'?options.host:'https://github.com');if(host.protocol!=='https:'||host.username||host.password||host.pathname!=='/'||host.search||host.hash)return null;
   const repo=String(options.repository).split('/');if(repo.length<2||repo.some(p=>!p||p==='.'||p==='..'||!/^[\w.-]+$/.test(p)))return null;
   return host.origin+'/'+repo.map(encodeURIComponent).join('/')+(options.provider==='gitlab'?'/-/blob/':'/blob/')+ref+'/'+path.split('/').map(encodeURIComponent).join('/');
  }catch{return null;}
 }
 const API={pathOK,fileKind,treeRows,graphRows,sourceURL};root.KiCadRepositoryExplorer=API;
 if(typeof module==='object'&&module.exports){module.exports=API;return;}
 if(!root.document)return;const d=root.document;
 const make=(tag,text,cls)=>{const n=d.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,action)=>{const b=make('button',text);b.type='button';b.onclick=action;return b;};
 const svg=(tag,attrs)=>{const n=d.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,String(value));return n;};
 function fileIcon(kind){
  const paths={folder:'M3 6h7l2 3h9v11H3z M3 6V4h7l2 2',schematic:'M5 3h10l4 4v14H5z M8 11h8m-8 4h8',layout:'M4 3h13l3 3v14H4z M8 7h7v7H8z',model:'m12 3 9 5v9l-9 5-9-5V8z M3 8l9 5 9-5M12 13v9',source:'M5 3h10l4 4v14H5z M15 3v5h4',project:'M5 3h10l4 4v14H5z M8 12h8m-8 4h5',back:'M19 12H5m6-6-6 6 6 6',refresh:'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 14-2l1 1M4 17l1 1a8 8 0 0 0 14-2',right:'m9 5 7 7-7 7',down:'m5 9 7 7 7-7',blank:''};
  const node=svg('svg',{viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});node.setAttribute('class','repo-type-icon');node.append(svg('path',{d:paths[kind]??paths.source}));return node;
 }
 let current=null;API.close=()=>{if(!current)return false;current.close();return true;};
 API.open=options=>{
  current?.close();let closed=false,generation=0,ref=options.ref,entries=[],commits=[],expanded=new Set(),shown=200,treePage=1,treeMore=false,historyPage=1,historyMore=false,workingTree=false,treePinned='',historyPinned='',busyTree=false,busyHistory=false;
  const directories=new Map(),warnings=new Set(),branchHeads=[];
  const page=make('section',undefined,'repository-explorer');page.id='repositoryExplorer';page.setAttribute('role','region');page.setAttribute('aria-label','Repository files and history');page.dataset.tab='files';
  const header=make('header'),back=button('Back',()=>close()),title=make('strong','Repository'),context=make('span',options.repository||'Local project','repo-context');back.setAttribute('aria-label','Back from repository');back.className='repo-icon-button';back.title='Back';back.replaceChildren(fileIcon('back'));header.append(back,title,context);page.append(header);
  const controls=make('div',undefined,'repo-toolbar'),branch=make('select'),refresh=button('Refresh',()=>reload());branch.setAttribute('aria-label','Browse repository revision');branch.append(new Option('Saved revision · '+String(ref).slice(0,12),ref));branch.onchange=()=>{ref=branch.value;reload();};refresh.className='repo-icon-button';refresh.setAttribute('aria-label','Refresh repository');refresh.title='Refresh';refresh.replaceChildren(fileIcon('refresh'));controls.append(branch,refresh);page.append(controls);
  const notice=make('p',undefined,'repo-notice');notice.hidden=true;notice.setAttribute('role','status');page.append(notice);
  const tabs=make('nav',undefined,'repo-tabs');tabs.setAttribute('aria-label','Repository views');const tabButtons=[];for(const name of ['files','history']){const b=button(name==='files'?'Files':'Commit history',()=>{page.dataset.tab=name;for(const item of tabButtons)item.setAttribute('aria-pressed',String(item===b));});b.setAttribute('aria-pressed',String(name==='files'));tabButtons.push(b);tabs.append(b);}page.append(tabs);
  const panes=make('div',undefined,'repo-panes'),filesPane=make('section',undefined,'repo-files-pane'),historyPane=make('section',undefined,'repo-history-pane');filesPane.setAttribute('aria-label','Repository file tree');historyPane.setAttribute('aria-label','Commit history graph');panes.append(filesPane,historyPane);page.append(panes);
  const fileHead=make('div',undefined,'repo-pane-heading'),fileTitle=make('strong','Files'),filter=make('input');filter.type='search';filter.placeholder='Find a loaded file or folder';filter.setAttribute('aria-label','Search repository tree');fileHead.append(fileTitle,filter);filesPane.append(fileHead);
  const legend=make('div',undefined,'repo-file-legend');legend.textContent='Schematic · PCB layout · 3D model · other source';filesPane.append(legend);
  const tree=make('div',undefined,'repo-file-tree');tree.setAttribute('role','tree');tree.setAttribute('aria-label','Repository files');filesPane.append(tree);
  const historyHead=make('div',undefined,'repo-pane-heading');historyHead.append(make('strong','Commits'));const historyFilter=make('input');historyFilter.type='search';historyFilter.placeholder='Search loaded messages or authors';historyFilter.setAttribute('aria-label','Search loaded commits');historyHead.append(historyFilter);historyPane.append(historyHead);
  const history=make('div',undefined,'repo-history-list');history.setAttribute('role','list');historyPane.append(history);const moreHistory=button('Load older commits',()=>loadHistory(historyPage+1));historyPane.append(moreHistory);
  const footer=make('p','Read-only repository browsing. Graph lines follow real commit parent IDs.','repo-footnote');page.append(footer);
  const origin=d.activeElement,inert=new Map();d.body.append(page);for(const node of d.body.children)if(node!==page){inert.set(node,node.inert);node.inert=true;}back.focus();
  function close(){if(closed)return;closed=true;generation++;d.removeEventListener('keydown',key);for(const [node,value]of inert)node.inert=value;page.remove();origin?.focus?.();if(current?.page===page)current=null;}
  function key(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const menu=page.querySelector('.repo-commit-more[open]');if(menu){menu.open=false;menu.querySelector('summary')?.focus();}else close();}}
  page.addEventListener('pointerdown',event=>{for(const menu of page.querySelectorAll('.repo-commit-more[open]'))if(!menu.contains(event.target))menu.open=false;});
  d.addEventListener('keydown',key);current={page,close};
  const fields=()=>({repository:options.repository,provider:options.provider||'github',...(options.host?{host:options.host}:{}),ref,file:options.file});
  async function call(type,extra={}){const request={...fields(),...extra};if(options.local){request.ref=options.ref;const selected=SHA.test(ref)?ref:branchHeads.find(b=>b.name===ref)?.sha;if(!request.sha&&selected)request.sha=selected;}else if(request.sha)request.ref=request.sha;const value=await options.request(type,request);if(value?.ok===false)throw Error(value.error||'Repository request failed');return value?.ok===true?value.result:value;}
  function warn(text){if(text)warnings.add(String(text));notice.textContent=[...warnings].join(' ');notice.hidden=!notice.textContent;}
  function collect(result){for(const text of result.warnings||[])warn(text);}
  function verifySnapshot(result,pinned){if(pinned&&result.sha&&result.sha!==pinned)throw Error('Repository revision changed unexpectedly. Refresh before browsing more files or history.');}
  function merge(next){const map=new Map(entries.map(e=>[e.path,e]));for(const entry of next||[])if(pathOK(entry.path)&&['tree','blob','commit'].includes(entry.type))map.set(entry.path,entry);entries=[...map.values()];}
  function renderTree(){
   const activePath=d.activeElement?.closest?.('.repo-file-row')?.dataset.path,scroll=tree.scrollTop;tree.replaceChildren();const rows=treeRows(entries,expanded,filter.value);fileTitle.textContent=(workingTree?'Working files':page.dataset.imported==='true'?'Imported files':'Files')+' · '+entries.filter(e=>e.type!=='tree').length;
   for(const entry of rows.slice(0,shown)){
    const row=make('div',undefined,'repo-file-row');row.style.setProperty('--depth',String(entry.depth));row.dataset.kind=entry.kind;row.dataset.path=entry.path;row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(entry.depth+1));
    const isExpanded=Boolean(filter.value.trim())||expanded.has(entry.path),name=entry.path.split('/').at(-1),glyph=make('span',entry.type==='tree'?(expanded.has(entry.path)?'▾':'▸'):'','repo-file-glyph');glyph.setAttribute('aria-hidden','true');
    const open=button('',()=>{if(entry.type==='tree'){if(expanded.has(entry.path))expanded.delete(entry.path);else{expanded.add(entry.path);if(page.dataset.treeTruncated==='true'||treeMore||directories.has(entry.path))loadDirectory(entry.path);}renderTree();}else if(options.onOpenFile&&entry.type!=='commit'&&String(entry.mode)!=='120000'&&options.canOpenFile?.(entry.path)!==false&&(ref===options.ref||workingTree||options.canOpenHistorical)){Promise.resolve(options.onOpenFile(entry.path,workingTree?null:(treePinned||ref))).catch(error=>warn(error.message));}else{const url=sourceURL(options,treePinned||ref,entry.path);if(url)root.open(url,'_blank','noopener');else warn('This file is metadata-only or unavailable in this viewer. Use its source checkout.');}});open.title=entry.path;open.setAttribute('aria-label',name);const label=make('span',name,'repo-file-name');glyph.replaceChildren(fileIcon(entry.type==='tree'?(isExpanded?'down':'right'):'blank'));open.append(glyph,fileIcon(entry.kind),label);row.append(open);
    if(entry.type==='tree')row.setAttribute('aria-expanded',String(isExpanded));else{const kind=make('small',entry.kind,'repo-file-kind');row.append(kind);}
    if(entry.status){const raw=String(entry.status),code={modified:'M',added:'A',deleted:'D',renamed:'R',copied:'C',untracked:'?',staged:'S',conflicted:'!','type-changed':'T'}[raw]||raw;const state=make('span',code,'repo-file-status');state.title=(entry.staged?'Staged · ':'Working tree · ')+raw;state.setAttribute('aria-label',state.title);state.dataset.status=code;state.dataset.staged=String(Boolean(entry.staged));row.append(state);}
    tree.append(row);
    if(entry.type==='tree'&&expanded.has(entry.path)&&directories.get(entry.path)?.hasMore)tree.append(button('More files in '+name,()=>loadDirectory(entry.path,directories.get(entry.path).nextPage)));
   }
   if(!rows.length)tree.append(make('p',busyTree?'Loading repository files…':'No matching files in the loaded tree.'));
   if(rows.length>shown)tree.append(button('Show more files',()=>{shown+=200;renderTree();}));
   if(treeMore)tree.append(button('Load more repository files',()=>loadTree(treePage+1)));if(directories.get('')?.hasMore)tree.append(button('More root files and folders',()=>loadDirectory('',directories.get('').nextPage)));tree.scrollTop=scroll;if(activePath)[...tree.querySelectorAll('.repo-file-row')].find(row=>row.dataset.path===activePath)?.querySelector('button')?.focus();
  }
  function renderHistory(){
   history.replaceChildren();const graph=graphRows(commits),query=historyFilter.value.trim().toLowerCase(),width=Math.max(1,...graph.rows.map(r=>r.lanes))*14+8;
   for(const row of graph.rows){const c=row.commit,match=!query||(c.message+' '+c.author+' '+c.sha).toLowerCase().includes(query),item=make('article',undefined,'repo-commit');item.setAttribute('role','listitem');item.dataset.match=String(match);item.id='repo-commit-'+c.sha;item.style.setProperty('--graph-width',width+'px');
    const drawing=svg('svg',{viewBox:`0 0 ${width} 64`,preserveAspectRatio:'none','aria-hidden':'true'}),x=lane=>lane*14+7;
    for(const edge of row.segments)drawing.append(svg('path',{d:edge.through?`M ${x(edge.from)} 0 L ${x(edge.to)} 64`:`M ${x(edge.from)} 20 L ${x(edge.to)} 64`,stroke:edge.color,'stroke-width':1.7,fill:'none'}));
    drawing.append(svg('path',{d:`M ${x(row.lane)} 0 V 20`,stroke:row.color,'stroke-width':1.7}));drawing.append(svg('circle',{cx:x(row.lane),cy:20,r:4,fill:row.color}));item.append(drawing);
    const details=make('details'),summary=make('summary',String(c.message||'(No commit message)').split('\n')[0]);details.append(summary);
    const meta=make('p',`${c.sha.slice(0,8)} · ${c.author||'Unknown author'} · ${c.date&&Number.isFinite(Date.parse(c.date))?new Date(c.date).toLocaleString():'Date unavailable'}`,'repo-commit-meta');summary.append(meta);for(const head of branchHeads.filter(b=>b.sha===c.sha)){const badge=make('span',head.name,'repo-branch-badge');summary.append(badge);}
    const body=make('pre',c.message||'');details.append(body);const parents=make('p','Parents: '+((c.parents||[]).map(p=>p.slice(0,8)).join(', ')||(c.parentsKnown===false?'Unknown — website metadata unavailable':'Root commit')),'repo-commit-parents');details.append(parents);
    if(row.earlier.length)details.append(make('p','Parent links above: '+row.earlier.map(p=>p.slice(0,8)).join(', ')));
    const actions=make('div',undefined,'repo-commit-actions');actions.append(button('Browse files',()=>{ref=c.sha;if(![...branch.options].some(o=>o.value===ref))branch.append(new Option('Commit · '+ref.slice(0,12),ref));branch.value=ref;reload();page.dataset.tab='files';for(const [i,b]of tabButtons.entries())b.setAttribute('aria-pressed',String(i===0));}));
    const invoke=async(action,label)=>{if(!SHA.test(c.sha))return;try{const result=await action(c.sha);if(!closed&&result?.message)warn(result.message);}catch(error){if(!closed)warn(label+': '+error.message);}};
    const more=make('details',undefined,'repo-commit-more'),moreLabel=make('summary','More'),moreItems=make('div',undefined,'repo-commit-menu');more.append(moreLabel,moreItems);
    for(const [key,label]of [['onOpenRevision','View this commit'],['onCompareCurrent','Compare with current'],['onDownloadRevision','Download committed project'],['onCopyRevision','Make local copy'],['onForkRevision','Fork from this commit']])if(typeof options[key]==='function'){
      const secondary=['onDownloadRevision','onCopyRevision','onForkRevision'].includes(key);(secondary?moreItems:actions).append(button(label,()=>{more.open=false;return invoke(options[key],label);}));
    }if(moreItems.children.length)actions.append(more);
    try{const url=new URL(c.url);if(url.protocol==='https:'&&!url.username&&!url.password){const a=make('a','Open commit');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}}catch{}
    details.append(actions);item.append(details);history.append(item);
   }
   if(!commits.length)history.append(make('p',busyHistory?'Loading commit history…':'No commit history is available for this workspace.'));
   if(query)history.prepend(make('p',graph.rows.filter(r=>(r.commit.message+' '+r.commit.author+' '+r.commit.sha).toLowerCase().includes(query)).length+' matching commits; nonmatches remain dimmed to preserve graph connections.'));
   moreHistory.hidden=!historyMore;moreHistory.disabled=busyHistory;footer.textContent='Read-only. '+(graph.continuations.length?'Graph continues beyond the loaded history. ':'')+'Lines follow saved parent IDs; colours distinguish graph lanes.';
  }
  async function loadTree(pageNumber=1){const ticket=generation;if(busyTree)return;busyTree=true;renderTree();try{
   const result=await call('repository-tree',{page:pageNumber,...(treePinned?{sha:treePinned}:{})});if(closed||ticket!==generation)return;verifySnapshot(result,treePinned);treePinned=result.sha||treePinned;workingTree=Boolean(result.workingTree);legend.textContent=workingTree?'M modified · A added · D deleted · R renamed · ? untracked · ! conflict':'Schematic · PCB layout · 3D model · other source';page.dataset.imported=String(Boolean(result.imported));merge(result.entries);treePage=pageNumber;treeMore=Boolean(result.hasMore&&result.nextPage);if(result.truncated&&!result.hasMore){directories.set('',{hasMore:false});warn('Tree listing is bounded. Expand folders to load their pinned contents.');}if(result.truncated)treeMore=treeMore||false;page.dataset.treeTruncated=String(Boolean(result.truncated));collect(result);if(result.truncated&&!result.hasMore)loadDirectory('');
  }catch(error){if(!closed&&ticket===generation)warn(error.message);}finally{if(ticket===generation){busyTree=false;renderTree();}}}
  async function loadDirectory(directory,pageNumber=1){const ticket=generation,known=directories.get(directory);if(known?.busy||known?.complete)return;directories.set(directory,{...known,busy:true});try{
   const result=await call('repository-tree',{directory,page:pageNumber,...(SHA.test(treePinned||ref)?{sha:treePinned||ref}:{})});if(closed||ticket!==generation)return;verifySnapshot(result,treePinned);merge(result.entries);directories.set(directory,{hasMore:Boolean(result.hasMore),nextPage:result.nextPage,complete:!result.hasMore});collect(result);
  }catch(error){directories.delete(directory);if(!closed&&ticket===generation)warn(error.message);}finally{if(ticket===generation)renderTree();}}
  async function loadHistory(pageNumber=1){const ticket=generation;if(busyHistory)return;busyHistory=true;renderHistory();try{
   const result=await call('repository-history',{page:pageNumber,...((historyPinned||(!options.local&&treePinned))?{sha:historyPinned||treePinned}:{})});if(closed||ticket!==generation)return;verifySnapshot(result,historyPinned||(!options.local&&treePinned));historyPinned=result.sha||historyPinned;const seen=new Set(commits.map(c=>c.sha));for(const c of result.commits||[])if(SHA.test(c.sha)&&!seen.has(c.sha)){if(c.parentsTruncated)warn('Some commit parent IDs were truncated; affected graph connections are incomplete.');commits.push({...c,parents:(c.parents||[]).filter(p=>SHA.test(p)),message:String(c.message||''),author:String(c.author||'')});seen.add(c.sha);}historyPage=pageNumber;historyMore=Boolean(result.hasMore&&result.nextPage);collect(result);
  }catch(error){if(!closed&&ticket===generation)warn(error.message);}finally{if(ticket===generation){busyHistory=false;renderHistory();}}}
  async function branches(){const ticket=generation;try{const result=await call('repository-branches');if(closed||ticket!==generation)return;collect(result);if(result.hasMore)warn('Additional branches are available beyond this listing.');branchHeads.length=0;branch.replaceChildren(new Option('Saved revision · '+String(options.ref).slice(0,12),options.ref));for(const item of result.branches||[]){const value=item.name;if(typeof value==='string'&&typeof item.name==='string'){branchHeads.push(item);branch.append(new Option(item.name,value));}}if(![...branch.options].some(o=>o.value===ref))branch.append(new Option('Commit · '+ref.slice(0,12),ref));branch.value=ref;renderHistory();}catch(error){if(!closed&&ticket===generation)warn('Branches: '+error.message);}}
  function reload(){generation++;entries=[];commits=[];expanded.clear();directories.clear();warnings.clear();notice.textContent='';shown=200;treePinned=historyPinned='';treeMore=historyMore=false;busyTree=busyHistory=false;const ticket=generation;loadTree().then(()=>{if(!closed&&ticket===generation)loadHistory();});branches();}
  tree.addEventListener('keydown',event=>{
   const rows=[...tree.querySelectorAll('.repo-file-row')],row=event.target.closest?.('.repo-file-row'),index=rows.indexOf(row);if(index<0)return;
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)));rows[next]?.querySelector('button')?.focus();}
   else if(event.key==='ArrowRight'&&row.getAttribute('aria-expanded')==='false'){event.preventDefault();row.querySelector('button').click();}
   else if(event.key==='ArrowLeft'){event.preventDefault();if(row.getAttribute('aria-expanded')==='true')row.querySelector('button').click();else{const path=row.dataset.path,parent=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';rows.find(r=>r.dataset.path===parent)?.querySelector('button')?.focus();}}
  });
  filter.oninput=()=>{shown=200;renderTree();};historyFilter.oninput=renderHistory;
  reload();return{close,page};
 };
})(globalThis);
