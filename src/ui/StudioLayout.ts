import {framePanel, renderTabStrip, selectedRowBand} from './PanelShell.js';
import {groupLines, groupedWindow} from './groupedList.js';
import {renderControlRows} from './controls.js';
import {foreground, UI_COLORS} from './palette.js';
import {GLYPHS} from './glyphs.js';
import {displayWidth, padCells, truncateAnsi} from '../util/text.js';
import {stripTerminalControls} from '../util/terminalControls.js';

const RESET = '\u001b[0m';
export const studioLabel = (text: string) => `${foreground(UI_COLORS.accent)}${text}${RESET}`;
export const studioMuted = (text: string) => `${foreground(UI_COLORS.subtle)}${text}${RESET}`;
export interface StudioEntry {group: string; label: string; value?: string; render?(width: number): string}
export type StudioControl = readonly [string, string];

/** Wrap untrusted document text in cells, preserving every visible character. */
export function studioWrap(text: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const char of stripTerminalControls(text)) {
    if (displayWidth(row + char) > Math.max(1, width) && row) {
      const space = row.lastIndexOf(' ');
      if (space > 0) { rows.push(row.slice(0, space + 1)); row = row.slice(space + 1); }
      else { rows.push(row); row = ''; }
    }
    row += char;
  }
  rows.push(row);
  return rows;
}

export function studioColumns(columns: number, height: number): {list: number; detail: number} {
  const wide = columns >= 100 && height >= 18;
  const list = wide ? Math.floor((columns - 3) * 0.48) : columns;
  return {list, detail: wide ? columns - list - 3 : columns};
}

export interface StudioLayout {
  title: string; subtitle?: string; tabs?: {labels: string[]; selected: number};
  entries: StudioEntry[]; selected: number; controls: readonly StudioControl[];
  /** Important notices survive ahead of optional explanations and previews. */
  notice?: string;
  /** Unbounded document/diagnostic callers can request the full stacked catalogue. */
  stacked?: boolean;
  details?(width: number, height: number): string[];
  /** Coordinates of the detail body, for graphics owners that already handle image placement. */
  detailOrigin?(x: number, y: number): void;
}

/** One responsive shell for studio browsers and editors; footer space is allocated first. */
export function renderStudioLayout(model: StudioLayout, columns: number, height = 48): string[] {
  if (height <= 0 || columns <= 0) return [];
  if (height < 10 || columns < 24) {
    const controls = renderControlRows(model.controls.filter(([key]) => key === 'Esc' || key === 'Enter'), columns);
    const entry = model.entries[model.selected];
    const row = entry ? `${GLYPHS.selection} ${entry.render?.(Math.max(1, columns - 2)) ?? `${entry.label} ${entry.value ?? ''}`}` : 'Resize to edit';
    if (height < 4) return [truncateAnsi(model.title, columns), ...controls].slice(-height);
    return framePanel([truncateAnsi(model.title, columns), truncateAnsi(row, columns), ...controls], columns).slice(0, height);
  }
  const footer = renderControlRows(model.controls, columns);
  const head = [studioLabel(model.title),
    ...(model.subtitle && height >= 12 ? [studioMuted(truncateAnsi(model.subtitle, columns))] : []),
    ...(model.tabs ? [renderTabStrip(model.tabs.labels, model.tabs.selected, columns)] : [])];
  const notices = model.notice ? studioWrap(model.notice, columns).slice(0, height >= 24 ? 2 : 1).map(studioMuted) : [];
  const budget = Math.max(1, height - 1 - head.length - notices.length - footer.length - 1);
  const widths = model.stacked || !model.details ? {list: columns, detail: columns} : studioColumns(columns, height);
  const wide = widths.list !== columns && Boolean(model.details);
  const detailBudget = model.details && !wide && columns >= 60 && height >= 24 && budget >= 12 ? Math.min(model.stacked ? 30 : 10, budget - 5) : 0;
  const listBudget = wide ? budget : budget - detailBudget;
  const lines = groupLines(model.entries, entry => entry.group);
  const selected = lines.findIndex(line => line.kind === 'item' && line.index === model.selected);
  const window = groupedWindow(lines, selected < 0 ? undefined : selected, listBudget);
  const list = lines.slice(window.start, window.end).map(line => {
    if (line.kind === 'header') return studioMuted(`  ${line.title}`);
    const entry = line.item;
    const active = line.index === model.selected;
    const labelWidth = Math.min(24, Math.max(10, Math.floor(widths.list * 0.44)));
    const body = entry.render ? entry.render(widths.list - 2)
      : `${padCells(truncateAnsi(entry.label, labelWidth), labelWidth)}${entry.value ? ` ${entry.value}` : ''}`;
    const row = `${active ? GLYPHS.selection : ' '} ${body}`;
    return active ? selectedRowBand(row, widths.list) : truncateAnsi(row, widths.list);
  });
  let body = list;
  if (wide) {
    model.detailOrigin?.(widths.list + 3, head.length + 1);
    const details = model.details!(widths.detail, budget).slice(0, budget);
    body = Array.from({length: Math.max(list.length, details.length)}, (_, i) =>
      `${padCells(list[i] ?? '', widths.list, 0)}   ${truncateAnsi(details[i] ?? '', widths.detail)}`);
  } else if (detailBudget) {
    model.detailOrigin?.(0, head.length + 1 + list.length);
    body = [...list, ...model.details!(columns, detailBudget).slice(0, detailBudget)];
  }
  return framePanel([...head, ...body, ...notices, '', ...footer].map(row => truncateAnsi(row, columns)), columns);
}

export interface StudioReview {plan: {preview: string[]; guidance: string}; offset: number; rowCount?: number}
/** Exact-plan review, shared by host appearance and shader transactions. Only callers handle keys/writes. */
export function renderStudioReview(review: StudioReview, title: string, columns: number, height = 24): string[] {
  const width = Math.max(1, columns - 4);
  const document = [...review.plan.preview, '', 'Apply & reload', review.plan.guidance].flatMap(line => studioWrap(line, width));
  review.rowCount = document.length;
  const controls = renderControlRows([['↑↓', 'scroll diff'], ['Enter', 'confirm write'], ['Esc', 'cancel']], columns);
  if (height < 8 || columns < 24) return framePanel(['Resize to review', ...controls], columns).slice(0, height);
  const guidance = studioWrap(review.plan.guidance, columns).map(studioMuted);
  const head = [studioLabel(title), studioMuted('Review only · nothing written yet')];
  const available = Math.max(1, height - 1 - head.length - controls.length - Math.min(2, guidance.length) - 2);
  review.offset = Math.max(0, Math.min(review.offset, Math.max(0, document.length - available)));
  const visible = document.slice(review.offset, review.offset + available).map(line => `  ${line}`);
  const position = `Changes · ${review.offset + 1}–${review.offset + visible.length} / ${document.length}`;
  return framePanel([...head, studioMuted(position), ...framePanel(visible, columns),
    ...guidance.slice(0, 2), ...controls].map(row => truncateAnsi(row, columns)), columns);
}
