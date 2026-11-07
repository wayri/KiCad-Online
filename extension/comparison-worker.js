/* Parsing runs off the interaction thread; each job is cancelled by terminating its worker. */
'use strict';
importScripts('legacy-kicad.js','design-diff.js','bom-import.js','unified-comparison.js');
self.onmessage=event=>{
 const m=event.data;
 if(!m||m.type!=='compare')return;
 try{const result=KiCadUnifiedComparison.compare(m.base,m.head,m.options||{});result.files=result.files.map(({beforeContent,afterContent,...file})=>file);self.postMessage({ok:true,result});}
 catch(error){self.postMessage({ok:false,error:error.message||'Comparison failed.'});}
};