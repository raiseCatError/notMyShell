/**
 * NMSh's own shader effects, written for both hosts from ONE source:
 * Ghostty (Shadertoy-style GLSL `mainImage`) and Kitty 0.49+ (Slang
 * `fragment_main`, written by NMSh next to its own pipeline file).
 *
 * Each effect's look lives in a host-neutral core function written in a small
 * GLSL subset; `toSlang` translates that subset mechanically (vecN → floatN,
 * mix → lerp, fract → frac, mod → fmod, atan → atan2). Only the thin wrappers
 * differ: where the cursor, time and theme color come from, and Kitty's linear
 * colors, which the wrapper converts to and from a gamma-2 space so thresholds
 * and palettes mean the same on both hosts.
 *
 * Every effect has at most three settings, all friendly choices compiled in
 * as `const int` (Ghostty) or `static const int` replaced by Kitty pipeline
 * vars: Color, Strength (Subtle / Balanced / Vivid), Speed (Calm / Normal /
 * Lively) or, for Shine Sweep, its cadence. Original NMSh code, GPL-3.0-only.
 */
import type {KittyGroup, PresetParam, ShaderValue} from './kittyShaderCatalog.js';

export type NmshEffectId = 'ink-bloom' | 'type-garden' | 'filament' | 'glitch-hop' | 'gravity-lens' | 'holo-foil' | 'shine-sweep' | 'halo-bloom';

export interface NmshEffect {
  id: NmshEffectId;
  label: string;
  /** typing: cursor & typing effects (one at a time, shared with the cursor trails); welcome: colorful content only. */
  category: 'typing' | 'welcome';
  /** One plain line for the studio. */
  description: string;
  params: readonly PresetParam[];
  defaults: Readonly<Record<string, number>>;
  /** sRGB palettes per COLOR choice (index = choice value); 'theme' reads the host's live cursor color. */
  palette?: ReadonlyArray<ReadonlyArray<readonly [number, number, number] | 'theme'>>;
  /** Reads time continuously (redraws every frame while the host animates). */
  animated: boolean;
}

const choice = (name: string, label: string, names: readonly string[]): PresetParam =>
  ({name, label, kind: 'choice', type: 'int', choices: names.map((item, index) => [index, item] as const)});
const STRENGTH = choice('STRENGTH', 'Strength', ['Subtle', 'Balanced', 'Vivid']);
const SPEED = choice('SPEED', 'Speed', ['Calm', 'Normal', 'Lively']);
export const SHINE_CADENCES = ['Every minute', 'On focus only', 'Every 15 s'] as const;

type Rgb = readonly [number, number, number];
const THEME = 'theme' as const;

