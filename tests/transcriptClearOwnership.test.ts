import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, serializeCopyPayload, type OutputTranscript} from '../src/output/OutputBuffer.js';
import type {WrappedRow} from '../src/output/viewport.js';

const PACKAGES = ['com.google.android.gms', 'com.google.android.gsf', 'PrebuiltGmsCorePi', 'WallpaperPickerGooglePrebuilt', 'com.android.vending'];
const lines = (count: number, prefix = 'line') => Array.from({length: count}, (_, index) => `${prefix} ${index + 1}\r\n`).join('');

/** One shell command as the app records it: header, output, completion row. */
function run(output: OutputBuffer, command: string, data: string, header = [`❯ ${command}`]): void {
  output.beginCommand(command, header);
  output.write(data);
  output.complete(0);
  output.setCompletionLifecycle('✔ Completed · 0.1s');
  output.addHistoryLine('✔ Completed · 0.1s');
}

/**
 * Every fold row sits directly under its own block (after the command rows, or after the head it keeps), and no
 * block's rows are interleaved with another block's: what the screenshots showed broken.
 */
function assertFoldRowsOwned(output: OutputBuffer, rows: readonly WrappedRow[]): void {
  const records = output.view().completed;
  rows.forEach((row, index) => {
    if (!row.isFoldHint || row.commandIndex === undefined) return;
    const record = records[row.commandIndex]!;
    const previous = rows[index - 1];
    assert.ok(previous, `fold row "${row.plain.trim()}" has a row above it`);
    assert.ok(previous.lineIndex !== undefined && previous.lineIndex >= record.startId && previous.lineIndex < record.endId!,
      `fold row "${row.plain.trim()}" sits under its own block (above it: line ${previous.lineIndex}, "${previous.plain.trim()}")`);
  });
  const order = rows.filter(row => row.blockStartId !== undefined).map(row => row.blockStartId!);
  const seen = new Set<number>();
  order.forEach((block, index) => {
    if (index > 0 && order[index - 1] !== block) assert.ok(!seen.has(block), `block ${block} is interrupted by another block`);
    seen.add(block);
  });
}

/** The sequence from the report: a long command, a screen clear, adb with five lines, then /copy. */
function reportedSequence(): OutputBuffer {
  const output = new OutputBuffer();
  run(output, 'python3 scan.py', lines(15));
  run(output, 'clear', '\u001B[H\u001B[2J\u001B[3J');
  run(output, 'adb shell pm list packages | grep -i google', PACKAGES.map(name => `${name}\r\n`).join(''));
  output.addFrontendInteraction('/copy', 'Copied 5 lines to the clipboard.');
  return output;
}

test('a screen clear retires the blocks whose lines it removed: no fold row lands inside the next command', () => {
  const output = reportedSequence();
  const rows = output.wrapped(80);
  const plain = rows.map(row => row.plain.trimEnd());
  const first = plain.indexOf(PACKAGES[0]!);
  assert.deepEqual(plain.slice(first, first + 5), PACKAGES, 'the five packages are drawn together');
  assert.equal(rows.filter(row => row.isFoldHint).length, 0, 'five lines need no fold row, and the pre-clear block left none behind');
  assert.deepEqual(output.view().completed.map(record => record.command), ['adb shell pm list packages | grep -i google', 'clear']);
  assertFoldRowsOwned(output, rows);
});

test('repeated Ctrl+O after /copy folds only the adb block, keeps its rows together and leaves /copy alone', () => {
  const output = reportedSequence();
  const adb = output.recentShell(1)!;
  for (let press = 1; press <= 6; press += 1) {
    output.toggleMostRelevant();
    const rows = output.wrapped(80);
    const plain = rows.map(row => row.plain.trimEnd());
    assertFoldRowsOwned(output, rows);
    const hint = rows.findIndex(row => row.isFoldHint);
    if (press % 2 === 1) {
      assert.equal(adb.expanded, false);
      assert.ok(hint > 0 && rows[hint - 1]!.plain.includes('adb shell'), 'the collapsed row sits right under the adb command');
      assert.ok(!PACKAGES.some(name => plain.includes(name)), 'collapsed, its output is hidden');
    } else {
      assert.equal(adb.expanded, true);
      const first = plain.indexOf(PACKAGES[0]!);
      assert.deepEqual(plain.slice(first, first + 5), PACKAGES);
    }
    const copy = plain.indexOf('❯ /copy');
    assert.ok(copy > hint, 'the /copy confirmation stays below the adb block');
    assert.ok(!rows.slice(copy).some(row => row.isFoldHint), 'no fold row is drawn under /copy');
  }
  assert.equal(serializeCopyPayload(output.recentShell(1)!), PACKAGES.join('\n'), '/copy still copies exactly the output');
});

