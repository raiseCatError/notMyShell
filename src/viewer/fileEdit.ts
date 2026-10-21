import {createHash, randomBytes} from 'node:crypto';
import {constants, lstatSync} from 'node:fs';
import {access, link, lstat, open, readFile, realpath, rename, stat, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {displayPath, resolveViewPath} from './document.js';

/**
 * Opening and saving a small text file for the native editor (#402). Only files that can be saved back exactly and
 * safely are opened for editing; anything else is refused with the reason (and stays readable in /view):
 *
 * - a regular UTF-8 text file of at most MAX_EDIT_BYTES, owned by this user, with one hard link, whose file and
 *   directory are writable, with one kind of line ending (LF or CRLF); a BOM and the final newline are kept;
 * - a path that does not exist yet, in a writable directory, opens empty and is created on save (never over a file
 *   that appeared meanwhile).
 *
 * Saving writes a new file beside the original (exclusive create, the original's mode, group when permitted), syncs it,
 * checks that the original is still the file that was opened (device, inode, size, time and a content hash) and
 * renames it over the original's real path. A changed, replaced or deleted original is a conflict for the person to
 * decide; nothing is overwritten silently. Extended attributes and ACLs are not carried over by the rename.
 */

export const MAX_EDIT_BYTES = 1024 * 1024;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export interface FileIdentity {dev: number; ino: number; size: number; mtimeMs: number; hash: string}

export interface EditableFile {
  /** The path as given, resolved (it may be a symlink). */
  path: string;
  /** The file written: the symlink's target. */
  realPath: string;
  title: string;
  /** The original's permission bits; undefined for a new file (it gets the default mode under the umask). */
  mode?: number;
  gid?: number;
  /** Undefined for a file that does not exist yet. */
  identity?: FileIdentity;
  lineEnding: 'lf' | 'crlf';
  bom: boolean;
  finalNewline: boolean;
  lines: string[];
  /** A Playground document (#468): not a file yet. `realPath` is `scratch:<id>`, a stable identity for recovery and never a path to read or write. */
  scratch?: {id: string};
}

const STARTER_HTML = ['<!doctype html>', '<html lang="en">', '<head>', '  <meta charset="utf-8">', '  <title>Playground</title>', '</head>', '<body>', '  ', '</body>', '</html>'];

/** An unsaved Markdown or HTML document: empty (Markdown) or a minimal page (HTML). It has no path and no disk identity; only Save As makes it a file. */
export function createScratchFile(format: 'markdown' | 'html', id: string = randomBytes(8).toString('hex')): EditableFile {
  return {path: format === 'html' ? 'Untitled.html' : 'Untitled.md', realPath: `scratch:${id}`, title: 'Untitled (not saved)', lineEnding: 'lf', bom: false, finalNewline: true,
    lines: format === 'html' ? [...STARTER_HTML] : [''], scratch: {id}};
}

/**
 * Whether two real paths are the same file. Equal spellings are; different spellings only if both exist and are one file
 * (device and inode), which is how a case-insensitive volume reports `New.md` and `new.md`; on a case-sensitive one they are not.
 */
export function sameRealFile(a: string, b: string, stat: (path: string) => {dev: number; ino: number} = path => lstatSync(path)): boolean {
  if (a === b) return true;
  try { const first = stat(a), second = stat(b); return first.dev === second.dev && first.ino === second.ino; } catch { return false; }
}

export type OpenResult = {ok: true; file: EditableFile} | {ok: false; reason: string};
export type SaveConflict = 'changed' | 'replaced' | 'deleted' | 'exists';
export type SaveResult = {ok: true; file: EditableFile} | {ok: false; reason: string; conflict?: SaveConflict};

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const code = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

function failure(error: unknown, action: string, shown: string): string {
  switch (code(error)) {
    case 'EACCES': case 'EPERM': return `Could not ${action} ${shown}: permission denied.`;
    case 'EROFS': return `Could not ${action} ${shown}: the file system is read-only.`;
    case 'ENOSPC': return `Could not ${action} ${shown}: the disk is full.`;
    case 'EDQUOT': return `Could not ${action} ${shown}: over the disk quota.`;
    case 'ENOENT': return `Could not ${action} ${shown}: it no longer exists.`;
    case 'ELOOP': return `Could not ${action} ${shown}: a symlink loop.`;
    case 'EISDIR': return `Could not ${action} ${shown}: it is a directory.`;
    default: return `Could not ${action} ${shown}${code(error) ? ` (${code(error)})` : ''}.`;
  }
}

async function writable(path: string): Promise<boolean> {
  try { await access(path, constants.W_OK); return true; } catch { return false; }
}

/** Open `input` (relative to `cwd`, `~` for home) for editing, or say why it cannot be edited. */
export async function openForEdit(input: string, cwd: string, options: {home?: string; maxBytes?: number; uid?: number} = {}): Promise<OpenResult> {
  const home = options.home ?? homedir();
  const path = resolveViewPath(input, cwd, home);
  const shown = displayPath(path, home);
  const uid = options.uid ?? process.getuid?.();
  let realPath: string;
  try { realPath = await realpath(path); }
  catch (error) {
    if (code(error) !== 'ENOENT') return {ok: false, reason: failure(error, 'open', shown)};
    try { await lstat(path); return {ok: false, reason: `${shown} is a symlink to a missing file; edit its target instead.`}; } catch { /* nothing there: a new file */ }
    const directory = dirname(path);
    let info;
    try { info = await stat(directory); } catch { return {ok: false, reason: `${displayPath(directory, home)} does not exist; create the directory first.`}; }
    if (!info.isDirectory()) return {ok: false, reason: `${displayPath(directory, home)} is not a directory.`};
    if (!(await writable(directory))) return {ok: false, reason: `${displayPath(directory, home)} is not writable, so ${shown} cannot be created.`};
    // The real path it will have (the folder may be reached through a symlink, as macOS /tmp is): every later save
    // checks the file against realpath() of the path as given, which is this once the file exists.
    let realDirectory: string;
    try { realDirectory = await realpath(directory); } catch (error) { return {ok: false, reason: failure(error, 'open', shown)}; }
    return {ok: true, file: {path, realPath: join(realDirectory, basename(path)), title: shown, lineEnding: 'lf', bom: false, finalNewline: true, lines: ['']}};
  }
  let handle;
  try { handle = await open(realPath, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0) | (constants.O_NOCTTY ?? 0)); }
  catch (error) { return {ok: false, reason: failure(error, 'open', shown)}; }
  try {
    const info = await handle.stat();
    if (info.isDirectory()) return {ok: false, reason: `${shown} is a directory.`};
    if (!info.isFile()) return {ok: false, reason: `${shown} is not a regular file.`};
    const maxBytes = options.maxBytes ?? MAX_EDIT_BYTES;
    if (info.size > maxBytes) return {ok: false, reason: `${shown} is larger than ${Math.round(maxBytes / 1024)} KiB; the NMSh editor is for small files. Use your editor, or /view to read it.`};
    if (uid !== undefined && info.uid !== uid) return {ok: false, reason: `${shown} belongs to another user; NMSh edits only your own files. /view reads it.`};
    if (info.nlink > 1) return {ok: false, reason: `${shown} has other hard links, which saving by replacement would separate. Use your editor, or /view to read it.`};
    const bytes = await handle.readFile();
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return {ok: false, reason: `${shown} is UTF-16 text; the NMSh editor edits UTF-8 only.`};
    if (bytes.includes(0)) return {ok: false, reason: `${shown} looks binary (it contains NUL bytes).`};
    const bom = bytes.subarray(0, 3).equals(BOM);
    let text: string;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(bom ? bytes.subarray(3) : bytes); }
    catch { return {ok: false, reason: `${shown} is not valid UTF-8; saving could change bytes it holds. /view reads it.`}; }
    const finalNewline = text.endsWith('\n');
    const raw = text.split('\n');
    if (finalNewline) raw.pop();
    const terminated = finalNewline ? raw.length : raw.length - 1;
    const crlf = raw.slice(0, terminated).filter(line => line.endsWith('\r')).length;
    if (crlf && crlf !== terminated) return {ok: false, reason: `${shown} mixes LF and CRLF line endings; saving would change them. Use your editor, or /view to read it.`};
    const lines = crlf ? raw.map((line, index) => index < terminated ? line.slice(0, -1) : line) : raw;
    if (!(await writable(realPath))) return {ok: false, reason: `${shown} is read-only. /view reads it.`};
    if (!(await writable(dirname(realPath)))) return {ok: false, reason: `The folder holding ${shown} is not writable, so it cannot be saved safely. /view reads it.`};
    return {ok: true, file: {path, realPath, title: shown, mode: info.mode & 0o7777, gid: info.gid,
      identity: {dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, hash: hash(bytes)},
      lineEnding: crlf ? 'crlf' : 'lf', bom, finalNewline: finalNewline || text === '', lines: lines.length ? lines : ['']}};
  } catch (error) {
    return {ok: false, reason: failure(error, 'open', shown)};
  } finally { await handle.close().catch(() => undefined); }
}

