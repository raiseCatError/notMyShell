/**
 * Shader Studio previews: a small sample terminal drawn by NMSh in cells,
 * approximating what a host shader preset does, so a person can compare
 * presets and parameters before reviewing a write. It is an approximation in
 * NMSh's own renderer, never the host's GPU output, and it says so.
 *
 * One run plays once on selection or a value change (P replays) and then
 * settles: no idle frame clock. Reduced Motion and Effects Off show a still
 * frame; without color there is no preview.
 */
import type {RgbColor} from '../ui/palette.js';
import {colorEscape} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import type {PresetCategory, ShaderValue} from './kittyShaderCatalog.js';
import {nmshEffect, type NmshEffectId} from './nmshShaders.js';

export type PreviewKind = 'trail' | 'comet' | 'blaze' | 'lightning' | 'motion-blur' | 'aurora' | 'dim' | 'vignette' | 'scanlines' | 'glow' | NmshEffectId;

/**
 * Each trail style has its own shape, modelled on what the shader draws (Kitty 0.49.2's shipped sources; NMSh's Ghostty
 * passes): Blaze fills a wide amber band with a red edge that eases out; Lightning flashes a thin jagged bolt with forks
 * and is gone almost at once; Motion blur smears ghost copies of the cursor along its path; Default and Smear are a plain
 * fading tail; Comet tapers. One shared shape with different colors made Blaze and Lightning look the same.
 */
const TRAIL_KINDS: Readonly<Record<string, PreviewKind>> = {'cursor-trail-blaze': 'blaze', 'cursor-trail-lightning': 'lightning',
  'cursor-trail-motion-blur': 'motion-blur', comet: 'comet'};
const TRAIL_PREVIEWS: ReadonlySet<PreviewKind> = new Set(['trail', 'comet', 'blaze', 'lightning', 'motion-blur']);

/** The preview kind for a preset (Ghostty and Kitty ids), or undefined when NMSh has no faithful approximation. */
export function previewKind(id: string, category: PresetCategory): PreviewKind | undefined {
  // NMSh's own effects each have their own preview (same id on both hosts).
  if (nmshEffect(id)) return id as NmshEffectId;
  if (category === 'cursor') return TRAIL_KINDS[id] ?? 'trail';
  if (id === 'aurora' || id === 'northern-lights') return 'aurora';
  if (id === 'focus-dim' || id === 'dim-inactive-windows') return 'dim';
  if (id === 'vignette' || id === 'spotlight') return 'vignette';
  if (id === 'scanlines' || id === 'crt' || id === 'crt-blue' || id === 'tft') return 'scanlines';
  if (id === 'glow' || id === 'bloom') return 'glow';
  return undefined;
}

/**
 * Kitty presets name their settings differently: map them onto the preview's parameters so moving a Kitty slider changes
 * the preview too. INACTIVE_DIM is the brightness KEPT, so it inverts.
 */
export function previewValues(id: string, values: Readonly<Record<string, ShaderValue>>): Record<string, ShaderValue> {
  const out: Record<string, ShaderValue> = {...values};
  const set = (to: string, value: ShaderValue | undefined) => { if (value !== undefined) out[to] = value; };
  set('INTENSITY', values.EFFECT_INTENSITY ?? values.AURORA_INTENSITY ?? values.SCAN ?? values.STRENGTH ?? values.BLOOM_STRENGTH);
  set('SPEED', values.TIME_SCALE);
  set('RADIUS', values.SPOTLIGHT_RADIUS === undefined ? undefined : 0.3 + (values.SPOTLIGHT_RADIUS as number) * 1.5);
  if (typeof values.INACTIVE_DIM === 'number') out.DIM = 1 - values.INACTIVE_DIM;
  if (id.startsWith('cursor-trail-')) { set('HEAD', values.BOLT_COLOR ?? values.TRAIL_COLOR); set('TAIL', values.GLOW_COLOR ?? values.TRAIL_COLOR_ACCENT); }
  return out;
}

