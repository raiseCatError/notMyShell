import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import * as configuration from '../src/prompt/configuration.js';
import * as setup from '../src/setup/SetupCat.js';
import {setupKey, renderSetup} from '../src/setup/SetupCat.js';
import * as palette from '../src/cursor/palette.js';
import {selectedRowBand} from '../src/ui/PanelShell.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {terminalFrameCells} from '../scripts/dev/terminal-frame-cells.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {serializeCopyPayload} from '../src/output/OutputBuffer.js';

const sequence = (n: number) => Array.from({length: n}, (_, i) => `${i + 1}`).join('\n') + '\n';

test('Recommended is the canonical fresh configuration, with every requested preference', () => {
  const c = normalizePromptConfiguration(undefined);
  assert.deepEqual(c, DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(c.motion.rendering, 'rich');
  assert.equal(c.motion.contextTransitions, 'expressive');
  assert.equal(c.motion.commandLaunch, 'sweep');
  assert.equal(c.motion.completionHighlight, 'vivid');
  assert.equal(c.motion.completionEffect, 'seal');
  assert.equal(c.motion.cursorTravel, 'on');
  assert.equal(c.motion.eventFeedback, 'expressive');
  assert.deepEqual(c.motion.tuning.rich, {intensity: 'medium', speed: 'normal'});
  assert.deepEqual(c.motion.tuning.clean, {intensity: 'medium', speed: 'normal'});
  assert.equal(c.presentation.reducedMotion, false);
  assert.equal(c.presentation.effectsOff, false);
  assert.equal(c.presentation.shimmer, 'on');
  assert.equal(c.presentation.autoEffects, true);
  assert.equal(c.presentation.preset, 'off');
  assert.equal(c.provider, 'nmsh'); assert.equal(c.nmsh.palette, 'lavender');
  assert.equal(c.nmsh.vibrance, 'standard');
  assert.equal(c.uiChrome.source, 'theme'); assert.equal(c.uiChrome.themeText, true);
  assert.equal(c.uiChrome.lavenderText, 'off'); assert.equal(c.uiChrome.lavenderSurface, 'lavender');
  assert.equal(c.transcriptPresentation, 'chat');
  assert.equal(c.transcript.historicalPrompt, true); assert.equal(c.transcript.historicalPromptLevel, 'full');
  assert.equal(c.transcript.historyColors, 'grayscale'); assert.equal(c.transcript.divider, true);
  assert.equal(c.transcript.dividerDensity, 'normal'); assert.equal(c.transcript.dividerColors, 'history');
  assert.equal(c.outputFolding, 'smart'); assert.equal(c.queue.autoSaveSummary, true);
  assert.equal(c.queue.summaryDetail, 'detailed'); assert.equal(c.queue.summaryPlacement, 'center');
  assert.equal(c.queue.summaryAlign, 'left'); assert.equal(c.queue.summaryDurations, true);
  assert.equal(c.queue.summaryExitCodes, true); assert.equal(c.queue.summaryInputWaits, false);
  assert.equal(c.queue.outputDisplay, 'inline'); assert.equal(c.queueFailurePolicy, 'pause');
  assert.equal(c.terminalTitle, 'session'); assert.equal(c.cursor.color.source, 'theme');
  assert.equal(c.cursor.effect, 'none'); assert.equal(c.cursor.renderer, 'auto');
  assert.equal(c.cursor.shape, 'host'); assert.equal(c.cursor.blink, 'host'); assert.equal(c.cursor.idleEffect, 'off');
});

test('requested defaults: Minimal starts Two-line, cursor effects start Off, Fire starts Classic', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.cursor.effect, 'none');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.cursor.color.source, 'theme');
  assert.equal(palette.fireColorChoice({...DEFAULT_PROMPT_CONFIGURATION.cursor, effect: 'fire'}), 'classic');
  assert.equal(configuration.minimalPromptConfiguration().composerLayout, 'twoLine');
  assert.equal(setup.createQuickSetup(normalizePromptConfiguration(undefined)).quick?.layout, 'twoLine');
  // Recommended's draft keeps the cursor effects Off on a configured install too.
  assert.equal(setup.createQuickSetup(normalizePromptConfiguration({onboardingComplete: true, cursor: {effect: 'sparks'}})).draft.cursor.effect, 'none');
  // Explicit saved preferences keep their values; only missing fields take defaults.
  const saved = normalizePromptConfiguration({cursor: {effect: 'fire', particles: {source: 'theme'}}});
  assert.equal(saved.cursor.effect, 'fire');
  assert.equal(saved.cursor.particles.source, 'theme');
  assert.equal(palette.fireColorChoice(saved.cursor), 'theme');
  assert.deepEqual(normalizePromptConfiguration(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(normalizePromptConfiguration({composerLayout: 'oneLine'}).composerLayout, 'oneLine');
});

