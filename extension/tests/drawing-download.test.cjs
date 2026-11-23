const test=require('node:test'),assert=require('node:assert/strict'),tools=require('../review-tools.js'),owned=require('../owned-canvas.js');
test('raster PDF has exact binary stream length, byte xref offsets and bounded page/image dimensions',()=>{const bytes=Uint8Array.of(255,216,0,128,255,217),pdf=tools.rasterPDF(bytes,100,50,200,100),text=Buffer.from(pdf).toString('latin1');assert.ok(text.startsWith('%PDF-1.4\n'));const offset=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(offset,offset+4),'xref');const refs=text.slice(offset).split('\n').slice(3,8);for(let i=1;i<=5;i++)assert.equal(text.slice(Number(refs[i-1].slice(0,10))).startsWith(i+' 0 obj'),true);assert.ok(text.includes('/Length 6 >>\nstream\n'+Buffer.from(bytes).toString('latin1')));for(const args of [[bytes,5000,2],[bytes,4096,4096],[bytes,1,1,0,5],[Uint8Array.of(0,1),1,1]])assert.throws(()=>tools.rasterPDF(...args),/Invalid/);});
test('full schematic export uses full saved page, preserves hidden-field/layer rules and never mutates live camera',()=>{const previous=global.KiCadOwnedCanvas;global.KiCadOwnedCanvas=owned;try{let painted=[];const camera=new owned.Camera(800,600);camera.bbox={x:10,y:20,w:30,h:40};const before={...camera.bbox},view={viewport:{camera},pcb:false,design:{page:{width:297,height:210}},primitives:[{id:'shown',type:'text',x:5,y:5},{id:'hidden',hidden:true},{id:'wrong-layer',layer:'hidden'},{id:'frame',frame:true}],visibleLayers:new Set(['visible']),geometryVisible:p=>!p.hidden,paperColor:()=> '#fff',paint(p){painted.push({id:p.id,camera:this.viewport.camera});}},canvas={getContext:()=>({fillRect(){}})};const result=tools.drawingImage(view,{create:()=>canvas});assert.deepEqual(painted.map(p=>p.id),['shown','frame']);assert.equal(result.widthMM,297);assert.equal(result.heightMM,210);assert.equal(canvas.width<=4096,true);assert.equal(canvas.width*canvas.height<=12000000,true);assert.deepEqual(camera.bbox,before);assert.notEqual(painted[0].camera,camera);const viewport=tools.drawingImage(view,{scope:'viewport',create:()=>canvas});assert.equal(viewport.widthMM,before.w);assert.throws(()=>tools.drawingImage(view,{scope:'all'}),/Open/);}finally{global.KiCadOwnedCanvas=previous;}});

test('selected source ZIP preserves UTF-8 paths and exact binary source bytes',()=>{
 const entries=[{path:'project/root.kicad_sch',content:'(kicad_sch "Ω")\r\n'},{path:'project/library/λ.kicad_sym',content:Uint8Array.of(0,128,255,1)}],zip=tools.zipFiles(entries),view=new DataView(zip.buffer),decode=new TextDecoder();
 // Independent ZIP layout reader checks local records and their central directory references.
 const records=[];let offset=0;
 while(view.getUint32(offset,true)===0x04034b50){
  assert.equal(view.getUint16(offset+6,true),0x800);assert.equal(view.getUint16(offset+8,true),0);
  const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+nameLength+extra;
  records.push({name:decode.decode(zip.slice(offset+30,offset+30+nameLength)),data:zip.slice(start,start+size),crc:view.getUint32(offset+14,true),offset});offset=start+size;
 }
 assert.equal(records.length,2);assert.equal(records[0].name,entries[0].path);assert.equal(decode.decode(records[0].data),entries[0].content);assert.deepEqual(records[1].data,entries[1].content);
 const centralOffset=offset;
 for(const record of records){assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(offset+16,true),record.crc);assert.equal(view.getUint32(offset+42,true),record.offset);const nameLength=view.getUint16(offset+28,true);assert.equal(decode.decode(zip.slice(offset+46,offset+46+nameLength)),record.name);offset+=46+nameLength;}
 assert.equal(view.getUint32(offset,true),0x06054b50);assert.equal(view.getUint16(offset+10,true),2);assert.equal(view.getUint32(offset+16,true),centralOffset);assert.equal(view.getUint32(offset+12,true),offset-centralOffset);
});

test('ZIP CRC matches a published check value and paths cannot escape or collide',()=>{
 const zip=tools.zipFiles([{path:'a.txt',content:'123456789'}]);assert.equal(new DataView(zip.buffer).getUint32(14,true),0xcbf43926);
 for(const path of ['/absolute.kicad_sch','../escape.kicad_sch','dir/../escape.kicad_sch','C:/escape.kicad_sch','dir\\escape.kicad_sch','dir//x','./x','dir/x.','dir/x ','a\0b','CON.kicad_sch','dir/aux/x','dir/Lpt9.txt'])assert.throws(()=>tools.zipFiles([{path,content:'x'}]),/Unsafe/);
 for(const paths of [['A.kicad_sch','a.kicad_sch'],['é.kicad_sch','e\u0301.kicad_sch']])assert.throws(()=>tools.zipFiles(paths.map(path=>({path,content:'x'}))),/Duplicate/);
 assert.throws(()=>tools.zipFiles([]),/1 and 256/);assert.throws(()=>tools.zipFiles(Array.from({length:257},(_,i)=>({path:'a'+i,content:''}))),/1 and 256/);
 assert.throws(()=>tools.zipFiles([{path:'board.kicad_pcb',content:new Uint8Array(8*1024*1024+1)}]),/budget/);
 assert.throws(()=>tools.zipFiles(Array.from({length:5},(_,i)=>({path:'board'+i+'.kicad_pcb',content:new Uint8Array(8*1024*1024)}))),/budget/);
 assert.throws(()=>tools.zipFiles([{path:'board.kicad_pcb',content:{}}]),/budget/);
});
