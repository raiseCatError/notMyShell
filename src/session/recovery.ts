import {existsSync, readdirSync, renameSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {connect} from 'node:net';
import {listSessions} from './SocketSessionClient.js';
import {readSpool, type SpoolContents} from './StreamBacklog.js';
import {otherServiceSockets, socketPathFor, spoolPathFor} from './runtimeDir.js';
import {archiveLiveSession} from '../sessions/archiveLive.js';
import {TranscriptBusyError, type TranscriptSession, type TranscriptStore} from '../sessions/TranscriptStore.js';

export const SERVICE_STOPPED_NOTE = 'This live session ended without its shell being seen to exit: the NMSh session service stopped '
  + 'or the system restarted. The shell and anything running in it could not be recovered.';

function reachable(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = connect(path);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

const CLAIM = /^([\w-]+)\.jsonl\.(\d+)\.recovering$/u;

/**
 * A launch that crashed while archiving leaves its claimed spool renamed to
 * `<id>.jsonl.<pid>.recovering`. Once that pid is gone, put it back so the
 * session is archived by a later launch instead of being lost.
 */
function restoreAbandonedClaims(spoolDir: string): void {
  let names: string[];
  try { names = readdirSync(spoolDir); } catch { return; }
  for (const name of names) {
    const match = CLAIM.exec(name);
    if (!match || processAlive(Number(match[2]))) continue;
    const original = join(spoolDir, `${match[1]}.jsonl`);
    if (!existsSync(original)) try { renameSync(join(spoolDir, name), original); } catch { /* raced another launch */ }
  }
}

export type FinalizeOutcome =
  /** Archived now by this call. */
  | {kind: 'archived'; session: TranscriptSession}
  /** Its journal was already ended by another writer; any leftover spool was stale and is gone. */
  | {kind: 'already-finalized'; session: TranscriptSession}
  /** Another process claimed the spool, or holds the journal: that process archives it. */
  | {kind: 'claimed-elsewhere'};

export interface FinalizeOptions {
  store: TranscriptStore;
  runtimeDir: string;
  sessionId: string;
  /** The journal linked to the session, when known. Otherwise the spool's own journal link is used. */
  journalId?: string;
  note: (spool: SpoolContents) => string;
  cwd: string;
  /** How long to wait for another writer holding the journal. */
  waitMs?: number;
}

/**
 * The single ownership boundary for turning an ended live session into an
 * archive. Under the journal's lock: claim the spool by rename, skip a journal
 * that is already ended (never replay a spool over a finalized transcript),
 * archive, then drop the claimed spool. If archiving fails the claimed spool is
 * put back, so nothing durable is lost.
 */
export async function finalizeLiveSession(options: FinalizeOptions): Promise<FinalizeOutcome> {
  const {store, sessionId} = options;
  const spoolPath = spoolPathFor(options.runtimeDir, sessionId);
  const spoolExisted = existsSync(spoolPath);
  const journalId = options.journalId || (spoolExisted ? readSpool(spoolPath).journalId : undefined) || undefined;

  const underLock = async (): Promise<FinalizeOutcome> => {
    const claimed = `${spoolPath}.${process.pid}.recovering`;
    let spool: SpoolContents = {events: [], ackedSeq: 0, truncatedBytes: 0};
    let hasSpool = false;
    try {
      renameSync(spoolPath, claimed);
      hasSpool = true;
      spool = readSpool(claimed);
    } catch {
      // The spool was there a moment ago: another launch owns it now, so do
      // not archive from an empty spool. A spool-less session with only a
      // journal carries on.
      if (spoolExisted || !journalId) return {kind: 'claimed-elsewhere'};
    }
    const release = (keep: boolean) => {
      if (!hasSpool) return;
      try { if (keep) renameSync(claimed, spoolPath); else unlinkSync(claimed); } catch { /* keep claimed copy */ }
    };
    if (journalId) {
      let existing: TranscriptSession | undefined;
      try { existing = await store.load(journalId); } catch { /* unreadable or missing: archive from the spool */ }
      if (existing?.endedAt) {
        release(false);
        return {kind: 'already-finalized', session: existing};
      }
    }
    try {
      const session = await archiveLiveSession({store, sessionId, spool, note: options.note(spool), cwd: options.cwd,
        ...(journalId ? {journalId} : {})});
      release(false);
      return {kind: 'archived', session};
    } catch (error) {
      release(true);
      throw error;
    }
  };

  if (!journalId) return underLock();
  try {
    return await store.withLock(journalId, underLock, options.waitMs ?? 0);
  } catch (error) {
    if (error instanceof TranscriptBusyError) return {kind: 'claimed-elsewhere'};
    throw error;
  }
}

export interface RecoveryResult {
  archived: string[];
  /** Why recovery did nothing, when it could not tell live from dead. */
  skipped?: string;
}

/**
 * Archive live sessions that ended with no frontend to see it: the shell
 * exited while detached, the service died, or the machine restarted. A
 * session counts as ended only if the service we speak to is reachable and
 * does not list it (or no service is running at all); while a service of
 * another protocol version is reachable we cannot tell, so nothing is
 * touched. Journals are read before the service is asked, so a session
 * created in between is live by the time we check.
 */
export async function recoverEndedSessions(runtimeDir: string, store: TranscriptStore): Promise<RecoveryResult> {
  for (const other of otherServiceSockets(runtimeDir)) {
    if (await reachable(other)) return {archived: [], skipped: 'another NMSh session service version is running'};
  }
  const linked = new Map<string, string>();
  try {
    for (const summary of await store.listSummaries()) {
      if (summary.liveSessionId && !summary.endedAt) linked.set(summary.liveSessionId, summary.id);
    }
  } catch { return {archived: [], skipped: 'transcript archives are unreadable'}; }
  const spoolDir = join(runtimeDir, 'spool');
  restoreAbandonedClaims(spoolDir);
  let spooled: string[] = [];
  try { spooled = readdirSync(spoolDir).filter(name => name.endsWith('.jsonl')).map(name => name.slice(0, -6)); } catch { /* none */ }

  let live: Set<string>;
  try {
    live = new Set((await listSessions(socketPathFor(runtimeDir))).map(session => session.id));
  } catch (error) {
    const code = (error as {code?: string}).code;
    if (code !== 'ENOENT' && code !== 'ECONNREFUSED') return {archived: [], skipped: 'the session service did not answer'};
    live = new Set();
  }

  const archived: string[] = [];
  for (const sessionId of new Set([...linked.keys(), ...spooled])) {
    if (live.has(sessionId) || !/^[\w-]+$/u.test(sessionId)) continue;
    try {
      const outcome = await finalizeLiveSession({store, runtimeDir, sessionId, journalId: linked.get(sessionId), cwd: '/',
        note: spool => spool.exit
          ? `The shell exited while no NMSh window was attached (exit code ${spool.exit.exitCode}).`
          : SERVICE_STOPPED_NOTE});
      if (outcome.kind === 'archived') archived.push(outcome.session.id);
    } catch { /* the claimed spool was put back for a later attempt */ }
  }
  return {archived};
}
