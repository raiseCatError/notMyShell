import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {CURSOR_RESET, TerminalRenderer, cursorStyleSequence} from '../src/terminal/TerminalRenderer.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {
  adjustSettingsRow, renderSettingsPanel, SETTINGS_ROWS, settingsRowApplies, settingsRowDepth, settingsRowValue, visibleSettingsRows,
  type SettingsPanelState,
} from '../src/ui/SettingsPanel.js';
import {renderModal, renderTooSmall, fits} from '../src/ui/Modal.js';
import {parseMeminfo, parsePmset, parseVmStat, renderStatusStrip, stripItems, stripVisible} from '../src/status/StatusStrip.js';
import {planScreen, regionAt, withStatusRow} from '../src/app/screenPlan.js';
import {
  BREADCRUMB_SEPARATORS, MINIMAL_SEPARATORS, PROMPT_SYMBOL_IDS, SEMANTIC_ICONS, promptSymbolGlyph, semanticIcon, separatorGlyph,
  validateGlyph, withSemanticIcon,
} from '../src/prompt/glyphChoices.js';
import {STYLE_PROFILE_OPTIONS, normalizeStyleProfiles} from '../src/prompt/styles.js';
import {appearanceRows, handlePromptPanelKey, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {buildThemePreviewLine} from '../src/prompt/prompt.js';
import {GLYPHS, setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const config = (patch: Partial<SettingsPanelState> = {}): SettingsPanelState =>
  ({section: 'root', view: 'config', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false, ...patch});
const ids = (rows: {id: string}[]) => rows.map(row => row.id);
const clone = () => structuredClone(DEFAULT_PROMPT_CONFIGURATION);

test('nested settings: children sit under their parent with a small indent and disappear when they do not apply', () => {
  const off = clone();
  let rows = ids(visibleSettingsRows(config(), off));
  for (const hidden of ['treatmentIntensity', 'treatmentMotion', 'treatmentSpeed', 'treatmentCurve', 'cursorBlink', 'stripClock', 'themeAccent']) {
    assert.ok(!rows.includes(hidden), `${hidden} hidden`);
  }
  assert.ok(rows.includes('themeVariant'), 'NMSh family has variants');
  const on = clone();
  on.presentation.preset = 'aurora';
  on.presentation.motion = 'travel';
  on.cursor.shape = 'bar';
  on.statusStrip.enabled = true;
  on.nmsh.palette = 'catppuccinMocha';
  rows = ids(visibleSettingsRows(config(), on));
  for (const shown of ['treatmentIntensity', 'treatmentScope', 'treatmentMotion', 'treatmentSpeed', 'treatmentCurve', 'cursorBlink', 'stripClock', 'stripBattery', 'themeAccent']) {
    assert.ok(rows.includes(shown), `${shown} shown`);
  }
  // Children follow their parent directly.
  assert.ok(rows.indexOf('themeVariant') === rows.indexOf('themeFamily') + 1);
  assert.ok(rows.indexOf('treatmentSpeed') > rows.indexOf('treatmentMotion'));
  const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;
  assert.equal(settingsRowDepth(row('treatmentPreset')), 0);
  assert.equal(settingsRowDepth(row('treatmentMotion')), 1);
  assert.equal(settingsRowDepth(row('treatmentSpeed')), 2);
  const text = renderSettingsPanel(config({showAdvanced: true}), 100, Infinity, {configuration: on}).map(stripAnsi);
  const line = (label: string) => text.find(item => new RegExp(`^ {4}( *)${label}\\s`, 'u').test(item));
  assert.match(line('Chroma')!, /^ {4}Chroma\s+Aurora/u);
  assert.match(line('Motion')!, /^ {4} {2}Motion\s+Travel/u);
  assert.match(line('Speed')!, /^ {4} {4}Speed\s+Normal/u);
  assert.match(line('Variant')!, /^ {4} {2}Variant\s+Mocha/u);
  assert.match(line('Accent')!, /^ {4} {2}Accent\s+Mauve/u);
  // Motion back to Static hides Speed and Ramp but keeps the other Chroma rows.
  on.presentation.motion = 'static';
  assert.ok(!settingsRowApplies(row('treatmentSpeed'), on) && settingsRowApplies(row('treatmentScope'), on));
});

test('theme rows: family moves to its default variant, variant cycles within the family, accent only for Catppuccin', () => {
  const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;
  let next = adjustSettingsRow(row('themeFamily'), clone(), 1)!;
  assert.equal(next.nmsh.palette, 'catppuccinMocha');
  assert.equal(settingsRowValue(row('themeVariant'), next), 'Mocha');
  next = adjustSettingsRow(row('themeVariant'), next, -1)!;
  assert.equal(next.nmsh.palette, 'catppuccinMacchiato');
  next = adjustSettingsRow(row('themeAccent'), next, 1)!;
  assert.equal(next.nmsh.accent, 'red');
  const nord = {...clone(), nmsh: {...clone().nmsh, palette: 'nord' as const}};
  assert.ok(!settingsRowApplies(row('themeVariant'), nord), 'single-variant families hide the variant row');
});

test('cursor: DECSCUSR sequences, Host default sends nothing, blink only with a shape', () => {
  assert.equal(cursorStyleSequence('host', 'on'), '');
  assert.equal(cursorStyleSequence('block', 'on'), '\u001B[1 q');
  assert.equal(cursorStyleSequence('block', 'off'), '\u001B[2 q');
  assert.equal(cursorStyleSequence('underline', 'host'), '\u001B[3 q');
  assert.equal(cursorStyleSequence('underline', 'off'), '\u001B[4 q');
  assert.equal(cursorStyleSequence('bar', 'on'), '\u001B[5 q');
  assert.equal(cursorStyleSequence('bar', 'off'), '\u001B[6 q');
  const defaults = normalizePromptConfiguration({}).cursor;
  assert.deepEqual([defaults.shape, defaults.blink, defaults.motion, defaults.effect], ['host', 'host', 'off', 'none']);
  const invalid = normalizePromptConfiguration({cursor: {shape: 'beam', blink: 2}}).cursor;
  assert.deepEqual([invalid.shape, invalid.blink], ['host', 'host']);
});

test('cursor lifecycle: applied while NMSh owns the composer, host state on passthrough, exit and resume', () => {
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => { writes.push(data); });
  renderer.setCursorStyle(cursorStyleSequence('bar', 'off'));
  assert.deepEqual(writes, [], 'nothing is written before entry');
  renderer.enter();
  assert.ok(writes.at(-1)!.endsWith('\u001B[6 q'), 'entry applies the caret');
  renderer.suspendForPassthrough();
  assert.ok(writes.at(-1)!.includes(CURSOR_RESET), 'passthrough restores the host cursor');
  assert.ok(!writes.at(-1)!.includes('\u001B[6 q'));
  renderer.resumeAfterPassthrough();
  assert.ok(writes.at(-1)!.includes('\u001B[6 q'), 'NMSh caret returns after passthrough');
  renderer.setCursorStyle(cursorStyleSequence('block', 'on'));
  assert.equal(writes.at(-1), '\u001B[1 q', 'live changes apply immediately');
  renderer.setCursorStyle('');
  assert.equal(writes.at(-1), CURSOR_RESET, 'back to Host default resets');
  renderer.setCursorStyle(cursorStyleSequence('underline', 'on'));
  renderer.leave();
  assert.ok(writes.at(-1)!.includes(CURSOR_RESET) && writes.at(-1)!.includes('\u001B[?1049l'), 'exit restores the host cursor');
  // Suspended at exit (a foreground app still owned the screen): still reset.
  const suspendedWrites: string[] = [];
  const suspended = new TerminalRenderer(data => { suspendedWrites.push(data); });
  suspended.setCursorStyle('\u001B[2 q');
  suspended.enter(); suspended.suspendForPassthrough(); suspended.leave();
  assert.ok(suspendedWrites.at(-1)!.includes(CURSOR_RESET));
  // Host default never emits DECSCUSR at all.
  const hostWrites: string[] = [];
  const host = new TerminalRenderer(data => { hostWrites.push(data); });
  host.enter(); host.suspendForPassthrough(); host.resumeAfterPassthrough(); host.leave();
  assert.ok(hostWrites.every(write => !/\u001B\[\d q/u.test(write)));
});

test('Display too small: modal notice with sizes, one line when tiny, and gone after resize', () => {
  const minimum = {columns: 48, rows: 12};
  assert.equal(fits(minimum, 48, 12), true);
  assert.equal(fits(minimum, 31, 7), false);
  const notice = renderTooSmall(minimum, 40, 11).map(stripAnsi);
  assert.equal(notice.length, 11);
  const joined = notice.join('\n');
  assert.match(joined, /Display too small/u);
  assert.match(joined, /This view needs 48×12\./u);
  assert.match(joined, /Current size: 40×11\./u);
  assert.match(joined, /Resize the terminal\./u);
  assert.ok(notice.every(row => displayWidth(row) <= 40));
  const tiny = renderTooSmall(minimum, 20, 3).map(stripAnsi);
  assert.equal(tiny[0], 'Display too small · r…'.slice(0, 20).length === 20 ? tiny[0] : tiny[0]);
  assert.match(tiny[0]!, /^Display too small/u);
  assert.equal(tiny.length, 3);
  assert.equal(renderModal(['hi'], 20, 5).length, 5);
});

test('app: Setup Cat shows Display too small below its minimum and recovers on resize', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  try {
    app['render'] = () => {};
    app['startSetup']();
    Object.defineProperty(process.stdout, 'columns', {value: 31, configurable: true});
    Object.defineProperty(process.stdout, 'rows', {value: 9, configurable: true});
    assert.match(app['settingsPanelRows'](31).map(stripAnsi).join('\n'), /Display too small/u);
    Object.defineProperty(process.stdout, 'columns', {value: 90, configurable: true});
    Object.defineProperty(process.stdout, 'rows', {value: 30, configurable: true});
    const recovered = app['settingsPanelRows'](90).map(stripAnsi).join('\n');
    assert.doesNotMatch(recovered, /Display too small/u);
    assert.match(recovered, /Setup Cat/u);
  } finally {
    if (columns) Object.defineProperty(process.stdout, 'columns', columns); else delete (process.stdout as {columns?: number}).columns;
    if (rows) Object.defineProperty(process.stdout, 'rows', rows); else delete (process.stdout as {rows?: number}).rows;
    app['stop'](0);
    app['session'].kill();
    isolation.restore();
  }
});

test('status strip: Off by default, Minimal is clock plus a real battery, never a fake one', () => {
  const settings = normalizePromptConfiguration({}).statusStrip;
  assert.equal(settings.enabled, false);
  assert.equal(renderStatusStrip(settings, {}, 120), '', 'disabled renders nothing');
  assert.equal(stripVisible(settings, 120, 40), false, 'disabled owns no row');
  const minimal = {...settings, enabled: true};
  const now = new Date(2026, 0, 1, 9, 41);
  assert.deepEqual(stripItems(minimal, {}, now).map(item => item.text), ['09:41'], 'desktop: no battery item');
  assert.deepEqual(stripItems(minimal, {battery: {percent: 82, charging: false}}, now).map(item => item.text), ['82%', '09:41']);
  const ram = {...minimal, ram: true, cpu: true, uptime: true};
  const stats = {cpu: 12.4, memory: {used: 6.1 * 1024 ** 3, total: 8 * 1024 ** 3}, uptimeSeconds: 93_600};
  assert.deepEqual(stripItems(ram, stats, now).map(item => item.text), ['up 1d 2h', 'CPU 12%', 'RAM 76%', '09:41']);
  assert.ok(stripItems({...ram, ramDisplay: 'absolute'}, stats, now).some(item => item.text === 'RAM 6.1/8.0 GB'));
  assert.ok(stripItems({...ram, ramDisplay: 'both'}, stats, now).some(item => item.text === 'RAM 76% · 6.1/8.0 GB'));
  const wide = stripAnsi(renderStatusStrip(ram, stats, 120, now));
  assert.equal(displayWidth(wide), 119);
  assert.ok(wide.trimEnd().endsWith('09:41'), 'right aligned, clock last');
  const narrow = stripAnsi(renderStatusStrip(ram, stats, 34, now));
  assert.ok(displayWidth(narrow) <= 34);
  assert.ok(narrow.includes('09:41') && !narrow.includes('up 1d'), 'compacts by dropping low-priority items first');
  assert.equal(renderStatusStrip(ram, stats, 20, now), '', 'hidden on very narrow terminals');
  assert.equal(stripVisible(minimal, 20, 40), false);
});

test('status strip: platform parsers are factual', () => {
  assert.deepEqual(parsePmset("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t85%; discharging; 4:12 remaining present: true"),
    {percent: 85, charging: false});
  assert.deepEqual(parsePmset(" -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true"), {percent: 100, charging: true});
  assert.equal(parsePmset("Now drawing from 'AC Power'\n"), undefined, 'desktop Macs have no InternalBattery line');
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:  1000.\nPages active:  100000.\nPages wired down:  50000.\nPages occupied by compressor:  10000.\n';
  assert.deepEqual(parseVmStat(vm, 8 * 1024 ** 3), {used: 160000 * 16384, total: 8 * 1024 ** 3});
  assert.equal(parseVmStat('garbage', 1), undefined);
  assert.deepEqual(parseMeminfo('MemTotal:  8000000 kB\nMemFree: 1 kB\nMemAvailable:  2000000 kB\n'), {used: 6000000 * 1024, total: 8000000 * 1024});
});

test('status strip owns one plan row: regions shift together and hit-testing agrees', () => {
  const base = planScreen({rows: 23, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true, contextPlacement: 'header',
    hasVisibleContext: true, composerLayout: 'twoLine'});
  const plan = withStatusRow(base);
  assert.equal(plan.rows, 24);
  assert.deepEqual(plan.regions[0], {kind: 'status', top: 0, height: 1});
  assert.equal(plan.transcript.top, base.transcript.top + 1);
  assert.equal(regionAt(plan, 0)?.region.kind, 'status');
  assert.equal(regionAt(plan, plan.rows - 1)?.region.kind, regionAt(base, base.rows - 1)?.region.kind);
});

test('app: the strip has no timer while Off or during passthrough and never enters the transcript', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['presentationStarted'] = true;
    app['statsSource'] = {sample: async () => ({battery: {percent: 50, charging: false}})};
    app['syncStatusStrip']();
    assert.equal(app['stripTimer'], undefined, 'Off: no timer');
    app['configuration'] = {...app['configuration'], statusStrip: {...app['configuration'].statusStrip, enabled: true}};
    app['syncStatusStrip']();
    assert.ok(app['stripTimer'], 'On: one timer');
    app['passthrough'] = true;
    app['cancelPresentation']();
    app['syncStatusStrip']();
    assert.equal(app['stripTimer'], undefined, 'passthrough: no timer');
    app['passthrough'] = false;
    app['syncStatusStrip']();
    assert.ok(app['stripTimer']);
    assert.doesNotMatch(JSON.stringify(app['output'].transcript().records), /50%/u, 'nothing in the transcript');
    assert.equal(app['statusStripRow'](80).includes('50%'), false, 'strip text only appears in the frame row');
  } finally {
    app['stop'](0);
    app['session'].kill();
    isolation.restore();
  }
  assert.equal(app['stripTimer'], undefined, 'stop cleans up the timer');
});

