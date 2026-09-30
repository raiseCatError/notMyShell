import {spawn} from 'node:child_process';
import {accessSync, constants} from 'node:fs';
import {delimiter, join} from 'node:path';

/**
 * Shared provider metadata, status and fallback. Each family keeps its own
 * runtime interface (prompt render, welcome render, suggestion query, ...);
 * this module only describes providers and how their availability looks.
 */
export type ProviderFamily = 'prompt' | 'welcome' | 'suggestions' | 'history';
export type ProviderKind = 'native' | 'external' | 'none';

export interface ProviderInstall {
  /** Human-readable command, e.g. `brew install fastfetch`. */
  label: string;
  command: string;
  args: readonly string[];
}

export interface ProviderDescriptor<Id extends string = string> {
  id: Id;
  family: ProviderFamily;
  label: string;
  kind: ProviderKind;
  description: string;
  /** Executable looked up on PATH for external providers. */
  executable?: string;
  versionArgs?: readonly string[];
  /** Upstream is archived; kept for compatibility, never recommended. */
  legacy?: boolean;
  /** Offered only with explicit confirmation. */
  install?: ProviderInstall;
  /** One-line setup note shown while the provider is highlighted. */
  setup?: string;
}

export type ProviderState = 'builtin' | 'installed' | 'missing' | 'unhealthy';

export interface ProviderStatus {
  state: ProviderState;
  binary?: string;
  version?: string;
  detail?: string;
}

export const BUILTIN_STATUS: ProviderStatus = {state: 'builtin'};

export function findExecutable(name: string, pathValue = process.env.PATH ?? ''): string | undefined {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  return undefined;
}

/**
 * Package-manager prefixes NMSh also checks when the frontend's PATH lacks
 * them (e.g. launched from a GUI whose environment never ran `brew shellenv`):
 * Apple Silicon Homebrew, Intel Homebrew, Linuxbrew. Only fixed, well-known
 * install locations; never anything user- or network-supplied.
 */
export const STANDARD_TOOL_DIRECTORIES: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin'];

/**
 * The one executable resolver for NMSh-owned tasks and provider detection:
 * PATH first, then the standard package-manager prefixes. Returns an absolute
 * path to spawn with argv, or undefined when the tool genuinely is missing.
 */
export function resolveCommand(name: string, pathValue = process.env.PATH ?? '',
  fallbacks: readonly string[] = STANDARD_TOOL_DIRECTORIES): string | undefined {
  if (name.includes('/')) {
    try { accessSync(name, constants.X_OK); return name; } catch { return undefined; }
  }
  return findExecutable(name, pathValue) ?? findExecutable(name, fallbacks.join(delimiter));
}

/** PATH for a spawned tool: the tool's own directory first, so e.g. brew finds its siblings. */
export function environmentFor(binary: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const directory = binary.slice(0, binary.lastIndexOf('/'));
  const path = env.PATH ?? '';
  return directory && !path.split(delimiter).includes(directory) ? {...env, PATH: [directory, path].filter(Boolean).join(delimiter)} : env;
}

export interface ExternalResult {
  ok: boolean;
  stdout: string;
  error?: string;
}

/**
 * Runs an external provider: argv only (no shell), no stdin, a hard timeout
 * and bounded output. It runs in its own process group (detached from the
 * host TTY) so a timeout kills everything it started. Never throws.
 */
export function runExternal(binary: string, args: readonly string[], options: {timeoutMs?: number; maxBytes?: number;
  env?: NodeJS.ProcessEnv; cwd?: string; signal?: AbortSignal} = {}): Promise<ExternalResult> {
  if (options.signal?.aborted) return Promise.resolve({ok: false, stdout: '', error: 'cancelled'});
  const maxBytes = options.maxBytes ?? 256 * 1024;
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, [...args], {cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'ignore'], detached: true});
    } catch (error) {
      resolve({ok: false, stdout: '', error: error instanceof Error ? error.message : String(error)});
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: ExternalResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
      }
      resolve(result);
    };
    const abort = () => finish({ok: false, stdout: '', error: 'cancelled'});
    const timer = setTimeout(() => finish({ok: false, stdout: '', error: 'timed out'}), options.timeoutMs ?? 2000);
    options.signal?.addEventListener('abort', abort, {once: true});
    if (options.signal?.aborted) abort();
    child.stdout!.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) finish({ok: false, stdout: '', error: 'output too large'});
      else chunks.push(chunk);
    });
    child.on('error', error => finish({ok: false, stdout: '', error: error.message}));
    child.on('close', code => {
      const stdout = Buffer.concat(chunks).toString('utf8');
      finish(code === 0 ? {ok: true, stdout} : {ok: false, stdout, error: `exited with ${code}`});
    });
  });
}

