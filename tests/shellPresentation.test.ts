import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {createWelcomeSnapshot, renderWelcome} from '../src/output/Welcome.js';
import {TranscriptStore} from '../src/sessions/TranscriptStore.js';
import {createShellPanel, renderShellPanel, shellBadges} from '../src/shell/ShellPanel.js';
import {NESTED_NMSH_MESSAGE} from '../src/shell/ShellHandoff.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';
import {InProcessSessionClient} from '../src/session/InProcessSessionClient.js';
import type {ShellId} from '../src/shell/adapters/ShellAdapter.js';
import {stripAnsi} from '../src/util/text.js';

const identity = {version: '0.7.0', commit: 'abc1234'};
const welcomeText = (shell: ShellId) => renderWelcome(createWelcomeSnapshot(identity, '/w', shell), 100).map(row => row.plain).join('\n');

test('welcome names the managed backend: zsh, fish and bash', () => {
  for (const shell of ['zsh', 'fish', 'bash'] as const) {
    assert.equal(createWelcomeSnapshot(identity, '/w', shell).shell, shell);
    assert.match(welcomeText(shell), new RegExp(`^\\s+.*\\b${shell}$`, 'mu'));
  }
  assert.equal(createWelcomeSnapshot(identity, '/w').shell, 'zsh', 'older callers keep zsh');
});

test('archived presentations keep their own shell identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-shellwelcome-'));
  try {
    const store = new TranscriptStore(dir);
    const archived = await store.archive({startCwd: '/w', finalCwd: '/w',
      transcript: {records: [], lines: [], visualGaps: [], lineTypes: [], welcome: createWelcomeSnapshot(identity, '/w', 'fish')}});
    assert.equal((await store.load(archived.id)).transcript.welcome?.shell, 'fish');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('/shell badges: current and default are text, distinct from the selection arrow', () => {
  assert.equal(shellBadges('zsh', {current: 'bash', defaultShell: 'zsh'}), '[default]');
  assert.equal(shellBadges('bash', {current: 'bash', defaultShell: 'zsh'}), '[current]');
  assert.equal(shellBadges('fish', {current: 'fish', defaultShell: 'fish'}), '[current] [default]');
  assert.equal(shellBadges('fish', {current: 'bash', defaultShell: 'zsh'}), '');
  const panel = createShellPanel([
    {adapter: shellAdapter('zsh'), executable: '/bin/zsh', version: 'zsh 5.9'},
    {adapter: shellAdapter('fish'), executable: '/usr/bin/fish', version: 'fish 4.0'},
    {adapter: shellAdapter('bash'), executable: '/bin/bash', version: 'GNU bash 5.2'},
  ], 'bash', 'zsh');
  panel.selected = 1;
  const rows = renderShellPanel(panel, 120).map(stripAnsi);
  assert.match(rows.find(row => row.includes('zsh 5.9'))!, /\[default\]$/u);
  assert.match(rows.find(row => row.includes('GNU bash'))!, /\[current\]\s*$/u);
  const fish = rows.find(row => row.includes('fish 4.0'))!;
  assert.doesNotMatch(fish, /\[current\]|\[default\]/u, 'the selected row is not marked current');
  assert.ok(rows.some(row => row.includes('[current] runs under this session · [default] starts new sessions')));
});

test('nested nmsh copy tells the user to run exit in a nested shell, not /exit', () => {
  const lines = NESTED_NMSH_MESSAGE.split('\n');
  assert.equal(lines[0], 'NMSh is already active in this managed shell.');
  assert.match(lines[1]!, /run `exit` to return to NMSh/u);
  assert.match(lines[2]!, /From the NMSh composer/u);
});

test('app: a fish default draws the first welcome as fish; /shell archives the view and welcomes the new backend in the same session', async () => {
  const client = new InProcessSessionClient({cwd: '/', columns: 100, rows: 30, shell: 'fish'}, () => ({
    pid: 1, isReady: true, on() {}, off() {}, removeAllListeners() {}, submit() {}, write() {}, resize() {}, kill() {}, interrupt() {},
  }) as never);
  const app = new TerminalApp({client, mode: 'in-process', shell: 'fish'});
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  try {
    assert.equal(app['output']['welcome']?.shell, 'fish');
    app['startupPending'] = false;
    app['session'].features.add('shell-switch');
    let archived = '';
    app['archiveCurrentPresentation'] = async () => { archived = app['output'].wrapped(200).map((row: {plain: string}) => row.plain).join('\n'); };
    app['session'].switchShell = async () => {};
    app['output'].addHistoryLine('OLD-OUTPUT');
    await app['switchShell']('zsh', '/shell zsh');
    assert.equal(app['shellId'], 'zsh');
    assert.match(archived, /OLD-OUTPUT[\s\S]*Switched this session from Fish to zsh\./u, 'the archived view ends with the transition');
    const now = app['output'].wrapped(200).map((row: {plain: string}) => row.plain).join('\n');
    assert.doesNotMatch(now, /OLD-OUTPUT/u, 'the new presentation starts fresh');
    assert.equal(app['output']['welcome']?.shell, 'zsh');
    assert.match(now, /Same session, now zsh/u);
  } finally { app['stop'](0); app['session'].kill(); }
});
