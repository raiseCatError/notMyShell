/**
 * NMSh-managed Kitty shader pipeline: settings, validation, composition with
 * the person's own `custom_shaders`, and reviewed, owned writes.
 *
 * Kitty has ONE effective `custom_shaders` value (a later line replaces an
 * earlier one). NMSh never appends a competing line blindly: it reads the
 * effective value through the real configuration graph, keeps it verbatim and
 * in order, adds its own pipeline (an absolute path to an NMSh-owned file)
 * before or after it, and proves by simulation that the result is what Kitty
 * will load. Anything that prevents establishing that — dynamic includes,
 * launch overrides, unreadable or unknown pipelines, shadowed shaders, shared
 * textures, a second cursor trail, too many groups — refuses the edit.
 *
 * Files: one include hook in the effective kitty.conf (recorded), NMSh's own
 * fragment (`custom_shaders …`), NMSh's own `.pipeline`, and an ownership
 * ledger. Writes go through hostFiles' snapshot-verified transaction.
 */
import {execFileSync} from 'node:child_process';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {appearancePaths, type AppearanceContext} from './hostPaths.js';
import {readHostConfiguration} from './hostConfiguration.js';
import {digest, snapshot, transact, type FileChange, type FileSnapshot} from './hostFiles.js';
import {withoutHook} from './hostAppearance.js';
import {CATEGORY_LABELS, defaultPipeline, emitKittyPipeline, formatShaderValue, KITTY_MAX_GROUPS, mergeVars, parseKittyPipeline, pipelineTextures,
  subscribesToCursorTrail, type KittyCatalog, type KittyGroup, type KittyPipeline, type KittyVar, type OfferedParam, type OfferedPreset, type ShaderValue} from './kittyShaderCatalog.js';
import type {CursorRenderer} from '../prompt/configuration.js';

// ---- Settings ----------------------------------------------------------------------------------------------------

export {DEFAULT_HOST_SHADERS, normalizeHostShaders, type HostShaderSettings, type KittyShaderEffect, type KittyShaderSettings} from './kittyShaderSettings.js';
import type {KittyShaderEffect, KittyShaderSettings} from './kittyShaderSettings.js';

export interface ShaderGates {reducedMotion: boolean; effectsOff: boolean; cursorRenderer: CursorRenderer}

/** What NMSh's pipeline may contain right now: nothing under Reduced Motion or Effects Off, no Kitty trail when the cursor renderer is Portable. */
export function gatedEffects(settings: KittyShaderSettings, catalog: KittyCatalog, gates: ShaderGates): Array<{preset: OfferedPreset; effect: KittyShaderEffect}> {
  if (gates.reducedMotion || gates.effectsOff) return [];
  return settings.effects.filter(effect => effect.enabled).flatMap(effect => {
    const preset = catalog.offered.find(item => item.definition.id === effect.id);
    if (!preset || (preset.definition.category === 'cursor' && gates.cursorRenderer === 'portable')) return [];
    return [{preset, effect}];
  });
}

const valueError = (param: OfferedParam, value: ShaderValue): string | undefined => {
  if (param.kind === 'bool') return typeof value === 'boolean' ? undefined : 'expects on or off';
  if (param.kind === 'color') {
    const size = param.type === 'float4' ? 4 : 3;
    return Array.isArray(value) && value.length === size && value.every(part => part >= 0 && part <= 1) ? undefined : `expects ${size} components between 0 and 1`;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'expects a number';
  if ((param.type === 'int' || param.type === 'uint') && !Number.isSafeInteger(value)) return 'expects a whole number';
  if (param.kind === 'choice') return param.choices?.some(([choice]) => choice === value) ? undefined : 'is not one of its choices';
  return value < (param.min ?? -Infinity) || value > (param.max ?? Infinity) ? `must be between ${param.min} and ${param.max}` : undefined;
};

/** Every reason the saved settings cannot be applied to THIS Kitty's catalog; no value is clamped or invented. */
export function validateEffects(settings: KittyShaderSettings, catalog: KittyCatalog): string[] {
  const errors: string[] = [];
  const exclusive = new Map<string, string>();
  for (const effect of settings.effects) {
    const preset = catalog.offered.find(item => item.definition.id === effect.id);
    if (!preset) { errors.push(`${effect.id} is not offered for Kitty ${catalog.version || '(unknown)'}.`); continue; }
    const {definition} = preset;
    for (const [name, value] of Object.entries(effect.values)) {
      const param = preset.params.find(item => item.name === name);
      if (!param) { errors.push(`${definition.label}: ${name} is not an adjustable setting of the installed shader.`); continue; }
      const problem = valueError(param, value);
      if (problem) errors.push(`${definition.label}: ${param.label} ${problem}.`);
    }
    if (effect.enabled && definition.exclusive) {
      const other = exclusive.get(definition.exclusive);
      if (other) errors.push(`${definition.label} and ${other} cannot run together.`);
      exclusive.set(definition.exclusive, definition.label);
    }
  }
  return errors;
}

// ---- Value parsing (custom_shaders uses POSIX shell words, as Kitty's shlex.split) ---------------------------------

export function shellWords(text: string): string[] | undefined {
  const words: string[] = [];
  let current = '';
  let active = false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote === "'") { if (char === "'") quote = undefined; else current += char; continue; }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === '\\' && (text[index + 1] === '"' || text[index + 1] === '\\')) current += text[++index];
      else current += char;
      continue;
    }
    if (/\s/u.test(char)) { if (active) { words.push(current); current = ''; active = false; } continue; }
    active = true;
    if (char === "'" || char === '"') quote = char;
    else if (char === '\\') { if (index + 1 >= text.length) return undefined; current += text[++index]; }
    else current += char;
  }
  if (quote) return undefined;
  if (active) words.push(current);
  return words;
}

