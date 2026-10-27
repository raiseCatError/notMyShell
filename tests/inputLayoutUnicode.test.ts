import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandEditor} from '../src/input/CommandEditor.js';
import {graphemes, layoutInput} from '../src/input/inputLayout.js';

test('segmentation preserves extended clusters and results are independent between calls', () => {
  const source = '👩🏽‍💻é🇫🇮\r\n';
  const first = graphemes(source);
  assert.deepEqual(first, ['👩🏽‍💻', 'é', '🇫🇮', '\r\n']);
  const other = graphemes('界x');
  first[0] = 'changed';
  assert.deepEqual(graphemes(source), ['👩🏽‍💻', 'é', '🇫🇮', '\r\n']);
  assert.deepEqual(other, ['界', 'x']);
});

test('wrapping and caret placement preserve Unicode source with plain, absent and styled prefixes', () => {
  const source = 'ab界c\n👩🏽‍💻éZ';
  const length = graphemes(source).length;
  for (const prefix of [undefined, '', '\x1b[36m❯ \x1b[0m', '\x1b[35mproject/main ❯ \x1b[0m']) {
    for (const columns of [1, 2, 3, 4, 6, 12, 30]) {
      for (let cursor = 0; cursor <= length; cursor++) {
        const result = layoutInput(source, cursor, columns, 3, prefix);
        assert.equal(result.allRows.map(row => row.text).join(''), source.replaceAll('\n', ''));
        assert.ok(result.caretRow >= 0 && result.caretRow < result.rows.length);
        assert.ok(result.caretColumn >= 0 && result.caretColumn < columns);
        assert.ok(result.rows.length <= 3);
      }
    }
  }
  const wrapped = layoutInput('ab界c', 5, 6, 3, '\x1b[36m❯ \x1b[0m');
  assert.deepEqual(wrapped.allRows.map(row => [row.prefix, row.text]), [['\x1b[36m❯ \x1b[0m', 'ab界'], ['  ', 'c']]);
  assert.equal(wrapped.caretColumn, 3);
});

test('repeated segmentation amortizes native segmenter construction', () => {
  const original = Intl.Segmenter;
  let constructions = 0;
  Intl.Segmenter = new Proxy(original, {
    construct(target, args) {
      constructions++;
      return Reflect.construct(target, args);
    },
  });
  try {
    for (let i = 0; i < 20; i++) assert.deepEqual(graphemes('👩🏽‍💻é界'), ['👩🏽‍💻', 'é', '界']);
    assert.ok(constructions <= 1, `Repeated segmentation constructed ${constructions} native segmenters`);
  } finally { Intl.Segmenter = original; }
});

test('visual row movement does not repeatedly segment the complete command for every caret candidate', () => {
  const original = Intl.Segmenter.prototype.segment;
  let segmentedCharacters = 0;
  Intl.Segmenter.prototype.segment = function(this: Intl.Segmenter, value: string) {
    segmentedCharacters += value.length;
    return original.call(this, value);
  };
  try {
    const work = (length: number): number => {
      const editor = new CommandEditor();
      editor.insert('abcdefgh'.repeat(length));
      segmentedCharacters = 0;
      assert.equal(editor.moveUp(16), true);
      return segmentedCharacters;
    };
    const short = work(8);
    const long = work(16);
    assert.ok(long <= short * 3, `Doubling command length increased segmentation work from ${short} to ${long}`);
  } finally { Intl.Segmenter.prototype.segment = original; }
});

test('visual navigation preserves nearest-column choices across Unicode, split clusters and paste atoms', () => {
  const factories = [
    () => { const editor = new CommandEditor(); editor.insert('ab界c\n👩🏽‍💻éZ'); return editor; },
    () => { const editor = new CommandEditor(); editor.insert('ab\ne'); editor.insert('́'); return editor; },
    () => { const editor = new CommandEditor(); editor.insert('a'); editor.insertPaste('one\ntwo\nthree\nfour'); editor.insert('界\ntail'); return editor; },
  ];
  for (const factory of factories) for (const columns of [3, 6, 12]) for (const prefix of [undefined, '', '\x1b[36mctx ❯ \x1b[0m']) {
    const reference = factory();
    const tokenCount = reference.cursorIndex;
    while (reference.cursorIndex > 0) reference.moveLeft();
    const positions = [];
    for (let index = 0; index <= tokenCount; index++) {
      positions.push(layoutInput(reference.displayText, reference.displayCursorIndex, columns, Infinity, prefix));
      reference.moveRight();
    }
    for (let cursor = 0; cursor <= tokenCount; cursor++) for (const direction of [-1, 1] as const) {
      const editor = factory();
      while (editor.cursorIndex > cursor) editor.moveLeft();
      const original = editor.text;
      const current = positions[cursor]!;
      const target = current.caretRow + direction;
      const valid = target >= 0 && target < current.allRows.length;
      let expected = cursor;
      let distance = Infinity;
      if (valid) positions.forEach((candidate, index) => {
        const nextDistance = Math.abs(candidate.caretColumn - current.caretColumn);
        if (candidate.caretRow === target && nextDistance < distance) { expected = index; distance = nextDistance; }
      });
      assert.equal(direction === -1 ? editor.moveUp(columns, prefix) : editor.moveDown(columns, prefix), valid);
      assert.equal(editor.cursorIndex, expected, `cursor=${cursor}, width=${columns}, direction=${direction}`);
      assert.equal(editor.text, original);
    }
  }
});
