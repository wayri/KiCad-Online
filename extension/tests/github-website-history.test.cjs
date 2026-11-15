const test=require('node:test'),assert=require('node:assert/strict'),{parseAtom}=require('../github-website-history.js'),{create}=require('../github-project-buffer.js');
const repository='owner/project',sha='a'.repeat(40),other='b'.repeat(40);
const entry=(id=sha,repo=repository)=>`<entry><id>tag:github.com,2008:Grit::Commit/${id}</id><link rel="alternate" type="text/html" href="https://github.com/${repo}/commit/${id}"/><title>Fix &amp; verify</title><updated>2026-10-30T01:02:03Z</updated><author><name>Designer</name></author></entry>`;
const feed=content=>`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${content}</feed>`;
test('Atom website history keeps exact repository links and full SHA, decodes text, bounds visible window',()=>{
 const parsed=parseAtom(feed(entry()+entry(other,'foreign/repo')+entry('bad')+entry()),{repository,ref:sha});
 assert.deepEqual(parsed.commits,[{sha,message:'Fix & verify',author:'Designer',date:'2026-10-30T01:02:03Z'}]);assert.equal(parsed.hasMore,false);assert.match(parsed.warnings[0],/initial commit window/);
 const many=Array.from({length:31},(_,i)=>entry(i.toString(16).padStart(40,'0'))).join('');assert.equal(parseAtom(feed(many),{repository,ref:'main'}).commits.length,30);
 for(const content of ['<html>Login</html>',feed(entry(other)),feed(entry()).replace('<feed','<!DOCTYPE root><feed')])assert.throws(()=>parseAtom(content,{repository,ref:sha}));
});
test('history uses only the matching tab, caches verified parent links and retains pinned scope',async()=>{
 let requests=0;const api=create({readSession:async(repo,ref,action)=>{requests++;assert.equal(repo,repository);assert.equal(ref,sha);return action==='history'?{ref,content:feed(entry())}:{repository,sha,parents:[other],parentsKnown:true};},fetch:async()=>assert.fail('No background fetch')});
 const [a,b]=await Promise.all([api.history(repository,sha),api.history(repository,sha)]);assert.equal(requests,2);assert.deepEqual(a,b);assert.deepEqual(a.commits[0].parents,[other]);assert.equal(a.commits[0].parentsKnown,true);a.commits.length=0;assert.equal((await api.history(repository,sha)).commits.length,1);api.dispose();
});
test('unknown parents remain unknown, missing tab is explicit, and policy blocks before traffic',async()=>{
 let sessions=0;const api=create({readSession:async(repo,ref,action)=>{sessions++;if(action==='commit')throw Error('Website unavailable');return {ref,content:feed(entry())};},fetch:async()=>assert.fail('No background fetch')});
 const result=await api.history(repository,sha);assert.equal(result.commits[0].sha,sha);assert.equal(result.commits[0].parentsKnown,false);assert.equal(result.commits[0].parents,undefined);assert.match(result.warnings.join(' '),/disconnected rows/);assert.equal(sessions,2);api.dispose();
 const denied=create({readSession:async()=>null,fetch:async()=>assert.fail('No background fetch')});await assert.rejects(denied.history(repository,sha),/website session/);denied.dispose();
 const blocked=create({assertNetwork:()=>{throw Error('Network disabled by administrator');},readSession:async()=>assert.fail('session forbidden'),fetch:async()=>assert.fail('fetch forbidden')});await assert.rejects(blocked.history(repository,sha),/administrator/);blocked.dispose();
});

const parser=require('../github-website-history.js'),fixture=name=>require('./fixtures/github-history/'+name+'.json'),liveRepository='wayri/KiCad-Online';
test('observed first commits-page metadata supplies only its explicit matching branch head',()=>{
 const value=fixture('github-branch-head-observed'),repository='wayri/KERO',oid=value.payload.commitsRefRoute.refInfo.currentOid;
 assert.deepEqual(parser.parseBranchHead([value],{repository,ref:'main'}),{repository,ref:'main',sha:oid});
 const edited=structuredClone(value),route=edited.payload.commitsRefRoute;route.refInfo.name='release/hardware';route.repo.ownerLogin='WAYRI';route.repo.name='kero';route.sessionToken='must-not-leave-parser';route.commitGroups=[{commits:[{oid:other}]}];
 assert.deepEqual(parser.parseBranchHead([{},edited],{repository,ref:'release/hardware'}),{repository,ref:'release/hardware',sha:oid});
 for(const offset of [0,99]){route.filters.pagination.endCursor=oid+' '+offset;assert.equal(parser.parseBranchHead([edited],{repository,ref:'release/hardware'}).sha,oid);}
});

