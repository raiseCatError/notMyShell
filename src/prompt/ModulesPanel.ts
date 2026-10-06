import {allModuleDefinitions, moduleDefinition, type ContextModuleDefinition} from '../context/modules.js';
import {coreCapability} from '../context/registry.js';
import {safeContextText} from '../context/facts.js';
import {routeModule} from '../context/surfaceRouter.js';
import type {Recommendation} from '../context/packs/recommend.js';
import type {ModuleCategory} from '../context/packs/schema.js';
import type {Key} from '../terminal/keys.js';
import {focusForeground, lazyForeground, UI_COLORS} from '../ui/palette.js';
import {renderTabStrip} from '../ui/PanelShell.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {labelColumnWidth, padCells, truncateAnsi} from '../util/text.js';
import {applyModulePlacement, MODULE_SURFACE_LABELS, MODULE_SURFACES, modulePlacement, ON_COMMAND_MODULES, type ContextModuleConfig, type ModuleSurface,
  type PromptConfiguration} from './configuration.js';

/**
 * The /prompt module manager: Modules (the prompt order of what is in use),
 * Catalog (every module, grouped by category) and Packs (bundled and
 * installed Context Packs with their verified state and local
 * recommendations), plus a detail view that says what a module reads, how
 * fresh its facts are and what may enter command history. Pure: anything
 * with a side effect (Claude Code bridge, pack changes) is a request the
 * frontend performs and reports back through `message`.
 */

export type ModulesTab = 'modules' | 'catalog' | 'packs';
export const MODULES_TABS = ['Modules', 'Catalog', 'Packs'] as const;
const TAB_IDS: readonly ModulesTab[] = ['modules', 'catalog', 'packs'];

export type ModulesRequest =
  | {kind: 'claudeBridgeReview'}
  | {kind: 'claudeBridgeApply'}
  | {kind: 'claudeBridgeRemoveReview'}
  | {kind: 'claudeBridgeRemove'}
  | {kind: 'packEnabled'; id: string; enabled: boolean}
  | {kind: 'packRemove'; id: string};

export interface ModulesManagerState {
  modulesTab?: ModulesTab;
  /** Pack modules shown or hidden during this visit stay listed under Modules, so a row never vanishes under the cursor. */
  touched?: string[];
  detail?: {kind: 'module' | 'pack'; id: string};
  /** A reviewed change awaiting Enter (Claude Code settings edit, pack removal). */
  confirm?: {request: ModulesRequest; title: string; lines: string[]};
  request?: ModulesRequest;
  /** Facts from the frontend (engine status, packs, recommendations, Claude Code bridge state); refreshed by it, read here. */
  context?: ModulesContext;
}

export interface PackListing {
  id: string;
  version: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** bundled, enabled, disabled, missing-file, integrity-failed, invalid, unsupported, incompatible */
  state: string;
  message?: string;
  license: string;
  author: string;
  sha256?: string;
  requires: readonly string[];
  modules: ReadonlyArray<{id: string; label: string}>;
}

export interface ModulesContext {
  status?(capability: string): {state: string; collectedAt?: number; evidence?: string; error?: string};
  packs?: readonly PackListing[];
  recommendations?: readonly Recommendation[];
  claudeBridge?: {state: string; detail?: string};
  now?: number;
}

type ModulesState = ModulesManagerState & {selectedIndex: number; draft: PromptConfiguration; message?: string};

const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const ACCENT = lazyForeground(UI_COLORS.accent);
const WARNING = lazyForeground(UI_COLORS.failure);
const RESET = '\u001B[0m';

export const CATEGORY_LABELS: Record<ModuleCategory, string> = {identity: 'Identity', vcs: 'Version control', session: 'Session', tooling: 'Tooling',
  context: 'Command context', project: 'Project', runtime: 'Runtimes', environment: 'Environment', infrastructure: 'Infrastructure', cloud: 'Cloud',
  system: 'System', agent: 'Agents'};
const CATEGORY_ORDER: readonly ModuleCategory[] = ['identity', 'vcs', 'project', 'runtime', 'environment', 'tooling', 'context', 'infrastructure', 'cloud', 'agent', 'session', 'system'];

