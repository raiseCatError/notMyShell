import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {parseWatch, watchSafety, WatchTasks, MIN_LOCAL_MS} from '../src/tasks/WatchTasks.js';
import {renderWatchPanel, watchNoticeRows, watchPanelKey, watchRow} from '../src/tasks/WatchPanel.js';
import {setIconStyle} from '../src/ui/glyphs.js';
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

test('/track shares the /watch scheduler and parser; it is flagged for its transcript block', () => {
  assert.deepEqual(parseSlashCommand('/track df -h /Volumes/T7Projects'),
    {kind: 'watch', op: 'start', arguments: 'df -h /Volumes/T7Projects', track: true});
  assert.deepEqual(parseSlashCommand('/track --every 5s -- docker system df'),
    {kind: 'watch', op: 'start', arguments: '--every 5s -- docker system df', track: true});
  for (const text of ['/track', '/track list']) {
    assert.deepEqual(parseSlashCommand(text), {kind: 'watch', op: 'list', arguments: '', track: true});
  }
  assert.deepEqual(parseSlashCommand('/track refresh 2'), {kind: 'watch', op: 'now', arguments: '2', track: true});
  assert.deepEqual(parseSlashCommand('/track pause'), {kind: 'watch', op: 'pause', arguments: '', track: true});
  assert.deepEqual(parseSlashCommand('/track resume 1'), {kind: 'watch', op: 'resume', arguments: '1', track: true});
  assert.deepEqual(parseSlashCommand('/track stop all'), {kind: 'watch', op: 'stop', arguments: 'all', track: true});
  assert.deepEqual(parseSlashCommand('/watch stop 2'), {kind: 'watch', op: 'stop', arguments: '2'},
    'existing /watch commands must remain compatible');
  assert.deepEqual(parseSlashCommand('/track copy 2'), {kind: 'watch', op: 'copy', arguments: '2', track: true});
  assert.deepEqual(parseSlashCommand('/watch copy'), {kind: 'watch', op: 'start', arguments: 'copy'}, 'copy is a /track word only');
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
    assert.equal(engine.runNow(task.id), false, 'a running sample refuses concurrent refresh');
    assert.equal(engine.runNow(task.id), false);
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
    assert.equal(engine.runNow(task.id), true, 'refresh begins after completion');
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

test('/track emits a live refresh-start event before the sample completes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-track-refresh-'));
  const engine = new WatchTasks('/bin/sh');
  try {
    const task = engine.start('sleep 0.2; printf "ready\\n"', cwd, 5000,
      {kind: 'allowed', network: false, remote: false});
    await waitFor(() => task.runs === 1);
    let notifiedWhileSampling = false;
    const unsubscribe = engine.onChange(changed => {
      if (changed.id === task.id && engine.sampling(task.id)) notifiedWhileSampling = true;
    });
    assert.equal(engine.runNow(task.id), true);
    assert.equal(notifiedWhileSampling, true, 'presenter is notified during refresh');
    await waitFor(() => task.runs === 2);
    unsubscribe();
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

test('/track fails visibly when the command or working directory is unavailable', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-track-fallback-'));
  const engine = new WatchTasks('/bin/sh');
  try {
    const missingCommand = engine.start('nmsh-nonexistent-test-command-393', cwd, 5000,
      {kind: 'allowed', network: false, remote: false});
    await waitFor(() => missingCommand.runs === 1);
    assert.notEqual(missingCommand.current?.exitCode, 0);
    const missingCwd = engine.start('true', join(cwd, 'not-here'), 5000,
      {kind: 'allowed', network: false, remote: false});
    await waitFor(() => missingCwd.runs === 1);
    assert.notEqual(missingCwd.current?.exitCode, 0, 'invalid cwd cannot be a successful refresh');
    assert.equal(missingCwd.current?.error, `the directory ${join(cwd, 'not-here')} is no longer available`, 'names the directory, not the shell');
    assert.equal(engine.active().length, 2);
  } finally {
    engine.dispose();
    rmSync(cwd, {recursive: true, force: true});
  }
});

test('/track ends what a sample leaves in its process group: after stop, and after a sample that finished', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-track-orphans-'));
  const engine = new WatchTasks('/bin/sh');
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // A child that ignores TERM and closes its output: the shell that started it can end while it keeps running.
  const stubborn = (name: string) => `sh -c 'trap "" TERM; echo $$ > ${name}; exec >/dev/null 2>&1; exec sleep 30'`;
  const pidOf = async (name: string) => {
    let pid = 0;
    await waitFor(() => { try { pid = Number(readFileSync(join(cwd, name), 'utf8').trim()); } catch { /* not yet */ } return pid > 0; });
    return pid;
  };
  try {
    const stopped = engine.start(`${stubborn('stopped.pid')}; echo done`, cwd, 5000, {kind: 'allowed', network: false, remote: false});
    const stoppedPid = await pidOf('stopped.pid');
    assert.ok(alive(stoppedPid));
    assert.equal(engine.stop(stopped.id), true);
    await waitFor(() => !alive(stoppedPid), 6000);

    const finished = engine.start(`${stubborn('finished.pid')} & echo started`, cwd, 5000, {kind: 'allowed', network: false, remote: false});
    await waitFor(() => finished.runs === 1, 6000);
    assert.match(finished.current?.output ?? '', /started/u);
    assert.equal(finished.current?.exitCode, 0, 'the sample itself finished normally');
    const finishedPid = await pidOf('finished.pid');
    await waitFor(() => !alive(finishedPid), 6000);
  } finally {
    engine.dispose();
    rmSync(cwd, {recursive: true, force: true});
  }
});

