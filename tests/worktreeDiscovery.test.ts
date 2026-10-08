import test from 'node:test';
import assert from 'node:assert/strict';
import {access, chmod, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGitRunner, type GitRunner} from '../src/worktrees/git.js';
import {discoverWorktrees, mapBounded} from '../src/worktrees/discovery.js';
import {checkoutLabel, parseStatusCounts, parseWorktreePorcelainZ, stateWords} from '../src/worktrees/model.js';
import {createRepo} from './helpers/worktreeRepos.js';

const git = createGitRunner();
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const exists = (path: string) => access(path).then(() => true, () => false);

test('porcelain -z parsing keeps raw paths, reasons and flags; unknown stays unknown', () => {
  const output = [
    'worktree /r/main', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/main', '',
    'worktree /r/new\nline', 'HEAD ' + 'b'.repeat(40), 'detached', 'locked because\nreasons', '',
    'worktree /r/gone', 'HEAD ' + 'c'.repeat(40), 'branch refs/heads/x', 'prunable gitdir file points to non-existent location', '',
    'worktree /r/bare', 'bare', '',
    'worktree relative/ignored', '',
  ].join('\0');
  const entries = parseWorktreePorcelainZ(output);
  assert.equal(entries.length, 4);
  assert.equal(entries[1]!.path, '/r/new\nline');
  assert.equal(entries[1]!.detached, true);
  assert.equal(entries[1]!.lockedReason, 'because\nreasons');
  assert.equal(entries[2]!.prunable, true);
  assert.equal(entries[3]!.bare, true);
  assert.equal(entries[3]!.head, undefined);
});

test('status v2 counts staged, unstaged, conflicted, untracked; truncated tail is a lower bound', () => {
  const output = ['1 M. N... 100644 100644 100644 a a f1', '1 .M N... 100644 100644 100644 a a f2', '1 MM N... 100644 100644 100644 a a f3',
    '2 R. N... 100644 100644 100644 a a R100 new', 'old', 'u UU N... 1 1 1 1 a a a f4', '? u1', '? u2', ''].join('\0');
  assert.deepEqual(parseStatusCounts(output, false), {staged: 3, unstaged: 2, conflicted: 1, untracked: 2, partial: false});
  assert.deepEqual(parseStatusCounts('? a\0? b\0? partial-reco', true), {staged: 0, unstaged: 0, conflicted: 0, untracked: 2, partial: true});
});

test('discovers main, linked, detached, dirty, untracked, locked and prunable worktrees from Git facts', async () => {
  const fx = await createRepo();
  try {
    await writeFile(join(fx.repo, 'tracked.txt'), 'one\n');
    fx.git('add', 'tracked.txt');
    fx.git('commit', '-q', '-m', 'tracked');
    const linked = join(fx.root, 'linked wt');
    const detached = join(fx.root, 'detached');
    const locked = join(fx.root, 'locked');
    const gone = join(fx.root, 'gone');
    // Folder name deliberately disagrees with the branch: the branch must come from Git.
    fx.git('worktree', 'add', '-q', '-b', 'feature/real-branch', '--', linked, 'HEAD');
    fx.git('worktree', 'add', '-q', '--detach', '--', detached, 'HEAD');
    fx.git('worktree', 'add', '-q', '-b', 'lockme', '--', locked, 'HEAD');
    fx.git('worktree', 'lock', '--reason', 'on a USB disk', locked);
    fx.git('worktree', 'add', '-q', '-b', 'gone', '--', gone, 'HEAD');
    await rm(gone, {recursive: true});
    await writeFile(join(linked, 'tracked.txt'), 'changed\n');
    await writeFile(join(linked, 'new.txt'), 'new\n');
    await writeFile(join(detached, 'untracked.txt'), 'u\n');

    const snapshot = await discoverWorktrees(git, fx.repo);
    const byPath = new Map(snapshot.worktrees.map(row => [row.path, row]));
    assert.equal(snapshot.worktrees.length, 5);
    assert.equal(snapshot.commonDir, join(fx.repo, '.git'));
    const main = snapshot.worktrees[0]!;
    assert.equal(main.path, fx.repo);
    assert.equal(main.main, true);
    assert.equal(main.branch, 'main');
    assert.deepEqual(main.status, {kind: 'clean'});

    const l = byPath.get(linked)!;
    assert.equal(l.main, false);
    assert.equal(l.branch, 'feature/real-branch');
    assert.equal(checkoutLabel(l), 'feature/real-branch');
    assert.equal(l.status.kind, 'dirty');
    assert.deepEqual(l.status.kind === 'dirty' && l.status.counts, {staged: 0, unstaged: 1, conflicted: 0, untracked: 1, partial: false});
    assert.ok(stateWords(l).includes('1 modified') && stateWords(l).includes('1 untracked'));

    const d = byPath.get(detached)!;
    assert.equal(d.detached, true);
    assert.equal(d.branch, undefined);
    assert.match(checkoutLabel(d), /^\(detached [0-9a-f]{7}\)$/u);
    assert.deepEqual(d.status.kind === 'dirty' && d.status.counts.untracked, 1);

    const k = byPath.get(locked)!;
    assert.equal(k.locked, true);
    assert.equal(k.lockedReason, 'on a USB disk');

    const g = byPath.get(gone)!;
    assert.equal(g.prunable, true);
    assert.equal(g.pathState, 'missing');
    // Unknown is not clean.
    assert.equal(g.status.kind, 'unknown');
  } finally { await fx.dispose(); }
});

