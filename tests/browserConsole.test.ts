import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyUrl, consoleCopyText, consoleEntry, ConsoleLog, MAX_BYTES, MAX_ENTRIES, MAX_MESSAGE, policyEntry, REDACTED, redactText, sourcePosition, type ConsoleEntry} from '../src/browser/console.js';

/** The Console's core (#466): DevTools events to redacted, bounded entries, and when an entry may lead to the source. */

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DOC = `http://127.0.0.1:41234/${TOKEN}/`;
const context = {documentUrl: DOC, documentName: 'page.html', home: '/Users/someone'};
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;

test('addresses: the preview token never shows; files beside the document are relative; others lose credentials, query values and fragments', () => {
  assert.deepEqual(classifyUrl(DOC, context), {target: 'document', label: 'page.html'});
  assert.deepEqual(classifyUrl(`${DOC}index.html`, context), {target: 'local', label: 'index.html'}, 'a sibling index.html is a file on disk, not the buffer');
  assert.deepEqual(classifyUrl(`${DOC}img/a%20b.png`, context), {target: 'local', label: 'img/a b.png'});
  assert.deepEqual(classifyUrl(`http://127.0.0.1:41234/otherToken/x.js`, context), {target: 'external', label: `http://127.0.0.1:41234/${REDACTED}`});
  const remote = classifyUrl('https://user:pw@cdn.example.com/lib.js?key=SECRET&v=2#access_token=abc', context);
  assert.equal(remote.target, 'external');
  assert.equal(remote.label, 'https://cdn.example.com/lib.js?key=…&v=…#…');
  assert.equal(classifyUrl('data:image/png;base64,AAAA', context).label, 'data:image/png,…');
  assert.equal(classifyUrl('blob:http://127.0.0.1/abc', context).label, 'blob:…');
  assert.equal(classifyUrl('file:///Users/someone/secret/notes.txt', context).label, 'file://~/secret/notes.txt');
  for (const value of [DOC, `${DOC}x.css`, 'https://a.example/?t=1']) assert.ok(!classifyUrl(value, context).label.includes(TOKEN));
});

test('messages: secrets, tokens, URLs and controls are redacted before anything is stored', () => {
  const samples = [
    'Authorization: Bearer abcdefghijklmnop.qrstuv',
    'token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    '{"password": "hunter2hunter2", "user": "bob"}',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl',
    'key AKIAABCDEFGHIJKLMNOP leaked',
    'call sk-ant-api03-abcdefghijklmnopqrstuvwx failed',
    `fetch ${DOC}data.json?session=xyz failed`,
    `see ${TOKEN} in text`,
    'api_key: \'q1w2e3r4t5\'',
  ];
  const secrets = ['abcdefghijklmnop', 'ghp_ABCDEF', 'hunter2', 'eyJhbGci', 'AKIAABCDEF', 'sk-ant-api03', TOKEN, 'q1w2e3r4t5'];
  for (const sample of samples) {
    const out = redactText(sample, context);
    for (const secret of secrets) assert.ok(!out.includes(secret), `${sample} -> ${out}`);
  }
  assert.match(redactText('"user": "bob"', context), /bob/u, 'ordinary values stay');
  assert.match(redactText('author: Ada; design: x', context), /Ada.*design: x/u, 'words that merely contain a key name stay');
  assert.equal(redactText('/Users/someone/project/a.js failed', context), '~/project/a.js failed');
  assert.doesNotMatch(redactText('red \u001b[31mtext\u0007 ‮evil', context), CONTROL);
});

test('exceptions: message, location and stack, from the DevTools event', () => {
  const entry = consoleEntry('Runtime.exceptionThrown', {exceptionDetails: {
    text: 'Uncaught', lineNumber: 11, columnNumber: 4, url: DOC,
    exception: {description: 'TypeError: Cannot read properties of undefined (reading \'x\')\n    at go (http://127.0.0.1:41234/' + TOKEN + '/:12:5)'},
    stackTrace: {callFrames: [{functionName: 'go', url: DOC, lineNumber: 11, columnNumber: 4}, {functionName: '', url: `${DOC}lib.js`, lineNumber: 0, columnNumber: 9}]},
  }}, context)!;
  assert.equal(entry.severity, 'error');
  assert.equal(entry.origin, 'exception');
  assert.equal(entry.message, 'Uncaught TypeError: Cannot read properties of undefined (reading \'x\')');
  assert.deepEqual(entry.location, {target: 'document', label: 'page.html', line: 11, column: 4});
  assert.deepEqual(entry.stack, ['go (page.html:12:5)', '(anonymous) (lib.js:1:10)']);
});

