import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {applyUiTheme} from '../src/appearance/uiTheme.js';
import {createThemeStudio, renderThemeStudio, studioKey, STUDIO_TABS, type StudioContext} from '../src/appearance/ThemeStudio.js';
import {builtinTheme} from '../src/appearance/themeRefs.js';
import type {ThemeAsset} from '../src/appearance/themeLibrary.js';
import {createThemeBridgePanel, renderThemeBridgePanel, themeBridgeKey, type BridgePanelContext} from '../src/themeBridge/ThemeBridgePanel.js';
import {BRIDGE_TARGETS} from '../src/themeBridge/model.js';
import type {TargetReport} from '../src/themeBridge/runtime.js';
import {createSetup, renderSetup, sectionIndex, setupKey} from '../src/setup/SetupCat.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {bridgeEnvPath} from '../src/themeBridge/environment.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const plain = (rows: string[]) => rows.map(stripAnsi).join('\n');
const assets: ThemeAsset[] = [
  {id: 't-aaaaaaaaaaaa', theme: {...builtinTheme('dracula'), name: 'My Dracula'}},
  {id: 't-bbbbbbbbbbbb', theme: {...builtinTheme('nord'), name: 'Mocha (Ghostty)'}, origin: {kind: 'ghostty', sourceName: 'Mocha', sourcePath: '/secret/path'}, modified: true},
];
const context = (overrides: Partial<StudioContext> = {}): StudioContext => ({themes: assets, accent: 'mauve', activeRef: 'builtin:lavender', pinnedTo: () => [], ...overrides});

test('/theme: shared tab strip Built-in | Imported | Custom | Import; ←→ switch tabs; ↑ at the top focuses the tabs', () => {
  assert.deepEqual([...STUDIO_TABS], ['Built-in', 'Imported', 'Custom', 'Import']);
  const state = createThemeStudio(context());
  const first = plain(renderThemeStudio(state, context(), 100, 40, 'truecolor', []));
  assert.match(first, /Built-in\s+Imported\s+Custom\s+Import/u);
  assert.match(first, /Lavender Native.*● active/u);
  assert.match(first, /Built-ins are immutable/u);
  studioKey(state, {kind: 'right'}, 'truecolor', '/', context());
  assert.equal(state.tab, 'imported');
  const imported = plain(renderThemeStudio(state, context(), 100, 40, 'truecolor', []));
  assert.match(imported, /Mocha \(Ghostty\)/u);
  assert.match(imported, /Imported from Ghostty · Mocha · Modified/u);
  assert.doesNotMatch(imported, /secret/u, 'local source paths are not displayed in the list');
  studioKey(state, {kind: 'up'}, 'truecolor', '/', context());
  assert.equal(state.focus, 'tabs');
  studioKey(state, {kind: 'down'}, 'truecolor', '/', context());
  assert.equal(state.focus, 'list');
  studioKey(state, {kind: 'right'}, 'truecolor', '/', context());
  assert.equal(state.tab, 'custom');
  assert.match(plain(renderThemeStudio(state, context(), 100, 40, 'truecolor', [])), /＋ New custom theme[\s\S]*My Dracula/u);
});

test('/theme actions: set active, edit (same editor for Imported and Custom), rename, duplicate, export, delete with confirmation', () => {
  const ctx = context({pinnedTo: ref => ref === 'asset:t-bbbbbbbbbbbb' ? ['tmux'] : []});
  const state = createThemeStudio(ctx, 'imported');
  assert.deepEqual(studioKey(state, {kind: 'enter'}, 'truecolor', '/', ctx), {kind: 'activate', ref: 'asset:t-bbbbbbbbbbbb'});
  studioKey(state, {kind: 'text', value: 'e'}, 'truecolor', '/', ctx);
  assert.ok(state.editor);
  assert.match(plain(renderThemeStudio(state, ctx, 100, 40, 'truecolor', [])), /Edit · Mocha \(Ghostty\)[\s\S]*Imported from Ghostty/u);
  studioKey(state, {kind: 'escape'}, 'truecolor', '/', ctx);
  assert.equal(state.editor, undefined, 'Esc leaves the editor without saving');
  studioKey(state, {kind: 'text', value: 'n'}, 'truecolor', '/', ctx);
  for (const _ of 'Mocha (Ghostty)') studioKey(state, {kind: 'backspace'}, 'truecolor', '/', ctx);
  for (const character of 'Night') studioKey(state, {kind: 'text', value: character}, 'truecolor', '/', ctx);
  assert.deepEqual(studioKey(state, {kind: 'enter'}, 'truecolor', '/', ctx), {kind: 'rename', id: 't-bbbbbbbbbbbb', name: 'Night'});
  assert.deepEqual(studioKey(state, {kind: 'text', value: 'd'}, 'truecolor', '/', ctx), {kind: 'duplicate', id: 't-bbbbbbbbbbbb'});
  assert.deepEqual(studioKey(state, {kind: 'text', value: 'x'}, 'truecolor', '/', ctx), {kind: 'export', id: 't-bbbbbbbbbbbb'});
  studioKey(state, {kind: 'delete'}, 'truecolor', '/', ctx);
  assert.match(plain(renderThemeStudio(state, ctx, 100, 40, 'truecolor', [])), /tmux is pinned to it and will become Independent/u);
  assert.deepEqual(studioKey(state, {kind: 'enter'}, 'truecolor', '/', ctx), {kind: 'delete', id: 't-bbbbbbbbbbbb', confirmIndependent: true});
  const active = context({activeRef: 'asset:t-aaaaaaaaaaaa'});
  const custom = createThemeStudio(active, 'custom');
  custom.selected.custom = 1;
  studioKey(custom, {kind: 'delete'}, 'truecolor', '/', active);
  assert.equal(custom.confirmDelete, undefined);
  assert.match(custom.message ?? '', /active theme/u);
  const builtin = createThemeStudio(context());
  assert.deepEqual(studioKey(builtin, {kind: 'text', value: 'd'}, 'truecolor', '/', context()), {kind: 'duplicateBuiltin', ref: 'builtin:lavender'});
});

