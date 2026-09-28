import {readdirSync, renameSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {connect} from 'node:net';
import {listSessions} from './SocketSessionClient.js';
import {readSpool} from './StreamBacklog.js';
import {otherServiceSockets, socketPathFor} from './runtimeDir.js';
import {archiveLiveSession} from '../sessions/archiveLive.js';
import type {TranscriptStore} from '../sessions/TranscriptStore.js';

export const SERVICE_STOPPED_NOTE = 'This live session ended without its shell being seen to exit: the NMSh session service stopped '
  + 'or the system restarted. The shell and anything running in it could not be recovered.';

function reachable(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = connect(path);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
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
    // Claim the spool first so two launches never archive one session twice.
    const spoolPath = join(spoolDir, `${sessionId}.jsonl`);
    const claimed = `${spoolPath}.${process.pid}.recovering`;
    let hasSpool = false;
    try { renameSync(spoolPath, claimed); hasSpool = true; } catch {
      if (!linked.has(sessionId)) continue; // another launch took it
    }
    const spool = hasSpool ? readSpool(claimed) : {events: [], ackedSeq: 0, truncatedBytes: 0};
    const note = spool.exit
      ? `The shell exited while no NMSh window was attached (exit code ${spool.exit.exitCode}).`
      : SERVICE_STOPPED_NOTE;
    try {
      const session = await archiveLiveSession({store, sessionId, spool, note, cwd: '/',
        ...(linked.get(sessionId) ?? spool.journalId ? {journalId: linked.get(sessionId) ?? spool.journalId} : {})});
      archived.push(session.id);
      if (hasSpool) unlinkSync(claimed);
    } catch {
      // Leave the claimed spool for a later attempt rather than lose it.
      if (hasSpool) try { renameSync(claimed, spoolPath); } catch { /* keep claimed copy */ }
    }
  }
  return {archived};
}
