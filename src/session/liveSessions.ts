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
  return archiveKilled(session, {...options, runtimeDir});
}

/**
 * Archive a session whose shell this process just ended. Same ownership boundary as launch recovery, which may be
 * finalizing it concurrently now that the service no longer lists it. On failure the spool is kept for a later launch.
 */
export async function archiveKilled(session: SessionInfo, options: KillOptions = {}): Promise<TranscriptSession> {
  const runtimeDir = options.runtimeDir ?? defaultRuntimeDir(options.env ?? process.env);
  const outcome = await finalizeLiveSession({store: options.store ?? new TranscriptStore(), runtimeDir, sessionId: session.id,
    ...(session.journalId ? {journalId: session.journalId} : {}), cwd: session.cwd, waitMs: 10_000,
    note: () => `Session killed from ${options.origin ?? '/resume'}; its shell has ended.`});
  if (outcome.kind === 'claimed-elsewhere') throw new Error('Another NMSh window is archiving this session.');
  return outcome.session;
}

/**
 * What ending one listed detached session did, from the service's own answers only:
 * - killed: this call ended its shell and the transcript was archived;
 * - killed-unarchived: this call ended its shell; the transcript stays in the spool and a later launch archives it;
 * - gone: the service no longer had it before this call could end it;
 * - attached: it is attached in a window (or became attached), and was not touched;
 * - kept: End All Eligible only: the service re-verified it and found work, protection or doubt, so it was not ended.
 */
export type EndOutcome = 'killed' | 'killed-unarchived' | 'gone' | 'attached' | 'kept';

export interface EndDetachedDeps {
  /** The service's current list. Throws when the service cannot be asked: that is never "already ended". */
  list: () => Promise<SessionInfo[]>;
  /** Ask the service to end the session by id; it refuses ('attached') if a window holds it at that moment. */
  kill: (session: SessionInfo) => Promise<void>;
  archive: (session: SessionInfo) => Promise<unknown>;
}

/**
 * End one session the person confirmed. Targets are session ids the service issued (never a PID); the service's list
 * is read again first, and the service itself re-checks attachment when it receives the kill. Anything this cannot
 * prove is reported as it is: a failure throws, and only a shell this call ended counts as killed.
 */
export async function endDetachedSession(session: SessionInfo, deps: EndDetachedDeps): Promise<EndOutcome> {
  const current = (await deps.list()).find(item => item.id === session.id);
  if (!current) return 'gone';
  if (current.state !== 'detached') return 'attached';
  try { await deps.kill(current); }
  catch (error) {
    const code = (error as {code?: string}).code;
    if (code === 'attached') return 'attached';
    if (code === 'unknown') return 'gone';
    if (code === 'busy') return 'kept';
    throw error;
  }
  try { await deps.archive(current); return 'killed'; }
  catch { return 'killed-unarchived'; }
}
