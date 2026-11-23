const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const workspace=fs.readFileSync(require.resolve('../review-workspace.js'),'utf8');
test('download absorbs the removed native launch control',()=>{
 assert.ok(workspace.includes("import(chrome.runtime.getURL('project-download.js'))"));
 assert.ok(workspace.includes('KiCadProjectDownload.open({request,scope:'));
 assert.ok(workspace.includes("downloadDrawingButton.id='downloadDrawing'"));
 assert.equal(workspace.includes("openLocal.id='openInKiCad'"),false);
 assert.equal(workspace.includes("request('native-kicad-open'"),false);
 assert.equal(workspace.includes('Choose save location and open'),false);
});
