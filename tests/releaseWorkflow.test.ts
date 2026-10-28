import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
// @ts-expect-error plain ESM scripts without declarations
import * as lib from '../scripts/release/lib.mjs';
// @ts-expect-error plain ESM scripts without declarations
import {updateFormula} from '../scripts/release/homebrew.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = (): string => mkdtempSync(join(process.env.NMSH_TEST_TMPDIR ?? process.env.TMPDIR ?? '.', 'release-'));
const SHA = 'a'.repeat(40), OTHER = 'b'.repeat(40);
const codes = (items: Array<{code: string}>): string[] => items.map(item => item.code);

const changelog = (heading: string): string => `# Changelog\n\n## [Unreleased]\n\n- later\n\n## [1.2.3] - ${heading}\n\n### Added\n\n- a thing\n\n## [1.2.2] - 2026-01-01\n\n- old\n\n[Unreleased]: https://example.test/compare\n`;
const manifest = (version: string): {version: string; packages: {'': {version: string}}} => ({version, packages: {'': {version}}});

test('semver parse and compare', () => {
  assert.deepEqual(lib.parseSemver('1.20.3'), [1, 20, 3]);
  for (const bad of ['1.2', 'v1.2.3', '01.2.3', '1.2.3-rc1', '']) assert.equal(lib.parseSemver(bad), undefined, bad);
  assert.equal(lib.compareSemver('1.10.0', '1.9.9'), 1);
  assert.equal(lib.compareSemver('0.9.0', '0.10.0'), -1);
  assert.equal(lib.compareSemver('2.0.0', '2.0.0'), 0);
  assert.throws(() => lib.compareSemver('x', '1.0.0'));
});

test('version consistency reports every mismatch and an unreleased heading only blocks publishing', () => {
  const good = {version: '1.2.3', packageJson: {version: '1.2.3'}, lock: manifest('1.2.3'), changelog: changelog('2026-10-30'), mode: 'publish'};
  assert.deepEqual(lib.checkVersionConsistency(good), []);
  const bad = lib.checkVersionConsistency({...good, packageJson: {version: '1.2.2'}, lock: {version: '1.2.3', packages: {'': {version: '1.2.1'}}}});
  assert.equal(bad.length, 2);
  assert.match(bad[0].message, /package\.json is 1\.2\.2/u);
  assert.match(bad[1].message, /packages\[""\] is 1\.2\.1/u);
  assert.deepEqual(codes(lib.checkVersionConsistency({...good, changelog: '# Changelog\n## [Unreleased]\n'})), ['changelog-missing']);
  const candidate = {...good, mode: 'candidate', changelog: changelog('Unreleased (release candidate)')};
  const unreleased = lib.checkVersionConsistency(candidate);
  assert.deepEqual(codes(unreleased), ['changelog-unreleased']);
  assert.equal(lib.summarizeBlockers(unreleased, 'candidate').failing.length, 0);
  assert.equal(lib.summarizeBlockers(unreleased, 'publish').failing.length, 1);
  assert.deepEqual(codes(lib.checkVersionConsistency({...candidate, mode: 'publish'})), ['changelog-unreleased']);
  assert.equal(lib.summarizeBlockers(lib.checkVersionConsistency({...candidate, mode: 'publish'}), 'publish').failing.length, 1);
  assert.deepEqual(codes(lib.checkVersionConsistency({...good, version: '1.2'})), ['version-invalid']);
});

test('refs: tag shape, full commit, and publish only from the head of master', () => {
  const ok = {version: '1.2.3', tag: 'v1.2.3', commit: SHA, mode: 'publish', masterHead: SHA, headCommit: SHA};
  assert.deepEqual(lib.validateRefs(ok), []);
  assert.deepEqual(codes(lib.validateRefs({...ok, tag: '1.2.3'})), ['tag-invalid']);
  assert.deepEqual(codes(lib.validateRefs({...ok, tag: 'v1.2.3-rc1'})), ['tag-invalid']);
  assert.deepEqual(codes(lib.validateRefs({...ok, commit: 'abc1234'})), ['commit-invalid']);
  assert.deepEqual(codes(lib.validateRefs({...ok, commit: SHA.toUpperCase()})), ['commit-invalid']);
  assert.deepEqual(codes(lib.validateRefs({...ok, masterHead: OTHER})), ['commit-not-master']);
  assert.deepEqual(codes(lib.validateRefs({...ok, masterHead: undefined})), ['master-unknown']);
  assert.deepEqual(codes(lib.validateRefs({...ok, headCommit: OTHER})), ['commit-not-checked-out']);
  assert.deepEqual(lib.validateRefs({...ok, mode: 'dry-run', masterHead: OTHER}), [], 'a dry run may use any commit');
  assert.deepEqual(codes(lib.validateRefs({...ok, mode: 'ship'})), ['mode-invalid']);
});