const detectionCache = new Map<string, Promise<ProviderStatus>>();

/** Cheap, cached, async detection: PATH lookup plus a bounded version probe. */
export function detectProvider(descriptor: ProviderDescriptor, pathValue = process.env.PATH ?? ''): Promise<ProviderStatus> {
  if (descriptor.kind !== 'external' || !descriptor.executable) return Promise.resolve(BUILTIN_STATUS);
  const key = `${descriptor.executable}\u0000${pathValue}`;
  const cached = detectionCache.get(key);
  if (cached) return cached;
  const pending = (async (): Promise<ProviderStatus> => {
    const binary = resolveCommand(descriptor.executable!, pathValue);
    if (!binary) return {state: 'missing'};
    if (!descriptor.versionArgs) return {state: 'installed', binary};
    const result = await runExternal(binary, descriptor.versionArgs, {timeoutMs: 1500, maxBytes: 16 * 1024});
    const version = result.stdout.split('\n').find(line => line.trim())?.trim().slice(0, 60);
    return {state: 'installed', binary, ...(version ? {version} : {})};
  })();
  detectionCache.set(key, pending);
  return pending;
}

/** Forget cached detection, e.g. after an install completes. */
export function clearProviderDetection(): void {
  detectionCache.clear();
}

export function providerStatusLabel(descriptor: ProviderDescriptor, status: ProviderStatus | undefined): string {
  if (descriptor.kind === 'native') return 'Native';
  if (descriptor.kind === 'none') return 'Off';
  if (!status) return 'Checking…';
  const legacy = descriptor.legacy ? ' · legacy' : '';
  switch (status.state) {
    case 'installed': return `${status.version ?? 'Installed'}${legacy}`;
    case 'missing': return `Not installed${legacy}`;
    case 'unhealthy': return `Unavailable${status.detail ? ` · ${status.detail}` : ''}`;
    default: return 'Built in';
  }
}

export function providerUsable(descriptor: ProviderDescriptor, status: ProviderStatus | undefined): boolean {
  return descriptor.kind !== 'external' || status?.state === 'installed';
}

/**
 * The provider a family should actually use: the selection when usable,
 * otherwise the fallback with a factual notice.
 */
export function resolveProvider<Id extends string>(providers: readonly ProviderDescriptor<Id>[], selected: Id,
  status: ProviderStatus | undefined, fallback: Id): {id: Id; notice?: string} {
  const descriptor = providers.find(provider => provider.id === selected);
  if (!descriptor) return {id: fallback};
  if (providerUsable(descriptor, status)) return {id: selected};
  const fallbackLabel = providers.find(provider => provider.id === fallback)?.label ?? fallback;
  const reason = status?.state === 'unhealthy' ? `unavailable${status.detail ? ` (${status.detail})` : ''}` : 'not installed';
  return {id: fallback, notice: `${descriptor.label} is ${reason}; using ${fallbackLabel}.`};
}

/** One provider list row, shared by every family's selection UI. */
export function providerRowText(descriptor: ProviderDescriptor, options: {draft?: string; saved?: string; status?: ProviderStatus | 'none'}): string {
  const badge = options.status === 'none' ? '' : `  [${providerStatusLabel(descriptor, options.status)}]`;
  return `${descriptor.label} · ${descriptor.description}${badge}`
    + `${options.draft === descriptor.id ? '  ●' : ''}${options.saved === descriptor.id ? '  ✓ saved' : ''}`;
}
