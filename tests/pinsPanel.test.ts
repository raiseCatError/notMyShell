import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {addPin, addRecipe, loadPins, pinsPath} from '../src/pins/PinStore.js';
import {createPinsPanel, hiddenCount, panelItems, pinsPanelKey, renderPinsPanel} from '../src/pins/PinsPanel.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {blockPaletteItems} from '../src/ui/BlockActions.js';
import {queuePanelKey} from '../src/queue/QueuePanel.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

// Pins are written under XDG_CONFIG_HOME: keep every test out of the real configuration.
const configHome = mkdtempSync(join(tmpdir(), 'nmsh-pins-ui-'));
process.env.XDG_CONFIG_HOME = configHome;
test.after(() => rmSync(configHome, {recursive: true, force: true}));
const reset = () => rmSync(join(configHome, 'nmsh'), {recursive: true, force: true});

const text = (value: string): Key => ({kind: 'text', value});
const typing = (panel: ReturnType<typeof createPinsPanel>, value: string) => { for (const char of value) pinsPanelKey(panel, text(char)); };
const data = () => { const loaded = loadPins(); assert.ok(loaded.ok); return loaded.ok ? loaded.value : {version: 1 as const, pins: [], recipes: []}; };

function app() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  return app;
}
function dispose(app: TerminalApp) { app['stop'](0); app['session'].kill(); }
const until = async (condition: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!condition() && Date.now() < end) await new Promise(done => setTimeout(done, 10)); };

test('/pins is the one entry point; the block menu offers Pin command', () => {
  assert.deepEqual(parseSlashCommand('/pins'), {kind: 'pins'});
  const output = new OutputBuffer();
  output.beginCommand('make test', ['make test']);
  output.write('ok\n');
  output.complete(0);
  assert.ok(blockPaletteItems(output.recent(1)!).some(item => item.action.kind === 'block' && item.action.id === 'pin'));
});

test('the panel: select, show other folders, rename, remove only after y, and nothing is stored by it', () => {
  reset();
  addPin({command: 'git status', cwd: '/w/app', scope: 'directory', name: 'st'}, undefined, 1);
  addPin({command: 'ls -la'}, undefined, 2);
  addPin({command: 'make', cwd: '/other', scope: 'directory'}, undefined, 3);
  const panel = createPinsPanel(data(), '/w/app');
  assert.deepEqual(panelItems(panel).map(item => item.kind === 'pin' && item.pin.command), ['git status', 'ls -la']);
  assert.equal(hiddenCount(panel), 1);
  pinsPanelKey(panel, text('a'));
  assert.equal(panelItems(panel).length, 3);
  pinsPanelKey(panel, text('a'));
  assert.equal(pinsPanelKey(panel, text('x')), undefined, 'x only asks');
  assert.equal(pinsPanelKey(panel, text('n')), undefined, 'n is not y');
  assert.equal(panel.mode, 'list');
  pinsPanelKey(panel, text('x'));
  assert.deepEqual(pinsPanelKey(panel, text('y')), {kind: 'delete', id: (panelItems(panel)[0] as {pin: {id: string}}).pin.id});
  pinsPanelKey(panel, text('r'));
  assert.equal(panel.input, 'st');
  typing(panel, '!!');
  assert.deepEqual(pinsPanelKey(panel, {kind: 'enter'}), {kind: 'rename', id: (panelItems(panel)[0] as {pin: {id: string}}).pin.id, name: 'st!!'});
  assert.equal(data().pins.length, 3, 'the panel itself changed nothing');
  assert.equal(pinsPanelKey(panel, {kind: 'escape'})?.kind, 'close');
});

test('Enter on a pin stages its command; on a recipe it asks for each value, validated, then returns them', () => {
  reset();
  addPin({command: 'echo staged'}, undefined, 1);
  const recipe = addRecipe({name: 'Copy', steps: ['cp {{src}} {{dest}}', 'ls {{dest}}']}, undefined, 2);
  assert.ok(recipe.ok);
  const panel = createPinsPanel(data(), '/w');
  assert.equal(panelItems(panel)[0]!.kind, 'recipe');
  assert.equal(pinsPanelKey(panel, {kind: 'enter'}), undefined);
  assert.equal(panel.mode, 'fill');
  typing(panel, '-rf');
  assert.equal(pinsPanelKey(panel, {kind: 'enter'}), undefined);
  assert.match(panel.message?.text ?? '', /start with "-"/u, 'an option-looking value is refused');
  panel.input = '';
  typing(panel, 'a file.txt');
  assert.equal(pinsPanelKey(panel, {kind: 'enter'}), undefined);
  typing(panel, './out');
  const action = pinsPanelKey(panel, {kind: 'enter'});
  assert.deepEqual(action && action.kind === 'use' && action.values, {src: 'a file.txt', dest: './out'});
  assert.equal(panel.mode, 'list');
  pinsPanelKey(panel, {kind: 'down'});
  assert.deepEqual(pinsPanelKey(panel, {kind: 'enter'}), {kind: 'stage', command: 'echo staged'});
  // Escape leaves a half-answered recipe without using it.
  pinsPanelKey(panel, {kind: 'up'});
  pinsPanelKey(panel, {kind: 'enter'});
  typing(panel, 'x');
  pinsPanelKey(panel, {kind: 'escape'});
  assert.equal(panel.mode, 'list');
  assert.equal(panel.fill, undefined);
});

