const test=require('node:test'),assert=require('node:assert/strict'),pdf=require('../pdf-tools.js');
const source=new TextEncoder().encode('%PDF-1.7\n'+String.fromCharCode(0,128,255));
test('PDF intake preserves binary bytes and rejects text or malformed payloads',()=>{assert.deepEqual(pdf.bytes({base64:Buffer.from(source).toString('base64')}),source);assert.equal(pdf.bytes(source),source);assert.throws(()=>pdf.bytes({content:'%PDF-1.7'}),/binary/);assert.throws(()=>pdf.bytes({base64:'%%%%'}),/payload/);assert.throws(()=>pdf.bytes(new Uint8Array([1,2,3])),/header/);});
test('PDF byte, page and canvas bounds reject or cap excessive inputs',()=>{assert.throws(()=>pdf.bytes(new Uint8Array(pdf.LIMITS.bytes+1)),/32 MiB/);assert.equal(pdf.pageNumber('2',3),2);for(const n of [0,1.5,4,Infinity])assert.throws(()=>pdf.pageNumber(n,3));assert.throws(()=>pdf.pageNumber(1,5001),/limit/);const scale=pdf.canvasScale(10000,20000,6,2);assert.ok(10000*20000*scale*scale<=pdf.LIMITS.canvasPixels);assert.ok(20000*scale<=8192);assert.throws(()=>pdf.canvasScale(Infinity,1,1),/dimensions/);});

test('owned metadata is copied into bounded read-only values without prototype keys',()=>{
 const record={kind:'component',id:'part:1',reference:'R1',properties:{Value:'10k',Enabled:true,Unit:1,Description:'<img src=x onerror=alert(1)>'}};
 const parsed=pdf.metadata('PocketKiVi/1\n'+JSON.stringify(record));assert.equal(parsed.reference,'R1');assert.equal(parsed.properties.Unit,'1');assert.equal(parsed.properties.Description,record.properties.Description);assert.equal(Object.getPrototypeOf(parsed.properties),Object.prototype);
 const net=pdf.metadata('PocketKiVi/1\n'+JSON.stringify({kind:'net',id:'net:1',name:'VCC',members:[{reference:'U1',pin:2,position:{x:1,y:2}}]}));assert.deepEqual(net.members,[{reference:'U1',pin:'2'}]);
 assert.equal(pdf.metadata('PocketKiVi/1\n'+JSON.stringify({kind:'net',id:'net:1',memberCount:900,properties:{Members:'900 source members; showing the first 1.'},members:[{reference:'U1',pin:'2'}]})).memberCount,900);
 assert.equal(pdf.metadata('PocketKiVi/1\n'+JSON.stringify({kind:'net',id:'net:1',memberCount:100001})),null);
 for(const payload of ['bad',JSON.stringify({kind:'script',id:'1'}),JSON.stringify({kind:'net',id:''}),'{"kind":"net","id":"1","__proto__":{"admin":true}}','{"kind":"component","id":"1","properties":{"constructor":"x"}}',JSON.stringify({kind:'component',id:'1',properties:{x:{deep:'value'}}}),JSON.stringify({kind:'net',id:'1',members:Array(257).fill({reference:'R1'})})])assert.equal(pdf.metadata('PocketKiVi/1\n'+payload),null);
 assert.equal(pdf.metadata('Not our metadata'),null);assert.equal(pdf.metadata('PocketKiVi/1\n'+' '.repeat(pdf.LIMITS.annotationCharacters)),null);
});

test('annotation coordinates use the CSS viewport, clamp and reject invalid rectangles',()=>{
 const viewport={width:100,height:200,convertToViewportRectangle:rect=>[rect[0],200-rect[1],rect[2],200-rect[3]]};
 assert.deepEqual(pdf.annotationRect([10,20,30,40],viewport),{left:10,top:160,width:20,height:20});
 assert.deepEqual(pdf.annotationRect([-5,190,20,220],viewport),{left:0,top:0,width:20,height:10});
 for(const rect of [[1,2,1,2],[200,2,300,4],[NaN,1,2,3],[0,1,2]])assert.equal(pdf.annotationRect(rect,viewport),null);
 const rotated={width:200,height:100,convertToViewportRectangle:rect=>[rect[1],rect[0],rect[3],rect[2]]};assert.deepEqual(pdf.annotationRect([10,20,30,40],rotated),{left:20,top:10,width:20,height:20});
});

test('PDF JavaScript/actions remain inert while only internal and explicit HTTPS links are exposed',()=>{
 const viewport={width:100,height:100,convertToViewportRectangle:r=>r};
 const base={subtype:'Link',rect:[1,1,10,10]},items=[{...base,actions:{Action:['app.alert("no")']}},{...base,url:'javascript:alert(1)'},{...base,url:'file:///C:/secret'},{...base,url:'https://user:secret@example.com/'},{...base,url:'https://example.com/datasheet.pdf'},{...base,dest:[0,{name:'XYZ'},1,2,null]},{...base,contentsObj:{str:'PocketKiVi/1\n{"kind":"net","id":"1","name":"VCC"}'},actions:{Action:['throw new Error()']}},{...base,contents:'PocketKiVi/1\nbad'}];
 const result=pdf.interactions(items,viewport);assert.equal(result.items.length,3);assert.equal(result.invalid,1);assert.equal(result.items[0].url,'https://example.com/datasheet.pdf');assert.equal(result.items[1].dest[0],0);assert.equal(result.items[2].metadata.name,'VCC');
 assert.throws(()=>pdf.interactions(Array(20001).fill(base),viewport),/20,000/);
});
