import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveHostCapabilities} from '../src/host/capabilities.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {historyId, type HistoryEntry} from '../src/shell/HistoryIndex.js';

// What tmux actually forwards to a pane that enabled 1000/1002/1006 (verified against tmux 3.x with
// `mouse` both on and off): plain SGR wheel reports, column/row relative to the pane.
const TMUX_WHEEL_UP = '\u001b[<64;10;5M';
const TMUX_WHEEL_DOWN = '\u001b[<65;10;5M';
const UP = '\u001b[A';
const tmuxEnv = {TMUX: '/tmp/tmux-501/default,123,0', TERM: 'tmux-256color', TERM_PROGRAM: 'tmux'};

test('inside tmux NMSh asks for button and SGR mouse so the wheel arrives as wheel, not as alternate-scroll arrows', () => {
  const capabilities = resolveHostCapabilities(tmuxEnv);
  assert.equal(capabilities.mouseReporting, true);
  assert.equal(capabilities.mouseMovement, false, 'no motion tracking through tmux');
  assert.equal(capabilities.textSelectionInteraction, 'shift', 'Shift keeps the terminal\'s own selection');
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => { writes.push(data); }, capabilities);
  renderer.enter();
  assert.match(writes.join(''), /\?1000h/u);
  assert.match(writes.join(''), /\?1006h/u);
  assert.doesNotMatch(writes.join(''), /\?1003h/u);
  renderer.suspendForPassthrough();
  assert.match(writes.at(-1)!, /\?1000l/u, 'a fullscreen program gets the terminal\'s input back');
  renderer.leave();
  assert.equal(resolveHostCapabilities({...tmuxEnv, TERM: 'dumb'}).mouseReporting, false);
  assert.equal(resolveHostCapabilities({STY: '1.pts', TERM: 'screen'}).mouseReporting, false, 'screen stays baseline');
  assert.deepEqual(decodeKeys(TMUX_WHEEL_UP), [{kind: 'wheelUp'}]);
  assert.deepEqual(decodeKeys(TMUX_WHEEL_DOWN), [{kind: 'wheelDown'}]);
});

function app(history: string[]) {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 80, rows: 24})});
  instance['renderer'].render = (() => {}) as never;
  instance['session'].resize = (() => {}) as never;
  instance['session'].write = (() => {}) as never;
  history.forEach((command, index) => instance['historyService'].index.add(
    {id: historyId('nmsh', `t:${index}`), source: 'nmsh', command, at: 1000 + index} satisfies HistoryEntry));
  for (let index = 0; index < 60; index++) instance['output'].addFrontendInteraction(`echo ${index}`, `line ${index}`);
  return instance;
}

test('the tmux wheel scrolls the transcript and never walks composer history; keyboard Up still does', () => {
  const instance = app(['rm -rf build', 'git status']);
  try {
    instance['editor'].insert('make deploy');
    instance['onInput'](TMUX_WHEEL_UP);
    instance['onInput'](TMUX_WHEEL_UP);
    assert.equal(instance['editor'].text, 'make deploy', 'the command being composed is untouched');
    assert.equal(instance['historyViewport'].detached, true, 'the transcript scrolled back');
    instance['onInput'](TMUX_WHEEL_DOWN);
    instance['onInput'](TMUX_WHEEL_DOWN);
    instance['onInput'](TMUX_WHEEL_DOWN);
    assert.equal(instance['editor'].text, 'make deploy');
    instance['editor'].clear();
    instance['onInput'](UP);
    assert.equal(instance['editor'].text, 'git status', 'keyboard Up is still history');
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('while a fullscreen program owns the pane, wheel reports are its input, not NMSh scrolling', () => {
  const instance = app([]);
  try {
    const forwarded: string[] = [];
    instance['session'].write = ((data: string) => { forwarded.push(data); }) as never;
    instance['startupPending'] = false;
    instance['passthrough'] = true;
    instance['onInput'](TMUX_WHEEL_UP);
    assert.equal(instance['historyViewport'].detached, false, 'NMSh did not scroll');
    assert.equal(forwarded.join(''), TMUX_WHEEL_UP, 'the program received the report unchanged');
  } finally { instance['passthrough'] = false; instance['stop'](0); instance['session'].kill(); }
});
