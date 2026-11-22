/* Source-bound workspace search. Repository text is always inert data. */
((root)=>{
  'use strict';
  const Search=root.KiCadProjectSearch||(typeof require==='function'?require('./project-search.js'):null);
  const Model=root.KiCadDesignModel||(typeof require==='function'?require('./design-model.js'):null);
  const Diff=root.KiCadDesignDiff||(typeof require==='function'?require('./design-diff.js'):null);
  const Draftsman=root.KiCadDraftsmanModel||(typeof require==='function'?require('./draftsman-model.js'):null);
  const MiB=1024*1024;
  const LIMITS=Object.freeze({drawings:128,drawingBytes:64*MiB,sourceBytes:96*MiB,
    inventory:20000,reports:12,reportBytes:MiB,reportTotalBytes:4*MiB,drafts:32,draftKeys:256,draftBytes:4*MiB,draftTotalBytes:8*MiB,
    jsonNodes:12000,records:50000,results:80,scopes:4,debounce:160});
  const caches=new Map();let nextId=0;
  const safePath=path=>typeof path==='string'&&path.length<=1000&&!path.startsWith('/')&&
    !/^[A-Za-z]:/.test(path)&&!/[\\\x00-\x1f\x7f]/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');
  const drawing=path=>/\.(?:kicad_(?:sch|pcb)|sch)$/i.test(path);
  const bytes=text=>new TextEncoder().encode(text).byteLength;
  const text=(value,max=500)=>String(value??'').slice(0,max);
  const normalizedScope=scope=>({repository:scope?.repository||'',ref:scope?.ref||'',provider:scope?.provider||'github',host:scope?.host||'https://github.com'});
  const scopeKey=scope=>JSON.stringify(Object.values(normalizedScope(scope)));
  const reportPath=path=>/\.(wbk|raw|csv|tsv)$/i.test(path)||(/\.json$/i.test(path)&&/draftsman|simulat|spice|report|analysis|(?:^|[._/-])(?:erc|drc)(?:[._/-]|$)/i.test(path));
  const viewFor=path=>/draftsman/i.test(path)?'draftsman':/\.(wbk|raw|csv|tsv)$/i.test(path)||/simulat|spice/i.test(path)?'simulation':undefined;
  function sameScope(source,scope){return source&&scopeKey(source)===scopeKey(scope);}
  function scopedDrafts(storage,scope){
    const drafts=[];let total=0;
    const model=root.KiCadDraftsmanModel||Draftsman;
    if(!storage||!model?.validate)return drafts;
    const count=Math.min(Number(storage.length)||0,LIMITS.draftKeys);
    for(let i=0;i<count&&drafts.length<LIMITS.drafts;i++){
      try{
        const key=storage.key(i);if(typeof key!=='string'||!key.startsWith('kivi:draftsman:')||key.length>2400)continue;
        const identity=JSON.parse(key.slice('kivi:draftsman:'.length));
        if(!Array.isArray(identity)||identity.length!==6||identity.some(v=>typeof v!=='string')||!safePath(identity[4])||!drawing(identity[4])||!/^[a-f0-9]{64}$/.test(identity[5]))continue;
        const source={provider:identity[0],host:identity[1],repository:identity[2],ref:identity[3],file:identity[4]};
        // Inspect the scoped key before reading a document from browser storage.
        if(!sameScope(source,scope))continue;
        const raw=storage.getItem(key);if(typeof raw!=='string'||raw.length>LIMITS.draftBytes)continue;
        const size=bytes(raw);if(size>LIMITS.draftBytes||size+total>LIMITS.draftTotalBytes)continue;total+=size;
        const document=model.validate(raw);if(!sameScope(document.source,scope))continue;
        drafts.push({source,document,label:document.title||'Local Draftsman draft'});
      }catch{/* Invalid or inaccessible storage records do not affect project search. */}
    }
    return drafts;
  }
  function warningsOf(value){return (Array.isArray(value?.warnings)?value.warnings:[]).slice(0,40).map(w=>text(w,600));}
  function jsonFields(value,warnings){
    const fields=[],stack=[['',value]];let visited=0;
    while(stack.length&&visited++<LIMITS.jsonNodes){
      const [key,item]=stack.pop();
      if(item&&typeof item==='object'){
        const entries=Object.entries(item);if(entries.length>LIMITS.jsonNodes)warnings.add('Large JSON collections are only partially indexed.');
        for(let i=Math.min(entries.length,LIMITS.jsonNodes)-1;i>=0;i--)stack.push([text(key?key+'.'+entries[i][0]:entries[i][0],300),entries[i][1]]);
      }else if(item!==undefined&&item!==null)fields.push([key||'value',text(item,4096)]);
    }
    if(stack.length)warnings.add('Saved JSON search reached its node budget; remaining values are omitted.');
    return fields;
  }
  function buildRecords(input={},dependencies={}){
    const search=dependencies.search||Search,model=dependencies.model||Model,warnings=new Set(warningsOf(input));
    const records=[],objects=[];let sourceBytes=0;
    const add=(result,properties={},object=null)=>{
      if(records.length>=LIMITS.records){warnings.add('Workspace search reached its 50000-record budget.');return;}
      const id='workspace:'+records.length;
      const entry=object?{...object,id,properties:{...object.properties,path:result.path}}:
        {id,path:result.path,kind:result.kind,label:result.label,properties:{...properties,path:result.path}};
      entry.workspaceResult=result;objects.push(entry);records.push(result);
    };
    const files=[],drawingPaths=new Set();
    for(const file of (input.files||[]).slice(0,LIMITS.drawings)){
      if(!safePath(file?.path)||!drawing(file.path)||typeof file.content!=='string')continue;
      if(drawingPaths.has(file.path)){warnings.add(file.path+': duplicate drawing source omitted.');continue;}drawingPaths.add(file.path);
      if(file.content.length>LIMITS.drawingBytes){warnings.add(file.path+': drawing exceeds 64 MiB and was omitted.');continue;}
      const size=bytes(file.content);
      if(size>LIMITS.drawingBytes){warnings.add(file.path+': drawing exceeds 64 MiB and was omitted.');continue;}
      if(sourceBytes+size>LIMITS.sourceBytes){warnings.add('Drawing search reached its 96 MiB source budget.');break;}
      sourceBytes+=size;files.push(file);
    }
    if((input.files||[]).length>LIMITS.drawings||input.totalDrawings>files.length)warnings.add(`Indexed ${files.length} of ${input.totalDrawings??input.files.length} drawings (maximum 128, 64 MiB each, 96 MiB total).`);
    let sheets=[];const netTables=new Map();
    for(const file of files.filter(f=>/\.kicad_pcb$/i.test(f.path)&&/\(net\s+\d+\s+"/.test(f.content))){
      try{
        const ast=(dependencies.diff||Diff).parse(file.content),table=new Map();
        for(const form of ast){if(Array.isArray(form)&&form[0]==='net'&&typeof form[2]?.quoted==='string')table.set(String(form[1]),form[2].quoted);}
        netTables.set(file.path,table);
      }catch{/* The design-model path reports malformed drawings below. */}
    }
    function addDesign(built){
        sheets.push(...(built.sheets||[]));
        for(const warning of warningsOf(built))warnings.add(warning);
        for(const object of built.objects||[]){
          const properties={...object.properties},savedNet=netTables.get(object.path)?.get(String(properties.Net));
          if(savedNet!==undefined)properties.Net=savedNet;
          if(['label','global_label','hierarchical_label'].includes(object.kind)&&typeof properties.Text==='string')properties.Net=properties.Text;
          const result={kind:'object',id:object.id,path:object.path,label:text(object.label||object.reference||object.kind),
            detail:text([object.kind,object.properties?.Value].filter(Boolean).join(' · ')),position:object.position,
            uuid:object.uuid,reference:object.reference,objectKind:object.kind};
          if(typeof properties.Net==='string'&&properties.Net)result.netName=properties.Net;
          if(object.kind==='footprint'&&/\.kicad_pcb$/i.test(object.path))result.canShow3D=true;
          add(result,{}, {...object,properties});
        }
    }
    if(files.length){
      try{addDesign(model.buildProject(files));}
      catch(error){
        warnings.add('Some drawing content could not be indexed: '+text(error.message));
        // A damaged sheet must not hide the valid drawings in the same project.
        for(const file of files){try{addDesign(model.buildProject([file]));}catch(failure){warnings.add(file.path+': '+text(failure.message));}}
      }
    }
    const inventory=Array.isArray(input.inventory)?input.inventory:[];
    const seen=new Set();
    for(const item of [...inventory.slice(0,LIMITS.inventory),...files,...(input.settings||[])]){
      const path=typeof item==='string'?item:item?.path;if(!safePath(path)||seen.has(path))continue;seen.add(path);
      add({kind:'file',path,label:path.split('/').at(-1),detail:path,view:viewFor(path)},{filename:path});
    }
    if(inventory.length>LIMITS.inventory)warnings.add('File-name search is limited to the first 20000 inventory entries.');
    let reportBytes=0,reportCount=0;
    for(const file of [...(input.settings||[]).slice(0,8),...(input.reports||[]).slice(0,LIMITS.reports)]){
      if(!safePath(file?.path)||typeof file.content!=='string')continue;
      if(file.content.length>LIMITS.reportBytes){warnings.add(file.path+': saved text exceeds 1 MiB and was omitted.');continue;}
      const size=bytes(file.content);if(size>LIMITS.reportBytes||reportBytes+size>LIMITS.reportTotalBytes){warnings.add('Saved report text reached its 1 MiB per file / 4 MiB total budget.');continue;}
      reportBytes+=size;reportCount++;
      if(file.content.includes('\0')){warnings.add(file.path+': binary output is indexed by file name only.');continue;}
      const base={kind:'report',path:file.path,label:file.path.split('/').at(-1),view:viewFor(file.path)};
      if(/\.(json|kicad_pro|wbk)$/i.test(file.path)){
        try{
          let parsed=JSON.parse(file.content),record=base;
          const draftsman=root.KiCadDraftsmanModel||Draftsman;
          if(parsed?.schema==='pocket-kivi-draftsman/v1'){
            try{
              if(!draftsman?.validate)throw Error('Draftsman validation is unavailable.');
              const document=draftsman.validate(parsed);
              if(!sameScope(document.source,input.scope))throw Error('Document belongs to another source revision.');
              const references=[...new Set([...(document.pages||[]).flatMap(page=>page.items.filter(item=>item.type==='view').map(item=>item.file)),...Object.keys(document.source.hashes||{})])].filter(path=>safePath(path)&&/\.kicad_pcb$/i.test(path));
              const sourceFile=references.length===1?references[0]:references.includes(input.scope?.file)?input.scope.file:undefined;
              record={...base,kind:'draft',label:document.title||base.label,view:'draftsman',document,sourceFile};
              parsed=Object.fromEntries(Object.entries(document).filter(([key])=>key!=='source'));
            }catch(error){warnings.add(file.path+': '+text(error.message)+' Indexed as inert saved JSON.');}
          }
          for(const [key,value]of jsonFields(parsed,warnings))add({...record,detail:text(key+': '+value,240)},{[key]:value,content:key+' '+value});
          continue;
        }catch{warnings.add(file.path+': not valid saved JSON; bounded plain text was indexed.');}
      }
      // Overlap preserves phrases spanning a chunk boundary without loading HTML.
      for(let at=0;at<file.content.length;at+=3968){const content=file.content.slice(at,at+4096);add({...base,detail:text(content,240)},{content});}
    }
    let draftBytes=0;
    for(const draft of (input.drafts||[]).slice(0,LIMITS.drafts)){
      if(!sameScope(draft?.source,input.scope)||!safePath(draft.source.file))continue;
      let document=draft.document;
      try{
        if(typeof document==='string'){if(document.length>LIMITS.draftBytes||bytes(document)>LIMITS.draftBytes)throw Error();document=JSON.parse(document);}
        if(!document||typeof document!=='object')continue;
        const serialized=JSON.stringify(document),size=bytes(serialized);if(serialized.length>LIMITS.draftBytes||size>LIMITS.draftBytes||size+draftBytes>LIMITS.draftTotalBytes)throw Error();draftBytes+=size;
        const content=Object.fromEntries(Object.entries(document).filter(([key])=>key!=='source'));
        const fields=jsonFields(content,warnings),result={kind:'draft',path:draft.source.file,label:text(draft.label||'Local Draftsman draft'),detail:'Saved locally · '+draft.source.file,view:'draftsman',document};
        // Never index the draft envelope/source; only its explicitly scoped document.
        for(const [key,value]of fields)add({...result,detail:text(key+': '+value,240)},{[key]:value,content:key+' '+value});
        if(!fields.length)add(result,{content:result.label});
      }catch{warnings.add('An oversized or invalid local Draftsman draft was omitted.');}
    }
    if((input.drafts||[]).length>LIMITS.drafts)warnings.add('Only the first 32 supplied local drafts are indexed.');
    const index=search.createIndex(objects,{sheets});for(const warning of index.warnings||[])warnings.add(warning);
    warnings.add('Coverage: saved drawings, file names, project settings, bounded simulation/report text and supplied local Draftsman drafts. Binary/3D model contents and unsaved edits are not indexed.');
    return {records,index,warnings:[...warnings],snapshotRef:input.snapshotRef,drawings:files.length,reportCount};
  }
  function toolResults(query){
    const key=String(query||'').trim().toLowerCase().replace(/^>\s*/,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ');
    return ['sheet tree','sheet browser','sheet navigator','show sheet tree','open sheet tree','minimap','mini map','sheet map'].includes(key)?[{kind:'command',action:'sheet-tree',label:'Show sheet browser',detail:'Reopen the floating schematic sheet tree',path:''}]:[];
  }
  function searchRecords(index,query,options={}){
    const result=(options.search||Search).search(index.index,query,{limit:LIMITS.results*4,preferredPath:options.preferredPath}),seen=new Set(),results=[];
    for(const match of result.results){
      const record=match.object.workspaceResult,key=JSON.stringify([record.kind,record.path,record.id||record.uuid||record.reference||record.label]);
      if(seen.has(key))continue;
      seen.add(key);
      const snippets=[...new Set((match.snippets||[]).map(item=>item.text).filter(value=>value!==record.label))];
      results.push({...record,query,detail:snippets.join(' · ').slice(0,240)||record.detail});
      if(results.length===(options.limit||LIMITS.results))break;
    }
    return {...result,results,total:results.length,truncated:result.truncated||seen.size>=LIMITS.results,warnings:index.warnings};
  }
  async function read(request,type,extra){
    const reply=await request(type,extra);
    if(reply?.ok===false)throw Error(reply.error||'Project read failed.');
    return reply?.ok===true?reply.result:reply;
  }
  async function loadReports(options,scope,inventory,snapshotRef){
    const warnings=[];
    const reports=[];let total=0,attempted=0;
    for(const item of (inventory.files||[]).slice(0,LIMITS.inventory)){
      const path=typeof item==='string'?item:item?.path;
      if(!safePath(path)||!reportPath(path)&&!(options.project&&/\.(?:kicad_pro|pro)$/i.test(path)))continue;
      if(attempted>=LIMITS.reports){warnings.push('Saved report content is limited to 12 eligible files.');break;}
      if(Number.isFinite(item.size)&&(item.size>LIMITS.reportBytes||item.size+total>LIMITS.reportTotalBytes)){warnings.push(path+': report exceeds the saved-text byte budget.');continue;}
      attempted++;
      try{
        const file=await read(options.request,'project-file',{...scope,ref:snapshotRef,file:path});
        if(typeof file?.content!=='string')throw Error('Saved text unavailable.');
        if(file.path&&file.path!==path)throw Error('Saved file path did not match.');
        if(file.snapshotRef&&file.snapshotRef!==snapshotRef)throw Error('Saved file revision did not match the project snapshot.');
        if(file.content.length>LIMITS.reportBytes)throw Error('Saved text exceeds 1 MiB.');
        const size=bytes(file.content);if(size>LIMITS.reportBytes||size+total>LIMITS.reportTotalBytes)throw Error('Saved report text exceeds 1 MiB per file / 4 MiB total.');
        total+=size;reports.push({path,content:file.content});
      }catch(error){warnings.push(path+': '+text(error.message));}
    }
    return {reports,warnings};
  }
  const projectStem=path=>path.replace(/\.(?:kicad_(?:pro|sch|pcb)|pro|sch)$/i,'');
  const folder=path=>path.split('/').slice(0,-1).join('/');
  function relatedInventory(inventory,paths,anchors){
    const supported=/\.(?:kicad_pro|pro|wbk|raw|csv|tsv|json|pdf|gbr|gerber|drl|kicad_wks|kicad_dru|kicad_sym|kicad_mod|step|stp|wrl|glb|svg|png|bmp|jpe?g)$/i;
    const entries=inventory.slice(0,LIMITS.inventory);
    const valid=entries.filter(item=>safePath(item?.path));
    const projectFile=/\.(?:kicad_pro|pro)$/i;
    const stems=new Set(anchors.map(projectStem));
    const ownDirectories=new Set(),otherProjects=new Map();
    for(const {path}of valid){
      if(!projectFile.test(path))continue;
      const directory=folder(path),stem=projectStem(path);
      if(stems.has(stem))ownDirectories.add(directory);
      else{
        if(!otherProjects.has(directory))otherProjects.set(directory,[]);
        otherProjects.get(directory).push(stem);
      }
    }
    const namedFor=(path,stem)=>['.','-','_'].some(separator=>path.startsWith(stem+separator));
    return valid.filter(item=>{
      const path=item.path;
      if(paths.has(path))return true;
      if(!supported.test(path))return false;
      if(projectFile.test(path))return stems.has(projectStem(path));
      const directory=folder(path);
      const namedStem=[...stems].find(stem=>directory===folder(stem)&&namedFor(path,stem));
      if(namedStem)return !otherProjects.get(directory)?.some(stem=>stem.length>namedStem.length&&namedFor(path,stem));
      // Shared folders have no implicit ownership. A nested project ends its parent's scope.
      const parts=path.split('/').slice(0,-1);
      while(parts.length||ownDirectories.has('')){
        const current=parts.join('/');
        if(otherProjects.has(current))return false;
        if(ownDirectories.has(current)){
          if(current===directory)return true;
          const relative=path.slice(current?current.length+1:0);
          return /^(?:analysis|reports?|results?|simulations?|models?|fabrication|gerbers?|manufacturing)\//i.test(relative);
        }
        if(!parts.length)break;
        parts.pop();
      }
      return false;
    });
  }
  function scopedProject(options,build){
    const {scope,project}=options,snapshotRef=scope.ref,entry=scope.file,anchor=projectStem(entry);
    const inputs=new Map(),warnings=[];
    const loadDrawing=path=>{
      if(!inputs.has(path))inputs.set(path,Promise.resolve().then(()=>project.loadDrawing(path)).then(files=>{
        if(!Array.isArray(files)||!files.some(file=>file.path===path))throw Error('Saved drawing unavailable: '+path);
        const rootPath=!/\.kicad_pcb$/i.test(path)?root.KiCadBrowserData?.rootSheetPath(files,path)||path:path;
        return {path,rootPath,files};
      }));
      return inputs.get(path);
    };
    const primary=drawing(entry)?[entry]:[anchor+(/\.pro$/i.test(entry)?'.sch':'.kicad_sch'),anchor+'.kicad_pcb'];
    const first=Promise.any(primary.map(loadDrawing));
    const paths=new Set(),anchors=new Set([entry]);
    const buildDrawing=({rootPath,files})=>{
      anchors.add(rootPath);
      const fresh=files.filter(file=>safePath(file.path)&&drawing(file.path)&&!paths.has(file.path));
      for(const file of fresh)paths.add(file.path);
      return build({files:fresh,inventory:fresh.map(file=>({path:file.path})),scope,snapshotRef,warnings:fresh.map(file=>file.discoveryWarning).filter(Boolean)});
    };
    const merge=(a,b)=>({...a,records:[...a.records,...b.records].slice(0,LIMITS.records),index:{...a.index,entries:[...a.index.entries,...b.index.entries].slice(0,LIMITS.records)},
      warnings:[...new Set([...a.warnings,...b.warnings])],drawings:a.drawings+b.drawings,reportCount:a.reportCount+b.reportCount});
    const source={pending:true};
    source.core=first.then(buildDrawing,()=>build({scope,snapshotRef,inventory:[{path:entry}],warnings:['Saved drawings are unavailable for this project.']}));
    const drawings=first.then(async selected=>{
      const stem=projectStem(selected.rootPath),other=/\.kicad_pcb$/i.test(selected.path)?stem+'.kicad_sch':stem+'.kicad_pcb';
      const requested=[...new Set([...primary,other,...(project.openDrawings||[])])].filter(path=>safePath(path)&&drawing(path)&&path!==selected.path);
      const companions=await Promise.allSettled(requested.map(loadDrawing));
      let indexed=await source.core;
      for(const result of companions)if(result.status==='fulfilled')indexed=merge(indexed,await buildDrawing(result.value));
      return indexed;
    },()=>source.core);
    source.stages=[drawings];
    // Supplemental file discovery never holds up drawing results.
    const listing=first.catch(()=>null).then(()=>project.loadInventory?.()).catch(error=>{
      warnings.push('Related file listing unavailable: '+text(error.message));return null;
    });
    source.complete=Promise.all([drawings,listing]).then(async([indexed,inventory])=>{
      if(inventory?.snapshotRef&&String(inventory.snapshotRef).toLowerCase()!==snapshotRef.toLowerCase()){
        warnings.push('Related file listing revision did not match the open project.');inventory=null;
      }
      const entries=relatedInventory(inventory?.files||[],paths,[...anchors]).filter(item=>!paths.has(item.path));
      const settings=entries.filter(item=>/\.(?:kicad_pro|pro)$/i.test(item.path));
      const extra=await loadReports(options,scope,{files:[...settings,...entries.filter(item=>reportPath(item.path))]},snapshotRef);
      return merge(indexed,await build({scope,snapshotRef,inventory:entries,reports:extra.reports,warnings:[...warnings,...extra.warnings]}));
    }).finally(()=>{source.pending=false;});
    for(const stage of [source.core,drawings])stage.catch(()=>{});
    return source;
  }
  async function load(options){
    const build=(source)=>root.KiCadLoading?.run&&!options.dependencies?
      root.KiCadLoading.run('workspace-search',source,()=>buildRecords(source)):
      Promise.resolve().then(()=>buildRecords(source,options.dependencies));
    if(options.project)return scopedProject(options,build);
    const scope={...options.scope},warnings=[];let saved={},inventory={};
    const checkSnapshot=(value,expected)=>{if(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expected||'')&&value?.snapshotRef&&String(value.snapshotRef).toLowerCase()!==expected.toLowerCase())throw Error('Project response revision did not match the requested immutable snapshot.');};
    try{saved=await read(options.request,'project-search-files',scope);if(!Array.isArray(saved?.files))throw Error('Invalid project drawing response.');checkSnapshot(saved,scope.ref);}
    catch(error){saved={};warnings.push('Drawing content unavailable: '+text(error.message));}
    let snapshotRef=saved.snapshotRef||scope.ref;
    try{inventory=Array.isArray(saved.inventory)?{files:saved.inventory,snapshotRef:saved.snapshotRef}:await read(options.request,'project-inventory',{...scope,ref:snapshotRef});if(!Array.isArray(inventory?.files))throw Error('Invalid project inventory.');checkSnapshot(inventory,snapshotRef);}
    catch(error){inventory={};warnings.push('File inventory unavailable: '+text(error.message));}
    if(!saved.files&&!inventory.files)throw Error(warnings.join(' '));
    if(!saved.snapshotRef&&inventory.snapshotRef)snapshotRef=inventory.snapshotRef;
    const input={...saved,inventory:inventory.files||[],scope,snapshotRef,
      warnings:[...warnings,...warningsOf(saved),...warningsOf(inventory)]};
    const core=build(input);
    const source={core,pending:true};
    source.complete=Promise.all([core,loadReports(options,scope,inventory,snapshotRef)]).then(async([indexed,extra])=>{
      if(!extra.reports.length)return {...indexed,warnings:[...indexed.warnings,...extra.warnings]};
      const supplemental=await build({...extra,scope,snapshotRef});
      if(!indexed.index.entries.length)return {...supplemental,warnings:[...new Set([...indexed.warnings,...supplemental.warnings])]};
      return {...indexed,index:{...indexed.index,entries:[...indexed.index.entries,...supplemental.index.entries]},
        warnings:[...new Set([...indexed.warnings,...supplemental.warnings])],reportCount:supplemental.reportCount};
    }).finally(()=>{source.pending=false;});
    return source;
  }
  function createController(options){
    let epoch=0,disposed=false;const cache=options.cache||caches;
    const directory=String(options.scope?.file||'').split('/').slice(0,-1).join('/');
    function ensure(){
      const openDrawings=options.project?.openDrawings?.slice();
      const key=JSON.stringify([scopeKey(options.scope),options.project?options.scope.file:directory,openDrawings]);
      if(!cache.has(key)){
        while(cache.size>=LIMITS.scopes)cache.delete(cache.keys().next().value);
        const clear=()=>{if(cache.get(key)===promise)cache.delete(key);};
        const promise=load(options.project?{...options,project:{...options.project,openDrawings}}:options).then(source=>{source.complete.catch(clear);return source;},error=>{clear();throw error;});
        cache.set(key,promise);
      }
      return cache.get(key);
    }
    return {
      preload(){return ensure().then(source=>source.core);},
      setCompanion(path){
        if(!options.project||options.project.openDrawings?.[0]===path)return;
        options.project.openDrawings=path?[path]:[];
        epoch++;
        void this.preload().catch(()=>{});
      },
      async search(query,onPartial){
        const ticket=++epoch;if(disposed||!query.trim())return null;const commands=toolResults(query);if(commands.length)return{results:commands,total:commands.length,truncated:false,warnings:[]};
        const ranking={...options.dependencies,preferredPath:options.activePath?.()||options.scope?.file};
        let indexed;
        try{
          const source=await ensure();
          if(onPartial&&source.pending){
            let preceding;
            for(const stage of [source.core,...(source.stages||[])]){
              const indexed=await stage;
              if(disposed||ticket!==epoch)return null;
              if(source.pending&&indexed!==preceding)onPartial(searchRecords(indexed,query,ranking));
              preceding=indexed;
            }
          }
          indexed=await source.complete;
        }catch(error){if(disposed||ticket!==epoch)return null;throw error;}
        if(disposed||ticket!==epoch)return null;
        let index=indexed;
        if(options.getDrafts){
          // Drafts are re-read on each explicit query; the immutable source load is shared.
          try{
            const drafts=await options.getDrafts();if(disposed||ticket!==epoch)return null;
            const allowed=options.project?new Set(indexed.records.filter(record=>record.kind==='file'&&drawing(record.path)).map(record=>record.path)):null;
            const localDrafts=allowed?drafts?.filter(draft=>allowed.has(draft.source?.file)):drafts;
            if(localDrafts?.length){const local=buildRecords({drafts:localDrafts,scope:options.scope},options.dependencies);index={...indexed,index:{...indexed.index,entries:[...indexed.index.entries,...local.index.entries]},warnings:[...new Set([...indexed.warnings,...local.warnings])]};}
          }catch{index={...indexed,warnings:[...indexed.warnings,'Local Draftsman drafts could not be read.']};}
        }
        return searchRecords(index,query,ranking);
      },
      cancel(){epoch++;},destroy(){disposed=true;epoch++;}
    };
  }
  function mount(options){
    const document=options.document||root.document,holder=options.holder||options.host;
    const make=(tag,value)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;return node;};
    const host=make('div');host.className='workspace-project-search';
    const input=make('input');input.type='search';input.placeholder='Search open KiCad project';input.autocomplete='off';input.maxLength=2048;
    input.setAttribute('aria-label','Search open KiCad project');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
    const popover=make('div');popover.className='workspace-project-search-popup';popover.hidden=true;
    const status=make('p','Search saved objects, files, simulations and Draftsman. Ctrl+K to focus.');status.className='workspace-search-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const list=make('div');list.id='workspace-search-results-'+(++nextId);list.setAttribute('role','listbox');input.setAttribute('aria-controls',list.id);
    const coverage=make('details'),warnings=make('p');
    coverage.className='workspace-search-coverage';coverage.hidden=true;
    warnings.className='workspace-search-warnings';coverage.append(make('summary','Search coverage'),warnings);
    popover.append(status,list,coverage);
    if(root.KiCadUIIcons)host.append(root.KiCadUIIcons.icon('search'));
    host.append(input,popover);holder.append(host);
    const controller=createController(options);if(options.project)void controller.preload().catch(()=>{});let timer=null,epoch=0,rows=[],active=-1,disposed=false;
    function reveal(){popover.hidden=false;input.setAttribute('aria-expanded','true');}
    function dismiss(){clearTimeout(timer);epoch++;controller.cancel();popover.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
    async function open(result){
      dismiss();try{await options.open(result);}catch(error){if(disposed)return;status.textContent='Could not open result: '+text(error.message);reveal();}
    }
    function activate(index){
      active=index;for(let i=0;i<rows.length;i++)rows[i].setAttribute('aria-selected',String(i===active));
      if(rows[active]){input.setAttribute('aria-activedescendant',rows[active].id);rows[active].scrollIntoView?.({block:'nearest'});}
    }
    function render(result,pending=false){
      const previous=rows[active]?.result;
      const sameResult=item=>previous&&item.kind===previous.kind&&item.path===previous.path&&
        (item.uuid||item.id||item.label)===(previous.uuid||previous.id||previous.label);
      status.textContent=result.error||(
        `${result.results.length} result${result.results.length===1?'':'s'}${pending?' · Indexing related files…':result.truncated?' · More matches available':''}`
      );
      warnings.textContent=pending?'':result.warnings.filter(w=>!w.startsWith('Coverage:')).join(' ');
      coverage.hidden=!warnings.textContent;
      list.replaceChildren();rows=[];active=-1;input.removeAttribute('aria-activedescendant');
      for(const [i,item]of result.results.entries()){
        const row=make('div');row.className='workspace-search-result';row.id=list.id+'-'+i;row.setAttribute('role','option');row.setAttribute('aria-selected','false');
        const button=make('button');button.type='button';button.className='workspace-search-open';
        const matched=item.detail&&item.detail!==item.label?make('small',item.detail):null;
        const kind=item.objectKind||item.kind;
        const category=kind.charAt(0).toUpperCase()+kind.slice(1).replaceAll('_',' ');
        button.append(make('strong',item.label),make('small',item.path?category+' · '+item.path:item.detail));
        if(item.path&&matched)button.append(matched);
        button.addEventListener('click',()=>open(item));row.append(button);
        if(item.canShow3D){const three=make('button','Show in 3D');three.type='button';three.className='workspace-search-3d';three.addEventListener('click',()=>open({...item,view:'3d'}));row.append(three);}
        row.result=item;list.append(row);rows.push(row);
      }
      const selected=result.results.findIndex(sameResult);
      if(selected>=0)activate(selected);
    }
    async function run(){
      const query=input.value,ticket=++epoch;if(!query.trim()){dismiss();return;}
      reveal();status.textContent='Searching saved project…';list.replaceChildren();rows=[];active=-1;
      try{
        const result=await controller.search(query,partial=>{if(partial.results.length&&!disposed&&ticket===epoch)render(partial,true);});
        if(result&&!disposed&&ticket===epoch)render(result);
      }catch(error){if(!disposed&&ticket===epoch){status.textContent='Search unavailable: '+text(error.message)+'. Type again to retry.';warnings.textContent='';coverage.hidden=true;}}
    }
    function onInput(){clearTimeout(timer);epoch++;controller.cancel();rows=[];active=-1;list.replaceChildren();input.removeAttribute('aria-activedescendant');if(!input.value.trim()){dismiss();return;}reveal();status.textContent='Searching saved project…';warnings.textContent='';coverage.hidden=true;timer=setTimeout(run,LIMITS.debounce);}
    function onKey(event){
      if(event.key==='Escape'){dismiss();return;}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();reveal();if(rows.length)activate((active+(event.key==='ArrowDown'?1:active<0?0:-1)+rows.length)%rows.length);return;}
      if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);const selected=rows[active<0?0:active];if(selected&&!popover.hidden)open(selected.result);else run();}
    }
    function onGlobalKey(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!event.altKey){event.preventDefault();input.focus();input.select?.();reveal();}}
    function onOutside(event){if(!host.contains(event.target))dismiss();}
    input.addEventListener('input',onInput);input.addEventListener('keydown',onKey);document.addEventListener('keydown',onGlobalKey);document.addEventListener('pointerdown',onOutside);
    return {input,popover,controller,setCompanion(path){dismiss();controller.setCompanion(path);},destroy(){disposed=true;dismiss();controller.destroy();document.removeEventListener('keydown',onGlobalKey);document.removeEventListener('pointerdown',onOutside);host.remove();}};
  }
  const api={LIMITS,safePath,toolResults,scopedDrafts,buildRecords,searchRecords,createController,mount};root.KiCadWorkspaceSearch=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
