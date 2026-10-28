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

export type PreviewKind = 'trail' | 'comet' | 'blaze' | 'lightning' | 'motion-blur' | 'aurora' | 'dim' | 'vignette' | 'scanlines' | 'glow';

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
  aurora: 3600, dim: 1500, vignette: 0, scanlines: 0, glow: 0};

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
