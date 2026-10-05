import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, shellModuleVisibility, savePromptConfiguration, loadPromptConfiguration} from '../src/prompt/configuration.js';
import {applyShellIndicatorAction, createShellPanel, renderShellPanel, shellPanelKey} from '../src/shell/ShellPanel.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';
import {handleTranscriptPanelKey, renderTranscriptPanel, transcriptDraftChanged} from '../src/output/TranscriptPanel.js';
import {SETTINGS_ROWS, settingsRowValue} from '../src/ui/SettingsPanel.js';
import {handleLayoutPanelKey} from '../src/ui/LayoutPanel.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {renderedModules} from '../src/prompt/prompt.js';
import {handlePromptPanelKey, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {prepareRail, railCompositionPreview} from '../src/prompt/railComposition.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {routeModule} from '../src/context/surfaceRouter.js';

const shells = ['zsh', 'fish', 'bash'].map(id => ({adapter: shellAdapter(id as 'zsh' | 'fish' | 'bash'), executable: '/bin/' + id, version: id + ' QA'}));

test('/shell current band and tick persist separately from selection; default has weight', () => {
  const oldColor = process.env.NMSH_COLOR; process.env.NMSH_COLOR = 'truecolor';
  try {
    for (const defaultShell of ['zsh', 'bash'] as const) {
      const panel = createShellPanel(shells, 'zsh', defaultShell);
      for (const selected of [0, 1, 2]) {
        panel.selected = selected;
        const rows = renderShellPanel(panel, 100);
        const current = rows.find(row => stripAnsi(row).includes('zsh QA'))!;
        assert.match(stripAnsi(current), /✓ zsh.*\[current\]/u);
        assert.match(current, /\x1b\[48;/u, 'current row has a background even when not selected');
        assert.equal((stripAnsi(current).match(/✓/gu) ?? []).length, 1);
        const def = rows.find(row => stripAnsi(row).includes(defaultShell + ' QA'))!;
        assert.match(def, /\x1b\[1m\[default\]/u);
        assert.ok(rows.every(row => displayWidth(row) <= 100));
      }
    }
  } finally { if (oldColor === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = oldColor; }
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const panel = createShellPanel(shells, 'bash', 'zsh'); panel.selected = 1;
    const painted = renderShellPanel(panel, 100);
    assert.match(painted.find(row => stripAnsi(row).includes('bash QA'))!, /\x1b\[7m/u);
    assert.ok(painted.every(row => !/\x1b\[(?:38|48);/u.test(row)));
    const rows = painted.map(stripAnsi);
    assert.match(rows.find(row => row.includes('bash QA'))!, /✓.*\[current\]/u);
    assert.match(rows.find(row => row.includes('zsh QA'))!, /\[default\]/u);
  } finally { if (previous === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previous; }
});

test('/transcript, /layout and Settings share live presentation with draft/save/cancel', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-ux-'));
  const previous = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = root;
  const app = new TerminalApp();
  app['render'] = () => {};
  try {
    app['startTranscriptSettings']();
    const state = app['transcriptPanelState']!;
    const text = renderTranscriptPanel(state, 100, {cwd: '/qa'}).map(stripAnsi).join('\n');
    assert.match(text, /Live presentation[\s\S]*Presentation.*Normal[\s\S]*History/u);
    handleTranscriptPanelKey({kind: 'right'}, state);
    assert.equal(state.presentation!.draft, 'chat');
    assert.match(renderTranscriptPanel(state, 100, {cwd: '/qa'}).map(stripAnsi).join('\n'), /Presentation.*Chat/u);
    const chatRows = renderTranscriptPanel(state, 100, {cwd: '/qa'}).map(stripAnsi);
    assert.match(chatRows.find(row => row.includes('❯ git status'))!, /^ {10,}/u);
    const narrow = renderTranscriptPanel(state, 40, {cwd: '/qa'}).map(stripAnsi);
    assert.match(narrow.find(row => row.includes('❯ git status'))!, /^  ❯/u, 'real Chat presenter falls back at narrow widths');
    assert.equal(transcriptDraftChanged(state), true);
    assert.equal(app['promptConfiguration'].transcriptPresentation, 'normal');
    app['saveTranscriptSettings']();
    assert.equal(app['output'].presenter.layout, 'chat');
    assert.equal(JSON.parse(readFileSync(join(root, 'nmsh/config.json'), 'utf8')).transcriptPresentation, 'chat');
    app['startLayoutSettings']();
    assert.equal(app['layoutPanelState']!.draft.transcriptPresentation, 'chat');
    const row = SETTINGS_ROWS.find(row => row.id === 'transcriptPresentation')!;
    assert.equal(settingsRowValue(row, app['promptConfiguration']), 'Chat');
    app['layoutPanelState']!.selectedIndex = 1;
    handleLayoutPanelKey({kind: 'right'}, app['layoutPanelState']!);
    app['saveLayoutSettings']();
    app['startTranscriptSettings']();
    assert.equal(app['transcriptPanelState']!.presentation!.saved, 'normal');
    handleTranscriptPanelKey({kind: 'right'}, app['transcriptPanelState']!);
    app['onInput']('\x1b'); app['onInput']('\x1b[A');
    assert.equal(app['transcriptPanelState'], undefined);
    assert.equal(app['promptConfiguration'].transcriptPresentation, 'normal');
    assert.ok(row.control === 'enum');
    app['applySettingsConfiguration'](row.select(app['promptConfiguration'], 1));
    app['startTranscriptSettings'](); app['startLayoutSettings']();
    assert.equal(app['transcriptPanelState']!.presentation!.saved, 'chat');
    assert.equal(app['layoutPanelState']!.saved.transcriptPresentation, 'chat');
  } finally { app['stop'](0); app['session'].kill(); if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; rmSync(root, {recursive: true, force: true}); }
});

test('/shell indicator controls edit the existing module and never switch the session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-ux-'));
  const previous = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = root;
  const app = new TerminalApp(); app['render'] = () => {};
  try {
    app['promptConfiguration'] = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, modules: [{id: 'shell', visible: true, condition: 'always', surface: 'rightContext'}]});
    app['openShellPanel']();
    const panel = app['shellPanel']!;
    panel.selected = panel.shells.length;
    assert.match(renderShellPanel(panel, 100).map(stripAnsi).join('\n'), /Prompt shell indicator[\s\S]*Visibility.*Always[\s\S]*Side.*Right/u);
    app['onInput']('\x1b[C');
    assert.equal(shellModuleVisibility(app['promptConfiguration']), 'never');
    app['shellId'] = 'bash';
    assert.equal(renderedModules(app['promptContext'](''), app['promptConfiguration']).some(module => module.id === 'shell'), false);
    app['shellId'] = 'zsh';
    app['onInput']('\x1b[C');
    assert.equal(shellModuleVisibility(app['promptConfiguration']), 'whenDifferent');
    for (const current of ['zsh', 'bash', 'fish'] as const) {
      app['shellId'] = current;
      for (const defaultShell of ['zsh', 'bash', 'fish'] as const) {
        app['promptConfiguration'].shellBackend = defaultShell;
        const modules = renderedModules(app['promptContext'](''), app['promptConfiguration']);
        assert.equal(modules.some(module => module.id === 'shell'), current !== defaultShell);
      }
    }
    app['onInput']('\x1b[C');
    for (const current of ['zsh', 'bash', 'fish'] as const) {
      app['shellId'] = current;
      assert.match(renderedModules(app['promptContext'](''), app['promptConfiguration']).find(module => module.id === 'shell')!.text, new RegExp(current));
    }
    panel.selected++;
    app['onInput']('\x1b[C');
    let module = app['promptConfiguration'].modules.find(module => module.id === 'shell')!;
    assert.equal(routeModule(module), 'mainPrompt');
    assert.equal(app['shellId'], 'fish');
    app['onInput']('\x1b[C');
    module = app['promptConfiguration'].modules.find(module => module.id === 'shell')!;
    assert.equal(routeModule(module), 'rightContext');
    app['shellPanel'] = undefined;
    void app['startPromptSettings'](false);
    const prompt = app['promptPanelState']!;
    prompt.step = 'modules';
    prompt.selectedIndex = prompt.draft.modules.findIndex(module => module.id === 'shell');
    assert.equal(routeModule(prompt.draft.modules[prompt.selectedIndex]!), 'rightContext');
    handlePromptPanelKey({kind: 'text', value: 'p'}, prompt);
    app['refreshProviderPrompt'] = async () => {};
    await app['savePromptSettings']();
    app['openShellPanel']();
    assert.match(renderShellPanel(app['shellPanel']!, 100).map(stripAnsi).join('\n'), /Side.*Left/u);
    const reopened = app['shellPanel']!;
    applyShellIndicatorAction(app['promptConfiguration'], {kind: 'indicatorVisibility', visibility: 'whenDifferent'});
    app['promptConfiguration'].shellBackend = 'zsh';
    reopened.selected = reopened.shells.findIndex(item => item.adapter.id === 'fish');
    app['onInput']('d');
    assert.equal(app['promptConfiguration'].shellBackend, 'fish');
    assert.equal(app['shellId'], 'fish');
    assert.equal(renderedModules(app['promptContext'](''), app['promptConfiguration']).some(module => module.id === 'shell'), false);
  } finally { app['stop'](0); app['session'].kill(); if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; rmSync(root, {recursive: true, force: true}); }
});


