/**
 * NMSh-managed Ghostty custom shaders: inspection of the person's own shader
 * passes, composition, reviewed and owned writes, gate sync, removal and the
 * reload state that keeps native and Portable trails from overlapping.
 *
 * Ghostty's `custom-shader` is a REPEATABLE list (each line appends a pass; an
 * empty value clears the list; `?` marks an optional file; a relative path is
 * relative to the file that names it). Ghostty loads every default root file
 * before one appended queue of `config-file` includes, so NMSh's passes — in
 * NMSh's own included fragment — run after every pass listed in the person's
 * root files. NMSh never rewrites, reorders or removes the person's lines: it
 * simulates the whole configuration graph with its fragment and refuses when
 * that would not keep their passes, in their order, with NMSh's added.
 *
 * Files: one recorded optional include hook in the effective host file, NMSh's
 * fragment (`custom-shader = …` per pass), one generated `.glsl` per pass, and
 * an ownership ledger. Writes go through hostFiles' snapshot-verified
 * transaction (the reviewed Slice 1 primitive).
 */
import {execFileSync} from 'node:child_process';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {appearancePaths, type AppearanceContext} from './hostPaths.js';
import {readHostConfiguration, type ConfigurationRead} from './hostConfiguration.js';
import {digest, snapshot, transact, type FileChange, type FileSnapshot} from './hostFiles.js';
import {withoutHook} from './hostAppearance.js';
import {buildGhosttyCatalog, GHOSTTY_MAX_EFFECTS, generateGhosttyShader, paramError, type GenerationContext, type GhosttyCatalog, type GhosttyOfferedPreset} from './ghosttyShaderCatalog.js';
import type {GhosttyShaderSettings, KittyShaderEffect} from './kittyShaderSettings.js';
import type {CursorMotion, CursorRenderer} from '../prompt/configuration.js';
import {fragmentPath as cursorFragmentPath, ghosttyCursorFragment, shaderPath as cursorShaderPath} from '../cursor/native.js';

export interface GhosttyShaderGates {reducedMotion: boolean; effectsOff: boolean; cursorRenderer: CursorRenderer; cursorMotion: CursorMotion}

/** Why a trail cannot be native right now (undefined when it can). /cursor decides whether there is a trail; the studio decides its look. */
export function trailGateReason(gates: GhosttyShaderGates): string | undefined {
  if (gates.cursorRenderer === 'portable') return 'The cursor renderer is Portable, so NMSh draws the trail itself and adds no Ghostty trail.';
  if (gates.cursorMotion !== 'smear' && gates.cursorMotion !== 'tail') return `/cursor Motion is ${gates.cursorMotion === 'off' ? 'Off' : 'Smooth (a caret glide, not a trail)'}, so no Ghostty trail is drawn; choose Smear or Tail there.`;
  return undefined;
}

/** What NMSh's passes may contain now: nothing under Reduced Motion or Effects Off; trails only when /cursor wants a native trail. */
export function gatedGhosttyEffects(settings: GhosttyShaderSettings, catalog: GhosttyCatalog, gates: GhosttyShaderGates): Array<{preset: GhosttyOfferedPreset; effect: KittyShaderEffect}> {
  if (gates.reducedMotion || gates.effectsOff) return [];
  return settings.effects.filter(effect => effect.enabled).flatMap(effect => {
    const preset = catalog.offered.find(item => item.definition.id === effect.id);
    if (!preset || (preset.definition.trail && trailGateReason(gates))) return [];
    return [{preset, effect}];
  });
}

/** Every reason saved settings cannot be applied to THIS Ghostty; nothing is clamped or invented. */
export function validateGhosttyEffects(settings: GhosttyShaderSettings, catalog: GhosttyCatalog): string[] {
  const errors: string[] = [];
  const exclusive = new Map<string, string>();
  for (const effect of settings.effects) {
    const preset = catalog.offered.find(item => item.definition.id === effect.id);
    if (!preset) { errors.push(`${effect.id} is not offered for Ghostty ${catalog.version || '(unknown)'}.`); continue; }
    const {definition} = preset;
    for (const [name, value] of Object.entries(effect.values)) {
      const param = preset.params.find(item => item.name === name);
      if (!param) { errors.push(`${definition.label}: ${name} is not a setting of this shader.`); continue; }
      const problem = paramError(param, value);
      if (problem) errors.push(`${definition.label}: ${param.label} ${problem}.`);
    }
    if (effect.enabled && definition.exclusive) {
      const other = exclusive.get(definition.exclusive);
      if (other) errors.push(`${definition.label} and ${other} cannot run together (one cursor trail).`);
      exclusive.set(definition.exclusive, definition.label);
    }
  }
  if (settings.effects.filter(effect => effect.enabled).length > GHOSTTY_MAX_EFFECTS) errors.push(`At most ${GHOSTTY_MAX_EFFECTS} NMSh effects can run at once (each is a full-window pass).`);
  return errors;
}

// ---- Paths, ledger -----------------------------------------------------------------------------------------------

