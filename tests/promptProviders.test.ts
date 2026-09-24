import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, chmod, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveColor} from '../src/prompt/snapshot.js';
import {edgeParts, normalizeEdgeStyle, POWERLINE_EDGE_STYLES, renderPowerlineBlocks} from '../src/prompt/powerline.js';
import {buildContextLine, buildThemePreviewLine, NATIVE_PROMPT_THEMES, NMSH_BRAND_LAVENDER, nativePromptSnapshot, renderedModules} from '../src/prompt/prompt.js';
import {applyNativeGapChoice, NATIVE_PALETTE_IDS, nativeGapChoice, normalizePromptConfiguration, DEFAULT_PROMPT_CONFIGURATION, savePromptConfiguration, loadPromptConfiguration} from '../src/prompt/configuration.js';
import {detectStarship, normalizeStarshipConfigPath, parseStarshipPrompt, renderStarshipPrompt} from '../src/prompt/starship.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {APPEARANCE_MODULES_ROW, applyLayoutChoice, describePromptConfiguration, handlePromptPanelKey, LAYOUT_CHOICES, layoutChoiceIndex, promptDraftChanged, renderPromptPanel} from '../src/prompt/PromptPanel.js';
import {detectToolchains} from '../src/shell/ShellContext.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';

const lum = (color: {red: number; green: number; blue: number}) => {
  const f = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(color.red) + 0.7152 * f(color.green) + 0.0722 * f(color.blue);
};
const contrast = (a: {red: number; green: number; blue: number}, b: {red: number; green: number; blue: number}) => {
  const [high, low] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};

test('five visible native themes exist, stay readable, and keep adjacent segments distinct', () => {
  assert.deepEqual(NATIVE_PALETTE_IDS, ['lavender', 'brand', 'cool', 'warm', 'grayscale']);
  assert.deepEqual(NATIVE_PALETTE_IDS.map(id => NATIVE_PROMPT_THEMES[id].label),
    ['Lavender Native', 'Brand / Semantic', 'Cool First', 'Warm First', 'Grayscale']);
  const order = ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'failure'] as const;
  for (const id of NATIVE_PALETTE_IDS) {
    const theme = NATIVE_PROMPT_THEMES[id];
    for (const role of order) {
      const colors = theme.colors(role);
      assert.ok(contrast(colors.foreground, colors.background) >= 2.7, `${id} ${role} text contrast`);
    }
    for (let index = 1; index < order.length; index += 1) {
      assert.notDeepEqual(theme.colors(order[index]!).background, theme.colors(order[index - 1]!).background, `${id} ${order[index]}`);
    }
  }
  for (const role of order) {
    const {red, green, blue} = NATIVE_PROMPT_THEMES.grayscale.colors(role).background;
    assert.ok(red === green && green === blue || Math.max(red, green, blue) - Math.min(red, green, blue) <= 10, `grayscale ${role} has no hue`);
  }
  for (let index = 1; index < order.length; index += 1) {
    const a = NATIVE_PROMPT_THEMES.grayscale.colors(order[index]!).background;
    const b = NATIVE_PROMPT_THEMES.grayscale.colors(order[index - 1]!).background;
    assert.ok(contrast(a, b) >= 1.7, `grayscale neighbours separate by luminance alone (${order[index]})`);
  }
});

