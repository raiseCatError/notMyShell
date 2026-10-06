import {arch, freemem, hostname, platform, release, totalmem, userInfo} from 'node:os';
import {defineCapability, type CapabilityDefinition} from '../capability.js';
import {parseXmlData, readMetadataText, record} from '../services.js';
import {runExternal} from '../../providers/providers.js';
import {linuxBattery, parseMeminfo, parsePmset, parseVmStat} from '../../status/systemStats.js';

/**
 * Machine and session facts. Readers are OS metadata files and fixed system
 * tools at fixed paths (`/usr/bin/vm_stat`, `/usr/bin/pmset` on macOS) shared
 * with the Status Strip's parsers; time-based facts refresh only while a
 * visible module asks for them.
 */

export interface OsFact {platform: string; name: string; version?: string; arch: string; kernel: string}

async function osName(): Promise<{name: string; version?: string}> {
  if (process.platform === 'darwin') {
    const plist = await parseXmlData(await readMetadataText('/System/Library/CoreServices/SystemVersion.plist', 16 * 1024));
    const dict = record(plist) && record(plist.plist) && record(plist.plist.dict) ? plist.plist.dict : undefined;
    const keys = Array.isArray(dict?.key) ? dict.key : [], values = Array.isArray(dict?.string) ? dict.string : [];
    const field = (name: string) => { const index = keys.indexOf(name); return typeof values[index] === 'string' ? values[index] as string : undefined; };
    return {name: field('ProductName') ?? 'macOS', ...(field('ProductVersion') ? {version: field('ProductVersion')!} : {})};
  }
  if (process.platform === 'linux') {
    const content = await readMetadataText('/etc/os-release', 16 * 1024) ?? '';
    const field = (name: string) => new RegExp(`^${name}=("?)([^"\\n]{1,64})\\1$`, 'mu').exec(content)?.[2];
    return {name: field('NAME') ?? 'Linux', ...(field('VERSION_ID') ? {version: field('VERSION_ID')!} : {})};
  }
  return {name: platform()};
}

export const operatingSystem = defineCapability<OsFact>({
  id: 'system.os', title: 'Operating system',
  reads: ['macOS SystemVersion.plist or /etc/os-release', 'Node.js platform, architecture and kernel release'],
  scope: 'machine', family: 'system', cost: 'bounded-async', trust: 'session', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['platform', 'name', 'version', 'arch', 'kernel'], env: [], ttlMs: 3_600_000, timeoutMs: 1000, invalidateOn: [],
  preview: {platform: 'darwin', name: 'macOS', version: '26.1', arch: 'arm64', kernel: '25.1.0'},
  async resolve() {
    const named = await osName();
    return {value: {platform: platform(), ...named, arch: arch(), kernel: release()}, evidence: 'OS release metadata'};
  },
});

export interface UserFact {user: string; host: string; root: boolean; ssh: boolean}

export const sessionUser = defineCapability<UserFact>({
  id: 'session.user', title: 'User, host and remote session',
  reads: ['the local user name and host name', 'SSH_CONNECTION / SSH_CLIENT / SSH_TTY presence (never the client address)'],
  scope: 'machine', family: 'system', cost: 'cheap', trust: 'session', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['user', 'host', 'root', 'ssh'], env: ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY'], ttlMs: 3_600_000, timeoutMs: 500, invalidateOn: [],
  preview: {user: 'cat', host: 'workstation', root: false, ssh: true},
  async resolve(context) {
    let user = 'unknown';
    try { user = userInfo().username; } catch { /* no passwd entry */ }
    const ssh = ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY'].some(name => context.env.present.has(name));
    return {value: {user, host: hostname().split('.')[0] || hostname(), root: process.getuid?.() === 0, ssh}, evidence: ssh ? 'SSH session variables' : 'local session'};
  },
});

export interface JobsFact {count: number}

export const sessionJobs = defineCapability<JobsFact>({
  id: 'session.jobs', title: 'Background and stopped jobs',
  reads: ['the job count the live shell reports with each prompt'],
  scope: 'session', family: 'system', cost: 'cheap', trust: 'session', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['count'], env: [], ttlMs: 60_000, timeoutMs: 200, invalidateOn: ['command'],
  preview: {count: 2},
  async resolve(context) {
    const count = context.live?.jobs;
    return count === undefined || count <= 0 ? undefined : {value: {count}, evidence: 'shell job table'};
  },
});

