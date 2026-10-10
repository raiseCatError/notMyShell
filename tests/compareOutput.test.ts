import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, type CompletedCommand} from '../src/output/OutputBuffer.js';
import {compareRecords, comparisonNotes, comparisonReport, diffLines, previousRun, summary, unifiedDiff, MAX_EDIT_DISTANCE} from '../src/output/compare.js';

let clock = Date.UTC(2026, 9, 10, 8, 0, 0);
function record(command: string, output: string, exitCode = 0): CompletedCommand {
  const buffer = new OutputBuffer();
  buffer.beginCommand(command, [`❯ ${command}`]);
  buffer.write(output);
  const done = buffer.complete(exitCode)!;
  clock += 60_000;
  return Object.assign(done, {startedAt: clock});
}

const lines = (count: number, make: (index: number) => string) => Array.from({length: count}, (_, index) => `${make(index)}\n`).join('');

test('the line diff reconstructs both sides exactly, for random edits', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 200; round += 1) {
    const a = Array.from({length: Math.floor(random() * 30)}, () => String(Math.floor(random() * 6)));
    const b = a.flatMap(line => random() < 0.2 ? [] : random() < 0.2 ? [line, String(Math.floor(random() * 6))] : [line]);
    const script = diffLines(a, b)!;
    assert.deepEqual(script.filter(line => line.kind !== 'add').map(line => line.text), a);
    assert.deepEqual(script.filter(line => line.kind !== 'remove').map(line => line.text), b);
  }
});

test('changes, additions and removals are counted; unchanged regions collapse into hunks with context', () => {
  const before = record('adb shell getprop', lines(100, index => `[prop.${index}]: [v1]`));
  const after = record('adb shell getprop', lines(100, index => index === 10 ? '[prop.10]: [v2]' : index === 60 ? '' : `[prop.${index}]: [v1]`).replace('\n\n', '\n') + '[prop.new]: [x]\n');
  const result = compareRecords(after, before);
  assert.equal(result.a, before, 'A is the older run whatever order they were picked in');
  assert.deepEqual(result.stats, {added: 1, removed: 1, changed: 1, unchanged: 98});
  assert.equal(result.hunks.length, 3);
  assert.equal(summary(result), '1 changed · 1 added · 1 removed · 98 unchanged');
  const diff = unifiedDiff(result);
  assert.match(diff, /^--- A: adb shell getprop · \d\d:\d\d:\d\d · exit 0\n\+\+\+ B: adb shell getprop · \d\d:\d\d:\d\d · exit 0\n@@ -8,7 \+8,7 @@\n \[prop\.7\]: \[v1\]\n \[prop\.8\]: \[v1\]\n \[prop\.9\]: \[v1\]\n-\[prop\.10\]: \[v1\]\n\+\[prop\.10\]: \[v2\]\n/u);
  assert.match(diff, /\n@@ -98,3 \+97,4 @@\n \[prop\.97\]: \[v1\]\n \[prop\.98\]: \[v1\]\n \[prop\.99\]: \[v1\]\n\+\[prop\.new\]: \[x\]\n$/u);
  assert.ok(!diff.includes('[prop.30]'), 'unchanged regions far from changes are left out');
});

