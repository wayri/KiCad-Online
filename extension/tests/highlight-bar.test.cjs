const test=require('node:test'),assert=require('node:assert/strict');
const {updateHighlights,setFitAvailability}=require('../workspace-chrome.js');
function fixture(){
 class Node{constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.hidden=false;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(key,value){this.attributes[key]=value;}click(){this.onclick?.();}}
 const holder=new Node('main'),options=new Node('button'),doc={createElement:tag=>new Node(tag),getElementById:id=>id==='reviewWorkspace'?holder:id==='reviewToolsButton'?options:null};return {doc,holder,options};
}
test('highlight bar derives names, safely displays text, routes actions and hides after clear',()=>{
 const {doc,holder,options}=fixture();let fitted=0,cleared=0,opened=0;options.onclick=()=>opened++;
 const state={nets:[{id:'a',name:'<VBUS>'},{id:'b',name:'GND'}],objectCount:1,canFit:true,fit:()=>fitted++,clear:()=>cleared++};
 const view=updateHighlights(doc,state);assert.equal(holder.children.length,1);assert.equal(view.bar.hidden,false);assert.equal(view.chips.children[0].textContent,'<VBUS>');assert.equal(view.chips.children[2].textContent,'1 object');
 view.fit.click();view.clear.click();view.settings.click();assert.deepEqual([fitted,cleared,opened],[1,1,1]);
 const chip=view.chips.children[0];assert.equal(updateHighlights(doc,{...state}),view);assert.equal(view.chips.children[0],chip,'unchanged refresh retains chip nodes');
 setFitAvailability(doc,false);assert.equal(view.fit.disabled,true);setFitAvailability(doc,true);assert.equal(view.fit.disabled,false);assert.equal(view.chips.children[0],chip);
 updateHighlights(doc,{nets:[],objectCount:0,canFit:false});assert.equal(view.bar.hidden,true);assert.equal(view.fit.disabled,true);assert.equal(holder.children.length,1);
});
test('updates replace obsolete names and action callbacks without creating duplicate bars',()=>{
 const {doc}=fixture();const view=updateHighlights(doc,{nets:[{id:1,name:'OLD'}],canFit:true});let count=0;
 updateHighlights(doc,{nets:[{id:2,name:'NEW'}],objectCount:2,canFit:true,fit:()=>count++});view.fit.click();assert.equal(count,1);assert.deepEqual(view.chips.children.map(n=>n.textContent),['NEW','2 objects']);
 assert.equal(updateHighlights({getElementById:()=>null},{}),null);
});

test('highlight controls reserve a toolbar row instead of covering the drawing',()=>{
 const {doc,holder}=fixture(),toolbar={children:[],append(node){this.children.push(node);}},get=doc.getElementById;
 doc.getElementById=id=>id==='frameControls'?toolbar:get(id);
 const view=updateHighlights(doc,{nets:[{id:1,name:'ST09_OUT'}],canFit:true});assert.equal(toolbar.children[0],view.bar);assert.equal(holder.children.length,0);assert.equal(view.fit.textContent,'Fit highlights');assert.equal(view.clear.textContent,'Clear highlights');
});
