import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandEditor} from '../src/input/CommandEditor.js';
import {layoutInput} from '../src/input/inputLayout.js';
import {KeyDecoder, decodeKeys} from '../src/terminal/keys.js';
import {calculateScreenLayout, MAX_VISIBLE_INPUT_ROWS} from '../src/app/layout.js';
import {buildInlineContextPrefix} from '../src/prompt/prompt.js';
import {tabCompletionAction} from '../src/input/tabBehavior.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

test('single-line caret includes the prompt prefix and supports middle positions', () => {
  assert.deepEqual(layoutInput('hello', 5, 80).caretColumn, 7);
  assert.deepEqual(layoutInput('hello', 2, 80).caretColumn, 4);
  assert.equal(layoutInput('界x', 1, 80).caretColumn, 4);
});

test('distinguishes explicit newlines from visual wrapping and recomputes on resize', () => {
  const explicit = layoutInput('ab\ncd', 5, 20);
  assert.equal(explicit.allRows.length, 2);
  assert.deepEqual(explicit.allRows.map(row => row.text), ['ab', 'cd']);
  assert.equal(explicit.caretRow, 1);
  assert.equal(explicit.caretColumn, 4);

  const wide = layoutInput('abcdefgh', 8, 12);
  const narrow = layoutInput('abcdefgh', 8, 6);
  assert.equal(wide.allRows.length, 1);
  assert.ok(narrow.allRows.length > wide.allRows.length);
  assert.equal(narrow.caretRow, narrow.allRows.length - 1);
});

test('one-line composer keeps dynamic context in the first editable row and preserves multiline source', () => {
  const configuration = normalizePromptConfiguration({composerLayout: 'oneLine', placement: 'header'});
  const context = {cwd: '/tmp/work', project: 'work', branch: 'dev', exitStatus: 4};
  const prefix = buildInlineContextPrefix(context, 80, configuration);
  const source = 'printf "hello"\nnext-command';
  const editor = new CommandEditor();
  editor.insert(source);
  const layout = layoutInput(editor.displayText, editor.displayCursorIndex, 80, Number.POSITIVE_INFINITY, prefix);

  assert.match(stripAnsi(layout.allRows[0]?.prefix ?? ''), /work .*\/tmp\/work .* dev .*✘ 4  ❯ $/u);
  assert.equal(layout.allRows[0]?.text, 'printf "hello"');
  assert.equal(layout.allRows[1]?.prefix, '  ');
  assert.equal(layout.allRows[1]?.text, 'next-command');
  assert.equal(editor.text, source, 'prompt/context remain presentation chrome outside editor source');
  assert.equal(displayWidth(prefix) + 1 <= 80, true, 'the prefix leaves editable command width');
});

test('editor inserts and edits across newline boundaries', () => {
  const editor = new CommandEditor();
  editor.insert('first\nsecond');
  editor.lineHome();
  assert.equal(editor.cursorIndex, 6);
  editor.backspace();
  assert.equal(editor.text, 'firstsecond');
  editor.insert('\n');
  editor.moveLeft();
  editor.delete();
  assert.equal(editor.text, 'firstsecond');
  editor.moveUp(8);
  editor.moveDown(8);
});

test('Ctrl-J and reported Shift-Enter insert newlines while carriage return submits', () => {
  assert.deepEqual(decodeKeys('\n'), [{kind: 'newline'}]);
  assert.deepEqual(decodeKeys('\u001B[13;2u'), [{kind: 'newline'}]);
  assert.deepEqual(decodeKeys('\u001B[27;2;13~'), [{kind: 'newline'}]);
  assert.deepEqual(decodeKeys('\r'), [{kind: 'enter'}]);
});

