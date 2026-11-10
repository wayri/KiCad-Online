/* Installed only after the user invokes the extension on a repository tab. */
((root)=>{'use strict';
 if(root.KiCadRepositorySessionBridge)return;root.KiCadRepositorySessionBridge=true;
 const loads=new Map();let reservedBytes=0,reviewLoads=0;
 const failures={GITLAB_SAML_REQUIRED:'GitLab requires SSO/SAML verification in the matching project tab.',GITLAB_LOGIN_REQUIRED:'Sign in to this GitLab project in its website tab.',GITLAB_UNEXPECTED_HTML:'GitLab returned a login or access page instead of project data.',MANAGED_POLICY:'Administrator policy prevents this project read.',
  GITHUB_WEBSITE_RATE_LIMIT:'GitHub temporarily limited website requests. Wait briefly, then retry.',
  GITHUB_WEBSITE_NOT_FOUND:'GitHub returned HTTP 404 for the requested repository location. Check its branch and folder in the same browser profile; private repositories also return 404 when website access is unavailable.',
  GITHUB_WEBSITE_DENIED:'GitHub denied this website request (HTTP 401/403). Check access directly in the matching repository tab.',
  GITHUB_WEBSITE_UNREADABLE:'GitHub returned an unreadable repository page. Check the matching repository tab and retry.',
  GITHUB_WEBSITE_NETWORK:'The repository-tab website request failed at the browser network layer. Check browser connectivity or policy, then retry.',
  GITHUB_TREE_UNAVAILABLE:'GitHub did not expose readable branch/folder metadata. Reload the repository folder and click the extension icon again. No additional repository permissions are required.',
  GITHUB_BRANCH_HEAD_UNAVAILABLE:'The selected folder is readable, but GitHub did not expose its branch HEAD metadata. Open the repository root on GitHub and retry from the extension icon; no review-account permissions are needed.',
  GITHUB_PINNED_TREE_UNAVAILABLE:'The branch commit was resolved, but GitHub did not expose the folder at that exact commit. Reopen the folder on GitHub and try again.',
  GITHUB_REVISION_MISMATCH:'GitHub returned metadata for a different revision or folder. Reload the repository page and try again.',
  GITHUB_TREE_INCOMPLETE:'GitHub returned an incomplete directory listing. Open the smaller project folder and try again.',
  GITHUB_READ_TOO_LARGE:'The GitHub website response exceeds the bounded reader limit. Open the smaller project folder and try again.',
  GITHUB_READ_FORMAT:'The repository response could not be decoded as the expected saved data. Reload its website tab and retry.',
  GITHUB_READ_TIMEOUT:'The repository-tab read timed out. Keep that tab open and retry.',
  GITHUB_READ_CANCELLED:'Repository loading was cancelled.'};
 function failure(error){const code=Object.hasOwn(failures,error?.code||'')?error.code:null;return{ok:false,error:code?failures[code]:'Repository website read failed. Open this project tab and complete any sign-in/SSO requirement; browser policy may restrict access.',...(code?{code}:{})};}

 root.chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender?.id!==root.chrome.runtime.id||sender.tab||!message||typeof message!=='object')return false;
  if(message.type==='repository-session-cancel'){if(typeof message.requestId!=='string')return false;loads.get(message.requestId)?.abort();reply({ok:true});return false;}
  if(message.type==='projectLaunchContext'){
   const parse=root.KiCadGitHub,options={gitlabHosts:location.origin!=='https://github.com'?[location.origin]:[]},route=parse?.route(location.href,options),repo=parse?.repositoryRoute(location.href,options);
   const scripts=[...document.querySelectorAll('script[type="application/json"]')].map(n=>n.textContent),app=document.querySelector('#js-view-blob-app,#js-repository-blob-header-app,#js-repository-tree');
   reply(route?.kind==='blob'?parse.embeddedBlobData(scripts,route):repo?{ref:parse.repositoryRef(repo,scripts,app?.dataset)}:null);return false;
  }
  if(message.type==='github-session-review'&&location.origin==='https://github.com'){
   if(['prepare','verify','commit','prepare-create','verify-create','commit-create','update-prepared'].includes(message.action)&&![root.chrome.runtime.getURL('background.js'),root.chrome.runtime.getURL('_generated_background_page.html')].includes(sender.url))return false;
   if(!root.KiCadGitHubSessionReview){reply({ok:false,error:'Reload this repository tab and invoke the extension again.'});return false;}
   if(reviewLoads>=2){reply({ok:false,error:'Wait for the current website review request.'});return false;}reviewLoads++;
   Promise.resolve().then(()=>root.KiCadGitHubSessionReview.create().dispatch(message)).then(result=>reply({ok:true,result}),error=>reply({ok:false,error:error?.code==='WEBSITE_REVIEW_UNAVAILABLE'||error?.code==='WEBSITE_REVIEW_UNCERTAIN'?String(error.message).slice(0,500):'GitHub website review access is unavailable. Keep the matching signed-in repository tab open.'})).finally(()=>{reviewLoads--;});return true;
  }
  const reader=message.type==='github-session-read'&&location.origin==='https://github.com'?root.KiCadGitHubSessionReader:message.type==='gitlab-session-read'&&location.origin!=='https://github.com'?root.KiCadGitLabSessionReader:null;
  if(!reader)return false;const id=message.requestId,bytes=message.limit??8*1024*1024;
  if(id!==undefined&&(typeof id!=='string'||!/^load-[a-f0-9]{32}$/.test(id)||loads.has(id))||loads.size>=4||!Number.isInteger(bytes)||bytes<1||bytes>64*1024*1024||reservedBytes+bytes>128*1024*1024){reply({ok:false,error:'Invalid repository read identifier or request budget.'});return false;}
  const controller=new AbortController(),key=id||Symbol();loads.set(key,controller);reservedBytes+=bytes;
  Promise.resolve().then(()=>reader.create({signal:controller.signal}).read(message)).then(result=>reply({ok:true,result}),error=>reply(failure(error))).finally(()=>{loads.delete(key);reservedBytes-=bytes;});return true;
 });
})(globalThis);
