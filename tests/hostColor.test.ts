import test from 'node:test';
import assert from 'node:assert/strict';
import {colorLevel} from '../src/presentation/capabilities.js';
import {colorEscape} from '../src/chroma/escape.js';

test('host defaults, standard evidence and explicit color overrides share Chroma', () => {
  assert.equal(colorLevel({TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color'}), 'ansi256');
  assert.equal(colorLevel({TERM: 'vt100'}), 'ansi16');
  assert.equal(colorLevel({COLORTERM: 'truecolor'}), 'truecolor');
  assert.equal(colorLevel({TERM_PROGRAM: 'ghostty'}), 'truecolor');
  assert.equal(colorLevel({TERM_PROGRAM: 'ghostty', NO_COLOR: '1'}), 'none');
  assert.equal(colorLevel({TERM_PROGRAM: 'Apple_Terminal', NO_COLOR: '1', NMSH_COLOR: 'truecolor'}), 'truecolor');
  assert.equal(colorEscape(38, {red: 255, green: 0, blue: 0}, 'ansi16'), '\u001b[91m');
  assert.equal(colorEscape(48, {red: 0, green: 0, blue: 0}, 'ansi16'), '\u001b[40m');
});
