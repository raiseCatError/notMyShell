import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

/** A frontend whose terminal is `columns`×`rows`; drawing is a no-op and the shell is the ordinary in-process one. */
function app(columns: number, rows = 30): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'terminalDimensions', {value: () => ({columns, rows})});
  instance['startupPending'] = false;
  // The regions are experimental and Off by default; these tests are about them, so they are turned on.
  instance['configuration'] = {...instance['configuration'], workspacePanels: true};
  // Listings are the test's: no tmux or Git is asked.
  Object.defineProperty(instance, 'refreshWorkspaceSources', {value: async () => {}});
  return instance;
}
const done = (instance: TerminalApp) => { instance['stop'](0); instance['session'].kill(); };
const slash = async (instance: TerminalApp, text: string) => instance['runSlash'](text, parseSlashCommand(text)!);
const key = (instance: TerminalApp, value: Key) => instance['handleKey'](value);

test('/sidebar and /panel parse with their focus forms; /keys with reload', () => {
  assert.deepEqual(parseSlashCommand('/sidebar'), {kind: 'workspace', region: 'sidebar', focus: false});
  assert.deepEqual(parseSlashCommand('/panel focus'), {kind: 'workspace', region: 'panel', focus: true});
  assert.deepEqual(parseSlashCommand('/keys reload'), {kind: 'keys', reload: true});
  assert.equal(parseSlashCommand('/sidebar now')?.kind, 'unknown');
});

test('a docked sidebar narrows the center: wrapping, ScreenPlan and the PTY follow one width; a drawer never resizes the shell', async () => {
  const wide = app(160);
  try {
    assert.equal(wide['dimensions']().columns, 160);
    await slash(wide, '/sidebar');
    const plan = wide['workspaceColumns']();
    assert.equal(plan.sidebar.mode, 'docked');
    assert.equal(wide['dimensions']().columns, plan.center.width);
    assert.equal(plan.ptyColumns, plan.center.width, 'the shell is sized to the center');
    assert.equal(wide['workspaceOwner'](), 'COMPOSER', 'opening a docked region does not take the keyboard');
    // A fullscreen program owns the whole pane: no regions, every column for the program.
    wide['passthrough'] = true;
    assert.equal(wide['dimensions']().columns, 160);
    wide['passthrough'] = false;
  } finally { done(wide); }
  const narrow = app(70);
  try {
    await slash(narrow, '/sidebar');
    assert.equal(narrow['workspaceColumns']().sidebar.mode, 'drawer');
    assert.equal(narrow['workspaceOwner'](), 'LEFT_SIDEBAR', 'a region that can only be a drawer opens focused');
    assert.equal(narrow['dimensions']().columns, 70, 'opening a drawer never resizes the shell');
    key(narrow, {kind: 'escape'});
    assert.equal(narrow['workspaceOwner'](), 'COMPOSER');
    assert.equal(narrow['workspaceColumns']().sidebar.mode, 'hidden', 'the drawer tucks away when the composer has the keyboard');
    assert.equal(narrow['workspace'].state.sidebarOpen, true, 'tucking is not closing');
  } finally { done(narrow); }
});

test('typing always reaches the composer unless a region has the keyboard; a region keeps its own keys', async () => {
  const instance = app(160);
  try {
    await slash(instance, '/sidebar');
    instance['workspace'].setSources({cwd: '/'});
    key(instance, {kind: 'text', value: 'ls'});
    assert.equal(instance['editor'].text, 'ls', 'an open, unfocused sidebar takes nothing');
    instance['editor'].clear();
    await slash(instance, '/sidebar focus');
    assert.equal(instance['workspaceOwner'](), 'LEFT_SIDEBAR');
    const before = instance['workspace'].sidebar.selectedId;
    key(instance, {kind: 'down'});
    assert.notEqual(instance['workspace'].sidebar.selectedId, before, 'Down moves the sidebar selection');
    key(instance, {kind: 'text', value: 'x'});
    assert.equal(instance['editor'].text, '', 'unbound typing in a focused region does not leak into the composer');
    key(instance, {kind: 'complete'});
    assert.equal(instance['workspaceOwner'](), 'COMPOSER', 'Tab cycles to the next open region, here the composer');
  } finally { done(instance); }
});