export const NMSH_EFFECTS: readonly NmshEffect[] = [
  {id: 'ink-bloom', label: 'Ink Bloom', category: 'typing', animated: false,
    description: 'Each letter you type bleeds a soft watercolor bloom that spreads a little and dries.',
    params: [choice('COLOR', 'Ink', ['From theme', 'Indigo', 'Vermilion', 'Teal']), STRENGTH, SPEED], defaults: {COLOR: 1, STRENGTH: 1, SPEED: 1},
    palette: [[THEME, THEME], [[0.36, 0.42, 1], [0.62, 0.36, 1]], [[1, 0.33, 0.24], [1, 0.62, 0.25]], [[0.1, 0.85, 0.78], [0.25, 0.55, 1]]]},
  {id: 'type-garden', label: 'Type Garden', category: 'typing', animated: false,
    description: 'Typing grows tiny glowing sprouts from the letter just typed; they sway, rise and fade.',
    params: [choice('COLOR', 'Petals', ['Spring', 'From theme', 'Sakura', 'Firefly']), STRENGTH, SPEED], defaults: {COLOR: 0, STRENGTH: 1, SPEED: 1},
    // [stem, petal A, petal B]
    palette: [[[0.42, 0.95, 0.55], [1, 0.5, 0.78], [1, 0.84, 0.35]], [[0.42, 0.9, 0.6], THEME, THEME], [[0.86, 0.58, 0.68], [1, 0.72, 0.84], [1, 0.9, 0.94]],
      [[0.55, 0.85, 0.28], [1, 0.92, 0.42], [0.72, 1, 0.5]]]},
  {id: 'filament', label: 'Filament', category: 'typing', animated: false,
    description: 'The cursor’s path leaves a coiled hot filament that cools from white to amber to deep red.',
    params: [choice('COLOR', 'Glow', ['Tungsten', 'From theme', 'Plasma']), STRENGTH, SPEED], defaults: {COLOR: 0, STRENGTH: 1, SPEED: 1},
    // [cold, warm, hot] (white-hot is added on top)
    palette: [[[0.5, 0.03, 0.01], [1, 0.32, 0.05], [1, 0.7, 0.25]], [THEME, THEME, THEME], [[0.3, 0.06, 0.62], [0.42, 0.36, 1], [0.45, 0.92, 1]]]},
  {id: 'glitch-hop', label: 'Glitch Hop', category: 'typing', animated: false,
    description: 'Big cursor jumps tear a brief RGB-split slice glitch along the path, near the cursor only.',
    params: [choice('COLOR', 'Split', ['Classic RGB', 'Cyan / magenta', 'From theme']), STRENGTH, SPEED], defaults: {COLOR: 0, STRENGTH: 1, SPEED: 1},
    // [left ghost weight, right ghost weight] per channel; the rest stays in place
    palette: [[[1, 0, 0], [0, 0, 1]], [[0.7, 0, 0.45], [0, 0.7, 0.45]], [THEME, THEME]]},
  {id: 'gravity-lens', label: 'Gravity Lens', category: 'typing', animated: false,
    description: 'Text near a moving cursor bends toward it for a moment, then springs back.',
    params: [STRENGTH, SPEED], defaults: {STRENGTH: 1, SPEED: 1}},
  {id: 'holo-foil', label: 'Holo Foil', category: 'welcome', animated: true,
    description: 'An iridescent, slowly shifting holographic sheen on colorful art, like a foil trading card.',
    params: [choice('COLOR', 'Foil', ['Rainbow', 'Pearl', 'From theme']), STRENGTH, SPEED], defaults: {COLOR: 0, STRENGTH: 1, SPEED: 1}},
  {id: 'shine-sweep', label: 'Shine Sweep', category: 'welcome', animated: true,
    description: 'A specular light band sweeps across colorful art when the window opens, then now and then.',
    params: [choice('COLOR', 'Light', ['White', 'Gold', 'From theme']), STRENGTH, choice('CADENCE', 'Shine', SHINE_CADENCES)], defaults: {COLOR: 0, STRENGTH: 1, CADENCE: 0},
    palette: [[[1, 1, 1]], [[1, 0.84, 0.5]], [THEME]]},
  {id: 'halo-bloom', label: 'Halo Bloom', category: 'welcome', animated: true,
    description: 'A soft, slowly breathing glow around bright, colorful art.',
    params: [choice('COLOR', 'Glow', ['Own colors', 'From theme']), STRENGTH, SPEED], defaults: {COLOR: 0, STRENGTH: 1, SPEED: 1}},
];

export const nmshEffect = (id: string) => NMSH_EFFECTS.find(effect => effect.id === id);
/** Kitty shader file names (written next to NMSh's pipeline). */
export const kittyShaderName = (id: NmshEffectId) => `nmsh-${id}`;
export const NMSH_KITTY_SHADERS: ReadonlySet<string> = new Set(NMSH_EFFECTS.map(effect => kittyShaderName(effect.id)));
/** Kitty shader names that draw the cursor (Portable must not draw a second trail). */
export const NMSH_KITTY_CURSOR_SHADERS: ReadonlySet<string> = new Set(NMSH_EFFECTS.filter(effect => effect.category === 'typing').map(effect => kittyShaderName(effect.id)));

// ---- Shared GLSL-subset source -----------------------------------------------------------------------------------

