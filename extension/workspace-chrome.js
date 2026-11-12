/* Shared web/VS Code presentation. Existing controllers still own every action. */
((root)=>{'use strict';
 const installations=new WeakMap();
 const detachInstallations=new WeakMap();
 const detachableModes=Object.freeze([['schematic','Schematic'],['layout','Layout'],['3d','3D']]);
 function outsideWindow(event,host){const x=event.screenX,y=event.screenY,left=host.screenX,top=host.screenY,w=host.outerWidth,h=host.outerHeight;return [x,y,left,top,w,h].every(Number.isFinite)&&w>0&&h>0&&(x!==0||y!==0)&&(x<left||x>left+w||y<top||y>top+h)&&event.dataTransfer?.dropEffect==='none';}
 function installDetach(doc,host=root,holder){
  holder=holder||doc.getElementById('workspaceTabs');if(!holder||detachInstallations.has(holder))return detachInstallations.get(holder)||null;
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text)node.textContent=text;return node;},menu=make('details'),summary=make('summary','Detach'),panel=make('div');menu.className='workspace-detach-menu';summary.title='Open independent linked views';summary.setAttribute('aria-label','Detach schematic, layout or 3D view');menu.append(summary,panel);
  for(const [mode,label]of detachableModes){const action=make('button','Detach '+label);action.type='button';action.setAttribute('aria-label','Detach '+label+' view');action.onclick=()=>{menu.open=false;host.dispatchEvent(new host.CustomEvent('kicad-review:detach-view',{detail:{mode}}));};panel.append(action);}
  const label=make('label'),sync=make('input');sync.type='checkbox';sync.checked=true;sync.setAttribute('aria-label','Cross-select detached views');sync.onchange=()=>host.dispatchEvent(new host.CustomEvent('kicad-review:detach-sync',{detail:{enabled:sync.checked}}));label.append(sync,doc.createTextNode(' Cross-select linked views'));panel.append(label);
  const hint=make('small','Drag a drawing tab outside the window, or choose a view above.');panel.append(hint);const helperPanel=doc.getElementById('workspaceHelpers')?.lastElementChild;if(helperPanel)helperPanel.append(menu);else holder.after(menu);
  const bound=new WeakSet(),bindings=[];
  const bind=()=>{for(const tab of holder.querySelectorAll('button')){if(bound.has(tab))continue;const aria=tab.getAttribute('aria-label')||'',mode=detachableModes.find(([,name])=>aria===name+' view')?.[0];if(!mode)continue;bound.add(tab);const start=event=>{if(!event.dataTransfer)return;event.dataTransfer.effectAllowed='copyMove';event.dataTransfer.setData('text/plain','KiCad Online '+mode+' view');tab.classList.add('workspace-view-dragging');},end=event=>{tab.classList.remove('workspace-view-dragging');if(outsideWindow(event,host))host.dispatchEvent(new host.CustomEvent('kicad-review:detach-view',{detail:{mode}}));};tab.draggable=true;tab.addEventListener('dragstart',start);tab.addEventListener('dragend',end);bindings.push({tab,start,end});}};
  bind();const observer=host.MutationObserver?new host.MutationObserver(bind):null;observer?.observe(holder,{childList:true,subtree:true});
  const outside=event=>{if(!menu.contains(event.target))menu.open=false;},key=event=>{if(event.key==='Escape')menu.open=false;},syncState=event=>{if(typeof event.detail?.enabled==='boolean')sync.checked=event.detail.enabled;};doc.addEventListener('pointerdown',outside);doc.addEventListener('keydown',key);host.addEventListener('kicad-review:detach-state',syncState);
  const api={dispose(){observer?.disconnect();for(const {tab,start,end}of bindings){tab.draggable=false;tab.removeEventListener('dragstart',start);tab.removeEventListener('dragend',end);}doc.removeEventListener('pointerdown',outside);doc.removeEventListener('keydown',key);host.removeEventListener('kicad-review:detach-state',syncState);menu.remove();detachInstallations.delete(holder);}};detachInstallations.set(holder,api);return api;
 }

 const secondary=['openTestpoints','filterTestpoints','highlightTestpoints','populationHighlight','toggleRuleMarkers','openBoardAnalytics','openRepositoryExplorer','openCalculators','openEngineeringTools','openReviewHandoff','settingsButton','themeButton','openSavedReports','openBomManager','viewRuleChecks'];
 function install(doc,host=root){
  if(host.KiCadAndroidRuntime||doc.body.classList.contains('android-design'))return null;
  doc.body.setAttribute('data-workspace-chrome','');
  if(host.KiCadVSCodeContext)doc.body.setAttribute('data-editor-host','vscode');
  const toolbar=doc.getElementById('frameControls'),rail=doc.getElementById('drawingTools');
  if(!toolbar||!rail||!doc.getElementById('selectionMode'))return installDetach(doc,host);
  if(installations.has(toolbar))return installations.get(toolbar);
  const create=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
  const viewNavigation=create('nav','workspace-view-navigation');viewNavigation.setAttribute('aria-label','Drawing views');
  const viewButtons=new Map();
  let simulationDialog=null;
  function openSimulation(){
   if(simulationDialog){simulationDialog.showModal?.();return;}
   const dialog=create('dialog','workspace-simulation-menu');simulationDialog=dialog;dialog.setAttribute('aria-label','Simulation views');dialog.append(create('strong','','Simulation'));
   for(const [id,label]of [['openSavedReports','Saved KiCad / wayriCAD results'],['openFastPI','Fast PI · experimental']]){const target=doc.getElementById(id),action=create('button','',label);action.type='button';action.disabled=!target||target.disabled;action.onclick=()=>{dialog.close();target?.click();};dialog.append(action);}
   const dismiss=create('button','','Close');dismiss.type='button';dismiss.setAttribute('aria-label','Close simulation views');dismiss.onclick=()=>dialog.close();dialog.append(dismiss);
   dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
   dialog.addEventListener('close',()=>{dialog.remove();simulationDialog=null;});doc.body.append(dialog);dialog.showModal();
  }
  host.addEventListener('kicad-review:simulation-view',openSimulation);

  const embeddedHeader=new URLSearchParams(host.location?.search||'').get('headerViews')==='1';
  for(const [key,label,icon]of [['schematic','Schematic','sheet'],['layout','Layout','board'],['3d','3D','cube'],['draftsman','Draftsman','draftsman'],['simulation','Simulation','analytics']]){
   const node=create('button','',label);node.type='button';node.title=label+' view';node.setAttribute('aria-label',label+' view');node.setAttribute('data-icon',icon);viewButtons.set(key,node);viewNavigation.append(node);
   node.onclick=()=>{const mode=doc.getElementById('mode3d'),board=Boolean(mode&&!mode.hidden),in3d=mode?.getAttribute('aria-pressed')==='true';
    if(key==='3d'){if(board&&!in3d&&!mode.disabled)mode.click();return;}
    if((key==='layout'&&!board)||(key==='schematic'&&board)){doc.getElementById('viewOppositeDrawing')?.click();return;}
    if(in3d&&!mode.disabled)mode.click();
    if(key==='draftsman')doc.getElementById('openDraftsman')?.click();
    if(key==='simulation')openSimulation();
   };
  }
  if(!embeddedHeader)toolbar.append(viewNavigation);
  const detachUI=!embeddedHeader?installDetach(doc,host,viewNavigation):null;
  function syncViewNavigation(){const mode=doc.getElementById('mode3d'),board=Boolean(mode&&!mode.hidden),three=mode?.getAttribute('aria-pressed')==='true';for(const [key,node]of viewButtons){const target=key==='3d'?mode:key==='draftsman'?doc.getElementById('openDraftsman'):key==='simulation'?doc.getElementById('openSavedReports'):null;node.disabled=key==='3d'?!board||Boolean(mode.disabled):target?target.disabled:false;const active=key===(three?'3d':board?'layout':'schematic');if(node.getAttribute('aria-pressed')!==String(active))node.setAttribute('aria-pressed',String(active));}}
  const modeObserver=host.MutationObserver?new host.MutationObserver(syncViewNavigation):null;
  const observedMode=doc.getElementById('mode3d');if(observedMode)modeObserver?.observe(observedMode,{attributes:true,attributeFilter:['hidden','disabled','aria-pressed']});
  const menu=create('section','workspace-tools-menu');menu.id='workspaceToolsMenu';menu.hidden=true;menu.setAttribute('aria-label','More tools');
  const heading=create('header','workspace-menu-heading','More tools');menu.append(heading);
  const about=create('button','','About KiCad Online');about.type='button';about.setAttribute('data-icon','info');about.onclick=()=>{close();host.KiCadProductInfo?.showAbout();};menu.append(about);
  const trigger=create('button','workspace-more-tools icon-only','More tools');trigger.type='button';trigger.id='workspaceMoreTools';trigger.title='More tools';trigger.setAttribute('aria-label','More tools');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',menu.id);trigger.setAttribute('data-icon','tools');
  const moved=[];
  const quick=create('div','workspace-quick-tools');
  for(const [id,label,icon]of [['measureButton','Measure','ruler'],['viewRuleChecks','Rules','rules'],['openBomManager','BoM','assembly'],['openSavedReports','Reports','analytics']]){
   const action=create('button','',label);action.type='button';action.setAttribute('data-icon',icon);action.title=label;action.setAttribute('aria-label',label==='Reports'?'Saved analysis and KiCad Monkey reports':label==='Rules'?'Rules and ERC or DRC findings':label==='3D'?'Switch 2D and 3D view':label);
   action.onclick=()=>{const target=doc.getElementById(id);if(target&&!target.disabled&&!target.hidden)target.click();};action.dataset.target=id;quick.append(action);
  }menu.append(quick);
  const search=create('input','workspace-tool-search');search.type='search';search.placeholder='Find a tool…';search.setAttribute('aria-label','Find drawing tool');menu.append(search);
  function move(node,parent,before=null){moved.push({node,parent:node.parentNode,next:node.nextSibling});parent.insertBefore(node,before);}
  function reconcile(){
   syncViewNavigation();
   for(const id of secondary){const node=doc.getElementById(id);if(node?.parentNode===rail)move(node,menu);}
   const mode=doc.getElementById('mode3d');if(mode?.parentNode===rail){mode.classList.remove('icon-only');mode.classList.add('workspace-mode-switch');mode.title='Toggle 3D board view';mode.setAttribute('aria-label','3D board view');const anchor=doc.getElementById('reviewToolsButton');move(mode,toolbar,anchor?.parentNode===toolbar?anchor:null);}
   const compatibility=toolbar.querySelector('.compatibility-button');if(compatibility)move(compatibility,menu);
  }
  reconcile();
  // Controllers add some tools after project loading; keep those in the same
  // overflow surface without replacing nodes or their source-bound handlers.
  const observer=host.MutationObserver?new host.MutationObserver(reconcile):null;
  observer?.observe(rail,{childList:true});observer?.observe(toolbar,{childList:true});
  const settings=doc.getElementById('settingsButton');rail.insertBefore(trigger,settings?.parentNode===rail?settings:null);doc.body.append(menu);
  function close(restore=false){if(menu.hidden)return;menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(restore)trigger.focus();}
  function place(){if(menu.hidden)return;const rect=trigger.getBoundingClientRect();menu.style.right=Math.max(8,host.innerWidth-rect.left+6)+'px';menu.style.top=Math.max(8,Math.min(rect.top,host.innerHeight-menu.offsetHeight-8))+'px';}
  function filter(){const nodes=[...menu.querySelectorAll('button')],query=search.value.trim().toLowerCase();for(const node of nodes)if(node.dataset.searchHidden){node.hidden=false;delete node.dataset.searchHidden;}for(const node of nodes){const target=node.dataset.target&&doc.getElementById(node.dataset.target),unavailable=Boolean(node.dataset.target&&(!target||target.hidden)),filtered=Boolean(query&&!((node.getAttribute('aria-label')||'')+' '+node.textContent+' '+node.title).toLowerCase().includes(query));node.hidden=unavailable||filtered;if(filtered&&!unavailable)node.dataset.searchHidden='true';if(node.dataset.target)node.disabled=!target||target.disabled;}place();}
  search.oninput=filter;
  function open(){menu.hidden=false;search.value='';filter();trigger.setAttribute('aria-expanded','true');place();search.focus();}
  trigger.onclick=()=>menu.hidden?open():close();
  const outside=event=>{if(!menu.contains(event.target)&&!trigger.contains(event.target))close();};
  const keys=event=>{if(menu.hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
   if(event.target===search&&['Home','End'].includes(event.key))return;
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){const items=[...menu.querySelectorAll('button:not(:disabled)')].filter(node=>!node.hidden);if(!items.length)return;event.preventDefault();const index=items.indexOf(doc.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:index<0?(event.key==='ArrowUp'?items.length-1:0):(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();}
  };
  menu.addEventListener('click',event=>{if(event.target.closest('button'))close();});
  doc.addEventListener('pointerdown',outside);doc.addEventListener('keydown',keys,true);host.addEventListener('resize',place);
  // Move infrequent display options out of the primary drawing toolbar.
  const extra=doc.getElementById('extraReviewControls'),display=create('div','workspace-display-options');
  if(extra){const heading=extra.querySelector('.object-view-options-heading');if(!heading)display.append(create('h3','','Display options'));for(const id of ['netClassColors','viewOppositeDrawing','ratsnestToggle']){const node=doc.getElementById(id);if(node&&node.parentNode===toolbar){moved.push({node,parent:toolbar,next:node.nextSibling});display.append(node);}}if(heading)extra.insertBefore(display,heading.nextSibling);else extra.prepend(display);}
  const selection=doc.getElementById('selectionMode');if(selection){selection.setAttribute('aria-label','Select parts or nets');selection.options[0].textContent='Smart select';selection.options[1].textContent='Parts';selection.options[2].textContent='Nets';}
  const options=doc.getElementById('reviewToolsButton');if(options){options.classList.add('workspace-view-options');options.setAttribute('data-icon','settings');options.setAttribute('aria-label','View options, object visibility and variants');options.title='View options, object visibility, variants and rendering notes';}
  host.KiCadUIIcons?.decorate?.(viewNavigation);host.KiCadUIIcons?.decorate?.(trigger);host.KiCadUIIcons?.decorate?.(quick);host.KiCadUIIcons?.decorate?.(options);
  const instance={close,dispose(){observer?.disconnect();modeObserver?.disconnect();detachUI?.dispose();viewNavigation.remove();simulationDialog?.remove();host.removeEventListener('kicad-review:simulation-view',openSimulation);close();doc.removeEventListener('pointerdown',outside);doc.removeEventListener('keydown',keys,true);host.removeEventListener('resize',place);for(const item of moved.reverse())item.parent.insertBefore(item.node,item.next?.parentNode===item.parent?item.next:null);menu.remove();trigger.remove();display.remove();installations.delete(toolbar);}};
  installations.set(toolbar,instance);return instance;
 }
 if(typeof module==='object'&&module.exports){module.exports={install,secondary,installDetach,outsideWindow,detachableModes};return;}
 root.KiCadWorkspaceChrome={install};
 if(root.document){const start=()=>install(root.document,root);if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();}
})(globalThis);
