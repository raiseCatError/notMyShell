/**
 * Category headings over a continuously scrolling list, shared by Config and
 * Status: headings are display lines, never selectable, never counted in the
 * selection index. A window over the lines keeps the selected row visible, brings
 * its heading with it when that fits, and never ends on a heading with nothing
 * under it.
 */
export type GroupedLine<T> = {kind: 'header'; title: string} | {kind: 'item'; item: T; index: number};

/** Headings and items in order; `groupOf` must return the same title for neighbours that belong together. */
export function groupLines<T>(items: readonly T[], groupOf: (item: T) => string): Array<GroupedLine<T>> {
  const lines: Array<GroupedLine<T>> = [];
  items.forEach((item, index) => {
    const group = groupOf(item);
    const previous = index > 0 ? groupOf(items[index - 1]!) : undefined;
    if (index === 0 || group !== previous) lines.push({kind: 'header', title: group});
    lines.push({kind: 'item', item, index});
  });
  return lines;
}

/**
 * The slice of lines to draw in `budget` lines. `selected` is a line number to keep visible (undefined: a
 * plain scroll from `scroll`). The returned range never ends on an orphan heading.
 */
export function groupedWindow(lines: readonly GroupedLine<unknown>[], selected: number | undefined, budget: number, scroll = 0): {start: number; end: number} {
  const size = Math.max(1, budget);
  if (lines.length <= size) return {start: 0, end: lines.length};
  let start = selected === undefined ? scroll : selected - Math.floor(size / 2);
  start = Math.max(0, Math.min(start, lines.length - size));
  if (selected !== undefined) {
    // Bring the selected row's own heading into view when it fits.
    if (start > 0 && lines[start]?.kind === 'item') {
      for (let back = selected - 1; back >= 0 && selected - back < size; back -= 1) {
        if (lines[back]!.kind === 'header') { if (back < start) start = back; break; }
      }
    }
    if (selected < start) start = selected;
    if (selected > start + size - 1) start = selected - size + 1;
    start = Math.max(0, Math.min(start, lines.length - size));
  }
  let end = Math.min(lines.length, start + size);
  while (end > start + 1 && lines[end - 1]!.kind === 'header') end -= 1;
  return {start, end};
}
