import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
const repo=process.argv[2],destination=process.argv[3];
const {OutputBuffer}=await import(repo+'/dist/output/OutputBuffer.js');
const results=[];let checksum=0;
for(const count of [250,1000,5000]){
 const output=new OutputBuffer();output.setSemanticOutput(false);
 for(let i=0;i<count;i++){const command=`printf fixture-${i}`;output.beginCommand(command,[`❯ ${command}`]);output.write(`result ${i} café 界\nnext ${i}\n`);output.complete(0,{holdOpen:true});}
 for(const columns of [80,40]){
  for(let i=0;i<3;i++)output.wrapped(columns);
  global.gc?.();const heapBefore=process.memoryUsage();const cpu=process.cpuUsage();const samples=[];
  for(let i=0;i<12;i++){const at=performance.now();const rows=output.wrapped(columns);samples.push(performance.now()-at);checksum+=rows.reduce((sum,row)=>sum+row.plain.length+(row.commandIndex??0)+(row.lineIndex??0),0);}
  global.gc?.();results.push({count,columns,samples,cpu:process.cpuUsage(cpu),heapBefore,heapAfter:process.memoryUsage()});
 }
}
writeFileSync(destination,JSON.stringify({repo,node:process.version,notes:'Built production OutputBuffer; real begin/write/complete records, two Unicode output lines each; held open (no discarded/folded output), Semantic Output off; 3 warmups, 12 samples; fixture construction outside timing',results,checksum},null,2));console.log(destination);
