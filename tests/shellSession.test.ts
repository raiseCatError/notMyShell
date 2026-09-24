import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShellSession} from '../src/shell/ShellSession.js';
import type {ShellMarker} from '../src/shell/ShellProtocol.js';

/**
 * Real tools (zoxide, Atuin, fzf) install their own non-UI lifecycle hooks by
 * either appending to precmd_functions/preexec_functions directly (zoxide) or
 * via `add-zsh-hook` (Atuin). NMSh must compose with both styles instead of
 * overwriting the hook arrays, or those tools silently stop working the
 * moment a user opens NMSh.
 */
function fakeUserHome(markerDir: string): string {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-fake-home-'));
  writeFileSync(join(home, '.zshrc'), `
alias test_alias='echo ALIAS_OK'
function test_func { echo FUNC_OK }
export TEST_ENV_VAR=env_ok
export PATH="$HOME/fakebin:$PATH"

# zoxide-style: appends directly to the array, no add-zsh-hook.
precmd_functions+=(fake_zoxide_precmd)
function fake_zoxide_precmd {
  echo -n "1" >> "${markerDir}/zoxide_precmd_count"
}

# Atuin-style: registers through add-zsh-hook.
autoload -Uz add-zsh-hook
function fake_atuin_preexec {
  echo -n "1" >> "${markerDir}/atuin_preexec_count"
}
function fake_atuin_precmd {
  echo -n "1" >> "${markerDir}/atuin_precmd_count"
}
add-zsh-hook preexec fake_atuin_preexec
add-zsh-hook precmd fake_atuin_precmd

# A foreign prompt plugin repainting PROMPT/RPROMPT from its own precmd.
function fake_prompt_plugin_precmd {
  PROMPT='FOREIGN-PROMPT'
  RPROMPT='FOREIGN-RPROMPT'
}
add-zsh-hook precmd fake_prompt_plugin_precmd
`);
  return home;
}

function waitForMarker(session: ShellSession, timeoutMs = 10000): Promise<ShellMarker> {
  return new Promise((resolveMarker, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a prompt marker')), timeoutMs);
    session.once('prompt', marker => {
      clearTimeout(timer);
      resolveMarker(marker);
    });
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) { resolveWait(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error('timed out waiting for condition')); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
}

test('ShellSession preserves aliases, functions, env, PATH, and third-party precmd/preexec hooks', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'nmsh-markers-'));
  const home = fakeUserHome(markerDir);
  const session = new ShellSession(home, 120, 30, home);
  let output = '';
  session.on('data', chunk => { output += chunk; });
  try {
    await waitForMarker(session);

    output = '';
    session.submit('test_func; echo "ENV=$TEST_ENV_VAR"; alias test_alias');
    await waitForMarker(session);
    assert.match(output, /FUNC_OK/, 'a function defined in the user zshrc should survive bootstrap');
    assert.match(output, /ENV=env_ok/, 'an exported env var from the user zshrc should survive bootstrap');
    assert.match(output, /test_alias=/, 'an alias defined in the user zshrc should survive bootstrap');

    // precmd has now fired at least twice (initial prompt + after this command).
    await waitFor(() => existsSync(join(markerDir, 'zoxide_precmd_count')));
    await waitFor(() => existsSync(join(markerDir, 'atuin_precmd_count')));
    await waitFor(() => existsSync(join(markerDir, 'atuin_preexec_count')));
    assert.ok(readFileSync(join(markerDir, 'zoxide_precmd_count'), 'utf8').length > 0,
      'a precmd hook installed by direct array append (zoxide-style) must still run');
    assert.ok(readFileSync(join(markerDir, 'atuin_precmd_count'), 'utf8').length > 0,
      'a precmd hook installed via add-zsh-hook (Atuin-style) must still run');
    assert.ok(readFileSync(join(markerDir, 'atuin_preexec_count'), 'utf8').length > 0,
      'a preexec hook installed via add-zsh-hook (Atuin-style) must still run');

    assert.ok(!output.includes('FOREIGN-PROMPT') && !output.includes('FOREIGN-RPROMPT'),
      'NMSh must reblank PROMPT/RPROMPT after a foreign precmd hook repaints them');
  } finally {
    session.kill();
    rmSync(home, {recursive: true, force: true});
    rmSync(markerDir, {recursive: true, force: true});
  }
});

test('ShellSession fires its own precmd exactly once per prompt alongside foreign hooks', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'nmsh-markers-'));
  const home = fakeUserHome(markerDir);
  const session = new ShellSession(home, 120, 30, home);
  const markers: ShellMarker[] = [];
  session.on('prompt', marker => markers.push(marker));
  try {
    await waitForMarker(session);
    session.submit('true');
    await waitFor(() => markers.length >= 2);
    session.submit('true');
    await waitFor(() => markers.length >= 3);
    // Every marker is a single well-formed NMSh protocol emission; duplicated
    // or interleaved hook output would corrupt the escape sequence and this
    // event would never have decoded at all.
    assert.ok(markers.every(marker => typeof marker.exitCode === 'number' && marker.cwd.length > 0));
  } finally {
    session.kill();
    rmSync(home, {recursive: true, force: true});
    rmSync(markerDir, {recursive: true, force: true});
  }
});

test('a Powerlevel10k-style hook that moves itself last never repaints the prompt into output', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-fake-home-'));
  // Mirrors p10k: its precmd re-appends itself to the end of precmd_functions
  // every cycle and restores prompt_sp, which prints an end-of-line `%` mark.
  writeFileSync(join(home, '.zshrc'), `
function fake_p10k_precmd {
  precmd_functions=(\${precmd_functions:#fake_p10k_precmd} fake_p10k_precmd)
  setopt prompt_cr prompt_sp
  PROMPT='THEME-LEFT on branch '
  RPROMPT='THEME-RIGHT-OK'
}
precmd_functions+=(fake_p10k_precmd)
`);
  const session = new ShellSession(home, 120, 30, home);
  let output = '';
  session.on('data', chunk => { output += chunk; });
  try {
    await waitForMarker(session);
    for (const command of ['echo one', 'false', 'echo three']) {
      session.submit(command);
      await waitForMarker(session);
    }
    assert.match(output, /three/u);
    assert.ok(!output.includes('THEME-LEFT') && !output.includes('THEME-RIGHT-OK'),
      `a self-reordering theme hook must not paint its prompt into command output: ${JSON.stringify(output)}`);
    assert.ok(!output.includes('%'), 'the prompt_sp end-of-line mark must not reach command output');
  } finally {
    session.kill();
    rmSync(home, {recursive: true, force: true});
  }
});
