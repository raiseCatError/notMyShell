import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FirstRunWindow} from '../src/host/window/firstRun.js';
import type {MaximizeResult, Probe, WindowHost} from '../src/host/window/types.js';
import {createQuickSetup, renderSetup, setupKey} from '../src/setup/SetupCat.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * The one-time window offer in the selector and the app. The window is a fake: these tests prove when NMSh offers,
 * asks and puts back, never how a real terminal's window behaves.
 */

function fakeWindow(log: string[], options: {probe?: 'available' | 'unsupported'; maximize?: 'maximized' | 'failed'} = {}): FirstRunWindow {
  const host = (): WindowHost => ({name: 'Fake', *probe(): Generator<never, Probe> {
    log.push('probe');
    if (options.probe === 'unsupported') return {outcome: 'unsupported', reason: 'Ghostty on macOS offers no window zoom NMSh can ask for'};
    return {outcome: 'available', window: {host: 'Fake', *maximize(): Generator<never, MaximizeResult> {
      log.push('maximize');
      if (options.maximize === 'failed') return {outcome: 'permissionDenied', reason: 'macOS did not allow NMSh to ask Terminal about its window'};
      return {outcome: 'maximized', *restore() { log.push('restore'); return {outcome: 'restored' as const}; }};
    }}};
  }});
  return new FirstRunWindow(host, {sleep: async () => {}, sleepSync: () => {}});
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const text = (rows: readonly string[]) => rows.map(stripAnsi).join('\n');
const key = (value: string) => value.length === 1 ? {kind: 'text' as const, value} : {kind: value} as never;

test('the offer is one quiet row above the footer, answered with M or K; it fits every size, down to the tiniest', () => {
  const state = createQuickSetup(normalizePromptConfiguration({introSeen: true}), 0);
  state.onboarding = true;
  assert.doesNotMatch(text(renderSetup(state, 100, 30, 1000)), /screen space|Maximize/u, 'no offer until NMSh knows it can');
  state.quick!.windowOffer = true;
  const wide = renderSetup(state, 100, 30, 1000);
  const footer = wide.findIndex(row => /Aurora on/u.test(stripAnsi(row)));
  assert.match(stripAnsi(wide[footer - 1]!), /Use more screen space for setup\?\s+M\s+Maximize for setup\s+K\s+Keep current size/u, 'just above the footer');
  assert.match(stripAnsi(wide[footer]!), /continue/u, 'the footer keeps its keys');
  assert.match(text(renderSetup(state, 60, 22, 1000)), /M\s+Maximize/u);
  assert.match(text(renderSetup(state, 30, 10, 1000)), /M maximize · K keep size/u, 'the tiny list keeps the offer');
  for (const [columns, rows] of [[100, 30], [60, 22], [44, 16], [30, 10]] as const) {
    const frame = renderSetup(state, columns, rows, 1000);
    assert.equal(frame.length, rows);
    assert.ok(frame.every(row => stripAnsi(row).length <= columns), `${columns}×${rows} fits`);
  }
});

test('M and K answer the offer once, on the choices and in review; never inside Leave setup?, never without an offer', () => {
  const state = createQuickSetup(normalizePromptConfiguration({introSeen: true}), 0);
  state.onboarding = true;
  assert.equal(setupKey(state, key('m'), 1000), undefined, 'no offer, no effect');
  state.quick!.windowOffer = true;
  state.quick!.confirm = true;
  assert.equal(setupKey(state, key('m'), 1000), undefined, 'the leave sheet keeps its own keys');
  state.quick!.confirm = false;
  assert.deepEqual(setupKey(state, key('M'), 1000), {kind: 'maximize'});
  assert.equal(state.quick!.windowOffer, false, 'answered: the row goes');
  assert.equal(setupKey(state, key('m'), 1000), undefined, 'once');
  state.quick!.windowOffer = true;
  setupKey(state, key('enter'), 1000);
  assert.equal(state.quick!.review, true);
  assert.deepEqual(setupKey(state, key('k'), 1000), {kind: 'keepSize'}, 'in review too');
  assert.equal(state.quick!.windowOffer, false);
});

const firstRun = (f: ReturnType<typeof executionFrameFixture>) => {
  Object.assign(f.app['promptConfiguration'], {onboardingComplete: false, introSeen: false, toolsSetupComplete: false});
  f.app['startOnboarding']();
};
const frameText = (f: ReturnType<typeof executionFrameFixture>) => text(f.capture().frame.rows);

test('a genuine first run probes once and offers; M maximizes once; the window is put back after the ending lands', async () => {
  const f = executionFrameFixture(100, 32, 'rich');
  const log: string[] = [];
  let created = 0;
  f.app['createFirstRunWindow'] = () => { created++; return fakeWindow(log); };
  try {
    firstRun(f);
    await settle();
    assert.match(frameText(f), /Use more screen space for setup\?/u);
    f.app['handleKey'](key('m'));
    await settle();
    assert.deepEqual(log, ['probe', 'maximize']);
    assert.doesNotMatch(frameText(f), /screen space/u, 'answered');
    f.app['handleKey'](key('enter')); f.app['handleKey'](key('enter'));
    assert.ok(f.app['startupEnding'], 'the ending runs at the larger size');
    await settle();
    assert.deepEqual(log, ['probe', 'maximize'], 'never resized during the transition');
    for (let t = 0; t < 4000 && f.app['startupEnding']; t += 40) f.paint(40);
    await settle();
    assert.deepEqual(log, ['probe', 'maximize', 'restore'], 'put back once the ending is done');
    assert.equal(created, 1);
    // Nothing about the window is saved anywhere.
    assert.doesNotMatch(JSON.stringify(f.app['promptConfiguration']), /maximi[sz]/iu);
    // Reopening /startup never offers or touches the window.
    f.app['startSetup']('quick'); f.capture();
    await settle();
    assert.doesNotMatch(frameText(f), /screen space/u);
    assert.equal(created, 1, 'no new probe for /startup');
  } finally { f.dispose(); }
});

test('K keeps the size: nothing is maximized or put back; an unavailable window shows no offer at all', async () => {
  for (const choice of ['k', 'unavailable'] as const) {
    const f = executionFrameFixture(100, 32, 'rich');
    const log: string[] = [];
    f.app['createFirstRunWindow'] = () => fakeWindow(log, choice === 'unavailable' ? {probe: 'unsupported'} : {});
    try {
      firstRun(f);
      await settle();
      if (choice === 'k') { assert.match(frameText(f), /screen space/u); f.app['handleKey'](key('k')); }
      else assert.doesNotMatch(frameText(f), /screen space|Maximize/u);
      f.app['handleKey'](key('enter')); f.app['handleKey'](key('enter'));
      for (let t = 0; t < 4000 && f.app['startupEnding']; t += 40) f.paint(40);
      await settle();
      assert.deepEqual(log, ['probe'], choice);
    } finally { f.dispose(); }
  }
});

test('Leave puts the window back at once; Reduced Motion puts it back right after Apply; exiting puts it back before NMSh ends', async () => {
  const leave = executionFrameFixture(100, 32, 'rich');
  const leaveLog: string[] = [];
  leave.app['createFirstRunWindow'] = () => fakeWindow(leaveLog);
  try {
    firstRun(leave);
    await settle();
    leave.app['handleKey'](key('m'));
    leave.app['handleKey'](key('escape')); leave.app['handleKey'](key('right')); leave.app['handleKey'](key('enter'));
    await settle();
    assert.equal(leave.app['setupState'], undefined);
    assert.deepEqual(leaveLog, ['probe', 'maximize', 'restore'], 'a restore asked for mid-maximize waits for it');
  } finally { leave.dispose(); }
  const reduced = executionFrameFixture(100, 32, 'reduced');
  const reducedLog: string[] = [];
  reduced.app['createFirstRunWindow'] = () => fakeWindow(reducedLog);
  try {
    firstRun(reduced);
    await settle();
    reduced.app['handleKey'](key('m'));
    await settle();
    reduced.app['handleKey'](key('enter')); reduced.app['handleKey'](key('enter'));
    assert.equal(reduced.app['startupEnding'], undefined);
    await settle();
    assert.deepEqual(reducedLog, ['probe', 'maximize', 'restore']);
  } finally { reduced.dispose(); }
  const exiting = executionFrameFixture(100, 32, 'rich');
  const exitLog: string[] = [];
  exiting.app['createFirstRunWindow'] = () => fakeWindow(exitLog);
  try {
    firstRun(exiting);
    await settle();
    exiting.app['handleKey'](key('m'));
    await settle();
    exiting.app['stop'](0);
    assert.deepEqual(exitLog, ['probe', 'maximize', 'restore'], 'synchronously, before the frontend ends');
  } finally { exiting.dispose(); }
});

test('a maximize the host refused is said once, quietly, and setup goes on at the current size', async () => {
  const f = executionFrameFixture(100, 32, 'rich');
  const log: string[] = [];
  f.app['createFirstRunWindow'] = () => fakeWindow(log, {maximize: 'failed'});
  try {
    firstRun(f);
    await settle();
    f.app['handleKey'](key('m'));
    await settle();
    assert.equal(f.app['setupState'].message, 'This window could not be maximized, so setup continues at its current size.');
    assert.match(frameText(f), /This window could not be maximized/u, 'shown in the selector (it wraps beside the list)');
    f.app['handleKey'](key('enter')); f.app['handleKey'](key('enter'));
    for (let t = 0; t < 4000 && f.app['startupEnding']; t += 40) f.paint(40);
    await settle();
    assert.deepEqual(log, ['probe', 'maximize'], 'nothing to put back');
  } finally { f.dispose(); }
});

test('a later launch never offers: the first-run selector itself never reopens once introduced', async () => {
  const f = executionFrameFixture(100, 32, 'rich');
  let created = 0;
  f.app['createFirstRunWindow'] = () => { created++; return fakeWindow([]); };
  try {
    Object.assign(f.app['promptConfiguration'], {onboardingComplete: false, introSeen: true});
    f.app['startOnboarding']();
    Object.assign(f.app['promptConfiguration'], {onboardingComplete: true, introSeen: true});
    f.app['startOnboarding']();
    await settle();
    assert.equal(created, 0);
  } finally { f.dispose(); }
});

test('window control stays out of shared onboarding and rendering code', () => {
  for (const file of ['src/setup/SetupCat.ts', 'src/setup/startup/view.ts', 'src/setup/startup/selector.ts', 'src/setup/startup/sky.ts', 'src/setup/startup/ending.ts', 'src/output/FirstRunWelcome.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /osascript|AppleScript|hyprctl|kitten|host\/window/u, file);
  }
});
