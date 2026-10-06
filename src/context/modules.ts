import {readFileSync} from 'node:fs';
import type {ContextCondition, ContextModuleConfig, ContextSurface} from '../prompt/configuration.js';
import {FACT_CAPABILITIES, type FactId} from './facts.js';
import {CORE_CAPABILITIES} from './registry.js';
import {parsePack, type ModuleCategory, type PackModule, type PackRole, type ParsedPack} from './packs/schema.js';

/**
 * The one module catalog: NMSh's built-in modules (with their purpose-built
 * renderers, such as Rich Git and path shortening) plus modules described by
 * Context Packs. First-party packs ship as JSON manifests and pass through the
 * same validator as any installed pack; core supplies their capabilities.
 * Configuration, routing, demand and /prompt all read definitions from here.
 */

export type BuiltinModuleId = 'project' | 'cwd' | 'gitBranch' | 'gitStatus' | 'toolchain' | 'exitStatus' | 'kubeContext' | 'dockerContext' | 'shell' | 'discoveredTools';
/** `<pack id>:<module id>`, e.g. `nmsh.cloud:aws`. */
export type PackModuleId = `${string}:${string}`;
export type ContextModuleId = BuiltinModuleId | PackModuleId;
export type ModuleRouteSurface = Exclude<ContextSurface, 'statusStrip'> | 'statusStrip';

export const PACK_MODULE_ID = /^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31}){1,3}:[a-z][a-z0-9-]{0,31}$/u;
export function isPackModuleId(id: string): id is PackModuleId { return PACK_MODULE_ID.test(id); }
export function packModuleId(packId: string, moduleId: string): PackModuleId { return `${packId}:${moduleId}`; }

/** Stable module identity, factual inputs, demand and presentation policy. */
export interface ContextModuleDefinition {
  id: ContextModuleId;
  label: string;
  description: string;
  category: ModuleCategory;
  /** Legacy prompt facts this module reads. */
  fields: readonly FactId[];
  /** Named capabilities (legacy names and Context Engine capability ids). */
  capabilities: readonly string[];
  /** Context Engine demand: capability id → value fields. */
  facts: ReadonlyMap<string, ReadonlySet<string>>;
  demand: string;
  priority: number;
  supportedSurfaces: readonly ContextSurface[];
  preferredSurface: ContextSurface;
  /** Conditions a person may choose for this module. */
  conditions: readonly ContextCondition[];
  /** Show-on-command words (deterministic command-word matching; never executed). */
  triggers?: readonly string[];
  icons: 'existing-semantic-glyphs' | 'declared';
  width: 'compact-then-drop';
  pack?: {id: string; version: string; name: string; builtIn: boolean; module: PackModule};
}

const PROMPT_SURFACES: readonly ContextSurface[] = ['mainPrompt', 'rightContext', 'contextRail'];
/** Low-attention context may also sit in the Status Strip; identity, Git and path stay prompt surfaces. */
const STRIP_SURFACES: readonly ContextSurface[] = [...PROMPT_SURFACES, 'statusStrip'];

function builtin(id: BuiltinModuleId, label: string, description: string, category: ModuleCategory, fields: readonly FactId[], demand: string,
  priority: number, conditions: readonly ContextCondition[], preferredSurface: ContextSurface = 'mainPrompt', engine: Record<string, readonly string[]> = {}): ContextModuleDefinition {
  return {id, label, description, category, fields, capabilities: [...fields.map(field => FACT_CAPABILITIES[field]), ...Object.keys(engine)],
    facts: new Map(Object.entries(engine).map(([capability, wanted]) => [capability, new Set(wanted)])), demand, priority,
    supportedSurfaces: category === 'context' || id === 'shell' || id === 'discoveredTools' ? STRIP_SURFACES : PROMPT_SURFACES,
    preferredSurface, conditions, icons: 'existing-semantic-glyphs', width: 'compact-then-drop'};
}

