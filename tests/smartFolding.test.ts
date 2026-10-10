import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFold, foldHighlights, foldWindow, FOLD_HEAD_LINES, FOLD_TAIL_LINES, isFoldable, LONG_OUTPUT_LINES, MIN_AUTO_FOLD_LINES, OUTPUT_FOLDING_MODES, shouldAutoFold} from '../src/output/FoldPolicy.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {OutputBuffer, type SecondaryActivity} from '../src/output/OutputBuffer.js';
import {CommandClassifier} from '../src/output/Classifier.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';

const lines = (count: number, make: (index: number) => string) => Array.from({length: count}, (_, index) => make(index)).join('\n');
const fold = (command: string, output: string, exitCode = 0, facts?: {progressRewrites: boolean; sustainedStreaming: boolean}) =>
  evaluateFold({command, output, exitCode, lineCount: output.split('\n').length, ...(facts ? {facts} : {})});

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
const varied = (count: number) => lines(count, index => `${WORDS[index % WORDS.length]} ${WORDS[(index * 7 + 3) % WORDS.length]} note-${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + ((index * 5) % 26))}`);
const repetitive = (count: number) => lines(count, index => `processing item ${index} of ${count}`);
const install = (count: number) => lines(count, index => index % 3 === 0 ? `npm http fetch GET 200 https://registry.npmjs.org/pkg-${index} 12ms` : `downloading pkg-${index}@1.${index}.0`);

test('hard rules: short output never auto-folds; shorter failures stay expanded', () => {
  assert.equal(fold('seq 5', lines(5, String)).fold, false);
  assert.equal(fold('seq 15', repetitive(15)).fold, false);
  assert.equal(fold('build', repetitive(MIN_AUTO_FOLD_LINES)).fold, false, 'the floor is inclusive');
  const failed = fold('npm install', install(100), 1);
  assert.equal(failed.fold, false);
  assert.match(failed.reasons.join(), /failed/u);
});

test('below the long-output size, useful varied output stays expanded', () => {
  assert.equal(fold('describe', varied(25)).fold, false);
  assert.equal(fold('describe', varied(110)).fold, false, 'varied human-readable output is not boring');
  assert.equal(fold('git log', repetitive(100)).fold, false, 'git log is the requested result');
  assert.equal(fold('git status', lines(80, index => `\tmodified:   src/file${index}.ts`)).fold, false);
  assert.equal(fold('rg TODO', repetitive(100)).fold, false);
});

test(`long output folds whatever the command and status (${LONG_OUTPUT_LINES}+ lines); no list of known tools is needed`, () => {
  // The reported bug: large diagnostics never folded (varied text, the odd "error" word, ps/env/adb-style output).
  const getprop = lines(600, index => `[ro.vendor.prop.${WORDS[index % 12]}.${index}]: [${index % 5 ? 'enabled' : 'error-reporting'}]`);
  for (const [command, output, exitCode] of [['adb shell getprop', getprop, 0], ['describe', varied(250), 0], ['git log', repetitive(400), 0],
    ['ps aux', varied(LONG_OUTPUT_LINES), 0], ['npm install', install(300), 1], ['rg TODO', repetitive(200), 0]] as const) {
    const decision = fold(command, output, exitCode);
    assert.equal(decision.fold, true, `${command}: ${decision.reasons.join('; ')}`);
  }
  for (const count of [5, 50]) assert.equal(fold('diag', varied(count)).fold, false, `${count} lines stay open`);
  for (const count of [200, 500, 5000]) assert.equal(fold('diag', varied(count)).fold, true, `${count} lines fold`);
  // Logical lines vs. wrapped rows: 40 very long lines are several screens; 40 short ones are not.
  assert.equal(fold('jq -c .', lines(40, index => `{"id":${index},"payload":"${'x'.repeat(600)}"}`)).fold, true);
  assert.equal(fold('jq -c .', lines(40, index => `{"id":${index}}`)).fold, false);
});

