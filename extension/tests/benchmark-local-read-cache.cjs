/* CPU/local-file transport benchmark, not Android frame rate or network timing. */
const fs=require('node:fs'),fsp=require('node:fs/promises'),vm=require('node:vm'),path=require('node:path'),{execFileSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../..'),file=process.argv[2];
if(!file)throw Error('Pass an existing public .kicad_pcb fixture path.');
const bytes=fs.statSync(file).size;if(bytes>8*1024*1024)throw Error('Use a bounded fixture up to 8 MiB.');
const before=execFileSync('git',['show','HEAD:extension/local-project.js'],{cwd:root,encoding:'utf8'}),after=fs.readFileSync(path.join(root,'extension/local-project.js'),'utf8');
async function run(code){const samples=[];let reads=0;for(let round=0;round<3;round++){
 const context=vm.createContext({TextEncoder,Date,fetch:async()=>{reads++;const content=await fsp.readFile(file,'utf8');return{ok:true,text:async()=>content};}});vm.runInContext(code,context);
 const api=context.KiCadAndroidLocal.transport({id:'bench',files:[{path:'board.kicad_pcb',size:bytes,diskPath:'/assets/viewer/downloaded/'+'a'.repeat(32)+'/0'}],assets:[]},{getItem:()=>null,setItem(){}});
 const start=performance.now();for(let i=0;i<20;i++){const reply=await api.send({type:'project-file',file:'board.kicad_pcb'});if(!reply.ok||!reply.result.content.startsWith('(kicad_pcb'))throw Error('Unexpected source result');}samples.push(performance.now()-start);
 }return{medianMs:samples.sort((a,b)=>a-b)[1],reads,decodedBytes:reads*bytes};}
(async()=>console.log(JSON.stringify({workload:'20 repeat reads per snapshot, 3 snapshots; local filesystem and UTF-8 decode only',sourceBytes:bytes,before:await run(before),after:await run(after)},null,2)))().catch(error=>{console.error(error);process.exitCode=1;});
