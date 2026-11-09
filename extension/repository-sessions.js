/* User-invoked website tab bindings. No cookies, tokens, or project bytes. */
((root)=>{'use strict';
 const KEY='repository-view-sessions-v1',MAX=32;
 function create(api){
  const records=new Map();
  function valid(value){
   if(!value||!Number.isInteger(value.tabId)||value.tabId<0||!['github','gitlab'].includes(value.provider)||typeof value.repository!=='string'||! /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value.repository)||value.repository.split('/').some(x=>x==='.'||x==='..'))return false;
   try{const host=new URL(value.host);return host.protocol==='https:'&&host.origin===value.host&&(value.provider!=='github'||value.host==='https://github.com')&&!host.username&&!host.password;}catch{return false;}
  }
  const ready=Promise.resolve(api.storage?.session?.get?.(KEY)).then(saved=>{for(const value of (Array.isArray(saved?.[KEY])?saved[KEY]:[]).slice(-MAX))if(valid(value))records.set(value.tabId,value);}).catch(()=>{});
  async function remember(tab,context,inline=false){
   await ready;const value={tabId:tab.id,provider:context.provider||'github',host:context.host||(context.provider==='gitlab'?new URL(tab.url).origin:'https://github.com'),repository:context.repository,inline:Boolean(inline)};
   if(!valid(value))throw Error('Invalid repository website session.');
   const page=new URL(tab.url);if(page.origin!==value.host||!(page.pathname==='/'+value.repository||page.pathname.startsWith('/'+value.repository+'/')))throw Error('Repository session does not match its website tab.');
   records.delete(tab.id);records.set(tab.id,value);while(records.size>MAX)records.delete(records.keys().next().value);
   await api.storage?.session?.set?.({[KEY]:[...records.values()]});return value;
  }
  async function candidates(provider,host,repository){
   await ready;const found=[...records.values()].filter(x=>x.provider===provider&&x.host===host&&x.repository.toLowerCase()===repository.toLowerCase()).reverse().map(x=>({id:x.tabId,bound:true}));
   // Legacy already-injected tabs can still answer; explicit bindings come first.
   try{for(const tab of await api.tabs.query({url:[host+'/'+repository,host+'/'+repository+'/*']}))if(!found.some(x=>x.id===tab.id))found.push(tab);}catch{}
   return found.slice(0,MAX);
  }
  // Repair a stale content-script channel only for the tab explicitly invoked
  // by this user. Recheck its live location; a saved binding grants no access
  // after navigation to another repository, origin, or profile.
  async function recover(tabId,provider,host,repository){
   await ready;const record=records.get(tabId);
   if(!record||record.provider!==provider||record.host!==host||record.repository.toLowerCase()!==repository.toLowerCase()||!api.tabs.get||!api.scripting?.executeScript)return false;
   try{const tab=await api.tabs.get(tabId),page=new URL(tab.url);
    if(tab.id!==tabId||page.origin!==host||page.username||page.password||!(page.pathname.toLowerCase()==='/'+repository.toLowerCase()||page.pathname.toLowerCase().startsWith('/'+repository.toLowerCase()+'/')))return false;
    const firefox=api.runtime.getManifest?.()?.browser_specific_settings?.gecko;
    const files=[...(firefox?['firefox/browser-api.js']:[]),'parsing.js',...(provider==='github'?['github-website-history.js','github-website-pulls.js','github-session-reader.js','github-session-review.js']:['gitlab-session-reader.js']),'repository-session-bridge.js'];
    await api.scripting.executeScript({target:{tabId,frameIds:[0]},files});return true;
   }catch{return false;}
  }
  function frameAllowed(sender){
   if((sender?.frameId??0)===0)return true;
   try{const url=new URL(sender.url),own=new URL(api.runtime.getURL(''));if(url.protocol!==own.protocol||url.host!==own.host)return false;
    const parent=new URL(sender.tab?.url||'about:blank'),ownedParents=new Set(['/project-launcher.html','/project-viewer.html','/browser-viewer.html','/revision-viewer.html','/pcb-viewer.html','/schematic-viewer.html','/gerber-viewer.html','/analysis-viewer.html']);
    if(parent.protocol===own.protocol&&parent.host===own.host&&ownedParents.has(parent.pathname))return true;
    if(!['/project-launcher.html','/project-viewer.html','/browser-viewer.html','/gerber-viewer.html','/bom-viewer.html'].includes(url.pathname))return false;
    const record=records.get(sender?.tab?.id);if(!record?.inline||parent.origin!==record.host||!(parent.pathname==='/'+record.repository||parent.pathname.startsWith('/'+record.repository+'/')))return false;
    let repository=url.searchParams.get('repository'),provider=url.searchParams.get('provider')||'github',host=url.searchParams.get('host')||'https://github.com';
    if(url.pathname==='/project-launcher.html'){const source=new URL(url.searchParams.get('source'));const parse=root.KiCadGitHub||(typeof require==='function'?require('./parsing.js'):null),route=parse.repositoryRoute(source.href,{gitlabHosts:[source.origin]})||parse.revisionRoute(source.href);if(!route)return false;repository=route.repository;host=source.origin;provider=host==='https://github.com'?'github':'gitlab';}
    return repository===record.repository&&provider===record.provider&&host===record.host;
   }catch{return false;}
  }
  function inlineSource(sender,url){const record=records.get(sender?.tab?.id);if(!record?.inline||(sender.frameId??0)!==0)return false;try{const source=new URL(sender.url),target=new URL(url),own=new URL(api.runtime.getURL(''));return source.origin===record.host&&(source.pathname==='/'+record.repository||source.pathname.startsWith('/'+record.repository+'/'))&&target.protocol===own.protocol&&target.host===own.host&&['/project-launcher.html','/project-viewer.html','/browser-viewer.html','/gerber-viewer.html'].includes(target.pathname)&&frameAllowed({...sender,tab:{...sender.tab,url:sender.url},frameId:1,url});}catch{return false;}}
  function messageAllowed(sender,message){
   if((sender?.frameId??0)===0)return true;
   let parent;try{parent=new URL(sender.tab?.url||'about:blank');}catch{return false;}
   const own=new URL(api.runtime.getURL(''));
   if(parent.protocol===own.protocol&&parent.host===own.host)return frameAllowed(sender);
   const record=records.get(sender.tab?.id);if(!record?.inline||!frameAllowed(sender))return false;
   const scopes=[message,message?.comment?.anchor,message?.scope].filter(Boolean);
   return scopes.every(value=>value.repository===undefined||value.repository===record.repository&&(value.provider||'github')===record.provider&&(value.host||(record.provider==='github'?'https://github.com':'https://gitlab.com'))===record.host);
  }
  return {ready,remember,candidates,recover,frameAllowed,inlineSource,messageAllowed};
 }
 root.KiCadRepositorySessions={create};if(typeof module==='object'&&module.exports)module.exports=root.KiCadRepositorySessions;
})(globalThis);
