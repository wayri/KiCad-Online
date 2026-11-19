const test = require('node:test');
const assert = require('node:assert/strict');
require('../design-diff.js');
const { collect } = require('../repo-models.js');
const { decode, frameSize, murmur } = require('../embedded-models.js');
const { decompress } = require('../vendor/fzstd/fzstd.js');
const { webcrypto, createHash } = require('node:crypto');
global.crypto ||= webcrypto;
test('historical checksum boundary vectors match native KiCad accepted saved files', () => {
  const vectors = [[13,'0fc02384a29118f69ffb8f37551022e3'],[14,'0fc02384a29118f69ffb8f37551022e3'],[15,'0fc02384a29118f69ffb8f37551022e3'],
    [16,'c2b4dd9ad16eb4fa8ceab3c5ec80bb9c'],[29,'d0493a34e9975c4ecd401611f6241957'],[30,'d0493a34e9975c4ecd401611f6241957'],
    [31,'d0493a34e9975c4ecd401611f6241957'],[32,'640f257aed88afae1152817b29da968f']];
  for(const [length, expected] of vectors) {
    const bytes = Buffer.from('x'.repeat(length));
    assert.equal(murmur(bytes, true), expected);
    assert.equal(murmur(bytes) === expected, length % 16 === 0);
  }
});
test('native KiCad 10.0.6 saved embedded VRML passes historical checksum and payload decode', async () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/embedded/native-box.kicad_pcb'), 'utf8');
  const inventory = collect(source, 'native-box.kicad_pcb');
  assert.equal(inventory.models.length, 1); assert.deepEqual(inventory.diagnostics, []);
  const output = await decode(inventory.models[0].embeddedAsset, decompress);
  assert.equal(new TextDecoder().decode(output), '#VRML V2.0 utf8\nShape { geometry Box { size 1 2 3 } }\n');
  assert.equal(inventory.models[0].embeddedAsset.checksum, '2DECE0147E1B048BC8384A9E9DD38D61');
});
// A standards-compliant single-segment Zstandard frame containing one raw block.
function frame(text) {
  const content = Buffer.from(text), header = content.length * 8 + 1;
  return Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, content.length,
    header & 255, (header >>> 8) & 255, (header >>> 16) & 255]), content]);
}
test('renders decoded payload from KiCad board and footprint embedded model scopes', async () => {
  const text = '#VRML V2.0 utf8\nShape {}', base64 = frame(text).toString('base64');
  const checksum = createHash('sha256').update(text).digest('hex');
  const file = `(embedded_files (file (name "body.wrl") (type model) (data |\n${base64}\n|) (checksum "${checksum}")))`;
  const source = `(kicad_pcb ${file} (footprint "X" (at 1 2) (layer "F.Cu") (uuid "a") (model "kicad-embed://body.wrl"))
    (footprint "Y" (at 3 4) (layer "B.Cu") (uuid "b") ${file} (model "kicad-embed://body.wrl")))`;
  const inventory = collect(source, 'board.kicad_pcb');
  assert.equal(inventory.models.length, 2); assert.deepEqual(inventory.diagnostics, []);
  assert.notEqual(inventory.models[0].assetKey, inventory.models[1].assetKey);
  assert.equal(new TextDecoder().decode(await decode(inventory.models[0].embeddedAsset, decompress)), text);
});
test('rejects missing and duplicate embedded names without repository network fallback', () => {
  const source = '(kicad_pcb (embedded_files (file (name "a.wrl")) (file (name "a.wrl"))) (footprint "X" (at 1 2) (model "kicad-embed://a.wrl") (model "kicad-embed://missing.step")))';
  const result = collect(source, 'board.kicad_pcb');
  assert.equal(result.models.length, 0); assert.equal(result.diagnostics.length, 3);
});
test('rejects corrupt checksum, trailing frames, huge allocation, unknown size and malformed base64', async () => {
  const bytes = frame('hello');
  await assert.rejects(decode({base64: bytes.toString('base64'), checksum: '0'.repeat(64)}, decompress), /checksum mismatch/);
  assert.throws(() => frameSize(Buffer.concat([bytes, bytes])), /trailing/);
  assert.throws(() => frameSize(Buffer.from([0x28,0xb5,0x2f,0xfd,0xa0,0xff,0xff,0xff,0x7f])), /exceeds/);
  assert.throws(() => frameSize(Buffer.from([0x28,0xb5,0x2f,0xfd,0,0])), /bounded/);
  await assert.rejects(decode({base64:'???'}, decompress), /base64/);
  await assert.rejects(decode({base64:bytes.subarray(0,bytes.length-1).toString('base64')}, decompress), /Truncated/);
});


test('outlined embedded fixture preserves the exact native model asset and a usable board outline',async()=>{
 const fs=require('node:fs'),path=require('node:path'),dir=path.join(__dirname,'fixtures/embedded');
 const native=collect(fs.readFileSync(path.join(dir,'native-box.kicad_pcb'),'utf8'),'native-box.kicad_pcb');
 const source=fs.readFileSync(path.join(dir,'outlined-box.kicad_pcb'),'utf8'),outlined=collect(source,'outlined-box.kicad_pcb');
 assert.deepEqual(outlined.models[0].embeddedAsset,native.models[0].embeddedAsset);
 assert.match(source,/gr_rect \(start 0 10\) \(end 25 35\)/);
 assert.match(new TextDecoder().decode(await decode(outlined.models[0].embeddedAsset,decompress)),/geometry Box/);
});

test('embedded base64 checks the decoded budget before using either decoder',()=>{
  const {decodeBase64}=require('../embedded-models.js');
  let calls=0;
  const host={atob(data){calls++;return Buffer.from(data,'base64').toString('latin1');}};
  assert.throws(()=>decodeBase64('AAEC',{maxBytes:2,host}),/byte limit/);
  assert.throws(()=>decodeBase64('AA=A',{host}),/Invalid/);
  assert.equal(calls,0);
  assert.deepEqual([...decodeBase64('AAEC',{host})],[0,1,2]);
});
