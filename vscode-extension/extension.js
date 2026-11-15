"use strict";
// Same source runs in desktop and web hosts. Immutable local Git object I/O is
// loaded lazily only in trusted desktop workspaces with the official Git API.
const vscode = require("vscode");
const projectPaths=require("./media/parsing.js");
const VIEW = "kicadVisualReview.viewer", CHANNEL = "kicad-vscode:v1";
const MAX_FILE = 256 * 1024 * 1024, MAX_LEGACY_FILE = 8 * 1024 * 1024, MAX_PROJECT = 512 * 1024 * 1024;
const MAX_MESSAGE = 1024 * 1024, MAX_FILES = 128, MAX_SOURCE_NODES = 12000000;
const MAX_SIDECAR=4*1024*1024,liveSessions=new Set(),pairTargets=new Map();
const pendingSearchTargets=new Map(),MAX_SEARCH_TARGETS=32,SEARCH_TARGET_TTL=30000;
const OPERATIONS = new Set(["open-analysis-viewer", "close-analysis-viewer", "repository-tree", "repository-history", "repository-branches", "preview-project-html", "project-inventory", "project-file", "open-project-file", "open-project-overview", "rule-report", "project-search-files", "open-project-drawing", "project", "repo-model-index", "repo-asset", "pair-selection", "comments-changed", "comment-list", "comment-save", "comment-delete", "storage-get", "storage-set", "open-comment-draft", "github-annotations"]);
const sharedReviewComments=require('./media/review-comments.js');
const {createHost:createRemoteHost,deploymentPolicy}=require('./remote-collaboration.js');
const remoteCollaboration=createRemoteHost(vscode,{sameScope,comments:sharedReviewComments});
OPERATIONS.add('repository-open-file');
OPERATIONS.add('repository-compare-current');
OPERATIONS.add('repository-export-revision');
OPERATIONS.add('repository-fork-revision');
OPERATIONS.add('analysis-focus-net');
OPERATIONS.add('workspace-search-ready');
for(const operation of remoteCollaboration.operations)OPERATIONS.add(operation);
let storageQueue=Promise.resolve();
let pendingMessages=0,pendingMessageBytes=0;
const MAX_PENDING_MESSAGES=128,MAX_PENDING_MESSAGE_BYTES=8*1024*1024;
const safePath = (path) => typeof path === "string" && path.length <= 500 && /\.kicad_(sch|pcb)$/i.test(path) &&
  !path.startsWith("/") && path.split("/").every((p) => p && p !== "." && p !== ".." && !/[\\\x00-\x1f\x7f:]/.test(p));
