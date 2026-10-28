#!/usr/bin/env node
// Verifies a packaged release the way Homebrew would install it: checksums, extract, npm ci, build, prune, run.
// Usage: node scripts/release/verify-artifact.mjs --version X.Y.Z --dir DIR [--work DIR] [--keep]
import {spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {parseSemver, verifySums} from './lib.mjs';

const PTY_SMOKE = `
const assert = require('node:assert/strict');
const pty = require(process.argv[2]);
const term = pty.spawn('/bin/echo', ['nmsh-pty-ok'], {cols: 80, rows: 24});
let output = '';
const timeout = setTimeout(() => { term.kill(); process.exit(1); }, 5000);
term.onData(data => { output += data; });
term.onExit(({exitCode}) => { clearTimeout(timeout); assert.equal(exitCode, 0); assert.match(output, /nmsh-pty-ok/); console.log('nmsh-pty-ok'); });
`;

function run(label, command, args, options) {
  console.log(`$ ${label}`);
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options});
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n');
    throw new Error(`${label} failed (exit ${result.status ?? result.signal}):\n${tail}`);
  }
  return result.stdout ?? '';
}

export async function verifyArtifact(argv) {
  const {values} = parseArgs({args: argv, options: {version: {type: 'string'}, dir: {type: 'string'}, work: {type: 'string'}, keep: {type: 'boolean', default: false}}});
  if (!values.version || !values.dir || !parseSemver(values.version)) throw new Error('Usage: verify-artifact.mjs --version X.Y.Z --dir DIR [--work DIR] [--keep]');
  const dir = resolve(values.dir);
  const name = `nmsh-${values.version}-source.tar.gz`;
  const problems = await verifySums(dir, {required: [name]});
  if (problems.length) throw new Error(`Artifact verification failed:\n${problems.map(item => `- ${item}`).join('\n')}`);
  console.log(`Checksums verified for ${dir}`);

  const work = values.work ? resolve(values.work) : await mkdtemp(join(tmpdir(), 'nmsh-verify-'));
  await mkdir(work, {recursive: true});
  try {
    const home = join(work, 'home');
    await mkdir(home, {recursive: true});
    // Private HOME/XDG/npm cache: nothing here may touch the real home directory.
    const env = {
      ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'),
      XDG_STATE_HOME: join(home, '.local/state'), XDG_CACHE_HOME: join(home, '.cache'), npm_config_cache: join(work, 'npm-cache'),
      npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false',
    };
    const src = join(work, 'src');
    await mkdir(src, {recursive: true});
    run('tar -xzf', 'tar', ['-xzf', join(dir, name), '-C', src], {env});
    const root = join(src, `notMyShell-${values.version}`);
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (pkg.version !== values.version) throw new Error(`The archive's package.json is ${pkg.version}, not ${values.version}.`);
    run('npm ci', 'npm', ['ci'], {cwd: root, env});
    run('npm run build', 'npm', ['run', 'build'], {cwd: root, env});
    run('npm prune --omit=dev', 'npm', ['prune', '--omit=dev', '--ignore-scripts'], {cwd: root, env});
    const libexec = join(work, 'prefix', 'libexec');
    await mkdir(libexec, {recursive: true});
    for (const item of ['bin', 'dist', 'node_modules', 'package.json', 'LICENSE', 'assets']) await cp(join(root, item), join(libexec, item), {recursive: true});
    await mkdir(join(libexec, 'scripts'), {recursive: true});
    for (const item of ['read-command-history.cjs', 'ensure-node-pty-helper.mjs']) await cp(join(root, 'scripts', item), join(libexec, 'scripts', item));
    const version = run('nmsh --version', process.execPath, [join(libexec, 'bin/nmsh'), '--version'], {env, cwd: work});
    if (!version.includes(`notMyShell ${values.version}`)) throw new Error(`nmsh --version printed "${version.trim()}", expected notMyShell ${values.version}`);
    const smoke = join(work, 'pty-smoke.cjs');
    await writeFile(smoke, PTY_SMOKE);
    const pty = run('node-pty spawn smoke', process.execPath, [smoke, join(libexec, 'node_modules/node-pty')], {env, cwd: work});
    if (!pty.includes('nmsh-pty-ok')) throw new Error('The node-pty smoke did not print nmsh-pty-ok.');
    console.log(`Verified ${name}: ${version.trim().replace(/\n/gu, ' / ')}; node-pty ok`);
  } finally {
    if (!values.keep) await rm(work, {recursive: true, force: true});
    else console.log(`Kept ${work}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyArtifact(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