test('conditional Native modules receive continuous palette indices and selectable gap/end appearance', () => {
  const config = normalizePromptConfiguration({nmsh: {gapEnabled: false, endStyle: 'fadeFlat'}});
  assert.equal(config.nmsh.gapEnabled, false);
  assert.equal(config.nmsh.endStyle, 'fadeFlat');
  const context = {cwd: '/tmp/work', project: 'repo', branch: undefined, exitStatus: 0};
  const modules = renderedModules(context, normalizePromptConfiguration({
    modules: [
      {id: 'project', visible: true, condition: 'always'},
      {id: 'cwd', visible: true, condition: 'always'},
      {id: 'gitBranch', visible: true, condition: 'inRepository'},
      {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
    ],
  }));
  assert.equal(modules.length, 2);
  const expected = [NATIVE_PROMPT_THEMES.lavender.colors('project').background, NATIVE_PROMPT_THEMES.lavender.colors('cwd').background];
  assert.deepEqual(modules.map(module => module.background), expected);
  assert.deepEqual(nativePromptSnapshot(context, config).segments.map(segment => segment.background), expected);
});

test('archive color transform preserves green and purple pigment while reducing emphasis', () => {
  const green = archiveColor({red: 25, green: 180, blue: 90});
  assert.ok(green.green > green.red * 1.5);
  assert.ok(green.green > green.blue * 1.3);
  const purple = archiveColor({red: 145, green: 90, blue: 210});
  assert.ok(purple.blue > purple.green * 1.5);
  assert.ok(purple.red > purple.green * 1.2);
  const white = archiveColor({red: 250, green: 250, blue: 250});
  assert.ok(white.red < 250 && white.green < 250 && white.blue < 250);
  const whiteBg = archiveColor({red: 250, green: 250, blue: 250}, 'background');
  assert.ok(whiteBg.red < 250 && whiteBg.green < 250 && whiteBg.blue < 250);
});

test('Starship config path respects STARSHIP_CONFIG, tilde, and normal defaults', () => {
  assert.equal(normalizeStarshipConfigPath({STARSHIP_CONFIG: '~/theme.toml'}, '/Users/example'), '/Users/example/theme.toml');
  assert.equal(normalizeStarshipConfigPath({XDG_CONFIG_HOME: '/tmp/config'}, '/Users/example'), '/tmp/config/starship.toml');
  assert.equal(normalizeStarshipConfigPath({}, '/Users/example'), '/Users/example/.config/starship.toml');
});

test('Starship ANSI prompt becomes semantic styled spans and multiline output is flattened', () => {
  const parsed = parseStarshipPrompt('path \u001B[38;2;10;210;80mgreen\u001B[0m\nnext');
  assert.equal(parsed.text, 'path green next');
  assert.equal(parsed.normalizedMultiline, true);
  assert.equal(parsed.segments[0]?.text, 'path ');
  assert.deepEqual(parsed.segments[1]?.foreground, {red: 10, green: 210, blue: 80});
  assert.equal(parsed.segments[2]?.text, ' next');
  assert.ok(parsed.segments.every(segment => segment.geometry === 'plain'));
});

test('Starship detection reports missing binaries, and a detected provider is invoked only when refreshed', async () => {
  const missing = await detectStarship({HOME: '/tmp', PATH: ''}, undefined);
  assert.equal(missing.installed, false);
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-starship-'));
  const cwd = join(directory, 'project');
  const binary = join(directory, 'starship');
  await mkdir(cwd);
  await writeFile(binary, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo starship 9.9.9; else printf "\\033[38;2;25;180;90mrepo\\033[0m\\nnext\\n"; fi\n', 'utf8');
  await chmod(binary, 0o755);
  try {
    const status = await detectStarship({HOME: directory, PATH: ''}, binary);
    assert.equal(status.installed, true);
    assert.equal(status.version, 'starship 9.9.9');
    const result = await renderStarshipPrompt({cwd, project: 'repo', branch: 'main', exitStatus: 0}, status, {HOME: directory, PATH: ''});
    assert.equal(result.text, 'repo next');
    assert.equal(result.normalizedMultiline, true);
    assert.deepEqual(result.segments[0]?.foreground, {red: 25, green: 180, blue: 90});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('inactive Starship settings survive provider changes and normal config persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-prompt-config-'));
  const path = join(directory, 'config.json');
  try {
    const config = normalizePromptConfiguration({provider: 'starship', composerLayout: 'oneLine', starship: {configPath: '/tmp/custom.toml'}});
    config.provider = 'nmsh';
    savePromptConfiguration(config, path);
    const restored = loadPromptConfiguration(path);
    assert.equal(restored.provider, 'nmsh');
    assert.equal(restored.composerLayout, 'oneLine');
    assert.equal(restored.starship.configPath, '/tmp/custom.toml');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('onboarding preview uses a dedicated panel and hides the live composer cursor', () => {
  const app = new TerminalApp();
  let frame: TerminalFrame | undefined;
  try {
    app['fetchSuggestions'] = async () => {};
    app['renderer'].render = next => { frame = next; };
    app['context'] = {cwd: '/tmp/work', project: 'work', branch: 'main', exitStatus: 0};
    app['promptPanelState'] = {onboarding: true, step: 'appearance', selectedIndex: 1,
      draft: structuredClone(DEFAULT_PROMPT_CONFIGURATION)};
    app['render']();
    assert.equal(frame?.cursorVisible, false);
    assert.ok(frame?.rows.some(row => row.includes('Prompt setup')));
    assert.ok(frame?.rows.some(row => row.includes('Two-line preview')));
    assert.ok(frame?.rows.some(row => row.includes('Fading wedge')));
    assert.ok(stripAnsi(frame?.rows.at(-1) ?? '').includes('Esc skip'), 'the panel occupies the bottom rows instead of leaving the regular composer beneath it');
    const previewRows = app['promptPanelPreview'](80);
    const runtimeRow = buildContextLine(app['context'], 76, app['promptPanelState']!.draft,
      app['promptPanelState']!.draft.placement);
    assert.ok(previewRows.includes(runtimeRow), 'Native onboarding preview uses the runtime segment renderer');
    const panel = renderPromptPanel(app['promptPanelState']!, 80, ['sample preview']);
    assert.ok(panel.some(row => row.includes('Fading wedge')));
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('native themes color by semantic role and flow into archived snapshots', () => {
  const context = {cwd: '/tmp/work', project: 'repo', branch: 'dev', toolchains: ['node' as const, 'go' as const, 'python' as const, 'docker' as const], exitStatus: 2};
  const brand = normalizePromptConfiguration({nmsh: {palette: 'brand'}});
  const modules = renderedModules(context, brand);
  const byText = (text: string) => modules.find(module => module.text.endsWith(text))!;
  assert.deepEqual(byText('repo').background, NMSH_BRAND_LAVENDER, 'project is #A67CF3');
  assert.ok(byText('node').background.green > byText('node').background.red * 1.5, 'node stays green');
  assert.ok(byText('docker').background.blue > 200 && byText('docker').background.red < 60, 'docker stays blue');
  assert.ok(byText('go').background.blue > byText('go').background.red * 3, 'go stays cyan');
  assert.ok(byText('python').background.red > 200 && byText('python').background.blue < 100, 'python stays yellow');
  assert.ok(Math.max(...Object.values(byText('dev').background)) < 80, 'git is a charcoal segment');
  assert.deepEqual(byText('2').background, {red: 205, green: 115, blue: 123}, 'existing failure color is kept');
  assert.deepEqual(modules.map(module => module.id), ['project', 'cwd', 'gitBranch', 'toolchain', 'toolchain', 'toolchain', 'toolchain', 'exitStatus']);

  const legacy = normalizePromptConfiguration({nmsh: {palette: 'semantic'}, transcript: {historyTheme: 'semantic'}});
  assert.equal(legacy.nmsh.palette, 'brand', 'retired Soft Semantic configs map to Brand / Semantic');
  assert.equal(legacy.transcript.historyTheme, 'brand');

  const snapshot = nativePromptSnapshot(context, brand);
  assert.equal(snapshot.palette, 'brand');
  const python = snapshot.segments.find(segment => segment.role === 'python')!;
  const archivedProject = archiveColor(python.background!, 'background');
  const archivedText = archiveColor(python.foreground!);
  assert.ok(archivedProject.red > archivedProject.blue, 'archived python keeps its yellow pigment');
  assert.ok(contrast(archivedText, archivedProject) > 2, 'dark live text on a light segment becomes readable muted text in history');
});

test('theme previews show every module type without adding them to the live prompt', () => {
  const plain = stripAnsi(buildThemePreviewLine(DEFAULT_PROMPT_CONFIGURATION, 'brand', 200));
  for (const expected of ['notMyShell', '~/src', 'main', 'node', 'go', 'python', 'docker']) assert.ok(plain.includes(expected), expected);
  const hidden = normalizePromptConfiguration({modules: [{id: 'toolchain', visible: false, condition: 'always'}]});
  assert.ok(stripAnsi(buildThemePreviewLine(hidden, 'cool', 200)).includes('docker'), 'preview shows all module types regardless of saved visibility');
  const live = stripAnsi(buildContextLine({cwd: '/tmp/work', project: 'work'}, 200, DEFAULT_PROMPT_CONFIGURATION, 'composer'));
  assert.doesNotMatch(live, /node|python|docker|main/u, 'the live prompt shows only real modules');
  const narrow = buildThemePreviewLine(DEFAULT_PROMPT_CONFIGURATION, 'warm', 30);
  assert.ok(displayWidth(narrow) <= 30, 'previews degrade inside narrow widths');
});

test('Start, Connector, Gap, and End are independent', () => {
  const context = {cwd: '/tmp/work', project: 'repo', branch: 'main', exitStatus: 0};
  const line = (nmsh: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    stripAnsi(buildContextLine(context, 60, normalizePromptConfiguration({nmsh, ...extra}), 'composer'));
  const base = line({});
  assert.ok(base.startsWith(''), 'default start is the approved wedge');
  const flatStart = line({startStyle: 'flat'});
  assert.equal(flatStart, base.slice(1), 'flat start removes only the outer left cap');
  assert.equal([...flatStart].filter(glyph => glyph === '').length, 2, 'internal openings still follow the connector');
  const roundedStart = line({startStyle: 'rounded'});
  assert.equal(roundedStart.slice(1), base.slice(1), 'start never changes connectors, gaps, or end');
  const roundedConnector = line({connector: 'rounded'});
  assert.ok(roundedConnector.startsWith(''), 'connector never changes the start');
  assert.match(roundedConnector, /repo   \/tmp/u, 'rounded connector closes and reopens across the Normal notch');
  assert.ok(roundedConnector.endsWith(base.slice(base.lastIndexOf(' main ') + 6)), 'connector never changes the end');
  assert.match(line({connector: 'slash'}, {nmsh: {gapEnabled: false, connector: 'slash'}}), /repo  \/tmp/u, 'connected slant is one join cell');
  const flatEnd = line({endStyle: 'flat'});
  assert.ok(flatEnd.startsWith('') && flatEnd.endsWith(' main '), 'end changes only the outer right edge');
  assert.equal(nativePromptSnapshot(context, normalizePromptConfiguration({nmsh: {connector: 'backslash'}})).connector, 'backslash');

  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(nativeGapChoice(config), 'normal');
  applyNativeGapChoice(config, 'compact');
  assert.equal(nativeGapChoice(config), 'compact');
  assert.match(stripAnsi(buildContextLine(context, 60, config, 'composer')), /repo  \/tmp/u, 'compact keeps caps without the neutral space');
  applyNativeGapChoice(config, 'off');
  assert.equal(config.nmsh.gapEnabled, false);
  applyNativeGapChoice(config, 'normal');
  assert.deepEqual([config.nmsh.gapEnabled, config.gap], [true, 1]);
});

test('outer-edge fades mirror each other and connectors never fade', () => {
  const blocks = [
    {text: 'A', foreground: {red: 250, green: 250, blue: 250}, background: {red: 166, green: 124, blue: 243}},
    {text: 'B', foreground: {red: 250, green: 250, blue: 250}, background: {red: 94, green: 69, blue: 166}},
  ];
  for (const style of POWERLINE_EDGE_STYLES) {
    const rendered = renderPowerlineBlocks(blocks, 1, 1, style, false, style, 'wedge');
    const plain = stripAnsi(rendered);
    const {fade, shape} = edgeParts(style);
    const edgeWidth = shape === 'flat' && !fade ? 0 : fade ? (shape === 'flat' ? 3 : 4) : 1;
    assert.equal(displayWidth(rendered), edgeWidth + 3 + 1 + 3 + edgeWidth + (style === 'fadeFlat' ? 1 : 0), style);
    assert.equal([...plain.slice(edgeWidth, plain.length - edgeWidth)].filter(glyph => glyph === '').length, 1, `${style}: one solid join between modules`);
  }
  assert.ok(stripAnsi(renderPowerlineBlocks(blocks, 1, 1, 'fadeFlat', false, 'fadeFlat')).startsWith('░▒▓'));
});

test('legacy geometry ids normalize and old snapshots still render', () => {
  const legacy = normalizePromptConfiguration({nmsh: {startStyle: 'pointed', endStyle: 'wedge'}});
  assert.deepEqual([legacy.nmsh.startStyle, legacy.nmsh.connector, legacy.nmsh.endStyle], ['wedge', 'wedge', 'wedge']);
  assert.equal(normalizePromptConfiguration({nmsh: {startStyle: 'round', connector: 'zigzag'}}).nmsh.startStyle, 'wedge');
  assert.equal(normalizePromptConfiguration({nmsh: {connector: 'zigzag'}}).nmsh.connector, 'wedge');
  assert.equal(normalizeEdgeStyle('pointed', 'flat'), 'wedge');
});

test('icons on/off only affects Native module icons', () => {
  const context = {cwd: '/tmp/work', project: 'repo', branch: 'main', toolchains: ['node' as const, 'docker' as const], exitStatus: 1};
  const on = stripAnsi(buildContextLine(context, 120, DEFAULT_PROMPT_CONFIGURATION, 'composer'));
  const off = stripAnsi(buildContextLine(context, 120, normalizePromptConfiguration({nmsh: {icons: 'off'}}), 'composer'));
  assert.match(on, / main.* node.* docker/u);
  assert.doesNotMatch(off, /[]/u);
  assert.match(off, / main .* node .* docker .*✘ 1/u, 'labels and status glyphs remain');
  assert.equal(normalizePromptConfiguration({nmsh: {icons: false}}).nmsh.icons, 'off');
  assert.equal(normalizePromptConfiguration({}).nmsh.icons, 'nerd');
});

test('saved configurations gain new modules at their default position', () => {
  const config = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'exitStatus', visible: false, condition: 'nonzeroExit'},
  ]});
  assert.deepEqual(config.modules.map(module => module.id), ['project', 'cwd', 'gitBranch', 'toolchain', 'exitStatus']);
  assert.equal(config.modules.at(-1)!.visible, false);
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'neon', startStyle: 'round'}}).nmsh.palette, 'lavender');
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'neon', startStyle: 'round'}}).nmsh.startStyle, 'wedge');
});

