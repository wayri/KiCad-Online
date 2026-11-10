"use strict";

importScripts("gerber-renderer.js", "repository-sessions.js", "github-website-reviews.js", "github-website-history.js", "github-website-pulls.js", "github-session-reader.js", "github-project-buffer.js", "github-project-view.js", "draftsman-model.js", "draftsman-export.js", "draftsman-repository.js", "managed-policy.js", "parsing.js", "project-launch.js", "legacy-kicad.js", "browser-data.js", "review-comments.js", "review-file-store.js", "credential-vault.js", "provider-oauth.js", "revision-fork.js", "github-review-api.js", "gitlab-provider.js", "gitlab-review-api.js", "gitlab-hosts.js", "mention-users.js", "environment-diagnostics.js", "project-recents.js", "native-kicad.js");
globalThis.KiCadManagedPolicy?.installFetch();

let mentionService=null;
function mentionUsers(message){
  mentionService ||= KiCadMentionUsers.create({authorizationHeaders:(provider,host)=>provider==='gitlab'?KiCadGitLabReviewApi.authorizationHeaders(host):KiCadGitHubReviewApi.authorizationHeaders()});
  return mentionService.lookup(message);
}
const SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
let projectRecentStore=null;
function recents(){const api=globalThis.KiCadProjectRecents||(typeof require==='function'?require('./project-recents.js'):null);if(!api)throw Error('Project history is unavailable. Reload the extension.');return projectRecentStore||=(api.createStore(chrome.storage.local));}
function recentSnapshot(result,sha){if(Array.isArray(result)&&SHA.test(sha||''))Object.defineProperty(result,'recentSnapshotRef',{value:sha.toLowerCase()});return result;}
function dashboardSender(sender){return sender?.id===chrome.runtime.id&&(sender.frameId??0)===0&&sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('dashboard.html');}
function localWorkspaceSender(sender){return sender?.id===chrome.runtime.id&&(sender.frameId??0)===0&&sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('local-viewer.html');}
async function recentHostAllowed(entry){if(entry.provider==='gitlab'&&!(globalThis.KiCadGitLabHosts?await KiCadGitLabHosts.allowed(entry.host):entry.host==='https://gitlab.com'))throw Error('Configure and grant access to this GitLab server in Settings first.');}
async function dashboardDispatch(message,sender){
 if(message.type==='project-recents-record-local'){
  if(!localWorkspaceSender(sender))throw Error('Only the local workspace can record imported project names.');
  if(Object.keys(message).some(key=>!['type','name','localId'].includes(key)))throw Error('Local project history accepts names and identities only.');
  const item=await recents().record({kind:'local',name:message.name,localId:message.localId});return{id:item.id};
 }
 if(!dashboardSender(sender))throw Error('Only the project dashboard can access recent project history.');
 if(message.type==='project-recents-list'){const policy=await globalThis.KiCadManagedPolicy?.read();return{entries:await recents().list(),networkEnabled:policy?policy.valid===true&&policy.networkEnabled===true:true};}
 if(message.type==='project-recents-remove')return{entries:await recents().remove(message.id)};
 if(message.type==='project-recents-clear'){if(message.confirmed!==true)throw Error('Confirm clearing local project history.');await recents().clear();return{cleared:true};}
 if(message.type==='dashboard-open-project'){
  let entered;try{entered=new URL(message.url);}catch{throw Error('Enter a complete HTTPS repository URL.');}if(typeof message.url!=='string'||message.url.length>1000||entered.search||entered.hash)throw Error('Use a repository or folder URL without query parameters.');
  await globalThis.KiCadManagedPolicy?.assertNetwork();
  let context;try{context=KiCadProjectLaunch.context(message.url,{allowUnresolved:true});}catch{context=null;}
  if(!context){const api=globalThis.KiCadProjectRecents||(typeof require==='function'?require('./project-recents.js'):null),entry=api.parseURL(message.url);context={kind:'repository',provider:entry.provider,host:entry.host,repository:entry.repository,source:entry.url,ref:'HEAD'};}
  await recentHostAllowed(context);
  const url=context.kind==='drawing'?KiCadProjectLaunch.viewerURL(context,context.file,p=>chrome.runtime.getURL(p)):chrome.runtime.getURL('project-launcher.html')+'?'+new URLSearchParams({source:context.source,...(context.ref?{ref:context.ref}:{})});
  await chrome.tabs.create({url});return{opened:true,workspace:true};
 }
 if(message.type==='dashboard-open-recent'){
  const entry=(await recents().list()).find(item=>item.id===message.id);if(!entry)throw Error('This recent project is no longer in local history.');
  if(entry.kind==='remote'){await globalThis.KiCadManagedPolicy?.assertNetwork();await recentHostAllowed(entry);}
  const api=globalThis.KiCadProjectRecents||(typeof require==='function'?require('./project-recents.js'):null);await chrome.tabs.create({url:api.viewerURL(entry,name=>chrome.runtime.getURL(name))});return{opened:true,requiresFiles:entry.kind==='local'};
 }
 throw Error('Unsupported dashboard operation.');
}
async function recordLoadedProject(message,sender,result){
 if(!viewerSender(sender)||!['project','project-file'].includes(message.type)||! /\.kicad_(sch|pcb|pro)$/i.test(message.file||''))return;
 const ref=result?.recentSnapshotRef||message.ref;if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(ref||''))return;
 if(message.type==='project'&&(!Array.isArray(result)||!result.some(file=>file?.path===message.file&&typeof file.content==='string'))||message.type==='project-file'&&typeof result?.content!=='string')return;
 const entry={kind:'remote',provider:message.provider||'github',host:message.provider==='gitlab'?(message.host||'https://gitlab.com'):'https://github.com',repository:message.repository,ref,file:message.file};await recentHostAllowed(entry);await recents().record(entry);
}

// Only explicitly tagged, owned-viewer read operations participate in cancellation.
const projectLoads=new Map();
function loadKey(sender,id){return JSON.stringify([sender.id,sender.tab?.id??null,sender.frameId??0,sender.documentId??null,sender.url,id]);}
function loadIdValid(id){return typeof id==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(id);}
function checkLoad(signal){if(signal?.aborted)throw Error('Project loading cancelled.');}
function linkedReadController(signal){
  checkLoad(signal);const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  return {controller,dispose:()=>signal?.removeEventListener('abort',abort)};
}
let githubProjectBuffer=null,githubProjectView=null,repositorySessionStore=null;
function repositorySessions(){const api=globalThis.KiCadRepositorySessions||(typeof require==='function'?require('./repository-sessions.js'):null);return repositorySessionStore||=api.create(chrome);}
async function viewerPreferences(){const value=await chrome.storage.local.get('project-viewer-mode');return {mode:value['project-viewer-mode']==='inline'?'inline':'tab'};}
function projectBuffer(){return githubProjectBuffer||=(KiCadGitHubProjectBuffer.create({foregroundOnly:true,readSession:(...args)=>githubSessionRead(...args),fetch:(...args)=>fetch(...args),assertNetwork:()=>globalThis.KiCadManagedPolicy?.assertNetwork()}));}
function projectView(){return githubProjectView||=(KiCadGitHubProjectView.create({buffer:projectBuffer()}));}
async function cancellableProject(message,signal){return projectView().read(message,signal);}
// Reads remain in an isolated content script on the already-open repository tab.
// Cookies and signed raw URLs never enter extension messages or storage.
async function sessionLoadMessage(tabId,message,signal){
 await globalThis.KiCadManagedPolicy?.assertNetwork();
 checkLoad(signal);const requestId='load-'+crypto.randomUUID().replaceAll('-','');
 const abort=()=>{chrome.tabs.sendMessage(tabId,{type:'repository-session-cancel',requestId},{frameId:0}).catch(()=>{});};
 signal?.addEventListener('abort',abort,{once:true});
 try{const result=await chrome.tabs.sendMessage(tabId,{...message,...(signal?{requestId}:{})},{frameId:0});checkLoad(signal);return result;}
 finally{signal?.removeEventListener('abort',abort);}
}
async function githubSessionRead(repository,ref,action,path='',limit=8*1024*1024,signal) {
  checkLoad(signal);if(!validRepository(repository)||!KiCadBrowserData.validRef(ref))throw Error('Invalid GitHub session location.');
  const tabs=await repositorySessions().candidates('github','https://github.com',repository);
  let accessError=null;
  for(const tab of tabs) {
    if(!tab.bound){let url;try{url=new URL(tab.url);}catch{continue;}if(url.origin!=='https://github.com'||url.pathname.split('/').slice(1,3).join('/').toLowerCase()!==repository.toLowerCase())continue;}
    const read=()=>sessionLoadMessage(tab.id,{type:'github-session-read',repository,ref,action,path,limit:Math.min(limit,action==='file'?64*1024*1024:32*1024*1024)},signal);
    let reply;try{reply=await read();}catch{
      checkLoad(signal);
      if(!tab.bound||!await repositorySessions().recover(tab.id,'github','https://github.com',repository))continue;
      checkLoad(signal);try{reply=await read();}catch{checkLoad(signal);continue;}
    }
    if(!reply?.ok){if(typeof reply?.error==='string')accessError=Error(reply.error.slice(0,1000));continue;}
    const result=reply.result;
    if(action==='context') {
      if(result?.repository!==repository||!KiCadBrowserData.validRef(result?.ref)||!KiCadGitHubSessionReader.safePath(result?.directory,true)||!SHA.test(result?.sha||'')||!Array.isArray(result?.items)||result.items.length>1000)throw Error('Invalid GitHub website context response.');
    }else if(action==='pull') {
      return KiCadGitHubWebsitePulls.validatePull(result,repository,Number(path));
    }else if(action==='pulls') {
      return KiCadGitHubWebsitePulls.validateList(result,repository);
    }else if(action==='branches') {
      return KiCadGitHubWebsiteHistory.validateBranches(result,repository);
    }else if(action==='commit') {
      return KiCadGitHubWebsiteHistory.validateCommit(result,repository,ref);
    }else if(action==='history') {
      if(result?.ref!==ref||typeof result.content!=='string'||new TextEncoder().encode(result.content).byteLength>4*1024*1024)throw Error('Invalid GitHub website history response.');
    }else if(action==='asset') {
      if(result===null)return null;
      if(result?.sha?.toLowerCase()!==ref.toLowerCase()||typeof result.base64!=='string'||result.base64.length>Math.ceil(limit*4/3)+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64))throw Error('Invalid GitHub session asset response.');
    } else if(action==='file') {
      if(result===null)return null;
      if(result?.sha?.toLowerCase()!==ref.toLowerCase()||typeof result.content!=='string'||new TextEncoder().encode(result.content).byteLength>limit)throw Error('Invalid GitHub session file response.');
    } else if(!SHA.test(result?.sha||'')||SHA.test(ref)&&result.sha.toLowerCase()!==ref.toLowerCase()||!Array.isArray(result.items)||result.items.length>1000)throw Error('Invalid GitHub session revision response.');
    return result;
  }
  if(accessError)throw accessError;return null;
}
async function githubSessionProject(repository,ref,file,originalError,signal) {
  const snapshot=await githubSessionRead(repository,ref,'resolve','',8*1024*1024,signal);
  if(!snapshot)throw originalError;
  return recentSnapshot(await KiCadBrowserData.loadProject(repository,snapshot.sha,file,async(repo,sha,path)=>{
    const result=await githubSessionRead(repo,sha,'file',path,KiCadBrowserData.fileByteLimit(path),signal);
    return result?.content??null;
  },async(repo,sha,directory)=>{
    const result=await githubSessionRead(repo,sha,'directory',directory,8*1024*1024,signal);
    if(!result)throw Error('GitHub session directory unavailable. Keep the repository tab open.');
    return result.items.filter(item=>item.type==='file'&&/\.kicad_sch$/i.test(item.path)).map(item=>item.path);
  }),snapshot.sha);
}
async function githubSessionInventory(repository,ref,originalError,acceptPath=KiCadGitHub.filePath,signal) {
  const snapshot=await githubSessionRead(repository,ref,'resolve','',8*1024*1024,signal);if(!snapshot)throw originalError;
  const pending=[''],files=[],warnings=[];let directories=0;
  while(pending.length&&directories<64&&files.length<1000) {
    const directory=pending.shift(),result=await githubSessionRead(repository,snapshot.sha,'directory',directory,8*1024*1024,signal);directories++;
    if(!result)throw Error('GitHub session tree unavailable. Keep the repository tab open or connect GitHub.');
    for(const item of result.items) {
      if(typeof item.path!=='string'||item.path.length>500||item.path.split('/').slice(0,-1).join('/')!==directory||item.path.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f\x7f]/.test(p)))throw Error('Unsafe GitHub session tree.');
      if(item.type==='directory'){if(item.path.split('/').length<=9&&pending.length<1000)pending.push(item.path);else warnings.push('Session tree traversal limit reached; project structure is incomplete.');}
      else if(item.type==='file'&&acceptPath(item.path)&&files.length<1000)files.push({path:item.path,size:0});
    }
  }
  if(pending.length||files.length===1000)warnings.push('Session tree discovery is limited to 64 directories and 1000 supported files. Connect GitHub for larger repositories.');
  warnings.push('Read using the open GitHub website session. File sizes and API history are unavailable until GitHub is connected.');
  return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),snapshotRef:snapshot.sha,warnings:[...new Set(warnings)]};
}

let badgeGeneration = 0;
async function updateGitHubBadge() {
  if (!chrome.action?.setBadgeText) return;
  const generation = ++badgeGeneration;
  const status = await KiCadGitHubReviewApi.tokenStatus();
  if (generation !== badgeGeneration) return;
  await chrome.action.setBadgeBackgroundColor({ color: status.configured ? '#238636' : '#6e7681' });
  await chrome.action.setBadgeText({ text: status.configured ? '●' : '' });
  await chrome.action.setTitle({ title: status.configured ?
    'KiCad Online — GitHub connected' : 'KiCad Online — GitHub signed out' });
}
// Clear a stale connected badge when a new worker cannot unlock the old session.
updateGitHubBadge().catch(() => {});
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'session' && ('github-review-token' in changes || 'github-device-pending' in changes)) {
    updateGitHubBadge().catch(() => {});
  }
});

let devicePollTimer = null;
function scheduleDeviceCheck(delay = 5000) {
  if (devicePollTimer !== null) clearTimeout(devicePollTimer);
  devicePollTimer = setTimeout(async () => {
    devicePollTimer = null;
    try {
      const flow = await KiCadGitHubReviewApi.deviceStatus();
      if (!flow.active) return;
      const result = await KiCadGitHubReviewApi.pollDevice();
      await updateGitHubBadge();
      if (result.state === 'pending') scheduleDeviceCheck(result.retryAfterMs);
    } catch {
      const flow = await KiCadGitHubReviewApi.deviceStatus().catch(() => null);
      if (flow?.active) scheduleDeviceCheck(Math.max(5000, flow.retryAfterMs));
    }
  }, Math.min(20000, Math.max(1000, Number(delay) || 5000)));
  devicePollTimer?.unref?.(); // Node test runners need not wait for an authorization timer.
}

function validRepository(value) {
  return typeof value === "string" && REPOSITORY.test(value) &&
    value.split("/").every((part) => part !== "." && part !== "..");
}

