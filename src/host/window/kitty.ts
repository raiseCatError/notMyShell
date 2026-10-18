import {geometryCommand, parseGeometry, sameRect, windowShape, type Rect, type Screen} from './geometry.js';
import {ancestorsFrom, processTable, psCommand, ttyDevice} from './processes.js';
import {firstLine, pause, run, type Command, type CommandResult, type Operation, type Step} from './run.js';
import {refuse, type MaximizeResult, type Probe, type Refused, type RestoreResult, type WindowHost} from './types.js';
import type {WindowContext} from './route.js';

/**
 * kitty on macOS, through its documented remote control over the socket in
 * KITTY_LISTEN_ON only. kitty honors that socket only when remote control is
 * `yes`, `socket` or `socket-only`, and accepts socket requests in all three
 * without asking; NMSh never uses the in-band TTY path (that would write into
 * the terminal NMSh draws) and never changes kitty's configuration.
 *
 * Ownership: KITTY_PID is an ancestor of this frontend, `ls --match
 * id:$KITTY_WINDOW_ID` names exactly one OS window, the kitty window's own
 * process has this frontend's tty (so KITTY_* inherited into another terminal
 * proves nothing), and CoreGraphics reports that OS window as kitty's. kitty
 * reports no maximized state, so the state comes from the window's bounds;
 * the toggle is sent only from that verified state, and back only from exactly
 * the bounds NMSh left.
 */
export function kittyHost(context: WindowContext): WindowHost | Refused {
  const {KITTY_WINDOW_ID: windowId, KITTY_PID: kittyPid, KITTY_LISTEN_ON: socket} = context.env;
  if (!windowId || !/^\d+$/u.test(windowId) || !kittyPid || !/^\d+$/u.test(kittyPid)) return refuse('unsupported', 'kitty did not say which window this is');
  if (!socket || !/^unix:\S+$/u.test(socket)) {
    return refuse('unsupported', 'kitty has no remote control socket for this window, and NMSh does not change kitty\'s settings');
  }
  return {name: 'kitty', probe: () => probeKitty(context, Number(windowId), Number(kittyPid), socket)};
}

const kitten = (binary: string, socket: string, args: readonly string[]): Command =>
  ({file: binary, args: ['@', '--to', socket, '--use-password', 'never', ...args], timeoutMs: 4000});

function remoteFailure(result: CommandResult): Refused | undefined {
  if (result.ok) return undefined;
  if (result.timedOut) return refuse('failed', 'kitty did not answer in time');
  if (/disabled|not allowed|denied|permission|password/iu.test(result.stderr)) return refuse('permissionDenied', 'kitty\'s remote control did not allow this');
  return refuse('failed', `kitty could not be asked: ${firstLine(result.stderr) || `exit ${result.code}`}`);
}

interface KittyOsWindow {id?: unknown; platform_window_id?: unknown; tabs?: Array<{windows?: Array<{id?: unknown; pid?: unknown}>}>}

