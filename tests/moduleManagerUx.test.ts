import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {handlePromptPanelKey, promptPanelControls, promptPanelOwnsKey, renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {catalogEntries, listedModules, modulesDirty, modulesItemCount, packEntries, type PackListing} from '../src/prompt/ModulesPanel.js';
import {parseSlashCommand, slashCommands} from '../src/commands/slashCommands.js';
import {paletteItems} from '../src/ui/CommandPalette.js';
import {firstPartyPacks} from '../src/context/modules.js';
import {cycleTab, tabCycleDelta} from '../src/ui/PanelShell.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const TAB: Key = {kind: 'complete'}, SHIFT_TAB: Key = {kind: 'focusPrevious'}, ESC: Key = {kind: 'escape'}, ENTER: Key = {kind: 'enter'};
const type = (s: PromptPanelState, text: string) => { for (const value of text) handlePromptPanelKey({kind: 'text', value}, s); };
function state(standalone = false): PromptPanelState {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  return {onboarding: false, step: 'modules', selectedIndex: 0, draft: structuredClone(saved), saved, ...(standalone ? {standalone} : {})};
}
const packs = (): PackListing[] => firstPartyPacks().map(parsed => ({id: parsed.pack.id, version: parsed.pack.version, name: parsed.pack.name,
  description: parsed.pack.description, builtIn: true, state: 'bundled', license: parsed.pack.license, author: parsed.pack.provenance.author,
  sha256: parsed.sha256, requires: parsed.pack.requires, modules: parsed.pack.modules.map(module => ({id: module.id, label: module.label}))}));
const text = (s: PromptPanelState, columns = 120) => stripAnsi(renderPromptPanel(s, columns, [], [], Infinity).join('\n'));
const controls = (s: PromptPanelState) => promptPanelControls(s).map(([name, action]) => `${name} ${action}`);

test('/modules is a first-class command, in the palette and help groups, separate from /prompt', () => {
  assert.deepEqual(parseSlashCommand('/modules'), {kind: 'modules'});
  assert.deepEqual(parseSlashCommand('/prompt'), {kind: 'prompt'});
  const command = slashCommands.find(item => item.name === '/modules');
  assert.equal(command?.group, 'Composer & transcript');
  assert.ok(paletteItems().some(item => item.id === 'slash:/modules'));
});

test('/ searches Modules, Catalog and Packs from loaded data; Esc clears the search before anything else', () => {
  const s = state();
  s.context = {packs: packs()};
  handlePromptPanelKey({kind: 'text', value: '/'}, s);
  assert.ok(s.search?.editing);
  assert.ok(promptPanelOwnsKey(s, ESC), 'Esc belongs to the search, not the panel');
  type(s, 'branch');
  assert.deepEqual(listedModules(s).map(module => module.id), ['gitBranch'], 'Modules: by label');
  assert.match(text(s), /Search branch/u);
  handlePromptPanelKey(ENTER, s);
  assert.equal(s.search?.editing, false, 'Enter keeps the filter and returns to the list');
  handlePromptPanelKey(TAB, s);
  assert.equal(s.modulesTab, 'catalog');
  const filtered = catalogEntries(s).filter(entry => entry.kind === 'module');
  assert.ok(filtered.some(entry => entry.kind === 'module' && entry.module.id === 'gitBranch'), 'Catalog: the filter is kept');
  assert.ok(filtered.length < 8, 'Catalog: only matching modules');
  handlePromptPanelKey(ESC, s);
  assert.equal(s.search, undefined, 'Esc clears a kept filter');
  handlePromptPanelKey({kind: 'text', value: '/'}, s);
  type(s, 'cloud');
  assert.ok(catalogEntries(s).filter(entry => entry.kind === 'module').length >= 3, 'Catalog: by category label');
  handlePromptPanelKey(ESC, s);
  handlePromptPanelKey({kind: 'text', value: '/'}, s);
  type(s, 'nmsh.agent');
  assert.ok(catalogEntries(s).some(entry => entry.kind === 'module' && entry.module.id.startsWith('nmsh.agent')), 'Catalog: by id');
  handlePromptPanelKey(ESC, s);
  handlePromptPanelKey(TAB, s);
  assert.equal(s.modulesTab, 'packs');
  handlePromptPanelKey({kind: 'text', value: '/'}, s);
  type(s, firstPartyPacks()[0]!.pack.id);
  const listed = packEntries(s.context, s.search!.query).filter(entry => entry.kind === 'pack');
  assert.equal(listed.length, 1, 'Packs: by id');
  handlePromptPanelKey({kind: 'backspace'}, s);
  assert.equal(s.selectedIndex, 0, 'selection stays valid as results change');
  handlePromptPanelKey(ESC, s);
  handlePromptPanelKey({kind: 'text', value: '/'}, s);
  type(s, 'zzzz-nothing');
  assert.match(text(s), /No matches/u);
  assert.equal(modulesItemCount(s), 1);
  handlePromptPanelKey(ESC, s);
  assert.equal(s.search, undefined);
  assert.equal(promptPanelOwnsKey(s, ESC), false, 'with no search, Esc goes back to the panel');
});

test('search text never triggers module shortcuts and reordering waits for a cleared search', () => {
  const s = state();
  const before = JSON.stringify(s.draft.modules);
  handlePromptPanelKey({kind: 'text', value: '/'}, s);
  type(s, ' spm');
  assert.equal(JSON.stringify(s.draft.modules), before, 'Space, S, P and M are text while searching');
  handlePromptPanelKey(ESC, s);
  handlePromptPanelKey({kind: 'text', value: '/'}, s);
  type(s, 'git');
  handlePromptPanelKey(ENTER, s);
  handlePromptPanelKey({kind: 'selectDown'}, s);
  assert.equal(JSON.stringify(s.draft.modules), before);
  assert.match(s.message ?? '', /Clear the search/u);
});

test('inside /prompt module edits are a visible draft with an explicit save; /modules saves as it goes', () => {
  const s = state();
  assert.match(text(s), /Part of the \/prompt draft · nothing unsaved/u);
  handlePromptPanelKey({kind: 'text', value: ' '}, s);
  assert.equal(modulesDirty(s), true);
  assert.match(text(s), /Unsaved · part of the \/prompt draft · A saves module changes now/u);
  assert.ok(controls(s).includes('A save modules now'));
  assert.ok(controls(s).includes('Esc back to /prompt'));
  handlePromptPanelKey({kind: 'text', value: 'a'}, s);
  assert.deepEqual(s.request, {kind: 'saveModules'}, 'A asks the frontend to persist module settings only');
  const direct = state(true);
  assert.match(text(direct), /Changes are saved as you make them/u);
  assert.equal(renderPromptPanel(direct, 80, [], [], Infinity)[0]!.includes('Modules'), true, 'titled Modules, not Prompt settings');
  assert.ok(controls(direct).includes('Esc close'));
  assert.ok(!controls(direct).some(control => control.startsWith('A ')));
  handlePromptPanelKey({kind: 'text', value: 'a'}, direct);
  assert.equal(direct.request, undefined);
  assert.match(direct.message ?? '', /already saved/u);
});

test('Tab and Shift+Tab cycle the module tabs with wrap-around; the shared helper wraps both ways', () => {
  const s = state();
  handlePromptPanelKey(SHIFT_TAB, s);
  assert.equal(s.modulesTab, 'packs', 'Shift+Tab wraps backwards');
  handlePromptPanelKey(TAB, s);
  assert.equal(s.modulesTab, 'modules', 'Tab wraps forwards');
  assert.equal(cycleTab(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(cycleTab(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(tabCycleDelta({kind: 'complete'}), 1);
  assert.equal(tabCycleDelta({kind: 'focusPrevious'}), -1);
  assert.equal(tabCycleDelta({kind: 'right'}), undefined);
});

test('controls that cannot act are not advertised, and pressing them anyway says why', () => {
  const s = state();
  s.context = {packs: packs(), recommendations: []};
  handlePromptPanelKey(SHIFT_TAB, s);
  assert.equal(s.modulesTab, 'packs');
  assert.ok(!controls(s).some(control => control.startsWith('Space')), 'nothing recommended: no Space control');
  handlePromptPanelKey({kind: 'text', value: ' '}, s);
  assert.match(s.message ?? '', /Space shows a recommended module/u, 'Space explains instead of silently doing nothing');
  const m = state();
  m.selectedIndex = listedModules(m).findIndex(module => module.id === 'cwd');
  assert.ok(!controls(m).some(control => control.startsWith('←→')), 'no other visibility option for the directory');
  handlePromptPanelKey({kind: 'right'}, m);
  assert.match(m.message ?? '', /no other visibility option/u);
  m.selectedIndex = listedModules(m).findIndex(module => module.id === 'exitStatus');
  assert.ok(controls(m).some(control => control.startsWith('←→')), 'exit status does offer one');
});

test('at 50 columns details wrap instead of truncating, keep Reads/History/status, and the footer wraps', () => {
  const s = state();
  s.context = {status: () => ({state: 'fresh', collectedAt: 0, evidence: 'AWS_PROFILE, AWS config'}), now: 4000, packs: packs()};
  s.selectedIndex = listedModules(s).findIndex(module => module.id === 'nmsh.cloud:aws');
  handlePromptPanelKey(ENTER, s);
  const rows = renderPromptPanel(s, 50, [], [], Infinity);
  for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= 50, `no row overflows: ${stripAnsi(row)}`);
  const shown = rows.map(row => stripAnsi(row)).join('\n');
  assert.match(shown, /Reads/u);
  assert.match(shown, /History\n {2}\S/u, 'label over wrapped value');
  assert.match(shown, /fresh · 4s ago/u);
  assert.doesNotMatch(shown, /…\n.*…\n.*…/u, 'facts are wrapped, not cut row after row');
  assert.deepEqual(renderPromptPanel(s, 50, [], [], Infinity), rows, 'deterministic');
  const list = state();
  const listRows = renderPromptPanel(list, 50, [], [], Infinity).map(row => stripAnsi(row));
  const footer = listRows.slice(listRows.lastIndexOf('') + 1);
  assert.ok(footer.length >= 2, 'the footer wraps at control boundaries');
  assert.ok(footer.join(' ').includes('Esc back to /prompt'), 'Esc is never cut off');
  assert.match(listRows.join('\n'), /Modules {2}Catalog {2}Packs|Modules.*Catalog.*Packs/u, 'tab labels stay recognisable');
});

test('external prompt providers keep the manager useful: unavailable surfaces say why, settings are kept, the Status Strip still works', async () => {
  const {surfaceAvailability} = await import('../src/context/surfaceRouter.js');
  const starship = {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), provider: 'starship' as const};
  starship.statusStrip.enabled = true;
  assert.deepEqual(surfaceAvailability('mainPrompt', starship), {available: false, reason: 'Starship draws the prompt'});
  assert.deepEqual(surfaceAvailability('statusStrip', starship), {available: true});
  assert.match((surfaceAvailability('mainPrompt', {...starship, provider: 'none'}) as {reason: string}).reason, /Prompt None/u);
  const s: PromptPanelState = {onboarding: false, step: 'modules', selectedIndex: 0, standalone: true, draft: structuredClone(starship), saved: structuredClone(starship)};
  const shown = text(s, 140);
  assert.match(shown, /Starship draws the prompt: Main Prompt, Right Context and Rail modules are kept but not shown\.\s+Status Strip modules still show\./u);
  const before = JSON.stringify(s.draft.modules);
  s.selectedIndex = listedModules(s).findIndex(module => module.id === 'cwd');
  handlePromptPanelKey({kind: 'enter'}, s);
  assert.match(text(s, 100), /Unavailable +Starship draws the prompt; the setting is kept/u);
  assert.equal(JSON.stringify(s.draft.modules), before, 'nothing is rerouted or dropped');
});

test('/modules through the app: each change is saved at once with feedback; Esc closes without a parent save', async () => {
  const {mkdtempSync, rmSync} = await import('node:fs');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const {loadPromptConfiguration} = await import('../src/prompt/configuration.js');
  const {TerminalApp} = await import('../src/app/TerminalApp.js');
  const root = mkdtempSync(join(tmpdir(), 'nm-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  const app = new TerminalApp();
  try {
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 40})});
    app['renderer'].render = (() => {}) as never;
    app['refreshModulesContext'] = (async () => {}) as never;
    app['loadInstalledPacks'] = (async () => {}) as never;
    await app['runSlash']('/modules', {kind: 'modules'});
    const state = app['promptPanelState']!;
    assert.equal(state.standalone, true);
    assert.equal(state.step, 'modules');
    const index = listedModules(state).findIndex(module => module.id === 'gitBranch');
    state.selectedIndex = index;
    const was = state.draft.modules.find(module => module.id === 'gitBranch')!.visible;
    app['handleKey']({kind: 'text', value: ' '});
    assert.equal(loadPromptConfiguration().modules.find(module => module.id === 'gitBranch')!.visible, !was, 'persisted immediately');
    assert.equal(app['promptConfiguration'].modules.find(module => module.id === 'gitBranch')!.visible, !was, 'live configuration follows');
    assert.equal(state.message, 'Saved.');
    app['handleKey']({kind: 'escape'});
    assert.equal(app['promptPanelState'], undefined, 'Esc closes /modules');
    assert.equal(loadPromptConfiguration().modules.find(module => module.id === 'gitBranch')!.visible, !was, 'nothing discarded');
  } finally {
    app['stop'](0); app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    rmSync(root, {recursive: true, force: true});
  }
});

test('/prompt → Modules: A saves module settings only, leaving other draft edits unsaved; Esc returns to /prompt', async () => {
  const {mkdtempSync, rmSync} = await import('node:fs');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const {loadPromptConfiguration} = await import('../src/prompt/configuration.js');
  const {TerminalApp} = await import('../src/app/TerminalApp.js');
  const root = mkdtempSync(join(tmpdir(), 'nm-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  const app = new TerminalApp();
  try {
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 40})});
    app['renderer'].render = (() => {}) as never;
    app['refreshModulesContext'] = (async () => {}) as never;
    const saved = structuredClone(app['promptConfiguration']);
    app['promptPanelState'] = {onboarding: false, step: 'modules', selectedIndex: 0, draft: structuredClone(saved), saved: structuredClone(saved)};
    const state = app['promptPanelState']!;
    state.draft.nmsh.style = state.draft.nmsh.style === 'minimal' ? 'powerline' : 'minimal';
    state.selectedIndex = listedModules(state).findIndex(module => module.id === 'gitBranch');
    app['handleKey']({kind: 'text', value: ' '});
    assert.equal(modulesDirty(state), true);
    app['handleKey']({kind: 'text', value: 'A'});
    await new Promise(resolve => setImmediate(resolve));
    const disk = loadPromptConfiguration();
    assert.equal(disk.modules.find(module => module.id === 'gitBranch')!.visible, !saved.modules.find(module => module.id === 'gitBranch')!.visible);
    assert.equal(disk.nmsh.style, saved.nmsh.style, 'the unrelated /prompt draft edit is not saved by A');
    assert.equal(modulesDirty(state), false);
    app['handleKey']({kind: 'escape'});
    assert.equal(app['promptPanelState']?.step, 'appearance', 'Esc returns to the parent /prompt screen with its draft');
  } finally {
    app['stop'](0); app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    rmSync(root, {recursive: true, force: true});
  }
});
