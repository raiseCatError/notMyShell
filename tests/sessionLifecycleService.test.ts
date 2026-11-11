import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {connect, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionService, type SessionServiceOptions} from '../src/session/SessionService.js';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, type ClientMessage, type ServerMessage, type SessionInfo} from '../src/session/SessionProtocol.js';
import {recoverEndedSessions} from '../src/session/recovery.js';
import {readSpool} from '../src/session/StreamBacklog.js';
import {spoolPathFor} from '../src/session/runtimeDir.js';
import {TranscriptStore} from '../src/sessions/TranscriptStore.js';

/**
 * The session service's lifecycle policy against real shells, with isolated runtime directories and short test
 * timers. Nothing here touches the developer's own NMSh or Rex sessions: every service, socket and shell is created
 * by the test and ended by it.
 */

const SHORT = 300;

class Peer {
  readonly messages: ServerMessage[] = [];
  readonly socket: Socket;
  closed = false;
  private readonly decoder = new FrameDecoder();
  constructor(path: string, hello: Partial<Extract<ClientMessage, {type: 'hello'}>> = {}) {
    this.socket = connect(path);
    this.socket.setEncoding('utf8');
    this.socket.on('data', chunk => { for (const r of this.decoder.push(chunk as unknown as string)) if (r.ok) this.messages.push(r.message as ServerMessage); });
    this.socket.on('close', () => { this.closed = true; });
    this.socket.on('error', () => {});
    this.send({type: 'hello', version: PROTOCOL_VERSION, client: 'test', features: 'input-state,queue,background-tasks', ...hello});
  }
  send(message: ClientMessage): void { this.socket.write(encodeMessage(message)); }
  count(type: string): number { return this.messages.filter(m => m.type === type).length; }
  async waitFor(type: string, count = 1, timeoutMs = 15000): Promise<ServerMessage> {
    await until(() => this.count(type) >= count, timeoutMs, `${type} #${count}`);
    return this.messages.filter(m => m.type === type)[count - 1]!;
  }
  /** Run a line in the session this peer controls and wait for its prompt. */
  async run(line: string): Promise<void> {
    const prompts = this.count('prompt');
    this.send({type: 'input', data: `${line}\r`, submission: 1});
    await this.waitFor('prompt', prompts + 1);
  }
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 15000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`${what} not reached`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(dir, 0o700);
  return dir;
}

interface Fixture {
  service: SessionService;
  home: string;
  runtimeDir: string;
  keeper: Peer;
  /** Create a session through a fresh peer and wait for its first prompt. */
  create(): Promise<{peer: Peer; id: string; pid: number}>;
  list(): Promise<SessionInfo[]>;
  alive(id: string): boolean;
}

