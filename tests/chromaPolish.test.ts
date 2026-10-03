import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {DEFAULT_TREATMENT_SETTINGS, normalizeTreatmentSettings, samplePromptTreatment, treatmentFor, treatmentInfluence, TREATMENT_MOTIONS} from '../src/chroma/treatment.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {chromaEligibleRole, NATIVE_PROMPT_THEMES} from '../src/prompt/prompt.js';
import {renderSettingsPanel, SETTINGS_ROWS, adjustSettingsRow, settingsRowValue, type SettingsPanelState} from '../src/ui/SettingsPanel.js';
import {renderTabStrip} from '../src/ui/PanelShell.js';
import {UI_COLORS, foreground} from '../src/ui/palette.js';
import {applyUiTheme, defaultUiColors, uiColorsFor} from '../src/appearance/uiTheme.js';
import {chromeFromColors, nativeThemeChrome, normalizeUiChrome, resolveChrome} from '../src/appearance/uiChrome.js';
import {createChromeEditor, chromeEditorKey} from '../src/appearance/ChromeEditor.js';
import {createThemeStudio, draftDiffersFromBase, STUDIO_ROWS, studioKey} from '../src/appearance/ThemeStudio.js';
import {cloneFromPalette} from '../src/appearance/themeSelection.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {createSetup, renderSetup, sectionIndex, SETUP_SECTIONS, setupKey} from '../src/setup/SetupCat.js';
import {providerExplanation} from '../src/setup/providerExplanations.js';
import {OUTLINE_DIVIDERS, separatorGlyph} from '../src/prompt/glyphChoices.js';
import {normalizeStyleProfiles} from '../src/prompt/styles.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {parseHexColor} from '../src/chroma/color.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const settings = (patch: Partial<SettingsPanelState> = {}): SettingsPanelState =>
  ({section: 'root', view: 'config', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false, ...patch});
const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;
const withPresentation = (patch: object): PromptConfiguration => normalizePromptConfiguration({presentation: patch});

test('Full Chroma is the default influence; saved influences load unchanged', () => {
  assert.equal(DEFAULT_TREATMENT_SETTINGS.intensity, 0.9);
  assert.equal(treatmentInfluence(normalizeTreatmentSettings({})), 'full');
  assert.equal(treatmentInfluence(normalizeTreatmentSettings({intensity: 0.65})), 'mixed', 'an explicit older Mixed stays Mixed');
  assert.equal(normalizeTreatmentSettings({intensity: 0.35}).intensity, 0.35);
});

test('Semantic colors: Override by default with Full Chroma, Preserve below it, explicit choices kept', () => {
  assert.equal(normalizeTreatmentSettings({}).semantic, 'override');
  assert.equal(normalizeTreatmentSettings({intensity: 0.9}).semantic, 'override');
  assert.equal(normalizeTreatmentSettings({intensity: 0.65}).semantic, 'preserve');
  assert.equal(normalizeTreatmentSettings({intensity: 0.9, semantic: 'preserve'}).semantic, 'preserve', 'explicit Preserve survives Full Chroma');
  assert.equal(normalizeTreatmentSettings({intensity: 0.35, semantic: 'override'}).semantic, 'override');
  assert.equal(chromaEligibleRole('failure', 'identity', 'preserve'), false);
  assert.equal(chromaEligibleRole('failure', 'identity', 'override'), true);
  assert.equal(chromaEligibleRole('gitModified', 'prompt', 'override'), true);
  assert.equal(chromaEligibleRole('gitClean', 'prompt', 'override'), false, 'the textless clean marker keeps its meaning color');
  // Choosing Full Chroma in Settings brings Override; Semantic colors stays editable.
  const mixed = withPresentation({preset: 'aurora', intensity: 0.65, semantic: 'preserve'});
  const full = adjustSettingsRow(row('treatmentIntensity'), mixed, 1)!;
  assert.equal(settingsRowValue(row('treatmentIntensity'), full), 'Full Chroma');
  assert.equal(full.presentation.semantic, 'override');
  assert.equal(adjustSettingsRow(row('treatmentSemantic'), full, 1)!.presentation.semantic, 'preserve');
});

