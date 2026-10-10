import test from 'node:test';
import assert from 'node:assert/strict';
import {completedActivity, liveActivityParts} from '../src/status/activity.js';
import {DEFAULT_LIVE_ACTIVITY, normalizeLiveActivity} from '../src/prompt/configuration.js';
import {ACTIVITY_VERBS} from '../src/status/activityVerbs.js';
import {stripAnsi} from '../src/util/text.js';

const cooking = {active: 'Cooking', complete: 'Cooked'};
const at = new Date(2026, 9, 10, 14, 46, 0);

test('Expressive is the default and old settings without a style migrate to it', () => {
  assert.equal(DEFAULT_LIVE_ACTIVITY.style, 'expressive');
  assert.equal(normalizeLiveActivity(undefined).style, 'expressive');
  assert.deepEqual(normalizeLiveActivity({colors: 'lavender'}), {colors: 'lavender', customStops: [], style: 'expressive'});
  assert.equal(normalizeLiveActivity({style: 'classic'}).style, 'classic');
  assert.equal(normalizeLiveActivity({style: 'chatty'}).style, 'expressive');
  assert.equal(normalizeLiveActivity({style: 7}).style, 'expressive');
});

test('the working line: the phrase and the real elapsed time; Classic still names the command', () => {
  const parts = liveActivityParts('npm test', 18_000, 18_000, cooking);
  assert.match(stripAnsi(parts.phrase), /^\S Cooking…$/u);
  assert.equal(parts.duration, ' · 18.0s');
  const classic = liveActivityParts('npm test', 18_000, 18_000);
  assert.match(classic.phrase, /Running npm test$/u);
});

test('a clean exit reads "Cooked for 18.0s · done 14:46"', () => {
  const parts = completedActivity('npm test', 18_000, at, 0, false, undefined, cooking);
  assert.equal(`${parts.main}${parts.detail}`, '✔ Cooked for 18.0s · done 14:46');
  const withFacts = completedActivity('adb devices', 1400, at, 0, false, ['2 devices'], cooking);
  assert.equal(`${withFacts.main}${withFacts.detail}`, '✔ Cooked · 2 devices · 1.4s · done 14:46');
});

test('failure and interruption are never decorated: exit code and wording stay factual', () => {
  const failed = completedActivity('npm test', 18_000, at, 3, false, undefined, cooking);
  assert.equal(`${failed.main}${failed.detail}`, '✘ Command failed · exit 3 · 18.0s · 14:46');
  const stopped = completedActivity('sleep 99', 4000, at, 0, true, undefined, cooking);
  assert.match(stopped.main, /Interrupted/u);
  assert.doesNotMatch(`${failed.main}${stopped.main}`, /Cooked|Cooking/u);
  // The failure line is the same with or without a pair.
  assert.deepEqual(failed, completedActivity('npm test', 18_000, at, 3, false, undefined));
});

test('Classic output is exactly what it was before', () => {
  const parts = completedActivity('ls', 1400, at, 0, false);
  assert.equal(`${parts.main}${parts.detail}`, '✔ Completed · 1.4s · 14:46');
});

test('every phrase fits a narrow line with its duration', () => {
  for (const pair of ACTIVITY_VERBS) {
    const done = completedActivity('x', 18_000, at, 0, false, undefined, pair);
    assert.ok(`${done.main}${done.detail}`.length <= 58, `${done.main}${done.detail}`);
    assert.ok(`${liveActivityParts('x', 125_000, 0, pair).phrase} · 2m 5s`.length <= 50, pair.active);
  }
});