test('bracketed multiline paste is one insertion and survives split input chunks', () => {
  assert.deepEqual(decodeKeys('\u001B[200~one\r\ntwo\u001B[201~'), [{kind: 'paste', value: 'one\r\ntwo'}]);
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B[200~one\n'), []);
  assert.deepEqual(decoder.push('two\u001B[201~'), [{kind: 'paste', value: 'one\ntwo'}]);
  assert.deepEqual(decoder.push('x\u001B[200~a\nb\u001B[201~y'), [
    {kind: 'text', value: 'x'},
    {kind: 'paste', value: 'a\nb'},
    {kind: 'text', value: 'y'},
  ]);
});

test('small pasted text stays editable and normalizes line endings', () => {
  const editor = new CommandEditor();
  editor.insert('prefix ');
  editor.insertPaste('one\r\ntwo');
  assert.equal(editor.hasPasteAtoms, false);
  assert.equal(editor.text, 'prefix one\ntwo');
  editor.moveLeft();
  editor.backspace();
  assert.equal(editor.text, 'prefix one\nto');
});

test('large multiline paste is displayed as one atomic label and preserves exact source', () => {
  const editor = new CommandEditor();
  const source = 'alpha\r\nbeta\ngamma\rdelta';
  editor.insert('run ');
  editor.insertPaste(source);
  editor.insert(' tail');
  assert.equal(editor.hasPasteAtoms, true);
  assert.equal(editor.text, `run ${source} tail`);
  assert.equal(editor.displayText, 'run [Text #1 · 4 lines] tail');
  assert.deepEqual(editor.displayPasteAtoms, [{start: 4, end: 23}]);
  editor.moveLeft();
  assert.equal(editor.cursorIndex, 9);
  editor.moveRight();
  assert.equal(editor.cursorIndex, 10);
  const adjacent = new CommandEditor();
  adjacent.insertPaste(source);
  adjacent.backspace();
  assert.equal(adjacent.text, '');
  const deleteAdjacent = new CommandEditor();
  deleteAdjacent.insertPaste(source);
  deleteAdjacent.moveBufferHome();
  deleteAdjacent.delete();
  assert.equal(deleteAdjacent.text, '');
});

test('paste atom labels follow visual order and renumber after delete or unwrap', () => {
  const first = 'one\ntwo\nthree\nfour';
  const second = 'a\nb\nc\nd\ne\nf\ng';
  const editor = new CommandEditor();
  editor.insert('prefix ');
  editor.insertPaste(first);
  editor.insert(' between ');
  editor.insertPaste(second);
  editor.insert(' suffix');
  assert.equal(editor.displayText, 'prefix [Text #1 · 4 lines] between [Text #2 · 7 lines] suffix');
  assert.equal(editor.text, `prefix ${first} between ${second} suffix`);

  editor.moveBufferHome();
  for (let index = 0; index < 18; index += 1) editor.moveRight();
  editor.backspace();
  assert.equal(editor.displayText, 'prefix [Text #1 · 4 lines] between  suffix');

  const unwrap = new CommandEditor();
  unwrap.insertPaste(first);
  unwrap.insert(' ');
  unwrap.insertPaste(second);
  assert.equal(unwrap.displayText, '[Text #1 · 4 lines] [Text #2 · 7 lines]');
  unwrap.moveBufferHome();
  unwrap.unwrapAdjacentPasteAtom();
  assert.equal(unwrap.displayText, `${first} [Text #1 · 7 lines]`);
  assert.equal(unwrap.text, `${first} ${second}`);
});

test('delete removes a paste atom whole and Ctrl+O unwraps the original editable source', () => {
  const source = 'one\r\ntwo\nthree\nfour';
  const deleted = new CommandEditor();
  deleted.insertPaste(source);
  deleted.moveBufferHome();
  deleted.delete();
  assert.equal(deleted.text, '');

  const editor = new CommandEditor();
  editor.insertPaste(source);
  assert.equal(editor.unwrapAdjacentPasteAtom(), true);
  assert.equal(editor.hasPasteAtoms, false);
  assert.equal(editor.text, source);
  editor.backspace();
  assert.equal(editor.text, 'one\r\ntwo\nthree\nfou');
});

test('word movement and deletion do not split a large paste atom', () => {
  const source = 'one\ntwo\nthree\nfour';
  const editor = new CommandEditor();
  editor.insertPaste(source);
  editor.wordLeft();
  assert.equal(editor.cursorIndex, 0);
  editor.wordRight();
  assert.equal(editor.cursorIndex, 1);
  editor.moveBufferEnd();
  editor.deleteWord();
  assert.equal(editor.text, '');
});

test('input grows upward, caps at eight rows, and preserves output space', () => {
  const normal = calculateScreenLayout(24, 3, 0);
  assert.equal(normal.inputHeight, 3);
  assert.equal(normal.outputHeight, 19);
  const capped = calculateScreenLayout(24, 100, 0);
  assert.equal(capped.inputHeight, MAX_VISIBLE_INPUT_ROWS);
  assert.ok(capped.outputHeight >= 2);
  const tiny = calculateScreenLayout(5, 100, 0);
  assert.equal(tiny.inputHeight, 3);
  assert.equal(tiny.outputHeight, 0);
});

test('composer context placement reserves a frame row and keeps the screen row budget exact', () => {
  const layout = calculateScreenLayout(24, 2, 2, true, false, true, 'composer', true);
  assert.equal(layout.showComposerTopBorder, true);
  assert.equal(layout.showPrompt, true);
  assert.equal(layout.showSeparator, true);
  assert.equal(layout.outputHeight + layout.inputHeight + layout.suggestionCount
    + Number(layout.showJump) + (layout.showLiveActivity ? 2 : 0)
    + Number(layout.showPrompt) + Number(layout.showComposerTopBorder)
    + Number(layout.showSeparator) + Number(layout.showGap), 24);
});

test('one-line composer keeps context off the upper boundary and preserves the live activity budget', () => {
  const rows = 24;
  const oneLine = calculateScreenLayout(rows, 3, 2, true, false, true, 'header', true, 'oneLine');
  const twoLine = calculateScreenLayout(rows, 3, 2, true, false, true, 'header', true, 'twoLine');
  assert.equal(oneLine.showPrompt, false, 'one-line context is part of the editable row, never a top/header row');
  assert.equal(oneLine.showComposerTopBorder, true, 'one-line mode has an ordinary upper composer boundary');
  assert.equal(oneLine.showSeparator, true, 'one-line mode keeps the lower composer boundary');
  assert.equal(oneLine.showLiveActivity, true);
  assert.equal(twoLine.showLiveActivity, true);
  assert.equal(Number(oneLine.showLiveActivity) * 2, 2, 'primary activity retains its row and existing breathing-space row');

  for (const [layout, height] of [[oneLine, rows], [twoLine, rows]] as const) {
    assert.equal(layout.outputHeight + layout.inputHeight + layout.suggestionCount
      + Number(layout.showJump) + (layout.showLiveActivity ? 2 : 0)
      + Number(layout.showPrompt) + Number(layout.showComposerTopBorder)
      + Number(layout.showSeparator) + Number(layout.showGap), height);
  }

  const smallestUsable = calculateScreenLayout(3, 1, 0, false, false, false, 'header', true, 'oneLine');
  assert.equal(smallestUsable.showComposerTopBorder, true);
  assert.equal(smallestUsable.showPrompt, false);
  assert.equal(smallestUsable.showSeparator, true);
  assert.equal(smallestUsable.outputHeight + smallestUsable.inputHeight
    + Number(smallestUsable.showComposerTopBorder) + Number(smallestUsable.showSeparator), 3);
});

test('narrow one-line layouts omit context and keep double-width input visible', () => {
  const configuration = normalizePromptConfiguration({composerLayout: 'oneLine'});
  const prefix = buildInlineContextPrefix({cwd: '/tmp/work', project: 'work', branch: 'dev'}, 3, configuration);
  assert.equal(stripAnsi(prefix), '❯');
  const input = layoutInput('界\n界', 3, 3, Number.POSITIVE_INFINITY, prefix);
  assert.equal(input.allRows[0]?.text, '界');
  assert.equal(input.allRows[1]?.prefix, '');
  assert.equal(input.allRows[1]?.text, '界');
});

test('decodes terminal paging aliases and Ctrl-End variants', () => {
  assert.deepEqual(decodeKeys('\u001B[5~'), [{kind: 'pageUp'}]);
  assert.deepEqual(decodeKeys('\u001B[6~'), [{kind: 'pageDown'}]);
  assert.deepEqual(decodeKeys('\u001B[1;5F'), [{kind: 'latest'}]);
  assert.deepEqual(decodeKeys('\u001B[5;5~'), [{kind: 'latest'}]);
  assert.deepEqual(decodeKeys('\u0007'), [{kind: 'latest'}]);
  assert.deepEqual(decodeKeys('\t'), [{kind: 'complete'}]);
});

test('key decoder preserves paging sequences split across input chunks', () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B['), []);
  assert.deepEqual(decoder.push('5~'), [{kind: 'pageUp'}]);
  assert.deepEqual(decoder.push('\u001B[1;'), []);
  assert.deepEqual(decoder.push('5F'), [{kind: 'latest'}]);
});

test('Tab selects NMSh completions when available and never falls through to history focus', () => {
  assert.equal(tabCompletionAction(1, 0), 'shell-suggestion');
  assert.equal(tabCompletionAction(0, 2), 'slash-suggestion');
  assert.equal(tabCompletionAction(0, 0), 'ignore');
});

test('select all and backspace clears the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.backspace();
  assert.equal(editor.text, '');
});

