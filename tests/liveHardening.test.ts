import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {socketPathFor} from '../src/session/runtimeDir.js';
import {SERVICE_STOPPED_NOTE} from '../src/session/recovery.js';
import type {TranscriptSession} from '../src/sessions/TranscriptStore.js';
import {LiveSandbox, processAlive, strip, until, type Frontend} from './helpers/liveFrontend.js';

/** Crash recovery, stale state, limits, leaks and terminal compatibility with real processes. */

async function started(sandbox: LiveSandbox, args: string[] = []): Promise<Frontend> {
  const frontend = sandbox.launch(args);
  await frontend.waitFor(/❯/);
  return frontend;
}

function killService(sandbox: LiveSandbox): void {
  const pids = execFileSync('lsof', ['-t', socketPathFor(sandbox.runtime)], {encoding: 'utf8'}).split('\n').map(Number)
    .filter(pid => pid > 0 && pid !== process.pid);
  // Only the service listens; frontends are connected peers. Kill whichever owns the listening socket.
  const listening = pids.filter(pid => spawnSync('lsof', ['-a', '-p', String(pid), '-U'], {encoding: 'utf8'}).stdout.includes('nmshd'));
  for (const pid of listening.length ? listening : pids) process.kill(pid, 'SIGKILL');
}

const lineText = (session: TranscriptSession) => session.transcript.lines
  .map(line => line.map(cell => (cell && 'text' in cell ? cell.text : ' ')).join('')).join('\n');

async function archives(sandbox: LiveSandbox): Promise<TranscriptSession[]> {
  const store = sandbox.transcripts();
  return Promise.all((await store.listSummaries()).map(entry => store.load(entry.id)));
}

test('service killed with a detached session: the next launch archives it factually and starts fresh', async () => {
  const sandbox = new LiveSandbox();
  try {
    const a = await started(sandbox);
    await a.run('echo BEFORE-CRASH', /BEFORE-CRASH/);
    const [{pid}] = await sandbox.sessions() as [{pid: number}];
    a.pty.write('sleep 600\r');
    await until(async () => (await sandbox.sessions())[0]?.running !== undefined, 15000, 'sleep running');
    await until(async () => (await archives(sandbox)).some(s => s.live?.running?.command === 'sleep 600'), 15000, 'journaled');
    a.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
    killService(sandbox);
    await until(() => !processAlive(pid), 15000, 'shell ends with its service');
    assert.ok(existsSync(socketPathFor(sandbox.runtime)), 'a SIGKILLed service leaves a stale socket behind');

    const b = sandbox.launch();
    await b.waitFor(/1 live session ended while no NMSh window was attached/);
    await b.waitFor(/❯/);
    await b.run('echo FRESH-AFTER-CRASH', /FRESH-AFTER-CRASH/);
    const [recovered] = (await archives(sandbox)).filter(s => lineText(s).includes('BEFORE-CRASH'));
    assert.ok(recovered?.endedAt);
    assert.equal(recovered?.live, undefined);
    assert.ok(lineText(recovered!).includes(SERVICE_STOPPED_NOTE.slice(0, 40)));
    assert.ok(recovered!.transcript.records.some(record => record.command === 'sleep 600'), 'the lost command is archived as ended');
  } finally {
    await sandbox.dispose();
  }
});

test('a shell that exits while detached is archived with its exit code; a vanished runtime dir (reboot) too', async () => {
  const sandbox = new LiveSandbox();
  try {
    const a = await started(sandbox);
    const gate = join(sandbox.home, 'gate');
    a.pty.write(`while [ ! -f ${gate} ]; do sleep 0.05; done; echo LAST-WORDS; exit 7\r`);
    await until(async () => (await archives(sandbox)).some(s => s.live?.running?.command.includes('LAST-WORDS')), 15000, 'journaled');
    a.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
    writeFileSync(gate, '');
    await until(async () => (await sandbox.sessions()).length === 0, 15000, 'shell exit');
    const b = sandbox.launch();
    await b.waitFor(/1 live session ended while no NMSh window was attached/);
    const exited = (await archives(sandbox)).find(s => lineText(s).includes('exit code 7'));
    assert.ok(exited, 'archived with the real exit');
    assert.match(exited!.transcript.records.find(r => r.command.includes('LAST-WORDS'))!.output, /LAST-WORDS/, 'detached output is kept');

    // Reboot: the runtime directory (service, sockets, spools) is gone; only journals remain.
    b.pty.write('exit\r');
    await b.waitExit();
    const c = await started(sandbox);
    await c.run('echo REBOOTED-SESSION', /REBOOTED-SESSION/);
    await until(async () => (await archives(sandbox)).some(s => s.live && lineText(s).includes('REBOOTED-SESSION')), 15000, 'journaled');
    const [{pid}] = await sandbox.sessions() as [{pid: number}];
    c.pty.kill('SIGKILL');
    killService(sandbox);
    await until(() => !processAlive(pid), 15000, 'shell gone');
    rmSync(sandbox.runtime, {recursive: true, force: true});
    const d = sandbox.launch();
    await d.waitFor(/1 live session ended while no NMSh window was attached/);
    const rebooted = (await archives(sandbox)).find(s => lineText(s).includes('REBOOTED-SESSION'))!;
    assert.equal(rebooted.live, undefined);
    assert.ok(rebooted.endedAt);
  } finally {
    await sandbox.dispose();
  }
});

