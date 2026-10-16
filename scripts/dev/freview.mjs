#!/usr/bin/env node
// freview: read-only local facts. Never fetch, mutate refs, run builds or delete files.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const args = process.argv.slice(2);
let base = null;
let json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') json = true;
  else if (args[i] === '--base' && args[i + 1]) base = args[++i];
  else if (args[i].startsWith('--base=')) base = args[i].slice(7);
  else if (args[i] === '--help') {
    console.log('Usage: node scripts/dev/freview.mjs [--base REF] [--json]');
    process.exit(0);
  } else {
    console.error('Unknown/incomplete argument: ' + args[i]);
    process.exit(2);
  }
}
const gitOptions = {cwd: process.cwd(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 12000, stdio: ['ignore', 'pipe', 'pipe']};
function git(input, optional = false) {
  try { return execFileSync('git', input, gitOptions).trimEnd(); }
  catch (error) {
    if (optional) return null;
    throw Error('git ' + input[0] + ': ' + (error.stderr?.toString().trim() || error.message));
  }
}
function sha(ref) { return git(['rev-parse', '--verify', '--quiet', ref + '^{commit}'], true); }
function divergence(a, b) {
  const line = git(['rev-list', '--left-right', '--count', a + '...' + b], true);
  if (!line) return null;
  const [behind, ahead] = line.trim().split(/\s+/).map(Number);
  return {ahead, behind};
}
function isAncestor(a, b) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], {...gitOptions, stdio: 'ignore'});
    return true;
  } catch (e) { return e.status === 1 ? false : null; }
}
function statusCount(str) {
  const parts = str.split('\0');
  let tracked = 0, untracked = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('??')) untracked++;
    else {
      tracked++;
      if (/^[ RC][ RC] /.test(p)) i++; // rename has an extra old-path record in -z
    }
  }
  return {tracked, untracked, clean: tracked + untracked === 0};
}
function worktreeList(str) {
  return str.split(/\n\n+/).filter(Boolean).map(block => {
    const lines = block.split('\n');
    const val = key => lines.find(l => l.startsWith(key + ' '))?.slice(key.length + 1) || null;
    return {path: val('worktree'), sha: val('HEAD'), branch: val('branch')?.replace(/^refs\/heads\//, '') || null, detached: lines.includes('detached'), locked: lines.some(l => l.startsWith('locked'))};
  });
}
function getCommunity(root) {
  const found = (...paths) => paths.some(p => existsSync(join(root, p)));
  return {
    readme: found('README.md'), license: found('LICENSE', 'LICENSE.md', 'LICENSE.txt'),
    contributing: found('CONTRIBUTING.md', '.github/CONTRIBUTING.md'),
    codeOfConduct: found('CODE_OF_CONDUCT.md', '.github/CODE_OF_CONDUCT.md'),
    security: found('SECURITY.md', '.github/SECURITY.md'),
    support: found('SUPPORT.md', '.github/SUPPORT.md'),
    accessibility: found('.github/ACCESSIBILITY.md', 'ACCESSIBILITY.md', 'docs/ACCESSIBILITY.md'),
    issueTemplates: found('.github/ISSUE_TEMPLATE'),
    prTemplate: found('.github/pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md'),
  };
}
function getNpm(root) {
  const manifest = join(root, 'package.json'), lock = join(root, 'package-lock.json');
  if (!existsSync(manifest)) return {present: false, note: 'No root npm manifest'};
  if (!existsSync(lock)) return {present: true, lockPresent: false};
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const locked = JSON.parse(readFileSync(lock, 'utf8'));
    const lockRoot = locked.packages?.[''];
    if (!lockRoot) return {present: true, lockPresent: true, lockfileVersion: locked.lockfileVersion, note: 'Cannot compare missing packages[\"\"]'};
    const drift = [];
    for (const part of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const want = pkg[part] || {}, have = lockRoot[part] || {};
      for (const [name, range] of Object.entries(want)) if (have[name] !== range) drift.push({part, name, problem: 'missing/mismatched'});
      for (const name of Object.keys(have)) if (!(name in want)) drift.push({part, name, problem: 'extra root lock entry'});
    }
    return {present: true, lockPresent: true, lockfileVersion: locked.lockfileVersion,
      direct: Object.keys(pkg.dependencies || {}).length, dev: Object.keys(pkg.devDependencies || {}).length,
      rootAligned: drift.length === 0, drift: drift.slice(0, 50), truncated: drift.length > 50};
  } catch (error) {
    return {present: true, lockPresent: true, error: 'Unparseable package metadata: ' + error.message};
  }
}
try {
  const root = git(['rev-parse', '--show-toplevel']);
  const head = git(['rev-parse', 'HEAD']);
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], true) || '(detached)';
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], true);
  const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
  base ||= ['origin/dev', 'dev', 'origin/master', 'master'].find(x => sha(x)) || null;
  const baseSha = base && sha(base);
  const worktrees = worktreeList(git(['worktree', 'list', '--porcelain']));
  const refs = git(['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(upstream:short)%00%(upstream:track)', 'refs/heads']);
  const branches = refs.split('\n').filter(Boolean).map(line => {
    const [name, id, lastCommit, tracking, trackStatus] = line.split('\0');
    return {name, sha: id, lastCommit, upstream: tracking || null, upstreamGone: Boolean(trackStatus?.includes('[gone]')),
      worktrees: worktrees.filter(w => w.branch === name).map(w => w.path),
      divergence: baseSha ? divergence(baseSha, id) : null,
      ancestorOfBase: baseSha ? isAncestor(id, baseSha) : null};
  });
  const report = {kind: 'freview-readonly-local', collectedAt: new Date().toISOString(), root, head, branch, upstream,
    shallow, base: baseSha ? {ref: base, sha: baseSha, divergence: divergence(baseSha, head)} : null,
    status: statusCount(git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'])),
    whitespace: {unstagedPass: git(['diff', '--check'], true) !== null, stagedPass: git(['diff', '--cached', '--check'], true) !== null},
    worktrees, branches, community: getCommunity(root), npm: getNpm(root),
    notVerified: ['GitHub issue/PR/CI/release status and remote freshness', 'Physical QA, security and user-observable implementation', 'Uncommitted files in other inaccessible worktrees', 'Squash/cherry-pick equivalence; ancestry alone is not enough']};
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('# freview local audit — ' + report.collectedAt);
    console.log('HEAD: ' + branch + ' @ ' + head + '; upstream: ' + (upstream || 'none') + '; shallow: ' + shallow);
    console.log('Base: ' + (baseSha ? base + ' @ ' + baseSha + ' ' + JSON.stringify(report.base.divergence) : 'not available'));
    console.log('Local state: ' + JSON.stringify(report.status) + '; whitespace: ' + JSON.stringify(report.whitespace));
    console.log('Branches: ' + branches.length + '; worktrees: ' + worktrees.length);
    for (const b of branches.filter(b => b.upstreamGone || (b.ancestorOfBase && b.name !== base)))
      console.log('Review (never automatically delete) ' + b.name + ': upstream gone=' + b.upstreamGone + ', ancestor=' + b.ancestorOfBase + ', active worktrees=' + b.worktrees.length);
    console.log('Community: ' + JSON.stringify(report.community));
    console.log('npm: ' + JSON.stringify(report.npm));
    console.log('LIMIT: Remote issues/PRs/CI/releases and physical QA require separate evidence.');
  }
} catch (e) {
  console.error('freview could not complete snapshot: ' + e.message);
  process.exitCode = 1;
}
