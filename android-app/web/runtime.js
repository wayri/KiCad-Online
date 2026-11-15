/* Loaded only in packaged trusted viewer pages, before the shared scripts. */
(() => {
 'use strict';
 window.KiCadAndroidRuntime=true;
 const project=window.top.KiCadAndroidProject;if(!project)return; // Offline tools can open without a project; no project transport is granted.
 const localAdapters=new WeakMap(),localFor=snapshot=>{let adapter=localAdapters.get(snapshot);if(!adapter){adapter=KiCadAndroidLocal.transport(snapshot,localStorage);localAdapters.set(snapshot,adapter);}return adapter;};
 const api=localFor(project);
 const online=Boolean(project.github||project.remote);window.KiCadAndroidOnline=online;
 const provider=project.remote?.provider||'github';
 const nativeRequest=(message,options)=>(provider==='gitlab'?window.top.KiCadAndroidGitLab:window.top.KiCadAndroidGitHub).request(message,options);
 const info=project.remote||project.github,params=new URLSearchParams(location.search);
 const frameRef=params.get('ref')||params.get('head')||info?.sha;
 if(online)window.top.KiCadAndroid.ensureSnapshots();
 const source=async(ref,options)=>ref&&online?window.top.KiCadAndroidRevisionCache.get(ref,options):project;
 const reviewAdapters=new Map();
 const remoteTypes=new Set(['chat-thread-state','chat-message-write','chat-thread-list','github-auth-status','comment-policy-status','comment-mention-users','github-discussion-categories','github-thread-read','github-annotations','comment-remote-list','github-publish-comment','comment-publish','github-recover-publication']);
 const loadReads=new Set(['project','revision','project-inventory','project-file']),loads=new Map(),cancelledLoads=new Set();
 const validLoadId=id=>typeof id==='string'&&id.length>0&&id.length<=160;
 const dispatch=async message=>{let load=null;try{
  if(message.type==='load-cancel'){
   if(!validLoadId(message.loadId))return{ok:false,error:'Invalid loading request.'};
   const active=loads.get(message.loadId);active?.controller.abort();cancelledLoads.add(message.loadId);
   if(cancelledLoads.size>128)cancelledLoads.delete(cancelledLoads.values().next().value);
   return{ok:true,result:{cancelled:Boolean(active)}};
  }
  if(loadReads.has(message.type)&&validLoadId(message.loadId)){
   if(cancelledLoads.has(message.loadId))throw Object.assign(Error('Loading cancelled.'),{name:'AbortError'});
   load=loads.get(message.loadId);if(!load){if(loads.size>=32)throw Error('Too many active loads.');load={controller:new AbortController(),users:0};loads.set(message.loadId,load);}load.users++;
  }
  if(message.type==='open-options'){window.top.document.getElementById(provider==='gitlab'?'gitlabButton':'githubButton').click();return{ok:true,result:{opened:true}};}
  if(message.type==='open-project-drawing'||message.type==='open-viewer-window'){if(message.searchResult){const r=message.searchResult;window.top.KiCadAndroid.openDrawing(message.file,{...r.position,uuid:r.uuid,netName:r.netName,view:r.view,ref:message.ref});}else window.top.KiCadAndroid.openDrawing(message.file);return{ok:true,result:{opened:true}};}
  if(online&&(message.repository&&message.repository.toLowerCase()!==info.repository.toLowerCase()||message.provider&&message.provider!==provider||message.host&&message.host!==project.remote?.host))throw Error('Request belongs to another repository or server.');
  if(online&&['work-board-list','work-board-read','work-board-move','repository-fork-revision','revision-resolve','revision-branches','revision-commits','repository-tree','repository-history','repository-branches'].includes(message.type)){
   if(window.top.KiCadAndroidSession?.owns(project)){if(message.type==='repository-tree')return api.send(message);throw Error('This repository-browser mode does not use the account API. Use the repository browser for history, branches or other website actions.');}
   return{ok:true,result:await nativeRequest(message)};
  }
  const snapshot=await source(message.ref||message.comment?.anchor?.ref||frameRef,load?{signal:load.controller.signal}:undefined);
  if(load?.controller.signal.aborted)throw Object.assign(Error('Loading cancelled.'),{name:'AbortError'});
  if(online&&remoteTypes.has(message.type)){
    if(!reviewAdapters.has(snapshot.id))reviewAdapters.set(snapshot.id,window.top.KiCadAndroidSession?.owns(snapshot)?window.top.KiCadAndroidSession.remote(snapshot,localStorage):KiCadAndroidRemote.create(snapshot,nativeRequest,window.top.KiCadReviewComments,localStorage));const remote=reviewAdapters.get(snapshot.id);
   const reply=await remote.send(message);if(reply.authExpired)(provider==='gitlab'?window.top.KiCadAndroidGitLab:window.top.KiCadAndroidGitHub).authExpired?.(project.remote?.host);return reply;
  }
  return localFor(snapshot).send(message);
 }catch(error){if(error.authExpired)(provider==='gitlab'?window.top.KiCadAndroidGitLab:window.top.KiCadAndroidGitHub).authExpired?.(project.remote?.host);return{ok:false,error:error.message,...(error.name==='AbortError'?{cancelled:true}:{})};}finally{if(load&&!--load.users&&loads.get(message.loadId)===load)loads.delete(message.loadId);}};
 window.KiCadVSCodeContext={search:location.search}; // Shared viewer local-source contract.
 window.chrome={runtime:{id:'android-local',getURL:name=>new URL(name,location.href).href,sendMessage:message=>{if(message.type==='open-project-file'){window.top.KiCadAndroid.openDrawing(message.file);return Promise.resolve({ok:true,result:{opened:true}});}if(message.type==='open-project-overview'){window.top.KiCadAndroid.openProject(message.file);return Promise.resolve({ok:true,result:{opened:true}});}return dispatch(message);},onMessage:{addListener(){}}},storage:{local:{async get(key){return{[key]:JSON.parse(localStorage.getItem('android-pref:'+key)||'null')};},async set(values){for(const [key,value]of Object.entries(values))localStorage.setItem('android-pref:'+key,JSON.stringify(value));}}}};
 document.addEventListener('DOMContentLoaded',()=>{const clean=()=>{for(const node of document.querySelectorAll('#projectTools > button'))if(node.textContent==='Pop out')node.hidden=true;};clean();new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&node.namespaceURI!=='http://www.w3.org/2000/svg')))clean();}).observe(document.body,{childList:true,subtree:true});for(const id of ['sourceLink','htmlTab','popOut',...(!online?['githubPane','commentPublishSettings','postComment']:[])]){const node=document.getElementById(id);if(node)node.hidden=true;}const save=document.getElementById('saveComment');if(save){save.hidden=false;if(!online)save.textContent='Save note';}const search=document.getElementById('universalSearch');if(search)search.placeholder='Search parts, nets, sheets…';});
})();
