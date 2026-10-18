import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_ITEMS, recognizeOutput, semanticText} from '../src/output/semantic.js';

const lines = (...rows: string[]) => rows.join('\n');

test('node --test (spec reporter): counts as printed; failing tests from its failing-tests section', () => {
  const passing = recognizeOutput('npm test', lines('▶ suite', '  ✔ a (0.1ms)', '✔ suite (0.5ms)', 'ℹ tests 1797', 'ℹ suites 3', 'ℹ pass 1772', 'ℹ fail 0',
    'ℹ cancelled 0', 'ℹ skipped 25', 'ℹ todo 0', 'ℹ duration_ms 8400.1'), 0);
  assert.deepEqual({source: passing?.source, outcome: passing?.outcome, overview: passing?.overview, items: passing?.items},
    {source: 'node --test', outcome: 'passed', overview: '1,772 passed · 0 failed · 25 skipped', items: []});
  const failing = recognizeOutput('node --test', lines('✔ ok test (1ms)', '✖ broken test (2ms)', '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
    'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1', 'ℹ cancelled 0', 'ℹ skipped 0', 'ℹ todo 0', '', '✖ failing tests:', '', 'test at tests/a.test.ts:3:1',
    '✖ broken test (2ms)', '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:'), 1);
  assert.equal(failing?.outcome, 'failed');
  assert.equal(failing?.overview, '1 passed · 1 failed');
  assert.deepEqual(failing?.items, [{text: 'broken test', tone: 'failure'}]);
});

test('TAP: the # summary and top-level not ok lines (TODO and SKIP are not failures)', () => {
  const result = recognizeOutput('node --test --test-reporter=tap', lines('TAP version 13', 'ok 1 - a', 'not ok 2 - b', '  ---', '  ...',
    'not ok 3 - later # TODO', '1..3', '# tests 3', '# pass 1', '# fail 1', '# todo 1'), 1);
  assert.equal(result?.overview, '1 passed · 1 failed · 1 todo');
  assert.deepEqual(result?.items.map(item => item.text), ['b']);
});

test('Jest, Vitest and pytest: their own summary lines and failure headings', () => {
  const jest = recognizeOutput('npx jest', lines('FAIL src/a.test.js', '  ● Math › adds', '', '    expect(received).toBe(expected)', '  ● Console', 'PASS src/b.test.js',
    'Test Suites: 1 failed, 1 passed, 2 total', 'Tests:       1 failed, 1 skipped, 10 passed, 12 total'), 1);
  assert.equal(jest?.source, 'Jest');
  assert.equal(jest?.overview, '10 passed · 1 failed · 1 skipped');
  assert.deepEqual(jest?.items.map(item => item.text), ['Math › adds']);
  const vitest = recognizeOutput('npx vitest run', lines(' FAIL  src/a.test.ts > math > adds', 'AssertionError: expected 3 to be 4', ' Test Files  1 failed | 2 passed (3)',
    '      Tests  1 failed | 10 passed (11)'), 1);
  assert.equal(vitest?.source, 'Vitest');
  assert.equal(vitest?.overview, '10 passed · 1 failed');
  assert.deepEqual(vitest?.items.map(item => item.text), ['src/a.test.ts > math > adds']);
  const pytest = recognizeOutput('pytest -q', lines('..F.', '=========================== short test summary info ============================',
    'FAILED tests/test_a.py::test_x - assert 1 == 2', '========================= 1 failed, 3 passed, 2 skipped in 0.12s ========================='), 1);
  assert.equal(pytest?.overview, '3 passed · 1 failed · 2 skipped');
  assert.deepEqual(pytest?.items.map(item => item.text), ['tests/test_a.py::test_x - assert 1 == 2']);
});

