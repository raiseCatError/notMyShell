import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {OutputBuffer, renderHistoricalContext, serializeCopyPayload, type HistoricalContextSnapshot} from '../src/output/OutputBuffer.js';
import {handleTranscriptPanelKey, renderTranscriptPanel, type TranscriptPanelState} from '../src/output/TranscriptPanel.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  DEFAULT_TRANSCRIPT_APPEARANCE,
  loadPromptConfiguration,
  normalizePromptConfiguration,
  normalizeTranscriptAppearance,
  savePromptConfiguration,
  type TranscriptAppearance,
} from '../src/prompt/configuration.js';
import {NATIVE_PROMPT_THEMES, nativePromptSnapshot, themePreviewContext} from '../src/prompt/prompt.js';
import {archiveColor, grayscaleArchiveColor} from '../src/prompt/snapshot.js';
import type {Key} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const context = themePreviewContext();
const sample: HistoricalContextSnapshot = {cwd: context.cwd, prompt: nativePromptSnapshot(context, DEFAULT_PROMPT_CONFIGURATION)};
const appearance = (overrides: Partial<TranscriptAppearance>): TranscriptAppearance => ({...DEFAULT_TRANSCRIPT_APPEARANCE, ...overrides});
const backgrounds = (ansi: string) => [...ansi.matchAll(/48;2;(\d+);(\d+);(\d+)m/gu)].map(match => match.slice(1, 4).map(Number) as [number, number, number]);

test('divider and historical prompt combine independently', () => {
  const both = renderHistoricalContext(sample, 120, appearance({}))!;
  assert.match(both.plain, /notMyShell.*─+$/u);
  const promptOnly = renderHistoricalContext(sample, 120, appearance({divider: false}))!;
  assert.match(promptOnly.plain, /notMyShell/u);
  assert.doesNotMatch(promptOnly.plain, /─/u);
  const dividerOnly = renderHistoricalContext(sample, 120, appearance({historicalPrompt: false}))!;
  assert.equal(dividerOnly.plain, '─'.repeat(120));
  assert.equal(renderHistoricalContext(sample, 120, appearance({divider: false, historicalPrompt: false})), undefined, 'no invented chrome');
  for (const row of [both, promptOnly, dividerOnly]) assert.ok(row.isHistoricalHeader && displayWidth(row.plain) <= 120);
});

test('compact divider density is a lighter single-row rule', () => {
  const compact = renderHistoricalContext(sample, 60, appearance({historicalPrompt: false, dividerDensity: 'compact'}))!;
  assert.equal(compact.plain, '┈'.repeat(60));
  const normal = renderHistoricalContext(sample, 60, appearance({historicalPrompt: false}))!;
  assert.notEqual(compact.ansi.match(/38;2;[\d;]+m/u)![0], normal.ansi.match(/38;2;[\d;]+m/u)![0], 'quieter tone');
  assert.match(renderHistoricalContext(sample, 120, appearance({dividerDensity: 'compact'}))!.plain, /docker .*┈+$/u);
});

test('history colors follow the prompt, a chosen theme, or grayscale without mutating the snapshot', () => {
  const before = JSON.stringify(sample);
  const follow = backgrounds(renderHistoricalContext(sample, 200, appearance({}))!.ansi);
  const project = sample.prompt!.segments[0]!.background!;
  const archived = archiveColor(project, 'background');
  assert.deepEqual(follow[0], [archived.red, archived.green, archived.blue], 'follow prompt = muted captured colors');

  const themed = backgrounds(renderHistoricalContext(sample, 200, appearance({historyColors: 'theme', historyTheme: 'warm'}))!.ansi);
  const warm = archiveColor(NATIVE_PROMPT_THEMES.warm.colors('project').background, 'background');
  assert.deepEqual(themed[0], [warm.red, warm.green, warm.blue], 'chosen theme recolors by stored role');

  const gray = backgrounds(renderHistoricalContext(sample, 200, appearance({historyColors: 'grayscale'}))!.ansi);
  assert.ok(gray.every(([red, green, blue]) => Math.max(red, green, blue) - Math.min(red, green, blue) <= 2), 'explicitly neutral');
  const expectedGray = grayscaleArchiveColor(project, 'background');
  assert.deepEqual(gray[0], [expectedGray.red, expectedGray.green, expectedGray.blue]);
  assert.equal(JSON.stringify(sample), before, 'stored semantic snapshot is unchanged');
});

