import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {resolveHostCapabilities} from '../src/host/capabilities.js';
import {TerminalModeModel} from './helpers/terminalModel.js';
import {LiveSandbox} from './helpers/liveFrontend.js';

const ENABLE_ALL = '\u001b[?1049h\u001b[?1000h\u001b[?1002h\u001b[?1003h\u001b[?1005h\u001b[?1006h\u001b[?1015h\u001b[?1004h\u001b[?2004h\u001b[?1h\u001b=\u001b[?25l\u001b[>31u\u001b[>5u';

/** What a physical terminal holds when NMSh's renderer runs a passthrough cycle around `appBytes`. */
function physicalAfterPassthrough(profile: Record<string, string>, appBytes: string, leaveWhileSuspended = false) {
  const model = new TerminalModeModel();
  const renderer = new TerminalRenderer(data => { model.feed(String(data)); }, resolveHostCapabilities(profile));
  renderer.enter();
  renderer.suspendForPassthrough();
  renderer.observePassthrough(appBytes);
  model.feed(appBytes); // the foreground program's own bytes; it was killed before it could clean up
  if (leaveWhileSuspended) { renderer.leave(); return model.snapshot(); }
  renderer.resumeAfterPassthrough();
  return model.snapshot();
}

for (const profile of [{TERM_PROGRAM: 'ghostty'}, {TERM_PROGRAM: 'nmsh-test'}]) {
  test(`resuming after an app that died without cleanup restores NMSh's modes (${profile.TERM_PROGRAM})`, () => {
    const leaked = physicalAfterPassthrough(profile, ENABLE_ALL);
    const clean = physicalAfterPassthrough(profile, '');
    assert.deepEqual(leaked, clean, 'terminal state equals the state NMSh itself would have set');
    assert.equal(leaked.screen, 'alternate');
    for (const mode of [1002, 1005, 1015]) assert.equal(leaked.modes[mode], false, `?${mode}`);
    assert.equal(leaked.modes[1], false, 'application cursor keys');
    assert.equal(leaked.keypadApplication, false);
    assert.ok(leaked.kittyStack.alternate.length <= 1, `kitty stack ${leaked.kittyStack.alternate}`);
  });

  test(`an app that left the alternate screen before dying does not strand NMSh on the main screen (${profile.TERM_PROGRAM})`, () => {
    assert.equal(physicalAfterPassthrough(profile, '\u001b[?1049l').screen, 'alternate');
  });

  test(`leaving NMSh while an app still owns the terminal returns the terminal to its defaults (${profile.TERM_PROGRAM})`, () => {
    const state = physicalAfterPassthrough(profile, ENABLE_ALL, true);
    assert.equal(state.screen, 'main');
    assert.ok(Object.entries(state.modes).every(([mode, on]) => Number(mode) === 25 ? on : !on), JSON.stringify(state.modes));
    assert.equal(state.keypadApplication, false);
    assert.deepEqual(state.kittyStack.alternate, []);
  });
}

test('NMSh does not disable a mode it intentionally requires', () => {
  const state = physicalAfterPassthrough({TERM_PROGRAM: 'ghostty'}, ENABLE_ALL);
  assert.equal(state.modes[1004], true);
  assert.equal(state.modes[2004], true);
  assert.equal(state.modes[1000], true);
  assert.equal(state.modes[1006], true);
});

test('real frontend: a foreground program SIGKILLed with modes enabled leaves the physical terminal in NMSh\'s state', async () => {
  const sandbox = new LiveSandbox({}, {TERM_PROGRAM: 'ghostty'});
  try {
    const fixture = join(sandbox.home, 'leak.cjs');
    writeFileSync(fixture, `process.stdout.write(${JSON.stringify(ENABLE_ALL)} + 'LEAK-READY\\n');\nsetTimeout(() => process.kill(process.pid, 'SIGKILL'), 300);\nsetInterval(() => {}, 1000);\n`);
    const control = join(sandbox.home, 'clean.cjs');
    writeFileSync(control, `process.stdout.write('CLEAN-READY\\n');`);
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    await app.run(`node ${control}`, /CLEAN-READY/);
    const cleanEnd = app.mark;
    const cleanState = new TerminalModeModel().feed(app.output).snapshot();
    let mark = app.mark;
    await app.run(`node ${fixture}`, /LEAK-READY/);
    await app.waitFor(/❯/, app.output.indexOf('LEAK-READY', mark));
    // Precondition: the leak really was on the terminal when the program died.
    const atLeak = new TerminalModeModel().feed(app.output.slice(0, app.output.indexOf('LEAK-READY', mark))).snapshot();
    assert.equal(atLeak.modes[1002], true, 'fixture enabled ?1002');
    assert.equal(atLeak.keypadApplication, true);
    const finalState = new TerminalModeModel().feed(app.output).snapshot();
    assert.deepEqual(finalState, cleanState, `after SIGKILL the terminal state equals the clean-command state (cleanEnd=${cleanEnd})`);
    assert.equal(finalState.screen, 'alternate');
  } finally { await sandbox.dispose(); }
});

for (const leaveSuspended of [false, true]) {
  test(`Kitty child stacks on both screens preserve inherited state (suspended exit=${leaveSuspended})`, () => {
    const model = new TerminalModeModel();
    model.feed('\u001b[>9u\u001b[?1049h\u001b[>7u\u001b[?1049l');
    const renderer = new TerminalRenderer(data => model.feed(data), resolveHostCapabilities({TERM_PROGRAM: 'ghostty'}));
    renderer.enter();
    assert.deepEqual(model.snapshot().kittyStack, {main: ['9'], alternate: ['7', '1']});
    renderer.suspendForPassthrough();
    const child = '\u001b[>31u\u001b[?1049l\u001b[>5u\u001b[?1049h\u001b[>3u\u001b[?1049l';
    renderer.observePassthrough(child);
    model.feed(child); // abnormal exit on the MAIN screen
    if (!leaveSuspended) {
      renderer.resumeAfterPassthrough();
      assert.deepEqual(model.snapshot().kittyStack, {main: ['9'], alternate: ['7', '1']});
      assert.equal(model.snapshot().screen, 'alternate');
    }
    renderer.leave();
    assert.equal(model.snapshot().screen, 'main');
    assert.deepEqual(model.snapshot().kittyStack, {main: ['9'], alternate: ['7']});
  });
}
