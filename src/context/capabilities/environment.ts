import {dirname, isAbsolute, normalize} from 'node:path';
import {defineCapability, type CapabilityDefinition} from '../capability.js';
import {findNearest, leaf, parseTomlData, parseToolVersions, readMetadataText, record, text} from '../services.js';

/**
 * Environment and version-manager facts from declarative files and the shell's
 * own bookkeeping. NMSh never runs mise, asdf or direnv here, never sources
 * `.envrc`, and never reads `.envrc` content: whether direnv loaded a file is
 * what direnv itself recorded in the live shell (DIRENV_FILE).
 */

export interface ToolVersionsFact {
  manager: 'mise' | 'asdf' | 'tool-versions';
  config: string;
  tools: ReadonlyArray<{name: string; version: string}>;
  /** The shell has the manager activated (mise activate / asdf shims on PATH). */
  active?: boolean;
  summary?: string;
}

const MISE_CONFIGS = ['mise.toml', '.mise.toml', 'mise.local.toml', '.mise.local.toml', '.mise/config.toml', '.config/mise/config.toml', '.config/mise.toml', 'mise/config.toml'];

export const toolVersions = defineCapability<ToolVersionsFact>({
  id: 'env.toolVersions',
  title: 'Version manager tool requests (mise, asdf)',
  reads: ['nearest mise.toml (and its documented variants) or .tool-versions: the [tools] table and tool lines only', 'MISE_SHELL presence', 'PATH (asdf shims)'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['manager', 'config', 'tools', 'active', 'summary'], env: ['MISE_SHELL', 'PATH', 'ASDF_DATA_DIR'], ttlMs: 30_000, timeoutMs: 1500, invalidateOn: ['command'],
  preview: {manager: 'mise', config: 'mise.toml', tools: [{name: 'node', version: '22'}, {name: 'python', version: '3.12'}], active: true, summary: 'node 22 · python 3.12'},
  async resolve(context) {
    const found = await findNearest(context, [...MISE_CONFIGS, '.tool-versions']);
    if (!found) return undefined;
    let tools: Array<{name: string; version: string}> = [];
    if (found.name === '.tool-versions') tools = parseToolVersions(await readMetadataText(found.path));
    else {
      // Only names and literal versions from [tools]; [env], [tasks], hooks and `_.source` are never interpreted.
      const table = parseTomlData(await readMetadataText(found.path))?.tools;
      if (record(table)) for (const [name, entry] of Object.entries(table).slice(0, 32)) {
        const version = typeof entry === 'string' ? entry : Array.isArray(entry) ? entry.find(item => typeof item === 'string')
          : record(entry) ? entry.version : undefined;
        const literal = text(version, 64);
        if (/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,63}$/u.test(name) && literal) tools.push({name, version: literal});
      }
    }
    const env = context.env;
    const asdf = Boolean(env.values.ASDF_DATA_DIR) || /[/\\]\.asdf[/\\]shims(?:[:]|$)/u.test(env.values.PATH ?? '');
    const manager: ToolVersionsFact['manager'] = found.name !== '.tool-versions' ? 'mise' : env.present.has('MISE_SHELL') ? 'mise' : asdf ? 'asdf' : 'tool-versions';
    const active = manager === 'mise' ? env.present.has('MISE_SHELL') : manager === 'asdf' ? asdf : undefined;
    const summary = tools.slice(0, 3).map(tool => `${tool.name} ${tool.version}`).join(' · ') || undefined;
    return {value: {manager, config: found.name, tools: tools.slice(0, 16), ...(active !== undefined ? {active} : {}), ...(summary ? {summary} : {})},
      evidence: found.name};
  },
});

export interface DirenvFact {
  /** `loaded`: direnv recorded loading this workspace's .envrc. `pending`: an .envrc exists that direnv has not loaded (not allowed, blocked or direnv not hooked). */
  state: 'loaded' | 'pending';
  /** Directory name holding the relevant .envrc. */
  directory: string;
}

export const direnv = defineCapability<DirenvFact>({
  id: 'env.direnv',
  title: 'direnv state',
  reads: ['.envrc presence up to the repository root (never its content)', 'DIRENV_FILE and DIRENV_DIR set by direnv in the shell'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'display-only',
  fields: ['state', 'directory'], env: ['DIRENV_FILE', 'DIRENV_DIR', 'DIRENV_DIFF'], ttlMs: 30_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {state: 'loaded', directory: 'notMyShell'},
  async resolve(context) {
    const found = await findNearest(context, ['.envrc']);
    const loadedFile = context.env.values.DIRENV_FILE;
    const loaded = loadedFile && isAbsolute(loadedFile) ? normalize(loadedFile) : undefined;
    if (found && loaded === normalize(found.path)) return {value: {state: 'loaded', directory: leaf(found.directory)}, evidence: 'DIRENV_FILE matches .envrc'};
    if (found) return {value: {state: 'pending', directory: leaf(found.directory)}, evidence: '.envrc present; direnv has not loaded it in this shell'};
    if (loaded) return {value: {state: 'loaded', directory: leaf(dirname(loaded))}, evidence: 'DIRENV_FILE'};
    return undefined;
  },
});

export const ENVIRONMENT_CAPABILITIES = [toolVersions, direnv] as CapabilityDefinition<unknown>[];
