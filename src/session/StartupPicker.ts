import {KeyDecoder, type Key} from '../terminal/keys.js';
import type {SessionInfo} from './SessionProtocol.js';
import {formatAge, tildePath} from './sessionList.js';

// Launch-time restore screens, shown before any session is attached. Each has
// one destructive key, X, which only opens a confirmation; the kill itself is
// the same confirmed termination path /resume uses (killAndArchive), and the
// transcript is archived, never discarded.

const clipTo = (columns: number) => (text: string) => (text.length > columns - 1 ? `${text.slice(0, Math.max(0, columns - 2))}…` : text);
const activity = (session: SessionInfo) => session.running?.replace(/\s+/gu, ' ').slice(0, 60) ?? 'zsh';
const age = (session: SessionInfo, now: number) => formatAge(now - (session.runningSince ?? session.idleSince ?? session.createdAt));

// ── One detached session ─────────────────────────────────────────────────────

/** resume: attach · not-now: fresh session, this launch only · always/never: also persist the startup setting. */
export type SinglePromptChoice = 'resume' | 'not-now' | 'always' | 'never' | 'kill';

export function renderSinglePrompt(session: SessionInfo, columns: number, now: number): string[] {
  const clip = clipTo(columns);
  return ['NMSh · 1 detached live session', '',
    clip(`  ${tildePath(session.cwd)}`),
    clip(`  ${session.running ? `running ${activity(session)}` : 'idle at the prompt'} · ${age(session, now)}`),
    clip(`  started ${formatAge(now - session.createdAt)} ago`), '',
    '  R  Resume', '  N  Not now (start a new session; it keeps running)',
    '  X  Kill session (ends the shell; transcript stays in /resume)',
    '  A  Always resume', '  D  Don\'t resume at startup (it keeps running)', '',
    clip('Enter resume · Esc not now · sessions stay in /resume')];
}

export function singlePromptKey(key: Key): SinglePromptChoice | undefined {
  if (key.kind === 'enter') return 'resume';
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'not-now';
  if (key.kind !== 'text') return undefined;
  return ({r: 'resume', n: 'not-now', a: 'always', d: 'never', x: 'kill'} as const)[key.value.toLowerCase() as 'r' | 'n' | 'a' | 'd' | 'x'];
}

// ── Kill confirmation (shared by both screens) ──────────────────────────────

export function renderKillConfirm(session: SessionInfo, columns: number, now: number): string[] {
  const clip = clipTo(columns);
  return ['Kill detached session?', '',
    clip(`  ${tildePath(session.cwd)}`),
    clip(`  ${session.running ? `running ${activity(session)}` : 'idle at the prompt'} · ${age(session, now)}`), '',
    '  This ends the live shell.', '  Its transcript will remain available in /resume.', '',
    clip('Enter/Y kill · Esc/N cancel')];
}

/** Enter/Y confirm, Esc/N/Ctrl+C cancel; anything else is ignored. */
export function killConfirmKey(key: Key): 'confirm' | 'cancel' | undefined {
  if (key.kind === 'enter') return 'confirm';
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'cancel';
  if (key.kind !== 'text') return undefined;
  const value = key.value.toLowerCase();
  return value === 'y' ? 'confirm' : value === 'n' ? 'cancel' : undefined;
}

// ── Several detached sessions ────────────────────────────────────────────────

export interface MultiPickerState {
  sessions: SessionInfo[];
  cursor: number;
  selected: Set<string>;
  /** The session a kill confirmation is open for. */
  confirming?: string;
  /** One factual line about the last kill, shown under the list. */
  message?: string;
}

/** Returned by multiPickerKey once a kill is confirmed; the caller performs it and re-enters the picker. */
export interface KillRequest {kill: string}

export function createMultiPicker(sessions: SessionInfo[]): MultiPickerState {
  return {sessions, cursor: 0, selected: new Set()};
}