export function ghosttyShaderPaths(context: AppearanceContext) {
  const base = appearancePaths('ghostty', context);
  return {...base, fragment: join(base.directory, 'ghostty-shaders.conf'), shaderDirectory: join(base.directory, 'ghostty-shaders'),
    ledger: join(base.directory, 'ghostty-shaders.json'), reload: join(base.directory, 'ghostty-reload.json')};
}
const passPath = (paths: ReturnType<typeof ghosttyShaderPaths>, id: string) => join(paths.shaderDirectory, `${id}.glsl`);
const HOOK_COMMENT = '# NMSh Ghostty shaders (remove using /appearance)';
const FRAGMENT_HEADER = '# Managed by NMSh (/appearance › Ghostty shaders). Your own custom-shader lines are never changed; these passes run after them.\n';
const INACTIVE_FRAGMENT = `${FRAGMENT_HEADER}# No NMSh effect is active (Reduced Motion, Effects Off, or none chosen).\n`;

interface GhosttyLedger {
  version: 1; feature: 'ghostty-shaders'; hostPath: string; hook: string; fragmentHash: string; created: boolean;
  ghosttyVersion: string;
  passes: Array<{id: string; path: string; sha256: string}>;
  /** The trail preset written now, if any (Portable must not draw a second trail). */
  trail?: string;
  /** NMSh's older /cursor Ghostty shader was paused by this integration (removal resumes it in the same reviewed transaction). */
  legacyPaused?: boolean;
}

function owned(context: AppearanceContext, lenient = false) {
  const paths = ghosttyShaderPaths(context);
  const fragment = snapshot(paths.fragment, paths.home, true);
  const ledger = snapshot(paths.ledger, paths.home, true);
  let record: GhosttyLedger | undefined;
  if (ledger.content !== undefined) {
    let parsed: Partial<GhosttyLedger>;
    try { parsed = JSON.parse(ledger.content); } catch { throw new Error('The Ghostty shader ownership record is malformed; nothing will be overwritten.'); }
    const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
    if (parsed?.version !== 1 || parsed.feature !== 'ghostty-shaders' || typeof parsed.created !== 'boolean' || !paths.candidates.includes(parsed.hostPath ?? '')
      || typeof parsed.hook !== 'string' || !hash(parsed.fragmentHash) || !Array.isArray(parsed.passes)
      || !parsed.passes.every(pass => pass && typeof pass.id === 'string' && /^[a-z0-9-]{1,48}$/u.test(pass.id) && pass.path === passPath(paths, pass.id) && hash(pass.sha256))
      || (parsed.trail !== undefined && typeof parsed.trail !== 'string') || (parsed.legacyPaused !== undefined && typeof parsed.legacyPaused !== 'boolean')) throw new Error('The Ghostty shader ownership record is invalid.');
    record = parsed as GhosttyLedger;
    const newline = record.hook.includes('\r\n') ? '\r\n' : '\n';
    if (record.hook.replace(/\r\n/gu, '\n').trim() !== `${HOOK_COMMENT}\nconfig-file = ?${paths.fragment}` || !record.hook.endsWith(`config-file = ?${paths.fragment}${newline}`)) {
      throw new Error('The recorded include does not match NMSh’s own Ghostty shader hook.');
    }
  }
  const damaged = new Map<string, 'edited' | 'missing'>();
  const check = (file: FileSnapshot, expected: string | undefined, label: string) => {
    if (file.content !== undefined && (!record || digest(file.content) !== expected)) {
      if (lenient && record) { damaged.set(label, 'edited'); return; }
      throw new Error(`NMSh’s Ghostty ${label} is unowned or was edited outside NMSh; it was preserved.`);
    }
    if (record && expected !== undefined && file.content === undefined) {
      if (lenient) { damaged.set(label, 'missing'); return; }
      throw new Error(`NMSh’s recorded Ghostty ${label} is missing; R in /appearance › Ghostty shaders removes the integration.`);
    }
  };
  check(fragment, record?.fragmentHash, 'shader fragment');
  const passes = new Map<string, FileSnapshot>();
  for (const pass of record?.passes ?? []) {
    const file = snapshot(pass.path, paths.home, true);
    passes.set(pass.id, file);
    check(file, pass.sha256, `${pass.id} shader`);
  }
  return {paths, fragment, ledger, record, passes, damaged};
}

// ---- Reading the person's shaders ----------------------------------------------------------------------------------

export interface ShaderListEntry {raw: string; path: string; optional: boolean; source: string}

/** Ghostty's effective custom-shader list from a configuration read, with its RepeatablePath rules. */
export function effectiveShaderList(read: ConfigurationRead, home: string): {entries: ShaderListEntry[]; resets: string[]} {
  let entries: ShaderListEntry[] = [];
  const resets: string[] = [];
  for (const definition of read.definitions) {
    if (definition.key !== 'custom-shader') continue;
    const where = `${definition.path}:${definition.line}`;
    // An empty value clears every earlier pass; `?` alone or "" is ignored (Ghostty 1.2–1.4 path.zig).
    if (definition.raw === '') { entries = []; resets.push(where); continue; }
    let value = definition.raw;
    const optional = value.startsWith('?');
    if (optional) value = value.slice(1);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!value) continue;
    const path = value.startsWith('~/') ? resolve(home, value.slice(2)) : isAbsolute(value) ? value : resolve(dirname(definition.path), value);
    entries.push({raw: definition.raw, path, optional, source: where});
  }
  return {entries, resets};
}