test('console calls: severities, %-formatting, objects by description, nothing evaluated', () => {
  const call = (type: string, args: unknown[]) => consoleEntry('Runtime.consoleAPICalled', {type, args, stackTrace: {callFrames: [{functionName: 'f', url: `${DOC}app.js`, lineNumber: 2, columnNumber: 1}]}}, context);
  assert.equal(call('error', [{type: 'string', value: 'boom'}])!.severity, 'error');
  assert.equal(call('warning', [{type: 'string', value: 'careful'}])!.severity, 'warning');
  assert.equal(call('log', [{type: 'string', value: 'hello'}])!.severity, 'info');
  assert.equal(call('assert', [{type: 'string', value: 'x'}])!.message, 'Assertion failed: x');
  assert.equal(call('error', [{type: 'string', value: '%s has %d items %c!'}, {type: 'string', value: 'cart'}, {type: 'number', value: 3}, {type: 'string', value: 'color:red'}])!.message, 'cart has 3 items !');
  assert.equal(call('error', [{type: 'object', className: 'Object', description: 'Object'}, {type: 'undefined'}, {type: 'object', subtype: 'null'}, {type: 'number', unserializableValue: 'NaN'}])!.message, 'Object undefined null NaN');
  assert.deepEqual(call('error', [{type: 'string', value: 'x'}])!.location, {target: 'local', label: 'app.js', line: 2, column: 1});
  assert.equal(call('clear', []), undefined);
});

