import type {Key} from '../terminal/keys.js';
import {CURSOR_BLINKS, CURSOR_EASINGS, CURSOR_EFFECTS, CURSOR_IDLE_EFFECTS, CURSOR_LEVELS, CURSOR_MOTIONS, CURSOR_RENDERERS, CURSOR_SHAPES,
  type CursorAdvanced, type CursorSettings} from '../prompt/configuration.js';
import {CATPPUCCIN_ACCENTS, CATPPUCCIN_ACCENT_LABELS, normalizeCatppuccinAccent} from '../appearance/themeFamilies.js';
import {defaultVariant, FAMILY_IDS, FAMILY_LABELS, familyOf, variantOptions} from '../appearance/themeSelection.js';
import {hexColor, parseHexColor} from '../chroma/color.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {colorPickerKey, createColorPicker, renderColorPicker, type ColorPickerState} from '../ui/ColorPicker.js';
import {gradientEditorControls, gradientEditorKey, renderGradientEditorRows, type GradientEditorState} from '../ui/GradientEditor.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {colorEscape} from '../chroma/escape.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {availabilityOf, availableValues, unavailableReason, type BackendChoice, type CursorFeature, type HostCursorFacts} from './backends.js';
import {describeCursorColor, resolveCursorSettings, type CursorColorContext} from './colors.js';
import {effectPalette} from './palette.js';
import {renderCursorPreview, type PreviewScene} from './CursorPreview.js';

/**
 * /cursor: the canonical cursor & effects surface (also embedded in Setup
 * over its draft). Normal rows cover what people change; Advanced (A) holds
 * colors beyond the basics and the physics. Rows are capability-aware: a value
 * the effective renderer cannot draw is not offered, a row with nothing to
 * offer says Unavailable and why, and Auto says plainly when Portable is
 * drawing something the host backend does not. The preview below the title
 * demonstrates the SELECTED row, restarts when the selection or a value
 * changes, replays on R, and always has the same height.
 */
export interface CursorPanelState {
  draft: CursorSettings;
  selected: number;
  advanced: boolean;
  /** When the preview (re)started; selecting, changing a value and R all restart it. */
  started: number;
  message?: string;
  /** Host-native setup awaiting the person's Yes: the exact file, the one line, what else touches the feature. */
  native?: {host: 'ghostty' | 'kitty'; configPath: string; line?: string; related: string[]; blocked?: string; choice: 'yes' | 'no'};
  /** The shared color picker, while a color is being chosen. Nothing is kept until Enter. */
  picker?: {target: 'cursor' | 'trail' | 'particles'; state: ColorPickerState};
  /** The shared gradient editor for trail or particle colors. */
  gradient?: {target: 'trail' | 'particles'; state: GradientEditorState};
  /** Setup embeds this panel over its draft: applying changes the draft, and host setup is not offered here. */
  embedded?: boolean;
  /** Opened straight on Advanced (from Setup): Esc leaves the panel instead of returning to the basic rows. */
  embeddedAdvancedOnly?: boolean;
  /** Set by each render: whether the preview is still animating (the app keeps a frame clock only while true). */
  previewBusy?: boolean;
}

/** Everything the panel needs to know about the world; supplied by the app per render and per key. */
export interface CursorPanelEnv {
  choice: BackendChoice;
  facts: HostCursorFacts;
  context: CursorColorContext;
  /** Decorative motion is not allowed right now. */
  still: boolean;
  level: ColorLevel;
}

interface Option {value: string; label: string}
interface Row {
  key: string;
  label: string;
  scene: PreviewScene;
  /** The setting's own name for the preview title. */
  options?: (draft: CursorSettings, env: CursorPanelEnv) => Option[];
  get?: (draft: CursorSettings, env: CursorPanelEnv) => string;
  set?: (draft: CursorSettings, value: string, env: CursorPanelEnv) => void;
  /** A reason, when the row has nothing it can do here: shown as Unavailable, without arrows. */
  unavailable?: (draft: CursorSettings, env: CursorPanelEnv) => string | undefined;
  when?: (draft: CursorSettings) => boolean;
  action?: 'native' | 'advanced' | 'customColor' | 'trailColors' | 'particleColors';
  /** The text shown for an action row. */
  display?: (draft: CursorSettings, env: CursorPanelEnv) => string;
  /** One line shown under the list while the row is selected. */
  detail?: (draft: CursorSettings, env: CursorPanelEnv) => string | undefined;
}

