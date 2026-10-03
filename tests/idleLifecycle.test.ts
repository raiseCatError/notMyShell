import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import type {PromptConfiguration} from '../src/prompt/configuration.js';

/**
 * Fullscreen idle lifecycle through real input: exclusive ownership (no normal
 * frame between idle frames), the initiating Enter, focus semantics, the
 * gallery round trip and subscription counts.
 */

interface Tagged { frame: TerminalFrame; idle: boolean }

function harness(patch: Partial<PromptConfiguration['idleVisuals']> = {timeout: 1}) {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: Tagged[] = [];
  let painting = false;
  const paintIdle = app['paintIdle'].bind(app);
  app['paintIdle'] = (now?: number) => { painting = true; try { paintIdle(now); } finally { painting = false; } };
  app['renderer'].render = (next: TerminalFrame) => { frames.push({frame: next, idle: painting}); };
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['startupPending'] = false;
  app['promptConfiguration'] = {...app['promptConfiguration'], idleVisuals: {...app['promptConfiguration'].idleVisuals, mode: 'aurora', ...patch}};
  return {app, frames, cleanup: () => { app['stop'](0); app['session'].kill(); isolation.restore(); }};
}

/** Everything that could paint while idle: the clock paths, task repaints, generic renders, notices and strip ticks. */
function competingOwners(app: TerminalApp): void {
  app['renderPresentation'](Date.now());
  app['renderTaskPresentation']();
  app['render']();
  app['syncPresentationClock']();
  app['tickIdle'](Date.now());
}

async function type(app: TerminalApp, text: string): Promise<void> {
  app['onInput'](text);
  for (let index = 0; index < 5; index += 1) await new Promise(resolve => setImmediate(resolve));
}

test('direct launch: /screensaver start + Enter starts idle once; only idle frames until a later real key dismisses once', async () => {
  const {app, frames, cleanup} = harness();
  try {
    app['render'](); // a normal frame is on screen and cached, as in real use
    assert.ok(app['presentationFrame']);
    app['editor'].insert('/screensaver start');
    await type(app, '\r');
    assert.ok(app['idle'], 'the initiating Enter started it and did not dismiss it');
    const start = app['idle'].startedAt;
    const from = frames.length;
    for (let tick = 0; tick < 5; tick += 1) competingOwners(app);
    const during = frames.slice(from);
    assert.ok(during.length > 0);
    assert.ok(during.every(item => item.idle), 'no normal TerminalFrame is interleaved with idle frames');
    assert.equal(app['presentationSubscription'], undefined, 'normal presentation clock is not subscribed while idle');
    assert.equal(app['idle'].startedAt, start, 'started exactly once');
    assert.equal(app['idleTimer'], undefined, 'the timeout cannot re-trigger while active');
    let dismissals = 0;
    const dismiss = app['dismissIdle'].bind(app);
    app['dismissIdle'] = (render?: boolean) => { if (app['idle']) dismissals += 1; dismiss(render); };
    await type(app, 'x');
    assert.equal(app['idle'], undefined);
    assert.equal(dismissals, 1);
    assert.equal(app['editor'].text, '', 'the waking key is not typed into the composer');
    assert.equal(frames.at(-1)!.idle, false, 'normal NMSh returns');
    assert.ok(app['idleTimer'], 'inactivity tracking restarts');
  } finally { cleanup(); }
});

test('automatic timeout: activates once, stays exclusive over ticks, wakes on real mouse activity once', async () => {
  const {app, frames, cleanup} = harness();
  try {
    app['render']();
    app['lastActivity'] = Date.now() - 10 * 60_000;
    app['onIdleTimeout']();
    assert.ok(app['idle']);
    const subscription = app['idleSubscription'];
    app['onIdleTimeout']();
    assert.equal(app['idleSubscription'], subscription, 'a second timeout does not create a second idle state');
    const from = frames.length;
    for (let tick = 0; tick < 5; tick += 1) competingOwners(app);
    assert.ok(frames.slice(from).every(item => item.idle));
    await type(app, '\u001b[<35;10;5M'); // SGR mouse motion
    assert.equal(app['idle'], undefined, 'real mouse movement dismisses');
  } finally { cleanup(); }
});

test('focus: blur neither blocks activation nor resets inactivity; blur while idle keeps it running; focus return dismisses without typing', async () => {
  const {app, cleanup} = harness();
  try {
    await type(app, '\u001b[O');
    assert.equal(app['terminalFocus'], 'blurred');
    const lastActivity = app['lastActivity'];
    await type(app, '\u001b[O');
    assert.equal(app['lastActivity'], lastActivity, 'focus loss is not activity');
    app['lastActivity'] = Date.now() - 10 * 60_000;
    app['onIdleTimeout']();
    assert.ok(app['idle'], 'an unfocused (possibly visible) terminal still starts idle visuals');
    await type(app, '\u001b[O');
    assert.ok(app['idle'] && app['idleSubscription'], 'still animating while unfocused');
    await type(app, '\u001b[I');
    assert.equal(app['idle'], undefined, 'focus return dismisses');
    assert.equal(app['editor'].text, '', 'the focus report is not inserted');
    assert.equal(app['terminalFocus'], 'focused');
  } finally { cleanup(); }
});

test('gallery: embedded preview → fullscreen → dismiss returns to the same gallery with one preview subscription again', async () => {
  const {app, frames, cleanup} = harness();
  try {
    app['editor'].insert('/screensaver');
    await type(app, '\r');
    assert.ok(app['screensaverPanel']);
    app['render']();
    assert.ok(app['screensaverAnimation'], 'the gallery preview animates');
    const gallery = app['screensaverPanel'];
    await type(app, 'p');
    assert.ok(app['idle']);
    assert.equal(app['screensaverAnimation'], undefined, 'the gallery preview is suspended while fullscreen');
    assert.equal(app['screensaverPanel'], gallery, 'the gallery state is kept underneath');
    const from = frames.length;
    competingOwners(app);
    assert.ok(frames.slice(from).every(item => item.idle));
    await type(app, 'q');
    assert.equal(app['idle'], undefined);
    assert.equal(app['screensaverPanel'], gallery, 'back to the same gallery');
    const resumed = app['screensaverAnimation'];
    assert.ok(resumed, 'the embedded preview resumes');
    app['render']();
    assert.equal(app['screensaverAnimation'], resumed, 'exactly one preview subscription');
  } finally { cleanup(); }
});

test('resources: repeated start/dismiss cycles leave one idle subscription at most and no orphan timers', async () => {
  const {app, cleanup} = harness();
  try {
    const clock = (await import('../src/motion/PresentationClock.js')).presentationClock as unknown as {subscribers?: Set<unknown>; entries?: unknown[]};
    for (let cycle = 0; cycle < 20; cycle += 1) {
      app['startIdle'](true);
      app['startIdle'](true);
      assert.ok(app['idleSubscription']);
      await type(app, 'k');
      assert.equal(app['idle'], undefined);
      assert.equal(app['idleSubscription'], undefined);
    }
    const size = clock.subscribers?.size ?? clock.entries?.length;
    if (size !== undefined) assert.ok(size <= 4, `presentation clock subscribers stay bounded (${size})`);
    // Existing wake conditions still apply.
    app['startIdle'](true);
    app['onShellData']('output\r\n');
    assert.equal(app['idle'], undefined, 'shell output wakes');
    app['startIdle'](true);
    app['onResize']();
    assert.equal(app['idle'], undefined, 'resize wakes');
  } finally { cleanup(); }
});
