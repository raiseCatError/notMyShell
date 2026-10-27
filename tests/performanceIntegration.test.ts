import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {selectedText} from '../src/output/TranscriptSelection.js';
import {graphemes} from '../src/input/inputLayout.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

function populate(f: ReturnType<typeof executionFrameFixture>, count = 250): void {
  const output = f.app['output'];
  for (let i = 0; i < count; i++) {
    output.beginCommand(`prior-${i}`, [`❯ prior-${i}`]);
    output.write(`saved ${i} café 界\r\n`);
    output.complete(0, {holdOpen: true});
  }
}

test('combined output batching, command indexes and Unicode editing preserve bytes across scroll and resize', context => {
  const f = executionFrameFixture(70, 30);
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    populate(f);
    const draft = 'printf ' + '界e\u0301👩🏽‍💻 '.repeat(45);
    f.app['editor'].insert(draft);
    f.begin('stream-unicode');
    const lines: string[] = [];
    for (let i = 0; i < 120; i++) {
      const line = `burst ${String(i).padStart(3, '0')} café 界 e\u0301`;
      lines.push(line);
      f.app['onShellData'](line + '\r\n');
      if (i % 7 === 0) {
        f.app['onInput']('x');
        assert.equal(f.app['outputRenderTimer'], undefined, 'the production input path consumes pending output immediately');
        f.app['onInput']('\x7f');
        f.app['onInput']('\x1b[A');
        f.app['onInput']('\x1b[B');
      }
      if (i === 30) {
        f.app['onInput']('\x1b[5~');
        assert.equal(f.app['historyViewport'].detached, true);
      }
      if (i === 60) {
        Object.defineProperty(f.app, 'dimensions', {value: () => ({columns: 43, rows: 30}), configurable: true});
        Object.defineProperty(f.app, 'terminalDimensions', {value: () => ({columns: 43, rows: 30}), configurable: true});
        f.app['onResize']();
      }
      if (i === 90) f.app['onInput']('\x1b[1;5F');
    }
    f.complete();
    context.mock.timers.tick(32);
    assert.equal(f.app['outputRenderTimer'], undefined);
    assert.equal(f.app['editor'].text, draft, 'navigation and paired edits never alter Unicode source');
    assert.ok(f.app['editor'].cursorIndex <= graphemes(draft).length);
    const commands = f.app['output'].recentShellCommands();
    assert.equal(commands[0]!.command, 'stream-unicode');
    assert.equal(commands[0]!.output, lines.join('\n'));
    assert.deepEqual(commands.slice(1).map(command => command.command), Array.from({length: 250}, (_, i) => `prior-${249 - i}`));
    assert.equal(f.app['historyViewport'].detached, false);
  } finally { f.dispose(); }
});

test('a populated indexed transcript keeps pending-click and copy targets on the displayed Unicode rows', {skip: !['darwin', 'linux'].includes(process.platform)}, async context => {
  const f = executionFrameFixture(50, 24);
  context.mock.timers.enable({apis: ['setTimeout']});
  const oldPath = process.env.PATH, oldWayland = process.env.WAYLAND_DISPLAY;
  writeFileSync(join(process.env.HOME!, 'wl-copy'), '#!/bin/sh\nexit 1\n', {mode: 0o700});
  process.env.PATH = process.env.HOME + ':' + (oldPath ?? '');
  process.env.WAYLAND_DISPLAY = 'nmsh-test-fake';
  let copied = '';
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), kill: () => true});
  child.stdin.on('data', data => { copied += String(data); });
  child.stdin.on('finish', () => child.emit('exit', 0));
  const spawn = context.mock.method(childProcess, 'spawn', () => child);
  syncBuiltinESMExports();
  try {
    populate(f);
    f.app['editor'].insert('界e\u0301 '.repeat(40));
    f.begin('stream-selection', Array.from({length: 50}, (_, i) => `visible ${i} café 界\r\n`).join(''));
    const painted = f.capture();
    const start = f.app['historyViewport'].start;
    const rows = f.app['output'].wrapped(50);
    const local = 2;
    const expectedLine = rows[start + local]!.lineIndex;
    f.app['onShellData']('pending café 界\r\n');
    f.app['handleKey']({kind: 'mouseClick', x: 5, y: painted.plan.transcript.top + local + 1});
    assert.equal(f.app['hoveredLineIndex'], expectedLine);
    assert.equal(f.app['selection']?.anchor, start + local);
    const frame = f.app['presentationFrame']!;
    f.app['handleKey']({kind: 'mouseDrag', x: 5, y: frame.plan.transcript.top + local + 3});
    f.app['onShellData']('during drag café 界\r\n');
    assert.equal(f.app['outputRenderTimer'], undefined, 'drag output is displayed before a release can copy');
    const releaseY = frame.plan.transcript.top + local + 3;
    const releaseTarget = f.app['transcriptRowAt'](releaseY);
    const displayed = f.app['presentationFrame']!.transcript;
    const displayedOffset = releaseY - f.app['presentationFrame']!.plan.transcript.top - 1;
    assert.equal(releaseTarget, displayed.start + displayedOffset, 'release maps to the independently retained last-painted viewport row');
    // The synchronous drag paint has advanced FOLLOW: release selects the row now displayed under the pointer.
    const expected = selectedText(f.app['output'].wrapped(50), {...f.app['selection']!, head: releaseTarget!});
    assert.ok(expected.includes('café 界'));
    f.app['handleKey']({kind: 'mouseRelease', x: 5, y: releaseY});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(spawn.mock.callCount(), 1, 'the deterministic fake clipboard must actually be invoked');
    assert.equal(copied, expected);
    assert.equal(f.app['selection']?.dragging, false);
  } finally {
    spawn.mock.restore(); syncBuiltinESMExports();
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldWayland === undefined) delete process.env.WAYLAND_DISPLAY; else process.env.WAYLAND_DISPLAY = oldWayland;
    f.dispose();
  }
});

test('interrupt and stop cancel pending paints without changing indexed command order', context => {
  const f = executionFrameFixture();
  context.mock.timers.enable({apis: ['setTimeout']});
  const interrupt = context.mock.method(f.session, 'interrupt', () => {});
  try {
    populate(f);
    f.begin('cancel-stream');
    f.app['onShellData']('preserved before interrupt\r\n');
    f.app['onInput']('\x03');
    assert.equal(interrupt.mock.callCount(), 1);
    assert.equal(f.app['outputRenderTimer'], undefined, 'interrupt paints pending output before a later shell prompt');
    f.complete(130);
    f.begin('next-command');
    f.app['onShellData']('next output\r\n');
    f.complete();
    const commands = f.app['output'].recentShellCommands();
    assert.deepEqual(commands.slice(0, 2).map(command => [command.command, command.output, command.exitCode]), [
      ['next-command', 'next output', 0], ['cancel-stream', 'preserved before interrupt', 130],
    ]);
    f.app['onShellData']('pending at stop\r\n');
    f.app['stop'](0);
    let paints = 0;
    f.app['renderer'].render = () => { paints++; };
    context.mock.timers.tick(100);
    assert.equal(paints, 0);
    assert.equal(f.app['outputRenderTimer'], undefined);
  } finally { f.dispose(); }
});
