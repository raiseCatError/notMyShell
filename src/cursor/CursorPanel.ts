import type {Key} from '../terminal/keys.js';
import {CURSOR_BLINKS, CURSOR_EASINGS, CURSOR_EFFECTS, CURSOR_IDLE_EFFECTS, CURSOR_LEVELS, CURSOR_MOTIONS, CURSOR_RENDERERS, CURSOR_SHAPES,
  CURSOR_COLOR_SOURCES, type CursorAdvanced, type CursorSettings} from '../prompt/configuration.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {overlayRow} from '../presentation/cellOverlay.js';
import {CursorEngine, seededRandom} from './CursorEngine.js';
import {effectPalette} from './palette.js';
import type {BackendChoice} from './backends.js';

/**
 * /cursor: the canonical cursor & effects surface. Normal rows cover what
 * people change; Advanced (A) holds the physics. The preview runs the real
 * engine on a sample command whose caret moves through typing, Home/End and
 * word jumps, then rests (movement, settling, idle), so what you see is what
 * the composer does.
 */
export interface CursorPanelState {
  draft: CursorSettings;
  selected: number;
  advanced: boolean;
  /** The preview's own engine and clock origin (never the composer's). */
  preview: CursorEngine;
  started: number;
  message?: string;
  /** Host-native setup awaiting the person's Yes: the exact file, the one line, what else touches the feature. */
  native?: {host: 'ghostty' | 'kitty'; configPath: string; line?: string; related: string[]; blocked?: string; choice: 'yes' | 'no'};
}

type Row = {key: string; label: string; values?: readonly string[]; get: (draft: CursorSettings) => string; set?: (draft: CursorSettings, value: string) => void; action?: 'native' | 'advanced'};

const LABELS: Record<string, string> = {host: 'Host default', block: 'Block', bar: 'Bar', underline: 'Underline', on: 'On', off: 'Off', auto: 'Auto', portable: 'Portable', native: 'Host native',
  smooth: 'Smooth', smear: 'Smear', tail: 'Tail', none: 'None', fire: 'Fire', sparks: 'Sparks', lightning: 'Lightning', railgun: 'Railgun', ripple: 'Ripple', wireframe: 'Wireframe',
  glow: 'Glow', embers: 'Embers', flame: 'Flame', accent: 'NMSh accent', theme: 'Theme', custom: 'Custom', low: 'Low', medium: 'Medium', high: 'High',
  cursor: 'Follow cursor', gradient: 'Gradient', trail: 'Follow trail', 'out-cubic': 'Ease out', 'out-expo': 'Ease out (sharp)', linear: 'Linear', spring: 'Spring'};
export const cursorLabel = (value: string) => LABELS[value] ?? value;

const NORMAL: Row[] = [
  {key: 'shape', label: 'Shape', values: CURSOR_SHAPES, get: d => d.shape, set: (d, v) => { d.shape = v as CursorSettings['shape']; }},
  {key: 'blink', label: 'Blink', values: CURSOR_BLINKS, get: d => d.blink, set: (d, v) => { d.blink = v as CursorSettings['blink']; }},
  {key: 'renderer', label: 'Renderer', values: CURSOR_RENDERERS, get: d => d.renderer, set: (d, v) => { d.renderer = v as CursorSettings['renderer']; }},
  {key: 'motion', label: 'Motion', values: CURSOR_MOTIONS, get: d => d.motion, set: (d, v) => { d.motion = v as CursorSettings['motion']; }},
  {key: 'effect', label: 'Effect', values: CURSOR_EFFECTS, get: d => d.effect, set: (d, v) => { d.effect = v as CursorSettings['effect']; }},
  {key: 'idle', label: 'Idle effect', values: CURSOR_IDLE_EFFECTS, get: d => d.idleEffect, set: (d, v) => { d.idleEffect = v as CursorSettings['idleEffect']; }},
  {key: 'color', label: 'Color', values: CURSOR_COLOR_SOURCES, get: d => d.color.source, set: (d, v) => { d.color = {...d.color, source: v as CursorSettings['color']['source']}; }},
  {key: 'speed', label: 'Speed', values: CURSOR_LEVELS, get: d => d.speed, set: (d, v) => { d.speed = v as CursorSettings['speed']; }},
  {key: 'intensity', label: 'Intensity', values: CURSOR_LEVELS, get: d => d.intensity, set: (d, v) => { d.intensity = v as CursorSettings['intensity']; }},
  {key: 'trailLength', label: 'Trail length', values: CURSOR_LEVELS, get: d => d.trailLength, set: (d, v) => { d.trailLength = v as CursorSettings['trailLength']; }},
  {key: 'particles', label: 'Particles', values: CURSOR_LEVELS, get: d => d.particleAmount, set: (d, v) => { d.particleAmount = v as CursorSettings['particleAmount']; }},
  {key: 'nativeSetup', label: 'Host native setup', get: () => '', action: 'native'},
  {key: 'advancedRow', label: 'Advanced', get: () => '', action: 'advanced'},
];

