/**
 * Kitty 0.49+ custom shader catalog: bounded data parsers for Kitty's
 * `.pipeline` grammar and the tunable `static const` declarations of its
 * shipped `.slang` shaders, plus discovery of the installed catalog through
 * Kitty's own packaged-resource API (`kitty +runpy`, no shader execution).
 *
 * Grammar and rules mirror kitty/shaders/slang.py at v0.49.2
 * (parse_pipeline_definition, parse_var_directive, merge_pipelines,
 * apply_pipeline_specializations). Nothing here compiles, runs or trusts
 * shader source: it is read as text and only literal declarations are used.
 */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {delimiter, join} from 'node:path';

export const KITTY_SHADER_MIN_VERSION = [0, 49] as const;
/** Kitty's MAX_CUSTOM_SHADER_GROUPS: the limit for one pipeline and for all chained pipelines together. */
export const KITTY_MAX_GROUPS = 16;
const MAX_PIPELINE_BYTES = 64 * 1024;
const MAX_PIPELINE_LINES = 512;
const SCALAR_TYPES = ['uint', 'int', 'float', 'double', 'bool'] as const;
export const KITTY_TEXTURES = ['a', 'b', 'persist', 'default'] as const;
export type KittyTexture = typeof KITTY_TEXTURES[number];
export const KITTY_ANIMATION_EVENTS = ['pointer-left-button-press', 'os-window-focus-in', 'os-window-focus-out', 'window-focus-in', 'window-focus-out',
  'tab-change', 'bell-in-window', 'user-activity', 'user-idle', 'cursor-trail-move', 'cursor-trail-stop'] as const;
const NAMED_CURVES = ['ease-in-out', 'linear', 'ease', 'ease-out', 'ease-in', 'step-start', 'step-end'];

export interface KittyVar {type: string; name: string; value: string}
export interface KittyGroup {
  shaders: string[];
  /** Group-scoped vars in declaration order (a later one with the same name wins, as in Kitty). */
  vars: KittyVar[];
  animationStart?: string;
  animationStop?: string;
  animationCurve?: string;
  animationStep?: number;
  viewportPos?: string;
  viewportSize?: string;
  outputTexture?: KittyTexture;
  attach: boolean;
}
export interface KittyPipeline {textures: KittyTexture[]; vars: KittyVar[]; groups: KittyGroup[]}
export type ParseResult<T> = {ok: true; value: T} | {ok: false; error: string};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const isVarType = (type: string) => (SCALAR_TYPES as readonly string[]).includes(/[234]$/u.test(type) ? type.slice(0, -1) : type);
const isEvent = (name: string) => (KITTY_ANIMATION_EVENTS as readonly string[]).includes(name);

function parseVar(parts: string[]): KittyVar {
  if (parts.length < 4) throw new Error('var directive requires: var <type> <name> [=] <value>');
  const [, type, name] = parts as [string, string, string];
  if (!isVarType(type)) throw new Error(`var type ${type} is not supported by Kitty`);
  if (!IDENTIFIER.test(name)) throw new Error(`var name ${name} is not a valid identifier`);
  const rest = parts[3] === '=' ? parts.slice(4) : parts.slice(3);
  if (!rest.length) throw new Error('var directive missing value after =');
  return {type, name, value: rest.join(' ').replace(/;+$/u, '')};
}

function events(raw: string): string {
  for (const event of raw.split('|')) if (!isEvent(event)) throw new Error(`${event} is not a Kitty shader animation event`);
  return raw;
}

function curve(spec: string): string {
  const value = spec.trim();
  if (NAMED_CURVES.includes(value)) return value;
  const match = /^([-a-zA-Z]+)\(([^)]+)\)$/u.exec(value);
  if (!match || !['cubic-bezier', 'linear', 'steps'].includes(match[1]!)) throw new Error(`${value} is not a recognized animation curve`);
  // Kitty validates parameters when it builds the easing function; accept only plain numbers (and steps' start/end).
  if (!match[2]!.split(',').every(part => /^\s*(?:-?\d+(?:\.\d+)?%?|start|end|jump-\w+)\s*$/u.test(part))) throw new Error(`${value} has unsupported curve parameters`);
  return value;
}

const unitPair = (parts: string[]) => {
  if (parts.length < 2 || parts.slice(1, 3).some(part => !Number.isFinite(Number(part)))) throw new Error(`${parts[0]} needs one or two numbers`);
  return parts.slice(1, 3).join(' ');
};

