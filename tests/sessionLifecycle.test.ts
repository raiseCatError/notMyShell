import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {attachSession} from '../src/session/connectSession.js';
import {socketPathFor} from '../src/session/runtimeDir.js';
import {formatSessionList} from '../src/session/sessionList.js';
import {LiveSandbox, processAlive, until} from './helpers/liveFrontend.js';

/**
 * Real processes end to end: nmsh frontends in PTYs, the on-demand nmshd
 * service, and managed zsh. Waits are on observable conditions, not sleeps.
 */

async function onlySession(sandbox: LiveSandbox) {
  await until(async () => (await sandbox.sessions()).length === 1, 15000, 'one live session');
  return (await sandbox.sessions())[0]!;
}

async function waitState(sandbox: LiveSandbox, state: 'attached' | 'detached') {
  await until(async () => (await sandbox.sessions())[0]?.state === state, 15000, `session ${state}`);
  return (await sandbox.sessions())[0]!;
}

test('SIGKILLed frontend detaches; the same shell keeps running and a new frontend reattaches', async () => {
  const sandbox = new LiveSandbox();
  try {
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    await first.run('echo MODE=$NMSH_SESSION_MODE', /MODE=service/);
    const created = await onlySession(sandbox);
    assert.equal(created.state, 'attached');
    assert.match(formatSessionList([created], Date.now()), new RegExp(`${created.id}  attached  pid ${created.pid}`));

    // A running command gated on a file, so nothing depends on timing.
    const gate = join(sandbox.home, 'go');
    first.pty.write(`while [ ! -f ${gate} ]; do sleep 0.05; done; echo RELEASED-$$\r`);
    // Wait for this command specifically: the previous echo can still be `running` until its prompt arrives.
    await until(async () => /RELEASED/.test((await sandbox.sessions())[0]?.running ?? ''), 15000, 'running command');
    first.pty.kill('SIGKILL');

    const detached = await waitState(sandbox, 'detached');
    assert.equal(detached.id, created.id);
    assert.equal(detached.pid, created.pid);
    assert.ok(processAlive(created.pid));
    assert.match(detached.running ?? '', /RELEASED/);
    assert.ok(existsSync(socketPathFor(sandbox.runtime)), 'service stays up for a detached session');

    const second = sandbox.launch(['--attach', created.id], {cols: 120, rows: 40});
    await second.waitFor(/Reattached live session/);
    assert.equal((await waitState(sandbox, 'attached')).pid, created.pid);
    writeFileSync(gate, '');
    await second.waitFor(new RegExp(`RELEASED-${created.pid}`));
    await second.run('stty size', / 120\b/);
    await second.run('echo PID=$$', new RegExp(`PID=${created.pid}`));

    // Ending the shell ends the session and, as the last one, the service.
    second.pty.write('exit\r');
    await second.waitExit();
    await until(() => !existsSync(socketPathFor(sandbox.runtime)), 15000, 'service exit');
    assert.equal(processAlive(created.pid), false);
  } finally {
    await sandbox.dispose();
  }
});

test('SIGHUP detaches; Ctrl+D and /zsh end the session', async () => {
  const sandbox = new LiveSandbox();
  try {
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    const {id, pid} = await onlySession(sandbox);
    first.pty.kill('SIGHUP');
    await first.waitExit();
    await waitState(sandbox, 'detached');
    assert.ok(processAlive(pid));

    const second = sandbox.launch(['--attach', id]);
    await second.waitFor(/Reattached live session/);
    await waitState(sandbox, 'attached');
    await second.run('echo BACK', /BACK/);
    second.pty.write('\u0004');
    await second.waitExit();
    await until(async () => (await sandbox.sessions()).length === 0, 15000, 'Ctrl+D to end the session');
    await until(() => !processAlive(pid), 15000, 'zsh to exit');

    const third = sandbox.launch();
    await third.waitFor(/❯/);
    const {pid: thirdPid} = await onlySession(sandbox);
    third.pty.write('/zsh\r');
    await until(async () => (await sandbox.sessions()).length === 0, 15000, '/zsh to end the managed session');
    await until(() => !processAlive(thirdPid), 15000, 'managed zsh to exit');
  } finally {
    await sandbox.dispose();
  }
});

test('an attached session refuses a second frontend without disturbing the first', async () => {
  const sandbox = new LiveSandbox();
  try {
    const owner = sandbox.launch();
    await owner.waitFor(/❯/);
    const {id} = await onlySession(sandbox);
    const intruder = sandbox.launch(['--attach', id]);
    assert.equal(await intruder.waitExit(), 1);
    assert.match(intruder.output, /attached to another NMSh window/);
    await owner.run('echo STILL-MINE', /STILL-MINE/);
    assert.equal((await sandbox.sessions())[0]?.state, 'attached');

    const unknown = sandbox.launch(['--attach', 'no-such-session']);
    assert.equal(await unknown.waitExit(), 1);
    assert.match(unknown.output, /no live session no-such-session/);
  } finally {
    await sandbox.dispose();
  }
});

