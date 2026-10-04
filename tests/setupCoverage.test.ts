import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {createSetup, renderSetup, SETUP_ENTRY_COVERAGE, SETUP_EQUIVALENTS, SETUP_SECTIONS, sectionIndex, setupKey, setupSelectedRow, setupChanges} from '../src/setup/SetupCat.js';
import {SETTINGS_ENTRIES, SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {appearanceRows} from '../src/prompt/PromptPanel.js';
import {PROMPT_STYLES} from '../src/prompt/powerline.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {hostCursorFacts, setCursorHostFacts} from '../src/cursor/backends.js';
import {stripAnsi} from '../src/util/text.js';
import {NATIVE_PROMPT_THEMES} from '../src/prompt/prompt.js';

const setupRowIds = () => new Set(SETUP_SECTIONS.flatMap(section => [...section.rows.map(item => item.row.id), ...(section.dynamicRows?.(DEFAULT_PROMPT_CONFIGURATION).map(item => item.row.id) ?? [])]));
const clone = (): PromptConfiguration => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const press = (state: ReturnType<typeof createSetup>, ...kinds: Array<'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' | 'complete'>) => {
  let result;
  for (const kind of kinds) result = setupKey(state, {kind});
  return result;
};
const goTo = (state: ReturnType<typeof createSetup>, section: string, row?: string) => {
  state.section = sectionIndex(section);
  state.row = 0;
  if (row) for (let guard = 0; guard < 80 && setupSelectedRow(state)?.row.id !== row; guard += 1) setupKey(state, {kind: 'down'});
  assert.ok(!row || setupSelectedRow(state)?.row.id === row, `reached ${row}`);
};

test('Setup coverage: every Settings row is discoverable from Setup, directly or through a labelled equivalent', () => {
  const ids = setupRowIds();
  // Rows that only exist while the tools step builds them are part of the Setup model too.
  ids.add('setupToolChoice'); ids.add('setupBrowseTools');
  const missing = SETTINGS_ROWS.filter(row => !ids.has(row.id) && !ids.has(SETUP_EQUIVALENTS[row.id] ?? '')).map(row => row.id);
  assert.deepEqual(missing, [], 'a new customization must be added to a Setup section (or mapped in SETUP_EQUIVALENTS with its route)');
  for (const [settingsId, setupId] of Object.entries(SETUP_EQUIVALENTS)) {
    assert.ok(SETTINGS_ROWS.some(row => row.id === settingsId), `${settingsId} is a real Settings row`);
    assert.ok(ids.has(setupId), `${setupId} exists in Setup`);
  }
});

test('Setup coverage: every Settings entry point (a full panel) has a Setup section or route', () => {
  const ids = setupRowIds();
  ids.add('setupToolChoice'); ids.add('setupBrowseTools');
  for (const entry of SETTINGS_ENTRIES) {
    const destination = (entry as {destination: string}).destination;
    const target = SETUP_ENTRY_COVERAGE[destination];
    assert.ok(target, `${entry.id} (${destination}) is reachable from Setup`);
    assert.ok(ids.has(target), `${target} exists in Setup for ${destination}`);
  }
  // Any editor Setup routes to is a real, handled destination.
  const destinations = new Set(SETTINGS_ROWS.filter(row => row.control === 'action' || row.control === 'child').map(row => (row as {destination: string}).destination));
  for (const destination of destinations) assert.ok(SETUP_ENTRY_COVERAGE[destination] || destination === 'prompt', `${destination} is covered`);
});

test('Setup coverage: the Native prompt style fields /prompt edits are all in Setup, for every style', () => {
  const prompt = SETUP_SECTIONS.find(section => section.id === 'prompt')!;
  for (const style of PROMPT_STYLES) {
    const draft = clone();
    draft.nmsh.style = style;
    const shown = new Set(prompt.dynamicRows!(draft).map(item => item.row.label));
    const wanted = appearanceRows(draft).filter(row => row.change && !row.edit && !row.opens
      && !['themeFamily', 'themeVariant', 'themeAccent', 'themeStudio', 'style', 'vibrance', 'promptSymbol', 'promptSymbolCustom', 'modules'].includes(row.id) && !row.id.endsWith('.separator'));
    for (const row of wanted) assert.ok(shown.has(row.label.trim()), `${style}: ${row.label.trim()} is in Setup`);
    assert.ok(wanted.length >= 1, `${style} has its own fields`);
  }
  // External prompts have no Native style fields.
  const external = {...clone(), provider: 'starship' as const};
  assert.deepEqual(prompt.dynamicRows!(external), []);
});

test('Setup → Editor exposes syntax highlighting, color mode and theme family/variant/accent with the real preview', () => {
  const editor = SETUP_SECTIONS.find(section => section.id === 'editor')!;
  const ids = editor.rows.map(item => item.row.id);
  for (const id of ['syntaxHighlighting', 'syntaxColors', 'syntaxThemeFamily', 'syntaxThemeVariant', 'syntaxThemeAccent']) assert.ok(ids.includes(id), id);
  const state = createSetup(clone(), 'syntax');
  assert.equal(SETUP_SECTIONS[state.section]!.id, 'editor', '/setup syntax opens the Editor step');
  goTo(state, 'editor', 'syntaxColors');
  // Follow prompt → Choose theme: family, variant and (Catppuccin) accent rows appear.
  const rowsAt = () => stripAnsi(renderSetup(state, 120, 60).join('\n'));
  assert.doesNotMatch(rowsAt(), /Syntax theme family/u);
  press(state, 'right');
  assert.equal(state.draft.syntax.colors, 'theme');
  assert.match(rowsAt(), /Syntax colors\s+‹ Choose theme ›/u);
  assert.match(rowsAt(), /Syntax theme family/u);
  press(state, 'right');
  assert.equal(state.draft.syntax.colors, 'grayscale');
  assert.doesNotMatch(rowsAt(), /Syntax theme family/u);
  press(state, 'left');
  goTo(state, 'editor', 'syntaxThemeFamily');
  for (let guard = 0; guard < 12 && !String(state.draft.syntax.theme).startsWith('catppuccin'); guard += 1) press(state, 'right');
  assert.equal(state.draft.syntax.theme, 'catppuccinMocha');
  assert.match(rowsAt(), /Syntax theme variant/u);
  assert.match(rowsAt(), /Syntax accent \(shared\)/u);
  goTo(state, 'editor', 'syntaxThemeVariant');
  press(state, 'right');
  assert.ok(String(state.draft.syntax.theme).startsWith('catppuccin') && state.draft.syntax.theme !== 'catppuccinMocha');
  goTo(state, 'editor', 'syntaxThemeAccent');
  const before = state.draft.nmsh.accent;
  press(state, 'right');
  assert.notEqual(state.draft.nmsh.accent, before, 'the accent is the one shared theme accent');
  // The draft, not the saved config, changed; the review lists the syntax choices.
  assert.equal(state.saved.syntax.colors, 'followPrompt');
  assert.ok(setupChanges(state).some(change => change.label === 'Syntax colors'));
});

test('Setup → Editor syntax preview is the real renderer and follows the draft theme', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['startSetup']();
    const state = app['setupState']!;
    state.section = sectionIndex('editor');
    state.draft = {...state.draft, syntax: {...state.draft.syntax, highlighting: true, colors: 'theme', theme: 'dracula'}};
    const dracula = app['withDraftTheme'](state.draft, () => app['setupPreview'](state, 120)).join('\n');
    state.draft = {...state.draft, syntax: {...state.draft.syntax, theme: 'nord'}};
    const nord = app['withDraftTheme'](state.draft, () => app['setupPreview'](state, 120)).join('\n');
    assert.notEqual(dracula, nord, 'a different syntax theme paints different colors');
    state.draft = {...state.draft, syntax: {...state.draft.syntax, colors: 'grayscale'}};
    const gray = app['withDraftTheme'](state.draft, () => app['setupPreview'](state, 120)).join('\n');
    assert.notEqual(gray, nord);
    assert.match(stripAnsi(gray), /git commit -m "fix"/u);
    void NATIVE_PROMPT_THEMES;
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('Setup routes: an editor Setup does not embed applies the draft first, then opens; list resets run on the draft', () => {
  const state = createSetup(clone(), 'appearance');
  goTo(state, 'appearance', 'setupChromeColors');
  state.draft = {...state.draft, reducedMotion: undefined} as never;
  const result = press(state, 'enter');
  assert.equal(result?.kind, 'apply');
  assert.equal(result?.kind === 'apply' && result.then, 'chromeColors');
  const tools = createSetup({...clone(), ignoredInstallSuggestions: ['bat', 'eza']}, 'tools');
  goTo(tools, 'tools', 'resetInstallSuggestions');
  assert.equal(press(tools, 'enter'), undefined, 'no editor opens');
  assert.deepEqual(tools.draft.ignoredInstallSuggestions, [], 'reset in the draft');
  assert.deepEqual(tools.saved.ignoredInstallSuggestions, ['bat', 'eza'], 'nothing saved until Apply');
});

test('Setup stays draft-based while its embedded cursor editor runs: nothing saves behind its back', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['startSetup']('cursor');
    const state = app['setupState']!;
    const saved = JSON.stringify(app['promptConfiguration'].cursor);
    goTo(state, 'cursor', 'cursorAdvanced');
    app['handleKey']({kind: 'enter'});
    assert.ok(state.cursorPanel, 'Advanced cursor tuning opens the real /cursor panel inside Setup');
    assert.equal(state.cursorPanel!.advanced, false);
    assert.ok(!app['cursorPanel'], 'it is not the standalone panel');
    app['handleKey']({kind: 'right'}); // Speed
    app['handleKey']({kind: 'text', value: 'a'});
    assert.equal(state.cursorPanel!.advanced, true, 'A reaches the physics');
    app['handleKey']({kind: 'down'});
    app['handleKey']({kind: 'down'});
    app['handleKey']({kind: 'right'});
    assert.notEqual(JSON.stringify(state.draft.cursor), saved, 'the change landed in the Setup draft');
    assert.equal(JSON.stringify(app['promptConfiguration'].cursor), saved, 'the live configuration is untouched');
    app['handleKey']({kind: 'escape'});
    assert.ok(state.cursorPanel && !state.cursorPanel.advanced, 'Esc leaves Advanced first');
    app['handleKey']({kind: 'escape'});
    assert.ok(!state.cursorPanel, 'then returns to Setup');
    assert.ok(app['setupState'], 'still in Setup');
    app['handleKey']({kind: 'escape'});
    assert.ok(state.confirmDiscard, 'Esc asks before discarding unapplied cursor edits');
    app['handleKey']({kind: 'enter'});
    assert.ok(!app['setupState']);
    assert.equal(JSON.stringify(app['promptConfiguration'].cursor), saved, 'discarded: nothing was ever applied');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('Setup cursor rows follow the effective renderer and its preview demonstrates the selected row', () => {
  const isolation = isolateConfig();
  setCursorHostFacts(hostCursorFacts({TERM_PROGRAM: 'Apple_Terminal'} as NodeJS.ProcessEnv, () => false));
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 120, rows: 50})});
    app['startSetup']('cursor');
    const state = app['setupState']!;
    state.draft = normalizePromptConfiguration({...state.draft, cursor: {...state.draft.cursor, renderer: 'native', shape: 'bar'}});
    goTo(state, 'cursor', 'cursorEffect');
    const text = stripAnsi(app['settingsPanelRows'](120).join('\n'));
    assert.match(text, /Cursor effect\s+Unavailable/u);
    assert.match(text, /Host native is not available in this terminal\./u);
    assert.doesNotMatch(text.split('\n').find(line => /Cursor effect/u.test(line))!, /‹|Unavailable ›/u, 'no arrows on an unavailable row');
    assert.match(text, /Preview · Cursor effect: Unavailable/u);
    goTo(state, 'cursor', 'cursorShape');
    const shape = stripAnsi(app['settingsPanelRows'](120).join('\n'));
    assert.match(shape, /Preview · Cursor shape: Bar/u);
    assert.match(shape, /thin line/u);
    setupKey(state, {kind: 'right'});
    assert.match(stripAnsi(app['settingsPanelRows'](120).join('\n')), /Preview · Cursor shape: Underline/u, 'the preview follows the draft immediately');
    assert.equal(app['renderer'].currentCursorStyle, '', 'previewing never changes the real cursor');
  } finally { setCursorHostFacts(undefined); app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('Setup → Motion previews the selected motion with the real renderer, and stops its clock', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 120, rows: 50})});
    app['startSetup']();
    const state = app['setupState']!;
    goTo(state, 'motion', 'motion_commandLaunch');
    const first = stripAnsi(app['settingsPanelRows'](120).join('\n'));
    assert.match(first, /Preview · Command launch/u);
    assert.match(first, /npm test/u);
    goTo(state, 'motion', 'motion_contextTransitions');
    assert.match(stripAnsi(app['settingsPanelRows'](120).join('\n')), /before\s+~\/project\s+main\s+Node 22/u);
    assert.ok(state.draft.motion, 'the same Motion settings Appearance edits');
    assert.ok(state.previewKey, 'the preview has started');
    app['handleKey']({kind: 'text', value: 'r'});
    assert.equal(state.previewKey, undefined, 'R replays: the next frame restarts the preview');
    assert.match(stripAnsi(app['settingsPanelRows'](120).join('\n')), /R replay preview/u);
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});
