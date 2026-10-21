import {fenceMap, inFence, replaceLines, type EditResult} from './markdownEdit.js';
import type {Position, TextBuffer} from './textBuffer.js';

/**
 * GFM table editing for the native editor (#463, slice 2). The table is the source text in the buffer, nothing else:
 * cells are found by scanning a row for unescaped pipes, and every action replaces only the rows it changes, as one
 * undoable edit, keeping the file's own spacing, outer pipes and alignment colons. Nothing is rebuilt from a parsed or
 * rendered table and no row is re-padded; the editor shows the source at any terminal width.
 */

interface Cell {from: number; to: number}
interface Row {text: string; cells: Cell[]; leading: boolean; trailing: boolean}

export interface Table {
  rows: {header: number; delimiter: number; first: number; last: number};
  columns: number;
}

/** Offsets of the pipes in `text` that are not escaped by a backslash. */
function pipes(text: string): number[] {
  const found: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] !== '|') continue;
    let slashes = 0;
    while (at - 1 - slashes >= 0 && text[at - 1 - slashes] === '\\') slashes += 1;
    if (slashes % 2 === 0) found.push(at);
  }
  return found;
}

function splitRow(text: string): Row {
  const all = pipes(text);
  const leading = all.length > 0 && text.slice(0, all[0]!).trim() === '';
  const trailing = all.length > (leading ? 1 : 0) && text.slice(all.at(-1)! + 1).trim() === '';
  const inner = all.filter((at, index) => !(leading && index === 0) && !(trailing && index === all.length - 1));
  const start = leading ? all[0]! + 1 : 0;
  const end = trailing ? all.at(-1)! : text.length;
  const cells: Cell[] = [];
  let from = start;
  for (const pipe of inner) { cells.push({from, to: pipe}); from = pipe + 1; }
  cells.push({from, to: end});
  return {text, cells, leading, trailing};
}

/** How far from the caret a table's paragraph is searched. */
export const SCAN_LIMIT = 5000;
const DELIMITER_CELL = /^\s*:?-+:?\s*$/u;
const isDelimiter = (row: Row) => row.cells.every(cell => DELIMITER_CELL.test(row.text.slice(cell.from, cell.to)));

/** The run of non-blank lines around `index`, looked at no further than SCAN_LIMIT lines either way; `clipped` when that cut it short. */
function paragraphAround(lines: readonly string[], index: number): {top: number; bottom: number; clipped: boolean} {
  let top = index, bottom = index;
  while (top > 0 && index - top < SCAN_LIMIT && lines[top - 1]!.trim() !== '') top -= 1;
  while (bottom + 1 < lines.length && bottom - index < SCAN_LIMIT && lines[bottom + 1]!.trim() !== '') bottom += 1;
  const clipped = (top > 0 && lines[top - 1]!.trim() !== '') || (bottom + 1 < lines.length && lines[bottom + 1]!.trim() !== '');
  return {top, bottom, clipped};
}

/** Why an action found no table at the caret: too large to look at, or simply not in one. */
function missing(lines: readonly string[], line: number, doing: string): EditResult {
  const text = lines[line];
  return {changed: false, note: text !== undefined && text.includes('|') && paragraphAround(lines, line).clipped
    ? `This text runs over ${SCAN_LIMIT.toLocaleString('en-US')} lines without a break, too much to edit as a table here.` : `Put the caret in a table to ${doing}.`};
}

/** The table containing line `index`, found by looking for a header row followed by a matching delimiter row. */
export function findTable(lines: readonly string[], index: number): Table | undefined {
  const line = lines[index];
  if (line === undefined || line.trim() === '') return undefined;
  // The paragraph around the line, bounded; text without pipes anywhere near is not a table and costs nothing more.
  const { top: scanTop, bottom: scanBottom, clipped } = paragraphAround(lines, index);
  // A paragraph longer than the scan is never edited: part of a table is not a table, and editing it could leave rows disagreeing.
  if (clipped) return undefined;
  let top = scanTop, bottom = scanBottom;
  let withPipes = 0;
  for (let at = top; at <= bottom && withPipes < 2; at += 1) if (lines[at]!.includes('|')) withPipes += 1;
  if (!withPipes) return undefined;
  const fenced = fenceMap(lines, bottom);
  if (fenced[index]) return undefined;
  while (top < index && fenced[top]) top += 1;
  for (let at = top; at <= bottom; at += 1) if (fenced[at] && at > index) { bottom = at - 1; break; }
  for (let header = top; header + 1 <= bottom; header += 1) {
    if (!lines[header]!.includes('|') && !lines[header + 1]!.includes('|')) continue;
    const head = splitRow(lines[header]!), delimiter = splitRow(lines[header + 1]!);
    if (head.cells.length !== delimiter.cells.length || !isDelimiter(delimiter) || !(lines[header]!.includes('|') || head.cells.length === 1)) continue;
    if (index < header) return undefined;
    return {rows: {header, delimiter: header + 1, first: header + 2, last: bottom}, columns: head.cells.length};
  }
  return undefined;
}