test('cargo test sums its test binaries; go test counts packages and failing tests', () => {
  const cargo = recognizeOutput('cargo test', lines('running 3 tests', 'test a::one ... ok', 'test a::two ... FAILED', 'test a::three ... ignored',
    'test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s', 'running 2 tests',
    'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s'), 101);
  assert.equal(cargo?.overview, '3 passed · 1 failed · 1 ignored');
  assert.deepEqual(cargo?.items.map(item => item.text), ['a::two']);
  const go = recognizeOutput('go test ./...', lines('--- FAIL: TestFoo (0.00s)', '    foo_test.go:9: want 1, got 2', 'FAIL', 'FAIL\texample.com/a\t0.004s',
    'ok  \texample.com/b\t0.003s', 'ok  \texample.com/c\t(cached)', '?   \texample.com/d\t[no test files]'), 1);
  assert.equal(go?.overview, '2 packages ok · 1 package failed · 1 failing test');
  assert.deepEqual(go?.items.map(item => item.text), ['TestFoo']);
});

test('compiler diagnostics: TypeScript (pretty and plain), Rust headings with locations, GCC/Clang', () => {
  const pretty = recognizeOutput('npx tsc --noEmit', lines("src/a.ts:3:7 - error TS2322: Type 'number' is not assignable to type 'string'.", '',
    '3 const x: string = 1;', '        ~', '', "src/b.ts(10,1): error TS2304: Cannot find name 'y'.", 'Found 2 errors in 2 files.'), 2);
  assert.equal(pretty?.source, 'TypeScript');
  assert.equal(pretty?.overview, '2 errors in 2 files');
  assert.deepEqual(pretty?.items.map(item => item.text), ["src/a.ts:3:7 TS2322: Type 'number' is not assignable to type 'string'.", "src/b.ts:10:1 TS2304: Cannot find name 'y'."]);
  const rust = recognizeOutput('cargo build', lines('warning: unused variable: `x`', ' --> src/main.rs:2:9', '  |', 'error[E0308]: mismatched types',
    ' --> src/main.rs:4:18', 'error: could not compile `demo` (bin "demo") due to 1 previous error; 1 warning emitted'), 101);
  assert.equal(rust?.overview, '1 error · 1 warning');
  assert.deepEqual(rust?.items, [{text: 'src/main.rs:2:9 warning: unused variable: `x`', tone: 'warning'}, {text: 'src/main.rs:4:18 error[E0308]: mismatched types', tone: 'failure'}]);
  const clang = recognizeOutput('make', lines("src/a.c:3:5: error: use of undeclared identifier 'x'", 'src/a.c:4:1: warning: control reaches end of non-void function',
    '1 warning and 1 error generated.'), 2);
  assert.equal(clang?.source, 'GCC/Clang');
  assert.equal(clang?.overview, '1 error · 1 warning');
  assert.equal(clang?.items[1]?.tone, 'warning');
});

test('fails closed: incomplete summaries, look-alike text from non-build commands, and plain output read as nothing', () => {
  assert.equal(recognizeOutput('cat notes.txt', lines('# tests 2', '# fail 0'), 0), undefined, 'no pass count: not a summary');
  assert.equal(recognizeOutput('rg error', "src/a.c:3:5: error: quoted in a search result", 0), undefined, 'a successful search is not a build');
  assert.equal(recognizeOutput('git status', lines('On branch main', 'nothing to commit, working tree clean'), 0), undefined);
  assert.equal(recognizeOutput('echo', '', 0), undefined);
  assert.equal(recognizeOutput('go version', 'ok  \texample.com/a\t0.1s', 0), undefined, 'go test lines only from go test');
  // A failing non-build command that printed compiler diagnostics still gets them (the failure makes them relevant).
  assert.equal(recognizeOutput('./build.sh', "src/a.c:3:5: error: x", 1)?.source, 'GCC/Clang');
});

