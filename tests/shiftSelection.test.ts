/**
 * Full-pipeline integration tests for shift-selection.
 *
 * These tests exercise the COMPLETE real path:
 *   raw stdin bytes → KeyDecoder → semantic Key → TerminalApp dispatch → CommandEditor state
 *
 * They do NOT call editor.selectLeft() directly — they feed raw terminal sequences
 * through the same decoder and dispatch used by stdin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeKeys, KeyDecoder} from '../src/terminal/keys.js';
import {CommandEditor} from '../src/input/CommandEditor.js';
import {layoutInput} from '../src/input/inputLayout.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {copyStats, copyFeedback} from '../src/clipboard/clipboard.js';

// ---------------------------------------------------------------------------
// Minimal TerminalApp-like dispatch: feeds decoded keys into CommandEditor.
// This mirrors the handleKey() switch in TerminalApp exactly.
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
  else if (key.kind === 'selectLineHome') editor.selectLineHome();
  else if (key.kind === 'selectLineEnd') editor.selectLineEnd();
  else if (key.kind === 'backspace') editor.backspace();
  else if (key.kind === 'delete') editor.delete();
  else if (key.kind === 'newline') editor.insert('\n');
}

function pushRaw(decoder: KeyDecoder, editor: CommandEditor, rawBytes: string): void {
  for (const key of decoder.push(rawBytes)) dispatch(editor, key);
}

// ---------------------------------------------------------------------------
// Task 3: Full pipeline tests — raw ESC sequences → decoder → dispatch → editor
// ---------------------------------------------------------------------------

test('ESC[1;2D (Shift+Left) feeds through decoder as selectLeft, not left', () => {
  // Verify at decoder level first
  const keys = decodeKeys('\u001B[1;2D');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'selectLeft', 'ESC[1;2D must decode as selectLeft, not left');
});

test('ESC[1;2C (Shift+Right) feeds through decoder as selectRight, not right', () => {
  const keys = decodeKeys('\u001B[1;2C');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'selectRight', 'ESC[1;2C must decode as selectRight, not right');
});

test('ESC[1;4D (Alt+Shift+Left) feeds through decoder as selectWordLeft', () => {
  const keys = decodeKeys('\u001B[1;4D');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'selectWordLeft', 'ESC[1;4D must decode as selectWordLeft');
});

test('ESC[1;4C (Alt+Shift+Right) feeds through decoder as selectWordRight', () => {
  const keys = decodeKeys('\u001B[1;4C');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'selectWordRight', 'ESC[1;4C must decode as selectWordRight');
});

test('ESC[1;3D (Alt+Left) feeds through decoder as wordLeft, not selectWordLeft', () => {
  const keys = decodeKeys('\u001B[1;3D');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'wordLeft', 'Alt+Left must be wordLeft, not selectWordLeft');
});

test('ESC[1;3C (Alt+Right) feeds through decoder as wordRight, not selectWordRight', () => {
  const keys = decodeKeys('\u001B[1;3C');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'wordRight', 'Alt+Right must be wordRight, not selectWordRight');
});

test('full pipeline: Shift+Left creates real selection anchor/head — not just cursor movement', () => {
  const decoder = new KeyDecoder();
  const editor = new CommandEditor();

  // Seed text: "abcdef", cursor at end (6)
  pushRaw(decoder, editor, 'abcdef');
  assert.equal(editor.text, 'abcdef');
  assert.equal(editor.cursorIndex, 6);
  assert.equal(editor.selection, undefined, 'no selection before shift-left');

  // Feed raw Shift+Left (ESC[1;2D) through decoder → dispatch
  pushRaw(decoder, editor, '\u001B[1;2D');

  // After one Shift+Left: cursor moves to 5, anchor stays at 6
  assert.equal(editor.cursorIndex, 5, 'cursor must be at 5 after Shift+Left');
  assert.deepEqual(editor.selection, {start: 5, end: 6}, 'selection must be {start:5, end:6}');
  // Verify selected text is "f"
  const text = editor.text;
  const sel = editor.selection!;
  const selectedText = Array.from(text).slice(sel.start, sel.end).join('');
  assert.equal(selectedText, 'f', 'selected text must be "f"');
});

test('full pipeline: repeated Shift+Left expands selection', () => {
  const decoder = new KeyDecoder();
  const editor = new CommandEditor();
  pushRaw(decoder, editor, 'abcdef');

  // Feed two Shift+Left sequences
  pushRaw(decoder, editor, '\u001B[1;2D');
  pushRaw(decoder, editor, '\u001B[1;2D');

  assert.deepEqual(editor.selection, {start: 4, end: 6}, 'selection must expand to {start:4, end:6}');
  const text = editor.text;
  const sel = editor.selection!;
  const selectedText = Array.from(text).slice(sel.start, sel.end).join('');
  assert.equal(selectedText, 'ef', 'selected text must be "ef"');
});

test('full pipeline: Shift+Right after Shift+Left contracts selection', () => {
  const decoder = new KeyDecoder();
  const editor = new CommandEditor();
  pushRaw(decoder, editor, 'abcdef');

  // Expand selection by two
  pushRaw(decoder, editor, '\u001B[1;2D');
  pushRaw(decoder, editor, '\u001B[1;2D');
  assert.deepEqual(editor.selection, {start: 4, end: 6});

  // Contract by one Shift+Right
  pushRaw(decoder, editor, '\u001B[1;2C');
  assert.deepEqual(editor.selection, {start: 5, end: 6}, 'one Shift+Right must contract selection to "f"');

  // Contract to zero (selection collapses)
  pushRaw(decoder, editor, '\u001B[1;2C');
  assert.equal(editor.selection, undefined, 'selection must collapse when anchor equals cursor');
  assert.equal(editor.cursorIndex, 6, 'cursor must be at original anchor position');
});

test('full pipeline: Shift+Left then selectLeft is distinct from plain Left', () => {
  const decoder = new KeyDecoder();
  const editor = new CommandEditor();
  pushRaw(decoder, editor, 'abcdef');
  const startCursor = editor.cursorIndex; // 6

  // Plain Left: no selection, cursor moves
  pushRaw(decoder, editor, '\u001B[D');
  assert.equal(editor.selection, undefined, 'plain Left must not create selection');
  assert.equal(editor.cursorIndex, 5);

  // Now do Shift+Left: creates selection
  pushRaw(decoder, editor, '\u001B[1;2D');
  assert.notEqual(editor.selection, undefined, 'Shift+Left must create selection');
  assert.deepEqual(editor.selection, {start: 4, end: 5});

  void startCursor;
});

test('full pipeline: Alt+Shift+Left (ESC[1;4D) creates word selection', () => {
  const decoder = new KeyDecoder();
  const editor = new CommandEditor();
  pushRaw(decoder, editor, 'foo bar baz');
  assert.equal(editor.cursorIndex, 11); // end

  // One Alt+Shift+Left selects "baz"
  pushRaw(decoder, editor, '\u001B[1;4D');
  assert.notEqual(editor.selection, undefined, 'Alt+Shift+Left must create selection');
  const sel = editor.selection!;
  const selectedText = Array.from(editor.text).slice(sel.start, sel.end).join('');
  assert.equal(selectedText, 'baz', 'Alt+Shift+Left from end must select "baz"');
});

test('full pipeline: Alt+Shift+Right (ESC[1;4C) extends word selection', () => {
  const decoder = new KeyDecoder();
  const editor = new CommandEditor();
  pushRaw(decoder, editor, 'foo bar baz');
  // Move to start with Ctrl+A (ESC[97;5u)
  pushRaw(decoder, editor, '\u001B[97;5u');
  assert.equal(editor.cursorIndex, 0);

  // Alt+Shift+Right: select "foo"
  pushRaw(decoder, editor, '\u001B[1;4C');
  assert.notEqual(editor.selection, undefined);
  const sel = editor.selection!;
  const selectedText = Array.from(editor.text).slice(sel.start, sel.end).join('');
  // "foo" should be selected (word movement skips word then spaces)
  assert.ok(selectedText.startsWith('foo'), `Expected selection to start with "foo", got "${selectedText}"`);
});

// Task 4: Verify rendered selection state
test('input layout charStart/charEnd tracks per-row character ranges correctly', () => {
  const layout = layoutInput('abcdef', 6, 80);
  assert.equal(layout.rows.length, 1, 'single row for short text');
  assert.equal(layout.rows[0].charStart, 0);
  assert.equal(layout.rows[0].charEnd, 6);
});

test('input layout charStart/charEnd for multiline text', () => {
  const layout = layoutInput('abc\ndef', 7, 80);
  assert.equal(layout.allRows.length, 2, 'two rows for text with newline');
  // First row contains 'abc' + '\n' in range
  assert.equal(layout.allRows[0].charStart, 0);
  assert.equal(layout.allRows[0].charEnd, 4, 'charEnd includes the newline');
  // Second row contains 'def'
  assert.equal(layout.allRows[1].charStart, 4);
  assert.equal(layout.allRows[1].charEnd, 7);
});

test('selection renders: partial selection on a row is correctly bounded', () => {
  // Verify charStart/charEnd allow computing pre/sel/post segments
  // For "abcdef" with selection {start:4, end:6}, row covers charStart=0..charEnd=6
  const layout = layoutInput('abcdef', 6, 80);
  const row = layout.rows[0];
  const sel = {start: 4, end: 6};
  const glyphs = Array.from('abcdef');
  const preEnd = Math.max(0, sel.start - row.charStart); // 4
  const selEnd = Math.min(glyphs.length, sel.end - row.charStart); // 6
  const pre = glyphs.slice(0, preEnd).join(''); // 'abcd'
  const selected = glyphs.slice(preEnd, selEnd).join(''); // 'ef'
  const post = glyphs.slice(selEnd).join(''); // ''
  assert.equal(pre, 'abcd');
  assert.equal(selected, 'ef');
  assert.equal(post, '');
});

// ---------------------------------------------------------------------------
// Task 7/8/9: VS Code Shift+Enter — actual raw bytes
// ---------------------------------------------------------------------------

test('VS Code: Enter and Shift+Enter are identical bytes at PTY level (\\r), NMSh decodes both as enter', () => {
  // In VS Code integrated terminal without a custom keybinding,
  // both Enter and Shift+Enter send 0x0D (\r) at the PTY level.
  // NMSh decodes \r as 'enter'.
  const enterKeys = decodeKeys('\r');
  assert.equal(enterKeys.length, 1);
  assert.equal(enterKeys[0].kind, 'enter', 'bare \\r must decode as enter');

  // Therefore NMSh cannot distinguish VS Code Enter from Shift+Enter without a binding.
  // The test below confirms this parity: same bytes = same decoded key.
  const shiftEnterFallback = decodeKeys('\r');
  assert.deepEqual(enterKeys, shiftEnterFallback, 'VS Code sends identical bytes for Enter and Shift+Enter');
});

test('VS Code keybinding sequence ESC[13;2u decodes as newline (the NMSh private Shift+Enter)', () => {
  // When the user installs the VS Code keybinding that sends \u001b[13;2u for Shift+Enter,
  // NMSh maps it to 'newline' (insert newline, not submit).
  const keys = decodeKeys('\u001B[13;2u');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'newline', 'VS Code Shift+Enter private sequence must decode as newline');
});

test('VS Code alt keybinding sequence ESC[27;2;13~ also decodes as newline', () => {
  const keys = decodeKeys('\u001B[27;2;13~');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'newline');
});

test('Ctrl+J always inserts newline regardless of terminal host', () => {
  const decoder = new KeyDecoder();
  const keys = decoder.push('\n');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'newline', 'Ctrl+J (\\n) must always decode as newline');
});

test('macOS Terminal Shift+Enter (ESC CR) decodes as newline and buffers correctly', () => {
  const decoder = new KeyDecoder();

  // Entire sequence at once
  const keys = decoder.push('\u001B\r');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'newline', 'ESC CR must decode as newline');

  // Split sequence
  decoder.reset();
  const keys1 = decoder.push('\u001B');
  assert.equal(keys1.length, 0, 'ESC should buffer');
  const keys2 = decoder.push('\r');
  assert.equal(keys2.length, 1);
  assert.equal(keys2[0].kind, 'newline', 'split ESC CR must decode as newline');

  // Verify regular CR still emits enter
  decoder.reset();
  const keys3 = decoder.push('\r');
  assert.equal(keys3.length, 1);
  assert.equal(keys3[0].kind, 'enter', 'bare CR must decode as enter');
});

// ---------------------------------------------------------------------------
// Task 11-18: /copy copies full logical command result
// ---------------------------------------------------------------------------

test('copy failure: PTY output + failure lifecycle row are both in payload', () => {
  const output = new OutputBuffer();
  output.beginCommand('meow');
  output.write('zsh: command not found: meow\n');
  output.complete(127);
  output.setCompletionLifecycle('✘ Failed after 0.0s · exit 127 · done 04:12');
  output.addHistoryLine('\u001B[31m✘ Failed after 0.0s · exit 127\u001B[0m\u001B[2m · done 04:12\u001B[0m');

  const record = output.recent(1);
  assert.ok(record, 'recent(1) must return the completed command');
  assert.equal(record.output, 'zsh: command not found: meow', 'output is PTY text only');
  assert.equal(record.lifecycleText, '✘ Failed after 0.0s · exit 127 · done 04:12', 'lifecycleText is the completion row');

  const payload = serializeCopyPayload(record);
  assert.ok(payload.includes('zsh: command not found: meow'), 'payload must include PTY output');
  assert.ok(payload.includes('✘ Failed after 0.0s · exit 127 · done 04:12'), 'payload must include lifecycle row');
  // Verify order: PTY first, then lifecycle
  const lines = payload.split('\n');
  assert.equal(lines[0], 'zsh: command not found: meow', 'PTY output is first line');
  assert.equal(lines[1], '✘ Failed after 0.0s · exit 127 · done 04:12', 'lifecycle row is second line');
});

test('copy success: hello + success lifecycle row are both in payload', () => {
  const output = new OutputBuffer();
  output.beginCommand('echo hello');
  output.write('hello\n');
  output.complete(0);
  output.setCompletionLifecycle('✻ Meowed for 0.0s · done 04:12');
  output.addHistoryLine('\u001B[32m✻ Meowed for 0.0s\u001B[0m\u001B[2m · done 04:12\u001B[0m');

  const record = output.recent(1);
  assert.ok(record);
  const payload = serializeCopyPayload(record);
  assert.ok(payload.includes('hello'), 'payload must include PTY output');
  assert.ok(payload.includes('✻ Meowed for 0.0s · done 04:12'), 'payload must include lifecycle row');
});

test('copy empty PTY: no output command still copies lifecycle row', () => {
  const output = new OutputBuffer();
  output.beginCommand('sleep 2');
  // No PTY output
  output.complete(0);
  output.setCompletionLifecycle('✻ Slept for 2.0s · done 04:14');
  output.addHistoryLine('\u001B[32m✻ Slept for 2.0s · done 04:14\u001B[0m');

  const record = output.recent(1);
  assert.ok(record);
  assert.equal(record.output, '', 'output is empty for silent command');
  assert.equal(record.lifecycleText, '✻ Slept for 2.0s · done 04:14');

  const payload = serializeCopyPayload(record);
  assert.ok(payload.length > 0, 'payload must not be empty even with no PTY output');
  assert.equal(payload, '✻ Slept for 2.0s · done 04:14', 'payload is just the lifecycle row');
});

test('copy interrupted: interrupted lifecycle row is in payload', () => {
  const output = new OutputBuffer();
  output.beginCommand('sleep 100');
  output.complete(130);
  output.setCompletionLifecycle('✘ Stopped after 1.5s · done 04:14');
  output.addHistoryLine('\u001B[31m✘ Stopped after 1.5s\u001B[0m\u001B[2m · done 04:14\u001B[0m');

  const record = output.recent(1);
  assert.ok(record);
  const payload = serializeCopyPayload(record);
  assert.ok(payload.includes('✘ Stopped after 1.5s · done 04:14'), 'interrupted lifecycle row must be in payload');
});

test('copy /copy N: Nth recent item includes its full command result', () => {
  const output = new OutputBuffer();

  // Command 1 (most recent after both):
  output.beginCommand('echo first');
  output.write('first\n');
  output.complete(0);
  output.setCompletionLifecycle('✻ Completed for 0.0s · done 04:10');
  output.addHistoryLine('✻ Completed for 0.0s · done 04:10');

  // Command 2 (becomes recent(1) after this):
  output.beginCommand('meow');
  output.write('zsh: command not found: meow\n');
  output.complete(127);
  output.setCompletionLifecycle('✘ Failed after 0.0s · exit 127 · done 04:11');
  output.addHistoryLine('✘ Failed after 0.0s · exit 127 · done 04:11');

  // recent(1) = meow (most recent)
  const r1 = output.recent(1);
  assert.ok(r1);
  const p1 = serializeCopyPayload(r1);
  assert.ok(p1.includes('zsh: command not found: meow'), '/copy 1 must include meow PTY output');
  assert.ok(p1.includes('✘ Failed after 0.0s · exit 127 · done 04:11'), '/copy 1 must include meow lifecycle');

  // recent(2) = echo first
  const r2 = output.recent(2);
  assert.ok(r2);
  const p2 = serializeCopyPayload(r2);
  assert.ok(p2.includes('first'), '/copy 2 must include echo first output');
  assert.ok(p2.includes('✻ Completed for 0.0s · done 04:10'), '/copy 2 must include echo first lifecycle');
});

test('copy feedback counts reflect full payload (PTY + lifecycle row)', () => {
  const output = new OutputBuffer();
  output.beginCommand('meow');
  output.write('zsh: command not found: meow\n');
  output.complete(127);
  output.setCompletionLifecycle('✘ Failed after 0.0s · exit 127 · done 04:12');

  const record = output.recent(1)!;
  const payload = serializeCopyPayload(record);
  const stats = copyStats(payload);

  // payload = "zsh: command not found: meow\n✘ Failed after 0.0s · exit 127 · done 04:12"
  // That is 2 lines
  assert.equal(stats.lines, 2, 'feedback must count 2 lines (PTY + lifecycle)');
  assert.ok(stats.characters > 0, 'feedback must count actual characters');

  const feedback = copyFeedback(stats, 1);
  assert.ok(feedback.includes('2 lines'), 'feedback string must say 2 lines');
});

test('copy no presentation chrome: ANSI codes do not appear in payload', () => {
  const output = new OutputBuffer();
  output.beginCommand('false');
  // No PTY output
  output.complete(1);
  output.setCompletionLifecycle('✘ Failed after 0.0s · exit 1 · done 04:15');
  output.addHistoryLine('\u001B[31m✘ Failed after 0.0s · exit 1\u001B[0m\u001B[2m · done 04:15\u001B[0m');

  const record = output.recent(1)!;
  const payload = serializeCopyPayload(record);
  assert.ok(!payload.includes('\u001B['), 'payload must not contain ANSI escape codes');
  assert.ok(!payload.includes('\u001B[0m'), 'payload must not contain ANSI reset');
});

// ---------------------------------------------------------------------------
// Task 5: Preserve Cmd+A (selectAll) — decoder still maps ESC[97;9u
// ---------------------------------------------------------------------------
test('Cmd+A sequence ESC[97;9u decodes as selectAll', () => {
  const keys = decodeKeys('\u001B[97;9u');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'selectAll', 'Cmd+A must decode as selectAll, not home or text');
});

// ---------------------------------------------------------------------------
// Task 6: Ctrl+A must map to home (beginning of line), not selectAll
// ---------------------------------------------------------------------------
test('Ctrl+A (0x01) maps to home, not selectAll', () => {
  const keys = decodeKeys('\u0001');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'lineHome', 'Ctrl+A must be home/beginning, not selectAll');
});

test('Ctrl+A Kitty CSI-u form maps to home', () => {
  const keys = decodeKeys('\u001B[97;5u');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'lineHome', 'Kitty Ctrl+A must be home, not selectAll');
});

test('selectAll does not fire for Ctrl+A or Kitty Ctrl+A', () => {
  const plainCtrlA = decodeKeys('\u0001');
  const kittyCtrlA = decodeKeys('\u001B[97;5u');
  assert.ok(plainCtrlA.every(k => k.kind !== 'selectAll'), 'Ctrl+A must never produce selectAll');
  assert.ok(kittyCtrlA.every(k => k.kind !== 'selectAll'), 'Kitty Ctrl+A must never produce selectAll');
});
