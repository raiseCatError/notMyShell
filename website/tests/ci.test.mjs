import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
function codeRequired(files, event) {
  const expression = workflow.match(/print\('code=' \+ str\((.+)\)\.lower\(\)\)/)?.[1];
  const declarations = workflow.match(/^\s+(?:docs_only|website_files|website_only) = .+$/gm)?.map(line => line.trim()).join('\n');
  const input = `import os\nfiles = [${files.map(file => `b${JSON.stringify(file)}`).join(', ')}]\n${declarations}\nprint(${expression})`;
  const result = spawnSync('python3', ['-c', input], { encoding: 'utf8', env: { ...process.env, EVENT: event } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === 'True';
}

test('website-only PRs and pushes skip expensive CLI jobs, mixed changes do not', () => {
  for (const event of ['pull_request', 'push']) {
    assert.equal(codeRequired(['website/package.json', 'website/src/pages/index.astro'], event), false);
    assert.equal(codeRequired(['.github/workflows/website.yml'], event), false);
    assert.equal(codeRequired(['.github/workflows/website-deploy.yml'], event), false);
    assert.equal(codeRequired(['README.md', 'website/src/layouts/Base.astro'], event), false);
    assert.equal(codeRequired(['website/src/pages/index.astro', 'src/app/TerminalApp.ts'], event), true);
    assert.equal(codeRequired(['.github/workflows/ci.yml'], event), true);
  }
  assert.equal(codeRequired(['README.md'], 'pull_request'), false);
  assert.equal(codeRequired(['README.md'], 'push'), true);
});
