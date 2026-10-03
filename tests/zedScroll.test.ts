import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {resolveHostCapabilities} from '../src/host/capabilities.js';

const sgr = (button: number, release = false) => `\u001B[<${button};10;5${release ? 'm' : 'M'}`;
const WHEEL_UP = sgr(64);
const WHEEL_DOWN = sgr(65);

function scrollApp() {
  const app = new TerminalApp();
  app['output'].setOutputFolding('never');
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 20})});
  Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
  app['renderer'].render = (() => {}) as never;
  app['session'].resize = (() => {}) as never;
  app['session'].write = (() => {}) as never;
  app['output'].beginCommand('seq 200', ['❯ seq 200']);
  app['output'].write(Array.from({length: 200}, (_, index) => `line-${index}\n`).join(''));
  app['output'].complete(0);
  app['render']();
  return app;
}

test('Zed wheel reports decode to transcript scrolling, Shift-modified wheel too', () => {
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'zed'}).mouseReporting, true);
  assert.deepEqual(decodeKeys(WHEEL_UP), [{kind: 'wheelUp'}]);
  assert.deepEqual(decodeKeys(WHEEL_DOWN), [{kind: 'wheelDown'}]);
  assert.deepEqual(decodeKeys(sgr(64 + 4)), [{kind: 'wheelUp'}]);
});

test('wheel moves the transcript, stops at the oldest row, returns to newest and stays following', () => {
  const app = scrollApp();
  try {
    const viewport = app['historyViewport'];
    app['onInput'](WHEEL_UP);
    assert.equal(viewport.detached, true);
    const first = viewport.start;
    app['onInput'](WHEEL_UP);
    assert.equal(viewport.start, first - 3, 'three rows per notch');
    for (let index = 0; index < 200; index += 1) app['onInput'](WHEEL_UP);
    assert.equal(viewport.start, 0, 'oldest row reached');
    app['onInput'](WHEEL_UP);
    assert.equal(viewport.start, 0, 'wheel at the oldest bound stays put');
    for (let index = 0; index < 200; index += 1) app['onInput'](WHEEL_DOWN);
    assert.equal(viewport.detached, false, 'newest row: following again');
    app['onInput'](WHEEL_DOWN);
    assert.equal(viewport.detached, false, 'wheel at the newest bound stays following');
    assert.equal(app['editor'].text, '', 'wheel never types or recalls history');
  } finally { app['stop'](0); app['session'].kill(); }
});

test('PageUp/PageDown keep paging the transcript alongside the wheel', () => {
  const app = scrollApp();
  try {
    const viewport = app['historyViewport'];
    app['onInput']('\u001B[5~');
    assert.equal(viewport.detached, true);
    const paged = viewport.start;
    app['onInput'](WHEEL_UP);
    assert.equal(viewport.start, paged - 3);
    app['onInput']('\u001B[6~');
    app['onInput']('\u001B[6~');
    assert.equal(viewport.detached, false);
  } finally { app['stop'](0); app['session'].kill(); }
});
