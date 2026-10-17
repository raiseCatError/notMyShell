import type {Key} from '../terminal/keys.js';
import {MAX_CUSTOM_STOPS, MIN_CUSTOM_STOPS} from '../chroma/treatment.js';
import {parseHexColor} from '../chroma/color.js';
import {colorEscape} from '../chroma/escape.js';
import {focusForeground, foreground, lazyForeground, UI_COLORS} from './palette.js';
import {COLOR_PRESET_IDS, COLOR_PRESET_LABELS, COLOR_PRESET_STOPS, colorPresetOf} from '../chroma/colorPresets.js';
import {getCurrentGlyphMode} from './glyphs.js';

/**
 * The one custom-gradient stop editor: Chroma's Custom gradient, idle visuals'
 * Custom colors and Live activity's Custom colors all edit stops here.
 * A working copy of plain hex stops, never executable.
 */
export interface GradientEditorState {
  stops: string[];
  index: number;
  /** Hex text being typed for the selected stop; undefined when not editing. */
  editing?: string;
  error?: string;
}

/** Normalize typed hex (with or without #); undefined when invalid. */
export function parseStopInput(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  const hex = text.startsWith('#') ? text : `#${text}`;
  return parseHexColor(hex) ? hex : undefined;
}

/**
 * Stop editor keys. ↑↓ select · Enter edit/confirm hex · P/Shift+P next/previous preset · A add · D/Delete
 * remove · Shift+↑↓ reorder · R reset to `resetStops`. Returns whether the key was used; the caller owns
 * apply (S) and cancel (Esc).
 */
