import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, type CompletedCommand} from '../src/output/OutputBuffer.js';
import {buildReport, DEFAULT_REPORT_OPTIONS, describeFindings, parseReportFlag, redactedLines, redactText, scanSensitive} from '../src/clipboard/report.js';
import {parseCopyArgs} from '../src/clipboard/copySelection.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {applyReportEdit, createReportReview, renderReportReview, reportReviewKey} from '../src/ui/ReportReview.js';
import {copyPickerKey, createCopyPicker} from '../src/ui/CopyPicker.js';
import {BLOCK_ACTIONS} from '../src/ui/BlockActions.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

function record(command: string, output: string, exitCode: number, lifecycle: string, extra: Partial<CompletedCommand> = {}): CompletedCommand {
  const buffer = new OutputBuffer();
  buffer.beginCommand(command, [`❯ ${command}`]);
  buffer.write(output);
  const done = buffer.complete(exitCode)!;
  buffer.setCompletionLifecycle(lifecycle);
  return Object.assign(done, {startedAt: Date.UTC(2026, 9, 10, 8, 1, 47), durationMs: 12_900, historicalContext: {cwd: '/Users/alex/Projects/demo'}}, extra);
}

const devices = () => record('adb devices', 'List of devices attached\r\nR58M12ABC\tdevice\r\n', 0, '✔ Completed · 1.4s · 10:04');
const failed = () => record('npm test', 'boom\r\n```inner fence```\r\n', 1, '✘ Command failed · exit 1 · 12.9s · 10:05 · 3.1s waiting for input');