test('/track confirmation refuses clipped small-terminal review', () => {
  const confirm = {command: 'unknown status-command', cwd: '/tmp', intervalMs: 5000, reason: 'Unknown command', choice: 'no' as const};
  const rows = renderWatchPanel({selected: 0, output: false, confirm}, [], 30, Date.now(), 6);
  const text = stripAnsi(rows.join('\n'));
  assert.match(text, /Resize to review tracked/u);
  assert.doesNotMatch(text, /Yes|confirm/u, 'clipped layouts cannot display approval controls');
});

// ---- v0.21: the live transcript block ------------------------------------------------------------------------------

import {finalResultRows, MAX_TRACK_ROWS, trackBlockRows, trackStatus} from '../src/tasks/trackBlock.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {logicalLines} from '../src/output/TranscriptSearch.js';
import type {WatchTask} from '../src/tasks/WatchTasks.js';

const task = (overrides: Partial<WatchTask> = {}): WatchTask => ({id: 'watch-x', command: 'df -h', cwd: '/', intervalMs: 5000, startedAt: 0, runs: 0,
  status: 'running', changes: [], network: false, ...overrides});
const run = (output: string, extra: Partial<NonNullable<WatchTask['current']>> = {}) => ({output, exitCode: 0, at: 1_000, durationMs: 100, ...extra});

