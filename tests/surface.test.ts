import assert from 'node:assert/strict';
import test from 'node:test';
import {linearGradient, solid, theme} from '../src/chroma/chroma.js';
import {framePanel} from '../src/ui/PanelShell.js';
import {renderSurface, type SurfaceSpec} from '../src/ui/surface.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const plain = (rows: string[]) => rows.map(stripAnsi);
const RED = solid({red: 200, green: 0, blue: 0});
const BLUE = solid({red: 0, green: 0, blue: 200});

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(patch).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(patch)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { return run(); } finally {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

test('every frame style renders with the same geometry', () => {
  withEnv({NMSH_ICONS: 'nerd'}, () => {
    assert.deepEqual(plain(renderSurface(['hi'], 6, {frame: 'square'})), ['┌────┐', '│hi  │', '└────┘']);
    assert.deepEqual(plain(renderSurface(['hi'], 6, {frame: 'rounded'})), ['╭────╮', '│hi  │', '╰────╯']);
    assert.deepEqual(plain(renderSurface(['hi'], 6, {frame: 'double'})), ['╔════╗', '║hi  ║', '╚════╝']);
    assert.deepEqual(plain(renderSurface(['hi'], 6, {frame: 'heavy'})), ['┏━━━━┓', '┃hi  ┃', '┗━━━━┛']);
    assert.deepEqual(plain(renderSurface(['hi'], 4, {frame: 'topLine'})), ['────', 'hi']);
    assert.deepEqual(plain(renderSurface(['hi'], 4, {frame: 'none'})), ['hi']);
  });
  withEnv({NMSH_ICONS: 'safe'}, () => {
    assert.deepEqual(plain(renderSurface(['hi'], 6, {frame: 'double'})), ['+----+', '|hi  |', '+----+']);
  });
});

test('frame and fill are independent: all four combinations are valid', () => {
  const specs: SurfaceSpec[] = [
    {fill: theme('selection')},
    {frame: 'rounded'},
    {frame: 'rounded', fill: theme('selection')},
    {frame: 'square', fill: linearGradient(RED, BLUE), frameColor: linearGradient(BLUE, RED)},
  ];
  for (const spec of specs) {
    const rows = renderSurface(['abc', 'de'], 10, spec);
    for (const row of rows) assert.ok(displayWidth(row) <= 10, JSON.stringify(plain([row])));
    assert.ok(stripAnsi(rows.join('\n')).includes('abc'));
  }
  assert.ok(renderSurface(['x'], 5, {fill: theme('selection')})[0]!.includes('\u001B[48;'));
  assert.ok(!renderSurface(['x'], 5, {frame: 'rounded'}).some(row => row.includes('\u001B[48;')));
});

test('gradient fill gives different columns different backgrounds and survives inner resets', () => {
  const row = renderSurface(['\u001B[1mab\u001B[0mcd'], 4, {fill: linearGradient(RED, BLUE)})[0]!;
  const backgrounds = row.match(/\u001B\[48;2;\d+;\d+;\d+m/gu)!;
  assert.equal(backgrounds.length, 4);
  assert.equal(new Set(backgrounds).size, 4);
  assert.equal(stripAnsi(row), 'abcd');
});

test('padding, inset, width and alignment', () => {
  assert.deepEqual(plain(renderSurface(['hi'], 12, {frame: 'square', padding: {x: 1, y: 1}, width: 'content'})),
    ['┌────┐', '│    │', '│ hi │', '│    │', '└────┘']);
  assert.deepEqual(plain(renderSurface(['hi'], 10, {inset: 2})), ['  hi']);
  assert.deepEqual(plain(renderSurface(['hi'], 10, {frame: 'square', width: 'content', align: 'right'})), ['      ┌──┐', '      │hi│', '      └──┘']);
  assert.deepEqual(plain(renderSurface(['hi'], 10, {frame: 'square', width: 'content', align: 'center'}))[1], '   │hi│');
});

test('narrow terminals degrade instead of overflowing', () => {
  for (const columns of [1, 2, 3, 4, 5, 8]) {
    for (const frame of ['square', 'rounded', 'double', 'heavy', 'topLine', 'none'] as const) {
      const rows = renderSurface(['hello world'], columns, {frame, padding: {x: 2, y: 1}, inset: 3, fill: theme('selection')});
      for (const row of rows) assert.ok(displayWidth(row) <= columns, `${frame}@${columns}: ${JSON.stringify(plain([row]))}`);
    }
  }
  assert.deepEqual(plain(renderSurface(['hello'], 2, {frame: 'square'})), ['──', 'h…']);
});

test('no-color drops fills and frame colors but keeps geometry', () => {
  withEnv({NO_COLOR: '1', NMSH_COLOR: undefined, NMSH_ICONS: 'nerd'}, () => {
    const rows = renderSurface(['hi'], 6, {frame: 'rounded', fill: theme('selection'), frameColor: linearGradient(RED, BLUE)});
    assert.ok(rows.every(row => !/\u001B\[(38|48);/u.test(row)));
    assert.equal(rows[0]!.replace(/\u001B\[0m/gu, ''), '╭────╮');
  });
});

test('framePanel keeps its top line over the untouched rows', () => {
  const rows = framePanel(['one', 'two'], 8);
  assert.equal(rows.length, 3);
  assert.equal(stripAnsi(rows[0]!), '────────');
  assert.deepEqual(rows.slice(1), ['one', 'two']);
});
