import test from 'node:test';
import assert from 'node:assert/strict';
import {readlinkSync} from 'node:fs';
import {drive, driveSync, type Command, type CommandResult} from '../src/host/window/run.js';
import {systemFiles, windowHost, type WindowContext, type WindowFiles} from '../src/host/window/route.js';
import {TERMINAL_MAXIMIZE_SCRIPT, TERMINAL_PROBE_SCRIPT, TERMINAL_RESTORE_SCRIPT} from '../src/host/window/terminalApp.js';
import {GEOMETRY_SCRIPT, windowShape, type Screen} from '../src/host/window/geometry.js';
import {holdsPtyMaster} from '../src/host/window/hyprland.js';
import {FirstRunWindow} from '../src/host/window/firstRun.js';
import type {Probe, WindowHost} from '../src/host/window/types.js';

/**
 * One-time window maximization: every adapter runs against fake commands and a fake /proc, so nothing here touches a
 * real window. These tests prove the decisions (identity, state, the exact commands and their argv); they do not
 * prove how a real Terminal.app, kitty or Hyprland behaves. That is the physical QA checklist's job.
 */

type Reply = Partial<CommandResult> | ((command: Command) => Partial<CommandResult>);
function fakeRunner(handlers: Array<[(command: Command) => boolean, Reply]>) {
  const calls: Command[] = [];
  const answer = (command: Command): CommandResult => {
    calls.push(command);
    const handler = handlers.find(([matches]) => matches(command));
    if (!handler) throw new Error(`unexpected command: ${command.file} ${command.args.join(' ')}`);
    const reply = typeof handler[1] === 'function' ? handler[1](command) : handler[1];
    return {ok: true, code: 0, stdout: '', stderr: '', timedOut: false, ...reply};
  };
  return {calls, sync: answer, async: async (command: Command) => answer(command)};
}
const noSleep = async () => {};

function fakeFiles(files: Record<string, string> = {}, links: Record<string, string> = {}, dirs: Record<string, string[]> = {}, executables: string[] = []): WindowFiles {
  return {readText: path => files[path], readLink: path => links[path], list: path => dirs[path], executable: path => executables.includes(path), exists: path => path in files || executables.includes(path)};
}

const context = (over: Partial<WindowContext> = {}): WindowContext => ({platform: 'darwin', env: {}, pid: 4242, interactive: true, files: fakeFiles(), resolve: () => undefined, ...over});

async function probe(ctx: WindowContext, runner: ReturnType<typeof fakeRunner>): Promise<Probe> {
  const host = windowHost(ctx);
  if (!('probe' in host)) return host;
  return drive(host.probe(), runner.async, noSleep);
}

const SCREENS: Screen[] = [{frame: {x: 0, y: 0, width: 1920, height: 1080}, visible: {x: 0, y: 30, width: 1920, height: 1050}}];
const geometryReply = (window?: {pid: number; bounds: {x: number; y: number; width: number; height: number}; layer?: number}) =>
  ({stdout: JSON.stringify({screens: SCREENS, ...(window ? {window: {layer: 0, onscreen: true, ...window}} : {})})});
const isGeometry = (command: Command) => command.file === '/usr/bin/osascript' && command.args.includes(GEOMETRY_SCRIPT);
const isScript = (lines: readonly string[]) => (command: Command) => command.file === '/usr/bin/osascript' && lines.every(line => command.args.includes(line));
const isPs = (command: Command) => command.file === '/bin/ps';
const scriptArgv = (command: Command, lines: readonly string[]) => command.args.slice(lines.length * 2);

// ---------------------------------------------------------------------------------------------------------------
// Routing: which host may even be asked. A host name or a compositor variable alone never proves ownership.