test('Markdown report: one section per command, facts from the record, output fenced safely, oldest first', () => {
  const {text, findings} = buildReport([devices(), failed()], {...DEFAULT_REPORT_OPTIONS, redact: false});
  assert.deepEqual(findings, []);
  assert.match(text, /^# Command report\n\n2 commands, oldest first\.\n\n## 1\. `adb devices`\n\n- \*\*Status:\*\* ✔ Completed · 1\.4s · 10:04\n- \*\*Exit code:\*\* 0\n- \*\*Duration:\*\* 12\.9s\n\n```text\nList of devices attached\nR58M12ABC {7}device\n```/u, 'output as stored (tabs expanded as shown)');
  assert.match(text, /## 2\. `npm test`[\s\S]*- \*\*Status:\*\* ✘ Command failed · exit 1 · 12\.9s · 10:05 · 3\.1s waiting for input\n- \*\*Exit code:\*\* 1/u);
  assert.match(text, /````text\nboom\n```inner fence```\n````/u, 'a longer fence than any backtick run in the output');
  assert.doesNotMatch(text, /Directory|Started/u, 'directory and times are opt-in');
  const options = {...DEFAULT_REPORT_OPTIONS, redact: false, directory: true, timestamps: true};
  assert.match(buildReport([devices()], options).text, /- \*\*Directory:\*\* `\/Users\/alex\/Projects\/demo`\n- \*\*Started:\*\* 2026-10-1[01] \d\d:\d\d:47/u);
  assert.match(buildReport([record('true', '', 0, '✔ Completed · 2 ms')], options).text, /_No output\._/u);
  const multi = buildReport([record('for i in 1 2; do\n  echo `x`\ndone', 'x\r\n', 0, '✔ Completed')], options).text;
  assert.match(multi, /## 1\. Command\n\n```sh\nfor i in 1 2; do\n  echo `x`\ndone\n```/u);
});

test('plain report: labelled lines and clear separators; control sequences never reach the report', () => {
  const hostile = record('printf x', 'ok\u001b]52;c;Zm9v\u0007\u001b[31m red\r\n', 0, '✔ Completed · 1 ms');
  const {text} = buildReport([hostile, failed()], {...DEFAULT_REPORT_OPTIONS, format: 'plain', redact: false});
  assert.match(text, /^Command report · 2 commands, oldest first\n\n=== 1\. \$ printf x\nStatus: ✔ Completed · 1 ms\nExit code: 0\nDuration: 12\.9s\n--- output ---\nok red\n--- end ---/u, 'stored output is already free of escape sequences');
  assert.doesNotMatch(text, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
});

test('redaction: common secret shapes and private paths are replaced and counted; ordinary text is left alone', () => {
  const source = [
    'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXRleHQ"',
    'git clone https://alex:s3cretPass@github.com/org/repo.git',
    'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'AKIAIOSFODNN7EXAMPLE and sk-ant-api03-abcdefghijklmnopqrstuvwx',
    'password: hunter2',
    '-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAA', '-----END OPENSSH PRIVATE KEY-----',
    'cd /Users/alex/Projects/demo && ls /home/sam/build',
    'mail me at alex@example.com',
    'mysql --password=s3cr3tpw -u root && deploy --token abc.def.ghi && login -p',
    'Set-Cookie: session=abcdef123; HttpOnly',
    'stripe sk_live_ABCDEFGHIJKLMNOPQRSTUV and -----BEGIN PGP PRIVATE KEY BLOCK-----', 'lQOYBF', '-----END PGP PRIVATE KEY BLOCK-----',
    'ordinary output: 3 tests passed, token count 42, key: value',
  ].join('\n');
  const {text, findings} = redactText(source, '/Users/alex');
  for (const secret of ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'eyJhbGciOiJIUzI1NiJ9', 's3cretPass', 'wJalrXUtnFEMI', 'AKIAIOSFODNN7EXAMPLE', 'sk-ant-api03', 'hunter2',
    'b3BlbnNzaC1rZXktdjEAAAAA', '/Users/alex', '/home/sam', 'alex@example.com', 's3cr3tpw', 'abc.def.ghi', 'session=abcdef123', 'sk_live_ABCD', 'lQOYBF']) assert.ok(!text.includes(secret), `${secret} redacted:\n${text}`);
  assert.match(text, /git clone https:\/\/alex:\[REDACTED\]@github\.com/u);
  assert.match(text, /cd ~\/Projects\/demo && ls \/home\/<user>\/build/u);
  assert.match(text, /ordinary output: 3 tests passed, token count 42, key: value/u, 'not every "token" or "key" is a secret');
  const kinds = Object.fromEntries(findings.map(finding => [finding.kind, finding.count]));
  assert.equal(kinds['private key'], 2);
  assert.match(text, /login -p$/mu, 'a bare flag with no value is left alone');
  assert.equal(kinds['private path'], 2);
  assert.ok(kinds.token! >= 3 && kinds.credential! >= 3, JSON.stringify(kinds));
  assert.match(describeFindings([{kind: 'token', count: 2}, {kind: 'private path', count: 1}, {kind: 'email address', count: 3}]), /^2 tokens, 1 private path and 3 email addresses$/u);
  assert.deepEqual(scanSensitive('all good here: 12 files, 0 errors'), []);
});

test('flags: --report and --report=plain in /copy and /cp; with --status it explains instead of guessing', () => {
  assert.equal(parseReportFlag('--report'), 'markdown');
  assert.equal(parseReportFlag('--report=md'), 'markdown');
  assert.equal(parseReportFlag('--report=plain'), 'plain');
  assert.equal(parseReportFlag('--report=pdf'), 'invalid');
  assert.equal(parseReportFlag('--reports'), undefined);
  assert.deepEqual(parseCopyArgs('1-4 --report'), {ok: true, request: {selector: {kind: 'indices', indices: [1, 2, 3, 4]}, report: 'markdown'}});
  assert.deepEqual(parseCopyArgs('--report=plain -2'), {ok: true, request: {selector: {kind: 'latest', count: 2}, report: 'plain'}});
  assert.deepEqual(parseCopyArgs('ui --report'), {ok: true, request: {selector: {kind: 'picker'}, report: 'markdown'}});
  assert.match((parseCopyArgs('--report --status') as {error: string}).error, /always includes each command's status/u);
  assert.match((parseCopyArgs('--report=pdf') as {error: string}).error, /--report=plain/u);
  assert.deepEqual(parseSlashCommand('/cp 1-4 --report'), parseSlashCommand('/copy 1-4 --report'));
});

test('review: every report is reviewed; changed lines are marked; switches rebuild; an edit is re-checked and is what gets copied', () => {
  const secret = record('env', 'API_KEY=abc123def456\r\nHOME=/Users/alex\r\n', 0, '✔ Completed · 3 ms');
  const home = {...DEFAULT_REPORT_OPTIONS, home: '/Users/alex'};
  assert.match(stripAnsi(renderReportReview(createReportReview([devices()], home, false), 100, 30).join('\n')), /No common secret shapes found[\s\S]*not a guarantee/u);
  const review = createReportReview([secret], home, true);
  assert.deepEqual(redactedLines(review.text).length, 2);
  assert.match(stripAnsi(renderReportReview(review, 100, 30).join('\n')), /Changed lines \(▸\): \d+, \d+[\s\S]*▸- \*\*|▸API_KEY=\[REDACTED\]/u);
  assert.ok(!review.text.includes('abc123def456') && !review.text.includes('/Users/alex'));
  assert.match(stripAnsi(renderReportReview(review, 100, 30).join('\n')), /Looks sensitive: 1 credential and 1 private path · redacted 1 credential and 1 private path/u);
  reportReviewKey(review, {kind: 'text', value: 'r'}, 30);
  assert.ok(review.text.includes('abc123def456'), 'redaction off shows the original');
  assert.match(stripAnsi(renderReportReview(review, 100, 30).join('\n')), /NOT redacted/u);
  reportReviewKey(review, {kind: 'text', value: 'r'}, 30);
  reportReviewKey(review, {kind: 'text', value: 'f'}, 30);
  assert.match(review.text, /^Command report · 1 command/u);
  assert.deepEqual(reportReviewKey(review, {kind: 'text', value: 'e'}, 30), {kind: 'edit'});
  applyReportEdit(review, 'my corrected report\n');
  assert.deepEqual(review.sensitive, []);
  assert.deepEqual(reportReviewKey(review, {kind: 'enter'}, 30), {kind: 'copy', text: 'my corrected report\n'});
  applyReportEdit(review, 'oops ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
  assert.match(stripAnsi(renderReportReview(review, 100, 30).join('\n')), /Looks sensitive: 1 token · in your edit, not redacted/u);
  assert.equal(reportReviewKey(review, {kind: 'escape'}, 30)?.kind, 'close');
  // No editor configured: no edit key.
  const noEditor = createReportReview([secret], home, false);
  assert.equal(reportReviewKey(noEditor, {kind: 'text', value: 'e'}, 30), undefined);
  for (const columns of [100, 40]) {
    const lines = renderReportReview(noEditor, columns, 20).map(stripAnsi);
    assert.ok(lines.every(line => displayWidth(line) <= columns) && lines.length <= 20, `${columns} columns`);
  }
});

test('entry points: the picker\'s r and the Actions menu name the same report flow', () => {
  const picker = createCopyPicker([failed(), devices()], false);
  copyPickerKey(picker, {kind: 'text', value: 'a'});
  const action = copyPickerKey(picker, {kind: 'text', value: 'r'});
  assert.equal(action?.kind, 'report');
  assert.deepEqual(action?.kind === 'report' ? action.records.map(item => item.command) : [], ['adb devices', 'npm test']);
  assert.ok(BLOCK_ACTIONS.some(item => item.id === 'copyReport' && /report/u.test(item.label)));
});

test('no parser differential: invisible characters cannot hide a secret, glued tokens are found, and the review shows every copied character', () => {
  // Zero-width space, zero-width joiner, a bidi override and a soft hyphen inside or around a token.
  const hidden = 'TOKEN=gh​p_abcdefghij‍klmnopqrstuvwxyz0123456789 ‮evil‬ and gl­pat-abcdefghijklmnopqrstuv';
  const {text} = redactText(hidden);
  assert.doesNotMatch(text, /ghp_|glpat-/u, text);
  assert.doesNotMatch(text, /\p{Cf}/u, 'no invisible format characters survive into the report');
  assert.match(redactText('build_ghp_abcdefghijklmnopqrstuvwxyz0123456789_done').text, /build_\[REDACTED\]_done/u);
  // A long line in the review: wrapped, every character visible; what Enter copies is exactly what was shown.
  const long = record('echo', `${'x'.repeat(590)}-TAIL-END\r\n`, 0, '✔ Completed · 1 ms');
  const review = createReportReview([long], {...DEFAULT_REPORT_OPTIONS, home: '/Users/alex'}, false);
  const shown: string[] = [];
  for (let page = 0; page < 40; page += 1) {
    shown.push(...renderReportReview(review, 60, 24).map(stripAnsi));
    reportReviewKey(review, {kind: 'pageDown'}, 24);
  }
  assert.ok(shown.some(row => row.includes('-TAIL-END')), 'the end of a long line is visible');
  const action = reportReviewKey(review, {kind: 'enter'}, 24);
  assert.deepEqual(action, {kind: 'copy', text: review.text});
  // The rendered rows, joined, contain the whole report: nothing copied is unseen.
  const visible = shown.join('').replace(/\s+/gu, '');
  for (const line of review.text.split('\n')) assert.ok(visible.includes(line.replace(/\s+/gu, '')), `shown: ${line.slice(0, 40)}`);
  // An edit carrying invisible characters is cleaned exactly like a generated report.
  applyReportEdit(review, 'see gh​p_abcdefghijklmnopqrstuvwxyz0123456789\n');
  assert.equal(review.text, 'see ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
  assert.match(stripAnsi(renderReportReview(review, 100, 30).join('\n')), /Looks sensitive: 1 token · in your edit/u);
});

test('no differential with what a reader parses: line separators, ignorable characters, look-alikes and marks', () => {
  // A line separator would end a line in the editor or Markdown reader; it cannot close the fence from inside.
  const escape = record('cat notes', 'safe\u2028```\u2029![x](https://example.invalid/leak)\r\n', 0, '✔ Completed · 1 ms');
  const {text} = buildReport([escape], {...DEFAULT_REPORT_OPTIONS, redact: false});
  assert.doesNotMatch(text, /[\u2028\u2029]/u);
  assert.match(text, /````text\nsafe\n```\n!\[x\]\(https:\/\/example\.invalid\/leak\)\n````/u, 'the fence outgrows the inner run and still holds the whole output');
  // Variation selectors, Hangul fillers, combining marks and full-width look-alikes inside a token.
  for (const disguised of ['ghp_abcdefghij\uFE0Fklmnopqrstuvwxyz0123456789', 'ghp_abcdefghij\u3164klmnopqrstuvwxyz0123456789',
    'ghp_abcdefghij\u0301klmnopqrstuvwxyz0123456789', '\uFF47\uFF48\uFF50_abcdefghijklmnopqrstuvwxyz0123456789']) {
    const result = redactText(`token: ${disguised} end`).text;
    assert.match(result, /^token: \[REDACTED\] end$/u, JSON.stringify(disguised));
  }
  // Ordinary non-ASCII text is never rewritten: fidelity outside redacted spans.
  const faithful = 'café naïve x² ﬁle 日本語 émoji 🐈';
  assert.equal(redactText(faithful).text, faithful);
});

test('the review never cuts a row: wide, ambiguous and combining characters wrap within the panel', () => {
  const wide = record('echo', `${'日本語の出力'.repeat(30)} é\u0301 ${'🐈'.repeat(40)} TAIL\r\n`, 0, '✔ Completed · 1 ms');
  const review = createReportReview([wide], {...DEFAULT_REPORT_OPTIONS}, false);
  const seen: string[] = [];
  for (let page = 0; page < 20; page += 1) {
    const rows = renderReportReview(review, 50, 20).map(stripAnsi);
    assert.ok(rows.every(row => displayWidth(row) <= 50), 'every row fits');
    seen.push(...rows);
    reportReviewKey(review, {kind: 'pageDown'}, 20);
  }
  assert.ok(seen.some(row => row.includes('TAIL')), 'the end of the line was shown');
});

test('a working directory with a line break or backtick cannot add structure to a report', () => {
  const cwd = '/tmp/x`\n# Injected\n- **Status:** fine';
  const {text} = buildReport([record('ls', 'a\n', 0, '', {historicalContext: {cwd}})], {...DEFAULT_REPORT_OPTIONS, directory: true, redact: false});
  assert.equal(text.split('\n').some(line => /^# Injected|^- \*\*Status:\*\* fine/u.test(line)), false, text);
  assert.equal(buildReport([record('ls', 'a\n', 0, '', {historicalContext: {cwd}})], {...DEFAULT_REPORT_OPTIONS, format: 'plain', directory: true, redact: false}).text.split('\n').some(line => line === '# Injected'), false);
});

