import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {connect, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {endDetachedSession, type EndDetachedDeps} from '../src/session/liveSessions.js';
import {askWithKill, createMultiPicker, multiPickerKey, pickWithKill, renderMultiPicker, type KillResult} from '../src/session/StartupPicker.js';
import {SessionConnectError} from '../src/session/SocketSessionClient.js';
import {SessionService} from '../src/session/SessionService.js';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, type ServerMessage, type SessionInfo} from '../src/session/SessionProtocol.js';
import type {Key} from '../src/terminal/keys.js';

const info = (id: string, state: SessionInfo['state'], extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({id, pid: 100, state, cwd: `/w/${id}`, createdAt: 1_000, ...extra});
const text = (value: string): Key => ({kind: 'text', value});
const key = (kind: string): Key => ({kind} as Key);

/** A scripted service: what it lists, how a kill answers, and every call made to it. */
function fakeService(listed: SessionInfo[] | Error, kill: (session: SessionInfo) => Promise<void> = async () => {}, archive: () => Promise<unknown> = async () => ({})) {
  const calls: string[] = [];
  const deps: EndDetachedDeps = {
    list: async () => { calls.push('list'); if (listed instanceof Error) throw listed; return listed; },
    kill: async session => { calls.push(`kill ${session.id}`); await kill(session); },
    archive: async () => { calls.push('archive'); return archive(); },
  };
  return {deps, calls};
}

test('ending a session: only a shell this call ended counts as killed; every other answer is reported as it is', async () => {
  // The service cannot be asked: a failure, never "already ended".
  const unreachable = fakeService(new SessionConnectError('session service did not respond', 'timeout'));
  await assert.rejects(endDetachedSession(info('a', 'detached'), unreachable.deps), /did not respond/);
  assert.deepEqual(unreachable.calls, ['list'], 'nothing is killed when the service could not be asked');

  // No longer listed: gone, and nothing is sent.
  const gone = fakeService([info('b', 'detached')]);
  assert.equal(await endDetachedSession(info('a', 'detached'), gone.deps), 'gone');
  assert.deepEqual(gone.calls, ['list']);

  // Attached since the picker opened: never touched.
  const attached = fakeService([info('a', 'attached')]);
  assert.equal(await endDetachedSession(info('a', 'detached'), attached.deps), 'attached');
  assert.deepEqual(attached.calls, ['list']);

  // Attached between the re-read and the kill: the service refuses, and that is "attached", not a failure or a kill.
  const raced = fakeService([info('a', 'detached')], async () => { throw new SessionConnectError('session service refused: session is attached to another frontend', 'attached'); });
  assert.equal(await endDetachedSession(info('a', 'detached'), raced.deps), 'attached');
  assert.deepEqual(raced.calls, ['list', 'kill a']);

  // Ended between the re-read and the kill.
  const ended = fakeService([info('a', 'detached')], async () => { throw new SessionConnectError('session service refused: no live session with that id', 'unknown'); });
  assert.equal(await endDetachedSession(info('a', 'detached'), ended.deps), 'gone');

  // Any other kill failure propagates; the archive is never attempted.
  const timeout = fakeService([info('a', 'detached')], async () => { throw new SessionConnectError('session service did not respond', 'timeout'); });
  await assert.rejects(endDetachedSession(info('a', 'detached'), timeout.deps), /did not respond/);
  assert.deepEqual(timeout.calls, ['list', 'kill a']);

  // Killed, archived.
  const killed = fakeService([info('a', 'detached')]);
  assert.equal(await endDetachedSession(info('a', 'detached'), killed.deps), 'killed');
  assert.deepEqual(killed.calls, ['list', 'kill a', 'archive']);

  // Killed by this call, but archiving failed: still ended by us (never "already ended"), and said so.
  const unarchived = fakeService([info('a', 'detached')], async () => {}, async () => { throw new Error('Another NMSh window is archiving this session.'); });
  assert.equal(await endDetachedSession(info('a', 'detached'), unarchived.deps), 'killed-unarchived');
});

test('the kill targets the service\'s current record of the same id, never a remembered pid', async () => {
  const seen: SessionInfo[] = [];
  const {deps} = fakeService([info('a', 'detached', {pid: 999})], async session => { seen.push(session); });
  await endDetachedSession(info('a', 'detached', {pid: 100}), deps);
  assert.equal(seen[0]!.pid, 999, 'the re-read record is what is sent; the kill itself is addressed by id');
});

test('bulk confirmation names every target, by name, with no "and N more"', () => {
  const sessions = Array.from({length: 12}, (_, index) => info(`s${index}`, 'detached', {cwd: '/w/same', signature: `Fruit${index}`}));
  const state = createMultiPicker(sessions);
  multiPickerKey(state, text('a'));
  multiPickerKey(state, text('x'));
  const screen = renderMultiPicker(state, 120, 5_000).join('\n');
  assert.match(screen, /Kill 12 detached sessions\?/);
  for (let index = 0; index < 12; index += 1) assert.match(screen, new RegExp(`Fruit${index} · /w/same`), `session ${index} is listed`);
  assert.doesNotMatch(screen, /more/);
});

test('bulk end with partial failures: each outcome is counted, failures stay listed and selected, nothing claims success', async () => {
  const outcomes: Array<KillResult | Error> = ['killed', new Error('session service did not respond'), 'killed-unarchived', 'gone'];
  const screens: string[] = [];
  let call = 0;
  const run = async <T,>(render: (columns: number) => string[], onKey: (key: Key) => T | undefined): Promise<T> => {
    const keys = call === 0 ? [text('a'), text('x'), text('y')] : [text('n')];
    call += 1;
    for (const k of keys) { const result = onKey(k); if (result !== undefined) return result; }
    throw new Error('no result');
  };
  const sessions = ['a', 'b', 'c', 'd'].map(id => info(id, 'detached'));
  const ids = await pickWithKill(sessions, {run: async (render, onKey) => { screens.push(render(400).join('\n')); return run(render, onKey); },
    now: () => 0, kill: async () => { const next = outcomes.shift()!; if (next instanceof Error) throw next; return next; }});
  assert.deepEqual(ids, []);
  const summary = screens.find(screen => /ended/.test(screen)) ?? '';
  assert.match(summary, /1 session ended/);
  assert.match(summary, /1 session ended but its transcript was not archived yet/);
  assert.match(summary, /1 session had already ended/);
  assert.match(summary, /1 session could not be ended \(session service did not respond\)/);
  assert.match(summary, /1 detached live session\b/, 'only the failed one is still listed');
  assert.match(summary, /\/w\/b/);
});

test('one-session prompt: a kill the service refused or could not perform returns to the prompt and says why', async () => {
  const outcomes: Array<KillResult | Error> = ['attached', new Error('session service did not respond')];
  const screens: string[] = [];
  const script: Key[][] = [[text('x')], [key('enter')], [text('x')], [key('enter')], [text('n')]];
  const run = async <T,>(render: (columns: number) => string[], onKey: (key: Key) => T | undefined): Promise<T> => {
    screens.push(render(120).join('\n'));
    for (const k of script.shift() ?? []) { const result = onKey(k); if (result !== undefined) return result; }
    throw new Error('no result');
  };
  const choice = await askWithKill(info('a', 'detached'), {run, now: () => 0,
    kill: async () => { const next = outcomes.shift()!; if (next instanceof Error) throw next; return next; }});
  assert.equal(choice, 'not-now', 'neither refused kill was treated as a kill');
  assert.ok(screens.some(screen => /1 detached live session[\s\S]*attached in another window and was not touched/.test(screen)));
  assert.ok(screens.some(screen => /Could not end that session: session service did not respond/.test(screen)));
});

test('one-session prompt: a killed or already-ended session lets startup continue fresh', async () => {
  for (const outcome of ['killed', 'killed-unarchived', 'gone'] as const) {
    const script: Key[][] = [[text('x')], [key('enter')]];
    const run = async <T,>(_render: unknown, onKey: (key: Key) => T | undefined): Promise<T> => {
      for (const k of script.shift() ?? []) { const result = onKey(k); if (result !== undefined) return result; }
      throw new Error('no result');
    };
    assert.equal(await askWithKill(info('a', 'detached'), {run, kill: async () => outcome}), 'kill');
  }
});

class RawPeer {
  readonly messages: ServerMessage[] = [];
  readonly socket: Socket;
  private readonly decoder = new FrameDecoder();
  constructor(path: string) {
    this.socket = connect(path);
    this.socket.setEncoding('utf8');
    this.socket.on('data', chunk => { for (const r of this.decoder.push(chunk as unknown as string)) if (r.ok) this.messages.push(r.message as ServerMessage); });
    this.socket.on('error', () => {});
    this.send({type: 'hello', version: PROTOCOL_VERSION, client: 'test'});
  }
  send(message: Parameters<typeof encodeMessage>[0]): void { this.socket.write(encodeMessage(message)); }
  count(type: string): number { return this.messages.filter(m => m.type === type).length; }
  async waitFor(type: string, count = 1): Promise<ServerMessage> {
    await until(() => this.count(type) >= count);
    return this.messages.filter(m => m.type === type)[count - 1]!;
  }
}

async function until(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(dir, 0o700);
  return dir;
}

test('service: once a confirmed kill is sent, no window can attach to the ending session before its shell exits', async () => {
  const runtimeDir = scratch('nmsh-kr-');
  const home = scratch('nmsh-kh-');
  const service = new SessionService({runtimeDir, startupIdleMs: 60_000});
  await service.start();
  const keeper = new RawPeer(service.socketPath);
  let pid = 0;
  try {
    const owner = new RawPeer(service.socketPath);
    owner.send({type: 'create', cwd: home, env: {HOME: home, PATH: process.env.PATH ?? ''}, columns: 80, rows: 24});
    const created = await owner.waitFor('created');
    const id = created.type === 'created' ? created.sessionId : '';
    pid = created.type === 'created' ? created.pid : 0;
    await owner.waitFor('prompt');
    // The shell takes a moment to exit after SIGHUP: the window in which an attach used to succeed.
    owner.send({type: 'input', data: 'trap "sleep 1; exit 0" HUP\r'});
    await owner.waitFor('prompt', 2);
    owner.socket.destroy();
    await until(() => service.registry[0]?.state === 'detached');

    const killer = new RawPeer(service.socketPath);
    killer.send({type: 'kill', sessionId: id});
    await until(() => (service as unknown as {sessions: Map<string, {ending?: true}>}).sessions.get(id)?.ending === true);
    const attacher = new RawPeer(service.socketPath);
    attacher.send({type: 'attach', sessionId: id, columns: 80, rows: 24});
    const refused = await attacher.waitFor('error');
    assert.equal(refused.type === 'error' && refused.code, 'unknown');
    assert.match(refused.type === 'error' ? refused.message : '', /ending/);
    assert.equal(attacher.count('attached'), 0);
    // A second kill for the same session waits for the same exit.
    const again = new RawPeer(service.socketPath);
    again.send({type: 'kill', sessionId: id});
    await killer.waitFor('killed');
    await again.waitFor('killed');
    assert.equal(service.registry.length, 0);
    for (const peer of [killer, attacher, again]) peer.socket.destroy();
  } finally {
    keeper.socket.destroy();
    await service.close();
    if (pid) await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 5000).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 50));
    rmSync(runtimeDir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  }
});
