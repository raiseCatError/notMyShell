import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundActivity, COALESCE_MS, HISTORY_LIMIT, TOAST_IN_MS, safeCommandLabel, type ActivityEvent} from '../src/notifications/backgroundActivity.js';

const command = (key: string, text: string, exitCode = 0, elapsedMs = 42_000, interrupted = false): ActivityEvent =>
  ({kind: 'command', key, command: text, elapsedMs, exitCode, interrupted});

function clock() {
  let now = 1_000_000;
  return {now: () => now, advance: (ms: number) => { now += ms; }};
}

test('labels: the program word, plus a package script or verb; never other arguments', () => {
  assert.equal(safeCommandLabel('npm run build'), 'npm run build');
  assert.equal(safeCommandLabel('npm test -- --token=abc123'), 'npm test');
  assert.equal(safeCommandLabel('CI=1 pnpm run lint:fix --silent'), 'pnpm run lint:fix');
  assert.equal(safeCommandLabel('curl -H "Authorization: Bearer sk-secret" https://example.test'), 'curl');
  assert.equal(safeCommandLabel('/usr/local/bin/make all'), 'make');
  assert.equal(safeCommandLabel('npm run $(cat ~/.secret)'), 'npm');
  assert.equal(safeCommandLabel('   '), 'Command');
  assert.equal(safeCommandLabel('a'.repeat(80)), 'Command');
});

test('a completion becomes one toast with a status and a duration, and only that', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  assert.equal(activity.push(command('1', 'npm run build')), true);
  const view = activity.view();
  assert.deepEqual([view.toast?.tone, view.toast?.text], ['ok', 'npm run build finished · 42.0s']);
  assert.equal(view.unread, 1);
  activity.push(command('2', 'npm test', 1, 3_000));
  assert.match(activity.view().toast!.text, /commands finished · 1 failed|npm test failed · exit 1/u);
});

test('failure, interruption and success are distinct in tone and wording', () => {
  const t = clock();
  const cases: Array<[ActivityEvent, string, RegExp]> = [
    [command('a', 'make', 2, 5_000), 'fail', /^make failed · exit 2 · 5.0s$/u],
    [command('b', 'sleep 9', 130, 2_000, true), 'info', /^sleep interrupted · 2.0s$/u],
    [command('c', 'true', 0, 400), 'ok', /^true finished/u],
  ];
  for (const [event, tone, text] of cases) {
    const activity = new BackgroundActivity(t.now);
    activity.push(event);
    assert.equal(activity.view().toast?.tone, tone);
    assert.match(activity.view().toast!.text, text);
  }
});

test('the same completion is shown once, however many times it is reported', () => {
  const activity = new BackgroundActivity(clock().now);
  assert.equal(activity.push(command('same', 'ls')), true);
  assert.equal(activity.push(command('same', 'ls')), false);
  assert.equal(activity.history().length, 1);
  assert.equal(activity.unread, 1);
});

test('a burst coalesces into one toast with counts; a failure is never lost, and the rows stay in the history', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  for (let index = 0; index < 10; index += 1) { activity.push(command(`k${index}`, `job${index}`, index === 4 ? 1 : 0, 100)); t.advance(50); }
  const toast = activity.view(t.now()).toast!;
  assert.equal(toast.text, '10 commands finished · 1 failed');
  assert.equal(toast.tone, 'fail');
  assert.equal(activity.history().length, 10);
  assert.ok(activity.history().some(entry => entry.tone === 'fail' && /job4 failed · exit 1/u.test(entry.text)));
});

test('the banner has no expiry: it stays until something newer replaces it, and the history stays bounded', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  for (let index = 0; index < 400; index += 1) { activity.push(command(`k${index}`, 'job')); t.advance(100); }
  assert.ok(activity.history().length <= HISTORY_LIMIT, 'history is bounded');
  t.advance(60 * 60_000);
  assert.ok(activity.view(t.now()).toast, 'an hour later it is still there');
  activity.push(command('new', 'make'));
  assert.match(activity.view(t.now()).toast!.detail, /^make · /u, 'a later one replaces it, as news and not as a burst');
});

test('the slide-in lasts 180 ms and then the banner is steady; reduced motion is always steady', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  activity.push(command('1', 'make'));
  assert.equal(activity.view(t.now()).toast?.phase, 'in');
  t.advance(TOAST_IN_MS + 1);
  assert.equal(activity.view(t.now()).toast?.phase, 'steady');
  const still = new BackgroundActivity(t.now);
  still.push(command('2', 'make'));
  assert.equal(still.view(t.now(), false).toast?.phase, 'steady');
});