export function renderMultiPicker(state: MultiPickerState, columns: number, now: number): string[] {
  const clip = clipTo(columns);
  const width = Math.min(32, Math.max(...state.sessions.map(session => tildePath(session.cwd).length), 4));
  const commandWidth = Math.min(20, Math.max(...state.sessions.map(session => activity(session).length), 3));
  const confirming = state.sessions.find(session => session.id === state.confirming);
  if (confirming) return renderKillConfirm(confirming, columns, now);
  const rows = [`NMSh · ${state.sessions.length} detached live session${state.sessions.length === 1 ? '' : 's'}`, ''];
  state.sessions.forEach((session, index) => {
    const mark = state.selected.has(session.id) ? '[x]' : '[ ]';
    rows.push(clip(`${index === state.cursor ? '›' : ' '} ${mark} ${tildePath(session.cwd).padEnd(width)}  ${activity(session).padEnd(commandWidth)}  ${age(session, now)}`));
  });
  const count = state.selected.size;
  rows.push('', clip(`↑↓ move · Space select · A all · X kill · Enter resume ${count === 0 ? 'none' : count} · Esc none`),
    clip('Unselected sessions keep running and stay in /resume.'), ...(state.message ? [clip(state.message)] : []));
  return rows;
}

/** Apply one key; returns the ids to resume (in list order) once the user is done, [] for none. */
export function multiPickerKey(state: MultiPickerState, key: Key): string[] | KillRequest | undefined {
  const count = state.sessions.length;
  if (state.confirming) {
    const decision = killConfirmKey(key);
    const id = state.confirming;
    if (decision) state.confirming = undefined;
    return decision === 'confirm' ? {kill: id} : undefined;
  }
  state.message = undefined;
  if (key.kind === 'text' && key.value.toLowerCase() === 'x') state.confirming = state.sessions[state.cursor]?.id;
  else if (key.kind === 'up') state.cursor = (state.cursor - 1 + count) % count;
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

/** Drop a session (killed or already gone): selection and cursor stay consistent and in bounds. */
export function removeFromMultiPicker(state: MultiPickerState, id: string): void {
  state.sessions = state.sessions.filter(session => session.id !== id);
  state.selected.delete(id);
  if (state.confirming === id) state.confirming = undefined;
  state.cursor = Math.max(0, Math.min(state.cursor, state.sessions.length - 1));
}

export type KillResult = 'killed' | 'gone' | 'attached';

/**
 * The multi-session screen with in-place kill. `run` shows one screen until
 * a result; `kill` re-checks service truth and performs the real termination.
 * Resolves with the ids to resume, [] for none or when no session is left
 * (the caller then starts a fresh session).
 */
export async function pickWithKill(sessions: SessionInfo[], io: {
  run: <T>(render: (columns: number) => string[], onKey: (key: Key) => T | undefined) => Promise<T>;
  kill: (session: SessionInfo) => Promise<KillResult>;
  now?: () => number;
}): Promise<string[]> {
  const state = createMultiPicker(sessions);
  const now = io.now ?? Date.now;
  for (;;) {
    const result = await io.run<string[] | KillRequest>(columns => renderMultiPicker(state, columns, now()), key => multiPickerKey(state, key));
    if (Array.isArray(result)) return result;
    const target = state.sessions.find(session => session.id === result.kill);
    if (!target) continue;
    let outcome: KillResult;
    try { outcome = await io.kill(target); }
    catch (error) { state.message = `Could not end that session: ${error instanceof Error ? error.message : String(error)}`; continue; }
    removeFromMultiPicker(state, target.id);
    state.message = outcome === 'killed' ? 'Session ended; its transcript is in /resume.'
      : outcome === 'gone' ? 'That session had already ended; it is in /resume.' : 'That session is attached in another window and was not touched.';
    if (state.sessions.length === 0) return [];
  }
}

/** The one-session prompt with in-place kill; confirmation cancels back to the prompt. */
export async function askWithKill(session: SessionInfo, io: {
  run: <T>(render: (columns: number) => string[], onKey: (key: Key) => T | undefined) => Promise<T>;
  kill: (session: SessionInfo) => Promise<KillResult>;
  now?: () => number;
}): Promise<SinglePromptChoice> {
  const now = io.now ?? Date.now;
  for (;;) {
    const choice = await io.run<SinglePromptChoice>(columns => renderSinglePrompt(session, columns, now()), singlePromptKey);
    if (choice !== 'kill') return choice;
    const decision = await io.run<'confirm' | 'cancel'>(columns => renderKillConfirm(session, columns, now()), killConfirmKey);
    if (decision === 'cancel') continue;
    try { await io.kill(session); } catch { continue; }
    return 'kill';
  }
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
