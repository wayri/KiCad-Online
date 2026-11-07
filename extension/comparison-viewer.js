/* Read-only unified comparison. Imported sources never leave this page. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),q=new URLSearchParams(location.search);
const sets={base:null,head:null};let result=null,selected=null,view='properties',worker=null,generation=0,limit=200;
const importGeneration={base:0,head:0};let remoteGeneration=0,compareOptions={},remoteWarnings=[];
const frames=new Map(),originalSend=globalThis.chrome?.runtime?.sendMessage?.bind(globalThis.chrome.runtime);
const assetURL=n=>globalThis.chrome?.runtime?.getURL?chrome.runtime.getURL(n):new URL(n,location.href).href;
const storage={getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v)};
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function status(s){$('status').textContent=s;}
function warning(s){$('warnings').textContent=s;$('warnings').hidden=!s;}
function table(headers,rows){const t=node('table'),h=node('tr');headers.forEach(v=>h.append(node('th',v)));t.append(h);for(const r of rows){const tr=node('tr');for(const v of r)tr.append(node('td',v==null?'—':typeof v==='object'?JSON.stringify(v):String(v)));t.append(tr);}return t;}
function current(){return result?.files.find(f=>f.path===$('file').value);}
function entries(){return result?.entries.filter(e=>e.path===$('file').value)||[];}
function send(frame,command){frame?.contentWindow?.postMessage({type:'kicad-review:command',...command},location.origin);}
function applyHighlights(){for(const [side,frame]of frames){const file=current();const key=JSON.stringify([file?.path,view,$('highlight').checked,selected?.id]);if(frame.dataset.highlightKey===key||!frame.dataset.ready)continue;frame.dataset.highlightKey=key;const focusUuid=$('highlight').checked?(selected?.[side==='base'?'before':'after']?.uuid||null):null;const uuids=$('highlight').checked?[...new Set([focusUuid,...entries().map(e=>e[side==='base'?'before':'after']?.uuid)].filter(Boolean))].slice(0,200):[];send(frame,{command:'comparison-highlight',file:file?.[side==='base'?'basePath':'headPath'],uuids,focusUuid});}}
async function importFiles(side,list,token){
 const files=[],assets=[];let bytes=0,skipped=0;
 const folder=[...list].some(f=>f.webkitRelativePath);
 for(const f of list){let path=folder?f.webkitRelativePath.split('/').slice(1).join('/'):f.name;
 if(!KiCadLocalProject.pathOK(path))throw Error('Unsafe file path.');
 const model=/\.(step|stp|wrl|vrml|glb)$/i.test(path),text=/\.(csv|tsv|txt|md|json|kicad_(pcb|sch|pro|dru)|sch|pro|lib|cfg|ini|yaml|yml|xml)$/i.test(path);
 if(!model&&!text){skipped++;continue;}bytes+=f.size;if(bytes>96*1024*1024||files.length+assets.length>=128)throw Error('Choose at most 128 files and 96 MiB per revision.');
 if(model){if(f.size>8*1024*1024)throw Error('Model exceeds 8 MiB: '+path);const b=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));assets.push({path,base64:btoa(s)});}
 else files.push({path,content:await f.text()});
 }
 if(!files.length)throw Error('No supported comparison sources selected.');
 if(new Set([...files,...assets].map(f=>f.path)).size!==files.length+assets.length)throw Error('Duplicate paths. Import a folder to retain directory names.');
 if(token!==importGeneration[side])return;
 sets[side]={files,assets};$(''+side+'Summary').textContent=side+': '+files.length+' source files, '+assets.length+' models'+(skipped?' · '+skipped+' unsupported files skipped':'');
 $('compare').disabled=!sets.base||!sets.head;status('Sources ready. Choose Compare.');
}
for(const side of ['base','head'])for(const suffix of ['Files','Folder'])$(side+suffix).onchange=async e=>{
 remoteGeneration++;compareOptions={};remoteWarnings=[];generation++;worker?.terminate();result=null;selected=null;$('export').disabled=true;$('cancel').hidden=true;$('changes').replaceChildren();$('file').replaceChildren();$('tableHost').replaceChildren();$('detail').replaceChildren();for(const frame of frames.values())frame.remove?.();frames.clear();$('baseDrawing').replaceChildren();$('headDrawing').replaceChildren();
 const token=++importGeneration[side];sets[side]=null;$('compare').disabled=true;
 try{await importFiles(side,e.target.files,token);}
 catch(err){if(token===importGeneration[side]){$(side+'Summary').textContent=side+': import failed';status(err.message);}}
 finally{e.target.value='';}
};
function buildTransport(side){
 const source=sets[side],supported=source.files.filter(f=>KiCadLocalProject.textFile(f.path));
 const p=KiCadLocalProject.validate({id:'comparison-'+side,files:supported,assets:source.assets||[]});
 return KiCadLocalProject.transport(p,storage,{local:true,ref:(side==='base'?'a':'b').repeat(40)});
}
const transports={};
window.KiCadLocalWorkspace={storage,assetURL,transport:{send:async m=>{const side=m.repository==='local/comparison-base'?'base':m.repository==='local/comparison-head'?'head':null;if(!side||!transports[side])return{ok:false,error:'Unknown comparison revision.'};return transports[side].send(m);}},openDrawing(){status('Choose the corresponding file in the comparison file menu.');},openProject(){},openURL(url){if(/^https:\/\//.test(url))window.open(url,'_blank','noopener,noreferrer');}};
function renderDrawings(file){
 $('tableHost').hidden=true;$('drawingHost').hidden=false;
 for(const side of ['base','head']){
 const host=$(side+'Drawing'),path=file[side==='base'?'basePath':'headPath'],key=[generation,side,path,view].join(':');
 if(host.dataset.key===key)continue;host.dataset.key=key;host.replaceChildren();frames.delete(side);
 if(!path){host.append(node('p','File absent in this revision.'));continue;}
 try{transports[side]=buildTransport(side);}catch(e){host.append(node('p',e.message));continue;}
 const iframe=node('iframe');iframe.title=side+' '+view+' comparison';iframe.style.cssText='width:100%;height:100%;border:0;min-height:480px';iframe.dataset.expectedFile=path;
 const params=new URLSearchParams({repository:transports[side].scope,ref:transports[side].ref,file:path,...(view==='3d'?{initialView:'3d'}:{})});
 iframe.src=assetURL('revision-viewer.html')+'?'+params;frames.set(side,iframe);host.append(iframe);
 }
}
function render(){
 const f=current();if(!f)return;
 for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-selected',String(b.dataset.view===view));
 $('tableHost').hidden=false;$('drawingHost').hidden=true;$('tableHost').replaceChildren();
 const list=entries();
 $('viewNote').textContent=view==='3d'?'Saved placement, side and model-reference/transform differences; this is not a Boolean comparison of model meshes.':view==='text'?'Source lines are displayed as inert text. Large comparisons may use a bounded line-position fallback.':'Choose a listed delta to inspect its changed fields. Drawing highlights are limited to 200 objects per file.';
 if(['schematic','layout','3d'].includes(view)){
 const compatible=view==='schematic'?f.domain==='schematic':f.domain==='layout';
 if(compatible)renderDrawings(f);else $('tableHost').append(node('p','Select a '+(view==='schematic'?'schematic':'PCB')+' file to use this view.'));
 }else if(view==='text'){
 try{
  const diff=KiCadUnifiedComparison.diffText(f.beforeContent??null,f.afterContent??null),visible=new Set();
  for(let i=0;i<diff.rows.length;i++)if(diff.rows[i].status!=='equal')for(let j=Math.max(0,i-3);j<=Math.min(diff.rows.length-1,i+3);j++)visible.add(j);
  const rows=[...visible].sort((a,b)=>a-b).slice(0,2000).map(i=>diff.rows[i]);
  if(!rows.length)$('tableHost').append(node('p','No source-line changes in this file.'));
  else{const t=table(['Change','Base line','Head line','Source'],rows.map(r=>[r.status,r.beforeLine,r.afterLine,r.text]));[...t.rows].slice(1).forEach((tr,i)=>tr.className=rows[i].status);$('tableHost').append(t);}
  const notes=[...result.warnings,...diff.warnings];if(visible.size>2000)notes.push('Text view shows the first 2,000 changed/context lines. Export deltas for the complete comparison.');warning(notes.join(' '));
 }catch(error){$('tableHost').append(node('p',error.message));warning([...result.warnings,'Source text view is unavailable for this file.'].join(' '));}
 }else{
 const source=view==='properties'&&selected?.path===f.path?[selected]:list;
 const rows=source.flatMap(e=>e.fields.length?e.fields.map(v=>[e.status,e.label,v.name,v.before,v.after]):[[e.status,e.label,e.kind,e.before,e.after]]);
 $('tableHost').append(table(['Change','Object / reference','Field','Base','Head'],rows));
 }
 $('detail').replaceChildren();
 if(selected){$('detail').append(node('strong',selected.label+' · '+selected.status));if(selected.delta)$('detail').append(node('p','Position delta: '+JSON.stringify(selected.delta)));$('detail').append(table(['Field','Base','Head'],selected.fields.map(f=>[f.name,f.before,f.after])));}
 applyHighlights();
}
function listChanges(){
 if(!result)return;const search=$('search').value.trim().toLowerCase();
 const all=result.entries.filter(e=>($('domain').value==='all'||e.domain===$('domain').value)&&($('statusFilter').value==='all'||e.status===$('statusFilter').value)&&(!search||JSON.stringify(e).toLowerCase().includes(search)));
 $('matches').textContent=all.length+' matching deltas';$('changes').replaceChildren();
 for(const e of all.slice(0,limit)){const b=node('button',e.status+' · '+e.label);b.className='change '+e.status;b.setAttribute('role','listitem');b.title=e.path;b.onclick=()=>{selected=e;$('file').value=e.path;if(!['text','properties','bom'].includes(view)&&e.domain!==(view==='schematic'?'schematic':'layout'))view='properties';render();};$('changes').append(b);}
 $('more').hidden=all.length<=limit;
}
$('compare').onclick=()=>{
 if(!sets.base||!sets.head)return;worker?.terminate();const token=++generation;status('Comparing saved sources…');$('cancel').hidden=false;$('compare').disabled=true;warning('');
 worker=new Worker(assetURL('comparison-worker.js'));
 const timer=setTimeout(()=>{if(token===generation){worker.terminate();status('Comparison exceeded the 60 second budget. Choose fewer files.');$('cancel').hidden=true;$('compare').disabled=false;}},60000);
 worker.onerror=e=>{clearTimeout(timer);status('Comparison worker failed: '+e.message);$('cancel').hidden=true;$('compare').disabled=false;worker.terminate();};
 worker.onmessage=e=>{if(token!==generation)return;clearTimeout(timer);worker.terminate();$('cancel').hidden=true;$('compare').disabled=false;if(!e.data.ok){status(e.data.error);return;}result=e.data.result;result.warnings.push(...remoteWarnings);
 for(const f of result.files){f.beforeContent=sets.base.files.find(v=>v.path===f.basePath)?.content??null;f.afterContent=sets.head.files.find(v=>v.path===f.headPath)?.content??null;}
 $('file').replaceChildren(...result.files.map(f=>{const o=node('option',f.path);o.value=f.path;return o;}));selected=result.entries[0]||null;if(selected)$('file').value=selected.path;
 $('counts').textContent=result.entries.length+' deltas';status('Comparison complete: '+result.counts.added+' added, '+result.counts.removed+' removed, '+result.counts.modified+' modified.');warning(result.warnings.join(' '));$('export').disabled=false;listChanges();render();};
 worker.postMessage({type:'compare',base:sets.base.files,head:sets.head.files,options:compareOptions});
};
$('cancel').onclick=()=>{generation++;worker?.terminate();$('cancel').hidden=true;$('compare').disabled=false;status('Comparison stopped.');};
$('file').onchange=()=>{selected=entries()[0]||null;render();};
for(const id of ['search','domain','statusFilter'])$(id).oninput=()=>{limit=200;listChanges();};
$('more').onclick=()=>{limit+=200;listChanges();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});
$('highlight').onchange=applyHighlights;$('fit').onclick=()=>frames.forEach(f=>send(f,{command:'fit-drawing'}));
window.addEventListener('message',e=>{
 if(e.origin!==location.origin)return;
 const frame=[...frames.values()].find(f=>f.contentWindow===e.source);if(!frame)return;
 if(e.data?.type==='kicad-review:comparison-ready'){
  if(e.data.file!==frame.dataset.expectedFile){frame.dataset.openingFile=frame.dataset.expectedFile;frame.dataset.ready='';frame.dataset.highlightKey='';send(frame,{command:'open-sheet',file:frame.dataset.expectedFile});}
  else{frame.dataset.ready='1';applyHighlights();}
 }else if(e.data?.type==='kicad-review:view'&&frame.dataset.openingFile&&e.data.file===frame.dataset.expectedFile){
  frame.dataset.openingFile='';frame.dataset.ready='1';frame.dataset.highlightKey='';applyHighlights();
 }
});
$('export').onclick=()=>{const report={format:'kicad-online-comparison',version:1,counts:result.counts,warnings:result.warnings,entries:result.entries};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='comparison-deltas.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('baseRef').value=q.get('base')||'';$('headRef').value=q.get('head')||q.get('ref')||'';$('remoteFile').value=q.get('file')||'';
$('loadRemote').disabled=!originalSend||!q.get('repository');
if(q.get('repository'))$('remoteScope').textContent='Repository: '+q.get('repository')+'. Reads use the existing repository browser-session transport.';
$('loadRemote').onclick=async()=>{
 const token=++remoteGeneration;sets.base=sets.head=null;$('compare').disabled=true;compareOptions={};remoteWarnings=[];
 try{const repository=q.get('repository'),file=$('remoteFile').value,oldFile=q.get('oldFile')||file,provider=q.get('provider')||'github',host=q.get('host')||(provider==='gitlab'?'https://gitlab.com':'https://github.com');
 if(q.get('headRepository')&&q.get('headRepository')!==repository)throw Error('Cross-repository comparison is not supported here. Open both revisions from the same repository.');
 if(!KiCadLocalProject.pathOK(file)||!KiCadLocalProject.pathOK(oldFile))throw Error('Choose repository-relative file paths.');
 if([file,oldFile].some(path=>/\.(?:kicad_pro|pro)$/i.test(path)))throw Error('Choose a .kicad_sch or .kicad_pcb drawing to load its associated project files.');
 const request=async m=>{const r=await originalSend({...m,repository,provider,host});if(!r?.ok)throw Error(r?.error||'Repository read failed.');return r.result;};
 const pending={},pendingWarnings=[];
 for(const side of ['base','head']){const sourcePath=side==='base'?oldFile:file,requested=$(side+'Ref').value;if(!requested)throw Error('Choose both revisions.');status('Loading '+side+' through repository session…');const resolved=await request({type:'revision-resolve',ref:requested,file:sourcePath});const ref=resolved?.sha;
 if(!/^[a-f0-9]{40}$/i.test(ref||''))throw Error('Repository did not resolve an immutable revision.');
 const loaded=await request({type:KiCadLocalProject.drawing(sourcePath)?'project':'project-file',ref,file:sourcePath});
 const files=Array.isArray(loaded)?loaded:typeof loaded?.content==='string'?[loaded]:[];
 if(!files.length||!files.some(entry=>entry?.path===sourcePath))throw Error('Revision returned no source for '+sourcePath+'.');
 if(KiCadLocalProject.drawing(sourcePath)){
  try{
   const inventory=await request({type:'drawing-files',ref,file:sourcePath});
   const stem=sourcePath.replace(/\.(?:kicad_sch|kicad_pcb|sch)$/i,'');
   const companions=/\.kicad_pcb$/i.test(sourcePath)?[stem+'.kicad_sch',stem+'.sch']:[stem+'.kicad_pcb'];
   const companion=companions.find(path=>inventory?.files?.includes(path));
   if(companion){const sibling=await request({type:'project',ref,file:companion});
    if(!Array.isArray(sibling))throw Error('Companion drawing response is invalid.');
    for(const entry of sibling)if(!files.some(existing=>existing.path===entry.path))files.push(entry);
   }
   if(inventory?.warnings?.length)pendingWarnings.push(side+': '+inventory.warnings.join(' '));
  }catch(error){pendingWarnings.push(side+': companion discovery unavailable ('+error.message+'). Choose both drawings in a local folder for a complete paired view.');}
 }
 let bytes=0;for(const entry of files){if(!KiCadLocalProject.pathOK(entry?.path)||typeof entry.content!=='string')throw Error('Invalid repository source response.');bytes+=new TextEncoder().encode(entry.content).length;if(bytes>96*1024*1024||files.length>128)throw Error('Revision exceeds 128 files or 96 MiB.');}
 pending[side]={files,assets:[],ref};
 }
 if(token!==remoteGeneration)return;
 sets.base=pending.base;sets.head=pending.head;
 remoteWarnings=[...pendingWarnings,'Repository comparison currently loads drawing sources, not STEP/WRL assets. Import both project folders with their model files for full model geometry.'];
 for(const side of ['base','head'])$(side+'Summary').textContent=side+': '+pending[side].ref+' · '+pending[side].files.length+' files';
 if(oldFile!==file)compareOptions={pairs:[{basePath:oldFile,headPath:file}]};
 $('compare').disabled=false;$('compare').click();
 }catch(e){if(token===remoteGeneration){$('baseSummary').textContent='Base: remote load failed';$('headSummary').textContent='Head: remote load failed';status(e.message);}}
};
})();