const LABELS: Record<string, string> = {host: 'Host default', block: 'Block', bar: 'Bar', underline: 'Underline', on: 'On', off: 'Off', auto: 'Auto', portable: 'Portable', native: 'Host native',
  smooth: 'Smooth', smear: 'Smear', tail: 'Tail', none: 'None', fire: 'Fire', sparks: 'Sparks', lightning: 'Lightning', railgun: 'Railgun', ripple: 'Ripple', wireframe: 'Wireframe',
  glow: 'Glow', embers: 'Embers', flame: 'Flame', accent: 'NMSh accent', theme: 'Follow current theme', chosen: 'Choose theme', custom: 'Custom', low: 'Low', medium: 'Medium', high: 'High',
  cursor: 'Follow cursor', gradient: 'Gradient', trail: 'Follow trail', 'out-cubic': 'Ease out', 'out-expo': 'Ease out (sharp)', linear: 'Linear', spring: 'Spring'};
export const cursorLabel = (value: string) => LABELS[value] ?? value;

const COLOR_SOURCE_ORDER = ['theme', 'chosen', 'accent', 'host', 'custom'] as const;
const COLOR_SOURCE_LABELS: Record<string, string> = {theme: 'Follow current theme', chosen: 'Choose theme', accent: 'NMSh accent', host: 'Host', custom: 'Custom'};
const plain = (values: readonly string[], label: (value: string) => string = cursorLabel): Option[] => values.map(value => ({value, label: label(value)}));

/** A feature's values that can work now, labelled with how they are delivered (Portable fallback, after setup). */
function featureOptions(feature: CursorFeature, values: readonly string[], draft: CursorSettings, env: CursorPanelEnv): Option[] {
  return availableValues(feature, values, draft.renderer, env.facts).map(value => {
    const availability = availabilityOf(feature, value, draft.renderer, env.facts);
    return {value, label: `${cursorLabel(value)}${availability.available && availability.suffix ? ` · ${availability.suffix}` : ''}`};
  });
}

const FEATURE_VALUES: Record<CursorFeature, readonly string[]> = {motion: CURSOR_MOTIONS, effect: CURSOR_EFFECTS, idleEffect: CURSOR_IDLE_EFFECTS};

function featureRow(key: string, label: string, feature: CursorFeature, scene: PreviewScene, get: (d: CursorSettings) => string, set: (d: CursorSettings, value: string) => void): Row {
  return {key, label, scene, options: (draft, env) => featureOptions(feature, FEATURE_VALUES[feature], draft, env), get, set,
    unavailable: (draft, env) => unavailableReason(feature, FEATURE_VALUES[feature], draft.renderer, env.facts),
    detail: (draft, env) => {
      const current = get(draft);
      const availability = availabilityOf(feature, current, draft.renderer, env.facts);
      if (!availability.available) return availability.reason;
      if (availability.via === 'portable-fallback') return `${env.facts.host === 'ghostty' ? 'Ghostty' : 'The host'} native does not draw this; Portable draws it instead.`;
      if (availability.via === 'native-pending') return `Drawn by ${availability.suffix.replace('after ', '').replace(' setup', '')} native once it is set up.`;
      return undefined;
    }};
}

const chosenTheme = (draft: CursorSettings, env: CursorPanelEnv) => draft.color.theme ?? env.context.palette;
const hexOf = (draft: CursorSettings, env: CursorPanelEnv) => describeCursorColor(resolveCursorSettings(draft, env.context), env.context).hex;

