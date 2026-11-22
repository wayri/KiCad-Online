/* Source-bound project search and imported KiCad rule-check navigation. */
((root)=>{
  'use strict';
  function arrowGeometry(start,end){
    const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);if(!Number.isFinite(length)||length<1)return null;
    const ux=dx/length,uy=dy/length,size=Math.min(9,length/2),wing=size*.55,bx=end.x-ux*size,by=end.y-uy*size;
    return {shaft:{x1:start.x,y1:start.y,x2:end.x,y2:end.y},head:`M ${bx-uy*wing} ${by+ux*wing} L ${end.x} ${end.y} L ${bx+uy*wing} ${by-ux*wing}`};
  }
  function notePlacement(point,width,height){
    if(![point?.x,point?.y,width,height].every(Number.isFinite)||width<100||height<100)return null;
    const w=Math.min(260,width-24),h=Math.min(144,(height-48)/2),clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    return {x:clamp(point.x<width/2?point.x+28:point.x-w-28,12,width-w-12),y:clamp(point.y>=h+24?point.y-h-24:point.y+24,12,height-h-12),width:w,maxHeight:h};
  }
  function mount(options){
    const $=id=>document.getElementById(id),make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
    const button=(text,fn)=>{const n=make('button',text);n.type='button';n.onclick=fn;return n;};
    const searchHelp=$('projectSearch')?.parentElement?.querySelector?.('.search-help');
    if(searchHelp){const hint=make('p','Patterns: ref:glob:R* or ref:regex:^R[0-9]+$ . Glob * matches any sequence, ? one character, over the whole field. Regex supports literals, character classes, . , ^ $ and single-atom * + ?; use query OR for alternatives. Matching ignores case. Pattern limits produce an explicit error.');hint.className='hint';searchHelp.append(hint);}
    let noteDismissed=false;let index=null,indexObjects=null,indexNets=null,queryResults=[],reports=[],selectedFinding=null,selectedItem=0,disposed=false,reportEpoch=0,identityObjects=null,classSettings=null,identities=new Map();
    const status=(text)=>{$('projectSearchStatus').textContent=text;};
    const currentObjects=()=>options.getObjects();
    function buildIndex(objects,nets,classes=null,sheets=[]){
      const networkObjects=nets.map(net=>({id:net.id,path:net.path,kind:'net',label:net.name,position:net.members.find(m=>m.position)?.position,properties:{Net:net.name},netName:net.name}));
      const indexNets=nets.map(net=>({...net,objectIds:[...(net.objectIds||[]),net.id]}));
      const classObjects=[];
      if(classes){const groups=new Map();for(const net of nets)for(const name of KiCadProjectSearch.netClasses(net.name,classes)){const key=JSON.stringify([net.path,name]);if(!groups.has(key))groups.set(key,{path:net.path,name,nets:[]});groups.get(key).nets.push(net);}for(const group of groups.values()){const id=`${group.path}/class:${group.name}`;classObjects.push({id,path:group.path,kind:'netclass',label:group.name,className:group.name,properties:{Class:group.name,Net:group.nets.map(n=>n.name).join(' ')}});for(const net of indexNets)if(group.nets.some(n=>n.id===net.id))net.objectIds.push(id);}}
      return KiCadProjectSearch.createIndex([...objects,...networkObjects,...classObjects],{nets:indexNets,netClasses:classes,sheets});
    }
    function renderSearch(){
      const objects=currentObjects(),nets=options.getNets();
      if(!index||indexObjects!==objects||indexNets!==nets){index=buildIndex(objects,nets,classSettings);indexObjects=objects;indexNets=nets;}
      const result=KiCadProjectSearch.search(index,$('projectSearch').value,{limit:200});queryResults=result.results;
      $('projectResults').replaceChildren();$('projectSearchCount').textContent=result.error?result.error:`${result.total} matches${result.truncated?' (first 200 shown)':''}`;
      for(const match of queryResults){const object=match.object,row=button('',event=>options.selectSearchObject(object,Boolean($('multiHighlight').checked),event));row.className='object-row search-result';
        row.setAttribute('aria-pressed',String(options.isHighlighted?.(object)||false));
        row.append(make('strong',object.label||object.reference||object.kind),make('small',`${object.kind} · ${object.path}`),make('small',(match.snippets||[]).map(s=>typeof s==='string'?s:`${s.field}: ${s.text}`).join(' · ').slice(0,240)));
        $('projectResults').append(row);
      }
      $('projectIndexWarnings').textContent=(result.warnings||[]).join(' ');
      options.onSearchResults?.(result,$('projectSearch').value);return result;
    }
    function identityIndex(){const current=currentObjects();if(identityObjects===current)return identities;identityObjects=current;identities=new Map();for(const object of current){if(!object.uuid)continue;let entries=identities.get(object.uuid);if(!entries){entries=new Map();identities.set(object.uuid,entries);}const key=JSON.stringify([object.path,object.id]);if(!entries.has(key))entries.set(key,object);}return identities;}
    function resolveItem(finding,item){
      // Report UUIDs are file scoped; repeated matches never select a guessed sheet.
      if(item.uuid){const entries=identityIndex().get(item.uuid);if(entries?.size>1)return {file:null,position:item.position};if(entries?.size===1){const object=entries.values().next().value;return {file:object.path,position:item.position||object.position,object};}}
      return {file:item.file||finding.file,position:item.position};
    }
    const showSeverity={error:true,warning:true};
    function visibleFindings(){const query=$('ruleSearch').value.toLowerCase(),severity=$('ruleSeverity').value;return reports.flatMap(r=>r.findings).filter(f=>showSeverity[f.severity]!==false&&(severity==='all'||f.severity===severity)&&($('showExcludedRules').checked||!f.excluded)&&`${f.description} ${f.type} ${f.sheetPath||''}`.toLowerCase().includes(query));}
    function locateFinding(finding,itemIndex=0){
      selectedFinding=finding;selectedItem=itemIndex;noteDismissed=false;const item=finding.items[itemIndex],target=item&&resolveItem(finding,item);
      if(!target?.file||!target.position){$('ruleStatus').textContent='This item has no resolved drawing location. Associate the report sheet with an open drawing to resolve its saved UUID.';options.redraw();renderRules();return;}
      if(options.locateRule(target)===false){$('ruleStatus').textContent='Cannot jump: open the matching loaded drawing in 2D.';options.redraw();renderRules();return;}$('ruleStatus').textContent=`${finding.type} · ${target.file} · ${target.position.x.toFixed(3)}, ${target.position.y.toFixed(3)} mm`;renderRules();options.redraw();
    }
    function renderRules(){
      const list=$('ruleResults');list.replaceChildren();const findings=visibleFindings();$('ruleCount').textContent=`${findings.length} saved findings${findings.length>200?' · first 200 listed':''}`;
      for(const finding of findings.slice(0,200)){const section=make('section');section.className='rule-finding'+(selectedFinding===finding?' selected':'');const row=button(`${finding.severity.toUpperCase()} · ${finding.type}`,()=>locateFinding(finding));row.className='rule-title';section.append(row,make('p',finding.description),make('small',`${finding.kind.toUpperCase()} · ${finding.file||finding.sheetPath||'unassociated sheet'}${finding.excluded?' · excluded':''}`));
        if(finding.comment)section.append(make('p','Note: '+finding.comment));
        for(const [i,item]of finding.items.slice(0,20).entries()){const target=resolveItem(finding,item),action=button(`${i+1}. ${item.description||'Affected item'}${target.file&&target.position?'':' · location unresolved'}`,()=>locateFinding(finding,i));action.className='rule-item';section.append(action);}if(finding.items.length>20)section.append(make('small',`First 20 of ${finding.items.length} items listed. Next item navigates all affected locations.`));list.append(section);
      }
    }
    function renderSheetMappings(){
      $('reportSheetMappings').replaceChildren();
      for(const report of reports)for(const sheet of report.sheets||[]){const label=make('label',`Associate ERC ${sheet.path} (${report.metadata.reportPath})`),select=make('select');select.setAttribute('aria-label',`Drawing for ERC sheet ${sheet.path}`);const empty=make('option','Unassociated');empty.value='';select.append(empty);
        for(const file of options.getFiles().filter(f=>/\.kicad_sch$/i.test(f.path))){const option=make('option',file.path);option.value=file.path;select.append(option);}select.value=sheet.file||'';
        select.onchange=()=>{sheet.file=select.value||null;for(const finding of report.findings.filter(f=>f.sheetUuidPath===sheet.uuidPath)){finding.file=sheet.file;for(const item of finding.items)item.file=sheet.file;}renderRules();options.redraw();};label.append(select);$('reportSheetMappings').append(label);
      }
    }
    function updateAssociations(){const value=$('ruleDrawing').value;$('ruleDrawing').replaceChildren();for(const file of options.getFiles()){const n=make('option',file.path);n.value=file.path;$('ruleDrawing').append(n);}if(options.getFiles().some(f=>f.path===value))$('ruleDrawing').value=value;else $('ruleDrawing').value=options.currentFile();renderSheetMappings();}
    $('projectSearch').oninput=renderSearch;
    $('highlightSearchResults').onclick=()=>{options.highlightSearchObjects(queryResults.map(r=>r.object),$('multiHighlight').checked);renderSearch();};
    $('multiHighlight').onchange=()=>options.setMultiHighlight?.($('multiHighlight').checked);
    $('importNetClasses').onclick=()=>$('netClassFile').click();
    $('netClassFile').onchange=async()=>{const file=$('netClassFile').files?.[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('Project settings exceed 1 MiB.');const classes=KiCadProjectSearch.parseNetClasses(await file.text());classSettings=classes;index=null;options.setNetClasses?.(classes);status(`Imported net classes from ${file.name}`);renderSearch();}catch(error){status(error.message);}finally{$('netClassFile').value='';}};
    $('importRuleReport').onclick=()=>$('ruleReportFile').click();
    function addReport(text,name,{file,automatic=false,revision=options.ref}={}){
      if(reports.length>=4)throw new Error('At most four reports per review session; clear reports first.');
      const report=KiCadRuleReports.parse(text,{file:file===undefined?$('ruleDrawing').value:file,reportPath:name,revision});if(automatic&&reports.some(r=>r.metadata.reportPath===name))return false;reports.push(report);selectedFinding=null;
      $('ruleProvenance').textContent=reports.map(r=>`${r.metadata.source} · ${r.metadata.date||'date unknown'} · KiCad ${r.metadata.kicadVersion||'unknown'} · imported ${r.metadata.reportPath}`).join(' | ')+'. Report revision is unverified; no ERC/DRC is run in the browser.';
      $('ruleStatus').textContent=report.warnings.join(' ');renderSheetMappings();renderRules();options.onRuleReportLoaded?.({automatic,report});options.redraw();return true;
    }
    let discovery=null,discoveryDone=false;
    const discover=button('Find saved ERC/DRC reports',()=>discoverReports({force:true}));discover.id='discoverRuleReports';discover.setAttribute('aria-label','Find saved ERC and DRC reports');$('loadRepoReport').parentElement?.append(discover);
    async function discoverReports({force=false}={}){
      if(disposed)return {loaded:0};if(discovery)return discovery;if(discoveryDone&&!force)return {loaded:0,cached:true};
      const ticket=reportEpoch;discover.disabled=true;
      discovery=(async()=>{let loaded=0,checked=0;const warnings=[];
       try{
        const inventory=await options.request('project-inventory',{repository:options.repository,ref:options.ref,file:options.rootFile});if(disposed||ticket!==reportEpoch)return {loaded:0};
        const entries=inventory?.files;if(!Array.isArray(entries))throw Error('The project inventory did not provide saved report paths.');
        const complete=entries.length<=20000&&inventory.truncated!==true&&!(inventory.warnings||[]).some(w=>/truncat|incomplete|first \d+/i.test(String(w)));if(!complete)warnings.push('Project inventory is incomplete; filename-only and absolute-path source associations are disabled.');
        const kind=/\.kicad_pcb$/i.test(options.rootFile)?'drc':'erc',paths=KiCadRuleReports.reportCandidates(entries,{kind}),revision=inventory.snapshotRef||options.ref;
        for(const path of paths){
         if(disposed||ticket!==reportEpoch||reports.length>=4)break;if(reports.some(r=>r.metadata.reportPath===path))continue;
         checked++;try{
          const result=await options.request('rule-report',{repository:options.repository,ref:revision,file:options.rootFile,reportPath:path});if(disposed||ticket!==reportEpoch)break;
          if(result?.path!==path)throw Error('Report transport returned another source path.');
          const parsed=KiCadRuleReports.parse(result.content,{kind,reportPath:path,revision}),file=KiCadRuleReports.associateSource(parsed,entries,{complete});
          if(!file)throw Error('Source drawing is missing, unrelated or ambiguous.');
          if(addReport(result.content,path,{file,automatic:true,revision}))loaded++;
         }catch(error){warnings.push(path+': '+error.message);}
        }
        if(disposed||ticket!==reportEpoch)return {loaded,cancelled:true};
        discoveryDone=true;$('ruleStatus').textContent=`Loaded ${loaded} saved ${kind.toUpperCase()} report(s); inspected ${checked} candidate(s). `+warnings.slice(0,4).join(' ')+(warnings.length>4?' More candidates were rejected.':'')+(paths.length===12?' Discovery is limited to 12 candidates.':'');
        return {loaded,checked,warnings};
       }catch(error){if(!disposed)$('ruleStatus').textContent='Saved report discovery unavailable: '+error.message;return {loaded,checked,warnings:[error.message]};}
      })().finally(()=>{discovery=null;if(!disposed)discover.disabled=false;});return discovery;
    }
    $('ruleReportFile').onchange=async()=>{const file=$('ruleReportFile').files?.[0];if(!file)return;const ticket=reportEpoch;try{if(file.size>KiCadRuleReports.MAX_BYTES)throw new Error('Rule report exceeds 5 MiB.');const text=await file.text();if(!disposed&&ticket===reportEpoch)addReport(text,file.name);}catch(error){if(!disposed&&ticket===reportEpoch)$('ruleStatus').textContent=error.message;}finally{if(!disposed)$('ruleReportFile').value='';}};
    $('loadRepoReport').onclick=async()=>{const ticket=++reportEpoch,path=$('repoReportPath').value.trim();$('loadRepoReport').disabled=true;$('ruleStatus').textContent='Loading saved repository report…';try{const result=await options.request('rule-report',{repository:options.repository,ref:options.ref,file:options.rootFile,reportPath:path});if(disposed||ticket!==reportEpoch)return;if(result?.path!==path)throw Error('Report transport returned another source path.');addReport(result.content,path);}catch(error){if(!disposed&&ticket===reportEpoch)$('ruleStatus').textContent=error.message;}finally{if(!disposed)$('loadRepoReport').disabled=false;}};
    for(const id of ['ruleSearch','ruleSeverity','showExcludedRules'])$(id).oninput=()=>{renderRules();options.redraw();};
    const noteLabel=make('label'),noteToggle=make('input');noteLabel.className='check';noteToggle.id='showRuleNotes';noteToggle.type='checkbox';noteToggle.checked=true;noteLabel.append(noteToggle,make('span','Show selected finding note'));$('showRuleMarkers').parentElement?.parentElement?.append(noteLabel);
    noteToggle.onchange=()=>{noteDismissed=false;options.redraw();};
    for(const severity of ['error','warning']){const label=make('label'),toggle=make('input');label.className='check';toggle.type='checkbox';toggle.checked=true;toggle.id='showRule'+(severity==='error'?'Errors':'Warnings');toggle.setAttribute('aria-label','Show saved '+severity+' findings');toggle.onchange=()=>{showSeverity[severity]=toggle.checked;renderRules();options.redraw();};label.append(toggle,make('span',severity==='error'?'Errors':'Warnings'));$('showRuleMarkers').parentElement?.parentElement?.append(label);}
    $('showRuleMarkers').onchange=()=>options.redraw();
    for(const [id,step]of [['previousRule',-1],['nextRule',1]])$(id).onclick=()=>{const list=visibleFindings();if(!list.length)return;const at=list.indexOf(selectedFinding),next=at<0?(step>0?0:list.length-1):(at+step+list.length)%list.length;locateFinding(list[next]);};
    for(const [id,step]of [['previousRuleItem',-1],['nextRuleItem',1]])$(id).onclick=()=>{if(!selectedFinding?.items.length)return;locateFinding(selectedFinding,(selectedItem+step+selectedFinding.items.length)%selectedFinding.items.length);};
    $('clearRuleReports').onclick=()=>{reportEpoch++;discoveryDone=true;reports=[];selectedFinding=null;renderSheetMappings();$('ruleStatus').textContent='Reports cleared.';$('ruleProvenance').textContent='Import a saved KiCad JSON ERC or DRC report. Reports may be stale; source files remain unchanged.';renderRules();options.redraw();};
    function draw(overlay,pins,screen,svg){
      if(!$('showRuleMarkers').checked||options.is3D())return;const host=$('drawingHost').getBoundingClientRect();let count=0;
      const findings=visibleFindings();if(findings.includes(selectedFinding)){findings.splice(findings.indexOf(selectedFinding),1);findings.unshift(selectedFinding);}
      for(const finding of findings){const entries=[...finding.items.entries()];if(finding===selectedFinding&&entries[selectedItem])entries.unshift(...entries.splice(selectedItem,1));
       for(const [i,item]of entries.slice(0,20)){const target=resolveItem(finding,item);if(target.file!==options.currentFile()||!target.position||count++>=200)continue;const point=screen(target.position);if(!point)continue;
        const color=finding.severity==='error'?'#ee5959':finding.excluded?'#8796a6':'#d78a16',active=selectedFinding===finding&&selectedItem===i,x=Math.max(14,Math.min(host.width-14,point.x)),y=Math.max(14,Math.min(host.height-14,point.y));
        let start={x:Math.max(16,Math.min(host.width-16,x+55)),y:Math.max(16,y-45)};
        if(active&&noteToggle.checked&&!noteDismissed){const layout=notePlacement({x,y},host.width,host.height);if(layout){
          const note=make('section');note.className='rule-location-note';note.setAttribute('aria-label','Selected '+finding.kind.toUpperCase()+' finding');note.style.left=layout.x+'px';note.style.top=layout.y+'px';note.style.width=layout.width+'px';note.style.maxHeight=layout.maxHeight+'px';note.style.borderColor=color;
          const header=make('header'),title=make('strong',`${finding.kind.toUpperCase()} · ${finding.severity}${finding.excluded?' · excluded':''}`),close=button('×',()=>{noteDismissed=true;options.redraw();});close.title='Hide finding note';close.setAttribute('aria-label',close.title);header.append(title,close);
          note.append(header,make('p',finding.description),make('small',item.description));if(finding.comment)note.append(make('small','Note: '+finding.comment));
          note.append(make('small',x!==point.x||y!==point.y?'Location outside view · select marker to locate':'Saved report · revision unverified'),button('Details',()=>options.showRules()));pins.append(note);
          const height=note.getBoundingClientRect?.().height||layout.maxHeight;start={x:Math.max(layout.x,Math.min(layout.x+layout.width,x)),y:Math.max(layout.y,Math.min(layout.y+Math.min(height,layout.maxHeight),y))};
        }}
        if(active){const arrow=arrowGeometry(start,{x,y});if(arrow)overlay.append(svg('line',{...arrow.shaft,stroke:color,'stroke-width':2}),svg('path',{d:arrow.head,fill:'none',stroke:color,'stroke-width':2}));}
        const marker=button(active?'➤':'!',()=>{options.showRules();locateFinding(finding,i);});marker.className='pin rule-marker'+(active?' active':'');marker.setAttribute('data-severity',finding.severity);marker.style.left=x+'px';marker.style.top=y+'px';marker.style.background=color;marker.setAttribute('aria-label',`${finding.kind.toUpperCase()} ${finding.severity}: ${finding.description}; ${item.description}`);marker.title=`${finding.description}${x!==point.x||y!==point.y?' · offscreen: click to locate':''}`;pins.append(marker);
       }
      }

    }
    function routingReports(path){return reports.filter(r=>r.kind==='drc'&&r.metadata.associatedFile===path).map(r=>({metadata:{...r.metadata},unconnectedFindings:r.findings.filter(f=>f.category==='unconnected_items'&&!f.excluded).length,excludedUnconnectedFindings:r.findings.filter(f=>f.category==='unconnected_items'&&f.excluded).length,warnings:[...r.warnings]}));}
    updateAssociations();renderRules();
    return {discoverReports,routingReports,setClasses(classes){classSettings=classes;index=null;options.setNetClasses?.(classes);},query(value){$('projectSearch').value=value;return renderSearch();},renderSearch,renderRules,updateAssociations,draw,dispose(){disposed=true;reportEpoch++;}};
  }
  root.KiCadReviewNavigation={mount,arrowGeometry,notePlacement};
  if(typeof module==='object'&&module.exports)module.exports=root.KiCadReviewNavigation;
})(globalThis);
