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
