/* Browser-only project retrieval helpers. No renderer or server dependency. */
((root) => {
  "use strict";
  const repositoryPattern = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;
  const filePattern = /(?:\.kicad_(?:sch|pcb)|\.(?:sch|brd))$/i;
  const PROJECT_MAX_BYTES = 512 * 1024 * 1024;
  const PROJECT_MAX_FILES = 128, PARENT_MAX_CANDIDATES = 128, READ_CONCURRENCY = 4;
  const fileByteLimit = (path) => /\.(wbk|raw|csv|tsv|json|html?|txt)$/i.test(path) ? 64 * 1024 * 1024 : (/\.kicad_(pcb|sch)$/i.test(path) ? 256 : 8) * 1024 * 1024;

  function validRepository(value, provider = "github") {
    return typeof value === 'string' && value.length <= 500 && repositoryPattern.test(value) &&
      (provider === 'gitlab' || provider === 'github' && value.split('/').length === 2) &&
      value.split('/').every((part) => part !== '.' && part !== '..');
  }
  function validRef(value) {
    return typeof value === 'string' && !!value && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
  }

  function validPath(path) {
    return typeof path === "string" && filePattern.test(path) && !path.startsWith("/") &&
      path.split("/").every((part) => part && part !== "." && part !== ".." && !/[\\\x00-\x1f\x7f]/.test(part));
  }

  function childPath(parent, name) {
    if (typeof name !== "string" || !/(?:\.kicad_sch|\.sch)$/i.test(name) ||
        name.startsWith("/") || /[\\\0:]/.test(name)) return null;
    const parts = parent.split("/").slice(0, -1);
    for (const part of name.split("/")) {
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
    const result = parts.join("/");
    return validPath(result) ? result : null;
  }

  function sheetFiles(source) {
  // Bounded S-expression context; only properties of top-level sheet objects
  // authorize child reads. Comments, text, and library properties are ignored.
  if (/^\s*EESchema Schematic File Version [24]\b/.test(source)) {
    const legacy=root.KiCadLegacy||(typeof module==='object'&&module.exports?require('./legacy-kicad.js'):null);
    if(!legacy)throw Error('Legacy schematic adapter is unavailable.');return legacy.sheetFiles(source);
  }
  const names=[],stack=[];let i=0,nodes=0,roots=0;
  while(i<source.length) {
    const c=source[i];if(/\s/.test(c)){i++;continue;}
    if((c==="<"||c===">")&&/^(?:<{7,}|>{7,})(?:\s|$)/.test(source.slice(i,i+120)))throw new Error("Unresolved Git merge conflict at line "+(source.slice(0,i).split("\n").length)+". Resolve the conflict in a separate copy before viewing.");
      if(c===";"){while(i<source.length&&source[i]!=="\n")i++;continue;}
    if(++nodes>1000000)throw new Error("KiCad source has too many S-expression nodes.");
    if(c==="(") {if(stack.length>=96)throw new Error("KiCad source is too deeply nested.");if(!stack.length)roots++;stack.push([]);i++;continue;}
    if(c===")") {
      if(!stack.length)throw new Error("Unexpected closing KiCad parenthesis.");
      const entry=stack.pop();i++;
      if(entry[0]==="property" && ["Sheetfile", "Sheet file"].includes(entry[1]) && typeof entry[2]==="string" &&
        stack.length===2 && stack[0][0]==="kicad_sch" && stack[1][0]==="sheet")names.push(entry[2]);
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

  // Resolve saved sheet links, never names or directory proximity. Every ancestor
  // must be acyclic and all parent branches must converge on one root.
  function rootSheetPath(files, start) {
    if (files.length > PROJECT_MAX_FILES) return null;
    const sources = new Map(files.filter(file => /(?:\.kicad_sch|\.sch)$/i.test(file.path)).map(file => [file.path, file.content]));
    if (!sources.has(start)) return null;
    const parents = new Map([...sources.keys()].map(path => [path, new Set()]));
    for (const [path, content] of sources) for (const name of sheetFiles(content)) {
      const target = childPath(path, name);
      if (sources.has(target)) parents.get(target).add(path);
    }
    const state = new Map(), roots = new Set();
    function visit(path) {
      if (state.get(path) === 1) return false;
      if (state.get(path) === 2) return true;
      state.set(path, 1);
      const incoming = parents.get(path);
      if (!incoming.size) roots.add(path);
      for (const parent of incoming) if (!visit(parent)) return false;
      state.set(path, 2);
      return true;
    }
    return visit(start) && roots.size === 1 ? [...roots][0] : null;
  }

  async function loadProject(repository, ref, file, readFile, listDirectory = null, provider = "github", listSchematics = null) {
    if (!validRepository(repository, provider) || !validPath(file) || !validRef(ref)) {
      throw new Error("Invalid GitHub project location.");
    }
    const cache = new Map(), sizes = new Map(), inFlight = new Map(), sheetCache = new Map(), encoder = new TextEncoder();
    let totalBytes = 0, readCount = 0;
    async function read(path, budget = PROJECT_MAX_BYTES) {
      if (cache.has(path)) return cache.get(path);
      if (inFlight.has(path)) return inFlight.get(path);
      if (readCount >= PROJECT_MAX_FILES + PARENT_MAX_CANDIDATES) throw new Error("Project discovery exceeds the bounded KiCad file count.");
      readCount++;
      const work = (async () => {
      const content = await readFile(repository, ref, path);
      if (content !== null && typeof content !== "string") throw new Error("GitHub returned invalid KiCad file contents.");
      if (content !== null) {
        const size = encoder.encode(content).length;
        if (size > fileByteLimit(path) || totalBytes + size > budget) {
          throw new Error("Project discovery exceeds the browser preview size limit.");
        }
        totalBytes += size;
        sizes.set(path, size);
      }
      cache.set(path, content);
      return content;
      })();
      inFlight.set(path, work);
      try { return await work; } finally { inFlight.delete(path); }
    }
    function descendants(path, content) {
      if (!sheetCache.has(path)) sheetCache.set(path, content === null || !/(?:\.kicad_sch|\.sch)$/i.test(path) ? [] :
        sheetFiles(content).map(name => childPath(path, name)).filter(Boolean));
      return sheetCache.get(path);
    }
    async function readBatch(paths, budget = PROJECT_MAX_BYTES) {
      let next = 0, failure = null;
      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, async () => {
        while (next < paths.length && !failure) {
          const path = paths[next++];
          try { await read(path, budget); } catch (error) { failure ||= error; }
        }
      }));
      if (failure) throw failure;
    }
    function retain(paths) {
      for (const path of cache.keys()) if (!paths.has(path)) {
        totalBytes -= sizes.get(path) || 0; sizes.delete(path); cache.delete(path); sheetCache.delete(path);
      }
    }
    if (await read(file) === null) throw new Error(`KiCad file was not returned by ${provider === "gitlab" ? "GitLab" : "GitHub"} (HTTP 404): ${repository}, revision ${ref}, path ${file}. The file may be missing or repository access may be unavailable. ${provider === "gitlab" ? "Sign in to the matching GitLab server in extension settings and check your project access." : "Keep this repository open in a signed-in GitHub tab in the same browser profile and complete any organization website sign-in. Project viewing does not require a review-account token."}`);
    let roots = [file];
    let discoveryWarning = null;
    if (/(?:\.kicad_sch|\.sch)$/i.test(file) && (listDirectory || listSchematics)) {
      try {
      const candidates = new Set([file]);
      if (listSchematics) {
        const listing = await listSchematics(repository, ref);
        if (!Array.isArray(listing)) throw new Error("Provider returned an incomplete schematic repository listing.");
        if (listing.length > PARENT_MAX_CANDIDATES) throw new Error("More than 128 parent-sheet candidates; open the project root directly.");
        for (const path of listing) {
          if (!validPath(path) || !/(?:\.kicad_sch|\.sch)$/i.test(path)) throw new Error("Provider returned an unsafe schematic repository listing.");
          candidates.add(path);
          if (candidates.size > PARENT_MAX_CANDIDATES) throw new Error("More than 128 parent-sheet candidates; open the project root directly.");
        }
        if (!listing.includes(file)) throw new Error("The schematic repository listing omitted the requested drawing.");
      } else {
      const parts = file.split("/");
      if (parts.length > 9) throw new Error("Schematic path is too deep for bounded parent-sheet discovery.");
      for (let index = parts.length - 1; index >= 0; index--) {
        const directory = parts.slice(0, index).join("/");
        const listing = await listDirectory(repository, ref, directory);
        if (!Array.isArray(listing) || listing.length > 1000) {
          throw new Error("GitHub returned an incomplete schematic directory listing.");
        }
        for (const path of listing) {
          if (!validPath(path) || !/(?:\.kicad_sch|\.sch)$/i.test(path) ||
              path.split("/").slice(0, -1).join("/") !== directory) {
            throw new Error("GitHub returned an unsafe schematic directory listing.");
          }
          candidates.add(path);
          if (candidates.size > PARENT_MAX_CANDIDATES) throw new Error("More than 128 parent-sheet candidates; open the project root directly.");
        }
      }
      }
      await readBatch([...candidates], Math.max(totalBytes, 96 * 1024 * 1024));
      for (const path of candidates) if (cache.get(path) === null) throw new Error(`Parent-sheet source unavailable: ${path}`);
      const edges = new Map();
      for (const path of candidates) {
        const content = cache.get(path);
        edges.set(path, descendants(path, content));
      }
      const reachesLeaf = (path) => {
        const pending=[path],visited=new Set();
        while(pending.length){const current=pending.pop();if(current===file)return true;if(visited.has(current))continue;visited.add(current);for(const child of edges.get(current)||[])if(candidates.has(child)&&!visited.has(child))pending.push(child);}
        return false;
      };
      const ancestors = new Set([...candidates].filter((path) => cache.get(path) !== null && reachesLeaf(path)));
      const root = rootSheetPath([...ancestors].map(path => ({path, content: cache.get(path)})), file);
      if (root) roots = [root];
      else {
        // Keep discovery evidence and all parent branches available for explicit
        // navigation when there is no defensible single root.
        roots = [file, ...[...ancestors].filter(path => path !== file).sort()];
        discoveryWarning = "The saved schematic hierarchy has multiple roots or a parent cycle. No unambiguous root sheet could be selected; choose a sheet in the navigator.";
      }
      const reachable = new Set(), remaining = [...roots];
      while (remaining.length) {
        const path = remaining.pop(); if (reachable.has(path)) continue; reachable.add(path);
        for (const child of edges.get(path) || []) if (!reachable.has(child)) remaining.push(child);
      }
      // Unrelated candidates are discovery evidence, not retained project files.
      // Reclaim their byte budget before loading the actual hierarchy.
      retain(reachable);
      } catch (error) {
        roots = [file];
        retain(new Set([file]));
        discoveryWarning = `Parent-sheet discovery was incomplete (${error.message || "directory unavailable"}). Open the project root for its full hierarchy.`;
      }
    }
    const queue = [...roots], seen = new Set(), files = [];
    while (queue.length) {
      const batch = [];
      for (const path of queue.splice(0)) {
        if (seen.has(path)) continue;
        if (seen.size >= PROJECT_MAX_FILES) throw new Error(`Schematic hierarchy exceeds ${PROJECT_MAX_FILES} files; open a smaller subproject.`);
        seen.add(path); batch.push(path);
      }
      await readBatch(batch);
      for (const path of batch) {
        const content = cache.get(path);
        if (content === null) {
          discoveryWarning=[discoveryWarning,'Referenced sheet unavailable at this revision: '+path+'.'].filter(Boolean).join(' ');
          continue;
        }
        files.push({ path, content });
        for (const child of descendants(path, content)) if (!seen.has(child)) queue.push(child);
      }
    }
    if (/\.sch$/i.test(file)) {
      const libraryPaths=[...new Set(roots.filter(path=>/\.sch$/i.test(path)).map(path=>path.replace(/\.sch$/i,'-cache.lib')))].slice(0,8),legacyLibraries=[];
      for(const path of libraryPaths){try{const content=await read(path);if(content!==null)legacyLibraries.push({path,content});}catch(error){if(error?.name==='AbortError'||/cancelled/i.test(error.message||''))throw error;discoveryWarning=[discoveryWarning,'Legacy cache library unavailable: '+path+' ('+error.message+').'].filter(Boolean).join(' ');}}
      for(const entry of files)if(/\.sch$/i.test(entry.path))entry.legacyLibraries=legacyLibraries;
    }
    if (/\.kicad_(?:sch|pcb)$/i.test(file) && files.some(entry=>entry.content.includes('${'))) {
      const projectPath=roots[0].replace(/\.kicad_(?:sch|pcb)$/i,'.kicad_pro');
      try {
        const content=await read(projectPath);
        if(content!==null){
          if(encoder.encode(content).length>1024*1024)throw Error('Project settings exceed the text-variable metadata limit.');
          const variables=JSON.parse(content)?.text_variables;
          if(variables&&typeof variables==='object'&&!Array.isArray(variables)){
            const entries=Object.entries(variables);let chars=0;
            if(entries.length>256)throw Error('Too many saved project text variables.');
            const textVariables=Object.create(null);
            for(const [name,text] of entries){if(name.length>200||typeof text!=='string'||text.length>16384||(chars+=name.length+text.length)>65536)throw Error('Saved project text variables exceed their metadata limits.');textVariables[name]=text;}
            for(const entry of files)entry.textVariables=textVariables;
          }
        }
      } catch(error){if(error?.name==='AbortError'||/cancelled/i.test(error.message||''))throw error;discoveryWarning=[discoveryWarning,'Saved project text variables unavailable ('+error.message+').'].filter(Boolean).join(' ');}
    }
    if (discoveryWarning && files.length) files[0].discoveryWarning = discoveryWarning;
    return files;
  }

  // Scope one cache to one repository revision/viewer. Cache transport successes,
  // never failures; the renderer still validates asset content before parsing.
  function createModelAssetCache(loadAsset, maxBytes = 24 * 1024 * 1024) {
    if (typeof loadAsset !== "function" || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 24 * 1024 * 1024) throw new Error("Invalid model asset cache configuration.");
    const cached = new Map(), inFlight = new Map(); let bytes = 0, generation = 0;
    async function load(path) {
      if (cached.has(path)) return cached.get(path);
      if (inFlight.has(path)) return inFlight.get(path);
      const current = generation;
      const work = (async () => {
        const result = await loadAsset(path), size = typeof result?.base64 === "string" ? result.base64.length * 2 : Infinity;
        // Account for UTF-16 storage, rather than only decoded model size.
        if (generation === current && size <= maxBytes - bytes && cached.size < 128) { cached.set(path, result); bytes += size; }
        return result;
      })();
      inFlight.set(path, work);
      try { return await work; } finally { if (inFlight.get(path) === work) inFlight.delete(path); }
    }
    function clear() { generation++; bytes = 0; cached.clear(); inFlight.clear(); }
    return { load, clear };
  }

  root.KiCadBrowserData = { validRepository, validRef, validPath, childPath, sheetFiles, rootSheetPath, loadProject, createModelAssetCache, fileByteLimit, PROJECT_MAX_BYTES, PROJECT_MAX_FILES, READ_CONCURRENCY };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadBrowserData;
})(typeof globalThis === "object" ? globalThis : this);
