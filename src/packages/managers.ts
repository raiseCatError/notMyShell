import {readFileSync} from 'node:fs';
import {resolveCommand, type ProviderInstall} from '../providers/providers.js';

/**
 * Typed package-manager install plans for the curated tool catalog.
 *
 * A plan is an executable plus an argv array, never a shell string. Package
 * names come from a curated per-manager table of names that differ from the
 * Homebrew formula or exist only on some distributions; a tool with no entry
 * for the detected manager has no plan, so NMSh shows it as manual instead of
 * guessing. Native Windows is not supported; WSL is Linux and uses the
 * distribution's own manager.
 *
 * Privilege: Homebrew never needs elevation. The other managers do. NMSh
 * never embeds passwords or elevates quietly: as root it runs the manager
 * directly; otherwise the reviewed argv is explicitly `sudo -n ...`, which
 * only succeeds if sudo needs no password prompt, and a failed run points at
 * the exact command to run yourself.
 */
export type ManagerId = 'homebrew' | 'apt' | 'dnf' | 'pacman' | 'zypper';

export interface ManagerInfo {id: ManagerId; label: string; executable: string; elevation: 'none' | 'administrator'}
export interface PackagePlan extends ProviderInstall {
  manager: ManagerId;
  managerLabel: string;
  package: string;
  elevation: 'none' | 'administrator';
  /** Exact command to run yourself, shown when an elevated run cannot proceed. */
  manual: string;
}

const MANAGERS: Record<ManagerId, {label: string; executable: string; install: readonly string[]; elevation: 'none' | 'administrator'}> = {
  homebrew: {label: 'Homebrew', executable: 'brew', install: ['install'], elevation: 'none'},
  apt: {label: 'APT', executable: 'apt-get', install: ['install', '-y'], elevation: 'administrator'},
  dnf: {label: 'DNF', executable: 'dnf', install: ['install', '-y'], elevation: 'administrator'},
  pacman: {label: 'pacman', executable: 'pacman', install: ['-S', '--needed', '--noconfirm'], elevation: 'administrator'},
  zypper: {label: 'zypper', executable: 'zypper', install: ['--non-interactive', 'install'], elevation: 'administrator'},
};

/**
 * Distribution package names, only where they provide the same executable the
 * catalog expects. Left out on purpose: fd/bat on Debian-family (installed as
 * fdfind/batcat), kubectl, yq (several implementations), anything uncertain.
 */
const ALL = (name: string): Partial<Record<ManagerId, string>> => ({apt: name, dnf: name, pacman: name, zypper: name});
const NATIVE_PACKAGES: Record<string, Partial<Record<ManagerId, string>>> = {
  rg: ALL('ripgrep'), fzf: ALL('fzf'), jq: ALL('jq'), zoxide: ALL('zoxide'), btop: ALL('btop'),
  fd: {dnf: 'fd-find', pacman: 'fd', zypper: 'fd'},
  bat: {dnf: 'bat', pacman: 'bat', zypper: 'bat'},
  gh: {apt: 'gh', dnf: 'gh', pacman: 'github-cli', zypper: 'gh'},
  lazygit: {pacman: 'lazygit'},
  delta: {apt: 'git-delta', dnf: 'git-delta', pacman: 'git-delta'},
  shellcheck: {apt: 'shellcheck', dnf: 'ShellCheck', pacman: 'shellcheck', zypper: 'ShellCheck'},
  shfmt: {apt: 'shfmt', dnf: 'shfmt', pacman: 'shfmt'},
  hyperfine: {apt: 'hyperfine', dnf: 'hyperfine', pacman: 'hyperfine'},
  just: {apt: 'just', dnf: 'just', pacman: 'just'},
};

export interface PackageEnvironment {
  platform: NodeJS.Platform;
  /** Contents of /etc/os-release, when readable. */
  osRelease?: string;
  has(command: string): boolean;
  isRoot: boolean;
}

export function systemPackageEnvironment(): PackageEnvironment {
  let osRelease: string | undefined;
  try { osRelease = readFileSync('/etc/os-release', 'utf8').slice(0, 4096); } catch { /* not Linux or unreadable */ }
  return {platform: process.platform, ...(osRelease === undefined ? {} : {osRelease}), has: command => resolveCommand(command) !== undefined,
    isRoot: typeof process.getuid === 'function' && process.getuid() === 0};
}

