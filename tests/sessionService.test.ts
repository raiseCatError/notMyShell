import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {connect, createServer, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {SessionService} from '../src/session/SessionService.js';
import {SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {connectSession, listLiveSessions} from '../src/session/connectSession.js';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, type ServerMessage} from '../src/session/SessionProtocol.js';
import {socketPathFor} from '../src/session/runtimeDir.js';
import type {SessionClient} from '../src/session/SessionClient.js';
import type {ShellMarker} from '../src/shell/ShellProtocol.js';
import {inForeground, uniqueSleep} from './helpers/processState.js';

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(dir, 0o700);
  return dir;
}

function nextPrompt(client: SessionClient): Promise<ShellMarker> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no prompt')), 15000);
    client.once('prompt', marker => { clearTimeout(timer); resolve(marker); });
  });
}

async function until(check: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

class RawPeer {
  readonly messages: ServerMessage[] = [];
  readonly socket: Socket;
  closed = false;
  private readonly decoder = new FrameDecoder();
  constructor(path: string) {
    this.socket = connect(path);
    this.socket.setEncoding('utf8');
    this.socket.on('data', chunk => {
      for (const r of this.decoder.push(chunk as unknown as string)) if (r.ok) this.messages.push(r.message as ServerMessage);
    });
    this.socket.on('close', () => { this.closed = true; });
    this.socket.on('error', () => {});
  }
  async waitFor(type: string): Promise<ServerMessage> {
    await until(() => this.messages.some(m => m.type === type));
    return this.messages.find(m => m.type === type)!;
  }
}

test('service starts on demand, gives the shell the frontend env and cwd, and exits with its last session', async () => {
  const runtimeDir = join(scratch('nmsh-rt-'), 'rt');
  const home = scratch('nmsh-home-');
  const workdir = scratch('nmsh-cwd-');
  const env = {...process.env, HOME: home, NMSH_TEST_SECRET: 'frontend-only-value'};
  const connection = await connectSession({cwd: workdir, columns: 80, rows: 24, env, runtimeDir, timeoutMs: 15000});
  try {
    assert.equal(connection.mode, 'service', connection.notice);
    const client = connection.client;
    assert.ok(client instanceof SocketSessionClient);
    assert.equal(statSync(runtimeDir).mode & 0o777, 0o700);
    const socketStat = statSync(socketPathFor(runtimeDir));
    assert.ok(socketStat.isSocket());
    assert.equal(socketStat.mode & 0o077, 0);

    let output = '';
    client.on('data', data => { output += data; });
    const first = nextPrompt(client);
    client.start();
    assert.equal((await first).cwd, workdir);

    let prompt = nextPrompt(client);
    client.submit('echo "$NMSH_TEST_SECRET/$NMSH_SESSION_MODE/$PWD"');
    assert.equal((await prompt).exitCode, 0);
    assert.match(output, new RegExp(`frontend-only-value/service/${workdir}`));

    prompt = nextPrompt(client);
    client.submit('(exit 9)');
    assert.equal((await prompt).exitCode, 9);

    prompt = nextPrompt(client);
    client.submit('cd /');
    assert.equal((await prompt).cwd, '/');

    client.resize(111, 33);
    prompt = nextPrompt(client);
    client.submit('stty size');
    await prompt;
    assert.match(output, /33 111/);

    prompt = nextPrompt(client);
    client.submit(`printf '\\033[?1049h\\033[2J\\033[?1049l'`);
    await prompt;
    assert.ok(output.includes('\u001b[?1049h\u001b[2J\u001b[?1049l'), 'full-screen bytes pass through raw');

    prompt = nextPrompt(client);
    const interrupted = uniqueSleep(1);
    client.submit(`sleep ${interrupted}`);
    await until(() => inForeground(interrupted), 15000);
    client.interrupt();
    assert.notEqual((await prompt).exitCode, 0);

    prompt = nextPrompt(client);
    const suspended = uniqueSleep(2);
    client.submit(`sleep ${suspended}`);
    await until(() => inForeground(suspended), 15000);
    client.write('\u001a');
    assert.ok((await prompt).exitCode > 128);
    prompt = nextPrompt(client);
    client.submit('jobs; kill %1');
    await prompt;
    assert.match(output, /sleep 30/);

    const exited = new Promise<{exitCode: number}>(resolve => client.once('exit', resolve));
    client.submit('exit 4');
    assert.equal((await exited).exitCode, 4);
    await until(() => !existsSync(socketPathFor(runtimeDir)));
  } finally {
    connection.client.kill();
    rmSync(dirname(runtimeDir), {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
    rmSync(workdir, {recursive: true, force: true});
  }
});

test('handshake, version mismatch, framing, containment, registry, and disconnect policy', async () => {
  const runtimeDir = scratch('nmsh-svc-');
  const home = scratch('nmsh-home-');
  const service = new SessionService({runtimeDir, startupIdleMs: 60_000});
  await service.start();
  try {
    // Connected first so the rejected peers below are never the last client.
    const peer = new RawPeer(service.socketPath);
    const stranger = new RawPeer(service.socketPath);
    stranger.socket.write(`${JSON.stringify({v: PROTOCOL_VERSION + 1, type: 'hello', version: PROTOCOL_VERSION + 1, client: 'future'})}\n`);
    const refusal = await stranger.waitFor('error');
    assert.equal(refusal.type === 'error' && refusal.code, 'protocol');
    await until(() => stranger.closed);

    const old = new RawPeer(service.socketPath);
    old.socket.write(`${JSON.stringify({v: PROTOCOL_VERSION, type: 'hello', version: 0, client: 'old'})}\n`);
    const mismatch = await old.waitFor('error');
    assert.equal(mismatch.type === 'error' && mismatch.code, 'version');
    assert.match(mismatch.type === 'error' ? mismatch.message : '', /protocol 2/);

    const frames = encodeMessage({type: 'hello', version: PROTOCOL_VERSION, client: 'test'})
      + encodeMessage({type: 'create', cwd: home, env: {HOME: home, PATH: process.env.PATH ?? '', SECRET_X: 'hidden'}, columns: 80, rows: 24});
    // Fragmented byte-by-byte, then several frames in a single write.
    for (const character of frames.slice(0, 10)) peer.socket.write(character);
    peer.socket.write(frames.slice(10));
    const created = await peer.waitFor('created');
    assert.equal(created.type, 'created');
    await peer.waitFor('prompt');

    const [record] = service.registry;
    assert.ok(record);
    assert.deepEqual(Object.keys(record).sort(), ['createdAt', 'cwd', 'id', 'pid', 'protocolVersion', 'state']);
    assert.equal(record.cwd, home);
    assert.equal(record.state, 'attached');
    assert.ok(record.pid > 0);
    assert.doesNotMatch(JSON.stringify(service.registry), /hidden/);

    peer.socket.write('{not json\n' + encodeMessage({type: 'input', data: 'echo contained-$((1+1))\r'}));
    await until(() => peer.messages.some(m => m.type === 'output' && m.data.includes('contained-2')));
    assert.ok(peer.messages.some(m => m.type === 'error' && m.code === 'malformed'));

    // Losing the connection detaches; it never ends the shell.
    peer.socket.destroy();
    await until(() => service.registry[0]?.state === 'detached');
    const shellPid = service.registry[0]!.pid;
    process.kill(shellPid, 0);

    const lister = new RawPeer(service.socketPath);
    lister.socket.write(encodeMessage({type: 'hello', version: PROTOCOL_VERSION, client: 'test'}) + encodeMessage({type: 'list'}));
    const listed = await lister.waitFor('sessions');
    assert.deepEqual(listed.type === 'sessions' && listed.sessions.map(s => [s.id, s.state, s.pid]), [[record.id, 'detached', shellPid]]);
    assert.doesNotMatch(JSON.stringify(listed), /hidden/);
    lister.socket.destroy();

    const owner = new RawPeer(service.socketPath);
    owner.socket.write(encodeMessage({type: 'hello', version: PROTOCOL_VERSION, client: 'test'})
      + encodeMessage({type: 'attach', sessionId: record.id, columns: 70, rows: 20}));
    const attached = await owner.waitFor('attached');
    assert.equal(attached.type === 'attached' && attached.pid, shellPid);
    owner.socket.write(encodeMessage({type: 'terminate'}));
    await owner.waitFor('exit');
    owner.socket.destroy();
    await service.done;
    assert.equal(service.registry.length, 0);
    assert.equal(existsSync(service.socketPath), false);
  } finally {
    // Shells ended by close() still write their spool afterwards; wait so the directory stays removed.
    const pids = service.registry.map(session => session.pid);
    await service.close();
    await until(() => pids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }));
    await new Promise(resolve => setTimeout(resolve, 50));
    rmSync(runtimeDir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  }
});

test('service refuses unsafe runtime state', async () => {
  const open = scratch('nmsh-open-');
  chmodSync(open, 0o755);
  await assert.rejects(new SessionService({runtimeDir: open}).start(), /not private/);
  const occupied = scratch('nmsh-occ-');
  writeFileSync(socketPathFor(occupied), 'not a socket');
  await assert.rejects(new SessionService({runtimeDir: occupied}).start(), /unexpected file/);
  rmSync(open, {recursive: true, force: true});
  rmSync(occupied, {recursive: true, force: true});
});

test('frontend falls back to an in-process shell when the service is unavailable', async () => {
  const insecure = scratch('nmsh-bad-');
  chmodSync(insecure, 0o777);
  const first = await connectSession({cwd: insecure, columns: 80, rows: 24, runtimeDir: insecure});
  first.client.kill();
  assert.equal(first.mode, 'in-process');
  assert.match(first.notice ?? '', /not private/);

  const dir = join(scratch('nmsh-dead-'), 'rt');
  mkdirSync(dir, {mode: 0o700});
  const second = await connectSession({cwd: dir, columns: 80, rows: 24, runtimeDir: dir, timeoutMs: 500,
    env: {...process.env, NMSH_TEST_SECRET: 'never-shown'},
    serviceCommand: {command: process.execPath, args: ['-e', '']}});
  second.client.kill();
  assert.equal(second.mode, 'in-process');
  assert.match(second.notice ?? '', /unavailable/);
  assert.doesNotMatch(second.notice ?? '', /never-shown/);

  const disabled = await connectSession({cwd: dir, columns: 80, rows: 24, runtimeDir: dir, env: {...process.env, NMSH_SESSION_SERVICE: '0'}});
  disabled.client.kill();
  assert.equal(disabled.mode, 'in-process');
  assert.equal(disabled.notice, undefined);
  rmSync(insecure, {recursive: true, force: true});
  rmSync(dirname(dir), {recursive: true, force: true});
});

test('a service that closes the connection while exiting counts as having no live sessions', async () => {
  const runtimeDir = scratch('nmsh-exiting-');
  const exiting = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => exiting.listen(socketPathFor(runtimeDir), resolve));
  try {
    assert.deepEqual(await listLiveSessions({runtimeDir}), []);
  } finally {
    await new Promise<void>(resolve => exiting.close(() => resolve()));
    rmSync(runtimeDir, {recursive: true, force: true});
  }
});

test('the service remembers a fullscreen app\'s input modes so a reattaching terminal can restore them', async () => {
  const {AlternateScreenTracker} = await import('../src/session/SessionService.js');
  const screen = new AlternateScreenTracker();
  // Split across reads, combined parameters, later changes and keypad mode.
  for (const chunk of ['\u001b[?1049h\u001b[?1', '000;1006h\u001b[?2004h\u001b[?25l\u001b[?1h\u001b=', 'x\u001b[?2004l']) {
    screen.observeModes(chunk);
    screen.push(chunk);
  }
  assert.equal(screen.restoreSequence(), '\u001b[?1000h\u001b[?1006h\u001b[?25l\u001b[?1h\u001b=');
  screen.reset();
  assert.equal(screen.restoreSequence(), '', 'the app ending clears its modes');
});