/** Readable descriptions of the legacy facts built-in modules use (what is read, never values). */
const LEGACY_READS: Record<string, string> = {
  'session.cwd': 'the working directory the live shell reports', 'workspace.identity': 'the repository or directory name',
  'workspace.git.root': 'the repository top level from trusted Git', 'workspace.path.abbreviations': 'ancestor directory names for path shortening',
  'workspace.git.branch': 'the current branch from trusted Git (hooks, fsmonitor and filters disabled)',
  'workspace.git.status': 'working-tree status from trusted Git; refused for repositories needing filters, includes or lazy fetches',
  'session.exit-status': 'the last exit status the shell reported', 'workspace.toolchain.markers': 'marker file names in the directory and repository root',
  'inventory.local': 'the shared local executable inventory (names only, nothing run)', 'session.shell': 'which backend this session runs',
};

const CONDITION_TEXT: Record<ContextModuleConfig['condition'], string> = {always: 'always', inRepository: 'in repositories', nonzeroExit: 'on failure',
  onCommand: 'on command', shellDiffers: 'when not default'};

const isPack = (id: string) => id.includes(':');
/** The display boundary for text that did not come from NMSh itself (pack manifests, registry, workspace names, settings files). */
const clean = (value: string | undefined, cells = 120) => safeContextText(value ?? '', cells);

/** Modules tab: every built-in, every pack module in use, and pack modules touched during this visit; in prompt order. */
export function listedModules(state: ModulesState): ContextModuleConfig[] {
  const touched = new Set(state.touched ?? []);
  return state.draft.modules.filter(module => !isPack(module.id) || module.visible || touched.has(module.id));
}

interface CatalogRow {kind: 'header'; text: string}
interface CatalogModuleRow {kind: 'module'; module: ContextModuleConfig; definition?: ContextModuleDefinition}
type CatalogEntry = CatalogRow | CatalogModuleRow;

/** Catalog tab: every configured module grouped by category (missing packs last). */
export function catalogEntries(state: ModulesState): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const category of CATEGORY_ORDER) {
    const modules = state.draft.modules.filter(module => moduleDefinition(module.id)?.category === category);
    if (!modules.length) continue;
    entries.push({kind: 'header', text: CATEGORY_LABELS[category]});
    for (const module of modules) entries.push({kind: 'module', module, definition: moduleDefinition(module.id)});
  }
  const missing = state.draft.modules.filter(module => !moduleDefinition(module.id));
  if (missing.length) {
    entries.push({kind: 'header', text: 'Missing packs'});
    for (const module of missing) entries.push({kind: 'module', module});
  }
  return entries;
}

type PackEntry = {kind: 'header'; text: string} | {kind: 'recommendation'; item: Recommendation} | {kind: 'pack'; pack: PackListing};

export function packEntries(context: ModulesContext): PackEntry[] {
  const entries: PackEntry[] = [];
  const recommendations = context.recommendations ?? [];
  if (recommendations.length) {
    entries.push({kind: 'header', text: 'Recommended here'});
    for (const item of recommendations) entries.push({kind: 'recommendation', item});
  }
  const packs = context.packs ?? [];
  const bundled = packs.filter(pack => pack.builtIn), installed = packs.filter(pack => !pack.builtIn);
  if (bundled.length) entries.push({kind: 'header', text: 'Bundled with NMSh'}, ...bundled.map(pack => ({kind: 'pack' as const, pack})));
  entries.push({kind: 'header', text: installed.length ? 'Installed' : 'Installed — none (nmsh packs install FILE)'}, ...installed.map(pack => ({kind: 'pack' as const, pack})));
  return entries;
}

const selectable = <T extends {kind: string}>(entries: readonly T[]) => entries.filter(entry => entry.kind !== 'header');

export function modulesItemCount(state: ModulesState, context: ModulesContext = state.context ?? {}): number {
  if (state.detail) return 1;
  const tab = state.modulesTab ?? 'modules';
  return Math.max(1, tab === 'modules' ? listedModules(state).length : tab === 'catalog' ? selectable(catalogEntries(state)).length : selectable(packEntries(context)).length);
}

function selectedModule(state: ModulesState): ContextModuleConfig | undefined {
  const tab = state.modulesTab ?? 'modules';
  if (state.detail?.kind === 'module') return state.draft.modules.find(module => module.id === state.detail!.id);
  if (tab === 'modules') return listedModules(state)[state.selectedIndex];
  if (tab === 'catalog') return (selectable(catalogEntries(state))[state.selectedIndex] as CatalogModuleRow | undefined)?.module;
  return undefined;
}

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

