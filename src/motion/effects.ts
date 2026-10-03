import type {Region, ScreenPlan} from '../app/screenPlan.js';
import {colorEscape, type Rgb} from '../chroma/escape.js';
import {BRAND_LAVENDER, mixRgb} from '../chroma/chroma.js';
import type {TreatmentSettings} from '../chroma/treatment.js';
import type {ColorLevel} from '../presentation/capabilities.js';

export const EFFECT_DURATION_MS = 3000;
export const MAX_PARTICLES = 64;
export type EffectKind = 'sparkles' | 'rain' | 'confetti';
export const EFFECT_KINDS: readonly EffectKind[] = ['sparkles', 'rain', 'confetti'];
/** Confetti: a few theme-colored pieces drifting down; used for real milestones only. */
const CONFETTI: readonly Rgb[] = [{red: 166, green: 124, blue: 243}, {red: 62, green: 232, blue: 181}, {red: 242, green: 158, blue: 76},
  {red: 79, green: 184, blue: 247}, {red: 228, green: 108, blue: 200}];
export type EffectPlacement = 'top' | 'bottom';
export interface ActiveEffect {kind: EffectKind; placement: EffectPlacement; startedAt: number; seed: number}
export interface EffectCell {row: number; column: number; glyph: string; intensity: number; hue?: number}

/** Replace-active policy. No particles, timers or escapes are persisted. */
export class EffectState {
  active?: ActiveEffect;
  trigger(kind: EffectKind, placement: EffectPlacement, now: number, seed: number, settings: TreatmentSettings): boolean {
    this.cancel();
    if (settings.effectsOff || settings.reducedMotion) return false;
    this.active = {kind, placement, startedAt: now, seed: seed >>> 0};
    return true;
  }
  cancel(): void { this.active = undefined; }
  expire(now: number): boolean {
    if (!this.active || now - this.active.startedAt < EFFECT_DURATION_MS) return false;
    this.cancel(); return true;
  }
}

/** Only empty gaps and NMSh decorative rules. Never transcript, prompt, input or focus. */
export function effectRegion(plan: ScreenPlan, placement: EffectPlacement): Region | undefined {
  const regions = plan.regions.filter(region => region.height > 0 && ['gap', 'separator', 'composerBorder'].includes(region.kind));
  const region = placement === 'top' ? regions[0] : regions[regions.length - 1];
  return region && {...region, height: Math.min(4, region.height)};
}

function noise(seed: number, index: number): number {
  let n = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 0x100000000;
}

/** Pure seeded frames, bounded independently of transcript size and resize. */
export function effectCells(effect: ActiveEffect, region: Region, columns: number, now: number, safe: boolean): EffectCell[] {
  const elapsed = now - effect.startedAt;
  if (elapsed < 0 || elapsed >= EFFECT_DURATION_MS) return [];
  const width = Math.max(1, Math.min(512, Math.floor(columns)));
  const height = Math.max(0, Math.min(4, Math.floor(region.height)));
  const count = Math.min(MAX_PARTICLES, width * height);
  const frame = Math.floor(elapsed / 100);
  return Array.from({length: count}, (_, index) => {
    const phase = noise(effect.seed, index * 3);
    return {
      column: Math.floor(noise(effect.seed, index * 3 + 1) * width),
      row: region.top + (effect.kind === 'rain' ? (Math.floor(phase * height) + frame) % height
        : effect.kind === 'confetti' ? (Math.floor(phase * height) + Math.floor(frame / 3)) % height
          : Math.floor(noise(effect.seed, index * 3 + 2) * height)),
      glyph: effect.kind === 'rain' ? '|' : effect.kind === 'confetti' ? (safe ? '*' : ['▪', '•', '◆', '▴'][index % 4]!) : safe ? '+' : '·',
      intensity: (1 + Math.sin((phase + frame / 12) * 2 * Math.PI)) / 2,
      ...(effect.kind === 'confetti' ? {hue: index % CONFETTI.length} : {}),
    };
  });
}

/** Replaces only decorative rows in a copy of the current base projection. */
export function applyEffect(rows: readonly string[], effect: ActiveEffect, region: Region, columns: number, now: number, safe: boolean, level: ColorLevel): string[] {
  const next = [...rows];
  const width = Math.max(1, Math.min(512, Math.floor(columns)));
  const grid = Array.from({length: Math.min(4, region.height)}, () => Array<string>(width).fill(' '));
  for (const cell of effectCells(effect, region, columns, now, safe)) {
    const color = cell.hue === undefined ? mixRgb(BRAND_LAVENDER, {red: 235, green: 220, blue: 255}, cell.intensity)
      : mixRgb(CONFETTI[cell.hue]!, {red: 255, green: 255, blue: 255}, cell.intensity * 0.3);
    grid[cell.row - region.top]![cell.column] = `${colorEscape(38, color, level)}${cell.glyph}`;
  }
  grid.forEach((row, index) => { next[region.top + index] = row.join('') + (level === 'none' ? '' : '\u001B[0m'); });
  return next;
}
