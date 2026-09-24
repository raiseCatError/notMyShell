import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {readBuildIdentity} from '../src/buildInfo.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {createWelcomeSnapshot, renderWelcome, WELCOME_BLINK_CLOSED_MS, WELCOME_BLINK_GAPS_MS, welcomeBlinkDelay} from '../src/output/Welcome.js';
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
    const version = readBuildIdentity().version;
    assert.ok(rows[0]!.plain.includes(`notMyShell ${/^\d/u.test(version) ? 'v' : ''}${version}`));
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

test('welcome snapshots cwd and renders a compact full-body cat with square eyes and whiskers', () => {
  const snapshot = createWelcomeSnapshot(identity, `${homedir()}/Projects/work`);
  const rows = renderWelcome(snapshot, 80);
  assert.match(rows[2]!.plain, /~\/Projects\/work/u);
  assert.match(rows[0]!.plain, /^ █▄▄▄█ /u, 'ears frame the head');
  assert.match(rows[1]!.plain, /^=█████=/u, 'whiskers flank the face');
  assert.match(rows[1]!.ansi, /38;2;22;18;32m█/u, 'dark rectangular eyes');
  assert.match(rows[1]!.plain, /▄▀/u, 'raised tail');
  assert.match(rows[3]!.plain, /^  █▀█▀▀▀▀█▀█/u, 'four legs under the body');
  for (const row of rows.slice(0, 4)) {
    assert.equal(displayWidth(row.plain.slice(0, 14)), 14);
    assert.match(row.plain.slice(14), /^ {2}\S/u, 'metadata column aligns two cells right of the cat');
  }
  assert.match(rows[4]!.ansi, /38;2;105;98;130m/u);
  snapshot.cwd = '/tmp/changed';
  assert.match(rows[2]!.plain, /~\/Projects\/work/u);
});

test('welcome wordmark spells notMyShell with only My in brand lavender #A67CF3 and a gray version', () => {
  const rows = renderWelcome(createWelcomeSnapshot(identity, '/tmp'), 80);
  assert.match(rows[0]!.plain, / {2}notMyShell v0\.2\.0$/u);
  assert.doesNotMatch(rows.map(row => row.plain).join('\n'), /NMSh|NMSH|nmsh/u);
  const primary = '38;2;242;240;236m';
  assert.ok(rows[0]!.ansi.includes(`\u001B[1m\u001B[${primary}not\u001B[1m\u001B[38;2;166;124;243mMy\u001B[1m\u001B[${primary}Shell`), 'bold wordmark');
  assert.match(rows[0]!.ansi, /\u001B\[22m\u001B\[38;2;125;133;144m v0\.2\.0/u, 'version is not bold');
  assert.ok(rows.slice(1, 4).every(row => !row.ansi.includes('\u001B[1m')), 'metadata stays quiet');
  assert.doesNotMatch(rows[0]!.ansi, /172;252;115/u, 'the mistaken green is gone');
  assert.match(rows[0]!.ansi, /38;2;125;133;144m v0\.2\.0/u);
  assert.match(rows[1]!.plain, /build abcdef0 · dev$/u);
});

test('welcome keeps every row inside narrow and wide viewports', () => {
  const snapshot = createWelcomeSnapshot(identity, '/a/very/long/directory/name');
  for (let width = 1; width <= 100; width += 1) {
    const rows = renderWelcome(snapshot, width);
    assert.equal(rows.length, 5, `width ${width}`);
    assert.ok(rows.every(row => displayWidth(row.plain) <= width), `width ${width}`);
    assert.ok(rows.every(row => !row.plain.includes('\n')), `width ${width}`);
  }
  assert.match(renderWelcome(snapshot, 20)[0]!.plain, /^notMyShell v0\.2\.0/u);
  assert.doesNotMatch(renderWelcome(snapshot, 20)[0]!.plain, /▄/u);
  assert.equal(renderWelcome(snapshot, 8)[0]!.plain, 'notMySh…');
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
  assert.ok(!rows.slice(viewport.start, viewport.start + 3).some(row => row.plain.includes('notMyShell')));
  assert.equal(serializeCopyPayload(output.recent(1)!), 'hello\nCompleted');
  assert.ok(!output.transcript().lines.flat().some(cell => cell && 'text' in cell && cell.text.includes('notMyShell')));
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
  assert.match(rows[0]!.plain, /notMyShell/u);
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
    assert.equal(app['output'].wrapped(80).filter(row => row.plain.includes('notMyShell ')).length, 1);
    assert.equal((await new TranscriptStore(directory).list()).length, 2, 'welcome-only current session is archived before resume');
  } finally {
    app['stop'](0);
    app['session'].kill();
    await rm(directory, {recursive: true, force: true});
  }
});

test('cat blink changes only the eye cells: same rows, widths, and metadata', () => {
  const snapshot = createWelcomeSnapshot(identity, '/tmp');
  const open = renderWelcome(snapshot, 80);
  const blink = renderWelcome(snapshot, 80, 'blink');
  assert.equal(blink.length, open.length);
  for (let index = 0; index < open.length; index += 1) {
    assert.equal(displayWidth(blink[index]!.plain), displayWidth(open[index]!.plain), `row ${index} width`);
    if (index !== 1) assert.equal(blink[index]!.plain, open[index]!.plain, `row ${index} unchanged`);
  }
  const changed = [...open[1]!.plain].flatMap((glyph, column) => glyph === [...blink[1]!.plain][column] ? [] : [column]);
  assert.deepEqual(changed, [2, 4], 'only the two eye cells change');
  assert.equal([...blink[1]!.plain][2], '▂', 'closed lid');
  assert.match(blink[1]!.ansi, /38;2;22;18;32m\u001B\[48;2;172;150;230m▂/u, 'dark slit on the lavender face');
  assert.deepEqual(renderWelcome(snapshot, 30, 'blink'), renderWelcome(snapshot, 30), 'narrow widths hide the cat in every frame');
});

test('cat blinks are occasional and deterministic, and the frame is never persisted', () => {
  assert.equal(welcomeBlinkDelay(0), welcomeBlinkDelay(WELCOME_BLINK_GAPS_MS.length));
  assert.ok(WELCOME_BLINK_GAPS_MS.every(gap => gap >= 5000), 'calm, not a looping GIF');
  assert.ok(WELCOME_BLINK_CLOSED_MS <= 200);
  const output = new OutputBuffer();
  output.setWelcome(createWelcomeSnapshot(identity, '/tmp'));
  output.setWelcomeFrame('blink');
  assert.match(output.wrapped(80)[1]!.plain, /▂/u);
  assert.equal(JSON.stringify(output.transcript()).includes('blink'), false);
  output.setWelcomeFrame('open');
  assert.doesNotMatch(output.wrapped(80)[1]!.plain, /▂/u);
});

test('welcome blink timer is owned by the app and disposed on stop', () => {
  const app = new TerminalApp();
  try {
    app['scheduleWelcomeBlink']();
    assert.ok(app['welcomeBlinkTimer'], 'one pending blink');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
  assert.equal(app['welcomeBlinkTimer'], undefined);
});
