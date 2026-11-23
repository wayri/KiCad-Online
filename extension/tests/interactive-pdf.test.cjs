const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {create} = require('../interactive-pdf.js');
const fontBytes = fs.readFileSync(path.join(__dirname, '../vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf'));
const xy = (x,y) => ({x,y});
const page = (name,primitives=[]) => ({path:name,design:{page:{width:297,height:210},primitives}});
const wire = {type:'line',kind:'wire',uuid:'w',points:[xy(10,10),xy(110,50)],width:.25,color:'#008400'};
const body = {type:'circle',uuid:'u',x:15,y:20,r:3,fill:'background',width:.2,color:'#840000'};
const label = {type:'text',ownerUuid:'u',x:15,y:25,text:'U1 µΩ',size:1.27,color:'#840000'};

// Resolve every indirect object using the actual byte offsets. Binary font
// data can contain any byte sequence, including PDF delimiter lookalikes.
function inspect(bytes) {
  const source=Buffer.from(bytes).toString('latin1'),start=Number(/startxref\n(\d+)\n%%EOF\n$/.exec(source)[1]);
  const header=/^xref\n0 (\d+)\n0000000000 65535 f \n/.exec(source.slice(start));
  assert.ok(header);const count=Number(header[1]),entries=source.slice(start+header[0].length);
  const offsets=[0];
  for(let id=1;id<count;id++) {
    const line=entries.slice((id-1)*20,id*20);
    assert.match(line,/^\d{10} 00000 n \n$/);
    const offset=Number(line.slice(0,10));assert.equal(source.slice(offset,offset+String(id).length+7),id+' 0 obj\n');
    offsets.push(offset);
  }
  offsets.push(start);
  const objects=[null];
  for(let i=1;i<count;i++) {
    const value=source.slice(offsets[i]+String(i).length+7,offsets[i+1]-8);
    if(value.includes('\nstream\n')) {
      const length=Number(/\/Length (\d+)/.exec(value)[1]),begin=value.indexOf('\nstream\n')+8;
      assert.equal(value.slice(begin+length),'\nendstream');
    }
    objects.push(value);
  }
  return objects;
}
function unicode(value) {
  const data=Buffer.from(value,'hex');
  assert.equal(data.readUInt16BE(0),0xfeff);
  return data.subarray(2).swap16().toString('utf16le');
}
const metadata=(objects,annot)=>{
  const contents=objects[Number(/\/Contents (\d+) 0 R/.exec(annot)[1])],value=unicode(contents.slice(1,-1));
  assert.ok(value.startsWith('PocketKiVi/1\n'));return JSON.parse(value.slice('PocketKiVi/1\n'.length));
};
const render=(pages,options={})=>create(pages,{fontBytes,...options});

test('writes vector paths, saved coordinates, searchable Unicode text and an embedded TrueType font',()=>{
  const sheet=page('sensor.kicad_sch',[wire,body,label,{type:'arc',start:xy(0,0),mid:xy(1,-1),end:xy(2,0),color:'#000000'}]);
  const objects=inspect(render([sheet])),all=objects.join('\n');
  assert.match(all,/\/MediaBox \[0 0 841\.88976 595\.27559\]/);
  assert.match(all,/2\.83465 0 0 -2\.83465 0 595\.27559 cm/);
  assert.match(all,/10 10 m\n110 50 l/);assert.match(all,/ c\n/);
  assert.match(all,/\/Subtype \/Type0/);assert.match(all,/\/FontFile2 \d+ 0 R/);
  assert.match(all,/\/CIDToGIDMap \d+ 0 R/);assert.match(all,/\/PageLabels/);assert.match(all,/\/Outlines/);
  assert.match(all,/<0004> <00b5>/);assert.match(all,/<0005> <03a9>/);
  assert.match(all,/<00010002000300040005> Tj/);assert.doesNotMatch(all,/\/Subtype \/Image/);
  const cid=objects.find(s=>s?.includes('/Subtype /CIDFontType2'));
  const mapping=objects[Number(/\/CIDToGIDMap (\d+)/.exec(cid)[1])].split('\nstream\n')[1];
  assert.ok(Buffer.from(mapping,'latin1').readUInt16BE(10)>0);
});

test('component rectangle covers its visible symbol and its property captions remain literal data',()=>{
  const value='1 kΩ "special" \\ tolerance\n(Rev A)';
  const sheet=page('sensor.kicad_sch',[body,label]);
  sheet.objects=[{kind:'symbol',id:'sheet/u',uuid:'u',reference:'U1',position:xy(70,80),properties:{Value:value}}];
  const objects=inspect(render([sheet])),link=objects.find(s=>s?.includes('/Subtype /Link'));
  const rect=/\/Rect \[([^\]]+)\]/.exec(link)[1].split(' ').map(Number);
  assert.ok(rect[0]<15*72/25.4 && rect[2]>15*72/25.4 && rect[2]<25*72/25.4);
  assert.deepEqual(metadata(objects,link),{kind:'component',id:'sheet/u',path:sheet.path,reference:'U1',properties:{Value:value}});
  const action=objects[Number(/\/A (\d+) 0 R/.exec(link)[1])];
  const script=unicode(/\/JS <([^>]+)>/.exec(action)[1]);let captions;
  vm.runInNewContext(script,{app:{popUpMenuEx(...items){captions=items.map(item=>item.cName);}}},{timeout:500});
  assert.deepEqual(captions,['U1','Value: '+value]);
  assert.doesNotMatch(action,/\/URI|\/Launch/);
});

