import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {Key} from '../src/terminal/keys.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {
  createSetup, NATIVE_FIRST_MESSAGE, parseSetupEntry, providerNote, renderSetup, sectionIndex, SETUP_SECTIONS, setupChanges,
  setupIsIdempotent, setupKey, type SetupState,
} from '../src/setup/SetupCat.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {paletteItems} from '../src/ui/CommandPalette.js';
import {SETTINGS_ENTRIES} from '../src/ui/SettingsPanel.js';
import {NAVIGATION_PROVIDERS} from '../src/shell/DirectoryService.js';
import {WELCOME_PROVIDERS} from '../src/output/WelcomeProviders.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';

const plain = (rows: string[]) => rows.map(stripAnsi).join('\n');
const press = (state: SetupState, ...keys: Key[]) => { let result; for (const key of keys) result = setupKey(state, key); return result; };
const rowIndex = (state: SetupState, id: string) => SETUP_SECTIONS[state.section]!.rows.findIndex(row => row.row.id === id);

function lived(): PromptConfiguration {
  // A configuration after months of use.
  return normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, glyphStyle: 'safe', composerPosition: 'top', navigation: 'zoxide',
    picker: 'fzf', welcome: 'fastfetch', toolUpdateChecks: 'weekly', nmsh: {...DEFAULT_PROMPT_CONFIGURATION.nmsh, palette: 'ocean', style: 'minimal'},
    presentation: {...DEFAULT_PROMPT_CONFIGURATION.presentation, preset: 'aurora', motion: 'travel'}});
}

test('fresh use: Welcome states the native-first message and nothing is changed before Apply', () => {
  const state = createSetup(structuredClone(DEFAULT_PROMPT_CONFIGURATION));
  const text = plain(renderSetup(state, 100, 30)).replace(/\n\s+/gu, ' ');
  assert.match(text, /Setup Cat/u);
  assert.ok(text.includes(NATIVE_FIRST_MESSAGE));
  assert.match(text, /switch between Native and external providers anytime/u);
  assert.match(text, /Nothing changes until you apply/u);
  assert.deepEqual(setupChanges(state), []);
});

test('rerun after months of use shows the current choices as selected, not defaults', () => {
  const state = createSetup(lived());
  state.section = sectionIndex('history');
  const text = plain(renderSetup(state, 100, 30));
  assert.match(text, /Navigation\s+zoxide/u);
  assert.match(text, /Picker\s+fzf/u);
  state.section = sectionIndex('terminal');
  assert.match(plain(renderSetup(state, 100, 30)), /Glyph style\s+.*Safe \/ ASCII/u);
  state.section = sectionIndex('appearance');
  assert.match(plain(renderSetup(state, 100, 30)), /Theme family\s+.*NMSh/u);
  assert.match(plain(renderSetup(state, 100, 30)), /  Variant\s+Ocean/u, 'the variant nests under its family');
  assert.match(plain(renderSetup(state, 100, 30)), /Chroma\s+Aurora/u);
  assert.deepEqual(setupChanges(state), []);
});

test('cancel preserves the exact saved configuration; unapplied edits ask first', () => {
  const saved = lived();
  const state = createSetup(saved);
  state.section = sectionIndex('terminal');
  press(state, {kind: 'right'});
  assert.equal(state.draft.glyphStyle, 'nerd');
  assert.deepEqual(state.saved, saved, 'saved copy untouched while editing');
  assert.equal(press(state, {kind: 'escape'}), undefined);
  assert.equal(state.confirmDiscard, true);
  assert.match(plain(renderSetup(state, 100, 30)), /Discard unapplied Setup Cat changes/u);
  assert.equal(press(state, {kind: 'escape'}), undefined, 'Esc keeps editing');
  assert.equal(state.confirmDiscard, false);
  assert.deepEqual(press(state, {kind: 'escape'}, {kind: 'enter'}), {kind: 'cancel'});
  // No edits: Esc closes directly.
  assert.deepEqual(press(createSetup(saved), {kind: 'escape'}), {kind: 'cancel'});
});

