import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIVITY_VERBS, selectActivityVerb} from '../src/status/activityVerbs.js';

/** Past tenses that are not "-ed": the only single-word pairs allowed to skip it. */
const IRREGULAR = new Map([
  ['Weaving', 'Wove'], ['Drawing', 'Drew'], ['Binding', 'Bound'], ['Creeping', 'Crept'], ['Sliding', 'Slid'], ['Swimming', 'Swam'],
  ['Diving', 'Dived'], ['Spitting', 'Spat'], ['Sleeping', 'Slept'], ['Digging', 'Dug'], ['Slinking', 'Slunk'], ['Singing', 'Sang'],
  ['Growing', 'Grew'], ['Freewriting', 'Freewrote'], ['Winging it', 'Winged it'], ['Speedrunning', 'Speedran'],
]);

test('the dictionary has at least 600 distinct pairs', () => {
  assert.ok(ACTIVITY_VERBS.length >= 600, String(ACTIVITY_VERBS.length));
  assert.equal(new Set(ACTIVITY_VERBS.map(pair => pair.active.toLowerCase())).size, ACTIVITY_VERBS.length, 'active phrases are unique');
  assert.equal(new Set(ACTIVITY_VERBS.map(pair => pair.complete.toLowerCase())).size, ACTIVITY_VERBS.length, 'completed phrases are unique');
});

test('every phrase is a short, clean, capitalised piece of text that "for 18s" can follow', () => {
  for (const {active, complete} of ACTIVITY_VERBS) {
    for (const phrase of [active, complete]) {
      assert.match(phrase, /^\p{Lu}[\p{L}'’ -]*$/u, phrase);
      assert.ok(phrase.length >= 3 && phrase.length <= 34, phrase);
      assert.equal(phrase, phrase.trim());
      assert.doesNotMatch(phrase, /\s{2,}|--|-$/u, phrase);
    }
    assert.notEqual(active, complete);
  }
});

test('single-word pairs conjugate correctly', () => {
  for (const {active, complete} of ACTIVITY_VERBS) {
    if (/[ -]/u.test(active) || /[ -]/u.test(complete) || active.includes("'")) continue;
    const irregular = IRREGULAR.get(active);
    if (irregular) { assert.equal(complete, irregular, active); continue; }
    assert.match(complete, /ed$/u, `${active} → ${complete}`);
    // The past tense is the same word, not a different one.
    assert.equal(complete.slice(0, 2).toLowerCase(), active.slice(0, 2).toLowerCase(), `${active} → ${complete}`);
  }
});

test('no phrase claims a technical outcome it cannot know', () => {
  const claims = /\b(verif|install|deploy|fix|secur|encrypt|authenticat|backed|test(?:ed|ing)|pass(?:ed|ing)|succe|fail|finish|complet|compil|cleaned|cleaning|download|upload|sync|commit|push|merg|delet|remov|updat|upgrad|sort|fetch|cach|optimi[sz]|analy[sz]|calculat|evaluat|scann|render)/iu;
  for (const {active, complete} of ACTIVITY_VERBS) {
    assert.doesNotMatch(active, claims, active);
    assert.doesNotMatch(complete, claims, complete);
  }
  // NMSh's own words must not be borrowed for decoration: folding, queue, copy, running, completed.
  for (const {active, complete} of ACTIVITY_VERBS) assert.doesNotMatch(`${active} ${complete}`, /\b(?:fold|queue|copy|copied|running|ran\b|skipp|paus|stopp|interrupt)/iu, active);
});

test('the choice depends only on the command and its start, and is stable', () => {
  const first = selectActivityVerb('make test', 1_700_000_000_000);
  for (let index = 0; index < 5; index += 1) assert.equal(selectActivityVerb('make test', 1_700_000_000_000), first);
  assert.ok(ACTIVITY_VERBS.includes(first));
});

test('two commands in a row never share a phrase, and the whole dictionary gets used', () => {
  let previous = selectActivityVerb('a', 0);
  const seen = new Set<string>([previous.active]);
  for (let index = 1; index < 20_000; index += 1) {
    const next = selectActivityVerb(`command ${index}`, 1_700_000_000_000 + index * 997, previous);
    assert.notEqual(next.active, previous.active);
    seen.add(next.active);
    previous = next;
  }
  assert.ok(seen.size > ACTIVITY_VERBS.length * 0.95, `${seen.size} of ${ACTIVITY_VERBS.length}`);
});
