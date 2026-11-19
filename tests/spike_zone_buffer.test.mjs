/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {existsSync} from 'node:fs';
import {createSourceZoneIndex,sourceZoneGeometry} from '../extension/spike/sourceGeometry.mjs';import {savedZoneBufferGeometry,zoneGeometryEstimate} from '../extension/spike/zoneGeometry.mjs';
const require=createRequire(import.meta.url);
const deps=['../extension/node_modules','../.vizdiff/build-deps/node_modules']
 .map(dir=>new URL(dir+'/',import.meta.url)).find(dir=>existsSync(new URL('three/build/three.cjs',dir)));
assert.ok(deps,'Install the pinned Three.js build dependencies');
const THREE=require(fileURLToPath(new URL('three/build/three.cjs',deps)));
const {Earcut}=await import(new URL('three/src/extras/Earcut.js',deps));
const {parse}=require('../extension/design-diff.js');
const form=points=>'(pts '+points.map(p=>'(xy '+p.join(' ')+')').join(' ')+')';
function area(geometry){const p=geometry.attributes.position,i=geometry.index;let sum=0;for(let n=0;n<i.count;n+=3){const a=i.getX(n),b=i.getX(n+1),c=i.getX(n+2);sum+=Math.abs((p.getX(b)-p.getX(a))*(p.getY(c)-p.getY(a))-(p.getY(b)-p.getY(a))*(p.getX(c)-p.getX(a)))/2;}return sum;}
const build=zone=>savedZoneBufferGeometry(THREE,zone,{world:p=>p,triangulate:Earcut.triangulate});
test('zone source index keeps every contour and shares saved point forms instead of materializing copies',()=>{
 const triangle=form([[0,0],[2,0],[0,2]]),ast=parse('(kicad_pcb (net 1 "GND") (zone (tstamp "plane") (net 1) (layers "F.Cu" "In1.Cu" "B.Cu") (polygon '+triangle+')))');
 const index=createSourceZoneIndex(ast),zone=ast.find(n=>Array.isArray(n)&&n[0]==='zone'),pts=zone.at(-1)[1];
 assert.equal(sourceZoneGeometry(ast,1,3).truncated,true);assert.equal(index.stats().contours,3);assert.equal(index.stats().retainsCoordinateCopies,false);
 for(const layer of ['F.Cu','In1.Cu','B.Cu']){const record=index.forLayer(layer)[0];assert.equal(record.sourcePoints,pts);assert.equal(record.id,'plane');assert.equal(record.net,'GND');assert.equal(record.filled,false);assert.equal(Object.hasOwn(record,'points'),false);}
});
test('direct typed zone geometry preserves concavity, source holes and exact axis normals without curves or UVs',()=>{
 // A KiCad-style fractured contour joins a clockwise hole to the outer ring.
 const points=[[0,0],[4,0],[4,4],[0,4],[0,0],[1,1],[1,3],[3,3],[3,1],[1,1],[0,0]];
 const ast=parse('(kicad_pcb (zone (uuid "z") (layer "F.Cu") (filled_polygon (layer "F.Cu") '+form(points)+')))'),record=createSourceZoneIndex(ast).forLayer('F.Cu')[0],result=build(record),geometry=result.geometry;
 assert.equal(area(geometry),12);assert.ok(result.bytes<=zoneGeometryEstimate(record));assert.equal(geometry.attributes.uv,undefined);assert.ok(geometry.attributes.normal.array instanceof Int8Array);assert.equal(geometry.attributes.normal.normalized,true);
 for(let i=0;i<geometry.attributes.normal.count;i++)assert.equal(geometry.attributes.normal.getZ(i),1);
 const p=geometry.attributes.position,indices=geometry.index;
 for(let i=0;i<indices.count;i+=3){const a=indices.getX(i),b=indices.getX(i+1),c=indices.getX(i+2),x=(p.getX(a)+p.getX(b)+p.getX(c))/3,y=(p.getY(a)+p.getY(b)+p.getY(c))/3;assert.ok(!(x>1&&x<3&&y>1&&y<3),'hole stays empty');}
 geometry.dispose();
});
test('unfilled boundaries remain lines and byte admission occurs before triangulation or buffer creation',()=>{
 const ast=parse('(kicad_pcb (zone (layer "B.Cu") (polygon '+form([[0,0],[2,0],[0,2]])+')))'),record=createSourceZoneIndex(ast).forLayer('B.Cu')[0];let calls=0;
 assert.throws(()=>savedZoneBufferGeometry(THREE,record,{world:p=>p,triangulate(){calls++;},maxBytes:1}),/byte budget/);assert.equal(calls,0);
 const result=build(record);assert.equal(result.geometry.index,null);assert.equal(result.geometry.attributes.normal,undefined);assert.equal(result.bytes,36);result.geometry.dispose();
});
test('zone index diagnostics reject invalid saved contours and bound descriptor growth explicitly',()=>{
 const ast=['kicad_pcb',['zone',['layer',{quoted:'F.Cu'}],['polygon',['pts',['xy',0,0],['xy',1,0],['xy',NaN,1]]]]];assert.equal(createSourceZoneIndex(ast).stats().invalid,1);
 const valid=parse('(kicad_pcb (zone (layers "F.Cu" "B.Cu") (polygon '+form([[0,0],[2,0],[0,2]])+')))');assert.equal(createSourceZoneIndex(valid,{maxContours:1}).stats().omitted,1);
});
