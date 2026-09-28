import type {TranscriptSummary} from './TranscriptStore.js';
import type {SessionInfo} from '../session/SessionProtocol.js';
import {formatAge} from '../session/sessionList.js';

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
  if (!query) return state.live;
  return state.live.filter(session => `${session.cwd} ${session.running ?? ''}`.toLocaleLowerCase().includes(query));
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
  const activity = session.running
    ? `running ${session.running.replace(/\s+/gu, ' ').slice(0, 60)} · ${formatAge(now - (session.runningSince ?? now))}`
    : 'idle';
  return `${session.cwd} · ${state} · ${activity} · started ${formatAge(now - session.createdAt)} ago`;
}

export function visibleResumeSessions(state: ResumeBrowserState): TranscriptSummary[] {
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
