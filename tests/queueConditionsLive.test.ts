import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/**
 * Queue conditions through the real composer, PTY and session service, with harmless commands only (touch inside the
 * sandbox). "Asks first" holds an entry until that entry is approved in /queue; "runs even after a failure" lets one
 * entry go on after a plain failure, where the default pauses the queue.
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
type Shell = 'zsh' | 'bash' | 'fish';

async function start(shell: Shell) {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {});
  try {
    await frontend.waitFor(/notMyShell|zsh|bash|fish/u);
    await frontend.run('echo READY', /READY/u);
  } catch (error) { await sandbox.dispose().catch(() => {}); throw error; }
  return {sandbox, frontend};
}

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = shell === 'zsh' || (shell === 'bash' ? Boolean(bash) : Boolean(fish));
  test(`live ${shell}: an entry that asks first waits for its approval; approving runs exactly that entry`,
    {skip: !supported ? 'unsupported platform' : !available ? `${shell} is not installed` : false, timeout: 120_000}, async () => {
      const {sandbox, frontend} = await start(shell);
      try {
        const marker = join(sandbox.home, 'approved');
        let mark = frontend.mark;
        frontend.pty.write('sleep 2\r');
        await frontend.waitFor(/Running sleep 2|Cooking|[A-Z][a-z]+…/u, mark);
        frontend.pty.write(`touch ${marker}\r`);
        await frontend.waitFor(/≡ Queued \(1\) · next: touch/u, mark);
        frontend.pty.write('/queue\r');
        await frontend.waitFor(/Command queue[\s\S]*touch/u, mark);
        frontend.pty.write('w');
        await frontend.waitFor(/runs even after a failure/u, mark);
        frontend.pty.write('w');
        await frontend.waitFor(/asks first/u, mark);
        frontend.pty.write('\u001b');
        await frontend.waitFor(/next needs your approval: touch/u, mark, 20_000);
        await pause(1500);
        assert.equal(existsSync(marker), false, 'nothing runs while it waits for approval');
        mark = frontend.mark;
        frontend.pty.write('/queue\r');
        await frontend.waitFor(/asks first/u, mark);
        frontend.pty.write('a');
        await until(() => existsSync(marker), 15_000, 'the approved entry runs');
        await frontend.waitFor(/from queue/u, mark);
      } finally { await sandbox.dispose(); }
    });
}

test('live: "runs even after a failure" goes on after a plain failure; the default pauses', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const cleanup = join(sandbox.home, 'cleanup');
    const mark = frontend.mark;
    frontend.pty.write(`sh -c 'sleep 1; exit 3'\r`);
    await frontend.waitFor(/Running sh -c|[A-Z][a-z]+…/u, mark);
    frontend.pty.write(`touch ${cleanup}\r`);
    await frontend.waitFor(/≡ Queued \(1\)/u, mark);
    frontend.pty.write('/queue\r');
    await frontend.waitFor(/Command queue/u, mark);
    frontend.pty.write('w');
    await frontend.waitFor(/runs even after a failure/u, mark);
    frontend.pty.write('\u001b');
    await until(() => existsSync(cleanup), 20_000, 'the cleanup entry ran after the failure');
    await frontend.waitFor(/Command failed · exit 3/u, mark);
  } finally { await sandbox.dispose(); }
});