const numeric = (key: keyof CursorAdvanced, label: string, step: number, min: number, max: number, unit = ''): Row => ({key, label,
  get: d => `${d.advanced[key]}${unit}`,
  set: (d, direction) => { const current = d.advanced[key] as number; d.advanced = {...d.advanced, [key]: Math.round(Math.min(max, Math.max(min, current + (direction === '+' ? step : -step))) * 1000) / 1000}; }});

const ADVANCED: Row[] = [
  numeric('shortMoveMs', 'Short-move duration', 10, 0, 200, ' ms'), numeric('longMoveMs', 'Long-move duration', 10, 40, 600, ' ms'),
  {key: 'easing', label: 'Easing', values: CURSOR_EASINGS, get: d => d.advanced.easing, set: (d, v) => { d.advanced = {...d.advanced, easing: v as CursorAdvanced['easing']}; }},
  numeric('stiffness', 'Stiffness', 0.05, 0.05, 1), numeric('tailStiffness', 'Tail stiffness', 0.05, 0.05, 1), numeric('damping', 'Damping', 0.05, 0.1, 1),
  numeric('trailExponent', 'Trail exponent', 0.1, 0.5, 4), numeric('maxTrail', 'Max trail', 2, 2, 80, ' cells'), numeric('moveThreshold', 'Movement threshold', 1, 0, 8, ' cells'),
  numeric('dwellMs', 'Dwell threshold', 100, 0, 5000, ' ms'), numeric('particleDensity', 'Particle density', 0.1, 0, 4), numeric('particleLifetimeMs', 'Particle lifetime', 20, 100, 2000, ' ms'),
  numeric('spread', 'Spread', 0.1, 0, 2), numeric('particleSpeed', 'Particle speed', 0.1, 0.1, 4), numeric('drag', 'Drag', 0.02, 0.5, 1), numeric('gravity', 'Gravity', 0.1, -2, 2),
  numeric('fps', 'Frame cadence', 6, 12, 120, ' fps'),
];

export function createCursorPanel(settings: CursorSettings, now = Date.now()): CursorPanelState {
  const draft = structuredClone(settings);
  return {draft, selected: 0, advanced: false, preview: new CursorEngine(draft, seededRandom(7)), started: now};
}

export type CursorPanelAction = {kind: 'close'} | {kind: 'apply'; settings: CursorSettings} | {kind: 'native'} | {kind: 'nativeConfirm'};

export function cursorPanelKey(state: CursorPanelState, key: Key): CursorPanelAction | undefined {
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
  const rows = state.advanced ? ADVANCED : NORMAL;
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.advanced) { state.advanced = false; state.selected = NORMAL.length - 1; return undefined; }
    return {kind: 'close'};
  }
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + rows.length) % rows.length; state.message = undefined; return undefined; }
  if (key.kind === 'text' && key.value.toLowerCase() === 'a' && !state.advanced) { state.advanced = true; state.selected = 0; return undefined; }
  const row = rows[Math.min(state.selected, rows.length - 1)]!;
  if (row.action && (key.kind === 'enter' || key.kind === 'right')) {
    if (row.action === 'advanced') { state.advanced = true; state.selected = 0; return undefined; }
    return {kind: 'native'};
  }
  if ((key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') && row.set) {
    const back = key.kind === 'left';
    if (row.values) {
      const index = row.values.indexOf(row.get(state.draft));
      row.set(state.draft, row.values[(index + (back ? -1 : 1) + row.values.length) % row.values.length]!);
    } else row.set(state.draft, back ? '-' : '+');
    // Changes preview at once and apply at once (the composer follows); nothing is ever hidden behind Save.
    state.preview.configure(state.draft);
    return {kind: 'apply', settings: structuredClone(state.draft)};
  }
  return undefined;
}

