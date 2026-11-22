/* Read-only Git host branch/file-history picker. Repository identities never come from dropdown labels. */
((root)=>{
  'use strict';
  const data=root.KiCadBrowserData||(typeof require==='function'?require('./browser-data.js'):null),SHA=/^[0-9a-f]{40}$/i;
  function comparisonQuery(request,base,head){
    if(!data.validRepository(request.repository,request.provider)||!data.validRepository(request.headRepository,request.provider)||!data.validPath(request.file)||!data.validPath(request.oldFile||request.file)||!SHA.test(head)||base&&!SHA.test(base))throw new Error('Invalid comparison location or unresolved revision.');
    const params=new URLSearchParams({repository:base?request.repository:request.headRepository,headRepository:request.headRepository,file:request.file,oldFile:base?(request.oldFile||request.file):request.file,head,status:base&&request.oldFile&&request.oldFile!==request.file?'renamed':'modified'});
    if(request.provider==='gitlab'){params.set('provider','gitlab');if(request.host)params.set('host',request.host);}if(base)params.set('base',base);
    // PR viewers use their existing merge-base comparison and do not mount this picker.
    if(request.pullNumber)throw new Error('Manual revision comparison is separate from the pull-request review.');
    return params;
  }
  function revisionTarget(request,value){
    if(request.provider==='gitlab')throw Error('Pull-request lookup currently supports GitHub projects. Use branch or commit comparison for GitLab.');
    const repository=request.pullRepository||request.repository;if(!data.validRepository(repository))throw Error('Invalid repository.');
    const text=String(value||'').trim();let path;
    if(/^#?[1-9][0-9]{0,8}$/.test(text))path='pull/'+text.replace(/^#/,'');
    else if(/^[0-9a-f]{7,40}$/i.test(text))path='commit/'+text;
    else {let url;try{url=new URL(text);}catch{}if(!url||url.origin!=='https://github.com'||url.username||url.password||url.search||url.hash)throw Error('Enter a commit SHA, #PR number, or a GitHub PR/commit URL for this repository.');
      const prefix='/'+repository+'/';if(!url.pathname.startsWith(prefix))throw Error('Choose a revision in '+repository+'.');path=url.pathname.slice(prefix.length).replace(/\/$/,'');
      if(!/^(?:commit\/[0-9a-f]{7,40}|pull\/[1-9][0-9]{0,8}(?:\/(?:files|commits|checks))?)$/i.test(path))throw Error('Unsupported revision URL.');
    }
    return 'https://github.com/'+repository+'/'+path;
  }
  function historyURL(request,value){
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Enter a GitHub or GitLab repository, commit, or pull request URL.');
    const path=url.pathname.replace(/\/$/,'');
    if(url.origin==='https://github.com'){
      const repository=path.split('/').slice(1,3).join('/');
      if(!data.validRepository(repository))throw Error('Enter a GitHub repository URL.');
      if(path==='/'+repository)return url.origin+path;
      return revisionTarget({repository},url.href);
    }
    if(url.origin!=='https://gitlab.com'&&(request.provider!=='gitlab'||url.origin!==request.host))throw Error('Use GitHub, GitLab.com, or this project’s GitLab host.');
    if(path.includes('/-/')||!data.validRepository(path.slice(1),'gitlab'))throw Error('Enter a GitLab repository URL.');
    return url.origin+path;
  }
  function panelBounds(anchor,width,height,panelHeight=560){
    const pad=8,w=Math.max(1,Math.min(580,width-pad*2)),h=Math.max(1,Math.min(panelHeight,height-pad*2));
    return {left:Math.max(pad,Math.min(anchor.right-w,width-pad-w)),top:Math.max(pad,Math.min(anchor.bottom+4,height-pad-h)),width:w,maxHeight:h};
  }
  function mount(options){
    const doc=options.holder.ownerDocument,request={...options.request};let epoch=0,disposed=false;let timeline=null,historyDialog=null,graphCommits=[],graphBranches=[],historyRef=null,graphBranchSelect=null,graphDismiss=null;const resolvedGraphHeads=new Map();
    const make=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
    const detail=make('details');detail.className='revision-picker';const summary=make('summary','History graph / compare');detail.append(summary);
    const panel=make('div');panel.className='revision-picker-panel';detail.append(panel);
    const close=make('button','×');close.type='button';close.className='popup-close';close.setAttribute('aria-label','Close history');close.title='Close history';panel.append(close);
    const host=doc.defaultView||root;
    const dismiss=()=>{detail.open=false;summary.focus?.();};
    const position=()=>{if(!detail.open||!summary.getBoundingClientRect||!panel.style)return;const viewport=host.visualViewport,b=panelBounds(summary.getBoundingClientRect(),viewport?.width||host.innerWidth,viewport?.height||host.innerHeight,Math.min(panel.scrollHeight||560,560));for(const [key,value]of Object.entries(b))panel.style[key]=value+'px';};
    const outside=event=>{if(detail.open&&!detail.contains?.(event.target)&&!event.composedPath?.().includes(detail))detail.open=false;};
    const escape=event=>{if(event.key==='Escape'&&detail.open){event.preventDefault?.();dismiss();}};
    close.addEventListener('click',dismiss);detail.addEventListener('toggle',position);doc.addEventListener?.('pointerdown',outside);doc.addEventListener?.('keydown',escape);host.addEventListener?.('resize',position);host.visualViewport?.addEventListener('resize',position);
    const advanced=make('details');advanced.append(make('summary','Manual revision comparison'));panel.append(advanced);
    const rows={};
    for(const side of ['base','head']){
      const repository=side==='base'?request.repository:request.headRepository,file=side==='base'?(request.oldFile||request.file):request.file;
      const row=make('label',`${side==='base'?'Base':'Head'} · ${repository}`),select=make('select'),input=make('input');select.setAttribute('aria-label',`${side} branches and file commits`);input.setAttribute('aria-label',`${side} branch, tag or commit`);input.placeholder='Branch, tag or commit SHA';input.value=side==='base'?request.base||'':request.head;input.maxLength=200;select.append(make('option','Choose listed revision'));select.firstChild.value='';select.addEventListener('change',()=>{if(select.value)input.value=select.value;});row.append(select,input);advanced.append(row);rows[side]={select,input,repository,file};
    }
    const actions=make('div'),load=make('button','Load branches + history'),compare=make('button','Compare revisions'),view=make('button','View head');for(const button of [load,compare,view])button.type='button';actions.append(load,compare,view);advanced.append(actions);
    const status=make('p');status.setAttribute('role','status');panel.append(status);options.holder.append(detail);
    const tell=text=>{status.textContent=text;};
    const busy=value=>{load.disabled=compare.disabled=view.disabled=value;};
    const send=async(type,row,ref)=>{const response=await options.send({type,...(request.provider==='gitlab'?{provider:'gitlab'}:{}),repository:row.repository,ref,file:row.file});if(!response?.ok)throw new Error(response?.error||'Repository history unavailable.');const result=response.result;if(result?.repository!==row.repository)throw new Error('Revision response repository does not match.');return result;};
    const historyLoad=make('button','Browse commit history'),historyList=make('ol');historyLoad.type='button';historyList.className='commit-history-list';historyList.setAttribute('aria-label','Commit history');panel.insertBefore?.(historyLoad,advanced);if(panel.insertBefore)panel.insertBefore(historyList,advanced);else panel.append(historyList);
    // Test/lightweight hosts without insertBefore still receive the real action.
    if(!panel.insertBefore)panel.append(historyLoad);
    async function openCommit(sha,compareCurrent=false){
      if(!SHA.test(sha))return;const ticket=++epoch;busy(true);
      try{let current=options.getCurrentRef?.()||request.head;if(compareCurrent&&!SHA.test(current))throw Error('Wait for the displayed revision to finish loading before comparing.');
        if(disposed||ticket!==epoch)return;
        if(compareCurrent){if(!SHA.test(current))throw Error('Current revision could not be resolved.');options.navigate(comparisonQuery({...request,repository:request.headRepository,oldFile:request.file},sha,current));}
        else options.navigate(comparisonQuery(request,null,sha));
      }catch(error){if(!disposed&&ticket===epoch)tell(error.message);}finally{if(ticket===epoch)busy(false);}
    }
    let historyTicket=0,historyWork=null,loadedHistory=null,branchWork=null,branchesReady=false;
    function displayedRef(){return options.getCurrentRef?.()||request.head;}
    function loadHistory({refresh=false}={}){
      const branch=historyRef,key=branch||displayedRef();
      if(historyWork?.key===key)return historyWork.promise;
      if(!refresh&&loadedHistory?.branch===branch&&(loadedHistory.key===key||!branch&&loadedHistory.snapshot===key)){
        if(historyWork){historyTicket++;historyWork=null;historyLoad.disabled=false;tell('');}
        return Promise.resolve(true);
      }
      const ticket=++historyTicket;
      historyLoad.disabled=true;tell('Loading commit history…');
      const promise=(async()=>{
        try{
          let target=key;
          if(branch&&!SHA.test(target)){
            const resolved=await send('revision-resolve',rows.head,target);
            if(disposed||ticket!==historyTicket)return;
            if(!SHA.test(resolved.sha))throw Error('History branch did not resolve to a saved commit.');
            target=resolved.sha;
            resolvedGraphHeads.set(branch,target);
            if(resolvedGraphHeads.size>100)resolvedGraphHeads.delete(resolvedGraphHeads.keys().next().value);
            const existing=graphBranches.find(entry=>entry.name===branch);
            if(existing)existing.sha=target;else graphBranches.push({name:branch,sha:target});
          }
          const result=await send('revision-commits',rows.head,target);
          if(disposed||ticket!==historyTicket)return;
          if(result.file!==request.file||SHA.test(target)&&result.snapshotRef!==target||!SHA.test(result.snapshotRef||'')||!Array.isArray(result.commits)||result.commits.length>50||result.commits.some(commit=>!SHA.test(commit.sha)))throw Error('Invalid bounded commit history.');
          loadedHistory={key,branch,snapshot:result.snapshotRef};
          graphCommits=result.commits;
          timeline?.update({loading:false,commits:graphCommits,branches:graphBranches,currentRef:displayedRef()});
          historyList.replaceChildren();
          if(!timeline)for(const commit of graphCommits){
            const row=make('li'),title=make('strong',String(commit.message||'Commit').split('\n')[0].slice(0,240)),meta=make('small',[commit.sha.slice(0,10),commit.author,commit.date].filter(Boolean).join(' · ')),actions=make('div'),open=make('button','Load commit'),compare=make('button','Compare with current');
            for(const button of [open,compare])button.type='button';
            open.addEventListener('click',()=>openCommit(commit.sha));compare.addEventListener('click',()=>openCommit(commit.sha,true));
            actions.append(open,compare);row.append(title,meta,actions);historyList.append(row);
          }
          position();tell('');return true;
        }catch(error){if(!disposed&&ticket===historyTicket)tell(error.message);}
        finally{if(!disposed&&ticket===historyTicket){historyWork=null;historyLoad.disabled=false;}}
      })();
      historyWork={key,promise};
      return promise;
    }
    function prepareHistory(refresh=false){
      if(disposed||!timeline)return Promise.resolve();
      const commits=loadHistory({refresh});
      if(!branchWork&&(refresh||!branchesReady))branchWork=loadGraphBranches().finally(()=>{branchWork=null;});
      return Promise.all([commits,branchWork]);
    }
    historyLoad.addEventListener('click',()=>loadHistory({refresh:true}));
    async function populate(){
      const ticket=++epoch;busy(true);tell('Loading bounded branch lists and file history…');
      try{
        const listings=new Map();for(const side of ['head','base']){const row=rows[side],ref=side==='head'?rows.head.input.value.trim()||request.head:rows.base.input.value.trim()||request.base||request.head;if(!data.validRef(ref))throw new Error('Enter a valid branch, tag or commit.');
          const key=JSON.stringify([row.repository,row.file,ref]);if(!listings.has(key)){const [branches,commits]=await Promise.all([send('revision-branches',row,ref),send('revision-commits',row,ref)]);listings.set(key,{branches,commits});}row.listing=listings.get(key);
        }
        if(disposed||ticket!==epoch)return;const warnings=new Set();
        for(const [side,row] of Object.entries(rows)){const {branches,commits}=row.listing;if(!Array.isArray(branches.branches)||branches.branches.length>100||!Array.isArray(commits.commits)||commits.commits.length>50||!SHA.test(commits.snapshotRef)||commits.file!==row.file)throw new Error('Invalid bounded revision listing.');
          row.select.replaceChildren();const placeholder=make('option','Choose branch or file commit');placeholder.value='';row.select.append(placeholder);
          const group=make('optgroup');group.label='Branches (resolved when chosen)';for(const branch of branches.branches){if(!data.validRef(branch.name)||branch.sha&&!SHA.test(branch.sha))throw new Error('Invalid branch revision.');const option=make('option',branch.name+(branch.sha?' · '+branch.sha.slice(0,10):''));option.value=branch.sha||branch.name;group.append(option);}row.select.append(group);
          const history=make('optgroup');history.label='Loaded repository commits';for(const commit of commits.commits){if(!SHA.test(commit.sha))throw new Error('Invalid file commit.');const option=make('option',`${commit.sha.slice(0,10)} · ${String(commit.date||'').slice(0,10)} · ${String(commit.message||'').slice(0,140)}`);option.value=commit.sha;history.append(option);}row.select.append(history);
          if(side==='base'&&!row.input.value&&commits.commits.length>1)row.input.value=commits.commits[1].sha;
          for(const warning of [...(branches.warnings||[]),...(commits.warnings||[])])warnings.add(String(warning).slice(0,500));
        }
        tell(`Lists loaded at immutable commits. ${[...warnings].join(' ')}`);
      }catch(error){if(!disposed&&ticket===epoch)tell(error.message);}finally{if(ticket===epoch)busy(false);}
    }
    async function openComparison(withBase){
      const ticket=++epoch;busy(true);tell('Resolving selected refs to immutable commits…');
      try{const values={};for(const side of withBase?['base','head']:['head']){const row=rows[side],ref=row.input.value.trim();if(!data.validRef(ref))throw new Error(`Enter a ${side} branch, tag or commit.`);const result=await send('revision-resolve',row,ref);if(!SHA.test(result.sha))throw new Error('The Git host returned an unresolved revision.');values[side]=result.sha;}
        if(disposed||ticket!==epoch)return;options.navigate(comparisonQuery(request,values.base||null,values.head));
      }catch(error){if(!disposed&&ticket===epoch)tell(error.message);}finally{if(ticket===epoch)busy(false);}
    }
    load.addEventListener('click',populate);compare.addEventListener('click',()=>openComparison(true));view.addEventListener('click',()=>openComparison(false));

    let graphBranchTicket=0;
    async function loadGraphBranches(){
      const ticket=++graphBranchTicket;
      try{
        const listing=await send('revision-branches',rows.head,options.getCurrentRef?.()||request.head);
        if(disposed||ticket!==graphBranchTicket)return;
        if(!Array.isArray(listing.branches)||listing.branches.length>100)throw Error('Invalid bounded branch listing.');
        if(listing.branches.some(b=>!b||!data.validRef(b.name)||b.sha&&!SHA.test(b.sha)))throw Error('Invalid branch metadata.');graphBranches=listing.branches.map(b=>({...b,...(resolvedGraphHeads.has(b.name)?{sha:resolvedGraphHeads.get(b.name)}:{})}));
        graphBranchSelect.title='';graphBranchSelect.replaceChildren();
        const current=make('option','Displayed revision');current.value='';graphBranchSelect.append(current);
        for(const branch of graphBranches){const option=make('option',branch.name+(branch.isDefault?' · default':''));option.value=branch.name;graphBranchSelect.append(option);}
        const manual=make('option','Enter another branch or commit…');manual.value=':manual';graphBranchSelect.append(manual);if(historyRef&&![...graphBranchSelect.children].some(option=>option.value===historyRef)){
          const option=make('option',SHA.test(historyRef)?'Commit · '+historyRef.slice(0,10):historyRef);option.value=historyRef;graphBranchSelect.append(option);
        }
        graphBranchSelect.value=historyRef||'';branchesReady=true;
        timeline?.update({commits:graphCommits,branches:graphBranches,currentRef:options.getCurrentRef?.()||request.head});
      }catch(error){if(!disposed&&ticket===graphBranchTicket)graphBranchSelect.title=error.message;}
    }
    let discoveryTicket=0;
    function graphWorkspace(){
      if(!root.KiCadHistoryTimeline)return;
      const embedded=Boolean(options.workspaceHolder),dialog=make(embedded?'section':'dialog');dialog.className='history-workspace-dialog'+(embedded?' history-workspace-inline':'');dialog.hidden=embedded;if(embedded)dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Repository history and visual comparison');
      const header=make('header'),title=make('h2','History'),searchHolder=make('div'),controlsHolder=make('div'),exit=make('button','×');
      title.title=request.headRepository+' · '+request.file;
      searchHolder.className='history-workspace-search';
      controlsHolder.className='history-workspace-controls';
      const refresh=make('button','↻');refresh.type='button';refresh.className='history-icon-button';
      refresh.title='Refresh history';refresh.setAttribute('aria-label',refresh.title);
      const refreshGlyph=make('span','↻');refreshGlyph.setAttribute('aria-hidden','true');
      if(root.KiCadUIIcons)refreshGlyph.replaceChildren(root.KiCadUIIcons.icon('refresh'));
      refresh.replaceChildren(refreshGlyph);
      refresh.addEventListener('click',async()=>{
        if(refresh.disabled)return;
        refresh.disabled=true;refresh.setAttribute('aria-busy','true');
        try{await prepareHistory(true);}
        finally{refresh.disabled=false;refresh.setAttribute('aria-busy','false');}
      });controlsHolder.append(refresh);
      exit.type='button';exit.className='history-icon-button';exit.setAttribute('aria-label','Close history');exit.title='Close history';header.append(title,searchHolder,controlsHolder,exit);
      const more=make('div'),done=make('button','Back to history');
      more.className='history-workspace-secondary';more.hidden=true;done.type='button';
      const showTools=(section,focus)=>{for(const panel of [tools,discovery,advanced])panel.hidden=panel!==section;more.hidden=false;focus?.focus?.();};
      const hideTools=()=>{more.hidden=true;searchHolder.firstChild?.focus?.();};
      done.addEventListener('click',hideTools);
      const tools=make('div');tools.className='history-workspace-tools';graphBranchSelect=make('select');graphBranchSelect.setAttribute('aria-label','History branch');header.insertBefore?.(graphBranchSelect,controlsHolder);
      if(!header.insertBefore)header.append(graphBranchSelect);
      const displayed=make('option','Displayed revision');displayed.value='';graphBranchSelect.append(displayed);
      const branchInput=make('input');branchInput.placeholder='Branch name or commit SHA';branchInput.setAttribute('aria-label','History branch name or commit');
      const browse=make('button','Browse branch');branchInput.hidden=browse.hidden=true;browse.type='button';
      const choose=async value=>{if(value&&!data.validRef(value)){tell('Enter a valid branch or commit.');return;}historyRef=value||null;const loaded=await loadHistory();if(loaded&&!disposed&&historyRef===(value||null)){if(value&&![...graphBranchSelect.children].some(o=>o.value===value)){const option=make('option',SHA.test(value)?'Commit · '+value.slice(0,10):value);option.value=value;graphBranchSelect.append(option);}graphBranchSelect.value=value||'';branchInput.hidden=browse.hidden=true;if(!more.hidden&&!tools.hidden)hideTools();}};
      graphBranchSelect.addEventListener('change',()=>{const manual=graphBranchSelect.value===':manual';branchInput.hidden=browse.hidden=!manual;if(manual){showTools(tools,branchInput);return;}return choose(graphBranchSelect.value);});browse.addEventListener('click',()=>choose(branchInput.value.trim()));
      branchInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();choose(branchInput.value.trim());}});
      tools.append(branchInput,browse);
      const discovery=make('section'),pullsButton=make('button','Browse pull requests'),pullList=make('div'),lookupStatus=make('p');discovery.className='revision-discovery';discovery.setAttribute('aria-label','Pull requests');lookupStatus.setAttribute('role','status');pullList.className='revision-pull-list';pullsButton.type='button';
      function launch(source){
        if(!options.openRevision)throw Error('Revision launching is unavailable in this host.');
        return options.openRevision(source);
      }
      async function submitSearch(value){
        if(/^https?:\/\//i.test(value))return launch(historyURL(request,value));
        if(/^#[1-9][0-9]{0,8}$/.test(value))return launch(revisionTarget(request,value));
        if(!/^[a-f0-9]{7,40}$/i.test(value))return;
        const matches=graphCommits.filter(commit=>commit.sha.toLowerCase().startsWith(value.toLowerCase()));
        if(matches.length===1)return openCommit(matches[0].sha);
        if(matches.length>1)throw Error('Enter more characters to identify one commit.');
        if(request.provider!=='gitlab')return launch(revisionTarget(request,value));
        const result=await send('revision-resolve',rows.head,value);
        if(!SHA.test(result.sha)||!result.sha.toLowerCase().startsWith(value.toLowerCase()))throw Error('The requested commit could not be resolved.');
        if(!disposed)await openCommit(result.sha);
      }
      pullsButton.hidden=request.provider==='gitlab';pullsButton.addEventListener('click',async()=>{const ticket=++discoveryTicket;pullsButton.disabled=true;lookupStatus.textContent='Loading pull requests from your repository website session…';try{
        const repository=request.pullRepository||request.repository,response=await options.send({type:'revision-pulls',repository,ref:options.getCurrentRef?.()||request.head,file:request.file});if(!response?.ok)throw Error(response?.error||'Pull requests unavailable.');const result=response.result;
        if(disposed||ticket!==discoveryTicket)return;if(result?.repository!==repository||!Array.isArray(result.pulls)||result.pulls.length>50)throw Error('Invalid bounded pull-request listing.');
        const entries=result.pulls.map(pull=>{if(!Number.isSafeInteger(pull.number)||pull.number<1)throw Error('Invalid pull-request number.');const source=revisionTarget(request,'#'+pull.number);if(pull.url&&pull.url!==source)throw Error('Pull-request repository does not match.');return {pull,source};});pullList.replaceChildren();
        for(const {pull,source}of entries){const row=make('button','#'+pull.number+' · '+String(pull.title||'Pull request').slice(0,240)+(pull.state?' · '+String(pull.state).slice(0,24):''));row.type='button';row.addEventListener('click',()=>{try{launch(source);}catch(error){lookupStatus.textContent=error.message;}});pullList.append(row);}
        lookupStatus.textContent=result.hasMore?'More results are available on GitHub.':entries.length?'':'No pull requests found.';
      }catch(error){if(!disposed&&ticket===discoveryTicket)lookupStatus.textContent=error.message;}finally{if(!disposed&&ticket===discoveryTicket)pullsButton.disabled=false;}});
      discovery.append(pullsButton,lookupStatus,pullList);
      const holder=make('div');holder.className='history-workspace-body';
      timeline=root.KiCadHistoryTimeline.mount({holder,searchHolder,controlsHolder,repository:request.headRepository,onSearchSubmit:submitSearch,loading:true,commits:[],branches:[],actions:[
        ...(request.provider!=='gitlab'?[['Browse pull requests…',()=>{showTools(discovery,pullsButton);pullsButton.click();}]]:[]),
        ['Compare by revision…',()=>{advanced.open=true;showTools(advanced,rows.base.input);}]
      ],currentRef:options.getCurrentRef?.()||request.head,onOpen:sha=>openCommit(sha),onCompareCurrent:sha=>openCommit(sha,true),onCompare:(base,head)=>{
        if(disposed||!SHA.test(base)||!SHA.test(head)||base===head)return;
        const query=comparisonQuery({...request,repository:request.headRepository,oldFile:request.file},base,head);
        (options.navigateComparison||options.navigate)(query);
      },onError:error=>tell(error?.message||String(error))});
      more.append(done,tools,discovery,advanced);
      dialog.append(header,more,status,holder);(options.workspaceHolder||doc.body).append(dialog);historyDialog=dialog;if(embedded)detail.hidden=true;
      const closeGraph=({restoreFocus=true}={})=>{
        if(disposed||(embedded?dialog.hidden:!dialog.open))return;
        if(embedded)dialog.hidden=true;else dialog.close();
        epoch++;busy(false);timeline?.closeMenu?.();more.hidden=true;options.onCloseGraph?.();
        if(restoreFocus)(options.graphTrigger?.()||summary).focus?.();
      };
      graphDismiss=closeGraph;exit.addEventListener('click',()=>closeGraph());
      dialog.addEventListener('cancel',event=>{event.preventDefault?.();closeGraph();});
      dialog.addEventListener('keydown',event=>{
        if(event.key!=='Escape'||event.defaultPrevented||!embedded&&more.hidden)return;
        event.preventDefault();event.stopPropagation();if(more.hidden)closeGraph();else hideTools();
      });
      const openGraph=()=>{
        if(disposed)return Promise.resolve();
        detail.open=false;dialog.dataset.theme=doc.body.dataset?.uiTheme||'dark';
        if(embedded){dialog.hidden=false;options.onOpenGraph?.();exit.focus?.();}
        else if(!dialog.open)dialog.showModal();
        busy(false);
        return prepareHistory();
      };
      summary.addEventListener('click',event=>{event.preventDefault();openGraph();});
      historyLoad.addEventListener('click',()=>{if(!dialog.open)openGraph();});
      return openGraph;
    }
    const openGraph=graphWorkspace();
    const closeGraph=options=>graphDismiss?.(options);
    if(options.preloadHistory)void prepareHistory();

    return {populate,openComparison,loadHistory,openCommit,openGraph,closeGraph,dispose(){disposed=true;epoch++;historyTicket++;graphBranchTicket++;discoveryTicket++;timeline?.dispose();historyDialog?.remove();doc.removeEventListener?.('pointerdown',outside);doc.removeEventListener?.('keydown',escape);host.removeEventListener?.('resize',position);host.visualViewport?.removeEventListener('resize',position);detail.remove();}};
  }
  const api={comparisonQuery,revisionTarget,historyURL,mount,panelBounds};root.KiCadRevisionPicker=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
