import {fileURLToPath} from 'node:url';
import {appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const repo=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/u,'');
const path=fileURLToPath(new URL('./trace.jsonl',import.meta.url));
let seq=0;
export function trace(event,detail={}) { appendFileSync(path,JSON.stringify({ns:process.hrtime.bigint().toString(),pid:process.pid,ppid:process.ppid,seq:++seq,profile:process.env.TERM_PROGRAM,event,...detail})+'\n'); }
export function label(command) { if(typeof command!=='string')return undefined;return {id:createHash('sha256').update(command).digest('hex').slice(0,12),kind:command.startsWith('echo SIZE-$(stty size)')?'size':command.startsWith('export PROFILE_STATE=')?'export':command.startsWith('printf "STATE-')?'state':'other'}; }
function state(app){return {running:label(app.running?.command),awaitingExec:app.running?.awaitingExec,replaying:app.replaying,streamSeq:app.streamSeq,passthrough:app.passthrough,startup:app.startupPending,editor:label(app.editor?.text),session:app.sessionId};}
function wrap(proto,name,before,after){const original=proto[name];if(!original)throw Error(name);proto[name]=function(...args){before?.call(this,args);const result=original.apply(this,args);after?.call(this,result,args);return result;};}
const {TerminalApp}=await import(repo+'/src/app/TerminalApp.ts');
for(const name of ['submit','onShellExec','onShellPrompt','beginReattach','finishReplay','onInputRejected'])wrap(TerminalApp.prototype,name,function(args){trace('app.'+name,{...state(this),arg:name==='onShellExec'?label(args[0]):undefined});},function(){trace('app.'+name+'.returned',state(this));});
const {SocketSessionClient}=await import(repo+'/src/session/SocketSessionClient.ts');
wrap(SocketSessionClient.prototype,'submit',function(args){trace('client.submit',{command:label(args[0])});});
const {ShellSession}=await import(repo+'/src/shell/ShellSession.ts');
wrap(ShellSession.prototype,'write',function(args){trace('shell.input',{command:label(args[0]?.replace(/\r$/u,'')),bytes:Buffer.byteLength(args[0]),submission:args[1],shellPid:this.pid,atPrompt:this.atPrompt,done:this.done});});
const {ShellProtocolDecoder}=await import(repo+'/src/shell/ShellProtocol.ts');
wrap(ShellProtocolDecoder.prototype,'push',undefined,function(events){for(const e of events)trace('shell.protocol.'+e.kind,{command:label(e.command),bytes:e.data?.length,size:e.kind==='data'?e.data.match(/SIZE-\d+ \d+/u)?.[0]:undefined});});
const {OutputBuffer}=await import(repo+'/src/output/OutputBuffer.ts');
wrap(OutputBuffer.prototype,'complete',undefined,function(record){trace('record.finalized',{command:label(record?.command),startId:record?.startId,geometryOutput:record?.command.startsWith('echo SIZE-$(stty size)')?record.output:undefined,size:record?.output.match(/SIZE-\d+ \d+/u)?.[0]});});
const {TranscriptStore}=await import(repo+'/src/sessions/TranscriptStore.ts');
wrap(TranscriptStore.prototype,'save',function(args){const s=args[0];trace('journal.write.begin',{id:s.id,liveSeq:s.live?.seq,records:s.transcript.records.map(r=>({command:label(r.command),startId:r.startId,size:r.output.match(/SIZE-\d+ \d+/u)?.[0]}))});},function(result,args){result.then(()=>trace('journal.write.durable',{id:args[0].id,liveSeq:args[0].live?.seq}),()=>trace('journal.write.error'));});
trace('runtime.loaded');

const {QueryOrder}=await import(repo+'/src/shell/QueryOrder.ts');
wrap(QueryOrder.prototype,'input',function(){if(this.tracedDelivery)return;this.tracedDelivery=true;const writer=this.write;this.write=function(data){trace('pty.input.delivered',{bytes:Buffer.byteLength(data),command:label(data.replace(/\r$/u,''))});return writer(data);};});

for(const name of ['holdForOwnershipLook','routeComposer','enqueue'])wrap(TerminalApp.prototype,name,function(args){trace('ownership.'+name,{...state(this),key:args[0]?.kind,request:this.inputState?.request?{mode:this.inputState.request.mode,confidence:this.inputState.request.confidence}:undefined,done:this.inputState?.done});});
wrap(TerminalApp.prototype,'onInputState',function(args){const value=args[0];trace('ownership.state',{...state(this),done:value.done,terminalOwner:value.terminalOwner,request:value.request?{mode:value.request.mode,confidence:value.request.confidence}:undefined});});
wrap(TerminalApp.prototype,'lookWhenStarted',function(){trace('ownership.look.begin',state(this));},function(result){result.then(value=>trace('ownership.look.result',{...state(this),value}),()=>trace('ownership.look.error'));});

const {InputWatch}=await import(repo+'/src/session/InputWatch.ts');
wrap(InputWatch.prototype,'apply',function(args){const sample=args[0];trace('probe.sample',{modes:sample.modes,readingTerminal:sample.readingTerminal,foreground:sample.foreground.map(p=>({pid:p.pid,state:p.state,cpuMs:p.cpuMs})),running:label(this.running?.command)});});
wrap(InputWatch.prototype,'lookNow',undefined,function(result){result.then(value=>trace('probe.look.result',{value,request:this.request?{mode:this.request.mode,confidence:this.request.confidence}:undefined}),()=>trace('probe.look.error'));});
