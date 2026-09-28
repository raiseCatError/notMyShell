import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {environmentFor, resolveCommand} from '../src/providers/providers.js';
import {TaskProgress} from '../src/status/TaskProgress.js';
import {WELCOME_PROVIDERS} from '../src/output/WelcomeProviders.js';
import {SUGGESTION_PROVIDERS} from '../src/suggestions/types.js';
import {rowForTerminal, TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {CHAT_MIN_WIDTH} from '../src/output/TranscriptPresenter.js';
import {createPalette, filterPalette, handlePaletteKey, reconcilePaletteViewport, renderPalette} from '../src/ui/CommandPalette.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

async function fakeTool(directory: string, name: string, script: string): Promise<string> {
  await mkdir(directory, {recursive: true});
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
  return path;
}

// ---- Bug 1: Homebrew resolution ----

test('resolveCommand: PATH first, then Apple Silicon / Intel Homebrew prefixes, else missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nmsh-resolve-'));
  try {
    const appleSilicon = join(root, 'opt/homebrew/bin');
    const intel = join(root, 'usr/local/bin');
    const onPath = join(root, 'custom/bin');
    const armBrew = await fakeTool(appleSilicon, 'brew', 'exit 0');
    const intelBrew = await fakeTool(intel, 'brew', 'exit 0');
    assert.equal(resolveCommand('brew', '/nonexistent', [appleSilicon, intel]), armBrew, 'GUI PATH without Homebrew still finds Apple Silicon brew');
    assert.equal(resolveCommand('brew', '/nonexistent', [intel]), intelBrew, 'Intel Homebrew prefix');
    const pathBrew = await fakeTool(onPath, 'brew', 'exit 0');
    assert.equal(resolveCommand('brew', onPath, [appleSilicon]), pathBrew, 'a valid PATH entry wins');
    assert.equal(resolveCommand('brew', '/nonexistent', [join(root, 'empty')]), undefined, 'genuinely missing');
    assert.match(environmentFor(armBrew, {PATH: '/usr/bin'}).PATH!, new RegExp(`^${appleSilicon}:`, 'u'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('TaskProgress spawns the resolved binary with argv and reports a factual missing-tool error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nmsh-task-'));
  const previous = process.env.PATH;
  try {
    const bin = join(root, 'bin');
    await fakeTool(bin, 'nmsh-fake-brew', `printf '%s\\n' "$@" > "${join(root, 'argv')}"`);
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    const ok = await new TaskProgress('x', () => {}).run('nmsh-fake-brew', ['install', 'a; rm -rf /', '$(whoami)']);
    assert.equal(ok.status, 'succeeded');
    assert.deepEqual((await readFile(join(root, 'argv'), 'utf8')).trim().split('\n'), ['install', 'a; rm -rf /', '$(whoami)'],
      'argv stays separate; no shell interpretation');
    const missing = await new TaskProgress('x', () => {}).run('nmsh-no-such-tool', []);
    assert.equal(missing.status, 'failed');
    assert.match(missing.error!, /nmsh-no-such-tool was not found on PATH or in \/opt\/homebrew\/bin/u);
    assert.doesNotMatch(missing.error!, /ENOENT/u);
  } finally {
    process.env.PATH = previous;
    await rm(root, {recursive: true, force: true});
  }
});

