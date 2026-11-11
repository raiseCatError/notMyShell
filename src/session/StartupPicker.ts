import {KeyDecoder, type Key} from '../terminal/keys.js';
import type {SessionInfo} from './SessionProtocol.js';
import {formatAge, sessionText, tildePath} from './sessionList.js';
import {liveStatusParts} from './liveStatus.js';
import {GLYPHS, checkMark} from '../ui/glyphs.js';

// Launch-time restore screens, shown before any session is attached. Each has
// one destructive key, X, which only opens a confirmation; the kill itself is
// the same confirmed termination path /resume uses (killAndArchive), and the
// transcript is archived, never discarded.

const clipTo = (columns: number) => (raw: string) => { const text = sessionText(raw); return text.length > columns - 1 ? `${text.slice(0, Math.max(0, columns - 2))}…` : text; };
const shellName = (session: SessionInfo) => session.shell ?? 'zsh';
/** What the session is doing, from the service's evidence only: the first one or two facts /sessions shows. */
const activity = (session: SessionInfo, now: number) => sessionText(liveStatusParts(session, now).slice(0, session.running ? 2 : 1).join(' · '));
/** The one-session screens have room to say it in words: idle at the prompt (for how long), or what runs. */
const spelledActivity = (session: SessionInfo, now: number) => session.running ? activity(session, now)
  : `idle at the prompt${session.idleSince ? ` · ${formatAge(now - session.idleSince)}` : ''}`;
/** Its own name, when the person gave one or the service assigned a signature. */
const identity = (session: SessionInfo) => sessionText(session.name ?? session.signature ?? '');

// ── One detached session ─────────────────────────────────────────────────────

/** resume: attach · not-now: fresh session, this launch only · always/never: also persist the startup setting. */
export type SinglePromptChoice = 'resume' | 'not-now' | 'always' | 'never' | 'kill';

