import {background, foreground, UI_COLORS} from './palette.js';
import {repeatToWidth, truncateAnsi, displayWidth} from '../util/text.js';
import {GLYPHS} from './glyphs.js';

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

/** Framing belongs to the live overlay, never to OutputBuffer or an archive. */
export function framePanel(rows: string[], columns: number): string[] {
  return [`${foreground(UI_COLORS.separator)}${repeatToWidth(GLYPHS.separator, Math.max(1, columns))}${RESET}`, ...rows];
}
