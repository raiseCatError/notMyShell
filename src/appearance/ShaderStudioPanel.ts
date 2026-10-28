/**
 * The one shader studio panel shared by every host (/appearance › Kitty
 * shaders, /appearance › Ghostty shaders): choose effects, tune the settings
 * each really exposes, order them, and review the exact host change before
 * anything is written. Host differences (wording, Kitty's placement, Ghostty's
 * reload confirmation) come from a small host description; host-specific
 * shader compilation stays in each host's own module. The draft is the panel's
 * own until a reviewed plan is confirmed; Esc discards it.
 */
import type {Key} from '../terminal/keys.js';
import {renderControlRows, renderControls} from '../ui/controls.js';
import {checkMark, GLYPHS} from '../ui/glyphs.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {stripTerminalControls} from '../util/terminalControls.js';
import {CATEGORY_LABELS, type OfferedParam, type PresetCategory, type ShaderValue} from './kittyShaderCatalog.js';
import type {KittyShaderEffect} from './kittyShaderSettings.js';
import {PREVIEW_MS, previewKind, previewValues, renderShaderPreview} from './shaderPreview.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import type {RgbColor} from '../ui/palette.js';

/** The sample terminal's colors: NMSh's UI text on a neutral dark sample background. */
export function studioPreviewContext(now: number, still: boolean, color: boolean, level?: ColorLevel): StudioPreviewContext {
  return {now, still, color, ...(level ? {level} : {}), colors: {background: {red: 22, green: 22, blue: 28}, foreground: UI_COLORS.primary, accent: UI_COLORS.accent, cursor: UI_COLORS.accent}};
}

/** What the app knows when drawing a studio preview. */
export interface StudioPreviewContext {now: number; still: boolean; color: boolean; level?: ColorLevel; colors: {background: RgbColor; foreground: RgbColor; accent: RgbColor; cursor: RgbColor}}

export interface StudioPreset {definition: {id: string; label: string; category: PresetCategory; exclusive?: string; note?: string}; params: OfferedParam[]; missing: string[]}
export interface StudioCatalog {version: string; supported: boolean; reason?: string; offered: readonly StudioPreset[]; notOffered: readonly string[]}
export interface StudioInspection {userEntries: string[]; configured: boolean; drifted: boolean; activePresets: string[]; problems: string[]}
export interface StudioPlan {preview: string[]; guidance: string}
export interface StudioDraft {effects: KittyShaderEffect[]; placement?: 'after' | 'before'}

export interface ShaderStudioState<C extends StudioCatalog, I extends StudioInspection, P extends StudioPlan, G, D extends StudioDraft> {
  catalog?: C;
  inspection?: I;
  draft: D;
  /** The draft differs from the saved (last reviewed) settings. */
  dirty: boolean;
  selected: number;
  gates: G;
  confirmation?: {plan: P; offset: number};
  colorInput?: {preset: string; param: string; text: string};
  message?: string;
  /** Ghostty: a trail Ghostty may still draw until its configuration is reloaded (L confirms the reload). */
  reloadPending?: string;
  /** The preview's current run: restarted when the selected preset or its values change, or on P. */
  previewStart?: number;
  previewKey?: string;
  /** The last drawn preview is still animating (the app keeps a frame clock only while true). */
  previewBusy?: boolean;
}

export interface StudioHost<G> {
  /** "Kitty", "Ghostty". */
  name: string;
  /** Kitty can place NMSh's pipeline before or after the person's; Ghostty always runs NMSh's passes after. */
  placement: boolean;
  intro(catalog: StudioCatalog): string;
  unsupportedHint: string;
  status(inspection: StudioInspection): string;
  userShaders(inspection: StudioInspection): string;
  gate(gates: G): string | undefined;
  placementNote: string;
  noParams: string;
  /** Ghostty: L confirms a config reload. */
  reloadKey?: boolean;
}

export type StudioAction = {kind: 'back'} | {kind: 'review'} | {kind: 'remove'} | {kind: 'confirm'} | {kind: 'reloaded'};

type Row = {kind: 'placement'} | {kind: 'preset'; preset: StudioPreset} | {kind: 'param'; preset: StudioPreset; param: OfferedParam};
type AnyState = ShaderStudioState<StudioCatalog, StudioInspection, StudioPlan, unknown, StudioDraft>;
const CATEGORY_ORDER: readonly PresetCategory[] = ['cursor', 'ambient', 'interaction', 'focus', 'display'];

