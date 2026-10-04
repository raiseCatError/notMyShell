import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {KeyDecoder} from '../src/terminal/keys.js';
import {DEFAULT_TREATMENT_SETTINGS, normalizeTreatmentSettings, paintDivider, treatmentFor, treatmentText} from '../src/chroma/treatment.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {SETTINGS_ROWS, adjustSettingsRow, settingsRowValue} from '../src/ui/SettingsPanel.js';
import {applyUiTheme, uiColorsFor} from '../src/appearance/uiTheme.js';
import {normalizeUiChrome, resolveChrome} from '../src/appearance/uiChrome.js';
import {contrastRatio, parseHexColor, toOklch} from '../src/chroma/color.js';
import {CHROMA_PREVIEW_NOTE, createSetup, NATIVE_ONLY_NOTE, NATIVE_PROMPT_RECOMMENDATION, renderSetup, sectionIndex, SETUP_SECTIONS, setupKey} from '../src/setup/SetupCat.js';
import {glyphDiagnosticRows} from '../src/setup/glyphDiagnostic.js';
import {idleStops, withIdleColorSource} from '../src/idle/IdleVisuals.js';
import {liveActivityPaint} from '../src/status/liveActivityColors.js';
import {completedActivity} from '../src/status/activity.js';
import {renderCompletion} from '../src/shell/CompletionMenu.js';
import type {CompletionCandidate} from '../src/shell/completion.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;
const plain = (rows: readonly string[]) => rows.map(stripAnsi).join('\n');
const colors = (ansi: string) => [...ansi.matchAll(/\u001B\[38;2;(\d+);(\d+);(\d+)m/gu)].map(match => ({red: Number(match[1]), green: Number(match[2]), blue: Number(match[3])}));

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

// ---- A. Defaults, layouts and copy ---------------------------------------------------

test('A: new configs default to Full Chroma, Override, Whole prompt, Divider lines Follow Chroma, Static; saved choices stay', () => {
  const fresh = normalizePromptConfiguration({}).presentation;
  assert.deepEqual([fresh.intensity, fresh.semantic, fresh.scope, fresh.rules, fresh.motion], [0.9, 'override', 'prompt', true, 'static']);
  assert.deepEqual([DEFAULT_TREATMENT_SETTINGS.scope, DEFAULT_TREATMENT_SETTINGS.rules], ['prompt', true]);
  const saved = normalizeTreatmentSettings({preset: 'aurora', scope: 'identity', rules: false});
  assert.deepEqual([saved.scope, saved.rules], ['identity', false], 'explicitly saved scope and divider choice are unchanged');
});

test('A: static Right → Left is a spatial layout of its own, the exact mirror of Left → Right', () => {
  const settings = {...DEFAULT_TREATMENT_SETTINGS, preset: 'rainbow' as const, intensity: 1};
  const paint = (geometry: 'linear' | 'linear-reverse') => colors(treatmentText('██████████', treatmentFor({...settings, geometry})!, {role: 'effect', base: {red: 0, green: 0, blue: 0}, level: 'truecolor'}, 0));
  assert.deepEqual(paint('linear-reverse'), [...paint('linear')].reverse());
  assert.deepEqual(row('treatmentGeometry').control === 'enum' && row('treatmentGeometry').options,
    ['Left → Right', 'Right → Left', 'Center → Outward', 'Outside → Center']);
});

test('A: "Rules" is now Divider lines: Follow Chroma (default) / Follow UI theme, with its help text', () => {
  const divider = row('chromaRules');
  assert.equal(divider.label, 'Divider lines');
  assert.equal(divider.description, 'Colors the composer and command-history divider lines. Panel borders follow UI chrome.');
  assert.deepEqual(divider.control === 'enum' && divider.options, ['Follow Chroma', 'Follow UI theme']);
  const config = normalizePromptConfiguration({presentation: {preset: 'aurora'}});
  assert.equal(settingsRowValue(divider, config), 'Follow Chroma');
  assert.equal(adjustSettingsRow(divider, config, 1)!.presentation.rules, false);
});

// ---- B. Divider lines ------------------------------------------------------------------

test('B: every live composer divider line (top, bottom and the prompt row fill) takes the same source', () => {
  for (const rules of [true, false]) {
    const {app, frames, cleanup} = harness({welcome: 'none', placement: 'header', composerLayout: 'twoLine', presentation: {preset: 'rainbow', rules}});
    try {
      app['render']();
      const rows = frames.at(-1)!.rows;
      const plan = app['presentationFrame']!.plan;
      const lines = plan.regions.filter(region => ['composerBorder', 'separator', 'prompt'].includes(region.kind) && region.height > 0)
        .map(region => rows[region.top]!).filter(item => /─{6,}/u.test(stripAnsi(item)));
      assert.ok(lines.length >= 2, 'composer divider lines and the prompt fill are drawn');
      for (const line of lines) {
        const fill = line.slice(line.lastIndexOf('\u001B[0m', line.indexOf('─')) + 1);
        const hues = new Set(colors(fill).map(color => `${color.red},${color.green},${color.blue}`));
        if (rules) assert.ok(hues.size > 3, `${JSON.stringify(line)} Follow Chroma paints a gradient on every divider line: ${stripAnsi(line).slice(0, 20)}`);
        else assert.ok(hues.size <= 1, 'Follow UI theme is the one separator color everywhere');
      }
    } finally { cleanup(); }
  }
});

test('B: history dividers are Chroma-colored but static, and no frame timer runs for a static treatment', () => {
  const settings = normalizeTreatmentSettings({preset: 'aurora', motion: 'comet'});
  assert.equal(paintDivider('──────────', settings, 0, false), paintDivider('──────────', settings, 2500, false), 'historical lines never move');
  assert.notEqual(paintDivider('──────────', settings, 0, true), paintDivider('──────────', settings, 2500, true), 'the live line may move');
  const {app, cleanup} = harness({presentation: {preset: 'aurora', motion: 'static'}});
  try {
    app['render']();
    assert.equal(app['presentationSubscription'], undefined, 'no animation subscriber for static Chroma dividers');
  } finally { cleanup(); }
});

// ---- C/H. Chroma note and a live preview ------------------------------------------------

test('C/H: Setup Cat Appearance says when previews include Chroma, and its Chroma preview moves with motion', () => {
  const {app, cleanup} = harness({});
  try {
    app['render'] = () => {};
    app['startSetup']('appearance');
    const state = app['setupState']!;
    state.draft = normalizePromptConfiguration({presentation: {preset: 'off'}});
    assert.doesNotMatch(plain(app['setupPreview'](state, 100)), /previews include Chroma/u);
    state.draft = normalizePromptConfiguration({presentation: {preset: 'aurora', motion: 'comet'}});
    // The base theme is shown by default; P turns the local preview Chroma on (the setting itself is unchanged).
    assert.match(plain(app['setupPreview'](state, 100)), /Preview Chroma  Off/u);
    state.previewChroma = true;
    assert.ok(plain(app['setupPreview'](state, 100)).includes(CHROMA_PREVIEW_NOTE));
    const chromaRow = (rows: string[]) => rows.find(item => stripAnsi(item).trimStart().startsWith('Chroma'))!;
    const realNow = Date.now;
    try {
      Date.now = () => 1_000; const first = chromaRow(app['setupPreview'](state, 100));
      Date.now = () => 3_000; const later = chromaRow(app['setupPreview'](state, 100));
      assert.notEqual(first, later, 'Comet visibly moves');
      state.draft = normalizePromptConfiguration({presentation: {preset: 'aurora', motion: 'static'}});
      Date.now = () => 1_000; const still = chromaRow(app['setupPreview'](state, 100));
      Date.now = () => 3_000; assert.equal(chromaRow(app['setupPreview'](state, 100)), still, 'Static stays static');
    } finally { Date.now = realNow; }
  } finally { cleanup(); }
});

// ---- D. Theme text ----------------------------------------------------------------------

test('D: Theme text On lets the variant supply text tiers; Off keeps NMSh neutral text; light variants stay readable', () => {
  const on = normalizeUiChrome({});
  assert.equal(on.themeText, true, 'On by default');
  const gruvbox = resolveChrome(on, 'gruvboxDark', 'mauve', undefined)!;
  const mocha = resolveChrome(on, 'catppuccinMocha', 'mauve', undefined)!;
  assert.equal(gruvbox.primary, '#ebdbb2');
  assert.notEqual(gruvbox.secondary, mocha.secondary, 'switching variants changes the text colors');
  const latte = resolveChrome(on, 'catppuccinLatte', 'mauve', undefined)!;
  assert.ok(latte.primary && toOklch(parseHexColor(latte.primary)!).l > 0.85, 'a light variant gets readable text tiers of its own hue');
  const forest = resolveChrome(on, 'forest', 'mauve', undefined)!;
  assert.ok(forest.primary && forest.secondary && forest.subtle, 'NMSh Native themes have an intentional text palette');
  const off = resolveChrome({...on, themeText: false}, 'gruvboxDark', 'mauve', undefined)!;
  assert.equal(off.primary, undefined, 'Off: neutral NMSh text');
  assert.equal(off.success, gruvbox.success, 'semantic colors are untouched by the text option');
  try {
    applyUiTheme(uiColorsFor(gruvbox));
    assert.deepEqual({...UI_COLORS.primary}, parseHexColor('#ebdbb2'));
  } finally { applyUiTheme(undefined); }
});

// ---- E. Live activity -------------------------------------------------------------------

test('E: Live activity colors follow their source; only the live line moves; finished commands stay semantic and static', () => {
  const base = (patch: object) => normalizePromptConfiguration({presentation: {preset: 'rainbow', semantic: 'override'}, ...patch});
  const phrase = '• Running sleep 5 · ';
  const gray = liveActivityPaint(phrase, base({liveActivity: {colors: 'grayscale'}}));
  assert.ok(gray.style.grayscale && gray.cells.every(cell => !cell.color || (cell.color.red === cell.color.green || Math.abs(cell.color.red - cell.color.blue) < 12)), 'Grayscale has no hue');
  const follow = liveActivityPaint(phrase, base({}));
  assert.ok(new Set(follow.cells.filter(cell => cell.color).map(cell => JSON.stringify(cell.color))).size > 3, 'Follow appearance uses Chroma when it is on');
  const preserve = liveActivityPaint(phrase, base({presentation: {preset: 'rainbow', semantic: 'preserve'}}));
  assert.equal(new Set(preserve.cells.filter(cell => cell.color).map(cell => JSON.stringify(cell.color))).size, 1, 'Preserve keeps the working color');
  const lavender = liveActivityPaint(phrase, base({liveActivity: {colors: 'lavender'}, nmsh: {palette: 'gruvboxDark'}}));
  assert.deepEqual(lavender.cells[0]!.color, liveActivityPaint(phrase, base({liveActivity: {colors: 'lavender'}})).cells[0]!.color, 'Native Lavender ignores the theme');
  const custom = liveActivityPaint(phrase, base({liveActivity: {colors: 'custom', customStops: ['#ff0000', '#0000ff']}}));
  assert.ok(custom.cells[0]!.color!.red > custom.cells[0]!.color!.blue, 'Custom gradient starts at its first stop');
  assert.equal(normalizePromptConfiguration({liveActivity: {colors: 'custom'}}).liveActivity.colors, 'appearance', 'Custom needs stops');
  // Completion is the ordinary semantic final state, independent of time and colors.
  const done = completedActivity('sleep 5', 5_000, new Date(0), 0, false);
  assert.deepEqual(completedActivity('sleep 5', 5_000, new Date(0), 0, false), done);
  assert.match(done.main, /Completed/u);
  assert.deepEqual(parseSlashCommand('/activity'), {kind: 'activity'});
});

// ---- F/G/I/J. Setup Cat -----------------------------------------------------------------

test('F: the Prompt step preview matches the provider; Native-only rows hide for external providers', async () => {
  const {app, cleanup} = harness({});
  try {
    app['render'] = () => {};
    app['startSetup']('prompt');
    const state = app['setupState']!;
    assert.ok(plain(renderSetup(state, 120, 40)).replace(/\s+/gu, ' ').includes(NATIVE_PROMPT_RECOMMENDATION));
    assert.match(plain(app['setupPreview'](state, 100)), /notMyShell/u, 'Native shows the Native preview');
    state.draft = {...state.draft, provider: 'starship'};
    app['renderExternalPrompt'] = async () => { throw new Error('Starship is not installed or not available on PATH.'); };
    app['setupExternalPrompt'] = undefined;
    app['setupPreview'](state, 100);
    await new Promise(resolve => setImmediate(resolve));
    const preview = plain(app['setupPreview'](state, 100));
    assert.doesNotMatch(preview, /notMyShell/u, 'never the Native prompt standing in for Starship');
    assert.match(preview, /Starship is not installed/u, 'a factual status instead');
    assert.ok(preview.includes(NATIVE_ONLY_NOTE));
    const screen = plain(renderSetup(state, 120, 40));
    assert.doesNotMatch(screen, /Prompt style/u, 'Native-only rows are hidden');
  } finally { cleanup(); }
});

test('F: Enter shows every choice of an option row; ↑↓ previews live, Enter keeps, Esc restores', () => {
  const state = createSetup(normalizePromptConfiguration({}), 'appearance');
  state.row = SETUP_SECTIONS[state.section]!.rows.findIndex(item => item.row.id === 'themeFamily');
  const before = state.draft.nmsh.palette;
  setupKey(state, {kind: 'enter'});
  assert.ok(state.chooser, 'choices open');
  const screen = plain(renderSetup(state, 100, 60));
  for (const family of ['NMSh', 'Catppuccin', 'Gruvbox']) assert.match(screen, new RegExp(family, 'u'), `${family} is visible`);
  setupKey(state, {kind: 'down'});
  assert.notEqual(state.draft.nmsh.palette, before, 'the highlighted choice previews live');
  setupKey(state, {kind: 'escape'});
  assert.equal(state.draft.nmsh.palette, before, 'Esc restores');
  assert.equal(state.chooser, undefined);
  setupKey(state, {kind: 'enter'}); setupKey(state, {kind: 'down'}); setupKey(state, {kind: 'enter'});
  assert.notEqual(state.draft.nmsh.palette, before, 'Enter keeps the choice');
  assert.equal(state.section, sectionIndex('appearance'), 'still on the same step');
});

test('G: the glyph diagnostic draws real production glyphs in both modes, column-aligned', () => {
  const rows = glyphDiagnosticRows('nerd').map(stripAnsi);
  const nerd = rows.find(item => item.includes('Nerd Font'))!;
  const safe = rows.find(item => item.includes('Safe/ASCII'))!;
  for (const glyph of ['', '', '', '✔', '❯']) assert.ok(nerd.includes(glyph), `Nerd row has ${JSON.stringify(glyph)}`);
  assert.match(safe, /git:main/u);
  assert.doesNotMatch(safe, /[-]/u, 'the Safe row is plain');
  assert.equal(displayWidth(nerd.trimEnd()) - displayWidth(safe.trimEnd()) <= 4, true, 'rows line up for comparison');
});

test('I: the Editor preview reacts to position, transcript, folding and empty-prompt prediction', () => {
  const {app, cleanup} = harness({});
  try {
    const preview = (patch: Partial<PromptConfiguration>) => plain(app['setupEditorPreview'](normalizePromptConfiguration({...patch}), 80));
    const bottom = preview({composerPosition: 'bottom'});
    const top = preview({composerPosition: 'top'});
    assert.ok(bottom.indexOf('npm test') < bottom.indexOf('git commit'), 'Bottom: transcript above the composer');
    assert.ok(top.indexOf('git commit') < top.indexOf('npm test'), 'Top: composer first');
    assert.match(preview({transcriptPresentation: 'chat'}), /npm test .*$/mu);
    assert.notEqual(preview({transcriptPresentation: 'chat'}), preview({transcriptPresentation: 'normal'}));
    assert.match(preview({outputFolding: 'smart'}), /folded/u);
    assert.doesNotMatch(preview({outputFolding: 'never'}), /lines folded/u);
    assert.match(preview({suggestionsOnEmpty: true}), /predicted before typing/u);
    assert.match(preview({suggestions: 'nmsh'}), /--amend/u, 'ghost text');
  } finally { cleanup(); }
});

test('J: the Setup Cat footer advertises Tab and Shift+Tab', () => {
  for (const id of ['welcome', 'terminal', 'review']) {
    const state = createSetup(normalizePromptConfiguration({}));
    state.section = sectionIndex(id);
    const screen = plain(renderSetup(state, 120, 40));
    assert.match(screen, /Tab next/u);
    assert.match(screen, /Shift\+Tab previous section/u);
  }
});

// ---- K. Idle colors ---------------------------------------------------------------------

test('K: idle colors: Follow Chroma / Theme, Theme only, Custom', () => {
  const idle = row('idleColor');
  assert.deepEqual(idle.control === 'enum' && idle.options, ['Follow Chroma / Theme', 'Theme only', 'Custom']);
  const chroma = normalizePromptConfiguration({presentation: {preset: 'rainbow'}});
  const theme = idleStops(chroma, 'theme');
  assert.notDeepEqual(idleStops(chroma, 'appearance'), theme, 'Follow uses Chroma when it is on');
  assert.deepEqual(idleStops(normalizePromptConfiguration({presentation: {preset: 'off'}}), 'appearance'), idleStops(normalizePromptConfiguration({}), 'theme'), 'otherwise the theme');
  const seeded = withIdleColorSource(chroma, 'custom');
  assert.equal(seeded.colorSource, 'custom');
  assert.ok(seeded.customStops.length >= 2, 'Custom starts from the colors in effect');
  const custom = normalizePromptConfiguration({idleVisuals: {colorSource: 'custom', customStops: ['#ff0000', '#00ff00']}});
  assert.deepEqual(idleStops(custom), [{red: 255, green: 0, blue: 0}, {red: 0, green: 255, blue: 0}]);
});

// ---- L. Optional tools return ------------------------------------------------------------

test('L: Browse optional tools → Esc returns to the exact step and row; the next key behaves normally', async () => {
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const scenarios: Array<[string, string, (state: ReturnType<typeof createSetup>, app: TerminalApp, row: number) => void]> = [
    ['Left', '\u001B[D', (state, app, row) => { assert.equal(app['setupState'], state); assert.equal(state.row, row); }],
    ['Right', '\u001B[C', (state, app, row) => { assert.equal(app['setupState'], state); assert.equal(state.row, row); }],
    ['Tab', '\t', (state, app) => { assert.equal(app['setupState'], state); assert.equal(state.section, sectionIndex('review')); }],
    ['Shift+Tab', '\u001B[Z', (state, app) => { assert.equal(app['setupState'], state); assert.equal(state.section, sectionIndex('idle')); }],
    ['Enter', '\r', (state, app) => { assert.equal(app['setupState'], state); assert.ok(state.toolBrowser, 'Enter on the Browse row opens it again'); }],
  ];
  for (const [name, bytes, check] of scenarios) {
    const {app, cleanup} = harness({});
    try {
      app['render'] = () => {};
      app['startSetup']('tools');
      const state = app['setupState']!;
      state.draft = {...state.draft, toolUpdateChecks: 'weekly'};
      for (let index = 0; index < 6; index++) app['onInput']('\u001B[B');
      const row = state.row;
      app['onInput']('\r');
      assert.ok(state.toolBrowser, `${name}: browsing`);
      app['onInput']('\u001B');
      await wait(80);
      assert.equal(state.toolBrowser, undefined, `${name}: Esc alone returns to Setup Cat`);
      assert.equal(app['setupState'], state);
      assert.equal(state.section, sectionIndex('tools'));
      assert.equal(state.row, row, 'the same row');
      assert.equal(state.draft.toolUpdateChecks, 'weekly', 'the draft is intact');
      app['onInput'](bytes);
      await wait(80);
      check(state, app, row);
    } finally { cleanup(); }
  }
  // Repeated enter/exit.
  const {app, cleanup} = harness({});
  try {
    app['render'] = () => {};
    app['startSetup']('tools');
    const state = app['setupState']!;
    for (let index = 0; index < 6; index++) app['onInput']('\u001B[B');
    for (let round = 0; round < 3; round++) {
      app['onInput']('\r'); assert.ok(state.toolBrowser);
      app['onInput']('\u001B'); await wait(80);
      assert.equal(state.toolBrowser, undefined); assert.equal(app['setupState'], state);
    }
  } finally { cleanup(); }
});

test('L: a lone ESC byte is the Escape key after a short pause, never glued to the next key', () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B'), []);
  assert.equal(decoder.pendingEscape, true);
  assert.deepEqual(decoder.flush(), [{kind: 'escape'}]);
  assert.deepEqual(decoder.push('\u001B[C'), [{kind: 'right'}], 'the next key is only itself');
  assert.equal(decoder.pendingEscape, false);
});

