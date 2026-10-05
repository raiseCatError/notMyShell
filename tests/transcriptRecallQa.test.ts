import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {DEFAULT_PROMPT_CONFIGURATION, DEFAULT_TRANSCRIPT_APPEARANCE, DIVIDER_COLOR_MODES, normalizePromptConfiguration, type TranscriptAppearance} from '../src/prompt/configuration.js';
import {normalizeTreatmentSettings} from '../src/chroma/treatment.js';
import {renderHistoricalContext, type HistoricalContextSnapshot} from '../src/output/OutputBuffer.js';
import {renderTranscriptPanel} from '../src/output/TranscriptPanel.js';
import {ComposerHistory, recallSource} from '../src/input/ComposerHistory.js';
import {createSetup, renderSetup, sectionIndex, SETUP_SECTIONS, setupKey} from '../src/setup/SetupCat.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {applyUiTheme} from '../src/appearance/uiTheme.js';
import {stripAnsi} from '../src/util/text.js';

const sample: HistoricalContextSnapshot = {cwd: '/w/notMyShell', project: 'notMyShell', branch: 'main'};
const dividerOnly = (dividerColors: TranscriptAppearance['dividerColors'], patch: Partial<TranscriptAppearance> = {}, presentation: object = {preset: 'aurora'}) =>
  renderHistoricalContext(sample, 60, {...DEFAULT_TRANSCRIPT_APPEARANCE, historicalPrompt: false, dividerColors, ...patch}, normalizeTreatmentSettings(presentation))!.ansi;
const colors = (ansi: string) => [...ansi.matchAll(/\u001B\[38;2;(\d+);(\d+);(\d+)m/gu)].map(match => [Number(match[1]), Number(match[2]), Number(match[3])]);

function harness(config: object = {}): {app: TerminalApp; cleanup: () => void} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  app['renderer'].render = () => {};
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['configuration'] = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, ...config});
  return {app, cleanup: () => { app['stop'](0); app['session'].kill(); applyUiTheme(undefined); isolation.restore(); }};
}

// ---- 1. Historical divider colors ---------------------------------------------------------

test('divider colors: every mode renders its own historical divider; Follow Chroma is the default', () => {
  assert.equal(DEFAULT_TRANSCRIPT_APPEARANCE.dividerColors, 'chroma');
  assert.equal(normalizePromptConfiguration({transcript: {dividerColors: 'neon'}}).transcript.dividerColors, 'chroma');
  const rendered = new Map(DIVIDER_COLOR_MODES.map(mode => [mode, dividerOnly(mode)]));
  assert.equal(new Set(rendered.values()).size, DIVIDER_COLOR_MODES.length, 'four distinct presentations');
  assert.ok(new Set(colors(rendered.get('chroma')!).map(String)).size > 3, 'Follow Chroma takes the palette');
  assert.equal(dividerOnly('chroma', {}, {preset: 'off'}), dividerOnly('ui'), 'Follow Chroma with Chroma Off is the UI theme tone');
  const [red, green, blue] = colors(rendered.get('muted')!)[0]!;
  assert.ok(Math.max(red!, green!, blue!) - Math.min(red!, green!, blue!) < 12 && red! < 140, 'Muted grayscale is quiet and neutral');
  const gray = colors(dividerOnly('history', {historyColors: 'grayscale'}))[0]!;
  assert.ok(Math.max(...gray) - Math.min(...gray) < 12, 'Follow history follows Grayscale history');
  assert.notEqual(dividerOnly('history', {historyColors: 'theme', historyTheme: 'forest'}), dividerOnly('history', {historyColors: 'theme', historyTheme: 'sunset'}),
    'Follow history follows the chosen history theme');
});

test('divider colors: Follow Chroma is static in history and the live Divider lines setting does not govern it', () => {
  for (const motion of ['breathe', 'comet', 'travel', 'pulse']) {
    assert.equal(dividerOnly('chroma', {}, {preset: 'aurora', motion}), dividerOnly('chroma', {}, {preset: 'aurora', motion: 'static'}), `${motion}: history never moves`);
  }
  assert.equal(dividerOnly('chroma', {}, {preset: 'aurora', rules: false}), dividerOnly('chroma'), 'historical colors are their own setting');
  const {app, cleanup} = harness({transcript: {dividerColors: 'chroma'}, presentation: {preset: 'aurora', motion: 'static'}});
  try {
    app['render']();
    assert.equal(app['presentationSubscription'], undefined, 'no animation timer for static history dividers');
  } finally { cleanup(); }
});

test('/transcript previews every divider color choice through the real renderer', () => {
  const draft = {...DEFAULT_TRANSCRIPT_APPEARANCE};
  const state = {selectedIndex: 2, draft, saved: {...draft}};
  const screen = renderTranscriptPanel(state, 100, sample, Infinity, normalizeTreatmentSettings({preset: 'aurora'})).map(stripAnsi).join('\n');
  for (const label of ['Divider colors', 'Follow Chroma', 'Follow history', 'Follow UI theme', 'Muted grayscale']) assert.match(screen, new RegExp(label, 'u'));
});

// ---- 2. Slash commands in ↑/↓ recall ------------------------------------------------------

