const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function host(){
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.id='';this.classList={add(){}};this.namespaceURI='http://www.w3.org/2000/svg';this._text='';}
  get childElementCount(){return this.children.length;}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  set textContent(value){this._text=value;this.children=[];}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name]??null;}
  hasAttribute(name){return name in this.attributes;}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  prepend(n){n.parent=this;this.children.unshift(n);}
  replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
  replaceWith(n){const i=this.parent.children.indexOf(this);n.parent=this.parent;this.parent.children[i]=n;}
  matches(selector){return selector==='[data-icon]'?!!this.dataset.icon:selector===this.tagName.toLowerCase();}
  querySelectorAll(selector){const result=[];for(const n of this.children){if(selector==='[data-icon]'?n.dataset.icon:selector==='.button-label'?n.className==='button-label':n.tagName===selector.toUpperCase())result.push(n);result.push(...n.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 let ready;
 const document={readyState:'loading',createElement:tag=>new Node(tag),createElementNS:(ns,tag)=>new Node(tag),head:new Node('head'),body:new Node('body'),getElementById:()=>null,addEventListener:(event,fn)=>{ready=fn;},querySelectorAll:selector=>document.body.querySelectorAll(selector)};
 const root={document,MutationObserver:class{observe(){}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../ui-icons.js'),'utf8'),root);
 return{document,api:root.KiCadUIIcons,start:()=>ready()};
}

test('engineering menu actions retain their accessible names and click handlers',()=>{
 const{document,api,start}=host();
 for(const label of ['Engineering calculators','PDF viewer','Gerber viewer & analyzer','Calculate','Show all','Hide all','Run analysis','Export JSON','BoM manager']){
  const button=document.createElement('button');button.textContent=label;button.onclick=()=>label;document.body.append(button);
 }
 start();
 for(const button of document.body.children){assert.ok(button.querySelector('svg'));assert.equal(button.getAttribute('aria-label'),button.onclick());assert.equal(button.title,button.onclick());assert.ok(button.querySelector('.button-label').textContent);}
 assert.equal(document.body.children[0].dataset.icon,'calculator');assert.equal(document.body.children[4].dataset.icon,'eye');assert.equal(document.body.children[5].dataset.icon,'eye-off');
});

test('explicit visibility icons update without replacing button labels or handlers',()=>{
 const{document,api}=host(),button=document.createElement('button');button.textContent='Show DRC markers';button.dataset.icon='eye';button.onclick=()=>42;document.body.append(button);api.decorate(button);
 const label=button.querySelector('.button-label'),visible=button.querySelector('path').getAttribute('d');
 button.dataset.icon='eye-off';api.decorate(button);
 assert.notEqual(button.querySelector('path').getAttribute('d'),visible);assert.equal(button.querySelector('.button-label'),label);assert.equal(button.onclick(),42);assert.equal(button.getAttribute('aria-label'),'Show DRC markers');assert.equal(button.querySelectorAll('svg').length,1);
});

test('rich rows and preexisting custom SVGs survive decoration',()=>{
 const{document,api,start}=host(),rich=document.createElement('button');rich.textContent='Calculate';const input=document.createElement('input');rich.append(input);document.body.append(rich);
 const custom=document.createElement('button'),svg=document.createElementNS('', 'svg');custom.dataset.icon='drc';custom.append(svg);document.body.append(custom);
 start();api.decorate(document);assert.equal(rich.children[0],input);assert.equal(custom.children[0],svg);
});

test('dedicated tool, rule and visibility paths do not fall back to parts',()=>{
 const{paths}=require('../ui-icons.js');for(const name of ['calculator','pdf','erc','drc','eye','eye-off','tools']){assert.ok(paths[name]);assert.notEqual(paths[name],paths.parts);}
 assert.notEqual(paths.erc,paths.drc);assert.notEqual(paths.eye,paths['eye-off']);
});


test('viewer entrypoints resolve every explicit icon and distinct viewport actions keep distinct glyphs',()=>{
 const{paths}=require('../ui-icons.js');
 for(const file of ['schematic-viewer.html','pcb-viewer.html','project-viewer.html','revision-viewer.html']){
  const html=fs.readFileSync(require.resolve('../'+file),'utf8');
  for(const [,name]of html.matchAll(/data-icon="([^"]+)"/g))assert.ok(paths[name]||['github','gitlab'].includes(name),`${file}: missing ${name}`);
 }
 const names=['maximize','restore','fit','page','sheets','parts','inspect','comment','ruler','grid','flip','fast-pi','draftsman','download','tools'];
 assert.equal(new Set(names.map(name=>paths[name])).size,names.length);
});

test('explorer, properties, variables, layers and probes use distinct semantic toolbar icons',()=>{
 const{document,api,start}=host();
 const roles=[['partsButton','Explorer','parts','explorer'],['propertiesButton','Inspect','inspect','inspect'],['schematicVariablesButton','Variables','inspect','variables'],['mainLayerBrowser','Layers',null,'layers'],['netQuickViews','Probe views','net-instances','probe'],['openTestpoints','Testpoints & nets','inspect','testpoints'],['openEngineeringTools','Engineering tools','gear','tools']];
 for(const[id,label,oldIcon]of roles){const button=document.createElement('button');button.id=id;button.textContent=label;if(oldIcon)button.dataset.icon=oldIcon;button.onclick=()=>id;document.body.append(button);}
 start();api.decorate(document);
 for(const [index,[id,label,,expected]]of roles.entries()){const button=document.body.children[index];assert.equal(button.dataset.icon,expected,id);assert.equal(button.onclick(),id);assert.equal(button.getAttribute('aria-label'),label);assert.equal(button.querySelectorAll('svg').length,1);}
 const{paths}=require('../ui-icons.js');const names=roles.map(row=>row[3]);assert.equal(new Set(names.map(name=>paths[name])).size,names.length);
});

test('floating controls and probe actions have dedicated glyphs without losing navigation names',()=>{
 const{document,start}=host();
 for(const label of ['Float','Dock','Detach','Layers','Probe layers','Probe views','Open probe','Variables']){const b=document.createElement('button');b.textContent=label;document.body.append(b);}start();
 assert.deepEqual(document.body.children.map(b=>b.dataset.icon),['detach','dock','detach','layers','layers','probe','probe','variables']);
 const{paths}=require('../ui-icons.js');assert.notEqual(paths.detach,paths.dock);assert.notEqual(paths.probe,paths.layers);assert.notEqual(paths.variables,paths.inspect);
});

test('comment navigation shares the standard back, forward and home glyphs',()=>{
 const{document,start}=host();for(const[id,label]of [['commentBack','‹'],['commentForward','›'],['commentHome','Home']]){const button=document.createElement('button');button.id=id;button.textContent=label;button.setAttribute('aria-label',id);document.body.append(button);}start();
 assert.deepEqual(document.body.children.map(button=>button.dataset.icon),['back','forward','home']);for(const button of document.body.children)assert.equal(button.getAttribute('aria-label'),button.id);
});
