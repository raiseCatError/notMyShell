/** Narrow file transactions for explicit host-configuration plans. Never used on startup. */
import {constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {Journal, type JournalMetadata, type JournalEntry} from '../backups/journal.js';

export const digest = (content: string) => createHash('sha256').update(content).digest('hex');
export interface FileSnapshot {path: string; content?: string; identity: string; mode: number}
export interface FileChange {before: FileSnapshot; after?: string; afterMode?: number}
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const identity = (stat: Stats) => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.uid}:${stat.gid}`;

const within = (root: string, path: string) => { const inside = relative(root, path); return !(inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)); };

/**
 * Reject every symbolic-link component. Missing descendants are allowed only below a verified directory. Paths must be inside the
 * home, or inside NMSh's own configuration directory (XDG_CONFIG_HOME may point outside the home); the same checks apply there.
 */
export function checkPath(path: string, homeRoot: string, writable = false): void {
  const own = nmshConfigDirectory();
  const home = isAbsolute(path) && !within(homeRoot, path) && within(own, path) ? own : homeRoot;
  const inside = relative(home, path);
  if (!isAbsolute(path) || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('The configuration path is outside your home; no changes are allowed.');
  const parts = resolve(path).split(sep).filter(Boolean);
  let current: string = sep;
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]!);
    let stat;
    try { stat = lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`A symbolic link prevents safe configuration access: ${current}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('A configuration parent is not a directory.');
    // System ancestors need not belong to this user; the home and its descendants must.
    if (current === home || current.startsWith(`${home}${sep}`)) {
      if (process.getuid && stat.uid !== process.getuid()) throw new Error('The configuration path is owned by another user.');
      if (writable && (stat.mode & 0o222) === 0) throw new Error('The configuration path is read-only.');
      if (writable && (stat.mode & 0o022) !== 0) throw new Error('The configuration path is writable by a group or everyone.');
    }
  }
}

export function snapshot(path: string, home: string, writable = false): FileSnapshot {
  checkPath(path, home, writable);
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {path, identity: 'absent', mode: 0o600};
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Configuration must be a bounded regular file (at most 2 MiB).');
    const bytes=readFileSync(fd);
    const content=bytes.toString('utf8');
    if(bytes.length>MAX_FILE_BYTES||!Buffer.from(content,'utf8').equals(bytes))throw new Error('Configuration must be bounded UTF-8 text; no changes are allowed.');
    return {path, content, identity: identity(stat), mode: stat.mode & 0o777};
  } finally { closeSync(fd); }
}

export function unchanged(before: FileSnapshot, home: string, writable = false): void {
  const now = snapshot(before.path, home, writable);
  if (now.identity !== before.identity || now.content !== before.content) throw new Error('Configuration changed since the preview; review a new plan.');
}

/** Exclusive random staging, preserved permissions and atomic rename per file. */
function replace(path: string, content: string, mode: number, home: string, expected?: FileSnapshot): void {
  checkPath(path, home, true);
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  checkPath(path, home, true);
  const temporary = `${path}.nmsh-${randomUUID()}.tmp`;
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, content, 'utf8'); fchmodSync(fd, mode); fsyncSync(fd); }
  catch (error) { try { unlinkSync(temporary); } catch { /* retain original error */ } throw error; }
  finally { closeSync(fd); }
  try { checkPath(path, home, true); if (expected) unchanged(expected, home, true); renameSync(temporary, path); }
  finally { try { unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

/** All dependencies checked before staging or mutation. On failure restore only our unchanged writes. */
export function transact(changes: readonly FileChange[], dependencies: readonly FileSnapshot[], home: string, metadata: JournalMetadata = {source: 'appearance', label: 'Host configuration change'}): JournalEntry | undefined {
  for (const dependency of dependencies) unchanged(dependency, home);
  for (const change of changes) unchanged(change.before, home, true);
  const effective = ['restore','reset'].includes(metadata.source) ? [...changes] : changes.filter(change => change.after !== change.before.content || (change.afterMode!==undefined&&change.afterMode!==change.before.mode));
  if (!effective.length) return;
  const journal = new Journal({home, directory: metadata.directory});
  let entry:JournalEntry;
  try {entry=journal.record(effective,metadata.source,metadata.label);}
  catch(error){throw new Error(`Could not create a verified backup; configuration was not changed. ${error instanceof Error?error.message:String(error)}`);}
  // Backup I/O may take time: recheck every dependency before the first mutation.
  for (const dependency of dependencies) unchanged(dependency, home);
  for (const change of changes) unchanged(change.before, home, true);
  const done: FileChange[] = [];
  try {
    for (const change of changes) {
      unchanged(change.before, home, true);
      if (change.after === change.before.content && (change.afterMode===undefined||change.afterMode===change.before.mode)) continue;
      if (change.after === undefined) unlinkSync(change.before.path);
      else replace(change.before.path, change.after, change.afterMode ?? change.before.mode, home, change.before);
      done.push(change);
    }
    journal.complete(entry);
    return entry;
  } catch (error) {
    let incomplete = false;
    for (const change of done.reverse()) {
      try {
        const current = snapshot(change.before.path, home, true);
        if (current.content !== change.after) { incomplete = true; continue; }
        if (change.before.content === undefined) unlinkSync(change.before.path);
        else replace(change.before.path, change.before.content, change.before.mode, home, current);
      } catch { incomplete = true; }
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}${incomplete ? ' Recovery is incomplete; preserve the files and inspect the preview before retrying.' : ' Applied file changes were rolled back.'}`);
  }
}