test('recall: shell → /prompt → shell → /transcript walks back in exact order and restores the draft', () => {
  const session = [{text: 'ls -la', slash: false}, {text: '/prompt', slash: true}, {text: 'git status', slash: false}, {text: '/transcript', slash: true}];
  const history = ['git status', 'ls -la', 'make build'];
  const recall = new ComposerHistory();
  const steps = [recall.previous('half typed', () => recallSource(session, history))];
  for (let index = 0; index < 4; index++) steps.push(recall.previous(steps.at(-1)!, () => []));
  assert.deepEqual(steps, ['/transcript', 'git status', '/prompt', 'ls -la', 'make build'], 'no duplicates, slash commands in place');
  const back = [recall.next('make build'), recall.next('ls -la'), recall.next('/prompt'), recall.next('git status'), recall.next('/transcript')];
  assert.deepEqual(back, ['ls -la', '/prompt', 'git status', '/transcript', 'half typed'], 'Down restores the unsent draft exactly');
  // The shell's history policy still decides for shell commands: unrecorded ones are not offered.
  assert.deepEqual([...recallSource([{text: ' secret', slash: false}, {text: '/setup', slash: true}], [])], ['/setup']);
});

test('recall in the app: submitted NMSh commands come back with ↑ and never reach zsh or external history', async () => {
  const {app, cleanup} = harness();
  try {
    const shellHistory: Array<{command: string}> = [];
    app['historyService'].index.all = () => [...shellHistory].reverse() as never;
    const written: string[] = [];
    app['session'].write = ((data: string) => { written.push(data); }) as never;
    const submitSlash = async (command: string) => {
      app['editor'].clear(); app['editor'].insert(command);
      await app['submit']();
      for (const key of ['promptPanelState', 'transcriptPanelState', 'settingsPanelState', 'themeStudio']) (app as never as Record<string, unknown>)[key] = undefined;
    };
    const shell = (command: string) => { app['sessionSubmissions'].push({text: command, slash: false}); shellHistory.push({command}); };
    shell('ls -la');
    await submitSlash('/prompt');
    shell('git status');
    await submitSlash('/transcript');
    assert.equal(written.some(data => data.includes('/prompt') || data.includes('/transcript')), false, 'never written to zsh');
    assert.equal(shellHistory.some(entry => entry.command.startsWith('/')), false, 'never in shell/external history');
    app['editor'].insert('draft');
    const seen: string[] = [];
    for (let index = 0; index < 4; index++) { app['recallHistory']('previous'); seen.push(app['editor'].text); }
    assert.deepEqual(seen, ['/transcript', 'git status', '/prompt', 'ls -la']);
    for (let index = 0; index < 4; index++) app['recallHistory']('next');
    assert.equal(app['editor'].text, 'draft', 'the unsent draft is restored');
    app['editor'].clear();
    await app['submit']();
    assert.equal(app['sessionSubmissions'].length, 4, 'empty input is never stored');
  } finally { cleanup(); }
});

// ---- 3. Setup Cat Transcript ---------------------------------------------------------------

test('Setup Cat: a Transcript step after Editor, reusing the transcript rows once; /setup transcript opens it', () => {
  const ids = SETUP_SECTIONS.map(section => section.id);
  assert.equal(ids.indexOf('transcript'), ids.indexOf('editor') + 1);
  const transcript = SETUP_SECTIONS[sectionIndex('transcript')]!.rows.map(item => item.row.id);
  assert.deepEqual(transcript, ['transcriptPresentation', 'historicalPrompt', 'historyColors', 'historyTheme', 'divider', 'dividerDensity', 'dividerColors', 'outputFolding']);
  const all = SETUP_SECTIONS.flatMap(section => section.rows.map(item => item.row.id));
  assert.equal(all.filter(id => id === 'transcriptPresentation').length, 1, 'Transcript presentation appears once');
  assert.equal(all.filter(id => id === 'outputFolding').length, 1);
  assert.deepEqual(parseSlashCommand('/setup transcript'), {kind: 'setup', entry: 'transcript'});
  const state = createSetup(normalizePromptConfiguration({transcript: {historyColors: 'grayscale'}}), 'transcript');
  assert.equal(state.section, sectionIndex('transcript'));
  const screen = renderSetup(state, 120, 50).map(stripAnsi).join('\n');
  assert.doesNotMatch(screen, /History theme/u, 'the theme row appears only for Choose theme');
  state.row = 2;
  setupKey(state, {kind: 'right'});
  assert.equal(state.draft.transcript.historyColors, 'followPrompt');
  setupKey(state, {kind: 'right'});
  assert.match(renderSetup(state, 120, 50).map(stripAnsi).join('\n'), /History theme/u, 'Choose theme exposes the theme contextually');
  assert.equal(state.saved.transcript.historyColors, 'grayscale', 'one draft; nothing saved until Apply');
});

test('Setup Cat: the transcript preview uses the real renderer and reacts to the draft', () => {
  const {app, cleanup} = harness();
  try {
    const preview = (patch: object) => app['setupTranscriptPreview'](normalizePromptConfiguration({presentation: {preset: 'aurora'}, ...patch}), 90).join('\n');
    const base = preview({});
    assert.match(stripAnsi(base), /notMyShell/u, 'a historical prompt');
    assert.match(stripAnsi(base), /npm test/u);
    assert.match(stripAnsi(base), /42 passing/u);
    assert.match(stripAnsi(base), /─{3,}/u, 'a divider');
    assert.match(stripAnsi(base), /folded/u, 'a folded-output example');
    for (const patch of [{transcriptPresentation: 'chat'}, {transcript: {divider: false}}, {transcript: {historicalPrompt: false}},
      {transcript: {dividerColors: 'muted'}}, {transcript: {dividerDensity: 'compact'}}, {transcript: {historyColors: 'grayscale'}}, {outputFolding: 'never'}]) {
      assert.notEqual(preview(patch), base, `reacts to ${JSON.stringify(patch)}`);
    }
  } finally { cleanup(); }
});
