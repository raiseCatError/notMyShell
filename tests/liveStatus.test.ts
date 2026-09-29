import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionEvidence} from '../src/session/SessionEvidence.js';
import {commandWord, knownProgram, liveStatusParts} from '../src/session/liveStatus.js';
import {decodeMessage, encodeMessage, type SessionInfo} from '../src/session/SessionProtocol.js';
import {formatSessionList} from '../src/session/sessionList.js';
import {describeLiveSession} from '../src/sessions/ResumeBrowser.js';

const NOW = 10_000_000;
const info = (extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({id: 's1', pid: 42, state: 'detached', cwd: '/w/project', createdAt: NOW - 3_600_000, ...extra});

test('evidence: output recency, program title, and attention only while a command runs', () => {
  const evidence = new SessionEvidence();
  evidence.observe('\u0007', 1);
  assert.equal(evidence.snapshot().attentionSince, undefined, 'a bell at the prompt is not a program asking for attention');
  evidence.onExec();
  evidence.observe('hello', 100);
  assert.equal(evidence.snapshot().lastOutputAt, 100);
  // A title split across reads, terminated by BEL: the BEL ends the OSC and is not a bell.
  evidence.observe('\u001b]0;Agent ✳ ', 200);
  evidence.observe('working on tests\u0007', 210);
  assert.equal(evidence.snapshot().title, 'Agent ✳ working on tests');
  assert.equal(evidence.snapshot().attentionSince, undefined);
  evidence.observe('\u001b]9;4;1;50\u0007', 300);
  assert.equal(evidence.snapshot().attentionSince, undefined, 'OSC 9;4 is a progress report, not a notification');
  evidence.observe('\u001b]2;bad\u0001title\u001b\\', 310);
  assert.equal(evidence.snapshot().title, 'badtitle', 'ST-terminated; control characters are removed from titles');
  evidence.observe('\u001b]2;broken\u001b[31m red\r\n', 320);
  assert.equal(evidence.snapshot().title, 'badtitle', 'a malformed OSC is not taken as a title');
  evidence.observe('\u001b]777;notify;Agent;Ready for input\u0007', 400);
  assert.equal(evidence.snapshot().attentionSince, 400);
  evidence.observe('\u0007', 500);
  assert.equal(evidence.snapshot().attentionSince, 400, 'the first request is kept');
  evidence.onInput();
  assert.equal(evidence.snapshot().attentionSince, undefined, 'typing into the session clears it');
  evidence.observe('\u001b]9;Done\u0007', 600);
  assert.equal(evidence.snapshot().attentionSince, 600, 'OSC 9 notification');
  evidence.observe('\u0007', 700);
  evidence.onPrompt(3);
  assert.deepEqual(evidence.snapshot(), {lastOutputAt: 700, lastExit: 3}, 'the command ended: title and attention reset');
  evidence.onExec();
  evidence.observe(`\u001b]0;${'x'.repeat(200)}\u0007`, 800);
  assert.equal(evidence.snapshot().title!.length, 80, 'titles are bounded');
});

test('status for ordinary and non-agent commands is factual and never names an agent', () => {
  assert.deepEqual(liveStatusParts(info({idleSince: NOW - 180_000}), NOW), ['idle 3m']);
  assert.deepEqual(liveStatusParts(info({idleSince: NOW - 5_000, lastExit: 0}), NOW), ['idle 5s', 'last command succeeded']);
  assert.deepEqual(liveStatusParts(info({idleSince: NOW, lastExit: 2}), NOW), ['idle 0s', 'last command failed (exit 2)']);
  const build = liveStatusParts(info({running: 'npm test', runningSince: NOW - 90_000, process: 'node', lastOutputAt: NOW - 2_000}), NOW);
  assert.deepEqual(build, ['running npm test · 1m', 'process node', 'active']);
  const quiet = liveStatusParts(info({running: 'make', runningSince: NOW - 600_000, process: 'make', lastOutputAt: NOW - 300_000}), NOW);
  assert.deepEqual(quiet, ['running make · 10m', 'quiet 5m'], 'no process clause when it is the command itself');
  const vim = liveStatusParts(info({running: 'vim notes.md', runningSince: NOW - 60_000, process: 'vim', fullscreen: 1,
    lastOutputAt: NOW - 30_000, title: 'notes.md (~/w) - VIM'}), NOW);
  assert.deepEqual(vim, ['running vim notes.md · 1m', 'quiet 30s', 'fullscreen', '“notes.md (~/w) - VIM”']);
  assert.deepEqual(liveStatusParts(info({running: 'sleep 99', runningSince: NOW}), NOW), ['running sleep 99 · 0s'],
    'no output evidence: nothing claimed');
});

test('known CLIs are labelled from the command or the foreground process, with the same states as any program', () => {
  assert.equal(commandWord('FOO=1 BAR=2 /opt/bin/claude --resume'), 'claude');
  assert.equal(knownProgram(info({running: 'claude'})), 'Claude Code');
  assert.equal(knownProgram(info({running: 'npx codex', process: 'codex'})), 'Codex');
  assert.equal(knownProgram(info({running: 'npm test', process: 'node'})), undefined);
  const waiting = liveStatusParts(info({running: 'claude', runningSince: NOW - 600_000, process: 'node', fullscreen: 1,
    lastOutputAt: NOW - 1_000, attentionSince: NOW - 120_000, title: '✳ Claude Code'}), NOW);
  assert.deepEqual(waiting, ['running claude · 10m', 'Claude Code', 'needs attention 2m', 'fullscreen', '“✳ Claude Code”']);
  const custom = liveStatusParts(info({running: 'my-agent --task x', runningSince: NOW, lastOutputAt: NOW, process: 'python3'}), NOW);
  assert.deepEqual(custom, ['running my-agent --task x · 0s', 'process python3', 'active'], 'unrecognized agents still get evidence, just no name');
  for (const parts of [waiting, custom]) {
    assert.ok(!parts.some(part => /thinking|approval|waiting for input|stuck/iu.test(part)), 'never claims intent');
  }
});

test('/resume rows and nmsh --list show the status; the new fields round-trip and are optional', () => {
  const session = info({state: 'attached', running: 'codex', runningSince: NOW - 60_000, lastOutputAt: NOW - 20_000, attentionSince: NOW - 5_000});
  assert.equal(describeLiveSession(session, NOW),
    '/w/project · attached in another window · running codex · 1m · Codex · needs attention 5s · started 1h 0m ago');
  assert.match(formatSessionList([session], NOW), /s1 {2}attached {2}pid 42 {2}age 1h 0m {2}\/w\/project {2}running codex · 1m · Codex · needs attention 5s/);
  const full: SessionInfo = {...session, process: 'node', fullscreen: 1, title: 't', lastExit: 1};
  const message = {type: 'sessions' as const, sessions: [full, info()]};
  const decoded = decodeMessage(encodeMessage(message).trimEnd());
  assert.deepEqual(decoded, {ok: true, message});
  const legacy = decodeMessage(JSON.stringify({v: 2, type: 'sessions', sessions: [{id: 'old', pid: 1, state: 'detached', cwd: '/', createdAt: 1}]}));
  assert.equal(legacy.ok, true, 'an older service without evidence still decodes');
});

test('end to end: a CLI’s own title and notification reach /resume across detach, and typing after reattach clears attention', async () => {
  const {LiveSandbox, until} = await import('./helpers/liveFrontend.js');
  const {mkdirSync, writeFileSync, chmodSync} = await import('node:fs');
  const {join} = await import('node:path');
  const sandbox = new LiveSandbox();
  const bin = join(sandbox.home, 'bin');
  mkdirSync(bin);
  // Named like a known agent; it only prints, sets a title, notifies, and reads a line.
  writeFileSync(join(bin, 'claude'), [
    '#!/bin/sh',
    "printf '\\033]0;Fake agent: ready\\007'",
    "printf 'FAKE-AGENT-UP\\n'",
    "printf '\\033]777;notify;Fake agent;Ready\\007'",
    'read line',
    'echo "GOT-$line"',
  ].join('\n'));
  chmodSync(join(bin, 'claude'), 0o755);
  try {
    const a = sandbox.launch();
    await a.waitFor(/❯/);
    await a.run(`export PATH="${bin}:$PATH"`, /❯/);
    await a.run('claude', /FAKE-AGENT-UP/);
    await until(async () => (await sandbox.sessions())[0]?.attentionSince !== undefined, 15000, 'attention recorded');
    const [live] = await sandbox.sessions();
    assert.equal(live!.running?.includes('claude'), true);
    assert.equal(live!.title, 'Fake agent: ready');
    assert.equal(knownProgram(live!), 'Claude Code');
    a.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
    assert.notEqual((await sandbox.sessions())[0]!.attentionSince, undefined, 'survives the detach');

    const viewer = sandbox.launch(['--new']);
    await viewer.waitFor(/❯/);
    // Wait for the command to finish: /resume is refused while one runs.
    await viewer.run('sleep 30 & echo BG-STARTED', /BG-STARTED[\s\S]*Completed/);
    const mark = viewer.mark;
    viewer.pty.write('/resume\r');
    await viewer.waitFor(/Claude Code · needs attention[\s\S]*Fake agent: ready/, mark);
    viewer.pty.write('\u001b');

    const b = sandbox.launch(['--attach', live!.id]);
    // A known interactive CLI reattaches straight into passthrough, so wait on the service, not NMSh's UI.
    await until(async () => (await sandbox.sessions()).find(candidate => candidate.id === live!.id)?.state === 'attached', 15000, 'reattached');
    // Entering passthrough turns NMSh's own bracketed paste off; only then does typing reach the program.
    await until(() => b.output.includes('\u001b[?2004l'), 15000, 'passthrough');
    b.pty.write('hello\r');
    await b.waitFor(/GOT-hello/);
    await until(async () => {
      const session = (await sandbox.sessions()).find(candidate => candidate.id === live!.id);
      return session !== undefined && session.running === undefined && session.lastExit === 0 && session.attentionSince === undefined;
    }, 15000, 'command ended; attention cleared; last exit recorded');
  } finally {
    await sandbox.dispose();
  }
});
