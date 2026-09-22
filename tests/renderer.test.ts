import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';

test('renderer hides during paint, positions the hardware cursor, then shows it', () => {
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => writes.push(data));
  renderer.enter();
  renderer.render({rows: ['output', '❯ hello', 'status'], cursorRow: 2, cursorColumn: 8});
  const paint = writes.at(-1) ?? '';
  assert.ok(paint.startsWith('\u001B[?25l'));
  assert.ok(paint.endsWith('\u001B[2;8H\u001B[?25h'));
});

test('cursor-only updates still explicitly reposition and live-activity changes redraw only that row', () => {
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => writes.push(data));
  renderer.enter();
  renderer.render({rows: ['output', '❯ hello', 'activity-a'], cursorRow: 2, cursorColumn: 8});
  renderer.render({rows: ['output', '❯ hello', 'activity-a'], cursorRow: 2, cursorColumn: 5});
  assert.equal(writes.at(-1), '\u001B[?25l\u001B[2;5H\u001B[?25h');
  renderer.render({rows: ['output', '❯ hello', 'activity-b'], cursorRow: 2, cursorColumn: 5});
  const activityPaint = writes.at(-1) ?? '';
  assert.match(activityPaint, /\u001B\[3;1H/u);
  assert.ok(!activityPaint.includes('\u001B[1;1H'));
  assert.ok(!activityPaint.includes('\u001B[2;1H'));
});

test('passthrough restores cursor and bracketed-paste modes in both directions', () => {
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => writes.push(data));
  renderer.enter();
  renderer.suspendForPassthrough();
  assert.match(writes.at(-1) ?? '', /\?2004l.*\?25h/u);
  renderer.resumeAfterPassthrough();
  assert.match(writes.at(-1) ?? '', /\?2004h.*\?25l/u);
  renderer.leave();
  assert.match(writes.at(-1) ?? '', /\?2004l.*\?25h.*\?1049l/u);
});
