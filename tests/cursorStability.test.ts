import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {resolveHostCapabilities} from '../src/host/capabilities.js';

const HIDE = '\u001b[?25l', SHOW = '\u001b[?25h';
const tmux = resolveHostCapabilities({TMUX: '/tmp/tmux-501/default,1,0', TERM: 'tmux-256color', TERM_PROGRAM: 'tmux'});

function renderer() {
  const writes: string[] = [];
  const instance = new TerminalRenderer(data => { writes.push(data); }, tmux);
  instance.enter();
  writes.length = 0;
  return {instance, writes, last: () => writes.join('')};
}
const frame = (rows: string[], cursorRow = 3, cursorColumn = 5, cursorVisible = true) => ({rows, cursorRow, cursorColumn, cursorVisible, columns: 40});

test('a repaint under a cursor that stays visible in place toggles no cursor visibility (animated dividers, clock ticks)', () => {
  const {instance, writes, last} = renderer();
  instance.render(frame(['── a', 'prompt', '❯ ls']));
  writes.length = 0;
  for (const divider of ['── b', '── c', '── d']) instance.render(frame([divider, 'prompt', '❯ ls']));
  assert.ok(writes.length === 3, 'each changed frame is still written');
  assert.ok(!last().includes(HIDE) && !last().includes(SHOW), 'no hide/show around the repaint');
  assert.match(last(), /\u001b\[1;1H\u001b\[2K── d/u, 'the changed row is repainted');
  assert.ok(last().endsWith('\u001b[3;5H'), 'the cursor is put back where it was');
  writes.length = 0;
  instance.render(frame(['── d', 'prompt', '❯ ls']));
  assert.equal(writes.length, 0, 'an unchanged frame writes nothing at all');
});

test('a cursor that moves, hides or reappears still gets exactly the visibility it needs', () => {
  const {instance, writes, last} = renderer();
  instance.render(frame(['❯ l'], 1, 4));
  assert.ok(last().startsWith(HIDE) && last().endsWith(`\u001b[1;4H${SHOW}`), 'the first frame hides while painting and shows at the caret');
  writes.length = 0;
  instance.render(frame(['❯ ls'], 1, 5));
  assert.ok(last().startsWith(HIDE) && last().endsWith(`\u001b[1;5H${SHOW}`), 'typing moves the caret: hidden while it travels');
  writes.length = 0;
  instance.render(frame(['❯ ls'], 1, 5, false));
  assert.ok(last().includes(HIDE) && !last().includes(SHOW), 'a hidden caret stays hidden');
  writes.length = 0;
  instance.render(frame(['❯ ls!'], 1, 5, false));
  assert.ok(!last().includes(SHOW), 'repaints while hidden never show it');
  writes.length = 0;
  instance.render(frame(['❯ ls!'], 1, 6, true));
  assert.ok(last().endsWith(`\u001b[1;6H${SHOW}`), 'showing it again is explicit');
});

test('resize, passthrough and return keep cursor ownership correct', () => {
  const {instance, writes, last} = renderer();
  instance.render(frame(['❯ vim'], 1, 6));
  writes.length = 0;
  instance.suspendForPassthrough();
  assert.ok(last().includes(SHOW), 'a fullscreen program gets a visible host cursor');
  writes.length = 0;
  instance.render(frame(['❯ vim'], 1, 6));
  assert.equal(writes.length, 0, 'NMSh writes nothing while the program owns the screen');
  instance.resumeAfterPassthrough();
  assert.ok(last().includes(HIDE), 'returning clears and hides before the first frame');
  writes.length = 0;
  instance.render(frame(['❯'], 1, 3));
  assert.ok(last().endsWith(`\u001b[1;3H${SHOW}`), 'the first frame after the program shows the caret again');
  writes.length = 0;
  instance.invalidate();
  instance.render(frame(['❯'], 1, 3));
  assert.ok(last().startsWith(HIDE) && last().endsWith(SHOW), 'after a resize (invalidate) the full repaint hides and shows once');
});

test('inside tmux NMSh never wraps frames in DEC 2026 itself, even when tmux answers the probe; other hosts still do', async () => {
  const {resolveProbeReplies} = await import('../src/host/probe.js');
  const reply = '\u001b[?2026;2$y';
  // Measured with tmux 3.7 and Ghostty's terminfo: an application's own 2026 block made tmux leave the visible outer
  // cursor at intermediate frame positions in 24 of 25 idle frames, which Ghostty's cursor shader animated as a trail.
  assert.equal(resolveProbeReplies(reply, tmux).capabilities.synchronizedOutput, false, 'tmux already synchronizes its own output');
  assert.equal(resolveProbeReplies(reply, resolveHostCapabilities({TERM_PROGRAM: 'ghostty'})).capabilities.synchronizedOutput, true, 'Ghostty directly: unchanged');
  const writes: string[] = [];
  const instance = new TerminalRenderer(data => { writes.push(data); }, resolveProbeReplies(reply, tmux).capabilities);
  instance.enter();
  instance.render(frame(['── a', '❯']));
  instance.render(frame(['── b', '❯']));
  assert.ok(!writes.join('').includes('\u001b[?2026h'), 'no application sync block inside tmux');
});
