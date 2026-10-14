import {displayWidth, truncateText} from '../util/text.js';
import {formatDuration} from './commandTiming.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {commandWord} from '../session/liveStatus.js';
import {waitedSoFar, type InputRequest, type InputState, type InputTiming} from '../session/inputState.js';

/**
 * How NMSh shows a command that needs the person. One state (InputWatch) drives every surface; this module only
 * words and paints it. The look is NMSh's attention vocabulary: ◆ (confirmed) or ◇ (likely) in the accent with
 * weight, never animated, so it reads differently from the shimmering "Running" line with or without color.
 */
const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';

export function inputGlyph(request: Pick<InputRequest, 'confidence'>): string {
  const safe = getCurrentGlyphMode() === 'safe';
  return request.confidence === 'confirmed' ? (safe ? '!' : '◆') : (safe ? '?' : '◇');
}

/** The program the person is answering: what the platform reports in the foreground, else the command's word. */
export function inputProgram(request: InputRequest, command: string): string {
  return request.program || commandWord(command) || 'the command';
}

/** "Waiting for input" (confirmed) or "Probably waiting for input" (likely): the words carry the certainty. */
export function inputHeadline(request: Pick<InputRequest, 'confidence'>): string {
  return request.confidence === 'confirmed' ? 'Waiting for input' : 'Probably waiting for input';
}

/** How typing reaches the program, in a few words. */
export function inputHint(request: InputRequest, program: string): string {
  if (request.confidence === 'likely') return `Enter sends a line to ${program}`;
  switch (request.mode) {
    case 'hidden': return `typing is hidden and goes straight to ${program} · Enter sends`;
    case 'key': return `each key goes straight to ${program}`;
    case 'line': return `Enter sends a line to ${program}`;
  }
}

/**
 * The two rows of the live activity region while a command waits: the attention line (headline, program, how long
 * it has waited, and the total when it differs) and the prompt it left open with how input reaches it. Fits
 * `columns` by dropping the least important parts first.
 */
export function inputActivityRows(state: InputState & {request: InputRequest}, command: string, startedAt: number, now: number, columns: number): [string, string] {
  const request = state.request;
  const program = inputProgram(request, command);
  const accent = foreground(UI_COLORS.accent);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  // The wait comes from the session's clock and the total from this frontend's: never show a wait longer than the run.
  const total = Math.max(0, now - startedAt);
  const waitedMs = Math.min(Math.max(0, now - request.since), total);
  const waiting = formatDuration(waitedMs);
  const showTotal = total - waitedMs >= 1000;
  const head = `${inputGlyph(request)} ${inputHeadline(request)}`;
  const tails = [[program, waiting, ...(showTotal ? [`${formatDuration(total)} total`] : [])], [program, waiting], [waiting]];
  const tail = tails.find(parts => displayWidth(`${head} · ${parts.join(' · ')}`) <= columns) ?? [];
  const first = `${accent}${BOLD}${truncateText(head, columns)}${RESET}${tail.length ? `${secondary} · ${tail.join(' · ')}${RESET}` : ''}`;
  const prompt = request.prompt ?? '';
  const hint = inputHint(request, program);
  const indent = '  ';
  const room = Math.max(1, columns - displayWidth(indent));
  let second: string;
  // The question outranks the hint: the hint only shows when both fit; otherwise the question takes the row.
  if (!prompt) second = `${indent}${subtle}${truncateText(hint, room)}${RESET}`;
  else if (displayWidth(`${prompt}  ·  ${hint}`) <= room) second = `${indent}${BOLD}${prompt}${RESET}${subtle}  ·  ${hint}${RESET}`;
  else second = `${indent}${BOLD}${truncateText(prompt, room)}${RESET}`;
  return [first, second];
}

/** A running line's extra detail once the command has waited before: " · waited 18s" (never more than `elapsedMs`). */
export function waitedDetail(state: InputState | undefined, now: number, elapsedMs = Number.POSITIVE_INFINITY): string {
  const waited = Math.min(waitedSoFar(state, now), elapsedMs);
  return waited >= 1000 ? ` · waited ${formatDuration(waited)}` : '';
}

/** The completion fact: " · 18s waiting for input" (or "in 3 waits"); empty when the command never waited. */
export function completionWaitFact(timing: InputTiming | undefined): string {
  if (!timing?.waits || timing.waitedMs < 1000) return '';
  return ` · ${formatDuration(timing.waitedMs)} waiting for input${timing.waits > 1 ? ` (${timing.waits} prompts)` : ''}`;
}

/** The composer's placeholder while keys go straight to the program (hidden or key input). Never shows what is typed. */
export function directInputPlaceholder(request: InputRequest, program: string): string {
  return request.mode === 'hidden' ? `Hidden input for ${program} · nothing you type is shown` : `Keys go straight to ${program}`;
}
