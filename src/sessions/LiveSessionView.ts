import type {SessionInfo} from '../session/SessionProtocol.js';
import {formatAge, tildePath} from '../session/sessionList.js';
import {isShellId} from '../shell/adapters/ShellAdapter.js';
import {liveRowAgent, liveRowState, LIVE_ROW_LABELS, type LiveRowState} from './ResumeBrowser.js';
import type {AgentDescriptor} from '../agents/agents.js';

/**
 * One factual model of a live session, shared by `/sessions` and
 * `nmsh --sessions`: ordinal (by start time, as session notices number them),
 * whether it is this window's session, backend, state word, proven agent,
 * where, what and how long.
 */
export interface LiveSessionRow {
  session: SessionInfo;
  ordinal: number;
  current: boolean;
  shell: string;
  state: LiveRowState;
  stateLabel: string;
  agent?: AgentDescriptor;
  summary: string;
}

const SHELL_LABELS: Record<string, string> = {zsh: 'zsh', fish: 'Fish', bash: 'Bash'};

export function liveSessionRows(sessions: readonly SessionInfo[], currentId: string | undefined, now: number): LiveSessionRow[] {
  return [...sessions].sort((a, b) => a.createdAt - b.createdAt).map((session, index) => {
    const state = liveRowState(session, now);
    const agent = liveRowAgent(session);
    const what = session.running ? `running ${session.running.replace(/\s+/gu, ' ').slice(0, 48)} · ${formatAge(now - (session.runningSince ?? now))}`
      : `idle${session.idleSince ? ` ${formatAge(now - session.idleSince)}` : ''}`;
    const attachment = session.id === currentId ? 'this window' : session.state === 'attached' ? 'open in another window' : 'detached';
    const notice = session.notice ? ` · notice: ${session.notice.kind}` : '';
    return {session, ordinal: index + 1, current: session.id === currentId,
      shell: isShellId(session.shell) ? SHELL_LABELS[session.shell]! : session.shell ? session.shell : 'zsh',
      state, stateLabel: LIVE_ROW_LABELS[state], ...(agent ? {agent} : {}),
      summary: `${tildePath(session.cwd)} · ${what} · ${attachment} · age ${formatAge(now - session.createdAt)}${notice}`};
  });
}
