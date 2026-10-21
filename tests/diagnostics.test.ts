import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalFs, diagnose, type Diagnostic} from '../src/markdown/diagnostics.js';

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-diag-')));
  mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'img'));
  writeFileSync(join(root, 'docs', 'other.md'), '# Other\n\n## Install steps\n');
  writeFileSync(join(root, 'img', 'pic.png'), 'x'); writeFileSync(join(root, 'style.css'), 'a{}'); writeFileSync(join(root, 'app.js'), '');
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-diag-out-')));
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  return {root, outside, dir: join(root, 'docs'), cleanup: () => { rmSync(root, {recursive: true, force: true}); rmSync(outside, {recursive: true, force: true}); }};
}
const run = async (lines: string[], format: 'markdown' | 'html' | 'css', dir?: string, root?: string) =>
  diagnose({lines, format, ...(dir ? {fs: createLocalFs(dir, root ?? dir)} : {})});
const codes = (list: Diagnostic[]) => list.map(item => `${item.code}@${item.line}`);

test('markdown links: a missing file and a missing fragment are errors; existing targets and in-file anchors are not; external URLs are not checked', async () => {
  const p = project();
  try {
    const report = await run(['# Title', '', '## Install steps', '', '[ok](other.md) [bad](nope.md) [frag](#install-steps) [badfrag](#missing)', '[site](https://example.com/x) [mail](mailto:a@b.c) <https://example.com>', '[inother](other.md#install-steps) [badother](other.md#nothing)'], 'markdown', p.dir, p.root);
    assert.deepEqual(codes(report.diagnostics).sort(), ['broken-fragment@4', 'broken-fragment-in-file@6', 'missing-file@4'].sort());
    assert.equal(report.diagnostics.find(item => item.code === 'missing-file')!.severity, 'error');
    assert.equal(report.external, 3, 'counted, never fetched, never an error');
    const bad = report.diagnostics.find(item => item.code === 'missing-file')!;
    assert.equal(['[ok](other.md) [bad](nope.md) [frag](#install-steps) [badfrag](#missing)'].map(line => line.slice(bad.column!, bad.endColumn!))[0], 'nope.md', 'the span is exactly the destination');
    assert.equal(bad.exact, true);
  } finally { p.cleanup(); }
});

test('images: a missing local image is an error and a missing alt text a warning; the alt check is independent of the file', async () => {
  const p = project();
  try {
    const report = await run(['![pic](../img/pic.png) ![](../img/pic.png) ![gone](../img/gone.png)'], 'markdown', p.dir, p.root);
    assert.deepEqual(codes(report.diagnostics).sort(), ['image-alt@0', 'missing-file@0']);
  } finally { p.cleanup(); }
});

test('reference links and footnotes: undefined ones are errors, unused definitions warnings; shortcut text in brackets is not guessed', async () => {
  const report = await run(['See [text][ref] and [other][missing] and [collapsed][] and [just brackets] and a footnote[^1] and another[^2].', '', '[ref]: https://example.com', '[collapsed]: other.md', '', '[^1]: ok', '[^3]: unused'], 'markdown');
  assert.deepEqual(codes(report.diagnostics).sort(), ['undefined-footnote@0', 'undefined-reference@0', 'unreferenced-footnote@6', 'unverified-local@3'].sort());
});

test('headings: a repeated heading is informational; code fences, code spans, front matter and escaped brackets are not scanned', async () => {
  const report = await run(['---', 'title: [x](nope.md)', '---', '# Same', '', '# Same', '', '```', '[a](nope.md)', '```', '', 'inline `[b](nope.md)` and \\[c\\](nope.md)'], 'markdown');
  assert.deepEqual(codes(report.diagnostics), ['duplicate-heading@5']);
  assert.equal(report.diagnostics[0]!.severity, 'info');
});

