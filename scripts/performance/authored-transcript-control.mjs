// addHistoryLine creates NMSh-authored metadata rows (word wrapping and visual gaps), not raw PTY lines.
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
const repo=process.argv[2],destination=process.argv[3];
const {OutputBuffer}=await import(repo+'/dist/output/OutputBuffer.js');
const samples=[];
function measure(name,fn,n=30){for(let i=0;i<5;i++)fn();const a=[];for(let i=0;i<n;i++){const t=performance.now();fn();a.push(performance.now()-t)}a.sort((a,b)=>a-b);samples.push({name,n,samples:a,median:a[Math.floor(n/2)],p95:a[Math.floor(n*.95)]})}
for(const count of [1000,10000,100000]){
 const output=new OutputBuffer();for(let i=0;i<count;i++)output.addHistoryLine(`${i} λ café 👩🏽‍💻 界面 e\u0301 → \x1b[36mcyan\x1b[0m`);
 global.gc();const allocated=process.memoryUsage();
 output.wrapped(100);global.gc();const drawn=process.memoryUsage();
 measure('unchanged-'+count,()=>output.wrapped(100));
 let width=100;measure('resize-'+count,()=>output.wrapped(width=width===100?80:100),12);
 global.gc();samples.push({name:'memory-'+count,allocated,drawn,after:process.memoryUsage(),peakRss:process.resourceUsage().maxRSS*1024});
}
writeFileSync(destination,JSON.stringify(samples,null,2));console.log(destination);