test('/prompt side edits are reflected by /shell, including explicit Right Context and Auto', () => {
  for (const surface of ['rightContext', 'auto'] as const) {
    const c = normalizePromptConfiguration({modules: [{id: 'shell', visible: true, condition: 'always', surface}]});
    const state: PromptPanelState = {onboarding: false, step: 'modules', selectedIndex: 0, draft: c, saved: structuredClone(c)};
    state.selectedIndex = c.modules.findIndex(module => module.id === 'shell');
    handlePromptPanelKey({kind: 'text', value: 'p'}, state);
    const module = c.modules[state.selectedIndex]!;
    assert.equal(routeModule(module), 'mainPrompt', 'P toggles resolved Right to Left');
    const panel = createShellPanel(shells, 'zsh', 'zsh', undefined, c);
    assert.match(renderShellPanel(panel, 100).map(stripAnsi).join('\n'), /Side.*Left/u);
    handlePromptPanelKey({kind: 'text', value: 'p'}, state);
    assert.match(renderShellPanel(panel, 100).map(stripAnsi).join('\n'), /Side.*Right/u);
    handlePromptPanelKey({kind: 'text', value: ' '}, state);
    assert.match(renderShellPanel(panel, 100).map(stripAnsi).join('\n'), /Visibility.*Hidden/u);
  }
});

