import type {Key} from '../terminal/keys.js';
import {createConfirm, handleConfirmKey, renderConfirm, type ConfirmState} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {colorLevel} from '../presentation/capabilities.js';
import {AWAKE_DISPLAY_LABELS, AWAKE_DISPLAYS, AWAKE_IDLE_AFTER, AWAKE_PLACEMENT_LABELS, AWAKE_PLACEMENTS, AWAKE_SAVER_POSITION_LABELS, AWAKE_SAVER_POSITIONS, type KeepAwakePresentation} from './presentation.js';
import {formatDuration, KEEP_AWAKE_MODES, MODE_DESCRIPTIONS, MODE_LABELS, unsupportedReason, type KeepAwakeController, type KeepAwakeMode, type StartResult} from './keepAwake.js';

/** The one Keep Awake surface behind /caffeinate, /awake and /zoomies. */
export interface KeepAwakePanel {
  /** Row focus: the four modes, then Duration and the presentation rows (PANEL_SETTINGS). */
  selected: number;
  /** Index into PANEL_DURATIONS used when a mode starts from the panel. */
  duration?: number;
  /** The slash command that opened the panel (/caffeinate, /awake or /zoomies); results are recorded under it. */
  command?: string;
  message?: string;
  /** A different mode is running: replacing it waits for this confirmation (default No). */
  confirm?: {state: ConfirmState; mode: KeepAwakeMode; timeoutSeconds?: number; from: KeepAwakeMode};
}

export function createKeepAwakePanel(controller: KeepAwakeController, message?: string): KeepAwakePanel {
  const status = controller.status();
  const index = status.state === 'running' ? KEEP_AWAKE_MODES.indexOf(status.record.mode) : 0;
  return {selected: Math.max(0, index), ...(message ?? (status.state === 'off' ? status.note : undefined) ? {message: message ?? (status.state === 'off' ? status.note : undefined)} : {})};
}

/** Panel durations; slash commands accept any strict duration (45s, 30m, 2h). */
export const PANEL_DURATIONS: ReadonlyArray<{label: string; seconds?: number}> = [
  {label: 'Until stopped'}, {label: '30 min', seconds: 1800}, {label: '1 hour', seconds: 3600}, {label: '2 hours', seconds: 7200}, {label: '4 hours', seconds: 14_400},
];

/** Rows after the modes, in panel order. Each cycles its value with ←→ or Enter. */
export const PANEL_SETTINGS = ['duration', 'placement', 'display', 'idleReminder', 'idleAfterSeconds', 'screensaver', 'screensaverPosition'] as const;
type PanelSetting = typeof PANEL_SETTINGS[number];
const ROW_COUNT = KEEP_AWAKE_MODES.length + PANEL_SETTINGS.length;

const cycle = <T>(list: readonly T[], value: T, step: number): T => list[(list.indexOf(value) + step + list.length) % list.length]!;

/** The next presentation settings for one row change; undefined for Duration (panel-local). */
function changeSetting(row: PanelSetting, settings: KeepAwakePresentation, step: number): KeepAwakePresentation | undefined {
  switch (row) {
    case 'duration': return undefined;
    case 'placement': return {...settings, placement: cycle(AWAKE_PLACEMENTS, settings.placement, step)};
    case 'display': return {...settings, display: cycle(AWAKE_DISPLAYS, settings.display, step)};
    case 'idleReminder': return {...settings, idleReminder: !settings.idleReminder};
    case 'idleAfterSeconds': return {...settings, idleAfterSeconds: cycle(AWAKE_IDLE_AFTER as readonly number[], settings.idleAfterSeconds, step)};
    case 'screensaver': return {...settings, screensaver: !settings.screensaver};
    case 'screensaverPosition': return {...settings, screensaverPosition: cycle(AWAKE_SAVER_POSITIONS, settings.screensaverPosition, step)};
  }
}

const seconds = (value: number) => value < 60 ? `${value} sec` : `${value / 60} min`;