test('Fastfetch, Deja and Starship all install through the same brew command; Neofetch has no recipe', async () => {
  const fastfetch = WELCOME_PROVIDERS.find(provider => provider.id === 'fastfetch')!;
  const deja = SUGGESTION_PROVIDERS.find(provider => provider.id === 'deja')!;
  if (process.platform === 'darwin') {
    assert.equal(fastfetch.install?.command, 'brew');
    assert.equal(deja.install?.command, 'brew');
  }
  assert.equal(WELCOME_PROVIDERS.find(provider => provider.id === 'neofetch')!.install, undefined);
  const source = await readFile(new URL('../src/app/TerminalApp.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /existsSync\(join\(directory, 'brew'\)\)/u, 'Starship no longer has its own PATH-only brew check');
  assert.match(source, /resolveCommand\('brew'\)/u);
  assert.match(source, /state\.task\.run\('brew'/u, 'Starship installs through TaskProgress, which resolves the binary');
});

// ---- Bug 2: Chat final-cell clipping ----

test('renderer never erases after a row that fills the last column; shorter rows keep their fill', () => {
  const full = `\u001B[48;2;38;38;48m${'x'.repeat(9)}é\u001B[48;2;38;38;48m\u001B[K\u001B[0m`;
  assert.equal(rowForTerminal(full, 10).includes('\u001B[K'), false);
  assert.equal(stripAnsi(rowForTerminal(full, 10)), `${'x'.repeat(9)}é`, 'the final grapheme survives');
  const short = '\u001B[48;2;1;2;3mabc\u001B[K\u001B[0m';
  assert.equal(rowForTerminal(short, 10), short);
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => writes.push(data));
  renderer.enter();
  renderer.render({rows: [full], cursorRow: 1, cursorColumn: 1, columns: 10});
  assert.equal(writes.at(-1)!.includes('é\u001B[48;2;38;38;48m\u001B[K'), false);
});

function chat(commands: string[][], width: number) {
  const output = new OutputBuffer();
  for (const lines of commands) {
    output.beginCommand(lines.join('\n'), lines, undefined, {cwd: '/tmp'});
    output.write('ok\r\n');
    output.complete(0);
  }
  output.presenter.setLayout('chat');
  return output;
}

test('Chat commands keep their last glyph (ASCII, wide, multi-line) at the exact right edge', () => {
  const width = 80;
  const commands = [['printf meow'], ['true'], ['false'], ['echo 世界'], ['echo a \\', '  && echo z']];
  const output = chat(commands, width);
  const rows = output.wrapped(width).filter(row => row.lineIndex !== undefined && output.lineTypes.get(row.lineIndex) === 'command');
  const expected = ['printf meow', 'true', 'false', 'echo 世界', 'echo a \\', '  && echo z'];
  assert.deepEqual(rows.map(row => stripAnsi(row.plain).slice(row.indent)), expected);
  for (const row of rows) {
    const painted = rowForTerminal(output.presenter.decorate(row, 'command', {now: 0}), width);
    assert.ok(displayWidth(stripAnsi(painted)) <= width, 'never wider than the viewport');
    if (displayWidth(row.plain) === width) assert.equal(painted.includes('\u001B[K'), false, 'no erase after the last column');
    assert.ok(stripAnsi(painted).trimEnd().endsWith(stripAnsi(row.plain).trimEnd().at(-1)!), 'final glyph present');
  }
  const sticky = rowForTerminal(output.presentSticky(0, width)!, width);
  assert.equal(displayWidth(stripAnsi(sticky)), width);
  assert.ok(stripAnsi(sticky).endsWith('printf meow'));
  assert.equal(sticky.includes('\u001B[K'), false);
  assert.equal(serializeCopyPayload(output.recent(5)!).startsWith(' '), false);
  assert.equal(output.recent(5)!.command, 'printf meow', 'stored command unchanged');
  const narrow = output.wrapped(CHAT_MIN_WIDTH - 1);
  assert.ok(narrow.every(row => !row.indent), 'narrow fallback unchanged');
});

// ---- Bug 3: palette viewport ----

test('palette viewport is stable: scrolls only past an edge, minimally; filter, wrap and resize reconcile', () => {
  const state = createPalette();
  const count = filterPalette(state).length;
  const height = 5;
  reconcilePaletteViewport(state, count, height);
  const move = (kind: 'up' | 'down') => { handlePaletteKey({kind}, state); reconcilePaletteViewport(state, count, height); };
  for (let step = 0; step < 4; step += 1) move('down');
  assert.deepEqual([state.selectedIndex, state.viewportStart], [4, 0], 'moves inside the window keep the viewport');
  move('down');
  assert.deepEqual([state.selectedIndex, state.viewportStart], [5, 1], 'crossing the bottom edge scrolls by one');
  move('up'); move('up'); move('up');
  assert.deepEqual([state.selectedIndex, state.viewportStart], [2, 1], 'moving up while visible does not jump back');
  move('up'); move('up');
  assert.deepEqual([state.selectedIndex, state.viewportStart], [0, 0], 'crossing the top edge scrolls minimally');
  move('up');
  assert.deepEqual([state.selectedIndex, state.viewportStart], [count - 1, count - height], 'wrap to last reveals it');
  move('down');
  assert.deepEqual([state.selectedIndex, state.viewportStart], [0, 0], 'wrap to first resets');
  for (let step = 0; step < 8; step += 1) move('down');
  handlePaletteKey({kind: 'text', value: 'chat'}, state);
  assert.deepEqual([state.selectedIndex, state.viewportStart], [0, 0], 'filtering resets');
  const resized = createPalette();
  resized.selectedIndex = 12;
  reconcilePaletteViewport(resized, count, 3);
  assert.equal(resized.viewportStart, 10);
  reconcilePaletteViewport(resized, count, 30);
  assert.ok(resized.viewportStart <= 12 && resized.viewportStart <= Math.max(0, count - 30), 'resize clamps');
  const rendered = renderPalette(resized, 80, 10).map(stripAnsi);
  assert.match(rendered[0]!, /Command palette/u);
  assert.match(rendered[1]!, /›/u);
  assert.match(rendered.at(-1)!, /Esc/u, 'title, search and footer stay fixed');
});