test('legacy partial configurations retain historical defaults and custom values roundtrip', () => {
  const c = normalizePromptConfiguration({onboardingComplete: true});
  assert.equal(c.motion.rendering, 'clean'); assert.equal(c.motion.contextTransitions, 'off');
  assert.equal(c.cursor.effect, 'none'); assert.equal(c.cursor.color.source, 'host');
  assert.equal(c.uiChrome.lavenderSurface, 'off'); assert.equal(c.transcriptPresentation, 'normal');
  assert.equal(c.transcript.historyColors, 'followPrompt'); assert.equal(c.transcript.dividerColors, 'chroma');
  assert.equal(c.queue.autoSaveSummary, false); assert.equal(c.terminalTitle, 'off');
  assert.equal(c.toolsSetupComplete, true);
  const custom = normalizePromptConfiguration({...c, nmsh: {...c.nmsh, palette: 'brand'},
    cursor: {...c.cursor, effect: 'fire', particles: {source: 'gradient', colors: ['#123456', '#abcdef']}}});
  assert.deepEqual(normalizePromptConfiguration(JSON.parse(JSON.stringify(custom))), custom);
});

test('Minimal uses existing native style, Flow/Normal and no historical prompt display', () => {
  assert.equal(typeof configuration.minimalPromptConfiguration, 'function');
  const c = configuration.minimalPromptConfiguration();
  assert.equal(c.provider, 'nmsh'); assert.equal(c.nmsh.style, 'minimal');
  assert.equal(c.composerPosition, 'flow'); assert.equal(c.transcriptPresentation, 'normal');
  assert.equal(c.transcript.historicalPrompt, false); assert.equal(c.presentation.preset, 'off');
  assert.equal(c.presentation.effectsOff, true); assert.equal(c.cursor.effect, 'none');
  assert.equal(c.commandQueue, true); assert.equal(c.queueFailurePolicy, 'pause');
  assert.deepEqual(normalizePromptConfiguration(c), c);
});

test('quick setup previews choices, reviews replacement, cancels and retains Manual capability', () => {
  assert.equal(typeof setup.createQuickSetup, 'function');
  const saved = normalizePromptConfiguration({onboardingComplete: true, nmsh: {palette: 'brand'}});
  let state = setup.createQuickSetup(saved);
  for (const width of [16, 32, 50, 80]) {
    const rows = renderSetup(state, width, 18);
    assert.ok(rows.every(row => displayWidth(row) <= width));
    assert.match(rows.map(stripAnsi).join('\n'), /Recommended/);
  }
  assert.equal(setupKey(state, {kind: 'escape'}), undefined);
  assert.equal(state.quick?.confirm, true);
  setupKey(state, {kind: 'right'});
  assert.equal(setupKey(state, {kind: 'enter'})?.kind, 'cancel');
  state = setup.createQuickSetup(saved);
  setupKey(state, {kind: 'enter'});
  assert.match(renderSetup(state, 80, 24).map(stripAnsi).join('\n'), /replace|review/i);
  assert.equal(saved.nmsh.palette, 'brand');
  const applied = setupKey(state, {kind: 'enter'});
  assert.equal(applied?.kind, 'apply');
  if (applied?.kind === 'apply') assert.equal(applied.configuration.transcriptPresentation, 'chat');
  state = setup.createQuickSetup(saved);
  setupKey(state, {kind: 'down'}); setupKey(state, {kind: 'enter'});
  assert.equal(state.draft.composerPosition, 'flow');
  setupKey(state, {kind: 'escape'}); setupKey(state, {kind: 'escape'}); setupKey(state, {kind: 'right'});
  assert.equal(setupKey(state, {kind: 'enter'})?.kind, 'cancel');
  state = setup.createQuickSetup(saved);
  setupKey(state, {kind: 'down'}); setupKey(state, {kind: 'down'});
  assert.equal(setupKey(state, {kind: 'enter'})?.kind, 'manual');
  assert.deepEqual(state.draft, saved);
});

test('fire choices are gradients over existing particles and Follow theme follows resolved color', () => {
  assert.equal(typeof palette.applyFireColor, 'function');
  const c = structuredClone(DEFAULT_PROMPT_CONFIGURATION.cursor);
  for (const name of ['purple', 'blue', 'green', 'classic'] as const) {
    const settings = palette.applyFireColor(c, name);
    assert.equal(settings.particles.source, 'gradient');
    assert.ok(new Set(settings.particles.colors).size >= 3);
    assert.equal(palette.fireColorChoice(settings), name);
  }
  const custom = {...c, particles: {source: 'gradient' as const, colors: ['#123456', '#abcdef']}};
  assert.equal(palette.fireColorChoice(custom), 'custom');
  assert.deepEqual(palette.applyFireColor(custom, 'custom').particles, custom.particles);
  const follow = palette.applyFireColor(c, 'theme');
  const resolved = {...follow, color: {source: 'custom' as const, custom: '#a67cf3'}};
  const colors = palette.effectPalette(resolved).particles;
  assert.ok(new Set(colors.map(color => JSON.stringify(color))).size >= 3);
  assert.ok(colors.some(color => color.blue > color.red && color.red > color.green));
});

