import type {Key} from '../terminal/keys.js';
import {COMMAND_LAUNCHES, COMPLETION_EFFECTS, COMPLETION_HIGHLIGHTS, CONTEXT_TRANSITIONS, EVENT_FEEDBACK, type MotionSettings, type PromptConfiguration} from '../prompt/configuration.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {BLUR_MODES, handleAppearanceKey, type AppearanceState} from './AppearancePanel.js';
import {cursorLabel} from '../cursor/CursorPanel.js';
import {renderMotionPreview, type MotionPreview} from '../motion/MotionPreview.js';
import type {MotionGate} from '../motion/transitions.js';

/**
 * /appearance: the visual hub. NMSh rows summarize and open the canonical
 * surfaces (/prompt, /cursor, UI chrome, /chroma) or the general Motion
 * screen; nothing is edited twice. Host window rows keep the existing
 * opacity/blur editing where the host supports it, and say who controls them
 * where it does not, so the hub is useful in every terminal.
 */
export type HubDestination = 'prompt' | 'cursor' | 'chrome' | 'chroma';

export interface AppearanceHubState {
  view: 'hub' | 'motion';
  selected: number;
  /** Host window editing (the existing AppearanceState), when the host has appearance integration. */
  host?: AppearanceState;
  hostName: string;
  hostGuidance?: string;
  /** Host values were changed and not saved yet. */
  hostDirty: boolean;
  /** When the Motion preview last started (row selected, value changed, R); one run, never a loop. */
  previewStart?: number;
}

export type HubAction = {kind: 'close'} | {kind: 'open'; destination: HubDestination} | {kind: 'motion'; motion: MotionSettings} | {kind: 'saveHost'};

const NMSH_ROWS: Array<{id: HubDestination | 'motion'; label: string}> = [
  {id: 'prompt', label: 'Prompt & theme'}, {id: 'cursor', label: 'Cursor & effects'}, {id: 'chrome', label: 'UI chrome'}, {id: 'chroma', label: 'Chroma'}, {id: 'motion', label: 'Motion'},
];

const MOTION_ROWS: Array<{key: keyof MotionSettings; label: string; values: readonly string[]; note: string}> = [
  {key: 'contextTransitions', label: 'Context transitions', values: CONTEXT_TRANSITIONS, note: 'Prompt modules transform in place when cwd, branch, Git state or tools change'},
  {key: 'commandLaunch', label: 'Command launch', values: COMMAND_LAUNCHES, note: 'Enter hands the command to the shell at once; this only shows the handoff'},
  {key: 'completionHighlight', label: 'Completion highlight', values: COMPLETION_HIGHLIGHTS, note: 'What completion just inserted, briefly'},
  {key: 'completionEffect', label: 'Command completion', values: COMPLETION_EFFECTS, note: 'Block Seal: a finished block settles with one semantic sweep'},
  {key: 'eventFeedback', label: 'Event feedback', values: EVENT_FEEDBACK, note: 'Semantic Echo: failures, long successes, conflicts, attention, tasks finishing'},
];
const MOTION_LABELS: Record<string, string> = {off: 'Off', subtle: 'Subtle', expressive: 'Expressive', sweep: 'Sweep', pulse: 'Pulse', vivid: 'Vivid', seal: 'Seal'};

export function createAppearanceHub(hostName: string, host?: AppearanceState, hostGuidance?: string): AppearanceHubState {
  return {view: 'hub', selected: 0, ...(host ? {host} : {}), hostName, ...(hostGuidance ? {hostGuidance} : {}), hostDirty: false};
}

/** Host rows that exist for this host (opacity, blur mode, and blur strength for Numeric). */
function hostRowCount(state: AppearanceHubState): number {
  if (!state.host) return 0;
  return BLUR_MODES[state.host.blurModeIndex] === 'Numeric' ? 3 : 2;
}

export function appearanceHubKey(state: AppearanceHubState, key: Key, configuration: PromptConfiguration, now = Date.now()): HubAction | undefined {
  if (state.view === 'motion') {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.view = 'hub'; state.selected = NMSH_ROWS.length - 1; return undefined; }
    if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + MOTION_ROWS.length) % MOTION_ROWS.length; state.previewStart = now; return undefined; }
    if (key.kind === 'text' && key.value.toLowerCase() === 'r') { state.previewStart = now; return undefined; }
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') {
      const row = MOTION_ROWS[state.selected]!;
      const current = configuration.motion[row.key] as string;
      const index = row.values.indexOf(current);
      const next = row.values[(index + (key.kind === 'left' ? -1 : 1) + row.values.length) % row.values.length]!;
      state.previewStart = now;
      return {kind: 'motion', motion: {...configuration.motion, [row.key]: next}};
    }
    return undefined;
  }
  const total = NMSH_ROWS.length + hostRowCount(state);
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + total) % total; return undefined; }
  if (state.selected < NMSH_ROWS.length) {
    if (key.kind !== 'enter' && key.kind !== 'right') return undefined;
    const row = NMSH_ROWS[state.selected]!;
    if (row.id === 'motion') { state.view = 'motion'; state.selected = 0; state.previewStart = now; return undefined; }
    return {kind: 'open', destination: row.id};
  }
  // Host rows: the existing opacity/blur editor, with Enter saving through the host integration.
  if (!state.host) return undefined;
  if (key.kind === 'enter') return state.hostDirty ? {kind: 'saveHost'} : undefined;
  state.host.selectedIndex = state.selected - NMSH_ROWS.length;
  if ((key.kind === 'left' || key.kind === 'right') && handleAppearanceKey(key, state.host)) {
    state.hostDirty = true;
    state.selected = NMSH_ROWS.length + Math.min(state.host.selectedIndex, hostRowCount(state) - 1);
  }
  return undefined;
}