/** The bytes a buffer's lines save as: the file's line ending, BOM and final newline kept. */
export function encodeLines(file: Pick<EditableFile, 'lineEnding' | 'bom' | 'finalNewline'>, lines: readonly string[]): Buffer {
  const eol = file.lineEnding === 'crlf' ? '\r\n' : '\n';
  const body = lines.join(eol) + (file.finalNewline && !(lines.length === 1 && lines[0] === '') ? eol : '');
  const text = Buffer.from(body, 'utf8');
  return file.bom ? Buffer.concat([BOM, text]) : text;
}

/** Whether the original is still the file that was opened; undefined when it is. */
async function changedOnDisk(file: EditableFile): Promise<SaveConflict | undefined> {
  if (!file.identity) {
    try { await lstat(file.realPath); return 'exists'; } catch (error) { return code(error) === 'ENOENT' ? undefined : 'exists'; }
  }
  try { if (await realpath(file.path) !== file.realPath) return 'replaced'; }
  catch (error) { return code(error) === 'ENOENT' ? 'deleted' : 'replaced'; }
  let info;
  try { info = await lstat(file.realPath); } catch (error) { return code(error) === 'ENOENT' ? 'deleted' : 'replaced'; }
  if (!info.isFile() || info.dev !== file.identity.dev || info.ino !== file.identity.ino) return 'replaced';
  if (info.size === file.identity.size && info.mtimeMs === file.identity.mtimeMs) return undefined;
  try { return hash(await readFile(file.realPath)) === file.identity.hash ? undefined : 'changed'; } catch { return 'changed'; }
}

