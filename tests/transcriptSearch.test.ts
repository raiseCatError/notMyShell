import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOutputFilter, compileQuery, createFind, effectiveClauses, findCount, findResults, logicalLines, parseSearchArguments, parseSearchCommand, refreshFind,
  revealStart, stepFind, type FilterClause} from '../src/output/TranscriptSearch.js';
import {searchChromeRows} from '../src/output/SearchChrome.js';
import type {WrappedRow} from '../src/output/viewport.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const row = (plain: string, extra: Partial<WrappedRow> = {}): WrappedRow => ({ansi: plain, plain, ...extra});
const plain = {regex: false, caseSensitive: false};

test('multi-find: AND across clauses on logical lines; per-clause case and regex; spans for every clause', () => {
  const rows = [row('ERROR network timeout', {lineIndex: 1}), row('ERROR disk full', {lineIndex: 2}), row('disk mounted normally', {lineIndex: 3})];
  const both = findResults(rows, [{query: 'error', options: plain}, {query: 'disk', options: plain}]);
  assert.deepEqual(both.results.map(result => result.row), [1]);
  assert.deepEqual(both.results[0]!.spans.get(1), [{start: 0, end: 5}, {start: 6, end: 10}], 'both clauses are highlighted');
  assert.equal(findResults(rows, [{query: 'error', options: {regex: false, caseSensitive: true}}]).results.length, 0, 'case-sensitive clause');
  assert.deepEqual(findResults(rows, [{query: 'ERROR', options: {regex: false, caseSensitive: true}}, {query: 'disk|timeout', options: {regex: true, caseSensitive: false}}])
    .results.map(result => result.row), [0, 1], 'OR lives inside one regex clause');
  assert.equal(findResults(rows, [{query: '(', options: {regex: true, caseSensitive: false}}]).error !== undefined, true);
  assert.equal(findResults(rows, [{query: 'zzz', options: plain}]).results.length, 0);
});

test('multi-find: wrapping never changes whether a line matches; spans map onto the right rows', () => {
  const wrapped = [row('ERROR some lo', {lineIndex: 7}), row('ng text disk', {lineIndex: 7}), row('other', {lineIndex: 8})];
  assert.equal(logicalLines(wrapped).length, 2);
  const found = findResults(wrapped, [{query: 'error', options: plain}, {query: 'disk', options: plain}]);
  assert.deepEqual(found.results.map(result => result.row), [0], 'navigation targets the line, not a fragment');
  assert.deepEqual(found.results[0]!.spans.get(0), [{start: 0, end: 5}]);
  assert.deepEqual(found.results[0]!.spans.get(1), [{start: 8, end: 12}]);
  const crossing = findResults(wrapped, [{query: 'long', options: plain}]);
  assert.deepEqual([...crossing.results[0]!.spans.entries()], [[0, [{start: 11, end: 13}]], [1, [{start: 0, end: 2}]]], 'a term split by wrapping still matches');
});

test('find state: add, edit, navigation among combined results, count, regeneration only on change', () => {
  const rows = [row('a disk error', {lineIndex: 1}), row('error only', {lineIndex: 2}), row('disk error b', {lineIndex: 3})];
  const state = createFind();
  state.clauses.push({query: 'error', options: plain});
  state.editing = {query: 'disk', options: plain};
  assert.equal(effectiveClauses(state).length, 2, 'the clause being typed participates');
  refreshFind(state, rows, 'g1');
  assert.deepEqual(state.results.map(result => result.row), [0, 2]);
  assert.equal(state.active, 1, 'starts at the newest result');
  assert.equal(findCount(state), '2/2');
  assert.equal(stepFind(state, 'next')?.row, 0, 'next goes older');
  assert.equal(stepFind(state, 'next')?.row, 2, 'wraps');
  const results = state.results;
  refreshFind(state, rows, 'g1');
  assert.equal(state.results, results, 'no recompute for the same generation and clauses');
  assert.equal(revealStart(90, 100, 30), 70);
  assert.deepEqual(parseSearchCommand('remove 2'), {kind: 'remove', index: 2});
  assert.deepEqual(parseSearchCommand('clear'), {kind: 'clear'});
  assert.deepEqual(parseSearchCommand(''), {kind: 'open'});
  assert.equal(parseSearchCommand("-r 'disk|volume'").kind === 'add' && (parseSearchCommand("-r 'disk|volume'") as {parsed: {query: string}}).parsed.query, 'disk|volume');
});

const block = (filterRows: Array<[string, number]>, startId = 10) => [row('$ cmd', {blockStartId: startId, lineIndex: startId}),
  ...filterRows.map(([text, line]) => row(text, {blockStartId: startId, lineIndex: line})), row('Completed', {blockStartId: startId, lineIndex: 99})];
const isOutput = (line: number) => line !== 10 && line !== 99 && line !== 20;
const clause = (query: string, extra: Partial<FilterClause> = {}): FilterClause => ({query, options: plain, invert: false, context: 0, ...extra});