test('concurrent attaches to one detached session: exactly one wins', async () => {
  const sandbox = new LiveSandbox();
  try {
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    const {id, pid} = await onlySession(sandbox);
    first.pty.kill('SIGKILL');
    await waitState(sandbox, 'detached');

    for (let round = 0; round < 5; round += 1) {
      const options = {cwd: sandbox.home, columns: 80, rows: 24, runtimeDir: sandbox.runtime, timeoutMs: 20000};
      const results = await Promise.allSettled(Array.from({length: 4}, () => attachSession(id, options)));
      const winners = results.filter(result => result.status === 'fulfilled');
      assert.equal(winners.length, 1, `round ${round}`);
      for (const result of results) {
        if (result.status === 'rejected') assert.match(String(result.reason), /attached to another/, String(result.reason));
      }
      const winner = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof attachSession>>>).value;
      assert.equal(winner.attached?.pid, pid);
      winner.client.detach();
      await waitState(sandbox, 'detached');
    }
    assert.ok(processAlive(pid));
  } finally {
    await sandbox.dispose();
  }
});

test('reattach into a fullscreen app resumes passthrough and makes it repaint at the new size', async () => {
  const sandbox = new LiveSandbox();
  try {
    const fixture = join(sandbox.home, 'fullscreen.zsh');
    const stop = join(sandbox.home, 'stop');
    writeFileSync(fixture, [
      `printf '\\e[?1049h'`,
      `trap 'printf "\\e[H\\e[2JREDRAW %s\\n" "$(stty size)"' WINCH`,
      `while [ ! -f ${stop} ]; do sleep 0.05; done`,
      `printf '\\e[?1049l'`,
    ].join('\n'));
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    first.pty.write(`zsh ${fixture}\r`);
    await until(async () => (await sandbox.sessions())[0]?.running !== undefined, 15000, 'fixture running');
    const {id} = (await sandbox.sessions())[0]!;
    first.pty.kill('SIGKILL');
    await waitState(sandbox, 'detached');

    const second = sandbox.launch(['--attach', id], {cols: 90, rows: 33});
    await second.waitFor(/REDRAW 33 90/);
    writeFileSync(stop, '');
    await second.waitFor(/❯/, second.output.lastIndexOf('REDRAW'));
    await second.run('echo AFTER-FULLSCREEN', /AFTER-FULLSCREEN/);
  } finally {
    await sandbox.dispose();
  }
});

test('vim and less survive detach and repaint after reattach', async () => {
  const sandbox = new LiveSandbox();
  try {
    writeFileSync(join(sandbox.home, 'notes.txt'), 'VIM-FIXTURE-LINE\n');
    writeFileSync(join(sandbox.home, 'pager.txt'), Array.from({length: 200}, (_, i) => `LESS-LINE-${i}`).join('\n'));
    for (const [command, visible, quit] of [
      ['vim -u NONE -N notes.txt', /VIM-FIXTURE-LINE/, '\u001b:q!\r'],
      ['less pager.txt', /LESS-LINE-0/, 'q'],
    ] as const) {
      const first = sandbox.launch();
      await first.waitFor(/❯/);
      await first.run(`cd ${sandbox.home}`, /❯/);
      const mark = first.mark;
      first.pty.write(`${command}\r`);
      await first.waitFor(visible, mark);
      const {id} = (await sandbox.sessions())[0]!;
      first.pty.kill('SIGKILL');
      await waitState(sandbox, 'detached');
      const second = sandbox.launch(['--attach', id], {cols: 110, rows: 35});
      await second.waitFor(visible);
      second.pty.write(quit);
      await until(async () => (await sandbox.sessions())[0]?.running === undefined, 15000, `${command} to quit`);
      await second.run('echo QUIT-OK', /QUIT-OK/);
      second.pty.write('exit\r');
      await second.waitExit();
      await until(async () => (await sandbox.sessions()).length === 0, 15000, 'session end');
    }
  } finally {
    await sandbox.dispose();
  }
});

test('raw protocol: a client cannot attach while controlling another session', async () => {
  const sandbox = new LiveSandbox();
  try {
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    const {id} = await onlySession(sandbox);
    first.pty.kill('SIGKILL');
    await waitState(sandbox, 'detached');
    const client = await SocketSessionClient.connect({socketPath: socketPathFor(sandbox.runtime), cwd: sandbox.home,
      columns: 80, rows: 24, env: {}, attach: id});
    client.start();
    assert.equal(client.attachedSession?.sessionId, id);
    client.kill();
    await until(async () => (await sandbox.sessions()).length === 0, 15000, 'terminate to end the session');
  } finally {
    await sandbox.dispose();
  }
});
