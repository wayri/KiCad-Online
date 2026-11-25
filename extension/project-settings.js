/* Read-only saved KiCad project/setup data. No rule evaluation or default synthesis. */
((root) => {
  'use strict';
  const LIMITS=Object.freeze({bytes:8*1024*1024,depth:64,nodes:100000,entries:50000});
  const pointer=(parts)=>'/'+parts.map(p=>String(p).replace(/~/g,'~0').replace(/\//g,'~1')).join('/');
  const human=(key)=>String(key).replace(/_/g,' ').replace(/\b(?:pcb|erc|drc|bom|dnp|3d)\b/gi,m=>m.toUpperCase());
  const scalar=v=>v&&typeof v==='object'&&!Array.isArray(v)?v.quoted:v;
  const tag=n=>Array.isArray(n)?String(scalar(n[0])):'';
  const children=(n,t)=>(n||[]).filter(v=>Array.isArray(v)&&tag(v)===t);
  const child=(n,t)=>children(n,t)[0];
  const field=(n,t)=>scalar(child(n,t)?.[1])??null;
  function validateSize(text,maxBytes=LIMITS.bytes){
    if(typeof text!=='string')throw new TypeError('KiCad settings source must be text.');
    if(text.length>maxBytes||new TextEncoder().encode(text).byteLength>maxBytes)throw new Error('Settings file exceeds '+maxBytes/(1024*1024)+' MiB.');
  }
  function copyTree(input,boardGeometrySlots=false){
    let nodes=0;
    function copy(v,depth){
      if(boardGeometrySlots&&depth===1&&v===null)return null;
      if(++nodes>LIMITS.nodes)throw new Error('Settings contain too many values.');
      if(depth>LIMITS.depth)throw new Error('Settings nesting exceeds 64 levels.');
      if(v===null||typeof v!=='object'){
        if(typeof v==='number'&&!Number.isFinite(v))throw new Error('Non-finite saved numeric setting.');
        return v;
      }
      if(Array.isArray(v))return v.map(x=>copy(x,depth+1));
      const result=Object.create(null);
      for(const key of Object.keys(v))result[key]=copy(v[key],depth+1);
      return result;
    }
    return copy(input,0);
  }
  function flattened(tree,base=[]){
    const entries=[];
    function visit(v,parts){
      const keys=v!==null&&typeof v==='object'?Object.keys(v):[];
      if(!keys.length){
        if(entries.length>=LIMITS.entries)throw new Error('Settings have more than 50000 leaf values.');
        entries.push({path:pointer(parts),label:human(parts.at(-1)||'Value'),value:v});return;
      }
      for(const key of keys)visit(v[key],parts.concat(key));
    }
    visit(tree,base);return entries;
  }
  const sectionLabel={board:'Board setup',schematic:'Schematic setup',erc:'Electrical rules (ERC)',net_settings:'Net classes and assignments',component_class_settings:'Component class rules',text_variables:'Text variables',pcbnew:'PCB editor settings',eeschema:'Schematic editor settings',libraries:'Libraries',meta:'File metadata',boards:'Board files',cvpcb:'Footprint assignment','3dviewports':'Saved 3D views'};
  function jsonSections(tree){
    const sections=[];
    for(const key of Object.keys(tree)){
      if(key==='board'&&tree[key]&&typeof tree[key]==='object'&&!Array.isArray(tree[key])){
        for(const sub of Object.keys(tree[key]))sections.push({id:'board/'+sub,label:({design_settings:'Board constraints and defaults',layer_presets:'Layer presets',viewports:'Saved board views'})[sub]||'Board: '+human(sub),entries:flattened(tree[key][sub],[key,sub])});
      }else sections.push({id:key,label:sectionLabel[key]||human(key),entries:flattened(tree[key],[key])});
    }
    return sections;
  }
  const GEOMETRY=new Set(['footprint','segment','arc','via','zone','net','group','target','dimension','image','embedded_files']);
  const isGeometry=form=>GEOMETRY.has(tag(form))||tag(form).startsWith('gr_');
  // Validate geometry without charging its skipped tokens to the settings budget.
  // Keep a null slot for each skipped root form to preserve source pointers.
  function boardSettingsTree(source){
    const stack=[],roots=[],number=/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
    let i=0,nodes=0;
    function append(value){
      const frame=stack.at(-1);
      if(!frame){roots.push(value);return;}
      if(frame.keep){
        if(stack.length===2&&frame.tree.length===0&&isGeometry([value])){
          frame.keep=false;frame.parent[frame.index]=null;frame.tree=null;
        }else {
          if(stack.length===1&&frame.tree.length>=1500000)throw new Error('KiCad board has too many top-level forms.');
          if(stack.length>1&&++nodes>LIMITS.nodes)throw new Error('Settings contain too many values.');
          frame.tree.push(value);
        }
      }
    }
    while(i<source.length){
      const ch=source[i];
      if(/\s/.test(ch)){i++;continue;}
      if(ch===';'){while(i<source.length&&source[i]!=='\n')i++;continue;}
      if(ch==='('){
        if(stack.length>=96)throw new Error('KiCad S-expression is too deep.');
        const parent=stack.at(-1),keep=!parent||parent.keep;
        const tree=keep?[]:null,index=parent?.tree?.length;
        append(tree);stack.push({tree,keep,parent:parent?.tree,index});i++;continue;
      }
      if(ch===')'){
        if(!stack.length)throw new Error('Unexpected closing parenthesis in KiCad file.');
        stack.pop();i++;continue;
      }
      if(!stack.length)throw new Error('Expected a KiCad S-expression.');
      if(ch==='"'){
        const keep=stack.at(-1).keep;let value='',closed=false;i++;
        while(i<source.length){
          const next=source[i++];if(next==='"'){closed=true;break;}
          if(next==='\\'){
            if(i>=source.length)throw new Error('Unterminated KiCad escape sequence.');
            const escaped=source[i++];
            if(keep){const decoded=({n:'\n',r:'\r',t:'\t','"':'"','\\':'\\'})[escaped];value+=decoded===undefined?'\\'+escaped:decoded;}
          }else if(keep)value+=next;
        }
        if(!closed)throw new Error('Unterminated quoted KiCad string.');
        append(keep?{quoted:value}:null);continue;
      }
      const start=i;while(i<source.length&&!/[\s();"]/.test(source[i]))i++;
      if(start===i)throw new Error('Unexpected KiCad source character.');
      const token=source.slice(start,i);let value=token;
      if(number.test(token)){value=Number(token);if(!Number.isFinite(value))throw new Error('Invalid numeric KiCad value.');}
      append(value);
    }
    if(stack.length||roots.length!==1||!Array.isArray(roots[0]))throw new Error('Incomplete KiCad S-expression.');
    return copyTree(roots[0],true);
  }
  function sexpr(text,multiple=false,boardSettings=false){
    if(boardSettings)return boardSettingsTree(text);
    const parser=root.KiCadDesignDiff||(typeof require==='function'?require('./design-diff.js'):null);
    if(!parser?.parse)throw new Error('KiCad S-expression parser is unavailable.');
    // .kicad_dru uses # comments. Keep hashes inside conditions/quoted names intact.
    if(multiple){let quoted=false,escaped=false,comment=false,out='';for(const c of text){if(comment){if(c==='\n'){comment=false;out+='\n';}continue;}if(escaped){out+=c;escaped=false;continue;}if(quoted&&c==='\\'){out+=c;escaped=true;continue;}if(!quoted&&c==='#'){comment=true;continue;}if(c==='"')quoted=!quoted;out+=c;}text='(custom_rules '+out+'\n)';}
    const parsed=parser.parse(text);
    // Keep original top-level indexes for exact source pointers; null slots mark
    // drawing objects excluded from this settings inspector's returned tree.
    return copyTree(boardSettings?parsed.map((form,index)=>index&&Array.isArray(form)&&isGeometry(form)?null:form):parsed);
  }
  function sectionsForForms(tree){
    const seen=new Map();
    return tree.slice(1).filter(Array.isArray).map((form,i)=>{
      const id=tag(form),count=seen.get(id)||0;seen.set(id,count+1);
      return {id:id+'#'+count,label:human(id)+(count?' '+(count+1):''),entries:flattened(form,[i+1])};
    });
  }
  function boardModel(tree){
    const setup=child(tree,'setup'),stack=child(setup,'stackup');
    const stackIndex=setup?.indexOf(stack),setupIndex=tree.indexOf(setup);
    const stackup=stack?{
      sourcePath:pointer([setupIndex,stackIndex]),
      layers:children(stack,'layer').map((row,index)=>({
        index,name:String(scalar(row[1])??''),type:field(row,'type'),
        thicknessMm:children(row,'thickness').length===1&&typeof field(row,'thickness')==='number'?field(row,'thickness'):null,
        thicknessValuesMm:children(row,'thickness').map(form=>typeof scalar(form[1])==='number'?scalar(form[1]):null),
        thicknessLocked:(child(row,'thickness')||[]).slice(2).some(v=>scalar(v)==='locked'),
        material:field(row,'material'),color:field(row,'color'),epsilonR:field(row,'epsilon_r'),lossTangent:field(row,'loss_tangent'),
        sourcePath:pointer([setupIndex,stackIndex,stack.indexOf(row)]),tree:row
      })),
      copperFinish:field(stack,'copper_finish'),dielectricConstraints:field(stack,'dielectric_constraints'),
      edgeConnector:field(stack,'edge_connector'),castellatedPads:field(stack,'castellated_pads'),edgePlating:field(stack,'edge_plating'),tree:stack
    }:null;
    const layerRows=(child(tree,'layers')||[]).filter(Array.isArray).map(row=>({ordinal:scalar(row[0]),name:scalar(row[1]),type:scalar(row[2]),userName:scalar(row[3])??null}));
    const thickness=field(child(tree,'general'),'thickness');
    const sections=[];
    for(const [index,form] of tree.entries())if(index&&Array.isArray(form))sections.push({id:tag(form)+'#'+index,label:human(tag(form)),entries:flattened(form,[index])});
    return {sections,stackup,layers:layerRows,boardThicknessMm:typeof thickness==='number'?thickness:null};
  }
  function parse(text,options={}){
    const file=String(options.file||'project.kicad_pro'),basename=file.split(/[\\/]/).at(-1).toLowerCase(),extension=['fp-lib-table','sym-lib-table'].includes(basename)?basename:file.split('.').at(-1).toLowerCase();
    validateSize(text,extension==='kicad_pcb'?64*1024*1024:LIMITS.bytes);
    const kind=({kicad_pro:'project',kicad_prl:'local-settings',kicad_pcb:'board-settings',kicad_dru:'custom-rules',kicad_wks:'worksheet','fp-lib-table':'footprint-libraries','sym-lib-table':'symbol-libraries'})[extension];
    if(!kind)throw new Error('Unsupported KiCad settings file type.');
    const warnings=['Read-only saved settings. Missing fields are not inferred; custom rules are not evaluated.'];
    let tree,sections,extra={};
    if(extension==='kicad_pro'||extension==='kicad_prl'){
      tree=copyTree(JSON.parse(text));
      if(!tree||typeof tree!=='object'||Array.isArray(tree))throw new Error('KiCad project/settings JSON must be an object.');
      sections=jsonSections(tree);
      if(extension==='kicad_prl')warnings.push('Local editor preferences may be user-specific and are commonly excluded from version control.');
    }else{
      tree=sexpr(text,extension==='kicad_dru',extension==='kicad_pcb');
      if(extension==='kicad_pcb'){
        if(tag(tree)!=='kicad_pcb')throw new Error('Expected a kicad_pcb board.');
        extra=boardModel(tree);sections=extra.sections;delete extra.sections;
        warnings.push('PCB geometry, net records and embedded file payloads are omitted from this settings tree; null slots preserve original source indexes. Use the dedicated layout viewer and source view for those records.');
        if(extra.stackup?.layers.some(layer=>layer.thicknessValuesMm.length>1))warnings.push('A stackup layer contains multiple saved thickness values. Inspect its saved sublayer tree; no combined thickness is inferred.');
        if(!extra.stackup)warnings.push('This board has no saved physical stackup. No default stackup is generated.');
      }else if(extension==='kicad_dru'){
        sections=sectionsForForms(tree);extra.rules=children(tree,'rule').map(form=>({name:String(scalar(form[1])??''),condition:field(form,'condition'),layer:field(form,'layer'),severity:field(form,'severity'),constraints:children(form,'constraint').map(row=>({type:scalar(row[1]),tree:row})),sourcePath:pointer([tree.indexOf(form)]),tree:form}));
      }else if(extension==='fp-lib-table'||extension==='sym-lib-table'){
        const expected=extension.replace(/-/g,'_');
        if(tag(tree)!==expected)throw new Error('Expected a '+extension+' library table.');
        sections=sectionsForForms(tree);extra.libraries=children(tree,'lib').map(form=>({name:field(form,'name'),type:field(form,'type'),uri:field(form,'uri'),options:field(form,'options'),description:field(form,'descr'),sourcePath:pointer([tree.indexOf(form)]),tree:form}));
        warnings.push('Library URIs and environment variables are displayed as saved; no external library is loaded by this inspector.');
      }else{
        if(!['kicad_wks','page_layout'].includes(tag(tree)))throw new Error('Expected a KiCad drawing-sheet file.');
        sections=sectionsForForms(tree);warnings.push('Drawing-sheet elements are inspected as saved data; this view does not render a worksheet preview.');
      }
    }
    if(sections.reduce((sum,section)=>sum+section.entries.length,0)>LIMITS.entries)throw new Error('Settings have more than 50000 leaf values.');
    return {file,kind,title:({project:'Project settings','local-settings':'Local editor settings','board-settings':'Board setup','custom-rules':'Custom design rules',worksheet:'Drawing sheet','footprint-libraries':'Footprint library table','symbol-libraries':'Symbol library table'})[kind],tree,sections,warnings,...extra};
  }
  root.KiCadProjectSettings={LIMITS,parse,flatten:flattened};
  if(typeof module==='object'&&module.exports)module.exports=root.KiCadProjectSettings;
})(typeof globalThis==='object'?globalThis:this);
