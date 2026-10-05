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

test('/update is explicit', () => {
  assert.deepEqual(parseSlashCommand('/update'), {kind: 'update', apply: false});
  assert.deepEqual(parseSlashCommand('/update apply'), {kind: 'update', apply: true});
  assert.equal(parseSlashCommand('/update now')?.kind, 'unknown');
});

const update = (input: Record<string, unknown>) => { const c = normalizePromptConfiguration(input); return [c.updateMode, c.updateFrequency]; };
test('update settings: fresh installs are Automatic / Daily; saved intent is preserved, never upgraded to automatic', () => {
  assert.deepEqual([DEFAULT_PROMPT_CONFIGURATION.updateMode, DEFAULT_PROMPT_CONFIGURATION.updateFrequency], ['automatic', 'daily']);
  assert.deepEqual(update({}), ['automatic', 'daily']);
  assert.deepEqual(update({updateChecks: 'off', onboardingComplete: true}), ['off', 'daily']);
  assert.deepEqual(update({updateChecks: 'daily'}), ['notify', 'daily']);
  assert.deepEqual(update({updateChecks: 'weekly'}), ['notify', 'weekly']);
  assert.deepEqual(update({updateChecks: 'hourly'}), ['off', 'daily'], 'unrecognised saved value stays off');
  assert.deepEqual(update({onboardingComplete: true}), ['off', 'daily'], 'a saved config that predates the setting was Off');
  assert.deepEqual(update({updateMode: 'automatic', updateFrequency: 'weekly', updateChecks: 'off'}), ['automatic', 'weekly'], 'new keys win');
  assert.equal('updateChecks' in normalizePromptConfiguration({updateChecks: 'daily'}), false, 'no competing legacy setting remains');
});


import {mkdtempSync, readFileSync as readFile, statSync, writeFileSync as writeFile} from 'node:fs';
import {checkForUpdate, loadUpdateState, prepareAutomaticUpdate, readyVersion, recordInstalled, saveUpdateState, updatesDisabledByEnvironment} from '../src/update/update.js';

const stateFile = () => join(mkdtempSync(join(tmpdir(), 'nmsh-upd-')), 'cfg', 'update-state.json');
const newer: ReleaseInfo = {version: '0.17.0', tag: 'v0.17.0', url: 'https://github.com/raiseCatError/notMyShell/releases/tag/v0.17.0', summary: []};
const OFFICIAL = 'https://github.com/raiseCatError/notMyShell.git';
const NEW_SHA = 'c'.repeat(40);
const identity = () => ({version: '0.17.0', commit: NEW_SHA.slice(0, 7)});
/** An official, clean, fast-forwardable checkout unless an answer overrides it. */
const healthy = (extra: Record<string, string | Error> = {}) => scripted({
  'git rev-parse --show-toplevel': process.cwd(), 'git remote get-url': OFFICIAL, 'git rev-parse HEAD': HEAD, 'git symbolic-ref': 'master',
  'git status --porcelain --untracked-files=no': '', 'git fetch': '', 'git rev-parse v0.17.0': NEW_SHA, 'git merge-base': '', ...extra,
});
const harness = (runner: CommandRunner, statePath: string, tagCommit = async () => NEW_SHA) => ({statePath, runner, root: process.cwd(), tagCommit, readIdentity: identity});

test('semver jump 0.16.0 -> 0.17.0 is newer; updates are disabled under the test runner', () => {
  assert.equal(compareVersions('0.17.0', '0.16.0'), 1);
  assert.equal(compareVersions('0.16.0', '0.17.0'), -1);
  assert.equal(updatesDisabledByEnvironment({}), false);
  assert.equal(updatesDisabledByEnvironment({NMSH_DISABLE_UPDATES: '1'}), true);
});

test('Off makes no request; notify-only discovery never mutates; repeated checks announce a release once', async () => {
  const statePath = stateFile();
  const fetchImpl = fakeFetch({tag_name: 'v0.17.0', html_url: 'https://example/r', body: ''});
  assert.deepEqual(await checkForUpdate('0.16.0', 'off', {statePath, fetchImpl, now: 1e12}), {announce: false});
  assert.equal(fetchImpl.urls.length, 0);
  const first = await checkForUpdate('0.16.0', 'daily', {statePath, fetchImpl, now: 1e12});
  assert.equal(first.announce, true); assert.equal(first.release?.version, '0.17.0');
  const second = await checkForUpdate('0.16.0', 'daily', {statePath, fetchImpl, now: 1e12 + 90_000_000});
  assert.equal(second.announce, false, 'same release is not announced twice'); assert.equal(second.release?.version, '0.17.0');
  assert.equal(statSync(statePath).mode & 0o777, 0o600, 'update state stays private');
});

