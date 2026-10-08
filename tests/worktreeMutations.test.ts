import test from 'node:test';
import assert from 'node:assert/strict';
import {access, chmod, mkdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGitRunner} from '../src/worktrees/git.js';
import {discoverWorktrees} from '../src/worktrees/discovery.js';
import {
  applyNewWorktree, applyRemoval, describePlan, planNewWorktree, planRemoval, removalAvailability,
} from '../src/worktrees/mutations.js';
import {createRepo} from './helpers/worktreeRepos.js';

const git = createGitRunner();
const exists = (path: string) => access(path).then(() => true, () => false);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

test('new worktree from an existing branch: plan names exactly what Git will do, apply requires confirmation', async () => {
  const fx = await createRepo();
  try {
    fx.git('branch', 'topic');
    const destination = join(fx.root, 'topic wt');
    const plan = await planNewWorktree(git, fx.repo, {kind: 'existingBranch', destination, branch: 'topic'});
    assert.ok(plan.ok, !plan.ok ? plan.reason : '');
    assert.equal(plan.value.createsBranch, false);
    assert.deepEqual(plan.value.argv, ['worktree', 'add', '--', destination, 'topic']);
    assert.deepEqual(describePlan(plan.value), [`Repository   ${join(fx.repo, '.git')}`, `Destination  ${destination}`, 'Branch       topic (existing branch)']);
    assert.equal(await exists(destination), false, 'planning mutates nothing');

    assert.deepEqual(await applyNewWorktree(git, fx.repo, plan.value, {confirmed: false}), {ok: false, reason: 'Not confirmed', requiresReview: false});
    assert.equal(await exists(destination), false);
    assert.deepEqual(await applyNewWorktree(git, fx.repo, plan.value, {confirmed: true}), {ok: true, value: destination});
    const snapshot = await discoverWorktrees(git, fx.repo);
    assert.equal(snapshot.worktrees.find(row => row.path === destination)?.branch, 'topic');
  } finally { await fx.dispose(); }
});

