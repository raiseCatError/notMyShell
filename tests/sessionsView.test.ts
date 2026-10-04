import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {createResumeBrowser, createSessionsView, resumeSelection, visibleResumeSessions} from '../src/sessions/ResumeBrowser.js';
import {liveSessionRows} from '../src/sessions/LiveSessionView.js';
import {formatSessionList} from '../src/session/sessionList.js';
import {parseSlashCommand, slashSuggestions} from '../src/commands/slashCommands.js';
import type {SessionInfo} from '../src/session/SessionProtocol.js';
import type {TranscriptSummary} from '../src/sessions/TranscriptStore.js';
import {stripAnsi} from '../src/util/text.js';

const NOW = 10_000_000;
const info = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({id, pid: 1, state: 'detached', cwd: `/w/${id}`, createdAt: NOW - 60_000, idleSince: NOW - 5000, ...extra});
const archive: TranscriptSummary = {id: 'j1', createdAt: new Date(NOW).toISOString(), commandCount: 1, startCwd: '/w', finalCwd: '/w', project: 'p', pinned: false, journaled: true};

test('shared model: ordinals by start time, this window, backend labels, factual state and agent', () => {
  const rows = liveSessionRows([
    info('b', {createdAt: NOW - 1000, shell: 'fish', running: 'claude', runningSince: NOW - 240_000, lastOutputAt: NOW - 100}),
    info('a', {createdAt: NOW - 9000, state: 'attached', shell: 'zsh'}),
    info('c', {createdAt: NOW - 5000, shell: 'bash', lastExit: 2, notice: {sessionId: 'c', kind: 'failed', at: NOW, exitCode: 2}}),
    info('d', {createdAt: NOW - 3000}),
  ], 'a', NOW);
  assert.deepEqual(rows.map(row => [row.session.id, row.ordinal, row.current, row.shell, row.state]),
    [['a', 1, true, 'zsh', 'idle'], ['c', 2, false, 'Bash', 'failed'], ['d', 3, false, 'zsh', 'idle'], ['b', 4, false, 'Fish', 'active']]);
  assert.equal(rows[3]!.agent?.short, 'Claude');
  assert.match(rows[0]!.summary, /this window/u);
  assert.match(rows[1]!.summary, /detached · age .* · notice: failed$/u);
  assert.match(formatSessionList([info('x', {shell: 'fish'})], NOW), /shell fish/u, 'nmsh --sessions reports the same backend fact');
});

test('/sessions is live-only; /resume keeps archives', () => {
  const view = createSessionsView([info('a'), info('b')], 'a');
  assert.deepEqual(visibleResumeSessions(view), [], 'archived-only sessions never appear in /sessions');
  assert.equal(resumeSelection(view)?.kind, 'live');
  const resume = createResumeBrowser([archive], [info('b')]);
  assert.equal(visibleResumeSessions(resume).length, 1, '/resume still lists archived transcripts');
  assert.deepEqual(parseSlashCommand('/sessions'), {kind: 'sessions'});
  assert.ok(slashSuggestions('/sess').some(item => item.name === '/sessions'));
});

function app(mode: 'service' | 'in-process' = 'service'): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 140, rows: 40})});
  Object.defineProperty(instance, 'render', {value: () => {}});
  instance['sessionMode'] = mode;
  instance['startupPending'] = false;
  return instance;
}
const transcript = (instance: TerminalApp) => instance['output'].wrapped(200).map((row: {plain: string}) => row.plain).join('\n');

test('app: current session is a no-op, attached elsewhere is refused, detached switches (attach clears its notice in the service), kill stays guarded', () => {
  const instance = app();
  try {
    instance['sessionId'] = 'a';
    let detached = false;
    instance['session'].detach = () => { detached = true; };
    instance['resumeBrowser'] = createSessionsView([info('a', {state: 'attached'}), info('b', {state: 'attached', createdAt: NOW - 1}), info('c', {createdAt: NOW})], 'a');
    const text = stripAnsi(instance['sessionsViewRows'](instance['resumeBrowser'], 140).join('\n'));
    assert.match(text, /Sessions {2}live now/u);
    assert.match(text, /● this +zsh/u);
    assert.match(text, /#2 +zsh/u);
    instance['handleKey']({kind: 'enter'});
    assert.match(transcript(instance), /this window's session; nothing to switch/u);
    assert.equal(detached, false);
    instance['resumeBrowser'] = createSessionsView([info('a', {state: 'attached'}), info('b', {state: 'attached', createdAt: NOW - 1})], 'a');
    instance['handleKey']({kind: 'down'});
    instance['handleKey']({kind: 'enter'});
    assert.match(transcript(instance), /attached in another NMSh window; it was not taken over/u);
    assert.equal(detached, false, 'another frontend\'s session is never stolen');
    instance['resumeBrowser'] = createSessionsView([info('a', {state: 'attached'}), info('c', {createdAt: NOW})], 'a');
    instance['handleKey']({kind: 'deleteLineAfter'});
    assert.equal(instance['resumeBrowser'].confirmKill, undefined, 'the current session cannot be killed from here');
    instance['handleKey']({kind: 'down'});
    instance['handleKey']({kind: 'deleteLineAfter'});
    assert.equal(instance['resumeBrowser'].confirmKill, 'c', 'a detached session gets the existing guarded kill');
    instance['handleKey']({kind: 'escape'});
    instance['handleKey']({kind: 'enter'});
    assert.equal(instance['switchTarget'], 'c', 'a detached session is attached through the existing safe path');
    assert.equal(detached, true);
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('app: in-process mode explains there is no session service; empty list says so', async () => {
  const local = app('in-process');
  try {
    await local['openSessionsView']();
    assert.equal(local['resumeBrowser'], undefined);
    assert.match(transcript(local), /in-process \(no session service\)/u);
  } finally { local['stop'](0); local['session'].kill(); }
  const empty = app();
  try {
    empty['resumeBrowser'] = createSessionsView([], undefined);
    assert.match(stripAnsi(empty['sessionsViewRows'](empty['resumeBrowser'], 120).join('\n')), /No live NMSh sessions\./u);
  } finally { empty['stop'](0); empty['session'].kill(); }
});
