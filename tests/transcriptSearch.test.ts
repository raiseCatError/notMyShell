import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOutputFilter, compileQuery, createFind, findInRows, findStatus, parseSearchArguments, refreshFind, revealStart, stepFind} from '../src/output/TranscriptSearch.js';
import type {WrappedRow} from '../src/output/viewport.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';

const row = (plain: string, extra: Partial<WrappedRow> = {}): WrappedRow => ({ansi: plain, plain, ...extra});

test('find: plain, case, regex, zero matches, invalid regex, next/previous wrap from the newest', () => {
  const rows = [row('Error one'), row('all good'), row('error two error'), row('ERROR three')];
  assert.equal(findInRows(rows, compileQuery('error', {regex: false, caseSensitive: false}), 'transcript').length, 4);
  assert.equal(findInRows(rows, compileQuery('error', {regex: false, caseSensitive: true}), 'transcript').length, 2);
  assert.deepEqual(findInRows(rows, compileQuery('e\\w+r \\w+', {regex: true, caseSensitive: false}), 'transcript').map(match => match.row), [0, 2, 3]);
  assert.equal(findInRows(rows, compileQuery('zzz', {regex: false, caseSensitive: false}), 'transcript').length, 0);
  const bad = compileQuery('(', {regex: true, caseSensitive: false});
  assert.equal(bad.ok, false);
  assert.equal(findInRows(rows, compileQuery('x*', {regex: true, caseSensitive: false}), 'transcript').length, 0, 'empty matches never count');

  const state = createFind('error');
  refreshFind(state, rows, 'g1');
  assert.equal(state.active, 3, 'starts at the newest match');
  assert.match(findStatus(state), /^4\/4 matches · regex off · case off$/u);
  assert.equal(stepFind(state, 'next')?.row, 2, 'next goes older');
  assert.equal(stepFind(state, 'previous')?.row, 3);
  assert.equal(stepFind(state, 'previous')?.row, 0, 'wraps');
  const sameMatches = state.matches;
  refreshFind(state, rows, 'g1');
  assert.equal(state.matches, sameMatches, 'no recompute for the same generation');
  state.query = '(';
  state.options.regex = true;
  refreshFind(state, rows, 'g1');
  assert.match(findStatus(state), /^invalid regex/u);
  assert.equal(revealStart(90, 100, 30), 70);
  assert.equal(revealStart(2, 100, 30), 0);
});

test('find scope: block scope only searches that block; filter hint rows are never matches', () => {
  const rows = [row('$ a', {blockStartId: 1, lineIndex: 1}), row('needle', {blockStartId: 1, lineIndex: 2}),
    row('$ b', {blockStartId: 3, lineIndex: 3}), row('needle', {blockStartId: 3, lineIndex: 4}), row('needle hint', {blockStartId: 3, isFilterHint: true})];
  assert.deepEqual(findInRows(rows, compileQuery('needle', {regex: false, caseSensitive: false}), 'block', 3).map(match => match.row), [3]);
});

