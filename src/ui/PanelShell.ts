import {foreground, UI_COLORS} from './palette.js';
import {displayWidth, repeatToWidth, truncateAnsi} from '../util/text.js';
import {GLYPHS} from './glyphs.js';

const RESET = '\u001B[0m';
const BOLD = '\u001B[1m';
const UNDERLINE = '\u001B[4m';
const TAB_GAP = '   ';
const INDENT = '  ';

export interface PanelShellOptions {
  title: string;
  content: string[];
  columns: number;
  footer?: string;
  tabs?: readonly string[];
  selectedTab?: number;
  /** A pre-rendered search field row (see SettingsPanel), shown below the tabs. */
  searchRow?: string;
}

/**
 * Panel anatomy: separator, title, tabs, search, content, footer. All shell
 * rows are ephemeral presentation rows, never transcript, PTY, resume, or
 * copy data.
 */
export function renderPanelShell(options: PanelShellOptions): string[] {
  const {title, content, columns, footer, tabs, selectedTab = 0, searchRow} = options;
  const rows = framePanel([`${BOLD}${foreground(UI_COLORS.primary)}${INDENT}${title}${RESET}`], columns);
  if (tabs?.length) rows.push('', renderTabStrip(tabs, selectedTab, columns));
  if (searchRow !== undefined) rows.push('', searchRow);
  rows.push('', ...content);
  if (footer) rows.push('', footer);
  return rows.map(row => truncateAnsi(row, columns));
}

/** Rows the shell adds around `content`, so callers can budget list height. */
export function panelShellChrome(options: {tabs: boolean; search: boolean; footer: boolean}): number {
  return 3 + (options.tabs ? 2 : 0) + (options.search ? 2 : 0) + (options.footer ? 2 : 0);
}

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
 * One row of tabs, never wrapped. The active tab is accent, bold, and
 * underlined; the rest are muted. Overflow is windowed around the active tab
 * and marked with quiet `‹` / `›` indicators.
 */
export function renderTabStrip(tabs: readonly string[], selected: number, columns: number): string {
  const width = Math.max(1, columns);
  const {start, end} = tabWindow(tabs.map(tab => displayWidth(tab)), selected, width);
  const muted = foreground(UI_COLORS.subtle);
  let line = start > 0 ? `${muted}‹ ${RESET}` : INDENT;
  for (let index = start; index <= end; index++) {
    if (index > start) line += TAB_GAP;
    line += index === selected
      ? `${BOLD}${UNDERLINE}${foreground(UI_COLORS.accent)}${tabs[index]}${RESET}`
      : `${muted}${tabs[index]}${RESET}`;
  }
  if (end < tabs.length - 1) line += `${muted} ›${RESET}`;
  return truncateAnsi(line, width);
}

/** Framing belongs to the live overlay, never to OutputBuffer or an archive. */
export function framePanel(rows: string[], columns: number): string[] {
  return [`${foreground(UI_COLORS.separator)}${repeatToWidth(GLYPHS.separator, Math.max(1, columns))}${RESET}`, ...rows];
}
