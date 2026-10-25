import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const [before,after,destination]=process.argv.slice(2);
const {OutputBuffer}=await import(before+'/dist/output/OutputBuffer.js');
const {TranscriptPresenter: Before}=await import(before+'/dist/output/TranscriptPresenter.js');
const {TranscriptPresenter: After}=await import(after+'/dist/output/TranscriptPresenter.js');
const results=[];
const previous=process.env.NMSH_COLOR;
try{for(const [name,count]of [['many',5000],['mixed',200]]){
 const output=new OutputBuffer();output.setSemanticOutput(name==='mixed');
 for(let i=0;i<count;i++){
  const command=`printf fixture-${i}`;
  output.beginCommand(command,[`❯ ${command}`],undefined,name==='mixed'?{cwd:'/bench/project',project:'project',branch:'dev'}:undefined);
  output.write(name==='mixed'?`\x1b[31mresult ${i} café 界\x1b[0m\nnext ${i}\n`:`result ${i} café 界\nnext ${i}\n`);
  output.complete(0,{holdOpen:true});
  if(name==='mixed'&&i%7===0)output.toggleExpanded(0);
 }
 if(name==='mixed'){
  output.beginCommand('tsc --noEmit',['❯ tsc --noEmit']);output.write("src/main.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.\n");output.complete(1,{holdOpen:true});
 }
 const saved=output.transcript();const view=output.view();
 for(const layout of ['normal','chat'])for(const columns of [40,80])for(const level of ['truecolor','none']){
  process.env.NMSH_COLOR=level;
  const original=new Before(),candidate=new After();original.setLayout(layout);candidate.setLayout(layout);original.setHyperlinks(true);candidate.setHyperlinks(true);
  const expected=original.rows(view,columns),actual=candidate.rows(view,columns);
  assert.deepEqual(actual,expected,`${name}/${layout}/${columns}/${level}`);
  assert.deepEqual(output.transcript(),saved,'presentation changed stored transcript');
  const hash=createHash('sha256').update(JSON.stringify(actual)).digest('hex');
  results.push({name,count,layout,columns,level,rows:actual.length,sha256:hash});
 }
}}finally{if(previous===undefined)delete process.env.NMSH_COLOR;else process.env.NMSH_COLOR=previous}
writeFileSync(destination,JSON.stringify({before,after,node:process.version,notes:'Untimed full-row deep equality (ANSI/plain text and every metadata field), plus unchanged serialized transcript; same actual OutputBuffer view for both presenters',results},null,2));console.log('All full-row/transcript comparisons passed');