test('filter: one block only, invert, context, wrapped lines together, hint row, command boundaries kept', () => {
  const rows = [
    row('$ npm test', {blockStartId: 10, lineIndex: 10}),
    row('PASS a', {blockStartId: 10, lineIndex: 11}),
    row('FAIL b part1', {blockStartId: 10, lineIndex: 12}), row(' part2', {blockStartId: 10, lineIndex: 12}),
    row('PASS c', {blockStartId: 10, lineIndex: 13}),
    row('PASS d', {blockStartId: 10, lineIndex: 14}),
    row('Completed', {blockStartId: 10, lineIndex: 15}),
    row('$ other', {blockStartId: 20, lineIndex: 20}), row('FAIL elsewhere', {blockStartId: 20, lineIndex: 21}),
  ];
  const isOutput = (line: number) => ![10, 15, 20].includes(line);
  const base = {startId: 10, options: {regex: false, caseSensitive: true}, invert: false, context: 0};
  const only = applyOutputFilter(rows, {...base, query: 'FAIL'}, isOutput);
  assert.deepEqual(only.rows.map(item => item.plain), ['$ npm test', only.rows[1]!.plain, 'FAIL b part1', ' part2', 'Completed', '$ other', 'FAIL elsewhere']);
  assert.ok(only.rows[1]!.isFilterHint);
  assert.match(only.rows[1]!.plain, /filter “FAIL” \(case\) · 1 of 4 lines · \/filter clear/u);
  const inverted = applyOutputFilter(rows, {...base, query: 'FAIL', invert: true}, isOutput);
  assert.deepEqual(inverted.rows.filter(item => item.lineIndex !== undefined && item.blockStartId === 10).map(item => item.plain), ['$ npm test', 'PASS a', 'PASS c', 'PASS d', 'Completed']);
  const context = applyOutputFilter(rows, {...base, query: 'FAIL', context: 1}, isOutput);
  assert.equal(context.kept, 3);
  const none = applyOutputFilter(rows, {...base, query: 'nothing'}, isOutput);
  assert.equal(none.rows[1]!.isFilterHint, true, 'an empty result still says a filter is active');
  assert.deepEqual(parseSearchArguments('-v -C 2 -r FAIL|ERR'), {query: 'FAIL|ERR', options: {regex: true, caseSensitive: false}, invert: true, context: 2, block: false});
  assert.deepEqual(parseSearchArguments('-- -v literal').query, '-v literal');
  assert.deepEqual(parseSlashCommand('/filter -v FAIL'), {kind: 'filter', arguments: '-v FAIL'});
  assert.deepEqual(parseSlashCommand('/find'), {kind: 'find', arguments: ''});
});

test('filter is presentation-only on the real OutputBuffer: transcript data and /copy are unchanged; clearing restores', () => {
  const output = new OutputBuffer();
  const startId = output.beginCommand('npm test', ['❯ npm test']);
  output.write('PASS a\r\nFAIL b\r\nPASS c\r\n');
  const record = output.complete(1)!;
  const before = JSON.stringify(output.transcript());
  const copyBefore = serializeCopyPayload(record);
  const full = output.wrapped(80).map(item => item.plain);
  output.setOutputFilter({startId, query: 'FAIL', options: {regex: false, caseSensitive: false}, invert: false, context: 0});
  const filtered = output.wrapped(80).map(item => item.plain);
  assert.ok(filtered.some(line => line.includes('FAIL b')));
  assert.ok(!filtered.some(line => line.includes('PASS a')));
  assert.ok(filtered.some(line => line.includes('npm test')), 'the command row stays');
  assert.equal(JSON.stringify(output.transcript()), before, 'stored transcript untouched');
  assert.equal(serializeCopyPayload(output.recent(1)!), copyBefore, '/copy still copies the complete output');
  output.setOutputFilter(undefined);
  assert.deepEqual(output.wrapped(80).map(item => item.plain), full, 'clearing restores the complete output');
});

test('app: /find opens the bar with a count above the composer; Esc closes; /filter targets the newest block and clears', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  const frames: string[] = [];
  try {
    const output = app['output'] as OutputBuffer;
    output.beginCommand('make', ['❯ make']);
    output.write('ok 1\r\nerror: boom\r\nok 2\r\n');
    output.complete(2);
    app['openFind']('error');
    const original = app['render'].bind(app);
    Object.defineProperty(app, 'render', {value: () => { original(); frames.push((app['presentationFrame']?.frame.rows ?? []).join('\n')); }});
    app['render']();
    assert.equal(app['findState'].matches.length, 1);
    assert.match(stripAnsi(frames.at(-1)!), /error_ +1\/1 match · regex off · case off/u);
    assert.equal(app['handleFindKey']({kind: 'escape'}), true);
    assert.equal(app['findState'], undefined);
    app['applyFilterCommand']('/filter error', 'error');
    assert.ok(output.activeFilter);
    assert.ok(!output.wrapped(100).some((item: WrappedRow) => item.plain.includes('ok 1')));
    app['applyFilterCommand']('/filter clear', 'clear');
    assert.equal(output.activeFilter, undefined);
    assert.ok(output.wrapped(100).some((item: WrappedRow) => item.plain.includes('ok 1')));
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
