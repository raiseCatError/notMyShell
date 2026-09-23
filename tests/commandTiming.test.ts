import test from 'node:test';
import {formatDuration, formatLocalTime} from "../src/status/commandTiming.js";
import assert from 'node:assert/strict';

test('formats short and long durations', () => {
  assert.equal(formatDuration(18_440), '18.4s');
  assert.equal(formatDuration(458_000), '7m 38s');
});

test('formats completion time using 24-hour local time', () => {
  const date = new Date(2026, 8, 21, 6, 5);
  assert.equal(formatLocalTime(date), '06:05');
  assert.equal(formatLocalTime(new Date(2026, 8, 21, 0, 7)), '00:07');
});