const NORMAL: Row[] = [
  {key: 'shape', label: 'Shape', scene: 'shape', options: () => plain(CURSOR_SHAPES), get: d => d.shape, set: (d, v) => { d.shape = v as CursorSettings['shape']; },
    detail: d => d.shape === 'host' ? 'Host default keeps your terminal\'s own cursor; NMSh sends no shape or blink.' : 'Applied while NMSh owns the composer; full-screen programs get your normal cursor.'},
  {key: 'blink', label: 'Blink', scene: 'blink', options: () => plain(CURSOR_BLINKS), get: d => d.blink, set: (d, v) => { d.blink = v as CursorSettings['blink']; },
    unavailable: d => d.shape === 'host' ? 'Blink needs an explicit shape; Host default keeps your terminal\'s own cursor.' : undefined,
    detail: d => d.blink === 'host' ? 'Host default blink: the terminal\'s own, at its own speed.' : undefined},
  {key: 'renderer', label: 'Renderer', scene: 'jump', options: () => plain(CURSOR_RENDERERS), get: d => d.renderer, set: (d, v) => { d.renderer = v as CursorSettings['renderer']; },
    detail: (_d, env) => env.choice.reason},
  featureRow('motion', 'Motion', 'motion', 'jump', d => d.motion, (d, v) => { d.motion = v as CursorSettings['motion']; }),
  featureRow('effect', 'Effect', 'effect', 'jump', d => d.effect, (d, v) => { d.effect = v as CursorSettings['effect']; }),
  featureRow('idle', 'Idle effect', 'idleEffect', 'idle', d => d.idleEffect, (d, v) => { d.idleEffect = v as CursorSettings['idleEffect']; }),
  {key: 'color', label: 'Color', scene: 'jump', options: () => plain(COLOR_SOURCE_ORDER, value => COLOR_SOURCE_LABELS[value]!), get: d => d.color.source,
    set: (d, v, env) => {
      const source = v as CursorSettings['color']['source'];
      // Each source starts from what is shown now, so choosing it never makes the color jump.
      const current = hexOf(d, env);
      d.color = {...d.color, source,
        ...(source === 'chosen' ? {theme: d.color.theme ?? env.context.palette, themeAccent: d.color.themeAccent ?? env.context.accent} : {}),
        ...(source === 'custom' && !d.color.custom ? {custom: current ?? '#a67cf3'} : {})};
    },
    detail: (d, env) => d.color.source === 'host' ? 'Host: your terminal draws the caret in its own color (effects borrow a neutral tone).'
      : d.color.source === 'theme' ? 'The caret and effects use the prompt\'s theme color and follow it when the theme changes.'
      : d.color.source === 'chosen' ? 'A theme chosen for the cursor alone; the prompt keeps its own.' : d.color.source === 'accent' ? 'NMSh\'s UI accent.' : `Custom ${hexOf(d, env)?.toUpperCase() ?? ''}`},
  {key: 'colorFamily', label: 'Theme family', scene: 'jump', when: d => d.color.source === 'chosen',
    options: (_d, env) => FAMILY_IDS.filter(id => id !== 'custom' || env.context.customTheme).map(id => ({value: id, label: FAMILY_LABELS[FAMILY_IDS.indexOf(id)]!})),
    get: (d, env) => familyOf(chosenTheme(d, env)),
    set: (d, v) => { d.color = {...d.color, theme: defaultVariant(v as Parameters<typeof defaultVariant>[0])}; }},
  {key: 'colorVariant', label: 'Variant', scene: 'jump', when: d => d.color.source === 'chosen',
    options: (d, env) => { const options = variantOptions(familyOf(chosenTheme(d, env))); return options.length > 1 ? options.map(option => ({value: option.id, label: option.label})) : []; },
    get: (d, env) => chosenTheme(d, env), set: (d, v) => { d.color = {...d.color, theme: v as NonNullable<CursorSettings['color']['theme']>}; },
    unavailable: (d, env) => variantOptions(familyOf(chosenTheme(d, env))).length > 1 ? undefined : 'This theme family has a single variant.'},
  {key: 'colorAccent', label: 'Accent', scene: 'jump', when: d => d.color.source === 'chosen' && familyOf(d.color.theme ?? 'lavender') === 'catppuccin',
    options: () => CATPPUCCIN_ACCENTS.map(accent => ({value: accent, label: CATPPUCCIN_ACCENT_LABELS[accent]})),
    get: (d, env) => d.color.themeAccent ?? env.context.accent, set: (d, v) => { d.color = {...d.color, themeAccent: normalizeCatppuccinAccent(v)}; }},
  {key: 'colorCustom', label: 'Custom color', scene: 'jump', when: d => d.color.source === 'custom', action: 'customColor',
    display: (d, env) => hexOf(d, env)?.toUpperCase() ?? '#A67CF3', detail: () => 'Enter opens the color picker; type a #RRGGBB value or pick one.'},
  {key: 'speed', label: 'Speed', scene: 'jump', options: () => plain(CURSOR_LEVELS), get: d => d.speed, set: (d, v) => { d.speed = v as CursorSettings['speed']; }, detail: () => 'How long the caret takes to travel.'},
  {key: 'intensity', label: 'Intensity', scene: 'jump', options: () => plain(CURSOR_LEVELS), get: d => d.intensity, set: (d, v) => { d.intensity = v as CursorSettings['intensity']; }, detail: () => 'How strong the trail and effect colors are.'},
  {key: 'trailLength', label: 'Trail length', scene: 'jump', options: () => plain(CURSOR_LEVELS), get: d => d.trailLength, set: (d, v) => { d.trailLength = v as CursorSettings['trailLength']; }, detail: () => 'How far Smear and Tail stretch.'},
  {key: 'particles', label: 'Particles', scene: 'jump', options: () => plain(CURSOR_LEVELS), get: d => d.particleAmount, set: (d, v) => { d.particleAmount = v as CursorSettings['particleAmount']; }, detail: () => 'How many particles an effect sheds.'},
  {key: 'nativeSetup', label: 'Host native setup', scene: 'jump', action: 'native', display: (_d, env) => env.choice.native ? (env.facts.integrated ? env.choice.reason : `${env.choice.native.host}: set up its GPU cursor (shown before any change)`)
    : 'Ghostty / Kitty: set up their GPU cursor (shown before any change)'},
  {key: 'advancedRow', label: 'Advanced', scene: 'jump', action: 'advanced', display: () => 'Colors and physics ›'},
];

