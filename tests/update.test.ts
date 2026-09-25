import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  applyUpdate, backgroundUpdateCheck, compareVersions, detectInstall, fetchLatestRelease, isCheckDue, planUpdate,
  type CommandRunner, type FetchLike, type InstallInfo, type ReleaseInfo,
} from '../src/update/update.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';

const TAG_SHA = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const release: ReleaseInfo = {version: '0.4.0', tag: 'v0.4.0', url: 'https://github.com/raiseCatError/notMyShell/releases/tag/v0.4.0', summary: []};
const checkout: InstallInfo = {kind: 'checkout', root: '/opt/nmsh', branch: 'master', head: HEAD};

function fakeFetch(body: unknown, ok = true): FetchLike & {urls: string[]} {
  const urls: string[] = [];
  const impl = (async (url: string) => { urls.push(url); return {ok, status: ok ? 200 : 500, json: async () => body}; }) as FetchLike & {urls: string[]};
  impl.urls = urls;
  return impl;
}

/** Scripted runner: answers by command prefix and records every call. */
function scripted(answers: Record<string, string | Error>): CommandRunner & {calls: string[]} {
  const calls: string[] = [];
  return {
    calls,
    async run(command, args) {
      const line = [command, ...args].join(' ');
      calls.push(line);
      const key = Object.keys(answers).find(prefix => line.startsWith(prefix));
      const answer = key === undefined ? '' : answers[key]!;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const DESTRUCTIVE = /git (?:reset --hard|clean|pull|push|checkout -f|stash)|rm -rf/u;

test('versions compare numerically; prereleases sort before their release', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v0.4.0', '0.4.0'), 0);
  assert.equal(compareVersions('0.4.0-beta.1', '0.4.0'), -1);
  assert.equal(compareVersions('0.3.0', '0.4.0'), -1);
  assert.equal(compareVersions('unknown', '0.4.0'), -1);
});

test('release discovery reads the public latest-release endpoint without credentials', async () => {
  const fetchImpl = fakeFetch({tag_name: 'v0.4.0', html_url: 'https://example/r', body: '## Highlights\n\n**Right prompt**\n\u001b[31mred\n'});
  const info = await fetchLatestRelease(fetchImpl);
  assert.deepEqual(info, {version: '0.4.0', tag: 'v0.4.0', url: 'https://example/r', summary: ['Highlights', 'Right prompt', '[31mred']});
  assert.equal(fetchImpl.urls[0], 'https://api.github.com/repos/raiseCatError/notMyShell/releases/latest');
  await assert.rejects(fetchLatestRelease(fakeFetch({tag_name: 'nightly'})));
  await assert.rejects(fetchLatestRelease(fakeFetch({}, false)));
});

test('provenance comes from facts: non-checkouts and foreign remotes are not guessed at', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-install-'));
  try {
    assert.equal((await detectInstall(directory)).kind, 'unsupported');
    const git = (...args: string[]) => execFileSync('git', args, {cwd: directory, stdio: 'ignore'});
    git('init', '-q', '-b', 'master');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    git('remote', 'add', 'origin', 'https://github.com/someone/fork.git');
    const foreign = await detectInstall(directory);
    assert.equal(foreign.kind, 'unsupported');
    assert.match(foreign.kind === 'unsupported' ? foreign.reason : '', /someone\/fork/u);
    git('remote', 'set-url', 'origin', 'git@github.com:raiseCatError/notMyShell.git');
    const official = await detectInstall(directory);
    assert.equal(official.kind, 'checkout');
    assert.equal(official.kind === 'checkout' ? official.branch : undefined, 'master');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('plans require a clean tree, a verified tag, and a fast-forward', async () => {
  const good = {'git rev-parse v0.4.0^{commit}': TAG_SHA};
  const ok = await planUpdate(checkout, release, scripted(good), async () => TAG_SHA);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok ? ok.plan.steps : [], ['Fast-forward master to v0.4.0 (aaaaaaa)', 'npm install', 'npm run build', 'Verify the new build identity']);

  const dirty = await planUpdate(checkout, release, scripted({...good, 'git status': ' M src/x.ts'}), async () => TAG_SHA);
  assert.match(dirty.ok ? '' : dirty.reason, /uncommitted/u);
  const mismatch = await planUpdate(checkout, release, scripted(good), async () => 'c'.repeat(40));
  assert.match(mismatch.ok ? '' : mismatch.reason, /does not match GitHub/u);
  const diverged = await planUpdate(checkout, release, scripted({...good, 'git merge-base': new Error('no')}), async () => TAG_SHA);
  assert.match(diverged.ok ? '' : diverged.reason, /not a fast-forward/u);
  assert.ok(!diverged.ok && diverged.manual.some(line => line.includes('git merge --ff-only v0.4.0')));
  const offline = await planUpdate(checkout, release, scripted({...good, 'git fetch': new Error('network')}), async () => TAG_SHA);
  assert.match(offline.ok ? '' : offline.reason, /Could not fetch/u);
  const unsupported = await planUpdate({kind: 'unsupported', root: '/x', reason: 'not a checkout'}, release);
  assert.equal(unsupported.ok ? '' : unsupported.reason, 'not a checkout');
});

test('applying fast-forwards, rebuilds, and verifies the build identity', async () => {
  const runner = scripted({});
  const planned = await planUpdate(checkout, release, scripted({'git rev-parse': TAG_SHA}), async () => TAG_SHA);
  assert.ok(planned.ok);
  if (!planned.ok) return;
  const result = await applyUpdate(planned.plan, runner, undefined, () => ({version: '0.4.0', commit: 'aaaaaaa'}));
  assert.ok(result.ok, result.log.join('\n'));
  assert.deepEqual(runner.calls, [`git merge --ff-only ${TAG_SHA}`, 'npm install --no-audit --no-fund', 'npm run build']);
  const detached = await applyUpdate({...planned.plan, install: {...checkout, branch: undefined}}, scripted({}), undefined,
    () => ({version: '0.4.0', commit: 'aaaaaaa'}));
  assert.ok(detached.ok);
});

test('a failed build rolls back to the previous commit without destructive git', async () => {
  const planned = await planUpdate(checkout, release, scripted({'git rev-parse': TAG_SHA}), async () => TAG_SHA);
  if (!planned.ok) return assert.fail('plan');
  let builds = 0;
  const runner = scripted({});
  const failingBuild: CommandRunner & {calls: string[]} = {
    calls: runner.calls,
    async run(command, args, cwd) {
      if (command === 'npm' && args[0] === 'run' && builds++ === 0) { runner.calls.push('npm run build'); throw new Error('tsc failed'); }
      return runner.run(command, args, cwd);
    },
  };
  const result = await applyUpdate(planned.plan, failingBuild, undefined, () => ({version: '0.3.0', commit: 'bbbbbbb'}));
  assert.equal(result.ok, false);
  assert.ok(runner.calls.includes(`git reset --keep ${HEAD}`));
  assert.ok(runner.calls.every(call => !DESTRUCTIVE.test(call)), runner.calls.join('\n'));
  assert.ok(result.log.some(line => /tsc failed/u.test(line)) && result.log.some(line => /Restored the previous commit/u.test(line)));

  const wrongIdentity = await applyUpdate(planned.plan, scripted({}), undefined, () => ({version: '0.3.0', commit: 'bbbbbbb'}));
  assert.equal(wrongIdentity.ok, false, 'an unverified build is a failure');

  const refused = await applyUpdate(planned.plan, scripted({'git merge': new Error('not possible to fast-forward')}));
  assert.equal(refused.ok, false);
  assert.match(refused.log.join('\n'), /Nothing was changed/u);
});

test('background checks are opt-in, periodic, quiet on failure, and announce a release once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-update-state-'));
  const statePath = join(directory, 'update-state.json');
  try {
    const fetchImpl = fakeFetch({tag_name: 'v0.4.0', html_url: 'u', body: ''});
    assert.equal(await backgroundUpdateCheck('0.3.0', 'off', {statePath, fetchImpl}), undefined);
    assert.equal(fetchImpl.urls.length, 0, 'Off never touches the network');
    assert.equal((await backgroundUpdateCheck('0.3.0', 'daily', {statePath, fetchImpl, now: 1_000}))?.version, '0.4.0');
    assert.equal(await backgroundUpdateCheck('0.3.0', 'daily', {statePath, fetchImpl, now: 2_000}), undefined);
    assert.equal(fetchImpl.urls.length, 1, 'not due yet');
    assert.equal(await backgroundUpdateCheck('0.3.0', 'daily', {statePath, fetchImpl, now: 1_000 + 86_400_000}), undefined, 'announced once');
    assert.equal(await backgroundUpdateCheck('0.4.0', 'weekly', {statePath, fetchImpl: fakeFetch({}, false), now: 1e12}), undefined);
    assert.equal(isCheckDue('weekly', {lastCheck: 0}, 6 * 86_400_000), false);
    assert.equal(isCheckDue('weekly', {lastCheck: 0}, 7 * 86_400_000), true);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('/update is explicit and checks default to off', () => {
  assert.deepEqual(parseSlashCommand('/update'), {kind: 'update', apply: false});
  assert.deepEqual(parseSlashCommand('/update apply'), {kind: 'update', apply: true});
  assert.equal(parseSlashCommand('/update now')?.kind, 'unknown');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.updateChecks, 'off');
  assert.equal(normalizePromptConfiguration({updateChecks: 'weekly'}).updateChecks, 'weekly');
  assert.equal(normalizePromptConfiguration({updateChecks: 'hourly'}).updateChecks, 'off');
});
