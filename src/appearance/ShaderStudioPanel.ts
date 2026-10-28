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
import {renderValueControl} from '../ui/controls.js';
import {framePanel, tabCycleDelta} from '../ui/PanelShell.js';
import {renderStudioLayout, renderStudioReview, studioLabel, studioMuted, studioWrap, type StudioEntry} from '../ui/StudioLayout.js';
import {checkMark} from '../ui/glyphs.js';
import {UI_COLORS} from '../ui/palette.js';
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
  confirmation?: {plan: P; offset: number; rowCount?: number; shown?: boolean};
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
const PREVIEW_DESCRIPTIONS: Record<string, string> = {
  trail: 'A fading smear follows the cursor between positions.',
  comet: 'A bright head pulls a soft tail behind the cursor.',
  blaze: 'A flame-shaped trail burns behind the moving cursor.',
  lightning: 'A brief jagged bolt connects cursor positions.',
  'motion-blur': 'A soft streak connects recent cursor positions.',
  aurora: 'Slow color bands tint the background behind your text.',
  dim: 'The terminal dims when its window loses focus.',
  vignette: 'The edges darken to draw attention toward the center.',
  scanlines: 'Fine horizontal lines give the display a CRT texture.',
  glow: 'Bright text gains a soft halo.',
};

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
    if (key.kind === 'up' || key.kind === 'down') state.confirmation.offset = Math.max(0, Math.min((state.confirmation.rowCount ?? state.confirmation.plan.preview.length) - 1, state.confirmation.offset + (key.kind === 'up' ? -1 : 1)));
    // Enter confirms only a plan the person could see (not the 'Resize to review' stub).
    return key.kind === 'enter' && state.confirmation.shown !== false ? {kind: 'confirm'} : undefined;
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
  if (tabCycleDelta(key)) {
    const current = list[Math.min(state.selected, list.length - 1)];
    const category = current && current.kind !== 'placement' ? current.preset.definition.category : undefined;
    const categories = CATEGORY_ORDER.filter(c => list.some(row => row.kind !== 'placement' && row.preset.definition.category === c));
    // From the Placement row (no category) Tab goes to the first category and Shift+Tab to the last.
    const delta = tabCycleDelta(key)!;
    const index = category ? categories.indexOf(category) : delta > 0 ? -1 : 0;
    const next = categories[(index + delta + categories.length) % categories.length];
    state.selected = Math.max(0, list.findIndex(row => row.kind !== 'placement' && row.preset.definition.category === next));
    return undefined;
  }
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
  const clean = stripTerminalControls;
  if (state.confirmation) return renderStudioReview(state.confirmation, `Review ${host.name} shader configuration`, columns, height);
  const catalog = state.catalog;
  const gate = host.gate(state.gates);
  const inspection = state.inspection;
  const list = catalog?.supported ? rows(any, host as StudioHost<unknown>) : [];
  const selected = Math.min(state.selected, Math.max(0, list.length - 1));
  const current = list[selected];
  const preset = current && current.kind !== 'placement' ? current.preset : undefined;
  const categories = CATEGORY_ORDER.filter(category => catalog?.offered.some(p => p.definition.category === category));
  const order = state.draft.effects.filter(effect => effect.enabled).map(effect => effect.id);
  const passState = (id: string) => inspection?.activePresets.includes(id) ? 'written / unverified' : 'not written';
  const entries: StudioEntry[] = list.map(row => {
    if (row.kind === 'placement') return {group: 'Pipeline', label: 'Placement', value: state.draft.placement === 'after' ? 'After your shaders' : 'Before your shaders'};
    const group = `${CATEGORY_LABELS[row.preset.definition.category]}${row.preset.definition.exclusive ? ' (one)' : ''}`;
    if (row.kind === 'preset') {
      const on = enabled(any, row.preset.definition.id);
      const position = on && order.length > 1 ? `  #${order.indexOf(row.preset.definition.id) + 1}` : '';
      return {group, label: row.preset.definition.label, render: width => {
        const label = `${checkMark(on)} ${row.preset.definition.label}${position}`;
        const status = `${on ? 'on' : 'off'} · ${passState(row.preset.definition.id)}`;
        const shown = width >= 50 ? status : `${on ? 'on' : 'off'} · ${inspection?.activePresets.includes(row.preset.definition.id) ? 'written' : 'unwritten'}`;
        return `${padCells(label, Math.max(1, width - shown.length - 1), 0)} ${shown}`;
      }};
    }
    const value = studioParamValue(any, row.preset, row.param);
    const editing = state.colorInput?.preset === row.preset.definition.id && state.colorInput.param === row.param.name;
    const label = editing ? `RGB: ${state.colorInput!.text}_` : displayParam(row.param, value);
    const fraction = typeof value === 'number' ? (value - (row.param.min ?? 0)) / ((row.param.max ?? 1) - (row.param.min ?? 0) || 1) : 0;
    const color = Array.isArray(value) ? {red: Math.round(value[0]! * 255), green: Math.round(value[1]! * 255), blue: Math.round(value[2]! * 255)} : undefined;
    return {group, label: row.param.label, render: width => `${padCells(truncateAnsi(row.param.label, Math.min(20, width - 15)), Math.min(20, width - 15))} ${editing ? label : renderValueControl(row.param.kind, label, fraction, color)}`};
  });
  const kind = preset ? previewKind(preset.definition.id, preset.definition.category) : undefined;
  let previewShown = false;
  let previewAllowed = true;
  const reload = state.reloadPending ? `Reload pending: press L after reloading ${host.name}. Portable motion waits. The host may still draw NMSh’s previous trail.` : undefined;
  const details = (width: number, room: number): string[] => {
    const out: string[] = [];
    const text = (value: string) => out.push(...studioWrap(value, width).map(studioMuted));
    if (preset) {
      out.push(studioLabel(preset.definition.label));
      text(`${enabled(any, preset.definition.id) ? 'Enabled in draft' : 'Disabled in draft'} · ${passState(preset.definition.id)}`);
      if (preset.definition.exclusive) text(`Choose one ${CATEGORY_LABELS[preset.definition.category].toLowerCase()} effect at a time.`);
      text(kind ? PREVIEW_DESCRIPTIONS[kind] ?? 'A host shader changes the whole terminal surface.' : preset.definition.note ?? 'A host-wide effect; no faithful cell approximation is available.');
    }
    const note = current?.kind === 'placement' ? host.placementNote : preset?.definition.note || (preset && !preset.params.length ? host.noParams : '');
    if (note) text(note);
    if (current?.kind === 'param' && current.param.kind === 'color') text('Enter types an RGB color.');
    if (preset?.missing.length) text(`Not offered here: ${preset.missing.join(', ')} (the installed shader does not declare them as NMSh expects).`);
    const sample: string[] = [];
    if (previewAllowed && preview && preset && columns >= 22) {
      const values = Object.fromEntries(preset.params.map(param => [param.name, studioParamValue(any, preset, param)]));
      const key = `${preset.definition.id}:${JSON.stringify(values)}`;
      if (state.previewKey !== key) { state.previewKey = key; state.previewStart = preview.now; }
      if (!preview.color) sample.push(studioMuted('Preview needs color (NO_COLOR or a monochrome terminal).'));
      else if (!kind) sample.push(...studioWrap(`No preview for ${preset.definition.label}: NMSh would only be guessing at it.`, width).map(studioMuted));
      else {
        const frame = renderShaderPreview({kind, values: previewValues(preset.definition.id, values), width: Math.min(48, width), elapsed: preview.now - (state.previewStart ?? preview.now), still: preview.still, colors: preview.colors, ...(preview.level ? {level: preview.level} : {})});
        const caption = `Preview · ${preset.definition.label} · approximate, drawn by NMSh; ${host.name}’s GPU shader is the real effect`;
        sample.push(...studioWrap(caption, width).map(studioMuted), ...framePanel(frame.rows, width), ...(preview.still ? [studioMuted('Still frame (Reduced Motion or Effects Off).')] : []));
        if (out.length + sample.length <= room) { state.previewBusy = frame.busy; previewShown = true; }
      }
    }
    // The approximate sample is all-or-nothing; hidden samples cannot own a clock.
    if (out.length + sample.length <= room) out.push(...sample);
    text(host.intro(catalog!));
    if (inspection) { text(host.status(inspection)); text(host.userShaders(inspection)); }
    if (catalog!.notOffered.length) text(`${host.placement ? 'Installed, not offered yet' : 'Not available in this version'}: ${catalog!.notOffered.join(', ')}`);
    return out;
  };
  const supported = catalog?.supported;
  const status = !catalog ? 'Reading shader support…' : !supported ? 'Unsupported · Portable available' : gate ? 'Portable / gated · host effects restricted' : 'Native GPU · host-wide effects';
  const controls: Array<readonly [string, string]> = state.colorInput ? [['Enter', 'apply RGB'], ['Esc', 'cancel']] : [
    ...(supported ? [['↑↓', 'select'], ['Tab', 'category'], ['Enter', current?.kind === 'preset' ? 'on/off' : 'change'], ['←→', 'adjust'], ['⇧↑↓', 'order'], ['S', 'review']] as const : []),
    ...(catalog ? [['R', 'remove']] as const : []), ...(reload ? [['L', 'reloaded']] as const : []),
    // P stays a valid key even if no sample fits; the final pass adds its hint only for a visible run.
    ['Esc', 'back'],
  ];
  const message = state.message ?? inspection?.problems[0];
  const model = {
    title: `Appearance › ${host.name} shaders`, stacked: height === undefined,
    subtitle: `${host.name} ${catalog?.version || 'version unknown'} · ${status}${state.dirty ? ' · unsaved' : ''}`,
    ...(categories.length && supported ? {tabs: {labels: categories.map(c => CATEGORY_LABELS[c]), selected: Math.max(0, categories.indexOf(preset?.definition.category ?? categories[0]!))}} : {}),
    entries: entries.length ? entries : [{group: supported ? 'Presets' : 'Compatibility', label: !catalog ? `Reading ${host.name}’s shader support…` : clean(catalog.reason ?? 'No presets available'), render: () => !catalog ? `Reading ${host.name}’s shader support…` : clean(catalog.reason ?? 'No presets available')}],
    // Every notice is kept, the refusal or result first; the layout ends a long one with an ellipsis.
    selected, controls, notice: [message, reload, gate].filter(Boolean).join(' · ') || undefined,
    details: catalog && supported ? details : (width: number) => studioWrap(catalog ? `${catalog.reason ?? ''} ${host.unsupportedHint}` : `Reading ${host.name}’s configuration…`, width).map(studioMuted),
  };
  // Unbounded callers (diagnostics/tests) receive the complete catalogue and details.
  const limit = height ?? Math.max(64, list.length + 45);
  let result = renderStudioLayout(model, columns, limit);
  if (previewShown && preview && !preview.still && kind && PREVIEW_MS[kind] > 0 && !state.colorInput) {
    controls.splice(controls.length - 1, 0, ['P', 'replay']);
    state.previewBusy = false; previewShown = false;
    result = renderStudioLayout(model, columns, limit);
    if (!previewShown) {
      controls.splice(controls.findIndex(([key]) => key === 'P'), 1);
      previewAllowed = false;
      result = renderStudioLayout(model, columns, limit);
    }
  }
  if (!previewShown) { state.previewBusy = false; state.previewKey = undefined; state.previewStart = undefined; }
  return result;
}
