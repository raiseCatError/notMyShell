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
import {createThemeBridgePanel, panelItems, renderThemeBridgePanel, themeBridgeKey, type BridgePanelContext} from '../src/themeBridge/ThemeBridgePanel.js';
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
  custom.selected.custom = 2;
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

function bridgeContext(enabled = false, policy: 'manual' | 'follow' | 'choose' = 'manual'): BridgePanelContext {
  const reports: TargetReport[] = BRIDGE_TARGETS.map(target => ({target, label: target, capability: target === 'delta' ? 'detected' : ['fzf', 'pager', 'lsColors'].includes(target) ? 'direct' : 'managed',
    mode: 'independent', modes: target === 'delta' ? ['independent'] : ['independent', 'follow', 'choose'], editable: target !== 'delta' && policy === 'manual', inherited: enabled && policy !== 'manual' && target !== 'delta',
    status: target === 'delta' ? 'Not managed' : 'Detected', notes: target === 'delta' ? ['delta is shown for status only'] : []}));
  return {enabled, policy, reports, themes: [{ref: 'builtin:lavender', label: 'Lavender Native', category: 'builtin'}, {ref: 'builtin:nord', label: 'Nord', category: 'builtin'}],
    pinned: () => undefined, activeRef: 'builtin:lavender', managed: () => undefined};
}

const itemIndex = (state: ReturnType<typeof createThemeBridgePanel>, context: BridgePanelContext, match: (item: ReturnType<typeof panelItems>[number]) => boolean) => panelItems(state, context).findIndex(match);

test('/theme-bridge: one panel; switch, Apply themes policy, inline expansion, Esc collapses first, read-only rows, delta not editable', () => {
  const state = createThemeBridgePanel();
  const off = bridgeContext();
  const text = plain(renderThemeBridgePanel(state, off, 120, 60));
  assert.match(text, /Theme Bridge\s+‹ Off ›/u);
  assert.match(text, /Direct and environment[\s\S]*fzf[\s\S]*Managed themes[\s\S]*tmux[\s\S]*Detected only[\s\S]*delta/u);
  assert.deepEqual(themeBridgeKey(state, {kind: 'enter'}, off), {kind: 'setEnabled', enabled: true});
  const on = bridgeContext(true);
  state.selected = itemIndex(state, on, item => item.kind === 'policy');
  assert.deepEqual(themeBridgeKey(state, {kind: 'right'}, on), {kind: 'setPolicy', policy: 'follow'});
  // Inline expansion keeps the whole list visible.
  state.selected = itemIndex(state, on, item => item.kind === 'target' && item.target === 'fzf');
  themeBridgeKey(state, {kind: 'enter'}, on);
  assert.equal(state.expanded, 'fzf');
  const expanded = plain(renderThemeBridgePanel(state, on, 120, 60));
  assert.match(expanded, /▾ fzf[\s\S]*Mode[\s\S]*pager[\s\S]*helix[\s\S]*delta/u, 'details inline; other targets still listed');
  state.selected = itemIndex(state, on, item => item.kind === 'detail' && item.row === 'mode');
  assert.deepEqual(themeBridgeKey(state, {kind: 'right'}, on), {kind: 'setMode', target: 'fzf', mode: 'follow'});
  const following = {...on, reports: on.reports.map(report => report.target === 'fzf' ? {...report, mode: 'follow' as const} : report)};
  assert.deepEqual(themeBridgeKey(state, {kind: 'right'}, following), {kind: 'setMode', target: 'fzf', mode: 'choose', theme: 'builtin:lavender'});
  assert.equal(themeBridgeKey(state, {kind: 'escape'}, on), undefined, 'Esc collapses first');
  assert.equal(state.expanded, undefined);
  assert.deepEqual(themeBridgeKey(state, {kind: 'escape'}, on), {kind: 'close'}, 'then closes');
  // Global Follow: rows are view-only, with no editable affordance.
  const follow = bridgeContext(true, 'follow');
  const view = createThemeBridgePanel();
  view.selected = itemIndex(view, follow, item => item.kind === 'target' && item.target === 'tmux');
  themeBridgeKey(view, {kind: 'enter'}, follow);
  assert.ok(!panelItems(view, follow).some(item => item.kind === 'detail' && (item.row === 'mode' || item.row === 'theme')), 'no mode/theme editors under a global policy');
  view.selected = itemIndex(view, follow, item => item.kind === 'target' && item.target === 'tmux');
  themeBridgeKey(view, {kind: 'right'}, follow);
  assert.match(view.message ?? '', /Switch Apply themes to Manual/u);
  assert.match(plain(renderThemeBridgePanel(view, follow, 120, 60)), /Inherited/u);
  // delta: shown, never expandable or editable.
  const delta = createThemeBridgePanel();
  delta.selected = itemIndex(delta, on, item => item.kind === 'target' && item.target === 'delta');
  themeBridgeKey(delta, {kind: 'enter'}, on);
  assert.equal(delta.expanded, undefined);
  assert.match(delta.message ?? '', /status only/u);
});

test('/theme-bridge review all: combined review defaults to No', () => {
  const state = createThemeBridgePanel();
  state.review = {items: [{target: 'tmux', label: 'tmux', state: 'needs-include', detail: 'Needs one reviewed include', action: 'include'}], previews: {tmux: ['+ source-file -q x']}, yes: false};
  assert.match(plain(renderThemeBridgePanel(state, bridgeContext(true), 120, 40)), /Apply 1 reviewed change\?\s+‹ No ›/u);
  assert.equal(themeBridgeKey(state, {kind: 'enter'}, bridgeContext(true)), undefined, 'Enter on the default No changes nothing');
  state.review = {items: [{target: 'tmux', label: 'tmux', state: 'needs-include', detail: '', action: 'include'}], previews: {}, yes: false};
  themeBridgeKey(state, {kind: 'right'}, bridgeContext(true));
  assert.deepEqual(themeBridgeKey(state, {kind: 'enter'}, bridgeContext(true)), {kind: 'applyAll'});
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
      const context = app['themeBridgePanelContext']();
      panel.selected = panelItems(panel, context).findIndex(item => item.kind === 'target' && item.target === 'pager');
      await app['handleThemeBridgeKey']({kind: 'enter'}, panel);
      panel.selected = panelItems(panel, app['themeBridgePanelContext']()).findIndex(item => item.kind === 'detail' && item.row === 'mode');
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
