/* Saved-design BOM procurement drafts. Management fields do not modify KiCad. */
((root) => {
'use strict';
const FIELDS = ['Manufacturer', 'MPN', 'Supplier', 'SKU', 'Notes', 'status', 'Unit price', 'Currency', 'Assembly'];
const STATUSES = ['not ordered', 'ordered', 'received'];
const ASSEMBLY = ['not started', 'placed', 'soldered', 'verified'];
const MAX_PARTS = 100000, MAX_DRAFT = 4 * 1024 * 1024, MAX_FIELD = 4096;
const text = value => String(value ?? '');
const compare = (a, b) => text(a).localeCompare(text(b), undefined, {numeric:true, sensitivity:'base'});
function scopeKey(scope) {
 const key = typeof scope === 'string' ? scope : JSON.stringify(scope);
 if (!key || key.length > 4096) throw new Error('A bounded revision/project scope is required.');
 return key;
}
function identity(o) {
 return JSON.stringify([text(o.path), o.kind, o.kind === 'symbol' ? (o.reference || o.uuid || o.id) : (o.uuid || o.id || o.reference)]);
}
function model(objects, kind = 'symbol', metadata = {}) {
 if (!Array.isArray(objects) || objects.length > MAX_PARTS) throw new Error('BOM object limit exceeded.');
 if (!['symbol','footprint'].includes(kind)) throw new Error('Choose schematic symbols or PCB footprints.');
 const unique = new Map();
 for (const o of objects) {
  if (!o || o.kind !== kind) continue;
  if (!(o.reference || o.uuid || o.id)) continue;
  const id = identity(o); if (unique.has(id)) continue;
  const p = o.properties || {}, saved = metadata[id] || {};
  const management = Object.fromEntries(FIELDS.map(f => [f, text(saved[f] ?? (f === 'status' ? 'not ordered' : f==='Assembly'?'not started':p[f]))]));
  if (!STATUSES.includes(management.status)) management.status = 'not ordered';
  if(!ASSEMBLY.includes(management.Assembly))management.Assembly='not started';
  unique.set(id, {id, object:o, reference:text(o.reference), value:text(p.Value), footprint:text(p.Footprint || p['Library ID']), path:text(o.path), side:text(o.side||p.Side), properties:{...p}, populated:o.populated !== false, excluded:!!o.excludeFromBom||(kind==='symbol'&&text(o.reference).startsWith('#')), management});
 }
 return [...unique.values()].sort((a,b) => compare(a.reference,b.reference) || compare(a.path,b.path));
}
function query(parts, options = {}) {
 const search = text(options.search).toLocaleLowerCase().trim();
 return parts.filter(p => (options.population !== 'fitted' || p.populated) && (options.population !== 'dnp' || !p.populated) &&
  (options.excluded !== 'hide' || !p.excluded) && (options.excluded !== 'only' || p.excluded) &&
  (!options.status || options.status === 'all' || p.management.status === options.status) &&
  (!options.assembly || options.assembly==='all'||(options.assembly==='unfinished'?assemblyWorkItem(p)&&p.management.Assembly!=='verified':p.management.Assembly===options.assembly)) &&
  (!options.side||options.side==='all'||p.side===options.side) &&
  (!search || [p.reference,p.value,p.footprint,p.path,...Object.values(p.management),...Object.values(p.properties)].some(v => text(v).toLocaleLowerCase().includes(search))))
  .sort((a,b) => (options.sort === 'value' ? compare(a.value,b.value) : compare(a.reference,b.reference)) || compare(a.reference,b.reference) || compare(a.path,b.path));
}
function assemblyWorkItem(part){return !!part.populated&&!part.excluded;}
function assemblySummary(parts){const fitted=parts.filter(assemblyWorkItem),states=Object.fromEntries(ASSEMBLY.map(state=>[state,0]));for(const part of fitted)states[ASSEMBLY.includes(part.management.Assembly)?part.management.Assembly:'not started']++;return{total:parts.length,fitted:fitted.length,dnp:parts.filter(p=>!p.populated).length,excluded:parts.filter(p=>p.excluded).length,states,verified:states.verified,percent:fitted.length?Math.round(states.verified/fitted.length*100):0};}
const assemblyClass=state=>ASSEMBLY.includes(state)?'assembly-'+state.replaceAll(' ','-'):'assembly-mixed';
const procurementClass=state=>STATUSES.includes(state)?'procurement-'+state.replaceAll(' ','-'):'assembly-mixed';
function nextAssembly(parts,currentId){
 const current=parts.findIndex(p=>p.id===currentId);
 for(let offset=1;offset<=parts.length;offset++){const p=parts[(current+offset)%parts.length];if(assemblyWorkItem(p)&&p.management.Assembly!=='verified')return p;}
 return null;
}
function group(parts) {
 const groups = new Map();
 for (const p of parts) {
  const custom=Object.entries(p.properties||{}).filter(([f])=>!['reference','references','refs','ref','designator','designators','value','footprint','dnp','file','path',...FIELDS.map(f=>f.toLowerCase())].includes(f.toLowerCase())).sort(([a],[b])=>compare(a,b));
  const key = JSON.stringify([p.value,p.footprint,p.populated,p.excluded,p.side,...FIELDS.map(f=>p.management[f]),custom]);
  if (!groups.has(key)) groups.set(key,{id:key,value:p.value,footprint:p.footprint,populated:p.populated,excluded:p.excluded,management:p.management,parts:[],quantity:0});
  const g = groups.get(key); g.parts.push(p); g.quantity++;
 }
 return [...groups.values()];
}
function csv(parts, options={}) {
 const cell = value => { let s = text(value); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g,'""') + '"'; };
 const extra=[...new Set(parts.flatMap(p=>Object.keys(p.properties||{})))].filter(f=>!['Reference','Value','Footprint','DNP','Library ID',...FIELDS].includes(f)).sort(compare).slice(0,128);
 const boards=boardCount(options.boards??1),rows = [['Reference','Value','Footprint','Population','Excluded from BOM','File','Quantity per board','Build quantity','Side',...FIELDS,...extra]];
 for (const row of options.grouped?group(parts):parts){const p=row.parts?.[0]||row,n=row.quantity||1;rows.push([row.parts?row.parts.map(p=>p.reference).join(', '):p.reference,p.value,p.footprint,p.populated?'Fitted':'DNP',p.excluded?'Yes':'No',row.parts?[...new Set(row.parts.map(p=>p.path))].join('; '):p.path,n,p.populated&&!p.excluded?n*boards:0,p.side,...FIELDS.map(f=>p.management[f]),...extra.map(f=>row.parts?[...new Set(row.parts.map(p=>text(p.properties[f])))].join(' | '):p.properties?.[f])]);}
 return rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
function boardCount(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>1000000)throw Error('Build quantity must be a whole number from 1 to 1,000,000.');return n;}
function totals(parts, boards=1){boards=boardCount(boards);const currencies=Object.create(null);let fitted=0,unpriced=0,verified=0;
 for(const p of parts){if(!p.populated||p.excluded)continue;fitted++;if(p.management.Assembly==='verified')verified++;const raw=p.management['Unit price'],price=/^\d+(\.\d{1,6})?$/.test(raw)?Number(raw):NaN,currency=p.management.Currency.trim().toUpperCase();if(!Number.isFinite(price)||!/^[A-Z]{3}$/.test(currency)){unpriced++;continue;}currencies[currency]=(currencies[currency]||0)+price*boards;}
 return{boards,fitted,buildParts:fitted*boards,unpriced,verified,currencies};
}
function validateMetadata(input, scope, allowedIds) {
 if (typeof input === 'string') { if (input.length > MAX_DRAFT) throw new Error('Metadata exceeds 4 MiB.'); input = JSON.parse(input); }
 if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1 || input.scope !== scopeKey(scope)) throw new Error('Metadata must use version 1 and the same saved revision scope.');
 if (!input.parts || typeof input.parts !== 'object' || Array.isArray(input.parts)) throw new Error('Metadata parts must be an object.');
 const entries = Object.entries(input.parts); if (entries.length > MAX_PARTS) throw new Error('Metadata part limit exceeded.');
 const result = Object.create(null); let size = 0;
 for (const [id, record] of entries) {
  if (id.length > 8192 || (allowedIds && !allowedIds.has(id))) throw new Error('Metadata contains an unknown saved part identity.');
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid management record.');
  const normalized = Object.create(null);
  for (const [field, value] of Object.entries(record)) {
   if (!FIELDS.includes(field) || typeof value !== 'string' || value.length > MAX_FIELD || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('Invalid or oversized management field.');
   if (field === 'status' && !STATUSES.includes(value)) throw new Error('Invalid procurement status.');
   if (field === 'Assembly' && !ASSEMBLY.includes(value)) throw new Error('Invalid assembly status.');
   if (field === 'Unit price' && value!==''&&(!/^\d+(\.\d{1,6})?$/.test(value)||!Number.isFinite(Number(value))||Number(value)>1e9)) throw new Error('Invalid unit price; use a nonnegative decimal up to 1,000,000,000.');
   if (field === 'Currency' && value!==''&&!/^[A-Za-z]{3}$/.test(value)) throw new Error('Invalid currency; use a three-letter code.');
   size += field.length + value.length; normalized[field] = value;
  }
  size += id.length; if (size > MAX_DRAFT) throw new Error('Metadata exceeds 4 MiB.'); result[id] = normalized;
 }
 return result;
}
function metadataJSON(scope, parts) {
 const envelope = {version:1,scope:scopeKey(scope),parts};
 validateMetadata(envelope,scope); const json = JSON.stringify(envelope,null,2);
 if (json.length > MAX_DRAFT) throw new Error('Metadata exceeds 4 MiB.'); return json;
}
function resetMetadata(metadata, ids, mode='assembly') {
 if(!['assembly','procurement','all'].includes(mode))throw Error('Choose the management fields to reset.');
 const next=Object.assign(Object.create(null),metadata);
 for(const id of new Set(ids)){
  if(typeof id!=='string'||id.length>8192)throw Error('Invalid reset part identity.');
  if(mode==='all')next[id]={Assembly:'not started',status:'not ordered'};
  else next[id]={...(metadata[id]||{}),[mode==='assembly'?'Assembly':'status']:mode==='assembly'?'not started':'not ordered'};
 }
 return next;
}
function open(options) {
 const {objects,scope,onLocate,onExport,onEdit,onComment} = options, document = root.document;
 const fieldTable=root.KiCadBomFieldTable||(typeof require==='function'?require('./bom-field-table.js'):null);
 if(!fieldTable)throw Error('BoM field table is unavailable. Reload the viewer.');
 const revision = scopeKey(scope), storageKey = 'kicad-bom-manager:v1:' + revision;
 const storage = options.storage === undefined ? (()=>{try{return root.localStorage;}catch{return null;}})() : options.storage;
 const allIds = new Set([...model(objects,'symbol'),...model(objects,'footprint')].map(p=>p.id));
 let metadata = Object.create(null), initialWarning = '';
 try { const saved = storage?.getItem(storageKey); if (saved) metadata = validateMetadata(saved,scope,allIds); }
 catch (error) { initialWarning = 'Saved draft could not be loaded: '+error.message; }
 const dialog = document.createElement('dialog'); dialog.className = 'bom-manager bom-management-dialog'+(options.modal===false?' bom-cross-select':'');if(options.modal===false)dialog.setAttribute('data-cross-select-panel','true');dialog.setAttribute('aria-label','Bill of materials and assembly management');
 const el = (tag, content, cls) => {const node=document.createElement(tag);if(content !== undefined)node.textContent=content;if(cls)node.className=cls;return node;};
 const button = (label, action) => {const b=el('button',label);b.type='button';b.addEventListener('click',action);return b;};
 const header=el('header',undefined,'bom-manager-heading'), title=el('h2','Bill of materials'),countLabel=el('output',undefined,'bom-manager-count');countLabel.setAttribute('aria-label','Matching and total parts');header.append(title,countLabel,button('Close',()=>dialog.close()));
 const note=el('p','Procurement fields are local management metadata for this saved revision. They do not edit KiCad source. Multi-unit schematic symbols count once per saved file/reference; repeated sheet instances are not expanded.','bom-manager-note');
 const controls=el('div',undefined,'bom-manager-controls'), result=el('div',undefined,'bom-manager-results'), feedback=el('p',initialWarning,'bom-manager-feedback'); feedback.setAttribute('role','status');
 const select = (label, pairs) => {const wrap=el('label',label), s=el('select');for(const [value,name] of pairs){const opt=el('option',name);opt.value=value;s.append(opt);}wrap.append(s);controls.append(wrap);s.addEventListener('change',render);return s;};
 const source=select('Source',[['symbol','Schematic symbols'],['footprint','PCB footprints']]);
 let assemblyVariant=null;
 if(options.variants?.length){assemblyVariant=select('Assembly variant',options.variants.map(v=>[v.id,v.name]));assemblyVariant.value=options.variant||'default';assemblyVariant.addEventListener('change',()=>{dialog.close();options.onVariant?.(assemblyVariant.value);});}
 source.value = typeof scope === 'object' && ['symbol','footprint'].includes(scope.kind) ? scope.kind : model(objects,'symbol').length ? 'symbol':'footprint';
 const view=select('View',[['parts','Individual parts'],['groups','Grouped quantities']]);
 const population=select('Population',[['all','All'],['fitted','Fitted'],['dnp','DNP']]);
 const excluded=select('Excluded',[['hide','Hide excluded'],['all','Include excluded'],['only','Only excluded']]);
 const status=select('Procurement status',[['all','All statuses'],...STATUSES.map(s=>[s,s])]);
 const assembly=select('Assembly progress',[['all','All'],['unfinished','Unfinished fitted parts'],...ASSEMBLY.map(s=>[s,s])]);
 const side=select('Side',[['all','All sides'],['F','Front'],['B','Back']]);
 const buildLabel=el('label','Boards to build'),build=el('input');build.type='number';build.min='1';build.max='1000000';build.step='1';build.value='1';build.setAttribute('aria-label','Boards to build');buildLabel.append(build);controls.append(buildLabel);build.addEventListener('input',render);
 const sort=select('Sort',[['reference','Reference'],['value','Value']]);
 const searchLabel=el('label','Search'), search=el('input');search.type='search';search.placeholder='Reference, value, MPN, supplier…';searchLabel.append(search);controls.append(searchLabel);search.addEventListener('input',render);searchLabel.className='bom-manager-search';
 const summary=el('div',undefined,'bom-manager-summary'), actions=el('div',undefined,'bom-manager-actions');
 const filtered = () => query(model(objects,source.value,metadata),{search:search.value,population:population.value,excluded:excluded.value,status:status.value,assembly:assembly.value,side:side.value,sort:sort.value});
 const selectedParts=options.selectedId==null?[]:model(objects,source.value,metadata).filter(p=>p.id===options.selectedId||p.object.id===options.selectedId);
 let assemblyCursor=selectedParts.length===1?selectedParts[0].id:null;
 const nextPart=button('Next unfinished part',()=>{const part=nextAssembly(filtered(),assemblyCursor);if(!part)return;choosePart(part);feedback.textContent=`${part.reference} · ${part.management.Assembly} · local checklist; status unchanged.`;});nextPart.title='Locate the next fitted, non-excluded, unverified part matching the current filters';controls.append(nextPart);
 const exportFile = (name, content, mime) => {if(onExport){try{return onExport(name,content,mime);}catch(error){feedback.textContent='Export failed: '+error.message;return;}}const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 actions.append(button('Export visible CSV',()=>{try{exportFile('bom.csv',visibleCSV(),'text/csv;charset=utf-8');}catch(e){feedback.textContent=e.message;}}),button('Export metadata JSON',()=>{try{exportFile('bom-management.json',metadataJSON(scope,metadata),'application/json');}catch(e){feedback.textContent=e.message;}}));
 const importLabel=el('label','Import metadata JSON', 'bom-manager-import'), importer=el('input');importer.type='file';importer.accept='.json,application/json';importLabel.append(importer);actions.append(importLabel);
 importer.addEventListener('change',async()=>{const file=importer.files[0];if(!file)return;try{if(file.size>MAX_DRAFT)throw new Error('Metadata exceeds 4 MiB.');const incoming=validateMetadata(await file.text(),scope,allIds);if(!persist(incoming))return;metadata=incoming;render();feedback.textContent='Metadata imported for this saved revision.';}catch(e){feedback.textContent='Import failed: '+e.message;}finally{importer.value='';}});
 let fieldDescriptors=[],fieldSignature='',fieldSource='',renderedLimit=200,showActions=true;
 const columnPreferences=new Map(),columnStorageKey=kind=>'kicad-bom-columns:v1:'+revision+':'+kind;
 function columnPreference(kind){if(columnPreferences.has(kind))return columnPreferences.get(kind);let preference={fields:Object.create(null),actions:true};try{const raw=storage?.getItem(columnStorageKey(kind));if(raw&&raw.length<=65536){const saved=JSON.parse(raw);if(saved?.version===1&&saved.fields&&typeof saved.fields==='object'&&!Array.isArray(saved.fields)&&Object.keys(saved.fields).length<=1024)preference={fields:Object.fromEntries(Object.entries(saved.fields).filter(([key,value])=>key.length<=4096&&typeof value==='boolean')),actions:typeof saved.actions==='boolean'?saved.actions:true};}}catch{}columnPreferences.set(kind,preference);return preference;}
 function saveColumns(){const preference={fields:Object.fromEntries(fieldDescriptors.map(f=>[f.key,!!f.show])),actions:showActions};columnPreferences.set(source.value,preference);try{const json=JSON.stringify({version:1,...preference});if(json.length>65536||fieldDescriptors.length>1024)throw Error('Too many column preferences to save.');if(!storage)throw Error('Browser storage unavailable.');storage.setItem(columnStorageKey(source.value),json);}catch(error){feedback.textContent='Columns changed for this session; preferences could not be saved: '+error.message;}}
 const fieldOptions=el('details',undefined,'bom-manager-field-options');fieldOptions.open=false;fieldOptions.append(el('summary','Columns'));const fieldSettings=el('div',undefined,'bom-manager-field-settings');
 const columnControls=el('div',undefined,'bom-manager-column-controls'),columnSearch=el('input');columnSearch.type='search';columnSearch.placeholder='Find a column…';columnSearch.setAttribute('aria-label','Find BoM column');columnSearch.addEventListener('input',()=>{for(const row of fieldSettings.children[0]?.children||[])if(row.dataset.column)row.hidden=!row.dataset.column.includes(columnSearch.value.trim().toLowerCase());});
 columnControls.append(columnSearch,button('Show all columns',()=>{for(const f of fieldDescriptors)f.show=true;showActions=true;saveColumns();fieldSignature='';render();}),button('Reset columns',()=>{const defaults=new Map(fieldTable.fields(model(objects,source.value,metadata)).map(f=>[f.key,f.show]));for(const f of fieldDescriptors)f.show=defaults.get(f.key)||f.key==='Reference';showActions=true;saveColumns();fieldSignature='';render();}));fieldOptions.append(el('p','Choose the fields shown in the table and visible CSV export. Reference stays visible for part selection.','bom-manager-note'),columnControls,fieldSettings);
 const columnsButton=button('Columns',()=>{fieldOptions.open=!fieldOptions.open;columnsButton.setAttribute('aria-expanded',String(fieldOptions.open));if(fieldOptions.open)columnSearch.focus();});columnsButton.className='bom-manager-columns-button';columnsButton.setAttribute('aria-label','Choose BoM columns');columnsButton.setAttribute('aria-expanded','false');columnsButton.title='Show or hide standard, supplier and custom fields';controls.append(columnsButton);fieldOptions.addEventListener('toggle',()=>columnsButton.setAttribute('aria-expanded',String(fieldOptions.open)));
 const groupLabel=el('label',undefined,'bom-manager-group'),groupCheck=el('input');groupCheck.type='checkbox';groupCheck.checked=false;groupCheck.setAttribute('aria-label','Group symbols');groupLabel.append(groupCheck,el('span','Group symbols'));controls.append(groupLabel);view.parentElement.remove();groupCheck.addEventListener('change',()=>{view.value=groupCheck.checked?'groups':'parts';render();});
 const groupingLabel=el('label','Group by'),grouping=el('select');grouping.setAttribute('aria-label','Group BoM by');for(const p of fieldTable.PRESETS){const opt=el('option',p.label);opt.value=p.id;grouping.append(opt);}grouping.value='value-footprint';groupingLabel.append(grouping);groupingLabel.className='bom-manager-grouping';controls.append(groupingLabel);grouping.addEventListener('change',()=>{fieldDescriptors=fieldTable.preset(fieldDescriptors,grouping.value);fieldSignature='';groupCheck.checked=true;view.value='groups';render();});
 const gridLayout=el('div',undefined,'bom-manager-field-layout');gridLayout.append(result);
 function prepareFields(all){const discovered=fieldTable.fields(all),signature=source.value+JSON.stringify(discovered.map(f=>f.key));if(signature===fieldSignature)return;fieldSignature=signature;const sameSource=fieldSource===source.value,previous=new Map((sameSource?fieldDescriptors:[]).map(f=>[f.key,f])),preference=columnPreference(source.value);fieldSource=source.value;showActions=preference.actions;fieldDescriptors=discovered.map(f=>({...f,...(typeof preference.fields[f.key]==='boolean'?{show:preference.fields[f.key]}:{}),...(previous.has(f.key)?{show:previous.get(f.key).show,groupBy:previous.get(f.key).groupBy}:{}),...(f.key==='Reference'?{show:true}:{})}));fieldSettings.replaceChildren();const table=el('table'),head=el('tr');for(const name of ['Field','Show','Group by'])head.append(el('th',name));table.append(head);for(const field of fieldDescriptors){const row=el('tr');row.dataset.column=field.label.toLowerCase();row.hidden=!row.dataset.column.includes(columnSearch.value.trim().toLowerCase());row.append(el('td',field.label));for(const key of ['show','groupBy']){const cell=el('td'),check=el('input');check.type='checkbox';check.checked=field[key];if(field.key==='Reference'&&key==='show'){check.checked=field.show=true;check.disabled=true;}check.setAttribute('aria-label',(key==='show'?'Show ':'Group by ')+field.label);check.addEventListener('change',()=>{field[key]=check.checked;if(key==='groupBy'){grouping.value='custom';groupCheck.checked=true;view.value='groups';}else saveColumns();render();});cell.append(check);row.append(cell);}table.append(row);}const actionsRow=el('tr');actionsRow.dataset.column='actions';actionsRow.hidden=!'actions'.includes(columnSearch.value.trim().toLowerCase());actionsRow.append(el('td','Actions'));const actionsCell=el('td'),actionsCheck=el('input');actionsCheck.type='checkbox';actionsCheck.checked=showActions;actionsCheck.setAttribute('aria-label','Show Actions');actionsCheck.addEventListener('change',()=>{showActions=actionsCheck.checked;saveColumns();render();});actionsCell.append(actionsCheck);actionsRow.append(actionsCell,el('td','—'));table.append(actionsRow);fieldSettings.append(table);}

 const content=el('div',undefined,'bom-manager-content android-sheet-content');
 const filters=el('details',undefined,'bom-manager-filters'),filterHeading=el('summary','Filters'),filterControls=el('div',undefined,'bom-manager-controls');filterHeading.title='Source, variant, population, sorting and build setup';filters.append(filterHeading,filterControls);filterControls.append(source.parentElement);if(assemblyVariant)filterControls.append(assemblyVariant.parentElement);filterControls.append(button('Reset filters',()=>{population.value='all';excluded.value='hide';status.value='all';assembly.value='all';side.value='all';sort.value='reference';search.value='';render();}));
 for(const selector of [population,excluded,status,assembly,side,sort])filterControls.append(selector.parentElement);
 filterControls.append(buildLabel,nextPart);
 const info=el('details',undefined,'bom-manager-info'),infoHeading=el('summary','About');info.append(infoHeading,note);
 const transfers=el('details',undefined,'bom-manager-transfers'),transferHeading=el('summary','Import / export');transfers.append(transferHeading,actions);
 const resets=el('details',undefined,'bom-manager-resets');resets.append(el('summary','Reset progress / fields'));
 const resetActions=el('div',undefined,'bom-manager-actions');
 const resetMatching=button('Reset matching parts…',()=>requestReset(filtered(),'matching the current source and filters'));
 const resetAll=button('Reset entire source…',()=>requestReset(model(objects,source.value,metadata),'in the entire '+(source.value==='symbol'?'schematic symbol':'PCB footprint')+' source, including hidden, excluded and DNP parts'));
 resetActions.append(resetMatching,resetAll);resets.append(resetActions);
 const totalsPanel=el('details',undefined,'bom-manager-totals');totalsPanel.append(el('summary','Totals'),summary);
 const tools=el('div',undefined,'bom-manager-tools');tools.append(filters,fieldOptions,transfers,resets,totalsPanel,info);
 // Keep a single optional panel open so settings never consume the whole table.
 for(const panel of [filters,fieldOptions,transfers,resets,totalsPanel,info])panel.addEventListener('toggle',()=>{if(panel.open)for(const other of tools.children)if(other!==panel)other.open=false;});
 const tracker=el('section',undefined,'bom-assembly-tracker');tracker.setAttribute('aria-label','Assembly checklist progress and status filters');
 controls.prepend(searchLabel);content.append(controls,tracker,tools,feedback,gridLayout);dialog.append(header,content);document.body.append(dialog);
 function persist(next) {
  let json;try {json=metadataJSON(scope,next);if(!storage)throw new Error('Browser draft storage is unavailable.');storage.setItem(storageKey,json);}
  catch(e){feedback.textContent='Draft was not saved: '+e.message;return false;}
  try{options.onMetadataChanged?.(JSON.parse(json).parts);}catch(e){feedback.textContent='Draft saved; progress refresh failed: '+e.message;}return true;
 }
 function choosePart(part){assemblyCursor=part.id;render(renderedLimit);onLocate?.(part.object);}
 function locate(p) {const b=button(p.reference||'(unannotated)',()=>choosePart(p));b.className='bom-manager-reference '+(assemblyWorkItem(p)?assemblyClass(p.management.Assembly):'assembly-inactive');b.setAttribute('aria-pressed',String(p.id===assemblyCursor));b.setAttribute('aria-label',(p.reference||'Unannotated part')+' · '+p.path+' · '+p.management.Assembly+' · select this part');b.title=p.path+' · '+p.management.Assembly;return b;}
 function assemblyBadges(holder,parts){const work=parts.filter(assemblyWorkItem);if(!work.length){holder.append(el('span','Not an assembly item','assembly-badge assembly-inactive'));return;}const counts=assemblySummary(work).states;for(const state of ASSEMBLY)if(counts[state])holder.append(el('span',state+(parts.length>1?' · '+counts[state]:''),'assembly-badge '+assemblyClass(state)));}
 let resetDialog=null;
 function requestReset(parts,scopeDescription){
  if(resetDialog||!parts.length)return;
  const targets=[...new Map(parts.map(p=>[p.id,p])).values()];
  const warning=el('dialog',undefined,'bom-reset-confirmation');resetDialog=warning;warning.setAttribute('role','alertdialog');warning.setAttribute('aria-label','Warning: reset saved BoM management fields');
  warning.append(el('h2','Warning: reset saved BoM fields'),el('p',`${targets.length} part${targets.length===1?'':'s'} ${scopeDescription}. This replaces saved local management data. It cannot be undone here; export metadata first if you need a backup.`,'bom-reset-warning'));
  const list=el('ul',undefined,'bom-reset-targets');for(const part of targets.slice(0,30))list.append(el('li',(part.reference||'(unannotated)')+' · '+part.path));if(targets.length>30)list.append(el('li',`… and ${targets.length-30} more parts`));warning.append(list);
  const label=el('label','Fields to reset'),mode=el('select');mode.setAttribute('aria-label','Fields to reset');for(const[value,name]of [['assembly','Assembly progress only'],['procurement','Procurement status only'],['all','All local management fields']]){const option=el('option',name);option.value=value;mode.append(option);}mode.value='assembly';label.append(mode);
  const effect=el('p',undefined,'bom-reset-effect'),ack=el('label',undefined,'bom-reset-ack'),check=el('input');check.type='checkbox';ack.append(check,el('span','I understand that the selected local data will be replaced.'));
  const message=el('p');message.setAttribute('role','status');
  const confirm=button(`Reset ${targets.length} part${targets.length===1?'':'s'}`,()=>{if(!check.checked)return;confirm.disabled=true;const next=resetMetadata(metadata,targets.map(p=>p.id),mode.value);if(!persist(next)){message.textContent=feedback.textContent;confirm.disabled=false;return;}metadata=next;warning.close();render();feedback.textContent=`Reset ${mode.value==='assembly'?'assembly progress':mode.value==='procurement'?'procurement status':'local management fields'} for ${targets.length} parts. KiCad sources were not changed.`;});confirm.className='bom-reset-danger';confirm.disabled=true;
  const update=()=>{check.checked=false;confirm.disabled=true;effect.textContent=mode.value==='assembly'?'Assembly will become “not started”. Procurement, prices, notes and other fields are preserved.':mode.value==='procurement'?'Procurement status will become “not ordered”. Assembly progress, prices, notes and other fields are preserved.':'Assembly becomes “not started” and procurement becomes “not ordered”. Local manufacturer, MPN, supplier, SKU, price, currency and notes overrides are removed; original saved KiCad field values remain.';};
  mode.addEventListener('change',update);check.addEventListener('change',()=>{confirm.disabled=!check.checked;});const cancel=button('Cancel',()=>warning.close()),buttons=el('div',undefined,'bom-manager-actions');buttons.append(cancel,confirm);warning.append(label,effect,el('p','This does not change KiCad source files, DNP/variant definitions or published provider content.'),ack,message,buttons);
  warning.addEventListener('close',()=>{resetDialog=null;warning.remove();},{once:true});document.body.append(warning);update();warning.showModal();cancel.focus();
 }
 function edit(part, targets=[part]) {
  for(const child of [...result.children])if(child.className==='bom-manager-editor')child.remove();
  const panel=el('section',undefined,'bom-manager-editor');panel.append(el('h3','Management fields: '+part.reference+(targets.length>1?' · applies to '+targets.length+' parts':'')));
  const form=el('form'), inputs={}, initial={};
  if(targets.length>1)panel.append(el('p','Only changed fields apply to the group. Mixed values are preserved unless replaced.'));
  for(const field of FIELDS){const states=field==='status'?STATUSES:field==='Assembly'?ASSEMBLY:null,label=el('label',field), input=el(states?'select':field==='Notes'?'textarea':'input'),mixed=targets.some(p=>p.management[field]!==part.management[field]);if(states){if(mixed){const opt=el('option','<mixed>');opt.value='';input.append(opt);}for(const s of states){const opt=el('option',s);opt.value=s;input.append(opt);}}else input.maxLength=MAX_FIELD;input.value=mixed?'':part.management[field];if(mixed)input.placeholder='<mixed>';initial[field]=input.value;label.append(input);form.append(label);inputs[field]=input;}
  const save=el('button','Save management draft');save.type='submit';save.className='primary';form.append(save,button('Reset saved fields…',()=>requestReset(targets,targets.length===1?'for this part':'for this group')),button('Cancel',()=>panel.remove()));
  form.addEventListener('submit',e=>{e.preventDefault();const changed=FIELDS.filter(f=>targets.length===1||inputs[f].value!==initial[f]);if(!changed.length){feedback.textContent='No management fields changed.';return;}const record=Object.fromEntries(changed.map(f=>[f,inputs[f].value])),next={...metadata,...Object.fromEntries(targets.map(p=>[p.id,{...p.management,...record}]))};if(persist(next)){metadata=next;render();feedback.textContent='Management draft saved locally.';}});
  panel.append(form);result.prepend(panel);inputs.Manufacturer.focus();
 }
 function editNative(part) {
  Promise.resolve().then(()=>onEdit(part.object)).catch(error=>{feedback.textContent='Source editor failed: '+error.message;});
 }
 function visibleCSV(){const columns=fieldDescriptors.filter(f=>f.show),rows=fieldTable.rows(filtered(),fieldDescriptors,view.value==='groups'),quote=value=>{let v=text(value);if(/^\s*[=+@-]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};return [columns.map(f=>f.label),...rows.map(row=>columns.map(f=>row.values[f.key]))].map(row=>row.map(quote).join(',')).join('\r\n');}
 function render(limit = 200) {
  if (typeof limit !== 'number') limit = 200;renderedLimit=limit;
  result.replaceChildren();const parts=filtered(), all=model(objects,source.value,metadata);prepareFields(all);
  const progress=assemblySummary(all);tracker.replaceChildren();const progressHeading=el('div',undefined,'bom-assembly-heading'),bar=el('progress');bar.max=progress.fitted||1;bar.value=progress.verified;bar.setAttribute('aria-label','Verified fitted, non-excluded parts');progressHeading.append(el('strong',progress.verified+' / '+progress.fitted+' verified'),bar,el('span',progress.percent+'%'));const selectedPart=all.find(part=>part.id===assemblyCursor);if(selectedPart)progressHeading.append(el('span','Selected '+selectedPart.reference,'bom-selected-reference'));tracker.append(progressHeading);const legend=el('div',undefined,'bom-assembly-legend');for(const state of ASSEMBLY){const filter=button(state+' · '+progress.states[state],()=>{assembly.value=assembly.value===state?'all':state;render();});filter.className='assembly-badge '+assemblyClass(state);filter.setAttribute('aria-pressed',String(assembly.value===state));filter.title='Filter assembly checklist: '+state;legend.append(filter);}tracker.append(legend,el('small','Local checklist · DNP and excluded parts are outside the progress total. Select a reference to focus one part.'));
  let total;try{total=totals(parts,build.value);}catch(e){feedback.textContent=e.message;}
  summary.replaceChildren();
  const metric=(label,value,detail)=>{const item=el('span',`${label}: ${value}`,'bom-manager-metric');item.title=detail;summary.append(item);};
  metric('Visible parts',`${parts.length} / ${all.length}`,`${all.filter(p=>p.populated).length} fitted · ${all.filter(p=>!p.populated).length} DNP · ${all.filter(p=>p.excluded).length} excluded in saved source`);
  if(total){metric('Build requirement',`${total.buildParts} parts`,`${total.boards} boards · ${total.unpriced} unpriced per board`);const overall=totals(all);metric('Assembly verification',`${overall.verified} / ${overall.fitted}`, `${overall.fitted-overall.verified} unfinished in this source · ${total.verified}/${total.fitted} visible verified`);if(Object.keys(total.currencies).length)metric('Visible build cost',Object.entries(total.currencies).map(([c,n])=>`${c} ${n.toFixed(2)}`).join(' · '),'Priced parts only · currencies kept separate');}
  nextPart.disabled=!onLocate||!nextAssembly(parts,assemblyCursor);
  resetMatching.disabled=!parts.length;resetAll.disabled=!all.length;
  const activeFilters=[population.value!=='all',excluded.value!=='hide',status.value!=='all',assembly.value!=='all',side.value!=='all',sort.value!=='reference'].filter(Boolean).length;
  filterHeading.textContent='Filters'+(activeFilters?' · '+activeFilters:'');
  columnsButton.textContent='Columns · '+fieldDescriptors.filter(f=>f.show).length+'/'+fieldDescriptors.length;
  countLabel.textContent=`${parts.length} / ${all.length} parts`;countLabel.title=(source.value==='symbol'?'Schematic symbols':'PCB footprints')+(assemblyVariant?' · variant '+assemblyVariant.value:'');
  if(!parts.length){const empty=el('div',undefined,'bom-manager-empty');empty.append(el('strong',all.length?'No parts match your filters':'No saved parts in this source'),el('p',all.length?'Clear search or reset filters to show the full list.':'Choose another source or open a saved schematic or PCB.'));result.append(empty);return;}
  const scroll=el('div',undefined,'bom-manager-grid-scroll'),table=el('table',undefined,'bom-manager-field-grid'),head=el('thead'),hr=el('tr'),columns=fieldDescriptors.filter(f=>f.show);table.setAttribute('aria-label','BoM symbol fields');
  for(const field of columns){const th=el('th',field.label);th.setAttribute('scope','col');hr.append(th);}if(showActions)hr.append(el('th','Actions'));head.append(hr);table.append(head);const body=el('tbody');table.append(body);
  const rows=fieldTable.rows(parts,fieldDescriptors,view.value==='groups');
  const visibleRows=rows.slice(0,limit),selectedRow=rows.find(row=>row.parts.some(p=>p.id===assemblyCursor));if(selectedRow&&!visibleRows.includes(selectedRow))visibleRows.unshift(selectedRow);
  for(const row of visibleRows){const grouped=row.parts.length>1,part=row.parts[0],tr=el('tr');tr.dataset.dnp=String(!part.populated);tr.dataset.group=String(grouped);tr.dataset.selected=String(row.parts.some(p=>p.id===assemblyCursor));for(const field of columns){const td=el('td');td.dataset.field=field.key;td.title=row.values[field.key]||'';if(field.key==='Reference'){if(grouped)td.append(el('small','Group · '+row.quantity+' references','bom-group-caption'));for(const p of row.parts.slice(0,50))td.append(locate(p),' ');if(row.parts.length>50)td.append(button('Ungroup references',()=>{groupCheck.checked=false;view.value='parts';render();}));}else if(field.key==='Assembly')assemblyBadges(td,row.parts);else if(field.key==='status'){for(const state of STATUSES){const count=row.parts.filter(p=>p.management.status===state).length;if(count)td.append(el('span',state+(grouped?' · '+count:''),'assembly-badge '+procurementClass(state)));}}else td.textContent=row.values[field.key]||'—';if(onComment){const comment=button('+',()=>onComment(part.object,field.label,String(row.values[field.key]||''),row.parts.map(p=>p.reference).filter(Boolean)));comment.className='icon-only field-comment-action';comment.title='Comment on '+field.label;comment.setAttribute('aria-label','Comment on '+field.label);comment.setAttribute('data-icon','comment-add');if(root.KiCadUIIcons){comment.textContent='';comment.append(root.KiCadUIIcons.icon('comment-add'));}td.append(comment);}tr.append(td);}
   const td=el('td');if(grouped)td.append(button('Manage group',()=>edit(part,row.parts)));else{const advance=button(part.management.Assembly==='verified'?'Verified':'Advance assembly',()=>{if(!assemblyWorkItem(part)||part.management.Assembly==='verified')return;const next={...metadata,[part.id]:{...(metadata[part.id]||{}),Assembly:ASSEMBLY[Math.min(ASSEMBLY.length-1,ASSEMBLY.indexOf(part.management.Assembly)+1)]}};if(persist(next)){metadata=next;render();}});advance.disabled=!assemblyWorkItem(part)||part.management.Assembly==='verified';advance.title=assemblyWorkItem(part)?'Advance this local checklist by one step':'DNP and excluded parts are not assembly work items';td.append(button('Manage',()=>edit(part)),advance);if(onEdit)td.append(button('Edit KiCad fields',()=>editNative(part)));}if(showActions)tr.append(td);body.append(tr);
  }scroll.append(table);result.append(scroll);if(rows.length>limit)result.append(button(`Show next ${Math.min(200,rows.length-limit)} rows (${Math.min(limit,rows.length)} of ${rows.length} displayed)`,()=>render(limit+200)));
 }
 dialog.setSelection=value=>{
  if(value===null){if(assemblyCursor===null)return true;assemblyCursor=null;render(renderedLimit);return true;}
  if(!value||!['symbol','footprint'].includes(value.kind)||typeof value.path!=='string')return false;
  const candidates=model(objects,value.kind,metadata).filter(p=>p.id===identity(value));
  if(candidates.length!==1)return false;const part=candidates[0];if(assemblyCursor===part.id&&source.value===value.kind)return true;
  source.value=value.kind;assemblyCursor=part.id;render(renderedLimit);
  if(!filtered().some(p=>p.id===assemblyCursor))feedback.textContent='Selected '+part.reference+' is hidden by the current BoM filters.';
  return true;
 };
 dialog.selectPart=value=>{if(value&&typeof value==='object')return dialog.setSelection(value);const candidates=model(objects,source.value,metadata).filter(p=>p.id===value||p.object.id===value);if(candidates.length!==1)return false;return dialog.setSelection(candidates[0].object);};
 dialog.getSelectedPart=()=>model(objects,source.value,metadata).find(p=>p.id===assemblyCursor)?.object||null;
 dialog.addEventListener('close',()=>{resetDialog?.close();dialog.remove();},{once:true});if(options.modal===false)dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.close();}});render();root.KiCadSectionPages?.scan?.();if(options.modal===false)dialog.show();else dialog.showModal();return dialog;
}
const api={open,identity,model,query,group,csv,validateMetadata,metadataJSON,scopeKey,boardCount,totals,assemblyWorkItem,assemblySummary,assemblyClass,procurementClass,nextAssembly,resetMetadata,FIELDS,STATUSES,ASSEMBLY};
root.KiCadBomManager=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
