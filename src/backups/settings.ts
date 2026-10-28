import {dirname, join, relative, isAbsolute} from 'node:path';
import {Journal} from './journal.js';
import {snapshot} from '../appearance/hostFiles.js';

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
  if (journal.list().some(entry => entry.source === 'settings' && entry.time.slice(0,10) === day)) {
    checkedToday.set(path,day); return () => {};
  }
  const entry = journal.record([{before:snapshot(path,home), after, afterMode:0o600}], 'settings', 'Daily NMSh settings checkpoint');
  return () => { journal.complete(entry); checkedToday.set(path,day); };
}