test('/theme Import tab: format chooser and path; cancel stores nothing', () => {
  const state = createThemeStudio(context(), 'import');
  assert.equal(state.importField, 'path');
  studioKey(state, {kind: 'up'}, 'truecolor', '/', context());
  assert.equal(state.importField, 'format');
  studioKey(state, {kind: 'right'}, 'truecolor', '/', context());
  assert.match(plain(renderThemeStudio(state, context(), 100, 40, 'truecolor', [])), /Format\s+‹ NMSh Theme JSON ›/u);
  studioKey(state, {kind: 'down'}, 'truecolor', '/', context());
  for (const character of '/nonexistent/theme.conf') studioKey(state, {kind: 'text', value: character}, 'truecolor', '/', context());
  assert.equal(studioKey(state, {kind: 'enter'}, 'truecolor', '/', context()), undefined);
  assert.match(state.message ?? '', /Could not read/u);
  state.importPreview = {format: 'kitty', theme: builtinTheme('nord'), mapping: [{role: 'Project', from: 'magenta (color5)'}], warnings: ['lossy'], path: '/x'};
  assert.match(plain(renderThemeStudio(state, context(), 100, 40, 'truecolor', [])), /Import preview · Nord[\s\S]*Project\s+← magenta[\s\S]*• lossy/u);
  assert.equal(studioKey(state, {kind: 'escape'}, 'truecolor', '/', context()), undefined);
  assert.equal(state.importPreview, undefined);
  assert.match(state.message ?? '', /nothing was saved/u);
});

test('/theme and /theme-bridge fit short and narrow terminals', () => {
  for (const [columns, height] of [[56, 14], [60, 18], [120, 50]] as const) {
    for (const tab of ['builtin', 'imported', 'custom', 'import'] as const) {
      const rows = renderThemeStudio(createThemeStudio(context(), tab), context(), columns, height, 'truecolor', ['  preview row']);
      assert.ok(rows.length <= height, `${tab} ${columns}x${height}`);
      assert.ok(rows.every(row => displayWidth(row) <= columns));
    }
    const panel = renderThemeBridgePanel(createThemeBridgePanel(), bridgeContext(), columns, height);
    assert.ok(panel.length <= height && panel.every(row => displayWidth(row) <= columns));
  }
});

function bridgeContext(enabled = false): BridgePanelContext {
  const reports: TargetReport[] = BRIDGE_TARGETS.map(target => ({target, label: target, mode: 'independent', modes: target === 'bat' || target === 'delta' ? ['independent'] : ['independent', 'follow', 'choose'],
    status: 'Detected', notes: target === 'bat' ? ['bat loads custom themes only from its own theme cache'] : []}));
  return {enabled, reports, themes: [{ref: 'builtin:lavender', label: 'Lavender Native', category: 'builtin'}, {ref: 'builtin:nord', label: 'Nord', category: 'builtin'}],
    pinned: () => undefined, activeRef: 'builtin:lavender', managed: () => undefined};
}

