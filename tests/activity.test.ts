import test from 'node:test';
import assert from 'node:assert';
import {
  ACTIVITY_GLYPH_INTERVAL_MS,
  activityGlyph,
  activityGlyphWidths,
  completedActivity,
  liveActivityParts,
} from '../src/status/activity.js';
import {GLYPHS} from '../src/ui/glyphs.js';

test('live activity duration changes while its selected phrase stays stable', () => {
  const parts1 = liveActivityParts('npm test', 8200);
  assert.ok(parts1.phrase.includes('Running npm test'));
  assert.equal(parts1.duration, ' · 8.2s');

  const parts2 = liveActivityParts('npm test', 8500);
  assert.equal(parts2.phrase, `${activityGlyph(8500)} Running npm test`);
  assert.equal(parts2.duration, ' · 8.5s');
});

test('activity glyph grows and shrinks independently with equal-width frames', () => {
  assert.ok(ACTIVITY_GLYPH_INTERVAL_MS >= 160 && ACTIVITY_GLYPH_INTERVAL_MS <= 170, 'star cadence must be roughly 165ms');
  assert.equal(activityGlyph(0), '·');
  assert.equal(activityGlyph(ACTIVITY_GLYPH_INTERVAL_MS * 4), '✻');
  assert.equal(activityGlyph(ACTIVITY_GLYPH_INTERVAL_MS * 5), '*');
  assert.deepEqual([...new Set(activityGlyphWidths())], [1]);
});

test('completion is static, and includes local 24-hour time', () => {
  const completedAt = new Date(2026, 8, 21, 23, 48);
  assert.deepEqual(completedActivity('npm test', 9100, completedAt, 0, false), {
    main: `${GLYPHS.success} Completed · 9.1s`,
    detail: ' · 23:48',
  });
});

test('live activity parts flattens multiline commands and truncates length', () => {
  const parts1 = liveActivityParts('cd ~/Projects/notMyShell\nnpm test', 8200);
  assert.equal(parts1.phrase, `${activityGlyph(8200)} Running cd ~/Projects/notMyShell ⏎ npm test`);

  const longCommand = 'echo 1\necho 2\necho 3\necho 4\necho 5\necho 6\necho 7\necho 8';
  const parts2 = liveActivityParts(longCommand, 100);
  assert.equal(parts2.phrase, `${activityGlyph(100)} Running echo 1 ⏎ echo 2 ⏎ echo 3 ⏎ echo 4 ⏎ echo 5 ⏎ echo…`);
  assert.ok(!parts2.phrase.includes('\n'), 'Must not contain newline');
  assert.ok(!parts2.phrase.includes('\r'), 'Must not contain carriage return');
});