/** How long one run lasts; 0 for a still effect. */
export const PREVIEW_MS: Record<PreviewKind, number> = {trail: 1800, comet: 1800, blaze: 2000, lightning: 1100, 'motion-blur': 1600,
  aurora: 3600, dim: 1500, vignette: 0, scanlines: 0, glow: 0,
  'ink-bloom': 1700, 'type-garden': 2000, filament: 1500, 'glitch-hop': 900, 'gravity-lens': 1400, 'holo-foil': 3600, 'shine-sweep': 2400, 'halo-bloom': 3200};

export interface PreviewInput {
  kind: PreviewKind;
  values: Readonly<Record<string, ShaderValue>>;
  width: number;
  /** Milliseconds since the run started. */
  elapsed: number;
  /** Reduced Motion or Effects Off: one still frame. */
  still: boolean;
  /** The sample terminal's colors (the current theme). */
  colors: {background: RgbColor; foreground: RgbColor; accent: RgbColor; cursor: RgbColor};
  /** The terminal's color level (escapes are degraded like every other NMSh color). */
  level?: ColorLevel;
}

export interface PreviewFrame {rows: string[]; busy: boolean}

const SAMPLE = ['❯ ls ~/projects', 'notMyShell  dotfiles  notes', '❯ git status', 'On branch main · clean'];
export const PREVIEW_ROWS = SAMPLE.length + 1;

