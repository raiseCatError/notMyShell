import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/**
 * End to end through a real NMSh frontend and real shells: a line that starts with an absolute path is typed into the
 * composer, submitted with Enter, and must reach the shell exactly as written (arguments, quoting, escapes), never
 * "Unknown NMSh command". A directory used as a command gets the shell's own behavior. Registered NMSh commands keep
 * opening their UI in the same frontend.
 */

const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = shell === 'zsh' || (shell === 'bash' ? bash : fish);
  test(`live ${shell}: absolute executable paths run in the shell with their arguments; NMSh commands still open`, {skip: available ? false : `${shell} not installed`, timeout: 120_000}, async () => {
    const started = Date.now();
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell, themeBridge: {enabled: true, targets: {pager: {mode: 'follow'}}}},
      shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    try {
      // A tool deep under a volume-like directory, and one under a directory whose name has a space.
      const tools = join(sandbox.root, 'Volumes', 'MotoLab', 'tools', 'platform-tools');
      mkdirSync(tools, {recursive: true});
      writeFileSync(join(tools, 'adb'), '#!/bin/sh\nprintf "ADB[%s]\\n" "$@"\n');
      chmodSync(join(tools, 'adb'), 0o755);
      const spaced = join(sandbox.root, 'My Tools');
      mkdirSync(spaced);
      writeFileSync(join(spaced, 'run'), '#!/bin/sh\nprintf "RUN[%s]\\n" "$@"\n');
      chmodSync(join(spaced, 'run'), 0o755);

      const frontend = sandbox.launch();
      await frontend.waitFor(/Vespyr|notMyShell|zsh|bash|fish/u);
      // The managed shell is ready once NMSh has written its environment for it.
      await until(() => existsSync(join(sandbox.config, 'nmsh', 'theme-bridge', `environment.${shell}`)) || frontend.output.length > 0 && Date.now() - started > 8000, 20_000, 'the managed shell');
      await frontend.run('echo READY', /READY/u);

      await frontend.run(`${join(tools, 'adb')} devices -l`, /ADB\[devices\][\s\S]*ADB\[-l\]/u);
      await frontend.run(`${join(tools, 'adb')} 'two words' "x y"`, /ADB\[two words\][\s\S]*ADB\[x y\]/u);
      await frontend.run(`${spaced.replace(/ /gu, '\\ ')}/run 'a b'`, /RUN\[a b\]/u);
      await frontend.run(`/usr/bin/env printf 'ENV-%s\\n' ok`, /ENV-ok/u);
      await frontend.run('/bin/echo SLASH-ECHO', /SLASH-ECHO/u);

      // A directory used as a command: the shell decides (zsh/bash report it; fish changes into it). NMSh says nothing.
      const before = frontend.mark;
      await frontend.run(join(sandbox.root, 'Volumes', 'MotoLab'), shell === 'fish' ? /MotoLab/u : /directory|denied/iu);
      assert.doesNotMatch(frontend.output.slice(before), /Unknown NMSh command/u);

      // A registered NMSh command still belongs to NMSh in the same frontend.
      const help = frontend.mark;
      frontend.pty.write('/help\r');
      await frontend.waitFor(/Command correction[\s\S]*Tips/u, help);
      assert.doesNotMatch(frontend.output, /Unknown NMSh command/u, 'no absolute path was ever claimed by NMSh');
    } finally { await sandbox.dispose(); }
  });
}