async function githubReadHeaders(headers = {}) {
  const result = { "X-GitHub-Api-Version": "2022-11-28", ...headers };
  Object.assign(result, await KiCadGitHubReviewApi.authorizationHeaders());
  return result;
}
function githubReadError(response) {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const retry = response.headers.get('retry-after');
  if ((response.status === 403 || response.status === 429) && (remaining === '0' || retry || response.status === 429)) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const when = retry ? ` Retry after ${retry} seconds.` : Number.isFinite(reset) && reset > 0 ? ` Retry after ${new Date(reset * 1000).toISOString()}.` : ' Wait before retrying.';
    return new Error('GitHub API rate limit reached.' + when + ' Connect your GitHub account in extension settings for authenticated reads.');
  }
  if (response.status === 401) return new Error('GitHub authentication failed (HTTP 401). Reconnect your account in extension settings.');
  if (response.status === 403) return new Error('GitHub denied this request (HTTP 403). Check repository access and your account permissions in extension settings.');
  return new Error(`GitHub returned HTTP ${response.status}.`);
}

async function githubResponse(url, headers = {}, signal) {
  const {controller,dispose} = linkedReadController(signal);
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      headers: await githubReadHeaders(headers),
      credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal
    });
    if (response.status === 404) return null;
    if (!response.ok) throw githubReadError(response);
    return response;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("GitHub file retrieval timed out.");
    throw error;
  } finally { clearTimeout(timeout); dispose(); }
}

async function githubJson(url,signal) {
  if(signal)return githubDiscoveryJson(url,16*1024*1024,signal);
  const response = await githubResponse(url, { Accept: "application/vnd.github+json" },signal);
  if (!response) throw new Error("GitHub returned HTTP 404: this resource may be missing or your extension account may lack private repository access. GitHub website sign-in does not sign the extension in. Check the path/revision and connect a token with access to this repository in extension settings.");
  return response.json();
}

async function githubFile(repository, ref, path, signal) {
  if (!KiCadBrowserData.validRepository(repository) || !KiCadBrowserData.validRef(ref) ||
      typeof path !== "string" || !path || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === ".." || /[\\:\x00-\x1f\x7f]/.test(part))) throw new Error("Invalid GitHub file location.");
  const limit = KiCadBrowserData.fileByteLimit(path);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${repository}/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
  const {controller,dispose} = linkedReadController(signal), timeout = setTimeout(() => controller.abort(), 60000);
  try {
    let response = await fetch(url, { headers: await githubReadHeaders({ Accept: "application/vnd.github.raw+json" }), credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
    // Public raw content is a separate, anonymous transport. Never send a token
    // to the asset host or follow a redirect with authorization attached.
    if ((response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') || response.status === 429) {
      const apiError = githubReadError(response);
      response = await fetch(`https://raw.githubusercontent.com/${repository}/${encodeURIComponent(ref)}/${encoded}`, { credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
      if (!response.ok) throw apiError;
    }
    if ([401,403,404].includes(response.status)) {
      const pinned=SHA.test(ref)?{sha:ref}:await githubSessionRead(repository,ref,'resolve','',8*1024*1024,signal);
      const session=pinned&&await githubSessionRead(repository,pinned.sha,'file',path,limit,signal);
      if(session)return session.content;
    }
    if (response.status === 404) return null;
    if (!response.ok) throw githubReadError(response);
    // Raw media avoids the Contents JSON endpoint's empty content above 1 MiB.
    // Still accept bounded base64 envelopes from compatible mocks/proxies.
    const json = response.headers.get("content-type")?.includes("json");
    const responseLimit = json ? Math.ceil(limit * 4 / 3) + 65536 : limit;
    if (Number(response.headers.get("content-length")) > responseLimit) throw new Error("KiCad file exceeds the browser preview size limit.");
    const reader = response.body.getReader(), chunks = []; let count = 0;
    const cancelBody=()=>reader.cancel().catch(()=>{});controller.signal.addEventListener('abort',cancelBody,{once:true});if(controller.signal.aborted)cancelBody();
    try{while (true) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > responseLimit) { await reader.cancel(); throw new Error("KiCad file exceeds the browser preview size limit."); }
      chunks.push(value);
    }}finally{controller.signal.removeEventListener('abort',cancelBody);}
    checkLoad(controller.signal);const bytes = new Uint8Array(count); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = new TextDecoder().decode(bytes);
    let data;
    if (json) { try { data = JSON.parse(body); } catch {} }
    if (data && typeof data === "object" && (Object.hasOwn(data, "encoding") || Object.hasOwn(data, "content"))) {
      if (typeof data.content !== "string" || data.encoding !== "base64" || !/^[A-Za-z0-9+/=\r\n]*$/.test(data.content)) throw new Error("GitHub did not return KiCad file contents.");
      const binary = atob(data.content.replace(/\s/g, ""));
      if (binary.length > limit) throw new Error("KiCad file exceeds the browser preview size limit.");
      return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
    }
    if (count > limit) throw new Error("KiCad file exceeds the browser preview size limit.");
    return body;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("GitHub file retrieval timed out.");
    throw error;
  } finally { clearTimeout(timeout); dispose(); }
}

async function githubDirectory(repository, ref, directory, includeBoards = false, signal) {
  if (!KiCadBrowserData.validRepository(repository) || !KiCadBrowserData.validRef(ref) ||
      typeof directory !== "string" || (directory && (directory.startsWith("/") ||
      directory.split("/").some((part) => !part || part === "." || part === ".." || /[\\\x00-\x1f\x7f]/.test(part))))) {
    throw new Error("Invalid GitHub schematic directory.");
  }
  const encoded = directory ? `/${directory.split("/").map(encodeURIComponent).join("/")}` : "";
  let listing;
  try {listing=await githubJson(`https://api.github.com/repos/${repository}/contents${encoded}?ref=${encodeURIComponent(ref)}`,signal);}
  catch(error){
    checkLoad(signal);if(!/HTTP (401|403|404)|rate limit/i.test(error.message))throw error;
    const pinned=SHA.test(ref)?{sha:ref}:await githubSessionRead(repository,ref,'resolve','',8*1024*1024,signal);
    const result=pinned&&await githubSessionRead(repository,pinned.sha,'directory',directory,8*1024*1024,signal);
    if(!result)throw error;
    listing=result.items.map(item=>({path:item.path,type:item.type}));
  }
  if (!Array.isArray(listing) || listing.length >= 1000) {
    throw new Error("GitHub returned an incomplete schematic directory listing.");
  }
  return listing.filter((item) => item?.type === "file" && typeof item.path === "string" &&
    (includeBoards ? /\.kicad_(?:sch|pcb)$/i : /\.kicad_sch$/i).test(item.path))
    .map((item) => item.path);
}

async function githubDiscoveryText(url, limit, accept='application/vnd.github+json',signal) {
  const response=await githubResponse(url,{Accept:accept},signal);
  if(!response)throw new Error('GitHub revision was not found (HTTP 404), or your extension account lacks private repository access. Check the exact revision and sign in with private repository access in extension settings.');
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error('GitHub schematic discovery response exceeds its size limit.');}
  const reader=response.body.getReader(),chunks=[];let length=0,timedOut=false;
  const abort=()=>reader.cancel().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timeout=setTimeout(()=>{timedOut=true;reader.cancel().catch(()=>{});},30000);
  try{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('GitHub schematic discovery response exceeds its size limit.');}chunks.push(value);}
    checkLoad(signal);if(timedOut)throw new Error('GitHub schematic discovery timed out.');
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new TextDecoder().decode(bytes);
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}

async function githubDiscoveryJson(url, limit,signal) { return JSON.parse(await githubDiscoveryText(url,limit,'application/vnd.github+json',signal)); }

async function githubResolvedSha(repository,ref,signal) {
  // SHA media omits changed-file patches, which can dwarf the design itself.
  const sha=(await githubDiscoveryText(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,128,'application/vnd.github.sha',signal)).trim();
  if(!SHA.test(sha)||SHA.test(ref)&&sha.toLowerCase()!==ref.toLowerCase())throw new Error('GitHub did not resolve a stable revision.');
  return sha.toLowerCase();
}

async function githubSchematicSnapshot(repository,ref,signal) {
  const sha=SHA.test(ref)?ref.toLowerCase():await githubResolvedSha(repository,ref,signal);
  const commit=await githubDiscoveryJson(`https://api.github.com/repos/${repository}/git/commits/${sha}`,1024*1024,signal);
  if(!SHA.test(commit?.sha)||commit.sha.toLowerCase()!==sha||!SHA.test(commit?.tree?.sha))throw new Error('GitHub did not resolve a stable schematic revision.');
  return {sha,treeSha:commit.tree.sha};
}

async function githubSchematicInventory(repository, ref, treeSha,signal) {
  if (!KiCadBrowserData.validRepository(repository) || !SHA.test(ref || '') || !SHA.test(treeSha || '')) {
    throw new Error('A pinned GitHub commit and tree are required for schematic discovery.');
  }
  const listing = await githubDiscoveryJson(`https://api.github.com/repos/${repository}/git/trees/${treeSha}?recursive=1`,16*1024*1024,signal);
  if (!Array.isArray(listing?.tree) || listing.tree.length > 100000 || listing.truncated) {
    throw new Error('GitHub returned an incomplete schematic repository tree.');
  }
  const files = listing.tree.filter(item => item?.type === 'blob' && item.mode !== '120000' &&
    typeof item.path === 'string' && /\.kicad_sch$/i.test(item.path)).map(item => item.path);
  if (files.some(path => !KiCadBrowserData.validPath(path))) throw new Error('GitHub returned an unsafe schematic repository listing.');
  if (files.length > KiCadBrowserData.PROJECT_MAX_FILES) throw new Error('More than 128 parent-sheet candidates; open the project root directly.');
  return files.sort();
}

async function drawingFiles(repository, ref, file) {
  if (!KiCadBrowserData.validRepository(repository) || !KiCadBrowserData.validRef(ref) ||
      !KiCadBrowserData.validPath(file)) throw new Error("Invalid GitHub drawing location.");
  const directory = file.split("/").slice(0, -1).join("/");
  const files = (await githubDirectory(repository, ref, directory, true)).filter((path) =>
    KiCadBrowserData.validPath(path) && path.split("/").slice(0, -1).join("/") === directory).sort();
  return { files, warnings: [] };
}

// Read-only history discovery. Resolve moving refs before listing file history.
async function revisionJson(url){
  const response=await githubResponse(url,await githubReadHeaders({Accept:'application/vnd.github+json'}));
  if(!response)throw new Error('GitHub revision was not found (HTTP 404), or your extension account lacks private repository access. Check the exact revision and sign in with private repository access in extension settings.');
  if(Number(response.headers.get('content-length'))>1024*1024)throw new Error('Revision response exceeds 1 MiB.');
  const text=await response.text();if(new TextEncoder().encode(text).byteLength>1024*1024)throw new Error('Revision response exceeds 1 MiB.');
  return {value:JSON.parse(text),next:/rel="next"/.test(response.headers.get('link')||'')};
}
function revisionScope(repository,ref,file){
  if(!KiCadBrowserData.validRepository(repository)||!KiCadBrowserData.validRef(ref)||!KiCadGitHub.filePath(file)||file.length>500||/[\\:\x00-\x1f\x7f]/.test(file))throw new Error('Invalid drawing revision location.');
}
async function revisionResolve(repository,ref,file,signal){
  revisionScope(repository,ref,file);
  try {return {repository,ref,sha:await githubResolvedSha(repository,ref,signal)};}
  catch(error){checkLoad(signal);if(!/HTTP (401|403|404)|rate limit/i.test(error.message))throw error;const snapshot=await githubSessionRead(repository,ref,'resolve','',8*1024*1024,signal);if(!snapshot)throw error;return {repository,ref,sha:snapshot.sha};}
}
async function revisionBranches(repository,ref,file){revisionScope(repository,ref,file);return repositoryBranches(repository,ref);}
async function repositoryBranches(repository,ref){
  repositoryScope(repository,ref);
  const {value,next}=await revisionJson(`https://api.github.com/repos/${repository}/branches?per_page=100&page=1`);
  if(!Array.isArray(value)||value.length>100)throw new Error('Invalid branch listing.');
  const warnings=[],branches=[];
  for(const item of value){if(!KiCadBrowserData.validRef(item?.name)||!SHA.test(item?.commit?.sha)){warnings.push('Invalid branch entry omitted.');continue;}branches.push({name:item.name,sha:item.commit.sha});}
  if(next||value.length===100)warnings.push('At most 100 branches shown; enter another branch name manually.');
  return {repository,branches,warnings:[...new Set(warnings)]};
}
async function revisionCommits(repository,ref,file){
  const snapshot=await revisionResolve(repository,ref,file);
  const query=new URLSearchParams({sha:snapshot.sha,path:file,per_page:'50',page:'1'});
  const {value,next}=await revisionJson(`https://api.github.com/repos/${repository}/commits?${query}`);
  if(!Array.isArray(value)||value.length>50)throw new Error('Invalid commit listing.');
  const warnings=[],commits=[];
  for(const item of value){if(!SHA.test(item?.sha)){warnings.push('Invalid commit entry omitted.');continue;}const bounded=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300):'';commits.push({sha:item.sha,message:bounded(item.commit?.message?.split('\n')[0]),author:bounded(item.commit?.author?.name),date:bounded(item.commit?.author?.date)});}
  if(next||value.length===50)warnings.push('At most 50 commits touching this file shown; enter an older SHA manually.');
  return {repository,file,snapshotRef:snapshot.sha,commits,warnings:[...new Set(warnings)]};
}

