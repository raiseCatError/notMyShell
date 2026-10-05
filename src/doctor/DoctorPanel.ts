import type {Key} from '../terminal/keys.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {liveLine} from '../status/liveLine.js';
import {doctorSummary, type DoctorAction, type DoctorCheck, type DoctorState} from './doctor.js';

/** The /doctor surface: sections of checks, a live line while checking, and row actions that only open things. */
export interface DoctorPanelState {
  checks?: DoctorCheck[];
  selected: number;
  startedAt: number;
  title: string;
}

export function createDoctorPanel(title: string, now = Date.now()): DoctorPanelState { return {selected: 0, startedAt: now, title}; }

export type DoctorPanelAction = {kind: 'close'} | {kind: 'rerun'} | {kind: 'action'; action: DoctorAction};

export function doctorKey(state: DoctorPanelState, key: Key): DoctorPanelAction | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'text' && key.value.toLowerCase() === 'r') return {kind: 'rerun'};
  const checks = state.checks ?? [];
  if (!checks.length) return undefined;
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + checks.length) % checks.length; return undefined; }
  const action = checks[state.selected]?.action;
  if ((key.kind === 'enter' || key.kind === 'right') && action) return {kind: 'action', action};
  return undefined;
}

export function stateGlyph(state: DoctorState): string {
  const safe = getCurrentGlyphMode() === 'safe';
  return state === 'ok' ? (safe ? '+' : '✓') : state === 'attention' ? '!' : state === 'failure' ? (safe ? 'x' : '✗') : (safe ? '-' : '·');
}

export function renderDoctorPanel(state: DoctorPanelState, columns: number, now: number, still: boolean): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const color = (value: DoctorState) => foreground(value === 'ok' ? UI_COLORS.success : value === 'failure' ? UI_COLORS.failure : value === 'attention' ? UI_COLORS.accent : UI_COLORS.subtle);
  const rows = [`${primary}  Doctor · ${state.title}${reset}`];
  if (!state.checks) {
    rows.push('', `  ${liveLine('Checking', undefined, state.startedAt, now, {still})}`);
    return rows.map(row => truncateAnsi(row, columns));
  }
  const {failures, attention} = doctorSummary(state.checks);
  rows.push(`  ${subtle}${failures ? `${failures} failure${failures === 1 ? '' : 's'} · ` : ''}${attention ? `${attention} to look at · ` : ''}${!failures && !attention ? 'Healthy · ' : ''}local checks only; nothing was changed${reset}`);
  let section = '';
  state.checks.forEach((check, index) => {
    if (check.section !== section) { rows.push('', `  ${secondary}${check.section}${reset}`); section = check.section; }
    const selected = index === state.selected;
    rows.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '}   ${color(check.state)}${stateGlyph(check.state)}${reset} ${focusForeground(selected)}${check.label}${reset}`
      + `${check.detail ? `  ${subtle}${check.detail}${reset}` : ''}${check.action ? `  ${selected ? accent : subtle}${check.action.label} ›${reset}` : ''}`);
  });
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', 'action'], ['R', 'check again'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
