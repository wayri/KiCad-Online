/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightModelGLB} from '../extension/spike/modelGraphBudget.mjs';
import {preflightGLBAllocations,embeddedImageDimensions} from '../extension/spike/glbAllocationBudget.mjs';
function glb(descriptor,binary){
 const raw=Buffer.from(JSON.stringify(descriptor)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),bin=binary?Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]):null;
 const bytes=Buffer.alloc(20+json.length+(bin?8+bin.length:0));bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);
 if(bin){bytes.writeUInt32LE(bin.length,20+json.length);bytes.writeUInt32LE(0x004e4942,24+json.length);bin.copy(bytes,28+json.length);}return bytes;
}
const accessor=(count=3)=>({count,componentType:5126,type:'SCALAR'});
const inspect=(descriptor,limits={},binary)=>{const bytes=glb(descriptor,binary);return preflightGLBAllocations(descriptor,bytes,20+bytes.readUInt32LE(12),limits);};
const png=(width,height)=>{const b=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);return b;};
const jpeg=(width,height,progressive=false)=>Buffer.from([255,216,255,224,0,4,0,0,255,progressive?194:192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,217]);
const reader=bytes=>({length:bytes.length,at:index=>bytes[index]});

test('huge dense and sparse accessors are rejected before loader execution with no expanded allocation',()=>{
 let parsed=false;assert.throws(()=>{preflightModelGLB(glb({accessors:[accessor(1000000000)]}),32768);parsed=true;},/accessor expansion/);assert.equal(parsed,false);
 assert.deepEqual(inspect({accessors:[accessor(3)]},{maxAccessorBytes:12}),{accessorBytes:12,textureBytes:0});
 assert.throws(()=>inspect({accessors:[accessor(3),accessor(3)]},{maxAccessorBytes:23}),/accessor expansion/);
 const sparse={accessors:[{...accessor(10),sparse:{count:1,indices:{bufferView:0,componentType:5121},values:{bufferView:1}}}],buffers:[{byteLength:8}],bufferViews:[{buffer:0,byteLength:1},{buffer:0,byteOffset:4,byteLength:4}]};
 assert.equal(inspect(sparse,{maxAccessorBytes:80},Buffer.alloc(8)).accessorBytes,80);assert.throws(()=>inspect(sparse,{maxAccessorBytes:79},Buffer.alloc(8)),/accessor expansion/);
});

test('accessor component/count/sparse/view metadata must be valid before decoding',()=>{
 for(const value of [{count:-1},{count:1.5},{count:Number.MAX_SAFE_INTEGER+1},{count:0},{componentType:'5126'},{componentType:5124},{type:'toString'},{type:'VEC9'},{byteOffset:2}])assert.throws(()=>inspect({accessors:[{...accessor(),...value}]}));
 const sparse={...accessor(2),sparse:{count:3,indices:{bufferView:0,componentType:5121},values:{bufferView:0}}};assert.throws(()=>inspect({accessors:[sparse]}),/sparse/);
 sparse.sparse.count=1;sparse.sparse.indices.componentType=5122;assert.throws(()=>inspect({accessors:[sparse]}),/sparse/);
 assert.throws(()=>inspect({accessors:[{...accessor(),bufferView:0}],bufferViews:[{buffer:0,byteLength:12}],buffers:[{byteLength:12}]}, {},Buffer.alloc(4)),/binary chunk/);
 const strided={accessors:[{...accessor(2),type:'VEC3',bufferView:0}],buffers:[{byteLength:32}],bufferViews:[{buffer:0,byteLength:32,byteStride:16}]};
 assert.equal(inspect(strided,{maxAccessorBytes:32},Buffer.alloc(32)).accessorBytes,32);assert.throws(()=>inspect(strided,{maxAccessorBytes:31},Buffer.alloc(32)),/expansion/);
 strided.bufferViews[0].byteStride=256;assert.throws(()=>inspect(strided,{},Buffer.alloc(32)),/stride/);
 const overlapping={buffers:[{byteLength:8}],bufferViews:Array.from({length:4},()=>({buffer:0,byteLength:8}))};
 assert.throws(()=>inspect(overlapping,{maxAccessorBytes:16,maxTextureBytes:15},Buffer.alloc(8)),/buffer view expansion/);
});

test('PNG and baseline/progressive JPEG dimensions are read from bounded headers without decoding pixels',()=>{
 for(const bytes of [png(32,16),jpeg(32,16),jpeg(32,16,true)])assert.deepEqual(embeddedImageDimensions(reader(bytes)),{width:32,height:16});
 assert.throws(()=>embeddedImageDimensions(reader(png(0,1))),/dimensions/);
 assert.throws(()=>embeddedImageDimensions(reader(jpeg(32,16).subarray(0,12))),/segment/);
 assert.throws(()=>embeddedImageDimensions(reader(Buffer.from('RIFFxxxxWEBP'))),/no bounded/);
});

test('embedded image dimensions and cumulative RGBA/mipmap bytes reject compressed pixel bombs before GLTFLoader',()=>{
 const header=png(32,16),descriptor={buffers:[{byteLength:header.length}],bufferViews:[{buffer:0,byteLength:header.length}],images:[{bufferView:0,mimeType:'image/png'}]};
 const size=Math.ceil(32*16*4*4/3);assert.equal(inspect(descriptor,{maxTextureBytes:size},header).textureBytes,size);assert.throws(()=>inspect(descriptor,{maxTextureBytes:size-1},header),/image pixels/);
 assert.throws(()=>inspect(descriptor,{maxTextureDimension:31},header),/image dimensions/);
 for(const bytes of [png(32,16),jpeg(32,16),jpeg(32,16,true)]){
  const uri='data:image/png;base64,'+bytes.toString('base64');assert.equal(inspect({images:[{uri}]},{maxTextureBytes:size}).textureBytes,size);
  assert.throws(()=>preflightModelGLB(glb({images:[{uri:'data:image/png;base64,'+png(100000,100000).toString('base64')}]}),32768),/image dimensions/);
 }
 assert.throws(()=>inspect({images:[{uri:'data:image/webp;base64,'+Buffer.from('RIFFxxxxWEBP').toString('base64')}]}),/no bounded/);
 assert.throws(()=>inspect({images:[{uri:'data:image/png;base64,===='}]}),/base64/);
});
