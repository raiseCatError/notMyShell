import type {Key} from '../terminal/keys.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import type {WatchTask} from './WatchTasks.js';

/** /track and /watch share one live snapshot view: no duplicated transcript output. */
export interface WatchPanelState {
  selected: number;
  /** Showing the selected watch's current output. */
  output: boolean;
  /** A watch waiting for the person's explicit Yes (unknown command, or a network target). */
  confirm?: {command: string; cwd: string; intervalMs?: number; reason: string; choice: 'yes' | 'no'; /** Started as /track: it gets a live transcript block. */ track?: boolean};
  message?: string;
}

export type WatchPanelAction = {kind: 'close'} | {kind: 'pause' | 'resume' | 'stop' | 'now' | 'copy'; id: string} | {kind: 'confirm'};

const formatEvery = (ms: number) => ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 100) / 10}s`;
const ago = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
const runStatus = (run: WatchTask['current']): string => !run ? 'waiting for first result' : run.timedOut ? 'timed out' : run.error ? 'process error' : run.signal ? `signal ${run.signal}` : `exit ${run.exitCode}`;

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
    if (letter === 'c') return {kind: 'copy', id: watch.id};
    if (letter === 's') return {kind: 'stop', id: watch.id};
  }
  return undefined;
}

/** The compact live row above the composer for one watch. */
export function watchRow(watch: WatchTask, now: number): string {
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const reset = '\u001b[0m';
  const state = watch.current ? (watch.current.exitCode === 0 && !watch.current.timedOut && !watch.current.error ? foreground(UI_COLORS.success) : foreground(UI_COLORS.failure)) : subtle;
  const mark = watch.status === 'paused' ? '‖' : '◉';
  const last = watch.current ? ` · updated ${ago(Math.max(0, now - watch.current.at - watch.current.durationMs))} ago · ${runStatus(watch.current)}` : ' · first run pending';
  return `${state}${mark}${reset} ${secondary}Track · ${watch.command.slice(0, 40)}${reset}${subtle} · every ${formatEvery(watch.intervalMs)}${watch.summary ? ` · ${watch.summary}` : ''}`
    + `${watch.changes.length ? ' · changed' : ''} · runs ${watch.runs}${watch.status === 'paused' ? ' · paused' : last}${reset}`;
}

export function renderWatchPanel(state: WatchPanelState, watches: readonly WatchTask[], columns: number, now: number, rowsAvailable: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const rows = [`${primary}  Live commands · /track / /watch${reset}`];
  if (state.confirm) {
    if (columns < 40 || rowsAvailable < 10) {
      return [`${primary}  Resize to review tracked command (40 columns, 14 rows)${reset}`,
        `${secondary}  Confirmation is disabled at this size. Esc cancels.${reset}`].map(row => truncateAnsi(row, columns));
    }
    const yes = state.confirm.choice === 'yes';
    rows.push('', `  ${primary}Watch ${state.confirm.command}?${reset}`, `  ${secondary}${state.confirm.reason}${reset}`,
      `  ${subtle}It runs in ${state.confirm.cwd}, every ${formatEvery(state.confirm.intervalMs ?? 5000)}, until you stop it.${reset}`, '',
      `  ${!yes ? `${accent}${GLYPHS.selection} No${reset}` : `${subtle}  No${reset}`}    ${yes ? `${accent}${GLYPHS.selection} Yes${reset}` : `${subtle}  Yes${reset}`}`, '',
      renderControls([['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  if (!watches.length) {
    rows.push('', `  ${secondary}No active command trackers.${reset}`, `  ${subtle}/track df -h /Volumes/T7Projects · /track --every 5s -- docker system df${reset}`);
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
    rows.push(`  ${subtle}Latest completed output · ${lines.length} lines${lines.length > room ? ` (last ${room})` : ''} · ${runStatus(watch.current)}${watch.current?.truncated ? ' · output truncated' : ''}${reset}`, ...lines.slice(-room).map(line => `  ${line}`));
  } else {
    rows.push(`  ${subtle}Current${reset}   ${secondary}${watch.current?.timedOut || watch.current?.error || watch.current?.signal ? runStatus(watch.current) : watch.summary ?? (watch.current ? runStatus(watch.current) : 'running…')}${watch.current?.truncated ? ' · truncated' : ''}${reset}`);
    if (watch.previous) rows.push(`  ${subtle}Previous${reset}  ${secondary}${watch.previousSummary ?? `exit ${watch.previous.exitCode}`}${reset}`);
    rows.push(`  ${subtle}Changed${reset}   ${watch.changes.length ? '' : `${secondary}nothing since the last run${reset}`}`, ...watch.changes.map(line => `    ${line.startsWith('✗') || line.startsWith('-') ? foreground(UI_COLORS.failure) : line.startsWith('✓') || line.startsWith('+') ? foreground(UI_COLORS.success) : secondary}${line}${reset}`));
    rows.push(`  ${subtle}Runs ${watch.runs} · ${ago(now - watch.startedAt)}${watch.network ? ' · repeated network access' : ''}${reset}`);
  }
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', state.output ? 'summary' : 'view output'], ['P', watch.status === 'paused' ? 'resume' : 'pause'], ['R', 'run now'], ['C', 'copy latest'], ['S', 'stop'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