test('valid shell visibility and placement survive normalization and opening /shell unchanged', () => {
  for (const placement of [undefined, 'right'] as const) for (const surface of [undefined, 'mainPrompt', 'rightContext', 'auto', 'hidden', 'contextRail'] as const)
    for (const visible of [false, true]) for (const condition of ['always', 'shellDiffers'] as const) {
      const c = normalizePromptConfiguration({modules: [{id: 'shell', visible, condition, placement, surface}]});
      const before = JSON.stringify(c);
      const panel = createShellPanel(shells, 'bash', 'zsh', undefined, c);
      renderShellPanel(panel, 80);
      assert.equal(JSON.stringify(c), before);
      assert.deepEqual(normalizePromptConfiguration(c).modules, c.modules);
    }
  const c = normalizePromptConfiguration({modules: [{id: 'shell', visible: true, condition: 'always', placement: 'right', surface: 'hidden'}]});
  assert.equal(shellModuleVisibility(c), 'never');
  applyShellIndicatorAction(c, {kind: 'indicatorVisibility', visibility: 'always'});
  assert.equal(routeModule(c.modules.find(module => module.id === 'shell')!), 'rightContext');
});

test('Left/Right shell indicator and right Rail share live/preview geometry across narrow widths', () => {
  const app = new TerminalApp(); let frame: TerminalFrame | undefined;
  try {
    app['renderer'].render = next => {frame = next;};
    app['fetchSuggestions'] = async () => {};
    app['editor'].insert('echo hello');
    for (const columns of [100, 60, 40, 20]) for (const side of ['left', 'right'] as const) for (const composerLayout of ['oneLine', 'twoLine'] as const) {
      const c = normalizePromptConfiguration({composerLayout, placement: 'composer', modules: [
        {id: 'project', visible: true, condition: 'always', surface: 'mainPrompt'},
        {id: 'shell', visible: true, condition: 'always', surface: 'rightContext'},
        {id: 'gitBranch', visible: true, condition: 'inRepository', surface: 'contextRail'},
      ], contextRail: {...DEFAULT_PROMPT_CONFIGURATION.contextRail, relation: 'right', mode: 'always', integration: 'inside'}});
      c.modules = c.modules.filter(module => ['project', 'shell', 'gitBranch'].includes(module.id));
      c.nmsh.style = 'minimal';
      applyShellIndicatorAction(c, {kind: 'indicatorSide', side});
      app['promptConfiguration'] = c;
      app['context'] = {cwd: '/qa', project: 'QA', branch: 'RAIL', exitStatus: 0};
      app['dimensions'] = () => ({columns, rows: 30});
      app['render']();
      const context = app['promptContext']();
      const prepared = prepareRail(context, columns, c);
      const plan = app['planFrame'](columns, 30);
      if (columns >= 40) assert.deepEqual(frame!.rows.slice(plan.rail!.start, plan.rail!.end).map(stripAnsi), railCompositionPreview(context, columns, c).map(stripAnsi));
      assert.ok(frame!.rows.every(row => displayWidth(row) <= columns));
      if (side === 'right' && prepared.presentation.width) {
        const shellRow = frame!.rows.slice(plan.rail!.start, plan.rail!.end).map(stripAnsi).find(row => row.includes('zsh'))!;
        assert.match(shellRow.trimEnd(), /zsh[^a-z]*$/u, 'right shell anchor survives Rail');
        assert.ok(prepared.presentation.column + prepared.presentation.width < shellRow.indexOf('zsh'));
      }
      if (columns === 20) assert.equal(prepared.presentation.width, 0, 'Rail drops before competing with editor/right context');
    }
  } finally { app['stop'](0); app['session'].kill(); }
});