const COMMON = `float nmshHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nmshStrength() { return STRENGTH == 0 ? 0.55 : (STRENGTH == 1 ? 1.0 : 1.7); }
float nmshLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 nmshScreen(vec3 a, vec3 b) { return vec3(1.0) - (vec3(1.0) - a) * (vec3(1.0) - clamp(b, vec3(0.0), vec3(1.0))); }
`;
const PACE = `float nmshPace() { return SPEED == 0 ? 0.7 : (SPEED == 1 ? 1.0 : 1.45); }
`;
/** Typing moves the caret right on its row by a cell or a few (a paste or completion lands further, Enter changes row). */
const TYPED = `bool nmshTyped(vec2 from, vec2 to, float cellH) {
  vec2 step1 = to - from;
  return step1.x > 1.0 && abs(step1.y) < cellH * 0.5 && step1.x < cellH * 3.0;
}
`;
/** How colorful a gamma-space color is (0 for gray text and backgrounds). */
const COLORFUL = `float nmshColorful(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  return smoothstep(0.2, 0.42, hi - lo) * smoothstep(0.18, 0.4, hi);
}
`;
/** Colorful AND solid: blocks, images and filled art pass; thin glyph strokes (colored words) mostly do not. */
const SOLID = `float nmshSolid(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res) {
  float own = nmshColorful(base);
  if (own <= 0.0) return 0.0;
  float near = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.3927;
    near += nmshColorful(NMSH_SAMPLE(frag + vec2(cos(a), sin(a)) * 5.0));
  }
  return own * smoothstep(5.0, 7.5, near);
}
`;

