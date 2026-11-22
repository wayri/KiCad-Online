/* Self-contained VS Code preparation worker. Regenerate with scripts/build_load_worker.py. */
/* Bounded read-only adapter for saved Eeschema v2/v4 schematics and cache libraries.
   Source remains unchanged; unsupported records produce visible diagnostics. */
((root)=>{'use strict';
 const MAX_BYTES=8*1024*1024,MAX_LINES=150000,MM=.0254;
 const q=quoted=>({quoted:String(quoted??'')}),mm=x=>{const n=Number(x);if(!Number.isFinite(n)||Math.abs(n)>1e8)throw Error('Invalid legacy schematic coordinate.');return Math.round(n*MM*1e8)/1e8;};
 const tokens=line=>[...line.matchAll(/"((?:\\.|[^"\\])*)"|([^\s]+)/g)].map(m=>m[1]!==undefined?m[1].replace(/\\(["\\])/g,'$1'):m[2]);
 const at=(x,y,angle=0)=>['at',mm(x),mm(y),angle],effects=(size=50,hide=false)=>['effects',['font',['size',mm(size),mm(size)]],...(hide?['hide']:[])];
 function lines(source){if(typeof source!=='string'||new TextEncoder().encode(source).length>MAX_BYTES)throw Error('Legacy schematic/library exceeds its size limit.');const result=source.replace(/^\uFEFF/,'').split(/\r?\n/);if(result.length>MAX_LINES)throw Error('Legacy schematic/library exceeds its line limit.');return result;}
 function bitmap(input,start,end){
  let position,scale=1,dataStarted=false,dataEnded=false,byteCount=0;
  const parts=[];
  for(let i=start;i<end;i++){
   const line=input[i].trim();
   if(!line)continue;
   if(line==='EndData'&&dataStarted&&!dataEnded){dataEnded=true;continue;}
   if(dataStarted&&!dataEnded){
    if(!/^[0-9a-f]{2}(?:\s+[0-9a-f]{2})*$/i.test(line))throw Error('Invalid saved bitmap bytes.');
    const bytes=line.match(/[0-9a-f]{2}/gi);
    byteCount+=bytes.length;
    if(byteCount>4*1024*1024)throw Error('Saved bitmap exceeds its 4 MiB limit.');
    for(let at=0;at<bytes.length;at+=8192)parts.push(String.fromCharCode(...bytes.slice(at,at+8192).map(byte=>parseInt(byte,16))));
    continue;
   }
   const [key,x,y]=tokens(line);
   if(key==='Pos'&&x!==undefined&&y!==undefined)position=at(x,y);
   if(key==='Scale'&&x!==undefined)scale=Number(x);
   if(key==='Data'&&!dataStarted)dataStarted=true;
  }
  if(!position||!parts.length||!dataEnded||!Number.isFinite(scale)||scale<=0)throw Error('Invalid saved bitmap placement or data.');
  return ['image',position,['scale',scale],['uuid',q('legacy-bitmap-'+start)],['data',q(btoa(parts.join('')))]];
 }
 function libraries(sources,warn){
  const result=new Map();let total=0;
  if(!Array.isArray(sources))return result;
  if(sources.length>16)throw Error('Too many legacy symbol libraries.');
  for(const entry of sources){const source=typeof entry==='string'?entry:entry?.content;if(typeof source!=='string')continue;total+=source.length;if(total>16*1024*1024)throw Error('Legacy symbol libraries exceed their combined limit.');
   let definition=null,aliases=[],drawing=false,units=new Map();
   for(const line of lines(source)){const t=tokens(line),type=t[0];if(!type||type[0]==='#')continue;
    if(type==='DEF'){definition=t;aliases=[];units=new Map();continue;}if(!definition)continue;
    if(type==='ALIAS'){aliases.push(...t.slice(1));continue;}if(type==='DRAW'){drawing=true;continue;}if(type==='ENDDRAW'){drawing=false;continue;}
    if(type==='ENDDEF'){const name=definition[1],body=['symbol',q(name),...(definition[9]==='P'?[['power']]:[]),...(definition[5]==='N'?[['pin_numbers','hide']]:[]),...(definition[6]==='N'?[['pin_names','hide']]:[]),...units.values()];for(const alias of [name,...aliases])if(!result.has(alias))result.set(alias,body);definition=null;continue;}
    if(!drawing)continue;
    const add=(unit,style,node)=>{const key=unit+'_'+style;if(!units.has(key))units.set(key,['symbol',q(definition[1]+'_'+key)]);units.get(key).push(node);};
    const stroke=width=>['stroke',['width',Math.max(mm(width||6),.01)]],fill=code=>['fill',['type',code==='F'?'outline':code==='f'?'background':'none']];
    if(type==='S')add(t[5],t[6],['rectangle',['start',mm(t[1]),mm(t[2])],['end',mm(t[3]),mm(t[4])],stroke(t[7]),fill(t[8])]);
    else if(type==='C')add(t[4],t[5],['circle',['center',mm(t[1]),mm(t[2])],['radius',mm(t[3])],stroke(t[6]),fill(t[7])]);
    else if(type==='P'){const count=Number(t[1]);if(!Number.isInteger(count)||count<2||count>10000||t.length<5+2*count)throw Error('Invalid legacy library polyline.');add(t[2],t[3],['polyline',['pts',...Array.from({length:count},(_,i)=>['xy',mm(t[5+i*2]),mm(t[6+i*2])])],stroke(t[4]),fill(t[5+count*2])]);}
    else if(type==='A'){
     const cx=mm(t[1]),cy=mm(t[2]),radius=mm(t[3]),start=Number(t[4])*Math.PI/1800,end=Number(t[5])*Math.PI/1800;
     let sweep=end-start;while(sweep<0)sweep+=Math.PI*2;
     const xy=a=>[cx+radius*Math.cos(a),cy+radius*Math.sin(a)];
     add(t[6],t[7],['arc',['start',...xy(start)],['mid',...xy(start+sweep/2)],['end',...xy(start+sweep)],stroke(t[8]),fill(t[9])]);
    }else if(type==='X'){
     const pinTypes={I:'input',O:'output',B:'bidirectional',T:'tri_state',P:'passive',U:'unspecified',W:'power_in',w:'power_out',C:'open_collector',E:'open_emitter',N:'no_connect'},angle={R:0,U:90,L:180,D:270}[t[6]];
     const styles={'':'line',I:'inverted',C:'clock',CI:'inverted_clock',L:'input_low',CL:'clock_low',V:'output_low',F:'edge_clock_high',X:'non_logic'},raw=t[12]||'',hidden=raw.includes('N'),style=styles[raw.replace(/N/g,'')];
     if(angle===undefined||!style){warn('Unsupported legacy pin orientation/style omitted: '+t[1]);continue;}
     add(t[9],t[10],['pin',pinTypes[t[11]]||'unspecified',style,at(t[3],t[4],angle),['length',mm(t[5])],['name',q(t[1]),effects(t[8])],['number',q(t[2]),effects(t[7])],...(hidden?['hide']:[])]);
    }else if(type==='T'){warn('Legacy library text is omitted; convert a copy in KiCad for complete typography.');}
    else warn('Unsupported legacy library graphic '+type+' omitted.');
   }
  }
  return result;
 }
 function parse(source,options={}){
  const input=lines(source);if(!/^EESchema Schematic File Version [24]\b/.test(input[0]))throw Error('Only legacy Eeschema v2/v4 schematics are supported.');
  const diagnostics=new Set(['Restricted legacy schematic preview: only recognized saved records and supplied cache-library graphics are rendered. Convert a separate copy in KiCad for a complete modern preview.']);
  const warn=text=>{if(diagnostics.size<200)diagnostics.add(text);},defs=libraries(options.libraries,warn),ast=['kicad_sch',['version',Number(input[0].match(/\d+$/)[0])],['legacy_source',q(input[0])]],embedded=['lib_symbols'],placed=[];
  const property=(name,text,x,y,size=50,hide=false,angle=0)=>['property',q(name),q(text),at(x,y,angle),effects(size,hide)];
  function block(start,end){const result=[];let i=start;for(;i<input.length&&input[i]!==end;i++)result.push(tokens(input[i]));if(i===input.length)throw Error('Incomplete legacy schematic '+end+' block.');return {records:result,end:i};}
  for(let i=1;i<input.length;i++){
   const t=tokens(input[i]),type=t[0];if(!type||type[0]==='#')continue;
   if(type==='$Descr'){ast.push(['paper',q(t[1])]);continue;}
   if(/^Comment[1-9]$/.test(type)){let title=ast.find(x=>Array.isArray(x)&&x[0]==='title_block');if(!title){title=['title_block'];ast.push(title);}title.push(['comment',Number(type.slice(7)),q(t[1])]);continue;}
   if(['Title','Date','Rev','Comp'].includes(type)){let title=ast.find(x=>Array.isArray(x)&&x[0]==='title_block');if(!title){title=['title_block'];ast.push(title);}title.push([{Title:'title',Date:'date',Rev:'rev',Comp:'company'}[type],q(t[1])]);continue;}
   if(type==='Wire'||type==='Entry'){const next=tokens(input[++i]||'');if(next.length!==4)throw Error('Invalid legacy wire record.');if(type==='Entry'){warn('Legacy bus-entry geometry omitted.');continue;}ast.push([t[1]==='Bus'?'bus':'wire',['pts',['xy',mm(next[0]),mm(next[1])],['xy',mm(next[2]),mm(next[3])]]]);continue;}
   if(type==='Connection'||type==='NoConn'){ast.push([type==='Connection'?'junction':'no_connect',at(t[2],t[3])]);continue;}
   if(type==='Text'){
    const text=input[++i]??'',kind={Label:'label',GLabel:'global_label',HLabel:'hierarchical_label',Notes:'text'}[t[1]];
    if(!kind){warn('Unsupported legacy text record '+t[1]+' omitted.');continue;}
    const angles=[0,90,180,270],angle=angles[Number(t[4])];if(angle===undefined){warn('Unsupported legacy text orientation omitted.');continue;}
    const shape={Input:'input',Output:'output',BiDi:'bidirectional',TriState:'tri_state',UnSpc:'passive'}[t[6]];
    if(!['text','label'].includes(kind)&&!shape)warn('Unknown legacy label shape '+t[6]+'; passive outline used.');
    ast.push([kind,q(text.replace(/\\n/g,'\n')),at(t[2],t[3],angle),effects(t[5]),...(kind==='text'||kind==='label'?[]:[['shape',shape||'passive']])]);continue;
   }
   if(type==='$Sheet'){
    const b=block(i+1,'$EndSheet');i=b.end;const r=b.records,S=r.find(x=>x[0]==='S'),U=r.find(x=>x[0]==='U');if(!S)throw Error('Legacy sheet has no bounds.');const sheet=['sheet',at(S[1],S[2]),['size',mm(S[3]),mm(S[4])],['uuid',q(U?.[1]||'legacy-sheet-'+i)]];
    for(const f of r.filter(x=>/^F\d+$/.test(x[0]))){if(f[0]==='F0'||f[0]==='F1')sheet.push(property(f[0]==='F0'?'Sheetname':'Sheetfile',f[1],S[1],S[2],f[2]));else{const side=f[3],angle={L:180,R:0,U:90,D:270}[side];sheet.push(['pin',q(f[1]),{I:'input',O:'output',B:'bidirectional',T:'tri_state',U:'passive'}[f[2]]||'passive',at(f[4],f[5],angle??0),effects(f[6])]);}}
    ast.push(sheet);continue;
   }
   if(type==='$Comp'){
    const b=block(i+1,'$EndComp');i=b.end;const r=b.records,L=r.find(x=>x[0]==='L'),U=r.find(x=>x[0]==='U'),P=r.find(x=>x[0]==='P');if(!L||!P)throw Error('Incomplete legacy component.');const id=L[1],matrix=r.find(x=>x.length===4&&x.every(n=>/^-?\d+$/.test(n)))?.map(Number)||[1,0,0,-1];let orientation=null;
    for(const angle of [0,90,180,270])for(const mirror of ['', 'x','y']){const rad=angle*Math.PI/180,c=Math.round(Math.cos(rad)),s=Math.round(Math.sin(rad)),sx=mirror==='y'?-1:1,sy=mirror==='x'?-1:1,actual=[sx*c,-sx*s,-sy*s,-sy*c];if(matrix.every((n,j)=>n===actual[j]))orientation={angle,mirror};}
    if(!orientation){warn('Legacy component '+id+' has an unsupported orientation and is omitted.');continue;}
    const node=['symbol',['lib_id',q(id)],at(P[1],P[2],orientation.angle),['unit',Number(U?.[1]||1)],['convert',Number(U?.[2]||1)],['uuid',q(U?.[3]||'legacy-component-'+i)],...(orientation.mirror?[['mirror',orientation.mirror]]:[])];
    for(const f of r.filter(x=>x[0]==='F')){const name=['Reference','Value','Footprint','Datasheet'][Number(f[1])]||f[11]||'Field'+f[1];node.push(property(name,f[2],f[4],f[5],f[6],f[7]!=='0000',(((f[3]==='V'?90:0)-orientation.angle)%180+180)%180));}
    const definition=defs.get(id)||defs.get(id.split(':').pop());if(definition){if(!placed.includes(id)){embedded.push(['symbol',q(id),...definition.slice(2)]);placed.push(id);}}else warn('Missing saved legacy library definition for '+id+': symbol body and pins omitted; fields remain visible.');ast.push(node);continue;
   }
   if(type==='$Bitmap'){
    const end=input.indexOf('$EndBitmap',i+1);
    if(end<0){warn('Legacy bitmap omitted: missing block terminator.');break;}
    try{ast.push(bitmap(input,i+1,end));}catch(error){warn('Legacy bitmap omitted: '+error.message);}
    i=end;
   }
  }
  if(!input.some(line=>line==='$EndSCHEMATC'))throw Error('Incomplete legacy schematic terminator.');
  ast.push(embedded,...[...diagnostics].map(text=>['legacy_diagnostic',q(text)]));return ast;
 }
 function sheetFiles(source){const input=lines(source),names=[];let sheet=false;for(const line of input){if(line==='$Sheet')sheet=true;else if(line==='$EndSheet')sheet=false;else if(sheet){const t=tokens(line);if(t[0]==='F1')names.push(t[1]);}}return names;}
 root.KiCadLegacy={parse,sheetFiles};if(typeof module==='object'&&module.exports)module.exports=root.KiCadLegacy;
})(globalThis);

;
/* Saved KiCad object comparison. Browser-only; no geometry renderer required. */
((root) => {
  "use strict";
  const MAX_FILE = 8 * 1024 * 1024;
  const MAX_PROJECT = 512 * 1024 * 1024;
  const MAX_MODERN_FILE = 256 * 1024 * 1024;
  const sourceByteLimit = path => /\.kicad_(pcb|sch)$/i.test(path) ? MAX_MODERN_FILE : MAX_FILE;
  const MAX_FILES = 128;
  const MAX_RENDER_PRIMITIVES = 1500000;
  const MAX_DEPTH = 96;
  const MAX_NODES = 1000000;
  const SCHEMATIC = new Set(["symbol", "sheet", "wire", "bus", "bus_entry", "label",
    "global_label", "hierarchical_label", "junction", "no_connect", "text", "text_box",
    "polyline", "rectangle", "circle", "arc", "bezier", "image"]);
  const BOARD = new Set(["module", "footprint", "segment", "arc", "via", "zone", "gr_line",
    "gr_rect", "gr_circle", "gr_arc", "gr_poly", "gr_curve", "gr_text", "gr_text_box",
    "gr_bitmap", "dimension", "target"]);
  const OMIT = new Set(["uuid", "tstamp", "filled_polygon", "fill_segments"]);
  const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

  // KiCad files are overwhelmingly ASCII. Keep the same ECMAScript whitespace
  // grammar without constructing/testing a regular expression for every byte.
  // Count source bytes without allocating a second full-size UTF-8 buffer.
  function sourceByteLength(source) {
    if(typeof source!=='string')throw new TypeError('KiCad source must be a string.');
    if(!/[^\x00-\x7f]/.test(source))return source.length;
    let bytes=source.length;
    for(let i=0;i<source.length;i++){
      const code=source.charCodeAt(i);if(code<128)continue;
      if(code<2048){bytes++;continue;}
      if(code>=0xd800&&code<=0xdbff&&i+1<source.length){const next=source.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){bytes+=2;i++;continue;}}
      bytes+=2;
    }
    return bytes;
  }

  const spaceCode=code=>code===32||(code>=9&&code<=13)||(code>127&&/\s/.test(String.fromCharCode(code)));
  const METADATA_FIELDS=new Set(["version","generator","generator_version","uuid","paper","title_block","property","sheet","symbol","footprint","module","sheet_instances","legacy_source","legacy_diagnostic"]);
  const METADATA_OBJECT_FIELDS=new Set(["property","uuid","path","instances"]);
  // Packed points are private to prepared viewer trees. Comparison keeps the saved AST shape.
  function packSavedFill(form) {
    if (form.length < 4) return;
    for (let i = 1; i < form.length; i++) {
      const point = form[i];
      if (!Array.isArray(point) || point.length !== 3 || point[0] !== 'xy' ||
          !Number.isFinite(point[1]) || !Number.isFinite(point[2])) return;
    }
    const coordinates = new Float64Array((form.length - 1) * 2);
    for (let i = 1; i < form.length; i++) {
      coordinates[(i - 1) * 2] = form[i][1];
      coordinates[(i - 1) * 2 + 1] = form[i][2];
    }
    form.length = 1;
    form.push(coordinates);
  }
  function parse(source, options = {}) {
    if (typeof source !== "string") throw new TypeError("KiCad source must be a string.");
    if (/^\s*PCBNEW-BOARD/.test(source))throw Error('Legacy .brd boards are detected but this drawing format is not yet rendered. Open and save a separate .kicad_pcb copy in KiCad.');
    if (/^\s*EESchema Schematic File Version [24]\b/.test(source)) {
      const legacy=root.KiCadLegacy||(typeof module==='object'&&module.exports?require('./legacy-kicad.js'):null);
      if(!legacy)throw Error('Legacy schematic adapter is unavailable; reload the extension.');
      return legacy.parse(source,options);
    }
    const board = /^\s*\(kicad_pcb(?:\s|\))/.test(source);
    const modern = board || /^\s*\(kicad_sch(?:\s|\))/.test(source);
    const byteLimit=modern?MAX_MODERN_FILE:MAX_FILE;
    // UTF-8 uses at most three bytes per UTF-16 code unit. Avoid a full-size
    // temporary byte array when that upper bound already proves the input fits.
    if(source.length>byteLimit||source.length>byteLimit/3&&sourceByteLength(source)>byteLimit)throw new Error("KiCad file exceeds browser parser size limits.");
    const nodeLimit = modern ? 12000000 : MAX_NODES;
    const stack = [], roots = [];
    // Saved copper vertices can bypass temporary growable parser frames.
    const coordinate = /\(xy[ \t]+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)[ \t]+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)[ \t]*\)/y;
    let i = 0, nodes = 0, skippedDepth=0;
    const append = (item) => {
      if (++nodes > nodeLimit) throw new Error("KiCad file has too many S-expression nodes.");
      if(!skippedDepth)(stack.at(-1) || roots).push(item);
    };
    while (i < source.length) {
      const ch = source[i];
      if (spaceCode(source.charCodeAt(i))) { i++; continue; }
      if((ch==="<"||ch===">")&&/^(?:<{7,}|>{7,})(?:\s|$)/.test(source.slice(i,i+120)))throw new Error("Unresolved Git merge conflict at line "+(source.slice(0,i).split("\n").length)+". Resolve the conflict in a separate copy before viewing.");
      if (ch === ";") { while (i < source.length && source[i] !== "\n") i++; continue; }
      if (ch === "(") {
        if (stack.length >= MAX_DEPTH) throw new Error("KiCad S-expression is too deep.");
        if (!options.metadataOnly && stack.length && source.startsWith('(xy', i)) {
          coordinate.lastIndex = i;
          const match = coordinate.exec(source);
          if (match) {
            const x = Number(match[1]), y = Number(match[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid numeric KiCad value.");
            nodes += 3; // Form name and both coordinates; append counts the form itself.
            append(['xy', x, y]);
            i = coordinate.lastIndex;
            continue;
          }
        }
        if(options.metadataOnly&&!skippedDepth){let allowed=null;
          if(stack.length===1)allowed=METADATA_FIELDS;
          else if(stack.length===2&&['symbol','footprint','module'].includes(stack.at(-1)?.[0]))allowed=METADATA_OBJECT_FIELDS;
          else if(stack.at(-1)?.[0]==='property')allowed=new Set();
          if(allowed){let start=i+1;while(start<source.length&&spaceCode(source.charCodeAt(start)))start++;let end=start;while(end<source.length&&!spaceCode(source.charCodeAt(end))&&!['(',')',';'].includes(source[end]))end++;if(!allowed.has(source.slice(start,end)))skippedDepth=stack.length+1;}
        }
        const node = [];
        append(node); stack.push(node); i++; continue;
      }
      if (ch === ")") {
        if (!stack.length) throw new Error("Unexpected closing parenthesis in KiCad file.");
        const node=stack.pop();
        if(!options.metadataOnly&&options.compactCopper&&node[0]==='pts'&&stack.length===3&&
          stack[0][0]==='kicad_pcb'&&stack[1][0]==='zone'&&stack[2][0]==='filled_polygon')packSavedFill(node);
        // Fixed-size small forms avoid retaining the spare capacity of millions
        // of growable coordinate/attribute arrays. The public tree shape stays
        // identical; replace only a completed child, never a live stack frame.
        if(!skippedDepth&&node.length>0&&node.length<=4){
          const compact=node.length===1?[node[0]]:node.length===2?[node[0],node[1]]:node.length===3?[node[0],node[1],node[2]]:[node[0],node[1],node[2],node[3]];
          const parent=stack.at(-1)||roots;parent[parent.length-1]=compact;
        }
        if(skippedDepth&&stack.length<skippedDepth)skippedDepth=0; i++; continue;
      }
      if (!stack.length) throw new Error("Expected a KiCad S-expression.");
      if (ch === '"') {
        let segments=null, chunkStart=++i, closed=false, text='';
        while(i<source.length){
          const next=source[i++];
          if(next==='"'){
            closed=true;
            if(!skippedDepth){const tail=source.slice(chunkStart,i-1);if(segments){segments.push(tail);text=segments.join('');}else text=tail;}
            break;
          }
          if(next==='\\'){
            if(i>=source.length)throw new Error("Unterminated KiCad escape sequence.");
            const escaped=source[i++];
            if(!skippedDepth){
              segments??=[];segments.push(source.slice(chunkStart,i-2));
              const decoded=({n:"\n",r:"\r",t:"\t",'"':'"',"\\":"\\"})[escaped];segments.push(decoded===undefined?'\\'+escaped:decoded);
            }
            chunkStart=i;
          }
        }
        if(!closed)throw new Error("Unterminated quoted KiCad string.");
        append(skippedDepth?null:{quoted:text});continue;
      }
      const start = i;
      while (i < source.length) { const code=source.charCodeAt(i);if(code===40||code===41||code===59||code===34||spaceCode(code))break;i++; }
      if (start === i) throw new Error("Unexpected KiCad source character.");
      if(skippedDepth){append(null);continue;}
      const token = source.slice(start, i);
      // Legacy hexadecimal timestamps and unquoted names may look like
      // decimal exponents (e.g. 59E99999). Keep identity fields lexical.
      const parent = stack[stack.length - 1], tag = parent?.[0];
      const lexical = ["uuid", "tstamp", "tedit", "path", "lib_id", "host", "generator", "generator_version"].includes(tag) ||
        (["module", "footprint", "symbol"].includes(tag) && parent.length === 1) ||
        (tag === "net" && parent.length === 2) || (tag === "fp_text" && parent.length === 2) ||
        (tag === "gr_text" && parent.length === 1) || (tag === "pad" && parent.length === 1);
      if (NUMBER.test(token) && !lexical) {
        const number = Number(token);
        if (!Number.isFinite(number)) throw new Error("Invalid numeric KiCad value.");
        append(number);
      } else append(token==='xy'?'xy':token);
    }
    if (stack.length || roots.length !== 1 || !Array.isArray(roots[0])) {
      throw new Error("Incomplete KiCad S-expression.");
    }
    return roots[0];
  }
  const value = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kindOf = (form) => Array.isArray(form) ? (value(form[0]) === "module" ? "footprint" : String(value(form[0]))) : "";
  const children = (form, kind) => form.filter((item) => Array.isArray(item) && kindOf(item) === kind);
  const child = (form, kind) => form.find(item => Array.isArray(item) && kindOf(item) === kind);
  const second = (form, kind) => value(child(form, kind)?.[1]);
  function point(form) {
    for (const name of ["at", "start", "center", "end", "xy"]) {
      const item = child(form, name);
      if (item && Number.isFinite(value(item[1])) && Number.isFinite(value(item[2]))) {
        return { x: value(item[1]), y: value(item[2]) };
      }
    }
    for (const name of ["pts", "polygon"]) {
      const wrapper = child(form, name);
      const xy = wrapper && child(name === "polygon" ? child(wrapper, "pts") || wrapper : wrapper, "xy");
      if (xy && Number.isFinite(value(xy[1])) && Number.isFinite(value(xy[2]))) {
        return { x: value(xy[1]), y: value(xy[2]) };
      }
    }
    return null;
  }
  function properties(form, kind) {
    const entries = [];
    for (const field of children(form, "property")) {
      if (field.length >= 3) entries.push([String(value(field[1])), String(value(field[2]))]);
    }
    if(kind==="footprint")for(const [role,name]of [["reference","Reference"],["value","Value"]]){
      const legacy=children(form,"fp_text").find(field=>value(field[1])===role);
      if(legacy&&legacy.length>=3&&!entries.some(([key])=>key===name))entries.push([name,String(value(legacy[2]))]);
    }
    for (const key of ["lib_id", "layer", "width", "drill", "size", "unit"]) {
      const found = child(form, key);
      if (found) entries.push([key, found.slice(1).map(value).join(", ")]);
    }
    const layers = child(form, "layers");
    if (layers) entries.push(["Layers", layers.slice(1).map(value).join(", ")]);
    const net = child(form, "net");
    if (net) entries.push(["Net", String(value(net[2] ?? net[1]))]);
    const at = child(form, "at");
    if (at && Number.isFinite(value(at[3]))) entries.push(["Angle", String(value(at[3]))]);
    if (["label", "global_label", "hierarchical_label", "text", "gr_text", "gr_text_box"].includes(kind)) {
      entries.push(["Text", String(value(form[1] ?? ""))]);
    }
    if (kind === "pad") {
      entries.push(["Number", String(value(form[1] ?? ""))]);
      entries.push(["Type", String(value(form[2] ?? ""))]);
      entries.push(["Shape", String(value(form[3] ?? ""))]);
    }
    return Object.fromEntries(entries);
  }
  function structural(form) {
    if (!Array.isArray(form)) return form && typeof form === "object" ? ["quoted", form.quoted] : form;
    return form.filter((item) => !Array.isArray(item) || !OMIT.has(kindOf(item))).map(structural);
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function identity(form, kind, props, signature) {
    const uuid = second(form, "uuid") ?? second(form, "tstamp");
    if (uuid !== undefined && uuid !== null && String(uuid)) return { key: `uuid:${uuid}`, uuid: String(uuid) };
    const anchor = kind === "pad" ? props.Number :
      kind === "sheet" ? props.Sheetfile :
      kind === "symbol" || kind === "footprint" ? props.Reference : undefined;
    return { key: anchor ? `fallback:${String(anchor)}` : `fallback:${hash(signature())}`, uuid: null };
  }
  function labelFor(form, kind, props, parentLabel) {
    if (kind === "pad") return `${parentLabel || "Footprint"} pad ${props.Number || ""}`.trim();
    return props.Reference || props.Sheetname || props['Sheet name'] || props.Text ||
      (kind === "footprint" ? String(value(form[1] ?? "Footprint")) :
        kind === "symbol" ? props.lib_id || "symbol" : kind.replace(/_/g, " "));
  }
  function padPosition(local, placement) {
    if (!local || !placement?.position) return null;
    const angle = Number(value(child(placement.form, "at")?.[3] ?? 0));
    const radians = (Number.isFinite(angle) ? angle : 0) * Math.PI / 180;
    const c = Math.cos(radians), s = Math.sin(radians);
    const x = placement.position.x + local.x * c + local.y * s;
    const y = placement.position.y - local.x * s + local.y * c;
    const rounded = (number) => Math.round(number * 1e6) / 1e6;
    return { x: rounded(x), y: rounded(y) };
  }
  function objectRecord(path, form, parent = null, librarySignature = null, forConnectivity = false) {
    const kind = kindOf(form);
    const props = properties(form, kind);
    const local = point(form);
    const position = kind === "pad" ? padPosition(local, parent) : local;
    let retainedSignature;
    const signature = () => retainedSignature ??= JSON.stringify([
      structural(form), position, typeof librarySignature === 'function' ? librarySignature() : librarySignature
    ]);
    if (!forConnectivity) props["Source fingerprint"] = hash(signature());
    const identityValue = identity(form, kind, props, signature);
    const scope = parent ? `${parent.scope}/` : `${path}/`;
    const key = `${scope}${kind}:${identityValue.key}`;
    const label = labelFor(form, kind, props, parent?.label);
    return { key, scope: key, signature: forConnectivity ? null : signature(), metadata: {
      uuid: identityValue.uuid, position, properties: props }, path, kind, label, form };
  }
  function collect(path, content, onParsed = null, options = {}, preparedAst) {
    const { forConnectivity = false, parseOnly = false } = options;
    const rootForm = preparedAst || parse(content, options);
    onParsed?.(rootForm);
    const rootKind = kindOf(rootForm);
    if (rootKind !== "kicad_sch" && rootKind !== "kicad_pcb") throw new Error("Expected a KiCad schematic or board.");
    if (parseOnly) return [];
    const types = rootKind === "kicad_sch" ? SCHEMATIC : BOARD;
    const definitions = new Map();
    if (rootKind === "kicad_sch") {
      const library = child(rootForm, "lib_symbols");
      if (library) for (const definition of children(library, "symbol")) {
        const name = value(definition[1]);
        if (typeof name === "string") definitions.set(name, forConnectivity ? definition : JSON.stringify(structural(definition)));
      }
    }
    const objects = [];
    for (const form of rootForm) {
      if (!Array.isArray(form) || !types.has(kindOf(form))) continue;
      const definition = kindOf(form) === "symbol" ? definitions.get(String(second(form, "lib_name") ?? second(form, "lib_id"))) : null;
      const record = objectRecord(path, form, null, forConnectivity && definition ? () => JSON.stringify(structural(definition)) : definition, forConnectivity);
      objects.push(record);
      if (rootKind === "kicad_pcb" && ["footprint","module"].includes(record.kind)) {
        for (const pad of children(form, "pad")) objects.push(objectRecord(path, pad,
          { form, position: record.metadata.position, scope: record.scope, label: record.label }, null, forConnectivity));
      }
    }
    return objects;
  }
  function parseMetadata(source,options={}){
    const ast=parse(source,{...options,metadataOnly:true});
    return ast.filter((item,index)=>index===0||Array.isArray(item)&&METADATA_FIELDS.has(item[0])).map(item=>Array.isArray(item)&&['symbol','footprint','module'].includes(item[0])?item.filter((field,index)=>index===0||Array.isArray(field)&&METADATA_OBJECT_FIELDS.has(field[0])):item);
  }
  // Job-scoped snapshots reuse validated source without retaining projects globally.
  const preparedProjects = new WeakMap();
  function prepareProject(files, {forConnectivity = false, compactCopper = false} = {}) {
    const parsed = new Map(), records = projectObjects(files, (file, ast) => parsed.set(file.path, ast), null, {forConnectivity, parseOnly: forConnectivity, compactCopper: forConnectivity&&compactCopper});
    const snapshot = Object.freeze({});
    preparedProjects.set(snapshot, {files: files.map(file => ({path: file.path, content: file.content, libraries:JSON.stringify(file.legacyLibraries||[])})), parsed, records: forConnectivity ? null : records, compactCopper: forConnectivity&&compactCopper});
    return snapshot;
  }
  function preparedFile(snapshot, path) {
    const state = preparedProjects.get(snapshot);
    if (!state || !state.parsed.has(path)) throw new Error('Prepared KiCad file is unavailable.');
    return state.parsed.get(path);
  }
  function projectObjects(files, onParsed = null, snapshot = null, {forConnectivity = false, parseOnly = false, compactCopper = false} = {}) {
    if (snapshot) {
      const state = preparedProjects.get(snapshot);
      if (!state || !Array.isArray(files) || files.length !== state.files.length ||
          files.some((file, index) => file?.path !== state.files[index].path || file?.content !== state.files[index].content || JSON.stringify(file.legacyLibraries||[]) !== state.files[index].libraries)) {
        throw new Error('Prepared KiCad project differs from source.');
      }
      if(state.compactCopper&&!forConnectivity)return projectObjects(files,onParsed,null,{parseOnly});
      if (forConnectivity || !state.records) {
        const records = [];
        for (const file of files) {
          for (const record of collect(file.path, file.content, ast => onParsed?.(file, ast),
              {forConnectivity, parseOnly}, state.parsed.get(file.path))) records.push(record);
        }
        return records;
      }
      for (const file of files) onParsed?.(file, state.parsed.get(file.path));
      // Consumers assign IDs to records; keep those assignments isolated.
      return state.records.map(record => ({...record}));
    }
    if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error("Too many KiCad files to compare.");
    const paths = new Set(), objects = [];
    let total = 0;
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string" ||
        !/(?:\.kicad_(?:sch|pcb)|\.(?:sch|brd))$/i.test(file.path) || paths.has(file.path)) {
        throw new Error("Invalid or duplicate KiCad file entry.");
      }
      paths.add(file.path);
      const size = sourceByteLength(file.content);
      total += size;
      if (size > sourceByteLimit(file.path) || total > MAX_PROJECT) throw new Error("KiCad project exceeds browser comparison size limits.");
      for (const object of collect(file.path, file.content, ast => onParsed?.(file, ast), {libraries:file.legacyLibraries, forConnectivity, parseOnly, compactCopper: forConnectivity&&compactCopper})) objects.push(object);
    }
    return objects;
  }
  function compareProjects(baseFiles, headFiles) {
    const base = projectObjects(baseFiles), head = projectObjects(headFiles);
    const grouped = new Map();
    for (const record of base) {
      if (!grouped.has(record.key)) grouped.set(record.key, { before: [], after: [] });
      grouped.get(record.key).before.push(record);
    }
    for (const record of head) {
      if (!grouped.has(record.key)) grouped.set(record.key, { before: [], after: [] });
      grouped.get(record.key).after.push(record);
    }
    const changes = [], counts = { added: 0, removed: 0, modified: 0 };
    const emit = (record, status, before, after, id) => {
      changes.push({ id, path: record.path, kind: record.kind, label: record.label,
        status, before: before?.metadata ?? null, after: after?.metadata ?? null });
      counts[status]++;
    };
    for (const [key, group] of grouped) {
      // Match exact duplicates first, then pair remaining objects deterministically.
      const before = [...group.before], after = [...group.after];
      for (let i = before.length - 1; i >= 0; i--) {
        const j = after.findIndex((record) => record.signature === before[i].signature);
        if (j >= 0) { before.splice(i, 1); after.splice(j, 1); }
      }
      before.sort((a, b) => a.signature.localeCompare(b.signature));
      after.sort((a, b) => a.signature.localeCompare(b.signature));
      const count = Math.max(before.length, after.length);
      for (let i = 0; i < count; i++) {
        const old = before[i] || null, current = after[i] || null;
        const status = old && current ? "modified" : old ? "removed" : "added";
        emit(current || old, status, old, current, count > 1 ? `${key}#${i + 1}` : key);
      }
    }
    changes.sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id) || a.status.localeCompare(b.status));
    return { changes, counts };
  }
  root.KiCadDesignDiff = { compareProjects, projectObjects, parse, parseMetadata, prepareProject, preparedFile, MAX_FILES, MAX_PROJECT, MAX_RENDER_PRIMITIVES, sourceByteLimit, sourceByteLength };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadDesignDiff;
})(typeof globalThis === "object" ? globalThis : this);