test('select all and delete clears the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.delete();
  assert.equal(editor.text, '');
});

test('select all and character replaces the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.insert('x');
  assert.equal(editor.text, 'x');
});

test('select all and paste replaces the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.insert('hello');
  assert.equal(editor.text, 'hello');
});

test('multiline selection replacement', () => {
  const editor = new CommandEditor();
  editor.insert('abc\ndef');
  editor.selectAll();
  editor.insert('x');
  assert.equal(editor.text, 'x');
});

test('character selection expands and contracts correctly', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.moveLeft();
  editor.moveLeft(); // cursor at 4
  assert.equal(editor.cursorIndex, 4);
  editor.selectLeft();
  assert.deepEqual(editor.selection, {start: 3, end: 4});
  editor.selectLeft();
  assert.deepEqual(editor.selection, {start: 2, end: 4});
  editor.selectRight();
  assert.deepEqual(editor.selection, {start: 3, end: 4});
  editor.selectRight();
  assert.equal(editor.selection, undefined);
  assert.equal(editor.cursorIndex, 4);
});

test('reverse selection crossing anchor behaves correctly', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.moveLeft();
  editor.moveLeft(); // cursor at 4
  editor.selectLeft(); // cursor 3, anchor 4
  editor.selectRight(); // cursor 4, anchor 4 (empty)
  editor.selectRight(); // cursor 5, anchor 4
  assert.deepEqual(editor.selection, {start: 4, end: 5});
});

