package dev.kicadvizdiff.android;

import android.app.*;
import android.content.Intent;
import android.os.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.*;

/** Opt-in pinned public Marble acceptance. No remote APIs or account access. */
final class MarbleEngineeringChecks {
    final android.app.Instrumentation test;final MobileEngineeringChecks ui;
    final JSONObject report=new JSONObject();
    MarbleEngineeringChecks(android.app.Instrumentation test){this.test=test;ui=new MobileEngineeringChecks(test);}
    String js(String expression)throws Exception{return ui.js(expression);}
    void waitFor(String expression,int seconds)throws Exception{long end=SystemClock.elapsedRealtime()+seconds*1000L,next=SystemClock.elapsedRealtime()+10000;while(SystemClock.elapsedRealtime()<end){if("true".equals(js(expression))){ui.checks++;return;}if(SystemClock.elapsedRealtime()>next){Bundle progress=new Bundle();progress.putString("stream","Marble wait: "+js("JSON.stringify((()=>{const scan=(w,depth)=>{try{return {path:w.location.pathname,status:['importStatus','projectStatus','drawingHost'].map(id=>[id,w.document.getElementById(id)?.textContent.slice(0,600)]),frames:depth<3?[...w.document.querySelectorAll('iframe')].map(f=>scan(f.contentWindow,depth+1)):[]};}catch(e){return{error:e.message};}};return scan(window,0);})())")+"\n");test.sendStatus(0,progress);next=SystemClock.elapsedRealtime()+15000;}Thread.sleep(200);}throw new AssertionError("Timed out: "+expression+"; "+js("window.__mobileW?.document.querySelector('.fast-pi-status')?.textContent||window.__mobileW?.document.querySelector('.draftsman-status')?.textContent"));}
    void solve(int net,double x,double y,String layer,double sx,double sy,String sinkLayer,double volts,double amps)throws Exception{
        long started=SystemClock.elapsedRealtime();
        js("(()=>{const w=__mobileW,d=w.document;d.querySelector('.fast-pi-panel button[aria-label=\"Close Fast DC drop\"]')?.click();d.getElementById('openFastPI').click();const p=d.querySelector('.fast-pi-panel'),n=p.querySelector('[name=net]');n.value=[...n.options].findIndex(o=>o.textContent.includes("+JSONObject.quote(net==312?"+1V8_USB":"Net-(C383-Pad1)")+"));n.dispatchEvent(new w.Event('input',{bubbles:true}));for(const [name,value]of [['voltage',"+volts+"],['current',"+amps+"],['conductivity',58000000],['grid',"+(net==656?.05:.1)+"],['plating',.025]]){const e=p.querySelector('[name='+name+']');e.value=value;e.dispatchEvent(new w.Event('input',{bubbles:true}));}p.querySelector('[name=layer]').value="+JSONObject.quote(layer)+";const c=w.__mobileCamera;c.bbox={x:"+(Math.min(x,sx)-3)+",y:"+(Math.min(y,sy)-3)+",w:"+(Math.abs(x-sx)+6)+",h:"+(Math.abs(y-sy)+6)+"};d.getElementById('zoomIn').click();p.querySelector('.fast-pi-actions button').click();})();true");
        if(net==656){
            ui.tapElement(".fast-pi-source");ui.check("!!__mobileW.document.querySelector('.fast-pi-contact-picker[open]')","Source suggestions did not open");ui.capture("marble-contact-suggestions");
            ui.tapElement(".fast-pi-contact-option[data-reference='R195'][data-pin='1'][data-layer='F.Cu']");
            ui.tapElement(".fast-pi-load");js("(()=>{const w=__mobileW,d=w.document,p=d.querySelector('.fast-pi-contact-picker'),layer=p.querySelector('[aria-label=\"Contact suggestion layer\"]'),search=p.querySelector('[aria-label=\"Search contact suggestions\"]');layer.value='B.Cu';layer.dispatchEvent(new w.Event('change',{bubbles:true}));search.value='L34';search.dispatchEvent(new w.Event('input',{bubbles:true}));})();true");
            test.runOnMainSync(()->ui.probe.activity.setRequestedOrientation(0));waitFor("innerWidth>innerHeight",15);
            ui.check("__mobileW.document.querySelector('[aria-label=\"Search contact suggestions\"]').value==='L34'","Contact search was lost on rotate");ui.capture("marble-contact-landscape");
            test.runOnMainSync(()->ui.probe.activity.setRequestedOrientation(1));waitFor("innerWidth<innerHeight",15);
            ui.tapElement(".fast-pi-contact-option[data-reference='L34'][data-pin='1'][data-layer='B.Cu']");
        }else{
            ui.tap(x,y);ui.check("__mobileW.document.querySelector('.fast-pi-status').textContent.includes('Source set')","Marble source tap was not accepted");
            js("(()=>{const w=__mobileW,e=w.document.querySelector('.fast-pi-panel [name=layer]');e.value="+JSONObject.quote(sinkLayer)+";e.dispatchEvent(new w.Event('change',{bubbles:true}));})();true");ui.tap(sx,sy);
        }
        ui.check("__mobileW.document.querySelector('.fast-pi-status').textContent.includes('Contacts set')","Marble load contact was not accepted");
        js("window.__marbleSolveStarted=performance.now();__mobileW.__marbleResult=null;__mobileW.document.querySelector('.fast-pi-solve').click();true");
        waitFor("!!__mobileW.__marbleResult||(__mobileW.document.querySelector('.fast-pi-status').textContent.startsWith('Fast DC drop:'))",45);
        ui.check("!!__mobileW.__marbleResult","Marble solve failed: "+js("__mobileW.document.querySelector('.fast-pi-status').textContent"));
        String data=(String)new JSONTokener(js("JSON.stringify((()=>{const r=__mobileW.__marbleResult;return {voltageV:r.voltageV,dropV:r.dropV,currentA:r.currentA,lossW:r.lossW,residualA:r.residualA,iterations:r.iterations,nodes:r.nodes.length,edges:r.edges.length,viaEdges:r.edges.filter(e=>e.kind==='via').length,workerMs:__mobileW.__marbleWorkerMs};})())")).nextValue();JSONObject result=new JSONObject(data);
        if(!(result.getDouble("dropV")>0&&Math.abs(result.getDouble("lossW")-amps*result.getDouble("dropV"))<Math.max(1e-8,result.getDouble("lossW")*1e-5)))throw new AssertionError("Marble current/power conservation failed");
        if(!layer.equals(sinkLayer)&&result.getInt("viaEdges")==0)throw new AssertionError("Cross-layer result lacks via edges");
        result.put("workflowMs",SystemClock.elapsedRealtime()-started).put("source",new JSONArray().put(x).put(y).put(layer)).put("sink",new JSONArray().put(sx).put(sy).put(sinkLayer)).put("assumedVoltageV",volts).put("assumedLoadA",amps).put("assumedConductivitySm",58000000).put("assumedViaPlatingMm",.025);
        ui.check("__mobileW.document.querySelector('.fast-pi-overlay image[mask]')!==null","No masked smooth result overlay");ui.capture("marble-fast-pi-"+net);
        for(String metric:new String[]{"current","density","loss","voltage"}){
            js("(()=>{const w=__mobileW,e=w.document.querySelector('.fast-pi-panel [name=metric]');window.__metricStart=performance.now();e.value="+JSONObject.quote(metric)+";e.dispatchEvent(new w.Event('change',{bubbles:true}));window.__metricMs=performance.now()-__metricStart;})();true");
            result.put(metric+"DisplayMs",Double.parseDouble(js("__metricMs")));
            ui.check("!!__mobileW.document.querySelector('.fast-pi-overlay image[mask]')","Metric change lost the smooth overlay");
        }
        js("(()=>{const w=__mobileW,e=w.document.querySelector('.fast-pi-panel [name=display]');e.value='mesh';e.dispatchEvent(new w.Event('change',{bubbles:true}));})();true");
        ui.check("!!__mobileW.document.querySelector('.fast-pi-overlay path[stroke]')","Diagnostic mesh cannot be enabled");
        js("(()=>{const w=__mobileW,e=w.document.querySelector('.fast-pi-panel [name=display]');e.value='smooth';e.dispatchEvent(new w.Event('change',{bubbles:true}));})();true");
        js("__mobileW.document.querySelector('.fast-pi-panel [name=isolate]').click();true");ui.capture("marble-fast-pi-"+net+"-isolated");
        report.put("net"+net,result);
    }
    Bundle run(){Bundle result=new Bundle();JSONObject project=null;DiskProjectStore store=null;try{
        File directory=new File(test.getTargetContext().getExternalFilesDir(null),"marble-acceptance"),board=new File(directory,"Marble.kicad_pcb");
        if(board.length()!=44059775)throw new IOException("Expected retained full44MB Marble source");MessageDigest hash=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(board)){byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))!=-1)hash.update(bytes,0,n);}StringBuilder hex=new StringBuilder();for(byte b:hash.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));if(!hex.toString().equals("482850dbaaef9157e2e98af765a3c0d4d9c9f800daae224a54bf10e0621f52b0"))throw new IOException("Marble source hash mismatch");
        report.put("repository","BerkeleyLab/Marble").put("commit","a426777d92c0f22a546d4740b419a3937e0c1f90").put("boardSha256",hex.toString()).put("boardBytes",board.length());
        ui.probe.activity=(MainActivity)test.startActivitySync(new Intent(test.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));test.runOnMainSync(()->{ui.probe.activity.setTurnScreenOn(true);ui.probe.activity.getWindow().addFlags(128);ui.probe.activity.setRequestedOrientation(1);});
        if(test.getTargetContext().getSystemService(android.app.KeyguardManager.class).isKeyguardLocked())throw new IllegalStateException("Phone is locked; unlock it before measuring Marble loading or touch interaction.");
        var field=MainActivity.class.getDeclaredField("webView");field.setAccessible(true);ui.probe.web=(android.webkit.WebView)field.get(ui.probe.activity);ui.waitFor("!!window.KiCadAndroid?.receiveProject");
        store=new DiskProjectStore(test.getTargetContext());project=store.importProject("Marble phone acceptance",new JSONArray().put(new JSONObject().put("type","blob").put("mode","100644").put("path","design/Marble.kicad_pcb").put("size",board.length())),(path,target,size)->{try(InputStream in=new FileInputStream(board);OutputStream out=new FileOutputStream(target)){byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);}},null,true,1);
        var record=MainActivity.class.getDeclaredMethod("recordProject",JSONObject.class,String.class,boolean.class);record.setAccessible(true);final JSONObject bound=project;test.runOnMainSync(()->{try{record.invoke(ui.probe.activity,bound,null,false);}catch(Exception e){throw new RuntimeException(e);}});
        long start=SystemClock.elapsedRealtime();js("document.getElementById('androidQuickStart')?.close();window.KiCadAndroid.receiveProject("+project+");true");
        waitFor("(()=>{const find=w=>{try{if(w.document.getElementById('openFastPI')&&w.document.querySelector('.owned-canvas'))return w;for(let i=0;i<w.frames.length;i++){const found=find(w.frames[i]);if(found)return found;}}catch{}return null;};window.__mobileW=find(window);return !!__mobileW;})()",180);report.put("loadMs",SystemClock.elapsedRealtime()-start);
        js("(()=>{const w=__mobileW,NativeWorker=w.Worker;w.Worker=class extends NativeWorker{constructor(...a){super(...a);this.addEventListener('message',e=>{if(e.data?.ok&&e.data.result?.nodes){w.__marbleResult=e.data.result;w.__marbleWorkerMs=performance.now()-w.__marbleWorkerStart;}});}postMessage(...a){w.__marbleWorkerStart=performance.now();return super.postMessage(...a);}};const p=w.KiCadOwnedCanvas.Camera.prototype,old=p.world_to_screen;p.world_to_screen=function(...a){w.__mobileCamera=this;return old.apply(this,a);};w.document.getElementById('fitDrawing').click();window.__mobileScreen=(x,y)=>{const q=w.__mobileCamera.world_to_screen({x,y}),r=w.document.querySelector('.owned-canvas').getBoundingClientRect();let left=r.left,top=r.top,v=w;while(v!==window){const f=v.frameElement.getBoundingClientRect();left+=f.left;top+=f.top;v=v.parent;}return[left+q.x,top+q.y];};})();true");ui.capture("marble-layout");
        report.put("draftsmanAction",js("JSON.stringify((()=>{const w=__mobileW,b=w.document.getElementById('openDraftsman');return{disabled:b.disabled,connected:b.isConnected,frame:w.frameElement?.isConnected,handler:typeof b.onclick,module:typeof w.KiCadDraftsmanWorkspace?.open};})())"));
        ui.check("typeof __mobileW.KiCadDraftsmanWorkspace?.open==='function'&&!__mobileW.document.getElementById('openDraftsman').disabled","Draftsman unavailable: "+report.get("draftsmanAction"));
        js("__mobileW.document.querySelector('.fast-pi-panel button[aria-label=\"Close Fast DC drop\"]')?.click();const w=__mobileW,open=w.KiCadDraftsmanWorkspace.open;w.KiCadDraftsmanWorkspace.open=async(...a)=>{w.__mobileDraftStarted=true;return w.__mobileDraft=await open(...a).catch(e=>{w.__mobileDraftError=e.message;throw e;});};window.__marbleDraftStart=performance.now();w.document.getElementById('openDraftsman').click();true");
        ui.check("__mobileW.__mobileDraftStarted===true","Draftsman action did not dispatch");
        waitFor("!!__mobileW.__mobileDraftError||(!!__mobileW.__mobileDraft?.getDocument&&!!__mobileW.document.querySelector('.draftsman-stage svg'))",180);ui.check("!__mobileW.__mobileDraftError","Draftsman failed: "+js("__mobileW.__mobileDraftError"));report.put("draftsmanOpenMs",Double.parseDouble(js("performance.now()-__marbleDraftStart")));ui.capture("marble-draftsman-top");
        ui.check("__mobileW.__mobileDraft.getDocument().pages[0].items.some(i=>i.renderMode==='mechanical3d')","No mechanical drawing asset");
        js("__mobileW.document.querySelector('.draftsman-tools-disclosure').open=true;[...__mobileW.document.querySelectorAll('.draftsman button')].find(b=>b.getAttribute('aria-label')==='Auto dimensions').click();true");ui.check("__mobileW.__mobileDraft.getDocument().pages[0].items.filter(i=>i.type==='dimension').length>=2","Marble automatic dimensions missing");ui.capture("marble-draftsman-dimensions");
        ui.check("(()=>{const d=__mobileW.document,s=d.querySelector('.draftsman-stage').getBoundingClientRect(),p=d.querySelector('.draftsman-stage>[role=img]').getBoundingClientRect();return s.height>__mobileW.innerHeight*.6&&p.width>100&&p.height>50&&p.width<=s.width&&p.height<=s.height;})()","Marble sheet is squashed or not fitted on phone");
        js("(()=>{const w=__mobileW,d=w.document,e=d.querySelector('[aria-label=\"Sheet zoom\"]');e.value='2';e.dispatchEvent(new w.Event('change',{bubbles:true}));})();true");
        ui.check("__mobileW.document.querySelector('.draftsman-stage').scrollWidth>__mobileW.document.querySelector('.draftsman-stage').clientWidth","Sheet zoom does not provide a pannable document");
        js("__mobileW.document.querySelector('.draftsman-stage').scrollLeft=120;__mobileW.document.querySelector('.draftsman-stage').scrollTop=80;true");
        ui.check("__mobileW.document.querySelector('.draftsman-stage').scrollLeft>0","Zoomed sheet cannot pan");
        js("(()=>{const w=__mobileW,d=w.document,e=d.querySelector('[aria-label=\"Sheet zoom\"]');e.value='fit';e.dispatchEvent(new w.Event('change',{bubbles:true}));d.querySelector('[aria-label=\"Mechanical viewpoint\"]').value='bottom';d.querySelector('button[aria-label=\"+ View\"]').click();})();true");
        waitFor("__mobileW.__mobileDraft.getDocument().pages[0].items.filter(i=>i.type==='view').length===2",60);ui.capture("marble-draftsman-top-bottom");
        test.runOnMainSync(()->ui.probe.activity.setRequestedOrientation(0));waitFor("innerWidth>innerHeight",15);
        ui.check("(()=>{const d=__mobileW.document,s=d.querySelector('.draftsman-stage').getBoundingClientRect(),p=d.querySelector('.draftsman-stage>[role=img]').getBoundingClientRect();return p.height>50&&p.height<=s.height&&p.width<=s.width;})()","Marble sheet does not fit landscape");ui.capture("marble-draftsman-landscape");
        test.runOnMainSync(()->ui.probe.activity.setRequestedOrientation(1));waitFor("innerWidth<innerHeight",15);
        android.content.IntentFilter saveFilter=new android.content.IntentFilter(Intent.ACTION_CREATE_DOCUMENT);saveFilter.addCategory(Intent.CATEGORY_OPENABLE);saveFilter.addDataType("application/pdf");
        android.app.Instrumentation.ActivityMonitor saveMonitor=test.addMonitor(saveFilter,new android.app.Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null),true);
        try{
            ui.tapElement(".draftsman-export-disclosure > summary");ui.tapElement("button[aria-label='Download PDF']");
            long exportDeadline=SystemClock.elapsedRealtime()+45000;while(saveMonitor.getHits()==0&&SystemClock.elapsedRealtime()<exportDeadline)Thread.sleep(150);
            if(saveMonitor.getHits()!=1)throw new AssertionError("PDF export did not reach Android save picker: "+js("__mobileW.document.querySelector('.draftsman-status').textContent"));
            waitFor("__mobileW.document.querySelector('.draftsman-status').textContent.includes('Export cancelled')",10);report.put("pdfSavePickerCancelledCheck",true);
        }finally{test.removeMonitor(saveMonitor);}
        js("__mobileW.__mobileDraft.close();true");
        try{solve(312,155.396,119.52,"B.Cu",156.21,121.424,"B.Cu",1.8,.1);}catch(Throwable error){report.put("net312Error",error.toString());}
        try{solve(656,233.0832,159.385,"F.Cu",233.113,157.9118,"B.Cu",1,.1);}catch(Throwable error){report.put("net656Error",error.toString());}
        if(report.has("net312Error")||report.has("net656Error"))throw new AssertionError("Fast DC drop failures; see independent net results in report");
        report.put("checks",ui.checks).put("passed",true);result.putString("stream","Marble phone engineering checks passed: "+ui.checks+"\n");
    }catch(Throwable error){try{report.put("error",error.toString());report.put("diagnostic",(String)new JSONTokener(js("JSON.stringify((()=>{const scan=(w,depth)=>{try{return {path:w.location.pathname,ready:w.document.readyState,status:['importStatus','projectStatus','drawingHost','reviewNotice'].map(id=>[id,w.document.getElementById(id)?.textContent.slice(0,1800)]),frames:depth<4?[...w.document.querySelectorAll('iframe')].map(f=>({src:f.getAttribute('src'),child:scan(f.contentWindow,depth+1)})):[]};}catch(e){return{error:e.message};}};return scan(window,0);})())")).nextValue());}catch(Exception ignored){}result.putString("error",android.util.Log.getStackTraceString(error));result.putString("stream",android.util.Log.getStackTraceString(error));try{ui.capture("marble-failure");}catch(Throwable ignored){}}
    finally{if(store!=null&&project!=null)try{js("document.getElementById('viewer').src='about:blank';window.KiCadAndroid.showHome();true");store.remove(project);report.put("testProjectRemoved",true);}catch(Exception cleanup){try{report.put("cleanupError",cleanup.toString());}catch(Exception ignored){}}try{File directory=new File(test.getTargetContext().getExternalFilesDir(null),"marble-acceptance");try(FileOutputStream out=new FileOutputStream(new File(directory,"report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}}catch(Exception ignored){}if(ui.probe.activity!=null)test.runOnMainSync(()->ui.probe.activity.setRequestedOrientation(-1));}return result;}
}