test('nextChange is only the end of the slide-in: a steady banner needs no timer at all', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  assert.equal(activity.nextChange(t.now()), undefined);
  activity.push(command('1', 'make'));
  assert.equal(activity.nextChange(t.now()), t.now() + TOAST_IN_MS);
  assert.equal(activity.nextChange(t.now() + TOAST_IN_MS), undefined);
  assert.equal(activity.nextChange(t.now(), false), undefined, 'none under reduced motion');
});

test('a failure stays over later successes until the log is looked at; a newer failure or acknowledgement releases it', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  activity.push(command('bad', 'npm test', 1, 83_000));
  assert.deepEqual([activity.view().toast?.title, activity.view().toast?.detail], ['Command failed', 'npm test · 1m 23s · exit 1']);
  t.advance(COALESCE_MS + 1000);
  activity.push(command('ok', 'ls'));
  assert.equal(activity.view(t.now()).toast?.title, 'Command failed', 'a plain success does not hide it');
  activity.markRead();
  t.advance(COALESCE_MS + 1000);
  activity.push(command('ok2', 'ls'));
  assert.equal(activity.view(t.now()).toast?.title, 'Command completed');
});

test('the banner carries a title and a detail line; settled commands feed the activity list for a minute', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  activity.push(command('1', 'npm run build', 0, 42_000));
  assert.deepEqual([activity.view().toast?.title, activity.view().toast?.detail], ['Command completed', 'npm run build · 42.0s · exit 0']);
  assert.deepEqual(activity.settled(t.now()).map(entry => entry.command?.label), ['npm run build']);
  t.advance(61_000);
  assert.deepEqual(activity.settled(t.now()), []);
});

test('queue finish reads as a count; attention states persist until cleared and never expire by themselves', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  activity.push({kind: 'queue-finished', key: 'q1', count: 4, failed: 0});
  assert.equal(activity.view().toast?.text, 'Queue finished · 4 commands');
  activity.push({kind: 'attention', key: 'a1', state: 'approval'});
  t.advance(60_000);
  const view = activity.view(t.now());
  assert.equal(view.toast?.title, 'Queue waiting');
  assert.deepEqual([view.attention?.state, view.attention?.text], ['approval', 'Queue waiting for approval']);
  activity.push({kind: 'cleared', state: 'approval'});
  assert.equal(activity.view(t.now()).attention, undefined);
});

test('an input request outranks a paused queue, and a quiet success never hides an attention toast', () => {
  const t = clock();
  const activity = new BackgroundActivity(t.now);
  activity.push({kind: 'attention', key: 'p', state: 'paused'});
  activity.push({kind: 'attention', key: 'i', state: 'input', program: 'sudo', confirmed: true});
  assert.equal(activity.view().attention?.state, 'input');
  assert.equal(activity.view().attention?.text, 'sudo is waiting for input');
  activity.push(command('ok', 'ls'));
  assert.equal(activity.view().toast?.text, 'sudo is waiting for input', 'a success waits in the log');
  activity.push(command('bad', 'make', 2, 1_000));
  assert.match(activity.view().toast!.text, /make failed/u, 'a failure replaces it');
  assert.equal(activity.view().attention?.state, 'input', 'the attention state stays in the strip');
  const likely = new BackgroundActivity(t.now);
  likely.push({kind: 'attention', key: 'l', state: 'input', confirmed: false});
  assert.equal(likely.view().attention?.text, 'A command may be waiting for input');
});

test('markRead clears the unread count but keeps the history', () => {
  const activity = new BackgroundActivity(clock().now);
  activity.push(command('1', 'a'));
  activity.push(command('2', 'b'));
  assert.equal(activity.unread, 2);
  activity.markRead();
  assert.equal(activity.unread, 0);
  assert.equal(activity.history().length, 2);
});

test('nothing derived from output can appear: text is built only from a label, a status and a duration', () => {
  const activity = new BackgroundActivity(clock().now);
  activity.push(command('1', 'deploy --password hunter2 --token ghp_abc', 1, 1_000));
  for (const entry of activity.history()) assert.doesNotMatch(entry.text, /hunter2|ghp_|password|token/u);
});

test('an attention state can return after it clears, even with the same key', () => {
  const activity = new BackgroundActivity(clock().now);
  activity.push({kind: 'attention', key: 'approval:1:5', state: 'approval'});
  activity.push({kind: 'cleared', state: 'approval'});
  assert.equal(activity.view().attention, undefined);
  activity.push({kind: 'attention', key: 'approval:1:5', state: 'approval'});
  assert.equal(activity.view().attention?.state, 'approval');
});
