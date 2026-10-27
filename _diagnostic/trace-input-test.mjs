if(process.argv.some(arg=>arg.endsWith('/inputOwnershipLive.test.ts'))){
 const {LiveSandbox}=await import('../tests/helpers/liveFrontend.ts');
 const {trace}=await import('./trace-runtime.mjs');
 const launch=LiveSandbox.prototype.launch;let generation=0;
 LiveSandbox.prototype.launch=function(args,size,env){const f=launch.call(this,args,size,env,new URL('./trace-entry.mjs',import.meta.url).pathname);trace('input-test.attachment',{generation:++generation,frontendPid:f.pty.pid});const write=f.pty.write.bind(f.pty);f.pty.write=data=>{trace('input-test.bytes',{frontendPid:f.pty.pid,bytes:Buffer.byteLength(data),enter:data==='\r'});return write(data);};return f;};
}