test('shorter diagnostics, stack traces, compiler errors and diffs stay visible', () => {
  const trace = `${repetitive(80)}\nTraceback (most recent call last):\n  File "a.py", line 3, in <module>\n  File "b.py", line 9, in f\nValueError: bad`;
  assert.equal(fold('python job.py', trace).fold, false);
  const node = `${repetitive(80)}\nTypeError: x is undefined\n    at run (/app/a.js:3:9)\n    at main (/app/b.js:10:2)`;
  assert.equal(fold('node job.js', node).fold, false);
  assert.equal(fold('make', `${install(80)}\nsrc/a.c:10:5: error: expected ';'`).fold, false);
  assert.equal(fold('npm test', `${lines(80, index => `✔ passes ${index}`)}\n✖ fails badly`).fold, false);
  const diff = lines(100, index => index % 40 === 0 ? `@@ -${index},3 +${index},4 @@` : index % 2 ? `+ added ${index}` : `- removed ${index}`);
  assert.equal(fold('cmp', `diff --git a/x b/x\n${diff}`).fold, false);
});

test('a long folded log keeps its important lines in view: errors near the middle or end, the first frame of a trace', () => {
  const body = lines(400, index => index === 180 ? 'src/build.ts:42:7: error TS2322: wrong type'
    : index === 390 ? 'FAILED: 3 tests' : index === 391 ? '    at run (/app/a.js:3:9)' : index === 392 ? '    at main (/app/b.js:10:2)' : `step ${index} ok`);
  const all = body.split('\n');
  const picked = foldHighlights(all, FOLD_HEAD_LINES, all.length - FOLD_TAIL_LINES).map(index => all[index]);
  assert.deepEqual(picked, ['src/build.ts:42:7: error TS2322: wrong type', 'FAILED: 3 tests', '    at run (/app/a.js:3:9)']);
  assert.deepEqual(foldHighlights(lines(400, index => `step ${index} ok`).split('\n'), 3, 395), [], 'no invented importance');
  const output = new OutputBuffer();
  run(output, 'make all', body, 2);
  const rows = output.wrapped(100).map(row => row.plain);
  assert.equal(output.recent(1)!.expanded, false, 'a long failure folds');
  for (const line of ['src/build.ts:42:7: error TS2322: wrong type', 'FAILED: 3 tests', '    at run (/app/a.js:3:9)']) assert.ok(rows.includes(line), line);
  assert.ok(rows.some(row => /^\s*389 lines hidden · 3 important lines shown · Ctrl\+O/u.test(row)), rows.find(row => /hidden/u.test(row)));
  assert.equal(output.recent(1)!.output.split('\n').length, 400, 'stored output unchanged');
});

test('Smart never folds a block under the reader: scrolled back or selecting at completion, it finishes expanded', () => {
  const output = new OutputBuffer();
  output.beginCommand('seq 1 500', ['❯ seq 1 500']);
  output.write(lines(500, String));
  assert.equal(output.complete(0, {holdOpen: true})!.expanded, true);
  run(output, 'seq 1 501', lines(501, String));
  assert.equal(output.recent(1)!.expanded, false);
});

test('ANSI color and carriage-return progress count as the lines they leave, not as bytes or redraws', () => {
  const colored = lines(200, index => `\u001b[32m✔\u001b[0m case ${WORDS[index % 12]} ${index}`);
  assert.equal(fold('npm test', colored).fold, true);
  const progress = Array.from({length: 2000}, (_, index) => `\r${index / 20}%`).join('') + '\ndone';
  const output = new OutputBuffer();
  run(output, 'curl -O big.iso', progress);
  assert.equal(output.recent(1)!.expanded, true, 'a redrawn progress line is one line, not 2000');
});

test('the fold window keeps a head and a tail, and short blocks collapse to the row alone', () => {
  assert.deepEqual(foldWindow(400), {head: FOLD_HEAD_LINES, tail: FOLD_TAIL_LINES});
  assert.deepEqual(foldWindow(5), {head: 0, tail: 0});
});