const CONFLICTS: Record<SaveConflict, string> = {
  changed: 'changed on disk since you opened it',
  replaced: 'was replaced on disk since you opened it',
  deleted: 'was deleted since you opened it',
  exists: 'was created by something else since you opened it',
};

/**
 * Save `lines` over the file. Without `force`, a changed original is a conflict and nothing is written. With `force`
 * (the person chose Overwrite), the content check is skipped, but only a regular file (or nothing) is ever replaced.
 */
export async function saveFile(file: EditableFile, lines: readonly string[], options: {force?: boolean} = {}): Promise<SaveResult> {
  if (file.scratch) return {ok: false, reason: 'This document is not a file yet; use Save As to choose where it goes.'};
  if (!options.force) {
    const conflict = await changedOnDisk(file);
    if (conflict) return {ok: false, conflict, reason: `${file.title} ${CONFLICTS[conflict]}.`};
  } else {
    try { if (!(await lstat(file.realPath)).isFile()) return {ok: false, reason: `${file.title} is no longer a regular file; nothing was written.`}; }
    catch (error) { if (code(error) !== 'ENOENT') return {ok: false, reason: failure(error, 'save', file.title)}; }
  }
  const bytes = encodeLines(file, lines);
  const directory = dirname(file.realPath);
  const temp = join(directory, `.${basename(file.realPath)}.nmsh-${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), file.mode === undefined ? 0o666 : 0o600);
    await handle.writeFile(bytes);
    if (file.mode !== undefined) await handle.chmod(file.mode);
    if (file.gid !== undefined) await handle.chown(-1, file.gid).catch(() => undefined);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // The narrowest window: the original is checked again just before it is replaced.
    if (!options.force) {
      const conflict = await changedOnDisk(file);
      if (conflict) { await unlink(temp).catch(() => undefined); return {ok: false, conflict, reason: `${file.title} ${CONFLICTS[conflict]}.`}; }
    }
    if (!file.identity && !options.force) {
      // A new file is created only if nothing appeared at its path meanwhile: link fails rather than replace.
      try { await link(temp, file.realPath); }
      catch (error) {
        await unlink(temp).catch(() => undefined);
        if (code(error) === 'EEXIST') return {ok: false, conflict: 'exists', reason: `${file.title} ${CONFLICTS.exists}.`};
        throw error;
      }
      await unlink(temp).catch(() => undefined);
    } else await rename(temp, file.realPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    return {ok: false, reason: failure(error, 'save', file.title)};
  }
  // The directory entry itself is durable too, where the platform allows syncing a directory.
  try { const dir = await open(directory, constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); } } catch { /* best effort */ }
  try {
    const info = await lstat(file.realPath);
    return {ok: true, file: {...file, lines: [...lines], identity: {dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, hash: hash(bytes)}}};
  } catch (error) { return {ok: false, reason: failure(error, 'check the saved', file.title)}; }
}