const quoteWord = (word: string) => /^[A-Za-z0-9_@%+=:,./~-]+$/u.test(word) ? word : `'${word}'`;

// ---- Paths, ledger -----------------------------------------------------------------------------------------------

export function kittyShaderPaths(context: AppearanceContext) {
  const base = appearancePaths('kitty', context);
  return {...base, fragment: join(base.directory, 'kitty-shaders.conf'), pipeline: join(base.directory, 'kitty-shaders.pipeline'), ledger: join(base.directory, 'kitty-shaders.json')};
}
const HOOK_COMMENT = '# NMSh Kitty shaders (remove using /appearance)';
const FRAGMENT_HEADER = '# Managed by NMSh (/appearance › Kitty shaders). Your own shaders are kept verbatim and in order.\n';

interface ShaderLedger {
  version: 1; feature: 'kitty-shaders'; hostPath: string; hook: string; fragmentHash: string; pipelineHash: string; created: boolean;
  /** The person's effective custom_shaders value (verbatim) that NMSh composed with; '' when there was none. */
  preserved: string;
  placement: 'after' | 'before';
  kittyVersion: string;
  presets: Array<{id: string; resources: Array<{name: string; sha256: string}>}>;
}

/** Strict by default; `lenient` (removal only) reports damaged owned files instead of refusing, so a broken integration can still be removed. */
function owned(context: AppearanceContext, lenient = false) {
  const paths = kittyShaderPaths(context);
  const fragment = snapshot(paths.fragment, paths.home, true);
  const pipeline = snapshot(paths.pipeline, paths.home, true);
  const ledger = snapshot(paths.ledger, paths.home, true);
  let record: ShaderLedger | undefined;
  if (ledger.content !== undefined) {
    let parsed: Partial<ShaderLedger>;
    try { parsed = JSON.parse(ledger.content); } catch { throw new Error('The Kitty shader ownership record is malformed; nothing will be overwritten.'); }
    const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
    if (parsed?.version !== 1 || parsed.feature !== 'kitty-shaders' || typeof parsed.created !== 'boolean' || !paths.candidates.includes(parsed.hostPath ?? '')
      || typeof parsed.hook !== 'string' || !hash(parsed.fragmentHash) || !hash(parsed.pipelineHash) || typeof parsed.preserved !== 'string'
      || (parsed.placement !== 'after' && parsed.placement !== 'before') || !Array.isArray(parsed.presets)) throw new Error('The Kitty shader ownership record is invalid.');
    record = parsed as ShaderLedger;
    const newline = record.hook.includes('\r\n') ? '\r\n' : '\n';
    if (record.hook.replace(/\r\n/gu, '\n').trim() !== `${HOOK_COMMENT}\ninclude ${paths.fragment}` || !record.hook.endsWith(`include ${paths.fragment}${newline}`)) throw new Error('The recorded include does not match NMSh’s own Kitty shader hook.');
  }
  const damaged = new Map<'fragment' | 'pipeline', 'edited' | 'missing'>();
  for (const [file, expected, label] of [[fragment, record?.fragmentHash, 'fragment'], [pipeline, record?.pipelineHash, 'pipeline']] as const) {
    if (file.content !== undefined && (!record || digest(file.content) !== expected)) {
      if (lenient && record) { damaged.set(label, 'edited'); continue; }
      throw new Error(`The Kitty shader ${label} is unowned or was edited outside NMSh; it was preserved.`);
    }
    if (record && file.content === undefined) {
      if (lenient) { damaged.set(label, 'missing'); continue; }
      throw new Error(`The recorded Kitty shader ${label} is missing; R in /appearance › Kitty shaders removes the integration.`);
    }
  }
  return {paths, fragment, pipeline, ledger, record, damaged};
}

// ---- Reading the person's shaders ----------------------------------------------------------------------------------