function run(output: OutputBuffer, command: string, text: string, exitCode = 0): number {
  output.beginCommand(command, [`❯ ${command}`]);
  output.write(`${text}\n`);
  output.complete(exitCode);
  return 0;
}

test('an auto-folded block shows head, an accurate hidden count, and tail; Ctrl+O shows everything and collapses back', () => {
  const output = new OutputBuffer();
  const text = lines(400, index => index === 0 ? 'starting generator' : index === 399 ? 'done: 400 files written' : `processing item ${index} of 400`);
  run(output, './generate', text);
  const collapsed = output.wrapped(100).map(row => row.plain);
  const hint = collapsed.findIndex(row => row.includes('lines hidden'));
  assert.ok(hint > 0);
  assert.match(collapsed[hint]!, new RegExp(`^${400 - FOLD_HEAD_LINES - FOLD_TAIL_LINES} lines hidden · Ctrl\\+O`, 'u'));
  assert.deepEqual(collapsed.slice(hint - FOLD_HEAD_LINES, hint), ['starting generator', 'processing item 1 of 400', 'processing item 2 of 400']);
  assert.equal(collapsed.at(-1), 'done: 400 files written');
  assert.equal(collapsed.slice(hint + 1).length, FOLD_TAIL_LINES);

  output.toggleExpanded(0);
  const expanded = output.wrapped(100).map(row => row.plain);
  assert.ok(expanded.some(row => row.startsWith('400 lines shown')));
  assert.ok(expanded.includes('processing item 200 of 400'));
  output.toggleExpanded(0);
  assert.deepEqual(output.wrapped(100).map(row => row.plain), collapsed, 'collapsing returns to the compact form');
});

test('/copy, the transcript, and /resume keep the complete original output and the fold state', () => {
  const output = new OutputBuffer();
  const text = repetitive(400);
  run(output, './generate', text);
  assert.equal(output.recent(1)!.output.trimEnd(), text, '/copy source is the full output');
  const restored = new OutputBuffer();
  restored.restoreTranscript(structuredClone(output.transcript()));
  assert.equal(restored.recent(1)!.expanded, false);
  assert.equal(restored.recent(1)!.output, output.recent(1)!.output);
  assert.deepEqual(restored.wrapped(100).map(row => row.plain), output.wrapped(100).map(row => row.plain));
  restored.toggleExpanded(0);
  assert.ok(restored.wrapped(100).some(row => row.plain === 'processing item 250 of 400'));
});

test('shorter failures and useful output finish expanded in the buffer', () => {
  const failed = new OutputBuffer();
  run(failed, 'npm install', install(100), 1);
  assert.equal(failed.recent(1)!.expanded, true);
  const log = new OutputBuffer();
  run(log, 'git log --oneline', lines(100, index => `${(0xabc000 + index).toString(16)} commit ${index}`));
  assert.equal(log.recent(1)!.expanded, true);
});

test('ANSI output stays raw in storage and styled in head/tail rows', () => {
  const output = new OutputBuffer();
  const colored = lines(400, index => `\u001B[32mprocessing\u001B[0m item ${index}`);
  run(output, './generate', colored);
  const rows = output.wrapped(100);
  const head = rows.find(row => row.plain === 'processing item 0');
  assert.ok(head?.ansi.includes('\u001B[32m'), 'the visible head keeps its colors');
  assert.ok(!output.recent(1)!.output.includes('\u001B['), 'the copy payload is plain, as before');
  assert.ok(rows.every(row => !row.plain.includes('\u001B')));
});

test('Output folding Off (never) keeps everything expanded; Smart is the default', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.outputFolding, 'smart');
  assert.equal(normalizePromptConfiguration({outputFolding: 'never'}).outputFolding, 'never');
  assert.equal(normalizePromptConfiguration({outputFolding: 'aggressive'}).outputFolding, 'smart');
  const output = new OutputBuffer();
  output.setOutputFolding('never');
  run(output, './generate', repetitive(400));
  assert.equal(output.recent(1)!.expanded, true);
});

