import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFrameFixture, type CaptureMode} from './support/executionTimelineFrames.js';
import {regionOf, regionAt} from '../src/app/screenPlan.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {queueRowKey} from '../src/status/queueTransitions.js';

const plain = (value: ReturnType<ReturnType<typeof executionFrameFixture>['capture']>) => value.frame.rows.map(stripAnsi);

for (const [columns, rows] of [[80, 30], [32, 18]]) test(`production queue frames preserve screen-plan and PTY geometry at ${columns}x${rows}`, () => {
  const f = executionFrameFixture(columns, rows);
  try {
    f.begin('npm run build', '> building project\n'); f.tick(1000);
    const foreground = f.capture();
    assert.equal(regionOf(foreground.plan, 'queue'), undefined);
    f.owner.request({op: 'add', text: 'npm test'});
    f.owner.request({op: 'add', text: 'git status'});
    const running = f.capture();
    assert.equal(running.plan.ptyRows, foreground.plan.ptyRows, 'queue cannot resize active PTY');
    assert.deepEqual(regionOf(running.plan, 'input'), regionOf(foreground.plan, 'input'), 'fixed composer stays docked');
    for (const value of [foreground, running]) {
      assert.equal(value.frame.rows.length, rows);
      assert.equal(regionAt(value.plan, value.frame.cursorRow - 1)?.region.kind, 'input');
      for (const row of value.frame.rows) assert.ok(displayWidth(row) <= columns, stripAnsi(row));
    }
    const queue = regionOf(running.plan, 'queue')!, activity = regionOf(running.plan, 'activity')!;
    assert.ok(queue.top < activity.top && activity.top < regionOf(running.plan, 'input')!.top);
    assert.match(plain(running).slice(queue.top, queue.top + queue.height).join('\n'), /npm run build.*Running/u);
    assert.match(plain(running).join('\n'), /› npm test.*Next/u);
    f.tick(7200); f.complete(); f.begin('npm test', 'test suite started\n');
    const promoted = f.capture();
    assert.match(plain(promoted).join('\n'), /› git status.*Next/u);
    assert.match(plain(promoted).join('\n'), /npm test.*Running/u);
    const early = f.paint(70), late = f.paint(90), settled = f.paint(900);
    for (const value of [early, late, settled]) {
      assert.deepEqual(value.plan, promoted.plan, 'effects use the cached production plan');
      assert.deepEqual(plain(value).slice(0, queue.top).map(row => row.trimEnd()), plain(promoted).slice(0, queue.top).map(row => row.trimEnd()), 'effect does not scroll transcript');
      assert.equal(value.frame.cursorRow, promoted.frame.cursorRow);
    }
    assert.equal(f.app['transitions'].busy, false);
    f.capture(); assert.equal(f.app['transitions'].busy, false, 'redraw does not reanimate');
    const raw = f.app['output'].transcript().records;
    assert.equal(serializeCopyPayload(raw[0]!), '> building project\n', 'chrome never contaminates raw output');
  } finally { f.dispose(); }
});

test('production row feedback is anchored to observed identity and pruned when hidden', () => {
  const f = executionFrameFixture();
  try {
    f.begin('build'); f.owner.request({op: 'add', text: 'test'}); f.owner.request({op: 'add', text: 'status'});
    f.tick(1000); f.complete(); f.begin('test'); f.capture();
    const first = f.owner.state.timeline!.executions[0]!;
    const second = f.owner.state.timeline!.executions[1]!;
    const live = f.app['transitions'].live(Date.now()).filter(effect => effect.kind === 'row');
    assert.ok(live.some(effect => effect.kind === 'row' && effect.target === queueRowKey(1, 'execution', first.id) && effect.tone === 'success'));
    assert.ok(live.some(effect => effect.kind === 'row' && effect.target === queueRowKey(1, 'execution', second.id) && effect.tone === 'accent'));
    f.app['inputState'] = {request: {since: Date.now(), confidence: 'confirmed', mode: 'hidden'}} as never;
    f.capture();
    assert.equal(f.app['transitions'].live(Date.now()).some(effect => effect.kind === 'row'), false);
    f.app['inputState'] = undefined; f.capture();
    assert.equal(f.app['transitions'].live(Date.now()).some(effect => effect.kind === 'row'), false, 'revealing cannot replay hidden feedback');
  } finally { f.dispose(); }
});

