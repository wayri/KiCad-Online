/* Lazy, source-bound workspace search. Repository text is always inert data. */
((root)=>{
  'use strict';
  const Search=root.KiCadProjectSearch||(typeof require==='function'?require('./project-search.js'):null);
  const Model=root.KiCadDesignModel||(typeof require==='function'?require('./design-model.js'):null);
  const Diff=root.KiCadDesignDiff||(typeof require==='function'?require('./design-diff.js'):null);
  const Draftsman=root.KiCadDraftsmanModel||(typeof require==='function'?require('./draftsman-model.js'):null);
  const MiB=1024*1024;
  const LIMITS=Object.freeze({drawings:128,drawingBytes:8*MiB,sourceBytes:96*MiB,
    inventory:20000,reports:12,reportBytes:MiB,reportTotalBytes:4*MiB,drafts:32,draftKeys:256,draftBytes:4*MiB,draftTotalBytes:8*MiB,
    jsonNodes:12000,records:50000,results:80,scopes:4,debounce:160});
  const caches=new Map();let nextId=0;
  const safePath=path=>typeof path==='string'&&path.length<=1000&&!path.startsWith('/')&&
    !/^[A-Za-z]:/.test(path)&&!/[\\\x00-\x1f\x7f]/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');
  const drawing=path=>/\.kicad_(sch|pcb)$/i.test(path);
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
      if(file.content.length>LIMITS.drawingBytes){warnings.add(file.path+': drawing exceeds 8 MiB and was omitted.');continue;}
      const size=bytes(file.content);
      if(size>LIMITS.drawingBytes){warnings.add(file.path+': drawing exceeds 8 MiB and was omitted.');continue;}
      if(sourceBytes+size>LIMITS.sourceBytes){warnings.add('Drawing search reached its 96 MiB source budget.');break;}
      sourceBytes+=size;files.push(file);
    }
    if((input.files||[]).length>LIMITS.drawings||input.totalDrawings>files.length)warnings.add(`Indexed ${files.length} of ${input.totalDrawings??input.files.length} drawings (maximum 128, 8 MiB each, 96 MiB total).`);
    let sheets=[];const netTables=new Map();
    for(const file of files.filter(f=>/\.kicad_pcb$/i.test(f.path))){
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
    const result=(options.search||Search).search(index.index,query,{limit:LIMITS.results*4}),seen=new Set(),results=[];
    for(const match of result.results){
      const record=match.object.workspaceResult,key=JSON.stringify([record.kind,record.path,record.id||record.uuid||record.reference||record.label]);
      if(seen.has(key))continue;seen.add(key);results.push({...record,query,detail:match.snippets?.map(s=>s.text).join(' · ').slice(0,240)||record.detail});
      if(results.length===(options.limit||LIMITS.results))break;
    }
    return {...result,results,total:results.length,truncated:result.truncated||seen.size>=LIMITS.results,warnings:index.warnings};
  }
  async function read(request,type,extra){
    const reply=await request(type,extra);
    if(reply?.ok===false)throw Error(reply.error||'Project read failed.');
    return reply?.ok===true?reply.result:reply;
  }
  async function load(options){
    const scope={...options.scope},warnings=[];let saved={},inventory={};
    const checkSnapshot=(value,expected)=>{if(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expected||'')&&value?.snapshotRef&&String(value.snapshotRef).toLowerCase()!==expected.toLowerCase())throw Error('Project response revision did not match the requested immutable snapshot.');};
    try{saved=await read(options.request,'project-search-files',scope);if(!Array.isArray(saved?.files))throw Error('Invalid project drawing response.');checkSnapshot(saved,scope.ref);}
    catch(error){saved={};warnings.push('Drawing content unavailable: '+text(error.message));}
    let snapshotRef=saved.snapshotRef||scope.ref;
    try{inventory=await read(options.request,'project-inventory',{...scope,ref:snapshotRef});if(!Array.isArray(inventory?.files))throw Error('Invalid project inventory.');checkSnapshot(inventory,snapshotRef);}
    catch(error){inventory={};warnings.push('File inventory unavailable: '+text(error.message));}
    if(!saved.files&&!inventory.files)throw Error(warnings.join(' '));
    if(!saved.snapshotRef&&inventory.snapshotRef)snapshotRef=inventory.snapshotRef;
    const reports=[];let total=0,attempted=0;
    for(const item of (inventory.files||[]).slice(0,LIMITS.inventory)){
      const path=typeof item==='string'?item:item?.path;
      if(!safePath(path)||!reportPath(path))continue;
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
    return buildRecords({...saved,inventory:inventory.files||[],reports,scope,snapshotRef,warnings:[...warnings,...warningsOf(saved),...warningsOf(inventory)]},options.dependencies);
  }
  function createController(options){
    let epoch=0,disposed=false;const cache=options.cache||caches,key=scopeKey(options.scope);
    function ensure(){
      if(!cache.has(key)){
        while(cache.size>=LIMITS.scopes)cache.delete(cache.keys().next().value);
        const promise=load(options).catch(error=>{if(cache.get(key)===promise)cache.delete(key);throw error;});cache.set(key,promise);
      }
      return cache.get(key);
    }
    return {
      async search(query){
        const ticket=++epoch;if(disposed||!query.trim())return null;const commands=toolResults(query);if(commands.length)return{results:commands,total:commands.length,truncated:false,warnings:[]};
        let indexed;try{indexed=await ensure();}catch(error){if(disposed||ticket!==epoch)return null;throw error;}if(disposed||ticket!==epoch)return null;
        let index=indexed;
        if(options.getDrafts){
          // Drafts are re-read on each explicit query; the immutable source load is shared.
          try{
            const drafts=await options.getDrafts();if(disposed||ticket!==epoch)return null;
            if(drafts?.length){const local=buildRecords({drafts,scope:options.scope},options.dependencies);index={...indexed,index:{...indexed.index,entries:[...indexed.index.entries,...local.index.entries]},warnings:[...new Set([...indexed.warnings,...local.warnings])]};}
          }catch{index={...indexed,warnings:[...indexed.warnings,'Local Draftsman drafts could not be read.']};}
        }
        return searchRecords(index,query,options.dependencies);
      },
      cancel(){epoch++;},destroy(){disposed=true;epoch++;}
    };
  }
  function mount(options){
    const document=options.document||root.document,holder=options.holder||options.host;
    const make=(tag,value)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;return node;};
    const host=make('div');host.className='workspace-project-search';
    const input=make('input');input.type='search';input.placeholder='Search entire project';input.autocomplete='off';input.maxLength=2048;
    input.setAttribute('aria-label','Search entire project');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
    const popover=make('div');popover.className='workspace-project-search-popup';popover.hidden=true;
    const status=make('p','Search saved objects, files, simulations and Draftsman. Ctrl+K to focus.');status.className='workspace-search-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const list=make('div');list.id='workspace-search-results-'+(++nextId);list.setAttribute('role','listbox');input.setAttribute('aria-controls',list.id);
    const warnings=make('p');warnings.className='workspace-search-warnings';popover.append(status,list,warnings);host.append(input,popover);holder.append(host);
    const controller=createController(options);let timer=null,epoch=0,rows=[],active=-1,disposed=false;
    function reveal(){popover.hidden=false;input.setAttribute('aria-expanded','true');}
    function dismiss(){clearTimeout(timer);epoch++;controller.cancel();popover.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
    async function open(result){
      dismiss();try{await options.open(result);}catch(error){if(disposed)return;status.textContent='Could not open result: '+text(error.message);reveal();}
    }
    function activate(index){
      active=index;for(let i=0;i<rows.length;i++)rows[i].setAttribute('aria-selected',String(i===active));
      if(rows[active]){input.setAttribute('aria-activedescendant',rows[active].id);rows[active].scrollIntoView?.({block:'nearest'});}
    }
    async function run(){
      const query=input.value,ticket=++epoch;if(!query.trim()){dismiss();return;}
      reveal();status.textContent='Searching saved project…';list.replaceChildren();rows=[];active=-1;
      try{
        const result=await controller.search(query);if(!result||disposed||ticket!==epoch)return;
        status.textContent=result.error||`${result.results.length} result${result.results.length===1?'':'s'}${result.truncated?' · more matches; narrow your search':''}`;
        warnings.textContent=result.warnings.join(' ');
        for(const [i,item]of result.results.entries()){
          const row=make('div');row.className='workspace-search-result';row.id=list.id+'-'+i;row.setAttribute('role','option');row.setAttribute('aria-selected','false');
          const button=make('button');button.type='button';button.className='workspace-search-open';button.append(make('strong',item.label),make('small',item.kind+' · '+item.path),make('small',item.detail));button.addEventListener('click',()=>open(item));row.append(button);
          if(item.canShow3D){const three=make('button','Show in 3D');three.type='button';three.className='workspace-search-3d';three.addEventListener('click',()=>open({...item,view:'3d'}));row.append(three);}
          row.result=item;list.append(row);rows.push(row);
        }
      }catch(error){if(!disposed&&ticket===epoch){status.textContent='Search unavailable: '+text(error.message)+'. Type again to retry.';warnings.textContent='';}}
    }
    function onInput(){clearTimeout(timer);epoch++;controller.cancel();rows=[];active=-1;list.replaceChildren();input.removeAttribute('aria-activedescendant');if(!input.value.trim()){dismiss();return;}reveal();timer=setTimeout(run,LIMITS.debounce);}
    function onKey(event){
      if(event.key==='Escape'){dismiss();return;}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();reveal();if(rows.length)activate((active+(event.key==='ArrowDown'?1:active<0?0:-1)+rows.length)%rows.length);return;}
      if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);if(rows[active]&&!popover.hidden)open(rows[active].result);else run();}
    }
    function onGlobalKey(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!event.altKey){event.preventDefault();input.focus();input.select?.();reveal();}}
    function onOutside(event){if(!host.contains(event.target))dismiss();}
    input.addEventListener('input',onInput);input.addEventListener('keydown',onKey);document.addEventListener('keydown',onGlobalKey);document.addEventListener('pointerdown',onOutside);
    return {input,popover,controller,destroy(){disposed=true;dismiss();controller.destroy();document.removeEventListener('keydown',onGlobalKey);document.removeEventListener('pointerdown',onOutside);host.remove();}};
  }
  const api={LIMITS,safePath,toolResults,scopedDrafts,buildRecords,searchRecords,createController,mount};root.KiCadWorkspaceSearch=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
