import {displayWidth, truncateText} from '../util/text.js';
import type {FilterClause, FindClause} from './TranscriptSearch.js';

/**
 * The find/filter status above the composer: Find on the left, Filter on the
 * right, at most TWO rows. At most two clauses per side are visible; the
 * second visible row carries `+N more` for the hidden ones. Narrow terminals
 * degrade to truncated terms, then compact summaries. Plain text in, styled
 * by the caller's palette.
 */

export interface ChromeStyle {
  accent: string;
  primary: string;
  secondary: string;
  subtle: string;
  error: string;
  reset: string;
}

export interface FindChromeState {
  clauses: readonly FindClause[];
  /** The clause being typed (Ctrl+F / /find), shown with a caret. */
  editing?: FindClause;
  count: string;
  error?: boolean;
}

export interface FilterChromeState {
  clauses: readonly FilterClause[];
}

/** Concise metadata tags: [case] [regex] [invert] [±N]. */
export function clauseTags(clause: {options: {regex: boolean; caseSensitive: boolean}; invert?: boolean; context?: number}): string {
  return [clause.options.caseSensitive ? '[case]' : '', clause.options.regex ? '[regex]' : '', clause.invert ? '[invert]' : '',
    clause.context ? `[±${clause.context}]` : ''].filter(Boolean).join(' ');
}

interface Cell { text: string; style: 'term' | 'editing' | 'meta' }

/** Up to two visible lines for one side; the second gets `+N more` when clauses are hidden. */
function sideLines(items: Array<{text: string; tags: string; editing?: boolean}>, termWidth: number, firstSuffix: string): Cell[][] {
  if (!items.length) return [];
  // Keep the clause being edited visible: it takes the second slot when there are more than two.
  const editing = items.findIndex(item => item.editing);
  const visible = items.length <= 2 ? items : editing >= 0 ? [items[0]!, items[editing]!] : [items[0]!, items[1]!];
  const hidden = items.length - visible.length;
  return visible.map((item, index) => {
    const cells: Cell[] = [{text: truncateText(item.text || ' ', Math.max(3, termWidth)) + (item.editing ? '_' : ''), style: item.editing ? 'editing' : 'term'}];
    if (item.tags) cells.push({text: ` ${item.tags}`, style: 'meta'});
    if (index === 1 && hidden > 0) cells.push({text: `  +${hidden} more`, style: 'meta'});
    if (index === 0 && firstSuffix) cells.push({text: `  ${firstSuffix}`, style: 'meta'});
    return cells;
  });
}

const width = (cells: Cell[]) => cells.reduce((sum, cell) => sum + displayWidth(cell.text), 0);

function paint(cells: Cell[], style: ChromeStyle, marker: string, error = false): string {
  return `${style.accent}${marker}${style.reset} ${cells.map(cell => `${cell.style === 'editing' ? style.primary : cell.style === 'term' ? style.secondary : error ? style.error : style.subtle}${cell.text}${style.reset}`).join('')}`;
}

/**
 * Rows for the chrome region (0, 1 or 2). `columns` is the full width.
 * Degradation: shorter terms → compact `N terms` / `N filters` summaries.
 */
export function searchChromeRows(find: FindChromeState | undefined, filter: FilterChromeState | undefined, columns: number, style: ChromeStyle,
  glyphs: {find: string; filter: string} = {find: '⌕', filter: '⧩'}): string[] {
  const findItems = find ? [...find.clauses.map(clause => ({text: clause.query, tags: clauseTags(clause)})),
    ...(find.editing ? [{text: find.editing.query, tags: clauseTags(find.editing), editing: true}] : [])] : [];
  const filterItems = filter ? filter.clauses.map(clause => ({text: clause.query, tags: clauseTags(clause)})) : [];
  if (!findItems.length && !filterItems.length) return [];
  const both = findItems.length > 0 && filterItems.length > 0;
  const sideWidth = both ? Math.floor((columns - 3) / 2) : columns;
  const findSuffix = find ? find.count : '';
  for (const termWidth of [32, 20, 12, 6]) {
    const left = sideLines(findItems, termWidth, findSuffix);
    const right = sideLines(filterItems, termWidth, '');
    const fits = (lines: Cell[][]) => lines.every(line => width(line) + 2 <= sideWidth);
    if (!fits(left) || !fits(right)) continue;
    const rows: string[] = [];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const l = left[index];
      const r = right[index];
      const leftText = l ? paint(l, style, glyphs.find, find?.error && index === 0) : '';
      const rightText = r ? paint(r, style, glyphs.filter) : '';
      const leftWidth = l ? width(l) + 2 : 0;
      const rightWidth = r ? width(r) + 2 : 0;
      const gap = Math.max(1, columns - leftWidth - rightWidth);
      rows.push(r ? `${leftText}${' '.repeat(gap)}${rightText}` : leftText);
    }
    return rows;
  }
  // Compact summaries on one row.
  const summary = (count: number, noun: string, suffix = '') => `${count} ${noun}${count === 1 ? '' : 's'}${suffix ? ` · ${suffix}` : ''}`;
  const left = findItems.length ? paint([{text: summary(findItems.length, 'term', findSuffix), style: 'meta'}], style, glyphs.find) : '';
  const right = filterItems.length ? paint([{text: summary(filterItems.length, 'filter'), style: 'meta'}], style, glyphs.filter) : '';
  const leftWidth = findItems.length ? displayWidth(summary(findItems.length, 'term', findSuffix)) + 2 : 0;
  const rightWidth = filterItems.length ? displayWidth(summary(filterItems.length, 'filter')) + 2 : 0;
  return [right ? `${left}${' '.repeat(Math.max(1, columns - leftWidth - rightWidth))}${right}` : left];
}