export function createShaderStudio<C extends StudioCatalog, I extends StudioInspection, P extends StudioPlan, G, D extends StudioDraft>(saved: D, gates: G): ShaderStudioState<C, I, P, G, D> {
  return {draft: structuredClone(saved), dirty: false, selected: 0, gates};
}

const effectOf = (state: AnyState, id: string) => state.draft.effects.find(effect => effect.id === id);
const enabled = (state: AnyState, id: string) => effectOf(state, id)?.enabled === true;

/** Selectable rows: Placement (Kitty), then presets by category, each enabled preset followed by its parameters. */
function rows(state: AnyState, host: StudioHost<unknown>): Row[] {
  const offered = state.catalog?.offered ?? [];
  const list: Row[] = host.placement ? [{kind: 'placement'}] : [];
  for (const category of CATEGORY_ORDER) {
    for (const preset of offered.filter(item => item.definition.category === category)) {
      list.push({kind: 'preset', preset});
      if (enabled(state, preset.definition.id)) for (const param of preset.params) list.push({kind: 'param', preset, param});
    }
  }
  return list;
}

export function studioParamValue(state: AnyState, preset: StudioPreset, param: OfferedParam): ShaderValue {
  return effectOf(state, preset.definition.id)?.values[param.name] ?? param.default;
}

export const colorHex = (value: ShaderValue) => Array.isArray(value) ? `#${value.slice(0, 3).map(part => Math.round(Math.min(1, Math.max(0, part)) * 255).toString(16).padStart(2, '0')).join('')}` : '';
export const steppedValue = (value: number, param: OfferedParam, direction: number) => {
  const step = param.step ?? 0.01;
  const next = Math.round((value + direction * step) / step) * step;
  const places = (String(step).split('.')[1] ?? '').length;
  return Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, Number(next.toFixed(places))));
};

export function displayParam(param: OfferedParam, value: ShaderValue): string {
  if (param.kind === 'bool') return value ? 'On' : 'Off';
  if (param.kind === 'color') return colorHex(value);
  if (param.kind === 'choice') return param.choices?.find(([choice]) => choice === value)?.[1] ?? String(value);
  const places = (String(param.step ?? 0.01).split('.')[1] ?? '').length;
  return typeof value === 'number' ? value.toFixed(places) : String(value);
}

function ensure(state: AnyState, id: string): KittyShaderEffect {
  let effect = effectOf(state, id);
  if (!effect) { effect = {id, enabled: false, values: {}}; state.draft.effects.push(effect); }
  return effect;
}

function setValue(state: AnyState, preset: StudioPreset, param: OfferedParam, value: ShaderValue): void {
  ensure(state, preset.definition.id).values[param.name] = value;
  state.dirty = true;
}

function toggle(state: AnyState, preset: StudioPreset): void {
  const effect = ensure(state, preset.definition.id);
  effect.enabled = !effect.enabled;
  // One choice per exclusive group (one cursor trail; one focus-highlight shader).
  if (effect.enabled && preset.definition.exclusive) {
    for (const other of state.catalog?.offered ?? []) {
      if (other !== preset && other.definition.exclusive === preset.definition.exclusive) { const item = effectOf(state, other.definition.id); if (item) item.enabled = false; }
    }
  }
  state.dirty = true;
}

/** Move an enabled effect one place earlier or later in NMSh's pass order. */
function move(state: AnyState, id: string, direction: -1 | 1): void {
  const order = state.draft.effects.filter(effect => effect.enabled);
  const index = order.findIndex(effect => effect.id === id);
  const target = order[index + direction];
  if (index < 0 || !target) return;
  const all = state.draft.effects;
  const a = all.findIndex(effect => effect.id === id);
  const b = all.findIndex(effect => effect.id === target.id);
  [all[a], all[b]] = [all[b]!, all[a]!];
  state.dirty = true;
}