;
/* Read-only saved KiCad design and assembly-variant review model. */
((root) => {
  "use strict";
  const diff = root.KiCadDesignDiff || (typeof require === "function" ? require("./design-diff.js") : null);
  const MAX_CONFIG = 1024 * 1024;
  const MAX_VARIANTS = 64;
  const MAX_RULES = 10000;
  const MAX_SAVED_OBJECT_NODES = 20000;
  const MAX_SAVED_OBJECT_CHARS = 512 * 1024;
  const MAX_SAVED_PROJECT_NODES = 300000;
  const MAX_SAVED_PROJECT_CHARS = 16 * 1024 * 1024;
  const MAX_SAVED_PROPERTIES = 512;
  const MAX_SAVED_PROPERTY_NAME_CHARS = 256;
  const MAX_SAVED_PROPERTY_VALUE_CHARS = 4096;
  const PARTS = new Set(["symbol", "footprint"]);
  const RESERVED = new Set(["reference", "uuid", "path", "dnp", "exclude from bom",
    "exclude from board", "unit", "source fingerprint"]);
  const validPath = (path) => typeof path === "string" && path.length <= 500 &&
    /(?:\.kicad_(?:sch|pcb)|\.(?:sch|brd))$/i.test(path) && !path.startsWith("/") &&
    path.split("/").every((part) => part && part !== "." && part !== ".." && !/[\\\x00-\x1f]/.test(part));
  // Variant rules also identify parts in inert imported BoM sources. Drawing
  // traversal continues to use validPath and accepts native KiCad files only.
  const validVariantPath = path => typeof path==='string' && path.length<=500 && /\.(?:kicad_sch|kicad_pcb|csv|tsv|json|html?)$/i.test(path) && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\\\x00-\x1f]/.test(p));
  const textValue = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kindOf = (form) => Array.isArray(form) ? String(textValue(form[0])) : "";
  const child = (form, name) => form.find((item) => Array.isArray(item) && kindOf(item) === name);
  const children = (form, name) => Array.isArray(form) ? form.filter((item) => Array.isArray(item) && kindOf(item) === name) : [];
  const field = (form, name) => textValue(child(form, name)?.[1]);
  const yesNo = (flag) => flag ? "Yes" : "No";
  const safeText = (value, limit = 200) => typeof value === "string" && !!value &&
    value.length <= limit && !/[\x00-\x1f]/.test(value);

  function nativeFlag(form, name) {
    const flag = child(form, name);
    if (!flag) return null;
    if (flag.length === 1) return true;
    const raw = String(textValue(flag[1])).toLowerCase();
    if (["yes", "true", "1"].includes(raw)) return true;
    if (["no", "false", "0"].includes(raw)) return false;
    return null;
  }
  function partFlags(form) {
    const attributes = child(form, "attr")?.slice(1).map((item) => String(textValue(item))) || [];
    const nativeDnp = nativeFlag(form, "dnp") === true || attributes.includes("dnp");
    const affirmative = value => ["yes", "true", "1", "dnp", "dni", "do not populate", "do not install"].includes(String(value ?? "").trim().toLowerCase());
    const marked = names => children(form,"property").some(p => names.includes(String(textValue(p[1])).trim().toLowerCase()) && affirmative(textValue(p[2])));
    const dni = marked(["dni", "do not install"]), dnp = nativeDnp || marked(["dnp", "do not populate"]) || dni;
    const populationReason = nativeDnp ? "DNP" : dni ? "DNI" : dnp ? "DNP" : null;
    const excludeFromBom = nativeFlag(form, "in_bom") === false || attributes.includes("exclude_from_bom");
    const excludeFromBoard = nativeFlag(form, "on_board") === false || attributes.includes("exclude_from_board");
    return { populated: !dnp, populationReason, excludeFromBom, excludeFromBoard };
  }
  function childPath(parent, name) {
    if (typeof name !== "string" || !/(?:\.kicad_sch|\.sch)$/i.test(name) || name.startsWith("/") || name.includes("\\")) return null;
    const parts = parent.split("/").slice(0, -1);
    for (const part of name.split("/")) {
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
    const resolved = parts.join("/");
    return validPath(resolved) ? resolved : null;
  }
  function hasNativeVariant(form) {
    const queue = [form];
    while (queue.length) {
      const item = queue.pop();
      if (!Array.isArray(item)) continue;
      if (kindOf(item) === "variant") return true;
      for (const entry of item) if (Array.isArray(entry)) queue.push(entry);
    }
    return false;
  }
  function ownProps(source) { return Object.fromEntries(Object.entries(source || {})); }
  function frozenTree(node) {
    if (node && typeof node === "object" && Object.isFrozen(node)) return node;
    if (Array.isArray(node)) node.forEach(frozenTree);
    else if (node && typeof node === "object") Object.values(node).forEach(frozenTree);
    return node && typeof node === "object" ? Object.freeze(node) : node;
  }
  function snapshotTree(form, total) {
    let nodes = 0, chars = 0, truncated = false;
    const omitted = (count = 1) => { truncated = true; return { omitted: count }; };
    function clone(item) {
      const scalar = Array.isArray(item) ? 0 : String(textValue(item) ?? "").length;
      if (nodes + 1 > MAX_SAVED_OBJECT_NODES || chars + scalar > MAX_SAVED_OBJECT_CHARS ||
        total.nodes + 1 > MAX_SAVED_PROJECT_NODES || total.chars + scalar > MAX_SAVED_PROJECT_CHARS) return omitted();
      nodes++; total.nodes++; chars += scalar; total.chars += scalar;
      if (Array.isArray(item)) {
        const result = [];
        for (let index = 0; index < item.length; index++) {
          if (nodes >= MAX_SAVED_OBJECT_NODES || total.nodes >= MAX_SAVED_PROJECT_NODES ||
            chars >= MAX_SAVED_OBJECT_CHARS || total.chars >= MAX_SAVED_PROJECT_CHARS) {
            result.push(omitted(item.length - index)); break;
          }
          result.push(clone(item[index]));
        }
        return result;
      }
      if (item && typeof item === "object") return { quoted: item.quoted };
      return item;
    }
    const tree = frozenTree(clone(form));
    return { tree, truncated };
  }
  function sourceProperties(form, tree) {
    const originals = children(form, "property");
    const captured = Array.isArray(tree) ? children(tree, "property") : [];
    return originals.slice(0, MAX_SAVED_PROPERTIES).map((property, index) => {
      const name = String(textValue(property[1] ?? "")), value = String(textValue(property[2] ?? ""));
      return Object.freeze({
        name: name.length <= MAX_SAVED_PROPERTY_NAME_CHARS ? name : null,
        value: value.length <= MAX_SAVED_PROPERTY_VALUE_CHARS ? value : null,
        nameLength: name.length, valueLength: value.length,
        truncated: name.length > MAX_SAVED_PROPERTY_NAME_CHARS || value.length > MAX_SAVED_PROPERTY_VALUE_CHARS,
        tree: captured.length === originals.length ? captured[index] : null
      });
    });
  }
  function relevantLibrary(definition, unit) {
    if (!definition) return null;
    const selected = Number(unit);
    return definition.filter((item) => {
      if (kindOf(item) !== "symbol") return true;
      const match = String(textValue(item[1] ?? "")).match(/_(\d+)_\d+$/);
      return !match || Number(match[1]) === 0 || Number(match[1]) === selected;
    });
  }
  // Keep bounded electrical identity independent of the display snapshot budget.
  function sourceAssociation(form, rootUuid) {
    const instances = [], paths = children(form, "path");
    let complete = paths.length <= 1;
    const path = paths.length === 1 ? textValue(paths[0][1]) : null;
    if (path !== null && !safeText(path, 2000)) complete = false;
    for (const project of children(child(form, "instances"), "project")) {
      for (const placement of children(project, "path")) {
        if (instances.length >= 64) { complete = false; break; }
        const prefix = textValue(placement[1]), reference = field(placement, "reference");
        if (!safeText(prefix, 1800) || !safeText(reference)) { complete = false; continue; }
        instances.push({ prefix, reference });
      }
    }
    return frozenTree({ rootUuid: safeText(rootUuid) ? rootUuid : null,
      path: safeText(path, 2000) ? path : null, instances, complete });
  }
  function savedSettings(item, definitions, total, libraryCache) {
    const source = snapshotTree(item.form, total);
    const properties = sourceProperties(item.form, source.tree);
    const propertyCount = children(item.form, "property").length;
    const saved = { format: "kicad-sexpr", tree: source.tree,
      properties, propertyCount,
      truncated: source.truncated || propertyCount > MAX_SAVED_PROPERTIES || properties.some((field) => field.truncated) };
    if (item.kind === "symbol") {
      const id = String(field(item.form, "lib_name") || field(item.form, "lib_id") || ""), unit = Number(field(item.form, "unit") || 1);
      const definition = definitions?.get(id);
      if (definition) {
        const key = `${item.path}\0${id}\0${unit}`;
        if (!libraryCache.has(key)) {
          const library = snapshotTree(relevantLibrary(definition, unit), total);
          libraryCache.set(key, frozenTree({ id, unit, tree: library.tree, truncated: library.truncated }));
        }
        saved.library = libraryCache.get(key);
      }
    }
    return frozenTree(saved);
  }
  function validPropertyName(name) {
    return safeText(name, 100) && !["__proto__", "constructor", "prototype"].includes(name.toLowerCase()) &&
      !RESERVED.has(name.toLowerCase());
  }
  function normalizeConfig(config) {
    if (config == null) return { variants: [], warnings: [] };
    if (!config || typeof config !== "object" || Array.isArray(config) || config.schemaVersion !== 1 ||
      !Array.isArray(config.variants) || config.variants.length > MAX_VARIANTS) {
      throw new Error("Variant metadata requires schemaVersion 1 and a variants array (max 64).");
    }
    if (Object.keys(config).some((key) => !["schemaVersion", "variants", "warnings", "format"].includes(key)) ||
      (config.format !== undefined && config.format !== "csv")) {
      throw new Error("Variant metadata has unsupported fields.");
    }
    const csv = config.format === "csv";
    const ids = new Set(), variants = [];
    let ruleCount = 0;
    for (const variant of config.variants) {
      if (!variant || !safeText(variant.id, 64) || variant.id === "default" ||
        !/^[A-Za-z0-9_-]+$/.test(variant.id) ||
        !safeText(variant.name, 100) || !Array.isArray(variant.parts) || ids.has(variant.id) ||
        Object.keys(variant).some((key) => !["id", "name", "parts"].includes(key))) {
        throw new Error("Variant IDs/names must be unique and parts must be an array.");
      }
      ids.add(variant.id);
      const rules = [];
      for (const rule of variant.parts) {
        if (++ruleCount > MAX_RULES) throw new Error("Variant metadata has too many part rules.");
        if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
          Object.keys(rule).some((key) => !["path", "reference", "uuid", "populated", "properties"].includes(key))) {
          throw new Error("Variant part rule has unsupported fields.");
        }
        if ((rule.path === undefined ? !csv : !validVariantPath(rule.path)) ||
          (rule.reference === undefined) === (rule.uuid === undefined) ||
          (rule.reference !== undefined && !safeText(rule.reference)) ||
          (rule.uuid !== undefined && !safeText(rule.uuid)) ||
          (rule.populated !== undefined && typeof rule.populated !== "boolean")) {
          throw new Error("Each variant part needs a safe file path, exactly one reference or UUID, and optional boolean populated.");
        }
        if (rule.properties !== undefined && (!rule.properties || typeof rule.properties !== "object" ||
          Array.isArray(rule.properties) || Object.keys(rule.properties).length > 128)) {
          throw new Error("Variant properties must be a small object.");
        }
        const properties = {};
        for (const [name, value] of Object.entries(rule.properties || {})) {
          if (!validPropertyName(name) || !["string", "number", "boolean"].includes(typeof value) ||
            (typeof value === "string" && value.length > 4096) ||
            (typeof value === "number" && !Number.isFinite(value))) {
            throw new Error(`Invalid variant property: ${name}.`);
          }
          Object.defineProperty(properties, name, { value: String(value), enumerable: true, writable: true });
        }
        if (rule.populated === undefined && !Object.keys(properties).length) {
          throw new Error("Variant part rule has no population or property override.");
        }
        rules.push({ path: rule.path ?? null, reference: rule.reference ?? null,
          uuid: rule.uuid ?? null, populated: rule.populated, properties });
      }
      variants.push({ id: variant.id, name: variant.name, parts: rules });
    }
    return { variants, warnings: Array.isArray(config.warnings) ? config.warnings.filter((item) => typeof item === "string").slice(0, 1000) : [] };
  }
  function parseCsv(text) {
    const rows = [], row = [];
    let cell = "", quoted = false, closed = false;
    function finishCell() { row.push(cell); cell = ""; closed = false; }
    function finishRow() { finishCell(); rows.push(row.splice(0)); if (rows.length > MAX_RULES + 1) throw new Error("CSV has too many rows."); }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else cell += ch;
      } else if (ch === '"') {
        if (cell || closed) throw new Error(`Malformed quoted CSV field near row ${rows.length + 1}.`);
        quoted = true;
      } else if (ch === ",") finishCell();
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        finishRow();
      } else if (closed && !/\s/.test(ch)) throw new Error(`Characters after quoted CSV field near row ${rows.length + 1}.`);
      else if (!closed) cell += ch;
    }
    if (quoted) throw new Error("Unterminated quoted CSV field.");
    if (cell || row.length || closed) finishRow();
    return rows.filter((fields) => fields.some((item) => item.trim()));
  }
  function csvBoolean(value) {
    if (!value) return null;
    const lower = value.trim().toLowerCase();
    if (["yes", "true", "1", "y"].includes(lower)) return true;
    if (["no", "false", "0", "n"].includes(lower)) return false;
    return undefined;
  }
  function csvConfig(text) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ""));
    if (!rows.length) throw new Error("Variant CSV is empty.");
    const headers = rows.shift().map((item) => item.trim());
    const lower = headers.map((item) => item.toLowerCase());
    if (!lower.includes("variant") || !lower.includes("reference")) {
      throw new Error("Variant CSV requires Variant and Reference columns.");
    }
    if (new Set(lower).size !== lower.length) throw new Error("Variant CSV has duplicate headers.");
    const reserved = new Set(["variant", "reference", "file", "path", "file/path", "populated", "dnp"]);
    const variants = new Map(), warnings = [];
    for (let index = 0; index < rows.length; index++) {
      const cells = rows[index], line = index + 2;
      if (cells.length > headers.length) { warnings.push(`CSV row ${line}: too many fields; row skipped.`); continue; }
      const column = (name) => cells[lower.indexOf(name)]?.trim() || "";
      const name = column("variant"), references = column("reference").split(/[,\s]+/).filter(Boolean);
      if (!safeText(name, 100) || !references.length) { warnings.push(`CSV row ${line}: missing variant or reference; row skipped.`); continue; }
      const file = column("file/path") || column("file") || column("path");
      if (file && !validVariantPath(file)) { warnings.push(`CSV row ${line}: unsafe or unsupported file path; row skipped.`); continue; }
      const populated = csvBoolean(column("populated")), dnp = csvBoolean(column("dnp"));
      if (populated === undefined || dnp === undefined ||
        (populated !== null && dnp !== null && populated === dnp)) {
        warnings.push(`CSV row ${line}: invalid or conflicting Populated/DNP value; row skipped.`); continue;
      }
      const effective = populated !== null ? populated : dnp !== null ? !dnp : undefined;
      const properties = {};
      let invalid = false;
      for (let c = 0; c < headers.length; c++) {
        if (reserved.has(lower[c]) || !cells[c]?.trim()) continue;
        if (!validPropertyName(headers[c]) || cells[c].length > 4096) { invalid = true; break; }
        Object.defineProperty(properties, headers[c], { value: cells[c].trim(), enumerable: true, writable: true });
      }
      if (invalid || (effective === undefined && !Object.keys(properties).length)) {
        warnings.push(`CSV row ${line}: invalid or empty override; row skipped.`); continue;
      }
      if (!variants.has(name)) variants.set(name, { id: "", name, parts: [] });
      for (const reference of references) {
        if (!safeText(reference)) { warnings.push(`CSV row ${line}: invalid reference ${reference}; skipped.`); continue; }
        variants.get(name).parts.push({ ...(file ? { path: file } : {}), reference,
          ...(effective === undefined ? {} : { populated: effective }), properties });
      }
    }
    const used = new Set();
    for (const variant of variants.values()) {
      const base = variant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "variant";
      let id = base.slice(0, 64), suffix = 2;
      while (id === "default" || used.has(id)) {
        const tail = `-${suffix++}`;
        id = `${base.slice(0, 64 - tail.length)}${tail}`;
      }
      variant.id = id; used.add(id);
    }
    return { schemaVersion: 1, format: "csv", variants: [...variants.values()], warnings };
  }
  function parseVariantConfig(text, filename) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_CONFIG) {
      throw new Error("Variant metadata must be text under 1 MiB.");
    }
    if (/\.csv$/i.test(filename || "")) return csvConfig(text);
    if (!/\.json$/i.test(filename || "")) throw new Error("Use a .json or .csv variant metadata file.");
    let config;
    try { config = JSON.parse(text); } catch { throw new Error("Variant JSON is malformed."); }
    normalizeConfig(config);
    return config;
  }
  function buildProject(files, variantConfig = null, snapshot = null, {forConnectivity = false} = {}) {
    if (!diff?.projectObjects || !diff.parse) throw new Error("Load design-diff.js before design-model.js.");
    if (!Array.isArray(files) || files.some((file) => !validPath(file?.path))) {
      throw new Error("Project contains an unsafe or unsupported KiCad path.");
    }
    const config = normalizeConfig(variantConfig);
    const warnings = [...config.warnings];
    const sheets = [], labels = new Map(), paths = new Set(files.map((file) => file.path));
    const definitionsByPath = new Map(), rootUuids = new Map();
    const raw = diff.projectObjects(files, (file, parsed) => {
      const kind = kindOf(parsed) === "kicad_sch" ? "schematic" : "board";
      sheets.push({ path: file.path, label: file.path.split("/").at(-1), kind, ...(kind === "schematic" && safeText(field(parsed, "uuid")) ? { rootUuid: field(parsed, "uuid") } : {}) });
      if (kind === "schematic") {
        rootUuids.set(file.path, field(parsed, "uuid"));
        const definitions = new Map();
        for (const definition of children(child(parsed, "lib_symbols"), "symbol")) {
          const id = textValue(definition[1]);
          if (typeof id === "string") definitions.set(id, definition);
        }
        definitionsByPath.set(file.path, definitions);
      }
      if (hasNativeVariant(parsed)) warnings.push(`${file.path}: saved native KiCad variant data is present but is not interpreted by this review overlay.`);
    },snapshot,{forConnectivity});
    for (const item of raw) if (item.kind === "sheet") {
      const target = childPath(item.path, item.metadata.properties.Sheetfile ?? item.metadata.properties['Sheet file']);
      if (target && paths.has(target)) labels.set(target, item.metadata.properties.Sheetname || item.metadata.properties['Sheet name'] || target.split("/").at(-1));
    }
    for (const sheet of sheets) if (labels.has(sheet.path)) sheet.label = labels.get(sheet.path);
    const ids = new Map(), byRawKey = new Map(), objects = [];
    const savedBudget = { nodes: 0, chars: 0 }, libraryCache = new Map();
    for (const item of raw) {
      const number = (ids.get(item.key) || 0) + 1;
      ids.set(item.key, number);
      const id = number === 1 ? item.key : `${item.key}#${number}`;
      if (number > 1) warnings.push(`${item.path}: duplicate saved identity ${item.key}; object IDs were disambiguated.`);
      const props = ownProps(item.metadata.properties);
      const part = PARTS.has(item.kind);
      const flags = part ? partFlags(item.form) : null;
      const parentKey = item.kind === "pad" ? item.key.slice(0, item.key.lastIndexOf("/pad:")) : null;
      const parent = parentKey ? byRawKey.get(parentKey) : null;
      if (part) {
        props.DNP = yesNo(!flags.populated);
        props["Exclude from BOM"] = yesNo(flags.excludeFromBom);
        props["Exclude from board"] = yesNo(flags.excludeFromBoard);
        const unit = field(item.form, "unit");
        if (unit !== undefined) props.Unit = String(unit);
        const library = item.kind === "symbol" ? field(item.form, "lib_id") : textValue(item.form[1]);
        if (library !== undefined) props["Library ID"] = String(library);
      }
      const record = { id, path: item.path, kind: item.kind, label: item.label,
        uuid: item.metadata.uuid, position: item.metadata.position, properties: props,
        saved: savedSettings(item, definitionsByPath.get(item.path), savedBudget, libraryCache),
        reference: part ? props.Reference || null : parent?.reference || null,
        parentId: parent?.id || null,
        populated: part ? flags.populated : parent ? parent.populated : null,
        populationReason: part ? flags.populationReason : parent?.populationReason || null,
        excludeFromBom: part ? flags.excludeFromBom : parent ? parent.excludeFromBom : null };
      if (part) record.association = sourceAssociation(item.form, rootUuids.get(item.path));
      objects.push(record);
      if (!byRawKey.has(item.key)) byRawKey.set(item.key, record);
    }
    const rules = new Map([["default", []]]);
    for (const variant of config.variants) {
      const selected = [];
      for (const rule of variant.parts) {
        const candidates = objects.filter((item) => PARTS.has(item.kind) &&
          (!rule.path || item.path === rule.path) &&
          (rule.uuid ? item.uuid === rule.uuid : item.reference === rule.reference));
        const label = rule.reference || rule.uuid;
        if (!candidates.length) { warnings.push(`${variant.name}: ${label} was not found${rule.path ? ` in ${rule.path}` : ""}; override skipped.`); continue; }
        const candidatePaths = new Set(candidates.map((item) => item.path));
        if (candidatePaths.size > 1) { warnings.push(`${variant.name}: ${label} exists in multiple files; specify File/Path; override skipped.`); continue; }
        if (rule.uuid && candidates.length !== 1) { warnings.push(`${variant.name}: UUID ${label} is ambiguous; override skipped.`); continue; }
        if (rule.reference) {
          const units = candidates.map((item) => item.properties.Unit || "");
          if (new Set(units).size !== units.length) {
            warnings.push(`${variant.name}: ${label} repeats within a file without distinct units; use UUID; override skipped.`);
            continue;
          }
        }
        selected.push({ ids: candidates.map((item) => item.id), populated: rule.populated, properties: rule.properties });
      }
      rules.set(variant.id, selected);
    }
    const model = { sheets, objects, variants: [{ id: "default", name: "Saved design" },
      ...config.variants.map(({ id, name }) => ({ id, name }))], warnings };
    Object.defineProperty(model, "_rules", { value: rules });
    return model;
  }
  function applyVariant(model, variantId) {
    if (!model || !Array.isArray(model.objects)) throw new Error("Invalid design model.");
    const overlays = variantId == null ? [] : model._rules?.get(variantId);
    if (!overlays) throw new Error(`Unknown variant: ${variantId}.`);
    const records = model.objects.map((item) => ({ ...item, properties: ownProps(item.properties) }));
    const byId = new Map(records.map((item) => [item.id, item]));
    for (const overlay of overlays) for (const id of overlay.ids) {
      const record = byId.get(id);
      if (!record) continue;
      Object.assign(record.properties, overlay.properties);
      if (overlay.populated !== undefined) {
        record.populationReason = overlay.populated ? null : record.populationReason || "DNP";
        record.populated = overlay.populated;
        record.properties.DNP = yesNo(!overlay.populated);
      }
    }
    for (const record of records) if (record.kind === "pad" && record.parentId) {
      const parent = byId.get(record.parentId);
      if (parent) { record.populated = parent.populated; record.populationReason = parent.populationReason; record.excludeFromBom = parent.excludeFromBom; }
    }
    return records;
  }
  root.KiCadDesignModel = { buildProject, applyVariant, parseVariantConfig };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadDesignModel;
})(typeof globalThis === "object" ? globalThis : this);