test('ownership: Chroma never paints the Settings frame; Chroma Off and On give the same frame', () => {
  const off = renderSettingsPanel(settings(), 100, 30, {configuration: normalizePromptConfiguration({})});
  const on = renderSettingsPanel(settings(), 100, 30, {configuration: withPresentation({preset: 'rainbow', motion: 'breathe'})});
  assert.equal(on[0], off[0], 'frame line identical');
  assert.ok(on[0]!.includes(foreground(UI_COLORS.separator)), 'frame uses the chrome separator');
});

test('ownership: history divider lines follow Chroma by default (static); their colors are the transcript Divider colors setting', () => {
  const rule = (presentation: object) => {
    const output = new OutputBuffer();
    output.presenter.setTreatment(normalizeTreatmentSettings(presentation));
    output.beginCommand('echo hi', ['echo hi'], undefined, {cwd: '/w', project: 'w', prompt: undefined as never});
    output.write('hi\r\n');
    output.complete(0);
    return output.wrapped(80).map(item => item.ansi).find(ansi => stripAnsi(ansi).includes('───')) ?? '';
  };
  const off = rule({preset: 'off'});
  assert.ok(off.length > 0);
  assert.equal(rule({preset: 'rainbow', rules: false}), rule({preset: 'rainbow'}), 'the live Divider lines setting does not recolor history');
  assert.notEqual(rule({preset: 'rainbow'}), off, 'Divider lines follow Chroma by default');
  assert.equal(rule({preset: 'rainbow', motion: 'breathe'}), rule({preset: 'rainbow'}), 'history stays static under motion');
  assert.equal(rule({preset: 'off', rules: true}), off, 'Chroma Off restores the base rule exactly');
});

function harness(config: object): {app: TerminalApp; frames: TerminalFrame[]; cleanup: () => void} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: TerminalFrame[] = [];
  app['renderer'].render = (frame: TerminalFrame) => { frames.push(frame); };
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['configuration'] = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, ...config});
  return {app, frames, cleanup: () => { app['stop'](0); app['session'].kill(); applyUiTheme(undefined); isolation.restore(); }};
}

