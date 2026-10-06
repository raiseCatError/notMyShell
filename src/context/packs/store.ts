import {randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {chmod, mkdir, open, readdir, rename, rm} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {nmshConfigDirectory} from '../../configuration/paths.js';
import {CORE_CAPABILITIES} from '../registry.js';
import {MAX_PACK_BYTES, parsePack, satisfiesRange, type ParsedPack, type PackProblem} from './schema.js';

/**
 * Local Context Pack lifecycle: explicit install from a file, verify, enable,
 * disable, remove. There is no network transport and no registry download:
 * a pack arrives only because a person chose a local file. Installation is
 * staged and atomic, the exact bytes and their sha256 are recorded, and every
 * load re-verifies the hash, so a manifest edited on disk is reported, not
 * trusted. The `nmsh.` namespace is reserved for packs bundled with NMSh.
 * Nothing here enables a module; enabling modules is a separate explicit
 * choice in /prompt or `nmsh packs enable`.
 */

export interface InstalledPackRecord {
  id: string;
  version: string;
  sha256: string;
  /** File name inside the packs directory. */
  file: string;
  /** Where the person installed it from (display only; never read again). */
  source: string;
  installedAt: string;
  enabled: boolean;
}

interface PackRegistry {schema: 1; packs: InstalledPackRecord[]}

export type PackState = 'enabled' | 'disabled' | 'missing-file' | 'integrity-failed' | 'invalid' | 'unsupported' | 'incompatible';

export interface InstalledPackStatus {
  record: InstalledPackRecord;
  state: PackState;
  message?: string;
  parsed?: ParsedPack;
}

const REGISTRY = 'installed.json';
const RECORD_FILE = /^[a-z][a-z0-9.-]{1,160}@[0-9A-Za-z.+-]{1,48}\.json$/u;

export function packsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'context-packs');
}

const capabilityMap = () => new Map(CORE_CAPABILITIES.map(capability => [capability.id, capability]));

/** A bounded read of an explicitly chosen manifest: a regular file (symlinks refused), at most 64 KiB. */
export async function readManifest(path: string): Promise<{bytes: Buffer} | {error: string}> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile()) return {error: 'not a regular file'};
    if (info.size > MAX_PACK_BYTES) return {error: `larger than ${MAX_PACK_BYTES / 1024} KiB`};
    const bytes = await file.readFile();
    return bytes.length > MAX_PACK_BYTES ? {error: `larger than ${MAX_PACK_BYTES / 1024} KiB`} : {bytes};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {error: code === 'ELOOP' || code === 'EMLINK' ? 'symbolic links are not accepted; pass the file itself' : code === 'ENOENT' ? 'no such file' : 'unreadable'};
  } finally { await file?.close().catch(() => {}); }
}

export type InspectResult = {ok: true; parsed: ParsedPack} | {ok: false; problem: PackProblem; sha256?: string};

/** Validate without installing (`nmsh packs inspect`). */
export async function inspectPack(path: string, nmshVersion: string): Promise<InspectResult> {
  const read = await readManifest(path);
  if ('error' in read) return {ok: false, problem: {kind: 'invalid', message: read.error}};
  const result = parsePack(read.bytes, capabilityMap());
  if (!result.ok) return {ok: false, problem: result.problem, ...(result.sha256 ? {sha256: result.sha256} : {})};
  if (!satisfiesRange(nmshVersion, result.parsed.pack.compatibility.nmsh)) {
    return {ok: false, sha256: result.parsed.sha256, problem: {kind: 'unsupported', message: `needs NMSh ${result.parsed.pack.compatibility.nmsh}; this is ${nmshVersion}`}};
  }
  return result;
}

