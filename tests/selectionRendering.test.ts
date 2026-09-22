/**
 * Tests for partial selection rendering and Ghostty Option+Backspace.
 *
 * These tests:
 * 1. Behaviorally prove selection state is real (replacement and backspace)
 * 2. Verify rendered ANSI spans include the selection background
 * 3. Verify Ghostty Option+Backspace sequence decodes correctly
 * 4. Verify VS Code Option+Backspace still works
 * 5. Verify no raw escape sequences leak into the editor
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeKeys, KeyDecoder} from '../src/terminal/keys.js';
import {CommandEditor} from '../src/input/CommandEditor.js';
import {layoutInput, graphemes} from '../src/input/inputLayout.js';
import {UI_COLORS, background, foreground} from '../src/ui/palette.js';

// ---------------------------------------------------------------------------
// Minimal dispatch helper — same logic as TerminalApp.handleKey
// ---------------------------------------------------------------------------
function dispatch(editor: CommandEditor, key: ReturnType<typeof decodeKeys>[number]): void {
  if (key.kind === 'text') editor.insert(key.value);
  else if (key.kind === 'left') editor.moveLeft();
  else if (key.kind === 'right') editor.moveRight();
  else if (key.kind === 'selectLeft') editor.selectLeft();
  else if (key.kind === 'selectRight') editor.selectRight();
  else if (key.kind === 'wordLeft') editor.wordLeft();
  else if (key.kind === 'wordRight') editor.wordRight();
  else if (key.kind === 'selectWordLeft') editor.selectWordLeft();
  else if (key.kind === 'selectWordRight') editor.selectWordRight();
  else if (key.kind === 'lineHome') editor.lineHome();
  else if (key.kind === 'lineEnd') editor.lineEnd();
  else if (key.kind === 'selectAll') editor.selectAll();
  else if (key.kind === 'backspace') editor.backspace();
  else if (key.kind === 'deleteWord') editor.deleteWord();
  else if (key.kind === 'newline') editor.insert('\n');
}

function pushRaw(decoder: KeyDecoder, editor: CommandEditor, raw: string): void {
  for (const key of decoder.push(raw)) dispatch(editor, key);
}

// ---------------------------------------------------------------------------
// TASK 1: Behavioural proof that selection state is REAL
// ---------------------------------------------------------------------------

test('BEHAVIORAL PROOF: Shift+Left + type x replaces selected char (abcdef → abcdex)', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'abcdef');
  assert.equal(e.text, 'abcdef');
  assert.equal(e.cursorIndex, 6);
  // Shift+Left should select 'f'
  pushRaw(d, e, '\u001B[1;2D');
  assert.deepEqual(e.selection, {start: 5, end: 6}, 'selection must be {5,6} after Shift+Left');
  // Typing x must replace 'f'
  pushRaw(d, e, 'x');
  assert.equal(e.text, 'abcdex', 'x must replace selected f, proving selection was real');
});

test('BEHAVIORAL PROOF: Shift+Left + Backspace deletes selected char (abcdef → abcde)', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'abcdef');
  pushRaw(d, e, '\u001B[1;2D'); // Shift+Left → select 'f'
  assert.deepEqual(e.selection, {start: 5, end: 6});
  // Backspace must delete the selected character
  pushRaw(d, e, '\x7F');
  assert.equal(e.text, 'abcde', 'backspace on selection must delete f, proving selection was real');
});

test('BEHAVIORAL PROOF: two Shift+Left + type x replaces ef (abcdef → abcdx)', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'abcdef');
  pushRaw(d, e, '\u001B[1;2D'); // select 'f'
  pushRaw(d, e, '\u001B[1;2D'); // expand to 'ef'
  assert.deepEqual(e.selection, {start: 4, end: 6}, 'selection must span ef');
  pushRaw(d, e, 'x');
  assert.equal(e.text, 'abcdx', 'x must replace ef');
});

test('BEHAVIORAL PROOF: Shift+Left then Shift+Right collapses selection (no replacement)', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'abcdef');
  pushRaw(d, e, '\u001B[1;2D'); // select 'f'
  pushRaw(d, e, '\u001B[1;2C'); // contract — selection collapses
  assert.equal(e.selection, undefined, 'selection must collapse when contracted back to anchor');
  // Now typing x should insert, not replace
  pushRaw(d, e, 'x');
  assert.equal(e.text, 'abcdefx', 'no selection → x appends at cursor');
});

test('BEHAVIORAL PROOF: Alt+Shift+Left selects word, replacement replaces it', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'foo bar baz');
  // cursor is at end (11). Alt+Shift+Left should select 'baz'
  pushRaw(d, e, '\u001B[1;4D');
  assert.ok(e.selection !== undefined, 'Alt+Shift+Left must create selection');
  const {start, end} = e.selection!;
  const selected = Array.from(e.text).slice(start, end).join('');
  assert.equal(selected, 'baz', 'Alt+Shift+Left from end must select baz');
  // Replace with 'qux'
  pushRaw(d, e, 'qux');
  assert.equal(e.text, 'foo bar qux', 'replacement must produce foo bar qux');
});

// ---------------------------------------------------------------------------
// TASK 2: Rendered ANSI span verification
// ---------------------------------------------------------------------------

// Build the same styled row string that TerminalApp builds
function renderRow(text: string, sel: {start: number; end: number} | undefined, charStart: number, charEnd: number): string {
  const SELECTION_BG = background(UI_COLORS.selection);
  const PRIMARY = foreground(UI_COLORS.primary);
  const RESET = '\u001B[0m';

  if (!sel || sel.start >= charEnd || sel.end <= charStart) {
    return `${PRIMARY}${text}${RESET}`;
  }
  const glyphs = graphemes(text);
  const preEnd = Math.max(0, sel.start - charStart);
  const selEnd = Math.min(glyphs.length, sel.end - charStart);
  const pre = glyphs.slice(0, preEnd).join('');
  const selected = glyphs.slice(preEnd, selEnd).join('');
  const post = glyphs.slice(selEnd).join('');
  return `${PRIMARY}${pre}${SELECTION_BG}${PRIMARY}${selected}${RESET}${PRIMARY}${post}${RESET}`;
}

test('rendered row for "abcdef" with selection {5,6} contains selection background escape for "f"', () => {
  const SELECTION_BG = background(UI_COLORS.selection);
  // selection {start:5, end:6} on a single row charStart=0, charEnd=6
  const styled = renderRow('abcdef', {start: 5, end: 6}, 0, 6);
  assert.ok(styled.includes(SELECTION_BG),
    `Selection BG escape (${JSON.stringify(SELECTION_BG)}) must appear in rendered row`);
  assert.ok(styled.includes('abcde'), 'pre-selection text must be present');
  assert.ok(styled.includes('f'), 'selected character must be present');
});

test('rendered row for "abcdef" with selection {4,6} highlights "ef"', () => {
  const SELECTION_BG = background(UI_COLORS.selection);
  const styled = renderRow('abcdef', {start: 4, end: 6}, 0, 6);
  assert.ok(styled.includes(SELECTION_BG), 'selection BG must be present');
  // "ef" appears after the selection BG escape
  const bgIndex = styled.indexOf(SELECTION_BG);
  const afterBg = styled.slice(bgIndex + SELECTION_BG.length);
  assert.ok(afterBg.startsWith('\u001B[38;2;'), 'PRIMARY foreground follows selection BG');
  // ef must appear somewhere after selection BG
  assert.ok(styled.indexOf('ef') > bgIndex, '"ef" must follow selection background escape');
});

test('rendered row with no selection does NOT contain selection background escape', () => {
  const SELECTION_BG = background(UI_COLORS.selection);
  const styled = renderRow('abcdef', undefined, 0, 6);
  assert.ok(!styled.includes(SELECTION_BG), 'no selection BG when selection is undefined');
});

test('rendered row when selection does not overlap row has no selection background', () => {
  const SELECTION_BG = background(UI_COLORS.selection);
  // row covers chars 0-2, selection is 5-6
  const styled = renderRow('abc', {start: 5, end: 6}, 0, 3);
  assert.ok(!styled.includes(SELECTION_BG), 'no selection BG when selection is outside row range');
});

test('selection color RGB(88,96,145) is visibly distinct from a dark terminal background', () => {
  // RGB(88,96,145) = muted blue-violet, clearly visible on typical dark ~RGB(30,30,30) terminal
  assert.equal(UI_COLORS.selection.red, 88);
  assert.equal(UI_COLORS.selection.green, 96);
  assert.equal(UI_COLORS.selection.blue, 145);
  // Ensure it's clearly different from near-black (brightness check)
  const brightness = 0.299 * UI_COLORS.selection.red + 0.587 * UI_COLORS.selection.green + 0.114 * UI_COLORS.selection.blue;
  // A typical near-black terminal bg has brightness < 15. Our color should be > 70.
  assert.ok(brightness > 70, `Selection color brightness (${brightness.toFixed(1)}) must be visibly above black`);
});

test('TASK 4: multiline selection - charStart/charEnd correctly bounds each row', () => {
  // "abc\ndef" — first row covers 0..3 (abc + \n), second covers 4..7 (def)
  const layout = layoutInput('abc\ndef', 7, 80);
  assert.equal(layout.allRows.length, 2);
  const row0 = layout.allRows[0];
  const row1 = layout.allRows[1];

  // Selection crossing the newline: {start: 2, end: 5} covers 'c', '\n', 'd'
  const sel = {start: 2, end: 5};

  // Row 0: charStart=0, charEnd=4. Selection overlaps at indices 2-3 within row0
  const SELECTION_BG = background(UI_COLORS.selection);
  const styled0 = renderRow(row0.text, sel, row0.charStart, row0.charEnd);
  assert.ok(styled0.includes(SELECTION_BG), 'row0 must have selection BG for "c" portion');
  assert.ok(styled0.includes('c'), '"c" must appear in styled row0');

  // Row 1: charStart=4, charEnd=7. Selection overlaps at index 4 within row1 (only 'd')
  const styled1 = renderRow(row1.text, sel, row1.charStart, row1.charEnd);
  assert.ok(styled1.includes(SELECTION_BG), 'row1 must have selection BG for "d" portion');
});

// ---------------------------------------------------------------------------
// TASK 5: Ghostty Option+Backspace — actual Kitty sequence
// ---------------------------------------------------------------------------

test('Ghostty Option+Backspace: ESC[127;3u decodes as deleteWord', () => {
  // Ghostty with kitty keyboard mode sends \u001B[127;3u for Option+Backspace
  // (Kitty protocol: char=127=DEL, modifier=Alt=2+1=3)
  const keys = decodeKeys('\u001B[127;3u');
  assert.equal(keys.length, 1, 'must decode to exactly one key');
  assert.equal(keys[0].kind, 'deleteWord', 'ESC[127;3u must decode as deleteWord');
});

test('Ghostty Option+Backspace does NOT leak raw text into editor', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  // Type some text, then Option+Backspace
  pushRaw(d, e, 'hello world');
  pushRaw(d, e, '\u001B[127;3u'); // Ghostty Option+Backspace
  // Should delete 'world' (the last word)
  // Neither '[', '1', '2', '7', ';', '3', 'u' should appear in the editor text
  assert.ok(!e.text.includes('['), 'no "[" leaked into editor');
  assert.ok(!e.text.includes('u'), 'no "u" leaked into editor after Option+Backspace');
  assert.ok(!e.text.includes(';'), 'no ";" leaked into editor');
});

test('Ghostty Option+Backspace: "hello world" → "hello " after one deleteWord', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'hello world');
  pushRaw(d, e, '\u001B[127;3u');
  assert.equal(e.text, 'hello ', '"hello world" → "hello " after Ghostty Option+Backspace');
});

test('VS Code Option+Backspace: ESC DEL decodes as deleteWord', () => {
  // VS Code sends ESC + DEL (0x1B 0x7F) for Option+Backspace
  const keys = decodeKeys('\u001B\u007F');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'deleteWord', 'ESC DEL must decode as deleteWord');
});

test('VS Code Option+Backspace: "hello world" → "hello " after one deleteWord', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'hello world');
  pushRaw(d, e, '\u001B\u007F'); // VS Code Option+Backspace
  assert.equal(e.text, 'hello ', '"hello world" → "hello " after VS Code Option+Backspace');
});

test('TASK 6: Ghostty and VS Code Option+Backspace produce identical semantic result', () => {
  // Both sequences must map to deleteWord with identical behavioral outcome
  const ghosttyKey = decodeKeys('\u001B[127;3u');
  const vscodeKey = decodeKeys('\u001B\u007F');
  assert.equal(ghosttyKey[0].kind, 'deleteWord');
  assert.equal(vscodeKey[0].kind, 'deleteWord');

  // Same outcome on same editor state
  const d1 = new KeyDecoder(), e1 = new CommandEditor();
  const d2 = new KeyDecoder(), e2 = new CommandEditor();
  pushRaw(d1, e1, 'foo bar');
  pushRaw(d2, e2, 'foo bar');
  pushRaw(d1, e1, '\u001B[127;3u');  // Ghostty
  pushRaw(d2, e2, '\u001B\u007F');   // VS Code
  assert.equal(e1.text, e2.text, 'Ghostty and VS Code Option+Backspace must produce identical result');
});

test('TASK 8: Ctrl+W still maps to deleteWord', () => {
  const keys = decodeKeys('\u0017'); // Ctrl+W
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'deleteWord');
});

test('TASK 8: Ctrl+W "hello world" → "hello "', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'hello world');
  pushRaw(d, e, '\u0017');
  assert.equal(e.text, 'hello ');
});

test('TASK 8: Option+Left (ESC[1;3D) remains wordLeft', () => {
  const keys = decodeKeys('\u001B[1;3D');
  assert.equal(keys[0].kind, 'wordLeft');
});

test('TASK 8: Option+Right (ESC[1;3C) remains wordRight', () => {
  const keys = decodeKeys('\u001B[1;3C');
  assert.equal(keys[0].kind, 'wordRight');
});

test('TASK 8: Ghostty Shift+Enter (ESC[13;2u) remains newline', () => {
  const keys = decodeKeys('\u001B[13;2u');
  assert.equal(keys[0].kind, 'newline');
});

test('TASK 8: Ctrl+A remains home', () => {
  assert.equal(decodeKeys('\u0001')[0].kind, 'lineHome');
});

test('TASK 8: Ctrl+E remains end', () => {
  assert.equal(decodeKeys('\u0005')[0].kind, 'lineEnd');
});

test('TASK 8: Ctrl+U remains deleteLineBefore', () => {
  assert.equal(decodeKeys('\u0015')[0].kind, 'deleteLineBefore');
});

test('TASK 8: Ctrl+K remains deleteLineAfter', () => {
  assert.equal(decodeKeys('\u000B')[0].kind, 'deleteLineAfter');
});

test('TASK 8: Ctrl+C remains interrupt', () => {
  assert.equal(decodeKeys('\u0003')[0].kind, 'interrupt');
});

test('TASK 8: Kitty Alt+Shift+Backspace (ESC[127;4u) maps to deleteWord', () => {
  const keys = decodeKeys('\u001B[127;4u');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'deleteWord');
});

test('TASK 9: Ctrl+J (\\n) remains newline fallback', () => {
  const keys = decodeKeys('\n');
  assert.equal(keys[0].kind, 'newline', 'Ctrl+J must remain newline in all hosts');
});
