import stringWidth from 'string-width';
import {formatDuration, formatLocalTime} from './commandTiming.js';
import {GLYPHS, SPINNER_FRAMES} from '../ui/glyphs.js';
import type {ActivityVerbPair} from './activityVerbs.js';

export const ACTIVITY_GLYPH_INTERVAL_MS = 165;

export function activityGlyph(elapsedMs: number): string {
  const frames = SPINNER_FRAMES.frames;
  return frames[Math.floor(Math.max(0, elapsedMs) / ACTIVITY_GLYPH_INTERVAL_MS) % frames.length];
}

/**
 * The working line. Classic names what runs ("Running ls -la"); Expressive (a pair given) shows only the decorative
 * phrase, since the command is already on the line above it. Neither says anything about the work being verified.
 */
export function liveActivityParts(command: string, elapsedMs: number, animationElapsedMs = elapsedMs, pair?: ActivityVerbPair): {phrase: string; duration: string} {
  if (pair) return {phrase: `${activityGlyph(animationElapsedMs)} ${pair.active}…`, duration: ` · ${formatDuration(elapsedMs)}`};
  let flattenedCommand = command.trim().replace(/\r?\n/g, ' ⏎ ');
  if (flattenedCommand.length > 50) {
    flattenedCommand = flattenedCommand.slice(0, 49) + '…';
  }
  return {
    phrase: `${activityGlyph(animationElapsedMs)} Running ${flattenedCommand}`,
    duration: ` · ${formatDuration(elapsedMs)}`,
  };
}

/**
 * The finished line. With a pair (Expressive), only a clean exit uses the decorative wording ("✔ Cooked for 18s ·
 * done 14:46"); a failure or interrupt keeps the factual text with its exit code, so it can never read as success.
 */
export function completedActivity(command: string, elapsedMs: number, completedAt: Date, exitCode: number, interrupted: boolean, facts?: string[], pair?: ActivityVerbPair): {main: string; detail: string} {
  if (pair && !interrupted && exitCode === 0) {
    const detailFacts = facts && facts.length > 0 ? ` · ${facts.join(' · ')} · ${formatDuration(elapsedMs)}` : ` for ${formatDuration(elapsedMs)}`;
    return {main: `${GLYPHS.success} ${pair.complete}${detailFacts}`, detail: ` · done ${formatLocalTime(completedAt)}`};
  }
  let statusText = 'Completed';
  let icon = GLYPHS.success;

  if (facts && facts.length > 0) {
    statusText = facts.join(' · ');
  }

  if (interrupted) {
    statusText = 'Interrupted';
    icon = GLYPHS.failure;
  } else if (exitCode !== 0) {
    if (facts && facts.length > 0) {
        statusText = `Command failed · ${facts.join(' · ')} · exit ${exitCode}`;
    } else {
        statusText = `Command failed · exit ${exitCode}`;
    }
    icon = GLYPHS.failure;
  }

  return {
    main: `${icon} ${statusText} · ${formatDuration(elapsedMs)}`,
    detail: ` · ${formatLocalTime(completedAt)}`,
  };
}

export function activityGlyphWidths(): number[] {
  return SPINNER_FRAMES.frames.map(glyph => stringWidth(glyph));
}
