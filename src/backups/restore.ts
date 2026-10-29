import {dirname,join} from 'node:path';
import {Journal, type JournalEntry} from './journal.js';
import {digest, snapshot, unchanged, transact, type FileChange, type FileSnapshot} from '../appearance/hostFiles.js';
import {changeDiff} from './diff.js';
import {describeState} from './describe.js';
export interface RestorePlan {entry: JournalEntry; changes: FileChange[]; edited: string[]; preview: string[]; guidance: string}
const prepared = new WeakSet<RestorePlan>();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A restore never writes through a damaged path: it names the entry, the path and the reason, and nothing changes. */
function checkedSnapshot(entry: JournalEntry, path: string, home: string): FileSnapshot {
  try { return snapshot(path, home, true); }
  catch (error) {
    throw new Error(`Cannot restore "${entry.label}" (${entry.id}): ${path} is not safe to change. ${message(error)} Nothing was changed. `
      + `Repair or move that path yourself (NMSh never writes through it), then review this restore again; other backups are unaffected.`);
  }
}

type RawRecord = Record<string, unknown> & {artifactPath?: unknown; hook?: {configPath?: unknown}};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function rawLedger(text: string | undefined): {root: Record<string, unknown>; entries: Record<string, RawRecord>} {
  let parsed: unknown;
  try { parsed = text === undefined ? {} : JSON.parse(text); } catch { parsed = {}; }
  const root = isRecord(parsed) ? parsed : {};
  const entries = isRecord(root.entries) ? root.entries as Record<string, RawRecord> : {};
  return {root, entries};
}

/**
 * The Theme Bridge ownership record covers several tools. Restoring an older copy wholesale would forget files NMSh wrote later
 * for tools this backup never touched (their files stay on disk, but NMSh could no longer prove it owns them). So the record is
 * reconciled per tool: a tool whose managed file or include this backup restores takes the backup's record for that part; every
 * other tool keeps NMSh's current record, which still matches its untouched files.
 */
function reconcileBridgeLedger(journal: Journal, entry: JournalEntry, changes: FileChange[]): string[] {
  const path = join(dirname(journal.directory), 'theme-bridge', 'ledger.json');
  const change = changes.find(item => item.before.path === path);
  if (!change) return [];
  const restoredPaths = new Set(entry.files.map(file => file.path));
  const backup = rawLedger(change.after), current = rawLedger(change.before.content);
  const merged: Record<string, RawRecord> = {};
  const notes: string[] = [];
  const touches = (record: RawRecord | undefined, field: 'artifact' | 'hook') => {
    const value = field === 'artifact' ? record?.artifactPath : isRecord(record?.hook) ? record!.hook!.configPath : undefined;
    return typeof value === 'string' && restoredPaths.has(value);
  };
  for (const target of [...new Set([...Object.keys(current.entries), ...Object.keys(backup.entries)])].sort()) {
    const old = backup.entries[target], now = current.entries[target];
    const artifact = touches(old, 'artifact') || touches(now, 'artifact');
    const hook = touches(old, 'hook') || touches(now, 'hook');
    let next: RawRecord | undefined;
    if (artifact && hook) next = old;
    else if (!artifact && !hook) next = now;
    else if (artifact) {
      // The backup's file record, with the include NMSh records now (this backup does not restore the include's file).
      const keptHook = now?.hook;
      if (old) { next = {...old}; if (keptHook) next.hook = keptHook; else delete next.hook; }
      else if (keptHook) next = {...now!, sha256: digest(''), hook: keptHook};
    } else {
      const restoredHook = old?.hook;
      if (now) { next = {...now}; if (restoredHook) next.hook = restoredHook; else delete next.hook; }
      else if (restoredHook) next = old;
    }
    if (next) merged[target] = next;
    if (!artifact && !hook && JSON.stringify(old) !== JSON.stringify(now)) notes.push(`Theme Bridge: keeps NMSh's current ownership record for ${target}; this backup does not restore its files.`);
  }
  const after = `${JSON.stringify({...current.root, version: 1, entries: merged}, null, 2)}\n`;
  if (after === change.after) return [];
  change.after = after;
  return notes.length ? notes : ['Theme Bridge: the ownership record is reconciled with files this backup does not restore.'];
}