test('/shell control navigation wraps and display rows cannot switch or set a default', () => {
  const c = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const panel = createShellPanel(shells, 'zsh', 'zsh', undefined, c);
  shellPanelKey(panel, {kind: 'up'});
  assert.equal(panel.selected, shells.length + 1);
  for (const key of [{kind: 'enter'}, {kind: 'text', value: 'd'}, {kind: 'text', value: 'i'}] as const) assert.equal(shellPanelKey(panel, key), undefined);
  shellPanelKey(panel, {kind: 'down'});
  assert.equal(panel.selected, 0);
  assert.deepEqual(shellPanelKey({...panel, selected: 1}, {kind: 'enter'}), {kind: 'switch', shell: 'fish'});
  assert.deepEqual(shellPanelKey({...panel, selected: 1}, {kind: 'text', value: 'd'}), {kind: 'default', shell: 'fish'});
  for (const width of [40, 60, 80]) {
    const row = renderShellPanel(panel, width).map(stripAnsi).find(row => row.includes('zsh QA'))!;
    assert.match(row, /✓.*\[current\].*\[default\]/u);
  }
});


test('/transcript keeps its editable rows and save/cancel controls at normal terminal height', () => {
  const state = {selectedIndex: 0, draft: structuredClone(DEFAULT_PROMPT_CONFIGURATION.transcript), saved: structuredClone(DEFAULT_PROMPT_CONFIGURATION.transcript),
    presentation: {draft: 'normal' as const, saved: 'normal' as const}, folding: {draft: 'smart' as const, saved: 'smart' as const}};
  const rows = renderTranscriptPanel(state, 80, {cwd: '/qa'}, 26).map(stripAnsi);
  assert.ok(rows.length <= 26);
  assert.match(rows.at(-1)!, /Enter save · Esc cancel/u);
  assert.ok(rows.some(row => row.includes('Historical prompt')));
  assert.ok(rows.some(row => row.includes('Output folding')));
});