export const CONTEXT_MODULE_REGISTRY: Record<BuiltinModuleId, ContextModuleDefinition> = {
  project: builtin('project', 'Project', 'Repository or directory name.', 'identity', ['project', 'root'], 'always', 60, ['always']),
  cwd: builtin('cwd', 'Path', 'Working directory, shortened to fit.', 'identity', ['cwd', 'root', 'pathAbbreviations'], 'always', 70, ['always']),
  gitBranch: builtin('gitBranch', 'Git branch', 'Current branch or detached commit.', 'vcs', ['branch', 'git'], 'repository', 80, ['inRepository', 'always']),
  gitStatus: builtin('gitStatus', 'Git status', 'Rich Git working-tree and upstream state.', 'vcs', ['git'], 'repository', 90, ['inRepository', 'always']),
  toolchain: builtin('toolchain', 'Toolchains', 'Toolchains whose marker files are in this project.', 'tooling', ['toolchains'], 'project-markers', 40, ['always', 'onCommand']),
  exitStatus: builtin('exitStatus', 'Exit status', 'The last command\'s exit status.', 'session', ['exitStatus'], 'always', 100, ['nonzeroExit', 'always']),
  kubeContext: builtin('kubeContext', 'Kubernetes', 'Current kubeconfig context (and namespace when set).', 'context', ['kubeContext'], 'command', 95, ['onCommand', 'always'],
    'contextRail', {'infra.kubernetes': ['context', 'namespace']}),
  dockerContext: builtin('dockerContext', 'Docker context', 'Current Docker CLI context.', 'context', ['dockerContext'], 'command', 85, ['onCommand', 'always'],
    'contextRail', {'infra.docker': ['context']}),
  shell: builtin('shell', 'Current shell', 'The backend shell, when it is not the default.', 'session', ['shell'], 'always', 50, ['shellDiffers', 'always'], 'rightContext'),
  discoveredTools: builtin('discoveredTools', 'Local tools', 'How many local executables the shared inventory found.', 'tooling', ['discovery'], 'cached-inventory', 10, ['always'], 'rightContext'),
};

/** Pack role names → the existing semantic prompt roles every theme defines. */
export const PACK_ROLE_THEME: Record<PackRole, 'project' | 'cwd' | 'gitBranch' | 'node' | 'go' | 'python' | 'docker' | 'kubernetes' | 'success' | 'failure'> = {
  identity: 'project', location: 'cwd', vcs: 'gitBranch', javascript: 'node', python: 'python', go: 'go', runtime: 'go', container: 'docker',
  context: 'kubernetes', system: 'cwd', agent: 'project', success: 'success', failure: 'failure',
  project: 'project', cwd: 'cwd', gitBranch: 'gitBranch', node: 'node', docker: 'docker', kubernetes: 'kubernetes',
};

const CORE_BY_ID = new Map(CORE_CAPABILITIES.map(capability => [capability.id, capability]));

function packConditions(module: PackModule): ContextCondition[] {
  const base: ContextCondition[] = module.condition === 'inRepository' ? ['inRepository', 'always'] : ['always'];
  return module.triggers ? [...(module.condition === 'onCommand' ? ['onCommand' as const] : []), ...base, ...(module.condition === 'onCommand' ? [] : ['onCommand' as const])] : base;
}