test('hostile names: spaces, Unicode, leading dashes, control characters and long names stay data and render inert', async () => {
  const fx = await createRepo();
  try {
    const names = ['with space', 'ünï cødé ✓', '-leading-dash', `ctl\u001b]0;PWNED\u0007\u202eevil`, 'L'.repeat(200)];
    const branches = ['feat/ünï', 'a.b-c_d+e@f', 'x/y/z', 'ctl-branch', 'long'];
    for (const [index, name] of names.entries()) fx.git('worktree', 'add', '-q', '-b', branches[index]!, '--', join(fx.root, name), 'HEAD');
    fx.git('worktree', 'lock', '--reason', `bad\u001b]52;c;Zm9v\u0007\u009b31m reason`, join(fx.root, names[0]!));
    const snapshot = await discoverWorktrees(git, fx.repo);
    assert.equal(snapshot.worktrees.length, 1 + names.length);
    for (const [index, name] of names.entries()) {
      const row = snapshot.worktrees.find(candidate => candidate.path === join(fx.root, name));
      assert.ok(row, `listed ${JSON.stringify(name)}`);
      assert.equal(row.branch, branches[index]);
      assert.deepEqual(row.status, {kind: 'clean'});
      for (const text of [checkoutLabel(row), ...stateWords(row)]) assert.doesNotMatch(text, CONTROL);
    }
    const lockedRow = snapshot.worktrees.find(row => row.locked)!;
    const words = stateWords(lockedRow).join(' ');
    assert.doesNotMatch(words, CONTROL);
    assert.match(words, /locked: bad/u);
    assert.doesNotMatch(words, /Zm9v/u);
    // Identity is the raw path from Git, not display text.
    assert.ok(snapshot.worktrees.some(row => row.id.includes('\u001b')));
  } finally { await fx.dispose(); }
});

test('opening a malicious repository runs no hook, fsmonitor or filter program', async () => {
  const fx = await createRepo();
  try {
    const marker = join(fx.root, 'EXECUTED');
    const evil = join(fx.root, 'evil.sh');
    await writeFile(evil, `#!/bin/sh\necho "$0 $*" >> '${marker}'\ncat\n`);
    await chmod(evil, 0o755);
    await mkdir(join(fx.repo, '.git', 'hooks'), {recursive: true});
    for (const hook of ['post-checkout', 'pre-commit', 'reference-transaction', 'post-index-change', 'fsmonitor-watchman']) {
      await writeFile(join(fx.repo, '.git', 'hooks', hook), `#!/bin/sh\necho hook ${hook} >> '${marker}'\n`);
      await chmod(join(fx.repo, '.git', 'hooks', hook), 0o755);
    }
    await writeFile(join(fx.repo, 'file.txt'), 'x\n');
    fx.git('add', 'file.txt');
    fx.git('commit', '-q', '-m', 'file');
    fx.git('worktree', 'add', '-q', '-b', 'other', '--', join(fx.root, 'other'), 'HEAD');
    fx.git('config', 'core.fsmonitor', evil);
    fx.git('config', 'core.hooksPath', join(fx.repo, '.git', 'hooks'));
    fx.git('config', 'core.pager', evil);
    fx.git('config', 'alias.status', `!${evil}`);
    await writeFile(join(fx.repo, 'file.txt'), 'changed\n');

    const snapshot = await discoverWorktrees(git, fx.repo);
    assert.equal(snapshot.worktrees.length, 2);
    assert.equal(snapshot.worktrees[0]!.status.kind, 'dirty');
    assert.equal(await exists(marker), false, 'no repository program ran during discovery');

    // A content filter would run during status: discovery fails closed (status unknown) instead.
    fx.git('config', 'filter.evil.clean', evil);
    await writeFile(join(fx.repo, '.gitattributes'), '* filter=evil\n');
    const filtered = await discoverWorktrees(git, fx.repo);
    assert.equal(filtered.worktrees.length, 2);
    for (const row of filtered.worktrees) assert.deepEqual(row.status.kind, 'unknown');
    assert.match(stateWords(filtered.worktrees[0]!).join(' '), /filters or includes/u);
    assert.equal(await exists(marker), false, 'no filter program ran');

    // Positive control: the fixture is armed. Plain Git status (without NMSh's overrides) runs the fsmonitor program.
    fx.git('config', '--unset', 'filter.evil.clean');
    fx.git('status', '--porcelain');
    assert.equal(await exists(marker), true, 'fixture fsmonitor executes under ordinary Git');
  } finally { await fx.dispose(); }
});