const num = (value: ShaderValue | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const channel = (part: unknown) => Math.round(Math.max(0, Math.min(1, typeof part === 'number' && Number.isFinite(part) ? part : 0)) * 255);
const rgb = (value: ShaderValue | undefined, fallback: RgbColor): RgbColor => Array.isArray(value) && value.length >= 3
  ? {red: channel(value[0]), green: channel(value[1]), blue: channel(value[2])} : fallback;
const mix = (a: RgbColor, b: RgbColor, t: number): RgbColor => {
  const k = Math.max(0, Math.min(1, t));
  return {red: Math.round(a.red + (b.red - a.red) * k), green: Math.round(a.green + (b.green - a.green) * k), blue: Math.round(a.blue + (b.blue - a.blue) * k)};
};
const luminance = (color: RgbColor) => (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;

interface Cell {char: string; fg: RgbColor; bg: RgbColor}

/** Draws one frame. Pure: the same input gives the same rows. */
export function renderShaderPreview(input: PreviewInput): PreviewFrame {
  const width = Math.max(12, Math.min(input.width, 64));
  const {colors, values, kind} = input;
  const duration = PREVIEW_MS[kind];
  const time = input.still || duration === 0 ? duration * 0.6 : Math.min(input.elapsed, duration);
  const t = duration ? time / duration : 1;
  const grid: Cell[][] = [...SAMPLE, ''].map((line, row) => [...line.padEnd(width).slice(0, width)].map(char => ({char, fg: row % 2 === 0 ? colors.accent : colors.foreground, bg: colors.background})));
  const rows = grid.length;
  const at = (x: number, y: number) => grid[y]?.[x];
  const intensity = num(values.INTENSITY, 0.6);
  if (TRAIL_PREVIEWS.has(kind)) {
    // The cursor jumps from the end of one command line to the next prompt; each style draws its own trail behind it.
    const from = {x: SAMPLE[0]!.length, y: 0};
    const to = {x: 2, y: 2};
    const point = (s: number) => ({x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s});
    const headColor = rgb(values.HEAD, colors.cursor);
    const tailColor = rgb(values.TAIL, mix(colors.cursor, colors.background, 0.5));
    const paint = (x: number, y: number, color: RgbColor, amount: number) => {
      const cell = at(Math.round(x), Math.round(y));
      if (cell && amount > 0) cell.bg = mix(cell.bg, color, Math.min(1, amount));
    };
    let head = to;
    if (kind === 'trail' || kind === 'comet') {
      const travel = Math.min(1, t / 0.35);
      const fade = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.65);
      head = point(travel);
      for (let step = 0; step <= 24; step++) {
        const s = step / 24;
        if (s > travel) break;
        const along = s / Math.max(travel, 0.01);
        // Comet: a bright head on a thin tail that tapers away; the plain trail keeps its width.
        const taper = kind === 'comet' ? along ** 1.6 : 0.35 + 0.65 * along;
        const spot = point(s);
        paint(spot.x, spot.y, mix(tailColor, headColor, along), intensity * fade * taper);
      }
    } else if (kind === 'blaze') {
      // A filled band as wide as the cursor's travel, amber inside and red-orange on its edges, easing out from the far end.
      // The band's far end retracts towards the cursor as it burns out.
      const remaining = (1 - Math.min(1, t)) ** 2;
      const life = Math.max(0, 1 - t * 0.6);
      for (let step = 0; step <= 32; step++) {
        const s = step / 32;
        if (s < 1 - remaining) continue;
        const spot = point(s);
        for (const dx of [-2, -1, 0, 1, 2]) {
          const edge = Math.abs(dx) === 2;
          paint(spot.x + dx, spot.y, edge ? tailColor : headColor, (edge ? 0.75 : 0.9) * life * (0.4 + 0.6 * s) * (0.6 + 0.4 * intensity));
        }
      }
    } else if (kind === 'lightning') {
      // A thin bolt with jagged interior nodes and three short forks; it flashes hard, flickers and fades within a moment.
      const flash = Math.max(0, 1 - t / 0.55) ** 2;
      const flicker = 0.75 + 0.25 * Math.sin(input.elapsed * 0.095);
      const strength = flash * flicker;
      const jag = (s: number) => {
        const node = Math.round(s * 8);
        const random = Math.sin(node * 12.9898) * 43758.5453;
        const offset = ((random - Math.floor(random)) * 2 - 1) * 3 * Math.sin(Math.PI * s);
        const spot = point(s);
        return {x: spot.x + offset, y: spot.y};
      };
      for (let step = 0; step <= 40; step++) {
        const spot = jag(step / 40);
        for (const dx of [-1, 1]) paint(spot.x + dx, spot.y, tailColor, strength * 0.55);
      }
      for (let step = 0; step <= 40; step++) {
        const spot = jag(step / 40);
        paint(spot.x, spot.y, headColor, strength);
        const cell = at(Math.round(spot.x), Math.round(spot.y));
        if (cell && strength > 0.2) cell.fg = colors.background;
      }
      for (const fork of [0.3, 0.55, 0.78]) {
        const root = jag(fork);
        const side = fork === 0.55 ? -1 : 1;
        for (let k = 1; k <= 3; k++) paint(root.x + k * side, root.y + (k === 3 ? side : 0), headColor, strength * (0.85 - k * 0.15));
      }
    } else {
      // Motion blur: the cursor glides along a smoothed path and leaves fading ghost copies of itself, no colored band.
      const travel = 1 - (1 - Math.min(1, t / 0.6)) ** 3;
      const fade = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
      head = point(travel);
      for (let ghost = 1; ghost <= 6; ghost++) {
        const s = Math.max(0, travel - ghost * 0.09);
        const spot = point(s);
        paint(spot.x, spot.y, colors.cursor, intensity * fade * (0.7 - ghost * 0.1));
      }
    }
    const cursor = at(Math.round(head.x), Math.round(head.y));
    if (cursor) { cursor.bg = colors.cursor; cursor.fg = colors.background; }
  } else if (kind === 'aurora') {
    const a = rgb(values.COLOR_A, {red: 51, green: 230, blue: 153});
    const b = rgb(values.COLOR_B, {red: 115, green: 89, blue: 255});
    const height = num(values.HEIGHT, 0.45);
    const speed = num(values.SPEED, 0.4);
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const cell = at(x, y)!;
      if (cell.char !== ' ') continue; // background only: text keeps its colors
      const u = x / width;
      const phase = time / 1000 * speed * 2;
      const wave = Math.sin(u * 5 + phase) * 0.6 + Math.sin(u * 11 - phase * 1.4) * 0.3;
      const band = Math.max(0, Math.min(1, ((1 - y / rows) + wave * 0.15 - (1 - height)) / Math.max(height, 0.05)));
      cell.bg = mix(cell.bg, mix(a, b, 0.5 + 0.5 * Math.sin(u * 3 + phase * 0.7)), band * intensity);
    }
  } else if (kind === 'dim') {
    // Right half: an unfocused split dims, then focus returns and it fades back.
    const dim = num(values.DIM, 0.35);
    const amount = t < 0.5 ? dim : dim * Math.max(0, 1 - (t - 0.5) / 0.5);
    for (let y = 0; y < rows; y++) for (let x = Math.floor(width / 2) + 1; x < width; x++) {
      const cell = at(x, y)!;
      cell.fg = mix(cell.fg, colors.background, amount); cell.bg = mix(cell.bg, {red: 0, green: 0, blue: 0}, amount * 0.6);
    }
    for (let y = 0; y < rows; y++) { const cell = at(Math.floor(width / 2), y); if (cell) { cell.char = '│'; cell.fg = mix(colors.foreground, colors.background, 0.5); } }
  } else if (kind === 'vignette') {
    const edge = rgb(values.COLOR, {red: 0, green: 0, blue: 0});
    const radius = num(values.RADIUS, 0.85);
    const softness = num(values.SOFTNESS, 0.45);
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const dx = (x / (width - 1) - 0.5) * 2;
      const dy = (y / (rows - 1) - 0.5) * 2;
      const d = Math.hypot(dx, dy) / Math.SQRT2;
      const k = Math.max(0, Math.min(1, (d - (radius - softness)) / Math.max(softness, 0.01))) * intensity;
      const cell = at(x, y)!;
      cell.bg = mix(cell.bg, edge, k); cell.fg = mix(cell.fg, edge, k * 0.7);
    }
  } else if (kind === 'scanlines') {
    // Cells are taller than pixels: every other row darkens, an approximation of thin lines.
    for (let y = 1; y < rows; y += 2) for (let x = 0; x < width; x++) {
      const cell = at(x, y)!;
      cell.bg = mix(cell.bg, {red: 0, green: 0, blue: 0}, Math.min(1, intensity * 1.5)); cell.fg = mix(cell.fg, {red: 0, green: 0, blue: 0}, intensity);
    }
  } else if (nmshEffect(kind)) {
    drawNmshPreview(kind as NmshEffectId, {grid, width, rows, t, elapsed: input.still ? duration * 0.6 : input.elapsed, values, colors});
  } else if (kind === 'glow') {
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const cell = at(x, y)!;
      if (cell.char !== ' ') continue;
      const near = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter((other): other is Cell => Boolean(other && other.char !== ' '));
      if (!near.length) continue;
      const bright = near.reduce((best, other) => luminance(other.fg) > luminance(best.fg) ? other : best);
      cell.bg = mix(cell.bg, bright.fg, Math.min(0.6, intensity * 0.35 * near.length));
    }
  }
  // Escapes only where a color changes, at the terminal's own color level.
  const same = (a: RgbColor | undefined, b: RgbColor) => a !== undefined && a.red === b.red && a.green === b.green && a.blue === b.blue;
  const out = grid.map(line => {
    let fg: RgbColor | undefined;
    let bg: RgbColor | undefined;
    return line.map(cell => {
      const text = `${same(fg, cell.fg) ? '' : colorEscape(38, cell.fg, input.level)}${same(bg, cell.bg) ? '' : colorEscape(48, cell.bg, input.level)}${cell.char}`;
      fg = cell.fg; bg = cell.bg;
      return text;
    }).join('') + '\u001b[0m';
  });
  return {rows: out, busy: !input.still && duration > 0 && input.elapsed < duration};
}

