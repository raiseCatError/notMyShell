import {killSession} from './SocketSessionClient.js';
import {finalizeLiveSession} from './recovery.js';
import {defaultRuntimeDir, socketPathFor} from './runtimeDir.js';
import type {SessionInfo} from './SessionProtocol.js';
import type {LiveSessionMultiple, LiveSessionStartup} from '../prompt/configuration.js';
import {TranscriptStore, type TranscriptSession} from '../sessions/TranscriptStore.js';

export type LaunchPlan =
  | {kind: 'new'}
  /** One detached session and the startup setting is Ask. */
  | {kind: 'ask'; session: SessionInfo}
  /** Resume these, newest first: the first in this window, the rest in new windows. */
  | {kind: 'attach'; sessions: SessionInfo[]}
  | {kind: 'pick'; sessions: SessionInfo[]};

export interface StartupPolicy {
  startup: LiveSessionStartup;
  multiple: LiveSessionMultiple;
}

/**
 * What a plain `nmsh` launch does. Only detached sessions are candidates: one
 * attached elsewhere is never taken over. Never skips restoring at startup and
 * ends nothing; every session stays available through /resume.
 */
export function planLaunch(sessions: readonly SessionInfo[], policy: StartupPolicy = {startup: 'ask', multiple: 'ask'}): LaunchPlan {
  const detached = sessions.filter(session => session.state === 'detached').sort((a, b) => b.createdAt - a.createdAt);
  if (detached.length === 0 || policy.startup === 'never') return {kind: 'new'};
  if (detached.length === 1) return policy.startup === 'always' ? {kind: 'attach', sessions: detached} : {kind: 'ask', session: detached[0]!};
  return policy.multiple === 'open-all' ? {kind: 'attach', sessions: detached} : {kind: 'pick', sessions: detached};
}

export interface KillOptions {
  runtimeDir?: string;
  store?: TranscriptStore;
  env?: NodeJS.ProcessEnv;
  /** Where the kill was requested, for the archive note. */
  origin?: string;
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
    note: () => `Session killed from ${options.origin ?? '/resume'}; its shell has ended.`});
  if (outcome.kind === 'claimed-elsewhere') throw new Error('Another NMSh window is archiving this session.');
  return outcome.session;
}
