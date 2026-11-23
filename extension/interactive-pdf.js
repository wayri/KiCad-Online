/* Offline vector plot of the saved KiCad drawing model, in source millimetres. */
((root) => {
  'use strict';
  const MM = 72 / 25.4, MAX_BYTES = 32 * 1024 * 1024;
  const encoder = new TextEncoder();
  const fail = message => { throw new Error('Interactive PDF: ' + message); };
  const requireSize = (size, max, name) => { if (size > max) fail(name + ' limit exceeded (' + max + ').'); };
  const list = (items, limit, name) => {
    if (!Array.isArray(items)) fail('Expected ' + name + '.');
    requireSize(items.length, limit, name);
    return items;
  };
  function number(value) {
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) fail('Invalid drawing coordinate.');
    return String(+value.toFixed(5));
  }
  const hex = value => value.toString(16).padStart(4, '0');
  function unicode(text, bom = true) {
    requireSize(text.length, 64000, 'PDF string length');
    let data = bom ? 'FEFF' : '';
    for (let i = 0; i < text.length; i++) data += hex(text.charCodeAt(i));
    return data;
  }
  const pdfString = text => '<' + unicode(text) + '>';
  const ref = id => id + ' 0 R';
  const refs = ids => ids.map(ref).join(' ');

  // Streams retain binary data. Offsets and stream lengths always count bytes.
  class Document {
    constructor() { this.objects = [null]; this.bytes = 0; }
    reserve() { this.objects.push(null); return this.objects.length - 1; }
    set(id, ...chunks) {
      chunks = chunks.map(chunk => typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      for (const chunk of chunks) this.bytes += chunk.length;
      requireSize(this.bytes, MAX_BYTES, '32 MiB output');
      this.objects[id] = chunks;
      return id;
    }
    object(value) { return this.set(this.reserve(), value); }
    stream(data, extra = '') {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      return this.set(this.reserve(), '<< /Length ' + bytes.length + ' ' + extra + ' >>\nstream\n', bytes, '\nendstream');
    }
    finish(catalog, info) {
      const chunks = [], offsets = [0];
      let position = 0;
      const append = chunk => {
        const data = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
        position += data.length; requireSize(position, MAX_BYTES, '32 MiB output'); chunks.push(data);
      };
      append('%PDF-1.7\n%'); append(Uint8Array.of(226, 227, 207, 211, 10));
      for (let i = 1; i < this.objects.length; i++) {
        offsets.push(position); append(i + ' 0 obj\n');
        for (const chunk of this.objects[i]) append(chunk);
        append('\nendobj\n');
      }
      const start = position;
      append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
      append(offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join(''));
      append('trailer\n<< /Size ' + offsets.length + ' /Root ' + ref(catalog) + ' /Info ' + ref(info) + ' >>\nstartxref\n' + start + '\n%%EOF\n');
      const result = new Uint8Array(position);
      let cursor = 0;
      for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
      return result;
    }
  }

  // The shipped Liberation Sans TrueType has Unicode cmap format 4. Support a
  // format 12 table as well, so one CID can map to a full supplementary scalar.
  function readFont(input) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > 4e6) fail('Invalid bundled TrueType font.');
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function table(offset, length) {
      if (offset < 0 || offset + length > bytes.length) fail('Truncated TrueType font.');
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, length);
      return {u16: n => view.getUint16(n), i16: n => view.getInt16(n), u32: n => view.getUint32(n), length};
    }
    try {
      if (data.getUint32(0) !== 0x10000) fail('Expected a TrueType font.');
      const tables = new Map(), count = data.getUint16(4);
      requireSize(count, 128, 'TrueType table count');
      for (let i = 0; i < count; i++) {
        const n = 12 + 16 * i, tag = String.fromCharCode(...bytes.subarray(n, n + 4));
        const offset = data.getUint32(n + 8), length = data.getUint32(n + 12);
        tables.set(tag, {offset, ...table(offset, length)});
      }
      const get = name => tables.get(name) || fail('Missing TrueType table ' + name + '.');
      const head = get('head'), hhea = get('hhea'), widths = get('hmtx'), cmap = get('cmap');
      const units = head.u16(18), glyphs = get('maxp').u16(4), metrics = hhea.u16(34);
      if (!units || !glyphs || !metrics || metrics > glyphs || widths.length < 4 * metrics) fail('Invalid TrueType metrics.');
      const lookup = [];
      requireSize(cmap.u16(2), 128, 'TrueType character map count');
      for (let i = 0; i < cmap.u16(2); i++) {
        const n = 4 + 8 * i, platform = cmap.u16(n), encoding = cmap.u16(n + 2), offset = cmap.u32(n + 4);
        if (platform !== 0 && !(platform === 3 && [1,10].includes(encoding))) continue;
        const format = cmap.u16(offset);
        if (format !== 4 && format !== 12) continue;
        const length = format === 12 ? cmap.u32(offset + 4) : cmap.u16(offset + 2);
        if (offset + length > cmap.length) fail('Truncated TrueType character map.');
        if (lookup.some(entry => entry.format === format)) continue;
        const map = table(cmap.offset + offset, length);
        const segments = format === 12 ? map.u32(12) : map.u16(6) / 2;
        if (!Number.isInteger(segments) || !segments ||
          (format === 12 ? 16 + 12 * segments : 16 + 8 * segments) > length) fail('Invalid TrueType character map.');
        lookup.push({format, find(code) {
          if (format === 4 && code > 65535) return 0;
          let low = 0, high = segments;
          while (low < high) {
            const mid = (low + high) >>> 1;
            const end = format === 12 ? map.u32(20 + 12 * mid) : map.u16(14 + 2 * mid);
            if (end < code) low = mid + 1; else high = mid;
          }
          if (low === segments) return 0;
          if (format === 12) {
            const start = map.u32(16 + 12 * low);
            return code < start ? 0 : map.u32(24 + 12 * low) + code - start;
          }
          const start = map.u16(16 + 2 * segments + 2 * low);
          if (code < start) return 0;
          const delta = map.i16(16 + 4 * segments + 2 * low), at = 16 + 6 * segments + 2 * low, range = map.u16(at);
          if (!range) return (code + delta) & 65535;
          const glyph = map.u16(at + range + 2 * (code - start));
          return glyph ? (glyph + delta) & 65535 : 0;
        }});
      }
      if (!lookup.length) fail('No supported Unicode TrueType character map.');
      lookup.sort((a,b) => b.format - a.format);
      const scale = n => Math.round(1000 * n / units);
      return {bytes, ascent:scale(hhea.i16(4)), descent:scale(hhea.i16(6)), box:[36,38,40,42].map(n => scale(head.i16(n))),
        glyph(code) {
          for (const map of lookup) {
            const glyph = map.find(code);
            if (glyph > 0 && glyph < glyphs) return glyph;
          }
          return 0;
        }, width: glyph => scale(widths.u16(4 * Math.min(metrics - 1, glyph)))};
    } catch (error) { if (error instanceof RangeError) fail('Truncated TrueType font tables.'); throw error; }
  }

  class TextFont {
    constructor(bytes) { this.source = readFont(bytes); this.chars = new Map(); }
    shape(text) {
      let encoded = '', advance = 0;
      for (const char of text) {
        let value = this.chars.get(char);
        if (!value) {
          const glyph = this.source.glyph(char.codePointAt(0)), cid = this.chars.size + 1;
          requireSize(cid, 65535, 'Font character count');
          value = {cid, glyph, width:this.source.width(glyph)}; this.chars.set(char, value);
        }
        encoded += hex(value.cid); advance += value.width;
      }
      return {encoded, em:advance / 1000};
    }
    embed(doc) {
      const f = this.source, file = doc.stream(f.bytes, '/Length1 ' + f.bytes.length);
      const descriptor = doc.object('<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /ItalicAngle 0 /StemV 80 /CapHeight ' +
        f.ascent + ' /Ascent ' + f.ascent + ' /Descent ' + f.descent + ' /FontBBox [' + f.box.join(' ') + '] /FontFile2 ' + ref(file) + ' >>');
      const charset = [...this.chars.entries()], mapping = new Uint8Array(2 * (1 + charset.length)), widths = [];
      const cmap = ['/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PocketKiViUnicode def\n/CMapType 2 def',
        '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange'];
      for (let pos = 0; pos < charset.length; pos += 100) {
        const batch = charset.slice(pos, pos + 100); cmap.push(batch.length + ' beginbfchar');
        for (const [char, {cid, glyph, width}] of batch) {
          mapping[2 * cid] = glyph >> 8; mapping[2 * cid + 1] = glyph & 255; widths.push(width);
          cmap.push('<' + hex(cid) + '> <' + unicode(char, false) + '>');
        }
        cmap.push('endbfchar');
      }
      cmap.push('endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend');
      const cid = doc.object('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' +
        ref(descriptor) + ' /CIDToGIDMap ' + ref(doc.stream(mapping)) + (widths.length ? ' /W [1 [' + widths.join(' ') + ']]' : '') + ' >>');
      return doc.object('<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /Identity-H /DescendantFonts [' +
        ref(cid) + '] /ToUnicode ' + ref(doc.stream(cmap.join('\n'))) + ' >>');
    }
  }

  const xy = point => number(point.x) + ' ' + number(point.y);
  function include(box, point, pad = 0) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) fail('Invalid drawing point.');
    box[0] = Math.min(box[0], point.x-pad); box[1] = Math.min(box[1], point.y-pad);
    box[2] = Math.max(box[2], point.x+pad); box[3] = Math.max(box[3], point.y+pad);
  }
  const around = (p, radius) => [p.x-radius,p.y-radius,p.x+radius,p.y+radius];
  const emptyBox = () => [Infinity,Infinity,-Infinity,-Infinity];
  function arc(p) {
    if (p.type !== 'arc') return {x:p.x,y:p.y,r:p.r,start:0,sweep:2*Math.PI};
    const {start:a, mid:b, end:c} = p;
    const bx=b.x-a.x, by=b.y-a.y, cx=c.x-a.x, cy=c.y-a.y, det=2*(bx*cy-by*cx);
    if (Math.abs(det) < 1e-12) return null;
    const bb=bx*bx+by*by, cc=cx*cx+cy*cy, ox=(cy*bb-by*cc)/det, oy=(bx*cc-cx*bb)/det;
    const angle=(x,y)=>Math.atan2(y-oy,x-ox), start=angle(0,0), turn=n=>(n+2*Math.PI)%(2*Math.PI);
    let sweep=turn(angle(cx,cy)-start);
    if (turn(angle(bx,by)-start)>sweep) sweep-=2*Math.PI;
    return {x:a.x+ox,y:a.y+oy,r:Math.hypot(ox,oy),start,sweep};
  }
  function drawText(p, font, put, box) {
    const text = String(p.text ?? ''); requireSize(text.length, 32000, 'Drawing text');
    const height=p.fontHeight||p.size||1.27, size=height*4/3, scale=(p.fontWidth||height)/height*(p.mirrored?-1:1);
    const angle=(p.angle||0)*Math.PI/180, co=Math.cos(angle), si=Math.sin(angle), lines=text.split('\n');
    const ascent=font.source.ascent*size/1000, descent=font.source.descent*size/1000;
    const baseline={top:ascent,bottom:descent,alphabetic:0}[p.baseline] ?? (ascent+descent)/2;
    const world=(x,y)=>({x:p.x+co*x-si*y,y:p.y+si*x+co*y});
    for (let i=0;i<lines.length;i++) {
      const {encoded,em}=font.shape(lines[i]), width=em*size*scale;
      const x=p.align==='left'?0:p.align==='right'?-width:-width/2;
      const y=baseline+(i-(lines.length-1)/2)*height*(p.lineSpacing||1.5), origin=world(x,y);
      for(const dx of [x,x+width]) for(const dy of [y-ascent,y-descent]) include(box,world(dx,dy));
      // The page CTM is y-down. Reflect the font's y-axis to keep glyphs upright.
      const shear=p.italic ? .21 : 0;
      const matrix=[co*scale,si*scale,si+co*shear*scale,-co+si*shear*scale,origin.x,origin.y];
      put('BT /F ' + number(size) + ' Tf ' + (p.bold?'2 Tr '+number(size*.025)+' w ':'') +
        matrix.map(number).join(' ') + ' Tm <' + encoded + '> Tj ET');
    }
  }
  function colorOf(raw) {
    if (/^#[0-9a-f]{6}$/i.test(raw)) return [...[1,3,5].map(i=>parseInt(raw.slice(i,i+2),16)/255),1];
    const match=/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(raw);
    if(match) return [...match.slice(1,4).map(x=>Math.min(255,Number(x))/255),Number(match[4]??1)];
    fail('Unsupported drawing color ' + String(raw).slice(0,60) + '.');
  }

  function render(page, font, doc, state) {
    const {design}=page, {width,height}=design.page || {};
    if (!(width>0&&height>0&&width*MM<=14400&&height*MM<=14400)) fail('Invalid or oversized sheet dimensions.');
    const operators=[], boxes=new Map(), owners=new Map(), byUuid=new Map(), hiddenIds=new Set(), pinVisibility=new Map();
    const layers=page.visibleLayers==null?null:new Set(list(page.visibleLayers,1024,'visible layers'));
    let bytes=0;
    const put=s=>{bytes+=s.length+1; requireSize(doc.bytes+bytes,MAX_BYTES,'32 MiB output'); operators.push(s);};
    put('q '+[MM,0,0,-MM,0,height*MM].map(number).join(' ')+' cm 1 J 1 j');
    for(const p of design.primitives) {
      const hidden=p.hidden||(!p.frame&&p.layer&&layers&&!layers.has(p.layer));
      if(p.kind==='pin'&&p.uuid&&p.pinNumber!=null){
        const key=JSON.stringify([p.uuid,String(p.pinNumber)]);
        pinVisibility.set(key,Boolean(pinVisibility.get(key)||!hidden));
      }
      if(hidden){
        if(p.uuid)hiddenIds.add(p.uuid);
        if(p.ownerUuid)hiddenIds.add(p.ownerUuid);
        continue;
      }
      if(!p.fill&&p.stroke===false)continue;
      const box=emptyBox(), color=colorOf(p.hole?'#ffffff':p.color||'#819baa'), rgb=color.slice(0,3).map(number).join(' ');
      const opacity=number(Math.max(0,Math.min(1,(p.opacity??1)*color[3])));
      let alpha='';
      if(opacity!=='1'){
        if(!state.alpha.has(opacity)){
          requireSize(state.alpha.size+1,256,'distinct opacity values');
          state.alpha.set(opacity,{name:'GS'+state.alpha.size,id:doc.object('<< /Type /ExtGState /CA '+opacity+' /ca '+opacity+' >>')});
        }
        alpha='/'+state.alpha.get(opacity).name+' gs ';
      }
      const stroke=p.stroke!==false&&!p.hole, fill=p.fill||p.hole, pad=stroke?(p.width||.15)/2:0;
      put('q '+alpha+rgb+' RG '+(p.fill==='background'?'1 1 1':rgb)+' rg '+number(2*pad)+' w');
      if(p.type==='text')drawText(p,font,put,box);
      else {
        const curved=p.type==='arc'||p.type==='circle'||(p.type==='pad'&&p.r);
        const curve=curved?arc(p):null;
        if(curve){
          const {x,y,r,start,sweep}=curve, count=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/2))), step=sweep/count;
          const at=t=>({x:x+r*Math.cos(t),y:y+r*Math.sin(t)});
          put(xy(at(start))+' m'); include(box,at(start),pad);
          for(let i=0;i<count;i++){
            const a=start+step*i,b=a+step,k=4/3*Math.tan(step/4)*r,pa=at(a),pb=at(b);
            put(xy({x:pa.x-k*Math.sin(a),y:pa.y+k*Math.cos(a)})+' '+xy({x:pb.x+k*Math.sin(b),y:pb.y-k*Math.cos(b)})+' '+xy(pb)+' c');
            include(box,pb,pad);
          }
          for(let i=0;i<4;i++){
            const t=i*Math.PI/2, delta=((sweep<0?start-t:t-start)+4*Math.PI)%(2*Math.PI);
            if(delta<=Math.abs(sweep))include(box,at(t),pad);
          }
          if(p.type!=='arc')put('h');
        }else{
          if(!['arc','line','polyline','polygon','pad'].includes(p.type))fail('Unsupported drawing primitive '+String(p.type).slice(0,60)+'.');
          const points=p.type==='arc'?[p.start,p.end]:list(p.points,100000,'points per primitive');
          state.points+=points.length;requireSize(state.points,1000000,'drawing points');
          if(!points.length)fail('Empty drawing primitive.');
          for(let i=0;i<points.length;i++){include(box,points[i],pad);put(xy(points[i])+(i?' l':' m'));}
          if(p.type==='polygon'||p.type==='pad')put('h');
        }
        put(fill?(stroke?'B':'f'):(stroke?'S':'n'));
      }
      put('Q'); boxes.set(p,box);
      if(p.uuid){if(!byUuid.has(p.uuid))byUuid.set(p.uuid,[]);byUuid.get(p.uuid).push(p);}
      for(const id of new Set([p.uuid,p.ownerUuid])){
        if(!id)continue;
        if(!owners.has(id))owners.set(id,emptyBox());
        const group=owners.get(id);include(group,{x:box[0],y:box[1]});include(group,{x:box[2],y:box[3]});
      }
    }
    put('Q');
    return {page,width,height,boxes,owners,byUuid,hiddenIds,pinVisibility,content:doc.stream(operators.join('\n')),id:doc.reserve(),annots:[],bookmarks:[]};
  }

  function field(value) {
    if(value==null)return '';
    if(!['string','number','boolean'].includes(typeof value))fail('Expected a text property.');
    const text=String(value);requireSize(text.length,16000,'property text');return text;
  }
  function metadataText(value,limit=512){
    const text=field(value);
    requireSize(text.length,limit,'interactive property length');
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))fail('Unsupported control character in an interactive property.');
    return text;
  }
  function properties(input) {
    const output=Object.create(null);
    let size=0,count=0;
    for(const name in input)if(Object.hasOwn(input,name)){
      requireSize(++count,128,'component properties');
      if(!name||['__proto__','constructor','prototype'].includes(name))fail('Unsupported interactive property name.');
      const text=metadataText(input[name],2000);size+=name.length+text.length;
      requireSize(size,32000,'component property text');output[metadataText(name,128)]=text;
    }
    return output;
  }
  const pointValid=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
  function pdfRect(sheet,box) {
    const [x1,y1,x2,y2]=box;
    if(x2<0||x1>sheet.width||y2<0||y1>sheet.height)return null;
    return [MM*Math.max(0,x1),MM*(sheet.height-Math.min(sheet.height,y2)),
      MM*Math.min(sheet.width,x2),MM*(sheet.height-Math.max(0,y1))].map(number);
  }
  const dest=(sheet,rect)=>'['+ref(sheet.id)+' /XYZ '+rect[0]+' '+rect[3]+' null]';
  function contents(doc,metadata) {
    const text='PocketKiVi/1\n'+JSON.stringify(metadata);
    requireSize(text.length,32768,'interactive annotation metadata');
    return doc.object(pdfString(text));
  }
  function annotation(doc,sheet,rect,meta,action,state){
    requireSize(++state.annotations,20000,'20,000 annotations');
    const body='<< /Type /Annot /Subtype /Link /Rect ['+rect.join(' ')+'] /Border [0 0 0] /H /N /P '+
      ref(sheet.id)+(meta?' /Contents '+ref(meta):'')+' '+action+' >>';
    sheet.annots.push(doc.object(body));
  }
  function components(doc,sheet,state) {
    for(const object of list(sheet.page.objects||[],100000,'page objects')){
      state.work();
      if(object.kind&&!['symbol','footprint','component','sheet'].includes(object.kind))continue;
      let box=object.uuid&&sheet.owners.get(object.uuid);
      if(!box&&sheet.hiddenIds.has(object.uuid))continue;
      if(!box&&pointValid(object.position))box=around(object.position,1.5);
      if(!box){state.warn(sheet.page.path+': no plotted position for component '+field(object.reference||object.id)+'.');continue;}
      const rect=pdfRect(sheet,box);
      if(!rect){state.warn(sheet.page.path+': component '+field(object.reference||object.id)+' lies outside the paper.');continue;}
      if(object.kind==='sheet'){
        const path=object.targetPath||state.resolveSheetTarget?.(object),target=state.pages.get(path);
        if(target)annotation(doc,sheet,rect,null,'/Dest ['+ref(target.id)+' /Fit]',state);
        else state.warn(sheet.page.path+': sheet target '+field(object.properties?.Sheetfile||object.id)+' has no resolved PDF page.');
        continue;
      }
      const props=properties(object.properties||{}), reference=metadataText(object.reference||props.Reference||object.id);
      const data={kind:'component',id:metadataText(object.id||object.uuid),path:sheet.page.path,reference,properties:props};
      if(!data.id)fail('Missing component ID.');
      // Native Acrobat reads literal menu captions. All design strings stay in JSON
      // string literals and the menu has no commands, URLs or document writes.
      const menu=[reference,...Object.entries(props).map(([key,value])=>key+': '+value)].map(cName=>({cName,bEnabled:false}));
      const literal=JSON.stringify(menu).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
      const script='app.popUpMenuEx.apply(app,'+literal+');';
      const action=doc.object('<< /S /JavaScript /JS '+pdfString(script)+' >>');
      annotation(doc,sheet,rect,contents(doc,data),'/A '+ref(action),state);
      sheet.bookmarks.push({title:reference,dest:dest(sheet,rect)});
    }
  }

  // Keep wire hit regions narrow even for a long diagonal. Copper zones have a
  // single small boundary anchor, so a zone cannot intercept its entire board.
  function netRects(sheet,net,state){
    const rectangles=[],seen=new Set(),visited=new Set(),foundIds=new Set();
    const add=box=>{
      const rect=pdfRect(sheet,box);if(!rect)return;
      const key=rect.join(' ');if(seen.has(key))return;
      requireSize(state.pendingRects+1,20000,'20,000 annotations');
      state.pendingRects++;seen.add(key);rectangles.push(rect);
    };
    const line=(a,b,pad)=>{
      const dx=b.x-a.x,dy=b.y-a.y,parts=Math.max(1,Math.ceil(Math.min(Math.abs(dx),Math.abs(dy))/2.5));
      requireSize(parts,20000,'diagonal wire hit regions');
      for(let i=0;i<parts;i++){
        state.work();
        const box=emptyBox();include(box,{x:a.x+dx*i/parts,y:a.y+dy*i/parts},pad);
        include(box,{x:a.x+dx*(i+1)/parts,y:a.y+dy*(i+1)/parts},pad);add(box);
      }
    };
    function addPrimitive(p){
      state.work();
      if(visited.has(p)||!sheet.boxes.has(p)||p.frame||p.hole)return;
      visited.add(p);const box=sheet.boxes.get(p);
      if(p.uuid)foundIds.add(p.uuid);
      const pad=Math.min(1,Math.max(.45,(p.width||0)/2));
      if(['line','polyline'].includes(p.type)){
        for(let i=1;i<p.points.length;i++)line(p.points[i-1],p.points[i],pad);
      }else if(p.type==='arc'){
        const curve=arc(p);
        if(!curve){line(p.start,p.end,pad);return;}
        const count=Math.max(1,Math.ceil(Math.abs(curve.r*curve.sweep)/2.5));
        requireSize(count,20000,'curved wire hit regions');
        let current=p.start;
        for(let i=1;i<=count;i++){
          const t=curve.start+curve.sweep*i/count,next={x:curve.x+curve.r*Math.cos(t),y:curve.y+curve.r*Math.sin(t)};
          line(current,next,pad);current=next;
        }
      }else if(p.kind==='zone'||p.kind==='zone-outline'){
        if(p.points?.length)add(around(p.points[0],.7));
      }else if(p.type==='pad'||p.kind==='via'){
        const center={x:(box[0]+box[2])/2,y:(box[1]+box[3])/2};
        add(around(center,Math.min(2,Math.max(.45,Math.min(box[2]-box[0],box[3]-box[1])/2))));
      }else if(p.type==='text'||p.type==='circle')add(box);
    }
    for(const source of list(net.primitives||[],100000,'net primitives')){
      state.work();
      if(sheet.boxes.has(source)){addPrimitive(source);continue;}
      // Separately prepared models may retain only the source identity. Match
      // pin numbers as well; many schematic pins share their symbol's UUID.
      for(const p of sheet.byUuid.get(source.uuid)||[]){
        state.work();
        if(p.kind===source.kind&&(source.pinNumber==null||p.pinNumber===source.pinNumber))addPrimitive(p);
      }
    }
    const members=[];
    let memberBytes=0,full=false;
    for(const member of list(net.members||[],20000,'net members')){
      state.work();
      const record={};
      for(const key of ['uuid','reference','kind','pin','pad'])if(member[key]!=null)record[key]=metadataText(member[key]);
      if(pointValid(member.position)){
        record.position={x:member.position.x,y:member.position.y};
        // For schematic pins prefer the exact conductive endpoint over a symbol hit area.
        const hiddenSource=sheet.hiddenIds.has(member.uuid)&&!sheet.byUuid.has(member.uuid);
        const hiddenPin=member.kind==='pin'&&sheet.pinVisibility.get(JSON.stringify([member.uuid,String(member.pin)]))===false;
        if(!hiddenSource&&!hiddenPin&&(!foundIds.has(member.uuid)||member.kind==='pin'))add(around(record.position,.55));
      }
      memberBytes+=JSON.stringify(record).length+1;
      // Leave room for escaped header fields and the visible membership summary.
      if(memberBytes>28000||members.length===256)full=true;
      if(!full)members.push(record);
    }
    return {rectangles,members};
  }
  function linkNets(doc,sheets,state){
    const entries=[],byId=new Map(),byGlobal=new Map();
    // Union only explicit global labels and pre-resolved hierarchy memberships.
    // A local label of the same spelling on another sheet is electrically distinct.
    const parents=[];
    function find(index){while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}return index;}
    const join=(a,b)=>{parents[find(b)]=find(a);};
    state.pendingRects=state.annotations;
    for(const sheet of sheets)for(const net of list(sheet.page.nets||[],100000,'page nets')){
      state.work();
      const key=metadataText(net.id),index=entries.length;
      if(!key||byId.has(key))fail('Missing or duplicate net ID: '+key);
      const {rectangles,members}=netRects(sheet,net,state);
      if(!rectangles.length)state.warn(sheet.page.path+': no visible position for net '+field(net.displayName||net.name||net.id)+'.');
      const data={kind:'net',id:key,path:sheet.page.path,name:metadataText(net.displayName||net.name||net.id),
        netclass:metadataText(Array.isArray(net.netclass)?list(net.netclass,128,'net classes').map(field).join(', '):net.netclass),members};
      if(members.length<(net.members||[]).length){
        data.memberCount=net.members.length;
        data.properties={Members:net.members.length+' source members. Showing the first '+members.length+' in the property menu.'};
        state.warn(sheet.page.path+': '+data.name+' has '+data.properties.Members);
      }
      const meta=rectangles.length?contents(doc,data):null;
      entries.push({sheet,net,rectangles,meta});byId.set(key,index);parents.push(index);
      for(const name of list(net.globalNames||[],1024,'global names')){
        state.work();if(!name||net.kind!=='schematic')continue;
        const label=field(name);if(byGlobal.has(label))join(byGlobal.get(label),index);else byGlobal.set(label,index);
      }
    }
    for(const [index,{net}] of entries.entries())for(const id of list(net.relatedIds||[],20000,'related net IDs')){
      state.work();if(byId.has(id))join(index,byId.get(id));
    }
    const groups=new Map();
    for(const [index,entry] of entries.entries())if(entry.rectangles.length){
      const id=find(index);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(entry);
    }
    for(const group of groups.values())for(const [index,entry] of group.entries()){
      const {sheet,rectangles,meta}=entry, next=group[(index+1)%group.length];
      for(const [i,rect] of rectangles.entries()){
        const target=group.length>1?next.rectangles[0]:rectangles[(i+1)%rectangles.length];
        annotation(doc,sheet,rect,meta,'/Dest '+dest(next.sheet,target),state);
      }
    }
  }
  function outlines(doc,sheets){
    const rootId=doc.reserve();
    const pageMarks=sheets.map(sheet=>({title:sheet.page.path,dest:'['+ref(sheet.id)+' /Fit]',children:sheet.bookmarks}));
    function siblings(nodes,parent){
      const ids=nodes.map(()=>doc.reserve());
      for(const [i,node] of nodes.entries()){
        let children='';
        if(node.children?.length){
          const group=siblings(node.children,ids[i]);
          children=' /First '+ref(group[0])+' /Last '+ref(group.at(-1))+' /Count -'+group.length;
        }
        doc.set(ids[i],'<< /Title '+pdfString(node.title)+' /Parent '+ref(parent)+' /Dest '+node.dest+
          (i?' /Prev '+ref(ids[i-1]):'')+(i+1<ids.length?' /Next '+ref(ids[i+1]):'')+children+' >>');
      }
      return ids;
    }
    const top=siblings(pageMarks,rootId);
    doc.set(rootId,'<< /Type /Outlines /First '+ref(top[0])+' /Last '+ref(top.at(-1))+' /Count '+top.length+' >>');
    return rootId;
  }
  function create(pages,{fontBytes,onWarning,resolveSheetTarget=root.KiCadReviewWorkspace?.sheetTarget}={}){
    list(pages,64,'64-page');if(!pages.length)fail('Choose at least one sheet or board.');
    let count=0,work=0,warnSize=0;
    const paths=new Set(),warnings=new Set();
    const state={points:0,annotations:0,alpha:new Map(),work(){requireSize(++work,2000000,'annotation work');},
      warn(message){
        if(warnings.has(message))return;
        warnSize+=message.length+1;requireSize(warnSize,60000,'plot diagnostics');
        warnings.add(message);if(onWarning)onWarning(message);
      }};
    for(const page of pages){
      if(!page?.path||typeof page.path!=='string'||paths.has(page.path))fail('Expected unique source page paths.');
      metadataText(page.path);paths.add(page.path);
      count+=list(page.design?.primitives,100000,'100,000 primitives').length;
      requireSize(count,100000,'100,000 primitives');
      for(const warning of list(page.design.warnings||[],5000,'renderer warnings'))state.warn(page.path+': '+field(warning));
    }
    const font=new TextFont(fontBytes),doc=new Document(),catalog=doc.reserve(),tree=doc.reserve();
    const sheets=pages.map(page=>render(page,font,doc,state));
    state.resolveSheetTarget=resolveSheetTarget;state.pages=new Map(sheets.map(sheet=>[sheet.page.path,sheet]));
    for(const sheet of sheets)components(doc,sheet,state);
    linkNets(doc,sheets,state);
    for(const [char,entry] of font.chars)if(!entry.glyph)state.warn('The bundled font has no glyph for U+'+char.codePointAt(0).toString(16).toUpperCase()+'. Its Unicode text is retained.');
    const fontId=font.embed(doc);
    const resources=doc.object('<< /Font << /F '+ref(fontId)+' >> /ExtGState << '+
      [...state.alpha.values()].map(g=>'/'+g.name+' '+ref(g.id)).join(' ')+' >> >>');
    for(const sheet of sheets)doc.set(sheet.id,'<< /Type /Page /Parent '+ref(tree)+' /MediaBox [0 0 '+number(sheet.width*MM)+' '+number(sheet.height*MM)+
      '] /Resources '+ref(resources)+' /Contents '+ref(sheet.content)+' /Annots ['+refs(sheet.annots)+'] >>');
    doc.set(tree,'<< /Type /Pages /Count '+sheets.length+' /Kids ['+refs(sheets.map(s=>s.id))+'] >>');
    const labels=doc.object('<< /Nums ['+sheets.map((s,i)=>i+' << /P '+pdfString(s.page.path)+' >>').join(' ')+'] >>');
    doc.set(catalog,'<< /Type /Catalog /Pages '+ref(tree)+' /Outlines '+ref(outlines(doc,sheets))+' /PageLabels '+ref(labels)+' >>');
    const info=doc.object('<< /Producer (Pocket KiVi) /Title (Interactive project drawings)'+
      (warnings.size?' /Subject '+pdfString([...warnings].join('\n')):'')+' >>');
    return doc.finish(catalog,info);
  }
  const api=Object.freeze({create});
  root.KiCadInteractivePDF=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
