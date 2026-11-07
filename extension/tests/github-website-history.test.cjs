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
