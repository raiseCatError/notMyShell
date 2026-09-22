import test from 'node:test';
import assert from 'node:assert/strict';
import {GLYPHS} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {
  SHIMMER_CYCLE_MS,
  interpolateRgb,
  shimmerIntensity,
  shimmerText,
  wrappedPhase,
} from '../src/status/shimmer.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {completedStatus} from '../src/status/commandTiming.js';
import {completedActivity} from '../src/status/activity.js';

test('shimmer interpolates RGB without changing string width', () => {
  assert.deepEqual(interpolateRgb({red: 0, green: 10, blue: 20}, {red: 10, green: 30, blue: 40}, 0.5), {
    red: 5,
    green: 20,
    blue: 30,
  });
  const text = '✻ Meowing… (4.2s)';
  const rendered = shimmerText(text, 425, false);
  assert.equal(stripAnsi(rendered), text);
  assert.equal(displayWidth(rendered), displayWidth(text));
  assert.match(rendered, /\u001B\[38;2;\d+;\d+;\d+m/u);
  assert.notDeepEqual(UI_COLORS.workingBase, UI_COLORS.workingPeak);
});

test('completed status text is static and retains completion time', () => {
  const completedAt = new Date(2026, 8, 21, 22, 51);
  assert.deepEqual(completedActivity({active: 'Meowing', complete: 'Meowed'}, 18_700, completedAt), {
    main: `${GLYPHS.success} Meowed for 18.7s`,
    detail: ' · done 22:51',
  });
  assert.ok(!completedStatus('failure', 18_700, completedAt, 1).main.includes('\u001B'));
});
