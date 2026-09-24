import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGitStatus, resolvePromptContext, type GitProbe} from '../src/shell/ShellContext.js';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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

test('parses porcelain Git changes, conflicts, and upstream distance', () => {
  assert.deepEqual(parseGitStatus('## main...origin/main [ahead 2, behind 3]\nM  staged\n M modified\nMM both\n?? new\nUU conflict\n'), {
    staged: 2, modified: 2, untracked: 1, conflicts: 1, ahead: 2, behind: 3,
  });
  assert.deepEqual(parseGitStatus('## main\n'), {
    staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0,
  });
});

test('Git status is probed asynchronously and failures leave the branch usable', async () => {
  const probe: GitProbe = {async run(_cwd, args) {
    if (args.includes('--show-toplevel')) return '/tmp/repo';
    if (args.includes('symbolic-ref')) return 'main';
    if (args.includes('status')) return '## main...origin/main [ahead 1]\n?? new\n';
    if (args.includes('--absolute-git-dir')) return '/tmp/nonexistent-git-dir';
    throw new Error('unexpected probe');
  }};
  const context = await resolvePromptContext('/tmp/repo', probe, '/Users/test');
  assert.equal(context.branch, 'main');
  assert.deepEqual(context.git, {staged: 0, modified: 0, untracked: 1, conflicts: 0, ahead: 1, behind: 0,
    operation: undefined});

  const failing: GitProbe = {async run(cwd, args) {
    if (args.includes('status')) throw new Error('Git status timed out');
    return probe.run(cwd, args);
  }};
  const fallback = await resolvePromptContext('/tmp/repo', failing, '/Users/test');
  assert.equal(fallback.branch, 'main');
  assert.equal(fallback.git, undefined);
});

test('active Git operations are resolved from the Git directory', async () => {
  const gitDir = await mkdtemp(join(tmpdir(), 'nmsh-git-status-'));
  try {
    const probe: GitProbe = {async run(_cwd, args) {
      if (args.includes('--show-toplevel')) return '/tmp/repo';
      if (args.includes('symbolic-ref')) return 'main';
      if (args.includes('status')) return '## main\n';
      if (args.includes('--absolute-git-dir')) return gitDir;
      throw new Error('unexpected probe');
    }};
    await writeFile(join(gitDir, 'MERGE_HEAD'), 'abc');
    assert.equal((await resolvePromptContext('/tmp/repo', probe, '/Users/test')).git?.operation, 'merge');
    await mkdir(join(gitDir, 'rebase-merge'));
    assert.equal((await resolvePromptContext('/tmp/repo', probe, '/Users/test')).git?.operation, 'rebase');
  } finally {
    await rm(gitDir, {recursive: true, force: true});
  }
});

test('Rich Git Off skips the status probe but still detects the branch', async () => {
  const calls: string[] = [];
  const probe: GitProbe = {run: async (_cwd, args) => {
    calls.push(args[0]!);
    if (args[0] === 'rev-parse') return '/repo';
    if (args[0] === 'symbolic-ref') return 'main';
    return '## main';
  }};
  const context = await resolvePromptContext('/repo/src', probe, '/home/nobody', {status: false});
  assert.equal(context.branch, 'main');
  assert.equal(context.git, undefined);
  assert.ok(!calls.includes('status'), `no status probe: ${calls.join(', ')}`);
});
