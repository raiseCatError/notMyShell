import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {blockPaletteItems} from '../src/ui/BlockActions.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';

function app() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  return app;
}
function dispose(app: TerminalApp) { app['stop'](0); app['session'].kill(); }
function run(output: OutputBuffer, command: string, text: string, exitCode: number) {
  output.beginCommand(command, [command]);
  output.write(text);
  output.complete(exitCode);
  return output.recent(1)!;
}

test('the block menu offers references only when the output has some', () => {
  const output = new OutputBuffer();
  const plain = run(output, 'echo hi', 'hi\n', 0);
  assert.equal(blockPaletteItems(plain).some(item => item.action.kind === 'block' && item.action.id === 'references'), false);
  const failing = run(output, 'npm test', 'FAIL src/main.ts:42:7\nsee https://example.com/doc\n', 1);
  assert.equal(blockPaletteItems(failing).some(item => item.action.kind === 'block' && item.action.id === 'references'), true);
});

test('the references menu lists an action and Copy for each, and says so when there are none', async () => {
  const instance = app();
  try {
    const record = run(instance['output'], 'npm test', 'FAIL src/main.ts:42:7\nsee https://example.com/doc\n', 1);
    await instance['runBlockAction'](record.startId, 'references');
    const items = instance['paletteState']!.items;
    assert.deepEqual(items.map(item => item.label), ['Open src/main.ts:42:7', 'Copy src/main.ts:42:7', 'Open https://example.com/doc', 'Copy https://example.com/doc']);
    instance['paletteState'] = undefined;
    const quiet = run(instance['output'], 'echo hi', 'hi\n', 0);
    await instance['runBlockAction'](quiet.startId, 'references');
    assert.equal(instance['paletteState'], undefined);
  } finally { dispose(instance); }
});

test('Inspect commit stages a command for review: it never runs, and never replaces what is typed', async () => {
  const instance = app();
  try {
    const submitted: string[] = [];
    Object.defineProperty(instance, 'submit', {value: async () => { submitted.push(instance['editor'].text); }});
    const record = run(instance['output'], 'git log --oneline', '* dead6ee subject\n', 0);
    const [reference] = (await import('../src/output/references.js')).findOutputReferences(record);
    instance['editor'].insert('ls -la');
    await instance['runReference'](record.startId, reference!.id, 'stage');
    assert.equal(instance['editor'].text, 'ls -la', 'typed text is untouched');
    instance['editor'].clear();
    await instance['runReference'](record.startId, reference!.id, 'stage');
    assert.equal(instance['editor'].text, 'git show dead6ee');
    assert.deepEqual(submitted, [], 'staging never submits');
  } finally { dispose(instance); }
});

test('an action on a reference that is gone, or a hostile one, does nothing', async () => {
  const instance = app();
  try {
    const submitted: string[] = [];
    Object.defineProperty(instance, 'submit', {value: async () => { submitted.push('x'); }});
    const record = run(instance['output'], 'git log', 'commit dead6ee; rm -rf ~\n', 0);
    await instance['runReference'](record.startId, 'commit:dead6ee; rm -rf ~', 'stage');
    await instance['runReference'](999_999, 'commit:dead6ee', 'stage');
    assert.equal(instance['editor'].text, '');
    assert.deepEqual(submitted, []);
  } finally { dispose(instance); }
});

test('failure navigation walks failed blocks by command record: nonzero exits and interrupts count, error text does not', () => {
  const instance = app();
  try {
    const output = instance['output'];
    const first = run(output, 'make a', 'error: looked bad but exited 0\n', 0);
    const older = run(output, 'make b', 'boom\n', 2);
    run(output, 'make c', 'fine\n', 0);
    const newest = run(output, 'sleep 99', '', 130);
    assert.deepEqual(instance['failedBlockIndexes'](), [0, 2]);
    instance['goToFailure']('previous');
    assert.equal(output.recent((instance['focusedCommandIndex'] ?? 0) + 1)?.startId, newest.startId);
    instance['goToFailure']('previous');
    assert.equal(output.recent((instance['focusedCommandIndex'] ?? 0) + 1)?.startId, older.startId);
    const before = instance['focusedCommandIndex'];
    instance['goToFailure']('previous');
    assert.equal(instance['focusedCommandIndex'], before, 'no older failure: focus stays');
    instance['goToFailure']('next');
    assert.equal(output.recent((instance['focusedCommandIndex'] ?? 0) + 1)?.startId, newest.startId);
    assert.notEqual(first.startId, newest.startId);
  } finally { dispose(instance); }
});

test('the palette offers failure navigation only when there is a failure', () => {
  const instance = app();
  try {
    run(instance['output'], 'echo ok', 'ok\n', 0);
    instance['openPalette']();
    assert.equal(instance['paletteState']!.items.some(item => item.action.kind === 'failure'), false);
    instance['paletteState'] = undefined;
    run(instance['output'], 'false', '', 1);
    instance['openPalette']();
    assert.equal(instance['paletteState']!.items.filter(item => item.action.kind === 'failure').length, 2);
  } finally { dispose(instance); }
});
