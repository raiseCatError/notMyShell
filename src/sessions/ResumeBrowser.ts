import type {TranscriptSummary} from './TranscriptStore.js';
import type {SessionInfo} from '../session/SessionProtocol.js';
import {formatAge, sessionText, tildePath} from '../session/sessionList.js';
import {ACTIVE_OUTPUT_MS, liveStatusParts} from '../session/liveStatus.js';
import {detectAgentCommand, detectAgentProcess, type AgentDescriptor} from '../agents/agents.js';

export interface ResumeBrowserState {
  /** Live service sessions other than this frontend's own; listed first. */
  live: SessionInfo[];
  /** Live session awaiting Kill Session confirmation. */
  confirmKill?: string;
  sessions: TranscriptSummary[];
  commandText: Map<string, string>;
  query: string;
  week: number;
  selectedIndex: number;
  indexing: boolean;
  /** /sessions: live sessions only (archives are /resume's), including this window's own. */
  liveOnly?: boolean;
  currentId?: string;
}

function weekStart(date: Date): number {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return start.getTime();
}

function monthKey(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/**
 * Archived rows exclude journals that still present a live session: that
 * session is listed once, under LIVE, never as an archive of itself.
 */
export function createResumeBrowser(sessions: TranscriptSummary[], live: SessionInfo[] = [], liveJournalIds: ReadonlySet<string> = new Set()): ResumeBrowserState {
  sessions = sessions.filter(session => !liveJournalIds.has(session.id));
  return {live, sessions, commandText: new Map(), query: '',
    week: weekStart(new Date(sessions[0]?.createdAt ?? Date.now())), selectedIndex: 0, indexing: sessions.length > 0};
}

export function visibleLiveSessions(state: ResumeBrowserState): SessionInfo[] {
  const query = state.query.toLocaleLowerCase().trim();
  // /sessions lists in start order, so #N matches session notices.
  const live = state.liveOnly ? [...state.live].sort((a, b) => a.createdAt - b.createdAt) : state.live;
  if (!query) return live;
  return live.filter(session => `${session.cwd} ${session.running ?? ''} ${session.shell ?? ''}`.toLocaleLowerCase().includes(query));
}

export type ResumeSelection =
  | {kind: 'live'; session: SessionInfo}
  | {kind: 'archived'; session: TranscriptSummary};

/** One selection index spans LIVE rows then ARCHIVED rows. */
export function resumeSelection(state: ResumeBrowserState): ResumeSelection | undefined {
  const live = visibleLiveSessions(state);
  if (state.selectedIndex < live.length) {
    const session = live[state.selectedIndex];
    return session ? {kind: 'live', session} : undefined;
  }
  const session = visibleResumeSessions(state)[state.selectedIndex - live.length];
  return session ? {kind: 'archived', session} : undefined;
}

export function resumeRowCount(state: ResumeBrowserState): number {
  return visibleLiveSessions(state).length + visibleResumeSessions(state).length;
}

/** Facts only: where, how old, attached or not, and what zsh reports running. */
export function describeLiveSession(session: SessionInfo, now: number): string {
  const state = session.state === 'attached' ? 'attached in another window' : 'detached';
  return [tildePath(session.cwd), state, ...liveStatusParts(session, now), `started ${formatAge(now - session.createdAt)} ago`].join(' · ');
}

export function visibleResumeSessions(state: ResumeBrowserState): TranscriptSummary[] {
  if (state.liveOnly) return [];
  const query = state.query.toLocaleLowerCase().trim();
  return state.sessions.filter(session => {
    if (!query) return weekStart(new Date(session.createdAt)) === state.week;
    const metadata = `${session.createdAt} ${new Date(session.createdAt).toLocaleString()} ${session.project} ${session.startCwd} ${session.finalCwd}`;
    return `${metadata} ${state.commandText.get(session.id) ?? ''}`.toLocaleLowerCase().includes(query);
  });
}

/** Move to the next retained week/month, skipping empty periods. */
export function navigateResume(state: ResumeBrowserState, unit: 'week' | 'month', direction: -1 | 1): boolean {
  if (state.query) return false;
  const active = visibleResumeSessions(state)[Math.max(0, state.selectedIndex - visibleLiveSessions(state).length)];
  const current = unit === 'week' ? state.week : monthKey(new Date(active?.createdAt ?? state.week));
  const candidates = state.sessions.map(session => {
    const date = new Date(session.createdAt);
    return unit === 'week' ? weekStart(date) : monthKey(date);
  }).filter(value => direction < 0 ? value < current : value > current);
  if (candidates.length === 0) return false;
  const target = direction < 0 ? Math.max(...candidates) : Math.min(...candidates);
  const matching = state.sessions.find(session => {
    const date = new Date(session.createdAt);
    return (unit === 'week' ? weekStart(date) : monthKey(date)) === target;
  });
  if (!matching) return false;
  state.week = weekStart(new Date(matching.createdAt));
  state.selectedIndex = visibleLiveSessions(state).length;
  return true;
}

export function resumeDayLabel(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (day === today) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (day === yesterday) return 'Yesterday';
  return date.toLocaleDateString();
}

/**
 * The one-word state a live row leads with, strongest fact first. Only what
 * the service reports: its input watch seeing the command wait for input
 * (confirmed or likely, never re-guessed here), a pending attention request,
 * recent output, a running command, or how the last command ended.
 */
export type LiveRowState = 'input' | 'inputLikely' | 'attention' | 'active' | 'running' | 'completed' | 'failed' | 'idle';

export function liveRowState(session: SessionInfo, now: number): LiveRowState {
  if (session.running) {
    if (session.inputSince !== undefined) return session.inputConfidence === 'likely' ? 'inputLikely' : 'input';
    if (session.attentionSince !== undefined) return 'attention';
    if (session.lastOutputAt !== undefined && now - session.lastOutputAt < ACTIVE_OUTPUT_MS) return 'active';
    return 'running';
  }
  if (session.notice?.kind === 'completed') return 'completed';
  if (session.notice?.kind === 'failed' || (session.lastExit !== undefined && session.lastExit !== 0 && session.lastExit !== 130)) return 'failed';
  return 'idle';
}

export const LIVE_ROW_LABELS: Record<LiveRowState, string> = {
  input: 'Waiting for input', inputLikely: 'Probably waiting', attention: 'Needs attention', active: 'Active', running: 'Running', completed: 'Completed', failed: 'Failed', idle: 'Idle',
};

/** A known agent, only when the command's program word or the foreground process proves it. */
export function liveRowAgent(session: SessionInfo): AgentDescriptor | undefined {
  return (session.running ? detectAgentCommand(session.running) : undefined) ?? detectAgentProcess(session.process);
}

/** Session viewer row facts after the state badge: where, what, how long. */
export function describeLiveRow(session: SessionInfo, now: number): string {
  const where = tildePath(session.cwd);
  const attached = session.state === 'attached' ? 'open in another window' : 'detached';
  const asked = session.running && session.inputPrompt ? `“${sessionText(session.inputPrompt).slice(0, 40)}” · ` : '';
  const what = session.running
    ? `${asked}${sessionText(session.running.replace(/\s+/gu, ' ')).slice(0, 48)} · ${formatAge(now - (session.runningSince ?? now))}`
    : `idle${session.idleSince ? ` ${formatAge(now - session.idleSince)}` : ''}${session.lastExit !== undefined && session.lastExit !== 0 ? ` · last exit ${session.lastExit}` : ''}`;
  const extra = session.title && session.running && !session.inputPrompt ? ` · “${sessionText(session.title).slice(0, 32)}”` : '';
  const name = session.name || session.signature;
  return `${name ? `${name} · ` : ''}${where} · ${what}${extra} · ${attached} · age ${formatAge(now - session.createdAt)}`;
}

/** Archived row: duration when the journal recorded an end, otherwise its age. */
export function describeArchivedRow(session: TranscriptSummary, now: number): string {
  const ended = session.endedAt ? Date.parse(session.endedAt) : NaN;
  const started = Date.parse(session.createdAt);
  const span = Number.isFinite(ended) && Number.isFinite(started) ? `ran ${formatAge(Math.max(0, ended - started))}` : `${formatAge(Math.max(0, now - started))} ago`;
  const interrupted = session.journaled && !session.endedAt ? ' · interrupted' : '';
  return `${session.project || 'notMyShell'} · ${tildePath(session.finalCwd)} · ${session.commandCount} command${session.commandCount === 1 ? '' : 's'} · ${span}${interrupted}`;
}

/** /sessions: the existing browser in live-only mode, with this window's session included. */
export function createSessionsView(live: SessionInfo[], currentId: string | undefined): ResumeBrowserState {
  return {live, sessions: [], commandText: new Map(), query: '', week: 0, selectedIndex: 0, indexing: false, liveOnly: true,
    ...(currentId ? {currentId} : {})};
}