test('failures: not a repository, failing Git, timeout and oversized output are reported, never fabricated', async () => {
  const fx = await createRepo();
  try {
    await assert.rejects(discoverWorktrees(git, fx.root), /not a git repository/iu);
    const fake = join(fx.root, 'fake-git');
    // A fixture Git: identity works, then the list call misbehaves per FAKE_MODE file.
    const mode = join(fx.root, 'mode');
    await writeFile(fake, `#!/bin/sh
for a in "$@"; do case "$a" in --git-common-dir) echo "${fx.repo}/.git"; exit 0;; esac; done
case "$(cat '${mode}')" in
  fail) echo "fatal: boom" >&2; exit 128;;
  slow) exec sleep 5;;
  huge) yes worktree-garbage | head -c 3000000; exit 0;;
esac\n`);
    await chmod(fake, 0o755);
    const fakeGit = createGitRunner(fake);
    await writeFile(mode, 'fail');
    await assert.rejects(discoverWorktrees(fakeGit, fx.repo), /boom/u);
    await writeFile(mode, 'slow');
    const started = Date.now();
    await assert.rejects(discoverWorktrees(fakeGit, fx.repo, {listTimeoutMs: 300}), /timed out/u);
    assert.ok(Date.now() - started < 3000);
    await writeFile(mode, 'huge');
    await assert.rejects(discoverWorktrees(fakeGit, fx.repo), /safety bound/u);
  } finally { await fx.dispose(); }
});

test('a single failed status probe leaves the rest of the list intact', async () => {
  const fx = await createRepo();
  try {
    fx.git('worktree', 'add', '-q', '-b', 'a', '--', join(fx.root, 'a'), 'HEAD');
    fx.git('worktree', 'add', '-q', '-b', 'b', '--', join(fx.root, 'b'), 'HEAD');
    const failing: GitRunner = async (cwd, args, options) =>
      args[0] === 'status' && cwd.endsWith('/a') ? {stdout: '', stderr: 'fatal: index corrupt', code: 128, truncated: false, timedOut: false} : git(cwd, args, options);
    const snapshot = await discoverWorktrees(failing, fx.repo);
    assert.equal(snapshot.worktrees.length, 3);
    const a = snapshot.worktrees.find(row => row.path.endsWith('/a'))!;
    assert.deepEqual(a.status, {kind: 'unknown', reason: 'index corrupt'});
    assert.deepEqual(snapshot.worktrees.find(row => row.path.endsWith('/b'))!.status, {kind: 'clean'});
  } finally { await fx.dispose(); }
});

test('bounds: worktree count cap and bounded status concurrency', async () => {
  let active = 0, peak = 0;
  await mapBounded(Array.from({length: 40}, (_, i) => i), 4, async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
  });
  assert.equal(peak, 4);

  const fx = await createRepo();
  try {
    for (let index = 0; index < 5; index += 1) fx.git('worktree', 'add', '-q', '-b', `b${index}`, '--', join(fx.root, `w${index}`), 'HEAD');
    const snapshot = await discoverWorktrees(git, fx.repo, {maxWorktrees: 3});
    assert.equal(snapshot.worktrees.length, 3);
    assert.equal(snapshot.truncated, true);
  } finally { await fx.dispose(); }
});

test('performance: 100 linked worktrees come from one list call plus bounded status probes', {timeout: 120_000}, async () => {
  const fx = await createRepo();
  try {
    for (let index = 0; index < 100; index += 1) fx.git('worktree', 'add', '-q', '--no-checkout', '-b', `perf/${index}`, '--', join(fx.root, `p${index}`), 'HEAD');
    const calls: string[] = [];
    let active = 0, peak = 0;
    const counting: GitRunner = async (cwd, args, options) => {
      calls.push(args[0]!); active += 1; peak = Math.max(peak, active);
      try { return await git(cwd, args, options); } finally { active -= 1; }
    };
    const started = performance.now();
    const snapshot = await discoverWorktrees(counting, fx.repo, {concurrency: 8});
    const elapsed = performance.now() - started;
    assert.equal(snapshot.worktrees.length, 101);
    assert.equal(calls.filter(call => call === 'worktree').length, 1);
    assert.equal(calls.filter(call => call === 'status').length, 101);
    assert.ok(peak <= 8, `peak concurrency ${peak}`);
    assert.ok(elapsed < 60_000, `discovery took ${Math.round(elapsed)}ms`);
  } finally { await fx.dispose(); }
});