test('approval needs the exact confirmation text, in publish mode only', () => {
  assert.deepEqual(lib.checkApproval({mode: 'publish', confirmation: 'publish v1.2.3', version: '1.2.3'}), []);
  for (const confirmation of ['', 'publish 1.2.3', 'Publish v1.2.3', 'publish v1.2.3 ', 'publish v1.2.4']) {
    assert.deepEqual(codes(lib.checkApproval({mode: 'publish', confirmation, version: '1.2.3'})), ['approval-missing'], confirmation);
  }
  assert.deepEqual(lib.checkApproval({mode: 'dry-run', confirmation: '', version: '1.2.3'}), []);
});

test('QA gate: missing file, open rows and unexplained waivers block; pending is soft', () => {
  assert.deepEqual(codes(lib.evaluateQaGate(undefined, '1.2.3')), ['qa-missing']);
  assert.deepEqual(codes(lib.evaluateQaGate({version: '1.2.3', rows: []}, '1.2.3')), ['qa-empty']);
  assert.deepEqual(codes(lib.evaluateQaGate({version: '1.2.2', rows: [{id: 'a', status: 'pass'}]}, '1.2.3')), ['qa-version']);
  const rows = [{id: 'a', status: 'pass'}, {id: 'b', status: 'waived', reason: 'no hardware'}, {id: 'c', status: 'waived'}, {id: 'd', status: 'fail'}, {id: 'e', status: 'pending'}];
  const blockers = lib.evaluateQaGate({version: '1.2.3', rows}, '1.2.3');
  assert.deepEqual(codes(blockers), ['qa-waiver-reason', 'qa-row-open', 'qa-row-open']);
  assert.deepEqual(blockers.map((item: {soft?: boolean}) => Boolean(item.soft)), [false, false, true]);
  assert.deepEqual(lib.evaluateQaGate({version: '1.2.3', rows: rows.slice(0, 2)}, '1.2.3'), []);
  assert.match(lib.qaSummary({version: '1.2.3', rows}), /1 of 5 rows passed, 2 waived, 2 open[\s\S]*Waived: b - no hardware/u);
});

test('changelog section becomes release notes with install, limitations and QA status', () => {
  assert.equal(lib.extractChangelogSection(changelog('2026-10-30'), '1.2.3'), '### Added\n\n- a thing');
  assert.equal(lib.extractChangelogSection(changelog('2026-10-30'), '9.9.9'), undefined);
  const notes = lib.buildReleaseNotes({version: '1.2.3', changelog: changelog('2026-10-30'), qa: undefined, commit: SHA});
  assert.match(notes, /^### Added/u);
  assert.match(notes, /## Install and upgrade[\s\S]*## Limitations[\s\S]*no standalone or portable binaries[\s\S]*## Physical QA\n\nNo physical QA record/u);
  assert.match(notes, new RegExp(SHA, 'u'));
});

test('checksums: write, parse, verify; missing artifacts and mismatches fail clearly', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'a.tgz'), 'alpha');
  writeFileSync(join(dir, 'provenance.json'), '{}');
  const sums = lib.formatSums([{name: 'a.tgz', sha256: lib.sha256('alpha')}, {name: 'provenance.json', sha256: lib.sha256('{}')}]);
  assert.match(sums, /^[0-9a-f]{64} {2}a\.tgz\n/u);
  assert.deepEqual(lib.parseSums(sums).map((entry: {name: string}) => entry.name), ['a.tgz', 'provenance.json']);
  assert.throws(() => lib.parseSums('nonsense\n'), /Malformed/u);
  assert.throws(() => lib.parseSums(`${lib.sha256('x')}  ../escape\n`), /Malformed/u);
  assert.deepEqual(await lib.verifySums(dir), ['SHA256SUMS: missing']);
  writeFileSync(join(dir, 'SHA256SUMS'), sums);
  assert.deepEqual(await lib.verifySums(dir, {required: ['a.tgz']}), []);
  assert.deepEqual(await lib.verifySums(dir, {required: ['b.tgz']}), ['b.tgz: not listed in SHA256SUMS']);
  writeFileSync(join(dir, 'a.tgz'), 'tampered');
  const mismatch = await lib.verifySums(dir);
  assert.equal(mismatch.length, 1);
  assert.match(mismatch[0], /^a\.tgz: checksum mismatch/u);
  const missing = tmp();
  writeFileSync(join(missing, 'SHA256SUMS'), sums);
  assert.deepEqual(await lib.verifySums(missing), ['a.tgz: missing artifact', 'provenance.json: missing artifact']);
});

