import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {connect, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionService} from '../src/session/SessionService.js';
import {dismissNotice, listSessionsWithNotices} from '../src/session/SocketSessionClient.js';
import {FrameDecoder, decodeMessage, encodeMessage, PROTOCOL_VERSION, type ServerMessage} from '../src/session/SessionProtocol.js';
import {
  describeNotice, EndedNotices, MAX_ENDED_NOTICES, MAX_VISIBLE_NOTICES, noticeKey, programIdentity, selectNotices, SessionNoticeTracker,
  LONG_RUNNING_MS, type SessionNotice,
} from '../src/session/SessionNotices.js';
import {planScreen, regionOf, withNoticeRows} from '../src/app/screenPlan.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';

const notice = (sessionId: string, at: number, kind: SessionNotice['kind'] = 'completed'): SessionNotice => ({sessionId, kind, at});

test('tracker: completion, failure, interrupt, attention and long-running are factual and deduplicated', () => {
  const tracker = new SessionNoticeTracker('s1');
  tracker.onPrompt(0, 10, '/w');
  assert.equal(tracker.notice, undefined, 'a prompt without a run (startup) is not news');
  tracker.onExec('ANTHROPIC_LOG=1 claude --resume "secret prompt words"', 100);
  tracker.onPrompt(0, 1_100, '/w');
  assert.deepEqual(tracker.notice, {sessionId: 's1', kind: 'completed', at: 1_100, program: 'claude', agent: 'claude', exitCode: 0, durationMs: 1_000, cwd: '/w'});
  assert.doesNotMatch(JSON.stringify(tracker.notice), /secret|prompt words|ANTHROPIC/u, 'arguments and environment are never kept');

  tracker.onExec('make test', 2_000);
  tracker.onPrompt(2, 2_500, '/w');
  assert.equal(tracker.notice?.kind, 'failed', 'a newer transition replaces the older one');
  assert.equal(tracker.notice?.exitCode, 2);

  tracker.onExec('sleep 100', 3_000);
  tracker.onPrompt(130, 3_100, '/w');
  assert.equal(tracker.notice, undefined, 'Ctrl+C is the user acting there, not news');

  tracker.onExec('codex', 4_000);
  tracker.onAttention(4_500);
  const attention = tracker.notice;
  assert.equal(attention?.kind, 'attention');
  assert.equal(attention?.agent, 'codex');
  tracker.onAttention(4_600);
  assert.equal(tracker.notice, attention, 'repeated attention for the same run is one notice');
  tracker.clear(5_000);
  tracker.onAttention(4_500);
  assert.equal(tracker.notice, undefined, 'attention already seen by focusing does not come back');

  tracker.checkLongRunning(4_000 + LONG_RUNNING_MS - 1);
  assert.equal(tracker.notice, undefined);
  tracker.checkLongRunning(4_000 + LONG_RUNNING_MS);
  assert.equal(tracker.notice?.kind, 'long-running');
  tracker.clear(9e9);
  tracker.checkLongRunning(4_000 + LONG_RUNNING_MS * 2);
  assert.equal(tracker.notice, undefined, 'one long-running notice per run');
});

test('frontend selection: never own session, newest first, max three with collapsed overflow, dismissed hidden', () => {
  const all = [notice('a', 1), notice('b', 5), notice('c', 3), notice('own', 9), notice('b', 5), notice('d', 4)];
  const view = selectNotices(all, 'own');
  assert.equal(view.notices.length + (view.hidden ? 1 : 0), MAX_VISIBLE_NOTICES, 'exactly three rows including the summary');
  assert.deepEqual(view.notices.map(item => item.sessionId), ['b', 'd']);
  assert.equal(view.hidden, 2);
  assert.ok(!view.notices.some(item => item.sessionId === 'own'));
  const three = selectNotices([notice('a', 1), notice('b', 2), notice('b', 2), notice('c', 3)], undefined);
  assert.deepEqual(three, {notices: [notice('c', 3), notice('b', 2), notice('a', 1)], hidden: 0}, 'duplicates collapse; three fit without a summary');
  assert.deepEqual(selectNotices([notice('a', 1)], undefined, new Set([noticeKey(notice('a', 1))])).notices, []);
});