test('branch-head metadata rejects absent, duplicate, conflicting, foreign and malformed identities',()=>{
 const value=fixture('github-branch-head-observed'),args={repository:'wayri/KERO',ref:'main'};
 for(const objects of [null,{},[],[{}],[{payload:{commitsRefRoute:null}}],[value,value],Array(101).fill({})])assert.throws(()=>parser.parseBranchHead(objects,args));
 const conflicting=structuredClone(value);conflicting.payload.commitsRefRoute.refInfo.currentOid=other;assert.throws(()=>parser.parseBranchHead([value,conflicting],args),/conflicting/);
 for(const args of [{repository:'foreign/KERO',ref:'main'},{repository:'wayri/other',ref:'main'},{repository:'wayri/KERO',ref:'other'},{repository:'../KERO',ref:'main'},{repository:'wayri/KERO',ref:'../main'},{repository:'wayri/KERO',ref:'main?author=x'}])assert.throws(()=>parser.parseBranchHead([value],args));
 const patches=[route=>{delete route.repo;},route=>{route.repo.ownerLogin='foreign';},route=>{route.repo.name='other';},route=>{route.repo.ownerLogin=null;},route=>{delete route.refInfo;},route=>{route.refInfo.name='other';},route=>{route.refInfo.refType='tag';},route=>{delete route.refInfo.refType;},route=>{route.refInfo.currentOid='short';},route=>{route.refInfo.currentOid=null;},route=>{route.refInfo.currentOid=[sha];},route=>{delete route.currentCommit;},route=>{route.currentCommit.oid=other;},route=>{route.currentCommit.oid='short';},route=>{route.currentCommit.oid=[sha];}];
 for(const patch of patches){const edited=structuredClone(value);patch(edited.payload.commitsRefRoute);assert.throws(()=>parser.parseBranchHead([edited],args));}
});

test('branch-head metadata requires all observed filters to be null and exact bounded first-page cursors',()=>{
 const value=fixture('github-branch-head-observed'),args={repository:'wayri/KERO',ref:'main'},oid=value.payload.commitsRefRoute.refInfo.currentOid;
 const patches=[route=>{delete route.filters;},route=>{route.filters={};},route=>{route.filters=[];},route=>{route.filters.unknownFilter='filtered';},route=>{delete route.filters.pagination;},route=>{route.filters.pagination.hasPreviousPage=true;},route=>{delete route.filters.pagination.hasPreviousPage;},route=>{route.filters.pagination.hasNextPage='false';},route=>{delete route.filters.pagination.hasNextPage;}];
 for(const key of ['since','until','author','newPath','originalBranch','currentBlobPath']){patches.push(route=>{route.filters[key]='filtered';},route=>{delete route.filters[key];});}
 for(const startCursor of [undefined,null,oid+' 1',oid+' 00',other+' 0',oid+' 0 ',[oid+' 0']])patches.push(route=>{route.filters.pagination.startCursor=startCursor;});
 for(const endCursor of [undefined,null,other+' 34',oid+' 100',oid+' -1',oid+' 01',oid+' 1.5',oid+' 1e2',oid+' 34\n',[oid+' 34']])patches.push(route=>{route.filters.pagination.endCursor=endCursor;});
 for(const patch of patches){const edited=structuredClone(value);patch(edited.payload.commitsRefRoute);assert.throws(()=>parser.parseBranchHead([edited],args));}
});