test('apply with no edits is idempotent and reports unchanged', () => {
  const saved = lived();
  const state = createSetup(saved);
  // Tab moves between sections (Enter on an option row opens its choices).
  for (let i = 0; i < SETUP_SECTIONS.length - 1; i++) assert.equal(press(state, {kind: 'complete'}), undefined);
  assert.match(plain(renderSetup(state, 100, 30)), /No changes/u);
  const result = press(state, {kind: 'enter'});
  assert.equal(result?.kind, 'apply');
  if (result?.kind !== 'apply') return;
  assert.equal(result.changed, false);
  assert.ok(setupIsIdempotent(state));
  assert.deepEqual(result.configuration, normalizePromptConfiguration(saved));
});

test('edits show in Review & Apply with from → to and apply normalized configuration', () => {
  const state = createSetup(structuredClone(DEFAULT_PROMPT_CONFIGURATION));
  state.section = sectionIndex('editor');
  state.row = rowIndex(state, 'composerPosition');
  press(state, {kind: 'right'});
  state.section = SETUP_SECTIONS.length - 1;
  const text = plain(renderSetup(state, 100, 30));
  assert.match(text, /Composer position\s+Bottom → Top/u);
  const result = press(state, {kind: 'enter'});
  assert.equal(result?.kind, 'apply');
  if (result?.kind === 'apply') { assert.equal(result.changed, true); assert.equal(result.configuration.composerPosition, 'top'); }
});

test('direct entries are views into the same model; unknown entries are rejected', () => {
  assert.deepEqual(parseSlashCommand('/setup'), {kind: 'setup'});
  for (const entry of ['prompt', 'appearance', 'chroma', 'tools', 'editor']) {
    assert.deepEqual(parseSlashCommand(`/setup ${entry}`), {kind: 'setup', entry});
    assert.equal(parseSetupEntry(entry), entry);
  }
  assert.equal(parseSetupEntry('nope'), false);
  assert.equal(parseSlashCommand('/setup nope')?.kind, 'unknown');
  assert.equal(createSetup(DEFAULT_PROMPT_CONFIGURATION, 'prompt').section, sectionIndex('prompt'));
  assert.equal(createSetup(DEFAULT_PROMPT_CONFIGURATION, 'tools').section, sectionIndex('tools'));
  const chroma = createSetup(DEFAULT_PROMPT_CONFIGURATION, 'chroma');
  assert.equal(chroma.section, sectionIndex('appearance'));
  assert.equal(SETUP_SECTIONS[chroma.section]!.rows[chroma.row]!.row.id, 'treatmentPreset');
  // Tab moves through every section of the one model and wraps.
  const state = createSetup(DEFAULT_PROMPT_CONFIGURATION, 'editor');
  for (let i = 0; i < SETUP_SECTIONS.length; i++) press(state, {kind: 'complete'});
  assert.equal(state.section, sectionIndex('editor'));
  press(state, {kind: 'focusPrevious'});
  assert.equal(state.section, sectionIndex('editor') - 1);
});

test('reachable from /settings and the command palette', () => {
  assert.ok(SETTINGS_ENTRIES.some(entry => entry.id === 'setup' && entry.control === 'child' && entry.destination === 'setup'));
  const items = paletteItems();
  assert.ok(items.some(item => item.action.kind === 'slash' && item.action.command === '/setup'));
  assert.ok(items.some(item => item.action.kind === 'open' && item.action.destination === 'setup'));
});

