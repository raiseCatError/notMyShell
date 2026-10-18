import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bridgeBootstrap, renderEnvironmentFile, type BridgeEnvironment, type ListingWrapper} from '../src/themeBridge/environment.js';

/**
 * File listing color wrappers through real shells: the generated bootstrap
 * parses (also when ls is already an alias, as in Ubuntu's default bashrc,
 * which once broke Bash's `ls()` form), wraps only real executables, never
 * replaces the user's alias or function, keeps --color=auto before the
 * user's argv, and Off removes only NMSh's wrapper.
 */

const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const zsh = ['/bin/zsh', '/usr/bin/zsh', '/opt/homebrew/bin/zsh'].find(existsSync);
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const shells = {bash, zsh, fish} as const;

function box(withGls: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-listing-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const name of withGls ? ['ls', 'gls'] : ['ls']) {
    writeFileSync(join(bin, name), '#!/bin/sh\necho "ARGS:$*"\n');
    chmodSync(join(bin, name), 0o755);
  }
  return {root, bin, done: () => rmSync(root, {recursive: true, force: true})};
}

const values = (listing: ListingWrapper[]): BridgeEnvironment => ({LS_COLORS: 'di=34', ...(listing.length ? {listing} : {})});

/** Runs a script that loads the bootstrap, syncs listing On, runs probes, switches Off, runs probes again. */
function run(shell: keyof typeof shells, listing: ListingWrapper[], options: {withGls?: boolean; userSetup?: string} = {}) {
  const sandbox = box(options.withGls ?? true);
  try {
    const live = join(sandbox.root, 'env');
    const on = join(sandbox.root, 'on');
    const off = join(sandbox.root, 'off');
    writeFileSync(on, renderEnvironmentFile(shell, values(listing)));
    writeFileSync(off, renderEnvironmentFile(shell, values([])));
    const probe = shell === 'fish'
      ? 'echo "ls=$(ls --color=never a)"; echo "gls=$(gls b 2>/dev/null; or echo NONE)"; keep'
      : 'echo "ls=$(ls --color=never a)"; echo "gls=$(gls b 2>/dev/null || echo NONE)"; keep';
    const keep = shell === 'fish' ? 'function keep; echo KEPT; end' : 'keep() { echo KEPT; }';
    const script = [shell === 'bash' ? 'shopt -s expand_aliases' : '', options.userSetup ?? '', keep, bridgeBootstrap(shell, live),
      `cp '${on}' '${live}'`, 'nmsh_bridge_sync', 'echo ---on', probe, `cp '${off}' '${live}'`, 'nmsh_bridge_sync', 'echo ---off', probe].join('\n');
    const file = join(sandbox.root, 'script');
    writeFileSync(file, script);
    const result = spawnSync(shells[shell]!, shell === 'zsh' ? ['-f', file] : shell === 'bash' ? ['--norc', '--noprofile', file] : ['--no-config', file],
      {encoding: 'utf8', env: {PATH: `${sandbox.bin}:/usr/bin:/bin`, HOME: sandbox.root}});
    const [, onPart = '', offPart = ''] = result.stdout.split(/---(?:on|off)\n/u);
    return {status: result.status, stderr: result.stderr, on: onPart.trim(), off: offPart.trim(), script};
  } finally { sandbox.done(); }
}

test('bash: every listing variant of the generated bootstrap and environment file parses (bash -n), also with ls/gls aliased', {skip: !bash && 'bash 4.4+ not installed'}, () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-listing-parse-'));
  try {
    for (const listing of [[], ['ls'], ['gls'], ['ls', 'gls']] as ListingWrapper[][]) {
      const file = join(root, `env-${listing.join('-') || 'none'}`);
      writeFileSync(file, `${bridgeBootstrap('bash', file)}\n${renderEnvironmentFile('bash', values(listing))}`);
      const parsed = spawnSync(bash!, ['-n', file], {encoding: 'utf8'});
      assert.equal(parsed.status, 0, `${listing.join(',')}: ${parsed.stderr}`);
      // bash -n alone missed the real bug: Bash alias-expands `ls()` while parsing when ls is an alias.
      const sourced = spawnSync(bash!, ['--norc', '-c', `shopt -s expand_aliases\nalias ls='ls --color=auto'\nalias gls='gls -F'\nsource '${file}' && echo SOURCED`], {encoding: 'utf8'});
      assert.match(sourced.stdout, /SOURCED/u, `${listing.join(',')}: ${sourced.stderr}`);
    }
  } finally { rmSync(root, {recursive: true, force: true}); }
});

for (const shell of ['bash', 'zsh', 'fish'] as const) {
  test(`${shell}: listing wrappers put --color=auto before the user's argv; Off removes only NMSh's wrapper; unrelated functions survive`, {skip: !shells[shell] && `${shell} not installed`}, () => {
    const result = run(shell, ['ls', 'gls']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.on, 'ls=ARGS:--color=auto --color=never a\ngls=ARGS:--color=auto b\nKEPT', 'explicit --color=never comes later and wins');
    // Fish ships its own ls function (already --color=auto); NMSh never replaces an existing function, so only gls changes there.
    assert.equal(result.off, `ls=ARGS:${shell === 'fish' ? '--color=auto ' : ''}--color=never a\ngls=ARGS:b\nKEPT`);
  });

  test(`${shell}: an existing alias or function is never replaced; a missing executable is never wrapped`, {skip: !shells[shell] && `${shell} not installed`}, () => {
    const setup = shell === 'fish' ? 'function gls; echo USERGLS; end' : `alias ls='ls -F'\ngls() { echo USERGLS; }`;
    const own = run(shell, ['ls', 'gls'], {userSetup: setup});
    assert.equal(own.status, 0, own.stderr);
    assert.equal(own.stderr, '');
    assert.match(own.on, /^gls=USERGLS$/mu, 'the user function stays');
    assert.match(own.off, /^gls=USERGLS$/mu, 'Off does not remove what NMSh did not create');
    if (shell !== 'fish') {
      assert.match(own.on, /^ls=ARGS:-F --color=never a$/mu, 'the user alias stays');
      assert.match(own.off, /^ls=ARGS:-F --color=never a$/mu);
    }
    const missing = run(shell, ['ls', 'gls'], {withGls: false});
    assert.equal(missing.status, 0, missing.stderr);
    assert.match(missing.on, /^gls=NONE$/mu, 'no wrapper for an executable that is not installed');
    const lsOnly = run(shell, ['ls']);
    assert.match(lsOnly.on, /^ls=ARGS:--color=auto --color=never a\ngls=ARGS:b$/mu, 'only the enabled wrapper exists');
  });
}