const numeric = (key: keyof CursorAdvanced, label: string, step: number, min: number, max: number, unit = ''): Row => ({key, label, scene: 'jump',
  get: d => `${d.advanced[key]}${unit}`,
  set: (d, direction) => { const current = d.advanced[key] as number; d.advanced = {...d.advanced, [key]: Math.round(Math.min(max, Math.max(min, current + (direction === '+' ? step : -step))) * 1000) / 1000}; }});

const ADVANCED: Row[] = [
  {key: 'trailColor', label: 'Trail color', scene: 'jump', options: () => plain(['cursor', 'custom', 'gradient']), get: d => d.trail.source,
    set: (d, v) => { d.trail = {...d.trail, source: v as CursorSettings['trail']['source']}; },
    detail: () => 'Follow cursor uses the cursor color; Custom is one color; Gradient fades along the trail.'},
  {key: 'trailEdit', label: 'Edit trail color', scene: 'jump', when: d => d.trail.source !== 'cursor', action: 'trailColors',
    display: d => d.trail.source === 'custom' ? (d.trail.colors[0] ?? 'choose a color').toUpperCase() : `${d.trail.colors.length || 2} stops ›`},
  {key: 'particleColor', label: 'Particle color', scene: 'jump', options: () => plain(['trail', 'custom', 'gradient']), get: d => d.particles.source,
    set: (d, v) => { d.particles = {...d.particles, source: v as CursorSettings['particles']['source']}; },
    detail: () => 'Follow trail shares the trail color; Custom is one color; Gradient runs from young to old particles.'},
  {key: 'particleEdit', label: 'Edit particle colors', scene: 'jump', when: d => d.particles.source !== 'trail', action: 'particleColors',
    display: d => d.particles.source === 'custom' ? (d.particles.colors[0] ?? 'choose a color').toUpperCase() : `${d.particles.colors.length || 2} stops ›`},
  numeric('shortMoveMs', 'Short-move duration', 10, 0, 200, ' ms'), numeric('longMoveMs', 'Long-move duration', 10, 40, 600, ' ms'),
  {key: 'easing', label: 'Easing', scene: 'jump', options: () => plain(CURSOR_EASINGS), get: d => d.advanced.easing, set: (d, v) => { d.advanced = {...d.advanced, easing: v as CursorAdvanced['easing']}; }},
  numeric('stiffness', 'Stiffness', 0.05, 0.05, 1), numeric('tailStiffness', 'Tail stiffness', 0.05, 0.05, 1), numeric('damping', 'Damping', 0.05, 0.1, 1),
  numeric('trailExponent', 'Trail exponent', 0.1, 0.5, 4), numeric('maxTrail', 'Max trail', 2, 2, 80, ' cells'), numeric('moveThreshold', 'Movement threshold', 1, 0, 8, ' cells'),
  numeric('dwellMs', 'Dwell threshold', 100, 0, 5000, ' ms'), numeric('particleDensity', 'Particle density', 0.1, 0, 4), numeric('particleLifetimeMs', 'Particle lifetime', 20, 100, 2000, ' ms'),
  numeric('spread', 'Spread', 0.1, 0, 2), numeric('particleSpeed', 'Particle speed', 0.1, 0.1, 4), numeric('drag', 'Drag', 0.02, 0.5, 1), numeric('gravity', 'Gravity', 0.1, -2, 2),
  numeric('fps', 'Frame cadence', 6, 12, 120, ' fps'),
];

