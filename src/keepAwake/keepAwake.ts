import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';

/**
 * Keep Awake (/caffeinate, /awake, /zoomies): one controller over the
 * operating system's own inhibition mechanism.
 *
 *   macOS    Apple /usr/bin/caffeinate (fixed path, fixed flags)
 *   Linux    systemd-inhibit wrapping an NMSh-owned wait helper (idle/sleep only)
 *   Windows  Kernel32 SetThreadExecutionState from a fixed PowerShell helper
 *
 * Modes are user intent, not flags. Every value reaching a child is an enum
 * or a validated integer; nothing from input becomes program text. The
 * assertion lives in a detached process that outlives the NMSh window and
 * ends on Stop or its timeout. NMSh changes no power settings, desktop
 * preferences or rc files, and never kills a process it cannot prove it owns.
 */

export const KEEP_AWAKE_MODES = ['idle', 'display', 'system', 'all'] as const;
export type KeepAwakeMode = typeof KEEP_AWAKE_MODES[number];
export const MODE_LABELS: Record<KeepAwakeMode, string> = {idle: 'Idle', display: 'Display', system: 'System', all: 'All'};
export const MODE_DESCRIPTIONS: Record<KeepAwakeMode, string> = {
  idle: 'Prevent automatic idle sleep', display: 'Keep the display and the machine awake',
  system: 'Prevent automatic system sleep', all: 'All normal wake assertions available here',
};

export interface KeepAwakeCapabilities {idle: boolean; display: boolean; system: boolean}

export interface LaunchPlan {command: string; args: string[]; env?: NodeJS.ProcessEnv}

export interface KeepAwakeBackend {
  id: 'macos-caffeinate' | 'linux-systemd-inhibit' | 'windows-execution-state' | 'inert';
  label: string;
  capabilities: KeepAwakeCapabilities;
  /** Factual notes shown in the panel (e.g. Apple's -s needs AC power). */
  notes: string[];
  /** undefined when this backend cannot honour the mode. */
  plan(mode: KeepAwakeMode, token: string, timeoutSeconds?: number): LaunchPlan | undefined;
}

export const MAX_TIMEOUT_SECONDS = 7 * 24 * 3600;

/** Strict durations only: 45s, 30m, 2h (1 second to 7 days). */
export function parseDuration(text: string | undefined): number | undefined | 'invalid' {
  if (text === undefined || text === '') return undefined;
  const match = /^([1-9]\d{0,5})([smh])$/u.exec(text);
  if (!match) return 'invalid';
  const seconds = Number(match[1]) * (match[2] === 'h' ? 3600 : match[2] === 'm' ? 60 : 1);
  return seconds <= MAX_TIMEOUT_SECONDS ? seconds : 'invalid';
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : m ? `${m}m` : `${s}s`;
}

// ---- macOS ----------------------------------------------------------------------------

export const CAFFEINATE = '/usr/bin/caffeinate';
const CAFFEINATE_FLAGS: Record<KeepAwakeMode, string[]> = {idle: ['-i'], display: ['-d', '-i'], system: ['-s'], all: ['-d', '-i', '-s']};

export function macBackend(): KeepAwakeBackend {
  return {
    id: 'macos-caffeinate', label: 'Apple caffeinate', capabilities: {idle: true, display: true, system: true},
    notes: ['System (-s) holds only while the Mac is on AC power.'],
    plan: (mode, _token, timeout) => ({command: CAFFEINATE, args: [...CAFFEINATE_FLAGS[mode], ...(timeout ? ['-t', String(timeout)] : [])]}),
  };
}

// ---- Linux ----------------------------------------------------------------------------

export const SYSTEMD_INHIBIT_PATHS = ['/usr/bin/systemd-inhibit', '/bin/systemd-inhibit'] as const;
/** Normal inhibitors only: never shutdown, lid switch, power or suspend keys. */
const INHIBIT_WHAT: Partial<Record<KeepAwakeMode, string>> = {idle: 'idle', system: 'sleep', all: 'idle:sleep'};

/** The NMSh-owned process the inhibitor wraps: it only waits (bounded), so the lock ends with it. Fixed code; token and seconds are argv. */
export const WAIT_HELPER = 'const s=Number(process.argv[2]);const t=setTimeout(()=>process.exit(0),s>0?s*1000:2147483647);process.on("SIGTERM",()=>{clearTimeout(t);process.exit(0)});setInterval(()=>{},1<<30)';

