import test from 'node:test';
import assert from 'node:assert/strict';
import {TextBuffer} from '../src/viewer/textBuffer.js';
import {renumberFootnotes} from '../src/viewer/markdownEdit.js';
import {paletteEntries} from '../src/viewer/EditorPalette.js';

const buf = (lines: string[], caret = {line: 0, column: 0}) => { const buffer = new TextBuffer(lines, () => 0); buffer.caret = caret; return buffer; };

test('footnotes are numbered 1, 2, 3… in the order of their first reference; each definition follows its reference', () => {
  const b = buf(['Second[^7] then first[^3] and again[^7].', '', '[^3]: three', '[^7]: seven']);
  const result = renumberFootnotes(b);
  assert.equal(result.changed, true);
  assert.deepEqual(b.lines, ['Second[^1] then first[^2] and again[^1].', '', '[^2]: three', '[^1]: seven']);
});

test('already in order: nothing changes and the user is told; one undo step otherwise, caret and selection kept', () => {
  const ok = buf(['a[^1] b[^2]', '', '[^1]: x', '[^2]: y']);
  assert.deepEqual(renumberFootnotes(ok), {changed: false, note: 'The footnotes are already numbered in order.'});
  const b = buf(['b[^2] a[^1]', '', '[^1]: x', '[^2]: y'], {line: 0, column: 11});
  renumberFootnotes(b);
  assert.deepEqual(b.lines, ['b[^1] a[^2]', '', '[^2]: x', '[^1]: y']);
  assert.deepEqual(b.caret, {line: 0, column: 11});
  assert.equal(b.undo(), true);
  assert.deepEqual(b.lines, ['b[^2] a[^1]', '', '[^1]: x', '[^2]: y']);
  assert.equal(b.undo(), false);
});

test('named footnotes keep their names and take no number; escaped references, code spans and fenced code are not references', () => {
  const b = buf(['x[^note] y[^5] z `[^9]` \\[^8] w[^2]', '```', '[^4] in code', '```', '', '[^note]: named', '[^5]: five', '[^2]: two']);
  renumberFootnotes(b);
  assert.deepEqual(b.lines, ['x[^note] y[^1] z `[^9]` \\[^8] w[^2]', '```', '[^4] in code', '```', '', '[^note]: named', '[^1]: five', '[^2]: two']);
});

test('definitions with no reference keep their number unless a renumbered footnote now needs it; multi-line definitions keep their body', () => {
  const b = buf(['see[^2] and[^1]', '', '[^1]: first', '    continued line', '[^2]: second', '[^9]: orphan']);
  renumberFootnotes(b);
  assert.deepEqual(b.lines, ['see[^1] and[^2]', '', '[^2]: first', '    continued line', '[^1]: second', '[^9]: orphan']);
  const clash = buf(['a[^2]', '', '[^1]: orphan', '[^2]: used']);
  renumberFootnotes(clash);
  assert.equal(clash.lines[0], 'a[^1]');
  assert.equal(clash.lines[3], '[^1]: used');
  assert.notEqual(clash.lines[2], '[^1]: orphan', 'the orphan was moved out of the way, never merged into the used footnote');
  assert.match(clash.lines[2]!, /^\[\^\d+\]: orphan$/u);
});

test('Unicode, quote and list prefixes, CRLF-free lines and very long documents', () => {
  const b = buf(['> 日本語[^4] 😀[^2]', '- item[^3]', '', '[^2]: b', '[^3]: c', '[^4]: a']);
  renumberFootnotes(b);
  assert.deepEqual(b.lines, ['> 日本語[^1] 😀[^2]', '- item[^3]', '', '[^2]: b', '[^3]: c', '[^1]: a']);
  const many = Array.from({length: 3000}, (_, index) => `ref[^${3000 - index}]`);
  const defs = Array.from({length: 3000}, (_, index) => `[^${index + 1}]: d${index + 1}`);
  const big = buf([...many, '', ...defs]);
  const started = process.hrtime.bigint();
  renumberFootnotes(big);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 2);
  assert.equal(big.lines[0], 'ref[^1]');
  assert.equal(big.lines[3001], '[^3000]: d1');
});

test('the palette offers it', () => {
  assert.ok(paletteEntries('markdown', 'renumber footnotes').some(entry => entry.run.kind === 'action' && entry.run.action === 'Action.FootnoteRenumber'));
});