function* probeKitty(context: WindowContext, windowId: number, kittyPid: number, socket: string): Operation<Probe> {
  const listing = yield* run(psCommand());
  if (!listing.ok) return refuse('failed', 'NMSh could not read its own terminal device');
  const table = processTable(listing.stdout);
  const tty = ttyDevice(table.get(context.pid)?.tty);
  if (!tty) return refuse('uncertainIdentity', 'NMSh could not find its own terminal device');
  if (!ancestorsFrom(table, context.pid).includes(kittyPid)) return refuse('uncertainIdentity', 'this terminal is not a kitty window');
  const executable = table.get(kittyPid)?.command ?? '';
  const binary = executable.startsWith('/') ? `${executable.slice(0, executable.lastIndexOf('/'))}/kitten` : undefined;
  if (!binary || !context.files.executable(binary)) return refuse('unsupported', 'kitty\'s kitten was not found beside kitty');
  const answer = yield* run(kitten(binary, socket, ['ls', '--match', `id:${windowId}`]));
  const failure = remoteFailure(answer);
  if (failure) return failure;
  let windows: KittyOsWindow[];
  try { windows = JSON.parse(answer.stdout); } catch { return refuse('failed', 'kitty answered unexpectedly'); }
  if (!Array.isArray(windows)) return refuse('failed', 'kitty answered unexpectedly');
  const owning = windows.filter(os => os.tabs?.some(tab => tab.windows?.some(window => window.id === windowId)));
  if (owning.length !== 1) return refuse('uncertainIdentity', 'kitty did not name exactly one window for this terminal');
  const own = owning[0]!;
  const shellPid = own.tabs?.flatMap(tab => tab.windows ?? []).find(window => window.id === windowId)?.pid;
  if (typeof shellPid !== 'number' || ttyDevice(table.get(shellPid)?.tty) !== tty) return refuse('uncertainIdentity', 'that kitty window does not show this terminal');
  const number = own.platform_window_id;
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return refuse('uncertainIdentity', 'kitty did not report its window number');
  const seen = yield* windowBounds(number, kittyPid);
  if ('outcome' in seen) return seen;
  const shape = windowShape(seen.bounds, seen.screens);
  if (shape === 'fullscreen') return refuse('fullscreen', 'the window is in fullscreen');
  if (shape === 'maximized') return refuse('alreadyMaximized', 'the window already fills the screen');
  const toggle = kitten(binary, socket, ['resize-os-window', '--match', `id:${windowId}`, '--action=toggle-maximized']);
  return {outcome: 'available', window: {host: 'kitty', maximize: () => maximizeKitty(toggle, number, kittyPid, seen.bounds)}};
}

/** The OS window's bounds from CoreGraphics, only while it is still kitty's, on the normal window layer. */
function* windowBounds(number: number, kittyPid: number): Generator<Step, {bounds: Rect; screens: Screen[]} | Refused, CommandResult | undefined> {
  const geometry = parseGeometry((yield* run(geometryCommand(number))).stdout);
  if (!geometry?.screens.length) return refuse('failed', 'NMSh could not read the displays');
  if (!geometry.window || geometry.window.pid !== kittyPid || geometry.window.layer !== 0) return refuse('uncertainIdentity', 'that window is not kitty\'s');
  return {bounds: geometry.window.bounds, screens: geometry.screens};
}

function* maximizeKitty(toggle: Command, number: number, kittyPid: number, seen: Rect): Operation<MaximizeResult> {
  const before = yield* windowBounds(number, kittyPid);
  if ('outcome' in before) return {outcome: 'unchanged', reason: before.reason};
  if (!sameRect(before.bounds, seen)) return {outcome: 'unchanged', reason: 'the window moved or changed size since NMSh looked'};
  const failure = remoteFailure(yield* run(toggle));
  if (failure) return failure;
  yield* pause(300);
  const after = yield* windowBounds(number, kittyPid);
  if ('outcome' in after) return {outcome: 'unchanged', reason: after.reason};
  if (sameRect(after.bounds, seen)) return {outcome: 'unchanged', reason: 'kitty kept the window\'s size'};
  return {outcome: 'maximized', restore: () => restoreKitty(toggle, number, kittyPid, after.bounds)};
}

/** kitty's own unzoom returns the window to the frame it had before. */
function* restoreKitty(toggle: Command, number: number, kittyPid: number, left: Rect): Operation<RestoreResult> {
  const now = yield* windowBounds(number, kittyPid);
  if ('outcome' in now) return {outcome: 'left', reason: now.reason};
  if (!sameRect(now.bounds, left)) return {outcome: 'left', reason: 'the window moved or changed size since NMSh maximized it'};
  const failure = remoteFailure(yield* run(toggle));
  if (failure) return {outcome: 'failed', reason: failure.reason};
  yield* pause(300);
  const after = yield* windowBounds(number, kittyPid);
  if ('outcome' in after) return {outcome: 'failed', reason: after.reason};
  return sameRect(after.bounds, left) ? {outcome: 'failed', reason: 'kitty kept the maximized size'} : {outcome: 'restored'};
}
