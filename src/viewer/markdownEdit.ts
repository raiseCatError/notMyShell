import type {Position, TextBuffer} from './textBuffer.js';

/**
 * Everyday Markdown editing helpers for the native editor (#463). Each works on the editor's own `TextBuffer`, changes
 * only the lines it names and makes exactly one undoable edit (undo restores the text, the caret and the selection).
 * The source text is the only authority: nothing is regenerated from a parsed or rendered form, other lines are never
 * reflowed, and anything that is not clearly what the helper handles is left to the editor's ordinary behavior.
 */

export interface EditResult {changed: boolean; note?: string}

interface Item {
  quote: string;
  indent: string;
  /** '-', '*', '+', or the number with its delimiter ('3.', '3)'). */
  marker: string;
  ordered: boolean;
  number: number;
  delimiter: string;
  gap: string;
  /** '[ ] ', '[x] ' … including its spacing; undefined when the item has no checkbox. */
  task?: string;
  /** Length of everything before the item's text. */
  prefixLength: number;
}

const ITEM = /^((?:[ ]{0,3}>[ ]?)*)([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/u;
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const TAB = 4;

function parseItem(line: string): Item | undefined {
  const match = ITEM.exec(line);
  if (!match) return undefined;
  const [whole, quote = '', indent = '', bullet, digits, delimiter, gap = '', task] = match;
  if (RULE.test(line.slice(quote.length))) return undefined;
  const ordered = digits !== undefined;
  return {quote, indent, marker: ordered ? `${digits}${delimiter}` : bullet!, ordered, number: ordered ? Number(digits) : 0, delimiter: delimiter ?? '', gap,
    ...(task === undefined ? {} : {task}), prefixLength: whole.length};
}

/** Whether line `index` sits inside a fenced code block (or is a fence line). */
function inFence(lines: readonly string[], index: number): boolean {
  let open: {char: string; length: number} | undefined;
  for (let at = 0; at <= index; at += 1) {
    const match = FENCE.exec(lines[at]!);
    if (!match) continue;
    const run = match[1]!;
    if (!open) { if (run[0] !== '`' || !match[2]!.includes('`')) { open = {char: run[0]!, length: run.length}; if (at === index) return true; } }
    else if (run[0] === open.char && run.length >= open.length && match[2]!.trim() === '') { if (at === index) return true; open = undefined; }
  }
  return open !== undefined;
}

const width = (text: string) => { let cells = 0; for (const character of text) cells += character === '\t' ? TAB - (cells % TAB) : 1; return cells; };
const isBlank = (line: string) => line.trim() === '';
/** The indentation (in columns) of a line after any block-quote prefix. */
const indentOf = (line: string) => width(/^((?:[ ]{0,3}>[ ]?)*)([ \t]*)/u.exec(line)![2]!);
const itemIndent = (item: Item) => width(item.indent);
const quoteOf = (line: string) => /^((?:[ ]{0,3}>[ ]?)*)/u.exec(line)![1]!;

function itemAt(lines: readonly string[], index: number): Item | undefined {
  const line = lines[index];
  return line === undefined || inFence(lines, index) ? undefined : parseItem(line);
}

/** The lines the caret or selection covers (a selection ending at a line start does not include that line). */
function coveredLines(buffer: TextBuffer): {first: number; last: number} {
  const selection = buffer.selection;
  if (!selection) return {first: buffer.caret.line, last: buffer.caret.line};
  const last = selection.end.column === 0 && selection.end.line > selection.start.line ? selection.end.line - 1 : selection.end.line;
  return {first: selection.start.line, last};
}

/** Replace whole lines first..last with `lines` as one edit; positions are mapped by `move`. */
function replaceLines(buffer: TextBuffer, first: number, last: number, lines: string[], move: (position: Position) => Position): void {
  const to = {line: last, column: buffer.lines[last]!.length};
  buffer.edit({line: first, column: 0}, to, lines.join('\n'), {caret: move(buffer.caret), ...(buffer.anchor ? {anchor: move(buffer.anchor)} : {})});
}

/** `line` with its indentation (after the quote) grown by `delta` columns, or shrunk by up to `-delta`; returns the line and the change in length. */
function shiftIndent(line: string, delta: number): {line: string; change: number} {
  const quote = quoteOf(line);
  const rest = line.slice(quote.length);
  const lead = /^[ \t]*/u.exec(rest)![0];
  if (delta >= 0) return {line: quote + ' '.repeat(delta) + rest, change: delta};
  let removed = 0, cut = 0;
  for (const character of lead) {
    const cells = character === '\t' ? TAB : 1;
    if (removed + cells > -delta && removed > 0) break;
    removed += cells; cut += 1;
    if (removed >= -delta) break;
  }
  return {line: quote + rest.slice(cut), change: -cut};
}

/** The item's own lines plus its children and continuation lines: those indented deeper, across blank lines that lead to deeper text. */
function blockEnd(lines: readonly string[], start: number, indent: number): number {
  let end = start;
  for (let at = start + 1; at < lines.length; at += 1) {
    if (isBlank(lines[at]!)) continue;
    if (indentOf(lines[at]!) > indent) { end = at; continue; }
    break;
  }
  return end;
}

// ---- Enter ------------------------------------------------------------------------------------------------------

/** Enter on a list item: the next item (same marker, next number, unchecked box), or the end of the list on an empty item. Returns whether it handled the key. */
export function continueList(buffer: TextBuffer): boolean {
  if (buffer.selection) return false;
  const {line: row, column} = buffer.caret;
  const text = buffer.lines[row]!;
  const item = itemAt(buffer.lines, row);
  if (!item || column < item.prefixLength) return false;
  const rest = text.slice(item.prefixLength);
  const from = {line: row, column: 0}, to = {line: row, column: text.length};
  if (rest.trim() === '') {
    // An empty item ends the list: a nested one steps out to its parent's level, a top-level one is cleared.
    if (item.indent === '') { buffer.edit(from, to, item.quote, {caret: {line: row, column: item.quote.length}}); return true; }
    let parentIndent = '';
    for (let at = row - 1; at >= 0; at -= 1) {
      const above = itemAt(buffer.lines, at);
      if (above && above.quote === item.quote && itemIndent(above) < itemIndent(item)) { parentIndent = above.indent; break; }
      if (!isBlank(buffer.lines[at]!) && indentOf(buffer.lines[at]!) < itemIndent(item) && !above) break;
    }
    const next = `${item.quote}${parentIndent}${item.marker} `;
    buffer.edit(from, to, next, {caret: {line: row, column: next.length}});
    return true;
  }
  const marker = item.ordered ? `${item.number + 1}${item.delimiter}` : item.marker;
  const prefix = `${item.quote}${item.indent}${marker}${item.gap}${item.task === undefined ? '' : '[ ] '}`;
  const tail = text.slice(column).replace(/^[ \t]+/u, '');
  buffer.edit({line: row, column}, to, `\n${prefix}${tail}`, {caret: {line: row + 1, column: prefix.length}});
  return true;
}

// ---- Tab / Shift+Tab --------------------------------------------------------------------------------------------

/** Tab or Shift+Tab over list items (and their children): one level in or out. False when no list item is covered, so the key keeps its ordinary meaning. */
export function shiftListItems(buffer: TextBuffer, outdent: boolean): boolean {
  const {first, last} = coveredLines(buffer);
  const selected: number[] = [];
  for (let at = first; at <= last; at += 1) if (itemAt(buffer.lines, at)) selected.push(at);
  if (!selected.length) return false;
  const lead = itemAt(buffer.lines, selected[0]!)!;
  let delta: number;
  if (outdent) {
    let target = 0;
    for (let at = selected[0]! - 1; at >= 0; at -= 1) {
      const above = itemAt(buffer.lines, at);
      if (above && above.quote === lead.quote && itemIndent(above) < itemIndent(lead)) { target = itemIndent(above); break; }
    }
    delta = -(itemIndent(lead) - target);
    if (delta === 0) return true;
  } else {
    delta = lead.marker.length + lead.gap.length;
    for (let at = selected[0]! - 1; at >= 0; at -= 1) {
      const above = itemAt(buffer.lines, at);
      if (above && above.quote === lead.quote && itemIndent(above) === itemIndent(lead)) { delta = above.marker.length + above.gap.length; break; }
      if (!isBlank(buffer.lines[at]!) && indentOf(buffer.lines[at]!) <= itemIndent(lead) && !above) break;
      if (above && itemIndent(above) < itemIndent(lead)) break;
    }
  }
  const moved = new Map<number, number>();
  for (const at of selected) {
    if (moved.has(at)) continue;
    const item = itemAt(buffer.lines, at)!;
    const end = blockEnd(buffer.lines, at, itemIndent(item));
    for (let inside = at; inside <= end; inside += 1) if (!isBlank(buffer.lines[inside]!)) moved.set(inside, 0);
  }
  const top = Math.min(...moved.keys()), bottom = Math.max(...moved.keys());
  const out = buffer.lines.slice(top, bottom + 1);
  for (const at of moved.keys()) {
    const shifted = shiftIndent(buffer.lines[at]!, delta);
    out[at - top] = shifted.line; moved.set(at, shifted.change);
  }
  replaceLines(buffer, top, bottom, out, position => {
    const change = moved.get(position.line);
    return change ? {line: position.line, column: Math.max(quoteOf(buffer.lines[position.line]!).length, position.column + change)} : position;
  });
  return true;
}

// ---- Tasks ------------------------------------------------------------------------------------------------------

/** Toggle the task checkbox of the list items at the caret or in the selection. */
export function toggleTask(buffer: TextBuffer): EditResult {
  const {first, last} = coveredLines(buffer);
  const entries: Array<{at: number; item: Item}> = [];
  for (let at = first; at <= last; at += 1) { const item = itemAt(buffer.lines, at); if (item) entries.push({at, item}); }
  if (!entries.length) return {changed: false, note: 'Put the caret on a list item to toggle a task.'};
  const tasks = entries.filter(entry => entry.item.task !== undefined);
  const open = tasks.some(entry => entry.item.task![1] === ' ');
  const out = buffer.lines.slice(first, last + 1);
  const added = new Map<number, {column: number; change: number}>();
  for (const {at, item} of entries) {
    const line = buffer.lines[at]!;
    const boxStart = item.prefixLength - (item.task?.length ?? 0);
    if (item.task === undefined) {
      if (tasks.length) continue;
      out[at - first] = `${line.slice(0, boxStart)}[ ] ${line.slice(boxStart)}`;
      added.set(at, {column: boxStart, change: 4});
    } else {
      const state = open ? (item.task[1] === ' ' ? 'x' : undefined) : ' ';
      if (state !== undefined) out[at - first] = `${line.slice(0, boxStart + 1)}${state}${line.slice(boxStart + 2)}`;
    }
  }
  const next = out.join('\n');
  if (next === buffer.lines.slice(first, last + 1).join('\n')) return {changed: false};
  replaceLines(buffer, first, last, out, position => {
    const change = added.get(position.line);
    return change && position.column >= change.column ? {line: position.line, column: position.column + change.change} : position;
  });
  return {changed: true};
}

// ---- Renumber ---------------------------------------------------------------------------------------------------

/** Renumber the ordered list at the caret from its first number; only the numbers (and the indentation of children, when a number gains or loses a digit) change. */
export function renumberList(buffer: TextBuffer): EditResult {
  const row = buffer.caret.line;
  const base = itemAt(buffer.lines, row);
  if (!base || !base.ordered) return {changed: false, note: 'Put the caret on a numbered list item to renumber it.'};
  const level = itemIndent(base);
  const sameList = (item: Item | undefined): item is Item => Boolean(item && item.ordered && item.quote === base.quote && itemIndent(item) === level && item.delimiter === base.delimiter);
  const scan = (step: 1 | -1): number => {
    let edge = row;
    for (let at = row + step; at >= 0 && at < buffer.lines.length; at += step) {
      const text = buffer.lines[at]!;
      if (isBlank(text)) continue;
      const item = itemAt(buffer.lines, at);
      if (sameList(item)) { edge = at; continue; }
      if (indentOf(text) > level || (item && itemIndent(item) > level)) continue;
      break;
    }
    return edge;
  };
  const first = scan(-1), last = scan(1);
  const members: number[] = [];
  for (let at = first; at <= last; at += 1) if (sameList(itemAt(buffer.lines, at))) members.push(at);
  const start = itemAt(buffer.lines, first)!.number;
  const out = buffer.lines.slice(first, last + 1);
  const changes = new Map<number, number>();
  const markerEnds = new Map<number, number>();
  members.forEach((at, order) => {
    const item = itemAt(buffer.lines, at)!;
    const wanted = `${start + order}${item.delimiter}`;
    if (wanted === item.marker) return;
    const numberAt = item.quote.length + item.indent.length;
    out[at - first] = `${item.quote}${item.indent}${wanted}${buffer.lines[at]!.slice(numberAt + item.marker.length)}`;
    const delta = wanted.length - item.marker.length;
    changes.set(at, delta); markerEnds.set(at, numberAt + item.marker.length);
    if (delta) {
      const end = blockEnd(buffer.lines, at, level);
      for (let child = at + 1; child <= end; child += 1) {
        if (isBlank(buffer.lines[child]!) || members.includes(child)) continue;
        const shifted = shiftIndent(buffer.lines[child]!, delta);
        out[child - first] = shifted.line; changes.set(child, shifted.change);
      }
    }
  });
  if (!changes.size) return {changed: false, note: 'The list is already in order.'};
  replaceLines(buffer, first, last, out, position => {
    const change = changes.get(position.line);
    if (!change) return position;
    const from = markerEnds.get(position.line) ?? 0;
    return position.column >= from ? {line: position.line, column: Math.max(0, position.column + change)} : position;
  });
  return {changed: true};
}

// ---- Links and images -------------------------------------------------------------------------------------------

const ADDRESS = /^(?:https?:\/\/|mailto:)\S+$/u;

/** Turn the selection (or a placeholder) into a link `[text](url)` or an image `![alt](path)`, with the part to type next selected. */
export function insertLink(buffer: TextBuffer, image: boolean): EditResult {
  const selection = buffer.selection;
  if (selection && selection.start.line !== selection.end.line) return {changed: false, note: 'Select text on one line to make a link.'};
  const from = selection?.start ?? buffer.caret, to = selection?.end ?? buffer.caret;
  const selected = selection ? buffer.lines[from.line]!.slice(from.column, to.column) : '';
  const bang = image ? '!' : '';
  const placeholder = image ? 'path' : 'url';
  let label: string, destination: string, select: 'label' | 'destination';
  if (ADDRESS.test(selected)) {
    label = image ? 'alt' : 'text'; select = 'label';
    destination = /[()\s<>]/u.test(selected) ? `<${selected}>` : selected;
  } else if (selected) {
    label = selected.replace(/(?<!\\)([[\]])/gu, '\\$1'); destination = placeholder; select = 'destination';
  } else { label = image ? 'alt' : 'text'; destination = placeholder; select = 'label'; }
  const text = `${bang}[${label}](${destination})`;
  const labelStart = from.column + bang.length + 1;
  const destinationStart = labelStart + label.length + 2;
  const [begin, length] = select === 'label' ? [labelStart, label.length] : [destinationStart, destination.length];
  buffer.edit(from, to, text, {caret: {line: from.line, column: begin + length}, anchor: {line: from.line, column: begin}});
  return {changed: true};
}

// ---- Wrap -------------------------------------------------------------------------------------------------------

export type WrapKind = 'bold' | 'italic' | 'code' | 'strike';
const MARKERS: Record<WrapKind, string> = {bold: '**', italic: '*', code: '`', strike: '~~'};

/** If `text[start, end)` is wrapped in the marker (inside it, or just outside it), the span that holds the markers and the markers' length. */
function wrapped(text: string, start: number, end: number, kind: WrapKind): {outer: [number, number]; inner: [number, number]} | undefined {
  const marker = MARKERS[kind];
  if (kind === 'code') {
    const before = /`+$/u.exec(text.slice(0, start))?.[0].length ?? 0;
    const after = /^`+/u.exec(text.slice(end))?.[0].length ?? 0;
    if (before && before === after && text[start - before - 1] !== '\\') {
      const padded = text[start] === ' ' && text[end - 1] === ' ' && end - start > 2 && text.slice(start + 1, end - 1).trim() !== '';
      return {outer: [start - before, end + after], inner: padded ? [start + 1, end - 1] : [start, end]};
    }
    const inside = /^(`+)([\s\S]*?)\1$/u.exec(text.slice(start, end));
    return inside && inside[2] ? {outer: [start, end], inner: [start + inside[1]!.length, end - inside[1]!.length]} : undefined;
  }
  const length = marker.length;
  const clear = (open: number, close: number) => text[open - 1] !== '\\' && (length > 1 || (text[open + 1] !== marker && text[open - 1] !== marker))
    && (length > 1 || (text[close - 1] !== marker && text[close + length] !== marker));
  if (end - start > 2 * length && text.startsWith(marker, start) && text.slice(0, end).endsWith(marker) && clear(start, end - length)) {
    const inner = text.slice(start + length, end - length);
    if (length === 1 && (inner.startsWith(marker) || inner.endsWith(marker))) return undefined;
    return {outer: [start, end], inner: [start + length, end - length]};
  }
  if (start >= length && text.slice(start - length, start) === marker && text.slice(end, end + length) === marker && clear(start - length, end)) {
    return {outer: [start - length, end + length], inner: [start, end]};
  }
  return undefined;
}

const LINE_PREFIX = /^((?:[ ]{0,3}>[ ]?)*)([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/u;

/** Wrap the selection in emphasis, code or strikethrough, or take that wrapping off again; the selection stays on the same text. */
export function wrapSelection(buffer: TextBuffer, kind: WrapKind): EditResult {
  const marker = MARKERS[kind];
  const selection = buffer.selection;
  if (!selection) {
    const at = buffer.caret;
    buffer.edit(at, at, marker + marker, {caret: {line: at.line, column: at.column + marker.length}});
    return {changed: true};
  }
  const { start, end } = selection;
  if (start.line === end.line) {
    const text = buffer.lines[start.line]!;
    const found = wrapped(text, start.column, end.column, kind);
    const line = start.line;
    if (found) {
      const inner = text.slice(found.inner[0], found.inner[1]);
      buffer.edit({line, column: found.outer[0]}, {line, column: found.outer[1]}, inner, {caret: {line, column: found.outer[0] + inner.length}, anchor: {line, column: found.outer[0]}});
      return {changed: true};
    }
    const chosen = kind === 'code' ? '`'.repeat(Math.max(0, ...(text.slice(start.column, end.column).match(/`+/gu) ?? []).map(run => run.length)) + 1) : marker;
    const body = text.slice(start.column, end.column);
    const pad = kind === 'code' && (body.startsWith('`') || body.endsWith('`')) ? ' ' : '';
    buffer.edit(start, end, `${chosen}${pad}${body}${pad}${chosen}`, {caret: {line, column: start.column + chosen.length + pad.length + body.length}, anchor: {line, column: start.column + chosen.length + pad.length}});
    return {changed: true};
  }
  // Several lines: each non-blank line is wrapped inside its own quote and list prefix, since emphasis cannot span paragraphs.
  const last = end.column === 0 ? end.line - 1 : end.line;
  const segments: Array<{line: number; from: number; to: number}> = [];
  for (let at = start.line; at <= last; at += 1) {
    const text = buffer.lines[at]!;
    let from = at === start.line ? start.column : 0;
    let to = at === end.line ? end.column : text.length;
    from = Math.max(from, LINE_PREFIX.exec(text)![0].length);
    while (from < to && /\s/u.test(text[from]!)) from += 1;
    while (to > from && /\s/u.test(text[to - 1]!)) to -= 1;
    if (to > from) segments.push({line: at, from, to});
  }
  if (!segments.length) return {changed: false};
  const allWrapped = segments.every(segment => wrapped(buffer.lines[segment.line]!, segment.from, segment.to, kind));
  const out = buffer.lines.slice(start.line, last + 1);
  const shifts = new Map<number, Array<{column: number; change: number}>>();
  for (const segment of segments) {
    const text = buffer.lines[segment.line]!;
    const found = wrapped(text, segment.from, segment.to, kind);
    if (allWrapped && found) {
      out[segment.line - start.line] = text.slice(0, found.outer[0]) + text.slice(found.inner[0], found.inner[1]) + text.slice(found.outer[1]);
      shifts.set(segment.line, [{column: found.inner[0], change: -(found.inner[0] - found.outer[0])}, {column: found.inner[1], change: -(found.inner[1] - found.inner[0]) + (found.inner[1] - found.inner[0]) - (found.outer[1] - found.inner[1])}]);
    } else if (!found) {
      out[segment.line - start.line] = `${text.slice(0, segment.from)}${marker}${text.slice(segment.from, segment.to)}${marker}${text.slice(segment.to)}`;
      shifts.set(segment.line, [{column: segment.from, change: marker.length}, {column: segment.to, change: marker.length}]);
    }
  }
  const map = (position: Position, isEnd: boolean): Position => {
    let column = position.column;
    for (const shift of shifts.get(position.line) ?? []) if (column > shift.column || (column === shift.column && !isEnd)) column += shift.change;
    return {line: position.line, column: Math.max(0, column)};
  };
  const anchorAfter = map(buffer.anchor ?? buffer.caret, false);
  const caretAfter = map(buffer.caret, true);
  replaceLines(buffer, start.line, last, out, position => (position === buffer.caret ? caretAfter : anchorAfter));
  return {changed: true};
}