test('multi-filter: AND, invert with normal, regex with plain, context, block boundaries and the hint', () => {
  const rows = [...block([['ERROR disk full', 11], ['ERROR network', 12], ['disk ok', 13], ['ERROR disk retry', 14], ['tail', 15]]),
    row('$ other', {blockStartId: 20, lineIndex: 20}), row('ERROR disk elsewhere', {blockStartId: 20, lineIndex: 21})];
  const kept = (clauses: FilterClause[]) => applyOutputFilter(rows, {startId: 10, clauses}, isOutput).rows
    .filter(item => item.blockStartId === 10 && !item.isFilterHint && isOutput(item.lineIndex ?? 0)).map(item => item.plain);
  assert.deepEqual(kept([clause('error'), clause('disk')]), ['ERROR disk full', 'ERROR disk retry']);
  assert.deepEqual(kept([clause('error'), clause('retry', {invert: true})]), ['ERROR disk full', 'ERROR network']);
  assert.deepEqual(kept([clause('disk|network', {options: {regex: true, caseSensitive: false}}), clause('ERROR', {options: {regex: false, caseSensitive: true}})]),
    ['ERROR disk full', 'ERROR network', 'ERROR disk retry']);
  assert.deepEqual(kept([clause('retry', {context: 1})]), ['disk ok', 'ERROR disk retry', 'tail']);
  const result = applyOutputFilter(rows, {startId: 10, clauses: [clause('error'), clause('disk')]}, isOutput);
  assert.ok(result.rows.some(item => item.plain === 'ERROR disk elsewhere'), 'other blocks are never filtered');
  assert.ok(result.rows.some(item => item.plain === '$ cmd') && result.rows.some(item => item.plain === 'Completed'), 'command boundaries stay');
  assert.match(result.rows.find(item => item.isFilterHint)!.plain, /filter “error” ∧ “disk” · 2 of 5 lines · \/filter clear/u);
});

test('filter on the real OutputBuffer: presentation only; /copy complete; clear restores exactly', () => {
  const output = new OutputBuffer();
  const startId = output.beginCommand('npm test', ['❯ npm test']);
  output.write('PASS a\r\nFAIL b network\r\nFAIL c disk\r\n');
  const record = output.complete(1)!;
  const before = JSON.stringify(output.transcript());
  const copyBefore = serializeCopyPayload(record);
  const full = output.wrapped(80).map(item => item.plain);
  output.setOutputFilter({startId, clauses: [clause('FAIL'), clause('disk')]});
  const filtered = output.wrapped(80).map(item => item.plain);
  assert.ok(filtered.some(line => line.includes('FAIL c disk')));
  assert.ok(!filtered.some(line => line.includes('FAIL b network') || line.includes('PASS a')));
  assert.equal(JSON.stringify(output.transcript()), before, 'stored transcript untouched');
  assert.equal(serializeCopyPayload(output.recent(1)!), copyBefore, '/copy still copies the complete output');
  output.setOutputFilter(undefined);
  assert.deepEqual(output.wrapped(80).map(item => item.plain), full, 'clearing restores every hidden line');
});

const style = {accent: '', primary: '', secondary: '', subtle: '', error: '', reset: ''};

test('chrome: find left, filter right, at most two rows with exact +N more, tags, editing marker, narrow summaries', () => {
  const find = (count: number, editing?: string) => ({clauses: Array.from({length: count}, (_, index) => ({query: `term${index + 1}`, options: plain})),
    ...(editing !== undefined ? {editing: {query: editing, options: {regex: true, caseSensitive: false}}} : {}), count: '2/5'});
  const filters = (count: number) => ({clauses: Array.from({length: count}, (_, index) => clause(`f${index + 1}`, index === 0 ? {options: {regex: false, caseSensitive: true}} : {invert: index === 1}))});
  const rows = searchChromeRows(find(5), filters(4), 120, style);
  assert.equal(rows.length, 2, 'never a third row');
  assert.match(rows[0]!, /^⌕ term1  2\/5 +⧩ f1 \[case\]$/u);
  assert.match(rows[1]!, /^⌕ term2  \+3 more +⧩ f2 \[invert\]  \+2 more$/u);
  assert.ok(rows.every(item => displayWidth(item) <= 120));
  const editing = searchChromeRows(find(3, 'disk'), undefined, 80, style);
  assert.deepEqual(editing, ['⌕ term1  2/5', '⌕ disk_ [regex]  +2 more'], 'the clause being typed stays visible and marked');
  assert.deepEqual(searchChromeRows(find(1), undefined, 80, style), ['⌕ term1  2/5']);
  const narrow = searchChromeRows(find(5), filters(4), 30, style);
  assert.equal(narrow.length, 1);
  assert.match(narrow[0]!, /^⌕ 5 terms · 2\/5 +⧩ 4 filters$/u);
  assert.deepEqual(searchChromeRows(undefined, undefined, 80, style), []);
});