test('provider screens are truthful: Native is built in, externals are optional with install state', () => {
  assert.equal(providerNote(NAVIGATION_PROVIDERS[0], undefined), 'Built in · no installation required');
  assert.match(providerNote(NAVIGATION_PROVIDERS[1], {state: 'missing'})!, /^Optional external navigation provider · not installed · NMSh keeps using Native/u);
  assert.match(providerNote(NAVIGATION_PROVIDERS[1], {state: 'installed'})!, /installed/u);
  const neofetch = WELCOME_PROVIDERS.find(provider => provider.id === 'neofetch')!;
  assert.match(providerNote(neofetch, {state: 'installed'})!, /Legacy \/ archived · Fastfetch is the recommended maintained alternative/u);
  const state = createSetup(DEFAULT_PROMPT_CONFIGURATION);
  state.section = sectionIndex('history');
  state.row = rowIndex(state, 'setupNavigation');
  assert.match(plain(renderSetup(state, 120, 30)), /NMSh does not define `z`/u);
  press(state, {kind: 'right'});
  state.context = {statuses: {zoxide: {state: 'installed'}}};
  assert.match(plain(renderSetup(state, 120, 30)), /zoxide itself provides `z`/u);
});

test('tools step: Native only resets providers in the draft; tiers never install; completion facts are muted', () => {
  const state = createSetup(lived());
  state.section = sectionIndex('tools');
  assert.match(plain(renderSetup(state, 120, 30)).replace(/\n\s+/gu, ' '), /NMSh works fully with its Native providers/u);
  state.row = SETUP_SECTIONS[state.section]!.rows.length; // the tool-choice row
  press(state, {kind: 'right'});
  assert.equal(state.tools, 'native');
  assert.equal(state.draft.navigation, 'native');
  assert.equal(state.draft.picker, 'native');
  press(state, {kind: 'right'});
  assert.equal(state.tools, 'recommended');
  assert.match(plain(renderSetup(state, 120, 30)), /each install asks first/u);
  state.context = {statuses: {}, completion: {completionSystem: true, zshCompletions: true, fzfTab: true}};
  const text = plain(renderSetup(state, 120, 30));
  assert.match(text, /Configured zsh completion\s+Detected/u);
  assert.match(text, /zsh-completions\s+Detected/u);
  assert.match(text, /fzf-tab\s+Detected · NMSh keeps its own completion UI/u);
  state.context = {statuses: {}, completion: {completionSystem: false, zshCompletions: false, fzfTab: false}};
  assert.doesNotMatch(plain(renderSetup(state, 120, 30)), /fzf-tab/u);
  // Update checks default Off and can be set here explicitly.
  state.row = rowIndex(state, 'toolUpdateChecks');
  const fresh = createSetup(DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(fresh.draft.toolUpdateChecks, 'off');
});

test('renders within width at every size, plain under NO_COLOR and Safe glyphs', () => {
  const state = createSetup(lived());
  const old = process.env.NO_COLOR;
  process.env.NO_COLOR = '1'; setIconStyle('safe');
  try {
    for (let section = 0; section < SETUP_SECTIONS.length; section++) {
      state.section = section;
      for (const [width, height] of [[20, 8], [44, 12], [80, 24], [160, 50]] as const) {
        const rows = renderSetup(state, width, height);
        assert.ok(rows.length <= height, `${section} ${width}x${height}`);
        assert.ok(rows.every(row => displayWidth(row) <= width));
        assert.ok(rows.every(row => !/\u001b\[(?:38|48);/u.test(row)));
      }
    }
  } finally { if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = old; setIconStyle('nerd'); }
});

async function withApp(run: (app: TerminalApp, configPath: string) => Promise<void> | void, initial?: object): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-setup-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const path = join(directory, 'nmsh', 'config.json');
  if (initial) { await mkdir(join(directory, 'nmsh'), {recursive: true}); await writeFile(path, JSON.stringify(initial)); }
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    await run(app, path);
  } finally {
    app['stop'](0);
    app['session'].kill();
    setIconStyle('nerd');
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
}

test('app: /setup never writes on open or cancel; Apply persists through the normal path and keeps unknown fields', () => withApp(async (app, path) => {
  const before = await readFile(path, 'utf8');
  await app['runSlash']('/setup', {kind: 'setup'});
  assert.ok(app['setupState']);
  app['handleKey']({kind: 'escape'});
  assert.equal(app['setupState'], undefined);
  assert.equal(await readFile(path, 'utf8'), before, 'cancel leaves the file byte-identical');

  await app['runSlash']('/setup editor', {kind: 'setup', entry: 'editor'});
  const state = app['setupState']!;
  state.row = rowIndex(state, 'composerPosition');
  app['handleKey']({kind: 'right'});
  for (let i = state.section; i < SETUP_SECTIONS.length - 1; i++) app['handleKey']({kind: 'complete'});
  app['handleKey']({kind: 'enter'});
  assert.equal(app['setupState'], undefined);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.composerPosition, 'top');
  assert.equal(saved.futureField, 'kept', 'unknown fields survive');
  assert.equal(saved.glyphStyle, 'safe');

  // Rerun with no edits: applying writes nothing new.
  const afterApply = await readFile(path, 'utf8');
  await app['runSlash']('/setup', {kind: 'setup'});
  for (let i = 0; i < SETUP_SECTIONS.length - 1; i++) app['handleKey']({kind: 'complete'});
  app['handleKey']({kind: 'enter'});
  assert.equal(await readFile(path, 'utf8'), afterApply);
}, {glyphStyle: 'safe', onboardingComplete: true, glyphChoiceComplete: true, toolsSetupComplete: true, futureField: 'kept'}));