const safeAssetPath=(path)=>typeof path==="string" && path.length>0 && path.length<=500 && /\.(?:wrl|vrml|glb|step|stp)$/i.test(path) &&
  !path.startsWith("/") && path.split("/").every((part)=>part && part!=="." && part!==".." && !/[\\\x00-\x1f\x7f:?#%]/.test(part));
const clone = (object) => JSON.parse(JSON.stringify(object));
const sourceLimit=path=>safePath(path)?MAX_FILE:MAX_LEGACY_FILE;
function escaped(text) { return String(text).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
function secret() {
  if (!globalThis.crypto?.getRandomValues) throw new Error("This VS Code host lacks secure random tokens; update VS Code.");
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2,"0")).join("");
}
function identity(uri) {
  let hash = 2166136261;
  for (const c of uri.toString()) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `vscode/workspace-${(hash >>> 0).toString(16)}`;
}
function supportedViewerUri(uri) {
  if(!uri||typeof uri.path!=="string")return false;
  const path=uri.scheme==="file"?uri.path.replace(/^\/[A-Za-z]:\//,""):uri.path;
  return projectPaths.filePath(path.replace(/^\//,""));
}
function scopePath(uri) {
  // VS Code's Windows file provider can normalize only the drive letter.
  // Preserve folder spelling and all virtual-provider URI identities.
  return uri.scheme==="file"?uri.path.replace(/^\/([A-Za-z]):(?=\/)/,(_,drive)=>"/"+drive.toLowerCase()+":"):uri.path;
}
function sameScope(uri, boundary) {
  const prefix = scopePath(boundary).replace(/\/$/, "") + "/";
  return uri.scheme === boundary.scheme && uri.authority === boundary.authority &&
    uri.query === boundary.query && uri.fragment === boundary.fragment && scopePath(uri).startsWith(prefix);
}
function sourceAccess(uri){
  if(uri?.scheme!=="file"&&!deploymentPolicy(vscode).networkAccess)throw Error("Network access is disabled; open a local file instead of a virtual workspace source.");
}
async function workspaceAccess(method,uri,...args){
  sourceAccess(uri);if(method==='rename')sourceAccess(args[0]);
  return vscode.workspace.fs[method](uri,...args);
}
async function findSourceFiles(pattern,...args){
  if(pattern?.baseUri)sourceAccess(pattern.baseUri);
  else if(!deploymentPolicy(vscode).networkAccess&&(vscode.workspace.workspaceFolders||[]).some(folder=>folder.uri.scheme!=='file'))return [];
  return vscode.workspace.findFiles(pattern,...args);
}
function projectScope(uri) {
  sourceAccess(uri);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const boundary = folder?.uri || uri.with({path:uri.path.slice(0,uri.path.lastIndexOf("/")) || "/"});
  if (!sameScope(uri,boundary)) throw new Error("Drawing is outside its containing workspace.");
  const prefix = boundary.path.replace(/\/$/, "") + "/", rootFile = uri.path.slice(prefix.length);
  if (!projectPaths.filePath(rootFile)) throw new Error("Unsupported or unsafe KiCad drawing path.");
  return {boundary,rootFile,repository:"local/workspace",ref:"workspace"};
}
function childPath(parent,name) {
  if (typeof name !== "string" || !/\.kicad_sch$/i.test(name) || name.startsWith("/") || /[\\\x00-\x1f\x7f:]/.test(name)) return null;
  const parts=parent.split("/").slice(0,-1);
  for(const p of name.split("/")) {if(p===".."){if(!parts.length)return null;parts.pop();}else if(p&&p!==".")parts.push(p);}
  const result=parts.join("/"); return safePath(result) ? result : null;
}
function sheetFiles(source) {
  // Bounded S-expression context; only properties of top-level sheet objects
  // authorize child reads. Comments, text, and library properties are ignored.
  const names=[],stack=[];let i=0,nodes=0,roots=0;
  while(i<source.length) {
    const c=source[i];if(/\s/.test(c)){i++;continue;}
    if((c==="<"||c===">")&&/^(?:<{7,}|>{7,})(?:\s|$)/.test(source.slice(i,i+120)))throw new Error("Unresolved Git merge conflict at line "+(source.slice(0,i).split("\n").length)+". Resolve the conflict in a separate copy before viewing.");
      if(c===";"){while(i<source.length&&source[i]!=="\n")i++;continue;}
    if(c!==")"&&++nodes>MAX_SOURCE_NODES)throw new Error("KiCad source has too many S-expression nodes.");
    if(c==="(") {if(stack.length>=96)throw new Error("KiCad source is too deeply nested.");if(!stack.length)roots++;stack.push([]);i++;continue;}
    if(c===")") {
      if(!stack.length)throw new Error("Unexpected closing KiCad parenthesis.");
      const entry=stack.pop();i++;
      if(entry[0]==="property" && ["Sheetfile","Sheet file"].includes(entry[1]) && typeof entry[2]==="string" &&
        stack.length===2 && stack[0][0]==="kicad_sch" && stack[1][0]==="sheet"){
        if(names.length>=MAX_FILES)throw new Error("KiCad source references more than 128 sheets.");
        names.push(entry[2]);
      }
      continue;
    }
    if(!stack.length)throw new Error("Expected a KiCad S-expression.");
    let token="";
    if(c==='"') {
      i++;let closed=false;
      while(i<source.length) {
        const next=source[i++];if(next==='"'){closed=true;break;}
        if(next==="\\"){if(i>=source.length)break;const escaped=source[i++];token+=({n:"\n",r:"\r",t:"\t",'"':'"',"\\":"\\"})[escaped] ?? `\\${escaped}`;}
        else token+=next;
      }
      if(!closed)throw new Error("Unterminated quoted KiCad value.");
    } else {const start=i;while(i<source.length&&!/[\s();"]/.test(source[i]))i++;if(i===start)throw new Error("Invalid KiCad source token.");token=source.slice(start,i);}
    if(stack.at(-1).length<3)stack.at(-1).push(token);
  }
  if(stack.length || roots!==1)throw new Error("Incomplete KiCad S-expression.");
  return names;
}
async function loadProject(uri,scope=projectScope(uri),cancel={isCancellationRequested:false},readBudget=null) {
  const queue=[scope.rootFile], seen=new Set(), files=[], warnings=[],checkedDirectories=new Set();let total=0;
  while(queue.length) {
    if(cancel.isCancellationRequested)throw new Error("Drawing load cancelled.");
    const path=queue.shift();if(seen.has(path))continue;
    if(seen.size>=MAX_FILES)throw new Error(`Project exceeds the ${MAX_FILES}-sheet review limit.`);seen.add(path);
    const target=vscode.Uri.joinPath(scope.boundary,...path.split("/"));
    if(!sameScope(target,scope.boundary))throw new Error("Referenced sheet escapes the workspace.");
    let bytes;
    try {
      const parts=path.split("/");
      for(let i=1;i<parts.length;i++) {
        const directory=vscode.Uri.joinPath(scope.boundary,...parts.slice(0,i)),key=directory.toString();
        if(checkedDirectories.has(key))continue;
        const directoryStat=await workspaceAccess("stat",directory);
        if(directoryStat.type & vscode.FileType.SymbolicLink)throw new Error("Symbolic-link directories are excluded from bounded workspace review.");
        checkedDirectories.add(key);
      }
      const stat=await workspaceAccess("stat",target);
      if(stat.type & vscode.FileType.SymbolicLink)throw new Error("Symbolic-link drawings are excluded from bounded workspace review.");
      if(stat.size>sourceLimit(path))throw new Error(`Project file exceeds the ${sourceLimit(path)/1048576} MiB file limit.`);
      if(readBudget&&(readBudget.files>=MAX_FILES||readBudget.bytes+stat.size>MAX_PROJECT))throw new Error(`Project search reached its ${MAX_FILES}-read / ${MAX_PROJECT/1048576} MiB source limit.`);
      bytes=await workspaceAccess("readFile",target);
      if(readBudget){readBudget.files++;readBudget.bytes+=bytes.byteLength;if(readBudget.bytes>MAX_PROJECT)throw new Error(`Project search source grew beyond its ${MAX_PROJECT/1048576} MiB read limit.`);}
    } catch(error) {
      if(path===scope.rootFile || !["FileNotFound","EntryNotFound"].includes(error.code))throw error;
      warnings.push(`Missing referenced sheet: ${path}`);continue;
    }
    if(bytes.byteLength>sourceLimit(path) || (total+=bytes.byteLength)>MAX_PROJECT)throw new Error(`Project exceeds the ${sourceLimit(path)/1048576} MiB file / ${MAX_PROJECT/1048576} MiB project limit.`);
    const content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);files.push({path,content});
    let children=[];
    if(/\.kicad_sch$/i.test(path))try{children=sheetFiles(content);}catch(error){
      throw new Error(`${path}: ${error.message} The saved schematic could not be read. Open the source with the Text Editor to check whether it is empty or incomplete, and save or restore a complete KiCad file.`);
    }
    for(const name of children) {
      const child=childPath(path,name);
      if(!child)warnings.push(`Unsupported or out-of-workspace sheet reference: ${name.slice(0,200)}`);
      else if(!seen.has(child))queue.push(child);
    }
  }
  return {files,warnings,scope};
}
function assertScope(request,session) {
  if(request.repository!==session.scope.repository || request.ref!==session.scope.ref || !session.paths.has(request.file))
    throw new Error("Request belongs to another workspace or drawing.");
}
function validateComment(note,session=null,bindSession=session) {
  if(!note || typeof note!=="object" || typeof note.id!=="string" || !/^[A-Za-z0-9_-]{1,100}$/.test(note.id) ||
    typeof note.text!=="string" || !note.text.trim() || note.text.length>4000 ||
    !sharedReviewComments.isSeverity(note.severity || "info") ||
    !validTimestamp(note.createdAt))
    throw new Error("Invalid local review annotation.");
  const allowed=new Set(["id","text","severity","createdAt","updatedAt","anchor","tags","state","remoteRefs","capture","mentions","threadType","attachments"]);
  if(Object.keys(note).some((key)=>!allowed.has(key)))throw new Error("Annotation has unsupported fields; preserve it in the sidecar before upgrading.");
  if(!note.anchor || typeof note.anchor.repository!=="string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(note.anchor.repository) ||
    note.anchor.repository.split("/").some((p)=>[".",".."].includes(p)) || typeof note.anchor.ref!=="string" ||
    !/^[A-Za-z0-9._/-]{1,200}$/.test(note.anchor.ref) || note.anchor.ref.includes("..") || note.anchor.ref.startsWith("/") ||
    note.anchor.ref.endsWith("/") || !safePath(note.anchor.file))throw new Error("Invalid annotation scope.");
  if(session)assertScope(note.anchor,session);
  const anchor={repository:note.anchor.repository,ref:note.anchor.ref,file:note.anchor.file};
  if(Object.keys(note.anchor).some((key)=>!["repository","ref","file","uuid","objectId","reference","netName","kind","position","area","variant"].includes(key)))throw new Error("Annotation anchor has unsupported fields.");
  for(const [name,limit] of [["uuid",200],["objectId",200],["reference",100],["netName",500],["kind",80],["variant",100]]) {
    const item=note.anchor[name];if(item==null || item==="")continue;
    if(typeof item!=="string" || item.length>limit || /[\x00-\x1f\x7f]/.test(item))throw new Error("Invalid annotation anchor.");anchor[name]=item;
  }
  if(note.anchor.position!=null) {
    const {x,y}=note.anchor.position;
    if(![x,y].every(Number.isFinite) || Math.abs(x)>1e6 || Math.abs(y)>1e6)throw new Error("Invalid annotation position.");anchor.position={x,y};
  }
  if(note.anchor.area!==undefined) {
    const area=note.anchor.area;
    if(!area || typeof area!=="object" || Array.isArray(area) || Object.keys(area).some((key)=>!["x","y","width","height"].includes(key)) ||
      ![area.x,area.y,area.width,area.height].every(Number.isFinite) || Math.abs(area.x)>1e6 || Math.abs(area.y)>1e6 ||
      area.width<=0 || area.height<=0 || area.width>1e6 || area.height>1e6 ||
      Math.abs(area.x+area.width)>1e6 || Math.abs(area.y+area.height)>1e6)throw new Error("Invalid annotation area.");
    anchor.area={x:area.x,y:area.y,width:area.width,height:area.height};
  }
  let capture;
  if(note.capture!==undefined) {
    const image=note.capture;
    if(!image || typeof image!=="object" || Array.isArray(image) || Object.keys(image).some((key)=>!["mime","dataUrl","width","height"].includes(key)) ||
      image.mime!=="image/png" || typeof image.dataUrl!=="string" || image.dataUrl.length>256*1024 ||
      !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataUrl) ||
      !pngSignature(image.dataUrl.slice(22)) || ![image.width,image.height].every((size)=>Number.isInteger(size) && size>0 && size<=1024))
      throw new Error("Invalid annotation PNG capture.");
    capture={mime:image.mime,dataUrl:image.dataUrl,width:image.width,height:image.height};
  }
  const updatedAt=note.updatedAt ?? note.createdAt,tags=note.tags ?? [],state=note.state ?? "open",remoteRefs=note.remoteRefs ?? [];
  if(!validTimestamp(updatedAt) || !sharedReviewComments.isState(state) ||
    !Array.isArray(tags) || tags.length>20 || tags.some((tag)=>typeof tag!=="string" || !tag.trim() || tag.length>40 || /[\x00-\x1f\x7f]/.test(tag)) ||
    !Array.isArray(remoteRefs) || remoteRefs.length>20)throw new Error("Invalid annotation state, timestamps, tags or remote references.");
  if(Date.parse(updatedAt)<Date.parse(note.createdAt))throw new Error("Annotation update time precedes creation time.");
  const threadType=note.threadType;if(threadType!==undefined&&!["issue","discussion"].includes(threadType))throw new Error("Invalid annotation thread type.");
  const inputMentions=note.mentions??[],mentions=[],mentionKeys=new Set();
  if(!Array.isArray(inputMentions) || inputMentions.length>20)throw new Error("Invalid annotation mentions.");
  for(const raw of inputMentions) {
    if(typeof raw!=="string")throw new Error("Invalid annotation mention.");
    const login=raw.startsWith("@")?raw.slice(1):raw;
    if(!(bindSession?.remoteBinding?.provider==='gitlab'?/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/:/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/).test(login))throw new Error("Invalid annotation mention.");
    const key=login.toLowerCase();if(!mentionKeys.has(key)){mentions.push(login);mentionKeys.add(key);}
  }
  const shared=bindSession?.remoteBinding?.provider==='gitlab'?sharedReviewComments.forWorkspace({repository:bindSession.scope.repository,ref:bindSession.scope.ref,file:note.anchor.file},{...bindSession.remoteBinding,file:note.anchor.file}).validateComment(note):sharedReviewComments.validateComment(note);
  const refs=remoteRefs.map((remote)=> {
    if(remote?.provider==='gitlab')return shared.remoteRefs.find(r=>r.url===remote.url);
    if(!remote || !["issue","discussion"].includes(remote.kind) || typeof remote.repository!=="string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(remote.repository) || remote.repository.split("/").some((p)=>[".",".."].includes(p)) ||
      !Number.isSafeInteger(remote.number) || remote.number<=0 || !validTimestamp(remote.publishedAt) ||
      Object.keys(remote).some((key)=>!["kind","repository","number","nodeId","url","publishedAt"].includes(key)) ||
      (remote.nodeId!==undefined && (typeof remote.nodeId!=="string" || !remote.nodeId || remote.nodeId.length>200 || /[\x00-\x1f\x7f]/.test(remote.nodeId))))throw new Error("Invalid remote annotation reference.");
    const base=`https://github.com/${remote.repository}/${remote.kind==="issue"?"issues":"discussions"}/${remote.number}`;
    if(typeof remote.url!=="string" || !remote.url.startsWith(base) ||
      (remote.url!==base && !/^#(?:issuecomment|discussioncomment)-[0-9]+$/.test(remote.url.slice(base.length))))throw new Error("Invalid remote annotation URL.");
    return clone(remote);
  });
  return {id:note.id,text:note.text.trim(),createdAt:note.createdAt,updatedAt,severity:note.severity || "info",anchor,
    tags:[...new Set(tags.map((tag)=>tag.trim()))],state,mentions,...(threadType?{threadType}:{}),remoteRefs:refs,...(capture ? {capture} : {}),...(shared.attachments?.length?{attachments:shared.attachments}:{})};
}
function pngSignature(payload) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",bytes=[];let bits=0,count=0;
  for(const character of payload.slice(0,12)) {
    const value=alphabet.indexOf(character);if(value<0)return false;bits=(bits<<6)|value;count+=6;
    if(count>=8){count-=8;bytes.push((bits>>>count)&255);}
  }
  return [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
}
function validTimestamp(value) {
  return typeof value==="string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19)===value.slice(0,19);
}
function validateSidecar(data,session=null) {
  if(!data || data.schemaVersion!==1 || !Array.isArray(data.annotations) || data.annotations.length>1000 ||
    Object.keys(data).some((key)=>!["schemaVersion","annotations"].includes(key)))throw new Error("Unsupported .kicad-review.json schema; expected schemaVersion 1 and annotations.");
  const seen=new Set(),annotations=data.annotations.map((note)=> {
    const normalized=validateComment(note,null,session),key=JSON.stringify([normalized.anchor.repository,normalized.anchor.ref,normalized.anchor.file,normalized.id]);
    if(seen.has(key))throw new Error("Duplicate annotation identity in .kicad-review.json.");seen.add(key);return normalized;
  });
  return {schemaVersion:1,annotations};
}
const equalBytes=(a,b)=>a===null || b===null ? a===b : a.length===b.length && a.every((value,index)=>value===b[index]);
async function readSidecar(session) {
  if(!session.history&&!session.remoteBinding)await remoteCollaboration.publicContext(session);
  const uri=vscode.Uri.joinPath(session.scope.boundary,".kicad-review.json");
  try {
    const stat=await workspaceAccess("stat",uri);
    if(stat.type & vscode.FileType.SymbolicLink)throw new Error("The review sidecar is a symbolic link; writes are disabled.");
    if(stat.size>MAX_SIDECAR)throw new Error("Review sidecar exceeds 4 MiB.");
    const bytes=await workspaceAccess("readFile",uri);
    if(bytes.length>MAX_SIDECAR)throw new Error("Review sidecar exceeds 4 MiB.");
    return {uri,bytes:bytes.slice(),data:validateSidecar(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)),session)};
  } catch(error) {
    if(["FileNotFound","EntryNotFound"].includes(error.code))return {uri,bytes:null,data:{schemaVersion:1,annotations:[]}};
    throw error;
  }
}
async function writeSidecar(session,before,data) {
  const validated=validateSidecar(data,session);
  validated.annotations.sort((a,b)=>JSON.stringify([a.anchor.repository,a.anchor.ref,a.anchor.file,a.id]).localeCompare(JSON.stringify([b.anchor.repository,b.anchor.ref,b.anchor.file,b.id])));
  const bytes=new TextEncoder().encode(JSON.stringify(validated,null,2)+"\n");
  if(bytes.length>MAX_SIDECAR)throw new Error("Review sidecar exceeds 4 MiB; no annotations were written.");
  const temporary=vscode.Uri.joinPath(session.scope.boundary,`.kicad-review.${secret()}.tmp`);
  try {
    await workspaceAccess("writeFile",temporary,bytes);
    if(!equalBytes(bytes,await workspaceAccess("readFile",temporary)))throw new Error("Review staging verification failed; original sidecar preserved.");
    const latest=await readSidecar(session);
    if(!equalBytes(before.bytes,latest.bytes))throw new Error("Review sidecar changed externally; reload annotations before retrying. Original changes were preserved.");
    try {await workspaceAccess("rename",temporary,before.uri,{overwrite:before.bytes!==null});}
    catch(error) {
      // A remote provider can commit and then lose its acknowledgement. Recover
      // only when the full destination bytes prove this exact candidate arrived.
      const recovered=await readSidecar(session);
      if(!equalBytes(bytes,recovered.bytes))throw error;
    }
    const committed=await readSidecar(session);
    if(!equalBytes(bytes,committed.bytes))throw new Error("Review sidecar changed during commit; reload annotations to inspect the result.");
    for(const current of liveSessions)if(current.scope.boundary.toString()===session.scope.boundary.toString())current.sidecarBytes=committed.bytes;
    return validated;
  } catch(error) {
    throw new Error(`Could not save .kicad-review.json: ${error.message || error}`);
  } finally {await workspaceAccess("delete",temporary,{recursive:false,useTrash:false}).catch(()=>{});}
}
async function annotationSnapshot(session) {
  const current=await readSidecar(session);
  if(session.sidecarBytes!==undefined && !equalBytes(session.sidecarBytes,current.bytes))throw new Error("Review sidecar changed externally; reload annotations before saving. No changes were written.");
  return current;
}
function createSession(uri,project,context,token=secret()) {
  const storageKey=`kicad-visual-review:${uri.toString()}`;
  const session={uri,scope:project.scope,files:project.files,paths:new Set(project.files.map((f)=>f.path)),context,token,lastId:0,disposed:false,
    storageKey,variantKey:JSON.stringify(["kicad-review-variants",project.scope.repository,project.scope.rootFile]),
    preferencesKey:JSON.stringify(["kicad-review-preferences",project.scope.repository,project.scope.rootFile]),assetRequests:0,assetBytes:0,eventId:0,...(project.history?{history:project.history}:{})};
  liveSessions.add(session);return session;
}
function validateSearchResult(value,file){
  if(!value||typeof value!=='object'||Array.isArray(value)||!['object','file'].includes(value.kind)||!safePath(value.path)||value.path!==file||Object.keys(value).some(key=>!['kind','path','id','uuid','reference','position','netName','view'].includes(key)))throw Error('Invalid or out-of-source workspace search result.');
  const result={kind:value.kind,path:value.path};
  for(const [key,max]of [['id',1000],['uuid',200],['reference',200],['netName',500]])if(value[key]!==undefined&&value[key]!==null){if(typeof value[key]!=='string'||!value[key]||value[key].length>max||/[\x00-\x1f\x7f]/.test(value[key]))throw Error('Invalid workspace search identity.');result[key]=value[key];}
  if(value.position!==undefined&&value.position!==null){const point=value.position;if(!point||typeof point!=='object'||Array.isArray(point)||Object.keys(point).some(key=>!['x','y'].includes(key))||![point.x,point.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6))throw Error('Invalid workspace search position.');result.position={x:point.x,y:point.y};}
  if(value.view!==undefined){if(value.view!=='3d'||!/\.kicad_pcb$/i.test(file))throw Error('Invalid workspace search view.');result.view='3d';}
  return result;
}
function searchTargetKey(uri,scope){return JSON.stringify([uri.toString(),scope.boundary.toString(),scope.repository,scope.ref]);}
function pruneSearchTargets(now=Date.now()){for(const [key,value]of pendingSearchTargets)if(value.expires<=now)pendingSearchTargets.delete(key);}
function queueSearchTarget(uri,scope,result){
  pruneSearchTargets();const key=searchTargetKey(uri,scope);pendingSearchTargets.delete(key);
  while(pendingSearchTargets.size>=MAX_SEARCH_TARGETS)pendingSearchTargets.delete(pendingSearchTargets.keys().next().value);
  const entry={result,expires:Date.now()+SEARCH_TARGET_TTL};pendingSearchTargets.set(key,entry);return entry;
}
function takeSearchTarget(session){
  pruneSearchTargets();const key=searchTargetKey(session.uri,session.scope),entry=pendingSearchTargets.get(key);
  if(!entry||entry.result.path!==session.scope.rootFile)return null;pendingSearchTargets.delete(key);return entry.result;
}
async function deliverSearchTarget(session){
  if(session.disposed||!session.searchReady||session.analysisPath||session.overview)return false;
  pruneSearchTargets();const key=searchTargetKey(session.uri,session.scope),entry=pendingSearchTargets.get(key);
  if(!entry||entry.result.path!==session.scope.rootFile)return false;
  const delivered=await notifySession(session,{type:'workspace-search-result',result:entry.result});
  if(delivered&&pendingSearchTargets.get(key)===entry)pendingSearchTargets.delete(key);return delivered;
}
function validPairSelection(value) {
  if(value?.kind==="group") {
    if(Object.keys(value).some((key)=>!["kind","items"].includes(key)) || !Array.isArray(value.items) || value.items.length>200)return false;
    for(const item of value.items)if(!item || item.kind==="group" || !validPairSelection(item))return false;
    return true;
  }
  const bounded=(item,limit)=>typeof item==="string" && item.length>0 && item.length<=limit && !/[\x00-\x1f\x7f]/.test(item);
  if(!value || typeof value!=="object" || Array.isArray(value) || !["part","net","pin"].includes(value.kind) || !bounded(value.path,1000))return false;
  if(!/^.+\.kicad_(?:sch|pcb)$/i.test(value.path) || value.path.startsWith("/") || value.path.split("/").some((part)=>!part || part==="." || part===".." || /[\\:]/.test(part)))return false;
  const fields=value.kind==="pin"?["kind","path","reference","pinNumber","uuid","ownerUuid","symbolUuid"]:value.kind==="part"?["kind","path","reference","uuid","symbolUuid"]:["kind","path","netName","qualifiedNetName"];
  if(Object.keys(value).some((key)=>!fields.includes(key)))return false;
  if(value.kind==="pin"&&(!bounded(value.pinNumber,200)||(value.ownerUuid!==undefined&&!bounded(value.ownerUuid,200))))return false;
  return value.kind==="net" ? bounded(value.netName,500) && (value.qualifiedNetName===undefined || bounded(value.qualifiedNetName,500)) : bounded(value.reference,200) &&
    ["uuid","symbolUuid"].every((key)=>value[key]===undefined || bounded(value[key],200));
}
async function relaySelection(value,session) {
  if(!validPairSelection(value) || !(value.kind==="group"?value.items:[value]).every((item)=>session.paths.has(item.path)))throw new Error("Invalid or out-of-project paired selection.");
  const target=pairTargets.get(session.uri.toString());if(!target)return {delivered:0};
  let delivered=0;
  for(const other of liveSessions) {
    if(other===session || other.uri.toString()!==target || other.scope.boundary.toString()!==session.scope.boundary.toString() ||
      other.scope.repository!==session.scope.repository || other.scope.ref!==session.scope.ref ||
      /\.kicad_sch$/i.test(other.uri.path)===/\.kicad_sch$/i.test(session.uri.path))continue;
    if(await notifySession(other,{type:"related",selection:clone(value)}))delivered++;
  }
  return {delivered};
}
function unpair(uri) {
  const key=uri.toString(),other=pairTargets.get(key);pairTargets.delete(key);if(other && pairTargets.get(other)===key)pairTargets.delete(other);
}
async function notifySession(session,event) {
  if(session.disposed || typeof session.post!=="function" || session.eventId>=1000000)return false;
  try{return (await session.post({channel:CHANNEL,token:session.token,eventId:++session.eventId,event}))!==false;}catch{return false;}
}
async function focusAnalysisNet(request,session){
  assertScope(request,session);
  if(!session.analysisPath||request.file!==session.scope.rootFile||typeof request.netName!=='string'||request.netName.length<1||request.netName.length>500||/[\x00-\x1f\x7f]/.test(request.netName)||Object.keys(request).some(key=>!['type','repository','ref','file','netName'].includes(key)))throw Error('Invalid or out-of-context analysis net focus.');
  let delivered=0;
  for(const other of liveSessions){
    if(other===session||other.analysisPath||other.overview||other.context!==session.context||other.uri.toString()!==session.uri.toString()||other.scope.boundary.toString()!==session.scope.boundary.toString()||other.scope.repository!==session.scope.repository||other.scope.ref!==session.scope.ref||other.scope.rootFile!==session.scope.rootFile)continue;
    if(await notifySession(other,{type:'analysis-net-focus',netName:request.netName}))delivered++;
  }
  return{delivered};
}
function encodeBase64(bytes) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",chunks=[];let chunk="";
  for(let i=0;i<bytes.length;i+=3) {
    const first=bytes[i],second=bytes[i+1],third=bytes[i+2];
    chunk+=alphabet[first>>>2]+alphabet[((first&3)<<4)|((second??0)>>>4)]+(second===undefined?"=":alphabet[((second&15)<<2)|((third??0)>>>6)])+(third===undefined?"=":alphabet[third&63]);
    if(chunk.length>=16384){chunks.push(chunk);chunk="";}
  }
  chunks.push(chunk);return chunks.join("");
}
async function loadRepoAsset(request,session) {
  if(request.repository!==session.scope.repository || request.ref!==session.scope.ref)throw new Error("Model asset belongs to another workspace or revision.");
  if(session.assetRequests>=32)throw new Error("Model assets exceed the 32-request session limit.");session.assetRequests++;
  if(!safeAssetPath(request.file))throw new Error("Unsupported or unsafe model asset path.");
  if(session.history){const bytes=await historicalBytes(session,request.file,MAX_LEGACY_FILE);session.assetBytes+=bytes.byteLength;if(session.assetBytes>32*1024*1024)throw Error('Model assets exceed the 32 MiB session limit.');return{base64:encodeBase64(bytes),mediaType:/\.(step|stp)$/i.test(request.file)?'model/step':/\.glb$/i.test(request.file)?'model/gltf-binary':'model/vrml'};}
  const parts=request.file.split("/"),target=vscode.Uri.joinPath(session.scope.boundary,...parts);
  if(!sameScope(target,session.scope.boundary))throw new Error("Model asset escapes the workspace.");
  for(let i=1;i<parts.length;i++) {
    const stat=await workspaceAccess("stat",vscode.Uri.joinPath(session.scope.boundary,...parts.slice(0,i)));
    if(stat.type & vscode.FileType.SymbolicLink)throw new Error("Symbolic-link model directories are excluded from bounded workspace review.");
    if(!(stat.type & vscode.FileType.Directory))throw new Error("Model asset parent is not a directory.");
  }
  const stat=await workspaceAccess("stat",target);
  if(stat.type & vscode.FileType.SymbolicLink)throw new Error("Symbolic-link model assets are excluded from bounded workspace review.");
  if(!(stat.type & vscode.FileType.File))throw new Error("Model asset is not a file.");
  if(!Number.isSafeInteger(stat.size) || stat.size<0 || stat.size>MAX_LEGACY_FILE)throw new Error("Model asset exceeds the 8 MiB file limit.");
  if(session.assetBytes+stat.size>32*1024*1024)throw new Error("Model assets exceed the 32 MiB session limit.");
  const bytes=await workspaceAccess("readFile",target);session.assetBytes+=bytes.byteLength;
  if(bytes.byteLength>MAX_LEGACY_FILE)throw new Error("Model asset exceeds the 8 MiB file limit.");
  if(session.assetBytes>32*1024*1024)throw new Error("Model assets exceed the 32 MiB session limit.");
  return {base64:encodeBase64(bytes),mediaType:/\.(step|stp)$/i.test(request.file)?"model/step":/\.glb$/i.test(request.file)?"model/gltf-binary":"model/vrml"};
}
async function repoModelIndex(request,session){
  if(request.repository!==session.scope.repository||request.ref!==session.scope.ref)throw Error('Model discovery belongs to another workspace or revision.');
  if(session.history){const tree=await historicalInventory(session);return{paths:tree.entries.filter(e=>e.kind==='file'&&safeAssetPath(e.path)).map(e=>e.path).slice(0,2000),snapshotRef:session.history.sha,warnings:tree.warnings};}
  const candidates=await findSourceFiles({baseUri:session.scope.boundary,pattern:'**/*'},'**/{.git,node_modules,__pycache__}/**',5001),paths=[],warnings=[];
  if(candidates.length>5000)warnings.push('Workspace model discovery reached 5000 files; library path matching may be incomplete.');
  const prefix=session.scope.boundary.path.replace(/\/$/,'')+'/';
  for(const uri of candidates.slice(0,5000)){
    if(!sameScope(uri,session.scope.boundary))continue;const path=uri.path.slice(prefix.length);if(!safeAssetPath(path))continue;
    try{
      const parts=path.split('/');
      for(let i=1;i<=parts.length;i++){
        const stat=await workspaceAccess("stat",vscode.Uri.joinPath(session.scope.boundary,...parts.slice(0,i)));
        if(stat.type&vscode.FileType.SymbolicLink)throw Error('linked model excluded');
        if(!(stat.type&(i===parts.length?vscode.FileType.File:vscode.FileType.Directory)))throw Error('invalid model file or directory');
      }
      if(!paths.includes(path))paths.push(path);
    }catch{warnings.push(`${path}: unavailable or linked model excluded.`);}
    if(paths.length>=2000){warnings.push('Model discovery is limited to 2000 files; library path matching may be incomplete.');break;}
  }
  return {paths:paths.sort(),snapshotRef:session.scope.ref,warnings:warnings.slice(0,48)};
}
async function searchProjectFiles(request,session) {
  assertScope(request,session);
  if(session.history){const tree=await historicalInventory(session),files=[],seen=new Set(),settings=[],warnings=[...tree.warnings],budget={files:0,bytes:0};let bytes=0;const drawings=tree.entries.filter(e=>e.kind==='file'&&safePath(e.path));for(const item of drawings){if(seen.has(item.path))continue;if(files.length>=MAX_FILES||budget.files>=MAX_FILES)break;const project=await loadHistoricalProject({...session.scope,rootFile:item.path},session.history,budget);for(const file of project.files){if(seen.has(file.path))continue;bytes+=new TextEncoder().encode(file.content).byteLength;if(files.length>=MAX_FILES||bytes>MAX_PROJECT)throw Error(`Saved project search exceeds the ${MAX_FILES}-file / ${MAX_PROJECT/1048576} MiB limit.`);seen.add(file.path);files.push(file);session.paths.add(file.path);}}for(const item of tree.entries.filter(e=>e.kind==='file'&&/\.kicad_pro$/i.test(e.path)).slice(0,8)){const content=new TextDecoder('utf-8',{fatal:true}).decode(await historicalBytes(session,item.path,1024*1024));settings.push({path:item.path,content});}if(drawings.length>files.length)warnings.push(`Saved project search is limited to ${MAX_FILES} drawings.`);return{files,settings,warnings,snapshotRef:session.history.sha,totalDrawings:drawings.length};}
  const candidates=await findSourceFiles({baseUri:session.scope.boundary,pattern:"**/*.{kicad_sch,kicad_pcb}"},"**/{.git,node_modules}/**",201);
  const safe=candidates.filter(uri=>sameScope(uri,session.scope.boundary)).map(uri=>({uri,path:uri.path.slice(session.scope.boundary.path.replace(/\/$/,"").length+1)})).filter(item=>safePath(item.path)).sort((a,b)=>a.path.localeCompare(b.path));
  safe.sort((a,b)=>(b.path===session.scope.rootFile?1:0)-(a.path===session.scope.rootFile?1:0));
  const files=[],seen=new Set(),warnings=[],readBudget={files:0,bytes:0};let total=0;
  if(candidates.length>=201)warnings.push("Workspace drawing discovery reached its 200-file limit; results are incomplete.");
  for(const item of safe.slice(0,MAX_FILES)) {
    if(seen.has(item.path))continue;
    try {const project=await loadProject(item.uri,{...session.scope,rootFile:item.path},{isCancellationRequested:false},readBudget);
      for(const file of project.files) {if(seen.has(file.path))continue;const size=new TextEncoder().encode(file.content).byteLength;
        if(files.length>=MAX_FILES||total+size>MAX_PROJECT){warnings.push(`Project search reached its ${MAX_FILES}-file / ${MAX_PROJECT/1048576} MiB source limit.`);break;}
        files.push(file);seen.add(file.path);total+=size;session.paths.add(file.path);
      }warnings.push(...project.warnings);
    }catch(error){warnings.push(`${item.path}: ${error.message}`);}
    if(files.length>=MAX_FILES||total>=MAX_PROJECT||readBudget.files>=MAX_FILES||readBudget.bytes>=MAX_PROJECT)break;
  }
  if(safe.length>MAX_FILES)warnings.push(`Workspace has ${safe.length} discovered drawings; search loads at most ${MAX_FILES}.`);
  const settings=[],projects=await findSourceFiles({baseUri:session.scope.boundary,pattern:"**/*.kicad_pro"},"**/{.git,node_modules}/**",9);
  for(const uri of projects.slice(0,8)) {
    if(!sameScope(uri,session.scope.boundary))continue;const path=uri.path.slice(session.scope.boundary.path.replace(/\/$/,"").length+1);
    if(!/\.kicad_pro$/i.test(path)||path.length>500||path.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f\x7f]/.test(p)))continue;
    try{const parts=path.split('/');for(let i=1;i<=parts.length;i++){const stat=await workspaceAccess("stat",vscode.Uri.joinPath(session.scope.boundary,...parts.slice(0,i)));if(stat.type&vscode.FileType.SymbolicLink)throw new Error('Symbolic-link project settings are excluded.');if(i===parts.length&&stat.size>1024*1024)throw new Error('Project settings exceed 1 MiB.');}
      const bytes=await workspaceAccess("readFile",uri);if(bytes.byteLength>1024*1024)throw new Error('Project settings exceed 1 MiB.');settings.push({path,content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});
    }catch(error){warnings.push(`${path}: ${error.message}`);}
  }
  if(projects.length>8)warnings.push('Only the first eight project settings files were retrieved. Import the desired .kicad_pro if absent.');
  return {files,settings,warnings,snapshotRef:"workspace",totalDrawings:safe.length};
}
async function readProjectFile(path,session){
  if(!projectPaths.filePath(path))throw new Error('Unsupported project file path.');
  if(session.history)return{path,content:new TextDecoder('utf-8',{fatal:true}).decode(await historicalBytes(session,path))};
  const uri=vscode.Uri.joinPath(session.scope.boundary,...path.split('/'));if(!sameScope(uri,session.scope.boundary))throw new Error('Project file escapes workspace.');
  const parts=path.split('/');for(let i=1;i<=parts.length;i++){const stat=await workspaceAccess("stat",vscode.Uri.joinPath(session.scope.boundary,...parts.slice(0,i)));if(stat.type&vscode.FileType.SymbolicLink)throw new Error('Symbolic-link project files are excluded.');if(i===parts.length&&stat.size>sourceLimit(path))throw new Error(`Project file exceeds ${sourceLimit(path)/1048576} MiB.`);}
  const bytes=await workspaceAccess("readFile",uri);if(bytes.byteLength>sourceLimit(path))throw new Error(`Project file exceeds ${sourceLimit(path)/1048576} MiB.`);return {path,content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}
async function projectInventory(session){
  if(session.history){const tree=await historicalInventory(session),files=tree.entries.filter(e=>e.kind==='file'&&projectPaths.filePath(e.path));return{files:files.slice(0,1000).map(({path,size})=>({path,size})),snapshotRef:session.history.sha,warnings:[...tree.warnings,...(files.length>1000?['First 1000 saved project files shown.']:[])]};}
  const candidates=await findSourceFiles({baseUri:session.scope.boundary,pattern:'**/*'},'**/{.git,node_modules,__pycache__}/**',5001),files=[],warnings=[];
  if(candidates.length>5000)warnings.push('Workspace discovery reached 5000 files; project structure may be incomplete.');
  const prefix=session.scope.boundary.path.replace(/\/$/,'')+'/';
  for(const uri of candidates.slice(0,5000)){if(!sameScope(uri,session.scope.boundary))continue;const path=uri.path.slice(prefix.length);if(!projectPaths.filePath(path))continue;
    try{const stat=await workspaceAccess("stat",uri);if(stat.type&vscode.FileType.SymbolicLink)continue;files.push({path,size:stat.size});}catch(error){warnings.push(`${path}: unavailable.`);}}
  files.sort((a,b)=>a.path.localeCompare(b.path));if(files.length>1000)warnings.push('First 1000 supported project files shown.');
  return {files:files.slice(0,1000),snapshotRef:'workspace',warnings};
}
function staticHTML(source){
  const preview=require('./media/html-preview.js').documentFor(source,{interactive:false});
  const policy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src about:; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';";
  return '<!doctype html><head><meta http-equiv="Content-Security-Policy" content="'+escaped(policy)+'"></head><body><p>Static repository HTML preview. Scripts and external assets are disabled. Interactive iBOM is available in the browser extension.</p><iframe title="Static untrusted HTML" sandbox="" style="width:100%;height:85vh;border:0;background:white" srcdoc="'+escaped(preview)+'"></iframe></body>';
}
function openStaticHTML(source,path){
  const panel=vscode.window.createWebviewPanel('kicadVisualReview.html','HTML: '+path,vscode.ViewColumn.Beside,{enableScripts:false,localResourceRoots:[]});
  panel.webview.html=staticHTML(source);return {opened:true,interactive:false};
}
async function openOverview(session){
  const panel=vscode.window.createWebviewPanel('kicadVisualReview.project','KiCad Online',vscode.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(session.context.extensionUri,'media'),session.context.extensionUri]});
  const project={files:session.files,scope:session.scope,history:session.history},overview=createSession(session.uri,project,session.context);overview.overview=true;overview.closeForPolicy=()=>panel.dispose();overview.closeForPolicy=()=>panel.dispose();view.post=message=>panel.webview.postMessage(message);
  const receiver=panel.webview.onDidReceiveMessage(message=>handleMessage(message,overview,reply=>panel.webview.postMessage(reply)));panel.onDidDispose(()=>{overview.disposed=true;liveSessions.delete(overview);receiver.dispose();});panel.webview.html=await htmlFor(panel.webview,session.context,overview);return {opened:true};
}
async function openAnalysis(request,session){
  assertScope(request,session);
  if(request.resultView!==undefined&&!['map','2d','3d'].includes(request.resultView))throw Error('Invalid saved result view.');
  if(typeof request.path!=='string'||!/\.(json|csv|tsv|wbk|raw|txt|html?)$/i.test(request.path))throw Error('Choose a supported saved analysis report.');
  await readProjectFile(request.path,session); // Enforce the existing workspace, symlink and byte boundaries.
  const panel=vscode.window.createWebviewPanel('kicadVisualReview.analysis','Results: '+request.path.split('/').at(-1),vscode.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(session.context.extensionUri,'media'),session.context.extensionUri]});
  const view=createSession(session.uri,{files:session.files,scope:session.scope,history:session.history},session.context);
  view.analysisPath=request.path;view.analysisResultView=request.resultView;view.closeAnalysis=()=>panel.dispose();view.closeForPolicy=()=>panel.dispose();view.post=message=>panel.webview.postMessage(message);
  const receiver=panel.webview.onDidReceiveMessage(message=>handleMessage(message,view,reply=>panel.webview.postMessage(reply)));
  panel.onDidDispose(()=>{view.disposed=true;liveSessions.delete(view);receiver.dispose();});
  try{panel.webview.html=await htmlFor(panel.webview,session.context,view);}catch(error){panel.dispose();throw error;}return{opened:true};
}
// Working-tree inventory and immutable historical inventory are distinct.
// Git executable/root identity always comes from the official VS Code Git API.
const GIT_SHA=/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const BROWSE_LIMIT=10000,BROWSE_PAGE=200;
function browsePath(value,rootAllowed=false){return typeof value==='string'&&value.length<=1000&&(rootAllowed&&value===''||value.length>0&&!value.startsWith('/')&&value.split('/').length<=64&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part.toLowerCase()!=='.git'&&!/[\\:\x00-\x1f\x7f]/.test(part)));}
function browseScope(request,session){
  if(request.repository!==session.scope.repository||request.ref!==session.scope.ref||request.file!==undefined&&!session.paths.has(request.file))throw Error('Repository request belongs to another workspace.');
  if(request.sha!==undefined&&(typeof request.sha!=='string'||!GIT_SHA.test(request.sha)))throw Error('Invalid repository commit identity.');
  if(request.refresh!==undefined&&typeof request.refresh!=='boolean')throw Error('Invalid repository refresh request.');
}
async function browseGit(session,request){
  const warnings=[];
  if(vscode.workspace.isTrusted!==true)return{repo:null,sha:null,warnings:['Git history is unavailable in Restricted Mode; workspace file inventory remains read-only.']};
  if(session.scope.boundary.scheme!=='file')return{repo:null,sha:null,warnings:['This virtual workspace does not expose native Git history; showing provider file inventory.']};
  let repo=null,gitPath=null;
  try{
    const extension=vscode.extensions?.getExtension('vscode.git');
    if(extension){const exports=extension.isActive?extension.exports:await extension.activate();
      if(vscode.workspace.isTrusted!==true)return{repo:null,sha:null,warnings:['Workspace trust changed; native Git browsing was stopped.']};
      const api=exports.getAPI(1);
      gitPath=api.git?.path;
      const sourceUri=session.history?vscode.Uri.joinPath(session.scope.boundary,...session.scope.rootFile.split('/')):session.uri;
      repo=(api.repositories||[]).filter(item=>item.rootUri?.scheme==='file'&&sameScope(sourceUri,item.rootUri)).sort((a,b)=>b.rootUri.path.length-a.rootUri.path.length)[0]||null;}
  }catch{warnings.push('The VS Code Git provider is unavailable.');}
  if(!repo){warnings.push('No local Git repository is available for this workspace.');return{repo:null,sha:null,warnings};}
  const identity=repo.rootUri.toString();
  if(request.refresh||session.repositoryPin?.root!==identity)session.repositoryPin=null;
  let sha=request.sha||session.history?.sha||session.repositoryPin?.sha||repo.state?.HEAD?.commit;
  if(!GIT_SHA.test(sha||'')){warnings.push('This Git repository has no saved HEAD commit.');return{repo,sha:null,warnings};}
  sha=sha.toLowerCase();
  if(request.sha&&sha!==session.repositoryPin?.sha&&sha!==(repo.state?.HEAD?.commit||'').toLowerCase()){
    if(typeof repo.getCommit!=='function')throw Error('The Git provider cannot verify the requested commit.');
    const commit=await repo.getCommit(sha);if(vscode.workspace.isTrusted!==true)return{repo:null,sha:null,warnings:['Workspace trust changed; native Git browsing was stopped.']};if(commit?.hash?.toLowerCase()!==sha)throw Error('The requested commit is unavailable in this repository.');
  }
  session.repositoryPin={root:identity,sha};return{repo,sha,warnings,gitPath};
}
async function historyContext(session,sha){
  if(session.history)return !sha||sha===session.history.sha?session.history:{...session.history,sha,inventory:null};
  const git=await browseGit(session,{sha});
  if(!git.repo||!git.sha||typeof git.gitPath!=='string'||!git.repo.rootUri.fsPath)throw Error('Saved Git trees require a trusted desktop repository with a configured Git executable. No working files were substituted.');
  if(session.scope.boundary.toString()!==git.repo.rootUri.toString()&&!sameScope(session.scope.boundary,git.repo.rootUri))throw Error('Open the Git repository itself as a workspace folder to browse its saved files. No working files were substituted.');
  const prefix=session.scope.boundary.path.slice(git.repo.rootUri.path.replace(/\/$/,'').length).replace(/^\//,'');
  if(prefix&&!browsePath(prefix))throw Error('Saved workspace scope is invalid.');
  const reader=require('./git-history-tree.js').createGitHistoryReader({gitPath:git.gitPath,rootPath:git.repo.rootUri.fsPath,isTrusted:()=>vscode.workspace.isTrusted===true});
  return{reader,sha:git.sha,prefix,rootPath:git.repo.rootUri.fsPath,rootUri:git.repo.rootUri};
}
async function historicalBytes(session,path,maxBytes=sourceLimit(path)){
  if(!browsePath(path))throw Error('Invalid saved file path.');
  const history=session.history;if(!history)throw Error('Saved revision context is missing.');
  return(await history.reader.read({sha:history.sha,path:history.prefix?history.prefix+'/'+path:path,maxBytes})).bytes;
}
async function historicalInventory(session){
  const history=session.history;if(!history)throw Error('Saved revision context is missing.');
  if(!history.inventory)history.inventory=history.reader.inventory({sha:history.sha,directory:history.prefix}).then(result=>({...result,entries:result.entries.map(e=>({...e,path:history.prefix?e.path.slice(history.prefix.length+1):e.path}))})).catch(error=>{history.inventory=null;throw error;});
  if(vscode.workspace.isTrusted!==true||session.disposed)throw Error('Saved Git browsing requires an active trusted workspace.');return history.inventory;
}
async function loadHistoricalProject(scope,history,budget={files:0,bytes:0}){
  const pending=[scope.rootFile],seen=new Set(),files=[],warnings=[],stub={scope,history};let total=0;
  while(pending.length){const path=pending.shift();if(seen.has(path))continue;if(seen.size>=MAX_FILES||budget.files>=MAX_FILES)throw Error(`Saved project exceeds the ${MAX_FILES}-sheet read limit.`);seen.add(path);const bytes=await historicalBytes(stub,path);budget.files++;budget.bytes+=bytes.byteLength;if((total+=bytes.byteLength)>MAX_PROJECT||budget.bytes>MAX_PROJECT)throw Error(`Saved project exceeds the ${MAX_PROJECT/1048576} MiB source limit.`);const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);files.push({path,content});if(/\.kicad_sch$/i.test(path))for(const name of sheetFiles(content)){const child=childPath(path,name);if(child)pending.push(child);else warnings.push('Excluded an out-of-workspace saved sheet reference.');}}
  return{scope,files,warnings,history};
}
async function openHistoricalFile(request,session){
  browseScope({...request,file:session.scope.rootFile},session);
  if(!GIT_SHA.test(request.sha||'')||!projectPaths.filePath(request.path))throw Error('Select a saved commit and a supported project file.');
  const searchResult=request.searchResult===undefined?null:validateSearchResult(request.searchResult,request.path);
  const history=await historyContext(session,request.sha.toLowerCase()),scope={...session.scope,rootFile:request.path,ref:history.sha};
  const project=await loadHistoricalProject(scope,history),uri=vscode.Uri.joinPath(scope.boundary,...request.path.split('/')).with({query:'kiview-commit='+history.sha});
  const panel=vscode.window.createWebviewPanel(VIEW,'Saved '+request.path.split('/').at(-1)+' · '+history.sha.slice(0,8),vscode.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[session.context.extensionUri]});
  const saved=createSession(uri,project,session.context);saved.closeForPolicy=()=>panel.dispose();saved.post=message=>panel.webview.postMessage(message);
  if(searchResult)saved.initialSearchResult=searchResult;
  const receiver=panel.webview.onDidReceiveMessage(message=>handleMessage(message,saved,reply=>panel.webview.postMessage(reply)));panel.onDidDispose(()=>{saved.disposed=true;liveSessions.delete(saved);receiver.dispose();});
  try{panel.webview.html=await htmlFor(panel.webview,saved.context,saved);}catch(error){saved.disposed=true;liveSessions.delete(saved);panel.dispose();throw error;}
  return{opened:true,sha:history.sha,workingTree:false};
}
function revisionAction(request,session){
  browseScope(request,session);
  if(!GIT_SHA.test(request.sha||'')||!safePath(request.path)||!session.paths.has(request.path))throw Error('Select a full saved commit and a drawing loaded in the current project.');
  if(vscode.workspace.isTrusted!==true||session.disposed||session.scope.boundary.scheme!=='file')throw Error('Revision actions require an active trusted local workspace.');
}
async function currentDrawing(path,session){
  const target=vscode.Uri.joinPath(session.scope.boundary,...path.split('/'));
  const parts=path.split('/');
  for(let i=0;i<parts.length;i++){
    const stat=await workspaceAccess('stat',vscode.Uri.joinPath(session.scope.boundary,...parts.slice(0,i)));
    if(stat.type&vscode.FileType.SymbolicLink)throw Error('Symbolic-link project directories are excluded.');
  }
  const document=(vscode.workspace.textDocuments||[]).find(doc=>doc.uri.toString()===target.toString());
  const stat=await workspaceAccess('stat',target);
  if(stat.type&vscode.FileType.SymbolicLink||!(stat.type&vscode.FileType.File)||stat.size>MAX_FILE)throw Error('Current drawing is not a bounded regular file.');
  let content;
  if(document){content=document.getText();if(new TextEncoder().encode(content).length>MAX_FILE)throw Error('Current drawing exceeds 256 MiB.');}
  else{const bytes=await workspaceAccess('readFile',target);if(bytes.length>MAX_FILE)throw Error('Current drawing exceeds 256 MiB.');content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  return{content,unsaved:!!document?.isDirty};
}
async function compareCurrentRevision(request,session){
  revisionAction(request,session);
  const history=await historyContext(session,request.sha.toLowerCase()),current=await currentDrawing(request.path,session);
  const committed=new TextDecoder('utf-8',{fatal:true}).decode(await historicalBytes({history},request.path));revisionAction(request,session);
  const panel=vscode.window.createWebviewPanel('kicadVisualReview.compare','Current ↔ '+history.sha.slice(0,8)+' · '+request.path.split('/').at(-1),vscode.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[session.context.extensionUri]});
  const view={token:secret(),lastId:0,disposed:false,uri:session.uri,scope:session.scope,closeForPolicy:()=>panel.dispose()};liveSessions.add(view);
  const payload={readOnly:true,path:request.path,current:current.content,incoming:committed,sha:history.sha,unsaved:current.unsaved,canStage:false,git:{current:{label:current.unsaved?'Current working state (unsaved)':'Current working state'},incoming:{hash:history.sha,label:'Selected commit '+history.sha.slice(0,8)}}};
  let delivered=false;
  const receiver=panel.webview.onDidReceiveMessage(async message=>{
    if(view.disposed||message?.channel!==CHANNEL||message.token!==view.token||!Number.isSafeInteger(message.id)||message.id<=view.lastId||message.id>10000)return;
    view.lastId=message.id;let reply;
    try{revisionAction(request,session);if(message.request?.type!=='conflict-load'||Object.keys(message.request).length!==1)throw Error('Commit comparison is read-only.');if(delivered)throw Error('Comparison snapshot was already delivered; reopen it to refresh.');delivered=true;reply={ok:true,result:payload};}catch(error){reply={ok:false,error:String(error.message).slice(0,1000)};}
    if(!view.disposed)await panel.webview.postMessage({channel:CHANNEL,token:view.token,id:message.id,reply});
  });
  panel.onDidDispose(()=>{view.disposed=true;liveSessions.delete(view);receiver.dispose();});
  try{panel.webview.html=await conflictHTML(panel.webview,session.context,view);}catch(error){panel.dispose();throw error;}
  return{opened:true,readOnly:true,sha:history.sha,unsaved:current.unsaved};
}
async function exportRevision(request,session){
  revisionAction(request,session);if(typeof request.copy!=='boolean')throw Error('Select download or independent copy.');
  const history=await historyContext(session,request.sha.toLowerCase());
  const name=request.path.split('/').at(-1).replace(/\.kicad_(sch|pcb)$/i,'')+'-'+history.sha.slice(0,8);
  const destination=await vscode.window.showSaveDialog({title:request.copy?'Create independent committed project folder (choose a new name)':'Download committed project ZIP',saveLabel:request.copy?'Create project folder':'Save ZIP',defaultUri:vscode.Uri.joinPath(history.rootUri||session.scope.boundary,'..',name+(request.copy?'':'.zip')),...(!request.copy?{filters:{'ZIP archive':['zip']}}:{})});
  if(!destination)return{cancelled:true};revisionAction(request,session);
  if(destination.scheme!=='file'||!history.rootPath)throw Error('Choose a local export destination.');
  const result=await require('./revision-export.js').writeExport({history,destination:destination.fsPath,copy:request.copy,sourceRoots:[history.rootPath,session.scope.boundary.fsPath],check:()=>revisionAction(request,session)});
  return{...result,exported:true,copy:request.copy,sha:history.sha,workingTree:false};
}
function browseStatus(repo,boundary){
  const result=new Map(),labels=['modified','added','deleted','renamed','copied','modified','deleted','untracked','ignored','added','renamed','type-changed','conflicted','conflicted','conflicted','conflicted','conflicted','conflicted','conflicted'];
  for(const [key,staged]of [['indexChanges',true],['workingTreeChanges',false],['mergeChanges',false]])for(const item of (repo?.state?.[key]||[]).slice(0,5000)){
    if(!item.uri||!sameScope(item.uri,boundary))continue;
    const path=item.uri.path.slice(boundary.path.replace(/\/$/,'').length+1);if(!browsePath(path))continue;
    const status=key==='mergeChanges'?'conflicted':labels[item.status]||(staged?'staged':'modified');
    const previous=result.get(path);result.set(path,{status,staged:staged||previous?.staged||false});
  }
  return result;
}
async function repositoryTree(request,session){
  browseScope(request,session);
  const lazy=request.directory!==undefined,directory=lazy?request.directory:'';
  if(!browsePath(directory,true))throw Error('Invalid repository directory.');
  const page=request.page===undefined?1:request.page;if(!Number.isSafeInteger(page)||page<1||page>50||!lazy&&page!==1)throw Error('Invalid repository tree page.');
  if(request.sha||session.history){const history=await historyContext(session,request.sha?.toLowerCase()),tree=lazy?await history.reader.tree({sha:history.sha,directory:[history.prefix,directory].filter(Boolean).join('/'),recursive:false,page}):{...await history.reader.inventory({sha:history.sha,directory:history.prefix}),treeRef:history.sha,hasMore:false,nextPage:null,truncated:false};return{...tree,repository:session.scope.repository,ref:session.scope.ref,directory:lazy?directory:null,canOpenHistorical:true,entries:tree.entries.map(e=>({...e,path:history.prefix?e.path.slice(history.prefix.length+1):e.path}))};}
  const git=await browseGit(session,request),warnings=[...git.warnings,'File inventory is the working tree; Git object hashes and file modes are not available from this provider.'],boundary=session.scope.boundary,statuses=browseStatus(git.repo,boundary),entries=new Map();
  let truncated=false;
  const warn=value=>{if(!warnings.includes(value)&&warnings.length<20)warnings.push(value);};
  if(git.repo&&git.repo.rootUri.toString()!==boundary.toString())warn('File inventory is scoped to the open workspace folder; history covers the whole Git repository.');
  const add=(path,type)=>{if(entries.size>=BROWSE_LIMIT){truncated=true;return;}const change=statuses.get(path);entries.set(path,{path,type,sha:null,mode:null,...(change||{})});};
  async function read(directory){
    if(session.disposed)throw Error('Repository view was closed.');
    const parts=directory?directory.split('/'):[];
    for(let i=0;i<=parts.length;i++){
      const uri=vscode.Uri.joinPath(boundary,...parts.slice(0,i));if(i&&!sameScope(uri,boundary))throw Error('Repository directory escapes workspace.');
      const stat=await workspaceAccess("stat",uri);if(stat.type&vscode.FileType.SymbolicLink)throw Error('Symbolic-link repository directories are excluded.');if(!(stat.type&vscode.FileType.Directory))throw Error('Repository path is not a directory.');
    }
    const rows=await workspaceAccess("readDirectory",vscode.Uri.joinPath(boundary,...parts));
    if(!Array.isArray(rows)||rows.length>50000)throw Error('Directory inventory exceeds the provider limit.');
    return rows.filter(row=>Array.isArray(row)&&typeof row[0]==='string').sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  }
  if(typeof vscode.workspace.fs.readDirectory!=='function'){
    warn('This provider cannot enumerate directories; only loaded project files are shown.');
    for(const file of session.files){if(browsePath(file.path)&&(!lazy||file.path.split('/').slice(0,-1).join('/')===directory))add(file.path,'blob');}
  }else{
    const queue=[directory];let visited=0;
    while(queue.length&&entries.size<BROWSE_LIMIT){
      const parent=queue.shift();if(++visited>2000){truncated=true;break;}
      let rows;try{rows=await read(parent);}catch(error){if(lazy||parent==='')throw error;warn('Some repository directories could not be listed.');continue;}
      for(const [name,type]of rows){
        const path=parent?parent+'/'+name:name;
        if(!browsePath(path)||name.includes('/')){if(name!=='.git')warn('Unsafe repository names were excluded.');continue;}
        if(type&vscode.FileType.SymbolicLink){warn('Symbolic-link repository entries were excluded.');continue;}
        if(type&vscode.FileType.Directory){add(path,'tree');if(!lazy)queue.push(path);}
        else if(type&vscode.FileType.File)add(path,'blob');
        if(entries.size>=BROWSE_LIMIT){truncated=true;break;}
      }
      if(lazy)break;
    }
    if(queue.length)truncated=true;
  }
  for(const [path,change]of statuses){if(change.status!=='deleted'||entries.has(path)||lazy&&path.split('/').slice(0,-1).join('/')!==directory)continue;add(path,'blob');}
  const list=[...entries.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),changedDirectories=new Set();
  for(const path of statuses.keys()){const parts=path.split('/');for(let i=1;i<parts.length;i++)changedDirectories.add(parts.slice(0,i).join('/'));}
  for(const item of list)if(item.type==='tree'&&changedDirectories.has(item.path))item.status='modified';
  if(truncated)warn('Inventory is bounded at 10,000 entries / 2,000 directories; open a folder to list it separately.');
  const offset=lazy?(page-1)*BROWSE_PAGE:0,result=lazy?list.slice(offset,offset+BROWSE_PAGE):list,hasMore=lazy&&offset+BROWSE_PAGE<list.length;
  const head=git.repo?.state?.HEAD?.commit,sha=GIT_SHA.test(head||'')?head.toLowerCase():null;
  if(request.sha&&request.sha.toLowerCase()!==sha)warn('Selected historical commit does not change this working-tree inventory; historical file trees are unavailable from this Git provider.');
  return{repository:session.scope.repository,ref:session.scope.ref,sha,treeRef:'HEAD',requestedRef:request.sha||request.ref,workingTree:true,source:'working-tree',entries:result,truncated,warnings,directory:lazy?directory:null,hasMore,nextPage:hasMore?page+1:null};
}
async function repositoryBranches(request,session){
  browseScope(request,session);const git=await browseGit(session,request),warnings=[...git.warnings],branches=[],seen=new Set();
  const add=(name,sha,type)=>{if(typeof name!=='string'||!name||name.length>500||/[\x00-\x1f\x7f]/.test(name)||!GIT_SHA.test(sha||'')||seen.has(name))return;seen.add(name);branches.push({name,sha:sha.toLowerCase(),type,current:name===git.repo?.state?.HEAD?.name});};
  for(const ref of (git.repo?.state?.refs||[]).slice(0,5000))if(ref.type===0||ref.type===1)add(ref.name,ref.commit,ref.type===1?'remote':'branch');
  if(git.repo?.state?.HEAD?.name)add(git.repo.state.HEAD.name,git.repo.state.HEAD.commit,'branch');
  branches.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);const truncated=branches.length>200||(git.repo?.state?.refs?.length||0)>5000;
  if(truncated)warnings.push('Branch inventory is bounded at 200 branches.');
  const selected=branches.slice(0,200),current=branches.find(branch=>branch.current);if(current&&!selected.includes(current)){selected[selected.length-1]=current;selected.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);}
  return{repository:session.scope.repository,ref:session.scope.ref,sha:git.sha,branches:selected,truncated,warnings};
}
async function repositoryHistory(request,session){
  browseScope(request,session);const page=request.page===undefined?1:request.page;
  if(!Number.isSafeInteger(page)||page<1||page>100)throw Error('Invalid repository history page.');
  // A fresh first page follows current HEAD; subsequent pages retain the pin.
  const git=await browseGit(session,{...request,...(page===1&&request.sha===undefined?{refresh:true}:{})}),warnings=[...git.warnings],base={repository:session.scope.repository,ref:session.scope.ref,sha:git.sha};
  if(!git.repo||!git.sha||typeof git.repo.log!=='function')return{...base,commits:[],hasMore:false,nextPage:null,warnings:[...warnings,...(git.repo&&git.sha?['This Git provider does not expose repository history.']:[])]};
  if(vscode.workspace.isTrusted!==true)return{...base,commits:[],hasMore:false,nextPage:null,warnings:[...warnings,'Workspace trust changed; native Git browsing was stopped.']};
  let raw;try{raw=await git.repo.log({maxEntries:31,skip:(page-1)*30,refNames:[git.sha]});}catch{return{...base,commits:[],hasMore:false,nextPage:null,warnings:[...warnings,'Git history could not be read from the selected commit.']};}
  if(vscode.workspace.isTrusted!==true)return{...base,commits:[],hasMore:false,nextPage:null,warnings:[...warnings,'Workspace trust changed; native Git browsing was stopped.']};
  if(session.disposed)throw Error('Repository view was closed.');
  if(!Array.isArray(raw))throw Error('Git provider returned invalid history.');
  const commits=[];
  for(const item of raw.slice(0,30)){
    if(!GIT_SHA.test(item.hash||'')||!Array.isArray(item.parents)||item.parents.some(sha=>!GIT_SHA.test(sha))){warnings.push('An invalid Git commit record was excluded.');continue;}
    const when=item.commitDate||item.authorDate,date=when&&typeof when.toISOString==='function'&&typeof when.getTime==='function'&&Number.isFinite(when.getTime())?when.toISOString():null;
    if(item.parents.length>256)warnings.push('An octopus merge has more than 256 parents; its graph edges are truncated.');
    commits.push({sha:item.hash.toLowerCase(),parents:item.parents.slice(0,256).map(sha=>sha.toLowerCase()),...(item.parents.length>256?{parentsTruncated:true}:{}),message:String(item.message||'').slice(0,4096),author:String(item.authorName||'Unknown author').replace(/[\x00-\x1f\x7f]/g,'').slice(0,200),date});
  }
  const hasMore=raw.length>30&&page<100;if(raw.length>30&&page===100)warnings.push('History is bounded at 3,000 commits.');
  return{...base,commits,hasMore,nextPage:hasMore?page+1:null,warnings:[...new Set(warnings)].slice(0,20)};
}
async function dispatch(request,session) {
  if(!['project','storage-get','storage-set','pair-selection','comments-changed','close-analysis-viewer','workspace-search-ready'].includes(request.type))sourceAccess(session.scope.boundary);
  const state=session.context.workspaceState,key=session.storageKey;
  if(request.type==='repository-fork-revision'){
    revisionAction(request,session);await historyContext(session,request.sha.toLowerCase());revisionAction(request,session);
    return remoteCollaboration.dispatch({...request,file:session.scope.rootFile},session);
  }
  if(session.history){if(vscode.workspace.isTrusted!==true)throw Error('Saved Git browsing requires workspace trust.');if(remoteCollaboration.operations.has(request.type)||['comment-save','comment-delete','open-comment-draft','comments-changed'].includes(request.type))throw Error('Saved commit viewers are read-only; remote publication and workspace annotations are disabled.');if(request.type==='comment-list'){assertScope(request,session);return[];}}
  if(remoteCollaboration.operations.has(request.type))return remoteCollaboration.dispatch(request,session);
  if(request.type==='repository-open-file')return openHistoricalFile(request,session);
  if(request.type==='repository-compare-current')return compareCurrentRevision(request,session);
  if(request.type==='repository-export-revision')return exportRevision(request,session);
  if(request.type==='analysis-focus-net')return focusAnalysisNet(request,session);
  if(request.type==='repository-tree')return repositoryTree(request,session);
  if(request.type==='repository-history')return repositoryHistory(request,session);
  if(request.type==='repository-branches')return repositoryBranches(request,session);
  if(request.type==='open-analysis-viewer')return openAnalysis(request,session);
  if(request.type==='close-analysis-viewer'){
    if(!session.analysisPath||request.repository!==session.scope.repository||request.ref!==session.scope.ref||request.file!==session.analysisPath)throw Error('Report close belongs to another view.');
    session.closeAnalysis();return{closed:true};
  }
  if(['preview-project-html','project-inventory','project-file','open-project-file','open-project-overview'].includes(request.type)){
    if(request.repository!==session.scope.repository||request.ref!==session.scope.ref)throw new Error('Project request belongs to another workspace.');
    if(request.type==='project-inventory')return projectInventory(session);
    if(request.type==='open-project-overview'){assertScope(request,session);return openOverview(session);}
    const path=request.file;const result=await readProjectFile(path,session);
    if(request.type==='project-file')return result;
    if(request.type==='preview-project-html'){if(!/\.html?$/i.test(path))throw Error('HTML preview requires an HTML file.');return openStaticHTML(result.content,path);}
    if(session.history)return openHistoricalFile({...request,path,sha:session.history.sha},session);
    await vscode.commands.executeCommand('vscode.openWith',vscode.Uri.joinPath(session.scope.boundary,...path.split('/')),VIEW,vscode.ViewColumn.Beside);return {opened:true};
  }
  if(request.type==="rule-report") {
    assertScope(request,session);const path=request.reportPath;
    if(typeof path!=='string'||path.length>500||!path.endsWith('.json')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f\x7f]/.test(p)))throw new Error('Invalid workspace report path.');
    if(session.history)return{path,content:new TextDecoder('utf-8',{fatal:true}).decode(await historicalBytes(session,path,4*1024*1024))};
    const uri=vscode.Uri.joinPath(session.scope.boundary,...path.split('/'));if(!sameScope(uri,session.scope.boundary))throw new Error('Report escapes workspace.');
    const parts=path.split('/');for(let i=1;i<=parts.length;i++){const stat=await workspaceAccess("stat",vscode.Uri.joinPath(session.scope.boundary,...parts.slice(0,i)));if(stat.type&vscode.FileType.SymbolicLink)throw new Error('Symbolic-link reports are excluded.');if(i===parts.length&&stat.size>4*1024*1024)throw new Error('Rule report exceeds 4 MiB.');}
    const bytes=await workspaceAccess("readFile",uri);if(bytes.byteLength>4*1024*1024)throw new Error('Rule report exceeds 4 MiB.');return {content:new TextDecoder('utf-8',{fatal:true}).decode(bytes),path};
  }
  if(request.type==="project-search-files")return searchProjectFiles(request,session);
  if(request.type==='workspace-search-ready'){
    assertScope(request,session);if(request.file!==session.scope.rootFile||Object.keys(request).some(key=>!['type','repository','ref','file'].includes(key)))throw Error('Invalid workspace search readiness scope.');
    session.searchReady=true;return{delivered:await deliverSearchTarget(session)};
  }
  if(request.type==="open-project-drawing"){
    assertScope(request,session);if(request.searchResult!==undefined){
      if(Object.keys(request).some(key=>!['type','repository','ref','file','searchResult','provider','host'].includes(key)))throw Error('Invalid drawing open fields.');
      if(request.provider!==undefined&&request.provider!==session.remoteBinding?.provider||request.host!==undefined&&request.host!==session.remoteBinding?.host)throw Error('Drawing search provider does not match this workspace binding.');
    }
    const result=request.searchResult===undefined?null:validateSearchResult(request.searchResult,request.file);
    if(session.history)return openHistoricalFile({...request,...(result?{searchResult:result}:{}),path:request.file,sha:session.history.sha},session);
    const target=vscode.Uri.joinPath(session.scope.boundary,...request.file.split('/'));
    const queued=result?queueSearchTarget(target,session.scope,result):null,key=searchTargetKey(target,session.scope);
    try{await vscode.commands.executeCommand('vscode.openWith',target,VIEW,vscode.ViewColumn.Beside);}
    catch(error){if(queued&&pendingSearchTargets.get(key)===queued)pendingSearchTargets.delete(key);throw error;}
    if(result)for(const other of liveSessions){if(other.context===session.context&&searchTargetKey(other.uri,other.scope)===key&&await deliverSearchTarget(other))break;}
    return {opened:true};
  }
  if(request.type==="repo-model-index")return repoModelIndex(request,session);
  if(request.type==="repo-asset")return loadRepoAsset(request,session);
  if(request.type==="pair-selection")return relaySelection(request.selection,session);
  if(request.type==="comments-changed") {
    let delivered=0;
    for(const other of liveSessions)if(other!==session && other.scope.boundary.toString()===session.scope.boundary.toString() && await notifySession(other,{type:"comments-refresh"}))delivered++;
    return {delivered};
  }
  if(request.type==="project") {assertScope(request,session);if(request.file!==session.scope.rootFile)throw new Error("Only the opened project can be retrieved.");return session.files;}
  if(request.type==="open-comment-draft" || request.type==="github-annotations")
    throw new Error("GitHub publishing and remote annotation retrieval are unavailable in VS Code. Keep local annotations or export them for review; no repository context is configured.");
  if(request.type==="storage-get") {
    if(![session.variantKey,session.preferencesKey].includes(request.key))throw new Error("Storage key is outside this drawing.");
    const stored=state.get(`${key}:${request.key===session.variantKey ? "variant" : "preferences"}`);return stored===undefined ? {} : {[request.key]:clone(stored)};
  }
  if(request.type==="storage-set") {
    if(!request.values || typeof request.values!=="object" || Array.isArray(request.values) ||
      Object.keys(request.values).length!==1)throw new Error("Storage key is outside this drawing.");
    const storageKey=Object.keys(request.values)[0],value=request.values[storageKey];
    if(![session.variantKey,session.preferencesKey].includes(storageKey))throw new Error("Storage key is outside this drawing.");
    if(storageKey===session.preferencesKey && (!value || typeof value!=="object" || Array.isArray(value) ||
      Object.keys(value).some((name)=>!["uiTheme","drawingTheme","rulerUnits","acceleration","showNetNames"].includes(name)) ||
      ("showNetNames" in value && typeof value.showNetNames!=="boolean") || ("acceleration" in value && !["auto","off"].includes(value.acceleration)) ||
      !["dark","light"].includes(value.uiTheme) || !["dark","light"].includes(value.drawingTheme) || !["mm","mil"].includes(value.rulerUnits)))throw new Error("Invalid drawing preferences.");
    await state.update(`${key}:${storageKey===session.variantKey ? "variant" : "preferences"}`,clone(value));return null;
  }
  if(request.type==="comment-list") {
    assertScope(request,session);const snapshot=await readSidecar(session);session.sidecarBytes=snapshot.bytes;
    return snapshot.data.annotations.filter((n)=>n.anchor.file===request.file);
  }
  const snapshot=await annotationSnapshot(session),notes=snapshot.data.annotations;
  if(request.type==="comment-save") {
    const note=validateComment(request.comment,null,session),scope=note.anchor;
    if(!session.paths.has(scope.file))throw new Error("Annotation belongs to another drawing.");
    if(notes.filter((n)=>n.id===note.id&&n.anchor.file===scope.file).length>1)throw new Error("Annotation identity is ambiguous across saved provenance; no changes were written.");
    const existing=notes.findIndex((n)=>n.id===note.id && n.anchor.file===scope.file);
    if(existing>=0) {
      const previous=notes[existing];
      if(previous.anchor.repository!==scope.repository || previous.anchor.ref!==scope.ref)throw new Error("Existing annotation provenance cannot be rebound.");
      if(request.expectedUpdatedAt!==undefined && request.expectedUpdatedAt!==previous.updatedAt)throw new Error("Annotation was edited elsewhere; reload annotations before retrying.");
      note.createdAt=previous.createdAt;note.updatedAt=new Date(Math.max(Date.now(),Date.parse(previous.updatedAt)+1)).toISOString();notes[existing]=note;
    } else {assertScope(scope,session);if(notes.length>=1000 || notes.filter((n)=>n.anchor.file===scope.file).length>=100)throw new Error("Local annotation limit reached.");notes.push(note);}
    await writeSidecar(session,snapshot,{schemaVersion:1,annotations:notes});return note;
  }
  assertScope(request,session);
  if(request.type==="comment-delete") {
    if(typeof request.id!=="string" || !/^[A-Za-z0-9_-]{1,100}$/.test(request.id))throw new Error("Invalid annotation ID.");
    if(notes.filter((n)=>n.id===request.id&&n.anchor.file===request.file).length>1)throw new Error("Annotation identity is ambiguous across saved provenance; no changes were written.");
    await writeSidecar(session,snapshot,{schemaVersion:1,annotations:notes.filter((n)=>!(n.id===request.id&&n.anchor.file===request.file))});return null;
  }
  throw new Error("Unsupported viewer operation.");
}
function handleMessage(message,session,post) {
  if(session.disposed || !message || message.channel!==CHANNEL || message.token!==session.token ||
    !Number.isSafeInteger(message.id) || message.id<=session.lastId || message.id>10000)return Promise.resolve(false);
  session.lastId=message.id;
  let request=message.request,requestBytes;
  try {
    if(!request || !OPERATIONS.has(request.type) || (requestBytes=new TextEncoder().encode(JSON.stringify(request)).length)>MAX_MESSAGE)throw new Error("Invalid or oversized viewer request.");
    if(pendingMessages>=MAX_PENDING_MESSAGES || pendingMessageBytes+requestBytes>MAX_PENDING_MESSAGE_BYTES)throw new Error("Viewer pending request budget exceeded; wait for current work to finish.");
  }
  catch(error){return Promise.resolve(post({channel:CHANNEL,token:session.token,id:message.id,reply:{ok:false,error:error.message}}));}
  pendingMessages++;pendingMessageBytes+=requestBytes;
  // Serialize persisted updates and reads, including multiple editors of one URI.
  const run=async()=> {
    if(session.disposed)return false;
    let reply;
    try {reply={ok:true,result:await dispatch(request,session)};}catch(error){reply={ok:false,error:String(error.message || error).slice(0,1000)};}
    if(!session.disposed)await post({channel:CHANNEL,token:session.token,id:message.id,reply});return true;
  };
  const result=storageQueue.then(run,run).finally(()=>{pendingMessages--;pendingMessageBytes-=requestBytes;});storageQueue=result.catch(()=>{});return result;
}
async function htmlFor(webview,context,session) {
  const media=vscode.Uri.joinPath(context.extensionUri,"media"),templateUri=vscode.Uri.joinPath(media,session.analysisPath?"analysis-viewer.html":session.overview||!safePath(session.scope.rootFile)?"project-viewer.html":"revision-viewer.html");
  let html=new TextDecoder().decode(await vscode.workspace.fs.readFile(templateUri));
  const nonce=secret(),resource=(name)=>webview.asWebviewUri(vscode.Uri.joinPath(media,...name.split("/"))).toString();
  const collaboration=session.history?null:await remoteCollaboration.publicContext(session);
  const searchResult=session.initialSearchResult||(!session.analysisPath&&!session.overview?takeSearchTarget(session):null);delete session.initialSearchResult;
  const contextData={...(collaboration?{collaboration}:{}),...(searchResult?{searchResult}:{}),drawingFile:session.scope.rootFile,historical:!!session.history,canOpenHistorical:true,token:session.token,loadWorkerUrl:resource("load-worker-vscode.js"),fastPIWorkerUrl:resource("fast-pi-worker-vscode.js"),stepWorkerUrl:resource("step-worker-vscode.js"),stepWasmUrl:resource("vendor/occt/occt-import-js.wasm"),search:new URLSearchParams({repository:session.scope.repository,ref:session.scope.ref,file:session.analysisPath||session.scope.rootFile,...(session.analysisResultView?{resultView:session.analysisResultView}:{})}).toString()};
  const bootstrap=JSON.stringify(contextData).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  const csp=`default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob: ${collaboration?(collaboration.provider==='github'?'https://github.com/user-attachments/':collaboration.host+'/'+collaboration.repository+'/uploads/ '+collaboration.host+'/-/project/') : ''}; font-src ${webview.cspSource}; connect-src ${resource('load-worker-vscode.js')} ${resource('fast-pi-worker-vscode.js')} ${resource('step-worker-vscode.js')} ${resource('vendor/occt/occt-import-js.wasm')}; worker-src blob:; base-uri ${webview.cspSource}; frame-src ${resource('terms.html')};`;
  html=html.replace(/(src|href)="([^"#:]+)"/g,(match,attr,name)=>`${attr}="${escaped(resource(name))}"`);
  html=html.replace("<head>",`<head><meta http-equiv="Content-Security-Policy" content="${escaped(csp)}"><base href="${escaped(resource(""))}/"><script nonce="${nonce}">globalThis.KiCadVSCodeContext=${bootstrap};</script><script nonce="${nonce}" src="${escaped(webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,"webview-bridge.js")).toString())}"></script>`);
  if(collaboration)html=html.replace("<head>","<head><style>.github-draft-action{display:none!important}</style>");
  if(!collaboration){
  html=html.replace(/(<section id="commentsPane"[^>]*>\s*<h2>[^<]*<\/h2>\s*<p class="hint">)[\s\S]*?(<\/p>)/,"$1Annotations are stored in the workspace Git-trackable .kicad-review.json. GitHub publishing and remote annotations are unavailable here; export notes to share them. Read status belongs to this VS Code webview user.$2");
  html=html.replace("<head>","<head><style>.github-comment-controls>label:not(:last-of-type),#loadCategories,#reviewSettings,#refreshGitHub,#refreshCommentPolicy,#commentPolicyStatus,.github-draft-action,.github-publish-action{display:none!important}</style>");
  }
  if(session.history)html=html.replace('<head>','<head><style>.github-comment-controls,.github-comment-actions,#commentForm{display:none!important}</style>').replace('Annotations are stored in the workspace Git-trackable .kicad-review.json. GitHub publishing and remote annotations are unavailable here; export notes to share them. Read status belongs to this VS Code webview user.','Saved commit '+escaped(session.history.sha)+'. This viewer is read-only; workspace annotations and remote publication are disabled.');
  return html;
}
async function conflictHTML(webview,context,session) {
  const media=vscode.Uri.joinPath(context.extensionUri,"media");
  let html=new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(media,"conflict-viewer.html")));
  const nonce=secret(),resource=name=>webview.asWebviewUri(vscode.Uri.joinPath(media,...name.split("/"))).toString();
  const csp=`default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; base-uri ${webview.cspSource}; frame-src 'none';`;
  html=html.replace(/(src|href)="([^"#:]+)"/g,(match,attr,name)=>`${attr}="${escaped(resource(name))}"`);
  const bootstrap=JSON.stringify({token:session.token}).replace(/</g,"\\u003c");
  return html.replace("<head>",`<head><meta http-equiv="Content-Security-Policy" content="${escaped(csp)}"><base href="${escaped(resource(""))}/"><script nonce="${nonce}">globalThis.KiCadVSCodeContext=${bootstrap};</script><script nonce="${nonce}" src="${escaped(webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,"webview-bridge.js")).toString())}"></script>`);
}
function activate(context) {
  if(vscode.workspace.onDidChangeConfiguration)context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{
    if(!event.affectsConfiguration('kicadVisualReview')||deploymentPolicy(vscode).networkAccess)return;
    // Existing webviews can have remote attachment origins in their CSP. Tear
    // those documents down so disabling networking also stops renderer egress.
    for(const session of [...liveSessions])if((session.remoteBinding||session.uri.scheme!=='file')&&session.closeForPolicy){session.disposed=true;session.closeForPolicy();}
  }));
  const conflicts=require("./conflict-host.js").createHost(vscode,require("./media/merge-conflicts.js"),{projectScope,sameScope,secret,conflictHTML,sourceAccess});
  const navigatorChanged=new vscode.EventEmitter();
  context.subscriptions.push(navigatorChanged,vscode.window.registerTreeDataProvider("kicadVisualReview.navigator",{
    onDidChangeTreeData:navigatorChanged.event,getTreeItem:(item)=>item,
    async getChildren() {
      const drawings=await findSourceFiles("**/*.{kicad_sch,kicad_pcb,kicad_pro,kicad_prl,kicad_dru,kicad_wks,gbr,ger,gerber,gtl,gbl,gts,gbs,gto,gbo,gtp,gbp,gko,gm1,drl,xln,html,htm}","**/{.git,node_modules,__pycache__}/**",200);
      const result=drawings.sort((a,b)=>a.path.localeCompare(b.path)).map((uri)=>({label:uri.path.split("/").at(-1),
        description:vscode.workspace.asRelativePath(uri,false),resourceUri:uri,command:{command:"kicadVisualReview.open",title:"Open drawing",arguments:[uri]}}));
      for(const folder of (vscode.workspace.workspaceFolders || []).slice(0,32)) {
        if(folder.uri.scheme!=='file'&&!deploymentPolicy(vscode).networkAccess)continue;
        const uri=vscode.Uri.joinPath(folder.uri,".kicad-review.json");
        try {await workspaceAccess("stat",uri);result.push({label:"Review annotations",description:folder.name,resourceUri:uri,command:{command:"vscode.open",title:"Open sidecar",arguments:[uri]}});}catch(error){if(!["FileNotFound","EntryNotFound"].includes(error.code))throw error;}
      }
      return result;
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand("kicadVisualReview.refreshNavigator",()=>navigatorChanged.fire()));
  const activeUri=(uri)=>uri || vscode.window.activeTextEditor?.document.uri || vscode.window.tabGroups?.activeTabGroup?.activeTab?.input?.uri;
  context.subscriptions.push(vscode.commands.registerCommand("kicadVisualReview.resolveConflicts",async(uri)=>{
    const target=activeUri(uri);try {if(!target)throw new Error("Select a saved schematic or PCB.");await conflicts.open(target,context);}catch(error){vscode.window.showErrorMessage(error.message);}
  }));
  const provider={
    async openCustomDocument(uri){return {uri,dispose(){}};},
    async resolveCustomEditor(document,panel,cancel) {
      panel.webview.options={enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,"media"),context.extensionUri]};
      try {
        const project=await loadProject(document.uri,projectScope(document.uri),cancel),session=createSession(document.uri,project,context);
        session.closeForPolicy=()=>panel.dispose();session.post=(message)=>panel.webview.postMessage(message);
        const receiver=panel.webview.onDidReceiveMessage((message)=>handleMessage(message,session,(reply)=>panel.webview.postMessage(reply)));
        panel.onDidDispose(()=>{session.disposed=true;liveSessions.delete(session);receiver.dispose();if(![...liveSessions].some((other)=>other.uri.toString()===session.uri.toString()))unpair(session.uri);});
        panel.webview.html=await htmlFor(panel.webview,context,session);
        if(project.warnings.length)vscode.window.showWarningMessage(project.warnings.join(" ").slice(0,2000));
      } catch(error) {
        if(/Unresolved Git merge conflict/.test(error.message||""))try {await conflicts.open(document.uri,context,panel);return;}catch(conflictError){error=conflictError;}
        panel.webview.html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body><h2>KiCad drawing could not be opened</h2><p>${escaped(error.message || error)}</p><p>For a source-file error, use Reopen Editor With → Text Editor to inspect the saved file. If a packaged viewer resource is missing, reinstall the latest VSIX. Source files have not been changed.</p></body></html>`;}
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW,provider,{supportsMultipleEditorsPerDocument:true,webviewOptions:{retainContextWhenHidden:true}}));
  context.subscriptions.push(vscode.commands.registerCommand("kicadVisualReview.open",async(uri)=> {
    const target=activeUri(uri);
    if(!supportedViewerUri(target)) {vscode.window.showErrorMessage("Select a saved KiCad project, drawing, settings or Gerber file.");return;}
    await vscode.commands.executeCommand("vscode.openWith",target,VIEW);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("kicadVisualReview.openPair",async(uri)=> {
    const target=activeUri(uri);
    if(!supportedViewerUri(target)){vscode.window.showErrorMessage("Select a saved schematic or PCB to pair.");return;}
    try {
      const scope=projectScope(target),directory=target.path.slice(0,target.path.lastIndexOf("/")),opposite=/\.kicad_sch$/i.test(target.path)?"pcb":"sch";
      const found=await findSourceFiles(`**/*.kicad_${opposite}`,"**/{.git,node_modules,__pycache__}/**",200);
      const items=found.filter((candidate)=>sameScope(candidate,scope.boundary) && candidate.path.slice(0,candidate.path.lastIndexOf("/"))===directory &&
        new RegExp(`\\.kicad_${opposite}$`,"i").test(candidate.path) && safePath(candidate.path.slice(scope.boundary.path.replace(/\/$/,"").length+1)))
        .sort((a,b)=>a.path.localeCompare(b.path)).map((candidate)=>({label:candidate.path.split("/").at(-1),description:vscode.workspace.asRelativePath(candidate,false),uri:candidate}));
      if(!items.length){vscode.window.showInformationMessage("No opposite-kind KiCad drawing was found in the same folder.");return;}
      const choice=await vscode.window.showQuickPick(items,{placeHolder:"Choose the drawing to review beside this file",matchOnDescription:true});
      if(!choice || !items.includes(choice))return;
      // Validate saved files and their provider boundaries before establishing a pair.
      await loadProject(target,scope);await loadProject(choice.uri,projectScope(choice.uri));
      unpair(target);unpair(choice.uri);
      try {await vscode.commands.executeCommand("vscode.openWith",target,VIEW);await vscode.commands.executeCommand("vscode.openWith",choice.uri,VIEW,vscode.ViewColumn.Beside);
        pairTargets.set(target.toString(),choice.uri.toString());pairTargets.set(choice.uri.toString(),target.toString());}
      catch(error){unpair(target);throw error;}
    } catch(error){vscode.window.showErrorMessage(`Could not open paired review: ${error.message || error}`);}
  }));
  context.subscriptions.push(vscode.commands.registerCommand("kicadVisualReview.openSidecar",async(uri)=> {
    const target=activeUri(uri);if(!target){vscode.window.showErrorMessage("Open a KiCad drawing to identify its annotation workspace.");return;}
    const scope=projectScope(target);await vscode.commands.executeCommand("vscode.open",vscode.Uri.joinPath(scope.boundary,".kicad-review.json"));
  }));
  context.subscriptions.push(vscode.commands.registerCommand("kicadVisualReview.importLegacyNotes",async(uri)=> {
    const target=activeUri(uri);if(!target){vscode.window.showErrorMessage("Open a KiCad drawing to import its previous workspace notes.");return;}
    const run=async()=> {
      const project=await loadProject(target),session=createSession(target,project,context);
      try {
        const legacy=context.workspaceState.get(`${session.storageKey}:comments`,[]);
        if(!Array.isArray(legacy) || legacy.length>1000)throw new Error("Previous workspace notes are invalid or oversized.");
        const before=await readSidecar(session),notes=before.data.annotations;let count=0;
        for(const original of legacy) {
          if(original.anchor?.repository!==identity(session.scope.boundary) || original.anchor?.ref!=="workspace" || !session.paths.has(original.anchor?.file))
            throw new Error("Previous note provenance does not match this workspace; import was cancelled.");
          const note=validateComment({...original,anchor:{...original.anchor,repository:session.scope.repository}},session);
          if(notes.some((n)=>n.id===note.id&&n.anchor.file===note.anchor.file))continue;
          notes.push(note);count++;
        }
        if(count)await writeSidecar(session,before,{schemaVersion:1,annotations:notes});
        navigatorChanged.fire();vscode.window.showInformationMessage(`Imported ${count} previous notes into .kicad-review.json. Original workspace drafts were retained.`);
      } finally {liveSessions.delete(session);}
    };
    const result=storageQueue.then(run,run);storageQueue=result.catch(()=>{});try {await result;}catch(error){vscode.window.showErrorMessage(error.message);}
  }));
}
function deactivate() {pairTargets.clear();}
module.exports={activate,deactivate,_test:{remoteCollaboration,projectScope,sameScope,childPath,loadProject,createSession,handleMessage,htmlFor,conflictHTML,staticHTML,validateSidecar,readSidecar,writeSidecar,validateSearchResult,pruneSearchTargets,pendingSearchTargets,CHANNEL,MAX_FILE,MAX_PROJECT}};