const CURSOR_UNIFORMS = /\b(iCurrentCursor|iPreviousCursor|iTimeCursorChange)\b/u;
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');

export interface GhosttyShaderEntry extends ShaderListEntry {
  owner: 'person' | 'nmsh-cursor';
  state: 'readable' | 'missing' | 'unreadable';
  /** Reads Ghostty's cursor-change uniforms: almost certainly a cursor trail or cursor effect. */
  cursor: boolean;
  reason?: string;
}

export interface GhosttyLaunch {
  /** Ghostty's own command line sets shader or config options NMSh cannot see; nothing will be composed. */
  refusal?: string;
  note?: string;
  /** When the Ghostty process NMSh runs in started (ms since epoch), if found. */
  startedAt?: number;
}

export interface GhosttyShaderInspection {
  hostPath: string;
  /** Ghostty's effective pass list without NMSh's studio passes, in order. */
  entries: GhosttyShaderEntry[];
  /** Display labels for the person's own passes (shared studio panel). */
  userEntries: string[];
  /** Where a `custom-shader =` line clears earlier passes. */
  resets: string[];
  animation: {value: string; source: 'default' | 'person' | 'nmsh-cursor'};
  /** NMSh's older /cursor shader is in the effective list. */
  cursorShaderActive: boolean;
  problems: string[];
  notes: string[];
  dependencies: FileSnapshot[];
  configured: boolean;
  drifted: false;
  activePresets: string[];
  trail?: string;
}

export interface GhosttyShaderContext extends AppearanceContext {catalog: GhosttyCatalog; gates: GhosttyShaderGates; launch: GhosttyLaunch; colors: GenerationContext}

export function inspectGhosttyShaders(context: AppearanceContext & {launch?: GhosttyLaunch}): GhosttyShaderInspection {
  const paths = ghosttyShaderPaths(context);
  const result: GhosttyShaderInspection = {hostPath: paths.fallback, entries: [], userEntries: [], resets: [], animation: {value: 'true', source: 'default'}, cursorShaderActive: false,
    problems: [], notes: [], dependencies: [], configured: false, drifted: false, activePresets: []};
  let record: GhosttyLedger | undefined;
  try { record = owned(context).record; } catch (error) { result.problems.push(error instanceof Error ? error.message : String(error)); }
  // NMSh's studio fragment reads as empty, leaving exactly what the rest of the configuration says.
  const read = readHostConfiguration('ghostty', context, new Map([[paths.fragment, '']]));
  result.hostPath = read.hostPath;
  result.problems.push(...read.problems);
  result.dependencies.push(...read.files);
  if (context.launch?.refusal) result.problems.push(context.launch.refusal);
  if (context.launch?.note) result.notes.push(context.launch.note);
  const legacyShader = cursorShaderPath(context.env);
  const legacyFragment = cursorFragmentPath('ghostty', context.env);
  const list = effectiveShaderList(read, paths.home);
  result.resets = list.resets;
  for (const entry of list.entries) {
    if (entry.path === legacyShader) { result.entries.push({...entry, owner: 'nmsh-cursor', state: 'readable', cursor: true}); result.cursorShaderActive = true; continue; }
    let item: GhosttyShaderEntry;
    try {
      const file = snapshot(entry.path, paths.home);
      result.dependencies.push(file);
      item = file.content === undefined ? {...entry, owner: 'person', state: 'missing', cursor: false}
        : {...entry, owner: 'person', state: 'readable', cursor: CURSOR_UNIFORMS.test(stripComments(file.content))};
    } catch (error) {
      item = {...entry, owner: 'person', state: 'unreadable', cursor: false, reason: error instanceof Error ? error.message : String(error)};
    }
    result.entries.push(item);
    if (item.state === 'missing') result.notes.push(`Ghostty cannot find your shader ${entry.path} (${entry.source}); it is kept as written${entry.optional ? '' : ' and Ghostty logs it'}.`);
  }
  result.userEntries = result.entries.map(entry => entry.owner === 'nmsh-cursor' ? 'NMSh /cursor shader' : basename(entry.path));
  const animation = read.values.get('custom-shader-animation');
  if (animation) result.animation = {value: animation.value, source: animation.path === legacyFragment ? 'nmsh-cursor' : 'person'};
  if (record) {
    result.configured = true;
    result.activePresets = record.passes.map(pass => pass.id);
    if (record.trail) result.trail = record.trail;
  }
  return result;
}

// ---- Composition -------------------------------------------------------------------------------------------------