/** One host-neutral core per effect: vec3 nmshEffect(...) returns the new gamma-space color. */
const CORES: Record<NmshEffectId, string> = {
  'ink-bloom': `${PACE}${TYPED}vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, vec2 from, vec2 to, float cellH, float age, vec3 theme) {
  if (!nmshTyped(from, to, cellH)) return base;
  float p = age * nmshPace() / 1.15;
  if (p >= 1.0 || p < 0.0) return base;
  vec2 d = frag - from;
  float seed = nmshHash(floor(from / 3.0));
  float angle = atan(d.y, d.x);
  float edge = 1.0 + 0.13 * sin(angle * 2.0 + seed * 6.283) + 0.1 * sin(angle * 3.0 - seed * 11.0) + 0.04 * sin(angle * 5.0 + seed * 23.0);
  float spread = 1.0 - (1.0 - min(p * 1.7, 1.0)) * (1.0 - min(p * 1.7, 1.0)) * (1.0 - min(p * 1.7, 1.0));
  float radius = cellH * mix(0.28, 1.0, spread) * edge;
  float r = length(d * vec2(1.0, 1.2));
  if (r > radius * 1.35) return base;
  float k = nmshStrength();
  float wet = 1.0 - p;
  float dry = 1.0 - smoothstep(0.5, 1.0, p);
  float body = 1.0 - smoothstep(radius * 0.2, radius, r);
  float rimWidth = cellH * mix(0.05, 0.09, spread);
  float rim = exp(-((r - radius * 0.88) * (r - radius * 0.88)) / (rimWidth * rimWidth));
  float grain = 0.7 + 0.6 * nmshHash(floor(frag / 2.0) + seed * 17.0);
  float bloom = 0.2 + 0.25 * nmshHash(floor(frag / 7.0) + seed * 5.0);
  vec3 ink = mix(nmshColorA(theme), nmshColorB(theme), smoothstep(0.3, 1.0, r / radius));
  float feather = r > radius * 0.9 ? exp(-(r - radius * 0.9) / (cellH * 0.12)) * 0.35 : 0.0;
  float wash = k * ((body * (0.36 * wet + 0.07) + feather * dry) * grain + rim * 0.4 * dry * (0.55 + bloom));
  vec3 color = nmshScreen(base, ink * wash);
  // Glyph strokes inside the bloom drink the ink while it is wet.
  float text = smoothstep(0.25, 0.6, nmshLuma(base));
  color = mix(color, ink * (0.55 + 0.6 * nmshLuma(base)), text * body * wet * 0.55 * min(k, 1.0));
  return mix(color, ink, wash * 0.12);
}
`,
  'type-garden': `${PACE}${TYPED}vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, vec2 from, vec2 to, float cellH, float age, vec3 theme) {
  if (!nmshTyped(from, to, cellH)) return base;
  float p = age * nmshPace() / 1.5;
  if (p >= 1.0 || p < 0.0) return base;
  // Work with y pointing up on every host.
  vec2 flip = vec2(1.0, NMSH_UP);
  vec2 rel0 = (frag - from) * flip;
  if (abs(rel0.x) > cellH * 1.3 || rel0.y < -cellH * 0.7 || rel0.y > cellH * 2.4) return base;
  float cellW = cellH * 0.5;
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float h1 = nmshHash(floor(from / 3.0) + vec2(fi * 7.3, 1.7));
    float h2 = nmshHash(floor(from / 3.0) + vec2(fi * 3.1, 11.0));
    float delay = fi * 0.09;
    float q = clamp((p - delay) / (1.0 - delay), 0.0, 1.0);
    float grow = 1.0 - (1.0 - min(q * 2.4, 1.0)) * (1.0 - min(q * 2.4, 1.0));
    float height = cellH * (0.65 + 0.55 * h2) * grow;
    float rise = cellH * 0.35 * smoothstep(0.4, 1.0, q);
    float fade = (1.0 - smoothstep(0.55, 1.0, q)) * smoothstep(0.0, 0.05, q);
    vec2 rel = rel0 - vec2((fi - 1.0) * cellW * 0.5 + (h1 - 0.5) * cellW * 0.25, cellH * 0.3 + rise);
    float s = clamp(rel.y / max(height, 1.0), 0.0, 1.0);
    float sway = sin(time * 4.5 * nmshPace() + fi * 2.1 + h1 * 6.283) * cellW * 0.2;
    float lean = (h1 - 0.5) * cellW * 0.8;
    float bend = (sway + lean) * s * s;
    float dx = rel.x - bend;
    float width = mix(2.2, 1.0, s);
    float stem = (rel.y >= -1.0 && rel.y <= height) ? exp(-(dx * dx) / (width * width)) : 0.0;
    // One leaf on the side the sprout leans away from.
    vec2 leafAt = vec2(bend * 0.3 - sign(lean + 0.001) * cellW * 0.16, height * 0.42);
    vec2 lv = (rel - leafAt) * vec2(1.0, 2.0);
    float leaf = (1.0 - smoothstep(cellW * 0.1, cellW * 0.2, length(lv))) * smoothstep(0.2, 0.5, q);
    vec2 fd = rel - vec2(sway + lean, height);
    float fr = length(fd);
    float fa = atan(fd.y, fd.x) + time * 0.7 + h2 * 6.283;
    float open1 = smoothstep(0.2, 0.55, q);
    float petalR = cellW * (0.12 + 0.3 * open1) * (0.45 + 0.55 * abs(cos(2.5 * fa)));
    float petal = 1.0 - smoothstep(petalR * 0.5, petalR, fr);
    float core = exp(-(fr * fr) / (cellW * cellW * 0.012));
    float halo = exp(-fr / (cellW * 0.4)) * 0.5;
    vec3 bloomColor = mix(nmshColorB(theme), nmshColorC(theme), h2);
    glow += (nmshColorA(theme) * (stem * 0.9 + leaf * 0.7) + bloomColor * (petal * 0.95 + halo) + vec3(1.0, 0.96, 0.85) * core * open1) * fade;
  }
  return nmshScreen(base, glow * nmshStrength() * 0.9);
}
`,
  filament: `${PACE}vec3 nmshHeat(float h, vec3 theme) {
  vec3 c = mix(vec3(0.0), nmshColorA(theme), smoothstep(0.0, 0.25, h));
  c = mix(c, nmshColorB(theme), smoothstep(0.2, 0.5, h));
  c = mix(c, nmshColorC(theme), smoothstep(0.45, 0.75, h));
  return mix(c, vec3(1.0, 0.97, 0.9), smoothstep(0.75, 1.0, h));
}
vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, vec2 from, vec2 to, float cellH, float age, vec3 theme) {
  vec2 travel = to - from;
  float len = length(travel);
  if (len < 2.0) return base;
  float p = age * nmshPace() / 0.95;
  if (p >= 1.0 || p < 0.0) return base;
  vec2 dir = travel / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 rel = frag - from;
  float along = dot(rel, dir);
  float across = dot(rel, nrm);
  if (along < -cellH || along > len + cellH || abs(across) > cellH * 1.6) return base;
  float s = clamp(along / len, 0.0, 1.0);
  float pitch = cellH * 0.3;
  float taper = sqrt(clamp(s * (1.0 - s) * 4.0, 0.0, 1.0));
  float wobble = sin(along * 0.045 - time * 9.0) * cellH * 0.06 * (1.0 - p);
  float coil = sin(along / pitch * 6.283) * cellH * 0.11 * taper + wobble * taper;
  float off = max(max(-along, along - len), 0.0);
  float dist = length(vec2(across - coil, off));
  // The head (where the cursor is) burns hottest; the far end cools first.
  float heat = clamp(1.12 - p * 1.25 - (1.0 - s) * (0.25 + 0.6 * p), 0.0, 1.0);
  if (heat <= 0.0) return base;
  float core = exp(-(dist * dist) / ((0.8 + 1.6 * heat) * (0.8 + 1.6 * heat)));
  float glow = exp(-dist / (cellH * (0.1 + 0.22 * heat))) * 0.5;
  vec3 light = nmshHeat(heat, theme) * (core * 1.25 + glow) * nmshStrength();
  return base + light * (1.0 - nmshLuma(base) * 0.4);
}
`,
  'glitch-hop': `${PACE}float nmshSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}
vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, vec2 from, vec2 to, float cellH, float age, vec3 theme) {
  float jump = length(to - from);
  if (jump < cellH * 1.4) return base;
  float p = age * nmshPace() / 0.5;
  if (p >= 1.0 || p < 0.0) return base;
  float band = 1.0 - smoothstep(cellH * 0.55, cellH * 1.0, nmshSegment(frag, from, to));
  float dest = 1.0 - smoothstep(cellH * 1.1, cellH * 2.3, length(frag - to));
  float region = max(band * 0.75, dest);
  if (region <= 0.0) return base;
  float k = nmshStrength();
  float frame = floor(age * 30.0);
  float slice = floor(frag.y / (cellH * 0.23));
  float r1 = nmshHash(vec2(slice, frame + 3.0));
  float r2 = nmshHash(vec2(frame * 1.3 + 7.0, slice * 1.7));
  float env = (1.0 - p) * (1.0 - p) * (0.55 + 0.45 * step(0.35, nmshHash(vec2(frame, 9.0))));
  float tear = step(0.5, r1) * (r2 - 0.5) * cellH * 1.6 * k * env * region;
  float split = cellH * 0.13 * k * env * region * (0.5 + r1);
  vec2 at = frag + vec2(tear, 0.0);
  vec3 mid = NMSH_SAMPLE(at);
  vec3 left = NMSH_SAMPLE(at + vec2(split, 0.0));
  vec3 right = NMSH_SAMPLE(at - vec2(split, 0.0));
  vec3 a = nmshColorA(theme);
  vec3 b = nmshColorB(theme);
  vec3 keep = clamp(vec3(1.0) - a - b, vec3(0.0), vec3(1.0));
  vec3 color = mid * keep + left * a + right * b;
  color *= 1.0 - 0.22 * env * region * step(0.5, fract(frag.y * 0.5));
  color += (step(0.92, r1) * 0.3 + step(0.7, r2) * 0.12) * env * region * k * mix(a, b, r2);
  return mix(base, color, step(0.001, region));
}
`,
  'gravity-lens': `${PACE}vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, vec2 from, vec2 to, float cellH, float age, vec3 theme) {
  float travel = length(to - from);
  if (travel < 2.0) return base;
  float p = age * nmshPace() / 1.0;
  if (p >= 1.0 || p < 0.0) return base;
  float radius = cellH * 2.6;
  vec2 d = frag - to;
  float r = length(d);
  if (r > radius * 1.7) return base;
  float k = nmshStrength();
  float reach = clamp(travel / (cellH * 3.0), 0.4, 1.0);
  float spring = exp(-3.6 * p) * cos(p * 7.5) * (1.0 - exp(-40.0 * p));
  float x = r / radius;
  float fall = x * exp(-x * x * 1.7);
  float pull = k * cellH * 0.85 * reach * spring * fall;
  vec3 color = NMSH_SAMPLE(frag + d / max(r, 0.001) * pull);
  float ringR = radius * (0.3 + 0.55 * p);
  float ringW = cellH * 0.07;
  float ring = exp(-((r - ringR) * (r - ringR)) / (ringW * ringW)) * exp(-5.0 * p) * reach * k * 0.3;
  return nmshScreen(color, nmshColorA(theme) * ring);
}
`,
  'holo-foil': `${PACE}${COLORFUL}${SOLID}vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, float since, vec3 theme) {
  float m = nmshSolid(NMSH_TEX_ARG frag, base, res);
  if (m <= 0.0) return base;
  float k = nmshStrength();
  vec2 uv = frag / res.y;
  float t = time * 0.1 * nmshPace();
  float lum = nmshLuma(base);
  // Thin-film color: shifts with position (a stand-in for viewing angle), brightness and slow drift.
  float phase = dot(uv, vec2(0.6, 0.8)) * 1.7 - t + lum * 0.45 + 0.07 * sin(uv.y * 19.0 + t * 5.0);
  vec3 film = nmshFilm(phase, theme);
  vec3 foil = film * (0.42 + 0.8 * lum);
  // A broad specular highlight crosses the art diagonally every few seconds.
  float sweep = fract(t * 1.2) * 1.8 - 0.4;
  float sd = dot(uv, vec2(0.7071)) / (res.x / res.y * 0.7071 + 0.7071) - sweep;
  float sheen = exp(-(sd * sd) / 0.0035);
  // Glitter: sparse foil flecks that twinkle.
  float fleck = nmshHash(floor(frag / 2.0));
  float glitter = step(0.965, fleck) * (0.5 + 0.5 * sin(time * 2.6 * nmshPace() + fleck * 60.0));
  vec3 color = mix(base, foil, m * min(0.52 * k, 0.9));
  return color + (film * 0.3 + vec3(0.3)) * sheen * m * k + vec3(glitter * m * k * 0.55);
}
`,
  'shine-sweep': `${COLORFUL}${SOLID}vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, float since, vec3 theme) {
  float age = CADENCE == 1 ? since : mod(max(since, 0.0), CADENCE == 0 ? 60.0 : 15.0);
  float duration = 2.2;
  if (age < 0.0 || age > duration) return base;
  float m = nmshSolid(NMSH_TEX_ARG frag, base, res);
  if (m <= 0.0) return base;
  float k = nmshStrength();
  float down = NMSH_UP > 0.0 ? res.y - frag.y : frag.y;
  float u = (frag.x + down * 0.5) / (res.x + res.y * 0.5);
  float ease = age / duration;
  ease = ease * ease * (3.0 - 2.0 * ease);
  float d = u - mix(-0.1, 1.1, ease);
  float w = 0.035;
  float band = exp(-(d * d) / (w * w));
  float hot = exp(-(d * d) / (w * w * 0.025));
  float glint = exp(-((d + w * 1.1) * (d + w * 1.1)) / (w * w * 0.02));
  vec3 fringe = 0.5 + 0.5 * cos(6.283 * (d / w * 0.35 + vec3(0.0, 0.33, 0.67)));
  vec3 light = nmshColorA(theme);
  vec3 color = base + (light * (band * 0.32 + hot * 0.7 + glint * 0.45) + fringe * band * 0.1) * m * k;
  return mix(color, light, hot * m * 0.25 * k);
}
`,
  'halo-bloom': `${PACE}${COLORFUL}vec3 nmshEffect(NMSH_TEX_PARAM vec2 frag, vec3 base, vec2 res, float time, float since, vec3 theme) {
  vec3 halo = vec3(0.0);
  float weight = 0.0;
  for (int ring = 1; ring <= 2; ring++) {
    float fr = float(ring);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236 + fr * 0.2618;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 at = frag + dir * 7.0 * fr;
      vec3 s = NMSH_SAMPLE(at);
      // Both the sample and its neighbor across the ray must be colorful: solid art glows, thin colored words do not.
      float c = nmshColorful(s) * nmshColorful(NMSH_SAMPLE(at + vec2(-dir.y, dir.x) * 3.0));
      float w = fr == 1.0 ? 1.0 : 0.6;
      halo += s * s * c * w * 1.6;
      weight += w;
    }
  }
  halo /= weight;
  if (COLOR == 1) halo = nmshColorA(theme) * nmshLuma(halo) * 1.6;
  float period = SPEED == 0 ? 6.0 : (SPEED == 1 ? 4.0 : 2.6);
  float breathe = 0.68 + 0.32 * sin(time * 6.283 / period);
  float k = nmshStrength();
  return nmshScreen(base, halo * k * 1.9 * breathe * (1.0 - nmshColorful(base) * 0.5));
}
`,
};