test('identical runs, whitespace normalization (explicit and labelled), empty and incomplete outputs are said plainly', () => {
  const one = record('ls', 'a  b\nc\n');
  assert.equal(compareRecords(one, record('ls', 'a  b\nc\n')).identical, true);
  assert.equal(summary(compareRecords(one, record('ls', 'a  b\nc\n'))), 'Identical output');
  const spaced = record('ls', 'a b \nc\n');
  assert.equal(compareRecords(one, spaced).identical, false, 'faithful by default');
  const normalized = compareRecords(one, spaced, {ignoreWhitespace: true, context: 3});
  assert.equal(normalized.identical, true);
  assert.match(comparisonNotes(normalized).join(), /Whitespace ignored/u);
  const silent = record('ls', '');
  assert.match(comparisonNotes(compareRecords(one, silent)).join(' '), /B printed no output/u);
  const partial = Object.assign(record('ls', 'a\n'), {outputIncomplete: true as const});
  assert.match(comparisonNotes(compareRecords(one, partial)).join(' '), /B's output is incomplete/u);
});

test('outputs too different to align are reported as such, not as a misleading diff; large similar outputs stay fast', () => {
  const big = MAX_EDIT_DISTANCE + 200;
  const a = record('gen', lines(big, index => `a${index}`));
  const b = record('gen', lines(big, index => `b${index}`));
  const result = compareRecords(a, b);
  assert.equal(result.unaligned, true);
  assert.match(comparisonNotes(result).join(), /Too different to align/u);
  const started = Date.now();
  const similar = compareRecords(record('seq', lines(5000, String)), record('seq', lines(5000, index => index === 2500 ? 'x' : String(index))));
  assert.deepEqual(similar.stats.changed, 1);
  assert.ok(Date.now() - started < 1000, 'a 5000-line comparison is quick');
});

test('the comparison report names both sides and fences the diff safely', () => {
  const result = compareRecords(record('cat f', 'one\n```\n'), record('cat f', 'two\n```\n'));
  const report = comparisonReport(result);
  assert.match(report, /^# Output comparison\n\n- \*\*A \(older\):\*\* `cat f · [^`]+`\n- \*\*B \(newer\):\*\* `cat f · [^`]+`\n- \*\*Result:\*\* 1 changed · 1 unchanged\n\n````diff\n--- A:/u);
  assert.match(comparisonReport(compareRecords(record('x', 'same\n'), record('x', 'same\n'))), /_No differences\._/u);
});

test('the suggested partner is the previous run of exactly the same command', () => {
  // Created oldest first; /copy and the picker list them newest first.
  const newestFirst = [record('make  test', 'z'), record('make test', 'a'), record('ls', 'b'), record('make test', 'c')].reverse();
  assert.equal(previousRun(newestFirst[0]!, newestFirst)?.output, 'a');
  assert.equal(previousRun(newestFirst[1]!, newestFirst), undefined, 'ls has no earlier run');
});

test('panel: the previous run is suggested; Enter compares; n/N move between changes; w is explicit and labelled; c and r copy', async () => {
  const {createComparePanel, comparePanelKey, renderComparePanel} = await import('../src/ui/ComparePanel.js');
  const {stripAnsi, displayWidth} = await import('../src/util/text.js');
  const old = record('adb shell getprop', lines(60, index => index === 5 || index === 50 ? `[p${index}]: [old]` : `[p${index}]: [v]`));
  const other = record('ls', 'x\n');
  const latest = record('adb shell getprop', lines(60, index => index === 5 || index === 50 ? `[p${index}]: [new]` : `[p${index}]: [v]`));
  const recent = [latest, other, old];
  const panel = createComparePanel(latest, recent);
  assert.equal(panel.candidates[panel.cursor]!.record, old, 'the previous run is preselected');
  assert.match(stripAnsi(renderComparePanel(panel, 100, 24).join('\n')), /previous run/u);
  comparePanelKey(panel, {kind: 'enter'}, 100, 24);
  assert.ok(panel.comparison);
  const view = stripAnsi(renderComparePanel(panel, 100, 24).join('\n'));
  assert.match(view, /A adb shell getprop · [\d:]+ · exit 0\n  B adb shell getprop · [\d:]+ · exit 0\n  2 changed · 58 unchanged/u);
  assert.match(view, /- \[p5\]: \[old\]\n  \+ \[p5\]: \[new\]/u);
  // Navigation over many changes in a short panel: n moves forward change by change, N back.
  const many = (tag: string) => record('scan', lines(400, index => index % 80 === 5 ? `[p${index}]: [${tag}]` : `[p${index}]: [v]`));
  const nav = createComparePanel(many('new'), [], many('old'));
  const stops: number[] = [];
  for (let step = 0; step < 3; step += 1) { comparePanelKey(nav, {kind: 'text', value: 'n'}, 100, 14); stops.push(nav.scroll); }
  assert.ok(stops[0]! > 0 && stops[1]! > stops[0]! && stops[2]! > stops[1]!, `n moves forward: ${stops}`);
  comparePanelKey(nav, {kind: 'text', value: 'N'}, 100, 14);
  assert.equal(nav.scroll, stops[1], 'N goes back one change');
  assert.deepEqual(comparePanelKey(panel, {kind: 'text', value: 'c'}, 100, 24)?.kind, 'copy');
  const report = comparePanelKey(panel, {kind: 'text', value: 'r'}, 100, 24);
  assert.equal(report?.kind === 'copy' ? report.what : '', 'report');
  // Side by side on wide windows; unified on narrow ones; nothing wider than the window.
  assert.match(stripAnsi(renderComparePanel(panel, 160, 24).join('\n')), /old\].*│.*new\]/u);
  for (const columns of [160, 100, 40]) assert.ok(renderComparePanel(panel, columns, 20).map(stripAnsi).every(row => displayWidth(row) <= columns), `${columns}`);
  // Esc returns to choosing; a second Esc closes.
  assert.equal(comparePanelKey(panel, {kind: 'escape'}, 100, 24), undefined);
  assert.equal(panel.comparison, undefined);
  assert.equal(comparePanelKey(panel, {kind: 'escape'}, 100, 24)?.kind, 'close');
});

