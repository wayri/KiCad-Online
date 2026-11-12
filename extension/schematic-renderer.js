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
  const MAX_PRIMITIVES = 150000;
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
      let x = position.x, y = library ? -position.y : position.y;
      if (mirror === "x") y = -y;
      if (mirror === "y") x = -x;
      return { x: round(origin.x + x * c + y * s), y: round(origin.y - x * s + y * c) };
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
  function embeddedPNG(node,version){
    const parts=form(node,"data")?.slice(1).map(value);let length=0;
    if(!parts?.length||parts.some(part=>typeof part!=="string"||(length+=part.length)>Math.ceil(MAX_IMAGE_BYTES/3)*4))throw Error("Embedded PNG exceeds its 4 MiB limit or has invalid base64 data.");
    const encoded=parts.join("");if(encoded.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error("Embedded image is not base64 PNG data.");
    const binary=atob(encoded);if(binary.length>MAX_IMAGE_BYTES||btoa(binary)!==encoded)throw Error("Embedded PNG data is oversized or not canonical base64.");
    const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));if(bytes.length<45||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))throw Error("Embedded image is not a PNG.");
    const view=new DataView(bytes.buffer),read=at=>view.getUint32(at),chunkType=at=>String.fromCharCode(...bytes.subarray(at,at+4));let width=0,height=0,physicalX=null,ended=false,hasData=false,chunks=0;
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
      else if(type==="IEND"){if(size||end!==bytes.length||!hasData)throw Error("Embedded PNG end marker is invalid.");ended=true;}
      else if(["acTL","fcTL","fdAT","iCCP","zTXt","iTXt"].includes(type))throw Error("Animated PNGs and compressed image metadata are not supported in the bounded preview.");
      else if(type[0]===type[0].toUpperCase()&&type!=="PLTE")throw Error("Embedded PNG has an unsupported critical chunk.");
      at=end;
    }
    if(!ended)throw Error("Embedded PNG end marker is missing.");
    // KiCad parseImage preserves three saved-scale eras. PNG pHYs is pixels/m;
    // pre-20260623 wxWidgets resolution conversion truncated pixels/cm first.
    let ppi=300;if(physicalX!==null&&physicalX/100>1){const corrected=Math.round(physicalX*.0254),legacy=Math.floor(physicalX/100)>1?Math.round(Math.floor(physicalX/100)*2.54):corrected;ppi=version<=20230121?300:version<20260623?legacy:corrected;}
    if(!Number.isFinite(ppi)||ppi<1||ppi>1000000)throw Error("Embedded PNG resolution exceeds the preview limit.");
    return {dataUrl:"data:image/png;base64,"+encoded,pixelWidth:width,pixelHeight:height,ppi,bytes:bytes.length};
  }
  function pageSettings(ast, warn) {
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
    const page = pageSettings(rootAST, warn);
    function line(a, b, color, width, owner = {}) {
      if (a && b) emit({ type: "line", points: [a, b], color, width, ...owner });
    }
    function text(position, string, size, angle, color, owner = {}) {
      if (position && string !== undefined && string !== null && String(string)) {
        const parsed = overbarText(resolveText(string,owner));
        emit({ type: "text", x: position.x, y: position.y, text: parsed.text,
          ...((parsed.bars.length||String(string)!==parsed.text) ? { rawText: String(string) } : {}),
          size, angle: finite(angle) ? angle : 0, color, ...owner });
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
              line(map(x1,y), map(x2,y), color, owner.textThickness || 0.1524, { ...owner, kind: "text-overbar" });
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
      } else if (kind === "text_box") {
        if (isHidden(node)) return;
        const at = point(node, "at") || point(node, "start"), size = point(node, "size"), savedEnd = point(node, "end");
        const end = savedEnd || (at && size ? { x: at.x + size.x, y: at.y + size.y } : null);
        if (!at || !end || at.x === end.x || at.y === end.y) { warn("Text box without valid position/size was skipped."); return; }
        const textOwner={...owner};for(const key of ["color","sourceColor","lineStyle","fillColor"])delete textOwner[key];
        const left=Math.min(at.x,end.x),right=Math.max(at.x,end.x),top=Math.min(at.y,end.y),bottom=Math.max(at.y,end.y),sizeMM=fontSize(node),style=fontStyle(node),strokeWidth=scalar(form(node,"stroke"),"width"),border=!(finite(strokeWidth)&&strokeWidth<0);
        emit({type:"polygon",points:[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}].map(map),color,width,stroke:border,...(fill?{fill}:{}),...owner});
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
        const angle = value(form(node, "at")?.[3]) || 0;
        const origin = map(at), axis = map({ x: at.x + Math.cos(angle * Math.PI / 180), y: at.y + Math.sin(angle * Math.PI / 180) });
        text(origin, value(node[1]), fontSize(node), Math.atan2(axis.y - origin.y, axis.x - origin.x) * 180 / Math.PI, color,
          { ...owner, ...fontStyle(node) });
      } else warn(`Unsupported graphic ${kind} was skipped.`);
    }
    const library = form(rootAST, "lib_symbols"), definitions = new Map();
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
      const id = scalar(node, "lib_id") ?? value(node[1]);
      if (typeof id !== "string") { warn("Placed symbol without library ID was skipped."); return; }
      const unit = scalar(node, "unit") ?? 1, style = scalar(node, "convert") ?? 1;
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
      for (const body of units) for (const item of body) {
        if (!Array.isArray(item)) continue;
        const kind = typeOf(item);
        if (kind === "pin") renderPin(item, map, owner, mainDefinition || body);
        else if (["polyline", "rectangle", "circle", "arc", "bezier", "text", "text_box"].includes(kind)) drawGraphic(item, map, owner);
        else if (kind === "image") warn(`Symbol graphic ${kind} is not rendered.`);
      }
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
        text(position, string, fontSize(property), -propertyAngle, COLOR.symbol,
          { ...owner, kind: "property", property: value(property[1]), ...fontStyle(property) });
      }
    }
    function renderLabel(node, owner, kind = typeOf(node)) {
      if (isHidden(node)) return;
      const at = point(node, "at");
      if (!at) { warn(`${kind} without position was skipped.`); return; }
      const content = resolveText(value(node[1]),owner), size = fontSize(node), angle = value(form(node, "at")?.[3]) || 0;
      const shape = scalar(node, "shape") || (kind === "sheet-pin" ? value(node[2]) : "input");
      const style = fontStyle(node), color = kind === "global_label" ? COLOR.symbol : "#725600";
      const labelOwner = { ...owner, kind, connectPoint: at };
      const map = transform(at, angle);
      const known = ["input", "output", "bidirectional", "tri_state", "passive"];
      if (!known.includes(shape)) warn(`Unsupported ${kind} shape ${shape}; using passive outline.`);
      const input = ["input", "bidirectional", "tri_state"].includes(shape);
      const output = ["output", "bidirectional", "tri_state"].includes(shape);
      let positions, place, labelAngle = -angle;
      // Hierarchical labels and sheet pins use a fixed-size connector icon;
      // global labels enclose text, so their width follows the text metric.
      if (kind === "hierarchical_label" || kind === "sheet-pin") {
        const h = size / 2;
        if (input && output) positions = [{x:0,y:0},{x:h,y:-h},{x:size,y:0},{x:h,y:h}];
        else if (input) positions = [{x:0,y:0},{x:h,y:h},{x:size,y:h},{x:size,y:-h},{x:h,y:-h}];
        else if (output) positions = [{x:size,y:0},{x:h,y:-h},{x:0,y:-h},{x:0,y:h},{x:h,y:h}];
        else positions = [{x:0,y:-h},{x:size,y:-h},{x:size,y:h},{x:0,y:h}];
        place = map({x:size + 0.1905,y:0});
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
        text(position, value(property[2]), fontSize(property), value(form(property, "at")?.[3]) || 0,
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
        else text(at, value(node[1]), fontSize(node), -(value(form(node, "at")?.[3]) || 0),
          kind === "text" ? COLOR.text : COLOR.label, { ...owner, ...fontStyle(node) });
      } else if (kind === "bus_entry") {
        const at = point(node, "at"), size = point(node, "size");
        if (at && size) line(at, { x: at.x + size.x, y: at.y + size.y }, COLOR.bus, 0.3, owner);
      } else if (kind === "image") {
        try{
          const at=point(node,"at"),scale=scalar(node,"scale")??1,rotation=scalar(node,"rotate")??0,opacity=scalar(node,"opacity")??1;
          if(!at||!finite(scale)||scale<=0||!finite(rotation)||!finite(opacity)||opacity<0||opacity>1)throw Error("Embedded PNG has invalid position, scale, rotation or opacity.");
          if(imageCount>=16)throw Error("Schematic exceeds its 16-image preview limit.");
          const png=embeddedPNG(node,Number(scalar(rootAST,"version"))||20230121),pixels=png.pixelWidth*png.pixelHeight;
          if(imageBytes+png.bytes>MAX_TOTAL_IMAGE_BYTES||imagePixels+pixels>MAX_TOTAL_IMAGE_PIXELS)throw Error("Schematic exceeds its total 8 MiB / 16 megapixel image preview budget.");
          const width=png.pixelWidth*25.4/png.ppi*scale,height=png.pixelHeight*25.4/png.ppi*scale;if(!finite(width)||!finite(height)||width>100000||height>100000)throw Error("Embedded PNG physical size exceeds the preview limit.");
          const map=transform(at,rotation);emit({type:"image",dataUrl:png.dataUrl,pixelWidth:png.pixelWidth,pixelHeight:png.pixelHeight,points:[{x:-width/2,y:-height/2},{x:width/2,y:-height/2},{x:width/2,y:height/2},{x:-width/2,y:height/2}].map(map),opacity,...owner});imageBytes+=png.bytes;imagePixels+=pixels;imageCount++;
        }catch(error){warn("Schematic image was not rendered: "+error.message);}
      } else if (["embedded_files", "rule_area"].includes(kind)) {
        warn(`Schematic construct ${kind} is not rendered.`);
      }
    }
    return { primitives, page, warnings, compatibility };
  }
  root.KiCadSchematicRenderer = { build };
  if (typeof module === "object" && module.exports) module.exports = root.KiCadSchematicRenderer;
})(typeof globalThis === "object" ? globalThis : this);