/** Surfaces this module can present on, in the shared order, plus Auto and Hidden. */
function surfaceChoices(module: ContextModuleConfig): ModuleSurface[] {
  const supported = moduleDefinition(module.id)?.supportedSurfaces ?? [];
  return MODULE_SURFACES.filter(surface => surface === 'auto' || surface === 'hidden' || supported.includes(surface as never));
}

function toggleVisible(state: ModulesState, module: ContextModuleConfig): void {
  module.visible = !module.visible;
  if (isPack(module.id)) state.touched = [...new Set([...(state.touched ?? []), module.id])];
}

function changeCondition(module: ContextModuleConfig, delta: number): boolean {
  if (module.id === 'exitStatus') { module.condition = module.condition === 'always' ? 'nonzeroExit' : 'always'; return true; }
  if (module.id === 'shell') { module.condition = module.condition === 'always' ? 'shellDiffers' : 'always'; return true; }
  if (ON_COMMAND_MODULES.has(module.id)) { module.condition = module.condition === 'onCommand' ? 'always' : 'onCommand'; return true; }
  const conditions = isPack(module.id) ? moduleDefinition(module.id)?.conditions ?? [] : [];
  if (conditions.length < 2) return false;
  module.condition = cycle(conditions, module.condition, delta);
  return true;
}

/** Keys for the module manager. Returns false when the key is not handled (the frontend then applies its defaults). */
export function handleModulesManagerKey(key: Key, state: ModulesState, context: ModulesContext = state.context ?? {}): boolean {
  if (state.confirm) {
    if (key.kind === 'enter' || (key.kind === 'text' && /^[yY]$/u.test(key.value))) { state.request = state.confirm.request; state.confirm = undefined; return true; }
    if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && /^[nN]$/u.test(key.value))) { state.confirm = undefined; state.message = 'Nothing was changed.'; return true; }
    return true;
  }
  if (key.kind === 'complete' || key.kind === 'focusPrevious') {
    if (state.detail) return true;
    state.modulesTab = cycle(TAB_IDS, state.modulesTab ?? 'modules', key.kind === 'complete' ? 1 : -1);
    state.selectedIndex = 0;
    return true;
  }
  if (state.detail) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.detail = undefined; return true; }
    if (state.detail.kind === 'pack') {
      const pack = context.packs?.find(item => item.id === state.detail!.id);
      if (pack && !pack.builtIn && key.kind === 'text' && /^[eE]$/u.test(key.value)) { state.request = {kind: 'packEnabled', id: pack.id, enabled: pack.state !== 'enabled'}; return true; }
      if (pack && !pack.builtIn && key.kind === 'text' && /^[dD]$/u.test(key.value)) {
        state.confirm = {request: {kind: 'packRemove', id: pack.id}, title: `Remove ${pack.name}?`, lines: [`Deletes the installed manifest for ${pack.id} ${pack.version}`,
          `and removes its ${pack.modules.length} module${pack.modules.length === 1 ? '' : 's'} from this draft. Bundled packs are not affected.`]};
        return true;
      }
      return true;
    }
  }
  const module = selectedModule(state);
  const tab = state.modulesTab ?? 'modules';
  if (key.kind === 'enter') {
    if (tab === 'packs' && !state.detail) {
      const entry = selectable(packEntries(context))[state.selectedIndex];
      if (entry?.kind === 'pack') state.detail = {kind: 'pack', id: entry.pack.id};
      else if (entry?.kind === 'recommendation') state.detail = {kind: 'module', id: entry.item.module};
      return true;
    }
    if (module && !state.detail) { state.detail = {kind: 'module', id: module.id}; return true; }
    return false;
  }
  if (tab === 'packs' && !state.detail && key.kind === 'text' && key.value === ' ') {
    const entry = selectable(packEntries(context))[state.selectedIndex];
    const target = entry?.kind === 'recommendation' ? state.draft.modules.find(item => item.id === entry.item.module) : undefined;
    if (target && !target.visible) { toggleVisible(state, target); state.message = `${moduleDefinition(target.id)?.label ?? target.id} is now shown. Save to keep it.`; }
    return true;
  }
  if (!module) return false;
  if (key.kind === 'text' && key.value === ' ') { toggleVisible(state, module); return true; }
  if (key.kind === 'text' && /^[bB]$/u.test(key.value) && state.detail && moduleDefinition(module.id)?.facts.has('agent.claude')) {
    state.request = context.claudeBridge?.state === 'configured' ? {kind: 'claudeBridgeRemoveReview'} : {kind: 'claudeBridgeReview'};
    return true;
  }
  if (key.kind === 'text' && /^[mM]$/u.test(key.value)) { state.draft.nmsh.mirrorRight = !state.draft.nmsh.mirrorRight; return true; }
  if (key.kind === 'text' && /^[pP]$/u.test(key.value)) {
    const side = routeModule({...module, visible: true, ...(module.surface === 'hidden' ? {surface: undefined} : {})});
    applyModulePlacement(module, side === 'rightContext' ? 'left' : 'right');
    return true;
  }
  if (key.kind === 'text' && /^[sS]$/u.test(key.value)) {
    module.surface = cycle(surfaceChoices(module), module.surface ?? (modulePlacement(module) === 'right' ? 'rightContext' : 'mainPrompt'), 1);
    return true;
  }
  if (key.kind === 'left' || key.kind === 'right') return changeCondition(module, key.kind === 'left' ? -1 : 1);
  if ((key.kind === 'selectUp' || key.kind === 'selectDown') && tab === 'modules' && !state.detail) {
    const listed = listedModules(state);
    const target = state.selectedIndex + (key.kind === 'selectUp' ? -1 : 1);
    if (target < 0 || target >= listed.length) return true;
    const modules = state.draft.modules;
    const a = modules.indexOf(listed[state.selectedIndex]!), b = modules.indexOf(listed[target]!);
    [modules[a], modules[b]] = [modules[b]!, modules[a]!];
    state.selectedIndex = target;
    return true;
  }
  return false;
}

