import {displayWidth} from '../../util/text.js';
import {BOLD, StartupCanvas} from './canvas.js';
import {fg, keycap, keycapWidth, plainSelection, segment, startupPaint} from './view.js';

/**
 * The guided setup's chrome in the selector's visual language: one quiet rule
 * at the top, the route of steps with the current one as a powerline segment,
 * the step's name and place, the selected row as a segment, and square
 * keycaps. Rows, choosers, previews and embedded
 * panels stay the guided setup's own; only the frame around them changes.
 */

/** The selector's margins, so the two read as one place. */
export const guidedMargin = (columns: number): number => columns >= 120 ? 6 : columns >= 90 ? 4 : columns >= 56 ? 3 : 2;

/** The horizon without its sky: one quiet rule at the top (a plain rule without color). */
export function guidedHairline(width: number): string {
  const paint = startupPaint();
  if (plainSelection(paint)) return (paint.nerd ? '─' : '-').repeat(Math.max(1, width));
  return `${fg(paint, paint.t.separator)}${(paint.nerd ? '▔' : '-').repeat(Math.max(1, width))}\u001B[0m`;
}

const line = (width: number, draw: (canvas: StartupCanvas) => void): string => {
  const canvas = new StartupCanvas(Math.max(1, width), 1);
  draw(canvas);
  return canvas.rows()[0]!;
};

/**
 * The steps as a route: done ones quiet, the current one a segment (its own
 * ends separate it, so no › beside it), the rest plain, and a count for those
 * that do not fit. The window keeps the next step in view, then reaches back
 * toward Start, then forward.
 */
export function guidedRoute(steps: readonly string[], current: number, width: number, margin: number): string {
  const paint = startupPaint();
  const plain = plainSelection(paint);
  const separator = paint.nerd ? ' › ' : ' > ';
  const label = (index: number) => index === current ? ` ${steps[index]} ` : steps[index]!;
  const cell = (index: number) => displayWidth(label(index)) + (index === current && !plain ? 2 : 0);
  const room = width - margin * 2;
  const gap = (before: number, after: number) => before === current || after === current ? 1 : 3;
  const count = (hidden: number) => hidden ? displayWidth(`+${hidden}`) + 3 : 0;
  const span = (lo: number, hi: number) => {
    let total = count(lo) + count(steps.length - 1 - hi);
    for (let i = lo; i <= hi; i++) total += cell(i) + (i > lo ? gap(i - 1, i) : 0);
    return total;
  };
  let lo = current, hi = current;
  if (hi + 1 < steps.length && span(lo, hi + 1) <= room) hi++;
  while (lo > 0 && span(lo - 1, hi) <= room) lo--;
  while (hi + 1 < steps.length && span(lo, hi + 1) <= room) hi++;
  return line(width, canvas => {
    let x = margin;
    const quiet = fg(paint, paint.t.subtle), ahead = fg(paint, paint.t.secondary);
    if (lo > 0) x = canvas.text(canvas.text(x, 0, `+${lo}`, quiet), 0, lo === current ? ' ' : separator, quiet);
    for (let i = lo; i <= hi; i++) {
      if (i > lo) x = gap(i - 1, i) === 1 ? x + 1 : canvas.text(x, 0, separator, quiet);
      x = i === current ? segment(canvas, paint, x, 0, label(i)) : canvas.text(x, 0, label(i), i < current ? quiet : ahead);
    }
    if (hi < steps.length - 1) canvas.text(canvas.text(x, 0, hi === current ? ' ' : separator, quiet), 0, `+${steps.length - 1 - hi}`, quiet);
  });
}

/** The step's name (with the app's light sweep, when given) and what it covers; its place on the right. */
export function guidedStepHeader(title: string, summary: string, index: number, total: number, width: number, margin: number): string {
  const paint = startupPaint();
  const place = `Step ${index + 1} of ${total}`;
  return line(width, canvas => {
    const right = width - margin - displayWidth(place);
    let x = title.includes('\u001b') ? canvas.ansi(margin, 0, title) : canvas.text(margin, 0, title, `${BOLD}${fg(paint, paint.t.primary)}`);
    if (summary && x + 2 + displayWidth(summary) <= right - 2) x = canvas.text(x + 2, 0, summary, fg(paint, paint.t.secondary));
    if (right > x + 1) canvas.text(right, 0, place, fg(paint, paint.t.subtle));
  });
}

