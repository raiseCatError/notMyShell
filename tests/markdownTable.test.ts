import test from 'node:test';
import assert from 'node:assert/strict';
import {TextBuffer, type Position} from '../src/viewer/textBuffer.js';
import {alignColumn, deleteColumn, deleteRow, findTable, insertColumn, insertRow, tableStatus, tableTab} from '../src/viewer/markdownTable.js';

const at = (line: number, column: number): Position => ({line, column});
const buf = (lines: string[], caret: Position, anchor?: Position) => {
  const buffer = new TextBuffer(lines, () => 0);
  buffer.caret = caret; if (anchor) buffer.anchor = anchor;
  return buffer;
};
const T = ['| Name | Qty | Note |', '| :--- | ---: | :---: |', '| apple | 3 | red |', '| pear | 12 | green |'];

test('findTable: header, delimiter and body rows, with or without outer pipes; escaped pipes do not split', () => {
  assert.deepEqual(findTable(T, 2)?.rows, {header: 0, delimiter: 1, first: 2, last: 3});
  assert.equal(findTable(T, 2)?.columns, 3);
  const bare = ['a | b', '--- | ---', '1 | 2'];
  assert.equal(findTable(bare, 2)?.columns, 2);
  const escaped = ['| a \\| b | c |', '|---|---|', '| 1 | 2 |'];
  assert.equal(findTable(escaped, 0)?.columns, 2);
  assert.equal(findTable(['| a | b |', '| 1 | 2 |'], 1), undefined, 'no delimiter row');
  assert.equal(findTable(['| a | b | c |', '|---|---|', '| 1 | 2 | 3 |'], 0), undefined, 'header and delimiter disagree');
  assert.equal(findTable(['```', '| a | b |', '|---|---|', '```'], 1), undefined, 'inside a fence');
  assert.equal(findTable(['text before', '| a | b |', '|---|---|', '', 'after | text'], 4), undefined, 'a line after the table');
  assert.equal(findTable(['text before', '| a | b |', '|---|---|'], 0), undefined, 'a paragraph line above the header');
});

test('Tab moves to the next cell and selects its content; across rows it skips the delimiter row', () => {
  const b = buf(T, at(0, 3));
  assert.equal(tableTab(b, false).handled, true);
  assert.equal(b.selectedText(), 'Qty');
  tableTab(b, false);
  assert.equal(b.selectedText(), 'Note');
  tableTab(b, false);
  assert.deepEqual([b.caret.line, b.selectedText()], [2, 'apple'], 'header → first body row, not the delimiter');
  tableTab(b, false); tableTab(b, false); tableTab(b, false);
  assert.deepEqual([b.caret.line, b.selectedText()], [3, 'pear']);
});

test('Shift+Tab goes back; the first cell and the last cell stay put and say what to do', () => {
  const b = buf(T, at(2, 3));
  tableTab(b, true);
  assert.equal(b.selectedText(), 'Note');
  assert.equal(b.caret.line, 0);
  const first = buf(T, at(0, 3));
  const result = tableTab(first, true);
  assert.equal(result.handled, true);
  assert.deepEqual(first.caret, at(0, 3));
  const last = buf(T, at(3, 18));
  const stay = tableTab(last, false);
  assert.equal(stay.handled, true);
  assert.match(stay.note ?? '', /row/u);
  assert.equal(last.caret.line, 3);
});

test('Tab outside a table is not handled (the editor\'s ordinary Tab applies); an empty cell takes the caret inside its padding', () => {
  assert.equal(tableTab(buf(['plain', ...T], at(0, 2)), false).handled, false);
  assert.equal(tableTab(buf([...T, '', 'after'], at(5, 2)), false).handled, false);
  const empty = ['| a |  | c |', '|---|---|---|', '| 1 | 2 | 3 |'];
  const b = buf(empty, at(0, 2));
  tableTab(b, false);
  assert.deepEqual(b.caret, at(0, 6));
  assert.equal(b.selection, undefined);
});

test('Tab selects escaped pipes and Unicode cells whole', () => {
  const lines = ['| 名前 | a \\| b | 😀 |', '|---|---|---|', '| x | y | z |'];
  const b = buf(lines, at(0, 3));
  tableTab(b, false);
  assert.equal(b.selectedText(), 'a \\| b');
  tableTab(b, false);
  assert.equal(b.selectedText(), '😀');
});

test('insert row: a new empty row below the caret row, shaped like the header; one undo step', () => {
  const b = buf(T, at(2, 3));
  assert.equal(insertRow(b).changed, true);
  assert.deepEqual(b.lines, [...T.slice(0, 3), '|      |     |      |', ...T.slice(3)]);
  assert.deepEqual(b.caret, at(3, 2));
  b.undo();
  assert.deepEqual(b.lines, T);
  const fromHeader = buf(T, at(0, 3));
  insertRow(fromHeader);
  assert.deepEqual(fromHeader.lines.slice(0, 3), [T[0], T[1], '|      |     |      |'], 'below the delimiter row');
});