test('panel text is drawn, never interpreted: hostile output and commands cannot reach the terminal', async () => {
  const {createComparePanel, renderComparePanel} = await import('../src/ui/ComparePanel.js');
  const hostile = '\u001b]52;c;Zm9v\u0007\u001b[2J';
  const a = Object.assign(record(`echo ${hostile}`, 'a\n'), {output: `ok${hostile}\n`});
  const b = Object.assign(record(`echo ${hostile}`, 'b\n'), {output: `changed${hostile}\n`});
  const panel = createComparePanel(b, [b, a], a);
  const rendered = renderComparePanel(panel, 100, 24).join('\n').replace(/\u001b\[[\d;]*m/gu, '');
  assert.doesNotMatch(rendered, /[\u0007\u001b]/u);
});

test('/compare parses numbers as /copy does and refuses anything else', async () => {
  const {parseSlashCommand} = await import('../src/commands/slashCommands.js');
  assert.deepEqual(parseSlashCommand('/compare'), {kind: 'compare'});
  assert.deepEqual(parseSlashCommand('/compare 3'), {kind: 'compare', first: 3});
  assert.deepEqual(parseSlashCommand('/compare 1 4'), {kind: 'compare', first: 1, second: 4});
  for (const bad of ['/compare x', '/compare 0', '/compare 1 2 3', '/compare -1']) assert.ok((parseSlashCommand(bad) as {error?: string}).error, bad);
});

test('the comparison report is reviewed like any report: redacted, wrapped, and Enter copies exactly what was shown', async () => {
  const {createTextReview, renderReportReview, reportReviewKey} = await import('../src/ui/ReportReview.js');
  const {DEFAULT_REPORT_OPTIONS} = await import('../src/clipboard/report.js');
  const {stripAnsi} = await import('../src/util/text.js');
  const before = record('env', 'API_TOKEN=old\n');
  const after = record('env', 'API_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
  const review = createTextReview('Copy comparison report', comparisonReport(compareRecords(before, after)), [before, after], DEFAULT_REPORT_OPTIONS, false);
  const shown = stripAnsi(renderReportReview(review, 100, 40).join('\n'));
  assert.match(shown, /^ {2}Copy comparison report {2}Markdown/u);
  assert.match(shown, /Looks sensitive/u);
  assert.doesNotMatch(review.text, /ghp_abcdef/u);
  assert.equal(reportReviewKey(review, {kind: 'text', value: 'f'}, 40), undefined, 'format does not apply to a finished document');
  assert.deepEqual(reportReviewKey(review, {kind: 'enter'}, 40), {kind: 'copy', text: review.text});
});
