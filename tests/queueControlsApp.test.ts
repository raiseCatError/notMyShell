import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueDispatcher} from '../src/session/QueueDispatcher.js';
import {stripAnsi} from '../src/util/text.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

function fixture() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 30})});
  app['startupPending'] = false;
  app['session'].queue({op: 'pause'});
  app['session'].queue({op: 'add', text: 'echo REVIEWED'});
  return app;
}
const dispose = (app: TerminalApp) => { app['stop'](0); app['session'].kill(); };

test('clear command and idle Esc only open review; Esc cancels and explicit Enter clears', async () => {
  const app = fixture();
  try {
    app['handleQueueCommand']('/qc', 'clear');
    assert.equal(app['queueState'].entries.length, 1, 'slash command alone never discards work');
    assert.equal(app['queueReview']?.kind, 'clear');
    app['queueReviewKey']({kind: 'escape'});
    assert.equal(app['queueState'].entries.length, 1);
    await app['handleKey']({kind: 'escape'});
    assert.equal(app['queueReview']?.kind, 'clear', 'empty idle Esc opens the same confirmation');
    app['queueReviewKey']({kind: 'enter'});
    assert.equal(app['queueState'].entries.length, 0);
  } finally { dispose(app); }
});

test('resume command reviews the exact current queue and changed state invalidates confirmation', () => {
  const app = fixture();
  try {
    app['handleQueueCommand']('/qr', 'resume');
    assert.equal(app['queueState'].paused?.reason, 'user');
    assert.equal(app['queueReview']?.kind, 'resume');
    app['session'].queue({op: 'add', text: 'echo ADDED_AFTER_REVIEW'});
    assert.equal(app['queueReview'], undefined);
    assert.equal(app['queueState'].paused?.reason, 'user');
  } finally { dispose(app); }
});

test('foreground program cannot be captured by a resume or clear review', () => {
  const app = fixture();
  try {
    app['running'] = {command: 'read -s', startedAt: Date.now(), startId: 1, cwd: '/tmp'};
    for (const op of ['resume','clear'] as const) {
      app['handleQueueCommand']('/queue ' + op, op);
      assert.equal(app['queueReview'], undefined);
      assert.equal(app['queueState'].entries.length, 1);
      assert.equal(app['queueState'].paused?.reason, 'user');
    }
  } finally { dispose(app); }
});


test('completed timeline dismissal never changes the shell PTY size in full composer planning', () => {
  const app = fixture();
  try {
    app['session'].queue({op: 'clear'});
    for (const position of ['bottom', 'top', 'flow'] as const) {
      app['promptConfiguration'].composerPosition = position;
      const input = app['layoutEditorInput'](80);
      Object.defineProperty(app, 'timelineVisible', {value: () => true, configurable: true});
      const shown = app['planComposer'](80, 30, input, 0, undefined);
      Object.defineProperty(app, 'timelineVisible', {value: () => false, configurable: true});
      const hidden = app['planComposer'](80, 30, input, 0, undefined);
      assert.equal(shown.ptyRows, hidden.ptyRows, position);
    }
  } finally { dispose(app); }
});


test('live queue individual timing cannot jump with the presentation epoch clock', () => {
  const app = fixture();
  try {
    let epoch = 1000, mono = 100;
    const owner = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit() {}}, undefined, {now: () => epoch, monotonic: () => mono});
    owner.onExec('build'); owner.request({op: 'add', text: 'test'});
    mono += 250; epoch += 3600000;
    app['running'] = {command: 'build', startedAt: 1000, startId: 1, cwd: '/tmp'};
    app['activityAnimationNow'] = epoch;
    app['onQueueState'](owner.state, {});
    const plan = app['planComposer'](80, 30, app['layoutEditorInput'](80), 0, undefined);
    const text = app['activityRows'](plan, 80).map(stripAnsi).join('\n');
    const duration = Number(/(\d+) ms current command/u.exec(text)?.[1]);
    assert.ok(duration >= 250 && duration < 1000, `monotonic individual duration: ${text}`);
    assert.doesNotMatch(text, /1h|60m/u);
  } finally { dispose(app); }
});