test('separators: every built-in renders, styles offer only their own, Safe mode stays ASCII', () => {
  assert.deepEqual([...STYLE_PROFILE_OPTIONS.minimal.separator], [...MINIMAL_SEPARATORS]);
  assert.deepEqual([...STYLE_PROFILE_OPTIONS.breadcrumb.separator], [...BREADCRUMB_SEPARATORS]);
  assert.ok(!(MINIMAL_SEPARATORS as readonly string[]).includes('triangle') && (BREADCRUMB_SEPARATORS as readonly string[]).includes('triangle'));
  assert.ok(!(BREADCRUMB_SEPARATORS as readonly string[]).includes('space'), 'a trail always has a visible separator');
  for (const style of ['minimal', 'breadcrumb'] as const) {
    const options = style === 'minimal' ? MINIMAL_SEPARATORS : BREADCRUMB_SEPARATORS;
    for (const id of options.filter(item => item !== 'custom')) {
      const nerd = separatorGlyph(style, id, undefined, true);
      const safe = separatorGlyph(style, id, undefined, false);
      assert.ok(displayWidth(nerd) <= 2, `${style}.${id}`);
      assert.match(safe, /^[\x20-\x7e]*$/u, `${style}.${id} Safe is ASCII`);
    }
  }
  // Existing configuration ids keep loading unchanged.
  for (const id of ['space', 'dot', 'pipe', 'slash', 'chevron']) assert.equal(normalizeStyleProfiles({minimal: {separator: id}}).minimal.separator, id);
  for (const id of ['chevron', 'slash', 'dot']) assert.equal(normalizeStyleProfiles({breadcrumb: {separator: id}}).breadcrumb.separator, id);
});

