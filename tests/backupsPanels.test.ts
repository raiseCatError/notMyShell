import {TerminalApp} from '../src/app/TerminalApp.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planReset,applyReset,type ResetArea} from '../src/backups/reset.js';
import {Journal} from '../src/backups/journal.js';
import {snapshot,transact} from '../src/appearance/hostFiles.js';
import {createChangesPanel,changesKey,renderChangesPanel} from '../src/backups/ChangesPanel.js';
import {createResetPanel,resetKey,renderResetPanel} from '../src/backups/ResetPanel.js';
import {parseSlashCommand, slashCommands} from '../src/commands/slashCommands.js';
import {displayWidth,stripAnsi} from '../src/util/text.js';
import {applyHostAppearance,planHostAppearance} from '../src/appearance/hostAppearance.js';
function fixture(t: {after(fn:()=>void):void}) {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'backup-panels-')));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const env={HOME:home,XDG_CONFIG_HOME:join(home,'.config')}; const journal=new Journal({home,directory:join(home,'.config/nmsh/backups')});
 const path=join(home,'config');writeFileSync(path,'before');
 transact([{before:snapshot(path,home),after:'after'}],[],home,{source:'keyboard',label:'Keyboard bindings',directory:journal.directory});
 return {home,env,journal,path};
}
const enter={kind:'enter'} as const;
test('commands preserve shell history; plain reset only returns guidance',()=>{
 for(const name of ['/changes','/backups','/snapshots'])assert.equal(parseSlashCommand(name)?.kind,'changes');
 assert.equal(parseSlashCommand('/history')?.kind,'history');
 assert.equal(parseSlashCommand('/reset')?.kind,'resetGuidance');
 assert.equal(parseSlashCommand('/nmsh reset')?.kind,'nmshReset');
 assert.ok(slashCommands.some(x=>x.name==='/nmsh reset'));
});
test('history requires a shown review and a separate confirmation for later edits',t=>{
 const f=fixture(t);writeFileSync(f.path,'personal');const state=createChangesPanel(f.journal,[]);
 changesKey(state,enter);assert.equal(state.view,'review');
 changesKey(state,enter);assert.equal(readFileSync(f.path,'utf8'),'personal','unseen review cannot confirm');
 renderChangesPanel(state,80,24);changesKey(state,enter);assert.equal(state.view,'confirm');
 assert.equal(readFileSync(f.path,'utf8'),'personal');renderChangesPanel(state,80,24);changesKey(state,enter);
 assert.equal(readFileSync(f.path,'utf8'),'before');assert.equal(state.view,'result');
});
test('reset cannot write without selected areas, impact, backup and exact typed word',t=>{
 const f=fixture(t);const state=createResetPanel({env:f.env,platform:'linux'},f.journal);
 assert.equal(state.selected.size,0);resetKey(state,enter);assert.equal(state.step,'choose');
 const settings=state.areas.findIndex(x=>x.id==='settings');state.index=settings;resetKey(state,{kind:'text',value:' '});
 resetKey(state,enter);assert.equal(state.step,'impact');
 resetKey(state,enter);assert.equal(state.step,'impact','unseen impact cannot confirm');
 renderResetPanel(state,80,24);resetKey(state,enter);assert.equal(state.step,'backup');
 renderResetPanel(state,80,24);resetKey(state,enter);assert.equal(state.step,'confirm');
 renderResetPanel(state,80,24);resetKey(state,{kind:'text',value:'RESET'});resetKey(state,enter);
 assert.equal(existsSync(join(f.home,'.config/nmsh/config.json')),false);
 assert.equal(state.step,'confirm');
 for(let i=0;i<5;i++)resetKey(state,{kind:'backspace'});
 resetKey(state,{kind:'text',value:'reset'});resetKey(state,enter);
 assert.equal(state.step,'result');assert.match(state.message,/Undo: \/changes/u);
 assert.equal(existsSync(join(f.home,'.config/nmsh/config.json')),true);
});
test('reset preserves user lines with overlapping owned plans, reports skips and stale review',t=>{
 const f=fixture(t);const context={env:f.env,platform:'linux' as const};
 const plan=planHostAppearance('kitty',{opacity:.7,blurMode:'Off',blurStrength:0},context);assert.ok(plan.ok);
 if(!plan.ok)return;assert.equal(applyHostAppearance(plan.plan).ok,true);
 const current=readFileSync(plan.plan.hostPath,'utf8');writeFileSync(plan.plan.hostPath,current+'# personal\r\n');
 const state=createResetPanel(context,f.journal);state.selected.add('kitty-appearance');state.selected.add('ghostty-appearance');
 resetKey(state,enter);renderResetPanel(state,120,40);assert.match(state.review!.plan.preview.join('\n'),/kept|skipped/u);
 resetKey(state,enter);renderResetPanel(state,120,40);resetKey(state,enter);renderResetPanel(state,120,40);resetKey(state,{kind:'text',value:'reset'});resetKey(state,enter);
 assert.equal(readFileSync(plan.plan.hostPath,'utf8'),'# personal\r\n');assert.match(state.results.join('\n'),/done|skipped/u);
 const stale=createResetPanel(context,f.journal);stale.selected.add('settings');resetKey(stale,enter);
 renderResetPanel(stale,80,24);resetKey(stale,enter);renderResetPanel(stale,80,24);resetKey(stale,enter);renderResetPanel(stale,80,24);
 writeFileSync(join(f.home,'.config/nmsh/config.json'),'concurrent');resetKey(stale,{kind:'text',value:'reset'});resetKey(stale,enter);
 assert.equal(readFileSync(join(f.home,'.config/nmsh/config.json'),'utf8'),'concurrent');assert.match(stale.message,/changed/u);
});
for(const [columns,height] of [[120,40],[80,24],[60,20],[40,14]])test(`panels fit ${columns}x${height} with selection and footer`,t=>{
 const f=fixture(t);const history=createChangesPanel(f.journal,[]);const reset=createResetPanel({env:f.env,platform:'linux'},f.journal);
 for(const rows of [renderChangesPanel(history,columns,height),renderResetPanel(reset,columns,height)]){
 assert.ok(rows.length<=height);assert.ok(rows.every(x=>displayWidth(x)<=columns));
 const plain=rows.map(stripAnsi).join('\n');assert.match(plain,/Esc/u);assert.match(plain,/Enter/u);assert.match(plain,/[›>❯▶]/u);
 }
});
test('reset reverses only Starship edits and keeps user edits between NMSh writes',t=>{
 const f=fixture(t);const path=join(f.home,'starship.toml');const initial='# mine\n[directory]\ndisabled = false\n';writeFileSync(path,initial);
 const write=(after:string)=>transact([{before:snapshot(path,f.home),after}],[],f.home,{source:'starship',label:'Starship module',directory:f.journal.directory});
 write(initial.replace('false','true'));
 writeFileSync(path,readFileSync(path,'utf8')+'[custom]\nuser = true\n');
 write(readFileSync(path,'utf8')+'[git_branch]\ndisabled = true\n');
 const state=createResetPanel({env:f.env,platform:'linux'},f.journal);state.selected.add('starship');resetKey(state,enter);
 renderResetPanel(state,80,24);resetKey(state,enter);renderResetPanel(state,80,24);resetKey(state,enter);renderResetPanel(state,80,24);resetKey(state,{kind:'text',value:'reset'});resetKey(state,enter);
 assert.equal(readFileSync(path,'utf8'),initial+'[custom]\nuser = true\n');
});

