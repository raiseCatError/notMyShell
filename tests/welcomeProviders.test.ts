import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {createWelcomeSnapshot, MIN_CAPTURED_WELCOME_WIDTH, renderWelcome} from '../src/output/Welcome.js';
import {captureWelcome, flattenTerminalOutput, WELCOME_PROVIDERS} from '../src/output/WelcomeProviders.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {clearProviderDetection, resolveCommand} from '../src/providers/providers.js';
import {TranscriptStore} from '../src/sessions/TranscriptStore.js';
import {createResumeBrowser} from '../src/sessions/ResumeBrowser.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const identity = {version: '0.5.0', commit: 'abcdef0', branch: 'dev'};

async function withFakeTool<T>(name: string, script: string, run: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-welcome-tool-'));
  try {
    const binary = join(directory, name);
    await writeFile(binary, `#!/bin/sh\n${script}\n`);
    await chmod(binary, 0o755);
    clearProviderDetection();
    return await run({...process.env, PATH: `${directory}:/usr/bin:/bin`});
  } finally {
    clearProviderDetection();
    await rm(directory, {recursive: true, force: true});
  }
}

test('providers: Vespyr is native and default, external presets are metadata, and None exists', () => {
  assert.deepEqual(WELCOME_PROVIDERS.map(provider => provider.id), ['vespyr', 'fastfetch', 'neofetch', 'macchina', 'zigfetch', 'none']);
  assert.equal(WELCOME_PROVIDERS[0]!.kind, 'native');
  assert.equal(WELCOME_PROVIDERS[2]!.legacy, true);
  assert.equal(WELCOME_PROVIDERS[2]!.install, undefined, 'archived tool is never offered for install');
  assert.equal(WELCOME_PROVIDERS[3]!.executable, 'macchina');
  assert.match(WELCOME_PROVIDERS[3]!.description, /maintenance mode/u);
  assert.equal(WELCOME_PROVIDERS[4]!.executable, 'zigfetch');
  assert.equal(normalizePromptConfiguration({}).welcome, 'vespyr');
  assert.equal(normalizePromptConfiguration({welcome: 'fastfetch'}).welcome, 'fastfetch');
  assert.equal(normalizePromptConfiguration({welcome: 'custom-script'}).welcome, 'vespyr');
});

test('flattening keeps SGR color, honors logo-side cursor moves, and drops other escapes', () => {
  const neofetchStyle = '\u001B[?25l\u001B[?7l\u001B[31mAA\u001B[0m\n\u001B[31mBB\u001B[0m\n\u001B[2A\u001B[9999999D\u001B[5Cuser@host\n\u001B[5COS: test\n\u001B[?25h\u001B[?7h';
  const lines = flattenTerminalOutput(neofetchStyle);
  assert.deepEqual(lines.map(stripAnsi), ['AA   user@host', 'BB   OS: test']);
  assert.match(lines[0]!, /\u001B\[31mAA/u);
  const image = 'logo\u001B_Gf=100;AAAA\u001B\\\u001B]0;title\u0007\u001B]1337;File=x\u0007 info\r\n';
  assert.deepEqual(flattenTerminalOutput(image).map(stripAnsi), ['logo info']);
  assert.deepEqual(flattenTerminalOutput('\n\n  \nwide 世界\n\n').map(stripAnsi), ['wide 世界']);
});

test('external presets use the shared argv adapter and user configuration', async () => {
  await withFakeTool('fastfetch', 'if [ "$1" = "--version" ]; then echo "fastfetch 2.0"; exit 0; fi\nprintf "\\033[32mlogo\\033[m  args:%s\\n" "$*"', async env => {
    const result = await captureWelcome('fastfetch', tmpdir(), env);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.lines.map(stripAnsi), ['logo  args:--pipe false']);
  });
  for (const name of ['macchina', 'zigfetch'] as const) {
    await withFakeTool(name, 'printf "tool:%s args:%s\\n" "$0" "$*"', async env => {
      const result = await captureWelcome(name, tmpdir(), env);
      assert.equal(result.ok, true);
      assert.equal(result.ok && stripAnsi(result.lines[0]!).endsWith(`/${name} args:`), true);
    });
  }
});