test('legacy and Starship snapshots render in every mode', () => {
  const legacy: HistoricalContextSnapshot = {cwd: '/tmp/work', project: 'work', branch: 'main'};
  const starship: HistoricalContextSnapshot = {cwd: '/tmp', prompt: {provider: 'starship', layout: 'twoLine', cwd: '/tmp',
    segments: [{text: 'on ', geometry: 'plain'}, {text: 'main', foreground: {red: 10, green: 200, blue: 90}, geometry: 'plain'}]}};
  for (const historyColors of ['followPrompt', 'theme', 'grayscale'] as const) {
    for (const snapshot of [legacy, starship]) {
      const row = renderHistoricalContext(snapshot, 40, appearance({historyColors, historyTheme: 'cool'}))!;
      assert.ok(displayWidth(row.plain) <= 40, `${historyColors}`);
    }
  }
  assert.match(renderHistoricalContext(legacy, 60, appearance({}))!.plain, /work.*\/tmp\/work.*main/u);
  const wide = {...starship, prompt: {...starship.prompt!, segments: [{text: 'x'.repeat(200), geometry: 'plain' as const}]}};
  assert.ok(displayWidth(renderHistoricalContext(wide, 50, appearance({}))!.plain) <= 50, 'wide Starship spans are truncated');
});

test('OutputBuffer applies transcript appearance as presentation only', () => {
  const output = new OutputBuffer();
  output.beginCommand('echo hi', ['❯ echo hi'], undefined, sample);
  output.write('hi\n');
  output.complete(0);
  output.setTranscriptAppearance(appearance({divider: false, historicalPrompt: false}));
  const rows = output.wrapped(80);
  assert.ok(!rows.some(row => row.isHistoricalHeader));
  assert.ok(rows.some(row => row.plain === '❯ echo hi'), 'command structure remains');
  assert.equal(serializeCopyPayload(output.recent(1)!).split('\n')[0], 'hi');
  output.setTranscriptAppearance(appearance({}));
  assert.equal(output.wrapped(80).filter(row => row.isHistoricalHeader).length, 1);
  assert.deepEqual(output.transcript().records[0]?.historicalContext, sample, 'archived transcripts keep the full snapshot');
});

test('/transcript panel edits a draft with saved markers, previews, and a theme gallery', () => {
  const saved = {...DEFAULT_TRANSCRIPT_APPEARANCE};
  const state: TranscriptPanelState = {selectedIndex: 0, draft: {...saved}, saved};
  const key = (kind: 'up' | 'down' | 'left' | 'right') => handleTranscriptPanelKey({kind} as Key, state);
  key('right');
  assert.equal(state.draft.divider, false);
  key('down'); key('right');
  assert.equal(state.draft.dividerDensity, 'compact');
  key('down'); key('down'); key('right');
  assert.equal(state.draft.historyColors, 'theme');
  let rows = renderTranscriptPanel(state, 140, sample).map(stripAnsi);
  assert.ok(rows.some(row => row.includes('Divider            ‹ Off ›  saved: On')));
  assert.ok(rows.some(row => row.includes('History colors     ‹ Choose theme ›  saved: Follow prompt')));
  assert.ok(rows.some(row => row.startsWith('History themes')));
  assert.equal(rows.filter(row => /^[●○] /u.test(row)).length, 5, 'one preview row per theme');
  assert.ok(rows.some(row => row.includes('unsaved preview')));
  assert.equal(rows.at(-1), '↑↓ move · ←→ change · Enter save · Esc cancel');
  key('down'); key('right');
  assert.equal(state.draft.historyTheme, 'brand');
  assert.ok(renderTranscriptPanel(state, 140, sample).map(stripAnsi).some(row => /● Brand \/ Semantic/u.test(row)));
  key('up'); key('right'); key('right');
  assert.equal(state.draft.historyColors, 'followPrompt');
  rows = renderTranscriptPanel(state, 140, sample).map(stripAnsi);
  assert.ok(!rows.some(row => row.startsWith('History theme')), 'theme row only exists for Choose theme');
  assert.ok(state.selectedIndex < 4);
  const short = renderTranscriptPanel({...state, draft: {...state.draft, historyColors: 'theme'}}, 140, sample, 16);
  assert.ok(!short.map(stripAnsi).some(row => row.startsWith('History themes')), 'gallery drops on short terminals');
});

test('transcript settings normalize safely and persist in the NMSh config', async () => {
  assert.deepEqual(normalizeTranscriptAppearance(undefined), DEFAULT_TRANSCRIPT_APPEARANCE);
  assert.deepEqual(normalizeTranscriptAppearance({divider: 'yes', historyColors: 'neon', historyTheme: 'nope', dividerDensity: 'tiny'}), DEFAULT_TRANSCRIPT_APPEARANCE);
  assert.deepEqual(normalizePromptConfiguration({}).transcript, DEFAULT_TRANSCRIPT_APPEARANCE);
  assert.deepEqual(parseSlashCommand('/transcript'), {kind: 'transcript'});
  assert.deepEqual(parseSlashCommand('/history foo'), {kind: 'history', query: 'foo'}, '/history keeps its meaning');
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-transcript-'));
  try {
    const path = join(directory, 'config.json');
    const transcript = appearance({divider: false, historyColors: 'theme', historyTheme: 'grayscale', dividerDensity: 'compact'});
    savePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), transcript}, path);
    assert.deepEqual(loadPromptConfiguration(path).transcript, transcript);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
