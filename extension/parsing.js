/* Shared, side-effect-free Git host route parsing. */
((root) => {
  "use strict";
  const filePattern = /(?:\.kicad_(?:sch|pcb|pro|prl|dru|wks)|\.(?:sch|brd|pro|lib|gbr|ger|gerber|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gko|gm\d+|g\d+|drl|xln|exc|nc|xnc|gbrjob|html?|json|csv|tsv|txt|wbk|raw|pdf)|(?:^|\/)(?:fp|sym)-lib-table)$/i;
  const ownerPattern = /^[A-Za-z0-9_.-]+$/;
  const repoPattern = /^[A-Za-z0-9_.-]+$/;

  // Toolbar revision launches are independent of inline drawing/file-diff routes.
  function revisionRoute(url) {
    let page;try{page=new URL(url);}catch{return null;}
    if(page.origin!=='https://github.com'||page.username||page.password)return null;
    const parts=page.pathname.split('/').filter(Boolean).map(decodeSegment);
    if(parts.length<4||!parts.every(Boolean)||!parts.slice(0,2).every(part=>ownerPattern.test(part)))return null;
    const repository=parts.slice(0,2).join('/'),commit=ref=>/^[a-f0-9]{7,40}$/i.test(ref||'');
    if(parts[2]==='commit'&&parts.length===4&&commit(parts[3]))return{kind:'commit',repository,ref:parts[3]};
    if(parts[2]!=='pull'||!Number.isSafeInteger(Number(parts[3]))||! /^[1-9][0-9]*$/.test(parts[3]))return null;
    const number=Number(parts[3]);
    if(parts.length===6&&parts[4]==='commits'&&commit(parts[5]))return{kind:'commit',repository,ref:parts[5],number};
    if(parts.length===4||parts.length===5&&['files','commits','checks'].includes(parts[4]))return{kind:'pull',repository,number};
    return null;
  }

  // Repository landing/tree pages only. Keep this separate from drawing routes.
  function repositoryRoute(url, {gitlabHosts=[]}={}) {
    let page;try{page=new URL(url);}catch{return null;}
    if(page.protocol!=='https:'||page.username||page.password)return null;
    const parts=page.pathname.split('/').filter(Boolean).map(decodeSegment);
    if(!parts.every(Boolean))return null;
    if(page.origin==='https://github.com'){
      if(!parts.slice(0,2).every(part=>ownerPattern.test(part)))return null;
      if(parts.length===2)return {kind:'repository',repository:parts.join('/')};
      if(parts.length>=4&&parts[2]==='tree')return {kind:'repository',repository:parts.slice(0,2).join('/'),tail:parts.slice(3)};
      return null;
    }
    if(page.origin!=='https://gitlab.com'&&!gitlabHosts.includes(page.origin))return null;
    const split=parts.indexOf('-');
    if(split<0&&parts.length>=2&&parts.every(part=>ownerPattern.test(part)))return {kind:'repository',provider:'gitlab',host:page.origin,repository:parts.join('/')};
    if(split>=2&&parts.slice(0,split).every(part=>ownerPattern.test(part))&&parts[split+1]==='tree'&&parts.length>split+2)return {kind:'repository',provider:'gitlab',host:page.origin,repository:parts.slice(0,split).join('/'),tail:parts.slice(split+2)};
    return null;
  }

  function repositoryRef(parsedRoute,scripts=[],gitlabData=null){
    if(!parsedRoute||parsedRoute.kind!=='repository')return null;
    if(!parsedRoute.tail)return 'HEAD';
    const tail=parsedRoute.tail.join('/'),matches=[],authoritative=[];
    const add=ref=>{if(typeof ref==='string'&&ref.length<=500&&ref.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!/[\\\x00-\x20\x7f]/.test(ref)&&(tail===ref||tail.startsWith(ref+'/')))matches.push(ref);};
    if(gitlabData?.projectPath===parsedRoute.repository)add(gitlabData.originalBranch||gitlabData.ref);
    for(const text of scripts){
      if(typeof text!=='string'||text.length>5_000_000)continue;
      let data;try{data=JSON.parse(text);}catch{continue;}
      const visit=(value,depth)=>{if(!value||typeof value!=='object'||depth>14)return;
      for(const key of ['codeViewTreeRoute','codeViewRepoRoute']){const route=value[key],ref=route?.refInfo?.name,path=route?.path==='/'?'':route?.path;if(typeof ref==='string'&&typeof path==='string'&&tail===ref+(path?'/'+path:'')){const count=matches.length;add(ref);if(matches.length>count)authoritative.push(ref);}}
      add(value.refInfo?.name);for(const child of Object.values(value))if(child&&typeof child==='object')visit(child,depth+1);};visit(data,0);
    }
    if(authoritative.length){const refs=[...new Set(authoritative)];return refs.length===1?refs[0]:null;}
    // Slash refs and directory paths require authoritative branch metadata.
    matches.sort((a,b)=>b.length-a.length);
    return matches[0]||(parsedRoute.tail.length===1?parsedRoute.tail[0]:null);
  }

  function detectedProjects(entries){
    const files=[...new Set((Array.isArray(entries)?entries:[]).filter(item=>item?.type==='blob'&&item.mode!=='120000'&&/(?:\.kicad_(?:pro|sch|pcb)|\.(?:sch|brd|pro))$/i.test(item.path||'')&&filePath(item.path)).map(item=>item.path))];
    const projects=files.filter(file=>/(?:\.kicad_pro|\.pro)$/i.test(file));
    // Offer standalone drawings only in directories without a saved project.
    const directory=file=>file.includes('/')?file.slice(0,file.lastIndexOf('/')):'';
    const projectDirs=new Set(projects.map(directory));
    return [...projects,...files.filter(file=>!/(?:\.kicad_pro|\.pro)$/i.test(file)&&!projectDirs.has(directory(file)))].sort((a,b)=>Number(/(?:\.kicad_pro|\.pro)$/i.test(b))-Number(/(?:\.kicad_pro|\.pro)$/i.test(a))||a.split('/').length-b.split('/').length||a.localeCompare(b)).slice(0,100);
  }

  function route(url, {gitlabHosts = []} = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password && (parsed.origin === "https://gitlab.com" || parsed.origin !== "https://github.com" && gitlabHosts.includes(parsed.origin))) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const delimiter = parts.indexOf("-");
      if (delimiter < 2) return null;
      const namespace = parts.slice(0, delimiter).map(decodeSegment);
      if (!namespace.every((part) => part && ownerPattern.test(part))) return null;
      if(parts[delimiter+1]==='merge_requests'&&/^[1-9][0-9]*$/.test(parts[delimiter+2])&&parts[delimiter+3]==='diffs'&&parts.length===delimiter+4){
        if(['diff_id','start_sha','end_sha','diff1','diff2'].some(key=>parsed.searchParams.has(key)))return null;
        const number=Number(parts[delimiter+2]);
        return Number.isSafeInteger(number)?{kind:'merge',provider:'gitlab',host:parsed.origin,repository:namespace.join('/'),number}:null;
      }
      if(parts[delimiter+1]!=='blob')return null;
      const tail = parts.slice(delimiter + 2).map(decodeSegment);
      if (!namespace.every((part) => part && ownerPattern.test(part)) || tail.length < 2 ||
          !tail.every(Boolean) || !filePattern.test(tail.at(-1))) return null;
      return { kind: "blob", provider: "gitlab", ...(parsed.origin!=="https://gitlab.com"?{host:parsed.origin}:{}), repository: namespace.join("/"), tail };
    }
    if (parsed.origin !== "https://github.com") return null;
    const pieces = parsed.pathname.split("/").filter(Boolean);
    if (pieces.length < 4 || !ownerPattern.test(pieces[0]) || !repoPattern.test(pieces[1])) return null;
    const repository = `${pieces[0]}/${pieces[1]}`;
    if (pieces[2] === "blob" && pieces.length >= 5) {
      const tail = pieces.slice(3).map(decodeSegment);
      if (!tail.every(Boolean) || !filePattern.test(tail.at(-1))) return null;
      return { kind: "blob", repository, tail };
    }
    if (pieces[2] === "pull" && /^[1-9][0-9]*$/.test(pieces[3]) && pieces[4] === "files") {
      const number = Number(pieces[3]);
      return Number.isSafeInteger(number) ? { kind: "pull", repository, number } : null;
    }
    return null;
  }

  function decodeSegment(value) {
    try {
      const decoded = decodeURIComponent(value);
      return decoded && decoded !== "." && decoded !== ".." && !/[\\/\0]/.test(decoded) ? decoded : null;
    } catch { return null; }
  }

  function filePath(value) {
    if (typeof value !== "string" || value.length>500 || !filePattern.test(value) || value.startsWith("/")) return null;
    const parts = value.split("/");
    return parts.every((part) => part && part !== "." && part !== ".." && !/[\\:\x00-\x1f\x7f]/.test(part)) ? value : null;
  }

  function embeddedBlobData(scripts, parsedRoute = null) {
    const candidates = [];
    for (const text of scripts) {
      if (!text || text.length > 5_000_000) continue;
      let data;
      try { data = JSON.parse(text); } catch { continue; }
      const seen = new Set();
      function visit(value, depth) {
        if (!value || typeof value !== "object" || depth > 14 || seen.has(value)) return;
        seen.add(value);
        const path = filePath(value.path || value.filePath || value.filename);
        const refInfo = value.refInfo || value.ref || {};
        const ref = typeof refInfo === "string" ? refInfo : refInfo.name || refInfo.ref || refInfo.currentOid;
        const oid = typeof refInfo === "object" && (refInfo.currentOid || refInfo.oid);
        if (path && (typeof ref === "string" || typeof oid === "string")) {
          const candidate = { file: path, head: oid || ref, ref, score: (oid ? 2 : 0) + (value.refInfo ? 1 : 0) };
          // SPA payloads can contain sibling files and stale branch metadata.
          // Match the full route, not a basename suffix or the globally best SHA.
          const tail = parsedRoute?.tail?.join("/");
          if (!tail || tail === `${ref}/${path}` || tail === `${oid}/${path}`) candidates.push(candidate);
        }
        for (const child of Object.values(value)) if (typeof child === "object") visit(child, depth + 1);
      }
      visit(data, 0);
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function blobRequest(parsedRoute, embedded) {
    if (!parsedRoute || parsedRoute.kind !== "blob") return null;
    if (embedded && filePath(embedded.file) && typeof embedded.head === "string" && embedded.head) {
      const tail = parsedRoute.tail.join("/");
      const routeMatches = embedded.ref ? tail === `${embedded.ref}/${embedded.file}` || tail === `${embedded.head}/${embedded.file}` : tail.endsWith("/" + embedded.file);
      if (routeMatches && (parsedRoute.provider !== "gitlab" ||
          tail === `${embedded.head}/${embedded.file}` && embedded.repository === parsedRoute.repository)) {
        return { repository: parsedRoute.repository, file: embedded.file, head: embedded.head,
          ...(parsedRoute.provider ? { provider: parsedRoute.provider, ...(parsedRoute.host?{host:parsedRoute.host}:{}) } : {}) };
      }
    }
    if (parsedRoute.provider === "gitlab") return null;
    // The URL alone cannot disambiguate a slash in a branch name from a folder.
    // The common one-segment ref is a useful fallback when GitHub's embedded data is absent.
    const file = filePath(parsedRoute.tail.slice(1).join("/"));
    return file ? { repository: parsedRoute.repository, file, head: parsedRoute.tail[0] } : null;
  }

  function viewerParams(request) {
    const params = new URLSearchParams({
      repository: request.repository,
      headRepository: request.headRepository || request.repository,
      file: request.file,
      oldFile: request.oldFile || request.file,
      head: request.head
    });
    if (request.provider === "gitlab") { params.set("provider", "gitlab"); if(request.host)params.set("host",request.host); }
    if (request.base) params.set("base", request.base);
    if (request.status === "added" || request.status === "removed") params.set("status", request.status);
    if (request.pullNumber !== undefined || request.pullRepository !== undefined) {
      if (!Number.isSafeInteger(request.pullNumber) || request.pullNumber <= 0 ||
          typeof request.pullRepository !== "string" ||
          !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(request.pullRepository) ||
          request.pullRepository.split("/").some((part) => part === "." || part === "..")) {
        throw new Error("Invalid pull request context.");
      }
      params.set("pullNumber", String(request.pullNumber));
      params.set("pullRepository", request.pullRepository);
    }
    return params;
  }

  root.KiCadGitHub = { route, revisionRoute, repositoryRoute, repositoryRef, detectedProjects, filePath, embeddedBlobData, blobRequest, viewerParams };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadGitHub;
})(typeof globalThis === "object" ? globalThis : this);
