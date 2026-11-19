/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
/** Saved filled polygons go directly to typed buffers. No Shape/LineCurve,
 * Vector2-per-edge graph, face-triplet arrays, UVs or retained coordinate copy. */
const atom=node=>node&&typeof node==='object'&&!Array.isArray(node)?node.quoted:node;
export function zoneGeometryEstimate(zone){
 const n=zone.size;if(!Number.isSafeInteger(n)||n<3)throw Error('Invalid saved zone point count.');
 const bytes=zone.filled?n*15+Math.max(0,n-2)*3*(n>65535?4:2):n*12;
 if(!Number.isSafeInteger(bytes))throw Error('Invalid saved zone geometry size.');return bytes;
}
export function savedZoneBufferGeometry(THREE,zone,{world,triangulate,maxBytes=64*1024*1024}={}){
 if(typeof world!=='function'||typeof triangulate!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<0)throw TypeError('Invalid saved zone geometry options.');
 if(zoneGeometryEstimate(zone)>maxBytes)throw Object.assign(Error('Saved zone exceeds the remaining typed-geometry byte budget.'),{code:'ZONE_GEOMETRY_BUDGET'});
 const coordinates=new Float64Array(zone.size*2);let n=0;
 for(const node of zone.sourcePoints){
  if(!Array.isArray(node)||atom(node[0])!=='xy')continue;
  const point=world([Number(atom(node[1])),Number(atom(node[2]))]);
  if(!point.every(Number.isFinite)||n>=zone.size)throw Error('Invalid saved zone coordinate.');coordinates[n*2]=point[0];coordinates[n*2+1]=point[1];n++;
 }
 if(n!==zone.size)throw Error('Saved zone point count changed.');
 if(n>3&&coordinates[0]===coordinates[(n-1)*2]&&coordinates[1]===coordinates[(n-1)*2+1])n--;
 const position=new Float32Array(n*3),normal=zone.filled?new Int8Array(n*3):null;
 for(let i=0;i<n;i++){position[i*3]=coordinates[i*2];position[i*3+1]=coordinates[i*2+1];if(normal)normal[i*3+2]=127;}
 let index=null;
 if(zone.filled){
  const triangles=triangulate(coordinates.subarray(0,n*2),undefined,2);
  if(!triangles.length||triangles.length%3||triangles.length>(n-2)*3)throw Error('Saved zone could not be triangulated faithfully.');
  const Index=n>65535?Uint32Array:Uint16Array;index=new Index(triangles.length);
  for(let i=0;i<triangles.length;i++){const vertex=triangles[i];if(!Number.isInteger(vertex)||vertex<0||vertex>=n)throw Error('Invalid saved zone triangulation index.');index[i]=vertex;}
 }
 const bytes=position.byteLength+(normal?.byteLength||0)+(index?.byteLength||0);if(bytes>maxBytes)throw Object.assign(Error('Saved zone exceeds its typed-geometry byte budget.'),{code:'ZONE_GEOMETRY_BUDGET'});
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(position,3));if(normal)geometry.setAttribute('normal',new THREE.BufferAttribute(normal,3,true));if(index)geometry.setIndex(new THREE.BufferAttribute(index,1));
 return {geometry,bytes,vertices:n};
}
