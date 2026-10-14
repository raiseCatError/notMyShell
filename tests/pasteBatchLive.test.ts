import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * A pasted sequence through the real composer and PTY: reviewed first, nothing runs until Enter in the batch review,
 * then the session's queue runs the commands in the same shell, in order, and pauses at a failure. Harmless
 * commands only (echo, cd, false inside the sandbox).
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

const SEQUENCES = {
  zsh: 'cd sub\necho "in-$(basename $PWD)"\nfor f in a b; do\n  echo "loop-$f"\ndone\nfalse\necho "AFTER-FAILURE"',
  bash: 'cd sub\necho "in-$(basename $PWD)"\nfor f in a b; do\n  echo "loop-$f"\ndone\nfalse\necho "AFTER-FAILURE"',
  fish: 'cd sub\necho "in-"(basename $PWD)\nfor f in a b\n  echo "loop-$f"\nend\nfalse\necho "AFTER-FAILURE"',
} as const;

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = shell === 'zsh' || (shell === 'bash' ? Boolean(bash) : Boolean(fish));
  test(`live ${shell}: a pasted sequence is reviewed, queued on Enter, run in order in the same shell, and paused by a failure`,
    {skip: !supported ? 'unsupported platform' : !available ? `${shell} is not installed` : false, timeout: 120_000}, async () => {
      const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
      mkdirSync(join(sandbox.home, 'sub'));
      const frontend = sandbox.launch([], {cols: 100, rows: 34}, {});
      try {
        await frontend.waitFor(/notMyShell|zsh|bash|fish/u);
        await frontend.run('echo READY', /READY/u);
        let mark = frontend.mark;
        frontend.pty.write(`\u001b[200~${SEQUENCES[shell]}\u001b[201~`);
        await frontend.waitFor(/B queue as commands/u, mark);
        await pause(300);
        assert.doesNotMatch(strip(frontend.output.slice(mark)), /in-sub|loop-a/u, 'pasting runs nothing');
        frontend.pty.write('b');
        await frontend.waitFor(/Review commands[\s\S]*5 commands/u, mark);
        await pause(300);
        assert.doesNotMatch(strip(frontend.output.slice(mark)), /in-sub|loop-a/u, 'reviewing runs nothing');
        mark = frontend.mark;
        frontend.pty.write('\r');
        await frontend.waitFor(/in-sub[\s\S]*loop-a[\s\S]*loop-b/u, mark, 30_000);
        await frontend.waitFor(/Command failed · exit 1/u, mark, 30_000);
        await pause(1200);
        assert.doesNotMatch(strip(frontend.output.slice(mark)), /AFTER-FAILURE\n/u, 'the queue paused at the failing command');
        // The rest is still queued; the same shell kept its directory.
        await frontend.run('pwd', /\/sub\b/u);
      } finally { await sandbox.dispose(); }
    });
}
