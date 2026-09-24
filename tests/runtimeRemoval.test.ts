import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

test('active runtime has no animated mascot timer or reserved screen row', async () => {
  const files = await sourceFiles('src');
  const source = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
  assert.ok(!/CatMascot|MASCOT_REFRESH|mascotRows/iu.test(source));
});

test('archived mascot is outside normal TypeScript and test paths', async () => {
  const tsconfig = JSON.parse(await readFile('tsconfig.json', 'utf8')) as {include: string[]};
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {scripts: {test: string}};
  assert.deepEqual(tsconfig.include, ['src']);
  assert.equal(packageJson.scripts.test, 'node --import=tsx --test tests/**/*.test.ts');
  assert.match(await readFile('archive/mascot-prototype/README.md', 'utf8'), /intentionally disabled/u);
});
