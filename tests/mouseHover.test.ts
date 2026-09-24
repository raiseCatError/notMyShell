import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeKeys} from '../src/terminal/keys.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

const sgr = (button: number, x: number, y: number, final: 'M' | 'm' = 'M') => `\u001B[<${button};${x};${y}${final}`;

test('SGR decoding: passive motion, clicks, wheel, and modifier bits', () => {
  assert.deepEqual(decodeKeys(sgr(35, 4, 2)), [{kind: 'mouseMove', x: 4, y: 2}], 'passive any-motion (no button)');
  assert.deepEqual(decodeKeys(sgr(32, 4, 2)), [{kind: 'mouseMove', x: 4, y: 2}], 'left-drag motion');
  assert.deepEqual(decodeKeys(sgr(0, 4, 2)), [{kind: 'mouseClick', x: 4, y: 2}]);
  assert.deepEqual(decodeKeys(sgr(0, 4, 2, 'm')), [], 'release is not a click');
  assert.deepEqual(decodeKeys(sgr(16, 4, 2)), [{kind: 'mouseClick', x: 4, y: 2}], 'ctrl bit does not hide a click');
  assert.deepEqual(decodeKeys(sgr(64, 1, 1)), [{kind: 'wheelUp'}]);
  assert.deepEqual(decodeKeys(sgr(69, 1, 1)), [{kind: 'wheelDown'}], 'modified wheel still scrolls');
});

test('Shift+mouse is native selection: no click, drag, or hover events', () => {
  for (const button of [4, 36, 39, 4 | 8]) assert.deepEqual(decodeKeys(sgr(button, 3, 3)), [], `button ${button}`);
});

test('renderer enables any-motion tracking only while NMSh owns the screen', () => {
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => { writes.push(data); });
  renderer.enter();
  assert.match(writes.at(-1)!, /\?1000h\u001B\[\?1003h\u001B\[\?1006h/u);
  renderer.suspendForPassthrough();
  assert.match(writes.at(-1)!, /\?1006l\u001B\[\?1003l\u001B\[\?1000l/u);
  renderer.resumeAfterPassthrough();
  assert.match(writes.at(-1)!, /\?1003h/u);
  renderer.leave();
  assert.match(writes.at(-1)!, /\?1003l/u);
});

test('passive hover updates without a click and skips same-row rerenders', () => {
  const app = new TerminalApp();
  try {
    app['output'].beginCommand('echo hi', ['❯ echo hi']);
    app['output'].write('one\ntwo\n');
    let renders = 0;
    Object.defineProperty(app, 'render', {value: () => { renders += 1; }});
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 30})});
    const rows = app['output'].wrapped(80);
    const target = rows.findIndex(row => row.plain === 'one');
    assert.ok(target >= 0);
    const move = (y: number, x = 2) => app['onInput'](sgr(35, x, y));
    move(target + 1);
    assert.equal(app['hoveredLineIndex'], rows[target]!.lineIndex, 'hover without click');
    assert.equal(renders, 1);
    move(target + 1, 9);
    assert.equal(renders, 1, 'moving within the same logical row does not rerender');
    app['onInput'](sgr(36, 2, target + 2));
    assert.equal(app['hoveredLineIndex'], rows[target]!.lineIndex, 'shift+motion is ignored');
    move(29);
    assert.equal(app['hoveredLineIndex'], undefined, 'leaving the output clears hover');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
