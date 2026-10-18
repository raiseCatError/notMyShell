import {appleBounds, fromAppleBounds, geometryCommand, parseGeometry, sameRect, windowShape, type Rect} from './geometry.js';
import {processTable, psCommand, ttyDevice} from './processes.js';
import {firstLine, run, type Command, type CommandResult, type Operation} from './run.js';
import {refuse, type MaximizeResult, type Probe, type Refused, type RestoreResult, type WindowHost} from './types.js';
import type {WindowContext} from './route.js';

/**
 * macOS Terminal.app, through its own scripting dictionary (Automation, never
 * Accessibility). The window is the one whose tab's tty is this frontend's
 * tty, found by id; its `zoomed` state and bounds are read before anything
 * changes, and every script re-checks both before it acts. Zoom is the
 * standard macOS zoom: title bar, desktop and Space stay as they are.
 *
 * The scripts are fixed text; the tty, window id and bounds arrive as argv.
 */
export const TERMINAL_PROBE_SCRIPT: readonly string[] = [
  'on run argv',
  'set target to item 1 of argv',
  'if application "Terminal" is not running then return "notrunning"',
  'tell application "Terminal"',
  'set found to {}',
  'repeat with w in windows',
  'try',
  'repeat with t in tabs of w',
  'if (tty of t) is target then set end of found to (id of w)',
  'end repeat',
  'end try',
  'end repeat',
  'if (count of found) is 0 then return "none"',
  'if (count of found) is greater than 1 then return "many"',
  'set w to window id (item 1 of found)',
  'set b to bounds of w',
  'return "ok " & (id of w) & " " & (zoomed of w) & " " & (miniaturized of w) & " " & (item 1 of b) & " " & (item 2 of b) & " " & (item 3 of b) & " " & (item 4 of b)',
  'end tell',
  'end run',
];

const OWNERSHIP = [
  'if not (exists window id wid) then return "gone"',
  'set w to window id wid',
  'set owned to false',
  'repeat with t in tabs of w',
  'if (tty of t) is target then set owned to true',
  'end repeat',
  'if not owned then return "notours"',
];

/** Zooms only the window seen: still this tty's, unzoomed, not minimized, at the bounds NMSh saw. */
export const TERMINAL_MAXIMIZE_SCRIPT: readonly string[] = [
  'on run argv',
  'set target to item 1 of argv',
  'set wid to (item 2 of argv) as integer',
  'set seen to {(item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer}',
  'if application "Terminal" is not running then return "notrunning"',
  'tell application "Terminal"',
  ...OWNERSHIP,
  'if zoomed of w then return "zoomed"',
  'if miniaturized of w then return "minimized"',
  'if (bounds of w) is not seen then return "moved"',
  'set zoomed of w to true',
  'delay 0.3',
  'set b to bounds of w',
  'return "ok " & (zoomed of w) & " " & (item 1 of b) & " " & (item 2 of b) & " " & (item 3 of b) & " " & (item 4 of b)',
  'end tell',
  'end run',
];

/** Unzooms only if the window is still exactly as NMSh left it, then puts the original bounds back. */
export const TERMINAL_RESTORE_SCRIPT: readonly string[] = [
  'on run argv',
  'set target to item 1 of argv',
  'set wid to (item 2 of argv) as integer',
  'set leftAs to {(item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer}',
  'set original to {(item 7 of argv) as integer, (item 8 of argv) as integer, (item 9 of argv) as integer, (item 10 of argv) as integer}',
  'if application "Terminal" is not running then return "gone"',
  'tell application "Terminal"',
  ...OWNERSHIP,
  'if not (zoomed of w) then return "unzoomed"',
  'if (bounds of w) is not leftAs then return "moved"',
  'set zoomed of w to false',
  'delay 0.3',
  'if (bounds of w) is not original then set bounds of w to original',
  'return "ok"',
  'end tell',
  'end run',
];

export const osascript = (lines: readonly string[], argv: readonly string[]): Command =>
  ({file: '/usr/bin/osascript', args: [...lines.flatMap(line => ['-e', line]), ...argv], timeoutMs: 5000});