test('ownership: composer divider lines follow Chroma by default, UI theme when chosen; no frame timer for UI-theme lines', () => {
  const chrome = harness({presentation: {preset: 'rainbow', motion: 'breathe', rules: false}});
  try {
    chrome.app['render']();
    const frame = chrome.frames.at(-1)!;
    const separator = foreground(UI_COLORS.separator);
    assert.ok(frame.rows.some(item => item.startsWith(separator) && stripAnsi(item).startsWith('───')), 'composer rule in chrome color');
  } finally { chrome.cleanup(); }
  const chroma = harness({presentation: {preset: 'rainbow', motion: 'static'}});
  try {
    chroma.app['render']();
    const rules = chroma.frames.at(-1)!.rows.filter(item => stripAnsi(item).startsWith('────'));
    assert.ok(rules.some(item => (item.match(/\u001B\[38;2;/gu) ?? []).length > 3), 'Rules = Chroma paints a gradient');
  } finally { chroma.cleanup(); }
});

test('UI chrome: Follow theme default; Lavender keeps the shipped chrome; Native themes derive their own', () => {
  const config = normalizePromptConfiguration({});
  assert.deepEqual(config.uiChrome, {source: 'theme', preset: 'lavender', themeText: true});
  assert.equal(resolveChrome(config.uiChrome, 'lavender', 'mauve', undefined), undefined, 'shipped chrome for Lavender');
  const forest = nativeThemeChrome('forest')!;
  assert.ok(forest, 'Forest has its own chrome');
  assert.notEqual(forest.accent, '#c5b9e8');
  assert.equal(resolveChrome(config.uiChrome, 'forest', 'mauve', undefined)?.accent, forest.accent);
  assert.equal(resolveChrome(config.uiChrome, 'nord', 'mauve', undefined)?.accent, '#88c0d0', 'bundled families use their UI roles');
});

test('UI chrome: Custom presets (Native Lavender, Grayscale, custom colors) and invalid data', () => {
  assert.equal(resolveChrome({source: 'custom', preset: 'lavender'}, 'forest', 'mauve', undefined), undefined, 'Native Lavender regardless of theme');
  const gray = resolveChrome({source: 'custom', preset: 'grayscale'}, 'forest', 'mauve', undefined)!;
  const lch = (hex: string) => { const c = parseHexColor(hex)!; return Math.max(c.red, c.green, c.blue) - Math.min(c.red, c.green, c.blue); };
  assert.ok(lch(gray.accent) < 10 && lch(gray.separator) < 10 && lch(gray.selection!) < 10, 'grayscale chrome has no hue');
  const colors = {accent: '#ff8800', primary: '#eeeeee', secondary: '#cccccc', subtle: '#888888', separator: '#445566', selection: '#223344',
    success: '#00aa00', warning: '#aaaa00', failure: '#aa0000', info: '#0088aa'};
  assert.equal(resolveChrome({source: 'custom', preset: 'custom', colors}, 'nord', 'mauve', undefined)?.accent, '#ff8800');
  assert.deepEqual(normalizeUiChrome({source: 'custom', preset: 'custom', colors: {accent: 'red'}}), {source: 'custom', preset: 'lavender', themeText: true});
  assert.deepEqual(normalizeUiChrome({source: 'bogus'}), {source: 'theme', preset: 'lavender', themeText: true});
  // Borders, rules, selected tabs and selection all read the applied chrome.
  try {
    applyUiTheme(uiColorsFor(chromeFromColors(colors)));
    assert.deepEqual({...UI_COLORS.separator}, {red: 0x44, green: 0x55, blue: 0x66});
    assert.deepEqual({...UI_COLORS.selection}, {red: 0x22, green: 0x33, blue: 0x44});
    const strip = renderTabStrip(['A', 'B'], 0, 40, true);
    assert.ok(strip.includes('\u001B[48;2;255;136;0m'), 'focused tab uses the chrome accent');
  } finally { applyUiTheme(undefined); }
  assert.deepEqual({...UI_COLORS.separator}, defaultUiColors().separator);
  // The editor drafts colors and saves only on Save.
  const editor = createChromeEditor(colors);
  chromeEditorKey(editor, {kind: 'up'}, 'truecolor');
  assert.deepEqual(chromeEditorKey(editor, {kind: 'enter'}, 'truecolor'), {kind: 'save', colors});
  assert.deepEqual(chromeEditorKey(createChromeEditor(colors), {kind: 'escape'}, 'truecolor'), {kind: 'cancel'});
  assert.ok(SETTINGS_ROWS.some(item => item.id === 'uiChrome') && SETTINGS_ROWS.some(item => item.id === 'uiChromePreset'));
});

test('Forest: a cohesive forest palette, not everything green, with readable text', () => {
  const forest = NATIVE_PROMPT_THEMES.forest;
  const hue = (role: Parameters<typeof forest.colors>[0]) => {
    const {red, green, blue} = forest.colors(role).background;
    return green >= red && green >= blue ? 'green' : red >= green && red >= blue ? 'warm' : 'blue';
  };
  const hues = new Set((['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'kubernetes', 'failure'] as const).map(hue));
  assert.ok(hues.has('warm') && hues.has('green'), `varied hues: ${[...hues]}`);
});

test('Travel loops seamlessly; motion choices lead with Breathe; Breathe, Comet and Pulse unchanged', () => {
  assert.deepEqual([...TREATMENT_MOTIONS], ['static', 'breathe', 'comet', 'pulse', 'travel']);
  const treatment = treatmentFor(normalizeTreatmentSettings({preset: 'aurora', motion: 'travel'}))!;
  let largest = 0;
  let previous = samplePromptTreatment(treatment, {red: 120, green: 100, blue: 200}, 0.5, 0, false);
  for (let time = 50; time <= 12_000; time += 50) {
    const color = samplePromptTreatment(treatment, {red: 120, green: 100, blue: 200}, 0.5, time, false);
    largest = Math.max(largest, Math.abs(color.red - previous.red) + Math.abs(color.green - previous.green) + Math.abs(color.blue - previous.blue));
    previous = color;
  }
  assert.ok(largest < 90, `no snap between frames (largest step ${largest})`);
  const breathe = treatmentFor(normalizeTreatmentSettings({preset: 'aurora', motion: 'breathe', intensity: 0.9}))!;
  assert.deepEqual(samplePromptTreatment(breathe, {red: 10, green: 20, blue: 30}, 0.3, 1000, false),
    samplePromptTreatment({...breathe}, {red: 10, green: 20, blue: 30}, 0.3, 1000, false));
});

test('Theme Studio: Reset to base resets the draft only; cancel after reset and save after reset', () => {
  const saved = cloneFromPalette('nord', 'mauve', 'Mine');
  saved.prompt.project = '#123456';
  const state = createThemeStudio(saved, 'custom');
  assert.equal(state.base, 'nord', 'the recorded Based on theme is the reset target');
  state.selected = STUDIO_ROWS.findIndex(item => item.kind === 'reset');
  studioKey(state, {kind: 'enter'}, 'truecolor', '/');
  assert.equal(state.confirmReset, true, 'edits relative to base are confirmed first');
  studioKey(state, {kind: 'escape'}, 'truecolor', '/');
  assert.equal(state.draft.prompt.project, '#123456', 'Esc keeps editing, nothing reset');
  studioKey(state, {kind: 'enter'}, 'truecolor', '/');
  studioKey(state, {kind: 'enter'}, 'truecolor', '/');
  assert.equal(state.draft.prompt.project, '#88c0d0');
  assert.equal(state.draft.name, 'Mine', 'the draft keeps its name');
  assert.equal(saved.prompt.project, '#123456', 'the saved theme is untouched by a reset');
  assert.deepEqual(studioKey(state, {kind: 'escape'}, 'truecolor', '/'), {kind: 'cancel'}, 'Esc after reset abandons the draft');
  // Save after reset returns the reset colors.
  const again = createThemeStudio(saved, 'custom');
  again.selected = STUDIO_ROWS.findIndex(item => item.kind === 'reset');
  studioKey(again, {kind: 'enter'}, 'truecolor', '/'); studioKey(again, {kind: 'enter'}, 'truecolor', '/');
  again.selected = STUDIO_ROWS.findIndex(item => item.kind === 'save');
  const result = studioKey(again, {kind: 'enter'}, 'truecolor', '/');
  assert.equal(result?.kind === 'save' && result.theme.prompt.project, '#88c0d0');
  // Changing Based on, then resetting, uses the new base; a clean draft resets without asking.
  const based = createThemeStudio(undefined, 'nord');
  based.selected = STUDIO_ROWS.findIndex(item => item.kind === 'basedOn');
  studioKey(based, {kind: 'right'}, 'truecolor', '/');
  const target = based.base;
  based.selected = STUDIO_ROWS.findIndex(item => item.kind === 'reset');
  studioKey(based, {kind: 'enter'}, 'truecolor', '/');
  studioKey(based, {kind: 'enter'}, 'truecolor', '/');
  assert.equal(draftDiffersFromBase(based), false, `draft now equals ${target}`);
  // Per-role reset with R.
  const role = createThemeStudio(saved, 'custom');
  role.selected = STUDIO_ROWS.findIndex(item => item.kind === 'role' && item.role === 'project');
  studioKey(role, {kind: 'text', value: 'r'}, 'truecolor', '/');
  assert.equal(role.draft.prompt.project, '#88c0d0');
  assert.equal(role.draft.prompt.cwd, saved.prompt.cwd, 'other roles untouched');
});

test('/cursor opens the existing cursor rows; no second cursor configuration', () => {
  assert.deepEqual(parseSlashCommand('/cursor'), {kind: 'cursor'});
  const {app, cleanup} = harness({});
  try {
    app['render'] = () => {};
    const before = JSON.stringify(app['configuration']);
    void app['runSlash']('/cursor', {kind: 'cursor'});
    const state = app['settingsPanelState']!;
    assert.equal(state.view, 'config');
    assert.equal(JSON.stringify(app['configuration']), before, 'opening changes nothing');
    app['handleKey']({kind: 'right'});
    assert.equal(app['configuration'].cursor.shape, 'block', 'the same Settings row edits the same setting');
  } finally { cleanup(); }
});

test('Decorative effects: positive wording over the same stored effectsOff', () => {
  const effects = row('effectsOff');
  assert.equal(effects.label, 'Decorative effects');
  assert.match(effects.description, /Chroma motion/u);
  const on = normalizePromptConfiguration({});
  assert.equal(settingsRowValue(effects, on), 'On');
  const off = adjustSettingsRow(effects, on, 1)!;
  assert.equal(off.presentation.effectsOff, true, 'stored key unchanged');
  assert.equal(settingsRowValue(effects, off), 'Off');
  assert.equal(settingsRowValue(effects, normalizePromptConfiguration({presentation: {effectsOff: true}})), 'Off', 'old configs read correctly');
  const text = renderSettingsPanel(settings({searchQuery: 'decorative'}), 100, 30, {configuration: on}).map(stripAnsi).join('\n');
  assert.doesNotMatch(text, /Effects Off\s+Off/u);
  assert.match(text, /Decorative effects\s+On/u);
});

test('Outline gets a fitting divider family; geometry styles get no text separators', () => {
  assert.deepEqual([...OUTLINE_DIVIDERS], ['pipe', 'dashed', 'dot', 'slash', 'custom']);
  assert.equal(separatorGlyph('outline', 'pipe', undefined, true), '│');
  assert.equal(separatorGlyph('outline', 'dashed', undefined, false), ':');
  assert.equal(separatorGlyph('outline', 'custom', '→', false), '|');
  assert.equal(normalizeStyleProfiles({outline: {}}).outline.divider, 'pipe', 'older configs render as before');
  const profiles = normalizeStyleProfiles(undefined) as unknown as Record<string, Record<string, unknown>>;
  for (const style of ['soft', 'compact', 'ribbon']) assert.equal(profiles[style]!.separator, undefined, `${style} keeps geometry controls`);
});

test('Setup Cat: controls stay on top, the preview sits below and gives way first on short terminals', () => {
  const state = createSetup(normalizePromptConfiguration({}));
  state.section = sectionIndex('history');
  state.context.preview = ['PREVIEW-A', 'PREVIEW-B', 'PREVIEW-C'];
  const tall = renderSetup(state, 100, 40).map(stripAnsi);
  const controls = tall.findIndex(item => /History\s+‹ NMSh Native ›/u.test(item));
  const preview = tall.findIndex(item => item.includes('PREVIEW-A'));
  assert.ok(controls > 0 && preview > controls, 'preview below the controls');
  const short = renderSetup(state, 100, 16).map(stripAnsi);
  assert.ok(short.some(item => /History\s+‹ NMSh Native ›/u.test(item)), 'controls survive');
  assert.ok(!short.some(item => item.includes('PREVIEW-C')), 'preview clips first');
  assert.ok(short.length <= 16 && short.every(item => displayWidth(item) <= 100));
});

test('Setup Cat: providers explain themselves; Native says no installation; externals never claim to be better', () => {
  for (const [family, id] of [['history', 'native'], ['navigation', 'native'], ['picker', 'native']] as const) {
    assert.match(providerExplanation(family, id), /^Built in · .* no installation required$/u);
  }
  assert.match(providerExplanation('picker', 'fzf'), /^Optional external picker engine · uses your installed fzf/u);
  for (const family of ['history', 'navigation', 'picker', 'suggestions', 'welcome', 'prompt']) {
    for (const id of ['atuin', 'zoxide', 'fzf', 'television', 'deja', 'fastfetch', 'starship']) {
      assert.doesNotMatch(providerExplanation(family, id), /better|faster|recommended/iu);
    }
  }
});

test('app: Setup Cat previews come from the draft: Vespyr first, real prompt, chrome and provider text', () => {
  const {app, cleanup} = harness({});
  try {
    app['render'] = () => {};
    app['startSetup']();
    const state = app['setupState']!;
    const start = app['setupPreview'](state, 100).map(stripAnsi).join('\n');
    assert.match(start, /█/u, 'the Vespyr sprite');
    assert.match(start, /Vespyr the NMSh cat/u);
    state.section = sectionIndex('appearance');
    const before = app['setupPreview'](state, 100).join('\n');
    state.draft = {...state.draft, nmsh: {...state.draft.nmsh, palette: 'forest'}};
    const after = app['withDraftTheme'](state.draft, () => app['setupPreview'](state, 100)).join('\n');
    assert.notEqual(after, before, 'the preview follows the draft theme');
    assert.deepEqual({...UI_COLORS.accent}, defaultUiColors().accent, 'live chrome restored after previewing a draft');
    state.section = sectionIndex('history');
    assert.match(app['setupPreview'](state, 100).map(stripAnsi).join('\n'), /no installation required/u);
    state.section = sectionIndex('terminal');
    state.draft = {...state.draft, cursor: {shape: 'bar', blink: 'off'}};
    assert.match(app['setupPreview'](state, 100).map(stripAnsi).join('\n'), /Bar · blink off/u);
    assert.equal(app['renderer'].currentCursorStyle, '', 'previewing a cursor never changes the real cursor');
  } finally { cleanup(); }
});

test('app: installing from Setup Cat uses the shared browser and returns to the same draft and step, even after a failure', async () => {
  const {app, cleanup} = harness({});
  try {
    app['render'] = () => {};
    app['startSetup']();
    const state = app['setupState']!;
    state.section = sectionIndex('history');
    state.row = 1;
    setupKey(state, {kind: 'right'});
    assert.equal(state.draft.navigation, 'zoxide', 'a draft edit before installing');
    state.context.statuses = {zoxide: {state: 'missing'}};
    const result = setupKey(state, {kind: 'text', value: 'i'});
    assert.deepEqual(result, {kind: 'browseTools', toolId: 'zoxide'});
    app['openSetupToolBrowser'](state, 'zoxide');
    const browser = state.toolBrowser!;
    assert.equal(browser.detail?.id, 'zoxide');
    assert.match(renderSetup(state, 100, 30).map(stripAnsi).join(' ').replace(/\s+/gu, ' '), /Tool installation happens immediately after confirmation\. Your NMSh settings remain a draft until Apply\./u);
    // A failing install through the same confirmation path: the failure is shown and the draft survives.
    browser.statuses.zoxide = {state: 'missing'};
    browser.recipe = {label: 'failing install', command: process.execPath, args: ['-e', 'process.exit(3)']};
    browser.confirm = {choice: 'yes'};
    await app['handleSetupToolsKey']({kind: 'enter'}, state, browser);
    assert.match(browser.errors.zoxide ?? '', /failed/iu);
    await app['handleSetupToolsKey']({kind: 'escape'}, state, browser);
    await app['handleSetupToolsKey']({kind: 'escape'}, state, browser);
    assert.equal(state.toolBrowser, undefined, 'back in Setup Cat');
    assert.equal(app['setupState'], state, 'the same Setup Cat session');
    assert.equal(state.section, sectionIndex('history'));
    assert.equal(state.draft.navigation, 'zoxide', 'the draft survived');
    assert.equal(app['configuration'].navigation, 'native', 'nothing applied yet');
  } finally { cleanup(); }
});