;
/* Saved-format capability disclosure; never upgrades or rewrites a design. */
((root)=>{'use strict';
 const value=x=>x&&typeof x==='object'&&!Array.isArray(x)?x.quoted:x;
 const common='version generator generator_version uuid paper title_block embedded_fonts embedded_files legacy_source legacy_diagnostic'.split(' ');
 const known={kicad_pcb:new Set([...common,...'general layers setup net footprint module host page net_class segment arc via zone gr_line gr_arc gr_rect gr_circle gr_poly gr_text gr_curve gr_text_box gr_bitmap dimension target property group image'.split(' ')]),kicad_sch:new Set([...common,...'lib_symbols symbol sheet wire bus bus_entry junction no_connect label global_label hierarchical_label netclass_flag text text_box table image rule_area polyline rectangle circle arc bezier sheet_instances symbol_instances group'.split(' ')])};
 // Deliberately bounded numeric subset of KiCad 10 text expressions. See
 // https://docs.kicad.org/10.0/en/eeschema/eeschema.html#text-expressions
 // Units, strings, logical/time/random functions and unknown syntax stay literal.
 function numericExpression(source){
  if(source.length>4096)throw Error('expression length limit');
  const tokens=[];let offset=0;
  while(offset<source.length){
   if(/\s/.test(source[offset])){offset++;continue;}
   const match=/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z_][a-zA-Z_0-9]*|[+*/%^(),-])/.exec(source.slice(offset));
   if(!match)throw Error('unsupported expression syntax, unit or function');
   tokens.push(match[0]);offset+=match[0].length;if(tokens.length>256)throw Error('expression token limit');
  }
  let cursor=0;
  const finite=value=>{if(!Number.isFinite(value))throw Error('non-finite expression result or invalid domain');return value;};
  const take=token=>tokens[cursor]===token?(cursor++,true):false;
  function primary(depth){
   if(depth>32)throw Error('expression nesting limit');
   if(take('(')){const result=expression(0,depth+1);if(!take(')'))throw Error('missing closing parenthesis');return result;}
   const token=tokens[cursor++];if(token===undefined)throw Error('missing expression operand');
   if(/^(?:\d|\.)/.test(token))return finite(Number(token));
   if(!/^[a-z]/.test(token)||!take('('))throw Error('unsupported expression syntax, unit or function');
   const args=[];if(!take(')')){do{args.push(expression(0,depth+1));}while(take(','));if(!take(')'))throw Error('missing closing parenthesis');}
   const one={abs:Math.abs,sqrt:Math.sqrt,floor:Math.floor,ceil:Math.ceil};
   if(Object.prototype.hasOwnProperty.call(one,token)){if(args.length!==1)throw Error('invalid function argument count');return finite(one[token](args[0]));}
   if(token==='pow'){if(args.length!==2)throw Error('invalid function argument count');return finite(Math.pow(args[0],args[1]));}
   if(['min','max','sum','avg'].includes(token)){if(!args.length)throw Error('invalid function argument count');return finite(token==='min'?Math.min(...args):token==='max'?Math.max(...args):args.reduce((sum,value)=>sum+value,0)/(token==='avg'?args.length:1));}
   throw Error('unsupported expression function '+token);
  }
  function expression(minimum,depth){
   if(depth>32)throw Error('expression nesting limit');
   // Exponentiation binds more tightly than a leading sign and associates right.
   let left=take('+')?expression(3,depth+1):take('-')?-expression(3,depth+1):primary(depth+1);
   const precedence={'+':1,'-':1,'*':2,'/':2,'%':2,'^':3};
   while(Object.prototype.hasOwnProperty.call(precedence,tokens[cursor])&&precedence[tokens[cursor]]>=minimum){
    const operator=tokens[cursor++],right=expression(precedence[operator]+(operator==='^'?0:1),depth+1);
    if((operator==='/'||operator==='%')&&right===0)throw Error('division or modulo by zero');
    left=finite(operator==='+'?left+right:operator==='-'?left-right:operator==='*'?left*right:operator==='/'?left/right:operator==='%'?left%right:Math.pow(left,right));
   }
   return finite(left);
  }
  const result=expression(0,0);if(cursor!==tokens.length)throw Error('unsupported expression syntax, unit or function');return String(Object.is(result,-0)?0:result);
 }
 function textExpressions(input,warn=()=>{}){
  const text=String(input??''),expressions=[];let count=0;
  if(!text.includes('@{'))return {value:text,expressions};
  if(text.length>65536){const reason='text expression input limit';warn(reason+'; preserved literally.');return {value:text,expressions:[{raw:text,value:text,status:'unresolved',reason}]};}
  const endOf=(source,start)=>{let depth=1,quote=null;for(let i=start+2;i<source.length;i++){const char=source[i];if(quote){if(char==='\\'){i++;continue;}if(char===quote)quote=null;continue;}if(char==='"'||char==="'"){quote=char;continue;}if(char==='{')depth++;else if(char==='}'&&!--depth)return i;}return -1;};
  function expand(source,depth,record){
   if(depth>16)throw Error('nested text expression limit');
   let result='',position=0,start;
   while((start=source.indexOf('@{',position))>=0){
    if(count>=128){const reason='text expression count limit';if(!record)throw Error(reason);const raw=source.slice(start);expressions.push({raw,value:raw,status:'unresolved',reason});warn(reason+'; remaining text preserved literally.');return result+source.slice(position);}
    result+=source.slice(position,start);const end=endOf(source,start),raw=source.slice(start,end<0?source.length:end+1);let value=raw,reason;
    try{if(++count>128)throw Error('text expression count limit');if(end<0)throw Error('unclosed text expression');if(raw.length>4099)throw Error('expression length limit');value=numericExpression(expand(raw.slice(2,-1),depth+1,false));}
    catch(error){reason=error.message;if(!record)throw error;warn('Unsupported or invalid text expression: '+reason+'; preserved literally.');}
    if(record)expressions.push({raw,value,status:reason?'unresolved':'resolved',...(reason?{reason}:{})});
    result+=value;position=end<0?source.length:end+1;
   }
   return result+source.slice(position);
  }
  return {value:expand(text,0,true),expressions};
 }
 // Resolve saved text only: no environment, filesystem access or dynamic code execution.
 function textLinks(text,href){
  const target=input=>{if(typeof input!=='string'||input.length>4096||/[\x00-\x20\x7f]/.test(input))return null;
   if(/^#[^#/?\\]{1,64}$/.test(input))return {kind:'sheet',page:input.slice(1),target:input};
   if(!/^https?:\/\//i.test(input))return null;
   try{const url=new URL(input);if(url.username||url.password||!url.hostname)return null;return {kind:'web',target:url.href};}catch{return null;}
  };
  if(href!==undefined&&href!=='')return [target(href)].filter(Boolean);
  const links=new Map();for(const match of String(text??'').slice(0,65536).matchAll(/https?:\/\/[^\s<>"\u0000-\u001f]+/gi)){const link=target(match[0].replace(/[.,;!]+$/,''));if(link)links.set(link.target,link);if(links.size>=32)break;}
  return [...links.values()];
 }
 function textResolver(ast,options={},warn=()=>{}){
  const fields=node=>{const result=Object.fromEntries((node||[]).filter(x=>Array.isArray(x)&&value(x[0])==='property').map(x=>[String(value(x[1])),String(value(x[2])??'')]));for(const key of ['Reference','Value','Footprint','Datasheet','Description'])if(Object.prototype.hasOwnProperty.call(result,key))result[key.toUpperCase()]=result[key];return result;};
  const sheetContexts=(options.sheetContexts||[]).map(context=>({...context,fields:Object.assign(Object.create(null),context.fields)})),blocked=new Set(options.unavailableVariables||[]);
  const saved=Object.create(null),sources=Object.create(null),title=(ast||[]).find(x=>Array.isArray(x)&&value(x[0])==='title_block');
  const save=(key,text,source)=>{saved[key]=text;sources[key]=source;};
  for(const entry of title||[]){if(!Array.isArray(entry))continue;const key=String(value(entry[0]));if(['title','date','rev','company'].includes(key))save({title:'TITLE',date:'ISSUE_DATE',rev:'REVISION',company:'COMPANY'}[key],String(value(entry[1])??''),'Title block');if(key==='comment')save('COMMENT'+value(entry[1]),String(value(entry[2])??''),'Title block');}
  const project=options.textVariables||options.project?.text_variables||options.projectSettings?.text_variables||{};
  const globals=Object.create(null);for(const [key,text] of Object.entries(project))if(typeof text==='string'&&key.length<=200&&text.length<=65536){globals[key]=text;if(!Object.prototype.hasOwnProperty.call(saved,key))save(key,text,'Project');}
  for(const [key,text] of Object.entries(fields(ast)))save(key,text,'Drawing field');
  if(typeof options.path==='string'){save('FILENAME',options.path.split('/').pop(),'Drawing context');save('FILEPATH',options.path,'Drawing context');}
  for(const [key,text] of [['#',options.sheetNumber],['##',options.sheetCount],['SHEETNAME',options.sheetName],['PROJECTNAME',options.projectName]])if(text!==undefined)save(key,String(text),'Sheet context');
  const references=new Map();
  for(const node of ast||[]){if(!Array.isArray(node)||!['symbol','footprint','module'].includes(value(node[0])))continue;const local=fields(node),ref=local.Reference;if(ref)references.set(ref,references.has(ref)?null:local);}
  // Symbol fields are case-insensitive in KiCad. Sheet and project bindings
  // retain their saved case; never fold the entire hierarchy into one map.
  const objectKey=(owner,key)=>{if(Object.prototype.hasOwnProperty.call(owner||{},key))return key;const matches=Object.keys(owner||{}).filter(name=>name.toUpperCase()===key.toUpperCase());return matches.length===1?matches[0]:null;};
  const reported=new Set();
  function inspectText(input,local={},scopeStart=0,projectOnly=false){
   const raw=String(input??''),variables=new Map(),unresolved=new Set();
   if(!raw.includes('${')&&!raw.includes('@{'))return {raw,value:raw,fromVariable:false,variables:[],unresolved:[],status:'literal'};
   local=Object.assign(Object.create(null),local);for(const key of ['Reference','Value','Footprint','Datasheet','Description'])if(Object.prototype.hasOwnProperty.call(local,key))local[key.toUpperCase()]=local[key];
   let count=0;
   const expand=(text,chain=[],owner=local,start=0,globalOnly=false)=>text.replace(/\$\{([^{}]{1,200})\}/g,(token,key)=>{
    const separator=key.lastIndexOf(':'),target=separator>0?references.get(key.slice(0,separator)):null,field=separator>0?key.slice(separator+1):key;
    let own,lookup=key,source,nextOwner=owner,nextStart=start,nextGlobal=globalOnly;
    if(!globalOnly&&separator>0&&references.has(key.slice(0,separator))){own=target;lookup=objectKey(target,field);source='Reference '+key.slice(0,separator);nextOwner=target||{};}
    else if(!globalOnly&&objectKey(owner,key)!==null){own=owner;lookup=objectKey(owner,key);source=owner===local?'Selected object field':'Referenced object field';}
    else if(!globalOnly&&blocked.has(key)){source='Ambiguous sheet instance';}
    else {
     let index=globalOnly?-1:sheetContexts.findIndex((context,i)=>i>=start&&Object.prototype.hasOwnProperty.call(context.fields,key));
     if(index>start&&Object.prototype.hasOwnProperty.call(saved,key)&&sources[key]!=='Project')index=-1;
     if(index>=0){own=sheetContexts[index].fields;source=sheetContexts[index].source||'Sheet field';nextOwner={};nextStart=index;}
     else {own=globalOnly?globals:saved;source=globalOnly?'Project':sources[key];if(source==='Project'||source==='Title block'){nextOwner={};nextGlobal=true;}}
    }
    if(!own||!Object.prototype.hasOwnProperty.call(own,lookup)||typeof own[lookup]!=='string'){unresolved.add(key);variables.set(key,{name:key,source:source==='Ambiguous sheet instance'?source:separator>0&&references.has(key.slice(0,separator))?'Ambiguous or missing reference field':'Unavailable',raw:token});if(!reported.has(key)){reported.add(key);warn('Unresolved saved text variable '+token+'; preserved literally.');}return token;}
    const identity=source+'\0'+key+'\0'+nextStart;
    if(++count>256||chain.length>=8||chain.includes(identity)){unresolved.add(key);if(!reported.has(key)){reported.add(key);warn('Text variable '+token+' is recursive or exceeds the substitution limit; preserved literally.');}return token;}
    variables.set(key,{name:key,source:source||'Saved field',raw:own[lookup]});
    return expand(own[lookup],chain.concat(identity),nextOwner,nextStart,nextGlobal);
   });
   let resolved=expand(raw,[],local,scopeStart,projectOnly);if(resolved.length>65536){warn('Expanded text exceeds the saved-text limit; preserved literally.');resolved=raw;unresolved.add('Expansion limit');}
   const evaluated=textExpressions(resolved,warn);resolved=evaluated.value;for(const item of evaluated.expressions)if(item.status==='unresolved')unresolved.add(item.raw);
   return {raw,value:resolved,fromVariable:raw.includes('${'),fromExpression:evaluated.expressions.length>0,expressions:evaluated.expressions,variables:[...variables.values()],unresolved:[...unresolved],status:unresolved.size?'unresolved':'resolved'};
  }
  const resolve=(input,local={})=>inspectText(input,local).value;
  function list(local={}, {includeShadowed=false}={}){
   const names=new Set([...Object.keys(saved),...sheetContexts.flatMap(context=>Object.keys(context.fields)),...blocked,...Object.keys(local)]);
   for(const text of [...Object.values(saved),...sheetContexts.flatMap(context=>Object.values(context.fields)),...Object.values(local)])if(typeof text==='string')for(const match of text.matchAll(/\$\{([^{}]{1,200})\}/g))names.add(match[1]);
   const rows=[...names].sort().slice(0,512).map(name=>{const detail=inspectText('${'+name+'}',local),binding=detail.variables.find(item=>item.name===name);return {name,source:binding?.source||'Unavailable',raw:binding?.raw??'${'+name+'}',value:detail.value,status:detail.status,unresolved:detail.unresolved};});
   if(includeShadowed){
    const append=(name,source,raw,detail,scope)=>{if(rows.some(row=>row.name===name&&row.source===source))return;rows.push({name,source,raw,value:detail.value,status:detail.status,unresolved:detail.unresolved,scope,shadowed:true});};
    for(const [name,raw]of Object.entries(globals))append(name,'Project',raw,inspectText('${'+name+'}',{},0,true),'project');
    for(const [index,context]of sheetContexts.entries())for(const [name,raw]of Object.entries(context.fields))append(name,context.source||'Sheet field',raw,inspectText('${'+name+'}',{},index),'sheet');
   }
   return rows.slice(0,1024);
  }
  function properties(entries){const values=Object.create(null),provenance=Object.create(null);for(const [key,text] of Object.entries(entries||{})){const detail=inspectText(text,entries);values[key]=detail.value;if(detail.fromVariable||detail.fromExpression)provenance[key]=detail;}return {values,provenance};}
  return {resolve,fields,inspect:inspectText,list,properties};
 }
 // Saved hierarchy instances, not filenames, own sheet fields. The caller supplies its
 // existing parser/cache; this helper performs no I/O and never reads the environment.
 function textContext(files,path,{rootFile=path,instancePath,parse}={}){
  const child=(node,name)=>(node||[]).find(item=>Array.isArray(item)&&value(item[0])===name),field=(node,name)=>value(child(node,name)?.[1]);
  const byPath=new Map((files||[]).map(file=>[file.path,file])),cache=new Map(),candidates=[];
  const read=name=>{if(cache.has(name))return cache.get(name);const file=byPath.get(name);let ast=file?.ast;try{if(!ast&&file&&parse)ast=parse(file.content,file);}catch{}cache.set(name,ast);return ast;};
  const props=node=>Object.fromEntries((node||[]).filter(item=>Array.isArray(item)&&value(item[0])==='property').map(item=>[String(value(item[1])),String(value(item[2])??'')]));
  const relative=(parent,name)=>{if(typeof name!=='string'||!name||/^(?:[a-z]+:|[\\/])/i.test(name)||name.includes('${'))return null;const parts=parent.split('/').slice(0,-1);for(const part of name.replace(/\\/g,'/').split('/')){if(part==='..'){if(!parts.length)return null;parts.pop();}else if(part&&part!=='.')parts.push(part);}return parts.join('/');};
  let visited=0,incomplete=false;
  function visit(file,contexts,ids,names,ancestors){
   if(++visited>512||ancestors.length>=32||ancestors.includes(file)){incomplete=true;return;}
   const ast=read(file);if(!ast)return;
   const id=ids.every(Boolean)?'/'+ids.join('/'):null,name=names.every(item=>typeof item==='string')?(names.length?'/'+names.join('/')+'/':'/'):undefined;
   if(file===path)candidates.push({instancePath:id,parentPath:ancestors.at(-1)||null,parentInstancePath:ids.length>1&&ids.every(Boolean)?'/'+ids.slice(0,-1).join('/'):null,sheetContexts:contexts,sheetName:names.length?names.at(-1):'/',sheetPath:name,...(pageNumbers.has(id)?{sheetNumber:pageNumbers.get(id)}:{})});
   for(const sheet of (ast||[]).filter(item=>Array.isArray(item)&&value(item[0])==='sheet')){
    const fields=props(sheet),target=relative(file,fields.Sheetfile??fields['Sheet file']),uuid=field(sheet,'uuid');if(!target||!byPath.has(target))continue;
    const sheetName=fields.Sheetname??fields['Sheet name'],nextIds=ids.concat(uuid),nextNames=names.concat(sheetName);
    const nextId=nextIds.every(Boolean)?'/'+nextIds.join('/'):null;
    for(const instances of (sheet||[]).filter(item=>Array.isArray(item)&&value(item[0])==='instances'))for(const project of instances.filter(item=>Array.isArray(item)&&value(item[0])==='project'))for(const entry of project.filter(item=>Array.isArray(item)&&value(item[0])==='path'))if(String(value(entry[1])).replace(/\/$/,'')===id){const page=field(entry,'page');if(nextId&&page!==undefined)pageNumbers.set(nextId,String(page));}
    const bindings={...fields,SHEETFILE:fields.Sheetfile??fields['Sheet file']};if(sheetName!==undefined)bindings.SHEETNAME=sheetName;
    if(nextNames.every(item=>typeof item==='string'))bindings.SHEETPATH='/'+nextNames.join('/')+'/';
    visit(target,[{fields:bindings,source:bindings.SHEETPATH?'Sheet '+bindings.SHEETPATH:'Sheet fields ('+target+')',instancePath:nextIds.every(Boolean)?'/'+nextIds.join('/'):null},...contexts],nextIds,nextNames,ancestors.concat(file));
   }
  }
  // A direct child-file view may still receive its loaded ancestors. Recover a
  // unique saved root instead of treating the child as a new hierarchy root.
  const parents=new Map();for(const file of (files||[]).slice(0,512))for(const sheet of (read(file.path)||[]).filter(item=>Array.isArray(item)&&value(item[0])==='sheet')){const fields=props(sheet),target=relative(file.path,fields.Sheetfile??fields['Sheet file']);if(target&&byPath.has(target)){if(!parents.has(target))parents.set(target,new Set());parents.get(target).add(file.path);}}
  const roots=new Set(),seen=new Set();function ascend(file){if(seen.has(file)){return;}seen.add(file);const incoming=parents.get(file);if(!incoming?.size)roots.add(file);else for(const parent of incoming)ascend(parent);}
  ascend(rootFile);if(roots.size===1)rootFile=[...roots][0];else if(roots.size!==1)incomplete=true;
  const rootAst=read(rootFile),rootId=field(rootAst,'uuid'),pageNumbers=new Map();
  for(const group of (rootAst||[]).filter(item=>Array.isArray(item)&&value(item[0])==='sheet_instances'))for(const entry of group.filter(item=>Array.isArray(item)&&value(item[0])==='path')){const parts=String(value(entry[1])).split('/').filter(Boolean);if(parts[0]!==rootId)parts.unshift(rootId);const page=field(entry,'page');if(parts.every(Boolean)&&page!==undefined)pageNumbers.set('/'+parts.join('/'),String(page));}
  visit(rootFile,[],[rootId],[],[]);
  const selected=instancePath?candidates.filter(item=>item.instancePath?.replace(/\/$/,'')===String(instancePath).replace(/\/$/,'')):candidates;
  if(selected.length===1&&!incomplete)return {...selected[0],contextStatus:'resolved',instances:candidates};
  const unavailableVariables=[...new Set([...candidates.flatMap(item=>item.sheetContexts.flatMap(context=>Object.keys(context.fields))),'SHEETNAME','SHEETPATH','#'])];
  return {sheetContexts:[],unavailableVariables,contextStatus:selected.length>1?'ambiguous':'unavailable',instances:candidates};
 }
 function inspect(ast){
  const kind=String(value(ast?.[0])),field=name=>value(ast.find(x=>Array.isArray(x)&&value(x[0])===name)?.[1]);
  if(!Array.isArray(ast)||!known[kind])throw Error('Unsupported KiCad drawing root.');
  const generatorVersion=String(field('generator_version')??''),formatVersion=field('version')??null,major=/^(\d+)(?:\.|$)/.exec(generatorVersion),warnings=[];
  if(major&&Number(major[1])>10)warnings.push(`KiCad ${generatorVersion} is a forward-compatibility preview: only recognized saved constructs are rendered; new version features are not verified.`);
  for(const node of ast.filter(x=>Array.isArray(x)&&value(x[0])==='legacy_diagnostic'))warnings.push(String(value(node[1])));
  if(kind==='kicad_pcb'&&formatVersion!==null&&Number(formatVersion)<20200000)warnings.push('Restricted legacy PCB preview: saved modules, pads, tracks and supported graphics are rendered; unsupported constructs are disclosed.');
  const restrictedPreview=Boolean(field('legacy_source')||major&&Number(major[1])<8||kind==='kicad_pcb'&&formatVersion!==null&&Number(formatVersion)<20200000);
  if(restrictedPreview&&!field('legacy_source')&&!(kind==='kicad_pcb'&&Number(formatVersion)<20200000))warnings.push('Restricted KiCad 4–7 preview: only recognized saved constructs are rendered.');
  const unknown=[...new Set(ast.filter(Array.isArray).map(x=>String(value(x[0]))).filter(x=>!known[kind].has(x)))];
  if(unknown.length)warnings.push('Unrecognized saved drawing constructs omitted: '+unknown.slice(0,40).join(', ')+(unknown.length>40?' …':''));
  return {legacy:Boolean(field('legacy_source')||kind==='kicad_pcb'&&formatVersion!==null&&Number(formatVersion)<20200000),restrictedPreview,majorVersion:major?Number(major[1]):null,kind,generatorVersion:generatorVersion||null,formatVersion,forwardPreview:Boolean(major&&Number(major[1])>10),unknown,warnings};
 }
 const features=Object.freeze([
  {id:'drawing',label:'Saved schematic / PCB geometry',since:4,implemented:true},
  {id:'review',label:'Selection, properties, comments and comparison',since:4,implemented:true},
  {id:'hierarchy',label:'Sheet navigation and cross-sheet highlighting',since:4,implemented:true},
  {id:'copper',label:'Saved copper fills and zone outlines',since:4,implemented:true},
  {id:'models',label:'Repository-linked 3D models',since:4,implemented:true},
  {id:'embeddedAssets',label:'Embedded fonts and 3D assets',since:9,implemented:false},
  {id:'componentClasses',label:'Component-class rules',since:9,implemented:false},
  {id:'netclassRuleAreas',label:'Schematic net-class rule areas',since:9,implemented:false},
  {id:'schematicTables',label:'Native schematic tables (horizontal)',since:9,implemented:true,limitation:'Horizontal tables with saved cell geometry are rendered. Rotated tables are omitted with a drawing diagnostic; table-cell contextual variables are not implemented.'}
 ]);
 function capability(info,id){
  const feature=features.find(f=>f.id===id);
  if(!feature)return {available:false,reason:'This feature is not recognized by the viewer.',upgrade:false};
  const major=info?.majorVersion;
  if(Number.isInteger(major)&&major<feature.since)return {available:false,upgrade:true,reason:`${feature.label} requires KiCad ${feature.since} or later. This drawing identifies itself as KiCad ${info.generatorVersion||major}. Upgrade to the latest stable KiCad and save a separate project copy. `+(feature.implemented?'':'This viewer also needs support for this feature; upgrading the project alone will not enable it.')};
  if(!feature.implemented)return {available:false,upgrade:false,reason:`${feature.label} is not implemented in this viewer. Upgrading KiCad alone will not enable it.`};
  return {available:true,upgrade:false,reason:feature.limitation||'Available for recognized saved data; existing geometry and connectivity limits still apply.'};
 }
 function mountStatus(host,read){
  const doc=host.ownerDocument||root.document;
  const button=doc.createElement('button');button.type='button';button.className='compatibility-button';button.title='Saved-file compatibility and feature availability';host.append(button);
  const dialog=doc.createElement('dialog');dialog.className='compatibility-dialog';dialog.setAttribute('aria-label','Saved-file compatibility');doc.body.append(dialog);
  const make=(tag,text)=>{const node=doc.createElement(tag);node.textContent=text;return node;};
  function explain(feature){
   const result=capability(read(),feature.id);if(result.available)return true;
   dialog.replaceChildren(make('h2',feature.label),make('p',result.reason));
   if(result.upgrade){const link=make('a','Get the latest stable KiCad');link.href='https://www.kicad.org/download/';link.target='_blank';link.rel='noopener noreferrer';dialog.append(link);}
   const close=make('button','Close');close.type='button';close.onclick=()=>dialog.close();dialog.append(close);if(!dialog.open)dialog.showModal();return false;
  }
  function show(){
   const info=read();dialog.replaceChildren(make('h2','Saved-file compatibility'),make('p',info?.generatorVersion?`KiCad ${info.generatorVersion} · saved format ${info.formatVersion??'unknown'}`:'Generator version unknown; no major version inferred from the format date.'));
   if(info?.restrictedPreview)dialog.append(make('p','Restricted legacy preview. Missing libraries, unsupported saved graphics and connectivity limits are reported by the drawing; feature availability does not imply complete format coverage.'));
   for(const feature of features){const result=capability(info,feature.id),row=make('button',`${result.available?'Available':'Blocked'} · ${feature.label}${result.available?'':' · Why?'}`);row.type='button';row.className='compatibility-feature';row.setAttribute('data-blocked',String(!result.available));row.title=result.reason;row.onclick=()=>result.available?undefined:explain(feature);dialog.append(row);}
   if(info?.unknown?.length)dialog.append(make('p','Omitted saved constructs: '+info.unknown.join(', ')+'. These are renderer limitations; upgrading alone is not a remedy.'));
   const close=make('button','Close');close.type='button';close.onclick=()=>dialog.close();dialog.append(close);if(!dialog.open)dialog.showModal();
  }
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
  button.onclick=show;
  const refresh=()=>{const info=read();button.textContent=info?.restrictedPreview?'Legacy · Restricted':info?.majorVersion?`KiCad ${info.majorVersion} · Features`:'File features';if(dialog.open)dialog.close();};refresh();
  return {refresh,check(id){const feature=features.find(f=>f.id===id);return feature?explain(feature):false;},dispose(){dialog.remove();button.remove();}};
 }
 root.KiCadFileCompatibility={textResolver,textContext,textExpressions,textLinks,inspect,features,capability,mountStatus};if(typeof module==='object'&&module.exports)module.exports=root.KiCadFileCompatibility;
})(typeof globalThis==='object'?globalThis:this);

;
/* KiCad's default drawing sheet in world millimetres. Custom .kicad_wks is not interpreted. */
((root) => {
  "use strict";
  function build(page, path = "", options = {}) {
    const { width, height } = page || {};
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 20 || height <= 20) return [];
    const primitives = [], title = page.titleBlock || {};
    const emit = (p) => primitives.push({ color: "#a0a0a0", width: 0.1524, frame: true, path, ...p });
    const line = (x1, y1, x2, y2, kind = "title-block") => emit({ type: "line", points: [{x:x1,y:y1},{x:x2,y:y2}], kind });
    const rect = (x1, y1, x2, y2, kind) => emit({ type: "polygon", points: [{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}], kind });
    const text = (x, y, content, size = 1.5, extra = {}) => {
      if (content === undefined || content === null || content === "") return;
      emit({ type: "text", x, y, text: String(content), size, fontWidth: size, fontHeight: size,
        angle: 0, align: "left", baseline: "middle", kind: "title-block", ...extra });
    };
    // Source: KiCad 10 template/pagelayout_default.kicad_wks, independently checked
    // with kicad-cli sch export svg. Coordinates in that file are relative to the
    // 10 mm margins; default title-block coordinates count from the lower right.
    rect(0, 0, width, height, "page");
    rect(10, 10, width - 10, height - 10, "page-frame");
    rect(12, 12, width - 12, height - 12, "page-frame");
    for (let x = 60; x < width - 10; x += 50) {
      line(x, 10, x, 12, "page-zone"); line(x, height - 12, x, height - 10, "page-zone");
    }
    for (let x = 35, i = 1; x < width - 10; x += 50, i++) {
      text(x, 11, i, 1.3, {kind:"page-zone"});
      text(x, height - 11, i, 1.3, {kind:"page-zone"});
    }
    for (let y = 60; y < height - 10; y += 50) {
      line(10, y, 12, y, "page-zone"); line(width - 12, y, width - 10, y, "page-zone");
    }
    for (let y = 35, i = 0; y < height - 10; y += 50, i++) {
      // KiCad's repetition increments the character, including beyond Z.
      text(11, y, String.fromCharCode(65 + i), 1.3, {kind:"page-zone",align:"center"});
      text(width - 11, y, String.fromCharCode(65 + i), 1.3, {kind:"page-zone",align:"center"});
    }
    const right = width - 10, bottom = height - 10, left = right - 110;
    rect(left, bottom - 34, right - 2, bottom - 2, "title-block");
    for (const offset of [5.5, 8.5, 12.5, 18.5]) line(left, bottom - offset, right - 2, bottom - offset);
    line(right - 90, bottom - 8.5, right - 90, bottom - 5.5);
    line(right - 26, bottom - 8.5, right - 26, bottom - 2);
    text(right - 87, bottom - 6.9, `Date: ${title.date || ""}`);
    text(right - 109, bottom - 4.1, options.kicadVersion ? `KiCad E.D.A. ${options.kicadVersion}` : "KiCad E.D.A.");
    text(right - 24, bottom - 6.9, `Rev: ${title.rev || ""}`, 1.5, {bold:true});
    text(right - 109, bottom - 6.9, `Size: ${page.format || "User"}`);
    text(right - 24, bottom - 4.1, `Id: ${options.sheetNumber || 1}/${options.sheetCount || 1}`);
    text(right - 109, bottom - 10.7, `Title: ${title.title || ""}`, 2, {bold:true,italic:true});
    text(right - 109, bottom - 14.3, `File: ${String(path).split(/[\\/]/).pop() || ""}`);
    text(right - 109, bottom - 17, `Sheet: ${options.sheetName || "/"}`);
    text(right - 109, bottom - 20, title.company, 1.5, {bold:true});
    for (let i = 0; i < 4; i++) text(right - 109, bottom - 23 - i * 3, title.comments?.[i]);
    return primitives;
  }
  root.KiCadWorksheet = { build };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadWorksheet;
})(typeof globalThis === "object" ? globalThis : this);

;
/* Browser-native KiCad schematic primitives. No editor or third-party renderer. */
((root) => {
  "use strict";
  const Compatibility=root.KiCadFileCompatibility||(typeof module==="object"&&module.exports?require("./file-compatibility.js"):null);
  const COLOR = { page: "#a0a0a0", symbol: "#840000", pin: "#840000",
    wire: "#008400", bus: "#000080", label: "#008400", text: "#0000c2" };
  const PAPERS = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297],
    A4: [297, 210], A5: [210, 148], USLetter: [279.4, 215.9], USLegal: [355.6, 215.9],
    USLedger: [431.8, 279.4] };
  const Worksheet = root.KiCadWorksheet || (typeof module === "object" && module.exports ? require("./worksheet.js") : null);
  // ASCII advance units measured independently from KiCad 10 native SVG text.
  // The stroke font uses a 21-unit em; non-ASCII falls back to a full em.
  const TEXT_ADVANCES = [16,10,16,21,20,24,26,10,14,14,16,26,10,26,10,22,20,20,20,20,20,20,20,20,20,20,10,10,26,26,26,18,27,18,21,21,21,19,18,21,22,10,16,21,17,24,22,22,21,22,21,20,16,22,18,24,20,18,20,14,14,14,12,16,8,19,19,18,19,18,12,19,19,10,10,17,11,28,19,19,19,19,13,17,12,19,16,22,17,16,17,14,20,14,15];
  function overbarText(string) {
    const bars = [];
    let text = "", last = 0;
    for (const match of String(string).matchAll(/~\{([^{}]*)\}/g)) {
      text += String(string).slice(last, match.index);
      const start = text.length;
      text += match[1];
      bars.push({ start, end: text.length });
      last = match.index + match[0].length;
    }
    text += String(string).slice(last);
    return { text, bars };
  }
  function textWidth(string, width) {
    return Array.from(overbarText(string).text).reduce((total, c) => total + (TEXT_ADVANCES[c.charCodeAt(0) - 32] ?? 21) * width / 21, 0) + width * 0.16;
  }
  const MAX_PRIMITIVES = root.KiCadDesignDiff?.MAX_RENDER_PRIMITIVES || (typeof require==='function'?require('./design-diff.js').MAX_RENDER_PRIMITIVES:1500000);
  const value = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const typeOf = (form) => Array.isArray(form) ? String(value(form[0])) : "";
  const forms = (node, type) => Array.isArray(node) ? node.filter((item) => Array.isArray(item) && typeOf(item) === type) : [];
  const form = (node, type) => forms(node, type)[0];
  const scalar = (node, type) => value(form(node, type)?.[1]);
  const finite = (number) => typeof number === "number" && Number.isFinite(number);
  const point = (node, type) => {
    const item = form(node, type);
    const x = value(item?.[1]), y = value(item?.[2]);
    return finite(x) && finite(y) ? { x, y } : null;
  };
  const ownId = (node) => scalar(node, "uuid") ?? scalar(node, "tstamp") ?? null;
  const round = (number) => Math.round(number * 1e6) / 1e6;
  function hasFlag(node, name) {
    return Array.isArray(node) && node.some((item) => {
      if (Array.isArray(item) && typeOf(item) === name) {
        const state = value(item[1]);
        return state === undefined || state === true || state === "yes" || state === "true" || state === 1;
      }
      return !Array.isArray(item) && !(item && typeof item === "object") && item === name;
    });
  }
  function transform(origin = { x: 0, y: 0 }, angle = 0, mirror = "", library = false) {
    const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
    return (position) => {
      const x = position.x, y = library ? -position.y : position.y;
      // KiCad mirrors the rotated symbol in sheet axes, not in library axes.
      let rotatedX = x * c + y * s, rotatedY = -x * s + y * c;
      if (mirror === "x") rotatedY = -rotatedY;
      if (mirror === "y") rotatedX = -rotatedX;
      return { x: round(origin.x + rotatedX), y: round(origin.y + rotatedY) };
    };
  }
  function isHidden(node) {
    const effects = typeOf(node) === "effects" ? node : form(node, "effects");
    return hasFlag(node, "hide") || hasFlag(effects, "hide") || hasFlag(form(effects, "font"), "hide");
  }
  function fontSize(node, fallback = 1.27) {
    const effects = typeOf(node) === "effects" ? node : form(node, "effects");
    const font = form(effects, "font"), size = form(font, "size");
    const x = value(size?.[1]), y = value(size?.[2]);
    return finite(x) && finite(y) && x > 0 && y > 0 ? round(y) : fallback;
  }
  function fontStyle(node) {
    const effects = form(node, "effects"), font = form(effects, "font");
    const size = form(font, "size");
    const fontWidth = value(size?.[1]), fontHeight = value(size?.[2]);
    const justify = form(effects, "justify")?.slice(1).map(value) || [];
    return { bold: hasFlag(font, "bold"), italic: hasFlag(font, "italic"),
      ...(typeof scalar(effects,"href")==="string"?{href:scalar(effects,"href")}:{}),
      ...(finite(fontWidth) && fontWidth > 0 ? { fontWidth } : {}),
      ...(finite(fontHeight) && fontHeight > 0 ? { fontHeight } : {}),
      ...(savedColor(font)&&savedColor(font)!=="rgba(0,0,0,0)"?{sourceColor:savedColor(font),color:savedColor(font)}:{}),
      ...(scalar(font, "face") ? { fontFace: scalar(font, "face") } : {}),
      ...(scalar(font, "thickness") ? { textThickness: scalar(font, "thickness") } : {}),
      lineSpacing: 1.5,
      align: justify.includes("left") ? "left" : justify.includes("right") ? "right" : "center",
      baseline: justify.includes("top") ? "top" : justify.includes("bottom") ? "bottom" : "middle" };
  }
  function lineWidth(node, fallback = 0.15) {
    const stroke = form(node, "stroke");
    const width = scalar(stroke, "width") ?? scalar(node, "width");
    return finite(width) && width > 0 ? width : fallback;
  }
  function savedColor(node) {
    const rgba=form(node,"color")?.slice(1).map(value);
    if(!rgba||rgba.length!==4||rgba.some(n=>!finite(n))||rgba.slice(0,3).some(n=>n<0||n>255))return undefined;
    const [r,g,b,a]=rgba;return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,a))})`;
  }
  function graphicStyle(node) {
    const stroke=form(node,"stroke"),sourceColor=savedColor(stroke),fill=form(node,"fill"),fillColor=savedColor(fill),lineStyle=scalar(stroke,"type");
    return {...(sourceColor&&sourceColor!=="rgba(0,0,0,0)"?{sourceColor,color:sourceColor}:{}),...(fillColor?{fillColor}:{}),...(["dash","dot","dash_dot","dash_dot_dot"].includes(lineStyle)?{lineStyle}:{})};
  }
  function fillType(node) {
    const type = scalar(form(node, "fill"), "type");
    return ["outline", "background", "color", "hatch", "reverse_hatch", "cross_hatch"].includes(type) ? type : undefined;
  }
  function pathPoints(node) {
    const pts = form(node, "pts");
    return forms(pts, "xy").map((xy) => point([xy], "xy")).filter(Boolean);
  }
  const MAX_IMAGE_BYTES=4*1024*1024,MAX_IMAGE_PIXELS=16000000,MAX_TOTAL_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_PIXELS=16000000;
  const PNG_CRC=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function embeddedImage(node,version){
    const parts=form(node,"data")?.slice(1).map(value);let length=0;
    if(!parts?.length)throw Error("No inline bitmap data was saved in the schematic.");
    if(parts.some(part=>typeof part!=="string"||(length+=part.length)>Math.ceil(MAX_IMAGE_BYTES/3)*4))throw Error("Embedded bitmap exceeds its 4 MiB limit or has invalid base64 data.");
    const encoded=parts.join("");if(encoded.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error("Embedded image is not base64 bitmap data.");
    const binary=atob(encoded);if(binary.length>MAX_IMAGE_BYTES||btoa(binary)!==encoded)throw Error("Embedded bitmap data is oversized or not canonical base64.");
    const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0)),view=new DataView(bytes.buffer);
    if(binary.startsWith("BM"))return embeddedBMP(view,encoded,version);
    if(bytes.length<45||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))throw Error("Embedded image is not a PNG or BMP.");
    const read=at=>view.getUint32(at),chunkType=at=>String.fromCharCode(...bytes.subarray(at,at+4));
    const kept=[binary.slice(0,8)];let width=0,height=0,physicalX=null,ended=false,hasData=false,chunks=0;
    for(let at=8;at<bytes.length;){
      if(++chunks>4096||at+12>bytes.length)throw Error("Embedded PNG chunk structure is invalid.");
      const size=read(at),type=chunkType(at+4),end=at+12+size;if(end>bytes.length||!/^[A-Za-z]{4}$/.test(type))throw Error("Embedded PNG chunk is truncated or invalid.");
      let crc=0xffffffff;for(let i=at+4;i<end-4;i++)crc=PNG_CRC[(crc^bytes[i])&255]^(crc>>>8);if(((crc^0xffffffff)>>>0)!==read(end-4))throw Error("Embedded PNG checksum is invalid.");
      if(type==="IHDR"){
        if(at!==8||size!==13)throw Error("Embedded PNG has an invalid header.");width=read(at+8);height=read(at+12);
        const depth=bytes[at+16],color=bytes[at+17],depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if(!width||!height||width*height>MAX_IMAGE_PIXELS||!depths[color]?.includes(depth)||bytes[at+18]!==0||bytes[at+19]!==0||bytes[at+20]>1)throw Error("Embedded PNG exceeds 16 megapixels or uses an invalid header.");
      }else if(at===8)throw Error("Embedded PNG header is missing.");
      else if(type==="pHYs"){
        if(size!==9||physicalX!==null)throw Error("Embedded PNG physical resolution is invalid.");if(bytes[at+16]===1)physicalX=read(at+8);else if(bytes[at+16]!==0)throw Error("Embedded PNG resolution unit is invalid.");
      }else if(type==="IDAT")hasData=true;
      else if(type==="IEND"){if(size||!hasData)throw Error("Embedded PNG end marker is invalid.");ended=true;}
      else if(["acTL","fcTL","fdAT"].includes(type))throw Error("Animated PNGs are not supported in the bounded preview.");
      else if(type[0]===type[0].toUpperCase()&&type!=="PLTE")throw Error("Embedded PNG has an unsupported critical chunk.");
      // Older native saves may contain extra bytes after IEND. Forward only
      // validated PNG chunks and omit metadata requiring extra decompression.
      if(!["iCCP","zTXt","iTXt"].includes(type))kept.push(binary.slice(at,end));
      if(ended)break;
      at=end;
    }
    if(!ended)throw Error("Embedded PNG end marker is missing.");
    return {dataUrl:"data:image/png;base64,"+btoa(kept.join("")),pixelWidth:width,pixelHeight:height,ppi:imageResolution(physicalX,version),bytes:bytes.length};
  }
  function imageResolution(physicalX,version){
    // KiCad parseImage preserves three saved-scale eras. PNG pHYs is pixels/m;
    // pre-20260623 wxWidgets resolution conversion truncated pixels/cm first.
    let ppi=300;if(physicalX!==null&&physicalX/100>1){const corrected=Math.round(physicalX*.0254),legacy=Math.floor(physicalX/100)>1?Math.round(Math.floor(physicalX/100)*2.54):corrected;ppi=version<=20230121?300:version<20260623?legacy:corrected;}
    if(!Number.isFinite(ppi)||ppi<1||ppi>1000000)throw Error("Embedded PNG resolution exceeds the preview limit.");
    return ppi;
  }
  function embeddedBMP(view,encoded,version){
    const bytes=view.byteLength;
    if(bytes<54||view.getUint32(2,true)!==bytes||view.getUint32(14,true)!==40)throw Error("Embedded BMP has an unsupported or invalid header.");
    const offset=view.getUint32(10,true),width=view.getInt32(18,true),height=Math.abs(view.getInt32(22,true)),depth=view.getUint16(28,true);
    if(width<1||height<1||width*height>MAX_IMAGE_PIXELS||view.getUint16(26,true)!==1||![24,32].includes(depth)||view.getUint32(30,true)!==0)
      throw Error("Embedded BMP must use uncompressed 24-bit or 32-bit pixels within the 16 megapixel limit.");
    const pixelBytes=Math.ceil(width*depth/32)*4*height;
    if(offset<54||offset+pixelBytes!==bytes)throw Error("Embedded BMP pixel data is truncated or invalid.");
    return {dataUrl:"data:image/bmp;base64,"+encoded,pixelWidth:width,pixelHeight:height,ppi:imageResolution(view.getInt32(38,true),version),bytes};
  }
  function pageSettings(ast, warn=()=>{}) {
    const paper = form(ast, "paper"), name = value(paper?.[1]) || "A4";
    let size = PAPERS[name];
    if (name === "User") {
      const w = value(paper?.[2]), h = value(paper?.[3]);
      if (finite(w) && finite(h) && w > 20 && h > 20 && w < 2000 && h < 2000) size = [w, h];
    }
    if (!size) { warn(`Unsupported paper size ${name}; showing A4 bounds.`); size = PAPERS.A4; }
    let [width, height] = size;
    if (paper?.some((item) => value(item) === "portrait") && width > height) [width, height] = [height, width];
    const title = form(ast, "title_block");
    return { width, height, format: name, titleBlock: {
      title: scalar(title, "title") || "", date: scalar(title, "date") || "",
      rev: scalar(title, "rev") || "", company: scalar(title, "company") || "",
      comments: Array.from({ length: 9 }, (_, i) => value(forms(title, "comment").find(c => value(c[1]) === i + 1)?.[2]) || "")
    } };
  }
  function build(rootAST, path = "", sheetOptions = {}) {
    if (!Array.isArray(rootAST) || typeOf(rootAST) !== "kicad_sch") {
      throw new Error("Schematic renderer requires a parsed kicad_sch root.");
    }
    const primitives = [], warnings = [], seenWarnings = new Set();let imageBytes=0,imagePixels=0,imageCount=0;
    const compatibility=Compatibility?.inspect(rootAST);
    warnings.push(...(compatibility?.warnings||[]));
    const warn = (message) => { if (!seenWarnings.has(message)) { seenWarnings.add(message); warnings.push(message); } };
    function emit(primitive) {
      if (primitives.length >= MAX_PRIMITIVES) throw new Error("Schematic has too many drawing primitives.");
      primitives.push({ ...primitive, path });
    }
    const variableText=Compatibility?.textResolver(rootAST,{...sheetOptions,path},warn), variableFields=new Map();
    for(const node of [...forms(rootAST,"symbol"),...forms(rootAST,"sheet")])if(ownId(node))variableFields.set(ownId(node),variableText?.fields(node));
    const resolveText=(string,owner={})=>variableText?.resolve(string,variableFields.get(owner.ownerUuid||owner.uuid)||{})??String(string??"");
    const textLinks=(string,owner={})=>Compatibility?.textLinks?.(resolveText(string,owner),owner.href===undefined?undefined:resolveText(owner.href,owner))||[];
    const page = pageSettings(rootAST, warn);
    function line(a, b, color, width, owner = {}) {
      if (a && b) emit({ type: "line", points: [a, b], color, width, ...owner });
    }
    function text(position, string, size, angle, color, owner = {}) {
      if (position && string !== undefined && string !== null && String(string)) {
        const parsed = overbarText(resolveText(string,owner)),links=textLinks(string,owner);
        emit({ type: "text", x: position.x, y: position.y, text: parsed.text,
          ...((parsed.bars.length||String(string)!==parsed.text) ? { rawText: String(string) } : {}),
          size, angle: finite(angle) ? angle : 0, color, ...owner,...(links.length?{links}:{}) });
        if (parsed.bars.length) {
          const width = owner.fontWidth || size, height = owner.fontHeight || size;
          const lines = parsed.text.split("\n"), radians = (angle || 0) * Math.PI / 180;
          const map = (x, y) => ({ x: round(position.x + x * Math.cos(radians) - y * Math.sin(radians)),
            y: round(position.y + x * Math.sin(radians) + y * Math.cos(radians)) });
          let offset = 0;
          for (let i = 0; i < lines.length; i++) {
            const content = lines[i], totalWidth = textWidth(content, width);
            const origin = owner.align === "left" ? 0 : owner.align === "right" ? -totalWidth : -totalWidth / 2;
            const y = (i - (lines.length - 1) / 2) * height * (owner.lineSpacing || 1.5)
              + (owner.baseline === "top" ? height / 2 : owner.baseline === "bottom" ? -height / 2 : 0) - height * 1.0181;
            for (const bar of parsed.bars) {
              const start = Math.max(bar.start - offset, 0), end = Math.min(bar.end - offset, content.length);
              if (end <= start) continue;
              // Native stroke-font overbars inset the start by .18 em and end
              // by .02 em. Prefix/suffix advances exclude the pen-width term.
              const x1 = origin + textWidth(content.slice(0, start), width) + width * 0.02;
              const x2 = origin + textWidth(content.slice(0, end), width) - width * 0.18;
              line(map(x1,y), map(x2,y), color, owner.textThickness || 0.1524, { ...owner, kind: "text-overbar",...(["label","global_label","hierarchical_label","sheet-pin"].includes(owner.kind)?{electricalKind:owner.kind}:{}) });
            }
            offset += content.length + 1;
          }
        }
      }
    }
    function rect(a, b, color, width, owner = {}, fill) {
      if (!a || !b) return;
      emit({ type: "polygon", points: [a, { x: b.x, y: a.y }, b,
        { x: a.x, y: b.y }], color, width, ...(fill ? { fill } : {}), ...owner });
    }
    if (Worksheet) {
      for (const primitive of Worksheet.build(page, path, sheetOptions)) emit(primitive);
    } else warn("Default worksheet module is unavailable.");
    warn("Custom .kicad_wks layouts are not rendered; the KiCad default drawing sheet is shown.");
    if (page.titleBlock.comments.slice(4).some(Boolean)) warn("The KiCad default drawing sheet displays only comments 1–4.");
    function drawGraphic(node, map, owner, color = COLOR.symbol) {
      const kind = typeOf(node), width = lineWidth(node, 0.15), fill = fillType(node);owner={...owner,...graphicStyle(node)};
      if (kind === "polyline" || kind === "wire" || kind === "bus") {
        const points = pathPoints(node).map(map);
        if (points.length > 1) emit({ type: "polyline", points, color, width, ...(fill ? { fill } : {}), ...owner });
        else warn(`${kind} without two points was skipped.`);
      } else if (kind === "bezier") {
        const points = pathPoints(node);
        if (points.length !== 4) { warn("Bezier without four valid control points was skipped."); return; }
        emit({ type: "bezier", points: points.map(map), color, width, ...(fill ? { fill } : {}), ...owner });
      } else if (kind === "rectangle") {
        const a = point(node, "start"), b = point(node, "end");
        if (!a || !b) { warn("Rectangle without start/end was skipped."); return; }
        const points = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map(map);
        emit({ type: "polygon", points, color, width, ...(fill ? { fill } : {}), ...owner });
      } else if (kind === "circle") {
        const center = point(node, "center"), radius = scalar(node, "radius");
        if (!center || !finite(radius) || radius <= 0) { warn("Circle without center/radius was skipped."); return; }
        const transformed = map(center);
        emit({ type: "circle", x: transformed.x, y: transformed.y, r: radius,
          color, width, ...(fill ? { fill } : {}), ...owner });
      } else if (kind === "arc") {
        const start = point(node, "start"), mid = point(node, "mid"), end = point(node, "end");
        if (!start || !mid || !end) { warn("Legacy or incomplete arc without start/mid/end was skipped."); return; }
        emit({ type: "arc", start: map(start), mid: map(mid), end: map(end), color, width, ...(fill ? { fill } : {}), ...owner });
      } else if (kind === "text_box" || kind === "table_cell") {
        if (isHidden(node)) return;
        const at = point(node, "at") || point(node, "start"), size = point(node, "size"), savedEnd = point(node, "end");
        const end = savedEnd || (at && size ? { x: at.x + size.x, y: at.y + size.y } : null);
        if (!at || !end || at.x === end.x || at.y === end.y) { warn("Text box without valid position/size was skipped."); return; }
        const textOwner={...owner};for(const key of ["color","sourceColor","lineStyle","fillColor"])delete textOwner[key];
        const left=Math.min(at.x,end.x),right=Math.max(at.x,end.x),top=Math.min(at.y,end.y),bottom=Math.max(at.y,end.y),sizeMM=fontSize(node),style=fontStyle(node),strokeWidth=scalar(form(node,"stroke"),"width"),border=!(finite(strokeWidth)&&strokeWidth<0);
        emit({type:"polygon",points:[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}].map(map),color,width,stroke:border,...(fill?{fill}:{}),...owner,...(style.href!==undefined?{links:textLinks(value(node[1]),{...owner,href:style.href})}:{})});
        const marginForm=form(node,"margins"),fallbackMargin=sizeMM*.75+(border?width/2:0),margins=marginForm?.slice(1).map(value);
        if(margins&& (margins.length!==4||margins.some(n=>!finite(n)||n<0))){warn("Text box with invalid saved margins has no rendered text.");return;}
        const [ml,mt,mr,mb]=margins||[fallbackMargin,fallbackMargin,fallbackMargin,fallbackMargin],inner={left:left+ml,top:top+mt,right:right-mr,bottom:bottom-mb};
        if(inner.right<=inner.left||inner.bottom<=inner.top){warn("Text box margins leave no text area.");return;}
        const angle=((value(form(node,"at")?.[3])||0)%360+360)%360;
        if(angle!==0&&angle!==90){warn("Text box with unsupported non-horizontal/non-vertical text angle has no rendered text.");return;}
        const vertical=angle===90,available=vertical?inner.bottom-inner.top:inner.right-inner.left,span=vertical?inner.right-inner.left:inner.bottom-inner.top,raw=resolveText(value(node[1]),owner),rows=[];
        if(raw.length>65536){warn("Text box exceeds its 65536-character preview limit; text was skipped.");return;}
        // Saved margins and orientation follow SCH_TEXTBOX. Wrapping uses the
        // same bounded stroke-font advance estimate as other preview labels.
        for(const paragraph of raw.split(/\r\n|\r|\n/)){
          let row="",advance=0;
          for(const word of paragraph.match(/\S+\s*|\s+/g)||[]){
            const wordWidth=textWidth(word,style.fontWidth||sizeMM);
            if(row&&advance+wordWidth>available){rows.push(row.trimEnd());row="";advance=0;}
            for(const char of word){const charWidth=textWidth(char,style.fontWidth||sizeMM)-(style.fontWidth||sizeMM)*.16;if(row&&advance+charWidth>available){rows.push(row.trimEnd());row="";advance=0;}row+=char;advance+=charWidth;}
          }
          rows.push(row.trimEnd());
        }
        const step=sizeMM*style.lineSpacing,height=sizeMM+Math.max(0,rows.length-1)*step,offset=style.baseline==='top'?0:style.baseline==='bottom'?span-height:(span-height)/2;
        const inline=style.align==='left'?0:style.align==='right'?available:available/2;
        const local=(x,y)=>vertical?{x:inner.left+y,y:inner.bottom-x}:{x:inner.left+x,y:inner.top+y};
        for(let i=0;i<rows.length;i++){const p=local(inline,offset+sizeMM/2+i*step),origin=map(p),axis=map(local(inline+1,offset+sizeMM/2+i*step));text(origin,rows[i],sizeMM,Math.atan2(axis.y-origin.y,axis.x-origin.x)*180/Math.PI,color,{...textOwner,...style,baseline:"middle"});}
        warn("Text-box wrapping uses preview font metrics; exact KiCad font layout may differ.");
      } else if (kind === "text") {
        if (isHidden(node)) return;
        const at = point(node, "at");
        if (!at) { warn("Text without position was skipped."); return; }
        // Library graphic text stores its vertical orientation as 900 (tenths
        // of a degree). KiCad plots both writing directions upright.
        const localVertical = !!value(form(node, "at")?.[3]);
        const origin = map(at), right = map({ x: at.x + 1, y: at.y });
        const up = map({ x: at.x, y: at.y + 1 }), axis = localVertical ? up : right;
        const dx = axis.x - origin.x, dy = axis.y - origin.y;
        const vertical = Math.abs(dy) > Math.abs(dx), style = fontStyle(node);
        if ((vertical ? dy > 0 : dx < 0) && style.align !== "center")
          style.align = style.align === "left" ? "right" : "left";
        const rx = right.x - origin.x, ry = right.y - origin.y;
        const ux = up.x - origin.x, uy = up.y - origin.y;
        // Native mirrored text flips vertical justification in the local
        // horizontal orientation for the identity matrix and vertical otherwise.
        const mirrored = rx * uy - ry * ux > 0;
        const identityAxes = rx > 0.5 && uy > 0.5;
        if (mirrored && localVertical !== identityAxes && style.baseline !== "middle")
          style.baseline = style.baseline === "top" ? "bottom" : "top";
        text(origin, value(node[1]), fontSize(node), vertical ? -90 : 0, color, { ...owner, ...style });
      } else warn(`Unsupported graphic ${kind} was skipped.`);
    }
    function renderTable(node,owner) {
      // Saved format: KiCad SCH_WRITER_V10::saveTable/saveTextBox. Borders
      // follow SCH_TABLE::DrawBorders, using saved cell geometry and spans.
      const columns=scalar(node,"column_count"),widths=form(node,"column_widths")?.slice(1).map(value),heights=form(node,"row_heights")?.slice(1).map(value),cells=forms(form(node,"cells"),"table_cell");
      if(!Number.isInteger(columns)||columns<1||columns>100||!widths||widths.length!==columns||!heights?.length||heights.length>100||columns*heights.length>1000||cells.length!==columns*heights.length||[...widths,...heights].some(n=>!finite(n)||n<=0)) {warn("Schematic table has invalid dimensions or exceeds the 1000-cell preview limit; it was skipped.");return;}
      const boxes=[],covered=new Set();let characters=0;
      for(let i=0;i<cells.length;i++){
        const cell=cells[i],at=point(cell,"at"),size=point(cell,"size"),span=form(cell,"span")?.slice(1).map(value)||[1,1],angle=value(form(cell,"at")?.[3])||0,row=Math.floor(i/columns),col=i%columns;
        if(angle!==0){warn("Rotated schematic tables are not rendered; open KiCad for their native layout.");return;}
        if(span.length!==2||span.some(n=>!Number.isInteger(n)||n<0)||row+span[1]>heights.length||col+span[0]>columns||!at||!size||!finite(at.x+size.x)||!finite(at.y+size.y)||(characters+=String(value(cell[1])??'').length)>262144){warn("Schematic table has invalid cell geometry/spans or exceeds its text budget; it was skipped.");return;}
        if(span[0]===0||span[1]===0){if(!covered.has(i)){warn("Schematic table contains an unbound merged cell; it was skipped.");return;}boxes.push(null);continue;}
        if(size.x<=0||size.y<=0){warn("Schematic table has invalid cell bounds; it was skipped.");return;}
        for(let r=row;r<row+span[1];r++)for(let c=col;c<col+span[0];c++){const index=r*columns+c;if(covered.has(index)){warn("Schematic table has overlapping spans; it was skipped.");return;}covered.add(index);}
        boxes.push({at,end:{x:at.x+size.x,y:at.y+size.y},span,row,col,cell});
      }
      const active=boxes.filter(Boolean),border=form(node,"border"),separators=form(node,"separators"),identity=p=>p;
      for(const box of active)drawGraphic([...box.cell.filter(item=>typeOf(item)!=='stroke'),["stroke",["width",-1]]],identity,{...owner,uuid:ownId(box.cell)||owner.uuid,ownerUuid:owner.uuid,kind:"table-cell"},COLOR.text);
      const edge=(a,b,style)=>{if((scalar(form(style,"stroke"),"width")??0)<0)return;line(a,b,COLOR.text,lineWidth(style),{...owner,kind:"table-border",...graphicStyle(style)});};
      for(const {at,end,span,row,col} of active){
        const columnStyle=row===0&&hasFlag(border,"header")?border:hasFlag(separators,"cols")?separators:null;
        const rowStyle=row===0&&hasFlag(border,"header")?border:hasFlag(separators,"rows")?separators:null;
        if(columnStyle&&col+span[0]<columns)edge({x:end.x,y:at.y},end,columnStyle);
        if(rowStyle&&row+span[1]<heights.length)edge(end,{x:at.x,y:end.y},rowStyle);
      }
      if(hasFlag(border,"external")){
        const left=Math.min(...active.map(b=>b.at.x)),top=Math.min(...active.map(b=>b.at.y)),right=Math.max(...active.map(b=>b.end.x)),bottom=Math.max(...active.map(b=>b.end.y));
        const corners=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];for(let i=0;i<4;i++)edge(corners[i],corners[(i+1)%4],border);
      }
    }
    const library = form(rootAST, "lib_symbols"), definitions = new Map();
    const pinFunctions=Object.create(null),libraryPinFunctions=new WeakMap();
    function pinFunctionDefinition(pin){
      if(libraryPinFunctions.has(pin))return libraryPinFunctions.get(pin);
      const number=String(scalar(pin,'number')??''),defaultName=String(scalar(pin,'name')??'');
      const alternates=new Map();
      for(const alternate of forms(pin,'alternate')){
        const name=value(alternate[1]),electricalType=value(alternate[2]);
        if(typeof name==='string'&&name&&name!==defaultName)alternates.set(name,{name,electricalType});
      }
      const result={number,defaultName,defaultType:value(pin[1]),alternates:[...alternates.values()]};
      libraryPinFunctions.set(pin,result);
      return result;
    }
    for (const definition of forms(library, "symbol")) {
      const name = value(definition[1]);
      if (typeof name === "string") definitions.set(name, definition);
    }
    function libraryUnits(name, unit, style, visited = new Set()) {
      if (visited.has(name) || visited.size > 8) { warn(`Symbol inheritance cycle at ${name}.`); return []; }
      const definition = definitions.get(name);
      if (!definition) { warn(`Embedded library symbol ${name} is unavailable.`); return []; }
      visited.add(name);
      const selected = [];
      const base = scalar(definition, "extends");
      if (base) {
        const prefix = name.includes(":") ? name.slice(0, name.indexOf(":") + 1) : "";
        const baseName = definitions.has(base) ? base : `${prefix}${base}`;
        selected.push(...libraryUnits(baseName, unit, style, visited));
      }
      for (const nested of forms(definition, "symbol")) {
        const unitName = value(nested[1]), match = typeof unitName === "string" && /_(\d+)_(\d+)$/.exec(unitName);
        if (!match) { warn(`Unrecognized library unit ${unitName} in ${name} was skipped.`); continue; }
        const unitNumber = Number(match[1]), bodyStyle = Number(match[2]);
        if ((unitNumber === 0 || unitNumber === unit) && (bodyStyle === 0 || bodyStyle === style)) selected.push(nested);
      }
      if (definition.some((item) => Array.isArray(item) && ["pin", "polyline", "rectangle", "circle", "arc", "bezier", "text", "text_box"].includes(typeOf(item)))) {
        selected.push(definition);
      }
      return selected;
    }
    function renderPin(pin, map, owner, symbolDef) {
      const at = point(pin, "at"), length = scalar(pin, "length") ?? 0;
      if (!at || !finite(length) || length < 0) { warn("Pin without valid position/length was skipped."); return; }
      const angle = value(form(pin, "at")?.[3]) ?? 0;
      if (!finite(angle)) { warn("Pin with invalid angle was skipped."); return; }
      const radians = angle * Math.PI / 180, dx = Math.cos(radians), dy = Math.sin(radians);
      const inner = { x: at.x + length * dx, y: at.y + length * dy };
      const name = form(pin, "name"), number = form(pin, "number"), style = value(pin[2]);
      const pinOwner = { ...owner, ownerUuid: owner.uuid, kind: "pin", pinNumber: String(value(number?.[1]) ?? ""),
        pinName:String(value(name?.[1]) ?? ""), pinType: value(pin[1]), pinStyle: style, connectPoint: map(at) };
      const hidden = hasFlag(pin, "hide") || isHidden(pin);
      if (hidden) {
        line(map(at), map(at), COLOR.pin, 0, { ...pinOwner, hidden: true, stroke: false, pick: false });
        return;
      }
      // Native KiCad uses 25 mil bubbles and 50 mil clock/low markers.
      const r = 0.635, h = 1.27;
      const local = (along, across) => ({ x: inner.x + along * dx - across * dy,
        y: inner.y + along * dy + across * dx });
      const marker = { ...pinOwner, kind: "pin-marker" };
      const poly = (positions) => emit({ type: "polyline", points: positions.map(map), color: COLOR.pin, width: 0.1524, ...marker });
      let lineEnd = inner;
      if (["inverted", "inverted_clock"].includes(style)) {
        const c = map(local(-r, 0));
        emit({ type: "circle", x: c.x, y: c.y, r, color: COLOR.pin, width: 0.1524, ...marker });
        lineEnd = local(-h, 0);
      }
      if (["clock", "inverted_clock", "clock_low"].includes(style)) poly([local(0,-r),local(h,0),local(0,r)]);
      if (["input_low", "clock_low"].includes(style)) poly([local(-h,0),local(-h,h),local(0,0)]);
      if (style === "output_low") poly([local(0,h),local(-h,0)]);
      if (style === "edge_clock_high") { poly([local(0,-r),local(-h,0),local(0,r)]); lineEnd = local(-h,0); }
      if (style === "non_logic") {
        poly([local(r,r),local(-r,-r)]); poly([local(r,-r),local(-r,r)]);
      }
      line(map(at), map(lineEnd), COLOR.pin, 0.1524, pinOwner);
      if (!["line", "inverted", "clock", "inverted_clock", "input_low", "clock_low", "output_low", "edge_clock_high", "non_logic"].includes(style)) warn(
        "Pin graphic style " + style + " is simplified to a line.");
      const start = map(at), end = map(inner), horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
      const textAngle = horizontal ? 0 : -90;
      const insideAlign = horizontal ? (end.x >= start.x ? "left" : "right") : (end.y <= start.y ? "left" : "right");
      const hideNames = hasFlag(form(symbolDef, "pin_names"), "hide");
      const hideNumbers = hasFlag(form(symbolDef, "pin_numbers"), "hide");
      if (!hideNames && name && !isHidden(name) && value(name[1]) && value(name[1]) !== "~") {
        const offset = scalar(form(symbolDef, "pin_names"), "offset") ?? 0.508;
        const size = fontSize(name);
        let place, align;
        if (finite(offset) && offset > 0) { place = map(local(offset,0)); align = insideAlign; }
        else { place = { x: (start.x + end.x)/2 - (horizontal ? 0 : size/2 + 0.3556),
          y: (start.y + end.y)/2 - (horizontal ? size/2 + 0.3556 : 0) }; align = "center"; }
        text(place, value(name[1]), size, textAngle, "#008484", { ...pinOwner, kind: "pin-name", ...fontStyle(name), align });
      }
      if (!hideNumbers && number && !isHidden(number) && value(number[1]) && value(number[1]) !== "~") {
        const size = fontSize(number), gap = size/2 + 0.3556;
        const offset = scalar(form(symbolDef, "pin_names"), "offset") ?? 0.508;
        const side = !hideNames && value(name?.[1]) !== "~" && offset === 0 ? -1 : 1;
        const place = { x: (start.x + end.x)/2 - (horizontal ? 0 : gap * side),
          y: (start.y + end.y)/2 - (horizontal ? gap * side : 0) };
        text(place, value(number[1]), size, textAngle, "#a90000", { ...pinOwner, kind: "pin-number", ...fontStyle(number), align: "center" });
      }
    }
    function renderSymbol(node) {
      const at = point(node, "at");
      if (!at) { warn("Placed symbol without position was skipped."); return; }
      const id = scalar(node, "lib_name") ?? scalar(node, "lib_id") ?? value(node[1]);
      if (typeof id !== "string") { warn("Placed symbol without library ID was skipped."); return; }
      const unit = scalar(node, "unit") ?? 1, style = scalar(node, "body_style") ?? scalar(node, "convert") ?? 1;
      const angle = value(form(node, "at")?.[3]) ?? 0;
      if (![0, 90, 180, 270].includes(((angle % 360) + 360) % 360)) warn(`Symbol ${id} has non-orthogonal rotation ${angle}.`);
      const mirror = value(form(node, "mirror")?.[1]) || "";
      if (mirror && !["x", "y"].includes(mirror)) warn(`Symbol ${id} has unsupported mirror ${mirror}.`);
      const map = transform(at, finite(angle) ? angle : 0, mirror, true);
      const uuid = ownId(node), reference = forms(node, "property")
        .find((property) => value(property[1]) === "Reference");
      const ref = value(reference?.[2]) || "";
      const owner = { uuid, reference: ref, kind: "symbol" };
      const mainDefinition = definitions.get(id);
      if(form(mainDefinition,"power"))owner.powerSymbol=true;
      const units = libraryUnits(id, finite(unit) ? unit : 1, finite(style) ? style : 1);
      if (!units.length) warn(`No drawable unit ${unit} style ${style} for ${id}.`);
      const graphicStart = primitives.length;
      const pinLabels = new Map(),alternatePins=new Map();
      const savedFunctions=new Map();
      for(const pin of forms(node,'pin')){
        const alternate=scalar(pin,'alternate');
        if(typeof alternate==='string'&&alternate)savedFunctions.set(String(value(pin[1])??''),alternate);
      }
      for (const body of units) for (const item of body) {
        if (!Array.isArray(item)) continue;
        const kind = typeOf(item);
        if (kind === "pin") {
          const definition=pinFunctionDefinition(item),savedFunction=savedFunctions.get(definition.number);
          if(definition.number&&(definition.alternates.length||savedFunction)){
            alternatePins.set(definition.number,{...definition,active:savedFunction||definition.defaultName});
          }
          const start = primitives.length;
          renderPin(item, map, owner, mainDefinition || body);
          // Coincident visible pins remain separate electrical primitives. Only
          // coalesce their display labels, otherwise stacked package pins print
          // several different digits over exactly the same pixels.
          for (let i = start; i < primitives.length; i++) {
            const label = primitives[i];
            if (!["pin-name", "pin-number"].includes(label.kind)) continue;
            const key = JSON.stringify([label.kind,label.x,label.y,label.angle,label.size,
              label.align,label.baseline,label.color,label.fontWidth,label.fontHeight,
              label.fontFace,label.bold,label.italic,label.textThickness,label.lineSpacing,
              label.href,label.connectPoint,label.kind === "pin-name" ? label.text : null]);
            const previous = pinLabels.get(key);
            if (!previous) { pinLabels.set(key,label); continue; }
            const numbers = previous.pinNumbers || [previous.pinNumber];
            if (!numbers.includes(label.pinNumber)) numbers.push(label.pinNumber);
            previous.pinNumbers = numbers;
            if (label.kind === "pin-number") previous.text = numbers.join(", ");
            primitives.splice(i--,1);
          }
        }
        else if (["polyline", "rectangle", "circle", "arc", "bezier", "text", "text_box"].includes(kind)) drawGraphic(item, map, owner);
        else if (kind === "image") warn(`Symbol graphic ${kind} is not rendered.`);
      }
      if(typeof uuid==='string'&&alternatePins.size)pinFunctions[uuid]=[...alternatePins.values()];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const include = (p) => {
        if (!p || !finite(p.x) || !finite(p.y)) return;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      };
      for (const graphic of primitives.slice(graphicStart)) {
        if (graphic.uuid !== uuid) continue;
        if (graphic.hidden) continue;
        if (Array.isArray(graphic.points)) for (const p of graphic.points) include(p);
        else if (graphic.type === "circle") {
          include({ x: graphic.x - graphic.r, y: graphic.y - graphic.r });
          include({ x: graphic.x + graphic.r, y: graphic.y + graphic.r });
        } else if (graphic.type === "arc") {
          include(graphic.start); include(graphic.mid); include(graphic.end);
        }
      }
      if (!finite(minX)) { minX = at.x - 1.5; maxX = at.x + 1.5; minY = at.y - 1.5; maxY = at.y + 1.5; }
      const pad = 0.4;
      emit({ type: "polygon", points: [
        { x: minX - pad, y: minY - pad }, { x: maxX + pad, y: minY - pad },
        { x: maxX + pad, y: maxY + pad }, { x: minX - pad, y: maxY + pad }],
      pick: true, stroke: false, fill: false, ...owner });
      for (const property of forms(node, "property")) {
        if (isHidden(property)) continue;
        const position = point(property, "at"), string = value(property[2]);
        if (!position) { warn(`Visible property ${value(property[1])} has no position.`); continue; }
        const propertyAngle = value(form(property, "at")?.[3]) || 0;
        // Field anchors are sheet coordinates, but their angle and justification
        // remain relative to the parent symbol. Keep text upright as KiCad does.
        const totalAngle = angle + propertyAngle;
        const drawAngle = ((totalAngle % 180) + 180) % 180;
        const basis = transform({ x: 0, y: 0 }, totalAngle, mirror);
        const horizontal = basis({ x: 1, y: 0 }), vertical = basis({ x: 0, y: 1 });
        const radians = drawAngle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
        const style = fontStyle(property);
        if (horizontal.x * c - horizontal.y * s < 0) {
          style.align = ({ left: "right", right: "left" })[style.align] || style.align;
        }
        if (vertical.x * s + vertical.y * c < 0) {
          style.baseline = ({ top: "bottom", bottom: "top" })[style.baseline] || style.baseline;
        }
        text(position, string, fontSize(property), -drawAngle, COLOR.symbol,
          { ...owner, kind: "property", property: value(property[1]), ...style });
      }
    }
    function renderLabel(node, owner, kind = typeOf(node)) {
      if (isHidden(node)) return;
      const at = point(node, "at");
      if (!at) { warn(`${kind} without position was skipped.`); return; }
      const content = resolveText(value(node[1]),owner), size = fontSize(node), savedAngle = value(form(node, "at")?.[3]) || 0;
      // A sheet pin's saved angle names its sheet edge. Its marker and text
      // face into the sheet, opposite the corresponding child-sheet label.
      const angle=kind==="sheet-pin"?((savedAngle+180)%360+360)%360:savedAngle;
      const shape = scalar(node, "shape") || (kind === "sheet-pin" ? value(node[2]) : "input");
      const style = fontStyle(node), color = kind === "global_label" ? COLOR.symbol : "#725600";
      const labelOwner = { ...owner, kind, connectPoint: at };
      const map = transform(at, angle);
      const known = ["input", "output", "bidirectional", "tri_state", "passive"];
      if (!known.includes(shape)) warn(`Unsupported ${kind} shape ${shape}; using passive outline.`);
      const drawingShape=kind==="sheet-pin"?({input:"output",output:"input"}[shape]||shape):shape;
      const input = ["input", "bidirectional", "tri_state"].includes(drawingShape);
      const output = ["output", "bidirectional", "tri_state"].includes(drawingShape);
      let positions, place, labelAngle = -angle;
      // Hierarchical labels and sheet pins use a fixed-size connector icon;
      // global labels enclose text, so their width follows the text metric.
      if (kind === "hierarchical_label" || kind === "sheet-pin") {
        const h = size / 2;
        if (input && output) positions = [{x:0,y:0},{x:h,y:-h},{x:size,y:0},{x:h,y:h}];
        else if (input) positions = [{x:0,y:0},{x:h,y:h},{x:size,y:h},{x:size,y:-h},{x:h,y:-h}];
        else if (output) positions = [{x:size,y:0},{x:h,y:-h},{x:0,y:-h},{x:0,y:h},{x:h,y:h}];
        else positions = [{x:0,y:-h},{x:size,y:-h},{x:size,y:h},{x:0,y:h}];
        place = map({x:(style.fontWidth||size) + 0.1905,y:0});
      } else {
        const arrow = size * 0.875, h = size, padding = size * 0.375;
        // Canvas supplies text rather than KiCad's stroke glyphs. Preserve a
        // width hint so both the outline and displayed text share one metric.
        const width = Math.max(size, textWidth(content || "", style.fontWidth || size));
        const span = width + size * 0.8905 + (input ? arrow : 0) + (output ? arrow : 0);
        positions = [{x:0,y:0},{x:input ? arrow : 0,y:h},{x:span-(output ? arrow : 0),y:h},
          {x:span,y:0},{x:span-(output ? arrow : 0),y:-h},{x:input ? arrow : 0,y:-h}];
        place = map({x:padding + (input ? size * 0.75 : 0),y:0});
        style.textWidth = width;
      }
      emit({type:"polygon",points:positions.map(map),color,width:0.1524,...labelOwner});
      // Keep writing upright for left-facing and downward-facing connectors.
      const normalized = ((angle % 360) + 360) % 360;
      let align = "left";
      if (normalized === 180 || normalized === 270) { labelAngle += 180; align = "right"; }
      text(place,content,size,labelAngle,color,{...labelOwner,...style,align,baseline:"middle"});
    }
    function renderSheet(node) {
      const at = point(node, "at"), size = point(node, "size"), uuid = ownId(node);
      if (!at || !size || size.x <= 0 || size.y <= 0) { warn("Sheet without valid position/size was skipped."); return; }
      const owner = { uuid, kind: "sheet" };
      rect(at, { x: at.x + size.x, y: at.y + size.y }, COLOR.symbol, lineWidth(node), {...owner,...graphicStyle(node)}, fillType(node)||((savedColor(form(node,"fill"))&&!savedColor(form(node,"fill")).endsWith(",0)"))?"color":undefined));
      for (const property of forms(node, "property")) {
        if (isHidden(property)) continue;
        const position = point(property, "at");
        text(position, value(property[2]), fontSize(property), -(value(form(property, "at")?.[3]) || 0),
          COLOR.symbol, { ...owner, kind: "sheet-property", property: value(property[1]), ...fontStyle(property) });
      }
      for (const pin of forms(node, "pin")) {
        renderLabel(pin, { ...owner, pinUuid: ownId(pin) }, "sheet-pin");
      }
    }
    const identity = (position) => position;
    for (const node of rootAST) {
      if (!Array.isArray(node)) continue;
      const kind = typeOf(node), owner = { uuid: ownId(node), kind };
      if (kind === "symbol") renderSymbol(node);
      else if (kind === "sheet") renderSheet(node);
      else if (kind === "table") renderTable(node,owner);
      else if (kind === "wire" || kind === "bus") drawGraphic(node, identity, owner,
        kind === "bus" ? COLOR.bus : COLOR.wire);
      else if (["polyline", "rectangle", "circle", "arc", "bezier", "text_box"].includes(kind)) drawGraphic(node, identity, owner, "#0000c2");
      else if (kind === "junction") {
        const at = point(node, "at"), diameter = scalar(node, "diameter");
        if (at) emit({ type: "circle", x: at.x, y: at.y,
          r: finite(diameter) && diameter > 0 ? diameter / 2 : 0.5,
          color: COLOR.wire, width: 0.15, fill: "outline", ...owner, ...(savedColor(node)&&savedColor(node)!=="rgba(0,0,0,0)"?{color:savedColor(node),sourceColor:savedColor(node)}:{}) });
      } else if (kind === "no_connect") {
        const at = point(node, "at");
        if (at) {
          line({ x: at.x - 0.7, y: at.y - 0.7 }, { x: at.x + 0.7, y: at.y + 0.7 }, COLOR.pin, 0.15, owner);
          line({ x: at.x - 0.7, y: at.y + 0.7 }, { x: at.x + 0.7, y: at.y - 0.7 }, COLOR.pin, 0.15, owner);
        }
      } else if (["label", "global_label", "hierarchical_label", "text"].includes(kind)) {
        if (isHidden(node)) continue;
        const at = point(node, "at");
        if (kind === "global_label" || kind === "hierarchical_label") renderLabel(node, owner);
        else text(at, value(node[1]), fontSize(node), kind==='label'?-(((value(form(node,"at")?.[3])||0)%180+180)%180):-(value(form(node, "at")?.[3]) || 0),
          kind === "text" ? COLOR.text : COLOR.label, { ...owner, ...fontStyle(node) });
      } else if (kind === "bus_entry") {
        const at = point(node, "at"), size = point(node, "size");
        if (at && size) line(at, { x: at.x + size.x, y: at.y + size.y }, COLOR.bus, 0.3, owner);
      } else if (kind === "image") {
        try{
          const at=point(node,"at"),scale=scalar(node,"scale")??1,rotation=scalar(node,"rotate")??0,opacity=scalar(node,"opacity")??1;
          if(!at||!finite(scale)||scale<=0||!finite(rotation)||!finite(opacity)||opacity<0||opacity>1)throw Error("Embedded bitmap has invalid position, scale, rotation or opacity.");
          if(imageCount>=16)throw Error("Schematic exceeds its 16-image preview limit.");
          const bitmap=embeddedImage(node,Number(scalar(rootAST,"version"))||20230121),pixels=bitmap.pixelWidth*bitmap.pixelHeight;
          if(imageBytes+bitmap.bytes>MAX_TOTAL_IMAGE_BYTES||imagePixels+pixels>MAX_TOTAL_IMAGE_PIXELS)throw Error("Schematic exceeds its total 8 MiB / 16 megapixel image preview budget.");
          const width=bitmap.pixelWidth*25.4/bitmap.ppi*scale,height=bitmap.pixelHeight*25.4/bitmap.ppi*scale;if(!finite(width)||!finite(height)||width>100000||height>100000)throw Error("Embedded bitmap physical size exceeds the preview limit.");
          const map=transform(at,rotation);emit({type:"image",dataUrl:bitmap.dataUrl,pixelWidth:bitmap.pixelWidth,pixelHeight:bitmap.pixelHeight,points:[{x:-width/2,y:-height/2},{x:width/2,y:-height/2},{x:width/2,y:height/2},{x:-width/2,y:height/2}].map(map),opacity,...owner});imageBytes+=bitmap.bytes;imagePixels+=pixels;imageCount++;
        }catch(error){warn("Schematic image was not rendered: "+error.message);}
      } else if (["embedded_files", "rule_area"].includes(kind)) {
        warn(`Schematic construct ${kind} is not rendered.`);
      }
    }
    return { primitives, page, warnings, compatibility, pinFunctions };
  }
  root.KiCadSchematicRenderer = { build, pageSettings };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadSchematicRenderer;
})(typeof globalThis === "object" ? globalThis : this);

;
/* KiCad Default layer RGB/alpha data, checked against KiCad 10 and upstream defaults.
 * Reference: https://docs.kicad.org/doxygen/builtin__color__themes_8h_source.html
 * Independent lookup API; no KiCad executable or user configuration is required. */
((root)=>{'use strict';
 const entries = {"F.Cu":["#c83434",1],"B.Cu":["#4d7fc4",1],"In1.Cu":["#7fc87f",1],"In2.Cu":["#ce7d2c",1],"In3.Cu":["#4fcbcb",1],"In4.Cu":["#db628b",1],"In5.Cu":["#a7a5c6",1],"In6.Cu":["#28ccd9",1],"In7.Cu":["#e8b2a7",1],"In8.Cu":["#f2eda1",1],"In9.Cu":["#8dcb81",1],"In10.Cu":["#ed7c33",1],"In11.Cu":["#5bc3eb",1],"In12.Cu":["#f76f8e",1],"In13.Cu":["#a7a5c6",1],"In14.Cu":["#28ccd9",1],"In15.Cu":["#e8b2a7",1],"In16.Cu":["#f2eda1",1],"In17.Cu":["#ed7c33",1],"In18.Cu":["#5bc3eb",1],"In19.Cu":["#f76f8e",1],"In20.Cu":["#a7a5c6",1],"In21.Cu":["#28ccd9",1],"In22.Cu":["#e8b2a7",1],"In23.Cu":["#f2eda1",1],"In24.Cu":["#ed7c33",1],"In25.Cu":["#5bc3eb",1],"In26.Cu":["#f76f8e",1],"In27.Cu":["#a7a5c6",1],"In28.Cu":["#28ccd9",1],"In29.Cu":["#e8b2a7",1],"In30.Cu":["#f2eda1",1],"F.Adhes":["#840084",1],"B.Adhes":["#000084",1],"F.Paste":["#b4a09a",0.9],"B.Paste":["#00c2c2",0.9],"F.SilkS":["#f2eda1",1],"B.SilkS":["#e8b2a7",1],"F.Mask":["#d864ff",0.4],"B.Mask":["#02ffee",0.4],"F.Fab":["#afafaf",1],"B.Fab":["#585d84",1],"F.CrtYd":["#ff26e2",1],"B.CrtYd":["#26e9ff",1],"Edge.Cuts":["#d0d2cd",1],"Margin":["#ff26e2",1],"Dwgs.User":["#c2c2c2",1],"Cmts.User":["#5994dc",1],"Eco1.User":["#b4dbd2",1],"Eco2.User":["#d8c852",1],"User.1":["#c2c2c2",1],"User.2":["#5994dc",1],"User.3":["#b4dbd2",1],"User.4":["#d8c852",1],"User.5":["#c2c2c2",1],"User.6":["#5994dc",1],"User.7":["#b4dbd2",1],"User.8":["#d8c852",1],"User.9":["#e8b2a7",1],"User.10":["#5994dc",1],"User.11":["#b4dbd2",1],"User.12":["#d8c852",1],"User.13":["#c2c2c2",1],"User.14":["#5994dc",1],"User.15":["#b4dbd2",1],"User.16":["#d8c852",1],"User.17":["#c2c2c2",1],"User.18":["#5994dc",1],"User.19":["#b4dbd2",1],"User.20":["#d8c852",1],"User.21":["#c2c2c2",1],"User.22":["#5994dc",1],"User.23":["#b4dbd2",1],"User.24":["#d8c852",1],"User.25":["#c2c2c2",1],"User.26":["#5994dc",1],"User.27":["#b4dbd2",1],"User.28":["#d8c852",1],"User.29":["#c2c2c2",1],"User.30":["#5994dc",1],"User.31":["#b4dbd2",1],"User.32":["#d8c852",1],"User.33":["#c2c2c2",1],"User.34":["#5994dc",1],"User.35":["#b4dbd2",1],"User.36":["#d8c852",1],"User.37":["#c2c2c2",1],"User.38":["#5994dc",1],"User.39":["#b4dbd2",1],"User.40":["#d8c852",1],"User.41":["#c2c2c2",1],"User.42":["#5994dc",1],"User.43":["#b4dbd2",1],"User.44":["#d8c852",1],"User.45":["#c2c2c2",1]};
 for(const value of Object.values(entries))Object.freeze(value);Object.freeze(entries);
 const hexFor=layer=>entries[String(layer)]?.[0]||'#c2c2c2';
 const opacityFor=layer=>entries[String(layer)]?.[1]??1;
 const colorFor=layer=>{const hex=hexFor(layer),a=opacityFor(layer);return a===1?hex:`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;};
 // Presentation hues keep the familiar front-red/back-blue identities while
 // avoiding neon masks and muddy low-contrast copper on each canvas theme.
 // The native lookup above remains available for source/default comparisons.
 const reviewDark=Object.freeze({'F.Cu':'#fa6f68','B.Cu':'#63a5ff','F.SilkS':'#e8dcae','B.SilkS':'#b5c8df','F.Fab':'#b2bbc9','B.Fab':'#8d9ab0','F.CrtYd':'#c59be0','B.CrtYd':'#7bc6cf','Edge.Cuts':'#d6deea','F.Mask':'#b197d7','B.Mask':'#77bdb5','F.Paste':'#d2afa0','B.Paste':'#98c9ce'});
 const reviewLight=Object.freeze({'F.Cu':'#b9474c','B.Cu':'#3268ae','F.SilkS':'#766126','B.SilkS':'#596a87','F.Fab':'#647086','B.Fab':'#606c83','F.CrtYd':'#8c519e','B.CrtYd':'#257b85','Edge.Cuts':'#465368','F.Mask':'#9279b8','B.Mask':'#4d968a','F.Paste':'#9d796a','B.Paste':'#448b93'});
 function reviewColorFor(layer,dark=true){
  const hex=(dark?reviewDark:reviewLight)[String(layer)]||hexFor(layer),alpha=opacityFor(layer);
  return alpha===1?hex:`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;
 }
 // Context keeps only eight percent of the layer hue; selected copper uses
 // reviewColorFor unchanged. Fixed neutral anchors keep both themes readable.
 function contextColorFor(layer,dark=true){
  const hex=(dark?reviewDark:reviewLight)[String(layer)]||hexFor(layer),base=dark?[135,145,155]:[115,123,131];
  return '#'+base.map((value,index)=>Math.round(value*.92+parseInt(hex.slice(1+index*2,3+index*2),16)*.08).toString(16).padStart(2,'0')).join('');
 }
 function fabricationLayer(role){
  const text=String(role||'').toLowerCase(),bottom=/bottom|\bbot\b/.test(text),side=bottom?'B.':'F.';
  if(/drill|plated/.test(text))return null;
  if(/outline|profile/.test(text))return 'Edge.Cuts';
  if(/copper/.test(text)){if(/inner|inr/.test(text)){const match=/copper,\s*l(\d+),\s*inr/.exec(text),named=/inner copper\s*(\d+)/.exec(text);const n=match?Number(match[1])-1:named?Number(named[1]):0;return n>=1&&n<=30?'In'+n+'.Cu':null;}return side+'Cu';}
  if(/mask/.test(text))return side+'Mask';
  if(/silk|legend/.test(text))return side+'SilkS';
  if(/paste/.test(text))return side+'Paste';return null;
 }
 const api=Object.freeze({entries,hexFor,opacityFor,colorFor,reviewColorFor,contextColorFor,fabricationLayer});root.KiCadLayerColors=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

;
/* Independent, read-only KiCad PCB geometry extraction. All coordinates are mm. */
((root) => {
  "use strict";
  const Compatibility=root.KiCadFileCompatibility||(typeof module==="object"&&module.exports?require("./file-compatibility.js"):null);
  const Worksheet=root.KiCadWorksheet||(typeof module==="object"&&module.exports?require("./worksheet.js"):null);
  const MAX_PRIMITIVES = root.KiCadDesignDiff?.MAX_RENDER_PRIMITIVES || (typeof require==='function'?require('./design-diff.js').MAX_RENDER_PRIMITIVES:1500000);
  const value = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kind = (node) => Array.isArray(node) ? String(value(node[0])) : "";
  const children = (node, name) => Array.isArray(node) ? node.filter((part) => Array.isArray(part) && kind(part) === name) : [];
  const child = (node, name) => Array.isArray(node) ? node.find(part => Array.isArray(part) && kind(part) === name) : undefined;
  const field = (node, name) => value(child(node, name)?.[1]);
  const num = (item, fallback = 0) => { const result = Number(value(item)); return Number.isFinite(result) ? result : fallback; };
  const point = (node, name) => {
    const entry = child(node, name);
    if (!entry || !Number.isFinite(Number(value(entry[1]))) || !Number.isFinite(Number(value(entry[2])))) return null;
    return { x: num(entry[1]), y: num(entry[2]) };
  };
  function packedZone(coordinates) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let i=0;i<coordinates.length;i+=2){
      const x=coordinates[i],y=coordinates[i+1];
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
    }
    return {zoneCoordinates:coordinates,zoneBounds:{x:minX,y:minY,w:maxX-minX,h:maxY-minY}};
  }
  function unpackZone(coordinates) {
    const points=new Array(coordinates.length/2);
    for(let i=0;i<points.length;i++)points[i]={x:coordinates[i*2],y:coordinates[i*2+1]};
    return points;
  }
  function hydrateZonePoints(design) {
    if(!design?.packedZones||design.releaseZonePoints)return design;
    let cache=new WeakMap();
    for(const primitive of design.primitives)if(primitive.zoneCoordinates){
      Object.defineProperty(primitive,'points',{enumerable:true,get(){
        const coordinates=primitive.zoneCoordinates;
        let points=cache.get(coordinates);
        if(!points){points=unpackZone(coordinates);cache.set(coordinates,points);}
        return points;
      }});
    }
    Object.defineProperty(design,'releaseZonePoints',{value:()=>{cache=new WeakMap();}});
    return design;
  }
  const points = node => children(child(node, "pts"), "xy").map(xy => ({x:num(xy[1]),y:num(xy[2])}));
  const uuid = (node) => String(field(node, "uuid") || field(node, "tstamp") || "");
  const hasAtom = (node, atom) => Array.isArray(node) && node.some((part) => !Array.isArray(part) && value(part) === atom);
  const hasFlag = (node, name) => Array.isArray(node) && node.some((part) => {
    if (Array.isArray(part) && kind(part) === name) {
      const state = value(part[1]);
      return state === undefined || state === true || state === "yes" || state === "true" || state === 1;
    }
    return !Array.isArray(part) && !(part && typeof part === "object") && part === name;
  });
  const hidden = (node) => hasFlag(node, "hide") || hasFlag(child(node, "effects"), "hide") ||
    hasFlag(child(child(node, "effects"), "font"), "hide");
  const rotation = (node) => num(child(node, "at")?.[3]);
  const PI = Math.PI;
  const toRadians = (degrees) => degrees * PI / 180;
  const round = (n) => Math.round(n * 1e8) / 1e8;
  const Palette=root.KiCadLayerColors||(typeof module==='object'&&module.exports?require('./layer-colors.js'):null);
  const colorFor = layer => Palette.colorFor(layer);
  const paperSizes = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210], A5: [210, 148],
    A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6],
    USLetter: [279.4, 215.9], USLegal: [355.6, 215.9], USLedger: [431.8, 279.4] };
  function pageOf(ast, warnings) {
    const paper = child(ast, "paper") || child(ast, "page");
    const name = String(value(paper?.[1]) || "A4");
    let size = paperSizes[name];
    if (name === "User") size = [num(paper?.[2]), num(paper?.[3])];
    if (!size || size.some((dimension) => dimension <= 0)) {
      warnings.push(`Unsupported PCB paper ${name}; using A4 page dimensions.`); size = paperSizes.A4;
    }
    const portrait = paper?.some((part) => value(part) === "portrait");
    const block = child(ast,"title_block");
    const comments = Array(9).fill("");
    for (const item of children(block,"comment")) { const index = num(item[1]); if (index >= 1 && index <= 9) comments[index-1] = String(value(item[2]) || ""); }
    return { width: portrait ? size[1] : size[0], height: portrait ? size[0] : size[1], name,
      title:String(field(block,"title") || ""), date:String(field(block,"date") || ""),
      revision:String(field(block,"rev") || ""), company:String(field(block,"company") || ""), comments,format:name,titleBlock:{title:String(field(block,"title")||""),date:String(field(block,"date")||""),rev:String(field(block,"rev")||""),company:String(field(block,"company")||""),comments} };
  }
  function transformed(origin, angle) {
    const c = Math.cos(toRadians(angle)), s = Math.sin(toRadians(angle));
    return (p) => ({ x: round(origin.x + p.x * c + p.y * s), y: round(origin.y - p.x * s + p.y * c) });
  }
  const identity = (p) => p;
  function roundedRect(width, height, radius) {
    const w = width / 2, h = height / 2, r = Math.max(0, Math.min(radius, w, h));
    if (r < 1e-6) return [{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}];
    const result = [];
    for (const [cx, cy, start] of [[w-r,-h+r,-90],[w-r,h-r,0],[-w+r,h-r,90],[-w+r,-h+r,180]]) {
      for (let step = 0; step <= 6; step++) {
        const a = toRadians(start + step * 15);
        result.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    }
    return result;
  }
  function oval(width, height) {
    const radius = Math.min(width, height) / 2;
    if (Math.abs(width - height) < 1e-9) return null;
    if (width > height) {
      const half = width / 2 - radius, result = [];
      for (let i = 0; i <= 12; i++) { const a = toRadians(-90 + i * 15); result.push({x:half + radius*Math.cos(a),y:radius*Math.sin(a)}); }
      for (let i = 0; i <= 12; i++) { const a = toRadians(90 + i * 15); result.push({x:-half + radius*Math.cos(a),y:radius*Math.sin(a)}); }
      return result;
    }
    return oval(height, width).map((p) => ({x:p.y,y:p.x}));
  }
  const pinOneColor='#c477ff';
  function firstCopperPadNumber(footprint){
    let ball=null;
    for(const pad of children(footprint,'pad')){
      if(value(pad[2])==='np_thru_hole'||!child(pad,'layers')?.slice(1).some(layer=>/^(?:F|B|F&B|In[0-9]+|\*)\.Cu$/.test(value(layer))))continue;
      const number=String(value(pad[1])??'');
      if(number==='1')return number;
      if(number==='A1')ball=number;
    }
    return ball;
  }

  function build(ast, path = "", options = {}) {
    const warnings = [], primitives = [];
    if (kind(ast) !== "kicad_pcb") throw new Error("Expected a KiCad PCB AST.");
    const compatibility=Compatibility?.inspect(ast);
    warnings.push(...(compatibility?.warnings||[]));
    const variableText=Compatibility?.textResolver(ast,{...options,path},message=>{if(!warnings.includes(message))warnings.push(message);}),variableFields=new Map();
    const page = pageOf(ast, warnings);
    const layerNames = (child(ast, "layers") || []).slice(1).filter(Array.isArray).map((part) => String(value(part[1])));
    const netNames=new Map(children(ast,'net').filter(n=>typeof value(n[1])==='number'&&typeof value(n[2])==='string').map(n=>[value(n[1]),value(n[2])])),modernNamedNets=Number(field(ast,'version'))>=20260206;
    // Format metadata belongs to the board, not each generated primitive. In
    // large boards most graphics have no net declaration at all.
    function netMeta(node){const declaration=child(node,'net');if(!declaration)return{};const id=value(declaration[1]);if(typeof id==='number'&&Number.isSafeInteger(id)&&id>=0)return{netId:id,netCode:String(id),netName:String(value(declaration[2])??netNames.get(id)??'')};if(modernNamedNets&&declaration.length===2&&typeof id==='string'&&id)return{netId:id,netCode:'name:'+id,netName:id};return{};}
    const push = (primitive) => {
      if (primitives.length >= MAX_PRIMITIVES) throw new Error("PCB has too many render primitives.");
      primitives.push(primitive);
    };
    const warned = new Set();
    const warn = (label, node) => {
      if (warned.has(label) || warnings.length >= 1000) return;
      warned.add(label);
      warnings.push(`${label}${uuid(node) ? ` (example ${uuid(node)})` : ""} is not drawn exactly.`);
    };
    if(!options.silkscreenOnly){
      if(Worksheet){for(const primitive of Worksheet.build(page,path))push({...primitive,layer:"Worksheet"});}
      else warnings.push("Default worksheet module is unavailable.");
    }
    warnings.push("Custom .kicad_wks templates are not resolved; the standard KiCad drawing sheet is shown.");
    function base(node, layer, owner = {}) {
      const lineStyle=field(child(node,"stroke"),"type");
      return { layer, color: colorFor(layer), ...(["dash","dot","dash_dot","dash_dot_dot"].includes(lineStyle)?{lineStyle}:{}), uuid: uuid(node) || owner.uuid || undefined,
        ownerUuid: owner.ownerUuid || owner.uuid || undefined,
        reference: owner.reference || undefined, kind: owner.kind || kind(node),...netMeta(node),
        ...(owner.kind==='pad'?{name:owner.name,pinNumber:owner.pinNumber,pinName:owner.pinName,netName:owner.netName,netId:owner.netId,netCode:owner.netCode,
          padCenter:owner.padCenter,padWidth:owner.padWidth,padHeight:owner.padHeight,padAngle:owner.padAngle,padShape:owner.padShape,...(owner.pinOne?{pinOne:true}:{})}:{}) };
    }
    function isFilled(node) {
      const fill = child(node,"fill");
      return ["yes","solid"].includes(value(fill?.[1])) || field(fill,"type") === "solid";
    }
    function strokeWidth(node) {
      const stroke = child(node, "stroke");
      return Math.max(0.01, num(child(stroke, "width")?.[1], num(field(node, "width"), .15)));
    }
    function drawShape(node, layer, transform = identity, owner = {}) {
      const type = kind(node), meta = base(node, layer, owner), width = strokeWidth(node);
      const withPoints = (typeName, pts, fill = false) => {
        if (pts.some((p) => !p)) return;
        push({ type: typeName, points: pts.map(transform), width, fill, ...meta });
      };
      if (["gr_line", "fp_line"].includes(type)) withPoints("line", [point(node,"start"),point(node,"end")]);
      else if (["gr_arc", "fp_arc", "arc"].includes(type)) {
        let start = point(node,"start"), mid = point(node,"mid"), end = point(node,"end");
        if(start && end && !mid && child(node,"angle")){
          // KiCad 4/5 arcs store a centre and start point, with a signed sweep.
          const center=start,sweep=num(field(node,"angle"))*Math.PI/180,dx=end.x-center.x,dy=end.y-center.y;
          const at=theta=>({x:center.x+dx*Math.cos(theta)-dy*Math.sin(theta),y:center.y+dx*Math.sin(theta)+dy*Math.cos(theta)});
          start=end;mid=at(sweep/2);end=at(sweep);
        }
        if (start && mid && end) push({ type:"arc", start:transform(start), mid:transform(mid), end:transform(end), width, ...meta });
        else warn(type, node);
      } else if (["gr_rect", "fp_rect"].includes(type)) {
        const a = point(node,"start"), b = point(node,"end");
        if (a && b) withPoints("polygon", [{x:a.x,y:a.y},{x:b.x,y:a.y},{x:b.x,y:b.y},{x:a.x,y:b.y}], isFilled(node));
      } else if (["gr_circle", "fp_circle"].includes(type)) {
        const center = point(node,"center"), end = point(node,"end");
        if (center && end) {
          const c = transform(center), edge = transform(end);
          push({ type:"circle", x:c.x, y:c.y, r:Math.hypot(edge.x-c.x,edge.y-c.y), width,
            fill:isFilled(node), ...meta });
        }
      } else if (["gr_poly", "fp_poly"].includes(type)) {
        const pts = points(node);
        if (pts.length >= 3) withPoints("polygon", pts, isFilled(node));
      } else if (["gr_text", "fp_text", "property"].includes(type)) {
        if (hidden(node)) return;
        const at = point(node,"at");
        const content = type === "property" ? value(node[2]) : value(node[type === "fp_text" ? 2 : 1]);
        const effects = child(node,"effects"), font = child(effects,"font");
        const fontSize = child(font,"size"), justify = child(effects,"justify");
        const justification = justify?.slice(1).map((part) => String(value(part))) || [];
        if (at && content != null) push({ type:"text", text:variableText?.resolve(content,variableFields.get(owner.uuid)||{})??String(content), ...transform(at),
          size:num(fontSize?.[2],1), angle:-rotation(node), width:.15,
          property:type==="property"?String(value(node[1])):type==="fp_text"&&value(node[1])==="reference"?"Reference":type==="fp_text"&&value(node[1])==="value"?"Value":undefined,
          ...(justification.includes("mirror")?{mirror:true}:{}),
          bold:hasAtom(font,"bold") || !!child(font,"bold"),
          italic:hasAtom(font,"italic") || !!child(font,"italic"),
          align:justification.includes("left") ? "left" : justification.includes("right") ? "right" : "center",
          baseline:justification.includes("top") ? "top" : justification.includes("bottom") ? "bottom" : "middle",
          ...meta });
      } else warn(type, node);
    }
    function pad(node, footprint, transform) {
      const at = point(node,"at") || {x:0,y:0}, center = transform(at), shape = String(value(node[3]) || "rect");
      const size = child(node,"size"), width = num(size?.[1]), height = num(size?.[2]);
      if (width <= 0 || height <= 0) { warn("Pad with invalid size",node); return; }
      const rawLayers = (child(node,"layers") || []).slice(1).map((part) => String(value(part)));
      const selected = [...new Set(rawLayers.flatMap((item) => item.startsWith("*.")
        ? layerNames.filter((layer) => layer.endsWith(item.slice(1))) : item==='F&B.Cu'?['F.Cu','B.Cu']:[item]))];
      if (!selected.length) { warn("Pad without renderable layers",node); return; }
      // KiCad serializes the pad angle in board coordinates, even though its
      // position is footprint-local. An omitted angle is therefore zero.
      const localAngle = rotation(node);
      const orient = transformed(center, localAngle);
      const padUUID = uuid(node) || footprint.uuid;
      const drillNode = child(node,"drill");
      const ovalDrill = value(drillNode?.[1]) === "oval";
      const drill = num(drillNode?.[ovalDrill ? 2 : 1]);
      const drillHeight = ovalDrill ? num(drillNode?.[3]) : drill;
      const offsetNode = child(drillNode,"offset");
      const drillOffset = offsetNode ? {x:num(offsetNode[1]),y:num(offsetNode[2])} : {x:0,y:0};
      const holeCenter = orient(drillOffset);
      for (const layer of selected) {
        const meta = { layer, color:colorFor(layer), uuid:padUUID, ownerUuid:footprint.uuid,
          reference:footprint.reference,
          kind:"pad", name:String(value(node[1]) || ""), pinNumber:String(value(node[1]) || ""),
          padCenter:{...center}, padWidth:width, padHeight:height, padAngle:-localAngle,padShape:shape,
          pinName:String(field(node,"pinfunction") || ""), ...netMeta(node), padType:String(value(node[2])||""), fill:true };
        if(meta.pinNumber===footprint.pinOneNumber&&meta.padType!=='np_thru_hole'&&layer.endsWith('.Cu'))meta.pinOne=true;
        if (shape === "circle") push({ type:"pad", x:center.x, y:center.y, r:width/2, ...meta });
        else if (shape === "custom") {
          const options = child(node,"options"), anchor = String(field(options,"anchor") || "");
          if (anchor === "rect") push({ type:"pad", points:roundedRect(width,height,0).map(orient), ...meta });
          else if (anchor === "circle") {
            if (Math.abs(width-height) > 1e-8) warn("Noncircular custom pad anchor",node);
            push({ type:"pad", x:center.x, y:center.y, r:Math.min(width,height)/2, ...meta });
          } else { warn(`Unsupported custom pad anchor ${anchor || "(missing)"}`,node); continue; }
          const shapes = child(node,"primitives");
          if (shapes) for (const primitive of shapes.slice(1)) {
            if (!Array.isArray(primitive)) continue;
            const primitiveKind = kind(primitive);
            if (!["gr_poly","gr_line","gr_arc","gr_circle","gr_rect"].includes(primitiveKind)) {
              warn(`Unsupported custom pad primitive ${primitiveKind}`,node); continue;
            }
            const explicitWidth = field(primitive,"width");
            if (["gr_line","gr_arc"].includes(primitiveKind) && explicitWidth !== undefined && num(explicitWidth) <= 0) {
              warn(`Zero-width custom pad ${primitiveKind}`,node); continue;
            }
            drawShape(primitive,layer,orient,meta);
          }
        }
        else {
          let outline;
          if (shape === "rect") outline = roundedRect(width,height,0);
          else if (shape === "roundrect") outline = roundedRect(width,height,Math.min(width,height)*num(field(node,"roundrect_rratio"),.25));
          else if (shape === "oval") outline = oval(width,height) || roundedRect(width,height,Math.min(width,height)/2);
          else { warn(`Unsupported ${shape} pad`,node); continue; }
          push({ type:"pad", points:outline.map(orient), ...meta });
        }
        if (drill > 0 && drillHeight > 0) {
          const holeMeta = { layer, color:"#111b25", fill:true, hole:true,
            uuid:padUUID, ownerUuid:footprint.uuid, reference:footprint.reference, kind:"drill", objectCategory:"pads",...netMeta(node) };
          if (ovalDrill && Math.abs(drill-drillHeight) > 1e-9) {
            const holeTransform = transformed(holeCenter,localAngle);
            push({ type:"polygon", points:oval(drill,drillHeight).map(holeTransform), ...holeMeta });
          } else push({ type:"circle", x:holeCenter.x, y:holeCenter.y, r:drill/2, ...holeMeta });
        }
      }
    }
    for (const node of ast.slice(1)) {
      if (!Array.isArray(node)) continue;
      const type = kind(node), layer = String(field(node,"layer") || "F.Cu");
      if(options.silkscreenOnly && !["footprint","module"].includes(type) && !["F.SilkS","B.SilkS"].includes(layer))continue;
      if (type === "segment") {
        const a = point(node,"start"), b = point(node,"end");
        if (a && b) push({ type:"line", points:[a,b], layer, color:colorFor(layer),
          width:num(field(node,"width"),.2), fill:false, uuid:uuid(node) || undefined, kind:"track",...netMeta(node) });
      } else if (type === "arc") {
        drawShape(node,layer);
      } else if (type === "via") {
        const at = point(node,"at"), diameter = num(field(node,"size")), drill = num(field(node,"drill"));
        if (!at || diameter <= 0) { warn("Via with invalid dimensions",node); continue; }
        const viaLayers = (child(node,"layers") || []).slice(1).map((part) => String(value(part)));
        const copperOrder = layerNames.filter((item) => item.endsWith(".Cu"));
        let plated = viaLayers.filter((item) => item.endsWith(".Cu"));
        if (plated.length >= 2) {
          const first = copperOrder.indexOf(plated[0]), last = copperOrder.indexOf(plated.at(-1));
          if (first >= 0 && last >= 0) plated = copperOrder.slice(Math.min(first,last),Math.max(first,last)+1);
        }
        for (const copper of (plated.length ? plated : ["F.Cu","B.Cu"])) {
          push({ type:"circle", ...at, r:diameter/2, layer:copper, color:"#c5aa6c", fill:true,
            uuid:uuid(node) || undefined, kind:"via",...netMeta(node) });
          if (drill > 0) push({ type:"circle", ...at, r:drill/2, layer:copper, color:"#111b25", fill:true,
            hole:true, uuid:uuid(node) || undefined, kind:"drill", objectCategory:"vias",...netMeta(node) });
        }
      } else if (["footprint","module"].includes(type)) {
        const origin = point(node,"at");
        if (!origin) { warn("Footprint without placement",node); continue; }
        const angle = rotation(node);
        // Saved KiCad footprint-local coordinates already encode a back-side
        // flip. Applying another mirror places pads on the wrong side.
        const transform = transformed(origin,angle);
        const properties = children(node,"property");
        const local=variableText?.fields(node)||{};
        for(const sub of children(node,"fp_text")){const name=String(value(sub[1]));if(name==='reference')local.Reference=String(value(sub[2])??'');if(name==='value')local.Value=String(value(sub[2])??'');}
        if(local.Reference!==undefined)local.REFERENCE=local.Reference;if(local.Value!==undefined)local.VALUE=local.Value;
        if(uuid(node))variableFields.set(uuid(node),local);
        const reference = local.Reference||"";
        const owner = { uuid:uuid(node), reference, pinOneNumber:options.silkscreenOnly?null:firstCopperPadNumber(node) };
        const firstPrimitive = primitives.length;
        for (const sub of node.slice(1)) {
          if (!Array.isArray(sub)) continue;
          const subType = kind(sub), subLayer = String(field(sub,"layer") || layer);
          if(options.silkscreenOnly && !["F.SilkS","B.SilkS"].includes(subLayer))continue;
          if (subType === "pad") pad(sub,owner,transform);
          else if (["fp_line","fp_arc","fp_rect","fp_circle","fp_poly","fp_text"].includes(subType)) drawShape(sub,subLayer,transform,owner);
          else if (subType === "property") drawShape(sub,subLayer,transform,owner);
        }
        const padPrimitives = primitives.slice(firstPrimitive).filter((part) => part.type === "pad");
        const coordinates = padPrimitives.flatMap((part) => part.points || (part.r ? [
          {x:part.x-part.r,y:part.y-part.r},{x:part.x+part.r,y:part.y+part.r}] : []));
        if (coordinates.length && owner.uuid && primitives.length < MAX_PRIMITIVES) {
          const xs = coordinates.map((p) => p.x), ys = coordinates.map((p) => p.y),
            minX = Math.min(...xs)-.3, maxX = Math.max(...xs)+.3,
            minY = Math.min(...ys)-.3, maxY = Math.max(...ys)+.3;
          primitives.splice(firstPrimitive,0,{ type:"polygon", points:[{x:minX,y:minY},{x:maxX,y:minY},
            {x:maxX,y:maxY},{x:minX,y:maxY}], layer, color:"#000000", fill:false, stroke:false,
            pick:true, uuid:owner.uuid, ownerUuid:owner.uuid, reference, kind:"footprint-hit" });
        }
      } else if (type === "zone") {
        const filled = children(node,"filled_polygon");
        if (filled.length) {
          for (const region of filled) {
            const regionLayer = String(field(region,"layer") || layer), coordinates=child(region,"pts")?.[1];
            const geometry=coordinates instanceof Float64Array
              ? options.packedZones?packedZone(coordinates):{points:unpackZone(coordinates)} : {points:points(region)};
            if (geometry.zoneCoordinates||geometry.points.length >= 3) push({ type:"polygon", ...geometry, layer:regionLayer, color:colorFor(regionLayer),
              // Filled contours may bridge cut-outs with doubled-back segments.
              // Those segments close the fill; they are not copper outlines.
              fill:true, stroke:false, opacity:.22, uuid:uuid(node) || undefined, kind:"zone",...netMeta(node) });
          }
        } else {
          warn("Unfilled zone",node);
        }
        const outlineLayers=(child(node,'layers')||[]).slice(1).map(item=>String(value(item)));
        for(const polygon of children(node,'polygon')){const pts=points(polygon);if(pts.length<3)continue;
          for(const outlineLayer of outlineLayers.length?outlineLayers:[layer])push({type:'polygon',points:pts,layer:outlineLayer,color:colorFor(outlineLayer),fill:false,width:.15,uuid:uuid(node)||undefined,kind:'zone-outline',...netMeta(node)});
        }
      } else if (["gr_line","gr_arc","gr_rect","gr_circle","gr_poly","gr_text"].includes(type)) drawShape(node,layer);
      else if (["gr_curve","gr_text_box","gr_bitmap","dimension","target"].includes(type)) warn(type,node);
    }
    const priority = (item) => item.frame ? -100 : item.kind === "footprint-hit" ? -20 :
      item.kind === "zone" ? -10 : item.kind === "zone-outline" ? -9 :
      item.kind === "track" ? 0 : item.kind === "via" ? 1 : item.kind === "pad" ? 2 :
      item.kind === "drill" ? 3 : 0;
    primitives.sort((a,b) => priority(a)-priority(b));
    return { primitives, page, warnings, compatibility, layers:layerNames.length ? layerNames : [...new Set(primitives.map((item) => item.layer))], path,
      ...(options.packedZones&&primitives.some(primitive=>primitive.zoneCoordinates)?{packedZones:true}:{}) };
  }
  root.KiCadPCBRenderer = { build, colorFor, firstCopperPadNumber, pinOneColor, hydrateZonePoints };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadPCBRenderer;
})(typeof globalThis === "object" ? globalThis : this);

;
/* Read-only saved PCB nets and per-file schematic source connectivity, in mm. */
((root) => {
  "use strict";
  const diff = root.KiCadDesignDiff || (typeof require === "function" ? require("./design-diff.js") : null);
  const value = (item) => item && typeof item === "object" && !Array.isArray(item) ? item.quoted : item;
  const kind = (node) => Array.isArray(node) ? String(value(node[0])) : "";
  const children = (node, name) => Array.isArray(node) ? node.filter((part) => kind(part) === name) : [];
  const child = (node, name) => children(node, name)[0];
  const field = (node, name) => value(child(node, name)?.[1]);
  const point = (node, name) => {
    const entry = child(node, name);
    return entry && Number.isFinite(value(entry[1])) && Number.isFinite(value(entry[2]))
      ? { x:value(entry[1]), y:value(entry[2]) } : null;
  };
  const validPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const distance = (a, b) => Math.hypot(b.x-a.x, b.y-a.y);
  const EPS = 1e-7; // Sub-nanometre serialization tolerance, not a proximity connection.
  const LABELS = new Set(["label", "global_label", "hierarchical_label"]);
  const fresh = (path, code, name, type) => ({ id:`${path}/net:${code}`, path, code, name, displayName:name, kind:type,
    objectIds:[], uuids:[], primitives:[], stats:{ pads:0, tracks:0, vias:0, zones:0, lengthMm:0 }, members:[] });
  function displayName(net) {
    if(typeof net?.displayName==='string' && net.displayName)return net.displayName;
    // Older prepared models may contain a source UUID in their unnamed fallback.
    if(net?.kind==='schematic' && /^Unnamed network \(/.test(net.name||''))return 'Unnamed network';
    return typeof net?.name==='string' && net.name ? net.name : 'Unnamed network';
  }
  function arcLength(node) {
    const a = point(node,"start"), b = point(node,"mid"), c = point(node,"end");
    if (!a || !b || !c) return null;
    // Translate to start to avoid precision loss for far-from-origin designs.
    const bx=b.x-a.x, by=b.y-a.y, cx=c.x-a.x, cy=c.y-a.y;
    const determinant=2*(bx*cy-by*cx);
    if (Math.abs(determinant) <= 1e-12 * Math.max(1,bx*bx+by*by,cx*cx+cy*cy)) return null;
    const bb=bx*bx+by*by, cc=cx*cx+cy*cy;
    const ox=(cy*bb-by*cc)/determinant, oy=(bx*cc-cx*bb)/determinant;
    const angle=(x,y)=>Math.atan2(y-oy,x-ox), turn=2*Math.PI;
    const positive=(r)=>(r%turn+turn)%turn;
    const start=angle(0,0), through=positive(angle(bx,by)-start), end=positive(angle(cx,cy)-start);
    const sweep=through <= end+1e-12 ? end : turn-end;
    return Math.hypot(ox,oy)*sweep;
  }
  function pcbPrimitiveMatches(kind, primitive) {
    switch (kind) {
      case 'pad': return primitive === 'pad' || primitive === 'drill';
      case 'zone': return primitive === 'zone' || primitive === 'zone-outline';
      case 'segment': return primitive === 'track';
      case 'arc': return primitive === 'arc' || primitive === 'track';
      default: return primitive === 'via' || primitive === 'drill';
    }
  }
  function pcb(path, ast, records, primitives, warn) {
    const nets=new Map(), names=new Map();
    const modernNamedNets=Number(field(ast,'version'))>=20260206;
    const codeOf=(form)=> {
      const raw=value(form?.[1]);
      if(modernNamedNets&&typeof raw==='string'&&raw&&form.length===2)return `name:${raw}`;
      return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null;
    };
    const declare=(form)=> {
      const code=codeOf(form), name=code?.startsWith('name:')?value(form?.[1]):value(form?.[2]);
      if (!code || code === "0" || typeof name !== "string" || !name) return;
      if (names.has(code) && names.get(code) !== name) warn(`${path}: net code ${code} has conflicting saved names; using ${names.get(code)}.`);
      else names.set(code,name);
    };
    children(ast,"net").forEach(declare);
    for (const record of records) declare(child(record.form,"net"));
    const ensure=(code)=> {
      if (!nets.has(code)) nets.set(code,fresh(path,code,names.get(code) || `Net ${code} (name unavailable)`,"pcb"));
      return nets.get(code);
    };
    names.forEach((_,code)=>ensure(code));
    const byUuid=new Map(), padPrimitives=new Map(), footprints=new Map(records.filter((r)=>r.kind === "footprint").map((r)=>[r.key,r]));
    for (const p of primitives) if (p.uuid) {
      const existing = byUuid.get(p.uuid);
      if (!existing) byUuid.set(p.uuid, p);
      else if (Array.isArray(existing)) existing.push(p);
      else byUuid.set(p.uuid, [existing, p]);
      if (p.kind === "pad" && p.ownerUuid && p.name != null) {
        const key=JSON.stringify([p.ownerUuid,String(p.name)]);
        if (!padPrimitives.has(key)) padPrimitives.set(key,[]);
        padPrimitives.get(key).push(p);
      }
    }
    for (const record of records) {
      if (!["pad","segment","arc","via","zone"].includes(record.kind)) continue;
      const declaration=child(record.form,"net");
      if (!declaration) continue;
      const code=codeOf(declaration);
      if (code === "0") continue;
      if (code === null) { warn(`${path}: ${record.label} has an unsupported net code and was excluded.`); continue; }
      if (!names.has(code)) warn(`${path}: net code ${code} has no saved name declaration.`);
      const net=ensure(code), uuid=record.metadata.uuid;
      net.objectIds.push(record.id || record.key);
      if (uuid) net.uuids.push(uuid);
      // Pad primitives may have the footprint UUID only in older files. Never
      // highlight the entire footprint or a different pad sharing that owner.
      const parent=record.kind === "pad" ? footprints.get(record.key.slice(0,record.key.lastIndexOf("/pad:"))) : null;
      const candidates = uuid ? byUuid.get(uuid) : parent ? padPrimitives.get(JSON.stringify([
        parent.metadata.uuid, String(value(record.form[1]))])) : undefined;
      if (Array.isArray(candidates)) {
        for (const p of candidates) if (pcbPrimitiveMatches(record.kind, p.kind)) net.primitives.push(p);
      } else if (candidates && pcbPrimitiveMatches(record.kind, candidates.kind)) net.primitives.push(candidates);
      net.members.push({uuid, reference:parent?.metadata.properties.Reference || "", pad:record.kind === "pad" ? String(value(record.form[1])) : "",
        kind:record.kind, position:record.metadata.position});
      const stat=({pad:"pads",segment:"tracks",arc:"tracks",via:"vias",zone:"zones"})[record.kind];
      net.stats[stat]++;
      if (record.kind === "segment") {
        const a=point(record.form,"start"), b=point(record.form,"end");
        if (a && b) net.stats.lengthMm+=distance(a,b);
        else warn(`${path}: track ${uuid || record.label} has incomplete geometry; length omitted.`);
      } else if (record.kind === "arc") {
        const length=arcLength(record.form);
        if (length !== null) net.stats.lengthMm+=length;
        else warn(`${path}: arc ${uuid || record.label} has unsupported or degenerate geometry; length omitted.`);
      }
    }
    return [...nets.values()];
  }
  function onSegment(p, edge) {
    const {a,b}=edge, dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
    if (!length) return distance(a,p)<=EPS;
    return Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)<=EPS*length &&
      p.x>=Math.min(a.x,b.x)-EPS && p.x<=Math.max(a.x,b.x)+EPS &&
      p.y>=Math.min(a.y,b.y)-EPS && p.y<=Math.max(a.y,b.y)+EPS;
  }
  // Balanced bounding-box index: attachment queries avoid scanning every wire.
  function spatialIndex(edges, depth=0) {
    if (!edges.length) return null;
    const minX=Math.min(...edges.map((e)=>Math.min(e.a.x,e.b.x))), maxX=Math.max(...edges.map((e)=>Math.max(e.a.x,e.b.x)));
    const minY=Math.min(...edges.map((e)=>Math.min(e.a.y,e.b.y))), maxY=Math.max(...edges.map((e)=>Math.max(e.a.y,e.b.y)));
    if (edges.length<=16) return {minX,maxX,minY,maxY,edges};
    const axis=depth%2 ? "y" : "x";
    edges.sort((a,b)=>(a.a[axis]+a.b[axis])-(b.a[axis]+b.b[axis]));
    const middle=Math.floor(edges.length/2);
    return {minX,maxX,minY,maxY,left:spatialIndex(edges.slice(0,middle),depth+1),right:spatialIndex(edges.slice(middle),depth+1)};
  }
  function schematic(path, ast, records, primitives, warn) {
    warn(`${path}: schematic nets show per-file source connectivity only; cross-sheet hierarchy, implicit hidden power pins and bus expansion are not resolved. This is not a KiCad netlist.`);
    const entries=[], edges=[], anchors=[];
    const add=(entry)=> {entry.index=entries.length; entries.push(entry); return entry;};
    for (const record of records) {
      if (record.kind === "wire") {
        const pts=children(child(record.form,"pts"),"xy").map((xy)=>({x:value(xy[1]),y:value(xy[2])}));
        if (pts.length<2 || !pts.every(validPoint)) {warn(`${path}: wire with invalid geometry was excluded.`); continue;}
        const entry=add({record,kind:"wire",position:pts[0],length:0});
        for (let i=1;i<pts.length;i++) {edges.push({a:pts[i-1],b:pts[i],index:entry.index}); entry.length+=distance(pts[i-1],pts[i]);}
        for (const p of pts) anchors.push({p,index:entry.index,endpoint:true});
      } else if (record.kind === "sheet") {
        for (const pin of children(record.form,"pin")) {
          const p=point(pin,"at"), name=value(pin[1]);
          if (!p || typeof name!=="string" || !name) continue;
          const pinUuid=field(pin,"uuid"), sheetId=record.metadata.uuid || record.id || record.key;
          const pinRecord={...record,id:`${record.id || record.key}/pin:${pinUuid || name}`,metadata:{...record.metadata,uuid:pinUuid}};
          const entry=add({record:pinRecord,kind:"sheet_pin",position:p,sheetPin:{sheetId,name},direction:value(pin[2])});
          anchors.push({p,index:entry.index});
        }
      } else if (LABELS.has(record.kind) || record.kind === "junction") {
        const p=point(record.form,"at");
        if (!p) continue;
        const entry=add({record,kind:record.kind,position:p,name:LABELS.has(record.kind) ? String(value(record.form[1])) : null,
          direction:field(record.form,"shape"),namePriority:({global_label:0,label:2,hierarchical_label:3})[record.kind]});
        anchors.push({p,index:entry.index,junction:record.kind === "junction"});
      }
    }
    const symbols=new Map(records.filter((r)=>r.kind === "symbol" && r.metadata.uuid).map((r)=>[r.metadata.uuid,r]));
    const definitions=new Map(children(child(ast,"lib_symbols"),"symbol").map((s)=>[String(value(s[1])),s]));
    const powerSymbols=new Map(), powerFlags=new Set(), version=Number(field(ast,"version"));
    for (const [uuid, record] of symbols) {
      const definition=definitions.get(String(field(record.form,"lib_name") ?? field(record.form,"lib_id"))), power=child(definition,"power");
      if (!power) continue; // Names and #PWR reference conventions are not electrical evidence.
      const scope=value(power[1]);
      if (scope !== undefined && !["global","local"].includes(scope)) {
        warn(`${path}: unsupported explicit power-symbol scope ${scope}; naming omitted.`); continue;
      }
      const libraryPins=children(definition,"symbol").flatMap((body)=>children(body,"pin"));
      if (libraryPins.length===1 && value(libraryPins[0][1])==="power_out") {powerFlags.add(uuid);continue;} // ERC power flag, not a net-name source.
      if (libraryPins.length!==1 || value(libraryPins[0][1])!=="power_in") {
        warn(`${path}: explicit power symbol ${record.label} is not a supported single power-input pin; naming omitted.`);continue;
      }
      const pin=libraryPins[0], pinNumber=String(field(pin,"number") ?? "");
      let name;
      // KiCad 8 (20231120 schematic schema) changed explicit power-symbol net
      // naming to the placed Value. KiCad 7 and earlier used the hidden pin name.
      // https://docs.kicad.org/9.0/en/eeschema/eeschema.html#power-symbols
      if (Number.isSafeInteger(version) && version>=20231120) name=record.metadata.properties.Value;
      else if (Number.isSafeInteger(version) && version>0 && version<=20230121 &&
        (child(pin,"hide") || pin.some((part)=>value(part)==="hide"))) name=field(pin,"name");
      else {warn(`${path}: power symbol ${record.label} has an unproven schematic version; naming omitted.`);continue;}
      if (typeof name!=="string" || !name || name==="~") {
        warn(`${path}: power symbol ${record.label} has no usable saved net name; naming omitted.`);continue;
      }
      powerSymbols.set(uuid,{name,pinNumber,global:scope !== "local"});
    }
    const pins=new Map();
    for (const p of primitives) if (p.kind === "pin" && validPoint(p.connectPoint) && p.pinNumber != null) {
      const owner=p.ownerUuid || p.uuid, record=symbols.get(owner);
      if (!record) continue;
      const key=JSON.stringify([owner,String(p.pinNumber),p.connectPoint.x,p.connectPoint.y]);
      if (pins.has(key)) {pins.get(key).primitives.push(p); continue;}
      const power=powerSymbols.get(owner), isPower=power && power.pinNumber===String(p.pinNumber);
      const entry=add({record,kind:"pin",position:p.connectPoint,pin:String(p.pinNumber),primitives:[p],direction:p.pinType,
        name:isPower ? power.name : null,namePriority:isPower ? 1 : undefined,power:!!isPower,flag:powerFlags.has(owner),global:!!(isPower && power.global)});
      pins.set(key,entry); anchors.push({p:p.connectPoint,index:entry.index});
    }
    if (symbols.size && !pins.size) warn(`${path}: no conductive pin metadata is available; symbol pin membership was omitted.`);
    if (entries.length>30000 || edges.length>30000) {warn(`${path}: schematic connectivity exceeds the 30000-object limit and was omitted.`); return [];}
    const parent=entries.map((_,i)=>i), rank=entries.map(()=>0);
    const find=(i)=> {let n=i; while(parent[n]!==n) n=parent[n]; while(parent[i]!==i) {const next=parent[i];parent[i]=n;i=next;} return n;};
    const join=(a,b)=> {a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++;};
    const index=spatialIndex(edges.slice()), exact=new Map();
    const coordinate=(p)=>JSON.stringify([p.x,p.y]);
    // Exact common points join pins, labels, junctions and wire endpoints.
    for (const anchor of anchors) {
      const key=coordinate(anchor.p);
      if (exact.has(key)) join(anchor.index,exact.get(key)); else exact.set(key,anchor.index);
    }
    let checks=0;
    const query=(tree,p,hits)=> {
      if (!tree || p.x<tree.minX-EPS || p.x>tree.maxX+EPS || p.y<tree.minY-EPS || p.y>tree.maxY+EPS) return;
      if (tree.edges) for (const edge of tree.edges) {
        if (++checks>2000000) throw new Error("attachment limit");
        if (onSegment(p,edge)) hits.add(edge.index);
      } else {query(tree.left,p,hits);query(tree.right,p,hits);}
    };
    try {
      // Endpoints and explicit junctions make T connections and real crossings.
      for (const anchor of anchors.filter((a)=>a.endpoint || a.junction)) {
        const hits=new Set();query(index,anchor.p,hits);for(const hit of hits)join(anchor.index,hit);
      }
      for (const anchor of anchors.filter((a)=>!a.endpoint && !a.junction)) {
        const hits=new Set();query(index,anchor.p,hits);
        if (new Set([...hits].map(find)).size>1) {warn(`${path}: ambiguous label/pin at a wire crossing without a junction was not attached.`);continue;}
        for(const hit of hits)join(anchor.index,hit);
      }
    } catch {warn(`${path}: schematic connectivity exceeds the attachment-work limit and was omitted.`);return [];}
    const labels=new Map();
    for (const entry of entries) if (entry.name) {
      if (labels.has(entry.name)) join(entry.index,labels.get(entry.name));else labels.set(entry.name,entry.index);
    }
    const groups=new Map();
    for (const entry of entries) {const key=find(entry.index);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
    const byUuid=new Map();
    for (const p of primitives) for(const id of new Set([p.uuid,p.pinUuid].filter(Boolean))) {if(!byUuid.has(id))byUuid.set(id,[]);byUuid.get(id).push(p);}
    const nets=[];
    for (const group of groups.values()) {
      if (!group.some((e)=>e.kind === "wire" || e.name || e.sheetPin)) continue; // Isolated pins/junctions are not inferred nets.
      const names=[...new Set(group.map((e)=>e.name).filter(Boolean))].sort();
      const preferred=group.filter((e)=>e.name).sort((a,b)=>(a.namePriority ?? 4)-(b.namePriority ?? 4)||a.name.localeCompare(b.name))[0]?.name;
      const first=group.filter((e)=>e.kind === "wire" || e.sheetPin).map((e)=>e.record.id || e.record.key).sort()[0], code=names.length ? `label:${names[0]}` : `source:${first}`;
      const net=fresh(path,code,preferred || `Unnamed network (${group.find((e)=>e.kind === "wire")?.record.metadata.uuid || "wire"})`,"schematic");
      // Sheet-pin text is useful for display but is not a global/local label:
      // never merge different child-sheet ports solely because their names match.
      const sheetNames=[...new Set(group.map(e=>e.sheetPin?.name).filter(Boolean))].sort();
      const connections=[...new Set(group.filter(e=>e.kind==='pin' && e.record.metadata.properties.Reference)
        .map(e=>`${e.record.metadata.properties.Reference} pin ${e.pin}`))].sort();
      net.displayName=preferred || (sheetNames.length?sheetNames.join(' / '):
        'Unnamed network'+(connections.length?' · '+connections.slice(0,2).join(', ')+(connections.length>2?' …':''):''));
      net.scope="file";net.names=names;
      net.globalNames=[...new Set(group.filter((e)=>e.kind === "global_label" || e.global).map((e)=>e.name).filter(Boolean))].sort();
      net.hierarchicalNames=[...new Set(group.filter((e)=>e.kind === "hierarchical_label").map((e)=>e.name))].sort();
      net.sheetPins=group.filter((e)=>e.sheetPin).map((e)=>({...e.sheetPin}));
      if (names.length>1) warn(`${path}: connected schematic source network has multiple labels: ${names.join(", ")}.`);
      for (const entry of group) {
        const r=entry.record, uuid=r.metadata.uuid;
        net.objectIds.push(r.id || r.key);if(uuid)net.uuids.push(uuid);
        net.primitives.push(...((entry.power||entry.flag) ? (byUuid.get(uuid) || []).filter((p)=>!p.frame) : entry.kind === "pin" ? entry.primitives :
          (byUuid.get(uuid) || []).filter((p)=>p.kind === entry.kind || entry.kind==="sheet_pin"&&p.kind==="sheet-pin" || p.kind==="text-overbar"&&(p.electricalKind===entry.kind||entry.kind==="sheet_pin"&&p.electricalKind==="sheet-pin"))));
        net.members.push({uuid,reference:entry.kind === "pin" ? r.metadata.properties.Reference || "" : "",
          pad:"",pin:entry.pin || "",kind:entry.kind,position:entry.position,...(entry.direction&&!entry.flag?{direction:entry.direction}:{}),...((entry.name||entry.sheetPin?.name)?{name:entry.name||entry.sheetPin.name}:{}),...(entry.sheetPin?{sheetId:entry.sheetPin.sheetId}:{})});
        net.stats.lengthMm+=entry.length || 0;
      }
      nets.push(net);
    }
    return nets;
  }
  function build(files, designs=new Map(), snapshot=null) {
    if (!diff?.projectObjects || !diff?.parse) throw new Error("KiCadDesignDiff is required for net extraction.");
    const parsedFiles=new Map(),rawRecords=diff.projectObjects(files,(file,ast)=>parsedFiles.set(file.path,ast),snapshot,{forConnectivity:true}), counts=new Map(), recordsByPath=new Map();
    // Keep duplicate saved object IDs aligned with the design-model convention.
    for (const record of rawRecords) {
      if(!recordsByPath.has(record.path))recordsByPath.set(record.path,[]);
      recordsByPath.get(record.path).push(record);
      const count=(counts.get(record.key)||0)+1;counts.set(record.key,count);record.id=count===1 ? record.key : `${record.key}#${count}`;}
    counts.clear();
    const nets=[], warnings=[], seenWarnings=new Set();
    const warn=(message)=> {if(warnings.length<1000 && !seenWarnings.has(message)){seenWarnings.add(message);warnings.push(message);}};
    for (const file of files) {
      const ast=parsedFiles.get(file.path), records=recordsByPath.get(file.path) || [];
      const design=designs instanceof Map ? designs.get(file.path) : designs?.[file.path];
      const primitives=Array.isArray(design?.primitives) ? design.primitives : [];
      if (primitives.length>diff.MAX_RENDER_PRIMITIVES) throw new Error("Too many render primitives for net selection.");
      nets.push(...(kind(ast)==="kicad_pcb" ? pcb(file.path,ast,records,primitives,warn) : schematic(file.path,ast,records,primitives,warn)));
    }
    for (const net of nets) {net.objectIds=[...new Set(net.objectIds)];net.uuids=[...new Set(net.uuids)];net.primitives=[...new Set(net.primitives)];}
    nets.sort((a,b)=>a.path.localeCompare(b.path)||a.name.localeCompare(b.name)||a.code.localeCompare(b.code));
    return {nets,warnings};
  }
  // Only loaded files from one schematic project should be supplied. Local
  // names are never cross-sheet evidence, even when a global name matches them.
  function relatedSchematicNets(nets, selectedId, hierarchy=[]) {
    const limits=["Only loaded schematic files are searched.",
      "Only unambiguous resolved sheet links are searched; cyclic hierarchy, repeated sheet instances, implicit hidden power pins and buses are not resolved; this is not a KiCad netlist."];
    const selected=nets.find((net)=>net.id===selectedId && net.kind==="schematic");
    if (!selected) return {matches:[],paths:[],limits};
    if(!hierarchy.length && !selected.globalNames?.length)return {matches:[selected],paths:[selected.path],limits};
    const byName=new Map(), parentPins=new Map(), childNames=new Map();
    const append=(map,key,item)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(item);};
    const key=(...parts)=>JSON.stringify(parts);
    for (const net of nets) if(net.kind==="schematic") {
      for(const name of net.globalNames || [])append(byName,name,net);
      for(const pin of hierarchy.length ? net.sheetPins || [] : [])append(parentPins,key(net.path,pin.sheetId),{net,name:pin.name});
      for(const name of hierarchy.length ? net.hierarchicalNames || [] : [])append(childNames,key(net.path,name),net);
    }
    const links=[...new Map(hierarchy.map((link)=>[key(link.path,link.target,link.sheetId),link])).values()];
    const targetCounts=new Map(), outgoing=new Map();
    for(const link of links) {
      targetCounts.set(link.target,(targetCounts.get(link.target)||0)+1);
      append(outgoing,link.path,link.target);
    }
    const adjacent=new Map(),connect=(a,b)=> {
      append(adjacent,a.id,b);append(adjacent,b.id,a);
    };
    // Index edges once; memoize descendant queries instead of repeatedly
    // scanning every hierarchy link for every visited sheet.
    const descendants=new Map();
    const reachable=(start)=> {
      if(descendants.has(start))return descendants.get(start);
      const pending=[start],seen=new Set();
      for(let i=0;i<pending.length;i++) {
        const path=pending[i];if(seen.has(path))continue;seen.add(path);
        for(const target of outgoing.get(path)||[])pending.push(target);
      }
      descendants.set(start,seen);return seen;
    };
    const ambiguous=new Set();
    for(const [path,count] of targetCounts)if(count>1)
      for(const descendant of reachable(path))ambiguous.add(descendant);
    for(const link of links) if(targetCounts.get(link.target)===1 && !ambiguous.has(link.path) && !reachable(link.target).has(link.path)) {
      for(const parent of parentPins.get(key(link.path,link.sheetId)) || [])
        for(const childNet of childNames.get(key(link.target,parent.name)) || [])connect(parent.net,childNet);
    }
    const found=new Map([[selected.id,selected]]),queue=[selected],expandedNames=new Set();
    for(let i=0;i<queue.length;i++) {
      const candidates=[...(adjacent.get(queue[i].id)||[])];
      for(const name of queue[i].globalNames || [])if(!expandedNames.has(name)) {
        expandedNames.add(name);candidates.push(...(byName.get(name)||[]));
      }
      for(const net of candidates)if(!found.has(net.id)){found.set(net.id,net);queue.push(net);}
    }
    const matches=[...found.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.id.localeCompare(b.id));
    return {matches,paths:[...new Set(matches.map((net)=>net.path))],limits};
  }
  function createBuilder() {
    // Workspace-owned connectivity snapshots. No global AST retention: changing
    // one rendered sheet rebuilds that sheet rather than reparsing the project.
    const cache=new Map();
    let primitiveIds=new WeakMap(), nextPrimitiveId=0;
    const CACHE_LIMIT=96*1024*1024;
    function primitiveSignature(primitives) {
      if(primitives.length>diff.MAX_RENDER_PRIMITIVES)throw new Error("Too many render primitives for net selection.");
      const chunks=[];let chars=0;
      for(const p of primitives) {
        let entry;
        if(!p||typeof p!=="object")entry=[typeof p,String(p)];
        else {
        if(!primitiveIds.has(p))primitiveIds.set(p,++nextPrimitiveId);
          entry=[primitiveIds.get(p),p.kind,p.uuid,p.ownerUuid,p.name,p.pinNumber,p.connectPoint?.x,p.connectPoint?.y,Boolean(p.frame)];
        }
        const chunk=JSON.stringify(entry);chars+=chunk.length+1;
        if(chars>4*1024*1024)return null; // Large render metadata is processed without caching.
        chunks.push(chunk);
      }
      return '['+chunks.join(',')+']';
    }
    function cloneNet(net) {
      return {...net,objectIds:[...net.objectIds],uuids:[...net.uuids],primitives:[...net.primitives],stats:{...net.stats},
        members:net.members.map(member=>({...member,...(member.position?{position:{...member.position}}:{})})),...(net.names?{names:[...net.names]}:{}),...(net.globalNames?{globalNames:[...net.globalNames]}:{}),...(net.hierarchicalNames?{hierarchicalNames:[...net.hierarchicalNames]}:{}),...(net.sheetPins?{sheetPins:net.sheetPins.map(pin=>({...pin}))}:{})};
    }
    function cachedBuild(files,designs=new Map()) {
      // Use the source parser's current file-count contract without parsing its
      // sources just to validate the cache. Each changed file uses build below.
      if(!Array.isArray(files)||files.length>(diff.MAX_FILES||128))throw new Error("Too many KiCad files to compare.");
      const paths=new Set(), inputs=[];let sourceBytes=0;
      for(const file of files) {
        if(!file||typeof file.path!=="string"||typeof file.content!=="string"||!/(?:\.kicad_(?:sch|pcb)|\.(?:sch|brd))$/i.test(file.path)||paths.has(file.path))throw new Error("Invalid or duplicate KiCad file entry.");
        paths.add(file.path);
        const previous=cache.get(file.path),size=previous?.content===file.content?previous.sourceBytes:diff.sourceByteLength(file.content);
        sourceBytes+=size;
        if(size>diff.sourceByteLimit(file.path)||sourceBytes>diff.MAX_PROJECT)throw new Error("KiCad project exceeds browser comparison size limits.");
        const design=designs instanceof Map?designs.get(file.path):designs?.[file.path],primitives=Array.isArray(design?.primitives)?design.primitives:[];
        if(primitives.length>diff.MAX_RENDER_PRIMITIVES)throw new Error("Too many render primitives for net selection.");
        inputs.push({file,sourceBytes:size,primitives,design});
      }
      for(const path of cache.keys())if(!paths.has(path))cache.delete(path);
      const nets=[],warnings=[],seenWarnings=new Set();let retainedBytes=0;
      for(const input of inputs) {
        const {file,primitives,design}=input,signature=primitiveSignature(primitives),previous=cache.get(file.path);
        let snapshot;
        if(signature!==null&&previous?.content===file.content&&previous.signature===signature)snapshot=previous.snapshot;
        else snapshot=build([file],new Map([[file.path,design]]));
        const bytes=input.sourceBytes+(signature===null?Infinity:signature.length*2);
        if(retainedBytes+bytes<=CACHE_LIMIT) {
          cache.set(file.path,{content:file.content,sourceBytes:input.sourceBytes,signature,snapshot});retainedBytes+=bytes;
        }else cache.delete(file.path);
        nets.push(...snapshot.nets.map(cloneNet));
        for(const warning of snapshot.warnings)if(warnings.length<1000&&!seenWarnings.has(warning)){seenWarnings.add(warning);warnings.push(warning);}
      }
      nets.sort((a,b)=>a.path.localeCompare(b.path)||a.name.localeCompare(b.name)||a.code.localeCompare(b.code));
      return {nets,warnings};
    }
    function clear(){cache.clear();primitiveIds=new WeakMap();nextPrimitiveId=0;}
    return {build:cachedBuild,clear};
  }
  function selectedTrackLength(objects){
    const seen=new Set();let lengthMm=0,count=0,omitted=0;
    for(const object of objects||[]){if(!object||!['segment','arc'].includes(object.kind))continue;const key=JSON.stringify([object.path,object.uuid||object.id]);if(seen.has(key))continue;seen.add(key);
      const tree=object.saved?.tree;let length=null;
      if(object.kind==='arc')length=arcLength(tree);else{const a=point(tree,'start'),b=point(tree,'end');if(a&&b)length=distance(a,b);}
      if(Number.isFinite(length)&&length>=0){lengthMm+=length;count++;}else omitted++;
    }
    return {lengthMm,count,omitted};
  }
  root.KiCadNetModel={build,createBuilder,relatedSchematicNets,displayName,selectedTrackLength};
  if(typeof module === "object" && module.exports)module.exports=root.KiCadNetModel;
})(typeof globalThis === "object" ? globalThis : this);