test('toolchains are detected from marker files in cwd and repository root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-toolchain-'));
  try {
    await mkdir(join(directory, 'sub'));
    await writeFile(join(directory, 'go.mod'), 'module x\n');
    await writeFile(join(directory, 'sub', 'Dockerfile'), 'FROM scratch\n');
    assert.deepEqual(await detectToolchains([join(directory, 'sub'), directory]), ['go', 'docker']);
    assert.deepEqual(await detectToolchains([join(directory, 'missing')]), []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('/prompt appearance shows saved values, unsaved changes, and live theme previews', () => {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const state = {onboarding: false, step: 'appearance' as const, selectedIndex: 0, draft: structuredClone(saved), saved};
  const summary = 'Lavender Native · two-line divider · wedge start · wedge joins · gap normal · fading wedge end · icons on';
  const unchanged = renderPromptPanel(state, 160, ['live preview'], ['L', 'B', 'C', 'W', 'G']).map(stripAnsi);
  assert.ok(unchanged.some(row => row.includes(`Current  ${summary}`)));
  assert.ok(unchanged.some(row => row.includes('matches current')));
  assert.ok(unchanged.some(row => /● Lavender Native +✓ L/u.test(row)));
  assert.equal(unchanged.at(-1), '↑↓ move · ←→ change · Enter save · Esc cancel', 'consistent controls row');

  const press = (row: number, kind: 'left' | 'right') => { state.selectedIndex = row; handlePromptPanelKey({kind} as Key, state); };
  press(0, 'right'); press(1, 'right'); press(1, 'right'); press(2, 'right'); press(3, 'left'); press(4, 'left'); press(5, 'left'); press(6, 'right'); press(6, 'right'); press(7, 'right');
  assert.deepEqual([state.draft.nmsh.palette, state.draft.nmsh.startStyle, state.draft.nmsh.connector, nativeGapChoice(state.draft), state.draft.nmsh.endStyle, state.draft.nmsh.icons],
    ['brand', 'flat', 'flat', 'compact', 'fadeFlat', 'off']);
  assert.equal(state.draft.nmsh.connectorFade, 'backslash', 'Connector fade cycles backwards from Follow connector');
  assert.equal(state.draft.nmsh.connectorFadeColors, 'previous', 'Mixed (cycled back from Previous at Normal) resolves to Previous at Compact');
  const changed = renderPromptPanel(state, 160, ['live preview'], ['L', 'B', 'C', 'W', 'G']).map(stripAnsi);
  for (const expected of [
    'Theme           ‹ Brand / Semantic ›  saved: Lavender Native',
    'Start           ‹ Flat ›  saved: Wedge',
    'Connector       ‹ Flat ›  saved: Wedge',
    'Connector fade  ‹ Slant \\ ›  saved: Follow connector',
    'Fade colors     ‹ Previous ›',
    'Gap             ‹ Compact ›  saved: Normal',
    'End             ‹ Fading flat ›  saved: Fading wedge',
    'Icons           ‹ Off ›  saved: On',
    'Modules         5 of 5 shown ›',
    'unsaved preview',
  ]) assert.ok(changed.some(row => row.includes(expected)), expected);
  assert.ok(changed.some(row => /○ Lavender Native +✓ L/u.test(row)) && changed.some(row => /● Brand \/ Semantic +B/u.test(row)));
  state.selectedIndex = APPEARANCE_MODULES_ROW;
  assert.match(stripAnsi(renderPromptPanel(state, 160, []).at(-1)!), /Enter edit modules/u);
  assert.equal(describePromptConfiguration(saved), summary);
});

test('/prompt module manager toggles, reorders, and sets options without losing custom settings', () => {
  const saved = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'always', background: '#112233'},
    {id: 'cwd', visible: true, condition: 'always'},
    {id: 'gitBranch', visible: true, condition: 'inRepository'},
    {id: 'toolchain', visible: true, condition: 'always'},
    {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
  ]});
  const state = {onboarding: false, step: 'modules' as const, selectedIndex: 1, draft: structuredClone(saved), saved};
  assert.ok(handlePromptPanelKey({kind: 'text', value: ' '} as Key, state));
  assert.equal(state.draft.modules[1]!.visible, false);
  handlePromptPanelKey({kind: 'selectUp'} as Key, state);
  assert.deepEqual(state.draft.modules.map(module => module.id), ['cwd', 'project', 'gitBranch', 'toolchain', 'exitStatus']);
  assert.equal(state.selectedIndex, 0, 'selection follows the moved module');
  handlePromptPanelKey({kind: 'selectUp'} as Key, state);
  assert.equal(state.selectedIndex, 0, 'moving past the top is a no-op');
  state.selectedIndex = 4;
  handlePromptPanelKey({kind: 'right'} as Key, state);
  assert.equal(state.draft.modules[4]!.condition, 'always');
  assert.equal(state.draft.modules[1]!.background, '#112233', 'custom colors survive reordering');
  const rows = renderPromptPanel(state, 120, []).map(stripAnsi);
  assert.ok(rows.some(row => /○ Path +hidden/u.test(row)));
  assert.ok(rows.some(row => /› ● Exit status +‹ always ›/u.test(row)));
  assert.equal(rows.at(-1), '↑↓ move · Space show/hide · Shift+↑↓ reorder · ←→ option · Enter/Esc done');
  assert.ok(promptDraftChanged(state), 'module edits count as unsaved changes');
  const path = join(tmpdir(), `nmsh-modules-${process.pid}.json`);
  try {
    savePromptConfiguration(state.draft, path);
    assert.deepEqual(loadPromptConfiguration(path).modules, state.draft.modules);
  } finally {
    void rm(path, {force: true});
  }
});