export function linuxBackend(inhibit: string, node: string = process.execPath): KeepAwakeBackend {
  return {
    id: 'linux-systemd-inhibit', label: 'systemd inhibitor', capabilities: {idle: true, display: false, system: true},
    notes: ['Display: not supported by the systemd inhibitor (it is not a display API); use Idle or System.', 'Lid close and power keys keep their normal behavior.'],
    plan: (mode, token, timeout) => {
      const what = INHIBIT_WHAT[mode];
      if (!what) return undefined;
      return {command: inhibit, args: [`--what=${what}`, '--mode=block', '--who=notMyShell', '--why=Keep-awake requested by NMSh',
        node, '-e', WAIT_HELPER, '--', String(timeout ?? 0), `nmsh-keep-awake=${token}`]};
    },
  };
}

// ---- Windows --------------------------------------------------------------------------

export const ES_CONTINUOUS = 0x80000000;
export const ES_SYSTEM_REQUIRED = 0x00000001;
export const ES_DISPLAY_REQUIRED = 0x00000002;
/** Windows has no separate idle assertion: Idle and System both mean SYSTEM_REQUIRED. Away mode is never used. */
export function executionStateFlags(mode: KeepAwakeMode): number {
  return (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | (mode === 'display' || mode === 'all' ? ES_DISPLAY_REQUIRED : 0)) >>> 0;
}

/** Fixed first-party script; only numeric constants and the hex token are substituted. */
export function windowsHelperScript(flags: number, token: string, timeout?: number): string {
  if (!Number.isSafeInteger(flags) || !/^[0-9a-f]{32}$/u.test(token) || (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_SECONDS))) {
    throw new Error('Refusing keep-awake helper values.');
  }
  return [`# nmsh-keep-awake=${token}`,
    'Add-Type -Namespace NMSh -Name Power -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);\'',
    `if ([NMSh.Power]::SetThreadExecutionState([uint32]${flags}) -eq 0) { exit 2 }`,
    `$deadline = ${timeout ? `(Get-Date).AddSeconds(${timeout})` : '[DateTime]::MaxValue'}`,
    'try { while ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 } } finally { [void][NMSh.Power]::SetThreadExecutionState([uint32]2147483648) }'].join('\n');
}

export function windowsBackend(powershell: string): KeepAwakeBackend {
  return {
    id: 'windows-execution-state', label: 'Windows execution-state API', capabilities: {idle: true, display: true, system: true},
    notes: ['Idle and System are the same Windows assertion (system required).', 'No power plan setting is changed.'],
    plan: (mode, token, timeout) => ({command: powershell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand',
      Buffer.from(windowsHelperScript(executionStateFlags(mode), token, timeout), 'utf16le').toString('base64')]}),
  };
}

// ---- Inert (tests and recorded demos only) ----------------------------------------------

/**
 * A backend that asserts nothing: the same NMSh-owned, detached, bounded wait
 * helper the Linux backend wraps, without the inhibitor. It exists so the real
 * slash, controller, ownership and presentation paths can run in tests and
 * VHS recordings without keeping a machine awake. Honored only together with
 * NMSH_DETERMINISTIC=1; it never appears in ordinary use.
 */
export function inertBackend(node: string = process.execPath): KeepAwakeBackend {
  return {
    id: 'inert', label: 'inert demo backend (no assertion)', capabilities: {idle: true, display: true, system: true},
    notes: ['Deterministic demo/test mode: nothing is kept awake.'],
    plan: (_mode, token, timeout) => ({command: node, args: ['-e', WAIT_HELPER, '--', String(timeout ?? 0), `nmsh-keep-awake=${token}`]}),
  };
}

/** The backend detection decides; the platform alone does not. */
export function detectBackend(platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync,
  env: NodeJS.ProcessEnv = process.env): KeepAwakeBackend | undefined {
  if (env.NMSH_DETERMINISTIC === '1' && env.NMSH_KEEP_AWAKE_BACKEND === 'inert') return inertBackend();
  if (platform === 'darwin') return exists(CAFFEINATE) ? macBackend() : undefined;
  if (platform === 'linux') {
    const inhibit = SYSTEMD_INHIBIT_PATHS.find(exists);
    return inhibit ? linuxBackend(inhibit) : undefined;
  }
  if (platform === 'win32') {
    const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
    const powershell = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    return exists(powershell) ? windowsBackend(powershell) : undefined;
  }
  return undefined;
}

