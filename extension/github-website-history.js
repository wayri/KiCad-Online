/* Parse GitHub's bounded Atom website feed; never execute markup or call an API. */
((root)=>{'use strict';
 const SHA=/^[a-f0-9]{40}$/i,MAX_BYTES=4*1024*1024;
 const decode=value=>value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,entity=>{
  const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};if(named[entity])return named[entity];
  const number=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);return number>=32&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):'';
 });
 function parseAtom(content,{repository,ref}){
  if(typeof content!=='string'||new TextEncoder().encode(content).length>MAX_BYTES||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(content)||!/<feed\b[^>]*xmlns=["']http:\/\/www.w3.org\/2005\/Atom["']/i.test(content))throw Error('GitHub commit history is not a readable Atom feed.');
  const commits=[],seen=new Set();let count=0;
  const field=(body,name,max)=>{const match=new RegExp('<'+name+'(?:\\s[^>]*)?>([^<]*)</'+name+'>','i').exec(body);const value=match?decode(match[1]).trim():'';return value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)?value:'';};
  for(const match of content.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)){
   if(++count>100)throw Error('GitHub commit feed exceeds its entry limit.');
   const body=match[1],id=field(body,'id',300),sha=id.split('/').at(-1);if(!SHA.test(sha||''))continue;
   const links=[...body.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/gi)];
   if(!links.some(link=>{try{const url=new URL(decode(link[1]));return url.origin==='https://github.com'&&!url.search&&!url.hash&&url.pathname.toLowerCase()===('/'+repository+'/commit/'+sha).toLowerCase();}catch{return false;}}))continue;
   const message=field(body,'title',4000),author=field(body.match(/<author\b[^>]*>([\s\S]*?)<\/author>/i)?.[1]||'','name',300),date=field(body,'updated',100);
   if(!message||!date||!Number.isFinite(Date.parse(date))||seen.has(sha.toLowerCase()))continue;seen.add(sha.toLowerCase());if(commits.length<30)commits.push({sha:sha.toLowerCase(),message,author,date});
  }
  if(count&&!commits.length)throw Error('GitHub commit feed has no valid commits for this repository.');
  if(SHA.test(ref)&&commits[0]?.sha!==ref.toLowerCase())throw Error('GitHub commit feed returned a different pinned revision.');
  return {repository,ref,commits,hasMore:false,nextPage:null,warnings:['GitHub website feed: only the available initial commit window is shown. Enter a commit SHA or open GitHub for older history.']};
 }
 // Only project metadata is returned across the tab boundary. Never forward
 // entire embedded payloads: they can include session and anti-CSRF values.
 function branchName(name){return typeof name==='string'&&name.length>0&&name.length<=200&&name.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!/[\\:\x00-\x1f\x7f?#%]/.test(name);}
 function repositoryCheck(repository){if(typeof repository!=='string'||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||repository.split('/').some(part=>part==='.'||part==='..'))throw Error('Invalid GitHub repository.');}
 function exactPath(value,expected){try{const url=new URL(value,'https://github.com');return url.origin==='https://github.com'&&!url.username&&!url.password&&!url.search&&!url.hash&&decodeURIComponent(url.pathname)===expected;}catch{return false;}}
 function parseBranches(objects,{repository}){
  repositoryCheck(repository);const payloads=objects.filter(value=>value?.payload?.branches).map(value=>value.payload);
  if(payloads.length!==1)throw Error('GitHub website branch metadata is unavailable or conflicting.');
  const payload=payloads[0],groups=payload.branches,branches=new Map(),all=Array.isArray(groups);
  if(all?(payload.current_page!==1||payload.per_page!==20||typeof payload.has_more!=='boolean'||groups.length>20):(!groups||typeof groups!=='object'||!Array.isArray(groups.active)||!Array.isArray(groups.yours)))throw Error('Invalid GitHub website branch metadata.');
  const records=all?groups:[...(groups.default?[groups.default]:[]),...groups.active,...groups.yours];if(records.length>300)throw Error('GitHub branch window exceeds its limit.');
  for(const value of records){if(!branchName(value?.name)||typeof value.isDefault!=='boolean'||!exactPath(value.path,'/'+repository+'/tree/'+value.name)&&!(value.isDefault&&exactPath(value.path,'/'+repository)))throw Error('Invalid or mismatched GitHub website branch.');
   const item={name:value.name,isDefault:value.isDefault},previous=branches.get(item.name);if(previous&&previous.isDefault!==item.isDefault)throw Error('Conflicting GitHub website branch.');branches.set(item.name,item);
  }
  if(branches.size>100)throw Error('GitHub branch window exceeds its limit.');
  const partial=!all||payload.has_more;return {repository,branches:[...branches.values()],warnings:partial?['GitHub website branch window: additional branches may exist. Enter another branch name to load it.']:[],partial};
 }
 function parseCommit(objects,{repository,ref}){
  repositoryCheck(repository);if(!SHA.test(ref||''))throw Error('GitHub commit metadata requires a pinned revision.');
  const commits=objects.map(value=>value?.payload?.commitRoute?.commit).filter(Boolean);if(commits.length!==1)throw Error('GitHub website commit metadata is unavailable or conflicting.');
  const commit=commits[0];if(!SHA.test(commit.oid||'')||commit.oid.toLowerCase()!==ref.toLowerCase()||!exactPath(commit.url,'/'+repository+'/commit/'+commit.oid))throw Error('GitHub website returned a different commit.');
  if(!Array.isArray(commit.parents)||commit.parents.length>16||commit.parents.some(parent=>!SHA.test(parent)||parent.toLowerCase()===ref.toLowerCase())||new Set(commit.parents.map(parent=>parent.toLowerCase())).size!==commit.parents.length)throw Error('Invalid GitHub website commit parents.');
  return {repository,sha:ref.toLowerCase(),parents:commit.parents.map(parent=>parent.toLowerCase()),parentsKnown:true};
 }
 function validateBranches(value,repository){
  repositoryCheck(repository);if(value?.repository!==repository||!Array.isArray(value.branches)||value.branches.length>100||typeof value.partial!=='boolean'||value.branches.some(branch=>!branchName(branch?.name)||typeof branch.isDefault!=='boolean')||new Set(value.branches.map(branch=>branch.name)).size!==value.branches.length)throw Error('Invalid GitHub website branches response.');
  return {repository,branches:value.branches.map(({name,isDefault})=>({name,isDefault})),partial:value.partial,warnings:value.partial?['GitHub website branch window: additional branches may exist. Enter another branch name to load it.']:[]};
 }
 function validateCommit(value,repository,ref){
  if(value?.repository!==repository||value?.sha!==ref.toLowerCase()||value.parentsKnown!==true)throw Error('Invalid GitHub website commit response.');
  return parseCommit([{payload:{commitRoute:{commit:{oid:value.sha,url:'/'+repository+'/commit/'+value.sha,parents:value.parents}}}}],{repository,ref});
 }
 const api={parseAtom,parseBranches,parseCommit,validateBranches,validateCommit,MAX_BYTES};root.KiCadGitHubWebsiteHistory=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