/** A failed Apple event: Automation refused (-1743), no answer in time, or anything else. */
export function appleEventFailure(result: CommandResult, app: string): Refused | undefined {
  if (result.ok) return undefined;
  if (result.timedOut) return refuse('failed', `${app} did not answer in time`);
  if (/-1743|not (?:authori[sz]ed|allowed)/iu.test(result.stderr)) return refuse('permissionDenied', `macOS did not allow NMSh to ask ${app} about its window`);
  return refuse('failed', `${app} could not be asked: ${firstLine(result.stderr) || `exit ${result.code}`}`);
}

const CHANGED: Record<string, string> = {
  moved: 'the window moved or changed size since NMSh looked', zoomed: 'the window is already zoomed', minimized: 'the window is minimized',
  notours: 'the window no longer shows this terminal', gone: 'the window closed', notrunning: 'Terminal is not running', unzoomed: 'the window is no longer zoomed',
};

export function terminalAppHost(context: WindowContext): WindowHost {
  return {name: 'Terminal', probe: () => probeTerminal(context)};
}

function* probeTerminal(context: WindowContext): Operation<Probe> {
  const table = yield* run(psCommand());
  if (!table.ok) return refuse('failed', 'NMSh could not read its own terminal device');
  const tty = ttyDevice(processTable(table.stdout).get(context.pid)?.tty);
  if (!tty) return refuse('uncertainIdentity', 'NMSh could not find its own terminal device');
  const answer = yield* run(osascript(TERMINAL_PROBE_SCRIPT, [tty]));
  const failure = appleEventFailure(answer, 'Terminal');
  if (failure) return failure;
  const line = answer.stdout.trim();
  if (line === 'none' || line === 'many' || line === 'notrunning') {
    return refuse('uncertainIdentity', line === 'many' ? 'more than one Terminal window showed this terminal' : 'no Terminal window showed this terminal');
  }
  const match = /^ok (\d+) (true|false) (true|false) (-?\d+) (-?\d+) (-?\d+) (-?\d+)$/u.exec(line);
  if (!match) return refuse('failed', 'Terminal answered unexpectedly');
  const [, id, zoomed, minimized, left, top, right, bottom] = match;
  if (zoomed === 'true') return refuse('alreadyMaximized', 'the window is already zoomed');
  if (minimized === 'true') return refuse('uncertainIdentity', 'the window is minimized');
  const bounds = fromAppleBounds(Number(left), Number(top), Number(right), Number(bottom));
  const geometry = parseGeometry((yield* run(geometryCommand())).stdout);
  if (!geometry?.screens.length) return refuse('failed', 'NMSh could not read the displays');
  const shape = windowShape(bounds, geometry.screens);
  if (shape === 'fullscreen') return refuse('fullscreen', 'the window is in fullscreen');
  if (shape === 'maximized') return refuse('alreadyMaximized', 'the window already fills the screen');
  return {outcome: 'available', window: {host: 'Terminal', maximize: () => maximizeTerminal(tty, Number(id), bounds)}};
}

function* maximizeTerminal(tty: string, id: number, seen: Rect): Operation<MaximizeResult> {
  const answer = yield* run(osascript(TERMINAL_MAXIMIZE_SCRIPT, [tty, String(id), ...appleBounds(seen)]));
  const failure = appleEventFailure(answer, 'Terminal');
  if (failure) return failure;
  const line = answer.stdout.trim();
  const done = /^ok (true|false) (-?\d+) (-?\d+) (-?\d+) (-?\d+)$/u.exec(line);
  if (!done) return {outcome: 'unchanged', reason: CHANGED[line] ?? 'Terminal answered unexpectedly'};
  const after = fromAppleBounds(Number(done[2]), Number(done[3]), Number(done[4]), Number(done[5]));
  if (done[1] !== 'true' || sameRect(after, seen)) return {outcome: 'unchanged', reason: 'Terminal kept the window\'s size'};
  return {outcome: 'maximized', restore: () => restoreTerminal(tty, id, after, seen)};
}

function* restoreTerminal(tty: string, id: number, after: Rect, original: Rect): Operation<RestoreResult> {
  const answer = yield* run(osascript(TERMINAL_RESTORE_SCRIPT, [tty, String(id), ...appleBounds(after), ...appleBounds(original)]));
  const failure = appleEventFailure(answer, 'Terminal');
  if (failure) return {outcome: 'failed', reason: failure.reason};
  const line = answer.stdout.trim();
  return line === 'ok' ? {outcome: 'restored'} : {outcome: 'left', reason: CHANGED[line] ?? 'Terminal answered unexpectedly'};
}