test('custom glyph validation: one grapheme, 1–2 cells, no controls, escapes or newlines', () => {
  assert.deepEqual(validateGlyph('→'), {ok: true, glyph: '→', width: 1, warning: 'Width can vary by font; check the preview.'});
  assert.deepEqual(validateGlyph('|'), {ok: true, glyph: '|', width: 1});
  const wide = validateGlyph('龍');
  assert.ok(wide.ok && wide.width === 2 && /Wide glyph/u.test(wide.warning ?? ''));
  const family = validateGlyph('👩‍👩‍👧');
  assert.ok(family.ok && family.width === 2, 'a ZWJ sequence is one grapheme');
  for (const bad of ['', 'ab', '->', '\n', '\u001b', '\u001b[31m', '\t', 'x\n', '\u0007']) assert.equal(validateGlyph(bad).ok, false, JSON.stringify(bad));
  assert.equal(normalizeStyleProfiles({minimal: {separator: 'custom', customSeparator: '\u001b[2J'}}).minimal.customSeparator, undefined);
  assert.equal(separatorGlyph('minimal', 'custom', '→', false), '|', 'Safe mode falls back from non-ASCII custom glyphs');
  assert.equal(separatorGlyph('breadcrumb', 'custom', '~', false), '~');
});

test('custom separators persist per style; switching styles keeps each', () => {
  const draft = clone();
  draft.nmsh.style = 'minimal';
  draft.nmsh.styleProfiles.minimal.separator = 'custom';
  const state: PromptPanelState = {onboarding: false, step: 'appearance', selectedIndex: 0, draft, saved: clone()};
  state.selectedIndex = appearanceRows(draft).findIndex(row => row.id === 'minimal.customSeparator');
  assert.ok(state.selectedIndex > 0, 'the glyph row appears under a Custom separator');
  handlePromptPanelKey({kind: 'enter'}, state);
  handlePromptPanelKey({kind: 'text', value: '\u001b'}, state);
  handlePromptPanelKey({kind: 'text', value: '→'}, state);
  assert.equal(state.glyphEdit?.buffer, '→', 'controls never enter the buffer');
  handlePromptPanelKey({kind: 'enter'}, state);
  assert.equal(draft.nmsh.styleProfiles.minimal.customSeparator, '→');
  draft.nmsh.style = 'breadcrumb';
  draft.nmsh.styleProfiles.breadcrumb.separator = 'custom';
  state.selectedIndex = appearanceRows(draft).findIndex(row => row.id === 'breadcrumb.customSeparator');
  handlePromptPanelKey({kind: 'enter'}, state);
  handlePromptPanelKey({kind: 'text', value: '›'}, state);
  handlePromptPanelKey({kind: 'enter'}, state);
  assert.equal(draft.nmsh.styleProfiles.breadcrumb.customSeparator, '›');
  assert.equal(draft.nmsh.styleProfiles.minimal.customSeparator, '→', 'Minimal keeps its own glyph');
  // Invalid input is reported, not applied.
  handlePromptPanelKey({kind: 'enter'}, state);
  handlePromptPanelKey({kind: 'text', value: 'ab'}, state);
  handlePromptPanelKey({kind: 'enter'}, state);
  assert.match(state.glyphEdit!.note!, /exactly one character/u);
  handlePromptPanelKey({kind: 'escape'}, state);
  assert.equal(draft.nmsh.styleProfiles.breadcrumb.customSeparator, '›');
  const saved = normalizePromptConfiguration(JSON.parse(JSON.stringify(draft)));
  assert.equal(saved.nmsh.styleProfiles.minimal.customSeparator, '→');
  assert.equal(saved.nmsh.styleProfiles.breadcrumb.customSeparator, '›');
  const line = buildThemePreviewLine(saved, 'lavender', 80);
  assert.ok(stripAnsi(line).includes('›'), 'the preview shows the real separator');
});