test('protected owners are never intercepted: a program reading keys, startup and panels keep every key', async () => {
  const instance = app(160);
  try {
    await slash(instance, '/sidebar focus');
    assert.equal(instance['workspaceOwner'](), 'LEFT_SIDEBAR');
    // A foreground program reading hidden or single-key input owns typing, even over a focused region.
    Object.defineProperty(instance, 'directInputRequest', {value: () => ({mode: 'key'}), configurable: true});
    assert.equal(instance['workspaceOwner'](), 'PASSTHROUGH');
    assert.equal(instance['handleWorkspaceKey']({kind: 'down'}), false);
    Object.defineProperty(instance, 'directInputRequest', {value: () => undefined, configurable: true});
    instance['startupPending'] = true;
    assert.equal(instance['workspaceOwner'](), 'PASSTHROUGH');
    instance['startupPending'] = false;
    instance['comparePanel'] = {} as never;
    assert.equal(instance['workspaceOwner'](), 'PANEL');
    assert.equal(instance['handleWorkspaceKey']({kind: 'escape'}), false);
    instance['comparePanel'] = undefined;
    assert.equal(instance['workspaceOwner'](), 'LEFT_SIDEBAR', 'focus returns to the region once the panel is gone');
  } finally { done(instance); }
});

test('the composed frame fills the terminal, keeps the Status Strip full width and moves the caret into the center', async () => {
  const instance = app(160, 20);
  try {
    await slash(instance, '/sidebar');
    await slash(instance, '/panel');
    const plan = instance['workspaceColumns']();
    const center = plan.center.width;
    const screen = instance['planFrame'](center, 20);
    const frame = {rows: Array.from({length: screen.rows}, (_, index) => `row ${index}\u001B[K`), columns: center, cursorRow: 3, cursorColumn: 5, cursorVisible: true};
    const composed = instance['composeWorkspaceFrame'](frame, screen);
    assert.equal(composed.columns, 160);
    for (const row of composed.rows) assert.equal(displayWidth(row), 160);
    assert.equal(composed.cursorColumn, 5 + plan.center.x);
    assert.equal(composed.cursorVisible, true);
    assert.ok(stripAnsi(composed.rows[2]!).slice(plan.center.x).startsWith('row 2'));
    await slash(instance, '/panel focus');
    assert.equal(instance['composeWorkspaceFrame'](frame, screen).cursorVisible, false, 'no composer caret while a region has the keyboard');
  } finally { done(instance); }
});

test('pointer: center events become center-relative; a click on a region focuses it, a click back in the center returns', async () => {
  const instance = app(160);
  try {
    await slash(instance, '/sidebar');
    const plan = instance['workspaceColumns']();
    const routed = instance['routeWorkspacePointer']({kind: 'mouseMove', x: plan.center.x + 4, y: 5});
    assert.deepEqual(routed, {kind: 'mouseMove', x: 4, y: 5});
    assert.equal(instance['routeWorkspacePointer']({kind: 'mouseClick', x: 2, y: 5}), undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(instance['workspaceOwner'](), 'LEFT_SIDEBAR');
    instance['routeWorkspacePointer']({kind: 'mouseClick', x: plan.center.x + 4, y: 5});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(instance['workspaceOwner'](), 'COMPOSER');
  } finally { done(instance); }
});

test('opening a worktree stages its cd in an empty composer, never over a draft and never run', async () => {
  const instance = app(160);
  try {
    const intent = {kind: 'changeDirectory' as const, path: '/tmp/work tree'};
    instance['editor'].replaceText('make test');
    await instance['performWorkspaceIntent'](intent);
    assert.equal(instance['editor'].text, 'make test');
    assert.match(instance['workspace'].message ?? '', /draft is kept/u);
    instance['editor'].clear();
    await instance['performWorkspaceIntent'](intent);
    assert.equal(instance['editor'].text, "cd -- '/tmp/work tree'");
    assert.equal(instance['running'], undefined, 'staged, not submitted');
  } finally { done(instance); }
});

test('keymap.json opt-in: Left with an empty draft focuses the sidebar only with "replaces"; typing still reaches the shell', async () => {
  const config = mkdtempSync(join(tmpdir(), 'nt-keys-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  mkdirSync(join(config, 'nmsh'), {recursive: true});
  writeFileSync(join(config, 'nmsh', 'keymap.json'), JSON.stringify({version: 1, bind: [{key: 'Left', context: 'composerEmpty', action: 'sidebar.focus', replaces: true}]}));
  const instance = app(160);
  try {
    instance['workspace'].loadKeymap();
    assert.deepEqual(instance['workspace'].problems.filter(problem => problem.severity === 'error'), []);
    key(instance, {kind: 'text', value: 'a'});
    key(instance, {kind: 'left'});
    assert.equal(instance['workspaceOwner'](), 'COMPOSER', 'with a draft, Left edits it');
    instance['editor'].clear();
    key(instance, {kind: 'left'});
    assert.equal(instance['workspaceOwner'](), 'LEFT_SIDEBAR');
    const shown: string[] = [];
    Object.defineProperty(instance['output'], 'addFrontendInteraction', {value: (_command: string, text: string) => { shown.push(text); }});
    instance['showWorkspaceKeys']('/keys', false);
    assert.match(shown[0]!, /Composer \(empty draft\)\n {2}← +focus the sidebar/u);
  } finally {
    done(instance);
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    rmSync(config, {recursive: true, force: true});
  }
});
