#!/usr/bin/env node
/**
 * Writes MANIFEST.sha256 and INVENTORY.md for the durable design archive: every
 * file except the two outputs themselves and macOS AppleDouble (._) metadata.
 *   node tools/inventory.mjs [archive directory]
 */
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';

const archive = process.argv[2] ?? '/Volumes/T7 Shield/NMSh Design Archive/first-run-onboarding-2026-10-17';
const skip = new Set(['MANIFEST.sha256', 'INVENTORY.md']);

function walk(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    if (entry.name.startsWith('._') || entry.name === '.DS_Store') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(archive).map(path => relative(archive, path)).filter(path => !skip.has(path)).sort();
const rows = files.map(path => {
  const data = readFileSync(join(archive, path));
  return {path, size: statSync(join(archive, path)).size, sha: createHash('sha256').update(data).digest('hex')};
});
writeFileSync(join(archive, 'MANIFEST.sha256'), rows.map(row => `${row.sha}  ./${row.path}`).join('\n') + '\n');

const kind = path => {
  if (path.startsWith('design-concepts/captures/') && path.endsWith('.mp4')) return 'Motion clips';
  if (path.startsWith('design-concepts/captures/') && path.endsWith('.png')) return 'Stills';
  if (path.startsWith('design-concepts/captures/')) return 'Capture logs and benchmarks';
  if (path.startsWith('design-concepts/build/')) return 'Derived images and page checks';
  if (path.startsWith('design-concepts/proto/')) return 'Prototype source (original)';
  if (path.startsWith('design-concepts/')) return 'Review pages and tools (original)';
  if (path.startsWith('repo-folder/')) return 'Version-controlled folder (portable copy)';
  if (path.startsWith('derived/')) return 'Ending filmstrip frames';
  if (path.startsWith('review-package/')) return 'Packaged review';
  if (path.startsWith('superseded/')) return 'Superseded implementation';
  return 'Archive documents';
};
const human = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KiB` : `${bytes} B`;
const groups = new Map();
for (const row of rows) groups.set(kind(row.path), [...(groups.get(kind(row.path)) ?? []), row]);
const summary = [...groups].map(([name, list]) => `| ${name} | ${list.length} | ${human(list.reduce((sum, row) => sum + row.size, 0))} |`);
const listing = [...groups].flatMap(([name, list]) => [`### ${name}`, '', '| File | Size | SHA-256 (first 16) |', '| --- | ---: | --- |',
  ...list.map(row => `| \`${row.path}\` | ${human(row.size)} | \`${row.sha.slice(0, 16)}\` |`), '']);
writeFileSync(join(archive, 'INVENTORY.md'), [
  '# Inventory of the first-run onboarding design archive', '',
  `Every file in \`${archive}\` except this inventory, \`MANIFEST.sha256\` and macOS AppleDouble metadata. Full hashes are in \`MANIFEST.sha256\`.`, '',
  '| Kind | Files | Size |', '| --- | ---: | ---: |', ...summary,
  `| **Total** | **${rows.length}** | **${human(rows.reduce((sum, row) => sum + row.size, 0))}** |`, '', ...listing,
].join('\n'));
console.log(`${rows.length} files hashed into ${join(archive, 'MANIFEST.sha256')}`);