/** The detail lines say only what the definition and the engine can prove; nothing here reads or runs anything. */
function moduleDetailRows(module: ContextModuleConfig, context: ModulesContext, columns: number): string[] {
  const definition = moduleDefinition(module.id);
  const rows: string[] = [];
  const line = (label: string, value: string) => truncateAnsi(`${SUBTLE}${padCells(label, 12)}${SECONDARY}${value}${RESET}`, columns);
  if (!definition) {
    rows.push(`${PRIMARY}${module.id}${RESET}`, `${WARNING}Its Context Pack is not installed or not enabled.${RESET}`,
      `${SECONDARY}The settings are kept and return with the pack; nothing is shown or collected meanwhile.${RESET}`);
    return rows;
  }
  const origin = definition.pack ? `${clean(definition.pack.name, 48)} · ${definition.pack.builtIn ? 'bundled' : `installed ${clean(definition.pack.id, 64)}@${clean(definition.pack.version, 48)}`}` : 'built in';
  rows.push(truncateAnsi(`${PRIMARY}${clean(definition.label, 48)}${RESET}  ${SUBTLE}${CATEGORY_LABELS[definition.category]} · ${origin}${RESET}`, columns),
    truncateAnsi(`${SECONDARY}${clean(definition.description, 240)}${RESET}`, columns), '');
  const surface = routeModule({...module, visible: true});
  rows.push(line('Shown', `${module.visible ? 'yes' : 'no'} · ${CONDITION_TEXT[module.condition]} · ${surface === 'hidden' ? 'Hidden' : MODULE_SURFACE_LABELS[surface as ModuleSurface]}`
    + `${module.surface === 'auto' || module.surface === undefined ? '' : ` (prefers ${MODULE_SURFACE_LABELS[definition.preferredSurface as ModuleSurface]})`}`));
  if (definition.triggers?.length) rows.push(line('On commands', clean(definition.triggers.slice(0, 12).join(', ') + (definition.triggers.length > 12 ? ', …' : ''), 200)));
  rows.push(line('Priority', `${definition.priority} (higher stays when space runs out)`));
  const reads = definition.capabilities.flatMap(id => {
    const capability = coreCapability(id);
    return capability ? capability.reads.map(read => `${capability.title}: ${read}`) : LEGACY_READS[id] ? [LEGACY_READS[id]!] : [];
  });
  rows.push(`${SUBTLE}Reads${RESET}`, ...[...new Set(reads)].map(read => truncateAnsi(`${SECONDARY}  · ${read}${RESET}`, columns)));
  rows.push(`${SUBTLE}${SECONDARY}  Nothing is executed from the workspace, no network is used, and secret values are never read.${RESET}`);
  const capabilities = [...definition.facts.keys()].map(id => coreCapability(id)).filter(Boolean);
  const history = capabilities.length && capabilities.every(capability => capability!.persistence === 'snapshot-safe');
  const privateFields = capabilities.flatMap(capability => Object.entries(capability!.fieldPolicy ?? {}).filter(([, policy]) => policy.persistence !== 'snapshot-safe').map(([field]) => field));
  rows.push(line('History', definition.pack ? (history ? `may be kept with commands when shown in the Main Prompt${privateFields.length ? ` (never: ${privateFields.join(', ')})` : ''}`
    : 'live only; never kept in command history') : 'kept with commands when shown in the Main Prompt'));
  for (const capability of capabilities) {
    const status = context.status?.(capability!.id);
    if (!status) continue;
    const age = status.collectedAt !== undefined && context.now !== undefined ? ` · ${Math.max(0, Math.round((context.now - status.collectedAt) / 1000))}s ago` : '';
    const text = status.state === 'fresh' ? `fresh${age}` : status.state === 'stale' ? `last known${age}, refreshing` : status.state === 'absent' ? 'nothing to show here'
      : status.state === 'pending' ? 'checking…' : status.state === 'timeout' || status.state === 'failed' ? `unavailable (${status.error ?? status.state})` : 'not checked (module not in use)';
    rows.push(line(capability!.title.slice(0, 11), clean(`${text}${status.evidence ? ` · ${status.evidence}` : ''}`, 200)));
  }
  if (definition.facts.has('agent.claude')) {
    const bridge = context.claudeBridge;
    rows.push('', line('Claude Code', bridge?.state === 'configured' ? 'reports to NMSh through its status line · B to review removal'
      : bridge?.state === 'conflict' ? `has its own status line (${clean(bridge.detail ?? 'custom', 80)}); NMSh does not replace it`
        : bridge?.state === 'unreadable' ? `settings not readable (${clean(bridge.detail, 80)})` : 'not reporting yet · B to review the one settings change'));
  }
  return rows;
}

