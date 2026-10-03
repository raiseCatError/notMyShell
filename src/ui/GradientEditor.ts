import type {Key} from '../terminal/keys.js';
import {MAX_CUSTOM_STOPS, MIN_CUSTOM_STOPS} from '../chroma/treatment.js';
import {parseHexColor} from '../chroma/color.js';
import {colorEscape} from '../chroma/escape.js';
import {foreground, lazyForeground, UI_COLORS} from './palette.js';

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
 * Stop editor keys. ↑↓ select · Enter edit/confirm hex · A add · D/Delete
 * remove · Shift+↑↓ reorder · R reset to `resetStops`. Returns whether the key was used.
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

/** The editor's rows: a heading, one row per stop with its swatch, and any error. */
export function renderGradientEditorRows(gradient: GradientEditorState, title: string): string[] {
  const rows = [`${PRIMARY}${title}${RESET}  ${SUBTLE}${gradient.stops.length} of ${MIN_CUSTOM_STOPS}–${MAX_CUSTOM_STOPS} stops · hex colors only${RESET}`];
  gradient.stops.forEach((stop, index) => {
    const selected = index === gradient.index;
    const swatch = `${colorEscape(38, parseHexColor(stop)!)}████${RESET}`;
    const editing = selected && gradient.editing !== undefined
      ? `${ACCENT}${gradient.editing}${INVERSE} ${RESET}` : `${selected ? PRIMARY : SECONDARY}${stop}`;
    rows.push(`${selected ? `${ACCENT}›` : ' '} ${SECONDARY}${String(index + 1).padStart(2)}${RESET}  ${swatch}  ${editing}${RESET}`);
  });
  if (gradient.error) rows.push(`  ${foreground(UI_COLORS.failure)}${gradient.error}${RESET}`);
  return rows;
}

export function gradientEditorControls(gradient: GradientEditorState): Array<[string, string]> {
  if (gradient.editing !== undefined) return [['0-9 a-f', 'type hex'], ['Enter', 'apply'], ['Esc', 'cancel edit']];
  return [['↑↓', 'stop'], ['Enter', 'edit'], ['A', 'add'], ['D', 'remove'], ['Shift+↑↓', 'reorder'], ['R', 'reset'], ['Esc', 'done']];
}
