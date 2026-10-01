import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {regionOf} from '../src/app/screenPlan.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand, slashCommands} from '../src/commands/slashCommands.js';
import {COMPOSER_POSITIONS, TRANSCRIPT_PRESENTATIONS} from '../src/prompt/configuration.js';
import {createLayoutPanel, handleLayoutPanelKey, layoutPreviewHeight, renderLayoutPanel, renderLayoutPreview} from '../src/ui/LayoutPanel.js';
import {SETTINGS_ENTRIES, SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const SNAPSHOT = fileURLToPath(new URL('./fixtures/layout-preview.txt', import.meta.url));
const key = (kind: string): Key => ({kind} as Key);

/** Every implemented combination, rendered through the real presenter and ScreenPlan. */
function snapshot(): string {
  const width = 60;
  const height = layoutPreviewHeight(width);
  return COMPOSER_POSITIONS.flatMap(composerPosition => TRANSCRIPT_PRESENTATIONS.map(transcriptPresentation => [
    `=== ${composerPosition} / ${transcriptPresentation}`,
    ...renderLayoutPreview({composerPosition, transcriptPresentation}, width, height).map(row => `|${stripAnsi(row).trimEnd()}`),
  ].join('\n'))).join('\n') + '\n';
}

test('layout previews match the snapshot for every combination (UPDATE_SNAPSHOTS=1 rewrites it)', () => {
  const actual = snapshot();
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(SNAPSHOT)) {
    mkdirSync(join(SNAPSHOT, '..'), {recursive: true});
    writeFileSync(SNAPSHOT, actual);
  }
  assert.equal(actual, readFileSync(SNAPSHOT, 'utf8'));
  assert.equal(snapshot(), actual, 'rendering is deterministic');
  const first = renderLayoutPreview({composerPosition: 'flow', transcriptPresentation: 'chat'}, 60, 20);
  assert.deepEqual(renderLayoutPreview({composerPosition: 'flow', transcriptPresentation: 'chat'}, 60, 20), first, 'styled output too');
});

test('the preview shows what distinguishes each combination', () => {
  const height = layoutPreviewHeight(60);
  const plain = (composerPosition: 'bottom' | 'top' | 'flow', transcriptPresentation: 'normal' | 'chat') =>
    renderLayoutPreview({composerPosition, transcriptPresentation}, 60, height).map(row => stripAnsi(row));
  const promptRow = (rows: string[]) => rows.findIndex(row => row.includes('~/Projects/demo'));
  const bottom = plain('bottom', 'normal');
  const top = plain('top', 'normal');
  const flow = plain('flow', 'normal');
  assert.equal(promptRow(top), 0, 'Top: composer first');
  assert.equal(promptRow(bottom), height - 3, 'Bottom: composer docked at the bottom edge');
  assert.ok(promptRow(flow) < promptRow(bottom), 'Flow: composer follows the newest output');
  assert.match(flow[promptRow(flow) - 2]!, /Running npm test/, 'Flow: right after the running command');
  for (const rows of [bottom, top, flow]) {
    const text = rows.join('\n');
    assert.match(text, /lines hidden/, 'a folded block');
    assert.match(text, /for f in \*\.log[\s\S]*do gzip[\s\S]*done/, 'a multi-line command');
    assert.match(text, /Command failed · exit 1/, 'a failure');
    assert.match(text, /Running npm test/, 'an activity row');
  }
  const chat = plain('flow', 'chat');
  assert.match(chat.find(row => row.includes('❯ cat missing.txt'))!, /^\s{10,}❯ cat missing\.txt$/, 'Chat right-aligns history');
  assert.match(chat[promptRow(chat) + 1]!, /^❯ git push/, 'the live composer stays normal in Chat');
});