test('/transcript failed save keeps the draft and leaves live presentation unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-ux-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  const app = new TerminalApp(); app['render'] = () => {};
  try {
    app['startTranscriptSettings']();
    const state = app['transcriptPanelState']!;
    handleTranscriptPanelKey({kind: 'right'}, state);
    const blocked = join(root, 'blocked');
    writeFileSync(blocked, 'not a directory');
    process.env.XDG_CONFIG_HOME = blocked;
    app['saveTranscriptSettings']();
    assert.equal(app['transcriptPanelState'], state);
    assert.match(state.message!, /Could not save transcript settings/u);
    assert.ok(renderTranscriptPanel(state, 80, {cwd: '/qa'}, 26).map(stripAnsi).some(row => row.includes('Could not save transcript settings')));
    assert.equal(state.presentation!.draft, 'chat');
    assert.equal(app['promptConfiguration'].transcriptPresentation, 'normal');
    assert.equal(app['output'].presenter.layout, 'normal');
  } finally {
    app['stop'](0); app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    rmSync(root, {recursive: true, force: true});
  }
});


test('saved Hidden shell stays hidden while Side changes, reopens, and synchronizes with /prompt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-hidden-side-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  const path = join(root, 'nmsh', 'config.json');
  savePromptConfiguration(normalizePromptConfiguration({onboardingComplete: true, modules: [
    {id: 'shell', visible: true, condition: 'always', surface: 'hidden', placement: 'right'},
  ]}), path);
  const app = new TerminalApp();
  app['render'] = () => {};
  app['refreshProviderPrompt'] = async () => {};
  const shell = () => app['promptConfiguration'].modules.find(module => module.id === 'shell')!;
  const assertHidden = () => {
    assert.equal(shell().surface, 'hidden');
    assert.equal(shell().visible, true);
    assert.equal(shell().condition, 'always');
    assert.equal(shellModuleVisibility(app['promptConfiguration']), 'never');
    assert.equal(renderedModules(app['promptContext'](''), app['promptConfiguration']).some(module => module.id === 'shell'), false);
    assert.equal(loadPromptConfiguration(path).modules.find(module => module.id === 'shell')!.surface, 'hidden');
  };
  try {
    app['openShellPanel']();
    const panel = app['shellPanel']!;
    assert.match(renderShellPanel(panel, 100).map(stripAnsi).join('\n'), /Visibility.*Hidden[\s\S]*Side.*Right/u);
    panel.selected = panel.shells.length + 1;
    app['onInput']('\x1b[C');
    assertHidden();
    assert.equal(shell().placement, undefined, 'Side changes to Left independently');
    app['shellPanel'] = undefined;
    app['openShellPanel']();
    assert.match(renderShellPanel(app['shellPanel']!, 100).map(stripAnsi).join('\n'), /Visibility.*Hidden[\s\S]*Side.*Left/u);
    app['shellPanel'] = undefined;
    await app['startPromptSettings'](false);
    const prompt = app['promptPanelState']!;
    prompt.step = 'modules';
    prompt.selectedIndex = prompt.draft.modules.findIndex(module => module.id === 'shell');
    const module = prompt.draft.modules[prompt.selectedIndex]!;
    assert.equal(module.surface, 'hidden');
    assert.equal(module.placement, undefined);
    handlePromptPanelKey({kind: 'text', value: 'p'}, prompt);
    assert.equal(module.placement, 'right');
    assert.equal(module.surface, 'hidden');
    handlePromptPanelKey({kind: 'text', value: 'p'}, prompt);
    assert.equal(module.placement, undefined, 'P toggles the stored side even while Hidden');
    await app['savePromptSettings']();
    assertHidden();
    app['openShellPanel']();
    assert.match(renderShellPanel(app['shellPanel']!, 100).map(stripAnsi).join('\n'), /Visibility.*Hidden[\s\S]*Side.*Left/u);
    const enabled = structuredClone(app['promptConfiguration']);
    applyShellIndicatorAction(enabled, {kind: 'indicatorVisibility', visibility: 'always'});
    assert.equal(routeModule(enabled.modules.find(module => module.id === 'shell')!), 'mainPrompt', 'explicitly enabling uses the side chosen while Hidden');
  } finally {
    app['stop'](0); app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    rmSync(root, {recursive: true, force: true});
  }
});