test('items are bounded, deduplicated and counted; very large output is read from its end and says so; text export', () => {
  const many = Array.from({length: 30}, (_, index) => `src/f${index}.c:1:1: error: bad ${index}`);
  const result = recognizeOutput('make', lines(...many, ...many), 2)!;
  assert.equal(result.items.length, MAX_ITEMS);
  assert.equal(result.omitted, 10, 'duplicates are not counted twice');
  assert.equal(result.overview, '60 errors', 'the overview counts every diagnostic line printed');
  const text = semanticText(result);
  assert.match(text, /^GCC\/Clang: 60 errors\nsrc\/f0\.c:1:1 error: bad 0\n/u);
  assert.match(text, /… 10 more in the raw output$/u);
  const huge = recognizeOutput('npm test', `${'x'.repeat(3 * 1024 * 1024)}\nℹ tests 1\nℹ pass 1\nℹ fail 0`, 0)!;
  assert.equal(huge.complete, false);
  assert.match(semanticText(huge), /read from the last 2 MiB/u);
});

// ---- Presentation and copy ------------------------------------------------------------------------------------------

import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {logicalLines} from '../src/output/TranscriptSearch.js';
import {parseCopyArgs, semanticCopyPayload} from '../src/clipboard/copySelection.js';

function block(buffer: OutputBuffer, command: string, output: string, exitCode: number) {
  buffer.beginCommand(command, [`$ ${command}`]);
  buffer.write(output.replace(/\n/gu, '\r\n'));
  return buffer.complete(exitCode)!;
}
const passingRun = lines(...Array.from({length: 12}, (_, index) => `✔ test ${index} (1ms)`), 'ℹ tests 12', 'ℹ pass 12', 'ℹ fail 0', '');
const failingRun = lines('✔ ok (1ms)', '✖ broken one (2ms)', '✖ broken two (2ms)', 'ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', '', '✖ failing tests:', '✖ broken one (2ms)', '✖ broken two (2ms)', '');

test('presentation: an overview row inside the block, details by the raw fold, nothing stored and nothing searchable', () => {
  const buffer = new OutputBuffer();
  const pass = block(buffer, 'npm test', passingRun, 0);
  const before = JSON.stringify(buffer.transcript().lines);
  const rows = buffer.wrapped(100);
  const overview = rows.filter(row => row.derived);
  assert.deepEqual(overview.map(row => row.plain), ['  ✔ node --test · 12 passed · 0 failed']);
  assert.equal(overview[0]!.blockStartId, pass.startId, 'the row belongs to its block');
  assert.ok(rows.findIndex(row => row.derived) < rows.findIndex(row => row.plain.includes('test 0')), 'before the output');
  assert.equal(JSON.stringify(buffer.transcript().lines), before, 'drawing a reading stores nothing');
  assert.equal(logicalLines(rows).some(line => line.text.includes('node --test')), false, 'raw search never sees derived rows');

  const fail = block(buffer, 'npm test', failingRun, 1);
  const failRows = buffer.wrapped(100).filter(row => row.derived && row.blockStartId === fail.startId);
  assert.equal(fail.expanded, true, 'a short failing output stays expanded');
  assert.deepEqual(failRows.map(row => row.plain), ['  ✘ node --test · 1 passed · 2 failed', '  › 2 failing tests · click or Actions to show'],
    'raw is expanded, so the details (what it shows) start closed');
  assert.equal(failRows[1]!.semanticToggle, fail.startId);
  assert.ok(buffer.toggleSemanticDetails(fail.startId));
  assert.deepEqual(buffer.wrapped(100).filter(row => row.derived && row.blockStartId === fail.startId).map(row => row.plain).slice(1),
    ['  ⌄ 2 failing tests', '    ✘ broken one', '    ✘ broken two']);
  buffer.toggleExpanded(0);
  assert.equal(buffer.semanticDetailsOpen(fail), true, 'folding the raw output leaves the reader\'s choice alone');

  buffer.setSemanticOutput(false);
  assert.equal(buffer.wrapped(100).some(row => row.derived), false, 'Off: raw only');
  assert.equal(buffer.semanticFor(fail), undefined);
});