test('delete row: removes a body row and keeps the column; the header and delimiter rows are refused', () => {
  const b = buf(T, at(2, 3));
  assert.equal(deleteRow(b).changed, true);
  assert.deepEqual(b.lines, [T[0], T[1], T[3]]);
  assert.equal(b.caret.line, 2);
  assert.equal(deleteRow(buf(T, at(0, 3))).changed, false);
  assert.match(deleteRow(buf(T, at(1, 3))).note ?? '', /header|delimiter/u);
  const only = ['| a |', '|---|', '| 1 |'];
  const o = buf(only, at(2, 2));
  deleteRow(o);
  assert.deepEqual(o.lines, ['| a |', '|---|']);
  assert.equal(findTable(o.lines, 0)?.columns, 1);
});

test('insert column: after the caret\'s column in every row, shaped like that row\'s neighbour, existing alignment untouched; one undo step', () => {
  const b = buf(T, at(2, 3));
  assert.equal(insertColumn(b).changed, true);
  assert.deepEqual(b.lines, [
    '| Name |      | Qty | Note |',
    '| :--- | ---- | ---: | :---: |',
    '| apple |       | 3 | red |',
    '| pear |      | 12 | green |',
  ]);
  assert.equal(findTable(b.lines, 0)?.columns, 4);
  assert.deepEqual(b.caret, at(2, 10), 'the caret waits in the new cell');
  b.undo();
  assert.deepEqual(b.lines, T);
});

test('insert column in a table without outer pipes appends valid cells', () => {
  const bare = ['a | b', '--- | ---', '1 | 2'];
  const b = buf(bare, at(2, 5));
  insertColumn(b);
  assert.equal(findTable(b.lines, 0)?.columns, 3);
  assert.equal(b.lines.length, 3);
});

test('delete column: removes that cell everywhere and keeps the others\' alignment; the last column is refused', () => {
  const b = buf(T, at(2, 11));
  assert.equal(deleteColumn(b).changed, true);
  assert.deepEqual(b.lines, ['| Name | Note |', '| :--- | :---: |', '| apple | red |', '| pear | green |']);
  const one = buf(['| a |', '|---|', '| 1 |'], at(0, 2));
  assert.equal(deleteColumn(one).changed, false);
  assert.match(deleteColumn(one).note ?? '', /last column/u);
});

test('align column cycles none → left → center → right → none and keeps the dashes\' width', () => {
  const lines = ['| a | b |', '| --- | ----- |', '| 1 | 2 |'];
  const b = buf(lines, at(0, 6));
  alignColumn(b); assert.equal(b.lines[1], '| --- | :---- |');
  alignColumn(b); assert.equal(b.lines[1], '| --- | :---: |');
  alignColumn(b); assert.equal(b.lines[1], '| --- | ----: |');
  alignColumn(b); assert.equal(b.lines[1], '| --- | ----- |');
  b.undo(); assert.equal(b.lines[1], '| --- | ----: |');
});

test('table status names the row and column for the status line; nothing outside a table', () => {
  assert.equal(tableStatus(T, at(2, 11)), 'Table · row 2 of 3 · column 2 of 3');
  assert.equal(tableStatus(T, at(0, 3)), 'Table · header · column 1 of 3');
  assert.equal(tableStatus(['x'], at(0, 0)), undefined);
});

test('a table with hundreds of columns and long cells is handled without delay', () => {
  const cols = 300;
  const row = (cell: string) => `| ${Array.from({length: cols}, () => cell).join(' | ')} |`;
  const lines = [row('h'), row('---'), row('x'.repeat(200))];
  const b = buf(lines, at(2, 5));
  const started = Date.now();
  insertColumn(b); deleteColumn(b); tableTab(b, false);
  assert.deepEqual(b.lines, lines, 'insert then delete restores the source exactly');
  assert.ok(Date.now() - started < 1000);
});

test('a huge paragraph without a table is not scanned quadratically, and fences inside a long paragraph still cut it', () => {
  const lines = Array.from({length: 40_000}, (_, index) => `line ${index} | x`);
  const started = Date.now();
  for (let index = 0; index < 20; index += 1) tableStatus(lines, at(20_000 + index, 3));
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  const mixed = ['| a | b |', '|---|---|', '| 1 | 2 |', '```', '| x | y |', '```'];
  assert.equal(findTable(mixed, 2)?.rows.last, 2, 'the fence ends the table');
  assert.equal(findTable(mixed, 4), undefined);
});
