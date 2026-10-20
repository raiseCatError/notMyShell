import test from 'node:test';
import assert from 'node:assert/strict';
import {htmlDocumentFor, markdownToHtml} from '../src/browser/engine/markdownHtml.js';

test('markdown becomes a complete, self-contained document with GFM', () => {
  const html = markdownToHtml('# Title\n\nSome *text* and `code`.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~ https://example.com\n\n```js\nlet x = 1;\n```\n', {title: 'README', colorScheme: 'light'});
  assert.match(html, /^<!doctype html>/u);
  assert.match(html, /<meta charset="utf-8">/u);
  assert.match(html, /<h1>Title<\/h1>/u);
  assert.match(html, /<em>text<\/em>/u);
  assert.match(html, /<table>/u);
  assert.match(html, /<input[^>]*type="checkbox"/u);
  assert.match(html, /<del>gone<\/del>/u);
  assert.match(html, /<a href="https:\/\/example.com">/u);
  assert.match(html, /<pre><code class="language-js">/u);
  assert.match(html, /<style>[\s\S]*max-width:100%[\s\S]*<\/style>/u);
  assert.doesNotMatch(html, /@import|https?:\/\/[^"'\s<]*\.(css|woff2?|ttf)|<link /u, 'no external resources');
});

test('raw HTML in the source passes through untouched (the page CSP is what makes that safe)', () => {
  const html = markdownToHtml('<details><summary>More</summary><b>bold</b></details>\n\n<script>alert(1)</script>\n\n<img src="x.png" onerror="y()">', {title: 't', colorScheme: 'light'});
  assert.match(html, /<details><summary>More<\/summary><b>bold<\/b><\/details>/u);
  assert.match(html, /<script>alert\(1\)<\/script>/u);
  assert.match(html, /<img src="x.png" onerror="y\(\)">/u);
});

test('the title is escaped', () => {
  const html = markdownToHtml('x', {title: '</title><script>alert("x")</script> & \'q\'', colorScheme: 'light'});
  assert.match(html, /<title>&lt;\/title&gt;&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;q&#39;<\/title>/u);
  assert.equal(html.match(/<title>/gu)?.length, 1);
});

test('light and dark are chosen by the colorScheme option', () => {
  const light = markdownToHtml('x', {title: 't', colorScheme: 'light'});
  const dark = markdownToHtml('x', {title: 't', colorScheme: 'dark'});
  assert.match(light, /<html lang="en" data-scheme="light">/u);
  assert.match(dark, /<html lang="en" data-scheme="dark">/u);
  assert.match(dark, /:root\[data-scheme=dark\]\{[^}]*color-scheme:dark/u);
  assert.match(dark, /--bg:#0d1117/u);
  assert.notEqual(light, dark);
});

test('htmlDocumentFor serves HTML as written and converts Markdown', () => {
  const page = '<!doctype html><title>mine</title><p>hi';
  assert.equal(htmlDocumentFor(page, 'html'), page);
  assert.equal(htmlDocumentFor(page, 'html', {title: 'ignored', colorScheme: 'dark'}), page);
  const md = htmlDocumentFor('# Hi', 'markdown');
  assert.match(md, /<h1>Hi<\/h1>/u);
  assert.match(md, /<title>Preview<\/title>/u);
  assert.match(htmlDocumentFor('# Hi', 'markdown', {title: 'notes.md', colorScheme: 'dark'}), /<title>notes.md<\/title>[\s\S]*data-scheme="dark"|data-scheme="dark"[\s\S]*<title>notes.md<\/title>/u);
});