test('hostile destinations are never probed: absolute paths, parent escapes, symlinks out of the root, schemes, huge and odd input', async () => {
  const p = project();
  try {
    symlinkSync(p.outside, join(p.root, 'docs', 'linkout'));
    const lines = [`[abs](/etc/passwd) [home](~/.ssh/id_rsa) [up](../../${p.outside.split('/').pop()}/secret.txt) [sym](linkout/secret.txt)`, '[js](javascript:alert(1)) [data](data:text/html,<script>) [file](file:///etc/passwd) [nul](a%00b.md) ' + `[long](${'a/'.repeat(600)}x.md)`];
    const report = await run(lines, 'markdown', p.dir, p.root);
    const byCode = new Map(report.diagnostics.map(item => [item.code + '@' + item.line, item]));
    assert.ok(byCode.has('absolute-path@0') && byCode.has('outside-root@0'), JSON.stringify(codes(report.diagnostics)));
    assert.equal(report.diagnostics.filter(item => item.code === 'outside-root').length, 2, 'the parent escape and the symlink are outside');
    assert.equal(report.diagnostics.filter(item => item.code === 'absolute-path').length, 2, 'absolute and home paths are never probed');
    assert.ok(report.diagnostics.every(item => item.code !== 'missing-file' || !/secret|passwd|ssh/u.test(item.message)), 'a probe result never names a path outside the root');
    assert.ok(report.diagnostics.some(item => item.code === 'unsafe-scheme' && item.line === 1));
    assert.ok(!report.diagnostics.some(item => item.code === 'ok'));
  } finally { p.cleanup(); }
});

test('the filesystem checker: files, directories, missing, unreadable, symlink inside the root, and a bounded number of checks', async () => {
  const p = project();
  try {
    const fs = createLocalFs(p.dir, p.root);
    assert.equal(await fs.stat('other.md'), 'file');
    assert.equal(await fs.stat('../img'), 'directory');
    assert.equal(await fs.stat('nope.md'), 'missing');
    assert.equal(await fs.stat('../../outside'), 'outside');
    symlinkSync(join(p.root, 'img', 'pic.png'), join(p.dir, 'alias.png'));
    assert.equal(await fs.stat('alias.png'), 'file', 'a link that stays inside the root is followed');
    mkdirSync(join(p.dir, 'locked')); chmodSync(join(p.dir, 'locked'), 0o000);
    assert.ok(['unreadable', 'missing'].includes(await fs.stat('locked/x.md')));
    chmodSync(join(p.dir, 'locked'), 0o755);
    const many = Array.from({length: 900}, (_, index) => `[l](missing-${index}.md)`);
    const report = await diagnose({lines: many, format: 'markdown', fs, maxChecks: 100});
    assert.equal(report.truncated, true);
    assert.ok(report.checked <= 100);
  } finally { p.cleanup(); }
});

test('no filesystem (an unsaved document): relative references are unverified, not errors; in-document checks still run', async () => {
  const report = await run(['# A', '', '[x](other.md) [y](#a) [z](#b)'], 'markdown');
  assert.deepEqual(codes(report.diagnostics).sort(), ['broken-fragment@2', 'unverified-local@2']);
  assert.equal(report.diagnostics.find(item => item.code === 'unverified-local')!.severity, 'unverified');
});

test('CRLF stray carriage returns, BOM text and Unicode keep line and column right', async () => {
  const report = await run(['日本語 😀 [bad](nope.md)', 'a\rb [also](nope2.md)'], 'markdown');
  assert.deepEqual(report.diagnostics.map(item => [item.line, item.code]), [[0, 'unverified-local'], [1, 'unverified-local']]);
  assert.equal('日本語 😀 [bad](nope.md)'.slice(report.diagnostics[0]!.column!, report.diagnostics[0]!.endColumn!), 'nope.md');
});