test('existing tag and release: refuse, resume a draft at the same commit, never move a tag', () => {
  const draft = {draft: true}, published = {draft: false};
  assert.equal(lib.classifyExisting({commit: SHA, tag: {exists: false}, release: undefined}).action, 'create');
  assert.equal(lib.classifyExisting({commit: SHA, tag: {exists: true, commit: SHA}, release: draft}).action, 'resume');
  assert.equal(lib.classifyExisting({commit: SHA, tag: {exists: true, commit: SHA}, release: undefined}).action, 'resume');
  const published1 = lib.classifyExisting({commit: SHA, tag: {exists: true, commit: SHA}, release: published});
  assert.deepEqual([published1.action, published1.blocker.code], ['refuse', 'release-exists']);
  const moved = lib.classifyExisting({commit: SHA, tag: {exists: true, commit: OTHER}, release: draft});
  assert.deepEqual([moved.action, moved.blocker.code], ['refuse', 'tag-exists']);
  assert.equal(lib.classifyExisting({commit: SHA, tag: {exists: false}, release: published}).action, 'refuse');
});

test('CI gate needs both Verify checks and a successful dispatched run on the commit', () => {
  const checks = [{name: 'Verify (22.x)', conclusion: 'success'}, {name: 'Verify (26.x)', conclusion: 'success'}];
  const dispatch = [{event: 'workflow_dispatch', conclusion: 'success'}];
  assert.deepEqual(lib.evaluateCiGate({checkRuns: checks, dispatchRuns: dispatch}), []);
  assert.deepEqual(codes(lib.evaluateCiGate({checkRuns: checks.slice(0, 1), dispatchRuns: dispatch})), ['ci-check']);
  assert.deepEqual(codes(lib.evaluateCiGate({checkRuns: [...checks, {name: 'Verify (26.x)', conclusion: 'failure'}], dispatchRuns: dispatch})), ['ci-check']);
  assert.deepEqual(codes(lib.evaluateCiGate({checkRuns: checks, dispatchRuns: [{event: 'workflow_dispatch', conclusion: 'failure'}]})), ['ci-dispatch']);
  assert.deepEqual(codes(lib.evaluateCiGate({checkRuns: [], dispatchRuns: []})), ['ci-check', 'ci-check', 'ci-dispatch']);
});

const FORMULA = `class Nmsh < Formula
  homepage "https://github.com/raiseCatError/notMyShell"
  url "https://github.com/raiseCatError/notMyShell/archive/refs/tags/v0.23.0.tar.gz"
  sha256 "${'1'.repeat(64)}"
  license "GPL-3.0-only"
end
`;

test('homebrew formula update changes url and sha256 only, and refuses odd input', () => {
  const next = updateFormula(FORMULA, '0.24.0', 'c'.repeat(64));
  assert.equal(next, FORMULA.replace('v0.23.0', 'v0.24.0').replace('1'.repeat(64), 'c'.repeat(64)));
  assert.throws(() => updateFormula(FORMULA, '0.22.0', 'c'.repeat(64)), /newer/u);
  assert.throws(() => updateFormula(FORMULA, '0.24.0', 'xyz'), /sha256/u);
  assert.throws(() => updateFormula(FORMULA, '0.24', 'c'.repeat(64)), /X\.Y\.Z/u);
  assert.throws(() => updateFormula('class X\nend\n', '0.24.0', 'c'.repeat(64)), /recognizable/u);
  assert.throws(() => updateFormula(`${FORMULA}  resource "x" do\n    url "https://example.test/x.tgz"\n  end\n`, '0.24.0', 'c'.repeat(64)), /more than one/u);
});

test('prepare dry-run reports a version mismatch as a blocker and publish refuses it', () => {
  const dir = tmp();
  const base = ['scripts/release/prepare.mjs', '--version', '9.9.9', '--out', join(dir, 'out'), '--offline', '--skip-checks'];
  const env = {...process.env, HOME: dir};
  const dry = spawnSync(process.execPath, [...base, '--mode', 'dry-run'], {cwd: root, encoding: 'utf8', env});
  assert.match(dry.stdout, /BLOCKERS \(\d+\):[\s\S]*version-mismatch|\[version-mismatch\]/u);
  assert.match(dry.stdout, /\[qa-missing\]/u);
  assert.equal(dry.status, 0, 'a dry run reports and continues');
  const live = spawnSync(process.execPath, [...base, '--mode', 'publish'], {cwd: root, encoding: 'utf8', env});
  assert.notEqual(live.status, 0);
  assert.match(live.stderr, /never skips/u);
});

