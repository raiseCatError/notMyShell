import {paintTreatment, type TreatmentSettings} from '../chroma/treatment.js';
import {background, foreground, UI_COLORS} from './palette.js';
import {truncateAnsi, displayWidth} from '../util/text.js';
import {theme} from '../chroma/chroma.js';
import {renderSurface} from './surface.js';
import {colorLevel} from '../presentation/capabilities.js';

const RESET = '\u001B[0m';
const BOLD = '\u001B[1m';
const TAB_GAP = ' ';
const INDENT = '  ';

/**
 * The widest contiguous run of tabs around `selected` that fits `columns`,
 * with room reserved for the `‹` / `›` overflow markers it needs.
 */
export function tabWindow(widths: readonly number[], selected: number, columns: number): {start: number; end: number} {
  const fits = (start: number, end: number) => {
    let used = INDENT.length + (end < widths.length - 1 ? 2 : 0);
    for (let index = start; index <= end; index++) used += widths[index]! + (index > start ? TAB_GAP.length : 0);
    return used <= columns;
  };
  let start = selected;
  let end = selected;
  for (let grew = true; grew;) {
    grew = false;
    if (end + 1 < widths.length && fits(start, end + 1)) { end++; grew = true; }
    if (start > 0 && fits(start - 1, end)) { start--; grew = true; }
  }
  return {start, end};
}

/**
 * One row of padded tabs, never wrapped. The active tab is a filled lavender
 * block: bright lavender while the tab row has keyboard focus, deep lavender
 * otherwise. Overflow windows around the active tab with quiet `‹` / `›`.
 */
export function renderTabStrip(tabs: readonly string[], selected: number, columns: number, focused = false): string {
  const width = Math.max(1, columns);
  const labels = tabs.map(tab => ` ${tab} `);
  const {start, end} = tabWindow(labels.map(label => displayWidth(label)), selected, width);
  const muted = foreground(UI_COLORS.secondary);
  const active = focused
    ? `${BOLD}${background(UI_COLORS.accent)}${foreground(UI_COLORS.projectBackground)}`
    : `${BOLD}${background(UI_COLORS.projectBackground)}${foreground(UI_COLORS.projectForeground)}`;
  let line = start > 0 ? `${foreground(UI_COLORS.subtle)}‹ ${RESET}` : INDENT;
  for (let index = start; index <= end; index++) {
    if (index > start) line += TAB_GAP;
    line += `${index === selected ? active : muted}${labels[index]}${RESET}`;
  }
  if (end < tabs.length - 1) line += `${foreground(UI_COLORS.subtle)} ›${RESET}`;
  return truncateAnsi(line, width);
}

/**
 * The strong selected-row treatment, shared with the active tab: one
 * full-width deep-lavender band with the theme's project foreground. Without
 * color it is reverse video, so the selection never depends on color alone.
 * Every reset inside the row re-opens the band, so styled parts stay on it.
 */
export function selectedRowBand(row: string, columns: number): string {
  const none = colorLevel() === 'none';
  const band = none ? '\u001B[7m' : `${background(UI_COLORS.projectBackground)}${foreground(UI_COLORS.projectForeground)}`;
  const body = truncateAnsi(row, columns).replaceAll(RESET, `${RESET}${band}`);
  return `${band}${body}${band}${' '.repeat(Math.max(0, columns - displayWidth(body)))}${RESET}`;
}

/** Foreground for quiet text on the selected band: readable on it, never the dim muted gray. */
export function onSelectedBand(): string {
  return colorLevel() === 'none' ? '' : foreground(UI_COLORS.projectForeground);
}

/** Framing belongs to the live overlay, never to OutputBuffer or an archive. */
export function framePanel(rows: string[], columns: number, treatment?: TreatmentSettings): string[] {
  const framed = renderSurface(rows, columns, {frame: 'topLine', frameColor: theme('separator')});
  if (treatment && treatment.preset !== 'off') framed[0] = paintTreatment(framed[0]!.replace(/\u001B\[[0-9;]*m/gu, ''), treatment, 'panel-frame', UI_COLORS.separator);
  return framed;
}
