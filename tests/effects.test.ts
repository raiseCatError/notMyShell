import assert from 'node:assert/strict';
import test from 'node:test';
import {PresentationClock} from '../src/motion/PresentationClock.js';
import {EffectState, effectCells, applyEffect, effectRegion, EFFECT_DURATION_MS, MAX_PARTICLES} from '../src/motion/effects.js';
import {planScreen} from '../src/app/screenPlan.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {normalizeTreatmentSettings} from '../src/chroma/treatment.js';
import {displayWidth} from '../src/util/text.js';

test('one demand-driven clock stops after final subscriber; callbacks can dispose during a frame', t => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 0});
  const clock = new PresentationClock();
  let a = 0, b = 0;
  const stopA = clock.subscribe(() => a++);
  const stopB = clock.subscribe(() => b++, 1000);
  assert.equal(clock.subscriberCount, 2);
  t.mock.timers.tick(100);
  assert.equal(a, 1); assert.equal(b, 0);
  stopA(); stopA();
  t.mock.timers.tick(1000);
  assert.equal(b, 1);
  stopB();
  assert.equal(clock.scheduled, false);
  let stop = () => {};
  stop = clock.subscribe(() => stop());
  t.mock.timers.tick(100);
  assert.equal(clock.scheduled, false);
});

test('seeded effects bound cells, duration, placement and replace-active lifecycle', () => {
  const state = new EffectState();
  const settings = normalizeTreatmentSettings({preset: 'lavender'});
  assert.equal(state.trigger('sparkles', 'bottom', 0, 42, settings), true);
  const region = {kind: 'gap' as const, top: 2, height: 2};
  const cells = effectCells(state.active!, region, 10000, 500, true);
  assert.deepEqual(cells, effectCells(state.active!, region, 10000, 500, true));
  assert.ok(cells.length <= MAX_PARTICLES);
  assert.ok(cells.every(cell => cell.column < 512 && cell.row >= 2 && cell.row < 4));
  assert.equal(state.trigger('rain', 'top', 500, 43, settings), true);
  assert.equal(state.active?.kind, 'rain');
  assert.equal(state.expire(500 + EFFECT_DURATION_MS), true);
  assert.equal(state.active, undefined);
  for (const guard of [{effectsOff: true}, {reducedMotion: true}]) {
    assert.equal(state.trigger('rain', 'top', 0, 1, {...settings, ...guard}), false);
    assert.equal(state.active, undefined);
  }
});

test('owned overlays never draw into transcript, input, focus or PTY regions; no-color and safe glyphs work', () => {
  for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
    const plan = planScreen({rows: 24, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true,
      contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition, transcriptRows: 4});
    const region = effectRegion(plan, 'bottom');
    if (!region) continue;
    assert.ok(['gap', 'separator', 'composerBorder'].includes(region.kind));
    const rows = Array(24).fill('raw output');
    const state = new EffectState();
    state.trigger('rain', 'bottom', 0, 42, normalizeTreatmentSettings({}));
    const next = applyEffect(rows, state.active!, region, 80, 500, true, 'none');
    assert.deepEqual(rows, Array(24).fill('raw output'));
    for (let i = 0; i < rows.length; i++) {
      if (i < region.top || i >= region.top + region.height) assert.equal(next[i], rows[i]);
      else { assert.ok(displayWidth(next[i]!) <= 80); assert.doesNotMatch(next[i]!, /\u001B/u); }
    }
    state.cancel(); assert.equal(state.active, undefined);
  }
});

test('effect dispatch is internal and accepts only bounded names and placements', () => {
  assert.deepEqual(parseSlashCommand('/effects rain top'), {kind: 'effects', effect: 'rain', placement: 'top'});
  assert.deepEqual(parseSlashCommand('/effects stop'), {kind: 'effects', effect: 'stop', placement: 'bottom'});
  assert.equal(parseSlashCommand('/effects bad')?.kind, 'unknown');
});

import {TerminalApp} from '../src/app/TerminalApp.js';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {TaskProgress} from '../src/status/TaskProgress.js';
import {createWelcomeSnapshot} from '../src/output/Welcome.js';

