"use strict";

// Pure validation and interchange helpers. Nothing here posts to GitHub.
const KiCadReviewComments = (() => {
  const severityOptions=Object.freeze([
    {value:'info',label:'Info',color:'#69bbdd',symbol:'🔵'},
    {value:'level-1',label:'Level 1',color:'#4fc08d',symbol:'🟢'},
    {value:'minor',label:'Minor',color:'#d4c64f',symbol:'🟡'},
    {value:'major',label:'Major',color:'#ed9b49',symbol:'🟠'},
    {value:'critical',label:'Critical',color:'#e65b69',symbol:'🔴'}
  ].map(Object.freeze));
  const isSeverity=value=>severityOptions.some(item=>item.value===value);
  const severityInfo=value=>severityOptions.find(item=>item.value===value)||severityOptions[0];
  const stateOptions=Object.freeze([
    {value:'open',label:'Open',color:'#42ae72',symbol:'🟢'},
    {value:'closed',label:'Closed',color:'#aa79d4',symbol:'🟣'},
    {value:'skipped',label:'Skipped',color:'#c7ab36',symbol:'🟡'},
    {value:'resolved',label:'Resolved',color:'#aa79d4',symbol:'🟣'},
    {value:'wont-fix',label:'Won’t fix',color:'#9099a6',symbol:'⚪'}
  ].map(Object.freeze));
  const isState=value=>stateOptions.some(item=>item.value===value);
  const stateInfo=value=>stateOptions.find(item=>item.value===value)||stateOptions[0];
  const issueState=value=>value==='opened'?'open':['open','closed'].includes(value)?value:null;
  function effectiveState(note,states){
    if(note?.state==='skipped')return 'skipped';
    const linked=states===undefined?[issueState(note?.github?.state)]:states.map(issueState);
    if(linked.includes('open'))return 'open';
    if(linked.length&&linked.every(value=>value==='closed'))return 'closed';
    return isState(note?.state)?note.state:'open';
  }
  function stateMatches(filter,state,saved=state){if(filter==='all')return true;if(filter==='closed')return ['closed','resolved','wont-fix'].includes(state);if(['resolved','wont-fix'].includes(filter))return saved===filter;return state===filter;}
  function threadLinks(note){
    const links=new Map(),entries=[...(note?.remoteRefs||[]),...(note?.github?[{...note.github,provider:note.github.provider||note.anchor?.provider||'github'}]:[])];
    for(const value of entries.slice(0,21)){try{const url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password||url.search)continue;
      const provider=value.provider||'github';let match,repository,kind,number;
      if(provider==='github'){if(url.origin!=='https://github.com')continue;match=/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(issues|discussions|pull)\/([1-9]\d*)$/.exec(url.pathname);if(!match)continue;repository=match[1];kind=match[2]==='discussions'?'discussion':'issue';number=Number(match[3]);}
      else if(provider==='gitlab'){match=/^\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\/-\/issues\/([1-9]\d*)$/.exec(url.pathname);if(!match)continue;repository=match[1];kind='issue';number=Number(match[2]);if(value.host&&new URL(value.host).origin!==url.origin)continue;}
      else continue;
      if(repository.split('/').some(part=>part==='.'||part==='..')||!Number.isSafeInteger(number)||number!==value.number||value.repository&&value.repository!==repository)continue;
      const link={provider,host:url.origin,repository,kind,number};links.set(threadKey(link),link);
    }catch{}}
    return [...links.values()];
  }
  function threadKey(link){return JSON.stringify([link.provider||'github',link.host||'https://github.com',(link.provider||'github')==='github'?String(link.repository).toLowerCase():link.repository,link.kind,link.number]);}
  function createThreadStateCache(){const values=new Map();return{
    remember(scope,thread){const state=issueState(thread?.state),updated=Date.parse(thread?.updatedAt);if(!state||!Number.isFinite(updated)||!['issue','discussion'].includes(thread?.kind)||!Number.isSafeInteger(thread.number)||thread.number<1)return false;const key=threadKey({...scope,kind:scope.provider==='gitlab'?'issue':thread.kind,number:thread.number}),old=values.get(key);if(old&&(old.updated>updated||old.updated===updated&&old.state!==state))return false;values.delete(key);values.set(key,{state,updated});if(values.size>500)values.delete(values.keys().next().value);return true;},
    states(note){const links=threadLinks(note);if(!links.length)return undefined;const meta=new Set(threadLinks({...note,remoteRefs:[]}).map(threadKey));return links.map(link=>values.get(threadKey(link))?.state||(note.github&&meta.has(threadKey(link))?issueState(note.github.state):null));},
    clear(){values.clear();}
  };}
  function mergeAnnotations(local=[],remote=[]){const values=new Map();for(const note of [...local,...remote]){const a=note?.anchor;if(!a)continue;const key=JSON.stringify([a.provider||'github',a.host||'https://github.com',a.repository,a.ref,a.file,note.id]),old=values.get(key);if(!old){values.set(key,note);continue;}const latest=Date.parse(note.updatedAt||note.createdAt)>Date.parse(old.updatedAt||old.createdAt)?note:old;values.set(key,{...latest,...(note.github||old.github?{github:note.github||old.github}:{}),remoteRefs:old.remoteRefs?.length?old.remoteRefs:note.remoteRefs||[]});}return [...values.values()];}
  // All bound views share the existing publication lock; binding is validation context only.
  const publicationReservations = new Map();
  function create(binding = null) {
  const FORMAT = "kicad-visual-review-comments";
  const MAX_IMPORT = 1024 * 1024;
  const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const REF = /^[A-Za-z0-9._/-]{1,200}$/;
  const ID = /^[A-Za-z0-9_-]{1,100}$/;
  const PATH = /^[^\\\x00-\x1f\x7f]+\.kicad_(?:sch|pcb)$/i;
  const SEVERITIES = new Set(severityOptions.map(item=>item.value));
  const STATES = new Set(stateOptions.map(item=>item.value));
  const MENTION = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const MARKER = /<!-- kicad-review:v1 ([A-Za-z0-9_-]{1,32000}) -->/g;
  const optional = (value, name, limit) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error(`Invalid comment ${name}.`);
    }
    return value.trim();
  };
  function gitlabHost(value = 'https://gitlab.com') {
    let url;try { url = new URL(value); } catch { throw new Error('Invalid GitLab host.'); }
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||/[\s\\]/.test(value))throw new Error('Invalid GitLab host.');
    return url.origin;
  }
  function validateAttachment(value) {
    if(value?.provider==='gitlab'){
      const host=gitlabHost(value.host),repository=value.repository;
      if(value.mime!=='image/png'||typeof repository!=='string'||!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(repository)||repository.split('/').some(p=>p==='.'||p==='..')||!Number.isSafeInteger(value.projectId)||value.projectId<=0||![value.width,value.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1024))throw new Error('Invalid GitLab screenshot attachment.');
      let url;try{url=new URL(value.url);}catch{throw new Error('Invalid GitLab screenshot attachment URL.');}
      const tail='/uploads/[a-f0-9]{32}/kicad-review-[a-f0-9]{20}\\.png';
      const prefixes=[`/-/project/${value.projectId}`,`/${repository}`];
      if(url.origin!==host||url.username||url.password||url.search||url.hash||!prefixes.some(prefix=>url.pathname.startsWith(prefix)&&new RegExp('^'+tail+'$').test(url.pathname.slice(prefix.length))))throw new Error('Invalid GitLab screenshot attachment URL.');
      return {provider:'gitlab',host,repository,projectId:value.projectId,mime:'image/png',url:url.href,width:value.width,height:value.height};
    }
    if (!value || value.provider !== 'github' || value.mime !== 'image/png' ||
        typeof value.repository !== 'string' || !REPOSITORY.test(value.repository) ||
        value.repository.split('/').some(part => part === '.' || part === '..') ||
        ![value.width,value.height].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 1024)) {
      throw new Error('Invalid GitHub screenshot attachment.');
    }
    if (typeof value.url !== 'string' || !/^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.url)) {
      throw new Error('Invalid GitHub screenshot attachment URL.');
    }
    return {provider:'github', repository:value.repository, mime:'image/png',url:value.url,width:value.width,height:value.height};
  }
  function normalizeScope(value) {
    if (!value || typeof value !== "object") throw new Error("Invalid comment file scope.");
    const { repository, ref, file } = value;const provider=value.provider||'github';if(!['github','gitlab'].includes(provider))throw new Error('Invalid comment provider.');
    if (typeof repository !== "string" || !(provider==='gitlab'?/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/:REPOSITORY).test(repository) || repository.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Invalid comment repository.");
    }
    if (typeof ref !== "string" || !REF.test(ref) || ref.startsWith("/") || ref.endsWith("/") ||
        ref.split("/").some((part) => part === "." || part === "..") || ref.includes("..")) {
      throw new Error("Invalid comment revision.");
    }
    if (typeof file !== "string" || file.length > 500 || !PATH.test(file) || file.startsWith("/") ||
        file.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("Invalid KiCad comment file.");
    }
    return { repository, ref, file,...(provider==='gitlab'?{provider,host:gitlabHost(value.host)}: {}) };
  }
  function sourceSheetUuid(source){
    if(typeof source!=='string'||!/^\s*\(kicad_sch(?:\s|\))/.test(source))return null;
    try{const parser=globalThis.KiCadDesignDiff?.parse||(typeof module==='object'&&module.exports?require('./design-diff.js').parse:null);if(!parser)return null;const tree=parser(source),field=tree.find(value=>Array.isArray(value)&&value[0]==='uuid'),value=field?.[1],uuid=typeof value==='string'?value:value?.quoted;return typeof uuid==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)?uuid:null;}catch{return null;}
  }
  function normalizeAnchor(anchor) {
    const result = normalizeScope(anchor);
    if(anchor.side!==undefined){if(!['front','back'].includes(anchor.side))throw new Error('Invalid comment board side.');result.side=anchor.side;}
    for (const [name, limit] of [["uuid", 200], ["objectId", 200], ["reference", 100], ["netName", 500], ["kind", 80], ["variant", 100], ["sheetUuid", 200], ["sheetName", 500], ["instancePath", 2000]]) {
      const value = optional(anchor[name], name, limit);
      if (value !== undefined) result[name] = value;
    }
    if(anchor.reviewTarget!==undefined){
      const target=anchor.reviewTarget;
      if(!target||!['property','bom'].includes(target.surface)||typeof target.field!=='string'||!target.field.trim()||target.field.length>200||/[\x00-\x1f\x7f]/.test(target.field)||typeof target.value!=='string'||target.value.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(target.value))throw new Error('Invalid property or BoM comment target.');
      const references=target.references;
      if(references!==undefined&&(!Array.isArray(references)||references.length>100||references.some(r=>typeof r!=='string'||!r.trim()||r.length>100||/[\x00-\x1f\x7f]/.test(r))))throw new Error('Invalid BoM comment references.');
      result.reviewTarget={surface:target.surface,field:target.field,value:target.value,...(references?{references:[...new Set(references)]}:{})};
    }
    if (anchor.position !== undefined && anchor.position !== null) {
      const { x, y } = anchor.position;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) {
        throw new Error("Invalid comment position.");
      }
      result.position = { x, y };
    }
    if(anchor.area!==undefined){const {x,y,width,height}=anchor.area||{};if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0||width>1e6||height>1e6||[x,y,x+width,y+height].some(n=>Math.abs(n)>1e6))throw new Error('Invalid comment area.');result.area={x,y,width,height};}
    return result;
  }
  function forWorkspace(localScope, remoteScope) {
    const local=normalizeScope(localScope),remote=normalizeScope(remoteScope);
    if(local.repository!=='local/workspace'||localScope.provider!==undefined||localScope.host!==undefined||remote.provider!=='gitlab')throw new Error('Invalid workspace collaboration binding.');
    return create(Object.freeze({local:Object.freeze({...local}),remote:Object.freeze({...remote})}));
  }
  function collaborationScope(anchor) {
    const scope=normalizeScope(anchor);
    if(binding&&anchor.provider===undefined&&anchor.host===undefined&&scope.repository===binding.local.repository&&scope.ref===binding.local.ref)return binding.remote;
    return scope;
  }
  function validateComment(comment) {
    if (!comment || typeof comment !== "object") throw new Error("Invalid review comment.");
    if (typeof comment.id !== "string" || !ID.test(comment.id)) throw new Error("Invalid comment id.");
    if (typeof comment.text !== "string" || !comment.text.trim() || comment.text.length > 4000) {
      throw new Error("Comment text must contain 1–4,000 characters.");
    }
    if (typeof comment.createdAt !== "string" || comment.createdAt.length > 40 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(comment.createdAt) ||
        !Number.isFinite(Date.parse(comment.createdAt)) ||
        new Date(comment.createdAt).toISOString().slice(0, 19) !== comment.createdAt.slice(0, 19)) {
      throw new Error("Invalid comment creation time.");
    }
    const severity = comment.severity ?? "info";
    if (!SEVERITIES.has(severity)) throw new Error("Invalid comment severity.");
    const threadType=comment.threadType;
    if(threadType!==undefined&&!["issue","discussion"].includes(threadType))throw new Error("Invalid review thread type.");
    const state=comment.state??"open";
    if (!STATES.has(state)) throw new Error("Invalid annotation state.");
    const tags=comment.tags??[];
    if(!Array.isArray(tags)||tags.length>20||tags.some(tag=>typeof tag!=="string"||!tag.trim()||tag.length>40||/[\x00-\x1f\x7f]/.test(tag)))throw new Error("Invalid annotation tags.");
    const updatedAt=comment.updatedAt??comment.createdAt;
    if(typeof updatedAt!=="string"||updatedAt.length>40||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(updatedAt)||!Number.isFinite(Date.parse(updatedAt))||new Date(updatedAt).toISOString().slice(0,19)!==updatedAt.slice(0,19))throw new Error("Invalid annotation update time.");
    if (Date.parse(updatedAt) < Date.parse(comment.createdAt)) throw new Error("Comment update time precedes creation time.");
    const collaboration=collaborationScope(comment.anchor);
    const inputMentions = comment.mentions ?? [];
    if (!Array.isArray(inputMentions) || inputMentions.length > 20) throw new Error("Invalid annotation mentions.");
    const mentions = [];
    const mentionKeys = new Set();
    for (const raw of inputMentions) {
      if (typeof raw !== "string") throw new Error("Invalid annotation mention.");
      const login = raw.startsWith("@") ? raw.slice(1) : raw;
      if (!(collaboration.provider==='gitlab'?/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/:MENTION).test(login)) throw new Error("Invalid annotation mention.");
      const key = login.toLowerCase();
      if (!mentionKeys.has(key)) { mentions.push(login); mentionKeys.add(key); }
    }
    const remoteRefs=comment.remoteRefs??[];
    if(!Array.isArray(remoteRefs)||remoteRefs.length>20)throw new Error("Too many GitHub references.");
    const refs=remoteRefs.map(remote=>{
      if (remote?.provider === 'gitlab') {
        const host=gitlabHost(remote.host),anchor=collaboration;
        if(anchor.provider!=='gitlab'||anchor.host!==host||remote.repository!==anchor.repository||!['issue','discussion'].includes(remote.kind)||!Number.isSafeInteger(remote.number)||remote.number<1)throw new Error('Invalid GitLab annotation reference.');
        let url;try{url=new URL(remote.url);}catch{throw new Error('Invalid GitLab reference URL.');}
        if(url.origin!==host||url.username||url.password||url.search||url.pathname!==`/${remote.repository}/-/issues/${remote.number}`||(url.hash&&!/^#note_[0-9]+$/.test(url.hash)))throw new Error('Invalid GitLab reference URL.');
        if(typeof remote.publishedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(remote.publishedAt)||!Number.isFinite(Date.parse(remote.publishedAt)))throw new Error('Invalid GitLab publication time.');
        return {provider:'gitlab',host,kind:remote.kind,repository:remote.repository,number:remote.number,url:url.href,publishedAt:remote.publishedAt};
      }
      if(collaboration.provider==='gitlab')throw new Error('GitHub thread references cannot be attached to GitLab notes.');
      if(!remote||!["issue","discussion","pull-request"].includes(remote.kind)||typeof remote.repository!=="string"||!REPOSITORY.test(remote.repository)||remote.repository.split("/").some(p=>p==="."||p==="..")||!Number.isSafeInteger(remote.number)||remote.number<1)throw new Error("Invalid GitHub annotation reference.");
      let url;try{url=new URL(remote.url);}catch{throw new Error("Invalid GitHub reference URL.");}
      const section={issue:'issues',discussion:'discussions','pull-request':'pull'}[remote.kind];
      const validHash=remote.kind==='pull-request'?/^#(?:issuecomment-|discussion_r|pullrequestreview-)[0-9]+$/:/^#(?:issuecomment|discussioncomment)-[0-9]+$/;
      if(url.origin!=="https://github.com"||url.username||url.password||url.search||url.pathname!==`/${remote.repository}/${section}/${remote.number}`||(url.hash&&!validHash.test(url.hash)))throw new Error("Invalid GitHub reference URL.");
      if(typeof remote.publishedAt!=="string"||remote.publishedAt.length>40||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(remote.publishedAt)||!Number.isFinite(Date.parse(remote.publishedAt)))throw new Error("Invalid GitHub publication time.");
      const nodeId=optional(remote.nodeId,"GitHub node ID",200);
      return {kind:remote.kind,repository:remote.repository,number:remote.number,url:url.href,publishedAt:remote.publishedAt,...(nodeId?{nodeId}:{})};
    });
    let capture;
    if(comment.capture!==undefined){const c=comment.capture;if(!c||c.mime!=='image/png'||typeof c.dataUrl!=='string'||c.dataUrl.length>262144||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(c.dataUrl)||![c.width,c.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1024))throw new Error('Invalid annotation screenshot.');capture={mime:c.mime,dataUrl:c.dataUrl,width:c.width,height:c.height};}
    const attachments=comment.attachments??[];
    if(!Array.isArray(attachments)||attachments.length>4)throw new Error('Invalid screenshot attachments.');
    const validatedAttachments=attachments.map(validateAttachment);
    const scope=collaboration;
    if(validatedAttachments.some(a=>scope.provider==='gitlab'?a.provider!=='gitlab'||a.host!==scope.host||a.repository!==scope.repository:a.provider!=='github'))throw new Error('Screenshot attachment belongs to another provider, host or project.');
    return { ...(threadType?{threadType}:{}), id: comment.id, text: comment.text.trim(), createdAt: comment.createdAt, updatedAt, severity, state, tags:[...new Set(tags.map(tag=>tag.trim()))],mentions,remoteRefs:refs,...(capture?{capture}:{}),...(validatedAttachments.length?{attachments:validatedAttachments}:{}),
      anchor: normalizeAnchor(comment.anchor) };
  }
  const escaped = (value) => String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/[\\`*_{}\[\]()#+.!|<>]/g, "\\$&").replace(/\r\n?|\n/g, " ");
  const escapedComment = (value) => String(value).split(/\r\n?|\n/).map(escaped).join("  \n");
  const tableCell = (value) => String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/\\/g, "\\\\").replace(/[|`*_{}\[\]!~]/g, "\\$&").replace(/\r\n?|\n/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function revisionUrl(anchor) {
    const ref = anchor.ref.split("/").map(encodeURIComponent).join("/");
    const file = anchor.file.split("/").map(encodeURIComponent).join("/");
    if(anchor.provider==='gitlab')return `${gitlabHost(anchor.host)}/${anchor.repository}/-/blob/${ref}/${file}`;
    return `https://github.com/${anchor.repository}/blob/${ref}/${file}`;
  }
  function encodeNote(note) {
    const bytes = new TextEncoder().encode(JSON.stringify(note));
    let binary = "";
    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeNote(encoded) {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4));
    return validateComment(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)))));
  }
  function toMarkdown(value, {severityBadge=true,stateBadge=true,layout='compact'} = {}) {
    const note = validateComment(value), anchor = note.anchor;
    const fileUrl = revisionUrl(anchor);
    const fileValue = fileUrl ? `[${escaped(anchor.file)}](<${fileUrl}>)` : escaped(anchor.file);
    let targetLabel = "Component / object";
    let targetValue = [anchor.reference, anchor.kind && `(${anchor.kind})`].filter(Boolean).join(" ") || anchor.kind || "Drawing";
    if (anchor.kind === "net") {
      targetLabel = "Net";
      targetValue = anchor.netName || anchor.reference || anchor.objectId || "Unnamed net";
    }
    const rows = [
      ["Severity", severityInfo(note.severity).label],
      ["Review state", note.state],
      ...(note.threadType ? [["Destination type", note.threadType === "discussion" ? "Discussion" : "Issue"]] : []),
      [targetLabel, targetValue],
      ...(anchor.reviewTarget ? [['Review surface',anchor.reviewTarget.surface==='bom'?'BoM':'Properties'],['Field',anchor.reviewTarget.field],['Reviewed value',anchor.reviewTarget.value],...(anchor.reviewTarget.references?.length?[['BoM references',anchor.reviewTarget.references.join(', ')]]:[])] : []),
      ...(anchor.position ? [["Position (mm)", `${anchor.position.x}, ${anchor.position.y}`]] : []),
      ...(anchor.area ? [["Area (mm)", `${anchor.area.x}, ${anchor.area.y}; ${anchor.area.width} × ${anchor.area.height}`]] : []),
      ...(anchor.area ? [["Start (mm)", `${anchor.area.x}, ${anchor.area.y}`], ["End (mm)", `${anchor.area.x + anchor.area.width}, ${anchor.area.y + anchor.area.height}`]] : []),
      ["Repository", anchor.repository],
      ["Revision", anchor.ref],
      ["Design file", fileValue, true],
      ...(anchor.sheetName ? [["Sheet", anchor.sheetName]] : []),
      ...(anchor.sheetUuid ? [["Sheet UUID", anchor.sheetUuid]] : []),
      ...(anchor.instancePath ? [["Sheet instance path", anchor.instancePath]] : []),
      ...(anchor.variant ? [["Variant", anchor.variant]] : []),
      ...(anchor.uuid ? [["KiCad UUID", anchor.uuid]] : []),
      ...(anchor.objectId ? [["Object ID", anchor.objectId]] : []),
      ["Tags", note.tags.length ? note.tags.join(", ") : "None"],
      ["Mentions", note.mentions.length ? note.mentions.map(login => `@${login}`).join(", ") : "None"],
      ["Created (UTC)", note.createdAt],
      ["Updated (UTC)", note.updatedAt]
    ];
    const commentLines=note.text.split(/\r\n|\r|\n/);
    const level=severityInfo(note.severity);
    const lines = layout==='legacy'?["## KiCad visual review", "", ...(severityBadge?[`> ${level.symbol} **${level.label}** · review severity`, ...(stateBadge?[`> ${stateInfo(note.state).symbol} **${stateInfo(note.state).label}** · review state`]:[]), ""]:[]), "### "+escaped(commentLines[0]), "", escapedComment(commentLines.slice(1).join("\n")), "",
      "### Design context", "", "| Detail | Value |", "| --- | --- |",
      ...rows.map(([label, item, rawMarkdown]) => `| ${tableCell(label)} | ${rawMarkdown ? item : tableCell(item)} |`)]:[escapedComment(note.text)];
    if(note.attachments?.length)for(const attachment of note.attachments)lines.push('',`![Captured drawing area (${attachment.width} × ${attachment.height})](${attachment.url})`);
    else if(note.capture)lines.push("", "A drawing screenshot is stored with the local review note. Download it and attach it manually if needed.");
    if(layout!=='legacy'){
      const summary=['Design context',...(severityBadge?[level.label,...(stateBadge?[stateInfo(note.state).label]:[])]:[])].join(' · ');
      lines.push('',`<details><summary>${summary}</summary>`,'','| Detail | Value |','| --- | --- |',
        ...rows.map(([label,item,rawMarkdown])=>`| ${tableCell(label)} | ${rawMarkdown?item:tableCell(item)} |`),'','</details>');
    }
    const {capture,...metadata}=note;
    lines.push("", `<!-- kicad-review:v1 ${encodeNote(metadata)} -->`);
    return lines.join("\n");
  }
  function fromMarkdown(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_IMPORT) {
      throw new Error("GitHub annotation body exceeds 1 MiB.");
    }
    const notes = [];
    for (const match of text.matchAll(MARKER)) {
      if (notes.length >= 100) break;
      try { notes.push(decodeNote(match[1])); } catch { /* Ignore unrelated or malformed markers. */ }
    }
    return notes;
  }
  function threadAnnotations(thread,value,{repository}={}){
    const scope=normalizeScope(value),provider=scope.provider||'github',host=scope.host||'https://github.com',targetRepository=repository||scope.repository;
    normalizeScope({...scope,repository:targetRepository});
    if(!thread||!['issue','discussion'].includes(thread.kind)||!Number.isSafeInteger(thread.number)||thread.number<1||!['open','closed'].includes(thread.state))return [];
    const base=host+'/'+targetRepository+(provider==='gitlab'?'/-/issues/':thread.kind==='discussion'?'/discussions/':'/issues/')+thread.number;
    if(thread.url!==base)return [];const notes=[],seen=new Set();
    for(const [index,row]of [thread,...(Array.isArray(thread.comments)?thread.comments.slice(-200):[])].entries()){
      if(typeof row.body!=='string'||typeof row.url!=='string'||row.url!==base&&!row.url.startsWith(base+'#'))continue;
      let parsed;try{const content=globalThis.KiCadChatContent||(typeof module==='object'&&module.exports?require('./chat-content.js'):null);parsed=content?.content?content.content(row.body,{comments:{fromMarkdown,toMarkdown}}).annotations:fromMarkdown(row.body);}catch{continue;}
      for(const note of parsed){const a=note.anchor;if((a.provider||'github')!==provider||(a.host||'https://github.com')!==host||a.repository!==scope.repository||a.ref!==scope.ref||a.file!==scope.file)continue;
        const key=row.url+':'+note.id;if(seen.has(key)||notes.length>=500)continue;seen.add(key);
        const author=typeof row.author==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/.test(row.author)?row.author:'unknown';
        notes.push({...note,github:{provider,...(provider==='gitlab'?{host}:{}),url:row.url,number:thread.number,state:thread.state,source:thread.kind+(index?(row.replyTo?'-reply':'-comment'):''),author,...(typeof row.createdAt==='string'?{createdAt:row.createdAt}:{}),...(typeof row.updatedAt==='string'?{updatedAt:row.updatedAt}:{})}});
      }
    }return notes;
  }
  function exportComments(notes) {
    if (!Array.isArray(notes) || notes.length > 100) throw new Error("Too many review comments to export.");
    const text=JSON.stringify({ format: FORMAT, version: 1, comments: notes.map(validateComment) }, null, 2);
    if(new TextEncoder().encode(text).length>MAX_IMPORT)throw new Error('Export exceeds 1 MiB; use the Git review file or remove screenshots.');
    return text;
  }
  function parseComments(text) {
    if (typeof text !== "string" || text.length > MAX_IMPORT ||
        new TextEncoder().encode(text).length > MAX_IMPORT) throw new Error("Comment import exceeds 1 MiB.");
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("Invalid comment JSON."); }
    if (data?.format !== FORMAT || data.version !== 1 || !Array.isArray(data.comments) || data.comments.length > 100) {
      throw new Error("Unsupported review comment export.");
    }
    const comments = data.comments.map(validateComment);
    const seen = new Set();
    for (const note of comments) {
      const key = JSON.stringify([...(note.anchor.provider==='gitlab'?['gitlab',note.anchor.host||'https://gitlab.com']:[]),note.anchor.repository, note.anchor.ref, note.anchor.file, note.id]);
      if (seen.has(key)) throw new Error("Duplicate comment id in import.");
      seen.add(key);
    }
    return comments;
  }
  function parseSidecar(text){
    if(typeof text!=="string"||new TextEncoder().encode(text).length>4*1024*1024)throw new Error("Review file exceeds 4 MiB.");
    let data;try{data=JSON.parse(text);}catch{throw new Error("Invalid review file JSON.");}
    if(data?.schemaVersion!==1||!Array.isArray(data.annotations)||data.annotations.length>1000||Object.keys(data).some(key=>!["schemaVersion","annotations"].includes(key)))throw new Error("Unsupported review file schema.");
    const seen=new Set();return data.annotations.map(note=>{const valid=validateComment(note),key=JSON.stringify([...(valid.anchor.provider==='gitlab'?['gitlab',valid.anchor.host]:[]),valid.anchor.repository,valid.anchor.ref,valid.anchor.file,valid.id]);if(seen.has(key))throw new Error("Duplicate annotation in review file.");seen.add(key);return valid;});
  }
  function serializeSidecar(notes){return JSON.stringify({schemaVersion:1,annotations:parseSidecar(JSON.stringify({schemaVersion:1,annotations:notes})).sort((a,b)=>JSON.stringify([...(a.anchor.provider==='gitlab'?['gitlab',a.anchor.host]:[]),a.anchor.repository,a.anchor.ref,a.anchor.file,a.id])<JSON.stringify([...(b.anchor.provider==='gitlab'?['gitlab',b.anchor.host]:[]),b.anchor.repository,b.anchor.ref,b.anchor.file,b.id])?-1:JSON.stringify([...(a.anchor.provider==='gitlab'?['gitlab',a.anchor.host]:[]),a.anchor.repository,a.anchor.ref,a.anchor.file,a.id])>JSON.stringify([...(b.anchor.provider==='gitlab'?['gitlab',b.anchor.host]:[]),b.anchor.repository,b.anchor.ref,b.anchor.file,b.id])?1:0)},null,2)+"\n";}
  function receiptKey(note, user) {
    if (typeof user !== "string" || !MENTION.test(user)) throw new Error("Invalid review reader identity.");
    const normalized = validateComment(note);
    const anchor = normalized.anchor;
    return JSON.stringify(["kicad-review-read-v1", user.toLowerCase(), ...(anchor.provider==='gitlab'?['gitlab',anchor.host]:[]),anchor.repository, anchor.ref, anchor.file, normalized.id]);
  }
  function isUnread(note, receipt) {
    return typeof receipt !== "string" || !Number.isFinite(Date.parse(receipt)) ||
      Date.parse(receipt) < Date.parse(note.updatedAt || note.createdAt);
  }
  function commentType(note) {
    // Remote GitHub readback knows the actual conversation type, including old markers.
    const source=note?.github?.source;
    if(note?.anchor?.provider!=='gitlab'&&typeof source==='string'){
      if(source.startsWith('discussion'))return 'discussion';
      if(source.startsWith('issue')||source.startsWith('pull'))return 'issue';
    }
    if(['issue','discussion'].includes(note?.threadType))return note.threadType;
    const kinds=[...new Set((note?.remoteRefs||[]).map(ref=>ref.kind==='pull-request'?'issue':ref.kind).filter(kind=>['issue','discussion'].includes(kind)))];
    return kinds.length===1?kinds[0]:null;
  }
  function createdDateRange(createdFrom, createdTo) {
    const day = (value) => {
      if (value === undefined || value === "") return undefined;
      if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)) throw new Error("Invalid comment date filter. Use YYYY-MM-DD.");
      const time = Date.parse(value + "T00:00:00.000Z");
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value) throw new Error("Invalid comment date filter. Choose a real calendar date.");
      return time;
    };
    const from = day(createdFrom), to = day(createdTo);
    if (from !== undefined && to !== undefined && from > to) throw new Error("Comment date filter start must not follow its end.");
    // The final UTC day is inclusive, without relying on timestamp precision.
    return { from, until: to === undefined ? undefined : to + 86400000 };
  }
  function sortAndFilter(notes, filters = {}, readAt = () => undefined, stateOf = effectiveState) {
    const severity = filters.severity || "all", state = filters.state || "all", read = filters.read || "all", threadType=filters.threadType||"all";
    const order = filters.order || "severity", query = String(filters.query || "").trim().toLowerCase().slice(0, 2000);
    if (!["all","issue","discussion"].includes(threadType) || !["all",...SEVERITIES].includes(severity) || !["all","closed",...STATES].includes(state) ||
      !["all","read","unread"].includes(read) || !["severity","severity-lowest","newest","oldest","updated","updated-oldest"].includes(order)) {
      throw new Error("Invalid comment filter.");
    }
    const dates = createdDateRange(filters.createdFrom, filters.createdTo);
    const rank = Object.fromEntries(severityOptions.map((item,index)=>[item.value,severityOptions.length-index-1]));
    return [...notes].filter((note) => {
      const unread = isUnread(note, readAt(note));
      const created = Date.parse(note.createdAt);
      return (dates.from === undefined || created >= dates.from) && (dates.until === undefined || created < dates.until) &&
        (threadType === "all" || commentType(note) === threadType) && (severity === "all" || (note.severity || "info") === severity) &&
        stateMatches(state,stateOf(note),note.state||"open") &&
        (read === "all" || (read === "unread") === unread) &&
        (!query || [note.text,note.anchor?.reference,...(note.tags || []),...(note.mentions || [])]
          .join(" ").toLowerCase().includes(query));
    }).sort((a,b) => {
      if (order === "severity" || order === "severity-lowest") return (order === "severity" ? 1 : -1) * ((rank[a.severity || "info"] ?? 4) - (rank[b.severity || "info"] ?? 4)) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (order === "updated" || order === "updated-oldest") return (order === "updated" ? 1 : -1) * (Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
      return order === "newest" ? Date.parse(b.createdAt) - Date.parse(a.createdAt) :
        Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
  }
  // Persist reservations before network writes; failures also consume the attempt.
  // This limits this installation, not independent bots using the provider directly.
  async function reservePublication(storage, scope, now = Date.now()) {
    if (!storage || typeof scope !== 'string' || scope.length > 512 || !Number.isSafeInteger(now) || now < 0) throw Error('Invalid publication safety context.');
    const key = 'kivi:publication-budget:' + scope;
    const previous = publicationReservations.get(key) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      let saved;
      try { saved = (await storage.get(key))[key]; } catch { throw Error('Unable to read publication safety settings. Nothing posted.'); }
      if (saved !== undefined && (!Array.isArray(saved) || saved.length > 20 || saved.some(t => !Number.isSafeInteger(t) || t < 0 || t > now))) throw Error('Publication safety history is invalid or the device clock moved backwards. Nothing posted.');
      const history = (saved || []).filter(t => now - t < 3600000).sort((a,b) => a-b);
      let until = 0;
      if (history.length) until = history.at(-1) + 3000;
      const minute = history.filter(t => now - t < 60000);
      if (minute.length >= 5) until = Math.max(until, minute[0] + 60000);
      if (history.length >= 20) until = Math.max(until, history[0] + 3600000);
      if (now < until) { const error = Error('Posting too quickly. Try again in ' + Math.ceil((until-now)/1000) + ' seconds.'); error.retryAfterSeconds = Math.ceil((until-now)/1000); throw error; }
      try { await storage.set({[key]: [...history,now]}); } catch { throw Error('Unable to save publication safety settings. Nothing posted.'); }
    });
    publicationReservations.set(key,work);
    try { await work; } finally { if (publicationReservations.get(key) === work) publicationReservations.delete(key); }
  }
  return { stateOptions, stateInfo, isState, issueState, effectiveState, stateMatches, threadLinks, createThreadStateCache, mergeAnnotations, severityOptions, severityInfo, isSeverity, forWorkspace, sourceSheetUuid, threadAnnotations, normalizeScope, normalizeAnchor, validateComment, validateAttachment, toMarkdown, fromMarkdown, parseSidecar, serializeSidecar,
    reservePublication, exportComments, parseComments, receiptKey, isUnread, commentType, createdDateRange, sortAndFilter };
  }
  return create();
})();

if (typeof globalThis === "object") globalThis.KiCadReviewComments = KiCadReviewComments;
if (typeof module === "object" && module.exports) module.exports = KiCadReviewComments;
