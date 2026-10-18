import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {parseSlashCommand, slashSuggestions} from '../src/commands/slashCommands.js';
import {normalizeCopy} from '../src/prompt/configuration.js';
import {blockPaletteItems} from '../src/ui/BlockActions.js';

function history(f: ReturnType<typeof executionFrameFixture>) {
  f.begin('printf old', 'old\n'); f.complete();
  f.begin('printf newest', 'a\tb 日本語\n\n' + 'full output\n'.repeat(400)); f.complete(2);
  return f.app['output'].recentShellCommands();
}

test('new configuration navigates; explicit persisted quick/picker choices and all direct selectors remain', async () => {
  assert.equal(normalizeCopy(undefined).mode, 'navigate');
  assert.equal(normalizeCopy({includeStatus: true}).mode, 'navigate');
  assert.equal(normalizeCopy({mode: 'quick'}).mode, 'quick');
  assert.equal(normalizeCopy({mode: 'picker'}).mode, 'picker');
  const f = executionFrameFixture();
  try {
    const [newest] = history(f);
    await f.app['copySlash']('/copy', '');
    assert.equal(f.app['outputNavigation']?.focusedId, newest!.startId);
    assert.equal(f.app['copyPicker'], undefined);
    f.app['handleKey']({kind: 'escape'});
    await f.app['copySlash']('/cp ui', 'ui');
    assert.ok(f.app['copyPicker']);
    f.app['handleKey']({kind: 'escape'});
    let copied: number[] = [];
    Object.defineProperty(f.app, 'copyRecords', {value: async (records: {startId: number}[]) => {copied = records.map(record => record.startId); return true;}});
    f.app['promptConfiguration'].copy.mode = 'quick';
    await f.app['copySlash']('/cp', ''); assert.deepEqual(copied, [newest!.startId]);
    f.app['promptConfiguration'].copy.mode = 'navigate';
    await f.app['copySlash']('/cp latest', 'latest'); assert.deepEqual(copied, [newest!.startId]);
    await f.app['copySlash']('/copy 2,1', '2,1'); assert.equal(copied.length, 2);
    f.app['promptConfiguration'].copy.mode = 'picker';
    await f.app['copySlash']('/copy', ''); assert.ok(f.app['copyPicker']);
  } finally { f.dispose(); }
});

test('navigation preserves fold/filter, detached stable anchor, draft/cursor and ordinary typing; Esc restores FOLLOW', async () => {
  const f = executionFrameFixture(32, 18);
  try {
    const records = history(f);
    f.app['output'].toggleExpanded(0);
    const expanded = records[0]!.expanded;
    f.app['editor'].insert('draft 日本'); f.app['editor'].moveLeft();
    const cursor = f.app['editor'].cursorIndex;
    const wrapped = f.app['output'].wrapped(32), height = f.app['planFrame'](32, 18).viewportRows;
    f.app['historyViewport'].resolve(wrapped.length, height);
    f.app['historyViewport'].scrollLines(wrapped.length, height, -10);
    const start = f.app['historyViewport'].start;
    await f.app['copySlash']('/cp', '');
    f.app['handleKey']({kind: 'up'}); assert.equal(f.app['outputNavigation']?.focusedId, records[1]!.startId);
    f.app['handleKey']({kind: 'escape'});
    assert.equal(f.app['historyViewport'].start, start); assert.equal(f.app['historyViewport'].mode, 'detached');
    assert.equal(f.app['editor'].text, 'draft 日本'); assert.equal(f.app['editor'].cursorIndex, cursor);
    assert.equal(records[0]!.expanded, expanded);
    f.app['historyViewport'].latest(); await f.app['copySlash']('/cp', '');
    f.app['handleKey']({kind: 'up'}); f.app['handleKey']({kind: 'escape'}); assert.equal(f.app['historyViewport'].mode, 'follow');
    await f.app['copySlash']('/cp', ''); f.app['handleKey']({kind: 'text', value: 'X'});
    assert.equal(f.app['outputNavigation'], undefined); assert.equal(f.app['editor'].text, 'draft 日X本');
  } finally { f.dispose(); }
});

