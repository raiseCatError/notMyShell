/**
 * /appearance › Kitty shaders: choose Kitty 0.49+ shipped shader effects,
 * tune the settings the installed shaders really expose, order them, and
 * review the exact host change before anything is written. The draft is the
 * panel's own until a reviewed plan is confirmed; Esc discards it.
 */
import type {Key} from '../terminal/keys.js';
import {renderControls} from '../ui/controls.js';
import {checkMark, GLYPHS} from '../ui/glyphs.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {stripTerminalControls} from '../util/terminalControls.js';
import {CATEGORY_LABELS, type KittyCatalog, type OfferedParam, type OfferedPreset, type PresetCategory, type ShaderValue} from './kittyShaderCatalog.js';
import type {KittyShaderInspection, KittyShaderPlan, ShaderGates} from './kittyShaders.js';
import type {KittyShaderEffect, KittyShaderSettings} from './kittyShaderSettings.js';

export interface KittyShaderPanelState {
  catalog?: KittyCatalog;
  inspection?: KittyShaderInspection;
  draft: KittyShaderSettings;
  /** The draft differs from the saved (last reviewed) settings. */
  dirty: boolean;
  selected: number;
  gates: ShaderGates;
  confirmation?: {plan: KittyShaderPlan; offset: number};
  colorInput?: {preset: string; param: string; text: string};
  message?: string;
}

export type KittyShaderAction = {kind: 'back'} | {kind: 'review'} | {kind: 'remove'} | {kind: 'confirm'};

type Row = {kind: 'placement'} | {kind: 'preset'; preset: OfferedPreset} | {kind: 'param'; preset: OfferedPreset; param: OfferedParam};
const CATEGORY_ORDER: readonly PresetCategory[] = ['cursor', 'ambient', 'interaction', 'focus', 'display'];

export function createKittyShaderPanel(saved: KittyShaderSettings, gates: ShaderGates): KittyShaderPanelState {
  return {draft: structuredClone(saved), dirty: false, selected: 0, gates};
}

const effectOf = (state: KittyShaderPanelState, id: string) => state.draft.effects.find(effect => effect.id === id);
const enabled = (state: KittyShaderPanelState, id: string) => effectOf(state, id)?.enabled === true;

/** Selectable rows: Placement, then presets by category, each enabled preset followed by its parameters. */
function rows(state: KittyShaderPanelState): Row[] {
  const offered = state.catalog?.offered ?? [];
  const list: Row[] = [{kind: 'placement'}];
  for (const category of CATEGORY_ORDER) {
    for (const preset of offered.filter(item => item.definition.category === category)) {
      list.push({kind: 'preset', preset});
      if (enabled(state, preset.definition.id)) for (const param of preset.params) list.push({kind: 'param', preset, param});
    }
  }
  return list;
}

export function paramValue(state: KittyShaderPanelState, preset: OfferedPreset, param: OfferedParam): ShaderValue {
  return effectOf(state, preset.definition.id)?.values[param.name] ?? param.default;
}

const hex = (value: ShaderValue) => Array.isArray(value) ? `#${value.slice(0, 3).map(part => Math.round(Math.min(1, Math.max(0, part)) * 255).toString(16).padStart(2, '0')).join('')}` : '';
const stepped = (value: number, param: OfferedParam, direction: number) => {
  const step = param.step ?? 0.01;
  const next = Math.round((value + direction * step) / step) * step;
  const places = (String(step).split('.')[1] ?? '').length;
  return Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, Number(next.toFixed(places))));
};

function display(param: OfferedParam, value: ShaderValue): string {
  if (param.kind === 'bool') return value ? 'On' : 'Off';
  if (param.kind === 'color') return hex(value);
  if (param.kind === 'choice') return param.choices?.find(([choice]) => choice === value)?.[1] ?? String(value);
  const places = (String(param.step ?? 0.01).split('.')[1] ?? '').length;
  return typeof value === 'number' ? value.toFixed(places) : String(value);
}

function ensure(state: KittyShaderPanelState, id: string): KittyShaderEffect {
  let effect = effectOf(state, id);
  if (!effect) { effect = {id, enabled: false, values: {}}; state.draft.effects.push(effect); }
  return effect;
}

function setValue(state: KittyShaderPanelState, preset: OfferedPreset, param: OfferedParam, value: ShaderValue): void {
  ensure(state, preset.definition.id).values[param.name] = value;
  state.dirty = true;
}

