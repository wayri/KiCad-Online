const test=require('node:test'),assert=require('node:assert/strict');
const {install,controlContext,syncContextControls}=require('../workspace-chrome.js');
function fixture(){
 const nodes=new Map(),body={attributes:{},classList:{contains:()=>false},setAttribute(key,value){this.attributes[key]=value;}};
 for(const id of ['frameControls','drawingTools','selectionMode','projectButton','openBomManager','openDraftsman','openSavedReports','viewOppositeDrawing','navigationHelpButton','themeButton','measureButton','downloadDrawing','commentsButton','reviewToolsButton','mode3d','fitDrawing','zoomIn'])nodes.set(id,{dataset:{},hidden:false,onclick:()=>id,setAttribute(){}});
 return {nodes,body,doc:{body,getElementById:id=>nodes.get(id)||null,createElement(){assert.fail('companion should not construct workspace menus');}}};
}
test('embedded panes suppress only host-owned actions while retaining source-bound local tools',()=>{
 const {doc,nodes}=fixture(),context=controlContext({location:{search:'?headerViews=1'}});assert.equal(context,'pane');
 const action=nodes.get('openBomManager').onclick;syncContextControls(doc,context);
 for(const id of ['projectButton','openBomManager','openDraftsman','openSavedReports','viewOppositeDrawing','navigationHelpButton','themeButton'])assert.equal(nodes.get(id).dataset.contextHidden,'true',id);
 for(const id of ['measureButton','downloadDrawing','commentsButton','reviewToolsButton','mode3d','fitDrawing','zoomIn','selectionMode'])assert.equal(nodes.get(id).dataset.contextHidden,undefined,id);
 assert.equal(nodes.get('openBomManager').onclick,action,'the host can still invoke the existing controller');
 const added={dataset:{}};nodes.set('openSavedReports',added);syncContextControls(doc,context);assert.equal(added.dataset.contextHidden,'true','late tools follow the same context');
 syncContextControls(doc,'standalone');assert.equal(nodes.get('openBomManager').dataset.contextHidden,'false');assert.equal(nodes.get('openBomManager').hidden,false);
});
test('BoM context takes precedence over embedded headers and skips unrelated chrome construction',()=>{
 const {doc,body}=fixture(),host={location:{search:'?bomCompanion=1&headerViews=1'}};
 assert.equal(controlContext(host),'bom-companion');assert.equal(install(doc,host),null);assert.equal(body.attributes['data-workspace-context'],'bom-companion');
 assert.equal(controlContext({location:{search:''}}),'standalone');
 assert.equal(controlContext({KiCadVSCodeContext:{search:'?headerViews=1'}}),'pane');
});