test('keys: raw and Kitty CSI-u Ctrl+F decode to find; slash parsing for find/filter management', () => {
  assert.deepEqual(decodeKeys('\u0006'), [{kind: 'find'}]);
  assert.deepEqual(decodeKeys('\u001b[102;5u'), [{kind: 'find'}]);
  assert.deepEqual(parseSlashCommand('/find remove 1'), {kind: 'find', arguments: 'remove 1'});
  assert.deepEqual(parseSlashCommand('/filter clear'), {kind: 'filter', arguments: 'clear'});
  assert.deepEqual(parseSearchArguments('-v -C 2 -r FAIL|ERR'), {query: 'FAIL|ERR', options: {regex: true, caseSensitive: false}, invert: true, context: 2, block: false});
  assert.equal(compileQuery('x', plain).ok, true);
});

function app(): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  instance['presentationStarted'] = true;
  instance['startupPending'] = false;
  return instance;
}

test('app: repeated /find adds clauses; remove and clear; Ctrl+F opens a new clause; Esc keeps applied ones; chrome rows never starve the composer', async () => {
  const instance = app();
  try {
    const output = instance['output'] as OutputBuffer;
    output.beginCommand('make', ['❯ make']);
    output.write('ERROR network timeout\r\nERROR disk full\r\ndisk mounted normally\r\n');
    output.complete(2);
    instance['findCommand']('/find error', 'error');
    instance['findCommand']('/find disk', 'disk');
    instance['render']();
    assert.equal(instance['findState'].clauses.length, 2);
    assert.equal(instance['findState'].results.length, 1, 'only the line with both terms');
    const frame = () => stripAnsi((instance['presentationFrame']?.frame.rows ?? []).join('\n'));
    assert.match(frame(), /⌕ error  1\/1/u);
    assert.match(frame(), /⌕ disk/u);
    instance['handleKey']({kind: 'find'});
    assert.ok(instance['findState'].editing, 'Ctrl+F opens a fresh clause input');
    assert.equal(instance['findState'].clauses.length, 2, 'existing clauses stay');
    instance['handleKey']({kind: 'text', value: 'x'});
    instance['handleKey']({kind: 'escape'});
    assert.equal(instance['findState'].editing, undefined);
    assert.equal(instance['findState'].clauses.length, 2, 'Esc discards only the uncommitted input');
    instance['handleKey']({kind: 'find'});
    for (const character of 'full') instance['handleKey']({kind: 'text', value: character});
    instance['handleKey']({kind: 'enter'});
    assert.equal(instance['findState'].clauses.length, 3, 'Enter applies a typed clause');
    instance['handleKey']({kind: 'escape'});
    instance['findCommand']('/find remove 1', 'remove 1');
    assert.deepEqual(instance['findState'].clauses.map((item: {query: string}) => item.query), ['disk', 'full']);
    instance['render']();
    const plan = instance['presentationFrame'].plan;
    assert.ok(plan.regions.find((region: {kind: string}) => region.kind === 'find').height <= 2);
    assert.ok(plan.regions.find((region: {kind: string}) => region.kind === 'input').height >= 1, 'composer keeps its row');
    instance['findCommand']('/find clear', 'clear');
    assert.equal(instance['findState'], undefined);
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('app: /filter adds clauses to the same block, never moves to a newer block, remove and clear', () => {
  const instance = app();
  try {
    const output = instance['output'] as OutputBuffer;
    const first = output.beginCommand('test', ['❯ test']);
    output.write('FAIL network\r\nFAIL disk\r\nPASS disk\r\n');
    output.complete(1);
    instance['applyFilterCommand']('/filter FAIL', 'FAIL');
    instance['applyFilterCommand']('/filter disk', 'disk');
    assert.deepEqual(output.activeFilter, {startId: first, clauses: [clause('FAIL'), clause('disk')]});
    output.beginCommand('echo next', ['❯ echo next']);
    output.write('next\r\n');
    output.complete(0);
    instance['applyFilterCommand']('/filter -v network', '-v network');
    assert.equal(output.activeFilter!.startId, first, 'stays attached to its block');
    assert.equal(output.activeFilter!.clauses.length, 3);
    instance['applyFilterCommand']('/filter remove 3', 'remove 3');
    assert.equal(output.activeFilter!.clauses.length, 2);
    instance['applyFilterCommand']('/filter clear', 'clear');
    assert.equal(output.activeFilter, undefined);
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('Ctrl+F: opens find at the idle composer; a running command receives it untouched; passthrough bytes are forwarded raw', () => {
  const instance = app();
  const written: string[] = [];
  instance['session'].write = ((data: string) => { written.push(data); }) as never;
  try {
    instance['onInput']('\u0006');
    assert.ok(instance['findState']?.editing);
    instance['handleKey']({kind: 'escape'});
    instance['running'] = {command: 'cat', startedAt: Date.now(), interrupted: false, cleared: false, startId: 0, cwd: '/'} as never;
    instance['handleKey']({kind: 'find'});
    assert.deepEqual(written, ['\u0006']);
    instance['running'] = undefined;
    instance['passthrough'] = true;
    instance['onInput']('\u0006');
    assert.deepEqual(written, ['\u0006', '\u0006'], 'passthrough forwards the raw byte');
    instance['passthrough'] = false;
  } finally { instance['stop'](0); instance['session'].kill(); }
});
