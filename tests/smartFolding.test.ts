import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFold, foldWindow, FOLD_HEAD_LINES, FOLD_TAIL_LINES, MIN_AUTO_FOLD_LINES} from '../src/output/FoldPolicy.js';
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

test('hard rules: short output and failures never auto-fold', () => {
  assert.equal(fold('seq 5', lines(5, String)).fold, false);
  assert.equal(fold('seq 15', repetitive(15)).fold, false);
  assert.equal(fold('build', repetitive(MIN_AUTO_FOLD_LINES)).fold, false, 'the floor is inclusive');
  const failed = fold('npm install', install(300), 1);
  assert.equal(failed.fold, false);
  assert.match(failed.reasons.join(), /failed/u);
});

test('useful varied output stays expanded, even when long', () => {
  assert.equal(fold('describe', varied(25)).fold, false);
  assert.equal(fold('describe', varied(120)).fold, false, 'varied human-readable output is not boring');
  assert.equal(fold('git log', repetitive(400)).fold, false, 'git log is the requested result');
  assert.equal(fold('git status', lines(80, index => `\tmodified:   src/file${index}.ts`)).fold, false);
  assert.equal(fold('rg TODO', repetitive(200)).fold, false);
});

test('large repetitive, progress, and install output folds', () => {
  const big = fold('./generate', repetitive(400));
  assert.equal(big.fold, true, big.reasons.join('; '));
  assert.equal(fold('./download', lines(60, index => `${index}% complete`), 0, {progressRewrites: true, sustainedStreaming: true}).fold, true);
  assert.equal(fold('npm install', install(150)).fold, true);
  assert.equal(fold('npm test', lines(500, index => `✔ test case ${WORDS[index % 12]} ${index} (${index % 7}.2ms)`)).fold, true);
});

test('diagnostics, stack traces, compiler errors, and diffs stay visible', () => {
  const trace = `${repetitive(200)}\nTraceback (most recent call last):\n  File "a.py", line 3, in <module>\n  File "b.py", line 9, in f\nValueError: bad`;
  assert.equal(fold('python job.py', trace).fold, false);
  const node = `${repetitive(200)}\nTypeError: x is undefined\n    at run (/app/a.js:3:9)\n    at main (/app/b.js:10:2)`;
  assert.equal(fold('node job.js', node).fold, false);
  assert.equal(fold('make', `${install(200)}\nsrc/a.c:10:5: error: expected ';'`).fold, false);
  assert.equal(fold('npm test', `${lines(200, index => `✔ passes ${index}`)}\n✖ fails badly`).fold, false);
  const diff = lines(300, index => index % 40 === 0 ? `@@ -${index},3 +${index},4 @@` : index % 2 ? `+ added ${index}` : `- removed ${index}`);
  assert.equal(fold('cmp', `diff --git a/x b/x\n${diff}`).fold, false);
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

test('failures and useful output finish expanded in the buffer', () => {
  const failed = new OutputBuffer();
  run(failed, 'npm install', install(300), 1);
  assert.equal(failed.recent(1)!.expanded, true);
  const log = new OutputBuffer();
  run(log, 'git log --oneline', lines(200, index => `${(0xabc000 + index).toString(16)} commit ${index}`));
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

test('Output folding Never keeps everything expanded; Smart is the default', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.outputFolding, 'smart');
  assert.equal(normalizePromptConfiguration({outputFolding: 'never'}).outputFolding, 'never');
  assert.equal(normalizePromptConfiguration({outputFolding: 'aggressive'}).outputFolding, 'smart');
  const output = new OutputBuffer();
  output.setOutputFolding('never');
  run(output, './generate', repetitive(400));
  assert.equal(output.recent(1)!.expanded, true);
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
