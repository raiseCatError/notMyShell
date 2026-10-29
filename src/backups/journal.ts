/** Private, verified before-images. A failed checkpoint must prevent its configuration write. */
import {constants, closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, lstatSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join, dirname} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {checkContained, checkPath, digest, snapshot, unchanged, type FileChange} from '../appearance/hostFiles.js';

export interface JournalOptions {home: string; directory?: string; maxEntries?: number; maxBytes?: number}
export interface JournalFile {path: string; existed: boolean; mode: number; beforeHash: string; afterHash: string; bytes: number; afterBytes?: number; afterMode?: number}
/**
 * How an unfinished write ended. `outcome` keeps only 'prepared' | 'applied' so older NMSh builds can still read every entry;
 * the resolution is extra evidence they ignore.
 */
export interface JournalResolution {state: 'reverted' | 'rollback-incomplete' | 'finalized' | 'partial' | 'reviewed'; at: string; detail?: string}
export interface JournalEntry {version: 1; id: string; time: string; source: string; label: string; files: JournalFile[]; outcome: 'prepared' | 'applied'; resolution?: JournalResolution; group?: string}
/** What the files on disk say about an entry. Computed from bytes and hashes only; never assumed. */
export type TransactionState = 'applied' | 'in-progress' | 'not-applied' | 'partially-applied' | 'applied-unfinalized' | 'conflicted' | 'reverted' | 'rollback-incomplete' | 'partial' | 'indeterminate' | 'reviewed';
export type FileEvidence = 'before' | 'after' | 'neither' | 'unsafe';
export interface TransactionReport {state: TransactionState; files: FileEvidence[]; reasons: string[]; writer?: number}
export interface FileInspection {status: 'unchanged since' | 'edited since' | 'missing' | 'unsafe'; reason?: string}
const RESOLUTIONS = ['reverted', 'rollback-incomplete', 'finalized', 'partial', 'reviewed'];
/** A journal write takes well under a second; a "live" writer of an older entry is a reused process id, not the writer. */
const LIVE_WRITER_MS = 10 * 60 * 1000;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export interface JournalMetadata {
  source: string; label: string; directory?: string;
  /** Links an entry to the reset checkpoint it is a stage of. */
  group?: string;
  /** Test seam: called at each transaction boundary ('recorded', 'written:<index>', 'before-complete'). */
  fault?: (stage: string) => void;
}
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
    if (value.resolution !== undefined && (typeof value.resolution !== 'object' || value.resolution === null || !RESOLUTIONS.includes(value.resolution.state)
      || typeof value.resolution.at !== 'string' || (value.resolution.detail !== undefined && (typeof value.resolution.detail !== 'string' || value.resolution.detail.length > 2048)))) throw new Error('Backup resolution failed verification.');
    if (value.group !== undefined && (typeof value.group !== 'string' || !/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/u.test(value.group))) throw new Error('Backup group failed verification.');
    value.files.forEach((file, index) => {
      if (typeof file.path !== 'string' || typeof file.existed !== 'boolean' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777
        || (file.afterMode!==undefined&&(!Number.isInteger(file.afterMode)||file.afterMode<0||file.afterMode>0o777))
        || typeof file.afterHash !== 'string' || !/^(?:absent|[a-f0-9]{64})$/u.test(file.afterHash)) throw new Error('Backup file metadata failed verification.');
      // Only the recorded path's shape is checked here. Its current filesystem state belongs to whoever reads or writes that file,
      // so a damaged target never makes the journal (and every unrelated configuration write) unreadable.
      checkContained(file.path, this.options.home);
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
  /** Why each unreadable entry failed verification, by id. Such entries are kept for review and never pruned automatically. */
  readonly unreadableReasons = new Map<string, string>();
  /** Paths an unreadable entry's manifest still names (best effort), so writes to those files can fail closed. */
  readonly unreadablePaths = new Map<string, string[]>();
  private damagedPaths(id: string): string[] {
    try {
      const manifest = JSON.parse(this.file(join(this.directory, id, 'manifest.json'))) as {files?: Array<{path?: unknown}>};
      return Array.isArray(manifest.files) ? manifest.files.flatMap(file => typeof file?.path === 'string' ? [file.path] : []).slice(0, 512) : [];
    } catch { return []; }
  }
  list(options: {strict?: boolean} = {}): JournalEntry[] {
    this.unreadable.length = 0; this.unreadableReasons.clear(); this.unreadablePaths.clear();
    this.checked(this.directory);
    let names: string[];
    try { names = readdirSync(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (names.length > 4096) throw new Error('Backup directory exceeds the safe entry limit.');
    const entries: JournalEntry[] = [];
    for (const name of names.filter(name => /^\d{8}T/u.test(name)).sort().reverse()) {
      try { entries.push(this.read(name)); }
      catch (error) { if (options.strict) throw new Error(`Backup ${name} needs review: ${message(error)}`); this.unreadable.push(name); this.unreadableReasons.set(name, message(error)); this.unreadablePaths.set(name, this.damagedPaths(name)); }
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
  /** Like status, but an unsafe or unreadable path is reported with its exact reason instead of throwing. */
  inspect(file: JournalFile): FileInspection {
    try { return {status: this.status(file)}; } catch (error) { return {status: 'unsafe', reason: message(error)}; }
  }
  private evidence(file: JournalFile): FileEvidence {
    let current;
    try { current = snapshot(file.path, this.options.home); } catch { return 'unsafe'; }
    const now = hash(current.content);
    const modeMatches = (mode: number | undefined) => current.content === undefined || mode === undefined || current.mode === mode;
    if (now === file.afterHash && modeMatches(file.afterMode)) return 'after';
    if (now === file.beforeHash && (!file.existed || current.mode === file.mode)) return 'before';
    return 'neither';
  }
  /** The live writer of an unfinished entry, if its recorded process still runs. This process never has one in flight between calls. */
  private writer(entry: JournalEntry): number | undefined {
    let owner: {pid?: number} = {};
    try { owner = JSON.parse(snapshot(join(this.directory, entry.id, 'owner.json'), this.options.home).content ?? '{}'); } catch { return undefined; }
    const pid = owner.pid;
    if (!Number.isSafeInteger(pid) || pid! <= 0 || pid === process.pid) return undefined;
    if (!(Date.now() - Date.parse(entry.time) < LIVE_WRITER_MS)) return undefined;
    try { process.kill(pid!, 0); return pid; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' ? pid : undefined; }
  }
  /**
   * Reconcile an entry against the bytes on disk. A prepared entry is never assumed to have succeeded: it is classified from each
   * file's hash as not applied, partially applied, applied but not finalized, or conflicted (edited by something else since).
   */
  transactionState(entry: JournalEntry): TransactionReport {
    const files = entry.files.map(file => this.evidence(file));
    const reasons = entry.files.flatMap((file, index) => files[index] === 'unsafe' ? [`${file.path}: ${this.inspect(file).reason ?? 'unreadable'}`] : []);
    if (entry.resolution) return {state: entry.resolution.state === 'finalized' ? 'applied' : entry.resolution.state, files, reasons};
    if (entry.outcome === 'applied') return {state: 'applied', files, reasons};
    const writer = this.writer(entry);
    if (writer !== undefined) return {state: 'in-progress', files, reasons, writer};
    if (files.includes('unsafe')) return {state: 'indeterminate', files, reasons};
    if (files.includes('neither')) return {state: 'conflicted', files, reasons};
    // A file whose before and after are identical matches both; it never decides the state alone.
    const same = entry.files.map(file => file.beforeHash === file.afterHash && (file.afterMode === undefined || file.afterMode === file.mode));
    const decisive = files.filter((_, index) => !same[index]);
    if (!decisive.length || decisive.every(value => value === 'after')) return {state: 'applied-unfinalized', files, reasons};
    if (decisive.every(value => value === 'before')) return {state: 'not-applied', files, reasons};
    return {state: 'partially-applied', files, reasons};
  }
  /** Record how an unfinished entry ended. Only the manifest changes; before- and after-images stay as evidence. */
  resolve(entry: JournalEntry, resolution: Omit<JournalResolution, 'at'>): JournalEntry {
    const verified = this.read(entry.id);
    const next: JournalEntry = {...verified, ...(resolution.state === 'finalized' ? {outcome: 'applied' as const} : {}),
      resolution: {state: resolution.state, at: new Date().toISOString(), ...(resolution.detail ? {detail: resolution.detail.slice(0, 2048)} : {})}};
    this.atomic(join(this.directory, entry.id, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
    return this.read(entry.id);
  }
  /** Set an unfinished entry aside after review: files are left exactly as they are, the evidence stays, and it becomes prunable. */
  dismiss(entry: JournalEntry): JournalEntry {
    const report = this.transactionState(this.read(entry.id));
    if (report.state === 'in-progress') throw new Error('Another NMSh process is still writing this change; wait for it to finish.');
    if (report.state === 'applied' || report.state === 'reverted' || report.state === 'reviewed') throw new Error('This change is already settled.');
    return this.resolve(entry, {state: 'reviewed', detail: `Reviewed and set aside while ${report.state}; files were left as they were.`});
  }
  /** Mark an interrupted entry finished, only when every file verifiably holds the bytes it was meant to write. */
  finalize(entry: JournalEntry): JournalEntry {
    const report = this.transactionState(this.read(entry.id));
    if (report.state !== 'applied-unfinalized') throw new Error(`Only an entry whose files all hold the written bytes can be finalized (this one is ${report.state}).`);
    return this.resolve(entry, {state: 'finalized', detail: 'Every file held the bytes this change wrote; finalized after an interruption.'});
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
  record(changes: readonly FileChange[], source: string, label: string, options: {group?: string} = {}): JournalEntry {
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
    try {writeFileSync(fd,content);fsyncSync(fd);return this.recordLocked(changes,source,label,options.group);}
    finally {closeSync(fd);try{if(this.file(path)===content)rmSync(path);}catch{/* preserve an unexpected replacement */}}
  }
  private incompleteUsage(damaged: readonly string[] = []):{bytes:number;count:number} {
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
    // Entries that failed verification stay where they are for review: they count toward the limits and are never pruned.
    for (const name of damaged) {
      const path=join(this.directory,name);
      try {bytes+=size(path,0);} catch {/* an unmeasurable entry still counts once */}
      count++;
    }
    return {bytes,count};
  }
  private recordLocked(changes: readonly FileChange[], source: string, label: string, group?: string): JournalEntry {
    if(!/^[a-z][a-z0-9-]{0,63}$/u.test(source)||label.length>512)throw new Error('Backup source or label is invalid.');
    if (changes.length > 512 || new Set(changes.map(change => change.before.path)).size !== changes.length) throw new Error('Backup file limit or duplicate path.');
    for (const change of changes) {
      unchanged(change.before, this.options.home);
      if(Buffer.byteLength(change.after??'')>2*1024*1024)throw new Error('Backup file limit is 2 MiB; configuration was not changed.');
    }
    const now = new Date();
    const id = `${now.toISOString().replace(/[-:.]/gu, '')}-${randomUUID()}`;
    if (group !== undefined && !/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/u.test(group)) throw new Error('Backup group is invalid.');
    const entry: JournalEntry = {version: 1, id, time: now.toISOString(), source, label, outcome: 'prepared', ...(group ? {group} : {}), files: changes.map(change => ({
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
    // A damaged entry is kept for review; it must not block unrelated configuration writes.
    const existing = this.list();
    const damaged = [...this.unreadable];
    // Fail closed only for the file a damaged backup names: its history needs review before NMSh changes it again.
    // NMSh's own JSON records (settings, ownership) ride along with many writes; they are always re-captured in full, so a damaged
    // older copy of one never blocks them. Each named user file does fail closed.
    const own = dirname(this.directory);
    const bookkeeping = (path: string) => path.endsWith('.json') && path.startsWith(`${own}/`);
    for (const name of damaged) {
      const path = changes.map(change => change.before.path).find(candidate => !bookkeeping(candidate) && this.unreadablePaths.get(name)!.includes(candidate));
      if (path) throw new Error(`Backup ${name} of ${path} failed verification (${this.unreadableReasons.get(name)}); review it in /changes. `
        + `To continue, move ${join(this.directory, name)} out of the backups folder. Other files can still be changed.`);
    }
    const cost = (item: JournalEntry) => Buffer.byteLength(snapshot(join(this.directory,item.id,'owner.json'),this.options.home).content??'') + Buffer.byteLength(this.file(join(this.directory,item.id,'manifest.json'))) + item.files.reduce((n,f)=>n+f.bytes+(f.afterBytes??0),0);
    const incomplete=this.incompleteUsage(damaged);
    const pruned=this.prunedKeys();
    const oldMarker=Buffer.byteLength(snapshot(join(this.directory,'.pruned.json'),this.options.home).content??'');
    const previousCount=this.prunedCount();
    let used = oldMarker + incomplete.bytes + existing.reduce((sum, item) => sum + cost(item), 0);
    let count = existing.length + incomplete.count;
    const victims: JournalEntry[] = [];
    const keep = new Set(existing.filter(item=>protectedSource(item.source)).slice(0,protectedSource(source)?19:20).map(item=>item.id));
    // An unfinished write is evidence for recovery (or still in flight in another process): never pruned automatically.
    for (const item of existing) if ((item.outcome==='prepared'&&!item.resolution)||item.resolution?.state==='rollback-incomplete') keep.add(item.id);
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
