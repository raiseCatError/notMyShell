import test from 'node:test';
import assert from 'node:assert/strict';
import {findOutputReferences, MAX_REFERENCES, referenceFollowUp} from '../src/output/references.js';

const refs = (command: string, output: string) => findOutputReferences({command, output});
const labels = (command: string, output: string) => refs(command, output).map(reference => reference.label);

test('source locations: relative, absolute, with columns; a bare word or a number is not a location', () => {
  const found = refs('npm test', 'at src/main.ts:42:7\n  /abs/path/file.py:9\nsee 3:45 and version 1.2:3 and foo\n');
  assert.deepEqual(found.map(item => [item.kind, item.value, item.line, item.column]), [['file', 'src/main.ts', 42, 7], ['file', '/abs/path/file.py', 9, undefined]]);
});

test('links: http(s) only, trailing punctuation trimmed, brackets kept only when balanced', () => {
  assert.deepEqual(labels('curl x', 'see https://example.com/a?b=1. And (https://example.com/x) or https://en.wikipedia.org/wiki/Foo_(bar), ok'),
    ['https://example.com/a?b=1', 'https://example.com/x', 'https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(labels('x', 'ftp://example.com/a file:///etc/passwd javascript:alert(1) data:text/html,x'), []);
});

test('a link with credentials is a secret, not a destination', () => {
  assert.deepEqual(labels('git clone x', 'https://user:token@github.com/a/b.git https://token@github.com/a/b.git'), []);
});

test('an international host is shown as the punycode it really is', () => {
  const [link] = refs('x', 'https://аpple.com/login');
  assert.equal(link?.kind, 'url');
  assert.match(link!.value, /^https:\/\/xn--/u);
});

test('hostile text: controls, bidi and zero-width characters make a reference unusable, never repaired', () => {
  assert.deepEqual(labels('x', 'https://exa​mple.com/a https://example.com/‮evil src/\u0007bell.ts:3 src/a‮.ts:3'), []);
  // An escape sequence around a path is stripped as terminal styling; the path itself stays.
  assert.deepEqual(labels('x', '\u001b[31msrc/main.ts:3\u001b[0m'), ['src/main.ts:3']);
  assert.deepEqual(labels('x', 'src/main.ts:3\u001b]8;;https://evil.example\u0007 click\u001b]8;;\u0007'), ['src/main.ts:3']);
});

test('commits are only recognised in Git output, in the places Git prints them', () => {
  const log = 'commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\nAuthor: x\n\n    fixed 1234567 things\n* 9fceb02 subject\n[main 4f2a1c9] message\n';
  assert.deepEqual(labels('git log', log), ['a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', '9fceb02', '4f2a1c9']);
  assert.deepEqual(labels('cat file', log), []);
  assert.deepEqual(labels('FOO=1 git log --oneline', '1234567 all digits is not a commit\ndead6ee ok\n'), ['dead6ee']);
});

test('devices are only recognised in `adb devices`, and only a ready device has a follow-up', () => {
  const output = 'List of devices attached\nR58M12ABC\tdevice\nemulator-5554\toffline\n192.168.1.5:5555\tdevice\n* daemon started successfully\n';
  const found = refs('adb devices', output);
  assert.deepEqual(found.map(item => item.value), ['R58M12ABC', 'emulator-5554', '192.168.1.5:5555']);
  assert.deepEqual(refs('adb devices -l', output).length, 3);
  assert.deepEqual(refs('echo', output), []);
  assert.deepEqual(referenceFollowUp(found[0]!), ['adb', '-s', 'R58M12ABC', 'shell']);
  assert.equal(referenceFollowUp(found[1]!), undefined);
});

test('follow-ups are argv the person reviews: a hostile value never becomes one', () => {
  assert.equal(referenceFollowUp({id: 'x', kind: 'commit', value: 'a1b2c3d; rm -rf ~', label: ''}), undefined);
  assert.equal(referenceFollowUp({id: 'x', kind: 'device', value: 'x; reboot', label: '', state: 'device'}), undefined);
  assert.equal(referenceFollowUp({id: 'x', kind: 'file', value: 'a.ts', label: '', line: 1}), undefined);
  assert.deepEqual(referenceFollowUp({id: 'x', kind: 'commit', value: 'dead6ee', label: ''}), ['git', 'show', 'dead6ee']);
});

test('repeats are one reference; the list and the work are bounded for any output', () => {
  assert.equal(refs('x', 'src/a.ts:1\nsrc/a.ts:1\nsrc/a.ts:2\n').length, 2);
  const huge = Array.from({length: 5000}, (_, index) => `src/file${index}.ts:${index + 1}`).join('\n');
  assert.equal(refs('x', huge).length, MAX_REFERENCES);
  const started = Date.now();
  refs('x', `${'a'.repeat(3_000_000)}\n${'https://example.com/'.repeat(2000)}\n`);
  assert.ok(Date.now() - started < 3000);
});