test('Output folding modes: Off/Smart/Always persist as never/smart/always and appear in that order', () => {
  assert.deepEqual(OUTPUT_FOLDING_MODES, ['never', 'smart', 'always']);
  assert.equal(normalizePromptConfiguration({outputFolding: 'always'}).outputFolding, 'always');
  assert.equal(normalizePromptConfiguration({outputFolding: 'smart'}).outputFolding, 'smart');
  const row = SETTINGS_ROWS.find(candidate => candidate.id === 'outputFolding')!;
  assert.ok(row.control === 'enum');
  assert.deepEqual(row.options, ['Off', 'Smart', 'Always']);
  assert.equal(row.select(DEFAULT_PROMPT_CONFIGURATION, 2).outputFolding, 'always');
});

test('Always folds every foldable block, failures and varied output included; short output stays open', () => {
  const output = new OutputBuffer();
  output.setOutputFolding('always');
  const varied = lines(40, index => `unique line ${index * 7919} ${'x'.repeat(index % 5)}`);
  run(output, 'cat notes.txt', varied);
  run(output, 'make', `${varied}\nerror: build failed`, 2);
  run(output, 'ls', lines(FOLD_HEAD_LINES + FOLD_TAIL_LINES + 4, index => `f${index}`));
  assert.equal(output.recent(3)!.expanded, false, 'varied output folds under Always');
  assert.equal(output.recent(2)!.expanded, false, 'failures fold under Always');
  assert.equal(output.recent(1)!.expanded, true, 'too short for a head/tail preview');
  assert.equal(isFoldable(FOLD_HEAD_LINES + FOLD_TAIL_LINES + 5), true);
  assert.equal(shouldAutoFold('smart', {command: 'make', output: varied, exitCode: 2, lineCount: 40}), false, 'Smart unchanged');
  const rows = output.wrapped(80);
  const hint = rows.find(row => row.isFoldHint && row.commandIndex === 1)!;
  assert.match(hint.plain, /lines hidden · Ctrl\+O/u);
  assert.ok(rows.some(row => row.plain === 'error: build failed'), 'tail stays visible');
  output.toggleExpanded(1);
  assert.equal(output.recent(2)!.expanded, true, 'manual expansion still wins');
  assert.ok(output.recent(2)!.output.includes('unique line 0'), 'full output preserved for /copy');
});

test('activity-bearing commands keep their own disclosure', () => {
  const output = new OutputBuffer();
  const start = output.beginCommand('npm test', ['❯ npm test']);
  output.write(`${repetitive(40)}\n`);
  const activity: SecondaryActivity = {id: 'a', kind: 'tap-stream', label: 'tests', startedAt: 0, status: 'completed',
    outputStartId: start + 1, outputEndId: start + 41, expanded: false};
  output.setActiveActivities([activity]);
  output.complete(0);
  assert.equal(output.recent(1)!.expanded, false);
  assert.ok(!output.wrapped(100).some(row => row.plain.includes('lines hidden')), 'no smart fold row on activity parents');
});

test('head, hint, and tail rows belong to the command block for sticky headers', () => {
  const output = new OutputBuffer();
  const start = output.beginCommand('./generate', ['❯ ./generate']);
  output.write(`${repetitive(400)}\n`);
  output.complete(0);
  const rows = output.wrapped(100).filter(row => row.lineIndex !== undefined && row.lineIndex >= start);
  assert.ok(rows.length > 0 && rows.every(row => row.blockStartId === start));
});

test('the live classifier no longer folds; it reports stream facts', () => {
  const classifier = new CommandClassifier(Date.now());
  classifier.pushChunk(`${repetitive(50)}\n`);
  classifier.pushChunk('50%\r');
  classifier.finalize(0);
  assert.equal(classifier.mode, 'INLINE');
  assert.deepEqual(classifier.streamFacts, {progressRewrites: true, sustainedStreaming: false});
  const alt = new CommandClassifier(Date.now());
  alt.pushChunk('\u001B[?1049h');
  assert.equal(alt.mode, 'PASSTHROUGH', 'alt-screen detection is untouched');
});
