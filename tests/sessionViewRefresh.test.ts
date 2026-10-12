import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {createServer, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {encodeMessage, FrameDecoder, PROTOCOL_VERSION, type ClientMessage, type SessionInfo} from '../src/session/SessionProtocol.js';
import {RUNTIME_DIR_ENV, socketPathFor} from '../src/session/runtimeDir.js';
import type {SessionNotice} from '../src/session/SessionNotices.js';
import {resumeSelection} from '../src/sessions/ResumeBrowser.js';
import {stripAnsi} from '../src/util/text.js';

for (const notices of [true, false]) {
  test(`live session refresh recovers waiting state and keeps selection, query, draft and focus (notices ${notices ? 'on' : 'off'})`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-live-view-')));
    const previous = process.env[RUNTIME_DIR_ENV];
    process.env[RUNTIME_DIR_ENV] = root;
    const peers = new Set<Socket>();
    const own: SessionInfo = {id: 'own', pid: 4241, state: 'attached', cwd: '/fixture', createdAt: 1};
    const target: SessionInfo = {id: 'target', pid: 4242, state: 'attached', cwd: '/fixture/project', createdAt: 20, running: 'python3 askyn.py'};
    let sessions = [own, target];
    let ended: SessionNotice[] = [];
    let failList = false;
    const server = createServer(socket => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      const decoder = new FrameDecoder();
      socket.on('data', chunk => {
        for (const result of decoder.push(String(chunk))) {
          if (!result.ok) continue;
          const message = result.message as ClientMessage;
          if (message.type === 'hello') socket.write(encodeMessage({type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd'}));
          if (message.type === 'list') {
            if (failList) socket.destroy();
            else socket.end(encodeMessage({type: 'sessions', sessions, ended}));
          }
        }
      });
    });
    await new Promise<void>(resolve => server.listen(socketPathFor(root), resolve));
    let app: TerminalApp | undefined;
    try {
      app = new TerminalApp();
      Object.defineProperty(app, 'sessionMode', {value: 'service'});
      app['sessionId'] = own.id;
      app['configuration'] = {...app['configuration'], sessionNotices: notices};
      let renders = 0;
      Object.defineProperty(app, 'render', {value: () => { renders += 1; }});
      await app['openSessionsView']();
      const browser = app['resumeBrowser']!;
      browser.query = 'python3';
      browser.selectedIndex = 0;
      app['editor'].insert('preserved draft');
      app['focusedCommandIndex'] = 4;
      const rows = () => app!['sessionsViewRows'](browser, 200).map(stripAnsi).join('\n');
      assert.equal(resumeSelection(browser)?.session.id, target.id);
      assert.match(rows(), /Running/u, 'the opening snapshot contains a temporary non-waiting state');
      sessions = [own, {...target, inputSince: Date.now() - 5_000, inputConfidence: 'confirmed', inputMode: 'key', inputPrompt: 'First question. Fix<y>?'},
        {...target, id: 'earlier', pid: 4243, createdAt: 10}];
      const before = renders;
      await app['refreshNotices']();
      assert.match(rows(), /Waiting for input[\s\S]*First question\. Fix<y>\?/u,
        'a later authenticated list recovers the wait without reopening the view');
      assert.equal(app['resumeBrowser'], browser);
      assert.equal(resumeSelection(browser)?.session.id, target.id, 'selection follows identity when another row appears before it');
      assert.equal(browser.selectedIndex, 1);
      assert.equal(browser.query, 'python3');
      assert.equal(app['editor'].text, 'preserved draft');
      assert.equal(app['focusedCommandIndex'], 4);
      assert.ok(renders > before, 'live data repaints even when no notice changes');
      const validated = browser.live;
      failList = true;
      await app['refreshNotices']();
      assert.equal(browser.live, validated, 'a failed request is not an authenticated empty registry');
      assert.equal(resumeSelection(browser)?.session.id, target.id, 'transient failures retain selected identity');
      assert.equal(browser.query, 'python3');
      assert.equal(app['editor'].text, 'preserved draft');
      failList = false;
      sessions = [own, {...target, state: 'detached'}];
      await app['refreshNotices']();
      browser.confirmKill = target.id;
      await app['refreshNotices']();
      assert.equal(browser.confirmKill, target.id, 'a still-detached target keeps its explicit confirmation');
      sessions = [own, target];
      await app['refreshNotices']();
      assert.equal(browser.confirmKill, undefined, 'attaching elsewhere withdraws the stale kill confirmation');
      browser.confirmKill = target.id;
      sessions = [own];
      ended = [{sessionId: 'ended', kind: 'ended', at: Date.now(), exitCode: 1}];
      await app['refreshNotices']();
      assert.equal(browser.confirmKill, undefined, 'a vanished target cannot retain confirmation');
      assert.equal(browser.selectedIndex, 0);
      assert.equal(resumeSelection(browser), undefined);
      assert.equal(app['noticeView'].notices.length, notices ? 1 : 0, 'live viewing respects the notice preference');
      if (!notices) assert.equal(app['noticeExpiry'], undefined, 'suppressed notices schedule no expiry wake-up');
      sessions = [];
      await app['refreshNotices']();
      assert.deepEqual(browser.live, [], 'a successfully validated empty registry does remove the old snapshot');
      assert.equal(resumeSelection(browser), undefined);
      assert.equal(app['editor'].text, 'preserved draft');
      assert.equal(app['focusedCommandIndex'], 4);
    } finally {
      app?.['stop'](0);
      app?.['session'].kill();
      for (const peer of peers) peer.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (previous === undefined) delete process.env[RUNTIME_DIR_ENV]; else process.env[RUNTIME_DIR_ENV] = previous;
      rmSync(root, {recursive: true, force: true});
    }
  });
}

test('live session view uses the existing poll with notices off, then releases it when closed or raw-owned', () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'sessionMode', {value: 'service'});
  let polls = 0;
  Object.defineProperty(app, 'refreshNotices', {value: async () => { polls += 1; }});
  try {
    app['configuration'] = {...app['configuration'], sessionNotices: false};
    app['presentationStarted'] = true;
    app['resumeBrowser'] = {live: [], sessions: [], commandText: new Map(), query: '', week: 0, selectedIndex: 0, indexing: false, liveOnly: true};
    app['syncNotices']();
    assert.ok(app['noticeTimer'], 'explicit live viewing remains current without enabling notices');
    assert.equal(polls, 1);
    app['resumeBrowser'] = undefined;
    app['syncNotices']();
    assert.equal(app['noticeTimer'], undefined, 'closed views do not keep polling with notices off');
    app['resumeBrowser'] = {live: [], sessions: [], commandText: new Map(), query: '', week: 0, selectedIndex: 0, indexing: false, liveOnly: true};
    app['syncNotices']();
    app['passthrough'] = true;
    app['syncNotices']();
    assert.equal(app['noticeTimer'], undefined, 'raw foreground ownership suspends the poll');
  } finally {
    app['passthrough'] = false;
    app['stop'](0);
    app['session'].kill();
  }
});
