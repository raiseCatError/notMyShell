import type {Key} from '../terminal/keys.js';
import {createConfirm, handleConfirmKey, renderConfirm, type ConfirmState} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {colorLevel} from '../presentation/capabilities.js';
import {formatDuration, KEEP_AWAKE_MODES, MODE_DESCRIPTIONS, MODE_LABELS, unsupportedReason, type KeepAwakeController, type KeepAwakeMode, type StartResult} from './keepAwake.js';

/** The one Keep Awake surface behind /caffeinate, /awake and /zoomies. */
export interface KeepAwakePanel {
  selected: number;
  message?: string;
  /** A different mode is running: replacing it waits for this confirmation (default No). */
  confirm?: {state: ConfirmState; mode: KeepAwakeMode; timeoutSeconds?: number; from: KeepAwakeMode};
}

export function createKeepAwakePanel(controller: KeepAwakeController, message?: string): KeepAwakePanel {
  const status = controller.status();
  const index = status.state === 'running' ? KEEP_AWAKE_MODES.indexOf(status.record.mode) : 0;
  return {selected: Math.max(0, index), ...(message ?? (status.state === 'off' ? status.note : undefined) ? {message: message ?? (status.state === 'off' ? status.note : undefined)} : {})};
}

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
export function requestStart(panel: KeepAwakePanel, controller: KeepAwakeController, mode: KeepAwakeMode, timeoutSeconds?: number): void {
  const result = controller.start(mode, timeoutSeconds);
  if (result.kind === 'needsConfirm') panel.confirm = {state: createConfirm(), mode, from: result.from, ...(timeoutSeconds ? {timeoutSeconds} : {})};
  panel.message = describeStart(result);
}

export function keepAwakeKey(panel: KeepAwakePanel, controller: KeepAwakeController, key: Key): 'close' | undefined {
  if (panel.confirm) {
    const decision = handleConfirmKey(key, panel.confirm.state);
    if (decision === 'confirm') { const {mode, timeoutSeconds} = panel.confirm; panel.confirm = undefined; panel.message = describeStart(controller.start(mode, timeoutSeconds, true)); }
    else if (decision === 'cancel') { panel.message = `Kept ${MODE_LABELS[panel.confirm.from]}. Nothing was changed.`; panel.confirm = undefined; }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'close';
  if (key.kind === 'up' || key.kind === 'down') panel.selected = (panel.selected + (key.kind === 'up' ? KEEP_AWAKE_MODES.length - 1 : 1)) % KEEP_AWAKE_MODES.length;
  else if (key.kind === 'enter') requestStart(panel, controller, KEEP_AWAKE_MODES[panel.selected]!);
  else if (key.kind === 'text' && key.value.toLowerCase() === 's') panel.message = controller.stop();
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

export function renderKeepAwakePanel(panel: KeepAwakePanel, controller: KeepAwakeController, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary), subtle = foreground(UI_COLORS.subtle), accent = foreground(UI_COLORS.accent), reset = '\u001b[0m';
  const status = controller.status();
  const rows = [`  ${primary}Keep Awake${reset}  ${subtle}/caffeinate · /awake · /zoomies${reset}`, ''];
  if (!controller.backend) rows.push(`  ${subtle}${unsupportedReason()}${reset}`);
  for (const [index, mode] of KEEP_AWAKE_MODES.entries()) {
    const supported = controller.supports(mode);
    const pointer = index === panel.selected ? `${accent}›${reset}` : ' ';
    const running = status.state === 'running' && status.record.mode === mode ? `  ${accent}● running${reset}` : '';
    rows.push(`  ${pointer} ${primary}${MODE_LABELS[mode].padEnd(8)}${reset} ${subtle}${supported ? MODE_DESCRIPTIONS[mode] : `Unavailable on ${controller.backend ? `the ${controller.backend.label}` : 'this system'}`}${reset}${running}`);
  }
  rows.push('', ...statusLines(controller).slice(1).map(line => `  ${subtle}${line === 'Off' || line === 'Running' ? `Current    ${line}` : line}${reset}`));
  for (const note of controller.backend?.notes ?? []) rows.push(`  ${subtle}${note}${reset}`);
  rows.push(`  ${subtle}Nothing in your power settings changes; Stop (or the timeout) ends it.${reset}`);
  if (panel.confirm) {
    rows.push('', `  ${primary}Change Keep Awake mode? ${MODE_LABELS[panel.confirm.from]} → ${MODE_LABELS[panel.confirm.mode]}${reset}`,
      `  ${renderConfirm(panel.confirm.state, {focused: true, color: colorLevel() !== 'none'})}`);
  } else if (panel.message) rows.push('', `  ${panel.message}`);
  rows.push('', renderControls(panel.confirm ? [['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]
    : [['↑↓', 'mode'], ['Enter', 'keep awake'], ['S', 'stop'], ['Esc', 'close']]));
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