function packDetailRows(pack: PackListing, columns: number): string[] {
  const rows = [truncateAnsi(`${PRIMARY}${clean(pack.name, 48)}${RESET}  ${SUBTLE}${clean(pack.id, 64)} ${clean(pack.version, 48)} · ${pack.builtIn ? 'bundled with NMSh' : clean(pack.state, 24)}${RESET}`, columns),
    truncateAnsi(`${SECONDARY}${clean(pack.description, 240)}${RESET}`, columns), ''];
  if (pack.message) rows.push(truncateAnsi(`${WARNING}${clean(pack.message, 240)}${RESET}`, columns));
  rows.push(truncateAnsi(`${SUBTLE}License ${SECONDARY}${clean(pack.license, 64)}${SUBTLE} · Author ${SECONDARY}${clean(pack.author, 96)}${RESET}`, columns));
  if (pack.sha256) rows.push(truncateAnsi(`${SUBTLE}sha256 ${SECONDARY}${clean(pack.sha256, 64)}${RESET}`, columns));
  rows.push(`${SUBTLE}Modules${RESET}`, ...pack.modules.map(module => truncateAnsi(`${SECONDARY}  · ${clean(module.label, 48)}${RESET}`, columns)));
  rows.push(`${SUBTLE}Capabilities${RESET}`, ...pack.requires.map(id => truncateAnsi(`${SECONDARY}  · ${coreCapability(id)?.title ?? `${clean(id, 64)} (not provided by this NMSh)`}${RESET}`, columns)));
  rows.push('', `${SUBTLE}A Context Pack is data: it cannot run commands, read arbitrary files or use the network.${RESET}`);
  return rows;
}

function optionText(module: ContextModuleConfig): string {
  if (isPack(module.id) && !moduleDefinition(module.id)) return 'pack not installed';
  const choosable = module.id === 'exitStatus' || module.id === 'shell' || ON_COMMAND_MODULES.has(module.id) || (moduleDefinition(module.id)?.conditions.length ?? 0) > 1;
  const text = module.id === 'toolchain' && module.condition === 'always' ? 'when detected' : module.id === 'discoveredTools' ? 'when detected'
    : (module.id === 'gitBranch' || module.id === 'gitStatus') ? 'in repositories' : CONDITION_TEXT[module.condition];
  return choosable ? `‹ ${text} ›` : text;
}