test('a command that clears the screen owns what it writes afterwards: rows, fold and /copy payload', () => {
  const output = new OutputBuffer();
  run(output, 'seq 30', lines(30));
  output.beginCommand('tmux attach', ['❯ tmux attach']);
  output.write(`before\r\n\u001B[2J\u001B[3J${lines(14, 'after')}`);
  const record = output.complete(0)!;
  assert.deepEqual([record.startId, record.outputStartId, record.endId], [0, 0, 14]);
  assert.equal(record.output, lines(14, 'after').trimEnd().replaceAll('\r\n', '\n'));
  assert.deepEqual(output.view().completed.map(item => item.command), ['tmux attach']);
  const rows = output.wrapped(80);
  assert.equal(rows[0]!.plain.trim(), '14 lines shown · Ctrl+O  ⌄');
  output.toggleMostRelevant();
  const folded = output.wrapped(80);
  assert.equal(folded.filter(row => row.isFoldHint).length, 1);
  assert.ok(folded.every(row => row.blockStartId === undefined || row.blockStartId === 0));
});

test('fold toggles from before a clear never apply to the block that reuses its line ids', () => {
  const output = new OutputBuffer();
  run(output, 'seq 15', lines(15));
  output.toggleMostRelevant();
  output.toggleMostRelevant();
  // The app draws no completion row for a command that cleared the screen, so the next block starts at line 0 again.
  output.beginCommand('clear', ['❯ clear']);
  output.write('\u001B[2J');
  output.complete(0);
  run(output, 'seq 20', lines(20));
  const record = output.recentShell(1)!;
  assert.equal(record.startId, 0, 'the new block reuses the line id of the toggled one');
  assert.equal(output.applyAdvisoryFold(record.startId, true), true, 'the new block was never toggled by the user');
});

test('long wrapped commands, consecutive folded blocks and narrow widths keep every fold row with its own block', () => {
  for (const width of [80, 32, 18]) {
    const output = new OutputBuffer();
    const long = `printf '%s\\n' ${'segment '.repeat(12)}| sed -n '1,40p'`;
    run(output, long, lines(15, 'a'), [`❯ ${long.slice(0, 40)}`, `  ${long.slice(40)}`]);
    run(output, 'clear', '\u001B[2J\u001B[3J');
    run(output, long, lines(18, 'b'), [`❯ ${long.slice(0, 40)}`, `  ${long.slice(40)}`]);
    run(output, 'seq 12', lines(12, 'c'));
    output.addFrontendInteraction('/copy', 'Copied 12 lines to the clipboard.');
    run(output, 'printf five', lines(5, 'd'));
    for (let index = 0; index < 3; index += 1) {
      output.toggleExpanded(index);
      assertFoldRowsOwned(output, output.wrapped(width));
      output.toggleExpanded(index);
      assertFoldRowsOwned(output, output.wrapped(width));
    }
    assert.equal(output.view().completed.length, 4, `width ${width}: the pre-clear block is gone`);
  }
});

test('a restored transcript drops records whose lines a clear removed before this fix', () => {
  const fresh = reportedSequence();
  const saved = fresh.transcript();
  // What an older NMSh saved: the pre-clear blocks kept their line ids, and the clear's own record ended before it began.
  const stale: OutputTranscript = {...saved, records: [
    ...saved.records.filter(record => record.command !== 'clear'),
    {command: 'clear', output: '', lifecycleText: '', exitCode: 0, startId: 17, outputStartId: 18, endId: 0, expanded: true},
    {command: 'python3 scan.py', output: lines(15).trimEnd(), lifecycleText: '', exitCode: 0, startId: 0, outputStartId: 1, endId: 16, expanded: true},
  ]};
  const restored = new OutputBuffer();
  restored.restoreTranscript(stale);
  assert.deepEqual(restored.view().completed.map(record => record.command), ['adb shell pm list packages | grep -i google']);
  for (let press = 0; press < 4; press += 1) {
    assertFoldRowsOwned(restored, restored.wrapped(80));
    assertFoldRowsOwned(restored, restored.wrapped(24));
    restored.toggleMostRelevant();
  }
  assert.equal(serializeCopyPayload(restored.recentShell(1)!), PACKAGES.join('\n'));

  const roundTrip = new OutputBuffer();
  roundTrip.restoreTranscript(saved);
  assert.deepEqual(roundTrip.wrapped(80).map(row => row.plain), fresh.wrapped(80).map(row => row.plain), 'a current transcript restores as drawn');
});

test('legacy repair checks ownership, not just bounds: an in-range stale record and everything older are dropped', () => {
  // After a clear, NMSh notices filled lines 0-1 and a command began at 2; a pre-clear record [0, 1, 2) fits the bounds.
  const output = new OutputBuffer();
  output.addFrontendInteraction('/notices', 'Nothing new.');
  run(output, 'printf done', 'done\r\n');
  const saved = output.transcript();
  const staleInRange = {command: 'echo before', output: 'before', lifecycleText: '', exitCode: 0, startId: 0, outputStartId: 1, endId: 2, expanded: true};
  const olderValidLooking = {command: 'true', output: '', lifecycleText: '', exitCode: 0, startId: 0, outputStartId: 0, endId: 0, expanded: true};
  const restored = new OutputBuffer();
  restored.restoreTranscript({...saved, records: [...saved.records, staleInRange, olderValidLooking]});
  assert.deepEqual(restored.view().completed.map(record => record.command), ['printf done'],
    'the stale record\'s header is an NMSh line, so it and every older record go');
  assert.equal(restored.view().ownerOf(1), undefined, 'the notice line is attributed to no command');

  // Header lines that are command lines but text that is not the record's output: also stale.
  const twice = new OutputBuffer();
  run(twice, 'seq 3', lines(3));
  const copy = twice.transcript();
  const restoredTwice = new OutputBuffer();
  restoredTwice.restoreTranscript({...copy, records: copy.records.map(record => ({...record, output: 'something else'}))});
  assert.equal(restoredTwice.view().completed.length, 0);
});

