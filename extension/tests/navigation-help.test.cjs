const test=require('node:test');
const assert=require('node:assert/strict');
const {mountNavigationHelp}=require('../review-workspace.js');
class Element {
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.listeners={};this.open=false;this.hidden=true;}
 append(...nodes){for(const n of nodes){n.remove();n.parent=this;this.children.push(n);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
 setAttribute(k,v){this.attributes[k]=v;}
 querySelector(tag){return this.children.find(n=>n.tagName===tag);}
 addEventListener(k,fn){this.listeners[k]=fn;}
 removeEventListener(k){delete this.listeners[k];}
 focus(){this.ownerDocument.activeElement=this;}
 showModal(){this.open=true;this.modal=true;}
 close(){this.open=false;this.listeners.close?.({});}
 getBoundingClientRect(){return {left:10,right:100,top:10,bottom:100};}
}
function fixture(){const doc={createElement(tag){return new Element(tag,this);}};doc.body=doc.createElement('body');const toolbar=doc.createElement('header'),content=doc.createElement('details'),summary=doc.createElement('summary');content.append(summary,doc.createElement('p'));doc.body.append(toolbar,content);return {doc,toolbar,content};}
test('help lives in a modal from the top toolbar, with keyboard and close return focus',()=>{
 const {doc,toolbar,content}=fixture(),help=mountNavigationHelp(doc,toolbar,content),trigger=toolbar.children[0],dialog=doc.body.children.find(n=>n.tagName==='dialog'),close=dialog.children[0].children[1];
 assert.equal(content.parent,dialog);assert.equal(content.querySelector('summary'),undefined);assert.equal(content.hidden,false);assert.equal(trigger.attributes['aria-haspopup'],'dialog');assert.equal(dialog.open,false);
 trigger.onclick();assert.equal(help.isOpen(),true);assert.equal(dialog.modal,true);assert.equal(doc.activeElement,close);assert.equal(trigger.attributes['aria-expanded'],'true');
 let prevented=false;dialog.listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(help.isOpen(),false);assert.equal(doc.activeElement,trigger);
 help.toggle();close.onclick();assert.equal(help.isOpen(),false);assert.equal(trigger.attributes['aria-expanded'],'false');
 help.toggle();dialog.listeners.click({target:dialog,clientX:50,clientY:50});assert.equal(help.isOpen(),true);dialog.listeners.click({target:dialog,clientX:0,clientY:0});assert.equal(help.isOpen(),false);
 help.dispose();assert.equal(toolbar.children.length,0);assert.equal(doc.body.children.includes(dialog),false);
});
