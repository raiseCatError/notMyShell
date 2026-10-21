import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * #443, live: count the SIGWINCH a running program receives through the real composer, PTY and session service.
 * NMSh's own chrome changing (a multi-line draft growing the composer, a held line's note and queue row) must send
 * none; a real resize of the window sends one. Fish 3 loses a terminal write each such signal interrupts.
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = supported && (shell === 'zsh' || (shell === 'bash' ? bash : fish));
  test(`live ${shell}: NMSh's own layout never signals a running program; a window resize does, once`, {skip: available ? false : `${shell} not installed`, timeout: 120_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    const frontend = sandbox.launch([], {cols: 100, rows: 32});
    frontend.pty.onData(data => {
      if (data.includes('\u001b[c') || data.includes('\u001b[0c')) frontend.pty.write('\u001b[?62;22c');
      if (data.includes('\u001b[6n')) frontend.pty.write('\u001b[1;1R');
    });
    const log = join(sandbox.home, 'winch.log');
    try {
      await frontend.waitFor(/zsh|bash|fish/u);
      await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first prompt');
      await frontend.run('echo READY', /READY/u);
      const mark = frontend.mark;
      // The program counts the signals it gets, and says when its handler is in place.
      frontend.pty.write(`sh -c 'trap "echo W >> ${log}" WINCH; echo COUNTING; i=0; while [ $i -lt 60 ]; do sleep 0.1; i=$((i+1)); done; echo DONE-COUNTING'\r`);
      await frontend.waitFor(/COUNTING/u, mark);
      await pause(300);
      const count = () => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
      // A multi-line paste grows the composer by several rows.
      frontend.pty.write('\u001b[200~line one\nline two\nline three\u001b[201~');
      await frontend.waitFor(/Enter insert/u, mark);
      frontend.pty.write('\r');
      await frontend.waitFor(/❯ line one/u, mark);
      await pause(500);
      // Enter holds it for approval: a note in the transcript and a queue row.
      frontend.pty.write('\r');
      await frontend.waitFor(/never runs by itself|waits for your approval/u, mark);
      await pause(500);
      assert.equal(count(), 0, 'no signal from NMSh\'s own chrome');
      frontend.pty.resize(100, 40);
      await until(() => count() >= 1, 10_000, 'the window resize to reach the program');
      await pause(500);
      assert.equal(count(), 1, 'exactly one signal for one window resize');
      await frontend.waitFor(/DONE-COUNTING/u, mark, 30_000);
      assert.doesNotMatch(strip(frontend.output.slice(mark)), /Interrupted system call/u);
    } finally { await sandbox.dispose(); }
  });
}
