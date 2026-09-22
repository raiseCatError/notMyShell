import test from 'node:test';
import assert from 'node:assert/strict';
import {CAT_FRAMES, CAT_HEIGHT, CAT_WIDTH} from '../src/mascot/catFrames.js';
import {catFrameDimensions, renderCatFrame} from '../src/mascot/CatSprite.js';
import {CAT_PALETTES, DEFAULT_CAT_VARIANT} from '../src/mascot/catPalettes.js';
import {CatStateMachine} from '../src/mascot/CatStateMachine.js';
import {calculateCatPlacement} from '../src/mascot/CatMascot.js';
import {appConfig} from '../src/config.js';

test('black is the default palette and white uses the same sprite geometry', () => {
  assert.equal(DEFAULT_CAT_VARIANT, 'black');
  assert.equal(appConfig.mascot.variant, 'black');
  assert.notDeepEqual(CAT_PALETTES.black, CAT_PALETTES.white);
  assert.equal(renderCatFrame('idle', 'black').length, renderCatFrame('idle', 'white').length);
});

test('every cat frame has stable 8x3 dimensions', () => {
  for (const name of Object.keys(CAT_FRAMES) as Array<keyof typeof CAT_FRAMES>) {
    assert.deepEqual(catFrameDimensions(name), {width: CAT_WIDTH, height: CAT_HEIGHT}, name);
  }
});

test('cat placement stays in separator space and clamps on resize', () => {
  assert.deepEqual(calculateCatPlacement(80, 34, 200), {
    visible: true,
    x: 72,
    minX: 34,
    maxX: 72,
    stationary: false,
  });
  assert.equal(calculateCatPlacement(42, 34, 72).x, 34);
  assert.equal(calculateCatPlacement(18, 15, 10).visible, false);
  assert.equal(calculateCatPlacement(10, 2, 6).stationary, true);
});

test('idle transitions through blink and returns to idle', () => {
  const cat = new CatStateMachine({random: () => 0.1, initialTime: 0, ambientDelayMs: 0});
  cat.advance(350);
  assert.equal(cat.state, 'blink');
  assert.equal(cat.frameName, 'blink');
  cat.advance(650);
  assert.equal(cat.state, 'idle');
});

test('idle transitions through tail flick and returns to idle', () => {
  const cat = new CatStateMachine({random: () => 0.5, initialTime: 0, ambientDelayMs: 0});
  cat.advance(1750);
  assert.equal(cat.state, 'tailFlick');
  cat.advance(1990);
  assert.equal(cat.frameName, 'tail-high');
  cat.advance(2450);
  assert.equal(cat.state, 'idle');
});

test('walk states advance frames, move, and settle', () => {
  const left = new CatStateMachine({random: () => 0.7, initialTime: 0, ambientDelayMs: 0});
  left.advance(2450);
  assert.equal(left.state, 'walkLeft');
  assert.equal(left.advance(2690).movement, -1);
  left.advance(3850);
  assert.equal(left.state, 'idle');

  const right = new CatStateMachine({random: () => 0.9, initialTime: 0, ambientDelayMs: 0});
  right.advance(3150);
  assert.equal(right.state, 'walkRight');
  assert.equal(right.advance(3390).movement, 1);
});

test('long commands put the cat to sleep and completion wakes it', () => {
  const cat = new CatStateMachine({random: () => 0, initialTime: 0, ambientDelayMs: 60_000});
  cat.commandStarted(0);
  cat.advance(7999);
  assert.notEqual(cat.state, 'sleep');
  cat.advance(8000);
  assert.equal(cat.state, 'sleep');
  cat.commandCompleted(9000);
  assert.equal(cat.state, 'wake');
  cat.advance(9700);
  assert.equal(cat.state, 'idle');
});
