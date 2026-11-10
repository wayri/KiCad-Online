const test=require('node:test'),assert=require('node:assert/strict');
global.KiCadGitHub=require('../parsing.js');const launch=require('../project-launch.js');

test('fabrication blob links open the dedicated saved-source viewer, including jobs and Excellon',()=>{
 for(const file of ['fabrication/board.gbrjob','fabrication/board.drl','fabrication/board.xln','fabrication/board.xnc','fabrication/board.exc','fabrication/board.nc','fabrication/top.gbr']){
  const sha='f'.repeat(40),info=launch.context('https://github.com/org/board/blob/'+sha+'/'+file,{repository:'org/board',file,head:sha});
  assert.equal(info.kind,'drawing');const url=new URL(launch.viewerURL(info,file,p=>'chrome-extension://test/'+p));
  assert.equal(url.pathname,'/gerber-viewer.html');assert.equal(url.searchParams.get('ref'),sha);assert.equal(url.searchParams.get('file'),file);
 }
});
test('repository launch preserves root, branch, nested namespace and explicit blob identity',()=>{
 assert.equal(launch.context('https://github.com/owner/repo').ref,'HEAD');
 assert.equal(launch.context('https://github.com/owner/repo/tree/release/design/folder',{ref:'release/design'}).ref,'release/design');
 assert.throws(()=>launch.context('https://github.com/owner/repo/tree/release/design/folder'),/ambiguous/);
 const info=launch.context('https://github.com/owner/repo/blob/release/design/sub/root.kicad_sch',{file:'sub/root.kicad_sch',ref:'release/design',head:'a'.repeat(40)});
 const url=new URL(launch.viewerURL(info,info.file,p=>'moz-extension://test/'+p));assert.equal(url.pathname,'/browser-viewer.html');assert.equal(url.searchParams.get('head'),'a'.repeat(40));assert.equal(url.searchParams.get('file'),'sub/root.kicad_sch');
 const gitlab=launch.context('https://gitlab.com/group/sub/repo');assert.equal(gitlab.repository,'group/sub/repo');assert.equal(gitlab.provider,'gitlab');
 assert.equal(launch.context('https://github.com/owner/repo/issues/42').ref,'HEAD');
});
test('direct file launch accepts separately supplied exact branch and commit metadata without losing slash refs',()=>{
 const sha='c'.repeat(40),file='HARDWARE/ESP32-PoE-hardware-revision-M2/ESP32-PoE_Rev_M2.kicad_pcb',source='https://github.com/OLIMEX/ESP32-POE/blob/feature/models/'+file;
 const info=launch.context(source,{ref:'feature/models',sha});assert.equal(info.kind,'drawing');assert.equal(info.repository,'OLIMEX/ESP32-POE');assert.equal(info.file,file);assert.equal(info.head,sha);
 const url=new URL(launch.viewerURL(info,file,p=>'chrome-extension://test/'+p));assert.equal(url.searchParams.get('head'),sha);assert.equal(url.searchParams.get('file'),file);
 const project=launch.context(source.replace('.kicad_pcb','.kicad_pro'),{ref:'feature/models',sha});assert.equal(project.kind,'drawing');assert.equal(new URL(launch.viewerURL(project,project.file,p=>'chrome-extension://test/'+p)).pathname,'/project-viewer.html');
});
test('launcher rejects credential-bearing locations and unsafe project paths',()=>{
 assert.equal(launch.context('https://user:secret@github.com/owner/repo'),null);assert.equal(launch.context('http://github.com/owner/repo'),null);
 for(const file of ['../board.kicad_pro','/board.kicad_pro','javascript:bad.kicad_pro','file.txt'])assert.throws(()=>launch.viewerURL({repository:'owner/repo',sha:'a'.repeat(40)},file,p=>p));
 const url=launch.viewerURL({repository:'owner/repo',sha:'a'.repeat(40)},'design/board.kicad_pro',p=>'chrome-extension://test/'+p);assert.equal(new URL(url).pathname,'/project-viewer.html');
});

test('direct commit and PR launches retain exact website revision context',()=>{
 const sha='a'.repeat(40);for(const suffix of ['commit/'+sha,'pull/12/commits/'+sha]){const info=launch.context('https://github.com/owner/repo/'+suffix);assert.equal(info.ref,sha);assert.equal(info.revisionKind,'commit');}
 for(const suffix of ['pull/12','pull/12/files','pull/12/checks']){const info=launch.context('https://github.com/owner/repo/'+suffix);assert.equal(info.ref,null);assert.equal(info.pullNumber,12);}
 for(const suffix of ['commit/not-a-sha','pull/0','pull/12/other'])assert.throws(()=>launch.context('https://github.com/owner/repo/'+suffix),/cannot be resolved/);
 const info={repository:'owner/repo',headRepository:'fork/board',sha,pullNumber:12,pullRepository:'owner/repo'};
 for(const file of ['board.kicad_pro','board.kicad_pcb']){const u=new URL(launch.viewerURL(info,file,p=>'chrome-extension://test/'+p));assert.equal(u.searchParams.get('head'),sha);assert.equal(u.searchParams.get('pullNumber'),'12');assert.equal(u.searchParams.get('pullRepository'),'owner/repo');assert.equal(u.searchParams.get('headRepository'),'fork/board');assert.equal(u.searchParams.has('base'),false);}
});
