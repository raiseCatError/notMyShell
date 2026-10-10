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
