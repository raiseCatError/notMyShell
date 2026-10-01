import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCommand, enrichCompletion} from '../src/shell/CommandKnowledge.js';
import {renderInspector} from '../src/shell/CommandInspector.js';
import {parseNativeCompletions} from '../src/shell/completion.js';
import {planScreen, regionOf} from '../src/app/screenPlan.js';
import {displayWidth} from '../src/util/text.js';

const inspect = (text: string, cursor = text.length) => inspectCommand(text, cursor, '/');
test('inspector shares completion knowledge across command, subcommand, flag and argument contexts', () => {
  assert.equal(inspect('git', 1)?.kind, 'command');
  assert.equal(inspect('git status')?.kind, 'subcommand');
  assert.match(inspect('rg --hidden', 7)?.description ?? '', /hidden/);
  assert.equal(inspect('rg pattern')?.kind, 'argument');
  assert.equal(inspect('rg -- --hidden')?.kind, 'argument');
  assert.equal(inspect('git log status')?.kind, 'argument');
  assert.equal(inspect('echo x | rg --hidden')?.command, 'rg');
  assert.equal(inspect('echo x\nrg --hidden')?.command, 'rg');
  const [candidate] = parseNativeCompletions('status', {buffer: 'git st', cwd: '/'});
  assert.equal(enrichCompletion(candidate!).description, inspect('git status')?.description);
});
test('candidate knowledge requires exact buffer, cwd and replacement provenance', () => {
  const text = 'rg --hidden';
  const [candidate] = parseNativeCompletions('--hidden -- native description', {buffer: text, cwd: '/'});
  assert.equal(inspectCommand(text, 8, '/', [candidate!])?.description, 'native description');
  assert.match(inspectCommand(text, 8, '/other', [candidate!])?.description ?? '', /hidden files/);
  assert.equal(inspect('unknown --help')?.source, 'context');
  assert.equal(inspect('echo "$(touch /tmp/never)"')?.source, 'context');
  assert.equal(inspect('rg # comment'), undefined);
  assert.equal(inspect(''), undefined);
  assert.equal(inspect('😀 rg --hidden', 2)?.source, 'context');
});
test('inspector uses grapheme cursor and bounded plain deterministic presentation', () => {
  assert.equal(inspect('rg "😀"', 5)?.value, '"😀"');
  for (const width of [1, 8, 20, 32, 80]) {
    const rows = renderInspector(inspect('rg --hidden'), width);
    assert.deepEqual(rows, renderInspector(inspect('rg --hidden'), width));
    assert.ok(rows.every(row => displayWidth(row) <= width && !row.includes('\u001b')));
  }
});
test('ScreenPlan places inspector beside composer independently of transcript layout', () => {
  for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
    for (const rows of [1, 5, 10, 24]) {
      const plan = planScreen({rows, inputRows: 1, suggestions: 2, inspectorRows: 2, running: false,
        detached: false, hasOutput: true, contextPlacement: 'header', hasVisibleContext: true,
        composerLayout: 'twoLine', composerPosition, transcriptRows: 3});
      assert.ok(plan.regions.reduce((sum, region) => sum + region.height, 0) <= rows);
      const inspector = regionOf(plan, 'inspector');
      const input = regionOf(plan, 'input');
      if (inspector && input) assert.ok(composerPosition === 'top' ? inspector.top > input.top : inspector.top < input.top);
    }
  }
});

import {TerminalApp} from '../src/app/TerminalApp.js';
test('keyboard palette toggles inspector without submitting tokens and panels hide it', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  const submitted: string[] = [];
  app['session'].submit = (text: string) => { submitted.push(text); };
  try {
    app['editor'].insert('unknown --help');
    await app['runPaletteItem']({id: 'inspector:toggle', label: '', detail: '', category: 'Command', action: {kind: 'toggleInspector'}});
    assert.ok(app['inspectorRows'](80).join(' ').includes('No local description'));
    assert.deepEqual(submitted, []);
    app['paletteState'] = {query: '', selectedIndex: 0, viewportStart: 0, items: []};
    assert.deepEqual(app['inspectorRows'](80), []);
    app['paletteState'] = undefined;
    await app['runPaletteItem']({id: 'inspector:toggle', label: '', detail: '', category: 'Command', action: {kind: 'toggleInspector'}});
    assert.deepEqual(app['inspectorRows'](80), []);
  } finally { app['stop'](0); app['session'].kill(); }
});