/**
 * A footer key. When the row is narrow, keys first take their `short` action (an empty one leaves the keycap
 * alone), then the least needed go (`keep`, lowest first).
 */
export interface GuidedKey {key: string; action: string; short?: string; primary?: boolean; keep: number}

export function guidedFooter(keys: readonly GuidedKey[], width: number, margin: number): string {
  const paint = startupPaint();
  const fits = (list: readonly GuidedKey[]) => list.reduce((sum, item) => sum + keycapWidth(paint, item.key, item.action) + 3, -3) <= width - margin * 2;
  let shown = [...keys];
  // The least needed key shortens first, one at a time; only then do keys go, least needed first.
  while (!fits(shown)) {
    const shortenable = shown.filter(item => item.short !== undefined && item.short !== item.action);
    if (shortenable.length) {
      const least = shortenable.reduce((low, item) => item.keep < low.keep ? item : low);
      shown = shown.map(item => item === least ? {...item, action: item.short!} : item);
      continue;
    }
    if (shown.length <= 1) break;
    const least = Math.min(...shown.map(item => item.keep));
    let drop = shown.length - 1;
    while (drop > 0 && shown[drop]!.keep !== least) drop--;
    shown = shown.filter((_, index) => index !== drop);
  }
  return line(width, canvas => {
    let x = margin;
    for (const item of shown) {
      if (x + keycapWidth(paint, item.key, item.action) > width) break;
      x = keycap(canvas, paint, x, 0, item.key, item.action, Boolean(item.primary)) + 3;
    }
  });
}

export interface GuidedRowSpec {
  label: string;
  /** Nested under a parent row. */
  child: boolean;
  value: string;
  selected: boolean;
  kind: 'value' | 'action' | 'unavailable';
  /** The draft differs from the saved value. */
  changed: boolean;
}

/** Where values start: after the widest label, two cells past a selected row's end wedge. */
export const guidedValueColumn = (margin: number, labelWidth: number): number => margin + labelWidth + 6;

/** One row: the selected one a segment with `‹ value ›` beside it, the others label and value. */
export function guidedRow(row: GuidedRowSpec, width: number, margin: number, labelWidth: number): string {
  const paint = startupPaint();
  const label = `${row.child ? '  ' : ''}${row.label}`;
  const valueX = guidedValueColumn(margin, labelWidth);
  return line(width, canvas => {
    if (row.selected) segment(canvas, paint, margin, 0, ` ${label}${' '.repeat(Math.max(0, labelWidth - displayWidth(label)))} `);
    else canvas.text(margin + 2, 0, label, fg(paint, row.child ? paint.t.secondary : paint.t.primary), undefined, valueX - 1);
    const value = row.kind === 'value' && row.selected ? `${paint.nerd ? '‹' : '<'} ${row.value} ${paint.nerd ? '›' : '>'}` : row.value;
    const color = row.kind === 'unavailable' ? paint.t.subtle : row.selected ? paint.t.accent : paint.t.secondary;
    const x = canvas.text(valueX, 0, value, `${row.selected ? BOLD : ''}${fg(paint, color)}`);
    if (row.changed) canvas.text(x + 1, 0, paint.nerd ? '•' : '*', fg(paint, paint.t.subtle));
  });
}

/** A line of quiet prose at the margin (intro, help, notes). */
export function guidedText(text: string, width: number, margin: number, tone: 'subtle' | 'secondary' | 'primary' | 'warning' = 'subtle', x = margin): string {
  const paint = startupPaint();
  return line(width, canvas => { canvas.text(x, 0, text, fg(paint, paint.t[tone]), undefined, width - margin); });
}