test('automatic: an eligible install is prepared through the shared plan/apply; the running version stays distinct', async () => {
  const statePath = stateFile();
  const runner = healthy();
  const outcome = await prepareAutomaticUpdate(newer, harness(runner, statePath));
  assert.deepEqual(outcome, {kind: 'ready', version: '0.17.0', announce: true});
  assert.ok(runner.calls.some(call => call.startsWith('git merge --ff-only')) && runner.calls.includes('npm run build'));
  assert.ok(!runner.calls.some(call => DESTRUCTIVE.test(call)));
  const state = loadUpdateState(statePath);
  assert.equal(state.installedVersion, '0.17.0');
  assert.equal(readyVersion(state, '0.16.0'), '0.17.0', 'prepared on disk, not yet running');
  assert.equal(readyVersion(state, '0.17.0'), undefined, 'once running it, nothing is pending');
  const again = await prepareAutomaticUpdate(newer, harness(runner, statePath));
  assert.deepEqual(again, {kind: 'ready', version: '0.17.0', announce: false}, 'no second install, no second notice');
});

for (const [name, answers, tagCommit, pattern] of [
  ['dirty tracked tree', {'git status --porcelain --untracked-files=no': ' M src/x.ts'}, undefined, /uncommitted changes/u],
  ['unofficial remote', {'git remote get-url': 'https://github.com/someone/fork.git'}, undefined, /not github\.com/u],
  ['diverged checkout', {'git merge-base': new Error('not ancestor')}, undefined, /not a fast-forward/u],
  ['tag and GitHub disagree', {}, async () => 'd'.repeat(40), /does not match GitHub/u],
] as Array<[string, Record<string, string | Error>, (() => Promise<string>) | undefined, RegExp]>) {
  test(`automatic: ${name} is never changed, and the skip is announced once`, async () => {
    const statePath = stateFile();
    const runner = healthy(answers);
    const outcome = await prepareAutomaticUpdate(newer, harness(runner, statePath, tagCommit));
    assert.equal(outcome.kind, 'skipped'); assert.match((outcome as {reason: string}).reason, pattern); assert.equal(outcome.announce, true);
    assert.ok(!runner.calls.some(call => /git (?:merge --ff|switch|reset)|npm /u.test(call)), 'nothing was moved or built');
    const repeat = await prepareAutomaticUpdate(newer, harness(healthy(answers), statePath, tagCommit));
    assert.equal(repeat.announce, false, 'no repeated nagging');
    assert.equal(loadUpdateState(statePath).installedVersion, undefined);
  });
}

test('automatic: a failing build rolls back, is announced once and is not retried in a loop', async () => {
  const statePath = stateFile();
  const runner = healthy({'npm run build': new Error('tsc failed')});
  const outcome = await prepareAutomaticUpdate(newer, harness(runner, statePath));
  assert.equal(outcome.kind, 'failed'); assert.equal(outcome.announce, true);
  assert.ok(runner.calls.some(call => call.startsWith('git reset --keep')), 'rollback ran');
  assert.equal(loadUpdateState(statePath).installedVersion, undefined);
  const calls = runner.calls.length;
  const retry = await prepareAutomaticUpdate(newer, harness(runner, statePath));
  assert.equal(retry.kind, 'failed'); assert.equal(retry.announce, false);
  assert.equal(runner.calls.length, calls, 'no commands run on the repeat');
  recordInstalled('0.17.0', statePath);
  assert.equal(loadUpdateState(statePath).failed, undefined, 'a successful manual apply clears the failure');
});

test('automatic: a runner that throws unexpectedly never escapes', async () => {
  const outcome = await prepareAutomaticUpdate(newer, {statePath: stateFile(), root: process.cwd(), runner: {run: async () => { throw new Error('boom'); }}});
  assert.ok(['skipped', 'failed'].includes(outcome.kind));
});

test('update state round-trips new fields, bounded and private; untracked files do not affect the tracked-clean probe', () => {
  const statePath = stateFile();
  saveUpdateState({lastCheck: 1, installedVersion: '0.17.0', failed: {version: '0.18.0', at: 5, reason: 'x'.repeat(500)}}, statePath);
  const state = loadUpdateState(statePath);
  assert.equal(state.installedVersion, '0.17.0');
  assert.equal(state.failed?.reason.length, 200);
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.doesNotMatch(readFile(statePath, 'utf8'), /token|secret/iu);
  writeFile(statePath, '{"failed": {"version": 3}}'); assert.deepEqual(loadUpdateState(statePath), {});
});
