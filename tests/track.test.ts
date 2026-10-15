import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {parseWatch, watchSafety, WatchTasks, MIN_LOCAL_MS} from '../src/tasks/WatchTasks.js';
import {renderWatchPanel, watchPanelKey, watchRow} from '../src/tasks/WatchPanel.js';
import {stripAnsi} from '../src/util/text.js';

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - started > timeoutMs) { reject(new Error('track did not reach expected state')); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('/track is a native /watch alias with list, refresh and controls', () => {
  assert.deepEqual(parseSlashCommand('/track df -h /Volumes/T7Projects'),
    {kind: 'watch', op: 'start', arguments: 'df -h /Volumes/T7Projects'});
  assert.deepEqual(parseSlashCommand('/track --every 5s -- docker system df'),
    {kind: 'watch', op: 'start', arguments: '--every 5s -- docker system df'});
  for (const text of ['/track', '/track list']) {
    assert.deepEqual(parseSlashCommand(text), {kind: 'watch', op: 'list', arguments: ''});
  }
  assert.deepEqual(parseSlashCommand('/track refresh 2'), {kind: 'watch', op: 'now', arguments: '2'});
  assert.deepEqual(parseSlashCommand('/track pause'), {kind: 'watch', op: 'pause', arguments: ''});
  assert.deepEqual(parseSlashCommand('/track resume 1'), {kind: 'watch', op: 'resume', arguments: '1'});
  assert.deepEqual(parseSlashCommand('/track stop all'), {kind: 'watch', op: 'stop', arguments: 'all'});
  assert.deepEqual(parseSlashCommand('/watch stop 2'), {kind: 'watch', op: 'stop', arguments: '2'},
    'existing /watch commands must remain compatible');
  assert.deepEqual(parseWatch('df -h /Volumes/T7Projects'),
    {command: 'df -h /Volumes/T7Projects'});
  assert.deepEqual(parseWatch('--every 5s -- docker system df'),
    {command: 'docker system df', intervalMs: 5000});
  assert.deepEqual(parseWatch('--every 2s -- df -h /Volumes/T7Projects'),
    {command: 'df -h /Volumes/T7Projects', intervalMs: MIN_LOCAL_MS});
  assert.deepEqual(parseWatch('--every 1500ms -- docker system df'),
    {command: 'docker system df', intervalMs: 1500});
  assert.deepEqual(parseWatch('--every 2 minutes -- df -h /Volumes/T7Projects'),
    {command: 'df -h /Volumes/T7Projects', intervalMs: 120000});
  for (const invalid of ['--every', '--every 5s', '--every -1s -- df', '--every 1e100s df', '--every 0s df',
    '--every 99999999999999999999999999999999999999m df', '--every 61m df', '--every banana df']) {
    assert.ok(parseWatch(invalid).error, invalid);
  }
});

test('/track classifies disk information as read-only, but never assumes Docker writes are safe', () => {
  assert.equal(watchSafety('df -h /Volumes/T7Projects').kind, 'allowed');
  assert.equal(watchSafety('docker system df').kind, 'allowed');
  assert.equal(watchSafety('docker system df -v').kind, 'allowed');
  assert.equal(watchSafety('docker system prune').kind, 'confirm');
  assert.equal(watchSafety('docker system df; rm -rf /tmp/x').kind, 'refused');
  assert.equal(watchSafety('docker system df && docker system prune').kind, 'confirm');
  assert.equal(watchSafety('sudo docker system df').kind, 'refused');
  assert.equal(watchSafety('docker system df $(touch /tmp/unsafe)').kind, 'refused');
  assert.equal(watchSafety('df -h /Volumes/T7Projects $(rm -rf /tmp/x)').kind, 'refused');
  assert.equal(watchSafety('df -h `touch /tmp/x`').kind, 'refused');
  assert.equal(watchSafety('docker system df > /tmp/report').kind, 'refused');
  assert.equal(watchSafety('df -h /tmp &').kind, 'refused');
  assert.equal(watchSafety('df -h /tmp <<EOF').kind, 'refused');
  assert.equal(watchSafety('df -h /tmp && date').kind, 'allowed');
});

test('/track reuses one current and previous snapshot, does not overlap manual refresh', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-track-'));
  const engine = new WatchTasks('/bin/sh');
  try {
    const task = engine.start('sleep 0.3; printf "sample\\n"', cwd, 2000,
      {kind: 'allowed', network: false, remote: false});
    engine.runNow(task.id);
    engine.runNow(task.id);
    await waitFor(() => task.runs === 1);
    assert.equal(task.runs, 1, 'manual refresh must not overlap a running sample');
    assert.equal(task.current?.output, 'sample\n');
    assert.equal(task.previous, undefined, 'no artificial previous sample');
    assert.equal(engine.active().length, 1);
    assert.match(stripAnsi(watchRow(task, Date.now())), /Track · sleep 0\.3.*updated/u);
    assert.deepEqual(watchPanelKey({selected: 0, output: true}, {kind: 'text', value: 'c'}, [task]),
      {kind: 'copy', id: task.id}, 'copy targets exactly the selected tracker');
    assert.match(stripAnsi(renderWatchPanel({selected: 0, output: true}, [task], 100, Date.now(), 20).join('\n')),
      /Latest completed output[\s\S]*sample/u);
    engine.runNow(task.id);
    await waitFor(() => task.runs === 2);
    assert.equal(task.current?.output, 'sample\n');
    assert.equal(task.previous?.output, 'sample\n');
    assert.equal(task.changes.length, 0);
    assert.ok(engine.pause(task.id));
    assert.equal(engine.scheduled, 0);
    assert.ok(engine.resume(task.id));
    assert.ok(engine.stop(task.id));
    assert.equal(engine.active().length, 0);
  } finally {
    engine.dispose();
    rmSync(cwd, {recursive: true, force: true});
  }
});