// ---- P/Q. Completion rows ----------------------------------------------------------------

const candidate = (display: string, patch: Partial<CompletionCandidate> = {}): CompletionCandidate =>
  ({value: display, display, kind: 'command', identity: 'executable', ...patch}) as CompletionCandidate;

test('P: the selected completion row stays readable on the selection band in every chrome', () => {
  const chromes: Array<[string, object]> = [['shipped', {}], ['grayscale', {source: 'custom', preset: 'grayscale'}],
    ['catppuccin latte', {}], ['custom', {source: 'custom', preset: 'custom', colors: {accent: '#3a3aff', primary: '#303040', secondary: '#404050', subtle: '#505060',
      separator: '#445566', selection: '#5a5a7a', success: '#00aa00', warning: '#aaaa00', failure: '#aa0000', info: '#0088aa'}}]];
  for (const [name, chrome] of chromes) {
    const palette = name === 'catppuccin latte' ? 'catppuccinLatte' : 'lavender';
    try {
      applyUiTheme(uiColorsFor(resolveChrome(normalizeUiChrome(chrome), palette, 'mauve', undefined)));
      for (const item of [candidate('package.json', {kind: 'file', description: 'file'}), candidate('src', {kind: 'directory', description: 'directory'}),
        candidate('npm', {description: 'package manager'})]) {
        const selected = renderCompletion(item, true, 80);
        const painted = colors(selected);
        assert.ok(painted.length >= 3, `${name}: pointer, icon, name and detail are colored`);
        for (const color of painted) assert.ok(contrastRatio(color, UI_COLORS.selection) >= 3, `${name}: ${JSON.stringify(color)} readable on the band`);
        assert.ok(contrastRatio(painted.at(-1)!, UI_COLORS.selection) >= 4.5, `${name}: the description stays readable`);
        assert.equal(renderCompletion(item, false, 80).includes('\u001B[48;'), false, 'unselected rows have no band');
      }
    } finally { applyUiTheme(undefined); }
  }
});

