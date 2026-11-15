'use strict';
const {test,before,after}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createGitHistoryReader,validPath,revision}=require('../git-history-tree.js');
let directory,gitPath,first,second,blob,reader;
function git(args,input) {
 const result=spawnSync(gitPath,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false',...args],
  {cwd:directory,encoding:'utf8',input,windowsHide:true,shell:false});
 assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
before(async()=>{
 const command=process.platform==='win32'?spawnSync('where.exe',['git.exe'],{encoding:'utf8'}):spawnSync('which',['git'],{encoding:'utf8'});
 gitPath=command.stdout.trim().split(/\r?\n/)[0];assert.ok(path.isAbsolute(gitPath),'Git fixture requires a local Git executable');
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'kiview-git-history-'));git(['init','--quiet']);
 await fs.mkdir(path.join(directory,'models'));
 await fs.writeFile(path.join(directory,'board.kicad_pcb'),'saved first board');
 await fs.writeFile(path.join(directory,'models','part.step'),Buffer.from([0,1,2,255]));
 await fs.writeFile(path.join(directory,'deleted.kicad_sch'),'removed later');
 git(['add','.']);git(['commit','--quiet','-m','First board revision']);first=git(['rev-parse','HEAD']);
 await fs.writeFile(path.join(directory,'board.kicad_pcb'),'saved second board');
 await fs.rm(path.join(directory,'deleted.kicad_sch'));
 await fs.writeFile(path.join(directory,'new.kicad_sch'),'second only');
 blob=git(['hash-object','-w','--stdin'],'/outside/private');
 git(['add','-u']);git(['add','new.kicad_sch']);
 git(['update-index','--add','--cacheinfo',`120000,${blob},linked.kicad_sch`]);
 git(['update-index','--add','--cacheinfo',`160000,${first},submodule`]);
 git(['commit','--quiet','-m','Second board revision']);second=git(['rev-parse','HEAD']);
 await fs.writeFile(path.join(directory,'board.kicad_pcb'),'UNSAVED WORKING CONTENT');
 reader=createGitHistoryReader({gitPath,rootPath:directory,isTrusted:()=>true});
});
after(async()=>{if(directory&&path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('kiview-git-history-'))await fs.rm(directory,{recursive:true,force:true});});
test('immutable commit trees include deleted files and reads never use modified working content',async()=>{
 const old=await reader.tree({sha:first}),now=await reader.tree({sha:second});
 assert.equal(old.workingTree,false);assert.equal(old.source,'git-object');assert.equal(old.treeRef,first);
 assert.ok(old.entries.some(e=>e.name==='deleted.kicad_sch'));assert.ok(!old.entries.some(e=>e.name==='new.kicad_sch'));
 assert.ok(now.entries.some(e=>e.name==='new.kicad_sch'));assert.ok(!now.entries.some(e=>e.name==='deleted.kicad_sch'));
 assert.equal((await reader.read({sha:first,path:'board.kicad_pcb'})).bytes.toString(),'saved first board');
 assert.equal((await reader.read({sha:second,path:'board.kicad_pcb'})).bytes.toString(),'saved second board');
 await assert.rejects(reader.read({sha:first,path:'new.kicad_sch'}),/not a regular Git file/);
 assert.ok(old.entries.every(e=>e.status==='committed'&&/^[0-9a-f]{40}$/.test(e.object)));
});
test('nested binary assets retain exact saved bytes and paths; links and submodules stay excluded',async()=>{
 const tree=await reader.tree({sha:second,recursive:true});
 assert.ok(tree.entries.some(e=>e.path==='models/part.step'&&e.mode==='100644'&&e.size===4));
 assert.ok(!tree.entries.some(e=>/^(linked|submodule)/.test(e.path)));assert.match(tree.warnings.join(' '),/Symbolic links and submodules/);
 assert.deepEqual((await reader.read({sha:second,path:'models/part.step'})).bytes,Buffer.from([0,1,2,255]));
 for(const file of ['linked.kicad_sch','submodule','models','absent.kicad_sch'])await assert.rejects(reader.read({sha:second,path:file}),/not a regular Git file/);
 await assert.rejects(reader.tree({sha:second,directory:'linked.kicad_sch'}),/unavailable/);
 const nested=await reader.tree({sha:first,directory:'models'});assert.equal(nested.entries[0].path,'models/part.step');
});
test('untrusted requests and revision/path injection are rejected with no fallback',async()=>{
 const denied=createGitHistoryReader({gitPath,rootPath:directory,isTrusted:()=>false});
 await assert.rejects(denied.tree({sha:first}),/trust/);
 for(const value of ['HEAD','main','--help',first+'^{tree}','x'.repeat(40),first+'\n'])assert.throws(()=>revision(value),/full saved Git commit/);
 for(const value of ['../outside','/etc/passwd','C:/secret','a\\b','a//b','.git/config','a/../b','a\nfile','a\0b','a/'.repeat(65)]){
  assert.equal(validPath(value),false,value);await assert.rejects(reader.read({sha:first,path:value}),/Invalid saved Git file/);
 }
 assert.equal(validPath('models/a component.step'),true);assert.equal(validPath('',true),true);
 assert.throws(()=>createGitHistoryReader({gitPath:'git',rootPath:directory,isTrusted:()=>true}),/trusted local/);
 await assert.rejects(reader.tree({sha:blob}),/must identify a Git commit/);
 await assert.rejects(reader.read({sha:first,path:'board.kicad_pcb',maxBytes:3}),/read limit/);
 assert.equal((await reader.read({sha:first,path:'board.kicad_pcb',maxBytes:256*1024*1024})).bytes.toString(),'saved first board');
 await assert.rejects(reader.read({sha:first,path:'board.kicad_pcb',maxBytes:256*1024*1024+1}),/Invalid saved Git file/);
 for(const page of [0,51,1.2])await assert.rejects(reader.tree({sha:first,page}),/Invalid saved Git tree/);
});
test('entry limits and paging are bounded against actual Git trees',async()=>{
 const records=Array.from({length:10001},(_,i)=>`100644 blob ${blob}\tpart-${String(i).padStart(5,'0')}.txt`).join('\n')+'\n';
 const hugeTree=git(['mktree'],records),hugeCommit=git(['commit-tree',hugeTree], 'Huge saved tree\n');
 await assert.rejects(reader.tree({sha:hugeCommit}),/10,000 entries/);
 const smallTree=git(['mktree'],records.split('\n').slice(0,205).join('\n')+'\n'),smallCommit=git(['commit-tree',smallTree],'Paged saved tree\n');
 const page1=await reader.tree({sha:smallCommit}),page2=await reader.tree({sha:smallCommit,page:2});
 assert.equal(page1.entries.length,200);assert.equal(page1.nextPage,2);assert.equal(page2.entries.length,5);assert.equal(page2.hasMore,false);
 assert.equal(new Set([...page1.entries,...page2.entries].map(e=>e.path)).size,205);
});
test('ambient Git overrides cannot redirect reads away from the trusted repository',async()=>{
 const prior=process.env.GIT_DIR,priorWork=process.env.GIT_WORK_TREE;
 try{
  process.env.GIT_DIR=path.join(directory,'missing-external-git-dir');process.env.GIT_WORK_TREE=os.tmpdir();
  assert.equal((await reader.read({sha:first,path:'board.kicad_pcb'})).bytes.toString(),'saved first board');
 }finally{
  if(prior===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=prior;
  if(priorWork===undefined)delete process.env.GIT_WORK_TREE;else process.env.GIT_WORK_TREE=priorWork;
 }
});