// Repository metadata is independent of the currently selected drawing.
function repositoryScope(repository,ref){if(!KiCadBrowserData.validRepository(repository)||!KiCadBrowserData.validRef(ref))throw Error('Invalid repository location.');}
function repositoryPath(path){return typeof path==='string'&&path.length<=500&&!path.startsWith('/')&&!/[\\:\x00-\x1f\x7f]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');}
function repositoryPage(page=1){if(!Number.isSafeInteger(page)||page<1||page>100)throw Error('Repository page must be between 1 and 100.');return page;}
function repositoryMessage(value,warnings){
  if(typeof value!=='string')return '';
  value=value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
  const encoder=new TextEncoder();if(encoder.encode(value).length<=8192)return value;
  let low=0,high=Math.min(value.length,8192);while(low<high){const middle=Math.ceil((low+high)/2);if(encoder.encode(value.slice(0,middle)).length<=8192)low=middle;else high=middle-1;}
  warnings.push('A commit message was shortened to 8 KiB.');return value.slice(0,low);
}
function repositoryEntry(item,prefix='',warnings=[]){
  if(!item||!['tree','blob','commit'].includes(item.type)||!repositoryPath(item.path)||!SHA.test(item.sha||'')||!({tree:['040000'],blob:['100644','100755','120000'],commit:['160000']}[item.type]?.includes(item.mode))){
    warnings.push('Invalid repository entry omitted.');return null;
  }
  return {path:prefix+item.path,type:item.type,sha:item.sha.toLowerCase(),mode:item.mode};
}
async function repositoryTree(repository,ref,{page=1,directory}={}){
  repositoryScope(repository,ref);page=repositoryPage(page);
  if(directory!==undefined&&directory!==''&&!repositoryPath(directory))throw Error('Invalid repository directory.');
  if(directory!==undefined&&directory.split('/').length>32)throw Error('Repository directory exceeds 32 levels.');
  if(directory===undefined&&page!==1)throw Error('Recursive GitHub trees use directory browsing rather than page numbers.');
  const snapshot=await githubSchematicSnapshot(repository,ref),warnings=[];let treeSha=snapshot.treeSha;
  const deadline=Date.now()+90000;
  // Resolve every directory component through immutable Git trees. Never mix
  // a branch-tip Contents response with an earlier graph/tree snapshot.
  for(const part of directory?directory.split('/'):[]){
    if(Date.now()>deadline)throw Error('Repository directory lookup timed out.');
    const listing=await githubDiscoveryJson(`https://api.github.com/repos/${repository}/git/trees/${treeSha}`,16*1024*1024);
    if(!Array.isArray(listing.tree)||listing.tree.length>100000||listing.sha?.toLowerCase()!==treeSha.toLowerCase()||typeof listing.truncated!=='boolean')throw Error('Invalid or mismatched GitHub repository tree.');
    const found=listing.tree.find(item=>item.path===part&&item.type==='tree'&&SHA.test(item.sha||''));
    if(!found)throw Error(listing.truncated?'GitHub truncated this directory; its requested child could not be resolved.':'Repository directory was not found at the pinned revision.');
    treeSha=found.sha;
  }
  const recursive=directory===undefined,listing=await githubDiscoveryJson(`https://api.github.com/repos/${repository}/git/trees/${treeSha}${recursive?'?recursive=1':''}`,16*1024*1024);
  if(!Array.isArray(listing.tree)||listing.tree.length>100000||listing.sha?.toLowerCase()!==treeSha.toLowerCase()||typeof listing.truncated!=='boolean')throw Error('Invalid or mismatched GitHub repository tree.');
  const prefix=directory?directory+'/':'';
  const seenPaths=new Set(),clean=listing.tree.map(item=>{if(seenPaths.has(item?.path)){warnings.push('Duplicate repository entry omitted.');return null;}seenPaths.add(item?.path);if(!recursive&&typeof item?.path==='string'&&item.path.includes('/')){warnings.push('Invalid directory entry omitted.');return null;}return repositoryEntry(item,prefix,warnings);}).filter(Boolean);
  const truncated=Boolean(listing.truncated)||clean.length>10000||clean.length!==listing.tree.length;
  if(truncated)warnings.push('Repository tree is incomplete; expand folders to browse their pinned contents.');
  const available=clean.slice(0,10000),start=recursive?0:(page-1)*100,entries=available.slice(start,recursive?10000:start+100),hasMore=!recursive&&start+100<available.length&&page<100;
  if(!recursive&&start+100<clean.length&&page===100)warnings.push('Directory browsing stopped at 10,000 entries.');
  return {repository,ref,sha:snapshot.sha,snapshotRef:snapshot.sha,directory:directory||'',entries,truncated,hasMore,nextPage:hasMore?page+1:null,warnings:[...new Set(warnings)]};
}
async function repositoryHistory(repository,ref,page=1){
  repositoryScope(repository,ref);page=repositoryPage(page);
  const pinned=SHA.test(ref)?ref.toLowerCase():await githubResolvedSha(repository,ref),query=new URLSearchParams({sha:pinned,per_page:'30',page:String(page)});
  const {value,next}=await revisionJson(`https://api.github.com/repos/${repository}/commits?${query}`);
  if(!Array.isArray(value)||value.length>30)throw Error('Invalid GitHub repository history.');
  const warnings=[],commits=[],seen=new Set(),text=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,200):'';
  for(const item of value){
    if(!SHA.test(item?.sha||'')||seen.has(item.sha.toLowerCase())){warnings.push('Invalid or duplicate commit omitted.');continue;}
    if(!Array.isArray(item.parents)||item.parents.length>32||item.parents.some(parent=>!SHA.test(parent?.sha||'')))throw Error('Invalid GitHub commit parents; graph cannot be represented faithfully.');
    seen.add(item.sha.toLowerCase());const sha=item.sha.toLowerCase();commits.push({sha,parents:item.parents.map(parent=>parent.sha.toLowerCase()),message:repositoryMessage(item.commit?.message,warnings),author:text(item.commit?.author?.name),date:text(item.commit?.author?.date),url:`https://github.com/${repository}/commit/${sha}`});
  }
  const more=next||value.length===30,hasMore=more&&page<100;if(more&&!hasMore)warnings.push('History browsing stopped at 3,000 commits.');
  return {repository,ref,sha:pinned,snapshotRef:pinned,commits,hasMore,nextPage:hasMore?page+1:null,warnings:[...new Set(warnings)]};
}

async function projectSearchFiles(repository, ref, file) {
  if (!KiCadBrowserData.validRepository(repository) || !KiCadBrowserData.validRef(ref) || !KiCadBrowserData.validPath(file)) throw new Error("Invalid project search location.");
  const commit = await githubJson(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`);
  if (!SHA.test(commit?.sha) || !SHA.test(commit?.commit?.tree?.sha)) throw new Error("GitHub did not resolve a stable project revision.");
  const listing = await githubJson(`https://api.github.com/repos/${repository}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  if (!Array.isArray(listing.tree) || listing.tree.length > 100000) throw new Error("Project tree exceeds the search discovery limit.");
  const warnings = listing.truncated ? ["GitHub truncated the repository tree; project search is incomplete."] : [];
  const candidates = listing.tree.filter(item => item?.type === "blob" && item.mode !== "120000" && KiCadBrowserData.validPath(item.path)).sort((a,b)=>a.path.localeCompare(b.path));
  // Prioritize the opened drawing; never fetch source at a moving branch after discovery.
  candidates.sort((a,b)=>(b.path===file?1:0)-(a.path===file?1:0));
  const files=[];let total=0;
  for(const item of candidates.slice(0,32)) {
    if(Number(item.size)>KiCadBrowserData.fileByteLimit(item.path)){warnings.push(`${item.path}: exceeds the ${KiCadBrowserData.fileByteLimit(item.path)/1024/1024} MiB drawing limit.`);continue;}
    if(total+Number(item.size||0)>KiCadBrowserData.PROJECT_MAX_BYTES){warnings.push("Project search reached its 96 MiB source limit.");break;}
    try {const content=await githubFile(repository,commit.sha,item.path);if(content===null){warnings.push(`${item.path}: source unavailable.`);continue;}
      const bytes=new TextEncoder().encode(content).byteLength;if(bytes>KiCadBrowserData.fileByteLimit(item.path)||total+bytes>KiCadBrowserData.PROJECT_MAX_BYTES){warnings.push(`${item.path}: source size limit reached.`);continue;}
      total+=bytes;files.push({path:item.path,content});
    }catch(error){warnings.push(`${item.path}: ${error.message}`);}
  }
  if(candidates.length>32)warnings.push(`Project has ${candidates.length} drawings; search loads at most 32. Narrow the repository or open another project.`);
  const settings=[];
  const projectFiles=listing.tree.filter(item=>item?.type==='blob'&&item.mode!=='120000'&&typeof item.path==='string'&&item.path.length<=500&&/\.kicad_pro$/i.test(item.path)&&!item.path.startsWith('/')&&item.path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\\:\x00-\x1f\x7f]/.test(p))).sort((a,b)=>a.path.localeCompare(b.path));
  for(const item of projectFiles.slice(0,8)){if(Number(item.size)>1024*1024){warnings.push(`${item.path}: project settings exceed 1 MiB.`);continue;}try{const content=await githubFile(repository,commit.sha,item.path);if(content!==null&&new TextEncoder().encode(content).byteLength<=1024*1024)settings.push({path:item.path,content});else warnings.push(`${item.path}: settings unavailable or too large.`);}catch(error){warnings.push(`${item.path}: ${error.message}`);}}
  if(projectFiles.length>8)warnings.push('Only the first eight project settings files were retrieved. Import the desired .kicad_pro if it is absent.');
  return {files,settings,warnings,snapshotRef:commit.sha,totalDrawings:candidates.length};
}

