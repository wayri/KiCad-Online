/* A focused Android shell. Existing controllers continue owning actions and data. */

((root)=>{'use strict';

 const structureChanged=records=>records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&node.namespaceURI!=='http://www.w3.org/2000/svg'));

 const viewEntries=Object.freeze([['schematic','Schematic','sheet'],['layout','Layout','board'],['3d','3D','cube'],['draftsman','Draftsman','ruler'],['simulation','Simulation','analytics']]);

 function activateView(doc,key,simulation){

  if(!viewEntries.some(([id])=>id===key))return false;

  const mode=doc.getElementById('mode3d'),board=Boolean(mode&&!mode.hidden),three=mode?.getAttribute('aria-pressed')==='true';

  if(key==='3d'){if(!board||mode.disabled)return false;if(!three)mode.click();return true;}

  if((key==='layout'&&!board)||(key==='schematic'&&board)){const opposite=doc.getElementById('viewOppositeDrawing');if(!opposite||opposite.disabled)return false;opposite.click();return true;}

  if(three){if(mode.disabled)return false;mode.click();}

  if(key==='simulation'){simulation();return true;}

  if(key==='draftsman'){const action=doc.getElementById('openDraftsman');if(!action||action.disabled)return false;action.click();}

  return true;

 }

 // Reuse the adaptive shell's live controls; only their placement and captions change.
 function prepareDrawingStrip(doc){
  const rail=doc.getElementById('androidViewToolbar'),content=doc.querySelector('#androidToolsSheet>.android-sheet-content');
  if(!rail||!content)return false;
  const find=label=>[...rail.children].find(node=>node.getAttribute?.('aria-label')===label);
  const search=doc.getElementById('androidPrimarySearch')||find('Search');
  const inspect=doc.getElementById('androidRailProperties');
  const tools=doc.getElementById('androidPrimaryTools')||find('More drawing tools');
  const originalFit=doc.getElementById('androidFitDrawing');
  if(!search||!inspect||!tools||!originalFit)return false;
  search.id='androidPrimarySearch';tools.id='androidPrimaryTools';
  let fit=doc.getElementById('androidRailFit');
  if(!fit){fit=doc.createElement('button');fit.id='androidRailFit';fit.type='button';fit.setAttribute('aria-label','Fit drawing');fit.onclick=()=>originalFit.click();const icon=originalFit.querySelector('svg');if(icon)fit.append(icon.cloneNode(true));}
  // The adaptive organizer owns this original proxy; keep one visible Fit action.
  originalFit.hidden=true;
  const entries=[[search,'Search'],[inspect,'Inspect'],[fit,'Fit'],[tools,'Tools']];
  for(const [action,label]of entries){
   action.hidden=false;
   let caption=action.querySelector('.android-primary-caption');
   if(!caption){caption=doc.createElement('span');caption.className='android-primary-caption';caption.textContent=label;action.append(caption);}
  }
  tools.setAttribute('aria-label','Drawing tools');tools.title='Drawing tools';
  const primary=new Set(entries.map(([action])=>action));
  for(const action of [...rail.children]){
   // The shared sidebar controller owns its toggle's toolbar parent and visibility.
   if(primary.has(action)||action.id==='phoneSidebarToggle'||action.tagName!=='BUTTON')continue;
   const group=doc.querySelector('#androidToolGroup-more>.android-tool-section-body')||content;
   if(!action.querySelector('.button-label')){const label=doc.createElement('span');label.className='button-label';label.textContent=action.getAttribute('aria-label')||action.title;action.append(label);}
   group.append(action);
  }
  const current=[...rail.children].filter(action=>primary.has(action));
  if(entries.some(([action],index)=>current[index]!==action))rail.append(...primary);
  rail.classList.remove('android-drawing-rail');rail.classList.add('android-drawing-strip');
  doc.body.classList.remove('android-rail-hidden');
  const toggle=doc.getElementById('androidRailToggle');if(toggle)toggle.hidden=true;
  return true;
 }

 if(typeof module==='object'&&module.exports)module.exports={viewEntries,activateView,prepareDrawingStrip};

 const d=root.document;if(!d)return;



 const make=(tag,text)=>{const n=d.createElement(tag);if(text)n.textContent=text;return n;};

 function home(){

  const welcome=d.getElementById('welcome');if(!welcome)return;

  const title=welcome.querySelector('h1');if(title&&title.textContent!=='Your projects')title.textContent='Your projects';

  const sources=welcome.querySelector('.android-source-actions');

  if(sources&&!d.getElementById('androidOpenProjectPage')){

   const page=make('dialog');page.id='androidOpenProjectPage';const header=make('header'),back=make('button','Back');back.type='button';back.setAttribute('aria-label','Back');const backIcon=root.KiCadUIIcons?.icon('back');if(backIcon)back.replaceChildren(backIcon);back.onclick=()=>page.close();header.append(back,make('strong','Open project'));

   const content=make('div');content.className='android-sheet-content';content.append(make('p','Choose where your design is saved.'));const entries=make('div');entries.className='android-source-list';entries.append(...sources.children);for(const [index,entry]of [...entries.children].entries())entry.dataset.icon=['folder','sheet','github','gitlab','cloud'][index];root.KiCadUIIcons?.decorate?.(entries);content.append(entries);page.append(header,content);d.body.append(page);

   const open=make('button','Open project');open.type='button';open.id='androidOpenProject';open.dataset.icon='folder';open.onclick=()=>page.showModal();sources.append(open);root.KiCadUIIcons?.decorate?.(sources);

   entries.addEventListener('click',e=>{if(e.target.closest('button'))page.close();});

   const heading=sources.previousElementSibling;if(heading?.classList.contains('android-launch-heading'))heading.hidden=true;

  }

  for(const actions of [...welcome.querySelectorAll('.android-engineering-actions')])if(!actions.closest('#androidHomeTools')){

   const heading=actions.previousElementSibling;const group=make('details');group.id='androidHomeTools';group.append(make('summary','Engineering tools'));actions.before(group);if(heading?.classList.contains('android-launch-heading'))heading.hidden=true;group.append(actions);

  }

  const library=d.getElementById('welcomeLibrary'),heading=d.querySelector('#recentProjects>h2');if(library&&heading&&library.parentElement!==heading){library.textContent='See all';library.setAttribute('aria-label','See all saved projects');heading.append(library);}

  const menu=d.querySelector('#appMenuDialog>.android-sheet-content');if(menu){

   for(const [id,title,ids]of [['accounts','Accounts',['githubButton','gitlabButton']],['files','Open from device',['openFiles','openFolder','cloudOpen']],['help','Help & about',['androidAboutButton','androidReadMeButton','androidTermsButton','androidPrivacyButton']]]){

    let group=d.getElementById('androidMenu-'+id);if(!group){group=make('details');group.id='androidMenu-'+id;group.className='android-menu-section';group.append(make('summary',title));menu.append(group);}

    for(const key of ids){const action=d.getElementById(key);if(action?.parentElement===menu)group.append(action);}

   }

   const tools=menu.querySelector('.android-engineering-actions');if(tools&&!tools.closest('.android-menu-section')){const group=make('details');group.className='android-menu-section';group.append(make('summary','Engineering tools'));menu.append(group);group.append(tools);}

  }

 }

 let simulationDialog=null;

 function simulationMenu(){

  if(simulationDialog?.open)return;

  const page=make('dialog');simulationDialog=page;page.id='androidSimulationViews';page.setAttribute('aria-label','Simulation views');

  const header=make('header'),close=make('button','Close');close.type='button';close.setAttribute('aria-label','Close simulation views');close.onclick=()=>page.close();header.append(make('strong','Simulation'),close);

  const body=make('div');body.className='android-sheet-content';for(const [id,label,detail]of [['openSavedReports','Saved results','KiCad workbooks and wayriCAD analysis'],['openFastPI','Fast DC drop · experimental','Two-point DC copper screening']]){const source=d.getElementById(id),action=make('button');action.type='button';action.disabled=!source||source.disabled;action.append(make('strong',label),make('small',detail));action.onclick=()=>{page.close();source.click();};body.append(action);}

  page.append(header,body);page.addEventListener('click',event=>{if(event.target!==page)return;const rect=page.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)page.close();});page.addEventListener('close',()=>{page.remove();simulationDialog=null;});d.body.append(page);page.showModal();

 }

 root.addEventListener?.('kicad-review:simulation-view',simulationMenu);

 let detachSyncEnabled=true;
 root.addEventListener?.('kicad-review:detach-state',event=>{if(typeof event.detail?.enabled!=='boolean')return;detachSyncEnabled=event.detail.enabled;const input=d.getElementById('androidDetachSync');if(input)input.checked=detachSyncEnabled;});
 function detachMenu(){
  if(d.getElementById('androidDetachViews')?.open)return;
  const page=make('dialog');page.id='androidDetachViews';page.setAttribute('aria-label','Independent drawing views');const header=make('header'),close=make('button','Close');close.type='button';close.setAttribute('aria-label','Close independent views');close.onclick=()=>page.close();header.append(make('strong','Independent views'),close);const body=make('div');body.className='android-sheet-content';
  body.append(make('p','Opens a separate app view when supported by this device and host.'));
  for(const [mode,label]of viewEntries.slice(0,3)){const action=make('button','Open '+label+' separately');action.type='button';action.setAttribute('aria-label','Detach '+label+' view');action.onclick=()=>{page.close();root.dispatchEvent(new root.CustomEvent('kicad-review:detach-view',{detail:{mode}}));};body.append(action);}
  const label=make('label'),sync=make('input');sync.type='checkbox';sync.id='androidDetachSync';sync.checked=detachSyncEnabled;sync.setAttribute('aria-label','Cross-select detached views');sync.onchange=()=>{detachSyncEnabled=sync.checked;root.dispatchEvent(new root.CustomEvent('kicad-review:detach-sync',{detail:{enabled:sync.checked}}));};label.append(sync,d.createTextNode(' Cross-select linked views'));body.append(label);page.append(header,body);page.addEventListener('click',event=>{if(event.target!==page)return;const rect=page.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)page.close();});page.addEventListener('close',()=>page.remove());d.body.append(page);page.showModal();
 }
 function detachButton(holder){if(d.getElementById('androidDetachButton'))return;const action=make('button','Detach');action.id='androidDetachButton';action.type='button';action.setAttribute('aria-label','Open independent linked views');action.title='Open independent linked views';action.dataset.icon='compare';action.onclick=detachMenu;holder.append(action);root.KiCadUIIcons?.decorate?.(action);}
 function drawingViews(){

  if(!d.getElementById('androidViewToolbar')||d.getElementById('androidDrawingViews')||new URLSearchParams(root.location?.search||'').get('headerViews')==='1')return;

  const nav=make('nav');nav.id='androidDrawingViews';nav.setAttribute('aria-label','Drawing views');const buttons=new Map();

  for(const [key,label,icon]of viewEntries){const action=make('button');action.type='button';action.setAttribute('aria-label',label+' view');action.title=label;action.dataset.icon=icon;action.append(make('span',label));action.onclick=()=>activateView(d,key,simulationMenu);buttons.set(key,action);nav.append(action);}

  const sync=()=>{const mode=d.getElementById('mode3d'),board=Boolean(mode&&!mode.hidden),three=mode?.getAttribute('aria-pressed')==='true';for(const [key,action]of buttons){action.setAttribute('aria-pressed',String(key===(three?'3d':board?'layout':'schematic')));const target=key==='3d'?mode:key==='draftsman'?d.getElementById('openDraftsman'):key==='simulation'?d.getElementById('openSavedReports'):d.getElementById('viewOppositeDrawing');action.disabled=key==='3d'?!board||mode.disabled:!target||target.disabled;}};

  detachButton(nav);d.body.prepend(nav);root.KiCadUIIcons?.decorate?.(nav);sync();const mode=d.getElementById('mode3d');if(mode)new MutationObserver(sync).observe(mode,{attributes:true,attributeFilter:['hidden','disabled','aria-pressed']});

 }

 function drawing(){

  const rail=d.getElementById('androidViewToolbar');if(!rail)return;

  prepareDrawingStrip(d);

  const selection=d.getElementById('selectionMode'),group=d.querySelector('#androidToolGroup-highlight>.android-tool-section-body');

  if(selection&&group&&selection.parentElement===rail){const label=make('label','Selection mode');label.className='android-selection-field';label.append(selection);group.prepend(label);}

 }

 function workspaceMenu(){

  const page=d.getElementById('androidWorkspaceSheet'),content=page?.querySelector('.android-sheet-content');if(!content)return;

  const section=(id,title,details=false)=>{let group=d.getElementById(id);if(!group){group=make(details?'details':'section');group.id=id;group.className='android-menu-group';group.append(make(details?'summary':'h2',title));content.append(group);}return group;};

  const view=section('androidWorkspaceViewActions','Workspace'),project=section('androidWorkspaceProjectActions','Project'),presentation=section('androidWorkspacePresentation','Presentation',true);

  detachButton(view);
  const quick=d.getElementById('androidWorkspaceActions');if(quick&&quick.parentElement!==view)view.append(quick);

  for(const [id,label]of [['androidQuickSplit','Split schematic & layout'],['androidQuickCompare','Compare revisions']]){const action=d.getElementById(id);if(action&&!action.dataset.menuPrepared){action.dataset.menuPrepared='true';action.textContent=label;root.KiCadUIIcons?.decorate?.(quick);}}

  const original=d.getElementById('projectTools');if(original){

   if(original.parentElement!==view)view.append(original);

   for(const action of original.querySelectorAll(':scope>button')){

    // Android's pop-out transport opens the current view; it is not a separate

    // window. Keep that duplicate and the original split trigger out of the menu.

    if(action.id==='splitView'||/pop out/i.test(action.textContent)){if(!action.hidden)action.hidden=true;continue;}

    if(/fit panes/i.test(action.textContent)&&!action.dataset.menuPrepared){action.dataset.menuPrepared='true';action.dataset.icon='fit';action.textContent='Fit drawing panes';root.KiCadUIIcons?.decorate?.(action.parentElement);}

   }

  }

  const manage=page.querySelector('button[aria-label="Bookmark, save offline or download this project"]');if(manage&&manage.parentElement!==project){manage.textContent='Storage & sharing';manage.dataset.icon='folder';project.append(manage);root.KiCadUIIcons?.decorate?.(project);}

  const launch=content.querySelector('.presentation-launch');if(launch&&launch.parentElement!==presentation)presentation.append(launch);

  const heading=page.querySelector('header strong');if(heading&&heading.textContent!=='Project menu')heading.textContent='Project menu';

 }

 let scheduled=false;function refresh(){scheduled=false;home();drawing();drawingViews();workspaceMenu();}

 const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(refresh);};

 const start=()=>{d.body.classList.add('android-design');refresh();new MutationObserver(records=>{if(structureChanged(records))schedule();}).observe(d.body,{childList:true,subtree:true});};

 if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',start,{once:true});else start();

})(globalThis);
