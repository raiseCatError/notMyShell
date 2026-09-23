import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, chmod, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveColor} from '../src/prompt/snapshot.js';
import {buildContextLine, buildThemePreviewLine, NATIVE_PROMPT_THEMES, NMSH_BRAND_LAVENDER, nativePromptSnapshot, renderedModules} from '../src/prompt/prompt.js';
import {applyNativeGapChoice, NATIVE_PALETTE_IDS, nativeGapChoice, normalizePromptConfiguration, DEFAULT_PROMPT_CONFIGURATION, savePromptConfiguration, loadPromptConfiguration} from '../src/prompt/configuration.js';
import {detectStarship, normalizeStarshipConfigPath, parseStarshipPrompt, renderStarshipPrompt} from '../src/prompt/starship.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {applyLayoutChoice, describePromptConfiguration, handlePromptPanelKey, LAYOUT_CHOICES, layoutChoiceIndex, renderPromptPanel} from '../src/prompt/PromptPanel.js';
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

test('six native themes exist, stay readable, and keep adjacent segments distinct', () => {
  assert.deepEqual(NATIVE_PALETTE_IDS, ['lavender', 'brand', 'semantic', 'cool', 'warm', 'grayscale']);
  assert.deepEqual(NATIVE_PALETTE_IDS.map(id => NATIVE_PROMPT_THEMES[id].label),
    ['Lavender Native', 'Brand / Semantic', 'Soft Semantic', 'Cool First', 'Warm First', 'Grayscale']);
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
    assert.ok(frame?.rows.at(-1)?.includes('Esc skip'), 'the panel occupies the bottom rows instead of leaving the regular composer beneath it');
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

  const soft = renderedModules(context, normalizePromptConfiguration({nmsh: {palette: 'semantic'}}));
  const shared = soft.filter((module, index) => JSON.stringify(module.background) === JSON.stringify(modules[index]!.background));
  assert.ok(shared.length <= 2, 'Soft Semantic is not a rename of Brand / Semantic (only git/status may be shared)');

  const semantic = normalizePromptConfiguration({nmsh: {palette: 'semantic'}});
  const snapshot = nativePromptSnapshot(context, semantic);
  assert.equal(snapshot.palette, 'semantic');
  const archivedProject = archiveColor(snapshot.segments[0]!.background!, 'background');
  const archivedText = archiveColor(snapshot.segments[0]!.foreground!);
  assert.ok(archivedProject.blue > archivedProject.green, 'archived project keeps its lavender pigment');
  assert.ok(contrast(archivedText, archivedProject) > 2, 'dark live text becomes readable muted text in history');
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

test('start style and gap presets change native geometry for live and archived prompts', () => {
  const context = {cwd: '/tmp/work', project: 'repo', exitStatus: 0};
  const pointed = stripAnsi(buildContextLine(context, 40, DEFAULT_PROMPT_CONFIGURATION, 'composer'));
  const flatConfig = normalizePromptConfiguration({nmsh: {startStyle: 'flat'}});
  const flat = stripAnsi(buildContextLine(context, 40, flatConfig, 'composer'));
  assert.ok(pointed.startsWith(''));
  assert.ok(flat.startsWith(' repo'));
  assert.equal([...flat].filter(glyph => glyph === '').length, 0, 'flat start opens every independent segment square');
  assert.equal(nativePromptSnapshot(context, flatConfig).startStyle, 'flat');

  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(nativeGapChoice(config), 'normal');
  applyNativeGapChoice(config, 'compact');
  assert.equal(nativeGapChoice(config), 'compact');
  const compact = stripAnsi(buildContextLine(context, 40, config, 'composer'));
  assert.match(compact, /repo  \/tmp/u, 'compact keeps caps without the neutral space');
  applyNativeGapChoice(config, 'off');
  assert.equal(config.nmsh.gapEnabled, false);
  applyNativeGapChoice(config, 'normal');
  assert.deepEqual([config.nmsh.gapEnabled, config.gap], [true, 1]);
});

test('saved configurations gain new modules at their default position', () => {
  const config = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'exitStatus', visible: false, condition: 'nonzeroExit'},
  ]});
  assert.deepEqual(config.modules.map(module => module.id), ['project', 'cwd', 'gitBranch', 'toolchain', 'exitStatus']);
  assert.equal(config.modules.at(-1)!.visible, false);
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'neon', startStyle: 'round'}}).nmsh.palette, 'lavender');
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'neon', startStyle: 'round'}}).nmsh.startStyle, 'pointed');
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
  const unchanged = renderPromptPanel(state, 120, ['live preview'], ['L', 'B', 'S', 'C', 'W', 'G']).map(stripAnsi);
  assert.ok(unchanged.some(row => row.includes('Current  Lavender Native · two-line divider · pointed start · gap normal · fading wedge')));
  assert.ok(unchanged.some(row => row.includes('matches current')));
  assert.ok(unchanged.some(row => /● Lavender Native +✓ L/u.test(row)));

  handlePromptPanelKey({kind: 'right'} as Key, state);
  state.selectedIndex = 1; handlePromptPanelKey({kind: 'right'} as Key, state);
  state.selectedIndex = 2; handlePromptPanelKey({kind: 'left'} as Key, state);
  assert.deepEqual([state.draft.nmsh.palette, state.draft.nmsh.startStyle, nativeGapChoice(state.draft)], ['brand', 'flat', 'compact']);
  const changed = renderPromptPanel(state, 120, ['live preview'], ['L', 'B', 'S', 'C', 'W', 'G']).map(stripAnsi);
  assert.ok(changed.some(row => row.includes('Theme   ‹ Brand / Semantic ›  saved: Lavender Native')));
  assert.ok(changed.some(row => row.includes('Start   ‹ Flat ›  saved: Pointed')));
  assert.ok(changed.some(row => row.includes('Gap     ‹ Compact ›  saved: Normal')));
  assert.ok(changed.some(row => row.includes('unsaved preview')));
  assert.ok(changed.some(row => /○ Lavender Native +✓ L/u.test(row)) && changed.some(row => /● Brand \/ Semantic +B/u.test(row)));
  assert.equal(describePromptConfiguration(saved), 'Lavender Native · two-line divider · pointed start · gap normal · fading wedge');
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

test('Starship prompt rows follow the same placement rule as native', () => {
  const app = new TerminalApp();
  try {
    app['starshipPrompt'] = {ansi: 'star', text: 'star', segments: [], normalizedMultiline: false};
    assert.match(stripAnsi(app['starshipPromptRow'](20, 'header')), /^star─+$/u);
    assert.equal(stripAnsi(app['starshipPromptRow'](20, 'composer')), 'star');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
