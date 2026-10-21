import {createHash, randomBytes} from 'node:crypto';
import {chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {MAX_EDIT_BYTES} from './fileEdit.js';
import type {EditorState} from './EditorPanel.js';
import type {Position} from './textBuffer.js';

/**
 * Private crash recovery for the native editor (#469). A buffer with unsaved changes is written, a moment after the
 * last edit, to a small draft in NMSh's own data directory; opening the file after the window or the machine died
 * offers it back. A draft is never applied silently and never touches the file: Restore puts it in the buffer as one
 * undoable, unsaved edit, and saving is still the editor's own checked, atomic save.
 *
 * - One draft per file and per window (named by a hash of the real path and the process id), so two windows editing the
 *   same file never overwrite each other's draft, and a draft of a process that is still running is never offered.
 * - Only dirty buffers are written; a buffer that is clean again (saved, or undone back) retires its draft.
 * - The directory is private (0700) and never a symlink; files are 0600, written beside and renamed into place.
 * - Bounded: one draft is at most MAX_DRAFT_BYTES, the directory keeps MAX_DRAFTS and drafts older than the retention
 *   go. Nothing leaves the machine and nothing is logged.
 */

export const MAX_DRAFT_BYTES = 2 * MAX_EDIT_BYTES;
export const MAX_DRAFTS = 50;
export const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFT_DEBOUNCE_MS = 1500;
/** A running process id older than this no longer vouches for its draft: ids are reused, and a window idle that long is not typing. */
export const DRAFT_LIVENESS_MS = 24 * 60 * 60 * 1000;
const STALE_TEMP_MS = 60 * 60 * 1000;

export interface Draft {
  version: 1;
  /** The path as given, and the real path that identifies the file. */
  path: string;
  realPath: string;
  /** Hash of the file's bytes when the draft's buffer was opened; undefined for a file that did not exist yet. */
  baseHash?: string;
  lines: string[];
  caret: Position;
  anchor?: Position;
  top: number;
  savedAt: number;
  pid: number;
}

/** A draft found on disk: where it is, and whether the person chose to keep it. */
export interface DraftOffer {draft: Draft; kept: boolean; path: string}

export type WriteResult = {ok: true} | {ok: false; reason: string};
export interface DraftStoreOptions {maxFiles?: number; maxAgeMs?: number; maxBytes?: number; now?: () => number}

const fileKey = (realPath: string) => createHash('sha256').update(realPath).digest('hex').slice(0, 16);
const position = (value: unknown): value is Position => Boolean(value) && typeof value === 'object'
  && Number.isSafeInteger((value as Position).line) && (value as Position).line >= 0 && Number.isSafeInteger((value as Position).column) && (value as Position).column >= 0;

/** A pid that is a running process (including one this user may not signal). */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function parse(text: string): Draft | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  const draft = value as Draft;
  if (!draft || typeof draft !== 'object' || draft.version !== 1 || typeof draft.path !== 'string' || typeof draft.realPath !== 'string'
    || !Array.isArray(draft.lines) || !draft.lines.every(line => typeof line === 'string') || !position(draft.caret)
    || (draft.anchor !== undefined && !position(draft.anchor)) || !Number.isSafeInteger(draft.top) || draft.top < 0
    || !Number.isFinite(draft.savedAt) || !Number.isSafeInteger(draft.pid) || draft.pid <= 0
    || (draft.baseHash !== undefined && typeof draft.baseHash !== 'string')) return undefined;
  return draft;
}

export class DraftStore {
  private readonly maxFiles: number;
  private readonly maxAgeMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  constructor(readonly directory: string, options: DraftStoreOptions = {}) {
    this.maxFiles = options.maxFiles ?? MAX_DRAFTS;
    this.maxAgeMs = options.maxAgeMs ?? DRAFT_RETENTION_MS;
    this.maxBytes = options.maxBytes ?? MAX_DRAFT_BYTES;
    this.now = options.now ?? Date.now;
  }

