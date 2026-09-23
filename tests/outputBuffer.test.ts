import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {TapActivityObserver} from '../src/output/TapActivityObserver.js';
import {pageViewport, viewportStart} from '../src/output/viewport.js';

test('carriage returns update one line instead of appending progress frames', () => {
  const output = new OutputBuffer();
  output.beginCommand('progress', ['❯ progress']);
  output.write('10%\r20%\r100%\n');
  const completed = output.complete(0);
  assert.equal(completed?.output, '100%');
  assert.deepEqual(output.wrapped(80).map(row => row.plain), ['❯ progress', '100%']);
});

test('wraps long output to the viewport width', () => {
  const output = new OutputBuffer();
  output.beginCommand('print', ['❯ print']);
  output.write('abcdefgh');
  assert.deepEqual(output.wrapped(4).map(row => row.plain), ['❯ pr', 'int', 'abcd', 'efgh']);
});

test('transcript snapshot restores command details, fold state, and plain-text copy data', () => {
  const output = new OutputBuffer();
  output.beginCommand('printf hello', ['❯ printf hello']);
  output.write('\u001B[31mhello\u001B[0m\n');
  output.complete(0);
  output.setCompletionLifecycle('Completed · 0s');
  output.addHistoryLine('Completed · 0s');
  output.toggleExpanded(0);

  const snapshot = output.transcript();
  const restored = new OutputBuffer();
  restored.restoreTranscript(snapshot);
  assert.equal(restored.recent(1)?.command, 'printf hello');
  assert.equal(restored.recent(1)?.output, 'hello');
  assert.equal(restored.recent(1)?.expanded, false);
  assert.equal(restored.recent(1)?.lifecycleText, 'Completed · 0s');
  assert.equal(serializeCopyPayload(restored.recent(1)!), 'hello\nCompleted · 0s');
  assert.ok(restored.wrapped(80).some(row => row.isFoldHint));
});

test('only observed TAP v13 streams become secondary activities, with live and nested folding', () => {
  const output = new OutputBuffer();
  const observer = new TapActivityObserver();
  output.beginCommand('npm test', ['❯ npm test']);
  observer.reset(output.activeOutputStartId!);

  const first = '\u001B[36mTAP version 13\u001B[0m\n# Subtest: example\nok 1 - example\n1..1\n# tests 1\n# pass 1\n';
  output.write(first);
  output.setActiveActivities(observer.push(first, 1000));
  const liveRows = output.wrapped(100);
  const activeActivity = liveRows.find(row => row.isLiveActivity && row.plain.includes('TAP test stream'));
  assert.ok(activeActivity);
  assert.ok(liveRows.some(row => row.plain === '    ok 1 - example'), 'active TAP output remains visible under its activity');
  output.toggleActivityExpanded(activeActivity!.activityId!);
  assert.equal(output.wrapped(100).some(row => row.plain === '    ok 1 - example'), false, 'active detail can be collapsed independently');
  const continuation = 'ok 2 - follow-up\n';
  output.write(continuation);
  output.setActiveActivities(observer.push(continuation, 1050));
  assert.equal(output.wrapped(100).find(row => row.activityId === activeActivity!.activityId)?.plain.endsWith('›'), true, 'live expansion choice survives later PTY data');
  output.toggleActivityExpanded(activeActivity!.activityId!);

  const duration = '# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 8.2\n';
  output.write(duration);
  output.setActiveActivities(observer.push(duration, 1100));
  const completedActivities = observer.finish(1200);
  output.setActiveActivities(completedActivities);
  output.complete(0);
  output.setCompletionLifecycle('✓ Completed · 120 ms');
  output.addHistoryLine('✓ Completed · 120 ms');

  let rows = output.wrapped(100);
  const parentDisclosure = rows.find(row => row.isFoldHint && row.commandIndex === 0);
  assert.ok(parentDisclosure, 'parent lifecycle row discloses its activity details');
  assert.notEqual(parentDisclosure?.lineIndex, completedActivities[0]?.outputStartId, 'parent disclosure is on completion status, not an extra output row');
  assert.match(parentDisclosure?.plain ?? '', /›$/u);
  assert.equal(rows.some(row => row.activityId), false, 'completed child rows start nested inside the collapsed parent');
  output.toggleExpanded(0);
  rows = output.wrapped(100);
  assert.ok(rows.find(row => row.commandIndex === 0 && row.isFoldHint)?.plain.endsWith('⌄'));
  const childHint = rows.find(row => row.isFoldHint && row.activityId);
  assert.ok(childHint, 'completed child output auto-collapses and retains an independent disclosure');
  assert.equal(rows.some(row => row.plain === '    ok 1 - example'), false);
  assert.equal(childHint?.isLiveActivity, false, 'completed child activity is static');
  assert.match(childHint?.plain ?? '', /›$/u, 'collapsed disclosure sits inline after its summary');

  output.toggleActivityExpanded(childHint!.activityId!);
  rows = output.wrapped(100);
  assert.ok(rows.some(row => row.plain === '    ok 1 - example'), 'child can be expanded independently');
  assert.ok(rows.find(row => row.activityId === childHint!.activityId)?.plain.endsWith('⌄'));
  assert.equal(serializeCopyPayload(output.recent(1)!).includes('TAP test stream'), false, 'decorative activity is excluded from copy');
  assert.ok(serializeCopyPayload(output.recent(1)!).includes('ok 1 - example'), 'raw output remains in the parent copy payload');

  output.toggleExpanded(0);
  rows = output.wrapped(100);
  assert.equal(rows.some(row => row.activityId), false, 'collapsing the parent hides nested child rows');
  output.toggleExpanded(0);
  assert.ok(output.wrapped(100).some(row => row.activityId), 'expanding the parent reveals its child timeline');

  const restored = new OutputBuffer();
  restored.restoreTranscript(output.transcript());
  assert.deepEqual(restored.recent(1)?.activities, output.recent(1)?.activities, 'semantic activity survives transcript persistence');
});