/** The index of the cell the column falls in: a pipe belongs to the cell it ends. */
function cellAt(row: Row, column: number): number {
  const found = row.cells.findIndex(cell => column <= cell.to);
  return found < 0 ? row.cells.length - 1 : found;
}

/** Where the text of a cell sits (surrounding spaces excluded); an empty cell has the caret inside its padding. */
function contentOf(row: Row, cell: number): {from: number; to: number} {
  const { from, to } = row.cells[cell]!;
  const raw = row.text.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  if (!text) { const at = from + Math.min(1, raw.length); return {from: at, to: at}; }
  return {from: from + lead, to: from + lead + text.length};
}

export function tableStatus(lines: readonly string[], caret: Position): string | undefined {
  const table = findTable(lines, caret.line);
  if (!table || caret.line === table.rows.delimiter) return undefined;
  const row = splitRow(lines[caret.line]!);
  const column = `column ${cellAt(row, caret.column) + 1} of ${table.columns}`;
  if (caret.line === table.rows.header) return `Table · header · ${column}`;
  return `Table · row ${caret.line - table.rows.first + 2} of ${table.rows.last - table.rows.first + 2} · ${column}`;
}

/** Tab / Shift+Tab inside a table: to the neighbouring cell, selecting its text. Not handled outside a table. */
export function tableTab(buffer: TextBuffer, backwards: boolean): {handled: boolean; note?: string} {
  const table = findTable(buffer.lines, buffer.caret.line);
  if (!table) return {handled: false};
  const { rows } = table;
  let line = buffer.caret.line;
  if (line === rows.delimiter) line = backwards ? rows.header : rows.first;
  let row = splitRow(buffer.lines[line]!);
  let cell = line === buffer.caret.line ? cellAt(row, buffer.caret.column) : (backwards ? row.cells.length : -1);
  cell += backwards ? -1 : 1;
  if (cell < 0 || cell >= row.cells.length) {
    const next = backwards ? (line === rows.first ? rows.header : line - 1) : (line === rows.header ? rows.first : line + 1);
    if (next < rows.header || next > rows.last || (!backwards && line === rows.last)) {
      return {handled: true, note: backwards ? 'First cell of the table.' : 'Last cell of the table · F1 then r adds a row.'};
    }
    line = next; row = splitRow(buffer.lines[line]!);
    cell = backwards ? row.cells.length - 1 : 0;
  }
  const { from, to } = contentOf(row, cell);
  buffer.caret = {line, column: to};
  buffer.anchor = from === to ? undefined : {line, column: from};
  return {handled: true};
}

const widthOf = (row: Row, cell: number) => (row.cells[cell] ? row.cells[cell]!.to - row.cells[cell]!.from : 3);

function emptyRaw(row: Row, neighbour: number, delimiter: boolean): string {
  const width = Math.max(3, widthOf(row, neighbour));
  return delimiter ? (width >= 5 ? ` ${'-'.repeat(width - 2)} ` : '---') : ' '.repeat(width);
}

/** A new empty row below the caret's row (below the delimiter when the caret is in the header), shaped like the header. */
export function insertRow(buffer: TextBuffer): EditResult {
  const table = findTable(buffer.lines, buffer.caret.line);
  if (!table) return missing(buffer.lines, buffer.caret.line, 'add a row');
  const head = splitRow(buffer.lines[table.rows.header]!);
  const cells = head.cells.map((_, index) => ' '.repeat(Math.max(3, widthOf(head, index))));
  const text = `${head.leading ? '|' : ''}${cells.join('|')}${head.trailing ? '|' : ''}`;
  const after = Math.max(buffer.caret.line, table.rows.delimiter);
  const lead = head.leading ? 1 : 0;
  const caret = {line: after + 1, column: lead + Math.min(1, cells[0]!.length)};
  buffer.edit({line: after, column: buffer.lines[after]!.length}, {line: after, column: buffer.lines[after]!.length}, `\n${text}`, {caret});
  return {changed: true};
}

/** Remove the caret's body row. */
export function deleteRow(buffer: TextBuffer): EditResult {
  const table = findTable(buffer.lines, buffer.caret.line);
  if (!table) return missing(buffer.lines, buffer.caret.line, 'remove a row');
  const line = buffer.caret.line;
  if (line === table.rows.header || line === table.rows.delimiter) return {changed: false, note: 'The header and delimiter rows stay; remove a body row.'};
  const column = cellAt(splitRow(buffer.lines[line]!), buffer.caret.column);
  const from = line > 0 ? {line: line - 1, column: buffer.lines[line - 1]!.length} : {line, column: 0};
  const to = line > 0 ? {line, column: buffer.lines[line]!.length} : {line, column: buffer.lines[line]!.length};
  // The caret goes to the same column of the row that takes this one's place (or the one above when it was the last).
  const target = Math.min(line, table.rows.last - 1);
  const row = splitRow(buffer.lines[target >= line ? target + 1 : target]!);
  buffer.edit(from, to, '', {caret: {line: target, column: contentOf(row, Math.min(column, row.cells.length - 1)).from}});
  return {changed: true};
}

