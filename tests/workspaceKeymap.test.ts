import test from 'node:test';
import assert from 'node:assert/strict';
import {applyKeymap, COMPOSER_MEANINGS, describeKeymap, hostNotes, KEY_NAMES, parseKeyName} from '../src/workspace/keymapConfig.js';
import {DEFAULT_BINDINGS, resolveBinding, WORKSPACE_ACTIONS} from '../src/workspace/keymap.js';
import {routeWorkspaceKey} from '../src/workspace/focus.js';
import type {Key} from '../src/terminal/keys.js';

const errors = (result: ReturnType<typeof applyKeymap>) => result.problems.filter(problem => problem.severity === 'error').map(problem => problem.message);

test('key names: only keys the parser tells apart; anything else is refused with the reason', () => {
  assert.deepEqual(parseKeyName('Shift+Tab'), {kind: 'focusPrevious'});
  assert.deepEqual(parseKeyName('/'), {kind: 'text', text: '/'});
  assert.deepEqual(parseKeyName('é'), {kind: 'text', text: 'é'});
  for (const name of ['Ctrl+B', 'Cmd+K', 'Alt+Left', 'ab', '', '\u001b', ' ']) assert.ok('error' in parseKeyName(name), name);
  assert.match((parseKeyName('Ctrl+B') as {error: string}).error, /not a key NMSh can tell apart/u);
  // Every named key has a composer meaning documented or is otherwise accounted for, so validation can explain it.
  for (const [name, chord] of Object.entries(KEY_NAMES)) if (name !== 'Enter') assert.ok(COMPOSER_MEANINGS[chord.kind], `${name} has a documented composer meaning`);
});

test('no keymap, the defaults; a valid keymap rebinds and unbinds', () => {
  assert.deepEqual(applyKeymap(undefined), {bindings: [...DEFAULT_BINDINGS], problems: []});
  const result = applyKeymap({version: 1, bind: [{key: 'x', context: 'panel', action: 'panel.close'}], unbind: [{key: 'q', context: 'panel'}]});
  assert.deepEqual(errors(result), []);
  assert.equal(resolveBinding(result.bindings, 'panel', {kind: 'text', value: 'x'} as Key), 'panel.close');
  assert.equal(resolveBinding(result.bindings, 'panel', {kind: 'text', value: 'q'} as Key), undefined);
  // Rebinding a key in a region replaces the default for that key only.
  const swapped = applyKeymap({version: 1, bind: [{key: 'Right', context: 'sidebar', action: 'sidebar.activate'}]});
  assert.equal(resolveBinding(swapped.bindings, 'sidebar', {kind: 'right'} as Key), 'sidebar.activate');
  assert.equal(resolveBinding(swapped.bindings, 'sidebar', {kind: 'enter'} as Key), 'sidebar.activate');
});

test('composer bindings: typing, Enter and job control are never taken; replacing a meaning must be explicit', () => {
  const refused = applyKeymap({version: 1, bind: [
    {key: 'Left', context: 'composerEmpty', action: 'sidebar.focus'},
    {key: 'p', context: 'composerEmpty', action: 'panel.toggle'},
    {key: 'Enter', context: 'composerEmpty', action: 'panel.toggle'},
    {key: 'Down', context: 'composerEmpty', action: 'sidebar.down'},
  ]});
  assert.deepEqual(errors(refused), [
    'Left with an empty draft opens the Sessions view; add "replaces": true to use it for sidebar.focus instead',
    'typing and Enter always reach the shell',
    'typing and Enter always reach the shell',
    'sidebar.down does not apply in composerEmpty',
  ]);
  assert.equal(refused.bindings.filter(binding => binding.context === 'composerEmpty').length, 0, 'refused entries change nothing');
  const accepted = applyKeymap({version: 1, bind: [{key: 'Left', context: 'composerEmpty', action: 'sidebar.focus', replaces: true}]});
  assert.deepEqual(errors(accepted), []);
  const context = {owner: 'COMPOSER' as const, composerEmpty: true, sidebarOpen: false, panelOpen: false, bindings: accepted.bindings};
  assert.equal(routeWorkspaceKey({kind: 'left'} as Key, context), 'sidebar.focus');
  assert.equal(routeWorkspaceKey({kind: 'left'} as Key, {...context, composerEmpty: false}), undefined, 'a draft still wins');
});

