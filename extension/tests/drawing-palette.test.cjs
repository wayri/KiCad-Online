const test=require('node:test'),assert=require('node:assert/strict');
const {schematicColor}=require('../owned-canvas.js'),layers=require('../layer-colors.js');
function luminance(hex){const rgb=hex.match(/[a-f\d]{2}/gi).map(channel=>{const value=parseInt(channel,16)/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('schematic light view preserves native hues and dark view provides readable defaults',()=>{
 for(const source of ['#000000','#840000','#a90000','#008400','#008484','#000080','#725600']){assert.equal(schematicColor(source,false),source,'native light theme preserves saved KiCad hues');assert.ok(contrast(schematicColor(source,true),'#1c2029')>=4.5,source+' dark');}
 assert.notEqual(schematicColor('#840000',true),schematicColor('#008400',true));
 assert.equal(schematicColor('#123456',true),'#123456','unknown/custom source hues are not rewritten');
});
test('review PCB hues preserve copper identities, alpha and readable annotation contrast',()=>{
 for(const dark of [true,false])for(const layer of ['F.Cu','B.Cu','F.SilkS','Edge.Cuts'])assert.ok(contrast(layers.reviewColorFor(layer,dark),dark?'#151820':'#e7ebf1')>=3,layer+' '+dark);
 assert.notEqual(layers.reviewColorFor('F.Cu'),layers.reviewColorFor('B.Cu'));
 assert.equal(layers.reviewColorFor('F.Mask'),'rgba(177,151,215,0.4)');
 assert.equal(layers.colorFor('F.Cu'),'#c83434','native KiCad defaults remain independently available');
 assert.equal(layers.reviewColorFor('Private.Layer'),layers.colorFor('Private.Layer'));
});
