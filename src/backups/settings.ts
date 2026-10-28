import {dirname, join, relative, isAbsolute} from 'node:path';
import {Journal} from './journal.js';
import {snapshot} from '../appearance/hostFiles.js';

const failures = new Map<string,string>();
const reported = new Set<string>();
/** Deferred diagnostics keep backup errors out of the terminal transcript. Shown once in /changes. */
export function takeSettingsCheckpointFailure(directory: string): string | undefined {
  const message=failures.get(directory);failures.delete(directory);return message;
}
function failed(directory:string,error:unknown):void {
  if(reported.has(directory))return;
  reported.add(directory);
  failures.set(directory,`Settings backup unavailable; checkpoint skipped. ${error instanceof Error?error.message:String(error)}`);
}
const checkedToday = new Map<string, string>();
/** Only the first settings save per UTC day checkpoints; this is not a per-keypress journal. */
export function dailySettingsCheckpoint(path: string, after: string, now = new Date(), env:NodeJS.ProcessEnv=process.env): () => void {
  const day = now.toISOString().slice(0,10);
  if (checkedToday.get(path) === day) return () => {};
  // Own state can live under an explicitly selected XDG directory. External adapters always require HOME.
  const candidate=env.HOME;
  const inside=candidate?relative(candidate,path):'..';
  const home = candidate && inside!=='..' && !inside.startsWith('../') && !isAbsolute(inside) ? candidate : dirname(path);
  const journal = new Journal({home, directory:join(dirname(path),'backups')});
  try {
    if (journal.list({strict:true}).some(entry => entry.source === 'settings' && entry.outcome === 'applied' && entry.time.slice(0,10) === day)) {
      checkedToday.set(path,day); return () => {};
    }
    const entry = journal.record([{before:snapshot(path,home), after, afterMode:0o600}], 'settings', 'Daily NMSh settings checkpoint');
    return () => {
      try { journal.complete(entry); checkedToday.set(path,day); }
      catch(error) { failed(journal.directory,error); }
    };
  } catch(error) { failed(journal.directory,error); return () => {}; }
}
