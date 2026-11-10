const test=require('node:test'),assert=require('node:assert/strict');
const {websitePolicyDecision:decide}=require('../github-review-api.js');
const sha='a'.repeat(40),snapshot=(mode,allowlist=[],account='reviewer')=>({sha,account,source:'repository',content:JSON.stringify({schemaVersion:1,commenting:{mode,allowlist}})});
test('website comment policy uses canonical validation, exact website login, owner and explicit allowlists',()=>{
 assert.equal(decide('owner/board',{sha,source:'default',account:'reviewer'},'reviewer').allowed,true);
 assert.equal(decide('owner/board',snapshot('all'),null).allowed,false);
 assert.equal(decide('owner/board',snapshot('allowlist'),'reviewer').allowed,false);
 for(const mode of ['allowlist','contributors','collaborators']){assert.equal(decide('owner/board',snapshot(mode,[],'OWNER'),'OWNER').allowed,true);assert.equal(decide('org/board',snapshot(mode,['Reviewer']),'reviewer').allowed,true);assert.equal(decide('org/board',snapshot(mode),'reviewer').allowed,false);}
 assert.equal(decide('owner/board',{sha,source:'default',account:'different'},'reviewer').allowed,false);
 assert.match(decide('org/board',snapshot('contributors'),'reviewer').reason,/cannot verify/);
 for(const value of [null,{source:'default',sha:'main'},{sha,source:'default',content:'hidden policy'},{sha,source:'repository',content:'{bad'},{sha,source:'repository',content:JSON.stringify({schemaVersion:1,commenting:{mode:'all',extra:true}})}])assert.throws(()=>decide('owner/board',value,'owner'));
});