test('/theme-bridge panel: master switch, per-target modes, Choose starts visibly on the active theme, unsupported targets explain why', () => {
  const state = createThemeBridgePanel();
  const text = plain(renderThemeBridgePanel(state, bridgeContext(), 110, 40));
  assert.match(text, /Theme Bridge\s+‹ Off ›/u);
  assert.match(text, /fzf\s+Independent\s+—\s+Detected/u);
  assert.deepEqual(themeBridgeKey(state, {kind: 'enter'}, bridgeContext()), {kind: 'setEnabled', enabled: true});
  themeBridgeKey(state, {kind: 'down'}, bridgeContext());
  themeBridgeKey(state, {kind: 'enter'}, bridgeContext());
  assert.equal(state.detail?.target, 'fzf');
  assert.deepEqual(themeBridgeKey(state, {kind: 'right'}, bridgeContext()), {kind: 'setMode', target: 'fzf', mode: 'follow'});
  const choose = {...bridgeContext(true), reports: bridgeContext(true).reports.map(report => report.target === 'fzf' ? {...report, mode: 'follow' as const} : report)};
  assert.deepEqual(themeBridgeKey(state, {kind: 'right'}, choose), {kind: 'setMode', target: 'fzf', mode: 'choose', theme: 'builtin:lavender'});
  themeBridgeKey(state, {kind: 'escape'}, bridgeContext());
  state.selected = BRIDGE_TARGETS.indexOf('bat') + 1;
  themeBridgeKey(state, {kind: 'enter'}, bridgeContext());
  assert.equal(themeBridgeKey(state, {kind: 'right'}, bridgeContext()), undefined);
  assert.match(state.message ?? '', /theme cache/u);
});

test('Setup Appearance: one Theme Bridge question (default No) reveals only detected tools; Theme Studio row reads Open ›', () => {
  const setup = createSetup(normalizePromptConfiguration({}));
  setup.section = sectionIndex('appearance');
  setup.context = {...setup.context, bridgeTargets: ['fzf', 'tmux']};
  const text = plain(renderSetup(setup, 120, 80));
  assert.match(text, /Theme Studio\s+Open ›/u);
  assert.doesNotMatch(text, /custom themes/u);
  assert.match(text, /Extend colors to tools\?\s+‹?\s*No/u);
  assert.doesNotMatch(text, /^\s+fzf\s/mu, 'no target rows while the answer is No');
  setup.draft = {...setup.draft, themeBridge: {...setup.draft.themeBridge, enabled: true}};
  const yes = plain(renderSetup(setup, 120, 80));
  assert.match(yes, /fzf\s+Independent/u);
  assert.match(yes, /tmux\s+Independent/u);
  assert.doesNotMatch(yes, /Neovim|LS_COLORS/u, 'tools not found on this system are not listed');
  void setupKey;
});

function harness(config: object): {app: TerminalApp; frames: TerminalFrame[]; cleanup: () => void; directory: string} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: TerminalFrame[] = [];
  app['renderer'].render = (frame: TerminalFrame) => { frames.push(frame); };
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['configuration'] = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, ...config});
  return {app, frames, directory: isolation.directory, cleanup: () => { app['stop'](0); app['session'].kill(); applyUiTheme(undefined); isolation.restore(); }};
}

for (const panelPosition of ['bottom', 'top'] as const) {
  test(`app (${panelPosition} panels): /theme sets a theme active through the normal save path; /theme-bridge turns a tool on and writes only NMSh files`, async () => {
    const {app, frames, cleanup} = harness({panelPosition, onboardingComplete: true});
    try {
      await app['runSlash']('/theme', parseSlashCommand('/theme')!);
      assert.ok(app['themeStudio']);
      app['render']();
      assert.match(plain(frames.at(-1)!.rows), /Built-in\s+Imported\s+Custom\s+Import/u);
      app['themeStudio']!.selected.builtin = 0;
      app['handleThemeStudioKey']({kind: 'down'}, app['themeStudio']!);
      app['handleThemeStudioKey']({kind: 'enter'}, app['themeStudio']!);
      assert.equal(loadPromptConfiguration().nmsh.palette, 'brand', 'saved through the normal configuration path');
      app['handleThemeStudioKey']({kind: 'escape'}, app['themeStudio']!);
      assert.equal(app['themeStudio'], undefined);
      app['bridgeFacts'] = Object.fromEntries(BRIDGE_TARGETS.map(target => [target, {installed: true}])) as never;
      await app['runSlash']('/theme-bridge', parseSlashCommand('/theme-bridge')!);
      const panel = app['themeBridgePanel']!;
      assert.ok(panel);
      panel.selected = BRIDGE_TARGETS.indexOf('pager') + 1;
      await app['handleThemeBridgeKey']({kind: 'enter'}, panel);
      await app['handleThemeBridgeKey']({kind: 'right'}, panel);
      const saved = loadPromptConfiguration();
      assert.equal(saved.themeBridge.enabled, true);
      assert.equal(saved.themeBridge.targets.pager.mode, 'follow');
      assert.ok(existsSync(bridgeEnvPath('zsh')), 'the managed environment file exists under the NMSh config directory');
      app['render']();
      assert.match(plain(frames.at(-1)!.rows), /less \/ man[\s\S]*Follow NMSh/u);
    } finally { cleanup(); }
  });
}