export function unsupportedReason(platform: NodeJS.Platform = process.platform): string {
  return platform === 'linux' ? 'No supported Linux inhibitor was detected (systemd-inhibit). NMSh does not install one or change power settings.'
    : platform === 'darwin' ? '/usr/bin/caffeinate was not found.' : platform === 'win32' ? 'Windows PowerShell was not found for the execution-state helper.'
      : 'Keep Awake has no backend on this platform.';
}

// ---- Processes and ownership ----------------------------------------------------------

export interface ProcessProbe {
  start(plan: LaunchPlan): number | undefined;
  alive(pid: number): boolean;
  /** The process's full command line, or undefined when it cannot be read. */
  commandLine(pid: number): string | undefined;
  signal(pid: number, signal: NodeJS.Signals): void;
  now(): number;
}

export const systemProbe: ProcessProbe = {
  start(plan) {
    const child = spawn(plan.command, plan.args, {detached: true, stdio: 'ignore', env: plan.env ?? process.env, windowsHide: true});
    child.on('error', () => { /* reported by the startup check */ });
    child.unref();
    return child.pid;
  },
  alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } },
  commandLine(pid) {
    if (process.platform === 'linux') {
      try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\u0000').filter(Boolean).join(' '); } catch { return undefined; }
    }
    if (process.platform === 'win32') {
      // Absolute System32 path: never a PATH lookup.
      const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
      const result = spawnSync(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}").CommandLine`], {encoding: 'utf8', timeout: 5000, windowsHide: true});
      return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    }
    const result = spawnSync('/bin/ps', ['-ww', '-o', 'command=', '-p', String(Math.trunc(pid))], {encoding: 'utf8', timeout: 3000});
    return result.status === 0 ? result.stdout.trim() || undefined : undefined;
  },
  signal(pid, signal) { try { process.kill(pid, signal); } catch { /* already gone */ } },
  now: () => Date.now(),
};

export interface KeepAwakeRecord {
  version: 1;
  token: string;
  backend: KeepAwakeBackend['id'];
  mode: KeepAwakeMode;
  pid: number;
  startedAt: number;
  timeoutSeconds?: number;
  /** The exact launch, for ownership checks. */
  command: string;
  args: string[];
}

export type KeepAwakeStatus =
  | {state: 'off'; note?: string}
  | {state: 'running'; record: KeepAwakeRecord};

export function keepAwakePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'keep-awake.json');
}

/** A record's process is ours only if it is alive and its command line is the exact launch (including the token where the backend carries one). */
function owned(record: KeepAwakeRecord, probe: ProcessProbe): boolean {
  if (!Number.isSafeInteger(record.pid) || record.pid <= 1 || !probe.alive(record.pid)) return false;
  const line = probe.commandLine(record.pid);
  if (!line) return false;
  if (record.backend === 'macos-caffeinate') return line === [record.command, ...record.args].join(' ');
  // Linux carries the token in argv; Windows carries it inside the encoded script (the last argument).
  return record.backend === 'linux-systemd-inhibit' || record.backend === 'inert' ? line.includes(`nmsh-keep-awake=${record.token}`) : line.includes(record.args.at(-1)!);
}

export type StartResult =
  | {kind: 'started'; record: KeepAwakeRecord; replaced?: KeepAwakeMode}
  | {kind: 'already'; record: KeepAwakeRecord}
  | {kind: 'needsConfirm'; from: KeepAwakeMode; to: KeepAwakeMode}
  | {kind: 'unsupported'; reason: string}
  | {kind: 'failed'; reason: string; previousStopped?: boolean};

export class KeepAwakeController {
  constructor(readonly backend: KeepAwakeBackend | undefined, private readonly probe: ProcessProbe = systemProbe,
    readonly path: string = keepAwakePath(), private readonly platform: NodeJS.Platform = process.platform) {}

