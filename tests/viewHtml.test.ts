import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderHtml, renderMarkdown} from '../src/markdown/render.js';
import {formatForPath, type ViewDocument} from '../src/viewer/document.js';
import {createViewer, renderViewer, viewerKey} from '../src/viewer/ViewerPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

/**
 * QA F01 (v0.22): `/view` showed a README's embedded HTML (`<picture>`, `<img>`, `<div>`) literally. HTML is now
 * rendered natively, as terminal rows, for HTML files and for HTML inside Markdown that `/view` shows: a supported
 * subset (headings, paragraphs, lists, tables, code, quotes, rules, inline emphasis, code, links and images) mapped onto
 * the Markdown renderer's own blocks. Nothing is executed, fetched or read: scripts, styles, embedded content and event
 * handlers are dropped, CSS is ignored, an image is its alt text, links follow the renderer's http(s)-only rule, and
 * the parser is linear and bounded in depth, tags and attribute length. Agent replies and GitHub bodies keep showing
 * tags as text: HTML is rendered only where `/view` asks for it.
 */

const plain = (rows: ReadonlyArray<{plain: string}>) => rows.map(row => row.plain).join('\n');
const markdown = (source: string, columns = 80) => renderMarkdown(source, columns, {level: 'truecolor', glyphs: 'nerd', html: true});
const html = (source: string, columns = 80, hyperlinks = false) => renderHtml(source, columns, {level: 'truecolor', glyphs: 'nerd', hyperlinks});

const README = `<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
  <img alt="NMSh logo" src="docs/logo-light.png" width="240">
</picture>

# notMyShell

<p align="center">
  <a href="https://github.com/raiseCatError/notMyShell/actions"><img src="https://img.shields.io/badge/CI-passing-green" alt="CI status"></a>
  <b>A calmer terminal</b> for <i>zsh</i>, Bash and Fish.
</p>

</div>

Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop.<br>Next line.

- one
- two`;