test('Actions aliases resolve exact numbers; originating palette Esc returns and edit ends navigation before handoff', async () => {
  const f = executionFrameFixture();
  try {
    const records = history(f);
    for (const name of ['/actions', '/action']) {
      const slash = parseSlashCommand(name)!; assert.deepEqual(slash, {kind: 'actions'});
      await f.app['runSlash'](name, slash);
      f.app['handleKey']({kind: 'up'});
      const selected = f.app['outputNavigation']?.focusedId;
      f.app['handleKey']({kind: 'enter'});
      assert.deepEqual(f.app['paletteState']?.items, blockPaletteItems(records[1]!));
      f.app['handleKey']({kind: 'escape'}); assert.equal(f.app['outputNavigation']?.focusedId, selected);
      f.app['handleKey']({kind: 'escape'}); assert.equal(f.app['outputNavigation'], undefined);
    }
    await f.app['runSlash']('/action 2', parseSlashCommand('/action 2')!);
    assert.deepEqual(f.app['paletteState']?.items, blockPaletteItems(records[1]!));
    f.app['handleKey']({kind: 'escape'}); assert.equal(f.app['outputNavigation'], undefined);
    for (const invalid of ['/actions 0', '/action -1', '/actions 1,2', '/action 1000', '/actions 99']) {
      await f.app['runSlash'](invalid, parseSlashCommand(invalid)!); assert.equal(f.app['paletteState'], undefined);
    }
    await f.app['runSlash']('/actions', parseSlashCommand('/actions')!);
    f.app['handleKey']({kind: 'enter'});
    const item = f.app['paletteState']!.items.find(item => item.action.kind === 'block' && item.action.id === 'edit')!;
    await f.app['runPaletteItem'](item);
    assert.equal(f.app['outputNavigation'], undefined); assert.equal(f.app['editor'].text, records[0]!.command);
    assert.ok(slashSuggestions('/act').some(item => item.name === '/actions'));
  } finally { f.dispose(); }
});

test('generation/record disappearance cancels safely; ownership transfer never restores a stale draft or consumes program input', async () => {
  const f = executionFrameFixture();
  try {
    history(f); await f.app['copySlash']('/copy', '');
    const saved = f.app['output'].transcript();
    f.app['output'].restoreTranscript(saved); f.capture();
    assert.equal(f.app['outputNavigation'], undefined, 'even identical startIds cannot survive restore');
    await f.app['copySlash']('/copy', '');
    f.app['editor'].replaceText('new owner draft');
    f.begin('sleep 1'); f.capture(); assert.equal(f.app['outputNavigation'], undefined);
    assert.equal(f.app['editor'].text, 'new owner draft');
    await f.app['copySlash']('/copy', ''); assert.equal(f.app['outputNavigation'], undefined);
    f.complete();
    f.app['openPalette'](); await f.app['copySlash']('/copy', ''); assert.equal(f.app['outputNavigation'], undefined);
    f.app['paletteState'] = undefined;
    f.app['passthrough'] = true; await f.app['runSlash']('/actions', parseSlashCommand('/actions')!); assert.equal(f.app['outputNavigation'], undefined);
    f.app['passthrough'] = false;
    await f.app['copySlash']('/copy', ''); f.app['output'].clearPresentation(); f.capture(); assert.equal(f.app['outputNavigation'], undefined);
  } finally { f.dispose(); }
});

test('hidden/key input, shell switching and a foreign modal cannot open or retain selection', async () => {
  const f = executionFrameFixture();
  try {
    history(f);
    for (const mode of ['hidden', 'key'] as const) {
      f.begin('read input');
      f.app['inputState'] = {request: {since: 0, confidence: 'confirmed', mode}, timing: {waitedMs: 0, waits: 1}};
      await f.app['copySlash']('/copy', ''); assert.equal(f.app['outputNavigation'], undefined);
      await f.app['runSlash']('/actions', {kind: 'actions'}); assert.equal(f.app['outputNavigation'], undefined);
      f.complete();
    }
    f.app['inputState'] = undefined;
    await f.app['copySlash']('/copy', '');
    f.app['copyPicker'] = {records: [], query: '', searching: false, cursor: 0, chosen: new Set(), includeStatus: false, preview: true};
    f.capture(); assert.equal(f.app['outputNavigation'], undefined);
    f.app['copyPicker'] = undefined;
    f.app['shellSwitching'] = true;
    await f.app['copySlash']('/copy', ''); assert.equal(f.app['outputNavigation'], undefined);
  } finally { f.dispose(); }
});

