const test=require("node:test");
const assert=require("node:assert/strict");
const {resolve}=require("../overview-connectivity.js");
const net=(id,path,extra={})=>({id,path,kind:"schematic",members:[{kind:"wire",position:{x:1,y:2}}],...extra});
const placements=[{id:"root",path:"root",parentId:null},{id:"root/a",path:"channel",parentId:"root",sheetId:"a"},{id:"root/b",path:"channel",parentId:"root",sheetId:"b"}];
const channels=[net("A","root",{sheetPins:[{sheetId:"a",name:"IN"}]}),net("B","root",{sheetPins:[{sheetId:"b",name:"IN"}]}),net("input","channel",{hierarchicalNames:["IN"]})];
const identities=result=>result.matches.map(m=>`${m.instanceId}:${m.net.id}`).sort();

test('link endpoints choose the named parent entry and child port, not an unrelated first label',()=>{
 const parent=net('parent','root',{sheetPins:[{sheetId:'a',name:'IN'}],members:[{kind:'sheet_pin',name:'OTHER',sheetId:'a',position:{x:1,y:1}},{kind:'sheet_pin',name:'IN',sheetId:'b',position:{x:2,y:2}},{kind:'sheet_pin',name:'IN',sheetId:'a',position:{x:3,y:4}}]});
 const child=net('child','channel',{hierarchicalNames:['IN'],members:[{kind:'hierarchical_label',name:'OTHER',position:{x:5,y:5}},{kind:'hierarchical_label',name:'IN',position:{x:6,y:7}}]});
 const result=resolve([parent,child],[{netId:'child',instanceId:'root/a'}],placements);
 assert.deepEqual(result.links[0].from.position,{x:3,y:4});assert.deepEqual(result.links[0].to.position,{x:6,y:7});
});

test("repeated channels bind hierarchical labels to their own parent pins",()=>{
  const result=resolve(channels,[{netId:"input",instanceId:"root/a"}],placements);
  assert.deepEqual(identities(result),["root/a:input","root:A"]);
  assert.equal(result.links.length,1);
  assert.deepEqual(result.links[0],{name:"IN",from:{path:"root",netId:"A",instanceId:"root",position:{x:1,y:2}},to:{path:"channel",netId:"input",instanceId:"root/a",position:{x:1,y:2}}});
  assert.deepEqual(result.limits,[]);
});
test("file-level string selection deliberately aggregates all repeated instances",()=>{
  assert.deepEqual(identities(resolve(channels,["input"],placements)),["root/a:input","root/b:input","root:A","root:B"]);
});
test("same local names never connect sheets or repeated copies",()=>{
  const nets=[net("one","root",{name:"VCC",names:["VCC"]}),net("two","channel",{name:"VCC",names:["VCC"]})];
  assert.deepEqual(identities(resolve(nets,[{netId:"two",instanceId:"root/a"}],placements)),["root/a:two"]);
});
test("exact global labels connect across every instance without a quadratic clique",()=>{
  const nets=[net("power","root",{globalNames:["VCC"]}),net("rail","channel",{globalNames:["VCC"]}),net("other","channel",{globalNames:["vcc"]})];
  const result=resolve(nets,[{netId:"rail",instanceId:"root/a"}],placements);
  assert.deepEqual(identities(result),["root/a:rail","root/b:rail","root:power"]);
  assert.equal(result.links.length,2);
});
test("connectivity follows multiple hierarchy levels and propagates bridged names",()=>{
  const nested=[...placements,{id:"root/a/leaf",path:"leaf",parentId:"root/a",sheetId:"leaf"}];
  const nets=[channels[0],net("input","channel",{hierarchicalNames:["IN"],sheetPins:[{sheetId:"leaf",name:"DEEP"}]}),net("deep","leaf",{hierarchicalNames:["DEEP"]})];
  assert.deepEqual(identities(resolve(nets,[{netId:"deep",instanceId:"root/a/leaf"}],nested)),["root/a/leaf:deep","root/a:input","root:A"]);
});
test("missing parents, cycles and unresolved fallback sheets never invent hierarchy links",()=>{
  const invalid=[{id:"p",path:"root",parentId:"c",sheetId:"p"},{id:"c",path:"channel",parentId:"p",sheetId:"a"},{id:"missing",path:"channel",parentId:"absent",sheetId:"a"},{id:"fallback",path:"channel",parentId:"p",sheetId:"a",unresolved:true}];
  const result=resolve(channels,[{netId:"input",instanceId:"c"}],invalid);
  assert.deepEqual(identities(result),["c:input"]);
  assert.equal(result.links.length,0);
  assert.equal(result.limits.length,1);
});
test("unresolved instances still share exact global labels",()=>{
  const result=resolve([net("g","channel",{globalNames:["GND"]})],[{netId:"g",instanceId:"a"}],[{id:"a",path:"channel",parentId:null},{id:"b",path:"channel",parentId:null,unresolved:true}]);
  assert.deepEqual(identities(result),["a:g","b:g"]);
});
test("empty or unknown selection returns no matched sheets",()=>{
  assert.deepEqual(identities(resolve(channels,[],placements)),[]);
  assert.deepEqual(identities(resolve(channels,[{netId:"input",instanceId:"missing"}],placements)),[]);
});
test("duplicate instance or net identities are rejected rather than silently merged",()=>{
  assert.equal(resolve(channels,["input"],[...placements,placements[0]]).matches.length,0);
  const result=resolve([...channels,channels[2]],["input"],placements);
  assert.equal(result.matches.length,0);assert.equal(result.limits.length,1);
});
test("placement and node limits return an explicit diagnostic and no partial graph",()=>{
  const tooMany=Array.from({length:4097},(_,i)=>({id:String(i),path:"channel",parentId:null}));
  assert.equal(resolve(channels,["input"],tooMany).limits.length,1);
  const copies=tooMany.slice(0,1001), nets=Array.from({length:100},(_,i)=>net(String(i),"channel"));
  const result=resolve(nets,["0"],copies);
  assert.equal(result.matches.length,0);assert.match(result.limits[0],/100000/);
});
test("PCB nets and missing drawing positions cannot create bogus endpoints",()=>{
  const nets=[net("a","root",{globalNames:["G"],members:[]}),net("b","channel",{globalNames:["G"],members:[{position:{x:NaN,y:2}}]}),net("pcb","root",{kind:"pcb",globalNames:["G"]})];
  const result=resolve(nets,["a"],placements);
  assert.equal(result.matches.length,3);
  assert.ok(result.links.every(l=>l.from.position===null && l.to.position===null));
});