test('/prompt layout choices expose the existing placement and composerLayout keys without a new setting', () => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(config.placement, 'header');
  assert.equal(layoutChoiceIndex(config), 0);
  applyLayoutChoice(config, 1);
  assert.deepEqual([config.composerLayout, config.placement], ['twoLine', 'composer']);
  applyLayoutChoice(config, 2);
  assert.deepEqual([config.composerLayout, config.placement], ['oneLine', 'composer'], 'one-line keeps the stored placement');
  assert.equal(layoutChoiceIndex(config), 2);
  applyLayoutChoice(config, 0);
  assert.deepEqual([config.composerLayout, config.placement], ['twoLine', 'header']);
  assert.equal(layoutChoiceIndex(normalizePromptConfiguration({placement: 'composer'})), 1, 'hand-edited config files map to their choice');
  assert.ok(!('inputPlacement' in normalizePromptConfiguration({})), 'no duplicate setting exists');

  const saved = normalizePromptConfiguration({placement: 'composer'});
  const state = {onboarding: false, step: 'layout' as const, selectedIndex: 1, draft: structuredClone(saved), saved};
  const rows = renderPromptPanel(state, 120, ['preview']).map(stripAnsi);
  assert.equal(rows.filter(row => LAYOUT_CHOICES.some(choice => row.includes(choice.label))).length, 3);
  assert.ok(rows.some(row => row.includes('Two-line · prompt inside bordered composer  ●  ✓ saved')));
  assert.ok(rows.some(row => row.includes('Current  Lavender Native · two-line inside')));
  handlePromptPanelKey({kind: 'down'} as Key, state);
  assert.equal(state.selectedIndex, 2);
  assert.ok(renderPromptPanel(state, 120, ['preview']).map(stripAnsi).some(row => row.startsWith('One-line preview')));
});

test('layout choice persists through the normal prompt configuration file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-placement-'));
  try {
    const path = join(directory, 'config.json');
    const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
    applyLayoutChoice(config, 1);
    savePromptConfiguration(config, path);
    const loaded = loadPromptConfiguration(path);
    assert.deepEqual([loaded.composerLayout, loaded.placement], ['twoLine', 'composer']);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('external provider rows follow the same placement rule as native', () => {
  const app = new TerminalApp();
  try {
    const prompt = {ansi: 'star', text: 'star', segments: [], normalizedMultiline: false};
    assert.match(stripAnsi(app['externalPromptRow'](prompt, 20, 'header')), /^star─+$/u);
    assert.equal(stripAnsi(app['externalPromptRow'](prompt, 20, 'composer')), 'star');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