/** The Motion screen's preview for the selected row, or undefined outside it. */
export function hubMotionPreview(state: AppearanceHubState, configuration: PromptConfiguration, columns: number, gate: MotionGate, now: number): MotionPreview | undefined {
  if (state.view !== 'motion') return undefined;
  const row = MOTION_ROWS[state.selected];
  return row ? renderMotionPreview(row.key, configuration.motion, gate, columns, state.previewStart ?? now - 10_000, now) : undefined;
}

export function renderAppearanceHub(state: AppearanceHubState, configuration: PromptConfiguration, columns: number, themeLabel: string, cursorBackend: string,
  preview?: {gate: MotionGate; now: number}): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const mark = (selected: boolean) => selected ? `${accent}${GLYPHS.selection}${reset}` : ' ';
  if (state.view === 'motion') {
    const rows = [`${primary}  Appearance › Motion${reset}`, `  ${subtle}General NMSh motion. Cursor motion lives in /cursor; Chroma color motion in /chroma. Reduced Motion and Decorative Effects Off stop all of it.${reset}`, ''];
    MOTION_ROWS.forEach((row, index) => {
      const selected = index === state.selected;
      const value = MOTION_LABELS[configuration.motion[row.key] as string] ?? configuration.motion[row.key];
      rows.push(`${mark(selected)} ${selected ? primary : secondary}${padCells(row.label, 24)}${reset}${selected ? `${accent}‹ ${value} ›${reset}` : `${secondary}${value}${reset}`}`);
    });
    rows.push('', `  ${subtle}${MOTION_ROWS[state.selected]?.note ?? ''}${reset}`);
    const shown = preview ? hubMotionPreview(state, configuration, columns, preview.gate, preview.now) : undefined;
    if (shown) rows.push('', `  ${subtle}Preview${reset}`, ...shown.rows);
    rows.push('', renderControls([['↑↓', 'select'], ['←→', 'change'], ...(shown ? [['R', 'replay'] as [string, string]] : []), ['Esc', 'back']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  const cursor = configuration.cursor;
  const motion = configuration.motion;
  const anyMotion = Object.values(motion).some(value => value !== 'off');
  const summaries: Record<string, string> = {
    prompt: `${themeLabel} · ${configuration.nmsh.textColors === 'neutral' ? 'Neutral text' : 'Theme text'}`,
    cursor: `${cursorLabel(cursor.shape)} · ${cursor.motion === 'off' ? 'no motion' : cursorLabel(cursor.motion)}${cursor.effect !== 'none' ? ` · ${cursorLabel(cursor.effect)}` : ''} · ${cursorBackend}`,
    chrome: configuration.uiChrome.source === 'theme' ? 'Follow theme' : 'Custom',
    chroma: configuration.presentation.preset === 'off' ? 'Off' : `${configuration.presentation.preset} · ${configuration.presentation.motion}`,
    motion: anyMotion ? `Launch ${MOTION_LABELS[motion.commandLaunch]} · Context ${MOTION_LABELS[motion.contextTransitions]} · Events ${MOTION_LABELS[motion.eventFeedback]}` : 'Off',
  };
  const rows = [`${primary}  Appearance${reset}`, `  ${subtle}Everything visual in one place; each row opens its own editor.${reset}`, '', `  ${subtle}NMSh${reset}`];
  NMSH_ROWS.forEach((row, index) => {
    const selected = index === state.selected;
    rows.push(`${mark(selected)}   ${selected ? primary : secondary}${padCells(row.label, 20)}${reset}${subtle}${summaries[row.id]}${reset}  ${selected ? `${accent}›${reset}` : ''}`);
  });
  rows.push('', `  ${subtle}Host window${reset}`, `    ${secondary}${padCells('Host', 20)}${reset}${primary}${state.hostName}${reset}`);
  if (state.host) {
    const bar = (fraction: number) => `${'█'.repeat(Math.round(fraction * 10))}${'░'.repeat(10 - Math.round(fraction * 10))}`;
    const hostRows = [['Opacity', `${bar(state.host.opacity)}  ${Math.round(state.host.opacity * 100)}%`], ['Blur mode', BLUR_MODES[state.host.blurModeIndex]!]];
    if (BLUR_MODES[state.host.blurModeIndex] === 'Numeric') hostRows.push(['Blur', `${bar(state.host.blurStrength / 50)}  ${state.host.blurStrength}`]);
    hostRows.forEach(([label, value], index) => {
      const selected = NMSH_ROWS.length + index === state.selected;
      rows.push(`${mark(selected)}   ${selected ? primary : secondary}${padCells(label!, 20)}${reset}${selected ? `${accent}‹ ${value} ›${reset}` : `${secondary}${value}${reset}`}`);
    });
    if (state.hostDirty) rows.push(`    ${subtle}Enter saves the host window settings${reset}`);
  } else rows.push(`    ${subtle}${state.hostGuidance ?? `Opacity and blur are controlled by ${state.hostName}.`}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', 'open'], ...(state.host ? [['←→', 'adjust host'] as [string, string]] : []), ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
