/** Private, verified before-images. A failed checkpoint must prevent its configuration write. */
import {constants, closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, lstatSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join, dirname} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {checkPath, digest, snapshot, unchanged, type FileChange} from '../appearance/hostFiles.js';

export interface JournalOptions {home: string; directory?: string; maxEntries?: number; maxBytes?: number}
export interface JournalFile {path: string; existed: boolean; mode: number; beforeHash: string; afterHash: string; bytes: number; afterBytes?: number; afterMode?: number}
export interface JournalEntry {version: 1; id: string; time: string; source: string; label: string; files: JournalFile[]; outcome: 'prepared' | 'applied'}
export interface JournalMetadata {source: string; label: string; directory?: string}
const protectedSource = (source: string) => ['reset', 'restore', 'manual'].includes(source);
export const ABSENT_HASH = 'absent';
const hash = (text: string | undefined) => text === undefined ? ABSENT_HASH : digest(text);
export function journalDirectory(home: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env.HOME === home ? env : {HOME: home}), 'backups');
}

export class Journal {
  readonly directory: string;
  constructor(readonly options: JournalOptions) { this.directory = options.directory ?? journalDirectory(options.home); }

  private checked(path: string, writable = false): void { checkPath(path, this.options.home, writable); }
  private atomic(path: string, content: string): void {
    this.checked(path, true);
    const temp = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, content); fchmodSync(fd, 0o600); fsyncSync(fd); }
    finally { closeSync(fd); }
    try { this.checked(path, true); renameSync(temp, path); this.syncDirectory(dirname(path)); }
    finally { try { rmSync(temp); } catch { /* renamed */ } }
  }
  private syncDirectory(path: string): void {
    this.checked(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  private file(path: string): string {
    this.checked(path);
    const value = snapshot(path, this.options.home).content;
    if (value === undefined) throw new Error('Backup verify failed: a journal file is missing.');
    return value;
  }
  read(id: string): JournalEntry {
    if (!/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/u.test(id)) throw new Error('Invalid backup id.');
    const base = join(this.directory, id);
    const value = JSON.parse(this.file(join(base, 'manifest.json'))) as JournalEntry;
    if (value.version !== 1 || value.id !== id || !['prepared','applied'].includes(value.outcome) || typeof value.source !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.source) || typeof value.label !== 'string' || value.label.length>512
      || typeof value.time !== 'string' || !Array.isArray(value.files) || value.files.length > 512) throw new Error('Backup manifest failed verification.');
    value.files.forEach((file, index) => {
      if (typeof file.path !== 'string' || typeof file.existed !== 'boolean' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777
        || (file.afterMode!==undefined&&(!Number.isInteger(file.afterMode)||file.afterMode<0||file.afterMode>0o777))
        || typeof file.afterHash !== 'string' || !/^(?:absent|[a-f0-9]{64})$/u.test(file.afterHash)) throw new Error('Backup file metadata failed verification.');
      this.checked(file.path);
      const content = this.file(join(base, 'files', String(index)));
      if (file.afterBytes !== undefined) {
        const after = this.file(join(base,'after',String(index)));
        if (Buffer.byteLength(after) !== file.afterBytes || digest(after) !== file.afterHash) throw new Error('Backup after-image hash verification failed.');
      }
      if (Buffer.byteLength(content) !== file.bytes || (file.existed ? digest(content) : ABSENT_HASH) !== file.beforeHash || (!file.existed && content !== '')) throw new Error('Backup hash verification failed.');
    });
    return value;
  }
  readonly unreadable: string[] = [];
  list(options: {strict?: boolean} = {}): JournalEntry[] {
    this.unreadable.length = 0;
    this.checked(this.directory);
    let names: string[];
    try { names = readdirSync(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (names.length > 4096) throw new Error('Backup directory exceeds the safe entry limit.');
    const entries: JournalEntry[] = [];
    for (const name of names.filter(name => /^\d{8}T/u.test(name)).sort().reverse()) {
      try { entries.push(this.read(name)); }
      catch (error) { if (options.strict) throw error; this.unreadable.push(name); }
    }
    return entries;
  }
  content(entry: JournalEntry, index: number): string | undefined {
    const verified = this.read(entry.id);
    if (!verified.files[index]) throw new Error('Unknown backup file.');
    return verified.files[index]!.existed ? this.file(join(this.directory, entry.id, 'files', String(index))) : undefined;
  }
  writtenContent(entry: JournalEntry,index: number): string | undefined {
    const verified=this.read(entry.id);const file=verified.files[index];
    if(!file)throw new Error('Unknown backup file.');
    if(file.afterHash===ABSENT_HASH)return undefined;
    if(file.afterBytes===undefined)throw new Error('This older backup has no verified after-image; ownership-only reset is unavailable. Use /changes for an explicit restore.');
    return this.file(join(this.directory,entry.id,'after',String(index)));
  }
  status(file: JournalFile): 'unchanged since' | 'edited since' | 'missing' {
    const current = snapshot(file.path, this.options.home);
    return current.content === undefined ? 'missing' : hash(current.content) === file.afterHash && (file.afterMode===undefined||current.mode===file.afterMode) ? 'unchanged since' : 'edited since';
  }
  private prunedKeys():Set<string> {
    const text=snapshot(join(this.directory,'.pruned.json'),this.options.home).content;
    if(text===undefined)return new Set();
    const record = JSON.parse(text);
    const keys:unknown=Array.isArray(record)?record:record.keys;
    if(!Array.isArray(keys)||keys.length>24000||keys.some(key=>typeof key!=='string'||!/^[a-f0-9]{64}$/u.test(key)))throw new Error('Backup pruning record needs review.');
    return new Set(keys as string[]);
  }
  prunedCount(): number {
    const text = snapshot(join(this.directory, '.pruned.json'), this.options.home).content;
    if (text === undefined) return 0;
    const record = JSON.parse(text);
    return Number.isSafeInteger(record.count) && record.count >= 0 ? record.count : 0;
  }
  provenanceComplete(source:string,path:string):boolean {
    return !this.prunedKeys().has(digest(`${source}:${path}`));
  }
  /** Serialize writers across frontend processes; a crashed writer's verified lock can be recovered. */
  record(changes: readonly FileChange[], source: string, label: string): JournalEntry {
    this.checked(this.directory,true);mkdirSync(this.directory,{recursive:true,mode:0o700});this.checked(this.directory,true);
    if((lstatSync(this.directory).mode&0o077)!==0)throw new Error('Backup directory must be private (0700); configuration was not changed.');
    const path=join(this.directory,'.write-lock');const token=randomUUID();
    const content=JSON.stringify({owner:'nmsh-journal',version:1,pid:process.pid,token});
    const acquire=()=>openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    let fd:number;
    try {fd=acquire();}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const before=snapshot(path,this.options.home);let lock:{owner?:string;version?:number;pid?:number};
      try {lock=JSON.parse(before.content??'');}catch{throw new Error('Backup lock is unreadable; configuration was not changed.');}
      if(lock.owner!=='nmsh-journal'||lock.version!==1||!Number.isSafeInteger(lock.pid)||lock.pid!<=0)throw new Error('Backup lock is invalid; configuration was not changed.');
      let gone=false;try{process.kill(lock.pid!,0);}catch(probe){gone=(probe as NodeJS.ErrnoException).code==='ESRCH';}
      if(!gone)throw new Error('Another NMSh configuration backup is in progress; retry after it finishes.');
      // A unique quarantine name prevents another stale-lock reclaimer from deleting our new lock.
      unchanged(before,this.options.home);
      const stale = `${path}.stale-${randomUUID()}`;
      renameSync(path, stale);
      try { fd=acquire(); } finally { rmSync(stale); }
    }
    try {writeFileSync(fd,content);fsyncSync(fd);return this.recordLocked(changes,source,label);}
    finally {closeSync(fd);try{if(this.file(path)===content)rmSync(path);}catch{/* preserve an unexpected replacement */}}
  }
  private incompleteUsage():{bytes:number;count:number} {
    const pending=readdirSync(this.directory).filter(name=>name.startsWith('.pending-'));
    let files=0;
    const size=(path:string,depth:number):number=>{
      this.checked(path);const stat=lstatSync(path);
      if(stat.isFile()){if(++files>4096)throw new Error('Incomplete backup storage needs review.');return stat.size;}
      if(!stat.isDirectory()||depth>3)throw new Error('Incomplete backup storage needs review.');
      return readdirSync(path).reduce((sum,name)=>sum+size(join(path,name),depth+1),0);
    };
    let bytes=0,count=0;
    for (const name of pending) {
      const path=join(this.directory,name);const usage=size(path,0);
      if (Date.now()-lstatSync(path).mtimeMs > 24*60*60*1000) {
        // The exclusive journal lock also proves legacy staging without an owner has no active writer.
        const owner=snapshot(join(path,'owner.json'),this.options.home).content;
        let dead=owner===undefined;
        if(owner!==undefined) {
          let lock: {owner?:string;version?:number;pid?:number};
          try {lock=JSON.parse(owner);} catch {lock={};}
          if(lock.owner==='nmsh-journal'&&lock.version===1&&Number.isSafeInteger(lock.pid)&&lock.pid!>0) {
            try {process.kill(lock.pid!,0);} catch(error) {dead=(error as NodeJS.ErrnoException).code==='ESRCH';}
          }
        }
        if(dead) {this.checked(path,true);rmSync(path,{recursive:true});continue;}
      }
      bytes+=usage;count++;
    }
    return {bytes,count};
  }
  private recordLocked(changes: readonly FileChange[], source: string, label: string): JournalEntry {
    if(!/^[a-z][a-z0-9-]{0,63}$/u.test(source)||label.length>512)throw new Error('Backup source or label is invalid.');
    if (changes.length > 512 || new Set(changes.map(change => change.before.path)).size !== changes.length) throw new Error('Backup file limit or duplicate path.');
    for (const change of changes) {
      unchanged(change.before, this.options.home);
      if(Buffer.byteLength(change.after??'')>2*1024*1024)throw new Error('Backup file limit is 2 MiB; configuration was not changed.');
    }
    const now = new Date();
    const id = `${now.toISOString().replace(/[-:.]/gu, '')}-${randomUUID()}`;
    const entry: JournalEntry = {version: 1, id, time: now.toISOString(), source, label, outcome: 'prepared', files: changes.map(change => ({
      path: change.before.path, existed: change.before.content !== undefined, mode: change.before.mode,
      beforeHash: hash(change.before.content), afterHash: hash(change.after), bytes: Buffer.byteLength(change.before.content ?? ''),
      ...(change.after===undefined?{}:{afterBytes:Buffer.byteLength(change.after),afterMode:change.afterMode??change.before.mode}),
    }))};
    const serialized = `${JSON.stringify(entry, null, 2)}\n`;
    const ownerContent=JSON.stringify({owner:'nmsh-journal',version:1,pid:process.pid});
    const size = Buffer.byteLength(ownerContent) + Buffer.byteLength(serialized) + entry.files.reduce((sum, file) => sum + (file.bytes + (file.afterBytes ?? 0)), 0);
    const maxBytes = this.options.maxBytes ?? 64 * 1024 * 1024;
    const maxEntries = this.options.maxEntries ?? 200;
    if (size > maxBytes || maxEntries < 1) throw new Error('Backup capacity limit reached; configuration was not changed.');
    this.checked(this.directory, true);
    const existing = this.list({strict:true});
    const cost = (item: JournalEntry) => Buffer.byteLength(snapshot(join(this.directory,item.id,'owner.json'),this.options.home).content??'') + Buffer.byteLength(this.file(join(this.directory,item.id,'manifest.json'))) + item.files.reduce((n,f)=>n+f.bytes+(f.afterBytes??0),0);
    const incomplete=this.incompleteUsage();
    const pruned=this.prunedKeys();
    const oldMarker=Buffer.byteLength(snapshot(join(this.directory,'.pruned.json'),this.options.home).content??'');
    const previousCount=this.prunedCount();
    let used = oldMarker + incomplete.bytes + existing.reduce((sum, item) => sum + cost(item), 0);
    let count = existing.length + incomplete.count;
    const victims: JournalEntry[] = [];
    const keep = new Set(existing.filter(item=>protectedSource(item.source)).slice(0,protectedSource(source)?19:20).map(item=>item.id));
    // The incoming entry anchors its source/paths; retain the newest anchor for every other pair.
    const anchored = new Set(changes.map(change=>`${source}:${change.before.path}`));
    for (const item of existing) for(const file of item.files) {
      const key=`${item.source}:${file.path}`;
      if(!anchored.has(key)){keep.add(item.id);anchored.add(key);}
    }
    // The oldest backup of each file holds what it was before NMSh first changed it: a burst of automatic writes to other
    // files (cursor shaders regenerate often) must not push that original out. It goes only when nothing else can.
    const originals = new Set<string>(), originalPaths = new Set<string>();
    for (const item of [...existing].reverse()) for (const file of item.files) {
      if (!originalPaths.has(file.path)) { originals.add(item.id); originalPaths.add(file.path); }
    }
    const markerText = () => JSON.stringify({keys:[...pruned],count:previousCount+victims.length});
    const fits = () => used + size + (victims.length ? Buffer.byteLength(markerText()) - oldMarker : 0) <= maxBytes && count + 1 <= maxEntries;
    for (const lastResort of [false, true]) for (const old of [...existing].reverse()) {
      if (fits()) break;
      if (keep.has(old.id) || victims.includes(old) || (!lastResort && originals.has(old.id))) continue;
      used -= cost(old); count--; victims.push(old);
      for(const file of old.files)pruned.add(digest(`${old.source}:${file.path}`));
    }
    if (!fits()) throw new Error('Backup capacity limit reached after pruning; recent protected checkpoints and source/path anchors are kept. Review backups before retrying.');
    const marker=markerText();
    if(pruned.size>24000)throw new Error('Backup pruning metadata capacity reached; configuration was not changed.');
    if(victims.length){this.atomic(join(this.directory,'.pruned.json'),marker);if(this.file(join(this.directory,'.pruned.json'))!==marker)throw new Error('Backup pruning record failed verification.');}
    // Only verified journal entries selected above are eligible; no user paths are ever pruned.
    for (const old of victims) { const path = join(this.directory, old.id); this.checked(path, true); rmSync(path, {recursive: true}); }
    mkdirSync(this.directory, {recursive:true, mode:0o700});
    this.checked(this.directory, true);
    if ((lstatSync(this.directory).mode & 0o077) !== 0) throw new Error('Backup directory must be private (0700); configuration was not changed.');
    // Publish only a complete verified entry. Interrupted staging is ignored by history and expires after a day.
    const base = join(this.directory, `.pending-${id}`);
    mkdirSync(base, {mode:0o700}); mkdirSync(join(base,'files'), {mode:0o700}); mkdirSync(join(base,'after'), {mode:0o700});
    this.atomic(join(base,'owner.json'),ownerContent);
    changes.forEach((change,index) => {
      this.atomic(join(base,'files',String(index)),change.before.content ?? '');
      if(change.after!==undefined)this.atomic(join(base,'after',String(index)),change.after);
    });
    this.atomic(join(base,'manifest.json'),serialized);
    changes.forEach((change,index)=>{
      if(this.file(join(base,'files',String(index)))!==(change.before.content??''))throw new Error('Backup before-image read-back verification failed.');
      if(change.after!==undefined&&this.file(join(base,'after',String(index)))!==change.after)throw new Error('Backup after-image read-back verification failed.');
    });
    if(this.file(join(base,'manifest.json'))!==serialized)throw new Error('Backup manifest read-back verification failed.');
    this.syncDirectory(base);
    this.checked(join(this.directory,id),true);renameSync(base,join(this.directory,id));
    this.syncDirectory(this.directory);
    return this.read(id);
  }
  complete(entry: JournalEntry): void {
    const verified = this.read(entry.id);
    for (const file of verified.files) {
      const current=snapshot(file.path,this.options.home);
      if(hash(current.content)!==file.afterHash||(file.afterMode!==undefined&&current.mode!==file.afterMode))throw new Error('Written configuration did not verify; backup is retained.');
    }
    this.atomic(join(this.directory,entry.id,'manifest.json'),`${JSON.stringify({...verified,outcome:'applied'},null,2)}\n`);
    this.read(entry.id);
  }
}