test('selected surface replaces embedded backgrounds, SGR 49 and reset variants without losing foregrounds', () => {
  const f = executionFrameFixture();
  try {
    const raw = '\u001b[48;2;12;23;34m\u001b[38;2;90;100;110m\u001b[49m text\u001b[m!\u001b[0;32mOK';
    const row = selectedRowBand(raw, 32);
    assert.equal(displayWidth(row), 32);
    assert.equal(stripAnsi(row).trimEnd(), stripAnsi(raw));
    assert.ok(terminalFrameCells(row).every(cell => JSON.stringify(cell.background) === JSON.stringify(UI_COLORS.projectBackground)), 'every cell has the selected background');
    assert.ok(row.includes('38;2;90;100;110'), 'semantic foregrounds survive');
  } finally { f.dispose(); }
});

for (const presentation of ['normal', 'chat'] as const) test(`TerminalApp Smart completion folds 450 foreground lines (${presentation})`, () => {
  const f = executionFrameFixture();
  try {
    f.app['promptConfiguration'].outputFolding = 'smart';
    f.app['promptConfiguration'].transcriptPresentation = presentation;
    f.app['output'].presenter.setLayout(presentation);
    f.app['output'].setOutputFolding('smart');
    f.begin('seq 1 450', sequence(450)); f.capture(); f.complete();
    const record = f.app['output'].recent(1)!;
    assert.equal(record.queued, undefined);
    assert.equal(record.expanded, false, JSON.stringify({detached: f.app['historyViewport'].detached, selection: f.app['selection'], activities: record.activities, lines: record.output.split('\n').length}));
    assert.equal(serializeCopyPayload(record), sequence(450));
    assert.ok(f.app['output'].wrapped(80).some(row => row.plain.includes('442 lines hidden')));
    f.app['output'].toggleExpanded(0); assert.equal(record.expanded, true);
    f.app['output'].toggleExpanded(0); assert.equal(record.expanded, false);
  } finally { f.dispose(); }
});

for (const layout of ['oneLine', 'twoLine'] as const) test(`Minimal ${layout} has no startup greeting and previews the real layout`, () => {
  const c = configuration.minimalPromptConfiguration(layout);
  assert.equal(c.composerLayout, layout); assert.equal(c.placement, 'composer');
  assert.equal(c.welcome, 'none'); assert.equal(c.composerDividers, false);
});

test('quick Minimal layout toggles the real composerLayout without saving', () => {
  const state = setup.createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
  setupKey(state, {kind: 'text', value: '2'});
  assert.equal(state.draft.composerLayout, 'twoLine');
  setupKey(state, {kind: 'right'});
  assert.equal(state.draft.composerLayout, 'oneLine');
  setupKey(state, {kind: 'complete'});
  assert.equal(state.draft.composerLayout, 'twoLine');
  setupKey(state, {kind: 'text', value: '3'});
  assert.deepEqual(state.draft, state.saved);
  setupKey(state, {kind: 'escape'}); setupKey(state, {kind: 'right'});
  assert.equal(setupKey(state, {kind: 'enter'})?.kind, 'cancel');
});

test('Settings discovers presets and contextual flame colors without a second storage model', async () => {
  const {SETTINGS_ROWS, SETTINGS_ENTRIES} = await import('../src/ui/SettingsPanel.js');
  assert.ok(SETTINGS_ENTRIES.some(row => row.id === 'setupQuick' && row.destination === 'setupQuick'));
  const color = SETTINGS_ROWS.find(row => row.id === 'cursorFireColor');
  assert.ok(color); assert.equal(color.when?.(DEFAULT_PROMPT_CONFIGURATION), false, 'effects start Off');
  const fire = {...DEFAULT_PROMPT_CONFIGURATION, cursor: {...DEFAULT_PROMPT_CONFIGURATION.cursor, effect: 'fire' as const}};
  assert.equal(color.when?.(fire), true);
  const {settingsRowValue} = await import('../src/ui/SettingsPanel.js');
  assert.equal(settingsRowValue(color, fire), 'Classic flame', 'choosing Fire starts on Classic');
});

test('project and session title falls back cleanly for absent identities', async () => {
  const {composeTitle} = await import('../src/host/terminalTitle.js');
  assert.equal(composeTitle('session', '', 'Mango'), 'Mango');
  assert.equal(composeTitle('session', 'project', undefined), 'project');
  assert.equal(composeTitle('session', '', undefined), 'notMyShell');
});