// ---- Colors ------------------------------------------------------------------------------------------------------

/** GLSL palette functions for an effect: COLOR is a compile-time constant on both hosts, so the ternary folds away. */
function paletteFunctions(effect: NmshEffect, literal: (rgb: Rgb) => string): string {
  const names = ['nmshColorA', 'nmshColorB', 'nmshColorC'];
  if (effect.id === 'holo-foil') {
    return `vec3 nmshFilm(float phase, vec3 theme) {
  vec3 rainbow = vec3(0.5) + 0.5 * cos(6.283 * (phase + vec3(0.0, 0.33, 0.67)));
  if (COLOR == 1) return mix(rainbow, vec3(1.0, 0.96, 0.98), 0.55);
  if (COLOR == 2) return mix(theme, vec3(1.0) - theme * 0.6, 0.5 + 0.5 * sin(phase * 6.283));
  return rainbow;
}
`;
  }
  if (effect.id === 'halo-bloom' || effect.id === 'gravity-lens') return 'vec3 nmshColorA(vec3 theme) { return theme; }\n';
  const palette = effect.palette ?? [];
  const slots = Math.max(...palette.map(entry => entry.length));
  return names.slice(0, slots).map((name, slot) => {
    const options = palette.map(entry => {
      const value = entry[Math.min(slot, entry.length - 1)]!;
      if (value !== THEME) return literal(value);
      // Theme slots derive related tones from the one live color.
      if (effect.id === 'filament') return slot === 0 ? `theme * 0.35` : slot === 1 ? `theme` : `mix(theme, vec3(1.0), 0.45)`;
      if (effect.id === 'glitch-hop') return slot === 0 ? `theme * 0.6` : `(vec3(1.0) - theme) * 0.6`;
      if (effect.id === 'ink-bloom' && slot === 1) return `mix(theme, theme.gbr, 0.35)`;
      if (effect.id === 'type-garden' && slot === 2) return `mix(theme, vec3(1.0), 0.4)`;
      return 'theme';
    });
    const body = options.reduceRight((rest, option, index) => index === options.length - 1 ? option : `COLOR == ${index} ? ${option} : (${rest})`, '');
    return `vec3 ${name}(vec3 theme) { return ${body}; }\n`;
  }).join('');
}

