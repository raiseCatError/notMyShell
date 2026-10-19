import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #443: every resize of the shell's terminal signals its foreground job (SIGWINCH). Fish 3 does not retry a terminal
 * write that signal interrupts: the output, or one of NMSh's markers, is lost. The shell's terminal used to follow NMSh's
 * own layout, so a command's start (the activity row), a growing composer, a completion menu, notices, the queue list or
 * Settings each resized it. Its size now comes from the window and the configured layout only: UI chrome never resizes
 * it, and while a command runs only a real change of the window does.
 */

function fixture(columns = 100, rows = 32) {
  const frame = executionFrameFixture(columns, rows);
  let size = {columns, rows};
  Object.defineProperty(frame.app, 'dimensions', {value: () => size, configurable: true});
  Object.defineProperty(frame.app, 'terminalDimensions', {value: () => size, configurable: true});
  Object.defineProperty(frame.session, 'write', {value: () => {}, configurable: true});
  Object.defineProperty(frame.session, 'queue', {value: (op: Parameters<typeof frame.owner.request>[0]) => frame.owner.request(op), configurable: true});
  const resizes = () => frame.session.sizes.length;
  return {...frame, resizes, resizeWindow: (next: {columns: number; rows: number}) => { size = next; },
    type: (text: string) => { for (const char of text) frame.app['onInput'](char); }};
}

test('UI-only layout changes never resize the shell\'s terminal: command start and end, composer growth, completion, notices', () => {
  const f = fixture();
  try {
    f.capture();
    const settledRows = f.session.sizes.at(-1);
    const before = f.resizes();
    f.begin('sleep 5');
    f.capture();
    // A growing multi-line draft while the command runs.
    f.app['editor'].replaceText('one\ntwo\nthree\nfour');
    f.capture();
    f.app['output'].addFrontendInteraction('note', 'a notice row', '');
    f.capture();
    f.complete(0);
    f.capture();
    f.app['editor'].replaceText('');
    f.capture();
    f.begin('make');
    f.capture();
    f.complete(1);
    f.capture();
    assert.equal(f.resizes(), before, `no SIGWINCH from NMSh's own layout (sizes: ${JSON.stringify(f.session.sizes.slice(before))})`);
    assert.deepEqual(f.session.sizes.at(-1), settledRows);
  } finally { f.dispose(); }
});

test('a real window resize still reaches the program at once, while it runs, exactly once', () => {
  const f = fixture();
  try {
    f.capture();
    f.begin('vim-like');
    f.capture();
    const before = f.resizes();
    f.resizeWindow({columns: 90, rows: 40});
    f.capture();
    f.capture();
    assert.equal(f.resizes(), before + 1);
    const applied = f.session.sizes.at(-1)!;
    assert.equal(applied.columns, 90);
    assert.ok(applied.rows > 30, `the taller window gives the program more rows (${applied.rows})`);
    // Chrome changing after that, while it still runs, sends nothing more.
    f.app['editor'].replaceText('a\nb\nc');
    f.capture();
    f.complete(0);
    f.capture();
    assert.equal(f.resizes(), before + 1);
  } finally { f.dispose(); }
});

test('the shell\'s rows follow the window and the configured layout: a smaller window gives fewer rows, never more than fit', () => {
  const f = fixture(80, 24);
  try {
    f.capture();
    const small = f.session.sizes.at(-1)!;
    assert.ok(small.rows >= 1 && small.rows < 24);
    f.resizeWindow({columns: 80, rows: 12});
    f.capture();
    const tiny = f.session.sizes.at(-1)!;
    assert.ok(tiny.rows >= 1 && tiny.rows < 12);
  } finally { f.dispose(); }
});