test('the queue panel offers "save as recipe" only when something is queued', () => {
  const empty = {entries: []};
  assert.equal(queuePanelKey({selected: 0}, text('s'), empty), undefined);
  assert.deepEqual(queuePanelKey({selected: 0}, text('s'), {entries: [{id: 1, text: 'ls', addedAt: 1}]}), {kind: 'saveRecipe'});
});

test('the panel fits narrow windows and draws hostile text safely', () => {
  reset();
  addPin({command: 'echo \u001b[2J‮ hidden', name: 'x'.repeat(60)}, undefined, 1);
  addRecipe({name: 'R'.repeat(50), steps: ['echo {{a}}', 'echo \u001b[31mred']}, undefined, 2);
  const panel = createPinsPanel(data(), '/w', {composerText: 'ls', canEdit: true});
  for (const columns of [30, 50, 100]) {
    for (const selected of [0, 1]) {
      panel.selected = selected;
      const rows = renderPinsPanel(panel, columns, 22);
      assert.ok(rows.length <= 22);
      for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
      assert.ok(!rows.join('').includes('\u001b[2J') && !rows.join('').includes('‮'));
    }
  }
});

test('from a block: Pin command keeps the command, refuses secrets, and runs nothing', async () => {
  reset();
  const instance = app();
  try {
    const submitted: string[] = [];
    Object.defineProperty(instance, 'submit', {value: async () => { submitted.push('x'); }});
    const output = instance['output'];
    output.beginCommand('make test', ['make test']); output.write('ok\n'); output.complete(0);
    await instance['runBlockAction'](output.recent(1)!.startId, 'pin');
    assert.deepEqual(data().pins.map(pin => [pin.command, pin.scope]), [['make test', 'global']]);
    output.beginCommand('export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', ['x']); output.write(''); output.complete(0);
    await instance['runBlockAction'](output.recent(1)!.startId, 'pin');
    assert.equal(data().pins.length, 1, 'a secret was not stored');
    assert.equal(readFileSync(pinsPath(), 'utf8').includes('ghp_'), false);
    assert.deepEqual(submitted, []);
  } finally { dispose(instance); }
});

test('staging a pin puts it in an empty composer for review and never over typed text', async () => {
  reset();
  addPin({command: 'git log --oneline | head'}, undefined, 1);
  const instance = app();
  try {
    const submitted: string[] = [];
    Object.defineProperty(instance, 'submit', {value: async () => { submitted.push('x'); }});
    await instance['runSlash']('/pins', parseSlashCommand('/pins')!);
    assert.ok(instance['pinsPanel']);
    instance['editor'].insert('ls');
    await instance['handleKey']({kind: 'enter'});
    await until(() => instance['pinsPanel']?.message !== undefined);
    assert.equal(instance['editor'].text, 'ls');
    assert.match(instance['pinsPanel']!.message!.text, /composer has text/u);
    instance['editor'].clear();
    await instance['handleKey']({kind: 'enter'});
    await until(() => !instance['pinsPanel']);
    assert.equal(instance['editor'].text, 'git log --oneline | head');
    assert.deepEqual(submitted, []);
  } finally { dispose(instance); }
});

test('a recipe saved from the queue: values are quoted, the expanded commands are reviewed, and Enter there queues them', async () => {
  reset();
  const instance = app();
  try {
    instance['openPins']({naming: ['mkdir -p {{dir}}', 'cd {{dir}} && git init', 'echo done']});
    for (const char of 'Start repo') await instance['handleKey'](text(char));
    await instance['handleKey']({kind: 'enter'});
    await until(() => data().recipes.length === 1);
    assert.equal(data().recipes[0]!.name, 'Start repo');
    // Use it: the value is asked for, quoted as one word, and the commands wait for confirmation.
    await instance['handleKey']({kind: 'enter'});
    for (const char of "my project; touch x") await instance['handleKey'](text(char));
    await instance['handleKey']({kind: 'enter'});
    await until(() => Boolean(instance['batchReview']));
    const review = instance['batchReview']!;
    assert.match(review.title ?? '', /Recipe: Start repo/u);
    assert.deepEqual(review.entries.map(entry => entry.text), ["mkdir -p 'my project; touch x'", "cd 'my project; touch x' && git init", 'echo done']);
    assert.deepEqual(instance['queueState'].entries.map(entry => entry.text), [], 'reviewing queues nothing');
    await instance['handleKey']({kind: 'enter'});
    assert.deepEqual(instance['queueState'].entries.map(entry => entry.text), ["mkdir -p 'my project; touch x'", "cd 'my project; touch x' && git init", 'echo done']);
    // Editing or deleting the recipe afterwards cannot change what is already queued.
    await instance['openPins']();
    await instance['handleKey'](text('x'));
    await instance['handleKey'](text('y'));
    await until(() => data().recipes.length === 0);
    assert.equal(instance['queueState'].entries.length, 3);
  } finally { dispose(instance); }
});

test('a recipe with a placeholder inside quotes is not saved (it would be quoted twice)', async () => {
  reset();
  const instance = app();
  try {
    instance['openPins']({naming: ['echo "{{name}}"']});
    for (const char of 'Quoted') await instance['handleKey'](text(char));
    await instance['handleKey']({kind: 'enter'});
    assert.equal(data().recipes.length, 0);
    assert.match(instance['pinsPanel']!.message!.text, /inside quotes/u);
    assert.equal(instance['pinsPanel']!.mode, 'name', 'still asking, with the name kept');
  } finally { dispose(instance); }
});