test('F01: a README\'s embedded HTML renders: images as alt text, inline styles, Markdown between the blocks unchanged', () => {
  const rows = markdown(README, 120);
  const text = plain(rows);
  for (const tag of ['<div', '</div>', '<picture', '<source', '<img', '<p ', '</p>', '<a ', '<b>', '<i>', '<kbd>', '<br>']) assert.ok(!text.includes(tag), `${tag} is not shown`);
  assert.match(text, /\[image: NMSh logo\]/u);
  assert.match(text, /\[image: CI status\]/u);
  assert.ok(rows.some(row => row.kind === 'heading' && row.plain === 'notMyShell'), 'Markdown between HTML blocks still renders');
  assert.match(text, /A calmer terminal for zsh, Bash and Fish\./u);
  assert.match(text, /Press Ctrl\+C to stop\. Next line\./u);
  assert.match(text, /• one\n• two/u);
  const styled = rows.map(row => row.ansi).join('\n');
  assert.match(styled, /\u001b\[1m[^\n]*A/u, '<b> is bold');
});

test('F01: an HTML document renders its structure: headings, paragraphs, nested lists, tables, code, quotes and rules', () => {
  const rows = html(`<!DOCTYPE html><html><head><title>T</title><style>h1{color:red}</style></head><body>
    <h1>Guide &amp; notes</h1>
    <p>First   paragraph
       with <strong>strong</strong>, <em>em</em>, <code>a &lt; b</code> and <del>old</del>.</p>
    <ol start="3"><li>three<ul><li>nested</li></ul></li><li>four</li></ol>
    <table><thead><tr><th align="left">Key</th><th align="right">Value</th></tr></thead>
      <tbody><tr><td>a</td><td>1</td></tr><tr><td>b | c</td><td>2</td></tr></tbody></table>
    <pre><code class="language-ts">const x = 1 &lt; 2;
  return x;</code></pre>
    <blockquote><p>Quoted</p></blockquote>
    <hr>
    <ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox" disabled> open</li></ul>
    <details><summary>More</summary><p>Hidden text</p></details>
  </body></html>`);
  const text = plain(rows);
  assert.ok(rows.some(row => row.kind === 'heading' && row.plain === 'Guide & notes'));
  assert.match(text, /First paragraph with strong, em, a < b and old\./u, 'whitespace collapses; entities decode');
  assert.match(text, /3\. three\n {3}◦ nested\n4\. four/u);
  assert.ok(rows.some(row => row.kind === 'table' && /Key/u.test(row.plain) && /Value/u.test(row.plain)));
  assert.ok(rows.some(row => row.kind === 'table' && /b \| c/u.test(row.plain)), 'a cell keeps its own pipe');
  assert.ok(rows.some(row => row.kind === 'code' && /const x = 1 < 2;/u.test(row.plain)));
  assert.ok(rows.some(row => row.kind === 'code' && /^\s*return x;/u.test(row.plain.replace(/^.*?│ ?/u, ''))) || /return x;/u.test(text));
  assert.ok(rows.some(row => row.kind === 'quote' && /Quoted/u.test(row.plain)));
  assert.ok(rows.some(row => row.kind === 'rule'));
  assert.match(text, /☑ done\n☐ open/u);
  assert.match(text, /More\n*Hidden text/u);
  assert.doesNotMatch(text, /color:red|<title>|\bT\b\n/u, 'head and styles are not content');
});

test('F01 security: nothing executes, loads or styles: scripts, styles, handlers, embeds and unsafe links are dropped', () => {
  const rows = html(`<p onclick="alert(1)">Safe <span style="color:red">text</span></p>
    <script>alert('x')</script><style>p{display:none}</style><template><p>tmpl</p></template>
    <noscript>ns</noscript><iframe src="https://evil.example/"></iframe><object data="x.swf"></object><embed src="x">
    <svg onload="alert(1)"><text>svgtext</text></svg><math><mi>x</mi></math><form action="https://evil"><input value="secret"><button>Go</button></form>
    <img src="x" onerror="alert(1)" alt="pic">
    <p><a href="javascript:alert(1)">js</a> <a href="file:///etc/passwd">file</a> <a href="data:text/html,x">data</a> <a href="https://ok.example/">ok</a></p>`, 80, true);
  const text = plain(rows);
  for (const banned of ["alert('x')", 'tmpl', 'svgtext', 'secret', 'Go', 'display', 'onclick', 'onerror', 'evil', 'x.swf', '\nns']) assert.ok(!text.includes(banned), `${banned} not shown`);
  // A refused link keeps its text and shows its target as inert text, as in Markdown: nothing is hidden or followed.
  assert.match(text, /js \(javascript:alert\(1\)\) file \(file:\/\/\/etc\/passwd\)/u);
  assert.match(text, /Safe text/u);
  assert.match(text, /\[image: pic\]/u);
  const styled = rows.map(row => row.ansi).join('\n');
  const links = [...styled.matchAll(/\u001b\]8;;([^\u0007\u001b]*)/gu)].map(match => match[1]).filter(Boolean);
  assert.deepEqual(links, ['https://ok.example/'], 'only the http(s) link is a link');
});

test('F01 security: terminal controls and invisible characters never come through text, entities or attributes', () => {
  const rows = html(`<p>A\u001b[31mred\u001b]52;c;aGk=\u0007 &#27;[2J &#x1b;]0;t&#7; &#x202e;gpj.exe x​y</p>
    <img alt="\u001b[2Jalt" src="a"><a href="https://ok.example/\u001b]8;;evil">t</a>`, 60, true);
  for (const row of rows) {
    assert.doesNotMatch(row.plain, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‮]/u, JSON.stringify(row.plain));
    assert.doesNotMatch(row.ansi, /\u001b\[2J|\u001b\]52|\u001b\]0;/u, 'no screen, clipboard or title control survives');
  }
});

test('F01 limits: deep nesting, many tags, long attributes and unclosed markup stay bounded and never throw', () => {
  const cases = [
    '<div>'.repeat(100_000) + 'deep' + '</div>'.repeat(100_000),
    '<b>'.repeat(50_000) + 'x',
    `<img alt="${'a'.repeat(200_000)}">`,
    '<p>' + '<span>a</span>'.repeat(60_000),
    '<table>' + '<tr><td>x</td></tr>'.repeat(20_000),
    '<ul>' + '<li>'.repeat(30_000) + 'item',
    '<p unterminated="never closed',
    '<!-- comment never closed',
    '<a href="https://x/">' + '['.repeat(50_000),
  ];
  for (const source of cases) {
    const started = performance.now();
    const rows = html(source, 40);
    assert.ok(performance.now() - started < 4000, `bounded: ${source.slice(0, 30)}`);
    for (const row of rows.slice(0, 200)) assert.ok(displayWidth(row.ansi) <= 40);
  }
  assert.match(plain(html('<div>'.repeat(100_000) + 'deep' + '</div>'.repeat(100_000))), /deep/u, 'content past the depth bound is still shown');
});

