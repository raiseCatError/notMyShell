/**
 * Ghostty custom-shader catalog: the verified GLSL interface per Ghostty
 * version and NMSh's own curated shader presets.
 *
 * Ghostty runs each `custom-shader` as one pass of a Shadertoy-style GLSL
 * fragment program (`mainImage`), with the previous pass's output in
 * iChannel0. NMSh writes ORIGINAL shaders (GPL-3.0-only, no third-party code)
 * generated from validated settings; every parameter offered here is compiled
 * into the generated source as a constant and actually changes what is drawn.
 *
 * Version facts (2026-10-28; evidence in docs/development/native-appearance-welcome/RESEARCH.md):
 * the shader prefix of v1.3.0, v1.3.1 and v1.4.0 is byte-identical (source at
 * those tags and the installed 1.3.1 / staged 1.4.0 binaries); v1.2.0 lacks the
 * focus, cursor-style/visibility and terminal-color uniforms. Older versions
 * were not verified and are not offered.
 */
import {createHash} from 'node:crypto';
import type {OfferedParam, PresetCategory, PresetParam, ShaderValue} from './kittyShaderCatalog.js';

export type GhosttyVersion = readonly [number, number, number];

export function parseGhosttyVersion(text: string | undefined): GhosttyVersion | undefined {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/u.exec(text ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

const compare = (a: GhosttyVersion, b: GhosttyVersion) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The interface levels NMSh has verified, oldest first. */
export type UniformLevel = '1.2' | '1.3';
const LEVEL_FLOOR: Record<UniformLevel, GhosttyVersion> = {'1.2': [1, 2, 0], '1.3': [1, 3, 0]};
/** The newest version whose shader interface NMSh compared byte-for-byte. */
export const GHOSTTY_VERIFIED_THROUGH: GhosttyVersion = [1, 4, 0];

/** Ghostty's shader uniforms (name, GLSL type, first verified level). Mirrors src/renderer/shaders/shadertoy_prefix.glsl. */
export const GHOSTTY_UNIFORMS: ReadonlyArray<{name: string; type: string; array?: number; since: UniformLevel}> = [
  {name: 'iResolution', type: 'vec3', since: '1.2'}, {name: 'iTime', type: 'float', since: '1.2'}, {name: 'iTimeDelta', type: 'float', since: '1.2'},
  {name: 'iFrameRate', type: 'float', since: '1.2'}, {name: 'iFrame', type: 'int', since: '1.2'}, {name: 'iChannelTime', type: 'float', array: 4, since: '1.2'},
  {name: 'iChannelResolution', type: 'vec3', array: 4, since: '1.2'}, {name: 'iMouse', type: 'vec4', since: '1.2'}, {name: 'iDate', type: 'vec4', since: '1.2'},
  {name: 'iSampleRate', type: 'float', since: '1.2'}, {name: 'iCurrentCursor', type: 'vec4', since: '1.2'}, {name: 'iPreviousCursor', type: 'vec4', since: '1.2'},
  {name: 'iCurrentCursorColor', type: 'vec4', since: '1.2'}, {name: 'iPreviousCursorColor', type: 'vec4', since: '1.2'},
  {name: 'iCurrentCursorStyle', type: 'int', since: '1.3'}, {name: 'iPreviousCursorStyle', type: 'int', since: '1.3'}, {name: 'iCursorVisible', type: 'int', since: '1.3'},
  {name: 'iTimeCursorChange', type: 'float', since: '1.2'}, {name: 'iTimeFocus', type: 'float', since: '1.3'}, {name: 'iFocus', type: 'int', since: '1.3'},
  {name: 'iPalette', type: 'vec3', array: 256, since: '1.3'}, {name: 'iBackgroundColor', type: 'vec3', since: '1.3'}, {name: 'iForegroundColor', type: 'vec3', since: '1.3'},
  {name: 'iCursorColor', type: 'vec3', since: '1.3'}, {name: 'iCursorText', type: 'vec3', since: '1.3'},
  {name: 'iSelectionForegroundColor', type: 'vec3', since: '1.3'}, {name: 'iSelectionBackgroundColor', type: 'vec3', since: '1.3'},
];
/** Declared by Ghostty but documented as not provided (always zero); NMSh never relies on them. */
const UNPROVIDED = new Set(['iMouse', 'iChannelTime', 'iChannelResolution', 'iSampleRate', 'iDate']);

export interface GhosttyCapability {
  supported: boolean;
  version: string;
  level?: UniformLevel;
  reason?: string;
  /** No version was reported (tmux, ssh): unknown, not known to be unsupported. */
  hidden?: boolean;
}

/** What this Ghostty's shader interface is, from its reported version; unknown or unverified versions fail closed. */
export function ghosttyCapability(versionText: string | undefined): GhosttyCapability {
  const version = parseGhosttyVersion(versionText);
  const text = versionText ?? '';
  if (!version) return {supported: false, hidden: true, version: text, reason: 'Ghostty did not report its version (TERM_PROGRAM_VERSION), so NMSh cannot tell which shader features it has. Open /appearance directly in a Ghostty window (not inside tmux or ssh).'};
  if (compare(version, LEVEL_FLOOR['1.2']) < 0) return {supported: false, version: text, reason: `Ghostty ${text} predates the cursor shader interface NMSh verified (1.2.0 and later).`};
  // Unverified versions fail closed (recorded ruling): a newer minor or major waits until its shader interface is checked.
  if (version[0] > GHOSTTY_VERIFIED_THROUGH[0] || (version[0] === GHOSTTY_VERIFIED_THROUGH[0] && version[1] > GHOSTTY_VERIFIED_THROUGH[1])) {
    return {supported: false, version: text, reason: `Ghostty ${text} is newer than NMSh has verified (through ${GHOSTTY_VERIFIED_THROUGH.slice(0, 2).join('.')}.x); NMSh's shaders stay off until its shader interface is checked.`};
  }
  const level: UniformLevel = compare(version, LEVEL_FLOOR['1.3']) >= 0 ? '1.3' : '1.2';
  return {supported: true, version: text, level};
}

const levelAllows = (have: UniformLevel, need: UniformLevel) => have === '1.3' || need === '1.2';

/** The Ghostty uniforms a GLSL source reads (identifiers only; comments removed first). */
export function uniformsUsed(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
  const names = new Set(GHOSTTY_UNIFORMS.map(item => item.name));
  return [...new Set([...code.matchAll(/\bi[A-Z][A-Za-z]*\b/gu)].map(match => match[0]).filter(name => names.has(name)))];
}

/** The oldest interface level that provides every uniform a source reads, or a reason it cannot run on any. */
export function requiredLevel(source: string): {level: UniformLevel} | {error: string} {
  const used = uniformsUsed(source);
  const unprovided = used.filter(name => UNPROVIDED.has(name));
  if (unprovided.length) return {error: `uses ${unprovided.join(', ')}, which Ghostty does not provide`};
  return {level: used.some(name => GHOSTTY_UNIFORMS.find(item => item.name === name)?.since === '1.3') ? '1.3' : '1.2'};
}

/** A GLSL prefix equivalent to Ghostty's for one interface level (used only for offline compile checks in tests). */
export function ghosttyPrefix(level: UniformLevel): string {
  const fields = GHOSTTY_UNIFORMS.filter(item => levelAllows(level, item.since)).map(item => `    uniform ${item.type} ${item.name}${item.array ? `[${item.array}]` : ''};`);
  return ['#version 430 core', 'layout(binding = 1, std140) uniform Globals {', ...fields, '};',
    ...(level === '1.3' ? ['#define CURSORSTYLE_BLOCK        0', '#define CURSORSTYLE_BLOCK_HOLLOW 1', '#define CURSORSTYLE_BAR          2', '#define CURSORSTYLE_UNDERLINE    3', '#define CURSORSTYLE_LOCK         4'] : []),
    'layout(binding = 0) uniform sampler2D iChannel0;', 'layout(location = 0) in vec4 gl_FragCoord;', 'layout(location = 0) out vec4 _fragColor;', '#define texture2D texture',
    'void mainImage( out vec4 fragColor, in vec2 fragCoord );', 'void main() { mainImage (_fragColor, gl_FragCoord.xy); }', ''].join('\n');
}

// ---- Presets -----------------------------------------------------------------------------------------------------

/** Where a trail takes its colors: /cursor's palette (one cursor color everywhere), the studio's own colors, or Ghostty's live cursor color. */
export const COLOR_SOURCES = [[0, 'From /cursor'], [1, 'Custom'], [2, 'Ghostty cursor color']] as const;

export interface GhosttyPresetDefinition {
  id: string; label: string; category: PresetCategory;
  params: readonly PresetParam[];
  defaults: Readonly<Record<string, ShaderValue>>;
  /** Presets sharing a key cannot be enabled together (one cursor trail). */
  exclusive?: string;
  /** A cursor trail: Ghostty then draws the trail and Portable must not (never two trails). */
  trail?: true;
  /** Reads iTime continuously, so it redraws every frame while Ghostty's custom-shader-animation runs. */
  animated: boolean;
  note?: string;
}

export interface GenerationContext {
  /** /cursor's effect colors (0–1 RGB): the trail head and tail. */
  cursorColors: {head: readonly number[]; tail: readonly number[]};
  /** The Chroma palette's ends (0–1 RGB; the theme's colors while Chroma is off), for effects that follow Chroma. */
  chroma: {a: readonly number[]; b: readonly number[]};
}

/** Ambient colors: follow Chroma (rewritten when the Chroma palette or theme changes; Ghostty applies it on reload) or the studio's own. */
export const AMBIENT_COLOR_SOURCES = [[0, 'Follow Chroma'], [1, 'Custom']] as const;

const n = (name: string, label: string, min: number, max: number, step: number, type = 'float'): PresetParam => ({name, label, kind: 'number', type, min, max, step});
const rgb = (name: string, label: string): PresetParam => ({name, label, kind: 'color', type: 'float3'});
const flag = (name: string, label: string): PresetParam => ({name, label, kind: 'bool', type: 'bool'});
const colorSource: PresetParam = {name: 'COLOR_SOURCE', label: 'Colors', kind: 'choice', type: 'int', choices: COLOR_SOURCES};

export const GHOSTTY_PRESETS: readonly GhosttyPresetDefinition[] = [
  {id: 'smear', label: 'Smear trail', category: 'cursor', exclusive: 'cursor', trail: true, animated: false,
    params: [colorSource, rgb('HEAD', 'Head color'), rgb('TAIL', 'Tail color'), n('INTENSITY', 'Intensity', 0.1, 1, 0.05), n('DURATION', 'Duration (s)', 0.05, 1.5, 0.05), n('WIDTH', 'Width (× cell)', 0.2, 1.5, 0.05)],
    defaults: {COLOR_SOURCE: 0, HEAD: [0.55, 0.75, 1], TAIL: [0.35, 0.3, 0.9], INTENSITY: 0.75, DURATION: 0.25, WIDTH: 1},
    note: 'A gradient smear from where the cursor was to where it is; it fades over the duration.'},
  {id: 'comet', label: 'Comet trail', category: 'cursor', exclusive: 'cursor', trail: true, animated: false,
    params: [colorSource, rgb('HEAD', 'Head color'), rgb('TAIL', 'Tail color'), n('INTENSITY', 'Intensity', 0.1, 1, 0.05), n('DURATION', 'Duration (s)', 0.1, 2, 0.05),
      n('GLOW', 'Glow radius (× cell)', 0, 3, 0.1), flag('SPARKS', 'Sparks')],
    defaults: {COLOR_SOURCE: 0, HEAD: [1, 0.85, 0.45], TAIL: [0.95, 0.3, 0.2], INTENSITY: 0.85, DURATION: 0.45, GLOW: 1.2, SPARKS: true},
    note: 'A tapered comet tail with a soft glow and optional sparks along the path.'},
  {id: 'aurora', label: 'Aurora', category: 'ambient', animated: true,
    params: [{name: 'COLORS', label: 'Colors', kind: 'choice', type: 'int', choices: AMBIENT_COLOR_SOURCES}, rgb('COLOR_A', 'Color A'), rgb('COLOR_B', 'Color B'),
      n('INTENSITY', 'Intensity', 0.05, 0.8, 0.05), n('SPEED', 'Speed', 0.05, 2, 0.05), n('HEIGHT', 'Height', 0.1, 1, 0.05)],
    defaults: {COLORS: 0, COLOR_A: [0.2, 0.9, 0.6], COLOR_B: [0.45, 0.35, 1], INTENSITY: 0.3, SPEED: 0.4, HEIGHT: 0.45},
    note: 'Slow color bands over the background only (text keeps its colors). Animates every frame while Ghostty is focused.'},
  {id: 'focus-dim', label: 'Dim when unfocused', category: 'focus', animated: false,
    params: [n('DIM', 'Dim', 0, 0.9, 0.05), n('DESATURATE', 'Desaturate', 0, 1, 0.05), n('FADE', 'Fade back (s)', 0, 1, 0.05)],
    defaults: {DIM: 0.35, DESATURATE: 0.4, FADE: 0.2},
    note: 'Unfocused Ghostty windows and splits fade toward the background; focus brings them back.'},
  {id: 'vignette', label: 'Vignette', category: 'display', animated: false,
    params: [n('INTENSITY', 'Intensity', 0, 1, 0.05), n('RADIUS', 'Radius', 0.3, 1.5, 0.05), n('SOFTNESS', 'Softness', 0.05, 1, 0.05), rgb('COLOR', 'Edge color')],
    defaults: {INTENSITY: 0.35, RADIUS: 0.85, SOFTNESS: 0.45, COLOR: [0, 0, 0]}},
  {id: 'scanlines', label: 'Scanlines', category: 'display', animated: false,
    params: [n('INTENSITY', 'Intensity', 0, 0.6, 0.02), n('SPACING', 'Spacing (px)', 2, 8, 1, 'int')],
    defaults: {INTENSITY: 0.15, SPACING: 3}},
  {id: 'glow', label: 'Text glow', category: 'display', animated: false,
    params: [n('INTENSITY', 'Intensity', 0, 1.5, 0.05), n('RADIUS', 'Radius (px)', 1, 6, 0.5)],
    defaults: {INTENSITY: 0.45, RADIUS: 2},
    note: 'A soft bloom around bright text. Samples 16 neighbours per pixel: the most expensive NMSh effect.'},
];

export const GHOSTTY_MAX_EFFECTS = 6;

// ---- Values and source generation ---------------------------------------------------------------------------------

const float = (value: number) => { const text = Number(value.toFixed(6)).toString(); return /[.eE]/u.test(text) ? text : `${text}.0`; };
const vec3 = (value: readonly number[]) => `vec3(${value.slice(0, 3).map(float).join(', ')})`;

/** Why a value is not acceptable for a parameter (undefined when it is). Values are validated, never clamped. */
export function paramError(param: PresetParam, value: ShaderValue): string | undefined {
  if (param.kind === 'bool') return typeof value === 'boolean' ? undefined : 'expects on or off';
  if (param.kind === 'color') return Array.isArray(value) && value.length === 3 && value.every(part => Number.isFinite(part) && part >= 0 && part <= 1) ? undefined : 'expects 3 components between 0 and 1';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'expects a number';
  if (param.type === 'int' && !Number.isSafeInteger(value)) return 'expects a whole number';
  if (param.kind === 'choice') return param.choices?.some(([choice]) => choice === value) ? undefined : 'is not one of its choices';
  return value < (param.min ?? -Infinity) || value > (param.max ?? Infinity) ? `must be between ${param.min} and ${param.max}` : undefined;
}

export const presetById = (id: string) => GHOSTTY_PRESETS.find(preset => preset.id === id);

/** Every value a preset will compile with: defaults overlaid by the saved (validated) values. */
export function resolvedValues(preset: GhosttyPresetDefinition, values: Readonly<Record<string, ShaderValue>>): Record<string, ShaderValue> {
  const result: Record<string, ShaderValue> = {...preset.defaults};
  for (const param of preset.params) if (values[param.name] !== undefined) result[param.name] = values[param.name]!;
  // Settings saved before the Colors choice existed keep their own colors rather than switching to Chroma.
  if (values.COLORS === undefined && preset.params.some(param => param.name === 'COLORS') && preset.params.some(param => param.kind === 'color' && values[param.name] !== undefined)) result.COLORS = 1;
  return result;
}

const constant = (param: PresetParam, value: ShaderValue): string => {
  if (param.kind === 'bool') return `const bool ${param.name} = ${value ? 'true' : 'false'};`;
  if (param.kind === 'color') return `const vec3 ${param.name} = ${vec3(value as number[])};`;
  if (param.type === 'int') return `const int ${param.name} = ${Math.round(value as number)};`;
  return `const float ${param.name} = ${float(value as number)};`;
};

const TRAIL_HELPERS = `vec2 nmshCenter(vec4 rect) { return rect.xy + vec2(rect.z * 0.5, -rect.w * 0.5); }
float nmshHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nmshSegment(vec2 p, vec2 a, vec2 b, out float along) {
  vec2 pa = p - a, ba = b - a;
  along = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * along);
}`;

/** The trail colors as GLSL: /cursor's and custom colors are constants; Ghostty's cursor color is read live. */
function trailColors(values: Record<string, ShaderValue>, context: GenerationContext): string {
  const source = values.COLOR_SOURCE;
  if (source === 2) return 'vec3 headColor() { return iCurrentCursorColor.rgb; }\nvec3 tailColor() { return iCurrentCursorColor.rgb * 0.6; }';
  const head = source === 0 ? context.cursorColors.head : values.HEAD as number[];
  const tail = source === 0 ? context.cursorColors.tail : values.TAIL as number[];
  return `vec3 headColor() { return ${vec3(head)}; }\nvec3 tailColor() { return ${vec3(tail)}; }`;
}

const BODIES: Record<string, (values: Record<string, ShaderValue>, context: GenerationContext) => string> = {
  smear: (values, context) => `${TRAIL_HELPERS}
${trailColors(values, context)}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  vec2 head = nmshCenter(iCurrentCursor);
  vec2 from = nmshCenter(iPreviousCursor);
  float progress = clamp((iTime - iTimeCursorChange) / DURATION, 0.0, 1.0);
  vec2 travel = head - from;
  if (progress >= 1.0 || dot(travel, travel) < 4.0) { fragColor = base; return; }
  vec2 tail = mix(from, head, smoothstep(0.0, 1.0, progress));
  float along;
  float d = nmshSegment(fragCoord, tail, head, along);
  float halfWidth = max(iCurrentCursor.z, 2.0) * 0.5 * WIDTH * mix(0.4, 1.0, along);
  float band = 1.0 - smoothstep(halfWidth - 1.0, halfWidth + 1.0, d);
  float alpha = band * (1.0 - progress) * INTENSITY;
  fragColor = vec4(mix(base.rgb, mix(tailColor(), headColor(), along), alpha), base.a);
}
`,
  comet: (values, context) => `${TRAIL_HELPERS}
${trailColors(values, context)}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  vec2 head = nmshCenter(iCurrentCursor);
  vec2 from = nmshCenter(iPreviousCursor);
  float age = iTime - iTimeCursorChange;
  float fade = 1.0 - clamp(age / DURATION, 0.0, 1.0);
  vec2 travel = head - from;
  if (fade <= 0.0 || dot(travel, travel) < 4.0) { fragColor = base; return; }
  float along;
  float d = nmshSegment(fragCoord, from, head, along);
  float cell = max(iCurrentCursor.z, 2.0);
  float width = cell * 0.5 * pow(along, 1.5);
  float core = 1.0 - smoothstep(width, width + 1.5, d);
  float glow = GLOW > 0.0 ? exp(-d / (cell * GLOW)) * along * 0.6 : 0.0;
  vec3 color = mix(tailColor(), headColor(), along);
  float alpha = clamp(core + glow, 0.0, 1.0) * fade * INTENSITY;
  if (SPARKS) {
    vec2 grid = floor(fragCoord / 3.0);
    float spark = step(0.992, nmshHash(grid + floor(iTime * 24.0))) * (1.0 - smoothstep(cell, cell * 3.0, d));
    alpha = max(alpha, spark * fade * INTENSITY);
    color = mix(color, headColor(), spark);
  }
  fragColor = vec4(mix(base.rgb, color, alpha), base.a);
}
`,
  aurora: (values, context) => `vec3 auroraA() { return ${values.COLORS === 0 ? vec3(context.chroma.a) : 'COLOR_A'}; }
vec3 auroraB() { return ${values.COLORS === 0 ? vec3(context.chroma.b) : 'COLOR_B'}; }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  vec2 uv = fragCoord / iResolution.xy;
  float background = 1.0 - smoothstep(0.03, 0.12, distance(base.rgb, iBackgroundColor));
  float t = iTime * SPEED;
  float wave = sin(uv.x * 5.0 + t) * 0.6 + sin(uv.x * 11.0 - t * 1.4) * 0.3 + sin(uv.x * 23.0 + t * 0.6) * 0.1;
  float band = smoothstep(1.0 - HEIGHT, 1.0, uv.y + wave * 0.06);
  vec3 tint = mix(auroraA(), auroraB(), 0.5 + 0.5 * sin(uv.x * 3.0 + t * 0.7));
  fragColor = vec4(mix(base.rgb, tint, band * background * INTENSITY), base.a);
}
`,
  'focus-dim': () => `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  float back = iFocus > 0 ? clamp((iTime - iTimeFocus) / max(FADE, 0.001), 0.0, 1.0) : 0.0;
  float amount = 1.0 - back;
  vec3 gray = vec3(dot(base.rgb, vec3(0.2126, 0.7152, 0.0722)));
  vec3 color = mix(base.rgb, gray, DESATURATE * amount);
  fragColor = vec4(mix(color, iBackgroundColor, DIM * amount), base.a);
}
`,
  vignette: () => `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  vec2 centered = fragCoord / iResolution.xy - 0.5;
  centered.x *= iResolution.x / max(iResolution.y, 1.0);
  float edge = smoothstep(RADIUS * 0.5, RADIUS * 0.5 + SOFTNESS, length(centered));
  fragColor = vec4(mix(base.rgb, COLOR, edge * INTENSITY), base.a);
}
`,
  scanlines: () => `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  float line = mod(floor(fragCoord.y), float(SPACING)) < 1.0 ? 1.0 : 0.0;
  fragColor = vec4(base.rgb * (1.0 - INTENSITY * line), base.a);
}
`,
  glow: () => `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 pixel = 1.0 / iResolution.xy;
  vec4 base = texture(iChannel0, fragCoord * pixel);
  vec3 bloom = vec3(0.0);
  for (int ring = 1; ring <= 2; ring++) {
    for (int i = 0; i < 8; i++) {
      float angle = float(i) * 0.785398;
      vec2 offset = vec2(cos(angle), sin(angle)) * RADIUS * float(ring) * 0.5;
      vec3 sample1 = texture(iChannel0, (fragCoord + offset) * pixel).rgb;
      bloom += max(sample1 - vec3(0.45), vec3(0.0));
    }
  }
  fragColor = vec4(base.rgb + bloom / 16.0 * INTENSITY, base.a);
}
`,
};

export interface GeneratedShader {id: string; source: string; sha256: string; level: UniformLevel}

/** The exact GLSL NMSh writes for one preset; throws on invalid values instead of clamping. */
export function generateGhosttyShader(preset: GhosttyPresetDefinition, saved: Readonly<Record<string, ShaderValue>>, context: GenerationContext): GeneratedShader {
  const values = resolvedValues(preset, saved);
  for (const param of preset.params) {
    const problem = paramError(param, values[param.name]!);
    if (problem) throw new Error(`${preset.label}: ${param.label} ${problem}.`);
  }
  for (const color of [context.cursorColors.head, context.cursorColors.tail]) {
    if (color.length < 3 || !color.slice(0, 3).every(part => Number.isFinite(part) && part >= 0 && part <= 1)) throw new Error('The /cursor colors are not valid RGB values.');
  }
  for (const color of [context.chroma.a, context.chroma.b]) {
    if (color.length < 3 || !color.slice(0, 3).every(part => Number.isFinite(part) && part >= 0 && part <= 1)) throw new Error('The Chroma colors are not valid RGB values.');
  }
  const body = BODIES[preset.id];
  if (!body) throw new Error(`${preset.label} has no shader generator.`);
  const code = `${preset.params.map(param => constant(param, values[param.name]!)).join('\n')}\n${body(values, context)}`;
  const level = requiredLevel(code);
  if ('error' in level) throw new Error(`${preset.label} ${level.error}.`);
  const source = `// NMSh ${preset.label} for Ghostty. Generated by NMSh (/appearance › Ghostty shaders) from validated settings.
// Original NMSh code, GPL-3.0-only. Edits are replaced; remove with R in that studio.
// Needs the Ghostty ${level.level} shader interface (uses ${uniformsUsed(code).join(', ')}).
${code}`;
  return {id: preset.id, source, sha256: createHash('sha256').update(source).digest('hex'), level: level.level};
}

export interface GhosttyOfferedPreset {
  definition: GhosttyPresetDefinition;
  params: OfferedParam[];
  /** Always empty: NMSh writes these shaders itself, so every curated parameter exists. Kept for the shared studio panel. */
  missing: string[];
  level: UniformLevel;
}

export interface GhosttyCatalog {
  version: string;
  supported: boolean;
  reason?: string;
  capability: GhosttyCapability;
  offered: GhosttyOfferedPreset[];
  /** Presets this Ghostty's shader interface cannot run, with the version they need. */
  notOffered: string[];
}

const SAMPLE_CONTEXT: GenerationContext = {cursorColors: {head: [1, 1, 1], tail: [0.5, 0.5, 0.5]}, chroma: {a: [0, 1, 0.5], b: [0.5, 0, 1]}};

/** The presets this Ghostty can run, decided from the uniforms each generated shader actually reads. */
export function buildGhosttyCatalog(versionText: string | undefined): GhosttyCatalog {
  const capability = ghosttyCapability(versionText);
  const offered: GhosttyOfferedPreset[] = [];
  const notOffered: string[] = [];
  for (const definition of GHOSTTY_PRESETS) {
    // The default source and the live-cursor-color variant together cover every uniform the preset can read.
    const variants = [definition.defaults, ...(definition.params.some(param => param.name === 'COLOR_SOURCE') ? [{...definition.defaults, COLOR_SOURCE: 2}] : [])];
    const levels = variants.map(values => generateGhosttyShader(definition, values, SAMPLE_CONTEXT).level);
    const level: UniformLevel = levels.includes('1.3') ? '1.3' : '1.2';
    if (!capability.supported || !capability.level || !levelAllows(capability.level, level)) { notOffered.push(`${definition.label} (Ghostty ${level}+)`); continue; }
    offered.push({definition, level, missing: [], params: definition.params.map(param => ({...param, default: definition.defaults[param.name]!}))});
  }
  return {version: capability.version, supported: capability.supported, ...(capability.reason ? {reason: capability.reason} : {}), capability, offered, notOffered};
}
