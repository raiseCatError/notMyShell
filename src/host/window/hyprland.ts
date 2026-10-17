import {firstLine, pause, run, type Command, type CommandResult, type Operation, type Step} from './run.js';
import {refuse, type MaximizeResult, type Probe, type Refused, type RestoreResult, type WindowHost} from './types.js';
import type {WindowContext, WindowFiles} from './route.js';

/**
 * Hyprland (Omarchy and any other Hyprland session), terminal-agnostic: Foot,
 * Ghostty, kitty and Alacritty alike, through `hyprctl` IPC only.
 *
 * Only Hyprland 0.55+ running a Lua configuration is used: its
 * `hl.dsp.window.fullscreen({ window, action, mode })` names the exact window
 * and sets or unsets the native maximized state (the one Omarchy's Super+Alt+F
 * toggles), so nothing depends on which window has focus. Older releases and
 * hyprlang configurations only maximize the focused window (or only toggle),
 * and focusing a window first would move the pointer; NMSh leaves those alone.
 *
 * Ownership: the nearest ancestor process of this frontend that owns a Hyprland
 * window, and that process owns exactly one; where /proc shows which pty
 * masters it holds, it must hold this frontend's. Maximized keeps the bar, the
 * gaps, the workspace and tiling or floating; NMSh never changes those, its
 * configuration or Omarchy's.
 */
const MIN_VERSION = [0, 55, 0] as const;

export function hyprlandHost(context: WindowContext): WindowHost | Refused {
  const signature = context.env.HYPRLAND_INSTANCE_SIGNATURE ?? '';
  const runtime = context.env.XDG_RUNTIME_DIR ?? '';
  if (!/^[\w.-]+$/u.test(signature) || !runtime.startsWith('/')) return refuse('unsupported', 'no Hyprland session was found');
  // The variable alone proves nothing (it can be inherited); the session's own IPC socket must be here.
  if (!context.files.exists(`${runtime}/hypr/${signature}/.socket.sock`)) return refuse('unsupported', 'this Hyprland session\'s IPC socket is not here');
  const hyprctl = context.resolve('hyprctl');
  if (!hyprctl) return refuse('unsupported', 'hyprctl was not found');
  return {name: 'Hyprland', probe: () => probeHyprland(context, hyprctl)};
}

const hyprctl = (binary: string, args: readonly string[]): Command => ({file: binary, args, timeoutMs: 3000});

interface Client {address?: unknown; pid?: unknown; mapped?: unknown; hidden?: unknown; fullscreen?: unknown; at?: unknown; size?: unknown; monitor?: unknown; workspace?: {id?: unknown}}

