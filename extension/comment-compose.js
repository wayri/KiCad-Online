"use strict";

// Composer helpers only: no credentials, repository requests or publication.
const KiCadCommentCompose = (() => {
  const githubLogin = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const gitlabLogin = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/;
  const loginPattern = provider => provider === 'gitlab' ? gitlabLogin : githubLogin;

  function titleFromText(text) {
    return String(text || '').split(/[\r\n]/, 1)[0].trim().slice(0,160);
  }

  function withoutCode(text) {
    // Keep character positions so suggestions and insertion use textarea offsets.
    return text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?:\n|$)|$)/g, value => ' '.repeat(value.length))
      .replace(/`+[^`\n]*(?:`+|(?=\n|$))/g, value => ' '.repeat(value.length));
  }

  function mentionAt(text, cursor) {
    if (typeof text !== 'string' || !Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
    const clean = withoutCode(text), match = clean.slice(0,cursor).match(/(?:^|\s)@([A-Za-z0-9_.-]{0,255})$/);
    if (!match) return null;
    const start = cursor - match[1].length - 1;
    let end = cursor;
    while (end < clean.length && /[A-Za-z0-9_.-]/.test(clean[end])) end++;
    // An address following an @ fragment is not a user mention.
    if (clean[end] === '@') return null;
    return { start, end, query:match[1] };
  }

  function insertMention(text, cursor, login) {
    if (typeof login !== 'string' || !gitlabLogin.test(login)) throw new Error('Invalid mention username.');
    const token = mentionAt(text,cursor);
    if (!token) return { text, cursor };
    const replacement = '@' + login + ' ', rest = text.slice(token.end);
    // Reuse an existing separating space, preserving the remaining comment.
    const suffix = rest.startsWith(' ') ? rest.slice(1) : rest;
    return { text:text.slice(0,token.start) + replacement + suffix, cursor:token.start + replacement.length };
  }

  function extractMentions(text, provider = 'github') {
    const result = [], seen = new Set(), clean = withoutCode(String(text || ''));
    for (const match of clean.matchAll(/(?:^|\s)@([A-Za-z0-9_.-]+)(?![A-Za-z0-9_.@-])/g)) {
      const login = match[1].replace(/\.+$/, '');
      if (!loginPattern(provider).test(login) || seen.has(login.toLowerCase())) continue;
      result.push(login); seen.add(login.toLowerCase());
      if (result.length === 20) break;
    }
    return result;
  }

  function tagAt(text,cursor) {
    if(typeof text!=='string'||!Number.isInteger(cursor)||cursor<0||cursor>text.length)return null;
    const clean=withoutCode(text),match=clean.slice(0,cursor).match(/(?:^|\s)#([A-Za-z][A-Za-z0-9_-]{0,39}|)$/);
    if(!match)return null;
    const start=cursor-match[1].length-1;let end=cursor;
    while(end<clean.length&&/[A-Za-z0-9_-]/.test(clean[end]))end++;
    if(end-start>41||/[/.@]/.test(clean[end]||''))return null;
    return {start,end,query:match[1]};
  }
  function autocompleteAt(text,cursor) {
    const mention=mentionAt(text,cursor);if(mention)return {...mention,kind:'mention'};
    const tag=tagAt(text,cursor);return tag?{...tag,kind:'tag'}:null;
  }
  function insertTag(text,cursor,tag) {
    if(typeof tag!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(tag))throw Error('Invalid tag.');
    const token=tagAt(text,cursor);if(!token)return {text,cursor};
    const replacement='#'+tag+' ',rest=text.slice(token.end);
    return {text:text.slice(0,token.start)+replacement+(rest.startsWith(' ')?rest.slice(1):rest),cursor:token.start+replacement.length};
  }
  function rankSuggestions(items,query,kind='mention') {
    const term=String(query||'').toLowerCase().slice(0,255),seen=new Set();
    return (Array.isArray(items)?items:[]).slice(0,500).flatMap((item,index)=>{
      const row=typeof item==='string'?(kind==='tag'?{name:item}:{login:item}):item;
      if(!row||typeof row!=='object')return [];
      const key=kind==='tag'?row.name:row.login;
      if(typeof key!=='string'||!(kind==='tag'?/^[A-Za-z][A-Za-z0-9_-]{0,39}$/:gitlabLogin).test(key)||seen.has(key.toLowerCase()))return [];
      seen.add(key.toLowerCase());const value=key.toLowerCase(),name=String(row.name||'').toLowerCase();
      const score=!term?0:value===term?0:value.startsWith(term)?1:name.split(/\s+/).some(word=>word.startsWith(term))?2:value.includes(term)?3:name.includes(term)?4:99;
      return score===99?[]:[{row,index,score}];
    }).sort((a,b)=>a.score-b.score||a.index-b.index).slice(0,12).map(entry=>entry.row);
  }

  async function normalizeCapture(blob, {decode = value => globalThis.createImageBitmap(value), createCanvas = (width,height) => {
    const canvas = globalThis.document.createElement('canvas'); canvas.width=width; canvas.height=height; return canvas;
  }} = {}) {
    if (!blob || !['image/png','image/jpeg','image/webp'].includes(blob.type) ||
      !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > 8 * 1024 * 1024 || typeof blob.arrayBuffer !== 'function') {
      throw new Error('Paste a PNG, JPEG or WebP screenshot no larger than 8 MiB.');
    }
    let image, canvas;
    try {
      image = await decode(blob);
      if (!image || ![image.width,image.height].every(value => Number.isSafeInteger(value) && value >= 1) || image.width * image.height > 40000000) {
        throw new Error('Screenshot dimensions exceed the 40 megapixel limit.');
      }
      const scale = Math.min(1,1024 / image.width,1024 / image.height);
      let width = Math.max(1,Math.floor(image.width*scale)), height = Math.max(1,Math.floor(image.height*scale));
      canvas = createCanvas(width,height);
      for (let attempt=0; attempt<8; attempt++) {
        canvas.width=width; canvas.height=height;
        const context=canvas.getContext('2d');
        if (!context) throw new Error('Screenshot canvas is unavailable.');
        context.imageSmoothingEnabled=true; context.imageSmoothingQuality='high';
        context.drawImage(image,0,0,width,height);
        const dataUrl=canvas.toDataURL('image/png');
        if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(dataUrl)) throw new Error('Screenshot could not be converted to PNG.');
        if (dataUrl.length <= 262144) return {mime:'image/png',dataUrl,width,height};
        if (width === 1 && height === 1) break;
        width=Math.max(1,Math.floor(width*0.75)); height=Math.max(1,Math.floor(height*0.75));
      }
      throw new Error('Screenshot is too large to attach. Paste a smaller area.');
    } finally {
      try { if (image && typeof image.close === 'function') image.close(); }
      finally { if (canvas) { canvas.width=0; canvas.height=0; } }
    }
  }
  function createNavigation(limit=40){
    const clean=route=>{if(!route||!['catalog','thread','compose'].includes(route.page))throw Error('Invalid comment route.');const value={page:route.page,category:['issue','discussion','all'].includes(route.category)?route.category:'all'};if(route.page==='thread'){if(!['issue','discussion'].includes(route.kind)||!Number.isSafeInteger(route.number)||route.number<1)throw Error('Invalid conversation route.');Object.assign(value,{kind:route.kind,number:route.number});}return value;};
    let routes=[clean({page:'catalog'})],index=0;
    const current=()=>({...routes[index]});
    return {current,push(route){const value=clean(route);if(JSON.stringify(value)===JSON.stringify(routes[index]))return current();routes=routes.slice(0,index+1);routes.push(value);if(routes.length>limit)routes.shift();index=routes.length-1;return current();},back(){if(index>0)index--;return current();},forward(){if(index<routes.length-1)index++;return current();},canBack:()=>index>0,canForward:()=>index<routes.length-1,reset(){routes=[clean({page:'catalog'})];index=0;return current();}};
  }
  return {titleFromText,mentionAt,insertMention,extractMentions,tagAt,autocompleteAt,insertTag,rankSuggestions,normalizeCapture,createNavigation};
})();
if (typeof globalThis === 'object') globalThis.KiCadCommentCompose=KiCadCommentCompose;
if (typeof module === 'object' && module.exports) module.exports=KiCadCommentCompose;
