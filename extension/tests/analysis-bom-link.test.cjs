const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const importer = require('../bom-import.js');
const script = fs.readFileSync(path.join(__dirname, '../analysis-bom-link.js'), 'utf8');
const parts = 'Reference,Value,Quantity\nR1,10k,1\n';

function fixture({top = {}, ...globals} = {}) {
 const buttons = [];
 const location = {search:'?repository=owner%2Fboard&ref=main&file=sim.wbk'};
 const context = {
  document: {querySelector: () => ({append: button => buttons.push(button)}), createElement: () => ({})},
  top, location, URLSearchParams, KiCadBomImport: importer, ...globals,
 };
 vm.runInNewContext(script, context);
 return {api: context.KiCadAnalysisBomLink, button: buttons[0], location};
}

test('only importable BoM data shows the action, even when a simulation export has a BoM-like filename', () => {
 const {api, button, location} = fixture();
 assert.equal(button.hidden, true);
 for (const name of ['assembly.wbk', 'assembly.raw', 'assembly.txt']) {
  api.update(name, parts, 'pinned');
  assert.equal(button.hidden, true);
 }
 api.update('bom-transient.csv', 'Time,V(/out)\n0,1\n1,2\n', 'pinned');
 assert.equal(button.hidden, true);
 api.update('assembly.csv', parts, 'pinned');
 assert.equal(button.hidden, false);
 button.onclick();
 const target = new URL(location.href, 'https://example.com');
 assert.equal(target.pathname, '/bom-viewer.html');
 assert.equal(target.searchParams.get('file'), 'assembly.csv');
 assert.equal(target.searchParams.get('ref'), 'pinned');
 api.update();
 assert.equal(button.hidden, true);
});

test('the action keeps the Android route and remains unavailable in native VS Code', () => {
 const calls = [];
 const native = fixture({KiCadVSCodeContext:{}});
 assert.equal(native.button, undefined);
 const android = fixture({KiCadAndroidRuntime:{},top:{KiCadAndroid:{openTools:(...args)=>calls.push(args)}}});
 android.api.update('assembly.csv', parts, 'pinned');
 android.button.onclick();
 assert.deepEqual(calls, [['bom-viewer.html', 'assembly.csv', 'pinned']]);
});