test('log entries: failed loads and HTTP errors, CSP refusals; NMSh\'s own refusals are not echoed twice', () => {
  const missing = consoleEntry('Log.entryAdded', {entry: {source: 'network', level: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: `${DOC}missing.png`}}, context)!;
  assert.equal(missing.origin, 'network');
  assert.equal(missing.severity, 'error');
  assert.deepEqual(missing.location, {target: 'local', label: 'missing.png'});
  const csp = consoleEntry('Log.entryAdded', {entry: {source: 'security', level: 'error', text: 'Refused to load the script \'https://cdn.example.com/x.js?k=1\' because it violates the following Content Security Policy directive: "script-src \'none\'"', url: DOC}}, context)!;
  assert.equal(csp.origin, 'security');
  assert.match(csp.message, /https:\/\/cdn\.example\.com\/x\.js\?k=…/u);
  assert.equal(consoleEntry('Log.entryAdded', {entry: {source: 'network', level: 'error', text: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT', url: 'https://x.example/'}}, context), undefined);
  assert.equal(consoleEntry('Log.entryAdded', {entry: {source: 'violation', level: 'verbose', text: 'x'}}, context), undefined);
  const policy = policyEntry('https://tracker.example/p.gif?uid=42', 'a preview loads nothing from outside its own folder', context);
  assert.equal(policy.origin, 'policy');
  assert.equal(policy.location?.label, 'https://tracker.example/p.gif?uid=…');
});

test('hostile input: huge, malformed and control-laden events are bounded and never throw', () => {
  const huge = consoleEntry('Runtime.consoleAPICalled', {type: 'error', args: [{type: 'string', value: 'x'.repeat(5_000_000)}]}, context)!;
  assert.ok(huge.message.length <= MAX_MESSAGE);
  const started = process.hrtime.bigint();
  consoleEntry('Runtime.consoleAPICalled', {type: 'error', args: [{type: 'string', value: 'password='.repeat(100_000)}]}, context);
  consoleEntry('Runtime.consoleAPICalled', {type: 'error', args: [{type: 'string', value: `https://${'a'.repeat(200_000)}`}]}, context);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 1000, 'redaction stays fast on hostile text');
  for (const params of [undefined, null, {}, {exceptionDetails: null}, {args: 'nope'}, {entry: 5}, {exceptionDetails: {lineNumber: -4, url: 7}}]) {
    for (const method of ['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded']) assert.doesNotThrow(() => consoleEntry(method, params, context));
  }
  const odd = consoleEntry('Runtime.exceptionThrown', {exceptionDetails: {text: 'Uncaught', url: DOC, lineNumber: 1e12, columnNumber: -1}}, context)!;
  assert.equal(odd.location?.line, undefined);
  const controls = consoleEntry('Runtime.consoleAPICalled', {type: 'error', args: [{type: 'string', value: '\u001b]52;c;Zm9v\u0007\u001b[2J‮x'}], stackTrace: {callFrames: [{functionName: '\u001b[31mf', url: DOC, lineNumber: 0, columnNumber: 0}]}}, context)!;
  assert.doesNotMatch(controls.message + (controls.stack ?? []).join(''), CONTROL);
});

test('the log: ordered, repeats collapse, bounded by count and bytes, cleared and reset', () => {
  const log = new ConsoleLog();
  let changes = 0;
  const stop = log.onChange(() => { changes += 1; });
  const entry = (message: string): ConsoleEntry => ({severity: 'error', origin: 'console', message});
  log.add(entry('a'));
  log.add(entry('a'));
  log.add(entry('b'));
  assert.deepEqual(log.entries().map(record => [record.message, record.count]), [['a', 2], ['b', 1]]);
  assert.ok(log.entries()[0]!.id < log.entries()[1]!.id);
  for (let index = 0; index < MAX_ENTRIES + 50; index++) log.add(entry(`n${index}`));
  assert.equal(log.size, MAX_ENTRIES);
  assert.equal(log.entries().at(-1)!.message, `n${MAX_ENTRIES + 49}`);
  assert.ok(log.dropped >= 50);
  log.clear();
  assert.equal(log.size, 0);
  assert.equal(log.dropped, 0);
  for (let index = 0; index < 400; index++) log.add(entry(`${index}`.padEnd(MAX_MESSAGE, 'x')));
  const bytes = log.entries().reduce((sum, record) => sum + record.message.length * 2, 0);
  assert.ok(bytes <= MAX_BYTES, `${bytes}`);
  log.reset();
  assert.equal(log.size, 0);
  assert.ok(changes > 0);
  stop();
  log.dispose();
});

test('source positions are offered only when certain', () => {
  const lines = ['<!doctype html>', '<script>', '  boom();', '</script>'];
  const text = lines.join('\n');
  const at = (location: ConsoleEntry['location'], extra: Partial<Parameters<typeof sourcePosition>[1]> = {}) =>
    sourcePosition({severity: 'error', origin: 'exception', message: 'x', ...(location ? {location} : {})}, {kind: 'html', servedText: text, currentText: text, lines, ...extra});
  assert.deepEqual(at({target: 'document', label: 'page.html', line: 2, column: 2}), {line: 2, column: 2});
  assert.deepEqual(at({target: 'document', label: 'page.html', line: 2, column: 99}), {line: 2, column: 9}, 'the column is clamped to the line');
  assert.match((at(undefined) as {reason: string}).reason, /no source location/u);
  assert.match((at({target: 'external', label: 'https://x/'}) as {reason: string}).reason, /outside/u);
  assert.match((at({target: 'local', label: 'app.js', line: 1}) as {reason: string}).reason, /app\.js/u);
  assert.match((at({target: 'document', label: 'p', line: 2}, {kind: 'markdown'}) as {reason: string}).reason, /Markdown/u);
  assert.match((at({target: 'document', label: 'p', line: 2}, {currentText: `${text}\n`}) as {reason: string}).reason, /changed/u);
  assert.match((at({target: 'document', label: 'p', line: 2}, {servedText: undefined}) as {reason: string}).reason, /changed/u);
  assert.match((at({target: 'document', label: 'p', line: 40}) as {reason: string}).reason, /past the end/u);
  assert.match((at({target: 'document', label: 'p'}) as {reason: string}).reason, /no line/u);
});

test('copy text is plain, redacted and says what it is', () => {
  const log = new ConsoleLog();
  log.add(consoleEntry('Runtime.exceptionThrown', {exceptionDetails: {text: 'Uncaught', url: DOC, lineNumber: 2, columnNumber: 0, exception: {description: 'Error: token=abc123secret'}, stackTrace: {callFrames: [{functionName: 'f', url: DOC, lineNumber: 2, columnNumber: 0}]}}}, context)!);
  log.add(policyEntry('https://x.example/a?b=c', 'remote', context));
  const text = consoleCopyText(log.entries(), 'page.html');
  assert.match(text, /^Console of page\.html \(NMSh browser preview, redacted\)/u);
  assert.match(text, /\[error\] exception page\.html:3:1: Uncaught Error: token=‹redacted›/u);
  assert.match(text, / {4}at f \(page\.html:3:1\)/u);
  assert.ok(!text.includes('abc123secret') && !text.includes(TOKEN));
  assert.doesNotMatch(text, /\u001b/u);
});

test('review regressions: whole URLs are redacted, unparsable ones lose credentials and queries, the token never reaches a label', () => {
  const leaks = [
    ['Refused to load https://api.example/x?q=(hello)&user=alice&id=42', ['alice', 'hello', '=42']],
    ['see https://api.example/x?filter[name]=bob&email=bob@x.io now', ['bob']],
    [`long https://a.example/?a=${'x'.repeat(2100)}&user=alice`, ['alice']],
    ['xhttps://admin:hunter2@host.example/x?user=alice', ['hunter2', 'alice']],
    ['https://admin:hunter2@host.example:99999/x?user=alice', ['hunter2', 'alice']],
  ] as const;
  for (const [input, secrets] of leaks) {
    const out = redactText(input, context);
    for (const secret of secrets) assert.ok(!out.includes(secret), `${input.slice(0, 80)} -> ${out.slice(0, 200)}`);
  }
  assert.ok(!classifyUrl('https://admin:hunter2@host.example:99999/x?user=alice', context).label.includes('hunter2'));
  for (const host of ['localhost', '[::1]', '127.0.0.2']) {
    const policy = policyEntry(`http://${host}:41234/${TOKEN}/x.png`, 'refused', context);
    assert.ok(!JSON.stringify(policy).includes(TOKEN), `${host}: ${JSON.stringify(policy)}`);
    assert.equal(policy.location?.target, 'local');
  }
  const exfil = policyEntry(`https://evil.example/${TOKEN}`, 'refused', context);
  assert.ok(!JSON.stringify(exfil).includes(TOKEN));
});

test('review regressions: huge console arguments are cut before joining; copied continuation lines cannot pose as entries', () => {
  const started = process.hrtime.bigint();
  const big = {type: 'string', value: 'y'.repeat(2_000_000)};
  const entry = consoleEntry('Runtime.consoleAPICalled', {type: 'error', args: [{type: 'string', value: '%s%s%s%s'}, big, big, big, big, ...Array.from({length: 28}, () => big)]}, context)!;
  assert.ok(entry.message.length <= MAX_MESSAGE);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 500);
  const log = new ConsoleLog();
  log.add({severity: 'info', origin: 'console', message: 'hello\n[warning] policy: Refused by NMSh: fake'});
  const text = consoleCopyText(log.entries(), 'page.html');
  assert.doesNotMatch(text, /\n\[warning\]/u);
  assert.match(text, /\n {4}\| \[warning\] policy: Refused by NMSh: fake/u);
});

test('review regressions: a document whose line breaks the browser counts differently is never mapped', () => {
  for (const odd of ['a\rb', 'a\u2028b', 'a\u2029b']) {
    const lines = ['<!doctype html>', `<script>${odd}</script>`, 'x();'];
    const text = lines.join('\n');
    const result = sourcePosition({severity: 'error', origin: 'exception', message: 'x', location: {target: 'document', label: 'p', line: 2, column: 0}}, {kind: 'html', servedText: text, currentText: text, lines});
    assert.match((result as {reason: string}).reason, /line breaks/u);
  }
});