function toggle(state: KittyShaderPanelState, preset: OfferedPreset): void {
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

/** Move an enabled effect one place earlier or later in NMSh's pipeline order. */
function move(state: KittyShaderPanelState, id: string, direction: -1 | 1): void {
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

export function kittyShaderKey(state: KittyShaderPanelState, key: Key): KittyShaderAction | undefined {
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
      const current = paramValue(state, preset, param);
      setValue(state, preset, param, param.type === 'float4' ? [...rgb, Array.isArray(current) ? current[3] ?? 1 : 1] : rgb);
      state.colorInput = undefined;
    }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'back'};
  // Removal needs no catalog: it works on an unsupported or downgraded Kitty too.
  if (key.kind === 'text' && key.value.toLowerCase() === 'r' && state.catalog) return {kind: 'remove'};
  if (!state.catalog?.supported) return undefined;
  const list = rows(state);
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + list.length) % list.length; return undefined; }
  if (key.kind === 'text' && key.value.toLowerCase() === 's') return {kind: 'review'};
  const row = list[Math.min(state.selected, list.length - 1)]!;
  state.message = undefined;
  if (row.kind === 'placement') {
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') { state.draft.placement = state.draft.placement === 'after' ? 'before' : 'after'; state.dirty = true; }
    return undefined;
  }
  if (row.kind === 'preset') {
    if (key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) toggle(state, row.preset);
    else if (key.kind === 'selectUp' || key.kind === 'selectDown') move(state, row.preset.definition.id, key.kind === 'selectUp' ? -1 : 1);
    return undefined;
  }
  const {preset, param} = row;
  const value = paramValue(state, preset, param);
  if (param.kind === 'color') { if (key.kind === 'enter') state.colorInput = {preset: preset.definition.id, param: param.name, text: ''}; return undefined; }
  if (key.kind !== 'left' && key.kind !== 'right' && key.kind !== 'enter') return undefined;
  const direction = key.kind === 'left' ? -1 : 1;
  if (param.kind === 'bool') setValue(state, preset, param, !value);
  else if (param.kind === 'choice') {
    const choices = param.choices ?? [];
    const index = choices.findIndex(([choice]) => choice === value);
    setValue(state, preset, param, choices[(index + direction + choices.length) % choices.length]![0]);
  } else if (typeof value === 'number' && key.kind !== 'enter') setValue(state, preset, param, stepped(value, param, direction));
  return undefined;
}

function status(state: KittyShaderPanelState): string {
  const inspection = state.inspection;
  if (!inspection) return 'Reading Kitty’s configuration…';
  if (inspection.drifted) return 'Your own custom_shaders changed since NMSh composed with it; S reviews an updated plan.';
  if (inspection.configured) return `Set up · ${inspection.activePresets.length ? `${inspection.activePresets.length} NMSh effect${inspection.activePresets.length === 1 ? '' : 's'} in Kitty’s config` : 'no NMSh effect active'}`;
  return 'Not set up · nothing in Kitty’s configuration is changed until you review and confirm';
}

