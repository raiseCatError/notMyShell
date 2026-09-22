import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePromptContext, type GitProbe} from '../src/shell/ShellContext.js';

test('uses tilde for the home directory', async () => {
  const probe: GitProbe = {run: async () => assert.fail('git should not be called')};
  assert.deepEqual(await resolvePromptContext('/Users/test', probe, '/Users/test'), {
    cwd: '/Users/test',
    project: '~',
  });
});

test('uses repository name and branch inside a repository', async () => {
  const probe: GitProbe = {
    async run(_cwd, args) {
      if (args.includes('--show-toplevel')) return '/Users/test/Projects/example';
      if (args.includes('symbolic-ref')) return 'feature/prompt';
      throw new Error('unexpected probe');
    },
  };
  assert.deepEqual(await resolvePromptContext('/Users/test/Projects/example/src', probe, '/Users/test'), {
    cwd: '/Users/test/Projects/example/src',
    project: 'example',
    branch: 'feature/prompt',
  });
});

test('falls back to directory basename outside a repository', async () => {
  const probe: GitProbe = {run: async () => { throw new Error('not a repository'); }};
  assert.deepEqual(await resolvePromptContext('/tmp/example', probe, '/Users/test'), {
    cwd: '/tmp/example',
    project: 'example',
  });
});