test('presentation: short passing output reads well already; failures and diagnostics are always summarized', () => {
  const buffer = new OutputBuffer();
  block(buffer, 'npm test', lines('ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0'), 0);
  assert.equal(buffer.wrapped(80).some(row => row.derived), false);
  block(buffer, 'make', "a.c:1:1: error: nope", 2);
  assert.deepEqual(buffer.wrapped(80).filter(row => row.derived).map(row => row.plain), ['  ✘ GCC/Clang · 1 error', '  › 1 diagnostic · click or Actions to show']);
  block(buffer, 'git status', lines('On branch main', 'nothing to commit, working tree clean'), 0);
  assert.equal(buffer.wrapped(80).filter(row => row.derived).length, 2, 'unrecognized output gets nothing');
});

test('/copy: --raw, --semantic and --both are one choice, never with --report or the picker; semantic copies fall back to raw once', () => {
  assert.deepEqual(parseCopyArgs('2 --semantic'), {ok: true, request: {selector: {kind: 'indices', indices: [2]}, content: 'semantic'}});
  assert.deepEqual(parseCopyArgs('--both -2'), {ok: true, request: {selector: {kind: 'latest', count: 2}, content: 'both'}});
  assert.deepEqual(parseCopyArgs('--raw'), {ok: true, request: {selector: {kind: 'default'}, content: 'raw'}});
  assert.match((parseCopyArgs('--raw --semantic') as {error: string}).error, /one of --raw, --semantic or --both/u);
  assert.match((parseCopyArgs('--both --report') as {error: string}).error, /report has its own format/u);
  assert.match((parseCopyArgs('ui --semantic') as {error: string}).error, /copy directly/u);
  const buffer = new OutputBuffer();
  const failing = block(buffer, 'npm test', failingRun, 1);
  const plain = block(buffer, 'echo hi', 'hi\n', 0);
  const semantic = semanticCopyPayload([failing, plain], 'semantic', false, record => buffer.semanticFor(record));
  assert.equal(semantic.payload, 'node --test: 1 passed · 2 failed\nbroken one\nbroken two\nhi\n');
  assert.equal(semantic.unavailable, 1);
  const both = semanticCopyPayload([failing], 'both', false, record => buffer.semanticFor(record));
  assert.match(both.payload, /^── NMSh · raw output ──\n✔ ok \(1ms\)\n[\s\S]*✖ broken two \(2ms\)\n── NMSh · Semantic Output ──\nnode --test: 1 passed · 2 failed\nbroken one\nbroken two$/u);
  assert.equal(both.payload.split('✔ ok (1ms)').length, 2, 'raw appears once');
});

test('hostile output cannot make recognition slow: every pattern is linear in what it reads', () => {
  const block = (line: string, times: number) => Array.from({length: times}, () => line).join('\n');
  const cases: Array<[string, string, string]> = [
    ['one 2 MB line of spaces', 'cat x', `${' '.repeat(2_000_000)}x`],
    ['Jest-like lines of digits', 'npx jest', block(`Tests: ${'1'.repeat(2000)}`, 1000)],
    ['TAP lines padded with spaces', 'node --test', `${block(`not ok 1 - ${' '.repeat(2000)}x`, 1000)}\n# tests 1\n# pass 0\n# fail 1`],
    ['colon-digit chains', 'make', block(`${'a:1'.repeat(660)}: error: x`, 1000)],
    ['TypeScript-like prefixes', 'npx tsc', block(`${'(1,'.repeat(600)} - error TS1: x`, 1000)],
    ['pytest-like banners', 'pytest', block(`= ${'1 a, '.repeat(390)} in 1s =`, 1000)],
    ['Rust locations', 'cargo build', block(`error: x\n --> ${':1'.repeat(1000)}`, 500)],
    ['Vitest-like lines', 'npx vitest', block(` Tests ${'(1'.repeat(1000)})`, 1000)],
  ];
  for (const [name, command, output] of cases) {
    const started = performance.now();
    recognizeOutput(command, output, 1);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 750, `${name}: ${Math.round(elapsed)}ms`);
  }
});