export function renderSinglePrompt(session: SessionInfo, columns: number, now: number): string[] {
  const clip = clipTo(columns);
  const name = identity(session);
  return ['NMSh · 1 detached live session', '',
    clip(`  ${name ? `${name} · ` : ''}${tildePath(session.cwd)} · ${shellName(session)}`),
    clip(`  ${spelledActivity(session, now)}`),
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

export function renderKillConfirm(target: SessionInfo | readonly SessionInfo[], columns: number, now: number): string[] {
  const clip = clipTo(columns);
  const sessions = Array.isArray(target) ? target as readonly SessionInfo[] : [target as SessionInfo];
  const many = sessions.length > 1;
  const shown = sessions.slice(0, KILL_LIST_LIMIT);
  return [many ? `Kill ${sessions.length} detached sessions?` : 'Kill detached session?', '',
    ...shown.flatMap(session => many
      ? [clip(`  ${tildePath(session.cwd)} · ${activity(session, now)}`)]
      : [clip(`  ${tildePath(session.cwd)} · ${shellName(session)}`), clip(`  ${spelledActivity(session, now)}`)]),
    ...(sessions.length > shown.length ? [`  and ${sessions.length - shown.length} more`] : []), '',
    many ? `  This ends ${sessions.length} live shells and whatever runs in them.` : '  This ends the live shell and whatever runs in it.',
    `  ${many ? 'Their transcripts remain' : 'Its transcript will remain'} available in /resume. Sessions open in another window are not touched.`, '',
    clip(`Enter/Y kill${many ? ` all ${sessions.length}` : ''} · Esc/N cancel`)];
}

/** Sessions named one per line in a kill confirmation; the rest are counted. */
const KILL_LIST_LIMIT = 6;

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
  /** The sessions a kill confirmation is open for: the selected ones, or the highlighted one. */
  confirming?: string[];
  /** One factual line about the last kill, shown under the list. */
  message?: string;
}

/** Returned by multiPickerKey once a kill is confirmed; the caller performs it and re-enters the picker. */
export interface KillRequest {kill: string[]}

export function createMultiPicker(sessions: SessionInfo[]): MultiPickerState {
  return {sessions, cursor: 0, selected: new Set()};
}

export function renderMultiPicker(state: MultiPickerState, columns: number, now: number): string[] {
  const clip = clipTo(columns);
  const width = Math.min(32, Math.max(...state.sessions.map(session => tildePath(session.cwd).length), 4));
  const named = Math.min(16, Math.max(0, ...state.sessions.map(session => identity(session).length)));
  const confirming = state.confirming ? state.sessions.filter(session => state.confirming!.includes(session.id)) : [];
  if (confirming.length) return renderKillConfirm(confirming, columns, now);
  const rows = [`NMSh · ${state.sessions.length} detached live session${state.sessions.length === 1 ? '' : 's'}`, ''];
  state.sessions.forEach((session, index) => {
    const mark = checkMark(state.selected.has(session.id));
    const name = named ? `${identity(session).slice(0, named).padEnd(named)}  ` : '';
    rows.push(clip(`${index === state.cursor ? GLYPHS.selection : ' '} ${mark} ${name}${tildePath(session.cwd).padEnd(width)}  ${shellName(session).padEnd(4)}  ${activity(session, now)}`));
  });
  const count = state.selected.size;
  // What Enter does is spelled out, and so is what X would end: the action under the cursor is never a guess.
  const enter = count === 0 ? 'Enter resume this' : `Enter resume ${count} selected`;
  const kill = count === 0 ? 'X kill this' : `X kill ${count} selected`;
  rows.push('', clip(`${enter} · N new session · ↑↓ move · Space select · A all`),
    clip(`${kill} · Esc new session · sessions you leave keep running (/resume)`), ...(state.message ? ['', clip(state.message)] : []));
  return rows;
}

/**
 * Apply one key; returns the ids to resume (in list order) once the user is done, [] for a new session. Enter resumes
 * the selected sessions, or the highlighted one when none is selected; N and Esc start a new session and leave every
 * listed one running. X asks to kill the selected sessions, or the highlighted one.
 */
export function multiPickerKey(state: MultiPickerState, key: Key): string[] | KillRequest | undefined {
  const count = state.sessions.length;
  if (state.confirming) {
    const decision = killConfirmKey(key);
    const ids = state.confirming;
    if (decision) state.confirming = undefined;
    return decision === 'confirm' ? {kill: [...ids]} : undefined;
  }
  state.message = undefined;
  const highlighted = state.sessions[state.cursor];
  const chosen = () => state.selected.size ? state.sessions.filter(session => state.selected.has(session.id)).map(session => session.id) : highlighted ? [highlighted.id] : [];
  if (key.kind === 'text' && key.value.toLowerCase() === 'x') { const ids = chosen(); if (ids.length) state.confirming = ids; }
  else if (key.kind === 'up') state.cursor = (state.cursor - 1 + count) % count;
  else if (key.kind === 'down') state.cursor = (state.cursor + 1) % count;
  else if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) return [];
  else if (key.kind === 'enter') return chosen();
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
  if (state.confirming) { state.confirming = state.confirming.filter(item => item !== id); if (!state.confirming.length) state.confirming = undefined; }
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
    const targets = state.sessions.filter(session => result.kill.includes(session.id));
    if (!targets.length) continue;
    // One at a time, each re-checked by the service: a session attached elsewhere meanwhile is left alone.
    const tally = {killed: 0, gone: 0, attached: 0, failed: [] as string[]};
    for (const target of targets) {
      let outcome: KillResult;
      try { outcome = await io.kill(target); }
      catch (error) { tally.failed.push(error instanceof Error ? error.message : String(error)); continue; }
      tally[outcome] += 1;
      if (outcome !== 'attached') removeFromMultiPicker(state, target.id);
      else state.selected.delete(target.id);
    }
    state.message = killSummary(tally);
    if (state.sessions.length === 0) return [];
  }
}

/** One factual line about what a kill did, session by session. */
function killSummary(tally: {killed: number; gone: number; attached: number; failed: string[]}): string {
  const parts: string[] = [];
  const sessions = (count: number) => `${count} session${count === 1 ? '' : 's'}`;
  if (tally.killed) parts.push(tally.killed === 1 && !tally.gone && !tally.attached && !tally.failed.length ? 'Session ended; its transcript is in /resume.' : `${sessions(tally.killed)} ended`);
  if (tally.gone) parts.push(tally.gone === 1 && parts.length === 0 && !tally.attached && !tally.failed.length ? 'That session had already ended; it is in /resume.' : `${sessions(tally.gone)} had already ended`);
  if (tally.attached) parts.push(tally.attached === 1 && parts.length === 0 && !tally.failed.length ? 'That session is attached in another window and was not touched.' : `${sessions(tally.attached)} attached in another window ${tally.attached === 1 ? 'was' : 'were'} not touched`);
  if (tally.failed.length) parts.push(tally.failed.length === 1 && parts.length === 0 ? `Could not end that session: ${tally.failed[0]}` : `${sessions(tally.failed.length)} could not be ended (${tally.failed[0]})`);
  const line = parts.join('; ');
  return /[.)]$/u.test(line) ? line : `${line}; transcripts stay in /resume.`;
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
          process.stdout.off('resize', onResize);
          process.stdin.setRawMode(wasRaw);
          process.stdin.pause();
          process.stdout.write('\u001b[?25h\u001b[?1049l');
          resolve(result);
          return;
        }
      }
      draw();
    };
    // A resize redraws at the new width (narrow terminals keep every line clipped, never wrapped).
    const onResize = () => draw();
    process.stdout.on('resize', onResize);
    process.stdin.on('data', onData);
    process.stdin.resume();
    draw();
  });
}
