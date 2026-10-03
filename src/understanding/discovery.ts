import {readdirSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, join} from 'node:path';
import {resolveCommand} from '../providers/providers.js';
import type {LocalModelChoice, LocalRuntimeKind} from '../prompt/configuration.js';
import {FILE_TYPES, readGgufMetadata, type GgufMetadata} from './gguf.js';

/**
 * LocalModelDiscovery: what already exists on this machine, found locally
 * and boundedly. Known runtime executables, known model directories (never a
 * crawl of the home directory), and the local APIs of runtimes that are
 * already running (127.0.0.1 only). Nothing is loaded, downloaded or sent.
 */
export interface FoundRuntime {
  kind: LocalRuntimeKind;
  label: string;
  executable?: string;
  /** A local API answered: the runtime is running now. */
  running: boolean;
}

export type Suitability = 'recommended' | 'compatible' | 'large' | 'unsuitable';

export interface FoundModel {
  label: string;
  runtime: LocalRuntimeKind;
  path?: string;
  name?: string;
  bytes?: number;
  quantization?: string;
  parametersB?: number;
  family?: string;
  suitability: Suitability;
  reason: string;
  /** NMSh downloaded it into its own model directory. */
  owned: boolean;
}

export interface DiscoveryAdapters {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  which: (name: string) => string | undefined;
  listDirectory: (path: string) => Array<{name: string; directory: boolean}>;
  size: (path: string) => number | undefined;
  gguf: (path: string) => GgufMetadata | undefined;
  /** GET a local runtime API (127.0.0.1 only); undefined when nothing answers. */
  localJson: (url: string, timeoutMs: number) => Promise<unknown>;
}

const MAX_MODEL_FILES = 200;
const MAX_DEPTH = 5;

export function nmshModelDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'nmsh', 'models');
}

/** The only places model files are looked for: well-known runtime caches and NMSh's own directory. */
export function knownModelDirectories(adapters: Pick<DiscoveryAdapters, 'home' | 'env' | 'platform'>): string[] {
  const {home, env, platform} = adapters;
  const directories = [nmshModelDirectory(env, home)];
  if (env.LLAMA_CACHE) directories.push(env.LLAMA_CACHE);
  directories.push(platform === 'darwin' ? join(home, 'Library', 'Caches', 'llama.cpp') : join(env.XDG_CACHE_HOME || join(home, '.cache'), 'llama.cpp'));
  directories.push(join(home, '.lmstudio', 'models'), join(home, '.cache', 'lm-studio', 'models'));
  directories.push(join(env.HF_HOME || join(home, '.cache', 'huggingface'), 'hub'));
  directories.push(platform === 'darwin' ? join(home, 'Library', 'Application Support', 'nomic.ai', 'GPT4All') : join(home, '.local', 'share', 'nomic.ai', 'GPT4All'));
  return [...new Set(directories)];
}

/** "0.6B", "751.63M", "Qwen3-0.6B-Q4_K_M" → billions of parameters. */
export function parameterBillions(...texts: Array<string | undefined>): number | undefined {
  for (const text of texts) {
    const match = /(\d+(?:\.\d+)?)\s*([bm])\b/iu.exec(text?.replace(/[-_]/gu, ' ') ?? '');
    if (match) return Number(match[1]) / (match[2]!.toLowerCase() === 'm' ? 1000 : 1);
  }
  return undefined;
}

const INSTRUCT_FAMILIES = /^(?:qwen\d*|llama|gemma\d*|phi\d*|mistral|granite|smollm\d*|olmo\d*|exaone|deepseek\d*)/iu;
const NOT_LANGUAGE = /\b(?:embed|embedding|bert|nomic|rerank|clip|mmproj|whisper|vision)\b|^(?:bert|nomic-bert|jina-bert|clip)/iu;