// ---- Hosts -------------------------------------------------------------------------------------------------------

const glslNumber = (value: number) => { const text = Number(value.toFixed(4)).toString(); return /[.eE]/u.test(text) ? text : `${text}.0`; };
const glslRgb = (rgb: Rgb) => `vec3(${rgb.map(glslNumber).join(', ')})`;
const coreSource = (effect: NmshEffect) => `${COMMON}${paletteFunctions(effect, glslRgb)}${CORES[effect.id]}`;
const isTyping = (effect: NmshEffect) => effect.category === 'typing';

/**
 * The Ghostty GLSL body (after NMSh's `const` lines for each parameter). Cursor geometry comes from Ghostty's
 * cursor uniforms; the cell height from the cursor rectangle (an underline cursor is short, so its width stands in).
 */
export function nmshGhosttyBody(id: NmshEffectId, platform: NodeJS.Platform): string {
  const effect = nmshEffect(id)!;
  // Ghostty renders through Metal on macOS, where fragCoord's y grows downward (observed with Ghostty 1.3.1); OpenGL's grows upward.
  const glue = `#define NMSH_UP ${platform === 'darwin' ? '-1.0' : '1.0'}
#define NMSH_TEX_PARAM
#define NMSH_TEX_ARG
#define NMSH_SAMPLE(px) texture(iChannel0, (px) / res).rgb
`;
  const main = isTyping(effect) ? `vec2 nmshCenter(vec4 rect) { return rect.xy + vec2(rect.z * 0.5, -rect.w * 0.5); }
float nmshCellHeight(vec4 rect) { return rect.w >= rect.z ? max(rect.w, 8.0) : max(rect.z * 2.0, 8.0); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  vec3 color = nmshEffect(fragCoord, base.rgb, iResolution.xy, iTime, nmshCenter(iPreviousCursor), nmshCenter(iCurrentCursor),
    nmshCellHeight(iCurrentCursor), iTime - iTimeCursorChange, iCurrentCursorColor.rgb);
  fragColor = vec4(color, base.a);
}
` : `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = texture(iChannel0, fragCoord / iResolution.xy);
  float since = ${effect.id === 'shine-sweep' ? '(CADENCE == 1 && iFocus == 0) ? -1.0 : iTime - iTimeFocus' : '0.0'};
  vec3 color = nmshEffect(fragCoord, base.rgb, iResolution.xy, iTime, since, iCurrentCursorColor.rgb);
  fragColor = vec4(color, base.a);
}
`;
  return `${glue}${coreSource(effect)}${main}`;
}