test('service killed under an attached frontend: factual note, frontend exits, nothing claims survival', async () => {
  const sandbox = new LiveSandbox();
  try {
    const a = await started(sandbox);
    await a.run('echo ATTACHED-WHEN-LOST', /ATTACHED-WHEN-LOST/);
    killService(sandbox);
    await a.waitExit();
    assert.match(strip(a.output), /lost the connection to its session service/);
    const lost = (await archives(sandbox)).find(s => lineText(s).includes('ATTACHED-WHEN-LOST'))!;
    assert.ok(lost.endedAt);
    assert.equal(lost.live, undefined);
    assert.ok(lineText(lost).includes('Lost the connection to the NMSh session service'));
  } finally {
    await sandbox.dispose();
  }
});

test('a service of another protocol version is left alone and reported; nothing is recovered past it', async () => {
  const sandbox = new LiveSandbox();
  const old = createServer(socket => socket.destroy());
  try {
    const a = await started(sandbox);
    await a.run('echo OWNED-BY-SOMEONE', /OWNED-BY-SOMEONE/);
    // The journal is written asynchronously; kill only once it holds the command.
    await until(async () => (await archives(sandbox)).some(s => s.live && lineText(s).includes('OWNED-BY-SOMEONE')), 15000, 'journaled');
    a.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
    killService(sandbox);
    await new Promise<void>(resolve => old.listen(socketPathFor(sandbox.runtime, 1), resolve));
    const b = sandbox.launch();
    await b.waitFor(/another NMSh version is still running its own live sessions/);
    const after = await archives(sandbox);
    assert.ok(after.some(s => s.live && lineText(s).includes('OWNED-BY-SOMEONE')),
      `not archived while unverifiable: ${JSON.stringify(after.map(s => ({live: Boolean(s.live), ended: s.endedAt ?? null, has: lineText(s).includes('OWNED-BY-SOMEONE')})))}`);
    assert.ok(existsSync(socketPathFor(sandbox.runtime, 1)), 'the other service socket is untouched');
  } finally {
    await new Promise<void>(resolve => old.close(() => resolve()));
    await sandbox.dispose();
  }
});

test('the live-session limit falls back factually and never ends detached sessions', async () => {
  const sandbox = new LiveSandbox({}, {NMSH_MAX_SESSIONS: '2'});
  try {
    const pids: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      const frontend = await started(sandbox, ['--new']);
      frontend.pty.kill('SIGKILL');
    }
    await until(async () => (await sandbox.sessions()).filter(s => s.state === 'detached').length === 2, 15000, '2 detached');
    pids.push(...(await sandbox.sessions()).map(s => s.pid));
    const third = sandbox.launch(['--new']);
    await third.waitFor(/live sessions are already running \(the limit\)/);
    await third.waitFor(/cannot be detached or reattached/);
    await third.run('echo MODE=$NMSH_SESSION_MODE', /MODE=in-process/);
    assert.ok(pids.every(processAlive));
    assert.equal((await sandbox.sessions()).length, 2);
  } finally {
    await sandbox.dispose();
  }
});

test('repeated create/detach/attach/terminate cycles leak no shells, sockets, spools or services', async () => {
  const sandbox = new LiveSandbox();
  try {
    const shells: number[] = [];
    for (let cycle = 0; cycle < 6; cycle += 1) {
      let frontend = await started(sandbox);
      const [{id, pid}] = await sandbox.sessions() as [{id: string; pid: number}];
      shells.push(pid);
      for (let round = 0; round < 2; round += 1) {
        await frontend.run(`echo CYCLE-${cycle}-${round}`, new RegExp(`CYCLE-${cycle}-${round}`));
        frontend.pty.kill(round === 0 ? 'SIGKILL' : 'SIGHUP');
        await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
        frontend = sandbox.launch(['--attach', id]);
        await frontend.waitFor(/Reattached live session/);
      }
      frontend.pty.write('exit\r');
      await frontend.waitExit();
      await until(async () => (await sandbox.sessions()).length === 0, 15000, 'session end');
    }
    await until(() => !existsSync(socketPathFor(sandbox.runtime)), 15000, 'service exit');
    assert.deepEqual(shells.filter(processAlive), []);
    const spoolDir = join(sandbox.runtime, 'spool');
    assert.deepEqual(existsSync(spoolDir) ? readdirSync(spoolDir) : [], []);
    const archived = await archives(sandbox);
    assert.equal(archived.length, 6, 'one journal per session, continued across reattaches');
    assert.ok(archived.every(session => session.endedAt && !session.live));
  } finally {
    await sandbox.dispose();
  }
});