/** The compatibility contract for NMSh's small structured tasks; never "any model will do". */
export function assessModel(model: {family?: string; label: string; parametersB?: number; bytes?: number; visionProjector?: boolean}): {suitability: Suitability; reason: string} {
  const family = model.family ?? '';
  if (model.visionProjector || NOT_LANGUAGE.test(family) || NOT_LANGUAGE.test(model.label.replace(/[-_.]/gu, ' '))) {
    return {suitability: 'unsuitable', reason: 'not a text instruction model (embedding or vision)'};
  }
  if (family && !INSTRUCT_FAMILIES.test(family)) return {suitability: 'unsuitable', reason: `${family} is not a supported instruction model family`};
  const params = model.parametersB ?? (model.bytes ? model.bytes / 0.6e9 : undefined);
  if (params === undefined) return {suitability: 'unsuitable', reason: 'model size unknown'};
  if (params > 34) return {suitability: 'unsuitable', reason: `~${Math.round(params)}B parameters is far too large for small local tasks`};
  if (params > 4) return {suitability: 'large', reason: `~${params < 10 ? params.toFixed(1) : Math.round(params)}B parameters: works, but uses several GB of memory for tiny tasks`};
  if (/^qwen3/iu.test(family) && params <= 1.0) return {suitability: 'recommended', reason: 'Qwen3 small model: the recommended class'};
  return {suitability: 'compatible', reason: `small ${family || 'instruction'} model (~${params.toFixed(1)}B)`};
}

function findGguf(adapters: DiscoveryAdapters, root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string, depth: number) => {
    if (found.length >= MAX_MODEL_FILES || depth > MAX_DEPTH) return;
    let entries: Array<{name: string; directory: boolean}>;
    try { entries = adapters.listDirectory(directory); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.directory) walk(path, depth + 1);
      else if (/\.gguf$/iu.test(entry.name) && !/mmproj/iu.test(entry.name)) found.push(path);
      if (found.length >= MAX_MODEL_FILES) return;
    }
  };
  walk(root, 0);
  return found;
}

export async function discoverLocal(adapters: DiscoveryAdapters): Promise<{runtimes: FoundRuntime[]; models: FoundModel[]}> {
  const runtimes: FoundRuntime[] = [];
  const llama = adapters.which('llama-server');
  if (llama) runtimes.push({kind: 'llama.cpp', label: 'llama.cpp', executable: llama, running: false});
  const ollamaBinary = adapters.which('ollama');
  const ollamaTags = await adapters.localJson('http://127.0.0.1:11434/api/tags', 400);
  if (ollamaBinary || ollamaTags) runtimes.push({kind: 'ollama', label: 'Ollama', ...(ollamaBinary ? {executable: ollamaBinary} : {}), running: Boolean(ollamaTags)});
  const lms = adapters.which('lms') ?? (adapters.size(join(adapters.home, '.lmstudio', 'bin', 'lms')) ? join(adapters.home, '.lmstudio', 'bin', 'lms') : undefined);
  const lmModels = await adapters.localJson('http://127.0.0.1:1234/v1/models', 400);
  if (lms || lmModels) runtimes.push({kind: 'lmstudio', label: 'LM Studio', ...(lms ? {executable: lms} : {}), running: Boolean(lmModels)});

  const models: FoundModel[] = [];
  const owned = nmshModelDirectory(adapters.env, adapters.home);
  for (const directory of knownModelDirectories(adapters)) {
    for (const path of findGguf(adapters, directory)) {
      const meta = adapters.gguf(path);
      if (!meta) continue;
      const label = meta.name ?? basename(path).replace(/\.gguf$/iu, '');
      const quantization = meta.fileType !== undefined ? FILE_TYPES[meta.fileType] : /(?:^|[-_.])((?:I?Q\d[\w]*|F16|BF16|F32))(?:[-_.]|$)/iu.exec(basename(path))?.[1]?.toUpperCase();
      const parametersB = parameterBillions(meta.sizeLabel, basename(path), meta.name);
      const bytes = adapters.size(path);
      const assessment = assessModel({...(meta.architecture ? {family: meta.architecture} : {}), label, ...(parametersB !== undefined ? {parametersB} : {}),
        ...(bytes !== undefined ? {bytes} : {}), ...(meta.visionProjector ? {visionProjector: true} : {})});
      models.push({label: quantization && !label.includes(quantization) ? `${label} ${quantization}` : label, runtime: 'llama.cpp', path,
        ...(bytes !== undefined ? {bytes} : {}), ...(quantization ? {quantization} : {}), ...(parametersB !== undefined ? {parametersB} : {}),
        ...(meta.architecture ? {family: meta.architecture} : {}), ...assessment, owned: path.startsWith(`${owned}/`)});
    }
  }
  for (const item of (ollamaTags as {models?: Array<Record<string, unknown>>} | undefined)?.models ?? []) {
    if (typeof item.name !== 'string') continue;
    const details = (item.details ?? {}) as Record<string, unknown>;
    const family = typeof details.family === 'string' ? details.family : undefined;
    const parametersB = parameterBillions(typeof details.parameter_size === 'string' ? details.parameter_size : undefined, item.name);
    const quantization = typeof details.quantization_level === 'string' ? details.quantization_level : undefined;
    const bytes = typeof item.size === 'number' ? item.size : undefined;
    models.push({label: item.name, runtime: 'ollama', name: item.name, ...(bytes !== undefined ? {bytes} : {}), ...(quantization ? {quantization} : {}),
      ...(parametersB !== undefined ? {parametersB} : {}), ...(family ? {family} : {}),
      ...assessModel({...(family ? {family} : {}), label: item.name, ...(parametersB !== undefined ? {parametersB} : {}), ...(bytes !== undefined ? {bytes} : {})}), owned: false});
  }
  for (const item of (lmModels as {data?: Array<Record<string, unknown>>} | undefined)?.data ?? []) {
    if (typeof item.id !== 'string') continue;
    const parametersB = parameterBillions(item.id);
    const family = /^[a-z]+\d*/iu.exec(basename(item.id))?.[0];
    models.push({label: item.id, runtime: 'lmstudio', name: item.id, ...(parametersB !== undefined ? {parametersB} : {}), ...(family ? {family} : {}),
      ...assessModel({...(family ? {family} : {}), label: item.id, ...(parametersB !== undefined ? {parametersB} : {})}), owned: false});
  }
  const rank: Record<Suitability, number> = {recommended: 0, compatible: 1, large: 2, unsuitable: 3};
  models.sort((a, b) => rank[a.suitability] - rank[b.suitability] || (a.bytes ?? 0) - (b.bytes ?? 0) || a.label.localeCompare(b.label));
  return {runtimes, models};
}