/** Parse a `.pipeline` file exactly as Kitty 0.49 would accept or reject it. Bounded; never follows anything. */
export function parseKittyPipeline(text: string, name: string): ParseResult<KittyPipeline> {
  try {
    if (Buffer.byteLength(text) > MAX_PIPELINE_BYTES) throw new Error('Pipeline is larger than 64 KiB.');
    const lines = text.split(/\r?\n/u);
    if (lines.length > MAX_PIPELINE_LINES) throw new Error('Pipeline has too many lines.');
    const pipeline: KittyPipeline = {textures: [], vars: [], groups: []};
    let group: KittyGroup | undefined;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(line)) throw new Error('Pipeline contains control characters.');
      const parts = line.split(/\s+/u);
      const key = parts[0]!;
      if (!group) {
        if (key === 'slot') { if (parts[1] !== 'end') throw new Error(`slot ${parts[1] ?? ''} is not valid`); }
        else if (key === 'textures') {
          for (const texture of parts.slice(1)) if (!(KITTY_TEXTURES as readonly string[]).includes(texture)) throw new Error(`${texture} is not a Kitty texture name`);
          pipeline.textures = parts.slice(1) as KittyTexture[];
        } else if (key === 'startgroup') group = {shaders: [], vars: [], attach: false};
        else if (key === 'var') pipeline.vars.push(parseVar(parts));
        else throw new Error(`Unknown key ${key}`);
        continue;
      }
      switch (key) {
        case 'viewport_pos': group.viewportPos = unitPair(parts); break;
        case 'viewport_size': group.viewportSize = unitPair(parts); break;
        case 'output_texture':
          if (!(KITTY_TEXTURES as readonly string[]).includes(parts[1] ?? '')) throw new Error(`output_texture ${parts[1] ?? ''} is not valid`);
          group.outputTexture = parts[1] as KittyTexture; break;
        case 'shaders':
          for (const shader of parts.slice(1)) if (!/^[A-Za-z0-9_.~/-]+$/u.test(shader)) throw new Error(`Shader name ${shader} is not supported`);
          group.shaders.push(...parts.slice(1)); break;
        case 'var': group.vars.push(parseVar(parts)); break;
        case 'animation_start': {
          const value = parts.slice(1).join('') || 'none';
          if (value === 'none') delete group.animationStart; else group.animationStart = events(value);
          break;
        }
        case 'animation_curve':
          if (parts.length < 2) throw new Error('animation_curve requires a CSS curve name');
          group.animationCurve = curve(parts.slice(1).join(' ')); break;
        case 'animation_step': {
          const step = Number(parts[1]);
          if (!/^\d+$/u.test(parts[1] ?? '') || !Number.isSafeInteger(step)) throw new Error('animation_step must be a non-negative integer');
          group.animationStep = step; break;
        }
        case 'animation_stop': {
          const value = parts.slice(1).join('') || 'never';
          if (value !== 'never') for (const token of value.split('|')) if (!/^-?\d+$/u.test(token)) events(token);
          group.animationStop = value; break;
        }
        case 'attach': group.attach = true; break;
        case 'endgroup': pipeline.groups.push(group); group = undefined; break;
        default: throw new Error(`Unknown key ${key}`);
      }
    }
    if (group) throw new Error('Unclosed group present');
    if (!pipeline.groups.length) pipeline.groups.push({shaders: [name], vars: [], attach: false});
    if (pipeline.groups.length > KITTY_MAX_GROUPS) throw new Error(`Pipeline has ${pipeline.groups.length} groups; Kitty allows ${KITTY_MAX_GROUPS}`);
    if (pipeline.groups[0]!.attach) throw new Error('The first group in a pipeline cannot use attach');
    const last = pipeline.groups.at(-1)!;
    if (last.outputTexture && last.outputTexture !== 'default') throw new Error('The final group cannot output to a named texture');
    if (last.viewportPos || last.viewportSize) throw new Error('The final group must not specify a viewport');
    return {ok: true, value: pipeline};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

/** Kitty's default pipeline for a bare shader name: one group, every frame. */
export const defaultPipeline = (shader: string): KittyPipeline => ({textures: [], vars: [], groups: [{shaders: [shader], vars: [], attach: false}]});