export interface GhosttyShaderPlan {
  host: 'ghostty';
  operation: 'save' | 'remove' | 'sync';
  hostPath: string;
  fragmentPath: string;
  preview: string[];
  notes: string[];
  guidance: string;
  home: string;
  changes: readonly FileChange[];
  dependencies: readonly FileSnapshot[];
  /** NMSh's generated passes in order (for tests and the confirm-time re-check). */
  shaders: Array<{id: string; path: string; source: string}>;
  /** Ghostty's whole effective pass list after this plan. */
  effectiveShaders: string[];
  /** The trail Ghostty may draw before / after this plan ('nmsh-cursor' = NMSh's older /cursor shader). */
  trailBefore?: string;
  trailAfter?: string;
}
export type GhosttyShaderPlanResult = {ok: true; plan: GhosttyShaderPlan} | {ok: false; error: string};

export function ghosttyShaderGuidance(platform: NodeJS.Platform): string {
  return `Configuration saved, not proof of GPU output. Reload Ghostty’s configuration (${platform === 'darwin' ? '⌘⇧,' : 'Ctrl+Shift+,'}): Ghostty does not reload it by itself and NMSh never signals it. `
    + 'Ghostty compiles shaders after loading the configuration and only logs a shader that fails; if an effect does not appear, check Ghostty’s log.';
}

function previewFile(path: string, before: string | undefined, after: string | undefined, owned = true): string[] {
  if (before === after) return [];
  if (after === undefined) return [`File: ${path}`, '- (NMSh-owned file removed)'];
  if (before !== undefined && after.startsWith(before)) return [`File: ${path}`, ...after.slice(before.length).trimEnd().split(/\r?\n/u).filter(Boolean).map(line => `+ ${line}`)];
  return [`File: ${path}${owned ? ' (NMSh-owned)' : ''}`, ...after.trimEnd().split(/\r?\n/u).map(line => `+ ${line}`)];
}

