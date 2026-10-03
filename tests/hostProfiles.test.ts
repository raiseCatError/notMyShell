import test from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_CAPABILITIES, resolveHostCapabilities} from '../src/host/capabilities.js';
import {resolveProbeReplies} from '../src/host/probe.js';
import {detectTerminalHost} from '../src/host/terminalHost.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {colorLevel} from '../src/presentation/capabilities.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

const profiles = ['iTerm.app', 'kitty', 'WezTerm'];

test('host profiles advertise passive capabilities; optional protocols use shared evidence', () => {
  for (const TERM_PROGRAM of profiles) {
    const env = {TERM_PROGRAM};
    const capabilities = resolveHostCapabilities(env);
    assert.equal(capabilities.kittyKeyboard, TERM_PROGRAM === 'kitty');
    assert.equal(capabilities.graphicsProtocol, TERM_PROGRAM === 'kitty' ? 'kitty' : 'iterm2');
    for (const key of ['mouseReporting', 'mouseMovement', 'clickSupport', 'hyperlinks', 'truecolor'] as const)
      assert.equal(capabilities[key], true);
    assert.equal(capabilities.textSelectionInteraction, 'shift');
    assert.equal(capabilities.synchronizedOutput, false);
    assert.equal(detectTerminalHost(env).integration, undefined);
    assert.equal(colorLevel({...env, NO_COLOR: '1'}), 'none');
    assert.equal(colorLevel({...env, NMSH_COLOR: '16'}), 'ansi16');
    const evidence = resolveProbeReplies('early\u001b[?0u\u001b[?2026;2$y', capabilities);
    assert.equal(evidence.input, 'early');
    assert.equal(evidence.capabilities.kittyKeyboard, true);
    assert.equal(evidence.capabilities.synchronizedOutput, true);
    const writes: string[] = [];
    const renderer = new TerminalRenderer(data => writes.push(data), evidence.capabilities);
    renderer.enter();
    renderer.render({rows: ['narrow'], cursorRow: 1, cursorColumn: 1, columns: 6});
    renderer.suspendForPassthrough();
    renderer.resumeAfterPassthrough();
    renderer.leave();
    const output = writes.join('');
    assert.equal(output.split('\u001b[>1u').length, output.split('\u001b[<u').length);
    for (const mode of [1000, 1003, 1006, 2026])
      assert.equal(output.split(`\u001b[?${mode}h`).length, output.split(`\u001b[?${mode}l`).length);
  }
});

test('Zed: wheel/click reporting with Shift selection, no movement tracking; colors follow COLORTERM; hyperlinks stay opt-in', () => {
  const zedEnv = {TERM_PROGRAM: 'zed', TERM: 'xterm-256color', COLORTERM: 'truecolor', ZED_TERM: 'true'};
  for (const env of [zedEnv, {ZED_TERM: 'true', TERM: 'xterm-256color'}]) {
    const capabilities = resolveHostCapabilities(env);
    assert.equal(capabilities.mouseReporting, true);
    assert.equal(capabilities.clickSupport, true);
    assert.equal(capabilities.mouseMovement, false);
    assert.equal(capabilities.textSelectionInteraction, 'shift');
    assert.equal(capabilities.hyperlinks, false, 'no OSC 8 claim without physical evidence');
    assert.equal(capabilities.kittyKeyboard, false, 'keyboard protocols come only from the probe');
    assert.equal(capabilities.synchronizedOutput, false);
    assert.equal(capabilities.appearanceIntegration, false);
    assert.equal(capabilities.hostConfiguration, false);
  }
  assert.equal(resolveHostCapabilities(zedEnv).truecolor, true);
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'zed', TERM: 'xterm-256color'}).truecolor, false);
  assert.equal(resolveHostCapabilities({...zedEnv, NMSH_HYPERLINKS: '1'}).hyperlinks, true);
  assert.deepEqual(resolveHostCapabilities({...zedEnv, TMUX: 'socket'}), {...BASELINE_CAPABILITIES, truecolor: true}, 'nested: baseline');
  const host = detectTerminalHost(zedEnv, 'darwin');
  assert.equal(host.name, 'Zed');
  assert.equal(host.newWindow, undefined, 'no documented Zed command opens a new integrated terminal');
  assert.equal(host.integration, undefined, 'NMSh never edits Zed settings');
  assert.equal(host.appearanceGuidance, 'Appearance is configured by Zed.');
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => writes.push(data), resolveHostCapabilities(zedEnv));
  renderer.enter();
  renderer.suspendForPassthrough();
  renderer.resumeAfterPassthrough();
  renderer.leave();
  const output = writes.join('');
  for (const mode of [1000, 1006]) {
    assert.ok(output.includes(`\u001b[?${mode}h`), `mode ${mode} enabled`);
    assert.equal(output.split(`\u001b[?${mode}h`).length, output.split(`\u001b[?${mode}l`).length, `mode ${mode} balanced`);
  }
  assert.ok(!output.includes('\u001b[?1003h'), 'no movement tracking');
});

