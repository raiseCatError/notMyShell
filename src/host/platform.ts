import {readFileSync} from 'node:fs';
import {release} from 'node:os';

/**
 * The machine NMSh's Node process runs on (the guest, under WSL), separate
 * from the terminal host that draws it (which, under WSL, is a Windows app).
 *
 * Supported architecture on Windows:
 *   Windows terminal host → WSL 2 → Linux Node.js → NMSh → shell
 * WSL 1 is detected and reported, never claimed as supported: it has no real
 * Linux kernel, and PTY, process-group and Unix-socket behavior differ.
 * Native Windows (ConPTY) is not supported.
 */

export type WslVersion = 1 | 2 | 'unknown';

export interface PlatformInfo {
  os: 'macos' | 'linux' | 'windows' | 'other';
  /** Kernel release, e.g. 6.6.87.2-microsoft-standard-WSL2. */
  kernel: string;
  wsl?: {version: WslVersion; distro?: string; interop: boolean};
  /** One plain sentence about support status, factual. */
  support: string;
}

export interface PlatformProbe {
  platform: NodeJS.Platform;
  release: string;
  env: NodeJS.ProcessEnv;
  read(path: string): string | undefined;
}

export function systemPlatformProbe(env: NodeJS.ProcessEnv = process.env): PlatformProbe {
  return {platform: process.platform, release: release(), env,
    read: path => { try { return readFileSync(path, 'utf8').slice(0, 4096); } catch { return undefined; } }};
}

/**
 * WSL evidence, strongest first: the kernel release (WSL 2 kernels are
 * "...-microsoft-standard-WSL2"; WSL 1 reports a Windows build like
 * "4.4.0-19041-Microsoft"), then /proc/version, then WSL environment variables.
 */
export function detectWsl(probe: PlatformProbe): PlatformInfo['wsl'] {
  if (probe.platform !== 'linux') return undefined;
  const kernel = probe.release;
  const procVersion = probe.read('/proc/version') ?? '';
  const envSaysWsl = Boolean(probe.env.WSL_DISTRO_NAME || probe.env.WSL_INTEROP);
  const microsoft = /microsoft/iu.test(kernel) || /microsoft/iu.test(procVersion);
  if (!microsoft && !envSaysWsl) return undefined;
  let version: WslVersion = 'unknown';
  if (/WSL2|microsoft-standard/iu.test(kernel) || /WSL2|microsoft-standard/iu.test(procVersion)) version = 2;
  else if (/-Microsoft$/u.test(kernel.trim()) || /^4\.4\.0-\d+-Microsoft/u.test(kernel)) version = 1;
  // WSL_INTEROP (a per-instance interop socket) is set by WSL 2; WSL 1 does not set it.
  else if (probe.env.WSL_INTEROP) version = 2;
  const distro = probe.env.WSL_DISTRO_NAME?.replace(/[\u0000-\u001f]/gu, '').slice(0, 64) || undefined;
  return {version, ...(distro ? {distro} : {}), interop: Boolean(probe.env.WSL_INTEROP) || probe.read('/proc/sys/fs/binfmt_misc/WSLInterop') !== undefined};
}

export function detectPlatform(probe: PlatformProbe = systemPlatformProbe()): PlatformInfo {
  const kernel = probe.release;
  if (probe.platform === 'darwin') return {os: 'macos', kernel, support: 'macOS: supported platform.'};
  if (probe.platform === 'win32') return {os: 'windows', kernel, support: 'Native Windows is not supported. Run NMSh inside WSL 2 from your Windows terminal.'};
  if (probe.platform !== 'linux') return {os: 'other', kernel, support: `${probe.platform} is not a supported platform.`};
  const wsl = detectWsl(probe);
  if (!wsl) return {os: 'linux', kernel, support: 'Linux: supported by automated tests; physical terminal validation is pending.'};
  const where = wsl.distro ? ` (${wsl.distro})` : '';
  if (wsl.version === 2) return {os: 'linux', kernel, wsl, support: `WSL 2${where}: the supported Windows path; physical validation is pending.`};
  if (wsl.version === 1) {
    return {os: 'linux', kernel, wsl,
      support: `WSL 1${where} detected: not supported. WSL 1 translates Linux calls without a Linux kernel, so PTY, signal and socket behavior can differ; convert with \`wsl --set-version <distro> 2\`.`};
  }
  return {os: 'linux', kernel, wsl, support: `WSL${where} detected, version unknown: WSL 2 is the supported path.`};
}

/**
 * Windows paths visible from WSL (/mnt/c/...) live on a 9p/drvfs mount: slow
 * for metadata scans and without Unix permission semantics. NMSh keeps its
 * own private state on the Linux filesystem; this flags cwd scans that would
 * be slow, so callers can bound work.
 */
export function isWindowsMount(path: string, wsl: PlatformInfo['wsl']): boolean {
  return Boolean(wsl) && /^\/mnt\/[a-z](?:\/|$)/u.test(path);
}