test('html: missing assets, alt text, form labels, duplicate ids, unresolved fragments, malformed nesting; templated attributes are unverified, not errors', async () => {
  const p = project();
  try {
    const html = ['<!doctype html>', '<html><head><link rel="stylesheet" href="../style.css"><link rel="stylesheet" href="../gone.css"><script src="../app.js"></script></head>', '<body>', '<img src="../img/pic.png"><img src="../img/gone.png" alt="x"><img src="{{ dynamic }}" alt="d">', '<div id="a"></div><div id="a"></div>', '<a href="#a">ok</a> <a href="#nowhere">bad</a> <a href="https://example.com">ext</a>', '<label for="n">Name</label><input id="n"><input id="m"><input type="hidden" name="h"><label>Wrap <input></label><input aria-label="named">', '<p><b>unclosed</p>', '<ul><li>one<li>two</ul>', '<script>if (a < b) { x = "<img src=nope.png>"; }</script>', '</div>', '</body></html>'];
    const report = await run(html, 'html', p.dir, p.root);
    const list = codes(report.diagnostics);
    for (const expected of ['missing-file@1', 'image-alt@3', 'missing-file@3', 'duplicate-id@4', 'broken-fragment@5', 'form-label@6', 'unclosed-tag@7', 'unexpected-closing-tag@10']) assert.ok(list.includes(expected), `${expected} in ${JSON.stringify(list)}`);
    assert.ok(!list.some(code => code === 'missing-file@9'), 'text inside a script is not markup');
    assert.equal(list.filter(code => code.startsWith('form-label')).length, 1, 'only the unlabeled input; labeled, hidden, wrapped and aria-labelled ones are fine');
    assert.ok(report.diagnostics.some(item => item.code === 'unverified-dynamic' && item.severity === 'unverified'));
    assert.ok(!list.includes('unclosed-tag@8'), 'optional end tags (li) are valid');
  } finally { p.cleanup(); }
});

test('css: url() assets are checked in .css and <style>; unbalanced braces are a warning; data: and fragments are fine', async () => {
  const p = project();
  try {
    const css = await run(['a { background: url(../img/pic.png); }', 'b { background: url("../img/gone.png"); }', 'c { background: url(data:image/png;base64,AAAA); }', 'd { color: red;'], 'css', p.dir, p.root);
    assert.deepEqual(codes(css.diagnostics).sort(), ['css-syntax@3', 'missing-file@1']);
    const html = await run(['<style>', 'p { background: url(../img/gone.png) }', '</style>'], 'html', p.dir, p.root);
    assert.deepEqual(codes(html.diagnostics), ['missing-file@1']);
  } finally { p.cleanup(); }
});

test('valid unconventional markup produces nothing: a stress document of legal oddities has no false positives', async () => {
  const p = project();
  try {
    const lines = ['# A', '', '<details><summary>x</summary>', '', 'text [^n]', '', '</details>', '', '[^n]: note', '', '| a | b |', '|---|---|', '| [x](#a) | ![y](../img/pic.png "title") |', '', '<img src="../img/pic.png" alt="">', '', '[ref]: <../img/pic.png> "Title"', '[use][ref] and [Ref][] and autolink <https://x.y/z>', '', '1. [x](../docs/other.md)'];
    const report = await run(lines, 'markdown', p.dir, p.root);
    assert.deepEqual(report.diagnostics.map(item => `${item.code}@${item.line}`), [`missing-file@19`].filter(() => false), JSON.stringify(report.diagnostics));
  } finally { p.cleanup(); }
});

test('performance: 20,000 lines with many links finish quickly and respect the check bound; an aborted run returns nothing new', async () => {
  const p = project();
  try {
    const lines = Array.from({length: 20_000}, (_, index) => `Line ${index} [a](#h${index % 50}) [b](other.md) text *em*`);
    const started = process.hrtime.bigint();
    const report = await diagnose({lines, format: 'markdown', fs: createLocalFs(p.dir, p.root)});
    assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 5);
    assert.ok(report.checked <= 2, 'one file path is checked once, however many links name it');
    const controller = new AbortController(); controller.abort();
    const aborted = await diagnose({lines, format: 'markdown', signal: controller.signal});
    assert.equal(aborted.aborted, true);
  } finally { p.cleanup(); }
});