export interface CursorPanelOptions {embedded?: boolean; advanced?: boolean; /** Start with this row selected (by key). */ row?: string}

export function createCursorPanel(settings: CursorSettings, now = Date.now(), options: CursorPanelOptions = {}): CursorPanelState {
  const state: CursorPanelState = {draft: structuredClone(settings), selected: 0, advanced: Boolean(options.advanced), started: now, ...(options.embedded ? {embedded: true} : {}),
    ...(options.advanced ? {embeddedAdvancedOnly: true} : {})};
  if (options.row) state.selected = Math.max(0, visibleRows(state).findIndex(row => row.key === options.row));
  return state;
}

export type CursorPanelAction = {kind: 'close'} | {kind: 'apply'; settings: CursorSettings} | {kind: 'native'} | {kind: 'nativeConfirm'};

function visibleRows(state: CursorPanelState): Row[] {
  return (state.advanced ? ADVANCED : NORMAL).filter(row => (!row.when || row.when(state.draft)) && !(state.embedded && row.action === 'native'));
}

export const cursorPanelRowKeys = (advanced: boolean, draft: CursorSettings): string[] => visibleRows({draft, selected: 0, advanced, started: 0}).map(row => row.key);

/** The selected row, and the preview scene it demonstrates. */
export function selectedCursorRow(state: CursorPanelState): Row | undefined {
  const rows = visibleRows(state);
  return rows[Math.min(state.selected, rows.length - 1)];
}

function optionsOf(row: Row, state: CursorPanelState, env: CursorPanelEnv): Option[] {
  return row.options?.(state.draft, env) ?? [];
}

/** Whether ←/→/Enter would change this row's value (an Unavailable row only offers to reset a stale value to Off). */
function offValue(row: Row): string | undefined {
  return row.key === 'motion' ? 'off' : row.key === 'effect' ? 'none' : row.key === 'idle' ? 'off' : undefined;
}

const commit = (state: CursorPanelState): CursorPanelAction => ({kind: 'apply', settings: structuredClone(state.draft)});

function pickerStart(state: CursorPanelState, target: 'cursor' | 'trail' | 'particles', env: CursorPanelEnv): void {
  const draft = state.draft;
  const hex = target === 'cursor' ? hexOf(draft, env) : target === 'trail' ? draft.trail.colors[0] : draft.particles.colors[0];
  state.picker = {target, state: createColorPicker(hex ?? '#a67cf3', env.level)};
}

function gradientStart(state: CursorPanelState, target: 'trail' | 'particles', env: CursorPanelEnv): void {
  const existing = target === 'trail' ? state.draft.trail.colors : state.draft.particles.colors;
  const palette = effectPalette(resolveCursorSettings(state.draft, env.context));
  const fallback = (target === 'trail' ? palette.trail : palette.particles).map(color => hexColor(color));
  const stops = existing.length >= 2 ? [...existing] : fallback.length >= 2 ? fallback : [fallback[0] ?? '#a67cf3', '#4a8cff'];
  state.gradient = {target, state: {stops, index: 0}};
}

