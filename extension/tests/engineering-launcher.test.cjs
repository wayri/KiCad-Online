const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function host(extra={}){const calls=[],root={URL,URLSearchParams,chrome:{runtime:{getURL:p=>'chrome-extension://fixture/'+p}},open:(...args)=>calls.push(args),...extra};root.top=root;vm.runInNewContext(fs.readFileSync(require.resolve('../engineering-launcher.js'),'utf8'),root);return{root,api:root.KiCadEngineeringLauncher,calls};}
test('opens only bundled tools and encodes GitLab source context',()=>{
 const{api,calls}=host();const url=api.open('gerber-viewer.html',{provider:'gitlab',host:'https://gitlab.example',repository:'group/subgroup/project',ref:'branch with spaces',file:'fab/Top Cu.gtl',ignored:'secret'});
 const parsed=new URL(url);assert.equal(parsed.pathname,'/gerber-viewer.html');assert.equal(parsed.searchParams.get('file'),'fab/Top Cu.gtl');assert.equal(parsed.searchParams.get('ref'),'branch with spaces');assert.equal(parsed.searchParams.get('host'),'https://gitlab.example');assert.equal(parsed.searchParams.has('ignored'),false);assert.equal(calls[0][2],'noopener,noreferrer');
 for(const p of ['https://evil.example/','../pdf-viewer.html','options.html'])assert.throws(()=>api.open(p),/Unsupported/);
});
test('rejects unsafe provider, host, repository, revision and source paths before launch',()=>{
 const{api,calls}=host();for(const c of [{provider:'other'},{host:'https://evil.example'},{provider:'gitlab',host:'http://gitlab.example'},{provider:'gitlab',host:'https://u:p@gitlab.example'},{provider:'gitlab',host:'https://gitlab.example/api'},{repository:'group/../project'},{repository:'group/project?token=x'},{ref:'main\nsecret'},{file:'../board.kicad_pcb'},{file:'C:\\board.kicad_pcb'},{file:'/board.kicad_pcb'},{file:'board.kicad_pcb?x=y'}])assert.throws(()=>api.open('pdf-viewer.html',c));assert.equal(calls.length,0);
});
test('Android delegates tools and saved analysis without opening browser windows',()=>{
 const delegated=[],{api,calls}=host({KiCadAndroid:{openTools:(...args)=>delegated.push(args),openAnalysis:(...args)=>delegated.push(args)}});
 api.open('bom-viewer.html',{repository:'owner/repo',ref:'abc',file:'assembly/bom.csv'});api.open('analysis-viewer.html',{repository:'owner/repo',ref:'abc',file:'results/thermal.json'});
 assert.deepEqual(delegated,[['bom-viewer.html','assembly/bom.csv','abc'],['results/thermal.json','abc']]);assert.equal(calls.length,0);
});
test('analysis needs an explicit saved report and unsupported standalone hosts fail clearly',()=>{
 const{api,calls}=host();for(const c of [{},{repository:'owner/repo',ref:'abc',file:'board.kicad_pcb'},{repository:'owner/repo',file:'result.json'}])assert.throws(()=>api.open('analysis-viewer.html',c),/Choose a saved/);assert.equal(calls.length,0);
 assert.throws(()=>host({KiCadVSCodeContext:{}}).api.open('calculator-viewer.html'),/browser extension or Android/);
 assert.throws(()=>host({chrome:null}).api.open('calculator-viewer.html'),/installed extension/);
});
test('drawing menu opens standalone imports without misinterpreting the active PCB as their input',()=>{
 const nodes=[];
 function element(tag){const n={tag,children:[],handlers:{},append(...items){this.children.push(...items);},setAttribute(){},addEventListener(name,callback){this.handlers[name]=callback;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();},remove(){this.removed=true;}};nodes.push(n);return n;}
 const document={createElement:element,body:element('body')},{api,calls}=host({document});
 const dialog=api.openMenu({repository:'owner/repo',ref:'abc',file:'hardware/board.kicad_pcb'});
 assert.equal(dialog.open,true);assert.equal(nodes.some(n=>n.textContent==='Open selected results report'),false);
 nodes.find(n=>n.textContent==='Import BoM / iBOM').onclick();
 const url=new URL(calls[0][0]);assert.equal(url.pathname,'/bom-viewer.html');assert.equal(url.searchParams.get('repository'),'owner/repo');assert.equal(url.searchParams.get('ref'),'abc');assert.equal(url.searchParams.has('file'),false);assert.equal(url.searchParams.get('sourceFile'),'hardware/board.kicad_pcb');assert.equal(dialog.removed,true);
});
test('VS Code opens saved analysis through the scoped native host without external browser navigation',async()=>{
 const messages=[],{api,calls}=host({KiCadVSCodeContext:{search:'repository=local%2Frepo&ref=workspace&file=board.kicad_pcb',drawingFile:'board.kicad_pcb'},chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,result:{opened:true}};}}}});
 await api.open('analysis-viewer.html',{repository:'local/repo',ref:'workspace',file:'reports/design.json'});
 assert.equal(messages[0].type,'open-analysis-viewer');assert.equal(messages[0].file,'board.kicad_pcb');assert.equal(messages[0].path,'reports/design.json');assert.equal(calls.length,0);
});

test('saved spatial view choice survives browser, Android and VS Code routing and rejects arbitrary values',async()=>{
 const source={repository:'owner/repo',ref:'abc',file:'quickpi.json',resultView:'3d'};
 const browser=host();assert.equal(new URL(browser.api.open('analysis-viewer.html',source)).searchParams.get('resultView'),'3d');
 for(const resultView of ['https://evil.example',{},'3D'])assert.throws(()=>browser.api.open('analysis-viewer.html',{...source,resultView}),/Invalid saved result view/);
 const delegated=[],android=host({KiCadAndroid:{openAnalysis:(...args)=>delegated.push(args)}});android.api.open('analysis-viewer.html',source);assert.equal(delegated[0][2].resultView,'3d');
 const messages=[],native=host({KiCadVSCodeContext:{drawingFile:'board.kicad_pcb'},chrome:{runtime:{sendMessage:async m=>{messages.push(m);return{ok:true,result:{opened:true}};}}}});await native.api.open('analysis-viewer.html',source);assert.equal(messages[0].resultView,'3d');
});