test('explicit host evidence overrides stale variables; nested and dumb attachments fall back', () => {
  assert.deepEqual(resolveHostCapabilities({TERM_PROGRAM: 'unknown', KITTY_WINDOW_ID: '1', GHOSTTY_RESOURCES_DIR: '/stale'}), BASELINE_CAPABILITIES);
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'iTerm.app', KITTY_WINDOW_ID: '1'}).kittyKeyboard, false);
  assert.equal(resolveHostCapabilities({TERM: 'xterm-kitty'}).kittyKeyboard, true);
  for (const TERM_PROGRAM of profiles) {
    for (const nested of [{TMUX: 'socket'}, {STY: 'screen'}, {ZELLIJ: '1'}, {TERM: 'screen-256color'}, {TERM: 'dumb'}])
      assert.deepEqual(resolveHostCapabilities({TERM_PROGRAM, ...nested}), BASELINE_CAPABILITIES);
    assert.equal(resolveHostCapabilities({TERM_PROGRAM, NMSH_HYPERLINKS: '0'}).hyperlinks, false);
  }
});

test('reattaching across profiles updates input modes while keeping the real shell environment', async () => {
  const sandbox = new LiveSandbox({toolsSetupComplete: true, glyphStyle: 'safe'});
  try {
    let id: string | undefined;
    for (const TERM_PROGRAM of ['ghostty', 'Apple_Terminal', 'kitty', 'iTerm.app', 'WezTerm', 'zed']) {
      const app = sandbox.launch(id ? ['--attach', id] : [], {cols: 60, rows: 20}, {TERM_PROGRAM, COLORTERM: '', TMUX: '', STY: '', ZELLIJ: ''});
      await app.waitFor(/> /);
      assert.equal(app.output.includes('\u001b[>1u'), ['ghostty', 'kitty'].includes(TERM_PROGRAM));
      assert.equal(app.output.includes('\u001b[?1003h'), !['Apple_Terminal', 'zed'].includes(TERM_PROGRAM));
      assert.equal(app.output.includes('\u001b[?1006h'), TERM_PROGRAM !== 'Apple_Terminal');
      if (!id) {
        await app.run('export PROFILE_STATE=kept', /Completed/);
        await until(async () => (await sandbox.sessions()).length === 1, 15000, 'persistent session');
        id = (await sandbox.sessions())[0]!.id;
      }
      const mark = app.mark;
      app.pty.write('\u001b[200~printf "STATE-%s-HOST-%s\\n" "$PROFILE_STATE" "$TERM_PROGRAM"\u001b[201~\r');
      await app.waitFor(/STATE-kept-HOST-ghostty/, mark);
      app.pty.resize(50, 18);
      await until(async () => {
        const sizeMark = app.mark;
        await app.run('echo SIZE-$(stty size)', /SIZE-\d+ \d+/);
        await app.waitFor(/Completed/, sizeMark);
        return /SIZE-\d+ 50/u.test(app.output.slice(sizeMark));
      }, 15000, 'resize reached persistent shell');
      await app.waitFor(/Completed/, mark);
      app.pty.kill('SIGKILL');
      await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'profile detach');
    }
  } finally { await sandbox.dispose(); }
});
