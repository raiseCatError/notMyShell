import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AnsiOutputParser} from '../src/output/AnsiOutputParser.js';
import {HyperlinkPresenter, githubRepository, safeHyperlinkTarget} from '../src/output/Hyperlinks.js';
import {wrapStyledLine} from '../src/output/viewport.js';
import {stripAnsi, truncateAnsi} from '../src/util/text.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';

const open = (target: string) => `\u001B]8;;${target}\u001B\\`;
const close = open('');
const parse = (text: string) => { const parser = new AnsiOutputParser(); parser.write(text); return parser; };

test('generated schemes reject controls, credentials and unsafe schemes', () => {
  for (const target of ['javascript:alert(1)', 'data:text/plain,test', 'shell:rm', 'custom:test', 'https://a/\u001B\\oops', 'https://a/\u0007', 'https://a/\u009c', 'https://u:p@a/', 'file://remote/a']) assert.equal(safeHyperlinkTarget(target), undefined);
  assert.equal(safeHyperlinkTarget('https://example.com/é'), 'https://example.com/%C3%A9');
});

test('generated URLs preserve text, ANSI styles and row closure at narrow widths', () => {
  const source = parse('before \u001B[31mhttps://example.com/a\u001B[0m after').allLines()[0]!;
  const links = new HyperlinkPresenter();
  const decorated = links.line(source);
  assert.equal(source.some(cell => cell?.hyperlink), false);
  const rows = wrapStyledLine(decorated, 5, true);
  assert.equal(rows.map(row => stripAnsi(row.ansi)).join(''), 'before https://example.com/a after');
  for (const row of rows) if (row.ansi.includes(open('https://example.com/a'))) assert.ok(row.ansi.includes(close));
  assert.ok(rows.some(row => row.ansi.includes('\u001B[31m')));
  assert.equal(wrapStyledLine(decorated, 80, false)[0]!.ansi.includes(']8;'), false);
  assert.equal(links.line(source), decorated);
});

test('program links survive split OSC, SGR reset, mixed text and narrow rendering', () => {
  const parser = new AnsiOutputParser();
  parser.write('plain \u001B]8;id=original;https://original');
  parser.write('.test\u0007\u001B[32mlink\u001B[0m text');
  parser.write('\u001B]8;;\u001B\\ https://new.test');
  const source = parser.allLines()[0]!;
  const decorated = new HyperlinkPresenter().line(source);
  const rows = wrapStyledLine(decorated, 3, true);
  assert.equal(rows.map(row => stripAnsi(row.ansi)).join(''), 'plain link text https://new.test');
  assert.ok(rows.some(row => row.ansi.includes('8;id=original;https://original.test')));
  assert.ok(rows.some(row => row.ansi.includes(open('https://new.test/'))));
  assert.equal(wrapStyledLine(source, 80, false)[0]!.ansi.includes(']8;'), false);
  assert.equal(stripAnsi(truncateAnsi(rows.find(row => row.ansi.includes('8;id='))!.ansi, 2)).length, 2);
});

test('malformed payloads cannot escape links and incomplete OSC stays invisible', () => {
  for (const text of ['\u001B]8;broken\u0007plain', '\u001B]8;;https://a/\u001B[31m\u0007plain']) {
    const source = parse(text).allLines()[0]!;
    assert.equal(source.some(cell => cell?.hyperlink), false);
    assert.equal(stripAnsi(wrapStyledLine(source, 80, true)[0]!.ansi), 'plain');
  }
  const parser = parse('visible\u001B]8;;https://unfinished');
  assert.equal(parser.plainCurrentLine(), 'visible');
});

test('existing paths use owning cwd and encoded file URLs; refs require origin', () => {
  const root = mkdtempSync(join(tmpdir(), 'links-'));
  try {
    writeFileSync(join(root, 'file.txt'), 'test');
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git/config'), '[remote "origin"]\n url = git@github.com:owner/project.git\n');
    assert.equal(githubRepository(root), 'https://github.com/owner/project');
    const source = parse('file.txt ./missing #123 #tag #123abc').allLines()[0]!;
    const presenter = new HyperlinkPresenter();
    const ansi = wrapStyledLine(presenter.line(source, root), 80, true)[0]!.ansi;
    assert.ok(ansi.includes('file://'));
    assert.ok(ansi.includes('https://github.com/owner/project/issues/123'));
    assert.equal((ansi.match(/\u001B\]8;;[^\u001B]+/gu) ?? []).length, 2);
    assert.equal(wrapStyledLine(presenter.line(source), 80, true)[0]!.ansi.includes(']8;'), false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('mutable current rows invalidate recognition without altering source', () => {
  const parser = parse('https://one.test');
  const presenter = new HyperlinkPresenter();
  const source = parser.allLines()[0]!;
  assert.ok(wrapStyledLine(presenter.line(source), 80, true)[0]!.ansi.includes('one.test'));
  parser.write('\rhttps://two.test');
  const row = wrapStyledLine(presenter.line(source), 80, true)[0]!;
  assert.ok(row.ansi.includes(open('https://two.test/')));
  assert.equal(row.ansi.includes(open('https://one.test/')), false);
});

test('transcript and copy remain identical across capable presentation', () => {
  const buffer = new OutputBuffer();
  buffer.addHistoryLine('https://example.com');
  const before = JSON.stringify(buffer.transcript());
  buffer.presenter.setHyperlinks(true);
  assert.ok(buffer.wrapped(5).some(row => row.ansi.includes(']8;')));
  assert.equal(JSON.stringify(buffer.transcript()), before);
  buffer.presenter.setHyperlinks(false);
  assert.equal(buffer.wrapped(5).some(row => row.ansi.includes(']8;')), false);
});

test('oversized incomplete OSC is drained with bounded retention across chunks', () => {
  const parser = parse('before\u001B]8;;' + 'x'.repeat(9000));
  parser.write('payload\u001B');
  parser.write('\\after');
  assert.equal(parser.plainCurrentLine(), 'beforeafter');
  assert.equal(parser.allLines()[0]!.some(cell => cell?.hyperlink), false);
});

test('program link metadata survives transcript restore but never plain text', () => {
  const parser = parse(open('https://original.test') + 'label' + close + ' plain');
  const snapshot = parser.snapshot();
  const restored = new AnsiOutputParser();
  restored.restore(snapshot);
  assert.equal(restored.snapshotPlain(0), 'label plain');
  assert.equal(wrapStyledLine(restored.allLines()[0]!, 80, true)[0]!.ansi, wrapStyledLine(parser.allLines()[0]!, 80, true)[0]!.ansi);
});

test('partial original links suppress competing generated targets', () => {
  const source = parse('https://' + open('https://original.test') + 'example' + close + '.com').allLines()[0]!;
  const ansi = wrapStyledLine(new HyperlinkPresenter().line(source), 80, true)[0]!.ansi;
  assert.ok(ansi.includes(open('https://original.test')));
  assert.equal(ansi.includes(open('https://example.com/')), false);
});

test('balanced URL parentheses and restored invalid OSC payloads stay safe', () => {
  const source = parse('(https://example.com/a(b))').allLines()[0]!;
  assert.ok(wrapStyledLine(new HyperlinkPresenter().line(source), 80, true)[0]!.ansi.includes(open('https://example.com/a(b)')));
  const malicious = [{text: 'label', width: 5, style: '', hyperlink: '8;;https://a/\u001B[2J'}];
  assert.equal(wrapStyledLine(malicious, 80, true)[0]!.ansi.includes(']8;'), false);
});