const label = (id: string) => clean(moduleDefinition(id)?.label ?? `${id.slice(0, 40)} (missing pack)`, 64);

/** A window of list rows around the selection, with counts of what is above and below. */
function windowed(rows: string[], selectedRow: number, budget: number): string[] {
  if (rows.length <= budget || budget < 5) return rows;
  const size = budget - 2;
  const start = Math.max(0, Math.min(rows.length - size, selectedRow - Math.floor(size / 2)));
  const end = start + size;
  return [start ? `${SUBTLE}  ↑ ${start} more${RESET}` : '', ...rows.slice(start, end), end < rows.length ? `${SUBTLE}  ↓ ${rows.length - end} more${RESET}` : ''];
}

export function renderModulesManager(state: ModulesState, columns: number, context: ModulesContext = state.context ?? {}, budget = Infinity): string[] {
  const all = renderManagerRows(state, columns, context);
  if (state.detail || state.confirm || all.rows.length <= budget) return all.rows;
  return [...all.rows.slice(0, all.head), ...windowed(all.rows.slice(all.head), all.selectedRow - all.head, budget - all.head)];
}

function renderManagerRows(state: ModulesState, columns: number, context: ModulesContext): {rows: string[]; head: number; selectedRow: number} {
  const tab = state.modulesTab ?? 'modules';
  const rows: string[] = [renderTabStrip(MODULES_TABS, TAB_IDS.indexOf(tab), columns, false), ''];
  let selectedRow = 0;
  if (state.confirm) {
    rows.push(truncateAnsi(`${PRIMARY}${clean(state.confirm.title, 120)}${RESET}`, columns), ...state.confirm.lines.map(line => truncateAnsi(`${SECONDARY}  ${clean(line, 400)}${RESET}`, columns)), '',
      `${ACCENT}Enter${RESET}${SECONDARY} apply · ${ACCENT}Esc${RESET}${SECONDARY} keep everything as it is${RESET}`);
    return {rows, head: rows.length, selectedRow: 0};
  }
  if (state.detail) {
    if (state.detail.kind === 'pack') {
      const pack = context.packs?.find(item => item.id === state.detail!.id);
      rows.push(...(pack ? packDetailRows(pack, columns) : [`${SECONDARY}That pack is no longer available.${RESET}`]));
    } else {
      const module = state.draft.modules.find(item => item.id === state.detail!.id);
      rows.push(...(module ? moduleDetailRows(module, context, columns) : [`${SECONDARY}That module is no longer configured.${RESET}`]));
    }
    return {rows, head: rows.length, selectedRow: 0};
  }
  const item = (index: number, text: string) => {
    if (index === state.selectedIndex) selectedRow = rows.length;
    return `${index === state.selectedIndex ? `${ACCENT}›` : ' '} ${focusForeground(index === state.selectedIndex)}${text}${RESET}`;
  };
  const head = rows.length + (tab === 'modules' ? 1 : 0);
  const shown = (visible: boolean) => visible ? `${ACCENT}●` : `${SUBTLE}○`;
  const recommended = new Set<string>((context.recommendations ?? []).map(entry => entry.module));
  const mark = getCurrentGlyphMode() === 'nerd' ? '✦' : '*';
  if (tab === 'modules') {
    rows.push(`${PRIMARY}Prompt modules${RESET}  ${SUBTLE}in prompt order · Mirror right side: ${RESET}${state.draft.nmsh.mirrorRight ? `${ACCENT}On` : `${SECONDARY}Off`}${RESET}`);
    const listed = listedModules(state);
    const width = labelColumnWidth(listed.map(module => label(module.id)), columns, 4);
    listed.forEach((module, index) => {
      const side = module.surface ? MODULE_SURFACE_LABELS[module.surface] : modulePlacement(module);
      if (index === state.selectedIndex) selectedRow = rows.length;
      rows.push(`${index === state.selectedIndex ? `${ACCENT}›` : ' '} ${shown(module.visible)} ${focusForeground(index === state.selectedIndex)}${padCells(label(module.id), width)}${SUBTLE}${padCells(side, 15)}${module.visible ? optionText(module) : 'hidden'}${RESET}`);
    });
    rows.push('', `${SUBTLE}More modules (cloud, runtimes, agents, system…) are in Catalog; Tab to switch.${RESET}`);
  } else if (tab === 'catalog') {
    let index = 0;
    const entries = catalogEntries(state);
    const width = labelColumnWidth(entries.flatMap(entry => entry.kind === 'module' ? [label(entry.module.id)] : []), columns, 6);
    for (const entry of entries) {
      if (entry.kind === 'header') { rows.push(`${SUBTLE}${entry.text}${RESET}`); continue; }
      const surface = routeModule({...entry.module, visible: true});
      const where = surface === 'hidden' ? 'Hidden' : MODULE_SURFACE_LABELS[surface as ModuleSurface];
      const extra = recommended.has(entry.module.id) && !entry.module.visible ? `  ${ACCENT}${mark} recommended here` : '';
      rows.push(item(index, `${shown(entry.module.visible)} ${padCells(label(entry.module.id), width)}${SUBTLE}${padCells(where, 15)}${entry.module.visible ? optionText(entry.module) : 'hidden'}${extra}`));
      index += 1;
    }
  } else {
    let index = 0;
    for (const entry of packEntries(context)) {
      if (entry.kind === 'header') { rows.push(`${SUBTLE}${entry.text}${RESET}`); continue; }
      if (entry.kind === 'recommendation') {
        const on = state.draft.modules.find(module => module.id === entry.item.module)?.visible ?? false;
        rows.push(item(index, truncateAnsi(`${shown(on)} ${clean(entry.item.label, 48)}  ${SUBTLE}${clean(entry.item.reasons.join('; '), 200)}`, columns - 2)));
      } else {
        const state_ = entry.pack.builtIn ? 'bundled' : entry.pack.state;
        rows.push(item(index, truncateAnsi(`${clean(entry.pack.name, 48)}  ${SUBTLE}${clean(entry.pack.id, 64)} ${clean(entry.pack.version, 48)} · ${clean(state_, 24)} · ${entry.pack.modules.length} modules`, columns - 2)));
      }
      index += 1;
    }
  }
  return {rows, head, selectedRow};
}

