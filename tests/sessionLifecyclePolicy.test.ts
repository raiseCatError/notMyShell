import test from 'node:test';
import assert from 'node:assert/strict';
import {POLICY_OFF, REVIEW_IDLE_MS, decodePolicy, eligibility, encodePolicy, lifecycleState, type LifecycleFacts, type LifecyclePolicy} from '../src/session/lifecycle.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const policy: LifecyclePolicy = {unusedMs: 10 * MIN, idleExpiryMs: 0};
const facts = (extra: Partial<LifecycleFacts> = {}): LifecycleFacts => ({attached: false, ending: false, protected: false, running: false, waiting: false,
  queued: 0, tasks: 0, used: false, detachedSince: 0, lastActivity: 0, policyAware: true, ...extra});

test('states come from observed facts only', () => {
  assert.equal(lifecycleState(facts({attached: true, running: true})), 'attached');
  assert.equal(lifecycleState(facts({ending: true})), 'ending');
  assert.equal(lifecycleState(facts({running: true, waiting: true})), 'waiting');
  assert.equal(lifecycleState(facts({running: true})), 'executing');
  assert.equal(lifecycleState(facts({used: true, tasks: 1})), 'executing', 'an idle shell holding a background task is working');
  assert.equal(lifecycleState(facts({used: true, jobs: 2})), 'executing');
  assert.equal(lifecycleState(facts({used: true, queued: 1})), 'executing');
  assert.equal(lifecycleState(facts({used: true})), 'idle');
  assert.equal(lifecycleState(facts()), 'unused');
});

test('an abandoned new session becomes eligible only after the grace period', () => {
  const before = eligibility(facts(), policy, 9 * MIN);
  assert.equal(before.kind, 'kept');
  assert.equal(before.kind === 'kept' && before.at, 10 * MIN, 'the service schedules exactly one check at the deadline');
  assert.match(before.reason, /never used; cleanup in 1m/);
  const after = eligibility(facts(), policy, 10 * MIN);
  assert.deepEqual(after.kind === 'automatic' && after.why, 'unused');
  // Reattaching before the deadline: attached is never eligible, and a new detach restarts the grace.
  assert.equal(eligibility(facts({attached: true, detachedSince: undefined}), policy, 11 * MIN).kind, 'kept');
  assert.equal(eligibility(facts({detachedSince: 5 * MIN}), policy, 11 * MIN).kind, 'kept');
});

test('work, protection, ending and unknown children always keep a session; idle output alone never makes it disposable', () => {
  const now = 100 * HOUR;
  const old = {detachedSince: 0, lastActivity: 0};
  for (const [extra, reason] of [
    [{protected: true}, /protected/], [{ending: true}, /ending/], [{attached: true}, /attached/],
    [{running: true, used: true}, /command is running/], [{running: true, waiting: true, used: true}, /waiting for input/],
    [{used: true, tasks: 1}, /1 background task/], [{used: true, jobs: 1}, /1 shell job/], [{used: true, queued: 3}, /3 queued commands/],
    [{children: 2}, /2 child processes/], [{used: true, children: 1}, /1 child process\b/],
  ] as Array<[Partial<LifecycleFacts>, RegExp]>) {
    const result = eligibility(facts({...old, ...extra}), {unusedMs: 10 * MIN, idleExpiryMs: HOUR}, now);
    assert.equal(result.kind, 'kept', JSON.stringify(extra));
    assert.match(result.reason, reason);
  }
});

test('long-idle sessions are only suggested after a day; idle expiry is opt-in', () => {
  const idle = facts({used: true, detachedSince: 0, lastActivity: 0});
  assert.equal(eligibility(idle, policy, REVIEW_IDLE_MS - 1).kind, 'kept');
  const review = eligibility(idle, policy, REVIEW_IDLE_MS);
  assert.equal(review.kind, 'review', 'suggested, never automatic, with idle expiry off');
  assert.match(review.reason, /cleanup suggested/);
  const expiring = eligibility(idle, {unusedMs: 0, idleExpiryMs: 3 * HOUR}, 3 * HOUR);
  assert.deepEqual(expiring.kind === 'automatic' && expiring.why, 'idle-expired');
  // Idle expiry covers a never-used session too when unused cleanup is off, and a long-idle review carries the deadline.
  const unusedExpiring = eligibility(facts({detachedSince: 0, lastActivity: 0}), {unusedMs: 0, idleExpiryMs: 3 * HOUR}, 3 * HOUR);
  assert.deepEqual(unusedExpiring.kind === 'automatic' && unusedExpiring.why, 'idle-expired');
  const reviewing = eligibility(idle, {unusedMs: 0, idleExpiryMs: 3 * REVIEW_IDLE_MS}, REVIEW_IDLE_MS);
  assert.equal(reviewing.kind === 'review' && reviewing.at, 3 * REVIEW_IDLE_MS, 'one timer at the expiry, not hourly wakeups');
  // Activity resets the clock: the deadline follows the latest prompt or output.
  const active = eligibility(facts({used: true, lastActivity: 2 * HOUR}), {unusedMs: 0, idleExpiryMs: 3 * HOUR}, 3 * HOUR);
  assert.equal(active.kind === 'kept' && active.at, 5 * HOUR);
});

test('a session created before any policy reached the service keeps its old behaviour: nothing automatic', () => {
  const legacy = facts({policyAware: false});
  assert.equal(eligibility(legacy, policy, 9 * MIN).kind, 'kept');
  assert.equal(eligibility(legacy, policy, 11 * MIN).kind, 'review', 'offered behind a confirmation, never ended by a timer');
  assert.equal(eligibility(facts({policyAware: false, used: true}), {unusedMs: 0, idleExpiryMs: HOUR}, 30 * HOUR).kind, 'review');
  assert.equal(eligibility(facts(), POLICY_OFF, 11 * MIN).kind, 'review', 'cleanup off: offered, not automatic');
});

test('the policy travels bounded; malformed text changes nothing', () => {
  assert.equal(encodePolicy({unusedMs: 10 * MIN, idleExpiryMs: 0}), 'unused=600;idle=0');
  assert.deepEqual(decodePolicy('unused=600;idle=0'), {unusedMs: 10 * MIN, idleExpiryMs: 0});
  assert.deepEqual(decodePolicy('unused=1;idle=1'), {unusedMs: MIN, idleExpiryMs: HOUR}, 'clamped up to the minimum');
  assert.deepEqual(decodePolicy('unused=9999999;idle=99999999'), {unusedMs: 24 * HOUR, idleExpiryMs: 30 * 24 * HOUR}, 'clamped down to the maximum');
  for (const bad of [undefined, '', 'unused=-1;idle=0', 'unused=600', 'idle=0;unused=600', 'unused=600;idle=0;x=1']) assert.equal(decodePolicy(bad), undefined, String(bad));
});
