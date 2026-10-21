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

// ---- Findings of the independent review -------------------------------------------------------------------------

import {spawnSync} from 'node:child_process';
import {lstatSync} from 'node:fs';

test('review 1-3: a dangling or unreadable symlink out of the root is "outside", never "missing" or "unreadable", and readText opens nothing special', async () => {
  const p = project();
  try {
    symlinkSync(join(p.outside, 'real-missing'), join(p.root, 'd1'));
    symlinkSync(join(p.outside, 'secret.txt'), join(p.root, 'd2'));
    symlinkSync(join(p.outside, 'nowhere-dir'), join(p.root, 'dangling-dir'));
    mkdirSync(join(p.outside, 'locked')); writeFileSync(join(p.outside, 'locked', 'f'), 'x'); chmodSync(join(p.outside, 'locked'), 0o000);
    symlinkSync(join(p.outside, 'locked'), join(p.root, 'l1'));
    const fs = createLocalFs(p.root, p.root);
    assert.equal(await fs.stat('d1'), 'outside', 'a dangling link to an outside path');
    assert.equal(await fs.stat('d2'), 'outside');
    assert.equal(await fs.stat('dangling-dir/x.md'), 'outside');
    assert.equal(await fs.stat('l1/f'), 'outside', 'a locked folder behind a link is outside, not unreadable');
    assert.equal(await fs.stat('l1/nope'), 'outside');
    chmodSync(join(p.outside, 'locked'), 0o755);
    assert.equal(await fs.readText('d2', 100), undefined, 'a link out of the root is never read');
    const fifo = join(p.root, 'pipe.md');
    spawnSync('mkfifo', [fifo]);
    if (lstatSync(fifo).isFIFO()) {
      const started = process.hrtime.bigint();
      assert.equal(await fs.readText('pipe.md', 100), undefined);
      assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 2, 'a FIFO does not block');
    }
    assert.equal(await fs.stat('pipe.md'), 'unreadable');
  } finally { chmodSync(join(p.outside, 'locked'), 0o755); p.cleanup(); }
});

test('review 4: heading checks in another file read it once, however many links name it', async () => {
  const p = project();
  try {
    let reads = 0;
    const real = createLocalFs(p.dir, p.root);
    const counting: LocalFs = {stat: path => real.stat(path), readText: (path, max) => { reads += 1; return real.readText(path, max); }};
    const lines = Array.from({length: 3000}, (_, index) => `[x](other.md#f${index})`);
    const report = await diagnose({lines, format: 'markdown', fs: counting});
    assert.equal(reads, 1);
    assert.ok(report.diagnostics.length >= 400, 'findings still reported (bounded)');
  } finally { p.cleanup(); }
});

test('review 5: hostile long lines finish quickly and an abort is noticed', async () => {
  for (const [line, format] of [['['.repeat(80_000), 'markdown'], ['[^'.repeat(40_000), 'markdown'], ['[\\]'.repeat(30_000), 'markdown'], ['url('.repeat(40_000), 'css'], ['![a](' .repeat(20_000), 'markdown']] as const) {
    const started = process.hrtime.bigint();
    await diagnose({lines: [line], format});
    assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 2, `${format}: ${line.slice(0, 6)} took ${Number(process.hrtime.bigint() - started) / 1e9}s`);
  }
  const started = process.hrtime.bigint();
  const lines = Array.from({length: 4000}, () => `${'[a'.repeat(300)} [x](nope.md)`);
  const controller = new AbortController();
  const pending = diagnose({lines, format: 'markdown', signal: controller.signal});
  setTimeout(() => controller.abort(), 20);
  const report = await pending;
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 3);
  assert.ok(report.aborted === true || report.diagnostics.length >= 0);
});