;
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
  function copyTree(input){
    let nodes=0;
    function copy(v,depth){
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
  const sectionLabel={board:'Board setup',schematic:'Schematic setup',erc:'Electrical rules (ERC)',net_settings:'Net classes and assignments',text_variables:'Text variables',pcbnew:'PCB editor settings',eeschema:'Schematic editor settings',libraries:'Libraries',meta:'File metadata',boards:'Board files',cvpcb:'Footprint assignment','3dviewports':'Saved 3D views'};
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
  // Validate every token, but allocate only saved settings. Skipped drawing
  // forms still consume parser depth/node budgets and preserve their root slot.
  function boardSettingsTree(source){
    const stack=[],roots=[],number=/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
    let i=0,nodes=0;
    function append(value){
      if(++nodes>6000000)throw new Error('KiCad file has too many S-expression nodes.');
      const frame=stack.at(-1);
      if(!frame){roots.push(value);return;}
      if(frame.keep){
        if(stack.length===2&&frame.tree.length===0&&isGeometry([value])){
          frame.keep=false;frame.parent[frame.index]=null;frame.tree=null;
        }else frame.tree.push(value);
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
    return copyTree(roots[0]);
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

;
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

;
/* Revision-bound drawing-sheet data and safe SVG composition. No CAD edits or network. */
((root)=>{'use strict';
 const SCHEMA='pocket-kivi-draftsman/v1',MAX_BYTES=4*1024*1024,MAX_SVG=32*1024*1024;
 const papers=Object.freeze({A4:[210,297],A3:[297,420],Letter:[215.9,279.4]});
 const fail=message=>{throw Error('Draftsman: '+message);};
 const bytes=value=>new TextEncoder().encode(value).length;
 const fields=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Unsupported or unexpected document field.');};
 const text=(value,max=200,empty=true)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail('Invalid text field.');return value;};
 const number=(value,min,max)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('Invalid measurement or page coordinate.');return value;};
 const id=value=>{if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value))fail('Invalid item identifier.');return value;};
 const file=value=>{text(value,500,false);if(value.startsWith('/')||/[\\\x00-\x1f\x7f?#%:]/.test(value)||value.split('/').some(v=>!v||v==='.'||v==='..')||! /\.kicad_(pcb|sch)$/i.test(value))fail('Invalid source drawing path.');return value;};
 const point=value=>{fields(value,['x','y']);return{x:number(value.x,-1e6,1e6),y:number(value.y,-1e6,1e6)};};
 function source(value){
  fields(value,['provider','host','repository','ref','hashes']);
  if(!['github','gitlab','local'].includes(value.provider))fail('Invalid source provider.');
  const repository=text(value.repository,300,false),ref=text(value.ref,200,false);if(/[\s\\?#%]/.test(repository)||repository.split('/').some(v=>!v||v==='.'||v==='..')||/[\x00-\x20\\?#%]/.test(ref)||ref.includes('..'))fail('Invalid source repository or revision.');
  const result={provider:value.provider,repository,ref};
  if(value.host!==undefined){let host;try{host=new URL(value.host);}catch{fail('Invalid source host.');}if(host.protocol!=='https:'||host.username||host.password||host.search||host.hash||host.pathname!=='/'||host.origin!==value.host)fail('Invalid source host.');result.host=host.origin;}
  if(value.hashes!==undefined){fields(value.hashes,Object.keys(value.hashes));const keys=Object.keys(value.hashes);if(keys.length>128)fail('Too many source fingerprints.');result.hashes={};for(const name of keys){file(name);if(!/^[a-f0-9]{64}$/.test(value.hashes[name]))fail('Invalid source fingerprint.');Object.defineProperty(result.hashes,name,{value:value.hashes[name],enumerable:true,writable:true,configurable:true});}}
  return result;
 }
 function pageSize(doc){if(!papers[doc.paper]||!['landscape','portrait'].includes(doc.orientation))fail('Invalid paper size or orientation.');const [short,long]=papers[doc.paper];return doc.orientation==='landscape'?{width:long,height:short}:{width:short,height:long};}
 function sameSource(a,b){const left=source(a),right=source(b);for(const key of ['provider','host','repository','ref'])if((left[key]||'')!==(right[key]||''))fail('Document belongs to a different source revision.');if(right.hashes){const names=new Set([...Object.keys(left.hashes||{}),...Object.keys(right.hashes)]);for(const name of names)if(left.hashes?.[name]!==right.hashes[name])fail('Source drawing fingerprint changed: '+name);}}
 function validate(input,expectedSource){
  let raw;try{raw=typeof input==='string'?input:JSON.stringify(input);}catch{fail('Document is not JSON.');}if(typeof raw!=='string'||bytes(raw)>MAX_BYTES)fail('Document exceeds 4 MiB.');let doc;try{doc=JSON.parse(raw);}catch{fail('Invalid document JSON.');}
  fields(doc,['schema','source','template','title','revision','company','units','precision','paper','orientation','accent','fontSize','lineWidth','pages']);if(doc.schema!==SCHEMA)fail('Unsupported document version.');if(doc.template===undefined)doc.template='modern';if(!['modern','kicad'].includes(doc.template))fail('Unsupported worksheet template.');doc.source=source(doc.source);if(expectedSource)sameSource(doc.source,expectedSource);
  text(doc.title,200);text(doc.revision,80);text(doc.company,200);if(!['mm','in'].includes(doc.units)||!Number.isInteger(doc.precision)||doc.precision<0||doc.precision>4)fail('Invalid units or precision.');if(!/^#[0-9a-fA-F]{6}$/.test(doc.accent))fail('Invalid drawing accent.');number(doc.fontSize,2,5);number(doc.lineWidth,.1,1);const size=pageSize(doc);
  if(!Array.isArray(doc.pages)||!doc.pages.length||doc.pages.length>20)fail('Document must have 1–20 sheets.');const pageIds=new Set(),viewIds=new Set();let mechanicalViews=0;
  for(const page of doc.pages){fields(page,['id','title','items']);id(page.id);if(pageIds.has(page.id))fail('Duplicate sheet identifier.');pageIds.add(page.id);text(page.title,160);if(!Array.isArray(page.items)||page.items.length>200)fail('A sheet supports at most 200 drawing items.');const itemIds=new Set(),views=new Map();
   for(const item of page.items){id(item?.id);if(itemIds.has(item.id))fail('Duplicate drawing item identifier.');itemIds.add(item.id);
    if(item.type==='view'){if(viewIds.has(item.id))fail('Drawing view identifiers must be unique across sheets.');viewIds.add(item.id);fields(item,['id','type','file','side','layers','x','y','width','height','rotation','scale','caption','renderMode','projection']);file(item.file);if(item.renderMode!==undefined&&item.renderMode!=='mechanical3d')fail('Unsupported drawing rendering mode.');if(item.projection!==undefined&&(!['top','bottom','front','back','left','right','iso'].includes(item.projection)||item.renderMode!=='mechanical3d'))fail('Invalid mechanical projection.');if(item.renderMode==='mechanical3d'&&(!/\.kicad_pcb$/i.test(item.file)||item.side!=='top'||!Array.isArray(item.layers)||item.layers.length||!item.projection))fail('Mechanical views require a PCB, a projection and no copper layers.');if(item.renderMode==='mechanical3d'&&++mechanicalViews>16)fail('At most 16 mechanical views per document.');if(!['top','bottom'].includes(item.side)||![0,90,180,270].includes(item.rotation)||item.scale!=='fit'&&!(typeof item.scale==='number'&&Number.isFinite(item.scale)&&item.scale>=.01&&item.scale<=100))fail('Invalid drawing view.');if(!Array.isArray(item.layers)||item.layers.length>128||new Set(item.layers).size!==item.layers.length)fail('Invalid view layer selection.');for(const layer of item.layers)text(layer,80,false);text(item.caption,200);number(item.x,8,size.width-8);number(item.y,12,size.height-36);number(item.width,5,size.width-16);number(item.height,5,size.height-48);if(item.x+item.width>size.width-8||item.y+item.height>size.height-36)fail('Drawing view is outside the sheet drawing area.');views.set(item.id,item);}
    else if(item.type==='dimension'){fields(item,['id','type','viewId','kind','a','b','offset']);id(item.viewId);if(!['horizontal','vertical','aligned'].includes(item.kind))fail('Unsupported dimension kind.');point(item.a);point(item.b);number(item.offset,-100,100);const span=item.kind==='horizontal'?Math.abs(item.b.x-item.a.x):item.kind==='vertical'?Math.abs(item.b.y-item.a.y):Math.hypot(item.b.x-item.a.x,item.b.y-item.a.y);if(span<1e-8)fail('A dimension requires two distinct measurement points.');}
    else if(item.type==='note'){fields(item,['id','type','x','y','width','text']);number(item.x,8,size.width-8);number(item.y,12,size.height-36);number(item.width,10,size.width-16);text(item.text,4000);if(item.x+item.width>size.width-8)fail('Note is outside the sheet.');}
    else if(item.type==='bom'){fields(item,['id','type','x','y','width','rows']);number(item.x,8,size.width-8);number(item.y,12,size.height-36);number(item.width,40,size.width-16);if(item.x+item.width>size.width-8)fail('BoM is outside the sheet.');if(!Array.isArray(item.rows)||item.rows.length>1000)fail('BoM supports at most 1,000 rows.');for(const row of item.rows){fields(row,['reference','value','footprint','quantity']);text(row.reference,1000);text(row.value,500);text(row.footprint,500);if(!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>1000000)fail('Invalid BoM quantity.');}}
    else fail('Unsupported drawing item type.');
   }
   for(const item of page.items)if(item.type==='dimension'){if(!views.has(item.viewId))fail('Dimension refers to a missing view.');const view=views.get(item.viewId);if(view.renderMode==='mechanical3d'&&view.projection!=='top')fail('Source-coordinate dimensions require a top mechanical view.');}
  }
  return doc;
 }
 function create(scope,title='Draftsman drawing'){return validate({schema:SCHEMA,source:source(scope),template:'modern',title,revision:'',company:'',units:'mm',precision:2,paper:'A4',orientation:'landscape',accent:'#245b78',fontSize:2.5,lineWidth:.25,pages:[{id:'sheet-1',title:'Drawing sheet',items:[]}]});}
 function serialize(doc){return JSON.stringify(validate(doc),null,2)+'\n';}
 function viewTransform(view,bounds){
  fields(bounds,['x','y','width','height']);number(bounds.x,-1e6,1e6);number(bounds.y,-1e6,1e6);number(bounds.width,1e-8,2e6);number(bounds.height,1e-8,2e6);
  if(![0,90,180,270].includes(view.rotation)||!['top','bottom'].includes(view.side))fail('Invalid view transform.');number(view.x,-2000,2000);number(view.y,-2000,2000);number(view.width,.001,2000);number(view.height,.001,2000);
  const rotated=view.rotation===90||view.rotation===270,scale=view.scale==='fit'?Math.min(view.width/(rotated?bounds.height:bounds.width),view.height/(rotated?bounds.width:bounds.height)):number(view.scale,.01,100),angle=view.rotation*Math.PI/180,c=Math.round(Math.cos(angle)),s=Math.round(Math.sin(angle)),mirror=view.side==='bottom'?-1:1,cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2,px=view.x+view.width/2,py=view.y+view.height/2;
  const a=scale*c*mirror,b=scale*s*mirror,cc=-scale*s,d=scale*c,e=px-a*cx-cc*cy,f=py-b*cx-d*cy,det=a*d-b*cc;
  const toPage=p=>({x:a*p.x+cc*p.y+e,y:b*p.x+d*p.y+f});const toWorld=p=>({x:(d*(p.x-e)-cc*(p.y-f))/det,y:(-b*(p.x-e)+a*(p.y-f))/det});
  return{toPage,toWorld,scale,matrix:[a,b,cc,d,e,f]};
 }
 function autoDimensions(view,bounds,options={}){const {x,y,width,height}=bounds;viewTransform(view,bounds);const offset=(options.offset===undefined?8:number(options.offset,-100,100))*(view.side==='bottom'?-1:1);return[{id:view.id+'-auto-width',type:'dimension',viewId:view.id,kind:'horizontal',a:{x,y:y+height},b:{x:x+width,y:y+height},offset},{id:view.id+'-auto-height',type:'dimension',viewId:view.id,kind:'vertical',a:{x:x+width,y},b:{x:x+width,y:y+height},offset:-offset}];}
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const n=value=>Number(value.toFixed(5));
 function svg(input,pageIndex=0,assets={}){
  const doc=validate(input),size=pageSize(doc);if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=doc.pages.length)fail('Invalid sheet number.');const page=doc.pages[pageIndex],views=new Map(page.items.filter(v=>v.type==='view').map(v=>[v.id,v])),warnings=[],chunks=[];let totalImage=0;
  const textNode=(x,y,value,extra='')=>`<text x="${n(x)}" y="${n(y)}" ${extra}>${escape(value)}</text>`;
  const lines=(value,width)=>{const limit=Math.max(4,Math.floor(width/(doc.fontSize*.53))),result=[];for(const paragraph of String(value).split('\n')){if(!paragraph){result.push('');continue;}let line='';for(const word of paragraph.split(/\s+/)){if(line&&line.length+word.length+1>limit){result.push(line);line='';}if(word.length>limit){if(line){result.push(line);line='';}for(let i=0;i<word.length;i+=limit)result.push(word.slice(i,i+limit));}else line+=(line?' ':'')+word;}if(line)result.push(line);}return result;};
  const checkPage=p=>{if(p.x<6||p.y<6||p.x>size.width-6||p.y>size.height-30)fail('A dimension or note extends outside the sheet drawing area.');};
  const path=(a,b,extra='')=>`<path d="M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}" ${extra}/>`;
  for(const item of page.items){
   if(item.type==='view'){
    const asset=assets[item.id],bounds=asset?.bounds;let drawing='';
    if(asset?.image!==undefined){if(typeof asset.image!=='string'||asset.image.length>12*1024*1024||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(asset.image))fail('View images must be bounded PNG data, never remote URLs.');totalImage+=asset.image.length;if(totalImage>24*1024*1024)fail('Sheet images exceed 24 MiB.');if(!bounds)fail('View image is missing its source bounds.');const transform=viewTransform(item,bounds);drawing=`<image x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.width)}" height="${n(bounds.height)}" preserveAspectRatio="none" transform="matrix(${transform.matrix.map(n).join(' ')})" href="${asset.image}"/>`;}
    else{drawing=`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="#f5f7f9" stroke="#c0c8d0" stroke-dasharray="2 2"/>`+textNode(item.x+3,item.y+7,'Source preview unavailable');warnings.push('Missing source preview: '+item.file);}
    if(asset?.warnings!==undefined){if(!Array.isArray(asset.warnings)||asset.warnings.length>100)fail('Invalid source rendering notes.');for(const warning of asset.warnings){text(warning,1000);warnings.push(warning);}}
    chunks.push(`<g data-item="${item.id}"><defs><clipPath id="clip-${page.id}-${item.id}"><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}"/></clipPath></defs><g clip-path="url(#clip-${page.id}-${item.id})">${drawing}</g>`+textNode(item.x+item.width/2,item.y+item.height+4,item.caption||`${item.file} · ${item.side}`,`text-anchor="middle"`)+`</g>`);
   }else if(item.type==='dimension'){
    const view=views.get(item.viewId),bounds=assets[item.viewId]?.bounds;if(!bounds)fail('Cannot dimension without verified source bounds.');const t=viewTransform(view,bounds),start=t.toPage(item.a),end=t.toPage(item.b),kind=item.kind;
    let a=start,b=end,value=Math.hypot(item.b.x-item.a.x,item.b.y-item.a.y);
    if(kind==='horizontal'){b=t.toPage({x:item.b.x,y:item.a.y});value=Math.abs(item.b.x-item.a.x);}else if(kind==='vertical'){b=t.toPage({x:item.a.x,y:item.b.y});value=Math.abs(item.b.y-item.a.y);}
    const length=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/length,uy=(b.y-a.y)/length,nx=-uy,ny=ux,da={x:a.x+nx*item.offset,y:a.y+ny*item.offset},db={x:b.x+nx*item.offset,y:b.y+ny*item.offset},middle={x:(da.x+db.x)/2,y:(da.y+db.y)/2};checkPage(da);checkPage(db);checkPage(middle);
    const arrow=(tip,direction)=>`<path d="M ${n(tip.x+ux*direction*2+nx*.7)} ${n(tip.y+uy*direction*2+ny*.7)} L ${n(tip.x)} ${n(tip.y)} L ${n(tip.x+ux*direction*2-nx*.7)} ${n(tip.y+uy*direction*2-ny*.7)}"/>`,label=`${(value/(doc.units==='in'?25.4:1)).toFixed(doc.precision)} ${doc.units}`,labelWidth=Math.max(10,label.length*doc.fontSize*.58),labelHeight=doc.fontSize*1.65;
    chunks.push(`<g data-item="${item.id}" fill="none" stroke="${doc.accent}" stroke-width="${doc.lineWidth}">`+path(start,{x:da.x+nx*2,y:da.y+ny*2})+path(end,{x:db.x+nx*2,y:db.y+ny*2})+path(da,db)+arrow(da,1)+arrow(db,-1)+`<rect x="${n(middle.x-labelWidth/2)}" y="${n(middle.y-labelHeight/2)}" width="${n(labelWidth)}" height="${n(labelHeight)}" fill="white" stroke="none"/>`+textNode(middle.x,middle.y+doc.fontSize*.35,label,`text-anchor="middle" fill="${doc.accent}" stroke="none"`)+`</g>`);
   }else if(item.type==='note'){
    const wrapped=lines(item.text,item.width);for(let i=0;i<wrapped.length;i++){const at={x:item.x,y:item.y+i*doc.fontSize*1.45};checkPage(at);chunks.push(textNode(at.x,at.y,wrapped[i],`data-item="${item.id}"`));}
   }else if(item.type==='bom'){
    const rowHeight=doc.fontSize*2.25,max=Math.max(0,Math.floor((size.height-37-item.y)/rowHeight)-1),rows=item.rows.slice(0,max),widths=[.25,.28,.37,.1].map(v=>item.width*v),labels=['Reference','Value','Footprint','Qty'];let x=item.x;
    chunks.push(`<g data-item="${item.id}"><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${n(rowHeight*(rows.length+1))}" fill="white" stroke="${doc.accent}" stroke-width="${doc.lineWidth}"/>`);
    for(let i=0;i<labels.length;i++){chunks.push(textNode(x+1,item.y+rowHeight*.7,labels[i],`font-weight="bold"`));x+=widths[i];}
    rows.forEach((row,index)=>{const y=item.y+rowHeight*(index+1);chunks.push(path({x:item.x,y},{x:item.x+item.width,y},`stroke="#b6c1ca" stroke-width=".15"`));let left=item.x;for(const [i,key]of ['reference','value','footprint','quantity'].entries()){const value=String(row[key]),cap=Math.max(2,Math.floor((widths[i]-2)/(doc.fontSize*.53))),label=value.length>cap?value.slice(0,cap-1)+'…':value;chunks.push(textNode(left+1,y+rowHeight*.7,label));left+=widths[i];}});chunks.push('</g>');if(rows.length<item.rows.length){const message=`${item.rows.length-rows.length} BoM rows not shown; add another BoM sheet.`;warnings.push(message);chunks.push(textNode(item.x,item.y+rowHeight*(rows.length+1)+3,message,`fill="#965b00" font-size="${doc.fontSize*.8}"`));}
   }
  }
  const sourceLabel=`${doc.source.provider} · ${doc.source.repository} @ ${doc.source.ref}`,hashes=Object.values(doc.source.hashes||{}),metadata=escape(JSON.stringify(doc.template==='kicad'?{schema:doc.schema,template:doc.template,source:doc.source,title:doc.title,company:doc.company,revision:doc.revision,sheet:page.title,files:page.items.filter(item=>item.type==='view').map(item=>item.file)}:{schema:doc.schema,source:doc.source}));
  function kicadWorksheet(){
   // Engineering-sheet styling only: source coordinates and the existing 8 mm drawing margin stay unchanged.
   const ink='#000000',right=size.width-8,bottom=size.height-8,left=right-150,top=size.height-28,small=Math.min(doc.fontSize,2.2),body=Math.min(doc.fontSize,2.4),titleSize=Math.min(doc.fontSize*1.15,2.7),zoneFont=Math.max(1.1,Math.min(1.6,doc.fontSize*.52));
   const fit=(value,width,font)=>{const normalized=String(value).replace(/\s+/g,' ').trim(),limit=Math.max(2,Math.floor(width/(font*.58)));return normalized.length>limit?normalized.slice(0,limit-1)+'…':normalized;};
   const label=(x,y,value,width,font=body,extra='')=>textNode(x,y,fit(value,width,font),`font-size="${n(font)}" ${extra}`);
   const stroke=`stroke="${ink}" stroke-width="${doc.lineWidth}"`,frame=[`<g data-worksheet="kicad" fill="none" ${stroke}><rect x="6" y="6" width="${size.width-12}" height="${size.height-12}"/><rect x="8" y="8" width="${size.width-16}" height="${size.height-16}"/>`],zones=[];
   const columns=Math.ceil((size.width-16)/50),rows=Math.ceil((size.height-16)/50),dx=(size.width-16)/columns,dy=(size.height-16)/rows;
   for(let i=1;i<columns;i++){const x=8+i*dx;frame.push(path({x,y:6},{x,y:8}),path({x,y:size.height-8},{x,y:size.height-6}));}
   for(let i=1;i<rows;i++){const y=8+i*dy;frame.push(path({x:6,y},{x:8,y}),path({x:size.width-8,y},{x:size.width-6,y}));}
   for(let i=0;i<columns;i++){const x=8+(i+.5)*dx;zones.push(textNode(x,7+zoneFont*.35,i+1,'text-anchor="middle"'),textNode(x,size.height-7+zoneFont*.35,i+1,'text-anchor="middle"'));}
   for(let i=0;i<rows;i++){const y=8+(i+.5)*dy+zoneFont*.35;zones.push(textNode(7,y,String.fromCharCode(65+i),'text-anchor="middle"'),textNode(size.width-7,y,String.fromCharCode(65+i),'text-anchor="middle"'));}
   frame.push('</g>',`<g data-worksheet-zones="true" fill="${ink}" font-size="${n(zoneFont)}">${zones.join('')}</g>`);
   const block=[`<g data-title-block="kicad"><rect x="${left}" y="${top}" width="150" height="20" fill="white" ${stroke}/>`];
   for(const y of [top+5,top+11,top+16])block.push(path({x:left,y},{x:right,y},stroke));
   block.push(path({x:left+84,y:top},{x:left+84,y:top+5},stroke),path({x:left+95,y:top+11},{x:left+95,y:top+16},stroke));
   for(const x of [left+25,left+50,left+110])block.push(path({x,y:top+16},{x,y:bottom},stroke));
   const files=page.items.filter(item=>item.type==='view').map(item=>item.file),fileName=files.length?(files[0].split('/').at(-1)+(files.length>1?` (+${files.length-1})`:'')):'—';
   block.push(`<g fill="${ink}" stroke="none">`,label(left+2,top+3.5,'Company: '+(doc.company||'—'),80,small),label(left+86,top+3.5,'File: '+fileName,62,small),label(left+2,top+9,'Title: '+(doc.title||'—'),146,titleSize,'font-weight="bold"'),label(left+2,top+14.5,'Sheet: '+(page.title||'—'),91,small),label(left+97,top+14.5,'Ref: '+doc.source.ref,51,small),label(left+2,top+18.8,'Size: '+doc.paper,21,small),label(left+27,top+18.8,'Units: '+doc.units,21,small),label(left+52,top+18.8,'Rev: '+(doc.revision||'—'),56,small),label(left+112,top+18.8,`Sheet ${pageIndex+1}/${doc.pages.length}`,36,small),'</g></g>');
   const traceWidth=left-12,traceFont=Math.min(doc.fontSize*.8,1.8),trace=`<g data-source-trace="kicad" fill="${ink}">${label(10,top+3,'KiCad Online · KiCad-style worksheet',traceWidth,traceFont)}${label(10,top+8,doc.source.provider+' · '+doc.source.repository,traceWidth,traceFont)}${label(10,top+13,'Source ref: '+doc.source.ref,traceWidth,traceFont)}${label(10,top+18,hashes.length?`${hashes.length} SHA-256 fingerprints · Raster views / vector dimensions`:'Source fingerprints unavailable · Raster views / vector dimensions',traceWidth,traceFont)}</g>`;
   return{frame:frame.join(''),footer:block.join('')+trace};
  }

  const footer=`<g fill="#263b49" stroke="none">${textNode(10,size.height-22,doc.title,`font-size="${doc.fontSize*1.35}" font-weight="bold"`)}${textNode(10,size.height-16,`${doc.company}${doc.company?' · ':''}${page.title}`)}${textNode(10,size.height-10,sourceLabel,`font-size="${doc.fontSize*.8}"`)}${textNode(size.width-10,size.height-22,`Rev ${doc.revision||'—'} · ${pageIndex+1}/${doc.pages.length}`,`text-anchor="end"`)}${textNode(size.width-10,size.height-16,`${doc.paper} · ${doc.units} · Raster views / vector dimensions`, `text-anchor="end" font-size="${doc.fontSize*.8}"`)}${textNode(size.width-10,size.height-10,hashes.length?`${hashes.length} source SHA-256 fingerprints retained`:'Source fingerprints unavailable',`text-anchor="end" font-size="${doc.fontSize*.8}"`)}</g>`;
  const notes=[...new Set(warnings)];let warningText='';if(notes.length)warningText=textNode(10,doc.template==='kicad'?11:8,`Rendering notes (${notes.length}): ${notes[0].slice(0,130)}${notes.length>1?' · See source rendering notes':''}`,`fill="#965b00" font-size="${doc.template==='kicad'?Math.min(doc.fontSize*.8,2):doc.fontSize*.8}"`);
  const worksheet=doc.template==='kicad'?kicadWorksheet():null,frame=worksheet?.frame||`<rect x="6" y="6" width="${size.width-12}" height="${size.height-12}" fill="none" stroke="${doc.accent}" stroke-width="${doc.lineWidth}"/><path d="M 6 ${size.height-28} H ${size.width-6}" stroke="${doc.accent}" stroke-width="${doc.lineWidth}"/>`;
  const description=doc.template==='kicad'?'KiCad-style worksheet template; custom .kicad_wks files are not interpreted. Raster views / vector dimensions. '+notes.join(' | '):notes.join(' | ');
  const result=`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}mm" height="${size.height}mm" viewBox="0 0 ${size.width} ${size.height}"><metadata>${metadata}</metadata><desc>${escape(description)}</desc><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" font-size="${doc.fontSize}" fill="#263b49">${frame}${chunks.join('')}${warningText}${worksheet?.footer||footer}</g></svg>`;
  if(bytes(result)>MAX_SVG)fail('Rendered sheet exceeds 32 MiB.');return result;
 }
 const api={SCHEMA,MAX_BYTES,papers,create,validate,serialize,pageSize,viewTransform,autoDimensions,svg};root.KiCadDraftsmanModel=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

;
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

;
/* Bundled parser worker: no repository requests, credentials or dynamic code. */
'use strict';

onmessage=event=>{
  try{
    const {job,payload}=event.data||{};let result;let transfers=[];
    if(job==='settings'){
      postMessage({stage:'Reading saved board settings…'});
      result=KiCadProjectSettings.parse(payload.content,{file:payload.file});
    }else if(job==='workspace-search'){
      result=KiCadWorkspaceSearch.buildRecords(payload);
    }else if(job==='drawing'){
      postMessage({stage:'Indexing saved project objects…'});
      const {files,rootFile,pcb}=payload,snapshot=KiCadDesignDiff.prepareProject(files,{forConnectivity:true,compactCopper:pcb}),model=KiCadDesignModel.buildProject(files,null,snapshot,{forConnectivity:true}),file=files.find(f=>f.path===rootFile);
      if(!file)throw Error('The requested drawing is absent.');
      postMessage({stage:'Building drawing geometry…'});
      const sheets=files.filter(f=>/\.(kicad_sch|sch)$/i.test(f.path));
      const design=(pcb?KiCadPCBRenderer:KiCadSchematicRenderer).build(KiCadDesignDiff.preparedFile(snapshot,rootFile),rootFile,{packedZones:pcb,textVariables:file.textVariables,sheetNumber:sheets.findIndex(f=>f.path===rootFile)+1,sheetCount:sheets.length,sheetName:'/',...(globalThis.KiCadFileCompatibility?.textContext?.(files,rootFile,{rootFile,parse:(content,file)=>KiCadDesignDiff.preparedFile(snapshot,file.path)})||{})});
      postMessage({stage:'Resolving saved connectivity…'});
      const nets=KiCadNetModel.build(files,new Map([[rootFile,design]]),snapshot);
      if(design.packedZones)transfers=[...new Set(design.primitives.flatMap(primitive=>primitive.zoneCoordinates?[primitive.zoneCoordinates.buffer]:[]))];
      result={model,rules:[...model._rules],design,nets};
    }else throw Error('Unknown preparation job.');
    postMessage({ok:true,result},transfers);
  }catch(error){postMessage({ok:false,error:error.message||'KiCad preparation failed.'});}
};
