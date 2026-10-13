import type {Key} from '../../terminal/keys.js';
import {displayText} from '../transcript/projection.js';
import {currentModel, effortStatus, modelName, modelOption, sameModel, type AgentTelemetry} from '../telemetry.js';

/**
 * NMSh's own /model and /effort pickers for a managed target. Rows come only from what the provider published (its
 * model catalog and each model's supported effort levels); applying one is a real control request whose result the
 * host reports. Nothing here is forwarded to the provider's prompt, and nothing claims a change the provider did not
 * acknowledge.
 */
export type PickerKind = 'model' | 'effort';

export interface PickerRow {
  /** What is sent: a model value, an effort level, or null for the model's default effort. */
  value: string | null;
  label: string;
  detail?: string;
  current?: boolean;
  isDefault?: boolean;
}

export interface PickerState {
  kind: PickerKind;
  rows: PickerRow[];
  selected: number;
  query: string;
  /** The current value in words, with where it comes from. */
  status: string;
  /** When the change takes effect, said before it is made. */
  timing: string;
  busy?: boolean;
  message?: string;
}

/** Why a picker cannot open, in words; or the picker. */
export type PickerOpen = {ok: true; picker: PickerState} | {ok: false; reason: string};

export function openModelPicker(telemetry: AgentTelemetry | undefined): PickerOpen {
  const models = telemetry?.catalog?.models ?? [];
  if (!telemetry || !models.length) return {ok: false, reason: 'Claude has not published its model list for this target yet. Try again once it has started.'};
  const current = currentModel(telemetry);
  const exact = current ? models.findIndex(item => item.value === current.value && item.value !== 'default') : -1;
  // One row is "current": the exact value asked for, else the first alias that resolves to the running model.
  const currentIndex = exact >= 0 ? exact : current ? models.findIndex(item => item.value !== 'default' && sameModel(item.value, current.value, telemetry)) : -1;
  const rows = models.slice(0, 32).map((item, index): PickerRow => ({value: item.value, label: displayText(item.name).slice(0, 60),
    ...(item.description ? {detail: displayText(item.description).slice(0, 160)} : {}),
    ...(index === currentIndex ? {current: true} : {}), ...(item.value === 'default' ? {isDefault: true} : {})}));
  const status = !current ? 'Model not reported yet'
    : current.source === 'provider' ? `Running ${modelName(current.value, telemetry)} · reported by Claude`
      : `${modelName(current.value, telemetry)} requested · Claude confirms it on its next model call`;
  return {ok: true, picker: {kind: 'model', rows, selected: Math.max(0, currentIndex), query: '', status, timing: 'Applies from Claude\'s next model call, mid-turn included; the conversation continues.'}};
}

export function openEffortPicker(telemetry: AgentTelemetry | undefined, settingsEffort?: string): PickerOpen {
  if (!telemetry?.catalog?.models.length) return {ok: false, reason: 'Claude has not published its models and their effort levels for this target yet.'};
  const model = currentModel(telemetry)?.value;
  const option = modelOption(telemetry, model);
  if (!option) return {ok: false, reason: 'The running model is not reported yet, so its effort levels are unknown. Send a message first.'};
  const levels = option.effortLevels ?? [];
  if (!levels.length) return {ok: false, reason: `${displayText(option.name)} has no effort levels to choose from.`};
  const status = effortStatus(telemetry, settingsEffort);
  const currentValue = status.state === 'default' ? null : status.value;
  const rows: PickerRow[] = [{value: null, label: 'Model default', detail: `Clears NMSh's choice; ${displayText(option.name)} uses its own default level`, isDefault: true, ...(currentValue === null ? {current: true} : {})},
    ...levels.slice(0, 8).map(level => ({value: level, label: level, ...(level === currentValue ? {current: true} : {}), ...(level === 'max' ? {detail: 'Highest effort; uses the most tokens'} : {})}))];
  return {ok: true, picker: {kind: 'effort', rows, selected: Math.max(0, rows.findIndex(row => row.current)), query: '',
    status: `Effort: ${status.words}`, timing: 'Applies from the next turn, for this session only; Claude\'s settings files are not changed.'}};
}

/** Rows matching the typed filter (name, value or description). */
export function visibleRows(picker: PickerState): PickerRow[] {
  const query = picker.query.toLowerCase();
  return query ? picker.rows.filter(row => `${row.label} ${row.value ?? ''} ${row.detail ?? ''}`.toLowerCase().includes(query)) : picker.rows;
}

/** A typed argument (`/model sonnet`, `/effort high`, `/effort default`) as one row, only on an exact match. */
export function pickerArgument(picker: PickerState, argument: string): PickerRow | undefined {
  const wanted = argument.trim().toLowerCase();
  if (!wanted) return undefined;
  if (picker.kind === 'effort' && (wanted === 'default' || wanted === 'auto')) return picker.rows.find(row => row.value === null);
  return picker.rows.find(row => row.value?.toLowerCase() === wanted || row.label.toLowerCase() === wanted);
}

/** One key in the picker: move, filter, apply or close. Typing filters; nothing applies until Enter. */
export function pickerKey(picker: PickerState, key: Key): 'apply' | 'close' | undefined {
  if (picker.busy) return key.kind === 'escape' || key.kind === 'interrupt' ? 'close' : undefined;
  const rows = visibleRows(picker);
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (picker.query) { picker.query = ''; picker.selected = 0; return undefined; }
    return 'close';
  }
  if (key.kind === 'up' || key.kind === 'down') { picker.selected = Math.max(0, Math.min(rows.length - 1, picker.selected + (key.kind === 'up' ? -1 : 1))); return undefined; }
  if (key.kind === 'pageUp' || key.kind === 'pageDown') { picker.selected = key.kind === 'pageUp' ? 0 : Math.max(0, rows.length - 1); return undefined; }
  if (key.kind === 'enter') return rows[picker.selected] ? 'apply' : undefined;
  if (key.kind === 'backspace') { picker.query = [...picker.query].slice(0, -1).join(''); picker.selected = 0; return undefined; }
  if ((key.kind === 'text' || key.kind === 'paste') && !/[\u0000-\u001f]/u.test(key.value)) {
    picker.query = (picker.query + key.value).slice(0, 40); picker.selected = 0; picker.message = undefined; return undefined;
  }
  return undefined;
}

/** The row Enter would apply. */
export function selectedRow(picker: PickerState): PickerRow | undefined {
  return visibleRows(picker)[picker.selected];
}