test('conflicts and malformed keymaps are reported; the defaults stand where an entry fails', () => {
  const conflict = applyKeymap({version: 1, bind: [{key: 'j', context: 'sidebar', action: 'sidebar.down'}, {key: 'j', context: 'sidebar', action: 'sidebar.up'}]});
  assert.deepEqual(errors(conflict), ['j is bound twice in sidebar; the first binding is kept']);
  assert.equal(resolveBinding(conflict.bindings, 'sidebar', {kind: 'text', value: 'j'} as Key), 'sidebar.down');
  assert.deepEqual(errors(applyKeymap({version: 2})), ['unsupported keymap version; expected 1']);
  assert.deepEqual(errors(applyKeymap([])), ['the keymap must be an object']);
  assert.deepEqual(errors(applyKeymap({version: 1, bind: {}, extra: 1})), ['unknown field "extra"', '"bind" must be a list']);
  assert.deepEqual(errors(applyKeymap({version: 1, bind: [{key: 'x', context: 'sidebar', action: 'shell.exec'}, {key: 'x', context: 'nowhere', action: 'panel.close'}]})),
    ['unknown action', 'context must be one of composerEmpty, sidebar, panel']);
  const many = applyKeymap({version: 1, bind: Array.from({length: 500}, () => ({key: 'z', context: 'panel', action: 'panel.close'}))});
  assert.ok(errors(many).includes('"bind" has more than 128 entries; the rest are ignored'));
  // Unbinding the only way back from the sidebar leaves a warning, not a silent trap.
  const trapped = applyKeymap({version: 1, unbind: [{key: 'Esc', context: 'sidebar'}, {key: 'Enter', context: 'sidebar'}]});
  const warnings = trapped.problems.filter(problem => problem.severity === 'warning').map(problem => problem.message);
  assert.ok(warnings.includes('no key returns from the sidebar to the composer; /sidebar still closes it'));
  assert.ok(warnings.includes(`nothing triggers sidebar.activate (${WORKSPACE_ACTIONS['sidebar.activate'].label}) now`));
  assert.deepEqual(applyKeymap({version: 1, unbind: [{key: 'k', context: 'panel'}]}).problems[0], {severity: 'warning', entry: 0, message: 'k is not bound in panel'});
});

test('host notes are specific and never claim delivery', () => {
  assert.deepEqual(hostNotes({kind: 'pageDown'}, {host: 'apple-terminal', tmux: false}), ['Terminal.app scrolls its own window on Page Up/Down; Shift+Page Up/Down reaches NMSh']);
  assert.deepEqual(hostNotes({kind: 'pageDown'}, {host: 'ghostty', tmux: false}), []);
  assert.deepEqual(hostNotes({kind: 'left'}, {host: 'ghostty', tmux: true, tmuxRootKeys: new Set(['Left', 'M-Up'])}), ['your tmux configuration binds Left in its root table, so tmux takes it before NMSh']);
  assert.match(hostNotes({kind: 'escape'}, {host: 'other', tmux: true}).join(), /escape-time/u);
});

test('help lists every binding in effect and the commands that always work', () => {
  const lines = describeKeymap(DEFAULT_BINDINGS);
  assert.equal(lines[0], 'Composer (empty draft): no keys');
  assert.ok(lines.includes('  Enter      open'));
  assert.ok(lines.includes('  /sidebar        show or hide the sidebar'));
  assert.ok(lines.includes('  /panel focus    focus the detail panel'));
});