export function shaderStudioKey<G>(state: ShaderStudioState<StudioCatalog, StudioInspection, StudioPlan, G, StudioDraft>, key: Key, host: StudioHost<G>): StudioAction | undefined {
  const any = state as AnyState;
  if (state.confirmation) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.confirmation = undefined; state.message = 'Nothing was changed.'; return undefined; }
    if (key.kind === 'up' || key.kind === 'down') state.confirmation.offset = Math.max(0, Math.min(state.confirmation.plan.preview.length - 1, state.confirmation.offset + (key.kind === 'up' ? -1 : 1)));
    return key.kind === 'enter' ? {kind: 'confirm'} : undefined;
  }
  if (state.colorInput) {
    const input = state.colorInput;
    if (key.kind === 'escape' || key.kind === 'interrupt') state.colorInput = undefined;
    else if (key.kind === 'backspace') input.text = input.text.slice(0, -1);
    else if (key.kind === 'text') input.text = (input.text + key.value.replace(/[^#0-9a-f]/giu, '')).slice(0, 7);
    else if (key.kind === 'enter') {
      const preset = state.catalog?.offered.find(item => item.definition.id === input.preset);
      const param = preset?.params.find(item => item.name === input.param);
      if (!preset || !param) { state.colorInput = undefined; return undefined; }
      if (!/^#?[0-9a-f]{6}$/iu.test(input.text)) { state.message = 'Enter six RGB digits, such as #3399ff.'; return undefined; }
      const digits = input.text.replace(/^#/u, '');
      const rgb = [0, 2, 4].map(offset => Number((parseInt(digits.slice(offset, offset + 2), 16) / 255).toFixed(3)));
      const current = studioParamValue(any, preset, param);
      setValue(any, preset, param, param.type === 'float4' ? [...rgb, Array.isArray(current) ? current[3] ?? 1 : 1] : rgb);
      state.colorInput = undefined;
    }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'back'};
  // Removal needs no catalog: it works on an unsupported or downgraded host too.
  if (key.kind === 'text' && key.value.toLowerCase() === 'r' && state.catalog) return {kind: 'remove'};
  if (host.reloadKey && key.kind === 'text' && key.value.toLowerCase() === 'l' && state.reloadPending) return {kind: 'reloaded'};
  if (key.kind === 'text' && key.value.toLowerCase() === 'p') { state.previewStart = undefined; state.previewKey = undefined; return undefined; }
  if (!state.catalog?.supported) return undefined;
  const list = rows(any, host as StudioHost<unknown>);
  if (!list.length) return undefined;
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + list.length) % list.length; return undefined; }
  if (key.kind === 'text' && key.value.toLowerCase() === 's') return {kind: 'review'};
  const row = list[Math.min(state.selected, list.length - 1)]!;
  state.message = undefined;
  if (row.kind === 'placement') {
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') { state.draft.placement = state.draft.placement === 'after' ? 'before' : 'after'; state.dirty = true; }
    return undefined;
  }
  if (row.kind === 'preset') {
    if (key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) toggle(any, row.preset);
    else if (key.kind === 'selectUp' || key.kind === 'selectDown') move(any, row.preset.definition.id, key.kind === 'selectUp' ? -1 : 1);
    return undefined;
  }
  const {preset, param} = row;
  const value = studioParamValue(any, preset, param);
  if (param.kind === 'color') { if (key.kind === 'enter') state.colorInput = {preset: preset.definition.id, param: param.name, text: ''}; return undefined; }
  if (key.kind !== 'left' && key.kind !== 'right' && key.kind !== 'enter') return undefined;
  const direction = key.kind === 'left' ? -1 : 1;
  if (param.kind === 'bool') setValue(any, preset, param, !value);
  else if (param.kind === 'choice') {
    const choices = param.choices ?? [];
    const index = choices.findIndex(([choice]) => choice === value);
    setValue(any, preset, param, choices[(index + direction + choices.length) % choices.length]![0]);
  } else if (typeof value === 'number' && key.kind !== 'enter') setValue(any, preset, param, steppedValue(value, param, direction));
  return undefined;
}

export function renderShaderStudio<G>(state: ShaderStudioState<StudioCatalog, StudioInspection, StudioPlan, G, StudioDraft>, host: StudioHost<G>, columns: number, height?: number,
  preview?: StudioPreviewContext): string[] {
  state.previewBusy = false;
  const any = state as AnyState;
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const clean = (text: string) => stripTerminalControls(text);
  if (state.confirmation) {
    const review = state.confirmation;
    const available = Math.max(1, (height ?? 24) - 7);
    return [`${primary}  Review ${host.name} shader configuration${reset}`, '  Enter confirms exactly this plan; Esc keeps every file unchanged.',
      ...review.plan.preview.slice(review.offset, review.offset + available).map(line => `  ${clean(line)}`), '', `  ${subtle}${clean(review.plan.guidance)}${reset}`,
      renderControls([['↑↓', 'scroll'], ['Enter', 'confirm write'], ['Esc', 'cancel']])].map(row => truncateAnsi(row, columns));
  }
  const head = [`${primary}  Appearance › ${host.name} shaders${reset}`];
  const reload = state.reloadPending ? [`  ${secondary}${host.name} may still draw NMSh’s previous trail until you reload its configuration; Portable motion waits. Press L once you have reloaded.${reset}`] : [];
  const catalog = state.catalog;
  if (!catalog) return [...head, '', `  ${subtle}Reading ${host.name}’s shader support…${reset}`, '', renderControls([['Esc', 'back']])].map(row => truncateAnsi(row, columns));
  if (!catalog.supported) {
    return [...head, '', `  ${secondary}${clean(catalog.reason ?? `${host.name} custom shaders are not available.`)}${reset}`,
      `  ${subtle}${host.unsupportedHint}${reset}`, ...reload, ...(state.inspection?.configured ? [`  ${subtle}R reviews removal of NMSh’s existing ${host.name} shader files.${reset}`] : []),
      '', renderControls([['Esc', 'back'], ...(state.inspection?.configured ? [['R', 'remove'] as [string, string]] : []), ...(reload.length ? [['L', 'reloaded'] as [string, string]] : [])])].map(row => truncateAnsi(row, columns));
  }
  const inspection = state.inspection;
  const gate = host.gate(state.gates);
  const intro = [`  ${subtle}${clean(host.intro(catalog))}${reset}`,
    `  ${subtle}${inspection ? clean(host.status(inspection)) : `Reading ${host.name}’s configuration…`}${reset}`,
    `  ${subtle}${inspection ? clean(host.userShaders(inspection)) : ''}${reset}`,
    ...(gate ? [`  ${secondary}${gate}${reset}`] : []), ...reload];
  const list = rows(any, host as StudioHost<unknown>);
  const selected = Math.min(state.selected, Math.max(0, list.length - 1));
  const mark = (active: boolean) => active ? `${accent}${GLYPHS.selection}${reset}` : ' ';
  const order = state.draft.effects.filter(effect => effect.enabled).map(effect => effect.id);
  const body: string[] = [];
  let category: PresetCategory | undefined;
  list.forEach((row, index) => {
    const active = index === selected;
    if (row.kind === 'placement') {
      const value = state.draft.placement === 'after' ? 'After your shaders' : 'Before your shaders';
      body.push('', `${mark(active)}   ${focusForeground(active)}${padCells('Placement', 24)}${reset}${active ? `${accent}‹ ${value} ›${reset}` : `${secondary}${value}${reset}`}`);
      return;
    }
    if (row.kind === 'preset') {
      if (row.preset.definition.category !== category) {
        category = row.preset.definition.category;
        body.push(...(host.placement || body.length ? [] : ['']), `  ${subtle}${CATEGORY_LABELS[category]}${category === 'cursor' ? ' (one)' : ''}${reset}`);
      }
      const on = enabled(any, row.preset.definition.id);
      const position = on && order.length > 1 ? `  ${subtle}#${order.indexOf(row.preset.definition.id) + 1}${reset}` : '';
      body.push(`${mark(active)}   ${on ? accent : subtle}${checkMark(on)}${reset} ${focusForeground(active)}${row.preset.definition.label}${reset}${position}`);
      return;
    }
    const value = displayParam(row.param, studioParamValue(any, row.preset, row.param));
    const editing = state.colorInput && state.colorInput.preset === row.preset.definition.id && state.colorInput.param === row.param.name;
    const shown = editing ? `RGB: ${state.colorInput!.text}_` : value;
    body.push(`${mark(active)}       ${focusForeground(active)}${padCells(row.param.label, 20)}${reset}${active && !editing && row.param.kind !== 'color' ? `${accent}‹ ${shown} ›${reset}` : `${secondary}${shown}${reset}`}`);
  });
  const current = list[selected];
  const preset = current && current.kind !== 'placement' ? current.preset : undefined;
  const note = current?.kind === 'placement' ? host.placementNote
    : preset ? [preset.definition.note, !preset.params.length && !preset.definition.note ? host.noParams : undefined,
      preset.missing.length ? `Not offered here: ${preset.missing.join(', ')} (the installed shader does not declare them as NMSh expects).` : undefined,
      current?.kind === 'param' && current.param.kind === 'color' ? 'Enter types an RGB color.' : undefined].filter(Boolean).join(' ') : '';
  // An approximate preview of the selected preset, drawn by NMSh in cells (never claimed to be the host's GPU output).
  const kind = preset ? previewKind(preset.definition.id, preset.definition.category) : undefined;
  const sample: string[] = [];
  if (preview && preset && columns >= 22) {
    const values = Object.fromEntries(preset.params.map(param => [param.name, studioParamValue(any, preset, param)]));
    const key = `${preset.definition.id}:${JSON.stringify(values)}`;
    if (state.previewKey !== key) { state.previewKey = key; state.previewStart = preview.now; }
    const label = `  ${subtle}Preview · ${preset.definition.label} · approximate, drawn by NMSh; ${host.name}’s GPU shader is the real effect${reset}`;
    if (!preview.color) sample.push('', `  ${subtle}Preview needs color (NO_COLOR or a monochrome terminal).${reset}`);
    else if (!kind) sample.push('', `  ${subtle}No preview for ${preset.definition.label}: NMSh would only be guessing at it.${reset}`);
    else {
      const frame = renderShaderPreview({kind, values: previewValues(preset.definition.id, values), width: Math.min(48, columns - 6), elapsed: preview.now - (state.previewStart ?? preview.now),
        still: preview.still, colors: preview.colors, ...(preview.level ? {level: preview.level} : {})});
      state.previewBusy = frame.busy;
      sample.push('', label, ...frame.rows.map(row => `    ${row}`), ...(preview.still ? [`  ${subtle}Still frame (Reduced Motion or Effects Off).${reset}`] : []));
    }
  }
  const replayable = Boolean(preview && kind && preview.color && !preview.still && PREVIEW_MS[kind] > 0);
  const footerFor = (replay: boolean) => [
    ...(note ? ['', `  ${subtle}${clean(note)}${reset}`] : []),
    ...(catalog.notOffered.length ? [`  ${subtle}${host.placement ? 'Installed, not offered yet' : 'Not available in this version'}: ${clean(catalog.notOffered.join(', '))}${reset}`] : []),
    ...(inspection?.problems.length ? [`  ${secondary}${clean(inspection.problems[0]!)}${reset}`] : []),
    ...(state.message ? [`  ${secondary}${clean(state.message)}${reset}`] : []),
    // Narrow terminals wrap the controls at control boundaries rather than cutting off Esc.
    '', ...renderControlRows([['↑↓', 'select'], ['Enter', current?.kind === 'preset' ? 'on/off' : 'change'], ['←→', 'adjust'], ['⇧↑↓', 'order'], ['S', 'review'], ['R', 'remove'],
      ...(reload.length ? [['L', 'reloaded'] as [string, string]] : []), ...(replay ? [['P', 'replay'] as [string, string]] : []), ['Esc', 'back']], Math.max(20, columns - 2)),
  ];
  // Not enough room for the preview: the list and controls win; the preview is dropped (not cut), its replay hint goes,
  // and its run starts again once it can be seen.
  const previewFits = height === undefined || head.length + intro.length + body.length + sample.length + footerFor(replayable && sample.length > 0).length <= height;
  if (!previewFits && sample.length) { sample.length = 0; state.previewBusy = false; state.previewKey = undefined; state.previewStart = undefined; }
  const footer = footerFor(replayable && sample.length > 0);
  const all = [...head, ...intro, ...body, ...sample, ...footer];
  if (height === undefined || all.length <= height) return all.map(row => truncateAnsi(row, columns));
  // Short windows (the preview, if any, was already dropped above).
  state.previewBusy = false;
  // Short windows keep the title, a pending-reload line (Portable motion waits on it), the selected row's neighbourhood and the footer.
  const compact = reload.length ? [`  ${secondary}Reload pending: press L after reloading ${host.name}.${reset}`] : [];
  const room = Math.max(1, height - head.length - compact.length - footer.length);
  const selectedLine = body.findIndex(line => line.startsWith(mark(true)));
  const start = Math.max(0, Math.min(body.length - room, selectedLine - Math.floor(room / 2)));
  return [...head, ...compact, ...body.slice(start, start + room), ...footer].slice(0, Math.max(1, height)).map(row => truncateAnsi(row, columns));
}
