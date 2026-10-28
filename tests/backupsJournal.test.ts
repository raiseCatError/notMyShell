import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, statSync, symlinkSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Journal} from '../src/backups/journal.js';
import {snapshot, transact} from '../src/appearance/hostFiles.js';

function fixture(t: {after(fn: () => void): void}) {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'journal-')));
 t.after(() => rmSync(home, {recursive: true, force: true}));
 const directory = join(home, 'state', 'backups');
 const journal = new Journal({home, directory});
 const path = join(home, 'config');
 writeFileSync(path, 'before\r\n', {mode: 0o640});
 return {home, directory, journal, path};
}
test('journal stores private verified before bytes, mode, hashes and after state', t => {
 const f = fixture(t); const before = snapshot(f.path, f.home);
 const entry = f.journal.record([{before, after: 'after'}], 'appearance', 'Opacity 0.85');
 const loaded = f.journal.read(entry.id);
 assert.equal(loaded.files[0].beforeHash.length, 64);
 assert.equal(f.journal.content(loaded, 0), 'before\r\n');
 assert.equal(statSync(join(f.directory, entry.id)).mode & 0o777, 0o700);
 assert.equal(statSync(join(f.directory, entry.id, 'files', '0')).mode & 0o777, 0o600);
 assert.equal(loaded.files[0].mode, 0o640);
 assert.equal(f.journal.status(loaded.files[0]), 'edited since');
 writeFileSync(f.path, 'after'); assert.equal(f.journal.status(loaded.files[0]), 'unchanged since');
 writeFileSync(join(f.directory, entry.id, 'files', '0'), 'corrupt');
 assert.throws(() => f.journal.read(entry.id), /verify|hash/iu);
});
test('journal caps refuse before writing and prune only automatic entries', t => {
 const f = fixture(t); const journal = new Journal({home:f.home, directory:f.directory, maxEntries:2, maxBytes:4096});
 const changes = [{before:snapshot(f.path,f.home),after:readFileSync(f.path,'utf8')}];
 const reset = journal.record(changes,'reset','Reset');journal.complete(reset);
 const old = journal.record(changes,'appearance','Old');journal.complete(old);
 const recent = journal.record(changes,'appearance','New');
 assert.deepEqual(journal.list().map(x=>x.id).sort(),[reset.id,recent.id].sort());
 assert.throws(()=>journal.read(old.id));
 assert.throws(()=> new Journal({home:f.home,directory:f.directory,maxBytes:1}).record(changes,'cursor','Large'), /capacity|limit/iu);
});
test('symlinked storage and target files are refused', t => {
 const f=fixture(t); mkdirSync(join(f.home,'elsewhere')); symlinkSync(join(f.home,'elsewhere'),join(f.home,'linked'));
 assert.throws(()=>new Journal({home:f.home,directory:join(f.home,'linked','backups')}).record([{before:snapshot(f.path,f.home)}],'reset','Reset'), /symbolic/iu);
 symlinkSync(f.path,join(f.home,'link')); assert.throws(()=>snapshot(join(f.home,'link'),f.home),/symbolic/iu);
});
test('transact refuses mutation when backup fails and records before successful writes', t => {
 const f=fixture(t); const before=snapshot(f.path,f.home);
 writeFileSync(join(f.home,'blocked'),'file');
 assert.throws(()=>transact([{before,after:'after'}],[],f.home,{source:'cursor',label:'Cursor',directory:join(f.home,'blocked','backups')}));
 assert.equal(readFileSync(f.path,'utf8'),'before\r\n');
 transact([{before,after:'after'}],[],f.home,{source:'cursor',label:'Cursor',directory:f.directory});
 assert.equal(f.journal.list().length,1); assert.equal(f.journal.content(f.journal.list()[0],0),'before\r\n');
});
test('incomplete staging does not prevent subsequent verified checkpoints',t=>{
 const f=fixture(t);mkdirSync(f.directory,{recursive:true,mode:0o700});
 mkdirSync(join(f.directory,'.pending-interrupted'),{mode:0o700});
 const entry=f.journal.record([{before:snapshot(f.path,f.home),after:'after'}],'cursor','Retry');
 assert.equal(f.journal.list().length,1);assert.equal(f.journal.read(entry.id).label,'Retry');
});
test('oversized before/after images and a symlinked saved image fail closed',t=>{
 const f=fixture(t);writeFileSync(f.path,'x'.repeat(2*1024*1024+1));assert.throws(()=>snapshot(f.path,f.home),/bounded/iu);
 writeFileSync(f.path,'small');const before=snapshot(f.path,f.home);
 assert.throws(()=>f.journal.record([{before,after:'x'.repeat(2*1024*1024+1)}],'cursor','Too large'),/limit/iu);
 const entry=f.journal.record([{before,after:'next'}],'cursor','Small');
 const stored=join(f.directory,entry.id,'files','0');rmSync(stored);symlinkSync(f.path,stored);
 assert.throws(()=>f.journal.read(entry.id),/symbolic/iu);assert.equal(readFileSync(f.path,'utf8'),'small');
});
test('another live journal writer blocks a checkpoint without replacing its lock',t=>{
 const f=fixture(t);mkdirSync(f.directory,{recursive:true,mode:0o700});
 const path=join(f.directory,'.write-lock');const content=JSON.stringify({owner:'nmsh-journal',version:1,pid:process.pid,token:'live'});writeFileSync(path,content,{mode:0o600});
 assert.throws(()=>f.journal.record([{before:snapshot(f.path,f.home),after:'after'}],'cursor','Concurrent'),/in progress/iu);
 assert.equal(readFileSync(path,'utf8'),content);assert.equal(readFileSync(f.path,'utf8'),'before\r\n');
});
