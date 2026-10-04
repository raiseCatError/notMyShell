import type {Key} from '../terminal/keys.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import type {WatchTask} from './WatchTasks.js';

/** /watch: one live block per watch (current, previous, what changed), never a pile of repeated output. */
export interface WatchPanelState {
  selected: number;
  /** Showing the selected watch's current output. */
  output: boolean;
  /** A watch waiting for the person's explicit Yes (unknown command, or a network target). */
  confirm?: {command: string; cwd: string; intervalMs?: number; reason: string; choice: 'yes' | 'no'};
  message?: string;
}

export type WatchPanelAction = {kind: 'close'} | {kind: 'pause' | 'resume' | 'stop' | 'now'; id: string} | {kind: 'confirm'};

const formatEvery = (ms: number) => ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 100) / 10}s`;
const ago = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;

export function watchPanelKey(state: WatchPanelState, key: Key, watches: readonly WatchTask[]): WatchPanelAction | undefined {
  if (state.confirm) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.confirm = undefined; state.message = 'Nothing is being watched.'; return undefined; }
    if (key.kind === 'left' || key.kind === 'right') state.confirm.choice = state.confirm.choice === 'yes' ? 'no' : 'yes';
    else if (key.kind === 'text' && /^[yn]$/iu.test(key.value)) state.confirm.choice = key.value.toLowerCase() === 'y' ? 'yes' : 'no';
    else if (key.kind === 'enter') { if (state.confirm.choice === 'yes') return {kind: 'confirm'}; state.confirm = undefined; state.message = 'Nothing is being watched.'; }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') { if (state.output) { state.output = false; return undefined; } return {kind: 'close'}; }
  if (!watches.length) return undefined;
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + watches.length) % watches.length; return undefined; }
  const watch = watches[Math.min(state.selected, watches.length - 1)]!;
  if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'o')) { state.output = !state.output; return undefined; }
  if (key.kind === 'text') {
    const letter = key.value.toLowerCase();
    if (letter === 'p') return {kind: watch.status === 'paused' ? 'resume' : 'pause', id: watch.id};
    if (letter === 'r') return {kind: 'now', id: watch.id};
    if (letter === 's') return {kind: 'stop', id: watch.id};
  }
  return undefined;
}

/** The compact live row above the composer for one watch. */
export function watchRow(watch: WatchTask, now: number): string {
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const reset = '\u001b[0m';
  const state = watch.current ? (watch.current.exitCode === 0 ? foreground(UI_COLORS.success) : foreground(UI_COLORS.failure)) : subtle;
  const mark = watch.status === 'paused' ? '‖' : '◉';
  return `${state}${mark}${reset} ${secondary}Watching · ${watch.command.slice(0, 40)}${reset}${subtle} · every ${formatEvery(watch.intervalMs)}${watch.summary ? ` · ${watch.summary}` : ''}`
    + `${watch.changes.length ? ' · changed' : ''} · runs ${watch.runs}${watch.status === 'paused' ? ' · paused' : ` · ${ago(now - watch.startedAt)}`}${reset}`;
}

export function renderWatchPanel(state: WatchPanelState, watches: readonly WatchTask[], columns: number, now: number, rowsAvailable: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const rows = [`${primary}  Watch${reset}`];
  if (state.confirm) {
    const yes = state.confirm.choice === 'yes';
    rows.push('', `  ${primary}Watch ${state.confirm.command}?${reset}`, `  ${secondary}${state.confirm.reason}${reset}`,
      `  ${subtle}It runs in ${state.confirm.cwd}, every ${formatEvery(state.confirm.intervalMs ?? 5000)}, until you stop it.${reset}`, '',
      `  ${!yes ? `${accent}${GLYPHS.selection} No${reset}` : `${subtle}  No${reset}`}    ${yes ? `${accent}${GLYPHS.selection} Yes${reset}` : `${subtle}  Yes${reset}`}`, '',
      renderControls([['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  if (!watches.length) {
    rows.push('', `  ${secondary}Nothing is being watched.${reset}`, `  ${subtle}/watch git status · /watch --every 10s npm test · stop with /watch stop${reset}`);
    if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
    rows.push('', renderControls([['Esc', 'close']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  const watch = watches[Math.min(state.selected, watches.length - 1)]!;
  watches.forEach((item, index) => rows.push(`${index === state.selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${watchRow(item, now)}`));
  rows.push('');
  if (state.output) {
    const lines = (watch.current?.output ?? '').split('\n');
    const room = Math.max(4, rowsAvailable - rows.length - 3);
    rows.push(`  ${subtle}Current output · ${lines.length} lines${lines.length > room ? ` (last ${room})` : ''}${reset}`, ...lines.slice(-room).map(line => `  ${line}`));
  } else {
    rows.push(`  ${subtle}Current${reset}   ${secondary}${watch.summary ?? (watch.current ? `exit ${watch.current.exitCode}` : 'running…')}${reset}`);
    if (watch.previous) rows.push(`  ${subtle}Previous${reset}  ${secondary}${watch.previousSummary ?? `exit ${watch.previous.exitCode}`}${reset}`);
    rows.push(`  ${subtle}Changed${reset}   ${watch.changes.length ? '' : `${secondary}nothing since the last run${reset}`}`, ...watch.changes.map(line => `    ${line.startsWith('✗') || line.startsWith('-') ? foreground(UI_COLORS.failure) : line.startsWith('✓') || line.startsWith('+') ? foreground(UI_COLORS.success) : secondary}${line}${reset}`));
    rows.push(`  ${subtle}Runs ${watch.runs} · ${ago(now - watch.startedAt)}${watch.network ? ' · repeated network access' : ''}${reset}`);
  }
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', state.output ? 'summary' : 'view output'], ['P', watch.status === 'paused' ? 'resume' : 'pause'], ['R', 'run now'], ['S', 'stop'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