  private load(): KeepAwakeRecord | undefined {
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as KeepAwakeRecord;
      if (data.version !== 1 || typeof data.token !== 'string' || !KEEP_AWAKE_MODES.includes(data.mode) || !Number.isSafeInteger(data.pid)
        || typeof data.command !== 'string' || !Array.isArray(data.args)) return undefined;
      return data;
    } catch { return undefined; }
  }

  private save(record: KeepAwakeRecord): void {
    mkdirSync(dirname(this.path), {recursive: true, mode: 0o700});
    const staged = `${this.path}.${process.pid}.tmp`;
    writeFileSync(staged, `${JSON.stringify(record, null, 2)}\n`, {mode: 0o600});
    renameSync(staged, this.path);
  }

  private clear(): void { rmSync(this.path, {force: true}); }

  /** The stored record without an ownership check: cheap enough to poll for presentation, never used to stop anything. */
  peek(): KeepAwakeRecord | undefined { return this.load(); }

  /** Verified state. Unprovable records are cleared (never killed). */
  status(): KeepAwakeStatus {
    const record = this.load();
    if (!record) return {state: 'off'};
    if (owned(record, this.probe)) return {state: 'running', record};
    this.clear();
    const expired = record.timeoutSeconds && this.probe.now() >= record.startedAt + record.timeoutSeconds * 1000;
    return {state: 'off', note: expired ? `The ${MODE_LABELS[record.mode]} keep-awake ended after its ${formatDuration(record.timeoutSeconds!)} timeout.`
      : 'The earlier keep-awake is no longer running (or could not be verified as NMSh\'s); its record was cleared and nothing was stopped.'};
  }

  supports(mode: KeepAwakeMode): boolean {
    if (!this.backend) return false;
    const caps = this.backend.capabilities;
    return mode === 'idle' ? caps.idle : mode === 'display' ? caps.display : mode === 'system' ? caps.system : caps.idle || caps.system;
  }

  /** Starts, or reports already-running / needs-confirm. `confirmed` replaces a different running mode. */
  start(mode: KeepAwakeMode, timeoutSeconds?: number, confirmed = false): StartResult {
    if (!this.backend) return {kind: 'unsupported', reason: unsupportedReason(this.platform)};
    if (!this.supports(mode)) return {kind: 'unsupported', reason: `${MODE_LABELS[mode]} is not supported by the ${this.backend.label}. ${this.backend.notes[0] ?? ''}`.trim()};
    const current = this.status();
    if (current.state === 'running') {
      if (current.record.mode === mode && current.record.timeoutSeconds === timeoutSeconds) return {kind: 'already', record: current.record};
      if (!confirmed) return {kind: 'needsConfirm', from: current.record.mode, to: mode};
    }
    const token = randomBytes(16).toString('hex');
    const plan = this.backend.plan(mode, token, timeoutSeconds);
    if (!plan) return {kind: 'unsupported', reason: `${MODE_LABELS[mode]} is not supported by the ${this.backend.label}.`};
    // Start the replacement first, then release the old assertion: no unprotected gap.
    const pid = this.probe.start(plan);
    const record: KeepAwakeRecord = {version: 1, token, backend: this.backend.id, mode, pid: pid ?? 0, startedAt: this.probe.now(),
      ...(timeoutSeconds ? {timeoutSeconds} : {}), command: plan.command, args: plan.args};
    if (!pid || !this.probe.alive(pid)) {
      return {kind: 'failed', reason: `${this.backend.label} did not start.${current.state === 'running' ? ` The ${MODE_LABELS[current.record.mode]} keep-awake is still running.` : ''}`};
    }
    if (current.state === 'running') this.terminate(current.record);
    this.save(record);
    return {kind: 'started', record, ...(current.state === 'running' ? {replaced: current.record.mode} : {})};
  }

  private terminate(record: KeepAwakeRecord): void {
    this.probe.signal(record.pid, 'SIGTERM');
    const deadline = this.probe.now() + 2000;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    // Poll ownership, not bare liveness: an exited child awaiting reaping no longer has our command line.
    while (owned(record, this.probe) && this.probe.now() < deadline) Atomics.wait(pause, 0, 0, 50);
    if (owned(record, this.probe)) this.probe.signal(record.pid, 'SIGKILL');
  }

  /** Idempotent. Stops only a verified NMSh-owned assertion. */
  stop(): string {
    const record = this.load();
    if (!record) return 'Keep Awake is off.';
    if (!owned(record, this.probe)) { this.clear(); return 'Keep Awake is off (the earlier record could not be verified as NMSh\'s, so nothing was stopped).'; }
    this.terminate(record);
    this.clear();
    return `Keep Awake stopped (${MODE_LABELS[record.mode]}). Normal sleep behavior is back.`;
  }
}