export interface UserPipeline {entry: string; kind: 'file' | 'builtin' | 'shader' | 'missing'; pipeline?: KittyPipeline; path?: string}
export interface KittyShaderInspection {
  hostPath: string;
  configDirectory: string;
  /** The person's effective custom_shaders exactly as written ('' when unset), NMSh's own line excluded. */
  userRaw: string;
  userEntries: string[];
  pipelines: UserPipeline[];
  /** Earlier custom_shaders lines Kitty already ignores (a later line replaces them). */
  shadowed: string[];
  /** Effective values after NMSh's line is excluded. */
  cursorTrail: number;
  backgroundOpacity: number;
  /** Reasons composition is impossible to establish safely. */
  problems: string[];
  notes: string[];
  dependencies: FileSnapshot[];
  configured: boolean;
  /** The person's own custom_shaders changed since NMSh composed with it: Kitty is still loading the reviewed copy. */
  drifted: boolean;
  activePresets: string[];
}

export interface KittyLaunch {
  /** Why Kitty's launch options (-o/--override, -c/--config) could not be shown to leave custom_shaders alone; undefined when inspected and clear. */
  refusal?: string;
}

export interface KittyShaderContext extends AppearanceContext {catalog: KittyCatalog; gates: ShaderGates; launch: KittyLaunch}

function resolveUserPipeline(entry: string, configDirectory: string, home: string, catalog: KittyCatalog, dependencies: FileSnapshot[]): UserPipeline | string {
  if (entry.startsWith('~') && entry !== '~' && !entry.startsWith('~/')) return `${entry} uses another user's home (~user), which NMSh does not inspect`;
  const expanded = entry === '~' || entry.startsWith('~/') ? resolve(home, entry.slice(2)) : entry;
  const read = (path: string) => { const file = snapshot(path, home); dependencies.push(file); return file.content; };
  const parse = (text: string, path?: string): UserPipeline | string => {
    const parsed = parseKittyPipeline(text, entry);
    return parsed.ok ? {entry, kind: path ? 'file' : 'builtin', pipeline: parsed.value, ...(path ? {path} : {})} : `${entry}: ${parsed.error}`;
  };
  try {
    if (isAbsolute(expanded)) {
      const path = expanded.endsWith('.pipeline') ? expanded : `${expanded}.pipeline`;
      const text = read(path);
      if (text !== undefined) return parse(text, path);
      if (read(`${expanded}.slang`) !== undefined) return {entry, kind: 'shader', pipeline: defaultPipeline(entry), path: `${expanded}.slang`};
      return {entry, kind: 'missing'};
    }
    const file = expanded.endsWith('.pipeline') ? expanded : `${expanded}.pipeline`;
    const own = read(join(configDirectory, 'shaders', file));
    if (own !== undefined) return parse(own, join(configDirectory, 'shaders', file));
    const base = file.slice(0, -'.pipeline'.length);
    const builtin = catalog.pipelines.get(base);
    if (builtin) return {entry, kind: 'builtin', pipeline: builtin.pipeline};
    if (read(join(configDirectory, `${entry}.slang`)) !== undefined || catalog.shaders.has(entry)) return {entry, kind: 'shader', pipeline: defaultPipeline(entry)};
    return {entry, kind: 'missing'};
  } catch (error) {
    return `${entry} cannot be inspected safely (${error instanceof Error ? error.message : String(error)})`;
  }
}

export function inspectKittyShaders(context: KittyShaderContext): KittyShaderInspection {
  const paths = kittyShaderPaths(context);
  const result: KittyShaderInspection = {hostPath: paths.fallback, configDirectory: dirname(paths.fallback), userRaw: '', userEntries: [], pipelines: [], shadowed: [],
    cursorTrail: 0, backgroundOpacity: 1, problems: [], notes: [], dependencies: [], configured: false, drifted: false, activePresets: []};
  let record: ShaderLedger | undefined;
  try { record = owned(context).record; } catch (error) { result.problems.push(error instanceof Error ? error.message : String(error)); }
  // NMSh's own fragment is read as empty, leaving exactly what the person's configuration says.
  const read = readHostConfiguration('kitty', context, new Map([[paths.fragment, '']]));
  result.hostPath = read.hostPath;
  result.configDirectory = context.env.KITTY_CONFIG_DIRECTORY ? resolve(context.env.KITTY_CONFIG_DIRECTORY) : dirname(read.hostPath);
  result.problems.push(...read.problems);
  result.dependencies.push(...read.files);
  if (context.launch.refusal) result.problems.push(context.launch.refusal);
  const definition = read.values.get('custom_shaders');
  const all = read.definitions.filter(item => item.key === 'custom_shaders' && item.path !== paths.fragment);
  result.shadowed = all.slice(0, -1).map(item => `${item.path}:${item.line}`);
  result.userRaw = definition?.raw ?? '';
  const words = shellWords(result.userRaw);
  if (!words) result.problems.push('Your custom_shaders value has unbalanced quoting; NMSh cannot preserve it exactly.');
  result.userEntries = words ?? [];
  if (result.userEntries.some(word => /[\u0000-\u001f\u007f]/u.test(word))) result.problems.push('Your custom_shaders value contains control characters.');
  for (const entry of result.userEntries) {
    const resolved = resolveUserPipeline(entry, result.configDirectory, paths.home, context.catalog, result.dependencies);
    if (typeof resolved === 'string') { result.problems.push(`Your shader pipeline ${resolved}. NMSh will not compose with a pipeline it cannot read.`); continue; }
    if (resolved.kind === 'missing') result.notes.push(`Kitty cannot find your shader “${entry}”; it is kept exactly as written.`);
    result.pipelines.push(resolved);
  }
  const trail = Number(read.values.get('cursor_trail')?.value ?? 0);
  result.cursorTrail = Number.isFinite(trail) ? trail : 0;
  const opacity = Number(read.values.get('background_opacity')?.value ?? 1);
  result.backgroundOpacity = Number.isFinite(opacity) ? opacity : 1;
  if (record) {
    result.configured = true;
    result.activePresets = record.presets.map(preset => preset.id);
    result.drifted = record.preserved !== result.userRaw;
  }
  return result;
}

