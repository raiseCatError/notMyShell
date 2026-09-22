import stringWidth from 'string-width';
import {formatDuration, formatLocalTime} from './commandTiming.js';
import {ACTIVITY_VERBS, type ActivityVerbPair} from './activityVerbs.js';

export {ACTIVITY_VERBS, type ActivityVerbPair} from './activityVerbs.js';

import {GLYPHS, SPINNER_FRAMES} from '../ui/glyphs.js';

export const ACTIVITY_GLYPH_INTERVAL_MS = 165;

export class ActivitySelector {
  private previous = -1;
  constructor(private readonly random: () => number = Math.random) {}

  next(): ActivityVerbPair {
    let index = Math.min(ACTIVITY_VERBS.length - 1, Math.floor(this.random() * ACTIVITY_VERBS.length));
    if (ACTIVITY_VERBS.length > 1 && index === this.previous) index = (index + 1) % ACTIVITY_VERBS.length;
    this.previous = index;
    return ACTIVITY_VERBS[index];
  }
}

export function activityGlyph(elapsedMs: number): string {
  const frames = SPINNER_FRAMES.frames;
  return frames[Math.floor(Math.max(0, elapsedMs) / ACTIVITY_GLYPH_INTERVAL_MS) % frames.length];
}

export function liveActivity(pair: ActivityVerbPair, elapsedMs: number): string {
  return `${activityGlyph(elapsedMs)} ${pair.active}… (${formatDuration(elapsedMs)})`;
}

export function liveActivityParts(pair: ActivityVerbPair, elapsedMs: number): {phrase: string; duration: string} {
  return {
    phrase: `${activityGlyph(elapsedMs)} ${pair.active}…`,
    duration: ` (${formatDuration(elapsedMs)})`,
  };
}

export function completedActivity(pair: ActivityVerbPair, elapsedMs: number, completedAt: Date): {main: string; detail: string} {
  return {
    main: `${GLYPHS.success} ${pair.complete} for ${formatDuration(elapsedMs)}`,
    detail: ` · done ${formatLocalTime(completedAt)}`,
  };
}

export function activityGlyphWidths(): number[] {
  return SPINNER_FRAMES.frames.map(glyph => stringWidth(glyph));
}
