import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFeedback, copyStats} from '../src/clipboard/clipboard.js';

test('counts characters and lines without a trailing-newline off-by-one', () => {
  assert.deepEqual(copyStats('hello\n'), {characters: 6, lines: 1});
  assert.deepEqual(copyStats('first\nsecond\n'), {characters: 13, lines: 2});
  assert.deepEqual(copyStats(''), {characters: 0, lines: 0});
  assert.deepEqual(copyStats('🐈'), {characters: 1, lines: 1});
});

test('uses singular and plural copy feedback', () => {
  assert.equal(copyFeedback({characters: 1, lines: 1}), 'Copied to clipboard · 1 character · 1 line');
  assert.equal(copyFeedback({characters: 2, lines: 2}), 'Copied to clipboard · 2 characters · 2 lines');
  assert.equal(copyFeedback({characters: 847, lines: 9}, 2), 'Copied response 2 to clipboard · 847 characters · 9 lines');
});