// ---- NMSh's own effects --------------------------------------------------------------------------------------------

interface NmshPreviewInput {
  grid: Cell[][]; width: number; rows: number; t: number; elapsed: number;
  values: Readonly<Record<string, ShaderValue>>; colors: PreviewInput['colors'];
}

const STRENGTHS = [0.55, 1, 1.7];
const fromUnit = (rgb: readonly number[]): RgbColor => ({red: channel(rgb[0]), green: channel(rgb[1]), blue: channel(rgb[2])});
const hash = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
const rainbow = (phase: number): RgbColor => fromUnit([0, 0.33, 0.67].map(shift => 0.5 + 0.5 * Math.cos(6.283 * (phase + shift))));

/** The effect's palette color for a slot, as the shader picks it (theme slots use the sample's cursor color). */
function paletteColor(id: NmshEffectId, values: Readonly<Record<string, ShaderValue>>, slot: number, theme: RgbColor): RgbColor {
  const effect = nmshEffect(id)!;
  const choice = effect.palette?.[num(values.COLOR, effect.defaults.COLOR ?? 0)] ?? effect.palette?.[0];
  const value = choice?.[Math.min(slot, choice.length - 1)];
  return !value || value === 'theme' ? theme : fromUnit(value);
}

/** A small colorful block "logo" on the right of the sample, where welcome effects act (plain text stays plain). */
function drawLogo(grid: Cell[][], width: number): Array<{x: number; y: number; cell: Cell}> {
  const x0 = Math.max(0, width - 11);
  const shape = ['██ ██ ███', '█████ █ █', '██ ██ ███', '██ ██ █ █'];
  const cells: Array<{x: number; y: number; cell: Cell}> = [];
  shape.forEach((line, y) => [...line].forEach((char, dx) => {
    const cell = grid[y]?.[x0 + dx];
    if (!cell) return;
    if (char === ' ') { cell.char = ' '; return; }
    cell.char = '█'; cell.fg = rainbow(dx / 11 + y * 0.04);
    cells.push({x: x0 + dx, y, cell});
  }));
  return cells;
}