export function parseVersion(stdout: string): [number, number, number] | undefined {
  let value: {version?: unknown; tag?: unknown};
  try { value = JSON.parse(stdout); } catch { return undefined; }
  const text = typeof value.version === 'string' && value.version ? value.version : typeof value.tag === 'string' ? value.tag : '';
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

const atLeast = (version: readonly number[], minimum: readonly number[]) => {
  for (let i = 0; i < minimum.length; i++) if (version[i] !== minimum[i]) return version[i]! > minimum[i]!;
  return true;
};

/** Parents of `pid`, nearest first, read from /proc (bounded). */
export function procAncestors(files: WindowFiles, pid: number): number[] {
  const out: number[] = [];
  let current = pid;
  while (out.length < 64) {
    const status = files.readText(`/proc/${current}/status`);
    const parent = Number(/^PPid:\s*(\d+)\s*$/mu.exec(status ?? '')?.[1]);
    if (!Number.isInteger(parent) || parent <= 1 || out.includes(parent)) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

/** This process's pty index (`/dev/pts/7` → 7), from its standard streams. */
export function procPtyIndex(files: WindowFiles, pid: number): number | undefined {
  for (const fd of [0, 1, 2]) {
    const match = /^\/dev\/pts\/(\d+)$/u.exec(files.readLink(`/proc/${pid}/fd/${fd}`) ?? '');
    if (match) return Number(match[1]);
  }
  return undefined;
}

/**
 * Whether `pid` holds the pty master for `/dev/pts/<index>` (Linux exposes `tty-index` in a ptmx descriptor's
 * fdinfo): true or false when it holds pty masters at all, undefined when /proc says nothing either way.
 */
export function holdsPtyMaster(files: WindowFiles, pid: number, index: number): boolean | undefined {
  const fds = files.list(`/proc/${pid}/fd`);
  if (!fds) return undefined;
  let masters = 0;
  for (const fd of fds.slice(0, 4096)) {
    if (!/^\d+$/u.test(fd)) continue;
    const link = files.readLink(`/proc/${pid}/fd/${fd}`);
    if (link !== '/dev/ptmx' && link !== '/dev/pts/ptmx') continue;
    const tty = /^tty-index:\s*(\d+)\s*$/mu.exec(files.readText(`/proc/${pid}/fdinfo/${fd}`) ?? '');
    if (!tty) continue;
    masters++;
    if (Number(tty[1]) === index) return true;
  }
  return masters ? false : undefined;
}

const ADDRESS = /^0x[0-9a-f]{1,16}$/iu;

function parseClients(stdout: string): Client[] | undefined {
  try {
    const value = JSON.parse(stdout);
    return Array.isArray(value) ? value as Client[] : undefined;
  } catch { return undefined; }
}

/** Where and how the window sits; any difference means someone else changed it. */
const placement = (client: Client) => JSON.stringify([client.at, client.size, client.monitor, client.workspace?.id]);

const lua = (address: string, action: 'set' | 'unset') => `hl.dsp.window.fullscreen({ window = "address:${address}", action = "${action}", mode = "maximized" })`;

function* probeHyprland(context: WindowContext, binary: string): Operation<Probe> {
  const versionAnswer = yield* run(hyprctl(binary, ['-j', 'version']));
  if (!versionAnswer.ok) return refuse('unsupported', `Hyprland's IPC did not answer${versionAnswer.timedOut ? ' in time' : `: ${firstLine(versionAnswer.stderr)}`}`);
  const version = parseVersion(versionAnswer.stdout);
  if (!version) return refuse('failed', 'Hyprland did not report its version');
  const label = version.join('.');
  if (!atLeast(version, [0, 52, 0])) return refuse('unsupported', `Hyprland ${label} can only toggle maximize, and NMSh never toggles blindly`);
  if (!atLeast(version, MIN_VERSION)) return refuse('unsupported', `Hyprland ${label} can only maximize the focused window; NMSh needs to name its own`);
  const config = yield* run(hyprctl(binary, ['eval', 'return true']));
  if (!config.ok || config.stdout.trim() !== 'ok') {
    return refuse('unsupported', 'this Hyprland uses a hyprlang configuration, whose maximize acts on the focused window only');
  }
  const ancestors = procAncestors(context.files, context.pid);
  if (!ancestors.length) return refuse('uncertainIdentity', 'NMSh could not read its own process ancestry');
  const listing = yield* run(hyprctl(binary, ['-j', 'clients']));
  const clients = listing.ok ? parseClients(listing.stdout) : undefined;
  if (!clients) return refuse('failed', 'Hyprland did not list its windows');
  let own: Client | undefined;
  for (const pid of ancestors) {
    const owned = clients.filter(client => client.pid === pid);
    if (!owned.length) continue;
    if (owned.length > 1) return refuse('uncertainIdentity', 'the terminal has several windows, and NMSh cannot tell which one is this');
    own = owned[0];
    break;
  }
  if (!own) return refuse('uncertainIdentity', 'no Hyprland window belongs to this terminal');
  const address = typeof own.address === 'string' && ADDRESS.test(own.address) ? own.address : undefined;
  if (!address || own.mapped !== true || own.hidden === true) return refuse('uncertainIdentity', 'the terminal\'s window is not one NMSh can name');
  const index = procPtyIndex(context.files, context.pid);
  if (index !== undefined && holdsPtyMaster(context.files, own.pid as number, index) === false) {
    return refuse('uncertainIdentity', 'that window\'s process does not hold this terminal');
  }
  if (own.fullscreen === 1) return refuse('alreadyMaximized', 'the window is already maximized');
  if (own.fullscreen === 2 || own.fullscreen === 3) return refuse('fullscreen', 'the window is fullscreen');
  if (own.fullscreen !== 0) return refuse('failed', 'Hyprland reported an unknown window state');
  return {outcome: 'available', window: {host: 'Hyprland', maximize: () => maximizeHyprland(binary, address, own.pid as number)}};
}

function* currentClient(binary: string, address: string, pid: number): Generator<Step, Client | undefined, CommandResult | undefined> {
  const listing = yield* run(hyprctl(binary, ['-j', 'clients']));
  const found = (listing.ok ? parseClients(listing.stdout) : undefined)?.find(client => client.address === address);
  return found && found.pid === pid && found.mapped === true ? found : undefined;
}

function* maximizeHyprland(binary: string, address: string, pid: number): Operation<MaximizeResult> {
  const before = yield* currentClient(binary, address, pid);
  if (!before) return {outcome: 'unchanged', reason: 'the window closed'};
  if (before.fullscreen !== 0) return {outcome: 'unchanged', reason: 'the window was maximized or fullscreened since NMSh looked'};
  const answer = yield* run(hyprctl(binary, ['dispatch', lua(address, 'set')]));
  if (!answer.ok || answer.stdout.trim() !== 'ok') return {outcome: 'failed', reason: `Hyprland refused: ${firstLine(answer.stdout || answer.stderr)}`};
  yield* pause(150);
  const after = yield* currentClient(binary, address, pid);
  if (!after || after.fullscreen !== 1) return {outcome: 'unchanged', reason: 'Hyprland kept the window as it was'};
  const left = placement(after);
  return {outcome: 'maximized', restore: () => restoreHyprland(binary, address, pid, left)};
}

function* restoreHyprland(binary: string, address: string, pid: number, left: string): Operation<RestoreResult> {
  const now = yield* currentClient(binary, address, pid);
  if (!now) return {outcome: 'left', reason: 'the window closed'};
  if (now.fullscreen !== 1 || placement(now) !== left) return {outcome: 'left', reason: 'the window changed since NMSh maximized it'};
  const answer = yield* run(hyprctl(binary, ['dispatch', lua(address, 'unset')]));
  if (!answer.ok || answer.stdout.trim() !== 'ok') return {outcome: 'failed', reason: `Hyprland refused: ${firstLine(answer.stdout || answer.stderr)}`};
  yield* pause(150);
  const after = yield* currentClient(binary, address, pid);
  return after?.fullscreen === 0 ? {outcome: 'restored'} : {outcome: 'failed', reason: 'Hyprland kept the window maximized'};
}
