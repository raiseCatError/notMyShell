import {unlinkSync} from 'node:fs';
import {killSession} from './SocketSessionClient.js';
import {readSpool} from './StreamBacklog.js';
import {defaultRuntimeDir, socketPathFor, spoolPathFor} from './runtimeDir.js';
import type {SessionInfo} from './SessionProtocol.js';
import {archiveLiveSession} from '../sessions/archiveLive.js';
import {TranscriptStore, type TranscriptSession} from '../sessions/TranscriptStore.js';

export type LaunchPlan =
  | {kind: 'new'}
  | {kind: 'attach'; session: SessionInfo}
  | {kind: 'pick'; sessions: SessionInfo[]};

/**
 * What a plain `nmsh` launch does. Only detached sessions are candidates:
 * one attached elsewhere is never taken over, so it leads to a new session.
 */
export function planLaunch(sessions: readonly SessionInfo[]): LaunchPlan {
  const detached = sessions.filter(session => session.state === 'detached');
  if (detached.length === 0) return {kind: 'new'};
  if (detached.length === 1) return {kind: 'attach', session: detached[0]!};
  return {kind: 'pick', sessions: [...detached].sort((a, b) => b.createdAt - a.createdAt)};
}

export interface KillOptions {
  runtimeDir?: string;
  store?: TranscriptStore;
  env?: NodeJS.ProcessEnv;
}

/**
 * Kill Session: end the shell, then archive the session from its last
 * journal plus whatever stream events that journal never saw.
 */
export async function killAndArchive(session: SessionInfo, options: KillOptions = {}): Promise<TranscriptSession> {
  const runtimeDir = options.runtimeDir ?? defaultRuntimeDir(options.env ?? process.env);
  await killSession(socketPathFor(runtimeDir), session.id);
  const spoolPath = spoolPathFor(runtimeDir, session.id);
  const archived = await archiveLiveSession({store: options.store ?? new TranscriptStore(), journalId: session.journalId,
    sessionId: session.id, spool: readSpool(spoolPath), cwd: session.cwd, note: 'Session killed from /resume; its shell has ended.'});
  try { unlinkSync(spoolPath); } catch { /* nothing was spooled */ }
  return archived;
}
