import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLinks, accessibleMarkup } from '../scripts/markdown.mjs';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import config from '../astro.config.mjs';

test('real configured Markdown rendering adds copyable section anchors without polluting TOC text', async () => {
  const renderer = await createMarkdownProcessor({ syntaxHighlight: false, ...config.markdown.processor.options });
  const result = await renderer.render('## Install and launch\n\nStart here.');
  assert.match(result.code, /class="heading-anchor"/);
  assert.match(result.code, /href="#install-and-launch"/);
  assert.equal(result.metadata.headings[0].text, 'Install and launch');
});

test('historical release links stay at their own tag and h1 notes fit the page hierarchy', () => {
  const tree = { type: 'root', children: [{ type: 'heading', depth: 1, children: [] }, { type: 'link', url: 'docs/accessibility/baseline.md', children: [] }] };
  sourceLinks()(tree, { data: { astro: { frontmatter: { tag: 'v0.7.0' } } } });
  assert.equal(tree.children[0].depth, 2);
  assert.equal(tree.children[1].url, 'https://github.com/raiseCatError/notMyShell/blob/v0.7.0/docs/accessibility/baseline.md');
});

test('tables wrap once and code examples remain keyboard scrollable', () => {
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'table', properties: {}, children: [] }, { type: 'element', tagName: 'pre', children: [] }] };
  accessibleMarkup()(tree);
  assert.equal(tree.children[0].tagName, 'div');
  assert.equal(tree.children[0].children[0].tagName, 'table');
  assert.equal(tree.children[0].properties.role, 'region');
  assert.equal(tree.children[1].properties.tabIndex, 0);
});
