/* Safe, bounded chat presentation. Source text is never assigned to HTML. */
((root)=>{'use strict';
 const MAX_BODY_BYTES=65536,MAX_NODES=2000,MAX_BLOCKS=300,MAX_CONTEXTS=20;
 const fallback=typeof module==='object'&&module.exports?require('./review-comments.js'):null;
 function bounded(value){
  if(typeof value!=='string')return{text:'',truncated:false};
  const prefix=value.slice(0,MAX_BODY_BYTES),bytes=new TextEncoder().encode(prefix);
  return{text:bytes.length>MAX_BODY_BYTES?new TextDecoder().decode(bytes.subarray(0,MAX_BODY_BYTES)):prefix,truncated:value.length>prefix.length||bytes.length>MAX_BODY_BYTES};
 }
 function literalRanges(text){
  const ranges=[];let offset=0,fence=null;
  for(const line of text.split('\n')){
   const found=/^ {0,3}(`{3,}|~{3,})([^`~]*)$/.exec(line);
   if(fence){if(found&&found[1][0]===fence.mark&&found[1].length>=fence.length&&!found[2].trim()){ranges.push([fence.start,offset+line.length]);fence=null;}}
   else if(found)fence={mark:found[1][0],length:found[1].length,start:offset};
   else for(let i=0;i<line.length;i++)if(line[i]==='`'){
    let length=1;while(line[i+length]==='`')length++;
    const end=line.indexOf('`'.repeat(length),i+length);if(end>=0){ranges.push([offset+i,offset+end+length]);i=end+length-1;}else i+=length-1;
   }
   offset+=line.length+1;
  }
  if(fence)ranges.push([fence.start,text.length]);return ranges;
 }
 function content(value,options={}){
  const input=bounded(value),raw=input.text,api=options.comments||root.KiCadReviewComments||fallback;
  const anchors=[],attachments=[],severities=[],annotations=[],edits=[],seen=new Set(),ranges=literalRanges(raw),protectedAt=index=>ranges.some(([start,end])=>index>=start&&index<end);
  let invalidMetadata=false;
  const marker=/<!--\s*kicad-review:[\s\S]*?(?:-->|$)/g;
  for(const match of raw.matchAll(marker)){
   if(protectedAt(match.index))continue;
   let note;try{note=api?.fromMarkdown?.(match[0])?.[0];}catch{}
   if(note&&anchors.length<MAX_CONTEXTS){
    if(annotations.length<MAX_CONTEXTS)annotations.push(note);
    if(!severities.includes(note.severity))severities.push(note.severity);
    const key=JSON.stringify(note.anchor);if(!seen.has(key)){anchors.push(note.anchor);seen.add(key);}
    for(const attachment of note.attachments||[])if(attachments.length<MAX_CONTEXTS&&!attachments.some(existing=>existing.url===attachment.url))attachments.push(attachment);
   }else if(!note)invalidMetadata=true;
   let replaced=false;
   if(note&&api?.toMarkdown){
    let versions=[];try{versions=[...new Set(['compact','legacy'].flatMap(layout=>[api.toMarkdown(note,{layout}),api.toMarkdown(note,{layout,stateBadge:false}),api.toMarkdown(note,{layout,severityBadge:false})]))];}catch{}
    for(const canonical of versions){let index=raw.indexOf(canonical);while(index>=0&&protectedAt(index))index=raw.indexOf(canonical,index+1);
     if(index>=0&&index+canonical.length>=match.index+match[0].length&&!edits.some(edit=>index<edit.end&&index+canonical.length>edit.start)){
      edits.push({start:index,end:index+canonical.length,text:note.text});replaced=true;break;
     }
    }
   }
   if(!replaced&&!edits.some(edit=>match.index>=edit.start&&match.index<edit.end))edits.push({start:match.index,end:match.index+match[0].length,text:''});
  }
  let text=raw;for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  return{text:text.trim(),anchors,attachments,severities,annotations,truncated:input.truncated,invalidMetadata};
 }
 function safeUrl(value){
  if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f]/.test(value))return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
 }
 function render(doc,value,options={}){
  const parsed=content(value,options),container=doc.createElement('div');container.className='chat-rich-content';
  const budget={remaining:MAX_NODES,truncated:false};
  const node=(tag,className)=>{if(budget.remaining<=0){budget.truncated=true;return null;}budget.remaining--;const result=doc.createElement(tag);if(className)result.className=className;return result;};
  const text=(parent,value)=>{if(!value)return;if(budget.remaining<=0){budget.truncated=true;return;}budget.remaining--;parent.append(doc.createTextNode(value));};
  function link(parent,label,url,className){const valid=safeUrl(url);if(!valid)return false;const anchor=node('a',className);if(!anchor)return true;anchor.href=valid;anchor.target='_blank';anchor.rel='noopener noreferrer';text(anchor,label);parent.append(anchor);return true;}
  function inline(parent,source,depth=0){
   if(depth>=4||budget.remaining<=2){text(parent,source);return;}
   let plain='',i=0;const flush=()=>{text(parent,plain);plain='';};
   const find=(needle,start,limit)=>{const index=source.slice(start,start+limit).indexOf(needle);return index<0?-1:start+index;};
   while(i<source.length){
    if(budget.remaining<=2){plain+=source.slice(i);budget.truncated=true;break;}
    const ch=source[i];
    if(ch==='\\'&&i+1<source.length&&/[\\`*_{}\[\]()#+.!>~-]/.test(source[i+1])){plain+=source[i+1];i+=2;continue;}
    if(ch==='`'){
     let count=1;while(source[i+count]==='`')count++;
     const end=source.indexOf('`'.repeat(count),i+count);
     if(end>=0){flush();const code=node('code');if(code){text(code,source.slice(i+count,end));parent.append(code);}i=end+count;continue;}
     plain+=source.slice(i,i+count);i+=count;continue;
    }
    const image=ch==='!'&&source[i+1]==='[';
    if(ch==='['||image){
     const start=i+(image?2:1),labelEnd=find('](',start,502);
     if(labelEnd>=0&&labelEnd-start<=500){const end=find(')',labelEnd+2,2050);
      if(end>=0&&end-labelEnd<=2050){let target=source.slice(labelEnd+2,end);if(target.startsWith('<')&&target.endsWith('>'))target=target.slice(1,-1);
       if(safeUrl(target)){flush();const label=source.slice(start,labelEnd);link(parent,image?'Open image'+(label?': '+label:''):label,target,image?'chat-image-link':undefined);i=end+1;continue;}
      }
     }
    }
    if(ch==='*'||ch==='_'){
     const marker=source[i+1]===ch?ch+ch:ch,end=source.indexOf(marker,i+marker.length);
     if(end>i+marker.length&&!/\s/.test(source[i+marker.length])&&!/\s/.test(source[end-1])){flush();const emphasis=node(marker.length===2?'strong':'em');if(emphasis){inline(emphasis,source.slice(i+marker.length,end),depth+1);parent.append(emphasis);}i=end+marker.length;continue;}
    }
    if(ch==='@'&&(i===0||!/[A-Za-z0-9_./+@-]/.test(source[i-1]))){
     const pattern=options.provider==='gitlab'?/^@([A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,253}[A-Za-z0-9_])?)/:/^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/;
     const login=pattern.exec(source.slice(i));
     if(login&&!/[A-Za-z0-9_-]/.test(source[i+login[0].length]||'')){flush();const mention=node('span','chat-mention');if(mention){mention.setAttribute('data-mention',login[1]);text(mention,login[0]);parent.append(mention);}i+=login[0].length;continue;}
    }
    plain+=ch;i++;
   }
   flush();
  }
  const lines=parsed.text.replace(/\r\n?/g,'\n').split('\n');let i=0,blocks=0;
  const special=line=>/^\s*$/.test(line)||/^ {0,3}(?:`{3,}|~{3,}|>|[-+*]\s|\d{1,6}[.)]\s|#{1,6}\s)/.test(line);
  while(i<lines.length&&blocks<MAX_BLOCKS&&budget.remaining>3){
   if(!lines[i].trim()){i++;continue;}blocks++;
   const fence=/^ {0,3}(`{3,}|~{3,})([^`~]*)$/.exec(lines[i]);
   if(fence){const mark=fence[1][0],length=fence[1].length,body=[];i++;while(i<lines.length&&!new RegExp('^ {0,3}'+(mark==='`'?'`':'~')+'{'+length+',}\\s*$').test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;
    const pre=node('pre','chat-code-block'),code=node('code');if(pre&&code){text(code,body.join('\n'));pre.append(code);container.append(pre);}continue;
   }
   const bullet=/^ {0,3}([-+*]|\d{1,6}[.)])\s+(.*)$/.exec(lines[i]);
   if(bullet){const ordered=/^\d/.test(bullet[1]),list=node(ordered?'ol':'ul');if(!list)break;
    while(i<lines.length){const match=/^ {0,3}([-+*]|\d{1,6}[.)])\s+(.*)$/.exec(lines[i]);if(!match||/^\d/.test(match[1])!==ordered)break;
     const item=node('li');if(!item)break;let body=match[2];const task=/^\[([ xX])\]\s+(.*)$/.exec(body);
     if(task){item.className='chat-task-item';const check=node('span','chat-task-status');if(check){check.setAttribute('role','img');check.setAttribute('aria-label',task[1]===' '?'Not completed':'Completed');text(check,task[1]===' '?'☐':'☑');item.append(check);}body=task[2];}
     inline(item,body);list.append(item);i++;if(budget.remaining<=3)break;
    }
    container.append(list);continue;
   }
   if(/^ {0,3}>/.test(lines[i])){const quote=node('blockquote');if(!quote)break;const body=[];while(i<lines.length&&/^ {0,3}>/.test(lines[i]))body.push(lines[i++].replace(/^ {0,3}> ?/,''));inline(quote,body.join('\n'));container.append(quote);continue;}
   const heading=/^ {0,3}#{1,6}\s+(.+)$/.exec(lines[i]);
   if(heading){const title=node('p','chat-content-heading');if(title){inline(title,heading[1]);container.append(title);}i++;continue;}
   const paragraph=node('p');if(!paragraph)break;const body=[lines[i++]];while(i<lines.length&&!special(lines[i]))body.push(lines[i++]);inline(paragraph,body.join('\n'));container.append(paragraph);
  }
  if(parsed.truncated||budget.truncated||i<lines.length){const notice=doc.createElement('p');notice.className='chat-content-truncated';notice.textContent='Message shortened for display. Open the original thread to read the complete message.';container.append(notice);}
  return container;
 }
 const api={content,render,safeUrl,MAX_BODY_BYTES,MAX_NODES,MAX_BLOCKS};root.KiCadChatContent=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
