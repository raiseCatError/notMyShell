import type {Key} from '../terminal/keys.js';
import {background, focusForeground, foreground, UI_COLORS, lazyForeground, type RgbColor} from './palette.js';
import {displayWidth, truncateAnsi} from '../util/text.js';
import {GLYPHS, checkMark, getCurrentGlyphMode} from './glyphs.js';

/**
 * Terminal-native form controls. A control never stores or writes anything:
 * key handlers return the value the user is proposing (or undefined when the
 * key means nothing here) and the owning feature decides whether to persist it.
 * Rendering has a plain path (`color: false`) where focus, changed state and
 * errors are carried by text, not by color.
 */

// ---- Behavior -------------------------------------------------------------

export function toggleValue(current: boolean): boolean {
  return !current;
}

/** Index after moving `delta` steps through `count` options, wrapping at both ends. */
export function stepIndex(count: number, index: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** ←/→ (and Space/Enter as "next") on a select: the proposed option index. */
export function handleSelectKey(key: Key, count: number, index: number): number | undefined {
  if (key.kind === 'left') return stepIndex(count, index, -1);
  if (key.kind === 'right' || key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) return stepIndex(count, index, 1);
  return undefined;
}

/** Multi-select proposal: `selected` with `index` flipped, kept in option order. */
export function toggleMember(selected: readonly number[], index: number): number[] {
  return selected.includes(index) ? selected.filter(value => value !== index) : [...selected, index].sort((a, b) => a - b);
}

export interface MultiSelectState {cursor: number; selected: readonly number[]}

/** ↑↓ move the cursor; Space flips the option under it. Returns the next state, or undefined for other keys. */
export function handleMultiSelectKey(key: Key, count: number, state: MultiSelectState): MultiSelectState | undefined {
  if (key.kind === 'up') return {...state, cursor: stepIndex(count, state.cursor, -1)};
  if (key.kind === 'down') return {...state, cursor: stepIndex(count, state.cursor, 1)};
  if (key.kind === 'text' && key.value === ' ') return {...state, selected: toggleMember(state.selected, state.cursor)};
  return undefined;
}

/** Single-line text editing at the end of the value; the proposed text, or undefined for other keys. */
export function editText(value: string, key: Key): string | undefined {
  if (key.kind === 'text' || key.kind === 'paste') return value + key.value.replace(/[\r\n]/gu, '');
  if (key.kind === 'backspace') return [...value].slice(0, -1).join('');
  if (key.kind === 'deleteWord' || key.kind === 'deleteLineBefore') return '';
  return undefined;
}

export interface ConfirmState {choice: 'yes' | 'no'}

/** Confirmation starts on "no"; Enter accepts the highlighted choice, Esc always cancels. */
export function createConfirm(): ConfirmState {
  return {choice: 'no'};
}

export function handleConfirmKey(key: Key, state: ConfirmState): 'confirm' | 'cancel' | 'changed' | undefined {
  if (key.kind === 'escape') return 'cancel';
  if (key.kind === 'enter') return state.choice === 'yes' ? 'confirm' : 'cancel';
  if (key.kind === 'left' || key.kind === 'right' || key.kind === 'up' || key.kind === 'down') {
    state.choice = state.choice === 'yes' ? 'no' : 'yes';
    return 'changed';
  }
  if (key.kind === 'text') {
    const value = key.value.toLowerCase();
    if (value === 'y') { state.choice = 'yes'; return 'confirm'; }
    if (value === 'n') { state.choice = 'no'; return 'cancel'; }
  }
  return undefined;
}

// ---- Presentation ---------------------------------------------------------

export interface ControlLook {
  focused?: boolean;
  /** False for a plain path with no escape sequences. */
  color?: boolean;
}

const ACCENT = lazyForeground(UI_COLORS.accent);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const ERROR = lazyForeground(UI_COLORS.failure);
const INVERSE = '\u001B[7m';
const RESET = '\u001B[0m';

function tint(text: string, look: ControlLook): string {
  return look.color === false ? text : `${focusForeground(Boolean(look.focused))}${text}${RESET}`;
}

export function renderToggle(value: boolean, look: ControlLook = {}): string {
  return tint(`${checkMark(value)} ${value ? 'On' : 'Off'}`, look);
}

export function renderSelect(optionLabel: string, look: ControlLook = {}): string {
  return tint(`‹ ${optionLabel} ›`, look);
}

export function renderMultiSelect(options: readonly string[], selected: readonly number[], cursor: number | undefined, look: ControlLook = {}): string {
  return options.map((option, index) => {
    const marked = `${cursor === index && look.focused ? GLYPHS.selection : ' '}${checkMark(selected.includes(index))} ${option}`;
    return tint(marked, {...look, focused: look.focused && cursor === index});
  }).join('  ');
}

export function renderTextValue(value: string, placeholder: string, look: ControlLook = {}): string {
  const cursor = look.focused ? (look.color === false ? '_' : `${INVERSE} ${RESET}`) : '';
  if (!value) return look.color === false ? `${cursor}${placeholder}` : `${cursor}${SUBTLE}${placeholder}${RESET}`;
  return look.color === false ? `${value}${cursor}` : `${tint(value, look)}${cursor}`;
}

/**
 * What a confirmation is for. Color says what each button does (install green, uninstall red, other neutral); the
 * focus says which one Enter takes: a strong fill, bold high-contrast text and a pointer, while the other keeps a
 * quiet tint. No stays the default (createConfirm).
 */
export interface ConfirmLabels {
  yes?: string;
  no?: string;
  tone?: 'install' | 'destructive' | 'neutral';
}

const mix = (a: RgbColor, b: RgbColor, t: number): RgbColor =>
  ({red: Math.round(a.red + (b.red - a.red) * t), green: Math.round(a.green + (b.green - a.green) * t), blue: Math.round(a.blue + (b.blue - a.blue) * t)});
const DEEP: RgbColor = {red: 22, green: 21, blue: 28};
const LIGHT: RgbColor = {red: 250, green: 250, blue: 252};
const luminance = (c: RgbColor) => (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue) / 255;

function confirmTones(tone: NonNullable<ConfirmLabels['tone']>): {yes: RgbColor; no: RgbColor} {
  const neutral = UI_COLORS.secondary;
  if (tone === 'install') return {yes: UI_COLORS.success, no: mix(UI_COLORS.failure, neutral, 0.45)};
  if (tone === 'destructive') return {yes: UI_COLORS.failure, no: neutral};
  return {yes: UI_COLORS.accent, no: neutral};
}

/** The two buttons' parts: label text, and for color, each one's fill and ink. */
function confirmParts(state: ConfirmState, labels: ConfirmLabels) {
  const tones = confirmTones(labels.tone ?? 'neutral');
  return (['yes', 'no'] as const).map(id => {
    const focused = state.choice === id;
    const color = tones[id];
    const text = id === 'yes' ? labels.yes ?? 'Yes' : labels.no ?? 'No';
    const fill = focused ? color : mix(color, DEEP, 0.72);
    const ink = focused ? (luminance(color) > 0.45 ? DEEP : LIGHT) : mix(color, LIGHT, 0.25);
    const label = ` ${focused ? GLYPHS.selection : ' '} ${text}  `;
    return {focused, text, label, fill, ink};
  });
}

/** One row: the Yes and No buttons. The plain path has no escapes at all: brackets and a pointer carry the focus. */
export function renderConfirm(state: ConfirmState, look: ControlLook = {}, labels: ConfirmLabels = {}): string {
  const parts = confirmParts(state, labels);
  if (look.color === false) return parts.map(part => part.focused ? `[${part.label.trimEnd()} ]` : ` ${part.label.trimEnd()}  `).join(' ');
  return parts.map(part => `${background(part.fill)}${part.focused ? '\u001B[1m' : ''}${foreground(part.ink)}${part.label}${RESET}`).join('  ');
}

/**
 * The same buttons as /startup draws them, three rows tall: half blocks above and below in each button's fill make
 * it a sharp filled block. The plain path is the one-row form, with a blank row above and below.
 */
export function renderConfirmButtons(state: ConfirmState, look: ControlLook = {}, labels: ConfirmLabels = {}): string[] {
  if (look.color === false || getCurrentGlyphMode() !== 'nerd') return ['', renderConfirm(state, look, labels), ''];
  const parts = confirmParts(state, labels);
  const edge = (glyph: string) => parts.map(part => `${foreground(part.fill)}${glyph.repeat(displayWidth(part.label))}${RESET}`).join('  ');
  return [edge('▄'), renderConfirm(state, look, labels), edge('▀')];
}

export interface FieldFrame {
  label: string;
  /** Already rendered by one of the render* functions above. */
  control: string;
  description?: string;
  /** The proposal differs from the saved value. */
  changed?: boolean;
  /** Set when the proposal is invalid; shown as text, not only color. */
  error?: string;
  focused?: boolean;
  color?: boolean;
}

/** Label row, then description and error rows when present. Focus is a `>` marker; changed is `(changed)`. */
export function renderField(field: FieldFrame, columns: number): string[] {
  const plain = field.color === false;
  const pointer = field.focused ? (plain ? '>' : `${ACCENT}›${RESET}`) : ' ';
  const changed = field.changed ? (plain ? ' (changed)' : ` ${SUBTLE}(changed)${RESET}`) : '';
  const rows = [`${pointer} ${plain ? field.label : `${focusForeground(Boolean(field.focused))}${field.label}${RESET}`}  ${field.control}${changed}`];
  if (field.description) rows.push(plain ? `  ${field.description}` : `  ${SUBTLE}${field.description}${RESET}`);
  if (field.error) rows.push(plain ? `  Error: ${field.error}` : `  ${ERROR}Error: ${field.error}${RESET}`);
  return rows.map(row => (plain && displayWidth(row) > columns ? [...row].slice(0, columns).join('') : truncateAnsi(row, columns)));
}
