import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../src/', import.meta.url);
async function ownedFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? ownedFiles(new URL(`${entry.name}/`, directory)) : new URL(entry.name, directory)))).flat();
}
test('website-owned prose avoids em dashes and stock marketing language', async () => {
  const files = (await Promise.all(['pages/', 'layouts/', 'components/', 'content/guides/'].map(path => ownedFiles(new URL(path, root))))).flat();
  files.push(new URL('lib/site.ts', root), new URL('data/media.json', root));
  for (const file of files) {
    const source = (await readFile(file, 'utf8')).replace(/^\s*(```|~~~)[\s\S]*?^\s*\1[^\n]*$/gm, '');
    assert.ok(!source.includes('—'), `Authored prose contains an em dash: ${file.pathname}`);
    assert.doesNotMatch(source, /elevate your workflow|seamlessly integrate|unlock the power|reimagine what.s possible|thoughtfully crafted|powerful yet intuitive|a delightful experience|designed for the modern developer/i);
  }
});