async function withService(options: Partial<SessionServiceOptions>, body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const runtimeDir = scratch('nmsh-lc-');
  const home = scratch('nmsh-lch-');
  const service = new SessionService({runtimeDir, startupIdleMs: 60_000, ...options});
  await service.start();
  // Holds the service open so ending the last session in a test never shuts it down mid-test.
  const keeper = new Peer(service.socketPath);
  const pids: number[] = [];
  const fixture: Fixture = {
    service, home, runtimeDir, keeper,
    async create() {
      const peer = new Peer(service.socketPath);
      peer.send({type: 'create', cwd: home, env: {HOME: home, PATH: process.env.PATH ?? ''}, columns: 80, rows: 24});
      const created = await peer.waitFor('created');
      assert.equal(created.type, 'created');
      if (created.type !== 'created') throw new Error('not created');
      pids.push(created.pid);
      await peer.waitFor('prompt');
      return {peer, id: created.sessionId, pid: created.pid};
    },
    async list() {
      const lister = new Peer(service.socketPath);
      lister.send({type: 'list'});
      const listed = await lister.waitFor('sessions');
      lister.socket.destroy();
      return listed.type === 'sessions' ? listed.sessions : [];
    },
    alive: id => service.registry.some(record => record.id === id),
  };
  try { await body(fixture); }
  finally {
    keeper.socket.destroy();
    await service.close();
    // Shells that ignore SIGHUP (one test makes one) are this test's own children, verified by the registry above.
    for (const pid of pids) { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    await pause(50);
    rmSync(runtimeDir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  }
}

const detach = async (fixture: Fixture, peer: Peer, id: string) => {
  peer.socket.destroy();
  await until(() => fixture.service.registry.find(record => record.id === id)?.state === 'detached', 15000, 'detached');
};

test('an abandoned new session ends after the grace period; its spool says why and its transcript is archived', async () => {
  await withService({lifecycle: {unusedMs: SHORT, idleExpiryMs: 0}, childCount: async () => 0}, async fixture => {
    const {peer, id} = await fixture.create();
    const listed = (await fixture.list()).find(session => session.id === id)!;
    assert.equal(listed.used, undefined, 'never used');
    await detach(fixture, peer, id);
    const detached = (await fixture.list()).find(session => session.id === id)!;
    assert.ok(detached.detachedSince, 'the service reports when it lost its window');
    assert.match(detached.cleanup ?? '', /never used; cleanup in/);
    await until(() => !fixture.alive(id), 15000, 'unused session ended');
    const spool = readSpool(spoolPathFor(fixture.runtimeDir, id));
    assert.match(spool.exit?.reason ?? '', /never used/);
    const store = new TranscriptStore(join(fixture.home, 'transcripts'));
    const recovered = await recoverEndedSessions(fixture.runtimeDir, store);
    assert.equal(recovered.archived.length, 1, 'the transcript is kept, never discarded');
    const archived = await store.load(recovered.archived[0]!);
    const text = (archived as unknown as {transcript: {lines: Array<Array<{text: string}>>}}).transcript.lines.map(line => line.map(cell => cell.text).join('')).join('\n');
    assert.match(text, /Ended by NMSh session cleanup: never used/);
  });
});

test('reattaching before the deadline cancels cleanup; a new detach starts a new grace period', async () => {
  await withService({lifecycle: {unusedMs: 1500, idleExpiryMs: 0}, childCount: async () => 0}, async fixture => {
    const {peer, id} = await fixture.create();
    await detach(fixture, peer, id);
    await pause(700);
    const back = new Peer(fixture.service.socketPath);
    back.send({type: 'attach', sessionId: id, columns: 80, rows: 24});
    await back.waitFor('attached');
    await pause(1500);
    assert.ok(fixture.alive(id), 'attached: never ended by a timer');
    const started = Date.now();
    await detach(fixture, back, id);
    await until(() => !fixture.alive(id), 15000, 'ended after a full new grace');
    assert.ok(Date.now() - started >= 1300, 'the grace restarted at the new detach');
  });
});

test('closing one of several frontends detaches only; the session is never ended by a window going away', async () => {
  await withService({lifecycle: {unusedMs: 0, idleExpiryMs: 0}}, async fixture => {
    const {peer, id, pid} = await fixture.create();
    const second = new Peer(fixture.service.socketPath);
    second.send({type: 'attach', sessionId: id, columns: 80, rows: 24});
    const refused = await second.waitFor('error');
    assert.equal(refused.type === 'error' && refused.code, 'attached', 'one controlling window at a time');
    // A Rex pane or any window closing: the frontend's connection goes away, however abruptly.
    await detach(fixture, peer, id);
    process.kill(pid, 0);
    second.send({type: 'attach', sessionId: id, columns: 80, rows: 24});
    await second.waitFor('attached');
    // Ending the session is a separate, explicit act.
    second.send({type: 'terminate'});
    await second.waitFor('exit');
    assert.equal(fixture.alive(id), false);
  });
});

test('an idle shell that still holds work is never ended: jobs, child processes, background tasks, input waits, long commands', async () => {
  let children: number | undefined = 0;
  await withService({lifecycle: {unusedMs: SHORT, idleExpiryMs: 0}, childCount: async () => children}, async fixture => {
    // A shell job: used, and the shell itself says it holds a job.
    const job = await fixture.create();
    await job.peer.run('sleep 30 &');
    // A long foreground command (an agent, a build): running.
    const running = await fixture.create();
    running.peer.send({type: 'input', data: 'sleep 30\r', submission: 1});
    await running.peer.waitFor('exec');
    // An input wait.
    const waiting = await fixture.create();
    waiting.peer.send({type: 'input', data: 'read -r answer\r', submission: 1});
    await waiting.peer.waitFor('exec');
    // Never used, but the shell has a child process the policy cannot see as a job.
    children = 1;
    const child = await fixture.create();
    for (const session of [job, running, waiting, child]) await detach(fixture, session.peer, session.id);
    await pause(SHORT * 4);
    for (const session of [job, running, waiting, child]) assert.ok(fixture.alive(session.id), 'work keeps every one of them');
    const listed = await fixture.list();
    assert.match(listed.find(session => session.id === job.id)!.cleanup ?? '', /1 shell job/);
    assert.match(listed.find(session => session.id === running.id)!.cleanup ?? '', /command is running/);
  });
});

test('unknown child processes preserve the session; the policy never guesses', async () => {
  await withService({lifecycle: {unusedMs: SHORT, idleExpiryMs: 0}, childCount: async () => undefined}, async fixture => {
    const {peer, id} = await fixture.create();
    await detach(fixture, peer, id);
    await pause(SHORT * 4);
    assert.ok(fixture.alive(id));
  });
});

test('a timer that fires during an attach race never ends the newly attached session', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let asked = 0;
  await withService({lifecycle: {unusedMs: SHORT, idleExpiryMs: 0}, childCount: async () => { asked += 1; await gate; return 0; }}, async fixture => {
    const {peer, id} = await fixture.create();
    await detach(fixture, peer, id);
    await until(() => asked > 0, 15000, 'the timer fired and is re-verifying');
    const back = new Peer(fixture.service.socketPath);
    back.send({type: 'attach', sessionId: id, columns: 80, rows: 24});
    await back.waitFor('attached');
    release();
    await pause(300);
    assert.ok(fixture.alive(id), 'eligibility was re-read after the check; attached wins');
    assert.equal(back.count('exit'), 0);
  });
});

test('a protected session is never ended by cleanup; unprotecting lets the policy apply again', async () => {
  await withService({lifecycle: {unusedMs: SHORT, idleExpiryMs: 0}, childCount: async () => 0}, async fixture => {
    const {peer, id} = await fixture.create();
    fixture.keeper.send({type: 'protect', sessionId: id, on: 1});
    await fixture.keeper.waitFor('sessions');
    await detach(fixture, peer, id);
    await pause(SHORT * 4);
    assert.ok(fixture.alive(id));
    assert.equal((await fixture.list()).find(session => session.id === id)!.protected, 1);
    fixture.keeper.send({type: 'protect', sessionId: id, on: 0});
    await until(() => !fixture.alive(id), 15000, 'ended once unprotected');
  });
});

test('idle expiry is off unless set; when set it ends only a used idle detached session', async () => {
  await withService({lifecycle: {unusedMs: 0, idleExpiryMs: 0}, childCount: async () => 0}, async fixture => {
    const {peer, id} = await fixture.create();
    await peer.run('true');
    await detach(fixture, peer, id);
    await pause(SHORT * 3);
    assert.ok(fixture.alive(id), 'off by default: a used idle session stays');
  });
  await withService({lifecycle: {unusedMs: 0, idleExpiryMs: SHORT}, childCount: async () => 0}, async fixture => {
    const {peer, id} = await fixture.create();
    await peer.run('true');
    await detach(fixture, peer, id);
    await until(() => !fixture.alive(id), 15000, 'idle expiry ended it');
  });
});

test('sessions created before a policy reached the service keep their behaviour; a later policy does not end them', async () => {
  await withService({childCount: async () => 0}, async fixture => {
    const {peer, id} = await fixture.create();
    await detach(fixture, peer, id);
    // A newer frontend now says what the person configured.
    const newer = new Peer(fixture.service.socketPath, {lifecycle: 'unused=60;idle=3600'});
    newer.send({type: 'list'});
    const listed = await newer.waitFor('sessions');
    assert.equal(listed.type === 'sessions' && listed.sessions[0]!.cleanup, 'never used', 'offered for review, never timed');
    assert.ok(fixture.alive(id));
  });
});

test('End All Eligible: the service re-verifies each kill and refuses one that has work, is protected, or is not eligible yet', async () => {
  let offset = 0;
  await withService({lifecycle: {unusedMs: 0, idleExpiryMs: 0}, childCount: async () => 0, now: () => Date.now() + offset}, async fixture => {
    const busy = await fixture.create();
    busy.peer.send({type: 'input', data: 'sleep 30\r', submission: 1});
    await busy.peer.waitFor('exec');
    const guarded = await fixture.create();
    fixture.keeper.send({type: 'protect', sessionId: guarded.id, on: 1});
    const free = await fixture.create();
    for (const session of [busy, guarded, free]) await detach(fixture, session.peer, session.id);
    const outcome = async (id: string) => {
      const killer = new Peer(fixture.service.socketPath);
      killer.send({type: 'kill', sessionId: id, when: 'eligible'});
      await until(() => killer.count('killed') + killer.count('error') > 0, 15000, 'kill answered');
      const reply = killer.messages.find(m => m.type === 'killed' || m.type === 'error')!;
      killer.socket.destroy();
      return reply.type === 'error' ? `${reply.code}: ${reply.message}` : 'killed';
    };
    assert.match(await outcome(free.id), /^busy: never used/, 'just detached: not eligible yet, so not ended');
    offset = 2 * 24 * 60 * 60_000;
    assert.match(await outcome(busy.id), /^busy: .*command is running/);
    assert.match(await outcome(guarded.id), /^busy: protected/);
    assert.equal(await outcome(free.id), 'killed', 'an unused idle session is eligible for an explicit, confirmed end');
    assert.ok(fixture.alive(busy.id));
    assert.ok(fixture.alive(guarded.id));
  });
});

test('an explicit end of a shell that ignores SIGHUP escalates, so End never leaves a half-ended session', async () => {
  await withService({killEscalationMs: 500}, async fixture => {
    const {peer, id} = await fixture.create();
    await peer.run("trap '' HUP");
    await detach(fixture, peer, id);
    const killer = new Peer(fixture.service.socketPath);
    killer.send({type: 'kill', sessionId: id});
    await killer.waitFor('killed', 1, 10000);
    assert.equal(fixture.alive(id), false);
    assert.ok(existsSync(spoolPathFor(fixture.runtimeDir, id)), 'the spool stays for archiving');
  });
});

test('a policy stated by another window never makes an older frontend\'s new session timer-eligible', async () => {
  await withService({childCount: async () => 0}, async fixture => {
    const newer = new Peer(fixture.service.socketPath, {lifecycle: 'unused=60;idle=0'});
    newer.send({type: 'list'});
    await newer.waitFor('sessions');
    // An older frontend (no lifecycle in its hello) creates a session after the policy reached the service.
    const {peer, id} = await fixture.create();
    await detach(fixture, peer, id);
    const listed = (await fixture.list()).find(session => session.id === id)!;
    assert.equal(listed.cleanup, 'never used', 'offered for review only; no countdown');
    assert.equal(listed.cleanupAt, undefined);
  });
});

test('an unknown kill condition is refused, never read as an unconditional kill', async () => {
  await withService({}, async fixture => {
    const {peer, id} = await fixture.create();
    await detach(fixture, peer, id);
    const killer = new Peer(fixture.service.socketPath);
    killer.send({type: 'kill', sessionId: id, when: 'someday'});
    const refused = await killer.waitFor('error');
    assert.equal(refused.type === 'error' && refused.code, 'unsupported');
    await pause(200);
    assert.ok(fixture.alive(id));
  });
});

test('a shell still in its startup (an rc file waiting on a question) is busy, never an unused session to clean up', async () => {
  await withService({lifecycle: {unusedMs: SHORT, idleExpiryMs: 0}, childCount: async () => 0}, async fixture => {
    // The person's own .zshrc asks something before the first prompt, like an update check does.
    writeFileSync(join(fixture.home, '.zshrc'), 'read -r answer\n');
    const peer = new Peer(fixture.service.socketPath);
    peer.send({type: 'create', cwd: fixture.home, env: {HOME: fixture.home, PATH: process.env.PATH ?? ''}, columns: 80, rows: 24});
    const created = await peer.waitFor('created');
    const id = created.type === 'created' ? created.sessionId : '';
    await pause(300);
    assert.equal(peer.count('prompt'), 0, 'the shell is still in its startup');
    await detach(fixture, peer, id);
    await pause(SHORT * 4);
    assert.ok(fixture.alive(id), 'never ended while its startup waits');
    assert.equal((await fixture.list()).find(session => session.id === id)!.lifecycle, 'executing');
  });
});