test('app: Setup owns a clean screen, previews the drafted panel position, never touches the transcript, and leaves cleanly', () => withApp(async (app, path) => {
  const frames: Array<{rows: string[]}> = [];
  delete (app as unknown as Record<string, unknown>)['render']; // withApp stubs render; use the real one here
  app['renderer'].render = (frame: {rows: string[]}) => { frames.push(frame); };
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true; app['startupPending'] = false;
  app['output'].addFrontendInteraction('echo', 'WELCOME-BACKDROP-MARKER', '');
  app['render']();
  assert.ok(frames.at(-1)!.rows.some(row => row.includes('WELCOME-BACKDROP-MARKER')), 'the ordinary screen shows it');
  const transcriptBefore = JSON.stringify(app['output'].transcript());
  const before = await readFile(path, 'utf8');
  await app['runSlash']('/setup', {kind: 'setup'});
  app['render']();
  const rows = frames.at(-1)!.rows;
  assert.ok(rows.some(row => row.includes('Setup')), 'Setup Cat is drawn');
  assert.ok(!rows.some(row => row.includes('WELCOME-BACKDROP-MARKER')), 'the transcript/welcome is not drawn behind Setup');
  const bottomTitle = rows.findIndex(row => row.includes('Setup'));
  // The Start step edits the one stored field; the draft decides where the panel sits right away.
  const state = app['setupState']!;
  state.row = rowIndex(state, 'panelPosition');
  app['handleKey']({kind: 'right'});
  assert.equal(state.draft.panelPosition, 'top');
  app['render']();
  const topTitle = frames.at(-1)!.rows.findIndex(row => row.includes('Setup'));
  assert.ok(topTitle < bottomTitle, 'Top moves the panel to the top of the screen');
  assert.equal(app['promptConfiguration'].panelPosition, 'bottom', 'nothing is applied until Apply');
  for (let i = 0; i < 3 && app['setupState']; i += 1) app['handleKey']({kind: i === 0 ? 'escape' : 'text', value: 'y'} as never);
  assert.equal(app['setupState'], undefined);
  app['render']();
  assert.ok(frames.at(-1)!.rows.some(row => row.includes('WELCOME-BACKDROP-MARKER')), 'leaving restores the normal screen');
  assert.equal(JSON.stringify(app['output'].transcript()), transcriptBefore, 'transcript untouched');
  assert.equal(await readFile(path, 'utf8'), before);
  assert.ok(!SETUP_SECTIONS.some(section => JSON.stringify(section.intro).includes('Planned for')), 'no stale roadmap copy');
}, {onboardingComplete: true}));