for (const mode of ['reduced', 'effects-off', 'no-color', 'safe', 'safe-no-color', 'low-color'] as CaptureMode[]) test(`${mode} production frames settle with truthful static states`, () => {
  const f = executionFrameFixture(32, 18, mode);
  try {
    f.begin('build'); f.owner.request({op: 'add', text: 'test'}); f.tick(1400); f.complete(17);
    const value = f.capture(), text = plain(value).join('\n');
    assert.match(text, /Failed · exit 17 · build/u);
    assert.match(text, /[›>] test.*Paused/u);
    assert.match(text, /Paused · exit 17/u);
    assert.equal(f.app['transitions'].live(Date.now()).some(effect => effect.kind === 'row'), false);
    if (mode.includes('no-color')) assert.doesNotMatch(value.frame.rows.slice(regionOf(value.plan, 'queue')!.top, regionOf(value.plan, 'activity')!.top + 2).join(''), /\u001b\[(?:38|48);/u);
    const state = structuredClone(f.app['queueState']);
    f.app['replaying'] = true;
    f.app['onQueueState'](state, {}); f.app['replaying'] = false;
    f.capture();
    assert.equal(f.app['transitions'].live(Date.now()).some(effect => effect.kind === 'row'), false, 'replay/redraw remains static');
  } finally { f.dispose(); }
});


test('independent foreground failure preserves paused provenance and original pause presentation', () => {
  const f = executionFrameFixture();
  try {
    f.begin('build'); f.owner.request({op: 'add', text: 'test'});
    f.owner.request({op: 'pause'}); f.tick(1000); f.complete(); f.paint(1000);
    const before = structuredClone(f.owner.state);
    f.begin('unrelated', 'separate output\n'); f.tick(500); f.complete(23);
    const value = f.capture();
    assert.deepEqual(f.owner.state.timeline?.executions, before.timeline?.executions);
    assert.deepEqual(f.owner.state.timeline?.counts, before.timeline?.counts);
    assert.deepEqual(f.owner.state.paused, before.paused);
    assert.match(plain(value).join('\n'), /Paused manually/u);
    assert.doesNotMatch(plain(value).slice(regionOf(value.plan, 'queue')!.top).join('\n'), /exit 23/u);
  } finally { f.dispose(); }
});

test('rapid results settle hidden identities; terminal replay and expired retention never restart effects', () => {
  const f = executionFrameFixture();
  try {
    f.begin('one');
    for (const text of ['two', 'three', 'four', 'five']) f.owner.request({op: 'add', text});
    for (const text of ['two', 'three', 'four', 'five']) { f.tick(2); f.complete(); f.begin(text); }
    f.tick(2); f.complete();
    const finished = f.capture();
    const visible = new Set(f.app['queueVisibleRows'].keys());
    const live = f.app['transitions'].live(Date.now()).filter(effect => effect.kind === 'row');
    assert.ok(live.length <= 3, 'only two visible results and one aggregate can remain');
    assert.ok(live.every(effect => effect.kind === 'row' && (visible.has(effect.target) || effect.target.endsWith(':summary'))));
    f.paint(1000);
    f.app['replaying'] = true; f.app['onQueueState'](structuredClone(f.owner.state), {}); f.app['replaying'] = false;
    f.capture(); assert.equal(f.app['transitions'].busy, false);
    f.tick(7100); const dismissed = f.capture();
    assert.equal(regionOf(dismissed.plan, 'queue'), undefined);
    assert.equal(dismissed.plan.ptyRows, finished.plan.ptyRows);
    assert.equal(f.app['output'].transcript().records.length, 5);
    assert.equal(f.owner.state.timeline?.counts.succeeded, 5);
  } finally { f.dispose(); }
});


test('presentation handoff releases the shared effect clock and cannot replay old row feedback', () => {
  const f = executionFrameFixture();
  try {
    f.begin('build'); f.owner.request({op: 'add', text: 'test'}); f.tick(500); f.complete(17); f.capture();
    assert.equal(f.app['transitions'].busy, true);
    assert.ok(f.app['transitionClock']);
    f.app['cancelPresentation']();
    assert.equal(f.app['transitionClock'], undefined, 'no orphan clock without a cached frame');
    assert.equal(f.app['transitions'].busy, false);
    f.capture(); assert.equal(f.app['transitions'].busy, false);
  } finally { f.dispose(); }
});