test('notice wording is compact and factual', () => {
  const now = 20 * 60_000;
  assert.equal(describeNotice({sessionId: 'x', kind: 'completed', at: 2 * 60_000, agent: 'claude', program: 'claude', durationMs: 18 * 60_000}, 'Session 2', now).text,
    'Session 2 · Claude finished after 18m 0s · 18m ago');
  assert.match(describeNotice({sessionId: 'x', kind: 'failed', at: now, program: 'make', exitCode: 2}, 'Session 3', now).text, /^Session 3 · make failed \(exit 2\)/u);
  assert.match(describeNotice({sessionId: 'x', kind: 'attention', at: now, program: 'vim'}, 'Session 4', now).text, /vim asked for attention/u);
  assert.match(describeNotice({sessionId: 'x', kind: 'ended', at: now, exitCode: 0, cwd: '/tmp'}, 'Session x', now).text, /shell ended · \/tmp/u);
  assert.deepEqual(programIdentity('git commit -m "claude"'), {program: 'git'});
});

test('ended notices are bounded, expire and are dismissable', () => {
  const ended = new EndedNotices();
  for (let index = 0; index < 20; index += 1) ended.add(notice(`s${index}`, 1_000 + index, 'ended'));
  assert.equal(ended.list(2_000).length, MAX_ENDED_NOTICES);
  assert.equal(ended.dismiss('s19'), true);
  assert.equal(ended.list(2_000).some(item => item.sessionId === 's19'), false);
  assert.equal(ended.list(1_000 + 61 * 60_000).length, 0, 'expired after an hour');
});

test('protocol: notices decode strictly; older frames without them still decode', () => {
  const info = {id: 'a', pid: 1, state: 'detached', cwd: '/', createdAt: 1};
  const old = decodeMessage(JSON.stringify({v: PROTOCOL_VERSION, type: 'sessions', sessions: [info]}));
  assert.ok(old.ok);
  const ok = decodeMessage(JSON.stringify({v: PROTOCOL_VERSION, type: 'sessions', sessions: [{...info, notice: notice('a', 2)}], ended: [notice('b', 3, 'ended')]}));
  assert.ok(ok.ok && ok.message.type === 'sessions' && ok.message.sessions[0]!.notice?.kind === 'completed' && ok.message.ended?.length === 1);
  const bad = decodeMessage(JSON.stringify({v: PROTOCOL_VERSION, type: 'sessions', sessions: [{...info, notice: {...notice('a', 2), kind: 'summary'}}]}));
  assert.equal(bad.ok, false, 'unknown notice kinds are rejected, not shown');
});

test('screen plan: notices sit directly above the composer in every position and move nothing above it', () => {
  const base = {rows: 30, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true, contextPlacement: 'header' as const,
    hasVisibleContext: true, composerLayout: 'twoLine' as const, transcriptRows: 100};
  for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
    const plan = withNoticeRows(planScreen({...base, rows: 27, composerPosition}), 3);
    assert.equal(plan.rows, 30);
    const notices = regionOf(plan, 'notices')!;
    const composer = plan.regions.find(region => region.kind === 'composerBorder' || region.kind === 'prompt' || region.kind === 'input')!;
    assert.equal(notices.top + notices.height, composer.top, composerPosition);
    const total = plan.regions.reduce((sum, region) => sum + region.height, 0);
    assert.ok(total <= plan.rows);
    for (let index = 1; index < plan.regions.length; index += 1) {
      assert.ok(plan.regions[index]!.top >= plan.regions[index - 1]!.top + plan.regions[index - 1]!.height, 'no overlap');
    }
  }
  const panel = planScreen({...base, panelRows: 10});
  assert.equal(withNoticeRows(panel, 3), panel, 'a panel owning the screen hides notices');
});

