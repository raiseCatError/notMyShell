import {mixRgb, sampleGradient, solid} from '../chroma/chroma.js';
import {parseHexColor} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import {readableTextTone, samplePromptTreatment, treatmentFor} from '../chroma/treatment.js';
import {defaultUiColors} from '../appearance/uiTheme.js';
import {graphemes} from '../input/inputLayout.js';
import type {SweepCell, SweepStyle} from '../motion/lightSweep.js';
import {sweepStyleFor} from '../motion/sweepStyle.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import {UI_COLORS} from '../ui/palette.js';

/** Neutral live text: no hue at all. */
const GRAY: Rgb = {red: 178, green: 180, blue: 186};

/**
 * The colors of the LIVE running-command phrase and the light sweep over it,
 * from the one Live activity colors setting. Only the live line uses this;
 * a finished command is rendered as its ordinary, static semantic result.
 *
 * - Follow appearance: Chroma when it is on (Semantic Preserve keeps the
 *   working color and lets Chroma tint only the sweep), otherwise the theme.
 * - Native Lavender: the shipped NMSh working colors, whatever the theme.
 * - Grayscale: no hue, and a luminance-only sweep.
 * - Custom: the user's gradient stops across the phrase.
 */
export function liveActivityPaint(phrase: string, configuration: PromptConfiguration, time = 0, still = true): {cells: SweepCell[]; style: SweepStyle} {
  const style = sweepStyleFor(configuration);
  const glyphs = graphemes(phrase);
  const position = (index: number) => glyphs.length <= 1 ? 0 : index / (glyphs.length - 1);
  const cell = (color: (index: number) => Rgb) => glyphs.map((glyph, index) => ({glyph, color: glyph === ' ' ? undefined : color(index)}));
  const working = mixRgb(UI_COLORS.workingBase, UI_COLORS.workingPeak, 0.35);
  switch (configuration.liveActivity.colors) {
    case 'lavender': {
      const shipped = defaultUiColors();
      const base = mixRgb(shipped.workingBase, shipped.workingPeak, 0.35);
      return {cells: cell(() => base), style: {...style, grayscale: false, tint: () => ({...shipped.accent})}};
    }
    case 'grayscale':
      return {cells: cell(() => GRAY), style: {...style, grayscale: true, tint: undefined}};
    case 'custom': {
      const stops = configuration.liveActivity.customStops.map(hex => parseHexColor(hex)).filter((color): color is Rgb => Boolean(color));
      if (stops.length >= 2) {
        const gradient = {stops: stops.map((color, index) => ({color: solid(color), at: index / (stops.length - 1)}))};
        return {cells: cell(index => readableTextTone(sampleGradient(gradient, position(index)))), style: {...style, grayscale: false, tint: at => sampleGradient(gradient, at)}};
      }
      break;
    }
    case 'appearance': {
      const treatment = treatmentFor(configuration.presentation);
      // Working is a status color: Override lets Chroma recolor it; Preserve keeps it and Chroma tints only the sweep.
      if (treatment && configuration.presentation.semantic === 'override') {
        return {cells: cell(index => readableTextTone(samplePromptTreatment(treatment, working, position(index), time, still))), style};
      }
      break;
    }
  }
  return {cells: cell(() => working), style};
}