export function cursorPanelKey(state: CursorPanelState, key: Key, env: CursorPanelEnv, now = Date.now()): CursorPanelAction | undefined {
  if (state.picker) {
    const outcome = colorPickerKey(state.picker.state, key, env.level);
    if (outcome === 'cancel') { state.picker = undefined; state.started = now; return undefined; }
    if (outcome === 'confirm') {
      const hex = hexColor(state.picker.state.color);
      const {target} = state.picker;
      state.picker = undefined;
      if (target === 'cursor') state.draft.color = {...state.draft.color, source: 'custom', custom: hex};
      else if (target === 'trail') state.draft.trail = {source: 'custom', colors: [hex]};
      else state.draft.particles = {source: 'custom', colors: [hex]};
      state.started = now;
      return commit(state);
    }
    return undefined;
  }
  if (state.gradient) {
    const editor = state.gradient;
    if (editor.state.editing === undefined && (key.kind === 'escape' || key.kind === 'interrupt')) {
      const stops = editor.state.stops.filter(stop => parseHexColor(stop)).slice(0, 6);
      state.gradient = undefined;
      if (editor.target === 'trail') state.draft.trail = {source: 'gradient', colors: stops};
      else state.draft.particles = {source: 'gradient', colors: stops};
      state.started = now;
      return commit(state);
    }
    gradientEditorKey(editor.state, key, () => editor.state.stops);
    return undefined;
  }
  if (state.native) {
    const native = state.native;
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.native = undefined; return undefined; }
    if (key.kind === 'left' || key.kind === 'right') native.choice = native.choice === 'yes' ? 'no' : 'yes';
    else if (key.kind === 'text' && /^[yn]$/iu.test(key.value)) native.choice = key.value.toLowerCase() === 'y' ? 'yes' : 'no';
    else if (key.kind === 'enter') {
      const yes = native.choice === 'yes' && !native.blocked;
      if (!yes) { state.native = undefined; state.message = 'Nothing was changed.'; return undefined; }
      return {kind: 'nativeConfirm'};
    }
    return undefined;
  }
  const rows = visibleRows(state);
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.advanced && !state.embeddedAdvancedOnly) { state.advanced = false; state.selected = NORMAL.length - 1; state.started = now; return undefined; }
    return {kind: 'close'};
  }
  if (key.kind === 'up' || key.kind === 'down') {
    state.selected = (Math.min(state.selected, rows.length - 1) + (key.kind === 'up' ? -1 : 1) + rows.length) % rows.length;
    state.message = undefined;
    state.started = now;
    return undefined;
  }
  if (key.kind === 'text' && key.value.toLowerCase() === 'r') { state.started = now; return undefined; }
  if (key.kind === 'text' && key.value.toLowerCase() === 'a' && !state.advanced) { state.advanced = true; state.selected = 0; state.started = now; return undefined; }
  const row = rows[Math.min(state.selected, rows.length - 1)];
  if (!row) return undefined;
  if (row.action && (key.kind === 'enter' || key.kind === 'right')) {
    if (row.action === 'advanced') { state.advanced = true; state.selected = 0; state.started = now; return undefined; }
    if (row.action === 'customColor') { pickerStart(state, 'cursor', env); return undefined; }
    if (row.action === 'trailColors') { if (state.draft.trail.source === 'custom') pickerStart(state, 'trail', env); else gradientStart(state, 'trail', env); return undefined; }
    if (row.action === 'particleColors') { if (state.draft.particles.source === 'custom') pickerStart(state, 'particles', env); else gradientStart(state, 'particles', env); return undefined; }
    return {kind: 'native'};
  }
  if ((key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') && row.set) {
    const back = key.kind === 'left';
    const reason = row.unavailable?.(state.draft, env);
    if (reason) {
      // Nothing here can work; the only change offered is putting a stale value back to Off.
      const off = offValue(row);
      if (!off || row.get!(state.draft, env) === off) return undefined;
      row.set(state.draft, off, env);
      state.started = now;
      return commit(state);
    }
    if (row.options) {
      const options = optionsOf(row, state, env);
      if (!options.length) return undefined;
      const current = row.get!(state.draft, env);
      const index = options.findIndex(option => option.value === current);
      // A stale value (no longer offered) moves to the first value that is.
      const next = index < 0 ? options[0]! : options[(index + (back ? -1 : 1) + options.length) % options.length]!;
      row.set(state.draft, next.value, env);
    } else row.set(state.draft, back ? '-' : '+', env);
    // Changes preview at once and apply at once (the composer follows); nothing is ever hidden behind Save.
    state.started = now;
    return commit(state);
  }
  return undefined;
}