  /** The directory exists, is a real directory (never a link) owned by this user, and is private. */
  private ensure(): string | undefined {
    try { mkdirSync(this.directory, {recursive: true, mode: 0o700}); } catch { /* checked below */ }
    try {
      const info = lstatSync(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return 'the recovery folder is not a plain directory';
      const uid = process.getuid?.();
      if (uid !== undefined && info.uid !== uid) return 'the recovery folder belongs to another user';
      if (info.mode & 0o077) chmodSync(this.directory, 0o700);
      return undefined;
    } catch (error) { return `the recovery folder is unavailable (${(error as NodeJS.ErrnoException).code ?? 'error'})`; }
  }

  private nameOf(realPath: string, pid: number, kept = false): string { return `${fileKey(realPath)}-${pid}${kept ? '.kept' : ''}.json`; }

  write(draft: Draft): WriteResult {
    const problem = this.ensure();
    if (problem) return {ok: false, reason: problem};
    const bytes = Buffer.from(JSON.stringify(draft), 'utf8');
    if (bytes.length > this.maxBytes) return {ok: false, reason: 'the text is too large to keep a draft of'};
    const target = join(this.directory, this.nameOf(draft.realPath, draft.pid));
    const temp = join(this.directory, `.${randomBytes(6).toString('hex')}.tmp`);
    let handle: number | undefined;
    try {
      handle = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      writeSync(handle, bytes);
      fsyncSync(handle);
      closeSync(handle); handle = undefined;
      renameSync(temp, target);
      return {ok: true};
    } catch (error) {
      if (handle !== undefined) { try { closeSync(handle); } catch { /* already closed */ } }
      try { unlinkSync(temp); } catch { /* not created */ }
      const code = (error as NodeJS.ErrnoException).code;
      return {ok: false, reason: code === 'ENOSPC' ? 'the disk is full' : code === 'EACCES' || code === 'EPERM' ? 'permission denied' : `could not write (${code ?? 'error'})`};
    }
  }

  private read(name: string): Draft | undefined {
    const path = join(this.directory, name);
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.size > this.maxBytes + 4096) return undefined;
      return parse(readFileSync(path, 'utf8'));
    } catch { return undefined; }
  }

  private names(): string[] {
    try { return readdirSync(this.directory).filter(name => name.endsWith('.json') && !name.startsWith('.')); } catch { return []; }
  }

  /** This process's own draft of the file. */
  own(realPath: string): Draft | undefined {
    const name = this.nameOf(realPath, process.pid);
    const draft = this.read(name);
    return draft?.realPath === realPath ? draft : undefined;
  }

  /** Drafts of `realPath` to offer: kept ones, and those of processes that are no longer running. Newest first. */
  recoverable(realPath: string): DraftOffer[] {
    const prefix = `${fileKey(realPath)}-`;
    const found: DraftOffer[] = [];
    for (const name of this.names()) {
      if (!name.startsWith(prefix)) continue;
      const draft = this.read(name);
      if (!draft || draft.realPath !== realPath) continue;
      const kept = name.endsWith('.kept.json');
      if (!kept && (draft.pid === process.pid || (alive(draft.pid) && this.now() - draft.savedAt < DRAFT_LIVENESS_MS))) continue;
      found.push({draft, kept, path: join(this.directory, name)});
    }
    return found.sort((a, b) => b.draft.savedAt - a.draft.savedAt);
  }

  retireOwn(realPath: string): void { try { unlinkSync(join(this.directory, this.nameOf(realPath, process.pid))); } catch { /* none */ } }
  retire(offer: DraftOffer): void { try { unlinkSync(offer.path); } catch { /* already gone */ } }

  /** "Keep for later": the draft moves to a name of its own, so new edits can never replace it. */
  keep(offer: DraftOffer): void {
    if (offer.kept) return;
    try { renameSync(offer.path, join(this.directory, this.nameOf(offer.draft.realPath, offer.draft.pid, true))); } catch { /* already gone */ }
  }

  /** Remove what is too old or beyond the bound, oldest first; drafts of running processes and unreadable files are the exceptions. */
  prune(): void {
    const at = this.now();
    // A write that was cut short leaves a temporary beside the drafts; one no write could still own is removed.
    try {
      for (const name of readdirSync(this.directory)) {
        if (!name.startsWith('.') || !name.endsWith('.tmp')) continue;
        try { if (Date.now() - lstatSync(join(this.directory, name)).mtimeMs > STALE_TEMP_MS) unlinkSync(join(this.directory, name)); } catch { /* gone */ }
      }
    } catch { /* no directory yet */ }
    const live: Array<{name: string; savedAt: number}> = [];
    for (const name of this.names()) {
      const draft = this.read(name);
      if (!draft) { try { unlinkSync(join(this.directory, name)); } catch { /* gone */ } continue; }
      if (!name.endsWith('.kept.json') && draft.pid !== process.pid && alive(draft.pid) && at - draft.savedAt < DRAFT_LIVENESS_MS) continue;
      if (at - draft.savedAt > this.maxAgeMs) { try { unlinkSync(join(this.directory, name)); } catch { /* gone */ } continue; }
      live.push({name, savedAt: draft.savedAt});
    }
    live.sort((a, b) => a.savedAt - b.savedAt);
    for (const old of live.slice(0, Math.max(0, live.length - this.maxFiles))) { try { unlinkSync(join(this.directory, old.name)); } catch { /* gone */ } }
  }
}