test('legacy repair keeps genuine records: Ask blocks with blank rows, cleared commands and folded blocks', () => {
  const output = new OutputBuffer();
  output.addAskInteraction('what is this', [{role: 'you', text: 'what is this'}, {role: 'ask', text: 'first\n\nsecond'}, {role: 'you', text: 'more'}, {role: 'ask', text: 'ok'}]);
  run(output, 'seq 15', lines(15));
  output.toggleExpanded(0);
  output.beginCommand('clear-and-print', ['❯ clear-and-print']);
  output.write(`\u001B[2J${lines(3, 'kept')}`);
  output.complete(0);
  run(output, 'seq 12', lines(12));
  const saved = output.transcript();
  const restored = new OutputBuffer();
  restored.restoreTranscript(saved);
  assert.deepEqual(restored.view().completed.map(record => record.command), ['seq 12', 'clear-and-print']);
  assert.deepEqual(restored.wrapped(60).map(row => row.plain), output.wrapped(60).map(row => row.plain));

  const ask = new OutputBuffer();
  ask.addAskInteraction('what is this', [{role: 'you', text: 'what is this'}, {role: 'ask', text: 'first\n\nsecond'}, {role: 'you', text: 'more'}, {role: 'ask', text: 'ok'}]);
  run(ask, 'seq 15', lines(15));
  const askRestored = new OutputBuffer();
  askRestored.restoreTranscript(ask.transcript());
  assert.deepEqual(askRestored.view().completed.map(record => record.command), ['seq 15', '/btw what is this'],
    'trailing blanks on an Ask row are not a mismatch');
});

test('a reattached running command whose journal predates the clear rule owns the stored lines, and older records go', () => {
  const output = new OutputBuffer();
  run(output, 'seq 3', lines(3));
  // What an older NMSh journaled: the running command kept its pre-clear start (line 6) after its clear emptied the lines.
  const transcript: OutputTranscript = {...output.transcript(), lines: [], lineTypes: [], visualGaps: []};
  const after = new OutputBuffer();
  after.write(lines(2, 'post'));
  after.write('');
  const restored = new OutputBuffer();
  restored.restoreTranscript({...transcript, lines: after.transcript().lines});
  assert.deepEqual(restored.resumeActive('tmux', 6, 7), {cleared: true});
  restored.write(lines(1, 'more'));
  const record = restored.complete(0)!;
  assert.deepEqual([record.startId, record.outputStartId, record.endId], [0, 0, 3]);
  assert.equal(record.output, 'post 1\npost 2\nmore 1');
  assert.deepEqual(restored.view().completed.map(item => item.command), ['tmux']);

  const intact = new OutputBuffer();
  run(intact, 'seq 3', lines(3));
  intact.beginCommand('sleep 5', ['❯ sleep 5']);
  const live = intact.transcript();
  const reattached = new OutputBuffer();
  reattached.restoreTranscript(live);
  assert.deepEqual(reattached.resumeActive('sleep 5', intact.activeStartId!, intact.activeOutputStartId!), {cleared: false});
  assert.deepEqual(reattached.view().completed.map(item => item.command), ['seq 3'], 'a valid running block keeps the records before it');
});

test('alternate-screen programs, partial erases and progress redraws keep every record', () => {
  const cases: Array<[string, string]> = [
    ['full-screen program clearing its own screen', '\u001B[?1049h\u001B[2J\u001B[Hediting\u001B[3J\u001B[?1049l'],
    ['erase below and above the cursor', 'one\r\ntwo\u001B[J\u001B[0J\u001B[1J\r\n'],
    ['erase in line', 'status\u001B[K\r\u001B[2Kdone\r\n'],
    ['progress redraw', '10%\r50%\r100%\r\n'],
    ['cursor moves', 'a\u001B[3Gb\u001B[2Dc\u001B[1Cd\r\n'],
  ];
  for (const [name, data] of cases) {
    const output = new OutputBuffer();
    run(output, 'seq 15', lines(15));
    run(output, 'printf ok', 'ok\r\n');
    run(output, name, data);
    assert.deepEqual(output.view().completed.map(record => record.command), [name, 'printf ok', 'seq 15'], name);
    assert.equal(output.recentShell(3)?.output, lines(15).trimEnd().replaceAll('\r\n', '\n'), `${name}: earlier output is intact`);
    assertFoldRowsOwned(output, output.wrapped(80));
  }
});