test('observed public website branch contracts preserve names and default flags without inventing tips',()=>{
 for(const name of ['github-branches-observed','github-all-branches-observed']){
  const value=parser.parseBranches([fixture(name)],{repository:liveRepository});assert.equal(value.branches[0].name,'main');assert.equal(value.branches[0].isDefault,true);assert.equal(value.branches.some(branch=>branch.name==='codex/release-0-12-85'),true);assert.equal(value.partial,true);assert.equal(value.branches.some(branch=>Object.hasOwn(branch,'sha')),false);assert.deepEqual(parser.validateBranches(value,liveRepository),value);
  assert.throws(()=>parser.parseBranches([fixture(name)],{repository:'foreign/repo'}),/mismatched/);
 }
 const payload=structuredClone(fixture('github-all-branches-observed'));payload.payload.branches[1].path='https://evil.test/wayri/KiCad-Online/tree/codex/release-0-12-85';assert.throws(()=>parser.parseBranches([payload],{repository:liveRepository}),/mismatched/);
});
test('observed commit parents bind exact repo and SHA; synthetic merges, roots and malformed edges',()=>{
 const value=fixture('github-commit-observed'),ref=value.payload.commitRoute.commit.oid,result=parser.parseCommit([value],{repository:liveRepository,ref});assert.deepEqual(result.parents,['f66c465ad84bb92e6664f3e8321ec019712d45e0']);
 for(const parents of [[],[sha,other]]){const edited=structuredClone(value);edited.payload.commitRoute.commit.parents=parents;assert.deepEqual(parser.parseCommit([edited],{repository:liveRepository,ref}).parents,parents);}
 for(const patch of [{oid:sha},{url:'/foreign/repo/commit/'+ref},{parents:[ref]},{parents:[sha,sha]},{parents:null},{parents:['short']},{parents:Array.from({length:17},(_,i)=>i.toString(16).padStart(40,'0'))}]){const edited=structuredClone(value);Object.assign(edited.payload.commitRoute.commit,patch);assert.throws(()=>parser.parseCommit([edited],{repository:liveRepository,ref}));}
});
test('bounded parent reads preserve feed order and verified merge edges with max three active reads',async()=>{
 let active=0,maximum=0,requests=0;const ids=Array.from({length:30},(_,i)=>(i+1).toString(16).padStart(40,'0'));
 const api=create({foregroundOnly:true,readSession:async(repo,ref,action)=>{if(action==='history')return{ref,content:feed(ids.map(id=>entry(id)).join(''))};requests++;maximum=Math.max(maximum,++active);await new Promise(resolve=>setImmediate(resolve));active--;return{repository,sha:ref,parents:ref===ids[0]?[ids[1],ids[2]]:[],parentsKnown:true};}});
 const result=await api.history(repository,ids[0]);assert.equal(requests,30);assert.equal(maximum,3);assert.deepEqual(result.commits.map(commit=>commit.sha),ids);assert.deepEqual(result.commits[0].parents,[ids[1],ids[2]]);assert.deepEqual(result.commits.at(-1).parents,[]);api.dispose();
});
test('branch discovery caches names with no resolver or anonymous fetch; cancellation prevents parent reads',async()=>{
 let calls=0;const branches=parser.parseBranches([fixture('github-all-branches-observed')],{repository:liveRepository}),api=create({foregroundOnly:true,readSession:async(repo,ref,action)=>{calls++;assert.equal(action,'branches');return branches;},fetch:()=>assert.fail('No background fetch')});assert.deepEqual(await api.branches(liveRepository,'main'),branches);await api.branches(liveRepository,'other');assert.equal(calls,1);api.dispose();
 const controller=new AbortController(),cancelled=create({foregroundOnly:true,readSession:async()=>{controller.abort();return{ref:sha,content:feed(entry())};}});await assert.rejects(cancelled.history(repository,sha,controller.signal),/cancelled/);cancelled.dispose();
});
test('history time budget leaves remaining edges unknown and mismatched parent identity is never cached',async()=>{
 let time=0,details=0;const ids=[sha,other,'c'.repeat(40),'d'.repeat(40)],api=create({foregroundOnly:true,now:()=>time,readSession:async(repo,ref,action)=>{if(action==='history')return{ref,content:feed(ids.map(id=>entry(id)).join(''))};details++;time=16000;return{repository,sha:ref,parents:[],parentsKnown:true};}});
 const result=await api.history(repository,sha);assert.equal(details,3);assert.equal(result.commits[3].parentsKnown,false);assert.equal(result.commits[3].parents,undefined);api.dispose();
 const wrong=create({foregroundOnly:true,readSession:async(repo,ref,action)=>action==='history'?{ref,content:feed(entry())}:{repository:'foreign/repo',sha,parents:[],parentsKnown:true}});await assert.rejects(wrong.history(repository,sha),/Invalid/);assert.equal(wrong.stats().entries,0);wrong.dispose();
});

test('short commit input resolves only a verified full website commit with that prefix',()=>{
 const repository='owner/board',sha='a'.repeat(40),value={payload:{commitRoute:{commit:{oid:sha,url:'/'+repository+'/commit/'+sha,parents:[]}}}};
 assert.equal(parser.parseCommit([value],{repository,ref:sha.slice(0,8)}).sha,sha);
 assert.equal(parser.validateCommit({repository,sha,parents:[],parentsKnown:true},repository,sha.slice(0,8)).sha,sha);
 assert.throws(()=>parser.parseCommit([value],{repository,ref:'b'.repeat(8)}),/different/);
 assert.throws(()=>parser.parseCommit([{payload:{commitRoute:{commit:{...value.payload.commitRoute.commit,parents:[sha]}}}}],{repository,ref:sha.slice(0,8)}),/parents/);
});
