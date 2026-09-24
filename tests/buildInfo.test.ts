import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  formatBuildIdentity,
  isVersionInvocation,
  parseBuildIdentity,
  readBuildIdentity,
} from '../src/buildInfo.js';
import {parseSlashCommand, slashSuggestions} from '../src/commands/slashCommands.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('build identity validates package version and uses explicit unknown metadata gracefully', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {version: string};
  const embedded = parseBuildIdentity({version: packageJson.version, commit: '29d6cec', branch: 'dev'});
  assert.match(embedded.version, /^\d+\.\d+\.\d+$/u, 'the embedded version is the package semver');
  assert.equal(embedded.version, packageJson.version);
  assert.equal(formatBuildIdentity(embedded), `notMyShell ${packageJson.version}\nbuild 29d6cec (dev)`);
  assert.deepEqual(parseBuildIdentity({version: 2, commit: 'not-a-sha'}), {version: 'unknown', commit: 'unknown'});
  assert.deepEqual(readBuildIdentity(new URL('./missing-build-info.json', import.meta.url)), {version: 'unknown', commit: 'unknown'});
});

test('build embeds identity beside dist code rather than discovering Git at runtime', {skip: !existsSync(join(root, 'dist', 'build-info.json'))}, () => {
  const embedded = readBuildIdentity(new URL('../dist/build-info.json', import.meta.url));
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {version: string};
  assert.equal(embedded.version, packageJson.version);
  assert.match(embedded.commit, /^(?:[\da-f]{7}|unknown)$/u);
});

test('version flags and /version report identity without constructing the terminal UI', () => {
  assert.equal(isVersionInvocation(['--version']), true);
  assert.equal(isVersionInvocation(['-v']), true);
  assert.equal(isVersionInvocation(['--help']), false);
  assert.deepEqual(parseSlashCommand('/version'), {kind: 'version'});
  assert.ok(slashSuggestions('/vers').some(suggestion => suggestion.name === '/version'));

  const result = spawnSync(process.execPath, ['--import=tsx', 'src/index.ts', '--version'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^notMyShell unknown\nbuild unknown/u);
  assert.doesNotMatch(result.stderr, /requires an interactive terminal/u);
});