/** One factual sentence for a start attempt. */
export function describeStart(result: StartResult): string {
  switch (result.kind) {
    case 'started': return `Keep Awake on · ${MODE_LABELS[result.record.mode]}${result.record.timeoutSeconds ? ` for ${formatDuration(result.record.timeoutSeconds)}` : ''}${result.replaced ? ` (replaced ${MODE_LABELS[result.replaced]})` : ''}. It keeps running after this window closes; /caffeinate stop ends it.`;
    case 'already': return `Already running · ${MODE_LABELS[result.record.mode]}.`;
    case 'needsConfirm': return `${MODE_LABELS[result.from]} is running. Change Keep Awake mode to ${MODE_LABELS[result.to]}?`;
    case 'unsupported': return result.reason;
    case 'failed': return result.reason;
  }
}

/** Start from the panel or a slash command; a different running mode asks first. */
export function requestStart(panel: KeepAwakePanel, controller: KeepAwakeController, mode: KeepAwakeMode, timeoutSeconds?: number): StartResult {
  const result = controller.start(mode, timeoutSeconds);
  if (result.kind === 'needsConfirm') panel.confirm = {state: createConfirm(), mode, from: result.from, ...(timeoutSeconds ? {timeoutSeconds} : {})};
  panel.message = describeStart(result);
  return result;
}

/**
 * What a key did. A finished action (started, already running, stopped) hands
 * the composer straight back with its one-line result: the assertion runs in
 * its own NMSh-owned process, so nothing here waits on it like a shell command.
 * Failures and the change confirmation stay in the panel.
 */
export type KeepAwakeKeyResult = 'close' | {done: string} | {settings: KeepAwakePresentation} | undefined;

const finished = (result: StartResult) => result.kind === 'started' || result.kind === 'already';