// ---- Composition -------------------------------------------------------------------------------------------------

export interface KittyShaderPlan {
  host: 'kitty';
  operation: 'save' | 'remove' | 'sync';
  hostPath: string;
  fragmentPath: string;
  pipelinePath: string;
  preview: string[];
  notes: string[];
  guidance: string;
  home: string;
  changes: readonly FileChange[];
  dependencies: readonly FileSnapshot[];
  /** The exact pipeline Kitty will load after this plan (for tests and review). */
  pipelineText: string;
  effectiveShaders: string[];
}
export type KittyShaderPlanResult = {ok: true; plan: KittyShaderPlan} | {ok: false; error: string};

export function kittyShaderGuidance(platform: NodeJS.Platform): string {
  return `Configuration saved, not proof of GPU output. Kitty reloads its config automatically unless auto_reload_config is 0; otherwise reload with ${platform === 'darwin' ? '⌃⌘,' : 'Ctrl+Shift+F5'}. `
    + 'Kitty builds all custom shaders (yours and NMSh’s) as one program: if any part fails to build, Kitty turns all of them off and logs why; R here removes NMSh’s part.';
}

const decimals = (value: number) => (value.toString().split('.')[1] ?? '').length;
/** A param's value as Kitty source; colors keep the shipped alpha when NMSh only edits RGB. */
const formatParam = (param: OfferedParam, value: ShaderValue) => formatShaderValue(param.type, param.kind === 'number' && typeof value === 'number' && param.type === 'float'
  ? Number(value.toFixed(Math.max(2, decimals(param.step ?? 0.01)))) : value);

/** NMSh's pipeline: each preset's shipped groups in order, every value group-scoped, leaked pipeline vars pinned to the shipped source. */
export function buildNmshPipeline(active: ReadonlyArray<{preset: OfferedPreset; effect: KittyShaderEffect}>, catalog: KittyCatalog, leaked: readonly KittyVar[]): KittyPipeline {
  const textures: string[] = [];
  const groups: KittyGroup[] = [];
  for (const {preset, effect} of active) {
    for (const texture of preset.textures) {
      if (textures.includes(texture)) throw new Error(`${preset.definition.label} needs Kitty's shared texture “${texture}”, which another NMSh effect already uses.`);
      textures.push(texture);
    }
    for (const group of preset.groups) {
      const constants = group.shaders.map(name => catalog.shaders.get(name)?.constants);
      const declared = (name: string, type: string) => constants.find(map => map?.get(name)?.type === type)?.get(name);
      const pinned: KittyVar[] = leaked.flatMap(variable => {
        const constant = declared(variable.name, variable.type);
        if (constant && !constant.raw) throw new Error(`Your shaders set ${variable.name} for every chained shader, and ${preset.definition.label} declares it in a form NMSh cannot pin safely.`);
        return constant ? [{type: constant.type, name: constant.name, value: constant.raw}] : [];
      });
      const chosen: KittyVar[] = preset.params.flatMap(param => {
        const value = effect.values[param.name];
        return value !== undefined && declared(param.name, param.type) ? [{type: param.type, name: param.name, value: formatParam(param, value)}] : [];
      });
      groups.push({...group, shaders: [...group.shaders], vars: mergeVars(pinned, group.vars, chosen)});
    }
  }
  return {textures: textures as KittyPipeline['textures'], vars: [], groups};
}