async function readRegistry(directory: string): Promise<PackRegistry> {
  const read = await readManifest(join(directory, REGISTRY));
  if ('error' in read) {
    if (read.error === 'no such file') return {schema: 1, packs: []};
    throw new Error(`The Context Pack registry ${join(directory, REGISTRY)} is ${read.error}; it was left unchanged.`);
  }
  let data: unknown;
  try { data = JSON.parse(read.bytes.toString('utf8')) as unknown; } catch { throw new Error(`The Context Pack registry ${join(directory, REGISTRY)} is not valid JSON; it was left unchanged.`); }
  const packs = typeof data === 'object' && data !== null && Array.isArray((data as {packs?: unknown}).packs) ? (data as {packs: unknown[]}).packs : [];
  return {schema: 1, packs: packs.flatMap(item => {
    const record = item as Partial<InstalledPackRecord>;
    return typeof record.id === 'string' && typeof record.version === 'string' && typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(record.sha256)
      && typeof record.file === 'string' && RECORD_FILE.test(record.file) && typeof record.enabled === 'boolean'
      ? [{id: record.id, version: record.version, sha256: record.sha256, file: record.file, enabled: record.enabled,
        source: typeof record.source === 'string' ? record.source.slice(0, 256) : '', installedAt: typeof record.installedAt === 'string' ? record.installedAt.slice(0, 40) : ''}]
      : [];
  }).slice(0, 64)};
}

/** Staged write + rename: readers see the old or the new file, never a partial one. */
async function writeAtomic(path: string, content: string | Buffer): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally { await file.close(); }
  await rename(temporary, path);
}

async function writeRegistry(directory: string, registry: PackRegistry): Promise<void> {
  await writeAtomic(join(directory, REGISTRY), `${JSON.stringify(registry, null, 2)}\n`);
}

async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700).catch(() => {});
}

/** Every installed pack with its verified state. Bundled first-party packs are not listed here. */
export async function installedPackStatuses(directory = packsDirectory(), nmshVersion = '0.0.0'): Promise<InstalledPackStatus[]> {
  let registry: PackRegistry;
  try { registry = await readRegistry(directory); } catch { return []; }
  const capabilities = capabilityMap();
  return Promise.all(registry.packs.map(async record => {
    const read = await readManifest(join(directory, record.file));
    if ('error' in read) return {record, state: 'missing-file' as const, message: `manifest ${read.error}`};
    const result = parsePack(read.bytes, capabilities);
    const sha256 = result.ok ? result.parsed.sha256 : result.sha256;
    if (sha256 !== record.sha256) return {record, state: 'integrity-failed' as const, message: 'the manifest changed after it was installed; reinstall it to trust the new content'};
    if (!result.ok) return {record, state: result.problem.kind === 'unsupported' ? 'unsupported' as const : 'invalid' as const, message: result.problem.message};
    if (result.parsed.pack.id !== record.id || result.parsed.pack.version !== record.version) return {record, state: 'integrity-failed' as const, message: 'identity does not match its record'};
    if (!satisfiesRange(nmshVersion, result.parsed.pack.compatibility.nmsh)) {
      return {record, state: 'incompatible' as const, message: `needs NMSh ${result.parsed.pack.compatibility.nmsh}`, parsed: result.parsed};
    }
    return {record, state: record.enabled ? 'enabled' as const : 'disabled' as const, parsed: result.parsed};
  }));
}

/** Packs whose modules may join the catalog: verified, supported and enabled. */
export async function activeInstalledPacks(directory = packsDirectory(), nmshVersion = '0.0.0'): Promise<ParsedPack[]> {
  return (await installedPackStatuses(directory, nmshVersion)).flatMap(status => status.state === 'enabled' && status.parsed ? [status.parsed] : []);
}

export type InstallOutcome =
  | {ok: true; parsed: ParsedPack; replaced?: string}
  | {ok: false; reason: string; conflict?: {installedVersion: string}};

/**
 * Install exactly the bytes that were validated. `expectedSha256` pins the
 * content a person reviewed (a checksum proves the bytes, not the author).
 * Replacing an installed version requires `replace`.
 */
