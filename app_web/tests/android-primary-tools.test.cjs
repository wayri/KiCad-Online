const test=require('node:test'),assert=require('node:assert/strict');
const {prepareDrawingStrip}=require('../../android-app/web/android-design.js');
function fixture(){
 const nodes=new Map(),calls=[],bodyClasses=new Set(['android-rail-hidden']);let mutations=0;
 class Node{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.hidden=false;this.className='';this.classList={add:name=>{const values=new Set(this.className.split(' ').filter(Boolean));values.add(name);this.className=[...values].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(value=>value!==name).join(' ');}};}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  append(...children){for(const child of children){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(node=>node!==child);child.parentElement=this;this.children.push(child);mutations++;}}
  setAttribute(name,value){this.attributes[name]=value;}getAttribute(name){return this.attributes[name];}
  querySelector(selector){return this.children.find(node=>selector==='svg'?node.tagName==='SVG':node.className.split(' ').includes(selector.slice(1)))||null;}
  click(){if(!this.disabled)this.onclick?.();}
 }
 const create=(id,tag='div')=>{const node=new Node(tag);node.id=id;return node;};
 const rail=create('androidViewToolbar','nav');rail.className='android-drawing-rail';
 const content=create('toolsContent'),group=create('advancedTools'),toggle=create('androidRailToggle','button');
 const button=(id,label,parent=rail)=>{const node=create(id,'button');node.setAttribute('aria-label',label);node.onclick=()=>calls.push(id);parent.append(node);return node;};
 const search=button('search','Search'),inspect=button('androidRailProperties','Properties'),tools=button('more','More drawing tools'),fit=button('androidFitDrawing','Fit drawing',group),comments=button('comments','Comments');
 const doc={body:{classList:{remove:name=>bodyClasses.delete(name)}},getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),querySelector:selector=>selector==='#androidToolsSheet>.android-sheet-content'?content:selector==='#androidToolGroup-more>.android-tool-section-body'?group:null};
 return {doc,rail,group,toggle,search,inspect,tools,fit,comments,calls,nodes,bodyClasses,button,get mutations(){return mutations;}};
}
test('Search, Inspect, Fit and Tools are directly reachable and preserve existing actions',()=>{
 const f=fixture();assert.equal(prepareDrawingStrip(f.doc),true);
 assert.deepEqual(f.rail.children.map(node=>node.querySelector('.android-primary-caption').textContent),['Search','Inspect','Fit','Tools']);
 for(const button of f.rail.children){assert.equal(button.hidden,false);button.click();}
 assert.deepEqual(f.calls,['search','androidRailProperties','androidFitDrawing','more']);
 assert.equal(f.rail.children[0],f.search);assert.equal(f.rail.children[1],f.inspect);assert.equal(f.rail.children[3],f.tools);
 assert.equal(f.fit.hidden,true,'only the primary Fit action is visible');assert.equal(f.toggle.hidden,true);assert.equal(f.bodyClasses.has('android-rail-hidden'),false);
 assert.equal(f.comments.parentElement,f.group);assert.equal(f.comments.querySelector('.button-label').textContent,'Comments');f.comments.click();assert.equal(f.calls.at(-1),'comments');
});
test('settled refreshes do not move controls or duplicate captions; late tools retain their handlers',()=>{
 const f=fixture();prepareDrawingStrip(f.doc);const mutations=f.mutations;
 for(let index=0;index<20;index++)prepareDrawingStrip(f.doc);
 assert.equal(f.mutations,mutations,'no child-list changes when the observer refreshes');
 const late=f.button('late','Extra drawing action');prepareDrawingStrip(f.doc);assert.equal(late.parentElement,f.group);late.click();assert.equal(f.calls.at(-1),'late');
 assert.equal(f.rail.children.length,4);assert.equal(f.nodes.get('androidRailFit').children.length,1);
});
test('waits for the adaptive shell instead of replacing partially mounted controls',()=>{
 const f=fixture();f.nodes.delete('androidFitDrawing');const before=[...f.rail.children];assert.equal(prepareDrawingStrip(f.doc),false);assert.deepEqual(f.rail.children,before);assert.equal(f.toggle.hidden,false);
});

test('shared sidebar ownership does not cause reparenting loops',()=>{
 const f=fixture(),sidebar=f.button('phoneSidebarToggle','Show sidebar');prepareDrawingStrip(f.doc);
 const mutations=f.mutations;
 for(let index=0;index<20;index++)prepareDrawingStrip(f.doc);
 assert.equal(sidebar.parentElement,f.rail,'shared sidebar remains in its controller-owned toolbar');assert.equal(f.mutations,mutations);
});
