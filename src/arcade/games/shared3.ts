import type {Rgb} from '../../chroma/escape.js';
import type {PixelBuffer, Sprite} from '../Canvas.js';
import type {ParticleSystem} from '../effects.js';
import type {GameContext} from '../types.js';

/** Small drawing helpers shared by Alley Sprint, Kitten Parade, Glass Rush and Maze Prowler. */

/** Pixel art only when there is color and Safe Glyphs is off; otherwise a game draws plain glyphs. */
export const pixelArt = (context: Pick<GameContext, 'color' | 'safeGlyphs'>): boolean => context.color !== 'none' && !context.safeGlyphs;

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** A sprite drawn into the box (x, y, width, height) by nearest-neighbour sampling, optionally mirrored. */
export function drawScaled(buffer: PixelBuffer, sprite: Sprite, x: number, y: number, width: number, height: number, flip = false): void {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  for (let row = 0; row < h; row += 1) {
    const sy = Math.min(sprite.height - 1, Math.floor((row * sprite.height) / h));
    for (let column = 0; column < w; column += 1) {
      const sx0 = Math.min(sprite.width - 1, Math.floor((column * sprite.width) / w));
      const color = sprite.pixels[sy * sprite.width + (flip ? sprite.width - 1 - sx0 : sx0)];
      if (color) buffer.set(Math.round(x) + column, Math.round(y) + row, color);
    }
  }
}

/** A burst of colored bits all around (a new record, a cleared board). */
export function confetti(particles: ParticleSystem, x: number, y: number, colors: readonly Rgb[], count = 36): void {
  particles.burst({x, y, count, speed: 60, angle: -Math.PI / 2, spread: Math.PI, life: 900, gravity: 90, drag: 0.6, colors});
}