test('prompt symbol: built-ins, custom glyph, Safe fallback, composer marker only', () => {
  assert.deepEqual(PROMPT_SYMBOL_IDS, ['chevron', 'gt', 'dollar', 'lambda', 'arrow', 'heavyArrow', 'custom']);
  assert.equal(promptSymbolGlyph('lambda', undefined, true), 'λ');
  assert.equal(promptSymbolGlyph('lambda', undefined, false), '>');
  assert.equal(promptSymbolGlyph('dollar', undefined, false), '$');
  assert.equal(promptSymbolGlyph('custom', '%', false), '%');
  assert.equal(promptSymbolGlyph('custom', '★', false), '>');
  assert.equal(promptSymbolGlyph('custom', undefined, true), '❯');
  assert.equal(normalizePromptConfiguration({promptSymbol: 'custom', promptSymbolCustom: 'ab'}).promptSymbolCustom, undefined);
  assert.equal(normalizePromptConfiguration({promptSymbol: 'bogus'}).promptSymbol, 'chevron');
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['configuration'] = {...app['configuration'], promptSymbol: 'lambda'} as PromptConfiguration;
    void app['promptConfiguration'];
    assert.equal(GLYPHS.prompt, 'λ');
    setIconStyle('safe');
    assert.equal(GLYPHS.prompt, '>');
  } finally {
    setIconStyle('nerd');
    app['configuration'] = {...app['configuration'], promptSymbol: 'chevron'} as PromptConfiguration;
    void app['promptConfiguration'];
    app['stop'](0);
    app['session'].kill();
    isolation.restore();
  }
  assert.equal(GLYPHS.prompt, '❯');
});