test('F01: rendering HTML reads no files and makes no requests (the module imports nothing that could)', () => {
  const source = readFileSync(new URL('../src/markdown/html.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gmu)].map(match => match[1]!);
  for (const name of imports) assert.ok(!/^node:|^(?:fs|net|http|https|child_process|dns|tls)$/u.test(name), `html.ts imports ${name}`);
});

test('F01: agent replies and GitHub bodies are unchanged: without the HTML option, tags stay text', () => {
  const text = plain(renderMarkdown('Use a <div> here, or <b>this</b>.\n\n<p align="center">x</p>', 80, {level: 'truecolor'}));
  assert.match(text, /Use a <div> here, or <b>this<\/b>\./u);
  assert.match(text, /<p align="center">x<\/p>/u);
  // An unknown tag-like word in /view's Markdown also stays text.
  assert.match(plain(markdown('A generic <T> and <placeholder> stay.')), /A generic <T> and <placeholder> stay\./u);
});

test('F01: narrow widths fit, and NO_COLOR and Safe glyphs keep structure without color', () => {
  for (const columns of [20, 40, 80]) {
    for (const row of html('<h2>Title that is fairly long</h2><table><tr><th>Name</th><th>Description</th></tr><tr><td>a</td><td>a long cell that wraps</td></tr></table><ul><li>item</li></ul>', columns)) {
      assert.ok(displayWidth(row.ansi) <= columns, `${columns}: ${row.plain}`);
    }
  }
  const safe = renderHtml('<ul><li>x</li></ul><hr><blockquote>q</blockquote><code>c</code>', 40, {level: 'none', glyphs: 'safe'});
  assert.match(plain(safe), /- x/u);
  assert.match(plain(safe), /`c`/u, 'code keeps backticks without color');
  for (const row of safe) assert.doesNotMatch(row.ansi, /\u001b\[[0-9;]*[34]8;/u, 'no color');
});

function htmlDocument(text: string, path = '/tmp/page.html'): ViewDocument {
  return {title: path, origin: {kind: 'file', path, realPath: path, symlink: false, bytes: text.length, mtimeMs: 0}, lines: text.split('\n'), text,
    format: formatForPath(path).format, language: formatForPath(path).language, notes: [], lineEnding: 'lf', complete: true};
}

test('F01 viewer: .html opens rendered; m shows the source and back; search finds rendered text; narrow fits', () => {
  assert.equal(formatForPath('/x/index.html').format, 'html');
  assert.equal(formatForPath('/x/page.HTM').format, 'html');
  assert.equal(formatForPath('/x/README.md').format, 'markdown');
  const state = createViewer(htmlDocument('<h1>Page</h1>\n<p>Hello <b>world</b></p>\n<script>alert(1)</script>'));
  assert.equal(state.rendered, true);
  let screen = renderViewer(state, 60, 20).map(row => stripAnsi(row)).join('\n');
  assert.match(screen, /Page/u);
  assert.match(screen, /Hello world/u);
  assert.doesNotMatch(screen, /alert|<p>/u);
  viewerKey(state, {kind: 'text', value: 'm'}, 60, 20);
  assert.equal(state.rendered, false);
  screen = renderViewer(state, 60, 20).map(row => stripAnsi(row)).join('\n');
  assert.match(screen, /<p>Hello <b>world<\/b><\/p>/u, 'source mode shows the file as it is');
  viewerKey(state, {kind: 'text', value: 'm'}, 60, 20);
  assert.equal(state.rendered, true);
  viewerKey(state, {kind: 'text', value: '/'}, 60, 20);
  for (const char of 'world') viewerKey(state, {kind: 'text', value: char}, 60, 20);
  viewerKey(state, {kind: 'enter'}, 60, 20);
  assert.equal(state.matchCount, 1);
  for (const row of renderViewer(state, 24, 12)) assert.ok(displayWidth(row) <= 24);
  // Markdown in /view renders its embedded HTML too.
  const readme = createViewer({...htmlDocument('# T\n\n<p align="center"><img alt="Logo" src="x.png"></p>', '/tmp/README.md')});
  assert.match(renderViewer(readme, 60, 20).map(row => stripAnsi(row)).join('\n'), /\[image: Logo\]/u);
});
