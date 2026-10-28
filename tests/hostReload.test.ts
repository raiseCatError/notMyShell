import test from 'node:test';
import assert from 'node:assert/strict';
import {ghosttyReloadTarget, reloadGhostty, reloadHost} from '../src/appearance/hostReload.js';
import {reloadKitty} from '../src/appearance/kittyShaders.js';
import {appearanceAppliedMessage, appearanceGuidance} from '../src/appearance/hostAppearance.js';
import {createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {stripAnsi} from '../src/util/text.js';

const row = (pid: number, ppid: number, command: string) => ({pid, ppid, elapsedSeconds: 60, command});
// Ghostty → login → zsh → node (NMSh, pid 400).
const inGhostty = [row(100, 1, '/Applications/Ghostty.app/Contents/MacOS/ghostty'), row(200, 100, 'login -flp me /bin/zsh'), row(300, 200, '-zsh'), row(400, 300, 'node /x/bin/nmsh')];
// Inside tmux the pane's parents end at the tmux server, never the terminal.
const inTmux = [row(100, 1, '/Applications/Ghostty.app/Contents/MacOS/ghostty'), row(150, 1, 'tmux -u new'), row(300, 150, '-zsh'), row(400, 300, 'node /x/bin/nmsh')];
const ghosttyEnv = (version: string) => ({TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: version});

test('Ghostty reload: only the verified Ghostty parent, only Ghostty 1.3+, never from tmux', () => {
  assert.equal(ghosttyReloadTarget(inGhostty, 400), 100);
  assert.equal(ghosttyReloadTarget(inTmux, 400), undefined);
  assert.equal(ghosttyReloadTarget(undefined, 400), undefined);
  const sent: number[] = [];
  const deps = {rows: () => inGhostty, selfPid: 400, signal: (pid: number) => { sent.push(pid); }};
  const done = reloadGhostty(ghosttyEnv('1.3.1'), 'darwin', deps);
  assert.equal(done.reloaded, true);
  assert.deepEqual(sent, [100]);
  // Older Ghostty may not handle the signal (its default action would close the window): instruction only.
  const old = reloadGhostty(ghosttyEnv('1.2.3'), 'darwin', deps);
  assert.equal(old.reloaded, false);
  assert.match(old.message, /Reload Ghostty to load it \(⌘⇧,\): automatic reload needs Ghostty 1\.3\.0/u);
  assert.equal(reloadGhostty(ghosttyEnv('1.3.1'), 'linux', {...deps, rows: () => inTmux}).message, 'Reload Ghostty to load it (Ctrl+Shift+,): NMSh could not confirm which Ghostty it runs in.');
  // Kitty with an inherited Ghostty TERM_PROGRAM is not Ghostty.
  assert.equal(reloadGhostty({...ghosttyEnv('1.3.1'), TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1'}, 'darwin', deps).reloaded, false);
  assert.deepEqual(sent, [100], 'nothing else was signalled');
  const failing = reloadGhostty(ghosttyEnv('1.3.1'), 'darwin', {...deps, signal: () => { throw new Error('EPERM'); }});
  assert.equal(failing.reloaded, false);
});

test('under the test runner nothing is signalled unless a test injects the signal', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'the runner marks its children');
  const ghostty = reloadGhostty(ghosttyEnv('1.3.1'), 'darwin', {rows: () => inGhostty, selfPid: 400});
  assert.deepEqual(ghostty, {reloaded: false, message: 'Reload Ghostty to load it (⌘⇧,): signals are disabled here.'});
  const kittyRows = [row(100, 1, '/Applications/kitty.app/Contents/MacOS/kitty'), row(300, 100, '-zsh'), row(400, 300, 'node nmsh')];
  const kitty = reloadKitty({KITTY_PID: '100', TERM: 'xterm-kitty'}, 'darwin', {rows: () => kittyRows, selfPid: 400});
  assert.equal(kitty.reloaded, false);
  assert.match(kitty.message, /signals are disabled here/u);
  assert.equal(reloadHost('kitty', {KITTY_PID: '100', TERM: 'xterm-kitty'}, 'darwin', {rows: () => kittyRows, selfPid: 400}).reloaded, false);
});

test('appearance messages: automatic reload stated, Kitty opaque-start limit disclosed only when it applies', () => {
  const reloaded = {reloaded: true, message: 'Kitty was asked to reload its configuration.'};
  assert.match(appearanceAppliedMessage('kitty', reloaded, 1, 0.85), /quit and reopen Kitty once to see transparency/u);
  assert.equal(appearanceAppliedMessage('kitty', reloaded, 0.9, 0.85), reloaded.message, 'already transparent: changes are live');
  assert.equal(appearanceAppliedMessage('kitty', reloaded, 0.85, 1), reloaded.message);
  assert.equal(appearanceAppliedMessage('ghostty', {reloaded: true, message: 'Ghostty reloaded.'}, 1, 0.7), 'Ghostty reloaded.');
  assert.match(appearanceGuidance('ghostty', 'darwin'), /NMSh asks the Ghostty it runs in to reload/u);
  assert.doesNotMatch(appearanceGuidance('ghostty', 'darwin'), /requires quitting/u);
  assert.match(appearanceGuidance('kitty', 'darwin'), /opened fully opaque stays opaque until Kitty is restarted once/u);
});

test('the hub warns that blur needs opacity below 100%', () => {
  const hub = createAppearanceHub('Kitty', {opacity: 1, blurModeIndex: 1, blurStrength: 20, allowedBlurModes: ['Off', 'Numeric'], selectedIndex: 0});
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const text = () => stripAnsi(renderAppearanceHub(hub, config, 100, 'Theme', 'Portable', undefined, 40).join('\n'));
  assert.match(text(), /Blur shows only below 100% opacity/u);
  hub.host!.opacity = 0.85;
  assert.doesNotMatch(text(), /Blur shows only below/u);
  hub.host!.opacity = 1; hub.host!.blurModeIndex = 0;
  assert.doesNotMatch(text(), /Blur shows only below/u, 'no blur, no warning');
});
