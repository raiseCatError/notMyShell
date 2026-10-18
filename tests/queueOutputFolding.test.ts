import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {stripAnsi} from '../src/util/text.js';

function makeBuffer(outputFolding: 'never' | 'smart' | 'always' = 'never') {
  return new OutputBuffer(undefined, outputFolding);
}

test('queued output folding: successful queued command starts collapsed when foldQueued is true', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('git status', ['git status']);
  buffer.write('On branch dev\nnothing to commit\nworking tree clean\n');
  const record = buffer.complete(0, {queued: true, foldQueued: true});
  assert.ok(record);
  assert.equal(record.queued, true);
  assert.equal(record.expanded, false, 'successful queued command with output starts folded');
  assert.ok(record.output.includes('On branch dev'));
});

test('queued output folding: inline display (default) keeps successful queued command expanded', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('git status', ['git status']);
  buffer.write('On branch dev\nnothing to commit\nworking tree clean\n');
  const record = buffer.complete(0, {queued: true, foldQueued: false});
  assert.ok(record);
  assert.equal(record.queued, true);
  assert.equal(record.expanded, true, 'queued command stays expanded when foldQueued is false');
});

test('queued output folding: failed or interrupted queued command never folds', () => {
  const buffer = makeBuffer('always'); // even with global outputFolding: 'always'
  // Nonzero exit code
  buffer.beginCommand('make test', ['make test']);
  buffer.write('Error: assertion failed in test suite\nexit code 1\n');
  const failed = buffer.complete(1, {queued: true, foldQueued: true});
  assert.ok(failed);
  assert.equal(failed.queued, true);
  assert.equal(failed.expanded, true, 'failed queued command never folds, critical failure facts stay visible');

  // Interrupted command
  buffer.beginCommand('sleep 10', ['sleep 10']);
  buffer.write('^C\n');
  const interrupted = buffer.complete(130, {queued: true, foldQueued: true, interrupted: true});
  assert.ok(interrupted);
  assert.equal(interrupted.expanded, true, 'interrupted queued command never folds');
});

test('queued output folding: empty output (0 lines) never folds', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('true', ['true']);
  const record = buffer.complete(0, {queued: true, foldQueued: true});
  assert.ok(record);
  assert.equal(record.expanded, true, '0 lines of output has nothing to collapse');
});

test('queued output folding: holdOpen keeps block expanded while reader is scrolled or selecting', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('git log', ['git log']);
  buffer.write('commit 12345\nAuthor: test\n');
  const record = buffer.complete(0, {queued: true, foldQueued: true, holdOpen: true});
  assert.ok(record);
  assert.equal(record.expanded, true, 'never collapse under reader while selecting or scrolled back');
});

test('queued output folding: ordinary foreground command is unaffected by foldQueued setting', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('ls -la', ['ls -la']);
  buffer.write('total 0\n-rw-r--r-- 1 test staff 0 file.txt\n');
  const record = buffer.complete(0, {queued: false, foldQueued: true});
  assert.ok(record);
  assert.equal(record.queued, undefined);
  assert.equal(record.expanded, true, 'foreground command is not queued provenance');
});

test('queued output folding: complete 400+ line output, tabs, Unicode, and trailing newlines are verbatim', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('generate', ['generate']);
  const lines: string[] = [];
  for (let i = 0; i < 450; i++) {
    lines.push(`line ${i}\tcol2\t\u2714\u2718 Unicode test \u{1F680}`);
  }
  const fullText = lines.join('\n') + '\n';
  buffer.write(fullText);
  const record = buffer.complete(0, {queued: true, foldQueued: true});
  assert.ok(record);
  assert.equal(record.expanded, false);
  assert.equal(record.output.split('\n').length, 450);

  // Exact clipboard payload is identical and retains tabs and trailing newline
  const payload = serializeCopyPayload(record);
  assert.ok(payload.startsWith('line 0\tcol2\t\u2714\u2718'));
  assert.ok(payload.endsWith('\n'));
  assert.equal(payload.split('\n').filter(Boolean).length, 450);
});

test('queued output folding: reversible via toggleExpanded (Ctrl+O) without altering stored lines', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('npm test', ['npm test']);
  for (let i = 0; i < 20; i++) buffer.write(`test result line ${i}\n`);
  const record = buffer.complete(0, {queued: true, foldQueued: true});
  assert.ok(record);
  assert.equal(record.expanded, false);

  // When folded, transcript presenter includes fold hint
  let rows = buffer.wrapped(80).map(r => r.plain);
  assert.ok(rows.some(r => r.includes('hidden') && r.includes('Ctrl+O')));

  // Toggle expand (e.g. user pressed Ctrl+O)
  buffer.toggleExpanded(0);
  assert.equal(record.expanded, true);
  rows = buffer.wrapped(80).map(r => r.plain);
  assert.ok(rows.some(r => r.includes('test result line 19')));

  // Toggle back to fold
  buffer.toggleExpanded(0);
  assert.equal(record.expanded, false);
});

test('queued output folding: transcript snapshot and restore preserves folded state and queue provenance', () => {
  const buffer = makeBuffer('never');
  buffer.beginCommand('build', ['build']);
  buffer.write('step 1\nstep 2\nstep 3\n');
  const record = buffer.complete(0, {queued: true, foldQueued: true});
  assert.ok(record);
  assert.equal(record.expanded, false);
  assert.equal(record.queued, true);

  const snapshot = buffer.transcript();
  assert.equal(snapshot.records[0]?.expanded, false);
  assert.equal(snapshot.records[0]?.queued, true);

  const restored = makeBuffer('never');
  restored.restoreTranscript(snapshot);
  const restoredRecord = restored.recent(1);
  assert.ok(restoredRecord);
  assert.equal(restoredRecord.expanded, false);
  assert.equal(restoredRecord.queued, true);
  assert.equal(serializeCopyPayload(restoredRecord), serializeCopyPayload(record));
});

test('queued output folding: TerminalApp completed record receives queued folding based on configuration', () => {
  const app = new TerminalApp();
  app['promptConfiguration'] = normalizePromptConfiguration({queue: {outputDisplay: 'fold'}});
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});

  try {
    // Simulate a queued command finishing successfully
    app['running'] = {
      command: 'echo queued-test',
      startedAt: Date.now() - 500,
      interrupted: false,
      cleared: false,
      startId: 0,
      cwd: '/tmp',
      queued: true,
    };
    app['output'].beginCommand('echo queued-test', ['echo queued-test']);
    app['output'].write('hello from queue\nline 2\n');
    app['onShellPrompt'](0, '/tmp', Date.now());

    const completed = app['output'].recent(1);
    assert.ok(completed);
    assert.equal(completed.queued, true);
    assert.equal(completed.expanded, false, 'queued successful command started folded under outputDisplay: fold');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