test('mouse reports reach a fullscreen app in passthrough, including after reattach', async () => {
  const sandbox = new LiveSandbox();
  try {
    const fixture = join(sandbox.home, 'mouse.mjs');
    writeFileSync(fixture, [
      `process.stdout.write('\\u001b[?1049h\\u001b[?1000h\\u001b[?1006hMOUSE-READY\\r\\n');`,
      `process.stdin.setRawMode(true);`,
      `process.stdin.on('data', data => {`,
      `  const text = data.toString();`,
      `  if (text === 'q') { process.stdout.write('\\u001b[?1000l\\u001b[?1006l\\u001b[?1049l'); process.exit(0); }`,
      `  process.stdout.write('GOT ' + JSON.stringify(text) + '\\r\\n');`,
      `});`,
    ].join('\n'));
    const a = await started(sandbox);
    let mark = a.mark;
    a.pty.write(`node ${fixture}\r`);
    await a.waitFor(/MOUSE-READY/, mark);
    mark = a.mark;
    a.pty.write('\u001b[<0;7;5M');
    await a.waitFor(/GOT "\\u001b\[<0;7;5M"/, mark);
    const [{id}] = await sandbox.sessions() as [{id: string}];
    a.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
    const b = sandbox.launch(['--attach', id]);
    await until(async () => (await sandbox.sessions())[0]?.state === 'attached', 15000, 'attached');
    // Resend until the reattached frontend is back in passthrough; the report is
    // idempotent for the fixture, so this waits on the condition, not a delay.
    mark = b.mark;
    await until(() => {
      if (/GOT "\\u001b\[<0;9;3M"/.test(strip(b.output.slice(mark)))) return true;
      b.pty.write('\u001b[<0;9;3M');
      return false;
    }, 15000, 'mouse report after reattach');
    // Injected reports only prove forwarding. The host terminal must also be
    // told to generate them again: after the frontend's own mouse-off, the
    // app's modes have to be re-enabled on this new terminal.
    const hostBound = b.output.slice(Math.max(0, b.output.lastIndexOf('\u001b[?1000l')));
    assert.ok(hostBound.includes('\u001b[?1000h') && hostBound.includes('\u001b[?1006h'),
      'the reattached terminal is put back into the app\'s mouse reporting modes');
    mark = b.mark;
    b.pty.write('q');
    // Type the next command only once NMSh has left passthrough and redrawn
    // its composer; keys typed earlier still belong to the fullscreen app.
    await until(() => b.output.indexOf('\u001b[?1049l', mark) !== -1, 15000, 'fullscreen exit');
    await b.waitFor(/❯/, b.output.indexOf('\u001b[?1049l', mark));
    await b.run('echo MOUSE-DONE', /MOUSE-DONE/);
  } finally {
    await sandbox.dispose();
  }
});

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
test('tmux inside NMSh runs in passthrough and repaints after reattach', {skip: hasTmux ? false : 'tmux is not installed'}, async () => {
  const sandbox = new LiveSandbox();
  const socket = `nmsh-test-${process.pid}`;
  try {
    const a = await started(sandbox);
    let mark = a.mark;
    a.pty.write(`tmux -L ${socket} -f /dev/null new-session 'echo TMUX-INSIDE; stty size; exec sleep 600'\r`);
    await a.waitFor(/TMUX-INSIDE/, mark);
    const [{id}] = await sandbox.sessions() as [{id: string}];
    a.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
    const b = sandbox.launch(['--attach', id], {cols: 110, rows: 36});
    await b.waitFor(/TMUX-INSIDE/);
    mark = b.mark;
    spawnSync('tmux', ['-L', socket, 'kill-server']);
    await b.waitFor(/❯/, mark);
    await b.run('echo AFTER-TMUX', /AFTER-TMUX/);
  } finally {
    spawnSync('tmux', ['-L', socket, 'kill-server']);
    await sandbox.dispose();
  }
});
