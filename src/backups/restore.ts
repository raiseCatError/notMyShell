import {dirname,join} from 'node:path';
import {Journal, type JournalEntry} from './journal.js';
import {digest, snapshot, unchanged, transact, type FileChange} from '../appearance/hostFiles.js';
import {changeDiff} from './diff.js';
export interface RestorePlan {entry: JournalEntry; changes: FileChange[]; edited: string[]; preview: string[]; guidance: string}
const prepared = new WeakSet<RestorePlan>();
export function planRestore(journal: Journal, id: string): RestorePlan {
  const entry = journal.read(id);
  const changes = entry.files.map((file,index) => ({before:snapshot(file.path,journal.options.home,true),after:journal.content(entry,index),afterMode:file.mode}));
  const edited = changes.filter((change,index)=>(change.before.content === undefined ? 'absent' : digest(change.before.content)) !== entry.files[index]!.afterHash || (entry.files[index]!.afterMode!==undefined && change.before.content!==undefined && change.before.mode!==entry.files[index]!.afterMode)).map(change=>change.before.path);
  const settings=join(dirname(journal.directory),'config.json');
  if(!changes.some(change=>change.before.path===settings)){const before=snapshot(settings,journal.options.home,true);changes.push({before,after:before.content,afterMode:before.mode});}
  const plan: RestorePlan = {entry,changes,edited,preview:[
    `${entry.time} · ${entry.source} · ${entry.label}`,
    ...entry.files.map(file=>`${file.path}: ${journal.status(file)}`),
    ...edited.map(path=>`WARNING: your later edits to ${path} will be lost.`),
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
  prepared.delete(plan); return undo;
}
/** Includes known journal paths and caller-discovered ownership paths; reading/planning alone writes nothing. */
export function manualSnapshot(journal: Journal, ownershipPaths: readonly string[]): JournalEntry {
  const paths = [...new Set([...journal.list().flatMap(entry=>entry.files.map(file=>file.path)),...ownershipPaths])];
  const changes = paths.map(path=>{const before=snapshot(path,journal.options.home);return {before,after:before.content};});
  const entry = journal.record(changes,'manual','Manual snapshot of NMSh-managed files'); journal.complete(entry); return entry;
}