/** Every named texture a pipeline allocates or writes (Kitty shares these names across chained pipelines). */
export const pipelineTextures = (pipeline: KittyPipeline): KittyTexture[] =>
  [...new Set([...pipeline.textures, ...pipeline.groups.flatMap(group => group.outputTexture ? [group.outputTexture] : [])])].filter(texture => texture !== 'default');

export const subscribesToCursorTrail = (group: KittyGroup) => (group.animationStart ?? '').split('|').includes('cursor-trail-move');

/** Canonical pipeline text. Every group var is written explicitly; no pipeline-level var is ever emitted. */
export function emitKittyPipeline(pipeline: KittyPipeline, header: readonly string[] = []): string {
  if (pipeline.vars.length) throw new Error('NMSh never writes pipeline-level vars (Kitty applies them to every chained pipeline).');
  const lines = header.map(line => `# ${line.replace(/[\r\n]/gu, ' ')}`);
  if (pipeline.textures.length) lines.push(`textures ${pipeline.textures.join(' ')}`);
  for (const group of pipeline.groups) {
    lines.push('', 'startgroup');
    if (group.attach) lines.push('    attach');
    if (group.animationStart) lines.push(`    animation_start ${group.animationStart}`);
    if (group.animationStop) lines.push(`    animation_stop ${group.animationStop}`);
    if (group.animationCurve) lines.push(`    animation_curve ${group.animationCurve}`);
    if (group.animationStep !== undefined) lines.push(`    animation_step ${group.animationStep}`);
    if (group.viewportPos) lines.push(`    viewport_pos ${group.viewportPos}`);
    if (group.viewportSize) lines.push(`    viewport_size ${group.viewportSize}`);
    for (const variable of group.vars) lines.push(`    var ${variable.type} ${variable.name} = ${variable.value}`);
    lines.push(`    shaders ${group.shaders.join(' ')}`);
    if (group.outputTexture) lines.push(`    output_texture ${group.outputTexture}`);
    lines.push('endgroup');
  }
  return `${lines.join('\n')}\n`;
}

// ---- Shader constants --------------------------------------------------------------------------------------------

export type ShaderValue = number | boolean | number[];
export interface ShaderConstant {type: string; name: string; raw: string; value?: ShaderValue}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[fF]?$/u;
const num = (text: string) => Number(text.replace(/[fF]$/u, ''));

/** A literal default Kitty's specialization could replace, or undefined for expressions and anything else. */
export function parseLiteral(type: string, raw: string): ShaderValue | undefined {
  const value = raw.trim();
  if (type === 'bool') return value === 'true' ? true : value === 'false' ? false : undefined;
  if (type === 'int' || type === 'uint') return /^-?\d+$/u.test(value) && (type === 'int' || !value.startsWith('-')) ? Number(value) : undefined;
  if (type === 'float' || type === 'double') return NUMBER.test(value) ? num(value) : undefined;
  const vector = /^(float|int)([234])$/u.exec(type);
  if (!vector) return undefined;
  const match = new RegExp(`^${type}\\(([^()]*)\\)$`, 'u').exec(value);
  if (!match) return undefined;
  const parts = match[1]!.split(',').map(part => part.trim());
  const size = Number(vector[2]);
  if (!parts.every(part => NUMBER.test(part)) || (parts.length !== size && parts.length !== 1)) return undefined;
  const values = parts.map(num);
  return parts.length === 1 ? Array.from({length: size}, () => values[0]!) : values;
}