test('nothing is probed outside a real terminal, over SSH, in a multiplexer or in an editor\'s terminal', async () => {
  const cases: Array<[string, Partial<WindowContext>]> = [
    ['not a terminal', {interactive: false, env: {TERM_PROGRAM: 'Apple_Terminal'}}],
    ['ssh', {env: {TERM_PROGRAM: 'Apple_Terminal', SSH_CONNECTION: '10.0.0.2 52000 10.0.0.1 22'}}],
    ['ssh tty', {env: {KITTY_WINDOW_ID: '3', KITTY_LISTEN_ON: 'unix:/tmp/k', SSH_TTY: '/dev/ttys002'}}],
    ['tmux', {env: {TERM_PROGRAM: 'Apple_Terminal', TMUX: '/tmp/tmux-501/default,1,0'}}],
    ['screen', {env: {TERM_PROGRAM: 'Apple_Terminal', STY: '123.pts-0'}}],
    ['screen term', {env: {TERM_PROGRAM: 'Apple_Terminal', TERM: 'screen-256color'}}],
    ['zellij', {platform: 'linux', env: {HYPRLAND_INSTANCE_SIGNATURE: 'abc', WAYLAND_DISPLAY: 'wayland-1', ZELLIJ: '0'}}],
    ['vscode', {env: {TERM_PROGRAM: 'vscode'}}],
    ['zed', {env: {ZED_TERM: 'true', TERM_PROGRAM: 'zed'}}],
    ['jetbrains', {env: {TERMINAL_EMULATOR: 'JetBrains-JediTerm'}}],
    ['emacs', {env: {INSIDE_EMACS: '29.1,vterm'}}],
    ['neovim', {platform: 'linux', env: {NVIM: '/run/user/1000/nvim.1.0', HYPRLAND_INSTANCE_SIGNATURE: 'abc', WAYLAND_DISPLAY: 'wayland-1'}}],
    ['ghostty macOS', {env: {TERM_PROGRAM: 'ghostty', GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app/Contents/Resources/ghostty'}}],
    ['iTerm2', {env: {TERM_PROGRAM: 'iTerm.app'}}],
    ['kitty without a socket', {env: {KITTY_WINDOW_ID: '3', KITTY_PID: '777'}}],
    ['kitty fd socket', {env: {KITTY_WINDOW_ID: '3', KITTY_PID: '777', KITTY_LISTEN_ON: 'fd:3'}}],
    ['kitty tcp socket', {env: {KITTY_WINDOW_ID: '3', KITTY_PID: '777', KITTY_LISTEN_ON: 'tcp:localhost:12345'}}],
    ['GNOME Wayland', {platform: 'linux', env: {WAYLAND_DISPLAY: 'wayland-0', XDG_CURRENT_DESKTOP: 'GNOME'}}],
    ['KDE Wayland', {platform: 'linux', env: {WAYLAND_DISPLAY: 'wayland-0', XDG_CURRENT_DESKTOP: 'KDE', KITTY_WINDOW_ID: '1', KITTY_LISTEN_ON: 'unix:@k'}}],
    ['X11', {platform: 'linux', env: {DISPLAY: ':0', KITTY_WINDOW_ID: '1', KITTY_LISTEN_ON: 'unix:@k', WINDOWID: '1234'}}],
    ['WSL', {platform: 'linux', env: {WSL_DISTRO_NAME: 'Ubuntu', WT_SESSION: 'x', WAYLAND_DISPLAY: 'wayland-0'}}],
    ['Windows', {platform: 'win32', env: {WT_SESSION: 'x'}}],
    ['Hyprland variable without its socket', {platform: 'linux', env: {HYPRLAND_INSTANCE_SIGNATURE: 'abc_1', XDG_RUNTIME_DIR: '/run/user/1000', WAYLAND_DISPLAY: 'wayland-1'},
      resolve: () => '/usr/bin/hyprctl'}],
  ];
  for (const [name, over] of cases) {
    const runner = fakeRunner([]);
    const result = await probe(context(over), runner);
    assert.equal(result.outcome, 'unsupported', name);
    assert.ok('reason' in result && result.reason.length > 10, `${name}: says why`);
    assert.equal(runner.calls.length, 0, `${name}: no command ran`);
  }
});

test('window shapes: fullscreen is the screen\'s frame, maximized fills its visible frame, on whichever display holds the window', () => {
  assert.equal(windowShape({x: 0, y: 0, width: 1920, height: 1080}, SCREENS), 'fullscreen');
  assert.equal(windowShape({x: 0, y: 30, width: 1920, height: 1050}, SCREENS), 'maximized');
  assert.equal(windowShape({x: 0, y: 30, width: 1914, height: 1036}, SCREENS), 'maximized', 'a zoom rounded to whole cells still fills it');
  assert.equal(windowShape({x: 120, y: 90, width: 900, height: 600}, SCREENS), 'normal');
  const two: Screen[] = [...SCREENS, {frame: {x: 1920, y: -200, width: 2560, height: 1440}, visible: {x: 1920, y: -200, width: 2560, height: 1370}}];
  assert.equal(windowShape({x: 1920, y: -200, width: 2560, height: 1370}, two), 'maximized', 'the second display, Dock at its bottom');
  assert.equal(windowShape({x: 1920, y: -200, width: 2560, height: 1440}, two), 'fullscreen');
  assert.equal(windowShape({x: 2000, y: 0, width: 1200, height: 800}, two), 'normal');
});

// ---------------------------------------------------------------------------------------------------------------
// macOS Terminal.app: AppleScript on the one window whose tab is this frontend's tty; zoomed and bounds read first.

const TERMINAL = context({env: {TERM_PROGRAM: 'Apple_Terminal', TERM_PROGRAM_VERSION: '455'}});
const PS_TABLE = ['    1     0 ??       /sbin/launchd', '  777     1 ??       /Applications/kitty.app/Contents/MacOS/kitty', ' 3999     1 ??       /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
  ' 4000  3999 ttys004  -zsh', ' 4242  4000 ttys004  /opt/homebrew/bin/node', ' 5000   777 ttys009  -zsh', ' 6000  5000 ttys009  /opt/homebrew/bin/node'].join('\n');
const terminalRunner = (probeLine: string, extra: Array<[(command: Command) => boolean, Reply]> = []) => fakeRunner([
  [isPs, {stdout: PS_TABLE}], [isScript(TERMINAL_PROBE_SCRIPT), {stdout: `${probeLine}\n`}], [isGeometry, geometryReply()], ...extra]);

test('Terminal.app: the window whose tab is this tty, its state read first; a normal window is offered', async () => {
  const runner = terminalRunner('ok 1234 false false 100 80 1000 680');
  const result = await probe(TERMINAL, runner);
  assert.equal(result.outcome, 'available');
  const asked = runner.calls.find(isScript(TERMINAL_PROBE_SCRIPT))!;
  assert.deepEqual(scriptArgv(asked, TERMINAL_PROBE_SCRIPT), ['/dev/ttys004'], 'the tty is an argument, never script text');
  assert.ok(TERMINAL_PROBE_SCRIPT.every(line => !line.includes('ttys')), 'the script is fixed');
  assert.ok(runner.calls.every(command => command.file.startsWith('/') && command.timeoutMs > 0 && command.timeoutMs <= 5000), 'absolute, bounded commands');
});

test('Terminal.app: already zoomed, fullscreen, filling the screen, unidentified or refused is left alone', async () => {
  const cases: Array<[string, string, Probe['outcome']]> = [
    ['zoomed', 'ok 1234 true false 0 30 1920 1080', 'alreadyMaximized'],
    ['native fullscreen', 'ok 1234 false false 0 0 1920 1080', 'fullscreen'],
    ['filling the visible frame', 'ok 1234 false false 0 30 1920 1080', 'alreadyMaximized'],
    ['no tab with this tty', 'none', 'uncertainIdentity'],
    ['several windows', 'many', 'uncertainIdentity'],
    ['not running', 'notrunning', 'uncertainIdentity'],
    ['minimized', 'ok 1234 false true 100 80 1000 680', 'uncertainIdentity'],
    ['nonsense', 'ok 1234 maybe', 'failed'],
  ];
  for (const [name, line, outcome] of cases) assert.equal((await probe(TERMINAL, terminalRunner(line))).outcome, outcome, name);
  const denied = fakeRunner([[isPs, {stdout: PS_TABLE}], [isScript(TERMINAL_PROBE_SCRIPT), {ok: false, code: 1, stderr: 'execution error: Not authorized to send Apple events to Terminal. (-1743)'}]]);
  assert.equal((await probe(TERMINAL, denied)).outcome, 'permissionDenied');
  const slow = fakeRunner([[isPs, {stdout: PS_TABLE}], [isScript(TERMINAL_PROBE_SCRIPT), {ok: false, code: null, timedOut: true}]]);
  assert.equal((await probe(TERMINAL, slow)).outcome, 'failed');
  const noTty = fakeRunner([[isPs, {stdout: PS_TABLE.replace(' 4242  4000 ttys004', ' 4242  4000 ??     ')}]]);
  assert.equal((await probe(TERMINAL, noTty)).outcome, 'uncertainIdentity');
  assert.equal(noTty.calls.length, 1, 'without its own tty NMSh asks Terminal nothing');
});

test('Terminal.app: maximize zooms only the verified window; restore only if it is still exactly as NMSh left it', async () => {
  const runner = terminalRunner('ok 1234 false false 100 80 1000 680', [
    [isScript(TERMINAL_MAXIMIZE_SCRIPT), {stdout: 'ok true 0 30 1920 1080\n'}],
    [isScript(TERMINAL_RESTORE_SCRIPT), {stdout: 'ok\n'}]]);
  const found = await probe(TERMINAL, runner);
  assert.equal(found.outcome, 'available');
  if (found.outcome !== 'available') return;
  const maximized = await drive(found.window.maximize(), runner.async, noSleep);
  assert.equal(maximized.outcome, 'maximized');
  const zoom = runner.calls.find(isScript(TERMINAL_MAXIMIZE_SCRIPT))!;
  assert.deepEqual(scriptArgv(zoom, TERMINAL_MAXIMIZE_SCRIPT), ['/dev/ttys004', '1234', '100', '80', '1000', '680'], 'the window id and the bounds it was seen at');
  if (maximized.outcome !== 'maximized') return;
  const restored = await drive(maximized.restore(), runner.async, noSleep);
  assert.equal(restored.outcome, 'restored');
  const back = runner.calls.find(isScript(TERMINAL_RESTORE_SCRIPT))!;
  assert.deepEqual(scriptArgv(back, TERMINAL_RESTORE_SCRIPT), ['/dev/ttys004', '1234', '0', '30', '1920', '1080', '100', '80', '1000', '680'],
    'checked against the bounds NMSh left, then put back to the original');
  assert.ok(TERMINAL_MAXIMIZE_SCRIPT.some(line => /set zoomed of w to true/u.test(line)) && TERMINAL_MAXIMIZE_SCRIPT.some(line => /if zoomed of w then return/u.test(line)),
    'it zooms, never toggles, and only from unzoomed');
  // The exit path: the same restore, synchronously.
  assert.equal(driveSync(maximized.restore(), runner.sync, () => {}).outcome, 'restored');
});

test('Terminal.app: a window the user changed is never zoomed or restored over them', async () => {
  for (const [line, outcome] of [['moved', 'unchanged'], ['zoomed', 'unchanged'], ['notours', 'unchanged'], ['gone', 'unchanged'], ['ok false 100 80 1000 680', 'unchanged'], ['ok true 100 80 1000 680', 'unchanged']] as const) {
    const runner = terminalRunner('ok 1234 false false 100 80 1000 680', [[isScript(TERMINAL_MAXIMIZE_SCRIPT), {stdout: `${line}\n`}]]);
    const found = await probe(TERMINAL, runner);
    if (found.outcome !== 'available') { assert.fail('available'); return; }
    assert.equal((await drive(found.window.maximize(), runner.async, noSleep)).outcome, outcome, line);
  }
  for (const line of ['moved', 'unzoomed', 'gone', 'notours']) {
    const runner = terminalRunner('ok 1234 false false 100 80 1000 680', [[isScript(TERMINAL_MAXIMIZE_SCRIPT), {stdout: 'ok true 0 30 1920 1080'}], [isScript(TERMINAL_RESTORE_SCRIPT), {stdout: line}]]);
    const found = await probe(TERMINAL, runner);
    if (found.outcome !== 'available') { assert.fail('available'); return; }
    const maximized = await drive(found.window.maximize(), runner.async, noSleep);
    if (maximized.outcome !== 'maximized') { assert.fail('maximized'); return; }
    assert.equal((await drive(maximized.restore(), runner.async, noSleep)).outcome, 'left', line);
  }
  assert.ok(TERMINAL_RESTORE_SCRIPT.some(line => /if \(bounds of w\) is not leftAs then return "moved"/u.test(line)), 'restore compares with what NMSh left');
});

// ---------------------------------------------------------------------------------------------------------------
// macOS kitty: remote control over KITTY_LISTEN_ON only; the OS window of KITTY_WINDOW_ID, owned by this tty.

const KITTY_ENV = {KITTY_WINDOW_ID: '3', KITTY_PID: '777', KITTY_LISTEN_ON: 'unix:/tmp/kitty-777', TERM: 'xterm-kitty'};
const KITTEN = '/Applications/kitty.app/Contents/MacOS/kitten';
const KITTY = context({pid: 6000, env: KITTY_ENV, files: fakeFiles({}, {}, {}, [KITTEN])});
const isKitten = (action: string) => (command: Command) => command.file === KITTEN && command.args.includes(action);
const LS = JSON.stringify([{id: 1, platform_window_id: 5555, is_focused: true, tabs: [{id: 1, windows: [{id: 3, pid: 5000, is_self: true}]}]}]);
const kittyRunner = (extra: Array<[(command: Command) => boolean, Reply]> = [], bounds = {x: 200, y: 100, width: 800, height: 600}) => fakeRunner([
  [isPs, {stdout: PS_TABLE}], [isKitten('ls'), {stdout: LS}], [isGeometry, geometryReply({pid: 777, bounds})], ...extra]);

test('kitty: its own OS window, proven by this tty, read over its listen socket and CoreGraphics; never the in-band TTY', async () => {
  const runner = kittyRunner();
  const result = await probe(KITTY, runner);
  assert.equal(result.outcome, 'available');
  const ls = runner.calls.find(isKitten('ls'))!;
  assert.deepEqual(ls.args, ['@', '--to', 'unix:/tmp/kitty-777', '--use-password', 'never', 'ls', '--match', 'id:3'], 'the socket, explicitly; no password prompt');
  const geometry = runner.calls.find(isGeometry)!;
  assert.equal(geometry.args.at(-1), '5555', 'the OS window kitty reported');
});

test('kitty: an inherited KITTY_* in another terminal, a foreign window or refused remote control is not offered', async () => {
  const otherTty = context({pid: 4242, env: KITTY_ENV, files: fakeFiles({}, {}, {}, [KITTEN])});
  assert.equal((await probe(otherTty, kittyRunner())).outcome, 'uncertainIdentity', 'this frontend\'s tty is not the kitty window\'s');
  assert.equal((await probe(KITTY, fakeRunner([[isPs, {stdout: PS_TABLE}], [isKitten('ls'), {stdout: '[]'}]]))).outcome, 'uncertainIdentity');
  const foreign = fakeRunner([[isPs, {stdout: PS_TABLE}], [isKitten('ls'), {stdout: LS}], [isGeometry, geometryReply({pid: 99, bounds: {x: 1, y: 1, width: 500, height: 400}})]]);
  assert.equal((await probe(KITTY, foreign)).outcome, 'uncertainIdentity', 'the window number belongs to another process');
  const disabled = fakeRunner([[isPs, {stdout: PS_TABLE}], [isKitten('ls'), {ok: false, code: 1, stderr: 'Error: Remote control is disabled. Add allow_remote_control to your kitty.conf'}]]);
  assert.equal((await probe(KITTY, disabled)).outcome, 'permissionDenied');
  assert.equal((await probe(KITTY, kittyRunner([], {x: 0, y: 30, width: 1920, height: 1050}))).outcome, 'alreadyMaximized');
  assert.equal((await probe(KITTY, kittyRunner([], {x: 0, y: 0, width: 1920, height: 1080}))).outcome, 'fullscreen');
  // A terminal started from a shell in kitty inherits KITTY_*: kitty is still an ancestor, but its window shows another tty.
  const launched = PS_TABLE.replace(' 6000  5000 ttys009  /opt/homebrew/bin/node', ' 5500  5000 ??       /Applications/Alacritty.app/Contents/MacOS/alacritty\n 5600  5500 ttys011  -zsh\n 6000  5600 ttys011  /opt/homebrew/bin/node');
  const inherited = fakeRunner([[isPs, {stdout: launched}], [isKitten('ls'), {stdout: LS}], [isGeometry, geometryReply({pid: 777, bounds: {x: 200, y: 100, width: 800, height: 600}})]]);
  assert.equal((await probe(KITTY, inherited)).outcome, 'uncertainIdentity', 'kitty is an ancestor, but its window shows another tty');
  const noKitten = context({pid: 6000, env: KITTY_ENV});
  assert.equal((await probe(noKitten, fakeRunner([[isPs, {stdout: PS_TABLE}]]))).outcome, 'unsupported', 'no kitten beside kitty');
});

test('kitty: toggles only from a verified unmaximized state, and toggles back only from exactly what NMSh left', async () => {
  let shape = {x: 200, y: 100, width: 800, height: 600};
  const runner = fakeRunner([[isPs, {stdout: PS_TABLE}], [isKitten('ls'), {stdout: LS}], [isGeometry, () => geometryReply({pid: 777, bounds: shape})],
    [isKitten('resize-os-window'), () => { shape = shape.width === 800 ? {x: 0, y: 30, width: 1920, height: 1050} : {x: 200, y: 100, width: 800, height: 600}; return {stdout: ''}; }]]);
  const found = await probe(KITTY, runner);
  if (found.outcome !== 'available') { assert.fail(found.outcome); return; }
  const maximized = await drive(found.window.maximize(), runner.async, noSleep);
  assert.equal(maximized.outcome, 'maximized');
  const toggle = runner.calls.find(isKitten('resize-os-window'))!;
  assert.deepEqual(toggle.args, ['@', '--to', 'unix:/tmp/kitty-777', '--use-password', 'never', 'resize-os-window', '--match', 'id:3', '--action=toggle-maximized']);
  if (maximized.outcome !== 'maximized') return;
  assert.equal((await drive(maximized.restore(), runner.async, noSleep)).outcome, 'restored');
  assert.equal(runner.calls.filter(isKitten('resize-os-window')).length, 2);
  // Moved before the toggle: no toggle at all.
  shape = {x: 200, y: 100, width: 800, height: 600};
  const moved = fakeRunner([[isPs, {stdout: PS_TABLE}], [isKitten('ls'), {stdout: LS}], [isGeometry, () => geometryReply({pid: 777, bounds: shape})]]);
  const again = await probe(KITTY, moved);
  if (again.outcome !== 'available') { assert.fail(again.outcome); return; }
  shape = {x: 260, y: 140, width: 800, height: 600};
  assert.equal((await drive(again.window.maximize(), moved.async, noSleep)).outcome, 'unchanged');
  assert.equal(moved.calls.filter(isKitten('resize-os-window')).length, 0, 'never a toggle without the state it was seen in');
  // Changed by the user after NMSh maximized it: left alone.
  shape = {x: 200, y: 100, width: 800, height: 600};
  const later = fakeRunner([[isPs, {stdout: PS_TABLE}], [isKitten('ls'), {stdout: LS}], [isGeometry, () => geometryReply({pid: 777, bounds: shape})],
    [isKitten('resize-os-window'), () => { shape = {x: 0, y: 30, width: 1920, height: 1050}; return {}; }]]);
  const third = await probe(KITTY, later);
  if (third.outcome !== 'available') { assert.fail(third.outcome); return; }
  const done = await drive(third.window.maximize(), later.async, noSleep);
  if (done.outcome !== 'maximized') { assert.fail(done.outcome); return; }
  shape = {x: 300, y: 200, width: 900, height: 700};
  assert.equal((await drive(done.restore(), later.async, noSleep)).outcome, 'left');
  assert.equal(later.calls.filter(isKitten('resize-os-window')).length, 1, 'no toggle over the user\'s change');
});

// ---------------------------------------------------------------------------------------------------------------
// Hyprland (Omarchy and others): Lua IPC on 0.55+, the one client that owns this frontend's terminal, set/unset only.

const HYPR_ENV = {HYPRLAND_INSTANCE_SIGNATURE: 'abc_1700000000_123', XDG_RUNTIME_DIR: '/run/user/1000', WAYLAND_DISPLAY: 'wayland-1', TERM: 'foot'};
const SOCKET = '/run/user/1000/hypr/abc_1700000000_123/.socket.sock';
const HYPRCTL = '/usr/bin/hyprctl';
function procTree(chain: Array<[number, number]>, extraFiles: Record<string, string> = {}, extraLinks: Record<string, string> = {}, dirs: Record<string, string[]> = {}): WindowFiles {
  const files: Record<string, string> = {[SOCKET]: '', ...extraFiles};
  for (const [pid, ppid] of chain) files[`/proc/${pid}/status`] = `Name:\tx\nPid:\t${pid}\nPPid:\t${ppid}\n`;
  return fakeFiles(files, {'/proc/4242/fd/0': '/dev/pts/7', ...extraLinks}, dirs);
}
const HYPR = (files = procTree([[4242, 4000], [4000, 3000], [3000, 1]])) => context({platform: 'linux', env: HYPR_ENV, files, resolve: name => name === 'hyprctl' ? HYPRCTL : undefined});
const client = (over: Record<string, unknown> = {}) => ({address: '0x55d0a1b2', mapped: true, hidden: false, at: [10, 40], size: [900, 600], workspace: {id: 1, name: '1'},
  floating: false, monitor: 0, class: 'foot', pid: 3000, fullscreen: 0, fullscreenClient: 0, ...over});
const isHypr = (first: string) => (command: Command) => command.file === HYPRCTL && command.args.join(' ').startsWith(first);
const hyprRunner = (clients: unknown[], extra: Array<[(command: Command) => boolean, Reply]> = [], version = '0.56.2', evalReply = 'ok') => fakeRunner([
  [isHypr('-j version'), {stdout: JSON.stringify({version, tag: `v${version}`, branch: 'main'})}], [isHypr('eval'), {stdout: evalReply}],
  ...extra, [isHypr('-j clients'), {stdout: JSON.stringify(clients)}]]);

test('Hyprland: the one client owning this terminal, found by process ancestry, its maximized state read first', async () => {
  const runner = hyprRunner([client(), client({address: '0x55d0a1c3', pid: 9999, class: 'firefox'})]);
  const result = await probe(HYPR(), runner);
  assert.equal(result.outcome, 'available');
  assert.deepEqual(runner.calls.map(command => command.args.join(' ')), ['-j version', 'eval return true', '-j clients']);
  assert.ok(runner.calls.every(command => !/focus/u.test(command.args.join(' '))), 'nothing moves focus');
});

test('Hyprland: older or hyprlang-configured compositors, several windows, no window or one already maximized are refused', async () => {
  const cases: Array<[string, ReturnType<typeof hyprRunner>, Probe['outcome']]> = [
    ['0.51 has only a toggle', hyprRunner([client()], [], '0.51.1'), 'unsupported'],
    ['0.54 acts on the focused window only', hyprRunner([client()], [], '0.54.3'), 'unsupported'],
    ['0.56 with a hyprlang config', hyprRunner([client()], [], '0.56.2', 'eval is only supported with the lua config manager'), 'unsupported'],
    ['two windows of one terminal process', hyprRunner([client(), client({address: '0x55d0a1d4'})]), 'uncertainIdentity'],
    ['no window of an ancestor', hyprRunner([client({pid: 9999})]), 'uncertainIdentity'],
    ['unmapped', hyprRunner([client({mapped: false})]), 'uncertainIdentity'],
    ['hidden', hyprRunner([client({hidden: true})]), 'uncertainIdentity'],
    ['already maximized', hyprRunner([client({fullscreen: 1})]), 'alreadyMaximized'],
    ['fullscreen', hyprRunner([client({fullscreen: 2})]), 'fullscreen'],
    ['maximized and fullscreen', hyprRunner([client({fullscreen: 3})]), 'fullscreen'],
    ['an address that is not an address', hyprRunner([client({address: '0x55") hl.exec_cmd("x'})]), 'uncertainIdentity'],
  ];
  for (const [name, runner, outcome] of cases) assert.equal((await probe(HYPR(), runner)).outcome, outcome, name);
  const noIpc = fakeRunner([[isHypr('-j version'), {ok: false, code: 1, stderr: 'Couldn\'t connect to /run/user/1000/hypr/x/.socket.sock'}]]);
  assert.equal((await probe(HYPR(), noIpc)).outcome, 'unsupported', 'no IPC, no session');
  const noHyprctl = context({platform: 'linux', env: HYPR_ENV, files: procTree([[4242, 4000]])});
  assert.equal((await probe(noHyprctl, fakeRunner([]))).outcome, 'unsupported');
});

test('Hyprland: nested terminals resolve to the nearest owner; a terminal that does not hold this pty is not ours', async () => {
  // NMSh in foot (3000), started from a shell in kitty (2000): both are windows, foot is this frontend's.
  const nested = procTree([[4242, 4000], [4000, 3000], [3000, 2500], [2500, 2000], [2000, 1]]);
  const both = hyprRunner([client({address: '0x55d0a2a1', pid: 2000, class: 'kitty'}), client()]);
  const found = await probe(HYPR(nested), both);
  assert.equal(found.outcome, 'available');
  // The candidate holds pty masters, but not this frontend's (/dev/pts/7): ownership is not proven.
  const elsewhere = procTree([[4242, 4000], [4000, 3000], [3000, 1]], {'/proc/3000/fdinfo/5': 'pos:\t0\nflags:\t02\ntty-index:\t9\n'}, {'/proc/3000/fd/5': '/dev/ptmx'}, {'/proc/3000/fd': ['0', '1', '5']});
  assert.equal((await probe(HYPR(elsewhere), hyprRunner([client()]))).outcome, 'uncertainIdentity');
  const holds = procTree([[4242, 4000], [4000, 3000], [3000, 1]], {'/proc/3000/fdinfo/5': 'pos:\t0\nflags:\t02\ntty-index:\t7\n'}, {'/proc/3000/fd/5': '/dev/pts/ptmx'}, {'/proc/3000/fd': ['0', '1', '5']});
  assert.equal((await probe(HYPR(holds), hyprRunner([client()]))).outcome, 'available');
});

test('Hyprland: maximize and restore name the exact window with set and unset, and leave anything the user changed', async () => {
  let current = client();
  const dispatched: string[] = [];
  const runner = fakeRunner([[isHypr('-j version'), {stdout: JSON.stringify({version: '0.56.2'})}], [isHypr('eval'), {stdout: 'ok'}],
    [isHypr('-j clients'), () => ({stdout: JSON.stringify([current])})],
    [isHypr('dispatch'), command => {
      const lua = command.args[1]!;
      dispatched.push(lua);
      current = /action = "set"/u.test(lua) ? client({fullscreen: 1, at: [0, 30], size: [1920, 1050]}) : client();
      return {stdout: 'ok'};
    }]]);
  const found = await probe(HYPR(), runner);
  if (found.outcome !== 'available') { assert.fail(found.outcome); return; }
  const maximized = await drive(found.window.maximize(), runner.async, noSleep);
  assert.equal(maximized.outcome, 'maximized');
  assert.deepEqual(dispatched, ['hl.dsp.window.fullscreen({ window = "address:0x55d0a1b2", action = "set", mode = "maximized" })']);
  if (maximized.outcome !== 'maximized') return;
  assert.equal((await drive(maximized.restore(), runner.async, noSleep)).outcome, 'restored');
  assert.equal(dispatched[1], 'hl.dsp.window.fullscreen({ window = "address:0x55d0a1b2", action = "unset", mode = "maximized" })');
  assert.ok(runner.calls.every(command => command.args.length <= 2 && !/focus/u.test(command.args.join(' '))), 'argv only; no focus moves');
  // The user un-maximized, fullscreened or moved it, or it closed: no dispatch.
  for (const [name, after] of [['unmaximized', [client()]], ['fullscreened', [client({fullscreen: 2, at: [0, 0], size: [1920, 1080]})]],
    ['moved to another monitor', [client({fullscreen: 1, at: [1920, 30], size: [2560, 1410], monitor: 1})]], ['closed', []]] as const) {
    current = client();
    const again = await probe(HYPR(), runner);
    if (again.outcome !== 'available') { assert.fail(again.outcome); return; }
    const done = await drive(again.window.maximize(), runner.async, noSleep);
    if (done.outcome !== 'maximized') { assert.fail(done.outcome); return; }
    const before = dispatched.length;
    const leftRunner = fakeRunner([[isHypr('-j clients'), {stdout: JSON.stringify(after)}], [isHypr('dispatch'), () => { dispatched.push('unexpected'); return {stdout: 'ok'}; }]]);
    assert.equal((await drive(done.restore(), leftRunner.async, noSleep)).outcome, 'left', name);
    assert.equal(dispatched.length, before, `${name}: nothing dispatched`);
  }
  // A dispatch the compositor refused changes nothing and leaves nothing to restore.
  const refused = fakeRunner([[isHypr('-j version'), {stdout: JSON.stringify({version: '0.56.2'})}], [isHypr('eval'), {stdout: 'ok'}],
    [isHypr('-j clients'), {stdout: JSON.stringify([client()])}], [isHypr('dispatch'), {stdout: 'hl.window.fullscreen: no target'}]]);
  const last = await probe(HYPR(), refused);
  if (last.outcome !== 'available') { assert.fail(last.outcome); return; }
  assert.equal((await drive(last.window.maximize(), refused.async, noSleep)).outcome, 'failed');
});

test('Linux: a real pty master is found through /proc; the process on the other side is not its holder', {skip: process.platform !== 'linux'}, async () => {
  const nodePty = (await import('node-pty')).default;
  const child = nodePty.spawn('/bin/sh', ['-c', 'sleep 5'], {cols: 80, rows: 24});
  try {
    let tty = '';
    for (let i = 0; i < 50 && !tty; i++) {
      try { tty = readlinkSync(`/proc/${child.pid}/fd/0`); } catch { /* not yet */ }
      if (!tty) await new Promise(resolve => setTimeout(resolve, 20));
    }
    const index = Number(/^\/dev\/pts\/(\d+)$/u.exec(tty)?.[1]);
    assert.ok(Number.isInteger(index), `the child's tty: ${tty}`);
    assert.equal(holdsPtyMaster(systemFiles, process.pid, index), true, 'this process holds the master');
    assert.notEqual(holdsPtyMaster(systemFiles, child.pid, index), true, 'the child only has the slave');
  } finally { child.kill(); }
});

// ---------------------------------------------------------------------------------------------------------------
// The first-run session: probe once, offer only when available, maximize only on consent, restore once.

function fakeHost(probeResult: Probe, log: string[]): WindowHost {
  return {name: 'Fake', *probe() { log.push('probe'); return probeResult; }};
}
function availableProbe(log: string[], restoreOutcome: 'restored' | 'left' = 'restored'): Probe {
  return {outcome: 'available', window: {host: 'Fake', *maximize() {
    log.push('maximize');
    return {outcome: 'maximized' as const, *restore() { log.push('restore'); return restoreOutcome === 'restored' ? {outcome: 'restored' as const} : {outcome: 'left' as const, reason: 'moved'}; }};
  }}};
}

test('first run: one probe, an offer only when available, maximize only on consent, one restore', async () => {
  const log: string[] = [];
  const session = new FirstRunWindow(() => fakeHost(availableProbe(log), log), {run: fakeRunner([]).async, runSync: fakeRunner([]).sync, sleep: noSleep});
  assert.equal(await session.probe(), true);
  assert.equal(await session.probe(), true, 'probed once');
  assert.deepEqual(log, ['probe']);
  assert.equal(await session.accept(), 'maximized');
  assert.equal(await session.accept(), undefined, 'one maximize');
  assert.equal((await session.restore())?.outcome, 'restored');
  assert.equal(await session.restore(), undefined, 'one restore');
  assert.deepEqual(log, ['probe', 'maximize', 'restore']);
});

test('first run: declined, unavailable or exiting', async () => {
  const log: string[] = [];
  const declined = new FirstRunWindow(() => fakeHost(availableProbe(log), log), {sleep: noSleep});
  await declined.probe();
  declined.decline();
  assert.equal(await declined.accept(), undefined, 'a declined offer cannot maximize');
  assert.equal(await declined.restore(), undefined);
  assert.deepEqual(log, ['probe']);
  const refused = new FirstRunWindow(() => ({outcome: 'unsupported', reason: 'Ghostty on macOS has no maximize NMSh can ask for'}), {sleep: noSleep});
  assert.equal(await refused.probe(), false);
  assert.equal(refused.refusal?.outcome, 'unsupported');
  assert.equal(await refused.accept(), undefined);
  // Exit while maximized: the restore runs synchronously.
  const exitLog: string[] = [];
  const exiting = new FirstRunWindow(() => fakeHost(availableProbe(exitLog), exitLog), {sleep: noSleep, runSync: fakeRunner([]).sync, sleepSync: () => {}});
  await exiting.probe();
  await exiting.accept();
  assert.equal(exiting.restoreNow()?.outcome, 'restored');
  assert.equal(exiting.restoreNow(), undefined);
  assert.deepEqual(exitLog, ['probe', 'maximize', 'restore']);
  // A restore asked for while the maximize is still running waits for it.
  const orderLog: string[] = [];
  const ordered = new FirstRunWindow(() => fakeHost(availableProbe(orderLog), orderLog), {sleep: noSleep});
  await ordered.probe();
  const accepting = ordered.accept();
  const restoring = ordered.restore();
  await Promise.all([accepting, restoring]);
  assert.deepEqual(orderLog, ['probe', 'maximize', 'restore']);
});