test('word selection extends boundaries', () => {
  const editor = new CommandEditor();
  editor.insert('foo bar baz');
  editor.wordLeft(); // cursor before baz (8)
  editor.selectWordLeft(); // cursor before bar (4), anchor 8
  assert.deepEqual(editor.selection, {start: 4, end: 8});
  editor.selectWordRight(); // cursor before baz (8), anchor 8
  assert.equal(editor.selection, undefined);
  editor.selectWordRight(); // cursor end (11), anchor 8
  assert.deepEqual(editor.selection, {start: 8, end: 11});
});

test('plain arrow collapses selection', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.lineHome();
  editor.selectRight();
  editor.selectRight(); // select 'ab' (0..2)
  editor.moveLeft();
  assert.equal(editor.selection, undefined);
  assert.equal(editor.cursorIndex, 0);

  editor.selectRight();
  editor.selectRight(); // select 'ab'
  editor.moveRight();
  assert.equal(editor.selection, undefined);
  assert.equal(editor.cursorIndex, 2);
});

test('Ctrl+A CSI-u mapping', () => {
  assert.deepEqual(decodeKeys('\u001B[97;5u'), [{kind: 'lineHome'}]);
  assert.deepEqual(decodeKeys('\u0001'), [{kind: 'lineHome'}]);
  assert.deepEqual(decodeKeys('\u001B[101;5u'), [{kind: 'lineEnd'}]);
});

test('multiline selection', () => {
  const editor = new CommandEditor();
  editor.insert('abc\ndef');
  editor.lineHome(); // start of second line (index 4)
  editor.selectLeft(); // select '\n' (3..4)
  assert.deepEqual(editor.selection, {start: 3, end: 4});
  editor.selectLeft(); // select 'c\n' (2..4)
  assert.deepEqual(editor.selection, {start: 2, end: 4});
  editor.insert('x');
  assert.equal(editor.text, 'abxdef');
});