/** The `static const` declarations Kitty's `var` can replace (one line each, same regex shape as Kitty). */
export function parseShaderConstants(source: string): Map<string, ShaderConstant> {
  const constants = new Map<string, ShaderConstant>();
  for (const line of source.split(/\r?\n/u).slice(0, 4096)) {
    const start = /^\s*static\s+const\s+([A-Za-z0-9]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
    if (!start) continue;
    const [, type, name] = start as unknown as [string, string, string];
    if (!isVarType(type)) continue;
    const match = /=\s*([^;]*);/u.exec(line.slice(start[0].length - 1));
    // A declaration continued on later lines, or repeated with another value, has no single line NMSh could pin (raw '').
    const raw = match ? match[1]!.trim() : '';
    const existing = constants.get(name);
    if (existing) { if (existing.raw !== raw) constants.set(name, {type: existing.type, name, raw: ''}); continue; }
    const value = raw ? parseLiteral(type, raw) : undefined;
    constants.set(name, {type, name, raw, ...(value !== undefined ? {value} : {})});
  }
  return constants;
}

/** A value as Slang source. Floats always carry a decimal point (Kitty compiles with warnings as errors). */
export function formatShaderValue(type: string, value: ShaderValue): string {
  const float = (n: number) => { const text = Number(n.toFixed(6)).toString(); return /[.eE]/u.test(text) ? text : `${text}.0`; };
  if (type === 'bool') { if (typeof value !== 'boolean') throw new Error('Expected a boolean'); return String(value); }
  if (type === 'int' || type === 'uint') { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Expected an integer'); return String(value); }
  if (type === 'float' || type === 'double') { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a number'); return float(value); }
  const vector = /^(float|int)([234])$/u.exec(type);
  if (!vector || !Array.isArray(value) || value.length !== Number(vector[2]) || !value.every(Number.isFinite)) throw new Error(`Expected ${type}`);
  return `${type}(${value.map(item => vector[1] === 'int' ? String(Math.round(item)) : float(item)).join(', ')})`;
}

// ---- Curated presets ---------------------------------------------------------------------------------------------

export type PresetCategory = 'cursor' | 'ambient' | 'interaction' | 'focus' | 'display';
export const CATEGORY_LABELS: Record<PresetCategory, string> = {cursor: 'Cursor trail', ambient: 'Ambient', interaction: 'Pointer', focus: 'Focus & tabs', display: 'Display'};
export interface PresetParam {
  name: string; label: string; kind: 'number' | 'bool' | 'color' | 'choice';
  /** Kitty's declared type this control expects; a different declaration means the parameter is not offered. */
  type: string;
  min?: number; max?: number; step?: number;
  choices?: ReadonlyArray<readonly [number, string]>;
}
export interface PresetDefinition {
  id: string; label: string; category: PresetCategory;
  /** A shipped pipeline (its group structure is reused) or a shipped shader with Kitty's default pipeline. */
  source: {pipeline: string} | {shader: string};
  params: readonly PresetParam[];
  /** Presets sharing a key cannot be enabled together. */
  exclusive?: string;
  requires?: 'cursor_trail' | 'opaque';
  note?: string;
}

const n = (name: string, label: string, min: number, max: number, step: number, type = 'float'): PresetParam => ({name, label, kind: 'number', type, min, max, step});
const color = (name: string, label: string, type: 'float3' | 'float4'): PresetParam => ({name, label, kind: 'color', type});
const flag = (name: string, label: string): PresetParam => ({name, label, kind: 'bool', type: 'bool'});

/**
 * NMSh's first offered presets. Bounds are NMSh's (safe UI ranges); every
 * parameter is offered only when the INSTALLED shader declares it with this
 * type and a literal default, which becomes the starting value.
 */
export const KITTY_PRESETS: readonly PresetDefinition[] = [
  {id: 'cursor-trail-default', label: 'Default trail', category: 'cursor', source: {pipeline: 'cursor-trail-default'}, params: [], exclusive: 'cursor', requires: 'cursor_trail',
    note: 'Kitty exposes no shader settings for this trail; its color is cursor_trail_color (set from /cursor).'},
  {id: 'cursor-trail-blaze', label: 'Blaze trail', category: 'cursor', source: {pipeline: 'cursor-trail-blaze'}, exclusive: 'cursor', requires: 'cursor_trail',
    params: [n('DURATION', 'Duration (s)', 0.1, 2, 0.05), color('TRAIL_COLOR', 'Fill color', 'float4'), color('TRAIL_COLOR_ACCENT', 'Edge color', 'float4')]},
  {id: 'cursor-trail-lightning', label: 'Lightning trail', category: 'cursor', source: {pipeline: 'cursor-trail-lightning'}, exclusive: 'cursor', requires: 'cursor_trail',
    params: [n('DURATION', 'Duration (s)', 0.05, 1, 0.01), n('JAGGEDNESS', 'Jaggedness', 0, 0.3, 0.005), n('CORE_WIDTH', 'Core width', 0.5, 4, 0.05),
      n('GLOW_WIDTH', 'Glow width', 1, 12, 0.5), color('BOLT_COLOR', 'Bolt color', 'float3'), color('GLOW_COLOR', 'Glow color', 'float3')]},
  {id: 'cursor-trail-motion-blur', label: 'Motion blur trail', category: 'cursor', source: {pipeline: 'cursor-trail-motion-blur'}, exclusive: 'cursor', requires: 'cursor_trail',
    params: [flag('MOTION_BLUR', 'Motion blur'), n('MOTION_BLUR_SAMPLES', 'Blur samples', 1, 64, 1, 'int'), flag('ANTIALIASING', 'Antialiasing'), flag('CONNECTED', 'Connected streak')]},
  {id: 'northern-lights', label: 'Northern Lights', category: 'ambient', source: {pipeline: 'northern-lights'},
    params: [n('EFFECT_INTENSITY', 'Intensity', 0, 1, 0.05), n('AURORA_INTENSITY', 'Aurora', 0, 1, 0.05), n('TIME_SCALE', 'Speed', 0.05, 2, 0.05), n('STAR_BRIGHTNESS', 'Stars', 0, 2, 0.1)]},
  {id: 'inside-the-matrix', label: 'Matrix', category: 'ambient', source: {pipeline: 'inside-the-matrix'}, params: [n('SPEED', 'Speed', 0.1, 2, 0.05)]},
  {id: 'fireworks', label: 'Fireworks', category: 'ambient', source: {pipeline: 'fireworks'},
    params: [n('TIME_SCALE', 'Speed', 0.1, 2, 0.05), n('NUM_EXPLOSIONS', 'Explosions', 1, 6, 1, 'int')]},
  {id: 'pond-ripple', label: 'Pond Ripple', category: 'interaction', source: {pipeline: 'pond-ripple'},
    params: [n('WAVE_SPEED', 'Wave speed', 0.1, 1.5, 0.05), n('AMPLITUDE', 'Strength', 0, 0.05, 0.001), n('WAVE_FREQUENCY', 'Frequency', 2, 40, 1)],
    note: 'Starts on a left mouse click.'},
  {id: 'spotlight', label: 'Spotlight', category: 'interaction', source: {pipeline: 'spotlight'},
    params: [n('SPOTLIGHT_RADIUS', 'Radius', 0.05, 0.6, 0.01), n('AMBIENT_LIGHT', 'Ambient light', 0, 1, 0.05)]},
  {id: 'focus-highlight', label: 'Focus highlight', category: 'focus', source: {pipeline: 'focus-highlight'}, exclusive: 'focus-shader',
    params: [n('HIGHLIGHT_INTENSITY', 'Highlight', 0, 1, 0.05), n('BORDER_WIDTH', 'Border width', 0, 0.2, 0.01), n('INACTIVE_DIM', 'Inactive kept', 0, 1, 0.05)]},
  {id: 'dim-inactive-windows', label: 'Dim inactive windows', category: 'focus', source: {pipeline: 'dim-inactive-windows'}, exclusive: 'focus-shader',
    params: [n('INACTIVE_DIM', 'Inactive kept', 0, 1, 0.05)]},
  {id: 'tab-change', label: 'Tab change', category: 'focus', source: {pipeline: 'tab-change'},
    params: [{name: 'ANIMATION_TYPE', label: 'Style', kind: 'choice', type: 'int', choices: [[0, 'Fade'], [1, 'Wipe'], [2, 'Blinds'], [3, 'Iris']]}, n('NUM_BLINDS', 'Blinds', 2, 24, 1, 'int')]},
  {id: 'crt', label: 'CRT', category: 'display', source: {shader: 'crt'}, requires: 'opaque',
    params: [n('WARP', 'Curvature', 0, 1, 0.05), n('SCAN', 'Scanlines', 0, 1, 0.05), color('TINT', 'Tint', 'float4')],
    note: 'Kitty notes this shader does not work with background_opacity below 1. Runs every frame.'},
];

// ---- Installed catalog -------------------------------------------------------------------------------------------

export interface CatalogShader {name: string; sha256: string; constants: Map<string, ShaderConstant>}
export interface OfferedParam extends PresetParam {default: ShaderValue}
export interface OfferedPreset {
  definition: PresetDefinition;
  /** The groups Kitty would run, with the shipped pipeline-level vars moved into each group. */
  groups: KittyGroup[];
  textures: KittyTexture[];
  params: OfferedParam[];
  /** Curated parameters the installed shader does not declare as expected (not offered). */
  missing: string[];
  /** Origin metadata: the exact shipped resources this preset reads. */
  origin: {kittyVersion: string; resources: Array<{name: string; sha256: string}>};
}
export interface KittyCatalog {
  version: string;
  supported: boolean;
  reason?: string;
  pipelines: Map<string, {pipeline: KittyPipeline; sha256: string}>;
  shaders: Map<string, CatalogShader>;
  offered: OfferedPreset[];
  /** Installed pipelines NMSh does not offer yet (kept visible as the catalog). */
  notOffered: string[];
  problems: string[];
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export function versionAtLeast(version: string, [major, minor]: readonly [number, number]): boolean {
  const match = /^(\d+)\.(\d+)/u.exec(version);
  return Boolean(match && (Number(match[1]) > major || (Number(match[1]) === major && Number(match[2]) >= minor)));
}

/** Build the catalog from shipped resource texts (name → content, e.g. "crt.slang"). */
export function buildKittyCatalog(version: string, resources: Readonly<Record<string, string>>): KittyCatalog {
  const catalog: KittyCatalog = {version, supported: false, pipelines: new Map(), shaders: new Map(), offered: [], notOffered: [], problems: []};
  if (!versionAtLeast(version, KITTY_SHADER_MIN_VERSION)) {
    catalog.reason = `Kitty ${version || '(unknown version)'} has no custom shader pipelines; they need Kitty ${KITTY_SHADER_MIN_VERSION.join('.')} or newer.`;
    return catalog;
  }
  for (const [file, content] of Object.entries(resources)) {
    const match = /^([a-z0-9-]+)\.(pipeline|slang)$/u.exec(file);
    if (!match) continue;
    const [, base, kind] = match as unknown as [string, string, string];
    if (kind === 'slang') catalog.shaders.set(base, {name: base, sha256: sha(content), constants: parseShaderConstants(content)});
    else {
      const parsed = parseKittyPipeline(content, base);
      if (parsed.ok) catalog.pipelines.set(base, {pipeline: parsed.value, sha256: sha(content)});
      else catalog.problems.push(`Shipped pipeline ${base} did not validate: ${parsed.error}`);
    }
  }
  if (!catalog.shaders.has('types')) { catalog.reason = 'Kitty’s shader catalog could not be read (no shader types module).'; return catalog; }
  catalog.supported = true;
  const offeredPipelines = new Set<string>();
  for (const definition of KITTY_PRESETS) {
    const offered = offerPreset(catalog, definition);
    if (typeof offered === 'string') { catalog.problems.push(`${definition.label}: ${offered}`); continue; }
    catalog.offered.push(offered);
    if ('pipeline' in definition.source) offeredPipelines.add(definition.source.pipeline);
  }
  catalog.notOffered = [...catalog.pipelines.keys()].filter(name => !offeredPipelines.has(name)).sort();
  return catalog;
}

function offerPreset(catalog: KittyCatalog, definition: PresetDefinition): OfferedPreset | string {
  const source = 'pipeline' in definition.source ? catalog.pipelines.get(definition.source.pipeline) : undefined;
  if ('pipeline' in definition.source && !source) return 'not installed in this Kitty';
  const pipeline = source?.pipeline ?? defaultPipeline((definition.source as {shader: string}).shader);
  const resources = source ? [{name: `${(definition.source as {pipeline: string}).pipeline}.pipeline`, sha256: source.sha256}] : [];
  const shaderNames = [...new Set(pipeline.groups.flatMap(group => group.shaders))];
  for (const name of shaderNames) {
    const shader = catalog.shaders.get(name);
    if (!shader) return `shader ${name} is not shipped with this Kitty`;
    resources.push({name: `${name}.slang`, sha256: shader.sha256});
  }
  // Pipeline-level vars become group vars, so NMSh's pipeline never leaks values into other chained pipelines.
  const groups = pipeline.groups.map(group => ({...group, shaders: [...group.shaders], vars: mergeVars(pipeline.vars, group.vars)}));
  const params: OfferedParam[] = [];
  const missing: string[] = [];
  for (const param of definition.params) {
    const declared = shaderNames.map(name => catalog.shaders.get(name)!.constants.get(param.name)).filter(Boolean) as ShaderConstant[];
    const usable = declared.length > 0 && declared.every(constant => constant.type === param.type && constant.value !== undefined);
    if (!usable) { missing.push(param.name); continue; }
    // The shipped pipeline's own value (e.g. dim-inactive-windows sets HIGHLIGHT_INTENSITY) is the starting value.
    const shipped = groups.flatMap(group => group.vars).filter(variable => variable.name === param.name && variable.type === param.type).at(-1);
    const fromPipeline = shipped ? parseLiteral(param.type, shipped.value) : undefined;
    params.push({...param, default: fromPipeline ?? declared[0]!.value!});
  }
  return {definition, groups, textures: pipelineTextures(pipeline), params, missing, origin: {kittyVersion: catalog.version, resources}};
}

export function mergeVars(...lists: ReadonlyArray<readonly KittyVar[]>): KittyVar[] {
  const merged = new Map<string, KittyVar>();
  for (const list of lists) for (const variable of list) { merged.delete(variable.name); merged.set(variable.name, {...variable}); }
  return [...merged.values()];
}

// ---- Discovery ---------------------------------------------------------------------------------------------------

/**
 * Fixed NMSh helper run inside Kitty's own interpreter: it lists and reads
 * Kitty's packaged shader resources and prints JSON. No shader is compiled or
 * executed, no file is written and no user configuration is read.
 */
export const KITTY_CATALOG_SCRIPT = `
import json, sys
from kitty.constants import str_version
out = {'version': str_version, 'resources': {}}
try:
    from kitty.constants import list_kitty_resources, read_kitty_resource
    total = 0
    for name in sorted(list_kitty_resources('kitty.shaders.custom')):
        if not (name.endswith('.pipeline') or name.endswith('.slang')):
            continue
        data = read_kitty_resource(name, 'kitty.shaders.custom')
        if len(data) > 65536:
            continue
        total += len(data)
        if total > 1048576:
            out['truncated'] = True
            break
        out['resources'][name] = data.decode('utf-8', 'replace')
except Exception as e:
    out['error'] = type(e).__name__
sys.stdout.write(json.dumps(out))
`;

export interface CatalogRunner {(binary: string, args: readonly string[], timeoutMs: number): Promise<{code: number | null; stdout: string}>}

/** A detached child with no terminal: bounded output and time, minimal environment, no bytecode writes. */
export const runKittyHelper: CatalogRunner = (binary, args, timeoutMs) => new Promise(resolve => {
  const env: NodeJS.ProcessEnv = {PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1', LANG: 'C.UTF-8',
    ...(process.env.HOME ? {HOME: process.env.HOME} : {})};
  let stdout = '';
  let settled = false;
  const child = spawn(binary, [...args], {stdio: ['ignore', 'pipe', 'ignore'], detached: true, env});
  const finish = (code: number | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve({code, stdout}); };
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(null); }, timeoutMs);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 2 * 1024 * 1024) { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(null); } });
  child.on('error', () => finish(null));
  child.on('close', code => finish(code));
});