export interface DurationFact {startedAt: number}

export const sessionDuration = defineCapability<DurationFact>({
  id: 'session.duration', title: 'Session duration',
  reads: ['when this NMSh session started'],
  scope: 'session', family: 'system', cost: 'cheap', trust: 'session', sensitivity: 'public', persistence: 'display-only',
  fields: ['startedAt'], env: [], ttlMs: 3_600_000, refreshMs: 60_000, timeoutMs: 200, invalidateOn: [],
  preview: {startedAt: 0},
  async resolve(context) {
    const startedAt = context.live?.startedAt;
    return startedAt ? {value: {startedAt}, evidence: 'session start'} : undefined;
  },
});

export interface TimeFact {now: number}

export const clock = defineCapability<TimeFact>({
  id: 'system.time', title: 'Clock',
  reads: ['the local clock'],
  scope: 'machine', family: 'system', cost: 'cheap', trust: 'session', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['now'], env: [], ttlMs: 10_000, refreshMs: 10_000, timeoutMs: 200, invalidateOn: [],
  preview: {now: Date.UTC(2026, 9, 6, 9, 41)},
  async resolve(context) { return {value: {now: context.now}, evidence: 'local clock'}; },
});

export interface MemoryFact {usedPercent: number; usedBytes: number; totalBytes: number}

export const memory = defineCapability<MemoryFact>({
  id: 'system.memory', title: 'Memory use',
  reads: ['/usr/bin/vm_stat (macOS) or /proc/meminfo (Linux), as the Status Strip does'],
  scope: 'machine', family: 'system', cost: 'probe', trust: 'session', sensitivity: 'public', persistence: 'display-only',
  fields: ['usedPercent', 'usedBytes', 'totalBytes'], env: [], ttlMs: 10_000, refreshMs: 10_000, timeoutMs: 1500, invalidateOn: [],
  preview: {usedPercent: 62, usedBytes: 21.4 * 1024 ** 3, totalBytes: 36 * 1024 ** 3},
  async resolve(context) {
    const total = totalmem();
    let used: {used: number; total: number} | undefined = {used: total - freemem(), total};
    if (process.platform === 'darwin') {
      const result = await runExternal('/usr/bin/vm_stat', [], {timeoutMs: 1000, maxBytes: 16 * 1024, signal: context.signal, env: {PATH: '/usr/bin:/bin', LANG: 'C'}});
      used = (result.ok ? parseVmStat(result.stdout, total) : undefined) ?? used;
    } else if (process.platform === 'linux') {
      used = parseMeminfo(await readMetadataText('/proc/meminfo', 64 * 1024).then(text => text ?? '', () => '')) ?? used;
    }
    if (!used || used.total <= 0) return undefined;
    return {value: {usedPercent: Math.round(100 * used.used / used.total), usedBytes: used.used, totalBytes: used.total}, evidence: process.platform === 'darwin' ? 'vm_stat' : 'meminfo'};
  },
});

export interface BatteryFact {percent: number; charging: boolean}

export const battery = defineCapability<BatteryFact>({
  id: 'system.battery', title: 'Battery',
  reads: ['/usr/bin/pmset -g batt (macOS) or /sys/class/power_supply (Linux); machines without a battery report nothing'],
  scope: 'machine', family: 'system', cost: 'probe', trust: 'session', sensitivity: 'public', persistence: 'display-only',
  fields: ['percent', 'charging'], env: [], ttlMs: 60_000, refreshMs: 60_000, timeoutMs: 1500, invalidateOn: [],
  preview: {percent: 81, charging: false},
  async resolve(context) {
    let state: BatteryFact | undefined;
    if (process.platform === 'darwin') {
      const result = await runExternal('/usr/bin/pmset', ['-g', 'batt'], {timeoutMs: 1000, maxBytes: 8 * 1024, signal: context.signal, env: {PATH: '/usr/bin:/bin', LANG: 'C'}});
      state = result.ok ? parsePmset(result.stdout) : undefined;
    } else if (process.platform === 'linux') state = linuxBattery();
    return state ? {value: state, evidence: process.platform === 'darwin' ? 'pmset' : 'power_supply'} : undefined;
  },
});

export const SYSTEM_CAPABILITIES = [operatingSystem, sessionUser, sessionJobs, sessionDuration, clock, memory, battery] as CapabilityDefinition<unknown>[];
