/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
const componentBytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const integer=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid GLB '+label+'.');return value;};
const fail=label=>{throw Object.assign(Error('Linked model '+label+' exceeds its decoded memory budget; saved footprint proxies and identities are retained.'),{code:'MODEL_ALLOCATION_BUDGET'});};
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function imageReader(image,viewBytes){
 if(image.bufferView!==undefined){const bytes=viewBytes(image.bufferView);return {length:bytes.length,at:index=>bytes[index]};}
 const match=/^data:([^;,]+);base64,/i.exec(image.uri||'');
 if(!match)throw Error('Embedded model image has no supported bounded header.');
 const text=image.uri,start=match[0].length,length=text.length-start,padding=text.endsWith('==')?2:text.endsWith('=')?1:0;
 if(length%4||length<4)throw Error('Invalid embedded image base64.');
 for(let i=start;i<text.length-padding;i++)if(alphabet.indexOf(text[i])<0)throw Error('Invalid embedded image base64.');
 return {length:length*3/4-padding,at(index){const group=Math.floor(index/3)*4+start,shift=index%3;
   const a=alphabet.indexOf(text[group+shift]),b=alphabet.indexOf(text[group+shift+1]);return shift===0?(a<<2|b>>4)&255:shift===1?(a<<4|b>>2)&255:(a<<6|b)&255;
 }};
}

/** Read only PNG IHDR or JPEG SOF headers; never decode pixels or allocate an
 * image-sized byte array. Other formats are explicitly rejected by the caller. */
export function embeddedImageDimensions(reader){
 const n=reader.length,at=reader.at,u16=i=>at(i)*256+at(i+1),u32=i=>at(i)*16777216+at(i+1)*65536+at(i+2)*256+at(i+3);
 if(n>=24&&at(0)===137&&at(1)===80&&at(2)===78&&at(3)===71&&at(4)===13&&at(5)===10&&at(6)===26&&at(7)===10){
  if(u32(8)!==13||u32(12)!==0x49484452)throw Error('Invalid embedded PNG header.');
  const width=u32(16),height=u32(20);if(!width||!height)throw Error('Invalid embedded PNG dimensions.');return {width,height};
 }
 if(n>=4&&at(0)===255&&at(1)===216){
  let offset=2;
  while(offset<n){
   if(at(offset++)!==255)throw Error('Invalid embedded JPEG marker.');
   while(offset<n&&at(offset)===255)offset++;
   if(offset>=n)break;const marker=at(offset++);
   if(marker===0||marker===218||marker===217)break;
   if(marker===1||marker>=208&&marker<=216)continue;
   if(offset+2>n)break;const length=u16(offset);
   if(length<2||offset+length>n)throw Error('Invalid embedded JPEG segment.');
   if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
    if(length<8)throw Error('Invalid embedded JPEG frame.');
    const height=u16(offset+3),width=u16(offset+5),channels=at(offset+7);
    if(!width||!height||!channels||length<8+3*channels)throw Error('Invalid embedded JPEG dimensions.');
    return {width,height};
   }
   offset+=length;
  }
  throw Error('Embedded JPEG has no bounded frame dimensions.');
 }
 throw Error('Embedded model image format has no bounded PNG/JPEG dimension preflight; saved footprint proxies are retained.');
}

/** Bound declared dense/interleaved/sparse expansion before GLTFLoader runs.
 * This is admission control, not an allocator quota or a total-process estimate. */
