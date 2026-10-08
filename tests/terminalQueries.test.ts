import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryExtractor, ReplyRouter} from '../src/passthrough/TerminalQueries.js';

test('queries a program writes are picked out of its output, split or not; drawing and cursor reports are not', () => {
  const extract = new QueryExtractor();
  assert.equal(extract.push('hello\u001b[?2026$p\u001b[?2027$p\u001b]11;?\u0007'), '\u001b[?2026$p\u001b[?2027$p\u001b]11;?\u0007', 'agy\'s first write');
  assert.equal(extract.push('a\u001b[c\u001b[>c\u001b[>q\u001b[?u'), '\u001b[c\u001b[>c\u001b[>q\u001b[?u');
  assert.equal(extract.push('x\u001b[?20'), '');
  assert.equal(extract.push('26$py'), '\u001b[?2026$p', 'split across reads');
  assert.equal(extract.push('\u001b[6n\u001b[31mred\u001b[2J\u001b]0;title\u0007\u001b[?1049h'), '', 'DSR 6, SGR, clears, titles and modes are not queries');
  assert.equal(extract.push('\u001bP+q544e\u001b\\\u001b]4;1;?\u001b\\'), '\u001bP+q544e\u001b\\\u001b]4;1;?\u001b\\', 'XTGETTCAP and palette');
});

test('replies go to the program only while expected; keys, a lone Escape and arrows stay keys', () => {
  const router = new ReplyRouter();
  assert.deepEqual(router.split('\u001b[?2026;2$y', 0), {replies: '', rest: '\u001b[?2026;2$y'}, 'nothing expected: ordinary input');
  router.expect(1000);
  assert.deepEqual(router.split('ab\u001b[?2026;2$y\u001b[?2027;2$yc', 1001), {replies: '\u001b[?2026;2$y\u001b[?2027;2$y', rest: 'abc'});
  assert.deepEqual(router.split('\u001b]11;rgb:1e1e/1e1e/2e2e\u001b\\\u001b[?62;22c\u001bP>|ghostty 1.3.1\u001b\\\u001b[?1u', 1002),
    {replies: '\u001b]11;rgb:1e1e/1e1e/2e2e\u001b\\\u001b[?62;22c\u001bP>|ghostty 1.3.1\u001b\\\u001b[?1u', rest: ''});
  assert.deepEqual(router.split('\u001b', 1003), {replies: '', rest: '\u001b'}, 'Escape is never held');
  assert.deepEqual(router.split('\u001b[A\u001b[200~p\u001b[201~', 1004), {replies: '', rest: '\u001b[A\u001b[200~p\u001b[201~'});
  assert.deepEqual(router.split('\u001b]11;rgb:1e1e', 1005), {replies: '', rest: ''}, 'a reply split across reads is held');
  assert.deepEqual(router.split('/1e1e/2e2e\u0007k', 1006), {replies: '\u001b]11;rgb:1e1e/1e1e/2e2e\u0007', rest: 'k'});
  assert.deepEqual(router.split('\u001b[?2026;2$y', 5000), {replies: '', rest: '\u001b[?2026;2$y'}, 'after the window: input again');
  router.expect(6000);
  router.split('\u001b[?20', 6001);
  assert.equal(router.stop(), '\u001b[?20', 'what was held is handed back');
});
