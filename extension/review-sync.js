/* Foreground provider refresh. Observed authors are not online presence. */
((root)=>{
 'use strict';
 function participants(result){
  const people=new Map(),seen=new Set();
  function visit(value,depth=0){
   if(!value||typeof value!=='object'||depth>5||seen.has(value))return;seen.add(value);
   if(Array.isArray(value)){for(const item of value.slice(0,1000))visit(item,depth+1);return;}
   const author=value.author||value.user;
   const login=typeof author==='string'?author:author?.login||author?.username;
   if(typeof login==='string'&&login.length<=100&&/^[\w.@-]+$/.test(login)){
    const name=typeof author?.name==='string'?author.name.slice(0,200):login;
    people.set(login.toLowerCase(),{login,name});
   }
   for(const key of ['messages','comments','notes','items','replies','thread','discussion'])visit(value[key],depth+1);
  }
  visit(result);return [...people.values()].slice(0,100);
 }
 function create({load,onUpdate=()=>{},onState=()=>{},isVisible=()=>!root.document?.hidden,isOnline=()=>root.navigator?.onLine!==false,
   setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),now=()=>Date.now(),intervalMs=30000,maxIntervalMs=180000}={}){
   if(typeof load!=='function')throw Error('A provider refresh function is required.');
   const interval=Math.max(5000,Math.min(60000,Number(intervalMs)||30000)),maximum=Math.max(interval,Math.min(600000,Number(maxIntervalMs)||180000));
  let scope=null,generation=0,running=false,disposed=false,active=false,timer=null,again=false,failures=0,syncedAt=null,state='idle';
  const report=(status,detail={})=>{state=status;onState({status,syncedAt,...detail});};
  const cancel=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
  function schedule(delay){cancel();if(active&&!disposed&&isVisible())timer=setTimer(()=>{timer=null;void refresh();},delay);}
  async function refresh(){
   cancel();if(disposed||!active)return;
   if(!isVisible()){report('paused');return;}
   if(running){again=true;return;}
   if(!isOnline()){report('offline');schedule(maximum);return;}
   running=true;again=false;const version=generation,current=scope;
   try{
    report('syncing');const result=await load(current);
    if(!disposed&&active&&version===generation&&isVisible()){
     failures=0;syncedAt=now();await onUpdate(result,{scope:current,syncedAt,participants:participants(result)});
     if(!disposed&&active&&version===generation)report('synced');
    }
   }catch(error){
    if(!disposed&&active&&version===generation){failures=Math.min(failures+1,8);report(isOnline()?'error':'offline',{error});}
   }finally{
    running=false;
    if(!disposed&&active){const immediate=again||version!==generation;again=false;schedule(immediate?0:Math.min(maximum,interval*2**failures));}
   }
  }
  return {
   start(value=scope){if(disposed)return;scope=value;generation++;active=true;void refresh();},
   setScope(value){if(disposed)return;scope=value;generation++;failures=0;syncedAt=null;if(active)void refresh();},
   refresh,
   visibilityChanged(){if(disposed)return;cancel();generation++;if(active&&isVisible())void refresh();else if(active)report('paused');},
   dispose(){disposed=true;active=false;generation++;cancel();report('stopped');},
   snapshot(){return{status:state,scope,syncedAt,running,active:active&&!disposed};}
  };
 }
 root.KiCadReviewSync={create,participants};if(typeof module==='object'&&module.exports)module.exports=root.KiCadReviewSync;
})(globalThis);
