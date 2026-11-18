const test=require('node:test'),assert=require('node:assert/strict');
test('32-layer inspection reveals a saved inner layer and restores user visibility choices',async()=>{
 const {createLayerInspection}=await import('../spike/layerInspection.mjs'),layers=['F.Cu',...Array.from({length:30},(_,i)=>'In'+(i+1)+'.Cu'),'B.Cu'],view=createLayerInspection(layers);
 view.setLayer('F.Cu',false);view.setLayer('In29.Cu',false);view.focus('In29.Cu');assert.deepEqual(layers.filter(name=>view.visible(name)),['In29.Cu']);assert.equal(view.visible('F.SilkS'),false);assert.equal(view.partsVisible(),false);assert.ok(view.substrateOpacity()<.1);
 view.focus('');assert.equal(view.visible('F.Cu'),false);assert.equal(view.visible('In29.Cu'),false);assert.equal(view.visible('In30.Cu'),true);assert.equal(view.substrateOpacity(),1);assert.equal(view.partsVisible(),true);view.setParts(false);view.focus('B.Cu');view.focus(null);assert.equal(view.partsVisible(),false);assert.throws(()=>view.focus('In31.Cu'),/not present/);
});
