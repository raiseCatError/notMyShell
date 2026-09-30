import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationAnimationElapsed, presentationCompletionTime, presentationNow} from '../src/presentation/environment.js';
import {completedActivity, liveActivityParts} from '../src/status/activity.js';

const deterministicValue = process.env.NMSH_DETERMINISTIC;

function withDeterministicPresentation<T>(enabled: boolean, run: () => T): T {
  if (enabled) process.env.NMSH_DETERMINISTIC = '1';
  else delete process.env.NMSH_DETERMINISTIC;
  try {
    return run();
  } finally {
    if (deterministicValue === undefined) delete process.env.NMSH_DETERMINISTIC;
    else process.env.NMSH_DETERMINISTIC = deterministicValue;
  }
}

test('presentation clock and animation preserve ordinary runtime values by default', () => {
  withDeterministicPresentation(false, () => {
    const before = Date.now();
    const now = presentationNow().getTime();
    const after = Date.now();
    assert.ok(now >= before && now <= after);
    assert.equal(presentationAnimationElapsed(731), 731);

    const shellCompletion = new Date(1_800_000_000_000);
    assert.equal(presentationCompletionTime(shellCompletion), shellCompletion);
  });
});

test('deterministic presentation repeats timestamps and shimmer phase across renders', () => {
  withDeterministicPresentation(true, () => {
    const eventTimeA = new Date(1_800_000_000_000);
    const eventTimeB = new Date(1_900_000_000_000);
    const first = completedActivity('echo stable', 42, presentationCompletionTime(eventTimeA), 0, false);
    const second = completedActivity('echo stable', 42, presentationCompletionTime(eventTimeB), 0, false);

    assert.deepEqual(first, second);
    assert.equal(first.detail, ' · 09:41');
    assert.equal(presentationNow().getTime(), presentationNow().getTime());
    assert.equal(presentationAnimationElapsed(731), 0);
    assert.equal(eventTimeA.getTime(), 1_800_000_000_000, 'shell event time remains untouched');

    const shortRun = liveActivityParts('echo stable', 100, presentationAnimationElapsed(100));
    const longRun = liveActivityParts('echo stable', 5000, presentationAnimationElapsed(5000));
    assert.equal(shortRun.phrase, longRun.phrase, 'spinner phase stays fixed');
    assert.notEqual(shortRun.duration, longRun.duration, 'measured duration remains real');
  });
});

test('deterministic environment does not leak after an assertion scope', () => {
  const before = process.env.NMSH_DETERMINISTIC;
  assert.throws(() => withDeterministicPresentation(true, () => {
    assert.equal(presentationAnimationElapsed(12), 0);
    throw new Error('exercise restoration');
  }), /exercise restoration/u);
  assert.equal(process.env.NMSH_DETERMINISTIC, before);
});