/** The text of a row's value, and whether it is editable (arrows) right now. */
function rowValue(row: Row, state: CursorPanelState, env: CursorPanelEnv): {text: string; editable: boolean; swatch?: string} {
  const draft = state.draft;
  if (row.action) {
    const hex = row.key === 'colorCustom' ? hexOf(draft, env) : undefined;
    return {text: row.display?.(draft, env) ?? '', editable: false, ...(hex ? {swatch: hex} : {})};
  }
  if (row.unavailable?.(draft, env)) return {text: 'Unavailable', editable: false};
  const current = row.get!(draft, env);
  const options = row.options ? optionsOf(row, state, env) : [];
  const match = options.find(option => option.value === current);
  const hex = row.key === 'color' ? hexOf(draft, env) : undefined;
  if (!row.options) return {text: current, editable: true};
  return {text: match ? match.label : `${cursorLabel(current)} · unavailable`, editable: options.length > 1, ...(hex ? {swatch: hex} : {})};
}

/** The preview scene and title for the selected row. */
export function previewFor(state: CursorPanelState, env: CursorPanelEnv): {scene: PreviewScene; title: string; unavailable?: string} {
  const row = selectedCursorRow(state);
  if (!row) return {scene: 'shape', title: 'Shape'};
  const value = row.action ? row.label : `${row.label}: ${rowValue(row, state, env).text.replace(' · unavailable', '')}`;
  // An effect/motion/idle value that the renderer cannot draw demonstrates nothing but the reason.
  const reason = row.options && !row.action ? (row.unavailable?.(state.draft, env) ?? (() => {
    const current = row.get!(state.draft, env);
    const feature: CursorFeature | undefined = row.key === 'motion' ? 'motion' : row.key === 'effect' ? 'effect' : row.key === 'idle' ? 'idleEffect' : undefined;
    const availability = feature ? availabilityOf(feature, current, state.draft.renderer, env.facts) : undefined;
    return availability && !availability.available ? availability.reason : undefined;
  })()) : undefined;
  return {scene: row.scene, title: value, ...(reason && row.key !== 'blink' ? {unavailable: reason} : {})};
}