test('Q: every completion row shows its description, muted; names keep priority and long descriptions truncate', () => {
  const items = [candidate('npm', {description: 'package manager'}), candidate('npx', {description: 'run a command from a local or remote npm package'}),
    candidate('nproc', {description: 'print the number of processing units'})];
  const rows = items.map(item => stripAnsi(renderCompletion(item, false, 80)));
  for (const [index, item] of items.entries()) assert.ok(rows[index]!.includes(item.description!.slice(0, 24)), `unselected rows show the description: ${rows[index]}`);
  const nameColumn = rows.map(line => line.indexOf(line.trim().split(/\s+/u)[2]!));
  assert.equal(new Set(nameColumn).size, 1, 'descriptions start in one stable column');
  assert.ok(renderCompletion(items[0]!, false, 80).includes(`\u001B[38;2;${UI_COLORS.subtle.red};${UI_COLORS.subtle.green};${UI_COLORS.subtle.blue}m`), 'muted on ordinary rows');
  const narrow = stripAnsi(renderCompletion(items[1]!, false, 44));
  assert.ok(displayWidth(narrow) <= 44 && narrow.includes('npx') && narrow.trimEnd().endsWith('…'), 'truncated with an ellipsis, name intact');
  assert.match(stripAnsi(renderCompletion(items[1]!, false, 20)), /npx/u, 'very narrow: the name wins');
  assert.equal(stripAnsi(renderCompletion(candidate('ls'), false, 80)).trimEnd().endsWith('ls'), true, 'no invented description');
  const selected = renderCompletion(items[1]!, true, 80);
  assert.match(stripAnsi(selected), /run a command/u, 'the selected row keeps its description');
  assert.match(selected, /\u001B\[1m/u, 'the name is the strongest element');
});