test('TAP activity observer does not infer children from command names or retain incomplete stream ranges', () => {
  const observer = new TapActivityObserver();
  observer.reset(4);
  assert.deepEqual(observer.push('npm run test\n> node --test\nnot TAP\n', 1000), []);

  observer.reset(4);
  const incomplete = observer.push('TAP version 13\n# tests 1\n# pass 1\n', 1000);
  assert.equal(incomplete.length, 1, 'the protocol header is a live observable activity');
  assert.deepEqual(observer.finish(1100), [], 'an incomplete stream without a safe terminal boundary is not persisted as a child');

  observer.reset(4);
  observer.push('TAP version 13\n', 1200);
  assert.deepEqual(observer.push('\u001B[2J', 1300), [], 'screen clears invalidate line ownership when parser coordinates are reset');
});

test('historical context stays frozen per command, uses muted dividers, and survives transcript restore', () => {
  const output = new OutputBuffer();
  output.beginCommand('pwd', ['❯ pwd'], undefined, {cwd: '/Users/test/project', project: 'project', branch: 'dev'});
  output.write('/Users/test/project\n');
  output.complete(0);
  output.setCompletionLifecycle('Completed · 7 ms');
  output.addHistoryLine('Completed · 7 ms');
  output.beginCommand('cd /tmp', ['❯ cd /tmp'], undefined, {cwd: '/tmp'});
  output.complete(0);

  const rows = output.wrapped(80);
  const headers = rows.filter(row => row.isHistoricalHeader);
  assert.equal(headers.length, 2);
  assert.ok(rows.findIndex(row => row === headers[1]) > rows.findIndex(row => row.plain === ''));
  assert.match(headers[0]?.plain ?? '', / project   \/Users\/test\/project    dev ▓▒░/u);
  assert.match(headers[1]?.plain ?? '', /^ \/tmp ▓▒░ /u);
  assert.match(headers[0]?.ansi ?? '', /48;2;82;73;111m/u, 'archived project uses the muted lavender palette');
  assert.match(headers[0]?.ansi ?? '', /38;2;162;151;190m─/u, 'divider is one solid pastel lavender color');
  assert.doesNotMatch(headers[0]?.ansi ?? '', /48;2;(?:52;105;98|72;152;100|194;98;99)m/u);
  assert.equal(serializeCopyPayload(output.recent(2)!), '/Users/test/project\nCompleted · 7 ms');
  assert.equal(output.recent(2)?.historicalContext?.branch, 'dev');

  const restored = new OutputBuffer();
  restored.restoreTranscript(output.transcript());
  const restoredHeaders = restored.wrapped(80).filter(row => row.isHistoricalHeader);
  assert.deepEqual(restoredHeaders.map(row => row.plain.split(' ─')[0]), headers.map(row => row.plain.split(' ─')[0]));
  assert.ok(restored.wrapped(12).filter(row => row.isHistoricalHeader).every(row => row.plain.length <= 12));
});

test('historical header stays visible for folded output and older transcript records remain compatible', () => {
  const output = new OutputBuffer();
  output.beginCommand('many', ['❯ many'], undefined, {cwd: '/tmp/folded', branch: 'work'});
  output.write(`${Array.from({length: 12}, (_, index) => `line ${index}`).join('\n')}\n`);
  output.complete(0);
  let rows = output.wrapped(80);
  assert.equal(rows.find(row => row.isFoldHint)?.plain, '12 lines hidden · Ctrl+O  ›');
  output.toggleExpanded(0);

  rows = output.wrapped(80);
  assert.equal(rows.find(row => row.isFoldHint)?.plain, '12 lines shown · Ctrl+O  ⌄');
  assert.equal(rows.filter(row => row.isHistoricalHeader).length, 1);
  assert.ok(rows.findIndex(row => row.isHistoricalHeader) < rows.findIndex(row => row.isFoldHint));

  const olderTranscript = output.transcript();
  olderTranscript.records = olderTranscript.records.map(({historicalContext: _context, ...record}) => record);
  const restored = new OutputBuffer();
  restored.restoreTranscript(olderTranscript);
  assert.equal(restored.wrapped(80).filter(row => row.isHistoricalHeader).length, 0);
});

test('viewport follows latest until paged upward', () => {
  assert.equal(viewportStart(100, 20, true, 0), 80);
  const up = pageViewport(100, 20, 80, -1);
  assert.deepEqual(up, {start: 62, follow: false});
  assert.equal(viewportStart(110, 20, false, up.start), 62);
  assert.deepEqual(pageViewport(100, 20, 79, 1), {start: 80, follow: true});
});

test('clear sequence (2J/3J) triggers onClear callback, 0J/1J do not', () => {
  let clears = 0;
  const output = new OutputBuffer(() => { clears++; });
  output.beginCommand('foo', ['foo']);
  output.write('hello');
  
  // 0J (erase down) should not clear
  output.write('\u001B[0J');
  assert.equal(clears, 0);

  // 1J (erase up) should not clear
  output.write('\u001B[1J');
  assert.equal(clears, 0);

  // 2J (erase screen) should clear
  output.write('\u001B[2J');
  assert.equal(clears, 1);

  // 3J (erase scrollback) should clear
  output.write('\u001B[3J');
  assert.equal(clears, 2);
});
