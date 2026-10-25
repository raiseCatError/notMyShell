import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const repo=process.argv[2],destination=process.argv[3],count=2500;
const {OutputBuffer}=await import(repo+'/dist/output/OutputBuffer.js');
const {LiveSandbox,strip}=await import(repo+'/tests/helpers/liveFrontend.ts');
const pty=createRequire(repo+'/package.json')('node-pty');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function wait(f,re,action=()=>{}){return new Promise((resolve,reject)=>{let tail='';const at=performance.now();let sub,exit;const done=error=>{clearTimeout(timer);sub?.dispose();exit?.dispose();error?reject(error):resolve(performance.now()-at)};const timer=setTimeout(()=>done(new Error('Timeout '+re+' '+strip(tail).slice(-1500))),60000);sub=f.pty.onData(data=>{tail=(tail+data).slice(-65536);if(re.test(strip(tail)))done()});exit=f.pty.onExit(()=>done(new Error('Frontend exited')));action()})}
const rows=[];let active;let interrupted=false;const interrupt=()=>{interrupted=true;active?.pty.kill('SIGTERM')};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
try{for(let i=0;i<5;i++){
 if(interrupted)throw new Error('Interrupted');
 const box=new LiveSandbox({provider:'native',introSeen:true,liveSessionStartup:'never'},{NMSH_DISABLE_UPDATES:'1',NODE_DISABLE_COMPILE_CACHE:'1'});
 try{
  const output=new OutputBuffer();
  for(let j=0;j<count;j++){const command=`printf fixture-${j}`;output.beginCommand(command,[`❯ ${command}`]);output.write(`result ${j} café 界\nnext ${j}\n`);output.complete(0,{holdOpen:true});}
  const archived=await box.transcripts().archive({startCwd:box.home,finalCwd:box.home,transcript:output.transcript()});
  const f=box.trackFrontend(pty.spawn(process.execPath,[repo+'/dist/index.js'],{cwd:box.home,cols:100,rows:30,env:box.env}));active=f;
  await wait(f,/❯/u);await wait(f,/HISTORY_READY_42/u,()=>f.pty.write("printf '\\110\\111\\123\\124\\117\\122\\131\\137\\122\\105\\101\\104\\131\\137\\064\\062\\n'\r"));
  await wait(f,new RegExp(count+' commands'),()=>f.pty.write('/resume\r'));
  const restoreMs=await wait(f,new RegExp('fixture-'+(count-1)),()=>f.pty.write('\r'));
  await sleep(300);
  const pageUpMs=await wait(f,new RegExp('fixture-'+(count-9)),()=>f.pty.write('\x1b[5~'));
  const pageDownMs=await wait(f,new RegExp('fixture-'+(count-1)),()=>f.pty.write('\x1b[6~'));
  const narrowMs=await wait(f,new RegExp('fixture-'+(count-1)),()=>f.pty.resize(80,30));
  const wideMs=await wait(f,new RegExp('fixture-'+(count-1)),()=>f.pty.resize(100,30));
  await wait(f,/HISTORY_KEY_/u,()=>f.pty.write('\x1b[200~HISTORY_KEY_\x1b[201~'));
  let suffix='HISTORY_KEY_';const typingMs=[];
  for(const key of 'abcdefghij'){suffix+=key;typingMs.push(await wait(f,new RegExp(suffix.slice(-8)),()=>f.pty.write(key)));await sleep(20);}
  const unchanged=await box.transcripts().load(archived.id);if(unchanged.transcript.records.length!==count||unchanged.transcript.records.some((record,index)=>record.command!==`printf fixture-${count-1-index}`))throw new Error('Archive record loss/reordering');
  rows.push({i,count,restoreMs,pageUpMs,pageDownMs,narrowMs,wideMs,typingMs});writeFileSync(destination,JSON.stringify({repo,node:process.version,conditions:'Real built CLI /resume of reproducible 2500-command archive; Native/zsh 100x30, private HOME/service, bytecode cache disabled; observed PTY frames, not physical pixels; exact original archive record order verified',rows},null,2));console.log(i);
 }finally{await box.dispose();active=undefined;}
}}finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)}
