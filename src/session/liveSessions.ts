import {killSession} from './SocketSessionClient.js';
import {finalizeLiveSession} from './recovery.js';
import {defaultRuntimeDir, socketPathFor} from './runtimeDir.js';
import type {SessionInfo} from './SessionProtocol.js';
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
  // Same ownership boundary as launch recovery, which may be finalizing this
  // session concurrently now that the service no longer lists it.
  const outcome = await finalizeLiveSession({store: options.store ?? new TranscriptStore(), runtimeDir, sessionId: session.id,
    ...(session.journalId ? {journalId: session.journalId} : {}), cwd: session.cwd, waitMs: 10_000,
    note: () => 'Session killed from /resume; its shell has ended.'});
  if (outcome.kind === 'claimed-elsewhere') throw new Error('Another NMSh window is archiving this session.');
  return outcome.session;
}