function previewFile(path: string, before: string | undefined, after: string | undefined): string[] {
  if (before === after) return [];
  if (after === undefined) return [`File: ${path}`, '- (NMSh-owned file removed)'];
  if (before !== undefined && after.startsWith(before)) return [`File: ${path}`, ...after.slice(before.length).trimEnd().split(/\r?\n/u).filter(Boolean).map(line => `+ ${line}`)];
  return [`File: ${path} (NMSh-owned)`, ...after.trimEnd().split(/\r?\n/u).map(line => `+ ${line}`)];
}

function compose(settings: KittyShaderSettings, context: KittyShaderContext, mode: 'save' | 'sync'): KittyShaderPlanResult {
  try {
    const {catalog} = context;
    if (!catalog.supported) throw new Error(catalog.reason ?? 'Kitty custom shaders are not available.');
    const errors = validateEffects(settings, catalog);
    if (errors.length) throw new Error(errors.join(' '));
    const enabled = settings.effects.filter(effect => effect.enabled);
    if (mode === 'save' && !enabled.length) throw new Error('No Kitty effect is enabled. Enable one, or press R to remove NMSh’s Kitty shaders.');
    if (mode === 'save' && enabled.length && (context.gates.reducedMotion || context.gates.effectsOff)) {
      throw new Error(`${context.gates.reducedMotion ? 'Reduced Motion' : 'Decorative effects Off'} is on, so NMSh writes no Kitty effects. Turn it off first; R still removes existing ones.`);
    }
    const active = gatedEffects(settings, catalog, context.gates);
    if (mode === 'save' && !active.length) throw new Error('The cursor renderer is Portable, so NMSh draws the trail itself and adds no Kitty trail. Choose Auto or Host native in /cursor.');
    const state = owned(context);
    const inspection = inspectKittyShaders(context);
    if (inspection.problems.length) throw new Error(inspection.problems.join(' '));
    if (mode === 'sync' && inspection.drifted) throw new Error('Your custom_shaders changed since NMSh composed with it; open /appearance › Kitty shaders and review an updated plan.');
    const {paths} = state;
    if (/['\\\u0000-\u001f\u007f$]/u.test(paths.pipeline) || /['"\\\u0000-\u001f\u007f$]/u.test(paths.fragment)) throw new Error('NMSh’s configuration path cannot be referenced safely from Kitty.');
    if (inspection.userEntries.some(entry => resolve(entry.replace(/^~(?=\/)/u, paths.home)) === paths.pipeline)) throw new Error('Your custom_shaders already names NMSh’s pipeline; remove it there first.');
    const notes = [...inspection.notes];
    const dependencies = [...inspection.dependencies];
    const userGroups = inspection.pipelines.flatMap(item => item.pipeline?.groups ?? []);
    const userTextures = new Set(inspection.pipelines.flatMap(item => item.pipeline ? pipelineTextures(item.pipeline) : []));
    const leaked = mergeVars(...inspection.pipelines.map(item => item.pipeline?.vars ?? []));
    for (const {preset} of active) {
      const texture = preset.textures.find(name => userTextures.has(name));
      if (texture) throw new Error(`${preset.definition.label} needs Kitty's shared texture “${texture}”, which one of your shaders already uses.`);
      if (preset.definition.category === 'cursor' && userGroups.some(subscribesToCursorTrail)) throw new Error(`Your custom_shaders already draws a cursor trail; NMSh will not add a second one (${preset.definition.label}).`);
      for (const shader of new Set(preset.groups.flatMap(group => group.shaders))) {
        // Kitty looks in NMSh's pipeline folder, then the kitty config folder, before its shipped shaders.
        for (const candidate of [join(paths.directory, `${shader}.slang`), join(inspection.configDirectory, `${shader}.slang`)]) {
          const file = snapshot(candidate, paths.home);
          dependencies.push(file);
          if (file.content !== undefined) throw new Error(`${candidate} would replace Kitty's shipped ${shader} shader; NMSh only tunes shipped shaders.`);
        }
      }
      if (preset.definition.requires === 'cursor_trail') notes.push(`${preset.definition.label} draws only while cursor_trail is above 0 (now ${inspection.cursorTrail}); /cursor Motion › Tail with Kitty native sets it.`);
      if (preset.definition.requires === 'opaque' && inspection.backgroundOpacity < 1) notes.push(`${preset.definition.label} does not work with background_opacity ${inspection.backgroundOpacity} (Kitty's own note).`);
    }
    const pipeline = buildNmshPipeline(active, catalog, leaked);
    if (userGroups.length + pipeline.groups.length > KITTY_MAX_GROUPS) throw new Error(`Kitty allows ${KITTY_MAX_GROUPS} shader groups in total; your shaders use ${userGroups.length} and these effects need ${pipeline.groups.length}.`);
    const header = ['Managed by NMSh (/appearance › Kitty shaders). Edits here are replaced; remove with R there.',
      ...active.map(({preset}) => `${preset.definition.label}: Kitty ${preset.origin.kittyVersion} shipped ${preset.origin.resources.map(item => `${item.name} sha256:${item.sha256.slice(0, 12)}`).join(', ')}`)];
    const pipelineText = active.length ? emitKittyPipeline(pipeline, header) : `${header.map(line => `# ${line}`).join('\n')}\n# No NMSh effect is active (Reduced Motion, Effects Off or a Portable cursor).\n`;
    if (active.length && !parseKittyPipeline(pipelineText, 'nmsh').ok) throw new Error('NMSh generated a pipeline Kitty would reject; nothing was changed.');
    const ours = quoteWord(paths.pipeline);
    const composed = !active.length ? undefined : inspection.userRaw ? (settings.placement === 'before' ? `${ours} ${inspection.userRaw}` : `${inspection.userRaw} ${ours}`) : ours;
    const expected = !active.length ? inspection.userEntries : settings.placement === 'before' ? [paths.pipeline, ...inspection.userEntries] : [...inspection.userEntries, paths.pipeline];
    const fragmentText = `${FRAGMENT_HEADER}${composed ? `custom_shaders ${composed}\n` : '# No NMSh effect is active; your own custom_shaders applies unchanged.\n'}`;
    if (state.record && state.record.hostPath !== inspection.hostPath) throw new Error('Kitty’s configuration file changed; remove the old integration before setting up this one.');
    const hostFile = snapshot(inspection.hostPath, paths.home, true);
    const original = hostFile.content ?? '';
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const hook = state.record?.hook ?? `${original && !original.endsWith('\n') ? newline : ''}${newline}${HOOK_COMMENT}${newline}include ${paths.fragment}${newline}`;
    if (state.record && original.split(hook).length !== 2) throw new Error('The recorded Kitty shader include was changed or duplicated; nothing was changed.');
    if (!state.record && original.includes(paths.fragment)) throw new Error('An unrecorded NMSh Kitty shader include already exists; remove it manually before setup.');
    if (mode === 'sync' && !state.record) throw new Error('Kitty shaders are not set up.');
    const hostAfter = state.record ? original : `${original}${hook}`;
    // Prove the effective value is exactly the composed list, from NMSh's fragment.
    const simulated = readHostConfiguration('kitty', context, new Map([[hostFile.path, hostAfter], [paths.fragment, fragmentText]]));
    if (simulated.problems.length) throw new Error(simulated.problems.join(' '));
    const effective = simulated.values.get('custom_shaders');
    const effectiveWords = shellWords(effective?.raw ?? '') ?? [];
    if (active.length && (effective?.path !== paths.fragment || JSON.stringify(effectiveWords) !== JSON.stringify(expected))) {
      throw new Error('A later or unresolved custom_shaders line would override NMSh’s composed list. Resolve that explicitly; no files were changed.');
    }
    const record: ShaderLedger = {version: 1, feature: 'kitty-shaders', hostPath: hostFile.path, hook, fragmentHash: digest(fragmentText), pipelineHash: digest(pipelineText),
      created: state.record?.created ?? hostFile.content === undefined, preserved: inspection.userRaw, placement: settings.placement, kittyVersion: catalog.version,
      presets: active.map(({preset}) => ({id: preset.definition.id, resources: preset.origin.resources}))};
    const ledgerText = `${JSON.stringify(record, null, 2)}\n`;
    const changes: FileChange[] = [{before: state.pipeline, after: pipelineText}, {before: state.fragment, after: fragmentText},
      ...(state.record ? [] : [{before: hostFile, after: hostAfter}]), {before: state.ledger, after: ledgerText}];
    const kept = inspection.userEntries.length ? `Kept, in order: ${inspection.userEntries.join(' · ')}` : 'You have no custom_shaders of your own.';
    const shadowedNote = inspection.shadowed.length ? [`Kitty already ignores earlier custom_shaders lines at ${inspection.shadowed.join(', ')} (a later line replaces them); they are unchanged.`] : [];
    const preview = [kept, ...shadowedNote, `Effective after this change: ${effectiveWords.length ? effectiveWords.join(' · ') : '(none)'}`, '',
      ...previewFile(hostFile.path, hostFile.content, state.record ? hostFile.content : hostAfter), ...previewFile(paths.fragment, state.fragment.content, fragmentText),
      ...previewFile(paths.pipeline, state.pipeline.content, pipelineText), ...(notes.length ? ['', ...notes] : [])];
    return {ok: true, plan: {host: 'kitty', operation: mode, hostPath: hostFile.path, fragmentPath: paths.fragment, pipelinePath: paths.pipeline, preview, notes,
      guidance: kittyShaderGuidance(context.platform), home: paths.home, changes, dependencies: [...dependencies, ...(state.record ? [hostFile] : [])], pipelineText,
      effectiveShaders: effectiveWords}};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

/** A reviewed plan for the selected effects: exact files, exact effective list, or a refusal with the reason. */
export function planKittyShaders(settings: KittyShaderSettings, context: KittyShaderContext): KittyShaderPlanResult { return compose(settings, context, 'save'); }

/**
 * After setup, keep NMSh's own pipeline in step with Reduced Motion, Effects Off and the cursor renderer (never two trails).
 * Only NMSh-owned files change; anything that would need a new review returns a reason instead of writing.
 */
export function syncKittyShaders(settings: KittyShaderSettings, context: KittyShaderContext): {kind: 'none' | 'unchanged' | 'written'; message?: string} | {kind: 'review'; message: string} {
  let state: ReturnType<typeof owned>;
  try { state = owned(context); } catch (error) { return {kind: 'review', message: error instanceof Error ? error.message : String(error)}; }
  const record = state.record;
  if (!record) return {kind: 'none'};
  // Taking every NMSh effect out is always safe (the person's own value then applies unchanged), so it never waits for a review.
  if (!context.catalog.supported || !gatedEffects(settings, context.catalog, context.gates).length) {
    const pipelineText = `# Managed by NMSh (/appearance › Kitty shaders). Edits here are replaced; remove with R there.\n# No NMSh effect is active (Reduced Motion, Effects Off or a Portable cursor).\n`;
    const fragmentText = `${FRAGMENT_HEADER}# No NMSh effect is active; your own custom_shaders applies unchanged.\n`;
    if (state.pipeline.content === pipelineText && state.fragment.content === fragmentText) return {kind: 'unchanged'};
    const ledgerText = `${JSON.stringify({...record, fragmentHash: digest(fragmentText), pipelineHash: digest(pipelineText), presets: []}, null, 2)}\n`;
    try { transact([{before: state.pipeline, after: pipelineText}, {before: state.fragment, after: fragmentText}, {before: state.ledger, after: ledgerText}], [], state.paths.home); }
    catch (error) { return {kind: 'review', message: error instanceof Error ? error.message : String(error)}; }
    return {kind: 'written', message: `NMSh's Kitty effects are off · ${kittyShaderGuidance(context.platform)}`};
  }
  // The reviewed composition already passed the launch check; adding NMSh's reviewed groups back does not repeat it.
  const planned = compose(settings, {...context, launch: {}}, 'sync');
  if (!planned.ok) return {kind: 'review', message: planned.error};
  if (planned.plan.changes.every(change => change.after === change.before.content || change.before.path === kittyShaderPaths(context).ledger)) return {kind: 'unchanged'};
  const applied = applyKittyShaderPlan(planned.plan);
  return applied.ok ? {kind: 'written', message: `Kitty shaders updated · ${planned.plan.guidance}`} : {kind: 'review', message: applied.error};
}

export function planKittyShaderRemoval(context: AppearanceContext): KittyShaderPlanResult {
  try {
    const state = owned(context, true);
    if (!state.record) throw new Error('No NMSh-owned Kitty shader integration is recorded.');
    const hostFile = snapshot(state.record.hostPath, state.paths.home, true);
    const content = hostFile.content ?? '';
    const hooks = content.split(state.record.hook).length - 1;
    if (hooks > 1) throw new Error('The owned Kitty shader include is duplicated; it was preserved.');
    // Intact owned files are deleted; a missing one needs nothing; one edited outside NMSh is kept (unreferenced once the hook is gone).
    const own: FileChange[] = [...(state.damaged.has('fragment') ? [] : [{before: state.fragment}]), ...(state.damaged.has('pipeline') ? [] : [{before: state.pipeline}]), {before: state.ledger}];
    const notes = [...state.damaged].map(([label, kind]) => kind === 'missing' ? `NMSh's Kitty shader ${label} is already missing.`
      : `NMSh's Kitty shader ${label} was edited outside NMSh; it is kept as it is and no longer included.`);
    const guidance = kittyShaderGuidance(context.platform);
    const base = {host: 'kitty' as const, operation: 'remove' as const, hostPath: hostFile.path, fragmentPath: state.paths.fragment, pipelinePath: state.paths.pipeline, notes,
      guidance, home: state.paths.home, pipelineText: '', effectiveShaders: shellWords(state.record.preserved) ?? []};
    const ownPreview = [...own.map(change => `- ${change.before.path} (NMSh-owned)`), ...notes];
    if (hooks === 0) {
      return {ok: true, plan: {...base, changes: own, dependencies: [hostFile],
        preview: [`The NMSh include is already absent from ${hostFile.path}; that file is not changed.`, ...ownPreview]}};
    }
    const after = withoutHook(content, state.record.hook);
    return {ok: true, plan: {...base, changes: [{before: hostFile, after: state.record.created && after === '' ? undefined : after}, ...own], dependencies: [],
      preview: [`File: ${hostFile.path}`, ...state.record.hook.trim().split(/\r?\n/u).map(line => `- ${line}`), ...ownPreview,
        `Your own custom_shaders applies again: ${state.record.preserved || '(none)'}`]}};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

export function applyKittyShaderPlan(plan: KittyShaderPlan): {ok: true} | {ok: false; error: string} {
  try { transact(plan.changes, plan.dependencies, plan.home); return {ok: true}; }
  catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

export const categoryLabel = (preset: OfferedPreset) => CATEGORY_LABELS[preset.definition.category];

/** Flags in Kitty's own command line (or macOS launch-services file) that would change which custom_shaders Kitty loads. */
export function launchOverrideReason(commandLine: string): string | undefined {
  const words = commandLine.split(/\s+/u).filter(Boolean);
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    const next = words[index + 1] ?? '';
    if (word === '-c' || word === '--config' || word.startsWith('--config=') || (word.startsWith('-c') && word.length > 2 && !word.startsWith('--'))) {
      return 'Kitty was started with its own --config file, so NMSh cannot tell which configuration it loads; nothing will be changed.';
    }
    const override = word === '-o' || word === '--override' ? next : word.startsWith('--override=') ? word.slice('--override='.length) : word.startsWith('-o') && !word.startsWith('--') ? word.slice(2) : undefined;
    if (override !== undefined && /^(custom_shaders|cursor_trail)\b/u.test(override)) return `Kitty was started with an override (${override.split(/[=\s]/u)[0]}) that replaces its configuration; NMSh will not compose shaders it cannot see.`;
  }
  return undefined;
}

/**
 * Inspect the running Kitty's launch options read-only (`ps` of KITTY_PID) and
 * the macOS launch-services command line. When they cannot be inspected, setup
 * is refused rather than assuming nothing overrides custom_shaders.
 */
export function inspectKittyLaunch(context: AppearanceContext, readCommand: (pid: number) => string | undefined): KittyLaunch {
  const pid = Number(context.env.KITTY_PID);
  if (!Number.isSafeInteger(pid) || pid <= 1) return {refusal: 'NMSh is not running directly in Kitty (no KITTY_PID), so Kitty’s launch options cannot be checked; open /appearance from a Kitty window.'};
  const command = readCommand(pid);
  if (command === undefined) return {refusal: 'Kitty’s launch options could not be read, so NMSh cannot rule out a custom_shaders override; nothing will be changed.'};
  const reason = launchOverrideReason(command);
  if (reason) return {refusal: reason};
  const paths = kittyShaderPaths(context);
  for (const directory of [...new Set([context.env.KITTY_CONFIG_DIRECTORY, dirname(paths.candidates[0]!), ...(context.platform === 'darwin' ? [dirname(paths.candidates.at(-1)!)] : [])].filter(Boolean))] as string[]) {
    try {
      const file = snapshot(join(directory, 'macos-launch-services-cmdline'), paths.home);
      const fromFile = file.content !== undefined ? launchOverrideReason(file.content) : undefined;
      if (fromFile) return {refusal: `${fromFile} (macos-launch-services-cmdline)`};
    } catch { return {refusal: 'Kitty’s macOS launch options file cannot be inspected safely; nothing will be changed.'}; }
  }
  return {};
}

/** One process's command line, read-only, bounded; undefined when it cannot be read. */
export function readProcessCommand(pid: number): string | undefined {
  try {
    const output = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore']}).trim();
    return output || undefined;
  } catch { return undefined; }
}

/** The trail shader NMSh's written Kitty pipeline contains right now, if its fragment is active; never guessed from settings. */
/** NMSh's Kitty presets Kitty would load now (hook present, custom_shaders listing NMSh's pipeline), by preset id; [] when none. */
export function writtenKittyPresets(context: AppearanceContext): string[] {
  try {
    const state = owned(context);
    if (!state.record || !(snapshot(state.record.hostPath, state.paths.home).content ?? '').includes(state.record.hook)) return [];
    if (!/^custom_shaders /mu.test(state.fragment.content ?? '') || state.pipeline.content === undefined) return [];
    return state.record.presets.map(preset => preset.id);
  } catch { return []; }
}

export function writtenKittyTrail(context: AppearanceContext): string | undefined {
  try {
    const state = owned(context);
    if (!state.record || !(snapshot(state.record.hostPath, state.paths.home).content ?? '').includes(state.record.hook)) return undefined;
    if (!/^custom_shaders /mu.test(state.fragment.content ?? '')) return undefined;
    const trail = /^\s*shaders (cursor-trail-[a-z-]+)\s*$/mu.exec(state.pipeline.content ?? '')?.[1];
    if (!trail) return undefined;
    // Kitty's trail shaders draw only while cursor_trail is above 0; otherwise Kitty draws no trail and Portable must.
    const read = readHostConfiguration('kitty', context);
    return !read.problems.length && Number(read.values.get('cursor_trail')?.value ?? 0) > 0 ? trail : undefined;
  } catch { return undefined; }
}
