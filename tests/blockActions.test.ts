import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {blockCopyPayload, blockPaletteItems, blockAffordance} from '../src/ui/BlockActions.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {regionOf} from '../src/app/screenPlan.js';

function fixture(output: OutputBuffer) {
  output.beginCommand('echo hello', ['echo hello']);
  output.write('hello\n' + 'full output\n'.repeat(15));
  output.complete(0);
  return output.recent(1)!;
}
function app() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  return app;
}
function dispose(app: TerminalApp) { app['stop'](0); app['session'].kill(); }

test('one block registry supplies keyboard palette actions and copies authoritative full plain data', () => {
  const output = new OutputBuffer();
  const record = fixture(output);
  assert.equal(blockPaletteItems(record).length, 10, 'Copy as report… and Compare output… joined the actions');
  assert.equal(blockCopyPayload(record, 'copyCommand'), 'echo hello');
  assert.equal(blockCopyPayload(record, 'copyOutput'), record.output);
  assert.equal(blockCopyPayload(record, 'copyBoth'), record.command + '\n' + record.output);
  assert.ok(record.output.includes('full output'));
  assert.ok(!blockCopyPayload(record, 'copyBoth')!.includes('Actions'));
});
test('actions are passive, align right and never cover output at narrow widths in Normal/Chat', () => {
  const output = new OutputBuffer();
  const record = fixture(output);
  for (const mode of ['normal', 'chat'] as const) {
    output.presenter.setLayout(mode);
    const row = output.wrapped(100).find(row => row.lineIndex === record.outputStartId)!;
    assert.equal(row.blockStartId, record.startId);
    const affordance = blockAffordance(row, 100)!;
    assert.equal(affordance.column, 92);
    assert.ok(affordance.suffix.endsWith('[Actions]'));
    assert.equal(blockAffordance({...row, plain: 'x'.repeat(98)}, 100), undefined);
    assert.equal(blockAffordance({...row, isHistoricalHeader: true}, 100), undefined);
  }
});
test('keyboard focus opens actions; edit waits for Enter, rerun uses visible normal submission', async () => {
  const instance = app();
  try {
    const record = fixture(instance['output']);
    const submitted: string[] = [];
    Object.defineProperty(instance, 'submit', {value: async () => { submitted.push(instance['editor'].text); }});
    instance['handleKey']({kind: 'focusPrevious'});
    assert.equal(instance['focusedCommandIndex'], 0);
    instance['handleKey']({kind: 'enter'});
    assert.equal(instance['paletteState']?.items.length, 10);
    instance['paletteState'] = undefined;
    await instance['runBlockAction'](record.startId, 'edit');
    assert.equal(instance['editor'].text, record.command);
    assert.deepEqual(submitted, []);
    await instance['runBlockAction'](record.startId, 'rerun');
    assert.deepEqual(submitted, [record.command]);
    const expanded = record.expanded;
    await instance['runBlockAction'](record.startId, 'fold');
    assert.equal(record.expanded, !expanded);
    instance['output'].clearPresentation();
    await instance['runBlockAction'](record.startId, 'rerun');
    assert.equal(submitted.length, 1);
  } finally { dispose(instance); }
});
test('passive hover exposes owning output actions; Shift click/drag never reveal, focus or run them', () => {
  const instance = app();
  try {
    const record = fixture(instance['output']);
    instance['output'].presenter.setLayout('chat');
    const wrapped = instance['output'].wrapped(100);
    const plan = instance['planFrame'](100, 30);
    const start = instance['historyViewport'].resolve(wrapped.length, plan.viewportRows);
    const index = wrapped.findIndex(row => row.lineIndex === record.outputStartId);
    const y = regionOf(plan, 'transcript')!.top + index - start + 1;
    assert.deepEqual(decodeKeys(`\u001b[<4;96;${y}M\u001b[<36;96;${y}M`), []);
    instance['onInput'](`\u001b[<4;96;${y}M\u001b[<36;96;${y}M`);
    assert.equal(instance['hoveredLineIndex'], undefined);
    assert.equal(instance['paletteState'], undefined);
    instance['handleKey']({kind: 'mouseMove', x: 96, y});
    assert.equal(instance['hoveredLineIndex'], record.outputStartId);
    instance['handleKey']({kind: 'mouseClick', x: 96, y});
    assert.equal(instance['paletteState']?.items[0]?.action.kind, 'block');
    const state = instance['paletteState'];
    instance['onInput'](`\u001b[<4;96;${y}M`);
    assert.equal(instance['paletteState'], state);
  } finally { dispose(instance); }
});