function drawNmshPreview(id: NmshEffectId, input: NmshPreviewInput): void {
  const {grid, width, rows, t, values, colors} = input;
  const at = (x: number, y: number) => grid[y]?.[x];
  const k = STRENGTHS[num(values.STRENGTH, 1)] ?? 1;
  const theme = colors.cursor;
  const color = (slot: number) => paletteColor(id, values, slot, theme);
  const typed = {x: SAMPLE[2]!.length - 1, y: 2};
  const caret = (x: number, y: number) => { const cell = at(x, y); if (cell) { cell.bg = colors.cursor; cell.fg = colors.background; } };
  if (id === 'ink-bloom') {
    // An irregular wash spreads from the glyph just typed, its rim darker, then it dries.
    const spread = 1 - (1 - Math.min(1, t * 1.7)) ** 3;
    const wet = 1 - t;
    const dry = 1 - Math.max(0, (t - 0.5) / 0.5);
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const dx = (x - typed.x) / 2;
      const dy = y - typed.y;
      const angle = Math.atan2(dy, dx);
      const radius = (0.6 + 1.5 * spread) * (1 + 0.18 * Math.sin(angle * 2 + 1.3) + 0.12 * Math.sin(angle * 3 - 0.7));
      const r = Math.hypot(dx, dy);
      if (r > radius + 0.3) continue;
      const rim = Math.abs(r - radius * 0.85) < 0.45 ? 1 : 0;
      const ink = mix(color(0), color(1), r / Math.max(radius, 0.1));
      const cell = at(x, y)!;
      cell.bg = mix(cell.bg, ink, k * Math.min(0.9, (0.38 * wet + 0.08) * (r < radius ? 1 : 0.4) + rim * 0.45 * dry));
      if (cell.char !== ' ' && r < radius * 0.7) cell.fg = mix(cell.fg, ink, wet * 0.6);
    }
    caret(typed.x + 1, typed.y);
  } else if (id === 'type-garden') {
    // Sprouts grow up from the glyph just typed, open small flowers, then rise a row and fade.
    for (const [index, dx] of [[0, -1], [1, 0], [2, 1]] as const) {
      const q = Math.max(0, Math.min(1, (t - index * 0.09) / (1 - index * 0.09)));
      if (q <= 0) continue;
      const fade = 1 - Math.max(0, (q - 0.55) / 0.45);
      const rise = q > 0.7 ? 1 : 0;
      const height = Math.min(2, Math.ceil(q * 2.4 * (index === 1 ? 2 : 1.5)));
      for (let h = 1; h <= height; h++) {
        const cell = at(typed.x + dx, typed.y - h - rise);
        if (!cell) continue;
        const top = h === height;
        const tint = mix(cell.bg, top && q > 0.25 ? color(1 + (index % 2)) : color(0), Math.min(1, fade * (0.5 + 0.5 * k)));
        // Sprouts grow in the gaps; over existing text they only light the cell, as the shader's glow does.
        if (cell.char === ' ') { cell.char = top && q > 0.25 ? (index === 1 ? '✿' : '❀') : '│'; cell.fg = tint; }
        else cell.bg = mix(cell.bg, tint, 0.45);
      }
    }
    caret(typed.x + 1, typed.y);
  } else if (id === 'filament') {
    // A coiled wire along the cursor's jump, white-hot at the cursor, cooling to amber and deep red from the far end.
    const from = {x: SAMPLE[0]!.length, y: 0};
    const to = {x: 2, y: 2};
    const ramp = (heat: number) => heat > 0.75 ? mix(color(2), {red: 255, green: 247, blue: 230}, (heat - 0.75) / 0.25)
      : heat > 0.45 ? mix(color(1), color(2), (heat - 0.45) / 0.3) : mix(colors.background, mix(color(0), color(1), heat / 0.45), Math.min(1, heat / 0.2));
    for (let step = 0; step <= 40; step++) {
      const s = step / 40;
      const heat = Math.max(0, Math.min(1, 1.12 - t * 1.25 - (1 - s) * (0.25 + 0.6 * t)));
      if (heat <= 0) continue;
      const cell = at(Math.round(from.x + (to.x - from.x) * s), Math.round(from.y + (to.y - from.y) * s));
      if (!cell) continue;
      if (cell.char === ' ') { cell.char = '~'; cell.fg = ramp(heat); }
      cell.bg = mix(cell.bg, ramp(heat), Math.min(0.6, heat * 0.45 * k));
    }
    caret(to.x, to.y);
  } else if (id === 'glitch-hop') {
    // Rows along a big jump tear sideways in slices, with colored ghosts, for a moment only.
    const frame = Math.floor(input.elapsed / 60);
    const env = (1 - t) ** 2;
    const tintA = color(0);
    const tintB = color(1);
    const ghostA = mix(tintA.red + tintA.green + tintA.blue ? tintA : colors.accent, {red: 255, green: 255, blue: 255}, 0.2);
    const ghostB = mix(tintB, {red: 255, green: 255, blue: 255}, 0.2);
    for (let y = 0; y < rows - 1; y++) {
      const r = hash(y, frame);
      if (r < 0.35 || env <= 0.05) continue;
      const shove = hash(frame, y * 1.7) - 0.5;
      const offset = Math.sign(shove || 1) * Math.max(1, Math.round(Math.abs(shove) * 6 * env * k));
      const source = grid[y]!.map(cell => ({...cell}));
      for (let x = 0; x < width; x++) {
        const from = source[x + offset];
        const cell = grid[y]![x]!;
        if (!from) continue;
        cell.char = from.char;
        cell.fg = from.char === ' ' ? cell.fg : mix(from.fg, offset > 0 ? ghostA : ghostB, Math.min(1, 0.45 + 0.35 * k));
      }
    }
    caret(2, 2);
  } else if (id === 'gravity-lens') {
    // Text near the cursor's landing spot is drawn in toward it, overshoots and springs back; a faint ring spreads.
    const center = {x: 14, y: 1};
    const spring = Math.exp(-3.6 * t) * Math.cos(t * 7.5) * (1 - Math.exp(-40 * t));
    const source = grid.map(line => line.map(cell => ({...cell})));
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const dx = (x - center.x) / 2;
      const dy = y - center.y;
      const r = Math.hypot(dx, dy);
      if (r > 3.5 || r < 0.5) continue;
      const pull = Math.round(spring * k * 1.6 * (r / 3.5) * Math.exp(-((r / 3.5) ** 2)) * 3.2);
      const from = source[y]?.[x + Math.sign(x - center.x) * pull];
      const cell = grid[y]![x]!;
      if (from) { cell.char = from.char; cell.fg = from.fg; }
      const ring = 0.6 + 2.4 * t;
      if (Math.abs(r - ring) < 0.4) cell.bg = mix(cell.bg, theme, 0.5 * Math.exp(-4 * t) * k);
    }
    caret(center.x, center.y);
  } else {
    const logo = drawLogo(grid, width);
    if (id === 'holo-foil') {
      // Iridescent bands drift diagonally over the logo, with a few twinkling flecks.
      for (const {x, y, cell} of logo) {
        const film = values.COLOR === 1 ? mix(rainbow(x * 0.08 + y * 0.12 - t * 0.9), {red: 255, green: 245, blue: 250}, 0.55)
          : values.COLOR === 2 ? mix(theme, {red: 255 - theme.red, green: 255 - theme.green, blue: 255 - theme.blue}, 0.5 + 0.5 * Math.sin((x + y) * 0.7 - t * 6))
            : rainbow(x * 0.08 + y * 0.12 - t * 0.9);
        cell.fg = mix(cell.fg, film, Math.min(0.9, 0.55 * k));
        if (hash(x, y + Math.floor(t * 6)) > 0.9) { cell.char = '✦'; cell.fg = {red: 255, green: 255, blue: 255}; cell.bg = mix(cell.bg, film, 0.5); }
      }
    } else if (id === 'shine-sweep') {
      // One bright diagonal band crosses the logo; the text beside it is untouched.
      const light = paletteColor(id, values, 0, theme);
      const x0 = Math.max(0, width - 11);
      const center = -0.25 + t * 1.5;
      for (const {x, y, cell} of logo) {
        const d = (x - x0 + (3 - y) * 0.8) / 12 - center;
        const band = Math.max(0, 1 - Math.abs(d) / 0.14);
        cell.fg = mix(cell.fg, light, Math.min(1, band * 0.95 * k));
      }
    } else {
      // A soft glow breathes around the logo's colorful cells.
      const breathe = 0.7 + 0.3 * Math.sin(t * Math.PI * 4);
      const glowColor = (from: Cell) => values.COLOR === 1 ? theme : from.fg;
      for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
        const cell = at(x, y)!;
        if (logo.some(item => item.cell === cell)) continue;
        let best: {d: number; cell: Cell} | undefined;
        for (const item of logo) { const d = Math.hypot((item.x - x) / 2, item.y - y); if (!best || d < best.d) best = {d, cell: item.cell}; }
        if (!best || best.d > 1.6) continue;
        cell.bg = mix(cell.bg, glowColor(best.cell), Math.min(0.75, (0.55 - best.d * 0.28) * breathe * k));
      }
    }
  }
}