test('settings and commands: notices and agent activity default On and persist explicit Off', () => {
  const defaults = normalizePromptConfiguration({});
  assert.equal(defaults.sessionNotices, true);
  assert.equal(defaults.agentActivity, true);
  const off = normalizePromptConfiguration({sessionNotices: false, agentActivity: false, modules: []});
  assert.equal(off.sessionNotices, false);
  assert.equal(off.agentActivity, false);
  assert.deepEqual(parseSlashCommand('/notices clear'), {kind: 'notices', action: 'clear'});
  assert.deepEqual(parseSlashCommand('/agents reset'), {kind: 'agents', action: 'reset'});
  assert.equal(parseSlashCommand('/agents bogus')?.kind, 'unknown');
});

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(dir, 0o700);
  return dir;
}

class Peer {
  readonly messages: ServerMessage[] = [];
  readonly socket: Socket;
  private readonly decoder = new FrameDecoder();
  constructor(path: string) {
    this.socket = connect(path);
    this.socket.setEncoding('utf8');
    this.socket.on('data', chunk => { for (const r of this.decoder.push(String(chunk))) if (r.ok) this.messages.push(r.message as ServerMessage); });
    this.socket.on('error', () => {});
    this.send({type: 'hello', version: PROTOCOL_VERSION, client: 'test'} as never);
  }
  send(message: Parameters<typeof encodeMessage>[0]): void { this.socket.write(encodeMessage(message)); }
  async waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs = 15000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error('message not received');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

test('service: a notice survives detach, clears globally on attach, and ended sessions are reported once', {timeout: 60_000}, async () => {
  const runtimeDir = scratch('nmsh-nt-');
  const home = scratch('nmsh-nth-');
  const service = new SessionService({runtimeDir, startupIdleMs: 60_000});
  await service.start();
  const peers: Peer[] = [];
  try {
    const keeper = new Peer(service.socketPath); // keeps the service alive between peers
    peers.push(keeper);
    const first = new Peer(service.socketPath);
    peers.push(first);
    first.send({type: 'create', cwd: home, env: {HOME: home, PATH: process.env.PATH ?? '', ZDOTDIR: home}, columns: 80, rows: 24});
    const created = await first.waitFor(message => message.type === 'created');
    const sessionId = created.type === 'created' ? created.sessionId : '';
    await first.waitFor(message => message.type === 'prompt');
    first.send({type: 'input', data: '(exit 3)\r'});
    await first.waitFor(message => message.type === 'prompt' && message.exitCode === 3);
    first.socket.destroy();
    await new Promise(resolve => setTimeout(resolve, 100));

    const listed = await listSessionsWithNotices(service.socketPath);
    const own = listed.sessions.find(session => session.id === sessionId);
    assert.equal(own?.notice?.kind, 'failed', 'the notice is held by the service across detach');
    assert.equal(own?.notice?.exitCode, 3);

    const second = new Peer(service.socketPath);
    peers.push(second);
    second.send({type: 'attach', sessionId, columns: 80, rows: 24});
    await second.waitFor(message => message.type === 'attached');
    const afterFocus = await listSessionsWithNotices(service.socketPath);
    assert.equal(afterFocus.sessions.find(session => session.id === sessionId)?.notice, undefined, 'focusing clears it for every frontend');

    second.socket.destroy();
    await new Promise(resolve => setTimeout(resolve, 100));
    keeper.send({type: 'kill', sessionId});
    await keeper.waitFor(message => message.type === 'killed');
    const ended = await listSessionsWithNotices(service.socketPath);
    assert.equal(ended.ended.length, 1);
    assert.equal(ended.ended[0]!.kind, 'ended');
    await dismissNotice(service.socketPath, sessionId);
    assert.equal((await listSessionsWithNotices(service.socketPath)).ended.length, 0, 'dismiss clears ended notices too');
  } finally {
    for (const peer of peers) peer.socket.destroy();
    await service.close();
    rmSync(runtimeDir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  }
});
