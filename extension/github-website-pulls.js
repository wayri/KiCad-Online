/* Bounded, inert PR website metadata. No API/OAuth or guessed merge base. */
((root)=>{'use strict';
 const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,SHA=/^[a-f0-9]{40}$/i;
 function validRepo(v){return typeof v==='string'&&REPO.test(v)&&v.split('/').every(p=>p!=='.'&&p!=='..');}
 function validatePull(value,repository,number){
  if(!validRepo(repository)||!Number.isSafeInteger(number)||number<1||value?.repository!==repository||value.pullNumber!==number||value.url!=='https://github.com/'+repository+'/pull/'+number||!validRepo(value.headRepository)||typeof value.headRef!=='string'||!value.headRef||value.headRef.length>200||value.headRef.split('/').some(p=>!p||p==='.'||p==='..')||/[\\:\x00-\x1f\x7f?#%]/.test(value.headRef))throw Error('GitHub PR head metadata is unavailable or mismatched.');
  return {repository,pullNumber:number,url:value.url,headRepository:value.headRepository,headRef:value.headRef,...(SHA.test(value.headSha||'')?{headSha:value.headSha.toLowerCase()}:{}),mergeBase:null};
 }
 function fromDocument(doc,{repository,number,url}){
  const expected='https://github.com/'+repository+'/pull/'+number;
  if(url!==expected)throw Error('GitHub PR location mismatch.');
  const canonical=doc?.querySelector('link[rel="canonical"]')?.getAttribute('href');if(canonical&&canonical!==expected)throw Error('GitHub returned a different PR.');
  const refs=[...(doc?.querySelectorAll('.head-ref a[href]')||[])].flatMap(a=>{try{const u=new URL(a.getAttribute('href'),'https://github.com'),parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);if(u.origin!=='https://github.com'||u.username||u.password||u.search||u.hash||parts[2]!=='tree')return[];return[{headRepository:parts.slice(0,2).join('/'),headRef:parts.slice(3).join('/')}];}catch{return[];}});
  const unique=[...new Map(refs.map(v=>[v.headRepository+'\n'+v.headRef,v])).values()];if(unique.length!==1)throw Error('GitHub did not expose a readable PR head. Open its overview on GitHub and retry.');
  return validatePull({repository,pullNumber:number,url:expected,...unique[0]},repository,number);
 }
 function validateList(value,repository){
  if(!validRepo(repository)||value?.repository!==repository||!Array.isArray(value.pulls)||value.pulls.length>25||value.pulls.some(p=>!Number.isSafeInteger(p?.number)||p.number<1||p.url!=='https://github.com/'+repository+'/pull/'+p.number||typeof p.title!=='string'||!p.title||p.title.length>500))throw Error('Invalid GitHub PR list.');
  return {repository,pulls:value.pulls.map(p=>({number:p.number,url:p.url,title:p.title,state:'unknown',author:''})),hasMore:true,warnings:['GitHub website: the initial visible pull-request window is shown. Enter a PR number to open another request.']};
 }
 function listFromDocument(doc,{repository}){
  const pulls=new Map();for(const a of [...(doc?.querySelectorAll('a[id^="issue_"][href]')||[])]){let u;try{u=new URL(a.getAttribute('href'),'https://github.com');}catch{continue;}const parts=u.pathname.split('/');if(u.origin!=='https://github.com'||u.username||u.password||u.search||u.hash||parts.length!==5||parts.slice(1,3).join('/')!==repository||parts[3]!=='pull'||! /^[1-9][0-9]*$/.test(parts[4]))continue;const number=Number(parts[4]),title=(a.textContent||'').trim();if(Number.isSafeInteger(number)&&title&&title.length<=500)pulls.set(number,{number,url:u.href,title});if(pulls.size===25)break;}
  return validateList({repository,pulls:[...pulls.values()]},repository);
 }
 const api={validatePull,fromDocument,validateList,listFromDocument};root.KiCadGitHubWebsitePulls=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