export type SetupProposal =
  | {kind: 'use'; model: FoundModel; note: string}
  | {kind: 'choose-large'; model: FoundModel; note: string}
  | {kind: 'needs-runtime'; model?: FoundModel; note: string}
  | {kind: 'download'; note: string};

/**
 * What to propose, preferring what already works: a running runtime with a
 * suitable model, then an installed runtime with a suitable model file, then
 * (only if nothing suitable exists) the recommended download. A large model is
 * never chosen silently: it is offered next to the lightweight option.
 */
export function proposeSetup(found: {runtimes: FoundRuntime[]; models: FoundModel[]}): SetupProposal {
  const usable = (model: FoundModel) => model.runtime === 'llama.cpp' ? found.runtimes.some(runtime => runtime.kind === 'llama.cpp')
    : found.runtimes.some(runtime => runtime.kind === model.runtime && runtime.running);
  const small = found.models.filter(model => model.suitability === 'recommended' || model.suitability === 'compatible');
  const ready = small.find(usable);
  if (ready) return {kind: 'use', model: ready, note: `Found ${ready.label} (${ready.reason}); NMSh can use it instead of downloading another model.`};
  if (small[0]) return {kind: 'needs-runtime', model: small[0], note: `Found ${small[0].label}, but no ${small[0].runtime === 'llama.cpp' ? 'llama.cpp runtime' : `running ${small[0].runtime}`} to run it.`};
  const large = found.models.find(model => model.suitability === 'large' && usable(model));
  if (large) return {kind: 'choose-large', model: large, note: `Only a large model was found (${large.label}: ${large.reason}).`};
  return {kind: 'download', note: 'No compatible local model was found.'};
}

export function modelChoice(model: FoundModel): LocalModelChoice {
  return {label: model.label, runtime: model.runtime, owned: model.owned, ...(model.path ? {path: model.path} : {}), ...(model.name ? {name: model.name} : {})};
}

/** Real adapters: filesystem metadata and 127.0.0.1 only. */
export function systemDiscoveryAdapters(): DiscoveryAdapters {
  return {
    home: homedir(), env: process.env, platform: process.platform,
    which: name => resolveCommand(name),
    listDirectory: path => readdirSync(path, {withFileTypes: true}).map(entry => ({name: entry.name, directory: entry.isDirectory()})),
    size: path => { try { return statSync(path).size; } catch { return undefined; } },
    gguf: path => readGgufMetadata(path),
    localJson: async (url, timeoutMs) => {
      if (!/^http:\/\/127\.0\.0\.1:\d+\//u.test(url)) return undefined;
      try {
        const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs)});
        return response.ok ? await response.json() : undefined;
      } catch { return undefined; }
    },
  };
}
