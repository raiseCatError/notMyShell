import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSandbox, processAlive, strip, until, type Frontend} from './helpers/liveFrontend.js';

/** Launch-time discovery and /resume LIVE with real frontends, nmshd and zsh. */

async function count(sandbox: LiveSandbox, n: number) {
  await until(async () => (await sandbox.sessions()).length === n, 15000, `${n} live sessions`);
  return sandbox.sessions();
}

async function detachedCount(sandbox: LiveSandbox, n: number) {
  await until(async () => (await sandbox.sessions()).filter(session => session.state === 'detached').length === n, 15000, `${n} detached`);
}

async function started(sandbox: LiveSandbox, args: string[] = []): Promise<Frontend> {
  const frontend = sandbox.launch(args);
  await frontend.waitFor(/❯/);
  return frontend;
}

async function shellPid(frontend: Frontend): Promise<number> {
  const mark = frontend.mark;
  frontend.pty.write('echo PID=$$\r');
  await frontend.waitFor(/PID=\d+/, mark);
  return Number(/PID=(\d+)/.exec(strip(frontend.output.slice(mark)))![1]);
}

test('launch: none -> new, one detached -> auto-reattach, --new forces new, attached elsewhere is not hijacked', async () => {
  const sandbox = new LiveSandbox();
  try {
    const a = await started(sandbox);
    const aPid = await shellPid(a);
    a.pty.kill('SIGKILL');
    await detachedCount(sandbox, 1);

    const b = sandbox.launch();
    await b.waitFor(/Reattached live session/);
    assert.equal(await shellPid(b), aPid, 'exactly one detached session is reattached automatically');
    assert.equal((await count(sandbox, 1))[0]!.state, 'attached');

    const c = await started(sandbox);
    assert.notEqual(await shellPid(c), aPid, 'a session attached elsewhere leads to a new session');
    assert.equal((await count(sandbox, 2)).every(session => session.state === 'attached'), true);
    assert.ok(processAlive(aPid));

    c.pty.kill('SIGKILL');
    await detachedCount(sandbox, 1);
    const d = await started(sandbox, ['--new']);
    await count(sandbox, 3);
    assert.doesNotMatch(strip(d.output), /Reattached/);
  } finally {
    await sandbox.dispose();
  }
});

test('launch with several detached sessions shows the picker; choose one or start new', async () => {
  const sandbox = new LiveSandbox();
  try {
    const pids: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const frontend = await started(sandbox, ['--new']);
      pids.push(await shellPid(frontend));
      frontend.pty.kill('SIGKILL');
    }
    await detachedCount(sandbox, 3);

    const picker = sandbox.launch();
    await picker.waitFor(/detached live sessions[\s\S]*\+ New session/);
    picker.pty.write('\r');
    await picker.waitFor(/Reattached live session/);
    assert.equal(await shellPid(picker), pids[2], 'the newest detached session is first');

    const fresh = sandbox.launch();
    await fresh.waitFor(/\+ New session/);
    fresh.pty.write('\u001b');
    await fresh.waitFor(/❯/);
    assert.ok(!pids.includes(await shellPid(fresh)));
    await count(sandbox, 4);
  } finally {
    await sandbox.dispose();
  }
});

test('/resume shows LIVE and ARCHIVED; Kill Session confirms and archives; LIVE selection switches', async () => {
  const sandbox = new LiveSandbox();
  try {
    // An archived transcript, a detached live session to kill, and one to switch to.
    const archivedFrontend = await started(sandbox, ['--new']);
    await archivedFrontend.run('echo ARCHIVED-ONLY', /ARCHIVED-ONLY/);
    archivedFrontend.pty.write('exit\r');
    await archivedFrontend.waitExit();

    const victim = await started(sandbox, ['--new']);
    await victim.run('cd /tmp && echo VICTIM', /VICTIM/);
    const victimPid = await shellPid(victim);
    victim.pty.write('sleep 600\r');
    await until(async () => (await sandbox.sessions()).some(session => session.running?.includes('sleep 600')), 15000, 'sleep running');
    victim.pty.kill('SIGKILL');

    const other = await started(sandbox, ['--new']);
    await other.run('cd / && echo OTHER', /OTHER/);
    const otherPid = await shellPid(other);
    other.pty.kill('SIGKILL');
    await detachedCount(sandbox, 2);

    const hub = await started(sandbox, ['--new']);
    let mark = hub.mark;
    hub.pty.write('/resume\r');
    await hub.waitFor(/LIVE[\s\S]*running sleep 600[\s\S]*ARCHIVED/, mark);

    // Select the /tmp session (sessions are listed in service order) and kill it.
    const live = (await sandbox.sessions()).filter(session => session.state === 'detached');
    const victimIndex = live.findIndex(session => session.pid === victimPid);
    for (let index = 0; index < victimIndex; index += 1) hub.pty.write('\u001b[B');
    mark = hub.mark;
    hub.pty.write('\u000b');
    await hub.waitFor(/Kill the live session in \/private\/tmp\?|Kill the live session in \/tmp\?/, mark);
    assert.ok(processAlive(victimPid), 'nothing is killed before confirmation');
    hub.pty.write('\r');
    await hub.waitFor(/transcript was archived/, mark);
    await until(() => !processAlive(victimPid), 15000, 'victim shell to end');
    assert.equal((await sandbox.sessions()).some(session => session.pid === victimPid), false, 'no false live status');

    const store = sandbox.transcripts();
    const archives = await Promise.all((await store.listSummaries()).map(entry => store.load(entry.id)));
    const killed = archives.find(session => session.transcript.records.some(record => record.command.includes('VICTIM')))!;
    assert.ok(killed.endedAt);
    assert.equal(killed.live, undefined);
    assert.ok(killed.transcript.records.some(record => record.command === 'sleep 600'), 'the running command is archived as ended');

    // Enter on the remaining LIVE row switches this window to it.
    mark = hub.mark;
    hub.pty.write('\r');
    await hub.waitFor(/Reattached live session/, mark);
    assert.equal(await shellPid(hub), otherPid);
    await count(sandbox, 2);
    assert.equal((await sandbox.sessions()).filter(session => session.state === 'detached').length, 1, 'the hub session was detached, not ended');
  } finally {
    await sandbox.dispose();
  }
});