export function gradientEditorKey(gradient: GradientEditorState, key: Key, resetStops: () => readonly string[]): boolean {
  if (gradient.editing !== undefined) {
    if (key.kind === 'enter') {
      const value = parseStopInput(gradient.editing);
      if (!value) { gradient.error = 'Use a hex color like #a67cf3'; return true; }
      gradient.stops[gradient.index] = value;
      gradient.editing = undefined;
      gradient.error = undefined;
      return true;
    }
    if (key.kind === 'escape') { gradient.editing = undefined; gradient.error = undefined; return true; }
    if (key.kind === 'backspace') { gradient.editing = [...gradient.editing].slice(0, -1).join(''); return true; }
    if ((key.kind === 'text' || key.kind === 'paste') && /^[#0-9a-f]*$/iu.test(key.value)) {
      gradient.editing = (gradient.editing + key.value).slice(0, 7);
      gradient.error = undefined;
      return true;
    }
    return key.kind === 'text' || key.kind === 'paste';
  }
  const count = gradient.stops.length;
  if (key.kind === 'up') gradient.index = (gradient.index - 1 + count) % count;
  else if (key.kind === 'down') gradient.index = (gradient.index + 1) % count;
  else if (key.kind === 'selectUp' || key.kind === 'selectDown') {
    const target = gradient.index + (key.kind === 'selectUp' ? -1 : 1);
    if (target < 0 || target >= count) return true;
    [gradient.stops[gradient.index], gradient.stops[target]] = [gradient.stops[target]!, gradient.stops[gradient.index]!];
    gradient.index = target;
  } else if (key.kind === 'enter') {
    gradient.editing = gradient.stops[gradient.index]!;
  } else if (key.kind === 'text' && /^[aA]$/u.test(key.value)) {
    if (count >= MAX_CUSTOM_STOPS) { gradient.error = `At most ${MAX_CUSTOM_STOPS} stops`; return true; }
    gradient.stops.splice(gradient.index + 1, 0, gradient.stops[gradient.index]!);
    gradient.index += 1;
    gradient.editing = gradient.stops[gradient.index]!;
  } else if ((key.kind === 'text' && /^[dD]$/u.test(key.value)) || key.kind === 'delete') {
    if (count <= MIN_CUSTOM_STOPS) { gradient.error = `At least ${MIN_CUSTOM_STOPS} stops`; return true; }
    gradient.stops.splice(gradient.index, 1);
    gradient.index = Math.min(gradient.index, gradient.stops.length - 1);
  } else if (key.kind === 'text' && /^[rR]$/u.test(key.value)) {
    gradient.stops = [...resetStops()];
    gradient.index = 0;
  } else if (key.kind === 'text' && /^[pP]$/u.test(key.value)) {
    // The named presets: Lavender, Purple, Blue, Cyan, Teal, Green, Amber, Orange, Rose, White.
    const current = colorPresetOf(gradient.stops);
    const at = current ? COLOR_PRESET_IDS.indexOf(current) : -1;
    const count = COLOR_PRESET_IDS.length;
    const next = COLOR_PRESET_IDS[key.value === 'P' ? (at <= 0 ? count - 1 : at - 1) : (at + 1) % count]!;
    gradient.stops = [...COLOR_PRESET_STOPS[next]];
    gradient.index = Math.min(gradient.index, gradient.stops.length - 1);
  } else return false;
  gradient.error = undefined;
  return true;
}

const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const ACCENT = lazyForeground(UI_COLORS.accent);
const RESET = '\u001B[0m';
const INVERSE = '\u001B[7m';

/** A live preview of the stops as one blended bar. */
function previewBar(stops: readonly string[], width: number): string {
  const colors = stops.map(stop => parseHexColor(stop)).filter((color): color is NonNullable<typeof color> => Boolean(color));
  if (!colors.length) return '';
  const cell = getCurrentGlyphMode() === 'nerd' ? '█' : '#';
  let bar = '';
  for (let i = 0; i < width; i++) {
    const at = colors.length === 1 ? 0 : (i / Math.max(1, width - 1)) * (colors.length - 1);
    const low = colors[Math.floor(at)]!, high = colors[Math.min(colors.length - 1, Math.ceil(at))]!, t = at - Math.floor(at);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    bar += `${colorEscape(38, {red: mix(low.red, high.red), green: mix(low.green, high.green), blue: mix(low.blue, high.blue)})}${cell}`;
  }
  return `${bar}${RESET}`;
}

/** The editor's rows: a heading, the preset and a live preview bar, one row per stop with its swatch and hex, and any error. */
export function renderGradientEditorRows(gradient: GradientEditorState, title: string): string[] {
  const preset = colorPresetOf(gradient.stops);
  const rows = [`${PRIMARY}${title}${RESET}  ${SUBTLE}${gradient.stops.length} of ${MIN_CUSTOM_STOPS}–${MAX_CUSTOM_STOPS} stops · hex colors only${RESET}`,
    `  ${SUBTLE}Preset${RESET}  ${PRIMARY}${preset ? COLOR_PRESET_LABELS[preset] : 'Custom'}${RESET}  ${SUBTLE}P changes it${RESET}`,
    `  ${previewBar(gradient.stops, 24)}`];
  gradient.stops.forEach((stop, index) => {
    const selected = index === gradient.index;
    const swatch = `${colorEscape(38, parseHexColor(stop)!)}████${RESET}`;
    const editing = selected && gradient.editing !== undefined
      ? `${ACCENT}${gradient.editing}${INVERSE} ${RESET}` : `${focusForeground(selected)}${stop}`;
    rows.push(`${selected ? `${ACCENT}›` : ' '} ${SECONDARY}${String(index + 1).padStart(2)}${RESET}  ${swatch}  ${editing}${RESET}`);
  });
  if (gradient.error) rows.push(`  ${foreground(UI_COLORS.failure)}${gradient.error}${RESET}`);
  return rows;
}

/** `apply`: the caller applies with S and cancels with Esc (the custom-color editors); otherwise Esc is done. */
export function gradientEditorControls(gradient: GradientEditorState, apply = false): Array<[string, string]> {
  if (gradient.editing !== undefined) return [['0-9 a-f', 'type hex'], ['Enter', 'set'], ['Esc', 'cancel edit']];
  return [['↑↓', 'stop'], ['Enter', 'edit hex'], ['P', 'preset'], ['A', 'add'], ['D', 'remove'], ['Shift+↑↓', 'reorder'], ['R', 'reset'],
    ...(apply ? [['S', 'apply'], ['Esc', 'cancel']] as Array<[string, string]> : [['Esc', 'done']] as Array<[string, string]>)];
}

/** S (outside hex typing) applies a custom-color editor. */
export const isApplyKey = (gradient: GradientEditorState, key: Key): boolean =>
  gradient.editing === undefined && key.kind === 'text' && /^[sS]$/u.test(key.value);
