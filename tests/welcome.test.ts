import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {readBuildIdentity} from '../src/buildInfo.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {createWelcomeSnapshot, renderWelcome} from '../src/output/Welcome.js';
import {HistoryViewport} from '../src/output/viewport.js';
import {TranscriptStore} from '../src/sessions/TranscriptStore.js';
import {displayWidth} from '../src/util/text.js';

const identity = {version: '0.2.0', commit: 'abcdef0', branch: 'dev'};

test('fresh welcome shows compiled identity, start cwd, zsh, compact cat, and one divider', () => {
  const app = new TerminalApp();
  try {
    const transcript = app['output'].transcript();
    assert.deepEqual(transcript.welcome?.identity, readBuildIdentity());
    assert.equal(transcript.welcome?.cwd, process.cwd());
    assert.equal(transcript.welcome?.shell, 'zsh');
    assert.equal(transcript.lines.length, 0, 'welcome is not raw PTY output');
    const rows = app['output'].wrapped(80);
    assert.equal(rows.length, 5);
    assert.ok(rows[0]!.plain.includes(`NMSh ${readBuildIdentity().version}`));
    assert.match(rows[1]!.plain, /build /u);
    assert.match(rows[3]!.plain, /zsh/u);
    assert.match(rows[2]!.plain, /~\/Projects\/notMyShell|\/notMyShell/u);
    assert.equal(rows[4]!.plain, '─'.repeat(80));
    assert.ok(rows.every(row => row.lineIndex === undefined && !row.isLiveActivity));
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('welcome snapshots cwd and renders a compact pixel cat head with square eyes and whiskers', () => {
  const snapshot = createWelcomeSnapshot(identity, `${homedir()}/Projects/work`);
  const rows = renderWelcome(snapshot, 80);
  assert.match(rows[2]!.plain, /~\/Projects\/work/u);
  assert.match(rows[2]!.plain, /■/u);
  assert.doesNotMatch(rows[2]!.plain, /●|•/u);
  assert.match(rows[2]!.ansi, /38;2;27;24;37m■/u);
  assert.match(rows[0]!.plain, /▄██▄/u, 'ears are visible');
  assert.match(rows[2]!.plain, /─.*─/u, 'whiskers are visible');
  assert.doesNotMatch(rows.map(row => row.plain).join(''), /▝▀|▗██/u, 'the icon contains no body or tail');
  assert.match(rows[4]!.ansi, /38;2;105;98;130m/u);
  snapshot.cwd = '/tmp/changed';
  assert.match(rows[2]!.plain, /~\/Projects\/work/u);
});

test('welcome keeps every row inside narrow and wide viewports', () => {
  const snapshot = createWelcomeSnapshot(identity, '/a/very/long/directory/name');
  for (let width = 1; width <= 100; width += 1) {
    const rows = renderWelcome(snapshot, width);
    assert.equal(rows.length, 5, `width ${width}`);
    assert.ok(rows.every(row => displayWidth(row.plain) <= width), `width ${width}`);
    assert.ok(rows.every(row => !row.plain.includes('\n')), `width ${width}`);
  }
  assert.match(renderWelcome(snapshot, 20)[0]!.plain, /^NMSh 0\.2\.0/u);
  assert.doesNotMatch(renderWelcome(snapshot, 20)[0]!.plain, /▄/u);
});

test('welcome scrolls with ordinary history and stays outside command copy', () => {
  const output = new OutputBuffer();
  output.setWelcome(createWelcomeSnapshot(identity, '/tmp'));
  output.beginCommand('echo hello', ['❯ echo hello']);
  output.write('hello\n');
  output.complete(0);
  output.setCompletionLifecycle('Completed');
  const rows = output.wrapped(60);
  const viewport = new HistoryViewport();
  assert.ok(viewport.resolve(rows.length, 3) > 0);
  assert.ok(!rows.slice(viewport.start, viewport.start + 3).some(row => row.plain.includes('NMSh')));
  assert.equal(serializeCopyPayload(output.recent(1)!), 'hello\nCompleted');
  assert.ok(!output.transcript().lines.flat().some(cell => cell && 'text' in cell && cell.text.includes('NMSh')));
});

test('fresh welcome starts at transcript row zero and the first command follows its divider without a spacer', () => {
  const output = new OutputBuffer();
  output.setWelcome(createWelcomeSnapshot(identity, '/tmp'));
  output.beginCommand('echo first', ['❯ echo first']);
  output.write('first\n');
  output.complete(0);
  const rows = output.wrapped(80);
  const viewport = new HistoryViewport();
  assert.equal(viewport.resolve(rows.length, 20), 0);
  assert.match(rows[0]!.plain, /NMSh/u);
  assert.equal(rows[4]!.plain, '─'.repeat(80));
  assert.equal(rows[5]!.plain, '❯ echo first');
});

test('/clear begins a new welcome at live cwd; /resume restores the archived one without duplication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-welcome-'));
  const app = new TerminalApp();
  Object.defineProperty(app, 'transcriptStore', {value: new TranscriptStore(directory)});
  try {
    if (!app['session']['ready']) {
      await new Promise<void>(resolve => app['session'].once('prompt', () => resolve()));
    }
    const first = app['output'].transcript().welcome!;
    const liveShell = app['session'];
    app['shellCwd'] = '/tmp/new-location';
    await app['startFreshPresentation']();
    const fresh = app['output'].transcript();
    assert.equal(fresh.welcome?.cwd, '/tmp/new-location');
    assert.equal(fresh.lines.length, 0);
    assert.equal(app['session'], liveShell, 'the same zsh remains attached');
    const sessions = await new TranscriptStore(directory).list();
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0]?.transcript.welcome, first);
    app['resumeSessions'] = sessions;
    app['selectedSuggestion'] = 0;
    Object.defineProperty(app, 'render', {value: () => {}});
    await app['resumeSelectedSession']();
    assert.deepEqual(app['output'].transcript().welcome, first);
    assert.equal(app['output'].wrapped(80).filter(row => row.plain.includes('NMSh')).length, 1);
    assert.equal((await new TranscriptStore(directory).list()).length, 2, 'welcome-only current session is archived before resume');
  } finally {
    app['stop'](0);
    app['session'].kill();
    await rm(directory, {recursive: true, force: true});
  }
});