export function renderCursorPanel(state: CursorPanelState, columns: number, now: number, env: CursorPanelEnv, height = Number.POSITIVE_INFINITY): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  state.previewBusy = false;
  if (state.picker) {
    const label = state.picker.target === 'cursor' ? 'Cursor color' : state.picker.target === 'trail' ? 'Trail color' : 'Particle color';
    return [`${primary}  Cursor & effects › ${label}${reset}`, '', ...renderColorPicker(state.picker.state, label, columns, env.level)].map(row => truncateAnsi(row, columns));
  }
  if (state.gradient) {
    const target = state.gradient.target === 'trail' ? 'Trail gradient' : 'Particle gradient';
    return [`${primary}  Cursor & effects › ${target}${reset}`, '', ...renderGradientEditorRows(state.gradient.state, target), '', renderControls(gradientEditorControls(state.gradient.state))].map(row => truncateAnsi(row, columns));
  }
  if (state.native) {
    const native = state.native;
    const name = native.host === 'ghostty' ? 'Ghostty' : 'Kitty';
    const lines = [`${primary}  Cursor & effects › ${name} native${reset}`, '',
      `  ${secondary}${name} draws the cursor effect on the GPU. NMSh adds one line to your ${name} config, once; after that it only updates its own files.${reset}`, '',
      `  ${subtle}File${reset}      ${primary}${native.configPath}${reset}`];
    if (native.line) lines.push(`  ${subtle}Adds${reset}      ${foreground(UI_COLORS.success)}+ ${native.line}${reset}`);
    lines.push(`  ${subtle}Managed${reset}   ${secondary}NMSh's own fragment${native.host === 'ghostty' ? ' and shader' : ''} under its config folder${reset}`);
    if (native.related.length) lines.push(`  ${subtle}Kept${reset}      ${secondary}your existing ${native.related.length === 1 ? 'line' : 'lines'}: ${native.related.map(line => line.trim()).join(' · ')}${reset}`);
    lines.push('', `  ${subtle}Native effects apply to the whole ${name} surface, including vim and other programs, not only NMSh's input. Reload ${name}'s config to see them.${reset}`);
    if (native.blocked) lines.push('', `  ${secondary}${native.blocked}${reset}`);
    const yes = native.choice === 'yes';
    lines.push('', `  ${!yes ? `${accent}${GLYPHS.selection} No${reset}` : `${subtle}  No${reset}`}    ${yes ? `${accent}${GLYPHS.selection} Yes${reset}` : `${subtle}  Yes${reset}`}`, '',
      renderControls([['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]));
    return lines.map(row => truncateAnsi(row, columns));
  }
  const rows = visibleRows(state);
  const selected = Math.min(state.selected, rows.length - 1);
  const resolved = resolveCursorSettings(state.draft, env.context);
  const focus = previewFor(state, env);
  const shown = renderCursorPreview({scene: focus.scene, title: focus.title, settings: resolved, choice: env.choice, columns, elapsed: now - state.started, still: env.still,
    ...(focus.unavailable ? {unavailable: focus.unavailable} : {})});
  state.previewBusy = shown.busy;

  const head = [`${primary}  ${state.advanced ? 'Cursor & effects › Advanced' : 'Cursor & effects'}${reset}`,
    `  ${subtle}Presentation only: the caret always moves at once. Effects are Off by default.${reset}`, ''];
  const detail = rows[selected] ? (rows[selected]!.unavailable?.(state.draft, env) ?? rows[selected]!.detail?.(state.draft, env)) : undefined;
  const tail = ['', `  ${secondary}${state.message ?? detail ?? ''}${reset}`, '', renderControls(state.advanced ? [['↑↓', 'select'], ['←→', 'adjust'], ['R', 'replay'], ['Esc', state.embeddedAdvancedOnly ? 'done' : 'back']]
    : [['↑↓', 'select'], ['←→', 'change'], ['Enter', 'edit'], ['R', 'replay'], ['A', 'advanced'], ['Esc', state.embedded ? 'done' : 'close']])];
  // Height budget: the preview keeps its size while it fits; a short terminal drops the intro first, then the preview's note and title, then the preview, before the list shrinks.
  const layouts: Array<{head: string[]; preview: string[]; tail: string[]}> = [
    {head, preview: [...shown.rows, ''], tail},
    {head: [head[0]!], preview: [...shown.rows, ''], tail},
    {head: [head[0]!], preview: [shown.rows[2]!, shown.rows[3]!], tail: [tail[1]!, tail[3]!]},
    {head: [head[0]!], preview: [], tail: [tail[1]!, tail[3]!]},
  ];
  const need = (layout: typeof layouts[number]) => layout.head.length + layout.preview.length + layout.tail.length + rows.length;
  const layout = layouts.find(item => need(item) <= height) ?? layouts[layouts.length - 1]!;
  const room = Math.max(3, height - layout.head.length - layout.preview.length - layout.tail.length);
  const start = Math.max(0, Math.min(rows.length - room, selected - Math.floor(room / 2)));
  const list = rows.slice(start, start + room).map((row, offset) => {
    const index = start + offset;
    const isSelected = index === selected;
    const value = rowValue(row, state, env);
    const swatch = value.swatch ? `${colorEscape(38, parseHexColor(value.swatch)!)}■${reset} ` : '';
    const text = row.action ? `${isSelected ? accent : subtle}${value.text}${reset}`
      : !value.editable ? `${subtle}${value.text}${reset}`
      : isSelected ? `${accent}‹ ${value.text} ›${reset}` : `${secondary}${value.text}${reset}`;
    const indent = ['colorFamily', 'colorVariant', 'colorAccent', 'colorCustom', 'trailEdit', 'particleEdit'].includes(row.key) ? '  ' : '';
    return `${isSelected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${isSelected ? primary : secondary}${padCells(`${indent}${row.label}`, 22)}${reset}${swatch}${text}`;
  });
  return [...layout.head, ...layout.preview, ...list, ...layout.tail].map(row => truncateAnsi(row, columns));
}