test('wire links use narrow hit regions, confirmed global-net destinations and file-scoped local labels',()=>{
  const sheets=['a','b','c'].map(name=>page(name+'.kicad_sch',[wire]));
  sheets.forEach((s,i)=>{s.nets=[{id:s.path+'/net',kind:'schematic',name:'BUS',globalNames:i===1?[]:['BUS'],netclass:'Power',
    primitives:[wire],members:[{kind:'wire',uuid:'w',position:xy(10,10)}]}];});
  const objects=inspect(render(sheets)),pageIds=objects.flatMap((s,i)=>s?.includes('/Type /Page ')?[i]:[]),links=objects.filter(s=>s?.includes('/Subtype /Link'));
  assert.equal(links.length,16*3);
  for(const link of links){
    const data=metadata(objects,link),source=sheets.findIndex(s=>s.path===data.path);
    assert.equal(data.netclass,'Power');assert.equal(data.members[0].kind,'wire');
    assert.equal(Number(/\/Dest \[(\d+) 0 R \/XYZ/.exec(link)[1]),pageIds[[2,1,0][source]]);
    const [x1,y1,x2,y2]=/\/Rect \[([^\]]+)\]/.exec(link)[1].split(' ').map(Number);
    assert.ok(Math.min(x2-x1,y2-y1)<10);
  }
});

test('honors layer visibility and includes renderer and missing-glyph diagnostics',()=>{
  const sheet=page('board.kicad_pcb',[{...label,layer:'F.SilkS',text:'😀'},{...wire,layer:'B.Cu'}]);
  sheet.design.warnings=['Unsupported primitive in source.'];sheet.visibleLayers=['F.SilkS'];
  sheet.nets=[{id:'w-net',name:'hidden',primitives:[wire],members:[{uuid:'w',kind:'wire',position:xy(10,10)}]}];
  sheet.objects=[{kind:'footprint',uuid:'w',id:'hidden-part',position:xy(10,10)}];
  const warnings=[],objects=inspect(render([sheet],{onWarning:w=>warnings.push(w)}));
  assert.doesNotMatch(objects.join('\n'),/110 50 l/);
  assert.equal(objects.filter(s=>s?.includes('/Subtype /Link')).length,0);
  assert.match(objects.join('\n'),/<0001> <d83dde00>/);
  assert.ok(warnings.some(w=>w.includes('Unsupported primitive')));
  assert.ok(warnings.some(w=>w.includes('U+1F600')));
});

test('sheet symbols navigate to a resolved, included page; missing sheets produce a diagnostic',()=>{
  const main=page('main.kicad_sch',[body]),child=page('other/sub.kicad_sch');
  main.objects=[{id:'sheet1',path:main.path,uuid:'u',kind:'sheet',properties:{Sheetfile:'other/sub.kicad_sch'}}];
  const options={resolveSheetTarget:s=>s.properties.Sheetfile};
  const objects=inspect(render([main,child],options)),link=objects.find(s=>s?.includes('/Subtype /Link'));
  const childId=objects.findLastIndex(s=>s?.includes('/Type /Page '));assert.ok(link.includes('/Dest ['+childId+' 0 R /Fit]'));
  const warnings=[];render([main],{...options,onWarning:w=>warnings.push(w)});assert.match(warnings[0],/no resolved PDF page/);
});

test('large net keeps every member location clickable while disclosing the bounded property preview',()=>{
  const s=page('board.kicad_pcb');
  const members=Array.from({length:300},(_,i)=>({kind:'pad',reference:'U'+i,pad:'1',position:xy(10+i%20,10+Math.floor(i/20))}));
  s.nets=[{id:'board/net:1',name:'GND',members}];
  const warnings=[],objects=inspect(render([s],{onWarning:w=>warnings.push(w)}));
  const links=objects.filter(o=>o?.includes('/Subtype /Link'));assert.equal(links.length,300);
  const data=metadata(objects,links[0]);assert.equal(data.memberCount,300);assert.equal(data.members.length,256);
  assert.match(data.properties.Members,/first 256/);assert.match(warnings[0],/300 source members/);
});

test('fails explicitly for invalid fonts, malformed geometry and exceeded page, primitive, link and byte budgets',()=>{
  const sample=page('s');
  assert.throws(()=>create([sample],{fontBytes:fontBytes.subarray(0,50)}),/TrueType/);
  assert.throws(()=>render(Array(65).fill(sample)),/64-page/);
  assert.throws(()=>render([page('a',Array(60000).fill(wire)),page('b',Array(41000).fill(wire))]),/100,000 primitives/);
  assert.throws(()=>render([page('a',[{type:'line',points:[xy(0,Infinity)]}])]),/drawing point/);
  const diagonal={...wire,points:[xy(0,0),xy(1e5,1e5)]};
  assert.throws(()=>render([{...page('a',[diagonal]),nets:[{id:'n',primitives:[diagonal]}]}]),/wire hit regions|annotations/);
  const text = {...label,text:'A'.repeat(32000)};
  assert.throws(()=>render([page('text',Array(265).fill(text))]),/32 MiB output/);
});
