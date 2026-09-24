import {foreground, UI_COLORS} from './palette.js';
import {displayWidth, repeatToWidth, truncateAnsi} from '../util/text.js';
import {GLYPHS} from './glyphs.js';

const RESET = '\u001B[0m';

export interface PanelShellOptions {
  title: string;
  content: string[];
  columns: number;
  footer?: string;
  tabs?: readonly string[];
  selectedTab?: number;
  search?: string;
}

/** All shell rows are ephemeral presentation rows, never transcript data. */
export function renderPanelShell(options: PanelShellOptions): string[] {
  const {title, content, columns, footer, tabs, selectedTab = 0, search} = options;
  const rows = framePanel([`${foreground(UI_COLORS.primary)}  ${title}${RESET}`], columns);
  if (tabs?.length) rows.push(renderTabStrip(tabs, selectedTab, columns));
  if (search !== undefined) rows.push(`${foreground(UI_COLORS.subtle)}  Search: ${search || 'type to filter'}${RESET}`);
  rows.push('', ...content);
  if (footer) rows.push('', footer);
  return rows.map(row => truncateAnsi(row, columns));
}

/** A single windowed line; the active tab remains visible even at small widths. */
export function renderTabStrip(tabs: readonly string[], selected: number, columns: number): string {
  const width = Math.max(1, columns);
  const labels = tabs.map((tab, index) =>
    `${index === selected ? foreground(UI_COLORS.accent) : foreground(UI_COLORS.secondary)}${index === selected ? '[' : ' '}${tab}${index === selected ? ']' : ' '}${RESET}`);
  let start = 0;
  for (; start <= selected; start++) {
    const prefix = start > 0 ? '‹ ' : '  ';
    const used = displayWidth(prefix) + labels.slice(start, selected + 1).reduce((sum, label) => sum + displayWidth(label) + 1, 0);
    if (used <= width || start === selected) break;
  }
  let line = start > 0 ? '‹ ' : '  ';
  for (let index = start; index < labels.length; index++) {
    const more = index < labels.length - 1 ? ' ›' : '';
    if (displayWidth(line) + displayWidth(labels[index]!) + displayWidth(more) > width && index > selected) break;
    line += labels[index]! + ' ';
    if (displayWidth(line) >= width) break;
  }
  return truncateAnsi(line, width);
}

/** Framing belongs to the live overlay, never to OutputBuffer or an archive. */
export function framePanel(rows: string[], columns: number): string[] {
  return [`${foreground(UI_COLORS.separator)}${repeatToWidth(GLYPHS.separator, Math.max(1, columns))}${RESET}`, ...rows];
}
