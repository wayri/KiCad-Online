const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),tools=require('../pdf-tools.js');
const original=fs.readFileSync(require.resolve('../pdf-viewer.js'),'utf8'),html=fs.readFileSync(require.resolve('../pdf-viewer.html'),'utf8');
const source=original.replace(/^import .*;\r?\n/m,'').replaceAll('import.meta.url',JSON.stringify('https://extension.test/pdf-viewer.js')).replace('export { openPDF };','globalThis.viewerTest={openPDF,clear,render,followDestination};');
const contents=value=>'PocketKiVi/1\n'+JSON.stringify(value),tick=()=>new Promise(setImmediate);

function setup({annotationPromise}={}){
 const ids={},events={},nodes=[];let focused=null;
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attributes={};this.hidden=false;this.value='';this.textContent='';this.className='';this.clientWidth=132;this.scrollTop=0;this.scrollLeft=0;this.handlers={};this.classList={toggle:(name,value)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));if(value)names.add(name);else names.delete(name);this.className=[...names].join(' ');},contains:name=>this.className.split(/\s+/).includes(name)};nodes.push(this);}
  append(...items){for(const item of items){if(item.tagName==='#FRAGMENT')this.append(...item.children);else{item.parentElement=this;this.children.push(item);}}}
  replaceChildren(...items){this.children=[];this.append(...items);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]||null;}
  getContext(){return {};}
  close(){this.open=false;}
  showModal(){this.open=true;}
  focus(){focused=this;}
  getBoundingClientRect(){return{left:10,top:10,right:30,bottom:30};}
  scrollIntoView(){this.scrolled=true;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  contains(target){return target===this||this.children.some(child=>child.contains?.(target));}
  closest(selector){return selector==='.pdf-hit'&&this.className.split(/\s+/).includes('pdf-hit')?this:this.parentElement?.closest?.(selector)||null;}
 }
 for(const [,id]of html.matchAll(/id="([^"]+)"/g))ids[id]=new Node(id==='canvas'?'canvas':'div');ids.pdfProperties.hidden=true;ids.pageSurface.hidden=true;
 const annotations=[{subtype:'Link',rect:[10,20,30,40],contentsObj:{str:contents({kind:'component',id:'part:1',reference:'R1',properties:{Value:'10k',Description:'<img src=x onerror=alert(1)>'}})}},{subtype:'Link',rect:[1,1,10,3],contents:contents({kind:'net',id:'net:1',name:'VCC',netclass:'Default',members:[{reference:'R1',pin:'1'}]})},{subtype:'Link',rect:[11,1,20,3],contents:contents({kind:'net',id:'net:1',name:'VCC'})},{subtype:'Link',rect:[1,50,10,60],dest:[1,{name:'XYZ'},10,50,null]},{subtype:'Link',rect:[20,50,30,60],url:'javascript:globalThis.scriptRan=true',actions:{Action:['globalThis.scriptRan=true']}}];
 const page=number=>({view:[0,0,100,200],getViewport:({scale,rotation})=>({width:(rotation%180?200:100)*scale,height:(rotation%180?100:200)*scale,convertToViewportRectangle:r=>rotation%180?[r[1]*scale,r[0]*scale,r[3]*scale,r[2]*scale]:[r[0]*scale,(200-r[1])*scale,r[2]*scale,(200-r[3])*scale],convertToViewportPoint:(x,y)=>[x*scale,(200-y)*scale]}),render:()=>({promise:Promise.resolve(),cancel(){}}),getAnnotations:()=>number===1?(annotationPromise||Promise.resolve(annotations)):Promise.resolve([]),getTextContent:async()=>({items:[{str:number===1?'R1 VCC':'U1 VCC',hasEOL:true}]})});
 const pdf={numPages:2,getPage:async number=>page(number),getOutline:async()=>[],getDestination:async()=>[1,{name:'XYZ'},10,50,null],getPageIndex:async()=>1,destroy:async()=>{}};
 const context={console,URL,URLSearchParams,Uint8Array,ArrayBuffer,TextEncoder,Map,Set,Promise,devicePixelRatio:2,innerWidth:800,innerHeight:600,location:{search:''},history:{back(){}},setTimeout,clearTimeout,KiCadPDFTools:tools,pdfjs:{GlobalWorkerOptions:{},AnnotationMode:{DISABLE:0},getDocument:()=>({promise:Promise.resolve(pdf),destroy:async()=>{}})},document:{getElementById:id=>ids[id],createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('#fragment'),addEventListener:(name,fn)=>events[name]=fn},addEventListener:(name,fn)=>events[name]=fn};context.window=context;vm.runInNewContext(source,context);
 return{ids,nodes,annotations,context,events,get focused(){return focused;},open:()=>context.viewerTest.openPDF(new TextEncoder().encode('%PDF-1.7\n'),'Project.pdf')};
}

