#!/usr/bin/env node
// Prepares a release: checks the rules, runs the checks, records provenance and writes the release notes.
// Usage: node scripts/release/prepare.mjs --version X.Y.Z --out DIR [--commit SHA] [--mode dry-run|candidate|publish]
//        [--repo owner/name] [--master-head SHA] [--confirmation TEXT] [--skip-checks] [--offline]
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {
  MODES, buildReleaseNotes, checkApproval, checkVersionConsistency, classifyExisting, evaluateQaGate,
  sha256, summarizeBlockers, tagFor, validateRefs,
} from './lib.mjs';
import {getRemoteState} from './github.mjs';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

function runCheck(name, command, args, logDir) {
  const started = Date.now();
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
  const log = join(logDir, `${name}.log`);
  return writeFile(log, `$ ${command} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}`).then(() => ({
    name, command: `${command} ${args.join(' ')}`, exitCode: result.status ?? 1, durationMs: Date.now() - started, log,
    stdout: result.stdout ?? '',
  }));
}

function auditSummary(stdout) {
  try {
    const counts = JSON.parse(stdout).metadata?.vulnerabilities;
    return counts ? {...counts} : undefined;
  } catch { return undefined; }
}

export async function prepare(argv) {
  const {values} = parseArgs({args: argv, options: {
    version: {type: 'string'}, commit: {type: 'string'}, out: {type: 'string'}, mode: {type: 'string', default: 'dry-run'},
    repo: {type: 'string', default: 'raiseCatError/notMyShell'}, 'master-head': {type: 'string'}, confirmation: {type: 'string', default: ''},
    'skip-checks': {type: 'boolean', default: false}, offline: {type: 'boolean', default: false},
  }});
  if (!values.version || !values.out) throw new Error('Usage: prepare.mjs --version X.Y.Z --out DIR [--commit SHA] [--mode dry-run|candidate|publish]');
  const {version, mode} = values;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  if (mode === 'publish' && (values['skip-checks'] || values.offline)) throw new Error('Publish mode never skips checks or the remote lookup.');
  const out = resolve(values.out);
  const logDir = join(out, 'logs');
  await mkdir(logDir, {recursive: true});

  const blockers = [];
  const notes = [];
  const head = git('rev-parse', 'HEAD');
  const commit = values.commit ?? head;
  const tag = tagFor(version);
  let masterHead = values['master-head'];
  if (!masterHead && mode === 'publish') { try { masterHead = git('rev-parse', 'refs/remotes/origin/master'); } catch { /* reported as a blocker */ } }
  blockers.push(...validateRefs({version, tag, commit, mode, masterHead, headCommit: head}));
  blockers.push(...checkApproval({mode, confirmation: values.confirmation, version}));
  const dirty = git('status', '--porcelain');
  if (dirty) blockers.push({code: 'git-dirty', message: `The working tree is not clean:\n${dirty.split('\n').slice(0, 10).join('\n')}`});

  const packageJson = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const changelog = await readFile('CHANGELOG.md', 'utf8');
  blockers.push(...checkVersionConsistency({version, packageJson, lock, changelog, mode}));

  const qaPath = join('docs', 'releases', `${tag}-qa.json`);
  const qa = existsSync(qaPath) ? await readJson(qaPath) : undefined;
  blockers.push(...evaluateQaGate(qa, version));

  let remote;
  if (values.offline) notes.push('Remote state not checked (--offline).');
  else {
    try {
      remote = getRemoteState(values.repo, tag);
      const verdict = classifyExisting({commit, ...remote});
      if (verdict.action === 'refuse') blockers.push(verdict.blocker);
      else notes.push(`Remote: ${verdict.reason}`);
    } catch (error) {
      blockers.push({code: 'remote-unreadable', message: `Could not read the tag and releases of ${values.repo}: ${String(error.stderr || error.message).trim().split('\n')[0]}`});
    }
  }

  const checks = [];
  if (values['skip-checks']) notes.push('Build, typecheck, tests and audit skipped (--skip-checks).');
  else if (!dirty) {
    const steps = [
      ['build', 'npm', ['run', 'build']],
      ['typecheck', 'npm', ['run', 'typecheck']],
      ['test-fast', 'npm', ['run', 'test:fast']],
      ['audit', 'npm', ['audit', '--omit=dev', '--json']],
    ];
    for (const [name, command, args] of steps) {
      const result = await runCheck(name, command, args, logDir);
      checks.push(result);
      if (name === 'audit') {
        // Audit findings are reported in provenance and the notes, never hidden; they do not by themselves block.
        result.audit = auditSummary(result.stdout);
        if (result.exitCode !== 0) notes.push(`npm audit --omit=dev reported findings or failed (exit ${result.exitCode}): ${JSON.stringify(result.audit ?? 'see log')}`);
      } else if (result.exitCode !== 0) blockers.push({code: `check-${name}`, message: `\`${result.command}\` failed (exit ${result.exitCode}); see ${result.log}`});
    }
  } else notes.push('Checks not run because the tree is dirty.');

  const lockText = await readFile('package-lock.json');
  const dependencies = Object.fromEntries(Object.keys(packageJson.dependencies ?? {}).sort().map(name => [name, lock.packages?.[`node_modules/${name}`]?.version ?? 'unknown']));
  let tree; try { tree = git('rev-parse', `${commit}^{tree}`); } catch { tree = undefined; }
  const provenance = {
    version, tag, mode, commit, tree, repository: values.repo,
    node: process.version, npm: execFileSync('npm', ['--version'], {encoding: 'utf8'}).trim(),
    lockfileSha256: sha256(lockText), dependencies,
    checks: checks.map(({stdout, ...rest}) => rest),
    qa: qa ? {rows: qa.rows?.length ?? 0} : null,
    // Publish refuses a record that lists any blocker, so a lost exit status can never publish.
    blockers: blockers.map(item => item.code),
    createdAt: new Date().toISOString(),
  };
  await writeFile(join(out, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(join(out, 'release-notes.md'), buildReleaseNotes({version, changelog, qa, commit}));

  const {failing, soft} = summarizeBlockers(blockers, mode);
  console.log(`Release ${tag} at ${commit} (${mode})`);
  for (const note of notes) console.log(`note: ${note}`);
  for (const item of soft) console.log(`warning: [${item.code}] ${item.message}`);
  console.log(failing.length === 0 ? 'BLOCKERS: none' : `BLOCKERS (${failing.length}):`);
  for (const item of failing) console.log(`- [${item.code}] ${item.message}`);
  console.log(`Wrote ${join(out, 'provenance.json')} and ${join(out, 'release-notes.md')}`);
  // Dry-run reports and continues; candidate and publish fail on blockers (publish counts soft ones too).
  return {blockers: failing, exitCode: mode === 'dry-run' || failing.length === 0 ? 0 : 1};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepare(process.argv.slice(2)).then(({exitCode}) => process.exit(exitCode), error => { console.error(error.message); process.exit(2); });
}