export async function installPack(path: string, options: {directory?: string; nmshVersion: string; expectedSha256?: string; replace?: boolean; now?: Date}): Promise<InstallOutcome> {
  const directory = options.directory ?? packsDirectory();
  const read = await readManifest(path);
  if ('error' in read) return {ok: false, reason: `Cannot read ${basename(path)}: ${read.error}.`};
  const result = parsePack(read.bytes, capabilityMap());
  if (!result.ok) return {ok: false, reason: `${result.problem.kind === 'unsupported' ? 'Unsupported' : 'Invalid'} Context Pack: ${result.problem.message}.`};
  const {pack, sha256} = result.parsed;
  if (options.expectedSha256 && options.expectedSha256.toLowerCase() !== sha256) return {ok: false, reason: `sha256 ${sha256} does not match the expected ${options.expectedSha256}; nothing was installed.`};
  if (pack.id.startsWith('nmsh.')) return {ok: false, reason: `The nmsh.* namespace is reserved for packs bundled with NMSh; ${pack.id} was not installed.`};
  if (!satisfiesRange(options.nmshVersion, pack.compatibility.nmsh)) return {ok: false, reason: `${pack.id} needs NMSh ${pack.compatibility.nmsh}; this is ${options.nmshVersion}.`};
  await ensureDirectory(directory);
  const registry = await readRegistry(directory);
  const existing = registry.packs.find(record => record.id === pack.id);
  if (existing && existing.version !== pack.version && !options.replace) return {ok: false, reason: `${pack.id} ${existing.version} is installed; replace it explicitly to install ${pack.version}.`, conflict: {installedVersion: existing.version}};
  // Identical bytes still rewrite the manifest: reinstalling is how a tampered or missing file is repaired.
  const file = `${pack.id}@${pack.version}.json`;
  if (!RECORD_FILE.test(file)) return {ok: false, reason: 'The pack identity cannot be stored safely.'};
  await writeAtomic(join(directory, file), read.bytes);
  const record: InstalledPackRecord = {id: pack.id, version: pack.version, sha256, file, source: basename(path).slice(0, 256),
    installedAt: existing?.sha256 === sha256 ? existing.installedAt : (options.now ?? new Date()).toISOString(), enabled: existing?.enabled ?? true};
  await writeRegistry(directory, {schema: 1, packs: [...registry.packs.filter(item => item.id !== pack.id), record].sort((a, b) => a.id.localeCompare(b.id))});
  if (existing && existing.file !== file) await rm(join(directory, existing.file), {force: true});
  await pruneOrphans(directory);
  return {ok: true, parsed: result.parsed, ...(existing && existing.version !== pack.version ? {replaced: existing.version} : {})};
}

/** Deregister first, then delete: a crash leaves at most an unregistered file, which is never loaded and is pruned later. */
export async function removePack(id: string, directory = packsDirectory()): Promise<{ok: boolean; reason?: string}> {
  const registry = await readRegistry(directory);
  const existing = registry.packs.find(record => record.id === id);
  if (!existing) return {ok: false, reason: `${id} is not installed.`};
  await writeRegistry(directory, {schema: 1, packs: registry.packs.filter(record => record.id !== id)});
  await rm(join(directory, existing.file), {force: true});
  return {ok: true};
}

export async function setPackEnabled(id: string, enabled: boolean, directory = packsDirectory()): Promise<{ok: boolean; reason?: string}> {
  const registry = await readRegistry(directory);
  const existing = registry.packs.find(record => record.id === id);
  if (!existing) return {ok: false, reason: `${id} is not installed.`};
  await writeRegistry(directory, {schema: 1, packs: registry.packs.map(record => record.id === id ? {...record, enabled} : record)});
  return {ok: true};
}

/** Remove unregistered manifests and abandoned staging files inside the NMSh-owned packs directory only. */
async function pruneOrphans(directory: string): Promise<void> {
  const registry = await readRegistry(directory);
  const registered = new Set(registry.packs.map(record => record.file));
  let names: string[] = [];
  try { names = (await readdir(directory)).slice(0, 1024); } catch { return; }
  for (const name of names) {
    if ((RECORD_FILE.test(name) && !registered.has(name)) || /\.\d+\.[a-f0-9]{8}\.tmp$/u.test(name)) await rm(join(directory, name), {force: true}).catch(() => {});
  }
}
