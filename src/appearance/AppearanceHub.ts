import type {Key} from '../terminal/keys.js';
import type {MotionSettings, PromptConfiguration} from '../prompt/configuration.js';
import {MOTION_ITEMS, MOTION_LABELS, MOTION_ROWS, MOTION_TUNING_ITEMS, type MotionItem} from '../motion/motionRows.js';
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
  view: 'hub' | 'motion' | 'motionAdvanced';
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

export function createAppearanceHub(hostName: string, host?: AppearanceState, hostGuidance?: string): AppearanceHubState {
  return {view: 'hub', selected: 0, ...(host ? {host} : {}), hostName, ...(hostGuidance ? {hostGuidance} : {}), hostDirty: false};
}

/** Host rows that exist for this host (opacity, blur mode, and blur strength for Numeric). */
function hostRowCount(state: AppearanceHubState): number {
  if (!state.host) return 0;
  return BLUR_MODES[state.host.blurModeIndex] === 'Numeric' ? 3 : 2;
}

export function appearanceHubKey(state: AppearanceHubState, key: Key, configuration: PromptConfiguration, now = Date.now()): HubAction | undefined {
  if (state.view === 'motion' || state.view === 'motionAdvanced') {
    const advanced = state.view === 'motionAdvanced';
    // The Motion list: Rendering, the five effects, then Advanced (a child screen with the selected rendering's own tuning).
    const items: readonly MotionItem[] = advanced ? MOTION_TUNING_ITEMS : MOTION_ITEMS;
    const count = items.length + (advanced ? 0 : 1);
    if (key.kind === 'escape' || key.kind === 'interrupt') {
      if (advanced) { state.view = 'motion'; state.selected = MOTION_ITEMS.length; state.previewStart = now; return undefined; }
      state.view = 'hub'; state.selected = NMSH_ROWS.length - 1; return undefined;
    }
    if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + count) % count; state.previewStart = now; return undefined; }
    if (key.kind === 'text' && key.value.toLowerCase() === 'r') { state.previewStart = now; return undefined; }
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') {
      const item = items[state.selected];
      if (!item) { if (key.kind !== 'left') { state.view = 'motionAdvanced'; state.selected = 0; state.previewStart = now; } return undefined; }
      const current = item.get(configuration.motion);
      const index = item.values.indexOf(current);
      const next = item.values[(index + (key.kind === 'left' ? -1 : 1) + item.values.length) % item.values.length]!;
      state.previewStart = now;
      return {kind: 'motion', motion: item.set(configuration.motion, next)};
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
  if (state.view !== 'motion' && state.view !== 'motionAdvanced') return undefined;
  const item = (state.view === 'motion' ? MOTION_ITEMS : MOTION_TUNING_ITEMS)[state.selected];
  return renderMotionPreview(item?.preview ?? 'commandLaunch', configuration.motion, gate, columns, state.previewStart ?? now - 10_000, now);
}

export function renderAppearanceHub(state: AppearanceHubState, configuration: PromptConfiguration, columns: number, themeLabel: string, cursorBackend: string,
  preview?: {gate: MotionGate; now: number}, height?: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const mark = (selected: boolean) => selected ? `${accent}${GLYPHS.selection}${reset}` : ' ';
  if (state.view === 'motion' || state.view === 'motionAdvanced') {
    const advanced = state.view === 'motionAdvanced';
    const rendering = configuration.motion.rendering === 'rich' ? 'Rich' : 'Clean';
    const items: readonly MotionItem[] = advanced ? MOTION_TUNING_ITEMS : MOTION_ITEMS;
    const head = [`${primary}  Appearance › Motion${advanced ? ` › Advanced (${rendering})` : ''}${reset}`, `  ${subtle}${advanced
      ? `Tuning for ${rendering} rendering only; ${rendering === 'Rich' ? 'Clean' : 'Rich'} keeps its own values.`
      : 'General NMSh motion. Cursor motion lives in /cursor; Chroma color motion in /chroma. Reduced Motion and Decorative Effects Off stop all of it.'}${reset}`, ''];
    const list: string[] = [];
    items.forEach((item, index) => {
      const selected = index === state.selected;
      const value = item.labelOf(item.get(configuration.motion));
      list.push(`${mark(selected)} ${selected ? primary : secondary}${padCells(item.label, 24)}${reset}${selected ? `${accent}‹ ${value} ›${reset}` : `${secondary}${value}${reset}`}`);
    });
    if (!advanced) {
      const selected = state.selected === items.length;
      list.push(`${mark(selected)} ${selected ? primary : secondary}${padCells('Advanced', 24)}${reset}${selected ? accent : secondary}${rendering} tuning ›${reset}`);
    }
    const noteText = items[state.selected]?.note ?? `Intensity and speed for ${rendering} rendering; Enter opens them`;
    const note = ['', `  ${subtle}${noteText}${reset}`];
    const shown = preview ? hubMotionPreview(state, configuration, columns, preview.gate, preview.now) : undefined;
    const controls = ['', renderControls([['↑↓', 'select'], ['←→', 'change'], ...(!advanced && state.selected === items.length ? [['Enter', 'open'] as [string, string]] : []), ...(shown ? [['R', 'replay'] as [string, string]] : []), ['Esc', 'back']])];
    // The preview is always the same size; a short terminal gives up the intro, then the preview, never the controls or the list.
    const block = shown ? ['', `  ${subtle}Preview · ${rendering}${reset}`, ...shown.rows] : [];
    const layouts = [[...head, ...list, ...note, ...block, ...controls], [head[0]!, ...list, ...note, ...block, ...controls], [head[0]!, ...list, ...note, ...controls], [head[0]!, ...list, ...controls], [...list, ...controls]];
    const rows = height === undefined ? layouts[0]! : layouts.find(layout => layout.length <= height) ?? layouts[layouts.length - 1]!;
    return rows.map(row => truncateAnsi(row, columns));
  }
  const cursor = configuration.cursor;
  const motion = configuration.motion;
  const anyMotion = MOTION_ROWS.some(row => motion[row.key] !== 'off');
  const summaries: Record<string, string> = {
    prompt: `${themeLabel} · ${configuration.nmsh.textColors === 'neutral' ? 'Neutral text' : 'Theme text'}`,
    cursor: `${cursorLabel(cursor.shape)} · ${cursor.motion === 'off' ? 'no motion' : cursorLabel(cursor.motion)}${cursor.effect !== 'none' ? ` · ${cursorLabel(cursor.effect)}` : ''} · ${cursorBackend}`,
    chrome: configuration.uiChrome.source === 'theme' ? 'Follow theme' : 'Custom',
    chroma: configuration.presentation.preset === 'off' ? 'Off' : `${configuration.presentation.preset} · ${configuration.presentation.motion}`,
    motion: anyMotion ? `${motion.rendering === 'rich' ? 'Rich' : 'Clean'} · Launch ${MOTION_LABELS[motion.commandLaunch]} · Context ${MOTION_LABELS[motion.contextTransitions]} · Events ${MOTION_LABELS[motion.eventFeedback]}` : 'Off',
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
