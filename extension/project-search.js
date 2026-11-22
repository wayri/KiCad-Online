/* Bounded, file-scoped search. Patterns use a finite-state matcher, never JS RegExp.
 * compile(query): AND terms, OR/| alternatives, -/NOT exclusions, field:value,
 * quoted phrases and quoted property names ("Manufacturer Part":"ABC 123").
 * createIndex(objects,{nets,sheets}): saved design-model records and net-model nets.
 * search(index,query,{limit}): results with object, file-scoped identity and snippets.
 * Limits and incompleteness are returned as warnings; malformed queries return error.
 */
((root) => {
  "use strict";
  const LIMITS = Object.freeze({query:2048, terms:64, groups:16, objects:50000,
    fields:128, fieldChars:4096, indexChars:16*1024*1024, results:1000,
    patternChars:128, patternAtoms:64, patternSteps:5000000});
  const fold = (text) => String(text ?? "").normalize("NFKC").toLowerCase();
  const order = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  // Saved schema: KiCad common/project/net_settings.cpp (schema 3/4/5).
  // Search class membership, not native effective rule values. Explicit labels and
  // matching patterns compose; priority orders constituents rather than replacing them.
  function savedColor(value) {
    if(typeof value!=='string'||value.length>80)return null;
    const rgba=value.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/i);
    if(rgba){const rgb=rgba.slice(1,4).map(Number),a=rgba[4]===undefined?1:Number(rgba[4]);return rgb.every(n=>n<=255)&&a>0&&a<=1?`rgba(${rgb.join(',')},${a})`:null;}
    const hex=value.trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);if(hex){const a=hex[2]?parseInt(hex[2],16)/255:1;return a>0?`rgba(${[0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)).join(',')},${a})`:null;}return null;
  }
  function netClassColor(name,config,pcb=false) {
    const names=netClasses(name,config);if(!names.length)return null;
    const field=pcb?'pcbColor':'schematicColor';
    for(const className of [...names,'Default']){const color=config.classes.find(c=>c.name===className)?.[field];if(color)return color;}return null;
  }
  function parseNetClasses(text) {
    if(typeof text!=="string" || text.length>1024*1024)throw new Error("Project settings must be text under 1 MiB.");
    let project;try{project=JSON.parse(text);}catch{throw new Error("Project settings JSON is malformed.");}
    const settings=project?.net_settings;
    if(!settings || typeof settings!=="object" || Array.isArray(settings))throw new Error("Project has no saved net_settings object.");
    const warnings=new Set(["Net classes use saved assignments and case-sensitive whole-name wildcards only; native regex matching, bus expansion, rule areas and derived assignments are not evaluated."]),classes=[],assignments=new Map(),patterns=[];
    let incomplete=false;
    const safe=(value)=>typeof value==="string"&&value.length>0&&value.length<=500&&!/[\x00-\x1f\x7f]/.test(value);
    if(!Array.isArray(settings.classes))throw new Error("Saved net_settings.classes must be an array.");
    if(settings.classes.length>256)throw new Error("Project exceeds 256 net classes.");
    for(const [index,item] of settings.classes.entries()) {
      if(!safe(item?.name)){warnings.add("An invalid net class definition was omitted.");incomplete=true;continue;}
      if(classes.some(c=>c.name===item.name))throw new Error("Project has duplicate net class names.");
      classes.push({name:item.name,pcbColor:savedColor(item.pcb_color),schematicColor:savedColor(item.schematic_color),priority:item.name==="Default"?Number.MAX_SAFE_INTEGER:Number.isFinite(item.priority)?item.priority:index});
      if(item.nets!==undefined){warnings.add("Legacy per-class nets are not interpreted; resave the project in current KiCad.");incomplete=true;}
    }
    if(!classes.some(c=>c.name==="Default"))classes.push({name:"Default",priority:Number.MAX_SAFE_INTEGER});
    const addImplicit=(name)=>{if(!classes.some(c=>c.name===name)){if(classes.length>=512)throw new Error("Project exceeds 512 defined and implicit net class names.");classes.push({name,priority:Number.MAX_SAFE_INTEGER-1});warnings.add("Assignments to undefined classes are retained as implicit names; no rule values are inferred.");}};
    const raw=settings.netclass_assignments??{};
    if(!raw || typeof raw!=="object" || Array.isArray(raw))throw new Error("Saved netclass_assignments must be an object.");
    if(Object.keys(raw).length>10000)throw new Error("Project exceeds 10000 net class assignments.");
    for(const [name,value] of Object.entries(raw)) {
      const names=typeof value==="string"?(value?[value]:[]):value;
      if(!safe(name)||!Array.isArray(names)||names.length>256||names.some(n=>!safe(n))){warnings.add("An invalid explicit net class assignment was omitted.");incomplete=true;continue;}
      assignments.set(name,[...new Set(names)]);for(const n of names)addImplicit(n);
    }
    const rawPatterns=settings.netclass_patterns??[];
    if(!Array.isArray(rawPatterns)||rawPatterns.length>1024)throw new Error("Saved netclass_patterns must be an array of at most 1024 entries.");
    for(const item of rawPatterns) {
      if(!safe(item?.pattern)||!safe(item?.netclass)){warnings.add("An invalid net class pattern was omitted.");incomplete=true;continue;}
      // These can have regex/bus meaning in KiCad; avoid inventing memberships.
      if(/[\[\]{}()|^$\\+]/.test(item.pattern)) {warnings.add("Regex or bus net class patterns were omitted; unmatched nets cannot safely be assumed Default.");incomplete=true;continue;}
      patterns.push({pattern:item.pattern,netclass:item.netclass});addImplicit(item.netclass);
    }
    if(settings.netclass_chain_assignments!==undefined){warnings.add("Chain-derived net class assignments are not evaluated.");incomplete=true;}
    return {classes,assignments,patterns,warnings:[...warnings],incomplete};
  }
  function wildcard(pattern,name) {
    // Greedy glob matching with bounded lengths, no constructed regular expression.
    let p=0,n=0,star=-1,afterStar=0;
    while(n<name.length) {
      if(pattern[p]==="?" || pattern[p]===name[n]){p++;n++;}
      else if(pattern[p]==="*"){star=p++;afterStar=n;}
      else if(star>=0){p=star+1;n=++afterStar;}
      else return false;
    }
    while(pattern[p]==="*")p++;
    return p===pattern.length;
  }
  function netClasses(name,config) {
    if(!config || !(config.assignments instanceof Map) || typeof name!=="string" || name.length>500)return [];
    if(!name)return ["Default"];
    const found=new Set(config.assignments.get(name)||[]);
    for(const entry of config.patterns)if(wildcard(entry.pattern,name))found.add(entry.netclass);
    if(!found.size&&!config.incomplete)found.add("Default");
    const priorities=new Map(config.classes.map(c=>[c.name,c.priority]));
    return [...found].sort((a,b)=>(priorities.get(a)??Number.MAX_SAFE_INTEGER)-(priorities.get(b)??Number.MAX_SAFE_INTEGER)||order(a,b));
  }
  function patternCompile(source,mode) {
    if(!source || source.length>LIMITS.patternChars)throw new Error(`Patterns must contain 1–${LIMITS.patternChars} characters.`);
    const atoms=[];let start=mode==='glob',end=mode==='glob',i=0;
    const literal=c=>{const value=fold(c);if(value.length!==1)throw new Error('Pattern characters must normalize to one character; use literal search for expanded Unicode.');return {kind:'literal',value};};
    if(mode==='regex'&&source[0]==='^'){start=true;i++;}
    const escaped=()=>{if(i>=source.length)throw new Error('Pattern ends with an escape.');const c=source[i++];if(mode==='regex'&&'dDsSwW'.includes(c))return {kind:'category',value:c};if(/[a-z0-9]/i.test(c))throw new Error('Only \\d, \\s, \\w (and uppercase inverses) or escaped punctuation are supported.');return literal(c);};
    while(i<source.length) {
      const c=source[i++];let atom;
      if(mode==='glob') {
        atom=c==='*'?{kind:'any',repeat:'*'}:c==='?'?{kind:'any'}:c==='\\'?escaped():literal(c);
      } else {
        if(c==='$'&&i===source.length){end=true;break;}
        if('()|{}^$*+?'.includes(c))throw new Error('Regex supports literals, . , character classes, anchors and single-atom * + ?; groups, alternation, counted repeats and lookarounds are unsupported. Use query OR for alternatives.');
        if(c==='\\')atom=escaped();
        else if(c==='.')atom={kind:'any'};
        else if(c==='[') {
          const negate=source[i]==='^';if(negate)i++;
          const values=[];
          while(i<source.length&&source[i]!==']'){let part=source[i++],escapedPart=false;if(part==='\\'){const item=escaped();if(item.kind!=='literal')throw new Error('Character-class escapes must be literal punctuation.');part=item.value;escapedPart=true;}values.push({value:part,escaped:escapedPart});}
          if(source[i++]!==']'||!values.length)throw new Error('Regex character class is empty or unclosed.');
          const ranges=[];for(let n=0;n<values.length;n++){const a=fold(values[n].value);if(a.length!==1)throw new Error('Character classes require single-character entries.');if(values[n+1]?.value==='-'&&!values[n+1].escaped&&n+2<values.length){const b=fold(values[n+2].value);if(b.length!==1||a>b)throw new Error('Regex character range is reversed or invalid.');ranges.push([a,b]);n+=2;}else ranges.push([a,a]);}
          atom={kind:'class',negate,ranges};
        } else atom=literal(c);
        if('*+?'.includes(source[i]||'\0'))atom.repeat=source[i++];
      }
      atoms.push(atom);if(atoms.length>LIMITS.patternAtoms)throw new Error(`Patterns exceed ${LIMITS.patternAtoms} atoms.`);
    }
    if(!atoms.length)throw new Error('Pattern must contain a matching atom.');
    // Expand + into one required atom and a repeat state. No backtracking stack.
    return {start,end,atoms:atoms.flatMap(a=>a.repeat==='+'?[{...a,repeat:null},{...a,repeat:'*'}]:[a])};
  }
  function patternMatch(pattern,text,budget) {
    const atoms=pattern.atoms,states=new Set([0]);
    const charge=()=>{if(--budget.steps<0)throw new Error('Pattern search reached its work budget. Narrow the query with literal type:, sheet: or ref: terms.');};
    const closure=set=>{for(let j=0;j<atoms.length;j++){charge();if(set.has(j)&&['*','?'].includes(atoms[j].repeat))set.add(j+1);}};
    const accepts=(atom,c)=>{
      if(atom.kind==='any')return true;
      if(atom.kind==='literal')return c===atom.value;
      if(atom.kind==='class'){const yes=atom.ranges.some(([a,b])=>c>=a&&c<=b);return atom.negate?!yes:yes;}
      const kind=atom.value.toLowerCase(),yes=kind==='d'?c>='0'&&c<='9':kind==='w'?((c>='a'&&c<='z')||(c>='0'&&c<='9')||c==='_'):/\s/.test(c);
      return atom.value===kind?yes:!yes;
    };
    closure(states);if(!pattern.end&&states.has(atoms.length))return true;
    let current=states;
    for(let i=0;i<text.length;i++) {
      if(!pattern.start)current.add(0);closure(current);const next=new Set();
      for(const j of current){charge();if(j<atoms.length&&accepts(atoms[j],text[i]))next.add(atoms[j].repeat==='*'?j:j+1);}
      closure(next);current=next;if(!pattern.end&&current.has(atoms.length))return true;
      if(pattern.start&&!current.size)return false;
    }
    if(!pattern.start)current.add(0);closure(current);return current.has(atoms.length);
  }
  function compile(query) {
    if (typeof query !== "string") return {groups:[],error:"Search must be text."};
    if (query.length > LIMITS.query) return {groups:[],error:`Search exceeds ${LIMITS.query} characters.`};
    if (/[\x00-\x1f\x7f]/.test(query)) return {groups:[],error:"Search contains control characters."};
    const tokens = []; let i=0;
    while (i < query.length) {
      if (/\s/.test(query[i])) {i++;continue;}
      if (query[i] === "|") {tokens.push({operator:"OR"});i++;continue;}
      let value="",colon=-1,quoted=false,inQuote=false,start=i;
      while (i < query.length && (inQuote || (!/\s/.test(query[i]) && query[i]!=="|"))) {
        const c=query[i++];
        if(c==='"') {inQuote=!inQuote;quoted=true;continue;}
        if(c==="\\" && inQuote && (query[i]==='"' || query[i]==="\\")) {value+=query[i++];continue;}
        if(c===':' && !inQuote && colon<0) colon=value.length;
        if((c==='(' || c===')') && !inQuote) return {groups:[],error:"Parentheses are unsupported; separate AND groups with OR."};
        value+=c;
      }
      if(inQuote) return {groups:[],error:`Unclosed quote at character ${start+1}.`};
      if(!quoted && ["AND","OR","NOT"].includes(value)) tokens.push({operator:value});
      else tokens.push({value,colon,leadingMinus:query[start]==="-"});
      if(tokens.length > LIMITS.terms*2) return {groups:[],error:"Too many search terms."};
    }
    const groups=[[]];let pending=false,negate=false,total=0;
    for(const token of tokens) {
      const group=groups.at(-1);
      if(token.operator === "OR") {
        if(!group.length || pending || negate) return {groups:[],error:"OR needs a search term on both sides."};
        if(groups.length >= LIMITS.groups) return {groups:[],error:"Too many OR groups."};
        groups.push([]);pending=true;continue;
      }
      if(token.operator === "AND") {
        if(!group.length || pending || negate) return {groups:[],error:"AND needs a search term on both sides."};
        pending=true;continue;
      }
      if(token.operator === "NOT") {
        if(negate) return {groups:[],error:"NOT must precede a search term."};
        negate=true;continue;
      }
      let text=token.value,colon=token.colon,excluded=negate;
      if(token.leadingMinus) {excluded=!excluded;text=text.slice(1);if(colon>=0)colon--;}
      let field=colon>=0?fold(text.slice(0,colon)):null;
      let raw=colon>=0?text.slice(colon+1):text,mode='literal',pattern=null;
      if(field==='regex'||field==='glob'){raw=`${field}:${raw}`;field=null;}
      if(/^(regex|glob):/i.test(raw)){mode=raw.slice(0,raw.indexOf(':')).toLowerCase();raw=raw.slice(raw.indexOf(':')+1);try{pattern=patternCompile(raw,mode);}catch(error){return {groups:[],error:error.message};}}
      const term=fold(raw);
      if(!term || field==="") return {groups:[],error:"Each search term and field must have a value."};
      if(++total > LIMITS.terms) return {groups:[],error:`Search exceeds ${LIMITS.terms} terms.`};
      group.push({field,term,excluded,mode,pattern});pending=negate=false;
    }
    if(pending || negate) return {groups:[],error:"Search ends with an incomplete operator."};
    return {groups:tokens.length?groups:[],error:null};
  }
  function createIndex(objects, options={}) {
    if(!Array.isArray(objects)) throw new TypeError("Search requires design objects.");
    const warnings=new Set(),entries=[],netNames=new Map(),sheetNames=new Map(),classMembership=new Map();let chars=0,links=0;
    for(const warning of options.netClasses?.warnings||[])warnings.add(warning);
    if((options.nets||[]).length>LIMITS.objects)warnings.add(`Only ${LIMITS.objects} networks are indexed.`);
    if((options.sheets||[]).length>LIMITS.objects)warnings.add(`Only ${LIMITS.objects} sheet names are indexed.`);
    const addNet=(key,name)=>{if(!netNames.has(key))netNames.set(key,new Set());netNames.get(key).add(name);};
    netLoop: for(const net of (options.nets||[]).slice(0,LIMITS.objects)) {
      if(typeof net?.path!=="string" || typeof net.name!=="string") continue;
      for(const id of (net.objectIds||[]).slice(0,LIMITS.objects)) {if(++links>250000){warnings.add("Net search membership reached its 250000-link budget.");break netLoop;}addNet(`id:${net.path}:${id}`,net.name.slice(0,LIMITS.fieldChars));}
      for(const member of (net.members||[]).slice(0,LIMITS.objects))if(typeof member.uuid==="string") {if(++links>250000){warnings.add("Net search membership reached its 250000-link budget.");break netLoop;}addNet(`uuid:${net.path}:${member.uuid}`,net.name.slice(0,LIMITS.fieldChars));}
    }
    for(const sheet of (options.sheets||[]).slice(0,LIMITS.objects))if(typeof sheet?.path==="string")sheetNames.set(sheet.path,sheet.label||"");
    const objectNets=new Map();
    for(const object of objects.slice(0,LIMITS.objects)) {
      const names=new Set([...(netNames.get(`id:${object.path}:${object.id}`)||[]),...(netNames.get(`uuid:${object.path}:${object.uuid}`)||[])]);
      if(object.parentId)for(const name of names)addNet(`id:${object.path}:${object.parentId}`,name);
      objectNets.set(object,names);
    }
    if(objects.length > LIMITS.objects)warnings.add(`Search indexes the first ${LIMITS.objects} objects only.`);
    for(const object of objects.slice(0,LIMITS.objects)) {
      if(!object || typeof object.path!=="string" || typeof object.id!=="string")continue;
      const names=new Set([...objectNets.get(object),...(netNames.get(`id:${object.path}:${object.id}`)||[])]);
      const fields=new Map();
      const put=(key,value)=> {
        if(value===undefined || value===null || typeof value==="object")return;
        key=fold(key);const text=String(value);
        if(text.length > LIMITS.fieldChars)warnings.add(`Long field values are limited to ${LIMITS.fieldChars} characters.`);
        const bounded=text.slice(0,LIMITS.fieldChars),previous=fields.get(key);
        const display=previous&&previous.display!==bounded?`${previous.display} ${bounded}`.slice(0,LIMITS.fieldChars):bounded;
        fields.set(key,{display,folded:fold(display)});
      };
      for(const [key,value] of Object.entries(object.properties||{}).slice(0,LIMITS.fields))put(key,value);
      if(Object.keys(object.properties||{}).length>LIMITS.fields)warnings.add(`Only ${LIMITS.fields} saved properties per object are indexed.`);
      // Canonical aliases never disappear behind a custom property with the same name.
      put("ref",object.reference||object.properties?.Reference||"");put("value",object.properties?.Value||"");
      put("type",object.kind);put("sheet",`${object.path} ${sheetNames.get(object.path)||""}`);
      put("uuid",object.uuid);put("footprint",object.properties?.Footprint||object.properties?.["Library ID"]||"");
      put("net",[...names].join(" "));put("label",object.label);
      if(options.netClasses) {
        const classes=[...new Set([...names].flatMap(name=>{if(!classMembership.has(name))classMembership.set(name,netClasses(name,options.netClasses));return classMembership.get(name);} ))].join(" ");
        put("netclass",classes);put("class",classes);
      }
      const size=[...fields.values()].reduce((sum,f)=>sum+f.display.length+f.folded.length,0);
      if(chars+size>LIMITS.indexChars){warnings.add("Search index reached its text budget; remaining objects were not indexed.");break;}
      chars+=size;entries.push({object,fields});
    }
    return {entries,warnings:[...warnings],count:entries.length};
  }
  function search(index,query, options={}) {
    const parsed=compile(query),warnings=[...(index?.warnings||[])];
    if(parsed.error)return {results:[],total:0,truncated:false,error:parsed.error,warnings};
    const limit=Number.isSafeInteger(options.limit)?Math.max(1,Math.min(LIMITS.results,options.limit)):200;
    const ranked=[],budget={steps:LIMITS.patternSteps},preferredPath=options.preferredPath;
    const compare=(a,b)=>b.score-a.score||
      (preferredPath?Number(b.object.path===preferredPath)-Number(a.object.path===preferredPath):0)||
      order(a.object.path,b.object.path)||order(a.object.id,b.object.id);
    let total=0,cutoff=null;
    const groups=(parsed.groups.length?parsed.groups:[[]]).map(group=>group.slice().sort((a,b)=>Number(Boolean(a.pattern))-Number(Boolean(b.pattern))));
    try {
      for(const entry of index?.entries||[]) {
        let best=null;
        for(const group of groups) {
          const matches=[];let score=0,valid=true;
          for(const token of group) {
            const fields=token.field?[[token.field,entry.fields.get(token.field)]]:entry.fields;
            let found=false;
            for(const [name,field] of fields) {
              if(!field||!(token.pattern?patternMatch(token.pattern,field.folded,budget):field.folded.includes(token.term)))continue;
              found=true;
              if(token.excluded)break;
              const strength=field.folded===token.term?10:field.folded.startsWith(token.term)?5:1;
              score+=strength+(name==='ref'?3:0);
              matches.push({field:name,text:field.display,folded:field.folded,term:token.term});
            }
            if(found===token.excluded){valid=false;break;}
          }
          if(valid&&(!best||score>best.score))best={score,matches};
        }
        if(!best)continue;
        total++;
        const candidate={object:entry.object,score:best.score,matches:best.matches};
        if(cutoff&&compare(candidate,cutoff)>=0)continue;
        ranked.push(candidate);
        if(ranked.length===2*limit){
          ranked.sort(compare);
          ranked.length=limit;
          cutoff=ranked[limit-1];
        }
      }
    }catch(error){return {results:[],total:0,truncated:false,error:error.message,warnings};}
    ranked.sort(compare);
    const results=ranked.slice(0,limit).map(({object,score,matches})=>{
      const seen=new Set(),snippets=[];
      for(const match of matches){
        if(seen.has(match.field))continue;
        seen.add(match.field);
        const at=match.folded.indexOf(match.term),start=Math.max(0,at-36),end=Math.min(match.text.length,start+140);
        snippets.push({field:match.field,text:`${start?'...':''}${match.text.slice(start,end)}${end<match.text.length?'...':''}`});
        if(snippets.length===6)break;
      }
      return {object,id:object.id,path:object.path,uuid:object.uuid||null,score,matchedFields:[...seen],snippets};
    });
    return {results,total,truncated:total>limit,error:null,warnings};
  }

  const api={LIMITS,compile,createIndex,search,parseNetClasses,netClasses,savedColor,netClassColor};root.KiCadProjectSearch=api;
  if(typeof module==="object" && module.exports)module.exports=api;
})(typeof globalThis==="object"?globalThis:this);