/** The mechanical GLSL-subset → Slang translation used for the shared cores (see the module comment). */
export const toSlang = (glsl: string) => glsl.replace(/\bvec([234])\b/gu, 'float$1').replace(/\bmix\(/gu, 'lerp(').replace(/\bfract\(/gu, 'frac(')
  .replace(/\bmod\(/gu, 'fmod(').replace(/\batan\(/gu, 'atan2(');

/** The complete Kitty `.slang` file for one effect. Values arrive as pipeline vars replacing the `static const` defaults. */
export function nmshKittySource(id: NmshEffectId): string {
  const effect = nmshEffect(id)!;
  const constants = effect.params.map(param => `static const int ${param.name} = ${effect.defaults[param.name]};`).join('\n');
  // Kitty's colors are linear: samples are taken to gamma 2 (sqrt) and results brought back (squared), so the
  // shared thresholds and palettes mean the same as on Ghostty.
  const glue = `#define NMSH_UP 1.0
#define NMSH_TEX_PARAM KittyTextures t,
#define NMSH_TEX_ARG t,
#define NMSH_SAMPLE(px) sqrt(max(t.backbuffer.Sample((px) / res).rgb, float3(0.0)))
`;
  const theme = 'sqrt(max(d.cursor_color.a > 0.0 ? d.cursor_color.rgb : d.foreground.rgb, float3(0.0)))';
  const main = isTyping(effect) ? `public float4
fragment_main(float4 color, KittyTextures t, KittyCustomShaderData d) {
    // Kitty reports the cursor only while its cursor trail animates; NMSh's pipeline runs this group exactly then.
    float4 now = d.cursor_trail_edge;
    float4 before = d.cursor_trail_prev_edge;
    if (now.y <= 0.0 || before.y <= 0.0 || d.cursor_trail_change_time <= 0.0) return color;
    float2 res = float2(d.viewport_size_pixels);
    float2 to = float2((now.x + now.y) * 0.5, (now.z + now.w) * 0.5) * res;
    float2 from = float2((before.x + before.y) * 0.5, (before.z + before.w) * 0.5) * res;
    float cellH = max((now.z - now.w) * res.y, 8.0);
    float3 base = sqrt(max(color.rgb, float3(0.0)));
    float3 result = nmshEffect(t, t.pos * res, base, res, d.timestamp, from, to, cellH, d.timestamp - d.cursor_trail_change_time, ${theme});
    return float4(result * result, color.a);
}
` : `public float4
fragment_main(float4 color, KittyTextures t, KittyCustomShaderData d) {
    float2 res = float2(d.viewport_size_pixels);
    float3 base = sqrt(max(color.rgb, float3(0.0)));
    float since = ${effect.id === 'shine-sweep' ? 'CADENCE == 1 ? t.animation_progress * 2.2 : d.timestamp' : '0.0'};
    float3 result = nmshEffect(t, t.pos * res, base, res, d.timestamp, since, ${theme});
    return float4(result * result, color.a);
}
`;
  return `#language slang 2026
// NMSh ${effect.label} for Kitty. Generated by NMSh (/appearance › Kitty shaders); original NMSh code, GPL-3.0-only.
// Edits are replaced; remove with R in that studio. Settings arrive as pipeline vars.
import kitty_custom_shader_types;

${constants}
${glue}${toSlang(coreSource(effect))}${main}`;
}

/**
 * Kitty pipeline groups for an effect. Cursor & typing effects run while Kitty's cursor trail animates (subscribing also
 * hides Kitty's built-in trail, so there is one cursor effect); welcome effects run continuously, except Shine Sweep's
 * "On focus only", which starts when the OS window gains focus (Kitty also fires that when the pipeline loads).
 */
export function nmshKittyGroups(id: NmshEffectId, values: Readonly<Record<string, ShaderValue>>): KittyGroup[] {
  const effect = nmshEffect(id)!;
  const shaders = [kittyShaderName(id)];
  if (isTyping(effect)) return [{shaders, vars: [], attach: false, animationStart: 'cursor-trail-move', animationStop: 'cursor-trail-stop', animationStep: 16}];
  if (id === 'shine-sweep' && values.CADENCE === 1) return [{shaders, vars: [], attach: false, animationStart: 'os-window-focus-in', animationStop: '2200', animationStep: 16}];
  return [{shaders, vars: [], attach: false, animationStep: 33}];
}