/** The preview's synthetic caret script: typing, Home, End, word jumps, then rest (one cycle ≈ 6 s). */
const SAMPLE = 'git commit -m "ship the cursor"';
const SCRIPT: Array<{at: number; column: number; cause: 'typing' | 'jump'}> = [
  ...Array.from({length: 10}, (_, index) => ({at: 120 * index, column: index + 1, cause: 'typing' as const})),
  {at: 1500, column: 0, cause: 'jump'}, {at: 2300, column: SAMPLE.length, cause: 'jump'}, {at: 3000, column: 15, cause: 'jump'},
  {at: 3600, column: 4, cause: 'jump'}, {at: 4200, column: SAMPLE.length, cause: 'jump'},
];
export const PREVIEW_CYCLE_MS = 6500;

export function previewCaret(elapsed: number): {column: number; cause: 'typing' | 'jump'} {
  const t = elapsed % PREVIEW_CYCLE_MS;
  let step = SCRIPT[0]!;
  for (const item of SCRIPT) if (item.at <= t) step = item;
  return {column: step.column, cause: step.cause};
}

export function renderCursorPanel(state: CursorPanelState, columns: number, now: number, choice: BackendChoice, still: boolean): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
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
  const rows = [`${primary}  ${state.advanced ? 'Cursor & effects › Advanced' : 'Cursor & effects'}${reset}`,
    `  ${subtle}Presentation only: the caret always moves at once; effects follow. Off by default; no surprise animation.${reset}`, ''];
  // Live preview with the real engine (row 0 of its own little frame).
  const caret = previewCaret(now - state.started);
  const sample = `${accent}${GLYPHS.prompt}${reset} ${primary}${SAMPLE}${reset}`;
  let previewRow = `    ${sample}`;
  let label = 'Effects stay still (Reduced Motion or Decorative Effects Off)';
  if (!still) {
    state.preview.target({row: 0, column: 6 + caret.column}, now, caret.cause);
    state.preview.step(now);
    const paints = state.preview.paints(effectPalette(state.draft), {top: 0, bottom: 0, columns: columns - 2}, now).get(0) ?? new Map();
    if (!state.preview.drawsCaret) paints.set(6 + caret.column, {...paints.get(6 + caret.column), background: effectPalette(state.draft).caret, caret: true});
    previewRow = overlayRow(previewRow, paints, columns - 2);
    label = `${state.preview.phase === 'movement' ? 'Movement' : state.preview.phase === 'settling' ? 'Settling' : 'Idle'} · ${choice.reason}`;
  }
  rows.push(`  ${subtle}Preview${reset}`, previewRow, `    ${subtle}${label}${reset}`, '');
  const list = state.advanced ? ADVANCED : NORMAL;
  list.forEach((row, index) => {
    const selected = index === state.selected;
    const value = row.action === 'native' ? `${subtle}${choice.backend.id === 'portable' ? 'Ghostty / Kitty: set up their GPU cursor (shown before any change)' : choice.reason}${reset}`
      : row.action === 'advanced' ? `${subtle}Physics and pacing ›${reset}`
      : selected ? `${accent}‹ ${cursorLabel(row.get(state.draft))} ›${reset}` : `${secondary}${cursorLabel(row.get(state.draft))}${reset}`;
    rows.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${selected ? primary : secondary}${padCells(row.label, 22)}${reset}${value}`);
  });
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls(state.advanced ? [['↑↓', 'select'], ['←→', 'adjust'], ['Esc', 'back']] : [['↑↓', 'select'], ['←→', 'change'], ['A', 'advanced'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