test('track status says only what is known: pending, live, failed, timed out, paused, stale, refreshing, stopped', () => {
  const plain = (watch: WatchTask, now = 2_000, sampling = false) => stripAnsi(trackStatus(watch, now, sampling));
  assert.match(plain(task()), /^◌ first run pending · every 5s · 0 runs$/u);
  assert.match(plain(task(), 2_000, true), /first run…/u);
  assert.match(plain(task({current: run('ok'), runs: 1})), /^◉ live · every 5s · updated \d\d:\d\d:\d\d · exit 0 · 1 run$/u);
  assert.match(plain(task({current: run('no', {exitCode: 2}), runs: 3})), /exit 2/u);
  assert.match(plain(task({current: run('', {timedOut: true, exitCode: null, durationMs: 15_000}), runs: 1})), /timed out after 15s/u);
  assert.match(plain(task({current: run('ok'), status: 'paused', runs: 1})), /^‖ paused/u);
  assert.match(plain(task({current: run('ok'), runs: 1}), 1_000 + 100 + 16_000), /no new result for 16s/u);
  assert.match(plain(task({current: run('ok'), runs: 1}), 2_000, true), /refreshing…/u);
  assert.match(plain(task({current: run('ok', {truncated: true}), runs: 1})), /output cut at 200 kB/u);
  assert.match(plain(task({current: run('ok'), status: 'stopped', runs: 4})), /^■ stopped/u);
  setIconStyle('safe');
  try {
    assert.match(plain(task()), /^o first run pending/u, 'Safe glyphs: ASCII marks');
    assert.match(plain(task({current: run('ok'), runs: 1})), /^\* live/u);
    assert.match(plain(task({current: run('ok'), status: 'paused', runs: 1})), /^= paused/u);
    assert.match(plain(task({current: run('ok'), status: 'stopped', runs: 4})), /^# stopped/u);
    assert.match(stripAnsi(watchRow(task({current: run('ok'), status: 'paused', runs: 1}), 2_000)), /^= Track/u);
  } finally { setIconStyle('nerd'); }
});

test('the live result keeps a stable height: shorter results pad, longer ones say how much is not shown; text is inert', () => {
  const first = trackBlockRows(task({current: run('a\nb\nc\n'), runs: 1}), 80, 2_000, 0);
  assert.equal(first.reserved, 3);
  assert.deepEqual(first.rows.slice(1).map(row => stripAnsi(row)), ['    a', '    b', '    c']);
  const shorter = trackBlockRows(task({current: run('a\n'), runs: 2}), 80, 2_000, first.reserved);
  assert.equal(shorter.rows.length, first.rows.length, 'a shorter refresh never moves what is below');
  const long = trackBlockRows(task({current: run(Array.from({length: 40}, (_, index) => `line ${index}`).join('\n')), runs: 3}), 80, 2_000, shorter.reserved);
  assert.equal(long.reserved, MAX_TRACK_ROWS);
  assert.match(stripAnsi(long.rows.at(-1)!), /… 29 more lines · \/track copy copies them all/u);
  const hostile = trackBlockRows(task({current: run('\u001b[2Jclear\u202e!'), runs: 1}), 20, 2_000, 0);
  assert.doesNotMatch(hostile.rows.join(''), /\u001b\[2J|\u202e/u);
  for (const row of hostile.rows) assert.ok(stripAnsi(row).length <= 20);
  assert.deepEqual(finalResultRows(task({current: run(Array.from({length: 5}, (_, index) => `${index}`).join('\n')), runs: 2}), 3).slice(1),
    ['0', '1', '2', '… 2 more lines were not kept']);
});

test('the block: stored lines once, live rows replaced in place under them, never stored or searched', () => {
  const buffer = new OutputBuffer();
  let watch = task({current: run('first\n'), runs: 1});
  let reserved = 0;
  buffer.setLiveRows((id, width) => { const drawn = trackBlockRows(id === 'watch-x' ? watch : undefined, width, 2_000, reserved); reserved = drawn.reserved; return drawn.rows; });
  const anchor = buffer.addTrackBlock('watch-x', '/track df -h', ['⎿ Tracking df -h here']);
  const stored = JSON.stringify(buffer.transcript().lines);
  const before = buffer.wrapped(80);
  const live = before.filter(row => row.derived);
  assert.deepEqual(live.map(row => row.plain.trim()).slice(1), ['first']);
  assert.ok(live.every(row => row.lineIndex === anchor));
  watch = task({current: run('second\n'), runs: 2});
  const after = buffer.wrapped(80);
  assert.equal(after.length, before.length, 'one block, replaced in place');
  assert.deepEqual(after.filter(row => row.derived).map(row => row.plain.trim()).slice(1), ['second']);
  assert.equal(JSON.stringify(buffer.transcript().lines), stored, 'refreshes store nothing');
  assert.equal(logicalLines(after).some(line => line.text.includes('second')), false, 'find never matches the live result');
  buffer.clearPresentation();
  assert.equal(buffer.wrapped(80).some(row => row.derived), false);
});

test('above the composer: one row per tracker for up to two, then one summary row', () => {
  const one = task({current: run('ok'), runs: 1});
  const failing = task({id: 'w2', current: run('no', {exitCode: 2}), runs: 1});
  const paused = task({id: 'w3', current: run('ok'), status: 'paused', runs: 1});
  assert.equal(watchNoticeRows([one, failing], 2_000).length, 2);
  const summary = watchNoticeRows([one, failing, paused, task({id: 'w4'})], 2_000);
  assert.equal(summary.length, 1);
  assert.equal(stripAnsi(summary[0]!), '◉ 4 trackers · 1 failing · 1 paused · /track opens the manager');
  assert.deepEqual(watchNoticeRows([], 2_000), []);
});