export function renderKittyShaderPanel(state: KittyShaderPanelState, columns: number, height?: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const clean = (text: string) => stripTerminalControls(text);
  if (state.confirmation) {
    const review = state.confirmation;
    const available = Math.max(1, (height ?? 24) - 7);
    return [`${primary}  Review Kitty shader configuration${reset}`, '  Enter confirms exactly this plan; Esc keeps every file unchanged.',
      ...review.plan.preview.slice(review.offset, review.offset + available).map(line => `  ${clean(line)}`), '', `  ${subtle}${clean(review.plan.guidance)}${reset}`,
      renderControls([['↑↓', 'scroll'], ['Enter', 'confirm write'], ['Esc', 'cancel']])].map(row => truncateAnsi(row, columns));
  }
  const head = [`${primary}  Appearance › Kitty shaders${reset}`];
  const catalog = state.catalog;
  if (!catalog) return [...head, '', `  ${subtle}Reading Kitty’s installed shader catalog…${reset}`, '', renderControls([['Esc', 'back']])].map(row => truncateAnsi(row, columns));
  if (!catalog.supported) {
    return [...head, '', `  ${secondary}${clean(catalog.reason ?? 'Kitty custom shaders are not available.')}${reset}`,
      `  ${subtle}Cursor effects stay with /cursor (Portable, or Kitty’s built-in trail).${reset}`, ...(state.inspection?.configured ? [`  ${subtle}R reviews removal of NMSh’s existing Kitty shader files.${reset}`] : []),
      '', renderControls([['Esc', 'back'], ...(state.inspection?.configured ? [['R', 'remove'] as [string, string]] : [])])].map(row => truncateAnsi(row, columns));
  }
  const inspection = state.inspection;
  const gate = state.gates.reducedMotion ? 'Reduced Motion is on: NMSh keeps Kitty effects out of its pipeline until it is off.'
    : state.gates.effectsOff ? 'Decorative effects are Off: NMSh keeps Kitty effects out of its pipeline until they are on.'
      : state.gates.cursorRenderer === 'portable' ? 'Cursor renderer is Portable: NMSh draws the trail, so no Kitty trail is added.' : undefined;
  const intro = [`  ${subtle}Kitty ${clean(catalog.version)} · shipped shaders read from Kitty itself · effects cover the whole Kitty window, not only NMSh${reset}`,
    `  ${subtle}${clean(status(state))}${reset}`,
    `  ${subtle}${inspection ? (inspection.userEntries.length ? `Your shaders (kept, in order): ${clean(inspection.userEntries.join(' · '))}` : 'You have no custom_shaders of your own.') : ''}${reset}`,
    ...(gate ? [`  ${secondary}${gate}${reset}`] : [])];
  const list = rows(state);
  const selected = Math.min(state.selected, list.length - 1);
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
      if (row.preset.definition.category !== category) { category = row.preset.definition.category; body.push(`  ${subtle}${CATEGORY_LABELS[category]}${category === 'cursor' ? ' (one)' : ''}${reset}`); }
      const on = enabled(state, row.preset.definition.id);
      const position = on && order.length > 1 ? `  ${subtle}#${order.indexOf(row.preset.definition.id) + 1}${reset}` : '';
      body.push(`${mark(active)}   ${on ? accent : subtle}${checkMark(on)}${reset} ${focusForeground(active)}${row.preset.definition.label}${reset}${position}`);
      return;
    }
    const value = display(row.param, paramValue(state, row.preset, row.param));
    const editing = state.colorInput && state.colorInput.preset === row.preset.definition.id && state.colorInput.param === row.param.name;
    const shown = editing ? `RGB: ${state.colorInput!.text}_` : value;
    body.push(`${mark(active)}       ${focusForeground(active)}${padCells(row.param.label, 20)}${reset}${active && !editing && row.param.kind !== 'color' ? `${accent}‹ ${shown} ›${reset}` : `${secondary}${shown}${reset}`}`);
  });
  const current = list[selected];
  const preset = current && current.kind !== 'placement' ? current.preset : undefined;
  const note = current?.kind === 'placement' ? 'Kitty runs shaders in list order; your own stay in their order either way.'
    : preset ? [preset.definition.note, !preset.params.length && !preset.definition.note ? 'Kitty exposes no adjustable settings for this shader.' : undefined,
      preset.missing.length ? `Not offered here: ${preset.missing.join(', ')} (the installed shader does not declare them as NMSh expects).` : undefined,
      current?.kind === 'param' && current.param.kind === 'color' ? 'Enter types an RGB color.' : undefined].filter(Boolean).join(' ') : '';
  const footer = [
    ...(note ? ['', `  ${subtle}${clean(note)}${reset}`] : []),
    ...(catalog.notOffered.length ? [`  ${subtle}Installed, not offered yet: ${clean(catalog.notOffered.join(', '))}${reset}`] : []),
    ...(inspection?.problems.length ? [`  ${secondary}${clean(inspection.problems[0]!)}${reset}`] : []),
    ...(state.message ? [`  ${secondary}${clean(state.message)}${reset}`] : []),
    '', renderControls([['↑↓', 'select'], ['Enter', current?.kind === 'preset' ? 'on/off' : 'change'], ['←→', 'adjust'], ['⇧↑↓', 'order'], ['S', 'review'], ['R', 'remove'], ['Esc', 'back']]),
  ];
  const all = [...head, ...intro, ...body, ...footer];
  if (height === undefined || all.length <= height) return all.map(row => truncateAnsi(row, columns));
  // Short windows keep the title, the selected row's neighbourhood and the footer.
  const room = Math.max(1, height - head.length - footer.length);
  const selectedLine = body.findIndex(line => line.startsWith(mark(true)));
  const start = Math.max(0, Math.min(body.length - room, selectedLine - Math.floor(room / 2)));
  return [...head, ...body.slice(start, start + room), ...footer].slice(0, Math.max(1, height)).map(row => truncateAnsi(row, columns));
}
