import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../',import.meta.url));
const dep=['extension/node_modules/esbuild','.vizdiff/build-deps/node_modules/esbuild'].map(name=>path.join(root,name)).find(existsSync);
const owner=path.join(process.env.SPIKE_SOURCE_ROOT||path.resolve(root,'../../SPIKE-Main'),'app/src/numericRange.ts');

test('back-side 3D pad centres and net identities match the saved 2D drawing',{skip:!dep||!existsSync(owner)},async()=>{
  const parser=await require(dep).build({entryPoints:[path.join(root,'extension/spike-source/boardParser.ts')],platform:'node',format:'cjs',bundle:true,write:false,alias:{'@spike/numericRange':owner}});
  const api={exports:{}};
  new Function('module','exports',parser.outputFiles[0].text)(api,api.exports);
  const input=`(kicad_pcb (version 20240108)
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
    (net 24 "/GPIO33") (net 25 "/GPIO32")
    (gr_rect (start 10 10) (end 100 100) (stroke (width .05) (type default)) (fill none) (layer "Edge.Cuts"))
    (footprint "Connector" (layer "B.Cu") (at 50 50 90) (uuid "footprint")
      (property "Reference" "EXT2")
      (pad "5" thru_hole circle (at -1.27 0 90) (size 2 2) (drill 1) (layers "*.Cu") (net 24 "/GPIO33") (uuid "pad-five"))
      (pad "6" thru_hole circle (at 1.27 0 90) (size 2 2) (drill 1) (layers "*.Cu") (net 25 "/GPIO32") (uuid "pad-six"))))`;
  const {parse}=require('../extension/design-diff.js'),{build}=require('../extension/pcb-renderer.js');
  const ast=parse(input),drawing=build(ast,'board.kicad_pcb');
  const pads=api.exports.parseKicadBoard(input,ast).pads;
  assert.equal(pads.length,2);
  for(const [i,[uuid,name,net,y]] of [['pad-five','5','/GPIO33',51.27],['pad-six','6','/GPIO32',48.73]].entries()){
    const pad=pads[i],reference=drawing.primitives.find(p=>p.kind==='pad'&&p.uuid===uuid);
    assert.deepEqual([pad.id,pad.name,pad.net],[uuid,name,net]);
    assert.deepEqual(pad.at,[reference.padCenter.x,reference.padCenter.y]);
    assert.deepEqual(pad.at,[50,y]);
  }
});