test('wired reset guidance writes nothing and backup panels retain modal input ownership',async t=>{
 const f=fixture(t);const saved={HOME:process.env.HOME,XDG:process.env.XDG_CONFIG_HOME};process.env.HOME=f.home;process.env.XDG_CONFIG_HOME=f.env.XDG_CONFIG_HOME;
 const app=new TerminalApp();Object.defineProperty(app,'render',{value:()=>{}});
 const tree=()=>readdirSync(f.home,{recursive:true}).map(String).sort();
 try {
  const before=tree();await app['runSlash']('/reset',parseSlashCommand('/reset')!);assert.deepEqual(tree(),before);
  app['editor'].insert('draft');await app['runSlash']('/changes',parseSlashCommand('/changes')!);
  assert.equal(app['hasModalInput'](),true);app['handleKey']({kind:'text',value:'z'});assert.equal(app['editor'].text,'draft');
  app['handleKey']({kind:'escape'});assert.equal(app['changesPanel'],undefined);
  await app['runSlash']('/nmsh reset',parseSlashCommand('/nmsh reset')!);app['handleKey']({kind:'escape'});assert.equal(app['resetPanel'],undefined);
 }finally{app['stop'](0);app['session'].kill();if(saved.HOME===undefined)delete process.env.HOME;else process.env.HOME=saved.HOME;if(saved.XDG===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=saved.XDG;}
});

test('two owned areas remove disjoint includes in one host file and keep user bytes',t=>{
 const f=fixture(t);const content='# user\r\ninclude nmsh-appearance\r\ninclude nmsh-shaders\r\nfont_size 17';writeFileSync(f.path,content);
 const before=snapshot(f.path,f.home);
 const areas:ResetArea[]=['appearance','shaders'].map((id,index)=>({id,label:id,status:'set up',dependencies:[],changes:[{before,after:content.replace(index===0?'include nmsh-appearance\r\n':'include nmsh-shaders\r\n','')}]}));
 const plan=planReset(areas,new Set(['appearance','shaders']),{env:f.env,platform:'linux'});
 const result=applyReset(plan,f.journal);assert.equal(readFileSync(f.path,'utf8'),'# user\r\nfont_size 17');assert.equal(result.results.filter(x=>x.endsWith('done')).length,2);
});
for(const [columns,height] of [[120,40],[80,24],[60,20],[40,14]])test(`all review stages fit ${columns}x${height}`,t=>{
 const f=fixture(t);const history=createChangesPanel(f.journal,[]);const reset=createResetPanel({env:f.env,platform:'linux'},f.journal);
 const frames:Array<[string,string[]]>=[];
 const capture=(name:string,rows:string[])=>{frames.push([name,rows]);assert.ok(rows.length<=height,name);assert.ok(rows.every(row=>displayWidth(row)<=columns),name);assert.match(rows.map(stripAnsi).join('\n'),/Esc/u,name);};
 capture('history',renderChangesPanel(history,columns,height));changesKey(history,enter);capture('restore-review',renderChangesPanel(history,columns,height));changesKey(history,enter);capture('restore-result',renderChangesPanel(history,columns,height));
 reset.selected.add('settings');capture('reset-choose',renderResetPanel(reset,columns,height));resetKey(reset,enter);capture('reset-impact',renderResetPanel(reset,columns,height));resetKey(reset,enter);capture('reset-backup',renderResetPanel(reset,columns,height));resetKey(reset,enter);capture('reset-confirm',renderResetPanel(reset,columns,height));resetKey(reset,{kind:'text',value:'reset'});resetKey(reset,enter);capture('reset-result',renderResetPanel(reset,columns,height));
 if(process.env.NMSH_BACKUP_SNAPSHOTS){mkdirSync(process.env.NMSH_BACKUP_SNAPSHOTS,{recursive:true});for(const [name,rows]of frames)writeFileSync(join(process.env.NMSH_BACKUP_SNAPSHOTS,`${name}-${columns}x${height}.txt`),rows.map(stripAnsi).join('\n')+'\n');}
});
