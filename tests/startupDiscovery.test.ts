import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
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

function savedConfig(sandbox: LiveSandbox): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sandbox.config, 'nmsh', 'config.json'), 'utf8')) as Record<string, unknown>;
}

async function detachedSessions(sandbox: LiveSandbox, count: number): Promise<number[]> {
  const pids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const frontend = await started(sandbox, ['--new']);
    pids.push(await shellPid(frontend));
    frontend.pty.kill('SIGKILL');
  }
  await detachedCount(sandbox, count);
  return pids;
}

const PROMPT = /1 detached live session[\s\S]*R {2}Resume[\s\S]*N {2}Not now/;

test('one detached session asks by default: Not now and Esc start fresh and leave it; Resume attaches; nothing is hijacked', async () => {
  const sandbox = new LiveSandbox();
  try {
    const [aPid] = await detachedSessions(sandbox, 1);

    const notNow = sandbox.launch();
    await notNow.waitFor(PROMPT);
    assert.match(strip(notNow.output), /idle at the prompt/);
    notNow.pty.write('n');
    await notNow.waitFor(/❯/);
    assert.notEqual(await shellPid(notNow), aPid, 'Not now starts a new session');
    assert.ok(processAlive(aPid!));
    await detachedCount(sandbox, 1);

    const escape = sandbox.launch();
    await escape.waitFor(PROMPT);
    escape.pty.write('\u001b');
    await escape.waitFor(/❯/);
    assert.notEqual(await shellPid(escape), aPid, 'Esc is Not now');
    await detachedCount(sandbox, 1);

    const resume = sandbox.launch();
    await resume.waitFor(PROMPT);
    resume.pty.write('\r');
    await resume.waitFor(/Reattached live session/);
    assert.equal(await shellPid(resume), aPid);

    // Every session is attached now: a plain launch neither prompts nor takes one over.
    const fresh = await started(sandbox);
    assert.doesNotMatch(strip(fresh.output), /detached live session/);
    assert.ok(![aPid].includes(await shellPid(fresh)));
    assert.equal((await count(sandbox, 4)).every(session => session.state === 'attached'), true);
    assert.equal(savedConfig(sandbox).liveSessionStartup ?? 'ask', 'ask', 'one-off choices are not persisted');
  } finally {
    await sandbox.dispose();
  }
});

test('Always and Never from the prompt persist; Never ends nothing and /resume still lists the session', async () => {
  const sandbox = new LiveSandbox();
  try {
    const [aPid] = await detachedSessions(sandbox, 1);
    const never = sandbox.launch();
    await never.waitFor(PROMPT);
    never.pty.write('d');
    await never.waitFor(/❯/);
    assert.notEqual(await shellPid(never), aPid);
    assert.equal(savedConfig(sandbox).liveSessionStartup, 'never');
    assert.ok(processAlive(aPid!), 'Never does not kill the session');

    never.pty.kill('SIGKILL');
    await detachedCount(sandbox, 2);
    const later = sandbox.launch();
    await later.waitFor(/❯/);
    assert.doesNotMatch(strip(later.output), /detached live session/, 'Never: no prompt, no picker');
    assert.ok(![aPid].includes(await shellPid(later)));
    await detachedCount(sandbox, 2);
    const mark = later.mark;
    later.pty.write('/resume\r');
    await later.waitFor(/LIVE[\s\S]*detached/, mark);
    later.pty.write('\u001b');

    // Always: resume without asking from now on.
    writeFileSync(join(sandbox.config, 'nmsh', 'config.json'), JSON.stringify({...savedConfig(sandbox), liveSessionStartup: 'ask'}));
    later.pty.kill('SIGKILL');
    await detachedCount(sandbox, 3);
    const pick = sandbox.launch();
    await pick.waitFor(/3 detached live sessions/);
    pick.pty.write('\u001b');
    await pick.waitFor(/❯/);
    await detachedCount(sandbox, 3);
  } finally {
    await sandbox.dispose();
  }
});

test('Always resumes one detached session without asking', async () => {
  const sandbox = new LiveSandbox();
  try {
    const [aPid] = await detachedSessions(sandbox, 1);
    const always = sandbox.launch();
    await always.waitFor(PROMPT);
    always.pty.write('a');
    await always.waitFor(/Reattached live session/);
    assert.equal(await shellPid(always), aPid);
    assert.equal(savedConfig(sandbox).liveSessionStartup, 'always');

    always.pty.kill('SIGKILL');
    await detachedCount(sandbox, 1);
    const next = sandbox.launch();
    await next.waitFor(/Reattached live session/);
    assert.doesNotMatch(strip(next.output), /1 detached live session/);
    assert.equal(await shellPid(next), aPid);
  } finally {
    await sandbox.dispose();
  }
});

test('several detached sessions: pick some, Esc for none; this window owns one, the rest stay detached and are named', async () => {
  const sandbox = new LiveSandbox();
  try {
    const pids = await detachedSessions(sandbox, 3);
    const none = sandbox.launch();
    await none.waitFor(/3 detached live sessions[\s\S]*Space select/);
    none.pty.write(' ');
    none.pty.write('\u001b');
    await none.waitFor(/❯/);
    assert.ok(!pids.includes(await shellPid(none)), 'Esc resumes none');
    await detachedCount(sandbox, 3);

    const picker = sandbox.launch();
    await picker.waitFor(/3 detached live sessions/);
    // Newest first: select the newest and the oldest.
    picker.pty.write(' ');
    picker.pty.write('\u001b[B');
    picker.pty.write('\u001b[B');
    picker.pty.write(' ');
    picker.pty.write('\r');
    await picker.waitFor(/Reattached live session/);
    assert.equal(await shellPid(picker), pids[2], 'this window takes the first selected');
    await picker.waitFor(/1 more selected live session need their own windows[\s\S]*they keep running/);
    await detachedCount(sandbox, 2);
    assert.ok(pids.every(pid => processAlive(pid)), 'nothing selected or unselected was ended');
  } finally {
    await sandbox.dispose();
  }
});

test('Open all restores every detached session: one here, the others as far as the host allows', async () => {
  const sandbox = new LiveSandbox({liveSessionMultiple: 'open-all'});
  try {
    const pids = await detachedSessions(sandbox, 2);
    const all = sandbox.launch();
    await all.waitFor(/Reattached live session/);
    assert.doesNotMatch(strip(all.output), /detached live sessions/, 'no picker');
    assert.equal(await shellPid(all), pids[1]);
    // The test host cannot open windows: the other session is named with its attach command.
    await all.waitFor(/nmsh --attach [\w-]+/);
    await detachedCount(sandbox, 1);
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
