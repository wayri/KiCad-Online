/* Filename discovery only: selected contents are validated by the BoM importer. */
((root)=>{'use strict';
 const safe=p=>typeof p==='string'&&p.length<=1024&&!/[\\:?#\u0000-\u001f]/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
 const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 function distance(a,b){if(Math.abs(a.length-b.length)>2)return 3;let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];}
 function rank(files,current=''){
  const folder=current.slice(0,current.lastIndexOf('/')+1),stem=normalize(current.split('/').pop().replace(/\.[^.]+$/,'')),seen=new Set(),out=[];
  for(const entry of (Array.isArray(files)?files:[]).slice(0,20000)){
   const path=typeof entry==='string'?entry:entry?.path;if(!safe(path)||!/\.(csv|tsv)$/i.test(path)||seen.has(path))continue;seen.add(path);
   const name=path.split('/').pop().replace(/\.[^.]+$/,''),key=normalize(name).slice(0,160),tokens=name.toLowerCase().split(/[^a-z0-9]+/),same=path.slice(0,path.lastIndexOf('/')+1)===folder;
   let score=0,reason='CSV / TSV file';
   if(stem&&key===stem){score=90;reason='Matches drawing name';}
   if(/bom|billofmaterials/.test(key)){score=stem&&key.includes(stem)?100:80;reason='BoM filename';}
   else if(tokens.some(t=>['parts','partlist','partslist'].includes(t))){score=65;reason='Parts list filename';}
   else if(stem.length>=4&&key.length>=4&&distance(key,stem)<=2){score=60;reason='Similar drawing name';}
   else if(key.length<=5&&distance(key,'bom')<=1){score=55;reason='Similar BoM filename';}
   if(score&&same)score+=15;out.push({path,score,reason});
  }
  return out.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
 }
 function mount({document,holder,scope,inventory,url,onDrawing}){
  const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const bar=make('div'),label=make('label','Saved BoM '),select=make('select'),all=make('input'),allLabel=make('label','Show all CSV / TSV files '),open=make('button','Open BoM'),native=make('button','BoM from drawing'),notice=make('p'),stage=make('div');
  bar.className='bom-browser-tools';stage.className='bom-browser-stage';notice.setAttribute('role','status');select.setAttribute('aria-label','Saved BoM file');all.type='checkbox';allLabel.append(all);label.append(select);open.type=native.type='button';native.addEventListener('click',onDrawing);bar.append(label,open,allLabel,native);holder.replaceChildren(bar,notice,stage);holder.classList.add('bom-browser');
  let entries=[],loaded=false,promise=null,dead=false;
  function render(){const previous=select.value;select.replaceChildren();const placeholder=make('option','Choose a BoM file');placeholder.value='';select.append(placeholder);for(const item of entries.filter(e=>all.checked||e.score)){const option=make('option',item.path+' · '+item.reason);option.value=item.path;select.append(option);}select.value=previous;open.disabled=!select.value;}
  function openFile(){const item=entries.find(e=>e.path===select.value);if(!item)return;const frame=make('iframe');frame.title='BoM: '+item.path;frame.src=url('bom-viewer.html')+'?'+new URLSearchParams({...scope,file:item.path,embeddedBom:'1'});stage.replaceChildren(frame);notice.textContent='Saved file: '+item.path;}
  select.addEventListener('change',()=>{open.disabled=!select.value;});all.addEventListener('change',render);open.addEventListener('click',openFile);
  async function show(){if(loaded||promise)return promise;notice.textContent='Finding saved BoM files…';promise=(async()=>{try{const result=await inventory();if(dead)return;entries=rank(result.files,scope.file);loaded=true;render();const matches=entries.filter(e=>e.score);notice.textContent=(matches.length?'Choose a saved BoM file.':'No likely BoM filename found. Show all CSV files, import a file below, or use BoM from drawing.')+(result.warnings?.length?' '+result.warnings.join(' '):'');if(matches.length===1){select.value=matches[0].path;open.disabled=false;openFile();}else if(!matches.length){const frame=make('iframe');frame.title='Import BoM';frame.src=url('bom-viewer.html')+'?embeddedBom=1';stage.replaceChildren(frame);}}catch(error){if(!dead){notice.textContent='BoM discovery failed: '+error.message;const retry=make('button','Retry discovery');retry.addEventListener('click',()=>show());notice.append(retry);}}finally{promise=null;}})();return promise;}
  return {show,destroy(){dead=true;holder.replaceChildren();}};
 }
 root.KiCadBomBrowser={rank,mount};if(typeof module==='object'&&module.exports)module.exports=root.KiCadBomBrowser;
})(globalThis);