test('vanished focused block never transfers Actions to its neighbor, and a global palette has no return token', async () => {
  const f = executionFrameFixture();
  try {
    history(f); await f.app['runSlash']('/actions', {kind: 'actions'});
    f.app['handleKey']({kind: 'enter'});
    f.app['output']['completed'].shift();
    f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['outputNavigation'], undefined); assert.equal(f.app['paletteState'], undefined);
    assert.match(f.app['clipboardNote']?.text ?? '', /no longer available/u);
    f.app['openPalette'](); f.app['handleKey']({kind: 'escape'});
    assert.equal(f.app['outputNavigation'], undefined); assert.equal(f.app['blockPaletteReturn'], undefined);
  } finally { f.dispose(); }
});

test('report flag navigates then enters existing redacted review without bypassing confirmation', async () => {
  const f = executionFrameFixture();
  try {
    f.begin('echo GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n'); f.complete();
    await f.app['copySlash']('/copy --report=plain', '--report=plain');
    assert.ok(f.app['outputNavigation']); assert.equal(f.app['reportReview'], undefined);
    await f.app['activateOutputNavigation']();
    assert.equal(f.app['outputNavigation'], undefined); assert.ok(f.app['reportReview']);
    assert.match(f.app['reportReview']!.text, /REDACTED/u);
    assert.doesNotMatch(f.app['reportReview']!.text, /ghp_abcdefghij/u);
  } finally { f.dispose(); }
});

test('direct contextual palettes reject reused IDs after restore and cannot run a newly unavailable action', async () => {
  const f = executionFrameFixture();
  try {
    const records = history(f);
    await f.app['runSlash']('/actions 1', {kind: 'actions', index: 1});
    const edit = f.app['paletteState']!.items.find(item => item.action.kind === 'block' && item.action.id === 'edit')!;
    const saved = f.app['output'].transcript(); f.app['output'].restoreTranscript(saved);
    await f.app['runPaletteItem'](edit);
    assert.equal(f.app['editor'].text, '', 'an old palette cannot edit a reused ID');
    f.app['paletteState'] = undefined;
    f.app['openBlockPalette'](records[0]!.startId);
    const explain = f.app['paletteState']!.items.find(item => item.action.kind === 'block' && item.action.id === 'explain')!;
    f.app['output'].recentShell(1)!.exitCode = 0;
    await f.app['runPaletteItem'](explain);
    assert.equal(f.app['askState'], undefined, 'failure-only availability is checked again on activation');
  } finally { f.dispose(); }
});

test('selection leaves active filters and folded representations intact across resize and does not select frontend metadata', async () => {
  const f = executionFrameFixture(80, 30);
  try {
    const [record] = history(f);
    const filter = {startId: record!.startId, clauses: [{query: '日本語', options: {regex: false, caseSensitive: false}, invert: false, context: 0}]};
    f.app['output'].setOutputFilter(filter);
    f.app['output'].addFrontendBlock('Queue Summary', ['3 succeeded']);
    const before = f.app['output'].wrapped(80).map(row => row.plain);
    await f.app['copySlash']('/cp', '');
    assert.equal(f.app['outputNavigation']?.focusedId, record!.startId);
    Object.defineProperty(f.app, 'dimensions', {value: () => ({columns: 32, rows: 18}), configurable: true});
    f.capture(); f.app['handleKey']({kind: 'escape'});
    assert.equal(f.app['output'].activeFilter, filter);
    Object.defineProperty(f.app, 'dimensions', {value: () => ({columns: 80, rows: 30}), configurable: true});
    assert.deepEqual(f.app['output'].wrapped(80).map(row => row.plain), before);
  } finally { f.dispose(); }
});

test('passive pointer movement and wheel/page inspection keep output navigation available', async () => {
  const f = executionFrameFixture();
  try {
    history(f); await f.app['copySlash']('/copy', '');
    const state = f.app['outputNavigation'];
    f.app['handleKey']({kind: 'mouseMove', x: 1, y: 2});
    assert.equal(f.app['outputNavigation'], state, 'passive mouse reports do not dismiss navigation');
    f.app['handleKey']({kind: 'wheelUp'}); assert.equal(f.app['outputNavigation'], state);
    f.app['handleKey']({kind: 'pageUp'}); assert.equal(f.app['outputNavigation'], state);
    f.app['handleKey']({kind: 'escape'}); assert.equal(f.app['historyViewport'].mode, 'follow');
  } finally { f.dispose(); }
});
