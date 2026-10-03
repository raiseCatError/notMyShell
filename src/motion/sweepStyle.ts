import type {PromptConfiguration} from '../prompt/configuration.js';
import {sampleGradient} from '../chroma/chroma.js';
import {treatmentFor} from '../chroma/treatment.js';
import {UI_COLORS} from '../ui/palette.js';
import type {SweepStyle} from './lightSweep.js';

/**
 * The light sweep for a configuration. Follow appearance tints with the
 * Chroma gradient at each cell while Chroma is on, otherwise with a little of
 * the theme accent; Grayscale chrome makes it luminance-only. Decorative
 * effects Off turns it off.
 */
export function sweepStyleFor(configuration: PromptConfiguration, strength: 'subtle' | 'vivid' = 'subtle'): SweepStyle {
  const presentation = configuration.presentation;
  const level = presentation.effectsOff || presentation.shimmer === 'off' ? 'off' : strength;
  const grayscale = configuration.uiChrome.source === 'custom' && configuration.uiChrome.preset === 'grayscale';
  const chroma = treatmentFor(presentation);
  const gradient = chroma && {stops: chroma.stops.map((color, index) => ({color, at: chroma.stops.length <= 1 ? 0 : index / (chroma.stops.length - 1)}))};
  return {
    level, speed: 'normal', grayscale,
    semantic: presentation.semantic ?? 'preserve',
    tint: grayscale ? undefined : gradient ? position => sampleGradient(gradient, position) : () => ({...UI_COLORS.accent}),
  };
}

/** Reduced Motion (setting or NMSH_REDUCED_MOTION): no traveling wave. */
export function sweepStill(configuration: PromptConfiguration, env: NodeJS.ProcessEnv = process.env): boolean {
  return configuration.presentation.reducedMotion || env.NMSH_REDUCED_MOTION === '1';
}