/** A pack module's definition: demand is exactly the facts and fields its segments name. */
export function packModuleDefinition(parsed: ParsedPack, module: PackModule, builtIn: boolean): ContextModuleDefinition {
  const facts = new Map<string, Set<string>>();
  const want = (fact: string | undefined, field: string | undefined) => {
    if (!fact || !field) return;
    const set = facts.get(fact) ?? new Set<string>();
    set.add(field);
    facts.set(fact, set);
  };
  for (const segment of module.segments) {
    for (const part of segment.parts) {
      want(part.fact, part.field);
      if (part.until) want(part.fact, part.until);
      if (part.when?.field) want(part.when.fact ?? part.fact, part.when.field);
    }
    if (segment.emphasis) want(segment.emphasis.fact, segment.emphasis.field);
  }
  const preferred = module.surfaces?.preferred ?? 'contextRail';
  const supported = module.surfaces?.supported ?? [...PROMPT_SURFACES, 'statusStrip'];
  return {id: packModuleId(parsed.pack.id, module.id), label: module.label, description: module.description, category: module.category,
    fields: [], capabilities: [...facts.keys()], facts, demand: module.condition === 'onCommand' ? 'command' : 'facts', priority: module.priority,
    supportedSurfaces: supported, preferredSurface: preferred, conditions: packConditions(module),
    ...(module.triggers ? {triggers: module.triggers} : {}), icons: 'declared', width: 'compact-then-drop',
    pack: {id: parsed.pack.id, version: parsed.pack.version, name: parsed.pack.name, builtIn, module}};
}

export const FIRST_PARTY_PACK_FILES = ['nmsh.project', 'nmsh.environment', 'nmsh.infrastructure', 'nmsh.cloud', 'nmsh.system', 'nmsh.vcs', 'nmsh.agents'] as const;

let firstParty: ParsedPack[] | undefined;
let installed: ParsedPack[] = [];
let catalog: Map<string, ContextModuleDefinition> | undefined;

/** First-party packs: bundled JSON manifests, validated exactly like installed packs. A broken bundle is a build error, caught by tests. */
export function firstPartyPacks(): readonly ParsedPack[] {
  if (firstParty) return firstParty;
  firstParty = FIRST_PARTY_PACK_FILES.map(name => {
    const bytes = readFileSync(new URL(`./packs/builtin/${name}.json`, import.meta.url));
    const result = parsePack(bytes, CORE_BY_ID);
    if (!result.ok) throw new Error(`Bundled Context Pack ${name} is not valid: ${result.problem.message}`);
    return result.parsed;
  });
  return firstParty;
}

/** Installed (non-bundled) packs that are enabled and verified; set by the pack store at startup and after changes. */
export function setInstalledPacks(packs: readonly ParsedPack[]): void {
  installed = packs.filter(pack => !pack.pack.id.startsWith('nmsh.'));
  catalog = undefined;
}

export function installedPacks(): readonly ParsedPack[] { return installed; }

function buildCatalog(): Map<string, ContextModuleDefinition> {
  const map = new Map<string, ContextModuleDefinition>(Object.entries(CONTEXT_MODULE_REGISTRY));
  for (const parsed of firstPartyPacks()) for (const module of parsed.pack.modules) map.set(packModuleId(parsed.pack.id, module.id), packModuleDefinition(parsed, module, true));
  for (const parsed of installed) for (const module of parsed.pack.modules) {
    const id = packModuleId(parsed.pack.id, module.id);
    if (!map.has(id)) map.set(id, packModuleDefinition(parsed, module, false));
  }
  return map;
}

/** The definition for a configured module, or undefined when its pack is not installed (a "missing" module). */
export function moduleDefinition(id: string): ContextModuleDefinition | undefined {
  catalog ??= buildCatalog();
  return catalog.get(id);
}

export function allModuleDefinitions(): readonly ContextModuleDefinition[] {
  catalog ??= buildCatalog();
  return [...catalog.values()];
}

/**
 * Default configuration entries for first-party pack modules. Show-on-command
 * cloud, infrastructure and agent context is visible (it appears only while a
 * related command is typed, and only when local facts exist); everything else
 * ships hidden. All use Auto routing, so they land on their preferred surface.
 */
export function firstPartyDefaultModules(): ContextModuleConfig[] {
  return firstPartyPacks().flatMap(parsed => parsed.pack.modules.map(module => ({
    id: packModuleId(parsed.pack.id, module.id),
    visible: module.condition === 'onCommand' && ['cloud', 'infrastructure', 'agent'].includes(module.category),
    condition: module.condition,
    surface: 'auto' as const,
  })));
}