/** Distribution family from os-release ID / ID_LIKE; unknown distributions get no native manager. */
export function distroManager(osRelease: string | undefined): Exclude<ManagerId, 'homebrew'> | undefined {
  if (!osRelease) return undefined;
  const field = (key: string) => new RegExp(`^${key}=("?)([^"\\n]*)\\1$`, 'mu').exec(osRelease)?.[2]?.toLowerCase() ?? '';
  const ids = `${field('ID')} ${field('ID_LIKE')}`.split(/\s+/u);
  if (ids.some(id => ['debian', 'ubuntu'].includes(id))) return 'apt';
  if (ids.some(id => ['fedora', 'rhel', 'centos'].includes(id))) return 'dnf';
  if (ids.some(id => ['arch', 'archlinux'].includes(id))) return 'pacman';
  if (ids.some(id => ['suse', 'opensuse', 'opensuse-leap', 'opensuse-tumbleweed'].includes(id))) return 'zypper';
  return undefined;
}

/** Managers usable here, in preference order: the distribution's own, then Homebrew. */
export function availableManagers(env: PackageEnvironment): ManagerInfo[] {
  const order: ManagerId[] = [];
  if (env.platform === 'linux') { const native = distroManager(env.osRelease); if (native) order.push(native); }
  if (env.platform === 'darwin' || env.platform === 'linux') order.push('homebrew');
  return order.filter(id => env.has(MANAGERS[id].executable))
    .map(id => ({id, label: MANAGERS[id].label, executable: MANAGERS[id].executable, elevation: MANAGERS[id].elevation}));
}

/** Package name for a catalog tool under one manager; Homebrew uses the catalog formula. */
function packageFor(tool: {id: string; package?: string}, manager: ManagerId): string | undefined {
  return manager === 'homebrew' ? tool.package : NATIVE_PACKAGES[tool.id]?.[manager];
}

/**
 * The first available manager with a verified mapping for this tool, as an
 * exact argv. Undefined means "install manually" (see `planUnavailableReason`).
 */
export function planPackageInstall(tool: {id: string; package?: string; legacy?: boolean}, env: PackageEnvironment = systemPackageEnvironment()): PackagePlan | undefined {
  if (tool.legacy) return undefined;
  for (const manager of availableManagers(env)) {
    const name = packageFor(tool, manager.id);
    if (!name) continue;
    const spec = MANAGERS[manager.id];
    const base = [spec.executable, ...spec.install, name];
    const elevated = spec.elevation === 'administrator' && !env.isRoot;
    const argv = elevated ? ['sudo', '-n', ...base] : base;
    return {label: argv.join(' '), command: argv[0]!, args: argv.slice(1), manager: manager.id, managerLabel: manager.label, package: name,
      elevation: spec.elevation, manual: elevated ? ['sudo', ...base].join(' ') : base.join(' ')};
  }
  return undefined;
}

export function planUnavailableReason(tool: {id: string; label: string; package?: string}, env: PackageEnvironment = systemPackageEnvironment()): string {
  if (env.platform === 'win32') return 'Native Windows is not supported. Run NMSh inside WSL and use that distribution\'s package manager.';
  const managers = availableManagers(env);
  if (!managers.length) {
    const native = env.platform === 'linux' ? distroManager(env.osRelease) : undefined;
    return native ? `${MANAGERS[native].label} was not found. Install ${tool.label} yourself.`
      : env.platform === 'linux' ? `NMSh did not recognise a supported package manager (APT, DNF, pacman, zypper or Homebrew). Install ${tool.label} yourself.`
      : `Homebrew is not installed. Install ${tool.label} yourself.`;
  }
  return `NMSh has no verified ${managers.map(manager => manager.label).join(' / ')} package for ${tool.label}; it does not guess package names. Install it yourself.`;
}

/** Reviewed-plan sentence about privilege, shown before the confirmation. */
export function elevationNote(plan: Pick<PackagePlan, 'elevation' | 'command' | 'manual'>): string | undefined {
  if (plan.elevation === 'none') return undefined;
  return plan.command === 'sudo'
    ? `Needs administrator rights. This runs with sudo -n (no password prompt); if sudo asks for a password it fails safely and you can run: ${plan.manual}`
    : 'Needs administrator rights; NMSh is running as root.';
}