test('new branch from an explicit start point resolves to an exact commit; a hook is not run on checkout', async () => {
  const fx = await createRepo();
  try {
    const marker = join(fx.root, 'HOOK');
    await mkdir(join(fx.repo, '.git', 'hooks'), {recursive: true});
    await writeFile(join(fx.repo, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`);
    await chmod(join(fx.repo, '.git', 'hooks', 'post-checkout'), 0o755);
    const head = fx.git('rev-parse', 'HEAD').trim();
    const destination = join(fx.root, '-dash ünï');
    const plan = await planNewWorktree(git, fx.repo, {kind: 'newBranch', destination, branch: 'feat/ünï+x', startPoint: 'main'});
    assert.ok(plan.ok, !plan.ok ? plan.reason : '');
    assert.equal(plan.value.createsBranch, true);
    assert.deepEqual(plan.value.startPoint, {input: 'main', commit: head});
    assert.deepEqual(plan.value.argv, ['worktree', 'add', '--no-track', '-b', 'feat/ünï+x', '--', destination, head]);
    const applied = await applyNewWorktree(git, fx.repo, plan.value, {confirmed: true});
    assert.ok(applied.ok, !applied.ok ? applied.reason : '');
    assert.equal(fx.gitIn(destination, 'symbolic-ref', 'HEAD').trim(), 'refs/heads/feat/ünï+x');
    assert.equal(await exists(marker), false, 'post-checkout hook did not run');
  } finally { await fx.dispose(); }
});

test('new worktree validation: bad names, collisions, missing parents, checked-out branches, ambiguous start points', async () => {
  const fx = await createRepo();
  try {
    fx.git('branch', 'taken');
    fx.git('worktree', 'add', '-q', '--', join(fx.root, 'holder'), 'taken');
    await mkdir(join(fx.root, 'exists'));
    const cases: Array<[Parameters<typeof planNewWorktree>[2], RegExp]> = [
      [{kind: 'newBranch', destination: join(fx.root, 'a'), branch: '-rf', startPoint: 'main'}, /valid branch/u],
      [{kind: 'newBranch', destination: join(fx.root, 'a'), branch: 'bad..name', startPoint: 'main'}, /valid branch/u],
      [{kind: 'newBranch', destination: join(fx.root, 'a'), branch: '@{-1}', startPoint: 'main'}, /valid branch/u],
      [{kind: 'newBranch', destination: join(fx.root, 'a'), branch: 'x\u001b[31m', startPoint: 'main'}, /valid branch/u],
      [{kind: 'newBranch', destination: join(fx.root, 'a'), branch: 'main', startPoint: 'main'}, /already exists/u],
      [{kind: 'newBranch', destination: join(fx.root, 'a'), branch: 'n', startPoint: '--output=/tmp/x'}, /start point/u],
      [{kind: 'newBranch', destination: join(fx.root, 'a'), branch: 'n', startPoint: 'no-such-ref'}, /resolve/u],
      [{kind: 'existingBranch', destination: join(fx.root, 'a'), branch: 'missing'}, /does not exist/u],
      [{kind: 'existingBranch', destination: join(fx.root, 'a'), branch: 'taken'}, /already checked out/u],
      [{kind: 'existingBranch', destination: join(fx.root, 'exists'), branch: 'main'}, /already exists/u],
      [{kind: 'existingBranch', destination: join(fx.root, 'no', 'parent'), branch: 'main'}, /parent does not exist/u],
      [{kind: 'existingBranch', destination: 'relative/path', branch: 'main'}, /absolute/u],
    ];
    for (const [request, reason] of cases) {
      const plan = await planNewWorktree(git, fx.repo, request);
      assert.equal(plan.ok, false, JSON.stringify(request));
      assert.match(!plan.ok ? plan.reason : '', reason, JSON.stringify(request));
      assert.doesNotMatch(!plan.ok ? plan.reason : '', CONTROL);
    }
    assert.equal(await exists(join(fx.root, 'no')), false, 'no directories were created');
  } finally { await fx.dispose(); }
});

test('new worktree: repository changed between preview and apply requires another review', async () => {
  const fx = await createRepo();
  try {
    fx.git('branch', 'topic');
    const destination = join(fx.root, 'topic');
    const plan = await planNewWorktree(git, fx.repo, {kind: 'existingBranch', destination, branch: 'topic'});
    assert.ok(plan.ok);
    fx.git('commit', '-q', '--allow-empty', '-m', 'moved');
    fx.git('branch', '-f', 'topic', 'HEAD');
    const applied = await applyNewWorktree(git, fx.repo, plan.value, {confirmed: true});
    assert.equal(applied.ok, false);
    assert.equal(!applied.ok && applied.requiresReview, true);
    assert.equal(await exists(destination), false);

    const second = await planNewWorktree(git, fx.repo, {kind: 'existingBranch', destination, branch: 'topic'});
    assert.ok(second.ok);
    await mkdir(destination);
    const collided = await applyNewWorktree(git, fx.repo, second.value, {confirmed: true});
    assert.equal(collided.ok, false);
    assert.match(!collided.ok ? collided.reason : '', /already exists/u);
  } finally { await fx.dispose(); }
});

async function linkedRepo() {
  const fx = await createRepo();
  await writeFile(join(fx.repo, 'tracked.txt'), 'one\n');
  await writeFile(join(fx.repo, '.gitignore'), 'build/\n');
  fx.git('add', 'tracked.txt', '.gitignore');
  fx.git('commit', '-q', '-m', 'files');
  const linked = join(fx.root, 'linked ünï');
  fx.git('worktree', 'add', '-q', '-b', 'feature/linked', '--', linked, 'HEAD');
  return {fx, linked};
}

test('removal of a clean linked worktree: preview, confirmation, revalidation, non-forced Git removal; branch kept', async () => {
  const {fx, linked} = await linkedRepo();
  try {
    await mkdir(join(linked, 'build'));
    await writeFile(join(linked, 'build', 'out.o'), 'x');
    const plan = await planRemoval(git, fx.repo, linked);
    assert.ok(plan.ok, !plan.ok ? plan.reason : '');
    assert.deepEqual(plan.value.argv, ['worktree', 'remove', '--', linked]);
    assert.ok(!plan.value.argv.includes('--force') && !plan.value.argv.includes('-f'));
    assert.equal(plan.value.ignoredEntries, 1);
    const preview = describePlan(plan.value).join('\n');
    assert.match(preview, /Remove {7}.*linked ünï/u);
    assert.match(preview, /Checkout {5}feature\/linked/u);
    assert.match(preview, /1 ignored entries will be deleted by Git/u);

    assert.equal((await applyRemoval(git, fx.repo, plan.value, {confirmed: false})).ok, false);
    assert.equal(await exists(linked), true);
    const removed = await applyRemoval(git, fx.repo, plan.value, {confirmed: true});
    assert.deepEqual(removed, {ok: true, value: linked});
    assert.equal(await exists(linked), false);
    assert.match(fx.git('branch', '--list', 'feature/linked'), /feature\/linked/u);
  } finally { await fx.dispose(); }
});

test('removal is not offered for main, dirty, untracked, locked, prunable or current-shell worktrees', async () => {
  const {fx, linked} = await linkedRepo();
  try {
    const locked = join(fx.root, 'locked');
    const gone = join(fx.root, 'gone');
    const untracked = join(fx.root, 'untracked');
    fx.git('worktree', 'add', '-q', '-b', 'l', '--', locked, 'HEAD');
    fx.git('worktree', 'lock', locked);
    fx.git('worktree', 'add', '-q', '-b', 'g', '--', gone, 'HEAD');
    fx.git('worktree', 'add', '-q', '-b', 'u', '--', untracked, 'HEAD');
    await rename(gone, join(fx.root, 'elsewhere'));
    await writeFile(join(linked, 'tracked.txt'), 'dirty\n');
    await writeFile(join(untracked, 'new.txt'), 'new\n');
    const snapshot = await discoverWorktrees(git, fx.repo);
    const reason = (path: string, current?: string) => {
      const availability = removalAvailability(snapshot.worktrees.find(row => row.path === path)!, current);
      return availability.available ? 'available' : availability.reason;
    };
    assert.match(reason(fx.repo), /main worktree/u);
    assert.match(reason(linked), /uncommitted tracked/u);
    assert.match(reason(untracked), /untracked files/u);
    assert.match(reason(locked), /Locked/u);
    assert.match(reason(gone), /prunable/u);
    fx.git('worktree', 'unlock', locked);
    const fresh = await discoverWorktrees(git, fx.repo);
    const lockedRow = fresh.worktrees.find(row => row.path === locked)!;
    assert.deepEqual(removalAvailability(lockedRow), {available: true});
    assert.match((removalAvailability(lockedRow, join(locked, 'src')) as {reason: string}).reason, /current shell/u);
    for (const path of [fx.repo, linked, untracked, gone]) assert.equal((await planRemoval(git, fx.repo, path)).ok, false);
    assert.equal(await exists(linked), true);
    assert.equal(await exists(untracked), true);
  } finally { await fx.dispose(); }
});

test('removal race: dirty or untracked state introduced after preview aborts and requires review', async () => {
  const {fx, linked} = await linkedRepo();
  try {
    for (const [file, contents] of [['tracked.txt', 'edited\n'], ['brand-new.txt', 'u\n']] as const) {
      const plan = await planRemoval(git, fx.repo, linked);
      assert.ok(plan.ok);
      await writeFile(join(linked, file), contents);
      const applied = await applyRemoval(git, fx.repo, plan.value, {confirmed: true});
      assert.equal(applied.ok, false);
      assert.equal(!applied.ok && applied.requiresReview, true);
      assert.equal(await exists(join(linked, file)), true, 'work preserved');
      fx.gitIn(linked, 'checkout', '-q', '--', '.');
      if (file === 'brand-new.txt') fx.gitIn(linked, 'clean', '-q', '-f', '--', 'brand-new.txt');
    }
  } finally { await fx.dispose(); }
});

test('removal race: HEAD/branch moved or path swapped for another directory after preview aborts', async () => {
  const {fx, linked} = await linkedRepo();
  try {
    let plan = await planRemoval(git, fx.repo, linked);
    assert.ok(plan.ok);
    fx.gitIn(linked, 'commit', '-q', '--allow-empty', '-m', 'new work');
    let applied = await applyRemoval(git, fx.repo, plan.value, {confirmed: true});
    assert.match(!applied.ok ? applied.reason : '', /HEAD commit changed/u);

    plan = await planRemoval(git, fx.repo, linked);
    assert.ok(plan.ok);
    fx.gitIn(linked, 'switch', '-q', '-c', 'other-branch');
    applied = await applyRemoval(git, fx.repo, plan.value, {confirmed: true});
    assert.match(!applied.ok ? applied.reason : '', /branch changed/u);

    plan = await planRemoval(git, fx.repo, linked);
    assert.ok(plan.ok);
    // Same path, different directory: move the real one aside and plant a look-alike copy of its .git file.
    const aside = join(fx.root, 'aside');
    await rename(linked, aside);
    await mkdir(linked);
    await writeFile(join(linked, '.git'), await (await import('node:fs/promises')).readFile(join(aside, '.git'), 'utf8'));
    applied = await applyRemoval(git, fx.repo, plan.value, {confirmed: true});
    assert.equal(applied.ok, false);
    assert.equal(!applied.ok && applied.requiresReview, true);
    assert.equal(await exists(aside), true);
    assert.equal(await exists(linked), true);

    // The worktree disappeared from Git between preview and apply.
    const plain = join(fx.root, 'plain');
    fx.git('worktree', 'add', '-q', '-b', 'plain', '--', plain, 'HEAD');
    plan = await planRemoval(git, fx.repo, plain);
    assert.ok(plan.ok);
    fx.git('worktree', 'remove', plain);
    applied = await applyRemoval(git, fx.repo, plan.value, {confirmed: true});
    assert.match(!applied.ok ? applied.reason : '', /no longer lists/u);
  } finally { await fx.dispose(); }
});

test('removal runs no repository hooks or fsmonitor and refuses under filter configuration', async () => {
  const {fx, linked} = await linkedRepo();
  try {
    const marker = join(fx.root, 'RAN');
    const evil = join(fx.root, 'evil.sh');
    await writeFile(evil, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
    await chmod(evil, 0o755);
    fx.git('config', 'core.fsmonitor', evil);
    fx.git('config', 'filter.evil.clean', evil);
    let plan = await planRemoval(git, fx.repo, linked);
    assert.equal(plan.ok, false);
    assert.match(!plan.ok ? plan.reason : '', /unknown/u);
    fx.git('config', '--unset', 'filter.evil.clean');
    plan = await planRemoval(git, fx.repo, linked);
    assert.ok(plan.ok);
    assert.ok((await applyRemoval(git, fx.repo, plan.value, {confirmed: true})).ok);
    assert.equal(await exists(marker), false);
  } finally { await fx.dispose(); }
});