function columnTarget(buffer: TextBuffer): {table: Table; rows: Row[]; first: number; column: number} | undefined {
  const table = findTable(buffer.lines, buffer.caret.line);
  if (!table) return undefined;
  const rows: Row[] = [];
  for (let line = table.rows.header; line <= table.rows.last; line += 1) rows.push(splitRow(buffer.lines[line]!));
  const here = rows[buffer.caret.line - table.rows.header]!;
  return {table, rows, first: table.rows.header, column: Math.min(cellAt(here, buffer.caret.column), table.columns - 1)};
}

/** A new empty column to the right of the caret's column, in every row. */
export function insertColumn(buffer: TextBuffer): EditResult {
  const target = columnTarget(buffer);
  if (!target) return missing(buffer.lines, buffer.caret.line, 'add a column');
  const { table, rows, first, column } = target;
  const out = rows.map((row, offset) => {
    if (row.cells.length <= column) return row.text;
    const raw = emptyRaw(row, column, first + offset === table.rows.delimiter);
    const { to } = row.cells[column]!;
    const last = column === row.cells.length - 1;
    return last && !row.trailing ? `${row.text}|${raw}|` : `${row.text.slice(0, to)}|${raw}${row.text.slice(to)}`;
  });
  const line = buffer.caret.line;
  const here = rows[line - first]!;
  const insertedAt = (here.cells[column]?.to ?? here.text.length) + 1;
  replaceLines(buffer, first, table.rows.last, out, () => ({line, column: insertedAt + Math.min(1, out[line - first]!.length > insertedAt ? emptyRaw(here, column, line === table.rows.delimiter).length : 0)}));
  return {changed: true};
}

/** Remove the caret's column from every row. */
export function deleteColumn(buffer: TextBuffer): EditResult {
  const target = columnTarget(buffer);
  if (!target) return missing(buffer.lines, buffer.caret.line, 'remove a column');
  const { table, rows, first, column } = target;
  if (table.columns === 1) return {changed: false, note: 'That is the last column; delete the table text instead.'};
  const out = rows.map(row => {
    const cell = row.cells[column];
    if (!cell) return row.text;
    const hasPipeAfter = column < row.cells.length - 1 || row.trailing;
    return hasPipeAfter ? row.text.slice(0, cell.from) + row.text.slice(cell.to + 1) : row.text.slice(0, Math.max(0, cell.from - 1)) + row.text.slice(cell.to);
  });
  const line = buffer.caret.line;
  const kept = Math.min(column, table.columns - 2);
  const row = splitRow(out[line - first]!);
  replaceLines(buffer, first, table.rows.last, out, () => ({line, column: contentOf(row, Math.min(kept, row.cells.length - 1)).from}));
  return {changed: true};
}

/** Cycle the caret's column through no alignment, left, centre and right, keeping the delimiter cell's width. */
export function alignColumn(buffer: TextBuffer): EditResult {
  const target = columnTarget(buffer);
  if (!target) return missing(buffer.lines, buffer.caret.line, 'align a column');
  const { table, rows, first, column } = target;
  const delimiterRow = rows[table.rows.delimiter - first]!;
  const cell = delimiterRow.cells[column]!;
  const raw = delimiterRow.text.slice(cell.from, cell.to);
  const lead = /^\s*/u.exec(raw)![0], trail = /\s*$/u.exec(raw)![0];
  const body = raw.trim();
  const left = body.startsWith(':'), right = body.endsWith(':') && body.length > 1;
  const length = body.length;
  const state = left && right ? 'center' : left ? 'left' : right ? 'right' : 'none';
  const next = ({none: 'left', left: 'center', center: 'right', right: 'none'} as const)[state];
  const dashes = (count: number) => '-'.repeat(Math.max(1, count));
  const replaced = next === 'none' ? dashes(length) : next === 'left' ? `:${dashes(length - 1)}` : next === 'right' ? `${dashes(length - 1)}:` : `:${dashes(length - 2)}:`;
  const text = delimiterRow.text.slice(0, cell.from) + lead + replaced + trail + delimiterRow.text.slice(cell.to);
  const lineNumber = table.rows.delimiter;
  const caret = buffer.caret, anchor = buffer.anchor;
  buffer.edit({line: lineNumber, column: 0}, {line: lineNumber, column: delimiterRow.text.length}, text, {caret, ...(anchor ? {anchor} : {})});
  return {changed: true};
}
