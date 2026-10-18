import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/**
 * End to end through a real NMSh frontend and real shells: Prompt None
 * runs commands with composer-only presentation and promptless history, and
 * Theme Bridge environment values reach the managed shell through the
 * adapter-owned prompt hook, without any rc file being created or edited.
 */

const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = shell === 'zsh' || (shell === 'bash' ? bash : fish);
  test(`live ${shell}: Prompt None executes normally; Theme Bridge pager values reach the shell; no rc file is touched`, {skip: available ? false : `${shell} not installed`, timeout: 90_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell, themeBridge: {enabled: true, targets: {pager: {mode: 'follow'}}}},
      shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    try {
      const frontend = sandbox.launch();
      await frontend.waitFor(/Vespyr|notMyShell|zsh|bash|fish/u);
      const envFile = join(sandbox.config, 'nmsh', 'theme-bridge', `environment.${shell}`);
      await until(() => existsSync(envFile), 20_000, 'the Theme Bridge environment file');
      await frontend.run('true', /true/u);
      const command = shell === 'fish' ? `printf 'gs=%s\\n' "$GROFF_NO_SGR"` : `printf 'gs=%s\\n' "\${GROFF_NO_SGR-unset}"`;
      await frontend.run(command, /gs=1/u);
      const records = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).filter(record => record.command === command);
      assert.ok(records.length > 0);
      assert.equal(records[0]!.historicalContext?.prompt, undefined, 'Prompt None stores no prompt snapshot');
      assert.equal(records[0]!.historicalContext?.promptless, true);
      const home = readdirSync(sandbox.home).filter(name => /^\.(?:zshrc|zshenv|zprofile|bashrc|bash_profile|profile|vimrc|tmux\.conf)$/u.test(name));
      assert.deepEqual(home, [], 'no shell rc or tool config was created');
      assert.equal(existsSync(join(sandbox.home, '.config', 'fish', 'config.fish')), false);
    } finally { await sandbox.dispose(); }
  });
}

test('live bash: with ls aliased in ~/.bashrc (as Ubuntu ships it) and File listing colors on, the managed shell parses its bootstrap and becomes ready',
  {skip: bash ? false : 'bash not installed', timeout: 90_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'bash', themeBridge: {enabled: true, targets: {lsColors: {mode: 'follow'}}}},
      {PATH: `${bash!.replace(/\/bash$/u, '')}:${process.env.PATH}`});
    try {
      writeFileSync(join(sandbox.home, '.bashrc'), "alias ls='ls -F'\nalias gls='gls -F'\n");
      const frontend = sandbox.launch();
      const envFile = join(sandbox.config, 'nmsh', 'theme-bridge', 'environment.bash');
      await until(() => existsSync(envFile), 20_000, 'the Theme Bridge environment file');
      await frontend.run('echo BASH-READY', /BASH-READY/u);
      await frontend.run('echo "lc=${LS_COLORS:+set}"', /lc=set/u);
      assert.doesNotMatch(frontend.output, /syntax error/u);
    } finally { await sandbox.dispose(); }
  });