test('component click and right-click show safe properties; nets highlight all matching regions',async()=>{
 const h=setup();await h.open();const hits=h.ids.interactionLayer.children;assert.equal(hits.length,4);assert.equal(h.ids.canvas.width,200);assert.equal(hits[0].style.left,'10px');assert.equal(hits[0].style.top,'160px');
 await hits[0].onclick({clientX:100,clientY:100});assert.equal(h.ids.pdfProperties.hidden,false);assert.equal(h.ids.pdfPropertiesTitle.textContent,'Component R1');assert.ok(h.ids.pdfPropertyRows.children.some(node=>node.textContent==='<img src=x onerror=alert(1)>'));assert.equal(h.nodes.some(node=>node.tagName==='IMG'),false);
 await hits[1].onclick({});assert.ok(hits[1].classList.contains('pdf-net-selected'));assert.ok(hits[2].classList.contains('pdf-net-selected'));assert.equal(h.ids.pdfProperties.hidden,true);
 let prevented=false;hits[1].oncontextmenu({preventDefault(){prevented=true;},stopPropagation(){},clientX:20,clientY:20});assert.equal(prevented,true);assert.equal(h.ids.pdfPropertiesTitle.textContent,'Net VCC');assert.equal(h.ids.pdfConnectedParts.children[0].textContent,'Connected parts');assert.equal(h.context.scriptRan,undefined);
 h.ids.closeProperties.onclick();assert.equal(h.ids.pdfProperties.hidden,true);assert.equal(h.focused,hits[1]);
});

test('internal links navigate pages, text search spans pages and close clears overlays/properties',async()=>{
 const h=setup();await h.open();await h.ids.interactionLayer.children[3].onclick({});assert.equal(h.ids.page.value,2);assert.equal(h.ids.interactionLayer.children.length,0);assert.equal(h.ids.viewport.scrollTop,110);
 h.ids.search.value='VCC';await h.ids.searchForm.onsubmit({preventDefault(){}});assert.equal(h.ids.matches.children.length,2);
 await h.context.viewerTest.clear();assert.equal(h.ids.pageSurface.hidden,true);assert.equal(h.ids.interactionLayer.children.length,0);assert.equal(h.ids.pdfPropertyRows.children.length,0);assert.equal(h.ids.followPDFLink.onclick,null);
});

test('rotation rebuilds CSS annotation geometry and stale async annotations cannot revive a closed PDF',async()=>{
 const h=setup();await h.open();h.ids.rotate.onclick();await tick();const rotated=h.ids.interactionLayer.children[0];assert.equal(rotated.style.left,'10px');assert.equal(rotated.style.top,'5px');
 let resolve;const pending=new Promise(r=>resolve=r),stale=setup({annotationPromise:pending}),opening=stale.open();await tick();await stale.context.viewerTest.clear();resolve(stale.annotations);await opening;assert.equal(stale.ids.interactionLayer.children.length,0);assert.equal(stale.ids.pageSurface.hidden,true);
});
