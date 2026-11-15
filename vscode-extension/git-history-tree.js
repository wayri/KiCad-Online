'use strict';
// The public vscode.git API supplies git.path and repository.rootUri, but does
// not list saved trees. These plumbing commands only inspect immutable objects.
const path = require('node:path');
const fs = require('node:fs/promises');
const {spawn} = require('node:child_process');
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const MAX_OUTPUT = 4 * 1024 * 1024, MAX_ENTRIES = 10000, PAGE_SIZE = 200;
function validPath(value, root = false) {
  return typeof value === 'string' && value.length <= 1000 && (root && value === '' || value.length > 0 &&
    !value.startsWith('/') && value.split('/').length <= 64 && value.split('/').every(p =>
      p && p !== '.' && p !== '..' && p.toLowerCase() !== '.git' && !/[\\:\x00-\x1f\x7f]/.test(p)));
}
function revision(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw Error('A full saved Git commit SHA is required.');
  return value.toLowerCase();
}
function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return {...env, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_OPTIONAL_LOCKS:'0', GIT_TERMINAL_PROMPT:'0', GIT_NO_LAZY_FETCH:'1', GIT_NO_REPLACE_OBJECTS:'1',
    GIT_PAGER:'cat', GIT_ATTR_NOSYSTEM:'1', LC_ALL:'C'};
}
function createGitHistoryReader({gitPath, rootPath, isTrusted}) {
  if (!path.isAbsolute(gitPath || '') || !path.isAbsolute(rootPath || '') || typeof isTrusted !== 'function')
    throw Error('A trusted local Git executable and repository root are required.');
  const trust = () => {if (isTrusted() !== true) throw Error('Saved Git browsing requires workspace trust.');};
  async function run(args, maxBytes = MAX_OUTPUT) {
    trust();
    const cwd = await fs.realpath(rootPath);trust();
    return new Promise((resolve, reject) => {
      let output = [], size = 0, settled = false, timer;
      const child = spawn(gitPath, ['--no-pager', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', ...args],
        {cwd, env:environment(), shell:false, windowsHide:true, stdio:['ignore','pipe','pipe']});
      function finish(error, result) {if (settled) return;settled=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(result);}
      timer = setTimeout(() => finish(Error('Saved Git object read timed out.')), maxBytes > MAX_OUTPUT ? 60000 : 10000);
      child.stdout.on('data', bytes => {size += bytes.length;if(size > maxBytes)return finish(Error('Saved Git data exceeds the read limit.'));output.push(bytes);});
      // Git error text can include arbitrary names/config; do not return it to UI.
      child.stderr.on('data', () => {});
      child.on('error', () => finish(Error('The configured Git executable is unavailable.')));
      child.on('close', code => {try {trust();}catch(error){return finish(error);}finish(code === 0 ? null : Error('The requested saved Git object is unavailable.'), Buffer.concat(output));});
    });
  }
  async function commit(sha) {
    sha = revision(sha);
    const type = (await run(['cat-file','-t',sha], 64)).toString('ascii').trim();
    if(type !== 'commit')throw Error('The saved revision must identify a Git commit.');
    return sha;
  }
  function parse(bytes, directory, recursive) {
    const decoded = new TextDecoder('utf-8',{fatal:true}).decode(bytes), entries = [], warnings = [];
    const records = decoded.split('\0');
    if(records.pop() !== '')throw Error('Incomplete saved Git tree response.');
    if(records.length > MAX_ENTRIES)throw Error('Saved Git tree exceeds 10,000 entries; open a narrower directory.');
    for(const record of records) {
      const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}(?:[0-9a-f]{24})?) +(-|\d+)\t([^]*)$/.exec(record);
      if(!match)throw Error('Invalid saved Git tree response.');
      const [,mode,type,object,size,name] = match, full = directory ? directory+'/'+name : name;
      if(!validPath(full) || !recursive && name.includes('/')) {warnings.push('Unsafe saved Git names were excluded.');continue;}
      if(mode === '120000' || mode === '160000' || type === 'commit') {warnings.push('Symbolic links and submodules are excluded from saved Git browsing.');continue;}
      if(!['040000','100644','100755'].includes(mode) || type !== (mode === '040000' ? 'tree' : 'blob'))throw Error('Unsupported saved Git object mode.');
      if(type === 'blob' && (!/^\d+$/.test(size) || !Number.isSafeInteger(Number(size))))throw Error('Invalid saved Git file size.');
      entries.push({path:full,name:path.posix.basename(full),kind:type === 'tree'?'directory':'file',type:type === 'tree'?'tree':'blob',
        mode,sha:object,object,size:size === '-'?null:Number(size),status:'committed',staged:false});
    }
    entries.sort((a,b) => (a.kind === b.kind?0:a.kind === 'directory'?-1:1) || (a.path<b.path?-1:a.path>b.path?1:0));
    return {entries,warnings:[...new Set(warnings)]};
  }
  async function list(sha,directory,recursive) {
    const args = ['ls-tree','-z','-l',...(recursive?['-r','-t']:[]),sha+(directory?':'+directory:'')];
    return parse(await run(args),directory,recursive);
  }
  return {
    async inventory({sha,directory=''}) {
      if(!validPath(directory,true))throw Error('Invalid saved Git tree request.');
      sha=await commit(sha);const result=await list(sha,directory,true);
      return{...result,sha,workingTree:false,source:'git-object'};
    },
    async tree({sha,directory='',recursive=false,page=1}) {
      if(!validPath(directory,true) || typeof recursive !== 'boolean' || !Number.isSafeInteger(page) || page<1 || page>50)
        throw Error('Invalid saved Git tree request.');
      sha = await commit(sha);
      const {entries,warnings} = await list(sha,directory,recursive), start = (page-1)*PAGE_SIZE;
      return {sha,treeRef:sha,workingTree:false,source:'git-object',directory,entries:entries.slice(start,start+PAGE_SIZE),
        total:entries.length,truncated:false,hasMore:start+PAGE_SIZE<entries.length,nextPage:start+PAGE_SIZE<entries.length?page+1:null,warnings};
    },
    async read({sha,path:file,maxBytes=8*1024*1024}) {
      if(!validPath(file) || !Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>256*1024*1024)
        throw Error('Invalid saved Git file request.');
      sha = await commit(sha);
      const slash = file.lastIndexOf('/'), directory = slash<0?'':file.slice(0,slash);
      const {entries} = await list(sha,directory,false), entry = entries.find(e=>e.path===file);
      if(!entry || entry.kind !== 'file')throw Error('The saved path is not a regular Git file.');
      if(!Number.isSafeInteger(entry.size) || entry.size>maxBytes)throw Error('Saved Git file exceeds the read limit.');
      const bytes = await run(['cat-file','blob',entry.object],maxBytes);
      if(bytes.length !== entry.size)throw Error('Saved Git file size changed unexpectedly.');
      return {sha,path:file,object:entry.object,mode:entry.mode,bytes,workingTree:false,source:'git-object'};
    }
  };
}
module.exports = {createGitHistoryReader,validPath,revision,MAX_OUTPUT,MAX_ENTRIES,PAGE_SIZE};
