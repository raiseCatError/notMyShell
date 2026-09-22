import test from 'node:test';
import assert from 'node:assert';
import {
  ACTIVITY_GLYPH_INTERVAL_MS,
  ACTIVITY_VERBS,
  ActivitySelector,
  activityGlyph,
  activityGlyphWidths,
  completedActivity,
  liveActivity,
  liveActivityParts,
} from '../src/status/activity.js';
import {GLYPHS} from '../src/ui/glyphs.js';

test('curated activity pairs retain deterministic active/completed mappings', () => {
  assert.ok(ACTIVITY_VERBS.some(pair => pair.active === 'Meowing' && pair.complete === 'Meowed'));
  assert.ok(ACTIVITY_VERBS.some(pair => pair.active === 'Cooking' && pair.complete === 'Cooked'));
  assert.ok(ACTIVITY_VERBS.some(pair => pair.active === 'Herding' && pair.complete === 'Herded'));
  const selector = new ActivitySelector(() => 0);
  assert.deepEqual(selector.next(), ACTIVITY_VERBS[0]);
  assert.deepEqual(selector.next(), ACTIVITY_VERBS[1]);
});

test('live activity duration changes while its selected phrase stays stable', () => {
  const pair = {active: 'Meowing', complete: 'Meowed'};
  assert.ok(liveActivity(pair, 8200).includes('Meowing… (8.2s)'));
  assert.equal(liveActivity(pair, 8500), `${activityGlyph(8500)} Meowing… (8.5s)`);
});

test('activity glyph grows and shrinks independently with equal-width frames', () => {
  assert.ok(ACTIVITY_GLYPH_INTERVAL_MS >= 160 && ACTIVITY_GLYPH_INTERVAL_MS <= 170, 'star cadence must be roughly 165ms');
  assert.equal(activityGlyph(0), '·');
  assert.equal(activityGlyph(ACTIVITY_GLYPH_INTERVAL_MS * 4), '✻');
  assert.equal(activityGlyph(ACTIVITY_GLYPH_INTERVAL_MS * 5), '*');
  assert.deepEqual([...new Set(activityGlyphWidths())], [1]);
});

test('completion is static, paired, and includes local 24-hour time', () => {
  const completedAt = new Date(2026, 8, 21, 23, 48);
  assert.deepEqual(completedActivity({active: 'Meowing', complete: 'Meowed'}, 9100, completedAt), {
    main: `${GLYPHS.success} Meowed for 9.1s`,
    detail: ' · done 23:48',
  });
});
