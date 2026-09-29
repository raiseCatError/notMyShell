import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {connect, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionService} from '../src/session/SessionService.js';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, type ServerMessage} from '../src/session/SessionProtocol.js';
import {ShellSession, isClosedPtyError} from '../src/shell/ShellSession.js';
import {until} from './helpers/liveFrontend.js';

/**
 * #199: node-pty closes the PTY descriptor before it reports the shell's exit,
 * and a frontend can always send a resize just before it hears of the exit.
 * A resize on a closed PTY threw `ioctl(2) failed, EBADF` synchronously, which
 * inside nmshd's socket handler would end the service and every live session.
 */

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(dir, 0o700);
  return dir;
}

/**
 * Close the service and wait for its shells to exit: a shell that ends after
 * close still writes its spool (the exit record), which would otherwise
 * recreate the runtime directory after the test removed it.
 */
async function closeAndDrain(service: SessionService): Promise<void> {
  const pids = service.registry.map(session => session.pid);
  await service.close();
  await until(() => pids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }), 10000, 'shells exited');
  await new Promise(resolve => setTimeout(resolve, 50));
}

const prompt = (shell: ShellSession) => new Promise<void>(resolve => shell.once('prompt', () => resolve()));
const exit = (shell: ShellSession) => new Promise<void>(resolve => shell.once('exit', () => resolve()));

test('only a closed-descriptor error counts as the teardown race', () => {
  assert.equal(isClosedPtyError(new Error('ioctl(2) failed, EBADF')), true);
  assert.equal(isClosedPtyError(new Error('ioctl(2) failed, EINVAL')), false);
  assert.equal(isClosedPtyError('EBADF'), false);
});

test('resizing a shell that has exited is a no-op, not a crash (threw EBADF before #199)', async () => {
  const home = scratch('nmsh-resize-');
  try {
    const shell = new ShellSession(home, 80, 24, home);
    await prompt(shell);
    const exited = exit(shell);
    shell.write('exit\r');
    await exited;
    assert.doesNotThrow(() => shell.resize(90, 30));
    assert.doesNotThrow(() => shell.resize(1, 1));

    const killed = new ShellSession(home, 80, 24, home);
    await prompt(killed);
    const gone = exit(killed);
    killed.kill();
    assert.doesNotThrow(() => killed.resize(90, 30), 'resize right after kill');
    await gone;
    assert.doesNotThrow(() => killed.resize(91, 31), 'and after the exit is reported');
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
});

test('a burst of resizes racing the shell\'s exit never throws, and the exit is still reported', async () => {
  const home = scratch('nmsh-resize-');
  try {
    for (let round = 0; round < 5; round += 1) {
      const shell = new ShellSession(home, 80, 24, home);
      await prompt(shell);
      let reported = false;
      shell.once('exit', () => { reported = true; });
      shell.write('exit\r');
      let size = 20;
      await until(() => {
        assert.doesNotThrow(() => shell.resize(80 + (size % 7), size % 2 === 0 ? 24 : 25));
        size += 1;
        return reported;
      }, 15000, 'exit reported');
      for (let index = 0; index < 20; index += 1) shell.resize(100 + index, 30);
    }
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
});

test('any other resize failure still surfaces', async () => {
  const home = scratch('nmsh-resize-');
  const shell = new ShellSession(home, 80, 24, home);
  try {
    await prompt(shell);
    (shell as unknown as {pty: {resize: () => void}}).pty.resize = () => { throw new Error('ioctl(2) failed, EINVAL'); };
    assert.throws(() => shell.resize(90, 30), /EINVAL/);
  } finally {
    shell.kill();
    rmSync(home, {recursive: true, force: true});
  }
});

class Peer {
  readonly messages: ServerMessage[] = [];
  readonly socket: Socket;
  closed = false;
  private readonly decoder = new FrameDecoder();
  constructor(path: string) {
    this.socket = connect(path);
    this.socket.setEncoding('utf8');
    this.socket.on('data', chunk => {
      for (const result of this.decoder.push(chunk as unknown as string)) if (result.ok) this.messages.push(result.message as ServerMessage);
    });
    this.socket.on('close', () => { this.closed = true; });
    this.socket.on('error', () => {});
  }
  send(message: Parameters<typeof encodeMessage>[0]): void { this.socket.write(encodeMessage(message)); }
  output(): string { return this.messages.map(message => (message.type === 'output' ? message.data : '')).join(''); }
  async create(home: string): Promise<void> {
    this.send({type: 'hello', version: PROTOCOL_VERSION, client: 'test'});
    this.send({type: 'create', cwd: home, env: {HOME: home, PATH: process.env.PATH ?? ''}, columns: 80, rows: 24});
    await until(() => this.messages.some(message => message.type === 'prompt'), 15000, 'prompt');
  }
}

test('nmshd survives resizes that race a shell\'s exit; other sessions keep working and still resize', async () => {
  const runtimeDir = scratch('nmsh-svc-');
  const home = scratch('nmsh-home-');
  const service = new SessionService({runtimeDir, startupIdleMs: 60_000});
  await service.start();
  try {
    const bystander = new Peer(service.socketPath);
    await bystander.create(home);
    const racer = new Peer(service.socketPath);
    await racer.create(home);

    // Resizes before, during and after the exit, including after the service reported it.
    racer.send({type: 'input', data: 'exit\r'});
    for (let index = 0; index < 50 && !racer.messages.some(message => message.type === 'exit'); index += 1) {
      racer.send({type: 'resize', columns: 90 + (index % 5), rows: 30});
      await new Promise(resolve => setImmediate(resolve));
    }
    await until(() => racer.messages.some(message => message.type === 'exit'), 15000, 'racer exit');
    if (!racer.closed) for (let index = 0; index < 10; index += 1) racer.send({type: 'resize', columns: 100, rows: 40});
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.equal(bystander.closed, false, 'the service is still running');
    bystander.send({type: 'resize', columns: 111, rows: 33});
    bystander.send({type: 'input', data: 'echo SIZE-$(stty size | tr " " x)\r'});
    await until(() => /SIZE-33x111/u.test(bystander.output()), 15000, 'ordinary resize still reaches the shell');
  } finally {
    await closeAndDrain(service);
    rmSync(runtimeDir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  }
});

test('an unexpected resize error is reported to that client instead of ending nmshd', async () => {
  const runtimeDir = scratch('nmsh-svc-');
  const home = scratch('nmsh-home-');
  const service = new SessionService({runtimeDir, startupIdleMs: 60_000});
  await service.start();
  try {
    const peer = new Peer(service.socketPath);
    await peer.create(home);
    const managed = [...(service as unknown as {sessions: Map<string, {shell: ShellSession}>}).sessions.values()][0]!;
    (managed.shell as unknown as {resize: () => void}).resize = () => { throw new Error('ioctl(2) failed, EINVAL'); };
    peer.send({type: 'resize', columns: 90, rows: 30});
    await until(() => peer.messages.some(message => message.type === 'error' && message.code === 'resize'), 15000, 'resize error reported');
    peer.send({type: 'input', data: 'echo STILL-ALIVE\r'});
    await until(() => /STILL-ALIVE/u.test(peer.output()), 15000, 'session still usable');
    assert.equal(existsSync(service.socketPath), true);
  } finally {
    await closeAndDrain(service);
    rmSync(runtimeDir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  }
});