export function planRestore(journal: Journal, id: string): RestorePlan {
  const entry = journal.read(id);
  const home = journal.options.home;
  const changes: FileChange[] = entry.files.map((file,index) => ({before:checkedSnapshot(entry,file.path,home),after:journal.content(entry,index),afterMode:file.mode}));
  // Only a file this restore would actually change can lose later edits: one already holding its backed-up bytes is not edited.
  const edited = changes.filter((change,index)=>{
    const file=entry.files[index]!;const now=change.before.content === undefined ? 'absent' : digest(change.before.content);
    if (change.after === change.before.content && (change.before.content === undefined || change.before.mode === file.mode)) return false;
    return now !== file.afterHash || (file.afterMode!==undefined && change.before.content!==undefined && change.before.mode!==file.afterMode);
  }).map(change=>change.before.path);
  const settings=join(dirname(journal.directory),'config.json');
  if(!changes.some(change=>change.before.path===settings)){const before=checkedSnapshot(entry,settings,home);changes.push({before,after:before.content,afterMode:before.mode});}
  const reconciled = reconcileBridgeLedger(journal, entry, changes);
  const ledger = join(dirname(journal.directory), 'theme-bridge', 'ledger.json');
  // The reconciled ownership record is NMSh's own bookkeeping, not a user edit that would be lost.
  const warnings = reconciled.length ? edited.filter(path => path !== ledger) : edited;
  const state = journal.transactionState(entry);
  const plan: RestorePlan = {entry,changes,edited:warnings,preview:[
    `${entry.time} · ${entry.source} · ${entry.label}`,
    ...(state.state === 'applied' ? [] : [`This change is ${describeState(state.state)}. Restoring returns its files to their backed-up state (a rollback).`]),
    ...entry.files.map(file=>{const seen=journal.inspect(file);return `${file.path}: ${seen.status}${seen.reason?` (${seen.reason})`:''}`;}),
    ...warnings.map(path=>`WARNING: your later edits to ${path} will be lost.`),
    ...reconciled,
    ...changes.flatMap(change=>changeDiff(change).lines)],
    guidance:'Restore these exact files. Current contents are backed up first, so this restore can itself be undone. Terminal configuration may need a reload.'};
  prepared.add(plan); return plan;
}
export function restore(journal: Journal, plan: RestorePlan, confirmation: {reviewed: boolean; overwrite: boolean}): JournalEntry {
  if (!prepared.has(plan) || !confirmation.reviewed) throw new Error('Review this restore before confirming.');
  if (plan.edited.length && !confirmation.overwrite) throw new Error('Confirm that your later edits will be lost.');
  for (const change of plan.changes) unchanged(change.before,journal.options.home,true);
  const undo = transact(plan.changes,[],journal.options.home,{source:'restore',label:`Restore ${plan.entry.label}`,directory:journal.directory});
  if (!undo) throw new Error('Restore checkpoint was not created.');
  // Rolling back an unfinished write settles it: history then shows it as reverted, naming the undo checkpoint.
  const current = journal.read(plan.entry.id);
  if (current.outcome === 'prepared' && !current.resolution) {
    try { journal.resolve(current, {state: 'reverted', detail: `Rolled back by restore ${undo.id}.`}); } catch { /* the restore itself succeeded and is recorded */ }
  }
  prepared.delete(plan); return undo;
}
/** Includes known journal paths and caller-discovered ownership paths; reading/planning alone writes nothing. Unsafe paths are skipped and named. */
export function manualSnapshot(journal: Journal, ownershipPaths: readonly string[], skipped: string[] = []): JournalEntry {
  const paths = [...new Set([...journal.list().flatMap(entry=>entry.files.map(file=>file.path)),...ownershipPaths])];
  const changes: FileChange[] = [];
  for (const path of paths) {
    try { const before=snapshot(path,journal.options.home); changes.push({before,after:before.content}); }
    catch (error) { skipped.push(`${path}: ${message(error)}`); }
  }
  if (!changes.length) throw new Error(`No managed file can be read safely; nothing was saved. ${skipped.join(' ')}`);
  const entry = journal.record(changes,'manual','Manual snapshot of NMSh-managed files'); journal.complete(entry); return entry;
}