export function keepAwakeKey(panel: KeepAwakePanel, controller: KeepAwakeController, key: Key, settings?: KeepAwakePresentation): KeepAwakeKeyResult {
  if (panel.confirm) {
    const decision = handleConfirmKey(key, panel.confirm.state);
    if (decision === 'confirm') {
      const {mode, timeoutSeconds} = panel.confirm;
      panel.confirm = undefined;
      const result = controller.start(mode, timeoutSeconds, true);
      panel.message = describeStart(result);
      if (finished(result)) return {done: panel.message};
    } else if (decision === 'cancel') { panel.message = `Kept ${MODE_LABELS[panel.confirm.from]}. Nothing was changed.`; panel.confirm = undefined; }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'close';
  if (key.kind === 'up' || key.kind === 'down') { panel.selected = (panel.selected + (key.kind === 'up' ? ROW_COUNT - 1 : 1)) % ROW_COUNT; return undefined; }
  const row = PANEL_SETTINGS[panel.selected - KEEP_AWAKE_MODES.length];
  if (row && (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter')) {
    const step = key.kind === 'left' ? -1 : 1;
    if (row === 'duration') { panel.duration = ((panel.duration ?? 0) + step + PANEL_DURATIONS.length) % PANEL_DURATIONS.length; return undefined; }
    const next = settings && changeSetting(row, settings, step);
    return next ? {settings: next} : undefined;
  }
  if (key.kind === 'enter' && !row) {
    const result = requestStart(panel, controller, KEEP_AWAKE_MODES[panel.selected]!, PANEL_DURATIONS[panel.duration ?? 0]!.seconds);
    if (finished(result)) return {done: panel.message!};
  }
  else if (key.kind === 'text' && key.value.toLowerCase() === 's') return {done: controller.stop()};
  return undefined;
}

export function statusLines(controller: KeepAwakeController, now = Date.now()): string[] {
  const status = controller.status();
  const backend = controller.backend?.label ?? 'none';
  if (status.state === 'off') return ['Keep Awake', 'Off', `Backend    ${backend}`, ...(status.note ? [status.note] : [])];
  const record = status.record;
  const since = new Date(record.startedAt);
  const elapsed = Math.max(0, Math.round((now - record.startedAt) / 1000));
  return ['Keep Awake', 'Running', `Mode       ${MODE_LABELS[record.mode]}`, `Backend    ${backend}`,
    `Since      ${String(since.getHours()).padStart(2, '0')}:${String(since.getMinutes()).padStart(2, '0')}`, `Duration   ${formatDuration(Math.max(1, elapsed))}`,
    ...(record.timeoutSeconds ? [`Ends after ${formatDuration(record.timeoutSeconds)}`] : []), `PID        ${record.pid}`];
}

export function renderKeepAwakePanel(panel: KeepAwakePanel, controller: KeepAwakeController, columns: number, height: number, settings?: KeepAwakePresentation): string[] {
  const primary = foreground(UI_COLORS.primary), subtle = foreground(UI_COLORS.subtle), accent = foreground(UI_COLORS.accent), reset = '\u001b[0m';
  const status = controller.status();
  const rows = [`  ${primary}Keep Awake${reset}  ${subtle}/caffeinate · /awake · /zoomies${reset}`, ''];
  if (!controller.backend) rows.push(`  ${subtle}${unsupportedReason()}${reset}`);
  for (const [index, mode] of KEEP_AWAKE_MODES.entries()) {
    const supported = controller.supports(mode);
    const pointer = index === panel.selected ? `${accent}›${reset}` : ' ';
    const running = status.state === 'running' && status.record.mode === mode ? `  ${accent}● running${reset}` : '';
    rows.push(`  ${pointer} ${focusForeground(index === panel.selected)}${MODE_LABELS[mode].padEnd(8)}${reset} ${subtle}${supported ? MODE_DESCRIPTIONS[mode] : `Unavailable on ${controller.backend ? `the ${controller.backend.label}` : 'this system'}`}${reset}${running}`);
  }
  if (settings) {
    const value = (row: PanelSetting): string => {
      switch (row) {
        case 'duration': return PANEL_DURATIONS[panel.duration ?? 0]!.label;
        case 'placement': return AWAKE_PLACEMENT_LABELS[settings.placement];
        case 'display': return AWAKE_DISPLAY_LABELS[settings.display];
        case 'idleReminder': return settings.idleReminder ? 'On' : 'Off';
        case 'idleAfterSeconds': return seconds(settings.idleAfterSeconds);
        case 'screensaver': return settings.screensaver ? 'On' : 'Off';
        case 'screensaverPosition': return AWAKE_SAVER_POSITION_LABELS[settings.screensaverPosition];
      }
    };
    const LABELS: Record<PanelSetting, string> = {duration: 'Duration', placement: 'Placement', display: 'Display', idleReminder: 'Idle reminder',
      idleAfterSeconds: 'Idle after', screensaver: 'Show status', screensaverPosition: 'Position'};
    const line = (row: PanelSetting) => {
      const focused = panel.selected === KEEP_AWAKE_MODES.length + PANEL_SETTINGS.indexOf(row);
      return `  ${focused ? `${accent}›${reset}` : ' '} ${focusForeground(focused)}${LABELS[row].padEnd(15)}${reset} ${focused ? accent : subtle}${focused ? `‹ ${value(row)} ›` : value(row)}${reset}`;
    };
    rows.push(line('duration'), '', `  ${subtle}Presentation${reset}`, line('placement'), line('display'), line('idleReminder'), line('idleAfterSeconds'),
      '', `  ${subtle}Screensaver${reset}`, line('screensaver'), line('screensaverPosition'),
      '', `  ${subtle}Status Strip${reset}`, `    ${subtle}Shown automatically while active (when the Status Strip is on)${reset}`);
  }
  rows.push('', ...statusLines(controller).slice(1).map(line => `  ${subtle}${line === 'Off' || line === 'Running' ? `Current    ${line}` : line}${reset}`));
  for (const note of controller.backend?.notes ?? []) rows.push(`  ${subtle}${note}${reset}`);
  rows.push(`  ${subtle}Nothing in your power settings changes; Stop (or the timeout) ends it.${reset}`);
  if (panel.confirm) {
    rows.push('', `  ${primary}Change Keep Awake mode? ${MODE_LABELS[panel.confirm.from]} → ${MODE_LABELS[panel.confirm.mode]}${reset}`,
      `  ${renderConfirm(panel.confirm.state, {focused: true, color: colorLevel() !== 'none'})}`);
  } else if (panel.message) rows.push('', `  ${panel.message}`);
  rows.push('', renderControls(panel.confirm ? [['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]
    : panel.selected >= KEEP_AWAKE_MODES.length ? [['↑↓', 'row'], ['←→', 'change'], ['S', 'stop'], ['Esc', 'close']]
      : [['↑↓', 'row'], ['Enter', 'keep awake'], ['S', 'stop'], ['Esc', 'close']]));
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