test('/track strips terminal control sequences from the displayed snapshot', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-track-controls-'));
  const engine = new WatchTasks('/bin/sh');
  try {
    const task = engine.start('printf "\\033]0;bad-title\\007alpha\\n\\033[31mbeta\\033[0m\\n"', cwd, 5000,
      {kind: 'allowed', network: false, remote: false});
    await waitFor(() => task.runs === 1);
    assert.equal(task.current?.exitCode, 0);
    assert.equal(task.current?.output, 'alpha\nbeta\n');
    assert.ok(engine.stop(task.id));
  } finally {
    engine.dispose();
    rmSync(cwd, {recursive: true, force: true});
  }
});

test('/track bounds retained snapshots, preserves split UTF-8 and records truncation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-track-bound-'));
  const engine = new WatchTasks('/bin/sh');
  try {
    const cmd = `node -e 'process.stdout.write("π"); process.stdout.write("x".repeat(250000))'`;
    const task = engine.start(cmd, cwd, 2000, {kind: 'allowed', network: false, remote: false});
    await waitFor(() => task.runs === 1);
    assert.equal(task.current?.exitCode, 0);
    assert.ok(task.current?.truncated, 'truncation is visible');
    assert.ok(Buffer.byteLength(task.current?.output ?? '') <= 200100, 'output is bounded');
    assert.ok(task.current?.output.startsWith('π'), 'UTF-8 survives split chunks');
    engine.stop(task.id);
  } finally {
    engine.dispose();
    rmSync(cwd, {recursive: true, force: true});
  }
});

test('/track caps concurrent trackers and rejects non-finite intervals', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-track-limit-'));
  const engine = new WatchTasks('/bin/sh');
  try {
    assert.throws(() => engine.start('true', cwd, Infinity, {kind: 'allowed', network: false, remote: false}), /interval/u);
    const active = Array.from({length: 8}, () =>
      engine.start('sleep 1', cwd, 5000, {kind: 'allowed', network: false, remote: false}));
    assert.equal(engine.active().length, 8);
    assert.throws(() => engine.start('true', cwd, 5000, {kind: 'allowed', network: false, remote: false}), /At most 8/u);
    for (const task of active) engine.stop(task.id);
    await waitFor(() => engine.scheduled === 0);
    assert.equal(engine.active().length, 0);
  } finally {
    engine.dispose();
    rmSync(cwd, {recursive: true, force: true});
  }
});