for (const mode of ['normal', 'low-color', 'safe', 'no-color'] as const) test(`selected production prompts stay continuous across widths and themes (${mode})`, async () => {
  const {renderHistoricalContext} = await import('../src/output/OutputBuffer.js');
  const {nativePromptSnapshot, themePreviewContext} = await import('../src/prompt/prompt.js');
  for (const columns of [32, 50, 80]) {
    const f = executionFrameFixture(columns, 24, mode);
    try {
      for (const theme of ['lavender', 'warm', 'ocean'] as const) for (const layout of ['normal', 'chat'] as const) {
        const c = structuredClone(DEFAULT_PROMPT_CONFIGURATION); c.nmsh.palette = theme; c.transcriptPresentation = layout;
        f.app['applySettingsConfiguration'](c);
        f.app['withDraftTheme'](c, () => {
          const prompt = nativePromptSnapshot(themePreviewContext('/demo'), c);
          const row = renderHistoricalContext({cwd: '/demo', prompt}, columns, c.transcript, c.presentation)!;
          const selected = selectedRowBand(row.ansi, columns);
          assert.equal(displayWidth(selected), columns);
          assert.equal(stripAnsi(selected).trimEnd(), row.plain.trimEnd());
          if (mode !== 'no-color') {
            const colors = terminalFrameCells(selected).map(cell => JSON.stringify(cell.background));
            assert.equal(new Set(colors).size, 1, `${columns} ${theme} ${layout}: continuous background`);
          } else assert.ok(selected.includes('\u001b[7m'));
        });
      }
    } finally { f.dispose(); }
  }
});

test('Custom flame opens the shared gradient editor even when starting from a named preset', async () => {
  const {createCursorPanel, cursorPanelKey, cursorPanelRowKeys} = await import('../src/cursor/CursorPanel.js');
  const {chooseBackend} = await import('../src/cursor/backends.js');
  const {contextFor} = await import('../src/cursor/colors.js');
  const settings = palette.applyFireColor({...DEFAULT_PROMPT_CONFIGURATION.cursor, effect: 'fire'}, 'purple');
  const state = createCursorPanel(settings);
  state.selected = cursorPanelRowKeys(false, settings).indexOf('fireColor');
  const facts = {host: 'other' as const, caretColor: 'host-controlled' as const, integrated: false};
  const env = {choice: chooseBackend(settings, facts), facts, context: contextFor(DEFAULT_PROMPT_CONFIGURATION), still: false, level: 'truecolor' as const};
  cursorPanelKey(state, {kind: 'left'}, env); // Purple wraps to Custom.
  assert.ok(state.gradient, 'Custom enters the existing gradient editor');
  assert.deepEqual(state.gradient.state.stops, settings.particles.colors);
});

test('portable export keeps motion and flame preferences but excludes installation state', async () => {
  const {exportSettings, planImport} = await import('../src/configuration/portability.js');
  const source = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, introSeen: true});
  const document = exportSettings(source);
  assert.ok(!JSON.stringify(document).includes('introSeen'));
  const plan = planImport(normalizePromptConfiguration({onboardingComplete: true}), document);
  assert.deepEqual(plan.next.motion, source.motion);
  assert.deepEqual(plan.next.cursor, source.cursor);
});

test('explicit Recommended replaces Never with Smart in the actual quick draft', () => {
  const saved = normalizePromptConfiguration({onboardingComplete: true, outputFolding: 'never'});
  const state = setup.createQuickSetup(saved);
  assert.equal(state.draft.outputFolding, 'smart');
  assert.equal(saved.outputFolding, 'never');
});

test('independent review: reverse video cannot swap away the selected surface', () => {
  const f = executionFrameFixture();
  try {
    const raw = '\u001b[7;31mX\u001b[27mY';
    assert.equal(terminalFrameCells(raw)[0]!.inverse, true);
    const cells = terminalFrameCells(selectedRowBand(raw, 32));
    assert.ok(cells.every(cell => !cell.inverse));
    assert.ok(cells.every(cell => JSON.stringify(cell.background) === JSON.stringify(UI_COLORS.projectBackground)));
  } finally { f.dispose(); }
});

test('independent review: Settings truthfully labels an existing Custom flame palette', async () => {
  const {SETTINGS_ROWS, settingsRowValue} = await import('../src/ui/SettingsPanel.js');
  const c = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  c.cursor.particles = {source: 'gradient', colors: ['#123456', '#abcdef']};
  const row = SETTINGS_ROWS.find(row => row.id === 'cursorFireColor')!;
  assert.equal(settingsRowValue(row, c), 'Custom');
});
