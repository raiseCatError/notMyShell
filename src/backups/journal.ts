/** Private, verified before-images. A failed checkpoint must prevent its configuration write. */
import {constants, closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, lstatSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join, dirname} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {checkPath, digest, snapshot, unchanged, type FileChange} from '../appearance/hostFiles.js';

export interface JournalOptions {home: string; directory?: string; maxEntries?: number; maxBytes?: number}
export interface JournalFile {path: string; existed: boolean; mode: number; beforeHash: string; afterHash: string; bytes: number}
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
    if (value.version !== 1 || value.id !== id || typeof value.source !== 'string' || typeof value.label !== 'string'
      || typeof value.time !== 'string' || !Array.isArray(value.files) || value.files.length > 512) throw new Error('Backup manifest failed verification.');
    value.files.forEach((file, index) => {
      if (typeof file.path !== 'string' || typeof file.existed !== 'boolean' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777
        || typeof file.afterHash !== 'string' || !/^(?:absent|[a-f0-9]{64})$/u.test(file.afterHash)) throw new Error('Backup file metadata failed verification.');
      this.checked(file.path);
      const content = this.file(join(base, 'files', String(index)));
      if (Buffer.byteLength(content) !== file.bytes || (file.existed ? digest(content) : ABSENT_HASH) !== file.beforeHash || (!file.existed && content !== '')) throw new Error('Backup hash verification failed.');
    });
    return value;
  }
  list(): JournalEntry[] {
    this.checked(this.directory);
    let names: string[];
    try { names = readdirSync(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (names.length > 4096) throw new Error('Backup directory exceeds the safe entry limit.');
    return names.filter(name => /^\d{8}T/u.test(name)).sort().reverse().map(name => this.read(name));
  }
  content(entry: JournalEntry, index: number): string | undefined {
    const verified = this.read(entry.id);
    if (!verified.files[index]) throw new Error('Unknown backup file.');
    return verified.files[index]!.existed ? this.file(join(this.directory, entry.id, 'files', String(index))) : undefined;
  }
  status(file: JournalFile): 'unchanged since' | 'edited since' | 'missing' {
    const current = snapshot(file.path, this.options.home);
    return current.content === undefined ? 'missing' : hash(current.content) === file.afterHash ? 'unchanged since' : 'edited since';
  }
  record(changes: readonly FileChange[], source: string, label: string): JournalEntry {
    if (changes.length > 512 || new Set(changes.map(change => change.before.path)).size !== changes.length) throw new Error('Backup file limit or duplicate path.');
    for (const change of changes) unchanged(change.before, this.options.home);
    const now = new Date();
    const id = `${now.toISOString().replace(/[-:.]/gu, '')}-${randomUUID()}`;
    const entry: JournalEntry = {version: 1, id, time: now.toISOString(), source, label, outcome: 'prepared', files: changes.map(change => ({
      path: change.before.path, existed: change.before.content !== undefined, mode: change.before.mode,
      beforeHash: hash(change.before.content), afterHash: hash(change.after), bytes: Buffer.byteLength(change.before.content ?? ''),
    }))};
    const serialized = `${JSON.stringify(entry, null, 2)}\n`;
    const size = Buffer.byteLength(serialized) + entry.files.reduce((sum, file) => sum + file.bytes, 0);
    const maxBytes = this.options.maxBytes ?? 64 * 1024 * 1024;
    const maxEntries = this.options.maxEntries ?? 200;
    if (size > maxBytes || maxEntries < 1) throw new Error('Backup capacity limit reached; configuration was not changed.');
    this.checked(this.directory, true);
    const existing = this.list();
    const cost = (item: JournalEntry) => Buffer.byteLength(this.file(join(this.directory,item.id,'manifest.json'))) + item.files.reduce((n,f)=>n+f.bytes,0);
    let used = existing.reduce((sum, item) => sum + cost(item), 0);
    let count = existing.length;
    const victims: JournalEntry[] = [];
    for (const old of [...existing].reverse()) {
      if (used + size <= maxBytes && count + 1 <= maxEntries) break;
      if (protectedSource(old.source)) continue;
      used -= cost(old); count--; victims.push(old);
    }
    if (used + size > maxBytes || count + 1 > maxEntries) throw new Error('Backup capacity limit reached; reset, restore and manual entries are kept. Review backups before retrying.');
    // Only verified journal entries selected above are eligible; no user paths are ever pruned.
    for (const old of victims) { const path = join(this.directory, old.id); this.checked(path, true); rmSync(path, {recursive: true}); }
    mkdirSync(this.directory, {recursive:true, mode:0o700});
    this.checked(this.directory, true);
    if ((lstatSync(this.directory).mode & 0o077) !== 0) throw new Error('Backup directory must be private (0700); configuration was not changed.');
    const base = join(this.directory, id);
    mkdirSync(base, {mode:0o700}); mkdirSync(join(base,'files'), {mode:0o700});
    changes.forEach((change,index) => this.atomic(join(base,'files',String(index)),change.before.content ?? ''));
    this.atomic(join(base,'manifest.json'),serialized);
    this.syncDirectory(base); this.syncDirectory(this.directory);
    return this.read(id);
  }
  complete(entry: JournalEntry): void {
    const verified = this.read(entry.id);
    for (const file of verified.files) if (hash(snapshot(file.path,this.options.home).content) !== file.afterHash) throw new Error('Written configuration did not verify; backup is retained.');
    this.atomic(join(this.directory,entry.id,'manifest.json'),`${JSON.stringify({...verified,outcome:'applied'},null,2)}\n`);
    this.read(entry.id);
  }
}