test('a hanging or missing fetch tool fails within the timeout instead of blocking', async () => {
  await withFakeTool('neofetch', 'if [ "$1" = "--version" ]; then echo "Neofetch 7.1.0"; exit 0; fi\nsleep 10', async env => {
    const started = Date.now();
    const result = await captureWelcome('neofetch', tmpdir(), env);
    assert.deepEqual(result, {ok: false, reason: 'timed out'});
    assert.ok(Date.now() - started < 4000);
  });
  clearProviderDetection();
  // Homebrew's standard prefixes are searched too, so "missing" needs a tool absent from both.
  if (!resolveCommand('fastfetch', '/nonexistent-nmsh')) {
    assert.deepEqual(await captureWelcome('fastfetch', tmpdir(), {PATH: '/nonexistent-nmsh'}), {ok: false, reason: 'not installed'});
  }
});

test('a missing selected provider falls back to the native welcome without blocking startup', async () => {
  const app = new TerminalApp();
  const originalPath = process.env.PATH;
  let rendered!: () => void;
  const didRender = new Promise<void>(resolve => { rendered = resolve; });
  Object.defineProperty(app, 'render', {value: rendered});
  app['promptConfiguration'].welcome = 'macchina';
  try {
    process.env.PATH = '/nonexistent-nmsh';
    app['startWelcome'](tmpdir());
    await didRender;
    assert.equal(app['output'].transcript().welcome?.provider, undefined, 'Vespyr is represented by the native snapshot');
    assert.equal(app['output'].transcript().welcome?.cwd, tmpdir());
  } finally {
    process.env.PATH = originalPath;
    app['stop'](0);
    app['session'].kill();
  }
});

test('captured welcome rows are clipped, hidden when narrow, and stay out of copy and commands', () => {
  const snapshot = {...createWelcomeSnapshot(identity, '/tmp'), provider: 'fastfetch' as const,
    captured: ['\u001B[32m' + 'x'.repeat(60) + '\u001B[0m', 'OS: test']};
  const rows = renderWelcome(snapshot, 40);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => displayWidth(row.plain) <= 40));
  assert.equal(rows.at(-1)!.plain, '─'.repeat(40));
  assert.deepEqual(renderWelcome(snapshot, MIN_CAPTURED_WELCOME_WIDTH - 1), []);

  const output = new OutputBuffer();
  output.setWelcome(snapshot);
  output.beginCommand('echo hi', ['echo hi']);
  output.write('hi\r\n');
  const record = output.complete(0)!;
  assert.equal(serializeCopyPayload(record).includes('OS: test'), false);
  assert.equal(output.transcript().records.length, 1);
  assert.deepEqual(output.transcript().welcome?.captured, snapshot.captured);
});

test('/resume keeps the archived external welcome and a late capture never overwrites it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-welcome-resume-'));
  const app = new TerminalApp();
  Object.defineProperty(app, 'transcriptStore', {value: new TranscriptStore(directory)});
  Object.defineProperty(app, 'render', {value: () => {}});
  try {
    const archived = {...createWelcomeSnapshot(identity, '/tmp/a'), provider: 'fastfetch' as const, captured: ['archived logo']};
    app['output'].setWelcome(archived);
    await app['startFreshPresentation']();
    app['resumeBrowser'] = createResumeBrowser(await new TranscriptStore(directory).listSummaries());
    app['promptConfiguration'].welcome = 'none';
    app['startWelcome']('/tmp/b');
    await app['resumeSelectedSession']();
    assert.deepEqual(app['output'].transcript().welcome, archived);
    const loaded = (await new TranscriptStore(directory).list()).find(session => session.transcript.welcome?.captured);
    assert.deepEqual(loaded?.transcript.welcome?.captured, ['archived logo'], 'journal round-trips the capture');
  } finally {
    app['stop'](0);
    app['session'].kill();
    await rm(directory, {recursive: true, force: true});
  }
});
