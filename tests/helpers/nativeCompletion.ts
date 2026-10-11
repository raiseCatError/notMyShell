import assert from 'node:assert/strict';
import {runExternal} from '../../src/providers/providers.js';

/** Prepare only a fixture-owned completion cache; never source host dotfiles. */
export async function prepareNativeCompletionHome(fixtureHome: string): Promise<void> {
  const ready = await runExternal('zsh', ['-f', '-c', 'autoload -Uz compinit; compinit -d "$HOME/.zcompdump_capture"'], {
    cwd: fixtureHome, env: {...process.env, HOME: fixtureHome}, timeoutMs: 10_000,
  });
  assert.ok(ready.ok, 'fixture completion setup succeeds before capture assertions');
}