export function modulesManagerControls(state: ModulesState, context: ModulesContext = state.context ?? {}): Array<[string, string]> {
  if (state.confirm) return [['Enter', 'apply'], ['Esc', 'cancel']];
  if (state.detail?.kind === 'pack') {
    const pack = context.packs?.find(item => item.id === state.detail!.id);
    return pack && !pack.builtIn ? [['E', pack.state === 'enabled' ? 'disable' : 'enable'], ['D', 'remove'], ['Esc', 'back']] : [['Esc', 'back']];
  }
  if (state.detail) {
    const claude = moduleDefinition(state.detail.id)?.facts.has('agent.claude');
    return [['Space', 'show/hide'], ['←→', 'option'], ['S', 'surface'], ...(claude ? [['B', 'Claude Code bridge'] as [string, string]] : []), ['Esc', 'back']];
  }
  const tab = state.modulesTab ?? 'modules';
  if (tab === 'packs') return [['↑↓', 'move'], ['Enter', 'details'], ['Space', 'show recommended'], ['Tab', 'modules'], ['Esc', 'done']];
  if (tab === 'catalog') return [['↑↓', 'move'], ['Space', 'show/hide'], ['←→', 'option'], ['S', 'surface'], ['Enter', 'details'], ['Tab', 'packs'], ['Esc', 'done']];
  // Tab is named on the screen itself ("… in Catalog; Tab to switch"), keeping this line within narrow panels.
  return [['↑↓', 'move'], ['Space', 'show/hide'], ['Shift+↑↓', 'reorder'], ['←→', 'option'], ['P', 'side'], ['S', 'surface'],
    ['M', `mirror: ${state.draft.nmsh.mirrorRight ? 'On' : 'Off'}`], ['Enter', 'details'], ['Esc', 'done']];
}

/** Every module definition by category, for help text and documentation checks. */
export function catalogSummary(): Array<{category: string; modules: string[]}> {
  return CATEGORY_ORDER.map(category => ({category: CATEGORY_LABELS[category], modules: allModuleDefinitions().filter(definition => definition.category === category).map(definition => definition.label)}))
    .filter(group => group.modules.length);
}