test('layout panel keys: move rows, cycle values in both directions, and mark unsaved changes', () => {
  const state = createLayoutPanel({composerPosition: 'bottom', transcriptPresentation: 'normal'});
  assert.ok(handleLayoutPanelKey(key('right'), state));
  assert.equal(state.draft.composerPosition, 'top');
  handleLayoutPanelKey(key('right'), state);
  assert.equal(state.draft.composerPosition, 'flow');
  handleLayoutPanelKey(key('right'), state);
  assert.equal(state.draft.composerPosition, 'bottom', 'wraps around');
  handleLayoutPanelKey(key('left'), state);
  assert.equal(state.draft.composerPosition, 'flow');
  handleLayoutPanelKey(key('down'), state);
  handleLayoutPanelKey(key('right'), state);
  assert.equal(state.draft.transcriptPresentation, 'chat');
  assert.equal(state.saved.composerPosition, 'bottom', 'saved stays until Enter');
  assert.equal(handleLayoutPanelKey(key('enter'), state), false, 'Enter and Esc belong to the app');
  const text = renderLayoutPanel(state, 80, 60).map(row => stripAnsi(row)).join('\n');
  assert.match(text, /Composer position +‹ Flow › +saved: Bottom/);
  assert.match(text, /Transcript +‹ Chat › +saved: Normal/);
  assert.match(text, /unsaved preview/);
  assert.match(text, /Flow: the prompt follows the newest output/);
});

test('layout panel fits any size; the preview needs room and says so otherwise', () => {
  const state = createLayoutPanel({composerPosition: 'flow', transcriptPresentation: 'chat'});
  for (const [columns, rows] of [[80, 60], [80, 24], [40, 20], [24, 10]] as const) {
    const lines = renderLayoutPanel(state, columns, rows);
    assert.ok(lines.length <= Math.max(rows, 12), `${columns}x${rows}`);
    for (const line of lines) assert.ok(displayWidth(stripAnsi(line)) <= columns, `${columns}x${rows}: ${stripAnsi(line)}`);
  }
  assert.match(renderLayoutPanel(state, 80, 10).map(row => stripAnsi(row)).join('\n'), /Enlarge the window/);
});

test('/layout is a slash command and a /settings Layout destination', () => {
  assert.deepEqual(parseSlashCommand('/layout'), {kind: 'layout'});
  assert.ok(slashCommands.some(command => command.name === '/layout'));
  assert.ok(SETTINGS_ENTRIES.some(entry => entry.control === 'child' && entry.destination === 'layout'));
  const position = SETTINGS_ROWS.find(row => row.id === 'composerPosition')!;
  assert.ok(position.control === 'enum');
  assert.deepEqual(position.options, ['Bottom', 'Top', 'Flow'], 'Config and /layout share one value list');
});

test('saving from /layout persists, applies live, and the preview never touches the transcript', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nmsh-layout-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  try {
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 50})});
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    app['renderer'].render = (() => {}) as never;
    app['session'].resize = (() => {}) as never;
    app['promptConfiguration'].composerPosition = 'bottom';
    app['promptConfiguration'].transcriptPresentation = 'normal';
    const before = JSON.stringify(app['output'].transcript());
    app['startLayoutSettings']();
    app['render']();
    app['onInput']('\u001B[C'); // Top
    app['onInput']('\u001B[C'); // Flow
    app['onInput']('\u001B[B');
    app['onInput']('\u001B[C'); // Chat
    app['render']();
    assert.equal(JSON.stringify(app['output'].transcript()), before, 'previewing adds nothing to the transcript');
    assert.equal(app['output'].recent(1), undefined, 'nothing for /copy');
    assert.equal(app['promptConfiguration'].composerPosition, 'bottom', 'nothing applies before Enter');

    app['onInput']('\r');
    assert.equal(app['layoutPanelState'], undefined);
    assert.equal(app['promptConfiguration'].composerPosition, 'flow');
    assert.equal(app['promptConfiguration'].transcriptPresentation, 'chat');
    assert.equal(app['output'].presenter.layout, 'chat', 'presentation applied live');
    assert.equal(app['planFrame'](80, 50).composerPosition, 'flow', 'the screen plan uses it immediately');
    assert.ok(regionOf(app['planFrame'](80, 50), 'input'));
    const saved = JSON.parse(readFileSync(join(directory, 'nmsh', 'config.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(saved.composerPosition, 'flow');
    assert.equal(saved.transcriptPresentation, 'chat');
    assert.equal(app['output'].recent(1), undefined, 'only a status line was added, no command record');

    app['startLayoutSettings']();
    app['onInput']('\u001B[C');
    app['onInput']('\u001B');
    app['onInput']('\u001B[A'); // flush the pending Esc
    assert.equal(app['layoutPanelState'], undefined, 'Esc closes without saving');
    assert.equal(app['promptConfiguration'].composerPosition, 'flow');
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    rmSync(directory, {recursive: true, force: true});
  }
});