/** What differs between the file's lines and a draft's, in one line. */
export function describeDifference(disk: readonly string[], draft: readonly string[]): string {
  let start = 0;
  while (start < disk.length && start < draft.length && disk[start] === draft[start]) start += 1;
  if (start === disk.length && start === draft.length) return 'The draft is identical to the file.';
  let endDisk = disk.length, endDraft = draft.length;
  while (endDisk > start && endDraft > start && disk[endDisk - 1] === draft[endDraft - 1]) { endDisk -= 1; endDraft -= 1; }
  const removed = endDisk - start, added = endDraft - start;
  const shown = (line: string | undefined) => `“${(line ?? '').replace(/\s+/gu, ' ').slice(0, 30)}”`;
  const plural = (count: number) => `${count} line${count === 1 ? '' : 's'}`;
  if (!removed) return `Draft adds ${plural(added)} at line ${start + 1}: ${shown(draft[start])}`;
  if (!added) return `Draft removes ${plural(removed)} at line ${start + 1}: ${shown(disk[start])}`;
  return `Draft differs at line ${start + 1}: ${plural(removed)} become ${added}: ${shown(disk[start])} → ${shown(draft[start])}`;
}

export interface DraftKeeperOptions {debounceMs?: number; onError?: (reason: string) => void; now?: () => number}

interface Tracked {timer?: NodeJS.Timeout; wrote: boolean; written?: string; writtenBase?: string; realPath?: string}

/**
 * Keeps one editor's draft current. `note` is called after anything that may have changed a buffer; it never reads or
 * writes the file being edited and never waits: a dirty buffer is written once the debounce passes (`flush` writes at
 * once, for a window that is closing), a clean one retires its draft. A buffer showing an undecided recovery offer is
 * left alone. A failing store is reported once, not on every keystroke.
 */
export class DraftKeeper {
  private readonly tracked = new Map<EditorState, Tracked>();
  private readonly debounceMs: number;
  private reported = false;
  constructor(readonly store: DraftStore, private readonly options: DraftKeeperOptions = {}) {
    this.debounceMs = options.debounceMs ?? DRAFT_DEBOUNCE_MS;
  }

  private entry(editor: EditorState): Tracked {
    let entry = this.tracked.get(editor);
    if (!entry) { entry = {wrote: false}; this.tracked.set(editor, entry); }
    return entry;
  }

  note(editor: EditorState): void {
    if (editor.dialog?.kind === 'recover') return;
    const entry = this.entry(editor);
    if (editor.buffer.dirty) {
      if (entry.timer || (entry.written === editor.buffer.text && entry.writtenBase === editor.file.identity?.hash)) return;
      entry.timer = setTimeout(() => { entry.timer = undefined; this.write(editor, entry); }, this.debounceMs);
      entry.timer.unref?.();
      return;
    }
    this.clear(editor, entry);
  }

  /** Write every pending draft now (the window is closing). */
  flush(): void {
    for (const [editor, entry] of this.tracked) {
      if (!entry.timer) continue;
      clearTimeout(entry.timer); entry.timer = undefined;
      this.write(editor, entry);
    }
  }

  /** The buffer's text was restored from `offer`: its own draft is written first, then the offered one is retired. */
  restored(editor: EditorState, offer: DraftOffer): void {
    const entry = this.entry(editor);
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    if (this.write(editor, entry)) this.store.retire(offer);
  }

  kept(_editor: EditorState, offer: DraftOffer): void { this.store.keep(offer); }

  /** The person discarded the changes, or the editor closed on a clean buffer: this window's draft goes. */
  discard(editor: EditorState): void {
    const entry = this.tracked.get(editor);
    if (entry) this.clear(editor, entry);
    this.tracked.delete(editor);
  }

  /** Stop timers; drafts stay (an exit with unsaved text keeps them). */
  dispose(): void {
    this.flush();
    for (const entry of this.tracked.values()) if (entry.timer) clearTimeout(entry.timer);
    this.tracked.clear();
  }

  private clear(editor: EditorState, entry: Tracked): void {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    if (entry.wrote) this.store.retireOwn(entry.realPath ?? editor.file.realPath);
    entry.wrote = false; entry.written = undefined; entry.writtenBase = undefined; entry.realPath = undefined;
  }

  private write(editor: EditorState, entry: Tracked): boolean {
    const buffer = editor.buffer;
    const text = buffer.text;
    const result = this.store.write({version: 1, path: editor.file.path, realPath: editor.file.realPath, ...(editor.file.identity ? {baseHash: editor.file.identity.hash} : {}),
      lines: [...buffer.lines], caret: {...buffer.caret}, ...(buffer.anchor ? {anchor: {...buffer.anchor}} : {}), top: editor.top, savedAt: (this.options.now ?? Date.now)(), pid: process.pid});
    if (result.ok) { entry.wrote = true; entry.written = text; entry.writtenBase = editor.file.identity?.hash; entry.realPath = editor.file.realPath; this.reported = false; this.store.prune(); return true; }
    if (!this.reported) { this.reported = true; this.options.onError?.(result.reason); }
    return false;
  }
}