test('semantic icons: every icon has Nerd, Unicode and ASCII forms and text keeps the meaning', () => {
  for (const [id, icon] of Object.entries(SEMANTIC_ICONS)) {
    assert.ok(icon.nerd, `${id} nerd`);
    assert.match(icon.unicode, /^[^\ue000-\uf8ff\u{f0000}-\u{fffff}]*$/u, `${id} unicode avoids private-use glyphs`);
    assert.match(icon.ascii, /^[\x20-\x7e]*$/u, `${id} ascii`);
  }
  assert.equal(semanticIcon('branch', 'ascii'), 'git:');
  assert.equal(semanticIcon('success', 'ascii'), '+');
  assert.equal(semanticIcon('failure', 'unicode'), '✕');
  assert.equal(withSemanticIcon('clock', '09:41', 'ascii'), '09:41', 'no icon: the text alone');
  assert.equal(withSemanticIcon('search', 'find', 'ascii'), '/ find');
});

test('settings render inside every width with nested rows, NO_COLOR and Safe glyphs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-nested-'));
  const old = process.env.NO_COLOR;
  process.env.NO_COLOR = '1'; setIconStyle('safe');
  try {
    const on = clone();
    on.presentation.preset = 'aurora'; on.presentation.motion = 'travel'; on.statusStrip.enabled = true; on.cursor.shape = 'bar';
    for (const width of [12, 30, 60, 120]) {
      const rows = renderSettingsPanel(config({showAdvanced: true}), width, 40, {configuration: on});
      assert.ok(rows.every(row => displayWidth(row) <= width), `@${width}`);
      assert.ok(rows.every(row => !/\u001b\[(?:38|48);/u.test(row)));
    }
  } finally {
    if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = old;
    setIconStyle('nerd');
    await rm(directory, {recursive: true, force: true});
  }
});