test('frontend effects restore exact base frame, bypass transcript scans and cancel at ownership boundaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-effect-test-'));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  const app = new TerminalApp();
  try {
    app['presentationStarted'] = true;
    app['fetchSuggestions'] = async () => {};
    const frames: string[][] = [];
    app['renderer'].render = frame => { frames.push([...frame.rows]); };
    app['render']();
    const base = frames.at(-1)!;
    const archive = app['output'].transcript();
    await app['runSlash']('/effects rain', parseSlashCommand('/effects rain')!);
    app['render']();
    assert.ok(app['effects'].active);
    let scans = 0;
    const wrapped = app['output'].wrapped.bind(app['output']);
    app['output'].wrapped = width => { scans++; return wrapped(width); };
    app['renderPresentation'](Date.now() + 500);
    assert.equal(scans, 0);
    assert.notDeepEqual(frames.at(-1), base);
    assert.deepEqual(app['output'].transcript(), archive);
    app['handleKey']({kind: 'escape'});
    assert.equal(app['effects'].active, undefined);
    assert.deepEqual(frames.at(-1), base);
    await app['runSlash']('/effects rain', parseSlashCommand('/effects rain')!);
    app['renderPresentation'](Date.now() + EFFECT_DURATION_MS);
    assert.deepEqual(frames.at(-1), base, 'completion restores the base projection');
    assert.equal(app['presentationSubscription'], undefined);
    await app['runSlash']('/effects sparkles', parseSlashCommand('/effects sparkles')!);
    app['onResize']();
    assert.equal(app['effects'].active, undefined);
    await app['runSlash']('/effects rain', parseSlashCommand('/effects rain')!);
    app['onShellExec']('sleep 10');
    assert.equal(app['effects'].active, undefined, 'real shell execution cancels decoration');
    app['render']();
    scans = 0;
    app['renderPresentation'](Date.now() + 700);
    assert.equal(scans, 0, 'activity frames also reuse transcript projection');
    let interrupts = 0;
    app['session'].interrupt = () => { interrupts++; };
    app['handleKey']({kind: 'interrupt'});
    assert.equal(interrupts, 1, 'Ctrl+C reaches the foreground command');
    app['running'] = undefined;
    app['output'].complete(130);
    app['promptPanelState'] = {step: 'installProgress', selectedIndex: 0, onboarding: false,
      draft: app['promptConfiguration'], task: new TaskProgress('Tool', () => {}, Date.now())};
    app['render'](); scans = 0;
    app['renderTaskPresentation']();
    assert.equal(scans, 0, 'task animation updates only the panel projection');
    app['promptPanelState'] = undefined;
    app['render']();
    await app['runSlash']('/effects rain', parseSlashCommand('/effects rain')!);
    app['passthrough'] = true;
    app['renderPresentation'](Date.now());
    assert.equal(app['effects'].active, undefined);
    assert.equal(app['presentationSubscription'], undefined);
    app['passthrough'] = false;
    app['output'].setWelcome(createWelcomeSnapshot(app['buildIdentity'], '/tmp'));
    app['render']();
    assert.ok(app['welcomeBlinkTimer'], 'late welcome reconciles clock');
    app['cancelPresentation']();
    app['render']();
    assert.ok(app['welcomeBlinkTimer'], 'ownership return resumes welcome');
    app['renderer'].render = () => { throw new Error('closed terminal'); };
    await assert.rejects(app['runSlash']('/effects rain', parseSlashCommand('/effects rain')!), /closed terminal/u);
    assert.equal(app['effects'].active, undefined);
    assert.equal(app['presentationSubscription'], undefined);
    assert.equal(app['welcomeBlinkTimer'], undefined);
    assert.equal(app['stopped'], true, 'terminal write errors release frontend resources');
  } finally {
    app['stop'](0); app['session'].kill();
    if (old === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = old;
    rmSync(root, {recursive: true, force: true});
  }
  assert.equal(presentationClock.subscriberCount, 0);
});