export function preflightGLBAllocations(descriptor,bytes,jsonEnd,{maxAccessorBytes=64*1024*1024,maxTextureBytes=32*1024*1024,maxTextureDimension=8192}={}){
 for(const [value,label]of [[maxAccessorBytes,'accessor budget'],[maxTextureBytes,'texture budget'],[maxTextureDimension,'texture dimension']])if(!Number.isSafeInteger(value)||value<1)throw TypeError('Invalid GLB '+label+'.');
 let binary=null,offset=jsonEnd;
 while(offset<bytes.length){
  if(offset+8>bytes.length)throw Error('Truncated GLB chunk.');
  const header=new DataView(bytes.buffer,bytes.byteOffset+offset,8),length=header.getUint32(0,true),type=header.getUint32(4,true);offset+=8;
  if(length>bytes.length-offset)throw Error('Truncated GLB chunk.');
  if(type===0x004e4942){if(binary)throw Error('Duplicate GLB binary chunk.');binary=bytes.subarray(offset,offset+length);}offset+=length;
 }
 const buffers=descriptor.buffers||[],views=descriptor.bufferViews||[];
 function viewInfo(id){
  integer(id,'buffer view index');const view=views[id];if(!view)throw Error('GLB references an invalid buffer view.');
  const buffer=buffers[integer(view.buffer,'buffer index')];if(!buffer)throw Error('GLB references an invalid buffer.');
  const start=integer(view.byteOffset??0,'buffer offset'),length=integer(view.byteLength,'buffer length'),available=integer(buffer.byteLength,'buffer length');
  if(!Number.isSafeInteger(start+length)||start+length>available)throw Error('GLB buffer view exceeds its declared buffer.');
  if(!buffer.uri&&(!binary||available>binary.length))throw Error('GLB buffer exceeds its binary chunk.');
  return {view,start,length,buffer};
 }
 const viewBytes=id=>{const {buffer,start,length}=viewInfo(id);if(buffer.uri)throw Error('Embedded image buffer uses an unsupported nested data URI.');return binary.subarray(start,start+length);};
 // GLTFLoader slices a separate ArrayBuffer for each bufferView, even when
 // several views overlap the same BIN bytes. Bound those copies separately.
 let bufferViewBytes=0;
 for(let id=0;id<views.length;id++){bufferViewBytes+=viewInfo(id).length;if(!Number.isSafeInteger(bufferViewBytes)||bufferViewBytes>maxAccessorBytes+maxTextureBytes)fail('buffer view expansion');}
 let accessorBytes=0;
 for(const accessor of descriptor.accessors||[]){
  const count=integer(accessor.count,'accessor count'),size=componentBytes[accessor.componentType],items=components[accessor.type];
  if(!count||!Number.isInteger(accessor.componentType)||!size||!Object.hasOwn(componentBytes,accessor.componentType)||!items||!Object.hasOwn(components,accessor.type))throw Error('Invalid GLB accessor component type, shape or count.');
  const columns=accessor.type.startsWith('MAT')?Number(accessor.type.at(-1)):1,rows=items/columns,itemBytes=columns>1?columns*Math.ceil(rows*size/4)*4:items*size;
  let stride=itemBytes;
  const start=integer(accessor.byteOffset??0,'accessor offset');if(start%size)throw Error('Misaligned GLB accessor offset.');
  if(accessor.bufferView!==undefined){
   const info=viewInfo(accessor.bufferView);stride=info.view.byteStride??itemBytes;
   if(!Number.isSafeInteger(stride)||stride<itemBytes||stride%size||info.view.byteStride!==undefined&&(stride<4||stride>252||stride%4))throw Error('Invalid GLB accessor stride.');
   const span=(count-1)*stride+itemBytes;if(!Number.isSafeInteger(span)||start+span>info.length)throw Error('GLB accessor exceeds its buffer view.');
  }else if(start)throw Error('GLB accessor without a buffer view has an offset.');
  let expanded=count*stride;
  if(accessor.sparse){
   const sparse=accessor.sparse,n=integer(sparse.count,'sparse count'),indexSize=componentBytes[sparse.indices?.componentType];
   if(!n||n>count||![5121,5123,5125].includes(sparse.indices?.componentType)||!sparse.values)throw Error('Invalid GLB sparse accessor.');
   for(const [part,required,alignment]of [[sparse.indices,n*indexSize,indexSize],[sparse.values,n*itemBytes,size]]){
    const info=viewInfo(part.bufferView),at=integer(part.byteOffset??0,'sparse offset');if(at%alignment||at+required>info.length)throw Error('GLB sparse accessor exceeds its buffer view.');
   }
   // Sparse application copies the dense array; a view-less base also allocates it.
   expanded+=count*items*size;
  }
  accessorBytes+=expanded;if(!Number.isSafeInteger(accessorBytes)||accessorBytes>maxAccessorBytes)fail('accessor expansion');
 }
 let textureBytes=0;
 for(const image of descriptor.images||[]){
  const {width,height}=embeddedImageDimensions(imageReader(image,viewBytes));
  if(width>maxTextureDimension||height>maxTextureDimension)fail('image dimensions');
  textureBytes+=Math.ceil(width*height*4*4/3);
  if(!Number.isSafeInteger(textureBytes)||textureBytes>maxTextureBytes)fail('image pixels');
 }
 return {accessorBytes,textureBytes};
}
