import type {TranscriptSummary} from './TranscriptStore.js';

export interface ResumeBrowserState {
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

export function createResumeBrowser(sessions: TranscriptSummary[]): ResumeBrowserState {
  return {sessions, commandText: new Map(), query: '',
    week: weekStart(new Date(sessions[0]?.createdAt ?? Date.now())), selectedIndex: 0, indexing: sessions.length > 0};
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
  const active = visibleResumeSessions(state)[state.selectedIndex];
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
  state.selectedIndex = 0;
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
