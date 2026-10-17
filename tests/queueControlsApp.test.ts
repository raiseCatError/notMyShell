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


test('declining approval waits for the owner pause acknowledgement before routing a draft directly', () => {
  const app = fixture();
  try {
    const ownerQueue = app['session'].queue.bind(app['session']);
    ownerQueue({op: 'condition', id: 1, condition: 'approve'});
    ownerQueue({op: 'resume'});
    app['openQueueReview']('approve');
    const requests: Parameters<typeof ownerQueue>[0][] = [];
    app['session'].queue = change => { requests.push(change); };
    const submissions: string[] = [];
    app['submit'] = async () => { submissions.push(app['editor'].text); app['editor'].clear(); };
    app['queueReviewKey']({kind: 'text', value: 'n'});
    assert.equal(app['queueState'].paused, undefined, 'frontend never invents a pause');
    assert.doesNotMatch(app['output'].transcript().lines.map(row => row.map(cell => cell.text).join('')).join('\n'), /Not approved; the queue is paused/u);
    app['editor'].replaceText('echo DIRECT');
    app['routeComposer']('enter');
    assert.equal(app['editor'].text, 'echo DIRECT', 'draft survives an Enter before the acknowledgement');
    assert.equal(requests.length, 1, 'the draft is not enqueued behind the declined entry');
    assert.deepEqual(submissions, []);
    assert.equal(requests[0]?.expectedRevision, app['queueState'].revision, 'pause is bound to the reviewed revision');
    ownerQueue(requests[0]!);
    assert.equal(app['queueState'].paused?.reason, 'user');
    assert.match(app['output'].transcript().lines.map(row => row.map(cell => cell.text).join('')).join('\n'), /Not approved; the queue is paused/u);
    assert.deepEqual(submissions, [], 'acknowledgement never submits the draft');
    app['routeComposer']('enter');
    assert.deepEqual(submissions, ['echo DIRECT']);
    assert.deepEqual(app['queueState'].entries.map(entry => entry.text), ['echo REVIEWED']);
  } finally { dispose(app); }
});

test('a changed owner revision refuses a declined approval pause without submitting or losing the draft', () => {
  const app = fixture();
  try {
    const ownerQueue = app['session'].queue.bind(app['session']);
    ownerQueue({op: 'condition', id: 1, condition: 'approve'});
    ownerQueue({op: 'resume'});
    app['openQueueReview']('approve');
    let pending: Parameters<typeof ownerQueue>[0] | undefined;
    app['session'].queue = change => { pending = change; };
    app['queueReviewKey']({kind: 'text', value: 'n'});
    app['editor'].replaceText('echo KEEP');
    ownerQueue({op: 'add', text: 'echo LATER'});
    ownerQueue(pending!);
    assert.equal(app['queueState'].paused, undefined, 'stale reviewed pause is refused by the owner');
    assert.equal(app['editor'].text, 'echo KEEP');
    assert.doesNotMatch(app['output'].transcript().lines.map(row => row.map(cell => cell.text).join('')).join('\n'), /Not approved; the queue is paused/u);
  } finally { dispose(app); }
});


test('late queue snapshots cannot restart presentation expiry after the frontend stops', () => {
  const app = fixture();
  try {
    app['stop'](0);
    const owner = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit() {}});
    owner.onPrompt(0); owner.request({op: 'add', text: 'echo FINISHED'}); owner.onExec('echo FINISHED'); owner.onPrompt(0);
    app['onQueueState'](owner.state, {});
    assert.equal(app['queueExpiry'], undefined, 'no new presentation clock subscription after teardown');
  } finally { dispose(app); }
});