const UNSAFE_PATH = /["'\\\u0000-\u001f\u007f$`]/u;

function compose(settings: GhosttyShaderSettings, context: GhosttyShaderContext, mode: 'save' | 'sync'): GhosttyShaderPlanResult {
  try {
    const {catalog, gates} = context;
    if (!catalog.supported) throw new Error(catalog.reason ?? 'Ghostty custom shaders are not available.');
    const errors = validateGhosttyEffects(settings, catalog);
    if (errors.length) throw new Error(errors.join(' '));
    const enabled = settings.effects.filter(effect => effect.enabled);
    if (mode === 'save' && !enabled.length) throw new Error('No Ghostty effect is enabled. Enable one, or press R to remove NMSh’s Ghostty shaders.');
    if (mode === 'save' && (gates.reducedMotion || gates.effectsOff)) {
      throw new Error(`${gates.reducedMotion ? 'Reduced Motion' : 'Decorative effects Off'} is on, so NMSh writes no Ghostty effects. Turn it off first; R still removes existing ones.`);
    }
    const active = gatedGhosttyEffects(settings, catalog, gates);
    if (mode === 'save' && !active.length) throw new Error(trailGateReason(gates) ?? 'Nothing to write.');
    const state = owned(context);
    const inspection = inspectGhosttyShaders(context);
    if (inspection.problems.length) throw new Error(inspection.problems.join(' '));
    const {paths} = state;
    if (UNSAFE_PATH.test(paths.fragment) || UNSAFE_PATH.test(paths.shaderDirectory)) throw new Error('NMSh’s configuration path cannot be referenced safely from Ghostty.');
    const notes = [...inspection.notes];
    const dependencies = [...inspection.dependencies];
    const trail = active.find(item => item.preset.definition.trail);
    // Never two trails: the person's own cursor shader, or one NMSh cannot read, rules out a second.
    if (trail) {
      const theirs = inspection.entries.find(entry => entry.owner === 'person' && entry.cursor);
      if (theirs) throw new Error(`Your shader ${theirs.path} reads Ghostty’s cursor uniforms (a cursor trail or effect); NMSh will not add a second trail (${trail.preset.definition.label}).`);
      const unknown = inspection.entries.find(entry => entry.owner === 'person' && entry.state === 'unreadable');
      if (unknown) throw new Error(`NMSh cannot read your shader ${unknown.path} (${unknown.reason}), so it cannot rule out a second cursor trail.`);
    }
    if (inspection.entries.some(entry => entry.path.startsWith(`${paths.shaderDirectory}/`))) throw new Error('Your configuration already names a file in NMSh’s Ghostty shader folder; remove that line first.');
    const shaders = active.map(({preset, effect}) => ({id: preset.definition.id, path: passPath(paths, preset.definition.id), source: generateGhosttyShader(preset.definition, effect.values, context.colors).source}));
    for (const shader of shaders) if (!state.passes.has(shader.id)) {
      const file = snapshot(shader.path, paths.home, true);
      if (file.content !== undefined) throw new Error(`${shader.path} exists but is not recorded as NMSh’s; it was preserved.`);
      state.passes.set(shader.id, file);
    }
    for (const {preset} of active) {
      if (preset.definition.animated) notes.push(`${preset.definition.label} animates every frame while Ghostty is focused (custom-shader-animation)${inspection.animation.value === 'false' ? '; yours is false, so it only moves when the terminal redraws' : ''}.`);
    }
    if (trail && inspection.animation.value === 'false') notes.push(`Your custom-shader-animation is false: ${trail.preset.definition.label} only advances when the terminal redraws, so it may not fade smoothly. NMSh does not change that setting.`);
    // Ghostty runs its animation loop on the focused surface whenever any custom shader is listed, whatever the shader draws.
    if (active.length) notes.push(`While any custom shader is listed, Ghostty ${inspection.animation.value === 'false' ? 'redraws only when the terminal updates (your custom-shader-animation is false)'
      : inspection.animation.value === 'always' ? 'runs its animation loop on every surface, focused or not (your custom-shader-animation is always)'
        : 'runs its animation loop on the focused surface (custom-shader-animation true, the default)'}; NMSh does not change that setting.`);
    const fragmentText = active.length ? `${FRAGMENT_HEADER}${shaders.map(shader => `custom-shader = ${shader.path}`).join('\n')}\n` : INACTIVE_FRAGMENT;
    if (state.record && state.record.hostPath !== inspection.hostPath) throw new Error('Ghostty’s configuration file changed; remove the old integration before setting up this one.');
    if (mode === 'sync' && !state.record) throw new Error('Ghostty shaders are not set up.');
    const hostFile = snapshot(inspection.hostPath, paths.home, true);
    const original = hostFile.content ?? '';
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const hook = state.record?.hook ?? `${original && !original.endsWith('\n') ? newline : ''}${newline}${HOOK_COMMENT}${newline}config-file = ?${paths.fragment}${newline}`;
    if (state.record && original.split(hook).length !== 2) throw new Error('The recorded Ghostty shader include was changed or duplicated; nothing was changed.');
    if (!state.record && original.includes(paths.fragment)) throw new Error('An unrecorded NMSh Ghostty shader include already exists; remove it manually before setup.');
    const hostAfter = state.record ? original : `${original}${hook}`;
    // NMSh's older /cursor shader pauses while a studio trail is written (it would be a second trail).
    const legacyPath = cursorFragmentPath('ghostty', context.env);
    const legacy = snapshot(legacyPath, paths.home, true);
    const legacyOn = ghosttyCursorFragment(true, context.env);
    const legacyAfter = trail && legacy.content === legacyOn ? ghosttyCursorFragment(false, context.env) : legacy.content;
    const legacyPaused = Boolean(state.record?.legacyPaused) || legacyAfter !== legacy.content;
    if (trail && inspection.cursorShaderActive && legacy.content !== legacyOn) throw new Error('NMSh’s /cursor Ghostty file was edited outside NMSh, so NMSh cannot pause its shader for this trail.');
    // Prove the result: the person's passes unchanged and in order, NMSh's passes present in order.
    const overrides = new Map([[hostFile.path, hostAfter], [paths.fragment, fragmentText], ...(legacyAfter !== undefined && legacyAfter !== legacy.content ? [[legacyPath, legacyAfter] as [string, string]] : [])]);
    const simulated = readHostConfiguration('ghostty', context, overrides);
    if (simulated.problems.length) throw new Error(simulated.problems.join(' '));
    const effective = effectiveShaderList(simulated, paths.home).entries.map(entry => entry.path);
    const ours = new Set(shaders.map(shader => shader.path));
    const theirsBefore = inspection.entries.filter(entry => entry.owner === 'person').map(entry => entry.path);
    const theirsAfter = effective.filter(path => !ours.has(path) && path !== cursorShaderPath(context.env));
    if (JSON.stringify(effective.filter(path => ours.has(path))) !== JSON.stringify(shaders.map(shader => shader.path))) {
      throw new Error('A later `custom-shader =` line (which clears the list) or an unresolved include would drop NMSh’s passes. Resolve that explicitly; no files were changed.');
    }
    if (JSON.stringify(theirsAfter) !== JSON.stringify(theirsBefore)) throw new Error('NMSh’s change would alter your own shader passes; nothing was changed.');
    const trailAfter = trail?.preset.definition.id;
    const record: GhosttyLedger = {version: 1, feature: 'ghostty-shaders', hostPath: hostFile.path, hook, fragmentHash: digest(fragmentText), created: state.record?.created ?? hostFile.content === undefined,
      ghosttyVersion: catalog.version, passes: shaders.map(shader => ({id: shader.id, path: shader.path, sha256: digest(shader.source)})), ...(trailAfter ? {trail: trailAfter} : {}),
      ...(legacyPaused ? {legacyPaused: true} : {})};
    const stale = [...state.passes.entries()].filter(([id, file]) => !shaders.some(shader => shader.id === id) && file.content !== undefined).map(([, file]) => ({before: file} as FileChange));
    const changes: FileChange[] = [...shaders.map(shader => ({before: state.passes.get(shader.id)!, after: shader.source})), ...stale, {before: state.fragment, after: fragmentText},
      ...(state.record ? [] : [{before: hostFile, after: hostAfter}]), ...(legacyAfter !== legacy.content ? [{before: legacy, after: legacyAfter}] : []),
      {before: state.ledger, after: `${JSON.stringify(record, null, 2)}\n`}];
    const kept = theirsBefore.length ? `Kept, in order: ${theirsBefore.map(path => basename(path)).join(' · ')}` : 'You have no custom shaders of your own.';
    const resetNote = inspection.resets.length ? [`A \`custom-shader =\` line at ${inspection.resets.join(', ')} clears earlier passes; it is unchanged.`] : [];
    const legacyNote = legacyAfter !== legacy.content ? ['NMSh’s older /cursor Ghostty shader pauses while this trail is written (never two trails); it returns if the trail is removed.'] : [];
    const preview = [kept, ...resetNote, `Effective after this change: ${effective.length ? effective.map(path => basename(path)).join(' · ') : '(none)'}`, ...legacyNote, '',
      ...previewFile(hostFile.path, hostFile.content, hostAfter, false), ...previewFile(paths.fragment, state.fragment.content, fragmentText),
      ...shaders.flatMap(shader => previewFile(shader.path, state.passes.get(shader.id)?.content, shader.source)),
      ...stale.flatMap(change => previewFile(change.before.path, change.before.content, undefined)),
      ...(legacyAfter !== legacy.content ? previewFile(legacyPath, legacy.content, legacyAfter) : []), ...(notes.length ? ['', ...notes] : [])];
    const trailBefore = state.record?.trail ?? (inspection.cursorShaderActive ? 'nmsh-cursor' : undefined);
    return {ok: true, plan: {host: 'ghostty', operation: mode, hostPath: hostFile.path, fragmentPath: paths.fragment, preview, notes, guidance: ghosttyShaderGuidance(context.platform),
      home: paths.home, changes, dependencies: [...dependencies, ...(state.record ? [hostFile] : [])], shaders, effectiveShaders: effective,
      ...(trailBefore ? {trailBefore} : {}), ...(trailAfter ? {trailAfter} : {})}};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

/** A reviewed plan for the selected effects: exact files and effective pass list, or a refusal with the reason. */
export function planGhosttyShaders(settings: GhosttyShaderSettings, context: GhosttyShaderContext): GhosttyShaderPlanResult { return compose(settings, context, 'save'); }

export type GhosttySyncResult = {kind: 'none' | 'unchanged'} | {kind: 'written'; message: string; trailBefore?: string; trailAfter?: string} | {kind: 'review'; message: string};

/**
 * After setup, keep NMSh's passes in step with Reduced Motion, Effects Off and /cursor (renderer, motion, colors).
 * Only NMSh-owned files change; taking every effect out never waits for a review.
 */
export function syncGhosttyShaders(settings: GhosttyShaderSettings, context: GhosttyShaderContext): GhosttySyncResult {
  let state: ReturnType<typeof owned>;
  try { state = owned(context); } catch (error) { return {kind: 'review', message: error instanceof Error ? error.message : String(error)}; }
  const record = state.record;
  if (!record) return {kind: 'none'};
  // Inside tmux or ssh the running Ghostty's version is HIDDEN: keep using the version the setup was reviewed with, so a gate
  // change still updates (or removes) NMSh's passes. A version known to be unsupported is not overridden: passes come out.
  if (!context.catalog.supported && context.catalog.capability.hidden) context = {...context, catalog: buildGhosttyCatalog(record.ghosttyVersion)};
  if (!context.catalog.supported || !gatedGhosttyEffects(settings, context.catalog, context.gates).length) {
    if (state.fragment.content === INACTIVE_FRAGMENT && !record.passes.length) return {kind: 'unchanged'};
    const removals: FileChange[] = [...state.passes.values()].filter(file => file.content !== undefined).map(file => ({before: file}));
    const {trail: _trail, ...rest} = record;
    const ledgerText = `${JSON.stringify({...rest, fragmentHash: digest(INACTIVE_FRAGMENT), passes: []}, null, 2)}\n`;
    try { transact([...removals, {before: state.fragment, after: INACTIVE_FRAGMENT}, {before: state.ledger, after: ledgerText}], [], state.paths.home, {source: 'ghostty-shaders', label: 'ghostty-shaders synchronization', directory: join(state.paths.directory,'..','backups')}); }
    catch (error) { return {kind: 'review', message: error instanceof Error ? error.message : String(error)}; }
    const why = context.catalog.supported ? '' : ` (${context.catalog.capability.reason ?? 'this Ghostty version is not supported'})`;
    return {kind: 'written', message: `NMSh’s Ghostty effects are off${why} · ${ghosttyShaderGuidance(context.platform)}`, ...(record.trail ? {trailBefore: record.trail} : {})};
  }
  // The reviewed setup already passed the launch check; putting NMSh's reviewed passes back does not repeat it.
  const planned = compose(settings, {...context, launch: {}}, 'sync');
  if (!planned.ok) return {kind: 'review', message: planned.error};
  if (planned.plan.changes.every(change => change.after === change.before.content || change.before.path === state.paths.ledger)) return {kind: 'unchanged'};
  const applied = applyGhosttyShaderPlan(planned.plan);
  return applied.ok ? {kind: 'written', message: `Ghostty shaders updated · ${planned.plan.guidance}`, ...(planned.plan.trailBefore ? {trailBefore: planned.plan.trailBefore} : {}),
    ...(planned.plan.trailAfter ? {trailAfter: planned.plan.trailAfter} : {})} : {kind: 'review', message: applied.error};
}

/**
 * `legacyActive`: whether NMSh's older /cursor Ghostty shader should be on under the current /cursor settings. When this
 * integration paused it, removal resumes it inside the same reviewed transaction (exact paused content only).
 */
export function planGhosttyShaderRemoval(context: AppearanceContext, options: {legacyActive?: boolean} = {}): GhosttyShaderPlanResult {
  try {
    const state = owned(context, true);
    if (!state.record) throw new Error('No NMSh-owned Ghostty shader integration is recorded.');
    const hostFile = snapshot(state.record.hostPath, state.paths.home, true);
    const content = hostFile.content ?? '';
    const hooks = content.split(state.record.hook).length - 1;
    if (hooks > 1) throw new Error('The owned Ghostty shader include is duplicated; it was preserved.');
    const intact = (label: string) => !state.damaged.has(label);
    const own: FileChange[] = [...(intact('shader fragment') && state.fragment.content !== undefined ? [{before: state.fragment}] : []),
      ...[...state.passes.entries()].filter(([id, file]) => intact(`${id} shader`) && file.content !== undefined).map(([, file]) => ({before: file})), {before: state.ledger}];
    const notes = [...state.damaged].map(([label, kind]) => kind === 'missing' ? `NMSh’s Ghostty ${label} is already missing.` : `NMSh’s Ghostty ${label} was edited outside NMSh; it is kept and no longer included.`);
    const legacyPath = cursorFragmentPath('ghostty', context.env);
    const legacy = state.record.legacyPaused ? snapshot(legacyPath, state.paths.home, true) : undefined;
    const resume = legacy && options.legacyActive && legacy.content === ghosttyCursorFragment(false, context.env) ? [{before: legacy, after: ghosttyCursorFragment(true, context.env)} as FileChange] : [];
    if (legacy && options.legacyActive && !resume.length && legacy.content !== ghosttyCursorFragment(true, context.env)) notes.push('NMSh’s older /cursor Ghostty file was changed while paused; it is left as it is.');
    own.push(...resume);
    const guidance = ghosttyShaderGuidance(context.platform);
    const base = {host: 'ghostty' as const, operation: 'remove' as const, hostPath: hostFile.path, fragmentPath: state.paths.fragment, notes, guidance, home: state.paths.home,
      shaders: [], effectiveShaders: [], ...(state.record.trail ? {trailBefore: state.record.trail} : {})};
    const ownPreview = [...own.map(change => change.after === undefined ? `- ${change.before.path} (NMSh-owned)` : `~ ${change.before.path}: NMSh’s older /cursor shader resumes`), ...notes];
    if (hooks === 0) return {ok: true, plan: {...base, changes: own, dependencies: [hostFile], preview: [`The NMSh include is already absent from ${hostFile.path}; that file is not changed.`, ...ownPreview]}};
    const after = withoutHook(content, state.record.hook);
    return {ok: true, plan: {...base, changes: [{before: hostFile, after: state.record.created && after === '' ? undefined : after}, ...own], dependencies: [],
      preview: [`File: ${hostFile.path}`, ...state.record.hook.trim().split(/\r?\n/u).map(line => `- ${line}`), ...ownPreview, 'Your own custom-shader lines are unchanged and keep applying.']}};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

export function applyGhosttyShaderPlan(plan: GhosttyShaderPlan): {ok: true} | {ok: false; error: string} {
  try { transact(plan.changes, plan.dependencies, plan.home, {source: 'ghostty-shaders', directory: join(dirname(plan.fragmentPath),'..','backups'), label: 'ghostty-shaders configuration'}); return {ok: true}; }
  catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

// ---- Written state and reload ------------------------------------------------------------------------------------

/** The trail preset NMSh's written Ghostty configuration contains right now (hook present, pass listed); never guessed from settings. */
export function writtenGhosttyTrail(context: AppearanceContext): string | undefined {
  try {
    const state = owned(context);
    if (!state.record?.trail || !(snapshot(state.record.hostPath, state.paths.home).content ?? '').includes(state.record.hook)) return undefined;
    return (state.fragment.content ?? '').split('\n').includes(`custom-shader = ${passPath(state.paths, state.record.trail)}`) ? state.record.trail : undefined;
  } catch { return undefined; }
}

/** NMSh's passes Ghostty would load now (hook present and listed in the fragment), in order; [] when none or unreadable. */
export function writtenGhosttyPasses(context: AppearanceContext): string[] {
  try {
    const state = owned(context);
    if (!state.record || !(snapshot(state.record.hostPath, state.paths.home).content ?? '').includes(state.record.hook)) return [];
    const lines = (state.fragment.content ?? '').split('\n');
    return state.record.passes.map(pass => pass.id).filter(id => lines.includes(`custom-shader = ${passPath(state.paths, id)}`));
  } catch { return []; }
}

/** Every trail Ghostty may still have loaded since its last confirmed reload ('nmsh-cursor' first when present). */
interface ReloadRecord {version: 1; since: number; previous: string[]}
const strongest = (list: readonly string[]) => list.includes('nmsh-cursor') ? 'nmsh-cursor' : list[0];
function readReload(context: AppearanceContext): ReloadRecord | undefined {
  const paths = ghosttyShaderPaths(context);
  const file = snapshot(paths.reload, paths.home);
  if (file.content === undefined) return undefined;
  const record = JSON.parse(file.content) as {version?: number; since?: number; previous?: unknown};
  const previous = typeof record.previous === 'string' ? [record.previous] : Array.isArray(record.previous) ? record.previous.filter((item): item is string => typeof item === 'string') : [];
  return record.version === 1 && typeof record.since === 'number' && previous.length ? {version: 1, since: record.since, previous} : undefined;
}

/**
 * A native trail NMSh just stopped writing that Ghostty may still draw: Ghostty keeps its loaded shaders until
 * the person reloads its configuration, so Portable waits rather than draw a second trail. Cleared by the person
 * confirming the reload, or by a Ghostty process that started after the change.
 */
export function ghosttyReloadPending(context: AppearanceContext, launch?: GhosttyLaunch): string | undefined {
  try {
    const record = readReload(context);
    if (!record || (launch?.startedAt !== undefined && launch.startedAt > record.since)) return undefined;
    return strongest(record.previous);
  } catch { return undefined; }
}

/** Record (or clear, with undefined) the trail Ghostty may still draw until a reload. Only NMSh's own state file changes. */
export function setGhosttyReloadPending(context: AppearanceContext, previous: readonly string[] | undefined, now = Date.now()): void {
  const paths = ghosttyShaderPaths(context);
  const before = snapshot(paths.reload, paths.home, true);
  const after = !previous?.length ? undefined : `${JSON.stringify({version: 1, since: now, previous: [...new Set(previous)]} satisfies ReloadRecord)}\n`;
  if (before.content === after) return;
  transact([{before, after}], [], paths.home, {source: 'ghostty-shaders', label: 'Host reload state', directory: join(paths.directory,'..','backups')});
}

/**
 * After a written change: a trail that was (possibly) loaded and is now gone or different stays pending until a reload.
 * Successive changes before a reload ACCUMULATE (legacy → Smear → Comet keeps the older /cursor shader pending).
 */
export function noteGhosttyTrailChange(context: AppearanceContext, before: string | undefined, after: string | undefined, now = Date.now()): string | undefined {
  if (!before || before === after) return undefined;
  let earlier: string[] = [];
  try { earlier = readReload(context)?.previous ?? []; } catch { /* an unreadable record is replaced */ }
  const previous = [...earlier, before].filter(item => item !== after);
  setGhosttyReloadPending(context, previous.length ? previous : [before], now);
  return strongest(previous.length ? previous : [before]);
}

// ---- Launch ------------------------------------------------------------------------------------------------------

export interface ProcessRow {pid: number; ppid: number; elapsedSeconds: number; command: string}

/** `ps` etime: [[dd-]hh:]mm:ss. */
export function parseElapsed(text: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/u.exec(text.trim());
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

/** Flags on Ghostty's own command line that change which shaders or configuration it loads. */
export function ghosttyLaunchOverride(command: string): string | undefined {
  const flag = /(?:^|\s)--(custom-shader|config-file|config-default-files)(?:=|\s|$)/u.exec(command);
  return flag ? `Ghostty was started with --${flag[1]}, which NMSh cannot see in its configuration files; nothing will be changed.` : undefined;
}

/** Find the Ghostty process among NMSh's parents (read-only) and check its launch options. */
export function inspectGhosttyLaunch(rows: readonly ProcessRow[] | undefined, selfPid: number, now = Date.now()): GhosttyLaunch {
  const unseen = {note: 'NMSh could not find Ghostty among its parent processes (tmux, ssh or a session service), so Ghostty’s own command-line options are not checked.'};
  if (!rows) return unseen;
  const byPid = new Map(rows.map(row => [row.pid, row]));
  let current = byPid.get(selfPid);
  for (let depth = 0; current && depth < 16; depth++) {
    const program = current.command.split(/\s+/u)[0] ?? '';
    if (/(^|\/)ghostty$/u.test(program)) {
      const refusal = ghosttyLaunchOverride(current.command.slice(program.length));
      return {...(refusal ? {refusal} : {}), startedAt: now - current.elapsedSeconds * 1000};
    }
    current = current.ppid > 1 ? byPid.get(current.ppid) : undefined;
  }
  return unseen;
}

/** All processes' pid, parent, elapsed time and command (bounded, read-only); undefined when unavailable. */
export function readProcessTable(): ProcessRow[] | undefined {
  try {
    const output = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,etime=,command='], {encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']});
    return output.split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
      const elapsed = match ? parseElapsed(match[3]!) : undefined;
      return match && elapsed !== undefined ? [{pid: Number(match[1]), ppid: Number(match[2]), elapsedSeconds: elapsed, command: match[4]!}] : [];
    });
  } catch { return undefined; }
}