test('verify-artifact fails on a missing artifact and on a checksum mismatch', () => {
  const dir = tmp();
  const run = (): {status: number | null; stderr: string} => spawnSync(process.execPath, ['scripts/release/verify-artifact.mjs', '--version', '1.2.3', '--dir', dir, '--work', join(dir, 'work')], {cwd: root, encoding: 'utf8', env: {...process.env, HOME: dir}});
  let result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256SUMS: missing/u);
  writeFileSync(join(dir, 'SHA256SUMS'), lib.formatSums([{name: 'nmsh-1.2.3-source.tar.gz', sha256: lib.sha256('x')}]));
  result = run();
  assert.match(result.stderr, /nmsh-1\.2\.3-source\.tar\.gz: missing artifact/u);
  writeFileSync(join(dir, 'nmsh-1.2.3-source.tar.gz'), 'y');
  result = run();
  assert.match(result.stderr, /checksum mismatch/u);
});

test('package.mjs archives the exact commit reproducibly with a checksum file', () => {
  const dir = tmp();
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]): string => execFileSync('git', args, {cwd: repo, encoding: 'utf8', env: {...process.env, HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test'}}).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'package.json'), '{"version":"1.2.3"}');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  const commit = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'later.txt'), 'not in the release');
  git('add', '.');
  git('commit', '-q', '-m', 'two');
  const pack = (out: string): void => { execFileSync(process.execPath, [join(root, 'scripts/release/package.mjs'), '--version', '1.2.3', '--commit', commit, '--out', out], {cwd: repo, env: {...process.env, HOME: dir}}); };
  mkdirSync(join(dir, 'o1')); mkdirSync(join(dir, 'o2'));
  pack(join(dir, 'o1')); pack(join(dir, 'o2'));
  assert.equal(readFileSync(join(dir, 'o1/SHA256SUMS'), 'utf8'), readFileSync(join(dir, 'o2/SHA256SUMS'), 'utf8'), 'the same commit packages to the same bytes');
  const listing = execFileSync('tar', ['-tzf', join(dir, 'o1/nmsh-1.2.3-source.tar.gz')], {encoding: 'utf8'});
  assert.match(listing, /notMyShell-1\.2\.3\/package\.json/u);
  assert.doesNotMatch(listing, /later\.txt/u);
});

test('release.yml: manual or release-script-PR triggers only, pinned actions, gated publish, declared permissions', () => {
  const text = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  const on = /^on:\n([\s\S]*?)\n\npermissions:/mu.exec(text)?.[1] ?? '';
  assert.match(on, /^ {2}workflow_dispatch:/mu);
  assert.match(on, /^ {2}pull_request:\n {4}paths:\n {6}- scripts\/release\/\*\*\n {6}- \.github\/workflows\/release\.yml\n {6}- tests\/release\*\.test\.ts/mu);
  assert.doesNotMatch(on, /^ {2}(push|schedule|release|workflow_run|pull_request_target):/mu);
  assert.match(text, /^permissions: \{\}$/mu);
  assert.match(text, /concurrency:\n {2}group: nmsh-release\n {2}cancel-in-progress: false/u);
  for (const match of text.matchAll(/^\s*- uses: (\S+)/gmu)) assert.match(match[1], /^actions\/[\w-]+@[0-9a-f]{40}$/u, match[1]);
  const jobs = text.split(/^jobs:\n/mu)[1].split(/^ {2}(?=[a-z]+:\n)/mu).filter(Boolean);
  assert.equal(jobs.length, 3);
  for (const job of jobs) assert.match(job, /^ {4}permissions:\n {6}\w+: (read|write)/mu, job.split('\n')[0]);
  const publish = jobs.find(job => job.startsWith('publish:')) ?? '';
  assert.match(publish, /if: github\.event_name == 'workflow_dispatch' && inputs\.mode == 'publish' && github\.ref == 'refs\/heads\/master'/u);
  assert.match(publish, /environment:\n {6}name: nmsh-production/u);
  assert.match(publish, /contents: write/u);
  for (const job of jobs.filter(item => !item.startsWith('publish:'))) assert.doesNotMatch(job, /write/u, job.split('\n')[0]);
  assert.match(jobs.find(job => job.startsWith('homebrew:')) ?? '', /environment:\n {6}name: nmsh-production/u);
  const runBodies = [...text.matchAll(/run: [|]\n((?: {10}.*\n?)+)/gu)].map(match => match[1]).join('\n');
  assert.doesNotMatch(runBodies, /\$\{\{ *inputs\./u, 'inputs reach shell only through env');
});
