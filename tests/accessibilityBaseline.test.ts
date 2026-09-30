import assert from 'node:assert/strict';
import test from 'node:test';
import {colorLevel} from '../src/presentation/capabilities.js';
import {isReducedMotion, presentationAnimationElapsed} from '../src/presentation/environment.js';
import {background, foreground, UI_COLORS} from '../src/ui/palette.js';
import {shimmerText} from '../src/status/shimmer.js';
import {GLYPHS} from '../src/ui/glyphs.js';

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(patch).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(patch)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { return run(); } finally {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}
const CLEAN = {NO_COLOR: undefined, NMSH_COLOR: undefined, NMSH_REDUCED_MOTION: undefined, NMSH_DETERMINISTIC: undefined, TERM: 'xterm-256color'};

test('color level only drops on explicit signals', () => {
  assert.equal(colorLevel({TERM: 'xterm-256color'}), 'truecolor');
  assert.equal(colorLevel({}), 'truecolor');
  assert.equal(colorLevel({NO_COLOR: '1'}), 'none');
  assert.equal(colorLevel({NO_COLOR: ''}), 'truecolor');
  assert.equal(colorLevel({TERM: 'dumb'}), 'none');
  assert.equal(colorLevel({NO_COLOR: '1', NMSH_COLOR: 'truecolor'}), 'truecolor');
  assert.equal(colorLevel({NMSH_COLOR: 'none'}), 'none');
});

test('palette helpers emit no color escapes under NO_COLOR', () => {
  withEnv({...CLEAN}, () => assert.match(foreground(UI_COLORS.accent), /^\u001B\[38;2;/u));
  withEnv({...CLEAN, NO_COLOR: '1'}, () => {
    assert.equal(foreground(UI_COLORS.accent), '');
    assert.equal(background(UI_COLORS.accent), '');
    assert.equal(shimmerText('Running ls', 500, false).includes('\u001B'), false);
  });
});

test('status cues survive without color', () => {
  withEnv({NMSH_ICONS: 'safe'}, () => {
    assert.notEqual(GLYPHS.success, GLYPHS.failure);
    assert.match(GLYPHS.success + GLYPHS.failure, /^[\x20-\x7e]+$/u);
  });
});

test('reduced motion freezes the animation phase but not measured time', () => {
  withEnv({...CLEAN}, () => {
    assert.equal(isReducedMotion(), false);
    assert.equal(presentationAnimationElapsed(4321), 4321);
  });
  withEnv({...CLEAN, NMSH_REDUCED_MOTION: '1'}, () => {
    assert.equal(isReducedMotion(), true);
    assert.equal(presentationAnimationElapsed(4321), 0);
  });
  withEnv({...CLEAN, NMSH_DETERMINISTIC: '1'}, () => assert.equal(isReducedMotion(), true));
});
