import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Journal} from '../src/backups/journal.js';
import {snapshot,transact} from '../src/appearance/hostFiles.js';
import {planRestore, restore, manualSnapshot} from '../src/backups/restore.js';
import {dailySettingsCheckpoint} from '../src/backups/settings.js';
function fixture(t: {after(fn:()=>void):void}) {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'restore-'))); t.after(()=>rmSync(home,{recursive:true,force:true}));
 const journal=new Journal({home,directory:join(home,'backups')}); const path=join(home,'config');
 writeFileSync(path,'original\r\n',{mode:0o640});
 transact([{before:snapshot(path,home),after:'nmsh'}],[],home,{source:'appearance',label:'Appearance',directory:journal.directory});
 return {home,journal,path,entry:journal.list()[0]};
}
test('restore needs review and edited-since confirmation, and is itself undoable',t=>{
 const f=fixture(t); writeFileSync(f.path,'later personal edit'); const plan=planRestore(f.journal,f.entry.id);
 assert.equal(plan.edited.length,1); assert.match(plan.preview.join('\n'), /later personal edit/);
 assert.throws(()=>restore(f.journal,plan,{reviewed:false,overwrite:false}),/review/iu);
 assert.throws(()=>restore(f.journal,plan,{reviewed:true,overwrite:false}),/later edits/iu);
 const undo=restore(f.journal,plan,{reviewed:true,overwrite:true});
 assert.equal(readFileSync(f.path,'utf8'),'original\r\n'); assert.equal(statSync(f.path).mode&0o777,0o640);
 restore(f.journal,planRestore(f.journal,undo.id),{reviewed:true,overwrite:true});
 assert.equal(readFileSync(f.path,'utf8'),'later personal edit');
});
test('restore refuses stale review before creating backup or writing',t=>{
 const f=fixture(t); const plan=planRestore(f.journal,f.entry.id); writeFileSync(f.path,'concurrent');
 assert.throws(()=>restore(f.journal,plan,{reviewed:true,overwrite:true}),/changed/iu);
 assert.equal(f.journal.list().length,1); assert.equal(readFileSync(f.path,'utf8'),'concurrent');
});
test('restore of created file removes only the reviewed file; manual snapshot covers known paths',t=>{
 const f=fixture(t);const created=join(f.home,'new');
 transact([{before:snapshot(created,f.home),after:'new'}],[],f.home,{source:'cursor',label:'Create',directory:f.journal.directory});
 const entry=f.journal.list()[0];restore(f.journal,planRestore(f.journal,entry.id),{reviewed:true,overwrite:false});assert.equal(existsSync(created),false);
 const manual=manualSnapshot(f.journal,[join(f.home,'config.json')]);
 assert.deepEqual(manual.files.map(x=>x.path).sort(),[f.path,created,join(f.home,'config.json')].sort());
});
test('settings checkpoint is at most once per day and refuses symlinks through journal safety',t=>{
 const f=fixture(t);const path=join(f.home,'config.json');writeFileSync(path,'old');
 const complete=dailySettingsCheckpoint(path,'first');writeFileSync(path,'first');chmodSync(path,0o600);complete();
 const again=dailySettingsCheckpoint(path,'second');writeFileSync(path,'second');again();
 assert.equal(new Journal({home:f.home,directory:join(f.home,'backups')}).list().filter(x=>x.source==='settings').length,1);
});
test('daily settings checkpoint can coexist with backups of files elsewhere in HOME',t=>{
 const f=fixture(t);const directory=join(f.home,'.config/nmsh');
 const env={HOME:f.home,XDG_CONFIG_HOME:join(f.home,'.config')};
 const journal=new Journal({home:f.home,directory:join(directory,'backups')});
 journal.record([{before:snapshot(f.path,f.home),after:'next'}],'appearance','Host');
 const path=join(directory,'config.json');writeFileSync(path,'old');
 const complete=dailySettingsCheckpoint(path,'new',new Date(),env);writeFileSync(path,'new');chmodSync(path,0o600);complete();
 assert.equal(journal.list().filter(entry=>entry.source==='settings').length,1);
});
test('undoing a managed artifact update restores its ownership ledger too',async t=>{
 const f=fixture(t);const env={HOME:f.home,XDG_CONFIG_HOME:join(f.home,'.config')};
 const {writeArtifact,ownership,loadLedger}=await import('../src/themeBridge/artifacts.js');
 const journal=new Journal({home:f.home,directory:join(f.home,'.config/nmsh/backups')});
 const metadata={mode:'follow' as const,themeRef:'test',format:'vim',formatVersion:1};
 assert.equal(writeArtifact('vim','first',()=>true,metadata,env).ok,true);
 assert.equal(writeArtifact('vim','second',()=>true,metadata,env).ok,true);
 restore(journal,planRestore(journal,journal.list()[0].id),{reviewed:true,overwrite:false});
 assert.equal(ownership('vim',loadLedger(env),env),'owned');
});
