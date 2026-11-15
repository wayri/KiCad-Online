const test=require('node:test'),assert=require('node:assert/strict');

test('narrow 3D host keeps one control set behind a closed More menu',async()=>{
 const {mountCompactToolbar}=await import('../spike/toolbarLayout.mjs');
 let observer,disconnected=false,width=700;
 class Observer{constructor(callback){this.callback=callback;observer=this;}observe(target){this.target=target;}disconnect(){disconnected=true;}resize(value){width=value;this.callback([{contentRect:{width:value}}]);}}
 const host={dataset:{},getBoundingClientRect:()=>({width})},parent={id:'bar'},panel={hidden:false,parentNode:parent},attributes={};
 const moreButton={hidden:true,setAttribute(name,value){attributes[name]=value;}};
 const layout=mountCompactToolbar({host,moreButton,panel,Observer});
 assert.equal(layout.compact,false);assert.equal(moreButton.hidden,true);assert.equal(panel.hidden,false);
 observer.resize(420);assert.equal(layout.compact,true);assert.equal(host.dataset.compact,'true');assert.equal(moreButton.hidden,false);assert.equal(panel.hidden,true);assert.equal(attributes['aria-expanded'],'false');
 layout.toggle();assert.equal(layout.open,true);assert.equal(attributes['aria-expanded'],'true');layout.close();assert.equal(panel.hidden,true);
 observer.resize(640);assert.equal(layout.compact,false);assert.equal(panel.hidden,false);assert.equal(panel.parentNode,parent,'controls retain their original parent and handlers');
 layout.dispose();assert.equal(disconnected,true);
});

test('explicit compact option keeps the menu available in a wide host',async()=>{
 const {mountCompactToolbar}=await import('../spike/toolbarLayout.mjs');
 class Observer{constructor(){}observe(){}disconnect(){}}
 const host={dataset:{},getBoundingClientRect:()=>({width:800})},panel={hidden:false},moreButton={hidden:true,setAttribute(){}};
 const layout=mountCompactToolbar({host,moreButton,panel,Observer,force:true});assert.equal(layout.compact,true);assert.equal(panel.hidden,true);layout.dispose();
});