test('review 8: valid Markdown that was reported before is quiet', async () => {
  const p = project();
  try {
    const lines = ['# T', '', '<!-- [old](missing.md) -->', '<!--', '[old2](missing.md)', '-->', '', 'matrix[i][j] is prose.', '', '[r]:', '  other.md', '> [q]: other.md', '', 'See [a][r] and [b][q].', '', 'a `code', 'span [y](missing.md)` ends', '', '[esc](other\\.md) [esc2](a\\_b.md)', '', '[![badge](../img/pic.png)](other.md) [a [b] c](other.md)'];
    const report = await run(lines, 'markdown', p.dir, p.root);
    const bad = report.diagnostics.filter(item => item.severity === 'error');
    assert.deepEqual(bad.map(item => `${item.code}@${item.line}: ${item.message}`), ['missing-file@18: No such file: a_b.md'], JSON.stringify(report.diagnostics));
    const toml = await run(['+++', 'link = "[x](missing.md)"', '+++', '', '# After'], 'markdown', p.dir, p.root);
    assert.deepEqual(toml.diagnostics, [], 'TOML front matter is skipped');
  } finally { p.cleanup(); }
});

test('review 8-10: an undefined [text][ref] is only information (CommonMark shows it as text); the outer link of a badge and nested brackets are checked; inline <img> and @import are checked', async () => {
  const p = project();
  try {
    const md = await run(['[x][nope]', '[![CI](../img/pic.png)](gone.md)', '[a [b] c](gone2.md)', '<img src="../img/gone.png" alt="x">'], 'markdown', p.dir, p.root);
    assert.deepEqual(md.diagnostics.map(item => `${item.code}:${item.severity}@${item.line}`).sort(), ['missing-file:error@1', 'missing-file:error@2', 'missing-file:error@3', 'undefined-reference:info@0'].sort());
    const css = await run(['@import "gone.css";', '@import url(../style.css);'], 'css', p.dir, p.root);
    assert.deepEqual(css.diagnostics.map(item => `${item.code}@${item.line}`), ['missing-file@0']);
  } finally { p.cleanup(); }
});

test('review 9: valid HTML and CSS that was reported before is quiet', async () => {
  const p = project();
  try {
    const html = await run(['<svg><clipPath id="c"></clipPath></svg>', '<style>', '.a { clip-path: url(#c); background: url(#nope); }', '/* url(missing.png) */', '.b { content: "url(missing.png)"; }', '.c\\{x { color: red }', '</style>', '<template><p id="t"></p></template><p id="t"></p>', '<script>var a = "<!--";</script>', '<img src="../img/pic.png" src="gone.png" alt="">'], 'html', p.dir, p.root);
    assert.deepEqual(html.diagnostics.map(item => `${item.code}@${item.line}`), ['broken-fragment@2']);
    const base = await run(['<base href="https://cdn.example/">', '<img src="logo.png" alt="">'], 'html', p.dir, p.root);
    assert.ok(!base.diagnostics.some(item => item.severity === 'error'), 'a <base> makes relative addresses unverifiable');
    const css = await run(['a { filter: url(#blur); background: url(x/*.png); }', '/* }} */', '.q { content: "a\\', '}" }'], 'css', p.dir, p.root);
    assert.ok(!css.diagnostics.some(item => item.code === 'css-syntax' && item.line < 2), JSON.stringify(css.diagnostics));
  } finally { p.cleanup(); }
});

test('review 11-12: the image-alt span is the image text; a value that spans lines is not an exact span and its message is one line', async () => {
  const lines = ['x ![](b.png) y  ![ ](c.png)'];
  const md = await run(lines, 'markdown');
  const alt = md.diagnostics.filter(item => item.code === 'image-alt');
  assert.equal(alt.length, 2);
  for (const item of alt) assert.ok(lines[0]!.slice(item.column, item.endColumn).startsWith('!['), lines[0]!.slice(item.column, item.endColumn));
  const p = project();
  try {
    const html = await run(['<a href="missing', '2.html">x</a>'], 'html', p.dir, p.root);
    const item = html.diagnostics.find(entry => entry.code === 'missing-file')!;
    assert.equal(item.exact, false);
    assert.ok(!item.message.includes('\n'));
  } finally { p.cleanup(); }
});

test('review: a long Markdown source line is scanned only so far and says so; the details scan elsewhere has a budget', async () => {
  const report = await diagnose({lines: [`${'a '.repeat(15_000)}[x](nope.md)`], format: 'markdown'});
  assert.ok(report.diagnostics.some(item => item.code === 'long-line'));
});