async function projectInventory(repository,ref,file,signal){
  if(!KiCadBrowserData.validRepository(repository)||!KiCadBrowserData.validRef(ref)||!KiCadGitHub.filePath(file))throw new Error('Invalid project location.');
  try {
  const commit=await githubJson(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,signal);
  if(!SHA.test(commit?.sha)||!SHA.test(commit?.commit?.tree?.sha))throw new Error('No stable project revision.');
  const tree=await githubJson(`https://api.github.com/repos/${repository}/git/trees/${commit.commit.tree.sha}?recursive=1`,signal);
  if(!Array.isArray(tree.tree)||tree.tree.length>100000)throw new Error('Repository tree exceeds project discovery limit.');
  const entries=tree.tree.filter(item=>item?.type==='blob'&&item.mode!=='120000'&&KiCadGitHub.filePath(item.path)).sort((a,b)=>a.path.localeCompare(b.path));
  const warnings=[];if(tree.truncated)warnings.push('GitHub truncated the repository tree; project structure is incomplete.');if(entries.length>1000)warnings.push('First 1000 supported project files shown.');
  return {files:entries.slice(0,1000).map(item=>({path:item.path,size:Number(item.size)||0})),snapshotRef:commit.sha,warnings};
  } catch(error){checkLoad(signal);if(!/HTTP (401|403|404)|rate limit/i.test(error.message))throw error;return githubSessionInventory(repository,ref,error,KiCadGitHub.filePath,signal);}
}
async function repositoryModelIndex(repository,ref){
  if(!validRepository(repository)||!SHA.test(ref||''))throw Error('Model discovery requires a repository and immutable revision.');
  try{
    const commit=await githubJson(`https://api.github.com/repos/${repository}/commits/${ref}`);
    if(commit?.sha!==ref||!SHA.test(commit?.commit?.tree?.sha))throw Error('Model discovery revision did not match the opened board.');
    const tree=await githubJson(`https://api.github.com/repos/${repository}/git/trees/${commit.commit.tree.sha}?recursive=1`);
    if(!Array.isArray(tree.tree)||tree.tree.length>100000)throw Error('Repository tree exceeds model discovery limit.');
    const paths=[...new Set(tree.tree.filter(item=>item?.type==='blob'&&item.mode!=='120000'&&validAssetPath(item.path)&&!/[?#%:]/.test(item.path)).map(item=>item.path))].sort();
    const warnings=[];if(tree.truncated)warnings.push('GitHub truncated the repository tree; model discovery is incomplete.');
    if(paths.length>2000)warnings.push('Model discovery is limited to 2000 files; library path matching may be incomplete.');
    return {paths:paths.slice(0,2000),snapshotRef:ref,warnings};
  }catch(error){
    if(!/HTTP (401|403|404)|rate limit/i.test(error.message))throw error;
    const listing=await githubSessionInventory(repository,ref,error,validAssetPath);
    if(listing.snapshotRef!==ref)throw Error('Model discovery revision did not match the opened board.');
    return {paths:listing.files.map(item=>item.path),snapshotRef:ref,warnings:listing.warnings};
  }
}
async function projectFile(repository,ref,file,signal){
  if(!KiCadBrowserData.validRepository(repository)||!KiCadBrowserData.validRef(ref)||!KiCadGitHub.filePath(file))throw new Error('Invalid project file.');
  const content=await githubFile(repository,ref,file,signal);if(content===null)throw new Error('Project file unavailable.');if(new TextEncoder().encode(content).byteLength>KiCadBrowserData.fileByteLimit(file))throw new Error('Project file exceeds its size limit.');return {path:file,content};
}
async function openProjectWindow(repository,ref,file){
  if(!KiCadBrowserData.validRepository(repository)||!KiCadBrowserData.validRef(ref)||!KiCadGitHub.filePath(file))throw new Error('Invalid project location.');
  const query=new URLSearchParams({repository,ref,file});const window=await chrome.windows.create({url:chrome.runtime.getURL('project-viewer.html')+'?'+query,type:'popup',state:'maximized'});return {windowId:window?.id??null};
}

async function openViewerWindow(repository, ref, file, pairedFile) {
  if (!KiCadBrowserData.validRepository(repository) || !KiCadBrowserData.validRef(ref) ||
      !KiCadBrowserData.validPath(file)) throw new Error("Invalid GitHub drawing location.");
  if (pairedFile !== undefined && (!KiCadBrowserData.validPath(pairedFile) ||
      /\.kicad_pcb$/i.test(pairedFile) === /\.kicad_pcb$/i.test(file))) {
    throw new Error("Paired drawing must be the opposite KiCad file type in this repository.");
  }
  const query = new URLSearchParams({ repository, head: ref, file, ...(pairedFile ? { pairedFile } : {}) });
  const url = `${chrome.runtime.getURL("browser-viewer.html")}?${query}`;
  const window = await chrome.windows.create({ url, type: "popup", state: "maximized" });
  return { windowId: window?.id ?? null };
}

const ASSET_REF = /^[A-Za-z0-9._/-]{1,200}$/;
const ASSET_SUFFIX = /\.(wrl|vrml|glb|step|stp)$/i;
const ASSET_MAX_BYTES = 8 * 1024 * 1024;
const assetBudgets = new Map();
function validAssetRef(ref) {
  return typeof ref === "string" && ASSET_REF.test(ref) && !ref.startsWith("/") &&
    !ref.endsWith("/") && ref.split("/").every((part) => part && part !== "." && part !== "..") &&
    !ref.includes("..");
}
function validAssetPath(path, pdf = false) {
  return typeof path === "string" && path.length <= 500 && (pdf ? /\.pdf$/i.test(path) : ASSET_SUFFIX.test(path)) &&
    !path.startsWith("/") && !/[\\\x00-\x1f\x7f]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}
async function githubAsset(repository, ref, file, pdf = false) {
  const assetMax = pdf ? 32 * 1024 * 1024 : ASSET_MAX_BYTES;
  if (!validRepository(repository) || !validAssetRef(ref) || !validAssetPath(file,pdf)) {
    throw new Error("Invalid repository, revision, or 3D model path.");
  }
  const key = `${repository.toLowerCase()}:${ref}`;
  const now = Date.now();
  let budget = assetBudgets.get(key);
  if (!budget || budget.resetAt <= now) budget = { requests: 0, bytes: 0, resetAt: now + 5 * 60 * 1000 };
  if (budget.requests >= 32 || budget.bytes >= 32 * 1024 * 1024) {
    throw new Error("The 3D model retrieval budget was reached; retry after five minutes.");
  }
  budget.requests++;
  assetBudgets.set(key, budget);
  if (assetBudgets.size > 128) assetBudgets.delete(assetBudgets.keys().next().value);
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${repository}/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(url, { headers: await githubReadHeaders({ Accept: "application/vnd.github.raw+json" }), credentials: "omit", cache: "no-store",
    redirect: "error", signal: controller.signal });
    if (response.status === 404) throw new Error("GitHub 3D model retrieval returned HTTP 404: the model may be absent or your extension account lacks access to this private repository. Check the saved model path and token repository permissions.");
    if (!response.ok) throw githubReadError(response);
    const jsonBody = response.headers.get("content-type")?.includes("json");
    const responseLimit = jsonBody ? Math.ceil(assetMax * 1.5) : assetMax;
    if (Number(response.headers.get("content-length")) > responseLimit) {
      throw new Error("3D model response exceeds the preview size limit.");
    }
    const chunks = [], reader = response.body?.getReader();
    let length = 0;
    if (!reader) throw new Error("GitHub 3D model response was unavailable.");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > responseLimit) {
        await reader.cancel().catch(() => {});
        throw new Error("3D model response exceeds the preview size limit.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let base64, decodedLength;
    if (jsonBody) {
      let data;
      try { data = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new Error("GitHub did not return an encoded 3D model."); }
      if (data?.encoding !== "base64" || typeof data.content !== "string" ||
          data.content.length > Math.ceil(assetMax * 1.4) || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.content)) {
        throw new Error("GitHub did not return a supported 3D model payload.");
      }
      base64 = data.content.replace(/\s/g, "");
      try { decodedLength = atob(base64).length; }
      catch { throw new Error("GitHub returned invalid 3D model data."); }
    } else {
      decodedLength = bytes.length;
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      base64 = btoa(binary);
    }
    if (decodedLength > assetMax || budget.bytes + decodedLength > 32 * 1024 * 1024) {
      throw new Error("3D model exceeds the per-asset or revision retrieval budget.");
    }
    budget.bytes += decodedLength;
    const mediaType = /\.(step|stp)$/i.test(file)?"model/step":file.toLowerCase().endsWith(".glb") ? "model/gltf-binary" : "model/vrml";
    return { base64, mediaType:pdf?'application/pdf':mediaType };
  } finally { clearTimeout(timeout); }
}

function pullEndpoint(repository, number) {
  if (!validRepository(repository) || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid GitHub pull request.");
  }
  return `https://api.github.com/repos/${repository}/pulls/${number}`;
}

async function githubPull(repository, number) {
  const endpoint = pullEndpoint(repository, number);
  const reader=await KiCadGitHubReviewApi.createPullReader(repository,number);
  const pull = await reader.read("pull");
  const baseRepo = pull.base?.repo, headRepo = pull.head?.repo;
  if (!baseRepo || typeof baseRepo.private!=='boolean' ||
      baseRepo.full_name?.toLowerCase() !== repository.toLowerCase()) {
    throw new Error("GitHub did not confirm the pull request base repository.");
  }
  if (!headRepo || typeof headRepo.private!=='boolean' || !validRepository(headRepo.full_name)) {
    throw new Error("GitHub did not provide an accessible pull request source repository.");
  }
  if((baseRepo.private||headRepo.private)&&!reader.authenticated)throw new Error("Sign in with private repository access to compare this pull request.");
  const baseSha = pull.base?.sha, headSha = pull.head?.sha;
  if (!SHA.test(baseSha || "") || !SHA.test(headSha || "")) {
    throw new Error("GitHub did not provide valid pull request revisions.");
  }
  const changedFiles = pull.changed_files;
  if (!Number.isSafeInteger(changedFiles) || changedFiles < 0) {
    throw new Error("GitHub did not provide the changed file count.");
  }
  const comparison = await reader.read("compare",{base:baseSha,head:headSha});
  const mergeBase = comparison.merge_base_commit?.sha;
  if (!SHA.test(mergeBase || "")) throw new Error("GitHub did not provide the pull request merge base.");
  if(comparison.base_commit?.sha!==baseSha||comparison.head_commit?.sha!==headSha)throw new Error("GitHub comparison did not confirm the pinned pull request revisions.");
  return { base: mergeBase, baseTip:baseSha, head: headSha, headRepository: headRepo.full_name,
    changedFiles, private: baseRepo.private||headRepo.private };
}

function designChanges(batch) {
  const result = [];
  for (const item of batch) {
    const path = item?.filename, old = item?.previous_filename || path;
    const newDesign = KiCadBrowserData.validPath(path);
    const oldDesign = KiCadBrowserData.validPath(old);
    if (newDesign && oldDesign && path.split(".").at(-1).toLowerCase() === old.split(".").at(-1).toLowerCase()) {
      result.push({ file: path, oldFile: old, status: item.status || "modified" });
    } else {
      if (oldDesign) result.push({ file: old, oldFile: old, status: "removed" });
      if (newDesign) result.push({ file: path, oldFile: path, status: "added" });
    }
  }
  return result;
}

async function githubFiles(repository, number, expectedFiles, expectedHead, expectedBase) {
  const endpoint = pullEndpoint(repository, number);
  if (!Number.isSafeInteger(expectedFiles) || expectedFiles < 0) {
    throw new Error("GitHub did not provide the changed file count.");
  }
  if (expectedFiles > 3000) {
    throw new Error("GitHub limits pull request file listings to 3,000 files; this review cannot show a complete comparison.");
  }
  if(!SHA.test(expectedHead||'')||!SHA.test(expectedBase||''))throw new Error("Pinned pull request revisions are required; reload the review.");
  const reader=await KiCadGitHubReviewApi.createPullReader(repository,number);
  const verify=async()=>{const pull=await reader.read('pull');if(pull.base?.repo?.full_name?.toLowerCase()!==repository.toLowerCase()||pull.base?.sha!==expectedBase||pull.head?.sha!==expectedHead||pull.changed_files!==expectedFiles)throw new Error("GitHub changed the pull request while loading files; reload the review.");};
  await verify();
  const files = [];
  let seen = 0;
  for (let page = 1; page <= 30; page++) {
    const batch = await reader.read("files",{page});
    if (!Array.isArray(batch) || batch.length > 100) throw new Error("Unexpected GitHub file list.");
    seen += batch.length;
    files.push(...designChanges(batch));
    if (seen >= expectedFiles || batch.length < 100) break;
  }
  if (seen !== expectedFiles) {
    throw new Error("GitHub changed or truncated the pull request file list; reload the review.");
  }
  await verify();
  return files;
}

function senderAllowed(sender) {
  if (sender?.id !== chrome.runtime.id) return false;
  try {
    if (["https://github.com", "https://gitlab.com"].includes(new URL(sender.url).origin)) return true;
  } catch { return false; }
  const page = sender.url?.split(/[?#]/, 1)[0];
  return page === chrome.runtime.getURL("revision-viewer.html") ||
    page === chrome.runtime.getURL("browser-viewer.html") ||
    page === chrome.runtime.getURL("schematic-viewer.html") ||
    page === chrome.runtime.getURL("pcb-viewer.html") || page === chrome.runtime.getURL("project-viewer.html");
}

function viewerSender(sender) {
  if (sender?.id !== chrome.runtime.id || !repositorySessions().frameAllowed(sender)) return false;
  const page = sender.url?.split(/[?#]/, 1)[0];
  return page === chrome.runtime.getURL("revision-viewer.html") ||
    page === chrome.runtime.getURL("browser-viewer.html") ||
    page === chrome.runtime.getURL("schematic-viewer.html") ||
    page === chrome.runtime.getURL("pcb-viewer.html") || page === chrome.runtime.getURL("project-viewer.html");
}

function comparisonSender(sender) {
  return sender?.id === chrome.runtime.id && (sender.frameId ?? 0) === 0 &&
    sender.url?.split(/[?#]/, 1)[0] === chrome.runtime.getURL('comparison-viewer.html');
}

// Comparison gets saved-source reads only, scoped to a live website session for
// the exact repository named by its own extension-page URL.
async function comparisonRead(message, sender) {
  if (!['revision-resolve', 'project', 'project-file', 'drawing-files'].includes(message.type) || message.loadId !== undefined)
    throw Error('Comparison can only read saved repository sources.');
  const page = new URL(sender.url), provider = page.searchParams.get('provider') || 'github';
  const host = provider === 'gitlab' ? page.searchParams.get('host') || 'https://gitlab.com' : 'https://github.com';
  const repository = page.searchParams.get('repository'), file = page.searchParams.get('file');
  const oldFile = page.searchParams.get('oldFile') || file;
  const companion = [file, oldFile].some(path => {
    if (typeof path !== 'string') return false;
    const stem = path.replace(/\.(?:kicad_sch|kicad_pcb|sch)$/i, '');
    return stem !== path && [stem + '.kicad_sch', stem + '.kicad_pcb', stem + '.sch']
      .includes(message.file);
  });
  if (!['github', 'gitlab'].includes(provider) || message.provider !== provider ||
      message.host !== host || message.repository !== repository ||
      page.searchParams.get('headRepository') && page.searchParams.get('headRepository') !== repository ||
      !KiCadBrowserData.validRepository(repository, provider) || !KiCadBrowserData.validRef(message.ref) ||
      !KiCadGitHub.filePath(file) || !KiCadGitHub.filePath(oldFile) ||
      message.file !== file && message.file !== oldFile &&
      !(message.type === 'project' && companion))
    throw Error('Comparison read does not match its repository and file scope.');
  if (provider === 'gitlab' && (globalThis.KiCadGitLabHosts ? !await KiCadGitLabHosts.allowed(host) : host !== 'https://gitlab.com'))
    throw Error('GitLab host is not allowed.');
  const candidates = await repositorySessions().candidates(provider, host, repository);
  let live = false;
  for (const candidate of candidates.filter(item => item.bound)) {
    let tab; try { tab = await chrome.tabs.get(candidate.id); } catch { continue; }
    try {
      const url = new URL(tab.url);
      if (url.origin === host && (url.pathname === '/' + repository || url.pathname.startsWith('/' + repository + '/'))) {
        live = true; break;
      }
    } catch {}
  }
  if (!live) throw Error('Open the matching repository website session before loading comparison revisions.');
  await globalThis.KiCadManagedPolicy?.authorize(message);
  if (provider === 'gitlab') return gitlabDispatch(message, sender);
  return cancellableProject(message);
}

// The analysis page only reads imported/repository source; it never receives review write privileges.
function pdfSender(sender) { return sender?.id === chrome.runtime.id && sender.url?.split(/[?#]/, 1)[0] === chrome.runtime.getURL('pdf-viewer.html'); }
function analysisSender(sender) {
  return sender?.id === chrome.runtime.id && sender.url?.split(/[?#]/, 1)[0] === chrome.runtime.getURL("analysis-viewer.html");
}

function bomSender(sender) {
 return sender?.id===chrome.runtime.id&&repositorySessions().frameAllowed(sender)&&sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('bom-viewer.html');
}
function fabricationSender(sender) {
  return sender?.id === chrome.runtime.id && repositorySessions().frameAllowed(sender) && sender.url?.split(/[?#]/, 1)[0] === chrome.runtime.getURL('gerber-viewer.html');
}

function optionsSender(sender) {
  return sender?.id === chrome.runtime.id &&
    sender.url?.split(/[?#]/, 1)[0] === chrome.runtime.getURL("options.html");
}

function sessionReviewSender(sender){
 if(sender?.id!==chrome.runtime.id||(sender.frameId??0)!==0)return false;
 return sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('session-reviews.html');
}
let websiteReviewTransport;
async function websiteReviewCall(message){
 const creating=['prepare-create','verify-create','commit-create','update-prepared','lease-inspect','categories'].includes(message.action);
 if(!validRepository(message.repository)||message.kind!==undefined&&!['issue','discussion'].includes(message.kind)||message.action!=='list'&&!creating&&(!Number.isSafeInteger(message.number)||message.number<1)||!['inspect','read','list','categories','prepare','verify','commit','prepare-create','verify-create','commit-create','update-prepared','lease-inspect'].includes(message.action))throw Error('Invalid website review request.');
 if(['prepare','verify','commit','prepare-create','verify-create','commit-create','update-prepared'].includes(message.action))await KiCadManagedPolicy.assertWrites();else await globalThis.KiCadManagedPolicy?.assertNetwork();
 websiteReviewTransport ||= KiCadGitHubWebsiteReviews.createTabTransport({api:chrome,sessions:repositorySessions(),assertWrites:()=>KiCadManagedPolicy.assertWrites()});
 return websiteReviewTransport.invoke(message);
}
let websiteReviewsInstance;
const websiteReviewIntents=new Map();
function websiteReviews(){return websiteReviewsInstance||=KiCadGitHubWebsiteReviews.create({call:websiteReviewCall,storage:chrome.storage.local,assertWrites:()=>KiCadManagedPolicy.assertWrites(),reserve:()=>KiCadReviewComments.reservePublication(chrome.storage.local,JSON.stringify(['github','website-session']),Date.now()),comments:KiCadReviewComments});}
function ownedWebsiteReviewSender(sender,repository){
 if(!sessionReviewSender(sender)&&!viewerSender(sender))return false;
 try{const own=new URL(chrome.runtime.getURL('')),page=new URL(sender.url),parent=new URL(sender.tab?.url||sender.url);return parent.protocol===own.protocol&&parent.host===own.host&&page.searchParams.get('repository')===repository;}catch{return false;}
}
async function websiteReview(message,sender){
 if(!ownedWebsiteReviewSender(sender,message.repository))throw Error('Website reviews require the matching owned extension project page.');
 if(message.action==='send')return websiteReviews().send(message);
 if(message.action==='read')return websiteReviews().read(message.repository,message.number,message.force===true);
 if(message.action==='list')return websiteReviewCall({repository:message.repository,action:'list'});
 if(message.action!=='inspect')throw Error('Unsupported website review operation.');
 return websiteReviewCall(message);
}

function authorizeHostRead(message, sender) {
  if (viewerSender(sender) || comparisonSender(sender)) return;
  const host=message.provider==='gitlab'?(message.host||'https://gitlab.com'):'https://github.com';
  const route=KiCadGitHub.route(sender.url,{gitlabHosts:message.provider==='gitlab'?[host]:[]}) ||
    KiCadGitHub.repositoryRoute(sender.url,{gitlabHosts:message.provider==='gitlab'?[host]:[]});
  // Page-controlled metadata must never choose another credentialed repository.
  if ((sender.frameId??0)!==0 || !route || route.repository!==message.repository ||
      new URL(sender.url).origin!==host ||
      ['githubPull','githubFiles'].includes(message.type)&&(route.kind!=='pull'||route.number!==message.number) ||
      message.type==='gitlab-merge-request'&&(route.kind!=='merge'||route.number!==message.number)) {
    throw Error('Repository read context does not match the top-level host page.');
  }
}

const commentLocks = new Map();
function commentKey(scope) {
  const { repository, ref, file, provider, host } = KiCadReviewComments.normalizeScope(scope);
  return `${provider === 'gitlab' ? 'review-comments:gitlab:' : 'review-comments:'}${JSON.stringify([...(provider==='gitlab'&&host!=='https://gitlab.com'?[host]:[]),repository.toLowerCase(), ref, file])}`;
}
function withCommentLock(key, task) {
  const previous = commentLocks.get(key) || Promise.resolve();
  const work = previous.catch(() => {}).then(task);
  commentLocks.set(key, work);
  work.finally(() => { if (commentLocks.get(key) === work) commentLocks.delete(key); }).catch(() => {});
  return work;
}
async function commentList(scope) {
  const key = commentKey(scope);
  return withCommentLock(key, async () => {
    const stored = (await chrome.storage.local.get(key))[key];
    const notes=Array.isArray(stored)?stored.map(KiCadReviewComments.validateComment).filter(note=>!note.remoteRefs?.length):[];
    if((await KiCadReviewFileStore.status()).connected){
      const legacy=(await KiCadReviewFileStore.read()).filter(note=>commentKey(note.anchor)===key&&!(note.remoteRefs?.length));
      for(const note of legacy)if(!notes.some(item=>item.id===note.id))notes.push(note);
    }
    return notes;
  });
}
async function commentSave(value, expectedUpdatedAt) {
  const note = KiCadReviewComments.validateComment(value), key = commentKey(note.anchor);
  return withCommentLock(key, async () => {
    const existing = (await chrome.storage.local.get(key))[key] || [];
    if (!Array.isArray(existing) || existing.length > 100) throw new Error("Invalid saved comment data.");
    const notes = existing.map(KiCadReviewComments.validateComment);
    if((await KiCadReviewFileStore.status()).connected){
      const legacy=(await KiCadReviewFileStore.read()).filter(item=>commentKey(item.anchor)===key&&!(item.remoteRefs?.length));
      for(const item of legacy)if(!notes.some(n=>n.id===item.id))notes.push(item);
    }
    const index = notes.findIndex((item) => item.id === note.id);
    if (index >= 0 && expectedUpdatedAt !== undefined && notes[index].updatedAt !== expectedUpdatedAt)
      throw new Error("This annotation changed; reload before saving.");
    if(note.remoteRefs?.length){
      // A confirmed publication receipt retires its local draft. It cannot
      // create or edit provider content: subsequent reads reconstruct that.
      if((await KiCadReviewFileStore.status()).connected){const legacy=(await KiCadReviewFileStore.read()).find(item=>commentKey(item.anchor)===key&&item.id===note.id&&!item.remoteRefs?.length);if(legacy)await KiCadReviewFileStore.remove(note.anchor,note.id);}
      await chrome.storage.local.set({[key]:notes.filter(item=>item.id!==note.id)});return note;
    }
    if (index >= 0) notes[index] = note;
    else {
      if (notes.length >= 100) throw new Error("A KiCad file can have at most 100 saved comments.");
      notes.push(note);
    }
    await chrome.storage.local.set({ [key]: notes });
    return note;
  });
}
async function commentDelete(scope, id) {
  const key = commentKey(scope);
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid comment id.");
  return withCommentLock(key, async () => {
    const existing = (await chrome.storage.local.get(key))[key] || [];
    if (!Array.isArray(existing)) throw new Error("Invalid saved comment data.");
    const notes = existing.map(KiCadReviewComments.validateComment).filter((item) => item.id !== id);
    let legacyDeleted=false;
    if((await KiCadReviewFileStore.status()).connected){const pending=(await KiCadReviewFileStore.read()).find(note=>commentKey(note.anchor)===key&&note.id===id&&!(note.remoteRefs?.length));if(pending)legacyDeleted=(await KiCadReviewFileStore.remove(scope,id)).deleted;}
    await chrome.storage.local.set({ [key]: notes });
    return { deleted: legacyDeleted||notes.length !== existing.length };
  });
}

const pendingKey = (tabId) => `review-comment-draft:${tabId}`;
const DESTINATIONS = new Set(["issue", "discussion", "pull-request"]);
const validNumber = (value) => Number.isSafeInteger(value) && value > 0;
async function stagedDraft(repository, destination, number, title, body) {
  // Open blank first so the draft is stored before GitHub's content script can claim it.
  const tab = await chrome.tabs.create({ url: "about:blank" });
  if (!Number.isInteger(tab?.id)) throw new Error("Could not open a GitHub draft tab.");
  const key = pendingKey(tab.id);
  const suffix = destination === "discussion" ? (number ? `discussions/${number}` : "discussions/new") :
    destination === "issue" ? `issues/${number}` : `pull/${number}`;
  try {
    await chrome.storage.session.set({ [key]: { repository, destination, number, title, body } });
    await chrome.tabs.update(tab.id, { url: `https://github.com/${repository}/${suffix}${number && destination !== "discussion" ? "#issuecomment-new" : ""}` });
  } catch (error) {
    await chrome.storage.session.remove(key).catch(() => {});
    if (chrome.tabs.remove) await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
  return { tabId: tab.id, destination, ...(number ? { targetNumber: number } : {}) };
}
async function openCommentDraft(value, options = {}) {
  const note = KiCadReviewComments.validateComment(value);

  if(options.websiteHandoff===true){
    const scope=KiCadReviewComments.normalizeScope(note.anchor),provider=scope.provider||'github',host=provider==='gitlab'?scope.host:'https://github.com';
    const repository=options.targetRepository||options.pullRepository||scope.repository;
    KiCadReviewComments.normalizeScope({...scope,repository});
    const destination=options.destination||options.targetType||(options.pullNumber?'pull-request':'issue');
    if(!['issue','discussion','pull-request'].includes(destination)||provider==='gitlab'&&destination!=='issue')throw Error('Invalid website draft destination.');
    const number=options.targetNumber??(destination==='pull-request'?options.pullNumber:undefined);
    if(options.targetType&&!validNumber(number)||destination==='pull-request'&&!validNumber(number)||number!==undefined&&!validNumber(number))throw Error('Enter a positive website thread number.');
    if(options.targetNumber!==undefined&&!options.targetType)throw Error('Existing thread type is required.');
    const {attachments,capture,...metadata}=note;
    const body=KiCadReviewComments.toMarkdown({...metadata,...(capture?{capture}:{} )})+(attachments?.length?'\n\nAttachments are saved locally. Attach them manually on the provider website.':'');
    const title='KiCad review: '+note.text.split(/\r?\n/)[0].slice(0,180);
    let url=host+'/'+repository+(number?(provider==='gitlab'?'/-/issues/':destination==='discussion'?'/discussions/':destination==='pull-request'?'/pull/':'/issues/')+number:provider==='gitlab'?'/-/work_items/new':destination==='discussion'?'/discussions/new':'/issues/new');
    let prefilled=false;
    if(!number&&destination==='issue'){
      // Official website composers accept URL-encoded title/body; keep long drafts in the copy field.
      const query=provider==='gitlab'?'issue[title]='+encodeURIComponent(title)+'&issue[description]='+encodeURIComponent(body):'title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
      if((url+'?'+query).length<=7500){url+='?'+query;prefilled=true;}
    }
    return {url,body,prefilled,destination,repository};
  }
  const body = KiCadReviewComments.toMarkdown(note);
  const title = `[${KiCadReviewComments.severityInfo(note.severity).label}] KiCad review: ${note.anchor.file}`;
  const { pullNumber, pullRepository, targetType, targetNumber, targetRepository } = options;
  const destination = options.destination || targetType || (pullNumber ? "pull-request" : "issue");
  if (!DESTINATIONS.has(destination) || (targetType && targetType !== destination)) {
    throw new Error("Invalid GitHub draft destination.");
  }
  if (pullNumber !== undefined && !validNumber(pullNumber)) throw new Error("Invalid pull request number.");
  if (pullRepository !== undefined && !validRepository(pullRepository)) throw new Error("Invalid pull request repository.");
  if (targetNumber !== undefined && !validNumber(targetNumber)) throw new Error("Invalid target thread number.");
  if (targetRepository !== undefined && !validRepository(targetRepository)) throw new Error("Invalid target repository.");
  if (targetType && targetNumber === undefined) throw new Error("Existing thread number is required.");
  if (targetNumber !== undefined && !targetType) throw new Error("Existing thread type is required.");
  if (destination === "pull-request" && !targetRepository && !pullRepository) {
    throw new Error("Pull request repository is required for a draft.");
  }
  const repository = targetRepository || pullRepository || note.anchor.repository;
  if (!validRepository(repository)) throw new Error("Invalid pull request repository.");
  const number = targetNumber || (destination === "pull-request" ? pullNumber : undefined);
  if (destination === "pull-request" && !validNumber(number)) throw new Error("Invalid pull request number.");
  if (number) return stagedDraft(repository, destination, number, null, body);
  if (destination === "discussion") return stagedDraft(repository, destination, null, title, body);
  const url = `https://github.com/${repository}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const tab = await chrome.tabs.create({ url });
  return { tabId: tab?.id ?? null, destination: "issue" };
}
async function claimCommentDraft(sender) {
  if (!Number.isInteger(sender?.tab?.id)) return null;
  let url;
  try { url = new URL(sender.url); } catch { return null; }
  if (url.origin !== "https://github.com") return null;
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues|discussions)\/([1-9][0-9]*|new)(?:\/([^?#]*))?$/.exec(url.pathname);
  if (!match) return null;
  if (match[5] && !(match[3] === "discussions" && match[4] === "new")) return null;
  const key = pendingKey(sender.tab.id);
  const pending = (await chrome.storage.session.get(key))[key];
  const destination = match[3] === "pull" ? "pull-request" : match[3] === "issues" ? "issue" : "discussion";
  const number = match[4] === "new" ? null : Number(match[4]);
  if (!pending || pending.repository.toLowerCase() !== `${match[1]}/${match[2]}`.toLowerCase() ||
      pending.destination !== destination || pending.number !== number) return null;
  return { body: pending.body, ...(pending.title ? { title: pending.title } : {}) };
}
async function acknowledgeCommentDraft(sender) {
  const draft = await claimCommentDraft(sender);
  if (!draft) return { acknowledged: false };
  await chrome.storage.session.remove(pendingKey(sender.tab.id));
  return { acknowledged: true };
}

async function githubAnnotations(request) {
  const scope = KiCadReviewComments.normalizeScope(request);
  if(scope.provider==='gitlab')throw new Error('GitHub annotation lookup requires a GitHub drawing.');
  const { pullRepository, pullNumber, issueNumber, discussionNumber } = request;
  if (pullRepository !== undefined && !validRepository(pullRepository)) throw new Error("Invalid annotation repository.");
  if (pullNumber !== undefined && !validNumber(pullNumber)) throw new Error("Invalid pull request number.");
  if (issueNumber !== undefined && !validNumber(issueNumber)) throw new Error("Invalid issue number.");
  if (discussionNumber !== undefined && !validNumber(discussionNumber)) throw new Error("Invalid discussion number.");
  if(discussionNumber!==undefined&&issueNumber!==undefined)throw new Error('Choose one Issue or Discussion for annotation lookup.');
  if (pullNumber && !pullRepository) throw new Error("Pull request repository is required for annotation lookup.");
  const repository = pullRepository || scope.repository;
  if(discussionNumber!==undefined){const result=await KiCadGitHubReviewApi.readDiscussionAnnotations({repository,number:discussionNumber,scope});return cacheProviderAnnotations(scope,result,{sourceUrl:`https://github.com/${repository}/discussions/${discussionNumber}`,complete:!result.warnings?.length});}
  const endpoint = `/repos/${repository}/issues`;
  const annotationJson=await KiCadGitHubReviewApi.createAnnotationReader();
  const notes = [], warnings = [], seen = new Set();
  const selectedNumber = issueNumber || pullNumber;
  const matching = (note) => note.anchor.provider!=='gitlab'&&note.anchor.repository.toLowerCase() === scope.repository.toLowerCase() &&
    note.anchor.ref === scope.ref && note.anchor.file === scope.file;
  const add = (body, meta) => {
    if (typeof body !== "string") return;
    let parsed;
    try { parsed = KiCadReviewComments.fromMarkdown(body); }
    catch { warnings.push("A GitHub body exceeded the annotation size limit and was skipped."); return; }
    for (const note of parsed) {
      if (!matching(note)) continue;
      if (notes.length >= 500) {
        if (!warnings.includes("Annotation results were limited to 500 notes.")) warnings.push("Annotation results were limited to 500 notes.");
        return;
      }
      const key = `${meta.url}:${note.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({ ...note, github: meta });
    }
  };
  const author = (item) => /^[A-Za-z0-9-]{1,39}$/.test(item?.user?.login || "") ? item.user.login : "unknown";
  const times=item=>{const values={};for(const [source,key]of [['created_at','createdAt'],['updated_at','updatedAt']])if(typeof item?.[source]==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(item[source])&&Number.isFinite(Date.parse(item[source])))values[key]=item[source];return values;};
  const issueMeta = new Map();
  const readIssue = (item) => {
    const number = item?.number;
    if (!validNumber(number)) return;
    const source = item.pull_request ? "pull-request" : "issue";
    const state = item.state === "open" || item.state === "closed" ? item.state : "unknown";
    issueMeta.set(number, { source, state });
    add(item.body, { url: `https://github.com/${repository}/${source === "pull-request" ? "pull" : "issues"}/${number}`,
      number, state, source, author: author(item),...times(item) });
  };
  for (let page = 1; !selectedNumber&&page <= 2; page++) {
    const batch = await annotationJson(`${endpoint}?state=all&per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error("Unexpected GitHub issue listing.");
    batch.forEach(readIssue);
    if (batch.length < 100) break;
    if (page === 2) warnings.push("Issue scan stopped after 200 recent issues or pull requests; older annotations may be omitted.");
  }
  if (selectedNumber) {
    if (!issueMeta.has(selectedNumber)) readIssue(await annotationJson(`${endpoint}/${selectedNumber}`));
    const meta = issueMeta.get(selectedNumber);
    if (!meta) throw new Error("GitHub did not return the selected issue or pull request.");
    for(let page=1;page<=5;page++){
    const comments = await annotationJson(`${endpoint}/${selectedNumber}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(comments) || comments.length > 100) throw new Error("Unexpected GitHub comment listing.");
    for (const comment of comments) {
      const id = comment?.id;
      const suffix = validNumber(id) ? `#issuecomment-${id}` : "";
      add(comment?.body, { url: `https://github.com/${repository}/${meta.source === "pull-request" ? "pull" : "issues"}/${selectedNumber}${suffix}`,
        number: selectedNumber, state: meta.state, source: meta.source, author: author(comment),...times(comment) });
    }
    if(comments.length<100)break;
    if(page===5)warnings.push("Comment scan stopped at 500 comments for the selected thread.");
    }
  }
  if (request.includeDiscussions) warnings.push("Discussion readback requires selecting an existing Discussion and entering its number.");
  const selectedMeta=selectedNumber&&issueMeta.get(selectedNumber);
  return cacheProviderAnnotations(scope,{notes,warnings},{sourceUrl:selectedMeta?`https://github.com/${repository}/${selectedMeta.source==='pull-request'?'pull':'issues'}/${selectedNumber}`:null,complete:Boolean(selectedMeta)&&!warnings.length});
}

// Provider content is authoritative. The optional file never supplies published
// annotations to the viewer; only confirmed remote reads refresh this cache.
async function cacheProviderAnnotations(scope,result,{sourceUrl=null,complete=false}={}){
  let connected=false;
  try{connected=typeof KiCadReviewFileStore!=='undefined'&&typeof KiCadReviewFileStore.status==='function'&&typeof KiCadReviewFileStore.sync==='function'&&(await KiCadReviewFileStore.status()).connected;}catch{return result;}
  if(!connected)return result;
  const incoming=[];let skipped=false;
  for(const raw of result.notes||[]){
    const meta=raw.github;if(!meta||!['issue','discussion','pull-request'].includes(meta.source)){skipped=true;continue;}
    const publishedAt=meta.createdAt||raw.createdAt;
    const githubRepository=scope.provider==='gitlab'?null:/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\//.exec(meta.url||'')?.[1];
    const remote={...(scope.provider==='gitlab'?{provider:'gitlab',host:scope.host}:{}),kind:meta.source,repository:githubRepository||scope.repository,number:meta.number,url:meta.url,publishedAt};
    try{incoming.push(KiCadReviewComments.validateComment({...raw,remoteRefs:[remote]}));}catch{skipped=true;}
  }
  try{
    const unique=[...new Map(incoming.map(note=>[note.id,note])).values()];
    await KiCadReviewFileStore.sync(scope,unique,{sourceUrl,complete:complete&&!skipped});
    if(skipped)result.warnings=[...(result.warnings||[]),'Some provider annotations could not be cached; the provider remains authoritative.'];
  }catch{result.warnings=[...(result.warnings||[]),'The optional comment sync cache could not be refreshed; provider comments remain available.'];}
  return result;
}

function launcherSender(sender){return sender?.id===chrome.runtime.id&&sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('project-launcher.html');}
async function presentActionWorkspace(url) {
  try { return await chrome.tabs.create({url}); }
  catch (cause) {
    // A browser may refuse extension-page presentation. Do not retry that
    // decision through another page, window, frame, or navigation surface.
    throw Object.assign(Error('The browser could not present the KiCad Online workspace.',{cause}),{code:'WORKSPACE_PRESENTATION_FAILED'});
  }
}
async function openFromAction(tab) {
  const open=params=>presentActionWorkspace(chrome.runtime.getURL('project-launcher.html')+'?'+new URLSearchParams(params));
  if(!Number.isInteger(tab?.id)||typeof tab.url!=='string')return open({});
  let page;try{page=new URL(tab.url);}catch{return open({});}
  if(page.protocol!=='https:'||page.origin!=='https://github.com'&&!(await globalThis.KiCadGitLabHosts?.allowed(page.origin)))return open({});
  if(chrome.scripting?.executeScript){
    try{const firefox=chrome.runtime.getManifest?.()?.browser_specific_settings?.gecko;await chrome.scripting.executeScript({target:{tabId:tab.id},files:[...(firefox?['firefox/browser-api.js']:[]),'parsing.js','github-website-history.js','github-website-pulls.js','github-session-reader.js','github-session-review.js','gitlab-session-reader.js','repository-session-bridge.js']});}
    catch{return open({error:'Browser site access was not granted or is blocked by policy. Click the extension on the repository tab again, or use Open local files.'});}
  }
  let hint;try{hint=await chrome.tabs.sendMessage(tab.id,{type:'projectLaunchContext'},{frameId:0});}catch{}
  try{
    const context=KiCadProjectLaunch.context(tab.url,{...hint,allowUnresolved:true});
    if(!context)return open({});
    const preferences=await viewerPreferences();
    await repositorySessions().remember(tab,context,preferences.mode==='inline');
    const url=context.kind==='drawing'?KiCadProjectLaunch.viewerURL(context,context.file,p=>chrome.runtime.getURL(p)):chrome.runtime.getURL('project-launcher.html')+'?'+new URLSearchParams({source:context.source,...(context.ref?{ref:context.ref}:{})});
    if(preferences.mode==='inline'&&context.revisionKind!=='pull'){
      try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['inline-project-view.js']});const result=await chrome.tabs.sendMessage(tab.id,{type:'inline-project-open',url,sourceUrl:tab.url},{frameId:0});if(result?.ok)return result.result;}catch{}
    }
    return await presentActionWorkspace(url);
  }catch(error){if(error.code==='WORKSPACE_PRESENTATION_FAILED')throw error;return open({error:error.message});}
}

chrome.action.onClicked.addListener(async tab => {
  try {
    const result=await openFromAction(tab);
    await updateGitHubBadge().catch(()=>{});
    return result;
  }catch(error){
    console.error('KiCad Online could not open its workspace.',error.cause||error);
    // The options page uses the same presentation boundary and can be blocked
    // too. Report the failure on the existing action instead of opening it.
    badgeGeneration++;
    await Promise.allSettled([
      Promise.resolve().then(()=>chrome.action.setBadgeText?.({text:'!'})),
      Promise.resolve().then(()=>chrome.action.setBadgeBackgroundColor?.({color:'#b42318'})),
      Promise.resolve().then(()=>chrome.action.setTitle?.({title:'KiCad Online — workspace could not open. Check this extension’s Errors in Manage extensions.'}))
    ]);
    return false;
  }
});

const gitlabAssetBudgets = new Map();
async function gitlabAnnotations(scope){
  const normalized=KiCadReviewComments.normalizeScope({...scope,provider:'gitlab'}),notes=[],warnings=[];let projectId=null;
  const number=Number(scope.number||scope.issueNumber||scope.threadNumber);
  if(!Number.isSafeInteger(number)||number<1)return {notes,warnings:['Enter an existing GitLab issue number to read its review notes.']};
  const issueUrl=normalized.host+'/'+normalized.repository+'/-/issues/'+number;
  const add=(text,record,isNote=false)=>{for(const note of KiCadReviewComments.fromMarkdown(text||''))if(note.anchor.provider==='gitlab'&&note.anchor.host===normalized.host&&note.anchor.repository===normalized.repository&&note.anchor.ref===normalized.ref&&note.anchor.file===normalized.file&&notes.length<100){
    const sourceId=isNote?Number(record.id):0;
    if(isNote&&(!Number.isSafeInteger(sourceId)||sourceId<1))continue;
    if(note.attachments?.length){const attachments=note.attachments.filter(a=>a.projectId===projectId);if(attachments.length!==note.attachments.length&&!warnings.includes('Some screenshot attachments could not be bound to this GitLab issue project and were omitted.'))warnings.push('Some screenshot attachments could not be bound to this GitLab issue project and were omitted.');if(attachments.length)note.attachments=attachments;else delete note.attachments;}
    note.github={provider:'gitlab',url:issueUrl+(isNote?'#note_'+sourceId:''),source:note.threadType==='discussion'?'discussion':'issue',number,state:record.state||'posted',author:record.author?.username||''};
    notes.push(note);
  }};
  const thread=await KiCadGitLabReviewApi.readThread({...normalized,kind:'issue',number,includeCapabilities:false});
  if(thread?.number!==number||thread.repository!==normalized.repository||thread.host!==normalized.host||!Number.isSafeInteger(thread.projectId)||thread.projectId<1)throw Error('GitLab review thread identity could not be verified.');
  projectId=thread.projectId;
  add(thread.body,{state:thread.state,author:{username:thread.author}},false);
  for(const record of thread.comments||[])add(record.body,{...record,state:thread.state,author:{username:record.author}},true);
  warnings.push(...(thread.warnings||[]));
  return cacheProviderAnnotations(normalized,{notes:[...new Map(notes.map(note=>[note.id,note])).values()],warnings},{sourceUrl:issueUrl,complete:!warnings.length&&notes.length<100});
}
async function gitlabSessionResponse(host,contextRepository,url,limit,signal) {
  if(globalThis.KiCadGitLabHosts?!await KiCadGitLabHosts.allowed(host):host!=='https://gitlab.com')throw Object.assign(Error('GitLab host permission is no longer available.'),{definitive:true});
  const target=new URL(url),match=target.pathname.match(/^\/api\/v4\/projects\/([^/]+)/);
  if(target.origin!==host||!match)throw Object.assign(Error('Invalid GitLab session endpoint.'),{definitive:true});
  const project=decodeURIComponent(match[1]),repository=/^[1-9][0-9]*$/.test(project)?contextRepository:project;
  if(!globalThis.KiCadGitLabProvider.forHost(host).validRepository(repository))return null;
  const tabs=await repositorySessions().candidates('gitlab',host,repository);
  limit=Math.min(limit,64*1024*1024);
  let sessionError=null;
  for(const tab of tabs) {
    if(!tab.bound){let page;try{page=new URL(tab.url);}catch{continue;}if(page.origin!==host||!(page.pathname===`/${repository}`||page.pathname.startsWith(`/${repository}/-/`)))continue;}
    let reply;try{reply=await sessionLoadMessage(tab.id,{type:'gitlab-session-read',host,repository,url,limit},signal);}catch{checkLoad(signal);continue;}
    if(!reply?.ok){if(typeof reply?.error==='string')sessionError=Object.assign(Error(reply.error.slice(0,1000)),{...(['GITLAB_SAML_REQUIRED','GITLAB_LOGIN_REQUIRED','GITLAB_UNEXPECTED_HTML','MANAGED_POLICY'].includes(reply.code)?{code:reply.code}:{})});continue;}
    if(globalThis.KiCadGitLabHosts?!await KiCadGitLabHosts.allowed(host):host!=='https://gitlab.com')throw Object.assign(Error('GitLab host permission was removed during retrieval.'),{definitive:true});
    const result=reply.result;if(result===null)return null;
    if(typeof result?.base64!=='string'||result.base64.length>Math.ceil(limit/3)*4||result.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64)||typeof result.next!=='string'||result.next&&!/^[1-9][0-9]{0,3}$/.test(result.next)||!['','<next>; rel="next"'].includes(result.link))throw Object.assign(Error('Invalid GitLab session response.'),{definitive:true});
    const binary=atob(result.base64);if(binary.length>limit)throw Object.assign(Error('GitLab session response exceeds its size limit.'),{definitive:true});
    return {bytes:Uint8Array.from(binary,c=>c.charCodeAt(0)),next:result.next,link:result.link};
  }
  if(sessionError)throw sessionError;return null;
}

async function gitlabDispatch(message, sender,signal) {
  const auth=globalThis.KiCadGitLabReviewApi,hosts=globalThis.KiCadGitLabHosts;
  if(['gitlab-host-list','gitlab-host-add','gitlab-host-remove'].includes(message.type)){
    if(!optionsSender(sender))throw new Error('Only extension settings can configure GitLab servers.');
    if(message.type==='gitlab-host-list')return {hosts:await hosts.list()};
    return message.type==='gitlab-host-add'?hosts.add(message.host):hosts.remove(message.host);
  }
  const host=message.host||'https://gitlab.com';
  if (globalThis.KiCadGitLabHosts ? !await KiCadGitLabHosts.allowed(host) : host!=='https://gitlab.com')throw new Error('Configure and grant access to this GitLab host first.');
  const api=globalThis.KiCadGitLabProvider.forHost(host,{foregroundOnly:true,signal,sessionRead:(url,limit)=>gitlabSessionResponse(host,message.repository,url,limit,signal)});
  const {repository,ref,file}=message;
  if(['gitlab-auth-status','gitlab-auth-set','gitlab-auth-clear','gitlab-auth-reset','gitlab-client-set','gitlab-oauth-start'].includes(message.type)){
    if(!optionsSender(sender)&&!(message.type==='gitlab-auth-status'&&viewerSender(sender)))throw new Error('Only extension settings can change GitLab authentication.');
    if(message.type==='gitlab-auth-status')return auth.authStatus(host);
    if(message.type==='gitlab-auth-set')return auth.setToken(host,message.token);
    if(message.type==='gitlab-auth-clear')return auth.clearToken(host);
    if(message.type==='gitlab-auth-reset')return auth.resetAuth(host);
    if(message.type==='gitlab-client-set')return auth.setClientId(host,message.clientId);
    return auth.startOAuth(host);
  }
  if (!viewerSender(sender) && !(comparisonSender(sender)&&['revision-resolve','project','project-file','drawing-files'].includes(message.type)) && !(pdfSender(sender)&&['pdf-file','project-inventory'].includes(message.type)) && !((analysisSender(sender)||fabricationSender(sender)||bomSender(sender))&&['project-inventory','project-file'].includes(message.type)) && !['project','gitlab-merge-request'].includes(message.type)) throw new Error('Only extension viewers can use GitLab repository tools.');
  if (optionsSender(sender)) throw new Error('Options cannot load GitLab projects.');
  switch(message.type) {
    case 'repository-fork-revision': return auth.forkRevision({...message,host});
    case 'gitlab-merge-request': {
      authorizeHostRead(message,sender);
      if(!viewerSender(sender)){
        const route=KiCadGitHub.route(sender.url,{gitlabHosts:[host]});
        if(route?.kind!=='merge'||route.repository!==repository||route.number!==message.number)throw new Error('Merge-request context does not match the host page.');
      }
      return api.mergeRequest(repository,message.number);
    }
    case 'project': {
      authorizeHostRead(message,sender);
      const snapshot=await api.resolve(repository,ref,file);
      return recentSnapshot(await KiCadBrowserData.loadProject(repository,snapshot.sha,file,api.file,api.directory,'gitlab',api.schematics),snapshot.sha);
    }
    case 'project-inventory': return api.inventory(repository,ref,file);
    case 'repo-model-index': return api.modelIndex(repository,ref);
    case 'project-file': return api.projectFile(repository,ref,file);
    case 'project-search-files': return api.search(repository,ref,file);
    case 'revision-resolve': return api.resolve(repository,ref,file);
    case 'revision-branches': return api.branches(repository,ref,file);
    case 'revision-commits': return api.commits(repository,ref,file);
    case 'repository-branches': return api.repositoryBranches(repository,ref);
    case 'repository-tree': return api.repositoryTree(repository,ref,{page:message.page,directory:message.directory});
    case 'repository-history': return api.repositoryHistory(repository,ref,message.page);
    case 'design-changes': return api.compare(repository,message.base,message.head,file);
    case 'drawing-files': {
      const snapshot=await api.resolve(repository,ref,file);
      return {files:await api.directory(repository,snapshot.sha,file.split('/').slice(0,-1).join('/'),true),warnings:[]};
    }
    case 'rule-report': {
      const snapshot=await api.resolve(repository,ref,file);
      if (!api.validPath(message.reportPath)||!message.reportPath.endsWith('.json')||!KiCadBrowserData.validPath(file)) throw new Error('Invalid GitLab report path.');
      const result=await api.response(`${api.endpoint(repository)}/files/${encodeURIComponent(message.reportPath)}/raw?ref=${encodeURIComponent(snapshot.sha)}`,4*1024*1024);
      if (!result) throw new Error('Report was not found at this revision.');
      return {content:new TextDecoder().decode(result.bytes),path:message.reportPath};
    }
    case 'pdf-file':
    case 'repo-asset': {
      const pdf=message.type==='pdf-file',assetMax=pdf?32*1024*1024:8*1024*1024;
      if(!api.validRepository(repository)||!validAssetRef(ref)||!validAssetPath(file,pdf))throw new Error('Invalid GitLab model location.');
      const key=host+':'+repository.toLowerCase()+':'+ref,now=Date.now();let budget=gitlabAssetBudgets.get(key);
      if(!budget||budget.resetAt<=now)budget={requests:0,bytes:0,resetAt:now+300000};
      if(budget.requests>=32||budget.bytes>=32*1024*1024)throw new Error('The 3D model retrieval budget was reached; retry after five minutes.');
      budget.requests++;gitlabAssetBudgets.set(key,budget);if(gitlabAssetBudgets.size>128)gitlabAssetBudgets.delete(gitlabAssetBudgets.keys().next().value);
      const result=await api.response(`${api.endpoint(repository)}/files/${encodeURIComponent(file)}/raw?ref=${encodeURIComponent(ref)}`,assetMax);
      if(!result)throw new Error('GitLab model was not found at this revision.');
      if(budget.bytes+result.bytes.length>32*1024*1024)throw new Error('Revision model retrieval budget exceeded.');budget.bytes+=result.bytes.length;
      let binary='';for(let i=0;i<result.bytes.length;i+=8192)binary+=String.fromCharCode(...result.bytes.subarray(i,i+8192));
      return {base64:btoa(binary),mediaType:pdf?'application/pdf':file.toLowerCase().endsWith('.glb')?'model/gltf-binary':'model/vrml'};
    }
    case 'open-project-overview':
    case 'open-viewer-window': {
      if(!api.validRepository(repository)||!KiCadBrowserData.validRef(ref)||!KiCadGitHub.filePath(file))throw new Error('Invalid GitLab viewer location.');
      const project=message.type==='open-project-overview';
      if(!project&&!KiCadBrowserData.validPath(file))throw new Error('Invalid drawing file.');
      if(message.pairedFile!==undefined&&(!KiCadBrowserData.validPath(message.pairedFile)||/\.kicad_pcb$/i.test(message.pairedFile)===/\.kicad_pcb$/i.test(file)))throw new Error('Paired drawing must be the opposite file type.');
      const query=new URLSearchParams({provider:'gitlab',host,repository,...(project?{ref}:{head:ref}),file,...(message.pairedFile?{pairedFile:message.pairedFile}:{})});
      const window=await chrome.windows.create({url:chrome.runtime.getURL(project?'project-viewer.html':'browser-viewer.html')+'?'+query,type:'popup',state:'maximized'});
      return {windowId:window?.id??null};
    }
    case 'comment-list': return commentList({...message,provider:'gitlab',host});
    case 'comment-save': {
      const anchor=KiCadReviewComments.normalizeScope({...message.comment?.anchor,provider:'gitlab'});
      if(anchor.host!==host)throw new Error('Review note belongs to another GitLab host.');
      return commentSave({...message.comment,anchor:{...message.comment.anchor,provider:'gitlab',host}},message.expectedUpdatedAt);
    }
    case 'comment-delete': return commentDelete({...message,provider:'gitlab',host},message.id);
    case 'comment-store-status': return {connected:false,provider:'gitlab',localOnly:true};
    case 'github-auth-status': return auth.authStatus(host);
    case 'comment-mention-users': return mentionUsers({...message,provider:'gitlab',host});
    case 'comment-policy-status': return auth.commentPolicyStatus(host,repository);
    case 'comment-publish':
    case 'github-publish-comment': return auth.publish({...message,host,destination:message.discussion?'discussion':message.destination});
    case 'github-thread-read': return auth.readThread({...message,provider:'gitlab',host});
    case 'chat-thread-state': return auth.chatThreadState({...message,provider:'gitlab',host});
    case 'chat-message-write': return auth.chatMessageWrite({...message,provider:'gitlab',host});
    case 'work-board-list': return auth.boardList({...message,provider:'gitlab',host});
    case 'work-board-read': return auth.boardRead({...message,provider:'gitlab',host});
    case 'work-board-move': return auth.boardMove({...message,provider:'gitlab',host});
    case 'chat-thread-list': return auth.chatThreadList({...message,provider:'gitlab',host});
    case 'chat-reaction': throw new Error('Chat reactions are not supported by this provider bridge.');
    case 'comment-remote-list':
    case 'github-annotations': return gitlabAnnotations({...message,host});
    case 'open-options': await chrome.runtime.openOptionsPage();return {opened:true};
    default: throw new Error('Unsupported GitLab operation.');
  }
}

async function repositoryDetection(message,sender){
  const launcher=launcherSender(sender);
  if(launcher&&(sender.frameId??0)>0&&!repositorySessions().frameAllowed(sender))throw Error('Unbound in-page project launcher.');
  if(!launcher&&(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id)||(sender.frameId??0)!==0))throw Error('Repository discovery requires its top-level host page.');
  const host=message.provider==='gitlab'?(message.host||'https://gitlab.com'):'https://github.com';
  const source=launcher?message.source:sender.url,revision=KiCadGitHub.revisionRoute(source),route=KiCadGitHub.repositoryRoute(source,{gitlabHosts:message.provider==='gitlab'?[host]:[]});
  if(revision){
    if(host!=='https://github.com'||message.provider&&message.provider!=='github'||revision.repository!==message.repository)throw Error('Revision discovery does not match the host page.');
    let headRepository=revision.repository,head,pullNumber,warning=[];
    if(revision.kind==='commit'){
      if(message.ref!==revision.ref)throw Error('Commit discovery does not match the host page.');
      const metadata=await githubSessionRead(revision.repository,revision.ref,'commit');if(!metadata)throw Error('Keep the invoked repository tab open to resolve this commit.');head=metadata.sha;
    }else{
      if(message.ref!=null)throw Error('PR discovery cannot override its head revision.');
      const metadata=await githubSessionRead(revision.repository,'HEAD','pull',String(revision.number));if(!metadata)throw Error('Keep the invoked PR repository tab open.');
      headRepository=metadata.headRepository;pullNumber=revision.number;
      const resolved=await githubSessionRead(headRepository,metadata.headRef,'resolve');
      if(!resolved)throw Error('Open the PR head repository '+headRepository+' and click the extension there to authorize its website session, then retry this PR.');head=resolved.sha;
      warning=['PR head loaded; merge-base comparison is unavailable from this website metadata.'];
    }
    const snapshot=await projectBuffer().inventory(headRepository,head,undefined,{refresh:message.refresh===true});
    if(snapshot.snapshotRef!==head)throw Error('Revision changed during project discovery.');
    const projects=KiCadGitHub.detectedProjects(snapshot.files.map(item=>({path:item.path,type:'blob'})));
    return {repository:revision.repository,ref:revision.kind==='commit'?revision.ref:head,sha:head,headRepository,...(pullNumber?{pullNumber,pullRepository:revision.repository}:{}),projects,truncated:projects.length===100||snapshot.warnings.some(w=>/incomplete|limited|limit reached/i.test(w)),warnings:[...new Set([...warning,...snapshot.warnings])]};
  }
  if(!route||route.repository!==message.repository||(route.provider||'github')!==(message.provider||'github')||(route.host||'https://github.com')!==host)throw Error('Repository discovery does not match the host page.');
  let ref=message.ref,contextSnapshot=null;
  if(!ref&&route.tail&&(!message.provider||message.provider==='github')){const context=await projectBuffer().context(launcher?message.source:sender.url);ref=context.ref;contextSnapshot=context.sha;}
  if(!KiCadBrowserData.validRef(ref)||(!route.tail&&ref!=='HEAD')||route.tail&&!(route.tail.join('/')===ref||route.tail.join('/').startsWith(ref+'/')))throw Error('Repository branch does not match the host page.');
  let listing;
  if(message.provider==='gitlab'){
    if(globalThis.KiCadGitLabHosts?!await KiCadGitLabHosts.allowed(host):host!=='https://gitlab.com')throw Error('Configure and grant access to this GitLab host first.');
    const api=KiCadGitLabProvider.forHost(host,{foregroundOnly:true,sessionRead:(url,limit)=>gitlabSessionResponse(host,message.repository,url,limit)});
    if(ref==='HEAD'){
      const response=await api.response(api.endpoint(message.repository).replace(/\/repository$/,''),1024*1024);
      const metadata=response&&JSON.parse(new TextDecoder().decode(response.bytes));ref=metadata?.default_branch;
      if(!KiCadBrowserData.validRef(ref))throw Error('GitLab did not return a default branch.');
    }
    listing=await api.repositoryTree(message.repository,ref,{page:1});
    for(let page=2;listing.hasMore&&page<=10;page++){
      const next=await api.repositoryTree(message.repository,listing.sha,{page});
      if(next.sha!==listing.sha)throw Error('Repository revision changed during discovery.');
      listing.entries.push(...next.entries);listing.hasMore=next.hasMore;listing.warnings.push(...(next.warnings||[]));
    }
    listing.truncated=Boolean(listing.hasMore||listing.warnings.length);
  }else{
    const directory=route.tail?route.tail.join('/').slice(ref.length).replace(/^\//,''):'';
    const snapshot=await projectBuffer().inventory(message.repository,contextSnapshot||ref,undefined,{directory,scoped:Boolean(directory),refresh:message.refresh===true});
    listing={sha:snapshot.snapshotRef,entries:snapshot.files.map(item=>({path:item.path,type:'blob'})),warnings:snapshot.warnings,truncated:snapshot.warnings.some(warning=>/incomplete|limited|limit reached/i.test(warning))};
  }
  let projects=KiCadGitHub.detectedProjects(listing.entries);
  if(!projects.length){const fabrication=globalThis.KiCadGerberRenderer||(typeof require==='function'?require('./gerber-renderer.js'):null),files=listing.entries.filter(item=>['blob','file'].includes(item.type)&&fabrication.isFabricationPath(item.path)).map(item=>item.path);projects=(files.some(path=>fabrication.isJobPath(path))?files.filter(path=>fabrication.isJobPath(path)):files).slice(0,100);}
  return {repository:message.repository,ref,sha:listing.sha,projects,truncated:Boolean(listing.truncated||listing.hasMore||projects.length===100),warnings:[...new Set(listing.warnings||[])]};
}

let nativeKiCadService=null;
function nativeKiCad(){const api=globalThis.KiCadNativeKiCad||(typeof require==='function'?require('./native-kicad.js'):null);if(!api)throw Error('Reload the extension to enable Open in KiCad.');return nativeKiCadService||=api.create({chrome,isViewer:viewerSender});}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const customHostSender=sender?.id===chrome.runtime.id&&typeof sender.url==='string'&&sender.url.startsWith('https://')&&message?.provider==='gitlab';
  if (!(senderAllowed(sender) || comparisonSender(sender) || pdfSender(sender) || analysisSender(sender) || fabricationSender(sender) || bomSender(sender) || optionsSender(sender)||dashboardSender(sender)||localWorkspaceSender(sender)||launcherSender(sender)||sessionReviewSender(sender)||customHostSender||sender?.id===chrome.runtime.id&&message?.type==='inline-project-open-tab') || !message || typeof message !== "object") return false;
  (async () => {
    await repositorySessions().ready;
    if (comparisonSender(sender)) return comparisonRead(message, sender);
    if(message.type==='github-session-review')return websiteReview(message,sender);
    if(sessionReviewSender(sender))throw Error('This page only uses website review operations.');
    if((sender.frameId??0)>0&&!repositorySessions().messageAllowed(sender,message))throw Error('In-page viewer was not opened for this repository by the extension icon.');
    if(message.type==='viewer-preferences-get'||message.type==='viewer-preferences-set'){
      if(!optionsSender(sender)||(sender.frameId??0)!==0)throw Error('Only extension settings can choose the project viewer location.');
      if(message.type==='viewer-preferences-set'){if(!['tab','inline'].includes(message.mode))throw Error('Invalid project viewer location.');await chrome.storage.local.set({'project-viewer-mode':message.mode});}return viewerPreferences();
    }
    if(message.type==='inline-project-open-tab'){
      if(!repositorySessions().inlineSource(sender,message.url))throw Error('In-page viewer does not match the invoked repository.');
      return chrome.tabs.create({url:message.url});
    }
    if(message.type==='native-kicad-cancel')return nativeKiCad().cancel(message,sender);
    if(message.type?.startsWith('project-recents-')||message.type?.startsWith('dashboard-'))return dashboardDispatch(message,sender);
    if(dashboardSender(sender)||localWorkspaceSender(sender))throw Error('This project page only uses its scoped dashboard operations.');
    if(message.type==='managed-policy-status'){
      if(!optionsSender(sender))throw Error('Only extension settings can inspect administrator policy.');
      return KiCadManagedPolicy.read();
    }
    if(launcherSender(sender)&&message.type!=='repository-detect')throw Error('The project launcher only discovers repository projects.');
    await globalThis.KiCadManagedPolicy?.authorize(message);
    if(message.type==='native-kicad-open')return nativeKiCad().open(message,sender);
    if(message.type==='repository-detect')return repositoryDetection(message,sender);
    if(message.type==='revision-pulls'){
      if(!viewerSender(sender)||message.provider&&message.provider!=='github')throw Error('PR discovery requires an owned GitHub viewer.');
      const page=new URL(sender.url),allowed=[page.searchParams.get('repository'),page.searchParams.get('pullRepository')];
      if(!allowed.includes(message.repository)||!validRepository(message.repository))throw Error('PR discovery must match the displayed repository.');
      const result=await githubSessionRead(message.repository,'HEAD','pulls');if(!result)throw Error('Keep this repository website session open to browse pull requests.');return result;
    }

    if(message.type==='viewer-diagnostics'){
      if(!optionsSender(sender))throw Error('Only extension settings can run environment diagnostics.');
      return KiCadEnvironmentDiagnostics.check({fetch,permissions:chrome.permissions,version:chrome.runtime.getManifest().version});
    }
    if (message.provider !== undefined && !['github','gitlab'].includes(message.provider)) throw new Error('Unsupported repository provider.');
    if(bomSender(sender)){
      const page=new URL(sender.url),provider=page.searchParams.get('provider')||'github',host=page.searchParams.get('host')||(provider==='github'?'https://github.com':'https://gitlab.com');
      if(!['project-file','project-inventory'].includes(message.type)||message.repository!==page.searchParams.get('repository')||message.ref!==page.searchParams.get('ref')||(message.provider||'github')!==provider||(message.host||(provider==='github'?'https://github.com':'https://gitlab.com'))!==host||message.type==='project-inventory'&&message.file!==(page.searchParams.get('sourceFile')||page.searchParams.get('file'))||message.type==='project-file'&&(message.file!==page.searchParams.get('file')||!/\.(json|csv|tsv|html?)$/i.test(message.file)))throw Error('BoM reads must match the displayed repository, revision and selected source file.');
    }
    if(pdfSender(sender)&&!['pdf-file','project-inventory'].includes(message.type))throw new Error('PDF viewer only reads PDF files and project inventory.');
    if(fabricationSender(sender)&&!['project-inventory','project-file'].includes(message.type))throw new Error('Fabrication viewers can only read project inventory and source files.');
    if(analysisSender(sender)&&!['project-inventory','project-file'].includes(message.type))throw new Error('Analysis viewers can only read project inventory and source files.');
    let senderOrigin;try{senderOrigin=new URL(sender.url).origin;}catch{}
    if(senderOrigin?.startsWith('https://')&&senderOrigin!=='https://github.com'&&message.provider!=='gitlab')throw new Error('GitLab pages must specify the GitLab provider.');
    if(senderOrigin==='https://github.com'&&message.provider==='gitlab')throw new Error('Repository provider does not match the host page.');
    if(message.type==='load-cancel'){
      if(!viewerSender(sender)||!loadIdValid(message.loadId))throw Error('Only an owned viewer can cancel its project load.');
      const load=projectLoads.get(loadKey(sender,message.loadId));if(load)load.controller.abort();
      return {cancelled:Boolean(load)};
    }
    if(message.loadId!==undefined){
      if(!viewerSender(sender)||!loadIdValid(message.loadId)||!['project','revision-resolve','project-inventory','project-file'].includes(message.type))throw Error('Invalid cancellable project read.');
      const key=loadKey(sender,message.loadId);if(projectLoads.has(key))throw Error('Project load identifier is already active.');
      if(projectLoads.size>=32)throw Error('Too many active project loads.');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);projectLoads.set(key,{controller});
      try{const result=await (message.provider==='gitlab'?gitlabDispatch(message,sender,controller.signal):cancellableProject(message,controller.signal));checkLoad(controller.signal);return result;}
      catch(error){checkLoad(controller.signal);throw error;}
      finally{clearTimeout(timer);projectLoads.delete(key);}
    }
    if(message.type==='draftsman-save'){
      if(!viewerSender(sender))throw Error('Only an extension drawing viewer can save Draftsman documents.');
      const provider=message.provider||'github',host=provider==='github'?'https://github.com':message.host||'https://gitlab.com';
      if(provider==='gitlab'&&(!globalThis.KiCadGitLabHosts||!await KiCadGitLabHosts.allowed(host)))throw Error('Grant access to this GitLab server in Settings first.');
      if(senderOrigin?.startsWith('https://'))throw Error('Repository writes require the owned extension viewer.');
      globalThis.draftsmanRepository ||= KiCadDraftsmanRepository.create({fetch:(...args)=>fetch(...args),headers:(p,h)=>p==='github'?KiCadGitHubReviewApi.authorizationHeaders():KiCadGitLabReviewApi.authorizationHeaders(h),assertWrites:()=>KiCadManagedPolicy.assertWrites()});
      return draftsmanRepository.save({...message,provider,host});
    }
    if(message.type==='open-comment-draft'&&message.websiteHandoff===true){if(!viewerSender(sender))throw Error('Only extension viewers can prepare website drafts.');return openCommentDraft(message.comment,message);}
    if(message.type==='open-website-reviews'){
     if(!viewerSender(sender)||!validRepository(message.repository))throw Error('Only extension viewers can open repository conversations.');
     const params=new URLSearchParams({repository:message.repository});if(Number.isSafeInteger(message.number)&&message.number>0)params.set('number',String(message.number));
     return chrome.tabs.create({url:chrome.runtime.getURL('session-reviews.html')+'?'+params});
    }
    if(message.provider==='gitlab'){const host=message.host||'https://gitlab.com';if(senderOrigin?.startsWith('https://')&&senderOrigin!==host)throw new Error('GitLab host does not match the sender.');return gitlabDispatch(message,sender);}
    if(message.comment?.anchor?.provider==='gitlab')throw new Error('GitLab annotations must use the GitLab provider.');
    const websiteTypes=new Set(['github-thread-read','chat-thread-list','chat-message-write','github-annotations','comment-policy-status','github-publish-comment','github-discussion-categories']),reviewRepository=message.pullRepository||message.repository||message.scope?.repository||message.comment?.anchor?.repository;
    const reviewIntentKey=JSON.stringify([sender.tab?.id??sender.url,reviewRepository]),hasReviewBinding=websiteTypes.has(message.type)&&validRepository(reviewRepository)&&(await repositorySessions().candidates('github','https://github.com',reviewRepository)).some(tab=>tab.bound),websiteReviewIntent=message.reviewTransport==='website-session'||message.reviewTransport!=='api'&&(hasReviewBinding||websiteReviewIntents.has(reviewIntentKey));
    if(websiteTypes.has(message.type)&&viewerSender(sender)&&validRepository(reviewRepository)&&websiteReviewIntent){
      const repository=reviewRepository;
      if(new URL(sender.url).searchParams.get('repository')!==repository)throw Error('Website review repository does not match this viewer.');
      if(!hasReviewBinding)throw Error('The repository website session is no longer connected. Reopen this repository and invoke the extension; no API account was used.');
      websiteReviewIntents.set(reviewIntentKey,true);if(websiteReviewIntents.size>64)websiteReviewIntents.delete(websiteReviewIntents.keys().next().value);
      if(message.type==='github-thread-read'){
       if(!['issue','discussion'].includes(message.kind))throw Error('Choose an Issue or Discussion.');
       return websiteReviews().read(repository,message.number,message.force===true,message.kind);
      }
      if(message.type==='chat-thread-list'){
       if(!['issue','discussion'].includes(message.kind))throw Error('Choose an Issue or Discussion.');
       return websiteReviews().list(repository,message.kind);
      }
      if(message.type==='github-discussion-categories')return websiteReviews().categories(repository);
      if(message.type==='github-annotations'){
       return websiteReviews().annotations(message.scope||message,{repository,number:message.discussionNumber||message.issueNumber,kind:message.discussionNumber?'discussion':'issue'});
      }
      if(message.type==='comment-policy-status'){const result=await websiteReviewCall({repository,action:'list'});return {allowed:true,login:result.account,transport:'website-session',reason:'Website-session permissions are checked again on the selected Issue before sending.'};}
      if(!ownedWebsiteReviewSender(sender,repository))throw Error('Website-session Send requires the matching standalone extension viewer.');
      if(message.type==='chat-message-write')return websiteReviews().chat(message);
      const args=KiCadGitHubReviewApi.publishArgs(message);
      if(args.repository!==repository)throw Error('Review destination does not match this website session.');
      if(!['issue','new-issue','discussion','new-discussion'].includes(args.destination))throw Error('Choose an Issue or Discussion destination.');
      const {capture,...metadata}=args.note,body=KiCadReviewComments.toMarkdown(metadata),details={repository,body,clientMutationId:args.note.id,confirmedSend:message.confirmedSend,...(capture?{annotation:args.note}:{})};
      const kind=args.destination.includes('discussion')?'discussion':'issue',result=args.destination.startsWith('new-')?await websiteReviews().createIssue({...details,kind,title:args.title,categoryId:args.categoryId}):await websiteReviews().send({...details,kind,number:args.number});
      return {remoteRef:{kind,repository,number:result.number,url:result.url,publishedAt:result.createdAt},...(result.attachments?{attachments:result.attachments}:{}),...(result.receiptWarning?{receiptWarning:result.receiptWarning}:{})};
    }
    if(KiCadGitHubProjectView.types.has(message.type)){
      if(message.type==='project'){
        if(optionsSender(sender))throw Error('Options cannot load KiCad projects.');
        authorizeHostRead(message,sender);
      }else if(!viewerSender(sender)&&!pdfSender(sender)&&!analysisSender(sender)&&!fabricationSender(sender)&&!bomSender(sender))throw Error('Only extension viewers can read project snapshots.');
      return projectView().read(message);
    }
    switch (message.type) {
      case 'repository-fork-revision':
        if(!viewerSender(sender))throw Error('Only extension viewers can create a repository fork.');
        return KiCadGitHubReviewApi.forkRevision(message);
      case "github-auth-status":
        if (!viewerSender(sender) && !optionsSender(sender)) throw new Error("Only extension pages can inspect GitHub settings.");
        return KiCadGitHubReviewApi.tokenStatus();
      case 'github-access-test': {
        if (!optionsSender(sender)) throw new Error('Only extension options can test account access.');
        if (!validRepository(message.repository)) throw new Error('Enter owner/repository or its GitHub URL.');
        if (!(await KiCadGitHubReviewApi.tokenStatus()).configured) throw new Error('The extension session is signed out or expired. Sign in again before testing access.');
        const user = await githubJson('https://api.github.com/user');
        const repository = await githubJson(`https://api.github.com/repos/${message.repository}`);
        if (typeof user.login !== 'string' || !validRepository(repository.full_name)) throw new Error('GitHub returned an unexpected account or repository response.');
        return { login: user.login, repository: repository.full_name, private: Boolean(repository.private),
          defaultBranch: repository.default_branch, readable: repository.permissions?.pull !== false };
      }
      case "github-auth-set":
        if (!optionsSender(sender)) throw new Error("Only extension options can set a GitHub token.");
        return KiCadGitHubReviewApi.setToken(message.token);
      case "github-auth-clear":
        if (!optionsSender(sender)) throw new Error("Only extension options can clear a GitHub token.");
        return KiCadGitHubReviewApi.clearToken();
      case "github-auth-reset":
        if (!optionsSender(sender)) throw new Error("Only extension options can reset GitHub authentication.");
        return KiCadGitHubReviewApi.resetAuth();
      case "github-device-status":
        if (!optionsSender(sender)) throw new Error("Only extension options can inspect GitHub sign-in.");
        return KiCadGitHubReviewApi.deviceStatus();
      case "github-device-start":
        if (!optionsSender(sender)) throw new Error("Only extension options can start GitHub sign-in.");
        return KiCadGitHubReviewApi.startDevice(message.clientId, message.scope);
      case "github-device-poll":
        if (!optionsSender(sender)) throw new Error("Only extension options can poll GitHub sign-in.");
        return KiCadGitHubReviewApi.pollDevice();
      case "github-device-cancel":
        if (!optionsSender(sender)) throw new Error("Only extension options can cancel GitHub sign-in.");
        return KiCadGitHubReviewApi.cancelDevice();
      case "github-thread-read":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can read GitHub threads.");
        return KiCadGitHubReviewApi.readThread(message);
      case 'chat-thread-state':
        if (!viewerSender(sender)) throw new Error('Only extension viewers can change conversation state.');
        return KiCadGitHubReviewApi.chatThreadState(message);
      case 'chat-message-write':
        if (!viewerSender(sender)) throw new Error('Only extension viewers can write chat messages.');
        return KiCadGitHubReviewApi.chatMessageWrite(message);
      case 'work-board-list':
      case 'work-board-read':
      case 'work-board-move':
        if (!viewerSender(sender)) throw new Error('Only extension viewers can access work boards.');
        return KiCadGitHubReviewApi[{'work-board-list':'boardList','work-board-read':'boardRead','work-board-move':'boardMove'}[message.type]](message);
      case 'chat-thread-list':
        if (!viewerSender(sender)) throw new Error('Only extension viewers can list chat conversations.');
        return KiCadGitHubReviewApi.chatThreadList(message);
      case 'chat-reaction':
        if (!viewerSender(sender)) throw new Error('Only extension viewers can change chat reactions.');
        throw new Error('Chat reactions are not supported by this provider bridge.');
      case "github-discussion-categories":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can retrieve discussion categories.");
        return KiCadGitHubReviewApi.categories(message.repository);
      case "github-recover-publication":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can recover review publication links.");
        return KiCadGitHubReviewApi.recoverPublication(message, githubAnnotations);
      case "github-publish-comment":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can publish review comments.");
        return KiCadGitHubReviewApi.publish(message);
      case "comment-mention-users":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can search mention accounts.");
        return mentionUsers(message);
      case "comment-policy-status":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can inspect repository comment policy.");
        return KiCadGitHubReviewApi.commentPolicyStatus(message.repository);
      case "open-options":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can open settings.");
        await chrome.runtime.openOptionsPage();
        return { opened: true };
      case "comment-store-status":
        if (!viewerSender(sender) && !optionsSender(sender)) throw new Error("Only extension pages can inspect comment storage.");
        return KiCadReviewFileStore.status();
      case "pdf-file":
        if(!viewerSender(sender)&&!pdfSender(sender))throw Error("Only owned viewers can retrieve PDFs.");
        return githubAsset(message.repository,message.ref,message.file,true);
      case "repo-model-index":
        if(!viewerSender(sender))throw Error("Only extension viewers can discover 3D models.");
        return repositoryModelIndex(message.repository,message.ref);
      case "repo-asset":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can retrieve 3D models.");
        return githubAsset(message.repository, message.ref, message.file);
      case "rule-report": {
        if(!viewerSender(sender))throw new Error("Only extension viewers can load rule reports.");
        const path=message.reportPath;
        if(!KiCadBrowserData.validRepository(message.repository)||!KiCadBrowserData.validRef(message.ref)||!KiCadBrowserData.validPath(message.file)||typeof path!=='string'||path.length>500||!path.endsWith('.json')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f\x7f]/.test(p)))throw new Error("Invalid repository report path.");
        const content=await githubFile(message.repository,message.ref,path);if(content===null)throw new Error("Report was not found at this revision.");if(new TextEncoder().encode(content).byteLength>4*1024*1024)throw new Error("Rule report exceeds 4 MiB.");return {content,path};
      }
      case "project-inventory":
        if(!viewerSender(sender)&&!pdfSender(sender)&&!analysisSender(sender)&&!fabricationSender(sender)&&!bomSender(sender))throw new Error('Only extension viewers can inspect project files.');return projectInventory(message.repository,message.ref,message.file);
      case 'repository-branches':
        if(!viewerSender(sender))throw Error('Only extension viewers can browse repository branches.');return repositoryBranches(message.repository,message.ref);
      case 'repository-tree':
        if(!viewerSender(sender))throw Error('Only extension viewers can browse repository files.');return repositoryTree(message.repository,message.ref,{page:message.page,directory:message.directory});
      case 'repository-history':
        if(!viewerSender(sender))throw Error('Only extension viewers can browse repository history.');return repositoryHistory(message.repository,message.ref,message.page);
      case 'revision-branches':
        if(!viewerSender(sender))throw new Error('Only extension viewers can list branches.');return revisionBranches(message.repository,message.ref,message.file);
      case 'revision-commits':
        if(!viewerSender(sender))throw new Error('Only extension viewers can list commits.');return revisionCommits(message.repository,message.ref,message.file);
      case 'revision-resolve':
        if(!viewerSender(sender))throw new Error('Only extension viewers can resolve revisions.');return revisionResolve(message.repository,message.ref,message.file);
      case "project-file":
        if(!viewerSender(sender)&&!pdfSender(sender)&&!analysisSender(sender)&&!fabricationSender(sender)&&!bomSender(sender))throw new Error('Only extension viewers can read project settings.');return projectFile(message.repository,message.ref,message.file);
      case "open-project-overview":
        if(!viewerSender(sender))throw new Error('Only extension viewers can open projects.');return openProjectWindow(message.repository,message.ref,message.file);
      case "project-search-files":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can search projects.");
        return projectSearchFiles(message.repository,message.ref,message.file);
      case "drawing-files":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can list companion drawings.");
        return drawingFiles(message.repository, message.ref, message.file);
      case "open-viewer-window":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can open drawing windows.");
        return openViewerWindow(message.repository, message.ref, message.file, message.pairedFile);
      case "comment-list":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can access saved comments.");
        return commentList(message);
      case "comment-save":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can save comments.");
        return commentSave(message.comment, message.expectedUpdatedAt);
      case "comment-delete":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can delete comments.");
        return commentDelete(message, message.id);
      case "open-comment-draft":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can open comment drafts.");
        return openCommentDraft(message.comment, message);
      case "github-annotations":
        if (!viewerSender(sender)) throw new Error("Only extension viewers can read GitHub annotations.");
        return githubAnnotations(message);
      case "claim-comment-draft":
        if (viewerSender(sender)) throw new Error("Only GitHub tabs can claim comment drafts.");
        return claimCommentDraft(sender);
      case "ack-comment-draft":
        if (viewerSender(sender)) throw new Error("Only GitHub tabs can acknowledge comment drafts.");
        return acknowledgeCommentDraft(sender);
      case "project": {
        if (optionsSender(sender)) throw new Error("Options cannot load KiCad projects.");
        authorizeHostRead(message,sender);
        const { repository, ref, file } = message;
        revisionScope(repository,ref,file);
        try {
        if (/\.kicad_sch$/i.test(file || '')) {
          revisionScope(repository,ref,file);
          const snapshot=await githubSchematicSnapshot(repository,ref);
          return recentSnapshot(await KiCadBrowserData.loadProject(repository,snapshot.sha,file,githubFile,githubDirectory,'github',
            () => githubSchematicInventory(repository,snapshot.sha,snapshot.treeSha)),snapshot.sha);
        }
        return await KiCadBrowserData.loadProject(repository, ref, file, githubFile, githubDirectory);
        } catch(error) {
          if(!/HTTP (401|403|404)|rate limit/i.test(error.message))throw error;
          return githubSessionProject(repository,ref,file,error);
        }
      }
      case "githubPull":
        if (optionsSender(sender)) throw new Error("Options cannot load pull requests.");
        authorizeHostRead(message,sender);
        return githubPull(message.repository, message.number);
      case "githubFiles":
        if (optionsSender(sender)) throw new Error("Options cannot load pull request files.");
        authorizeHostRead(message,sender);
        return githubFiles(message.repository, message.number, message.expectedFiles, message.expectedHead, message.expectedBase);
      default: throw new Error("Unsupported extension request.");
    }
  })().then(async (result) => {
               void recordLoadedProject(message,sender,result).catch(()=>{});
               if (message.provider !== 'gitlab' && /^github-(auth|device)-/.test(message.type)) {
                 await updateGitHubBadge().catch(() => {});
                 if (result?.state === 'pending') scheduleDeviceCheck(result.retryAfterMs);
                 if (['github-auth-clear', 'github-auth-reset', 'github-device-cancel'].includes(message.type)) {
                   if (devicePollTimer !== null) clearTimeout(devicePollTimer);
                   devicePollTimer = null;
                 }
               }
               sendResponse({ ok: true, result });
             },
             (error) => {
               const accessIssue=error?.accessIssue||globalThis.KiCadEnvironmentDiagnostics?.classifyAccessError?.(error);
               sendResponse({ ok: false, error: error.message || String(error),...(error?.code==='MANAGED_POLICY'?{code:'MANAGED_POLICY'}:{}),...(accessIssue?{accessIssue}:{}) });
             });
  return true;
});

if (typeof module === "object" && module.exports) {
  module.exports = { projectBuffer, projectView, githubFile, githubPull, githubFiles, githubDirectory, githubSchematicInventory, drawingFiles, openViewerWindow,
    githubAsset, designChanges, senderAllowed, viewerSender, analysisSender, optionsSender, dashboardSender, dashboardDispatch, recordLoadedProject,openFromAction,
    commentList, commentSave, commentDelete, openCommentDraft, claimCommentDraft,
    acknowledgeCommentDraft, githubAnnotations, revisionBranches,revisionCommits,revisionResolve,repositoryTree,repositoryHistory,repositoryBranches };
}
