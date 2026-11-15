/* Local preparation jobs and an accessible, paintable loading surface. */
((root)=>{
  'use strict';
  const workerURL=new URL('load-worker.js',document.currentScript?.src||location.href).href;
  const logoURL=new URL(root.KiCadAndroidRuntime?'app-logo.png':'icons/icon48.png',document.currentScript?.src||location.href).href;
  if(document.head){const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('loading-ui.css',document.currentScript?.src||location.href).href;document.head.append(style);}
  const cancelled=()=>Object.assign(new Error('Loading stopped.'),{name:'AbortError'});
  function duration(ms){const seconds=Math.floor(ms/1000);return seconds>=3600?`${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min`:seconds>=60?`${Math.floor(seconds/60)} min ${seconds%60} s`:`${seconds} s`;}
  function indicator(host,{onStop,fullscreen=false}={}){
    const pane=document.createElement('div');pane.className='loading-surface';pane.hidden=true;pane.setAttribute('role','status');pane.setAttribute('aria-live','polite');
    if(typeof pane.showPopover==='function')pane.setAttribute('popover','manual');
    if(fullscreen)pane.classList.add('loading-fullscreen');
    const bar=document.createElement('progress');bar.className='loading-bar';bar.setAttribute('aria-label','Loading');
    const copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');title.textContent=fullscreen?'Opening your project':'Loading';copy.append(title,detail);pane.append(bar,copy);if(fullscreen||root.KiCadAndroidRuntime||document.body?.classList?.contains('android-home')){const logo=document.createElement('img');logo.className='loading-logo';logo.src=logoURL;logo.alt='';logo.width=36;logo.height=36;logo.setAttribute('aria-hidden','true');pane.append(logo);pane.classList.add('loading-branded');}host.append(pane);
    let started=0,timer=null,delay=null,active=false,stopping=false,stopAction=onStop;
    const elapsed=document.createElement('small');copy.append(elapsed);
    const stop=document.createElement('button');stop.type='button';stop.className='loading-stop';stop.textContent='Stop';stop.hidden=typeof stopAction!=='function';stop.setAttribute('aria-label','Stop loading');pane.append(stop);
    stop.onclick=()=>{if(!active||stopping||typeof stopAction!=='function')return;stopping=true;stop.disabled=true;detail.textContent='Stopping…';try{Promise.resolve(stopAction()).catch(error=>{detail.textContent=error.message||'Could not stop loading.';stopping=false;stop.disabled=false;});}catch(error){detail.textContent=error.message||'Could not stop loading.';stopping=false;stop.disabled=false;}};
    return {setStop(action){stopAction=action;stop.hidden=typeof action!=='function';stopping=false;stop.disabled=false;},stop(){stop.onclick();},show(stage,progress){
      if(stopping)return;
      detail.textContent=stage||'Please wait…';
      if(Number.isFinite(progress)){bar.max=1;bar.value=Math.max(0,Math.min(1,progress));}else bar.removeAttribute?.('value');
      host.setAttribute('aria-busy','true');
      if(active)return;active=true;started=Date.now();elapsed.textContent='';
      const reveal=()=>{delay=null;if(!active)return;pane.hidden=false;try{pane.showPopover?.();}catch{}
        const tick=()=>{elapsed.textContent=duration(Date.now()-started);};tick();timer=setInterval(tick,1000);
      };if(fullscreen)reveal();else delay=setTimeout(reveal,300);
    },hide(){active=false;stopping=false;stop.disabled=false;try{pane.hidePopover?.();}catch{}pane.hidden=true;host.setAttribute('aria-busy','false');clearTimeout(delay);delay=null;clearInterval(timer);timer=null;},dispose(){this.hide();pane.remove();}};
  }
  const activities=new Map();let activityUI=null;
  function activity(stage,{onStop}={}){
    if(!activityUI)activityUI=indicator(document.body);
    const token={};const render=()=>{const last=[...activities.values()].at(-1);if(last){activityUI.setStop(last.stop);activityUI.show(last.stage,last.progress);}else activityUI.hide();};
    let ended=false;
    const end=()=>{if(ended)return;ended=true;activities.delete(token);render();};
    const stop=typeof onStop==='function'?()=>{try{return Promise.resolve(onStop()).finally(end);}catch(error){end();throw error;}}:undefined;
    activities.set(token,{stage,stop});render();
    return {update(text,progress){if(!ended){activities.set(token,{stage:text,progress,stop});render();}},end};
  }
  function track(promise,stage='Loading…',options={}){const task=activity(stage,options);return Promise.resolve(promise).finally(()=>task.end());}
  function paint(){return typeof requestAnimationFrame==='function'?new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))):Promise.resolve();}
  function run(job,payload,fallback,{onStage=()=>{},signal}={}){
    if(signal?.aborted)return Promise.reject(new Error('Loading cancelled.'));
    const fallbackRun=()=>paint().then(()=>{if(signal?.aborted)throw cancelled();const length=typeof payload?.content==='string'?payload.content.length:(payload?.files||[]).reduce((n,f)=>n+(f.content?.length||0),0);if(length>512*1024)throw Error('Background preparation is unavailable. Reload or update this viewer before opening a large design.');return fallback();});
    if(typeof Worker!=='function')return fallbackRun();
    return new Promise((resolve,reject)=>{
      let worker,timer,settled=false,blobURL=null;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();if(blobURL)URL.revokeObjectURL(blobURL);error?reject(error):resolve(value);};
      const abort=()=>finish(cancelled());
      signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(new Error('Preparation exceeded two minutes. Try opening a smaller project.')),120000);
      if(signal?.aborted){abort();return;}
      const launch=async()=>{
        let url=workerURL;
        if(root.KiCadVSCodeContext&&!root.KiCadAndroidRuntime){
          const bundled=root.KiCadVSCodeContext.loadWorkerUrl;
          if(!bundled){fallbackRun().then(value=>finish(null,value),error=>finish(error));return;}
          const response=await fetch(bundled,{signal,credentials:'omit',redirect:'error'});
          if(!response.ok)throw Error('The bundled loading worker could not be read. Reload the extension.');
          const text=await response.text();if(text.length>2*1024*1024)throw Error('Loading worker exceeds its resource limit.');
          if(settled)return;blobURL=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));url=blobURL;
        }
        if(settled)return;
        try{worker=new Worker(url);}catch(error){if(root.KiCadVSCodeContext&&!root.KiCadAndroidRuntime)throw error;fallbackRun().then(value=>finish(null,value),error=>finish(error));return;}
        worker.onmessage=event=>{if(settled)return;const value=event.data;if(value?.stage){onStage(value.stage);return;}if(value?.ok)finish(null,value.result);else finish(new Error(value?.error||'KiCad preparation failed.'));};
        worker.onerror=()=>finish(new Error('The loading worker could not start. Reload the extension and retry.'));
        worker.postMessage({job,payload});
      };
      launch().catch(error=>finish(error));
    });
  }
  root.KiCadLoading={indicator,activity,track,paint,run,duration};
})(globalThis);