/** The installed kitty binary: PATH first, then the macOS application bundle. */
export function kittyBinary(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, 'kitty');
    if (existsSync(candidate)) return candidate;
  }
  const bundle = '/Applications/kitty.app/Contents/MacOS/kitty';
  return platform === 'darwin' && existsSync(bundle) ? bundle : undefined;
}

/** Read the installed catalog. Unsupported or unreadable installations come back with a reason, never a guessed catalog. */
export async function discoverKittyCatalog(binary: string | undefined, run: CatalogRunner = runKittyHelper): Promise<KittyCatalog> {
  const empty = (reason: string, version = ''): KittyCatalog => ({version, supported: false, reason, pipelines: new Map(), shaders: new Map(), offered: [], notOffered: [], problems: []});
  if (!binary) return empty('The kitty program was not found, so its installed shader catalog cannot be read.');
  const result = await run(binary, ['+runpy', KITTY_CATALOG_SCRIPT], 8000);
  let parsed: {version?: unknown; resources?: unknown; error?: unknown; truncated?: unknown};
  try { parsed = JSON.parse(result.stdout); } catch { return empty('Kitty did not report its shader catalog (no readable answer within 8 s).'); }
  const version = typeof parsed.version === 'string' && /^\d+\.\d+(?:\.\d+)?$/u.test(parsed.version) ? parsed.version : '';
  if (!versionAtLeast(version, KITTY_SHADER_MIN_VERSION)) return buildKittyCatalog(version, {});
  if (parsed.error || !parsed.resources || typeof parsed.resources !== 'object') return empty('Kitty’s packaged shader resources could not be listed.', version);
  const resources = Object.fromEntries(Object.entries(parsed.resources as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  const catalog = buildKittyCatalog(version, resources);
  if (parsed.truncated) catalog.problems.push('Kitty’s catalog was larger than NMSh reads; some shipped shaders were skipped.');
  return catalog;
}
