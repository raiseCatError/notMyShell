import {KeyDecoder, type Key} from '../terminal/keys.js';
import type {SessionInfo} from './SessionProtocol.js';
import {formatAge, tildePath} from './sessionList.js';

// Launch-time restore screens, shown before any session is attached. Neither
// has a destructive key: killing a live session stays a confirmed /resume action.

const clipTo = (columns: number) => (text: string) => (text.length > columns - 1 ? `${text.slice(0, Math.max(0, columns - 2))}…` : text);
const activity = (session: SessionInfo) => session.running?.replace(/\s+/gu, ' ').slice(0, 60) ?? 'zsh';
const age = (session: SessionInfo, now: number) => formatAge(now - (session.runningSince ?? session.idleSince ?? session.createdAt));

// ── One detached session ─────────────────────────────────────────────────────

/** resume: attach · not-now: fresh session, this launch only · always/never: also persist the startup setting. */
export type SinglePromptChoice = 'resume' | 'not-now' | 'always' | 'never';

export function renderSinglePrompt(session: SessionInfo, columns: number, now: number): string[] {
  const clip = clipTo(columns);
  return ['NMSh · 1 detached live session', '',
    clip(`  ${tildePath(session.cwd)}`),
    clip(`  ${session.running ? `running ${activity(session)}` : 'idle at the prompt'} · ${age(session, now)}`),
    clip(`  started ${formatAge(now - session.createdAt)} ago`), '',
    '  R  Resume', '  N  Not now (start a new session; it keeps running)',
    '  A  Always resume', '  D  Don\'t resume at startup (it keeps running)', '',
    clip('Enter resume · Esc not now · sessions stay in /resume')];
}

export function singlePromptKey(key: Key): SinglePromptChoice | undefined {
  if (key.kind === 'enter') return 'resume';
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'not-now';
  if (key.kind !== 'text') return undefined;
  return ({r: 'resume', n: 'not-now', a: 'always', d: 'never'} as const)[key.value.toLowerCase() as 'r' | 'n' | 'a' | 'd'];
}

// ── Several detached sessions ────────────────────────────────────────────────

export interface MultiPickerState {
  sessions: SessionInfo[];
  cursor: number;
  selected: Set<string>;
}

export function createMultiPicker(sessions: SessionInfo[]): MultiPickerState {
  return {sessions, cursor: 0, selected: new Set()};
}

export function renderMultiPicker(state: MultiPickerState, columns: number, now: number): string[] {
  const clip = clipTo(columns);
  const width = Math.min(32, Math.max(...state.sessions.map(session => tildePath(session.cwd).length), 4));
  const commandWidth = Math.min(20, Math.max(...state.sessions.map(session => activity(session).length), 3));
  const rows = [`NMSh · ${state.sessions.length} detached live sessions`, ''];
  state.sessions.forEach((session, index) => {
    const mark = state.selected.has(session.id) ? '[x]' : '[ ]';
    rows.push(clip(`${index === state.cursor ? '›' : ' '} ${mark} ${tildePath(session.cwd).padEnd(width)}  ${activity(session).padEnd(commandWidth)}  ${age(session, now)}`));
  });
  const count = state.selected.size;
  rows.push('', clip(`↑↓ move · Space select · A all · Enter resume ${count === 0 ? 'none' : count} · Esc none`),
    clip('Unselected sessions keep running and stay in /resume.'));
  return rows;
}

/** Apply one key; returns the ids to resume (in list order) once the user is done, [] for none. */
export function multiPickerKey(state: MultiPickerState, key: Key): string[] | undefined {
  const count = state.sessions.length;
  if (key.kind === 'up') state.cursor = (state.cursor - 1 + count) % count;
  else if (key.kind === 'down') state.cursor = (state.cursor + 1) % count;
  else if (key.kind === 'escape' || key.kind === 'interrupt') return [];
  else if (key.kind === 'enter') return state.sessions.filter(session => state.selected.has(session.id)).map(session => session.id);
  else if (key.kind === 'text' && key.value === ' ') {
    const id = state.sessions[state.cursor]!.id;
    if (!state.selected.delete(id)) state.selected.add(id);
  } else if (key.kind === 'text' && key.value.toLowerCase() === 'a') {
    // Toggle like common pickers: select all, or clear once everything is selected.
    if (state.selected.size === count) state.selected.clear();
    else for (const session of state.sessions) state.selected.add(session.id);
  }
  return undefined;
}

// ── Terminal runner ─────────────────────────────────────────────────────────

/** Run a full-screen prompt on the real terminal until `onKey` returns a result. */
export function runStartupScreen<T>(render: (columns: number) => string[], onKey: (key: Key) => T | undefined): Promise<T> {
  const decoder = new KeyDecoder();
  const draw = () => process.stdout.write(`\u001b[H\u001b[2J${render(process.stdout.columns || 80).join('\r\n')}`);
  return new Promise(resolve => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdout.write('\u001b[?1049h\u001b[?25l');
    const onData = (data: string) => {
      // A read ending in a lone ESC ends with the Esc key, not the start of a
      // sequence (e.g. Space then Esc typed quickly arrive as one read).
      const trailingEscape = data.endsWith('\u001b') && !data.endsWith('\u001b\u001b');
      const keys: Key[] = decoder.push(trailingEscape ? data.slice(0, -1) : data);
      if (trailingEscape) keys.push({kind: 'escape'});
      for (const key of keys) {
        const result = onKey(key);
        if (result !== undefined) {
          process.stdin.off('data', onData);
          process.stdin.setRawMode(wasRaw);
          process.stdin.pause();
          process.stdout.write('\u001b[?25h\u001b[?1049l');
          resolve(result);
          return;
        }
      }
      draw();
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
    draw();
  });
}
