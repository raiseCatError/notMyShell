import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, type CompletedCommand} from '../src/output/OutputBuffer.js';
import {compareRecords, comparisonReport, unifiedDiff, copyableDiff} from '../src/output/compare.js';
import {DEFAULT_REPORT_OPTIONS} from '../src/clipboard/report.js';
import {createTextReview} from '../src/ui/ReportReview.js';

let clock = Date.UTC(2026, 9, 10, 8, 0, 0);
function record(command: string, output: string, extra: Partial<CompletedCommand> = {}): CompletedCommand {
  const buffer = new OutputBuffer();
  buffer.beginCommand(command, [`❯ ${command}`]);
  buffer.write(output);
  const done = buffer.complete(0)!;
  clock += 60_000;
  return Object.assign(done, {startedAt: clock}, extra);
}

/** A record whose stored output is exactly this, whatever the buffer would have kept. */
const hostile = (output: string) => Object.defineProperty(record('x', 'b\n'), 'output', {value: output});

const reviewed = (a: CompletedCommand, b: CompletedCommand) =>
  createTextReview('Copy comparison report', comparisonReport(compareRecords(a, b)), [a, b], {...DEFAULT_REPORT_OPTIONS, home: '/Users/alex'}, false).text;

test('a plain diff copy carries no terminal controls, paste-end markers or bidi/invisible characters', () => {
  const comparison = compareRecords(record('x', 'a\n'), hostile('b \u001b[201~ \u202e evil \u200b\u0007\n'));
  const text = copyableDiff(comparison);
  assert.doesNotMatch(text, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b\u202e]/u);
  assert.match(text, /^\+b \[201~/mu);
  assert.equal(text.endsWith('\n'), true);
});

test('hidden characters between backticks cannot close the diff fence once they are removed', () => {
  const text = reviewed(record('x', 'a\n'), record('x', 'b\n`​`​`​`\n'));
  const fenceLines = text.split('\n').filter(line => /^`{5,}/u.test(line));
  assert.equal(fenceLines.length, 2, text);
});

test('a Unicode line separator cannot start a closing fence inside the diff', () => {
  const text = reviewed(record('x', 'a\n'), record('x', 'b ```\n# injected\n'));
  const fenceLines = text.split('\n').filter(line => /^`{4,}/u.test(line));
  assert.equal(fenceLines.length, 2, text);
  assert.equal(text.split('\n').includes('# injected'), false);
});

test('a command with backticks, markup or line breaks cannot break out of its inline code in the comparison header', () => {
  const hostile = 'echo `x` **bold** [l](http://e)  # heading';
  const text = reviewed(record(hostile, 'a\n'), record(hostile, 'b\n'));
  const headerLines = text.split('\n').slice(0, 8);
  assert.equal(headerLines.some(line => /^#\s+heading/u.test(line)), false, text);
  for (const line of headerLines.filter(line => line.startsWith('- **A') || line.startsWith('- **B'))) {
    assert.match(line, /^- \*\*[AB] \((?:older|newer)\):\*\* (`+) ?.*\1$/u, line);
  }
});

test('a secret only in compared output is redacted in the reviewed comparison report', () => {
  const text = reviewed(record('env', 'A=1\n'), record('env', 'A=1\nTOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n'));
  assert.doesNotMatch(text, /ghp_abcdefgh/u);
});

test('the sides keep their unified-diff text for tools: unifiedDiff stays raw, only the copy is cleaned', () => {
  const comparison = compareRecords(record('x', 'a\n'), record('x', 'b\n'));
  assert.equal(copyableDiff(comparison), unifiedDiff(comparison));
});
